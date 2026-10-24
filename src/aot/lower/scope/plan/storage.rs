use bun_sema::bind::{ScopeId, SymbolId};
use bun_sema::hir::FnId;

use super::sharing::is_immutable;
use super::{BindingSharing, Context, Placements};
use crate::ir::VariableKey;
use crate::lower::captures::CapturePlan;
use crate::lower::scope::analysis::{SlotKey, find_by_key, sort_unique};
use crate::lower::scope::{BindingForm, BindingRef, Placement, Storage};

pub(super) fn place_bindings(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    sharing: &BindingSharing,
    captures: &CapturePlan,
) -> Placements {
    let bindings = captures.fields.iter().chain(&sharing.fields_for_eval);
    let fields = bindings.map(|&binding| (context.scope_of(binding), binding));
    let mut fields: Vec<(ScopeId, BindingRef)> = fields.collect();
    sort_unique(&mut fields);
    let initial_functions = find_initial_functions(context, &sharing.variables, captures);
    let place = |binding: BindingRef| {
        let scope = context.scope_of(binding);
        let storage = if let Some(key) = find_by_key(&sharing.variables, binding) {
            Storage::Variable(key)
        } else if let Ok(position) = fields.binary_search(&(scope, binding)) {
            let first_of_scope = fields.partition_point(|field| field.0 < scope);
            let field = (position - first_of_scope) as u32;
            Storage::Field { scope, field }
        } else {
            Storage::Local
        };
        let starts_as_function = match binding {
            BindingRef::Symbol(symbol) => find_by_key(&initial_functions, symbol).is_some(),
            BindingRef::Slot(..) => false,
        };
        let is_immutable = is_immutable(context, binding);
        let has_local = match storage {
            Storage::Local => true,
            Storage::Field { .. } | Storage::Variable(_) => is_immutable && !starts_as_function,
        };
        Placement {
            storage,
            has_local,
            is_immutable,
            is_shared: sharing.shared.binary_search(&binding).is_ok(),
        }
    };
    let symbols = (0..).map(SymbolId).zip(forms);
    let symbols = symbols.map(|(symbol, &form)| match form {
        BindingForm::Stored => place(BindingRef::Symbol(symbol)),
        _ => Placement::LOCAL,
    });
    let symbols: Vec<Placement> = symbols.collect();
    let captured = sharing.captured.iter().map(|captured| captured.binding);
    let variables = sharing.variables.iter().map(|variable| variable.0);
    let slots = captured.chain(variables);
    let slots = slots.filter_map(|binding| match binding {
        BindingRef::Symbol(_) => None,
        BindingRef::Slot(scope, slot) => Some(((scope, slot), place(binding))),
    });
    let mut slots: Vec<(SlotKey, Placement)> = slots.collect();
    slots.sort_unstable_by_key(|slot| slot.0);
    Placements {
        symbols,
        slots,
        fields,
        initial_functions,
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
