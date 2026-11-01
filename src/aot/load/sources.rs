mod freeze;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

use bun_ast::Loader;
use bun_builtin_sources::{Archive, BundledName, BundledPositions, Manifest, VIRTUAL_ROOT};
use bun_sema::bind::SymbolId;
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{ExprId, FnId};
use bun_sema::program::{CodeView, FileId, Files};
use bun_sema::resolve::HostPayload;

pub(crate) use self::freeze::{
    FreezeInput, FrozenSources, check_unique_paths_across_projects, freeze_sources,
};
use crate::builtins::{ResolvedBuiltins, RuntimeFunction, RuntimeModule, table};
use crate::diagnostics::FileDiagnostic;
use crate::load::module_paths::{compute_display_path, with_separators_of_host};
use crate::load::named_loads::NamedModule;
#[cfg(test)]
use crate::load::project::ProjectId;
use crate::lower;
use crate::module_keys::is_name_of_text;

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
    /// `vi.importMock("./a")`: native code of the test runner loads the file by its path and reads all that it exports.
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

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct EvaluatedTextSite {
    pub call: ExprId,
    pub implied_answer: u32,
}

/// `modules_with_queries`
pub(crate) struct FileWithQuery {
    pub file: Box<[u8]>,
    pub query: Box<[u8]>,
}

pub(crate) struct ParsedSource {
    pub kind: SourceKind,
    pub loader: Loader,
    pub byte_count: usize,
    pub is_from_plugin: bool,
    pub plugin_module: Option<PluginModuleName>,
    pub file_with_query: Option<FileWithQuery>,
    pub web_assembly: Option<Vec<u8>>,
    pub is_page: bool,
    pub has_compiled_components: bool,
    /// `import_meta_glob::expand_calls` has had the file.
    pub has_expanded_globs: bool,
    /// `test_runner_names::import_used_names` has bound the names in the file, whatever realm loads it.
    pub binds_names_of_test_runner: bool,
    /// Why the text is no program, where the program finds that out when it loads the file. An empty module stands in its place.
    pub parse_failure: Option<Vec<u8>>,
    /// The file as it is, where an executable holds a file that fails at load: it has no disk to read it from when the program loads it.
    pub text_that_fails_at_load: Option<Box<[u8]>>,
    /// Nothing but the way the file is loaded says that it is a program.
    pub is_language_assumed: bool,
    pub builtins: ResolvedBuiltins,
    pub evaluated_text_sites: Vec<EvaluatedTextSite>,
    /// A constant text that is not compiled, as a script of several statements is not, has the word `mainModule`. The interpreter runs it, and the build has read it.
    pub names_main_module_in_text_left_to_run_time: bool,
    /// The modules of Bun whose names stand in quotes in such a text: `process.mainModule.require("node:os")`.
    pub library_modules_named_in_text_left_to_run_time: Vec<RuntimeModule>,
    pub evaluated_function: Option<FnId>,
    /// `find_source_url` of an evaluated text, read while it is analyzed: its comments are gone behind that.
    pub source_url_of_text: Option<Box<[u8]>>,
    pub modules_named_in_choices: Vec<NamedModule>,
    pub library_names_passed_to_imports: Vec<(SymbolId, NamedModule)>,
    pub library_modules_passed_for_parameters: Vec<RuntimeModule>,
    pub library_modules_written_as_values: Vec<RuntimeModule>,
    pub loads_by_unknown_name: bool,
    /// `named_loads::FilesOfTests`, where `AotOptions::only_tests_load_code_from_disk`. And what the preloads alone reach: `mark_files_of_product`, behind the load.
    pub(super) is_of_tests: AtomicBool,
    /// A test file, or a file that takes something from the test runner. Not `src/app.ts` beside `src/app.test.ts`, which its folder alone makes one of them.
    pub is_of_tests_by_itself: bool,
    /// It writes a load with a computed name, in a package that only the tests themselves reach: `mark_files_of_product`, behind each load anew.
    pub(super) loads_for_tests_alone: AtomicBool,
    /// `ModuleFlags::FindsBuiltinsReadOnly`: `mark_files_of_product`, behind the load.
    pub(super) finds_builtins_read_only: AtomicBool,
    /// A text that a file evaluates lies where that file lies.
    pub is_in_package: bool,
    pub unknown_names_at: Vec<u32>,
    /// `named_loads::find_loads_of_files_missing_at_build`
    pub files_missing_at_build_at: Vec<u32>,
    /// `manual_mocks::find_manual_mocks`
    pub manual_mocks: Vec<Vec<u8>>,
    pub imports_given_unknown_names: Vec<SymbolId>,
    pub(super) named_modules: OnceLock<Vec<NamedModule>>,
    pub(super) gives_unknown_name_to_imported_loader: OnceLock<bool>,
    pub diagnostics: Vec<FileDiagnostic>,
}

