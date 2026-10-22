use std::borrow::Cow;
use std::fmt::Debug;
use std::num::NonZeroUsize;
use std::ptr::NonNull;
use std::sync::Arc;

use bun_aot::statistics::{LimitId, LimitValues};
use bun_core::strings;
use bun_jsc::bun_string_jsc::create_utf8_for_js;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, posix_to_platform_in_place};
use bun_resolve_builtins::Alias;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolver::{GlobalCache, ResultUnion};
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::BindOptions;
use bun_sema::check::aot::FileOrigin;
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{
    Constant, Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions,
};
use bun_sema::hir;
use bun_sema::import_sites::{ImportSite, ImportSpecifier, JsxMode};
use bun_sema::json::Json;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::{
    CodeAnswer, CompiledModule, ComputedTargets, FileId, Files, HostLoader, HostModuleId,
};
use bun_sema::resolve::{
    CodeFailure, CodeHost, CodeImportForm, CodeImportKind, CodeOptions, CodeParseRequest, CodeRequest,
    CodeResolution, ComputedCandidate, ComputedCodeRequest, ComputedResolution, Host,
    HostResolution, JsxSettings, CachedConfig, Options, ParseOptions, ParsedCode, Paths, Resolver,
    ScriptKind, TranspileSettings, inside, is_declaration_file_name, is_same_path,
};
use bun_sema::session::{Arena, Session};
use bun_sema::util::FxHashSet;
use bun_sema_driver::host::{Disk, from_argument, from_native, to_native};
use bun_sema_driver::{
    BuildDiagnostic, CompileRequest, EntryPointFailure, EntryPoints, Libs, LoadFailure,
    load_program, use_dedicated_pool,
};
use bun_threading::Guarded;

use crate::cli::typescript_libs::BUNDLED;

pub(crate) struct DiskWithBuiltinModules {
    disk: Disk,
    modules: Vec<&'static [u8]>,
}

fn builtin_module_name(specifier: &[u8]) -> Option<&'static [u8]> {
    let alias = Alias::get(specifier, bun_ast::Target::Bun, Default::default())?;
    Some(alias.path.as_bytes())
}

impl DiskWithBuiltinModules {
    pub(crate) fn new(threads: usize, working_directory: &[u8]) -> DiskWithBuiltinModules {
        let threads = match threads {
            0 => usize::from(bun_core::get_thread_count()),
            threads => threads,
        };
        let working_directory = strings::without_trailing_slash(working_directory);
        let mut disk = Disk::with_already_read(threads, Default::default(), working_directory)
            .started_in(working_directory);
        disk.bundled_libs = Some(BUNDLED);
        let mut modules: Vec<&'static [u8]> = Vec::new();
        for (_, alias) in BUN_ALIASES.iter().copied().flatten() {
            let name = alias.path.as_bytes();
            if !modules.contains(&name) {
                modules.push(name);
            }
        }
        DiskWithBuiltinModules { disk, modules }
    }

    pub(crate) fn module_name(&self, module: HostModuleId) -> &'static [u8] {
        self.modules[module.0 as usize]
    }
}

macro_rules! forward_to_disk {
    ($(fn $method:ident(&self $(, $argument:ident: $argument_type:ty)*) $(-> $result:ty)?;)*) => {
        $(
            fn $method(&self $(, $argument: $argument_type)*) $(-> $result)? {
                self.disk.$method($($argument),*)
            }
        )*
    };
}

impl Host for DiskWithBuiltinModules {
    forward_to_disk! {
        fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>>;
        fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]>;
        fn origin(&self, path: &[u8]) -> usize;
        fn take_unreadable(&self) -> Vec<Vec<u8>>;
        fn is_file(&self, path: &[u8]) -> bool;
        fn is_dir(&self, path: &[u8]) -> bool;
        fn realpath(&self, path: &[u8]) -> Vec<u8>;
        fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>>;
        fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>);
        fn is_case_sensitive(&self) -> bool;
        fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)];
        fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>>;
        fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json>;
        fn extended_config(&self, path: &[u8]) -> Option<CachedConfig>;
        fn cache_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> CachedConfig);
        fn shared_paths(&self, paths: Arc<Paths>) -> Arc<Paths>;
        fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync));
        fn is_single_threaded(&self) -> bool;
        fn ends_the_process(&self, has_a_run: bool) -> bool;
        fn helpers_now(&self) -> Option<usize>;
        fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync));
        fn loaded(&self);
        fn threads(&self) -> usize;
        fn io_pool(&self) -> Option<&bun_threading::ThreadPool>;
    }

    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        if let Some(kind) = self.disk.script_kind(path) {
            return Some(kind);
        }
        let is_known = ScriptKind::from_file_name(path).is_some() || path.ends_with(b".json");
        (!is_known).then_some(ScriptKind::Jsx)
    }

    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        self.disk.parse(arena, path, text, atoms, options)
    }

    fn parallel_while(
        &self,
        count: usize,
        work: &(dyn Fn(usize) + Sync),
        meanwhile: &mut dyn FnMut(),
    ) {
        self.disk.parallel_while(count, work, meanwhile);
    }

    fn run_regions_inline(&self, work: &mut dyn FnMut()) {
        self.disk.run_regions_inline(work);
    }
}

