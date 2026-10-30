#[cfg(test)]
mod tests;

use super::entries::build_entries;
use super::keys::MergedKeys;
use super::module_marks::{exported_variable_key, holds_exports_in_variable, is_filled_by_loader};
use super::program_keys::{ProgramFunctionKey, ProgramModule, ProgramVariableKey};
use super::state::{
    Definitions, ExportWriter, ModuleRecords, ModuleTable, Numbering, VariableDefinition,
};
use super::unit::LinkUnit;
use super::{LinkError, LinkProject, key_context};
use crate::builtins::{RuntimeModule, table};
use crate::ir::generated::{
    self, ModuleExportKind, ModuleFlags, RuntimeFunctionEntry, WebAssemblyModule,
};
use crate::ir::{FunctionId, Id, ModuleId, StringId, StringTable, VariableId, VariableKey};
use crate::load::sources::parsed_source;
use crate::load::{PerProject, ProgramFile, ProjectId, SourceKind};
use crate::modules::{
    self, ExportBinding, ExportLookup, ImportBinding, Interop, ModuleFailureKind, ModuleKind,
    ModuleRef, compare_code_units,
};
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::program::FileId;
use bun_sema::resolve::ExternalKind;
use bun_sema::util::SharedSort;
use core::cell::Cell;
use rustc_hash::FxHashMap;

pub(super) struct RecordInput<'a, 's> {
    pub projects: &'a PerProject<LinkProject<'a, 's>>,
    pub atoms: &'a Interner<'s>,
    pub modules: &'a ModuleTable,
    pub functions: &'a MergedKeys<ProgramFunctionKey>,
    pub variables: &'a MergedKeys<ProgramVariableKey>,
    pub definitions: &'a Definitions,
    pub numbering: &'a Numbering,
    pub progress: RecordProgress,
}

#[derive(Default)]
pub(super) struct RecordProgress {
    current: Cell<Option<ProgramModule>>,
    error: Cell<Option<LinkError>>,
}

impl RecordInput<'_, '_> {
    fn id_of(&self, project: ProjectId, module: ModuleRef) -> ModuleId {
        let module = key_context(self.projects, project).module(module);
        let index = self.modules.index_by_module.get(&module);
        if let Some(id) = index.and_then(|&index| self.numbering.modules[index as usize]) {
            return id;
        }
        let error = LinkError::MissingRecord {
            module,
            named_by: self.progress.current.get(),
        };
        let first = self.progress.error.take();
        self.progress.error.set(first.or(Some(error)));
        ModuleId::new(0)
    }

    fn exported_variable(&self, project: ProjectId, key: VariableKey) -> VariableId {
        let key = key_context(self.projects, project).variable_key(key);
        let merged = self.variables.find(&key);
        let merged = merged.expect("the mark reports an export without a variable");
        self.numbering.variables[merged as usize]
            .expect("link dropped the variable of an export that is read")
    }

    fn body_of(&self, module: ProgramModule) -> FunctionId {
        let key = module
            .body_key()
            .expect("the fragment names the body of a file");
        let merged = self.functions.find(&key);
        let merged = merged.expect("the mark reports a record without a body");
        self.numbering.functions[merged as usize].expect("link dropped the body of a record")
    }

    fn exports_variable(&self, module: ProgramModule) -> Option<VariableId> {
        let key = module.exports_variable_key()?;
        let (project, own) = module.in_own_project()?;
        if !holds_exports_in_variable(self.projects.get(project).graph, own) {
            return None;
        }
        self.numbering.variables[self.variables.find(&key)? as usize]
    }
}

pub(super) fn build_module_records(
    units: &mut [LinkUnit],
    input: &RecordInput<'_, '_>,
    strings: &mut StringTable,
) -> Result<ModuleRecords, LinkError> {
    let mut builder = RecordBuilder {
        input,
        strings: &mut *strings,
        names: FxHashMap::default(),
        synthetic_exports: collect_synthetic_exports(input),
        is_named_at_run_time: find_modules_named_at_run_time(input),
    };
    let modules = builder.build_modules(units);
    input.progress.current.set(None);
    let module_failures = builder.build_failures();
    if let Some(error) = input.progress.error.take() {
        return Err(error);
    }
    Ok(ModuleRecords {
        modules,
        module_failures,
        entries: build_entries(input, strings),
        runtime_functions: collect_runtime_functions(input),
        web_assembly_modules: collect_web_assembly_modules(input),
    })
}

