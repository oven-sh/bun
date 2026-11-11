use super::children::{TreeNode, push_children};
use crate::hir::{ExprId, ExprKind, File, Flags, StmtKind};
use crate::util::FxHashMap;
use std::cell::OnceCell;

const RUNS_LATER: u32 = u32::MAX;

pub(super) struct RunOrder {
    statement_of_initializer: FxHashMap<ExprId, u32>,
    statement_of_read: OnceCell<Vec<u32>>,
}

fn find_statements_of_reads(hir: &File<'_>) -> Vec<u32> {
    let mut statement_of_read = vec![0; hir.exprs.len()];
    let mut stack = Vec::new();
    for (number, statement) in (1..).zip(hir.ids(hir.body)) {
        stack.push(TreeNode::Stmt(statement));
        while let Some(node) = stack.pop() {
            match node {
                TreeNode::Function(_) => continue,
                TreeNode::Expr(e) if statement_of_read[e.idx()] == RUNS_LATER => {
                    statement_of_read[e.idx()] = 0;
                    continue;
                }
                TreeNode::Expr(e) if matches!(hir[e].kind, ExprKind::Ident(_)) => {
                    statement_of_read[e.idx()] = number;
                }
                TreeNode::Class(class) => {
                    for member in hir[class].members.iter().map(|member| &hir[member]) {
                        if member.init.is_some() && !member.flags.contains(Flags::STATIC) {
                            statement_of_read[member.init.idx()] = RUNS_LATER;
                        }
                    }
                }
                TreeNode::Expr(_) | TreeNode::Stmt(_) | TreeNode::Pattern(_) => {}
            }
            push_children(hir, node, &mut stack);
        }
    }
    statement_of_read
}

impl RunOrder {
    pub(super) fn new(hir: &File<'_>) -> RunOrder {
        let mut statement_of_initializer = FxHashMap::default();
        for (number, statement) in (1..).zip(hir.ids(hir.body)) {
            if let StmtKind::Var(declarations) = hir[statement].kind {
                let initializers = declarations.iter().filter_map(|it| hir[it].init.some());
                statement_of_initializer.extend(initializers.map(|it| (it, number)));
            }
        }
        RunOrder {
            statement_of_initializer,
            statement_of_read: OnceCell::new(),
        }
    }

    pub(super) fn is_read_behind(&self, hir: &File<'_>, read: ExprId, initializer: ExprId) -> bool {
        let Some(&initialized) = self.statement_of_initializer.get(&initializer) else {
            return false;
        };
        let find = || find_statements_of_reads(hir);
        self.statement_of_read.get_or_init(find)[read.idx()] >= initialized
    }
}
