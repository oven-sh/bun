use crate::bind::decorator_metadata::is_field_moved_by_legacy_decorators;
use crate::fold::{Decisions, TreeNode, push_children};
use crate::hir::{
    Expr, ExprId, ExprKind, File, Flags, FnBody, FnId, FnKind, MemberId, ModifierKind, StmtId,
    StmtKind,
};
use crate::util::PositionSet;
use std::ops::ControlFlow;

fn visit_this_of_file(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    visit: impl FnMut(ExprId) -> ControlFlow<()>,
) {
    let stack = hir.ids(hir.body).map(TreeNode::Stmt).collect();
    let decorators = ParameterDecorators::PassedBy;
    visit_this_below(hir, decisions, stack, decorators, false, visit);
}

fn takes_this(expr: &Expr, jsx_takes_this: bool) -> bool {
    match expr.kind {
        ExprKind::This => true,
        ExprKind::Jsx(_) => jsx_takes_this,
        _ => false,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum ParameterDecorators {
    PassedBy,
    Visited,
}

fn visit_this_below(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    mut stack: Vec<TreeNode>,
    parameter_decorators: ParameterDecorators,
    jsx_takes_this: bool,
    mut visit: impl FnMut(ExprId) -> ControlFlow<()>,
) {
    let is_this = |expr: &Expr| takes_this(expr, jsx_takes_this);
    if !hir.exprs.iter().any(is_this) {
        return;
    }
    let mut skipped_exprs = PositionSet::new(hir.exprs.len());
    while let Some(node) = stack.pop() {
        match node {
            TreeNode::Function(function) if hir[function].kind != FnKind::Arrow => {
                if parameter_decorators == ParameterDecorators::Visited {
                    push_parameter_decorators(hir, function, &mut stack);
                }
                continue;
            }
            TreeNode::Expr(expr) if decisions.is_dead_expr(expr) => continue,
            TreeNode::Expr(expr) if skipped_exprs.contains(expr.idx()) => continue,
            TreeNode::Stmt(stmt) if decisions.is_dead_stmt(stmt) => continue,
            TreeNode::Stmt(stmt) if is_compiled_to_function(hir, stmt) => continue,
            TreeNode::Expr(expr) => {
                if is_this(&hir[expr]) && visit(expr).is_break() {
                    return;
                }
                skipped_exprs.insert(expr.idx());
            }
            TreeNode::Class(class) => {
                let runs_around = |member: &MemberId| {
                    parameter_decorators == ParameterDecorators::Visited
                        && is_value_assigned_behind_class(hir, *member)
                };
                let members = hir[class]
                    .members
                    .iter()
                    .filter(|member| !runs_around(member));
                let initializers = members.map(|member| hir[member].init);
                for initializer in initializers.filter(|initializer| initializer.is_some()) {
                    skipped_exprs.insert(initializer.idx());
                }
            }
            TreeNode::Function(_) | TreeNode::Stmt(_) | TreeNode::Pattern(_) => {}
        }
        push_children(hir, node, &mut stack);
    }
}

fn is_value_assigned_behind_class(hir: &File<'_>, member: MemberId) -> bool {
    hir.has_typescript_semantics()
        && hir.legacy_decorators
        && hir[member].flags.contains(Flags::STATIC)
        && is_field_moved_by_legacy_decorators(hir, member)
}

fn push_parameter_decorators(hir: &File<'_>, function: FnId, stack: &mut Vec<TreeNode>) {
    let parameters = hir[function].params.iter();
    for modifier in parameters.flat_map(|parameter| hir.param_modifiers(parameter).iter()) {
        if let ModifierKind::Decorator(decorator) = hir[modifier].kind {
            stack.push(TreeNode::Expr(decorator));
        }
    }
}

pub(crate) fn has_live_this_of_file(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    let mut is_found = false;
    visit_this_of_file(hir, decisions, |_| {
        is_found = true;
        ControlFlow::Break(())
    });
    is_found
}

pub fn evaluates_own_this(hir: &File<'_>, function: FnId, jsx_takes_this: bool) -> bool {
    let mut stack = Vec::new();
    push_children(hir, TreeNode::Function(function), &mut stack);
    let mut is_found = false;
    let (decisions, decorators) = (Decisions::default(), ParameterDecorators::Visited);
    visit_this_below(hir, &decisions, stack, decorators, jsx_takes_this, |_| {
        is_found = true;
        ControlFlow::Break(())
    });
    is_found
}

#[derive(Default)]
pub struct ThisPositions {
    positions: Box<[u32]>,
    jsx_takes_this: bool,
}

impl ThisPositions {
    pub fn of(hir: &File<'_>, jsx_takes_this: bool) -> ThisPositions {
        let all = hir.exprs.iter();
        let taking = all.filter(|expr| takes_this(expr, jsx_takes_this));
        let mut positions: Vec<u32> = taking.map(|expr| expr.pos).collect();
        positions.sort_unstable();
        ThisPositions {
            positions: positions.into_boxed_slice(),
            jsx_takes_this,
        }
    }

    pub fn evaluates_own_this(&self, hir: &File<'_>, function: FnId) -> bool {
        let start = hir[function].start;
        let last_statement = match hir[function].body {
            FnBody::Block(statements) => hir.ids(statements).last(),
            FnBody::None | FnBody::Expr(_) => None,
        };
        let end = last_statement.map_or(u32::MAX, |statement| hir[statement].loc.end);
        let positions = &self.positions;
        let first_inside = positions.partition_point(|&position| position < start);
        let has_this_in_its_text = positions
            .get(first_inside)
            .is_some_and(|&position| position < end);
        has_this_in_its_text && evaluates_own_this(hir, function, self.jsx_takes_this)
    }
}

pub(crate) fn collect_this_of_file(hir: &File<'_>) -> PositionSet {
    let mut found = PositionSet::new(hir.exprs.len());
    visit_this_of_file(hir, &Decisions::default(), |this| {
        found.insert(this.idx());
        ControlFlow::Continue(())
    });
    found
}

pub fn list_this_of_file(hir: &File<'_>) -> Vec<ExprId> {
    let mut found = Vec::new();
    visit_this_of_file(hir, &Decisions::default(), |this| {
        found.push(this);
        ControlFlow::Continue(())
    });
    found
}

fn is_compiled_to_function(hir: &File<'_>, stmt: StmtId) -> bool {
    matches!(hir[stmt].kind, StmtKind::Module(_) | StmtKind::Enum(_))
}
