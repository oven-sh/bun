//! The errors about TypeScript's syntax that TypeScript's checker reports, and that oxc reports from its parser or from the pass
//! that builds its scopes: `function f(a?, b) {}`, `declare let a = 1`, `class A { abstract m() {} }`.
//!
//! The parser finds most of them on its way, under `Dialect::oxc`: `bun_sema_parser`'s `oxc.rs` has the conditions and the
//! texts, and says how an error is written down. Here are those that depend on what is around a node. Each is behind a bit of
//! `hir::rare` that the parser sets, or goes through a list that nearly every file has empty.
//!
//! What only TypeScript has is parsed in a JavaScript file too, and noted (`DiagnosticKind::Js`). [`of_javascript`] has what oxc's
//! parser says there, which does not read it: mostly it gives up, at the first token that is no JavaScript.
//!
//! Every condition, text and label was measured on oxlint 1.87.

use super::oxc::name_of_token;
use super::{Stage, SyntaxError};
use crate::ast::{Expr, File, Handle, Node, Stmt, TypeNode, TypeParam};
use crate::span::Span;
use crate::tokens::{skip_trivia, token_len};
use crate::utils::oxlint::is_strict_mode;
use bun_sema::bind::{FnOwner, Parent};
use bun_sema::hir::{
    self, Diagnostic, DiagnosticKind, ExprKind, Flags, FnKind, JSDocTypeKind, ModifierKind,
    ModuleName, PatKind, StmtKind, TypeNodeKind, VarKind, rare,
};
use std::borrow::Cow;

fn span_of(it: &Diagnostic) -> Span {
    match it.end {
        Diagnostic::NO_LENGTH => Span::empty(it.start),
        end => Span::new(it.start, end),
    }
}

fn text_of(it: &Diagnostic, index: usize) -> Cow<'static, str> {
    let text = it.args.get(index).map_or(&b""[..], |it| &it[..]);
    Cow::Owned(bstr::BStr::new(text).to_string())
}

/// An error that the parser has written down for oxc.
#[optimize(size)]
pub(super) fn of_parser<'a>(file: &'a File<'a>, it: &Diagnostic) -> Option<SyntaxError> {
    let stage = match it.kind {
        DiagnosticKind::Oxc => Stage::Parser,
        DiagnosticKind::OxcFatal => Stage::Fatal,
        DiagnosticKind::OxcSemantic => Stage::Semantic,
        DiagnosticKind::Grammar => return of_grammar(file, it),
        _ => return None,
    };
    let message = it.args.first().map_or_else(Vec::new, |it| it.to_vec());
    let mut error = SyntaxError::of_oxc(span_of(it), message)
        .code(it.code as u16)
        .help(text_of(it, 1))
        .says(text_of(it, 2))
        .stage(stage);
    for other in &it.related {
        error = match other.args.is_empty() {
            true => error.noticed_at(other.start),
            false => error.and(span_of(other), text_of(other, 0)),
        };
    }
    Some(error)
}

/// From the `[` before `inside` to the `]` that closes it.
fn brackets_around<'a>(file: &'a File<'a>, inside: u32) -> Span {
    let text = file.text();
    let open = file.end_of_token_before(inside).saturating_sub(1);
    let (mut at, mut depth) = (inside, 1u32);
    while depth > 0 && (at as usize) < text.len() {
        match text[at as usize] {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => depth -= 1,
            _ => {}
        }
        let after = at + token_len(&text[at as usize..]).max(1) as u32;
        at = match depth {
            0 => after,
            _ => skip_trivia(text, after),
        };
    }
    Span::new(open, at)
}

/// An error that TypeScript's parser notes for the checker, if oxc's parser has one for the same code. Each was tried. oxc
/// takes `let a: unique number` (1005), `A<T,>` (1009), `import.source("a")` (18061) and `Array<?>` (8020).
#[optimize(size)]
fn of_grammar<'a>(file: &'a File<'a>, it: &Diagnostic) -> Option<SyntaxError> {
    if file.is_in_jsdoc(it.start) {
        return None;
    }
    let (hir, text) = (&file.hir, file.text());
    let token_at = |at: u32| {
        let rest = text.get(at as usize..).unwrap_or_default();
        Span::new(at, at + token_len(rest) as u32)
    };
    // 0: the token there.
    let span = match it.end {
        0 => token_at(it.start),
        _ => span_of(it),
    };
    let unexpected = |at: u32| error(0, token_at(at), "Unexpected token", Stage::Fatal);
    let is_typescript = !file.is_javascript();
    let comma = Cow::Borrowed("Remove the trailing comma here");
    Some(match it.code {
        1013 => {
            let message = "A rest parameter or binding pattern may not have a trailing comma.";
            error(0, span, message, Stage::Parser).help(comma)
        }
        1025 if is_typescript => {
            let message = "Index signature declarations may not have a trailing comma.";
            error(0, span, message, Stage::Parser).help(comma)
        }
        // `[]`
        1096 if it.end != 0 => match text.get(it.start as usize) {
            Some(b'[') => unexpected(skip_trivia(text, it.start + 1)),
            _ => unexpected(it.start),
        },
        1096 => {
            let message = "An index signature must have exactly one parameter.";
            error(
                1096,
                brackets_around(file, it.start),
                message,
                Stage::Parser,
            )
        }
        // In the head of a class it has no length. oxc's parser goes on to the `{`, and takes it for an object after `extends`.
        1097 if it.end == Diagnostic::NO_LENGTH => unexpected(skip_trivia(text, it.start)),
        1097 => {
            // It is noted at the end of the keyword.
            let end = it.start;
            let keyword = Span::new(end.saturating_sub(7), end);
            error(
                1097,
                keyword,
                "'extends' list cannot be empty.",
                Stage::Parser,
            )
        }
        // One for a `switch`, about its first two.
        1113 => {
            let index = hir.cases.iter().position(|case| case.pos == it.start)?;
            let cases = hir.stmts.iter().find_map(|it| match it.kind {
                StmtKind::Switch { cases, .. } if cases.range().contains(&index) => Some(cases),
                _ => None,
            })?;
            let cases = hir.cases.get(cases.range())?;
            let mut defaults = cases.iter().filter(|it| it.test.is_none());
            let (first, second) = (defaults.next()?, defaults.next()?);
            if second.pos != it.start {
                return None;
            }
            let message =
                "A 'default' clause cannot appear more than once in a 'switch' statement.";
            error(
                1113,
                Span::new(first.pos, first.end),
                message,
                Stage::Parser,
            )
            .says(Cow::Borrowed("First 'default' clause is here."))
            .and(
                Span::new(second.pos, second.end),
                Cow::Borrowed("Another 'default' clause cannot appear here."),
            )
        }
        1358 => {
            let message = "Tagged template expressions are not permitted in an optional chain";
            error(0, span, message, Stage::Parser)
        }
        // The body of an accessor in a type.
        1183 => semicolon_after(file.end_of_token_before(it.start)),
        8020 => match text.get(it.start as usize) {
            Some(b'*') => unexpected(it.start),
            // `A.<B>`
            Some(b'.') => unexpected(it.start + 1),
            _ => return None,
        },
        // `import.a`. Who looks at `new.target` has `new.a`.
        17012 => {
            let dot = file.end_of_token_before(it.start);
            let keyword = file.end_of_token_before(dot.checked_sub(1)?);
            if !text.get(..keyword as usize)?.ends_with(b"import") {
                return None;
            }
            let message = "The only valid property accesses on import are `import.meta`, `import.source()`, and `import.defer()`";
            error(0, Span::new(keyword - 6, span.end), message, Stage::Fatal)
        }
        1019 | 1098 | 1099 | 5085 | 5086 | 5087 if is_typescript || it.code == 1099 => {
            let mut message = Vec::new();
            bun_sema::messages::format(
                &mut message,
                bun_sema::messages::message(it.code)?.1,
                &it.args,
            );
            SyntaxError::of_oxc(span, message)
                .code(it.code as u16)
                .stage(Stage::Parser)
        }
        // After the one member of a mapped type.
        7061 => expected(file, "`}`", it.start),
        1047 | 1051 | 1092 | 1235 => {
            let mut message = Vec::new();
            bun_sema::messages::format(
                &mut message,
                bun_sema::messages::message(it.code)?.1,
                &it.args,
            );
            SyntaxError::of_oxc(span, message).stage(Stage::Parser)
        }
        _ => return None,
    })
}

