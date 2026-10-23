use bun_sema::bind::ScopeId;
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ClassId, Flags, FnId, MemberId, MemberKind, PropKey};
use bun_sema::util::SharedSort;

use super::walker::{bindings_of, entries_of};
use super::{Context, Task, WalkedFunctionId, Walker};
use crate::ir::{ClassSlot, FunctionKey};
use crate::lower::class;
use crate::lower::scope::ScopeSlot;

#[derive(Copy, Clone)]
struct ClassFunctions {
    constructor: WalkedFunctionId,
    instance_initializer: WalkedFunctionId,
    static_initializer: WalkedFunctionId,
}

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
        let source_constructor = self.find_source_constructor(class);
        let functions = self.add_class_functions(class, source_constructor, context.function);
        self.enter_scope(bound.symbol_scope(inner_name), context);
        self.enter_scope(scope, context);
        self.record_class_uses(class, functions, &slots, context);

        for &(_, decorator) in entries_of(&self.class_decorators, class) {
            self.stack.push((Task::Expression(decorator), context));
        }
        self.push_expressions([hir[class].extends], context);
        if has_slot(&slots, ClassSlot::ClassToken) {
            self.push_task(slot_initialization(scope, ClassSlot::ClassToken), context);
        }
        self.push_task(Task::MarkCreated(functions.constructor), context);
        self.push_task(Task::MarkCreated(functions.instance_initializer), context);
        if let Some(function) = source_constructor {
            let top_scope = bound.fns[function.idx()].scope;
            self.record_slot_use(functions.constructor, top_scope, ScopeSlot::This);
            self.push_function_code(function, functions.constructor);
        }
        self.push_task(slot_initialization(scope, ClassSlot::ClassObject), context);
        self.push_members(class, functions, &slots, context);
        let initialize_inner_name = Task::InitializeSymbol {
            symbol: inner_name,
            precedes_hoisted_functions: false,
        };
        self.push_task(initialize_inner_name, context);
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
        self.push_static_members(class, functions, context);
    }

    fn find_source_constructor(&self, class: ClassId) -> Option<FnId> {
        let hir = self.hir;
        let constructor = hir[class].members.iter().find(|&member| {
            hir.runtime_member_kind(member) == MemberKind::Constructor
                && self.is_live_function(hir[member].func)
        });
        constructor.map(|member| hir[member].func)
    }

    fn add_class_functions(
        &mut self,
        class: ClassId,
        source_constructor: Option<FnId>,
        creator: WalkedFunctionId,
    ) -> ClassFunctions {
        let file = self.input.file;
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
        ClassFunctions {
            constructor,
            instance_initializer,
            static_initializer,
        }
    }

    fn record_class_uses(
        &mut self,
        class: ClassId,
        functions: ClassFunctions,
        slots: &[ClassSlot],
        context: Context,
    ) {
        let scope = self.bound.class_scope[class.idx()];
        let instance_initializer = Some(functions.instance_initializer);
        let static_initializer = Some(functions.static_initializer);
        for binding in bindings_of(&self.metadata_uses, class) {
            self.record_binding_use(context, binding, false);
        }
        for &slot in slots {
            let users = match slot {
                ClassSlot::ClassToken => [instance_initializer, None],
                ClassSlot::ComputedKey(_) | ClassSlot::DecoratorState => {
                    [instance_initializer, static_initializer]
                }
                ClassSlot::ClassObject | ClassSlot::StaticField(_) => [None, static_initializer],
                ClassSlot::PrivateMethod(_) => [None, None],
            };
            for user in users.into_iter().flatten() {
                self.record_slot_use(user, scope, ScopeSlot::Class(slot));
            }
        }
    }

    fn push_members(
        &mut self,
        class: ClassId,
        functions: ClassFunctions,
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
                    if let Some(id) = self.declare_function(node.func, context.function) {
                        self.push_function(node.func, id);
                    }
                    let slot = ClassSlot::PrivateMethod(member);
                    if !is_decorated && has_slot(slots, slot) {
                        self.push_task(slot_initialization(scope, slot), context);
                    }
                }
                MemberKind::Property => {
                    if !node.flags.contains(Flags::STATIC) {
                        self.push_field_initializer(member, functions.instance_initializer);
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

    fn push_static_members(&mut self, class: ClassId, functions: ClassFunctions, context: Context) {
        let hir = self.hir;
        let initializer = functions.static_initializer;
        self.push_task(Task::MarkCreated(initializer), context);
        for member in hir[class].members.iter() {
            let node = hir[member];
            if node.flags.contains(Flags::AMBIENT) {
                continue;
            }
            match node.kind {
                MemberKind::Property => {
                    if node.flags.contains(Flags::STATIC) {
                        self.push_field_initializer(member, initializer);
                    }
                }
                MemberKind::StaticBlock => {
                    if let Some(id) = self.declare_function(node.func, initializer) {
                        self.push_function(node.func, id);
                    }
                }
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

    fn push_field_initializer(&mut self, member: MemberId, function: WalkedFunctionId) {
        let initializer = self.hir[member].init;
        let Some(scope) = self.bound.field_initializer_scope(member) else {
            debug_assert!(initializer.is_none());
            return;
        };
        let context = Context {
            function,
            lexical_scope: self.input.lexical_owners[scope.idx()],
            enclosing_loop: None,
            is_repeated: true,
            is_conditional: false,
        };
        self.enter_scope(scope, context);
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
