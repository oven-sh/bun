mod function;
mod function_table;
mod shown_names;
#[cfg(test)]
mod tests;

use core::cell::{OnceCell, RefCell};
use core::mem::take;
use std::borrow::Cow;

use bun_core::printer::{FIRST_ASCII, LAST_ASCII, bmp_escape, surrogate_pair_escape};
use bun_core::strings::{CodepointIterator, Cursor};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, SymbolId};
use bun_sema::check::aot::{BuiltinTypeSymbols, NamedValues, Queries, QueryInputs};
use bun_sema::erasure::ReplacedText;
use bun_sema::fold::{Constant, Decisions};
use bun_sema::hir::{self, ExprId, ExprKind, MemberId, NodeData};
use bun_sema::hir_from_data::DataValue;
use bun_sema::import_sites::ResolvedForm;
use bun_sema::program::{CompiledModule, FileId, FileRole, Files};
use rustc_hash::{FxHashMap, FxHashSet};

use self::function_table::FunctionTable;
use self::shown_names::ShownNames;
use super::class::{ClassState, find_fields_under_signed_members};
use super::counted_places::CountedPlaces;
use super::fragment::{FragmentBuilder, ModuleFragment};
use super::layouts::{LayoutState, NamesCreatedOnExports};
use super::module::{LibraryFunctions, ModuleState};
use super::object::EnumsThatStayAsBorn;
use super::quoted_text::QuotedTexts;
use super::said_types::SaidTypes;
use super::scope::{RegistryNames, ScopeAnalysis, ScopeInput, analyze_scopes};
use super::tables::TaskState;
use super::types::TypeState;
use super::{KnownHelpersLowered, LoweredFile};
use crate::builtins::id::RuntimeModule;
use crate::builtins::{
    BuiltinClass, BuiltinId, BuiltinNames, Platforms, ResolvedBuiltins, SourceDialect, table,
};
use crate::compile::removable::Removable;
use crate::diagnostic_codes::Code;
use crate::diagnostics::{DiagnosticBuffer, Span};
use crate::engine::describe_regexp_syntax_error;
use crate::ir::generated::FunctionRole;
use crate::ir::{BuilderScratch, ModuleId, PropertyKey, PropertyKeyId, StringId, WellKnownSymbol};
use crate::known_helpers::KnownHelpers;
use crate::load::contents::FixedBuiltins;
use crate::load::test_runner_names::written_name_of_local;
use crate::load::{self, Sources};
use crate::modules::{CommonJsExports, KnownMemberValues, KnownObjects, ModuleGraph, ModuleRef};
use crate::options::RemovableOptions;
use crate::statistics::{LimitId, LimitValues};

pub(crate) use self::function::FunctionLowering;

pub(super) fn regexp_pattern_as_printed(written: &[u8]) -> Cow<'_, [u8]> {
    let is_printed_as_written = |character: u32| (FIRST_ASCII..=LAST_ASCII).contains(&character);
    if written
        .iter()
        .all(|&byte| is_printed_as_written(u32::from(byte)))
    {
        return Cow::Borrowed(written);
    }
    let mut printed = Vec::with_capacity(written.len() * 2);
    let characters = CodepointIterator::init(written);
    let mut cursor = Cursor::default();
    while characters.next(&mut cursor) {
        match cursor.c as u32 {
            character if is_printed_as_written(character) => printed.push(character as u8),
            character @ 0..=0xFFFF => printed.extend_from_slice(&bmp_escape(character)),
            character => printed.extend_from_slice(&surrogate_pair_escape(character)),
        }
    }
    Cow::Owned(printed)
}

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
    pub removable: RemovableOptions,
    pub minifies_identifiers: bool,
    pub obfuscates: bool,
    pub counts_executions: bool,
    pub runs_tests: bool,
}