#[derive(Copy, Clone)]
struct MergedSyntheticExport {
    name: Atom,
    merged_variable: u32,
    is_known_member: bool,
    is_replaceable: bool,
}

fn collect_synthetic_exports(input: &RecordInput<'_, '_>) -> Vec<Vec<MergedSyntheticExport>> {
    let mut exports = vec![Vec::new(); input.modules.modules.len()];
    for (merged_variable, definition) in input.definitions.variables.iter().enumerate() {
        match *definition {
            Some(VariableDefinition::SyntheticExport {
                module,
                name,
                is_known_member,
                is_replaceable,
                writer: ExportWriter::Loader | ExportWriter::Face | ExportWriter::Capture,
            }) => exports[module as usize].push(MergedSyntheticExport {
                name,
                merged_variable: merged_variable as u32,
                is_known_member,
                is_replaceable,
            }),
            Some(
                VariableDefinition::SyntheticExport {
                    writer: ExportWriter::Body,
                    ..
                }
                | VariableDefinition::Unit(_),
            )
            | None => {}
        }
    }
    let atoms = input.atoms;
    for module_exports in &mut exports {
        module_exports.shared_sort_unstable_by(|a, b| {
            compare_code_units(atoms.bytes(a.name), atoms.bytes(b.name))
        });
    }
    exports
}

fn find_modules_named_at_run_time(input: &RecordInput<'_, '_>) -> Vec<bool> {
    let mut is_named_at_run_time = vec![false; input.modules.modules.len()];
    for (project, linked) in input.projects.iter() {
        let named = linked.sources.modules_named_at_run_time().iter();
        for file in named.filter_map(|&module| linked.sources.runtime_module_file(module)) {
            let module = ProgramModule::File(ProgramFile { project, file });
            if let Some(&index) = input.modules.index_by_module.get(&module) {
                is_named_at_run_time[index as usize] = true;
            }
        }
    }
    is_named_at_run_time
}

struct RecordBuilder<'b, 'a, 's> {
    input: &'b RecordInput<'a, 's>,
    strings: &'b mut StringTable,
    names: FxHashMap<Atom, StringId>,
    synthetic_exports: Vec<Vec<MergedSyntheticExport>>,
    is_named_at_run_time: Vec<bool>,
}

