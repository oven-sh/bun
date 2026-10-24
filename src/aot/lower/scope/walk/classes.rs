use bun_sema::bind::ScopeId;
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, Flags, MemberId, MemberKind, PropKey};
use bun_sema::util::SharedSort;

use super::walker::{bindings_of, entries_of};
use super::{Context, Task, WalkedFunctionId, Walker};
use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::class;
use crate::lower::scope::ScopeSlot;

fn has_slot(sorted_slots: &[ClassSlot], slot: ClassSlot) -> bool {
    sorted_slots.binary_search(&slot).is_ok()
}

fn slot_initialization(scope: ScopeId, slot: ClassSlot) -> Task {
    Task::InitializeSlot(scope, ScopeSlot::Class(slot))
}

impl Walker<'_, '_> {
    pub(super) fn visit_class(&mut self, class: ClassId, context: Context) {
        let (hir, bound) = (self.hir, self.bound);
        if hir[class].flags.contains(Flags::AMBIENT) {
            return;
        }
        let scope = bound.class_scope[class.idx()];
        let inner_name = bound.inner_class_symbol(class);
        let mut slots = class::class_slots(hir, bound, self.input.compiled.settings, class);
        slots.shared_sort_unstable();
        let source_constructor = hir[class].members.iter().find(|&member| {
            hir.runtime_member_kind(member) == MemberKind::Constructor
                && self.is_live_function(hir[member].func)
        });
        let source_constructor = source_constructor.map(|member| hir[member].func);
        let (file, creator) = (self.input.file, context.function);
        let reference = ClassRef { file, class };
        let constructor = match source_constructor {
            Some(function) => {
                let declared = self.declare_function(function, creator);
                declared.expect("a live constructor is declared once")
            }
            None => self.add_function(FunctionKey::ImplicitConstructor(reference), Some(creator)),
        };
        let instance_key = FunctionKey::InstanceInitializer(reference);
        let instance_initializer = self.add_function(instance_key, Some(constructor));
        let static_key = FunctionKey::StaticInitializer(reference);
        let static_initializer = self.add_function(static_key, Some(creator));
        self.enter_scope(bound.symbol_scope(inner_name), context);
        self.enter_scope(scope, context);
        for binding in bindings_of(&self.metadata_uses, class) {
            self.record_binding_use(context, binding, false);
        }
        let (of_instances, of_class) = (Some(instance_initializer), Some(static_initializer));
        for &slot in &slots {
            let users = match slot {
                ClassSlot::ClassToken => [of_instances, None],
                ClassSlot::ComputedKey(_) | ClassSlot::DecoratorState => [of_instances, of_class],
                ClassSlot::ClassObject | ClassSlot::StaticField(_) => [None, of_class],
                ClassSlot::PrivateMethod(_) => [None, None],
            };
            for user in users.into_iter().flatten() {
                self.record_slot_use(user, scope, ScopeSlot::Class(slot));
            }
        }

        for &(_, decorator) in entries_of(&self.class_decorators, class) {
            self.stack.push((Task::Expression(decorator), context));
        }
        self.push_expressions([hir[class].extends], context);
        if has_slot(&slots, ClassSlot::ClassToken) {
            self.push_task(slot_initialization(scope, ClassSlot::ClassToken), context);
        }
        self.push_task(Task::MarkCreated(constructor), context);
        self.push_task(Task::MarkCreated(instance_initializer), context);
        if let Some(function) = source_constructor {
            let top_scope = bound.fns[function.idx()].scope;
            self.record_slot_use(constructor, top_scope, ScopeSlot::This);
            let inner = self.enter_unit(constructor, top_scope);
            self.push_function_code(function, inner);
        }
        self.push_task(slot_initialization(scope, ClassSlot::ClassObject), context);
        self.push_members(class, instance_initializer, &slots, context);
        self.push_initialization(inner_name, context);
        for &slot in &slots {
            match slot {
                ClassSlot::PrivateMethod(member) => {
                    if class::has_decorators(hir, hir[member].modifiers) {
                        self.push_task(slot_initialization(scope, slot), context);
                    }
                }
                ClassSlot::ClassObject
                | ClassSlot::ClassToken
                | ClassSlot::ComputedKey(_)
                | ClassSlot::StaticField(_)
                | ClassSlot::DecoratorState => {}
            }
        }
        self.push_task(Task::MarkCreated(static_initializer), context);
        for member in hir[class].members.iter() {
            let node = hir[member];
            if node.flags.contains(Flags::AMBIENT) {
                continue;
            }
            match node.kind {
                MemberKind::Property => {
                    if node.flags.contains(Flags::STATIC) {
                        self.push_field_initializer(member, static_initializer);
                    }
                }
                MemberKind::StaticBlock => self.visit_function(node.func, static_initializer),
                MemberKind::Method
                | MemberKind::Getter
                | MemberKind::Setter
                | MemberKind::Constructor
                | MemberKind::CallSignature
                | MemberKind::ConstructSignature
                | MemberKind::IndexSignature => {}
            }
        }
    }