impl CodeHost for DiskWithBuiltinModules {
    forward_to_disk! {
        fn parse_runtime_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json>;
        fn parse_runtime_tsconfig(&self, arena: &Arena, text: &[u8]) -> Option<Json>;
    }

    fn resolve_code(&self, request: &CodeRequest<'_>) -> HostResolution {
        match request.kind {
            CodeImportKind::EntryPoint => HostResolution::Unclaimed,
            CodeImportKind::Import | CodeImportKind::Require => {
                self.resolve_runtime_module(request.specifier)
            }
        }
    }

    fn resolve_runtime_module(&self, specifier: &[u8]) -> HostResolution {
        let index = builtin_module_name(specifier)
            .and_then(|name| self.modules.iter().position(|module| *module == name));
        index.map_or(HostResolution::Unclaimed, |index| {
            HostResolution::Module(HostModuleId(index as u32))
        })
    }

    fn find_runtime_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostResolution> {
        let specifiers = BUN_ALIASES.iter().copied().flatten().map(|entry| entry.0);
        specifiers
            .filter(|specifier| {
                specifier.len() >= prefix.len() + suffix.len()
                    && specifier.starts_with(prefix)
                    && specifier.ends_with(suffix)
            })
            .map(|specifier| self.resolve_runtime_module(specifier))
            .filter(|resolution| *resolution != HostResolution::Unclaimed)
            .collect()
    }

    fn parse_code<'s>(
        &self,
        arena: &'s Arena,
        request: &CodeParseRequest<'_>,
        text: &[u8],
        atoms: &Interner<'s>,
    ) -> ParsedCode<'s> {
        let script_kind = self.script_kind(request.path);
        self.disk
            .parse_code_as(script_kind, arena, request, text, atoms)
    }
}

enum Answer {
    File(Vec<u8>),
    Builtin(&'static [u8]),
    External,
    Erased,
    ComputedAll,
    ComputedSet(Vec<Answer>),
    NotFound(Option<CodeFailure>),
}

impl Answer {
    fn from_resolution(host: &DiskWithBuiltinModules, resolution: CodeResolution<'_>) -> Answer {
        match resolution {
            CodeResolution::File(file) => Answer::File(file.path.to_vec()),
            CodeResolution::HostModule(module) => Answer::Builtin(host.module_name(module)),
            CodeResolution::External { .. } => Answer::External,
            CodeResolution::Erased => Answer::Erased,
            CodeResolution::NotFound(failure) => Answer::NotFound(Some(failure)),
        }
    }

    fn from_candidate(host: &DiskWithBuiltinModules, candidate: ComputedCandidate<'_>) -> Answer {
        match candidate {
            ComputedCandidate::File(file) => Answer::File(file.path.to_vec()),
            ComputedCandidate::HostModule(module) => Answer::Builtin(host.module_name(module)),
        }
    }

    fn from_code_answer(
        host: &DiskWithBuiltinModules,
        files: &Files<'_>,
        answer: CodeAnswer<'_>,
    ) -> Answer {
        let file_answer = |file: FileId| Answer::File(files.module(file).file_name().to_vec());
        let module_answer = |module: HostModuleId| Answer::Builtin(host.module_name(module));
        match answer {
            CodeAnswer::File(file) => file_answer(file),
            CodeAnswer::HostModule(module) => module_answer(module),
            CodeAnswer::External { .. } => Answer::External,
            CodeAnswer::Erased => Answer::Erased,
            CodeAnswer::Computed(ComputedTargets::All { .. }) => Answer::ComputedAll,
            CodeAnswer::Computed(ComputedTargets::Modules {
                files: targets,
                host_modules,
                spellings: _,
            }) => {
                let targets = targets.iter().copied().map(file_answer);
                let host_modules = host_modules.iter().copied().map(module_answer);
                Answer::ComputedSet(targets.chain(host_modules).collect())
            }
            CodeAnswer::NotFound(failure) => Answer::NotFound(Some(failure)),
        }
    }