fn error(code: u16, at: Span, message: &str, stage: Stage) -> SyntaxError {
    SyntaxError::of_oxc(at, message).code(code).stage(stage)
}

/// Where a namespace, `declare module "m"` or `declare global` can't be, and what they lack.
fn modules<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    let (hir, bound) = (&file.hir, &file.bound);
    for raw in hir.modules {
        let parent = match bound.stmt_parent.get(raw.stmt.idx()) {
            None | Some(Parent::None) => continue,
            Some(&parent) => parent,
        };
        let is_ambient = raw.flags.contains(Flags::AMBIENT);
        let whole = || Stmt::new(file, raw.stmt).span_without_export();
        if let ModuleName::String(_) = raw.name {
            let name = file.text().get(raw.name_pos as usize..).unwrap_or_default();
            let name = Span::new(raw.name_pos, raw.name_pos + token_len(name) as u32);
            let around = match parent {
                Parent::Module(around) => hir.modules.get(around.idx()).map(|it| it.name),
                _ => None,
            };
            all.extend(match (is_ambient, parent, around) {
                (false, ..) => {
                    let message = "Only ambient modules can use quoted names.";
                    Some(error(1035, name, message, Stage::Parser))
                }
                (true, Parent::File, _) | (true, _, Some(ModuleName::String(_))) => None,
                (true, Parent::Module(_), _) => {
                    let message =
                        "Ambient modules cannot be nested in other modules or namespaces.";
                    Some(error(2435, whole(), message, Stage::Semantic).noticed_at(whole().end))
                }
                _ => {
                    let message =
                        "An ambient module declaration is only allowed at the top level in a file.";
                    Some(error(1234, whole(), message, Stage::Semantic).noticed_at(whole().end))
                }
            });
            if file.has_rare_syntax(rare::EXPORT_ASSIGNMENT) {
                export_assignments_beside_exports(file, raw, whole().end, all);
            }
            continue;
        }
        if !matches!(parent, Parent::File | Parent::Module(_)) {
            let message = "A namespace declaration is only allowed at the top level of a namespace or module.";
            all.push(error(1235, whole(), message, Stage::Semantic).noticed_at(whole().end));
        }
        if raw.name == ModuleName::Global && !is_ambient {
            let message = "Augmentations for the global scope should have 'declare' modifier unless they appear in already ambient context.";
            let keyword = Span::new(raw.name_pos, raw.name_pos + 6);
            all.push(error(2670, keyword, message, Stage::Semantic).noticed_at(whole().end));
        }
    }
}

/// The modifiers of type parameters: `in` and `out` are for classes, interfaces and type aliases, `const` for the rest.
fn type_parameters<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    let (hir, bound) = (&file.hir, &file.bound);
    for (i, raw) in hir.type_params.iter().enumerate() {
        if raw.modifiers.is_empty() || bound.type_param_scope.get(i).is_none_or(|it| !it.is_some())
        {
            continue;
        }
        let is_type = match TypeParam::from_raw(file, i as u32).parent() {
            Node::Stmt(it) => matches!(
                it.try_raw().map(|it| it.kind),
                Some(StmtKind::Interface(_) | StmtKind::TypeAlias(_))
            ),
            _ => false,
        };
        let has_variance =
            is_type || matches!(TypeParam::from_raw(file, i as u32).parent(), Node::Class(_));
        let written = hir.modifiers.get(raw.modifiers.range()).unwrap_or_default();
        for (index, it) in written.iter().enumerate() {
            let ModifierKind::Keyword(modifier) = it.kind else {
                continue;
            };
            // oxc remembers one place for each keyword, the last.
            if written[index + 1..]
                .iter()
                .any(|later| later.kind == it.kind)
            {
                continue;
            }
            let name = hir::modifier_text(modifier);
            let at = Span::new(it.pos, it.pos + name.len() as u32);
            let found = if (Flags::IN | Flags::OUT).contains(modifier) {
                if has_variance {
                    continue;
                }
                let message = format!(
                    "'{name}' modifier can only appear on a type parameter of a class, interface or type alias."
                );
                error(1274, at, &message, Stage::Parser)
            } else if modifier == Flags::CONST {
                if !is_type {
                    continue;
                }
                let message = "'const' modifier can only appear on a type parameter of a function, method or class";
                // After the list.
                error(1277, Span::new(raw.start, raw.end), message, Stage::Parser)
                    .noticed_at(raw.end + 1)
            } else {
                let message = format!("'{name}' modifier cannot be used on a type parameter.");
                error(1273, at, &message, Stage::Parser)
            };
            // After the modifiers, about whose order the parser has said what there is to say.
            all.push(match found.of_oxc.noticed {
                Some(_) => found,
                None => found.noticed_at(raw.pos),
            });
        }
    }
}

