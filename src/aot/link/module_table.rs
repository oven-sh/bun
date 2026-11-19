use super::program_keys::{ProgramModule, compare_program_modules};
use super::state::ModuleTable;
use super::tables::LinkTables;
use super::unit::LinkUnit;
use super::{LinkProject, is_unit_optional, key_context};
use crate::builtins::table::{ModuleFlags, module_data};
use crate::load::{PerProject, ProgramFile, ProjectId};
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;

pub(super) fn collect_modules(
    projects: &PerProject<LinkProject<'_, '_>>,
    units: &[LinkUnit],
    tables: &[LinkTables],
) -> ModuleTable {
    let has_unit = |file: ProgramFile| find_unit(units, ProgramModule::File(file)).is_some();
    let mut modules = Vec::new();
    for (project, linked) in projects.iter() {
        let record_files = linked.graph.record_files().iter();
        let record_files = record_files.map(|&file| ProgramFile { project, file });
        let record_files =
            record_files.filter(|&file| !is_unit_optional(projects, file) || has_unit(file));
        modules.extend(record_files.map(ProgramModule::File));
    }
    let mut known_modules = FxHashSet::default();
    let mut add_named_module = |module: ProgramModule| match module {
        ProgramModule::File(file) => {
            let has_record = projects.get(file.project).graph.has_record(file.file);
            assert!(
                has_record,
                "a file without a module record is named as a module"
            );
        }
        _ => {
            if known_modules.insert(module) {
                modules.push(module);
            }
        }
    };
    for project in ProjectId::ALL {
        let context = key_context(projects, project);
        for &module in context.graph.other_modules() {
            add_named_module(context.module(module));
        }
        let sources = projects.get(project).sources;
        for &module in sources.modules_named_at_run_time() {
            if !module_data(module).flags.contains(ModuleFlags::HAS_SOURCE) {
                add_named_module(ProgramModule::Runtime(module));
            }
        }
    }
    for named in tables {
        for &module in &named.modules[..named.lengths.modules as usize] {
            add_named_module(module);
        }
    }
    add_requested_records(projects, &mut modules, &mut known_modules);
    let atoms = &projects.application.loaded.files().atoms;
    modules.shared_sort_unstable_by(|&a, &b| compare_program_modules(a, b, atoms));
    assert!(
        modules.len() <= u32::MAX as usize,
        "a module index has 32 bits"
    );
    let index_by_module = modules.iter().copied().zip(0..).collect();
    ModuleTable {
        modules,
        index_by_module,
    }
}

fn add_requested_records(
    projects: &PerProject<LinkProject<'_, '_>>,
    modules: &mut Vec<ProgramModule>,
    known_modules: &mut FxHashSet<ProgramModule>,
) {
    let mut visited = 0;
    while let Some(&module) = modules.get(visited) {
        visited += 1;
        let Some((project, requester)) = module.in_own_project() else {
            continue;
        };
        let context = key_context(projects, project);
        for request in context.graph.requests_of(requester) {
            let target = context.module(request.target);
            match target {
                ProgramModule::Inner { .. }
                | ProgramModule::Facade(_)
                | ProgramModule::Check(_) => {
                    if known_modules.insert(target) {
                        modules.push(target);
                    }
                }
                ProgramModule::File(_)
                | ProgramModule::Runtime(_)
                | ProgramModule::External { .. } => {}
            }
        }
    }
}