    fn is_same(&self, other: &Answer, is_case_sensitive: bool) -> bool {
        match self {
            Answer::File(path) => {
                matches!(other, Answer::File(it) if is_same_path(path, it, is_case_sensitive))
            }
            Answer::Builtin(name) => matches!(other, Answer::Builtin(it) if name == it),
            Answer::External => matches!(other, Answer::External),
            Answer::Erased => matches!(other, Answer::Erased),
            Answer::ComputedAll => matches!(other, Answer::ComputedAll),
            Answer::ComputedSet(members) => matches!(other, Answer::ComputedSet(others)
                if members.len() == others.len()
                    && (members.iter().zip(others))
                        .all(|(member, it)| member.is_same(it, is_case_sensitive))),
            Answer::NotFound(_) => matches!(other, Answer::NotFound(_)),
        }
    }

    fn text(&self) -> Vec<u8> {
        match self {
            Answer::File(path) => native_text(path),
            Answer::Builtin(name) => [b"builtin:", *name].concat(),
            Answer::External => b"external".to_vec(),
            Answer::Erased => b"erased".to_vec(),
            Answer::ComputedAll => b"computed".to_vec(),
            Answer::ComputedSet(members) => {
                let texts: Vec<Vec<u8>> = members.iter().map(Answer::text).collect();
                let list = texts.join(&b", "[..]);
                [&b"computed: "[..], &list[..]].concat()
            }
            Answer::NotFound(None) => b"not found".to_vec(),
            Answer::NotFound(Some(failure)) => format!("not found ({failure:?})").into_bytes(),
        }
    }
}

fn native_text(path: &[u8]) -> Vec<u8> {
    let mut text = to_native(path).to_vec();
    posix_to_platform_in_place(&mut text);
    text
}

fn native_directory(file: &[u8]) -> Vec<u8> {
    let mut directory = native_text(dirname::<Posix>(file));
    if directory.last() != Some(&bun_paths::SEP) {
        directory.push(bun_paths::SEP);
    }
    directory
}

fn json_object<'a>(entries: impl IntoIterator<Item = (&'a str, Json)>) -> Json {
    let entries = entries.into_iter();
    let entries = entries.map(|(name, value)| (name.as_bytes().to_vec(), value));
    Json::Object(entries.collect())
}

fn path_json(path: &[u8]) -> Json {
    Json::String(native_text(path))
}

fn debug_name(value: &dyn Debug) -> Json {
    Json::String(format!("{value:?}").into_bytes())
}

fn kind_json(kind: CodeImportKind) -> Json {
    let name: &[u8] = match kind {
        CodeImportKind::Import => b"import",
        CodeImportKind::Require => b"require",
        CodeImportKind::EntryPoint => unreachable!("an import site is never an entry point"),
    };
    Json::String(name.to_vec())
}

fn json_to_js(global: &JSGlobalObject, json: &Json) -> JsResult<JSValue> {
    let mut text = Vec::new();
    json.stringify(&mut text);
    create_utf8_for_js(global, &text)
}

struct CompareOptions<'a> {
    conditions: Vec<&'a [u8]>,
    preserves_symlinks: bool,
    lists_every_site: bool,
}

struct Site {
    specifier: Vec<u8>,
    kind: CodeImportKind,
    compile: Answer,
}

struct Directory {
    path: Vec<u8>,
    real_path: Vec<u8>,
    is_under_link: bool,
}

fn find_source_files(host: &dyn Host, root: &[u8], preserves_symlinks: bool) -> Vec<Vec<u8>> {
    let mut source_files = Vec::new();
    let mut visited: FxHashSet<(Vec<u8>, bool)> = FxHashSet::default();
    let mut pending = vec![Directory {
        path: root.to_vec(),
        real_path: root.to_vec(),
        is_under_link: false,
    }];
    while let Some(directory) = pending.pop() {
        let (file_names, directory_names) = host.entries(&directory.path);
        for name in &file_names {
            if ScriptKind::from_file_name(name).is_none() || is_declaration_file_name(name) {
                continue;
            }
            let path = inside(&directory.path, name);
            if host.realpath(&path) == inside(&directory.real_path, name) {
                source_files.push(path);
            }
        }
        for name in directory_names.iter().rev() {
            let path = inside(&directory.path, name);
            let real_path = host.realpath(&path);
            let is_link = real_path != inside(&directory.real_path, name);
            if is_link && !preserves_symlinks {
                continue;
            }
            let is_under_link = directory.is_under_link || is_link;
            if visited.insert((real_path.clone(), is_under_link)) {
                pending.push(Directory {
                    path,
                    real_path,
                    is_under_link,
                });
            }
        }
    }
    source_files
}

