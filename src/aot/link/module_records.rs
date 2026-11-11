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
    self, ImportPhase, ModuleExportKind, ModuleFlags, ModuleRequestKind, RuntimeFunctionEntry,
    WebAssemblyModule,
};
use crate::ir::parallel::{extend_from_lists, map_each};
use crate::ir::{
    DataId, FunctionId, Id, IdMap, InParallel, ModuleId, StringId, StringTable, VariableId,
    VariableKey, for_each_mut,
};
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProgramFile, ProjectId, SourceKind};
use crate::lower::{KeptBetweenWays, find_file_that_asks_mock};
use crate::module_keys::type_attribute_of;
use crate::modules::{
    self, ExportBinding, ExportLookup, ImportBinding, Interop, ModuleFailureKind, ModuleGraph,
    ModuleKind, ModuleRef, Shape, Spelling, SyntheticExportRule, compare_code_units,
};
use bun_ast::Loader;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier};
use bun_sema::program::FileId;
use bun_sema::resolve::ExternalKind;
use bun_sema::util::SharedSort;
use core::ops::Range;
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::hash_map::Entry;
use std::rc::Rc;

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
            let is_copy =
                graph.facade(export.module).is_some() && !graph.settled(export.module, export.name);
            let behind = graph
                .commonjs()
                .member_behind_getter(export.module, export.name);
            Some(match (is_copy, behind) {
                (true, _) => VariableKey::Copy(id),
                (false, Some(modules::Member::Variable(returned))) => {
                    VariableKey::SyntheticExport(returned)
                }
                (false, _) => VariableKey::SyntheticExport(id),
            })
        }
        ExportBinding::Namespace { .. } | ExportBinding::Indirect { .. } => None,
    }
}

pub(super) fn holds_exports_in_variable(graph: &ModuleGraph, module: ModuleRef) -> bool {
    match graph.shape(module) {
        Shape::Value => true,
        Shape::AsToday => match module {
            ModuleRef::File(file) => graph.commonjs().has_capturing_facade(file),
            _ => false,
        },
        Shape::EsModule | Shape::Names => false,
    }
}

