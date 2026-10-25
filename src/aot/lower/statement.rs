mod declarations;
mod loops;

use bun_sema::bind::ScopeId;
use bun_sema::hir::{ExprId, ExprKind, IdList, StmtId, StmtKind};

use super::control::BreakTargetKind;
use super::{FunctionLowering, commonjs, dispose, module};
use crate::builtins::SourceDialect;
use crate::ir::BlockId;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_statements(&mut self, statements: IdList<StmtId>) {
        let hir = self.file.hir;
        for index in 0..statements.len {
            let statement = hir.id_at(statements, index as usize);
            if self.file.decisions().is_dead_stmt(statement) {
                continue;
            }
            if dispose::find_resource_declarations(hir, statement).is_some() {
                let rest = IdList::new(statements.start + index, statements.len - index);
                self.lower_statements_with_resources(rest);
                return;
            }
            self.lower_statement(statement);
        }
    }

    pub(crate) fn lower_file_statements(&mut self) {
        let hir = self.file.hir;
        for statement in hir.ids(hir.body) {
            if module::is_moved_to_file_start(self.file, statement)
                && !self.file.decisions().is_dead_stmt(statement)
            {
                self.lower_statement_in_place(statement);
            }
        }
        self.lower_statements(hir.body);
    }

    pub(crate) fn lower_statement(&mut self, statement: StmtId) {
        if !module::is_moved_to_file_start(self.file, statement) {
            self.lower_statement_in_place(statement);
        }
    }

    fn lower_statement_in_place(&mut self, statement: StmtId) {
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        if left_out.is_statement_left_out(self.file.file, statement) {
            return;
        }
        if commonjs::is_erased(self.file, statement) {
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
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => {}
            StmtKind::Expr(expression) => {
                if !self.try_lower_exports_statement(expression) {
                    self.lower_expression_for_effect(expression);
                }
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    self.lower_variable_declaration(declaration);
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
                self.set_position(stmt.start);
                self.emit_throw(value);
            }
            StmtKind::Break(_) => self.lower_break(statement),
            StmtKind::Continue(_) => self.lower_continue(statement),
            StmtKind::Block(statements) => {
                let scope = self.enter_own_scope(statement);
                self.lower_statements(statements);
                self.leave_own_scope(scope);
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
        // Nobody gets what the body of a module returns.
        if self.drops_returned_value() {
            self.lower_expression_for_effect(expression);
            self.emit_empty_return();
            return;
        }
        let value = self.lower_tail_expression(expression);
        let value = self.expect_returned_parse(expression, value);
        let value = self.await_in_async_generator(value);
        self.emit_return(value, Some(expression));
    }

    fn lower_if(&mut self, test: ExprId, yes: StmtId, no: StmtId) {
        let decisions = self.file.decisions();
        let has_live_else = no.is_some() && !decisions.is_dead_stmt(no);
        if decisions.is_dead_stmt(yes) {
            self.lower_expression_for_effect(test);
            if has_live_else {
                self.lower_statement(no);
            }
            return;
        }
        if no.is_some() && !has_live_else {
            self.lower_expression_for_effect(test);
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
