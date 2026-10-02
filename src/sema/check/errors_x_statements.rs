//! Statements, and what declarations of variables and properties have to say for themselves.
//!
//! * `with`: 1101 1300 2410. `return` out of place: 1108 18041. `if (x);`: 1313. Statements in ambient contexts: 1036.
//! * What `for`-`in` and `for`-`of` assign to: 2405 2406 2780, 2487 2781, 1106.
//! * `catch`: 1196 2492.
//! * Where `await`, `for await` and `await using` can be written: 1308 1375 1378 2524 18037, 1103 1431 1432 18038,
//!   2852 2853 2854 18054, and 1309 for all three. `yield` in a parameter initializer: 2523.
//! * `using` and `await using`: 1493 1494, 1545 1546, 1547 1548, and what they are initialized with: 2850 2851.
//! * Declarations of one thing with different modifiers: 2687.
//!
//! Follows `checkWithStatement`, `checkReturnStatement`, `checkIfStatement`, `checkForInStatement`, `checkForOfStatement`,
//! `checkReferenceExpression`, `checkCatchClause`, `checkVariableStatement` and `checkVariableLikeDeclaration` of TypeScript
//! 7.0.2's checker.go, `checkGrammarStatementInAmbientContext`, `checkGrammarForInOrForOfStatement`,
//! `checkGrammarVariableDeclarationList`, `checkGrammarAwaitOrAwaitUsing`, `checkGrammarYieldExpression` and, for `using`, `checkGrammarModifiers` of its
//! grammarchecks.go, `checkStrictModeWithStatement` of its binder.go, and `reparseTopLevelAwait` of its parser.go.
//!
//! The walk (in_order.rs) calls these where checker.go does. TypeScript never checks the body of a `with` statement, the expression of a
//! misplaced `return`, the expression of a `for`-`of` whose declaration list is empty, or the operand of a `yield` outside a generator:
//! the walk notes where it turns away, and what the passes said there is taken back when they are through.

use super::*;
use crate::bind::{Decl, MemberOwner, Parent, PatParent};
use crate::resolve::{ModuleKind, ScriptTarget};
use smallvec::SmallVec;

// ───────────────────────────── the text ─────────────────────────────

/// Where the next token starts, going from `at` past white space and comments, and whether a line ends on the way.
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
                let len = rest
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map_or(rest.len(), |i| i + 2);
                is_on_new_line |= rest[..len].iter().any(|&b| matches!(b, b'\n' | b'\r'));
                at += 2 + len;
            }
            _ => return (at, is_on_new_line),
        }
    }
}

/// Where the `await` of the `for await` at `at` is.
fn await_after_for(text: &[u8], at: u32) -> Option<u32> {
    if !is_word_at(text, at as usize, b"for") {
        return None;
    }
    let next = skip_trivia(text, at as usize + 3);
    is_word_at(text, next, b"await").then_some(next as u32)
}

/// Where the `;` is that is all there is to the `then` statement of the `if` at `at`. An empty statement may come without its place.
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

/// What the parser makes of an `await` that nothing says is a keyword, going by what follows it.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AfterAwait {
    /// `isAwaitExpression`: a name, a keyword or a literal on the same line. It is an `await` expression.
    Operand,
    /// It is a name, and what follows goes on from it: `await (x)`, `await [x]`, `await - x`.
    GoesOn,
    /// It is a name, and what follows cannot go on from it: the statement is over.
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

/// A `with` statement is kept as a block of its object and its body, put where the keyword is.
pub(super) fn is_with_statement(hir: &File, s: StmtId) -> bool {
    matches!(hir[s].kind, StmtKind::Block(list) if list.len() == 2)
        && is_word_at(&hir.text, hir[s].start as usize, b"with")
}

/// What binder.go says. It goes through everything, whether or not the checker does. Not 1184: the binder only says it of
/// `export as namespace`, and everywhere it is said here it is the checker's (`reportObviousModifierErrors`).
pub(super) fn is_said_by_the_binder(code: u32) -> bool {
    matches!(
        code,
        1100 | 1101 | 1102 | 1210 | 1212..=1215 | 1250..=1252 | 1262 | 1314..=1316 | 1344 | 1359 | 2300 | 2451 | 2528 | 2567 | 2668 | 5061 | 18012
    )
}

