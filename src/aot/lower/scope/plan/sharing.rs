use bun_sema::bind::{CodeUnit, InitialState, ScopeId, ScopeKind, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{ExprId, FnKind};
use bun_sema::program::Sym;
use smallvec::SmallVec;

use super::loop_updates::is_stored_only_by_own_loop_update;
use super::{BindingSharing, Context, NormalizedUses};
use crate::ir::{ClassSlot, VariableKey};
use crate::lower::captures::{CapturedBinding, is_initialized_before};
use crate::lower::class;
use crate::lower::scope::analysis::{find_by_key, sort_unique};
use crate::lower::scope::{BindingForm, BindingRef, Initialization, ScopeSlot, WalkedFunctionId};
use crate::modules::{ExportBinding, ModuleKind};

type Users = SmallVec<[(BindingRef, WalkedFunctionId); 8]>;

pub(super) fn compute_sharing(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    uses: &NormalizedUses,
) -> BindingSharing {
    let exported = collect_exported_symbols(context, forms);
    let eval_bindings = uses.eval_uses.iter().map(|eval_use| eval_use.binding);
    let mut seen_by_eval: Vec<BindingRef> = eval_bindings.collect();
    sort_unique(&mut seen_by_eval);
    let users = uses.uses.iter().map(|&(user, binding)| (binding, user));
    let mut by_binding: Vec<(BindingRef, WalkedFunctionId)> = users.collect();
    by_binding.sort_unstable();
    let mut sharing = BindingSharing::default();
    for mut run in by_binding.chunk_by(|first, second| first.0 == second.0) {
        let binding = run[0].0;
        let Some(owner) = context.owner_of(binding) else {
            continue;
        };
        let is_exported = match binding {
            BindingRef::Symbol(symbol) => exported.binary_search(&symbol).is_ok(),
            BindingRef::Slot(..) => false,
        };
        let is_seen_by_eval = seen_by_eval.binary_search(&binding).is_ok();
        let mut readers = Users::new();
        if !is_exported && !is_seen_by_eval && context.is_holder_without_value(binding) {
            readers.extend_from_slice(run);
            drop_users_behind_initialization(context, owner, &mut readers, &mut sharing);
            run = readers.as_slice();
        }
        if run.is_empty() {
            continue;
        }
        let is_shared =
            is_exported || is_seen_by_eval || run.iter().any(|&(_, user)| user != owner);
        if is_shared {
            sharing.shared.push(binding);
        }
        let body_of = |function: WalkedFunctionId| context.module_bodies[function.index()];
        let is_used_by_other_body = run.iter().any(|&(_, user)| body_of(user) != body_of(owner));
        let key = match binding {
            BindingRef::Symbol(symbol) if is_exported => Some(symbol_key(context, symbol)),
            BindingRef::Symbol(_) | BindingRef::Slot(..) if is_used_by_other_body => {
                find_variable_key_between_bodies(context, binding)
            }
            BindingRef::Symbol(_) | BindingRef::Slot(..) => {
                find_variable_key(context, binding).filter(|_| is_shared)
            }
        };
        if let Some(key) = key {
            sharing.variables.push((binding, key));
            continue;
        }
        let captured = describe_captured_binding(context, binding, owner);
        sharing.captured.push(captured);
        let run_uses = run.iter().map(|&(binding, user)| (user, binding));
        sharing.captured_uses.extend(run_uses);
    }
    // An export that nothing in the file uses is a variable all the same.
    let used_count = sharing.variables.len();
    for &symbol in &exported {
        let binding = BindingRef::Symbol(symbol);
        let is_used = find_by_key(&sharing.variables[..used_count], binding).is_some();
        if forms[symbol.idx()] == BindingForm::Stored && !is_used {
            sharing.shared.push(binding);
            let key = symbol_key(context, symbol);
            sharing.variables.push((binding, key));
        }
    }
    sharing.fields_for_eval = collect_fields_for_eval(context, uses, &sharing.captured);
    sharing.captured_uses.sort_unstable();
    sharing.variables.sort_unstable();
    sharing.shared.sort_unstable();
    sharing
}

fn describe_captured_binding(
    context: &Context<'_, '_>,
    binding: BindingRef,
    owner: WalkedFunctionId,
) -> CapturedBinding {
    let mut is_immutable =
        is_immutable(context, binding) || is_stored_only_by_own_loop_update(context, binding);
    let mut initialization = find_initialization(context, binding);
    if !is_immutable && let Some(time) = find_time_of_last_store(context, binding, owner) {
        is_immutable = true;
        initialization = Some(Initialization {
            time: initialization.map_or(time, |initialization| initialization.time.max(time)),
            precedes_hoisted_functions: false,
        });
    }
    CapturedBinding {
        binding,
        scope: context.scope_of(binding),
        owner,
        is_immutable,
        initialization,
    }
}

// Every store stands in the function that owns the name. A closure that is made behind the last of them, and behind every loop around one, finds the value that the name keeps.
fn find_time_of_last_store(
    context: &Context<'_, '_>,
    binding: BindingRef,
    owner: WalkedFunctionId,
) -> Option<u32> {
    let BindingRef::Symbol(symbol) = binding else {
        return None;
    };
    let bound = context.input.bound;
    if bound.is_visible_to_eval(symbol) {
        return None;
    }
    let time = context.walk.last_store_times[symbol.idx()];
    if time == 0 || time == u32::MAX {
        return None;
    }
    // A `var` without an initializer holds `undefined` from the start. Any other name without an initialization that the walk has seen may be in its dead zone.
    let is_initialized = context.walk.symbol_initializations[symbol.idx()].is_some()
        || bound.initial_state(symbol) == InitialState::Undefined;
    if !is_initialized {
        return None;
    }
    let all_stores = &context.walk.symbol_stores;
    let first = all_stores.partition_point(|store| store.0 < symbol);
    let end = all_stores.partition_point(|store| store.0 <= symbol);
    let stores = &all_stores[first..end];
    if stores.iter().any(|store| store.2 != owner) {
        return None;
    }
    let is_own_store = |target: ExprId| stores.iter().any(|store| store.1 == target);
    let is_stable = context.is_stable_ignoring(symbol, is_own_store);
    is_stable.then_some(time)
}

// A closure would copy what the name holds, because the name is never stored again and is initialized before the closure is made.
fn drop_users_behind_initialization(
    context: &Context<'_, '_>,
    owner: WalkedFunctionId,
    users: &mut Users,
    sharing: &mut BindingSharing,
) {
    let Some(&(binding @ BindingRef::Symbol(symbol), _)) = users.first() else {
        return;
    };
    let walk = context.walk;
    let is_reached_through_initialization = match context.input.bound.initial_state(symbol) {
        InitialState::Uninitialized => true,
        InitialState::Undefined | InitialState::Initialized => {
            !walk.is_initialized_conditionally[symbol.idx()]
        }
    };
    let holder = describe_captured_binding(context, binding, owner);
    if !holder.is_immutable || !is_reached_through_initialization {
        return;
    }
    users.retain(|&mut (_, user)| {
        let is_behind =
            user != owner && is_initialized_before(&walk.functions, &holder, user, u32::MAX);
        if is_behind {
            sharing.initialized_holders.push((user, symbol));
        }
        !is_behind
    });
}

pub(super) fn is_immutable(context: &Context<'_, '_>, binding: BindingRef) -> bool {
    let (scope, slot) = match binding {
        BindingRef::Symbol(symbol) => return context.is_stable_ignoring(symbol, |_| false),
        BindingRef::Slot(scope, slot) => (scope, slot),
    };
    match slot {
        ScopeSlot::This | ScopeSlot::ArgumentsBinding | ScopeSlot::CommonJs(_) => {
            let stored_slots = &context.walk.stored_slots;
            stored_slots.binary_search(&(scope, slot)).is_err()
        }
        ScopeSlot::Class(
            ClassSlot::ClassObject
            | ClassSlot::ClassToken
            | ClassSlot::ComputedKey(_)
            | ClassSlot::PrivateMethod(_),
        ) => true,
        ScopeSlot::Class(ClassSlot::StaticField(_) | ClassSlot::DecoratorState) => false,
        _ => true,
    }
}

fn symbol_key(context: &Context<'_, '_>, id: SymbolId) -> VariableKey {
    let file = context.input.file;
    VariableKey::Symbol(Sym { file, id })
}

fn find_variable_key(context: &Context<'_, '_>, binding: BindingRef) -> Option<VariableKey> {
    if !context.is_module_level_scope[context.scope_of(binding).idx()] {
        return None;
    }
    create_variable_key(context, binding)
}

// The body of a module is called and never created, so it captures nothing.
fn find_variable_key_between_bodies(
    context: &Context<'_, '_>,
    binding: BindingRef,
) -> Option<VariableKey> {
    let scope = context.scope_of(binding);
    let is_entered_once = context.input.bound.code_unit(scope) == CodeUnit::File
        && !context.walk.is_repeated_scope[scope.idx()];
    let key = create_variable_key(context, binding).filter(|_| is_entered_once);
    debug_assert!(
        key.is_some(),
        "an inner module names only what the top of its file declares"
    );
    key
}

fn create_variable_key(context: &Context<'_, '_>, binding: BindingRef) -> Option<VariableKey> {
    match binding {
        BindingRef::Symbol(symbol) => Some(symbol_key(context, symbol)),
        BindingRef::Slot(scope, ScopeSlot::Class(slot)) => {
            let ScopeKind::Class(class) = context.input.bound.scopes[scope.idx()].kind else {
                return None;
            };
            let file = context.input.file;
            let class = ClassRef { file, class };
            Some(VariableKey::ClassSlot { class, slot })
        }
        BindingRef::Slot(_, ScopeSlot::CommonJs(variable)) => {
            let file = context.input.file;
            Some(VariableKey::ModulePath { file, variable })
        }
        BindingRef::Slot(
            _,
            ScopeSlot::This
            | ScopeSlot::NewTarget
            | ScopeSlot::Callee
            | ScopeSlot::HomeObject
            | ScopeSlot::Arguments
            | ScopeSlot::ArgumentsBinding
            | ScopeSlot::WithObject
            | ScopeSlot::EvalVariables,
        ) => None,
    }
}

fn is_derived_constructor_scope(context: &Context<'_, '_>, scope: ScopeId) -> bool {
    let (hir, bound) = (context.input.hir, context.input.bound);
    let ScopeKind::Fn(function) = bound.scopes[scope.idx()].kind else {
        return false;
    };
    let class = bound.function_class(function);
    hir.runtime_function_kind(function) == FnKind::Constructor
        && class.is_some_and(|class| class::is_derived_class(hir, class))
}

fn find_initialization(context: &Context<'_, '_>, binding: BindingRef) -> Option<Initialization> {
    let walk = context.walk;
    let (scope, slot) = match binding {
        BindingRef::Symbol(symbol) => return walk.symbol_initializations[symbol.idx()],
        BindingRef::Slot(scope, slot) => (scope, slot),
    };
    match slot {
        ScopeSlot::Class(
            ClassSlot::ClassObject
            | ClassSlot::ClassToken
            | ClassSlot::ComputedKey(_)
            | ClassSlot::PrivateMethod(_),
        ) => {
            let time = find_by_key(&walk.slot_initializations, (scope, slot))?;
            Some(Initialization {
                time,
                precedes_hoisted_functions: false,
            })
        }
        ScopeSlot::Class(ClassSlot::StaticField(_) | ClassSlot::DecoratorState) => None,
        ScopeSlot::This if is_derived_constructor_scope(context, scope) => None,
        _ => Some(Initialization::AT_SCOPE_ENTRY),
    }
}

fn collect_exported_symbols(context: &Context<'_, '_>, forms: &[BindingForm]) -> Vec<SymbolId> {
    let input = context.input;
    let exports = input.modules.exports(input.file).iter();
    let own_variables = exports.filter_map(|export| match export.binding {
        ExportBinding::Variable(variable) if variable.file == input.file => Some(variable.id),
        _ => None,
    });
    let mut symbols: Vec<SymbolId> = own_variables.collect();
    // `__export(all, { n: () => n }); module.exports = __toCommonJS(all)`: whoever requires the module reads the binding `n` itself.
    let callbacks = input.modules.inner_modules(input.file).iter();
    let mut body_scopes: SmallVec<[ScopeId; 4]> = callbacks
        .map(|callback| input.bound.fns[callback.idx()].scope)
        .collect();
    if input.modules.kind(input.file) == ModuleKind::CommonJs {
        body_scopes.push(context.file_scope);
    }
    if !body_scopes.is_empty() {
        body_scopes.sort_unstable();
        let commonjs = input.modules.commonjs();
        for (symbol, &form) in (0..).map(SymbolId).zip(forms) {
            if form == BindingForm::Stored
                && body_scopes
                    .binary_search(&context.declaring_scope(symbol))
                    .is_ok()
                && commonjs.is_exported_binding(input.file, symbol)
            {
                symbols.push(symbol);
            }
        }
    }
    sort_unique(&mut symbols);
    symbols
}

fn collect_fields_for_eval(
    context: &Context<'_, '_>,
    uses: &NormalizedUses,
    captured: &[CapturedBinding],
) -> Vec<BindingRef> {
    let functions = &context.walk.functions;
    let mut fields = Vec::new();
    for eval_use in &uses.eval_uses {
        let index = captured.binary_search_by_key(&eval_use.binding, |entry| entry.binding);
        let Ok(index) = index else {
            continue;
        };
        let binding = &captured[index];
        let is_passed_by_value = binding.is_immutable
            && is_initialized_before(functions, binding, eval_use.function, eval_use.time);
        if !is_passed_by_value {
            fields.push(binding.binding);
        }
    }
    sort_unique(&mut fields);
    fields
}
