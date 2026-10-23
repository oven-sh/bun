use bun_sema::hir::{StmtId, StmtKind, VarKind};

use super::loop_head::{begin_iteration_loop, lower_iteration_body, lower_loop_subject};
use crate::ir::Edge;
use crate::ir::generated::ForInStepResult;
use crate::lower::control::{self, BreakTargetKind};
use crate::lower::{FunctionLowering, call, statement};

pub(super) fn lower_for_in(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let StmtKind::ForIn { left, expr, body } = lowering.file.hir[statement].kind else {
        unreachable!("lower_for_in takes a ForIn statement");
    };
    lower_head_initializer(lowering, left);
    let object = lower_loop_subject(lowering, statement, expr);
    lowering.set_position(call::last_reported_position(lowering.file, expr));
    let enumerator = lowering.builder.for_in_open(object);
    let blocks = begin_iteration_loop(lowering, statement);
    let builder = &mut lowering.builder;
    let step = builder.for_in_step(enumerator, object);
    let done = builder.result_at(step, ForInStepResult::Done.to_wire());
    let key = builder.result_at(step, ForInStepResult::Key.to_wire());
    builder.branch(done, Edge::to(blocks.after), Edge::to(blocks.body));
    lowering.continue_in(blocks.body);

    control::push_break_target(lowering, statement, BreakTargetKind::Loop, blocks.after);
    control::push_continue_target(lowering, statement, blocks.header);
    lower_iteration_body(lowering, statement, left, key, body);
    lowering.jump(blocks.header);
    control::pop_jump_target(lowering);
    control::pop_jump_target(lowering);
    lowering.builder.seal(blocks.header);
    lowering.continue_in(blocks.after);
}

fn lower_head_initializer(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, left: StmtId) {
    let hir = lowering.file.hir;
    let StmtKind::Var(declarations) = hir[left].kind else {
        return;
    };
    let Some(declaration) = declarations.iter().next() else {
        return;
    };
    let head = hir[declaration];
    match head.kind {
        VarKind::Var if head.init.is_some() => {
            statement::lower_variable_declaration(lowering, declaration);
        }
        VarKind::Var | VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {}
    }
}
