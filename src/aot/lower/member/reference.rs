use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{Chain, ExprId, ExprKind, MemberKey};

use super::PropertyName;
use crate::ir::generated::{NullishAccess, RuntimeErrorKind};
use crate::ir::{TypeTable, ValueId, VariableId};
use crate::lower::scope::{self, IdentifierTarget};
use crate::lower::{
    FileLowering, FunctionLowering, commonjs, condition, convert, exception, expression, function,
    private_names,
};

pub(in crate::lower) enum Reference {
    Identifier {
        target: IdentifierTarget,
        identifier: ExprId,
    },
    FreeName(Atom),
    Property {
        object: ValueId,
        name: PropertyName,
        access: Option<ExprId>,
    },
    Super {
        base: ValueId,
        name: PropertyName,
    },
    Private {
        object: ValueId,
        access: ExprId,
    },
    // What a module has under a name, or `module.exports`. `holder`: what the `var` in front of the dot holds, which may be
    // `undefined`: the access throws then, a store only when the value has been evaluated.
    ModuleVariable {
        variable: VariableId,
        holder: Option<ValueId>,
    },
    // Nobody can see what is stored there.
    Discarded {
        holder: Option<ValueId>,
    },
    Invalid,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum KeyConversion {
    AtAccess,
    Once,
}

pub(in crate::lower) fn lower_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
    conversion: KeyConversion,
) -> Reference {
    let hir = lowering.file.hir;
    let target = expression::skip_type_syntax(lowering.file, target);
    lowering.set_position(hir[target].pos);
    match hir[target].kind {
        ExprKind::Ident(_) => lower_identifier_reference(lowering, target),
        ExprKind::Dot {
            chain: Chain::No, ..
        }
        | ExprKind::Index {
            chain: Chain::No, ..
        } => lower_member_reference(lowering, target, conversion),
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Dot {
            chain: Chain::Start | Chain::Continue,
            ..
        }
        | ExprKind::Index {
            chain: Chain::Start | Chain::Continue,
            ..
        }
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => lower_invalid_reference(lowering, target),
    }
}

fn lower_identifier_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> Reference {
    match lowering.file.decisions().decision(identifier) {
        Decision::GlobalPath(path) => lower_global_path_reference(lowering, path),
        Decision::Unknown | Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            let target = scope::resolve_identifier_target(lowering, identifier);
            Reference::Identifier { target, identifier }
        }
    }
}

fn lower_global_path_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    path: &[Atom],
) -> Reference {
    let member = expression::lower_global_path_holder(lowering, path);
    match member.holder {
        Some(object) => Reference::Property {
            object,
            name: PropertyName::Constant(lowering.file.atom_key(member.name)),
            access: None,
        },
        None => Reference::FreeName(member.name),
    }
}

fn lower_member_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
    conversion: KeyConversion,
) -> Reference {
    let hir = lowering.file.hir;
    let Some((object, member)) = hir.member_key(target) else {
        unreachable!("lower_member_reference takes a Dot or an Index expression");
    };
    if matches!(member, MemberKey::PrivateName(_)) {
        let object = expression::lower_expression(lowering, object);
        return Reference::Private {
            object,
            access: target,
        };
    }
    if let Some(reference) = commonjs::lower_export_reference(lowering, target) {
        lowering.set_position(hir[target].pos);
        return reference;
    }
    let conversion = resolve_key_conversion(lowering.file, member, conversion);
    if matches!(hir[object].kind, ExprKind::Super) {
        let (home_kind, home) = function::get_home_object(lowering);
        let base = lowering.builder.get_super_base(home_kind, home);
        let name = super::lower_member_key(lowering, member);
        lowering.set_position(hir[target].pos);
        let name = convert_key(lowering, base, name, conversion);
        return Reference::Super { base, name };
    }
    let (object, name) = super::lower_member_operands(lowering, target, None);
    lowering.set_position(hir[target].pos);
    let name = convert_key(lowering, object, name, conversion);
    Reference::Property {
        object,
        name,
        access: Some(target),
    }
}

fn lower_invalid_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: ExprId,
) -> Reference {
    expression::lower_expression_for_effect(lowering, target);
    lowering.set_position(lowering.file.hir[target].pos);
    exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::UnresolvableReference, None);
    Reference::Invalid
}

