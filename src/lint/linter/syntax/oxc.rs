//! The syntax errors of oxlint and oxfmt. oxc's parser and its semantic pass report ECMAScript's early errors and many
//! of the grammar errors that TypeScript's checker reports. TypeScript's parser, which parsed the file here, leaves all
//! of that to the checker.
//!
//! Verified by running both tools on real files that were cut off after a token or had a token removed.
//!
//! All of this runs on every file, and almost no file has such an error. So nothing here walks a file's expressions, or
//! builds the index of them by kind, unless a cheap test shows there may be something to find.

mod keywords;
mod names;
mod targets;

use super::{Stage, SyntaxError, espree, oxc_typescript};
use crate::ast::{
    Class, Expr, ExprTag, File, FnBody, Func, Handle, ImportAttributes, KeyKind, Name, Node, Param,
    Pat, PropKind, Stmt, StmtTag,
};
use crate::span::Span;
use crate::tokens::{next_token, skip_trivia, token_len};
use crate::utils::oxlint::{can_be_script_or_module, has_module_syntax};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{ClassOwner, Parent};
use bun_sema::hir::{
    Diagnostic, DiagnosticKind, ExprKind, Flags, FnKind, Modifier, ModifierKind, ParamId, PatKind,
    StmtId, StmtKind, VarDecl, VarKind, rare,
};
use smallvec::SmallVec;
use std::borrow::Cow;

/// [`names::closest`]
pub(super) fn closest<'a>(
    needle: &[u8],
    candidates: impl Iterator<Item = &'a [u8]>,
) -> Option<&'a [u8]> {
    names::closest(needle, candidates)
}

fn is_keyword(modifier: &Modifier, flag: Flags) -> bool {
    modifier.kind == ModifierKind::Keyword(flag)
}

/// Each `await` outside an async function and each `yield` outside a generator. oxc's parser reports these, so our
/// parser records them in `recorded`.
fn misplaced_await_and_yield<'a>(file: &'a File<'a>, recorded: &[Diagnostic]) -> Vec<SyntaxError> {
    let hir = &file.hir;
    if recorded.is_empty() {
        return Vec::new();
    }
    let is_in_body = |at: u32| {
        let functions = (0..hir.fns.len() as u32).map(|it| Func::from_raw(file, it));
        let bodies = functions.filter_map(|it| match it.body() {
            _ if it.kind() == FnKind::StaticBlock || !it.is_in_tree() => None,
            FnBody::Expr(body) => Some(body.span()),
            _ => it.body_span(),
        });
        let statements = hir
            .modules
            .iter()
            .filter_map(|it| hir.stmts.get(it.stmt.idx()));
        let namespaces = statements.map(|it| Span::new(it.start, it.loc.end));
        bodies
            .chain(namespaces)
            .any(|it| it.start <= at && at < it.end)
    };
    // A file that can still turn out to be a module may have an `await` outside every function and namespace.
    let can_be_module = crate::utils::oxlint::can_be_script_or_module(file);
    let is_await = |it: &Diagnostic| it.kind == DiagnosticKind::Grammar && it.code == 1308;
    // Only the first `await` of `await await a` is reported.
    let follows_await = |at: u32| {
        let before = file.token_before(Span::empty(at)).map(|it| it.span().start);
        before.is_some_and(|before| recorded.iter().any(|it| is_await(it) && it.start == before))
    };
    let misplaced = recorded.iter().filter(|it| {
        it.kind == DiagnosticKind::Grammar
            && match it.code {
                1163 => true,
                1308 => (!can_be_module || is_in_body(it.start)) && !follows_await(it.start),
                _ => false,
            }
    });
    let error = |it: &Diagnostic| {
        let (message, help): (&[u8], _) = match it.code {
            1163 => (
                b"A 'yield' expression is only allowed in a generator body.",
                "Either remove this `yield` or change the enclosing function to a generator function (`function*`)",
            ),
            _ => (
                b"`await` is only allowed within async functions and at the top levels of modules",
                "Either remove this `await` or add the `async` keyword to the enclosing function",
            ),
        };
        let error = SyntaxError {
            at: it.start,
            end: 0,
            message: message.to_vec(),
            ..SyntaxError::default()
        };
        error.stage(Stage::Parser).help(Cow::Borrowed(help))
    };
    misplaced.map(error).collect()
}

/// The `for`, `for-in` or `for-of` whose head is the declaration list `statement`.
pub(super) fn loop_with_head<'a>(file: &'a File<'a>, statement: usize) -> Option<StmtKind> {
    let Parent::Stmt(parent) = file.bound.parent_of_stmt(StmtId(statement as u32)) else {
        return None;
    };
    let kind = file.hir.stmts.get(parent.idx())?.kind;
    let head = match kind {
        StmtKind::For { init, .. } => init,
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left,
        _ => return None,
    };
    (head.idx() == statement).then_some(kind)
}

/// [`names::count_of_redeclarations`]
pub(super) fn count_of_redeclarations<'a>(file: &'a File<'a>) -> usize {
    names::count_of_redeclarations(file)
}

/// `const` with nothing after it. `let a,;`. `for (const a, b of c)`.
fn declaration_list<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_DECLARATION) {
        return Vec::new();
    }
    let text = file.text();
    // The error at a token where oxc expects a variable name.
    let unexpected = |at: Span| {
        let error = match RESERVED.binary_search(&file.slice(at)).is_ok() {
            true => reserved_word(at, file.slice(at)),
            false => SyntaxError::oxc_error(at, "Unexpected token"),
        };
        error.stage(Stage::Fatal)
    };
    let incomplete = file.stmts_of_kind(StmtTag::Var).filter_map(|it| {
        let raw = it.try_raw()?;
        let StmtKind::Var(list) = raw.kind else {
            return None;
        };
        let Some(last) = file.hir.var_decls.get(list.range())?.last() else {
            let is_head = loop_with_head(file, it.id().idx()).is_some();
            // Skip `export` and `declare`.
            let mut keyword = next_token(text, raw.start);
            while matches!(file.slice(keyword), b"export" | b"declare") {
                keyword = next_token(text, keyword.end);
            }
            return (!is_head).then(|| unexpected(next_token(text, keyword.end)));
        };
        let comma = skip_trivia(text, last.loc.end);
        (text.get(comma as usize) == Some(&b',')).then(|| unexpected(next_token(text, comma + 1)))
    });
    let loops = [(StmtTag::ForIn, "in"), (StmtTag::ForOf, "of")];
    let in_heads = loops.into_iter().flat_map(|(tag, word)| {
        file.stmts_of_kind(tag).filter_map(move |it| {
            let (StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. }) = it.try_raw()?.kind
            else {
                return None;
            };
            let left = file.hir.stmts.get(left.idx())?;
            matches!(left.kind, StmtKind::Var(list) if list.len() != 1).then(|| {
                let message =
                    format!("Only a single declaration is allowed in a `for...{word}` statement");
                SyntaxError::oxc_error(Span::new(left.start, left.loc.end), message)
                    .stage(Stage::Parser)
            })
        })
    });
    incomplete.chain(in_heads).collect()
}

/// `class {}` as a statement, unless it's `export default class {}`.
fn class_without_name<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let (hir, bound) = (&file.hir, &file.bound);
    let without_name = hir.classes.iter().enumerate().filter(|&(i, it)| {
        let modifiers = hir.modifiers.get(it.modifiers.range()).unwrap_or_default();
        it.name.is_none()
            && bound
                .class_scope
                .get(i)
                .is_some_and(|scope| scope.is_some())
            && matches!(bound.class_owner.get(i), Some(ClassOwner::Stmt(_)))
            && !(modifiers.iter().any(|it| is_keyword(it, Flags::EXPORT))
                && modifiers.iter().any(|it| is_keyword(it, Flags::DEFAULT)))
    });
    without_name
        .map(|(i, _)| {
            // oxc labels five characters starting at the first modifier or decorator other than `export`.
            let start = Class::from_raw(file, i as u32).span().start;
            let start = match file.text().get(start as usize..) {
                Some(rest) if rest.starts_with(b"export") => {
                    skip_trivia(file.text(), start + "export".len() as u32)
                }
                _ => start,
            };
            let keyword = Span::new(start, start + "class".len() as u32);
            SyntaxError::oxc_error(keyword, "A class name is required.")
        })
        .collect()
}

/// `const a`, `using a`, `let [a]`, unless a loop head assigns the value or the declaration is ambient.
/// `parser_reports_patterns` means the parser already reported `let [a]`, which it does for TypeScript in oxc's
/// dialect.
fn declarations_without_initializer<'a>(
    file: &'a File<'a>,
    parser_reports_patterns: bool,
) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_DECLARATION) || file.is_declaration_file() {
        return Vec::new();
    }
    let (hir, bound) = (&file.hir, &file.bound);
    let is_in_loop_head = |statement: StmtId| {
        matches!(
            loop_with_head(file, statement.idx()),
            Some(StmtKind::ForIn { .. } | StmtKind::ForOf { .. })
        )
    };
    let is_list = |statement: StmtId| {
        let kind = hir.stmts.get(statement.idx()).map(|it| it.kind);
        matches!(kind, Some(StmtKind::Var(_)))
    };
    let is_pattern = |it: &VarDecl| {
        let kind = hir.pats.get(it.pat.idx()).map(|it| it.kind);
        matches!(kind, Some(PatKind::Object(_) | PatKind::Array(_)))
    };
    let uninitialized = hir.var_decls.iter().enumerate().filter(|(i, it)| {
        it.init.is_none()
            && (!matches!(it.kind, VarKind::Var | VarKind::Let) || is_pattern(it))
            && !it.flags.contains(Flags::AMBIENT)
            && !(parser_reports_patterns && is_pattern(it))
            && !file.is_in_jsdoc(it.loc.end)
            // Skip a `catch` parameter, whose statement is the `try`.
            && (bound.var_stmt.get(*i)).is_some_and(|list| is_list(*list) && !is_in_loop_head(*list))
    });
    let is_in_head = |statement: StmtId| loop_with_head(file, statement.idx()).is_some();
    uninitialized
        .filter_map(|(i, it)| Some((bound.var_stmt.get(i)?, it)))
        .map(|(list, it)| {
            let message = match it.kind {
                VarKind::Using | VarKind::AwaitUsing => {
                    "Using declarations must have an initializer."
                }
                _ if is_pattern(it) => "Missing initializer in destructuring declaration",
                _ => "Missing initializer in const declaration",
            };
            let error = SyntaxError::oxc_error(Pat::new(file, it.pat).span(), message)
                .help("Add an initializer (e.g. ` = undefined`) here")
                .stage(Stage::Parser);
            // By then oxc has read the whole pattern, and in a `for` head it's at the `;`.
            match is_pattern(it) || is_in_head(*list) {
                true => error.noticed_at(skip_trivia(file.text(), it.loc.end)),
                false => error,
            }
        })
        .collect()
}

