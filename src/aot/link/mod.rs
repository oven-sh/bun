mod beside;
mod body_remap;
mod definitions;
mod entries;
mod fields_of_base_functions;
mod keys;
mod layout_order;
mod literal_slots;
mod marks;
mod module_marks;
mod module_records;
mod module_table;
mod move_definitions;
mod names;
mod numbering;
mod program_keys;
mod property_keys;
mod state;
mod step_times;
mod strings;
#[cfg(test)]
pub(crate) mod testing;
#[cfg(test)]
mod tests;
mod type_hashes;
mod types;
mod unit;
mod united_layouts;
mod unused_records;

pub use beside::Beside;
pub(crate) use beside::{run_beside, run_one_after_the_other};
pub use body_remap::BodyRemap;
pub use names::{ModuleOrigin, ProgramKeys, ProgramNames};
pub use program_keys::{
    InProject, KeyContext, ProgramFunctionKey, ProgramKey, ProgramLayoutKey, ProgramModule,
    ProgramVariableKey, compare_program_modules,
};
pub use state::UnitIds;
pub use unit::LinkUnit;

use crate::builtins::RuntimeFunction;
use crate::ir::{
    InParallel, Program, PropertyKeyTable, StringTable, TypeTable, drop_each, for_each_mut,
};
use crate::load::{PerProject, ProgramFile, ProjectId, SourceKind, Sources};
use crate::modules::{ModuleGraph, Shape};
use crate::statistics::{Counters, LimitId, LimitValues, StatisticId};
use bun_sema::atom::Interner;
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use bun_sema_driver::LoadedProgram;
use definitions::{
    MergeInput, choose_definitions, forget_library_layouts_without_definition,
    synthetic_export_keys,
};
use keys::{MergedKeys, merge_keys};
use marks::{MarkInput, mark};
use module_records::{RecordInput, build_module_records};
use module_table::{collect_module_origins, collect_modules};
use move_definitions::{MoveInput, move_definitions};
use names::NameInput;
use numbering::{NumberingInput, number_program};
use property_keys::merge_property_keys;
use state::{Definitions, ModuleRecords, ModuleTable, ProgramTables, Retained};
use step_times::StepTimes;
use strings::merge_strings;
use types::{
    TypeTableInput, collision_between, intern_prepared_types, merge_types, order_types_by_contents,
    prepare_types,
};
use unit::KeyList;
use united_layouts::{add_views_of_literals, unite_layout_definitions};
use unused_records::{UseInput, mark_unused_records};

#[derive(Copy, Clone)]
pub struct LinkProject<'a, 's> {
    pub loaded: &'a LoadedProgram<'s>,
    pub graph: &'a ModuleGraph,
    pub sources: &'a Sources,
    /// The files that were not lowered because the program does not reach them, in ascending order.
    pub unreached_files: &'a [FileId],
}

pub struct LinkInput<'a, 's> {
    pub units: Vec<LinkUnit>,
    pub projects: PerProject<LinkProject<'a, 's>>,
    pub limits: &'a LimitValues,
    pub in_parallel: InParallel<'a>,
    pub beside: Beside<'a>,
}

/// What link has read for the last time. Nothing waits for the memory, and it takes a while to free.
pub type Leftovers = Box<dyn Send>;

pub struct Linked {
    /// It lists no function: they are in `body_remap`, with the ids of their units.
    pub program: Program,
    pub body_remap: BodyRemap,
    pub names: ProgramNames,
    pub keys: ProgramKeys,
    pub counters: Counters,
    pub leftovers: Leftovers,
}

#[derive(Debug)]
pub enum LinkError {
    UndefinedFunction {
        key: ProgramFunctionKey,
        referenced_in: ProgramFile,
    },
    UndefinedLayout {
        key: ProgramLayoutKey,
        referenced_in: ProgramFile,
    },
    UndefinedVariable {
        key: ProgramVariableKey,
        referenced_in: ProgramFile,
    },
    ConflictingDefinitions {
        key: ProgramKey,
        files: [ProgramFile; 2],
    },
    ConflictingRuntimeFunctions {
        function: RuntimeFunction,
        files: [ProgramFile; 2],
    },
    MissingUnit {
        file: ProgramFile,
    },
    TypeHashCollision {
        files: [ProgramFile; 2],
    },
    LimitExceeded {
        limit: LimitId,
        count: u64,
    },
}

fn key_context<'a>(
    projects: &PerProject<LinkProject<'a, '_>>,
    project: ProjectId,
) -> KeyContext<'a> {
    KeyContext {
        project,
        graph: projects.get(project).graph,
        runtime_sources: projects.runtime.sources,
    }
}

