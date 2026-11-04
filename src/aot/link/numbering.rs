use super::LinkError;
use super::beside::{Beside, run_steps_beside};
use super::merged_keys::Merged;
#[cfg(test)]
use super::merged_keys::MergedKeys;
#[cfg(test)]
use super::program_keys::ProgramFunctionKey;
use super::program_keys::{ProgramLayoutKey, ProgramVariableKey};
use super::state::{DefinitionSite, Definitions, VariableDefinition};
use super::tables::LinkTables;
use super::unit::LinkUnit;
use crate::ir::ids::ExpectedResultId;
use crate::ir::references::IdMap;
use crate::ir::{
    ABSENT_WORD, DataId, EvalScopeId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, StringId, TypeId, TypeSiteId, VariableId, for_each_mut,
};
#[cfg(debug_assertions)]
use crate::load::ProgramFile;
use crate::load::{PerProject, ProjectId};
use crate::modules;
use crate::statistics::{Architecture, LimitId, Stage, StepClock};
use bun_sort_by_number::{SortByNumber, number_of_pair};
use core::convert::identity;
use core::mem::replace;

/// Each list is indexed by the id a record has in one set of tables and holds that record's id in the program.
/// `None`: the program has no such record.
#[derive(Default)]
pub struct TableIds {
    pub strings: Vec<Option<StringId>>,
    pub property_keys: Vec<Option<PropertyKeyId>>,
    pub types: Vec<Option<TypeId>>,
    /// Empty.
    pub type_sites: Vec<Option<TypeSiteId>>,
    pub expected_results: Vec<Option<ExpectedResultId>>,
    pub layouts: Vec<Option<LayoutId>>,
    pub variables: Vec<Option<VariableId>>,
    pub modules: Vec<Option<ModuleId>>,
    pub module_failures: Vec<Option<ModuleFailureId>>,
    pub eval_scopes: Vec<Option<EvalScopeId>>,
    pub functions: Vec<Option<FunctionId>>,
    pub data: Vec<Option<DataId>>,
}

impl TableIds {
    pub fn as_map(&self) -> IdMap<'_> {
        IdMap {
            strings: &self.strings,
            property_keys: &self.property_keys,
            types: &self.types,
            type_sites: &self.type_sites,
            expected_results: &self.expected_results,
            layouts: &self.layouts,
            variables: &self.variables,
            modules: &self.modules,
            module_failures: &self.module_failures,
            eval_scopes: &self.eval_scopes,
            functions: &self.functions,
            data: &self.data,
        }
    }
}

// An id is a word of the wire, whatever machine the build aims at.
const MAX_PROGRAM_IDS: u64 = LimitId::MaxProgramIds.value(Architecture::ARM64);
const _: () = assert!(MAX_PROGRAM_IDS == LimitId::MaxProgramIds.value(Architecture::X86_64));
const _: () = assert!(MAX_PROGRAM_IDS < ABSENT_WORD as u64);

/// `LimitId::MaxProgramIds`, for the records of one kind.
pub(super) fn check_count_of_ids(count: usize) -> Result<(), Vec<LinkError>> {
    let (limit, count) = (LimitId::MaxProgramIds, count as u64);
    match count > MAX_PROGRAM_IDS {
        true => Err(vec![LinkError::LimitExceeded { limit, count }]),
        false => Ok(()),
    }
}

#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(super) struct ProgramCounts {
    pub functions: usize,
    pub layouts: usize,
    pub variables: usize,
    pub modules: usize,
    pub module_failures: usize,
    pub eval_scopes: usize,
    pub data: usize,
    pub expected_results: usize,
}

impl ProgramCounts {
    pub(super) fn check_limit(&self) -> Result<(), Vec<LinkError>> {
        let counts = [
            self.functions,
            self.layouts,
            self.variables,
            self.modules,
            self.module_failures,
            self.eval_scopes,
            self.data,
            self.expected_results,
        ];
        counts.into_iter().try_for_each(check_count_of_ids)
    }
}

