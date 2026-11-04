use super::program_keys::{
    KeyContext, ProgramFunctionKey, ProgramLayoutKey, ProgramModule, ProgramVariableKey,
};
use super::unit::LinkUnit;
use super::{Projects, key_context};
use crate::ir::parallel::map_each;
use crate::ir::{InParallel, PropertyKeyTable, StringTable, TypeTable};
use crate::load::ProjectId;
use crate::lower::{SharedTables, TableLengths, UnitTables};
use crate::modules;
use rustc_hash::FxHashMap;
use std::collections::hash_map::Entry;
use std::sync::Arc;

/// The tables that the files of one checker task were written under. Which files share tables depends on thread scheduling,
/// so nothing that reaches the program may depend on an index into these lists or on the position of these tables among all tables.
pub(super) struct LinkTables {
    pub project: ProjectId,
    pub strings: StringTable,
    pub property_keys: PropertyKeyTable,
    pub types: TypeTable,
    pub functions: Vec<ProgramFunctionKey>,
    pub layouts: Vec<ProgramLayoutKey>,
    pub variables: Vec<ProgramVariableKey>,
    pub modules: Vec<ProgramModule>,
    pub module_failures: Vec<modules::ModuleFailureId>,
    /// Nothing at or past these lengths is read. The lists above end there.
    pub lengths: TableLengths,
}

struct TaskTables {
    project: ProjectId,
    tables: Box<UnitTables>,
    /// `TableLengths::max` over the units that hold the tables.
    lengths: TableLengths,
    /// How many units hold the tables.
    unit_count: u32,
    /// `SharedTables::count_noted_commits`
    noted_commits: Option<u32>,
}

/// One entry for each set of tables that a unit holds, in the order of the first unit that holds it. Sets `LinkUnit::tables`.
fn take_tables_of_units(units: &mut [LinkUnit]) -> Vec<TaskTables> {
    assert!(
        units.len() <= u32::MAX as usize,
        "a set of tables has a 32-bit number"
    );
    // Lookup only, never iterated: an address tells one set from another and carries no order.
    let mut numbers: FxHashMap<*const SharedTables, u32> = FxHashMap::default();
    let mut sets: Vec<TaskTables> = Vec::new();
    for unit in units {
        let number = match numbers.entry(Arc::as_ptr(&unit.shared)) {
            Entry::Occupied(entry) => *entry.get(),
            Entry::Vacant(entry) => {
                sets.push(TaskTables {
                    project: unit.file.project,
                    tables: unit.shared.take(),
                    lengths: TableLengths::default(),
                    unit_count: 0,
                    noted_commits: unit.shared.count_noted_commits(),
                });
                *entry.insert(sets.len() as u32 - 1)
            }
        };
        let set = &mut sets[number as usize];
        assert_eq!(
            set.project, unit.file.project,
            "a checker task visits the files of one project"
        );
        set.lengths = set.lengths.max(unit.lengths);
        set.unit_count += 1;
        unit.tables = number;
    }
    // The next task of a thread cuts the tables back to the last commit that was noted. Behind a commit that nobody noted it would give the numbers of a unit out again.
    assert!(
        sets.iter()
            .all(|set| set.noted_commits.is_none_or(|noted| set.unit_count <= noted)),
        "a unit is written under tables that several tasks share, and its commit was not noted"
    );
    sets
}

fn convert_keys<K, P>(mut keys: Vec<K>, length: u32, convert: impl Fn(K) -> P) -> Vec<P> {
    keys.truncate(length as usize);
    keys.into_iter().map(convert).collect()
}

