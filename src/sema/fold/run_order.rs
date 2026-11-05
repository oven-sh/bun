use super::children::{TreeNode, push_children};
use crate::hir::{ExprId, ExprKind, File, Flags, StmtKind};
use crate::util::FxHashMap;
use std::cell::OnceCell;

const RUNS_LATER: u32 = u32::MAX;

/// Which reads of a `var` of the file come behind its initializer. The statements of the body of a file run in their order, so a read that one of them makes as it runs does.
/// A function and the initializer of an instance field run when somebody calls them, and the text of one file does not say who: the class may be evaluated at the start of the file,
/// another file may import this one in a cycle, a hook may ask for the file half way through its body. A read in one of them is never behind.
pub(super) struct RunOrder {
    /// The statements of the body are counted from 1.
    statement_of_initializer: FxHashMap<ExprId, u32>,
    /// By expression. 0: no name that a statement of the body reads as it runs.
    /// Found when somebody asks about a variable that a statement of the body of the file initializes. Most variables belong to functions.
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
