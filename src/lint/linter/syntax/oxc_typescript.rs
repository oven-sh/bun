//! The errors about TypeScript's syntax that TypeScript's checker reports, and that oxc reports from its parser or from the pass
//! that builds its scopes: `function f(a?, b) {}`, `declare let a = 1`, `class A { abstract m() {} }`.
//!
//! The parser finds most of them on its way, under `Dialect::oxc`: `bun_sema_parser`'s `oxc.rs` has the conditions and the
//! texts, and says how an error is written down. Here are those that depend on what is around a node. Each is behind a bit of
//! `hir::rare` that the parser sets, or goes through a list that nearly every file has empty.
//!
//! Every condition, text and label was measured on oxlint 1.87.

use super::{Stage, SyntaxError};
use crate::ast::{File, Handle, Node, Stmt, TypeNode, TypeParam};
use crate::span::Span;
use crate::tokens::token_len;
use bun_sema::bind::Parent;
use bun_sema::hir::{
    self, Diagnostic, DiagnosticKind, Flags, FnKind, JSDocTypeKind, ModifierKind, ModuleName,
    StmtKind, TypeNodeKind, rare,
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
fn of_parser(it: &Diagnostic) -> Option<SyntaxError> {
    let stage = match it.kind {
        DiagnosticKind::Oxc => Stage::Parser,
        DiagnosticKind::OxcFatal => Stage::Fatal,
        DiagnosticKind::OxcSemantic => Stage::Semantic,
        DiagnosticKind::Grammar => return of_grammar(it),
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

/// An error that TypeScript's parser notes for the checker, where oxc's parser reports the same code.
fn of_grammar(it: &Diagnostic) -> Option<SyntaxError> {
    let (code, message, help) = match it.code {
        1019 => (
            1019,
            "An index signature parameter cannot have a question mark.",
            "",
        ),
        1025 => (
            0,
            "Index signature declarations may not have a trailing comma.",
            "Remove the trailing comma here",
        ),
        1099 => (1099, "Type argument list cannot be empty.", ""),
        _ => return None,
    };
    // 0: the token there, which is one character.
    let span = match it.end {
        0 => Span::new(it.start, it.start + 1),
        _ => span_of(it),
    };
    let error = SyntaxError::of_oxc(span, message.as_bytes().to_vec());
    Some(
        error
            .code(code)
            .help(Cow::Borrowed(help))
            .stage(Stage::Parser),
    )
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

pub(super) fn errors<'a>(file: &'a File<'a>) -> Vec<SyntaxError> {
    if file.is_javascript() {
        return Vec::new();
    }
    let mut all: Vec<SyntaxError> = (file.hir.diagnostics.iter())
        .filter_map(of_parser)
        .collect();
    modules(file, &mut all);
    if file.has_rare_syntax(rare::TYPE_PARAMETER_MODIFIER) {
        type_parameters(file, &mut all);
    }
    if file.has_rare_syntax(rare::JSDOC_TYPE) {
        jsdoc_types(file, &mut all);
    }
    if file.has_rare_syntax(rare::TYPE_PREDICATE) {
        type_predicates(file, &mut all);
    }
    all
}
