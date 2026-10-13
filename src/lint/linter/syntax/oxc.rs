//! What oxlint and oxfmt refuse. Their parser, OXC's, and the pass that builds its scopes report what ECMAScript calls early
//! errors, and much of what TypeScript's checker reports as an error of the grammar. TypeScript's parser, which has parsed the
//! file here, leaves all of that to the checker.
//!
//! The oracle: real files, ended after a token or with a token taken out, through both tools.
//!
//! All of this runs on every file, and nearly no file has such an error. So nothing here walks the expressions of a file in
//! which no cheap sign says that there is something to find, or asks for them by kind.

mod keywords;
mod names;
mod targets;

use super::{Stage, SyntaxError, espree, oxc_typescript};
use crate::ast::{
    Class, File, FnBody, Func, Handle, ImportAttributes, KeyKind, Name, Node, Param, Pat, Stmt,
    StmtTag,
};
use crate::span::Span;
use crate::tokens::{next_token, skip_trivia, token_len};
use bun_sema::atom::Atom;
use bun_sema::bind::{ClassOwner, Parent};
use bun_sema::hir::{
    Diagnostic, DiagnosticKind, Flags, FnKind, Modifier, ModifierKind, ParamId, PatKind, StmtId,
    StmtKind, VarDecl, VarKind, rare,
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

/// Each `await` outside an async function and each `yield` outside a generator. The parser notes them for OXC, whose parser
/// reports them.
fn misplaced_suspensions<'a>(file: &'a File<'a>, noted: &[Diagnostic]) -> Vec<SyntaxError> {
    let hir = &file.hir;
    if noted.is_empty() {
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
    let can_be_module = crate::utils::oxlint::is_either(file);
    let is_await = |it: &Diagnostic| it.kind == DiagnosticKind::Grammar && it.code == 1308;
    // Of `await await a` only the first is reported.
    let follows_one = |at: u32| {
        let before = file.token_before(Span::empty(at)).map(|it| it.span().start);
        before.is_some_and(|before| noted.iter().any(|it| is_await(it) && it.start == before))
    };
    let misplaced = noted.iter().filter(|it| {
        it.kind == DiagnosticKind::Grammar
            && match it.code {
                1163 => true,
                1308 => (!can_be_module || is_in_body(it.start)) && !follows_one(it.start),
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

/// The statement in whose head the list of declarations `statement` is: a `for`, a `for-in` or a `for-of`.
pub(super) fn loop_with_head<'a>(file: &'a File<'a>, statement: usize) -> Option<StmtKind> {
    let Some(&Parent::Stmt(parent)) = file.bound.stmt_parent.get(statement) else {
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

/// `const` and nothing behind it. `let a,;`. `for (const a, b of c)`.
fn declaration_list<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_DECLARATION) {
        return Vec::new();
    }
    let text = file.text();
    let unexpected = |at: Span| SyntaxError::of_oxc(at, "Unexpected token").stage(Stage::Fatal);
    let incomplete = file.stmts_of_kind(StmtTag::Var).filter_map(|it| {
        let raw = it.try_raw()?;
        let StmtKind::Var(list) = raw.kind else {
            return None;
        };
        let Some(last) = file.hir.var_decls.get(list.range())?.last() else {
            let keyword = token_len(text.get(raw.start as usize..)?) as u32;
            let is_head = loop_with_head(file, it.id().idx()).is_some();
            return (!is_head).then(|| unexpected(next_token(text, raw.start + keyword)));
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
                SyntaxError::of_oxc(Span::new(left.start, left.loc.end), message)
                    .stage(Stage::Parser)
            })
        })
    });
    incomplete.chain(in_heads).collect()
}

/// `class {}` as a statement, if it is not `export default class {}`.
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
            let start = Class::from_raw(file, i as u32).span().start;
            let keyword = Span::new(start, start + "class".len() as u32);
            SyntaxError::of_oxc(keyword, "A class name is required.")
        })
        .collect()
}

