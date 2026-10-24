use bun_sema::bind::{Bound, ScopeId};
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{self, ExprId, StmtId, StmtKind, VarKind};
use smallvec::SmallVec;

use super::Context;
use crate::lower::scope::BindingRef;
use crate::lower::scope::analysis::find_by_key;
use crate::lower::scope::walk::ScopeWalk;

type StoreTargets = SmallVec<[ExprId; 4]>;

fn is_let_declaration(hir: &hir::File<'_>, statement: StmtId) -> bool {
    if statement.is_none() {
        return false;
    }
    let StmtKind::Var(declarations) = hir[statement].kind else {
        return false;
    };
    !declarations.is_empty() && matches!(hir[declarations.at(0)].kind, VarKind::Let)
}

pub(super) fn collect_loop_updates(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    walk: &ScopeWalk,
) -> Vec<(ScopeId, ExprId)> {
    let updates = walk.loops.iter().filter_map(|walked| {
        let StmtKind::For { init, update, .. } = hir[walked.statement].kind else {
            return None;
        };
        if !is_let_declaration(hir, init) {
            return None;
        }
        Some((bound.own_scope(walked.statement).some()?, update.some()?))
    });
    let mut updates: Vec<(ScopeId, ExprId)> = updates.collect();
    updates.sort_unstable_by_key(|update| update.0);
    updates
}

fn collect_store_targets(context: &Context<'_, '_>, update: ExprId) -> Option<StoreTargets> {
    let (hir, bound) = (context.input.hir, context.input.bound);
    let mut targets = StoreTargets::new();
    let mut pending = vec![TreeNode::Expr(update)];
    while let Some(node) = pending.pop() {
        match node {
            TreeNode::Expr(expression) => {
                if bound.is_store_target(expression) {
                    targets.push(expression);
                }
                push_children(hir, node, &mut pending);
            }
            _ => return None,
        }
    }
    Some(targets)
}

pub(super) fn is_stored_only_by_own_loop_update(
    context: &Context<'_, '_>,
    binding: BindingRef,
) -> bool {
    let BindingRef::Symbol(symbol) = binding else {
        return false;
    };
    let Some(update) = find_by_key(&context.loop_updates, context.scope_of(binding)) else {
        return false;
    };
    if context.input.bound.is_visible_to_eval(symbol) {
        return false;
    }
    let Some(targets) = collect_store_targets(context, update) else {
        return false;
    };
    context.is_stable_ignoring(symbol, |target| targets.contains(&target))
}