pub struct LoweringInputs<'a> {
    pub roles: &'a [FileRole],
    pub builtin_types: &'a BuiltinTypeSymbols,
    pub named_values: &'a dyn NamedValues,
    pub builtin_names: &'a BuiltinNames,
    pub sources: &'a Sources,
    pub modules: &'a ModuleGraph,
    pub unreached_files: &'a [FileId],
    pub files_of_dependencies: &'a [FileId],
    pub library_functions: &'a LibraryFunctions,
    pub known_helpers: &'a KnownHelpers,
    pub commonjs_exports: &'a CommonJsExports,
    pub names_created_on_exports: &'a NamesCreatedOnExports,
    pub files: &'a [Option<FileInputs<'a>>],
    pub makes_registries: bool,
    pub page_manifests: &'a [(FileId, &'a DataValue<'a>)],
    pub reads_source_paths: bool,
    pub may_have_plugins: bool,
    pub replaced_builtins: &'a [u32],
    pub fixed_builtins: &'a FixedBuiltins,
    pub names_added_to_builtins: &'a [(BuiltinId, Atom)],
    pub limits: &'a LimitValues,
    pub options: LoweringOptions,
    pub said_types: &'a SaidTypes,
}

impl<'a> LoweringInputs<'a> {
    pub(crate) fn names_lie_on_object_prototype(&self) -> bool {
        let added = self.names_added_to_builtins;
        let first = added.partition_point(|&(holder, _)| holder < BuiltinId::ObjectPrototype);
        (added.get(first)).is_some_and(|&(holder, _)| holder == BuiltinId::ObjectPrototype)
    }

    pub(crate) fn is_left_out(&self, file: FileId) -> bool {
        self.modules.is_left_out(ModuleRef::File(file))
            || self.unreached_files.binary_search(&file).is_ok()
    }