/// `const a`, `using a`, `let [a]`, where nothing else gives it a value and it is not only declared.
/// `are_patterns_noted`: the parser has the error about `let [a]`. It does in TypeScript, in oxc's dialect.
fn declarations_without_initializer<'a>(
    file: &'a File<'a>,
    are_patterns_noted: bool,
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
    let lacking = hir.var_decls.iter().enumerate().filter(|(i, it)| {
        it.init.is_none()
            && (!matches!(it.kind, VarKind::Var | VarKind::Let) || is_pattern(it))
            && !it.flags.contains(Flags::AMBIENT)
            && !(are_patterns_noted && is_pattern(it))
            && !file.is_in_jsdoc(it.loc.end)
            // Not the parameter of a `catch`, whose statement is the `try`.
            && (bound.var_stmt.get(*i)).is_some_and(|list| is_list(*list) && !is_in_loop_head(*list))
    });
    let is_in_head = |statement: StmtId| loop_with_head(file, statement.idx()).is_some();
    lacking
        .filter_map(|(i, it)| Some((bound.var_stmt.get(i)?, it)))
        .map(|(list, it)| {
            let message = match it.kind {
                VarKind::Using | VarKind::AwaitUsing => {
                    "Using declarations must have an initializer."
                }
                _ if is_pattern(it) => "Missing initializer in destructuring declaration",
                _ => "Missing initializer in const declaration",
            };
            let error = SyntaxError::of_oxc(Pat::new(file, it.pat).span(), message)
                .help("Add an initializer (e.g. ` = undefined`) here")
                .stage(Stage::Parser);
            // It has read all of a pattern then, and in the head of a `for` it is at the `;`.
            match is_pattern(it) || is_in_head(*list) {
                true => error.noticed_at(skip_trivia(file.text(), it.loc.end)),
                false => error,
            }
        })
        .collect()
}

/// A name that two parameters of a function or of a signature bind. Only a function that is a declaration or an expression can
/// have that, where the code is not strict, if each of its parameters is a name and nothing else. The error is at the first.
fn duplicate_parameters<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    // Nearly no file has such a list, or one with a pattern in it.
    let mut all = Vec::new();
    if !file.may_bind_a_parameter_twice() {
        return all;
    }
    let mut names: SmallVec<[(Atom, u32); 8]> = SmallVec::new();
    for (i, raw) in hir.fns.iter().enumerate() {
        // One parameter binds a name twice only in a pattern, which is not looked for.
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
        // Those of one name are side by side, in the order of the text. Each but the first is an error, with the first.
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
            let message = [b"Identifier `", name, b"` has already been declared"].concat();
            let here = format!("`{}` has already been declared here", bstr::BStr::new(name));
            all.push(
                SyntaxError::of_oxc(Span::new(at, at + len), message)
                    .says(here)
                    .and(
                        Span::new(again, again + len),
                        "It can not be redeclared here",
                    ),
            );
        }
    }
    all
}

/// `declare` at the head of a statement in what is ambient already: somewhere in a `declare namespace`, a `declare module`,
/// `declare global`, a `declare function` or a namespace of a declaration file, or in a function of a declaration file. After
/// `export` OXC takes it.
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
    let declared = hir.stmts.iter().enumerate().filter_map(|(i, raw)| {
        let first = hir.modifiers.get(raw.modifiers.range())?.first()?;
        let is_in_tree = !matches!(file.bound.stmt_parent.get(i), None | Some(Parent::None));
        let statement = Node::Stmt(Stmt::from_raw(file, i as u32));
        (is_keyword(first, Flags::AMBIENT) && is_in_tree && statement.ancestors().any(is_ambient))
            .then_some(first.pos)
    });
    declared
        .map(|at| {
            let keyword = Span::new(at, at + "declare".len() as u32);
            let message = "A 'declare' modifier cannot be used in an already ambient context.";
            SyntaxError::of_oxc(keyword, message)
                .code(1038)
                .stage(Stage::Parser)
        })
        .collect()
}

/// `import.defer` that is not called. TypeScript's parser notes it for the checker, after the word.
fn phases_without_call<'a>(file: &'a File<'a>, noted: &[Diagnostic]) -> Vec<SyntaxError> {
    let is_one = |it: &&Diagnostic| {
        it.kind == DiagnosticKind::Grammar
            && it.code == 1005
            && it.args.first().is_some_and(|it| **it == *b"(")
    };
    (noted.iter().filter(is_one))
        .map(|it| expected(file, "(", token_after(file, Span::empty(it.start))).stage(Stage::Fatal))
        .collect()
}

/// `import defer a from "b"`, `import defer { a } from "b"`: only a namespace can be deferred.
fn deferred_imports<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let deferred = file.hir.imports.iter().filter(|it| it.is_deferred);
    let refused = deferred.filter_map(|it| {
        // `import source a from "b"` is marked so, too.
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
            SyntaxError::of_oxc(keyword, message)
                .code(code)
                .stage(Stage::Parser),
        )
    });
    refused.collect()
}

/// Whether oxc says where the `{` at `open` is when the text ends before its `}`. It does for a block, for the body of a function,
/// of a class, of an interface and of a `switch`, and for a type.
fn is_marked_at_the_end<'a>(file: &'a File<'a>, open: Span) -> bool {
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
    let is_of_module = |word: &[u8]| matches!(word, b"import" | b"export");
    let is_list_of_names = is_of_module(first)
        || first == b"type" && is_of_module(second)
        || first == b"," && (is_of_module(third) || third == b"type");
    !is_list_of_names
        && !matches!(first, [b'"' | b'\'', ..] | b"global")
        && !matches!(second, b"enum" | b"namespace" | b"module")
}