fn create_link_tables(context: &KeyContext<'_>, set: TaskTables) -> LinkTables {
    let TaskTables {
        project,
        tables,
        lengths,
        ..
    } = set;
    assert_eq!(
        tables.lengths().max(lengths),
        tables.lengths(),
        "tables are at least as long as the lengths of their units"
    );
    let UnitTables {
        mut strings,
        mut property_keys,
        mut types,
        function_keys,
        layout_keys,
        variable_keys,
        module_keys,
        mut module_failure_keys,
        eval_scope_count: _,
        data_count: _,
        expected_result_count: _,
    } = *tables;
    // Entries past the lengths were added by a discarded visit, so they depend on thread scheduling.
    strings.truncate(lengths.strings as usize);
    property_keys.truncate(lengths.property_keys as usize);
    types.truncate(lengths.types as usize);
    module_failure_keys.truncate(lengths.module_failures as usize);
    LinkTables {
        project,
        strings,
        property_keys,
        types,
        functions: convert_keys(function_keys, lengths.functions, |key| context.function_key(key)),
        layouts: convert_keys(layout_keys, lengths.layouts, |key| context.layout_key(key)),
        variables: convert_keys(variable_keys, lengths.variables, |key| context.variable_key(key)),
        modules: convert_keys(module_keys, lengths.modules, |module| context.module(module)),
        module_failures: module_failure_keys,
        lengths,
    }
}

