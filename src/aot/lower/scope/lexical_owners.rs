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
    let mut next = from.some();
    while let Some(scope) = next {
        let binding = match bound.scopes[scope.idx()].kind {
            ScopeKind::Module(module) => bound.declared_symbol(Decl::Module(module)).some(),
            ScopeKind::Enum(declaration) => bound.declared_symbol(Decl::Enum(declaration)).some(),
            ScopeKind::File
            | ScopeKind::Fn(_)
            | ScopeKind::Block
            | ScopeKind::Class(_)
            | ScopeKind::Interface(_)
            | ScopeKind::TypeAlias(_)
            | ScopeKind::TypeParams
            | ScopeKind::TypeParamList(_)
            | ScopeKind::Param(_)
            | ScopeKind::ReturnType(_)
            | ScopeKind::Extends
            | ScopeKind::InferConstraint
            | ScopeKind::StaticMember
            | ScopeKind::ComputedName
            | ScopeKind::BaseExpression
            | ScopeKind::FunctionName(_)
            | ScopeKind::PropertyDeclaration(..)
            | ScopeKind::PropertyType(..)
            | ScopeKind::With(_)
            | ScopeKind::FieldInitializer(_)
            | ScopeKind::ClassDecorators(_)
            | ScopeKind::ImplicitBlock(_) => None,
        };
        if let Some(binding) = binding
            && bound.export_symbol_of_value_symbol_if_exported(binding) == container
        {
            return binding;
        }
        next = bound.scopes[scope.idx()].parent.some();
    }
    container
}
