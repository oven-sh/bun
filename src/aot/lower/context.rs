mod function;
mod function_table;
mod shown_names;
#[cfg(test)]
mod tests;

use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound};
use bun_sema::check::aot::{BuiltinTypeSymbols, FunctionRef, NamedValues, Queries, QueryInputs};
use bun_sema::erasure::{TypeRanges, find_type_ranges};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, ExprId, NodeData};
use bun_sema::program::{CompiledModule, FileId, FileRole};
use rustc_hash::FxHashMap;

use self::function_table::FunctionTable;
use self::shown_names::ShownNames;
use super::LoweredFile;
use super::class::ClassState;
use super::fragment::{FragmentBuilder, ModuleFragment};
use super::layouts::{DefinedObjectTypes, LayoutState};
use super::module::{LibraryFunctions, ModuleState};
use super::scope::{ScopeAnalysis, ScopeInput, analyze_scopes};
use super::types::TypeState;
use crate::builtins::id::RuntimeModule;
use crate::builtins::{BuiltinNames, Platforms, ResolvedBuiltins, SourceDialect};
use crate::compile::removable::Removable;
use crate::diagnostic_codes::Code;
use crate::diagnostics::{DiagnosticBuffer, Span};
use crate::ir::generated::FunctionRole;
use crate::ir::types::release_spare_capacity;
use crate::ir::{BuilderScratch, ModuleId, PropertyKey, PropertyKeyId, StringId, WellKnownSymbol};
use crate::known_helpers::KnownHelpers;
use crate::load::Sources;
use crate::modules::{CommonJsExports, DeferredData, ModuleGraph, ModuleRef};
use crate::options::RemovableOptions;
use crate::statistics::{Counters, LimitId, LimitValues, StatisticId};

pub(crate) use self::function::FunctionLowering;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceKind {
    Program,
    RuntimeModule(RuntimeModule),
    RuntimeFunctions,
}

impl SourceKind {
    pub fn dialect(self) -> SourceDialect {
        match self {
            SourceKind::Program => SourceDialect::Program,
            SourceKind::RuntimeModule(_) | SourceKind::RuntimeFunctions => SourceDialect::Runtime,
        }
    }

    pub fn function_role(self) -> FunctionRole {
        match self {
            SourceKind::Program => FunctionRole::Source,
            SourceKind::RuntimeModule(_) | SourceKind::RuntimeFunctions => FunctionRole::Library,
        }
    }
}

#[derive(Copy, Clone)]
pub struct FileInputs<'a> {
    pub source: SourceKind,
    pub builtins: &'a ResolvedBuiltins,
}

#[derive(Copy, Clone, Debug)]
pub struct LoweringOptions {
    pub platform: Platforms,
    pub embeds_function_text: bool,
    pub reports_type_mismatches: bool,
    pub removable: RemovableOptions,
    pub minifies_identifiers: bool,
}

pub struct LoweringInputs<'a> {
    pub roles: &'a [FileRole],
    // `QueryInputs::checked_elsewhere`
    pub checked_elsewhere: &'a [FileId],
    pub builtin_types: &'a BuiltinTypeSymbols,
    pub named_values: &'a dyn NamedValues,
    pub builtin_names: &'a BuiltinNames,
    pub sources: &'a Sources,
    pub modules: &'a ModuleGraph,
    // The files of Bun's own that no code of the program loads, in order.
    pub unreached_files: &'a [FileId],
    // The files that whoever builds the program cannot mend, in order.
    pub files_of_dependencies: &'a [FileId],
    pub deferred_data: &'a DeferredData<'a>,
    pub library_functions: &'a LibraryFunctions,
    pub known_helpers: &'a KnownHelpers,
    pub commonjs_exports: &'a CommonJsExports,
    pub defined_object_types: &'a DefinedObjectTypes,
    pub files: &'a [Option<FileInputs<'a>>],
    pub limits: &'a LimitValues,
    pub options: LoweringOptions,
}

impl<'a> LoweringInputs<'a> {
    // The file is in the build for the types that it declares alone: the program has no module of it.
    pub(crate) fn is_left_out(&self, file: FileId) -> bool {
        self.modules.is_left_out(ModuleRef::File(file))
            || self.unreached_files.binary_search(&file).is_ok()
    }

