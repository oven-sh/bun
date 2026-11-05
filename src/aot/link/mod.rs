mod beside;
mod definitions;
mod entries;
mod fields_of_base_functions;
mod grouped;
mod linked_functions;
mod literal_slots;
mod merge_property_keys;
mod merge_strings;
mod merge_types;
mod merged_keys;
mod module_records;
mod module_table;
mod move_records;
mod numbering;
mod program_keys;
mod state;
mod tables;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
mod unit;
mod united_layouts;
mod unused_records;

pub use beside::Beside;
pub(crate) use beside::{run_beside, run_one_after_the_other, run_steps_beside};
pub use linked_functions::{FunctionsOfUnit, LinkedFunctions};
pub use numbering::TableIds;
pub use program_keys::{
    InProject, KeyContext, ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey,
    compare_program_modules,
};
pub use unit::LinkUnit;

use crate::ir::generated::{ModuleFlags, VariableFlags};
use crate::ir::{InParallel, Program, TypeTable};
use crate::load::{PerProject, ProgramFile, ProjectId, Sources};
use crate::modules::ModuleGraph;
use crate::statistics::{LimitId, Stage, StepClock};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use bun_sema_driver::LoadedProgram;
use definitions::{
    choose_definitions, forget_library_layouts_without_definition, order_layout_definitions,
    relate_functions, relate_layouts, synthetic_export_keys,
};
use merge_property_keys::merge_property_keys;
use merge_strings::order_strings;
use merge_types::{
    NamesOfRecords, find_alike_types, make_type_records, merge_types, sort_types_by_height,
};
use merged_keys::{Merged, MergedKeys, merge_keys};
use module_records::{RecordInput, build_module_records, variables_shown_by_export_tables};
use module_table::collect_modules;
use move_records::{make_synthetic_export_variables, move_records};
#[cfg(test)]
use numbering::ProgramKeys;
use numbering::{check_count_of_ids, number_program};
use tables::{LinkTables, collect_tables};
use united_layouts::{add_views_of_literals, unite_layout_definitions};
use unused_records::{UseInput, mark_unused_records};

#[derive(Copy, Clone)]
pub struct LinkProject<'a, 's> {
    pub loaded: &'a LoadedProgram<'s>,
    pub graph: &'a ModuleGraph,
    pub sources: &'a Sources,
    pub unreached_files: &'a [FileId],
}

pub(crate) type Projects<'a, 's> = PerProject<LinkProject<'a, 's>>;

pub struct LinkInput<'a, 's> {
    pub units: Vec<LinkUnit>,
    pub projects: PerProject<LinkProject<'a, 's>>,
    pub in_parallel: InParallel<'a>,
    pub beside: Beside<'a>,
}

pub type Leftovers = Box<dyn Send>;

pub struct Linked {
    pub program: Program,
    pub functions: LinkedFunctions,
    pub modules: Vec<ProgramModule>,
    pub leftovers: Leftovers,
    #[cfg(test)]
    pub(crate) keys: ProgramKeys,
}

#[derive(Debug)]
pub enum LinkError {
    LimitExceeded { limit: LimitId, count: u64 },
}

fn key_context<'a>(projects: &Projects<'a, '_>, project: ProjectId) -> KeyContext<'a> {
    KeyContext {
        project,
        graph: projects.get(project).graph,
        runtime_sources: projects.runtime.sources,
    }
}

fn describe_tables(units: &[LinkUnit], tables: &[LinkTables]) -> String {
    let sum = |length_of: fn(&LinkTables) -> u32| -> u64 {
        tables
            .iter()
            .map(|tables| u64::from(length_of(tables)))
            .sum()
    };
    let most_types = tables.iter().map(|tables| tables.lengths.types).max();
    format!(
        "collect tables: {} units, {} sets of tables, the largest of {} types, in all of them {} strings, {} property keys, {} types, {} functions, {} layouts, {} variables",
        units.len(),
        tables.len(),
        most_types.unwrap_or(0),
        sum(|tables| tables.lengths.strings),
        sum(|tables| tables.lengths.property_keys),
        sum(|tables| tables.lengths.types),
        sum(|tables| tables.lengths.functions),
        sum(|tables| tables.lengths.layouts),
        sum(|tables| tables.lengths.variables),
    )
}