pub(crate) fn code_options_with_limits(
    working_directory: &[u8],
    limits: &LimitValues,
) -> CodeOptions {
    let max_candidates = limits.get(LimitId::MaxComputedSpecifierCandidates);
    CodeOptions {
        max_computed_candidates: u32::try_from(max_candidates).unwrap_or(u32::MAX),
        ..CodeOptions::bun_run(working_directory)
    }
}

pub(crate) fn fold_options_with_limits<'s>(limits: &LimitValues) -> FoldOptions<'s> {
    let max_string_bytes = limits.get(LimitId::MaxFoldedStringBytes);
    FoldOptions {
        max_string_bytes: usize::try_from(max_string_bytes).unwrap_or(usize::MAX),
        ..FoldOptions::default()
    }
}

fn collect_constant_specifiers(host: &dyn CodeHost, path: &[u8]) -> Vec<Vec<u8>> {
    let Some(text) = host.read(path) else {
        return Vec::new();
    };
    let session = Session::new();
    let arena = session.arena();
    let atoms = Interner::new_in(&session);
    let settings = TranspileSettings {
        jsx: JsxSettings::default(),
        experimental_decorators: false,
        emits_decorator_metadata: false,
        use_define_for_class_fields: None,
    };
    let request = CodeParseRequest {
        path,
        loader: HostLoader::default(),
        options: ParseOptions::default(),
        reads_jsdoc: false,
        settings: &settings,
        declared_module_type: DeclaredModuleType::Unknown,
    };
    let mut hir = host.parse_code(arena, &request, &text, &atoms).hir;
    if hir.has_errors {
        return Vec::new();
    }
    hir.text = text;
    let bind_options = BindOptions {
        runtime: Some(Default::default()),
        ..Default::default()
    };
    let fold_options = FoldOptions {
        preserves_unused_imports: true,
        ..fold_options_with_limits(&LimitValues::for_host())
    };
    let fold = FoldInputs::new(fold_options, arena);
    let file_inputs = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (_, analysis) = analyze_file(&mut hir, bind_options, &fold, file_inputs, &atoms, arena);
    let mut seen: FxHashSet<Atom> = FxHashSet::default();
    let mut specifiers = Vec::new();
    for site in analysis.import_sites {
        match site.specifier {
            ImportSpecifier::Constant(specifier) if seen.insert(specifier) => {
                specifiers.push(atoms.bytes(specifier).to_vec());
            }
            ImportSpecifier::Constant(_)
            | ImportSpecifier::Pattern { .. }
            | ImportSpecifier::Unknown => {}
        }
    }
    specifiers
}

fn resolve_file_sites(
    host: &DiskWithBuiltinModules,
    resolver: &Resolver<'_>,
    importer: &[u8],
) -> Vec<Site> {
    let directory = dirname::<Posix>(importer);
    let mut sites = Vec::new();
    for specifier in collect_constant_specifiers(host, importer) {
        for kind in [CodeImportKind::Import, CodeImportKind::Require] {
            let request = CodeRequest {
                specifier: &specifier,
                importer,
                directory,
                kind,
                form: CodeImportForm::Static,
            };
            match resolver.resolve_code(&request) {
                CodeResolution::NotFound(CodeFailure::QueryString) => {}
                resolution => sites.push(Site {
                    specifier: specifier.clone(),
                    kind,
                    compile: Answer::from_resolution(host, resolution),
                }),
            }
        }
    }
    sites
}

fn resolve_sites(
    host: &DiskWithBuiltinModules,
    resolver: &Resolver<'_>,
    importers: &[Vec<u8>],
) -> Vec<Vec<Site>> {
    let empty_slots = importers.iter().map(|_| Guarded::new(Vec::new()));
    let slots: Vec<Guarded<Vec<Site>>> = empty_slots.collect();
    host.parallel(importers.len(), &|index| {
        *slots[index].lock() = resolve_file_sites(host, resolver, &importers[index]);
    });
    (slots.into_iter())
        .map(|mut slot| std::mem::take(slot.get_mut()))
        .collect()
}

