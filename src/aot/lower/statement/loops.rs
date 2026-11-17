use bun_sema::bind::Binding;
use bun_sema::hir::{BinOp, ExprId, ExprKind, NodeData, StmtId, StmtKind, UnOp};

use crate::ir::BlockId;
use crate::lower::control::BreakTargetKind;
use crate::lower::scope::{BindingForm, BindingRef, Storage, is_let_declaration};
use crate::lower::statement::{SuspendingArm, SuspendingPart};
use crate::lower::{FunctionLowering, dispose};

#[derive(Copy, Clone, Debug)]
struct SuspendingLoop {
    header: BlockId,
    arm: SuspendingArm,
}

impl SuspendingLoop {
    fn end_of_body(resumed: Option<SuspendingLoop>) -> Option<BlockId> {
        resumed
            .filter(|of| of.arm.part == SuspendingPart::Rest)
            .map(|of| of.arm.resumed)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn begin_loop(&mut self, statement: StmtId) -> BlockId {
        let header = self.create_loop_header(statement);
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        header
    }

    pub(super) fn lower_loop_body(
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

    fn lower_test_of_dead_loop(&mut self, test: ExprId, body: StmtId) {
        let in_bun_run = self.file.decisions().as_folded_by_bun_run();
        self.lower_test_with_known_answer(test, in_bun_run.is_dead_stmt(body));
    }

    /// The step in `while (++i < n)`. It is lowered before the loop and at the end of each
    /// iteration, so the header tests the counter itself, as a `for` loop does.
    fn find_step_before_test(&self, test: ExprId) -> Option<ExprId> {
        let hir = self.file.hir;
        let mut tested = test;
        loop {
            let ExprKind::Binary { op, left, .. } = hir[tested].kind else {
                return None;
            };
            if self.file.is_statically_resolved(tested) {
                return None;
            }
            match op {
                BinOp::And | BinOp::Or => tested = left,
                BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => {
                    let ExprKind::Unary {
                        op: UnOp::PreInc | UnOp::PreDec,
                        operand,
                    } = hir[left].kind
                    else {
                        return None;
                    };
                    return self.is_local_variable(operand).then_some(left);
                }
                _ => return None,
            }
        }
    }

    fn is_local_variable(&self, name: ExprId) -> bool {
        self.find_local(name)
            .is_some_and(|is_immutable| !is_immutable)
    }

    /// Whether the local of that name is immutable.
    pub(super) fn find_local(&self, name: ExprId) -> Option<bool> {
        let bound = self.file.bound;
        if !matches!(self.file.hir[name].kind, ExprKind::Ident(_))
            || bound.dynamic_lookup_scope(NodeData::Expr(name)).is_some()
        {
            return None;
        }
        let Binding::Symbol(symbol) = bound.binding(name) else {
            return None;
        };
        let scopes = &self.file.scopes;
        if scopes.form(symbol) != BindingForm::Stored {
            return None;
        }
        let place = scopes.placement(BindingRef::Symbol(symbol))?;
        (place.storage == Storage::Local).then_some(place.is_immutable)
    }

    fn lower_test_after_step(
        &mut self,
        test: ExprId,
        step: Option<ExprId>,
        if_true: BlockId,
        if_false: BlockId,
    ) {
        let enclosing = std::mem::replace(&mut self.step_before_test, step);
        self.lower_condition(test, if_true, if_false);
        self.step_before_test = enclosing;
    }

    pub(super) fn lower_while(&mut self, statement: StmtId, test: ExprId, body: StmtId) {
        if self.file.decisions().is_dead_stmt(body) {
            self.lower_test_of_dead_loop(test, body);
            return;
        }
        let step = self.find_step_before_test(test);
        if let Some(step) = step {
            self.lower_taken_value_for_effect(step);
        }
        let body_block = self.create_block();
        let step_block = step.map(|_| self.create_block());
        let after = self.create_block();
        let resumed = self.begin_suspending_loop(statement, test, [ExprId::NONE; 2], step, body);
        let header = self.begin_loop(statement);
        self.lower_test_after_step(test, step, body_block, after);
        self.continue_in(body_block);

        let enclosing = std::mem::replace(&mut self.suspending_arm, resumed.map(|of| of.arm));
        self.lower_loop_body(statement, body, after, step_block.unwrap_or(header));
        self.suspending_arm = enclosing;
        self.jump(
            SuspendingLoop::end_of_body(resumed)
                .or(step_block)
                .unwrap_or(header),
        );
        if let (Some(step), Some(step_block)) = (step, step_block) {
            self.continue_in(step_block);
            self.lower_taken_value_for_effect(step);
            self.jump(header);
        }
        self.builder.seal(header);
        if let Some(of) = resumed {
            self.continue_in(of.arm.resumed);
            if let Some(step) = step {
                self.lower_taken_value_for_effect(step);
            }
            self.jump(of.header);
            self.builder.seal(of.header);
        }
        self.continue_in(after);
    }

    /// The outer loop of a loop in which a part of the body suspends. The outer loop's iterations are those that suspend.
    fn begin_suspending_loop(
        &mut self,
        statement: StmtId,
        test: ExprId,
        repeated: [ExprId; 2],
        step: Option<ExprId>,
        body: StmtId,
    ) -> Option<SuspendingLoop> {
        let [update, other] = repeated;
        let repeated = [update, step.unwrap_or(other)];
        let arm = self.find_suspending_arm(repeated, body);
        let (part, found) = match arm {
            Some(found) => (SuspendingPart::Arm, found),
            None => (
                SuspendingPart::Rest,
                self.find_suspending_rest(statement, test, repeated, body)?,
            ),
        };
        let resumed = self.create_block();
        let header = self.begin_loop(statement);
        Some(SuspendingLoop {
            header,
            arm: SuspendingArm {
                part,
                statement: found,
                loop_statement: statement,
                resumed,
                late_continue: None,
            },
        })
    }

    fn is_falsy_literal(&self, expression: ExprId) -> bool {
        let hir = self.file.hir;
        let is_zero = |literal: ExprId| match hir[literal].kind {
            ExprKind::False | ExprKind::Null => Some(true),
            ExprKind::True => Some(false),
            ExprKind::Number(number) => Some(hir.numbers[number as usize] == 0.0),
            _ => None,
        };
        let expression = self.file.skip_type_syntax(expression);
        match hir[expression].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => is_zero(self.file.skip_type_syntax(operand)) == Some(false),
            _ => is_zero(expression) == Some(true),
        }
    }

    /// `do { .. } while (0)`: the body runs once. Compilers of other languages write blocks to break out of in this way.
    fn lower_body_run_once(&mut self, statement: StmtId, body: StmtId) {
        let after = self.create_block();
        self.lower_loop_body(statement, body, after, after);
        self.jump(after);
        self.continue_in(after);
    }

    pub(super) fn lower_do_while(&mut self, statement: StmtId, body: StmtId, test: ExprId) {
        if self.is_falsy_literal(test) {
            self.lower_body_run_once(statement, body);
            return;
        }
        let test_block = self.create_block();
        let after = self.create_block();
        let header = self.begin_loop(statement);

        self.lower_loop_body(statement, body, after, test_block);
        self.jump(test_block);
        self.continue_in(test_block);
        self.lower_condition(test, header, after);
        self.builder.seal(header);
        self.continue_in(after);
    }

    pub(super) fn lower_for(&mut self, statement: StmtId, init: StmtId) {
        let scope = self.enter_own_scope(statement);
        let enclosing_loops = self.loose_loops.len();
        let loose = self.find_loose_loop(statement);
        self.loose_loops.extend(loose);
        match dispose::find_resource_declarations(self.file.hir, init) {
            Some(declarations) => {
                self.lower_head_resources(declarations, &mut |lowering| {
                    lowering.lower_for_loop(statement);
                });
            }
            None => {
                match init.some().map(|init| self.file.hir[init].kind) {
                    Some(StmtKind::Expr(opening)) => self.lower_taken_value_for_effect(opening),
                    Some(_) => self.lower_statement(init),
                    None => {}
                }
                if self.loose_loops.is_empty() || !self.lower_loose_loop(statement) {
                    self.lower_for_loop(statement);
                }
            }
        }
        self.loose_loops.truncate(enclosing_loops);
        self.leave_own_scope(scope);
    }

    fn lower_for_loop(&mut self, statement: StmtId) {
        let hir = self.file.hir;
        let StmtKind::For {
            init,
            test,
            update,
            body,
        } = hir[statement].kind
        else {
            unreachable!("lower_for_loop takes a For statement");
        };
        let scope = self.file.bound.own_scope(statement);
        let copied_scope = (scope.is_some() && is_let_declaration(hir, init)).then_some(scope);
        if let Some(scope) = copied_scope {
            self.copy_iteration_bindings(scope);
        }
        if self.file.decisions().is_dead_stmt(body) {
            self.lower_test_of_dead_loop(test, body);
            return;
        }
        let step = test
            .some()
            .and_then(|test| self.find_step_before_test(test));
        if let Some(step) = step {
            self.lower_taken_value_for_effect(step);
        }
        let body_block = self.create_block();
        let update_block = self.create_block();
        let after = self.create_block();
        let resumed =
            self.begin_suspending_loop(statement, test, [update, ExprId::NONE], step, body);
        let header = self.begin_loop(statement);
        match test.some() {
            Some(test) => self.lower_test_after_step(test, step, body_block, after),
            None => self.jump(body_block),
        }
        self.continue_in(body_block);

        let enclosing = std::mem::replace(&mut self.suspending_arm, resumed.map(|of| of.arm));
        self.lower_loop_body(statement, body, after, update_block);
        self.suspending_arm = enclosing;
        let ends = [
            Some((update_block, header)),
            resumed.map(|of| (of.arm.resumed, of.header)),
        ];
        self.jump(SuspendingLoop::end_of_body(resumed).unwrap_or(update_block));
        for (end, header) in ends.into_iter().flatten() {
            self.continue_in(end);
            if let Some(scope) = copied_scope {
                self.copy_iteration_bindings(scope);
            }
            if update.is_some() {
                self.lower_taken_value_for_effect(update);
            }
            if let Some(step) = step {
                self.lower_taken_value_for_effect(step);
            }
            self.jump(header);
            self.builder.seal(header);
        }
        self.continue_in(after);
    }
}
