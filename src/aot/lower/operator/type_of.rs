use bun_sema::fold::Decision;
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::{Mutability, Resolved};
use crate::ir::ValueId;
use crate::lower::{FileLowering, FunctionLowering, expression, scope};

pub(in crate::lower) fn lower_typeof_operand(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
) -> ValueId {
    let hir = lowering.file.hir;
    let target = expression::skip_type_syntax(lowering.file, operand);
    if is_always_resolvable(lowering.file, target) {
        return expression::lower_expression(lowering, operand);
    }
    let value = match lowering.file.decisions().decision(target) {
        Decision::GlobalPath(&[name]) => {
            lowering.set_position(hir[target].pos);
            let value = expression::emit_free_name_get(lowering, name, true);
            expression::expect_resolved_path(lowering, target, value)
        }
        Decision::Unknown => {
            if !matches!(hir[target].kind, ExprKind::Ident(_)) {
                return expression::lower_expression(lowering, operand);
            }
            lowering.set_position(hir[target].pos);
            scope::lower_identifier_for_typeof(lowering, target)
        }
        _ => return expression::lower_expression(lowering, operand),
    };
    expression::convert_through_assertions(lowering, operand, value)
}

fn is_always_resolvable(file: &FileLowering<'_, '_, '_, '_>, target: ExprId) -> bool {
    match file.builtins.of_expr(target) {
        Some(Resolved::Builtin(path)) => match path.mutability {
            Mutability::AlwaysLocked => true,
            Mutability::ConstantUnlessWritten | Mutability::ChangesOnItsOwn => false,
        },
        Some(Resolved::Intrinsic(_)) => true,
        Some(Resolved::DynamicGlobal(_)) | None => false,
    }
}
