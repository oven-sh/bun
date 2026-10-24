use bun_sema::hir::{self, StmtId, StmtKind, VarKind};

use super::lower_statement;
use crate::ir::BlockId;
use crate::lower::control::{self, BreakTargetKind};
use crate::lower::{FunctionLowering, condition, dispose, expression, scope};

fn is_let_declaration(hir: &hir::File<'_>, statement: StmtId) -> bool {
    if statement.is_none() {
        return false;
    }
    let StmtKind::Var(declarations) = hir[statement].kind else {
        return false;
    };
    !declarations.is_empty() && matches!(hir[declarations.at(0)].kind, VarKind::Let)
}

fn begin_loop(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) -> BlockId {
    let header = scope::create_loop_header(lowering, statement);
    lowering.jump(header);
    lowering.builder.switch_to(header);
    lowering.builder.loop_hint();
    header
}

pub(super) fn lower_while(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let StmtKind::While { test, body } = lowering.file.hir[statement].kind else {
        unreachable!("lower_while takes a While statement");
    };
    if lowering.file.decisions().is_dead_stmt(body) {
        expression::lower_expression_for_effect(lowering, test);
        return;
    }
    let body_block = lowering.create_block();
    let after = lowering.create_block();
    let header = begin_loop(lowering, statement);
    condition::lower_condition(lowering, test, body_block, after);
    lowering.continue_in(body_block);

    lower_loop_body(lowering, statement, body, after, header);
    lowering.jump(header);
    lowering.builder.seal(header);
    lowering.continue_in(after);
}

pub(super) fn lower_do_while(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) {
    let StmtKind::DoWhile { body, test } = lowering.file.hir[statement].kind else {
        unreachable!("lower_do_while takes a DoWhile statement");
    };
    let test_block = lowering.create_block();
    let after = lowering.create_block();
    let header = begin_loop(lowering, statement);

    lower_loop_body(lowering, statement, body, after, test_block);
    lowering.jump(test_block);
    lowering.continue_in(test_block);
    condition::lower_condition(lowering, test, header, after);
    lowering.builder.seal(header);
    lowering.continue_in(after);
}

pub(super) fn lower_for(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let hir = lowering.file.hir;
    let StmtKind::For { init, .. } = hir[statement].kind else {
        unreachable!("lower_for takes a For statement");
    };
    let scope = lowering.file.bound.own_scope(statement);
    if scope.is_some() {
        scope::enter_scope(lowering, scope);
    }
    match dispose::find_resource_declarations(hir, init) {
        Some(declarations) => {
            dispose::lower_head_resources(lowering, declarations, &mut |lowering| {
                lower_for_loop(lowering, statement);
            });
        }
        None => {
            if init.is_some() {
                lower_statement(lowering, init);
            }
            lower_for_loop(lowering, statement);
        }
    }
    if scope.is_some() {
        scope::leave_scope(lowering, scope);
    }
}

fn lower_for_loop(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let hir = lowering.file.hir;
    let StmtKind::For {
        init,
        test,
        update,
        body,
    } = hir[statement].kind
    else {
        unreachable!("lower_for_loop takes a For statement");
    };
    if lowering.file.decisions().is_dead_stmt(body) {
        expression::lower_expression_for_effect(lowering, test);
        return;
    }
    let scope = lowering.file.bound.own_scope(statement);
    let copied_scope = (scope.is_some() && is_let_declaration(hir, init)).then_some(scope);
    if let Some(scope) = copied_scope {
        scope::copy_iteration_bindings(lowering, scope);
    }
    let body_block = lowering.create_block();
    let update_block = lowering.create_block();
    let after = lowering.create_block();
    let header = begin_loop(lowering, statement);
    match test.some() {
        Some(test) => condition::lower_condition(lowering, test, body_block, after),
        None => lowering.jump(body_block),
    }
    lowering.continue_in(body_block);

    lower_loop_body(lowering, statement, body, after, update_block);
    lowering.jump(update_block);
    lowering.continue_in(update_block);

    if let Some(scope) = copied_scope {
        scope::copy_iteration_bindings(lowering, scope);
    }
    if update.is_some() {
        expression::lower_expression_for_effect(lowering, update);
    }
    lowering.jump(header);
    lowering.builder.seal(header);
    lowering.continue_in(after);
}

fn lower_loop_body(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
    body: StmtId,
    break_block: BlockId,
    continue_block: BlockId,
) {
    control::push_break_target(lowering, statement, BreakTargetKind::Loop, break_block);
    control::push_continue_target(lowering, statement, continue_block);
    lower_statement(lowering, body);
    control::pop_jump_target(lowering);
    control::pop_jump_target(lowering);
}
