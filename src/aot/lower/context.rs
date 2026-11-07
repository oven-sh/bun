mod function;
mod function_table;
mod shown_names;
#[cfg(test)]
mod tests;
mod text_replaced_by_bundling;

use bun_core::current_work;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, SymbolId};
use bun_sema::check::aot::{
    BuiltinTypeSymbols, ConstLocalPrefixes, FunctionRef, NamedValues, Queries, QueryInputs,
};
use bun_sema::erasure::{TypeRanges, find_type_ranges, find_type_ranges_beside};
use bun_sema::fold::{Constant, Decisions};
use bun_sema::hir::{self, ExprId, ExprKind, NodeData, VarDeclId};
use bun_sema::import_sites::ResolvedForm;
use bun_sema::program::{CompiledModule, FileId, FileRole, Files};
use bun_sema::resolve::TranspileSettings;
use rustc_hash::FxHashMap;

use self::function_table::FunctionTable;
use self::shown_names::ShownNames;
use self::text_replaced_by_bundling::find_text_replaced_by_bundling;
use super::LoweredFile;
use super::call::PrintedOperators;
use super::class::ClassState;
use super::counted_places::CountedPlaces;
use super::fragment::{FragmentBuilder, ModuleFragment};
use super::layouts::{DefinedObjectTypes, LayoutState};
use super::module::{LibraryFunctions, ModuleState};
use super::prepared::{PreparedFile, PreparedFiles};
use super::scope::{RegistryNames, ScopeAnalysis, ScopeInput, analyze_scopes};
use super::transpiled::{ParsedText, Rewrite, RuntimeTranspiler, TranspileRequest, TranspiledFile};
use super::types::TypeState;
use crate::builtins::id::RuntimeModule;
use crate::builtins::{
    BuiltinClass, BuiltinNames, Platforms, ResolvedBuiltins, SourceDialect, table,
};
use crate::compile::removable::Removable;
use crate::diagnostic_codes::Code;
use crate::diagnostics::{DiagnosticBuffer, Span};
use crate::engine::describe_regexp_syntax_error;
use crate::ir::generated::FunctionRole;
use crate::ir::types::release_spare_capacity;
use crate::ir::{BuilderScratch, ModuleId, PropertyKey, PropertyKeyId, StringId, WellKnownSymbol};
use crate::known_helpers::KnownHelpers;
use crate::load::{self, Sources};
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

impl FileInputs<'_> {
    // By what the names in the file are bound to.
    pub(crate) fn makes_registries(&self) -> bool {
        let constructor = table::class_data(BuiltinClass::FinalizationRegistry).constructor;
        let mut mentioned = self.builtins.mentioned().iter();
        mentioned.any(|&id| Some(table::canonical_id(id)) == constructor)
    }
}

#[derive(Copy, Clone, Debug)]
pub struct LoweringOptions {
    pub platform: Platforms,
    pub embeds_function_text: bool,
    pub reports_type_mismatches: bool,
    pub removable: RemovableOptions,
    pub minifies_identifiers: bool,
    pub obfuscates: bool,
    /// `bun test --aot --coverage`: the files of the project count how often their parts run.
    pub counts_executions: bool,
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
    // A file of the program makes a FinalizationRegistry, which any file of it may come to hold.
    pub makes_registries: bool,
    // A file of an executable reads `__filename` or `__dirname` or asks `require.resolve`: a path of the machine that builds, which any file of the program may come to hold.
    pub reads_source_paths: bool,
    /// `LoadOptions::replaced_builtins`
    pub replaced_builtins: &'a [u32],
    pub limits: &'a LimitValues,
    pub transpiler: &'a RuntimeTranspiler<'a>,
    pub prepared: &'a PreparedFiles,
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
    /// `FileLowering::is_built_by_code`
    pub(in crate::lower) levels_of_literals_inside_built_ones: FxHashMap<ExprId, u64>,
    shown_names: ShownNames,
    has_bundled_positions: bool,
    runs_as_written: bool,
    pub(in crate::lower) transpiled: Option<TranspiledFile>,
    pub(in crate::lower) const_local_prefixes: ConstLocalPrefixes,
    pub(in crate::lower) inlined_constants: FxHashMap<VarDeclId, Option<Constant>>,
    pub(in crate::lower) names_only_inlined_constants: FxHashMap<ExprId, bool>,
    pub(in crate::lower) enum_member_reads: FxHashMap<ExprId, Constant>,
    /// The position of each plain function that has a header, and `FileLowering::position_of_making_this_in`.
    pub(in crate::lower) where_this_is_made: Vec<(u32, u32)>,
    pub(in crate::lower) printed_operators: PrintedOperators,
    pub(in crate::lower) counted_places: Option<CountedPlaces>,
    counters: Counters,
    scratch: BuilderScratch,
}

