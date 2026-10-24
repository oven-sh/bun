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

#[derive(Copy, Clone)]
struct ElementName {
    value: ValueId,
    private_key: Option<PropertyKeyId>,
}

#[derive(Copy, Clone)]
struct DecoratedElement {
    decoration: Decoration,
    decorators: ValueId,
    element: ValueId,
    private_key: Option<PropertyKeyId>,
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
        let metadata = self.call_helper(BuiltinId::CompilerHelpersCreateDecoratorMetadata, &[base]);
        let lists = self.emit_initializer_lists(plan, evaluation.class);
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
        let decorated_class = self.emit_class_decoration(evaluation, metadata, class_initializers);
        if let Some(initializers) = static_method_initializers {
            self.emit_initializer_run(initializers, evaluation.class_object);
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
        self.call_helper(BuiltinId::CompilerHelpersRunInitializers, &arguments);
    }

    pub(in crate::lower) fn emit_value_initializer_run(
        &mut self,
        initializers: ValueId,
        receiver: ValueId,
        value: ValueId,
    ) -> ValueId {
        let arguments = [initializers, receiver, value];
        self.call_helper(BuiltinId::CompilerHelpersRunValueInitializers, &arguments)
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

    fn call_helper(&mut self, helper: BuiltinId, arguments: &[ValueId]) -> ValueId {
        self.emit_builtin_call(helper, arguments)
    }

    fn emit_empty_list(&mut self) -> ValueId {
        self.builder.new_array(TypeTable::ANYTHING, &[], &[])
    }

    fn emit_initializer_lists(
        &mut self,
        plan: &ClassPlan,
        class: ClassId,
    ) -> SmallVec<[ValueId; 8]> {
        let lists: SmallVec<[ValueId; 8]> = (0..plan.initializer_list_count)
            .map(|_| self.emit_empty_list())
            .collect();
        if !lists.is_empty() {
            let state = self.builder.new_array(TypeTable::ANYTHING, &[], &lists);
            self.set_class_slot(class, ClassSlot::DecoratorState, state);
        }
        lists
    }

    fn emit_class_decoration(
        &mut self,
        evaluation: &ClassEvaluation,
        metadata: ValueId,
        class_initializers: Option<ValueId>,
    ) -> Option<ValueId> {
        let class_object = evaluation.class_object;
        let Some((decorators, initializers)) = evaluation.class_decorators.zip(class_initializers)
        else {
            let arguments = [class_object, metadata];
            self.call_helper(BuiltinId::CompilerHelpersSetDecoratorMetadata, &arguments);
            return None;
        };
        let name = self.builder.string(evaluation.name);
        let arguments = [decorators, class_object, name, metadata, initializers];
        Some(self.call_helper(BuiltinId::CompilerHelpersApplyClassDecorators, &arguments))
    }

    fn emit_decoration(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
        context: &DecorationContext<'_>,
        decoration: Decoration,
    ) {
        let member = decoration.member;
        let position = self.file.hir[member].name_pos;
        self.set_position(position);
        let decorators = find_member_value(&evaluation.member_decorators, member)
            .expect("class evaluation lists the decorators of every decorated member");
        let name = self.emit_element_name(evaluation, member);
        debug_assert_eq!(
            decoration.is_private,
            name.private_key.is_some(),
            "the plan and the tree agree on private names"
        );
        let element = DecoratedElement {
            decoration,
            decorators,
            element: self.emit_element(decoration, name.value),
            private_key: name.private_key,
        };
        match decoration.kind {
            DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter => {
                self.emit_method_decoration(plan, evaluation, context, element);
            }
            DecoratedKind::Field => self.emit_field_decoration(context, element),
            DecoratedKind::Accessor => {
                self.emit_accessor_decoration(evaluation, context, element);
            }
        }
    }

    fn emit_element_name(&mut self, evaluation: &ClassEvaluation, member: MemberId) -> ElementName {
        let name = match self.file.hir.runtime_member_key(member) {
            PropKey::Private(name) => {
                let key = layouts::private_key(self.file, evaluation.layout, name);
                let text = self
                    .file
                    .find_key_text(key)
                    .expect("the key of a private name has a text");
                return ElementName {
                    value: self.builder.string(text),
                    private_key: Some(key),
                };
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
        ElementName {
            value: self.emit_name_value(name),
            private_key: None,
        }
    }

    fn emit_element(&mut self, decoration: Decoration, name: ValueId) -> ValueId {
        let kind = self.file.intern_bytes(kind_text(decoration.kind));
        let kind = self.builder.string(kind);
        let is_static = self.builder.boolean(decoration.is_static);
        let is_private = self.builder.boolean(decoration.is_private);
        let arguments = [kind, name, is_static, is_private];
        self.call_helper(BuiltinId::CompilerHelpersCreateElement, &arguments)
    }

    fn emit_holder(&mut self, evaluation: &ClassEvaluation, decoration: Decoration) -> ValueId {
        if decoration.is_static {
            return evaluation.class_object;
        }
        let prototype = self.file.name_key(known::prototype);
        let prototype = PropertyName::Constant(prototype);
        self.emit_get(evaluation.class_object, prototype)
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
        self.call_helper(BuiltinId::CompilerHelpersCreatePrivateStorage, &arguments)
    }

    fn emit_method_decoration(
        &mut self,
        plan: &ClassPlan,
        evaluation: &ClassEvaluation,
        context: &DecorationContext<'_>,
        decorated: DecoratedElement,
    ) {
        let DecoratedElement {
            decoration,
            decorators,
            element,
            private_key,
        } = decorated;
        let metadata = context.metadata;
        let initializers = find_method_initializers(plan, context, decoration);
        let Some(key) = private_key else {
            let holder = self.emit_holder(evaluation, decoration);
            let arguments = [decorators, holder, element, metadata, initializers];
            self.call_helper(BuiltinId::CompilerHelpersApplyMethodDecorators, &arguments);
            return;
        };
        let member = decoration.member;
        let source = self.file.hir[member].func;
        let name = PropertyName::Constant(key);
        let value = self.lower_method(source, name, evaluation.class_object);
        let test = self.emit_accessor_closure(member, AccessorFunction::PrivateNameTest);
        let arguments = [decorators, value, element, test, metadata, initializers];
        let result = self.call_helper(
            BuiltinId::CompilerHelpersApplyPrivateMethodDecorators,
            &arguments,
        );
        let slot = ClassSlot::PrivateMethod(member);
        self.set_class_slot(evaluation.class, slot, result);
    }

    fn emit_field_decoration(
        &mut self,
        context: &DecorationContext<'_>,
        decorated: DecoratedElement,
    ) {
        let DecoratedElement {
            decoration,
            decorators,
            element,
            private_key,
        } = decorated;
        let metadata = context.metadata;
        let [value, extra] = find_value_initializers(context, decoration);
        match private_key {
            None => {
                let arguments = [decorators, element, metadata, value, extra];
                self.call_helper(BuiltinId::CompilerHelpersApplyFieldDecorators, &arguments);
            }
            Some(_) => {
                let storage = self.emit_private_storage(decoration.member);
                let arguments = [decorators, element, storage, metadata, value, extra];
                self.call_helper(
                    BuiltinId::CompilerHelpersApplyPrivateFieldDecorators,
                    &arguments,
                );
            }
        }
    }

    fn emit_accessor_decoration(
        &mut self,
        evaluation: &ClassEvaluation,
        context: &DecorationContext<'_>,
        decorated: DecoratedElement,
    ) {
        let DecoratedElement {
            decoration,
            decorators,
            element,
            private_key,
        } = decorated;
        let metadata = context.metadata;
        let [value, extra] = find_value_initializers(context, decoration);
        match private_key {
            None => {
                let holder = self.emit_holder(evaluation, decoration);
                let arguments = [decorators, holder, element, metadata, value, extra];
                self.call_helper(
                    BuiltinId::CompilerHelpersApplyAccessorDecorators,
                    &arguments,
                );
            }
            Some(_) => {
                let member = decoration.member;
                let storage = self.emit_private_storage(member);
                let arguments = [decorators, element, storage, metadata, value, extra];
                let pair = self.call_helper(
                    BuiltinId::CompilerHelpersApplyPrivateAccessorDecorators,
                    &arguments,
                );
                let slot = ClassSlot::PrivateMethod(member);
                self.set_class_slot(evaluation.class, slot, pair);
            }
        }
    }
}

fn kind_text(kind: DecoratedKind) -> &'static [u8] {
    match kind {
        DecoratedKind::Method => b"method",
        DecoratedKind::Getter => b"getter",
        DecoratedKind::Setter => b"setter",
        DecoratedKind::Accessor => b"accessor",
        DecoratedKind::Field => b"field",
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
