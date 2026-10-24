mod freeze;
#[cfg(test)]
mod tests;

use std::sync::OnceLock;

use bun_ast::Loader;
use bun_builtin_sources::{Manifest, VIRTUAL_ROOT};
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, FnId};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::HostPayload;

pub(crate) use self::freeze::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources,
};
use crate::builtins::{ResolvedBuiltins, RuntimeFunction, RuntimeModule, table};
use crate::diagnostics::FileDiagnostic;
use crate::load::named_loads::NamedModule;
use crate::load::project::ProjectId;
use crate::lower;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum SourceKind {
    Program,
    Data,
    EvaluatedText,
    RuntimeModule(RuntimeModule),
    RuntimeFunctions,
    TypesOnly,
}

impl SourceKind {
    pub fn lowering_kind(self) -> Option<lower::SourceKind> {
        match self {
            SourceKind::Program | SourceKind::Data | SourceKind::EvaluatedText => {
                Some(lower::SourceKind::Program)
            }
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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct EvaluatedTextSite {
    pub call: ExprId,
    pub implied_answer: u32,
}

pub(crate) struct ParsedSource {
    pub kind: SourceKind,
    pub loader: Loader,
    pub byte_count: usize,
    pub is_from_plugin: bool,
    pub plugin_module: Option<PluginModuleName>,
    pub web_assembly: Option<Vec<u8>>,
    pub is_page: bool,
    pub has_compiled_components: bool,
    /// Why the text is no program, where nothing but the way it is loaded says that it is one. An empty module stands in its place.
    pub parse_failure: Option<Vec<u8>>,
    pub builtins: ResolvedBuiltins,
    pub evaluated_text_sites: Vec<EvaluatedTextSite>,
    pub evaluated_function: Option<FnId>,
    pub modules_named_in_choices: Vec<NamedModule>,
    pub library_names_passed_to_imports: Vec<(SymbolId, NamedModule)>,
    pub library_modules_passed_for_parameters: Vec<RuntimeModule>,
    pub library_modules_written_as_values: Vec<RuntimeModule>,
    pub loads_by_unknown_name: bool,
    pub unknown_names_at: Vec<u32>,
    pub imports_given_unknown_names: Vec<SymbolId>,
    pub(super) named_modules: OnceLock<Vec<NamedModule>>,
    pub diagnostics: Vec<FileDiagnostic>,
}

impl ParsedSource {
    pub(crate) fn new(kind: SourceKind, loader: Loader) -> ParsedSource {
        ParsedSource {
            kind,
            loader,
            byte_count: 0,
            is_from_plugin: false,
            plugin_module: None,
            web_assembly: None,
            is_page: false,
            has_compiled_components: false,
            parse_failure: None,
            builtins: ResolvedBuiltins::default(),
            evaluated_text_sites: Vec::new(),
            evaluated_function: None,
            modules_named_in_choices: Vec::new(),
            library_names_passed_to_imports: Vec::new(),
            library_modules_passed_for_parameters: Vec::new(),
            library_modules_written_as_values: Vec::new(),
            loads_by_unknown_name: false,
            unknown_names_at: Vec::new(),
            imports_given_unknown_names: Vec::new(),
            named_modules: OnceLock::new(),
            diagnostics: Vec::new(),
        }
    }

    pub(crate) fn named_modules(&self) -> &[NamedModule] {
        self.named_modules
            .get()
            .unwrap_or(&self.modules_named_in_choices)
    }

    pub(crate) fn set_named_modules(&self, named: Vec<NamedModule>) {
        let _ = self.named_modules.set(named);
    }
}

pub(crate) fn parsed_source<'s>(files: &Files<'s>, file: FileId) -> Option<&'s ParsedSource> {
    files.host_payload(file)?.downcast_ref::<ParsedSource>()
}

pub(crate) fn parsed_source_mut(payload: &mut Option<HostPayload>) -> &mut ParsedSource {
    let payload = payload
        .as_mut()
        .expect("parse_code gives every tree a payload");
    let source = payload.downcast_mut::<ParsedSource>();
    source.expect("the payload of a tree is a ParsedSource")
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
    display_path: Box<[u8]>,
    diagnostic_path: Box<[u8]>,
}

#[derive(Clone)]
pub struct Sources {
    project: ProjectId,
    entries: Vec<SourceEntry>,
    entry_points: Vec<EntryPoint>,
    runtime_module_files: Vec<(RuntimeModule, FileId)>,
    web_assembly_files: Vec<FileId>,
    pages: Vec<(FileId, Box<[u8]>)>,
    evaluated_functions: Vec<((FileId, ExprId), FunctionRef)>,
    manifest: &'static Manifest,
}

impl Sources {
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

    /// How long the text was that the loader, or a plugin in its place, read for the file.
    pub fn byte_count(&self, file: FileId) -> u64 {
        self.entries[file.idx()].byte_count
    }

    pub fn module_paths(&self, file: FileId) -> ModulePaths<'_> {
        let entry = &self.entries[file.idx()];
        ModulePaths {
            public_path: &entry.public_path,
            display_path: &entry.display_path,
        }
    }

    pub fn diagnostic_path(&self, file: FileId) -> &[u8] {
        &self.entries[file.idx()].diagnostic_path
    }

    pub fn entry_points(&self) -> &[EntryPoint] {
        &self.entry_points
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

    pub fn runtime_function(&self, file: FileId, export_name: &[u8]) -> Option<RuntimeFunction> {
        let entry = &self.entries[file.idx()];
        match entry.kind {
            SourceKind::RuntimeFunctions => self
                .manifest
                .builtin_function_id(&entry.public_path, export_name)
                .map(RuntimeFunction)
                .or_else(|| find_compiler_function(&entry.public_path, export_name)),
            _ => None,
        }
    }

    pub fn web_assembly_files(&self) -> &[FileId] {
        &self.web_assembly_files
    }

    pub fn pages(&self) -> &[(FileId, Box<[u8]>)] {
        &self.pages
    }

    pub fn evaluated_function(&self, file: FileId, call: ExprId) -> Option<FunctionRef> {
        let functions = &self.evaluated_functions;
        let index = functions
            .binary_search_by_key(&(file, call), |entry| entry.0)
            .ok()?;
        Some(functions[index].1)
    }

    /// Each file that was made of a text, behind the file that evaluates the text.
    pub fn evaluated_texts(&self) -> impl Iterator<Item = (FileId, FileId)> {
        self.evaluated_functions
            .iter()
            .map(|entry| (entry.0.0, entry.1.file))
    }

    pub fn evaluator_of(&self, text_file: FileId) -> Option<FileId> {
        let mut functions = self.evaluated_functions.iter();
        let entry = functions.find(|entry| entry.1.file == text_file)?;
        Some(entry.0.0)
    }

    #[cfg(test)]
    pub(crate) fn evaluated_functions_of(
        &self,
        file: FileId,
    ) -> &[((FileId, ExprId), FunctionRef)] {
        let functions = &self.evaluated_functions;
        let start = functions.partition_point(|entry| entry.0.0 < file);
        let end = functions.partition_point(|entry| entry.0.0 <= file);
        &functions[start..end]
    }
}