fn bun_run_answer(
    resolver: &mut bun_resolver::Resolver<'_>,
    directory: &[u8],
    specifier: &[u8],
    kind: CodeImportKind,
) -> Answer {
    if let Some(name) = builtin_module_name(specifier) {
        return Answer::Builtin(name);
    }
    let kind = match kind {
        CodeImportKind::EntryPoint => bun_ast::ImportKind::EntryPointRun,
        CodeImportKind::Import => bun_ast::ImportKind::Stmt,
        CodeImportKind::Require => bun_ast::ImportKind::Require,
    };
    let result =
        resolver.resolve_and_auto_install(directory, specifier, kind, GlobalCache::disable);
    let result = match result {
        ResultUnion::Success(result) => result,
        ResultUnion::Failure(_) | ResultUnion::Pending(_) | ResultUnion::NotFound => {
            return Answer::NotFound(None);
        }
    };
    let Some(path) = result.path_const() else {
        return Answer::NotFound(None);
    };
    let is_external = result.flags.is_external();
    match builtin_module_name(path.text).filter(|_| is_external) {
        Some(name) => Answer::Builtin(name),
        None if is_external || path.is_data_url() => Answer::External,
        None => Answer::File(from_native(path.text)),
    }
}

fn site_json(importer: &[u8], site: &Site, bun_run: &Answer) -> Json {
    json_object([
        ("importer", path_json(importer)),
        ("specifier", Json::String(site.specifier.clone())),
        ("kind", kind_json(site.kind)),
        ("bunRun", Json::String(bun_run.text())),
        ("compile", Json::String(site.compile.text())),
    ])
}

fn compare_with_bun_run(
    global: &JSGlobalObject,
    options: &CompareOptions<'_>,
    is_case_sensitive: bool,
    importers: &[Vec<u8>],
    sites: &[Vec<Site>],
) -> Json {
    let resolver_options = &mut global.bun_vm().as_mut().transpiler.resolver.opts;
    let added_to_import: Vec<&[u8]> = (options.conditions.iter())
        .filter(|condition| !resolver_options.conditions.import.contains(condition))
        .copied()
        .collect();
    let added_to_require: Vec<&[u8]> = (options.conditions.iter())
        .filter(|condition| !resolver_options.conditions.require.contains(condition))
        .copied()
        .collect();
    for condition in &added_to_import {
        resolver_options.conditions.import.insert(condition, ());
    }
    for condition in &added_to_require {
        resolver_options.conditions.require.insert(condition, ());
    }
    let previous_preserve_symlinks = std::mem::replace(
        &mut resolver_options.preserve_symlinks,
        options.preserves_symlinks,
    );
    scopeguard::defer! {
        let resolver_options = &mut global.bun_vm().as_mut().transpiler.resolver.opts;
        for condition in &added_to_import {
            resolver_options.conditions.import.swap_remove(condition);
        }
        for condition in &added_to_require {
            resolver_options.conditions.require.swap_remove(condition);
        }
        resolver_options.preserve_symlinks = previous_preserve_symlinks;
    }
    let mut log = bun_ast::Log::init();
    // SAFETY: the resolver belongs to the VM, which outlives this call, and `log` is declared
    // before the guard, so the guard is dropped first.
    let _log_scope = unsafe {
        bun_resolver::Resolver::scoped_log(
            &raw mut (*global.bun_vm_ptr()).transpiler.resolver,
            NonNull::from(&mut log),
        )
    };

    let resolver = &mut global.bun_vm().as_mut().transpiler.resolver;
    let mut site_count = 0;
    let (mut differences, mut every_site) = (Vec::new(), Vec::new());
    for (importer, sites) in importers.iter().zip(sites) {
        let directory = native_directory(importer);
        for site in sites {
            let bun_run = bun_run_answer(resolver, &directory, &site.specifier, site.kind);
            if options.lists_every_site {
                every_site.push(site_json(importer, site, &bun_run));
            }
            if !bun_run.is_same(&site.compile, is_case_sensitive) {
                differences.push(site_json(importer, site, &bun_run));
            }
        }
        site_count += sites.len();
    }
    let mut comparison = vec![
        ("sites", Json::Number(site_count as f64)),
        ("differences", Json::Array(differences)),
    ];
    if options.lists_every_site {
        comparison.push(("everySite", Json::Array(every_site)));
    }
    json_object(comparison)
}

fn vm_code_options(vm: &VirtualMachine, root: &[u8], options: &CompareOptions<'_>) -> CodeOptions {
    let top_level_directory = from_native(vm.top_level_dir());
    let node_path = vm.env_loader().get(b"NODE_PATH").unwrap_or_default();
    let separator: &[u8] = if cfg!(windows) { b";" } else { b":" };
    let tsconfig_override = vm.transpiler.resolver.opts.tsconfig_override.as_deref();
    let mut code = code_options_with_limits(root, &LimitValues::for_host());
    code.typed_condition = None;
    let conditions = options.conditions.iter().map(|it| it.to_vec());
    code.conditions.extend(conditions);
    code.preserves_symlinks = options.preserves_symlinks;
    code.node_paths = strings::tokenize(node_path, separator)
        .map(|entry| from_argument(&top_level_directory, entry))
        .collect();
    code.tsconfig_override = tsconfig_override.map(from_native);
    code
}

