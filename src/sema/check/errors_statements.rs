//! Statements, and checks of variable and property declarations.
//!
//! * `with`: 1101 1300 2410. Misplaced `return`: 1108 18041. `if (x);`: 1313. Statements in ambient
//!   contexts: 1036 1183.
//! * Assignment targets of `for`-`in` and `for`-`of`: 2405 2406 2780, 2487 2781, 1106.
//! * `catch`: 1196 1197 2492.
//! * Where `await`, `for await` and `await using` are allowed: 1308 1375 1378 2524 18037, 1103 1431
//!   1432 18038, 2852 2853 2854 18054, and 1309 for all three. `yield` in a parameter initializer:
//!   2523.
//! * Variable declaration lists: 1009 1123, 1156.
//! * `using` and `await using`: 1493 1494, 1545 1546, 1547 1548, and their initializers: 2850 2851.
//!
//! Follows `checkWithStatement`, `checkReturnStatement`, `checkIfStatement`, `checkForInStatement`,
//! `checkForOfStatement`, `checkReferenceExpression`, `checkCatchClause`, `checkVariableStatement`
//! and `checkVariableLikeDeclaration` of TypeScript 7.0.2's checker.go,
//! `checkGrammarStatementInAmbientContext`, `checkGrammarForInOrForOfStatement`,
//! `checkGrammarVariableDeclarationList`, `checkGrammarAwaitOrAwaitUsing`,
//! `checkGrammarYieldExpression` and, for `using`, `checkGrammarModifiers` of its grammarchecks.go,
//! `checkStrictModeWithStatement` of its binder.go, and `reparseTopLevelAwait` of its parser.go.
//!
//! The walk (check_source_file.rs) calls these where checker.go does. TypeScript never checks the body of a
//! `with` statement, the expression of a misplaced `return`, the expression of a `for`-`of` whose
//! declaration list is empty, or the operand of a `yield` outside a generator: the walk records the
//! ranges it skips, and the diagnostics the passes reported there are removed when they are done.

use super::*;
use crate::bind::Parent;
use crate::resolve::{ModuleKind, ScriptTarget};
use smallvec::SmallVec;

// ───────────────────────────── the text ─────────────────────────────

/// The start of the next token at or after `at`, skipping white space and comments, and whether a
/// line break was skipped.
fn next_token(text: &[u8], mut at: usize) -> (usize, bool) {
    let mut is_on_new_line = false;
    loop {
        match &text[at.min(text.len())..] {
            [b'\n' | b'\r', ..] => {
                is_on_new_line = true;
                at += 1;
            }
            [b' ' | b'\t' | 0x0b | 0x0c, ..] => at += 1,
            // A no-break space, a byte order mark.
            [0xc2, 0xa0, ..] => at += 2,
            [0xef, 0xbb, 0xbf, ..] => at += 3,
            // The line and paragraph separators.
            [0xe2, 0x80, 0xa8 | 0xa9, ..] => {
                is_on_new_line = true;
                at += 3;
            }
            [b'/', b'/', ..] => {
                while at < text.len() && !matches!(text[at], b'\n' | b'\r') {
                    at += 1;
                }
            }
            [b'/', b'*', rest @ ..] => {
                let len = bun_core::strings::index_of(rest, b"*/").map_or(rest.len(), |i| i + 2);
                is_on_new_line |= bun_core::strings::index_of_any(&rest[..len], b"\n\r").is_some();
                at += 2 + len;
            }
            _ => return (at, is_on_new_line),
        }
    }
}

/// Position of the `await` of the `for await` at `at`.
fn await_after_for(text: &[u8], at: u32) -> Option<u32> {
    if !is_word_at(text, at as usize, b"for") {
        return None;
    }
    let next = skip_trivia(text, at as usize + 3);
    is_word_at(text, next, b"await").then_some(next as u32)
}

/// How the parser treats an `await` that is not known to be a keyword, based on the token that
/// follows it.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AfterAwait {
    /// `isAwaitExpression`: a name, a keyword or a literal on the same line. It is an `await` expression.
    Operand,
    /// It is an identifier, and the following token continues the expression: `await (x)`, `await
    /// [x]`, `await - x`.
    GoesOn,
    /// It is an identifier, and the following token cannot continue the expression: the statement
    /// ends.
    Ends,
}

fn after_await(text: &[u8], at: u32) -> AfterAwait {
    let (next, is_on_new_line) = next_token(text, at as usize + 5);
    let first = text.get(next).copied().unwrap_or(b';');
    let second = text.get(next + 1).copied().unwrap_or(b';');
    if is_identifier_part(first)
        || matches!(first, b'"' | b'\'')
        || first == b'.' && second.is_ascii_digit()
    {
        return if is_on_new_line {
            AfterAwait::Ends
        } else {
            AfterAwait::Operand
        };
    }
    match (first, second) {
        (b'!', b'=') => AfterAwait::GoesOn,
        (b'!' | b'~' | b'{' | b'@' | b'#', _) | (b'+', b'+') | (b'-', b'-') => AfterAwait::Ends,
        _ => AfterAwait::GoesOn,
    }
}

// ───────────────────────────── the syntax ─────────────────────────────

