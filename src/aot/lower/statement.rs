mod declarations;
mod loops;

use bun_sema::bind::ScopeId;
use bun_sema::hir::{ExprId, ExprKind, IdList, StmtId, StmtKind};

use super::control::BreakTargetKind;
use super::{FunctionLowering, commonjs, dispose, module, scope};
use crate::builtins::SourceDialect;
use crate::ir::BlockId;
use crate::modules::Member;

pub(in crate::lower) fn statements_behind(list: IdList<StmtId>, index: u32) -> IdList<StmtId> {
    let passed = index + 1;
    IdList::new(list.start + passed, list.len - passed)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_statements(&mut self, statements: IdList<StmtId>) {
        let hir = self.file.hir;
        for index in 0..statements.len {
            let statement = hir.id_at(statements, index as usize);
            self.move_environments_put_off(statements.start + index);
            if self.file.decisions().is_dead_stmt(statement) {
                self.count_statement(statement);
                continue;
            }
            if dispose::find_resource_declarations(hir, statement).is_some() {
                let rest = IdList::new(statements.start + index, statements.len - index);
                self.lower_statements_with_resources(rest);
                return;
            }
            self.file.queries.note_idle_between_statements();
            self.lower_statement_in_list(statement, statements_behind(statements, index));
        }
    }

    pub(crate) fn lower_file_statements(&mut self) {
        let hir = self.file.hir;
        self.count_file_body();
        for statement in hir.ids(hir.body) {
            if module::is_moved_to_file_start(self.file, statement)
                && !self.file.decisions().is_dead_stmt(statement)
            {
                self.lower_statement_in_place(statement, IdList::EMPTY);
            }
        }
        self.lower_statements(hir.body);
    }

    pub(crate) fn lower_statement(&mut self, statement: StmtId) {
        self.lower_statement_in_list(statement, IdList::EMPTY);
    }

    pub(in crate::lower) fn lower_statement_in_list(
        &mut self,
        statement: StmtId,
        behind: IdList<StmtId>,
    ) {
        if !module::is_moved_to_file_start(self.file, statement) {
            self.lower_statement_in_place(statement, behind);
        }
    }

    fn lower_checks_of_left_out_store(&mut self, statement: StmtId) {
        let hir = self.file.hir;
        let StmtKind::Expr(mut expression) = hir[statement].kind else {
            return;
        };
        loop {
            expression = match hir[hir.skip_type_assertions(expression)].kind {
                ExprKind::Assign {
                    op: None, value, ..
                } => value,
                ExprKind::Class(class) => return self.lower_checks_of_left_out_class(class),
                _ => return,
            };
        }
    }

    fn is_export_definition(&self, statement: StmtId) -> bool {
        let hir = self.file.hir;
        let StmtKind::Expr(expression) = hir[statement].kind else {
            return false;
        };
        let call = self.file.skip_type_syntax(expression);
        let member = self.file.inputs.modules.member(self.file.file, call);
        matches!(hir[call].kind, ExprKind::Call(_))
            && !matches!(member, None | Some(Member::OnObject))
    }

    fn lower_read_of_unmade_callee(&mut self, statement: StmtId) {
        let hir = self.file.hir;
        if !self.file.inputs.modules.is_placeholder(self.file.file)
            && let StmtKind::Expr(expression) = hir[statement].kind
            && let ExprKind::Call(site) = hir[self.file.skip_type_syntax(expression)].kind
        {
            self.set_position(hir[statement].start);
            self.lower_read_of_locked_path(self.file.skip_type_syntax(hir[site].callee));
        }
    }

    fn lower_statement_in_place(&mut self, statement: StmtId, behind: IdList<StmtId>) {
        if self.file.hir.is_in_jsdoc(self.file.hir[statement].start) {
            return;
        }
        if self.file.counted_places.is_some() {
            self.count_statement(statement);
        }
        if commonjs::is_erased(self.file, statement) {
            self.lower_read_of_unmade_callee(statement);
            return;
        }
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        if left_out.is_statement_left_out(self.file.file, statement) {
            if self.is_export_definition(statement) {
                self.lower_read_of_unmade_callee(statement);
            }
            self.lower_checks_of_left_out_store(statement);
            return;
        }
        let stmt = self.file.hir[statement];
        if !self.enter_nesting(stmt.start) {
            return;
        }
        self.set_position(stmt.start);
        match stmt.kind {
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Directive { .. }
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => {}
            StmtKind::Import(import) => self.lower_import(import),
            StmtKind::Expr(expression) => {
                if !self.try_lower_exports_statement(expression) {
                    self.lower_expression_for_effect(expression);
                }
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    self.lower_variable_declaration_in_list(declaration, behind);
                }
            }
            StmtKind::Fn(function) => {
                let implicit_block = self.enter_own_scope(statement);
                self.lower_function_declaration(function);
                self.leave_own_scope(implicit_block);
            }
            StmtKind::Class(class) => self.lower_class_statement(statement, class),
            StmtKind::Enum(declaration) => self.lower_enum(declaration),
            StmtKind::Module(declaration) => self.lower_namespace(declaration),
            StmtKind::ImportEquals(declaration) => self.lower_import_equals(declaration),
            StmtKind::ExportAssign(expression) => self.lower_export_assignment(expression),
            StmtKind::ExportDefault(expression) => self.lower_export_default(statement, expression),
            StmtKind::Return(expression) => self.lower_return(expression),
            StmtKind::If { test, yes, no } => self.lower_if(test, yes, no),
            StmtKind::For { init, .. } => self.lower_for(statement, init),
            StmtKind::While { test, body } => self.lower_while(statement, test, body),
            StmtKind::DoWhile { body, test } => self.lower_do_while(statement, body, test),
            StmtKind::ForIn { .. } => self.lower_for_in(statement),
            StmtKind::ForOf { .. } => self.lower_for_of(statement),
            StmtKind::Switch { expr, cases } => self.lower_switch(statement, expr, cases),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => self.lower_try(statement, block, param, handler, finalizer),
            StmtKind::Throw(expression) => {
                let value = self.lower_expression(expression);
                self.set_position(self.file.last_token_position_of(expression));
                self.emit_throw(value);
            }
            StmtKind::Break(_) => self.lower_break(statement),
            StmtKind::Continue(_) => self.lower_continue(statement),
            StmtKind::Block(statements) => {
                let own = self.file.bound.own_scope(statement);
                if own.is_some() {
                    self.enter_scope_made_by(own, scope::MakerOfScope::HereWhenAskedFor);
                    self.give_list_to_scope(own, statements);
                }
                self.lower_statements(statements);
                self.leave_own_scope(own);
            }
            StmtKind::Labeled { body, .. } => self.lower_labeled(statement, body),
            StmtKind::With { object, body } => self.lower_with(statement, object, body),
        }
        self.leave_nesting();
    }

    pub(in crate::lower) fn enter_own_scope(&mut self, statement: StmtId) -> ScopeId {
        let scope = self.file.bound.own_scope(statement);
        if scope.is_some() {
            self.enter_scope(scope);
        }
        scope
    }

    pub(in crate::lower) fn leave_own_scope(&mut self, scope: ScopeId) {
        if scope.is_some() {
            self.leave_scope(scope);
        }
    }

    fn lower_return(&mut self, expression: ExprId) {
        if expression.is_none() {
            self.emit_empty_return();
            return;
        }
        if self.drops_returned_value() {
            self.lower_taken_value_for_effect(expression);
            self.emit_empty_return();
            return;
        }
        let value = self.lower_tail_expression(expression);
        let value = self.await_in_async_generator(value);
        self.emit_return(value, Some(expression));
    }

    fn lower_if(&mut self, test: ExprId, yes: StmtId, no: StmtId) {
        let hir = self.file.hir;
        let holds_nothing = |arm: StmtId| match arm.some().map(|arm| hir[arm].kind) {
            None | Some(StmtKind::Empty) => true,
            Some(StmtKind::Block(statements)) => statements.len == 0,
            Some(_) => false,
        };
        if holds_nothing(yes)
            && holds_nothing(no)
            && self.file.reads_only_what_bun_run_leaves_out(test, true)
        {
            return;
        }
        let decisions = self.file.decisions();
        let has_live_else = no.is_some() && !decisions.is_dead_stmt(no);
        if decisions.is_dead_stmt(yes) {
            let in_bun_run = decisions.as_folded_by_bun_run();
            self.lower_test_with_known_answer(test, in_bun_run.is_dead_stmt(yes));
            if has_live_else {
                self.lower_statement(no);
            }
            return;
        }
        if no.is_some() && !has_live_else {
            let in_bun_run = decisions.as_folded_by_bun_run();
            self.lower_test_with_known_answer(test, in_bun_run.is_dead_stmt(no));
            self.lower_statement(yes);
            return;
        }

        let then_block = self.create_block_of_arm(yes);
        let after = self.create_block();
        let else_block = no.some().map(|no| self.create_block_of_arm(no));
        self.lower_condition(test, then_block, else_block.unwrap_or(after));
        self.lower_if_arm(then_block, yes, after);
        if let Some(else_block) = else_block {
            self.lower_if_arm(else_block, no, after);
        }
        self.continue_in(after);
    }

    fn create_block_of_arm(&mut self, arm: StmtId) -> BlockId {
        let hir = self.file.hir;
        if self.file.source.dialect() == SourceDialect::Runtime
            && let StmtKind::Block(statements) = hir[arm].kind
            && statements.len != 0
            && let StmtKind::Expr(first) | StmtKind::Directive { expr: first, .. } =
                hir[hir.id_at(statements, 0)].kind
            && let ExprKind::String(text) = hir[first].kind
            && self.file.queries.atom_bytes(text) == b"unlikely"
        {
            return self.create_unlikely_block();
        }
        self.create_block()
    }

    fn lower_if_arm(&mut self, block: BlockId, statement: StmtId, after: BlockId) {
        self.continue_in(block);
        self.lower_statement(statement);
        self.jump(after);
    }

    fn lower_labeled(&mut self, statement: StmtId, body: StmtId) {
        let after = self.create_block();
        self.push_break_target(statement, BreakTargetKind::Label, after);
        self.lower_statement(body);
        self.pop_jump_target();
        self.jump(after);
        self.continue_in(after);
    }

    fn lower_with(&mut self, statement: StmtId, object: ExprId, body: StmtId) {
        let value = self.lower_expression(object);
        let object = self.builder.to_object(value, None);
        let scope = self.file.bound.own_scope(statement);
        self.enter_with_scope(scope, object);
        self.lower_statement(body);
        self.leave_scope(scope);
    }
}
