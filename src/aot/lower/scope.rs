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
pub(crate) use self::bindings::{get_binding, initialize_converted_symbol};
pub(in crate::lower) use self::bindings::{get_mapped_argument, get_stored, set_mapped_argument};
pub(in crate::lower) use self::enter::{allocate_scope, instantiate_functions};
pub(crate) use self::enter::{
    copy_iteration_bindings, create_loop_header, enter_scope, enter_with_scope, leave_scope,
};
pub(in crate::lower) use self::environments::{
    environment_layout, get_environment, stored_position,
};
pub(crate) use self::eval::lower_direct_eval;
pub(crate) use self::identifiers::{
    delete_identifier, find_tested_local, get_identifier_target, initialize_pattern_name,
    lower_identifier, lower_identifier_callee, lower_identifier_for_typeof, read_local,
    rebind_local, resolve_identifier_target, resolve_pattern_target, set_identifier_target,
};
pub(crate) use self::state::ScopeState;
pub(in crate::lower) use self::state::{DeadZone, LocalBinding};
pub(crate) use self::variables::ensure_variable;
pub(in crate::lower) use self::walk::{Initialization, WalkedFunction, WalkedFunctionId};

pub(crate) struct ScopeInput<'x, 's> {
    pub(crate) file: FileId,
    pub(crate) hir: &'x hir::File<'s>,
    pub(crate) bound: &'x Bound<'s>,
    pub(crate) compiled: &'x CompiledModule<'s>,
    pub(crate) modules: &'x ModuleGraph,
    pub(crate) builtins: &'x ResolvedBuiltins,
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
enum IdentifierTargetKind {
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

pub(crate) struct IdentifierTarget {
    kind: IdentifierTargetKind,
}

pub(crate) fn analyze_scopes(input: &ScopeInput<'_, '_>) -> ScopeAnalysis {
    plan::analyze(input)
}

pub(crate) fn innermost_scope(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> ScopeId {
    lowering.scopes.innermost_scope()
}

pub(crate) fn set_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
) {
    bindings::set_binding(lowering, binding, name, value, None);
}

pub(crate) fn initialize_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
) {
    bindings::initialize_binding(lowering, binding, name, value, None);
}

pub(crate) fn local_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> DeclaredType {
    environments::stored_position(lowering.file, BindingRef::Symbol(symbol))
}

pub(crate) fn get_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    slot: ScopeSlot,
) -> ValueId {
    bindings::get_stored(lowering, BindingRef::Slot(scope, slot))
}

pub(crate) fn set_slot(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    slot: ScopeSlot,
    value: ValueId,
) {
    bindings::set_stored(lowering, BindingRef::Slot(scope, slot), value);
}
