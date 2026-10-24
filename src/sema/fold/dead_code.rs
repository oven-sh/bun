use super::children::{TreeNode, push_children};
use super::evaluate::Value;
use super::folder::{Folder, MarkedNodes};
use crate::bind::Parent;
use crate::hir::{BinOp, CaseId, ExprId, File, FnBody, IdList, Span, StmtId, StmtKind};
use crate::util::PositionSet;

impl<'s> Folder<'_, 's> {
    pub(super) fn find_dead_roots(&self) -> Vec<TreeNode> {
        let operands = self.excluded_operands.iter();
        let operands = operands.filter_map(|operand| operand.some());
        let mut roots: Vec<TreeNode> = operands.map(TreeNode::Expr).collect();
        let stmts = (0..self.hir.stmts.len()).map(|index| StmtId(index as u32));
        let reached = stmts.filter(|&stmt| self.bound.parent_of_stmt(stmt) != Parent::None);
        for stmt in reached {
            self.push_excluded_parts(stmt, &mut roots);
        }
        self.push_statements_never_reached(&mut roots);
        for entry in &self.decided {
            push_children(self.hir, TreeNode::Expr(entry.0), &mut roots);
        }
        roots
    }

    fn push_excluded_parts(&self, stmt: StmtId, roots: &mut Vec<TreeNode>) {
        match self.hir[stmt].kind {
            StmtKind::If { test, yes, no } => {
                let excluded = match self.condition(test) {
                    Some(true) => no.some(),
                    Some(false) => yes.some(),
                    None => None,
                };
                roots.extend(excluded.map(TreeNode::Stmt));
            }
            StmtKind::While { test, body } if self.condition(test) == Some(false) => {
                roots.push(TreeNode::Stmt(body));
            }
            StmtKind::For {
                test, update, body, ..
            } if test.is_some() && self.condition(test) == Some(false) => {
                roots.push(TreeNode::Stmt(body));
                roots.extend(update.some().map(TreeNode::Expr));
            }
            StmtKind::Switch { expr, cases } => {
                self.push_clauses_never_entered(expr, cases, roots);
            }
            _ => {}
        }
    }

    fn is_case_selected(&self, discriminant: ExprId, case: CaseId) -> Option<bool> {
        let test = self.hir[case].test.some()?;
        let (discriminant, test) = (self.folded(discriminant).value, self.folded(test).value);
        match self.evaluator.binary(BinOp::EqEqEq, discriminant, test) {
            Value::Known(is_equal) => Some(self.evaluator.to_boolean(is_equal)),
            Value::Unknown => None,
        }
    }

    fn push_clauses_never_entered(
        &self,
        discriminant: ExprId,
        cases: Span<CaseId>,
        roots: &mut Vec<TreeNode>,
    ) {
        let hir = self.hir;
        let selections = (cases.iter()).map(|case| self.is_case_selected(discriminant, case));
        let selections: Vec<Option<bool>> = selections.collect();
        let always_selected = selections.iter().position(|&it| it == Some(true));
        let mut falls_through = false;
        for (index, (case, selection)) in cases.iter().zip(selections).enumerate() {
            let can_be_selected = match always_selected {
                Some(selected) => {
                    hir[case].test.is_some() && index <= selected && selection != Some(false)
                }
                None => selection != Some(false),
            };
            let mut body = hir.ids(hir[case].body);
            if can_be_selected || falls_through {
                falls_through = !body.any(|statement| self.always_leaves_list(statement));
            } else {
                let never_reached = body.filter(|&statement| !self.counts_unreached(statement));
                roots.extend(never_reached.map(TreeNode::Stmt));
            }
        }
    }
}

impl<'s> Folder<'_, 's> {
    fn push_statements_never_reached(&self, roots: &mut Vec<TreeNode>) {
        let hir = self.hir;
        for function in hir.fns.iter() {
            if let FnBody::Block(list) = function.body {
                self.push_statements_after_exit(list, roots);
            }
        }
        for stmt in (0..hir.stmts.len()).map(|index| StmtId(index as u32)) {
            if self.bound.parent_of_stmt(stmt) == Parent::None {
                continue;
            }
            match hir[stmt].kind {
                StmtKind::Block(list) => self.push_statements_after_exit(list, roots),
                StmtKind::Switch { cases, .. } => {
                    for case in cases.iter() {
                        self.push_statements_after_exit(hir[case].body, roots);
                    }
                }
                _ => {}
            }
        }
    }

    fn push_statements_after_exit(&self, list: IdList<StmtId>, roots: &mut Vec<TreeNode>) {
        let mut statements = self.hir.ids(list);
        if statements
            .by_ref()
            .any(|statement| self.always_leaves_list(statement))
        {
            let never_reached = statements.filter(|&statement| !self.counts_unreached(statement));
            roots.extend(never_reached.map(TreeNode::Stmt));
        }
    }

    fn always_leaves_list(&self, statement: StmtId) -> bool {
        let mut current = statement;
        loop {
            let StmtKind::If { test, yes, no } = self.hir[current].kind else {
                break;
            };
            current = match self.condition(test) {
                Some(true) => yes,
                Some(false) => no,
                None if self.always_leaves_list(yes) => no,
                None => return false,
            };
            if current.is_none() {
                return false;
            }
        }
        match self.hir[current].kind {
            StmtKind::Return(_)
            | StmtKind::Throw(_)
            | StmtKind::Break(_)
            | StmtKind::Continue(_) => true,
            StmtKind::Block(list) => self
                .hir
                .ids(list)
                .any(|inner| self.always_leaves_list(inner)),
            _ => false,
        }
    }

    fn counts_unreached(&self, statement: StmtId) -> bool {
        let mut current = statement;
        while let StmtKind::Labeled { body, .. } = self.hir[current].kind {
            current = body;
        }
        matches!(
            self.hir[current].kind,
            StmtKind::Fn(_)
                | StmtKind::Interface(_)
                | StmtKind::TypeAlias(_)
                | StmtKind::Enum(_)
                | StmtKind::Module(_)
        )
    }
}

pub(crate) fn mark_nodes_below(hir: &File<'_>, roots: Vec<TreeNode>) -> MarkedNodes {
    let mut marked = MarkedNodes {
        exprs: PositionSet::new(hir.exprs.len()),
        stmts: PositionSet::new(hir.stmts.len()),
        functions: PositionSet::new(hir.fns.len()),
    };
    let mut stack = roots;
    while let Some(node) = stack.pop() {
        let is_new = match node {
            TreeNode::Expr(e) => try_insert(&mut marked.exprs, e.idx()),
            TreeNode::Stmt(stmt) => try_insert(&mut marked.stmts, stmt.idx()),
            TreeNode::Function(function) => try_insert(&mut marked.functions, function.idx()),
            TreeNode::Class(_) | TreeNode::Pattern(_) => true,
        };
        if is_new {
            push_children(hir, node, &mut stack);
        }
    }
    marked
}

fn try_insert(set: &mut PositionSet, position: usize) -> bool {
    if set.contains(position) {
        return false;
    }
    set.insert(position);
    true
}
