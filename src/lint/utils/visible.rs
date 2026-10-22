//! Syntax-only checks of what kind of value an expression is, for rules that run without type information and have a
//! fix that is only correct for some kinds of values. Every function here returns `false` or `None` when in doubt. They
//! need scope analysis, so only call them from [`Report::fix_where_safe`] or from the function that builds the fix.
//!
//! [`Report::fix_where_safe`]: crate::context::Report::fix_where_safe

use crate::ast::{
    BinOp, Expr, ExprKind, ExprTag, File, Interface, Keyword, Name, Node, Stmt, StmtKind, StmtTag,
    TypeKind, TypeNode,
};
use crate::semantic::{Declaration, Symbol};

/// True for `export let a` directly inside a `namespace`. Any file can write `Namespace.a = 1`, which doesn't count as
/// a reference to `a`.
pub fn is_exported_from_namespace(statement: Stmt<'_>) -> bool {
    statement.is_exported()
        && matches!(statement.parent(), Node::Stmt(parent) if parent.as_module().is_some())
}

/// True for an `import` or an `export`. Either one makes the file a module.
fn makes_a_module(statement: Stmt<'_>) -> bool {
    statement.is_exported()
        || matches!(
            statement.tag(),
            StmtTag::Import
                | StmtTag::ExportNamed
                | StmtTag::ExportStar
                | StmtTag::ExportDefault
                | StmtTag::ExportAssign
        )
}

/// True if the file is still a module after every `export {}` is removed.
pub fn is_module_without_empty_exports<'a>(file: &'a File<'a>) -> bool {
    let is_empty = |it: Stmt<'a>| matches!(it.kind(), StmtKind::ExportNamed(export) if !export.has_from() && export.items().is_empty());
    let mut statements = file.body().iter();
    statements.any(|it| makes_a_module(it) && !is_empty(it))
}

/// True if the file declares `interface`'s name more than once. Replacing the interface with a type alias would then be
/// a duplicate declaration.
pub fn is_declared_again(interface: Interface<'_>) -> bool {
    let scope = Node::Stmt(interface.stmt()).scope();
    let symbol = scope.resolve_name(interface.name().name());
    symbol.is_some_and(|it| it.declaration_count() > 1)
}

/// True if nothing in the file merges with `interface`. No other interface, class or namespace has its name, and it
/// isn't somewhere other files usually extend it: a declaration file, a `namespace` or a `declare module`. Callers need
/// this because a type alias doesn't merge, and a property doesn't merge with a method. Another file can still extend
/// an interface at the top level of a script. That isn't visible from this file, but the type checker reports the
/// conflict as soon as the fix is applied.
pub fn is_only_declaration(interface: Interface<'_>) -> bool {
    let statement = interface.stmt();
    let is_in_namespace = || {
        let mut enclosing_nodes = Node::Stmt(statement).ancestors();
        enclosing_nodes.any(|it| matches!(it, Node::Stmt(it) if it.as_module().is_some()))
    };
    !is_declared_again(interface) && !statement.file().is_declaration_file() && !is_in_namespace()
}