pub(super) struct Numbering {
    /// By merged index, like the next two.
    pub functions: Vec<Option<FunctionId>>,
    pub layouts: Vec<Option<LayoutId>>,
    pub variables: Vec<Option<VariableId>>,
    /// By the index in `ModuleTable::modules`.
    pub modules: Vec<Option<ModuleId>>,
    /// By `modules::ModuleFailureId`. A list ends behind the last failure that has an id.
    pub module_failures: PerProject<Vec<Option<ModuleFailureId>>>,
    pub counts: ProgramCounts,
    /// In the order of `LinkTables`.
    pub tables: Vec<TableIds>,
    /// By `LayoutId`.
    pub layout_keys: Vec<ProgramLayoutKey>,
}

fn number_in_order<I: Id>(
    merged_count: usize,
    order: impl IntoIterator<Item = u32>,
    count: &mut usize,
) -> Vec<Option<I>> {
    let mut ids: Vec<Option<I>> = vec![None; merged_count];
    for merged in order {
        debug_assert!(ids[merged as usize].is_none());
        ids[merged as usize] = Some(I::new(*count));
        *count += 1;
    }
    ids
}

fn number_marked<I: Id>(marks: &[bool], count: &mut usize) -> Vec<Option<I>> {
    let number = |&is_marked: &bool| {
        let id = is_marked.then(|| I::new(*count));
        *count += usize::from(is_marked);
        id
    };
    marks.iter().map(number).collect()
}

fn resolve_program_ids<I: Id>(local_to_merged: &[u32], ids: &[Option<I>]) -> Vec<Option<I>> {
    local_to_merged
        .iter()
        .map(|&merged| ids[merged as usize])
        .collect()
}

// The merged indexes of what the units define, units in the order of their files, the definitions of a unit in its order.
fn list_chosen_definitions<I: Id, T, D: PartialEq>(
    units: &[LinkUnit],
    definitions_of: fn(&LinkUnit) -> &Vec<(I, T)>,
    merged_index_of: &dyn Fn(&LinkUnit, I) -> u32,
    chosen: &[Option<D>],
    create_definition: fn(DefinitionSite) -> D,
) -> Vec<u32> {
    let mut order = Vec::new();
    for (unit, link_unit) in (0u32..).zip(units) {
        for (index, &(id, _)) in (0u32..).zip(definitions_of(link_unit)) {
            let merged = merged_index_of(link_unit, id);
            let site = DefinitionSite { unit, index };
            if chosen[merged as usize] == Some(create_definition(site)) {
                order.push(merged);
            }
        }
    }
    order
}

// Code reads a variable whose key its tables name. The object of a module reads what the export table of the module lists.
fn find_variables_that_are_read(
    merged: &Merged<'_>,
    shown_by_export_tables: &[ProgramVariableKey],
) -> Vec<bool> {
    let variables = merged.variables;
    let mut is_read = vec![false; variables.keys.len()];
    for named in &variables.local_to_merged[..merged.tables.len()] {
        for &variable in named {
            is_read[variable as usize] = true;
        }
    }
    let shown = shown_by_export_tables.iter();
    for variable in shown.filter_map(|key| variables.find(key)) {
        is_read[variable as usize] = true;
    }
    is_read
}

// The loader fills every export that has an id when it links the module, so one that nothing reads gets none.
fn number_variables_that_link_defines(
    listed: impl Iterator<Item = u32>,
    definitions: &[Option<VariableDefinition>],
    is_read: &[bool],
    ids: &mut [Option<VariableId>],
    count: &mut usize,
) {
    for variable in listed {
        let variable = variable as usize;
        let is_in_program = match definitions[variable] {
            Some(VariableDefinition::SyntheticExport { .. }) => is_read[variable],
            // The host stores there, whoever reads it.
            Some(VariableDefinition::MockOfRuntimeModule { .. }) => true,
            Some(VariableDefinition::Unit(_)) | None => false,
        };
        // Both projects list a name that both import.
        if is_in_program && ids[variable].is_none() {
            ids[variable] = Some(VariableId::new(*count));
            *count += 1;
        }
    }
}

