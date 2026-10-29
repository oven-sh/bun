use crate::fold::{Decisions, TreeNode, push_children};
use crate::hir::{ExprKind, File, FnBody, FnId, IdList, StmtId, StmtKind, VarKind};
use crate::util::FxHashSet;

pub(crate) fn has_live_top_level_await(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    let roots = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    hir.has_top_level_await() && has_await_below(hir, decisions, roots, Sought::Live)
}

/// Whether a run can reach it or not. `bun run` goes by this for what kind of module a file is.
pub(crate) fn has_written_top_level_await(hir: &File<'_>) -> bool {
    let roots = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    hir.has_top_level_await() && has_await_below(hir, &Decisions::default(), roots, Sought::Written)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Sought {
    Live,
    Written,
}

/// An `await` of a function that is written inside `function` is not one of `function`.
pub fn has_live_await(hir: &File<'_>, decisions: &Decisions<'_>, function: FnId) -> bool {
    let mut roots = Vec::new();
    match hir[function].body {
        FnBody::Block(statements) => push_statements_until_exit(hir, statements, &mut roots),
        FnBody::Expr(value) => roots.push(TreeNode::Expr(value)),
        FnBody::None => {}
    }
    has_await_below(hir, decisions, roots, Sought::Live)
}

// Nobody keeps what stands behind such a statement in its list.
fn push_statements_until_exit(hir: &File<'_>, list: IdList<StmtId>, stack: &mut Vec<TreeNode>) {
    for statement in hir.ids(list) {
        stack.push(TreeNode::Stmt(statement));
        if matches!(
            hir[statement].kind,
            StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) | StmtKind::Continue(_)
        ) {
            break;
        }
    }
}

fn has_await_below(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    roots: Vec<TreeNode>,
    sought: Sought,
) -> bool {
    let mut visited_exprs = FxHashSet::default();
    let mut stack = roots;
    while let Some(node) = stack.pop() {
        let is_await = match node {
            TreeNode::Function(_) => continue,
            TreeNode::Expr(expr) if decisions.is_dead_expr(expr) => continue,
            TreeNode::Expr(expr) if !visited_exprs.insert(expr) => continue,
            TreeNode::Stmt(stmt) if decisions.is_dead_stmt(stmt) => continue,
            TreeNode::Expr(expr) => matches!(hir[expr].kind, ExprKind::Await(_)),
            TreeNode::Stmt(stmt) => is_await_statement(hir, stmt),
            TreeNode::Class(_) | TreeNode::Pattern(_) => false,
        };
        if is_await {
            return true;
        }
        match node {
            TreeNode::Stmt(stmt)
                if sought == Sought::Live
                    && let StmtKind::Block(statements) = hir[stmt].kind =>
            {
                push_statements_until_exit(hir, statements, &mut stack);
            }
            _ => push_children(hir, node, &mut stack),
        }
    }
    false
}

fn is_await_statement(hir: &File<'_>, stmt: StmtId) -> bool {
    match hir[stmt].kind {
        StmtKind::ForOf { is_await, .. } => is_await,
        StmtKind::Var(declarations) => {
            let first = declarations.iter().next();
            first.is_some_and(|first| hir[first].kind == VarKind::AwaitUsing)
        }
        _ => false,
    }
}
