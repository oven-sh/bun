use crate::atom::Atom;
use crate::bind::{Binding, BindingInitializer, Bound, SymbolId};
use crate::fold::{Constant, Decisions, FoldedValue};
use crate::hir::{BinOp, Branches, ExprId, ExprKind, File};
use crate::import_sites::{ImportSite, ImportSiteKind};
use smallvec::{SmallVec, smallvec};

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
    let mut arms = SmallVec::new();
    let mut followed: SmallVec<[SymbolId; 2]> = SmallVec::new();
    let mut pending: SmallVec<[ExprId; 4]> = smallvec![site.specifier_node];
    while let Some(expression) = pending.pop() {
        let expression = hir.skip_type_assertions(expression);
        if decisions.is_dead_expr(expression) {
            continue;
        }
        if let FoldedValue::Constant(Constant::String(text))
        | FoldedValue::ConstantOutsideDeadZone(Constant::String(text)) =
            decisions.constant(hir, expression)
        {
            arms.push(text);
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
                if let Binding::Symbol(constant) = bound.binding(expression)
                    && bound.is_stable_binding(constant)
                    && !followed.contains(&constant)
                    && let BindingInitializer::Expression(value) =
                        bound.binding_initializer(hir, constant)
                {
                    followed.push(constant);
                    pending.push(value);
                }
            }
            _ => {}
        }
    }
    arms
}
