#[cfg(test)]
mod tests;

use super::entries::build_entries;
use super::merged_keys::MergedKeys;
use super::module_table::find_unit;
use super::numbering::Numbering;
use super::program_keys::{ProgramFunctionKey, ProgramModule, ProgramVariableKey};
use super::state::{Definitions, ExportWriter, ModuleRecords, ModuleTable, VariableDefinition};
use super::unit::LinkUnit;
use super::{LinkProject, key_context};
use crate::builtins::{RuntimeModule, table};
use crate::ir::generated::{
    self, ModuleExportKind, ModuleFlags, RuntimeFunctionEntry, WebAssemblyModule,
};
use crate::ir::parallel::{extend_from_lists, map_each};
use crate::ir::{
    DataId, FunctionId, Id, IdMap, InParallel, ModuleId, StringId, StringTable, VariableId,
    VariableKey, for_each_mut,
};
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProgramFile, ProjectId, SourceKind};
use crate::module_keys::type_attribute_of;
use crate::modules::{
    self, ExportBinding, ExportLookup, ImportBinding, Interop, ModuleFailureKind, ModuleGraph,
    ModuleKind, ModuleRef, Shape, Spelling, SyntheticExportRule, compare_code_units,
};
use bun_ast::Loader;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::program::FileId;
use bun_sema::resolve::ExternalKind;
use bun_sema::util::SharedSort;
use core::ops::Range;
use rustc_hash::FxHashMap;

pub(super) struct RecordInput<'a, 's> {
    pub projects: &'a PerProject<LinkProject<'a, 's>>,
    pub atoms: &'a Interner<'s>,
    pub modules: &'a ModuleTable,
    pub functions: &'a MergedKeys<'a, ProgramFunctionKey>,
    pub variables: &'a MergedKeys<'a, ProgramVariableKey>,
    pub definitions: &'a Definitions,
    pub numbering: &'a Numbering,
    pub in_parallel: InParallel<'a>,
}

impl RecordInput<'_, '_> {
    fn find_id(&self, module: ProgramModule) -> Option<ModuleId> {
        let index = self.modules.index_by_module.get(&module);
        index.and_then(|&index| self.numbering.modules[index as usize])
    }

    fn id_of(&self, project: ProjectId, module: ModuleRef) -> ModuleId {
        let module = key_context(self.projects, project).module(module);
        match self.find_id(module) {
            Some(id) => id,
            None => panic!("a record names a module that has none: {module:?}"),
        }
    }

    fn exported_variable(&self, project: ProjectId, key: VariableKey) -> VariableId {
        let key = key_context(self.projects, project).variable_key(key);
        let merged = self.variables.find(&key);
        match merged.and_then(|merged| self.numbering.variables[merged as usize]) {
            Some(id) => id,
            None => panic!("the variable of an export that is read has no id: {key:?}"),
        }
    }

    fn body_of(&self, module: ProgramModule) -> FunctionId {
        let key = module
            .body_key()
            .expect("the fragment names the body of a file");
        let merged = self.functions.find(&key);
        match merged.and_then(|merged| self.numbering.functions[merged as usize]) {
            Some(id) => id,
            None => panic!("the body of a record has no id: {key:?}"),
        }
    }

    fn exports_variable(&self, module: ProgramModule) -> Option<VariableId> {
        let key = module.exports_variable_key()?;
        let (project, own) = module.in_own_project()?;
        if !holds_exports_in_variable(self.projects.get(project).graph, own) {
            return None;
        }
        self.numbering.variables[self.variables.find(&key)? as usize]
    }
}

pub(super) fn exported_variable_key(
    graph: &ModuleGraph,
    binding: ExportBinding,
) -> Option<VariableKey> {
    match binding {
        ExportBinding::Variable(symbol) => Some(VariableKey::Symbol(symbol)),
        ExportBinding::Synthetic(_) if graph.lazy_export(binding).is_some() => None,
        ExportBinding::Synthetic(id) => {
            let export = graph.synthetic_export(id);
            // An ES module holds a copy of a name of a CommonJS file, unless nobody can tell the copy from the variable.
            let is_copy =
                graph.face(export.module).is_some() && !graph.settled(export.module, export.name);
            Some(match is_copy {
                true => VariableKey::Copy(id),
                false => VariableKey::SyntheticExport(id),
            })
        }
        ExportBinding::Namespace { .. } | ExportBinding::Indirect { .. } => None,
    }
}

pub(super) fn holds_exports_in_variable(graph: &ModuleGraph, module: ModuleRef) -> bool {
    match graph.shape(module) {
        Shape::Value => true,
        // The face has the loader capture what the file exports.
        Shape::AsToday => match module {
            ModuleRef::File(file) => graph.commonjs().face_captures(file),
            _ => false,
        },
        Shape::EsModule | Shape::Names => false,
    }
}

/// The loader takes the names from the object that the CommonJS file exports, as it does for a module of the library.
pub(super) fn is_filled_by_loader(graph: &ModuleGraph, face: ModuleRef) -> bool {
    !matches!(graph.interop(face).export_rule, SyntheticExportRule::None)
}

// A name of an ES module of the other project is bound here, where both export tables are at hand.
fn find_binding_in_other_project(
    projects: &PerProject<LinkProject<'_, '_>>,
    atoms: &Interner<'_>,
    project: ProjectId,
    binding: ExportBinding,
) -> Option<(ProjectId, ExportBinding)> {
    let ExportBinding::Indirect { module, name } = binding else {
        return Some((project, binding));
    };
    let ProgramModule::File(target) = key_context(projects, project).module(module) else {
        return Some((project, binding));
    };
    let graph = projects.get(target.project).graph;
    match graph.find_export(ModuleRef::File(target.file), name, atoms) {
        ExportLookup::Found(found) => Some((target.project, found)),
        // The run looks behind the stars of a file of the same project.
        ExportLookup::Unknown if matches!(module, ModuleRef::File(_)) => Some((project, binding)),
        ExportLookup::Unknown | ExportLookup::Absent => None,
    }
}

