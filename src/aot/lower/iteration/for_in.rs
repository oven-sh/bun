use bun_sema::hir::{StmtId, StmtKind, VarKind};

use crate::ir::Edge;
use crate::ir::generated::ForInStepResult;
use crate::lower::FunctionLowering;
use crate::lower::control::BreakTargetKind;

pub(crate) fn lower_for_in(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, statement: StmtId) {
    let StmtKind::ForIn { left, expr, body } = lowering.file.hir[statement].kind else {
        unreachable!("lower_for_in takes a ForIn statement");
    };
    lowering.lower_head_initializer(left);
    let object = lowering.lower_loop_subject(statement, expr);
    lowering.set_position(lowering.file.last_reported_position(expr));
    let enumerator = lowering.builder.for_in_open(object);
    let blocks = lowering.begin_iteration_loop(statement);
    let builder = &mut lowering.builder;
    let step = builder.for_in_step(enumerator, object);
    let done = builder.result_at(step, ForInStepResult::Done.to_wire());
    let key = builder.result_at(step, ForInStepResult::Key.to_wire());
    builder.branch(done, Edge::to(blocks.after), Edge::to(blocks.body));
    lowering.continue_in(blocks.body);

    lowering.push_break_target(statement, BreakTargetKind::Loop, blocks.after);
    lowering.push_continue_target(statement, blocks.header);
    lowering.lower_iteration_body(statement, left, key, body);
    lowering.jump(blocks.header);
    lowering.pop_jump_target();
    lowering.pop_jump_target();
    lowering.builder.seal(blocks.header);
    lowering.continue_in(blocks.after);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn lower_head_initializer(&mut self, left: StmtId) {
        let hir = self.file.hir;
        let StmtKind::Var(declarations) = hir[left].kind else {
            return;
        };
        let Some(declaration) = declarations.iter().next() else {
            return;
        };
        let head = hir[declaration];
        match head.kind {
            VarKind::Var if head.init.is_some() => {
                self.lower_variable_declaration(declaration);
            }
            VarKind::Var | VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {
            }
        }
    }
}
