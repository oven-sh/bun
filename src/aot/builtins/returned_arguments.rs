use bun_sema::bind::{ReferentContext, StaticReferent, static_referent};
use bun_sema::hir::{Chain, ExprId, ExprKind};
use bun_sema::program::FileId;

use super::table::{self, BuiltinId};

pub fn returns_first_argument(builtin: BuiltinId) -> bool {
    matches!(
        table::canonical_id(builtin),
        BuiltinId::ObjectAssign
            | BuiltinId::ObjectDefineProperties
            | BuiltinId::ObjectDefineProperty
            | BuiltinId::ObjectFreeze
            | BuiltinId::ObjectPreventExtensions
            | BuiltinId::ObjectSeal
            | BuiltinId::ObjectSetPrototypeOf
    )
}

/// `Object.freeze(value)`: the argument.
pub fn find_frozen_value<'s, C: ReferentContext<'s, Builtin = BuiltinId>>(
    context: &C,
    file: FileId,
    expression: ExprId,
) -> Option<ExprId> {
    let hir = context.hir(file);
    let ExprKind::Call(site) = hir[expression].kind else {
        return None;
    };
    let callee = static_referent(context, file, hir[site].callee).referent;
    if hir[site].chain != Chain::No
        || !matches!(callee, StaticReferent::Builtin(BuiltinId::ObjectFreeze))
    {
        return None;
    }
    let mut arguments = hir.ids(hir[site].args);
    let (Some(value), None) = (arguments.next(), arguments.next()) else {
        return None;
    };
    (!matches!(hir[value].kind, ExprKind::Spread(_))).then_some(value)
}