    fn push_members(
        &mut self,
        class: ClassId,
        instance_initializer: WalkedFunctionId,
        slots: &[ClassSlot],
        context: Context,
    ) {
        let hir = self.hir;
        let scope = self.bound.class_scope[class.idx()];
        let has_token = has_slot(slots, ClassSlot::ClassToken);
        for member in hir[class].members.iter() {
            let node = hir[member];
            let key = hir.runtime_member_key(member);
            if let PropKey::Computed(expression) = key {
                self.push_expressions([expression], context);
            }
            let key_slot = ClassSlot::ComputedKey(member);
            if has_slot(slots, key_slot) {
                self.push_task(slot_initialization(scope, key_slot), context);
            }
            if node.flags.contains(Flags::AMBIENT) {
                continue;
            }
            let is_decorated = class::has_decorators(hir, node.modifiers);
            match hir.runtime_member_kind(member) {
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                    self.visit_function(node.func, context.function);
                    let slot = ClassSlot::PrivateMethod(member);
                    if !is_decorated && has_slot(slots, slot) {
                        self.push_task(slot_initialization(scope, slot), context);
                    }
                }
                MemberKind::Property => {
                    if !node.flags.contains(Flags::STATIC) {
                        self.push_field_initializer(member, instance_initializer);
                    }
                }
                _ => continue,
            }
            let is_decorated_private_member = is_decorated && matches!(key, PropKey::Private(_));
            if is_decorated_private_member || class::is_auto_accessor(hir, member) {
                self.add_accessor_functions(member, scope, has_token, context);
            }
        }
    }

    fn push_field_initializer(&mut self, member: MemberId, function: WalkedFunctionId) {
        let initializer = self.hir[member].init;
        let Some(scope) = self.bound.field_initializer_scope(member) else {
            debug_assert!(initializer.is_none());
            return;
        };
        let context = self.enter_unit(function, scope);
        self.walk.function_of_field.push((member, function));
        self.push_expressions([initializer], context);
    }

    fn add_accessor_functions(
        &mut self,
        member: MemberId,
        scope: ScopeId,
        has_token: bool,
        context: Context,
    ) {
        let file = self.input.file;
        let is_static = self.hir[member].flags.contains(Flags::STATIC);
        let is_private = matches!(self.hir.runtime_member_key(member), PropKey::Private(_));
        let brand = if is_static {
            Some(ClassSlot::ClassObject)
        } else {
            has_token.then_some(ClassSlot::ClassToken)
        };
        let has_static_storage = class::has_private_static_storage(self.hir, member);
        let storage = has_static_storage.then_some(ClassSlot::StaticField(member));
        let keys = [
            Some(FunctionKey::AccessorGetter { file, member }),
            Some(FunctionKey::AccessorSetter { file, member }),
            is_private.then_some(FunctionKey::PrivateNameTest { file, member }),
        ];
        for key in keys.into_iter().flatten() {
            let id = self.add_function(key, Some(context.function));
            self.push_task(Task::MarkCreated(id), context);
            for slot in brand.into_iter().chain(storage) {
                self.record_slot_use(id, scope, ScopeSlot::Class(slot));
            }
        }
    }
}
