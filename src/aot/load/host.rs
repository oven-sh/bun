use std::borrow::Cow;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, Ordering};

use bstr::BStr;
use bun_ast::Loader;
use bun_core::CodeGenerationFromStrings;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_resolve_builtins::Alias;
use bun_sema::atom::Interner;
use bun_sema::erasure::find_type_ranges;
use bun_sema::hir::{self, DiagnosticKind, ExprId};
use bun_sema::hir_from_data::HostValue;
use bun_sema::program::{HostLoader, HostModuleId};
use bun_sema::resolve::{
    CodeHost, CodeImportForm, CodeImportKind, CodeParseRequest, CodeRead, CodeRequest,
    ExternalKind, FileSearch, FileStamp, FinishedFile, FoundCode, Host, HostPayload,
    HostResolution, LoaderRequest, MacroRequest, ModuleDetection, ParsedCode, ScriptKind,
    TransformRequest, TreeChange, is_declaration_file_name, to_path, to_path_in,
};
use bun_sema::session::{Arena, Session};
use bun_sema::util::{FxHashSet, SharedSort};
use bun_sema_driver::Libs;
use bun_sema_driver::host::{AlreadyRead, Disk, from_argument, from_native, is_bundled, to_native};
use bun_sema_parser::{CompileParseOptions, appears_to_be_binary, parse_for_compile};
use bun_threading::Guarded;

use crate::builtins::{BuiltinNames, Platforms, ReplacedMembersSought};
use crate::diagnostics::{LoadMessages, syntax_errors_of};
use crate::load::builtin_uses::{self, BuiltinUseInput};
use crate::load::bundled_commonjs::without_commonjs_wrapper;
use crate::load::compiler_declarations;
use crate::load::data_modules::{parse_data_module, report_blank_json};
use crate::load::disk_delegation::{
    delegate_host_services_to_disk, delegate_runtime_config_parsers_to_disk,
};
use crate::load::evaluated_texts::{EvaluatedTexts, find_source_url};
use crate::load::externals::{contains, is_external};
use crate::load::import_meta_glob;
use crate::load::loaders::{
    BY_NAME, HostLoaderKind, host_loader_kind, loader_by_name, loader_by_path, loader_by_query,
    loader_named_by_path, parses_text_as_data, script_kind_of, to_host_loader,
    to_host_loader_of_attribute, to_host_loader_of_query,
};
use crate::load::macros;
use crate::load::made_own_require;
use crate::load::manual_mocks::find_manual_mocks;
use crate::load::modules_with_queries::ModulesWithQueries;
use crate::load::named_loads::{
    FilesOfTests, find_library_modules_named_in_choices, find_loads_of_files_missing_at_build,
};
use crate::load::plugin_modules::{DeferredReads, ModuleText, PluginModules, PluginResolution};
use crate::load::react_compiler::{self, ReactCompiler};
use crate::load::replaced_modules::shares_place_in_loader;
use crate::load::runtime_declarations;
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};
use crate::load::runtime_types;
use crate::load::source_provider::{SourceFile, SourceProvider};
use crate::load::sources::{
    FileWithQuery, ParsedSource, PluginModuleName, SourceKind, parsed_source_mut,
};
use crate::load::test_runner_names;
use crate::load::worker_files::find_file_named_as_in_executable;
use crate::load::{is_host_path, is_in_node_modules};
use crate::module_keys::{is_url_with_text, places_of_form};
use crate::options::{EntryText, Options};
use crate::statistics::LimitValues;

const BUNDLE_MODULE: &[u8] = b"bun:bundle";
const IN_PLACE_OF_NO_PROGRAM: &[u8] = b"export {};";

// The first sentence of the parser on a text that ECMAScript refuses, and where.
fn has_syntax_errors(hir: &hir::File<'_>) -> bool {
    hir.has_errors
        || hir.has_parse_diagnostics
        || hir.ran_out_of_stack
        || (hir.diagnostics.iter()).any(|it| it.kind == DiagnosticKind::Js)
}

fn describe_parse_failure(hir: &hir::File<'_>, text: &[u8]) -> Option<Vec<u8>> {
    let first = syntax_errors_of(hir).next()?;
    let mut sentence = Vec::new();
    if let Some((_, template)) = bun_sema::messages::message(first.code) {
        bun_sema::messages::format(&mut sentence, template, &first.args);
    }
    let before = &text[..text.len().min(first.start as usize)];
    let line = bun_core::strings::count_char(before, b'\n') + 1;
    let bytes_of_line = before.iter().rev().take_while(|&&byte| byte != b'\n');
    let column = bytes_of_line.count() + 1;
    sentence.extend_from_slice(format!(" ({line}:{column})").as_bytes());
    Some(sentence)
}

pub(crate) fn create_disk(options: &Options<'_>, threads: NonZeroUsize) -> Disk {
    let load = &options.load;
    let already_read: AlreadyRead = (load.in_memory_files.iter())
        .map(|(path, contents)| (from_native(path), contents.clone()))
        .collect();
    let project_root = from_native(&load.project_root);
    let mut disk = Disk::with_already_read(threads.get(), already_read, &project_root)
        .started_in(&options.code.working_directory);
    match options.typescript_libs {
        Libs::Bundled(libs) => disk.bundled_libs = Some(libs),
        Libs::Directory(_) => {}
    }
    if let Some(listener) = options.aot.before_read.clone() {
        disk.before_read = Some(Box::new(move |path| (listener.0)(path)));
    }
    disk
}

pub(crate) struct LoadHostInput<'a> {
    pub disk: &'a Disk,
    pub provider: &'a dyn SourceProvider,
    pub options: &'a Options<'a>,
    pub runtime_modules: &'a RuntimeModules,
    pub messages: &'a LoadMessages,
    pub builtin_names: &'a BuiltinNames,
    pub platform: Platforms,
    pub limits: &'a LimitValues,
}

pub(crate) struct LoadHost<'a> {
    disk: &'a Disk,
    input: LoadHostInput<'a>,
    plugins: PluginModules<'a>,
    modules_with_queries: ModulesWithQueries,
    evaluated_texts: EvaluatedTexts,
    /// The files of the project that take something from the test runner. A file is finished before the texts that it holds are read.
    take_from_test_runner: Guarded<FxHashSet<Vec<u8>>>,
    react_compiler: ReactCompiler<'a>,
    entry_point_paths: Vec<Vec<u8>>,
    /// As `entry_point_paths`, of `LoadOptions::entry_points_added_by_build`.
    added_entry_point_paths: Vec<Vec<u8>>,
    files_of_tests: Option<FilesOfTests>,
    /// As `entry_point_paths`, of `begin_at`.
    found_entry_point_paths: Guarded<Vec<Vec<u8>>>,
    has_found_entry_points: AtomicBool,
    /// As `LoadOptions::entry_texts`, of `begin_at_texts`.
    found_entry_texts: Guarded<Vec<EntryText>>,
    /// Sorted. The entry points whose names say nothing about them and that aren't text.
    binary_entry_point_paths: Vec<Vec<u8>>,
    /// Entry points that are named as declaration files and hold statements that run. `bun run` runs them.
    entry_points_that_run_despite_their_names: Vec<Vec<u8>>,
    extra_extensions: Vec<(Vec<u8>, ScriptKind)>,
    unreadable: Guarded<Vec<Vec<u8>>>,
    /// Sorted.
    background_reads: Guarded<Vec<Vec<u8>>>,
    /// The background reads that a plugin answered.
    assets_from_plugins: Guarded<Vec<Vec<u8>>>,
    background_reads_disabled: AtomicBool,
    reads_in_background_after_load: bool,
    has_run_macros: AtomicBool,
    /// `leave_alone`
    files_left_alone: Guarded<FxHashSet<Vec<u8>>>,
    leaves_files_alone: AtomicBool,
}