// What the table of a record binds an export to, and the project whose graph knows the binding.
fn find_listed_binding(
    projects: &PerProject<LinkProject<'_, '_>>,
    atoms: &Interner<'_>,
    project: ProjectId,
    binding: ExportBinding,
) -> Option<(ProjectId, ExportBinding)> {
    let (project, binding) = find_binding_in_other_project(projects, atoms, project, binding)?;
    let binding = match projects.get(project).graph.lazy_export(binding) {
        Some((module, name)) => ExportBinding::Indirect { module, name },
        None => binding,
    };
    Some((project, binding))
}

/// The variables that link defines and that an export table names. The object of the module reads them, so each needs an id, whether or not code names it.
pub(super) fn variables_shown_by_export_tables(
    projects: &PerProject<LinkProject<'_, '_>>,
    atoms: &Interner<'_>,
    modules: &ModuleTable,
) -> Vec<ProgramVariableKey> {
    let mut keys = Vec::new();
    for &module in &modules.modules {
        let (project, exports) = match module {
            ProgramModule::File(file) => {
                let graph = projects.get(file.project).graph;
                let has_table = graph.interop(ModuleRef::File(file.file)).has_export_table();
                match has_table && !graph.is_library(file.file) {
                    true => (file.project, graph.exports(file.file)),
                    false => continue,
                }
            }
            ProgramModule::Face(file) => {
                let graph = projects.get(file.project).graph;
                let face = ModuleRef::Face(file.file);
                match is_filled_by_loader(graph, face) {
                    true => continue,
                    false => (file.project, graph.exports_of(face)),
                }
            }
            ProgramModule::Inner { .. }
            | ProgramModule::Check(_)
            | ProgramModule::Runtime(_)
            | ProgramModule::External { .. } => continue,
        };
        for export in exports.iter().filter(|export| export.is_read_from_object) {
            let listed = find_listed_binding(projects, atoms, project, export.binding);
            let Some((project, binding @ ExportBinding::Synthetic(_))) = listed else {
                continue;
            };
            let context = key_context(projects, project);
            if let Some(key) = exported_variable_key(context.graph, binding) {
                keys.push(context.variable_key(key));
            }
        }
    }
    keys
}

// This cuts the work into tasks. No answer depends on it.
const MODULES_IN_A_TASK: u32 = if cfg!(test) { 2 } else { 64 };

/// The records of modules that follow each other. The strings that they name are numbers of `strings`.
struct BuiltRecords {
    /// Of the first record.
    first_id: Option<ModuleId>,
    modules: Vec<generated::Module>,
    /// The place of a record among `modules`, and the unit that holds the positions of its file.
    units_with_positions: Vec<(u32, u32)>,
    ambiguous_exports: Vec<generated::AmbiguousExport>,
    strings: StringTable,
}

fn list_ids_as_they_are<I: Id>(count: usize) -> Vec<Option<I>> {
    (0..count).map(|index| Some(I::new(index))).collect()
}

// What a record holds depends on no other record, but for the numbers of the strings that no file has spelled.
// The third result: `ModuleRecords::units_with_positions`.
fn build_records_of_modules(
    units: &[LinkUnit],
    input: &RecordInput<'_, '_>,
    synthetic_exports: &[Vec<MergedSyntheticExport>],
    is_named_at_run_time: &[bool],
    strings: &mut StringTable,
) -> (
    Vec<generated::Module>,
    Vec<generated::AmbiguousExport>,
    Vec<(u32, u32)>,
) {
    let module_count = input.modules.modules.len() as u32;
    let starts = (0..module_count).step_by(MODULES_IN_A_TASK as usize);
    let tasks: Vec<Range<u32>> = starts
        .map(|start| start..module_count.min(start + MODULES_IN_A_TASK))
        .collect();
    let mut built = map_each(tasks, input.in_parallel, &|indexes: Range<u32>| {
        let mut strings = StringTable::default();
        let mut builder = RecordBuilder {
            input,
            strings: &mut strings,
            names: FxHashMap::default(),
            synthetic_exports,
            is_named_at_run_time,
            units_with_positions: Vec::new(),
            ambiguous_exports: Vec::new(),
        };
        let (first_id, modules) = builder.build_modules(units, indexes);
        let RecordBuilder {
            units_with_positions,
            ambiguous_exports,
            ..
        } = builder;
        BuiltRecords {
            first_id,
            modules,
            units_with_positions,
            ambiguous_exports,
            strings,
        }
    });

    // Some file spells most of these strings, so the program has them, and to look for them changes nothing.
    let known_strings = &*strings;
    let tables: Vec<&StringTable> = built.iter().map(|records| &records.strings).collect();
    let mut program_ids: Vec<Vec<Option<StringId>>> =
        map_each(tables, input.in_parallel, &|table: &StringTable| {
            let ids = table.ids();
            ids.map(|id| known_strings.find_string_of(table, id))
                .collect()
        });
    // Any other gets its number where the first record names it, as if one thread had built the records in their order.
    for (records, program_ids) in built.iter().zip(&mut program_ids) {
        for (id, program_id) in records.strings.ids().zip(program_ids) {
            if program_id.is_none() {
                *program_id = Some(strings.intern_string_of(&records.strings, id));
            }
        }
    }
    let counts = &input.numbering.counts;
    let modules: Vec<Option<ModuleId>> = list_ids_as_they_are(counts.modules);
    let functions: Vec<Option<FunctionId>> = list_ids_as_they_are(counts.functions);
    let variables: Vec<Option<VariableId>> = list_ids_as_they_are(counts.variables);
    let data: Vec<Option<DataId>> = list_ids_as_they_are(counts.data);
    let mut tasks: Vec<(&mut BuiltRecords, Vec<Option<StringId>>)> =
        built.iter_mut().zip(program_ids).collect();
    for_each_mut(&mut tasks, input.in_parallel, &|(records, strings)| {
        // All but the strings are ids of the program already.
        let map = IdMap {
            strings,
            property_keys: &[],
            types: &[],
            type_sites: &[],
            expected_results: &[],
            layouts: &[],
            variables: &variables,
            modules: &modules,
            module_failures: &[],
            eval_scopes: &[],
            functions: &functions,
            data: &data,
        };
        for module in &mut records.modules {
            module.remap_ids(&map);
        }
        for ambiguous in &mut records.ambiguous_exports {
            ambiguous.remap_ids(&map);
        }
    });
    drop(tasks);

    let mut record_count = 0;
    let mut lists = Vec::with_capacity(built.len());
    let mut ambiguous_exports = Vec::new();
    let mut units_with_positions = Vec::new();
    for records in built {
        assert!(
            records
                .first_id
                .is_none_or(|first| first.index() == record_count),
            "the records of the modules stand in the order of their ids"
        );
        let first = record_count as u32;
        let with_positions = records.units_with_positions.into_iter();
        units_with_positions.extend(with_positions.map(|(place, unit)| (first + place, unit)));
        record_count += records.modules.len();
        lists.push(records.modules);
        ambiguous_exports.extend(records.ambiguous_exports);
    }
    let mut records = Vec::new();
    extend_from_lists(&mut records, lists, input.in_parallel);
    (records, ambiguous_exports, units_with_positions)
}