/// A name bound by two parameters of a function or signature. That's only allowed in sloppy mode, in a function
/// declaration or expression whose parameters are all plain identifiers. The error is at the first one.
fn duplicate_parameters<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    // Almost no file has a parameter list with a duplicate or a pattern.
    let mut all = Vec::new();
    if !file.may_bind_a_parameter_twice() {
        return all;
    }
    let mut names: SmallVec<[(Atom, u32); 8]> = SmallVec::new();
    for (i, raw) in hir.fns.iter().enumerate() {
        // A single parameter can only bind a name twice in a pattern. That case isn't checked.
        if raw.params.len < 2 {
            continue;
        }
        let params = hir.params.get(raw.params.range()).unwrap_or_default();
        names.clear();
        let mut are_simple = true;
        for (param, id) in params.iter().zip(raw.params.iter()) {
            are_simple &= param.default.is_none() && !param.flags.contains(Flags::REST);
            match hir.pats.get(param.pat.idx()).map(|it| (it.kind, it.pos)) {
                Some((PatKind::Ident(name), pos)) => names.push((name, pos)),
                _ => {
                    are_simple = false;
                    let id: ParamId = id;
                    Param::new(file, id).pat().for_each_binding(&mut |it| {
                        if let Some(PatKind::Ident(name)) = it.try_raw().map(|it| it.kind) {
                            names.push((name, it.span().start));
                        }
                    });
                }
            }
        }
        // Sorting groups equal names together, in source order. Each one after the first is an error that also labels
        // the first.
        crate::utils::sort::sort_unstable_by_key(&mut names, |it| (it.0.0, it.1));
        if !(1..names.len()).any(|i| names[i - 1].0 == names[i].0) {
            continue;
        }
        let func = Func::from_raw(file, i as u32);
        let allows = are_simple
            && matches!(raw.kind, FnKind::Decl | FnKind::Expr)
            && !crate::utils::oxlint::is_strict_mode(Node::Func(func).scope(), file);
        if allows || !func.is_in_tree() {
            continue;
        }
        let mut first = 0;
        for i in 1..names.len() {
            if names[i].0 != names[first].0 {
                first = i;
                continue;
            }
            let (at, again) = (names[first].1, names[i].1);
            let rest = file.text().get(at as usize..).unwrap_or_default();
            let name = rest.get(..token_len(rest)).unwrap_or_default();
            let len = name.len() as u32;
            let (first, again) = (Span::new(at, at + len), Span::new(again, again + len));
            all.push(SyntaxError::redeclared("Identifier", name, first, again));
        }
    }
    all
}

/// `declare` at the start of a statement in a context that's already ambient: anywhere inside a `declare namespace`, a
/// `declare module`, `declare global`, a `declare function`, or a namespace or function in a declaration file. oxc
/// accepts it after `export`.
fn declare_in_ambient_context<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::NESTED_DECLARE) {
        return Vec::new();
    }
    let hir = &file.hir;
    let is_ambient = |it: Node<'a>| match it {
        Node::Func(it) => file.is_declaration_file() && it.kind() != FnKind::StaticBlock,
        Node::Stmt(it) => match it.try_raw().map(|it| it.kind) {
            Some(StmtKind::Module(id)) => {
                (hir.modules.get(id.idx())).is_some_and(|it| it.flags.contains(Flags::AMBIENT))
            }
            Some(StmtKind::Fn(_) | StmtKind::Class(_)) => it.flags().contains(Flags::AMBIENT),
            _ => false,
        },
        _ => false,
    };
    let declared = (0..hir.stmts.len()).filter_map(|i| {
        let modifier_range = hir.stmt_modifiers(StmtId(i as u32));
        let first = hir.modifiers.get(modifier_range.range())?.first()?;
        let is_in_tree = !matches!(file.bound.parent_of_stmt(StmtId(i as u32)), Parent::None);
        let statement = Node::Stmt(Stmt::from_raw(file, i as u32));
        (is_keyword(first, Flags::AMBIENT) && is_in_tree && statement.ancestors().any(is_ambient))
            .then_some(first.pos)
    });
    declared
        .map(|at| {
            let keyword = Span::new(at, at + "declare".len() as u32);
            let message = "A 'declare' modifier cannot be used in an already ambient context.";
            SyntaxError::oxc_error(keyword, message)
                .code(1038)
                .stage(Stage::Parser)
        })
        .collect()
}

/// `import.defer` that isn't called. TypeScript's parser records a grammar error for it, positioned after the word.
fn import_phase_without_call<'a>(file: &'a File<'a>, recorded: &[Diagnostic]) -> Vec<SyntaxError> {
    let is_missing_call = |it: &&Diagnostic| {
        it.kind == DiagnosticKind::Grammar
            && it.code == 1005
            && it.args.first().is_some_and(|it| **it == *b"(")
    };
    (recorded.iter().filter(is_missing_call))
        .map(|it| expected(file, "(", token_after(file, Span::empty(it.start))).stage(Stage::Fatal))
        .collect()
}

/// `import defer a from "b"`, `import defer { a } from "b"`: only a namespace can be deferred.
fn deferred_imports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let deferred = file.hir.imports.iter().filter(|it| it.is_deferred);
    let rejected = deferred.filter_map(|it| {
        // `import source a from "b"` also has `is_deferred` set.
        let clause = file.text().get(it.clause_start as usize..)?;
        let (message, code) = match clause.starts_with(b"defer") {
            true if it.default.is_some() => (
                "Default imports are not allowed in a deferred import.",
                18058,
            ),
            true if it.has_named_imports => {
                ("Named imports are not allowed in a deferred import.", 18059)
            }
            _ => return None,
        };
        let keyword = Span::new(it.clause_start, it.clause_start + "defer".len() as u32);
        Some(
            SyntaxError::oxc_error(keyword, message)
                .code(code)
                .stage(Stage::Parser),
        )
    });
    rejected.collect()
}

/// True if oxc adds a label at the `{` at `open` when the file ends before its `}`. It does for a block, for the body
/// of a function, class, interface or `switch`, and for a type literal.
fn labels_opener_at_eof<'a>(file: &'a File<'a>, open: Span) -> bool {
    let hir = &file.hir;
    let is_literal = |it: &bun_sema::hir::Expr| {
        it.pos == open.start && matches!(it.kind, bun_sema::hir::ExprKind::Object(_))
    };
    let is_pattern =
        |it: &bun_sema::hir::Pat| it.pos == open.start && matches!(it.kind, PatKind::Object(_));
    if hir.exprs.iter().any(is_literal) || hir.pats.iter().any(is_pattern) {
        return false;
    }
    let mut before = file.tokens_before(open).map(|it| it.text());
    let (first, mut second) = (
        before.next().unwrap_or_default(),
        before.next().unwrap_or_default(),
    );
    // `namespace a.b {`
    while second == b"." {
        before.next();
        second = before.next().unwrap_or_default();
    }
    let third = before.next().unwrap_or_default();
    let is_module_keyword = |word: &[u8]| matches!(word, b"import" | b"export");
    let is_list_of_names = is_module_keyword(first)
        || first == b"type" && is_module_keyword(second)
        || first == b"," && (is_module_keyword(third) || third == b"type");
    !is_list_of_names
        && !matches!(first, [b'"' | b'\'', ..] | b"global")
        && !matches!(second, b"enum" | b"namespace" | b"module")
}

/// Finds the `open` bracket that a `close` bracket at `at` would match.
fn opener<'a>(file: &'a File<'a>, at: u32, (open, close): (u8, u8)) -> Option<Span> {
    let mut depth = 0;
    file.tokens_before(Span::new(at, at)).find_map(|it| {
        match it.text() {
            [byte] if *byte == close => depth += 1,
            [byte] if *byte == open && depth == 0 => return Some(it.span()),
            [byte] if *byte == open => depth -= 1,
            _ => {}
        }
        None
    })
}

/// The `?` of the conditional expression that lacks its `:` at `at`.
fn question_mark<'a>(file: &'a File<'a>, at: u32) -> Option<Span> {
    let (mut brackets, mut colons) = (0, 0);
    for it in file.tokens_before(Span::new(at, at)) {
        match it.text() {
            b")" | b"]" | b"}" => brackets += 1,
            b"(" | b"[" | b"{" if brackets == 0 => return None,
            b"(" | b"[" | b"{" => brackets -= 1,
            _ if brackets > 0 => {}
            b";" => return None,
            b":" => colons += 1,
            b"?" if colons == 0 => return Some(it.span()),
            b"?" => colons -= 1,
            _ => {}
        }
    }
    None
}

/// Finds the `close` bracket that matches the `open` bracket at `at`.
fn closer<'a>(file: &'a File<'a>, at: Span, (open, close): (u8, u8)) -> Option<Span> {
    let mut depth = 0;
    file.tokens_after(at).find_map(|it| {
        match it.text() {
            [byte] if *byte == open => depth += 1,
            [byte] if *byte == close && depth == 0 => return Some(it.span()),
            [byte] if *byte == close => depth -= 1,
            _ => {}
        }
        None
    })
}

