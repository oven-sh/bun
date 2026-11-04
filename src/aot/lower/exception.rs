use bun_sema::hir::{StmtId, VarDeclId};

use super::FunctionLowering;
use crate::ir::generated::{BlockRole, RuntimeErrorKind};
use crate::ir::{StringId, ValueId};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn emit_throw(&mut self, value: ValueId) {
        self.builder.throw(value);
        self.begin_unreachable_block();
    }

    pub(crate) fn emit_throw_runtime_error(
        &mut self,
        error: RuntimeErrorKind,
        name: Option<StringId>,
    ) {
        let value = self.builder.new_runtime_error(error, name);
        self.emit_throw(value);
    }

    pub(in crate::lower) fn lower_try(
        &mut self,
        statement: StmtId,
        block: StmtId,
        param: VarDeclId,
        catch_body: StmtId,
        finalizer: StmtId,
    ) {
        if finalizer.is_some() {
            self.begin_cleanup(BlockRole::CleanupHandler, None);
        }
        if catch_body.is_some() {
            let hir = self.file.hir;
            let after = self.create_block();
            let handler = self.begin_handler(BlockRole::CatchHandler, None);
            self.lower_statement(block);
            self.end_handler(handler);
            self.jump(after);

            self.continue_in(handler.block());
            self.set_position(hir[catch_body].start);
            let caught = self.builder.catch_value();
            let scope = self.enter_own_scope(statement);
            if param.is_some() {
                self.bind_pattern(hir[param].pat, caught, None);
            }
            self.lower_statement(catch_body);
            self.leave_own_scope(scope);
            self.jump(after);
            self.continue_in(after);
        } else {
            self.lower_statement(block);
        }
        if finalizer.is_some() {
            self.end_cleanup_shared(&mut |lowering| lowering.lower_statement(finalizer));
        }
    }
}