impl ModuleRecords {
    /// The positions of a file are long lists, and its unit has read them for the last time.
    pub(super) fn take_positions_from(&mut self, units: &mut [LinkUnit]) {
        for (module, unit) in core::mem::take(&mut self.units_with_positions) {
            let fragment = &mut units[unit as usize].module;
            self.modules[module as usize].positions = core::mem::take(&mut fragment.positions);
        }
    }
}

/// The units are only read, so that whoever else reads them runs beside this. `ModuleRecords::take_positions_from` finishes the records.
pub(super) fn build_module_records(
    units: &[LinkUnit],
    input: &RecordInput<'_, '_>,
    strings: &mut StringTable,
) -> ModuleRecords {
    let synthetic_exports = collect_synthetic_exports(input);
    let is_named_at_run_time = find_modules_named_at_run_time(input);
    let (modules, ambiguous_exports, units_with_positions) = build_records_of_modules(
        units,
        input,
        &synthetic_exports,
        &is_named_at_run_time,
        strings,
    );
    let mut builder = RecordBuilder {
        input,
        strings: &mut *strings,
        names: FxHashMap::default(),
        synthetic_exports: &synthetic_exports,
        is_named_at_run_time: &is_named_at_run_time,
        units_with_positions: Vec::new(),
        ambiguous_exports: Vec::new(),
    };
    let module_failures = builder.build_failures();
    ModuleRecords {
        modules,
        units_with_positions,
        module_failures,
        ambiguous_exports,
        entries: build_entries(input, strings),
        runtime_functions: collect_runtime_functions(units, input),
        web_assembly_modules: collect_web_assembly_modules(input),
    }
}

#[derive(Copy, Clone)]
struct MergedSyntheticExport {
    name: Atom,
    merged_variable: u32,
    is_known_member: bool,
    is_replaceable: bool,
}

fn collect_synthetic_exports(input: &RecordInput<'_, '_>) -> Vec<Vec<MergedSyntheticExport>> {
    let mut exports = vec![Vec::new(); input.modules.modules.len()];
    for (merged_variable, definition) in input.definitions.variables.iter().enumerate() {
        match *definition {
            Some(VariableDefinition::SyntheticExport {
                module,
                name,
                is_known_member,
                is_replaceable,
                writer: ExportWriter::Loader | ExportWriter::Face | ExportWriter::Capture,
            }) => exports[module as usize].push(MergedSyntheticExport {
                name,
                merged_variable: merged_variable as u32,
                is_known_member,
                is_replaceable,
            }),
            Some(
                VariableDefinition::SyntheticExport {
                    writer: ExportWriter::Body,
                    ..
                }
                | VariableDefinition::MockOfRuntimeModule { .. }
                | VariableDefinition::Unit(_),
            )
            | None => {}
        }
    }
    let atoms = input.atoms;
    for module_exports in &mut exports {
        module_exports.shared_sort_unstable_by(|a, b| {
            compare_code_units(atoms.bytes(a.name), atoms.bytes(b.name))
        });
    }
    exports
}

fn find_modules_named_at_run_time(input: &RecordInput<'_, '_>) -> Vec<bool> {
    let mut is_named_at_run_time = vec![false; input.modules.modules.len()];
    for (project, linked) in input.projects.iter() {
        let named = linked.sources.modules_named_at_run_time().iter();
        for file in named.filter_map(|&module| linked.sources.runtime_module_file(module)) {
            let module = ProgramModule::File(ProgramFile { project, file });
            if let Some(&index) = input.modules.index_by_module.get(&module) {
                is_named_at_run_time[index as usize] = true;
            }
        }
    }
    is_named_at_run_time
}

struct RecordBuilder<'b, 'a, 's> {
    input: &'b RecordInput<'a, 's>,
    strings: &'b mut StringTable,
    names: FxHashMap<Atom, StringId>,
    synthetic_exports: &'b [Vec<MergedSyntheticExport>],
    is_named_at_run_time: &'b [bool],
    /// `BuiltRecords::units_with_positions`
    units_with_positions: Vec<(u32, u32)>,
    ambiguous_exports: Vec<generated::AmbiguousExport>,
}