fn order_program_layouts(merged: &Merged<'_>, definitions: &Definitions) -> Vec<u32> {
    debug_assert_eq!(definitions.layouts.len(), merged.layouts.keys.len());
    // A merged index is the rank of its key.
    let sites = (0u32..).zip(&definitions.layouts);
    // By unit, as `list_chosen_definitions` orders them, then by key: `order_layout_definitions` says why.
    let defined = sites.clone().filter_map(|(layout, site)| Some(((*site)?, layout)));
    let mut defined: Vec<(DefinitionSite, u32)> = defined.collect();
    defined.sort_by_u64(|&(site, layout)| number_of_pair(site.unit, layout));
    let mut roots: Vec<u32> = defined.into_iter().map(|(_, layout)| layout).collect();
    let without_definition = sites.filter(|(_, site)| site.is_none());
    roots.extend(without_definition.map(|(layout, _)| layout));

    order_layouts(merged.layouts.keys.len(), &roots, &|layout| {
        definitions.bases_of_layouts[layout as usize]
    })
}

/// The roots in their order, but each base ahead of what extends it.
fn order_layouts(
    layout_count: usize,
    roots: &[u32],
    base_of: &dyn Fn(u32) -> Option<u32>,
) -> Vec<u32> {
    let mut is_visited = vec![false; layout_count];
    let mut order = Vec::with_capacity(roots.len());
    let mut chain = Vec::new();
    for &root in roots {
        let mut next = Some(root);
        while let Some(layout) = next
            && !replace(&mut is_visited[layout as usize], true)
        {
            chain.push(layout);
            next = base_of(layout);
        }
        order.extend(chain.drain(..).rev());
    }
    order
}

// By project, then by the number that the graph of the project gives the failure.
fn number_named_failures<'a>(
    named: impl Iterator<Item = (ProjectId, &'a [modules::ModuleFailureId])>,
    count: &mut usize,
) -> PerProject<Vec<Option<ModuleFailureId>>> {
    let mut is_named: PerProject<Vec<bool>> = PerProject::default();
    for (project, failures) in named {
        let marks = match project {
            ProjectId::Application => &mut is_named.application,
            ProjectId::Runtime => &mut is_named.runtime,
        };
        for failure in failures {
            let index = failure.0 as usize;
            if marks.len() <= index {
                marks.resize(index + 1, false);
            }
            marks[index] = true;
        }
    }
    is_named.map(|_, marks| number_marked(&marks, count))
}

fn number_records<I: Id, T>(records: &[(I, T)], ids: &mut [Option<I>], count: &mut usize) {
    for (number, _) in records {
        let id = &mut ids[number.index()];
        debug_assert!(id.is_none(), "two records have one number of the tables");
        *id = Some(I::new(*count));
        *count += 1;
    }
}

// A visit that was thrown away has taken numbers too. No unit holds their records.
// `counts`: of the scopes, the data and the expected results.
fn number_records_of_units(
    units: &[LinkUnit],
    tables: &[LinkTables],
    counts: [&mut usize; 3],
) -> Vec<TableIds> {
    let [eval_scope_count, data_count, expected_result_count] = counts;
    let empty_lists = tables.iter().map(|tables| TableIds {
        eval_scopes: vec![None; tables.lengths.eval_scopes as usize],
        data: vec![None; tables.lengths.data as usize],
        expected_results: vec![None; tables.lengths.expected_results as usize],
        ..TableIds::default()
    });
    let mut table_ids: Vec<TableIds> = empty_lists.collect();
    for unit in units {
        let (ids, records) = (&mut table_ids[unit.tables as usize], &unit.records);
        number_records(&records.eval_scopes, &mut ids.eval_scopes, eval_scope_count);
        number_records(&records.data, &mut ids.data, data_count);
        number_records(
            &records.expected_results,
            &mut ids.expected_results,
            expected_result_count,
        );
    }
    table_ids
}

#[cfg(debug_assertions)]
fn find_first_file_that_names(
    units: &[LinkUnit],
    local_to_merged: &[Vec<u32>],
    merged_index: u32,
) -> Option<ProgramFile> {
    let mut lists = local_to_merged.iter();
    let tables = lists.position(|list| list.contains(&merged_index))?;
    let unit = units.iter().find(|unit| unit.tables as usize == tables)?;
    Some(unit.file)
}

