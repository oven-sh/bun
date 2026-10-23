use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingStability, Bound, CommonJsVariable, Decl, SymbolId,
};
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    Branches, CallId, Chain, ExprId, ExprKind, File, Flags, FnBody, FnKind, MemberKey, NodeData,
    StmtKind,
};
use bun_sema::import_sites::is_made_require;

const MAX_ALIAS_STEPS: usize = 8;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum LoaderAlias {
    Local,
    Import(SymbolId),
}

fn stable_symbol(hir: &File<'_>, bound: &Bound<'_>, e: ExprId) -> Option<SymbolId> {
    let Binding::Symbol(symbol) = bound.binding(e) else {
        return None;
    };
    let is_stable = matches!(
        bound.binding_stability(symbol),
        BindingStability::Stable | BindingStability::Linked
    );
    let is_ident = matches!(hir[e].kind, ExprKind::Ident(_));
    (is_ident && is_stable && bound.dynamic_lookup_scope(NodeData::Expr(e)).is_none())
        .then_some(symbol)
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

fn iife_return_value(hir: &File<'_>, call: CallId) -> Option<ExprId> {
    let call = hir[call];
    let ExprKind::Fn(function) = hir[hir.skip_type_assertions(call.callee)].kind else {
        return None;
    };
    let function = &hir[function];
    let is_plain_function = matches!(function.kind, FnKind::Arrow | FnKind::Expr)
        && !function.flags.intersects(Flags::ASYNC | Flags::GENERATOR);
    if call.chain != Chain::No || !is_plain_function {
        return None;
    }
    match function.body {
        FnBody::Expr(value) => Some(value),
        FnBody::Block(statements) if statements.len() == 1 => {
            match hir[hir.id_at(statements, 0)].kind {
                StmtKind::Return(value) => value.some(),
                _ => None,
            }
        }
        FnBody::Block(_) | FnBody::None => None,
    }
}

fn live_branch(decisions: &Decisions<'_>, branches: Branches) -> Option<ExprId> {
    let Branches { yes, no } = branches;
    match (decisions.is_dead_expr(yes), decisions.is_dead_expr(no)) {
        (false, true) => Some(yes),
        (true, false) => Some(no),
        (false, false) | (true, true) => None,
    }
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
                let symbol = stable_symbol(hir, bound, e)?;
                match bound.binding_initializer(hir, symbol) {
                    BindingInitializer::Expression(source) => source,
                    BindingInitializer::Import => return Some(LoaderAlias::Import(symbol)),
                    _ => return None,
                }
            }
            ExprKind::Cond { branches, .. } => live_branch(decisions, hir.branches(branches))?,
            ExprKind::Call(_) if is_made_require(hir, bound, e) => return Some(LoaderAlias::Local),
            ExprKind::Call(call) => iife_return_value(hir, call)?,
            _ => return None,
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
