//! The errors about TypeScript's syntax that TypeScript's checker reports, and that oxc reports from its parser or from the pass
//! that builds its scopes: `function f(a?, b) {}`, `declare let a = 1`, `class A { abstract m() {} }`.
//!
//! The parser finds most of them on its way, under `Dialect::oxc`: `bun_sema_parser`'s `oxc.rs` has the conditions and the
//! texts, and says how an error is written down. Here are those that depend on what is around a node. Each is behind a bit of
//! `hir::rare` that the parser sets, or goes through a list that nearly every file has empty.
//!
//! Every condition, text and label was measured on oxlint 1.87.

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
fn of_parser<'a>(file: &'a File<'a>, it: &Diagnostic) -> Option<SyntaxError> {
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
        1183 => {
            let message =
                "Expected a semicolon or an implicit semicolon after a statement, but found none";
            let at = Span::empty(file.end_of_token_before(it.start));
            error(0, at, message, Stage::Fatal)
                .help(Cow::Borrowed("Try inserting a semicolon here"))
        }
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
        1019 | 1098 | 1099 | 5085 | 5086 | 5087 if is_typescript => {
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
        1047 | 1051 | 1092 | 1235 | 1326 | 7061 => {
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
    SyntaxError::of_oxc(at, message.as_bytes().to_vec())
        .code(code)
        .stage(stage)
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
                    Some(error(2435, whole(), message, Stage::Semantic))
                }
                _ => {
                    let message =
                        "An ambient module declaration is only allowed at the top level in a file.";
                    Some(error(1234, whole(), message, Stage::Semantic))
                }
            });
            continue;
        }
        if !matches!(parent, Parent::File | Parent::Module(_)) {
            let message = "A namespace declaration is only allowed at the top level of a namespace or module.";
            all.push(error(1235, whole(), message, Stage::Semantic));
        }
        if raw.name == ModuleName::Global && !is_ambient {
            let message = "Augmentations for the global scope should have 'declare' modifier unless they appear in already ambient context.";
            let keyword = Span::new(raw.name_pos, raw.name_pos + 6);
            all.push(error(2670, keyword, message, Stage::Semantic));
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
fn loop_heads<'a>(file: &'a File<'a>, all: &mut Vec<SyntaxError>) {
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
                && !is_strict_mode(Node::Stmt(Stmt::from_raw(file, i as u32)).scope(), file);
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

pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    let mut all: Vec<SyntaxError> = (file.hir.diagnostics.iter())
        .filter_map(|it| of_parser(file, it))
        .collect();
    if file.is_javascript() {
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
        loop_heads(file, &mut all);
    }
    all
}