fn mock_may_answer_ahead_of_declaration(
    graph: &modules::ModuleGraph,
    atoms: &Interner<'_>,
    file: FileId,
    asked: (Atom, FileId),
    path: &mut Vec<FileId>,
) -> bool {
    let (name, declaring_file) = asked;
    if path.contains(&file) {
        return false;
    }
    path.push(file);
    // The run follows some stars of a file and not others: `export * from "./over-commonjs.js"; export * from "./lib.js"`. A name that comes by a star which it
    // does not follow is found in the table alone.
    let followed = graph.requests(file).iter();
    let mut followed = followed.filter(|request| request.is_dynamic_star_export);
    let is_found_by_run = followed.any(|request| {
        request.target == ModuleRef::File(declaring_file)
            || graph.lists_export(request.target, name, atoms)
    });
    let mut answer = false;
    for request in graph.requests(file) {
        if !is_found_by_run {
            break;
        }
        let ModuleRef::File(target) = request.target else {
            if request.is_dynamic_star_export && graph.is_named_by_mock(request.target) {
                answer = true;
                break;
            }
            continue;
        };
        // The mock of the file that declares the name answers for the variable wherever it is handed on.
        if target == declaring_file {
            break;
        }
        let has_name = || graph.lists_export(request.target, name, atoms);
        // The stars count in the order of the text, whoever follows them: what a star that the build has settled brings comes ahead of the stars behind it.
        if !request.is_dynamic_star_export {
            if has_name() {
                break;
            }
            continue;
        }
        // `export * from "./b.js"` in a.js, `export * from "./a.js"` in b.js: the stars lead back to a file on the way, whose mock stands in place of all of this.
        if path.contains(&target) {
            continue;
        }
        if graph.is_named_by_mock(request.target)
            || mock_may_answer_ahead_of_declaration(graph, atoms, target, asked, path)
        {
            answer = true;
            break;
        }
        if has_name() {
            break;
        }
    }
    path.pop();
    answer
}