/// `units` must be in file order. A set of tables gets its number from the first unit that holds it, and each of its lists is cut at
/// `lengths`, the `max` over its units. The tables are moved out of the units' `SharedTables`, so units can be passed in only once.
pub(super) fn collect_tables(
    units: &mut [LinkUnit],
    projects: &Projects<'_, '_>,
    in_parallel: InParallel<'_>,
) -> Vec<LinkTables> {
    debug_assert!(units.is_sorted_by_key(|unit| unit.file));
    let contexts = projects
        .as_ref()
        .map(|project, _| key_context(projects, project));
    let sets = take_tables_of_units(units);
    map_each(sets, in_parallel, &|set: TaskTables| {
        create_link_tables(contexts.get(set.project), set)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{PropertyKey, Type};
    use crate::link::testing::{
        TaskState, TestUnit, forward, in_application, key_in, reverse, test_class_key,
        test_function_key, test_variable_key, unit_in, units_in_tasks, with_test_files,
    };
    use crate::load::ProgramFile;
    use bun_sema::program::FileId;

    fn name_of(file: FileId) -> Vec<u8> {
        format!("name of file {}", file.0).into_bytes()
    }

    /// Adds one entry to every list except the modules: every `TestUnit` already names its file's module.
    fn add_entries_unique_to_file(unit: &mut TestUnit) {
        let (file, fragment) = (unit.file, &mut unit.fragment);
        fragment.declare_function(test_function_key(file.0, 0));
        fragment.declare_layout(test_class_key(file.0, 0));
        fragment.declare_variable(test_variable_key(file.0, 0));
        fragment.declare_module_failure(modules::ModuleFailureId(file.0));
        let name = fragment.strings.intern(&name_of(file));
        fragment.property_keys.intern(PropertyKey::from_text(name));
        fragment.types.intern(Type::string_literal(name));
    }

    fn with_files_in_order<R>(then: impl FnOnce(&Projects<'_, '_>, [FileId; 3]) -> R) -> R {
        with_test_files(|projects, mut files| {
            files.sort_unstable();
            then(projects, files)
        })
    }

    fn collect_in_file_order(
        units: &mut [LinkUnit],
        projects: &Projects<'_, '_>,
    ) -> Vec<LinkTables> {
        units.sort_by_key(|unit| unit.file);
        collect_tables(units, projects, &forward)
    }

    #[test]
    fn tables_are_numbered_at_the_first_unit_that_holds_them() {
        with_files_in_order(|projects, [first, second, third]| {
            let tasks: [&[FileId]; 2] = [&[second], &[third, first]];
            let mut units = units_in_tasks(projects, &tasks, add_entries_unique_to_file);
            let tables = collect_in_file_order(&mut units, projects);

            assert_eq!(tables.len(), 2);
            let numbers: Vec<u32> = units.iter().map(|unit| unit.tables).collect();
            assert_eq!(numbers, [0, 1, 0]);
            for unit in &units {
                let key = in_application(test_function_key(unit.file.file.0, 0));
                assert!(tables[unit.tables as usize].functions.contains(&key));
            }
        });
    }

    #[test]
    #[should_panic(expected = "its commit was not noted")]
    fn unit_whose_commit_was_not_noted_stops_the_link() {
        with_files_in_order(|projects, [first, second, _]| {
            let tasks: [&[FileId]; 1] = [&[first, second]];
            let mut units = units_in_tasks(projects, &tasks, add_entries_unique_to_file);
            units[0].note_commit(&crate::lower::SaidTypes::default());
            collect_in_file_order(&mut units, projects);
        });
    }

    #[test]
    fn lengths_come_from_the_last_visit_whatever_the_file_order() {
        with_files_in_order(|projects, [first, second, _]| {
            for visits in [[first, second], [second, first]] {
                let mut units =
                    units_in_tasks(projects, &[&visits[..]], add_entries_unique_to_file);
                let [earlier, later] = [units[0].lengths, units[1].lengths];
                assert_ne!(earlier, later);
                assert_eq!(earlier.max(later), later);

                let tables = collect_in_file_order(&mut units, projects);
                assert_eq!(tables.len(), 1);
                assert_eq!(tables[0].lengths, later);
            }
        });
    }

    #[test]
    fn keys_carry_the_project_of_their_units() {
        with_files_in_order(|projects, [file, ..]| {
            let mut units = ProjectId::ALL.map(|project| {
                let mut unit = TestUnit::new(file);
                add_entries_unique_to_file(&mut unit);
                unit_in(projects, project, unit.finish())
            });
            let tables = collect_in_file_order(&mut units, projects);

            assert_eq!(tables.len(), 2);
            for (tables, project) in tables.iter().zip(ProjectId::ALL) {
                assert_eq!(tables.project, project);
                let function = key_in(project, test_function_key(file.0, 0));
                assert_eq!(tables.functions, [function]);
                assert_eq!(tables.layouts, [key_in(project, test_class_key(file.0, 0))]);
                let variable = key_in(project, test_variable_key(file.0, 0));
                assert_eq!(tables.variables, [ProgramVariableKey::Declared(variable)]);
                let module = ProgramModule::File(ProgramFile { project, file });
                assert_eq!(tables.modules, [module]);
                assert_eq!(tables.module_failures, [modules::ModuleFailureId(file.0)]);
            }
        });
    }

    #[test]
    fn entries_added_by_a_discarded_visit_are_cut_off() {
        with_files_in_order(|projects, [first, second, third]| {
            let mut task = TaskState::new();
            let mut visit = |file: FileId| {
                let mut unit = TestUnit::new_in(file, &mut task);
                add_entries_unique_to_file(&mut unit);
                unit_in(projects, ProjectId::Application, unit.finish_in(&mut task))
            };
            let mut units = [visit(first), visit(second)];
            drop(visit(third));
            let committed = units[1].lengths;

            let tables = collect_in_file_order(&mut units, projects);
            let tables = &tables[0];
            assert_eq!(tables.lengths, committed);
            let list_lengths = TableLengths {
                strings: tables.strings.len() as u32,
                property_keys: tables.property_keys.len() as u32,
                types: tables.types.len() as u32,
                functions: tables.functions.len() as u32,
                layouts: tables.layouts.len() as u32,
                variables: tables.variables.len() as u32,
                modules: tables.modules.len() as u32,
                module_failures: tables.module_failures.len() as u32,
                ..committed
            };
            assert_eq!(list_lengths, committed);
            let functions = [first, second].map(|file| test_function_key(file.0, 0));
            assert_eq!(tables.functions, functions.map(in_application));
            assert!(tables.strings.find(&name_of(second)).is_some());
            assert!(tables.strings.find(&name_of(third)).is_none());
        });
    }

    #[test]
    fn conversion_order_does_not_change_the_result() {
        with_files_in_order(|projects, [first, second, third]| {
            let ways: [InParallel<'_>; 2] = [&forward, &reverse];
            let [in_order, in_reverse] = ways.map(|in_parallel| {
                let tasks: [&[FileId]; 2] = [&[first, third], &[second]];
                let mut units = units_in_tasks(projects, &tasks, add_entries_unique_to_file);
                units.sort_by_key(|unit| unit.file);
                let tables = collect_tables(&mut units, projects, in_parallel);
                let lists = tables.into_iter().map(|tables| {
                    let LinkTables {
                        project,
                        functions,
                        layouts,
                        variables,
                        modules,
                        lengths,
                        ..
                    } = tables;
                    (project, functions, layouts, variables, modules, lengths)
                });
                lists.collect::<Vec<_>>()
            });
            assert_eq!(in_order, in_reverse);
        });
    }
}