    pub fn query_inputs(&self) -> QueryInputs<'a> {
        QueryInputs {
            roles: self.roles,
            checked_elsewhere: &[],
            builtin_types: self.builtin_types,
            named_values: self.named_values,
            max_inference_nodes: self.limits.get(LimitId::MaxInferenceNodes),
            limits: self.limits.for_queries(),
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
    pub(in crate::lower) values_written_in_place: RefCell<Vec<(ExprId, Constant)>>,
    pub(in crate::lower) enums_written_as_code: Vec<ReplacedText>,
    pub(crate) builtins: &'a ResolvedBuiltins,
    simplified_expressions: Vec<ExprId>,
    invalid_regexp_literals_left_out: Vec<ExprId>,
    pub(crate) queries: &'a mut Queries<'c, 'p, 's>,
    pub(in crate::lower) task: &'a mut TaskState,
    pub(crate) fragment: FragmentBuilder,
    pub(crate) diagnostics: DiagnosticBuffer,
    pub(crate) scopes: ScopeAnalysis,
    pub(crate) types: TypeState,
    pub(crate) layouts: LayoutState,
    pub(crate) classes: ClassState,
    pub(crate) modules: ModuleState,
    functions: FunctionTable,
    pub(in crate::lower) levels_of_literals_inside_built_ones: FxHashMap<ExprId, u64>,
    pub(in crate::lower) literals_named_as_prototype_objects: OnceCell<FxHashSet<ExprId>>,
    shown_names: ShownNames,
    pub(in crate::lower) enum_member_reads: FxHashMap<ExprId, Constant>,
    pub(in crate::lower) enums_that_stay_as_born: Option<EnumsThatStayAsBorn>,
    pub(in crate::lower) counted_places: Option<CountedPlaces>,
    pub(in crate::lower) quoted_texts: QuotedTexts,
    pub(in crate::lower) written_path: Vec<u8>,
    pub(in crate::lower) known_helpers_lowered: KnownHelpersLowered,
    scratch: BuilderScratch,
}

fn analyze_scopes_of_file(
    inputs: &LoweringInputs<'_>,
    files: &Files<'_>,
    file: FileId,
    fields_under_signed_members: &[MemberId],
    holds_registry: &dyn Fn(SymbolId) -> bool,
) -> ScopeAnalysis {
    let module = files.module(file);
    let file_inputs = inputs.files[file.idx()].expect("every lowered file has its inputs");
    analyze_scopes(&ScopeInput {
        file,
        hir: &module.hir,
        bound: &module.bound,
        compiled: module.compiled.expect("only compiled files are lowered"),
        modules: inputs.modules,
        builtins: file_inputs.builtins,
        fields_under_signed_members,
        holds_registry,
        max_captures: inputs.limits.get(LimitId::MaxCaptures) as usize,
        names_lie_on_object_prototype: inputs.names_lie_on_object_prototype(),
    })
}

impl<'a, 'c, 'p, 's> FileLowering<'a, 'c, 'p, 's> {
    pub(super) fn new(
        inputs: &'a LoweringInputs<'a>,
        queries: &'a mut Queries<'c, 'p, 's>,
        file: FileId,
        task: &'a mut TaskState,
    ) -> FileLowering<'a, 'c, 'p, 's> {
        let hir = queries.hir();
        let bound = queries.bound();
        let compiled = queries.files().compiled(file);
        let compiled = compiled.expect("only compiled files are lowered");
        let file_inputs = inputs.files[file.idx()].expect("every lowered file has its inputs");
        let path = inputs.sources.diagnostic_path(file);
        let is_counted =
            inputs.options.counts_executions && inputs.sources.is_in_coverage_report(file);
        let known_member_values = KnownMemberValues::default();
        let members = KnownObjects::new(queries.files(), inputs.modules, &known_member_values);
        let fields_under_signed_members = find_fields_under_signed_members(members, file);
        let counted_places = is_counted
            .then(|| CountedPlaces::find(hir, bound, compiled, &fields_under_signed_members, path));
        let may_hold_registries = inputs.makes_registries || file_inputs.makes_registries();
        let files = queries.files();
        let registries = RegistryNames::new(&mut *queries);
        let holds_registry = |symbol: SymbolId| may_hold_registries && registries.holds(symbol);
        let scopes = analyze_scopes_of_file(
            inputs,
            files,
            file,
            &fields_under_signed_members,
            &holds_registry,
        );
        let removable = Removable::of_file(
            queries.files(),
            file,
            &compiled.analysis,
            file_inputs.builtins,
            inputs.options.removable,
        );
        task.begin_file_of(file_inputs.source == SourceKind::Program);
        let fragment = FragmentBuilder::new(file, task);
        task.layout_places.begin_file();
        task.function_places.begin_file();
        let layouts = LayoutState::new(take(&mut task.layout_places));
        let functions = FunctionTable::new(take(&mut task.function_places));
        FileLowering {
            inputs,
            file,
            role: queries.role(file),
            source: file_inputs.source,
            hir,
            bound,
            compiled,
            values_written_in_place: RefCell::default(),
            enums_written_as_code: Vec::new(),
            builtins: file_inputs.builtins,
            simplified_expressions: match is_counted {
                true => Vec::new(),
                false => removable.find_simplified_expressions(),
            },
            invalid_regexp_literals_left_out: Vec::new(),
            queries,
            task,
            fragment,
            diagnostics: DiagnosticBuffer::default(),
            scopes,
            types: TypeState::default(),
            layouts,
            classes: ClassState::new(fields_under_signed_members),
            modules: ModuleState::default(),
            functions,
            levels_of_literals_inside_built_ones: FxHashMap::default(),
            literals_named_as_prototype_objects: OnceCell::new(),
            shown_names: ShownNames::new(inputs.options, file_inputs.source, hir, bound),
            enum_member_reads: FxHashMap::default(),
            enums_that_stay_as_born: None,
            counted_places,
            quoted_texts: QuotedTexts::default(),
            written_path: Vec::new(),
            known_helpers_lowered: KnownHelpersLowered::default(),
            scratch: BuilderScratch::default(),
        }
    }