impl RecordBuilder<'_, '_, '_> {
    fn intern_atom(&mut self, atom: Atom) -> StringId {
        let (atoms, strings) = (self.input.atoms, &mut *self.strings);
        *self
            .names
            .entry(atom)
            .or_insert_with(|| strings.intern(atoms.bytes(atom)))
    }

    /// The records of the modules at `indexes` of the table, and the id of the first.
    fn build_modules(
        &mut self,
        units: &[LinkUnit],
        indexes: Range<u32>,
    ) -> (Option<ModuleId>, Vec<generated::Module>) {
        let input = self.input;
        let mut first_id = None;
        let mut records = Vec::with_capacity(indexes.len());
        for index in indexes {
            let module = input.modules.modules[index as usize];
            let Some(id) = input.numbering.modules[index as usize] else {
                continue;
            };
            assert_eq!(
                id.index(),
                first_id.get_or_insert(id).index() + records.len(),
                "the records of the modules stand in the order of their ids"
            );
            records.push(match module {
                ProgramModule::File(file) => {
                    let unit = find_unit(units, module);
                    if let Some(unit) = unit {
                        let place = records.len() as u32;
                        self.units_with_positions.push((place, unit));
                    }
                    self.build_file_record(units, unit, index, file)
                }
                ProgramModule::Inner { file, .. }
                | ProgramModule::Face(file)
                | ProgramModule::Check(file) => self.build_further_record(index, module, file),
                ProgramModule::Runtime(runtime_module) => {
                    let path = self.strings.intern(table::specifier_of(runtime_module));
                    let mut record = create_record(Interop::RUNTIME, path, path);
                    record.runtime_module = Some(runtime_module);
                    record.other_names = self.other_names_of(Some(runtime_module));
                    record.synthetic_exports = self.build_synthetic_exports(index);
                    record.flags |= self.flags_of_runtime_module(Some(runtime_module));
                    record
                }
                ProgramModule::External {
                    importer,
                    specifier,
                    type_attribute,
                } => self.build_external_record(index, importer, specifier, type_attribute),
            });
        }
        (first_id, records)
    }

    fn build_external_record(
        &mut self,
        index: u32,
        importer: ProgramFile,
        specifier: Atom,
        type_attribute: Option<Loader>,
    ) -> generated::Module {
        let graph = self.input.projects.get(importer.project).graph;
        let own = ModuleRef::External {
            importer: importer.file,
            specifier,
            type_attribute,
        };
        let kind = graph.external_kind(own);
        let kind = kind.unwrap_or(ExternalKind::UncompiledCode);
        let path = self.intern_atom(specifier);
        let mut record = create_record(Interop::of_external(kind), path, path);
        let referrer = ModuleRef::File(importer.file);
        record.referrer = Some(self.input.id_of(importer.project, referrer));
        match kind {
            ExternalKind::UncompiledCode => {
                record.external_kind = generated::ExternalKind::UncompiledCode;
                if graph.is_imported_as_namespace(own) {
                    record.flags |= ModuleFlags::IS_IMPORTED_AS_NAMESPACE;
                }
                record.type_attribute =
                    type_attribute.map(|it| self.strings.intern(type_attribute_of(it).as_bytes()));
            }
            ExternalKind::HostValue => {
                record.external_kind = generated::ExternalKind::HostValue;
                record.synthetic_exports = self.build_synthetic_exports(index);
            }
        }
        record
    }

    /// `unit`: that of the file. The positions of the file stay there.
    fn build_file_record(
        &mut self,
        units: &[LinkUnit],
        unit: Option<u32>,
        index: u32,
        file: ProgramFile,
    ) -> generated::Module {
        let input = self.input;
        let LinkProject { graph, sources, .. } = *input.projects.get(file.project);
        let paths = sources.module_paths(file.file);
        let path = self.strings.intern(paths.public_path);
        let display_path = self.strings.intern(paths.display_path);
        let interop = graph.interop(ModuleRef::File(file.file));
        let mut record = create_record(interop, path, display_path);
        assert!(
            unit.is_some() || !graph.is_code_of_program(ModuleRef::File(file.file)),
            "a file of the program has a record and was not lowered: {file:?}"
        );
        let Some(unit) = unit.filter(|_| !graph.is_library(file.file)) else {
            let is_declaration_file_of_application = matches!(file.project, ProjectId::Application)
                && matches!(sources.kind(file.file), SourceKind::TypesOnly);
            if !is_declaration_file_of_application {
                record.flags = ModuleFlags::IS_LIBRARY;
            }
            return record;
        };

        if graph.has_no_side_effects(file.file) {
            record.flags |= ModuleFlags::HAS_NO_SIDE_EFFECTS;
        }
        if is_bundler_helper(sources.kind(file.file), interop.kind) {
            record.flags |= ModuleFlags::IS_BUNDLER_HELPER;
        }
        let unit = &units[unit as usize];
        let fragment = &unit.module;
        let ids = &input.numbering.tables[unit.tables as usize];
        record.body = find_program_id(fragment.body, &ids.functions);
        // What a CommonJS file requires is loaded by its body, and the body of such a unit only throws.
        if fragment.throws_at_load && interop.has_export_table() {
            record.flags |= ModuleFlags::THROWS_AT_LOAD;
        }
        match interop.kind {
            ModuleKind::SourceText => {
                record.flags |= self.planned_flags(file.project, ModuleRef::File(file.file));
                record.data = find_program_id(fragment.data, &ids.data);
                self.fill_export_table_record(file, &mut record);
            }
            ModuleKind::Data => {
                if graph.may_be_mocked(ModuleRef::File(file.file)) {
                    record.flags |= ModuleFlags::MAY_BE_MOCKED;
                }
                // Taken out of `require.cache`, the file is read again by the loader of the host.
                if graph.may_be_evicted(ModuleRef::File(file.file)) {
                    record.flags |= ModuleFlags::MAY_BE_EVICTED;
                }
                if graph.is_found_by_name(ModuleRef::File(file.file))
                    || graph.is_named_by_copies(ModuleRef::File(file.file))
                {
                    record.flags |= ModuleFlags::IS_FOUND_BY_NAME;
                }
                if interop.answers_loader_with_namespace {
                    record.flags |= ModuleFlags::ANSWERS_LOADER_WITH_NAMESPACE;
                }
                record.data = find_program_id(fragment.data, &ids.data);
                self.fill_export_table_record(file, &mut record);
            }
            // The body stores the names that somebody reads, so the loader has nothing to fill.
            ModuleKind::CommonJs => {
                let own = ModuleRef::File(file.file);
                record.flags |= self.planned_flags(file.project, own);
                record.requests = self.build_requests(file.project, own);
                record.exports_variable = input.exports_variable(ProgramModule::File(file));
            }
            ModuleKind::RuntimeSource => {
                record.runtime_module = graph.runtime_module(file.file);
                record.other_names = self.other_names_of(record.runtime_module);
                record.flags |= self.flags_of_runtime_module(record.runtime_module);
                record.synthetic_exports = self.build_synthetic_exports(index);
                let application = input.projects.get(ProjectId::Application).graph;
                // Native code asks for a module by its number. Only a name that the build does not know is looked up among the modules.
                let is_named_to_test_runner = (record.runtime_module)
                    .is_some_and(|module| application.is_named_to_test_runner(module));
                if !self.is_named_at_run_time[index as usize] && !is_named_to_test_runner {
                    record.flags |= ModuleFlags::IS_LOADED_BY_IMPORT_ONLY;
                }
            }
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a file is never a Runtime or External module")
            }
        }
        record
    }

    // A record that a file has beside its own: an inner module, the face, the check.
    fn build_further_record(
        &mut self,
        index: u32,
        module: ProgramModule,
        file: ProgramFile,
    ) -> generated::Module {
        let input = self.input;
        let LinkProject { graph, sources, .. } = *input.projects.get(file.project);
        let (project, own) = module
            .in_own_project()
            .expect("the record belongs to a file");
        let id = input.numbering.modules[index as usize].expect("every module has an id");
        let path = self.strings.intern(format!("#{}", id.index()).as_bytes());
        let display_path = self
            .strings
            .intern(sources.module_paths(file.file).display_path);
        let interop = graph.interop(own);
        let mut record = create_record(interop, path, display_path);
        record.flags = self.planned_flags(project, own);
        if is_bundler_helper(sources.kind(file.file), interop.kind) {
            record.flags |= ModuleFlags::IS_BUNDLER_HELPER;
        }
        record.body = Some(input.body_of(module));
        record.requests = self.build_requests(project, own);
        record.exports_variable = input.exports_variable(module);
        match module {
            ProgramModule::Face(_) if is_filled_by_loader(graph, own) => {
                record.synthetic_exports = self.build_synthetic_exports(index);
            }
            ProgramModule::Face(_) => {
                record.exports = self.build_exports(project, graph.exports_of(own));
            }
            ProgramModule::Inner { .. } | ProgramModule::Check(_) => {}
            ProgramModule::File(_) | ProgramModule::Runtime(_) | ProgramModule::External { .. } => {
                unreachable!("the record belongs to a file")
            }
        }
        record
    }

    // "sys" finds node:util. The engine knows the path of a module and not how else the resolver spells it.
    fn other_names_of(&mut self, module: Option<RuntimeModule>) -> Vec<StringId> {
        let Some(module) = module else {
            return Vec::new();
        };
        let path = table::specifier_of(module);
        let aliases = BUN_ALIASES.iter().copied().flatten();
        let names = aliases.filter(|(name, alias)| {
            *name != path
                && Some(*name) != table::name_without_node_prefix(module)
                && table::module_by_specifier(alias.path.as_bytes()) == Some(module)
        });
        names.map(|(name, _)| self.strings.intern(name)).collect()
    }

    // The application says what it does to a module of the library.
    fn flags_of_runtime_module(&self, module: Option<RuntimeModule>) -> ModuleFlags {
        let graph = self.input.projects.get(ProjectId::Application).graph;
        let mut flags = ModuleFlags::default();
        let Some(module) = module else {
            return flags;
        };
        if graph.may_be_mocked(ModuleRef::Runtime(module)) {
            flags |= ModuleFlags::MAY_BE_MOCKED;
        }
        if graph.is_held_under_name_without_prefix(module) {
            flags |= ModuleFlags::IS_HELD_UNDER_NAME_WITHOUT_PREFIX;
        }
        if graph.is_handed_out_by_test_runner(module) {
            flags |= ModuleFlags::IS_HANDED_OUT_BY_TEST_RUNNER;
        }
        flags
    }

    fn planned_flags(&self, project: ProjectId, module: ModuleRef) -> ModuleFlags {
        let graph = self.input.projects.get(project).graph;
        let mut flags = ModuleFlags::default();
        if graph.keeps_error(module) {
            flags |= ModuleFlags::KEEPS_ERROR;
        }
        if graph.is_loaded_by_loader(module) {
            flags |= ModuleFlags::IS_LOADED_BY_LOADER;
        }
        if graph.is_required_during_load(module) {
            flags |= ModuleFlags::IS_REQUIRED_DURING_LOAD;
        }
        if graph.may_be_imported_while_it_runs(module) {
            flags |= ModuleFlags::MAY_BE_IMPORTED_WHILE_IT_RUNS;
        }
        if graph.is_imported_as_namespace(module) {
            flags |= ModuleFlags::IS_IMPORTED_AS_NAMESPACE;
        }
        if graph.may_be_mocked(module) {
            flags |= ModuleFlags::MAY_BE_MOCKED;
        }
        // In a test run `require.cache` lists the files of the program that have run.
        if graph.runs_tests() && graph.is_code_of_program(module) {
            flags |= ModuleFlags::IS_LISTED_IN_CACHE;
            if graph.reaches_entries_of_cache() {
                flags |= ModuleFlags::IS_SHOWN_BY_ENTRY_OF_CACHE;
            }
        }
        if graph.may_be_evicted(module) && graph.is_code_of_program(module) {
            flags |= ModuleFlags::MAY_BE_EVICTED;
        }
        if graph.is_reached_by(module, Spelling::WithoutExtension) {
            flags |= ModuleFlags::IS_REACHED_WITHOUT_EXTENSION;
        }
        if graph.is_reached_by(module, Spelling::UnderAnotherExtension) {
            flags |= ModuleFlags::IS_REACHED_UNDER_ANOTHER_EXTENSION;
        }
        if graph.is_reached_by(module, Spelling::AsFolder) {
            flags |= ModuleFlags::IS_REACHED_AS_FOLDER;
        }
        if matches!(module, ModuleRef::File(file) if graph.runs_again(file)) {
            flags |= ModuleFlags::RUNS_AGAIN;
        }
        flags |= crate::test_runs::flags_of_module(graph, module);
        if graph.names_way_to_module_objects(module) {
            flags |= ModuleFlags::NAMES_WAY_TO_MODULE_OBJECTS;
        }
        // A copy from disk names the file to the loader of the host, which begins it where nothing has run it yet.
        let is_named_by_copies =
            graph.is_named_by_copies(module) && graph.is_code_of_program(module);
        if graph.is_found_by_name(module) || is_named_by_copies {
            flags |= ModuleFlags::IS_FOUND_BY_NAME;
        }
        flags
    }

    fn build_requests(
        &self,
        project: ProjectId,
        module: ModuleRef,
    ) -> Vec<generated::ModuleRequest> {
        let input = self.input;
        let requests = input.projects.get(project).graph.requests_of(module).iter();
        requests
            .map(|request| generated::ModuleRequest {
                target: input.id_of(project, request.target),
                phase: request.phase,
                is_dynamic_star_export: request.is_dynamic_star_export,
                kind: request.kind,
                completes: request.completes,
                is_hoisted: request.is_hoisted,
            })
            .collect()
    }

    fn build_exports(
        &mut self,
        project: ProjectId,
        exports: &[modules::ModuleExport],
    ) -> Vec<generated::ModuleExport> {
        exports
            .iter()
            .filter(|export| export.is_read_from_object)
            .filter_map(|export| self.build_export(project, export))
            .collect()
    }

    fn fill_export_table_record(&mut self, file: ProgramFile, record: &mut generated::Module) {
        let input = self.input;
        let ProgramFile { project, file } = file;
        let graph = input.projects.get(project).graph;
        if graph.has_top_level_await(file) {
            record.flags |= ModuleFlags::HAS_TOP_LEVEL_AWAIT;
        }
        record.requests = self.build_requests(project, ModuleRef::File(file));
        // Of several stars the first that has a name hands it on, and a mock that stands in place of a file has what its factory gave. A name that such a
        // file may answer for ahead of the file that declares it is in no table: the run follows the stars, in their order.
        let is_settled = |export: &&modules::ModuleExport| {
            let mut path = Vec::new();
            let ExportBinding::Variable(declared) = export.binding else {
                return true;
            };
            let asked = (export.name, declared.file);
            !export.is_from_star_export
                || !mock_may_answer_ahead_of_declaration(graph, input.atoms, file, asked, &mut path)
        };
        let exports: Vec<modules::ModuleExport> = graph
            .exports(file)
            .iter()
            .filter(is_settled)
            .copied()
            .collect();
        record.exports = self.build_exports(project, &exports);
        for &name in graph.ambiguous_names(file) {
            let ambiguous = generated::AmbiguousExport {
                module: input.id_of(project, ModuleRef::File(file)),
                name: self.intern_atom(name),
            };
            self.ambiguous_exports.push(ambiguous);
        }
        let requests = graph.requests_of(ModuleRef::File(file));
        let is_requested = |module: ModuleRef| requests.iter().any(|it| it.target == module);
        // ES modules import a CommonJS file through its face, which has the names of a mock.
        let exporter_of = |required: &modules::RequiredName| match required.is_found_unless_mocked {
            true => graph.face(required.module).unwrap_or(required.module),
            false => required.module,
        };
        // Tree shaking drops an unused import of a file without side effects, and the file may go with it.
        let may_be_gone = |required: &modules::RequiredName| {
            let rule = graph.interop(required.module).export_rule;
            required.is_found_unless_mocked && rule != generated::SyntheticExportRule::RuntimeModule
        };
        record.required_names = graph
            .required_names(file)
            .iter()
            .filter(|required| !may_be_gone(required) || is_requested(exporter_of(required)))
            .map(|required| generated::RequiredName {
                module: input.id_of(project, exporter_of(required)),
                name: self.intern_atom(required.name),
                may_be_absent: required.is_found_unless_mocked,
                export_name: (required.asked_by).map(|it| self.intern_atom(it.export_name)),
                specifier: (required.asked_by).map(|it| self.intern_atom(it.specifier)),
                drops_export_if_absent: required.drops_export_if_absent,
            })
            .collect();
        // The loader may be left with an empty record of such a file, which lacks even `default`. A link asks for what the module hands on before what it imports.
        let default_of = |export: modules::SyntheticExportId| {
            let export = graph.synthetic_export(export);
            (export.name == known::default).then_some(export.module)
        };
        let written = graph.exports(file).iter();
        let handed_on = written.filter(|export| !export.is_from_star_export);
        let handed_on = handed_on.filter_map(|export| match export.binding {
            ExportBinding::Synthetic(id) => Some((default_of(id)?, Some(export.name))),
            ExportBinding::Indirect { module, name } if name == known::default => {
                Some((module, Some(export.name)))
            }
            _ => None,
        });
        let imported = graph.import_bindings(file).iter();
        let imported = imported.filter_map(|&(_, binding)| match binding {
            ImportBinding::Synthetic(export) => Some((default_of(export)?, None)),
            ImportBinding::Exports { module } => Some((module, None)),
            _ => None,
        });
        let mut asked_for_default: Vec<(FileId, Option<Atom>)> = Vec::new();
        for (exporter, export_name) in handed_on.chain(imported) {
            if let ModuleRef::File(exporter) = exporter
                && (graph.may_be_imported_while_it_runs(ModuleRef::File(exporter))
                    || graph.may_be_mocked(ModuleRef::File(exporter)))
                && !asked_for_default.iter().any(|asked| asked.0 == exporter)
            {
                asked_for_default.push((exporter, export_name));
            }
        }
        let written = graph.requests(file);
        for (file, export_name) in asked_for_default {
            // The name comes through an export statement of another module, whose link fails first.
            let is_written = written.iter().any(|it| it.target == ModuleRef::File(file));
            let export_name = export_name.or_else(|| (!is_written).then_some(known::default));
            let exporter = graph.face(ModuleRef::File(file));
            let exporter = exporter.unwrap_or(ModuleRef::File(file));
            // Tree shaking drops an unused import of a file without side effects, and the file may go with it.
            if !is_requested(exporter) {
                continue;
            }
            let path = input.projects.get(project).sources.public_path(file);
            record.required_names.push(generated::RequiredName {
                module: input.id_of(project, exporter),
                name: self.intern_atom(known::default),
                may_be_absent: false,
                export_name: export_name.map(|name| self.intern_atom(name)),
                specifier: export_name.map(|_| self.strings.intern(path)),
                drops_export_if_absent: false,
            });
        }
    }

    fn build_export(
        &mut self,
        project: ProjectId,
        export: &modules::ModuleExport,
    ) -> Option<generated::ModuleExport> {
        let input = self.input;
        let (project, binding) =
            find_listed_binding(input.projects, input.atoms, project, export.binding)?;
        let unbound = generated::ModuleExport {
            name: self.intern_atom(export.name),
            is_from_star_export: export.is_from_star_export,
            ..generated::ModuleExport::default()
        };
        Some(match binding {
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {
                let key = exported_variable_key(input.projects.get(project).graph, binding);
                let key = key.expect("the binding is a variable");
                let commonjs = input.projects.get(project).graph.commonjs();
                let is_dropped_while_empty = match binding {
                    ExportBinding::Synthetic(copy) => commonjs.may_stay_empty(copy),
                    _ => false,
                };
                generated::ModuleExport {
                    kind: ModuleExportKind::Variable,
                    variable: Some(input.exported_variable(project, key)),
                    is_dropped_while_empty,
                    ..unbound
                }
            }
            ExportBinding::Namespace { module, phase } => generated::ModuleExport {
                kind: ModuleExportKind::Namespace,
                module: Some(input.id_of(project, module)),
                phase,
                ..unbound
            },
            ExportBinding::Indirect { module, name } => generated::ModuleExport {
                kind: ModuleExportKind::Indirect,
                module: Some(input.id_of(project, module)),
                import_name: Some(self.intern_atom(name)),
                ..unbound
            },
        })
    }

    // The loader fills what has a variable, and a variable without an id is one that nothing reads. Such a name is still listed where the test runner may
    // replace it: the run time refuses a spy on a name that is not listed, unless the whole module may be mocked.
    fn build_synthetic_exports(&mut self, index: u32) -> Vec<generated::SyntheticExport> {
        let exports_of_modules = self.synthetic_exports;
        let exports = &exports_of_modules[index as usize];
        let mut records = Vec::with_capacity(exports.len());
        for &export in exports {
            let variable = self.input.numbering.variables[export.merged_variable as usize];
            if variable.is_none() && !export.is_replaceable {
                continue;
            }
            records.push(generated::SyntheticExport {
                name: self.intern_atom(export.name),
                variable,
                is_known_member: export.is_known_member,
                is_replaceable: export.is_replaceable,
            });
        }
        records
    }

    fn build_failures(&mut self) -> Vec<generated::ModuleFailure> {
        let input = self.input;
        let mut records = Vec::new();
        for (project, linked) in input.projects.iter() {
            let ids = input.numbering.module_failures.get(project);
            for (failure, id) in linked.graph.failures().iter().zip(ids) {
                let Some(id) = id else {
                    continue;
                };
                assert_eq!(
                    id.index(),
                    records.len(),
                    "the records of the failures stand in the order of their ids"
                );
                records.push(self.build_failure(project, failure));
            }
        }
        // No code names these. Code outside the image that imports a module which cannot load is told what the load ends with.
        for (project, linked) in input.projects.iter() {
            let ids = input.numbering.module_failures.get(project);
            for file in linked.graph.unloadable_files() {
                let failure = linked.graph.load_failure(file);
                let id = failure.and_then(|failure| ids.get(failure.0 as usize).copied());
                let Some(id) = id.flatten() else {
                    continue;
                };
                let module = key_context(input.projects, project).module(ModuleRef::File(file));
                let Some(module) = input.find_id(module) else {
                    continue;
                };
                let failure = &records[id.index()];
                // The name of an export stands in the place of the specifier, and a copy would pass for an import statement that finds no module. The link of the module throws for the name.
                if failure.exporter.is_some() {
                    continue;
                }
                let (importer, specifier) = (failure.importer, failure.specifier);
                records.push(generated::ModuleFailure {
                    importer,
                    specifier,
                    exporter: None,
                    export_specifier: None,
                    ends_load_of: Some(module),
                });
            }
        }
        records
    }

    fn build_failure(
        &mut self,
        project: ProjectId,
        failure: &modules::ModuleFailure,
    ) -> generated::ModuleFailure {
        // Where a module lacks a name, the name stands in the place of the specifier.
        let mut export_specifier = None;
        let (specifier, exporter) = match failure.kind {
            ModuleFailureKind::NotAProgram { .. } => {
                let sources = self.input.projects.get(project).sources;
                let path = sources.module_paths(failure.importer).public_path;
                (self.strings.intern(path), None)
            }
            ModuleFailureKind::Unresolved { specifier, .. }
            | ModuleFailureKind::UnresolvedAtLoad { specifier, .. } => {
                (self.intern_atom(specifier), None)
            }
            ModuleFailureKind::ExportMayBeAbsent {
                exporter,
                name,
                asked_by,
            } => {
                // An export statement is quoted: the name that it exports, and what it is written from.
                export_specifier = asked_by.map(|it| self.intern_atom(it.specifier));
                let name = asked_by.map_or(name, |it| it.export_name);
                (self.intern_atom(name), Some(exporter))
            }
            ModuleFailureKind::ExportNotFound { .. }
            | ModuleFailureKind::ExportAmbiguous { .. } => {
                unreachable!("a name that cannot be bound stops the build")
            }
        };
        generated::ModuleFailure {
            importer: self.input.id_of(project, ModuleRef::File(failure.importer)),
            specifier,
            exporter: exporter.map(|exporter| self.input.id_of(project, exporter)),
            export_specifier,
            ends_load_of: None,
        }
    }
}