/// Where the bracket `open` is that `close` at `at` would close.
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

/// Where the bracket `close` is that closes `open`, which is at `at`.
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

/// The words that are tokens of their own for oxc's lexer, sorted.
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

/// Those of them that are reserved wherever they are, sorted.
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

/// What oxc calls the token `text` in "Expected `;` but found `Identifier`".
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
        // It splits these.
        [b'>', ..] => ">".to_owned(),
        [b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'\\' | 0x80.., ..]
            if KEYWORDS.binary_search(&text).is_err() =>
        {
            "Identifier".to_owned()
        }
        _ => bstr::BStr::new(text).to_string(),
    }
}

/// "Expected `wanted` but found `..`", at the token `at`.
fn expected<'a>(file: &'a File<'a>, wanted: &str, at: Span) -> SyntaxError {
    let found = name_of_token(file.slice(at));
    SyntaxError::of_oxc(at, format!("Expected `{wanted}` but found `{found}`"))
        .says(format!("`{wanted}` expected"))
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

/// What oxc's parser says about the private name `name` where an operand starts. It can only be the left side of an `in`, which
/// nothing that binds as tightly can have as an operand.
pub(super) fn private_name_as_operand<'a>(file: &'a File<'a>, name: Span) -> Option<SyntaxError> {
    let previous = file.token_before(name);
    let operator = previous.map_or(&b""[..], |it| it.text());
    // After what ends an operand `+` and `-` have two.
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
            SyntaxError::of_oxc(name, "Unexpected token")
        }
        b"+" | b"-" if !follows_operand() => SyntaxError::of_oxc(name, "Unexpected token"),
        b"+" | b"-" | b"*" | b"/" | b"%" | b"**" | b"<<" | b">>" | b">>>" | b"<" | b">" | b"<="
        | b">=" | b"instanceof" | b"in" => {
            SyntaxError::of_oxc(name, "Unexpected private identifier")
        }
        _ if file.slice(next) != b"in" => expected(file, "in", next),
        _ => return None,
    };
    Some(error.stage(Stage::Fatal))
}

/// An error of TypeScript's parser about JSX in the words of oxc's. It goes on after a closing tag with the wrong name.
fn of_jsx<'a>(file: &'a File<'a>, it: &Diagnostic, label: Span) -> Option<SyntaxError> {
    let (hir, text) = (&file.hir, file.text());
    let span_of =
        |id: bun_sema::hir::ExprId| hir.exprs.get(id.idx()).map(|it| Span::new(it.pos, it.end));
    // The name in the opening tag of the element whose closing tag, or the place where it is missing, is at `at`.
    let opened_before = |at: u32| {
        let element = hir.jsx.iter().find(|it| it.close_pos == at)?;
        span_of(element.tag)
    };
    let mismatch = |closing: Span, opening: Span| {
        let name = bstr::BStr::new(file.slice(opening));
        let message = format!("Expected corresponding JSX closing tag for '{name}'.");
        SyntaxError::of_oxc(closing, message)
            .says(format!("Expected `</{name}>`"))
            .and(opening, "Opened here")
            .noticed_at(closing.start)
    };
    // The text of JSX that the end of the file ends.
    let to_the_end = || {
        let last = bun_core::strings::last_index_of_any(text, b">}").map_or(0, |it| it + 1);
        SyntaxError::of_oxc(
            Span::new(last as u32, text.len() as u32),
            "Unexpected token",
        )
    };
    Some(match it.code {
        17002 => mismatch(label, opened_before(label.start.checked_sub(2)?)?).stage(Stage::Parser),
        17015 => {
            let fragment = hir.jsx.iter().find(|it| it.close_pos + 2 == label.start)?;
            let opening = Span::new(fragment.opening_end.checked_sub(2)?, fragment.opening_end);
            SyntaxError::of_oxc(
                label,
                "Expected corresponding closing tag for JSX fragment.",
            )
            .says("Expected `</>`")
            .and(opening, "Opened here")
            .noticed_at(label.start)
        }
        17014 => to_the_end(),
        // The element is not closed. oxc holds the next closing tag against it, or comes to the end of the text.
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
            SyntaxError::of_oxc(Span::empty(it.start), message)
        }
        2657 => {
            let is_first = |e: &&bun_sema::hir::Expr| {
                e.pos == it.start && matches!(e.kind, bun_sema::hir::ExprKind::Jsx(_))
            };
            let first = hir.exprs.iter().filter(is_first).map(|it| it.end).min()?;
            let next = skip_trivia(text, first);
            SyntaxError::of_oxc(
                Span::new(next, next + 1),
                "Adjacent JSX elements must be wrapped in an enclosing tag.",
            )
            .help("Did you want a JSX fragment `<>...</>`?")
        }
        _ => return None,
    })
}