    pub(super) fn refuse_invalid_regexp_literals(&mut self) {
        if self.inputs.sources.kind(self.file) != load::SourceKind::Program {
            return;
        }
        let decisions = self.decisions();
        let mut invalid: Vec<(ExprId, Vec<u8>)> = Vec::new();
        for (index, expression) in self.hir.exprs.iter().enumerate() {
            let ExprKind::Regex { pattern, flags } = expression.kind else {
                continue;
            };
            let literal = ExprId(index as u32);
            if decisions.is_dead_expr(literal) {
                continue;
            }
            let pattern = regexp_pattern_as_printed(self.queries.atom_bytes(pattern));
            let flags = self.queries.atom_bytes(flags);
            if let Some(sentence) = describe_regexp_syntax_error(&pattern, flags) {
                invalid.push((literal, sentence));
            }
        }
        if invalid.is_empty() {
            return;
        }
        let left_out = Removable::of_file(
            self.queries.files(),
            self.file,
            &self.compiled.analysis,
            self.builtins,
            self.inputs.options.removable,
        )
        .find_regexp_literals_left_out();
        for (literal, sentence) in invalid {
            if left_out.binary_search(&literal).is_ok() {
                self.invalid_regexp_literals_left_out.push(literal);
            } else {
                let span = self.span_of(NodeData::Expr(literal));
                self.diagnostics
                    .report(Code::InvalidRegExp, span, &[&sentence]);
            }
        }
    }

    pub(super) fn is_invalid_regexp_literal_left_out(&self, literal: ExprId) -> bool {
        self.invalid_regexp_literals_left_out
            .binary_search(&literal)
            .is_ok()
    }

    pub(super) fn lies_in_package(&self) -> bool {
        load::is_in_node_modules(self.queries.files().module(self.file).file_name())
    }

    pub(super) fn finish(mut self, module: ModuleFragment) -> LoweredFile {
        self.fragment.is_checked = self.is_checked();
        let queries = self.queries.statistics();
        let FileLowering {
            task,
            fragment,
            diagnostics,
            layouts,
            functions,
            known_helpers_lowered,
            shown_names,
            ..
        } = self;
        task.layout_places = layouts.into_places();
        task.function_places = functions.into_places();
        LoweredFile {
            fragment: fragment.finish(module, task),
            diagnostics,
            queries,
            known_helpers: known_helpers_lowered,
            written_function_names: shown_names.written_function_names,
        }
    }

    pub(super) fn abandon(self) {
        let FileLowering {
            task,
            fragment,
            layouts,
            functions,
            ..
        } = self;
        task.layout_places = layouts.into_places();
        task.function_places = functions.into_places();
        fragment.abandon(task);
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

    #[inline]
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

    #[inline]
    pub(crate) fn is_checked(&self) -> bool {
        match self.role {
            FileRole::Checked => true,
            FileRole::Inferred | FileRole::TypesOnly => false,
        }
    }

    pub(crate) fn intern_bytes(&mut self, bytes: &[u8]) -> StringId {
        self.fragment.strings.intern(bytes)
    }

    pub(crate) fn intern_atom(&mut self, atom: Atom) -> StringId {
        debug_assert!(atom != Atom::NONE, "a name was expected");
        if let Some(&id) = self.task.atoms.get(&atom) {
            return id;
        }
        let id = self.fragment.strings.intern(self.queries.atom_bytes(atom));
        self.task.atoms.insert(atom, id);
        self.fragment.note_atom_first_met(atom);
        id
    }

    pub(crate) fn intern_binding_name(&mut self, binding: Binding, written: Atom) -> StringId {
        match self.short_binding_name(binding) {
            Some(name) => name,
            None => self.intern_written_name(written),
        }
    }

    pub(crate) fn intern_written_name(&mut self, name: Atom) -> StringId {
        let bytes = self.queries.atom_bytes(name);
        match written_name_of_local(bytes) {
            same if same.len() == bytes.len() => self.intern_atom(name),
            written => self.intern_bytes(written),
        }
    }

    pub(crate) fn text_key(&mut self, text: StringId) -> PropertyKeyId {
        self.fragment
            .property_keys
            .intern(PropertyKey::from_text(text))
    }

    pub(crate) fn atom_key(&mut self, atom: Atom) -> PropertyKeyId {
        if let Some(&key) = self.task.atom_keys.get(&atom) {
            return key;
        }
        let text = self.intern_atom(atom);
        let key = self.text_key(text);
        self.task.atom_keys.insert(atom, key);
        self.fragment.note_atom_first_met(atom);
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
}
