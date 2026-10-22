use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{BlockId, ValueId};
use crate::lower::expression::ShortCircuit;
use crate::lower::member::PropertyName;
use crate::lower::{
    FunctionLowering, call, commonjs, exception, expression, function, member, scope,
};

pub(super) fn lower_delete(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let target = expression::skip_type_syntax(lowering.file, operand);
    match lowering.file.decisions().decision(target) {
        Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            return lowering.builder.boolean(true);
        }
        Decision::GlobalPath(path) => return delete_global_path(lowering, path),
        Decision::Unknown => {}
    }
    if matches!(hir[target].kind, ExprKind::Ident(_)) {
        return scope::delete_identifier(lowering, target);
    }
    let Some((object, key)) = hir.member_key(target) else {
        expression::lower_expression_for_effect(lowering, target);
        return lowering.builder.boolean(true);
    };
    if matches!(hir[object].kind, ExprKind::Super) {
        return delete_super_member(lowering, target, key);
    }
    if let Some(deleted) = commonjs::try_lower_exports_deletion(lowering, target) {
        return deleted;
    }
    if expression::is_chain_root(lowering.file, target) {
        return expression::lower_in_chain(lowering, ShortCircuit::True, &mut |lowering, exit| {
            delete_member(lowering, target, Some(exit))
        });
    }
    delete_member(lowering, target, None)
}

fn delete_global_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    path: &[Atom],
) -> ValueId {
    let last = expression::lower_global_path_holder(lowering, path);
    let Some(holder) = last.holder else {
        return expression::emit_free_name_delete(lowering, last.name);
    };
    let key = lowering.file.atom_key(last.name);
    member::emit_delete(lowering, holder, PropertyName::Constant(key))
}

fn delete_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    exit: Option<BlockId>,
) -> ValueId {
    let hir = lowering.file.hir;
    let Some((object, key)) = hir.member_key(access) else {
        debug_assert!(false, "delete_member takes a member access");
        return lowering.builder.boolean(true);
    };
    let base = member::lower_member_base(lowering, access, object, exit);
    let name = match key {
        MemberKey::Name(_) | MemberKey::Computed(_) => member::lower_member_key(lowering, key),
        MemberKey::PrivateName(_) => return lowering.builder.boolean(true),
    };
    lowering.set_position(call::last_mapped_position(lowering.file, access));
    member::emit_delete(lowering, base, name)
}

fn delete_super_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    key: MemberKey,
) -> ValueId {
    let hir = lowering.file.hir;
    function::get_this(lowering);
    match key {
        MemberKey::Computed(computed) => {
            expression::lower_expression(lowering, computed);
        }
        MemberKey::Name(_) | MemberKey::PrivateName(_) => {}
    }
    lowering.set_position(hir[access].pos);
    exception::emit_throw_runtime_error(lowering, RuntimeErrorKind::DeleteSuperProperty, None);
    lowering.builder.boolean(true)
}