#[derive(Copy, Clone)]
enum ServedBy {
    PluginModule,
    EvaluatedText,
    Declarations(&'static [u8]),
    RuntimeTypes,
    Disk,
}

fn collect_entry_point_paths(
    disk: &Disk,
    options: &Options<'_>,
    entry_points: &[Vec<u8>],
) -> Vec<Vec<u8>> {
    let is_case_sensitive = disk.is_case_sensitive();
    let mut paths = Vec::with_capacity(2 * entry_points.len());
    for entry_point in entry_points {
        let path = from_argument(&options.code.working_directory, entry_point);
        paths.push(to_path(&disk.realpath(&path), is_case_sensitive).into_owned());
        paths.push(to_path(&path, is_case_sensitive).into_owned());
    }
    paths.shared_sort_unstable();
    paths.dedup();
    paths
}

fn holds_statements_that_run(path: &[u8], text: &[u8]) -> bool {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let parse_options = CompileParseOptions {
        path,
        script_kind: Some(ScriptKind::Ts),
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let hir = parse_for_compile(session.arena(), &parse_options, text, &atoms);
    hir.ids(hir.body).len() != 0 && !hir.only_declares()
}

impl<'a> LoadHost<'a> {
    /// From now on a load takes these files, named as the checker names them, for files of another program. For a look at a few files
    /// more while the load that holds these stands. Call it between loads.
    pub(crate) fn leave_alone(&self, files: FxHashSet<Vec<u8>>) {
        self.leaves_files_alone
            .store(!files.is_empty(), Ordering::Relaxed);
        *self.files_left_alone.lock() = files;
    }

    /// The load that runs begins at these files too, and at no others beside `Options::entry_points`. They are written as those are, their names say that
    /// they are code, and none is read yet as an entry point is.
    pub(crate) fn begin_at(&self, entry_points: &[Vec<u8>]) {
        let paths = collect_entry_point_paths(self.disk, self.input.options, entry_points);
        self.has_found_entry_points
            .store(!paths.is_empty(), Ordering::Relaxed);
        *self.found_entry_point_paths.lock() = paths;
    }

    /// The load that runs begins at these texts too, and at no others beside `LoadOptions::entry_texts`. From here on the name of each leads to its module.
    pub(crate) fn begin_at_texts(&self, texts: Vec<EntryText>) {
        *self.found_entry_texts.lock() = texts;
    }

    /// What takes a while to free, for whoever frees it beside other work.
    pub(crate) fn into_leftovers(self) -> Box<dyn Send> {
        self.plugins.into_leftovers()
    }

    pub(crate) fn new(input: LoadHostInput<'a>) -> LoadHost<'a> {
        let (disk, provider, messages) = (input.disk, input.provider, input.messages);
        let options = input.options;
        let load = &options.load;
        let entry_point_paths = collect_entry_point_paths(disk, options, &options.entry_points);
        let added = &options.load.entry_points_added_by_build;
        let added_entry_point_paths = collect_entry_point_paths(disk, options, added);
        let files_of_tests = options.aot.only_tests_load_code_from_disk.then(|| {
            let listed = match load.files_of_tests.is_empty() {
                true => &options.entry_points,
                false => &load.files_of_tests,
            };
            FilesOfTests::new(
                collect_entry_point_paths(disk, options, listed),
                &collect_entry_point_paths(disk, options, &load.test_files),
            )
        });
        let is_binary = |path: &&Vec<u8>| {
            loader_named_by_path(&load.loaders, path).is_none()
                && (disk.read(path)).is_some_and(|contents| appears_to_be_binary(&contents, true))
        };
        let binary_entry_point_paths = entry_point_paths.iter().filter(is_binary).cloned();
        let runs_despite_its_name = |path: &&Vec<u8>| {
            is_declaration_file_name(path)
                && (disk.read(path)).is_some_and(|text| holds_statements_that_run(path, &text))
        };
        let entry_points_that_run_despite_their_names = (entry_point_paths
            .iter()
            .filter(runs_despite_its_name)
            .cloned())
        .collect();
        let extra_extensions = load.loaders.iter().filter_map(|(extension, loader)| {
            let kind = script_kind_of(*loader)?;
            let file_name = [b"x", extension.as_slice()].concat();
            let is_extra = ScriptKind::from_file_name(&file_name).is_none();
            is_extra.then(|| (extension.clone(), kind))
        });
        LoadHost {
            disk,
            plugins: PluginModules::new(provider, disk, messages, &load.in_memory_files),
            modules_with_queries: ModulesWithQueries::default(),
            evaluated_texts: EvaluatedTexts::new(),
            take_from_test_runner: Guarded::new(FxHashSet::default()),
            react_compiler: ReactCompiler::new(load.react_compiler, provider, messages)
                .with_filter(load.react_compiler_filter),
            binary_entry_point_paths: binary_entry_point_paths.collect(),
            entry_points_that_run_despite_their_names,
            entry_point_paths,
            added_entry_point_paths,
            files_of_tests,
            found_entry_point_paths: Guarded::new(Vec::new()),
            has_found_entry_points: AtomicBool::new(false),
            found_entry_texts: Guarded::new(Vec::new()),
            extra_extensions: extra_extensions.collect(),
            unreadable: Guarded::new(Vec::new()),
            background_reads: Guarded::new(Vec::new()),
            assets_from_plugins: Guarded::new(Vec::new()),
            background_reads_disabled: AtomicBool::new(false),
            reads_in_background_after_load: false,
            has_run_macros: AtomicBool::new(false),
            files_left_alone: Guarded::new(FxHashSet::default()),
            leaves_files_alone: AtomicBool::new(false),
            input,
        }
    }

    /// The caller runs `read_in_background` for `background_reads` once the program is loaded, and calls `finish_background_reads` when it needs the contents.
    pub(crate) fn reading_in_background_after_load(self) -> LoadHost<'a> {
        LoadHost {
            reads_in_background_after_load: true,
            ..self
        }
    }

    pub(crate) fn background_reads(&self) -> Vec<Vec<u8>> {
        self.background_reads.lock().clone()
    }

    pub(crate) fn assets_from_plugins(&self) -> Vec<Vec<u8>> {
        self.assets_from_plugins.lock().clone()
    }

    fn served_by(&self, path: &[u8]) -> ServedBy {
        if !is_host_path(path) {
            return ServedBy::Disk;
        }
        if self.plugins.virtual_module(path).is_some() {
            return ServedBy::PluginModule;
        }
        if self.evaluated_texts.contains(path) {
            return ServedBy::EvaluatedText;
        }
        if path == react_compiler::DECLARATIONS_PATH {
            return ServedBy::Declarations(react_compiler::DECLARATIONS);
        }
        if path == runtime_declarations::PATH {
            let runs_tests = self.input.options.load.runs_tests;
            let text = runtime_declarations::text(self.input.runtime_modules, runs_tests);
            return ServedBy::Declarations(text);
        }
        if path == runtime_declarations::OTHER_NAMES_OF_TEST_RUNNER_PATH {
            return ServedBy::Declarations(runtime_declarations::OTHER_NAMES_OF_TEST_RUNNER);
        }
        if path == compiler_declarations::PATH {
            return ServedBy::Declarations(compiler_declarations::TEXT);
        }
        if path == compiler_declarations::PATH_OF_MODULES_IN_OTHER_IMAGES {
            return ServedBy::Declarations(compiler_declarations::MODULES_IN_OTHER_IMAGES);
        }
        match runtime_types::is_file(path) {
            true => ServedBy::RuntimeTypes,
            false => ServedBy::Disk,
        }
    }

    fn should_ask_plugins(&self, served_by: ServedBy, path: &[u8]) -> bool {
        match served_by {
            ServedBy::PluginModule => true,
            // A page has a bundle of its own, which asks the plugins for it.
            ServedBy::Disk => {
                !is_bundled(path)
                    && !is_declaration_file_name(path)
                    && self.default_loader(path) != Loader::Html
            }
            ServedBy::EvaluatedText | ServedBy::Declarations(_) | ServedBy::RuntimeTypes => false,
        }
    }

    fn is_entry_point(&self, path: &[u8]) -> bool {
        self.is_among(&self.entry_point_paths, path)
            || (self.has_found_entry_points.load(Ordering::Relaxed)
                && self.is_among(&self.found_entry_point_paths.lock(), path))
    }

    /// A Worker starts from it, or data names it. The runner does not start it.
    fn is_entry_point_added_by_build(&self, path: &[u8]) -> bool {
        self.is_among(&self.added_entry_point_paths, path)
            || (self.has_found_entry_points.load(Ordering::Relaxed)
                && self.is_among(&self.found_entry_point_paths.lock(), path))
    }

    fn runs_despite_its_name(&self, path: &[u8]) -> bool {
        is_declaration_file_name(path)
            && self.is_among(&self.entry_points_that_run_despite_their_names, path)
    }

    /// A text may hold a text in turn.
    fn find_file_that_holds_text(&self, path: &[u8]) -> Option<Vec<u8>> {
        let mut holder = None;
        let mut path = path.to_vec();
        while self.evaluated_texts.contains(&path) {
            let folder = &path[..bun_core::strings::last_index_of_char(&path, b'/').unwrap_or(0)];
            path = self.evaluated_texts.holder_in_folder(folder)?;
            holder = Some(path.clone());
        }
        holder
    }

    pub(crate) fn is_of_tests(&self, path: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(path, self.disk.is_case_sensitive(), &mut buffer[..]);
        (self.files_of_tests.as_ref()).is_some_and(|files| files.holds(&path))
    }

    fn is_test_file(&self, path: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(path, self.disk.is_case_sensitive(), &mut buffer[..]);
        (self.files_of_tests.as_ref()).is_some_and(|files| files.is_test_file(&path))
    }

    /// The entry points of a layer below the test files are the files that those import.
    fn is_test_file_or_preload(&self, path: &[u8]) -> bool {
        let Some(files) = &self.files_of_tests else {
            return !self.input.options.load.every_export_is_asked_for && self.is_entry_point(path);
        };
        let mut buffer = path_buffer_pool::get();
        files.lists(&to_path_in(
            path,
            self.disk.is_case_sensitive(),
            &mut buffer[..],
        ))
    }

    fn is_among(&self, sorted_paths: &[Vec<u8>], path: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(path, self.disk.is_case_sensitive(), &mut buffer[..]);
        contains(sorted_paths, &path)
    }

    fn default_loader(&self, path: &[u8]) -> Loader {
        self.default_loader_for(path, CodeImportKind::Import, true)
    }

    fn default_loader_for(
        &self,
        path: &[u8],
        kind: CodeImportKind,
        is_linked_by_bundler: bool,
    ) -> Loader {
        if let Some(loader) = self.plugins.loader_of_entry_text(path) {
            return loader;
        }
        if let Some(loader) = self.modules_with_queries.loader_by_query(path) {
            return loader;
        }
        let loaders = &self.input.options.load.loaders;
        if !self.is_entry_point(path) {
            // `bun run` reads a file of a kind that nothing names as code for `require`. An executable carries it where `bun build` links the call.
            let carries = is_linked_by_bundler && !self.input.options.aot.runs_in_place;
            let kind = match kind {
                CodeImportKind::Require if carries => CodeImportKind::Import,
                _ => kind,
            };
            let runs_in_place = self.input.options.aot.runs_in_place;
            return match loader_by_path(loaders, path, kind) {
                // The loader of `bun run` answers with the path of a shell script. `bun build` links an import of one to an empty string.
                Loader::Bunsh if kind == CodeImportKind::Require || runs_in_place => Loader::File,
                loader => loader,
            };
        }
        match self.is_among(&self.binary_entry_point_paths, path) {
            true => Loader::File,
            false => loader_by_path(loaders, path, CodeImportKind::EntryPoint),
        }
    }

    fn plugin_loader(&self, path: &[u8]) -> Option<Loader> {
        let module = (self.plugins).loaded(self.modules_with_queries.file_behind(path))?;
        module.is_from_plugin.then_some(module.loader)
    }

    /// The loader of the JavaScript that a plugin has answered for a TypeScript file.
    fn loader_in_place_of_typed_file(&self, path: &[u8]) -> Option<Loader> {
        if is_host_path(path) || is_declaration_file_name(path) {
            return None;
        }
        let is_javascript = |loader| script_kind_of(loader).map(ScriptKind::is_javascript);
        let loader = self.plugin_loader(path)?;
        let is_untyped_for_typed = is_javascript(loader) == Some(true)
            && is_javascript(self.default_loader(path)) == Some(false);
        is_untyped_for_typed.then_some(loader)
    }

    fn is_background_read(&self, path: &[u8]) -> bool {
        contains(&self.background_reads.lock(), path)
    }

    /// Returns false if a plugin answered one of the background reads with something other than an asset.
    pub(crate) fn finish_background_reads(&self) -> bool {
        let paths = std::mem::take(&mut *self.background_reads.lock());
        let (provider, messages) = (self.input.provider, self.input.messages);
        let mut are_assets = true;
        for path in &paths {
            let file = self.modules_with_queries.file_behind(path);
            let contents = match self.plugins.read(file, self.default_loader(file)) {
                ModuleText::Text(contents) => contents,
                ModuleText::Failed => continue,
                ModuleText::Deferred | ModuleText::Missing => {
                    are_assets = false;
                    continue;
                }
            };
            let plugin_loader = self.plugin_loader(path);
            if plugin_loader.is_some() {
                self.assets_from_plugins.lock().push(path.clone());
            }
            if plugin_loader.is_some_and(|loader| loader != Loader::File) {
                are_assets = false;
                continue;
            }
            let source = SourceFile {
                path: self.plugins.provider_path(file),
                contents: &contents,
                loader: Loader::File,
            };
            let _ = messages.with_log(|log| provider.set_embedded_contents(&source, log));
        }
        // The names were checked when these files had no contents yet.
        if self.reads_in_background_after_load && !paths.is_empty() {
            let _ = messages.with_log(|log| provider.check_embedded_files(log));
        }
        if !are_assets {
            self.background_reads_disabled
                .store(true, Ordering::Release);
        }
        are_assets
    }

    fn record_unreadable(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.unreadable.lock().push(path.to_vec());
        Cow::default()
    }

    fn requested_loader(&self, loader: HostLoader, path: &[u8]) -> Loader {
        match host_loader_kind(loader) {
            Some(HostLoaderKind::Loader(loader)) => return loader,
            Some(HostLoaderKind::ByName) => {}
            None => {
                let path = BStr::new(to_native(path));
                let message = format!("unknown host loader {} for {path}", loader.0);
                (self.input.messages).report_internal_error(message.into_bytes());
            }
        }
        loader_by_name(path)
    }

    /// Of a program of test files: whether the loader finds the import in a program below, told without a search on disk, which costs
    /// more than the rest of such a build. What test files import under the name of a package or an alias is below: the builds
    /// there began with it. A path is tried with the endings of files with code.
    fn is_import_of_test_file_from_below(&self, request: &CodeRequest<'_>) -> bool {
        const ENDINGS: [&[u8]; 10] = [
            b"", b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts", b".json",
        ];
        let aot = &self.input.options.aot;
        if !aot.is_part_of_test_files {
            return false;
        }
        // `mock.module("file:./a.ts", ..)` names a path too.
        let specifier = match request.specifier.strip_prefix(b"file:") {
            Some(path @ [b'.', b'/' | b'.', ..]) => path,
            _ => request.specifier,
        };
        if !matches!(specifier, [b'/', ..] | [b'.'] | [b'.', b'/' | b'.', ..]) {
            return true;
        }
        let path = bun_sema::resolve::join(request.directory, specifier);
        let holds = |start: &[u8], middle: &[u8]| {
            ENDINGS.iter().any(|ending| {
                let path = [start, middle, ending].concat();
                aot.images_below.holds_module(to_native(&path))
            })
        };
        // `./a.js` is how a TypeScript file names `./a.ts`.
        let without_extension = bun_core::strings::last_index_of_char(&path, b'.')
            .filter(|&dot| !bun_core::strings::contains_char(&path[dot..], b'/'))
            .map(|dot| &path[..dot]);
        holds(&path, b"")
            || holds(&path, b"/index")
            || without_extension.is_some_and(|start| holds(start, b""))
    }

    /// `LoadOptions::left_to_loader`, where the request spells a path to one of them.
    fn find_file_left_to_loader(&self, request: &CodeRequest<'_>) -> Option<Vec<u8>> {
        const ENDINGS: [&[u8]; 9] = [
            b"", b".ts", b".tsx", b".js", b".jsx", b".mjs", b".cjs", b".mts", b".cts",
        ];
        let left = &self.input.options.load.left_to_loader;
        // An executable has no loader to leave it to: the file stays in the program, and its load throws.
        if left.is_empty()
            || !self.input.options.load.runs_tests
            || !matches!(request.specifier, [b'/', ..] | [b'.', b'/' | b'.', ..])
        {
            return None;
        }
        let path = bun_sema::resolve::join(request.directory, request.specifier);
        ENDINGS.iter().find_map(|ending| {
            let path = [&path[..], ending].concat();
            let found = left.binary_search_by(|file| file[..].cmp(to_native(&path)));
            found.ok().map(|at| left[at].clone())
        })
    }

    // Code of the programs below may load a file of data by a path that it is given, and gets the object that the test file has. The build of a test
    // file does not see those loads, so it does not hold the file: the loader of the run time does, as under `bun test`.
    fn is_data_that_only_test_files_import(&self, path: &[u8]) -> bool {
        matches!(
            self.default_loader(path),
            Loader::Json | Loader::Jsonc | Loader::Json5 | Loader::Toml | Loader::Yaml
        ) && matches!(self.served_by(path), ServedBy::Disk)
            && self.plugin_loader(path).is_none()
    }

    fn runtime_resolution(&self, specifier: &[u8]) -> Option<HostResolution> {
        match self.input.runtime_modules.resolve_module(specifier, b"")? {
            RuntimeResolution::Module(id) => Some(HostResolution::Module(id)),
            RuntimeResolution::HostValue => Some(HostResolution::External {
                specifier: specifier.to_vec(),
                kind: ExternalKind::HostValue,
            }),
        }
    }
}

impl Host for LoadHost<'_> {
    delegate_host_services_to_disk!(disk);

    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let path = self.modules_with_queries.file_behind(path);
        match self.served_by(path) {
            ServedBy::PluginModule => match self.plugins.read(path, self.default_loader(path)) {
                ModuleText::Text(text) => Some(text),
                ModuleText::Deferred | ModuleText::Missing | ModuleText::Failed => None,
            },
            ServedBy::EvaluatedText => self.evaluated_texts.read(path),
            ServedBy::Declarations(text) => Some(Cow::Borrowed(text)),
            ServedBy::RuntimeTypes => runtime_types::read(path).map(Cow::Owned),
            ServedBy::Disk => self.disk.read(path),
        }
    }

