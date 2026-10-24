use std::borrow::Cow;
use std::num::NonZeroUsize;
use std::sync::atomic::{AtomicBool, Ordering};

use bstr::BStr;
use bun_ast::Loader;
use bun_paths::path_buffer_pool;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Interner;
use bun_sema::hir::ExprId;
use bun_sema::hir_from_data::HostValue;
use bun_sema::program::{HostLoader, HostModuleId};
use bun_sema::resolve::{
    CodeHost, CodeImportForm, CodeImportKind, CodeParseRequest, CodeRead, CodeRequest,
    EnclosingPackage, ExternalKind, FileStamp, FinishedFile, Host, HostPayload, HostResolution,
    LoaderRequest, MacroRequest, ModuleDetection, ParsedCode, ScriptKind, TransformRequest,
    TreeChange, is_declaration_file_name, to_path, to_path_in,
};
use bun_sema::session::Arena;
use bun_sema::util::SharedSort;
use bun_sema_driver::Libs;
use bun_sema_driver::host::{AlreadyRead, Disk, from_argument, from_native, is_bundled, to_native};
use bun_sema_parser::{CompileParseOptions, appears_to_be_binary, parse_for_compile};
use bun_threading::Guarded;

use crate::builtins::{BuiltinNames, Platforms};
use crate::diagnostics::LoadMessages;
use crate::load::builtin_uses::{self, BuiltinUseInput};
use crate::load::bundled_commonjs::without_commonjs_wrapper;
use crate::load::compiler_declarations;
use crate::load::data_modules::parse_data_module;
use crate::load::disk_delegation::{
    delegate_host_services_to_disk, delegate_runtime_config_parsers_to_disk,
};
use crate::load::evaluated_texts::EvaluatedTexts;
use crate::load::externals::is_external;
use crate::load::is_host_path;
use crate::load::loaders::{
    BY_NAME, HostLoaderKind, TypeAttribute, classify_type_attribute, host_loader_kind,
    loader_by_name, loader_by_path, loader_named_by_path, script_kind_of, script_loader,
    to_host_loader,
};
use crate::load::macros::{self, MacroInput};
use crate::load::named_loads::find_library_modules_named_in_choices;
use crate::load::plugin_modules::{DeferredReads, ModuleText, PluginModules, PluginResolution};
use crate::load::react_compiler::{self, ReactCompiler};
use crate::load::runtime_declarations;
use crate::load::runtime_modules::{RuntimeModules, RuntimeResolution};
use crate::load::source_provider::{SourceFile, SourceProvider};
use crate::load::sources::{ParsedSource, PluginModuleName, SourceKind, parsed_source_mut};
use crate::load::test_runner_names;
use crate::load::typed_packages::{TypedPackagePlace, TypedPackages};
use crate::options::Options;

const BUNDLE_MODULE: &[u8] = b"bun:bundle";

pub(crate) fn create_disk(options: &Options<'_>, threads: NonZeroUsize) -> Disk {
    let load = &options.load;
    let already_read: AlreadyRead = (load.in_memory_files.iter())
        .map(|(path, contents)| (from_native(path), contents.clone()))
        .collect();
    let project_root = from_native(&load.project_root);
    match options.aot.thread_count {
        None => bun_sema_driver::fit_threads_to_sources(),
        Some(_) => bun_sema_driver::allow_all_threads(),
    }
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
    pub typed_packages: &'a TypedPackages<'a>,
    // The string that the build defines a dotted path as.
    pub defined: &'a (dyn Fn(&[u8]) -> Option<Vec<u8>> + Sync),
    pub platform: Platforms,
}

pub(crate) struct LoadHost<'a> {
    disk: &'a Disk,
    input: LoadHostInput<'a>,
    plugins: PluginModules<'a>,
    evaluated_texts: EvaluatedTexts,
    react_compiler: ReactCompiler<'a>,
    entry_point_paths: Vec<Vec<u8>>,
    /// Sorted. The entry points whose names say nothing about them and that aren't text.
    binary_entry_point_paths: Vec<Vec<u8>>,
    extra_extensions: Vec<(Vec<u8>, ScriptKind)>,
    unreadable: Guarded<Vec<Vec<u8>>>,
    /// Sorted.
    background_reads: Guarded<Vec<Vec<u8>>>,
    background_reads_disabled: AtomicBool,
    reads_in_background_after_load: bool,
    has_run_macros: AtomicBool,
}

