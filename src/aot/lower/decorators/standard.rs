use bun_sema::atom::known;
use bun_sema::hir::{ClassId, MemberId, PropKey};
use smallvec::SmallVec;

use super::{DecoratedKind, Decoration, DecorationGroup, StandardDecorationResult};
use crate::builtins::id::BuiltinId;
use crate::ir::{ClassSlot, PropertyKeyId, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::class::{self, AccessorFunction, ClassEvaluation, ClassPlan, find_member_value};
use crate::lower::layouts;
use crate::lower::member::PropertyName;

struct DecorationContext<'l> {
    metadata: ValueId,
    static_method_initializers: Option<ValueId>,
    lists: &'l [ValueId],
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn emit_standard_decorations(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
    ) -> StandardDecorationResult {
        if evaluation.class_decorators.is_none() && plan.decorations.is_empty() {
            return StandardDecorationResult::default();
        }
        let class_position = self.file.hir[evaluation.class].start;
        self.set_position(class_position);
        let base = match evaluation.heritage {
            Some(heritage) => heritage,
            None => self.builder.undefined(),
        };
        let helper = BuiltinId::CompilerHelpersCreateDecoratorMetadata;
        let metadata = self.emit_builtin_call(helper, &[base]);
        let lists: SmallVec<[ValueId; 8]> = (0..plan.initializer_list_count)
            .map(|_| self.emit_empty_list())
            .collect();
        if !lists.is_empty() {
            let state = self.builder.new_array(TypeTable::ANYTHING, &[], &lists);
            self.set_class_slot(evaluation.class, ClassSlot::DecoratorState, state);
        }
        let has_static_methods = plan
            .decorations
            .iter()
            .any(|decoration| decoration.group() == DecorationGroup::StaticMethod);
        let static_method_initializers = has_static_methods.then(|| self.emit_empty_list());
        let class_initializers = evaluation.class_decorators.map(|_| self.emit_empty_list());
        let context = DecorationContext {
            metadata,
            static_method_initializers,
            lists: &lists,
        };
        for &decoration in &plan.decorations {
            self.emit_decoration(plan, evaluation, &context, decoration);
        }
        self.set_position(class_position);
        let class_object = evaluation.class_object;
        let decorated_class = match evaluation.class_decorators.zip(class_initializers) {
            Some((decorators, initializers)) => {
                let name = self.builder.string(evaluation.name);
                let arguments = [decorators, class_object, name, metadata, initializers];
                let helper = BuiltinId::CompilerHelpersApplyClassDecorators;
                Some(self.emit_builtin_call(helper, &arguments))
            }
            None => {
                let arguments = [class_object, metadata];
                self.emit_builtin_call(BuiltinId::CompilerHelpersSetDecoratorMetadata, &arguments);
                None
            }
        };
        if let Some(initializers) = static_method_initializers {
            self.emit_initializer_run(initializers, class_object);
        }
        StandardDecorationResult {
            decorated_class,
            class_initializers,
        }
    }

    pub(in crate::lower) fn emit_initializer_run(
        &mut self,
        initializers: ValueId,
        receiver: ValueId,
    ) {
        let arguments = [initializers, receiver];
        self.emit_builtin_call(BuiltinId::CompilerHelpersRunInitializers, &arguments);
    }

    pub(in crate::lower) fn get_initializer_list(
        &mut self,
        class: ClassId,
        initializers: u32,
    ) -> ValueId {
        let state = self.get_class_slot(class, ClassSlot::DecoratorState);
        let index = self.builder.integer(i64::from(initializers));
        self.builder.elem_get(state, index)
    }

    fn emit_empty_list(&mut self) -> ValueId {
        self.builder.new_array(TypeTable::ANYTHING, &[], &[])
    }

    fn emit_decoration(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
        context: &DecorationContext<'_>,
        decoration: Decoration,
    ) {
        let member = decoration.member;
        self.set_position(self.file.hir[member].name_pos);
        let decorators = find_member_value(&evaluation.member_decorators, member)
            .expect("class evaluation lists the decorators of every decorated member");
        let (name, private_key) = self.emit_element_name(evaluation, member);
        debug_assert_eq!(
            decoration.is_private,
            private_key.is_some(),
            "the plan and the tree agree on private names"
        );
        let kind: &[u8] = match decoration.kind {
            DecoratedKind::Method => b"method",
            DecoratedKind::Getter => b"getter",
            DecoratedKind::Setter => b"setter",
            DecoratedKind::Accessor => b"accessor",
            DecoratedKind::Field => b"field",
        };
        let kind = self.file.intern_bytes(kind);
        let kind = self.builder.string(kind);
        let is_static = self.builder.boolean(decoration.is_static);
        let is_private = self.builder.boolean(decoration.is_private);
        let arguments = [kind, name, is_static, is_private];
        let element = self.emit_builtin_call(BuiltinId::CompilerHelpersCreateElement, &arguments);
        let class_object = evaluation.class_object;
        let metadata = context.metadata;
        let slot = ClassSlot::PrivateMethod(member);
        match (decoration.kind, private_key) {
            (DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter, None) => {
                let initializers = find_method_initializers(plan, context, decoration);
                let holder = self.emit_holder(class_object, decoration.is_static);
                let arguments = [decorators, holder, element, metadata, initializers];
                self.emit_builtin_call(BuiltinId::CompilerHelpersApplyMethodDecorators, &arguments);
            }
            (DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter, Some(key)) => {
                let initializers = find_method_initializers(plan, context, decoration);
                let source = self.file.hir[member].func;
                let value = self.lower_method(source, PropertyName::Constant(key), class_object);
                let test = self.emit_accessor_closure(member, AccessorFunction::PrivateNameTest);
                let arguments = [decorators, value, element, test, metadata, initializers];
                let helper = BuiltinId::CompilerHelpersApplyPrivateMethodDecorators;
                let result = self.emit_builtin_call(helper, &arguments);
                self.set_class_slot(evaluation.class, slot, result);
            }
            (DecoratedKind::Field, None) => {
                let [value, extra] = find_value_initializers(context, decoration);
                let arguments = [decorators, element, metadata, value, extra];
                self.emit_builtin_call(BuiltinId::CompilerHelpersApplyFieldDecorators, &arguments);
            }
            (DecoratedKind::Field, Some(_)) => {
                let [value, extra] = find_value_initializers(context, decoration);
                let storage = self.emit_private_storage(member);
                let arguments = [decorators, element, storage, metadata, value, extra];
                let helper = BuiltinId::CompilerHelpersApplyPrivateFieldDecorators;
                self.emit_builtin_call(helper, &arguments);
            }
            (DecoratedKind::Accessor, None) => {
                let [value, extra] = find_value_initializers(context, decoration);
                let holder = self.emit_holder(class_object, decoration.is_static);
                let arguments = [decorators, holder, element, metadata, value, extra];
                let helper = BuiltinId::CompilerHelpersApplyAccessorDecorators;
                self.emit_builtin_call(helper, &arguments);
            }
            (DecoratedKind::Accessor, Some(_)) => {
                let [value, extra] = find_value_initializers(context, decoration);
                let storage = self.emit_private_storage(member);
                let arguments = [decorators, element, storage, metadata, value, extra];
                let helper = BuiltinId::CompilerHelpersApplyPrivateAccessorDecorators;
                let pair = self.emit_builtin_call(helper, &arguments);
                self.set_class_slot(evaluation.class, slot, pair);
            }
        }
    }

    fn emit_element_name(
        &mut self,
        evaluation: &ClassEvaluation,
        member: MemberId,
    ) -> (ValueId, Option<PropertyKeyId>) {
        let name = match self.file.hir.runtime_member_key(member) {
            PropKey::Private(name) => {
                let key = layouts::private_key(self.file, evaluation.layout, name);
                let text = self
                    .file
                    .find_key_text(key)
                    .expect("the key of a private name has a text");
                return (self.builder.string(text), Some(key));
            }
            PropKey::Name(name) => PropertyName::Constant(self.file.name_key(name)),
            PropKey::Computed(_) => find_member_value(&evaluation.member_names, member)
                .expect("class evaluation lists the name of every member with a computed key"),
            PropKey::None => {
                debug_assert!(false, "a decorated member has a key");
                let text = self.file.intern_bytes(b"");
                PropertyName::Constant(self.file.text_key(text))
            }
        };
        (self.emit_name_value(name), None)
    }

    pub(super) fn emit_holder(&mut self, class_object: ValueId, is_static: bool) -> ValueId {
        if is_static {
            return class_object;
        }
        let prototype = self.file.name_key(known::prototype);
        self.emit_get(class_object, PropertyName::Constant(prototype))
    }

    fn emit_accessor_closure(&mut self, member: MemberId, function: AccessorFunction) -> ValueId {
        let function = class::declare_accessor_function(self.file, member, function);
        self.emit_closure(function, None)
    }

    fn emit_private_storage(&mut self, member: MemberId) -> ValueId {
        let test = self.emit_accessor_closure(member, AccessorFunction::PrivateNameTest);
        let get = self.emit_accessor_closure(member, AccessorFunction::Getter);
        let set = self.emit_accessor_closure(member, AccessorFunction::Setter);
        let arguments = [test, get, set];
        self.emit_builtin_call(BuiltinId::CompilerHelpersCreatePrivateStorage, &arguments)
    }
}

fn find_method_initializers(
    plan: &ClassPlan,
    context: &DecorationContext<'_>,
    decoration: Decoration,
) -> ValueId {
    if decoration.is_static {
        return context
            .static_method_initializers
            .expect("a decorated static method has a list of initializers");
    }
    let index = plan
        .instance_method_initializers
        .expect("the plan numbers the initializers of decorated instance methods");
    context.lists[index as usize]
}

fn find_value_initializers(
    context: &DecorationContext<'_>,
    decoration: Decoration,
) -> [ValueId; 2] {
    let initializers = decoration
        .initializers
        .expect("the plan numbers the initializers of a decorated field or accessor");
    [
        context.lists[initializers.value as usize],
        context.lists[initializers.extra as usize],
    ]
}
