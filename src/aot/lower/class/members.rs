use bun_sema::atom::known;
use bun_sema::hir::{ClassId, Flags, Member, MemberId, MemberKind, ModifierId, PropKey, Span};
use smallvec::SmallVec;

use super::{
    AccessorFunction, ClassPlan, ClassTransform, declare_accessor_function, decorators_of,
    has_decorators, is_declaration_only, runtime_members, set_class_slot,
};
use crate::ir::generated::{ClassSide, MethodKind, RuntimeErrorKind};
use crate::ir::{ClassSlot, Edge, LayoutId, TypeTable, ValueId};
use crate::lower::member::{self, PropertyName};
use crate::lower::{FunctionLowering, exception, expression, function, layouts};

#[derive(Default)]
pub(super) struct MemberValues {
    pub(super) decorators: SmallVec<[(MemberId, ValueId); 4]>,
    pub(super) names: SmallVec<[(MemberId, PropertyName); 4]>,
}

#[derive(Copy, Clone)]
pub(super) struct ClassHead {
    pub(super) class: ClassId,
    pub(super) layout: LayoutId,
    pub(super) value: ValueId,
}

pub(super) fn emit_decorator_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    modifiers: Span<ModifierId>,
) -> ValueId {
    let mut decorators: SmallVec<[ValueId; 4]> = SmallVec::new();
    for decorator in decorators_of(lowering.file.hir, modifiers) {
        decorators.push(expression::lower_expression(lowering, decorator));
    }
    lowering
        .builder
        .new_array(TypeTable::ANYTHING, &[], &decorators)
}

pub(super) fn define_members(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    plan: &ClassPlan,
) -> MemberValues {
    let hir = lowering.file.hir;
    let is_standard = plan.transform == ClassTransform::Standard;
    let mut values = MemberValues::default();
    let mut next_method_index = 0;
    for member in runtime_members(hir, head.class) {
        let modifiers = hir[member].modifiers;
        if is_standard && has_decorators(hir, modifiers) {
            let decorators = emit_decorator_array(lowering, modifiers);
            values.decorators.push((member, decorators));
        }
        if let Some(name) = lower_member_name(lowering, head, member, &mut values) {
            define_member(lowering, head, plan, member, name, &mut next_method_index);
        }
    }
    values
}

fn lower_member_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    member: MemberId,
    values: &mut MemberValues,
) -> Option<PropertyName> {
    let key = lowering.file.hir.runtime_member_key(member);
    match key {
        PropKey::Name(name) => {
            let key = member::name_key(lowering.file, name);
            Some(PropertyName::Constant(key))
        }
        PropKey::Computed(_) => {
            let name = member::lower_property_name(lowering, key);
            values.names.push((member, name));
            Some(name)
        }
        PropKey::Private(name) => {
            let key = layouts::private_key(lowering.file, head.layout, name);
            Some(PropertyName::Constant(key))
        }
        PropKey::None => None,
    }
}

fn define_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    plan: &ClassPlan,
    member: MemberId,
    name: PropertyName,
    next_method_index: &mut u32,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    let key = hir.runtime_member_key(member);
    let is_private = matches!(key, PropKey::Private(_));
    match hir.runtime_member_kind(member) {
        MemberKind::Property if is_declaration_only(node) => {}
        MemberKind::Property if node.flags.contains(Flags::ACCESSOR) => {
            if !is_private {
                define_accessor_pair(lowering, head, member, name, next_method_index);
            }
        }
        MemberKind::Property => {
            lowering.set_position(node.name_pos);
            if is_static_field(node) {
                check_static_field_key(lowering, name);
            }
            if matches!(key, PropKey::Computed(_)) {
                record_field_key(lowering, head.class, member, name);
            }
        }
        MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
            if is_private {
                create_private_function(lowering, head, plan, member, name);
            } else {
                define_method(lowering, head, member, name, next_method_index);
            }
        }
        MemberKind::Constructor
        | MemberKind::StaticBlock
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature => {}
    }
}

fn is_static_field(node: Member) -> bool {
    node.kind == MemberKind::Property
        && node.flags.contains(Flags::STATIC)
        && !node.flags.contains(Flags::ACCESSOR)
        && !is_declaration_only(node)
}

