use std::borrow::Cow;
use std::num::NonZeroUsize;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use bstr::BStr;
use bun_ast::{Loader, Loc};
use bun_core::strings::{contains_char, is_all_whitespace};
use bun_paths::fs::PathName;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_resolve_builtins::Alias;
use bun_sema::atom::Interner;
use bun_sema::hir::{self, ExprId, NodeData};
use bun_sema::hir_from_data::{DataValue, FOLDER_OF_DATABASE, HostValue};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::module_format::ModuleFormat;
use bun_sema::program::{HostLoader, HostModuleId};
use bun_sema::resolve::{
    CodeHost, CodeImportForm, CodeImportKind, CodeParseRequest, CodeRead, CodeRequest,
    ComputedCodeRequest, EarlyTransformRequest, ExternalKind, FileSearch, FileStamp, FinishedFile,
    FoundCode, Host, HostPayload, HostResolution, LoaderRequest, MacroRequest, ModuleDetection,
    ParsedCode, ScriptKind, TransformRequest, TreeChange, is_declaration_file_name, join, to_path,
    to_path_in,
};
use bun_sema::session::{Arena, Session};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::Libs;
use bun_sema_driver::host::{AlreadyRead, Disk, from_argument, from_native, is_bundled, to_native};
use bun_sema_parser::{CompileParseOptions, appears_to_be_binary, parse_for_compile};
use bun_threading::Guarded;

use crate::builtins::{BuiltinNames, Platforms};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{
    FileDiagnostic, LoadMessages, log_diagnostic, range_of_node, syntax_errors_of,
};
use crate::load::builtin_uses::{self, BuiltinUseInput};
use crate::load::bundled_commonjs::{blank_commonjs_wrapper, is_bundled_commonjs};
use crate::load::compiler_declarations;
use crate::load::contents::worker_entries::{
    count_highest_level_on_way, find_file_named_as_in_executable, find_file_on_way,
    find_way_named_as_in_executable,
};
use crate::load::contents::{ScanInput, scan_file};
use crate::load::data_modules::{create_module_without_text, parse_data_module};
use crate::load::disk_delegation::{
    delegate_host_services_to_disk, delegate_runtime_config_parsers_to_disk,
};
use crate::load::externals::{contains, is_external};
use crate::load::import_meta_glob;
use crate::load::is_host_path;
use crate::load::loaders::{
    BY_NAME, HostLoaderKind, gives_data, host_loader_kind, is_taken_by_written_type,
    loader_by_name, loader_by_path, loader_named_by_path, parses_text_as_data, script_kind_of,
    to_host_loader, to_host_loader_of_attribute,
};
use crate::load::made_own_require;
use crate::load::manual_mocks::find_manual_mocks;
use crate::load::module_paths::{
    compute_display_path, compute_program_path, compute_relative_path, count_folders,
    count_levels_above,
};
use crate::load::modules_with_queries::{
    ModulesWithQueries, find_worker_constructor, has_vite_suffix,
};
use crate::load::plugin_modules::{DeferredReads, ModuleText, PluginModules, PluginResolution};
use crate::load::react_compiler::{self, ReactCompiler};
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};
use crate::load::runtime_types;
use crate::load::source_provider::{SourceFile, SourceProvider};
use crate::load::sources::{
    FileWithQuery, ParsedSource, PluginModuleName, SourceKind, parsed_source_mut,
};
use crate::load::test_runner_names;
use crate::load::text_for_json_parse::is_taken_by_json_parse;
use crate::module_keys::{is_url_with_text, loader_name, name_of_text};
use crate::options::{EntryText, Options};
use crate::statistics::{Stage, StepClock};

const BUNDLE_MODULE: &[u8] = b"bun:bundle";
const EMPTY_MODULE: &[u8] = b"export {};";
const JSON_PARSE_ERROR_FOR_BLANK_TEXT: &[u8] = b"JSON Parse error: Unexpected EOF";
const JSON_PARSE_ERROR: &[u8] = b"JSON Parse error: Unable to parse JSON string";
const PAGE_NOT_NAMED_AS_ONE: &[u8] =
    b"bun test --aot imports an HTML page only from a file that is named as one, like page.html";
const EXTENSIONS_OF_ENTRY_POINT_SOURCES: [&[u8]; 7] =
    [b"ts", b"tsx", b"jsx", b"mjs", b"mts", b"cjs", b"cts"];

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

fn ask_by_syntax<'r, 's>(
    request: &'r mut TransformRequest<'_, 's>,
) -> EarlyTransformRequest<'r, 's> {
    let analysis = request.analysis;
    EarlyTransformRequest {
        path: request.path,
        hir: &mut *request.hir,
        module_format: analysis.module_format,
        takes_import_statements: analysis.module_format == ModuleFormat::Esm
            || !analysis.module_formats.is_decided_by_text(),
        settings: request.settings,
        import_meta_main: request.import_meta_main,
    }
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
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct FileLeftOutByPattern {
    pub folder_of_text: Vec<u8>,
    pub start: Vec<u8>,
    pub end: Vec<u8>,
    pub begins_with_dot: bool,
    pub needs_extension: bool,
    pub path: Vec<u8>,
}

impl FileLeftOutByPattern {
    pub(crate) fn written_at(&self) -> [&[u8]; 3] {
        [&self.folder_of_text, &self.start, &self.end]
    }
}

pub(crate) struct LoadHost<'a> {
    disk: &'a Disk,
    input: LoadHostInput<'a>,
    plugins: PluginModules<'a>,
    modules_with_queries: ModulesWithQueries,
    react_compiler: ReactCompiler<'a>,
    entry_point_paths: Vec<Vec<u8>>,
    outfile: Option<Vec<u8>>,
    other_products: Vec<Vec<u8>>,
    files_left_out_by_patterns: Guarded<FxHashSet<FileLeftOutByPattern>>,
    guesses_left_out: Guarded<Option<Option<Vec<u8>>>>,
    found_entry_point_paths: Guarded<Vec<Vec<u8>>>,
    has_found_entry_points: AtomicBool,
    may_store_path_of_main_module: AtomicBool,
    has_file_that_asks_for_what_unseen_code_finds: AtomicBool,
    levels_above_root: AtomicUsize,
    levels_of_texts: Guarded<FxHashMap<Vec<u8>, usize>>,
    holds_texts_of_levels: AtomicBool,
    highest_level_named: AtomicUsize,
    file_lost_with_texts_of_other_levels: Guarded<Option<Vec<u8>>>,
    binary_entry_point_paths: Vec<Vec<u8>>,
    entry_points_that_run_despite_their_names: Vec<Vec<u8>>,
    entry_points_by_file: Vec<(Vec<u8>, Vec<u8>)>,
    extra_extensions: Vec<(Vec<u8>, ScriptKind)>,
    unreadable: Guarded<Vec<Vec<u8>>>,
    background_reads: Guarded<Vec<Vec<u8>>>,
    files_asked_whether_code: Guarded<FxHashMap<Vec<u8>, bool>>,
    reads_in_background_after_load: bool,
}