#[derive(Copy, Clone)]
enum ServedBy {
    PluginModule,
    EvaluatedText,
    Declarations(&'static [u8]),
    TypedFile(ScriptKind),
    Disk,
}

impl<'a> LoadHost<'a> {
    pub(crate) fn new(input: LoadHostInput<'a>) -> LoadHost<'a> {
        let (disk, provider, messages) = (input.disk, input.provider, input.messages);
        let options = input.options;
        let load = &options.load;
        let entry_point_paths = collect_entry_point_paths(disk, options);
        LoadHost {
            disk,
            plugins: PluginModules::new(provider, disk, messages, &load.in_memory_files),
            evaluated_texts: EvaluatedTexts::new(),
            react_compiler: ReactCompiler::new(load.react_compiler, messages),
            binary_entry_point_paths: collect_binary_paths(disk, &load.loaders, &entry_point_paths),
            entry_point_paths,
            extra_extensions: collect_extra_extensions(&load.loaders),
            unreadable: Guarded::new(Vec::new()),
            background_reads: Guarded::new(Vec::new()),
            background_reads_disabled: AtomicBool::new(false),
            reads_in_background_after_load: false,
            has_run_macros: AtomicBool::new(false),
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
}

fn collect_entry_point_paths(disk: &Disk, options: &Options<'_>) -> Vec<Vec<u8>> {
    let is_case_sensitive = disk.is_case_sensitive();
    let mut paths = Vec::with_capacity(2 * options.entry_points.len());
    for entry_point in &options.entry_points {
        let path = from_argument(&options.code.working_directory, entry_point);
        paths.push(to_path(&disk.realpath(&path), is_case_sensitive).into_owned());
        paths.push(to_path(&path, is_case_sensitive).into_owned());
    }
    paths.shared_sort_unstable();
    paths.dedup();
    paths
}

fn collect_binary_paths(
    disk: &Disk,
    loaders: &[(Vec<u8>, Loader)],
    sorted_paths: &[Vec<u8>],
) -> Vec<Vec<u8>> {
    let is_binary = |path: &&Vec<u8>| {
        loader_named_by_path(loaders, path).is_none()
            && (disk.read(path)).is_some_and(|contents| appears_to_be_binary(&contents, true))
    };
    sorted_paths.iter().filter(is_binary).cloned().collect()
}

fn collect_extra_extensions(loaders: &[(Vec<u8>, Loader)]) -> Vec<(Vec<u8>, ScriptKind)> {
    let script_extensions = loaders.iter().filter_map(|(extension, loader)| {
        let kind = script_kind_of(*loader)?;
        let file_name = [b"x", extension.as_slice()].concat();
        let is_extra = ScriptKind::from_file_name(&file_name).is_none();
        is_extra.then(|| (extension.clone(), kind))
    });
    script_extensions.collect()
}

fn requested_loader(kind: HostLoaderKind, path: &[u8]) -> Loader {
    match kind {
        HostLoaderKind::ByName => loader_by_name(path),
        HostLoaderKind::Loader(loader) => loader,
    }
}

impl LoadHost<'_> {
    fn typed_version_in(
        &self,
        place: TypedPackagePlace,
        path: &[u8],
        package: Option<EnclosingPackage<'_>>,
    ) -> Option<Vec<u8>> {
        // A typed version whose sound.json does not fit what is installed is not used: the build says so and goes on.
        let packages = self.input.typed_packages;
        if packages
            .find_manifest_mismatch(package?, self.input.defined)
            .is_some()
        {
            return None;
        }
        packages.typed_version(place, path, package)
    }

    fn served_by(&self, path: &[u8]) -> ServedBy {
        if !is_host_path(path) {
            let script_kind = self.input.typed_packages.script_kind(path);
            return script_kind.map_or(ServedBy::Disk, ServedBy::TypedFile);
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
        match path == compiler_declarations::PATH {
            true => ServedBy::Declarations(compiler_declarations::TEXT),
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
            ServedBy::EvaluatedText | ServedBy::Declarations(_) | ServedBy::TypedFile(_) => false,
        }
    }

    fn is_entry_point(&self, path: &[u8]) -> bool {
        self.is_among(&self.entry_point_paths, path)
    }

    fn is_among(&self, sorted_paths: &[Vec<u8>], path: &[u8]) -> bool {
        let mut buffer = path_buffer_pool::get();
        let path = to_path_in(path, self.disk.is_case_sensitive(), &mut buffer[..]);
        sorted_paths
            .binary_search_by(|it| it.as_slice().cmp(&path))
            .is_ok()
    }

    fn default_loader(&self, path: &[u8]) -> Loader {
        self.default_loader_for(path, CodeImportKind::Import)
    }

    fn default_loader_for(&self, path: &[u8], kind: CodeImportKind) -> Loader {
        let loaders = &self.input.options.load.loaders;
        if !self.is_entry_point(path) {
            return loader_by_path(loaders, path, kind);
        }
        match self.is_among(&self.binary_entry_point_paths, path) {
            true => Loader::File,
            false => loader_by_path(loaders, path, CodeImportKind::EntryPoint),
        }
    }

    fn plugin_loader(&self, path: &[u8]) -> Option<Loader> {
        let module = self.plugins.loaded(path)?;
        module.is_from_plugin.then_some(module.loader)
    }

    fn plugin_module_name(&self, path: &[u8]) -> Option<PluginModuleName> {
        let (namespace, plugin_path) = self.plugins.virtual_module(path)?;
        Some(PluginModuleName {
            namespace: namespace.into(),
            path: plugin_path.into(),
        })
    }

    fn is_background_read(&self, path: &[u8]) -> bool {
        let paths = self.background_reads.lock();
        paths.binary_search_by(|it| it.as_slice().cmp(path)).is_ok()
    }

    /// Returns false if a plugin answered one of the background reads with something other than an asset.
    pub(crate) fn finish_background_reads(&self) -> bool {
        let paths = std::mem::take(&mut *self.background_reads.lock());
        let (provider, messages) = (self.input.provider, self.input.messages);
        let mut are_assets = true;
        for path in &paths {
            let contents = match self.plugins.read(path, self.default_loader(path)) {
                ModuleText::Text(contents) => contents,
                ModuleText::Failed => continue,
                ModuleText::Deferred | ModuleText::Missing => {
                    are_assets = false;
                    continue;
                }
            };
            if self
                .plugin_loader(path)
                .is_some_and(|loader| loader != Loader::File)
            {
                are_assets = false;
                continue;
            }
            let file = SourceFile {
                path: self.plugins.provider_path(path),
                contents: &contents,
                loader: Loader::File,
            };
            let _ = messages.with_log(|log| provider.set_embedded_contents(&file, log));
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

    fn classify_host_loader(&self, loader: HostLoader, path: &[u8]) -> HostLoaderKind {
        host_loader_kind(loader).unwrap_or_else(|| {
            let path = BStr::new(to_native(path));
            let message = format!("unknown host loader {} for {path}", loader.0);
            (self.input.messages).report_internal_error(message.into_bytes());
            HostLoaderKind::ByName
        })
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
        match self.served_by(path) {
            ServedBy::PluginModule => match self.plugins.read(path, self.default_loader(path)) {
                ModuleText::Text(text) => Some(text),
                ModuleText::Deferred | ModuleText::Missing | ModuleText::Failed => None,
            },
            ServedBy::EvaluatedText => self.evaluated_texts.read(path),
            ServedBy::Declarations(text) => Some(Cow::Borrowed(text)),
            ServedBy::TypedFile(_) | ServedBy::Disk => self.disk.read(path),
        }
    }

    // The files that run have been read by now, each through the plugins.
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        let is_on_disk = matches!(self.served_by(path), ServedBy::Disk);
        if is_on_disk && !self.plugins.was_read(path) && !self.is_background_read(path) {
            return without_commonjs_wrapper(self.disk.read_source(path));
        }
        match self.read_code(path) {
            CodeRead::Text(text) => text,
            CodeRead::Deferred => Cow::default(),
        }
    }

    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        let mut paths = std::mem::take(&mut *self.unreadable.lock());
        paths.extend(self.disk.take_unreadable());
        paths
    }

    fn file_stamp(&self, path: &[u8]) -> Option<FileStamp> {
        match self.served_by(path) {
            ServedBy::Declarations(_) => Some(FileStamp::IMMUTABLE),
            ServedBy::Disk if !self.plugins.was_read(path) && !self.is_background_read(path) => {
                self.disk.file_stamp(path)
            }
            _ => None,
        }
    }

    fn is_file(&self, path: &[u8]) -> bool {
        if !is_host_path(path) {
            return self.disk.is_file(path);
        }
        match self.served_by(path) {
            ServedBy::PluginModule | ServedBy::EvaluatedText | ServedBy::Declarations(_) => true,
            ServedBy::TypedFile(_) | ServedBy::Disk => false,
        }
    }

    fn is_dir(&self, path: &[u8]) -> bool {
        !is_host_path(path) && self.disk.is_dir(path)
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        match is_host_path(path) {
            true => path.to_vec(),
            false => self.disk.realpath(path),
        }
    }

    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let (mut names, directories) = self.entries(path);
        names.extend(directories);
        names
    }

    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        match is_host_path(path) {
            true => (Vec::new(), Vec::new()),
            false => self.disk.entries(path),
        }
    }

    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        match self.served_by(path) {
            ServedBy::TypedFile(kind) => return Some(kind),
            ServedBy::EvaluatedText | ServedBy::Declarations(_) => return None,
            ServedBy::PluginModule | ServedBy::Disk => {}
        }
        if is_bundled(path) || is_declaration_file_name(path) {
            return None;
        }
        let loader = match self.plugin_loader(path) {
            Some(loader) => loader,
            None => self.default_loader(path),
        };
        script_kind_of(loader).filter(|kind| kind.differs_from_name(path))
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &self.extra_extensions
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

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        let resolution = self.runtime_resolution(specifier);
        resolution.unwrap_or(HostResolution::Unclaimed)
    }