/// Returns `e` without type wrappers like `as T`. If `e` is a variable that is declared once with an initializer and
/// never reassigned, returns the initializer instead.
pub fn visible_value(e: Expr<'_>) -> Expr<'_> {
    let e = e.skip_type_wrappers();
    let is_constant = |it: &Symbol| it.declaration_count() == 1 && !it.has_modifying_references();
    let declaration = e
        .symbol()
        .filter(is_constant)
        .and_then(|it| it.declarations().next());
    let Some(Declaration::Var(pat)) = declaration else {
        return e;
    };
    // Skip names bound by a destructuring pattern.
    let Node::VarDecl(declarator) = pat.parent() else {
        return e;
    };
    if matches!(declarator.parent(), Node::Stmt(statement) if is_exported_from_namespace(statement))
    {
        return e;
    }
    declarator.init().map_or(e, Expr::skip_type_wrappers)
}

/// Returns the keyword type of a variable or parameter that is declared once, e.g. `string` for `a: string`.
fn declared_keyword(e: Expr<'_>) -> Option<Keyword> {
    let symbol = e.symbol().filter(|it| it.declaration_count() == 1)?;
    let ty = match symbol.declarations().next()? {
        Declaration::Var(pat) => match pat.parent() {
            Node::VarDecl(declarator) => declarator.ty(),
            _ => None,
        },
        Declaration::Param(pat) => match pat.parent() {
            Node::Param(param) => param.ty(),
            _ => None,
        },
        _ => None,
    };
    match ty.map(TypeNode::kind) {
        Some(TypeKind::Keyword(keyword)) => Some(keyword),
        _ => None,
    }
}

/// Returns the specifier of the module that `e` refers to: `"fs"` for `fs` after `import fs from "fs"`,
/// `import * as fs from "fs"` or `const fs = require("fs")`.
pub fn visible_module(e: Expr<'_>) -> Option<Name<'_>> {
    let declaration = e.symbol().and_then(|it| it.declarations().next());
    if let Some(Declaration::ImportDefault(import) | Declaration::ImportNamespace(import)) =
        declaration
    {
        return Some(import.spec());
    }
    let ExprKind::Call(call) = visible_value(e).kind() else {
        return None;
    };
    match call.args().first().map(Expr::kind) {
        Some(ExprKind::String(name)) if is_global(call.callee(), "require") => Some(name),
        _ => None,
    }
}

/// True if `e` is the identifier `name` and nothing in the file declares it, so it refers to the global.
pub fn is_global(e: Expr<'_>, name: &str) -> bool {
    e.is_ident(name) && e.symbol().is_none()
}

/// True for an array literal, `new Array(..)`, `Array(..)`, `Array.from(..)`, `Array.of(..)`, or a variable that is
/// always one of these.
pub fn is_visibly_array(e: Expr<'_>) -> bool {
    let value = visible_value(e);
    match value.kind() {
        ExprKind::Array(_) => true,
        ExprKind::New(call) => is_global(call.callee(), "Array"),
        ExprKind::Call(call) => match call.callee().kind() {
            ExprKind::Dot { obj, name, .. } => {
                name.name().is_any(&["from", "of"]) && is_global(obj, "Array")
            }
            _ => is_global(call.callee(), "Array"),
        },
        _ => false,
    }
}

/// True for an [array](is_visibly_array), a [string](is_visibly_string), `new Set(..)`, `new Map(..)`, or a variable
/// that is always one of these.
pub fn is_visibly_iterable(e: Expr<'_>) -> bool {
    let is_collection = |callee: Expr| is_global(callee, "Set") || is_global(callee, "Map");
    is_visibly_array(e)
        || is_visibly_string(e)
        || matches!(visible_value(e).kind(), ExprKind::New(call) if is_collection(call.callee()))
}

/// True for a string literal, a template literal, `String(..)`, a `+` with either kind of literal as an operand, a
/// variable that is always one of these, or a variable or parameter declared as `string`.
pub fn is_visibly_string(e: Expr<'_>) -> bool {
    if declared_keyword(e) == Some(Keyword::String) {
        return true;
    }
    let value = visible_value(e);
    match value.kind() {
        ExprKind::String(_) => !value.is_jsx_text(),
        ExprKind::Template(_) => true,
        ExprKind::Call(call) => is_global(call.callee(), "String"),
        ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } => {
            let is_text = |it: Expr| matches!(it.tag(), ExprTag::String | ExprTag::Template);
            is_text(left.skip_type_wrappers()) || is_text(right.skip_type_wrappers())
        }
        _ => false,
    }
}

/// True for `document`, `document.body`, `document.createElement(..)`, `document.querySelector(..)` and the like, or a
/// variable that is always one of these. `document` is matched by name only, because a file that declares its own
/// `document` gets it from a DOM library.
pub fn is_visibly_dom_node(e: Expr<'_>) -> bool {
    const PROPERTIES: [&str; 3] = ["body", "documentElement", "head"];
    const METHODS: [&str; 5] = [
        "createDocumentFragment",
        "createElement",
        "createElementNS",
        "getElementById",
        "querySelector",
    ];
    match visible_value(e).kind() {
        ExprKind::Ident(name) => name.is("document"),
        ExprKind::Dot { obj, name, .. } => {
            obj.is_ident("document") && name.name().is_any(&PROPERTIES)
        }
        ExprKind::Call(call) => matches!(call.callee().kind(), ExprKind::Dot { obj, name, .. }
            if obj.is_ident("document") && name.name().is_any(&METHODS)),
        _ => false,
    }
}

/// Result of [`visible_regexp`].
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum VisibleRegExp {
    /// A literal without the `g` flag.
    NotGlobal,
    /// A literal with the `g` flag, or `new RegExp(..)`, whose flags aren't checked.
    MaybeGlobal,
}

/// Returns `Some` for a regular expression literal, `new RegExp(..)`, `RegExp(..)`, or a variable that is always one
/// of these.
pub fn visible_regexp(e: Expr<'_>) -> Option<VisibleRegExp> {
    match visible_value(e).kind() {
        ExprKind::Regex(regex) => Some(
            match bun_core::strings::contains_char(regex.flags(), b'g') {
                true => VisibleRegExp::MaybeGlobal,
                false => VisibleRegExp::NotGlobal,
            },
        ),
        ExprKind::New(call) | ExprKind::Call(call) => {
            is_global(call.callee(), "RegExp").then_some(VisibleRegExp::MaybeGlobal)
        }
        _ => None,
    }
}
