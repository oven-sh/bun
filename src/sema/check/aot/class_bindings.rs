use crate::bind::{Decl, Parent};
use crate::check::Checker;
use crate::hir::{BinOp, ExprKind};
use crate::program::Sym;

impl<'p, 's> Checker<'p, 's> {
    pub fn always_holds_class(&self, sym: Sym) -> bool {
        let Some((file, decl @ Decl::Class(_))) = self.variable_declaration(sym) else { return false };
        let (hir, bound) = (self.hir(file), self.bound(file));
        let local = bound.symbol_of_declaration(decl);
        local.is_some()
            && bound.symbols[local.idx()].decls.len() == 1
            && !self.is_stored_through_casts(file, local)
            && bound.assignments_to(local).iter().all(|&(_, target)| {
                matches!(bound.expr_parent[target.idx()], Parent::Expr(parent) if parent.is_some()
                    && matches!(hir[parent].kind, ExprKind::Assign { op: Some(BinOp::Or | BinOp::Nullish), target: assigned, .. } if assigned == target))
            })
    }
}