struct ResolvedKeys {
    units: Vec<LinkUnit>,
    modules: ModuleTable,
    functions: MergedKeys<ProgramFunctionKey>,
    layouts: MergedKeys<ProgramLayoutKey>,
    variables: MergedKeys<ProgramVariableKey>,
    definitions: Definitions,
    retained: Retained,
}

pub fn link(input: LinkInput<'_, '_>) -> Result<Linked, Vec<LinkError>> {
    let in_parallel = input.in_parallel;
    let mut linked = link_while(input, &mut |_| {})?;
    let body_remap = core::mem::take(&mut linked.body_remap);
    linked.program.functions = body_remap.into_program_functions(in_parallel);
    Ok(linked)
}

/// Calls `meanwhile` with the keys of the program, once, on the calling thread, unless link fails first.
pub fn link_while(
    input: LinkInput<'_, '_>,
    meanwhile: &mut dyn FnMut(&ProgramKeys),
) -> Result<Linked, Vec<LinkError>> {
    let LinkInput {
        units,
        projects,
        limits,
        in_parallel,
        beside,
    } = input;
    let atoms = &projects.application.loaded.files().atoms;
    let mut times = StepTimes::new();
    let ResolvedKeys {
        mut units,
        modules,
        functions,
        layouts,
        variables,
        definitions,
        mut retained,
    } = resolve_keys(units, &projects, limits, in_parallel, beside, &mut times)?;

    let (mut numbering, (merged_strings, merged_types)) = run_beside(
        beside,
        || {
            number_program(NumberingInput {
                units: &units,
                functions: &functions,
                layouts: &layouts,
                variables: &variables,
                definitions: &definitions,
                retained: &retained,
                modules: &modules,
                strings: vec![Vec::new(); units.len()],
                types: vec![Vec::new(); units.len()],
                in_parallel,
            })
        },
        || {
            run_beside(
                beside,
                || merge_strings(&units, &retained.units, in_parallel),
                || merge_types(&units, &retained.units, in_parallel),
            )
        },
    );
    let mut strings = merged_strings.table;
    let merged_ids = merged_strings
        .local_to_program
        .into_iter()
        .zip(merged_types.types);
    for (ids, (string_ids, type_ids)) in numbering.units.iter_mut().zip(merged_ids) {
        ids.strings = string_ids;
        ids.types = type_ids;
    }
    let mut type_representatives = merged_types.type_representatives;
    order_types_by_contents(
        &units,
        &mut numbering.units,
        &mut type_representatives,
        in_parallel,
    );
    for_each_mut(
        &mut units,
        in_parallel,
        &LinkUnit::release_hashes_of_strings_and_types,
    );
    times.end_step(StatisticId::LinkMergeStringsAndTypesNanoseconds);

    // No type names a property key.
    let (merged_property_keys, (keys, prepared_types)) = run_beside(
        beside,
        || merge_property_keys(&units, &retained.units, &numbering.units, in_parallel),
        || {
            run_beside(
                beside,
                || ProgramKeys::new(&functions, &layouts, &variables, &modules, &numbering),
                || {
                    prepare_types(&TypeTableInput {
                        units: &units,
                        type_representatives: &type_representatives,
                        ids: &numbering.units,
                        marks: &retained.units,
                        in_parallel,
                    })
                },
            )
        },
    );
    let unit_ids = numbering.units.iter_mut();
    for (ids, property_keys) in unit_ids.zip(merged_property_keys.local_to_program) {
        ids.property_keys = property_keys;
    }
    times.end_step(StatisticId::LinkMergePropertyKeysNanoseconds);
    let prepared_types = prepared_types.map_err(|error| vec![error])?;
    times.end_step(StatisticId::LinkBuildTypeTableNanoseconds);

    let (types, mut tables) = run_beside(
        beside,
        || intern_prepared_types(prepared_types),
        || {
            move_definitions(
                &mut units,
                &MoveInput {
                    functions: &functions,
                    layouts: &layouts,
                    variables: &variables,
                    definitions: &definitions,
                    retained: &retained,
                    numbering: &numbering,
                    atoms,
                    in_parallel,
                    beside,
                },
                &mut strings,
            )
        },
    );
    let mut types =
        types.map_err(|places| vec![collision_between(&units, &type_representatives, places)])?;
    let unit_marks = core::mem::take(&mut retained.units);
    // The records of the modules name no layout and no type, and the layouts are united without a look at a unit or a string.
    let (views, records) = run_beside(
        beside,
        || {
            let defined = &mut tables.layouts;
            let other_definitions = core::mem::take(&mut tables.other_layout_definitions);
            let views =
                unite_layout_definitions(defined, other_definitions, &mut types, in_parallel);
            fields_of_base_functions::take_fields_of_base_functions(defined, &keys.layouts);
            views
        },
        || {
            let build_records = || {
                build_module_records(
                    &mut units,
                    &RecordInput {
                        projects: &projects,
                        atoms,
                        modules: &modules,
                        functions: &functions,
                        variables: &variables,
                        definitions: &definitions,
                        numbering: &numbering,
                    },
                    &mut strings,
                )
            };
            run_beside(beside, build_records, || meanwhile(&keys)).0
        },
    );
    run_beside(
        beside,
        || {
            let defined = &mut tables.layouts;
            let uses = UseInput {
                units: &units,
                numbering: &numbering,
                property_keys: &merged_property_keys.table,
                strings: &strings,
                in_parallel,
            };
            mark_unused_records(defined, &uses);
            literal_slots::widen_literal_slots(defined, &uses, &types);
            add_views_of_literals(defined, views);
        },
        || drop_each(unit_marks, in_parallel),
    );
    times.end_step(StatisticId::LinkMoveDefinitionsNanoseconds);

    let name_tables = (strings, merged_property_keys.table, types);
    let functions_by_unit = core::mem::take(&mut tables.functions_by_unit);
    let body_remap = BodyRemap::new(core::mem::take(&mut numbering.units), functions_by_unit);
    let program = create_program(name_tables, tables, records);
    let module_origins = collect_module_origins(&projects, &modules, &numbering);
    count_definitions(&definitions, &retained, &mut times.counters);
    count_module_forms(&projects, &modules, &mut times.counters);
    let names = ProgramNames::new(NameInput {
        program: &program,
        functions: &body_remap,
        module_origins,
        beside,
    });
    times.end_step(StatisticId::LinkNameProgramNanoseconds);
    Ok(Linked {
        program,
        body_remap,
        names,
        keys,
        counters: times.counters,
        leftovers: Box::new((units, numbering, retained, functions, layouts, variables)),
    })
}