    // The files that run have been read by now, each through the plugins.
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        let path = self.modules_with_queries.file_behind(path);
        let is_on_disk = matches!(self.served_by(path), ServedBy::Disk);
        if is_on_disk && !self.plugins.was_read(path) && !self.is_background_read(path) {
            return without_commonjs_wrapper(self.disk.read_source(path));
        }
        if self.loader_in_place_of_typed_file(path).is_some() {
            return self.disk.read_source(path);
        }
        match self.read_code(path) {
            CodeRead::Text(text) => text,
            CodeRead::Deferred => Cow::default(),
        }
    }

    fn file_stamp(&self, path: &[u8]) -> Option<FileStamp> {
        let path = self.modules_with_queries.file_behind(path);
        match self.served_by(path) {
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => Some(FileStamp::IMMUTABLE),
            ServedBy::Disk if !self.plugins.was_read(path) && !self.is_background_read(path) => {
                self.disk.file_stamp(path)
            }
            _ => None,
        }
    }

    fn is_file(&self, path: &[u8]) -> bool {
        if !is_host_path(path) {
            return (self.disk).is_file(self.modules_with_queries.file_behind(path));
        }
        match self.served_by(path) {
            ServedBy::PluginModule
            | ServedBy::EvaluatedText
            | ServedBy::Declarations(_)
            | ServedBy::RuntimeTypes => true,
            ServedBy::Disk => false,
        }
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        match is_host_path(path) {
            true => runtime_types::is_dir(path),
            false => self.disk.is_dir(path),
        }
    }

    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        match is_host_path(path) {
            true => runtime_types::entries(path),
            false => self.disk.entries(path),
        }
    }

    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        match self.served_by(path) {
            ServedBy::EvaluatedText | ServedBy::Declarations(_) | ServedBy::RuntimeTypes => {
                return None;
            }
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        if is_bundled(path) {
            return None;
        }
        if is_declaration_file_name(path) {
            return self.runs_despite_its_name(path).then_some(ScriptKind::Ts);
        }
        let loader = match self.plugin_loader(path) {
            Some(loader) if self.loader_in_place_of_typed_file(path).is_none() => loader,
            Some(_) | None => self.default_loader(path),
        };
        script_kind_of(loader).filter(|kind| kind.differs_from_name(path))
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &self.extra_extensions
    }
}