type KeysOfTables<'a> = (
    Vec<ProgramVariableKey>,
    MergedKeys<'a, ProgramVariableKey>,
    MergedKeys<'a, ProgramFunctionKey>,
    MergedKeys<'a, ProgramLayoutKey>,
);

fn merge_keys_of_tables<'a>(
    tables: &[LinkTables],
    projects: &Projects<'a, '_>,
    in_parallel: InParallel<'_>,
    beside: Beside<'_>,
) -> KeysOfTables<'a> {
    let atoms = &projects.application.loaded.files().atoms;
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let ((synthetic_exports, variables), (functions, layouts)) = run_steps_beside(
        beside,
        &mut steps,
        ["merge keys of variables", "of functions, layouts"],
        || {
            let synthetic_exports = synthetic_export_keys(projects);
            let mut variable_lists = collect_key_lists(tables, |tables| &tables.variables);
            variable_lists.push(&synthetic_exports);
            let variables = merge_keys(&variable_lists, atoms, in_parallel);
            (synthetic_exports, variables)
        },
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                ["merge keys of functions", "of layouts"],
                || {
                    let functions = collect_key_lists(tables, |tables| &tables.functions);
                    merge_keys(&functions, atoms, in_parallel)
                },
                || {
                    let layouts = collect_key_lists(tables, |tables| &tables.layouts);
                    merge_keys(&layouts, atoms, in_parallel)
                },
            )
        },
    );
    (synthetic_exports, variables, functions, layouts)
}