/// An error of TypeScript's parser about code that oxc's parser reads another way: it has other words for it, or stumbles
/// elsewhere. The tokens around tell. Where oxc goes on after such an error and TypeScript's parser is lost, it is the last here.
fn of_shape<'a>(file: &'a File<'a>, it: &Diagnostic, label: Span) -> Option<SyntaxError> {
    let slice = |at: Span| file.slice(at);
    let before = |at: Span| file.token_before(at).map(|it| it.span());
    let text_before = |at: Span| before(at).map_or(&b""[..], slice);
    let after = |at: Span| token_after(file, at);
    let unexpected = |at: Span| SyntaxError::of_oxc(at, "Unexpected token");
    let semicolon = |after: u32| {
        let message =
            "Expected a semicolon or an implicit semicolon after a statement, but found none";
        SyntaxError::of_oxc(Span::new(after, after), message).help("Try inserting a semicolon here")
    };
    let wanted = it.args.first().map_or(&b""[..], |it| &it[..]);
    let lacks_semicolon = matches!(it.code, 1434 | 1442) || it.code == 1005 && wanted == b";";
    let is_unexpected = matches!(it.code, 1003 | 1109 | 1110 | 1128 | 1134 | 1138);
    let previous = before(label);
    // The parentheses around `at`, if a `=>` follows them.
    let head_of_arrow = |at: u32| {
        let open = opener(file, at, (b'(', b')'))?;
        let close = closer(file, open, (b'(', b')'))?;
        (slice(after(close)) == b"=>").then_some((open, close))
    };
    let is_literal = |at: Span| matches!(slice(at), [b'0'..=b'9' | b'"' | b'\'', ..]);

    // What touches a number and could go on a name. TypeScript's scanner has an error for that after some kinds of number only.
    if (lacks_semicolon || matches!(it.code, 1131 | 1144 | 1440))
        && previous.is_some_and(|it| {
            it.end == label.start && slice(it).first().is_some_and(u8::is_ascii_digit)
        })
        && matches!(
            slice(label),
            [b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$', ..]
        )
    {
        let first = Span::new(label.start, label.start + 1);
        return Some(SyntaxError::of_oxc(
            first,
            "Invalid characters after number",
        ));
    }
    // After `yield` oxc reads an operand, unless the expression can end there.
    if it.code == 1005
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
        return Some(SyntaxError::of_oxc(Span::new(start, close.end), message).code(1021));
    }
    // After a member of a class that is no method it wants a `;`, a line break or the `}`.
    if lacks_semicolon
        && let Some(open) = opener(file, label.start, (b'{', b'}'))
        && file.classes().any(|it| it.body_span().start == open.start)
    {
        // TypeScript's parser is at the name, or at what is wrong.
        let mut wrong = match it.code {
            1434 => after(label),
            _ => label,
        };
        let both = |question: Span, exclamation: Span| {
            let signs = Span::new(question.start, exclamation.end);
            SyntaxError::of_oxc(signs, "A property cannot be both optional and definite.")
                .help("Remove either the `?` or the `!`")
        };
        if slice(wrong) == b"?" && slice(after(wrong)) == b"!" {
            return Some(both(wrong, after(wrong)));
        }
        if slice(wrong) == b"!" && text_before(wrong) == b"?" {
            return before(wrong).map(|question| both(question, wrong));
        }
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
            return Some(SyntaxError::of_oxc(name, message));
        }
    }
    // `let { ...{ a } } = b`, `let { ...[a] } = b`, `let { ...1 } = b`. TypeScript's parser takes the last two for a key.
    let invalid_rest = |target: Span| {
        SyntaxError::of_oxc(
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
    // Where it wants the name of a variable.
    if is_unexpected
        && matches!(text_before(label), b"let" | b"var" | b"const" | b"using")
        && RESERVED.binary_search(&slice(label)).is_ok()
    {
        let message = [
            b"Identifier expected. '",
            slice(label),
            b"' is a reserved word that cannot be used here.",
        ];
        return Some(SyntaxError::of_oxc(label, message.concat()));
    }
    // The name of a declaration of TypeScript in a generator.
    if slice(label) == b"yield"
        && (matches!(it.code, 2457 | 2427 | 2819)
            || it.code == 1003 && text_before(label) == b"enum")
    {
        let message = "Cannot use `yield` as an identifier in a generator context";
        return Some(SyntaxError::of_oxc(label, message));
    }
    match it.code {
        1132 if slice(label).starts_with(b"`") => {
            let message = "Computed property names are not allowed in enums.";
            return Some(SyntaxError::of_oxc(label, message).code(1164));
        }
        1132 => return Some(unexpected(label)),
        // `a[]`
        1011 => return Some(unexpected(after(Span::new(label.start, label.start)))),
        _ => {}
    }
    if !is_unexpected {
        // `({ a: b.c }) => 1`: no parameters, so it is an expression in parentheses, which no `=>` can follow.
        let goes_on = it.code == 1005 && matches!(slice(label), b"." | b"(" | b"[");
        let head = head_of_arrow(label.start).filter(|_| goes_on && wanted != b";");
        return head.map(|(_, close)| semicolon(close.end));
    }
    // `catch (a = 1)`
    if slice(label) == b"="
        && let Some(open) = opener(file, label.start, (b'(', b')'))
        && text_before(open) == b"catch"
    {
        return Some(expected(file, ")", label));
    }
    // `<a>{</a>`: it reads the start of an element.
    if slice(label).starts_with(b"<") && file.text().get(label.start as usize + 1) == Some(&b'/') {
        return Some(unexpected(Span::new(label.start + 1, label.start + 2)));
    }
    // `<a b={} />`
    if slice(label) == b"}"
        && let Some(open) = previous.filter(|it| slice(*it) == b"{")
        && text_before(open) == b"="
    {
        let message = "JSX attributes must only be assigned a non-empty 'expression'.";
        let braces = Span::new(open.start, label.end);
        return Some(SyntaxError::of_oxc(braces, message).code(17000));
    }
    // `typeof a.#b`, `A.#b`: TypeScript's parser is past the name.
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
        return Some(SyntaxError::of_oxc(name, message));
    }
    // `({ a: 1 }) => 1`, `({ a: 1 } = 1) => 1`
    if it.code == 1003
        && is_literal(label)
        && let Some((_, close)) = head_of_arrow(label.start)
    {
        let pattern = opener(file, label.start, (b'{', b'}'));
        let pattern = pattern.and_then(|it| closer(file, it, (b'{', b'}')));
        return Some(match pattern.map(|it| slice(after(it))) {
            Some(b"=") => SyntaxError::of_oxc(label, "Cannot assign to this expression"),
            _ => semicolon(close.end),
        });
    }
    // At the end of the text.
    let end = file.text().len() as u32;
    (label.is_empty() && skip_trivia(file.text(), label.start) >= end)
        .then(|| unexpected(Span::empty(end)))
}

