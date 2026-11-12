mod forms;
mod loop_updates;
mod sharing;
mod storage;
mod tables;
#[cfg(test)]
mod tests;

use bun_sema::bind::{BindingStability, CodeUnit, Decl, ScopeId, SymbolId};
use bun_sema::hir::{ExprId, FnId};
use bun_sema::import_sites::{ImportSiteKind, JsxImport};

pub(in crate::lower) use self::loop_updates::is_let_declaration;
use super::analysis::{ArgumentsObjects, ScopeAnalysis, SlotKey, find_by_key, sort_unique};
use super::lexical_owners::compute_lexical_owners;
use super::walk::{EvalUse, ScopeWalk, walk_file};
use super::{BindingForm, BindingRef, Placement, ScopeInput, ScopeSlot, WalkedFunctionId};
use crate::ir::VariableKey;
use crate::lower::captures::{CaptureInput, CapturePlan, CapturedBinding, compute_captures};
use crate::modules::{ImportBinding, ModuleGraph, ModuleKind, ModuleRef, SiteAnswer};

struct Context<'x, 's> {
    input: &'x ScopeInput<'x, 's>,
    walk: &'x ScopeWalk,
    file_scope: ScopeId,
    scope_functions: Vec<Option<WalkedFunctionId>>,
    module_bodies: Vec<WalkedFunctionId>,
    is_module_level_scope: Vec<bool>,
    /// Scopes that each instance of the file enters once; none in a file without instances.
    is_entered_once_per_instance: Vec<bool>,
    loop_updates: Vec<(ScopeId, ExprId)>,
    holders_without_value: Vec<SymbolId>,
    has_instances: bool,
    instance_imports: Vec<SymbolId>,
}

/// Whether code of `file` that reads `binding`, which a statement imports from `named`, reads it through the instance of
/// `file`: a link or a mock word leads to it.
fn is_read_through_instance(
    modules: &ModuleGraph,
    binding: ImportBinding,
    named: Option<ModuleRef>,
) -> bool {
    let end = match binding {
        ImportBinding::Variable(variable) => Some(ModuleRef::File(variable.file)),
        ImportBinding::Synthetic(export) => Some(modules.synthetic_export(export).module),
        ImportBinding::Namespace { module, .. }
        | ImportBinding::NamespaceRead { module, .. }
        | ImportBinding::Exports { module } => Some(module),
        _ => None,
    };
    let has_link_or_word = |module| match module {
        ModuleRef::File(file) => {
            modules.has_instances(file) || modules.holds_mock_in_variable(file)
        }
        ModuleRef::Runtime(_) => modules.is_named_by_mock(module),
        ModuleRef::External { .. } => modules.is_absent_module(module),
        _ => false,
    };
    let reaches_mock = |module| match module {
        ModuleRef::File(file) => modules.reaches_mock(file),
        _ => false,
    };
    end.is_some_and(has_link_or_word)
        || named.is_some_and(|named| has_link_or_word(named) || reaches_mock(named))
}

fn find_instance_imports(input: &ScopeInput<'_, '_>) -> Vec<SymbolId> {
    let (modules, file) = (input.modules, input.file);
    if !modules.has_instances(file) {
        return Vec::new();
    }
    let imports = modules.import_bindings(file).iter();
    let imports = imports.filter(|&&(symbol, binding)| {
        let site = match *input.bound.symbol(symbol).decls {
            [Decl::ImportSpec(specifier)] => Some(input.hir[specifier].import),
            [Decl::ImportDefault(import) | Decl::ImportNamespace(import)] => Some(import),
            _ => None,
        };
        let site = site.map(ImportSiteKind::Import);
        let named = match site.and_then(|site| modules.find_site_answer(file, site)) {
            Some(SiteAnswer::Module(named)) => Some(named),
            _ => None,
        };
        is_read_through_instance(modules, binding, named)
    });
    imports.map(|it| it.0).collect()
}