/// The words that have their own token kind in oxc's lexer, sorted.
const KEYWORDS: [&[u8]; 87] = [
    b"abstract",
    b"accessor",
    b"any",
    b"as",
    b"assert",
    b"asserts",
    b"async",
    b"await",
    b"bigint",
    b"boolean",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"const",
    b"constructor",
    b"continue",
    b"debugger",
    b"declare",
    b"default",
    b"defer",
    b"delete",
    b"do",
    b"else",
    b"enum",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"from",
    b"function",
    b"get",
    b"global",
    b"if",
    b"implements",
    b"import",
    b"in",
    b"infer",
    b"instanceof",
    b"interface",
    b"intrinsic",
    b"is",
    b"keyof",
    b"let",
    b"meta",
    b"module",
    b"namespace",
    b"never",
    b"new",
    b"null",
    b"number",
    b"object",
    b"of",
    b"out",
    b"override",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"readonly",
    b"require",
    b"return",
    b"satisfies",
    b"set",
    b"source",
    b"static",
    b"string",
    b"super",
    b"switch",
    b"symbol",
    b"target",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"type",
    b"typeof",
    b"undefined",
    b"unique",
    b"unknown",
    b"using",
    b"var",
    b"void",
    b"while",
    b"with",
    b"yield",
];

/// The [`KEYWORDS`] that are reserved in every context, sorted.
const RESERVED: [&[u8]; 36] = [
    b"break",
    b"case",
    b"catch",
    b"class",
    b"const",
    b"continue",
    b"debugger",
    b"default",
    b"delete",
    b"do",
    b"else",
    b"enum",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"function",
    b"if",
    b"import",
    b"in",
    b"instanceof",
    b"new",
    b"null",
    b"return",
    b"super",
    b"switch",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"typeof",
    b"var",
    b"void",
    b"while",
    b"with",
];

/// oxc's name for the token `text`, as in "Expected `;` but found `Identifier`".
#[optimize(size)]
pub(super) fn name_of_token(text: &[u8]) -> String {
    let has_any = |of: &[u8]| bun_core::strings::index_of_any(text, of).is_some();
    let number = || match text {
        [b'0', b'x' | b'X', ..] => "hex",
        [b'0', b'b' | b'B', ..] => "binary",
        [b'0', b'o' | b'O', ..] => "octal",
        [b'0', b'0'..=b'9', ..] if !has_any(b"89.eEn") => "octal",
        _ if has_any(b".eE") => "float",
        _ => "decimal",
    };
    match text {
        [] => "EOF".to_owned(),
        [b'"' | b'\'', ..] => "string".to_owned(),
        [b'`', .., b'`'] => "${}".to_owned(),
        [b'`', ..] => "${".to_owned(),
        [b'#', ..] => "#identifier".to_owned(),
        [b'0'..=b'9', .., b'n'] => format!("{} bigint", number()),
        [b'0'..=b'9', ..] | [b'.', b'0'..=b'9', ..] => number().to_owned(),
        // oxc's lexer splits `>>`, `>=` and the like.
        [b'>', ..] => ">".to_owned(),
        [b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80.., ..]
            if KEYWORDS.binary_search(&text).is_err() =>
        {
            "Identifier".to_owned()
        }
        _ => bstr::BStr::new(text).to_string(),
    }
}

fn reserved_word(at: Span, word: &[u8]) -> SyntaxError {
    let rest = b"' is a reserved word that cannot be used here.";
    SyntaxError::oxc_error(at, [b"Identifier expected. '", word, rest].concat())
}

/// "Expected `wanted` but found `..`", at the token `at`.
fn expected<'a>(file: &'a File<'a>, wanted: &str, at: Span) -> SyntaxError {
    let found = name_of_token(file.slice(at));
    SyntaxError::expected(at, &["`", wanted, "`"].concat(), found.as_bytes())
}

/// The token after `at`, or the end of the text.
fn token_after<'a>(file: &'a File<'a>, at: Span) -> Span {
    let end = file.text().len() as u32;
    file.token_after(at)
        .map_or_else(|| Span::new(end, end), |it| it.span())
}

fn is_modifier(word: &[u8]) -> bool {
    matches!(
        word,
        b"abstract"
            | b"accessor"
            | b"async"
            | b"declare"
            | b"override"
            | b"private"
            | b"protected"
            | b"public"
            | b"readonly"
            | b"static"
    )
}

/// oxc's parser error for the private name `name` in operand position. A private name can only be the left side of
/// `in`, so it can't be the operand of an operator that binds at least as tightly.
pub(super) fn private_name_as_operand<'a>(file: &'a File<'a>, name: Span) -> Option<SyntaxError> {
    let name = Span::new(name.start, end_of_name(file.text(), name.end));
    let previous = file.token_before(name);
    let operator = previous.map_or(&b""[..], |it| it.text());
    // `+` and `-` are binary if they follow the end of an operand.
    let follows_operand = || {
        let before = previous.and_then(|it| file.token_before(it.span()));
        before.is_some_and(|it| match it.text() {
            b"return" | b"typeof" | b"case" | b"do" | b"else" | b"in" | b"instanceof" | b"new"
            | b"void" | b"delete" | b"throw" | b"yield" | b"await" => false,
            [.., last] => {
                last.is_ascii_alphanumeric()
                    || matches!(
                        last,
                        b'_' | b'$' | b')' | b']' | b'}' | b'"' | b'\'' | b'`' | 0x80..
                    )
            }
            [] => false,
        })
    };
    let next = token_after(file, name);
    let error = match operator {
        b"!" | b"~" | b"typeof" | b"void" | b"delete" | b"await" | b"++" | b"--" => {
            SyntaxError::oxc_error(name, "Unexpected token")
        }
        b"+" | b"-" if !follows_operand() => SyntaxError::oxc_error(name, "Unexpected token"),
        b"+" | b"-" | b"*" | b"/" | b"%" | b"**" | b"<<" | b">>" | b">>>" | b"<" | b">" | b"<="
        | b">=" | b"instanceof" | b"in" => {
            SyntaxError::oxc_error(name, "Unexpected private identifier")
        }
        _ if file.slice(next) != b"in" => expected(file, "in", next),
        _ => return None,
    };
    Some(error.stage(Stage::Fatal))
}

/// The error for a closing tag whose name, at `closing`, differs from the name in the opening tag, at `opening`.
#[optimize(size)]
fn wrong_closing_tag<'a>(file: &'a File<'a>, closing: Span, opening: Span) -> SyntaxError {
    let name = bstr::BStr::new(file.slice(opening));
    let message = format!("Expected corresponding JSX closing tag for '{name}'.");
    SyntaxError::oxc_error(closing, message)
        .label_text(format!("Expected `</{name}>`"))
        .and(opening, "Opened here")
        .noticed_at(closing.start)
}

/// Translates a JSX error from TypeScript's parser into oxc's wording. oxc continues after a closing tag with the wrong
/// name.
#[optimize(size)]
fn translate_jsx_error<'a>(
    file: &'a File<'a>,
    it: &Diagnostic,
    label: Span,
) -> Option<SyntaxError> {
    let (hir, text) = (&file.hir, file.text());
    let span_of =
        |id: bun_sema::hir::ExprId| hir.exprs.get(id.idx()).map(|it| Span::new(it.pos, it.end));
    // The opening tag's name for the element whose closing tag is at `at`, or is missing at `at`.
    let opened_before = |at: u32| {
        let element = hir.jsx.iter().find(|it| it.close_pos == at)?;
        span_of(element.tag)
    };
    let mismatch = |closing: Span, opening: Span| wrong_closing_tag(file, closing, opening);
    // The JSX text that runs to the end of the file.
    let to_the_end = || {
        let last = bun_core::strings::last_index_of_any(text, b">}").map_or(0, |it| it + 1);
        SyntaxError::oxc_error(
            Span::new(last as u32, text.len() as u32),
            "Unexpected token",
        )
    };
    Some(match it.code {
        17002 => mismatch(label, opened_before(label.start.checked_sub(2)?)?).stage(Stage::Parser),
        17015 => {
            let fragment = hir.jsx.iter().find(|it| it.close_pos + 2 == label.start)?;
            let opening = Span::new(fragment.opening_end.checked_sub(2)?, fragment.opening_end);
            SyntaxError::oxc_error(
                label,
                "Expected corresponding closing tag for JSX fragment.",
            )
            .label_text("Expected `</>`")
            .and(opening, "Opened here")
            .noticed_at(label.start)
        }
        17014 => to_the_end(),
        // The element isn't closed. oxc compares the next closing tag with it, or reaches the end of the file.
        17008 => {
            let element = hir
                .jsx
                .iter()
                .find(|jsx| span_of(jsx.tag).is_some_and(|tag| tag.start == it.start))?;
            let rest = text.get(element.close_pos as usize..)?;
            match rest.starts_with(b"</") {
                true => mismatch(
                    next_token(text, element.close_pos + 2),
                    span_of(element.tag)?,
                ),
                false => to_the_end(),
            }
        }
        // `<a></>`
        1003 if file.slice(label) == b">" && text.get(..label.start as usize)?.ends_with(b"</") => {
            mismatch(
                Span::new(label.start - 2, label.end),
                opened_before(label.start - 2)?,
            )
        }
        1381 | 1382 => {
            let mut message = Vec::new();
            bun_sema::messages::format(
                &mut message,
                bun_sema::messages::message(it.code)?.1,
                &it.args,
            );
            SyntaxError::oxc_error(Span::empty(it.start), message)
        }
        2657 => {
            let is_first = |e: &&bun_sema::hir::Expr| {
                e.pos == it.start && matches!(e.kind, bun_sema::hir::ExprKind::Jsx(_))
            };
            let first = hir.exprs.iter().filter(is_first).map(|it| it.end).min()?;
            let next = skip_trivia(text, first);
            SyntaxError::oxc_error(
                Span::new(next, next + 1),
                "Adjacent JSX elements must be wrapped in an enclosing tag.",
            )
            .help("Did you want a JSX fragment `<>...</>`?")
        }
        _ => return None,
    })
}