/// What parser.go and scanner.go say while a file is parsed, among what `early_errors` keeps: the rest of that is the binder's
/// and the checker's. 1359 is left out, which is only noted there for `await` as a name, and that is the binder's.
pub(super) fn is_said_by_the_parser(code: u32) -> bool {
    matches!(
        code,
        1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1069 | 1084 | 1109 | 1110 | 1121 | 1124..=1132 | 1134..=1140
            | 1142 | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1206 | 1209 | 1223 | 1228 | 1260 | 1327
            | 1328 | 1351..=1353 | 1357 | 1369 | 1381 | 1382 | 1385..=1390 | 1433..=1443 | 1453 | 1472 | 1477 | 1478
            | 1486..=1490 | 2657 | 2754 | 2809 | 2819 | 2880 | 6188 | 6189 | 17002 | 17006..=17008 | 17014 | 17015 | 17021
            | 18009 | 18016 | 18026 | 18029 | 18030
    )
}

// ───────────────────────────── where `await` can be ─────────────────────────────

/// Where something is written, as `checkGrammarAwaitOrAwaitUsing` tells places apart.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AwaitPlace {
    /// `NodeFlagsAwaitContext`
    Allowed,
    /// The function-like thing it is in is a class static block.
    StaticBlock,
    /// `IsInTopLevelContext`, and in no await context.
    TopLevel,
    /// In a function that is not `async`, the initializer of a property, an enum or a namespace.
    Elsewhere,
}

// ───────────────────────────── members that share a name ─────────────────────────────

/// What `areDeclarationFlagsIdentical` compares.
fn compared_modifiers(flags: Flags) -> Flags {
    flags
        & (Flags::OPTIONAL
            | Flags::PRIVATE
            | Flags::PROTECTED
            | Flags::ASYNC
            | Flags::ABSTRACT
            | Flags::READONLY
            | Flags::STATIC)
}

