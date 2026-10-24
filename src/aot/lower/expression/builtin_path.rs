use bun_sema::hir::ExprId;

use super::Evaluation;
use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Scope};
use crate::builtins::{BuiltinPath, Mutability, Resolved};
use crate::ir::ValueId;
use crate::lower::{FunctionLowering, commonjs};

pub(super) fn lower_builtin_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    path: BuiltinPath,
    evaluation: Evaluation<'_>,
) -> ValueId {
    if let Some(builtin) = path.locked_builtin() {
        return emit_locked_builtin(lowering, builtin);
    }
    let value = super::lower_by_kind(lowering, expression, evaluation);
    expect_path(lowering, path, value)
}

pub(in crate::lower) fn emit_locked_builtin(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
) -> ValueId {
    match table::entry(builtin).scope {
        Scope::Realm => lowering.builder.builtin(builtin),
        Scope::Module => commonjs::emit_module_builtin(lowering, builtin),
    }
}

pub(in crate::lower) fn expect_resolved_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    value: ValueId,
) -> ValueId {
    match lowering.file.builtins.of_expr(expression) {
        Some(Resolved::Builtin(path)) => expect_path(lowering, path, value),
        Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => value,
    }
}

fn expect_path(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    path: BuiltinPath,
    value: ValueId,
) -> ValueId {
    match path.mutability {
        Mutability::ConstantUnlessWritten => lowering.expect_builtin(value, path.id),
        Mutability::AlwaysLocked | Mutability::ChangesOnItsOwn => value,
    }
}