/// Translates an error from TypeScript's parser about code that oxc's parser handles differently, with another message
/// or at another token. The surrounding tokens identify the case. If oxc recovers from such an error but TypeScript's
/// parser doesn't, it's the last error we report.
#[optimize(size)]
fn translate_by_shape<'a>(file: &'a File<'a>, it: &Diagnostic, label: Span) -> Option<SyntaxError> {
    let slice = |at: Span| file.slice(at);
    let before = |at: Span| file.token_before(at).map(|it| it.span());
    let text_before = |at: Span| before(at).map_or(&b""[..], slice);
    let after = |at: Span| token_after(file, at);
    let unexpected = |at: Span| SyntaxError::oxc_error(at, "Unexpected token");
    let semicolon = SyntaxError::semicolon_after;
    let wanted = it.args.first().map_or(&b""[..], |it| &it[..]);
    let lacks_semicolon = matches!(it.code, 1434 | 1442) || it.code == 1005 && wanted == b";";
    let is_unexpected = matches!(it.code, 1003 | 1109 | 1110 | 1128 | 1134 | 1138);
    let previous = before(label);
    // The parentheses enclosing `at`, if a `=>` follows them.
    let head_of_arrow = |at: u32| {
        let open = opener(file, at, (b'(', b')'))?;
        let close = closer(file, open, (b'(', b')'))?;
        (slice(after(close)) == b"=>").then_some((open, close))
    };
    let is_literal = |at: Span| matches!(slice(at), [b'0'..=b'9' | b'"' | b'\'', ..]);

    // An identifier character directly after a number. TypeScript's scanner only reports that after some kinds of
    // number. This checks the raw text because the token list may have the two as one token.
    let touches_number = || {
        let before = file.text().get(..label.start as usize).unwrap_or_default();
        let is_part = |it: &&u8| it.is_ascii_alphanumeric() || matches!(**it, b'_' | b'.');
        let number = before.len() - before.iter().rev().take_while(is_part).count();
        before.get(number).is_some_and(u8::is_ascii_digit)
    };
    if (lacks_semicolon || matches!(it.code, 1131 | 1144 | 1440))
        && matches!(
            file.text().get(label.start as usize),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$')
        )
        && touches_number()
    {
        let first = Span::new(label.start, label.start + 1);
        return Some(SyntaxError::oxc_error(
            first,
            "Invalid characters after number",
        ));
    }
    // After `yield` oxc parses an operand, unless the expression can end there.
    if it.code == 1005
        // In `{ yield = 1 }` it's a key.
        && wanted != b":"
        && let Some(keyword) = previous.filter(|it| slice(*it) == b"yield")
        && !bun_core::strings::contains_js_line_break(slice(keyword.between(label)))
        && !matches!(slice(label), b"" | b")" | b"]" | b"}" | b"," | b";" | b":")
    {
        return Some(unexpected(label));
    }
    // `async await => 1` where `await` is a keyword.
    if it.code == 1434 && slice(label) == b"async" && slice(after(label)) == b"await" {
        let arrow = after(after(label));
        if slice(arrow) == b"=>" {
            return Some(unexpected(arrow));
        }
    }
    // `[k: string]?: T`
    if lacks_semicolon
        && let Some(close) = previous.filter(|it| slice(*it) == b"]")
        && let Some(open) = opener(file, close.start, (b'[', b']'))
        && slice(after(after(open))) == b":"
    {
        let modifiers = file.tokens_before(open);
        let modifiers = modifiers.take_while(|it| is_modifier(it.text()));
        let start = modifiers.last().map_or(open.start, |it| it.span().start);
        let message = "An index signature must have a type annotation.";
        return Some(SyntaxError::oxc_error(Span::new(start, close.end), message).code(1021));
    }
    // After a class member that isn't a method, oxc expects a `;`, a line break or the `}`.
    if lacks_semicolon
        && let Some(open) = opener(file, label.start, (b'{', b'}'))
        && file.classes().any(|it| it.body_span().start == open.start)
    {
        // TypeScript's parser reports either the name (1434) or the offending token.
        let mut wrong = match it.code {
            1434 => after(label),
            _ => label,
        };
        if slice(wrong) == b"!" && it.code == 1434 {
            wrong = after(wrong);
        }
        return Some(expected(file, ";", wrong));
    }
    // `static constructor = 1`
    if it.code == 1005
        && wanted == b"("
        && let Some(name) = previous.filter(|it| slice(*it) == b"constructor")
    {
        let mut modifiers = (file.tokens_before(name)).take_while(|it| is_modifier(it.text()));
        if modifiers.any(|it| it.text() == b"static") {
            let message = "Classes can't have a field named 'constructor'";
            return Some(SyntaxError::oxc_error(name, message));
        }
    }
    // `let { ...{ a } } = b`, `let { ...[a] } = b`, `let { ...1 } = b`. TypeScript's parser parses the last two as a
    // key.
    let invalid_rest = |target: Span| {
        SyntaxError::oxc_error(
            target,
            "Invalid rest element target in destructuring pattern",
        )
        .help("Expected an identifier, like `...rest`.")
    };
    if it.code == 1003 && text_before(label) == b"..." {
        let pair = match slice(label) {
            b"{" => Some((b'{', b'}')),
            b"[" => Some((b'[', b']')),
            _ => None,
        };
        if let Some(close) = pair.and_then(|it| closer(file, label, it)) {
            return Some(invalid_rest(Span::new(label.start, close.end)));
        }
    }
    if it.code == 1005
        && wanted == b":"
        && let Some(key) = previous
    {
        if slice(key) == b"]"
            && let Some(open) = opener(file, key.start, (b'[', b']'))
            && text_before(open) == b"..."
        {
            return Some(invalid_rest(Span::new(open.start, key.end)));
        }
        if is_literal(key) && text_before(key) == b"..." {
            return Some(unexpected(key));
        }
    }
    // A reserved word where oxc expects a variable name.
    if is_unexpected
        && matches!(text_before(label), b"let" | b"var" | b"const" | b"using")
        && RESERVED.binary_search(&slice(label)).is_ok()
    {
        let message = [
            b"Identifier expected. '",
            slice(label),
            b"' is a reserved word that cannot be used here.",
        ];
        return Some(SyntaxError::oxc_error(label, message.concat()));
    }
    // `yield` as the name of a TypeScript declaration in a generator.
    if slice(label) == b"yield"
        && (matches!(it.code, 2457 | 2427 | 2819)
            || it.code == 1003 && text_before(label) == b"enum")
    {
        let message = "Cannot use `yield` as an identifier in a generator context";
        return Some(SyntaxError::oxc_error(label, message));
    }
    match it.code {
        1132 if slice(label).starts_with(b"`") => {
            let message = "Computed property names are not allowed in enums.";
            return Some(SyntaxError::oxc_error(label, message).code(1164));
        }
        1132 => return Some(unexpected(label)),
        // `a[]`
        1011 => return Some(unexpected(after(Span::new(label.start, label.start)))),
        _ => {}
    }
    if !is_unexpected {
        // `({ a: b.c }) => 1`: these can't be parameters, so oxc parses a parenthesized expression, which `=>` can't
        // follow.
        let continues_expression = it.code == 1005 && matches!(slice(label), b"." | b"(" | b"[");
        let head = head_of_arrow(label.start).filter(|_| continues_expression && wanted != b";");
        return head.map(|(_, close)| semicolon(close.end));
    }
    // `catch (a = 1)`
    if slice(label) == b"="
        && let Some(open) = opener(file, label.start, (b'(', b')'))
        && text_before(open) == b"catch"
    {
        return Some(expected(file, ")", label));
    }
    // `<a>{</a>`: oxc reads the `<` as the start of an element.
    if slice(label).starts_with(b"<") && file.text().get(label.start as usize + 1) == Some(&b'/') {
        return Some(unexpected(Span::new(label.start + 1, label.start + 2)));
    }
    // `<1 />`: oxc is past the `<` and expects a name. The `/` is its own token.
    if slice(label) == b"<"
        && text_before(label) != b"?."
        && !matches!(file.path(), [.., b't', b's'])
    {
        let next = after(label);
        return Some(unexpected(match slice(next) {
            [b'/', _, ..] => Span::new(next.start, next.start + 1),
            _ => next,
        }));
    }
    // `<a b={} />`
    if slice(label) == b"}"
        && let Some(open) = previous.filter(|it| slice(*it) == b"{")
        && text_before(open) == b"="
    {
        let message = "JSX attributes must only be assigned a non-empty 'expression'.";
        let braces = Span::new(open.start, label.end);
        return Some(SyntaxError::oxc_error(braces, message).code(17000));
    }
    // `typeof a.#b`, `A.#b`: TypeScript's parser reports these after the name.
    if label.is_empty()
        && let Some(name) = previous.filter(|it| slice(*it).starts_with(b"#"))
    {
        return Some(unexpected(name));
    }
    if slice(label).starts_with(b"#") && !matches!(text_before(label), b"." | b"?.") {
        return private_name_as_operand(file, label).or_else(|| Some(unexpected(label)));
    }
    // `import.defer;`, `import.source;`
    if let Some(phase) = previous.filter(|it| matches!(slice(*it), b"defer" | b"source"))
        && let Some(dot) = before(phase).filter(|it| slice(*it) == b".")
        && text_before(dot) == b"import"
    {
        return Some(expected(file, "(", label));
    }
    // `(await) => 1` where `await` is a keyword.
    if matches!(slice(label), b")" | b",")
        && let Some(name) = previous.filter(|it| slice(*it) == b"await")
        && head_of_arrow(label.start).is_some()
    {
        let message = "Cannot use `await` as an identifier in an async context";
        return Some(SyntaxError::oxc_error(name, message));
    }
    // `({ a: 1 }) => 1`, `({ a: 1 } = 1) => 1`
    if it.code == 1003
        && is_literal(label)
        && let Some((_, close)) = head_of_arrow(label.start)
    {
        let pattern = opener(file, label.start, (b'{', b'}'));
        let pattern = pattern.and_then(|it| closer(file, it, (b'{', b'}')));
        return Some(match pattern.map(|it| slice(after(it))) {
            Some(b"=") => SyntaxError::oxc_error(label, "Cannot assign to this expression"),
            _ => semicolon(close.end),
        });
    }
    // An error at the end of the file.
    let end = file.text().len() as u32;
    (label.is_empty() && skip_trivia(file.text(), label.start) >= end)
        .then(|| unexpected(Span::empty(end)))
}