pub(crate) fn compare_code_resolution(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let root_argument = frame.argument(0).to_utf8(global)?;
    let conditions_argument = frame.argument(1).to_utf8(global)?;
    let vm = global.bun_vm();
    let options = CompareOptions {
        conditions: strings::tokenize(&conditions_argument, b"\n").collect(),
        preserves_symlinks: match frame.argument(2) {
            value if value.is_undefined() => vm.transpiler.resolver.opts.preserve_symlinks,
            value => value.to_boolean(),
        },
        lists_every_site: frame.argument(3).to_boolean(),
    };

    use_dedicated_pool("Bun Compile");
    let requested_root = from_native(&root_argument);
    let host = DiskWithBuiltinModules::new(0, &requested_root);
    let root = host.realpath(&requested_root);
    if !host.is_dir(&root) {
        let root = bstr::BStr::new(&root_argument);
        return Err(global.throw(format_args!("{root} is not a directory")));
    }

    let code = vm_code_options(vm, &root, &options);
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, &host, &type_options, &code);
    let importers = find_source_files(&host, &root, options.preserves_symlinks);
    let sites = resolve_sites(&host, &resolver, &importers);
    let is_case_sensitive = host.is_case_sensitive();
    let comparison = compare_with_bun_run(global, &options, is_case_sensitive, &importers, &sites);
    json_to_js(global, &comparison)
}

fn computed_resolution_json(
    host: &DiskWithBuiltinModules,
    resolution: ComputedResolution<'_>,
) -> Json {
    let kind = |name: &[u8]| ("kind", Json::String(name.to_vec()));
    match resolution {
        ComputedResolution::All { cause, .. } => {
            json_object([kind(b"all"), ("cause", debug_name(&cause))])
        }
        ComputedResolution::Candidates { candidates, .. } => {
            let answers = (candidates.iter()).map(|&it| Answer::from_candidate(host, it));
            let candidates = answers.map(|answer| Json::String(answer.text())).collect();
            json_object([kind(b"computed"), ("candidates", Json::Array(candidates))])
        }
    }
}

pub(crate) fn resolve_computed_specifier(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let importer_argument = frame.argument(0).to_utf8(global)?;
    let prefix_argument = frame.argument(1).to_utf8(global)?;
    let suffix_argument = frame.argument(2).to_utf8(global)?;
    let kind_argument = frame.argument(3).to_utf8(global)?;
    let kind = match kind_argument.slice() {
        b"import" => CodeImportKind::Import,
        b"require" => CodeImportKind::Require,
        other => {
            let other = bstr::BStr::new(other);
            return Err(global.throw(format_args!("{other} is not \"import\" or \"require\"")));
        }
    };
    let vm = global.bun_vm();
    let options = CompareOptions {
        conditions: Vec::new(),
        preserves_symlinks: vm.transpiler.resolver.opts.preserve_symlinks,
        lists_every_site: false,
    };

    let requested_importer = from_native(&importer_argument);
    let requested_directory = dirname::<Posix>(&requested_importer);
    let host = DiskWithBuiltinModules::new(0, requested_directory);
    let directory = host.realpath(requested_directory);
    if !host.is_dir(&directory) {
        let importer = bstr::BStr::new(&importer_argument);
        return Err(global.throw(format_args!("{importer} is not in a directory")));
    }

    let code = vm_code_options(vm, &directory, &options);
    let session = Session::new();
    let type_options = Options::default();
    let resolver = Resolver::for_compile(&session, &host, &type_options, &code);
    let resolution = resolver.resolve_computed_code(&ComputedCodeRequest {
        prefix: &prefix_argument,
        suffix: &suffix_argument,
        importer: &inside(&directory, strings::basename_posix(&requested_importer)),
        directory: &directory,
        kind,
        form: CodeImportForm::Static,
    });
    json_to_js(global, &computed_resolution_json(&host, resolution))
}

fn parse_define<'s>(line: &[u8], atoms: &Interner<'s>, arena: &'s Arena) -> Define<'s> {
    let (name, value) = strings::split_once_char(line, b'=').unwrap_or((line, &b""[..]));
    let parts: Vec<&[u8]> = strings::split(name, b".").collect();
    let (root, members) = match parts[..] {
        [b"import", b"meta", ref members @ ..] => (DefineRoot::ImportMeta, members),
        [global, ref members @ ..] => (DefineRoot::Global(atoms.intern(global)), members),
        [] => unreachable!("`split` returns at least one part"),
    };
    let members: Vec<Atom> = members.iter().map(|member| atoms.intern(member)).collect();
    let value = match value {
        b"true" => Constant::Boolean(true),
        b"false" => Constant::Boolean(false),
        text => Constant::String(atoms.intern(text)),
    };
    Define {
        path: DefinePath {
            root,
            members: arena.alloc_slice_copy(&members),
        },
        value: DefineValue::Constant(value),
    }
}

