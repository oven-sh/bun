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
use bun_sema::bind::{Binding, Bound, CodeUnit, CommonJsVariable, ScopeId, SymbolId};
use bun_sema::hir::{self, ExprId, PatId, StmtId};
use bun_sema::program::{CompiledModule, FileId};

use super::{FileLowering, FunctionLowering};
use crate::builtins::ResolvedBuiltins;
use crate::ir::{BlockId, ClassSlot, DeclaredType, LayoutId, ValueId, VariableId, VariableKey};
use crate::modules::ModuleGraph;

pub(crate) use self::analysis::ScopeAnalysis;
pub(in crate::lower) use self::analysis::{
    ArgumentsObject, BindingForm, BindingRef, Placement, Storage,
};
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

pub(crate) fn ensure_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: VariableKey,
) -> VariableId {
    variables::ensure_variable(file, key)
}

pub(crate) fn enter_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) {
    enter::enter_scope(lowering, scope);
}

pub(crate) fn leave_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) {
    enter::leave_scope(lowering, scope);
}

pub(crate) fn enter_with_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    object: ValueId,
) {
    enter::enter_with_scope(lowering, scope, object);
}

pub(crate) fn innermost_scope(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> ScopeId {
    lowering.scopes.innermost_scope()
}

pub(crate) fn create_loop_header(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    statement: StmtId,
) -> BlockId {
    enter::create_loop_header(lowering, statement)
}

pub(crate) fn copy_iteration_bindings(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) {
    enter::copy_iteration_bindings(lowering, scope);
}

pub(crate) fn lower_identifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    identifiers::lower_identifier(lowering, identifier)
}

pub(crate) fn lower_identifier_for_typeof(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    identifiers::lower_identifier_for_typeof(lowering, identifier)
}

pub(crate) fn lower_identifier_callee(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> (ValueId, Option<ValueId>) {
    identifiers::lower_identifier_callee(lowering, identifier)
}

pub(crate) fn delete_identifier(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> ValueId {
    identifiers::delete_identifier(lowering, identifier)
}

pub(crate) fn resolve_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    identifier: ExprId,
) -> IdentifierTarget {
    identifiers::resolve_identifier_target(lowering, identifier)
}

pub(crate) fn resolve_pattern_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
) -> IdentifierTarget {
    identifiers::resolve_pattern_target(lowering, pattern)
}

pub(crate) fn get_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: &IdentifierTarget,
) -> ValueId {
    identifiers::get_identifier_target(lowering, target)
}

pub(crate) fn set_identifier_target(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    target: &IdentifierTarget,
    value: ValueId,
    source: Option<ExprId>,
) {
    identifiers::set_identifier_target(lowering, target, value, source);
}

pub(crate) fn get_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
) -> ValueId {
    bindings::get_binding(lowering, binding, name)
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

pub(crate) fn initialize_converted_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
    value: ValueId,
) {
    bindings::initialize_converted_symbol(lowering, symbol, name, value);
}

pub(crate) fn initialize_pattern_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
    value: ValueId,
    source: Option<ExprId>,
) {
    identifiers::initialize_pattern_name(lowering, pattern, value, source);
}

pub(crate) fn find_tested_local(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<SymbolId> {
    identifiers::find_tested_local(lowering, expression)
}

pub(crate) fn read_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> ValueId {
    identifiers::read_local(lowering, symbol)
}

pub(crate) fn local_position(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> DeclaredType {
    environments::stored_position(lowering.file, BindingRef::Symbol(symbol))
}

pub(crate) fn rebind_local(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    value: ValueId,
) {
    identifiers::rebind_local(lowering, symbol, value);
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

pub(in crate::lower) fn get_mapped_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
    index: u32,
) -> ValueId {
    bindings::get_mapped_argument(lowering, unit, index)
}

pub(in crate::lower) fn set_mapped_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
    index: u32,
    value: ValueId,
) {
    bindings::set_mapped_argument(lowering, unit, index, value);
}

pub(crate) fn lower_direct_eval(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> ValueId {
    eval::lower_direct_eval(lowering, call)
}

pub(in crate::lower) fn allocate_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    initial: &[(BindingRef, ValueId)],
) {
    enter::allocate_scope(lowering, scope, initial);
}

pub(in crate::lower) fn instantiate_functions(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) {
    enter::instantiate_functions(lowering, scope);
}

pub(in crate::lower) fn get_stored(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: BindingRef,
) -> ValueId {
    bindings::get_stored(lowering, binding)
}

pub(in crate::lower) fn get_environment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
) -> ValueId {
    environments::get_environment(lowering, scope)
}

pub(in crate::lower) fn environment_layout(
    file: &mut FileLowering<'_, '_, '_, '_>,
    scope: ScopeId,
) -> LayoutId {
    environments::environment_layout(file, scope)
}

pub(in crate::lower) fn stored_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    binding: BindingRef,
) -> DeclaredType {
    environments::stored_position(file, binding)
}