impl RecordBuilder<'_, '_, '_> {
    fn intern_atom(&mut self, atom: Atom) -> StringId {
        let (atoms, strings) = (self.input.atoms, &mut *self.strings);
        *self
            .names
            .entry(atom)
            .or_insert_with(|| strings.intern(atoms.bytes(atom)))
    }

    fn build_modules(&mut self, units: &mut [LinkUnit]) -> Vec<generated::Module> {
        let input = self.input;
        let mut records = Vec::with_capacity(input.numbering.counts.modules);
        for (index, &module) in (0..).zip(&input.modules.modules) {
            let Some(id) = input.numbering.modules[index as usize] else {
                continue;
            };
            debug_assert_eq!(id.index(), records.len());
            input.progress.current.set(Some(module));
            records.push(match module {
                ProgramModule::File(file) => self.build_file_record(units, index, file),
                ProgramModule::Inner { file, .. }
                | ProgramModule::Face(file)
                | ProgramModule::Check(file) => self.build_further_record(index, module, file),
                ProgramModule::Runtime(runtime_module) => {
                    let path = self.strings.intern(table::specifier_of(runtime_module));
                    let mut record = create_record(Interop::RUNTIME, path, path);
                    record.runtime_module = Some(runtime_module);
                    record.other_names = self.other_names_of(Some(runtime_module));
                    record.synthetic_exports = self.build_synthetic_exports(index);
                    record.flags |= self.flags_of_runtime_module(Some(runtime_module));
                    record
                }
                ProgramModule::External {
                    importer,
                    specifier,
                } => self.build_external_record(index, importer, specifier),
            });
        }
        records
    }

    fn build_external_record(
        &mut self,
        index: u32,
        importer: ProgramFile,
        specifier: Atom,
    ) -> generated::Module {
        let graph = self.input.projects.get(importer.project).graph;
        let kind = graph.external_kind(ModuleRef::External {
            importer: importer.file,
            specifier,
        });
        let kind = kind.unwrap_or(ExternalKind::UncompiledCode);
        let path = self.intern_atom(specifier);
        let mut record = create_record(Interop::of_external(kind), path, path);
        let referrer = ModuleRef::File(importer.file);
        record.referrer = Some(self.input.id_of(importer.project, referrer));
        match kind {
            ExternalKind::UncompiledCode => {
                record.external_kind = generated::ExternalKind::UncompiledCode;
            }
            ExternalKind::HostValue => {
                record.external_kind = generated::ExternalKind::HostValue;
                record.synthetic_exports = self.build_synthetic_exports(index);
            }
        }
        record
    }

    fn build_file_record(
        &mut self,
        units: &mut [LinkUnit],
        index: u32,
        file: ProgramFile,
    ) -> generated::Module {
        let input = self.input;
        let LinkProject { graph, sources, .. } = *input.projects.get(file.project);
        let paths = sources.module_paths(file.file);
        let path = self.strings.intern(paths.public_path);
        let display_path = self.strings.intern(paths.display_path);
        let interop = graph.interop(ModuleRef::File(file.file));
        let mut record = create_record(interop, path, display_path);
        // A stack trace names the file that evaluates a text, as the engine does for `new Function(text)`.
        if let Some(evaluator) = sources.evaluator_of(file.file) {
            record.referrer = Some(input.id_of(file.project, ModuleRef::File(evaluator)));
        }

        let unit = input.modules.unit_by_module[index as usize];
        if let Some(unit) = unit {
            let fragment = &mut units[unit as usize].module;
            record.positions = core::mem::take(&mut fragment.positions);
        }
        let Some(unit) = unit.filter(|_| !graph.is_library(file.file)) else {
            record.flags = ModuleFlags::IS_LIBRARY;
            return record;
        };

        if graph.has_no_side_effects(file.file) {
            record.flags |= ModuleFlags::HAS_NO_SIDE_EFFECTS;
        }
        if is_bundler_helper(sources.kind(file.file), interop.kind) {
            record.flags |= ModuleFlags::IS_BUNDLER_HELPER;
        }
        let fragment = &units[unit as usize].module;
        let ids = &input.numbering.units[unit as usize];
        record.body = find_program_id(fragment.body, &ids.functions);
        match interop.kind {
            ModuleKind::SourceText => {
                record.flags |= self.planned_flags(file.project, ModuleRef::File(file.file));
                record.data = find_program_id(fragment.data, &ids.data);
                self.fill_export_table_record(file, &mut record);
            }
            ModuleKind::Data => {
                if graph.may_be_mocked(ModuleRef::File(file.file)) {
                    record.flags |= ModuleFlags::MAY_BE_MOCKED;
                }
                record.data = find_program_id(fragment.data, &ids.data);
                self.fill_export_table_record(file, &mut record);
            }
            // The body stores the names that somebody reads, so the loader has nothing to fill.
            ModuleKind::CommonJs => {
                let own = ModuleRef::File(file.file);
                record.flags |= self.planned_flags(file.project, own);
                record.requests = self.build_requests(file.project, own);
                record.exports_variable = input.exports_variable(ProgramModule::File(file));
            }
            ModuleKind::RuntimeSource => {
                record.runtime_module = graph.runtime_module(file.file);
                record.other_names = self.other_names_of(record.runtime_module);
                record.flags |= self.flags_of_runtime_module(record.runtime_module);
                record.synthetic_exports = self.build_synthetic_exports(index);
                // Native code asks for a module by its number. Only a name that the build does not know is looked up among the modules.
                if !self.is_named_at_run_time[index as usize] {
                    record.flags |= ModuleFlags::IS_LOADED_BY_IMPORT_ONLY;
                }
            }
            ModuleKind::Runtime | ModuleKind::External => {
                unreachable!("a file is never a Runtime or External module")
            }
        }
        record
    }

    // A record that a file has beside its own: the face, the check.
    fn build_further_record(
        &mut self,
        index: u32,
        module: ProgramModule,
        file: ProgramFile,
    ) -> generated::Module {
        let input = self.input;
        let LinkProject { graph, sources, .. } = *input.projects.get(file.project);
        let (project, own) = module
            .in_own_project()
            .expect("the record belongs to a file");
        let id = input.numbering.modules[index as usize].expect("every module has an id");
        let path = self.strings.intern(format!("#{}", id.index()).as_bytes());
        let display_path = self
            .strings
            .intern(sources.module_paths(file.file).display_path);
        let interop = graph.interop(own);
        let mut record = create_record(interop, path, display_path);
        record.flags = self.planned_flags(project, own);
        if is_bundler_helper(sources.kind(file.file), interop.kind) {
            record.flags |= ModuleFlags::IS_BUNDLER_HELPER;
        }
        record.body = Some(input.body_of(module));
        record.requests = self.build_requests(project, own);
        record.exports_variable = input.exports_variable(module);
        match module {
            ProgramModule::Face(_) if is_filled_by_loader(graph, own) => {
                record.synthetic_exports = self.build_synthetic_exports(index);
            }
            ProgramModule::Face(_) => {
                record.exports = self.build_exports(project, graph.exports_of(own));
            }
            ProgramModule::Inner { .. } | ProgramModule::Check(_) => {}
            ProgramModule::File(_) | ProgramModule::Runtime(_) | ProgramModule::External { .. } => {
                unreachable!("the record belongs to a file")
            }
        }
        record
    }

    // The application says what it does to a module of the library.
    // "sys" finds node:util. The engine knows the path of a module and not how else the resolver spells it.
    fn other_names_of(&mut self, module: Option<RuntimeModule>) -> Vec<StringId> {
        let Some(module) = module else {
            return Vec::new();
        };
        let path = table::specifier_of(module);
        let aliases = BUN_ALIASES.iter().copied().flatten();
        let names = aliases.filter(|(name, alias)| {
            *name != path
                && Some(*name) != path.strip_prefix(b"node:")
                && table::module_by_specifier(alias.path.as_bytes()) == Some(module)
        });
        names.map(|(name, _)| self.strings.intern(name)).collect()
    }

    fn flags_of_runtime_module(&self, module: Option<RuntimeModule>) -> ModuleFlags {
        let graph = self.input.projects.get(ProjectId::Application).graph;
        match module {
            Some(module) if graph.may_be_mocked(ModuleRef::Runtime(module)) => {
                ModuleFlags::MAY_BE_MOCKED
            }
            Some(_) | None => ModuleFlags::default(),
        }
    }

    fn planned_flags(&self, project: ProjectId, module: ModuleRef) -> ModuleFlags {
        let graph = self.input.projects.get(project).graph;
        let mut flags = ModuleFlags::default();
        if graph.keeps_error(module) {
            flags |= ModuleFlags::KEEPS_ERROR;
        }
        if graph.is_loaded_by_loader(module) {
            flags |= ModuleFlags::IS_LOADED_BY_LOADER;
        }
        if graph.is_required_during_load(module) {
            flags |= ModuleFlags::IS_REQUIRED_DURING_LOAD;
        }
        if graph.may_be_imported_while_it_runs(module) {
            flags |= ModuleFlags::MAY_BE_IMPORTED_WHILE_IT_RUNS;
        }
        if graph.is_imported_as_namespace(module) {
            flags |= ModuleFlags::IS_IMPORTED_AS_NAMESPACE;
        }
        if graph.may_be_mocked(module) {
            flags |= ModuleFlags::MAY_BE_MOCKED;
        }
        if graph.may_be_evicted() && graph.is_code_of_program(module) {
            flags |= ModuleFlags::MAY_BE_EVICTED;
        }
        if graph.names_way_to_module_objects(module) {
            flags |= ModuleFlags::NAMES_WAY_TO_MODULE_OBJECTS;
        }
        if graph.is_found_by_name(module) {
            flags |= ModuleFlags::IS_FOUND_BY_NAME;
        }
        flags
    }

    fn build_requests(
        &self,
        project: ProjectId,
        module: ModuleRef,
    ) -> Vec<generated::ModuleRequest> {
        let input = self.input;
        let requests = input.projects.get(project).graph.requests_of(module).iter();
        requests
            .map(|request| generated::ModuleRequest {
                target: input.id_of(project, request.target),
                phase: request.phase,
                is_dynamic_star_export: request.is_dynamic_star_export,
                kind: request.kind,
                completes: request.completes,
                is_hoisted: request.is_hoisted,
            })
            .collect()
    }

    fn build_exports(
        &mut self,
        project: ProjectId,
        exports: &[modules::ModuleExport],
    ) -> Vec<generated::ModuleExport> {
        exports
            .iter()
            .filter(|export| export.is_read_from_object)
            .filter_map(|export| self.build_export(project, export))
            .collect()
    }

    fn fill_export_table_record(&mut self, file: ProgramFile, record: &mut generated::Module) {
        let input = self.input;
        let ProgramFile { project, file } = file;
        let graph = input.projects.get(project).graph;
        if graph.has_top_level_await(file) {
            record.flags |= ModuleFlags::HAS_TOP_LEVEL_AWAIT;
        }
        record.requests = self.build_requests(project, ModuleRef::File(file));
        record.exports = self.build_exports(project, graph.exports(file));
        record.required_names = graph
            .required_names(file)
            .iter()
            .map(|required| generated::RequiredName {
                module: input.id_of(project, required.module),
                name: self.intern_atom(required.name),
                may_be_absent: false,
                export_name: (required.asked_by).map(|it| self.intern_atom(it.export_name)),
                specifier: (required.asked_by).map(|it| self.intern_atom(it.specifier)),
            })
            .collect();
        let requests = graph.requests_of(ModuleRef::File(file));
        let is_requested = |module: ModuleRef| requests.iter().any(|it| it.target == module);
        // The loader may be left with an empty record of such a file, which lacks even `default`. A link asks for what the module hands on before what it imports.
        let default_of = |export: modules::SyntheticExportId| {
            let export = graph.synthetic_export(export);
            (export.name == known::default).then_some(export.module)
        };
        let written = graph.exports(file).iter();
        let handed_on = written.filter(|export| !export.is_from_star_export);
        let handed_on = handed_on.filter_map(|export| match export.binding {
            ExportBinding::Synthetic(id) => Some((default_of(id)?, Some(export.name))),
            ExportBinding::Indirect { module, name } if name == known::default => {
                Some((module, Some(export.name)))
            }
            _ => None,
        });
        let imported = graph.import_bindings(file).iter();
        let imported = imported.filter_map(|&(_, binding)| match binding {
            ImportBinding::Synthetic(export) => Some((default_of(export)?, None)),
            ImportBinding::Exports { module } => Some((module, None)),
            _ => None,
        });
        let mut asked_for_default: Vec<(FileId, Option<Atom>)> = Vec::new();
        for (exporter, export_name) in handed_on.chain(imported) {
            if let ModuleRef::File(exporter) = exporter
                && graph.may_be_imported_while_it_runs(ModuleRef::File(exporter))
                && !asked_for_default.iter().any(|asked| asked.0 == exporter)
            {
                asked_for_default.push((exporter, export_name));
            }
        }
        let written = graph.requests(file);
        for (file, export_name) in asked_for_default {
            // The name comes through an export statement of another module, whose link fails first.
            let is_written = written.iter().any(|it| it.target == ModuleRef::File(file));
            let export_name = export_name.or_else(|| (!is_written).then_some(known::default));
            let exporter = graph.face(ModuleRef::File(file));
            let exporter = exporter.unwrap_or(ModuleRef::File(file));
            // Tree shaking drops an unused import of a file without side effects, and the file may go with it.
            if !is_requested(exporter) {
                continue;
            }
            let path = input.projects.get(project).sources.public_path(file);
            record.required_names.push(generated::RequiredName {
                module: input.id_of(project, exporter),
                name: self.intern_atom(known::default),
                may_be_absent: false,
                export_name: export_name.map(|name| self.intern_atom(name)),
                specifier: export_name.map(|_| self.strings.intern(path)),
            });
        }
    }

    // A name of an ES module of the other project is bound here, where both export tables are at hand.
    fn find_binding_in_other_project(
        &self,
        project: ProjectId,
        binding: ExportBinding,
    ) -> Option<(ProjectId, ExportBinding)> {
        let ExportBinding::Indirect { module, name } = binding else {
            return Some((project, binding));
        };
        let projects = self.input.projects;
        let ProgramModule::File(target) = key_context(projects, project).module(module) else {
            return Some((project, binding));
        };
        let graph = projects.get(target.project).graph;
        match graph.find_export(ModuleRef::File(target.file), name, self.input.atoms) {
            ExportLookup::Found(found) => Some((target.project, found)),
            // The run looks behind the stars of a file of the same project.
            ExportLookup::Unknown if matches!(module, ModuleRef::File(_)) => {
                Some((project, binding))
            }
            ExportLookup::Unknown | ExportLookup::Absent => None,
        }
    }

    fn build_export(
        &mut self,
        project: ProjectId,
        export: &modules::ModuleExport,
    ) -> Option<generated::ModuleExport> {
        let input = self.input;
        let (project, binding) = self.find_binding_in_other_project(project, export.binding)?;
        let binding = match input.projects.get(project).graph.lazy_export(binding) {
            Some((module, name)) => ExportBinding::Indirect { module, name },
            None => binding,
        };
        let unbound = generated::ModuleExport {
            name: self.intern_atom(export.name),
            is_from_star_export: export.is_from_star_export,
            ..generated::ModuleExport::default()
        };
        Some(match binding {
            ExportBinding::Variable(_) | ExportBinding::Synthetic(_) => {
                let key = exported_variable_key(input.projects.get(project).graph, binding);
                let key = key.expect("the binding is a variable");
                generated::ModuleExport {
                    kind: ModuleExportKind::Variable,
                    variable: Some(input.exported_variable(project, key)),
                    ..unbound
                }
            }
            ExportBinding::Namespace { module, phase } => generated::ModuleExport {
                kind: ModuleExportKind::Namespace,
                module: Some(input.id_of(project, module)),
                phase,
                ..unbound
            },
            ExportBinding::Indirect { module, name } => generated::ModuleExport {
                kind: ModuleExportKind::Indirect,
                module: Some(input.id_of(project, module)),
                import_name: Some(self.intern_atom(name)),
                ..unbound
            },
        })
    }

    fn build_synthetic_exports(&mut self, index: u32) -> Vec<generated::SyntheticExport> {
        let exports = core::mem::take(&mut self.synthetic_exports[index as usize]);
        let mut records = Vec::with_capacity(exports.len());
        for export in exports {
            let variable = self.input.numbering.variables[export.merged_variable as usize];
            if export.is_known_member && variable.is_none() && !export.is_replaceable {
                continue;
            }
            records.push(generated::SyntheticExport {
                name: self.intern_atom(export.name),
                variable,
                is_known_member: export.is_known_member,
                is_replaceable: export.is_replaceable,
            });
        }
        records
    }

    fn build_failures(&mut self) -> Vec<generated::ModuleFailure> {
        let input = self.input;
        let mut records = Vec::with_capacity(input.numbering.counts.module_failures);
        for (project, linked) in input.projects.iter() {
            let ids = input.numbering.module_failures.get(project);
            for (failure, id) in linked.graph.failures().iter().zip(ids) {
                let Some(id) = id else {
                    continue;
                };
                debug_assert_eq!(id.index(), records.len());
                records.push(self.build_failure(project, failure));
            }
        }
        records
    }

    fn build_failure(
        &mut self,
        project: ProjectId,
        failure: &modules::ModuleFailure,
    ) -> generated::ModuleFailure {
        // Where a module lacks a name, the name stands in the place of the specifier.
        let mut export_specifier = None;
        let (specifier, exporter) = match failure.kind {
            ModuleFailureKind::NotAProgram { .. } => {
                let sources = self.input.projects.get(project).sources;
                let path = sources.module_paths(failure.importer).public_path;
                (self.strings.intern(path), None)
            }
            ModuleFailureKind::Unresolved { specifier, .. }
            | ModuleFailureKind::UnresolvedAtLoad { specifier, .. } => {
                (self.intern_atom(specifier), None)
            }
            ModuleFailureKind::ExportMayBeAbsent {
                exporter,
                name,
                asked_by,
            } => {
                // An export statement is quoted: the name that it exports, and what it is written from.
                export_specifier = asked_by.map(|it| self.intern_atom(it.specifier));
                let name = asked_by.map_or(name, |it| it.export_name);
                (self.intern_atom(name), Some(exporter))
            }
            ModuleFailureKind::ExportNotFound { .. }
            | ModuleFailureKind::ExportAmbiguous { .. } => {
                unreachable!("a name that cannot be bound stops the build")
            }
        };
        generated::ModuleFailure {
            importer: self.input.id_of(project, ModuleRef::File(failure.importer)),
            specifier,
            exporter: exporter.map(|exporter| self.input.id_of(project, exporter)),
            export_specifier,
        }
    }
}