impl ParsedSource {
    pub(crate) fn is_of_tests(&self) -> bool {
        self.is_of_tests.load(Ordering::Relaxed)
            || self.loads_for_tests_alone.load(Ordering::Relaxed)
    }

    pub(crate) fn set_is_of_tests(&self) {
        self.is_of_tests.store(true, Ordering::Relaxed);
    }

    pub(crate) fn set_loads_for_tests_alone(&self, loads_for_tests_alone: bool) {
        self.loads_for_tests_alone
            .store(loads_for_tests_alone, Ordering::Relaxed);
    }

    pub(crate) fn finds_builtins_read_only(&self) -> bool {
        self.finds_builtins_read_only.load(Ordering::Relaxed)
    }

    pub(crate) fn set_finds_builtins_read_only(&self) {
        self.finds_builtins_read_only.store(true, Ordering::Relaxed);
    }

    pub(crate) fn new(kind: SourceKind, loader: Loader) -> ParsedSource {
        ParsedSource {
            kind,
            loader,
            byte_count: 0,
            is_from_plugin: false,
            plugin_module: None,
            file_with_query: None,
            web_assembly: None,
            is_page: false,
            has_compiled_components: false,
            has_expanded_globs: false,
            binds_names_of_test_runner: false,
            parse_failure: None,
            text_that_fails_at_load: None,
            is_language_assumed: false,
            builtins: ResolvedBuiltins::default(),
            evaluated_text_sites: Vec::new(),
            names_main_module_in_text_left_to_run_time: false,
            library_modules_named_in_text_left_to_run_time: Vec::new(),
            evaluated_function: None,
            source_url_of_text: None,
            modules_named_in_choices: Vec::new(),
            library_names_passed_to_imports: Vec::new(),
            library_modules_passed_for_parameters: Vec::new(),
            library_modules_written_as_values: Vec::new(),
            loads_by_unknown_name: false,
            is_of_tests: AtomicBool::new(false),
            is_of_tests_by_itself: false,
            loads_for_tests_alone: AtomicBool::new(false),
            finds_builtins_read_only: AtomicBool::new(false),
            is_in_package: false,
            unknown_names_at: Vec::new(),
            files_missing_at_build_at: Vec::new(),
            manual_mocks: Vec::new(),
            imports_given_unknown_names: Vec::new(),
            named_modules: OnceLock::new(),
            gives_unknown_name_to_imported_loader: OnceLock::new(),
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

/// The function that the file of library functions at `path` exports under the name.
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
    /// How much of the end of `public_path` is a query: `?fresh=1`.
    query_length: usize,
    /// Empty until it is asked for where it is `compute_display_path` of `diagnostic_path`: few files are ever shown.
    display_path: OnceLock<Box<[u8]>>,
    diagnostic_path: Box<[u8]>,
}

#[derive(Clone)]
pub struct Sources {
    #[cfg(test)]
    project: ProjectId,
    entries: Vec<SourceEntry>,
    project_root: Box<[u8]>,
    entry_points: Vec<EntryPoint>,
    runtime_module_files: Vec<(RuntimeModule, FileId)>,
    modules_named_at_run_time: Vec<RuntimeModule>,
    web_assembly_files: Vec<FileId>,
    pages: Vec<(FileId, Box<[u8]>)>,
    evaluated_functions: Vec<((FileId, ExprId), FunctionRef)>,
    manifest: &'static Manifest,
    /// `holds_source_paths`
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

    /// How long the text was that the loader, or a plugin in its place, read for the file.
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

    /// `public_path` up to the query that the module was asked for with. `import.meta.path` of `./a.ts?fresh=1` is the path of `a.ts`.
    pub fn public_path_without_query(&self, file: FileId) -> &[u8] {
        let entry = &self.entries[file.idx()];
        &entry.public_path[..entry.public_path.len() - entry.query_length]
    }

    /// `?fresh=1`, or nothing.
    pub fn query(&self, file: FileId) -> &[u8] {
        let entry = &self.entries[file.idx()];
        &entry.public_path[entry.public_path.len() - entry.query_length..]
    }

    pub fn has_query(&self, file: FileId) -> bool {
        self.entries[file.idx()].query_length != 0
    }

    pub fn diagnostic_path(&self, file: FileId) -> &[u8] {
        &self.entries[file.idx()].diagnostic_path
    }

    fn find_source_path(&self, file: FileId) -> Option<Vec<u8>> {
        let entry = &self.entries[file.idx()];
        // The text of `new Worker("data:text/javascript,..")` lay nowhere, and the `/` in its name parts no folders.
        if is_name_of_text(&entry.diagnostic_path) {
            return None;
        }
        let path = with_separators_of_host(&entry.diagnostic_path, cfg!(windows));
        (*path != *self.public_path_without_query(file)).then_some(path)
    }

    pub fn has_source_path(&self, file: FileId) -> bool {
        self.find_source_path(file).is_some()
    }

    /// What `__filename` holds in an executable: where the file lay when the program was built, as `bun build --compile` has it.
    /// Nothing where that is the path under which the program knows the file. Whoever asks puts the path into the program.
    pub fn source_path(&self, file: FileId) -> Option<Vec<u8>> {
        let path = self.find_source_path(file)?;
        self.holds_source_paths.store(true, Ordering::Relaxed);
        Some(path)
    }

    /// A file asks `require.resolve` under a name that the build does not know: the run time answers with such a path.
    pub fn note_source_paths_at_run_time(&self) {
        self.holds_source_paths.store(true, Ordering::Relaxed);
    }

    /// The program holds the path of a file on the machine that built it, so it may ask for a module by such a path.
    pub fn holds_source_paths(&self) -> bool {
        self.holds_source_paths.load(Ordering::Relaxed)
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

    /// The modules of Bun's own that a load may ask for under a name which the build does not know.
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

    pub fn bundled_names(&self, file: FileId) -> &'static [BundledName] {
        match self.kind(file) {
            SourceKind::RuntimeModule(module) => self.manifest.bundled_names(module.registry_id()),
            _ => &[],
        }
    }

    pub fn bundled_positions(&self, file: FileId) -> Option<BundledPositions> {
        match self.kind(file) {
            SourceKind::RuntimeModule(module) => Archive::bundled_positions(module.registry_id()),
            _ => None,
        }
    }

    /// The same for a file of built-in functions. Of such a file a stack trace shows only where the functions start that are written inside one.
    pub fn bundled_positions_of_functions(&self, file: FileId) -> Option<BundledPositions> {
        if self.kind(file) != SourceKind::RuntimeFunctions {
            return None;
        }
        let path = self.module_paths(file).public_path;
        Archive::bundled_positions_of_functions(path.strip_prefix(VIRTUAL_ROOT)?)
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
