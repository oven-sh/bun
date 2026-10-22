mod forms;
mod loop_updates;
mod sharing;
mod storage;
mod tables;
#[cfg(test)]
mod tests;

use bun_sema::bind::{CodeUnit, Decl, ScopeId, SymbolId};
use bun_sema::fold::Decisions;
use bun_sema::hir::ExprId;

use super::analysis::{ArgumentsObjects, ScopeAnalysis, SlotKey, find_by_key};
use super::lexical_owners::compute_lexical_owners;
use super::walk::{EvalUse, ScopeWalk, WalkInput, walk_file};
use super::{BindingForm, BindingRef, Placement, ScopeInput, WalkedFunctionId};
use crate::ir::VariableKey;
use crate::lower::captures::{
    self, CaptureInput, CapturePlan, CapturedBinding, compute_captures,
};
use crate::modules::ModuleKind;

struct Context<'x, 's> {
    input: &'x ScopeInput<'x, 's>,
    decisions: &'x Decisions<'s>,
    walk: &'x ScopeWalk,
    file_scope: ScopeId,
    scope_functions: Vec<Option<WalkedFunctionId>>,
    is_module_level_scope: Vec<bool>,
    loop_updates: Vec<(ScopeId, ExprId)>,
    // For each walked function the body that it is written in: the body of the file, or the callback of an inner module.
    module_bodies: Vec<WalkedFunctionId>,
    // The names that hold a required module of which only members are read, in order.
    holders_without_value: Vec<SymbolId>,
}

struct NormalizedUses {
    uses: Vec<(WalkedFunctionId, BindingRef)>,
    eval_uses: Vec<EvalUse>,
    references: Vec<(WalkedFunctionId, WalkedFunctionId)>,
    entry_captures: Vec<(WalkedFunctionId, BindingRef)>,
}

struct BindingSharing {
    captured: Vec<CapturedBinding>,
    captured_uses: Vec<(WalkedFunctionId, BindingRef)>,
    variables: Vec<(BindingRef, VariableKey)>,
    shared: Vec<BindingRef>,
    fields_for_eval: Vec<BindingRef>,
    initialized_holders: Vec<(WalkedFunctionId, SymbolId)>,
}

struct Placements {
    symbols: Vec<Placement>,
    slots: Vec<(SlotKey, Placement)>,
    fields: Vec<(ScopeId, BindingRef)>,
}

struct Parts {
    lexical_owners: Vec<ScopeId>,
    arguments_objects: ArgumentsObjects,
    forms: Vec<BindingForm>,
    placements: Placements,
    captures: CapturePlan,
    initialized_holders: Vec<(WalkedFunctionId, SymbolId)>,
}

fn has_module_variables(kind: ModuleKind) -> bool {
    match kind {
        ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => true,
        ModuleKind::CommonJs | ModuleKind::Runtime | ModuleKind::External => false,
    }
}

impl<'x, 's> Context<'x, 's> {
    fn new(input: &'x ScopeInput<'x, 's>, walk: &'x ScopeWalk) -> Context<'x, 's> {
        let bound = input.bound;
        let count = bound.scopes.len();
        let mut context = Context {
            input,
            decisions: &input.compiled.analysis.decisions,
            walk,
            file_scope: bound.scope_of_declaration(input.hir, Decl::File),
            scope_functions: Vec::with_capacity(count),
            is_module_level_scope: Vec::with_capacity(count),
            loop_updates: loop_updates::collect_loop_updates(input.hir, bound, walk),
            module_bodies: find_module_bodies(walk),
            holders_without_value: collect_holders_without_value(input),
        };
        let kind = input.modules.kind(input.file);
        for (index, scope) in bound.scopes.iter().enumerate() {
            let unit = bound.code_unit(ScopeId(index as u32));
            context.scope_functions.push(match unit {
                CodeUnit::File => Some(WalkedFunctionId::MODULE_BODY),
                CodeUnit::Function(function) => walk.function_of_fn[function.idx()],
                CodeUnit::FieldInitializer(member) => find_by_key(&walk.function_of_field, member),
            });
            let parent = scope.parent.some().map(ScopeId::idx);
            debug_assert!(parent.is_none_or(|parent| parent < index));
            let is_parent_at_module_level = match parent {
                Some(parent) => context.is_module_level_scope[parent],
                None => has_module_variables(kind),
            };
            let is_repeated = walk.is_repeated_scope[index];
            context
                .is_module_level_scope
                .push(is_parent_at_module_level && unit == CodeUnit::File && !is_repeated);
        }
        context
    }

    fn declaring_scope(&self, symbol: SymbolId) -> ScopeId {
        let scope = self.input.bound.symbol_scope(symbol);
        scope.some().unwrap_or(self.file_scope)
    }

    fn scope_of(&self, binding: BindingRef) -> ScopeId {
        match binding {
            BindingRef::Symbol(symbol) => self.declaring_scope(symbol),
            BindingRef::Slot(scope, _) => scope,
        }
    }

    fn owner_of(&self, binding: BindingRef) -> Option<WalkedFunctionId> {
        self.scope_functions[self.scope_of(binding).idx()]
    }

    fn module_body_of(&self, function: WalkedFunctionId) -> WalkedFunctionId {
        self.module_bodies[function.index()]
    }

    fn is_holder_without_value(&self, binding: BindingRef) -> bool {
        match binding {
            BindingRef::Symbol(symbol) => self.holders_without_value.binary_search(&symbol).is_ok(),
            BindingRef::Slot(..) => false,
        }
    }
}

fn find_module_bodies(walk: &ScopeWalk) -> Vec<WalkedFunctionId> {
    let mut bodies: Vec<WalkedFunctionId> = Vec::with_capacity(walk.functions.len());
    for (id, function) in (0..).map(WalkedFunctionId).zip(&walk.functions) {
        debug_assert!(function.creator.is_none_or(|creator| creator < id));
        let body = function.creator.map_or(id, |creator| bodies[creator.index()]);
        bodies.push(body);
    }
    bodies
}

fn collect_holders_without_value(input: &ScopeInput<'_, '_>) -> Vec<SymbolId> {
    let holders = input.modules.holders(input.file).iter();
    let without_value = holders.filter(|holder| !holder.is_needed_as_value);
    let mut symbols: Vec<SymbolId> = without_value.map(|holder| holder.symbol).collect();
    symbols.sort_unstable();
    symbols.dedup();
    symbols
}

pub(super) fn analyze(input: &ScopeInput<'_, '_>) -> ScopeAnalysis {
    let lexical_owners = compute_lexical_owners(input.hir, input.bound);
    let walk = walk_file(&WalkInput::new(input, &lexical_owners));
    let context = Context::new(input, &walk);
    let arguments_objects = forms::compute_arguments_objects(&context);
    let forms = forms::compute_forms(&context, &arguments_objects);
    let uses = forms::normalize_uses(&context, &forms, &arguments_objects);
    let sharing = sharing::compute_sharing(&context, &forms, &uses);
    let captures = compute_captures(&CaptureInput {
        functions: &walk.functions,
        bindings: &sharing.captured,
        uses: &sharing.captured_uses,
        references: &uses.references,
        entry_captures: &uses.entry_captures,
        max_captures: captures::max_captures(),
    });
    let placements = storage::place_bindings(&context, &forms, &sharing, &captures);
    tables::build_analysis(
        &context,
        Parts {
            lexical_owners,
            arguments_objects,
            forms,
            placements,
            captures,
            initialized_holders: sharing.initialized_holders,
        },
    )
}