pub(super) fn find_unit(units: &[LinkUnit], module: ProgramModule) -> Option<u32> {
    let file = module.file()?;
    let unit = units.binary_search_by_key(&file, |unit| unit.file).ok()?;
    Some(unit as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::link::tables::collect_tables;
    use crate::link::testing::{
        Projects, TaskState, TestUnit, find_file, finish_unit, forward, unit_in, with_projects,
    };
    use crate::lower::FragmentBuilder;
    use crate::modules::ModuleRef;

    fn application_module(projects: &Projects<'_, '_>, module: ModuleRef) -> ProgramModule {
        key_context(projects, ProjectId::Application).module(module)
    }

    fn application_file(projects: &Projects<'_, '_>, name: &str) -> ProgramModule {
        application_module(projects, ModuleRef::File(find_file(projects, name)))
    }

    fn runtime_source(projects: &Projects<'_, '_>, module: RuntimeModule) -> ProgramModule {
        let file = projects.runtime.sources.runtime_module_file(module);
        ProgramModule::File(ProgramFile {
            project: ProjectId::Runtime,
            file: file.expect("the runtime project has no source of this module"),
        })
    }

    fn create_external(projects: &Projects<'_, '_>, importer: &str, specifier: &[u8]) -> ModuleRef {
        ModuleRef::External {
            importer: find_file(projects, importer),
            specifier: projects.application.loaded.files().atoms.intern(specifier),
            type_attribute: None,
        }
    }

    fn create_unit(projects: &Projects<'_, '_>, name: &str, declared: &[ModuleRef]) -> LinkUnit {
        let mut fragment = FragmentBuilder::alone(find_file(projects, name));
        for &module in declared {
            fragment.declare_module(module);
        }
        finish_unit(projects, fragment)
    }

    fn collect_modules_of(projects: &Projects<'_, '_>, units: &mut [LinkUnit]) -> ModuleTable {
        units.sort_unstable_by_key(|unit| unit.file);
        let tables = collect_tables(units, projects, &forward);
        collect_modules(projects, units, &tables)
    }

    fn count_of(table: &ModuleTable, module: ProgramModule) -> usize {
        let listed_modules = table.modules.iter();
        listed_modules.filter(|&&listed| listed == module).count()
    }

    #[test]
    fn bun_module_is_listed_once() {
        with_projects(&[("index.ts", "import 'node:path';")], |projects| {
            let imported = ModuleRef::Runtime(RuntimeModule::NodePath);
            let named_modules = projects.application.graph.other_modules();
            assert!(named_modules.contains(&imported));
            let source = runtime_source(projects, RuntimeModule::NodePath);
            assert_eq!(application_module(projects, imported), source);

            let mut units = [create_unit(projects, "index.ts", &[imported])];
            let table = collect_modules_of(projects, &mut units);
            assert_eq!(count_of(&table, source), 1);
            let without_source = ProgramModule::Runtime(RuntimeModule::NodePath);
            assert_eq!(count_of(&table, without_source), 0);
        });
    }

    #[test]
    fn native_module_written_as_a_value_is_listed_where_a_loader_takes_unknown_names() {
        let native = ProgramModule::Runtime(RuntimeModule::BunJsc);
        let handed_on = "const load = [require][Number(process.argv[2])]; load('bun:jsc');";
        with_projects(&[("index.cjs", handed_on)], |projects| {
            assert_eq!(count_of(&collect_modules(projects, &[], &[]), native), 1);
        });
        with_projects(&[("index.cjs", "console.log('bun:jsc');")], |projects| {
            assert_eq!(count_of(&collect_modules(projects, &[], &[]), native), 0);
        });
    }

    #[test]
    fn modules_are_ordered_by_project_and_file() {
        let index = "import './b.ts'; import './a.ts'; import 'node:buffer'; import 'node:path';";
        let files = [
            ("index.ts", index),
            ("a.ts", "export {};"),
            ("b.ts", "export {};"),
        ];
        with_projects(&files, |projects| {
            let externals = [&b"z"[..], b"a"];
            let externals = externals.map(|name| create_external(projects, "index.ts", name));
            let mut units = [create_unit(projects, "index.ts", &externals)];
            let table = collect_modules_of(projects, &mut units);

            let leading_files = table.modules.iter().map_while(|&module| match module {
                ProgramModule::File(file) => Some(file),
                _ => None,
            });
            let leading_files: Vec<ProgramFile> = leading_files.collect();
            let record_files = projects.iter();
            let record_files = record_files.map(|(_, project)| project.graph.record_files().len());
            assert_eq!(leading_files.len(), record_files.sum::<usize>());
            assert!(leading_files.is_sorted_by(|first, second| first < second));

            let [external_z, external_a] =
                externals.map(|module| application_module(projects, module));
            let entry_point = application_file(projects, "index.ts");
            let modules_in_order = [
                entry_point,
                runtime_source(projects, RuntimeModule::NodePath),
                ProgramModule::Runtime(RuntimeModule::NodeBuffer),
                external_a,
                external_z,
            ];
            let indexes = modules_in_order.map(|module| table.index_of(module));
            assert!(indexes.is_sorted_by(|first, second| first < second));

            for (index, &module) in (0..).zip(&table.modules) {
                assert_eq!(table.index_of(module), index);
                assert_eq!(
                    find_unit(&units, module),
                    (module == entry_point).then_some(0)
                );
            }
        });
    }

    #[test]
    fn declared_external_is_listed() {
        let files = [
            ("index.ts", "import './other.ts';"),
            ("other.ts", "export {};"),
        ];
        with_projects(&files, |projects| {
            let declared = [
                create_external(projects, "index.ts", b"package"),
                ModuleRef::Runtime(RuntimeModule::NodeBuffer),
            ];
            let [external, runtime] = declared.map(|module| application_module(projects, module));
            assert_eq!(count_of(&collect_modules(projects, &[], &[]), external), 0);

            let names = ["index.ts", "other.ts"];
            let mut units = names.map(|name| create_unit(projects, name, &declared));
            let table = collect_modules_of(projects, &mut units);
            assert_eq!(count_of(&table, external), 1);
            assert_eq!(count_of(&table, runtime), 1);
            assert_eq!(find_unit(&units, external), None);
        });
    }

    #[test]
    fn modules_come_from_the_tables_below_their_lengths() {
        let files = [
            ("index.ts", "import './a.ts'; import './b.ts';"),
            ("a.ts", "export {};"),
            ("b.ts", "export {};"),
        ];
        with_projects(&files, |projects| {
            let names = [&b"first"[..], b"second", b"discarded"];
            let externals = names.map(|name| create_external(projects, "index.ts", name));
            let [first, second, discarded] = externals;
            let mut task = TaskState::new();
            let mut visit = |name: &str, declared: &[ModuleRef]| {
                let mut unit = TestUnit::new_in(find_file(projects, name), &mut task);
                for &module in declared {
                    unit.fragment.declare_module(module);
                }
                unit_in(projects, ProjectId::Application, unit.finish_in(&mut task))
            };
            let mut units = [visit("index.ts", &[first]), visit("a.ts", &[first, second])];
            drop(visit("b.ts", &[discarded]));

            let table = collect_modules_of(projects, &mut units);
            let listed = externals.map(|module| application_module(projects, module));
            assert_eq!(listed.map(|module| count_of(&table, module)), [1, 1, 0]);
        });
    }

    #[test]
    fn further_records_of_a_file_follow_its_own() {
        let files = [
            ("index.ts", "import './legacy.cjs';"),
            ("legacy.cjs", "exports.a = 1;"),
        ];
        with_projects(&files, |projects| {
            let [index, legacy] = ["index.ts", "legacy.cjs"].map(|name| find_file(projects, name));
            let declared = [ModuleRef::Check(index), ModuleRef::Facade(legacy)];
            let names = ["index.ts", "legacy.cjs"];
            let mut units = names.map(|name| create_unit(projects, name, &declared));
            let table = collect_modules_of(projects, &mut units);

            let records_of_index = [ModuleRef::File(index), ModuleRef::Check(index)];
            let records_of_legacy = [ModuleRef::File(legacy), ModuleRef::Facade(legacy)];
            for records in [records_of_index, records_of_legacy] {
                let records = records.map(|module| application_module(projects, module));
                let first = table.index_of(records[0]) as usize;
                assert_eq!(table.modules[first..first + records.len()], records);
                let unit = find_unit(&units, records[0]);
                assert!(unit.is_some());
                assert!(
                    records
                        .iter()
                        .all(|&record| find_unit(&units, record) == unit)
                );
            }
        });
    }
}
