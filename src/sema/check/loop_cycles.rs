//! Which cycles through the back edge of a loop also occur in TypeScript.

use super::*;
use crate::bind::{Parent, PatParent};

impl<'p, 's> Checker<'p, 's> {
    /// Whether every query from `stack[i]` up is one TypeScript also makes, regardless of query
    /// order: the type of a variable, or of an element of its pattern, that is inferred from an
    /// initializer (`checkDeclarationInitializer`) or from what a `for` statement iterates
    /// (`checkRightHandSideOfForOf`), the type of an expression, whose operands
    /// `checkExpression` checks, the return type of a function, or a call that is being resolved.
    /// What TypeScript defers, the members of a class expression, is behind another query.
    pub(super) fn is_cycle_of_initializers(&self, i: usize) -> bool {
        self.stack[i..].iter().all(|&q| match q {
            Query::Expr(..)
            | Query::LiteralProp(..)
            | Query::Call(..)
            | Query::Return(..)
            | Query::ReturnAtFirstLook(..) => true,
            Query::Symbol(sym) => self.files().flags(sym).intersects(SymFlags::VARIABLE),
            Query::Pat(file, pat) => {
                let (hir, bound) = (self.hir(file), self.bound(file));
                let root = root_declaration(bound, pat);
                matches!(root, PatParent::Var(d)
                    if hir[d].ty.is_none() && hir[d].init.is_some()
                        || self.is_variable_of_for_in_or_of(file, d))
            }
            _ => false,
        })
    }

    /// Whether `d` is declared in the head of a `for (.. in ..)` or a `for (.. of ..)`: it has
    /// its type from the expression of that statement, whatever is written after its name.
    fn is_variable_of_for_in_or_of(&self, file: FileId, d: VarDeclId) -> bool {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let stmt = bound.var_stmt[d.idx()];
        stmt.is_some()
            && matches!(bound.stmt_parent[stmt.idx()], Parent::Stmt(parent)
                if matches!(hir[parent].kind,
                    StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } if left == stmt))
    }
}
