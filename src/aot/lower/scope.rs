mod analysis;
mod bindings;
mod dead_zone;
mod dynamic;
mod enter;
mod environments;
mod eval;
mod identifiers;
mod lexical_owners;
mod plan;
mod state;
#[cfg(test)]
pub(in crate::lower) mod testing;
mod variables;
mod walk;

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, CommonJsVariable, ScopeId, SymbolId};
use bun_sema::hir::{self};
use bun_sema::program::{CompiledModule, FileId};

use super::FunctionLowering;
use crate::builtins::ResolvedBuiltins;
use crate::ir::{ClassSlot, DeclaredType, ValueId};
use crate::modules::ModuleGraph;

pub(crate) use self::analysis::ScopeAnalysis;
pub(in crate::lower) use self::analysis::{
    ArgumentsObject, BindingForm, BindingRef, Placement, Storage,
};
pub(in crate::lower) use self::environments::environment_layout;
pub(crate) use self::eval::lower_direct_eval;
pub(crate) use self::identifiers::find_tested_local;
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
    /// What a closure has room for in this build.
    pub(crate) max_captures: usize,
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
}

fn find_entry<K: Copy + PartialEq, V: Copy>(entries: &[(K, V)], key: K) -> Option<V> {
    let entry = entries.iter().find(|entry| entry.0 == key)?;
    Some(entry.1)
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
