use bun_sema::atom::known;
use bun_sema::hir::{ClassId, MemberId, PropKey};
use smallvec::SmallVec;

use super::{DecoratedKind, Decoration, DecorationGroup, StandardDecorationResult};
use crate::builtins::id::BuiltinId;
use crate::ir::{ClassSlot, PropertyKeyId, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::class::{self, AccessorFunction, ClassEvaluation, ClassPlan, find_member_value};
use crate::lower::member::{self, PropertyName};
use crate::lower::{call, function, layouts};

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

pub(in crate::lower) fn emit_standard_decorations(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ClassPlan,
    evaluation: &ClassEvaluation,
) -> StandardDecorationResult {
    if evaluation.class_decorators.is_none() && plan.decorations.is_empty() {
        return StandardDecorationResult::default();
    }
    let class_position = lowering.file.hir[evaluation.class].start;
    lowering.set_position(class_position);
    let base = match evaluation.heritage {
        Some(heritage) => heritage,
        None => lowering.builder.undefined(),
    };
    let metadata = call_helper(
        lowering,
        BuiltinId::CompilerHelpersCreateDecoratorMetadata,
        &[base],
    );
    let lists = emit_initializer_lists(lowering, plan, evaluation.class);
    let has_static_methods = plan
        .decorations
        .iter()
        .any(|decoration| decoration.group() == DecorationGroup::StaticMethod);
    let static_method_initializers = has_static_methods.then(|| emit_empty_list(lowering));
    let class_initializers = evaluation
        .class_decorators
        .map(|_| emit_empty_list(lowering));
    let context = DecorationContext {
        metadata,
        static_method_initializers,
        lists: &lists,
    };
    for &decoration in &plan.decorations {
        emit_decoration(lowering, plan, evaluation, &context, decoration);
    }
    lowering.set_position(class_position);
    let decorated_class = emit_class_decoration(lowering, evaluation, metadata, class_initializers);
    if let Some(initializers) = static_method_initializers {
        emit_initializer_run(lowering, initializers, evaluation.class_object);
    }
    StandardDecorationResult {
        decorated_class,
        class_initializers,
    }
}

pub(in crate::lower) fn emit_initializer_run(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    initializers: ValueId,
    receiver: ValueId,
) {
    let arguments = [initializers, receiver];
    call_helper(
        lowering,
        BuiltinId::CompilerHelpersRunInitializers,
        &arguments,
    );
}

pub(in crate::lower) fn emit_value_initializer_run(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    initializers: ValueId,
    receiver: ValueId,
    value: ValueId,
) -> ValueId {
    let arguments = [initializers, receiver, value];
    call_helper(
        lowering,
        BuiltinId::CompilerHelpersRunValueInitializers,
        &arguments,
    )
}

pub(in crate::lower) fn get_initializer_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    initializers: u32,
) -> ValueId {
    let state = class::get_class_slot(lowering, class, ClassSlot::DecoratorState);
    let index = lowering.builder.integer(i64::from(initializers));
    lowering.builder.elem_get(state, index)
}

fn call_helper(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    helper: BuiltinId,
    arguments: &[ValueId],
) -> ValueId {
    call::emit_builtin_call(lowering, helper, arguments)
}

fn emit_empty_list(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId {
    lowering.builder.new_array(TypeTable::ANYTHING, &[], &[])
}

fn emit_initializer_lists(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ClassPlan,
    class: ClassId,
) -> SmallVec<[ValueId; 8]> {
    let lists: SmallVec<[ValueId; 8]> = (0..plan.initializer_list_count)
        .map(|_| emit_empty_list(lowering))
        .collect();
    if !lists.is_empty() {
        let state = lowering.builder.new_array(TypeTable::ANYTHING, &[], &lists);
        class::set_class_slot(lowering, class, ClassSlot::DecoratorState, state);
    }
    lists
}

fn emit_class_decoration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    metadata: ValueId,
    class_initializers: Option<ValueId>,
) -> Option<ValueId> {
    let class_object = evaluation.class_object;
    let Some((decorators, initializers)) = evaluation.class_decorators.zip(class_initializers)
    else {
        let arguments = [class_object, metadata];
        call_helper(
            lowering,
            BuiltinId::CompilerHelpersSetDecoratorMetadata,
            &arguments,
        );
        return None;
    };
    let name = lowering.builder.string(evaluation.name);
    let arguments = [decorators, class_object, name, metadata, initializers];
    Some(call_helper(
        lowering,
        BuiltinId::CompilerHelpersApplyClassDecorators,
        &arguments,
    ))
}

fn emit_decoration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ClassPlan,
    evaluation: &ClassEvaluation,
    context: &DecorationContext<'_>,
    decoration: Decoration,
) {
    let member = decoration.member;
    let position = lowering.file.hir[member].name_pos;
    lowering.set_position(position);
    let decorators = find_member_value(&evaluation.member_decorators, member)
        .expect("class evaluation lists the decorators of every decorated member");
    let name = emit_element_name(lowering, evaluation, member);
    debug_assert_eq!(
        decoration.is_private,
        name.private_key.is_some(),
        "the plan and the tree agree on private names"
    );
    let element = DecoratedElement {
        decoration,
        decorators,
        element: emit_element(lowering, decoration, name.value),
        private_key: name.private_key,
    };
    match decoration.kind {
        DecoratedKind::Method | DecoratedKind::Getter | DecoratedKind::Setter => {
            emit_method_decoration(lowering, plan, evaluation, context, element);
        }
        DecoratedKind::Field => emit_field_decoration(lowering, context, element),
        DecoratedKind::Accessor => {
            emit_accessor_decoration(lowering, evaluation, context, element);
        }
    }
}