/// `T?`, `?T`, `T!` and `!T` that are the whole type after a `:`. Elsewhere oxc takes them.
fn jsdoc_types<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    for (i, raw) in file.hir.types.iter().enumerate() {
        let TypeNodeKind::JSDoc {
            kind: kind @ (JSDocTypeKind::Nullable | JSDocTypeKind::NonNullable),
            is_postfix,
            ..
        } = raw.kind
        else {
            continue;
        };
        if file.type_in_tree(i).is_none() {
            continue;
        }
        let node = TypeNode::from_raw(file, i as u32);
        let is_annotation = !node.is_parenthesized()
            && match node.parent() {
                Node::VarDecl(_) | Node::Param(_) | Node::Member(_) | Node::Func(_) => true,
                Node::Type(parent) => matches!(
                    parent.try_raw().map(|it| it.kind),
                    Some(TypeNodeKind::Predicate { .. })
                ),
                _ => false,
            };
        if !is_annotation {
            continue;
        }
        let span = Span::new(raw.pos, raw.end);
        let inner = match is_postfix {
            true => Span::new(raw.pos, raw.end - 1),
            false => Span::new(raw.pos + 1, raw.end),
        };
        let (sign, more) = match kind {
            JSDocTypeKind::Nullable => ('?', " | null | undefined"),
            _ => ('!', ""),
        };
        let (code, place) = match is_postfix {
            true => (17019, "end"),
            false => (17020, "start"),
        };
        let message = format!("'{sign}' at the {place} of a type is not valid TypeScript syntax.");
        let inner = bstr::BStr::new(file.slice(inner));
        let help = format!("Did you mean to write '{inner}{more}'?");
        all.push(error(code, span, &message, Stage::Semantic).help(Cow::Owned(help)));
    }
}

/// A type predicate that is not the return type of a function, a method or a call signature.
fn type_predicates<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    for (i, raw) in file.hir.types.iter().enumerate() {
        if !matches!(raw.kind, TypeNodeKind::Predicate { .. }) || file.type_in_tree(i).is_none() {
            continue;
        }
        let node = TypeNode::from_raw(file, i as u32);
        let is_allowed = !node.is_parenthesized()
            && match node.parent() {
                Node::Func(func) => {
                    func.return_type().is_some_and(|it| it.id() == node.id())
                        && matches!(
                            func.kind(),
                            FnKind::Decl
                                | FnKind::Expr
                                | FnKind::Arrow
                                | FnKind::Method
                                | FnKind::FunctionType
                                | FnKind::CallSignature
                        )
                }
                _ => false,
            };
        if !is_allowed {
            let message = "A type predicate is only allowed in return type position for functions and methods.";
            let span = Span::new(raw.pos, raw.end);
            all.push(error(1228, span, message, Stage::Semantic));
        }
    }
}

/// The declaration in the head of a `for-in` or a `for-of` that has an initializer or a type.
fn loop_heads<'a>(file: &'a File<'a>, has_scopes: bool, all: &mut Vec<SyntaxError>) {
    let hir = &file.hir;
    for (i, raw) in hir.stmts.iter().enumerate() {
        let (left, word) = match raw.kind {
            StmtKind::ForIn { left, .. } => (left, "in"),
            StmtKind::ForOf { left, .. } => (left, "of"),
            _ => continue,
        };
        let Some(head) = hir.stmts.get(left.idx()) else {
            continue;
        };
        let StmtKind::Var(list) = head.kind else {
            continue;
        };
        // Who counts the declarations has more than one.
        let Some([only]) = hir.var_decls.get(list.range()) else {
            continue;
        };
        let Some(name) = hir.pats.get(only.pat.idx()) else {
            continue;
        };
        if matches!(file.bound.stmt_parent.get(i), None | Some(Parent::None)) {
            continue;
        }
        if only.init.is_some() {
            let is_lexical = only.kind != VarKind::Var;
            // Annex B has `for (var a = 1 in b)`, in code that is not strict.
            let is_taken = word == "in"
                && !is_lexical
                && matches!(name.kind, PatKind::Ident(_))
                && (!has_scopes
                    || !is_strict_mode(Node::Stmt(Stmt::from_raw(file, i as u32)).scope(), file));
            if !is_taken {
                let message =
                    format!("for-{word} loop variable declaration may not have an initializer");
                let stage = match word == "in" && is_lexical {
                    true => Stage::Parser,
                    false => Stage::Semantic,
                };
                all.push(error(
                    0,
                    Span::new(head.start, head.loc.end),
                    &message,
                    stage,
                ));
            }
        }
        if only.ty.is_some() {
            let code = if word == "in" { 2404 } else { 2483 };
            let message = format!(
                "The left-hand side of a 'for...{word}' statement cannot use a type annotation."
            );
            let help = "This iterator's type will be inferred from the iterable. You can safely remove the type annotation.";
            let found = error(
                code,
                Span::new(name.pos, name.end),
                &message,
                Stage::Semantic,
            );
            all.push(found.help(Cow::Borrowed(help)));
        }
    }
}