/// The context of an unterminated regular expression. As oxc's parser unwinds, it fails again at the end of the file,
/// and each new error replaces the previous one.
enum RegexContext {
    Nothing,
    /// Brackets of any kind, or the head of a class or interface. The lexer's error survives.
    Brackets,
    /// Somewhere inside the head of an `if`, a `with` or a loop, or after `a ?` without its `:`. The parser's error
    /// survives.
    Head,
}

#[optimize(size)]
fn unterminated_regex_context<'a>(file: &'a File<'a>, at: u32) -> RegexContext {
    let (mut closed, mut regex_context) = (0, RegexContext::Nothing);
    if question_mark(file, at).is_some() {
        return RegexContext::Head;
    }
    // `class A extends /`, `interface A extends B, /`
    let is_in_name =
        |text: &[u8]| matches!(text, b"," | b".") || name_of_token(text) == "Identifier";
    let mut head = file.tokens_before(Span::empty(at)).map(|it| it.text());
    if head
        .find(|it| !is_in_name(it))
        .is_some_and(|it| it == b"extends")
    {
        regex_context = RegexContext::Brackets;
    }
    let is_object = |open: Span| {
        let mut all = file.hir.exprs.iter();
        all.any(|it| it.pos == open.start && matches!(it.kind, bun_sema::hir::ExprKind::Object(_)))
    };
    // True if the `while` ends a `do { .. }`.
    let ends_do = |keyword: Span| {
        let close = file.token_before(keyword).filter(|it| it.text() == b"}");
        let open = close.and_then(|it| opener(file, it.span().start, (b'{', b'}')));
        open.and_then(|it| file.token_before(it))
            .is_some_and(|it| it.text() == b"do")
    };
    // True if the last `[` seen may open a computed key.
    let mut may_be_key = false;
    let mut tokens = file.tokens_before(Span::empty(at)).peekable();
    while let Some(it) = tokens.next() {
        let before = tokens.peek().copied();
        match it.text() {
            b")" | b"]" | b"}" => closed += 1,
            b"(" | b"[" | b"{" if closed > 0 => closed -= 1,
            b"(" => match before.map_or(&b""[..], |it| it.text()) {
                b"while" if before.is_some_and(|it| ends_do(it.span())) => {
                    (regex_context, may_be_key) = (RegexContext::Brackets, false);
                }
                b"if" | b"while" | b"for" | b"with" | b"await" => return RegexContext::Head,
                b"import" => may_be_key = false,
                _ => (regex_context, may_be_key) = (RegexContext::Brackets, false),
            },
            b"[" => {
                may_be_key = matches!(before.map(|it| it.text()), Some(b"{" | b","));
                regex_context = RegexContext::Brackets;
            }
            b"{" if may_be_key && is_object(it.span()) => return RegexContext::Head,
            b"{" => (regex_context, may_be_key) = (RegexContext::Brackets, false),
            _ => {}
        }
    }
    regex_context
}

/// The offset just past the first line break after `from`, or the end of `text`.
fn end_of_line(text: &[u8], from: u32) -> u32 {
    let rest = text.get(from as usize..).unwrap_or_default();
    bun_core::strings::index_of_any(rest, b"\n\r")
        .map_or(text.len() as u32, |it| from + it as u32 + 1)
}

/// Translates an error from TypeScript's scanner into the wording of oxc's lexer.
///
/// oxlint prints the errors the lexer recovers from before all parser errors. If the parser can't continue with the
/// token the lexer produced, the lexer's error is the fatal one.
#[optimize(size)]
fn translate_scanner_error<'a>(
    file: &'a File<'a>,
    it: &Diagnostic,
    label: Span,
) -> Option<SyntaxError> {
    let text = file.text();
    let end_of_text = text.len() as u32;
    let as_recoverable = |error: SyntaxError| error.stage(Stage::Parser).noticed_at(0);
    let as_fatal = |error: SyntaxError| error.stage(Stage::Fatal);
    let end_of_line = |from: u32| end_of_line(text, from);
    let character_at = |at: u32| {
        let rest = text.get(at as usize..).unwrap_or_default();
        let first = rest.utf8_chunks().next();
        let len = first.and_then(|it| it.valid().chars().next());
        &rest[..len.map_or(1, char::len_utf8).min(rest.len())]
    };
    let invalid_character = |at: u32, len: u32| {
        let message = [b"Invalid Character `", character_at(at), b"`"].concat();
        as_fatal(SyntaxError::oxc_error(Span::new(at, at + len), message))
    };
    let after_number = |at: Span| {
        as_fatal(SyntaxError::oxc_error(
            at,
            "Invalid characters after number",
        ))
    };
    // The `\` of the escape that's invalid at `at`.
    let escape_before = |at: u32| {
        let before = text.get(..at as usize).unwrap_or_default();
        let digits = before.iter().rev().take_while(|it| it.is_ascii_hexdigit());
        let before = &before[..before.len() - digits.count()];
        let before = before.strip_suffix(b"{").unwrap_or(before);
        let before = before
            .strip_suffix(b"x")
            .or_else(|| before.strip_suffix(b"u"))?;
        before.ends_with(b"\\").then(|| before.len() as u32 - 1)
    };
    // The token on `at`'s line that extends to `at`.
    let token_up_to = |at: u32| {
        let before = text.get(..at as usize).unwrap_or_default();
        let line = bun_core::strings::last_index_of_any(before, b"\n\r").map_or(0, |it| it + 1);
        let after = |token: u32| {
            let rest = text.get(token as usize..).unwrap_or_default();
            skip_trivia(text, token + token_len(rest) as u32)
        };
        let mut token = skip_trivia(text, line as u32);
        while token < at && after(token) < at && after(token) > token {
            token = after(token);
        }
        token.min(at)
    };
    let escape = escape_before(it.start);
    Some(match it.code {
        1010 => {
            // The first `/*` after the last token that no `*/` follows. In `/*/` the second `/` doesn't close the
            // comment.
            let not_closed = |mut open: usize| loop {
                open += bun_core::strings::index_of(text.get(open..)?, b"/*")?;
                match bun_core::strings::index_of(text.get(open + 2..)?, b"*/") {
                    Some(close) => open += 2 + close + 2,
                    None => break Some(open),
                }
            };
            let last = file.token_before(Span::empty(end_of_text));
            let open = not_closed(last.map_or(0, |it| it.span().end as usize));
            let comment = Span::new(open.or_else(|| not_closed(0))? as u32, end_of_text);
            as_recoverable(SyntaxError::oxc_error(
                comment,
                "Unterminated multiline comment",
            ))
        }
        1002 => {
            let start = match token_up_to(it.start) {
                // A JSX attribute value can span lines.
                start if start == it.start => {
                    let before = text.get(..start as usize).unwrap_or_default();
                    bun_core::strings::last_index_of_any(before, b"\"'")
                        .map_or(start, |it| it as u32)
                }
                start => start,
            };
            let string = Span::new(start, end_of_line(it.start));
            as_fatal(SyntaxError::oxc_error(string, "Unterminated string"))
        }
        1160 => {
            let is_open = |it: &&bun_sema::hir::Expr| {
                it.end >= end_of_text && text.get(it.pos as usize) == Some(&b'`')
            };
            let template = file
                .hir
                .exprs
                .iter()
                .filter(is_open)
                .map(|it| it.pos)
                .max()?;
            as_fatal(SyntaxError::oxc_error(
                Span::new(template, end_of_text),
                "Unterminated string",
            ))
        }
        1125 | 1198 | 1199 if escape.is_some() => {
            let escape = Span::new(escape?, label.end.max(it.start));
            as_recoverable(SyntaxError::oxc_error(escape, "Invalid escape sequence"))
        }
        1124 | 1125 | 1177 | 1178 => invalid_character(it.start, 0),
        6189 => invalid_character(it.start, 0),
        6188 => match text.get(it.start as usize + 1) {
            Some(b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F') => after_number(label),
            _ => invalid_character(it.start + 1, 0),
        },
        1353 => after_number(Span::new(label.end.saturating_sub(1), label.end)),
        1127 if text.get(it.start as usize) == Some(&b'#') => {
            invalid_character(it.start + 1, character_at(it.start + 1).len() as u32)
        }
        _ => return None,
    })
}

/// Returns how many bytes oxc's lexer consumes after a backslash in an identifier, where `rest` is the text after the
/// backslash, and the decoded character if the escape is well-formed.
fn escape_after_backslash(rest: &[u8]) -> (usize, Option<char>) {
    let digits = |from: usize, most: usize| {
        let all = rest.get(from..).unwrap_or_default().iter();
        all.take(most)
            .take_while(|it| it.is_ascii_hexdigit())
            .count()
    };
    let value = |from: usize, len: usize| {
        let digits = rest.get(from..from + len).unwrap_or_default().iter();
        digits.fold(0u32, |it, digit| {
            let digit = (*digit as char).to_digit(16).unwrap_or_default();
            it.saturating_mul(16).saturating_add(digit)
        })
    };
    match rest {
        [b'u', b'{', ..] => {
            let len = digits(2, usize::MAX);
            let is_closed = len > 0 && rest.get(2 + len) == Some(&b'}');
            match char::from_u32(value(2, len)).filter(|_| is_closed) {
                Some(it) => (3 + len, Some(it)),
                None => (2 + len, None),
            }
        }
        [b'u', ..] => {
            let len = digits(1, 4);
            (1 + len, char::from_u32(value(1, len)).filter(|_| len == 4))
        }
        _ => {
            let first = rest.utf8_chunks().next();
            let first = first.and_then(|it| it.valid().chars().next());
            (first.map_or(1, char::len_utf8).min(rest.len()), None)
        }
    }
}

fn is_in_ascii_name(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')
}

/// The offset where oxc's lexer ends the identifier that `at` is inside or at the end of. Any escape counts as part of
/// it, even a malformed one.
fn end_of_name(text: &[u8], mut at: u32) -> u32 {
    loop {
        match text.get(at as usize) {
            Some(byte) if is_in_ascii_name(*byte) => at += 1,
            Some(b'\\') => {
                let rest = text.get(at as usize + 1..).unwrap_or_default();
                at += 1 + escape_after_backslash(rest).0 as u32;
            }
            _ => return at,
        }
    }
}

/// oxc's errors for the backslash at `at`, which is in an identifier or where one can start, and isn't a valid
/// identifier escape. oxc's lexer recovers, so its error is printed first. TypeScript's parser doesn't recover.
#[optimize(size)]
fn escape_in_name<'a>(file: &'a File<'a>, at: u32) -> Vec<SyntaxError> {
    let text = file.text();
    let rest = text.get(at as usize + 1..).unwrap_or_default();
    let (read, character) = escape_after_backslash(rest);
    let (start, end) = (at + 1, at + 1 + read as u32);
    let before = text.get(..at as usize).unwrap_or_default().iter().rev();
    let first = at - before.take_while(|it| is_in_ascii_name(**it)).count() as u32;
    let hash = first
        .checked_sub(1)
        .filter(|it| text.get(*it as usize) == Some(&b'#'));
    // In operand position a private name must be followed by `in`. If it isn't, that's the only error oxc keeps.
    if let Some(hash) = hash
        && is_in_operand_position(file, hash)
        && let Some(error) = private_name_as_operand(file, Span::new(hash, end))
    {
        return vec![error];
    }
    if let Some(character) = character.filter(|_| hash.is_none()) {
        let message = format!("Invalid Character `{character}`");
        return vec![SyntaxError::oxc_error(Span::empty(end), message).stage(Stage::Fatal)];
    }
    let escape = SyntaxError::oxc_error(Span::new(start, end), "Invalid Unicode escape sequence");
    let mut all = vec![escape.stage(Stage::Parser).noticed_at(0)];
    // The following characters continue the identifier, which leaves the `}`.
    let after = end_of_name(text, end);
    if rest.starts_with(b"u{") && text.get(after as usize) == Some(&b'}') {
        let brace = Span::new(after, after + 1);
        all.push(SyntaxError::oxc_error(brace, "Unexpected token").stage(Stage::Fatal));
    }
    // The parser sees an identifier there. An operand before or after it on the same line is a separate statement.
    let semicolon = SyntaxError::semicolon_after;
    let is_on_one_line =
        |between: Span| !bun_core::strings::contains_js_line_break(file.slice(between));
    let is_operand = |it: &[u8]| match it {
        [b')' | b']'] | [b'0'..=b'9' | b'"' | b'\'' | b'`', ..] => true,
        _ => name_of_token(it) == "Identifier",
    };
    let name = Span::new(hash.unwrap_or(first), after);
    if let Some(previous) = file.token_before(Span::empty(name.start))
        && is_operand(previous.text())
        && is_on_one_line(previous.span().between(name))
    {
        all.push(semicolon(previous.span().end));
    }
    let next = next_token(text, after);
    if is_operand(file.slice(next))
        && !matches!(file.slice(next), b")" | b"]")
        && is_on_one_line(name.between(next))
    {
        all.push(semicolon(after));
    }
    all
}