fn create_program(
    (strings, property_keys, types): (StringTable, PropertyKeyTable, TypeTable),
    tables: ProgramTables,
    records: ModuleRecords,
) -> Program {
    Program {
        strings,
        property_keys,
        types,
        type_sites: tables.type_sites,
        expected_results: tables.expected_results,
        layouts: tables.layouts,
        variables: tables.variables,
        modules: records.modules,
        module_failures: records.module_failures,
        eval_scopes: tables.eval_scopes,
        functions: Vec::new(),
        data: tables.data,
        entries: records.entries,
        runtime_functions: records.runtime_functions,
        web_assembly_modules: records.web_assembly_modules,
    }
}

fn resolve_keys(
    units: Vec<LinkUnit>,
    projects: &PerProject<LinkProject<'_, '_>>,
    limits: &LimitValues,
    in_parallel: InParallel<'_>,
    beside: Beside<'_>,
    times: &mut StepTimes,
) -> Result<ResolvedKeys, Vec<LinkError>> {
    let atoms: &Interner<'_> = &projects.application.loaded.files().atoms;
    let mut units = order_units(units, projects)?;
    check_limits(&units, projects, limits)?;
    let ((modules, synthetic_exports), (functions, layouts)) = run_beside(
        beside,
        || {
            let modules = collect_modules(projects, &units, atoms);
            (modules, synthetic_export_keys(projects))
        },
        || {
            let functions = collect_key_lists(&units, |unit| &unit.functions);
            let layouts = collect_key_lists(&units, |unit| &unit.layouts);
            (
                merge_keys(&functions, in_parallel),
                merge_keys(&layouts, in_parallel),
            )
        },
    );
    forget_library_layouts_without_definition(&mut units, &layouts);
    let mut variable_lists = collect_key_lists(&units, |unit| &unit.variables);
    variable_lists.push(&synthetic_exports);
    let variables = merge_keys(&variable_lists, in_parallel);
    times.end_step(StatisticId::LinkMergeKeysNanoseconds);

    let mut errors = Vec::new();
    let definitions = choose_definitions(
        &MergeInput {
            units: &units,
            projects,
            modules: &modules,
            functions: &functions,
            layouts: &layouts,
            variables: &variables,
            in_parallel,
            beside,
        },
        &mut errors,
    );
    times.end_step(StatisticId::LinkChooseDefinitionsNanoseconds);
    let retained = mark(
        &MarkInput {
            units: &units,
            projects,
            modules: &modules,
            functions: &functions,
            layouts: &layouts,
            variables: &variables,
            definitions: &definitions,
            in_parallel,
        },
        &mut errors,
    );
    times.end_step(StatisticId::LinkMarkNanoseconds);
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(ResolvedKeys {
        units,
        modules,
        functions,
        layouts,
        variables,
        definitions,
        retained,
    })
}

fn collect_key_lists<K>(
    units: &[LinkUnit],
    key_list: fn(&LinkUnit) -> &KeyList<K>,
) -> Vec<&KeyList<K>> {
    units.iter().map(key_list).collect()
}