/// `export = a` in the body of `declare module "m" {}` that exports something else. `end`: where the declaration ends.
fn export_assignments_beside_exports<'a>(
    file: &'a File<'a>,
    module: &hir::Module,
    end: u32,
    all: &mut Vec<SyntaxError>,
) {
    let hir = &file.hir;
    let body = hir.ids.get(module.body.range()).unwrap_or_default();
    let body = || body.iter().filter_map(|&it| hir.stmts.get(it as usize));
    let exports = |it: &hir::Stmt| match it.kind {
        StmtKind::ExportAssign(_) | StmtKind::ExportAsNamespace(_) => false,
        StmtKind::ExportNamed(export) => {
            (hir.exports.get(export.idx())).is_some_and(|it| !it.items.is_empty())
        }
        StmtKind::ExportStar { .. } | StmtKind::ExportDefault(_) => true,
        _ => {
            let written = hir.modifiers.get(it.modifiers.range()).unwrap_or_default();
            let is_export = |it: &hir::Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
            written.iter().any(is_export)
        }
    };
    if !body().any(exports) {
        return;
    }
    for it in body().filter(|it| matches!(it.kind, StmtKind::ExportAssign(_))) {
        let message =
            "An export assignment cannot be used in a module with other exported elements";
        let help = "If you want to use `export =`, remove other `export`s and put all of them to the right hand value of `export =`. If you want to use `export`s, remove `export =` statement.";
        let found = error(
            2309,
            Span::new(it.start, it.loc.end),
            message,
            Stage::Semantic,
        );
        all.push(found.help(Cow::Borrowed(help)).noticed_at(end));
    }
}

/// An `import` or an `export` of a JavaScript file that is no statement of the file. In TypeScript oxc takes it.
fn nested_module_syntax<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    let hir = &file.hir;
    for (i, raw) in hir.stmts.iter().enumerate() {
        let written = hir.modifiers.get(raw.modifiers.range()).unwrap_or_default();
        let is_export = |it: &&hir::Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
        let (at, what) = match raw.kind {
            StmtKind::Import(_) => (raw.start, "import"),
            StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } | StmtKind::ExportDefault(_) => {
                (raw.start, "export")
            }
            _ => match written.iter().find(is_export) {
                Some(keyword) => (keyword.pos, "export"),
                None => continue,
            },
        };
        if matches!(
            file.bound.stmt_parent.get(i),
            None | Some(Parent::None | Parent::File)
        ) {
            continue;
        }
        let message =
            format!("'{what} statement' declaration can only be used at the top level of a module");
        all.push(error(0, Span::new(at, at + 6), &message, Stage::Parser));
    }
}

// ───────────────────────────── TypeScript in a JavaScript file ─────────────────────────────

fn token_at<'a>(file: &'a File<'a>, at: u32) -> Span {
    let rest = file.text().get(at as usize..).unwrap_or_default();
    Span::new(at, at + token_len(rest) as u32)
}

/// The token after `token`.
fn token_after<'a>(file: &'a File<'a>, token: Span) -> Span {
    token_at(file, skip_trivia(file.text(), token.end))
}

fn word_before<'a>(file: &'a File<'a>, at: u32) -> &'a [u8] {
    let before = file.token_before(Span::empty(at));
    before.map_or(&b""[..], |it| it.text())
}

fn unexpected_at<'a>(file: &'a File<'a>, at: u32) -> SyntaxError {
    error(0, token_at(file, at), "Unexpected token", Stage::Fatal)
}

/// oxc's parser gives up at the token at `at`. `wanted`: what it expects there, in backticks.
fn expected<'a>(file: &'a File<'a>, wanted: &str, at: u32) -> SyntaxError {
    let here = token_at(file, at);
    let found = name_of_token(file.slice(here));
    SyntaxError::expected(here, wanted, found.as_bytes()).stage(Stage::Fatal)
}

/// It takes what ends at `at` for a statement, and gives up at what follows on the line.
fn semicolon_after(at: u32) -> SyntaxError {
    SyntaxError::semicolon_after(at)
}

/// The `open` before `at` that nothing closes.
fn opener<'a>(file: &'a File<'a>, at: u32, (open, close): (u8, u8)) -> Option<Span> {
    let mut depth = 0;
    file.tokens_before(Span::empty(at)).find_map(|it| {
        match it.text() {
            [byte] if *byte == close => depth += 1,
            [byte] if *byte == open && depth == 0 => return Some(it.span()),
            [byte] if *byte == open => depth -= 1,
            _ => {}
        }
        None
    })
}

/// It gives up at the token at `at`, after an element of a list in these brackets.
#[optimize(size)]
fn in_list<'a>(file: &'a File<'a>, at: u32, brackets: (u8, u8)) -> SyntaxError {
    let wanted = format!("`,` or `{}`", brackets.1 as char);
    let found = expected(file, &wanted, at).noticed_at(at);
    match opener(file, at, brackets) {
        Some(opened) => found.and(opened, "Opened here"),
        None => found,
    }
}

/// What the expression before a token is in.
enum Around {
    /// After the `?` of a conditional expression, before its `:`.
    Conditional(Span),
    /// A substitution of a template.
    Substitution,
    /// The head of a `for`.
    For,
    /// The parentheses, which open here, of an `if`, a `while`, a `switch` or a `with`.
    Condition(Span),
    /// A list in these brackets.
    List((u8, u8)),
    /// The brackets of `a[b]` or of a computed name.
    Index,
    /// The value of a field of a class.
    Field,
    /// After the `@` of a decorator.
    Decorator,
    Statement,
}