/// What a regular expression without an end is in. On its way out oxc's parser fails again at the end of the text, and each time
/// one error takes the place of another.
enum Around {
    Nothing,
    /// Brackets of any kind, or the head of a class or an interface: the error of the lexer is left.
    Brackets,
    /// Somewhere around it the head of an `if`, a `with` or a loop, or `a ?` without its `:`. The error of the parser is left.
    Head,
}

fn around_unterminated<'a>(file: &'a File<'a>, at: u32) -> Around {
    let (mut closed, mut around) = (0, Around::Nothing);
    if question_mark(file, at).is_some() {
        return Around::Head;
    }
    // `class A extends /`, `interface A extends B, /`
    let is_in_name =
        |text: &[u8]| matches!(text, b"," | b".") || name_of_token(text) == "Identifier";
    let mut head = file.tokens_before(Span::empty(at)).map(|it| it.text());
    if head
        .find(|it| !is_in_name(it))
        .is_some_and(|it| it == b"extends")
    {
        around = Around::Brackets;
    }
    let mut tokens = file.tokens_before(Span::empty(at)).peekable();
    while let Some(it) = tokens.next() {
        match it.text() {
            b")" | b"]" | b"}" => closed += 1,
            b"(" | b"[" | b"{" if closed > 0 => closed -= 1,
            b"(" => match tokens.peek().map_or(&b""[..], |it| it.text()) {
                b"if" | b"while" | b"for" | b"with" | b"await" => return Around::Head,
                b"import" => {}
                _ => around = Around::Brackets,
            },
            b"[" | b"{" => around = Around::Brackets,
            _ => {}
        }
    }
    around
}

/// Past the line break after `from`, or the end of `text`.
fn end_of_line(text: &[u8], from: u32) -> u32 {
    let rest = text.get(from as usize..).unwrap_or_default();
    bun_core::strings::index_of_any(rest, b"\n\r")
        .map_or(text.len() as u32, |it| from + it as u32 + 1)
}

