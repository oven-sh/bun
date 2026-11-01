use super::*;
use crate::compile::testing::set_up_output;
use crate::load::host::tests::take_messages;
use crate::load::source_provider::{DeferredLoad, SourceFile, WithoutServices};
use bstr::BStr;
use bun_ast::{Loc, Log};
use bun_sema::atom::Interner;
use bun_sema::fold::FoldOptions;
use bun_sema::hir_from_data::DataModule;
use bun_sema::session::Arena;
use bun_sema_standalone as _;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

struct TestProvider {
    resolve_answer: fn(&ResolveRequest<'_>) -> Result<Resolution, Failed>,
    load_answer: fn(&LoadRequest<'_>, &mut Log) -> Result<Loaded, Failed>,
    has_load_plugin_answer: fn(ModuleName<'_>) -> bool,
    deferred_answers: Guarded<Vec<DeferredLoad>>,
    resolve_count: AtomicUsize,
    load_count: AtomicUsize,
    finish_count: AtomicUsize,
}

impl Default for TestProvider {
    fn default() -> TestProvider {
        TestProvider {
            resolve_answer: |_| Ok(Resolution::NotHandled),
            load_answer: |request, log| WithoutServices.load(request, log),
            has_load_plugin_answer: |_| true,
            deferred_answers: Guarded::new(Vec::new()),
            resolve_count: AtomicUsize::new(0),
            load_count: AtomicUsize::new(0),
            finish_count: AtomicUsize::new(0),
        }
    }
}

impl SourceProvider for TestProvider {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, _log: &mut Log) -> Result<Resolution, Failed> {
        self.resolve_count.fetch_add(1, Relaxed);
        (self.resolve_answer)(request)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        self.load_count.fetch_add(1, Relaxed);
        (self.load_answer)(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        (self.has_load_plugin_answer)(module)
    }

    fn finish_deferred_loads(&self, _log: &mut Log) -> Vec<DeferredLoad> {
        self.finish_count.fetch_add(1, Relaxed);
        std::mem::take(&mut *self.deferred_answers.lock())
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

fn plugin_source(text: &'static [u8]) -> Loaded {
    Loaded::Source {
        contents: Cow::Borrowed(text),
        loader: Loader::Json,
        is_from_plugin: true,
    }
}

fn deferring_provider(answers: Vec<DeferredLoad>) -> TestProvider {
    TestProvider {
        load_answer: |_, _| Ok(Loaded::Deferred),
        deferred_answers: Guarded::new(answers),
        ..TestProvider::default()
    }
}

fn answer_for_file(path: &[u8], answer: Result<Loaded, Failed>) -> DeferredLoad {
    DeferredLoad {
        namespace: b"file".to_vec(),
        path: path.to_vec(),
        answer,
    }
}

fn module(namespace: &[u8], path: &[u8]) -> Result<Resolution, Failed> {
    Ok(Resolution::Module {
        namespace: namespace.to_vec(),
        path: path.to_vec(),
    })
}

fn resolve_specifier_in_namespace(request: &ResolveRequest<'_>) -> Result<Resolution, Failed> {
    match request.specifier {
        b"on-disk" => module(b"file", b"/p/other.ts"),
        b"no-namespace" => module(b"", b"/p/other.ts"),
        b"external" => Ok(Resolution::External {
            specifier: b"elsewhere".to_vec(),
        }),
        b"failed" => Err(Failed),
        specifier => module(b"v", specifier),
    }
}

fn empty_disk() -> Disk {
    set_up_output();
    Disk::with_already_read(1, Default::default(), b"/project")
}

fn disk_with_file(path: &[u8], text: &[u8]) -> Disk {
    let already_read = [(path.to_vec(), text.to_vec())].into_iter().collect();
    set_up_output();
    Disk::with_already_read(1, already_read, b"/project")
}

fn request<'r>(specifier: &'r [u8], importer: &'r [u8]) -> CodeRequest<'r> {
    CodeRequest {
        specifier,
        importer,
        directory: b"/p",
        kind: CodeImportKind::Import,
        form: CodeImportForm::Static,
    }
}

fn resolved_path(resolution: PluginResolution) -> Vec<u8> {
    match resolution {
        PluginResolution::Path(path) => path,
        PluginResolution::NotHandled | PluginResolution::External { .. } => {
            panic!("expected PluginResolution::Path")
        }
    }
}

fn text(read: ModuleText) -> Vec<u8> {
    match read {
        ModuleText::Text(text) => text.into_owned(),
        ModuleText::Deferred | ModuleText::Missing | ModuleText::Failed => {
            panic!("expected ModuleText::Text")
        }
    }
}

#[test]
fn resolve_calls_provider_once_per_request() {
    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    for _ in 0..2 {
        let resolution = plugins.resolve(&request(b"./a", b"/p/main.ts"));
        assert!(matches!(resolution, PluginResolution::NotHandled));
    }
    assert_eq!(provider.resolve_count.load(Relaxed), 1);

    plugins.resolve(&request(b"./a", b"/p/other.ts"));
    assert_eq!(provider.resolve_count.load(Relaxed), 2);

    let required = CodeRequest {
        kind: CodeImportKind::Require,
        ..request(b"./a", b"/p/main.ts")
    };
    plugins.resolve(&required);
    assert_eq!(provider.resolve_count.load(Relaxed), 3);

    let dynamic = CodeRequest {
        form: CodeImportForm::Dynamic,
        ..request(b"./a", b"/p/main.ts")
    };
    plugins.resolve(&dynamic);
    assert_eq!(provider.resolve_count.load(Relaxed), 4);
}

#[test]
fn plugins_are_told_how_an_import_is_written() {
    use CodeImportForm::{Dynamic, Macro, ResolveOnly, Static};
    use CodeImportKind::{EntryPoint, Import, Require};
    let told = [
        (EntryPoint, Static, ImportKind::EntryPointBuild),
        (Import, Static, ImportKind::Stmt),
        (Import, Dynamic, ImportKind::Dynamic),
        (Import, ResolveOnly, ImportKind::RequireResolve),
        (Import, Macro, ImportKind::Stmt),
        (Require, Static, ImportKind::Require),
        (Require, ResolveOnly, ImportKind::RequireResolve),
    ];
    for (kind, form, expected) in told {
        assert_eq!(import_kind(kind, form), expected, "{kind:?} {form:?}");
    }
}

#[test]
fn imports_of_virtual_module_start_in_directory_of_its_path() {
    let provider = TestProvider {
        resolve_answer: |request| module(b"v", request.specifier),
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let directories: [(&[u8], &[u8]); 3] = [
        (b"name", b"/work"),
        (b"nested/name", b"/work/nested"),
        (b"/elsewhere/made-up/name", b"/elsewhere/made-up"),
    ];
    for (plugin_path, directory) in directories {
        let path = resolved_path(plugins.resolve(&request(plugin_path, b"/p/main.ts")));
        let found = plugins.directory_of_virtual_module(&path, b"/work");
        assert_eq!(
            found.as_deref(),
            Some(directory),
            "{}",
            BStr::new(plugin_path)
        );
    }
    let actual = plugins.directory_of_virtual_module(b"/p/main.ts", b"/work");
    assert_eq!(actual, None);
}

#[test]
fn resolve_sends_kind_and_file_importer() {
    let provider = TestProvider {
        resolve_answer: |request| {
            assert_eq!(request.kind, ImportKind::EntryPointBuild);
            assert_eq!(request.importer.namespace, b"file");
            assert_eq!(request.importer.path, b"");
            Ok(Resolution::NotHandled)
        },
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    plugins.resolve(&CodeRequest {
        kind: CodeImportKind::EntryPoint,
        ..request(b"./main.ts", b"")
    });
    assert_eq!(provider.resolve_count.load(Relaxed), 1);
}

#[test]
fn virtual_paths_keep_modules_apart() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    let upper = resolved_path(plugins.resolve(&request(b"virtual:Config", b"/p/a.ts")));
    let lower = resolved_path(plugins.resolve(&request(b"virtual:config", b"/p/a.ts")));
    assert_ne!(upper, lower);
    for path in [&upper, &lower] {
        assert!(path.starts_with(HOST_ROOT));
        assert!(!path.iter().any(u8::is_ascii_uppercase));
        assert!(!bun_core::strings::contains_char(path, b':'));
        assert!(!bun_core::strings::contains_char(path, b'\\'));
    }
    let expected = Some((&b"v"[..], &b"virtual:Config"[..]));
    assert_eq!(plugins.virtual_module(&upper), expected);
    let expected = Some((&b"v"[..], &b"virtual:config"[..]));
    assert_eq!(plugins.virtual_module(&lower), expected);
    assert_eq!(plugins.provider_path(&upper), b"virtual:Config");
    assert_eq!(plugins.virtual_module(b"/p/other.ts"), None);
    assert_eq!(plugins.virtual_module(b"/$bun/plugin/v/unknown"), None);
}

#[test]
fn virtual_path_keeps_extension_and_namespace_boundary() {
    let path = create_virtual_path(b"v", b"dir/Name.ts");
    assert_eq!(path, b"/$bun/plugin/v/dir/%4eame.ts");
    assert_ne!(
        create_virtual_path(b"a/b", b"c"),
        create_virtual_path(b"a", b"b/c")
    );
    assert_ne!(
        create_virtual_path(b"v", b"%41"),
        create_virtual_path(b"v", b"A")
    );
}

#[test]
fn virtual_path_is_normalized() {
    let path = create_virtual_path(b"..", b"./a/../b//");
    assert_eq!(path, b"/$bun/plugin/%2e%2e/%2e/a/%2e%2e/b/%2f/%2f");
    assert_eq!(create_virtual_path(b"v", b"/a"), b"/$bun/plugin/v/%2f/a");
    assert_ne!(
        create_virtual_path(b"v", b"a/b"),
        create_virtual_path(b"v", b"a//b")
    );
    assert_ne!(
        create_virtual_path(b"v", b"a/%2f/b"),
        create_virtual_path(b"v", b"a//b")
    );
}

#[test]
fn resolve_answers_without_virtual_path() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    for specifier in [&b"on-disk"[..], b"no-namespace"] {
        let path = resolved_path(plugins.resolve(&request(specifier, b"/p/a.ts")));
        assert_eq!(path, b"/p/other.ts");
        assert_eq!(plugins.virtual_module(&path), None);
    }
    let PluginResolution::External { specifier } =
        plugins.resolve(&request(b"external", b"/p/a.ts"))
    else {
        panic!("expected PluginResolution::External");
    };
    assert_eq!(specifier, b"elsewhere");
    let failed = plugins.resolve(&request(b"failed", b"/p/a.ts"));
    assert!(matches!(failed, PluginResolution::NotHandled));
}

#[test]
fn plugin_module_is_loaded_once() {
    let provider = TestProvider {
        load_answer: |_, _| Ok(plugin_source(b"{}")),
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let path = b"/project/a.data";

    assert!(plugins.loaded(path).is_none());
    assert_eq!(text(plugins.read(path, Loader::File)), b"{}");
    assert_eq!(text(plugins.read(path, Loader::Text)), b"{}");
    assert_eq!(provider.load_count.load(Relaxed), 1);

    let loaded = plugins.loaded(path).unwrap();
    assert_eq!(loaded.loader, Loader::Json);
    assert!(loaded.is_from_plugin);
}

#[test]
fn plain_file_is_read_again() {
    let provider = TestProvider::default();
    let path = b"/project/a.ts";
    let (disk, messages) = (disk_with_file(path, b"let a"), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    assert_eq!(text(plugins.read(path, Loader::Ts)), b"let a");
    assert_eq!(text(plugins.read(path, Loader::Ts)), b"let a");
    assert_eq!(provider.load_count.load(Relaxed), 1);

    let loaded = plugins.loaded(path).unwrap();
    assert_eq!(loaded.loader, Loader::Ts);
    assert!(!loaded.is_from_plugin);
}

#[test]
fn plain_file_gone_on_later_read_is_missing() {
    let provider = TestProvider {
        load_answer: |request, _| {
            Ok(Loaded::Source {
                contents: Cow::Borrowed(b"let a"),
                loader: request.default_loader,
                is_from_plugin: false,
            })
        },
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let path = b"/project/gone.ts";

    assert_eq!(text(plugins.read(path, Loader::Ts)), b"let a");
    assert!(matches!(
        plugins.read(path, Loader::Ts),
        ModuleText::Missing
    ));
    assert_eq!(provider.load_count.load(Relaxed), 1);
}

#[test]
fn virtual_module_is_loaded_by_plugin_name_without_file() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        load_answer: |request, _| {
            assert_eq!(request.module.namespace, b"v");
            assert_eq!(request.module.path, b"virtual:Config");
            assert!((request.read_file)().is_none());
            Ok(plugin_source(b"{}"))
        },
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    let path = resolved_path(plugins.resolve(&request(b"virtual:Config", b"/p/a.ts")));
    assert_eq!(text(plugins.read(&path, Loader::Js)), b"{}");
}

#[test]
fn load_plugin_question_names_the_plugin_module() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        has_load_plugin_answer: |module| {
            (module.namespace, module.path) == (&b"v"[..], &b"virtual:Config"[..])
        },
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    let path = resolved_path(plugins.resolve(&request(b"virtual:Config", b"/p/a.ts")));
    assert!(plugins.has_load_plugin(&path));
    assert!(!plugins.has_load_plugin(b"/p/a.ts"));
    assert_eq!(provider.load_count.load(Relaxed), 0);
}

#[test]
fn missing_and_failed_modules() {
    let provider = TestProvider {
        load_answer: |request, log| match request.module.path {
            b"/project/missing.ts" => Ok(Loaded::NotFound),
            _ => {
                log.add_error_fmt(None, Loc::EMPTY, format_args!("the plugin failed"));
                Err(Failed)
            }
        },
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    for _ in 0..2 {
        let missing = plugins.read(b"/project/missing.ts", Loader::Ts);
        assert!(matches!(missing, ModuleText::Missing));
        let failed = plugins.read(b"/project/failed.ts", Loader::Ts);
        assert!(matches!(failed, ModuleText::Failed));
    }
    assert_eq!(provider.load_count.load(Relaxed), 2);
    assert!(plugins.loaded(b"/project/missing.ts").is_none());
    assert!(plugins.loaded(b"/project/failed.ts").is_none());

    assert_eq!(take_messages(&messages), [b"the plugin failed"]);
}

#[test]
#[allow(clippy::disallowed_methods)]
fn raw_loader_keeps_byte_order_mark() {
    let name = format!("bun_aot_plugin_modules_{}", std::process::id());
    let file = std::env::temp_dir().join(name);
    let utf16_text = [0xFF, 0xFE, b'a', 0];
    std::fs::write(&file, utf16_text).unwrap();
    let path = from_native(file.as_os_str().as_encoded_bytes());

    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let raw = text(plugins.read(&path, Loader::File));
    let decoded = text(plugins.read(&path, Loader::Text));
    std::fs::remove_file(&file).unwrap();

    assert_eq!(raw, utf16_text);
    assert_eq!(decoded, b"a");
}

#[test]
fn raw_loader_reads_in_memory_file() {
    let bytes = vec![0xFF, 0xFE, b'a', 0];
    let in_memory_files = [
        (b"/project/a.bin".to_vec(), bytes.clone()),
        (b"/project/b.bin".to_vec(), vec![1]),
    ];
    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &in_memory_files);

    assert_eq!(text(plugins.read(b"/project/a.bin", Loader::File)), bytes);
    let missing = plugins.read(b"/project/c.bin", Loader::File);
    assert!(matches!(missing, ModuleText::Missing));
}

#[test]
fn in_memory_file_is_found_by_host_path() {
    let in_memory_files = [
        (b"/project/z.bin".to_vec(), vec![1]),
        (b"/project/x/../a.bin".to_vec(), vec![2]),
        (b"/project//b.bin".to_vec(), vec![3]),
    ];
    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &in_memory_files);

    assert_eq!(text(plugins.read(b"/project/z.bin", Loader::File)), [1]);
    assert_eq!(text(plugins.read(b"/project/a.bin", Loader::File)), [2]);
    assert_eq!(text(plugins.read(b"/project/b.bin", Loader::File)), [3]);
}

#[test]
fn in_memory_file_name_case_follows_disk() {
    let in_memory_files = [(b"/project/a.bin".to_vec(), vec![1])];
    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &in_memory_files);

    let read = plugins.read(b"/project/A.bin", Loader::File);
    let expected = !disk.is_case_sensitive();
    assert_eq!(matches!(read, ModuleText::Text(_)), expected);
}

#[test]
fn deferred_module_gets_text_once() {
    let path = b"/project/a.ts";
    let provider = deferring_provider(vec![answer_for_file(path, Ok(plugin_source(b"late")))]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    for _ in 0..2 {
        let read = plugins.read(path, Loader::Ts);
        assert!(matches!(read, ModuleText::Deferred));
    }
    assert_eq!(provider.load_count.load(Relaxed), 1);
    assert!(plugins.loaded(path).is_none());

    let reads = plugins.finish_deferred_reads();
    assert_eq!(reads.texts.len(), 1);
    assert_eq!(reads.texts[0].0, path);
    assert_eq!(&*reads.texts[0].1, b"late");
    assert!(reads.missing.is_empty());

    assert_eq!(text(plugins.read(path, Loader::Ts)), b"late");
    assert_eq!(plugins.loaded(path).unwrap().loader, Loader::Json);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty() && reads.missing.is_empty());
    assert_eq!(provider.finish_count.load(Relaxed), 1);
    assert!(take_messages(&messages).is_empty());
}

#[test]
fn deferred_virtual_module_is_answered_by_plugin_name() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        load_answer: |_, _| Ok(Loaded::Deferred),
        ..TestProvider::default()
    };
    *provider.deferred_answers.lock() = vec![
        answer_for_file(b"virtual:Config", Ok(plugin_source(b"file"))),
        DeferredLoad {
            namespace: b"v".to_vec(),
            path: b"virtual:Config".to_vec(),
            answer: Ok(plugin_source(b"virtual")),
        },
    ];
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let path = resolved_path(plugins.resolve(&request(b"virtual:Config", b"/p/a.ts")));
    let read = plugins.read(&path, Loader::Js);
    assert!(matches!(read, ModuleText::Deferred));

    let reads = plugins.finish_deferred_reads();
    assert_eq!(reads.texts.len(), 1);
    assert_eq!(reads.texts[0].0, path);
    assert_eq!(&*reads.texts[0].1, b"virtual");
    assert!(take_messages(&messages).is_empty());
}

#[test]
fn deferred_answers_are_sorted_by_host_path() {
    let provider = deferring_provider(vec![
        answer_for_file(b"/p/d.ts", Ok(Loaded::NotFound)),
        answer_for_file(b"/p/b.ts", Ok(plugin_source(b"b"))),
        answer_for_file(b"/p/c.ts", Ok(Loaded::NotFound)),
        answer_for_file(b"/p/a.ts", Ok(plugin_source(b"a"))),
    ]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    for path in [b"/p/a.ts", b"/p/b.ts", b"/p/c.ts", b"/p/d.ts"] {
        plugins.read(path, Loader::Ts);
    }

    let reads = plugins.finish_deferred_reads();
    let text_paths: Vec<&[u8]> = reads.texts.iter().map(|(path, _)| &path[..]).collect();
    assert_eq!(text_paths, [b"/p/a.ts", b"/p/b.ts"]);
    assert_eq!(reads.missing, [b"/p/c.ts", b"/p/d.ts"]);
}

#[test]
fn deferred_not_found_is_missing() {
    let path = b"/project/a.ts";
    let provider = deferring_provider(vec![answer_for_file(path, Ok(Loaded::NotFound))]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    plugins.read(path, Loader::Ts);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty());
    assert_eq!(reads.missing, [path]);
    assert!(matches!(plugins.read(path, Loader::Ts), ModuleText::Failed));
    assert!(plugins.loaded(path).is_none());
    assert!(take_messages(&messages).is_empty());
}

#[test]
fn deferred_failure_is_failed() {
    let (failed_path, deferred_path) = (b"/project/a.ts", b"/project/b.ts");
    let provider = deferring_provider(vec![
        answer_for_file(failed_path, Err(Failed)),
        answer_for_file(deferred_path, Ok(Loaded::Deferred)),
    ]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    plugins.read(failed_path, Loader::Ts);
    plugins.read(deferred_path, Loader::Ts);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty() && reads.missing.is_empty());
    for path in [failed_path, deferred_path] {
        assert!(matches!(plugins.read(path, Loader::Ts), ModuleText::Failed));
        assert!(plugins.loaded(path).is_none());
    }
    let reported = take_messages(&messages);
    assert_eq!(reported.len(), 1);
    assert!(reported[0].ends_with(b"a deferred load was never answered: file:/project/b.ts"));
}

#[test]
fn repeated_deferred_answer_counts_once() {
    let path = b"/project/a.ts";
    let provider = deferring_provider(vec![
        answer_for_file(path, Ok(plugin_source(b"first"))),
        answer_for_file(path, Ok(plugin_source(b"second"))),
    ]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    plugins.read(path, Loader::Ts);

    let reads = plugins.finish_deferred_reads();
    assert_eq!(reads.texts.len(), 1);
    assert_eq!(&*reads.texts[0].1, b"first");
    assert_eq!(text(plugins.read(path, Loader::Ts)), b"first");
}

#[test]
fn answer_without_deferred_module_changes_nothing() {
    let (path, other_path) = (b"/project/a.ts", b"/project/other.ts");
    let provider = deferring_provider(vec![answer_for_file(other_path, Ok(plugin_source(b"x")))]);
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    plugins.read(path, Loader::Ts);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty() && reads.missing.is_empty());
    assert!(plugins.loaded(other_path).is_none());
    assert!(matches!(plugins.read(path, Loader::Ts), ModuleText::Failed));
}

#[test]
fn unanswered_deferred_load_is_an_internal_error() {
    let provider = TestProvider {
        resolve_answer: resolve_specifier_in_namespace,
        load_answer: |_, _| Ok(Loaded::Deferred),
        ..TestProvider::default()
    };
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);
    let path = resolved_path(plugins.resolve(&request(b"virtual:Config", b"/p/a.ts")));
    plugins.read(&path, Loader::Js);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty() && reads.missing.is_empty());
    let reported = take_messages(&messages);
    assert_eq!(reported.len(), 1);
    assert!(reported[0].ends_with(b"a deferred load was never answered: v:virtual:Config"));

    plugins.finish_deferred_reads();
    assert!(take_messages(&messages).is_empty());
}

#[test]
fn no_deferred_module_skips_provider() {
    let provider = TestProvider::default();
    let (disk, messages) = (empty_disk(), LoadMessages::default());
    let plugins = PluginModules::new(&provider, &disk, &messages, &[]);

    let reads = plugins.finish_deferred_reads();
    assert!(reads.texts.is_empty() && reads.missing.is_empty());
    assert_eq!(provider.finish_count.load(Relaxed), 0);
}