#[optimize(size)]
fn around<'a>(file: &'a File<'a>, at: u32) -> Around {
    let is_object = |open: u32| {
        let mut all = file.hir.exprs.iter();
        all.any(|it| it.pos == open && matches!(it.kind, ExprKind::Object(_)))
    };
    let is_array = |open: u32| {
        let mut all = file.hir.exprs.iter();
        all.any(|it| it.pos == open && matches!(it.kind, ExprKind::Array(_)))
    };
    let starts_member = |at: u32| file.hir.members.iter().any(|it| it.start == at);
    let (mut depth, mut colons) = (0u32, 0u32);
    // Nothing so far but `a.b(c)`.
    let mut is_path = true;
    for it in file.tokens_before(Span::empty(at)) {
        let opened = it.span();
        if depth == 0 {
            let is_word =
                |it: &u8| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$' | 0x80..);
            is_path &= matches!(it.text(), b"." | b")" | b"@") || it.text().iter().all(is_word);
        }
        match it.text() {
            // A piece of a template closes a substitution, opens one, or both.
            [b'}', _, ..] | [b'`', _, ..] => {
                if it.text().ends_with(b"${") {
                    match depth {
                        0 => return Around::Substitution,
                        _ => depth -= 1,
                    }
                }
                depth += u32::from(it.text().starts_with(b"}"));
            }
            b")" | b"]" | b"}" => depth += 1,
            b"(" | b"[" | b"{" if depth > 0 => depth -= 1,
            b"(" => {
                return match word_before(file, opened.start) {
                    b"for" | b"await" => Around::For,
                    b"if" | b"while" | b"switch" | b"with" => Around::Condition(opened),
                    _ => Around::List((b'(', b')')),
                };
            }
            b"[" if is_array(opened.start) => return Around::List((b'[', b']')),
            b"[" => return Around::Index,
            b"{" if is_object(opened.start) => return Around::List((b'{', b'}')),
            b"{" | b";" if depth == 0 => {
                return match starts_member(token_after(file, opened).start) {
                    true => Around::Field,
                    false => Around::Statement,
                };
            }
            b"@" if depth == 0 && is_path => return Around::Decorator,
            _ if depth > 0 => {}
            b":" => colons += 1,
            b"?" if colons == 0 => return Around::Conditional(opened),
            b"?" => colons -= 1,
            _ => {}
        }
    }
    Around::Statement
}

/// What it says at the token at `at`, which cannot follow the expression before it.
#[optimize(size)]
fn after_expression<'a>(file: &'a File<'a>, at: u32) -> SyntaxError {
    match around(file, at) {
        Around::Conditional(question) => expected(file, "`:`", at)
            .noticed_at(at)
            .and(question, "Conditional starts here"),
        Around::Substitution => expected(file, "`}`", at),
        Around::For => expected(file, "`;`", at),
        Around::Condition(opened) => expected(file, "`)`", at)
            .noticed_at(at)
            .and(opened, "Opened here"),
        Around::List(brackets) => in_list(file, at, brackets),
        Around::Index => expected(file, "`]`", at),
        Around::Field => expected(file, "`;`", at),
        Around::Decorator => unexpected_at(file, at),
        Around::Statement => semicolon_after(file.end_of_token_before(at)),
    }
}

/// Where the brackets end that open at `open`.
fn end_of_brackets(text: &[u8], open: u32) -> u32 {
    let (mut at, mut depth) = (open, 0u32);
    while let Some(rest) = text.get(at as usize..).filter(|it| !it.is_empty()) {
        match rest[0] {
            b'[' | b'(' | b'{' => depth += 1,
            b']' | b')' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        at += token_len(rest).max(1) as u32;
        if depth == 0 {
            break;
        }
        at = skip_trivia(text, at);
    }
    at
}

/// The `:` of the annotation whose type starts at `at`, which can be in parentheses.
fn colon_before<'a>(file: &'a File<'a>, mut at: u32) -> u32 {
    while let Some(token) = file.token_before(Span::empty(at)) {
        at = token.span().start;
        if token.text() != b"(" {
            break;
        }
    }
    at
}

/// A function that has no `{` after the `)` that ends at `end`.
#[optimize(size)]
fn without_body<'a>(file: &'a File<'a>, func: &hir::Func, end: u32) -> SyntaxError {
    let mut start = func.anchor;
    if func.kind == FnKind::Decl {
        start = func.start;
        while matches!(file.slice(token_at(file, start)), b"export" | b"default") {
            start = token_after(file, token_at(file, start)).start;
        }
    }
    error(
        0,
        Span::new(start, end),
        "Expected function body",
        Stage::Fatal,
    )
    .help(Cow::Borrowed("Add a function body (`{}`)."))
    .noticed_at(end)
}

/// A variable with a `:` or a `!` at `at`, after its name.
#[optimize(size)]
fn variable_with_type<'a>(
    file: &'a File<'a>,
    it: &hir::VarDecl,
    at: u32,
    all: &mut Vec<SyntaxError>,
) {
    let Some(name) = file.hir.pats.get(it.pat.idx()) else {
        return;
    };
    let head = opener(file, name.pos, (b'(', b')')).map(|it| word_before(file, it.start));
    match head {
        Some(b"catch") => return all.push(expected(file, "`)`", at)),
        Some(b"for" | b"await") => return all.push(expected(file, "`;`", at)),
        _ => {}
    }
    // The declaration ends with the name.
    let message = match (it.kind, name.kind) {
        (VarKind::Using | VarKind::AwaitUsing, _) => "Using declarations must have an initializer.",
        (_, PatKind::Object(_) | PatKind::Array(_)) => {
            "Missing initializer in destructuring declaration"
        }
        (VarKind::Const, _) => "Missing initializer in const declaration",
        _ => "",
    };
    if !message.is_empty() {
        let help = "Add an initializer (e.g. ` = undefined`) here";
        let found = error(0, Span::new(name.pos, name.end), message, Stage::Parser);
        all.push(found.help(Cow::Borrowed(help)));
    }
    all.push(semicolon_after(name.end));
}

/// The keyword at `keyword` of a declaration that only TypeScript has. It is a name to oxc, or nothing that `export` can be before.
fn declaration_keyword<'a>(file: &'a File<'a>, keyword: Span) -> SyntaxError {
    match word_before(file, keyword.start) {
        b"export" => error(0, keyword, "Unexpected token", Stage::Fatal),
        _ => semicolon_after(keyword.end),
    }
}

/// `type a` in the braces of an `import` or an `export`, where `type` is the name for oxc.
#[optimize(size)]
fn type_in_specifier<'a>(file: &'a File<'a>, keyword: Span) -> SyntaxError {
    let braces = (b'{', b'}');
    let next = token_after(file, keyword);
    if file.slice(next) != b"as" {
        return in_list(file, next.start, braces);
    }
    let name = token_after(file, next);
    match file.slice(name) {
        b"}" | b"," => unexpected_at(file, name.start),
        _ => in_list(file, token_after(file, name).start, braces),
    }
}

