use bun_sema::hir::{ExprId, StmtId, StmtKind};

use crate::ir::BlockId;
use crate::lower::control::BreakTargetKind;
use crate::lower::scope::is_let_declaration;
use crate::lower::{FunctionLowering, dispose};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn begin_loop(&mut self, statement: StmtId) -> BlockId {
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

    pub(super) fn lower_while(&mut self, statement: StmtId, test: ExprId, body: StmtId) {
        if self.file.decisions().is_dead_stmt(body) {
            self.lower_decided_test(test);
            self.hold_names_of_removed_statement(body);
            return;
        }
        let body_block = self.create_block();
        let after = self.create_block();
        let header = self.begin_loop(statement);
        let recorded = self.lower_loop_test(test, body_block, after);
        self.continue_in(body_block);

        self.lower_loop_body(statement, body, after, header);
        self.jump(header);
        self.builder.seal(header);
        self.continue_in(after);
        self.record_again(recorded);
    }

    // JSC writes the test of a `while` or `for` loop once more behind the body, so what follows the loop follows the records of the test.
    fn lower_loop_test(&mut self, test: ExprId, body: BlockId, after: BlockId) -> Option<u32> {
        let records = self.builder.number_of_records();
        self.lower_condition(test, body, after);
        let recorded = self.builder.last_recorded_position();
        recorded.filter(|_| self.builder.number_of_records() != records)
    }

    fn record_again(&mut self, recorded: Option<u32>) {
        if let Some(position) = recorded {
            self.builder.record_position(position);
        }
    }

    pub(super) fn lower_do_while(&mut self, statement: StmtId, body: StmtId, test: ExprId) {
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
        match dispose::find_resource_declarations(self.file.hir, init) {
            Some(declarations) => {
                self.lower_head_resources(declarations, &mut |lowering| {
                    lowering.lower_for_loop(statement);
                });
            }
            None => {
                if init.is_some() {
                    // The source map knows no `let` in the head of a loop.
                    self.joined_declarations_end = Some(self.file.hir[statement].start);
                    self.lower_statement(init);
                }
                self.lower_for_loop(statement);
            }
        }
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
        if self.file.decisions().is_dead_stmt(body) {
            self.lower_decided_test(test);
            self.hold_names_of_removed_statement(body);
            return;
        }
        let scope = self.file.bound.own_scope(statement);
        let copied_scope = (scope.is_some() && is_let_declaration(hir, init)).then_some(scope);
        if let Some(scope) = copied_scope {
            self.copy_iteration_bindings(scope);
        }
        let body_block = self.create_block();
        let update_block = self.create_block();
        let after = self.create_block();
        let header = self.begin_loop(statement);
        let recorded = match test.some() {
            Some(test) => self.lower_loop_test(test, body_block, after),
            None => {
                self.jump(body_block);
                None
            }
        };
        self.continue_in(body_block);

        self.lower_loop_body(statement, body, after, update_block);
        self.jump(update_block);
        self.continue_in(update_block);

        if let Some(scope) = copied_scope {
            self.copy_iteration_bindings(scope);
        }
        if update.is_some() {
            self.lower_expression_for_effect(update);
        }
        self.jump(header);
        self.builder.seal(header);
        self.continue_in(after);
        self.record_again(recorded);
    }
}
