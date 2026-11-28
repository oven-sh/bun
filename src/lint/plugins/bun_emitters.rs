//! Follows an event emitter to see whether it gets an `error` listener.

use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::static_string;
use rustc_hash::FxHashMap;

/// The methods that add a listener. They return the emitter.
pub(crate) const LISTEN: [&str; 5] = [
    "addListener",
    "on",
    "once",
    "prependListener",
    "prependOnceListener",
];

/// For `receiver.name(..)`, returns the name, the call, and the whole call expression.
pub(crate) fn method_call<'a>(receiver: Expr<'a>) -> Option<(Name<'a>, Call<'a>, Expr<'a>)> {
    let member = receiver.parent().as_expr()?;
    let whole = member.parent().as_expr()?;
    match (member.kind(), whole.as_call()) {
        (ExprKind::Dot { obj, name, .. }, Some(call))
            if obj == receiver && call.callee() == member =>
        {
            Some((name.name(), call, whole))
        }
        _ => None,
    }
}

/// Caches whether a variable has a listener, by [`Symbol::key`]. Many emitters can be assigned to one variable.
pub(crate) type Known = FxHashMap<usize, bool>;

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Emitter {
    Plain,
    /// It has `addEventListener` and `onerror` too.
    EventTarget,
}

pub(crate) fn has_listener(variable: Symbol, kind: Emitter) -> bool {
    let is_exported = |it: Declaration| matches!(it.parent(), Some(Node::Stmt(statement)) if statement.is_exported());
    // A reference that isn't an expression, as in `export { a }`, can't be followed.
    let mut uses = variable
        .references()
        .filter(|it| !it.is_init())
        .map(Reference::expr);
    variable.declarations().any(is_exported)
        || uses.any(|it| it.is_none_or(|e| is_handled_or_escapes(e, kind, None)))
}

/// True if the emitter `e` gets an `error` listener, or escapes to where we can't tell. `known` is passed if `e` isn't
/// itself a reference to a variable. In that case, a variable that `e` is assigned to is checked too.
pub(crate) fn is_handled_or_escapes(
    mut e: Expr,
    kind: Emitter,
    mut known: Option<&mut Known>,
) -> bool {
    let mut is_emitter = true;
    loop {
        if let Node::Expr(wrapper) = e.parent()
            && matches!(
                wrapper.tag(),
                ExprTag::As | ExprTag::Satisfies | ExprTag::NonNull
            )
        {
            e = wrapper;
            continue;
        }
        let Some((name, call, whole)) = method_call(e) else {
            break;
        };
        let listens = name.is_any(&LISTEN);
        if (listens || kind == Emitter::EventTarget && name.is("addEventListener"))
            && call
                .args()
                .first()
                .and_then(static_string)
                .is_some_and(|it| it.is("error"))
        {
            return true;
        }
        // `pipe` returns the destination stream, not the emitter.
        if name.is("pipe") {
            return false;
        }
        is_emitter &= listens;
        e = whole;
    }
    let mut variable_has_listener =
        |variable: Option<Symbol>| match (variable, known.as_deref_mut()) {
            (Some(variable), Some(known)) if is_emitter => *known
                .entry(variable.key())
                .or_insert_with(|| has_listener(variable, kind)),
            _ => true,
        };
    match e.parent() {
        Node::Stmt(statement) => statement.tag() != StmtTag::Expr,
        // A destructured property isn't the emitter.
        Node::VarDecl(declaration) => declaration
            .pat()
            .symbol()
            .is_some_and(|it| variable_has_listener(Some(it))),
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Dot { name, .. } if name.name().is("onerror") => {
                kind == Emitter::EventTarget && parent.is_assignment_target()
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj != e,
            ExprKind::Assign { target, value, .. } => {
                value == e && variable_has_listener(target.symbol())
            }
            _ => true,
        },
        _ => true,
    }
}