fn diagnostic_json(reported: &BuildDiagnostic) -> Json {
    let diagnostic = &reported.diagnostic;
    let mut text = format!("TS{}: ", diagnostic.code).into_bytes();
    text.extend_from_slice(&diagnostic.text);
    Json::String(text)
}

#[derive(Default)]
struct GraphDescription {
    files: Vec<Json>,
    entry_points: Vec<Json>,
    compiled_files: Vec<Json>,
    host_modules: Vec<Json>,
    unresolved_entry_points: Vec<Json>,
    diagnostics: Vec<Json>,
}

impl GraphDescription {
    fn into_json(self) -> Json {
        json_object([
            ("files", Json::Array(self.files)),
            ("entryPoints", Json::Array(self.entry_points)),
            ("compiledFiles", Json::Array(self.compiled_files)),
            ("hostModules", Json::Array(self.host_modules)),
            (
                "unresolvedEntryPoints",
                Json::Array(self.unresolved_entry_points),
            ),
            ("diagnostics", Json::Array(self.diagnostics)),
        ])
    }
}

struct GraphDescriber<'a, 's> {
    host: &'a DiskWithBuiltinModules,
    files: &'a Files<'s>,
}

impl GraphDescriber<'_, '_> {
    fn path(&self, file: FileId) -> Json {
        path_json(self.files.module(file).file_name())
    }

    fn paths(&self, files: &[FileId]) -> Vec<Json> {
        files.iter().map(|&file| self.path(file)).collect()
    }

    fn text(&self, atom: Atom) -> Json {
        Json::String(self.files.atoms.bytes(atom).to_vec())
    }

    fn answer(&self, answer: CodeAnswer<'_>) -> Json {
        Json::String(Answer::from_code_answer(self.host, self.files, answer).text())
    }

