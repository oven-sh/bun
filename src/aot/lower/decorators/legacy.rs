use bun_sema::atom::known;
use bun_sema::bind::decorator_metadata::is_legacy_decorated_member;
use bun_sema::hir::{self, ClassId, Flags, FnId, MemberId, MemberKind, ModifierId, PropKey, Span};
use smallvec::SmallVec;

use super::metadata::{emit_constructor_metadata, emit_member_metadata};
use crate::builtins::id::BuiltinId;
use crate::ir::{TypeTable, ValueId};
use crate::lower::class::{
    ClassElement, ClassEvaluation, ClassPlan, FieldValue, decorators_of, find_member_value,
    has_decorators, is_auto_accessor,
};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, call, expression};

type DecoratorList = SmallVec<[ValueId; 8]>;

fn is_method_or_accessor(kind: MemberKind) -> bool {
    match kind {
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter => true,
        MemberKind::Property
        | MemberKind::Constructor
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature
        | MemberKind::StaticBlock => false,
    }
}

fn is_moved_field(hir: &hir::File<'_>, member: MemberId) -> bool {
    let field = hir[member];
    let has_private_key = match hir.runtime_member_key(member) {
        PropKey::Private(_) => true,
        PropKey::None | PropKey::Name(_) | PropKey::Computed(_) => false,
    };
    field.kind == MemberKind::Property
        && !is_auto_accessor(hir, member)
        && !has_private_key
        && has_decorators(hir, field.modifiers)
}

fn move_fields_to_end(elements: &mut Vec<ClassElement>, hir: &hir::File<'_>) {
    let mut assigned = SmallVec::<[ClassElement; 4]>::new();
    elements.retain(|element| {
        let ClassElement::Field { member, value } = *element else {
            return true;
        };
        if !is_moved_field(hir, member) {
            return true;
        }
        match value {
            FieldValue::Initializer => assigned.push(ClassElement::AssignedField { member }),
            FieldValue::Undefined => {}
            FieldValue::Decorated { .. } => {
                unreachable!("only standard decorators plan a decorated field")
            }
        }
        false
    });
    elements.extend(assigned);
}

pub(in crate::lower) fn has_legacy_decorators(hir: &hir::File<'_>, class: ClassId) -> bool {
    let mut members = hir[class].members.iter();
    has_decorators(hir, hir[class].modifiers)
        || members.any(|member| is_legacy_decorated_member(hir, member))
}

pub(in crate::lower) fn move_decorated_fields(hir: &hir::File<'_>, plan: &mut ClassPlan) {
    move_fields_to_end(&mut plan.instance_elements, hir);
    move_fields_to_end(&mut plan.static_elements, hir);
}

pub(in crate::lower) fn apply_legacy_decorators(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    plan: &ClassPlan,
    evaluation: &ClassEvaluation,
) -> Option<ValueId> {
    let hir = lowering.file.hir;
    let class = evaluation.class;
    let is_static = |member: &MemberId| hir[*member].flags.contains(Flags::STATIC);
    let decorated_members = hir[class].members.iter().filter(|&member| {
        is_legacy_decorated_member(hir, member)
            && hir.runtime_member_kind(member) != MemberKind::Constructor
    });
    for member in decorated_members
        .clone()
        .filter(|member| !is_static(member))
    {
        decorate_member(lowering, evaluation, member);
    }
    for member in decorated_members.filter(is_static) {
        decorate_member(lowering, evaluation, member);
    }

    let mut list = DecoratorList::new();
    lower_decorator_list(lowering, hir[class].modifiers, &mut list);
    if let Some(constructor) = plan.constructor {
        lower_parameter_decorators(lowering, constructor, &mut list);
    }
    if list.is_empty() {
        return None;
    }
    lowering.set_position(hir[class].name_pos);
    if let Some(constructor) = plan.constructor
        && lowering.file.compiled.settings.emits_decorator_metadata
    {
        list.push(emit_constructor_metadata(lowering, class, constructor));
    }
    let decorators = lowering.builder.new_array(TypeTable::ANYTHING, &[], &list);
    let arguments = [decorators, evaluation.class_object];
    let helper = BuiltinId::CompilerHelpersDecorateClass;
    Some(call::emit_builtin_call(lowering, helper, &arguments))
}

fn decorate_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    member: MemberId,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    let is_method_or_accessor = is_method_or_accessor(node.kind);

    let mut list = DecoratorList::new();
    lower_decorator_list(lowering, node.modifiers, &mut list);
    if is_method_or_accessor {
        lower_parameter_decorators(lowering, node.func, &mut list);
    }
    debug_assert!(!list.is_empty(), "decorate_member takes a decorated member");
    lowering.set_position(node.name_pos);
    if lowering.file.compiled.settings.emits_decorator_metadata {
        emit_member_metadata(lowering, evaluation.class, member, &mut list);
    }

    let decorators = lowering.builder.new_array(TypeTable::ANYTHING, &[], &list);
    let class_object = evaluation.class_object;
    let target = if node.flags.contains(Flags::STATIC) {
        class_object
    } else {
        let prototype = member::name_key(lowering.file, known::prototype);
        member::emit_get(lowering, class_object, PropertyName::Constant(prototype))
    };
    let key = emit_member_key(lowering, evaluation, member);
    let helper = if is_method_or_accessor {
        BuiltinId::CompilerHelpersDecorateMethod
    } else {
        BuiltinId::CompilerHelpersDecorateProperty
    };
    call::emit_builtin_call(lowering, helper, &[decorators, target, key]);
}

fn lower_decorator_list(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    modifiers: Span<ModifierId>,
    list: &mut DecoratorList,
) {
    let hir = lowering.file.hir;
    for decorator in decorators_of(hir, modifiers) {
        list.push(expression::lower_expression(lowering, decorator));
    }
}

fn lower_parameter_decorators(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
    list: &mut DecoratorList,
) {
    let hir = lowering.file.hir;
    for (index, parameter) in hir[function].params.iter().enumerate() {
        for decorator in decorators_of(hir, hir.param_modifiers(parameter)) {
            let index = lowering.builder.integer(index as i64);
            let decorator = expression::lower_expression(lowering, decorator);
            let helper = BuiltinId::CompilerHelpersDecorateParameter;
            list.push(call::emit_builtin_call(
                lowering,
                helper,
                &[index, decorator],
            ));
        }
    }
}

fn emit_member_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    evaluation: &ClassEvaluation,
    member: MemberId,
) -> ValueId {
    let name = match find_member_value(&evaluation.member_names, member) {
        Some(name) => name,
        None => {
            let key = lowering.file.hir.runtime_member_key(member);
            member::lower_property_name(lowering, key)
        }
    };
    member::emit_name_value(lowering, name)
}