fn check_static_field_key(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, name: PropertyName) {
    match name {
        PropertyName::Constant(key) => {
            if key == member::name_key(lowering.file, known::prototype) {
                let error = RuntimeErrorKind::StaticPrototypeKey;
                exception::emit_throw_runtime_error(lowering, error, None);
            }
        }
        PropertyName::Computed(value) => {
            let prototype = lowering.file.intern_atom(known::prototype);
            let prototype = lowering.builder.string(prototype);
            let is_prototype = lowering.builder.strict_eq(value, prototype);
            let invalid = lowering.create_unlikely_block();
            let valid = lowering.create_block();
            lowering
                .builder
                .branch(is_prototype, Edge::to(invalid), Edge::to(valid));
            lowering.continue_in(invalid);
            let error = RuntimeErrorKind::StaticPrototypeKey;
            exception::emit_throw_runtime_error(lowering, error, None);
            lowering.continue_in(valid);
        }
    }
}

fn record_field_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    class: ClassId,
    member: MemberId,
    name: PropertyName,
) {
    match name {
        PropertyName::Constant(key) => {
            lowering.file.classes.constant_keys.insert(member, key);
        }
        PropertyName::Computed(_) => {}
    }
    let value = member::emit_name_value(lowering, name);
    set_class_slot(lowering, class, ClassSlot::ComputedKey(member), value);
}

fn class_side(node: Member) -> ClassSide {
    if node.flags.contains(Flags::STATIC) {
        ClassSide::Static
    } else {
        ClassSide::Prototype
    }
}

struct MethodDefinition {
    side: ClassSide,
    kind: MethodKind,
    name: PropertyName,
    closure: ValueId,
}

#[allow(clippy::needless_pass_by_value)] // made for this call
fn emit_method_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    definition: MethodDefinition,
    next_method_index: &mut u32,
) {
    let (computed, constant) = definition.name.key_operands();
    if let Some(key) = constant {
        lowering.file.fragment.note_write(key);
    }
    lowering.builder.define_method(
        head.value,
        definition.closure,
        computed,
        head.layout,
        definition.side,
        definition.kind,
        *next_method_index,
        constant,
    );
    *next_method_index += 1;
}

fn define_method(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    member: MemberId,
    name: PropertyName,
    next_method_index: &mut u32,
) {
    let node = lowering.file.hir[member];
    let kind = match lowering.file.hir.runtime_member_kind(member) {
        MemberKind::Method => MethodKind::Method,
        MemberKind::Getter => MethodKind::Getter,
        MemberKind::Setter => MethodKind::Setter,
        MemberKind::Property
        | MemberKind::Constructor
        | MemberKind::StaticBlock
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature => {
            debug_assert!(false, "only a method, getter or setter is a method piece");
            return;
        }
    };
    lowering.set_position(node.name_pos);
    let closure = function::lower_method(lowering, node.func, name, head.value);
    let definition = MethodDefinition {
        side: class_side(node),
        kind,
        name,
        closure,
    };
    emit_method_definition(lowering, head, definition, next_method_index);
}

fn define_accessor_pair(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    member: MemberId,
    name: PropertyName,
    next_method_index: &mut u32,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    lowering.set_position(node.name_pos);
    let computed_name = match hir.runtime_member_key(member) {
        PropKey::Computed(_) => Some(member::emit_name_value(lowering, name)),
        PropKey::Name(_) | PropKey::Private(_) | PropKey::None => None,
    };
    let halves = [
        (AccessorFunction::Getter, MethodKind::Getter),
        (AccessorFunction::Setter, MethodKind::Setter),
    ];
    for (accessor, kind) in halves {
        let id = declare_accessor_function(lowering.file, member, accessor);
        let closure = function::emit_closure(lowering, id, None);
        if let Some(key) = computed_name {
            lowering.builder.set_function_name(closure, key, kind);
        }
        let definition = MethodDefinition {
            side: class_side(node),
            kind,
            name,
            closure,
        };
        emit_method_definition(lowering, head, definition, next_method_index);
    }
}

fn create_private_function(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    head: ClassHead,
    plan: &ClassPlan,
    member: MemberId,
    name: PropertyName,
) {
    let hir = lowering.file.hir;
    let node = hir[member];
    if plan.transform == ClassTransform::Standard && has_decorators(hir, node.modifiers) {
        return;
    }
    lowering.set_position(node.name_pos);
    let closure = function::lower_method(lowering, node.func, name, head.value);
    set_class_slot(
        lowering,
        head.class,
        ClassSlot::PrivateMethod(member),
        closure,
    );
}