/// `a ? (b): T => c : d` in a JavaScript file, where `arrow` is `(b): T => c` for TypeScript. For oxc the `:` is that of the
/// conditional expression, and an expression follows it.
#[optimize(size)]
fn type_as_expression<'a>(file: &'a File<'a>, arrow: &hir::Func) -> SyntaxError {
    let (hir, text) = (&file.hir, file.text());
    let Some(mut ty) = hir.types.get(arrow.ret.idx()) else {
        return unexpected_at(file, arrow.anchor);
    };
    let is_word = token_at(file, ty.pos).end == ty.end
        && matches!(ty.kind, TypeNodeKind::Ref { .. } | TypeNodeKind::Keyword(_));
    match ty.kind {
        // An operator that lacks its operand.
        _ if file.slice(Span::new(ty.pos, ty.end)) == b"void" => unexpected_at(file, arrow.anchor),
        // The parameter of an arrow function, or an arrow function. Then nothing can follow but the end of the statement.
        _ if is_word => after_arrow_function(file, arrow),
        TypeNodeKind::Fn(_) => after_arrow_function(file, arrow),
        // `T < U >`
        TypeNodeKind::Ref { args, .. } if !args.is_empty() => unexpected_at(file, arrow.anchor),
        // `T[` and no index.
        TypeNodeKind::Array(_) => {
            while let TypeNodeKind::Array(element) = ty.kind
                && let Some(element) = hir.types.get(element.idx())
                && matches!(element.kind, TypeNodeKind::Array(_))
            {
                ty = element;
            }
            unexpected_at(file, ty.end.saturating_sub(1))
        }
        // An expression that no `=>` can follow.
        _ => semicolon_after(file.end_of_token_before(skip_trivia(text, ty.end))),
    }
}

/// What oxc says at the token after the arrow function `arrow`.
#[optimize(size)]
fn after_arrow_function<'a>(file: &'a File<'a>, arrow: &hir::Func) -> SyntaxError {
    let hir = &file.hir;
    let is_same = |it: &hir::Func| it.anchor == arrow.anchor;
    let is_it = |it: &&hir::Expr| match it.kind {
        ExprKind::Fn(id) => hir.fns.get(id.idx()).is_some_and(is_same),
        _ => false,
    };
    let end = hir
        .exprs
        .iter()
        .find(is_it)
        .map_or(arrow.anchor, |it| it.end);
    after_expression(file, skip_trivia(file.text(), end))
}

/// `export default interface A {}` in a JavaScript file, with its name at `name`. oxc reads it, but for type parameters and the
/// types of properties and parameters.
#[optimize(size)]
fn default_interface<'a>(file: &'a File<'a>, name: u32, all: &mut Vec<SyntaxError>) {
    let (hir, text) = (&file.hir, file.text());
    let Some(it) = hir.interfaces.iter().find(|it| it.name_pos == name) else {
        return;
    };
    let less_than = |list: hir::Span<hir::TypeParamId>| {
        let first = hir
            .type_params
            .get(list.start as usize)
            .filter(|_| !list.is_empty());
        first.map(|it| file.end_of_token_before(it.start).saturating_sub(1))
    };
    let colon = |ty: hir::TypeNodeId| hir.types.get(ty.idx()).map(|it| colon_before(file, it.pos));
    all.extend(less_than(it.type_params).map(|at| expected(file, "`{`", at)));
    for &extended in hir.ids.get(it.extends.range()).unwrap_or_default() {
        let Some(extended) = hir.types.get(extended as usize) else {
            continue;
        };
        let mut token = token_at(file, extended.pos);
        while token.end < extended.end && file.slice(token) != b"<" {
            token = token_after(file, token);
        }
        if file.slice(token) == b"<" && matches!(extended.kind, TypeNodeKind::Ref { .. }) {
            let list = Span::new(token.start, extended.end);
            let message = "Type arguments can only be used in TypeScript files.";
            all.push(error(8011, list, message, Stage::Parser).noticed_at(list.end));
        }
    }
    for member in hir.members.get(it.members.range()).unwrap_or_default() {
        let Some(func) = hir.fns.get(member.func.idx()) else {
            let after_name = |colon: u32| semicolon_after(file.end_of_token_before(colon));
            all.extend(colon(member.ty).map(after_name));
            continue;
        };
        let params = hir.params.get(func.params.range()).unwrap_or_default();
        if func.kind == FnKind::IndexSignature {
            let key = params.first().and_then(|it| hir.pats.get(it.pat.idx()));
            all.extend(key.map(|it| unexpected_at(file, skip_trivia(text, it.end))));
            continue;
        }
        all.extend(less_than(func.type_params).map(|at| expected(file, "`(`", at)));
        let typed = params.iter().filter_map(|it| colon(it.ty));
        all.extend(typed.map(|at| in_list(file, at, (b'(', b')'))));
    }
}