impl LoadHost<'_> {
    fn import_names_or_compile_components<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        // A file that gets the names keeps its components as they are written.
        let (load, aot) = (&self.input.options.load, &self.input.options.aot);
        let by_workers_too = &load.loaded_by_workers_too;
        let may_load_in_worker = !self.is_test_file_or_preload(request.path)
            || self.is_entry_point_added_by_build(request.path)
            || (by_workers_too.binary_search_by(|path| path[..].cmp(request.path))).is_ok();
        // The files above a layer load its entry points, the runner those of any other build.
        let is_started_by_runner =
            self.is_entry_point(request.path) && (!aot.shares_realms || aot.is_part_of_test_files);
        if load.runs_tests
            && source.kind == SourceKind::Program
            && test_runner_names::import_used_names(
                arena,
                atoms,
                request,
                test_runner_names::FileOfTestRun {
                    has_globals_of_vitest: load.has_globals_of_vitest,
                    is_entry_point: self.is_entry_point(request.path),
                    may_load_below_vitest: load.entry_point_imports_vitest && !is_started_by_runner,
                    may_load_in_worker,
                    has_names_of_every_runner: false,
                },
            ) == TreeChange::Changed
        {
            source.binds_names_of_test_runner = !may_load_in_worker;
            return TreeChange::Changed;
        }
        // `bun test` leaves the test files and the preloads as they are written.
        if load.runs_tests && self.is_test_file_or_preload(request.path) {
            return TreeChange::Unchanged;
        }
        self.react_compiler.transform(arena, atoms, request, source)
    }
}