#[derive(Copy, Clone)]
enum ServedBy {
    PluginModule,
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

fn collect_entry_points_by_file(options: &Options<'_>) -> Vec<(Vec<u8>, Vec<u8>)> {
    let paths = &options.paths;
    let names = paths.entry_point_file_names.iter();
    let mut by_file: Vec<(Vec<u8>, Vec<u8>)> = names
        .zip(&options.entry_points)
        .filter_map(|(name, entry_point)| {
            let in_executable = [&paths.module_prefix[..], &name[..]].concat();
            let on_disk = find_file_named_as_in_executable(paths, 0, &in_executable)?;
            let entry_point = from_argument(&options.code.working_directory, entry_point);
            Some((from_native(&on_disk), entry_point))
        })
        .collect();
    by_file.shared_sort_unstable();
    by_file
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

fn is_program(name: &[u8], text: &[u8], loader: Loader) -> bool {
    std::str::from_utf8(text).is_ok() && parses_as_program(name, text, loader)
}

fn parses_as_program(name: &[u8], text: &[u8], loader: Loader) -> bool {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let parse_options = CompileParseOptions {
        path: name,
        script_kind: script_kind_of(loader),
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let hir = parse_for_compile(session.arena(), &parse_options, text, &atoms);
    let is_refused = syntax_errors_of(&hir).next().is_some();
    !is_refused
}

fn is_javascript_too(typescript_options: &CompileParseOptions<'_>, text: &[u8]) -> bool {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let parse_options = CompileParseOptions {
        script_kind: Some(ScriptKind::Jsx),
        experimental_decorators: false,
        reads_jsdoc: false,
        ..*typescript_options
    };
    let hir = parse_for_compile(session.arena(), &parse_options, text, &atoms);
    let mut diagnostics = hir.diagnostics.iter();
    !hir.has_errors
        && !hir.ran_out_of_stack
        && diagnostics.all(|it| it.class != hir::DiagnosticClass::EarlyError)
}

impl<'a> LoadHost<'a> {
    pub(crate) fn begin_at_text(&self, url: &[u8], levels: Option<usize>) -> Option<Vec<u8>> {
        let text = EntryText {
            name: url.to_vec(),
            contents: self.input.provider.decode_data_url(url)?,
            loader: Loader::Tsx,
        };
        self.begin_at_text_of_blob(&text, levels)
    }

    pub(crate) fn write_url(&self, url: &[u8]) -> Option<Vec<u8>> {
        self.input.provider.write_url(url, None)
    }

    pub(crate) fn name_text_of_blob(
        &self,
        contents: &[u8],
        r#type: Option<&[u8]>,
    ) -> Option<EntryText> {
        let loader = self.input.provider.loader_of_blob(r#type);
        let loader = loader.filter(|&loader| script_kind_of(loader).is_some())?;
        Some(EntryText {
            name: name_of_text(loader, contents),
            contents: contents.to_vec(),
            loader,
        })
    }

    pub(crate) fn begin_at_text_of_blob(
        &self,
        text: &EntryText,
        levels: Option<usize>,
    ) -> Option<Vec<u8>> {
        if !is_program(&text.name, &text.contents, text.loader) {
            return None;
        }
        let path = self.plugins.add_entry_text(text, levels);
        if let Some(levels) = levels {
            self.levels_of_texts.lock().insert(path.clone(), levels);
            self.holds_texts_of_levels.store(true, Ordering::Relaxed);
        }
        Some(path)
    }

    pub(crate) fn begin_at(&self, entry_points: &[Vec<u8>]) {
        let paths = collect_entry_point_paths(self.disk, self.input.options, entry_points);
        self.has_found_entry_points
            .store(!paths.is_empty(), Ordering::Relaxed);
        *self.found_entry_point_paths.lock() = paths;
    }

    pub(crate) fn into_leftovers(self) -> Box<dyn Send> {
        self.plugins.into_leftovers()
    }

    pub(crate) fn new(input: LoadHostInput<'a>) -> LoadHost<'a> {
        let (disk, provider, messages) = (input.disk, input.provider, input.messages);
        let options = input.options;
        let load = &options.load;
        let entry_point_paths = collect_entry_point_paths(disk, options, &options.entry_points);
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
            react_compiler: ReactCompiler::new(load.react_compiler, provider, messages)
                .with_filter(load.react_compiler_filter)
                .with_names_bound_again(options.reads_back_what_it_writes()),
            binary_entry_point_paths: binary_entry_point_paths.collect(),
            entry_points_that_run_despite_their_names,
            entry_points_by_file: collect_entry_points_by_file(options),
            entry_point_paths,
            outfile: provider.outfile().map(from_native),
            other_products: (options.aot.other_products.iter())
                .map(|path| from_native(path))
                .collect(),
            files_left_out_by_patterns: Guarded::new(FxHashSet::default()),
            guesses_left_out: Guarded::new(None),
            found_entry_point_paths: Guarded::new(Vec::new()),
            has_found_entry_points: AtomicBool::new(false),
            may_store_path_of_main_module: AtomicBool::new(false),
            levels_above_root: AtomicUsize::new(0),
            levels_of_texts: Guarded::new(FxHashMap::default()),
            holds_texts_of_levels: AtomicBool::new(false),
            highest_level_named: AtomicUsize::new(0),
            file_lost_with_texts_of_other_levels: Guarded::new(None),
            has_file_that_asks_for_what_unseen_code_finds: AtomicBool::new(false),
            extra_extensions: extra_extensions.collect(),
            unreadable: Guarded::new(Vec::new()),
            background_reads: Guarded::new(Vec::new()),
            files_asked_whether_code: Guarded::new(FxHashMap::default()),
            reads_in_background_after_load: false,
            input,
        }
    }

    pub(crate) fn reading_in_background_after_load(self) -> LoadHost<'a> {
        LoadHost {
            reads_in_background_after_load: true,
            ..self
        }
    }

    pub(crate) fn guesses_left_out(&self) -> Option<Option<Vec<u8>>> {
        self.guesses_left_out.lock().clone()
    }

    pub(crate) fn files_left_out_by_patterns(&self) -> Vec<FileLeftOutByPattern> {
        let files = self.files_left_out_by_patterns.lock();
        let mut files: Vec<FileLeftOutByPattern> = files.iter().cloned().collect();
        files.shared_sort_unstable();
        files
    }

    pub(crate) fn display_path_of(&self, path: &[u8]) -> Box<[u8]> {
        compute_display_path(&self.input.options.load.project_root, to_native(path))
    }

    pub(crate) fn background_reads(&self) -> Vec<Vec<u8>> {
        self.background_reads.lock().clone()
    }

    pub(crate) fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        let working_directory = &self.input.options.code.working_directory;
        match (self.plugins).directory_of_virtual_module(path, working_directory) {
            Some(directory) => Cow::Owned(directory),
            None => Cow::Borrowed(dirname::<Posix>(path)),
        }
    }

    fn is_same_path(&self, a: &[u8], b: &[u8]) -> bool {
        match self.disk.is_case_sensitive() {
            true => a == b,
            false => a.eq_ignore_ascii_case(b),
        }
    }

    fn served_by(&self, path: &[u8]) -> ServedBy {
        if !is_host_path(path) {
            return ServedBy::Disk;
        }
        if self.plugins.virtual_module(path).is_some() {
            return ServedBy::PluginModule;
        }
        if path == react_compiler::DECLARATIONS_PATH {
            return ServedBy::Declarations(react_compiler::DECLARATIONS);
        }
        if path == runtime_types::OTHER_NAMES_OF_TEST_RUNNER_PATH {
            return ServedBy::Declarations(runtime_types::OTHER_NAMES_OF_TEST_RUNNER);
        }
        if path == compiler_declarations::PATH {
            return ServedBy::Declarations(compiler_declarations::TEXT);
        }
        if path == runtime_types::GLOBALS_THAT_NOTHING_DECLARES_PATH {
            return ServedBy::Declarations(runtime_types::globals_that_nothing_declares());
        }
        match runtime_types::is_file(path) {
            true => ServedBy::RuntimeTypes,
            false => ServedBy::Disk,
        }
    }

    fn should_ask_plugins(&self, served_by: ServedBy, path: &[u8]) -> bool {
        match served_by {
            ServedBy::PluginModule => true,
            ServedBy::Disk => {
                !is_bundled(path)
                    && !is_declaration_file_name(path)
                    && self.default_loader(path) != Loader::Html
            }
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => false,
        }
    }

    fn is_entry_point(&self, path: &[u8]) -> bool {
        self.is_among(&self.entry_point_paths, path)
            || (self.has_found_entry_points.load(Ordering::Relaxed)
                && self.is_among(&self.found_entry_point_paths.lock(), path))
    }

    pub(crate) fn settle_levels_above_root(&self, levels: usize) {
        self.levels_above_root.store(levels, Ordering::Relaxed);
    }

    pub(crate) fn note_file_lost_with_texts_of_other_levels(&self, file: Vec<u8>) {
        *self.file_lost_with_texts_of_other_levels.lock() = Some(file);
    }

    pub(crate) fn file_lost_with_texts_of_other_levels(&self) -> Option<Vec<u8>> {
        self.file_lost_with_texts_of_other_levels.lock().clone()
    }

    pub(crate) fn levels_above_root(&self) -> Option<usize> {
        Some(self.levels_above_root.load(Ordering::Relaxed)).filter(|&levels| levels > 0)
    }

    pub(crate) fn levels_of_text(&self, file: &[u8]) -> Option<usize> {
        match self.holds_texts_of_levels.load(Ordering::Relaxed) {
            true => self.levels_of_texts.lock().get(file).copied(),
            false => None,
        }
    }

    pub(crate) fn levels_above_root_seen_from(&self, file: &[u8]) -> usize {
        let of_text = self.levels_of_text(file);
        of_text.or_else(|| self.levels_above_root()).unwrap_or(0)
    }

    pub(crate) fn highest_level_named(&self) -> usize {
        self.highest_level_named.load(Ordering::Relaxed)
    }

    pub(crate) fn note_way_named(&self, way: &[u8]) {
        let folders = count_folders(&self.input.options.paths.root_directory);
        let highest = count_highest_level_on_way(way).min(folders + 1);
        (self.highest_level_named).fetch_max(highest, Ordering::Relaxed);
    }

    pub(crate) fn find_file_named_as_in_executable(
        &self,
        file: &[u8],
        name: &[u8],
    ) -> Option<Vec<u8>> {
        let paths = &self.input.options.paths;
        let levels = self.levels_above_root_seen_from(file);
        let way = find_way_named_as_in_executable(paths, levels, name)?;
        if self.levels_of_text(file).is_some() {
            self.note_way_named(&way);
        }
        find_file_on_way(paths, way)
    }

    fn find_code_file_named_as_in_executable(&self, request: &CodeRequest<'_>) -> Option<Vec<u8>> {
        let on_disk = self.find_file_named_as_in_executable(request.importer, request.specifier)?;
        let path = from_native(&on_disk);
        let search = FileSearch {
            directory: request.directory,
            specifier: &on_disk,
            kind: request.kind,
            prefers_module_field: self.input.options.code.prefers_module_field,
        };
        match self.find_code_file(&search) {
            FoundCode::File {
                path,
                links_followed: true,
                ..
            } => Some(path),
            FoundCode::File { path, .. } => Some(self.disk.realpath(&path)),
            FoundCode::External(_) | FoundCode::NotFound(_) => self.find_entry_point_by_file(&path),
        }
    }

    fn find_path_at_run_time(
        &self,
        path: &[u8],
        levels_above_root: Option<usize>,
    ) -> Result<Vec<u8>, Range<usize>> {
        if is_host_path(path) {
            return Err(0..0);
        }
        let options = self.input.options;
        let is_written_as = |entry_point: &Vec<u8>| {
            let written = std::slice::from_ref(entry_point);
            let paths = collect_entry_point_paths(self.disk, options, written);
            self.is_among(&paths, path)
        };
        let index = match self.is_among(&self.entry_point_paths, path) {
            true => options.entry_points.iter().position(is_written_as),
            false => None,
        };
        let paths = &options.paths;
        let below_root = match index {
            Some(index) => Some(paths.entry_point_names[index].clone()),
            None => compute_relative_path(&paths.root_directory, to_native(path)),
        };

        let runs_in_place = options.aot.runs_in_place;
        let levels = match below_root.map_or(0, |it| count_levels_above(&it)) {
            level @ 1.. if !runs_in_place => {
                levels_above_root.ok_or_else(|| level..count_folders(&paths.root_directory) + 3)?
            }
            _ => 0,
        };
        Ok(compute_program_path(
            runs_in_place,
            paths,
            levels,
            to_native(path),
            index,
        ))
    }

    fn find_entry_point_by_file(&self, path: &[u8]) -> Option<Vec<u8>> {
        let find = |file: &[u8]| {
            let by_file = &self.entry_points_by_file;
            let index = by_file.binary_search_by(|it| it.0.as_slice().cmp(file));
            Some(by_file[index.ok()?].1.clone())
        };
        find(path).or_else(|| {
            let extension = bun_paths::extension(path);
            let is_of_source = extension.is_empty()
                || (EXTENSIONS_OF_ENTRY_POINT_SOURCES.iter())
                    .any(|source| extension[1..].eq_ignore_ascii_case(source));
            let stem = &path[..path.len() - extension.len()];
            is_of_source.then(|| find(&[stem, b".js"].concat()))?
        })
    }

    fn runs_despite_its_name(&self, path: &[u8]) -> bool {
        is_declaration_file_name(path)
            && self.is_among(&self.entry_points_that_run_despite_their_names, path)
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
        let loaders = &self.input.options.load.loaders;
        if !self.is_entry_point(path) {
            let carries = is_linked_by_bundler && !self.input.options.aot.runs_in_place;
            let kind = match kind {
                CodeImportKind::Require if carries => CodeImportKind::Import,
                _ => kind,
            };
            let runs_in_place = self.input.options.aot.runs_in_place;
            return match loader_by_path(loaders, path, kind) {
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
        if self
            .modules_with_queries
            .text_in_place_of_file(path)
            .is_some()
        {
            return None;
        }
        let module = (self.plugins).loaded(self.modules_with_queries.file_behind(path))?;
        module.is_from_plugin.then_some(module.loader)
    }

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

    fn refuse(&self, feature: &[u8]) {
        let messages = self.input.messages;
        messages.with_log(|log| log_diagnostic(log, Code::UnsupportedOption, &[feature]));
    }

    fn refuse_file(&self, what: &[u8], path: &[u8]) {
        let shown = self.plugins.provider_path(path);
        self.refuse(&[what, b": \"", shown, b"\""].concat());
    }

    fn refuse_plugin_answer_for_asset(&self, path: &[u8], loader: Option<Loader>) {
        let Some(loader) = loader else {
            let what = b"a plugin that still defers a file after every other module has loaded";
            return self.refuse_file(what, path);
        };
        let shown = self.plugins.provider_path(path);
        let (loader, extension) = (loader_name(loader).as_bytes(), PathName::init(shown).ext);
        let mut feature = [
            b"a plugin that loads \"",
            shown,
            b"\" with the loader \"",
            loader,
            b"\" when the build treats the file as an asset",
        ]
        .concat();
        if !extension.is_empty() {
            feature.extend_from_slice(&[b". Pass --loader ", extension, b":", loader].concat());
        }
        self.refuse(&feature);
    }

    fn record_unreadable_asset(&self, path: &[u8]) {
        self.record_unreadable(path);
        if self.reads_in_background_after_load {
            let shown = BStr::new(self.plugins.provider_path(path));
            self.input.messages.with_log(|log| {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("Cannot read file \"{shown}\""),
                );
            });
        }
    }

    fn embed_asset(&self, path: &[u8], text: ModuleText) {
        let contents = match text {
            ModuleText::Text(contents) => contents,
            ModuleText::Failed => return,
            ModuleText::Missing => return self.record_unreadable_asset(path),
            ModuleText::Deferred => return self.refuse_plugin_answer_for_asset(path, None),
        };
        let plugin_loader = self.plugin_loader(path);
        if let Some(loader) = plugin_loader.filter(|&loader| loader != Loader::File) {
            return self.refuse_plugin_answer_for_asset(path, Some(loader));
        }
        let source = SourceFile {
            path: self.plugins.provider_path(path),
            contents: &contents,
            loader: Loader::File,
        };
        let (provider, messages) = (self.input.provider, self.input.messages);
        let _ = messages.with_log(|log| provider.set_embedded_contents(&source, log));
    }

    pub(crate) fn finish_background_reads(&self) {
        let paths = std::mem::take(&mut *self.background_reads.lock());
        let read = |path: &[u8]| self.plugins.read(path, self.default_loader(path));
        let mut deferred = Vec::new();
        for path in &paths {
            match read(path) {
                ModuleText::Deferred => deferred.push(path),
                text => self.embed_asset(path, text),
            }
        }
        if !deferred.is_empty() {
            let DeferredReads { missing, .. } = self.plugins.finish_deferred_reads();
            for path in &missing {
                self.record_unreadable_asset(path);
            }
            for path in deferred {
                self.embed_asset(path, read(path));
            }
        }
        let (provider, messages) = (self.input.provider, self.input.messages);
        let _ = messages.with_log(|log| provider.check_embedded_files(log));
    }

    fn record_unreadable(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.unreadable.lock().push(path.to_vec());
        Cow::default()
    }

    fn file_with_query(&self, path: &[u8]) -> Option<FileWithQuery> {
        (self.modules_with_queries.find(path)).map(|it| FileWithQuery {
            file: it.file.as_slice().into(),
            query: it.query.as_slice().into(),
        })
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

pub(crate) fn log_steps_of_load(project: &'static str) -> Option<Box<dyn FnMut(&str)>> {
    let mut steps = StepClock::new(Stage::Load);
    if !steps.logs() {
        return None;
    }
    Some(Box::new(move |step: &str| {
        steps.end(&format!("{project}{step}"));
    }))
}

impl Host for LoadHost<'_> {
    delegate_host_services_to_disk!(disk);

    fn log_steps_of_load(&self) -> Option<Box<dyn FnMut(&str) + '_>> {
        log_steps_of_load("")
    }

    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        if let Some(text) = self.modules_with_queries.text_in_place_of_file(path) {
            return Some(Cow::Owned(text.to_vec()));
        }
        let path = self.modules_with_queries.file_behind(path);
        match self.served_by(path) {
            ServedBy::PluginModule => match self.plugins.read(path, self.default_loader(path)) {
                ModuleText::Text(text) => Some(text),
                ModuleText::Deferred | ModuleText::Missing | ModuleText::Failed => None,
            },
            ServedBy::Declarations(text) => Some(Cow::Borrowed(text)),
            ServedBy::RuntimeTypes => runtime_types::read(path).map(Cow::Owned),
            ServedBy::Disk => self.disk.read(path),
        }
    }

    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        if let Some(text) = self.modules_with_queries.text_in_place_of_file(path) {
            return Cow::Owned(text.to_vec());
        }
        let path = self.modules_with_queries.file_behind(path);
        let is_on_disk = matches!(self.served_by(path), ServedBy::Disk);
        if is_on_disk && !self.plugins.was_read(path) && !self.is_background_read(path) {
            return self.disk.read_source(path);
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
        if self
            .modules_with_queries
            .text_in_place_of_file(path)
            .is_some()
        {
            return Some(FileStamp::IMMUTABLE);
        }
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
            let path = self.modules_with_queries.file_behind(path);
            let is_outfile =
                (self.outfile.as_deref()).is_some_and(|it| self.is_same_path(it, path));
            return !is_outfile && self.disk.is_file(path);
        }
        match self.served_by(path) {
            ServedBy::PluginModule | ServedBy::Declarations(_) | ServedBy::RuntimeTypes => true,
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
        if is_host_path(path) {
            return runtime_types::entries(path);
        }
        let (mut files, directories) = self.disk.entries(path);
        let folder = path.strip_suffix(b"/").unwrap_or(path);
        for product in self.outfile.iter().chain(&self.other_products) {
            if self.is_same_path(dirname::<Posix>(product), folder) {
                let name_of_product = &product[folder.len() + 1..];
                files.retain(|name| !self.is_same_path(name, name_of_product));
            }
        }
        (files, directories)
    }

    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        match self.served_by(path) {
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => {
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
    pub(crate) fn has_file_that_asks_for_what_unseen_code_finds(&self) -> bool {
        self.has_file_that_asks_for_what_unseen_code_finds
            .load(Ordering::Relaxed)
    }

    fn import_names_or_compile_components<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        let load = &self.input.options.load;
        if load.runs_tests {
            let is_entry_point = self.is_entry_point(request.path);
            let file_of_run = test_runner_names::FileOfTestRun {
                has_globals_of_vitest: load.has_globals_of_vitest,
                is_entry_point,
                may_load_below_vitest: load.entry_point_imports_vitest && !is_entry_point,
                may_load_in_worker: true,
            };
            if source.kind == SourceKind::Program
                && test_runner_names::import_used_names(arena, atoms, request, file_of_run)
                    == TreeChange::Changed
            {
                return TreeChange::Changed;
            }
            if is_entry_point {
                return TreeChange::Unchanged;
            }
        }
        self.compile_components_and_expand_globs(arena, atoms, &mut ask_by_syntax(request), source)
    }

    fn expand_globs<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut EarlyTransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        let (provider, messages) = (self.input.provider, self.input.messages);
        let runs_tests = self.input.options.load.runs_tests;
        let modules = &self.modules_with_queries;
        let file = modules.file_behind(request.path).to_vec();
        let change = import_meta_glob::expand_calls(
            provider,
            messages,
            runs_tests,
            arena,
            atoms,
            request,
            source,
            &|specifier, text| modules.add_text(&file, specifier, text),
        );
        source.depends_on_more_than_source |= change != TreeChange::Unchanged;
        change
    }

    fn compile_components_and_expand_globs<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut EarlyTransformRequest<'_, 's>,
        source: &mut ParsedSource,
    ) -> TreeChange {
        let compiled = (self.react_compiler).transform(arena, atoms, request, source);
        match self.expand_globs(arena, atoms, request, source) {
            TreeChange::Unchanged => compiled,
            expanded => expanded,
        }
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
        let modules = &self.modules_with_queries;
        if request.form == CodeImportForm::WrittenByHost
            && let Some(path) =
                modules.find_text(modules.file_behind(request.importer), request.specifier)
        {
            return HostResolution::Path(path);
        }
        if is_import
            && let Some(name) = request.specifier.strip_prefix(FOLDER_OF_DATABASE)
            && let Some(path) = self.plugins.add_folder_of_database(request.importer, name)
        {
            return HostResolution::Path(path);
        }
        let mut entry_texts = self.input.options.load.entry_texts.iter();
        if !is_import && let Some(text) = entry_texts.find(|it| it.name == request.specifier) {
            return HostResolution::Path(self.plugins.add_entry_text(text, None));
        }
        if is_import && let Some(resolution) = self.runtime_resolution(request.specifier) {
            if builtin_uses::is_module_with_source(&resolution) {
                self.has_file_that_asks_for_what_unseen_code_finds
                    .store(true, Ordering::Relaxed);
            }
            return resolution;
        }
        let resolution = match request.form {
            CodeImportForm::Macro => PluginResolution::NotHandled,
            CodeImportForm::Static
            | CodeImportForm::Dynamic
            | CodeImportForm::ResolveOnly
            | CodeImportForm::WrittenByHost => self.plugins.resolve(request),
        };
        match resolution {
            PluginResolution::Path(path) => return HostResolution::Path(path),
            PluginResolution::External { specifier } => {
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
        let options = self.input.options;
        if is_import
            && !options.aot.runs_in_place
            && let Some(path) = self.find_code_file_named_as_in_executable(request)
        {
            return HostResolution::Path(path);
        }
        let load = &options.load;
        let directory = to_native(request.directory);
        let is_left_to_run_time = is_import
            && ((load.runs_tests && contains_char(request.specifier, b'?'))
                || is_external(&load.externals, request.specifier, directory));
        match is_left_to_run_time {
            true => HostResolution::External {
                specifier: request.specifier.to_vec(),
                kind: ExternalKind::UncompiledCode,
            },
            false => HostResolution::Unclaimed,
        }
    }

    fn find_code_file(&self, search: &FileSearch<'_>) -> FoundCode {
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
        if !matches!(found, FoundCode::NotFound(_)) {
            return found;
        }
        let is_path_of_file = search.kind != CodeImportKind::EntryPoint
            && matches!(search.specifier, [b'.', b'/', ..] | [b'.', b'.', b'/', ..])
            && !search.specifier.ends_with(b"/");
        if is_path_of_file
            && let path = join(search.directory, search.specifier)
            && let Some(path) = self.find_entry_point_by_file(&path)
        {
            return FoundCode::File {
                path,
                required: None,
                links_followed: false,
                has_side_effects: false,
            };
        }
        if !options.load.runs_tests || search.specifier != b"chai" {
            return found;
        }
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

    fn is_name_for_transpiler_alone(&self, specifier: &[u8]) -> bool {
        Alias::bun_prefixed_builtin(specifier).is_some()
    }

    fn is_code(&self, path: &[u8]) -> bool {
        if let Some(&is_code) = self.files_asked_whether_code.lock().get(path) {
            return is_code;
        }
        let text = self.read(path);
        let loader = self.default_loader(path);
        let is_code = text.is_some_and(|text| parses_as_program(path, &text, loader));
        let mut asked = self.files_asked_whether_code.lock();
        asked.insert(path.to_vec(), is_code);
        is_code
    }

    fn leaves_to_run_time(&self, path: &[u8]) -> bool {
        let aot = &self.input.options.aot;
        aot.runs_tests && !aot.checks_only && self.default_loader(path) == Loader::Html
    }

    fn names_file_with_side_effects(&self, directory: &[u8], entry: &[u8], path: &[u8]) -> bool {
        crate::modules::names_file_with_side_effects(directory, entry, path)
    }

    fn leaves_packages_outside(&self) -> bool {
        !self.input.options.load.externals.is_empty() || self.input.provider.has_resolve_plugins()
    }

    fn is_data_file(
        &self,
        path: &[u8],
        kind: CodeImportKind,
        type_attribute: Option<&[u8]>,
    ) -> bool {
        let loader = self.plugin_loader(path);
        let loader = loader.unwrap_or_else(|| self.default_loader_for(path, kind, true));
        !is_host_path(path)
            && !self.is_read_by_plugin(path)
            && gives_data(loader)
            && !(type_attribute.and_then(Loader::from_string))
                .is_some_and(|written| is_taken_by_written_type(loader, written))
    }

    fn stands_for_text_that_cannot_be_read(&self, payload: &HostPayload) -> bool {
        let source = payload.downcast_ref::<ParsedSource>();
        source.is_some_and(|it| it.parse_failure.is_some())
    }

    fn note_guesses_left_out(&self, file_whose_loader_decides_its_kind: Option<&[u8]>) {
        let file = file_whose_loader_decides_its_kind.map(<[u8]>::to_vec);
        self.guesses_left_out.lock().get_or_insert(file);
    }

    fn note_file_left_out(
        &self,
        request: &ComputedCodeRequest<'_>,
        path: &[u8],
        needs_extension: bool,
    ) {
        self.files_left_out_by_patterns
            .lock()
            .insert(FileLeftOutByPattern {
                folder_of_text: request.site.folder.to_vec(),
                start: request.prefix.to_vec(),
                end: request.suffix.to_vec(),
                begins_with_dot: bun_paths::basename(path).starts_with(b"."),
                needs_extension,
                path: path.to_vec(),
            });
    }

    fn create_file_of_database(&self, specifier: &[u8]) -> Option<Vec<u8>> {
        (!self.input.options.aot.runs_in_place).then(|| self.plugins.add_database(specifier))
    }

    fn kind_of_file_missing_at_build(&self) -> Option<ExternalKind> {
        Some(match self.input.options.aot.loads_code_from_disk {
            true => ExternalKind::UncompiledCode,
            false => ExternalKind::HostValue,
        })
    }

    fn holds_modules_with_queries(&self) -> bool {
        !self.input.options.load.runs_tests
    }

    fn has_loader_at_run_time(&self) -> bool {
        self.input.options.load.runs_tests
    }

    fn types_asked_where_options_are_unread(&self, path: &[u8]) -> &'static [&'static [u8]] {
        const ALL: &[&[u8]] = &[
            b"json", b"jsonc", b"json5", b"toml", b"yaml", b"xml", b"text",
        ];
        let options = &self.input.options.aot;
        let hides_source = !options.embeds_function_source || options.hides_names();
        let is_code = script_kind_of(self.default_loader(path)).is_some();
        if hides_source && is_code { &[] } else { ALL }
    }

    fn add_module_with_query(
        &self,
        path: &[u8],
        query: &[u8],
        kind: CodeImportKind,
    ) -> Option<Vec<u8>> {
        let is_program =
            kind != CodeImportKind::Require && script_kind_of(self.default_loader(path)).is_some();
        let is_file_of_program = matches!(self.served_by(path), ServedBy::Disk)
            && !is_bundled(path)
            && !is_declaration_file_name(path);
        let is_module = find_worker_constructor(query).is_some() || !has_vite_suffix(query);
        (is_program && is_file_of_program && is_module)
            .then(|| self.modules_with_queries.add(path, query))
    }

    fn file_of_module<'p>(&'p self, path: &'p [u8]) -> &'p [u8] {
        self.modules_with_queries.file_behind(path)
    }

    fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        LoadHost::directory_of(self, path)
    }

    fn is_given_in_memory(&self, path: &[u8]) -> bool {
        let load = &self.input.options.load;
        let native = to_native(path);
        !load.in_memory_file_keys.is_empty()
            && (load.in_memory_files)
                .binary_search_by(|(file, _)| file[..].cmp(native))
                .is_ok()
    }

    fn directory_of_dynamic_imports<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        match self.plugins.name_of_entry_text(path) {
            Some(name) if is_url_with_text(name) => {
                Cow::Owned(dirname::<Posix>(&[b"/", name].concat()).to_vec())
            }
            Some(_) | None => LoadHost::directory_of(self, path),
        }
    }

