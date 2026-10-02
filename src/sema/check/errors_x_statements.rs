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
//! This pass runs last. TypeScript never checks the body of a `with` statement, the expression of a misplaced `return`, the
//! expression of a `for`-`of` whose declaration list is empty, or the operand of a `yield` outside a generator, so this pass
//! removes the errors the other passes reported there.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, MemberDeclaration, MemberOwner, Parent, PatParent};
use crate::resolve::{ModuleKind, ScriptTarget};

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

/// Where the list of declarations of the variable statement at `at` starts: past `export` and `declare`.
fn start_of_declaration_list(text: &[u8], at: u32) -> u32 {
    let words: [&[u8]; 2] = [b"export", b"declare"];
    let mut at = at as usize;
    while let Some(word) = words.iter().find(|word| is_word_at(text, at, word)) {
        at = skip_trivia(text, at + word.len());
    }
    at as u32
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

/// `checkReferenceExpression`: what is wrong with assigning to `e`, `[that it is no reference, that it is an optional chain]`.
fn why_no_reference(hir: &File, mut e: ExprId, codes: [u32; 2]) -> Option<u32> {
    loop {
        e = match hir[e].kind {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr) => expr,
            // `createMissingIdentifier`: what is not there is a name without letters.
            ExprKind::Ident(_) | ExprKind::Missing => return None,
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => {
                return (chain != Chain::No).then_some(codes[1]);
            }
            _ => return Some(codes[0]),
        };
    }
}

/// A `with` statement is kept as a block of its object and its body, put where the keyword is.
pub(super) fn is_with_statement(hir: &File, s: StmtId) -> bool {
    matches!(hir[s].kind, StmtKind::Block(list) if list.len() == 2)
        && is_word_at(&hir.text, hir[s].pos as usize, b"with")
}

/// The first statement that is not a declaration in a block of an ambient context, and the same for the blocks in it.
fn refused_in_ambient_block(hir: &File, list: IdList<StmtId>, refused: &mut Vec<StmtId>) {
    let mut is_said = false;
    for s in hir.ids(list) {
        let is_asked_about = matches!(
            hir[s].kind,
            StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expr(_)
                | StmtKind::Return(_)
                | StmtKind::If { .. }
                | StmtKind::For { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. }
                | StmtKind::While { .. }
                | StmtKind::DoWhile { .. }
                | StmtKind::Block(_)
                | StmtKind::Switch { .. }
                | StmtKind::Try { .. }
                | StmtKind::Throw(_)
                | StmtKind::Break(_)
                | StmtKind::Continue(_)
                | StmtKind::Labeled { .. }
        );
        // An import or an export whose specifier is not a string is kept as an empty statement.
        let is_asked_about = is_asked_about
            && !(matches!(hir[s].kind, StmtKind::Empty)
                && (is_word_at(&hir.text, hir[s].pos as usize, b"import")
                    || is_word_at(&hir.text, hir[s].pos as usize, b"export")));
        if is_asked_about && !std::mem::replace(&mut is_said, true) {
            refused.push(s);
        }
        refused_in_ambient_statement(hir, s, refused);
    }
}

/// What is part of another statement is not complained about itself; what is in a block in there is.
fn refused_in_ambient_statement(hir: &File, s: StmtId, refused: &mut Vec<StmtId>) {
    if s.is_none() || is_with_statement(hir, s) {
        return;
    }
    match hir[s].kind {
        StmtKind::Block(list) => refused_in_ambient_block(hir, list, refused),
        StmtKind::If { yes, no, .. } => {
            refused_in_ambient_statement(hir, yes, refused);
            refused_in_ambient_statement(hir, no, refused);
        }
        StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }
        | StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. }
        | StmtKind::Labeled { body, .. } => refused_in_ambient_statement(hir, body, refused),
        StmtKind::Switch { cases, .. } => {
            for case in cases.iter() {
                for inner in hir.ids(hir[case].body) {
                    refused_in_ambient_statement(hir, inner, refused);
                }
            }
        }
        StmtKind::Try {
            block,
            handler,
            finalizer,
            ..
        } => {
            refused_in_ambient_statement(hir, block, refused);
            refused_in_ambient_statement(hir, handler, refused);
            refused_in_ambient_statement(hir, finalizer, refused);
        }
        _ => {}
    }
}

/// Removes 1091 1188, 1189 1190 and 2404 2483 from `left`, the declaration list of a `for`-`in` or `for`-`of`.
/// `checkGrammarForInOrForOfStatement` reports them last, so it reports none of them once it has returned.
fn remove_loop_declaration_errors(hir: &File, left: StmtId, out: &mut Vec<Diagnostic>) {
    let StmtKind::Var(decls) = hir[left].kind else {
        return;
    };
    // They are reported at the name of the first or the second declaration.
    for decl in decls.iter().take(2) {
        let start = hir[hir[decl].pat].pos;
        out.retain(|d| {
            d.start != start || !matches!(d.code, 1091 | 1188 | 1189 | 1190 | 2404 | 2483)
        });
    }
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

/// What is said of a name that nothing declares. What it stands for is `errorType` then.
fn is_name_not_found(code: u32) -> bool {
    matches!(code, 2304 | 2552 | 2580..=2585 | 2591..=2593 | 2662 | 2663 | 2693)
}

// ───────────────────────────── where `await` can be ─────────────────────────────

/// Where something is written, as `checkGrammarAwaitOrAwaitUsing` tells places apart.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AwaitPlace {
    /// `NodeFlagsAwaitContext`
    Allowed,
    /// The function-like thing it is in is a class static block.
    StaticBlock,
    /// `IsInTopLevelContext`, and in no await context so far: in this statement of the file.
    TopLevel(StmtId),
    /// In a function that is not `async`, the initializer of a property, an enum or a namespace.
    Elsewhere,
    /// It is not kept track of.
    Unknown,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Objection {
    None,
    /// The file is a CommonJS module.
    CommonJs,
    /// `module` and `target` do not have it.
    Options,
}

/// What there is to say of `await` at the top level of a file.
struct TopLevelAwait<'a> {
    /// `IsEffectiveExternalModule`
    is_module: bool,
    objection: Objection,
    /// The statements of the file that end up in an await context all the same. Sorted. Found out when first asked for.
    parsed_again: std::cell::OnceCell<Vec<StmtId>>,
    index: &'a ExprsByKind,
}

