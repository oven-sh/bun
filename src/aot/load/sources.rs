mod freeze;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use bun_ast::Loader;
use bun_builtin_sources::{Manifest, VIRTUAL_ROOT};
use bun_sema::program::{CodeView, FileId, Files};
use bun_sema::resolve::HostPayload;

pub(crate) use self::freeze::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources,
};
use crate::builtins::{ResolvedBuiltins, RuntimeFunction, RuntimeModule, table};
use crate::diagnostics::FileDiagnostic;
use crate::load::contents::FileContents;
use crate::load::contents::load_names::NamedModule;
use crate::load::module_paths::{compute_display_path, with_separators_of_host};
#[cfg(test)]
use crate::load::project::ProjectId;
use crate::lower;
use crate::module_keys::is_name_of_text;
use crate::test_runs::FileOfRun;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SourceKind {
    Program,
    Data,
    RuntimeModule(RuntimeModule),
    RuntimeFunctions,
    TypesOnly,
}

impl SourceKind {
    pub fn lowering_kind(self) -> Option<lower::SourceKind> {
        match self {
            SourceKind::Program | SourceKind::Data => Some(lower::SourceKind::Program),
            SourceKind::RuntimeModule(module) => Some(lower::SourceKind::RuntimeModule(module)),
            SourceKind::RuntimeFunctions => Some(lower::SourceKind::RuntimeFunctions),
            SourceKind::TypesOnly => None,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum EntryPointKind {
    Main,
    Additional,
    LoadedByTestRunner,
    HostLoadedModule,
    ImportedModule,
    Library,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct EntryPoint {
    pub file: FileId,
    pub kind: EntryPointKind,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModulePaths<'a> {
    pub public_path: &'a [u8],
    pub display_path: &'a [u8],
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) struct PluginModuleName {
    pub namespace: Box<[u8]>,
    pub path: Box<[u8]>,
}

pub(crate) struct FileWithQuery {
    pub file: Box<[u8]>,
    pub query: Box<[u8]>,
}

pub(crate) struct ParsedSource {
    pub kind: SourceKind,
    pub loader: Loader,
    pub plugin_module: Option<PluginModuleName>,
    pub file_with_query: Option<FileWithQuery>,
    pub web_assembly: Option<Vec<u8>>,
    pub has_compiled_components: bool,
    pub parse_failure: Option<Vec<u8>>,
    pub refused_json: Option<Vec<u8>>,
    pub is_language_assumed: bool,
    pub builtins: ResolvedBuiltins,
    pub library_modules_named_in_text_left_to_run_time: Vec<RuntimeModule>,
    pub manual_mocks: Vec<Vec<u8>>,
    pub contents: FileContents,
    pub of_run: FileOfRun,
    pub byte_count: usize,
    pub diagnostics: Vec<FileDiagnostic>,
}

impl ParsedSource {
    pub(crate) fn new(kind: SourceKind, loader: Loader) -> ParsedSource {
        ParsedSource {
            kind,
            loader,
            plugin_module: None,
            file_with_query: None,
            web_assembly: None,
            has_compiled_components: false,
            parse_failure: None,
            refused_json: None,
            is_language_assumed: false,
            builtins: ResolvedBuiltins::default(),
            library_modules_named_in_text_left_to_run_time: Vec::new(),
            manual_mocks: Vec::new(),
            contents: FileContents::default(),
            of_run: FileOfRun::default(),
            byte_count: 0,
            diagnostics: Vec::new(),
        }
    }

    pub(crate) fn named_modules(&self) -> &[NamedModule] {
        self.contents.names.all_modules()
    }
}

pub(crate) fn parsed_source<'s>(files: &Files<'s>, file: FileId) -> Option<&'s ParsedSource> {
    files.host_payload(file)?.downcast_ref::<ParsedSource>()
}

pub(crate) fn parsed_source_in<'f>(
    files: &'f dyn CodeView<'_>,
    file: FileId,
) -> Option<&'f ParsedSource> {
    files.host_payload(file)?.downcast_ref::<ParsedSource>()
}

pub(crate) fn parsed_source_mut(payload: &mut Option<HostPayload>) -> &mut ParsedSource {
    let payload = payload
        .as_mut()
        .expect("parse_code gives every tree a payload");
    let source = payload.downcast_mut::<ParsedSource>();
    source.expect("the payload of a tree is a ParsedSource")
}

pub(crate) fn find_runtime_function(
    manifest: &Manifest,
    path: &[u8],
    export_name: &[u8],
) -> Option<RuntimeFunction> {
    let id = manifest.builtin_function_id(path, export_name);
    id.map(RuntimeFunction)
        .or_else(|| find_compiler_function(path, export_name))
}

