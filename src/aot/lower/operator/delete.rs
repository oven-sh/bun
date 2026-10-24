use bun_sema::atom::Atom;
use bun_sema::fold::Decision;
use bun_sema::hir::{ExprId, ExprKind, MemberKey};

use crate::ir::generated::RuntimeErrorKind;
use crate::ir::{BlockId, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::expression::ShortCircuit;
use crate::lower::member::PropertyName;

pub(super) fn lower_delete(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let target = lowering.file.skip_type_syntax(operand);
    match lowering.file.decisions().decision(target) {
        Decision::Constant(_) | Decision::Data(_) | Decision::DeferredData => {
            return lowering.builder.boolean(true);
        }
        Decision::GlobalPath(path) => return lowering.delete_global_path(path),
        Decision::Unknown => {}
    }
    if matches!(hir[target].kind, ExprKind::Ident(_)) {
        return lowering.delete_identifier(target);
    }
    let Some((object, key)) = hir.member_key(target) else {
        lowering.lower_expression_for_effect(target);
        return lowering.builder.boolean(true);
    };
    if matches!(hir[object].kind, ExprKind::Super) {
        return lowering.delete_super_member(target, key);
    }
    if let Some(deleted) = lowering.try_lower_exports_deletion(target) {
        return deleted;
    }
    if lowering.file.is_chain_root(target) {
        return lowering.lower_in_chain(ShortCircuit::True, &mut |lowering, exit| {
            delete_member(lowering, target, Some(exit))
        });
    }
    delete_member(lowering, target, None)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn delete_global_path(&mut self, path: &[Atom]) -> ValueId {
        let last = self.lower_global_path_holder(path);
        let Some(holder) = last.holder else {
            return self.emit_free_name_delete(last.name);
        };
        let key = self.file.atom_key(last.name);
        self.emit_delete(holder, PropertyName::Constant(key))
    }

    fn delete_super_member(&mut self, access: ExprId, key: MemberKey) -> ValueId {
        let hir = self.file.hir;
        self.get_this();
        match key {
            MemberKey::Computed(computed) => {
                self.lower_expression(computed);
            }
            MemberKey::Name(_) | MemberKey::PrivateName(_) => {}
        }
        self.set_position(hir[access].pos);
        self.emit_throw_runtime_error(RuntimeErrorKind::DeleteSuperProperty, None);
        self.builder.boolean(true)
    }
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
    let base = lowering.lower_member_base(access, object, exit);
    let name = match key {
        MemberKey::Name(_) | MemberKey::Computed(_) => lowering.lower_member_key(key),
        MemberKey::PrivateName(_) => return lowering.builder.boolean(true),
    };
    lowering.set_position(lowering.file.last_mapped_position(access));
    lowering.emit_delete(base, name)
}
