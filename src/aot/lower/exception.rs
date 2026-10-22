use bun_sema::hir::{StmtId, StmtKind};

use super::{FunctionLowering, control, expression, pattern, scope, statement};
use crate::ir::generated::{BlockRole, RuntimeErrorKind};
use crate::ir::{StringId, ValueId};

pub(crate) fn emit_throw(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, value: ValueId) {
    lowering.builder.throw(value);
    lowering.begin_unreachable_block();
}

pub(crate) fn emit_throw_runtime_error(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    error: RuntimeErrorKind,
    name: Option<StringId>,
) {
    let value = lowering.builder.new_runtime_error(error, name);
    emit_throw(lowering, value);
}

pub(in crate::lower) fn lower_throw(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let stmt = lowering.file.hir[statement];
    let StmtKind::Throw(expression) = stmt.kind else {
        unreachable!("lower_throw takes a Throw statement");
    };
    let value = expression::lower_expression(lowering, expression);
    lowering.set_position(stmt.start);
    emit_throw(lowering, value);
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
    control::begin_cleanup(lowering, BlockRole::CleanupHandler, None);
    lower_try_and_catch(lowering, statement);
    control::end_cleanup_shared(lowering, &mut |lowering| {
        statement::lower_statement(lowering, finalizer);
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
        statement::lower_statement(lowering, block);
        return;
    }

    let after = lowering.create_block();
    let handler = control::begin_handler(lowering, BlockRole::CatchHandler, None);
    statement::lower_statement(lowering, block);
    control::end_handler(lowering, handler);
    lowering.jump(after);

    lowering.continue_in(handler.block());
    lowering.set_position(hir[catch_body].start);
    let caught = lowering.builder.catch_value();
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_some() {
        scope::enter_scope(lowering, scope);
    }
    if param.is_some() {
        pattern::bind_pattern(lowering, hir[param].pat, caught, None);
    }
    statement::lower_statement(lowering, catch_body);
    if scope.is_some() {
        scope::leave_scope(lowering, scope);
    }
    lowering.jump(after);
    lowering.continue_in(after);
}
