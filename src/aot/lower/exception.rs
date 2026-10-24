use bun_sema::hir::{StmtId, StmtKind};

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
}

pub(in crate::lower) fn lower_throw(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let stmt = lowering.file.hir[statement];
    let StmtKind::Throw(expression) = stmt.kind else {
        unreachable!("lower_throw takes a Throw statement");
    };
    let value = lowering.lower_expression(expression);
    lowering.set_position(stmt.start);
    lowering.emit_throw(value);
}

pub(in crate::lower) fn lower_try(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let StmtKind::Try { finalizer, .. } = lowering.file.hir[statement].kind else {
        unreachable!("lower_try takes a Try statement");
    };
    if finalizer.is_none() {
        lower_try_and_catch(lowering, statement);
        return;
    }
    lowering.begin_cleanup(BlockRole::CleanupHandler, None);
    lower_try_and_catch(lowering, statement);
    lowering.end_cleanup_shared(&mut |lowering| {
        lowering.lower_statement(finalizer);
    });
}

fn lower_try_and_catch(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let hir = lowering.file.hir;
    let StmtKind::Try {
        block,
        param,
        handler: catch_body,
        ..
    } = hir[statement].kind
    else {
        unreachable!("lower_try_and_catch takes a Try statement");
    };
    if catch_body.is_none() {
        lowering.lower_statement(block);
        return;
    }

    let after = lowering.create_block();
    let handler = lowering.begin_handler(BlockRole::CatchHandler, None);
    lowering.lower_statement(block);
    lowering.end_handler(handler);
    lowering.jump(after);

    lowering.continue_in(handler.block());
    lowering.set_position(hir[catch_body].start);
    let caught = lowering.builder.catch_value();
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_some() {
        lowering.enter_scope(scope);
    }
    if param.is_some() {
        lowering.bind_pattern(hir[param].pat, caught, None);
    }
    lowering.lower_statement(catch_body);
    if scope.is_some() {
        lowering.leave_scope(scope);
    }
    lowering.jump(after);
    lowering.continue_in(after);
}