pub fn link(input: LinkInput<'_, '_>) -> Result<Linked, Vec<LinkError>> {
    let LinkInput {
        units,
        projects,
        in_parallel,
        beside,
    } = input;
    let atoms = &projects.application.loaded.files().atoms;
    let mut steps = StepClock::new(Stage::LinkAndEmit);
    let mut units = order_units(units);
    let tables = collect_tables(&mut units, &projects, in_parallel);
    if steps.logs() {
        steps.end(&describe_tables(&units, &tables));
    }
    let ((ordered_strings, string_ids), (types_by_height, of_keys)) = run_steps_beside(
        beside,
        &mut steps,
        [
            "order and ids of strings",
            "heights of types, modules, keys",
        ],
        || {
            let strings = order_strings(&tables, in_parallel);
            let ids = strings.list_ids(in_parallel);
            (strings, ids)
        },
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                ["heights of types", "modules, keys"],
                || sort_types_by_height(&tables, in_parallel),
                || {
                    let mut steps = StepClock::new(Stage::LinkAndEmit);
                    run_steps_beside(
                        beside,
                        &mut steps,
                        ["list modules", "merge keys"],
                        || {
                            let modules = collect_modules(&projects, &units, &tables);
                            let shown =
                                variables_shown_by_export_tables(&projects, atoms, &modules);
                            (modules, shown)
                        },
                        || merge_keys_of_tables(&tables, &projects, in_parallel, beside),
                    )
                },
            )
        },
    );
    let ((modules, shown_by_export_tables), keys_of_tables) = of_keys;
    let (synthetic_exports, variables, functions, layouts) = keys_of_tables;

    let (alike_types, (mut strings, of_keys)) = run_steps_beside(
        beside,
        &mut steps,
        [
            "types that are alike",
            "table of strings, definitions, numbers",
        ],
        || {
            let names = NamesOfRecords {
                strings: &string_ids,
                layouts: &layouts.local_to_merged,
                functions: &functions.local_to_merged,
            };
            find_alike_types(&tables, &types_by_height, names, in_parallel)
        },
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                ["table of strings", "definitions, numbers"],
                || ordered_strings.make_table(in_parallel),
                || {
                    let mut steps = StepClock::new(Stage::LinkAndEmit);
                    forget_library_layouts_without_definition(
                        &mut units,
                        &tables,
                        &layouts,
                        in_parallel,
                    );
                    steps.end("forget library layouts");
                    order_layout_definitions(&mut units, in_parallel);
                    steps.end("order the definitions of layouts");

                    let merged = Merged {
                        units: &units,
                        tables: &tables,
                        modules: &modules,
                        functions: &functions,
                        layouts: &layouts,
                        variables: &variables,
                        in_parallel,
                    };
                    let definitions = choose_definitions(&merged, &projects, beside);
                    steps.end("choose definitions");
                    let numbering = number_program(
                        &merged,
                        &definitions,
                        &synthetic_exports,
                        &shown_by_export_tables,
                        beside,
                    );
                    steps.end("number the program");
                    (definitions, numbering)
                },
            )
        },
    );
    drop(ordered_strings);
    let (mut definitions, mut numbering) = of_keys;
    numbering.counts.check_limit()?;
    check_count_of_ids(strings.len())?;
    store_ids(&mut numbering.tables, string_ids, |ids| &mut ids.strings);

    let synthetic_exports =
        make_synthetic_export_variables(&definitions, &numbering, atoms, &mut strings);
    steps.end("variables of synthetic exports");

    let merged = Merged {
        units: &units,
        tables: &tables,
        modules: &modules,
        functions: &functions,
        layouts: &layouts,
        variables: &variables,
        in_parallel,
    };
    let (related_layouts, (related_functions, (mut records, of_keys_and_types))) = run_steps_beside(
        beside,
        &mut steps,
        [
            "families of layouts",
            "types of functions, records of modules, property keys, types",
        ],
        || relate_layouts(&merged, &definitions.bases_of_layouts),
        || {
            let mut steps = StepClock::new(Stage::LinkAndEmit);
            run_steps_beside(
                beside,
                &mut steps,
                [
                    "types of functions, members of built-ins",
                    "records of modules, property keys, types",
                ],
                || relate_functions(&merged),
                || {
                    let mut steps = StepClock::new(Stage::LinkAndEmit);
                    run_steps_beside(
                        beside,
                        &mut steps,
                        ["records of modules", "property keys and types"],
                        || {
                            build_module_records(
                                &units,
                                &RecordInput {
                                    projects: &projects,
                                    atoms,
                                    modules: &modules,
                                    functions: &functions,
                                    variables: &variables,
                                    definitions: &definitions,
                                    numbering: &numbering,
                                    in_parallel,
                                },
                                &mut strings,
                            )
                        },
                        || {
                            let mut steps = StepClock::new(Stage::LinkAndEmit);
                            run_steps_beside(
                                beside,
                                &mut steps,
                                ["merge property keys", "merge types"],
                                || merge_property_keys(&tables, &numbering.tables, in_parallel),
                                || {
                                    let ids = &numbering.tables;
                                    let heights = &types_by_height;
                                    merge_types(&tables, heights, alike_types, ids, in_parallel)
                                },
                            )
                        },
                    )
                },
            )
        },
    );
    let ((property_keys, property_key_ids), (merged_types, type_ids)) = of_keys_and_types;
    definitions.add_related_layouts(related_layouts);
    definitions.add_related_functions(related_functions);
    records.take_positions_from(&mut units);
    check_count_of_ids(merged_types.count)?;
    check_count_of_ids(property_keys.len())?;
    store_ids(&mut numbering.tables, type_ids, |ids| &mut ids.types);
    store_ids(&mut numbering.tables, property_key_ids, |ids| {
        &mut ids.property_keys
    });

    let (mut types, mut program_tables) = run_steps_beside(
        beside,
        &mut steps,
        ["records and table of types", "move records"],
        || {
            let ids = &numbering.tables;
            let records = make_type_records(&tables, &merged_types, ids, in_parallel);
            TypeTable::of_distinct_types(records, in_parallel)
        },
        || {
            move_records(
                &mut units,
                &functions,
                &layouts,
                &variables,
                &definitions,
                &numbering,
                synthetic_exports,
                in_parallel,
                beside,
            )
        },
    );

    let defined = &mut program_tables.layouts;
    let other_definitions = core::mem::take(&mut program_tables.other_layout_definitions);
    let views = unite_layout_definitions(defined, other_definitions, &mut types, in_parallel);
    let keys = &numbering.layout_keys;
    fields_of_base_functions::take_fields_of_base_functions(defined, keys, in_parallel);
    steps.end("unite layouts");
    let defined = &mut program_tables.layouts;
    let uses = UseInput {
        units: &units,
        numbering: &numbering,
        property_keys: &property_keys,
        strings: &strings,
        in_parallel,
    };
    mark_unused_records(defined, &uses);
    literal_slots::widen_literal_slots(defined, &uses, &types);
    steps.end("mark unused records, widen slots of literals");
    add_views_of_literals(defined, views);
    let data = &program_tables.data;
    literal_slots::expect_fields_filled_with_other_data(defined, data, &types, in_parallel);
    steps.end("views of literals, fields filled with other data");

    for module in &records.modules {
        if let Some(exports) = module.exports_variable
            && module.flags.contains(ModuleFlags::MAY_BE_MOCKED)
        {
            program_tables.variables[exports.to_word() as usize].flags |=
                VariableFlags::IS_REPLACEABLE;
        }
    }
    #[cfg(test)]
    let keys = ProgramKeys::new(&functions, &layouts, &numbering);
    let linked_functions = LinkedFunctions::new(
        core::mem::take(&mut numbering.tables),
        program_tables.functions,
    );
    let program = Program {
        strings,
        property_keys,
        types,
        type_sites: Vec::new(),
        expected_results: program_tables.expected_results,
        layouts: program_tables.layouts,
        variables: program_tables.variables,
        modules: records.modules,
        module_failures: records.module_failures,
        ambiguous_exports: records.ambiguous_exports,
        source_stamps: Vec::new(),
        eval_scopes: program_tables.eval_scopes,
        functions: Vec::new(),
        data: program_tables.data,
        entries: records.entries,
        runtime_functions: records.runtime_functions,
        web_assembly_modules: records.web_assembly_modules,
        replaceable_builtins: Vec::new(),
        opened_names: Vec::new(),
        builtins_used_at_start: Vec::new(),
    };
    steps.end("functions, program");
    Ok(Linked {
        program,
        functions: linked_functions,
        modules: modules.modules,
        leftovers: Box::new((
            units,
            tables,
            into_owned_lists(functions),
            into_owned_lists(layouts),
            into_owned_lists(variables),
            numbering,
            definitions,
            types_by_height,
            merged_types,
        )),
        #[cfg(test)]
        keys,
    })
}