    fn directory_of<'p>(&self, path: &'p [u8]) -> Cow<'p, [u8]> {
        let working_directory = &self.input.options.code.working_directory;
        match self
            .plugins
            .directory_of_virtual_module(path, working_directory)
        {
            Some(directory) => Cow::Owned(directory),
            None => Cow::Borrowed(dirname::<Posix>(path)),
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

    fn typed_version(&self, path: &[u8], package: Option<EnclosingPackage<'_>>) -> Option<Vec<u8>> {
        self.typed_version_in(TypedPackagePlace::Project, path, package)
    }

    fn installed_typed_version(
        &self,
        path: &[u8],
        package: Option<EnclosingPackage<'_>>,
    ) -> Option<Vec<u8>> {
        self.typed_version_in(TypedPackagePlace::Installed, path, package)
    }

    fn typed_version_manifest(&self, typed_path: &[u8]) -> Option<Vec<u8>> {
        self.input.typed_packages.manifest_path(typed_path)
    }

    fn compiler_declarations(&self) -> Vec<Vec<u8>> {
        vec![compiler_declarations::PATH.to_vec()]
    }

    fn declarations_beside_bun_types(&self) -> Vec<Vec<u8>> {
        match self.input.options.load.runs_tests {
            true => vec![runtime_declarations::OTHER_NAMES_OF_TEST_RUNNER_PATH.to_vec()],
            false => Vec::new(),
        }
    }

    fn declarations_in_place_of_bun_types(&self) -> Option<Vec<u8>> {
        Some(runtime_declarations::PATH.to_vec())
    }

    fn loader_of(&self, request: &LoaderRequest<'_>) -> HostLoader {
        let path = request.path;
        match self.served_by(path) {
            ServedBy::EvaluatedText | ServedBy::Declarations(_) => return BY_NAME,
            ServedBy::PluginModule | ServedBy::TypedFile(_) | ServedBy::Disk => {}
        }
        let default_loader = self.default_loader_for(path, request.kind);
        let is_embedded = matches!(request.embed_attribute, Some(b"true"));
        let chosen = match classify_type_attribute(request.type_attribute) {
            TypeAttribute::Loader(Loader::Sqlite) if is_embedded => Loader::SqliteEmbedded,
            TypeAttribute::Loader(loader) => loader,
            TypeAttribute::Absent | TypeAttribute::Unknown => default_loader,
            TypeAttribute::Macro => {
                let message = [
                    &b"a macro import was followed as code: "[..],
                    to_native(path),
                ];
                (self.input.messages).report_internal_error(message.concat());
                default_loader
            }
        };
        to_host_loader(chosen, path)
    }

    fn read_code(&self, path: &[u8]) -> CodeRead {
        let served_by = self.served_by(path);
        match served_by {
            ServedBy::EvaluatedText => {
                let text = self.evaluated_texts.read(path);
                return CodeRead::Text(text.unwrap_or_else(|| self.record_unreadable(path)));
            }
            ServedBy::Declarations(text) => return CodeRead::Text(Cow::Borrowed(text)),
            ServedBy::PluginModule | ServedBy::TypedFile(_) | ServedBy::Disk => {}
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
        self.should_ask_plugins(self.served_by(path), path) && self.plugins.has_load_plugin(path)
    }

    fn finish_deferred_reads(&self) -> Vec<(Vec<u8>, Cow<'static, [u8]>)> {
        let DeferredReads { texts, missing } = self.plugins.finish_deferred_reads();
        self.unreadable.lock().extend(missing);
        texts
    }

    fn can_read_in_background(&self, path: &[u8], loader: HostLoader) -> bool {
        !self.background_reads_disabled.load(Ordering::Acquire)
            && requested_loader(self.classify_host_loader(loader, path), path) == Loader::File
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
        self.plugins.read(path, self.default_loader(path));
    }

    fn is_plugin_source(&self, path: &[u8]) -> bool {
        self.plugin_loader(path).is_some()
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
        let served_by = self.served_by(path);
        let kind = self.classify_host_loader(request.loader, path);
        let is_background_read =
            requested_loader(kind, path) == Loader::File && self.is_background_read(path);
        let plugin_loader = match is_background_read {
            true => None,
            false => self.plugin_loader(path),
        };
        let loader = match served_by {
            ServedBy::TypedFile(script_kind) => script_loader(script_kind),
            ServedBy::EvaluatedText => Loader::Js,
            ServedBy::Declarations(_) => Loader::Ts,
            ServedBy::PluginModule | ServedBy::Disk => {
                plugin_loader.unwrap_or_else(|| requested_loader(kind, path))
            }
        };
        let is_from_plugin = plugin_loader.is_some();
        let plugin_module = self.plugin_module_name(path);
        let Some(script_kind) = script_kind_of(loader) else {
            let source = SourceFile {
                path: self.plugins.provider_path(path),
                contents: text,
                loader,
            };
            let (provider, messages) = (self.input.provider, self.input.messages);
            let parsed = parse_data_module(provider, messages, &source, arena, atoms);
            return ParsedCode {
                hir: parsed.hir,
                host_values: parsed.host_values,
                payload: Some(Box::new(ParsedSource {
                    byte_count: text.len(),
                    is_from_plugin,
                    plugin_module,
                    web_assembly: parsed.web_assembly,
                    is_page: parsed.is_page,
                    ..ParsedSource::new(SourceKind::Data, loader)
                })),
            };
        };
        let source_kind = match served_by {
            ServedBy::EvaluatedText => SourceKind::EvaluatedText,
            _ => SourceKind::Program,
        };
        let compile_options = CompileParseOptions {
            path,
            script_kind: Some(script_kind).filter(|kind| kind.differs_from_name(path)),
            experimental_decorators: request.options.experimental_decorators,
            every_file_is_a_module: request.options.module_detection == ModuleDetection::Force,
            reads_jsdoc: request.reads_jsdoc,
            keeps_function_directives: source_kind == SourceKind::EvaluatedText,
        };
        ParsedCode {
            hir: parse_for_compile(arena, &compile_options, text, atoms),
            host_values: &[],
            payload: Some(Box::new(ParsedSource {
                byte_count: text.len(),
                is_from_plugin,
                plugin_module,
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
        let input = MacroInput {
            provider: self.input.provider,
            messages: self.input.messages,
            runs_macros: self.input.options.load.runs_macros,
        };
        let diagnostics = &mut parsed_source_mut(payload).diagnostics;
        if !request.analysis.pending_macro_calls.is_empty() {
            self.has_run_macros.store(true, Ordering::Release);
        }
        macros::run_macros(&input, arena, atoms, request, diagnostics)
    }

    fn transform_tree<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        request: &mut TransformRequest<'_, 's>,
        payload: &mut Option<HostPayload>,
    ) -> TreeChange {
        let source = parsed_source_mut(payload);
        // A tree is changed once, so a file that gets the names keeps its components as they are written.
        if self.input.options.load.runs_tests
            && source.kind == SourceKind::Program
            && test_runner_names::import_used_names(arena, atoms, request) == TreeChange::Changed
        {
            return TreeChange::Changed;
        }
        self.react_compiler.transform(arena, atoms, request, source)
    }

    fn finish_file(
        &self,
        request: &FinishedFile<'_, '_>,
        payload: &mut Option<HostPayload>,
    ) -> Vec<HostResolution> {
        let source = parsed_source_mut(payload);
        let needs_declarations = self.react_compiler.needs_declarations(source);
        let input = BuiltinUseInput {
            names: self.input.builtin_names,
            platform: self.input.platform,
        };
        let forbids_text_evaluation = self.input.options.aot.forbids_text_evaluation;
        let texts = (!forbids_text_evaluation).then_some(&self.evaluated_texts);
        let mut answers = builtin_uses::finish_application_file(
            &input,
            texts,
            needs_declarations,
            request,
            source,
        );
        let runtime_modules = self.input.runtime_modules;
        let named =
            find_library_modules_named_in_choices(request, &source.builtins, runtime_modules);
        let modules = named
            .modules
            .iter()
            .map(|it| HostModuleId(it.module.registry_id()));
        answers.extend(modules.map(HostResolution::Module));
        source.modules_named_in_choices = named.modules;
        source.library_names_passed_to_imports = named.passed_to_imports;
        answers
    }
}

#[cfg(test)]
mod tests;
