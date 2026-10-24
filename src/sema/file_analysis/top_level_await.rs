use crate::fold::{Decisions, TreeNode, push_children};
use crate::hir::{ExprKind, File, StmtId, StmtKind, VarKind};
use crate::util::PositionSet;

pub(crate) fn has_live_top_level_await(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    if !hir.has_top_level_await() {
        return false;
    }
    let mut visited_exprs = PositionSet::new(hir.exprs.len());
    let mut stack: Vec<TreeNode> = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    while let Some(node) = stack.pop() {
        let is_await = match node {
            TreeNode::Function(_) => continue,
            TreeNode::Expr(expr) if decisions.is_dead_expr(expr) => continue,
            TreeNode::Expr(expr) if visited_exprs.contains(expr.idx()) => continue,
            TreeNode::Stmt(stmt) if decisions.is_dead_stmt(stmt) => continue,
            TreeNode::Expr(expr) => {
                visited_exprs.insert(expr.idx());
                matches!(hir[expr].kind, ExprKind::Await(_))
            }
            TreeNode::Stmt(stmt) => is_await_statement(hir, stmt),
            TreeNode::Class(_) | TreeNode::Pattern(_) => false,
        };
        if is_await {
            return true;
        }
        push_children(hir, node, &mut stack);
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