/// A `with` statement is stored as a block of its object and its body, positioned at the keyword.
pub(super) fn is_with_statement(hir: &File, s: StmtId) -> bool {
    matches!(hir[s].kind, StmtKind::Block(list) if list.len() == 2)
        && is_word_at(&hir.text, hir[s].start as usize, b"with")
}

/// The parts of `range` that are in none of `holes`.
fn parts_outside(range: (u32, u32), mut holes: Vec<(u32, u32)>) -> Vec<(u32, u32)> {
    holes.sort_unstable();
    let (mut from, mut parts) = (range.0, Vec::new());
    for (start, end) in holes {
        if from < start {
            parts.push((from, start));
        }
        from = from.max(end);
    }
    if from < range.1 {
        parts.push((from, range.1));
    }
    parts
}

/// The diagnostics of binder.go. The binder visits every node, whether or not the checker does. Not
/// 1184: the binder only reports it for `export as namespace`, and wherever it is reported here it
/// comes from the checker (`reportObviousModifierErrors`).
pub(super) fn is_binder_diagnostic(code: u32) -> bool {
    matches!(
        code,
        1100 | 1101 | 1102 | 1210 | 1212..=1215 | 1250..=1252 | 1262 | 1314..=1316 | 1344 | 1359 | 2300 | 2451 | 2528 | 2567 | 2668 | 5061 | 18012
    )
}

// ───────────────────────────── where `await` is allowed ─────────────────────────────

/// The context of a node, as `checkGrammarAwaitOrAwaitUsing` classifies it.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AwaitPlace {
    /// `NodeFlagsAwaitContext`
    Allowed,
    /// Its function-like container is a class static block.
    StaticBlock,
    /// `IsInTopLevelContext`, and not in an await context.
    TopLevel,
    /// In a function that is not `async`, the initializer of a property, an enum or a namespace.
    Elsewhere,
}

// ───────────────────────────── members that share a name ─────────────────────────────

// `nodeLinks.hasReportedStatementInAmbientContext`, next to those of errors_collisions.rs
const HAS_REPORTED_STATEMENT_IN_AMBIENT_CONTEXT: u8 = 4;

impl Checker<'_, '_> {
    // ───────────────────────────── statements ─────────────────────────────

    /// `checkGrammarStatementInAmbientContext`
    #[inline]
    pub(super) fn check_grammar_statement_in_ambient_context(
        &mut self,
        file: FileId,
        s: StmtId,
    ) -> bool {
        self.has_ambient_context
            && self.check_grammar_statement_in_ambient_file(file, self.hir(file).node(s))
    }

    /// The same for the block that is the body of `func`.
    #[inline]
    pub(super) fn check_grammar_function_body_in_ambient_context(
        &mut self,
        file: FileId,
        func: FnId,
    ) {
        if self.has_ambient_context {
            let hir = self.hir(file);
            self.check_grammar_statement_in_ambient_file(file, hir.body(hir.node(func)));
        }
    }

    /// The same, in a file in which something is ambient: 1183 for the body of a function, which
    /// covers its statements, and 1036 once in every other block.
    fn check_grammar_statement_in_ambient_file(&mut self, file: FileId, node: Node) -> bool {
        let hir = self.hir(file);
        if !hir.is_ambient(node) {
            return false;
        }
        let has_reported = HAS_REPORTED_STATEMENT_IN_AMBIENT_CONTEXT;
        let parent = hir.parent(node);
        let parent_kind = hir.kind(parent);
        let (links, code) =
            if parent_kind.is_function_like() && !self.has_node_check_flag(node, has_reported) {
                (node, 1183)
            } else if matches!(
                parent_kind,
                Kind::Block | Kind::ModuleBlock | Kind::SourceFile
            ) && !self.has_node_check_flag(parent, has_reported)
            {
                (parent, 1036)
            } else {
                return false;
            };
        // `grammarErrorOnFirstToken`
        if !self.grammar_error_at(self.place_of_token(file, hir.start(node)), code, &[]) {
            return false;
        }
        *self.node_check_flags.entry(links).or_default() |= has_reported;
        true
    }

    /// Marks `start` to `end` as a range `checkSourceFile` never visits. Diagnostics a pass reports
    /// there are removed.
    pub(super) fn never_check(&self, start: u32, end: u32) {
        self.never_checked.borrow_mut().push((start, end));
    }