fn runs_file_as_written(kind: load::SourceKind, hir: &hir::File<'_>) -> bool {
    match kind {
        load::SourceKind::EvaluatedText => true,
        // The helpers of the bundler.
        load::SourceKind::RuntimeModule(module) => table::is_es_module(module),
        load::SourceKind::Program
        | load::SourceKind::Data
        | load::SourceKind::TypesOnly
        | load::SourceKind::RuntimeFunctions => hir::find_transpiled_mark(&hir.text).is_some(),
    }
}

/// The build runs the macros of a file itself, so the transpiler is asked without them and cannot tell what `bun run` says of such a file.
fn imports_macro(hir: &hir::File<'_>) -> bool {
    hir.imports.iter().any(|import| {
        !import.type_only
            && hir.import_attribute(import.attributes, known::r#type) == Some(known::r#macro)
    })
}

/// What `bun run` reports of TypeScript's own syntax in a file of the program is an error of the build too: nothing else says what that syntax is.
/// What is JavaScript, the grammar that has read the file has said. So the transpiler's errors count where it reads the text once all that
/// TypeScript erases is taken out.
fn transpile_file(
    inputs: &LoweringInputs<'_>,
    files: &Files<'_>,
    file: FileId,
    settings: &TranspileSettings,
    diagnostics: &mut DiagnosticBuffer,
) -> Option<TranspiledFile> {
    let module = files.module(file);
    let hir = &module.hir;
    let request = TranspileRequest {
        path: inputs.sources.diagnostic_path(file),
        text: &hir.text,
        loader: inputs.sources.loader(file),
        has_legacy_decorators: hir.legacy_decorators,
        assigns_class_fields: settings.use_define_for_class_fields == Some(false),
        parsed: Some(ParsedText {
            hir,
            bound: &module.bound,
            atoms: &files.atoms,
            max_steps: inputs.limits.get(LimitId::MaxStepsToPrintedInitializer),
        }),
    };
    let errors = match inputs.transpiler.transpile(&request) {
        Ok(transpiled) => return Some(transpiled),
        Err(errors) => errors,
    };
    if inputs.sources.kind(file) != load::SourceKind::Program || imports_macro(hir) {
        return None;
    }
    let erased = find_type_ranges(hir);
    if errors.is_empty() || erased.is_empty() {
        return None;
    }
    let text = &erased.remove_from(&hir.text);
    let without_types = TranspileRequest {
        text,
        parsed: None,
        ..request
    };
    if inputs.transpiler.transpile(&without_types).is_ok() {
        for error in errors {
            let span = Span {
                file,
                start: error.start,
                end: error.end,
            };
            diagnostics.report(Code::RefusedByTranspiler, span, &[&error.message]);
        }
    }
    None
}

fn transpile_as_at_run_time(
    inputs: &LoweringInputs<'_>,
    files: &Files<'_>,
    file: FileId,
    diagnostics: &mut DiagnosticBuffer,
) -> Option<TranspiledFile> {
    let compiled = files.compiled(file);
    let compiled = compiled.expect("only compiled files are lowered");
    // The positions in Bun's own modules come from a table.
    let is_transpiled_at_run_time = match inputs.sources.kind(file) {
        load::SourceKind::Program | load::SourceKind::Data | load::SourceKind::TypesOnly => {
            !runs_file_as_written(inputs.sources.kind(file), files.hir(file))
        }
        load::SourceKind::EvaluatedText
        | load::SourceKind::RuntimeModule(_)
        | load::SourceKind::RuntimeFunctions => false,
    };
    match is_transpiled_at_run_time {
        true => transpile_file(inputs, files, file, compiled.settings, diagnostics),
        false => None,
    }
}

fn may_hold_registries(inputs: &LoweringInputs<'_>, file: FileId) -> bool {
    let file_inputs = inputs.files[file.idx()].expect("every lowered file has its inputs");
    inputs.makes_registries || file_inputs.makes_registries()
}

fn analyze_scopes_of_file(
    inputs: &LoweringInputs<'_>,
    files: &Files<'_>,
    file: FileId,
    transpiled: Option<&TranspiledFile>,
    holds_registry: &dyn Fn(SymbolId) -> bool,
) -> ScopeAnalysis {
    let module = files.module(file);
    let file_inputs = inputs.files[file.idx()].expect("every lowered file has its inputs");
    analyze_scopes(&ScopeInput {
        file,
        hir: &module.hir,
        bound: &module.bound,
        compiled: module.compiled.expect("only compiled files are lowered"),
        transpiled,
        modules: inputs.modules,
        builtins: file_inputs.builtins,
        holds_registry,
        max_captures: inputs.limits.get(LimitId::MaxCaptures) as usize,
        max_handler_arguments: inputs.limits.get(LimitId::MaxHandlerArguments) as usize,
        max_handler_arguments_per_block: inputs.limits.get(LimitId::MaxHandlerArgumentsPerBlock)
            as usize,
    })
}

/// On a thread that does not visit the file, while the file is visited or waits for its visit.
pub fn prepare_file(
    inputs: &LoweringInputs<'_>,
    files: &Files<'_>,
    file: FileId,
    may_be_lowered: impl FnOnce() -> bool,
) {
    if !inputs.prepared.begin(file) {
        return;
    }
    if !may_be_lowered() {
        return inputs.prepared.leave_to_the_visit(file);
    }
    let path = files.module(file).file_name();
    let _work = current_work::working_on(current_work::Step::Lower, path);
    let mut diagnostics = DiagnosticBuffer::default();
    let transpiled = transpile_as_at_run_time(inputs, files, file, &mut diagnostics);
    let asks_no_checker = !may_hold_registries(inputs, file);
    let scopes = (asks_no_checker && inputs.prepared.is_being_lowered(file))
        .then(|| analyze_scopes_of_file(inputs, files, file, transpiled.as_ref(), &|_| false));
    let prepared = PreparedFile {
        transpiled,
        diagnostics,
        scopes,
    };
    inputs.prepared.finish(file, prepared);
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
        let runs_as_written = runs_file_as_written(inputs.sources.kind(file), hir);
        let PreparedFile {
            transpiled,
            diagnostics,
            scopes,
        } = inputs.prepared.take(file).unwrap_or_else(|| {
            let mut diagnostics = DiagnosticBuffer::default();
            PreparedFile {
                transpiled: transpile_as_at_run_time(
                    inputs,
                    queries.files(),
                    file,
                    &mut diagnostics,
                ),
                diagnostics,
                scopes: None,
            }
        });
        // What `bun test --coverage` reports on: no package, and nothing of Bun's own.
        let path = inputs.sources.diagnostic_path(file);
        let is_counted = inputs.options.counts_executions
            && inputs.sources.kind(file) == load::SourceKind::Program
            && !inputs.sources.is_package_file_to_coverage(path);
        let counted_places = is_counted.then(|| CountedPlaces::find(hir, bound, path));
        let scopes = scopes.unwrap_or_else(|| {
            let may_hold_registries = may_hold_registries(inputs, file);
            let files = queries.files();
            let registries = RegistryNames::new(&mut *queries);
            analyze_scopes_of_file(inputs, files, file, transpiled.as_ref(), &|symbol| {
                may_hold_registries && registries.holds(symbol)
            })
        });
        let type_ranges = match inputs.options.embeds_function_text {
            true => {
                let decisions = &compiled.analysis.decisions;
                let atoms = &queries.files().atoms;
                let find_operand_printed_alone =
                    |expression: ExprId| match transpiled.as_ref()?.find_rewrite(expression)? {
                        Rewrite::Operand(operand) => Some(operand),
                        _ => None,
                    };
                let replaced = find_text_replaced_by_bundling(
                    hir,
                    bound,
                    decisions,
                    atoms,
                    &find_operand_printed_alone,
                );
                find_type_ranges_beside(hir, replaced)
            }
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
            diagnostics,
            scopes,
            types: TypeState::default(),
            layouts: LayoutState::default(),
            classes: ClassState::default(),
            modules: ModuleState::default(),
            functions: FunctionTable::default(),
            atoms: FxHashMap::default(),
            atom_keys: FxHashMap::default(),
            levels_of_literals_inside_built_ones: FxHashMap::default(),
            shown_names: ShownNames::new(
                inputs.options,
                file_inputs.source,
                hir,
                bound,
                inputs.sources.bundled_names(file),
            ),
            has_bundled_positions: inputs.sources.bundled_positions(file).is_some(),
            runs_as_written,
            transpiled,
            const_local_prefixes: ConstLocalPrefixes::default(),
            inlined_constants: FxHashMap::default(),
            names_only_inlined_constants: FxHashMap::default(),
            enum_member_reads: FxHashMap::default(),
            where_this_is_made: Vec::new(),
            printed_operators: PrintedOperators::default(),
            counted_places,
            counters: Counters::default(),
            scratch: BuilderScratch::default(),
        }
    }

    /// `bun run` reports a file that holds such a literal and runs nothing of it, whether or not anything reads the literal. The engine sees the
    /// literals that the transpiler prints.
    pub(super) fn refuse_invalid_regexp_literals(&mut self) {
        if self.inputs.sources.kind(self.file) != load::SourceKind::Program {
            return;
        }
        for (index, expression) in self.hir.exprs.iter().enumerate() {
            let ExprKind::Regex { pattern, flags } = expression.kind else {
                continue;
            };
            let transpiled = self.transpiled.as_ref();
            if transpiled.is_some_and(|it| !it.has_regexp_literal_at(expression.pos)) {
                continue;
            }
            let pattern = self.queries.atom_bytes(pattern);
            let flags = self.queries.atom_bytes(flags);
            if let Some(sentence) = describe_regexp_syntax_error(pattern, flags) {
                let span = self.span_of(NodeData::Expr(ExprId(index as u32)));
                self.diagnostics
                    .report(Code::InvalidRegExp, span, &[&sentence]);
            }
        }
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

    pub(crate) fn is_path_from_own_directory(&self, argument: ExprId) -> bool {
        self.compiled.analysis.is_path_from_own_directory(argument)
    }

    pub(crate) fn find_resolved_form(&self, argument: ExprId) -> Option<ResolvedForm> {
        self.compiled.analysis.find_resolved_form(argument)
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

    // `bun run` hands the text to the engine as it is written, without its transpiler.
    pub(crate) fn runs_as_written(&self) -> bool {
        self.runs_as_written
    }

    // A stack trace shows the positions that the engine records in the text it runs: no source map takes them back to a token.
    pub(crate) fn is_shown_without_source_map(&self) -> bool {
        self.has_bundled_positions || self.runs_as_written()
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