#[cfg(debug_assertions)]
fn has_unit(units: &[LinkUnit], file: ProgramFile) -> bool {
    units.binary_search_by_key(&file, |unit| unit.file).is_ok()
}

// A file that maps an overload names what runs behind it, lowered or not. Only the edge reads that name.
#[cfg(debug_assertions)]
fn mark_sources_of_function_type_edges(merged: &Merged<'_>) -> Vec<bool> {
    let mut is_source = vec![false; merged.functions.keys.len()];
    for unit in merged.units {
        for &(source, _) in &unit.function_type_edges {
            is_source[merged.function(unit, source) as usize] = true;
        }
    }
    is_source
}

#[cfg(debug_assertions)]
fn find_function_without_definition(merged: &Merged<'_>, definitions: &Definitions) -> Option<u32> {
    let is_source_of_edge = mark_sources_of_function_type_edges(merged);
    let mut functions = (0u32..).zip(&merged.functions.keys);
    let found = functions.find(|&(function, key)| {
        let home = ProgramFile {
            project: key.project,
            file: key.key.home_file(),
        };
        definitions.functions[function as usize].is_none()
            && !is_source_of_edge[function as usize]
            && has_unit(merged.units, home)
    });
    found.map(|(function, _)| function)
}

// A file that was lowered defines whatever another file may name of it.
#[cfg(debug_assertions)]
fn stop_at_key_without_definition(merged: &Merged<'_>, definitions: &Definitions) {
    let units = merged.units;
    if let Some(function) = find_function_without_definition(merged, definitions) {
        let key = merged.functions.keys[function as usize];
        let lists = &merged.functions.local_to_merged;
        let file = find_first_file_that_names(units, lists, function);
        panic!("nothing defines {key:?}, which the tables of {file:?} name");
    }
    for (variable, key) in (0u32..).zip(&merged.variables.keys) {
        let ProgramVariableKey::Declared(declared) = key else {
            continue;
        };
        let Some(file) = declared.key.home_file() else {
            continue;
        };
        let home = ProgramFile {
            project: declared.project,
            file,
        };
        if definitions.variables[variable as usize].is_none() && has_unit(units, home) {
            let lists = &merged.variables.local_to_merged;
            let file = find_first_file_that_names(units, lists, variable);
            panic!("nothing defines {key:?}, which the tables of {file:?} name");
        }
    }
}