/// True if the private name starting at `hash` is neither a member access (`a.#b`) nor the name of a class member.
fn is_in_operand_position<'a>(file: &'a File<'a>, hash: u32) -> bool {
    let previous = file.token_before(Span::empty(hash));
    let previous = previous.map_or(&b""[..], |it| it.text());
    let starts_member = matches!(previous, b"{" | b";" | b"}" | b"*")
        || previous.first().is_some_and(|it| is_in_ascii_name(*it));
    let is_in_class_body = || {
        let open = opener(file, hash, (b'{', b'}'));
        open.is_some_and(|open| file.classes().any(|it| it.body_span().start == open.start))
    };
    !matches!(previous, b"." | b"?.") && !(starts_member && is_in_class_body())
}

/// `<a><b></a></b>`: TypeScript's parser lets `</a>` close the `a` and reports the `b` as unclosed. In oxc's parser
/// each closing tag closes the innermost open element. Returns `None` if we don't know how oxc continues after the
/// first error.
#[optimize(size)]
fn crossed_closing_tags<'a>(file: &'a File<'a>, it: &Diagnostic) -> Option<Vec<SyntaxError>> {
    let (hir, text) = (&file.hir, file.text());
    let name_of = |id: bun_sema::hir::ExprId| {
        let name = hir.exprs.get(id.idx())?;
        Some(Span::new(name.pos, name.end))
    };
    let mismatch = |closing: Span, opening: Span| wrong_closing_tag(file, closing, opening);
    let inner =
        (hir.jsx.iter()).find(|jsx| name_of(jsx.tag).is_some_and(|tag| tag.start == it.start))?;
    // The enclosing element, which TypeScript's parser closes with that tag.
    let outer = hir
        .jsx
        .iter()
        .find(|jsx| jsx.close_pos == inner.close_pos && jsx.end > inner.end)?;
    let next = skip_trivia(text, outer.end);
    if !text.get(inner.close_pos as usize..)?.starts_with(b"</")
        || !text.get(next as usize..)?.starts_with(b"</")
    {
        return None;
    }
    let (first, second) = (
        next_token(text, inner.close_pos + 2),
        next_token(text, next + 2),
    );
    let opening = name_of(outer.tag)?;
    if file.slice(second) == file.slice(opening) {
        return None;
    }
    Some(vec![
        mismatch(first, name_of(inner.tag)?).stage(Stage::Parser),
        mismatch(second, opening).stage(Stage::Fatal),
    ])
}

/// Translates an error from TypeScript's parser into oxc's wording. Returns an empty list if oxc's wording isn't known.
/// For some errors oxc reports two.
#[optimize(size)]
pub(super) fn translate_typescript_error<'a>(
    file: &'a File<'a>,
    it: &Diagnostic,
) -> Vec<SyntaxError> {
    let rest = file.text().get(it.start as usize..).unwrap_or_default();
    let label = Span::new(
        it.start,
        match it.end {
            Diagnostic::NO_LENGTH => it.start,
            0 => it.start + token_len(rest) as u32,
            end => end,
        },
    );
    // The lexer reads to the end of the line, and the parser can't continue with the token it gets for the rest.
    if it.code == 1161 {
        let line = Span::new(it.start, end_of_line(file.text(), it.start));
        let rest = Span::new(it.start, file.text().len() as u32);
        let lexer_error = SyntaxError::oxc_error(line, "Unterminated regular expression");
        let parser_error = SyntaxError::oxc_error(rest, "Unexpected token").stage(Stage::Fatal);
        return match unterminated_regex_context(file, it.start) {
            RegexContext::Nothing => {
                vec![lexer_error.stage(Stage::Parser).noticed_at(0), parser_error]
            }
            RegexContext::Brackets => vec![lexer_error.stage(Stage::Fatal)],
            RegexContext::Head => vec![parser_error],
        };
    }
    // The diagnostic is at a backslash, or at the `#` before one.
    let text = file.text();
    let backslash = [it.start, it.start + 1].into_iter().find(|at| {
        text.get(*at as usize) == Some(&b'\\')
            && (*at == it.start || text.get(it.start as usize) == Some(&b'#'))
    });
    if it.code == 1127
        && let Some(backslash) = backslash
    {
        return escape_in_name(file, backslash);
    }
    if it.code == 17008
        && let Some(both) = crossed_closing_tags(file, it)
    {
        return both;
    }
    let one = translate_scanner_error(file, it, label)
        .or_else(|| translate_parser_error(file, it, label));
    one.into_iter().collect()
}

