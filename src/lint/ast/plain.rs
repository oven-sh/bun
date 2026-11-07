//! The records of expressions as the parser wrote them. `bun fmt` writes most expressions from their kind and their
//! positions alone, and has no use for what a handle works out on the way.

use super::{Expr, File};
use bun_sema::hir;

impl<'a> File<'a> {
    /// The record of the expression `id`. `None` in a file in which a handle can stand for another expression than the
    /// one with its id: one with casts in JSDoc comments.
    #[inline]
    pub fn plain_expr(&self, id: hir::ExprId) -> Option<&'a hir::Expr> {
        self.plain_exprs.get(id.idx())
    }

    #[inline]
    pub fn plain_call(&self, id: hir::CallId) -> Option<&'a hir::Call> {
        self.hir.calls.get(id.idx())
    }

    /// The ids of the expressions in `list`.
    #[inline]
    pub fn plain_list(&self, list: hir::IdList<hir::ExprId>) -> &'a [u32] {
        let start = list.start as usize;
        (self.hir.ids.get(start..start + list.len as usize)).unwrap_or_default()
    }

    /// The handle of `id`, of which [`File::plain_expr`] has the record.
    #[inline]
    pub fn handle_of_plain_expr(&'a self, id: hir::ExprId) -> Expr<'a> {
        Expr { file: self, id }
    }
}