/// What a unit defines is in the program. The strings, the property keys and the types of the tables get their ids elsewhere.
/// `synthetic_exports`: `synthetic_export_keys`, whose order is that of the ids. `shown_by_export_tables`: `variables_shown_by_export_tables`, in any order.
pub(super) fn number_program(
    merged: &Merged<'_>,
    definitions: &Definitions,
    synthetic_exports: &[ProgramVariableKey],
    shown_by_export_tables: &[ProgramVariableKey],
    beside: Beside<'_>,
) -> Numbering {
    #[cfg(debug_assertions)]
    stop_at_key_without_definition(merged, definitions);

    let (units, tables, modules) = (merged.units, merged.tables, merged.modules);
    let mut counts = ProgramCounts::default();
    let mut steps = StepClock::new(Stage::LinkAndEmit);

    // None of these asks for a number of the others.
    let (function_ids, (table_ids, (variable_ids, (layout_keys, layout_ids)))) = run_steps_beside(
        beside,
        &mut steps,
        [
            "number: functions",
            "number: records of the units, variables, layouts",
        ],
        || {
            let function_order = list_chosen_definitions(
                units,
                |unit| &unit.function_definitions,
                &|unit: &LinkUnit, id| merged.function(unit, id),
                &definitions.functions,
                identity,
            );
            let function_count = merged.functions.keys.len();
            number_in_order::<FunctionId>(function_count, function_order, &mut counts.functions)
        },
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                ["number: records of the units", "number: variables, layouts"],
                || {
                    let counts = [
                        &mut counts.eval_scopes,
                        &mut counts.data,
                        &mut counts.expected_results,
                    ];
                    number_records_of_units(units, tables, counts)
                },
                || {
                    let mut steps = StepClock::new(Stage::LinkAndEmit);
                    run_steps_beside(
                        beside,
                        &mut steps,
                        ["number: variables", "number: layouts"],
                        || {
                            let variable_order = list_chosen_definitions(
                                units,
                                |unit| &unit.variable_definitions,
                                &|unit: &LinkUnit, id| merged.variable(unit, id),
                                &definitions.variables,
                                VariableDefinition::Unit,
                            );
                            let count = &mut counts.variables;
                            let variable_count = merged.variables.keys.len();
                            let mut variable_ids: Vec<Option<VariableId>> =
                                number_in_order(variable_count, variable_order, count);
                            // `merge_keys` has looked each of them up: theirs is the list behind those of the tables.
                            let listed = &merged.variables.local_to_merged[tables.len()];
                            debug_assert_eq!(listed.len(), synthetic_exports.len());
                            number_variables_that_link_defines(
                                listed.iter().copied(),
                                &definitions.variables,
                                &find_variables_that_are_read(merged, shown_by_export_tables),
                                &mut variable_ids,
                                count,
                            );
                            variable_ids
                        },
                        || {
                            let layout_order = order_program_layouts(merged, definitions);
                            let ordered_keys = layout_order.iter();
                            let layout_keys: Vec<ProgramLayoutKey> = ordered_keys
                                .map(|&layout| merged.layouts.keys[layout as usize])
                                .collect();
                            let layout_count = merged.layouts.keys.len();
                            let layout_ids: Vec<Option<LayoutId>> =
                                number_in_order(layout_count, layout_order, &mut counts.layouts);
                            (layout_keys, layout_ids)
                        },
                    )
                },
            )
        },
    );

    counts.modules = modules.modules.len();
    let module_ids: Vec<Option<ModuleId>> = (0..counts.modules)
        .map(|index| Some(ModuleId::new(index)))
        .collect();
    let named_failures = tables
        .iter()
        .map(|tables| (tables.project, &tables.module_failures[..]));
    let module_failure_ids = number_named_failures(named_failures, &mut counts.module_failures);

    let function_lists = &merged.functions.local_to_merged;
    let layout_lists = &merged.layouts.local_to_merged;
    let variable_lists = &merged.variables.local_to_merged;
    let index_by_module = &modules.index_by_module;
    let mut slots: Vec<(usize, TableIds)> = table_ids.into_iter().enumerate().collect();
    for_each_mut(&mut slots, merged.in_parallel, &|(index, ids)| {
        let (index, named) = (*index, &tables[*index]);
        ids.functions = resolve_program_ids(&function_lists[index], &function_ids);
        ids.layouts = resolve_program_ids(&layout_lists[index], &layout_ids);
        ids.variables = resolve_program_ids(&variable_lists[index], &variable_ids);
        let named_modules = named.modules.iter();
        ids.modules = named_modules
            .map(|module| {
                // The program has no record of a file that it does not reach.
                let index = *index_by_module.get(module)?;
                module_ids[index as usize]
            })
            .collect();
        let failure_ids = module_failure_ids.get(named.project);
        let named_failures = named.module_failures.iter();
        ids.module_failures = named_failures
            .map(|failure| failure_ids[failure.0 as usize])
            .collect();
    });
    steps.end("number: ids of the tables");

    Numbering {
        functions: function_ids,
        layouts: layout_ids,
        variables: variable_ids,
        modules: module_ids,
        module_failures: module_failure_ids,
        counts,
        tables: slots.into_iter().map(|(_, ids)| ids).collect(),
        layout_keys,
    }
}

/// Each list is indexed by the program's id.
#[cfg(test)]
pub(crate) struct ProgramKeys {
    pub functions: Vec<ProgramFunctionKey>,
    pub layouts: Vec<ProgramLayoutKey>,
}

#[cfg(test)]
impl ProgramKeys {
    pub(super) fn new(
        functions: &MergedKeys<'_, ProgramFunctionKey>,
        layouts: &MergedKeys<'_, ProgramLayoutKey>,
        numbering: &Numbering,
    ) -> ProgramKeys {
        let counts = &numbering.counts;
        ProgramKeys {
            functions: keys_by_id(&functions.keys, &numbering.functions, counts.functions),
            layouts: keys_by_id(&layouts.keys, &numbering.layouts, counts.layouts),
        }
    }
}

