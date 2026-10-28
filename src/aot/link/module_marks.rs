use super::LinkError;
use super::marks::{LayoutUse, Marker};
use super::program_keys::ProgramModule;
use super::unit::{LocalKind, LocalReference};
use crate::ir::VariableKey;
use crate::load::{ProgramFile, ProjectId};
use crate::modules::{
    ExportBinding, ModuleExport, ModuleFailureId, ModuleGraph, ModuleKind, ModuleRef, Shape,
    SyntheticExportRule,
};
use core::sync::atomic::Ordering;

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
    !matches!(graph.interop(face).export_rule, SyntheticExportRule::None)
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
        match self.context.merged.functions.find(&key) {
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
        if let Some(variable) = self.context.merged.variables.find(&key) {
            self.mark_variable(variable, file);
        }
    }

    fn mark_exports_of_face(&mut self, file: ProgramFile) {
        let graph = self.context.keys.get(file.project).graph;
        let face = ModuleRef::Face(file.file);
        if is_filled_by_loader(graph, face) {
            return;
        }
        self.mark_exports_read_from_object(file, graph.exports_of(face));
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
        self.mark_exports_read_from_object(file, graph.exports(file.file));
    }

    pub(super) fn mark_failure(&mut self, project: ProjectId, failure: ModuleFailureId) {
        let is_retained = &self.context.is_failure_retained.get(project)[failure.0 as usize];
        is_retained.store(true, Ordering::Relaxed);
    }

    fn mark_exports_read_from_object(&mut self, file: ProgramFile, exports: &[ModuleExport]) {
        for export in exports.iter().filter(|export| export.is_read_from_object) {
            self.mark_export(file, export.binding);
        }
    }

    fn mark_export(&mut self, file: ProgramFile, binding: ExportBinding) {
        let keys = self.context.keys.get(file.project);
        let Some(key) = exported_variable_key(keys.graph, binding) else {
            return;
        };
        let key = keys.variable_key(key);
        match self.context.merged.variables.find(&key) {
            Some(index) => self.mark_variable(index, file),
            None => self.add_error(LinkError::UndefinedVariable {
                key,
                referenced_in: file,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::builtins::table::STARTUP_MODULES;
    use crate::ir::generated::{ExternalKind, Module, ModuleFlags};
    use crate::ir::{Id, ModuleId, Program};
    use crate::link::testing::{link_sources, link_sources_without_bun_modules};
    use crate::load::runtime_modules::RuntimeModules;
    use bun_builtin_sources::Archive;

    fn link_program(files: &[(&str, &str)]) -> Program {
        let linked = link_sources_without_bun_modules(files);
        linked.expect("the program links").program
    }

    fn link_program_with_bun_modules(files: &[(&str, &str)]) -> Program {
        link_sources(files).expect("the program links").program
    }

    fn find_module(program: &Program, path_suffix: &str) -> Option<ModuleId> {
        let has_path = |module: &Module| {
            let path = program.strings.get(module.path);
            path.ends_with(path_suffix.as_bytes())
        };
        program.modules.iter().position(has_path).map(ModuleId::new)
    }

    fn find_record<'p>(program: &'p Program, path_suffix: &str) -> Option<&'p Module> {
        let module = find_module(program, path_suffix)?;
        Some(&program.modules[module.index()])
    }

    fn is_evaluated(program: &Program, path_suffix: &str) -> bool {
        find_record(program, path_suffix).is_some_and(|record| record.body.is_some())
    }

    fn export_names<'p>(program: &'p Program, path_suffix: &str) -> Vec<&'p [u8]> {
        let record = find_record(program, path_suffix).expect("no module has this path");
        let exports = record.exports.iter();
        exports
            .map(|export| program.strings.get(export.name))
            .collect()
    }

    #[test]
    fn entry_point_is_evaluated() {
        let program = link_program(&[("index.js", "export const value = 1;\n")]);
        let record = find_record(&program, "index.js").expect("the entry point has no record");
        assert!(record.body.is_some());
        assert!(!record.flags.contains(ModuleFlags::IS_LIBRARY));
    }

    #[test]
    fn export_nothing_reads_keeps_its_entry() {
        let index = "export default { port: 1 };\nexport const unread = 2;\n";
        let program = link_program(&[("index.js", index)]);
        let names: [&[u8]; 2] = [b"default", b"unread"];
        assert_eq!(export_names(&program, "index.js"), names);
    }

    #[test]
    fn module_that_only_a_left_out_function_imports_is_left_out() {
        let index =
            "export {};\nfunction dropped() {\n  return [dropped, import('./lazy.js')];\n}\n";
        let program = link_program(&[
            ("index.js", index),
            ("lazy.js", "export const value = 1;\n"),
            ("unnamed.js", "export const value = 2;\n"),
        ]);
        assert!(!has_function_named(&program, b"dropped"));
        assert!(find_record(&program, "lazy.js").is_none());
        assert!(find_record(&program, "unnamed.js").is_none());
    }

    #[test]
    fn bun_module_imported_by_dropped_function_is_kept() {
        let index =
            "export {};\nfunction dropped() {\n  return [dropped, import('node:punycode')];\n}\n";
        let program = link_program_with_bun_modules(&[("index.js", index)]);
        assert!(is_evaluated(&program, "node:punycode"));
    }

    #[test]
    fn host_loaded_bun_module_is_kept() {
        let program = link_program_with_bun_modules(&[("index.js", "export {};\n")]);
        let sources = RuntimeModules::new(Archive::embedded(), false);
        let mut compiled_count = 0;
        for &module in STARTUP_MODULES {
            if sources.module_path(module).is_none() {
                continue;
            }
            let mut records = program.modules.iter();
            let record = records.find(|record| record.runtime_module == Some(module));
            assert!(
                record.is_some_and(|record| record.body.is_some()),
                "{module:?}"
            );
            compiled_count += 1;
        }
        assert!(compiled_count > 0);
    }

    #[test]
    fn host_value_names_its_importer() {
        let program = link_program(&[("index.js", "export const main = import('bun:main');\n")]);
        let external = find_record(&program, "bun:main").expect("the import names no module");
        assert_eq!(external.external_kind, ExternalKind::HostValue);
        assert_eq!(external.referrer, find_module(&program, "index.js"));
    }

    #[test]
    fn deferred_request_is_evaluated() {
        let program = link_program(&[
            ("index.js", "import defer * as later from './later.js';\n"),
            ("later.js", "export const value = 1;\n"),
        ]);
        assert!(is_evaluated(&program, "later.js"));
    }

    #[test]
    fn name_of_star_export_is_listed_where_it_is_read() {
        let program = link_program(&[
            ("index.js", "export * from './barrel.js';\n"),
            ("barrel.js", "export const own = 1;\n"),
        ]);
        assert_eq!(export_names(&program, "index.js"), [b"own"]);
        assert!(export_names(&program, "barrel.js").is_empty());
    }

    fn has_function_named(program: &Program, name: &[u8]) -> bool {
        let mut names = program
            .functions
            .iter()
            .filter_map(|function| function.name);
        names.any(|id| program.strings.get(id) == name)
    }

    const LIBRARY: (&str, &str) = (
        "library.js",
        "export function libraryFirst() {}\nexport function librarySecond() {}\n",
    );

    #[test]
    fn export_nobody_reads_is_no_export() {
        let program = link_program(&[("main.js", "import './library.js';\n"), LIBRARY]);
        assert!(export_names(&program, "library.js").is_empty());
    }

    #[test]
    fn function_only_dropped_code_names_is_dropped() {
        let library =
            "export function exported() {}\nfunction internal() {\n  return internal;\n}\n";
        let files = [
            ("main.js", "import './library.js';\n"),
            ("library.js", library),
        ];
        let program = link_program(&files);
        assert!(has_function_named(&program, b"exported"));
        assert!(!has_function_named(&program, b"internal"));
    }

    #[test]
    fn namespace_object_keeps_every_export() {
        let main = "import * as library from './library.js';\nconsole.log(library);\n";
        let program = link_program(&[("main.js", main), LIBRARY]);
        assert!(has_function_named(&program, b"libraryFirst"));
        assert!(has_function_named(&program, b"librarySecond"));
    }

    const ENTRY_POINT_WITH_EXPORTS: [(&str, &str); 2] = [
        (
            "main.js",
            "import './library.js';\nexport function entryUnread() {}\nexport default { port: 1 };\n",
        ),
        LIBRARY,
    ];

    #[test]
    fn entry_point_export_the_host_does_not_read_is_kept() {
        let program = link_program(&ENTRY_POINT_WITH_EXPORTS);
        assert!(has_function_named(&program, b"entryUnread"));
        let names: [&[u8]; 2] = [b"default", b"entryUnread"];
        assert_eq!(export_names(&program, "main.js"), names);
    }
}
