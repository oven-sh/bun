//! Which circles through the back edge of a loop are TypeScript's own.

use super::*;
use crate::bind::PatParent;

impl<'p> Checker<'p> {
    /// Whether every question from `stack[i]` up is one TypeScript asks as well, whoever asks first: the type of a variable, or of an
    /// element of its pattern, that is inferred from an initializer (`checkDeclarationInitializer`, which goes through
    /// `checkExpressionCached`), or of an expression whose operands `checkExpression` always looks at, what a function returns, or a
    /// call that is being resolved. Of a call that is only here for `getQuickTypeOfExpression`, what is called is looked at with the
    /// loop in sight.
    pub(super) fn is_circle_of_initializers(&self, i: usize) -> bool {
        let questions = &self.stack[i..];
        questions.iter().enumerate().all(|(at, &q)| match q {
            Query::Expr(file, e) if matches!(self.hir(file)[e].kind, ExprKind::Call(_)) => {
                // `getReturnTypeOfSingleNonGenericCallSignature` is a resolution like any other. After the last question comes the
                // one that is come back to.
                let next = *questions.get(at + 1).unwrap_or(&questions[0]);
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
