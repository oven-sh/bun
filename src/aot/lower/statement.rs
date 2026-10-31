mod declarations;
mod loops;
mod substitution;

pub(in crate::lower) use substitution::Printed;

use bun_sema::bind::ScopeId;
use bun_sema::fold::is_removed_where_never_run;
use bun_sema::hir::{
    ExprId, ExprKind, Flags, FnBody, FnId, IdList, PatKind, StmtId, StmtKind, VarKind,
};

use super::control::BreakTargetKind;
use super::{FileLowering, FunctionLowering, commonjs, dispose, module};
use crate::builtins::SourceDialect;
use crate::ir::BlockId;

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_statements(&mut self, statements: IdList<StmtId>) {
        let hir = self.file.hir;
        for index in 0..statements.len {
            let statement = hir.id_at(statements, index as usize);
            if self.file.decisions().is_dead_stmt(statement) {
                self.hold_names_of_removed_statement(statement);
                continue;
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

    // `exports.a = class extends B {}`
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

    fn lower_statement_in_place(&mut self, statement: StmtId) {
        let left_out = self.file.inputs.library_functions.left_out_declarations();
        if left_out.is_statement_left_out(self.file.file, statement) {
            self.lower_checks_of_left_out_store(statement);
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
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => {}
            StmtKind::Import(import) => self.lower_import(import),
            StmtKind::Expr(expression) => {
                let were_suspended = self.builder.suspend_records(true);
                if self.file.is_left_by_transpiler(statement) {
                    self.builder.suspend_records(were_suspended);
                }
                if !self.try_lower_exports_statement(expression) {
                    self.lower_expression_for_effect(expression);
                }
                self.builder.suspend_records(were_suspended);
            }
            StmtKind::Var(declarations) => {
                let has_pattern = self.file.declares_pattern(statement);
                let mut mapped = joined_declarations_end.unwrap_or(stmt.start);
                for declaration in declarations.iter() {
                    self.lower_variable_declaration(declaration, mapped);
                    if has_pattern && !self.file.is_initializer_moved(declaration) {
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
                let recorded = self.file.last_mapped_position(expression);
                self.builder.record_position(recorded);
                self.set_position(recorded);
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
            self.lower_decided_test(test);
            self.hold_names_of_removed_statement(yes);
            if has_live_else {
                self.lower_statement(no);
            }
            return;
        }
        if no.is_some() && !has_live_else {
            self.lower_decided_test(test);
            self.hold_names_of_removed_statement(no);
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
    fn is_left_by_transpiler(&self, statement: StmtId) -> bool {
        let position = self.hir[statement].start;
        let transpiled = self.transpiled.as_ref();
        transpiled.is_none_or(|transpiled| transpiled.has_statement_at(position))
    }

    // Whether Bun's transpiler prints anything for the statement.
    fn is_printed(&self, statement: StmtId) -> bool {
        match self.hir[statement].kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Empty => false,
            StmtKind::Var(declarations) => {
                let mut declarations = declarations.iter();
                declarations.any(|declaration| !self.is_initializer_moved(declaration))
            }
            StmtKind::Block(statements) => {
                let mut inner = self.hir.ids(statements);
                inner.any(|inner| self.is_printed(inner))
            }
            StmtKind::If { yes, no, .. } => {
                self.is_left_by_transpiler(statement)
                    || self.is_printed(yes)
                    || (no.is_some() && self.is_printed(no))
            }
            StmtKind::Fn(_)
            | StmtKind::Class(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::Directive { .. } => {
                !self.decisions().is_dead_stmt(statement)
                    || !is_removed_where_never_run(self.hir, statement)
            }
            StmtKind::Debugger
            | StmtKind::Expr(_)
            | StmtKind::Return(_)
            | StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf { .. }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. }
            | StmtKind::Switch { .. }
            | StmtKind::Try { .. }
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_)
            | StmtKind::Labeled { .. }
            | StmtKind::With { .. } => self.is_left_by_transpiler(statement),
        }
    }

    // The last token of a function that the source map of Bun's transpiler knows. It knows the `{` of a block and not its `}`.
    pub(in crate::lower) fn last_mapped_function_position(&self, function: FnId) -> Option<u32> {
        let hir = self.hir;
        match hir[function].body {
            FnBody::None => None,
            FnBody::Expr(body) => Some(self.last_mapped_position(body)),
            FnBody::Block(statements) => self.last_mapped_list_position(statements).or_else(|| {
                let bodies = &hir.body_starts;
                let found = bodies.binary_search_by_key(&function.0, |body| body.0.0);
                found.ok().map(|index| bodies[index].1)
            }),
        }
    }

    // Behind a statement that leaves the list only the declarations of functions and of `var` variables are printed.
    pub(in crate::lower) fn last_mapped_list_position(
        &self,
        statements: IdList<StmtId>,
    ) -> Option<u32> {
        let hir = self.hir;
        let leaves = |statement: StmtId| {
            matches!(
                hir[statement].kind,
                StmtKind::Return(_)
                    | StmtKind::Throw(_)
                    | StmtKind::Break(_)
                    | StmtKind::Continue(_)
            )
        };
        let reached = match hir.ids(statements).position(leaves) {
            Some(last) => last + 1,
            None => statements.len as usize,
        };
        let mut unreached = hir.ids(statements).skip(reached).rev();
        let hoisted = unreached.find_map(|statement| match hir[statement].kind {
            StmtKind::Fn(function) => self.last_mapped_function_position(function),
            StmtKind::Var(declarations) => {
                let last = declarations.iter().last()?;
                let is_var = self.bound.variable_kind(hir, last) == VarKind::Var;
                self.last_mapped_pattern_position(is_var.then_some(hir[last].pat)?)
            }
            _ => None,
        });
        hoisted.or_else(|| {
            let mut reached = hir.ids(statements).take(reached).rev();
            reached.find_map(|statement| self.last_mapped_statement_position(statement))
        })
    }

    // A block that belongs to its statement is printed even if it is empty.
    fn last_mapped_block_position(&self, block: StmtId, open_brace: u32) -> u32 {
        let inner = match self.hir[block].kind {
            StmtKind::Block(statements) => self.last_mapped_list_position(statements),
            _ => self.last_mapped_statement_position(block),
        };
        inner.unwrap_or(open_brace)
    }

    // The body of a loop, an `if` or a label. Nothing is mapped for an empty statement, which leaves `head`.
    fn last_mapped_body_position(&self, body: StmtId, head: u32) -> u32 {
        match self.hir[body].kind {
            StmtKind::Empty => head,
            _ => self.last_mapped_block_position(body, self.hir[body].start),
        }
    }

    // None for a statement of which nothing is printed.
    fn last_mapped_statement_position(&self, statement: StmtId) -> Option<u32> {
        let hir = self.hir;
        let stmt = hir[statement];
        let last_of = |expression: ExprId| self.last_mapped_position(expression);
        let is_printed = |inner: StmtId| self.last_mapped_statement_position(inner).is_some();
        if !self.is_printed(statement) {
            return None;
        }
        let position = match stmt.kind {
            StmtKind::Empty
            | StmtKind::Directive { .. }
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_) => return None,
            StmtKind::Expr(value) => last_of(value),
            StmtKind::Throw(value) => last_of(value),
            StmtKind::Return(value) => value.some().map_or(stmt.start, last_of),
            StmtKind::Var(declarations) => {
                let mut declarations = declarations.iter().rev();
                let last = declarations.find(|&last| !self.is_initializer_moved(last))?;
                self.last_mapped_declaration_position(last, stmt.start)
            }
            StmtKind::Fn(function) => return self.last_mapped_function_position(function),
            // One branch is printed in place of the statement, or nothing.
            StmtKind::If { yes, no, .. } if !self.is_left_by_transpiler(statement) => {
                let branch = self.last_mapped_statement_position(yes);
                return branch.or_else(|| self.last_mapped_statement_position(no.some()?));
            }
            StmtKind::If { test, yes, no } => match no.some().filter(|&no| is_printed(no)) {
                Some(no) => self.last_mapped_body_position(no, stmt.start),
                None => self.last_mapped_body_position(yes, last_of(test)),
            },
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                let head = match (update.some(), test.some(), init.some()) {
                    (Some(last), _, _) | (None, Some(last), _) => last_of(last),
                    (None, None, Some(init)) => self
                        .last_mapped_statement_position(init)
                        .unwrap_or(stmt.start),
                    (None, None, None) => stmt.start,
                };
                self.last_mapped_body_position(body, head)
            }
            StmtKind::ForIn { expr, body, .. } | StmtKind::ForOf { expr, body, .. } => {
                self.last_mapped_body_position(body, last_of(expr))
            }
            StmtKind::While { test, body } => self.last_mapped_body_position(body, last_of(test)),
            StmtKind::With { object, body } => {
                self.last_mapped_body_position(body, last_of(object))
            }
            StmtKind::DoWhile { test, .. } => last_of(test),
            StmtKind::Labeled { body, .. } => self.last_mapped_body_position(body, stmt.start),
            // A block of its own keeps its braces, of which the `}` is mapped too, unless it holds one statement that declares nothing in it.
            StmtKind::Block(statements) => {
                let mut printed = hir.ids(statements).filter(|&inner| is_printed(inner));
                match (printed.next()?, printed.next()) {
                    (only, None) if !self.declares_in_block(only) => {
                        return self.last_mapped_statement_position(only);
                    }
                    _ => stmt.loc.end - 1,
                }
            }
            StmtKind::Switch { expr, cases } => match cases.iter().last() {
                Some(case) => {
                    let case = hir[case];
                    let label = || case.test.some().map_or(case.pos, last_of);
                    self.last_mapped_list_position(case.body)
                        .unwrap_or_else(label)
                }
                None => last_of(expr),
            },
            StmtKind::Try {
                handler, finalizer, ..
            } => match finalizer.some() {
                Some(finalizer) => {
                    let keyword_end = hir[finalizer].start + "finally".len() as u32;
                    let open_brace = self.next_token_position(keyword_end);
                    self.last_mapped_block_position(finalizer, open_brace)
                }
                None => self.last_mapped_body_position(handler.some()?, stmt.start),
            },
            StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Debugger => stmt.start,
            // The function that fills the object is called with its name.
            StmtKind::Enum(declaration) => hir[declaration].name_pos,
            _ => stmt.loc.end - 1,
        };
        Some(position)
    }

    fn declares_in_block(&self, statement: StmtId) -> bool {
        match self.hir[statement].kind {
            StmtKind::Var(declarations) => declarations
                .iter()
                .next()
                .is_some_and(|first| self.bound.variable_kind(self.hir, first) != VarKind::Var),
            StmtKind::Fn(_) | StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Module(_) => true,
            _ => false,
        }
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
        let previous = hir
            .ids(earlier)
            .rev()
            .find(|&earlier| self.is_printed(earlier))?;
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
        let mut declarations = declarations.iter().rev();
        let last = declarations.find(|&last| !self.is_initializer_moved(last))?;
        Some(self.last_mapped_declaration_position(last, hir[previous].start))
    }
}