    /// `checkStrictModeWithStatement`, `checkStrictModeLabeledStatement`: 1101 1344. The binder
    /// visits every node, whether or not the checker does.
    pub(super) fn check_strict_mode_statements(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, s) in hir.stmts.iter().enumerate() {
            let code = match s.kind {
                StmtKind::Block(_)
                    if !hir.with_bodies.is_empty() && is_with_statement(hir, StmtId(i as u32)) =>
                {
                    1101
                }
                // A declaration cannot be a jump target.
                StmtKind::Labeled { body, .. }
                    if matches!(
                        hir[body].kind,
                        StmtKind::Var(_)
                            | StmtKind::Fn(_)
                            | StmtKind::Class(_)
                            | StmtKind::Interface(_)
                            | StmtKind::TypeAlias(_)
                            | StmtKind::Enum(_)
                            | StmtKind::Module(_)
                            | StmtKind::Import(_)
                            | StmtKind::ImportEquals(_)
                            | StmtKind::ExportNamed(_)
                            | StmtKind::ExportStar { .. }
                            | StmtKind::ExportDefault(_)
                            | StmtKind::ExportAssign(_)
                            | StmtKind::ExportAsNamespace(_)
                    ) =>
                {
                    1344
                }
                _ => continue,
            };
            if !matches!(bound.stmt_parent[i], Parent::None) {
                self.error_at((file, s.start, 0), code, &[]);
            }
        }
    }

    /// `checkWithStatement`: 1300 2410. The body is not checked.
    pub(super) fn check_with_statement(&mut self, file: FileId, s: StmtId, parts: IdList<StmtId>) {
        let hir = self.hir(file);
        let pos = hir[s].start;
        if !self.check_grammar_statement_in_ambient_context(file, s)
            && !has_parse_diagnostics(hir)
            && matches!(
                self.place_of_await_in(file, hir.node(s)),
                AwaitPlace::Allowed | AwaitPlace::StaticBlock
            )
        {
            self.error_at((file, pos, 0), 1300, &[]);
        }
        // The object is stored as a statement but is not one.
        if let StmtKind::Expr(object) = hir[hir.id_at(parts, 0)].kind {
            self.check_expression(file, object);
        }
        // Up to `node.Statement.Pos()`.
        let end = hir[hir.id_at(parts, 1)].loc.pos;
        self.grammar_error_at((file, pos, end), 2410, &[]);
        self.leave_expressions_unvisited(file, hir.node(hir.id_at(parts, 1)));
    }

    /// `leave_unvisited` for the outermost expressions below `node`.
    fn leave_expressions_unvisited(&mut self, file: FileId, node: Node) {
        let hir = self.hir(file);
        hir.for_each_child(node, &mut |child| {
            match hir.data(child) {
                NodeData::Expr(e) => self.leave_unvisited(file, e),
                _ => self.leave_expressions_unvisited(file, child),
            }
            false
        });
    }

    /// After `checkSourceFile`: of the body of a `with` statement, only what a query has visited
    /// has been checked.
    pub(super) fn never_check_with_bodies(&mut self, file: FileId) {
        let hir = self.hir(file);
        if hir.with_bodies.is_empty() {
            return;
        }
        for s in (0..hir.stmts.len() as u32).map(StmtId) {
            if let StmtKind::Block(parts) = hir[s].kind
                && is_with_statement(hir, s)
                && let body = hir.id_at(parts, 1)
                // An empty body has no contents, and its `pos` can be 0, which is not its real
                // position.
                && !matches!(hir[body].kind, StmtKind::Empty)
            {
                let range = (hir[body].start, hir[body].loc.end);
                self.never_check_unless_visited_by_query(file, hir.node(body), range);
            }
        }
    }

    /// After `checkSourceFile`: `checkExternalImportOrExportDeclaration` reports 1141 for a module
    /// specifier that is not a string literal, and returns.
    pub(super) fn never_check_specifier_expressions(&self, file: FileId) {
        let hir = self.hir(file);
        let required = hir.import_equals.iter().map(|import| import.expression);
        let specifiers = hir.specifier_expressions.iter().copied();
        for specifier in specifiers.chain(required.filter(|e| e.is_some())) {
            self.never_check(
                self.start_of(file, specifier),
                self.end_of_expr(file, specifier),
            );
        }
    }

    /// `never_check` for `range`, the range of `node`, which `checkSourceFile` does not visit,
    /// without the nodes below `node` that a query has computed a type from
    /// (`checkDeclarationInitializer`, `getTypeFromTypeNode`, `getTypeOfSymbol`, the flow analysis).
    pub(super) fn never_check_unless_visited_by_query(
        &mut self,
        file: FileId,
        node: Node,
        range: (u32, u32),
    ) {
        let mut visited = Vec::new();
        self.ranges_visited_by_queries(file, node, &mut visited);
        for (from, to) in parts_outside(range, visited) {
            self.never_check(from, to);
        }
    }

    /// The ranges of the outermost expressions, type nodes and declared names below `node` whose
    /// type is stored.
    fn ranges_visited_by_queries(
        &mut self,
        file: FileId,
        node: Node,
        visited: &mut Vec<(u32, u32)>,
    ) {
        let hir = self.hir(file);
        hir.for_each_child(node, &mut |child| {
            let range = match hir.data(child) {
                NodeData::Expr(e) if self.cached_type_of_expr(file, e).is_some() => {
                    Some((self.start_of(file, e), self.end_of_expr(file, e)))
                }
                NodeData::Type(t)
                    if (self.p.type_node_types.get(&self.task, &(file, t))).is_some() =>
                {
                    Some((hir[t].pos, self.end_of_type_node(file, t)))
                }
                NodeData::Pat(name)
                    if matches!(hir[name].kind, PatKind::Ident(_))
                        && (self.p.pat_types.get(&self.task, &(file, name))).is_some() =>
                {
                    Some((hir[name].pos, self.end_of_pat(file, name)))
                }
                _ => None,
            };
            match range {
                Some(range) => visited.push(range),
                None => self.ranges_visited_by_queries(file, child, visited),
            }
            false
        });
    }

    /// The start of `checkReturnStatement`: 1108 18041. Returns the containing function, if the
    /// returned expression is to be checked.
    pub(super) fn check_grammar_return_statement(
        &mut self,
        file: FileId,
        s: StmtId,
    ) -> Option<FnId> {
        let hir = self.hir(file);
        if !self.check_grammar_statement_in_ambient_context(file, s) {
            let code = match self.enclosing_fn(file, Parent::Stmt(s)) {
                Some(func) if hir[func].kind != FnKind::StaticBlock => return Some(func),
                Some(_) => 18041,
                None => 1108,
            };
            self.grammar_error_at((file, hir[s].start, 0), code, &[]);
        }
        if let StmtKind::Return(e) = hir[s].kind
            && e.is_some()
        {
            self.never_check(self.start_of(file, e), hir[s].loc.end);
        }
        None
    }

    /// From `checkIfStatement`: 1313. Other statements the HIR drops also appear as empty, so the
    /// source text is checked.
    pub(super) fn check_empty_then_statement(&mut self, file: FileId, s: StmtId, then: StmtId) {
        let hir = self.hir(file);
        let (text, written) = (&hir.text[..], hir[then].start);
        let start = if written > hir[s].start && text.get(written as usize) == Some(&b';') {
            written as usize
        } else if let StmtKind::If { test, .. } = hir[s].kind
            && let close = skip_trivia(text, self.end_of_expr(file, test) as usize)
            && text.get(close) == Some(&b')')
        {
            // An empty statement may have no recorded position.
            skip_trivia(text, close + 1)
        } else {
            return;
        };
        if text.get(start) == Some(&b';') {
            self.error_at((file, start as u32, 0), 1313, &[]);
        }
    }

    /// From `checkForOfStatement`, for a `for await`: 18038.
    pub(super) fn check_for_await_in_class_static_block(&mut self, file: FileId, s: StmtId) {
        let hir = self.hir(file);
        let container = hir.get_containing_function_or_class_static_block(hir.node(s));
        if hir.kind(container) == Kind::ClassStaticBlockDeclaration
            && let Some(start) = await_after_for(&hir.text, hir[s].start)
        {
            self.grammar_error_at((file, start, 0), 18038, &[]);
        }
    }

    /// `checkGrammarForInOrForOfStatement`: 1103 1431 1432, 1106, and for the variable the loop
    /// declares 1091 1188, 1189 1190, 2404 2483.
    pub(super) fn check_grammar_for_in_or_for_of_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        initializer: StmtId,
    ) -> bool {
        let hir = self.hir(file);
        if self.check_grammar_statement_in_ambient_context(file, s) {
            return true;
        }
        let is_for_in = matches!(hir[s].kind, StmtKind::ForIn { .. });
        if matches!(hir[s].kind, StmtKind::ForOf { is_await: true, .. })
            && !has_parse_diagnostics(hir)
            && let Some(start) = await_after_for(&hir.text, hir[s].start)
        {
            match self.place_of_await_in(file, hir.node(s)) {
                AwaitPlace::Allowed | AwaitPlace::StaticBlock => {}
                AwaitPlace::TopLevel => {
                    self.check_top_level_await(file, start, 1431, 1432);
                }
                AwaitPlace::Elsewhere => {
                    let related = self.function_to_mark_async(file, hir.node(s), true);
                    let diagnostic = self.error_at((file, start, 0), 1103, &[]);
                    diagnostic.related_information.extend(related);
                    return true;
                }
            }
        }
        let decls = match hir[initializer].kind {
            StmtKind::Var(decls) => decls,
            // Outside an await context the expression before `of` cannot be the identifier `async`.
            StmtKind::Expr(target) => {
                if !is_for_in
                    && matches!(hir[target].kind, ExprKind::Ident(name) if name == known::async_)
                    && !is_parenthesized(hir, target)
                    && matches!(
                        self.place_of_await_in(file, hir.node(s)),
                        AwaitPlace::TopLevel | AwaitPlace::Elsewhere
                    )
                {
                    self.grammar_error_on_node(file, target, 1106, &[]);
                }
                return false;
            }
            _ => return false,
        };
        if self.check_grammar_variable_declaration_list(file, initializer, decls)
            || decls.is_empty()
        {
            return false;
        }
        let first = &hir[decls.at(0)];
        if decls.len() > 1 {
            let second = hir[hir[decls.at(1)].pat].pos;
            let code = if is_for_in { 1091 } else { 1188 };
            self.grammar_error_at((file, second, 0), code, &[])
        } else if first.init.is_some() {
            self.grammar_error_on_node(file, first.pat, if is_for_in { 1189 } else { 1190 }, &[])
        } else {
            first.ty.is_some()
                && self.grammar_error_on_node(
                    file,
                    first.pat,
                    if is_for_in { 2404 } else { 2483 },
                    &[],
                )
        }
    }

    /// `checkGrammarVariableDeclarationList` for the list stored as the statement `s`: 1009, 1123,
    /// 1493 1494, 1545 1546, 1547 1548.
    pub(super) fn check_grammar_variable_declaration_list(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(first) = decls.iter().next() else {
            // `declarations.Pos()`: the end of the keyword.
            let mut keyword = self.start_after_modifiers(file, s) as usize;
            if is_word_at(&hir.text, keyword, b"await") {
                keyword = skip_trivia(&hir.text, keyword + b"await".len());
            }
            let end = (keyword + word_at(&hir.text, keyword).len()) as u32;
            return self.grammar_error_at((file, end, end), 1123, &[]);
        };
        // `checkGrammarForDisallowedTrailingComma`: in a file without syntax errors no other comma
        // can follow the last declaration.
        let end = self.end_of_var_decl_list(file, decls);
        let comma = skip_trivia(&hir.text, end as usize) as u32;
        if hir.text.get(comma as usize) == Some(&b',') {
            return self.grammar_error_at((file, comma, comma + 1), 1009, &[]);
        }
        let is_await = match hir[first].kind {
            VarKind::Using => false,
            VarKind::AwaitUsing => true,
            _ => return false,
        };
        let start = self.start_after_modifiers(file, s);
        let at = (file, start, end);
        let around = match bound.stmt_parent[s.idx()] {
            Parent::Stmt(p) if p.is_some() => Some(hir[p].kind),
            _ => None,
        };
        let codes = match around {
            Some(StmtKind::ForIn { left, .. }) if left == s => Some([1493, 1494]),
            _ if hir[first].flags.contains(Flags::AMBIENT) => Some([1545, 1546]),
            // The statements of a clause have the `switch` for a parent.
            Some(StmtKind::Switch { .. }) => Some([1547, 1548]),
            _ => None,
        };
        if let Some(codes) = codes {
            return self.grammar_error_at(at, codes[usize::from(is_await)], &[]);
        }
        is_await
            && self.check_grammar_await_or_await_using(file, hir.node(s), start, |_| at.2, false)
    }

    /// `checkVariableStatement`, before the declarations.
    pub(super) fn check_grammar_variable_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
    ) {
        if !self.check_grammar_modifiers(file, s)
            && !self.check_grammar_variable_declaration_list(file, s, decls)
        {
            self.check_grammar_for_disallowed_block_scoped_variable_statement(file, s, decls);
        }
    }

    /// `checkGrammarForDisallowedBlockScopedVariableStatement`: 1156.
    fn check_grammar_for_disallowed_block_scoped_variable_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
    ) {
        let hir = self.hir(file);
        let keyword = match decls.iter().next().map(|d| hir[d].kind) {
            Some(VarKind::Let) => "let",
            Some(VarKind::Const) => "const",
            Some(VarKind::Using) => "using",
            Some(VarKind::AwaitUsing) => "await using",
            Some(VarKind::Var) | None => return,
        };
        if !self.container_allows_block_scoped_variable(file, s) {
            self.error_at(
                (file, hir[s].start, hir[s].loc.end),
                1156,
                &[Arg::Text(keyword)],
            );
        }
    }

    /// `containerAllowsBlockScopedVariable(node.Parent)` for the statement `s`.
    pub(super) fn container_allows_block_scoped_variable(&self, file: FileId, s: StmtId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut parent = bound.stmt_parent[s.idx()];
        while let Parent::Stmt(p) = parent
            && p.is_some()
        {
            match hir[p].kind {
                StmtKind::Labeled { .. } => parent = bound.stmt_parent[p.idx()],
                StmtKind::If { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. } => return false,
                _ => return !is_with_statement(hir, p),
            }
        }
        true
    }

    /// `checkTypeAliasDeclaration`, `checkInterfaceDeclaration`: 1156.
    pub(super) fn check_grammar_type_declaration(
        &mut self,
        file: FileId,
        s: StmtId,
        name: u32,
        keyword: &str,
    ) {
        if !self.container_allows_block_scoped_variable(file, s) {
            self.grammar_error_at((file, name, 0), 1156, &[Arg::Text(keyword)]);
        }
    }

    /// `checkCatchClause`, after the variable: 1196, the caught value can be anything; 1197; 2492,
    /// the block cannot redeclare the name.
    pub(super) fn check_catch_clause(&mut self, file: FileId, param: VarDeclId, handler: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let caught = &hir[param];
        if caught.ty.is_some() {
            let ty = self.type_from_node(file, caught.ty);
            if !self.has_any_flag(ty) && ty != TypeId::UNKNOWN {
                self.grammar_error_at((file, start_of_type(hir, caught.ty), 0), 1196, &[]);
            }
            return;
        }
        if caught.init.is_some() {
            self.grammar_error_at((file, self.start_of(file, caught.init), 0), 1197, &[]);
            return;
        }
        // `node.Locals()` is the scope around the block, `Block.Locals()` the one around its
        // statements.
        let StmtKind::Block(list) = hir[handler].kind else {
            return;
        };
        let Some(first) = hir.ids(list).next() else {
            return;
        };
        let (clause, block) = (
            bound.stmt_scope[handler.idx()],
            bound.stmt_scope[first.idx()],
        );
        if clause.is_none() || block.is_none() {
            return;
        }
        let block_locals = bound.scopes[block.idx()].locals;
        for &(caught_name, _) in bound.table(bound.scopes[clause.idx()].locals) {
            if let Some(block_local) = bound.lookup(block_locals, caught_name)
                && let symbol = &bound.symbols[block_local.idx()]
                && symbol.flags.intersects(SymFlags::BLOCK_SCOPED_VARIABLE)
                && let Some(&declaration) = symbol.decls.get(symbol.value_declaration as usize)
            {
                self.grammar_error_on_node(file, declaration, 2492, &[Arg::Atom(caught_name)]);
            }
        }
    }

    // ───────────────────────────── `await` ─────────────────────────────

    /// `checkAwaitExpression`, before the operand.
    pub(super) fn check_grammar_await_expression(&mut self, file: FileId, e: ExprId) {
        let hir = self.hir(file);
        let start = hir[e].pos;
        if is_word_at(&hir.text, start as usize, b"await") {
            let end = |c: &Self| c.end_inside_parentheses(file, e);
            self.check_grammar_await_or_await_using(file, hir.node(e), start, end, true);
        }
    }

    /// `checkGrammarAwaitOrAwaitUsing` for the `await` expression or the declaration list of an
    /// `await using` that starts at `start`: 1308 1375 1378 2524 18037, 2852 2853 2854 18054, and
    /// 1309. `end`: its end, evaluated only when the error spans the whole node.
    fn check_grammar_await_or_await_using(
        &mut self,
        file: FileId,
        node: Node,
        start: u32,
        end: impl Fn(&Self) -> u32,
        is_await_expression: bool,
    ) -> bool {
        let hir = self.hir(file);
        let place = self.place_of_await_in(file, node);
        // Where `await` is not a keyword, `await (x)` is a call of an identifier with that name.
        if is_await_expression
            && !matches!(place, AwaitPlace::Allowed | AwaitPlace::StaticBlock)
            && after_await(&hir.text, start) != AfterAwait::Operand
        {
            return false;
        }
        let codes = if is_await_expression {
            [18037, 1375, 1378, 1308]
        } else {
            [18054, 2853, 2854, 2852]
        };
        let mut has_error = match place {
            AwaitPlace::Allowed => false,
            // "We report this regardless as to whether there are parse diagnostics."
            AwaitPlace::StaticBlock => {
                self.error_at((file, start, end(self)), codes[0], &[]);
                true
            }
            _ if has_parse_diagnostics(hir) => false,
            AwaitPlace::TopLevel => self.check_top_level_await(file, start, codes[1], codes[2]),
            AwaitPlace::Elsewhere => {
                let related = self.function_to_mark_async(file, node, false);
                let diagnostic = self.error_at((file, start, 0), codes[3], &[]);
                diagnostic.related_information.extend(related);
                true
            }
        };
        if is_await_expression && hir.is_in_parameter_initializer_before_containing_function(node) {
            self.error_at((file, start, end(self)), 2524, &[]);
            has_error = true;
        }
        has_error
    }

    /// The `switch` on `moduleKind` in `checkGrammarAwaitOrAwaitUsing` and
    /// `checkGrammarForInOrForOfStatement`, and the code before it: the diagnostics for an `await`
    /// at `start`, at the top level of a file.
    fn check_top_level_await(
        &mut self,
        file: FileId,
        start: u32,
        is_no_module: u32,
        options_do_not_have_it: u32,
    ) -> bool {
        let kind = self.p.files.options.module;
        let is_module = self.is_effective_external_module(file);
        if !is_module {
            self.error_at((file, start, 0), is_no_module, &[]);
        }
        // `GetImpliedNodeFormatForFile`: the extension decides, regardless of the module resolution
        // mode.
        let module = self.files().module(file);
        let is_esm = module.specifies_esm || module.file_name().ends_with(b".mts");
        let has_it = kind.is_node()
            || matches!(
                kind,
                ModuleKind::Es2022 | ModuleKind::EsNext | ModuleKind::Preserve | ModuleKind::System
            );
        if kind.is_node() && !is_esm {
            self.error_at((file, start, 0), 1309, &[]);
        } else if !has_it || self.is_target_before_es2017() {
            self.error_at((file, start, 0), options_do_not_have_it, &[]);
        } else {
            return !is_module;
        }
        true
    }

    /// `IsEffectiveExternalModule`
    pub(super) fn is_effective_external_module(&self, file: FileId) -> bool {
        let (module, kind) = (self.files().module(file), self.p.files.options.module);
        // `isCommonJSContainingModuleKind`
        module.hir.has_module_syntax
            || (kind == ModuleKind::CommonJs || kind.is_node()) && module.is_commonjs()
    }

    /// `getContainingFunctionOrClassStaticBlock`, `NodeFlagsAwaitContext`, `IsInTopLevelContext`, of `node`.
    fn place_of_await_in(&mut self, file: FileId, node: Node) -> AwaitPlace {
        let hir = self.hir(file);
        let container = hir.get_containing_function_or_class_static_block(node);
        if hir.kind(container) == Kind::ClassStaticBlockDeclaration {
            return AwaitPlace::StaticBlock;
        }
        let is_in_await_context = match hir.await_context(node) {
            Ok(is_in_it) => is_in_it,
            Err(statement) => {
                if self.parsed_again_for_await.is_none() {
                    // `parseSourceFileWorker`: a declaration file is not reparsed.
                    let is_parsed_again =
                        hir.has_module_syntax && hir.kind != FileKind::Declaration;
                    let statements = if is_parsed_again {
                        let index = self.exprs_by_kind(file);
                        self.statements_parsed_again_for_await(file, &index)
                    } else {
                        Vec::new()
                    };
                    self.parsed_again_for_await = Some(statements);
                }
                let parsed_again = self.parsed_again_for_await.as_deref().unwrap_or_default();
                matches!(hir.data(statement), NodeData::Stmt(s) if parsed_again.binary_search(&s).is_ok())
            }
        };
        if is_in_await_context {
            AwaitPlace::Allowed
        } else if hir.is_in_top_level_context(node) {
            AwaitPlace::TopLevel
        } else {
            AwaitPlace::Elsewhere
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// From `checkVariableLikeDeclaration`: 2850 2851, or a more specific error. A value to be
    /// disposed must have the required members.
    pub(super) fn check_initializer_of_using_declaration(&mut self, file: FileId, d: VarDeclId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (decl, stmt) = (&hir[d], bound.var_stmt[d.idx()]);
        if decl.init.is_none() || stmt.is_none() || !matches!(hir[decl.pat].kind, PatKind::Ident(_))
        {
            return;
        }
        // `getGlobalDisposableType`, `getGlobalAsyncDisposableType`: a missing global type is
        // reported without a file, and the check is skipped.
        let is_await = decl.kind == VarKind::AwaitUsing;
        let mut target: SmallVec<[TypeId; 4]> = SmallVec::new();
        for name in [known::AsyncDisposable, known::Disposable] {
            if name == known::AsyncDisposable && !is_await {
                continue;
            }
            if self.get_global_type(name, 0, true).is_some() {
                target.push(self.global_ref(name, &[]));
            }
        }
        if target.len() != 1 + usize::from(is_await) {
            return;
        }
        target.extend([TypeId::NULL, TypeId::UNDEFINED]);
        let target = self.union(&target);
        // `widenTypeForVariableLikeDeclaration`: an object literal may have excess properties.
        let source = self.type_of_expr(file, decl.init);
        let source = self.get_widened_type(source);
        let at = self.error_start_of(file, decl.init);
        // An anonymous function uses the name of the variable.
        let at = if at == hir[decl.pat].pos {
            self.place_of_token(file, at)
        } else {
            (file, at, self.error_end_of(file, decl.init))
        };
        self.check_type_assignable_to(source, target, Some(at), Some(2850 + u32::from(is_await)));
    }

    /// The ranges of `expressions_cached_discarding`, where every check of `checkExpression` has
    /// reported in vain, without the nodes that `checkDeferredNodes` has checked since.
    fn ranges_checked_discarding(&self, file: FileId) -> Vec<(u32, u32)> {
        let mut ranges = Vec::new();
        for &e in &self.expressions_cached_discarding {
            if !self.is_deferred_node.contains(&e) {
                let mut deferred = Vec::new();
                self.ranges_of_deferred_nodes(file, self.hir(file).node(e), &mut deferred);
                let range = (self.start_of(file, e), self.end_of_expr(file, e));
                ranges.extend(parts_outside(range, deferred));
            }
        }
        ranges
    }

    /// The ranges of the outermost nodes below `node` that `checkNodeDeferred` was called with.
    fn ranges_of_deferred_nodes(&self, file: FileId, node: Node, found: &mut Vec<(u32, u32)>) {
        let hir = self.hir(file);
        hir.for_each_child(node, &mut |child| {
            let expression = match hir.data(child) {
                NodeData::Expr(e) => e,
                NodeData::Prop(p) => hir[p].value,
                _ => ExprId::NONE,
            };
            if self.is_deferred_node.contains(&expression) {
                found.push((hir.start(child), self.end_of_node(file, child)));
            } else {
                self.ranges_of_deferred_nodes(file, child, found);
            }
            false
        });
    }

    /// Removes the diagnostics reported inside ranges that `checkSourceFile` never visits. Parser and binder diagnostics stay. Runs
    /// after all passes.
    pub(super) fn remove_diagnostics_in_unchecked_ranges(&mut self, file: FileId) {
        let hir = self.hir(file);
        let discarded = self.ranges_checked_discarding(file);
        let never_checked = [&self.never_checked.borrow()[..], &discarded[..]].concat();
        if !never_checked.is_empty() {
            self.reported.retain(|d| {
                !(never_checked.iter()).any(|&(from, to)| (from..to).contains(&d.start))
                    || d.by_emit
                    || d.by_another_node
                    // Reported on the node that is not checked, by the check of its parent only.
                    || matches!(d.code, 1039 | 1136 | 1141 | 1254)
                    // Likewise, on an element of a heritage clause. A class below it can have them.
                    || matches!(d.code, 1174 | 2499 | 2500)
                        && never_checked.iter().any(|&(from, _)| from == d.start)
                    || is_binder_diagnostic(d.code)
                    || hir.diagnostics.iter().any(|parsed| {
                        !matches!(
                            parsed.kind,
                            DiagnosticKind::Grammar | DiagnosticKind::Checker
                        ) && (parsed.start, parsed.code) == (d.start, d.code)
                    })
            });
        }
    }

    /// `languageVersion < ES2017`. `GetEmitScriptTarget`: an unset target means the latest.
    fn is_target_before_es2017(&self) -> bool {
        let target = self.p.files.options.target;
        target != ScriptTarget::None && target < ScriptTarget::ES2017
    }

    /// `reparseTopLevelAwait`: the statements of a module in which `await` was parsed as an
    /// identifier are reparsed with `await` as a keyword, and are in an await context from then on.
    /// Where that makes a statement longer than it was, the parser continues in that mode until it
    /// has passed the next such statements, or to the end of the file if there are none.
    fn statements_parsed_again_for_await(&self, file: FileId, index: &ExprsByKind) -> Vec<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The statements in which `await` was parsed as an identifier, and whether the statement
        // ended directly after it.
        let mut noted: Vec<(StmtId, bool)> = Vec::new();
        if let Some(name) = self.atoms().lookup(b"await") {
            for &e in index.of(ExprTag::Ident) {
                // `parsePropertyName` restores it, and to the parser `{ await }` is only a property
                // name.
                if matches!(hir[e].kind, ExprKind::Ident(n) if n == name)
                    && !matches!(bound.expr_parent[e.idx()], Parent::Prop(p) if hir[p].kind == PropKind::Shorthand)
                    && let Some(s) = self.statement_noting_await(file, e)
                {
                    noted.push((s, false));
                }
            }
            // `newIdentifier`: after a dot as well.
            for &e in index.of(ExprTag::Dot) {
                if matches!(hir[e].kind, ExprKind::Dot { name: n, .. } if n == name)
                    && let Some(s) = self.statement_noting_await(file, e)
                {
                    noted.push((s, false));
                }
            }
        }
        for &e in index.of(ExprTag::Await) {
            let ends = match after_await(&hir.text, hir[e].pos) {
                AfterAwait::Operand => continue,
                AfterAwait::GoesOn => false,
                AfterAwait::Ends => true,
            };
            if let Some(s) = self.statement_noting_await(file, e) {
                noted.push((s, ends));
            }
        }
        let mut again = Vec::new();
        if noted.is_empty() {
            return again;
        }
        let is_noted = |s: StmtId| noted.iter().any(|n| n.0 == s);
        let mut continues = false;
        let mut statements = hir.ids(hir.body).peekable();
        while let Some(s) = statements.next() {
            let is_one = is_noted(s);
            if is_one || continues {
                again.push(s);
            }
            if is_one {
                if noted.iter().any(|n| n.0 == s && n.1) {
                    continues = true;
                } else if !statements.peek().is_some_and(|&next| is_noted(next)) {
                    continues = false;
                }
            }
        }
        again.sort_unstable();
        again
    }

    /// The statement of the file whose `statementHasAwaitIdentifier` is set by the identifier
    /// `await` at `e`. `None`: the flag is restored on the way out, or `await` is already a keyword
    /// there.
    fn statement_noting_await(&self, file: FileId, e: ExprId) -> Option<StmtId> {
        let hir = self.hir(file);
        let mut below = hir.node(e);
        loop {
            let above = hir.parent(below);
            let kind = hir.kind(above);
            let is_lost = match kind {
                Kind::SourceFile => match hir.data(below) {
                    NodeData::Stmt(s) => return Some(s),
                    _ => return None,
                },
                Kind::Unknown
                | Kind::ModuleDeclaration
                | Kind::EnumDeclaration
                | Kind::ComputedPropertyName
                | Kind::ExportAssignment => true,
                // `parseFunctionBlock`
                Kind::Block => above.part() == Some(Part::Body),
                Kind::ClassDeclaration => hir.flags(above).contains(Flags::AMBIENT),
                _ => {
                    kind.is_function_like()
                        && hir.flags(above).contains(Flags::ASYNC)
                        && (matches!(hir.data(below), NodeData::Param(_))
                            || below == hir.body(above))
                }
            };
            if is_lost {
                return None;
            }
            below = above;
        }
    }

    /// 1356 at the function that contains `node`: `getContainingFunctionOrClassStaticBlock`,
    /// `GetContainingFunction`. Nothing for a constructor. `is_loop`: a `for await` does not test
    /// whether the function is `async`.
    fn function_to_mark_async(&self, file: FileId, node: Node, is_loop: bool) -> Vec<Reported> {
        let hir = self.hir(file);
        let container = hir.get_containing_function(node);
        if container.is_none()
            || hir.kind(container) == Kind::Constructor
            || !is_loop && hir.flags(container).contains(Flags::ASYNC)
        {
            return Vec::new();
        }
        let (start, end) = self.error_range_of_fn(file, hir.function_of(container));
        vec![Reported::bare((file, start, end), 1356)]
    }

    // ───────────────────────────── unchecked ranges ─────────────────────────────

    /// `GetContainingFunction`
    pub(super) fn get_containing_function(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let hir = self.hir(file);
        hir.function_of(hir.get_containing_function(hir.node(e)))
            .some()
    }
}