pub(super) fn is_instance_jsx_import(input: &ScopeInput<'_, '_>, import: JsxImport) -> bool {
    let (modules, file) = (input.modules, input.file);
    if !modules.has_instances(file) {
        return false;
    }
    let named = match modules.find_site_answer(file, import.site_kind()) {
        Some(SiteAnswer::Module(named)) => Some(named),
        _ => None,
    };
    let bindings = modules.jsx_bindings(file).iter();
    let mut bindings = bindings.filter(|it| it.0 == import);
    bindings.any(|&(_, binding)| is_read_through_instance(modules, binding, named))
}

struct NormalizedUses {
    uses: Vec<(WalkedFunctionId, BindingRef)>,
    eval_uses: Vec<EvalUse>,
    references: Vec<(WalkedFunctionId, WalkedFunctionId)>,
    entry_captures: Vec<(WalkedFunctionId, BindingRef)>,
}

#[derive(Default)]
struct BindingSharing {
    captured: Vec<CapturedBinding>,
    captured_uses: Vec<(WalkedFunctionId, BindingRef)>,
    variables: Vec<(BindingRef, VariableKey)>,
    instance_fields: Vec<(BindingRef, u32)>,
    shared: Vec<BindingRef>,
    fields_for_eval: Vec<BindingRef>,
    stored_under_handlers: Vec<Vec<BindingRef>>,
    fields_for_handlers: Vec<BindingRef>,
    initialized_holders: Vec<(WalkedFunctionId, SymbolId)>,
    registries: Vec<(ScopeId, BindingRef)>,
}

struct Placements {
    symbols: Vec<Placement>,
    slots: Vec<(SlotKey, Placement)>,
    fields: Vec<(ScopeId, BindingRef)>,
    initial_functions: Vec<(SymbolId, FnId)>,
}

struct Parts {
    lexical_owners: Vec<ScopeId>,
    arguments_objects: ArgumentsObjects,
    forms: Vec<BindingForm>,
    placements: Placements,
    stored_under_handlers: Vec<Vec<BindingRef>>,
    captures: CapturePlan,
    initialized_holders: Vec<(WalkedFunctionId, SymbolId)>,
    registries: Vec<(ScopeId, BindingRef)>,
}

