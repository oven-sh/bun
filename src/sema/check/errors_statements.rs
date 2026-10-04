//! Statements, and checks of variable and property declarations.
//!
//! * `with`: 1101 1300 2410. Misplaced `return`: 1108 18041. `if (x);`: 1313. Statements in ambient
//!   contexts: 1036.
//! * Assignment targets of `for`-`in` and `for`-`of`: 2405 2406 2780, 2487 2781, 1106.
//! * `catch`: 1196 2492.
//! * Where `await`, `for await` and `await using` are allowed: 1308 1375 1378 2524 18037, 1103 1431
//!   1432 18038, 2852 2853 2854 18054, and 1309 for all three. `yield` in a parameter initializer:
//!   2523.
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
use crate::bind::{Decl, Parent};
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

/// Position of the `;` that is the entire `then` statement of the `if` at `at`. An empty statement
/// may have no recorded position.
fn empty_then_statement(text: &[u8], at: u32) -> Option<u32> {
    if !is_word_at(text, at as usize, b"if") {
        return None;
    }
    let open = skip_trivia(text, at as usize + 2);
    if text.get(open) != Some(&b'(') {
        return None;
    }
    let next = skip_trivia(text, end_of_brackets(text, open)?);
    (text.get(next) == Some(&b';')).then_some(next as u32)
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

/// The diagnostics of binder.go. The binder visits every node, whether or not the checker does. Not
/// 1184: the binder only reports it for `export as namespace`, and wherever it is reported here it
/// comes from the checker (`reportObviousModifierErrors`).
fn is_binder_diagnostic(code: u32) -> bool {
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

impl Checker<'_> {
    // ───────────────────────────── statements ─────────────────────────────

    /// `checkGrammarStatementInAmbientContext`: 1036, once in each block.
    #[inline]
    pub(super) fn check_grammar_statement_in_ambient_context(
        &mut self,
        file: FileId,
        s: StmtId,
    ) -> bool {
        self.has_ambient_context && self.check_grammar_statement_in_ambient_file(file, s)
    }

    /// The same, in a file in which something is ambient.
    fn check_grammar_statement_in_ambient_file(&mut self, file: FileId, s: StmtId) -> bool {
        let hir = self.hir(file);
        let node = hir.node(s);
        if !hir.is_ambient(node) {
            return false;
        }
        let parent = hir.parent(node);
        if !matches!(
            hir.kind(parent),
            Kind::Block | Kind::ModuleBlock | Kind::SourceFile
        )
            // 1183 is reported on the body of a function, which covers its statements.
            || hir.kind(hir.parent(parent)).is_function_like()
            || self.has_node_check_flag(parent, HAS_REPORTED_STATEMENT_IN_AMBIENT_CONTEXT)
            || !self.grammar_error_at((file, hir[s].start, 0), 1036, &[])
        {
            return false;
        }
        *self.node_check_flags.entry(parent).or_default() |=
            HAS_REPORTED_STATEMENT_IN_AMBIENT_CONTEXT;
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
        // An empty body has no contents, and its `pos` can be 0, which is not its real position.
        let body = hir.id_at(parts, 1);
        if !matches!(hir[body].kind, StmtKind::Empty) {
            self.never_check(hir[body].start, hir[body].loc.end);
        }
    }

    /// The start of `checkReturnStatement`: 1108 18041. Returns the containing function, if the
    /// returned expression is to be checked.
    pub(super) fn check_grammar_return_statement(
        &mut self,
        file: FileId,
        s: StmtId,
    ) -> Option<FnId> {
        let hir = self.hir(file);
        let container = self.enclosing_fn(file, Parent::Stmt(s));
        if !self.check_grammar_statement_in_ambient_context(file, s) {
            match container {
                Some(func) if hir[func].kind != FnKind::StaticBlock => return Some(func),
                Some(_) => self.grammar_error_at((file, hir[s].start, 0), 18041, &[]),
                None => {
                    // The parser uses one diagnostic for both.
                    let pos = hir[s].start;
                    self.reported.retain(|d| d.start != pos || d.code != 18041);
                    self.grammar_error_at((file, pos, 0), 1108, &[])
                }
            };
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
            Some(written)
        } else {
            empty_then_statement(text, hir[s].start)
        };
        if let Some(start) = start {
            self.error_at((file, start, 0), 1313, &[]);
        }
    }

    /// `checkGrammarForInOrForOfStatement`, and the static block check from `checkForOfStatement`:
    /// 1103 1431 1432 18038, 1106, and for the variable the loop declares 1091 1188, 1189 1190,
    /// 2404 2483.
    pub(super) fn check_grammar_for_in_or_for_of_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        initializer: StmtId,
    ) -> bool {
        let hir = self.hir(file);
        let is_refused = self.check_grammar_statement_in_ambient_context(file, s);
        let is_for_in = matches!(hir[s].kind, StmtKind::ForIn { .. });
        if matches!(hir[s].kind, StmtKind::ForOf { is_await: true, .. })
            && !has_parse_diagnostics(hir)
            && let Some(start) = await_after_for(&hir.text, hir[s].start)
        {
            // The parser's 1103 is from the parse of a script, in which `await` is an identifier.
            let place = self.place_of_await_in(file, hir.node(s));
            if place != AwaitPlace::Elsewhere {
                self.reported.retain(|d| d.start != start || d.code != 1103);
            }
            match place {
                AwaitPlace::StaticBlock => {
                    self.error_at((file, start, 0), 18038, &[]);
                }
                AwaitPlace::TopLevel if !is_refused => {
                    self.check_top_level_await(file, start, 1431, 1432);
                }
                AwaitPlace::Elsewhere if !is_refused => {
                    let related = self.function_to_mark_async(file, hir.node(s), true);
                    let diagnostic = self.error_at((file, start, 0), 1103, &[]);
                    diagnostic.related_information.extend(related);
                    return true;
                }
                _ => {}
            }
        }
        if is_refused {
            return true;
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
        if self.check_grammar_variable_declaration_list(file, initializer, decls) {
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

    /// `checkGrammarVariableDeclarationList` for the list stored as the statement `s`: 1493 1494,
    /// 1545 1546, 1547 1548. 1009 and 1123 are reported by the parser.
    pub(super) fn check_grammar_variable_declaration_list(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
    ) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(first) = decls.iter().next() else {
            return true;
        };
        let is_await = match hir[first].kind {
            VarKind::Using => false,
            VarKind::AwaitUsing => true,
            _ => return false,
        };
        let start = self.start_after_modifiers(file, s);
        let at = (file, start, self.end_of_var_decl_list(file, decls));
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
            // The parser uses one diagnostic for both kinds.
            self.reported.retain(|d| d.start != start || d.code != 1545);
            return self.grammar_error_at(at, codes[usize::from(is_await)], &[]);
        }
        is_await
            && self.check_grammar_await_or_await_using(file, hir.node(s), start, |_| at.2, false)
    }

    /// `checkVariableStatement`, before the declarations: 1156 is `checkGrammarForDisallowedBlockScopedVariableStatement`.
    pub(super) fn check_grammar_variable_statement(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
    ) {
        let hir = self.hir(file);
        let Some(kind) = decls.iter().next().map(|d| hir[d].kind) else {
            return;
        };
        if kind == VarKind::Var {
            return;
        }
        if self.has_grammar_error_in_modifiers(file, s) {
            // The parser's.
            let start = self.start_after_modifiers(file, s);
            self.reported
                .retain(|d| d.start != start || !matches!(d.code, 1545 | 1546));
        } else if !self.check_grammar_variable_declaration_list(file, s, decls)
            && !self.container_allows_block_scoped_variable(file, s)
        {
            let keyword = match kind {
                VarKind::Let => "let",
                VarKind::Const => "const",
                VarKind::Using => "using",
                _ => "await using",
            };
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

    /// `checkCatchClause`, after the variable: 1196, the caught value can be anything; 2492, the
    /// block cannot redeclare the name.
    pub(super) fn check_catch_clause(&mut self, file: FileId, param: VarDeclId, handler: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let caught = &hir[param];
        if caught.ty.is_some() {
            let ty = self.type_from_node(file, caught.ty);
            if !self.has_any_flag(ty) && ty != TypeId::UNKNOWN {
                self.grammar_error_at((file, hir[caught.ty].pos, 0), 1196, &[]);
            }
            return;
        }
        let StmtKind::Block(list) = hir[handler].kind else {
            return;
        };
        let (mut names, mut declared) = (Vec::new(), Vec::new());
        for s in hir.ids(list) {
            if let StmtKind::Var(decls) = hir[s].kind {
                for d in decls.iter().filter(|&d| hir[d].kind != VarKind::Var) {
                    names_bound_by(hir, hir[d].pat, &mut declared);
                }
            }
        }
        if declared.is_empty() {
            return;
        }
        names_bound_by(hir, caught.pat, &mut names);
        for &(name, pat) in &declared {
            let symbol = bound.pat_symbol[pat.idx()];
            if symbol.is_none() || !names.iter().any(|n| n.0 == name) {
                continue;
            }
            // It must be the `ValueDeclaration` of the block's local symbol with that name.
            let first = (bound.symbols[symbol.idx()].decls.iter())
                .find(|d| !matches!(d, Decl::Interface(_) | Decl::Alias(_)));
            if first == Some(&Decl::Var(pat)) {
                self.grammar_error_at((file, hir[pat].pos, 0), 2492, &[Arg::Atom(name)]);
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
        let is_esm = module.specifies_esm || module.path.ends_with(b".mts");
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

    /// `IsEffectiveExternalModule`. `GetEmitModuleDetectionKind`: from `node16` on every file is a
    /// module. A `moduleDetection` option that overrides this is not stored.
    fn is_effective_external_module(&self, file: FileId) -> bool {
        self.files().module(file).is_module() || self.p.files.options.module.is_node()
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
                    let is_parsed_again = self.is_effective_external_module(file)
                        && hir.kind != FileKind::Declaration;
                    self.parsed_again_for_await = Some(if is_parsed_again {
                        let index = self.exprs_by_kind(file);
                        self.statements_parsed_again_for_await(file, &index)
                    } else {
                        Vec::new()
                    });
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
        // An initializer in a `for`-`in` is an error already.
        if decl.init.is_none()
            || stmt.is_none()
            || !matches!(hir[decl.pat].kind, PatKind::Ident(_))
            || matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForIn { .. }))
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
            if self.global_type_symbol(name).is_some() {
                target.push(self.global_ref(name, &[]));
            } else {
                self.report_global_error(2318, vec![self.atom_text(name)]);
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

    /// Removes the diagnostics reported inside ranges that `checkSourceFile` never visits. Parser and binder diagnostics stay. Runs
    /// after all passes.
    pub(super) fn remove_diagnostics_in_unchecked_ranges(&mut self, file: FileId) {
        let hir = self.hir(file);
        // These are recorded during parsing but are checker diagnostics.
        if has_parse_diagnostics(hir) {
            self.reported
                .retain(|d| !matches!(d.code, 1103 | 1308 | 1545 | 18041));
        }
        // `checkExternalImportOrExportDeclaration` reports 1141 for a module specifier that is not
        // a string literal, and returns.
        for &specifier in &hir.specifier_expressions {
            self.never_check(
                self.start_of(file, specifier),
                self.end_of_expr(file, specifier),
            );
        }
        let never_checked = self.never_checked.borrow();
        if !never_checked.is_empty() {
            self.reported.retain(|d| {
                !(never_checked.iter()).any(|&(from, to)| (from..to).contains(&d.start))
                    || d.code == 1141
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
