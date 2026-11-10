use crate::atom::Atom;
use crate::bind::{
    Binding, BindingInitializer, BindingStability, Bound, Decl, Parent, PatParent, StoreKind,
    SymbolId,
};
use crate::fold::{Constant, Decisions, FoldedValue};
use crate::hir::{BinOp, Branches, ExprId, ExprKind, File};
use crate::import_sites::{
    ImportSite, ImportSiteKind, ImportSpecifier, is_linked_by_bundler, is_name_read_by_transpiler,
};
use smallvec::{SmallVec, smallvec};

pub fn find_names_read_by_transpiler(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    site: &ImportSite,
) -> SmallVec<[Atom; 2]> {
    if site.specifier_node.is_none()
        || !is_linked_by_bundler(hir, bound, site.kind)
        || !is_name_read_by_transpiler(hir, bound, decisions, site.kind)
    {
        return SmallVec::new();
    }
    find_names_folded_by_transpiler(hir, decisions, site.specifier_node)
}

pub fn find_names_folded_by_transpiler(
    hir: &File<'_>,
    decisions: &Decisions<'_>,
    name: ExprId,
) -> SmallVec<[Atom; 2]> {
    let mut names = SmallVec::new();
    let mut pending: SmallVec<[ExprId; 4]> = smallvec![name];
    while let Some(expression) = pending.pop() {
        let expression = hir.skip_type_assertions(expression);
        if decisions.is_dead_expr(expression) {
            continue;
        }
        if !decisions.is_constant_under_minify_syntax(hir, expression) {
            if let ExprKind::Cond { branches, .. } = hir[expression].kind {
                let Branches { yes, no } = hir.branches(branches);
                pending.extend([yes, no]);
            }
            continue;
        }
        if let FoldedValue::Constant(Constant::String(text))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
            decisions.constant(hir, expression)
        {
            names.push(text);
        }
    }
    names
}

pub fn find_written_arms(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    site: &ImportSite,
) -> SmallVec<[Atom; 2]> {
    let loads = matches!(
        site.kind,
        ImportSiteKind::Require(_)
            | ImportSiteKind::ImportMetaRequire(_)
            | ImportSiteKind::ImportCall(_)
    );
    if !loads {
        return SmallVec::new();
    }
    let walk = ArmsWalk {
        hir,
        bound,
        decisions,
    };
    let reads = match site.specifier {
        ImportSpecifier::Unknown => Reads::DefaultsAndStores,
        _ => Reads::Initializers,
    };
    walk.find_arms(site.specifier_node, reads)
}

const MOST_STORES_READ: usize = 16;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Reads {
    Initializers,
    Defaults,
    DefaultsAndStores,
}

struct ArmsWalk<'a, 'h, 'b, 'd> {
    hir: &'a File<'h>,
    bound: &'a Bound<'b>,
    decisions: &'a Decisions<'d>,
}

fn add(arms: &mut SmallVec<[Atom; 2]>, arm: Atom) {
    if !arms.contains(&arm) {
        arms.push(arm);
    }
}

impl ArmsWalk<'_, '_, '_, '_> {
    fn find_arms(&self, written: ExprId, reads: Reads) -> SmallVec<[Atom; 2]> {
        let (hir, bound, decisions) = (self.hir, self.bound, self.decisions);
        let mut arms = SmallVec::new();
        let mut seen: SmallVec<[SymbolId; 2]> = SmallVec::new();
        let mut pending: SmallVec<[ExprId; 4]> = smallvec![written];
        while let Some(expression) = pending.pop() {
            let expression = hir.skip_type_assertions(expression);
            if decisions.is_dead_expr(expression) {
                continue;
            }
            if let FoldedValue::Constant(Constant::String(text))
            | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
                decisions.constant(hir, expression)
            {
                add(&mut arms, text);
                continue;
            }
            match hir[expression].kind {
                ExprKind::Cond { branches, .. } => {
                    let Branches { yes, no } = hir.branches(branches);
                    pending.extend([yes, no]);
                }
                ExprKind::Binary {
                    op: BinOp::Or | BinOp::Nullish,
                    left,
                    right,
                } => pending.extend([left, right]),
                ExprKind::Ident(_) => {
                    if let Binding::Symbol(symbol) = bound.binding(expression)
                        && !seen.contains(&symbol)
                    {
                        seen.push(symbol);
                        self.add_values_held(symbol, reads, &mut pending, &mut arms);
                    }
                }
                _ => {}
            }
        }
        arms
    }

    fn add_values_held(
        &self,
        symbol: SymbolId,
        reads: Reads,
        pending: &mut SmallVec<[ExprId; 4]>,
        arms: &mut SmallVec<[Atom; 2]>,
    ) {
        let (hir, bound) = (self.hir, self.bound);
        if reads == Reads::Initializers {
            if bound.is_stable_binding(symbol)
                && let BindingInitializer::Expression(value) =
                    bound.binding_initializer(hir, symbol)
            {
                pending.push(value);
            }
            return;
        }
        let is_dead = |target: ExprId| self.decisions.is_dead_expr(target);
        match bound.binding_stability_ignoring(symbol, &is_dead) {
            BindingStability::Stable => {}
            BindingStability::Stored if reads == Reads::DefaultsAndStores => {
                let Some(stored) = self.find_arms_stored(symbol) else {
                    return;
                };
                stored.into_iter().for_each(|arm| add(arms, arm));
            }
            _ => return,
        }
        pending.extend(self.find_initializer_or_default(symbol));
    }

    fn find_arms_stored(&self, symbol: SymbolId) -> Option<SmallVec<[Atom; 2]>> {
        let stores = self.bound.stores_to(symbol);
        if stores.len() > MOST_STORES_READ {
            return None;
        }
        let mut arms = SmallVec::new();
        for store in stores {
            if self.decisions.is_dead_expr(store.target) {
                continue;
            }
            let is_choice = matches!(
                store.kind,
                StoreKind::Assign
                    | StoreKind::CompoundAssign(BinOp::Or | BinOp::And | BinOp::Nullish)
            );
            let value = self.find_value_stored(store.target).filter(|_| is_choice)?;
            let written = self.find_arms(value, Reads::Defaults);
            if written.is_empty() {
                return None;
            }
            written.into_iter().for_each(|arm| add(&mut arms, arm));
        }
        Some(arms)
    }

    fn find_value_stored(&self, target: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let stored_to = bound.outermost_type_assertion(hir, target);
        let Parent::Expr(assignment) = bound.parent_of_expr(stored_to) else {
            return None;
        };
        match hir[assignment].kind {
            ExprKind::Assign { target, value, .. } if target == stored_to => Some(value),
            _ => None,
        }
    }

    fn find_initializer_or_default(&self, symbol: SymbolId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        if let BindingInitializer::Expression(value) = bound.binding_initializer(hir, symbol) {
            return Some(value);
        }
        let &[Decl::Var(pattern) | Decl::Require(pattern) | Decl::Param(pattern)] =
            bound.symbol(symbol).decls
        else {
            return None;
        };
        match bound.pat_parent[pattern.idx()] {
            default @ (PatParent::Param(_) | PatParent::Prop(..) | PatParent::Elem(..)) => {
                default.initializer(hir).some()
            }
            PatParent::Var(_) | PatParent::None => None,
        }
    }
}