impl TopLevelAwait<'_> {
    fn object(
        &self,
        start: u32,
        is_no_module: u32,
        options_do_not_have_it: u32,
        out: &mut Vec<Diagnostic>,
    ) {
        if !self.is_module {
            out.push(Diagnostic {
                start,
                code: is_no_module,
            });
        }
        match self.objection {
            Objection::None => {}
            Objection::CommonJs => out.push(Diagnostic { start, code: 1309 }),
            Objection::Options => out.push(Diagnostic {
                start,
                code: options_do_not_have_it,
            }),
        }
    }

    /// Whether `object` reports anything.
    fn is_error(&self) -> bool {
        !self.is_module || self.objection != Objection::None
    }
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

impl Checker<'_> {
    /// To be called after all the other passes: see the top of the file.
    pub(super) fn check_x_statements(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Json || hir.has_errors {
            return;
        }
        // `hasParseDiagnostics`: what is only a matter of grammar is not said of a file that does not parse.
        // The parser's own 18016 sets the flag. Any other is `checkGrammarObjectLiteralExpression`'s.
        let is_refused_by_the_parser = hir.has_parse_diagnostics
            || hir
                .early_errors
                .iter()
                .any(|e| e.1 != 18016 && is_said_by_the_parser(e.1));
        let parses = hir.syntax_errors == 0 && !is_refused_by_the_parser;
        if is_refused_by_the_parser {
            // These are noted while parsing, but they are the checker's to say.
            out.retain(|d| !matches!(d.code, 1103 | 1308 | 1545 | 18041));
        }
        let refused = if parses {
            self.refuse_statements_in_ambient_contexts(file, out)
        } else {
            Vec::new()
        };
        let index = self.exprs_by_kind(file);
        let has_using = hir
            .var_decls
            .iter()
            .any(|d| matches!(d.kind, VarKind::Using | VarKind::AwaitUsing));
        let rules = self.rules_for_top_level_await(file, &index);
        let misplaced_returns =
            self.check_statements_one_by_one(file, parses, has_using, &refused, &rules, out);
        self.check_await_expressions_are_in_place(file, parses, &index, &rules, out);
        self.check_yield_in_parameter_initializers(file, &index, out);
        if has_using {
            self.check_initializers_of_using_declarations(file, out);
        }
        let said_before = out.len();
        self.check_modifiers_of_merged_declarations(file, out);
        // `DeclarationNameToString`: the name as it is written, which may be a string or in brackets.
        for d in &out[said_before..] {
            let (start, end) = (d.start, self.end_of_name_at(file, d.start));
            self.note(start, end, 2687, vec![self.source_text(file, start, end)]);
        }
        if parses {
            self.check_catch_clause_variables(file, out);
        }
        self.take_back_what_is_never_checked(file, &index, &refused, &misplaced_returns, out);
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `checkGrammarStatementInAmbientContext`: 1036, once in each block. Gives the statements it is said of, of which no other
    /// matter of grammar is brought up.
    fn refuse_statements_in_ambient_contexts(
        &self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) -> Vec<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut refused = Vec::new();
        // `NodeFlagsAmbient` is on every node of a declaration file.
        let is_declaration_file = hir.kind == FileKind::Declaration;
        if is_declaration_file {
            refused_in_ambient_block(hir, hir.body, &mut refused);
        }
        for (i, module) in hir.modules.iter().enumerate() {
            if (is_declaration_file || module.flags.contains(Flags::AMBIENT))
                && bound.module_symbol[i].is_some()
            {
                refused_in_ambient_block(hir, module.body, &mut refused);
            }
        }
        for &s in &refused {
            let start = hir[s].pos;
            out.retain(|d| {
                d.start != start
                    || !matches!(
                        d.code,
                        1104 | 1105 | 1107 | 1108 | 1114 | 1115 | 1116 | 18041
                    )
            });
            out.push(Diagnostic { start, code: 1036 });
        }
        refused
    }

    /// Gives the `return` statements that are in no function, or in a static block.
    fn check_statements_one_by_one(
        &mut self,
        file: FileId,
        parses: bool,
        has_using: bool,
        refused: &[StmtId],
        rules: &TopLevelAwait<'_>,
        out: &mut Vec<Diagnostic>,
    ) -> Vec<StmtId> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text: &[u8] = &hir.text;
        let mut misplaced_returns = Vec::new();
        for i in 0..hir.stmts.len() {
            let Stmt { kind, pos, .. } = hir.stmts[i];
            let is_looked_at = match kind {
                StmtKind::Block(_)
                | StmtKind::Return(_)
                | StmtKind::If { .. }
                | StmtKind::ForIn { .. }
                | StmtKind::ForOf { .. } => true,
                StmtKind::Var(_) => has_using,
                _ => false,
            };
            if !is_looked_at || matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            let s = StmtId(i as u32);
            match kind {
                StmtKind::Block(_) if is_with_statement(hir, s) => {
                    // `checkStrictModeWithStatement`
                    out.push(Diagnostic {
                        start: pos,
                        code: 1101,
                    });
                    // `checkWithStatement`
                    if parses {
                        let place = self.place_of_await_in(file, Parent::Stmt(s), rules);
                        if !refused.contains(&s)
                            && matches!(place, AwaitPlace::Allowed | AwaitPlace::StaticBlock)
                        {
                            out.push(Diagnostic {
                                start: pos,
                                code: 1300,
                            });
                        }
                        out.push(Diagnostic {
                            start: pos,
                            code: 2410,
                        });
                        // Up to where the statement starts, which is right after the `)`.
                        let open = skip_trivia(text, pos as usize + b"with".len());
                        if text.get(open) == Some(&b'(')
                            && let Some(end) = end_of_brackets(text, open)
                        {
                            self.note(pos, end as u32, 2410, Vec::new());
                        }
                    }
                }
                // `checkReturnStatement`
                StmtKind::Return(_) => {
                    let is_in_static_block = match self.enclosing_fn(file, Parent::Stmt(s)) {
                        Some(f) if hir[f].kind == FnKind::StaticBlock => true,
                        Some(_) => continue,
                        None => false,
                    };
                    misplaced_returns.push(s);
                    if !parses || refused.contains(&s) {
                        continue;
                    }
                    if is_in_static_block {
                        out.push(Diagnostic {
                            start: pos,
                            code: 18041,
                        });
                    } else {
                        out.retain(|d| d.start != pos || d.code != 18041);
                        out.push(Diagnostic {
                            start: pos,
                            code: 1108,
                        });
                    }
                }
                // `checkIfStatement`. Other statements of which nothing is kept are empty as well: it has to be written that way.
                StmtKind::If { yes, .. } if matches!(hir[yes].kind, StmtKind::Empty) => {
                    let written = hir[yes].pos;
                    let start = if written > pos && text.get(written as usize) == Some(&b';') {
                        Some(written)
                    } else {
                        empty_then_statement(text, pos)
                    };
                    if let Some(start) = start {
                        out.push(Diagnostic { start, code: 1313 });
                    }
                }
                StmtKind::ForIn { left, expr, .. } => {
                    // `checkForInStatement`: a literal is a pattern, unless it is in parentheses.
                    if let StmtKind::Expr(target) = hir[left].kind
                        && (!matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_))
                            || is_parenthesized(hir, target))
                    {
                        self.check_target_of_for_in(file, target, expr, out);
                    }
                    // `checkGrammarForInOrForOfStatement` returns after 1036.
                    if refused.contains(&s) {
                        remove_loop_declaration_errors(hir, left, out);
                    }
                }
                StmtKind::ForOf { left, .. } => {
                    // `checkForOfStatement`: the same.
                    if let StmtKind::Expr(target) = hir[left].kind
                        && (!matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_))
                            || is_parenthesized(hir, target))
                        && let Some(code) = why_no_reference(hir, target, [2487, 2781])
                    {
                        let start = self.error_start_of(file, target);
                        out.push(Diagnostic { start, code });
                        self.note(start, self.error_end_of(file, target), code, Vec::new());
                    }
                    // `checkGrammarForInOrForOfStatement`, and the static block from `checkForOfStatement`.
                    let is_refused = refused.contains(&s);
                    let mut is_await_misplaced = false;
                    if parses && let Some(start) = await_after_for(text, pos) {
                        match self.place_of_await_in(file, Parent::Stmt(s), rules) {
                            AwaitPlace::StaticBlock => {
                                out.retain(|d| d.start != start || d.code != 1103);
                                out.push(Diagnostic { start, code: 18038 });
                            }
                            AwaitPlace::TopLevel(_) if !is_refused => {
                                // The parser's, from the parse of a script in which `await` is a name.
                                out.retain(|d| d.start != start || d.code != 1103);
                                rules.object(start, 1431, 1432, out);
                            }
                            AwaitPlace::Elsewhere if !is_refused => {
                                out.push(Diagnostic { start, code: 1103 });
                                self.relate(start, 1103, |c| {
                                    c.function_to_mark_async(file, Parent::Stmt(s), true)
                                });
                                is_await_misplaced = true;
                            }
                            _ => {}
                        }
                    }
                    if is_refused || is_await_misplaced {
                        // The function returns after 1036 and after 1103, before it reaches the left side.
                        remove_loop_declaration_errors(hir, left, out);
                    } else if parses
                        && let StmtKind::Expr(target) = hir[left].kind
                        && let ExprKind::Ident(name) = hir[target].kind
                        && Some(name) == self.files().atoms.lookup(b"async")
                        && !is_parenthesized(self.hir(file), target)
                        && matches!(
                            self.place_of_await_in(file, Parent::Stmt(s), rules),
                            AwaitPlace::TopLevel(_) | AwaitPlace::Elsewhere
                        )
                    {
                        // Outside an await context the left side cannot be the identifier `async`.
                        out.push(Diagnostic {
                            start: hir[target].pos,
                            code: 1106,
                        });
                    }
                }
                StmtKind::Var(decls) => self
                    .check_declaration_list_of_using(file, s, decls, parses, refused, rules, out),
                _ => {}
            }
        }
        misplaced_returns
    }

    /// `checkForInStatement`, of a left-hand side that is not a reference. It is an error for certain: 2405 if a key does not fit
    /// in it, which is asked first, or else 2406 2780. Which of them is only said where it can be told.
    fn check_target_of_for_in(
        &mut self,
        file: FileId,
        target: ExprId,
        object: ExprId,
        out: &mut Vec<Diagnostic>,
    ) {
        let Some(code) = why_no_reference(self.hir(file), target, [2406, 2780]) else {
            return;
        };
        let (written, start) = (
            self.start_of(file, target),
            self.error_start_of(file, target),
        );
        // One of the two is reported.
        let end = self.error_end_of(file, target);
        self.note(start, end, code, Vec::new());
        self.note(start, end, 2405, Vec::new());
        // It may have been said already, of where the expression starts.
        if let Some(said) = out
            .iter_mut()
            .find(|d| d.start == written && d.code == 2405)
        {
            said.start = start;
            return;
        }
        let wanted = self.type_of_expr(file, target);
        if !self.is_known(wanted) || self.is_uncertain(file, target) {
            // What is unknown here is `any` to TypeScript where it could not find a name either, and anything fits in that.
            let end = self.start_of(file, object);
            if out
                .iter()
                .any(|d| (written..end).contains(&d.start) && is_name_not_found(d.code))
            {
                out.push(Diagnostic { start, code });
            }
            return;
        }
        // `getIndexTypeOrString`. All that is known of the keys of what is not known is that they are strings of some kind.
        let given = self.type_of_expr(file, object);
        let mut is_sure = self.is_known(given) && !self.is_uncertain(file, object);
        let mut keys = TypeId::STRING;
        if is_sure {
            let given = self.non_nullable(given);
            let all = self.keyof(given);
            let strings = self.filter(all, |c, m| c.is_string_like(m) || c.is_deferred(m));
            if !self.is_known(strings) {
                is_sure = false;
            } else if !strings.is_never() {
                keys = strings;
            }
        }
        if self.is_assignable(keys, wanted) {
            out.push(Diagnostic { start, code });
        } else if is_sure {
            out.push(Diagnostic { start, code: 2405 });
        }
    }

    /// `checkGrammarVariableDeclarationList`, of `using` and `await using`, and what comes before it in `checkVariableStatement`.
    fn check_declaration_list_of_using(
        &mut self,
        file: FileId,
        s: StmtId,
        decls: Span<VarDeclId>,
        parses: bool,
        refused: &[StmtId],
        rules: &TopLevelAwait<'_>,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let Some(first) = decls.iter().next() else {
            return;
        };
        let is_await = match hir[first].kind {
            VarKind::Using => false,
            VarKind::AwaitUsing => true,
            _ => return,
        };
        let start = start_of_declaration_list(&hir.text, hir[s].pos);
        // `!c.checkGrammarModifiers(node) && !c.checkGrammarVariableDeclarationList(..)`
        if parses && self.grammar_error_in_modifiers(file, s).is_some() {
            out.retain(|d| d.start != start || !matches!(d.code, 1545 | 1546));
            return;
        }
        let around = match bound.stmt_parent[s.idx()] {
            Parent::Stmt(p) if p.is_some() => Some(p),
            _ => None,
        };
        // `checkForStatement`, `checkGrammarForInOrForOfStatement`: no more is asked of a loop that is refused itself.
        if let Some(p) = around
            && refused.contains(&p)
            && matches!(hir[p].kind, StmtKind::For { init: head, .. } | StmtKind::ForIn { left: head, .. } | StmtKind::ForOf { left: head, .. } if head == s)
        {
            return;
        }
        let codes = match around.map(|p| hir[p].kind) {
            Some(StmtKind::ForIn { left, .. }) if left == s => Some([1493, 1494]),
            _ if hir[first].flags.contains(Flags::AMBIENT) => Some([1545, 1546]),
            // The statements of a clause have the `switch` for a parent.
            Some(StmtKind::Switch { .. }) => Some([1547, 1548]),
            _ => None,
        };
        // `checkGrammarForInOrForOfStatement` reports nothing more on a list that `checkGrammarVariableDeclarationList` rejects.
        let is_loop_head = around.is_some_and(|p| matches!(hir[p].kind, StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == s));
        if let Some(codes) = codes {
            if parses {
                // The parser has one word for both kinds.
                out.retain(|d| d.start != start || d.code != 1545);
                let code = codes[usize::from(is_await)];
                out.push(Diagnostic { start, code });
                self.note(
                    start,
                    self.end_of_var_decl_list(file, decls),
                    code,
                    Vec::new(),
                );
                if is_loop_head {
                    remove_loop_declaration_errors(hir, s, out);
                }
            }
            return;
        }
        if !is_await {
            return;
        }
        // A `for await` that is out of place itself is told that, and no more.
        if parses
            && let Some(p) = around
            && matches!(hir[p].kind, StmtKind::ForOf { left, .. } if left == s)
            && await_after_for(&hir.text, hir[p].pos).is_some()
            && self.place_of_await_in(file, Parent::Stmt(p), rules) == AwaitPlace::Elsewhere
        {
            return;
        }
        // In a static block it is said whether or not the file parses.
        let has_error = match self.place_of_await_in(file, Parent::Stmt(s), rules) {
            AwaitPlace::StaticBlock => {
                out.push(Diagnostic { start, code: 18054 });
                self.note(
                    start,
                    self.end_of_var_decl_list(file, decls),
                    18054,
                    Vec::new(),
                );
                true
            }
            AwaitPlace::TopLevel(_) if parses => {
                rules.object(start, 2853, 2854, out);
                rules.is_error()
            }
            AwaitPlace::Elsewhere if parses => {
                out.push(Diagnostic { start, code: 2852 });
                // `checkAwaitGrammar`
                if let Some(function) = self.enclosing_fn(file, Parent::Stmt(s))
                    && hir[function].kind != FnKind::Constructor
                    && !hir[function].flags.contains(Flags::ASYNC)
                {
                    self.relate(start, 2852, |c| {
                        let (from, to) = c.error_range_of_fn(file, function);
                        vec![super::explain::Related {
                            at: Some((file, from, to)),
                            code: 1356,
                            args: Vec::new(),
                        }]
                    });
                }
                true
            }
            _ => false,
        };
        if has_error && is_loop_head {
            remove_loop_declaration_errors(hir, s, out);
        }
    }

    /// `checkCatchClause`: 1196, what is caught can be anything; 2492, the block cannot declare the name again.
    fn check_catch_clause_variables(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.stmts.len() {
            let StmtKind::Try { param, handler, .. } = hir.stmts[i].kind else {
                continue;
            };
            if param.is_none() || matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            let caught = &hir[param];
            if caught.ty.is_some() {
                let ty = self.type_from_node(file, caught.ty);
                let ty = self.force(ty);
                if self.is_known(ty) && !self.has_any_flag(ty) && ty != TypeId::UNKNOWN {
                    out.push(Diagnostic {
                        start: hir[caught.ty].pos,
                        code: 1196,
                    });
                }
                continue;
            }
            let StmtKind::Block(list) = hir[handler].kind else {
                continue;
            };
            let (mut names, mut declared) = (Vec::new(), Vec::new());
            names_bound_by(hir, caught.pat, &mut names);
            for s in hir.ids(list) {
                let StmtKind::Var(decls) = hir[s].kind else {
                    continue;
                };
                for d in decls.iter().filter(|&d| hir[d].kind != VarKind::Var) {
                    names_bound_by(hir, hir[d].pat, &mut declared);
                }
            }
            for &(name, pat) in &declared {
                let symbol = bound.pat_symbol[pat.idx()];
                if symbol.is_none() || !names.iter().any(|n| n.0 == name) {
                    continue;
                }
                // It has to be the `ValueDeclaration` of what the block knows by the name.
                let first = bound.symbols[symbol.idx()]
                    .decls
                    .iter()
                    .find(|d| !matches!(d, Decl::Interface(_) | Decl::Alias(_)));
                if first == Some(&Decl::Var(pat)) {
                    out.push(Diagnostic {
                        start: hir[pat].pos,
                        code: 2492,
                    });
                    self.note(hir[pat].pos, 0, 2492, vec![self.atom_text(name)]);
                }
            }
        }
    }

    // ───────────────────────────── `await` ─────────────────────────────

    /// `languageVersion < ES2017`. `GetEmitScriptTarget`: no target is the latest.
    fn is_target_before_es2017(&self) -> bool {
        let target = self.p.files.options.target;
        target != ScriptTarget::None && target < ScriptTarget::ES2017
    }

    /// The `switch` on `moduleKind` in `checkGrammarAwaitOrAwaitUsing` and `checkGrammarForInOrForOfStatement`.
    fn rules_for_top_level_await<'a>(
        &self,
        file: FileId,
        index: &'a ExprsByKind,
    ) -> TopLevelAwait<'a> {
        let kind = self.p.files.options.module;
        let module = self.files().module(file);
        // `GetEmitModuleDetectionKind`: from `node16` on every file is a module. That `moduleDetection` says otherwise is not kept.
        let is_module = module.is_module() || kind.is_node();
        // `GetImpliedNodeFormatForFile`: the extension decides however modules are resolved.
        let is_esm = module.says_esm || module.path.ends_with(".mts");
        let has_it = kind.is_node()
            || matches!(
                kind,
                ModuleKind::Es2022 | ModuleKind::EsNext | ModuleKind::Preserve | ModuleKind::System
            );
        let objection = if kind.is_node() && !is_esm {
            Objection::CommonJs
        } else if has_it && !self.is_target_before_es2017() {
            Objection::None
        } else {
            Objection::Options
        };
        TopLevelAwait {
            is_module,
            objection,
            parsed_again: std::cell::OnceCell::new(),
            index,
        }
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
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = bound.expr_parent[e.idx()];
        let mut statement = StmtId::NONE;
        loop {
            match at {
                Parent::File => return statement.some(),
                Parent::FnBody(f)
                    if hir[f].flags.contains(Flags::ASYNC)
                        || matches!(hir[f].body, FnBody::Block(_)) =>
                {
                    return None;
                }
                Parent::ParamDefault(p)
                    if hir[bound.param_fn[p.idx()]].flags.contains(Flags::ASYNC) =>
                {
                    return None;
                }
                Parent::None
                | Parent::Module(_)
                | Parent::EnumInit(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_)
                | Parent::PropKey(..)
                | Parent::PatKey(_) => return None,
                Parent::Expr(x) if x.is_none() => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Stmt(s) => {
                    let is_put_back = match hir[s].kind {
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_) => true,
                        StmtKind::Class(c) => hir[c].flags.contains(Flags::AMBIENT),
                        _ => false,
                    };
                    if is_put_back {
                        return None;
                    }
                    statement = s;
                }
                _ => {}
            }
            at = self.outward(file, at);
        }
    }

    fn place_of_await_in(
        &self,
        file: FileId,
        from: Parent,
        rules: &TopLevelAwait<'_>,
    ) -> AwaitPlace {
        let place = self.place_of_await(file, from);
        let AwaitPlace::TopLevel(s) = place else {
            return place;
        };
        let parsed_again = rules.parsed_again.get_or_init(|| {
            // `parseSourceFileWorker`: a declaration file is not parsed again.
            if rules.is_module && self.hir(file).kind != FileKind::Declaration {
                self.statements_parsed_again_for_await(file, rules.index)
            } else {
                Vec::new()
            }
        });
        if parsed_again.binary_search(&s).is_ok() {
            AwaitPlace::Allowed
        } else {
            place
        }
    }

    /// Where the expression or statement `from` stands for is written: what the parser has for `NodeFlagsAwaitContext` there,
    /// `getContainingFunctionOrClassStaticBlock` and `IsInTopLevelContext`.
    fn place_of_await(&self, file: FileId, from: Parent) -> AwaitPlace {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_exported = |c: ClassId| hir[c].flags.contains(Flags::EXPORT);
        let of_function = |f: FnId| {
            if f.is_some() && hir[f].flags.contains(Flags::ASYNC) {
                AwaitPlace::Allowed
            } else {
                AwaitPlace::Elsewhere
            }
        };
        let mut at = from;
        // The statement and the expression that were gone through last.
        let (mut statement, mut expression) = (StmtId::NONE, ExprId::NONE);
        // What it comes to unless a static block is what it is in.
        let mut settled: Option<AwaitPlace> = None;
        loop {
            match at {
                Parent::FnBody(f) if hir[f].kind == FnKind::StaticBlock => {
                    return AwaitPlace::StaticBlock;
                }
                Parent::FnBody(f) => return settled.unwrap_or(of_function(f)),
                Parent::ParamDefault(p) => {
                    return settled.unwrap_or(of_function(bound.param_fn[p.idx()]));
                }
                Parent::EnumInit(_) | Parent::Module(_) => {
                    return settled.unwrap_or(AwaitPlace::Elsewhere);
                }
                Parent::File => return settled.unwrap_or(AwaitPlace::TopLevel(statement)),
                Parent::None => return AwaitPlace::Unknown,
                // The initializer of a property is parsed as if nothing were around it.
                Parent::MemberInit(_) => settled = settled.or(Some(AwaitPlace::Elsewhere)),
                // What follows `export default` and `export =` is parsed in an await context, and so is what follows the name of an
                // exported class.
                Parent::ClassExtends(c) if is_exported(c) => {
                    settled = settled.or(Some(AwaitPlace::Allowed))
                }
                Parent::Decorator(c, DecoratorOwner::Member(_) | DecoratorOwner::Param(_))
                    if is_exported(c) =>
                {
                    settled = settled.or(Some(AwaitPlace::Allowed));
                }
                Parent::Stmt(s) if s.is_none() => return AwaitPlace::Unknown,
                Parent::Stmt(s) => {
                    if matches!(
                        hir[s].kind,
                        StmtKind::ExportDefault(_) | StmtKind::ExportAssign(_)
                    ) {
                        settled = settled.or(Some(AwaitPlace::Allowed));
                    }
                    statement = s;
                }
                Parent::Expr(e) if e.is_none() => return AwaitPlace::Unknown,
                Parent::Expr(e) => expression = e,
                Parent::PatKey(_) => return AwaitPlace::Unknown,
                Parent::PropKey(object, _) => {
                    at = Parent::Expr(object);
                    continue;
                }
                // A computed name is where the class or the object literal is.
                Parent::MemberKey(_) | Parent::MethodKey(_) => {
                    let key = PropKey::Computed(expression);
                    if let Some(m) = hir.members.iter().position(|m| m.key == key) {
                        let MemberOwner::Class(c) = bound.member_owner[m] else {
                            return AwaitPlace::Unknown;
                        };
                        at = Parent::ClassExtends(c);
                    } else if let Some(p) = hir.props.iter().position(|p| p.key == key) {
                        at = Parent::Prop(PropId(p as u32));
                    } else {
                        return AwaitPlace::Unknown;
                    }
                    continue;
                }
                _ => {}
            }
            at = self.outward(file, at);
        }
    }

    /// 1356 at the function that what `from` stands for is written in: `getContainingFunctionOrClassStaticBlock`,
    /// `GetContainingFunction`. Nothing for a constructor. `is_loop`: a `for await` does not ask whether the function says `async`.
    fn function_to_mark_async(
        &self,
        file: FileId,
        from: Parent,
        is_loop: bool,
    ) -> Vec<super::explain::Related> {
        use crate::bind::FnOwner;
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut at = from;
        let func = loop {
            at = match at {
                Parent::FnBody(f) => break f,
                Parent::ParamDefault(p) => break bound.param_fn[p.idx()],
                Parent::PropKey(object, _) if object.is_some() => Parent::Expr(object),
                // The name and the decorators of a method are written in the method, and which one that is is not kept track of.
                Parent::None
                | Parent::File
                | Parent::Module(_)
                | Parent::EnumInit(_)
                | Parent::PropKey(..)
                | Parent::PatKey(_)
                | Parent::MemberKey(_)
                | Parent::MethodKey(_)
                | Parent::Decorator(_, DecoratorOwner::Member(_) | DecoratorOwner::Param(_)) => {
                    return Vec::new();
                }
                Parent::Expr(x) if x.is_none() => return Vec::new(),
                other => self.outward(file, other),
            };
        };
        if func.is_none() {
            return Vec::new();
        }
        let f = &hir[func];
        if matches!(f.kind, FnKind::Constructor | FnKind::StaticBlock)
            || !is_loop && f.flags.contains(Flags::ASYNC)
        {
            return Vec::new();
        }
        // `GetErrorRangeForNode`
        let (start, end) = match bound.fns[func.idx()].owner {
            FnOwner::Stmt(s) => self.error_range_of_stmt(file, s),
            FnOwner::Expr(owner) if matches!(f.kind, FnKind::Expr | FnKind::Arrow) => (
                self.error_start_inside_parentheses(file, owner),
                self.error_end_inside_parentheses(file, owner),
            ),
            _ => self.error_range_of_fn(file, func),
        };
        vec![super::explain::Related {
            at: Some((file, start, end)),
            code: 1356,
            args: Vec::new(),
        }]
    }

    /// `checkGrammarAwaitOrAwaitUsing`, of `await` expressions.
    fn check_await_expressions_are_in_place(
        &mut self,
        file: FileId,
        parses: bool,
        index: &ExprsByKind,
        rules: &TopLevelAwait<'_>,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &e in index.of(ExprTag::Await) {
            let start = hir[e].pos;
            if bound.is_unchecked(e.idx()) || !is_word_at(&hir.text, start as usize, b"await") {
                continue;
            }
            let place = self.place_of_await_in(file, Parent::Expr(e), rules);
            // Where nothing makes a keyword of it, `await (x)` is a call of something by that name.
            if !matches!(place, AwaitPlace::Allowed | AwaitPlace::StaticBlock)
                && after_await(&hir.text, start) != AfterAwait::Operand
            {
                continue;
            }
            // 18037 and 2524 are said whether or not the file parses.
            match place {
                AwaitPlace::StaticBlock => {
                    out.push(Diagnostic { start, code: 18037 });
                    let end = self.end_inside_parentheses(file, e);
                    self.note(start, end, 18037, Vec::new());
                }
                AwaitPlace::TopLevel(_) if parses => rules.object(start, 1375, 1378, out),
                AwaitPlace::Elsewhere if parses => {
                    out.push(Diagnostic { start, code: 1308 });
                    self.relate(start, 1308, |c| {
                        c.function_to_mark_async(file, Parent::Expr(e), false)
                    });
                }
                _ => {}
            }
            if self.xs_is_in_parameter_initializer(file, e) {
                out.push(Diagnostic { start, code: 2524 });
                let end = self.end_inside_parentheses(file, e);
                self.note(start, end, 2524, Vec::new());
            }
        }
    }

    /// `checkGrammarYieldExpression`: 2523, a plain error that parse errors do not silence. 1163 comes from the parser and from
    /// `check_grammar`.
    fn check_yield_in_parameter_initializers(
        &self,
        file: FileId,
        index: &ExprsByKind,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for &e in index.of(ExprTag::Yield) {
            if !bound.is_unchecked(e.idx()) && self.xs_is_in_parameter_initializer(file, e) {
                out.push(Diagnostic {
                    start: hir[e].pos,
                    code: 2523,
                });
            }
        }
    }

    /// `isInParameterInitializerBeforeContainingFunction`
    fn xs_is_in_parameter_initializer(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut at, mut expression) = (bound.expr_parent[e.idx()], e);
        loop {
            at = match at {
                Parent::ParamDefault(_) => return true,
                // A static block is not function-like.
                Parent::FnBody(f) if hir[f].kind != FnKind::StaticBlock => return false,
                Parent::None | Parent::File | Parent::Module(_) | Parent::EnumInit(_) => {
                    return false;
                }
                Parent::Expr(x) if x.is_none() => return false,
                Parent::Stmt(s) if s.is_none() => return false,
                Parent::Expr(x) => {
                    expression = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::PropKey(object, _) => Parent::Expr(object),
                Parent::PatKey(_) => Parent::Expr(ExprId::NONE),
                // A method or an accessor is function-like, a property is not.
                Parent::MemberKey(_) | Parent::MethodKey(_) => match hir
                    .members
                    .iter()
                    .position(|m| m.key == PropKey::Computed(expression))
                {
                    Some(m) if hir.members[m].kind == MemberKind::Property => {
                        Parent::MemberInit(MemberId(m as u32))
                    }
                    _ => return false,
                },
                other => self.outward(file, other),
            };
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// From `checkVariableLikeDeclaration`: 2850 2851, or what says more. What is to be disposed of has to have what it takes.
    /// For a file that has a `using` or an `await using`.
    fn check_initializers_of_using_declarations(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `getGlobalDisposableType`, `getGlobalAsyncDisposableType`: that there is none is said, of no file, and nothing is asked.
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            let stmt = bound.var_stmt[d];
            if decl.init.is_none()
                || stmt.is_none()
                || !matches!(decl.kind, VarKind::Using | VarKind::AwaitUsing)
                || !matches!(hir[decl.pat].kind, PatKind::Ident(_))
                || matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForIn { .. }))
            {
                continue;
            }
            let asked_for: &[&str] = if decl.kind == VarKind::AwaitUsing {
                &["AsyncDisposable", "Disposable"]
            } else {
                &["Disposable"]
            };
            for &name in asked_for {
                let is_there = self
                    .files()
                    .atoms
                    .lookup(name.as_bytes())
                    .is_some_and(|name| self.global_type_symbol(name).is_some());
                if !is_there {
                    self.report_global_error(2318, vec![name.to_owned()]);
                }
            }
        }
        if self.global_type_symbol(known::Disposable).is_none() {
            return;
        }
        let disposable = self.global_ref(known::Disposable, &[]);
        let async_disposable = match self.files().atoms.lookup(b"AsyncDisposable") {
            Some(name) if self.global_type_symbol(name).is_some() => {
                Some(self.global_ref(name, &[]))
            }
            _ => None,
        };
        for d in 0..hir.var_decls.len() {
            let decl = &hir.var_decls[d];
            let stmt = bound.var_stmt[d];
            if decl.init.is_none()
                || stmt.is_none()
                || !matches!(hir[decl.pat].kind, PatKind::Ident(_))
            {
                continue;
            }
            let (head, target) = match (decl.kind, async_disposable) {
                (VarKind::Using, _) => (
                    2850,
                    self.union(&[disposable, TypeId::NULL, TypeId::UNDEFINED]),
                ),
                (VarKind::AwaitUsing, Some(other)) => (
                    2851,
                    self.union(&[other, disposable, TypeId::NULL, TypeId::UNDEFINED]),
                ),
                _ => continue,
            };
            // An initializer in a `for`-`in` is an error already.
            if matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(p) if p.is_some() && matches!(hir[p].kind, StmtKind::ForIn { .. }))
            {
                continue;
            }
            let source = self.type_of_expr(file, decl.init);
            if self.is_uncertain(file, decl.init) {
                continue;
            }
            // `widenTypeForVariableLikeDeclaration`: an object literal may well have more than it takes.
            let source = self.regular_object(source);
            if !self.is_known(source) || self.is_assignable(source, target) {
                continue;
            }
            let at = self.error_start_of(file, decl.init);
            // A function without a name of its own goes by the name of the variable.
            let end = if at == hir[decl.pat].pos {
                0
            } else {
                self.error_end_of(file, decl.init)
            };
            self.report_not_assignable_with_end(source, target, at, end, head, out);
        }
    }

    /// From `checkVariableLikeDeclaration`, with `areDeclarationFlagsIdentical`: 2687. The declarations of a property, wherever
    /// they are, agree on whether it can be left out and on `private`, `protected`, `readonly`, `abstract` and `static`.
    fn check_modifiers_of_merged_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // What is compared, whether it is `IsVariableLike`, and where its name is.
        let describe = |c: &Checker<'_>, (of, declaration): (FileId, MemberDeclaration)| {
            let hir = c.hir(of);
            match declaration {
                MemberDeclaration::Member(m) => Some((
                    compared_modifiers(hir[m].flags),
                    hir[m].kind == MemberKind::Property,
                    hir[m].pos,
                )),
                MemberDeclaration::Parameter(p) => {
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
            .map(MemberDeclaration::Member);
        let parameter_properties = (0..hir.params.len() as u32)
            .map(ParamId)
            .filter(|&p| hir[p].flags.contains(Flags::PARAMETER_PROPERTY))
            .map(MemberDeclaration::Parameter);
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
                out.push(Diagnostic { start, code: 2687 });
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
                    out.push(Diagnostic {
                        start: hir[pat].pos,
                        code: 2687,
                    });
                }
            }
            // A parameter property is looked at as the property it is.
            let f = bound.param_fn[p.idx()];
            let is_property = hir[p].flags.contains(Flags::PARAMETER_PROPERTY)
                && f.is_some()
                && hir[f].kind == FnKind::Constructor;
            if differs && !is_property {
                out.push(Diagnostic {
                    start: hir[*first].pos,
                    code: 2687,
                });
            }
        }
    }

    // ───────────────────────────── what is not looked at ─────────────────────────────

    /// Where what comes after the statement `s` starts: the first thing written after the start of `s` that is not in `s`.
    pub(super) fn start_of_what_follows(&self, file: FileId, s: StmtId) -> u32 {
        self.next_start_outside(file, self.hir(file)[s].pos, Parent::Stmt(s))
    }

    /// The start of the first node after `from` that is not inside `container`, a statement or an expression that starts at `from`.
    fn next_start_outside(&self, file: FileId, from: u32, container: Parent) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut end = hir.text.len() as u32;
        // `None`: it cannot be told.
        let is_within = |mut at: Parent| loop {
            if at == container {
                return Some(true);
            }
            at = match at {
                Parent::File => return Some(false),
                // A namespace may be written in `container` as well.
                Parent::Module(m) => match hir
                    .stmts
                    .iter()
                    .position(|x| matches!(x.kind, StmtKind::Module(id) if id == m))
                {
                    Some(i) => Parent::Stmt(StmtId(i as u32)),
                    None => return None,
                },
                Parent::EnumInit(member) => match self.xs_enum_statement(file, member) {
                    Some(s) => Parent::Stmt(s),
                    None => return None,
                },
                Parent::None | Parent::MemberKey(_) | Parent::MethodKey(_) => return None,
                Parent::Stmt(p) if p.is_none() => return None,
                Parent::Expr(e) if e.is_none() => return None,
                Parent::PropKey(object, _) => Parent::Expr(object),
                Parent::PatKey(_) => Parent::Expr(ExprId::NONE),
                other => self.outward(file, other),
            };
        };
        let mut consider = |pos: u32, at: Parent| {
            if pos > from && pos < end && is_within(at) == Some(false) {
                end = pos;
            }
        };
        for (i, x) in hir.stmts.iter().enumerate() {
            consider(x.pos, bound.stmt_parent[i]);
        }
        for (i, x) in hir.exprs.iter().enumerate() {
            consider(x.pos, bound.expr_parent[i]);
        }
        for (i, x) in hir.cases.iter().enumerate() {
            consider(x.pos, Parent::Stmt(bound.case_stmt[i]));
        }
        // What `catch` binds comes before its block.
        for (i, x) in hir.var_decls.iter().enumerate() {
            consider(hir[x.pat].pos, Parent::Stmt(bound.var_stmt[i]));
        }
        for (i, x) in hir.members.iter().enumerate() {
            consider(x.start, Parent::MemberInit(MemberId(i as u32)));
        }
        for (i, x) in hir.props.iter().enumerate() {
            consider(x.pos, Parent::Prop(PropId(i as u32)));
        }
        for (i, x) in hir.params.iter().enumerate() {
            if bound.param_fn[i].is_some() {
                consider(x.pos, Parent::ParamDefault(ParamId(i as u32)));
            }
        }
        for (i, x) in hir.enum_members.iter().enumerate() {
            consider(x.pos, Parent::EnumInit(EnumMemberId(i as u32)));
        }
        end
    }

    /// The statement that declares the enum `member` belongs to.
    fn xs_enum_statement(&self, file: FileId, member: EnumMemberId) -> Option<StmtId> {
        let owner = self.bound(file).enum_member_owner[member.idx()];
        self.hir(file)
            .stmts
            .iter()
            .position(|s| matches!(s.kind, StmtKind::Enum(e) if e == owner))
            .map(|s| StmtId(s as u32))
    }

    /// `GetContainingFunction`: the nearest function-like node around `e`. Static blocks and properties are not function-like.
    /// `Some(None)`: there is none. `None`: the parent chain is not tracked.
    fn xs_containing_function(&self, file: FileId, e: ExprId) -> Option<Option<FnId>> {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let (mut at, mut below) = (bound.expr_parent[e.idx()], e);
        loop {
            at = match at {
                Parent::FnBody(f) if hir[f].kind != FnKind::StaticBlock => return Some(Some(f)),
                Parent::ParamDefault(p) | Parent::Decorator(_, DecoratorOwner::Param(p)) => {
                    return bound.param_fn[p.idx()].some().map(Some);
                }
                Parent::File | Parent::Module(_) => return Some(None),
                Parent::EnumInit(member) => Parent::Stmt(self.xs_enum_statement(file, member)?),
                Parent::None => return None,
                Parent::Expr(x) if x.is_none() => return None,
                Parent::Stmt(s) if s.is_none() => return None,
                Parent::Expr(x) => {
                    below = x;
                    bound.expr_parent[x.idx()]
                }
                Parent::PropKey(object, _) if object.is_some() => Parent::Expr(object),
                // A computed name in a binding pattern.
                Parent::PropKey(..) | Parent::PatKey(_) => match hir
                    .pat_props
                    .iter()
                    .position(|p| p.key == PropKey::Computed(below))
                {
                    Some(p) => Parent::PatPropDefault(PatPropId(p as u32)),
                    None => return None,
                },
                // The computed name and the decorators of a method or an accessor are inside it.
                Parent::MemberKey(_) | Parent::MethodKey(_) => {
                    let key = PropKey::Computed(below);
                    if let Some(m) = hir.members.iter().position(|m| m.key == key) {
                        match hir.members[m].func.some() {
                            Some(f) => return Some(Some(f)),
                            None => Parent::MemberInit(MemberId(m as u32)),
                        }
                    } else if let Some(p) = hir.props.iter().position(|p| p.key == key)
                        && hir.props[p].value.is_some()
                        && let ExprKind::Fn(f) = hir[hir.props[p].value].kind
                    {
                        return Some(Some(f));
                    } else {
                        return None;
                    }
                }
                Parent::Decorator(_, DecoratorOwner::Member(m)) if hir[m].func.is_some() => {
                    return Some(Some(hir[m].func));
                }
                other => self.outward(file, other),
            };
        }
    }

    /// Removes the checker errors reported in code that tsgo never checks. `checkWithStatement` skips the body, `checkReturnStatement`
    /// returns before it checks the expression of a misplaced `return`, `checkForOfStatement` never checks the expression of a
    /// loop whose declaration list is empty, and `checkYieldExpression` never checks the operand of a `yield` outside a generator.
    /// Parser and binder errors stay.
    fn take_back_what_is_never_checked(
        &self,
        file: FileId,
        index: &ExprsByKind,
        refused: &[StmtId],
        misplaced_returns: &[StmtId],
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let mut skipped: Vec<(u32, u32)> = Vec::new();
        let no_return_is_skipped = refused.is_empty() && misplaced_returns.is_empty();
        for i in 0..hir.stmts.len() {
            let kind = hir.stmts[i].kind;
            let is_looked_at = match kind {
                StmtKind::Block(_) | StmtKind::ForOf { .. } => true,
                StmtKind::Return(_) => !no_return_is_skipped,
                _ => false,
            };
            if !is_looked_at || matches!(bound.stmt_parent[i], Parent::None) {
                continue;
            }
            let s = StmtId(i as u32);
            match kind {
                StmtKind::Block(list) if is_with_statement(hir, s) => {
                    let body = hir.id_at(list, 1);
                    // An empty body contains no nodes, and its `pos` can be 0, which is not where it is written.
                    if !matches!(hir[body].kind, StmtKind::Empty) {
                        skipped.push((hir[body].pos, self.start_of_what_follows(file, body)));
                    }
                }
                StmtKind::Return(e) if e.is_some() => {
                    if misplaced_returns.contains(&s) || refused.contains(&s) {
                        skipped.push((self.start_of(file, e), self.start_of_what_follows(file, s)));
                    }
                }
                // `checkForOfStatement` checks the expression only through the declared variable's type
                // (`checkRightHandSideOfForOf`). `parseVariableDeclarationList` leaves the list empty only before
                // `of Identifier )`, so every error on the expression starts at the identifier.
                StmtKind::ForOf { left, expr, .. } if matches!(hir[left].kind, StmtKind::Var(decls) if decls.is_empty()) =>
                {
                    let start = self.start_of(file, expr);
                    skipped.push((start, start + 1));
                }
                _ => {}
            }
        }
        // `checkYieldExpression` returns `any` for a `yield` outside a generator before it checks the operand.
        for &yield_expr in index.of(ExprTag::Yield) {
            let e = &hir[yield_expr];
            let ExprKind::Yield { value, .. } = e.kind else {
                continue;
            };
            if value.is_none() || bound.is_unchecked(yield_expr.idx()) {
                continue;
            }
            let is_operand_checked = match self.xs_containing_function(file, yield_expr) {
                Some(Some(f)) => hir[f].flags.contains(Flags::GENERATOR),
                Some(None) => false,
                None => true,
            };
            if !is_operand_checked {
                skipped.push((
                    self.start_of(file, value),
                    self.next_start_outside(file, e.pos, Parent::Expr(yield_expr)),
                ));
            }
        }
        // `checkExternalImportOrExportDeclaration` reports 1141 for a module specifier that is no string literal and returns.
        for &specifier in &hir.specifier_expressions {
            let range = self.start_of(file, specifier)..self.end_of_expr(file, specifier);
            self.never_checked
                .borrow_mut()
                .push((range.start, range.end));
            out.retain(|d| {
                !range.contains(&d.start)
                    || d.code == 1141
                    || is_said_by_the_binder(d.code)
                    || is_said_by_the_parser(d.code)
                        && hir.early_errors.contains(&(d.start, d.code))
            });
        }
        if !skipped.is_empty() {
            out.retain(|d| {
                !skipped
                    .iter()
                    .any(|&(from, to)| (from..to).contains(&d.start))
                    || is_said_by_the_binder(d.code)
                    || is_said_by_the_parser(d.code)
                        && hir.early_errors.contains(&(d.start, d.code))
            });
            self.never_checked.borrow_mut().append(&mut skipped);
        }
    }
}
