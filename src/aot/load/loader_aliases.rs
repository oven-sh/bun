use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CommonJsVariable, Decl, SymbolId,
};
use bun_sema::fold::Decisions;
use bun_sema::hir::{ExprId, ExprKind, File, MemberKey, NodeData};
use bun_sema::import_sites::{find_result_expression, is_made_require};

const MAX_ALIAS_STEPS: usize = 8;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum LoaderAlias {
    Local,
    Import(SymbolId),
}

fn is_unmodified_require(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
) -> bool {
    matches!(hir[e].kind, ExprKind::Ident(_))
        && bound.binding(e) == Binding::CommonJs(CommonJsVariable::Require)
        && decisions.is_truthy_without_effects(e)
}

fn is_unmodified_import_meta_require(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> bool {
    matches!(hir.member_key(e), Some((object, MemberKey::Name(name)))
        if name == known::require && matches!(hir[hir.skip_type_assertions(object)].kind, ExprKind::ImportMeta))
        && !bound.import_meta_may_be_modified()
}

// Follows esbuild's `var __require = (x => typeof require !== "undefined" ? require : ..)(function (x) { .. })`.
pub(crate) fn resolve_loader_alias(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    e: ExprId,
) -> Option<LoaderAlias> {
    let mut e = hir.skip_type_assertions(e);
    for _ in 0..MAX_ALIAS_STEPS {
        if is_unmodified_require(hir, bound, decisions, e)
            || is_unmodified_import_meta_require(hir, bound, e)
        {
            return Some(LoaderAlias::Local);
        }
        let next = match hir[e].kind {
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = bound.binding(e) else {
                    return None;
                };
                let is_stable = matches!(
                    bound.binding_stability(symbol),
                    BindingStability::Stable | BindingStability::Linked
                );
                if !is_stable || bound.dynamic_lookup_scope(NodeData::Expr(e)).is_some() {
                    return None;
                }
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => source,
                    BindingInitializer::Import => return Some(LoaderAlias::Import(symbol)),
                    _ => return None,
                }
            }
            ExprKind::Call(_) if is_made_require(hir, bound, e) => return Some(LoaderAlias::Local),
            _ => find_result_expression(hir, decisions, e)?,
        };
        e = hir.skip_type_assertions(next);
    }
    None
}

pub(crate) fn resolve_exported_loader_alias(
    hir: &File<'_>,
    bound: &Bound<'_>,
    decisions: &Decisions<'_>,
    export_name: Atom,
) -> Option<LoaderAlias> {
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let &(_, export) = exports.iter().find(|entry| entry.0 == export_name)?;
    let local = bound
        .symbol(export)
        .decls
        .iter()
        .find_map(|&declaration| match declaration {
            Decl::ExportSpec(specifier) => {
                let item = hir[specifier];
                let statement = hir[item.export];
                if item.type_only || statement.type_only || statement.has_module_specifier {
                    return None;
                }
                match bound.exported_binding(specifier) {
                    Binding::Symbol(local) => Some(local),
                    Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
                }
            }
            Decl::Var(_) => Some(bound.declared_symbol(declaration)),
            _ => None,
        })?;
    match (
        bound.binding_stability(local),
        bound.binding_initializer(hir, local),
    ) {
        (BindingStability::Stable, BindingInitializer::Expression(source)) => {
            resolve_loader_alias(hir, bound, decisions, source)
        }
        (BindingStability::Linked, BindingInitializer::Import) => Some(LoaderAlias::Import(local)),
        _ => None,
    }
}