/// An error of TypeScript's scanner in the words of oxc's lexer.
///
/// What the lexer reports and goes on after, oxlint prints before all that the parser reports. Where the parser cannot go on with
/// the token that the lexer makes of it, the error of the lexer is the one at which the parser gives up.
fn of_scanner<'a>(file: &'a File<'a>, it: &Diagnostic, label: Span) -> Option<SyntaxError> {
    let text = file.text();
    let end_of_text = text.len() as u32;
    let goes_on = |error: SyntaxError| error.stage(Stage::Parser).noticed_at(0);
    let gives_up = |error: SyntaxError| error.stage(Stage::Fatal);
    let end_of_line = |from: u32| end_of_line(text, from);
    let character_at = |at: u32| {
        let rest = text.get(at as usize..).unwrap_or_default();
        let first = rest.utf8_chunks().next();
        let len = first.and_then(|it| it.valid().chars().next());
        &rest[..len.map_or(1, char::len_utf8).min(rest.len())]
    };
    let invalid_character = |at: u32, len: u32| {
        let message = [b"Invalid Character `", character_at(at), b"`"].concat();
        gives_up(SyntaxError::of_oxc(Span::new(at, at + len), message))
    };
    let after_number =
        |at: Span| gives_up(SyntaxError::of_oxc(at, "Invalid characters after number"));
    // The `\` of the escape that is wrong at `at`.
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
    // The token of the line that goes on to `at`.
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
            // After the last token, the first that no `*/` follows. The `/` of `/*/` opens it and does not close it.
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
            goes_on(SyntaxError::of_oxc(
                comment,
                "Unterminated multiline comment",
            ))
        }
        1002 => {
            let start = match token_up_to(it.start) {
                // The value of an attribute of JSX goes on over lines.
                start if start == it.start => {
                    let before = text.get(..start as usize).unwrap_or_default();
                    bun_core::strings::last_index_of_any(before, b"\"'")
                        .map_or(start, |it| it as u32)
                }
                start => start,
            };
            let string = Span::new(start, end_of_line(it.start));
            gives_up(SyntaxError::of_oxc(string, "Unterminated string"))
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
            gives_up(SyntaxError::of_oxc(
                Span::new(template, end_of_text),
                "Unterminated string",
            ))
        }
        1125 | 1198 | 1199 if escape.is_some() => {
            let escape = Span::new(escape?, label.end.max(it.start));
            goes_on(SyntaxError::of_oxc(escape, "Invalid escape sequence"))
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

/// An error of TypeScript's parser in the words of oxc's. Empty: they are not known. oxc has two errors for some.
pub(super) fn of_typescript<'a>(file: &'a File<'a>, it: &Diagnostic) -> Vec<SyntaxError> {
    let rest = file.text().get(it.start as usize..).unwrap_or_default();
    let label = Span::new(
        it.start,
        match it.end {
            Diagnostic::NO_LENGTH => it.start,
            0 => it.start + token_len(rest) as u32,
            end => end,
        },
    );
    // The lexer goes on to the end of the line, and the parser cannot go on with what it makes of the rest.
    if it.code == 1161 {
        let line = Span::new(it.start, end_of_line(file.text(), it.start));
        let rest = Span::new(it.start, file.text().len() as u32);
        let of_lexer = SyntaxError::of_oxc(line, "Unterminated regular expression");
        let of_parser = SyntaxError::of_oxc(rest, "Unexpected token").stage(Stage::Fatal);
        return match around_unterminated(file, it.start) {
            Around::Nothing => vec![of_lexer.stage(Stage::Parser).noticed_at(0), of_parser],
            Around::Brackets => vec![of_lexer.stage(Stage::Fatal)],
            Around::Head => vec![of_parser],
        };
    }
    let one = of_scanner(file, it, label).or_else(|| of_parser(file, it, label));
    one.into_iter().collect()
}

