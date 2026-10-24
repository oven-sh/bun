use bun_sema::bind::{Bound, CodeUnit, Decl, ScopeId, ScopeKind, SymbolId};
use bun_sema::hir::{self, FnKind};

pub(super) fn compute_lexical_owners(hir: &hir::File<'_>, bound: &Bound<'_>) -> Vec<ScopeId> {
    let mut owners: Vec<ScopeId> = Vec::with_capacity(bound.scopes.len());
    for (id, scope) in (0..).map(ScopeId).zip(bound.scopes.iter()) {
        let parent = scope.parent.some();
        debug_assert!(parent.is_none_or(|parent| parent < id));
        let unit = bound.code_unit(id);
        let starts_unit = parent.is_none_or(|parent| bound.code_unit(parent) != unit);
        let is_lexical_owner = match unit {
            CodeUnit::File | CodeUnit::FieldInitializer(_) => starts_unit,
            CodeUnit::Function(function) => starts_unit && hir[function].kind != FnKind::Arrow,
        };
        let inherited = parent.filter(|_| !is_lexical_owner);
        let owner = inherited.map_or(id, |parent| owners[parent.idx()]);
        owners.push(owner);
    }
    owners
}

pub(super) fn find_container_binding(
    bound: &Bound<'_>,
    from: ScopeId,
    container: SymbolId,
) -> SymbolId {
    let names_container =
        |binding: &SymbolId| bound.export_symbol_of_value_symbol_if_exported(*binding) == container;
    let found = scope_chain(bound, from).find_map(|scope| {
        let binding = match bound.scopes[scope.idx()].kind {
            ScopeKind::Module(module) => bound.declared_symbol(Decl::Module(module)).some(),
            ScopeKind::Enum(declaration) => bound.declared_symbol(Decl::Enum(declaration)).some(),
            _ => None,
        };
        binding.filter(names_container)
    });
    found.unwrap_or(container)
}

pub(super) fn scope_chain(bound: &Bound<'_>, from: ScopeId) -> impl Iterator<Item = ScopeId> {
    let parent_of = move |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
    std::iter::successors(from.some(), parent_of)
}
