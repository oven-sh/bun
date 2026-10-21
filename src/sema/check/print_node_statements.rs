//! printer.go: statements and declarations, for `NodePrinter`.

use super::print::OperatorPrecedence as P;
use super::print_node::{Child, Emitted, NodePrinter, NodeState, Stop, lf};
use super::spans::{skip_trivia_back, token_end};
use super::*;
use crate::atom::known;
use crate::util::SharedSort;

impl NodePrinter<'_, '_, '_> {
    /// `emitStatement`
    #[optimize(size)]
    pub(super) fn emit_statement(&mut self, s: StmtId) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        // The parser has given up a statement that is nested too deeply.
        let Some(&Stmt { kind, start, loc }) = hir.stmts.get(s.idx()) else {
            return Err(Stop::OutOfStack);
        };
        let node = (loc.pos as usize, self.end_of_statement(s));
        match kind {
            // A `MissingDeclaration`, which starts with its modifiers: nothing is emitted.
            StmtKind::Empty if self.byte(start as usize) != b';' => Ok(()),
            // `emitEmptyStatement`
            StmtKind::Empty => {
                let state = self.enter_node(node.0, node.1);
                self.write(b";");
                self.exit_node(state);
                Ok(())
            }
            // `emitDebuggerStatement`
            StmtKind::Debugger => {
                let state = self.enter_node(node.0, node.1);
                self.emit_token(b"debugger", node.0, node);
                self.write(b";");
                self.exit_node(state);
                Ok(())
            }
            StmtKind::Expr(e) => match &self.labels_without_name(s, loc.end as usize)[..] {
                [] => self.emit_expression_statement(e, node),
                colons => self.emit_labels_without_name(node.0, colons),
            },
            StmtKind::Var(declarations) => self.emit_variable_statement(s, declarations, node),
            StmtKind::Fn(f) => {
                // `emitFunctionDeclaration`
                let state = self.enter_node(node.0, node.1);
                let modifiers = hir.stmt_modifiers(s);
                self.emit_modifier_list(node, modifiers, false)?;
                let at = self.end_of_modifiers(modifiers, node.0);
                self.emit_function_after_modifiers(f, at, node)?;
                self.exit_node(state);
                Ok(())
            }
            StmtKind::Class(class) => self.emit_class_declaration(s, class),
            StmtKind::Interface(i) => self.emit_interface_declaration(s, i, node),
            StmtKind::TypeAlias(a) => self.emit_type_alias_declaration(s, a, node),
            StmtKind::Enum(e) => self.emit_enum_declaration(s, e, node),
            StmtKind::Module(m) => self.emit_module_declaration(s, m, node),
            StmtKind::Return(e) => self.emit_return_or_throw(b"return", e, node),
            StmtKind::Throw(e) => self.emit_return_or_throw(b"throw", e, node),
            StmtKind::If { test, yes, no } => self.emit_if_statement(node, test, yes, no),
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => self.emit_for_statement(node, init, (test, update), body),
            StmtKind::ForIn { left, expr, body } => {
                self.emit_for_in_or_of_statement(node, (b"in", false), left, expr, body)
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => self.emit_for_in_or_of_statement(node, (b"of", is_await), left, expr, body),
            StmtKind::While { test, body } => {
                // `emitWhileStatement`
                let state = self.enter_node(node.0, node.1);
                self.emit_while_clause(node, test, node.0)?;
                self.emit_embedded_statement(body)?;
                self.exit_node(state);
                Ok(())
            }
            StmtKind::DoWhile { body, test } => {
                // `emitDoStatement`
                let state = self.enter_node(node.0, node.1);
                self.emit_token(b"do", node.0, node);
                self.emit_embedded_statement(body)?;
                match self.is_block(body) {
                    true => self.write_space(),
                    false => self.write_line(),
                }
                self.emit_while_clause(node, test, self.end_of_statement(body))?;
                self.write(b";");
                self.exit_node(state);
                Ok(())
            }
            StmtKind::Block(list) if hir.is_with_statement(s) => {
                self.emit_with_statement(node, list)
            }
            // `emitBlock`
            StmtKind::Block(list) => {
                let statements = self.statements_of(list);
                self.emit_block_of_statements(node, &statements, true)
            }
            StmtKind::Switch { expr, cases } => self.emit_switch_statement(node, expr, cases),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => self.emit_try_statement(node, block, (param, handler), finalizer),
            StmtKind::Break(label) => self.emit_break_or_continue(b"break", label, node),
            StmtKind::Continue(label) => self.emit_break_or_continue(b"continue", label, node),
            StmtKind::Labeled { body, .. } => self.emit_labeled_statement(node, body),
            StmtKind::Import(i) => self.emit_import_declaration(s, i, node),
            StmtKind::ImportEquals(i) => self.emit_import_equals_declaration(s, i, node),
            StmtKind::ExportNamed(x) => self.emit_export_declaration(s, node, Some(x)),
            StmtKind::ExportStar { .. } => self.emit_export_declaration(s, node, None),
            StmtKind::ExportDefault(e) => self.emit_export_assignment(e, node, false),
            StmtKind::ExportAssign(e) => self.emit_export_assignment(e, node, true),
            StmtKind::ExportAsNamespace(name) => {
                self.emit_namespace_export_declaration(s, name, node)
            }
        }
    }

    // ───────────────────────────── lists of statements ─────────────────────────────

    /// The statements of `list` that are nodes: it also has stray decorators and statements of labels without a name.
    #[optimize(size)]
    pub(super) fn statements_of(&self, list: IdList<StmtId>) -> Vec<StmtId> {
        let hir = self.hir;
        let is_stray = |s: &StmtId| {
            let statement = hir.stmts.get(s.idx());
            statement.is_some_and(|it| self.is_stray_decorator(it))
        };
        let is_node = |s: &StmtId| !is_stray(s) && !self.is_statement_of_label_without_name(*s);
        hir.ids(list).filter(is_node).collect()
    }

    /// Whether `statement` is what the HIR has for a decorator of a `MissingDeclaration` or of a `this` parameter.
    #[optimize(size)]
    fn is_stray_decorator(&self, statement: &Stmt) -> bool {
        let is_own =
            |stray: &(u32, u32)| stray.0 == statement.start && statement.loc.end <= stray.1;
        matches!(statement.kind, StmtKind::Expr(_)) && self.hir.stray_decorators.iter().any(is_own)
    }

    /// `End()` of the statement `s`.
    #[optimize(size)]
    pub(super) fn end_of_statement(&self, s: StmtId) -> usize {
        let hir = self.hir;
        let Some(statement) = hir.stmts.get(s.idx()) else {
            return 0;
        };
        let end = statement.loc.end as usize;
        match statement.kind {
            StmtKind::Block(list) if !hir.is_with_statement(s) => {
                let last = hir.ids(list).next_back();
                let last = last.and_then(|last: StmtId| hir.stmts.get(last.idx()));
                let open_end = self.skip_trivia(statement.loc.pos as usize) + 1;
                self.end_of_block(end, last.map_or(open_end, |last| last.loc.end as usize))
            }
            _ => self.end_after_labels_without_name(s, end),
        }
    }

    // ───────────────────────────── labels without a name ─────────────────────────────

    /// `parseExpressionOrLabeledStatement` reads a `:` where a statement has to be as a label without a name.
    #[optimize(size)]
    fn skipped_colons_after(&self, end: usize) -> Vec<usize> {
        let skipped = &self.hir.after_skipped;
        let mut colons = Vec::new();
        let mut at = end;
        while !skipped.is_empty() {
            let colon = self.skip_trivia(at);
            let next = u32::try_from(self.skip_trivia(colon + 1)).unwrap_or(u32::MAX);
            if self.byte(colon) != b':' || skipped.binary_search(&next).is_err() {
                break;
            }
            at = colon + 1;
            colons.push(at);
        }
        colons
    }

    /// Whether the statement `s` ends with a statement that has to be there and is missing: one without a width.
    #[optimize(size)]
    fn ends_with_missing_statement(&self, s: StmtId) -> bool {
        let hir = self.hir;
        let mut s = s;
        loop {
            let Some(statement) = hir.stmts.get(s.idx()) else {
                return false;
            };
            s = match statement.kind {
                StmtKind::Expr(e) => {
                    let kind = hir.exprs.get(e.idx()).map(|it| it.kind);
                    return matches!(kind, Some(ExprKind::Missing))
                        && !hir::is_parenthesized(hir, e)
                        && statement.loc.pos == statement.loc.end;
                }
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::Labeled { body, .. } => body,
                StmtKind::If { yes, no, .. } if no.is_none() => yes,
                StmtKind::If { no, .. } => no,
                StmtKind::Block(list) if hir.is_with_statement(s) => match hir.ids(list).nth(1) {
                    Some(body) => body,
                    None => return false,
                },
                _ => return false,
            };
        }
    }

    /// The ends of the `:` of the labels without a name that the statement `s` ends with. `end`: its end in the HIR.
    #[optimize(size)]
    fn labels_without_name(&self, s: StmtId, end: usize) -> Vec<usize> {
        let colons = self.skipped_colons_after(end);
        match !colons.is_empty() && self.ends_with_missing_statement(s) {
            true => colons,
            false => Vec::new(),
        }
    }

    /// The statement of a label whose `:` ends at `colon_end`: the one that starts after it.
    #[optimize(size)]
    fn statement_after_colon(&self, colon_end: usize) -> Option<StmtId> {
        let start = self.skip_trivia(colon_end);
        let is_next = |it: &Stmt| it.loc.pos as usize == colon_end && it.start as usize == start;
        let index = self.hir.stmts.iter().position(is_next)?;
        Some(StmtId(u32::try_from(index).ok()?))
    }

    /// Whether `s` is the statement of a label without a name: it follows the skipped `:`s after a missing statement.
    #[optimize(size)]
    fn is_statement_of_label_without_name(&self, s: StmtId) -> bool {
        let hir = self.hir;
        let skipped = &hir.after_skipped;
        let Some(statement) = hir.stmts.get(s.idx()) else {
            return false;
        };
        let is_skipped_colon = |end: usize| {
            let next = u32::try_from(self.skip_trivia(end)).unwrap_or(u32::MAX);
            end > 0 && self.byte(end - 1) == b':' && skipped.binary_search(&next).is_ok()
        };
        let colon_end = statement.loc.pos as usize;
        if skipped.is_empty() || !is_skipped_colon(colon_end) {
            return false;
        }
        let mut at = colon_end;
        while is_skipped_colon(at) {
            at = self.pos_before(at - 1);
        }
        let is_missing = |it: &Stmt| {
            let is_empty = |e: ExprId| {
                let kind = hir.exprs.get(e.idx()).map(|it| it.kind);
                matches!(kind, Some(ExprKind::Missing)) && !hir::is_parenthesized(hir, e)
            };
            it.loc.pos == it.loc.end
                && it.loc.end as usize == at
                && matches!(it.kind, StmtKind::Expr(e) if is_empty(e))
                && !self.is_stray_decorator(it)
        };
        hir.stmts.iter().any(is_missing) && self.statement_after_colon(colon_end) == Some(s)
    }

    /// `End()` of `s`: after the labels without a name it ends with and their statement. `end`: its end in the HIR.
    #[optimize(size)]
    fn end_after_labels_without_name(&self, s: StmtId, end: usize) -> usize {
        let hir = self.hir;
        let (mut s, mut end) = (s, end);
        loop {
            let colons = self.labels_without_name(s, end);
            let Some(&last) = colons.last() else {
                return end;
            };
            let Some(body) = self.statement_after_colon(last) else {
                return last;
            };
            // A block ends where it ends in the HIR, or before a `=`: it has no label at its end.
            let is_block = matches!(hir.stmts.get(body.idx()), Some(it) if matches!(it.kind, StmtKind::Block(_)))
                && !hir.is_with_statement(body);
            if is_block {
                return self.end_of_statement(body);
            }
            (s, end) = (
                body,
                hir.stmts
                    .get(body.idx())
                    .map_or(last, |it| it.loc.end as usize),
            );
        }
    }

    /// `emitLabeledStatement` for the labels without a name that a statement at `pos` is. `colons`: the end of each.
    #[optimize(size)]
    fn emit_labels_without_name(&mut self, pos: usize, colons: &[usize]) -> Emitted {
        let Some(&last) = colons.last() else {
            return Ok(());
        };
        let body = self.statement_after_colon(last);
        let end = match body {
            Some(body) => self.end_of_statement(body),
            None => last,
        };
        let mut states: Vec<NodeState> = Vec::new();
        let mut label_pos = pos;
        for &colon_end in colons {
            let node = (label_pos, end);
            states.push(self.enter_node(node.0, node.1));
            // `emitLabelIdentifier`: an identifier that is missing has no text.
            self.emit_token(b":", label_pos, node);
            self.write_space();
            label_pos = colon_end;
        }
        match body {
            Some(body) => self.emit_statement(body)?,
            // An expression statement without an expression, where the last `:` ends.
            None => self.write(b";"),
        }
        while let Some(state) = states.pop() {
            self.exit_node(state);
        }
        Ok(())
    }

    /// `End()` of a block. `parseBlock` finishes it, then skips a `=` after its `}`: the HIR has that `=` in the block.
    #[optimize(size)]
    pub(super) fn end_of_block(&self, end: usize, after: usize) -> usize {
        if end > after + 1 && self.byte(end - 1) == b'=' {
            let close_end = skip_trivia_back(self.text, end - 1);
            if close_end > after && self.byte(close_end - 1) == b'}' {
                return close_end;
            }
        }
        end
    }

    /// `emitList(emitStatement, ..)`. `parent`, `list`: `Pos()` and `End()` of the node and of its list.
    #[optimize(size)]
    pub(super) fn emit_statement_list(
        &mut self,
        parent: (usize, usize),
        list: (usize, usize),
        statements: &[StmtId],
        format: u32,
    ) -> Emitted {
        let hir = self.hir;
        let children: Vec<Child> = statements
            .iter()
            .map(|&s| Child {
                pos: hir.stmts.get(s.idx()).map_or(0, |it| it.loc.pos as usize),
                end: self.end_of_statement(s),
            })
            .collect();
        self.emit_list(parent, Some(list), &children, format, |printer, index| {
            printer.emit_statement(statements[index])
        })
    }

    /// `emitTokenEx(KindCloseBraceToken, pos, .., contextNode, flags)`. `indents`: `tefIndentLeadingComments`.
    #[optimize(size)]
    fn emit_close_brace(&mut self, pos: usize, node: (usize, usize), indents: bool) {
        let start = self.skip_trivia(pos);
        if node.0 != pos {
            let needs_indent = indents && !self.on_same_line(pos, start);
            self.increase_indent_if(needs_indent);
            self.emit_leading_comments(pos);
            self.decrease_indent_if(needs_indent);
        }
        self.write(b"}");
        if node.1 != start + 1 {
            self.emit_trailing_comments(start + 1);
        }
    }

    /// `emitBlock`, `emitModuleBlock`. A block whose `{` is missing has no width, and neither has its list.
    #[optimize(size)]
    fn emit_block_of_statements(
        &mut self,
        node: (usize, usize),
        statements: &[StmtId],
        has_multi_line: bool,
    ) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        let open_end = self.emit_token(b"{", node.0, node);
        let is_missing = node.0 == node.1;
        let last = statements.last().map(|&last| self.end_of_statement(last));
        let list = match is_missing {
            true => (node.0, node.0),
            false => self.list_range(open_end, b'}', last, node.1),
        };
        // `node.MultiLine`: `hasPrecedingLineBreak` of the token after the `{`.
        let is_multi_line =
            has_multi_line && !is_missing && self.is_on_next_line(open_end, open_end);
        // `isEmptyBlock`
        let is_empty = statements.is_empty() && self.on_same_line(node.1, self.skip_trivia(node.0));
        let format = match !is_multi_line && is_empty {
            true => lf::SINGLE_LINE_BLOCK_STATEMENTS,
            false => lf::MULTI_LINE_BLOCK_STATEMENTS,
        };
        self.emit_statement_list(node, list, statements, format)?;
        self.emit_close_brace(list.1, node, format & lf::MULTI_LINE != 0);
        self.exit_node(state);
        Ok(())
    }

    /// `IsBlock`
    #[optimize(size)]
    fn is_block(&self, s: StmtId) -> bool {
        let hir = self.hir;
        let kind = hir.stmts.get(s.idx()).map(|it| it.kind);
        matches!(kind, Some(StmtKind::Block(_))) && !hir.is_with_statement(s)
    }

    /// `emitEmbeddedStatement`
    #[optimize(size)]
    fn emit_embedded_statement(&mut self, s: StmtId) -> Emitted {
        if self.is_block(s) {
            self.write_space();
            return self.emit_statement(s);
        }
        self.write_line();
        self.increase_indent();
        // `emitEmptyStatement(node, true)` writes what `emitStatement` writes.
        self.emit_statement(s)?;
        self.decrease_indent();
        Ok(())
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// The end in the source of the keyword `keyword` that follows `pos`. One with escapes is longer than its text.
    #[optimize(size)]
    fn keyword_end_after(&self, keyword: &[u8], pos: usize) -> usize {
        let start = self.skip_trivia(pos);
        self.token_end_at(keyword, start)
            .unwrap_or(start + keyword.len())
    }

    /// `emitExpressionStatement`
    #[optimize(size)]
    fn emit_expression_statement(&mut self, e: ExprId, node: (usize, usize)) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        // The parser builds no statement that starts with a function expression or object literal, but in parentheses.
        let leftmost = self.leftmost_expression(e);
        let is_declaration_like = !hir::is_parenthesized(hir, leftmost)
            && match hir.exprs.get(leftmost.idx()).map(|it| it.kind) {
                Some(ExprKind::Fn(f)) => hir[f].kind != FnKind::Arrow,
                Some(ExprKind::Object(_)) => true,
                _ => false,
            };
        let precedence = match is_declaration_like {
            true => P::Parentheses,
            false => P::Comma,
        };
        self.emit_expression(e, precedence)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitVariableStatement`
    #[optimize(size)]
    fn emit_variable_statement(
        &mut self,
        s: StmtId,
        declarations: Span<VarDeclId>,
        node: (usize, usize),
    ) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        let modifiers = hir.stmt_modifiers(s);
        self.emit_modifier_list(node, modifiers, false)?;
        let list_pos = self.end_of_modifiers(modifiers, node.0);
        // The list ends before the semicolon of the statement, after the tokens that the parser skipped.
        let last = declarations.iter().next_back();
        let after = last.map_or(list_pos, |last| hir[last].loc.end as usize);
        let semicolon = node.1.saturating_sub(1);
        let list_end = match self.byte(semicolon) == b';' && semicolon >= after {
            true => skip_trivia_back(self.text, semicolon),
            false => node.1,
        };
        self.emit_variable_declaration_list(declarations, list_pos, list_end)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitVariableDeclarationList` for the list from `pos` to `end`.
    #[optimize(size)]
    fn emit_variable_declaration_list(
        &mut self,
        declarations: Span<VarDeclId>,
        pos: usize,
        end: usize,
    ) -> Emitted {
        let hir = self.hir;
        let state = self.enter_declaration_list(pos, end);
        let start = self.skip_trivia(pos);
        // A list without a declaration has its keyword in the source only.
        let is_written = |keyword: &[u8]| self.token_end_at(keyword, start).is_some();
        let kind = match declarations.iter().next() {
            Some(first) => hir[first].kind,
            None if is_written(b"let") => VarKind::Let,
            None if is_written(b"const") => VarKind::Const,
            None if is_written(b"using") => VarKind::Using,
            None if is_written(b"await") => VarKind::AwaitUsing,
            None => VarKind::Var,
        };
        let mut keyword_end = token_end(self.text, start, false);
        match kind {
            VarKind::Var => self.write(b"var"),
            VarKind::Let => self.write(b"let"),
            VarKind::Const => self.write(b"const"),
            VarKind::Using => self.write(b"using"),
            VarKind::AwaitUsing => {
                self.write(b"await using");
                keyword_end = token_end(self.text, self.skip_trivia(keyword_end), false);
            }
        }
        self.write_space();
        let children: Vec<Child> = declarations
            .iter()
            .map(|d| Child {
                pos: hir[d].loc.pos as usize,
                end: hir[d].loc.end as usize,
            })
            .collect();
        let list = Some((keyword_end.min(end), end));
        let format = lf::VARIABLE_DECLARATION_LIST;
        self.emit_list((pos, end), list, &children, format, |printer, index| {
            printer.emit_variable_declaration(VarDeclId(declarations.start + index as u32))
        })?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitVariableDeclaration`
    #[optimize(size)]
    fn emit_variable_declaration(&mut self, d: VarDeclId) -> Emitted {
        let hir = self.hir;
        let Some(declaration) = hir.var_decls.get(d.idx()) else {
            return Ok(());
        };
        let node = (declaration.loc.pos as usize, declaration.loc.end as usize);
        let state = self.enter_node(node.0, node.1);
        self.emit_binding_name(declaration.pat)?;
        let name_end = self.end_of_binding_name(declaration.pat).max(node.0);
        // `ExclamationToken`
        if declaration.flags.contains(Flags::DEFINITE) {
            let exclamation_end = self.token_after(b"!", name_end).unwrap_or(name_end);
            self.emit_token_node(b"!", name_end, exclamation_end);
        }
        self.emit_type_annotation(declaration.ty)?;
        let at = self.end_of_type_annotation(declaration.ty, name_end);
        self.emit_initializer(declaration.init, at, node)?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitIfStatement`. The statements of an `else if` chain are nested as deeply as the chain is long.
    #[optimize(size)]
    fn emit_if_statement(
        &mut self,
        node: (usize, usize),
        test: ExprId,
        yes: StmtId,
        no: StmtId,
    ) -> Emitted {
        let hir = self.hir;
        let mut states: Vec<NodeState> = Vec::new();
        let (mut node, mut test, mut yes, mut no) = (node, test, yes, no);
        loop {
            states.push(self.enter_node(node.0, node.1));
            let at = self.emit_token(b"if", node.0, node);
            self.write_space();
            self.emit_token(b"(", at, node);
            self.emit_expression(test, P::Comma)?;
            self.emit_token(b")", self.end_of(test), node);
            self.emit_embedded_statement(yes)?;
            if no.is_none() {
                break;
            }
            self.write_line();
            self.emit_token(b"else", self.end_of_statement(yes), node);
            let Some(&Stmt {
                kind:
                    StmtKind::If {
                        test: inner_test,
                        yes: inner_yes,
                        no: inner_no,
                    },
                loc,
                ..
            }) = hir.stmts.get(no.idx())
            else {
                self.emit_embedded_statement(no)?;
                break;
            };
            self.write_space();
            node = (loc.pos as usize, self.end_of_statement(no));
            (test, yes, no) = (inner_test, inner_yes, inner_no);
        }
        while let Some(state) = states.pop() {
            self.exit_node(state);
        }
        Ok(())
    }

    /// `emitLabeledStatement`. The statements of `a: b: c: ..` are nested as deeply as the chain is long.
    #[optimize(size)]
    fn emit_labeled_statement(&mut self, node: (usize, usize), body: StmtId) -> Emitted {
        let hir = self.hir;
        let mut states: Vec<NodeState> = Vec::new();
        let (mut node, mut body) = (node, body);
        loop {
            states.push(self.enter_node(node.0, node.1));
            let label_end = token_end(self.text, self.skip_trivia(node.0), false);
            self.emit_source(node.0, label_end);
            self.emit_token(b":", label_end, node);
            self.write_space();
            let Some(&Stmt {
                kind: StmtKind::Labeled { body: inner, .. },
                loc,
                ..
            }) = hir.stmts.get(body.idx())
            else {
                self.emit_statement(body)?;
                break;
            };
            node = (loc.pos as usize, self.end_of_statement(body));
            body = inner;
        }
        while let Some(state) = states.pop() {
            self.exit_node(state);
        }
        Ok(())
    }

    /// `emitWhileClause`
    #[optimize(size)]
    fn emit_while_clause(&mut self, node: (usize, usize), test: ExprId, pos: usize) -> Emitted {
        let at = self.emit_token(b"while", pos, node);
        self.write_space();
        self.emit_token(b"(", at, node);
        self.emit_expression(test, P::Comma)?;
        self.emit_token(b")", self.end_of(test), node);
        Ok(())
    }

    /// `emitForInitializer` for the initializer of a `for`, which the HIR has as a statement. Returns its `End()`.
    #[optimize(size)]
    fn emit_for_initializer(&mut self, init: StmtId) -> Result<Option<usize>, Stop> {
        let hir = self.hir;
        let Some(&Stmt { kind, loc, .. }) = hir.stmts.get(init.idx()) else {
            return Ok(None);
        };
        match kind {
            StmtKind::Var(declarations) => {
                let (pos, end) = (loc.pos as usize, loc.end as usize);
                self.emit_variable_declaration_list(declarations, pos, end)?;
                Ok(Some(end))
            }
            StmtKind::Expr(e) => {
                self.emit_expression(e, P::Comma)?;
                Ok(Some(self.end_of(e)))
            }
            _ => Ok(None),
        }
    }

    /// `emitForStatement`
    #[optimize(size)]
    fn emit_for_statement(
        &mut self,
        node: (usize, usize),
        init: StmtId,
        (test, update): (ExprId, ExprId),
        body: StmtId,
    ) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        let mut at = self.emit_token(b"for", node.0, node);
        self.write_space();
        at = self.emit_token(b"(", at, node);
        if let Some(end) = self.emit_for_initializer(init)? {
            at = end;
        }
        at = self.emit_token(b";", at, node);
        if test.is_some() {
            self.write_space();
            self.emit_expression(test, P::Comma)?;
            at = self.end_of(test);
        }
        at = self.emit_token(b";", at, node);
        if update.is_some() {
            self.write_space();
            self.emit_expression(update, P::Comma)?;
            at = self.end_of(update);
        }
        self.emit_token(b")", at, node);
        self.emit_embedded_statement(body)?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitForInStatement`, `emitForOfStatement`. `keyword`: `in` or `of`, and whether there is an `AwaitModifier`.
    #[optimize(size)]
    fn emit_for_in_or_of_statement(
        &mut self,
        node: (usize, usize),
        (keyword, is_await): (&[u8], bool),
        left: StmtId,
        expr: ExprId,
        body: StmtId,
    ) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        let at = self.emit_token(b"for", node.0, node);
        self.write_space();
        if is_await {
            self.emit_keyword(self.keyword_end_after(b"for", node.0), b"await");
            self.write_space();
        }
        self.emit_token(b"(", at, node);
        let initializer_end = self.emit_for_initializer(left)?;
        self.write_space();
        self.emit_token(keyword, initializer_end.unwrap_or(at), node);
        self.write_space();
        self.emit_expression(expr, P::Comma)?;
        self.emit_token(b")", self.end_of(expr), node);
        self.emit_embedded_statement(body)?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitWithStatement`: the HIR has it as a block of the object, as a statement, and the body.
    #[optimize(size)]
    fn emit_with_statement(&mut self, node: (usize, usize), list: IdList<StmtId>) -> Emitted {
        let hir = self.hir;
        let mut statements = hir.ids(list);
        let object: Option<StmtId> = statements.next();
        let body: StmtId = statements.next().unwrap_or(StmtId::NONE);
        let object = object.and_then(|object| hir.stmts.get(object.idx()));
        let Some(StmtKind::Expr(object)) = object.map(|it| it.kind) else {
            return Err(Stop::OutOfStack);
        };
        let state = self.enter_node(node.0, node.1);
        let at = self.emit_token(b"with", node.0, node);
        self.write_space();
        self.emit_token(b"(", at, node);
        self.emit_expression(object, P::Comma)?;
        self.emit_token(b")", self.end_of(object), node);
        self.emit_embedded_statement(body)?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitContinueStatement`, `emitBreakStatement`
    #[optimize(size)]
    fn emit_break_or_continue(
        &mut self,
        keyword: &[u8],
        label: Atom,
        node: (usize, usize),
    ) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        self.emit_token(keyword, node.0, node);
        if label.is_some() {
            self.write_space();
            // `emitLabelIdentifier`. A label that is missing has no text.
            let keyword_end = self.keyword_end_after(keyword, node.0);
            let start = self.skip_trivia(keyword_end);
            if label != known::empty {
                self.emit_source(keyword_end, token_end(self.text, start, false));
            }
        }
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitReturnStatement`, `emitThrowStatement`. `parenthesizeExpressionForNoAsi` changes no node of the parser.
    #[optimize(size)]
    fn emit_return_or_throw(&mut self, keyword: &[u8], e: ExprId, node: (usize, usize)) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        self.emit_token(keyword, node.0, node);
        if e.is_some() {
            self.write_space();
            self.emit_expression(e, P::Comma)?;
        } else if keyword == b"throw" {
            self.write_space();
        }
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitSwitchStatement`
    #[optimize(size)]
    fn emit_switch_statement(
        &mut self,
        node: (usize, usize),
        expr: ExprId,
        cases: Span<CaseId>,
    ) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        let at = self.emit_token(b"switch", node.0, node);
        self.write_space();
        self.emit_token(b"(", at, node);
        self.emit_expression(expr, P::Comma)?;
        let expression_end = self.end_of(expr);
        self.emit_token(b")", expression_end, node);
        self.write_space();
        // `emitCaseBlock`. The block starts after the `)`, and ends where the statement does.
        let pos = self.token_after(b")", expression_end);
        let block = (pos.unwrap_or(expression_end), node.1);
        let block_state = self.enter_node(block.0, block.1);
        self.emit_token(b"{", block.0, block);
        let children: Vec<Child> = cases
            .iter()
            .map(|case| Child {
                pos: self.pos_before(hir[case].pos as usize),
                end: hir[case].end as usize,
            })
            .collect();
        // The clauses of a block whose `{` is missing start where the block does.
        let clauses_pos = match self.token_after(b"{", block.0) {
            Some(open_end) => open_end,
            None => block.0,
        };
        let last = children.last().map(|it| it.end);
        let clauses = self.list_range(clauses_pos, b'}', last, block.1);
        let format = lf::CASE_BLOCK_CLAUSES;
        self.emit_list(block, Some(clauses), &children, format, |printer, index| {
            let case = CaseId(cases.start + index as u32);
            printer.emit_case_or_default_clause(case, children[index])
        })?;
        self.emit_close_brace(clauses.1, block, true);
        self.exit_node(block_state);
        self.exit_node(state);
        Ok(())
    }

    /// `emitCaseClause`, `emitDefaultClause`
    #[optimize(size)]
    fn emit_case_or_default_clause(&mut self, case: CaseId, child: Child) -> Emitted {
        let hir = self.hir;
        let clause = &hir[case];
        let node = (child.pos, child.end);
        let state = self.enter_node(node.0, node.1);
        let colon_pos = match clause.test.is_some() {
            true => {
                self.emit_token(b"case", node.0, node);
                self.write_space();
                self.emit_expression(clause.test, P::Comma)?;
                self.end_of(clause.test)
            }
            false => self.emit_token(b"default", node.0, node),
        };
        // `emitCaseOrDefaultClauseStatements`
        let statements = self.statements_of(clause.body);
        let first = statements
            .first()
            .and_then(|first| hir.stmts.get(first.idx()));
        let emits_as_single_statement = statements.len() == 1
            && first.is_some_and(|first| {
                let start = self.skip_trivia(first.loc.pos as usize);
                self.on_same_line(self.skip_trivia(node.0), start)
            });
        let mut format = lf::CASE_OR_DEFAULT_CLAUSE_STATEMENTS;
        if emits_as_single_statement {
            // "use writeToken (no comments) for the colon"
            self.write(b":");
            self.write_space();
            format &= !(lf::MULTI_LINE | lf::INDENTED);
        } else {
            self.emit_token(b":", colon_pos, node);
        }
        let colon_end = self.token_after(b":", colon_pos).unwrap_or(colon_pos);
        let list = (colon_end.min(node.1), node.1);
        self.emit_statement_list(node, list, &statements, format)?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitTryStatement`
    #[optimize(size)]
    fn emit_try_statement(
        &mut self,
        node: (usize, usize),
        block: StmtId,
        (param, handler): (VarDeclId, StmtId),
        finalizer: StmtId,
    ) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        self.emit_token(b"try", node.0, node);
        self.write_space();
        self.emit_statement(block)?;
        let mut before_finally = self.end_of_statement(block);
        if let Some(handler_block) = hir.stmts.get(handler.idx()) {
            self.write_line();
            // `emitCatchClause`. The clause starts and ends where the parser was after a block: after a skipped `=`.
            let block_end = hir
                .stmts
                .get(block.idx())
                .map_or(0, |it| it.loc.end as usize);
            let clause = (block_end, handler_block.loc.end as usize);
            let clause_state = self.enter_node(clause.0, clause.1);
            let at = self.emit_token(b"catch", clause.0, clause);
            self.write_space();
            if let Some(declaration) = hir.var_decls.get(param.idx()) {
                self.emit_token(b"(", at, clause);
                self.emit_variable_declaration(param)?;
                self.emit_token(b")", declaration.loc.end as usize, clause);
                self.write_space();
            }
            self.emit_statement(handler)?;
            self.exit_node(clause_state);
            before_finally = clause.1;
        }
        if finalizer.is_some() {
            self.write_line();
            self.emit_token(b"finally", before_finally, node);
            self.write_space();
            self.emit_statement(finalizer)?;
        }
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `emitTypeAliasDeclaration`
    #[optimize(size)]
    fn emit_type_alias_declaration(
        &mut self,
        s: StmtId,
        a: AliasId,
        node: (usize, usize),
    ) -> Emitted {
        let hir = self.hir;
        let alias = &hir[a];
        let state = self.enter_node(node.0, node.1);
        self.emit_modifier_list(node, hir.stmt_modifiers(s), false)?;
        self.write(b"type");
        self.write_space();
        self.emit_identifier(alias.name, alias.name_pos as usize);
        self.emit_type_parameters(node, alias.type_params, false)?;
        self.write(b" = ");
        self.emit_type_node(alias.ty)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitInterfaceDeclaration`
    #[optimize(size)]
    fn emit_interface_declaration(
        &mut self,
        s: StmtId,
        i: InterfaceId,
        node: (usize, usize),
    ) -> Emitted {
        let hir = self.hir;
        let interface = &hir[i];
        let state = self.enter_node(node.0, node.1);
        self.emit_modifier_list(node, hir.stmt_modifiers(s), false)?;
        self.write(b"interface");
        self.write_space();
        let mut at = self.emit_identifier(interface.name, interface.name_pos as usize);
        self.emit_type_parameters(node, interface.type_params, false)?;
        if let Some(last) = interface.type_params.iter().next_back() {
            let end = self.c.end_of_type_param(self.file, last) as usize;
            at = self.token_after(b">", end).unwrap_or(end);
        }
        at = self.emit_heritage_clauses(node, i, at)?;
        self.write_space();
        self.write(b"{");
        let children: Vec<Child> = interface
            .members
            .iter()
            .map(|m| Child {
                pos: hir[m].loc.pos as usize,
                end: hir[m].loc.end as usize,
            })
            .collect();
        // A list that is missing is where the token before it ends.
        let last = children.last().map(|it| it.end);
        let list = match self.token_after(b"{", at) {
            Some(open_end) => self.list_range(open_end, b'}', last, node.1),
            None => (at, at),
        };
        let format = lf::INTERFACE_MEMBERS;
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            printer.emit_type_element(MemberId(interface.members.start + index as u32))
        })?;
        self.write(b"}");
        self.exit_node(state);
        Ok(())
    }

    /// `emitList(emitHeritageClauseNode, ..)`. The HIR has the types of the clauses, and the source has their keywords.
    #[optimize(size)]
    fn emit_heritage_clauses(
        &mut self,
        node: (usize, usize),
        i: InterfaceId,
        at: usize,
    ) -> Result<usize, Stop> {
        let hir = self.hir;
        let interface = &hir[i];
        let mut types: Vec<TypeNodeId> = hir.ids(interface.extends).collect();
        types.extend(hir.ids(interface.other_heritage));
        types.retain(|ty| hir.types.get(ty.idx()).is_some());
        types.shared_sort_by_key(|&ty| hir[ty].pos);
        // The keyword of each clause: its `Pos()`, its start, and whether it is `extends`.
        let mut clauses: Vec<((usize, usize, bool), Vec<TypeNodeId>)> = Vec::new();
        let mut types = types.into_iter().peekable();
        let mut token = self.skip_trivia(at);
        let mut before = at;
        while token < node.1 {
            if let Some(&ty) = types.peek()
                && hir[ty].pos as usize <= token
            {
                types.next();
                if let Some(clause) = clauses.last_mut() {
                    clause.1.push(ty);
                }
                before = (self.c.end_of_type_node(self.file, ty) as usize).max(token + 1);
                token = self.skip_trivia(before);
                continue;
            }
            // The `{` of the members. An element can be an object literal.
            if self.byte(token) == b'{' {
                break;
            }
            let end = token_end(self.text, token, false).max(token + 1);
            let is_extends = self.token_end_at(b"extends", token).is_some();
            if is_extends || self.token_end_at(b"implements", token).is_some() {
                clauses.push(((before, token, is_extends), Vec::new()));
            }
            (before, token) = (end, self.skip_trivia(end));
        }
        if clauses.is_empty() {
            return Ok(at);
        }
        // A clause ends where the next one starts: after the tokens that the parser skipped.
        let ends: Vec<usize> = (clauses.iter().skip(1).map(|next| next.0.0))
            .chain([before])
            .collect();
        let children: Vec<Child> = (clauses.iter().zip(&ends))
            .map(|(clause, &end)| Child {
                pos: clause.0.0,
                end,
            })
            .collect();
        let list = Some((children[0].pos, before));
        let format = lf::HERITAGE_CLAUSES;
        self.emit_list(node, list, &children, format, |printer, index| {
            // `emitHeritageClause`
            let ((_, _, is_extends), types) = &clauses[index];
            let clause = (children[index].pos, children[index].end);
            let state = printer.enter_node(clause.0, clause.1);
            printer.write_space();
            let keyword: &[u8] = if *is_extends {
                b"extends"
            } else {
                b"implements"
            };
            let keyword_end = printer.emit_token(keyword, clause.0, clause);
            printer.write_space();
            let elements: Vec<Child> = types
                .iter()
                .map(|&ty| Child {
                    pos: printer.pos_before(hir[ty].pos as usize),
                    end: printer.c.end_of_type_node(printer.file, ty) as usize,
                })
                .collect();
            let list = Some((keyword_end.min(clause.1), clause.1));
            let format = lf::HERITAGE_CLAUSE_TYPES;
            // `emitExpressionWithTypeArgumentsNode`
            printer.emit_list(clause, list, &elements, format, |printer, index| {
                printer.emit_expression_with_type_arguments(types[index])
            })?;
            printer.exit_node(state);
            Ok(())
        })?;
        Ok(before)
    }

    /// `emitEnumDeclaration`
    #[optimize(size)]
    fn emit_enum_declaration(&mut self, s: StmtId, e: EnumId, node: (usize, usize)) -> Emitted {
        let hir = self.hir;
        let declaration = &hir[e];
        let state = self.enter_node(node.0, node.1);
        self.emit_modifier_list(node, hir.stmt_modifiers(s), false)?;
        self.write(b"enum");
        self.write_space();
        let name_end = self.emit_identifier(declaration.name, declaration.name_pos as usize);
        self.write_space();
        self.write(b"{");
        let members = declaration.members;
        let children: Vec<Child> = members
            .iter()
            .map(|m| Child {
                pos: hir[m].loc.pos as usize,
                end: hir[m].loc.end as usize,
            })
            .collect();
        // A list that is missing is where the name ends.
        let last = children.last().map(|it| it.end);
        let list = match self.token_after(b"{", name_end) {
            Some(open_end) => self.list_range(open_end, b'}', last, node.1),
            None => (name_end, name_end),
        };
        let format = lf::ENUM_MEMBERS;
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            // `emitEnumMember`
            let member = &hir[EnumMemberId(members.start + index as u32)];
            let node = (children[index].pos, children[index].end);
            let state = printer.enter_node(node.0, node.1);
            let key = match (member.computed_name.is_some(), member.name.is_some()) {
                (true, _) => PropKey::Computed(member.computed_name),
                (false, true) => PropKey::Name(member.name),
                (false, false) => PropKey::None,
            };
            let name_end = printer.emit_name(key, member.name_kind, member.pos as usize)?;
            printer.emit_initializer(member.init, name_end, node)?;
            printer.exit_node(state);
            Ok(())
        })?;
        self.write(b"}");
        self.exit_node(state);
        Ok(())
    }

    /// The `b` of `namespace a.b`, for the module `a`: its body is the declaration of `b`, which starts with its name.
    #[optimize(size)]
    fn nested_module(&self, m: ModuleId) -> Option<ModuleId> {
        let hir = self.hir;
        let inner = hir.stmts.get(hir.nested_namespace(m)?.idx())?;
        let StmtKind::Module(inner) = inner.kind else {
            return None;
        };
        let module = &hir[inner];
        // `global { }` in a namespace starts with its name too.
        let before = self.pos_before(module.name_pos as usize);
        let is_nested = matches!(module.name, ModuleName::Ident(_))
            && !module.flags.contains(Flags::REPARSED)
            && before > 0
            && self.byte(before - 1) == b'.';
        is_nested.then_some(inner)
    }

    /// `emitModuleName`, `emitNestedModuleName`. Returns `End()` of the name.
    #[optimize(size)]
    fn emit_module_name(&mut self, m: ModuleId) -> usize {
        let module = &self.hir[m];
        let start = module.name_pos as usize;
        match module.name {
            ModuleName::Ident(name) => self.emit_identifier(name, start),
            // A string, or the identifier `global`.
            ModuleName::String(_) | ModuleName::Global => {
                let end = token_end(self.text, start, false);
                self.emit_source(self.pos_before(start), end);
                end
            }
        }
    }

    /// `emitModuleDeclaration`
    #[optimize(size)]
    fn emit_module_declaration(&mut self, s: StmtId, m: ModuleId, node: (usize, usize)) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        self.emit_modifier_list(node, hir.stmt_modifiers(s), false)?;
        // `node.Keyword`. Only after `module` a string is a name.
        let keyword: &[u8] = match hir[m].name {
            ModuleName::Global => b"",
            ModuleName::String(_) => b"module ",
            ModuleName::Ident(_) if hir[m].specifies_module => b"module ",
            ModuleName::Ident(_) => b"namespace ",
        };
        self.write(keyword);
        let mut innermost = m;
        let mut name_end = self.emit_module_name(m);
        while let Some(inner) = self.nested_module(innermost) {
            self.write(b".");
            innermost = inner;
            name_end = self.emit_module_name(inner);
        }
        let module = &hir[innermost];
        if !module.has_body {
            self.write(b";");
            self.exit_node(state);
            return Ok(());
        }
        self.write_space();
        // `emitModuleBlock`. A block whose `{` is missing is where the name ends.
        let statements = self.statements_of(module.body);
        let block = match self.token_after(b"{", name_end) {
            Some(_) => (name_end, node.1),
            None => (name_end, name_end),
        };
        self.emit_block_of_statements(block, &statements, false)?;
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// The name at `start`, an identifier or a string in its place. A missing one is where the token before it ends.
    #[optimize(size)]
    fn emit_module_export_name(&mut self, name: Atom, start: usize) -> usize {
        let is_missing =
            name.is_none() || name == known::empty && !matches!(self.byte(start), b'"' | b'\'');
        if is_missing {
            return self.pos_before(start);
        }
        let end = token_end(self.text, start, false);
        self.emit_source(self.pos_before(start), end);
        end
    }

    /// `emitImportEqualsDeclaration`
    #[optimize(size)]
    fn emit_import_equals_declaration(
        &mut self,
        s: StmtId,
        i: ImportEqualsId,
        node: (usize, usize),
    ) -> Emitted {
        let hir = self.hir;
        let import = &hir[i];
        let state = self.enter_node(node.0, node.1);
        let modifiers = hir.stmt_modifiers(s);
        self.emit_modifier_list(node, modifiers, false)?;
        let modifiers_end = self.end_of_modifiers(modifiers, node.0);
        let at = self.emit_token(b"import", modifiers_end, node);
        self.write_space();
        if import.flags.contains(Flags::TYPE_ONLY) {
            self.emit_token(b"type", at, node);
            self.write_space();
        }
        let name_end = self.emit_identifier(import.name, import.name_pos as usize);
        self.write_space();
        self.emit_token(b"=", name_end, node);
        self.write_space();
        // `emitModuleReference`
        match import.target {
            ImportEqualsTarget::Entity(names) => {
                let equals_end = self.token_after(b"=", name_end).unwrap_or(name_end);
                self.emit_entity_name(names, equals_end);
            }
            ImportEqualsTarget::Require(spec) => {
                // `emitExternalModuleReference`
                let pos = self.token_after(b"=", name_end).unwrap_or(name_end);
                let keyword_end = self.keyword_end_after(b"require", pos);
                let open_end = self.token_after(b"(", keyword_end).unwrap_or(keyword_end);
                let argument = self.skip_trivia(open_end);
                let argument_end = match (spec.is_some(), import.expression.is_some()) {
                    (true, _) => token_end(self.text, argument, false),
                    (false, true) => self.end_of(import.expression),
                    (false, false) => open_end,
                };
                let end = self.token_after(b")", argument_end).unwrap_or(argument_end);
                let reference = self.enter_node(pos, end);
                self.write(b"require(");
                if spec.is_some() {
                    self.emit_source(open_end, argument_end);
                } else if import.expression.is_some() {
                    self.emit_expression(import.expression, P::Yield)?;
                }
                self.write(b")");
                self.exit_node(reference);
            }
        }
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitExpression(node.ModuleSpecifier, OperatorPrecedenceLowest)`. The `from`, if there is one, follows `before`.
    #[optimize(size)]
    fn emit_module_specifier(
        &mut self,
        before: usize,
        string: bool,
        expression: ExprId,
    ) -> Result<usize, Stop> {
        if string {
            let from_end = self.token_after(b"from", before).unwrap_or(before);
            let start = self.skip_trivia(from_end);
            let end = token_end(self.text, start, false);
            self.emit_source(self.pos_before(start), end);
            return Ok(end);
        }
        if expression.is_none() {
            return Ok(before);
        }
        self.emit_expression(expression, P::Comma)?;
        Ok(self.end_of(expression).max(before))
    }

    /// `emitImportAttributes` for a declaration whose specifier ends at `after`, and which ends at `end`.
    #[optimize(size)]
    fn emit_import_attributes_after(&mut self, after: usize, end: usize) -> Emitted {
        let hir = self.hir;
        let is_own = |it: &&(u32, ExprId)| (after..end).contains(&(it.0 as usize));
        let Some(&(keyword, object)) = hir.import_attributes.iter().find(is_own) else {
            return Ok(());
        };
        let Some(&Expr {
            kind: ExprKind::Object(props),
            pos: open,
            end: object_end,
        }) = hir.exprs.get(object.idx())
        else {
            return Ok(());
        };
        self.write_space();
        let (keyword, open) = (keyword as usize, open as usize);
        let pos = self.pos_before(keyword);
        let token: &[u8] = match self.token_end_at(b"assert", keyword) {
            Some(_) => b"assert",
            None => b"with",
        };
        let keyword_end = self.keyword_end_after(token, pos);
        // A list whose `{` is missing is empty, where the keyword ends.
        let has_open = self.byte(open) == b'{';
        let node = match has_open {
            true => (pos, object_end as usize),
            false => (pos, keyword_end),
        };
        let state = self.enter_node(node.0, node.1);
        self.emit_token(token, pos, node);
        self.write_space();
        let children: Vec<Child> = props
            .iter()
            .map(|p| Child {
                pos: self.pos_before(hir[p].start as usize),
                end: hir[p].end as usize,
            })
            .collect();
        let last = children.last().map(|it| it.end);
        let list = match has_open {
            true => self.list_range(open + 1, b'}', last, node.1),
            false => (keyword_end, keyword_end),
        };
        let format = lf::IMPORT_ATTRIBUTES;
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            // `emitImportAttribute`
            let attribute = &hir[PropId(props.start + index as u32)];
            let child = children[index];
            let state = printer.enter_node(child.pos, child.end);
            let name_end = token_end(printer.text, attribute.pos as usize, false);
            printer.emit_source(child.pos, name_end);
            printer.write(b": ");
            printer.emit_trailing_comments_with_space_after(printer.pos_of(attribute.value));
            printer.emit_expression(attribute.value, P::Yield)?;
            printer.exit_node(state);
            Ok(())
        })?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitExportAssignment`
    #[optimize(size)]
    fn emit_export_assignment(
        &mut self,
        e: ExprId,
        node: (usize, usize),
        is_export_equals: bool,
    ) -> Emitted {
        let hir = self.hir;
        let state = self.enter_node(node.0, node.1);
        let at = self.emit_token(b"export", node.0, node);
        self.write_space();
        let token: &[u8] = if is_export_equals { b"=" } else { b"default" };
        self.emit_token(token, at, node);
        self.write_space();
        // Parentheses keep a `class` or `function` expression from being read as an exported declaration.
        let leftmost = self.leftmost_expression(e);
        let is_declaration_like = !is_export_equals
            && !hir::is_parenthesized(hir, leftmost)
            && match hir.exprs.get(leftmost.idx()).map(|it| it.kind) {
                Some(ExprKind::Fn(f)) => hir[f].kind != FnKind::Arrow,
                Some(ExprKind::Class(_)) => true,
                _ => false,
            };
        let precedence = match is_declaration_like {
            true => P::Parentheses,
            false => P::Assignment,
        };
        self.emit_expression(e, precedence)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitNamespaceExportDeclaration`
    #[optimize(size)]
    fn emit_namespace_export_declaration(
        &mut self,
        s: StmtId,
        name: Atom,
        node: (usize, usize),
    ) -> Emitted {
        let state = self.enter_node(node.0, node.1);
        let mut at = self.emit_token(b"export", node.0, node);
        self.write_space();
        at = self.emit_token(b"as", at, node);
        self.write_space();
        self.emit_token(b"namespace", at, node);
        self.write_space();
        // The name follows the keywords that the source has.
        let mut before = self.c.start_after_modifiers(self.file, s) as usize;
        for keyword in [&b"export"[..], b"as", b"namespace"] {
            before = self.token_after(keyword, before).unwrap_or(before);
        }
        self.emit_identifier(name, self.skip_trivia(before));
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitExportDeclaration` for the statement `s`: `export { .. }` if `named`, else `export *`.
    #[optimize(size)]
    fn emit_export_declaration(
        &mut self,
        s: StmtId,
        node: (usize, usize),
        named: Option<ExportId>,
    ) -> Emitted {
        let hir = self.hir;
        let (is_type_only, has_module_specifier, spec) = match (named, hir[s].kind) {
            (Some(x), _) => (hir[x].type_only, hir[x].has_module_specifier, hir[x].spec),
            (
                None,
                StmtKind::ExportStar {
                    type_only, spec, ..
                },
            ) => (type_only, true, spec),
            _ => return Ok(()),
        };
        let state = self.enter_node(node.0, node.1);
        self.emit_modifier_list(node, hir.stmt_modifiers(s), false)?;
        let mut at = self.emit_token(b"export", node.0, node);
        self.write_space();
        // Where the tokens of the source end.
        let mut before = self.c.start_after_modifiers(self.file, s) as usize;
        before = self.token_after(b"export", before).unwrap_or(before);
        if is_type_only {
            at = self.emit_token(b"type", at, node);
            self.write_space();
            before = self.token_after(b"type", before).unwrap_or(before);
        }
        let mut clause_end = None;
        match (named, hir[s].kind) {
            // `emitNamedExports`
            (Some(x), _) => {
                let items = hir[x].items;
                let children: Vec<Child> = items
                    .iter()
                    .map(|item| Child {
                        pos: self.pos_before(hir[item].start as usize),
                        end: hir[item].end as usize,
                    })
                    .collect();
                // A list that is missing is where the token before it ends. The clause ends with its `}`.
                let last = children.last().map(|it| it.end);
                let open_end = self.token_after(b"{", before);
                let mut end = last.or(open_end).unwrap_or(before);
                end = self.token_after(b",", end).unwrap_or(end);
                end = self.token_after(b"}", end).unwrap_or(end);
                let clause = (before, end);
                let list = match open_end {
                    Some(open_end) => self.list_range(open_end, b'}', last, end),
                    None => (before, before),
                };
                let clause_state = self.enter_node(clause.0, clause.1);
                self.write(b"{");
                let format = lf::NAMED_IMPORTS_OR_EXPORTS_ELEMENTS;
                self.emit_list(clause, Some(list), &children, format, |printer, index| {
                    // `emitExportSpecifier`
                    let item = &hir[ExportSpecId(items.start + index as u32)];
                    let node = (children[index].pos, children[index].end);
                    let state = printer.enter_node(node.0, node.1);
                    if item.type_only {
                        printer.write(b"type ");
                    }
                    if item.local_pos != item.pos {
                        let start = item.local_pos as usize;
                        let property_end = printer.emit_module_export_name(item.local, start);
                        printer.write_space();
                        printer.emit_token(b"as", property_end, node);
                        printer.write_space();
                    }
                    printer.emit_module_export_name(item.exported, item.pos as usize);
                    printer.exit_node(state);
                    Ok(())
                })?;
                self.write(b"}");
                self.exit_node(clause_state);
                clause_end = Some(end);
            }
            // `emitNamespaceExport`
            (
                None,
                StmtKind::ExportStar {
                    alias,
                    star_pos,
                    alias_pos,
                    ..
                },
            ) if alias.is_some() => {
                let (star, name) = (star_pos as usize, alias_pos as usize);
                let is_missing = alias == known::empty && !matches!(self.byte(name), b'"' | b'\'');
                let end = match is_missing {
                    true => self.pos_before(name),
                    false => token_end(self.text, name, false),
                };
                let clause = (self.pos_before(star), end);
                let clause_state = self.enter_node(clause.0, clause.1);
                let star_end = self.emit_token(b"*", clause.0, clause);
                self.write_space();
                self.emit_token(b"as", star_end, clause);
                self.write_space();
                self.emit_module_export_name(alias, name);
                self.exit_node(clause_state);
                clause_end = Some(end);
            }
            _ => {
                at = self.emit_token(b"*", at, node);
                before = self.token_after(b"*", before).unwrap_or(before);
            }
        }
        let mut specifier_end = clause_end.unwrap_or(before);
        if has_module_specifier {
            self.write_space();
            self.emit_token(b"from", at.max(clause_end.unwrap_or(0)), node);
            self.write_space();
            let written = hir.exports_from_expressions.iter().find(|it| it.0 == s);
            let expression = written.map_or(ExprId::NONE, |it| it.1);
            specifier_end =
                self.emit_module_specifier(specifier_end, spec.is_some(), expression)?;
        }
        self.emit_import_attributes_after(specifier_end, node.1)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }

    /// `emitImportDeclaration`
    #[optimize(size)]
    fn emit_import_declaration(&mut self, s: StmtId, i: ImportId, node: (usize, usize)) -> Emitted {
        let hir = self.hir;
        let import = &hir[i];
        let state = self.enter_node(node.0, node.1);
        let modifiers = hir.stmt_modifiers(s);
        self.emit_modifier_list(node, modifiers, false)?;
        let modifiers_end = self.end_of_modifiers(modifiers, node.0);
        self.emit_token(b"import", modifiers_end, node);
        self.write_space();
        let mut before = self.keyword_end_after(b"import", modifiers_end);
        if import.clause_end > import.clause_start {
            // `emitImportClause`
            let clause = (before, import.clause_end as usize);
            let clause_state = self.enter_node(clause.0, clause.1);
            // `PhaseModifier`
            if import.type_only || import.is_deferred {
                let modifier: &[u8] = if import.type_only { b"type" } else { b"defer" };
                self.emit_token(modifier, clause.0, clause);
                self.write_space();
                before = self.keyword_end_after(modifier, before);
            }
            let has_namespace = import.namespace_start != 0;
            if import.default.is_some() {
                before = self.emit_identifier(import.default, import.default_pos as usize);
                if has_namespace || import.has_named_imports {
                    self.emit_token(b",", before, clause);
                    self.write_space();
                    before = self.token_after(b",", before).unwrap_or(before);
                }
            }
            if has_namespace {
                // `emitNamespaceImport`
                let bindings = (self.pos_before(import.namespace_start as usize), clause.1);
                let bindings_state = self.enter_node(bindings.0, bindings.1);
                let star_end = self.emit_token(b"*", bindings.0, bindings);
                self.write_space();
                self.emit_token(b"as", star_end, bindings);
                self.write_space();
                self.emit_identifier(import.namespace, import.namespace_pos as usize);
                self.exit_node(bindings_state);
            } else if import.has_named_imports {
                // `emitNamedImports`
                let named = import.named;
                let bindings = (before, clause.1);
                let children: Vec<Child> = named
                    .iter()
                    .map(|item| Child {
                        pos: self.pos_before(hir[item].start as usize),
                        end: hir[item].end as usize,
                    })
                    .collect();
                let last = children.last().map(|it| it.end);
                let list = match self.token_after(b"{", before) {
                    Some(open_end) => self.list_range(open_end, b'}', last, bindings.1),
                    None => (before, before),
                };
                let bindings_state = self.enter_node(bindings.0, bindings.1);
                self.write(b"{");
                let format = lf::NAMED_IMPORTS_OR_EXPORTS_ELEMENTS;
                self.emit_list(bindings, Some(list), &children, format, |printer, index| {
                    // `emitImportSpecifier`
                    let item = &hir[ImportSpecId(named.start + index as u32)];
                    let node = (children[index].pos, children[index].end);
                    let state = printer.enter_node(node.0, node.1);
                    if item.type_only {
                        printer.write(b"type ");
                    }
                    if item.imported_pos != item.pos {
                        let start = item.imported_pos as usize;
                        let property_end = printer.emit_module_export_name(item.imported, start);
                        printer.write_space();
                        printer.emit_token(b"as", property_end, node);
                        printer.write_space();
                    }
                    // A string in the place of the name is an identifier with its range.
                    printer.emit_module_export_name(item.local, item.pos as usize);
                    printer.exit_node(state);
                    Ok(())
                })?;
                self.write(b"}");
                self.exit_node(bindings_state);
            }
            self.exit_node(clause_state);
            self.write_space();
            self.emit_token(b"from", clause.1, node);
            self.write_space();
            before = clause.1;
        }
        // A specifier that is no string is the first expression of the file in the place of one after the clause.
        let within = before..=self.skip_trivia(node.1);
        let written = hir.specifier_expressions.iter().copied();
        let own = written.filter(|&e| within.contains(&(hir[e].pos as usize)));
        let expression = own.min_by_key(|&e| hir[e].pos).unwrap_or(ExprId::NONE);
        let specifier_end =
            self.emit_module_specifier(before, import.spec.is_some(), expression)?;
        self.emit_import_attributes_after(specifier_end, node.1)?;
        self.write(b";");
        self.exit_node(state);
        Ok(())
    }
}