/// Translates an error from TypeScript's parser into oxc's wording. oxc's parser gives up there unless the error has a
/// different stage. Returns `None` if oxc's wording isn't known.
#[optimize(size)]
fn translate_parser_error<'a>(
    file: &'a File<'a>,
    it: &Diagnostic,
    label: Span,
) -> Option<SyntaxError> {
    let semicolon = SyntaxError::semicolon_after;
    let before = |at: Span| file.token_before(at).map_or(&b""[..], |it| it.text());
    let args: SmallVec<[&[u8]; 3]> = it.args.iter().map(|it| &**it).collect();
    let text = |it: &[u8]| bstr::BStr::new(it).to_string();
    if let Some(error) = translate_jsx_error(file, it, label) {
        return Some(match error.oxc_details.stage {
            Stage::Semantic => error.stage(Stage::Fatal),
            _ => error,
        });
    }
    if let Some(error) = translate_by_shape(file, it, label) {
        return Some(error.stage(Stage::Fatal));
    }
    let error = match (it.code, &args[..]) {
        (1005, [b";", found]) => {
            let head = opener(file, it.start, (b'(', b')')).filter(|it| before(*it) == b"for");
            match head {
                Some(_) => SyntaxError::expected(label, "`;`", found),
                None => semicolon(file.end_of_token_before(it.start)),
            }
        }
        // At the start of a statement `let` begins a declaration unless an operator follows, so oxc expects a name. As
        // the body of another statement, `let` is an identifier.
        (1434 | 1440, _)
            if file.slice(label) == b"let"
                && !matches!(before(label), b")" | b"else" | b"do")
                && file.hir.stmts.iter().any(|it| it.start == label.start) =>
        {
            SyntaxError::oxc_error(token_after(file, label), "Unexpected token")
        }
        (1131 | 1434 | 1440, _) => semicolon(label.end),
        (1209, _) => SyntaxError::oxc_error(label, "Invalid optional chain from new expression."),
        // oxc still treats the word as the keyword.
        (1260, _) => {
            let error = SyntaxError::oxc_error(label, "Keywords cannot contain escape characters");
            return Some(error.stage(Stage::Parser));
        }
        (1109, _) if file.slice(label) == b"<!--" => {
            SyntaxError::oxc_error(label, "HTML comments are not allowed in modules")
        }
        (1359, _) if matches!(before(label), b"function" | b"*") => {
            expected(file, "Identifier", label)
        }
        (1181 | 1390, _) if RESERVED.binary_search(&file.slice(label)).is_ok() => {
            reserved_word(label, file.slice(label))
        }
        (1389, [word]) => reserved_word(label, word),
        (1034, _) => {
            let keyword = file.token_before(label).map_or(label, |it| it.span());
            let message = "'super' can only be used with function calls or in property accesses";
            return Some(
                SyntaxError::oxc_error(keyword, message)
                    .help("Replace with `super()` or `super.prop` or `super[prop]`")
                    .stage(Stage::Parser),
            );
        }
        (17006, [operator]) => {
            let message = format!(
                "A unary expression with the '{}' operator cannot be used as the left operand of an exponentiation expression",
                text(operator)
            );
            return Some(
                SyntaxError::oxc_error(label, message)
                    .help("Wrap the unary expression in parentheses to make the precedence explicit")
                    .stage(Stage::Parser),
            );
        }
        (1144, _) => semicolon(file.end_of_token_before(it.start)),
        (1005, [b"try" | b"export", ..]) => SyntaxError::oxc_error(label, "Unexpected token"),
        (1351, _) => {
            let first = Span::new(label.start, label.start + 1);
            SyntaxError::oxc_error(first, "Invalid characters after number")
        }
        (1130, _) => SyntaxError::oxc_error(label, "Expected switch clause")
            .label_text("`case` or `default` clause expected here")
            .help("If this is intended to be the condition for the switch statement, add `case` before it."),
        (1472, _) => {
            let after = file.end_of_token_before(it.start);
            return Some(
                SyntaxError::oxc_error(Span::new(after, after), "Missing catch or finally clause")
                    .help("Either unwrap this try block or add catch / finally clause")
                    .stage(Stage::Parser),
            );
        }
        // oxc continues with the parameters.
        (1003, _) if matches!(before(label), b"function" | b"*") && file.slice(label) == b"(" => {
            let help = "Function name is required in function declaration or named export";
            let error = SyntaxError::oxc_error(label, "Expected function name").help(help);
            return Some(error.stage(Stage::Parser));
        }
        (1003, _) if matches!(before(label), b"function" | b"*") => expected(file, "(", label),
        (1003, _) if before(label) == b"?." => {
            let chain = file.token_before(label).map_or(label, |it| it.span());
            SyntaxError::oxc_error(chain, "Identifier expected after '?.'")
                .help("Add an identifier after '?.'")
        }
        (1128, _) if file.slice(label) == b"export" => {
            // In TypeScript, oxc consumes each modifier that's followed by a word (on the same line, except after
            // `static`) and then expects a declaration.
            let is_before_word = |it: Span| {
                let next = token_after(file, it);
                let between = file.slice(it.between(next));
                file.slice(next).first().is_some_and(|it| is_in_ascii_name(*it))
                    && (file.slice(it) == b"static"
                        || !bun_core::strings::contains_js_line_break(between))
            };
            let mut next = token_after(file, label);
            while !file.is_javascript() && is_modifier(file.slice(next)) && is_before_word(next) {
                next = token_after(file, next);
            }
            SyntaxError::oxc_error(next, "Unexpected token")
        }
        (1005, [expected, found, ..]) => {
            let pair = match *args.get(2).unwrap_or(expected) {
                b")" => Some((b'(', b')')),
                b"]" => Some((b'[', b']')),
                b"}" => Some((b'{', b'}')),
                b">" => Some((b'<', b'>')),
                _ => None,
            };
            let opened = pair.and_then(|it| opener(file, label.start, it));
            // After a list element oxc also accepts a comma.
            let is_list = args.len() == 3
                || *found != b"EOF"
                    && match (*expected, opened.map(before)) {
                        (b")", Some(b"await")) => {
                            let keyword = opened.and_then(|it| file.token_before(it));
                            keyword.is_none_or(|it| before(it.span()) != b"for")
                        }
                        (b")", Some(word)) => !matches!(
                            word,
                            b"if" | b"while" | b"for" | b"switch" | b"with" | b"catch"
                        ),
                        (b">", Some(word)) => word.first().is_some_and(u8::is_ascii_alphanumeric),
                        _ => false,
                    };
            let wanted = match (is_list, pair) {
                (true, Some((_, close))) => format!("`,` or `{}`", close as char),
                _ => format!("`{}`", text(expected)),
            };
            let error = SyntaxError::expected(label, &wanted, found);
            // `import(a b)`
            if let Some(import) = opened.and_then(|it| file.token_before(it))
                && import.text() == b"import"
                && *found != b"EOF"
            {
                let end = file.token_before(label).map_or(label.start, |it| it.span().end);
                let message = "Dynamic imports can only accept a module specifier and an optional set of attributes as arguments";
                let call = Span::new(import.span().start, end);
                return Some(SyntaxError::oxc_error(call, message).stage(Stage::Fatal));
            }
            let has_opener = match *found {
                b"EOF" => *expected == b"}" && opened.is_some_and(|it| labels_opener_at_eof(file, it)),
                _ if *expected == b")" => opened.is_some_and(|it| before(it) != b"catch"),
                _ => is_list || !it.related.is_empty(),
            };
            // Sort it by its own position, not by the other label's.
            let error = error.noticed_at(label.start);
            match opened.filter(|_| has_opener) {
                Some(opened) => error.and(opened, "Opened here"),
                None if *expected == b":" => match question_mark(file, label.start) {
                    Some(question) => error.and(question, "Conditional starts here"),
                    None => error,
                },
                None => error,
            }
        }
        (1003 | 1109 | 1110 | 1128 | 1134 | 1137 | 1138 | 1145 | 1478 | 18029, _)
            if label.end > label.start =>
        {
            SyntaxError::oxc_error(label, "Unexpected token")
        }
        _ => return None,
    };
    Some(error.stage(Stage::Fatal))
}

/// Import attributes: `with { .. }` after the specifier of an import or export. The values must be strings, and keys
/// must be unique.
fn module_attributes<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let text = file.text();
    let mut all = Vec::new();
    for &(keyword, _) in file.hir.import_attributes.iter() {
        // In an import type, `with` is a property name and any value is accepted.
        let after_keyword = skip_trivia(text, next_token(text, keyword).end);
        let clause = ImportAttributes::within(file, Span::new(keyword, keyword + 1));
        let Some(clause) = clause.filter(|_| text.get(after_keyword as usize) == Some(&b'{'))
        else {
            continue;
        };
        let mut seen: SmallVec<[(Name, Span); 2]> = SmallVec::new();
        for entry in clause.entries().iter() {
            let key = next_token(text, entry.span().start);
            let value = entry.value().map(|it| it.outer_span());
            if let Some(value) = value.filter(|it| !it.is_empty())
                && !matches!(text.get(value.start as usize), Some(b'"' | b'\''))
            {
                let message = "Only string literals are allowed as module attribute values.";
                let error = SyntaxError::oxc_error(next_token(text, value.start), message);
                all.push(error.help("Wrap this with quotes").stage(Stage::Fatal));
            } else if let Some(after) = value
                .map(|it| (it, next_token(text, next_token(text, it.start).end)))
                .and_then(|(value, after)| (after.start < value.end).then_some(after))
            {
                // oxc reads one string token and nothing more.
                let found = name_of_token(file.slice(after));
                let error = SyntaxError::expected(after, "`,` or `}`", found.as_bytes())
                    .and(Span::new(after_keyword, after_keyword + 1), "Opened here")
                    .noticed_at(after.start);
                all.push(error.stage(Stage::Fatal));
            }
            let Some(KeyKind::Ident(name) | KeyKind::String(name)) =
                entry.key().map(|it| it.kind())
            else {
                continue;
            };
            // oxc compares it with the previous occurrence, after it has read the value.
            match seen.iter_mut().find(|it| it.0 == name) {
                Some(before) => {
                    let error = SyntaxError::redeclared("Identifier", name.bytes(), before.1, key);
                    all.push(error.noticed_at(entry.span().end).stage(Stage::Parser));
                    before.1 = key;
                }
                None => seen.push((name, key)),
            }
        }
    }
    all
}

/// The statements that oxc's parser parses twice.
///
/// oxc parses a file that could be a script or a module as a script until it reaches module-only syntax. Until then
/// `await` is an identifier, unless a word or a literal follows on the same line. If the file turns out to be a module,
/// oxc goes back at the end and reparses each statement where `await` was a reference, this time with `await` as the
/// operator.
fn reparsed_statements<'a>(file: &'a File<'a>) -> Vec<Span> {
    if !can_be_script_or_module(file) || !has_module_syntax(file) {
        return Vec::new();
    }
    let text = file.text();
    let is_before_operand = |keyword: u32| {
        let next = skip_trivia(text, keyword + 5);
        let rest = text.get(next as usize..).unwrap_or_default();
        let starts_operand = match rest.first() {
            Some(b'"' | b'\'' | b'0'..=b'9') => true,
            Some(b'.') => rest.get(1).is_some_and(u8::is_ascii_digit),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80..) => {
                !matches!(&rest[..token_len(rest)], b"in" | b"instanceof" | b"of")
            }
            _ => false,
        };
        let between = file.slice(Span::new(keyword + 5, next));
        starts_operand && !bun_core::strings::contains_js_line_break(between)
    };
    let is_shorthand =
        |it: Node<'a>| matches!(it, Node::Prop(it) if it.kind() == PropKind::Shorthand);
    // Offsets where `await` is first parsed as a reference, and offsets of syntax that makes the file a module.
    let (mut references, mut marks) = (Vec::new(), Vec::new());
    for (i, raw) in file.hir.exprs.iter().enumerate() {
        let is_await = match raw.kind {
            ExprKind::Ident(name) => name == known::r#await,
            ExprKind::Await(_) | ExprKind::ImportMeta => true,
            _ => false,
        };
        if !is_await || file.expr_in_tree(i).is_none() {
            continue;
        }
        let node = Node::Expr(Expr::from_raw(file, i as u32));
        match raw.kind {
            ExprKind::ImportMeta => marks.push(raw.pos),
            ExprKind::Await(_) if node.enclosing_function().is_some() => {}
            ExprKind::Await(_) if is_before_operand(raw.pos) => marks.push(raw.pos),
            ExprKind::Await(_) => references.push(raw.pos),
            // The `await` in `{ await }` and `{ await = 1 }` isn't a reference.
            _ => match node.parent() {
                Node::Expr(default) if default.tag() == ExprTag::Assign => {
                    if !is_shorthand(Node::Expr(default).parent()) {
                        references.push(raw.pos);
                    }
                }
                // `typeof await`
                Node::Type(_) => {}
                parent if is_shorthand(parent) => {}
                _ => references.push(raw.pos),
            },
        }
    }
    let mut reparsed = Vec::new();
    for it in file.body() {
        let is_module_statement = matches!(
            it.tag(),
            StmtTag::Import
                | StmtTag::ExportNamed
                | StmtTag::ExportStar
                | StmtTag::ExportDefault
                | StmtTag::ExportAssign
                | StmtTag::ExportAsNamespace
        );
        if is_module_statement || it.is_exported() {
            break;
        }
        let span = it.span();
        if references.iter().any(|at| span.contains_offset(*at))
            || second_readings(file).any(|it| it.start == span.start)
        {
            reparsed.push(span);
        }
        let first = it.as_var().and_then(|it| it.first());
        if marks.iter().any(|at| span.contains_offset(*at))
            || first.is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
        {
            break;
        }
    }
    reparsed
}