impl CodeHost for LoadHost<'_> {
    delegate_runtime_config_parsers_to_disk!(disk);

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        let is_import = match request.kind {
            CodeImportKind::EntryPoint => false,
            CodeImportKind::Import | CodeImportKind::Require => true,
        };
        if is_import && request.specifier == BUNDLE_MODULE {
            return HostResolution::Erased;
        }
        let mut entry_texts = self.input.options.load.entry_texts.iter();
        if !is_import && let Some(text) = entry_texts.find(|it| it.name == request.specifier) {
            return HostResolution::Path(self.plugins.add_entry_text(text));
        }
        if !is_import {
            let found = self.found_entry_texts.lock();
            if let Some(text) = found.iter().find(|it| it.name == request.specifier) {
                return HostResolution::Path(self.plugins.add_entry_text(text));
            }
        }
        // The first of the programs of the realm holds Bun's own modules. A file with a query is an instance of its own, which the loader makes.
        // `bun` is the object `Bun` wherever a text names it: no loader is asked, so no mock stands in its place.
        if is_import
            && self.input.options.aot.imports_are_in_other_images
            && request.form != CodeImportForm::Macro
            && !matches!(
                request.specifier,
                b"bun" | b"bun:test" | b"@jest/globals" | b"vitest"
            )
            && (bun_core::strings::contains_char(request.specifier, b'?')
                || self.runtime_resolution(request.specifier).is_some()
                || self.is_import_of_test_file_from_below(request))
        {
            // The loader knows `fs`. Only whoever reads the text of a program takes `bun:fs` for it.
            let specifier = Alias::bun_prefixed_builtin(request.specifier);
            return HostResolution::External {
                specifier: specifier.unwrap_or(request.specifier).to_vec(),
                kind: ExternalKind::UncompiledCode,
            };
        }
        if is_import && let Some(path) = self.find_file_left_to_loader(request) {
            return HostResolution::External {
                specifier: path,
                kind: ExternalKind::UncompiledCode,
            };
        }
        if is_import && let Some(resolution) = self.runtime_resolution(request.specifier) {
            return resolution;
        }
        // The bundler resolves the file of a macro by itself.
        let resolution = match request.form {
            CodeImportForm::Macro => PluginResolution::NotHandled,
            CodeImportForm::Static | CodeImportForm::Dynamic | CodeImportForm::ResolveOnly => {
                self.plugins.resolve(request)
            }
        };
        match resolution {
            PluginResolution::Path(path) => return HostResolution::Path(path),
            PluginResolution::External { specifier } => {
                // An alias for a module of Bun's own, which is compiled like any that the program names.
                if let Some(resolution) = self.runtime_resolution(&specifier) {
                    return resolution;
                }
                return HostResolution::External {
                    specifier,
                    kind: ExternalKind::UncompiledCode,
                };
            }
            PluginResolution::NotHandled => {}
        }
        let keys = &self.input.options.load.in_memory_file_keys;
        if let Ok(index) = keys.binary_search_by(|(key, _)| key.as_slice().cmp(request.specifier)) {
            return HostResolution::Path(from_native(&keys[index].1));
        }
        // A text that the build knows holds the path of a file as the program sees it when it runs.
        let options = self.input.options;
        if is_import
            && !options.aot.runs_in_place
            && let Some(path) = find_file_named_as_in_executable(&options.paths, request.specifier)
            && let path = from_native(&path)
            && self.is_file(&path)
        {
            return HostResolution::Path(path);
        }
        let externals = &self.input.options.load.externals;
        let directory = to_native(request.directory);
        match is_import && is_external(externals, request.specifier, directory) {
            true => HostResolution::External {
                specifier: request.specifier.to_vec(),
                kind: ExternalKind::UncompiledCode,
            },
            false => HostResolution::Unclaimed,
        }
    }

    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
        // `new Function('return import("dep")')`: a package is looked for from the file that makes the function. A path is left to the run time, `is_import_call_of_package`.
        if !matches!(search.specifier.first(), Some(b'.' | b'/') | None)
            && let Some(holder) = self.evaluated_texts.holder_in_folder(search.directory)
        {
            let directory = self.directory_of(&holder);
            return self.find_code_file(&FileSearch {
                directory: &directory,
                ..*search
            });
        }
        // The resolver of the provider sees the disk alone. A file that the build was given in memory comes first.
        // A program that runs in place imports what is on the disk: what its build is given in memory is an entry point that no import names.
        let options = self.input.options;
        let in_memory_files = &options.load.in_memory_files;
        if !in_memory_files.is_empty()
            && !options.aot.runs_in_place
            && let found = options.code.find_file_plainly(self, search)
            && let FoundCode::File { path, .. } = &found
            && (in_memory_files.iter()).any(|(file, _)| file.as_slice() == to_native(path))
        {
            return found;
        }
        let found = self.input.provider.find_file(self, search);
        let is_chai_of_test_run = options.load.runs_tests && search.specifier == b"chai";
        if !is_chai_of_test_run || !matches!(found, FoundCode::NotFound(_)) {
            return found;
        }
        // `NamesOfChai`. pnpm links chai next to vitest, not into the project's node_modules.
        let vitest = FileSearch {
            specifier: b"vitest/package.json",
            ..*search
        };
        let FoundCode::File { path, .. } = self.input.provider.find_file(self, &vitest) else {
            return found;
        };
        let path = self.disk.realpath(&path);
        let next_to_vitest = FileSearch {
            directory: dirname::<Posix>(&path),
            ..*search
        };
        self.input.provider.find_file(self, &next_to_vitest)
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        let resolution = self.runtime_resolution(specifier);
        resolution.unwrap_or(HostResolution::Unclaimed)
    }

    // As under `bun test`: a test may serve a page after writing it, and it is bundled when it is served.
    fn is_in_other_program(&self, path: &[u8]) -> bool {
        let aot = &self.input.options.aot;
        aot.images_below.holds_module(to_native(path))
            || (aot.is_part_of_test_files && self.is_data_that_only_test_files_import(path))
            || (self.leaves_files_alone.load(Ordering::Relaxed)
                && self.files_left_alone.lock().contains(path))
    }

    fn is_form_in_other_program(&self, path: &[u8], type_attribute: &[u8]) -> bool {
        let aot = &self.input.options.aot;
        let path = to_native(path);
        // Which of two types of one file comes first shows when a test file runs, where the test file asks for one and a file of a program below for the other.
        // So neither program holds the file: the loader of the run time does, as under `bun test`.
        let typed_by_tests = &aot.replaced_by_tests.data_files_imported_with_types;
        let is_typed_by_tests = || {
            typed_by_tests
                .binary_search_by(|it| it[..].cmp(path))
                .is_ok()
        };
        let is_asked_by_test_files =
            aot.is_part_of_test_files || (aot.shares_realms && is_typed_by_tests());
        // A page or a file with code that is read as text stays in the program: the run time makes something else of such a file.
        if is_asked_by_test_files
            && shares_place_in_loader(type_attribute)
            && parses_text_as_data(self.default_loader(path))
        {
            return true;
        }
        places_of_form(path, type_attribute)
            .is_some_and(|places| aot.images_below.holds_module(&places.path_of_form))
    }

    fn is_left_to_loader(&self, path: &[u8]) -> bool {
        (self.input.options.load.left_to_loader)
            .binary_search_by(|file| file[..].cmp(to_native(path)))
            .is_ok()
    }

    fn is_name_for_transpiler_alone(&self, specifier: &[u8]) -> bool {
        Alias::bun_prefixed_builtin(specifier).is_some()
    }

    fn is_builtin_module_in_other_program(&self, specifier: &[u8]) -> bool {
        self.input.options.aot.imports_are_in_other_images
            && self
                .input
                .runtime_modules
                .answers_get_builtin_module(specifier)
    }

    fn leaves_to_run_time(&self, path: &[u8]) -> bool {
        let aot = &self.input.options.aot;
        aot.runs_tests && !aot.checks_only && self.default_loader(path) == Loader::Html
    }

    fn kind_of_file_missing_at_build(&self) -> Option<ExternalKind> {
        // Without the option the run time loads data files and refuses code.
        Some(match self.input.options.aot.loads_code_from_disk {
            true => ExternalKind::UncompiledCode,
            false => ExternalKind::HostValue,
        })
    }

    fn create_file_from_data_url(&self, url: &[u8], type_attribute: &[u8]) -> Option<Vec<u8>> {
        let loader = Loader::from_string(type_attribute)?;
        match parses_text_as_data(loader) {
            true => self.plugins.add_data_url(url),
            false => None,
        }
    }

    // A test run has a loader, which reads the file again.
    fn holds_modules_with_queries(&self) -> bool {
        !self.input.options.load.runs_tests
    }

    fn add_module_with_query(
        &self,
        path: &[u8],
        query: &[u8],
        kind: CodeImportKind,
    ) -> Option<Vec<u8>> {
        let default_loader = self.default_loader(path);
        // `require("./addon.node?raw")` loads the addon: it goes by the name of the file before any loader is asked.
        let requires_addon = kind == CodeImportKind::Require && default_loader == Loader::Napi;
        let by_query = loader_by_query(query).filter(|_| !requires_addon);
        let loader = by_query.unwrap_or(default_loader);
        let is_text_of_module = script_kind_of(loader).is_some()
            || parses_text_as_data(loader)
            || loader == Loader::File;
        let is_file_of_program = matches!(self.served_by(path), ServedBy::Disk)
            && !is_bundled(path)
            && (by_query.is_some() || !is_declaration_file_name(path));
        (is_text_of_module && is_file_of_program)
            .then(|| self.modules_with_queries.add(path, query))
    }

    fn file_of_module<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        self.modules_with_queries.file_behind(path)
    }

    fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        let working_directory = &self.input.options.code.working_directory;
        match (self.plugins).directory_of_virtual_module(path, working_directory) {
            Some(directory) => Cow::Owned(directory),
            None => Cow::Borrowed(dirname::<Posix>(path)),
        }
    }

    // The run time looks from the directory in the name of the module, and the name of a `data:` URL holds none that exists.
    fn directory_of_dynamic_imports<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        match self.plugins.name_of_entry_text(path) {
            Some(name) if is_url_with_text(name) => {
                Cow::Owned(dirname::<Posix>(&[b"/", name].concat()).to_vec())
            }
            Some(_) | None => self.directory_of(path),
        }
    }

    // The executable holds a module of Bun's own only if code names it: the run time refuses any other.
    fn find_runtime_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostResolution> {
        if prefix.is_empty() && suffix.is_empty() {
            return Vec::new();
        }
        let modules = self.input.runtime_modules.find_modules(prefix, suffix);
        modules.into_iter().map(HostResolution::Module).collect()
    }

    fn compiler_declarations(&self) -> Vec<Vec<u8>> {
        let mut files = vec![compiler_declarations::PATH.to_vec()];
        if self.input.options.aot.is_part_of_test_files {
            files.push(compiler_declarations::PATH_OF_MODULES_IN_OTHER_IMAGES.to_vec());
        }
        files
    }

    fn declarations_beside_bun_types(&self, are_installed: bool) -> Vec<Vec<u8>> {
        if !self.input.options.load.runs_tests {
            return Vec::new();
        }
        let mut files = vec![runtime_declarations::OTHER_NAMES_OF_TEST_RUNNER_PATH.to_vec()];
        // A project that has installed them refers to this file itself.
        if !are_installed {
            files.push(runtime_types::GLOBALS_OF_TEST_RUNNER.to_vec());
        }
        files
    }

    fn declarations_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        Some(runtime_declarations::PATH.to_vec())
    }

    fn type_root_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        (!self.input.options.load.takes_runtime_as_any).then(|| runtime_types::TYPE_ROOT.to_vec())
    }

    fn errors_with_bun_types(&self) -> Option<&[(Vec<u8>, u32)]> {
        self.input.options.load.errors_with_bun_types.as_deref()
    }

    fn loader_of(&self, request: &LoaderRequest<'_>) -> HostLoader {
        let path = request.path;
        match self.served_by(path) {
            ServedBy::EvaluatedText | ServedBy::Declarations(_) | ServedBy::RuntimeTypes => {
                return BY_NAME;
            }
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        let without_attribute = || match self.modules_with_queries.loader_by_query(path) {
            Some(loader) => to_host_loader_of_query(loader),
            None => {
                let is_linked_by_bundler = request.is_linked_by_bundler;
                let loader = self.default_loader_for(path, request.kind, is_linked_by_bundler);
                to_host_loader(loader, path)
            }
        };
        let is_embedded = matches!(request.embed_attribute, Some(b"true"));
        let chosen = match request.type_attribute {
            None => return without_attribute(),
            Some(b"macro") => {
                let message = [
                    &b"a macro import was followed as code: "[..],
                    to_native(path),
                ];
                (self.input.messages).report_internal_error(message.concat());
                return without_attribute();
            }
            Some(name) => match Loader::from_string(name) {
                Some(Loader::Sqlite) if is_embedded => Loader::SqliteEmbedded,
                Some(loader) => loader,
                None => return without_attribute(),
            },
        };
        to_host_loader_of_attribute(chosen, path)
    }

    fn loads_as_code(&self, path: &[u8], loader: HostLoader) -> bool {
        script_kind_of(self.requested_loader(loader, path)).is_some()
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        let path = self.modules_with_queries.file_behind(path);
        let served_by = self.served_by(path);
        match served_by {
            ServedBy::EvaluatedText => {
                let text = self.evaluated_texts.read(path);
                return CodeRead::Text(text.unwrap_or_else(|| self.record_unreadable(path)));
            }
            ServedBy::Declarations(text) => return CodeRead::Text(Cow::Borrowed(text)),
            ServedBy::RuntimeTypes => {
                let text = runtime_types::read(path).map(Cow::Owned);
                return CodeRead::Text(text.unwrap_or_else(|| self.record_unreadable(path)));
            }
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        if !self.should_ask_plugins(served_by, path) {
            return CodeRead::Text(without_commonjs_wrapper(self.disk.read_source(path)));
        }
        match self.plugins.read(path, self.default_loader(path)) {
            ModuleText::Text(text) => CodeRead::Text(without_commonjs_wrapper(text)),
            ModuleText::Deferred => CodeRead::Deferred,
            ModuleText::Missing => CodeRead::Text(self.record_unreadable(path)),
            ModuleText::Failed => CodeRead::Text(Cow::default()),
        }
    }

    fn is_read_by_plugin(&self, path: &[u8]) -> bool {
        let path = self.modules_with_queries.file_behind(path);
        self.should_ask_plugins(self.served_by(path), path) && self.plugins.has_load_plugin(path)
    }

    fn finish_deferred_reads(&self) -> Vec<(Vec<u8>, Cow<'static, [u8]>)> {
        let DeferredReads { texts, missing } = self.plugins.finish_deferred_reads();
        self.unreadable.lock().extend(missing);
        texts
    }

    fn can_read_in_background(&self, path: &[u8], loader: HostLoader) -> bool {
        !self.background_reads_disabled.load(Ordering::Acquire)
            && self.requested_loader(loader, path) == Loader::File
            && self.input.provider.asset_paths_ignore_contents()
    }

    fn start_background_reads(&self, paths: &[&[u8]]) -> bool {
        if self.has_run_macros.load(Ordering::Acquire) {
            return false;
        }
        let mut paths: Vec<Vec<u8>> = paths.iter().map(|path| path.to_vec()).collect();
        paths.shared_sort_unstable();
        paths.dedup();
        *self.background_reads.lock() = paths;
        true
    }

    fn reads_in_background_after_load(&self) -> bool {
        self.reads_in_background_after_load
    }

    fn read_in_background(&self, path: &[u8]) {
        let path = self.modules_with_queries.file_behind(path);
        self.plugins.read(path, self.default_loader(path));
    }

    fn is_plugin_source(&self, path: &[u8]) -> bool {
        self.plugin_loader(path).is_some()
    }

    fn loader_of_code_in_place_of_typed_file(&self, path: &[u8]) -> Option<HostLoader> {
        let loader = to_host_loader(self.loader_in_place_of_typed_file(path)?, path);
        (loader != BY_NAME).then_some(loader)
    }

    fn is_evaluated_text(&self, path: &[u8]) -> bool {
        self.evaluated_texts.contains(path)
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        let path = request.path;
        // A name that `find_file_left_to_loader` does not follow has led here: an alias of the tsconfig.json, a package. Nothing is compiled from the text, and the load throws.
        if self.is_left_to_loader(path) {
            let options = CompileParseOptions {
                path,
                script_kind: Some(ScriptKind::Js),
                experimental_decorators: false,
                every_file_is_a_module: false,
                reads_jsdoc: false,
                ignores_pure_comments: false,
            };
            return ParsedCode {
                hir: parse_for_compile(arena, &options, IN_PLACE_OF_NO_PROGRAM, atoms),
                host_values: &[],
                payload: Some(Box::new(ParsedSource {
                    byte_count: text.len(),
                    parse_failure: Some(b"an earlier compile could not take the file".to_vec()),
                    // Elsewhere the loader reads the file on disk.
                    text_that_fails_at_load: (!self.input.options.load.runs_tests
                        && !self.input.options.aot.runs_in_place)
                        .then(|| text.into()),
                    ..ParsedSource::new(SourceKind::Program, Loader::Js)
                })),
            };
        }
        let served_by = self.served_by(path);
        let requested_loader = self.requested_loader(request.loader, path);
        let is_background_read = requested_loader == Loader::File && self.is_background_read(path);
        let plugin_loader = match is_background_read {
            true => None,
            false => self.plugin_loader(path),
        };
        let loader = match served_by {
            ServedBy::EvaluatedText => Loader::Js,
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => Loader::Ts,
            ServedBy::PluginModule | ServedBy::Disk => plugin_loader.unwrap_or(requested_loader),
        };
        let is_from_plugin = plugin_loader.is_some();
        let plugin_module = self.plugins.virtual_module(path);
        let plugin_module = plugin_module.map(|(namespace, path)| PluginModuleName {
            namespace: namespace.into(),
            path: path.into(),
        });
        let file_with_query = || {
            let module = self.modules_with_queries.find(path)?;
            Some(FileWithQuery {
                file: module.file.as_slice().into(),
                query: module.query.as_slice().into(),
            })
        };
        let parse_data = |loader: Loader, plugin_module: Option<PluginModuleName>| {
            let source = SourceFile {
                path: (self.plugins).provider_path(self.modules_with_queries.file_behind(path)),
                contents: text,
                loader,
            };
            let (provider, messages) = (self.input.provider, self.input.messages);
            if self.input.options.load.runs_tests {
                report_blank_json(messages, &source);
            }
            let parsed = parse_data_module(provider, messages, &source, arena, atoms);
            ParsedCode {
                hir: parsed.hir,
                host_values: parsed.host_values,
                payload: Some(Box::new(ParsedSource {
                    byte_count: text.len(),
                    is_from_plugin,
                    plugin_module,
                    file_with_query: file_with_query(),
                    web_assembly: parsed.web_assembly,
                    is_page: parsed.is_page,
                    ..ParsedSource::new(SourceKind::Data, loader)
                })),
            }
        };
        let Some(script_kind) = script_kind_of(loader) else {
            return parse_data(loader, plugin_module);
        };
        let source_kind = match served_by {
            ServedBy::EvaluatedText => SourceKind::EvaluatedText,
            _ => SourceKind::Program,
        };
        let compile_options = CompileParseOptions {
            path,
            script_kind: Some(script_kind)
                .filter(|kind| kind.differs_from_name(path) || self.runs_despite_its_name(path)),
            experimental_decorators: request.options.experimental_decorators
                && !script_kind.is_javascript(),
            every_file_is_a_module: request.options.module_detection == ModuleDetection::Force,
            reads_jsdoc: request.reads_jsdoc,
            ignores_pure_comments: source_kind == SourceKind::EvaluatedText
                || hir::find_transpiled_mark(text).is_some(),
        };
        let mut hir = parse_for_compile(arena, &compile_options, text, atoms);
        let is_entry_text = self.plugins.loader_of_entry_text(path).is_some();
        let is_language_assumed = is_entry_text
            || (matches!(served_by, ServedBy::Disk)
                && !is_from_plugin
                && loader_named_by_path(&self.input.options.load.loaders, path).is_none());
        let is_entry_point = is_entry_text || self.is_entry_point(path);
        // A test run goes on where a test catches what the load of a file throws, as `bun test` does, and one file with a mistake stops no other test file.
        let fails_where_loaded = self.input.options.load.runs_tests
            && matches!(served_by, ServedBy::Disk)
            && !is_from_plugin;
        let parse_failure = match (is_language_assumed || fails_where_loaded) && !is_entry_point {
            true => describe_parse_failure(&hir, text),
            false => None,
        };
        // `bun run` fails where the program loads it. An executable carries it where `bun build` does, like a file of a kind that nothing names.
        if parse_failure.is_some()
            && !self.input.options.aot.runs_in_place
            && request.loader == BY_NAME
        {
            return parse_data(Loader::File, plugin_module);
        }
        if parse_failure.is_some() {
            hir = parse_for_compile(arena, &compile_options, IN_PLACE_OF_NO_PROGRAM, atoms);
        } else if is_language_assumed && hir.check_directive.is_none() {
            let javascript_options = CompileParseOptions {
                script_kind: Some(ScriptKind::Jsx),
                ..compile_options
            };
            let as_javascript = parse_for_compile(arena, &javascript_options, text, atoms);
            // Nothing says that the text is TypeScript, and it is JavaScript too.
            let is_javascript = !has_syntax_errors(&hir)
                && !has_syntax_errors(&as_javascript)
                && find_type_ranges(&hir).is_empty();
            if is_javascript {
                hir.check_directive = Some(false);
            }
        }
        // `tsc` has other rules for a declaration file than for the same text as a program.
        if self.runs_despite_its_name(path) {
            hir.check_directive = Some(false);
        }
        ParsedCode {
            hir,
            host_values: &[],
            payload: Some(Box::new(ParsedSource {
                byte_count: text.len(),
                is_from_plugin,
                plugin_module,
                file_with_query: file_with_query(),
                parse_failure,
                is_language_assumed,
                ..ParsedSource::new(source_kind, loader)
            })),
        }
    }

    fn run_macros<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &MacroRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> &'s [(ExprId, HostValue<'s>)] {
        if !request.analysis.pending_macro_calls.is_empty() {
            self.has_run_macros.store(true, Ordering::Release);
        }
        macros::run_macros(
            self.input.provider,
            self.input.messages,
            self.input.options.load.runs_macros,
            arena,
            atoms,
            request,
            &mut parsed_source_mut(payload).diagnostics,
        )
    }

    fn transform_tree<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> TreeChange {
        let source = parsed_source_mut(payload);
        if source.kind == SourceKind::EvaluatedText && source.source_url_of_text.is_none() {
            let (text, comments) = (&request.hir.text, &request.hir.comments);
            source.source_url_of_text = find_source_url(text, comments).map(Box::from);
        }
        if source.kind == SourceKind::Program
            && made_own_require::keep_own_require(request) == TreeChange::Changed
        {
            return TreeChange::ChangedAndUnfinished;
        }
        // It goes by the shape of the tree alone. The imports that it writes for eager entries are imports like any other to what follows: a hoisted mock goes above
        // them too. That asks for their bindings.
        let (provider, messages) = (self.input.provider, self.input.messages);
        let runs_tests = self.input.options.load.runs_tests;
        if !std::mem::replace(&mut source.has_expanded_globs, true)
            && import_meta_glob::expand_calls(
                provider, messages, arena, atoms, request, source, runs_tests,
            ) == TreeChange::Changed
        {
            return TreeChange::ChangedAndUnfinished;
        }
        let changed = self.import_names_or_compile_components(arena, atoms, request, source);
        if changed == TreeChange::Unchanged {
            return changed;
        }
        // A component comes back from its compiler as it was written.
        import_meta_glob::expand_calls(
            provider, messages, arena, atoms, request, source, runs_tests,
        );
        changed
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let source = parsed_source_mut(payload);
        let needs_declarations = self.react_compiler.needs_declarations(source);
        // No executable holds a file of the project that takes something from the test runner, wherever it lies. A package that asks `typeof jest` to find out where it runs
        // is given the name too, and the executable holds it.
        // A text that a file evaluates has a path of its own, which lies nowhere: `new Function("fake", "Date.now = fake")`. It goes by the file that holds it.
        let holder = self.find_file_that_holds_text(request.path);
        let is_in_package = is_in_node_modules(holder.as_deref().unwrap_or(request.path));
        let takes = match &holder {
            Some(holder) => self.take_from_test_runner.lock().contains(holder),
            None => {
                let takes = !is_in_package && builtin_uses::takes_from_test_runner(request);
                if takes {
                    (self.take_from_test_runner.lock()).insert(request.path.to_vec());
                }
                takes
            }
        };
        let place = holder.as_deref().unwrap_or(request.path);
        let is_of_tests = takes || self.is_of_tests(place);
        let is_of_tests_by_itself = takes || self.is_test_file(place);
        let input = BuiltinUseInput {
            names: self.input.builtin_names,
            platform: self.input.platform,
            replaced: &self.input.options.load.replaced_builtins,
            replaced_members_sought: match self.input.options.load.runs_tests {
                false => ReplacedMembersSought::NamesAdded,
                true if is_in_package => ReplacedMembersSought::Written,
                true if self.files_of_tests.is_some() && !is_of_tests => {
                    ReplacedMembersSought::WrittenOrNamedUnlessOfProduct
                }
                true => ReplacedMembersSought::WrittenOrNamed,
            },
            is_served_by_other_images: self.input.options.aot.imports_are_in_other_images,
        };
        let level = self.input.options.aot.code_generation_from_strings;
        let texts = (level == CodeGenerationFromStrings::Allowed).then_some(&self.evaluated_texts);
        let mut answers = builtin_uses::finish_application_file(
            &input,
            texts,
            needs_declarations,
            request,
            source,
        );
        let runtime_modules = self.input.runtime_modules;
        let named = find_library_modules_named_in_choices(
            request,
            &source.builtins,
            runtime_modules,
            self.input.limits,
        );
        let modules = named.modules.iter();
        let modules = modules.map(|it| HostModuleId(it.module.registry_id()));
        answers.extend(modules.map(HostResolution::Module));
        source.modules_named_in_choices = named.modules;
        source.library_names_passed_to_imports = named.passed_to_imports;
        // The first of the other images holds Bun's own modules, and the loader finds them there by whatever name the program computes. A copy here would find none of the
        // library's internal modules: `process.getBuiltinModule(name)` beside `import(other)`, where the file writes "fs" somewhere.
        if !self.input.options.aot.imports_are_in_other_images {
            source.library_modules_passed_for_parameters = named.passed_for_parameters;
            source.library_modules_written_as_values = named.written_as_values;
        }
        source.loads_by_unknown_name = named.loads_by_unknown_name;
        source.is_of_tests = AtomicBool::new(is_of_tests);
        source.is_of_tests_by_itself = is_of_tests_by_itself;
        source.is_in_package = is_in_package;
        source.unknown_names_at = named.unknown_names_at;
        // Without the option the run time refuses code that is not in the program.
        if self.input.options.aot.loads_code_from_disk {
            let is_there = |path: &[u8]| {
                self.is_in_other_program(path) || self.is_left_to_loader(path) || self.is_file(path)
            };
            source.files_missing_at_build_at = find_loads_of_files_missing_at_build(
                request,
                self.input.options.load.runs_tests,
                &|written| is_there(written) || is_there(&from_native(written)),
                &|written| parses_text_as_data(self.default_loader(written)),
            );
        }
        source.imports_given_unknown_names = named.imports_given_unknown_names;
        if self.input.options.load.runs_tests {
            let started_in = from_native(&self.input.options.code.working_directory);
            let mocks = find_manual_mocks(request, &started_in, &|path| self.is_file(path));
            source.manual_mocks.clone_from(&mocks);
            answers.extend(mocks.into_iter().map(HostResolution::Path));
        }
        answers
    }
}

#[cfg(test)]
pub(crate) mod tests;