/// An error of TypeScript's parser in the words of oxc's, which gives up there unless the error says otherwise. `None`: they are
/// not known.
fn of_parser<'a>(file: &'a File<'a>, it: &Diagnostic, label: Span) -> Option<SyntaxError> {
    let semicolon = |after: u32| {
        let message =
            "Expected a semicolon or an implicit semicolon after a statement, but found none";
        SyntaxError::of_oxc(Span::new(after, after), message).help("Try inserting a semicolon here")
    };
    let before = |at: Span| file.token_before(at).map_or(&b""[..], |it| it.text());
    let args: SmallVec<[&[u8]; 3]> = it.args.iter().map(|it| &**it).collect();
    let text = |it: &[u8]| bstr::BStr::new(it).to_string();
    if let Some(error) = of_jsx(file, it, label) {
        return Some(match error.of_oxc.stage {
            Stage::Semantic => error.stage(Stage::Fatal),
            _ => error,
        });
    }
    if let Some(error) = of_shape(file, it, label) {
        return Some(error.stage(Stage::Fatal));
    }
    let error = match (it.code, &args[..]) {
        (1005, [b";", found]) => {
            let head = opener(file, it.start, (b'(', b')')).filter(|it| before(*it) == b"for");
            match head {
                Some(_) => {
                    SyntaxError::of_oxc(label, format!("Expected `;` but found `{}`", text(found)))
                        .says("`;` expected")
                }
                None => semicolon(file.end_of_token_before(it.start)),
            }
        }
        (1131 | 1434 | 1440, _) => semicolon(label.end),
        (1209, _) => SyntaxError::of_oxc(label, "Invalid optional chain from new expression."),
        (1389, _) if before(label) == b"function" => expected(file, "Identifier", label),
        (1181 | 1390, _) if RESERVED.binary_search(&file.slice(label)).is_ok() => {
            let message = format!(
                "Identifier expected. '{}' is a reserved word that cannot be used here.",
                text(file.slice(label))
            );
            SyntaxError::of_oxc(label, message)
        }
        (1389, [word]) => {
            let message = format!(
                "Identifier expected. '{}' is a reserved word that cannot be used here.",
                text(word)
            );
            SyntaxError::of_oxc(label, message)
        }
        (1034, _) => {
            let keyword = file.token_before(label).map_or(label, |it| it.span());
            let message = "'super' can only be used with function calls or in property accesses";
            return Some(
                SyntaxError::of_oxc(keyword, message)
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
                SyntaxError::of_oxc(label, message)
                    .help("Wrap the unary expression in parentheses to make the precedence explicit")
                    .stage(Stage::Parser),
            );
        }
        (1144, _) => semicolon(file.end_of_token_before(it.start)),
        (1005, [b"try" | b"export", ..]) => SyntaxError::of_oxc(label, "Unexpected token"),
        (1351, _) => {
            let first = Span::new(label.start, label.start + 1);
            SyntaxError::of_oxc(first, "Invalid characters after number")
        }
        (1130, _) => SyntaxError::of_oxc(label, "Expected switch clause")
            .says("`case` or `default` clause expected here")
            .help("If this is intended to be the condition for the switch statement, add `case` before it."),
        (1472, _) => {
            let after = file.end_of_token_before(it.start);
            return Some(
                SyntaxError::of_oxc(Span::new(after, after), "Missing catch or finally clause")
                    .help("Either unwrap this try block or add catch / finally clause")
                    .stage(Stage::Parser),
            );
        }
        (1003, _) if matches!(before(label), b"function" | b"*") => {
            SyntaxError::of_oxc(label, "Expected function name")
                .help("Function name is required in function declaration or named export")
        }
        (1003, _) if before(label) == b"?." => {
            let chain = file.token_before(label).map_or(label, |it| it.span());
            SyntaxError::of_oxc(chain, "Identifier expected after '?.'")
                .help("Add an identifier after '?.'")
        }
        (1128, _) if file.slice(label) == b"export" => {
            let next = file.token_after(label).map_or(label, |it| it.span());
            SyntaxError::of_oxc(next, "Unexpected token")
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
            // After the last element of a list oxc looks for a comma, too.
            let is_list = args.len() == 3
                || *found != b"EOF"
                    && match (*expected, opened.map(before)) {
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
            let message = format!("Expected {wanted} but found `{}`", text(found));
            let error = SyntaxError::of_oxc(label, message).says(format!("{wanted} expected"));
            // `import(a b)`
            if let Some(import) = opened.and_then(|it| file.token_before(it))
                && import.text() == b"import"
                && *found != b"EOF"
            {
                let end = file.token_before(label).map_or(label.start, |it| it.span().end);
                let message = "Dynamic imports can only accept a module specifier and an optional set of attributes as arguments";
                let call = Span::new(import.span().start, end);
                return Some(SyntaxError::of_oxc(call, message).stage(Stage::Fatal));
            }
            let has_opener = match *found {
                b"EOF" => *expected == b"}" && opened.is_some_and(|it| is_marked_at_the_end(file, it)),
                _ if *expected == b")" => opened.is_some_and(|it| before(it) != b"catch"),
                _ => is_list || !it.related.is_empty(),
            };
            match opened.filter(|_| has_opener) {
                Some(opened) => error.and(opened, "Opened here"),
                None if *expected == b":" => match question_mark(file, label.start) {
                    Some(question) => error.and(question, "Conditional starts here"),
                    None => error,
                },
                None => error,
            }
        }
        (1003 | 1109 | 1110 | 1128 | 1134 | 1138 | 1145 | 1478, _) if label.end > label.start => {
            SyntaxError::of_oxc(label, "Unexpected token")
        }
        _ => return None,
    };
    Some(error.stage(Stage::Fatal))
}

/// What follows `with` after the specifier of an import or an export: the values are strings, and no name comes twice.
fn module_attributes<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let text = file.text();
    let mut all = Vec::new();
    for &(keyword, _) in file.hir.import_attributes.iter() {
        // In an import type `with` is the name of a property, and any value is taken.
        let after = skip_trivia(text, next_token(text, keyword).end);
        let clause = ImportAttributes::within(file, Span::new(keyword, keyword + 1));
        let Some(clause) = clause.filter(|_| text.get(after as usize) == Some(&b'{')) else {
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
                let error = SyntaxError::of_oxc(next_token(text, value.start), message);
                all.push(error.help("Wrap this with quotes").stage(Stage::Fatal));
            }
            let Some(KeyKind::Ident(name) | KeyKind::String(name)) =
                entry.key().map(|it| it.kind())
            else {
                continue;
            };
            // It is held against the one before it, when the value is read.
            match seen.iter_mut().find(|it| it.0 == name) {
                Some(before) => {
                    let name = bstr::BStr::new(name.bytes());
                    let message = format!("Identifier `{name}` has already been declared");
                    let error = SyntaxError::of_oxc(before.1, message)
                        .says(format!("`{name}` has already been declared here"))
                        .and(key, "It can not be redeclared here");
                    all.push(error.noticed_at(entry.span().end).stage(Stage::Parser));
                    before.1 = key;
                }
                None => seen.push((name, key)),
            }
        }
    }
    all
}

