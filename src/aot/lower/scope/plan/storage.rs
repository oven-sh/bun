use bun_sema::bind::{ScopeId, SymbolId};
use bun_sema::hir::FnId;

use super::sharing::is_immutable;
use super::{BindingSharing, Context, Placements};
use crate::ir::VariableKey;
use crate::lower::captures::CapturePlan;
use crate::lower::scope::analysis::{SlotKey, find_by_key};
use crate::lower::scope::{BindingForm, BindingRef, Placement, Storage};

struct PlacementTables<'x, 's> {
    context: &'x Context<'x, 's>,
    fields: &'x [(ScopeId, BindingRef)],
    variables: &'x [(BindingRef, VariableKey)],
    shared: &'x [BindingRef],
    initial_functions: &'x [(SymbolId, FnId)],
}

pub(super) fn place_bindings(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    sharing: &BindingSharing,
    captures: &CapturePlan,
) -> Placements {
    let fields = collect_fields(context, sharing, captures);
    let initial_functions = find_initial_functions(context, &sharing.variables, captures);
    let tables = PlacementTables {
        context,
        fields: &fields,
        variables: &sharing.variables,
        shared: &sharing.shared,
        initial_functions: &initial_functions,
    };
    let place_stored =
        |binding: BindingRef| place(binding, &tables, is_immutable(context, binding));
    let symbols = (0..)
        .map(SymbolId)
        .zip(forms)
        .map(|(symbol, &form)| match form {
            BindingForm::Stored => place_stored(BindingRef::Symbol(symbol)),
            BindingForm::NotAValue
            | BindingForm::Import
            | BindingForm::Callee { .. }
            | BindingForm::MappedArgument { .. }
            | BindingForm::ContainerMember { .. } => Placement::LOCAL,
        });
    let symbols: Vec<Placement> = symbols.collect();
    let captured = sharing.captured.iter().map(|captured| captured.binding);
    let variables = sharing.variables.iter().map(|variable| variable.0);
    let slots = captured
        .chain(variables)
        .filter_map(|binding| match binding {
            BindingRef::Symbol(_) => None,
            BindingRef::Slot(scope, slot) => Some(((scope, slot), place_stored(binding))),
        });
    let mut slots: Vec<(SlotKey, Placement)> = slots.collect();
    slots.sort_unstable_by_key(|slot| slot.0);
    Placements {
        symbols,
        slots,
        fields,
    }
}

pub(super) fn find_initial_functions(
    context: &Context<'_, '_>,
    variables: &[(BindingRef, VariableKey)],
    captures: &CapturePlan,
) -> Vec<(SymbolId, FnId)> {
    let walk = context.walk;
    let mut functions = Vec::new();
    for &(scope, symbol, function) in &walk.hoisted_functions {
        let walked = walk.function_of_fn[function.idx()];
        if scope == context.file_scope
            && find_by_key(variables, BindingRef::Symbol(symbol)).is_some()
            && walked.is_some_and(|walked| captures.captures[walked.index()].is_empty())
        {
            functions.push((symbol, function));
        }
    }
    functions.sort_unstable();
    functions
}

fn collect_fields(
    context: &Context<'_, '_>,
    sharing: &BindingSharing,
    captures: &CapturePlan,
) -> Vec<(ScopeId, BindingRef)> {
    let bindings = captures.fields.iter().chain(&sharing.fields_for_eval);
    let fields = bindings.map(|&binding| (context.scope_of(binding), binding));
    let mut fields: Vec<(ScopeId, BindingRef)> = fields.collect();
    fields.sort_unstable();
    fields.dedup();
    fields
}

fn find_storage(binding: BindingRef, tables: &PlacementTables<'_, '_>) -> Storage {
    if let Some(key) = find_by_key(tables.variables, binding) {
        return Storage::Variable(key);
    }
    let scope = tables.context.scope_of(binding);
    let Ok(position) = tables.fields.binary_search(&(scope, binding)) else {
        return Storage::Local;
    };
    let first_of_scope = tables.fields.partition_point(|field| field.0 < scope);
    let field = (position - first_of_scope) as u32;
    Storage::Field { scope, field }
}

fn place(binding: BindingRef, tables: &PlacementTables<'_, '_>, is_immutable: bool) -> Placement {
    let storage = find_storage(binding, tables);
    let starts_as_function = match binding {
        BindingRef::Symbol(symbol) => find_by_key(tables.initial_functions, symbol).is_some(),
        BindingRef::Slot(..) => false,
    };
    let has_local = match storage {
        Storage::Local => true,
        Storage::Field { .. } | Storage::Variable(_) => is_immutable && !starts_as_function,
    };
    Placement {
        storage,
        has_local,
        is_immutable,
        is_shared: tables.shared.binary_search(&binding).is_ok(),
    }
}