fn collect_key_lists<K>(tables: &[LinkTables], keys_of: fn(&LinkTables) -> &Vec<K>) -> Vec<&[K]> {
    let lists = tables.iter();
    lists.map(|tables| keys_of(tables).as_slice()).collect()
}

fn store_ids<I>(
    tables: &mut [TableIds],
    lists: Vec<Vec<Option<I>>>,
    list_of: fn(&mut TableIds) -> &mut Vec<Option<I>>,
) {
    assert_eq!(tables.len(), lists.len());
    for (ids, list) in tables.iter_mut().zip(lists) {
        *list_of(ids) = list;
    }
}

fn into_owned_lists<K>(merged: MergedKeys<'_, K>) -> (Vec<K>, Vec<Vec<u32>>) {
    (merged.keys, merged.local_to_merged)
}

fn is_unit_optional(projects: &Projects<'_, '_>, file: ProgramFile) -> bool {
    let project = projects.get(file.project);
    project.unreached_files.binary_search(&file.file).is_ok()
}

fn order_units(mut units: Vec<LinkUnit>) -> Vec<LinkUnit> {
    units.shared_sort_unstable_by_key(|unit| unit.file);
    assert!(
        units.is_sorted_by(|first, second| first.file < second.file),
        "a file has one unit"
    );
    units
}
