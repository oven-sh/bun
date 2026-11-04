use bun_sema::bind::{
    Binding, Bound, CodeUnit, Decl, ScopeId, ScopeKind, SymbolId, is_among_parameters,
};
use bun_sema::hir::{self, FnKind};

use super::{BindingRef, ScopeSlot};

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
    let found = scope_chain(bound, from).find_map(|scope| {
        let declaration = match bound.scopes[scope.idx()].kind {
            ScopeKind::Module(module) => Decl::Module(module),
            ScopeKind::Enum(declaration) => Decl::Enum(declaration),
            _ => return None,
        };
        let binding = bound.declared_symbol(declaration).some()?;
        let names_container = bound.export_symbol_of_value_symbol_if_exported(binding) == container
            || bound.symbol_of_declaration(declaration) == container;
        names_container.then_some(binding)
    });
    found.unwrap_or_else(|| bound.file_binding(container))
}

/// The binding whose name is looked for at run time where code in `from` names `binding`: `size` in `namespace Box` is `Box.size` in what runs.
pub(super) fn find_binding_looked_for(bound: &Bound<'_>, from: ScopeId, binding: Binding) -> Binding {
    let Binding::Symbol(symbol) = binding else {
        return binding;
    };
    let container = bound.symbol(symbol).parent.some();
    match container.filter(|&container| container != bound.file_symbol) {
        Some(container) => Binding::Symbol(find_container_binding(bound, from, container)),
        None => binding,
    }
}

pub(super) fn scope_chain(bound: &Bound<'_>, from: ScopeId) -> impl Iterator<Item = ScopeId> {
    let parent_of = move |scope: &ScopeId| bound.scopes[scope.idx()].parent.some();
    std::iter::successors(from.some(), parent_of)
}

/// A walk outwards over the objects that hold bindings made at run time.
#[derive(Copy, Clone)]
pub(super) struct ScopeObjectSearch {
    pub(super) start: ScopeId,
    /// The first scope that is not searched.
    pub(super) until: ScopeId,
    /// The scope of the binding that the name has where no object holds it.
    pub(super) declaring_scope: ScopeId,
    /// The position of the code that searches.
    pub(super) pos: u32,
    /// The name is that of a namespace or an enum whose member the code names: only the object of a `with` can take it.
    pub(super) asks_with_objects_alone: bool,
}

// A function has two objects. The inner one takes the variables of text evaluated in its body, the outer one those of text evaluated among its parameters. The parameters lie between the two.
pub(super) fn for_each_scope_object(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    search: ScopeObjectSearch,
    mut visit: impl FnMut(BindingRef),
) {
    let mut from = ScopeKind::Block;
    for scope in scope_chain(bound, search.start).take_while(|&scope| scope != search.until) {
        let kind = bound.scopes[scope.idx()].kind;
        match kind {
            ScopeKind::With(_) => visit(BindingRef::Slot(scope, ScopeSlot::WithObject)),
            _ if search.asks_with_objects_alone => {}
            ScopeKind::Fn(function) => {
                if !is_among_parameters(hir, function, from, search.pos) {
                    visit(BindingRef::Slot(scope, ScopeSlot::EvalVariables));
                }
                if scope != search.declaring_scope {
                    visit(BindingRef::Slot(scope, ScopeSlot::ParameterEvalVariables));
                }
            }
            _ => visit(BindingRef::Slot(scope, ScopeSlot::EvalVariables)),
        }
        from = kind;
    }
}