    pub fn query_inputs(&self) -> QueryInputs<'a> {
        QueryInputs {
            roles: self.roles,
            checked_elsewhere: self.checked_elsewhere,
            builtin_types: self.builtin_types,
            named_values: self.named_values,
            max_inference_nodes: self.limits.get(LimitId::MaxInferenceNodes),
        }
    }
}

pub(crate) struct FileLowering<'a, 'c, 'p, 's> {
    pub(crate) inputs: &'a LoweringInputs<'a>,
    pub(crate) file: FileId,
    pub(crate) role: FileRole,
    pub(crate) source: SourceKind,
    pub(crate) hir: &'p hir::File<'s>,
    pub(crate) bound: &'p Bound<'s>,
    pub(crate) compiled: &'p CompiledModule<'s>,
    /// What the text of a function of this file is given without.
    pub(crate) type_ranges: TypeRanges,
    pub(crate) builtins: &'a ResolvedBuiltins,
    /// `Removable::find_simplified_expressions`
    simplified_expressions: Vec<ExprId>,
    pub(crate) queries: &'a mut Queries<'c, 'p, 's>,
    pub(crate) fragment: FragmentBuilder,
    pub(crate) diagnostics: DiagnosticBuffer,
    pub(crate) scopes: ScopeAnalysis,
    pub(crate) types: TypeState,
    pub(crate) layouts: LayoutState,
    pub(crate) classes: ClassState,
    pub(crate) modules: ModuleState,
    functions: FunctionTable,
    atoms: FxHashMap<Atom, StringId>,
    atom_keys: FxHashMap<Atom, PropertyKeyId>,
    shown_names: ShownNames,
    counters: Counters,
    scratch: BuilderScratch,
    pub(crate) has_chain_past_nesting_limit: bool,
}

impl<'a, 'c, 'p, 's> FileLowering<'a, 'c, 'p, 's> {
    pub(super) fn new(
        inputs: &'a LoweringInputs<'a>,
        queries: &'a mut Queries<'c, 'p, 's>,
        file: FileId,
    ) -> FileLowering<'a, 'c, 'p, 's> {
        let hir = queries.hir();
        let bound = queries.bound();
        let compiled = queries.files().compiled(file);
        let compiled = compiled.expect("only compiled files are lowered");
        let file_inputs = inputs.files[file.idx()].expect("every lowered file has its inputs");
        let scopes = analyze_scopes(&ScopeInput {
            file,
            hir,
            bound,
            compiled,
            modules: inputs.modules,
            builtins: file_inputs.builtins,
            max_captures: inputs.limits.get(LimitId::MaxCaptures) as usize,
        });
        let has_types_in_function_text = inputs.options.embeds_function_text && !hir.is_js;
        let type_ranges = match has_types_in_function_text {
            true => find_type_ranges(hir),
            false => TypeRanges::default(),
        };
        let removable = Removable::of_file(
            queries.files(),
            file,
            &compiled.analysis,
            file_inputs.builtins,
            inputs.options.removable,
        );
        FileLowering {
            inputs,
            file,
            role: queries.role(file),
            source: file_inputs.source,
            hir,
            bound,
            compiled,
            type_ranges,
            builtins: file_inputs.builtins,
            simplified_expressions: removable.find_simplified_expressions(),
            queries,
            fragment: FragmentBuilder::new(file),
            diagnostics: DiagnosticBuffer::default(),
            scopes,
            types: TypeState::default(),
            layouts: LayoutState::default(),
            classes: ClassState::default(),
            modules: ModuleState::default(),
            functions: FunctionTable::default(),
            atoms: FxHashMap::default(),
            atom_keys: FxHashMap::default(),
            shown_names: ShownNames::new(inputs.options, file_inputs.source, hir, bound),
            counters: Counters::default(),
            scratch: BuilderScratch::default(),
            has_chain_past_nesting_limit: false,
        }
    }

    pub(super) fn refuse_chains_past_nesting_limit(&mut self) {
        let maximum = self.inputs.limits.get(LimitId::MaxNestingDepth);
        let Some(position) = self.queries.find_chain_longer_than(maximum) else {
            return;
        };
        self.has_chain_past_nesting_limit = true;
        self.gave_up(LimitId::MaxNestingDepth, position);
        let span = self.span_at(position);
        let depth = maximum.to_string();
        self.diagnostics
            .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
    }