#[cfg(test)]
fn keys_by_id<K: Copy, I: Id>(keys: &[K], ids: &[Option<I>], count: usize) -> Vec<K> {
    assert_eq!(keys.len(), ids.len());
    let mut slots = vec![None; count];
    for (key, id) in keys.iter().zip(ids) {
        if let Some(id) = id {
            slots[id.index()] = Some(*key);
        }
    }
    slots
        .into_iter()
        .map(|slot| slot.expect("program ids are dense"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::state::ExportWriter;
    #[cfg(debug_assertions)]
    use super::super::testing::{
        define_test_function, forward, in_application, prepare, test_function_key, units_in_tasks,
        with_test_files,
    };
    use super::*;
    #[cfg(debug_assertions)]
    use crate::ir::FunctionKey;
    use crate::modules::ModuleFailureId as Failure;
    #[cfg(debug_assertions)]
    use bun_sema::check::aot::FunctionRef;
    #[cfg(debug_assertions)]
    use bun_sema::hir::FnId;

    fn order_by_edges(roots: &[u32], edges: &[(u32, u32)]) -> Vec<u32> {
        order_layouts(roots.len(), roots, &|layout| {
            let own_edge = edges.iter().find(|edge| edge.0 == layout);
            own_edge.map(|edge| edge.1)
        })
    }

    #[test]
    fn bases_precede_roots() {
        assert_eq!(order_by_edges(&[2, 0, 1], &[]), [2, 0, 1]);
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1)]), [1, 0]);
        assert_eq!(order_by_edges(&[0, 1, 2], &[(0, 2), (1, 2)]), [2, 0, 1]);
    }

    #[test]
    fn long_base_chain_is_ordered() {
        let roots: Vec<u32> = (0..10_000).collect();
        let order = order_layouts(roots.len(), &roots, &|layout| (layout + 1..10_000).next());
        assert!(order.iter().rev().eq(&roots));
    }

    #[test]
    fn cycle_lists_each_layout_once() {
        assert_eq!(order_by_edges(&[0, 1], &[(0, 1), (1, 0)]), [1, 0]);
        assert_eq!(order_by_edges(&[1, 0], &[(0, 1), (1, 0)]), [0, 1]);
    }

    #[test]
    fn ids_follow_the_order_and_go_on_counting() {
        let mut count = 5;
        let ids: Vec<Option<FunctionId>> = number_in_order(4, [2, 0], &mut count);
        let id = |index| Some(FunctionId::new(index));
        assert_eq!(ids, [id(6), None, id(5), None]);
        assert_eq!(count, 7);
        assert_eq!(resolve_program_ids(&[2, 1, 2], &ids), [id(5), None, id(5)]);
    }

    fn export_that_loader_fills() -> Option<VariableDefinition> {
        Some(VariableDefinition::SyntheticExport {
            module: 0,
            name: bun_sema::atom::known::default,
            is_known_member: true,
            is_replaceable: false,
            writer: ExportWriter::Loader,
        })
    }

    #[test]
    fn export_that_nothing_reads_has_no_id() {
        let export = export_that_loader_fills();
        let mock = Some(VariableDefinition::MockOfRuntimeModule { module: 0 });
        let definitions = [export, export, None, mock, export];
        let is_read = [true, false, true, false, true];
        let mut ids = [None; 5];
        let mut count = 7;
        let listed = [4, 0, 1, 2, 3, 4].into_iter();
        number_variables_that_link_defines(listed, &definitions, &is_read, &mut ids, &mut count);
        let id = |index| Some(VariableId::new(index));
        assert_eq!(ids, [id(8), None, None, id(9), id(7)]);
        assert_eq!(count, 10);
    }

    #[test]
    fn variable_of_a_unit_keeps_its_id() {
        let site = DefinitionSite { unit: 0, index: 0 };
        let definitions = [Some(VariableDefinition::Unit(site))];
        let mut ids = [Some(VariableId::new(3))];
        let mut count = 4;
        let listed = [0].into_iter();
        number_variables_that_link_defines(listed, &definitions, &[true], &mut ids, &mut count);
        assert_eq!((ids, count), ([Some(VariableId::new(3))], 4));
    }

    #[test]
    fn failures_are_numbered_by_project_whatever_the_order_of_the_tables() {
        let number = |lists: &[(ProjectId, &[Failure])]| {
            let mut count = 0;
            (number_named_failures(lists.iter().copied(), &mut count), count)
        };
        let mut lists: [(ProjectId, &[Failure]); 3] = [
            (ProjectId::Runtime, &[Failure(0)]),
            (ProjectId::Application, &[Failure(3), Failure(1)]),
            (ProjectId::Application, &[Failure(1)]),
        ];
        let (ids, count) = number(&lists);
        let id = |index| Some(ModuleFailureId::new(index));
        assert_eq!(ids.application, [None, id(0), None, id(1)]);
        assert_eq!(ids.runtime, [id(2)]);
        assert_eq!(count, 3);
        lists.reverse();
        assert_eq!(number(&lists), (ids, count));
    }

    #[test]
    fn number_that_no_unit_holds_has_no_id() {
        let mut ids = [None; 4];
        let mut count = 2;
        number_records(&[(DataId::new(3), ()), (DataId::new(0), ())], &mut ids, &mut count);
        number_records(&[(DataId::new(1), ())], &mut ids, &mut count);
        let id = |index| Some(DataId::new(index));
        assert_eq!(ids, [id(3), id(4), None, id(2)]);
        assert_eq!(count, 5);
    }

    #[cfg(debug_assertions)]
    #[test]
    fn function_behind_an_overload_needs_no_definition() {
        with_test_files(|projects, [main, home, _]| {
            let implementation = test_function_key(home.0, 1);
            let overload = FunctionKey::Signature(FunctionRef {
                file: home,
                function: FnId(0),
            });
            let find_gap = |is_below_overload: bool| {
                let units = units_in_tasks(projects, &[&[main, home]], |unit| {
                    unit.define_body(|_| {});
                    if unit.file != main {
                        return;
                    }
                    let (fragment, module) = (&mut unit.fragment, unit.module);
                    let named = fragment.declare_function(implementation);
                    if is_below_overload {
                        let overload = define_test_function(fragment, overload, module, |_| {});
                        fragment.add_function_type_edge(named, overload);
                    }
                });
                let prepared = prepare(units, projects);
                let merged = Merged {
                    units: &prepared.units,
                    tables: &prepared.tables,
                    modules: &prepared.modules,
                    functions: &prepared.functions,
                    layouts: &prepared.layouts,
                    variables: &prepared.variables,
                    in_parallel: &forward,
                };
                let gap = find_function_without_definition(&merged, &prepared.definitions);
                gap.map(|function| prepared.functions.keys[function as usize])
            };
            assert_eq!(find_gap(false), Some(in_application(implementation)));
            assert_eq!(find_gap(true), None);
        });
    }

    #[test]
    fn count_above_the_limit_is_an_error() {
        let with_data = |data: u64| ProgramCounts {
            data: data as usize,
            ..ProgramCounts::default()
        };
        assert!(with_data(MAX_PROGRAM_IDS).check_limit().is_ok());
        let errors = with_data(MAX_PROGRAM_IDS + 1).check_limit().unwrap_err();
        match errors.as_slice() {
            [LinkError::LimitExceeded { limit, count }] => {
                assert_eq!(*limit, LimitId::MaxProgramIds);
                assert_eq!(*count, MAX_PROGRAM_IDS + 1);
            }
            _ => panic!("one count is above the limit: {errors:?}"),
        }
    }

    #[test]
    fn map_leads_to_the_lists() {
        let ids = TableIds {
            functions: vec![None, Some(FunctionId::new(4))],
            ..TableIds::default()
        };
        let map = ids.as_map();
        assert_eq!(map.functions, [None, Some(FunctionId::new(4))]);
        assert!(map.type_sites.is_empty() && map.expected_results.is_empty());
    }
}
