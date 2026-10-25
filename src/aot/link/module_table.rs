use super::names::ModuleOrigin;
use super::program_keys::{ProgramModule, compare_program_modules};
use super::state::{ModuleTable, Numbering};
use super::unit::LinkUnit;
use super::{LinkProject, is_unit_optional, key_context};
use crate::ir::Id;
use crate::load::{PerProject, ProgramFile, ProjectId};
use bun_sema::check::aot::FileOrigin;
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;

pub(super) fn collect_modules(
    projects: &PerProject<LinkProject<'_, '_>>,
    units: &[LinkUnit],
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
    }
    for unit in units {
        for &module in &unit.modules {
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
    let unit_by_module = modules
        .iter()
        .map(|&module| find_unit(units, module))
        .collect();
    ModuleTable {
        modules,
        index_by_module,
        unit_by_module,
    }
}

// No code names the face of a CommonJS file that is imported for its effects, or the check of a graph: a request does.
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
                ProgramModule::Inner { .. } | ProgramModule::Face(_) | ProgramModule::Check(_) => {
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

fn find_unit(units: &[LinkUnit], module: ProgramModule) -> Option<u32> {
    let file = module.file()?;
    let unit = units.binary_search_by_key(&file, |unit| unit.file).ok()?;
    Some(unit as u32)
}

pub(super) fn collect_module_origins(
    projects: &PerProject<LinkProject<'_, '_>>,
    modules: &ModuleTable,
    numbering: &Numbering,
) -> Vec<ModuleOrigin> {
    let mut origins = Vec::with_capacity(numbering.counts.modules);
    for (&module, id) in modules.modules.iter().zip(&numbering.modules) {
        let Some(id) = id else {
            continue;
        };
        debug_assert_eq!(id.index(), origins.len());
        origins.push(find_module_origin(projects, module));
    }
    origins
}

fn find_module_origin(
    projects: &PerProject<LinkProject<'_, '_>>,
    module: ProgramModule,
) -> ModuleOrigin {
    let file = match module {
        ProgramModule::File(file)
        | ProgramModule::Inner { file, .. }
        | ProgramModule::Face(file)
        | ProgramModule::Check(file) => match file.project {
            ProjectId::Application => file.file,
            ProjectId::Runtime => return ModuleOrigin::Runtime,
        },
        ProgramModule::Runtime(_) => return ModuleOrigin::Runtime,
        ProgramModule::External { .. } => return ModuleOrigin::Dependency,
    };
    let loaded = projects.application.loaded;
    match loaded.origin(file) {
        FileOrigin::DependencySource | FileOrigin::DependencyJavaScript => ModuleOrigin::Dependency,
        FileOrigin::Declarations => match loaded.files().module(file).is_from_external_library {
            true => ModuleOrigin::Dependency,
            false => ModuleOrigin::Program,
        },
        FileOrigin::Runtime => ModuleOrigin::Runtime,
        _ => ModuleOrigin::Program,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::RuntimeModule;
    use crate::ir::ModuleId;
    use crate::link::state::ProgramCounts;
    use crate::link::testing::{Projects, find_file, with_projects};
    use crate::lower::{FragmentBuilder, ModuleFragment};
    use crate::modules::ModuleRef;
    use bun_sema::hir::FnId;
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
        }
    }

    fn create_unit(projects: &Projects<'_, '_>, name: &str, declared: &[ModuleRef]) -> LinkUnit {
        let mut fragment = FragmentBuilder::new(find_file(projects, name));
        for &module in declared {
            fragment.declare_module(module);
        }
        let keys = key_context(projects, ProjectId::Application);
        LinkUnit::new(&keys, fragment.finish(ModuleFragment::default()))
    }

    fn count_of(table: &ModuleTable, module: ProgramModule) -> usize {
        let listed_modules = table.modules.iter();
        listed_modules.filter(|&&listed| listed == module).count()
    }

    fn number_modules(table: &ModuleTable, is_kept: impl Fn(ProgramModule) -> bool) -> Numbering {
        let mut counts = ProgramCounts::default();
        let modules = table
            .modules
            .iter()
            .map(|&module| {
                let id = is_kept(module).then(|| ModuleId::new(counts.modules));
                counts.modules += usize::from(id.is_some());
                id
            })
            .collect();
        Numbering {
            functions: Vec::new(),
            layouts: Vec::new(),
            variables: Vec::new(),
            modules,
            module_failures: PerProject::default(),
            counts,
            units: Vec::new(),
        }
    }

    #[test]
    fn bun_module_is_listed_once() {
        with_projects(&[("index.ts", "import 'node:path';")], |projects| {
            let imported = ModuleRef::Runtime(RuntimeModule::NodePath);
            let named_modules = projects.application.graph.other_modules();
            assert!(named_modules.contains(&imported));
            let source = runtime_source(projects, RuntimeModule::NodePath);
            assert_eq!(application_module(projects, imported), source);

            let unit = create_unit(projects, "index.ts", &[imported]);
            let table = collect_modules(projects, &[unit]);
            assert_eq!(count_of(&table, source), 1);
            let without_source = ProgramModule::Runtime(RuntimeModule::NodePath);
            assert_eq!(count_of(&table, without_source), 0);
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
            let table = collect_modules(projects, &[create_unit(projects, "index.ts", &externals)]);

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

            let units = table.unit_by_module.iter();
            for (index, (&module, &unit)) in (0..).zip(table.modules.iter().zip(units)) {
                assert_eq!(table.index_of(module), index);
                assert_eq!(unit, (module == entry_point).then_some(0));
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
            assert_eq!(count_of(&collect_modules(projects, &[]), external), 0);

            let names = ["index.ts", "other.ts"];
            let mut units = names.map(|name| create_unit(projects, name, &declared));
            units.sort_unstable_by_key(|unit| unit.file);
            let table = collect_modules(projects, &units);
            assert_eq!(count_of(&table, external), 1);
            assert_eq!(count_of(&table, runtime), 1);
            assert_eq!(
                table.unit_by_module[table.index_of(external) as usize],
                None
            );
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
            let inner = |callback| ModuleRef::Inner {
                file: legacy,
                callback: FnId(callback),
            };
            let declared = [
                ModuleRef::Check(index),
                ModuleRef::Face(legacy),
                inner(4),
                inner(2),
            ];
            let names = ["index.ts", "legacy.cjs"];
            let mut units = names.map(|name| create_unit(projects, name, &declared));
            units.sort_unstable_by_key(|unit| unit.file);
            let table = collect_modules(projects, &units);

            let records_of_index = [ModuleRef::File(index), ModuleRef::Check(index)];
            let records_of_legacy = [
                ModuleRef::File(legacy),
                inner(2),
                inner(4),
                ModuleRef::Face(legacy),
            ];
            for records in [&records_of_index[..], &records_of_legacy[..]] {
                let records = records
                    .iter()
                    .map(|&module| application_module(projects, module));
                let records: Vec<ProgramModule> = records.collect();
                let first = table.index_of(records[0]) as usize;
                assert_eq!(table.modules[first..first + records.len()], records);
                let units_of_records = &table.unit_by_module[first..first + records.len()];
                assert!(
                    units_of_records
                        .iter()
                        .all(|&unit| unit == units_of_records[0])
                );
                assert!(units_of_records[0].is_some());
            }

            let origins =
                collect_module_origins(projects, &table, &number_modules(&table, |_| true));
            let face = application_module(projects, ModuleRef::Face(legacy));
            assert_eq!(
                origins[table.index_of(face) as usize],
                ModuleOrigin::Program
            );
        });
    }

    #[test]
    fn origins_follow_file_origin() {
        let main = "import './types.d.ts'; import 'dep'; import 'node:path'; import 'node:buffer';";
        let files = [
            ("main.js", main),
            ("types.d.ts", "export declare const x: number;"),
            ("node_modules/dep/package.json", r#"{ "name": "dep" }"#),
            ("node_modules/dep/index.js", "exports.x = 1;"),
        ];
        with_projects(&files, |projects| {
            let external = create_external(projects, "main.js", b"package");
            let table = collect_modules(projects, &[create_unit(projects, "main.js", &[external])]);
            let origins =
                collect_module_origins(projects, &table, &number_modules(&table, |_| true));
            assert_eq!(origins.len(), table.modules.len());

            let entry_point = application_file(projects, "main.js");
            let dependency = application_file(projects, "node_modules/dep/index.js");
            let expected_origins = [
                (entry_point, ModuleOrigin::Program),
                (
                    application_file(projects, "types.d.ts"),
                    ModuleOrigin::Program,
                ),
                (dependency, ModuleOrigin::Dependency),
                (
                    runtime_source(projects, RuntimeModule::NodePath),
                    ModuleOrigin::Runtime,
                ),
                (
                    ProgramModule::Runtime(RuntimeModule::NodeBuffer),
                    ModuleOrigin::Runtime,
                ),
                (
                    application_module(projects, external),
                    ModuleOrigin::Dependency,
                ),
            ];
            for (module, origin) in expected_origins {
                assert_eq!(
                    origins[table.index_of(module) as usize],
                    origin,
                    "{module:?}"
                );
            }

            let numbering = number_modules(&table, |module| module != dependency);
            let mut kept_origins = origins;
            kept_origins.remove(table.index_of(dependency) as usize);
            assert_eq!(
                collect_module_origins(projects, &table, &numbering),
                kept_origins
            );
        });
    }
}
