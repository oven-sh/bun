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
use crate::ast::{Class, File, FnBody, Func, Handle, Module, Node, Param, Pat, StmtTag};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use bun_sema::atom::Atom;
use bun_sema::bind::{ClassOwner, Parent};
use bun_sema::hir::{
    Diagnostic, DiagnosticKind, Flags, FnKind, Modifier, ModifierKind, ModuleId, ParamId, PatKind,
    StmtId, StmtKind, VarDecl, VarKind, rare,
};
use smallvec::SmallVec;
use std::borrow::Cow;

fn is_keyword(modifier: &Modifier, flag: Flags) -> bool {
    modifier.kind == ModifierKind::Keyword(flag)
}

/// Each `await` outside an async function and each `yield` outside a generator. The parser notes them for OXC, whose parser
/// reports them.
fn misplaced_suspensions<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let hir = &file.hir;
    if hir.diagnostics.is_empty() {
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
    let misplaced = hir.diagnostics.iter().filter(|it| {
        it.kind == DiagnosticKind::Grammar
            && match it.code {
                1163 => true,
                1308 => !can_be_module || is_in_body(it.start),
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

/// `const` and nothing behind it. `for (const a, b of c)`.
fn declaration_list<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if !file.has_rare_syntax(rare::ODD_DECLARATION) {
        return Vec::new();
    }
    let empty = file.stmts_of_kind(StmtTag::Var).filter_map(|it| {
        let raw = it.try_raw()?;
        let is_empty = matches!(raw.kind, StmtKind::Var(list) if list.is_empty())
            && loop_with_head(file, it.id().idx()).is_none();
        if !is_empty {
            return None;
        }
        let keyword = token_len(file.text().get(raw.start as usize..)?) as u32;
        let next = skip_trivia(file.text(), raw.start + keyword);
        let next = Span::new(
            next,
            next + token_len(file.text().get(next as usize..)?) as u32,
        );
        Some(SyntaxError::of_oxc(next, "Unexpected token").stage(Stage::Fatal))
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
    empty.chain(in_heads).collect()
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
    lacking
        .map(|(_, it)| {
            let message = match it.kind {
                VarKind::Using | VarKind::AwaitUsing => {
                    "Using declarations must have an initializer."
                }
                _ if is_pattern(it) => "Missing initializer in destructuring declaration",
                _ => "Missing initializer in const declaration",
            };
            SyntaxError::of_oxc(Pat::new(file, it.pat).span(), message)
                .help("Add an initializer (e.g. ` = undefined`) here")
                .stage(Stage::Parser)
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

/// `declare` at the head of a statement in what is ambient already: in a `declare namespace`, a `declare module`, `declare global`,
/// a namespace of a declaration file. After `export` OXC takes it.
fn declare_in_ambient_context<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let modules = file.hir.modules.iter().enumerate();
    let ambient = modules.filter(|it| it.1.flags.contains(Flags::AMBIENT));
    let statements = ambient.flat_map(|it| Module::new(file, ModuleId(it.0 as u32)).body());
    let declared = statements.filter_map(|it| {
        let modifiers = file.hir.modifiers.get(it.try_raw()?.modifiers.range())?;
        let first = modifiers.first()?;
        is_keyword(first, Flags::AMBIENT).then_some(first.pos)
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

/// An error of TypeScript's parser in the words of oxc's, which gives up there. `None`: they are not known.
pub(super) fn of_typescript<'a>(file: &'a File<'a>, it: &Diagnostic) -> Option<SyntaxError> {
    let rest = file.text().get(it.start as usize..).unwrap_or_default();
    let label = Span::new(
        it.start,
        match it.end {
            Diagnostic::NO_LENGTH => it.start,
            0 => it.start + token_len(rest) as u32,
            end => end,
        },
    );
    let semicolon = |after: u32| {
        let message =
            "Expected a semicolon or an implicit semicolon after a statement, but found none";
        SyntaxError::of_oxc(Span::new(after, after), message).help("Try inserting a semicolon here")
    };
    let before = |at: Span| file.token_before(at).map_or(&b""[..], |it| it.text());
    let args: SmallVec<[&[u8]; 3]> = it.args.iter().map(|it| &**it).collect();
    let text = |it: &[u8]| bstr::BStr::new(it).to_string();
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
        (1351, _) => SyntaxError::of_oxc(label, "Invalid characters after number"),
        (1130, _) => SyntaxError::of_oxc(label, "Expected switch clause")
            .says("`case` or `default` clause expected here")
            .help("If this is intended to be the condition for the switch statement, add `case` before it."),
        (1472, _) => {
            let after = file.end_of_token_before(it.start);
            SyntaxError::of_oxc(Span::new(after, after), "Missing catch or finally clause")
                .help("Either unwrap this try block or add catch / finally clause")
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
            let has_opener = is_list || *expected == b")" || !it.related.is_empty();
            match opened.filter(|_| *found != b"EOF" && has_opener) {
                Some(opened) => error.and(opened, "Opened here"),
                None if *expected == b":" => match question_mark(file, label.start) {
                    Some(question) => error.and(question, "Conditional starts here"),
                    None => error,
                },
                None => error,
            }
        }
        (1003 | 1109 | 1110 | 1128 | 1138, _) if label.end > label.start => {
            SyntaxError::of_oxc(label, "Unexpected token")
        }
        _ => return None,
    };
    Some(error.stage(Stage::Fatal))
}

/// The errors for which oxlint refuses a file in which TypeScript's parser has found none, in the order in which it prints them.
///
/// A check hands in what it finds, in any order. For now most hand in only the first that they find.
pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let mut all = oxc_typescript::errors(file);
    // acorn's checks have these for JavaScript.
    if !file.is_javascript() {
        all.extend(declare_in_ambient_context(file));
        all.extend(espree::export_assignment_beside_exports(file));
        all.extend(class_without_name(file));
    }
    all.extend(misplaced_suspensions(file));
    all.extend(espree::errors_of_oxc(file));
    all.extend(targets::errors(file));
    all.extend(names::redeclarations(file));
    all.extend(names::exports(file));
    all.extend(espree::using_in_script(file));
    all.extend(espree::with_in_strict_code(file));
    all.extend(deferred_imports(file));
    all.extend(espree::for_await_where_nothing_waits(file));
    all.extend(keywords::errors(file));
    all.extend(duplicate_parameters(file));
    all.extend(declarations_without_initializer(
        file,
        !file.is_javascript(),
    ));
    all.extend(declaration_list(file));
    if all.iter().any(|it| it.of_oxc.stage != Stage::Semantic) {
        all.retain(|it| it.of_oxc.stage != Stage::Semantic);
    }
    // Of two at one place, the one that is looked for first.
    all.sort_by_key(SyntaxError::order);
    all.dedup_by(|a, b| a.at == b.at && a.order() == b.order() && a.message == b.message);
    if let Some(fatal) = all.iter().position(|it| it.of_oxc.stage == Stage::Fatal) {
        // What the parser says when it is through, it says all the same.
        let mut at = 0;
        all.retain(|it| {
            at += 1;
            at <= fatal + 1 || it.order() == u32::MAX
        });
    }
    all
}

/// The same for oxfmt, which runs OXC's parser and not the pass that builds the scopes: that pass has most of the errors.
/// The file is one that Prettier does not refuse, so typescript-estree has nothing to say about it.
pub(super) fn first_error_of_parser<'a>(file: &'a File<'a>) -> Option<SyntaxError> {
    let of_acorn = match file.is_javascript() {
        true => espree::first_error_of_oxc_parser(file),
        false => None,
    };
    let all = of_acorn
        .into_iter()
        .chain(declarations_without_initializer(file, false));
    all.min_by_key(|it| it.at)
}