fn create_record(interop: Interop, path: StringId, display_path: StringId) -> generated::Module {
    generated::Module {
        path,
        display_path,
        kind: interop.kind,
        export_rule: interop.export_rule,
        require_result: interop.require_result,
        ..generated::Module::default()
    }
}

// Code of Bun's that is loaded like a file of the program: what the bundler imports for the constructs it lowers, as "bun:wrap" is.
fn is_bundler_helper(source: SourceKind, kind: ModuleKind) -> bool {
    match source {
        SourceKind::RuntimeModule(_) => {
            matches!(kind, ModuleKind::SourceText | ModuleKind::CommonJs)
        }
        _ => false,
    }
}

// `local` is a number of the tables that the unit was written under, and `ids` leads from those numbers to the program's.
fn find_program_id<I: Id>(local: Option<I>, ids: &[Option<I>]) -> Option<I> {
    let id = ids[local?.index()];
    Some(id.expect("link dropped the body or the data of an evaluated module"))
}

fn collect_runtime_functions(
    units: &[LinkUnit],
    input: &RecordInput<'_, '_>,
) -> Vec<RuntimeFunctionEntry> {
    let roots = input.definitions.runtime_functions.iter();
    let entries: Vec<RuntimeFunctionEntry> = roots
        .map(|root| {
            let unit = find_unit(units, ProgramModule::File(root.file));
            let unit = &units[unit.expect("a unit lists each runtime function") as usize];
            let ids = &input.numbering.tables[unit.tables as usize];
            RuntimeFunctionEntry {
                function: ids.functions[root.entry.function.index()]
                    .expect("link dropped a runtime function"),
                ..root.entry
            }
        })
        .collect();
    assert!(
        entries.is_sorted_by(|a, b| a.id < b.id),
        "two files define one runtime function"
    );
    entries
}

fn collect_web_assembly_modules(input: &RecordInput<'_, '_>) -> Vec<WebAssemblyModule> {
    let LinkProject {
        loaded, sources, ..
    } = input.projects.application;
    let files = loaded.files();
    let mut modules = Vec::new();
    for &file in sources.web_assembly_files() {
        let program_file = ProgramFile {
            project: ProjectId::Application,
            file,
        };
        let Some(module) = input.find_id(ProgramModule::File(program_file)) else {
            continue;
        };
        let source = parsed_source(files, file).expect("every loaded tree has a payload");
        let bytes = source.web_assembly.clone();
        modules.push(WebAssemblyModule {
            module,
            bytes: bytes.expect("the payload of a WebAssembly file holds its bytes"),
        });
    }
    modules
}