    fn find_runtime_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostResolution> {
        if prefix.is_empty() && suffix.is_empty() {
            return Vec::new();
        }
        let modules = self.input.runtime_modules.find_modules(prefix, suffix);
        modules.into_iter().map(HostResolution::Module).collect()
    }

    fn compiler_declarations(&self) -> Vec<Vec<u8>> {
        vec![compiler_declarations::PATH.to_vec()]
    }

    fn declarations_beside_bun_types(&self, are_installed: bool) -> Vec<Vec<u8>> {
        if !self.input.options.load.runs_tests {
            return Vec::new();
        }
        let mut files = vec![runtime_types::OTHER_NAMES_OF_TEST_RUNNER_PATH.to_vec()];
        if !are_installed {
            files.push(runtime_types::GLOBALS_OF_TEST_RUNNER.to_vec());
        }
        files
    }

    fn declarations_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        Some(runtime_types::GLOBALS_THAT_NOTHING_DECLARES_PATH.to_vec())
    }

    fn type_root_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        Some(runtime_types::TYPE_ROOT.to_vec())
    }

    fn loader_of(&self, request: &LoaderRequest<'_>) -> HostLoader {
        let path = request.path;
        match self.served_by(path) {
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => {
                return BY_NAME;
            }
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        let without_attribute = || {
            let is_linked_by_bundler = request.is_linked_by_bundler;
            let loader = self.default_loader_for(path, request.kind, is_linked_by_bundler);
            let by_name = to_host_loader(loader, path);
            let fails_where_loaded = !is_linked_by_bundler
                && by_name == BY_NAME
                && !self.input.options.aot.runs_in_place
                && matches!(self.served_by(path), ServedBy::Disk)
                && loader_named_by_path(&self.input.options.load.loaders, path).is_none()
                && !self.is_read_by_plugin(path)
                && !self.is_code(path);
            match fails_where_loaded {
                true => to_host_loader_of_attribute(loader),
                false => by_name,
            }
        };
        let is_embedded = matches!(request.embed_attribute, Some(b"true"));
        let chosen = match request.type_attribute {
            None => return without_attribute(),
            Some(b"macro") => {
                let messages = self.input.messages;
                messages.with_log(|log| log_diagnostic(log, Code::MacrosDisabled, &[]));
                return without_attribute();
            }
            Some(name) => match Loader::from_string(name) {
                Some(Loader::Sqlite) if is_embedded => Loader::SqliteEmbedded,
                Some(loader) => loader,
                None => return without_attribute(),
            },
        };
        to_host_loader_of_attribute(chosen)
    }

    fn loads_as_code(&self, path: &[u8], loader: HostLoader) -> bool {
        script_kind_of(self.requested_loader(loader, path)).is_some()
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        if let Some(text) = self.modules_with_queries.text_in_place_of_file(path) {
            return CodeRead::Text(Cow::Owned(text.to_vec()));
        }
        let path = self.modules_with_queries.file_behind(path);
        let served_by = self.served_by(path);
        match served_by {
            ServedBy::Declarations(text) => return CodeRead::Text(Cow::Borrowed(text)),
            ServedBy::RuntimeTypes => {
                let text = runtime_types::read(path).map(Cow::Owned);
                return CodeRead::Text(text.unwrap_or_else(|| self.record_unreadable(path)));
            }
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        if !self.should_ask_plugins(served_by, path) {
            return CodeRead::Text(self.disk.read_source(path));
        }
        match self.plugins.read(path, self.default_loader(path)) {
            ModuleText::Text(text) => CodeRead::Text(text),
            ModuleText::Deferred => CodeRead::Deferred,
            ModuleText::Missing => CodeRead::Text(self.record_unreadable(path)),
            ModuleText::Failed => CodeRead::Text(Cow::default()),
        }
    }

    fn is_read_by_plugin(&self, path: &[u8]) -> bool {
        if self
            .modules_with_queries
            .text_in_place_of_file(path)
            .is_some()
        {
            return false;
        }
        let path = self.modules_with_queries.file_behind(path);
        self.should_ask_plugins(self.served_by(path), path) && self.plugins.has_load_plugin(path)
    }

    fn finish_deferred_reads(&self) -> Vec<(Vec<u8>, Cow<'static, [u8]>)> {
        let DeferredReads {
            texts,
            missing,
            still_deferred,
        } = self.plugins.finish_deferred_reads();
        self.unreadable.lock().extend(missing);
        for path in &still_deferred {
            self.refuse_plugin_answer_for_asset(path, None);
        }
        texts
    }

    fn can_read_in_background(&self, path: &[u8], loader: HostLoader) -> bool {
        self.requested_loader(loader, path) == Loader::File
            && self.input.provider.asset_paths_ignore_contents()
    }

    fn start_background_reads(&self, paths: &[&[u8]]) -> bool {
        let mut reads = self.background_reads.lock();
        reads.extend(paths.iter().map(|path| path.to_vec()));
        reads.shared_sort_unstable();
        reads.dedup();
        true
    }

    fn reads_in_background_after_load(&self) -> bool {
        self.reads_in_background_after_load
    }

    fn read_in_background(&self, path: &[u8]) {
        self.plugins.read(path, self.default_loader(path));
    }

    fn is_plugin_source(&self, path: &[u8]) -> bool {
        self.plugin_loader(path).is_some()
    }

    fn object_prototype_takes_names(&self) -> bool {
        self.input.options.load.runs_tests
    }

    fn may_any_file_become_main_module(&self) -> bool {
        self.may_store_path_of_main_module.load(Ordering::Relaxed)
    }

    fn loader_of_code_in_place_of_typed_file(&self, path: &[u8]) -> Option<HostLoader> {
        let loader = to_host_loader(self.loader_in_place_of_typed_file(path)?, path);
        (loader != BY_NAME).then_some(loader)
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        let path = request.path;
        let load = &self.input.options.load;
        let served_by = self.served_by(path);
        let requested_loader = self.requested_loader(request.loader, path);
        let is_background_read = requested_loader == Loader::File && self.is_background_read(path);
        let plugin_loader = match is_background_read {
            true => None,
            false => self.plugin_loader(path),
        };
        let loader = match served_by {
            ServedBy::Declarations(_) | ServedBy::RuntimeTypes => Loader::Ts,
            ServedBy::PluginModule | ServedBy::Disk => plugin_loader.unwrap_or(requested_loader),
        };
        let is_from_plugin = plugin_loader.is_some();
        let plugin_module = self.plugins.virtual_module(path);
        let plugin_module = plugin_module.map(|(namespace, path)| PluginModuleName {
            namespace: namespace.into(),
            path: path.into(),
        });
        let is_named_as_code =
            !is_from_plugin && script_kind_of(self.default_loader(path)).is_some();
        let parse_data = |loader: Loader, plugin_module: Option<PluginModuleName>| {
            let source = SourceFile {
                path: self.plugins.provider_path(path),
                contents: text,
                loader,
            };
            let said_of_text = LoadMessages::default();
            let (provider, messages) = (self.input.provider, &said_of_text);
            let is_given_to_no_parser = !load.runs_tests
                && !self.input.options.aot.runs_in_place
                && !is_from_plugin
                && matches!(
                    loader,
                    Loader::Json
                        | Loader::Jsonc
                        | Loader::Json5
                        | Loader::Toml
                        | Loader::Yaml
                        | Loader::Md
                )
                && is_all_whitespace(text);
            let parsed = match is_given_to_no_parser {
                true => create_module_without_text(
                    request.package_module_type == DeclaredModuleType::Esm,
                    arena,
                    atoms,
                ),
                false => parse_data_module(provider, messages, &source, arena, atoms),
            };
            let is_refused_under_type =
                parsed.failure.is_some() && !is_from_plugin && loader != self.default_loader(path);
            if !is_refused_under_type && (!is_named_as_code || parsed.failure.is_none()) {
                said_of_text.hand_on_to(self.input.messages);
            }
            ParsedCode {
                hir: parsed.hir,
                host_values: parsed.host_values,
                payload: Some(Box::new(ParsedSource {
                    plugin_module,
                    file_with_query: self.file_with_query(path),
                    web_assembly: parsed.web_assembly,
                    said_where_type_is_written: (is_refused_under_type && !is_named_as_code)
                        .then_some(said_of_text),
                    parse_failure: parsed.failure,
                    refused_at: parsed.failed_at.map(|place| (loader, place)),
                    byte_count: text.len(),
                    ..ParsedSource::new(SourceKind::Data, loader)
                })),
            }
        };
        let Some(script_kind) = script_kind_of(loader) else {
            if loader == Loader::Html && !load.runs_tests && self.input.options.aot.runs_in_place {
                let what = b"an import of an HTML page in a program that runs in place";
                self.refuse_file(what, path);
            }
            let is_refused_by_json_parse =
                load.runs_tests && loader == Loader::Json && !is_taken_by_json_parse(text);
            if !is_refused_by_json_parse {
                let mut parsed = parse_data(loader, plugin_module);
                let source = parsed_source_mut(&mut parsed.payload);
                let is_read_by_nobody_later =
                    !load.runs_tests && !self.input.options.aot.runs_in_place && !is_from_plugin;
                if let Some(failure) = source.parse_failure.take() {
                    let options = CompileParseOptions {
                        path,
                        script_kind: Some(ScriptKind::Js),
                        experimental_decorators: false,
                        every_file_is_a_module: false,
                        reads_jsdoc: false,
                        ignores_pure_comments: false,
                    };
                    return ParsedCode {
                        hir: parse_for_compile(arena, &options, EMPTY_MODULE, atoms),
                        host_values: &[],
                        payload: Some(Box::new(ParsedSource {
                            plugin_module: source.plugin_module.take(),
                            parse_failure: Some(failure),
                            refused_at: (source.refused_at.take())
                                .filter(|_| is_read_by_nobody_later),
                            said_where_type_is_written: source.said_where_type_is_written.take(),
                            byte_count: text.len(),
                            ..ParsedSource::new(SourceKind::Program, Loader::Js)
                        })),
                    };
                }
                if loader == Loader::Html
                    && load.runs_tests
                    && self.default_loader(path) != Loader::Html
                {
                    let failure = Some(PAGE_NOT_NAMED_AS_ONE.to_vec());
                    parsed_source_mut(&mut parsed.payload).parse_failure = failure;
                }
                return parsed;
            }
            let failure = match text.iter().all(u8::is_ascii_whitespace) {
                true => JSON_PARSE_ERROR_FOR_BLANK_TEXT,
                false => JSON_PARSE_ERROR,
            };
            let empty_module_options = CompileParseOptions {
                path,
                script_kind: Some(ScriptKind::Js),
                experimental_decorators: false,
                every_file_is_a_module: false,
                reads_jsdoc: false,
                ignores_pure_comments: false,
            };
            return ParsedCode {
                hir: parse_for_compile(arena, &empty_module_options, EMPTY_MODULE, atoms),
                host_values: &[],
                payload: Some(Box::new(ParsedSource {
                    plugin_module,
                    parse_failure: Some(failure.to_vec()),
                    byte_count: text.len(),
                    ..ParsedSource::new(SourceKind::Program, Loader::Js)
                })),
            };
        };
        let compile_options = CompileParseOptions {
            path,
            script_kind: Some(script_kind)
                .filter(|kind| kind.differs_from_name(path) || self.runs_despite_its_name(path)),
            experimental_decorators: request.options.experimental_decorators
                && !script_kind.is_javascript(),
            every_file_is_a_module: request.options.module_detection == ModuleDetection::Force,
            reads_jsdoc: request.reads_jsdoc,
            ignores_pure_comments: self.input.options.removable.ignores_pure_annotations
                || hir::find_transpiled_mark(text).is_some(),
        };
        let is_bundled_commonjs = is_bundled_commonjs(text);
        let body_of_bundle = match is_bundled_commonjs {
            true => blank_commonjs_wrapper(text),
            false => None,
        };
        let parsed_text = body_of_bundle.as_deref().unwrap_or(text);
        let mut hir = parse_for_compile(arena, &compile_options, parsed_text, atoms);
        let is_entry_text = self.plugins.loader_of_entry_text(path).is_some();
        let is_language_assumed = is_entry_text
            || (matches!(served_by, ServedBy::Disk)
                && !is_from_plugin
                && loader_named_by_path(&load.loaders, path).is_none());
        let is_entry_point = is_entry_text || self.is_entry_point(path);
        let fails_where_loaded =
            load.runs_tests && matches!(served_by, ServedBy::Disk) && !is_from_plugin;
        let parse_failure = match fails_where_loaded || (is_language_assumed && !is_entry_point) {
            true => describe_parse_failure(&hir, text),
            false => None,
        };
        if parse_failure.is_some()
            && !self.input.options.aot.runs_in_place
            && request.loader == BY_NAME
        {
            return parse_data(Loader::File, plugin_module);
        }
        if parse_failure.is_some() {
            hir = parse_for_compile(arena, &compile_options, EMPTY_MODULE, atoms);
        } else if is_bundled_commonjs && body_of_bundle.is_none() {
            let what = b"a file that begins with \"// @bun @bun-cjs\" and does not go on with the function that bun build --format=cjs --target=bun writes";
            self.refuse_file(what, path);
        }
        let is_only_read_as_typescript = is_language_assumed
            && !script_kind.is_javascript()
            && parse_failure.is_none()
            && hir.check_directive.is_none()
            && is_javascript_too(&compile_options, parsed_text);
        if is_only_read_as_typescript || self.runs_despite_its_name(path) {
            hir.check_directive = Some(false);
        }
        ParsedCode {
            hir,
            host_values: &[],
            payload: Some(Box::new(ParsedSource {
                plugin_module,
                file_with_query: self.file_with_query(path),
                parse_failure,
                is_language_assumed,
                byte_count: text.len(),
                ..ParsedSource::new(SourceKind::Program, loader)
            })),
        }
    }

    fn run_macros<'s>(
        &self,
        arena: &'s Arena,
        _atoms: &Interner<'s>,
        request: &MacroRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> &'s [(ExprId, HostValue<'s>)] {
        let mut calls = request.analysis.pending_macro_calls.to_vec();
        calls.shared_sort_unstable();
        calls.dedup();
        let diagnostics = &mut parsed_source_mut(payload).diagnostics;
        let undefined = HostValue::Data(arena.alloc(DataValue::Undefined));
        let mut values = Vec::with_capacity(calls.len());
        for call in calls {
            let range = range_of_node(request.hir, NodeData::Expr(call));
            diagnostics.push(FileDiagnostic::new(Code::MacrosDisabled, range, &[]));
            values.push((call, undefined));
        }
        arena.alloc_slice_copy(&values)
    }

    fn transform_tree_before_binding<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut EarlyTransformRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> bool {
        if self.input.options.load.runs_tests {
            return false;
        }
        let source = parsed_source_mut(payload);
        self.compile_components_and_expand_globs(arena, atoms, request, source);
        true
    }

    fn transform_tree<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> TreeChange {
        let source = parsed_source_mut(payload);
        if source.kind == SourceKind::Program
            && made_own_require::keep_own_require(request) == TreeChange::Changed
        {
            return TreeChange::ChangedAndUnfinished;
        }
        let runs_tests = self.input.options.load.runs_tests;
        if runs_tests && hir::find_transpiled_mark(&request.hir.text).is_some() {
            return TreeChange::Unchanged;
        }
        if runs_tests
            && self.expand_globs(arena, atoms, &mut ask_by_syntax(request), source)
                == TreeChange::Changed
        {
            return TreeChange::ChangedAndUnfinished;
        }
        self.import_names_or_compile_components(arena, atoms, request, source)
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let source = parsed_source_mut(payload);
        let load = &self.input.options.load;
        let needs_declarations = self.react_compiler.needs_declarations(source);
        let input = BuiltinUseInput {
            names: self.input.builtin_names,
            platform: self.input.platform,
            replaced: &load.replaced_builtins,
            runs_tests: load.runs_tests,
            holds_language: false,
            is_text_asked: !self.has_file_that_asks_for_what_unseen_code_finds(),
        };
        let mut answers =
            builtin_uses::finish_application_file(&input, needs_declarations, request, source);
        if builtin_uses::asks_for_what_unseen_code_finds(request, source) {
            self.has_file_that_asks_for_what_unseen_code_finds
                .store(true, Ordering::Relaxed);
        }
        if source.builtins.may_store_path_of_main_module() {
            self.may_store_path_of_main_module
                .store(true, Ordering::Relaxed);
        }
        let is_file = |path: &[u8]| self.is_file(path) || self.is_file(&from_native(path));
        let is_data = |path: &[u8]| parses_text_as_data(self.default_loader(path));
        let find_path_at_run_time =
            |levels_above_root| self.find_path_at_run_time(request.path, levels_above_root);
        let options = self.input.options;
        let sees_backslashes = match options.aot.runs_in_place {
            true => cfg!(windows),
            false => options.paths.module_prefix.starts_with(b"B:/"),
        };
        let write_url =
            |text: &[u8], base: Option<&[u8]>| self.input.provider.write_url(text, base);
        let scan = ScanInput {
            runtime_modules: self.input.runtime_modules,
            runs_tests: load.runs_tests,
            loads_code_from_disk: self.input.options.aot.loads_code_from_disk,
            is_file: &is_file,
            is_data: &is_data,
            find_path_at_run_time: &find_path_at_run_time,
            sees_backslashes: (!is_host_path(request.path)).then_some(sees_backslashes),
            write_url: &write_url,
        };
        source.contents = scan_file(request, &source.builtins, &scan);
        if scan.runs_tests {
            source.of_run = crate::test_runs::look_at_file_of_run(request, &source.builtins, &scan);
        }
        let modules = source.contents.names.modules.iter();
        let modules = modules.map(|it| HostModuleId(it.module.registry_id()));
        answers.extend(modules.map(HostResolution::Module));
        if load.runs_tests {
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