impl<'x, 's> Context<'x, 's> {
    fn new(input: &'x ScopeInput<'x, 's>, walk: &'x ScopeWalk) -> Context<'x, 's> {
        let bound = input.bound;
        let count = bound.scopes.len();
        let mut context = Context {
            input,
            walk,
            file_scope: bound.scope_of_declaration(input.hir, Decl::File),
            scope_functions: Vec::with_capacity(count),
            is_module_level_scope: Vec::with_capacity(count),
            is_entered_once_per_instance: Vec::new(),
            loop_updates: loop_updates::collect_loop_updates(input.hir, bound, walk),
            module_bodies: find_module_bodies(walk),
            holders_without_value: collect_holders_without_value(input),
            has_instances: input.modules.has_instances(input.file),
            instance_imports: find_instance_imports(input),
        };
        let has_module_variables = match input.modules.kind(input.file) {
            ModuleKind::SourceText if input.modules.may_be_reevaluated(input.file) => false,
            ModuleKind::SourceText | ModuleKind::Data | ModuleKind::RuntimeSource => true,
            ModuleKind::CommonJs => input.modules.runs_body_once(ModuleRef::File(input.file)),
            ModuleKind::Runtime | ModuleKind::External => false,
        };
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
                None => has_module_variables,
            };
            let is_repeated = walk.is_repeated_scope[index];
            let is_entered_once = unit == CodeUnit::File && !is_repeated;
            context
                .is_module_level_scope
                .push(is_parent_at_module_level && is_entered_once);
            if context.has_instances {
                let scopes = &mut context.is_entered_once_per_instance;
                let is_parent_entered_once = parent.is_none_or(|parent| scopes[parent]);
                scopes.push(is_parent_entered_once && is_entered_once);
            }
        }
        context
    }

    #[inline]
    fn is_entered_once_per_instance(&self, scope: ScopeId) -> bool {
        self.has_instances && self.is_entered_once_per_instance[scope.idx()]
    }

    #[inline]
    fn declaring_scope(&self, symbol: SymbolId) -> ScopeId {
        let scope = self.input.bound.symbol_scope(symbol);
        scope.some().unwrap_or(self.file_scope)
    }

    #[inline]
    fn scope_of(&self, binding: BindingRef) -> ScopeId {
        match binding {
            BindingRef::Symbol(symbol) => self.declaring_scope(symbol),
            BindingRef::Slot(scope, _) => scope,
        }
    }

    /// The scope whose environment holds a binding. The file's environment also holds the bindings of scopes that are
    /// entered once per instance, so module-level functions capture no other environment.
    #[inline]
    fn storage_scope(&self, binding: BindingRef) -> ScopeId {
        let scope = self.scope_of(binding);
        match self.is_entered_once_per_instance(scope) {
            true => self.file_scope,
            false => scope,
        }
    }

    #[inline]
    fn owner_of(&self, binding: BindingRef) -> Option<WalkedFunctionId> {
        self.scope_functions[self.scope_of(binding).idx()]
    }

    fn is_stable_ignoring(&self, symbol: SymbolId, is_ignored: impl Fn(ExprId) -> bool) -> bool {
        let (bound, decisions) = (self.input.bound, &self.input.compiled.analysis.decisions);
        let is_ignored = |target: ExprId| decisions.is_dead_expr(target) || is_ignored(target);
        bound.binding_stability_ignoring(symbol, &is_ignored) == BindingStability::Stable
    }

    #[inline]
    fn instance_slot(&self) -> BindingRef {
        BindingRef::Slot(self.file_scope, ScopeSlot::ModuleInstance)
    }

    fn find_instance_field(&self, symbol: SymbolId) -> Option<u32> {
        if !self.has_instances {
            return None;
        }
        let layout = self.input.modules.instance_layout(self.input.file)?;
        layout.field_of_export(symbol)
    }

    fn is_read_through_instance(&self, import: SymbolId) -> bool {
        self.has_instances && self.instance_imports.binary_search(&import).is_ok()
    }

    #[inline]
    fn is_holder_without_value(&self, binding: BindingRef) -> bool {
        binding.is_listed_in(&self.holders_without_value)
    }
}

fn find_module_bodies(walk: &ScopeWalk) -> Vec<WalkedFunctionId> {
    let mut bodies: Vec<WalkedFunctionId> = Vec::with_capacity(walk.functions.len());
    for (id, function) in (0..).map(WalkedFunctionId).zip(&walk.functions) {
        debug_assert!(function.creator.is_none_or(|creator| creator < id));
        let creator = function.creator;
        bodies.push(creator.map_or(id, |creator| bodies[creator.index()]));
    }
    bodies
}

fn collect_holders_without_value(input: &ScopeInput<'_, '_>) -> Vec<SymbolId> {
    let holders = input.modules.holders(input.file).iter();
    let without_value = holders.filter(|holder| !holder.is_needed_as_value);
    let mut symbols: Vec<SymbolId> = without_value.map(|holder| holder.symbol).collect();
    sort_unique(&mut symbols);
    symbols
}

pub(super) fn analyze(input: &ScopeInput<'_, '_>) -> ScopeAnalysis {
    let lexical_owners = compute_lexical_owners(input.hir, input.bound);
    let walk = walk_file(input, &lexical_owners);
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
        max_captures: input.max_captures,
    });
    let placements = storage::place_bindings(&context, &forms, &sharing, &captures);
    let parts = Parts {
        lexical_owners,
        arguments_objects,
        forms,
        placements,
        stored_under_handlers: sharing.stored_under_handlers,
        captures,
        initialized_holders: sharing.initialized_holders,
        registries: sharing.registries,
    };
    tables::build_analysis(&context, parts)
}
