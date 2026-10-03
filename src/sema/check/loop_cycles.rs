//! Which cycles through the back edge of a loop also occur in TypeScript.

use super::*;
use crate::bind::PatParent;

impl<'p> Checker<'p> {
    /// Whether every query from `stack[i]` up is one TypeScript also makes, regardless of query
    /// order: the type of a variable, or of an element of its pattern, that is inferred from an
    /// initializer (`checkDeclarationInitializer`, which goes through `checkExpressionCached`), or
    /// of an expression whose operands `checkExpression` always checks, the return type of a
    /// function, or a call that is being resolved. For a call that is only on the stack for
    /// `getQuickTypeOfExpression`, the callee is checked with the loop visible.
    pub(super) fn is_cycle_of_initializers(&self, i: usize) -> bool {
        let queries = &self.stack[i..];
        queries.iter().enumerate().all(|(at, &q)| match q {
            Query::Expr(file, e) if matches!(self.hir(file)[e].kind, ExprKind::Call(_)) => {
                // `getReturnTypeOfSingleNonGenericCallSignature` is an ordinary resolution. The
                // last query is followed by the one the cycle re-enters.
                let next = *queries.get(at + 1).unwrap_or(&queries[0]);
                next == Query::Call(file, e) || matches!(next, Query::Return(..))
            }
            Query::Call(..) | Query::Return(..) => true,
            Query::Expr(file, e) => matches!(
                self.hir(file)[e].kind,
                ExprKind::Ident(_)
                    | ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::NonNull(_)
                    | ExprKind::Cond { .. }
                    | ExprKind::Binary { .. }
                    | ExprKind::Unary { .. }
                    | ExprKind::Assign { .. }
                    | ExprKind::Array(_)
                    | ExprKind::Spread(_)
            ),
            Query::Symbol(sym) => self.files().flags(sym).intersects(SymFlags::VARIABLE),
            Query::Pat(file, pat) => {
                let (hir, bound) = (self.hir(file), self.bound(file));
                let root = root_declaration(bound, pat);
                matches!(root, PatParent::Var(d) if hir[d].ty.is_none() && hir[d].init.is_some())
            }
            _ => false,
        })
    }
}