pub(super) fn is_filled_by_loader(graph: &ModuleGraph, facade: ModuleRef) -> bool {
    !matches!(graph.interop(facade).export_rule, SyntheticExportRule::None)
}

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
        ExportLookup::Unknown if matches!(module, ModuleRef::File(_)) => Some((project, binding)),
        ExportLookup::Unknown | ExportLookup::Absent => None,
    }
}

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
            ProgramModule::Facade(file) => {
                let graph = projects.get(file.project).graph;
                let facade = ModuleRef::Facade(file.file);
                match is_filled_by_loader(graph, facade) {
                    true => continue,
                    false => (file.project, graph.exports_of(facade)),
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

const MODULES_IN_A_TASK: u32 = if cfg!(test) { 2 } else { 64 };

struct BuiltRecords {
    first_id: Option<ModuleId>,
    modules: Vec<generated::Module>,
    units_with_positions: Vec<(u32, u32)>,
    ambiguous_exports: Vec<generated::AmbiguousExport>,
    strings: StringTable,
}

fn list_ids_as_they_are<I: Id>(count: usize) -> Vec<Option<I>> {
    (0..count).map(|index| Some(I::new(index))).collect()
}

fn build_records_of_modules(
    units: &[LinkUnit],
    input: &RecordInput<'_, '_>,
    synthetic_exports: &[Vec<MergedSyntheticExport>],
    is_named_at_run_time: &[bool],
    names_left_to_run: &NamesLeftToRun,
    writers_of_exports: &WritersOfExports,
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
            names_left_to_run,
            writers_of_exports,
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

    let known_strings = &*strings;
    let tables: Vec<&StringTable> = built.iter().map(|records| &records.strings).collect();
    let mut program_ids: Vec<Vec<Option<StringId>>> =
        map_each(tables, input.in_parallel, &|table: &StringTable| {
            let ids = table.ids();
            ids.map(|id| known_strings.find_string_of(table, id))
                .collect()
        });
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
    pub(super) fn take_positions_from(&mut self, units: &mut [LinkUnit]) {
        for (module, unit) in core::mem::take(&mut self.units_with_positions) {
            let fragment = &mut units[unit as usize].module;
            self.modules[module as usize].positions = core::mem::take(&mut fragment.positions);
        }
    }
}

pub(super) fn build_module_records(
    units: &[LinkUnit],
    input: &RecordInput<'_, '_>,
    strings: &mut StringTable,
) -> ModuleRecords {
    let synthetic_exports = collect_synthetic_exports(input);
    let is_named_at_run_time = find_modules_named_at_run_time(input);
    let names_left_to_run = list_names_left_to_run(input);
    let writers_of_exports = list_writers_of_exports(input, &names_left_to_run);
    let (mut modules, ambiguous_exports, units_with_positions) = build_records_of_modules(
        units,
        input,
        &synthetic_exports,
        &is_named_at_run_time,
        &names_left_to_run,
        &writers_of_exports,
        strings,
    );
    end_loads_at_modules_that_throw(&mut modules);
    let mut builder = RecordBuilder {
        input,
        strings: &mut *strings,
        names: FxHashMap::default(),
        synthetic_exports: &synthetic_exports,
        is_named_at_run_time: &is_named_at_run_time,
        units_with_positions: Vec::new(),
        ambiguous_exports: Vec::new(),
        names_left_to_run: &names_left_to_run,
        writers_of_exports: &writers_of_exports,
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

fn follow_only(module: &mut generated::Module, way: Option<ModuleId>) {
    let written = core::mem::take(&mut module.requests);
    let followed = way.map(|target| generated::ModuleRequest {
        target,
        phase: ImportPhase::Evaluation,
        is_dynamic_star_export: false,
        kind: ModuleRequestKind::Import,
        completes: true,
        is_hoisted: false,
        star_place: None,
    });
    module.requests.extend(followed);
    for request in written {
        let is_import = request.kind == ModuleRequestKind::Import;
        let mut listed = module.requests.iter();
        if (is_import && Some(request.target) == way)
            || listed.any(|it| it.kind == ModuleRequestKind::Require && it.target == request.target)
        {
            continue;
        }
        module.requests.push(generated::ModuleRequest {
            phase: ImportPhase::Evaluation,
            is_dynamic_star_export: false,
            kind: ModuleRequestKind::Require,
            completes: request.completes && !is_import,
            is_hoisted: false,
            star_place: None,
            ..request
        });
    }
    module.required_names.clear();
}

fn end_loads_at_modules_that_throw(modules: &mut [generated::Module]) {
    let throws = |module: &generated::Module| module.flags.contains(ModuleFlags::THROWS_AT_LOAD);
    let mut on_the_way: Vec<usize> = (0..modules.len())
        .filter(|&index| throws(&modules[index]))
        .collect();
    if on_the_way.is_empty() {
        return;
    }
    let mut importers: Vec<Vec<usize>> = vec![Vec::new(); modules.len()];
    for (importer, module) in modules.iter().enumerate() {
        for request in &module.requests {
            if request.kind == ModuleRequestKind::Import {
                importers[request.target.index()].push(importer);
            }
        }
    }
    let mut is_found = vec![false; modules.len()];
    for &module in &on_the_way {
        is_found[module] = true;
        follow_only(&mut modules[module], None);
    }
    let mut next = 0;
    while let Some(&target) = on_the_way.get(next) {
        next += 1;
        if modules[target].flags.contains(ModuleFlags::MAY_BE_MOCKED) {
            continue;
        }
        for &importer in &importers[target] {
            if !core::mem::replace(&mut is_found[importer], true) {
                follow_only(&mut modules[importer], Some(ModuleId::new(target)));
                on_the_way.push(importer);
            }
        }
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
                writer: ExportWriter::Loader | ExportWriter::Facade | ExportWriter::Capture,
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
    units_with_positions: Vec<(u32, u32)>,
    ambiguous_exports: Vec<generated::AmbiguousExport>,
    names_left_to_run: &'b NamesLeftToRun,
    writers_of_exports: &'b WritersOfExports,
}

#[derive(Default)]
struct AnswersOfMocks {
    kept: FxHashMap<(ProgramFile, Atom, FileId, bool), KeptAnswer>,
    stars: FxHashMap<ProgramFile, Rc<StarsOfFile>>,
    on_path: FxHashSet<FileId>,
    rings_met: usize,
    times_met_under_another_name: usize,
    files_found_off_path: Vec<FileId>,
    walked_in_this_walk: FxHashMap<FileId, WhatWalkMet>,
    #[cfg(test)]
    walks_every_path: bool,
}

#[derive(Clone, Copy)]
struct WhatWalkMet {
    rings: bool,
    files_under_another_name: bool,
}

struct KeptAnswer {
    answer: bool,
    holds_while_off_path: Box<[FileId]>,
}

const MOST_REQUESTS_WALKED_AS_THEY_STAND: usize = 8;

type NamesLeftToRun = FxHashMap<(ProgramFile, Atom), Option<(ModuleRef, Atom)>>;
type WritersOfExports = FxHashMap<(ProgramFile, Atom), FileId>;

struct StarsOfFile {
    first_that_leads_to: FxHashMap<FileId, usize>,
    first_that_lists: FxHashMap<Atom, usize>,
    files_that_run_follows: FxHashSet<FileId>,
    names_that_run_follows: FxHashSet<Atom>,
    may_answer: Vec<usize>,
}

impl StarsOfFile {
    fn of(graph: &modules::ModuleGraph, atoms: &Interner<'_>, file: FileId) -> StarsOfFile {
        let mut stars = StarsOfFile {
            first_that_leads_to: FxHashMap::default(),
            first_that_lists: FxHashMap::default(),
            files_that_run_follows: FxHashSet::default(),
            names_that_run_follows: FxHashSet::default(),
            may_answer: Vec::new(),
        };
        let requests = graph.in_order_of_stars(ModuleRef::File(file), graph.requests(file));
        for (place, request) in requests.iter().enumerate() {
            let follows = request.is_dynamic_star_export;
            let ModuleRef::File(target) = request.target else {
                if follows && graph.is_named_by_mock(request.target) {
                    stars.may_answer.push(place);
                }
                continue;
            };
            if !request.is_star_export && !follows {
                continue;
            }
            let listed = graph.exports(target).iter().map(|export| export.name);
            let listed = listed.filter(|&name| graph.lists_export(request.target, name, atoms));
            for name in listed {
                if request.is_star_export {
                    stars.first_that_lists.entry(name).or_insert(place);
                }
                if follows {
                    stars.names_that_run_follows.insert(name);
                }
            }
            if request.is_star_export {
                stars.first_that_leads_to.entry(target).or_insert(place);
            }
            if !follows {
                continue;
            }
            stars.files_that_run_follows.insert(target);
            let mut below = graph.requests(target).iter();
            if request.is_star_export
                && (graph.is_named_by_mock(request.target)
                    || below.any(|request| request.is_dynamic_star_export))
            {
                stars.may_answer.push(place);
            }
        }
        stars
    }
}

fn exports_name_itself(
    graph: &modules::ModuleGraph,
    atoms: &Interner<'_>,
    file: FileId,
    name: Atom,
) -> bool {
    let (exports, name) = (graph.exports(file), atoms.bytes(name));
    let place = exports.binary_search_by(|it| compare_code_units(atoms.bytes(it.name), name));
    place.is_ok_and(|place| !exports[place].is_from_star_export)
}

fn find_file_that_entry_comes_from(
    graph: &modules::ModuleGraph,
    atoms: &Interner<'_>,
    file: FileId,
    name: Atom,
) -> Option<FileId> {
    let (exports, name) = (graph.exports(file), atoms.bytes(name));
    let place = exports.binary_search_by(|it| compare_code_units(atoms.bytes(it.name), name));
    match exports[place.ok()?].binding {
        ExportBinding::Variable(declared) => Some(declared.file),
        ExportBinding::Indirect {
            module: ModuleRef::File(source),
            ..
        } => Some(source),
        _ => None,
    }
}

fn takes_name_back_from_path(
    graph: &modules::ModuleGraph,
    answers: &mut AnswersOfMocks,
    (file, name): (FileId, Atom),
) -> bool {
    let mut taken = (file, name);
    let mut met = FxHashSet::default();
    while let Some((ModuleRef::File(source), name_in_source)) =
        graph.find_what_hands_on_names(taken.0, taken.1)
    {
        let mut requests = graph.requests(source).iter();
        if answers.on_path.contains(&source) {
            if name_in_source == name {
                return true;
            }
            answers.times_met_under_another_name += 1;
        } else if requests.any(|request| request.is_dynamic_star_export) {
            answers.files_found_off_path.push(source);
        }
        taken = (source, name_in_source);
        if !met.insert(taken) {
            return false;
        }
    }
    false
}

fn find_first_star_that_lists(
    graph: &modules::ModuleGraph,
    atoms: &Interner<'_>,
    file: ProgramFile,
    name: Atom,
    answers: &mut AnswersOfMocks,
) -> Option<ModuleRef> {
    let requests = graph.in_order_of_stars(ModuleRef::File(file.file), graph.requests(file.file));
    if requests.len() > MOST_REQUESTS_WALKED_AS_THEY_STAND {
        let stars = answers.stars.entry(file);
        let stars = stars.or_insert_with(|| Rc::new(StarsOfFile::of(graph, atoms, file.file)));
        let place = stars.first_that_lists.get(&name);
        return place.map(|&place| requests[place].target);
    }
    let mut stars = requests.iter().filter(|request| request.is_star_export);
    let first = stars.find(|request| graph.lists_export(request.target, name, atoms));
    first.map(|request| request.target)
}

fn mock_may_answer_ahead_of_declaration(
    graph: &modules::ModuleGraph,
    atoms: &Interner<'_>,
    file: ProgramFile,
    asked: (Atom, FileId),
    answers: &mut AnswersOfMocks,
) -> bool {
    let (name, declaring_file) = asked;
    let is_below_another = !answers.on_path.is_empty();
    let key = (file, name, declaring_file, is_below_another);
    if let Some(&met) = answers.walked_in_this_walk.get(&file.file) {
        answers.rings_met += usize::from(met.rings);
        answers.times_met_under_another_name += usize::from(met.files_under_another_name);
        return false;
    }
    if let Some(kept) = answers.kept.get(&key) {
        let mut relied_on = kept.holds_while_off_path.iter();
        if relied_on.all(|file| !answers.on_path.contains(file)) {
            let found_off_path = &mut answers.files_found_off_path;
            found_off_path.extend_from_slice(&kept.holds_while_off_path);
            return kept.answer;
        }
    }
    let requests = graph.in_order_of_stars(ModuleRef::File(file.file), graph.requests(file.file));
    let stars = (requests.len() > MOST_REQUESTS_WALKED_AS_THEY_STAND).then(|| {
        let stars = answers.stars.entry(file);
        Rc::clone(stars.or_insert_with(|| Rc::new(StarsOfFile::of(graph, atoms, file.file))))
    });
    let is_found_by_run = match &stars {
        _ if is_below_another => !exports_name_itself(graph, atoms, file.file, name),
        Some(stars) => {
            stars.files_that_run_follows.contains(&declaring_file)
                || stars.names_that_run_follows.contains(&name)
        }
        None => requests.iter().any(|request| {
            request.is_dynamic_star_export
                && (request.target == ModuleRef::File(declaring_file)
                    || graph.lists_export(request.target, name, atoms))
        }),
    };
    let comes_round = |place: &usize| match requests[*place].target {
        ModuleRef::File(target) => answers.on_path.contains(&target),
        _ => false,
    };
    let stars = stars.filter(|stars| !stars.may_answer.iter().any(comes_round));
    let mut last = None;
    let places: &mut dyn Iterator<Item = usize> = match &stars {
        None => &mut (0..requests.len()),
        Some(stars) => {
            let ends = [
                stars.first_that_leads_to.get(&declaring_file),
                stars.first_that_lists.get(&name),
            ];
            last = ends.into_iter().flatten().min().copied();
            &mut stars.may_answer.iter().copied()
        }
    };
    let rings_met = answers.rings_met;
    let times_met_under_another_name = answers.times_met_under_another_name;
    let first_found_off_path = answers.files_found_off_path.len();
    answers.on_path.insert(file.file);
    let may_bring_unlisted_name = |request: &modules::ModuleRequest| {
        request.is_dynamic_star_export
            && (!graph.interop(request.target).has_export_table()
                || matches!(request.target, ModuleRef::File(target) if graph.has_dynamic_names(target)))
    };
    let is_behind_unlisted_names = |place: usize| {
        graph.is_named_by_mock(ModuleRef::File(declaring_file))
            && requests[..place].iter().any(may_bring_unlisted_name)
    };
    let is_listed_for_run_alone = |listing: FileId| {
        if !graph.is_named_by_mock(ModuleRef::File(declaring_file)) {
            return false;
        }
        let mut taken = (listing, name);
        let mut met = FxHashSet::default();
        while let Some((ModuleRef::File(source), name_in_source)) =
            graph.find_what_hands_on_names(taken.0, taken.1)
        {
            if graph.has_dynamic_names(source)
                && !exports_name_itself(graph, atoms, source, name_in_source)
            {
                let comes_from =
                    find_file_that_entry_comes_from(graph, atoms, source, name_in_source);
                let is_settled_by_own_mock =
                    comes_from.is_none() && graph.is_named_by_mock(ModuleRef::File(source));
                return !is_settled_by_own_mock && comes_from != Some(declaring_file);
            }
            taken = (source, name_in_source);
            if !met.insert(taken) {
                return false;
            }
        }
        false
    };
    let mut answer = false;
    let first_that_lists = stars
        .as_ref()
        .and_then(|stars| stars.first_that_lists.get(&name));
    let mut is_ring_met_below = matches!(
        first_that_lists.map(|&place| requests[place].target),
        Some(ModuleRef::File(first))
            if takes_name_back_from_path(graph, answers, (first, name))
    );
    answers.rings_met += usize::from(is_ring_met_below);
    for place in places {
        let request = &requests[place];
        if !is_found_by_run || (!is_ring_met_below && last.is_some_and(|last| place > last)) {
            break;
        }
        let ModuleRef::File(target) = request.target else {
            if request.is_dynamic_star_export && graph.is_named_by_mock(request.target) {
                answer = true;
                break;
            }
            continue;
        };
        if !request.is_star_export {
            continue;
        }
        if target == declaring_file {
            answer = is_behind_unlisted_names(place);
            break;
        }
        let has_name = |answers: &mut AnswersOfMocks| {
            if !graph.lists_export(request.target, name, atoms) {
                return false;
            }
            let is_taken_back = takes_name_back_from_path(graph, answers, (target, name));
            answers.rings_met += usize::from(is_taken_back);
            !is_taken_back
        };
        if !request.is_dynamic_star_export {
            if has_name(answers) {
                break;
            }
            continue;
        }
        if answers.on_path.contains(&target) {
            answers.rings_met += 1;
            continue;
        }
        let below = ProgramFile {
            project: file.project,
            file: target,
        };
        let rings_met_above = answers.rings_met;
        if graph.is_named_by_mock(request.target)
            || mock_may_answer_ahead_of_declaration(graph, atoms, below, asked, answers)
        {
            answer = true;
            break;
        }
        if rings_met_above != answers.rings_met {
            is_ring_met_below = true;
            continue;
        }
        if has_name(answers) {
            answer = is_behind_unlisted_names(place) || is_listed_for_run_alone(target);
            break;
        }
    }
    let end = last.filter(|_| !answer && is_found_by_run && !is_ring_met_below);
    let end = end.filter(|_| graph.is_named_by_mock(ModuleRef::File(declaring_file)));
    if let Some((place, ModuleRef::File(target))) = end.map(|end| (end, requests[end].target)) {
        answer = (target == declaring_file || requests[place].is_dynamic_star_export)
            && (is_behind_unlisted_names(place) || is_listed_for_run_alone(target));
    }
    answers.on_path.remove(&file.file);
    let mut found_off_path = answers.files_found_off_path.split_off(first_found_off_path);
    found_off_path.shared_sort_unstable_by_key(|&file| file);
    found_off_path.dedup();
    if is_below_another {
        let above = &mut answers.files_found_off_path;
        above.extend_from_slice(&found_off_path);
    }
    let met = WhatWalkMet {
        rings: rings_met != answers.rings_met,
        files_under_another_name: times_met_under_another_name
            != answers.times_met_under_another_name,
    };
    #[cfg(test)]
    if answers.walks_every_path {
        return answer;
    }
    if !is_below_another {
        answers.walked_in_this_walk.clear();
    } else if !answer && (met.rings || met.files_under_another_name) {
        answers.walked_in_this_walk.insert(file.file, met);
    }
    if !met.rings && !met.files_under_another_name {
        let holds_while_off_path = found_off_path.into_boxed_slice();
        let kept = KeptAnswer {
            answer,
            holds_while_off_path,
        };
        answers.kept.insert(key, kept);
    }
    answer
}

fn list_writers_of_exports(
    input: &RecordInput<'_, '_>,
    names_left_to_run: &NamesLeftToRun,
) -> WritersOfExports {
    let mut kept: FxHashMap<ProjectId, KeptBetweenWays> = FxHashMap::default();
    let mut writers = WritersOfExports::default();
    for &module in &input.modules.modules {
        let ProgramModule::File(holder) = module else {
            continue;
        };
        let graph = input.projects.get(holder.project).graph;
        if !graph.reaches_mock(holder.file) {
            continue;
        }
        let kept = kept.entry(holder.project).or_default();
        let exports = graph.exports(holder.file).iter();
        for export in exports.filter(|it| it.is_read_from_object) {
            if names_left_to_run.contains_key(&(holder, export.name)) {
                continue;
            }
            let writer = find_file_that_asks_mock(graph, kept, holder.file, export);
            if let Some(writer) = writer.filter(|&writer| writer != holder.file) {
                writers.insert((holder, export.name), writer);
            }
        }
    }
    writers
}

fn list_names_left_to_run(input: &RecordInput<'_, '_>) -> NamesLeftToRun {
    let mut answers = AnswersOfMocks::default();
    let mut left_to_run = NamesLeftToRun::default();
    for &module in &input.modules.modules {
        let ProgramModule::File(asking) = module else {
            continue;
        };
        let graph = input.projects.get(asking.project).graph;
        let mut requests = graph.requests(asking.file).iter();
        if !graph.is_any_module_named_by_mock()
            || !requests.any(|request| request.is_dynamic_star_export)
        {
            continue;
        }
        for export in graph.exports(asking.file) {
            let comes_from = match export.binding {
                ExportBinding::Variable(declared) => declared.file,
                ExportBinding::Indirect {
                    module: ModuleRef::File(source),
                    ..
                } => source,
                _ => continue,
            };
            let asked = (export.name, comes_from);
            if export.is_from_star_export
                && mock_may_answer_ahead_of_declaration(
                    graph,
                    input.atoms,
                    asking,
                    asked,
                    &mut answers,
                )
            {
                left_to_run.insert((asking, export.name), None);
            }
        }
    }
    if left_to_run.is_empty() {
        return left_to_run;
    }
    let mut handing_on: FxHashMap<(ProgramFile, Atom), Vec<(ProgramFile, Atom)>> =
        FxHashMap::default();
    let mut holding_stars: FxHashMap<ProgramFile, Vec<ProgramFile>> = FxHashMap::default();
    for &module in &input.modules.modules {
        let ProgramModule::File(handing) = module else {
            continue;
        };
        let graph = input.projects.get(handing.project).graph;
        for &(name, (source, name_in_source)) in graph.names_handed_on(handing.file) {
            if let ModuleRef::File(file) = source {
                let source = ProgramFile { file, ..handing };
                let handed_on = handing_on.entry((source, name_in_source)).or_default();
                handed_on.push((handing, name));
            }
        }
        for request in graph.requests(handing.file) {
            if let (true, ModuleRef::File(file)) = (request.is_star_export, request.target) {
                let source = ProgramFile { file, ..handing };
                holding_stars.entry(source).or_default().push(handing);
            }
        }
    }
    let mut waiting: Vec<(ProgramFile, Atom)> = left_to_run.keys().copied().collect();
    while let Some((source, name)) = waiting.pop() {
        let asked = ModuleRef::File(source.file);
        let hands_it_on = left_to_run[&(source, name)].is_some();
        let mut take = |taken: (ProgramFile, Atom)| {
            if let Entry::Vacant(place) = left_to_run.entry(taken) {
                place.insert(Some((asked, name)));
                waiting.push(taken);
            }
        };
        let handed_on = handing_on.get(&(source, name)).into_iter().flatten();
        handed_on.copied().for_each(&mut take);
        let holders = holding_stars.get(&source).filter(|_| hands_it_on);
        for &holder in holders.into_iter().flatten() {
            let (graph, atoms) = (input.projects.get(holder.project).graph, input.atoms);
            if !exports_name_itself(graph, atoms, holder.file, name)
                && graph.lists_export(ModuleRef::File(holder.file), name, atoms)
                && find_first_star_that_lists(graph, atoms, holder, name, &mut answers)
                    == Some(asked)
            {
                take((holder, name));
            }
        }
    }
    left_to_run
}

impl RecordBuilder<'_, '_, '_> {
    fn intern_atom(&mut self, atom: Atom) -> StringId {
        let (atoms, strings) = (self.input.atoms, &mut *self.strings);
        *self
            .names
            .entry(atom)
            .or_insert_with(|| strings.intern(atoms.bytes(atom)))
    }

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
                | ProgramModule::Facade(file)
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
        let files = input.projects.get(file.project).loaded.files();
        let stands_for_text_that_nobody_could_read =
            parsed_source(files, file.file).is_some_and(|it| {
                it.parse_failure.is_some()
                    && (it.refused_at.is_some()
                        || graph.is_found_by_computed_names_alone(file.file))
            });
        if (fragment.throws_at_load || stands_for_text_that_nobody_could_read)
            && interop.has_export_table()
        {
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
                if graph.may_be_evicted(ModuleRef::File(file.file)) {
                    record.flags |= ModuleFlags::MAY_BE_EVICTED;
                }
                if graph.is_found_by_name(ModuleRef::File(file.file))
                    || graph.is_named_by_copies(ModuleRef::File(file.file))
                {
                    record.flags |= ModuleFlags::IS_FOUND_BY_NAME;
                }
                if interop.loader_returns_namespace {
                    record.flags |= ModuleFlags::LOADER_RETURNS_NAMESPACE;
                }
                record.data = find_program_id(fragment.data, &ids.data);
                self.fill_export_table_record(file, &mut record);
            }
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
            ProgramModule::Facade(_) if is_filled_by_loader(graph, own) => {
                record.synthetic_exports = self.build_synthetic_exports(index);
            }
            ProgramModule::Facade(_) => {
                record.exports = self.build_exports(project, None, graph.exports_of(own));
            }
            ProgramModule::Inner { .. } | ProgramModule::Check(_) => {}
            ProgramModule::File(_) | ProgramModule::Runtime(_) | ProgramModule::External { .. } => {
                unreachable!("the record belongs to a file")
            }
        }
        record
    }

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

    fn flags_of_runtime_module(&self, module: Option<RuntimeModule>) -> ModuleFlags {
        let graph = self.input.projects.get(ProjectId::Application).graph;
        let mut flags = ModuleFlags::default();
        let Some(module) = module else {
            return flags;
        };
        if graph.may_be_mocked(ModuleRef::Runtime(module)) {
            flags |= ModuleFlags::MAY_BE_MOCKED;
        }
        if graph.rejects_require_cache_override(module) {
            flags |= ModuleFlags::REJECTS_REQUIRE_CACHE_OVERRIDE;
        }
        if graph.is_exposed_by_test_runner(module) {
            flags |= ModuleFlags::IS_EXPOSED_BY_TEST_RUNNER;
        }
        flags
    }

    fn planned_flags(&self, project: ProjectId, module: ModuleRef) -> ModuleFlags {
        let graph = self.input.projects.get(project).graph;
        let mut flags = ModuleFlags::default();
        if graph.caches_evaluation_error(module) {
            flags |= ModuleFlags::CACHES_EVALUATION_ERROR;
        }
        if graph.is_loaded_by_loader(module) {
            flags |= ModuleFlags::IS_LOADED_BY_LOADER;
        }
        if graph.is_required_during_load(module) {
            flags |= ModuleFlags::IS_REQUIRED_DURING_LOAD;
        }
        if graph.is_importable_during_evaluation(module) {
            flags |= ModuleFlags::IS_IMPORTABLE_DURING_EVALUATION;
        }
        if graph.is_imported_as_es_module(module) {
            flags |= ModuleFlags::IS_IMPORTED_AS_ES_MODULE;
        }
        if graph.is_imported_as_namespace(module) {
            flags |= ModuleFlags::IS_IMPORTED_AS_NAMESPACE;
        }
        if graph.may_be_mocked(module) {
            flags |= ModuleFlags::MAY_BE_MOCKED;
        }
        if graph.runs_tests() && graph.is_code_of_program(module) {
            flags |= ModuleFlags::IS_LISTED_IN_CACHE;
            if graph.reaches_entries_of_cache() {
                flags |= ModuleFlags::IS_EXPOSED_BY_REQUIRE_CACHE;
            }
        }
        if graph.may_be_evicted(module) && graph.is_code_of_program(module) {
            flags |= ModuleFlags::MAY_BE_EVICTED;
        }
        if graph.is_imported_by_alias(module, Spelling::WithoutExtension) {
            flags |= ModuleFlags::IS_IMPORTED_WITHOUT_EXTENSION;
        }
        if graph.is_imported_by_alias(module, Spelling::WithOtherExtension) {
            flags |= ModuleFlags::IS_IMPORTED_WITH_OTHER_EXTENSION;
        }
        if graph.is_imported_by_alias(module, Spelling::AsDirectory) {
            flags |= ModuleFlags::IS_IMPORTED_AS_DIRECTORY;
        }
        if matches!(module, ModuleRef::File(file) if graph.may_be_reevaluated(file)) {
            flags |= ModuleFlags::MAY_BE_REEVALUATED;
        }
        let sources = self.input.projects.get(project).sources;
        if matches!(module, ModuleRef::File(file) if sources.depends_on_more_than_source(file)) {
            flags |= ModuleFlags::DEPENDS_ON_MORE_THAN_SOURCE;
        }
        flags |= crate::test_runs::flags_of_module(graph, module);
        if graph.reaches_module_objects(module) {
            flags |= ModuleFlags::REACHES_MODULE_OBJECTS;
        }
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
        let requests = input.projects.get(project).graph.requests_of(module);
        let is_star = |it: &modules::ModuleRequest| it.is_star_export || it.is_dynamic_star_export;
        let stars = || requests.iter().filter(|it| is_star(it));
        let mut places: Vec<u32> = stars().map(|it| it.star_place).collect();
        let follows_every_star = stars().all(|it| it.is_dynamic_star_export);
        let follows_no_star = !stars().any(|it| it.is_dynamic_star_export);
        let says_nothing_new = follows_no_star || (follows_every_star && places.is_sorted());
        if says_nothing_new || places.contains(&modules::NO_STAR_PLACE) {
            places.clear();
        }
        places.sort_unstable();
        let rank_of = |request: &modules::ModuleRequest| {
            let is_ranked = is_star(request) && !places.is_empty();
            is_ranked.then(|| places.partition_point(|&place| place < request.star_place) as u32)
        };
        requests
            .iter()
            .map(|request| generated::ModuleRequest {
                target: input.id_of(project, request.target),
                phase: request.phase,
                is_dynamic_star_export: request.is_dynamic_star_export,
                kind: request.kind,
                completes: request.completes,
                is_hoisted: request.is_hoisted,
                star_place: rank_of(request),
            })
            .collect()
    }

    fn build_exports(
        &mut self,
        project: ProjectId,
        holder: Option<FileId>,
        exports: &[modules::ModuleExport],
    ) -> Vec<generated::ModuleExport> {
        exports
            .iter()
            .filter(|export| export.is_read_from_object)
            .filter_map(|export| {
                let writer = holder.and_then(|holder| self.find_writer(project, holder, export));
                let record = self.build_export(project, export)?;
                Some(generated::ModuleExport { writer, ..record })
            })
            .collect()
    }

    fn find_writer(
        &self,
        project: ProjectId,
        holder: FileId,
        export: &modules::ModuleExport,
    ) -> Option<ModuleId> {
        let is_followed = matches!(
            export.binding,
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_)
        );
        if !is_followed {
            return None;
        }
        let holder = ProgramFile {
            project,
            file: holder,
        };
        let &writer = self.writers_of_exports.get(&(holder, export.name))?;
        Some(self.input.id_of(project, ModuleRef::File(writer)))
    }

    fn fill_export_table_record(&mut self, file: ProgramFile, record: &mut generated::Module) {
        let input = self.input;
        let ProgramFile { project, file } = file;
        let graph = input.projects.get(project).graph;
        if graph.has_top_level_await(file) {
            record.flags |= ModuleFlags::HAS_TOP_LEVEL_AWAIT;
        }
        record.requests = self.build_requests(project, ModuleRef::File(file));
        if graph.lists_names_of_statements() {
            let files = input.projects.get(project).loaded.files();
            let sites = files.analysis(file).import_sites.iter();
            let written = sites.filter_map(|site| match (site.kind, site.specifier) {
                (
                    ImportSiteKind::JsxRuntime
                    | ImportSiteKind::JsxPackage
                    | ImportSiteKind::Import(_)
                    | ImportSiteKind::ExportFrom(_)
                    | ImportSiteKind::ExportStar(_),
                    ImportSpecifier::Constant(name),
                ) => Some((name, graph.find_site_answer(file, site.kind))),
                _ => None,
            });
            let mut names = FxHashSet::default();
            let written = written.filter(|&(name, linked)| match linked {
                Some(modules::SiteAnswer::Module(module)) => names.insert((name, Some(module))),
                _ => names.insert((name, None)),
            });
            record.names_of_statements = written.map(|(name, _)| self.intern_atom(name)).collect();
        }
        let left_to_run = self.names_left_to_run;
        let as_run_finds_it = |&export: &modules::ModuleExport| {
            let Some(&asked) = left_to_run.get(&(ProgramFile { project, file }, export.name))
            else {
                return Some(export);
            };
            let (module, name) = asked?;
            let binding = ExportBinding::Indirect { module, name };
            Some(modules::ModuleExport { binding, ..export })
        };
        let mut exports: Vec<modules::ModuleExport> = graph
            .exports(file)
            .iter()
            .filter_map(as_run_finds_it)
            .collect();
        let names_left_out = graph.names_left_out(file);
        let whole = exports.iter().find(|it| it.name == known::default);
        if let Some(&whole) = whole.filter(|_| !names_left_out.is_empty()) {
            let left_out = names_left_out.iter();
            exports.extend(left_out.map(|&name| modules::ModuleExport { name, ..whole }));
            let atoms = input.atoms;
            exports.shared_sort_by(|a, b| {
                compare_code_units(atoms.bytes(a.name), atoms.bytes(b.name))
            });
        }
        record.exports = self.build_exports(project, Some(file), &exports);
        if !names_left_out.is_empty() {
            let default_name = self.intern_atom(known::default);
            let whole = record.exports.iter().find(|it| it.name == default_name);
            let whole = whole.and_then(|it| it.variable);
            for export in &mut record.exports {
                export.is_omitted =
                    whole.is_some() && export.variable == whole && export.name != default_name;
            }
        }
        for &name in graph.ambiguous_names(file) {
            let ambiguous = generated::AmbiguousExport {
                module: input.id_of(project, ModuleRef::File(file)),
                name: self.intern_atom(name),
            };
            self.ambiguous_exports.push(ambiguous);
        }
        let requests = graph.requests_of(ModuleRef::File(file));
        let is_requested = |module: ModuleRef| requests.iter().any(|it| it.target == module);
        let exporter_of = |required: &modules::RequiredName| match required.is_found_unless_mocked {
            true => graph.facade(required.module).unwrap_or(required.module),
            false => required.module,
        };
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
                is_requested_by_star_export: required.is_requested_by_star_export,
            })
            .collect();
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
                && (graph.is_importable_during_evaluation(ModuleRef::File(exporter))
                    || graph.may_be_mocked(ModuleRef::File(exporter)))
                && !asked_for_default.iter().any(|asked| asked.0 == exporter)
            {
                asked_for_default.push((exporter, export_name));
            }
        }
        let written = graph.requests(file);
        for (file, export_name) in asked_for_default {
            let is_written = written.iter().any(|it| it.target == ModuleRef::File(file));
            let export_name = export_name.or_else(|| (!is_written).then_some(known::default));
            let exporter = graph.facade(ModuleRef::File(file));
            let exporter = exporter.unwrap_or(ModuleRef::File(file));
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
                is_requested_by_star_export: false,
            });
        }
    }

    fn build_export(
        &mut self,
        project: ProjectId,
        export: &modules::ModuleExport,
    ) -> Option<generated::ModuleExport> {
        let input = self.input;
        let is_found_by_run = match export.binding {
            ExportBinding::Indirect {
                module: ModuleRef::File(file),
                name,
            } => (self.names_left_to_run).contains_key(&(ProgramFile { project, file }, name)),
            _ => false,
        };
        let (project, binding) = match is_found_by_run {
            true => (project, export.binding),
            false => {
                let listed =
                    find_listed_binding(input.projects, input.atoms, project, export.binding)?;
                let commonjs = input.projects.get(listed.0).graph.commonjs();
                match (export.binding, listed.1) {
                    (ExportBinding::Indirect { .. }, ExportBinding::Synthetic(copy))
                        if commonjs.may_stay_empty(copy) =>
                    {
                        (project, export.binding)
                    }
                    _ => listed,
                }
            }
        };
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
                let is_hidden_until_initialized = match binding {
                    ExportBinding::Synthetic(copy) => commonjs.may_stay_empty(copy),
                    _ => false,
                };
                generated::ModuleExport {
                    kind: ModuleExportKind::Variable,
                    variable: Some(input.exported_variable(project, key)),
                    is_hidden_until_initialized,
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
                if failure.exporter.is_some() {
                    continue;
                }
                let (importer, specifier) = (failure.importer, failure.specifier);
                records.push(generated::ModuleFailure {
                    importer,
                    specifier,
                    exporter: None,
                    export_specifier: None,
                    failed_load_root: Some(module),
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
            failed_load_root: None,
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

fn is_bundler_helper(source: SourceKind, kind: ModuleKind) -> bool {
    match source {
        SourceKind::RuntimeModule(_) => {
            matches!(kind, ModuleKind::SourceText | ModuleKind::CommonJs)
        }
        _ => false,
    }
}

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
