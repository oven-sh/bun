use crate::conditions::Condition;
use bun_lint::prelude::*;

/// Where the `$:` rules run: before Svelte 5, or without runes.
pub(crate) const WITHOUT_RUNES: &[Condition] = &[
    Condition {
        svelte_versions: &["3/4"],
        svelte_file_types: &[],
        runes: &[],
        kit_file_types: &[],
        svelte_kit_versions: &[],
    },
    Condition {
        svelte_versions: &["5"],
        svelte_file_types: &[],
        runes: &[false],
        kit_file_types: &[],
        svelte_kit_versions: &[],
    },
];

/// The `$:` statement whose expression is the assignment `e`: `SvelteReactiveStatement > ExpressionStatement > e`.
pub(crate) fn reactive_statement_of(e: Expr<'_>) -> Option<Stmt<'_>> {
    let Node::Stmt(statement) = e.parent() else {
        return None;
    };
    if !matches!(statement.kind(), StmtKind::Expr(_)) || statement.is_wrapper() {
        return None;
    }
    let Node::Stmt(reactive) = statement.parent() else {
        return None;
    };
    reactive.is_svelte_reactive().then_some(reactive)
}

/// A component's `$:` statements, `SvelteReactiveStatement`, in text order.
pub(crate) fn reactive_statements<'a>(file: &'a File<'a>) -> impl Iterator<Item = Stmt<'a>> + 'a {
    file.body()
        .with_hidden()
        .filter(|it| it.is_svelte_reactive())
}

/// A `$:` statement's `body`.
pub(crate) fn body_of(reactive: Stmt<'_>) -> Option<Stmt<'_>> {
    match reactive.kind() {
        StmtKind::Labeled { body, .. } => Some(body),
        _ => None,
    }
}

/// The `=` assignment that makes up the `$:` statement `reactive`: `$: x = ..`.
pub(crate) fn assignment_of(reactive: Stmt<'_>) -> Option<Expr<'_>> {
    let StmtKind::Expr(e) = body_of(reactive)?.kind() else {
        return None;
    };
    matches!(e.as_assign(), Some((None, _, _))).then_some(e)
}
