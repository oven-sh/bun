//! The variable that a class declaration binds. TypeScript lets nobody assign to it; JavaScript does.

use crate::bind::{Decl, Parent};
use crate::check::Checker;
use crate::hir::{BinOp, ExprKind};
use crate::program::Sym;

impl<'p, 's> Checker<'p, 's> {
    /// Whether the variable holds the class object from its initialization on, although it is assigned to: every assignment is `||=` or `??=`. A class object decides those, so that the right
    /// side is never evaluated and nothing is ever stored. A transpiler writes `((C) => { .. })(C ||= {})` for a namespace that is merged with the class `C`.
    pub fn holds_its_class_for_good(&self, sym: Sym) -> bool {
        let Some((file, decl @ Decl::Class(_))) = self.declaration_of_variable(sym) else { return false };
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
