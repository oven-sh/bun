//! For a fix that is only right for a value of some kind, in a rule without types: what the code itself shows about a value.
//! Everything here answers `false` when in doubt. It asks about scopes, so call it from [`Report::fix_where_safe`] or from the
//! function that makes the fix.
//!
//! [`Report::fix_where_safe`]: crate::context::Report::fix_where_safe

use crate::ast::{
    BinOp, Expr, ExprKind, ExprTag, File, Interface, Keyword, Name, Node, Stmt, StmtKind, StmtTag,
    TypeKind, TypeNode,
};
use crate::semantic::{Declaration, Symbol};

/// `export let a` directly in a `namespace`. Any file can write `Namespace.a = 1`, which is no reference to `a`.
pub fn is_exported_from_namespace(statement: Stmt<'_>) -> bool {
    statement.is_exported()
        && matches!(statement.parent(), Node::Stmt(parent) if parent.as_module().is_some())
}

/// An `import` or an `export`, which makes a module of the file.
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

/// Whether the file stays a module when every `export {}` is removed.
pub fn is_module_without_empty_exports<'a>(file: &'a File<'a>) -> bool {
    let is_empty = |it: Stmt<'a>| matches!(it.kind(), StmtKind::ExportNamed(export) if !export.has_from() && export.items().is_empty());
    let mut statements = file.body().iter();
    statements.any(|it| makes_a_module(it) && !is_empty(it))
}

/// Whether the file declares the name of `interface` a second time. A type alias in its place would be a duplicate declaration.
pub fn is_declared_again(interface: Interface<'_>) -> bool {
    let scope = Node::Stmt(interface.stmt()).scope();
    let symbol = scope.resolve_name(interface.name().name());
    symbol.is_some_and(|it| it.declaration_count() > 1)
}

/// Whether the file shows nothing that merges with `interface`: no other interface, class or namespace of that name, and it isn't
/// where other files usually add to it, which is a declaration file, a `namespace` and a `declare module`. A type alias doesn't
/// merge, and neither does a property with a method. Another file can still add to an interface at the top of a script. That can't
/// be seen from here, and the type checker says so at once.
pub fn is_only_declaration(interface: Interface<'_>) -> bool {
    let statement = interface.stmt();
    let is_in_namespace = || {
        let mut around = Node::Stmt(statement).ancestors();
        around.any(|it| matches!(it, Node::Stmt(it) if it.as_module().is_some()))
    };
    !is_declared_again(interface) && !statement.file().is_declaration_file() && !is_in_namespace()
}

/// `e` without `as T` and the like. For a variable that is declared once, with a value, and never assigned again: that value.
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
    // Not a name in a destructuring pattern.
    let Node::VarDecl(declarator) = pat.parent() else {
        return e;
    };
    if matches!(declarator.parent(), Node::Stmt(statement) if is_exported_from_namespace(statement))
    {
        return e;
    }
    declarator.init().map_or(e, Expr::skip_type_wrappers)
}

/// The `string` of `a: string`, for a variable or a parameter that is declared once, with a keyword as its type.
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

/// The module that `e` is: `fs` after `import fs from "fs"`, `import * as fs from "fs"` or `const fs = require("fs")`.
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

/// The global `name`, which nothing in the file declares.
pub fn is_global(e: Expr<'_>, name: &str) -> bool {
    e.is_ident(name) && e.symbol().is_none()
}

/// An array literal, `new Array(..)`, `Array(..)`, `Array.from(..)`, `Array.of(..)`, or a variable that is always one of these.
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

/// An [array](is_visibly_array), a [string](is_visibly_string), `new Set(..)`, `new Map(..)`, or a variable that is always one of
/// these.
pub fn is_visibly_iterable(e: Expr<'_>) -> bool {
    let is_collection = |callee: Expr| is_global(callee, "Set") || is_global(callee, "Map");
    is_visibly_array(e)
        || is_visibly_string(e)
        || matches!(visible_value(e).kind(), ExprKind::New(call) if is_collection(call.callee()))
}

/// A string literal, a template, `String(..)`, a `+` with one of these, a variable that is always one of these, or one that is
/// declared as `string`.
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

/// `document`, `document.body`, `document.createElement(..)`, `document.querySelector(..)` and the like, or a variable that is always
/// one of these. By the name: a file that declares its own `document` has it from a DOM library.
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

/// What is known about a regular expression.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum VisibleRegExp {
    /// A literal without the `g` flag.
    NotGlobal,
    /// A literal with the `g` flag, or `new RegExp(..)`, whose flags aren't looked at.
    MaybeGlobal,
}

/// A regular expression literal, `new RegExp(..)`, `RegExp(..)`, or a variable that is always one of these.
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