fn compiled_files(projects: &PerProject<LinkProject<'_, '_>>) -> Vec<ProgramFile> {
    let mut files = Vec::new();
    for project in ProjectId::ALL {
        let compiled = projects.get(project).loaded.files().compiled_files().iter();
        let first = files.len();
        files.extend(compiled.map(|&file| ProgramFile { project, file }));
        files[first..].sort_unstable();
    }
    files
}

// The lower stage leaves out a constant text that has an early error, and what the program does not reach.
fn is_unit_optional(projects: &PerProject<LinkProject<'_, '_>>, file: ProgramFile) -> bool {
    let project = projects.get(file.project);
    if project.unreached_files.binary_search(&file.file).is_ok() {
        return true;
    }
    matches!(project.sources.kind(file.file), SourceKind::EvaluatedText)
}

fn order_units(
    mut units: Vec<LinkUnit>,
    projects: &PerProject<LinkProject<'_, '_>>,
) -> Result<Vec<LinkUnit>, Vec<LinkError>> {
    units.shared_sort_unstable_by_key(|unit| unit.file);
    let mut errors = Vec::new();
    let has_unit = |file: ProgramFile| units.binary_search_by_key(&file, |unit| unit.file).is_ok();
    let expected_files = compiled_files(projects).into_iter();
    let expected_files =
        expected_files.filter(|&file| !is_unit_optional(projects, file) || has_unit(file));
    let mut compiled_files = expected_files.peekable();
    for unit in &units {
        let file = unit.file;
        while let Some(missing) = compiled_files.next_if(|&compiled| compiled < file) {
            errors.push(LinkError::MissingUnit { file: missing });
        }
        if compiled_files.next_if_eq(&file).is_none() {
            errors.push(LinkError::ConflictingDefinitions {
                key: ProgramKey::Module(ProgramModule::File(file)),
                files: [file, file],
            });
        }
    }
    errors.extend(compiled_files.map(|file| LinkError::MissingUnit { file }));
    match errors.is_empty() {
        true => Ok(units),
        false => Err(errors),
    }
}

fn check_limits(
    units: &[LinkUnit],
    projects: &PerProject<LinkProject<'_, '_>>,
    limits: &LimitValues,
) -> Result<(), Vec<LinkError>> {
    let sum = |local_count: fn(&LinkUnit) -> usize| -> u64 {
        units.iter().map(|unit| local_count(unit) as u64).sum()
    };
    // Each can have a copy.
    let synthetic_export_counts = projects
        .iter()
        .map(|(_, project)| 2 * project.graph.synthetic_exports().len() as u64);
    let counts = [
        sum(|unit| unit.functions.keys.len()),
        sum(|unit| unit.layouts.keys.len()),
        sum(|unit| unit.variables.keys.len()) + synthetic_export_counts.sum::<u64>(),
        sum(|unit| unit.strings.len()),
        sum(|unit| unit.property_keys.len()),
        sum(|unit| unit.types.len()),
        sum(|unit| unit.records.type_sites.len()),
        sum(|unit| unit.records.expected_results.len()),
        sum(|unit| unit.records.eval_scopes.len()),
        sum(|unit| unit.records.data.len()),
    ];
    let limit = LimitId::MaxProgramIds;
    let maximum = limits.get(limit);
    match counts.into_iter().find(|&count| count > maximum) {
        Some(count) => Err(vec![LinkError::LimitExceeded { limit, count }]),
        None => Ok(()),
    }
}

fn count_module_forms(
    projects: &PerProject<LinkProject<'_, '_>>,
    modules: &ModuleTable,
    counters: &mut Counters,
) {
    let (mut with_names, mut with_value, mut faces) = (0, 0, 0);
    for &module in &modules.modules {
        let (project, own) = match module {
            ProgramModule::File(_) | ProgramModule::Inner { .. } => module
                .in_own_project()
                .expect("the module has its text in a file"),
            ProgramModule::Face(_) => {
                faces += 1;
                continue;
            }
            _ => continue,
        };
        match projects.get(project).graph.shape(own) {
            Shape::Names => with_names += 1,
            Shape::Value => with_value += 1,
            Shape::EsModule | Shape::AsToday => {}
        }
    }
    counters.count(StatisticId::ModulesWithNames, with_names);
    counters.count(StatisticId::ModulesWithValue, with_value);
    counters.count(StatisticId::Faces, faces);
}

fn count_definitions(definitions: &Definitions, retained: &Retained, counters: &mut Counters) {
    let functions = definitions.functions.iter().zip(&retained.functions);
    let dropped_functions =
        functions.filter(|(definition, is_retained)| definition.is_some() && !**is_retained);
    counters.count(
        StatisticId::FunctionsDroppedByLink,
        dropped_functions.count() as u64,
    );
    counters.count(
        StatisticId::ConversionsOutsideFamily,
        definitions.conversions_outside_family.len() as u64,
    );
}