fn find_compiler_function(path: &[u8], export_name: &[u8]) -> Option<RuntimeFunction> {
    let archive_name = path.strip_prefix(VIRTUAL_ROOT)?;
    let file = archive_name.strip_suffix(b".ts")?;
    let mut functions = table::runtime_functions().iter();
    let found = functions
        .find(|data| data.file.as_bytes() == file && data.export_name.as_bytes() == export_name)?;
    Some(found.function)
}

#[derive(Clone)]
struct SourceEntry {
    kind: SourceKind,
    loader: Loader,
    byte_count: u64,
    public_path: Box<[u8]>,
    display_path: OnceLock<Box<[u8]>>,
    diagnostic_path: Box<[u8]>,
}

#[derive(Clone)]
pub struct Sources {
    #[cfg(test)]
    project: ProjectId,
    entries: Vec<SourceEntry>,
    project_root: Box<[u8]>,
    root_of_executable: Option<Box<[u8]>>,
    entry_points: Vec<EntryPoint>,
    runtime_module_files: Vec<(RuntimeModule, FileId)>,
    modules_named_at_run_time: Vec<RuntimeModule>,
    web_assembly_files: Vec<FileId>,
    entry_points_found_by_computed_names: Vec<FileId>,
    manifest: &'static Manifest,
    holds_source_paths: Arc<AtomicBool>,
}

impl Sources {
    #[cfg(test)]
    pub fn project(&self) -> ProjectId {
        self.project
    }

    pub fn kind(&self, file: FileId) -> SourceKind {
        self.entries[file.idx()].kind
    }

    pub fn is_data(&self, file: FileId) -> bool {
        self.kind(file) == SourceKind::Data
    }

    pub fn loader(&self, file: FileId) -> Loader {
        self.entries[file.idx()].loader
    }

    pub fn byte_count(&self, file: FileId) -> u64 {
        self.entries[file.idx()].byte_count
    }

    pub fn module_paths(&self, file: FileId) -> ModulePaths<'_> {
        let entry = &self.entries[file.idx()];
        let compute = || compute_display_path(&self.project_root, &entry.diagnostic_path);
        ModulePaths {
            public_path: &entry.public_path,
            display_path: entry.display_path.get_or_init(compute),
        }
    }

    pub fn public_path(&self, file: FileId) -> &[u8] {
        &self.entries[file.idx()].public_path
    }

    pub fn root_of_executable(&self) -> Option<&[u8]> {
        self.root_of_executable.as_deref()
    }

    pub fn diagnostic_path(&self, file: FileId) -> &[u8] {
        &self.entries[file.idx()].diagnostic_path
    }

    pub fn is_in_coverage_report(&self, file: FileId) -> bool {
        let path = self.diagnostic_path(file);
        self.kind(file) == SourceKind::Program
            && !bun_core::strings::contains(path, b"/node_modules/")
            && !bun_core::strings::contains(path, b"\\node_modules\\")
    }

    fn find_source_path(&self, file: FileId) -> Option<Vec<u8>> {
        let entry = &self.entries[file.idx()];
        if is_name_of_text(&entry.diagnostic_path) {
            return None;
        }
        let path = with_separators_of_host(&entry.diagnostic_path, cfg!(windows));
        (*path != *entry.public_path).then_some(path)
    }

    pub fn has_source_path(&self, file: FileId) -> bool {
        self.find_source_path(file).is_some()
    }

    pub fn source_path(&self, file: FileId) -> Option<Vec<u8>> {
        let path = self.find_source_path(file)?;
        self.holds_source_paths.store(true, Ordering::Relaxed);
        Some(path)
    }

    pub fn note_source_paths_at_run_time(&self) {
        self.holds_source_paths.store(true, Ordering::Relaxed);
    }

    pub fn holds_source_paths(&self) -> bool {
        self.holds_source_paths.load(Ordering::Relaxed)
    }

    pub fn entry_points(&self) -> &[EntryPoint] {
        &self.entry_points
    }

    pub fn is_entry_point_found_by_computed_name(&self, file: FileId) -> bool {
        self.entry_points_found_by_computed_names.contains(&file)
    }

    pub fn runtime_module_file(&self, module: RuntimeModule) -> Option<FileId> {
        let files = &self.runtime_module_files;
        let index = files
            .binary_search_by_key(&module.registry_id(), |entry| entry.0.registry_id())
            .ok()?;
        Some(files[index].1)
    }

    pub fn runtime_module_files(&self) -> &[(RuntimeModule, FileId)] {
        &self.runtime_module_files
    }

    pub fn modules_named_at_run_time(&self) -> &[RuntimeModule] {
        &self.modules_named_at_run_time
    }

    pub fn runtime_function(&self, file: FileId, export_name: &[u8]) -> Option<RuntimeFunction> {
        let entry = &self.entries[file.idx()];
        match entry.kind {
            SourceKind::RuntimeFunctions => {
                find_runtime_function(self.manifest, &entry.public_path, export_name)
            }
            _ => None,
        }
    }

    pub fn web_assembly_files(&self) -> &[FileId] {
        &self.web_assembly_files
    }
}