    pub(super) fn finish(mut self, module: ModuleFragment) -> LoweredFile {
        self.fragment.is_checked = self.is_checked();
        let mut fragment = self.fragment.finish(module);
        fragment.strings.share_strings();
        fragment.property_keys.release_spare_capacity();
        fragment.types.share_types();
        release_spare_capacity(&mut fragment.function_keys);
        release_spare_capacity(&mut fragment.layout_keys);
        release_spare_capacity(&mut fragment.variable_keys);
        release_spare_capacity(&mut fragment.functions);
        release_spare_capacity(&mut fragment.layouts);
        release_spare_capacity(&mut fragment.object_types);
        release_spare_capacity(&mut fragment.object_type_levels);
        release_spare_capacity(&mut fragment.variables);
        release_spare_capacity(&mut fragment.type_sites);
        release_spare_capacity(&mut fragment.expected_results);
        release_spare_capacity(&mut fragment.data);
        release_spare_capacity(&mut fragment.supertype_edges);
        release_spare_capacity(&mut fragment.function_type_edges);
        LoweredFile {
            fragment,
            diagnostics: self.diagnostics,
            counters: self.counters,
            queries: self.queries.statistics(),
        }
    }

    pub(crate) fn is_simplified(&self, expression: ExprId) -> bool {
        self.simplified_expressions
            .binary_search(&expression)
            .is_ok()
    }

    pub(crate) fn decisions(&self) -> &'p Decisions<'s> {
        let compiled = self.compiled;
        &compiled.analysis.decisions
    }

    pub(crate) fn is_in_dependency(&self) -> bool {
        self.inputs
            .files_of_dependencies
            .binary_search(&self.file)
            .is_ok()
    }

    pub(crate) fn is_checked(&self) -> bool {
        match self.role {
            FileRole::Checked => true,
            FileRole::Inferred | FileRole::TypesOnly => false,
        }
    }

    pub(crate) fn evaluated_function(&self, call: ExprId) -> Option<FunctionRef> {
        let function = self.inputs.sources.evaluated_function(self.file, call)?;
        let is_lowered = self.inputs.files[function.file.idx()].is_some();
        is_lowered.then_some(function)
    }

    pub(crate) fn intern_bytes(&mut self, bytes: &[u8]) -> StringId {
        self.fragment.strings.intern(bytes)
    }

    pub(crate) fn intern_atom(&mut self, atom: Atom) -> StringId {
        debug_assert!(atom != Atom::NONE, "a name was expected");
        if let Some(&id) = self.atoms.get(&atom) {
            return id;
        }
        let id = self.fragment.strings.intern(self.queries.atom_bytes(atom));
        self.atoms.insert(atom, id);
        id
    }

    pub(crate) fn intern_binding_name(&mut self, binding: Binding, written: Atom) -> StringId {
        match self.short_binding_name(binding) {
            Some(name) => name,
            None => self.intern_atom(written),
        }
    }

    pub(crate) fn intern_function_name(&mut self, binding: Binding, written: Atom) -> StringId {
        match self.short_function_name(binding) {
            Some(name) => name,
            None => self.intern_atom(written),
        }
    }

    pub(crate) fn text_key(&mut self, text: StringId) -> PropertyKeyId {
        self.fragment
            .property_keys
            .intern(PropertyKey::from_text(text))
    }

    pub(crate) fn atom_key(&mut self, atom: Atom) -> PropertyKeyId {
        if let Some(&key) = self.atom_keys.get(&atom) {
            return key;
        }
        let text = self.intern_atom(atom);
        let key = self.text_key(text);
        self.atom_keys.insert(atom, key);
        key
    }

    pub(crate) fn symbol_key(&mut self, symbol: WellKnownSymbol) -> PropertyKeyId {
        let key = PropertyKey::from_well_known_symbol(symbol);
        self.fragment.property_keys.intern(key)
    }

    pub(crate) fn module_id(&mut self) -> ModuleId {
        self.fragment.declare_module(ModuleRef::File(self.file))
    }

    pub(crate) fn span_of(&self, node: NodeData) -> Span {
        Span::of_node(self.hir, self.file, node)
    }

    pub(crate) fn span_at(&self, position: u32) -> Span {
        Span {
            file: self.file,
            start: position,
            end: position,
        }
    }

    pub(crate) fn count(&mut self, statistic: StatisticId, amount: u64) {
        self.counters.count(statistic, amount);
    }

    pub(crate) fn gave_up(&mut self, limit: LimitId, position: u32) {
        let subject = self.span_at(position);
        self.counters.gave_up(limit, Some(subject));
    }
}
