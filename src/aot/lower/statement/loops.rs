use bun_sema::hir::{self, StmtId, StmtKind, VarKind};

use crate::ir::BlockId;
use crate::lower::control::BreakTargetKind;
use crate::lower::{FunctionLowering, dispose};

fn is_let_declaration(hir: &hir::File<'_>, statement: StmtId) -> bool {
    if statement.is_none() {
        return false;
    }
    let StmtKind::Var(declarations) = hir[statement].kind else {
        return false;
    };
    !declarations.is_empty() && matches!(hir[declarations.at(0)].kind, VarKind::Let)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn begin_loop(&mut self, statement: StmtId) -> BlockId {
        let header = self.create_loop_header(statement);
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        header
    }

    fn lower_loop_body(
        &mut self,
        statement: StmtId,
        body: StmtId,
        break_block: BlockId,
        continue_block: BlockId,
    ) {
        self.push_break_target(statement, BreakTargetKind::Loop, break_block);
        self.push_continue_target(statement, continue_block);
        self.lower_statement(body);
        self.pop_jump_target();
        self.pop_jump_target();
    }
}

pub(super) fn lower_while(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let StmtKind::While { test, body } = lowering.file.hir[statement].kind else {
        unreachable!("lower_while takes a While statement");
    };
    if lowering.file.decisions().is_dead_stmt(body) {
        lowering.lower_expression_for_effect(test);
        return;
    }
    let body_block = lowering.create_block();
    let after = lowering.create_block();
    let header = lowering.begin_loop(statement);
    lowering.lower_condition(test, body_block, after);
    lowering.continue_in(body_block);

    lowering.lower_loop_body(statement, body, after, header);
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
    let header = lowering.begin_loop(statement);

    lowering.lower_loop_body(statement, body, after, test_block);
    lowering.jump(test_block);
    lowering.continue_in(test_block);
    lowering.lower_condition(test, header, after);
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
        lowering.enter_scope(scope);
    }
    match dispose::find_resource_declarations(hir, init) {
        Some(declarations) => {
            lowering.lower_head_resources(declarations, &mut |lowering| {
                lower_for_loop(lowering, statement);
            });
        }
        None => {
            if init.is_some() {
                lowering.lower_statement(init);
            }
            lower_for_loop(lowering, statement);
        }
    }
    if scope.is_some() {
        lowering.leave_scope(scope);
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
        lowering.lower_expression_for_effect(test);
        return;
    }
    let scope = lowering.file.bound.own_scope(statement);
    let copied_scope = (scope.is_some() && is_let_declaration(hir, init)).then_some(scope);
    if let Some(scope) = copied_scope {
        lowering.copy_iteration_bindings(scope);
    }
    let body_block = lowering.create_block();
    let update_block = lowering.create_block();
    let after = lowering.create_block();
    let header = lowering.begin_loop(statement);
    match test.some() {
        Some(test) => lowering.lower_condition(test, body_block, after),
        None => lowering.jump(body_block),
    }
    lowering.continue_in(body_block);

    lowering.lower_loop_body(statement, body, after, update_block);
    lowering.jump(update_block);
    lowering.continue_in(update_block);

    if let Some(scope) = copied_scope {
        lowering.copy_iteration_bindings(scope);
    }
    if update.is_some() {
        lowering.lower_expression_for_effect(update);
    }
    lowering.jump(header);
    lowering.builder.seal(header);
    lowering.continue_in(after);
}