/// What oxc's parser says about what TypeScript's parser has noted in a JavaScript file. The parser has those about modifiers and
/// decorators itself.
#[optimize(size)]
fn of_javascript<'a>(file: &'a File<'a>, it: &Diagnostic, all: &mut Vec<SyntaxError>) {
    if file.is_in_jsdoc(it.start) {
        return;
    }
    let (hir, text) = (&file.hir, file.text());
    let argument = it.args.first().map_or(&b""[..], |it| &it[..]);
    let first = token_at(file, it.start);
    let is_it = |ty: hir::TypeNodeId| {
        let ty = hir.types.get(ty.idx());
        ty.is_some_and(|ty| (ty.pos, ty.end) == (it.start, it.end))
    };
    let follows_name = |pat: hir::PatId| {
        let name = hir.pats.get(pat.idx());
        name.is_some_and(|name| skip_trivia(text, name.end) == it.start)
    };
    let found = match it.code {
        8010 => {
            let colon = colon_before(file, it.start);
            let before_colon = file.end_of_token_before(colon);
            if let Some(it) = hir.var_decls.iter().find(|it| is_it(it.ty)) {
                return variable_with_type(file, it, colon, all);
            }
            if let Some(index) = hir.params.iter().position(|it| is_it(it.ty)) {
                let mut signatures = hir
                    .fns
                    .iter()
                    .filter(|it| it.kind == FnKind::IndexSignature);
                match signatures.any(|it| it.params.range().contains(&index)) {
                    true => unexpected_at(file, colon),
                    false => in_list(file, colon, (b'(', b')')),
                }
            } else if let Some(member) = hir.members.iter().find(|it| is_it(it.ty)) {
                match member.flags.contains(Flags::ACCESSOR) {
                    true => semicolon_after(before_colon),
                    false => expected(file, "`;`", colon),
                }
            } else if let Some(func) = hir.fns.iter().find(|it| is_it(it.ret)) {
                let open = file.end_of_token_before(before_colon.saturating_sub(1));
                match func.kind {
                    FnKind::Expr => expected(file, "`{`", colon),
                    FnKind::Arrow if text.get(open.wrapping_sub(1) as usize) == Some(&b'(') => {
                        let message = "Empty parenthesized expression";
                        error(0, Span::new(open - 1, before_colon), message, Stage::Fatal)
                    }
                    // The `:` is that of the conditional expression, and the type the parameter of an arrow function.
                    FnKind::Arrow if matches!(around(file, colon), Around::Conditional(_)) => {
                        type_as_expression(file, func)
                    }
                    FnKind::Arrow => after_expression(file, colon),
                    _ => without_body(file, func, before_colon),
                }
            } else {
                unexpected_at(file, colon)
            }
        }
        // A function without a body, from its start to its end.
        8017 => {
            let is_in_it = |func: &&hir::Func| {
                matches!(func.body, hir::FnBody::None) && (it.start..it.end).contains(&func.anchor)
            };
            let Some(func) = hir.fns.iter().filter(is_in_it).min_by_key(|it| it.anchor) else {
                return all.push(unexpected_at(file, it.start));
            };
            let key = hir.params.get(func.params.start as usize);
            let key = key.and_then(|it| hir.pats.get(it.pat.idx()));
            match (func.kind, key) {
                // `[a` starts a computed name.
                (FnKind::IndexSignature, Some(key)) => {
                    unexpected_at(file, skip_trivia(text, key.end))
                }
                // The parameters are missing, which TypeScript's parser has said.
                _ if text.get(func.anchor as usize) != Some(&b'(') => return,
                _ => without_body(file, func, end_of_brackets(text, func.anchor)),
            }
        }
        // Type parameters, after the `<`.
        8004 => {
            let less_than = file.end_of_token_before(it.start).saturating_sub(1);
            let name = file.token_before(Span::empty(less_than));
            let is_class = name.is_some_and(|it| {
                it.text() == b"class" || word_before(file, it.span().start) == b"class"
            });
            match is_class {
                true => expected(file, "`{`", less_than),
                false => expected(file, "`(`", less_than),
            }
        }
        8009 if argument == b"?" => {
            let is_it =
                |it: &hir::Param| it.flags.contains(Flags::OPTIONAL) && follows_name(it.pat);
            let Some(index) = hir.params.iter().position(is_it) else {
                // oxc takes it after the name of a member of a class.
                return;
            };
            // Only what follows the first name tells oxc that parentheses are the head of an arrow function. Else it reads
            // an expression when it fails on them.
            let is_name = |it: &hir::Param| {
                let name = hir.pats.get(it.pat.idx());
                name.is_some_and(|it| matches!(it.kind, PatKind::Ident(_)))
            };
            let is_expression = |it: &hir::Func| {
                it.kind == FnKind::Arrow
                    && it.params.range().contains(&index)
                    && (it.params.start as usize != index
                        || it.this_param.is_some()
                        || !hir.params.get(index).is_some_and(is_name))
            };
            match hir.fns.iter().any(is_expression) {
                true => unexpected_at(file, token_after(file, first).start),
                false => in_list(file, it.start, (b'(', b')')),
            }
        }
        8009 | 8012 | 1042 | 1206 | 8038 => return,
        8011 => {
            let less_than = file.end_of_token_before(it.start).saturating_sub(1);
            let last = match it.end {
                Diagnostic::NO_LENGTH => it.start,
                end => end,
            };
            let list = Span::new(less_than, skip_trivia(text, last) + 1);
            let message = "Type arguments can only be used in TypeScript files.";
            error(8011, list, message, Stage::Parser).noticed_at(list.end)
        }
        8005 => {
            let message = "'implements' clauses can only be used in TypeScript files.";
            error(8005, first, message, Stage::Parser)
        }
        8016 | 8037 => {
            let is_cast = |cast: &&hir::Expr| {
                cast.end == it.end
                    && matches!(
                        cast.kind,
                        ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. }
                    )
            };
            let Some(cast) = hir.exprs.iter().filter(is_cast).min_by_key(|it| it.pos) else {
                return all.push(unexpected_at(file, it.start));
            };
            let message = match it.code {
                8016 => "Type assertion expressions can only be used in TypeScript files.",
                _ => "Type satisfaction expressions can only be used in TypeScript files.",
            };
            let whole = Span::new(cast.pos, cast.end);
            error(it.code as u16, whole, message, Stage::Parser).noticed_at(cast.end)
        }
        // `let !a`, where a statement starts: oxc wants the name of a variable. As the body of a statement `let` is a name.
        8013 if file.slice(first) == b"let"
            && token_after(file, first).end == it.end
            && !matches!(word_before(file, it.start), b")" | b"else" | b"do")
            && file.hir.stmts.iter().any(|stmt| stmt.start == it.start) =>
        {
            unexpected_at(file, it.end.saturating_sub(1))
        }
        // `a!`
        8013 => after_expression(file, it.end.saturating_sub(1)),
        8006 => match argument {
            b"enum" => return,
            b"import type" => {
                let name = token_after(file, token_after(file, first));
                match file.slice(name) {
                    b"from" => unexpected_at(file, token_after(file, name).start),
                    _ => expected(file, "`from`", name.start),
                }
            }
            b"export type" | b"export as namespace" => {
                unexpected_at(file, token_after(file, first).start)
            }
            b"import...type" | b"export...type" => type_in_specifier(file, first),
            // At the statement, which has no name that is a word.
            b"module" if file.slice(first) == b"export" => {
                unexpected_at(file, token_after(file, first).start)
            }
            b"module" if matches!(file.slice(first), b"module" | b"declare") => {
                semicolon_after(first.end)
            }
            // At the name.
            _ => match file.token_before(first) {
                // oxc takes `export default interface A {}` in every file.
                Some(keyword) if word_before(file, keyword.span().start) == b"default" => {
                    return default_interface(file, it.start, all);
                }
                // The `b` of `namespace a.b`.
                Some(keyword) if keyword.text() == b"." => return,
                Some(keyword) => declaration_keyword(file, keyword.span()),
                None => unexpected_at(file, it.start),
            },
        },
        // A type alias, at its name.
        8008 => match file.token_before(first) {
            Some(keyword) => declaration_keyword(file, keyword.span()),
            None => unexpected_at(file, it.start),
        },
        8002 => {
            let keyword = match file.slice(first) {
                b"export" => token_after(file, first),
                _ => first,
            };
            let name = token_after(file, keyword);
            let after_name = token_after(file, name);
            if file.slice(name) == b"type" && file.slice(after_name) != b"=" {
                return all.push(expected(file, "`from`", after_name.start));
            }
            let message = "'import ... =' can only be used in TypeScript files.";
            let help = "TypeScript transforms 'import ... =' to 'const ... ='";
            error(
                8002,
                Span::new(keyword.start, it.end),
                message,
                Stage::Parser,
            )
            .help(Cow::Borrowed(help))
        }
        8003 => unexpected_at(file, token_after(file, first).start),
        // The `!` after a name. The parser has that of a property.
        1255 => {
            let is_definite =
                |it: &&hir::VarDecl| it.flags.contains(Flags::DEFINITE) && follows_name(it.pat);
            match hir.var_decls.iter().find(is_definite) {
                Some(variable) => return variable_with_type(file, variable, it.start, all),
                None => return,
            }
        }
        // A parameter `this`.
        1003 => {
            let is_this = |func: &&hir::Func| {
                let first = hir.params.get(func.this_param.idx());
                let others = hir.params.get(func.params.range()).unwrap_or_default();
                let mut all = first.into_iter().chain(others);
                func.kind == FnKind::Arrow && all.any(|this| this.pos == it.start)
            };
            match hir.fns.iter().find(is_this) {
                // In parentheses it is an expression.
                Some(arrow) => after_expression(file, arrow.anchor),
                None => {
                    let message =
                        "Identifier expected. 'this' is a reserved word that cannot be used here.";
                    error(0, first, message, Stage::Fatal)
                }
            }
        }
        _ => unexpected_at(file, it.start),
    };
    all.push(found);
}

