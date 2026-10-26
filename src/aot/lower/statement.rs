mod declarations;
mod loops;

use bun_sema::bind::{Binding, ScopeId, SymbolId};
use bun_sema::hir::{
    ExprId, ExprKind, Flags, IdList, PatKind, StmtId, StmtKind, VarDeclId, VarKind,
};

use super::control::BreakTargetKind;
use super::{FileLowering, FunctionLowering, commonjs, dispose, module};
use crate::builtins::SourceDialect;
use crate::ir::BlockId;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_statements(&mut self, statements: IdList<StmtId>) {
        let hir = self.file.hir;
        let mut looked_ahead_to = 0;
        for index in 0..statements.len {
            let statement = hir.id_at(statements, index as usize);
            if self.file.decisions().is_dead_stmt(statement) {
                continue;
            }
            self.returned_declaration = None;
            if index >= looked_ahead_to {
                let rest = IdList::new(statements.start + index, statements.len - index);
                let (returned, count) = self.file.find_returned_declaration(rest);
                self.returned_declaration = returned;
                looked_ahead_to = index + count;
            }
            if dispose::find_resource_declarations(hir, statement).is_some() {
                let rest = IdList::new(statements.start + index, statements.len - index);
                self.lower_statements_with_resources(rest);
                return;
            }
            let earlier = IdList::new(statements.start, index);
            self.joined_declarations_end =
                self.file.find_joined_declarations_end(earlier, statement);
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
        let joined_declarations_end = self.joined_declarations_end.take();
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
                let has_pattern = self.file.declares_pattern(statement);
                let mut mapped = joined_declarations_end.unwrap_or(stmt.start);
                for declaration in declarations.iter() {
                    self.lower_variable_declaration(declaration, mapped);
                    if has_pattern {
                        mapped = self
                            .file
                            .last_mapped_declaration_position(declaration, mapped);
                    }
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

impl FileLowering<'_, '_, '_, '_> {
    // The last variable of a `let` or `const` statement, if Bun's transpiler prints its initializer in place of its only use.
    fn find_variable_used_once(&self, statement: StmtId) -> Option<(VarDeclId, SymbolId)> {
        let (hir, bound) = (self.hir, self.bound);
        let StmtKind::Var(declarations) = hir[statement].kind else {
            return None;
        };
        let declaration = declarations.iter().last()?;
        let decl = hir[declaration];
        let is_plain = matches!(hir[decl.pat].kind, PatKind::Ident(_))
            && matches!(
                bound.variable_kind(hir, declaration),
                VarKind::Let | VarKind::Const
            )
            && decl.init.is_some()
            && decl.ty.is_none()
            && !decl.flags.intersects(Flags::AMBIENT | Flags::EXPORT);
        let Binding::Symbol(symbol) = bound.initialized_binding(decl.pat) else {
            return None;
        };
        let is_substituted = is_plain
            && self.scopes.is_used_once(symbol)
            && !bound.is_visible_to_eval(symbol)
            && bound.symbol_scope(symbol) != module::file_scope(self);
        is_substituted.then_some((declaration, symbol))
    }

    fn reads_variable(&self, expression: ExprId, symbol: SymbolId) -> bool {
        let name = self.skip_type_syntax(expression);
        matches!(self.hir[name].kind, ExprKind::Ident(_))
            && self.bound.binding(name) == Binding::Symbol(symbol)
    }

    // `const a = f(); const b = a; return b;` is printed `return f();`, which has `f()` in tail position.
    // The declaration of `a` with the position of the `return`, and how many statements have been looked at.
    fn find_returned_declaration(
        &self,
        statements: IdList<StmtId>,
    ) -> (Option<(VarDeclId, u32)>, u32) {
        let hir = self.hir;
        let Some((first, mut symbol)) = self.find_variable_used_once(hir.id_at(statements, 0))
        else {
            return (None, 1);
        };
        for index in 1..statements.len {
            let statement = hir.id_at(statements, index as usize);
            match hir[statement].kind {
                StmtKind::Return(value)
                    if value.is_some() && self.reads_variable(value, symbol) =>
                {
                    return (Some((first, hir[statement].start)), index);
                }
                StmtKind::Var(declarations) if declarations.len() == 1 => {
                    let Some((declaration, next)) = self.find_variable_used_once(statement) else {
                        return (None, index);
                    };
                    if !self.reads_variable(hir[declaration].init, symbol) {
                        return (None, index);
                    }
                    symbol = next;
                }
                _ => return (None, index),
            }
        }
        (None, statements.len)
    }

    fn declares_pattern(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        let StmtKind::Var(declarations) = hir[statement].kind else {
            return false;
        };
        let mut patterns = declarations
            .iter()
            .map(|declaration| hir[hir[declaration].pat].kind);
        patterns.any(|pattern| matches!(pattern, PatKind::Object(_) | PatKind::Array(_)))
    }

    // `const a = f(); const [b] = c;` is printed `const a = f(), [b] = c;`.
    fn find_joined_declarations_end(
        &self,
        earlier: IdList<StmtId>,
        statement: StmtId,
    ) -> Option<u32> {
        let hir = self.hir;
        let head_of = |statement: StmtId| match hir[statement].kind {
            StmtKind::Var(declarations) => declarations.iter().next().map(|head| hir[head]),
            _ => None,
        };
        if !self.declares_pattern(statement) {
            return None;
        }
        let head = head_of(statement)?;
        let is_printed = |&earlier: &StmtId| {
            let is_type = matches!(
                hir[earlier].kind,
                StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Empty
            );
            !is_type && !self.decisions().is_dead_stmt(earlier)
        };
        let previous = hir.ids(earlier).rev().find(is_printed)?;
        let previous_head = head_of(previous)?;
        let is_exported = |flags: Flags| flags.contains(Flags::EXPORT);
        let is_ambient = previous_head.flags.contains(Flags::AMBIENT);
        if is_ambient
            || previous_head.kind != head.kind
            || is_exported(previous_head.flags) != is_exported(head.flags)
        {
            return None;
        }
        let StmtKind::Var(declarations) = hir[previous].kind else {
            return None;
        };
        let last = declarations.iter().last()?;
        Some(self.last_mapped_declaration_position(last, hir[previous].start))
    }
}
