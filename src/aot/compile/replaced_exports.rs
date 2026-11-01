//! `spyOn(ns, name)` stores into the variable behind an export, so the variable has to be compiled as one that may change.
//! The front end sees the calls that spell the namespace and the name. The engine follows values and reports the rest, and the program is compiled again.

use crate::builtins::RuntimeModule;
use crate::engine::FlowFindings;
use crate::ir::generated::ModuleExportKind;
use crate::ir::{Id, Program, VariableId};
use crate::link::ProgramModule;
use crate::load::ProjectId;
use crate::options::{ReplacedExport, ReplacedModule};

use super::LoadedBuild;

/// What a later load of the program finds each exported variable by.
#[derive(Default)]
pub(super) struct ExportedVariables {
    modules: Vec<ReplacedModule>,
    /// Ascending by variable. The position in `modules`, and the name that the module exports the variable under.
    variables: Vec<(VariableId, u32, Box<[u8]>)>,
}

/// By module of the program: the path of the file of the application that the module is, or is the face of.
pub(super) fn collect_files_of_modules(
    loaded: &LoadedBuild<'_, '_>,
    modules: &[ProgramModule],
) -> Vec<Option<Box<[u8]>>> {
    let files = loaded.project(ProjectId::Application).loaded.files();
    let path_of = |module: &ProgramModule| match *module {
        ProgramModule::File(file) | ProgramModule::Face(file)
            if file.project == ProjectId::Application =>
        {
            Some(Box::from(files.module(file.file).file_name()))
        }
        _ => None,
    };
    modules.iter().map(path_of).collect()
}

impl ExportedVariables {
    pub(super) fn collect(
        program: &Program,
        files_of_modules: &[Option<Box<[u8]>>],
    ) -> ExportedVariables {
        let mut exported = ExportedVariables::default();
        for (module, file) in program.modules.iter().zip(files_of_modules) {
            let found_by = match (module.runtime_module, file) {
                // The build has to see which calls are spies. Where a spy's holder is out of sight the engine names every namespace object that is too,
                // and with `expect` and `spyOn` replaceable it would see none. A mock of bun:test is named at its call.
                (Some(runtime_module), _)
                    if runtime_module.registry_id() == RuntimeModule::BunTest.registry_id() =>
                {
                    continue;
                }
                (Some(runtime_module), _) => ReplacedModule::Runtime(runtime_module.registry_id()),
                (None, Some(path)) => ReplacedModule::File(path.to_vec()),
                (None, None) => continue,
            };
            let position = exported.modules.len() as u32;
            let exports = module.exports.iter();
            let exports = exports.filter(|entry| entry.kind == ModuleExportKind::Variable);
            let exports = exports.map(|entry| (entry.variable, entry.name));
            let filled = module.synthetic_exports.iter();
            let filled = filled.map(|entry| (entry.variable, entry.name));
            for (variable, name) in exports.chain(filled) {
                if let Some(variable) = variable {
                    let name = Box::from(program.strings.get(name));
                    exported.variables.push((variable, position, name));
                }
            }
            exported.modules.push(found_by);
        }
        // A module that exports a name of another one again lists the same variable.
        exported.variables.sort_by_key(|entry| entry.0.index());
        exported.variables.dedup_by_key(|entry| entry.0);
        exported
    }

    pub(super) fn find_replaced(&self, found: &FlowFindings<'_>) -> Vec<ReplacedExport> {
        let records = found.exports_that_spies_replace.iter();
        let replaced = records.filter_map(|record| {
            let variables = &self.variables;
            let at = variables.binary_search_by_key(&(record.variable as usize), |it| it.0.index());
            let (_, module, name) = &variables[at.ok()?];
            Some(ReplacedExport {
                module: self.modules[*module as usize].clone(),
                name: name.to_vec(),
            })
        });
        replaced.collect()
    }
}