fn create_record(interop: Interop, path: StringId, display_path: StringId) -> generated::Module {
    generated::Module {
        path,
        display_path,
        kind: interop.kind,
        export_rule: interop.export_rule,
        require_result: interop.require_result,
        ..generated::Module::default()
    }
}

// Code of Bun's that is loaded like a file of the program: what the bundler imports for the constructs it lowers, as "bun:wrap" is.
fn is_bundler_helper(source: SourceKind, kind: ModuleKind) -> bool {
    match source {
        SourceKind::RuntimeModule(_) => {
            matches!(kind, ModuleKind::SourceText | ModuleKind::CommonJs)
        }
        _ => false,
    }
}

fn find_program_id<I: Id>(local: Option<I>, ids: &[Option<I>]) -> Option<I> {
    let id = ids[local?.index()];
    Some(id.expect("link dropped the body or the data of an evaluated module"))
}

fn collect_runtime_functions(input: &RecordInput<'_, '_>) -> Vec<RuntimeFunctionEntry> {
    let roots = input.definitions.runtime_functions.iter();
    let entries: Vec<RuntimeFunctionEntry> = roots
        .map(|root| RuntimeFunctionEntry {
            function: input.numbering.functions[root.function as usize]
                .expect("link dropped a runtime function"),
            ..root.entry
        })
        .collect();
    debug_assert!(entries.is_sorted_by(|a, b| a.id < b.id));
    entries
}

fn collect_web_assembly_modules(input: &RecordInput<'_, '_>) -> Vec<WebAssemblyModule> {
    let LinkProject {
        loaded, sources, ..
    } = input.projects.application;
    let files = loaded.files();
    let mut modules = Vec::new();
    for &file in sources.web_assembly_files() {
        let program_file = ProgramFile {
            project: ProjectId::Application,
            file,
        };
        // Each entry point is linked by itself, and another one may be the only one that imports the file.
        let Some(&index) = (input.modules.index_by_module).get(&ProgramModule::File(program_file))
        else {
            continue;
        };
        let module = input.numbering.modules[index as usize].expect("every module has an id");
        let source = parsed_source(files, file).expect("every loaded tree has a payload");
        let bytes = source.web_assembly.clone();
        modules.push(WebAssemblyModule {
            module,
            bytes: bytes.expect("the payload of a WebAssembly file holds its bytes"),
        });
    }
    modules
}