fn resolve_key_conversion(
    file: &FileLowering<'_, '_, '_, '_>,
    member: MemberKey,
    requested: KeyConversion,
) -> KeyConversion {
    match member {
        MemberKey::Name(_) | MemberKey::PrivateName(_) => KeyConversion::AtAccess,
        MemberKey::Computed(key) => match expression::find_constant(file, key) {
            Some(_) => KeyConversion::AtAccess,
            None => requested,
        },
    }
}

fn convert_key(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    name: PropertyName,
    conversion: KeyConversion,
) -> PropertyName {
    match (conversion, name) {
        (KeyConversion::AtAccess, _) | (KeyConversion::Once, PropertyName::Constant(_)) => name,
        (KeyConversion::Once, PropertyName::Computed(key)) => {
            PropertyName::Computed(convert_key_once(lowering, object, key))
        }
    }
}

fn convert_key_once(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    object: ValueId,
    key: ValueId,
) -> ValueId {
    let result = lowering.builder.create_variable(None);
    let join = lowering.create_block();
    let split = condition::split_on_type(lowering, key, TypeTable::OBJECT);

    lowering.builder.switch_to(split.taken);
    lowering
        .builder
        .require_object_coercible(object, NullishAccess::Read, None);
    let converted = lowering.builder.to_property_key(split.taken_value);
    lowering.builder.write_variable(result, converted);
    lowering.jump(join);

    lowering.builder.switch_to(split.not_taken);
    lowering
        .builder
        .write_variable(result, split.not_taken_value);
    lowering.jump(join);

    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

pub(in crate::lower) fn get_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    reference: &Reference,
) -> ValueId {
    match *reference {
        Reference::Identifier { ref target, .. } => scope::get_identifier_target(lowering, target),
        Reference::FreeName(name) => expression::emit_free_name_get(lowering, name, false),
        Reference::Property {
            object,
            name,
            access: Some(access),
        } => super::emit_member_read(lowering, access, object, name),
        Reference::Property {
            object,
            name,
            access: None,
        } => super::emit_get(lowering, object, name),
        Reference::Super { base, name } => {
            let receiver = function::get_this(lowering);
            let (computed_key, key) = name.key_operands();
            lowering
                .builder
                .super_get(base, receiver, computed_key, key)
        }
        Reference::Private { object, access } => {
            private_names::emit_private_get(lowering, object, access)
        }
        Reference::ModuleVariable { variable, holder } => {
            commonjs::test_holder(lowering, holder, NullishAccess::Read);
            lowering.builder.get_module_variable(variable)
        }
        Reference::Discarded { holder } => {
            commonjs::test_holder(lowering, holder, NullishAccess::Read);
            lowering.builder.undefined()
        }
        Reference::Invalid => lowering.builder.undefined(),
    }
}

pub(in crate::lower) fn put_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    reference: &Reference,
    value: ValueId,
    source: Option<ExprId>,
) -> ValueId {
    match *reference {
        Reference::Identifier {
            ref target,
            identifier,
        } => {
            scope::set_identifier_target(lowering, target, value, source);
            match scope::find_tested_local(lowering, identifier) {
                Some(_) => scope::lower_identifier(lowering, identifier),
                None => value,
            }
        }
        Reference::FreeName(name) => {
            expression::emit_free_name_set(lowering, name, value);
            value
        }
        Reference::Property {
            object,
            name,
            access: Some(access),
        } => {
            let converted = convert::convert_to_member(lowering, access, value, source);
            super::emit_set(lowering, object, name, converted);
            converted
        }
        Reference::Property {
            object,
            name,
            access: None,
        } => {
            super::emit_set(lowering, object, name, value);
            value
        }
        Reference::Super { base, name } => {
            let receiver = function::get_this(lowering);
            let (computed_key, key) = name.key_operands();
            let mode = lowering.mode();
            lowering
                .builder
                .super_set(mode, base, receiver, value, computed_key, key);
            value
        }
        Reference::Private { object, access } => {
            private_names::emit_private_set(lowering, object, access, value, source);
            value
        }
        Reference::ModuleVariable { variable, holder } => {
            commonjs::test_holder(lowering, holder, NullishAccess::Write);
            lowering.builder.put_module_variable(variable, value);
            value
        }
        Reference::Discarded { holder } => {
            commonjs::test_holder(lowering, holder, NullishAccess::Write);
            value
        }
        Reference::Invalid => value,
    }
}