/// The errors for which oxlint refuses a file, in the order in which it prints them. `of_typescript`: those of TypeScript's
/// parser, in oxc's words. `is_oxfmt`: those for which oxfmt refuses it, which runs oxc's parser alone, and has it leave regular
/// expressions alone. Such a file has no symbols. `stop`: which of the diagnostics of the file is the one at which oxc's parser
/// gives up. They are in the order in which the parser here has come to them, and what it has noted after that one it has
/// noted on a way that oxc's does not go.
///
/// A check hands in what it finds, in any order.
pub(super) fn errors<'a>(
    file: &'a File<'a>,
    of_typescript: Vec<SyntaxError>,
    stop: Option<usize>,
    is_oxfmt: bool,
) -> Vec<SyntaxError> {
    // Where TypeScript's parser has an error the tree has holes. oxc's parser has one too, so what the pass that builds the
    // scopes would say is not printed, and is not looked for: nothing is asked of the scopes of such a tree.
    let has_holes = !of_typescript.is_empty();
    let is_whole = !has_holes && !is_oxfmt;
    // What the parser has noted in oxc's words comes before an error of TypeScript's parser at the same place.
    let mut all = match has_holes {
        true => oxc_typescript::noted(file, stop),
        false => oxc_typescript::errors(file, !is_oxfmt),
    };
    all.extend(of_typescript);
    all.extend(module_attributes(file));
    // acorn's checks have these for JavaScript.
    if !file.is_javascript() {
        all.extend(declare_in_ambient_context(file));
    }
    if !file.is_javascript() && is_whole {
        all.extend(class_without_name(file));
    }
    match file.path() {
        [.., b'.', b'c', b'j', b's'] => all.extend(espree::module_syntax_in_commonjs(file, false)),
        [.., b'.', b'c', b't', b's'] => all.extend(espree::module_syntax_in_commonjs(file, true)),
        _ => {}
    }
    let noted = file.hir.diagnostics;
    let noted = stop.and_then(|stop| noted.get(..=stop)).unwrap_or(noted);
    all.extend(misplaced_suspensions(file, noted));
    all.extend(phases_without_call(file, noted));
    all.extend(espree::errors_of_oxc(file, !is_whole, is_oxfmt));
    all.extend(targets::errors(file));
    // The first four are reported when oxc is through with the file, in this order.
    if is_whole {
        all.extend(names::class_members(file));
        all.extend(names::exports(file));
        all.extend(names::redeclarations(file));
        all.extend(espree::export_assignment_beside_exports(file));
        all.extend(espree::using_in_script(file));
        all.extend(espree::with_in_strict_code(file));
        all.extend(duplicate_parameters(file));
    }
    // The parser does not set the bit for a file that it fails on.
    if has_holes || is_oxfmt && file.has_rare_syntax(rare::ODD_EXPORT) {
        all.extend(names::duplicate_exports(file));
    }
    all.extend(deferred_imports(file));
    all.extend(espree::for_await_where_nothing_waits(file));
    all.extend(keywords::errors(file));
    all.extend(declarations_without_initializer(
        file,
        !file.is_javascript(),
    ));
    all.extend(declaration_list(file));
    if !is_whole || all.iter().any(|it| it.of_oxc.stage != Stage::Semantic) {
        all.retain(|it| it.of_oxc.stage != Stage::Semantic);
    }
    // Of two at one place, the one that is looked for first.
    crate::utils::sort::sort_by_key(&mut all, SyntaxError::order);
    all.dedup_by(|a, b| a.at == b.at && a.order() == b.order() && a.message == b.message);
    if let Some(fatal) = all.iter().position(|it| it.of_oxc.stage == Stage::Fatal) {
        // How far the parser has read.
        let read = match all[fatal].end {
            Diagnostic::NO_LENGTH | 0 => all[fatal].order(),
            end => all[fatal].order().max(end),
        };
        // What it says when it is through, it says all the same. All is about what it has read.
        let mut at = 0;
        all.retain(|it| {
            at += 1;
            at == fatal + 1 || it.at < read && (at <= fatal || it.order() == u32::MAX)
        });
    }
    all
}
