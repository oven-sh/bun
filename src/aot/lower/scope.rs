mod analysis;
mod bindings;
mod called_declarations;
mod called_initializers;
mod dead_zone;
mod dynamic;
mod enter;
mod environments;
mod eval;
mod identifiers;
mod lexical_owners;
mod plan;
mod registries;
mod state;
#[cfg(test)]
pub(in crate::lower) mod testing;
mod variables;
mod walk;

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, CommonJsVariable, ScopeId, SymbolId};
use bun_sema::hir::{self, MemberId};
use bun_sema::program::{CompiledModule, FileId};

use super::FunctionLowering;
use crate::builtins::ResolvedBuiltins;
use crate::ir::{ClassSlot, DeclaredType, ValueId};
use crate::modules::ModuleGraph;

pub(crate) use self::analysis::ScopeAnalysis;
pub(in crate::lower) use self::analysis::{
    ArgumentsObject, BindingForm, BindingRef, Placement, Storage,
};
pub(in crate::lower) use self::called_declarations::{
    CalledByName, find_declaration_called_by_name, find_declaration_made_at_first_read,
};
pub(in crate::lower) use self::called_initializers::find_function_that_initializes;
pub(in crate::lower) use self::enter::MakerOfScope;
pub(in crate::lower) use self::environments::{
    ResolvedFields, environment_layout, instance_layout,
};
pub(in crate::lower) use self::eval::NamesOfFileForEvals;
pub(crate) use self::eval::lower_direct_eval;
pub(crate) use self::identifiers::find_tested_local;
pub(in crate::lower) use self::plan::is_let_declaration;
pub(in crate::lower) use self::registries::holds_registry;
pub(crate) use self::state::ScopeState;
pub(in crate::lower) use self::state::{DeadZone, LocalBinding};
pub(in crate::lower) use self::walk::{Initialization, WalkedFunction, WalkedFunctionId};

pub(crate) struct ScopeInput<'x, 's> {
    pub(crate) file: FileId,
    pub(crate) hir: &'x hir::File<'s>,
    pub(crate) bound: &'x Bound<'s>,
    pub(crate) compiled: &'x CompiledModule<'s>,
    pub(crate) modules: &'x ModuleGraph,
    pub(crate) builtins: &'x ResolvedBuiltins,
    pub(crate) fields_under_signed_members: &'x [MemberId],
    /// Which of some variables hold registries; `None` if nothing makes any.
    pub(crate) find_registries: Option<&'x dyn Fn(&[SymbolId]) -> Vec<bool>>,
    pub(crate) max_captures: usize,
    pub(crate) names_lie_on_object_prototype: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub(crate) enum ScopeSlot {
    This,
    NewTarget,
    Callee,
    HomeObject,
    Arguments,
    ArgumentsBinding,
    CommonJs(CommonJsVariable),
    WithObject,
    EvalVariables,
    ParameterEvalVariables,
    ModuleInstance,
    Class(ClassSlot),
}

#[derive(Copy, Clone, Debug)]
pub(crate) enum IdentifierTarget {
    Binding {
        binding: Binding,
        name: Atom,
        is_dead_zone_tested: bool,
    },
    Dynamic {
        binding: Binding,
        name: Atom,
        holder: ValueId,
    },
    MemberOf {
        binding: Binding,
        name: Atom,
        container: ValueId,
    },
}

fn find_entry<K: Copy + PartialEq, V: Copy>(entries: &[(K, V)], key: K) -> Option<V> {
    let entry = entries.iter().find(|entry| entry.0 == key)?;
    Some(entry.1)
}

fn sum_counts(counts: &mut [u32]) {
    for number in 1..counts.len() {
        counts[number] += counts[number - 1];
    }
}

fn order_by_number<T: Copy>(
    list: impl ExactSizeIterator<Item = T> + Clone,
    number_count: usize,
    number_of: impl Fn(T) -> usize,
) -> Vec<T> {
    let Some(first) = list.clone().next() else {
        return Vec::new();
    };
    let mut places = vec![0u32; number_count + 1];
    for entry in list.clone() {
        places[number_of(entry) + 1] += 1;
    }
    sum_counts(&mut places);
    let mut ordered = vec![first; list.len()];
    for entry in list {
        let place = &mut places[number_of(entry)];
        ordered[*place as usize] = entry;
        *place += 1;
    }
    ordered
}

pub(crate) fn analyze_scopes(input: &ScopeInput<'_, '_>) -> ScopeAnalysis {
    plan::analyze(input)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn innermost_scope(&self) -> ScopeId {
        self.scopes.innermost_scope()
    }

    pub(crate) fn local_position(&mut self, symbol: SymbolId) -> DeclaredType {
        self.file.stored_position(BindingRef::Symbol(symbol))
    }

    pub(crate) fn get_slot(&mut self, scope: ScopeId, slot: ScopeSlot) -> ValueId {
        self.get_stored(BindingRef::Slot(scope, slot))
    }

    pub(crate) fn set_slot(&mut self, scope: ScopeId, slot: ScopeSlot, value: ValueId) {
        self.set_stored(BindingRef::Slot(scope, slot), value);
    }
}

pub(crate) fn set_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
) {
    lowering.store_binding(binding, name, value, None, true);
}

pub(crate) fn initialize_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
) {
    bindings::initialize_binding(lowering, binding, name, value, None);
}
