use crate::fold::{Decisions, NeverRun, TreeNode, push_children};
use crate::hir::{ExprKind, File, FnBody, FnId, IdList, StmtId, StmtKind, VarKind};
use crate::util::FxHashSet;

pub(crate) fn has_live_top_level_await(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    let roots = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    hir.has_top_level_await()
        && find_await_below(hir, decisions, roots, Sought::Live) == Await::Found
}

pub(crate) fn has_written_top_level_await(hir: &File<'_>) -> bool {
    let roots = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    hir.has_top_level_await()
        && find_await_below(hir, &Decisions::default(), roots, Sought::Written) == Await::Found
}

/// What a walk over the code that runs found.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Await {
    Found,
    /// None, and the walk went through all the code.
    NoneWritten,
    /// None, and the walk left out code that never runs.
    NoneThatRuns,
}

/// Returns the position of the first statement of the file that holds a top-level `await`.
pub(crate) fn find_first_top_level_await(hir: &File<'_>, decisions: &Decisions<'_>) -> Option<u32> {
    if !hir.has_top_level_await() {
        return None;
    }
    let mut statements = hir.ids(hir.body);
    let first = statements.find(|&statement: &StmtId| {
        let roots = vec![TreeNode::Stmt(statement)];
        find_await_below(hir, decisions, roots, Sought::Live) == Await::Found
    });
    first.map(|statement| hir[statement].start)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Sought {
    Live,
    Written,
}

/// Whether the text that `bun run` prints for a function holds an `await` of the function itself.
pub fn has_live_await(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    never_run: &NeverRun<'_, '_>,
    function: FnId,
) -> bool {
    let mut roots = Vec::new();
    let mut has_code_behind_exit = false;
    match hir[function].body {
        FnBody::Block(statements) => {
            has_code_behind_exit = push_statements_until_exit(hir, statements, &mut roots);
        }
        FnBody::Expr(value) => roots.push(TreeNode::Expr(value)),
        FnBody::None => {}
    }
    match find_await_below(hir, &decisions.as_folded_by_bun_run(), roots, Sought::Live) {
        Await::Found => true,
        Await::NoneWritten if !has_code_behind_exit => false,
        Await::NoneWritten | Await::NoneThatRuns => {
            has_printed_await_where_none_runs(hir, decisions, never_run, function)
        }
    }
}

fn has_printed_await_where_none_runs(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    never_run: &NeverRun<'_, '_>,
    function: FnId,
) -> bool {
    let mut visited_exprs = FxHashSet::default();
    let mut stack = Vec::new();
    push_children(hir, TreeNode::Function(function), &mut stack);
    while let Some(node) = stack.pop() {
        let is_printed_await = match node {
            TreeNode::Function(_) => continue,
            TreeNode::Expr(expr) if !visited_exprs.insert(expr) => continue,
            TreeNode::Expr(expr) => {
                matches!(hir[expr].kind, ExprKind::Await(_))
                    && never_run.is_printed(decisions, expr)
            }
            TreeNode::Stmt(stmt) => {
                is_await_statement(hir, stmt) && never_run.is_statement_printed(decisions, stmt)
            }
            TreeNode::Class(_) | TreeNode::Pattern(_) => false,
        };
        if is_printed_await {
            return true;
        }
        push_children(hir, node, &mut stack);
    }
    false
}

/// Whether statements of the list stand behind the one that leaves it.
fn push_statements_until_exit(
    hir: &File<'_>,
    list: IdList<StmtId>,
    stack: &mut Vec<TreeNode>,
) -> bool {
    let mut statements = hir.ids(list);
    for statement in statements.by_ref() {
        stack.push(TreeNode::Stmt(statement));
        if matches!(
            hir[statement].kind,
            StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) | StmtKind::Continue(_)
        ) {
            break;
        }
    }
    statements.next().is_some()
}

fn find_await_below(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    roots: Vec<TreeNode>,
    sought: Sought,
) -> Await {
    let mut visited_exprs = FxHashSet::default();
    let mut stack = roots;
    let mut leaves_code_out = false;
    while let Some(node) = stack.pop() {
        let is_dead = match node {
            TreeNode::Expr(expr) => decisions.is_dead_expr(expr),
            TreeNode::Stmt(stmt) => decisions.is_dead_stmt(stmt),
            TreeNode::Function(_) | TreeNode::Class(_) | TreeNode::Pattern(_) => false,
        };
        if is_dead {
            leaves_code_out = true;
            continue;
        }
        let is_await = match node {
            TreeNode::Function(_) => continue,
            TreeNode::Expr(expr) if !visited_exprs.insert(expr) => continue,
            TreeNode::Expr(expr) => matches!(hir[expr].kind, ExprKind::Await(_)),
            TreeNode::Stmt(stmt) => is_await_statement(hir, stmt),
            TreeNode::Class(_) | TreeNode::Pattern(_) => false,
        };
        if is_await {
            return Await::Found;
        }
        match node {
            TreeNode::Stmt(stmt)
                if sought == Sought::Live
                    && let StmtKind::Block(statements) = hir[stmt].kind =>
            {
                leaves_code_out |= push_statements_until_exit(hir, statements, &mut stack);
            }
            _ => push_children(hir, node, &mut stack),
        }
    }
    match leaves_code_out {
        true => Await::NoneThatRuns,
        false => Await::NoneWritten,
    }
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