/// `<T>a` and `<T>() => a` in a `.mts` or `.cts` file, where they could be JSX.
fn reserved_in_mts_and_cts<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
    let hir = &file.hir;
    for (i, raw) in hir.exprs.iter().enumerate() {
        let is_cast = matches!(raw.kind, ExprKind::As { .. } | ExprKind::AsConst(_));
        if !is_cast || file.expr_in_tree(i).is_none() {
            continue;
        }
        let cast = Expr::from_raw(file, i as u32);
        if cast.is_angle_bracket_assertion() {
            let message = "This syntax is reserved in files with the .mts or .cts extension. Use an `as` expression instead.";
            all.push(error(7059, cast.span(), message, Stage::Parser).noticed_at(cast.span().end));
        }
    }
    for (i, raw) in hir.fns.iter().enumerate() {
        let is_in_tree = (file.bound.fns.get(i)).is_some_and(|it| it.owner != FnOwner::None);
        if raw.kind != FnKind::Arrow || raw.type_params.len != 1 || !is_in_tree {
            continue;
        }
        let Some(only) = hir.type_params.get(raw.type_params.start as usize) else {
            continue;
        };
        let after = skip_trivia(file.text(), only.end) as usize;
        if only.constraint.is_none() && file.text().get(after) != Some(&b',') {
            let name = file.text().get(only.pos as usize..).unwrap_or_default();
            let name = Span::new(only.pos, only.pos + token_len(name) as u32);
            let message = "This syntax is reserved in files with the .mts or .cts extension. Add a trailing comma or explicit constraint.";
            all.push(error(7060, name, message, Stage::Parser));
        }
    }
}

/// The errors that the parser has noted for oxc, and those of its own notes that oxc has too. Nothing is asked of the scopes or
/// of what is around a node, so a tree with holes will do.
///
/// `stop`: which of the diagnostics is the one at which oxc's parser gives up. What is noted after it is noted on a way that
/// oxc's does not go, unless oxc notices it before that place: the parser looks at the modifiers of a member when it has all of
/// the member. What is noted about JavaScript is added when the parser is through.
#[optimize(size)]
pub(super) fn noted<'a>(file: &'a File<'a>, stop: Option<usize>) -> Vec<SyntaxError> {
    let diagnostics = &file.hir.diagnostics;
    let gives_up_at = stop.and_then(|it| diagnostics.get(it)).map(|it| it.start);
    let (mut all, mut found) = (Vec::new(), Vec::new());
    for (place, it) in diagnostics.iter().enumerate() {
        match it.kind {
            DiagnosticKind::Js => of_javascript(file, it, &mut found),
            _ => found.extend(of_parser(file, it)),
        }
        let is_late = it.kind == DiagnosticKind::Js || stop.is_some_and(|stop| place > stop);
        let is_in_time = |it: &SyntaxError| gives_up_at.is_none_or(|at| it.order() < at);
        all.extend(found.drain(..).filter(|it| !is_late || is_in_time(it)));
    }
    all
}

/// `has_scopes`: not for oxfmt, whose file has no symbols. What needs them is of the pass that builds the scopes, which oxfmt does
/// not run.
pub(super) fn errors<'a>(file: &'a File<'a>, has_scopes: bool) -> Vec<SyntaxError> {
    let mut all = noted(file, None);
    if file.is_javascript() {
        if file.has_rare_syntax(rare::NESTED_MODULE_SYNTAX) {
            nested_module_syntax(file, &mut all);
        }
        return all;
    }
    modules(file, &mut all);
    if matches!(file.path(), [.., b'.', b'm' | b'c', b't', b's']) {
        reserved_in_mts_and_cts(file, &mut all);
    }
    if file.has_rare_syntax(rare::TYPE_PARAMETER_MODIFIER) {
        type_parameters(file, &mut all);
    }
    if file.has_rare_syntax(rare::JSDOC_TYPE) {
        jsdoc_types(file, &mut all);
    }
    if file.has_rare_syntax(rare::TYPE_PREDICATE) {
        type_predicates(file, &mut all);
    }
    if file.has_rare_syntax(rare::ODD_LOOP_HEAD) {
        loop_heads(file, has_scopes, &mut all);
    }
    all
}
