use super::names::ModuleOrigin;
use super::program_keys::{ProgramModule, compare_program_modules};
use super::state::{ModuleTable, Numbering};
use super::unit::LinkUnit;
use super::{LinkProject, is_unit_optional, key_context};
use crate::ir::Id;
use crate::load::{PerProject, ProgramFile, ProjectId};
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::util::SharedSort;
use rustc_hash::FxHashSet;

pub(super) fn collect_modules(
    projects: &PerProject<LinkProject<'_, '_>>,
    units: &[LinkUnit],
    atoms: &Interner<'_>,
) -> ModuleTable {
    let mut modules = collect_record_files(projects, units);
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
    modules.shared_sort_unstable_by(|&a, &b| compare_program_modules(a, b, atoms));
    create_module_table(modules, units)
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

fn collect_record_files(
    projects: &PerProject<LinkProject<'_, '_>>,
    units: &[LinkUnit],
) -> Vec<ProgramModule> {
    let has_unit = |file: ProgramFile| find_unit(units, ProgramModule::File(file)).is_some();
    let mut modules = Vec::new();
    for (project, linked) in projects.iter() {
        let record_files = linked.graph.record_files().iter();
        let record_files = record_files.map(|&file| ProgramFile { project, file });
        let record_files =
            record_files.filter(|&file| !is_unit_optional(projects, file) || has_unit(file));
        modules.extend(record_files.map(ProgramModule::File));
    }
    modules
}

fn create_module_table(modules: Vec<ProgramModule>, units: &[LinkUnit]) -> ModuleTable {
    assert!(
        modules.len() <= u32::MAX as usize,
        "a module index has 32 bits"
    );
    let index_by_module = modules
        .iter()
        .enumerate()
        .map(|(index, &module)| (module, index as u32))
        .collect();
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

// The unit of the file that holds the text of the module.
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
        FileOrigin::DependencySource
        | FileOrigin::DependencyJavaScript
        | FileOrigin::ProjectTypedVersion => ModuleOrigin::Dependency,
        FileOrigin::Declarations => match loaded.files().module(file).is_from_external_library {
            true => ModuleOrigin::Dependency,
            false => ModuleOrigin::Program,
        },
        FileOrigin::Runtime => ModuleOrigin::Runtime,
        _ => ModuleOrigin::Program,
    }
}