fn emit_element_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    member: MemberId,
) -> ElementName {
    let name = match lowering.file.hir.runtime_member_key(member) {
        PropKey::Private(name) => {
            let key = layouts::private_key(lowering.file, evaluation.layout, name);
            let text = member::find_key_text(lowering.file, key)
                .expect("the key of a private name has a text");
            return ElementName {
                value: lowering.builder.string(text),
                private_key: Some(key),
            };
        }
        PropKey::Name(name) => PropertyName::Constant(member::name_key(lowering.file, name)),
        PropKey::Computed(_) => find_member_value(&evaluation.member_names, member)
            .expect("class evaluation lists the name of every member with a computed key"),
        PropKey::None => {
            debug_assert!(false, "a decorated member has a key");
            let text = lowering.file.intern_bytes(b"");
            PropertyName::Constant(lowering.file.text_key(text))
        }
    };
    ElementName {
        value: member::emit_name_value(lowering, name),
        private_key: None,
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

fn emit_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    decoration: Decoration,
    name: ValueId,
) -> ValueId {
    let kind = lowering.file.intern_bytes(kind_text(decoration.kind));
    let kind = lowering.builder.string(kind);
    let is_static = lowering.builder.boolean(decoration.is_static);
    let is_private = lowering.builder.boolean(decoration.is_private);
    let arguments = [kind, name, is_static, is_private];
    call_helper(
        lowering,
        BuiltinId::CompilerHelpersCreateElement,
        &arguments,
    )
}

fn emit_holder(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    decoration: Decoration,
) -> ValueId {
    if decoration.is_static {
        return evaluation.class_object;
    }
    let prototype = member::name_key(lowering.file, known::prototype);
    let prototype = PropertyName::Constant(prototype);
    member::emit_get(lowering, evaluation.class_object, prototype)
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

fn emit_accessor_closure(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
    function: AccessorFunction,
) -> ValueId {
    let function = class::declare_accessor_function(lowering.file, member, function);
    function::emit_closure(lowering, function, None)
}

fn emit_private_storage(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    member: MemberId,
) -> ValueId {
    let test = emit_accessor_closure(lowering, member, AccessorFunction::PrivateNameTest);
    let get = emit_accessor_closure(lowering, member, AccessorFunction::Getter);
    let set = emit_accessor_closure(lowering, member, AccessorFunction::Setter);
    let arguments = [test, get, set];
    call_helper(
        lowering,
        BuiltinId::CompilerHelpersCreatePrivateStorage,
        &arguments,
    )
}

fn emit_method_decoration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
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
        let holder = emit_holder(lowering, evaluation, decoration);
        let arguments = [decorators, holder, element, metadata, initializers];
        call_helper(
            lowering,
            BuiltinId::CompilerHelpersApplyMethodDecorators,
            &arguments,
        );
        return;
    };
    let member = decoration.member;
    let source = lowering.file.hir[member].func;
    let name = PropertyName::Constant(key);
    let value = function::lower_method(lowering, source, name, evaluation.class_object);
    let test = emit_accessor_closure(lowering, member, AccessorFunction::PrivateNameTest);
    let arguments = [decorators, value, element, test, metadata, initializers];
    let result = call_helper(
        lowering,
        BuiltinId::CompilerHelpersApplyPrivateMethodDecorators,
        &arguments,
    );
    let slot = ClassSlot::PrivateMethod(member);
    class::set_class_slot(lowering, evaluation.class, slot, result);
}

fn emit_field_decoration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
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
            call_helper(
                lowering,
                BuiltinId::CompilerHelpersApplyFieldDecorators,
                &arguments,
            );
        }
        Some(_) => {
            let storage = emit_private_storage(lowering, decoration.member);
            let arguments = [decorators, element, storage, metadata, value, extra];
            call_helper(
                lowering,
                BuiltinId::CompilerHelpersApplyPrivateFieldDecorators,
                &arguments,
            );
        }
    }
}

fn emit_accessor_decoration(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
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
            let holder = emit_holder(lowering, evaluation, decoration);
            let arguments = [decorators, holder, element, metadata, value, extra];
            call_helper(
                lowering,
                BuiltinId::CompilerHelpersApplyAccessorDecorators,
                &arguments,
            );
        }
        Some(_) => {
            let member = decoration.member;
            let storage = emit_private_storage(lowering, member);
            let arguments = [decorators, element, storage, metadata, value, extra];
            let pair = call_helper(
                lowering,
                BuiltinId::CompilerHelpersApplyPrivateAccessorDecorators,
                &arguments,
            );
            let slot = ClassSlot::PrivateMethod(member);
            class::set_class_slot(lowering, evaluation.class, slot, pair);
        }
    }
}
