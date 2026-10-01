//! Which circles through the back edge of a loop are TypeScript's own.

use super::*;
use crate::bind::PatParent;

impl<'p> Checker<'p> {
    /// Whether every question from `stack[i]` up is one TypeScript asks as well, whoever asks first: the type of a variable, or of an
    /// element of its pattern, that is inferred from an initializer (`checkDeclarationInitializer`, which goes through
    /// `checkExpressionCached`), or of an expression whose operands `checkExpression` always looks at. A call is none:
    /// `getQuickTypeOfExpression` may answer for it without looking at its arguments.
    pub(super) fn is_circle_of_initializers(&self, i: usize) -> bool {
        self.stack[i..].iter().all(|&q| match q {
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
                let mut root = bound.pat_parent[pat.idx()];
                while let PatParent::Prop(outer, _) | PatParent::Elem(outer, _) = root {
                    root = bound.pat_parent[outer.idx()];
                }
                matches!(root, PatParent::Var(d) if hir[d].ty.is_none() && hir[d].init.is_some())
            }
            _ => false,
        })
    }
}