// `nodeLinks.hasReportedStatementInAmbientContext`, next to those of errors_x_collisions.rs
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
            // 1183 is said of the body of a function, and that goes for the statements of it.
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

    /// What `checkSourceFile` does not come to, from `start` to `end`. What a pass says there is taken back.
    pub(super) fn never_check(&self, start: u32, end: u32) {
        self.never_checked.borrow_mut().push((start, end));
    }

    /// `checkStrictModeWithStatement`, `checkStrictModeLabeledStatement`: 1101 1344. The binder goes through everything, whether or not
    /// the checker does.
    pub(super) fn check_strict_mode_statements(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, s) in hir.stmts.iter().enumerate() {
            let code = match s.kind {
                StmtKind::Block(_)
                    if !hir.with_bodies.is_empty() && is_with_statement(hir, StmtId(i as u32)) =>
                {
                    1101
                }
                // A declaration cannot be jumped to.
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

    /// `checkWithStatement`: 1300 2410. The body is not looked at.
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
        // The object is kept as a statement and is none.
        if let StmtKind::Expr(object) = hir[hir.id_at(parts, 0)].kind {
            self.check_expression(file, object);
        }
        // Up to `node.Statement.Pos()`.
        let end = hir[hir.id_at(parts, 1)].loc.pos;
        self.grammar_error_at((file, pos, end), 2410, &[]);
        // An empty body has nothing in it, and its `pos` can be 0, which is not where it is written.
        let body = hir.id_at(parts, 1);
        if !matches!(hir[body].kind, StmtKind::Empty) {
            self.never_check(hir[body].start, hir[body].loc.end);
        }
    }

    /// The start of `checkReturnStatement`: 1108 18041. The function that returns, if what is returned is looked at.
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
                    // The parser has one word for both.
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

    /// From `checkIfStatement`: 1313. Other statements of which nothing is kept are empty as well: it has to be written that way.
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

    /// `checkGrammarForInOrForOfStatement`, and the static block from `checkForOfStatement`: 1103 1431 1432 18038, 1106, and of the
    /// variable the loop declares 1091 1188, 1189 1190, 2404 2483.
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
            // The parser's 1103 is from the parse of a script, in which `await` is a name.
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
            // Outside an await context what is written before `of` cannot be the identifier `async`.
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

    /// `checkGrammarVariableDeclarationList`, of the list that is kept as the statement `s`: 1493 1494, 1545 1546, 1547 1548. 1009 and
    /// 1123 are the parser's to say.
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
            // The parser has one word for both kinds.
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

    /// `containerAllowsBlockScopedVariable(node.Parent)`, of the statement `s`.
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

    /// `checkCatchClause`, after the variable: 1196, what is caught can be anything; 2492, the block cannot declare the name again.
    pub(super) fn check_catch_clause(&mut self, file: FileId, param: VarDeclId, handler: StmtId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let caught = &hir[param];
        if caught.ty.is_some() {
            let ty = self.type_from_node(file, caught.ty);
            if self.is_known(ty) && !self.has_any_flag(ty) && ty != TypeId::UNKNOWN {
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
            // It has to be the `ValueDeclaration` of what the block knows by the name.
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

    /// `checkGrammarAwaitOrAwaitUsing`, of the `await` expression or the list of an `await using` that starts at `start`: 1308 1375
    /// 1378 2524 18037, 2852 2853 2854 18054, and 1309. `end`: where it ends, which is asked when all of it is reported.
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
        // Where nothing makes a keyword of it, `await (x)` is a call of something by that name.
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

    /// The `switch` on `moduleKind` in `checkGrammarAwaitOrAwaitUsing` and `checkGrammarForInOrForOfStatement`, and what comes before
    /// it: what there is to say of an `await` at `start`, at the top level of a file.
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
        // `GetImpliedNodeFormatForFile`: the extension decides however modules are resolved.
        let module = self.files().module(file);
        let is_esm = module.says_esm || module.path.ends_with(b".mts");
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

    /// `IsEffectiveExternalModule`. `GetEmitModuleDetectionKind`: from `node16` on every file is a module. That `moduleDetection` says
    /// otherwise is not kept.
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
                    // `parseSourceFileWorker`: a declaration file is not parsed again.
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

    /// From `checkVariableLikeDeclaration`: 2850 2851, or what says more. What is to be disposed of has to have what it takes.
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
        // `getGlobalDisposableType`, `getGlobalAsyncDisposableType`: that there is none is said, of no file, and nothing is asked.
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
        // `widenTypeForVariableLikeDeclaration`: an object literal may well have more than it takes.
        let source = self.type_of_expr(file, decl.init);
        let source = self.regular_object(source);
        if !self.is_known(source) || self.is_assignable(source, target) {
            return;
        }
        let at = self.error_start_of(file, decl.init);
        // A function without a name of its own goes by the name of the variable.
        let end = if at == hir[decl.pat].pos {
            0
        } else {
            self.error_end_of(file, decl.init)
        };
        self.report_not_assignable_with_end(source, target, at, end, 2850 + u32::from(is_await));
    }

    /// What the passes say where `checkSourceFile` never comes is taken back. The parser's and the binder's stays. After all the passes.
    pub(super) fn take_back_what_is_never_checked(&mut self, file: FileId) {
        let hir = self.hir(file);
        // These are noted while parsing, but they are the checker's to say.
        if has_parse_diagnostics(hir) {
            self.reported
                .retain(|d| !matches!(d.code, 1103 | 1308 | 1545 | 18041));
        }
        // `checkBreakOrContinueStatement`, `checkLabeledStatement`: no other matter of grammar is brought up of what 1036 is said of.
        let refused: SmallVec<[u32; 4]> = (self.reported.iter())
            .filter(|d| d.code == 1036)
            .map(|d| d.start)
            .collect();
        if !refused.is_empty() {
            self.reported.retain(|d| {
                !matches!(d.code, 1104 | 1105 | 1107 | 1114 | 1115 | 1116)
                    || !refused.contains(&d.start)
            });
        }
        // `checkExternalImportOrExportDeclaration` reports 1141 for a module specifier that is no string literal and returns.
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
                    || is_said_by_the_binder(d.code)
                    || is_said_by_the_parser(d.code)
                        && hir.early_errors.contains(&(d.start, d.code))
            });
        }
    }

    /// `languageVersion < ES2017`. `GetEmitScriptTarget`: no target is the latest.
    fn is_target_before_es2017(&self) -> bool {
        let target = self.p.files.options.target;
        target != ScriptTarget::None && target < ScriptTarget::ES2017
    }

    /// `reparseTopLevelAwait`: the statements of a module in which `await` was taken for a name are parsed again with `await` for a
    /// keyword, and are in an await context from then on. Where that makes a statement longer than it was, the parser goes on that
    /// way until it has been through the next such statements, or to the end of the file if there are none.
    fn statements_parsed_again_for_await(&self, file: FileId, index: &ExprsByKind) -> Vec<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The statements in which `await` was taken for a name, and whether the statement was over right after the name.
        let mut noted: Vec<(StmtId, bool)> = Vec::new();
        if let Some(name) = self.files().atoms.lookup(b"await") {
            for &e in index.of(ExprTag::Ident) {
                // `parsePropertyName` puts it back, and `{ await }` is no more than the name of a property to the parser.
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
        let mut goes_on = false;
        let mut statements = hir.ids(hir.body).peekable();
        while let Some(s) = statements.next() {
            let is_one = is_noted(s);
            if is_one || goes_on {
                again.push(s);
            }
            if is_one {
                if noted.iter().any(|n| n.0 == s && n.1) {
                    goes_on = true;
                } else if !statements.peek().is_some_and(|&next| is_noted(next)) {
                    goes_on = false;
                }
            }
        }
        again.sort_unstable();
        again
    }

    /// The statement of the file whose `statementHasAwaitIdentifier` a name `await` at `e` sets. `None`: it is put back on the way
    /// out, or `await` is a keyword there to begin with.
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

    /// 1356 at the function `node` is written in: `getContainingFunctionOrClassStaticBlock`, `GetContainingFunction`. Nothing for a
    /// constructor. `is_loop`: a `for await` does not ask whether the function says `async`.
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

    /// From `checkVariableLikeDeclaration`, with `areDeclarationFlagsIdentical`: 2687. The declarations of a property, wherever
    /// they are, agree on whether it can be left out and on `private`, `protected`, `readonly`, `abstract` and `static`.
    pub(super) fn check_modifiers_of_merged_declarations(&mut self, file: FileId) {
        let said_before = self.reported.len();
        self.check_modifiers_of_each_merged_declaration(file);
        // `DeclarationNameToString`: the name as it is written, which may be a string or in brackets.
        for i in said_before..self.reported.len() {
            let start = self.reported[i].start;
            let end = self.end_of_name_at(file, start);
            let name = self.stringify_args(&[Arg::Bytes(
                &self.hir(file).text[start as usize..end as usize],
            )]);
            (self.reported[i].end, self.reported[i].args) = (end, name);
        }
    }

    fn check_modifiers_of_each_merged_declaration(&mut self, file: FileId) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What is compared, whether it is `IsVariableLike`, and where its name is.
        let describe = |c: &Checker<'_>, (of, declaration): (FileId, Decl)| {
            let hir = c.hir(of);
            match declaration {
                Decl::Member(m) => Some((
                    compared_modifiers(hir[m].flags),
                    hir[m].kind == MemberKind::Property,
                    hir[m].name_pos,
                )),
                Decl::ParameterProperty(p) => {
                    Some((compared_modifiers(hir[p].flags), true, hir[hir[p].pat].pos))
                }
                _ => None,
            }
        };
        let properties = (0..hir.members.len() as u32)
            .map(MemberId)
            .filter(|&m| {
                hir[m].kind == MemberKind::Property
                    && bound.member_owner[m.idx()] != MemberOwner::None
            })
            .map(Decl::Member);
        let parameter_properties = (0..hir.params.len() as u32)
            .map(ParamId)
            .filter(|&p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY))
            .map(Decl::ParameterProperty);
        for declaration in properties.chain(parameter_properties) {
            let declarations = self.declarations_of_member(file, declaration);
            if declarations.len() < 2 {
                continue;
            }
            let mut described = declarations
                .iter()
                .filter_map(|&other| Some((other, describe(self, other)?)));
            let (Some((value_declaration, (modifiers, ..))), Some((own, _, start))) =
                (described.next(), describe(self, (file, declaration)))
            else {
                continue;
            };
            let differs = if value_declaration == (file, declaration) {
                described.any(|(_, other)| other.1 && other.0 != own)
            } else {
                own != modifiers
            };
            if differs {
                self.error_at((file, start, 0), 2687, &[]);
            }
        }
        // A parameter and a `var` of the same name may differ. What a pattern in a `var` binds is not let off.
        for symbol in &bound.symbols {
            if symbol.decls.len() < 2 {
                continue;
            }
            let [Decl::Param(first), rest @ ..] = symbol.decls.as_slice() else {
                continue;
            };
            let PatParent::Param(p) = bound.pat_parent[first.idx()] else {
                continue;
            };
            if rest.is_empty() || compared_modifiers(hir[p].flags).is_empty() {
                continue;
            }
            let mut differs = false;
            for &decl in rest {
                let Decl::Var(pat) = decl else { continue };
                let mut root = pat;
                let of_var = loop {
                    match bound.pat_parent[root.idx()] {
                        PatParent::Prop(outer, _) | PatParent::Elem(outer, _) => root = outer,
                        PatParent::Var(d) => break hir[d].kind == VarKind::Var,
                        _ => break false,
                    }
                };
                if of_var && root != pat {
                    differs = true;
                    self.error_at((file, hir[pat].pos, 0), 2687, &[]);
                }
            }
            // A parameter property is looked at as the property it is.
            let f = bound.param_fn[p.idx()];
            let is_property = hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                && f.is_some()
                && hir[f].kind == FnKind::Constructor;
            if differs && !is_property {
                self.error_at((file, hir[*first].pos, 0), 2687, &[]);
            }
        }
    }

    // ───────────────────────────── what is not looked at ─────────────────────────────

    /// `GetContainingFunction`
    pub(super) fn get_containing_function(&self, file: FileId, e: ExprId) -> Option<FnId> {
        let hir = self.hir(file);
        hir.function_of(hir.get_containing_function(hir.node(e)))
            .some()
    }
}
