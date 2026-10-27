use bun_sema::bind::Binding;
use bun_sema::fold::Decision;
use bun_sema::hir::{ExprId, ExprKind};

use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, Scope};
use crate::builtins::{BuiltinPath, Mutability, Resolved};
use crate::ir::ValueId;
use crate::lower::FunctionLowering;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // JSC reads a global name, and each member on the way to a built-in, where it is written. What is known ahead of time is not read, and leaves the same record.
    pub(in crate::lower) fn record_read_of_builtin_path(&mut self, expression: ExprId) {
        let hir = self.file.hir;
        let inner = self.file.skip_type_syntax(expression);
        let object = match hir[inner].kind {
            ExprKind::Ident(_) => None,
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
            _ => return,
        };
        // `undefined`, `NaN` and `Infinity` are names to JSC. Bun's transpiler prints none of them as a name.
        let is_constant_of_global_object = object.is_none()
            && self.file.runs_as_written()
            && matches!(self.file.bound.binding(inner), Binding::Free)
            && matches!(self.file.decisions().decision(inner), Decision::Constant(_));
        if self.file.builtins.of_expr(inner).is_none() && !is_constant_of_global_object {
            return;
        }
        let position = match object {
            Some(object) => self.file.member_position(object),
            None => self.file.recorded_name_position(inner),
        };
        self.builder.record_position(position);
    }

    // The read of a locked member where the program writes it. A holder may add a member when it is first read, which shows in the order of its keys.
    pub(in crate::lower) fn emit_locked_builtin(&mut self, builtin: BuiltinId) -> ValueId {
        match table::entry(builtin).scope {
            Scope::Realm => self.builder.builtin(builtin, false),
            Scope::Module => self.emit_module_builtin(builtin),
        }
    }

    // The object itself, where the program reads nothing: its holder stays as it is.
    pub(in crate::lower) fn emit_builtin_itself(&mut self, builtin: BuiltinId) -> ValueId {
        match table::entry(builtin).scope {
            Scope::Realm => self.builder.builtin(builtin, true),
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