/// The statements that parse with `await` as an identifier but not with `await` as the operator.
fn second_readings<'a>(file: &'a File<'a>) -> impl Iterator<Item = &'a Diagnostic> + Clone {
    let all = file.hir.diagnostics.iter();
    all.filter(|it| it.kind == DiagnosticKind::OxcSecondReading)
}

/// oxc's errors for a statement that it reparses. `errors` are our parser's errors from the reparse.
#[optimize(size)]
fn second_reading<'a>(file: &'a File<'a>, errors: &[Diagnostic]) -> Vec<SyntaxError> {
    let (mut translated, stop) = super::to_oxc_errors(file, errors);
    // A diagnostic the parser recorded in oxc's wording comes before the TypeScript parser error for the same problem.
    let before = errors.get(..stop.map_or(errors.len(), |it| it.0));
    let mut recorded_fatal = before.unwrap_or_default().iter();
    let recorded_fatal = recorded_fatal.find(|it| it.kind == DiagnosticKind::OxcFatal);
    if let Some(recorded_fatal) =
        recorded_fatal.and_then(|it| oxc_typescript::decode_recorded_error(file, it))
    {
        translated.pop();
        translated.push(recorded_fatal);
    }
    translated
}

fn is_discardable(it: &SyntaxError) -> bool {
    it.oxc_details.stage == Stage::Parser && !matches!(it.order(), 0 | u32::MAX)
}

/// When oxc's parser goes back to a statement ([`reparsed_statements`]), it discards the errors it has reported since
/// it first reached that statement. It keeps its lexer's errors and the ones it reports at the end of the file. `all`
/// must be in oxc's order.
fn discard_errors_like_oxc<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    if all.iter().any(is_discardable) || second_readings(file).next().is_some() {
        reparse_like_oxc(file, all);
    }
}

#[cold]
#[optimize(size)]
fn reparse_like_oxc<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    let reparsed = reparsed_statements(file);
    let Some(first) = reparsed.first().map(|it| it.start) else {
        return;
    };
    // oxc doesn't go back after a fatal error.
    if all.iter().any(|it| it.oxc_details.stage == Stage::Fatal) {
        return;
    }
    const AWAIT: &[u8] = b"Cannot use `await` as an identifier in an async context";
    const YIELD: &[u8] = b"Cannot use `yield` as an identifier in a generator context";
    let mut retained = Vec::new();
    // If oxc gives up during a reparse, it still reparses the next statement, and discards that fatal error with the
    // others. Its tree then has nothing for the failed statement.
    let (mut last_reparse_errors, mut failed_reparses) = (Vec::new(), Vec::new());
    for span in &reparsed {
        // oxc truncates the error list to the length it had when it first reached the statement.
        let is_from_first_reading = |it: &&SyntaxError| {
            is_discardable(it) && it.message != AWAIT && (first..span.start).contains(&it.at)
        };
        retained.truncate(all.iter().filter(is_from_first_reading).count());
        let second = second_readings(file).find(|it| it.start == span.start);
        last_reparse_errors = second.map_or_else(Vec::new, |it| second_reading(file, &it.related));
        let read_to = match (second, last_reparse_errors.last()) {
            (Some(_), Some(last)) => {
                failed_reparses.push(*span);
                last.at
            }
            _ => span.end,
        };
        // oxc reports only once that statements aren't allowed in a declaration file.
        let is_repeated = |it: &SyntaxError| {
            is_discardable(it)
                && (span.start..read_to).contains(&it.at)
                && (it.oxc_details.code != 1036 || it.at != span.start)
                && (second.is_none() || it.message != AWAIT)
        };
        let inside = all.iter().enumerate().filter(|it| is_repeated(it.1));
        retained.extend(inside.map(|it| it.0));
    }
    let mut index = 0;
    all.retain_mut(|it| {
        index += 1;
        if retained.contains(&(index - 1)) {
            return true;
        }
        if failed_reparses
            .iter()
            .any(|span| span.contains_offset(it.at))
        {
            return matches!(it.order(), 0 | u32::MAX) && it.oxc_details.stage == Stage::Parser;
        }
        if !is_discardable(it) || it.at < first {
            return true;
        }
        // The semantic pass also reports these, with a different message.
        let word = match &it.message[..] {
            AWAIT => "await",
            YIELD => "yield",
            _ => return false,
        };
        let label = Span::new(it.at, it.end);
        *it = SyntaxError::oxc_error(label, ["The keyword '", word, "' is reserved"].concat());
        true
    });
    if !last_reparse_errors.is_empty() {
        all.append(&mut last_reparse_errors);
        crate::utils::sort::sort_by_key(all, SyntaxError::order);
    }
}

/// The errors oxlint rejects a file for, in the order it prints them.
///
/// - `typescript_errors`: the errors from TypeScript's parser, in oxc's wording.
/// - `is_oxfmt`: return the errors oxfmt rejects the file for instead. oxfmt only runs oxc's parser, and doesn't have
///   it parse regular expressions. Such a file has no symbols.
/// - `stop`: the index in the file's diagnostics of the one where oxc's parser gives up. Diagnostics are in the order
///   our parser found them, and oxc's parser never reaches the code behind the later ones.
///
/// Each check may return its errors in any order.
pub(super) fn errors<'a>(
    file: &'a File<'a>,
    typescript_errors: Vec<SyntaxError>,
    stop: Option<usize>,
    is_oxfmt: bool,
) -> Vec<SyntaxError> {
    // If TypeScript's parser has an error, the tree has holes. oxc's parser has an error too, so the semantic pass's
    // errors aren't printed. We don't compute them, and never use the scopes of such a tree.
    let has_holes = !typescript_errors.is_empty();
    let is_whole = !has_holes && !is_oxfmt;
    // A diagnostic the parser recorded in oxc's wording comes before a TypeScript parser error at the same offset.
    let mut all = match has_holes {
        true => oxc_typescript::recorded_errors(file, stop),
        false => oxc_typescript::errors(file, !is_oxfmt),
    };
    all.extend(typescript_errors);
    all.extend(module_attributes(file));
    // JavaScript has no `declare`.
    if !file.is_javascript() {
        all.extend(declare_in_ambient_context(file));
    }
    if is_whole {
        all.extend(class_without_name(file));
    }
    match file.path() {
        [.., b'.', b'c', b'j', b's'] => all.extend(espree::module_syntax_in_commonjs(file, false)),
        [.., b'.', b'c', b't', b's'] => all.extend(espree::module_syntax_in_commonjs(file, true)),
        _ => {}
    }
    let recorded = file.hir.diagnostics;
    let recorded = stop
        .and_then(|stop| recorded.get(..=stop))
        .unwrap_or(recorded);
    all.extend(misplaced_await_and_yield(file, recorded));
    all.extend(import_phase_without_call(file, recorded));
    all.extend(espree::oxc_errors(file, !is_whole, is_oxfmt));
    all.extend(targets::errors(file));
    // oxc reports the first four after it has finished the file, in this order.
    if is_whole {
        all.extend(names::class_members(file));
        all.extend(names::exports(file));
        all.extend(names::redeclarations(file));
        all.extend(espree::export_assignment_with_other_exports(file));
        all.extend(espree::using_in_script(file));
        all.extend(espree::with_in_strict_code(file));
        all.extend(duplicate_parameters(file));
    }
    // The parser doesn't set the `ODD_EXPORT` bit for a file it fails on.
    if has_holes || is_oxfmt && file.has_rare_syntax(rare::ODD_EXPORT) {
        all.extend(names::duplicate_exports(file));
    }
    all.extend(deferred_imports(file));
    all.extend(espree::for_await_outside_async(file));
    all.extend(keywords::errors(file));
    all.extend(declarations_without_initializer(
        file,
        !file.is_javascript(),
    ));
    all.extend(declaration_list(file));
    // The sort is stable, so errors with the same key stay in the order of the checks above.
    crate::utils::sort::sort_by_key(&mut all, SyntaxError::order);
    discard_errors_like_oxc(file, &mut all);
    if !is_whole || all.iter().any(|it| it.oxc_details.stage != Stage::Semantic) {
        all.retain(|it| it.oxc_details.stage != Stage::Semantic);
    }
    all.dedup_by(|a, b| a.at == b.at && a.order() == b.order() && a.message == b.message);
    if let Some(fatal) = all
        .iter()
        .position(|it| it.oxc_details.stage == Stage::Fatal)
    {
        // How far the parser has read. If it's missing a token, it has already lexed the next one, which may have a
        // lexer error.
        let read = match all[fatal].end {
            Diagnostic::NO_LENGTH | 0 => {
                let next = skip_trivia(file.text(), all[fatal].order());
                end_of_name(file.text(), next)
            }
            end => all[fatal].order().max(end),
        };
        // oxc still reports its end-of-file errors, but only for code it has read.
        let mut at = 0;
        all.retain(|it| {
            at += 1;
            at == fatal + 1 || it.at < read && (at <= fatal || it.order() == u32::MAX)
        });
    }
    all
}
