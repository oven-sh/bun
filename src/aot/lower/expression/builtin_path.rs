use bun_sema::hir::ExprId;

use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Scope};
use crate::builtins::{BuiltinPath, Mutability, Resolved};
use crate::ir::ValueId;
use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn emit_locked_builtin(&mut self, builtin: BuiltinId) -> ValueId {
        match table::entry(builtin).scope {
            Scope::Realm => self.builder.builtin(builtin),
            Scope::Module => self.emit_module_builtin(builtin),
        }
    }

    pub(in crate::lower) fn expect_resolved_path(
        &mut self,
        expression: ExprId,
        value: ValueId,
    ) -> ValueId {
        match self.file.builtins.of_expr(expression) {
            Some(Resolved::Builtin(path)) => self.expect_path(path, value),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => value,
        }
    }

    pub(super) fn expect_path(&mut self, path: BuiltinPath, value: ValueId) -> ValueId {
        match path.mutability {
            Mutability::ConstantUnlessWritten => self.expect_builtin(value, path.id),
            Mutability::AlwaysLocked | Mutability::ChangesOnItsOwn => value,
        }
    }
}