    fn answers(&self, answers: &[CodeAnswer<'_>]) -> Vec<Json> {
        answers.iter().map(|&answer| self.answer(answer)).collect()
    }

    fn describe_site(&self, site: &ImportSite, answer: CodeAnswer<'_>) -> Json {
        let mut description = match site.specifier {
            ImportSpecifier::Constant(specifier) => vec![("specifier", self.text(specifier))],
            ImportSpecifier::Pattern { prefix, suffix } => vec![
                ("specifier", Json::Null),
                ("prefix", self.text(prefix)),
                ("suffix", self.text(suffix)),
            ],
            ImportSpecifier::Unknown => vec![("specifier", Json::Null)],
        };
        let external_kind = match answer {
            CodeAnswer::External { kind, .. } => debug_name(&kind),
            CodeAnswer::File(_)
            | CodeAnswer::HostModule(_)
            | CodeAnswer::Erased
            | CodeAnswer::Computed(_)
            | CodeAnswer::NotFound(_) => Json::Null,
        };
        description.extend([
            ("kind", kind_json(CodeImportKind::from_site(site.kind))),
            ("answer", self.answer(answer)),
            ("externalKind", external_kind),
        ]);
        json_object(description)
    }

    fn describe_sites(&self, compiled: &CompiledModule<'_>) -> Vec<Json> {
        let sites = compiled.analysis.import_sites.iter();
        sites
            .zip(compiled.code_answers)
            .map(|(site, &answer)| self.describe_site(site, answer))
            .collect()
    }

    fn describe_module(&self, file: FileId) -> Json {
        let module = self.files.module(file);
        let compiled = self.files.compiled(file);
        let loader = compiled.map_or(0, |it| it.loader.0);
        let module_format = compiled.map(|it| debug_name(&it.analysis.module_format));
        let sites = compiled.map(|it| self.describe_sites(it));
        let implied_answers = compiled.map(|it| self.answers(it.implied_answers));
        let typed_source_path = compiled.and_then(|it| it.typed_source_path);
        let rejected_typed_version = compiled.and_then(|it| it.rejected_typed_version);
        let erasure_mismatch = rejected_typed_version.map(|it| debug_name(&it.kind));
        json_object([
            ("path", self.path(file)),
            ("role", debug_name(&module.role)),
            ("isLibrary", Json::Bool(module.is_lib)),
            ("isCompiled", Json::Bool(self.files.is_compiled(file))),
            ("isInTypesProgram", Json::Bool(module.is_in_types_program)),
            ("typeEdges", Json::Array(self.paths(module.edges))),
            ("codeEdges", Json::Array(self.paths(module.code_edges))),
            ("loader", Json::Number(f64::from(loader))),
            ("moduleFormat", module_format.unwrap_or(Json::Null)),
            ("sites", Json::Array(sites.unwrap_or_default())),
            (
                "impliedAnswers",
                Json::Array(implied_answers.unwrap_or_default()),
            ),
            (
                "typedSourcePath",
                typed_source_path.map_or(Json::Null, path_json),
            ),
            ("erasureMismatch", erasure_mismatch.unwrap_or(Json::Null)),
        ])
    }

    fn describe_files(&self, diagnostics: &[BuildDiagnostic]) -> GraphDescription {
        let files = (0..self.files.modules.len() as u32).map(FileId);
        let host_modules = self.files.host_modules().iter();
        GraphDescription {
            files: files.map(|file| self.describe_module(file)).collect(),
            entry_points: self.paths(self.files.entry_points()),
            compiled_files: self.paths(self.files.compiled_files()),
            host_modules: host_modules
                .map(|&module| Json::String(self.host.module_name(module).to_vec()))
                .collect(),
            unresolved_entry_points: Vec::new(),
            diagnostics: diagnostics.iter().map(diagnostic_json).collect(),
        }
    }
}

fn entry_point_failure_json(failure: EntryPointFailure) -> Json {
    match failure {
        EntryPointFailure::NotFound(failure) => debug_name(&failure),
        EntryPointFailure::BuiltinModule | EntryPointFailure::External => debug_name(&failure),
    }
}

fn describe_failure(failure: &LoadFailure) -> GraphDescription {
    let unresolved_entry_points = failure.unresolved_entry_points.iter();
    GraphDescription {
        unresolved_entry_points: unresolved_entry_points
            .map(|&(index, failure)| {
                json_object([
                    ("index", Json::Number(index as f64)),
                    ("failure", entry_point_failure_json(failure)),
                ])
            })
            .collect(),
        diagnostics: failure.diagnostics.iter().map(diagnostic_json).collect(),
        ..Default::default()
    }
}

pub(crate) fn describe_code_graph(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let session = Session::new();
    let entry_points_argument = frame.argument(0).to_utf8(global)?;
    let conditions_argument = frame.argument(1).to_utf8(global)?;
    let threads = usize::try_from(frame.argument(2).to_int32()).unwrap_or(0);
    let defines_argument = frame.argument(3).to_utf8(global)?;
    let features_argument = frame.argument(4).to_utf8(global)?;
    let working_directory_argument = frame.argument(5).to_utf8(global)?;
    let working_directory = from_native(match working_directory_argument.is_empty() {
        true => global.bun_vm().top_level_dir(),
        false => working_directory_argument.slice(),
    });

    let host = DiskWithBuiltinModules::new(threads, &working_directory);
    let limits = LimitValues::for_host();
    let mut code = code_options_with_limits(&working_directory, &limits);
    code.typed_condition = Some(b"bun-aot".to_vec());
    for condition in strings::tokenize(&conditions_argument, b"\n") {
        code.add_custom_condition(condition);
    }

    let arena = session.arena();
    let atoms = Interner::new_in(&session);
    let defines: Vec<Define<'_>> = strings::tokenize(&defines_argument, b"\n")
        .map(|line| parse_define(line, &atoms, arena))
        .collect();
    let features: Vec<Atom> = strings::tokenize(&features_argument, b"\n")
        .map(|feature| atoms.intern(feature))
        .collect();
    let fold_options = FoldOptions {
        defines: arena.alloc_slice_copy(&defines),
        features: arena.alloc_slice_copy(&features),
        ..fold_options_with_limits(&limits)
    };
    let fold = FoldInputs::new(fold_options, arena);
    let entry_points: Vec<Vec<u8>> = strings::tokenize(&entry_points_argument, b"\n")
        .map(<[u8]>::to_vec)
        .collect();
    let request = CompileRequest {
        entry_points: EntryPoints::Written(&entry_points),
        code: &code,
        fold: &fold,
        atoms,
        libs: Libs::Bundled(BUNDLED),
        project_origin: FileOrigin::NoFile,
        threads: NonZeroUsize::new(host.threads()).unwrap_or(NonZeroUsize::MIN),
        progress: None,
        left_out_bodies: None,
    };
    let description = match load_program(&session, &host, &request) {
        Ok(loaded) => {
            let describer = GraphDescriber {
                host: &host,
                files: loaded.files(),
            };
            describer.describe_files(&loaded.diagnostics)
        }
        Err(failure) => describe_failure(&failure),
    };
    json_to_js(global, &description.into_json())
}
