use super::LinkError;
use super::marks::{LayoutUse, Marker};
use super::program_keys::ProgramModule;
use super::unit::{LocalKind, LocalReference};
use crate::ir::VariableKey;
use crate::load::{ProgramFile, ProjectId};
use crate::modules::{
    ExportBinding, ModuleFailureId, ModuleGraph, ModuleKind, ModuleRef, Shape, SyntheticExportRule,
};
use core::sync::atomic::Ordering;

/// The variable that an export table shows.
pub(super) fn exported_variable_key(
    graph: &ModuleGraph,
    binding: ExportBinding,
) -> Option<VariableKey> {
    match binding {
        ExportBinding::Variable(symbol) => Some(VariableKey::Symbol(symbol)),
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
        Shape::EsModule | Shape::Names | Shape::AsToday => false,
    }
}

/// The loader takes the names from the object that the CommonJS file exports, as it does for a module of the library.
pub(super) fn is_filled_by_loader(graph: &ModuleGraph, face: ModuleRef) -> bool {
    match graph.interop(face).export_rule {
        SyntheticExportRule::None => false,
        _ => true,
    }
}

impl Marker<'_> {
    pub(super) fn mark_module(&mut self, module: ProgramModule) {
        match module {
            ProgramModule::File(file) => self.mark_file(file),
            ProgramModule::Inner { file, .. } => {
                self.mark_body(module, file);
                self.mark_exports_variable(module, file);
            }
            ProgramModule::Face(file) => {
                self.mark_body(module, file);
                self.mark_exports_of_face(file);
            }
            ProgramModule::Check(file) => self.mark_body(module, file),
            ProgramModule::Runtime(_) | ProgramModule::External { .. } => {}
        }
    }

    fn mark_body(&mut self, module: ProgramModule, file: ProgramFile) {
        let key = module
            .body_key()
            .expect("the fragment names the body of a file");
        match self.context.functions.find(&key) {
            Some(body) => self.mark_function(body, file),
            None => self.add_error(LinkError::UndefinedFunction {
                key,
                referenced_in: file,
            }),
        }
    }

    // The host reads it through the record. A module that never mentions its exports has none.
    fn mark_exports_variable(&mut self, module: ProgramModule, file: ProgramFile) {
        let (Some(key), Some((project, own))) =
            (module.exports_variable_key(), module.in_own_project())
        else {
            return;
        };
        if !holds_exports_in_variable(self.context.keys.get(project).graph, own) {
            return;
        }
        if let Some(variable) = self.context.variables.find(&key) {
            self.mark_variable(variable, file);
        }
    }

    fn mark_exports_of_face(&mut self, file: ProgramFile) {
        let graph = self.context.keys.get(file.project).graph;
        let face = ModuleRef::Face(file.file);
        if is_filled_by_loader(graph, face) {
            return;
        }
        for export in graph
            .exports_of(face)
            .iter()
            .filter(|export| export.is_read_from_object)
        {
            self.mark_export(file, export.binding);
        }
    }

    fn mark_file(&mut self, file: ProgramFile) {
        if let Some(unit) = self.own_unit() {
            debug_assert!(unit.file == file);
            let fragment = &unit.module;
            let body = fragment
                .body
                .map(|body| (LocalKind::Function, body.to_word()));
            let data = fragment.data.map(|data| (LocalKind::Data, data.to_word()));
            for (kind, index) in body.into_iter().chain(data) {
                self.follow(LocalReference { kind, index }, LayoutUse::Direct);
            }
        }
        let graph = self.context.keys.get(file.project).graph;
        let interop = graph.interop(ModuleRef::File(file.file));
        if graph.is_library(file.file) {
            return;
        }
        match interop.kind {
            ModuleKind::SourceText | ModuleKind::Data => {}
            ModuleKind::CommonJs => {
                return self.mark_exports_variable(ProgramModule::File(file), file);
            }
            ModuleKind::RuntimeSource | ModuleKind::Runtime | ModuleKind::External => return,
        }
        for export in graph
            .exports(file.file)
            .iter()
            .filter(|export| export.is_read_from_object)
        {
            self.mark_export(file, export.binding);
        }
    }

    pub(super) fn mark_failure(&mut self, project: ProjectId, failure: ModuleFailureId) {
        let is_retained = &self.context.is_failure_retained.get(project)[failure.0 as usize];
        is_retained.store(true, Ordering::Relaxed);
    }

    fn mark_export(&mut self, file: ProgramFile, binding: ExportBinding) {
        let keys = self.context.keys.get(file.project);
        let Some(key) = exported_variable_key(keys.graph, binding) else {
            return;
        };
        let key = keys.variable_key(key);
        match self.context.variables.find(&key) {
            Some(index) => self.mark_variable(index, file),
            None => self.add_error(LinkError::UndefinedVariable {
                key,
                referenced_in: file,
            }),
        }
    }
}
