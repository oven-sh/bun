use bun_ast::{Loc, Log};
use bun_builtin_sources::Archive;
use bun_options_types::aot_options::AotOptions;
use bun_sema::fold::FoldOptions;
use bun_sema::hir::FileKind;
use bun_sema::hir_from_data::DataModule;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{CodeOptions, ParseOptions, TranspileSettings};
use bun_sema::session::Session;

use super::*;
use crate::builtins::{
    BuiltinId, BuiltinPath, EvaluatedText, EvaluatedTextForm, Mutability, RuntimeModule,
};
use crate::compile::testing::{TemporaryDirectory, default_settings, lower_program_with_provider};
use crate::diagnostics::Diagnostics;
use crate::engine::ExecutableIdentity;
use crate::load::host_platform;
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest,
    WithoutServices,
};
use crate::options::{LoadOptions, PathOptions, RemovableOptions};
use crate::statistics::LimitValues;

const MAIN: &[u8] = b"/project/main.ts";
const TEMPLATE: &[u8] = b"/project/hello.tmpl";
const DATA: &[u8] = b"/project/a.data";
const NEVER_LOADED: &[u8] = b"/project/never.ts";
const DEFERRED_TEMPLATE: &[u8] = b"/project/deferred.tmpl";
const WITHOUT_PLUGIN: &[u8] = b"/project/without-plugin.vue";
const CLAIMED: &[u8] = b"/project/claimed.ts";
const VIRTUAL_CONFIG: &[u8] = b"config";
const VIRTUAL_DATA: &[u8] = b"data";
const TYPESCRIPT_TEXT: &[u8] = b"export const n: number = 1;";
const ERASED: &[u8] = b"/project/erased.tsx";
const ERASED_TEXT: &[u8] = b"export const n = 1;";

#[derive(Default)]
struct ScriptedProvider {
    calls: Guarded<Vec<String>>,
}

impl ScriptedProvider {
    fn record_call(&self, method: &str, name: &[u8]) {
        let call = format!("{method} {}", BStr::new(name));
        self.calls.lock().push(call);
    }
}

impl SourceProvider for ScriptedProvider {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, _log: &mut Log) -> Result<Resolution, Failed> {
        self.record_call("resolve", request.specifier);
        let module = |namespace: &[u8], path: &[u8]| Resolution::Module {
            namespace: namespace.to_vec(),
            path: path.to_vec(),
        };
        Ok(match request.specifier {
            b"fs" | b"./lib" | b"claimed-package" => module(b"file", CLAIMED),
            b"virtual:config" => module(b"v", VIRTUAL_CONFIG),
            b"virtual:data" => module(b"v", VIRTUAL_DATA),
            b"./outside" | b"outside.ts" => Resolution::External {
                specifier: b"renamed-outside".to_vec(),
            },
            _ => Resolution::NotHandled,
        })
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        self.record_call("load", request.module.path);
        let (text, loader): (&'static [u8], Loader) = match request.module.path {
            TEMPLATE | VIRTUAL_CONFIG => (TYPESCRIPT_TEXT, Loader::Ts),
            DATA | VIRTUAL_DATA => (b"{\"a\":1}", Loader::Json),
            ERASED | b"/project/erased.js" => (ERASED_TEXT, Loader::Js),
            NEVER_LOADED | DEFERRED_TEMPLATE => return Ok(Loaded::Deferred),
            b"/project/failed.ts" => {
                log.add_error_fmt(None, Loc::EMPTY, format_args!("the plugin failed"));
                return Err(Failed);
            }
            _ => return WithoutServices.load(request, log),
        };
        Ok(Loaded::Source {
            contents: Cow::Borrowed(text),
            loader,
            is_from_plugin: true,
        })
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        module.path != WITHOUT_PLUGIN
    }

    fn finish_deferred_loads(&self, _log: &mut Log) -> Vec<DeferredLoad> {
        let template = Loaded::Source {
            contents: Cow::Borrowed(TYPESCRIPT_TEXT),
            loader: Loader::Ts,
            is_from_plugin: true,
        };
        let answers = [
            (NEVER_LOADED, Loaded::NotFound),
            (DEFERRED_TEMPLATE, template),
        ];
        answers
            .into_iter()
            .map(|(path, answer)| DeferredLoad {
                namespace: b"file".to_vec(),
                path: path.to_vec(),
                answer: Ok(answer),
            })
            .collect()
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, Failed> {
        self.record_call("parse_data", file.path);
        WithoutServices.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

struct Fixture<'f, 's> {
    host: &'f LoadHost<'f>,
    provider: &'f ScriptedProvider,
    session: &'s Session,
    atoms: Interner<'s>,
    messages: &'f LoadMessages,
}

impl<'s> Fixture<'_, 's> {
    fn resolve(&self, specifier: &[u8], importer: &[u8]) -> HostResolution {
        self.host.resolve_code(&CodeRequest {
            specifier,
            importer,
            directory: b"/project",
            kind: match importer.is_empty() {
                true => CodeImportKind::EntryPoint,
                false => CodeImportKind::Import,
            },
            form: CodeImportForm::Static,
        })
    }

    fn resolve_to_path(&self, specifier: &[u8]) -> Vec<u8> {
        match self.resolve(specifier, MAIN) {
            HostResolution::Path(path) => path,
            other => panic!("expected a path, got {other:?}"),
        }
    }

    fn parse(&self, path: &[u8], loader: HostLoader) -> ParsedCode<'s> {
        let settings = default_settings();
        let request = CodeParseRequest {
            path,
            loader,
            options: ParseOptions::default(),
            reads_jsdoc: true,
            settings: &settings,
            declared_module_type: DeclaredModuleType::Unknown,
        };
        let (arena, text) = (self.session.arena(), self.read_code(path));
        self.host.parse_code(arena, &request, &text, &self.atoms)
    }

    fn read_code(&self, path: &[u8]) -> Cow<'static, [u8]> {
        match self.host.read_code(path) {
            CodeRead::Text(text) => text,
            CodeRead::Deferred => Cow::default(),
        }
    }

    fn take_calls(&self) -> Vec<String> {
        std::mem::take(&mut *self.provider.calls.lock())
    }

    fn take_messages(&self) -> Vec<Vec<u8>> {
        take_messages(self.messages)
    }
}

pub(crate) fn take_messages(messages: &LoadMessages) -> Vec<Vec<u8>> {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(messages);
    let mut log = Log::init();
    diagnostics.write_to(&mut log);
    let messages = log.msgs.iter();
    messages.map(|message| message.data.text.to_vec()).collect()
}

fn with_host<R>(files: &[(&str, &str)], then: impl FnOnce(&Fixture<'_, '_>) -> R) -> R {
    let in_memory_file = |(name, text): &(&str, &str)| {
        let path = format!("/project/{name}").into_bytes();
        (path, text.as_bytes().to_vec())
    };
    let mut in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = files.iter().map(in_memory_file).collect();
    in_memory_files.sort_unstable();
    with_host_under(AotOptions::default(), b"/project", in_memory_files, then)
}

fn with_host_under<R>(
    aot: AotOptions,
    root: &[u8],
    in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    then: impl FnOnce(&Fixture<'_, '_>) -> R,
) -> R {
    let mut load = LoadOptions::new(root.to_vec());
    load.in_memory_files = in_memory_files;
    load.externals.packages = vec![b"claimed-package".to_vec(), b"react".to_vec()];
    load.loaders.push((b".vue".to_vec(), Loader::Tsx));
    load.loaders.sort_by(|a, b| a.0.cmp(&b.0));
    let entry_points = [&b"main.ts"[..], b"tool", b"with.dots.in-its-name"].map(<[u8]>::to_vec);
    let options = Options {
        aot: &aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        entry_points: entry_points.to_vec(),
        code: CodeOptions::bun_run(&from_native(root)),
        typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
        load,
        paths: PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: root.to_vec(),
            entry_point_names: entry_points.to_vec(),
        },
        removable: RemovableOptions::default(),
        lists_modules: false,
        minifies_identifiers: false,
    };
    let provider = ScriptedProvider::default();
    let disk = create_disk(&options, NonZeroUsize::MIN);
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let builtin_names = BuiltinNames::new(&atoms);
    let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
    let messages = LoadMessages::default();
    let limits = LimitValues::for_host();
    let host = LoadHost::new(LoadHostInput {
        disk: &disk,
        provider: &provider,
        options: &options,
        runtime_modules: &runtime_modules,
        messages: &messages,
        builtin_names: &builtin_names,
        platform: host_platform(),
        limits: &limits,
    });
    then(&Fixture {
        host: &host,
        provider: &provider,
        session: &session,
        atoms,
        messages: &messages,
    })
}

fn loader_request<'a>(path: &'a [u8], settings: &'a TranspileSettings) -> LoaderRequest<'a> {
    LoaderRequest {
        path,
        kind: CodeImportKind::Import,
        type_attribute: None,
        embed_attribute: None,
        settings,
        declared_module_type: DeclaredModuleType::Unknown,
    }
}

fn loader_of(host: &LoadHost<'_>, path: &[u8], type_attribute: Option<&[u8]>) -> HostLoader {
    host.loader_of(&LoaderRequest {
        type_attribute,
        ..loader_request(path, &default_settings())
    })
}

pub(crate) fn payload_of<'p>(parsed: &'p ParsedCode<'_>) -> &'p ParsedSource {
    let payload = parsed
        .payload
        .as_ref()
        .expect("parse_code gives every tree a payload");
    let source = payload.downcast_ref::<ParsedSource>();
    source.expect("the payload of a tree is a ParsedSource")
}

fn uncompiled_code(specifier: &[u8]) -> HostResolution {
    HostResolution::External {
        specifier: specifier.to_vec(),
        kind: ExternalKind::UncompiledCode,
    }
}

fn module_by_id(module: RuntimeModule) -> HostResolution {
    HostResolution::Module(HostModuleId(module.registry_id()))
}

#[test]
fn resolve_code_takes_first_claim() {
    with_host(&[], |fixture| {
        let unclaimed = HostResolution::Unclaimed;
        assert_eq!(fixture.resolve(b"bun:bundle", MAIN), HostResolution::Erased);
        let expected = module_by_id(RuntimeModule::NodeFs);
        assert_eq!(fixture.resolve(b"fs", MAIN), expected);
        assert!(fixture.take_calls().is_empty());

        let claimed = HostResolution::Path(CLAIMED.to_vec());
        assert_eq!(fixture.resolve(b"./lib", MAIN), claimed);
        assert_eq!(fixture.resolve(b"claimed-package", MAIN), claimed);
        let expected = uncompiled_code(b"renamed-outside");
        assert_eq!(fixture.resolve(b"./outside", MAIN), expected);
        assert_eq!(fixture.resolve(b"react", MAIN), uncompiled_code(b"react"));
        assert_eq!(fixture.resolve(b"react", b""), unclaimed);
        assert_eq!(fixture.resolve(b"./nothing", MAIN), unclaimed);
        assert_eq!(fixture.take_calls().len(), 6);
    });
}

#[test]
fn entry_point_is_never_a_builtin_module() {
    with_host(&[], |fixture| {
        let unclaimed = HostResolution::Unclaimed;
        let builtin_modules: [&[u8]; 4] = [b"util", b"node:fs", b"bun", b"bun:wrap"];
        for name in builtin_modules {
            assert_eq!(fixture.resolve(name, b""), unclaimed, "{}", BStr::new(name));
            let runtime_module = fixture.host.resolve_runtime_module(name);
            assert_ne!(runtime_module, unclaimed, "{}", BStr::new(name));
        }
        assert_eq!(fixture.resolve(b"bun:bundle", b""), unclaimed);
        let claimed = HostResolution::Path(CLAIMED.to_vec());
        assert_eq!(fixture.resolve(b"fs", b""), claimed);
        assert_eq!(fixture.take_calls().len(), 6);
    });
}

#[test]
fn bun_module_is_answered_by_id() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let fs = module_by_id(RuntimeModule::NodeFs);
        for specifier in [&b"fs"[..], b"node:fs"] {
            assert_eq!(fixture.resolve(specifier, MAIN), fs);
            assert_eq!(host.resolve_runtime_module(specifier), fs);
            let required = host.resolve_code(&CodeRequest {
                specifier,
                importer: MAIN,
                directory: b"/project",
                kind: CodeImportKind::Require,
                form: CodeImportForm::Static,
            });
            assert_eq!(required, fs);
        }
        let native_module = module_by_id(RuntimeModule::BunJsc);
        assert_eq!(fixture.resolve(b"bun:jsc", MAIN), native_module);
    });
}

#[test]
fn runtime_module_resolution_asks_no_plugin() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let expected = module_by_id(RuntimeModule::NodeFs);
        assert_eq!(host.resolve_runtime_module(b"fs"), expected);
        let other_specifiers: [&[u8]; 5] = [
            b"./lib",
            b"virtual:config",
            b"./outside",
            b"react",
            b"bun:bundle",
        ];
        for specifier in other_specifiers {
            let resolution = host.resolve_runtime_module(specifier);
            let name = BStr::new(specifier);
            assert_eq!(resolution, HostResolution::Unclaimed, "{name}");
        }
        assert!(fixture.take_calls().is_empty());
    });
}

#[test]
fn alias_without_id_is_host_value() {
    with_host(&[], |fixture| {
        let host_value = HostResolution::External {
            specifier: b"bun:main".to_vec(),
            kind: ExternalKind::HostValue,
        };
        assert_eq!(fixture.resolve(b"bun:main", MAIN), host_value);
        assert_eq!(fixture.host.resolve_runtime_module(b"bun:main"), host_value);
        assert!(fixture.take_calls().is_empty());
    });
}

#[test]
fn internal_module_is_not_visible_to_the_application() {
    with_host(&[], |fixture| {
        let unclaimed = HostResolution::Unclaimed;
        for specifier in [&b"internal/primordials"[..], b"internal/validators"] {
            assert_eq!(fixture.resolve(specifier, MAIN), unclaimed);
            let actual = fixture.resolve(specifier, b"/$bun/js/node/fs.ts");
            assert_eq!(actual, unclaimed);
            assert_eq!(fixture.host.resolve_runtime_module(specifier), unclaimed);
        }
    });
}

#[test]
fn computed_prefix_finds_both_spellings() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let fs = module_by_id(RuntimeModule::NodeFs);
        assert!(host.find_runtime_modules(b"node:f", b"").contains(&fs));
        assert!(host.find_runtime_modules(b"f", b"s").contains(&fs));
        assert_eq!(host.find_runtime_modules(b"node:", b"fs"), [fs]);
        let node_modules = host.find_runtime_modules(b"node:", b"");
        let is_id = |resolution: &HostResolution| matches!(resolution, HostResolution::Module(_));
        assert!(!node_modules.is_empty() && node_modules.iter().all(is_id));
        assert!(host.find_runtime_modules(b"", b"").is_empty());
        assert!(host.find_runtime_modules(b"internal/", b"").is_empty());
        let primordials = host.find_runtime_modules(b"internal/primordials", b"");
        assert!(primordials.is_empty());
        assert!(host.find_runtime_modules(b"./", b"").is_empty());
    });
}

#[test]
fn external_flag_is_uncompiled_code() {
    with_host(&[], |fixture| {
        assert_eq!(fixture.resolve(b"react", MAIN), uncompiled_code(b"react"));
        let subpath = b"react/jsx-runtime";
        assert_eq!(fixture.resolve(subpath, MAIN), uncompiled_code(subpath));
        assert_eq!(fixture.resolve(b"preact", MAIN), HostResolution::Unclaimed);
    });
}

#[test]
fn plugin_external_is_uncompiled_code() {
    with_host(&[], |fixture| {
        let expected = uncompiled_code(b"renamed-outside");
        assert_eq!(fixture.resolve(b"./outside", MAIN), expected);
        assert_eq!(fixture.resolve(b"./outside", b""), expected);
        let expected = ["resolve ./outside", "resolve ./outside"];
        assert_eq!(fixture.take_calls(), expected);
    });
}

#[test]
#[should_panic(expected = "The entry point \"outside.ts\" cannot be marked as external")]
fn external_entry_point_stops_build() {
    let files = [("outside.ts", "export {};")];
    lower_program_with_provider(&files, &default_settings(), &ScriptedProvider::default());
}

#[test]
fn loader_follows_attribute_options_and_entry_points() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let (by_name, named) = (HostLoaderKind::ByName, HostLoaderKind::Loader);
        let cases: [(&[u8], Option<&[u8]>, HostLoaderKind); 10] = [
            (b"/project/a.ts", None, by_name),
            (b"/project/a.ts", Some(b""), by_name),
            (b"/project/a.txt", Some(b"text"), by_name),
            (b"/project/a.ts", Some(b"text"), named(Loader::Text)),
            (b"/project/a.ts", Some(b"json"), named(Loader::Json)),
            (b"/project/a.ts", Some(b"no-such-loader"), by_name),
            (b"/project/tool", None, by_name),
            (b"/project/with.dots.in-its-name", None, named(Loader::Tsx)),
            (b"/project/other.in-its-name", None, by_name),
            (b"/project/a.vue", None, named(Loader::Tsx)),
        ];
        for (path, type_attribute, kind) in cases {
            let loader = loader_of(host, path, type_attribute);
            assert_eq!(host_loader_kind(loader), Some(kind), "{}", BStr::new(path));
        }
        assert_eq!(host.script_kind(b"/project/tool"), Some(ScriptKind::Tsx));
        let extra_extensions = [(b".vue".to_vec(), ScriptKind::Tsx)];
        assert_eq!(host.extra_file_extensions(), extra_extensions);
        assert!(fixture.take_messages().is_empty());

        let macro_loader = loader_of(host, b"/project/m.ts", Some(b"macro"));
        assert_eq!(macro_loader, BY_NAME);
        let messages = fixture.take_messages();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].ends_with(b"a macro import was followed as code: /project/m.ts"));
    });
}

#[test]
fn type_attributes_are_classified() {
    with_host(&[], |fixture| {
        let classify = |type_attribute: Option<&[u8]>| {
            let loader = loader_of(fixture.host, b"/project/a.ts", type_attribute);
            (host_loader_kind(loader), fixture.take_messages().len())
        };
        let (by_name, named) = (HostLoaderKind::ByName, HostLoaderKind::Loader);
        assert_eq!(classify(None), (Some(by_name), 0));
        assert_eq!(classify(Some(b"macro")), (Some(by_name), 1));
        assert_eq!(classify(Some(b"text")), (Some(named(Loader::Text)), 0));
        assert_eq!(classify(Some(b"json")), (Some(named(Loader::Json)), 0));
        assert_eq!(classify(Some(b"nonsense")), (Some(by_name), 0));
        assert_eq!(classify(Some(b"")), (Some(by_name), 0));
    });
}

#[test]
fn required_file_without_loader_is_carried_like_an_imported_one() {
    with_host(&[], |fixture| {
        let settings = default_settings();
        let kind_for = |path: &[u8], kind: CodeImportKind| {
            let loader = fixture.host.loader_of(&LoaderRequest {
                kind,
                ..loader_request(path, &settings)
            });
            host_loader_kind(loader)
        };
        let by_name = Some(HostLoaderKind::ByName);
        let path = b"/project/other.in-its-name";
        assert_eq!(loader_by_name(path), Loader::File);
        assert_eq!(kind_for(path, CodeImportKind::Require), by_name);
        assert_eq!(kind_for(path, CodeImportKind::Import), by_name);
        let actual = kind_for(b"/project/a.txt", CodeImportKind::Require);
        assert_eq!(actual, by_name);
    });
}

const TEXTS_THAT_ONLY_THEIR_LOAD_CALLS_PROGRAMS: [(&[u8], &[u8]); 4] = [
    (b"/project/library.so", b"\x7fELF\x02\x01"),
    (b"/project/program.so", b"module.exports = 1;"),
    (b"/project/prose", b"first();\nthis is no program"),
    (b"/project/wrong.ts", b"this is no program"),
];

fn with_texts_that_only_their_load_calls_programs(
    runs_in_place: bool,
    then: impl FnOnce(&Fixture<'_, '_>),
) {
    let aot = AotOptions {
        runs_in_place,
        ..AotOptions::default()
    };
    let files = TEXTS_THAT_ONLY_THEIR_LOAD_CALLS_PROGRAMS
        .map(|(path, text)| (path.to_vec(), text.to_vec()))
        .to_vec();
    with_host_under(aot, b"/project", files, then);
}

fn parse_as_required<'s>(fixture: &Fixture<'_, 's>, path: &[u8]) -> ParsedCode<'s> {
    fixture.parse(path, to_host_loader(Loader::Ts, path))
}

#[test]
fn empty_module_stands_in_place_of_text_that_is_no_program_where_code_runs_in_place() {
    with_texts_that_only_their_load_calls_programs(true, |fixture| {
        let failure_of = |path: &[u8]| {
            let parsed = parse_as_required(fixture, path);
            payload_of(&parsed).parse_failure.clone()
        };
        let said = |text: &str| Some(text.as_bytes().to_vec());
        let actual = failure_of(b"/project/library.so");
        assert_eq!(actual, said("Invalid character. (1:1)"));
        assert_eq!(failure_of(b"/project/prose"), said("';' expected. (2:6)"));
        for path in [&b"/project/library.so"[..], b"/project/prose"] {
            let parsed = parse_as_required(fixture, path);
            assert!(parsed.hir.diagnostics.is_empty() && parsed.hir.has_module_syntax);
            assert_eq!(payload_of(&parsed).kind, SourceKind::Program);
        }
        assert_eq!(failure_of(b"/project/program.so"), None);
        // The name says that it is TypeScript: the build reports what is wrong with it.
        assert_eq!(failure_of(b"/project/wrong.ts"), None);
        let wrong = parse_as_required(fixture, b"/project/wrong.ts");
        assert!(!wrong.hir.diagnostics.is_empty());
    });
}

#[test]
fn executable_carries_text_that_is_no_program() {
    with_texts_that_only_their_load_calls_programs(false, |fixture| {
        let read_as = |path: &[u8]| {
            let parsed = parse_as_required(fixture, path);
            let source = payload_of(&parsed);
            assert_eq!(source.parse_failure, None);
            (source.kind, source.loader)
        };
        let carried = (SourceKind::Data, Loader::File);
        assert_eq!(read_as(b"/project/library.so"), carried);
        assert_eq!(read_as(b"/project/prose"), carried);
        let code = (SourceKind::Program, Loader::Ts);
        assert_eq!(read_as(b"/project/program.so"), code);
        assert_eq!(read_as(b"/project/wrong.ts"), code);
    });
}

#[test]
fn embedded_sqlite_has_its_own_loader() {
    with_host(&[], |fixture| {
        let settings = default_settings();
        let kind_for = |type_attribute: &[u8], embed_attribute: Option<&[u8]>| {
            let loader = fixture.host.loader_of(&LoaderRequest {
                type_attribute: Some(type_attribute),
                embed_attribute,
                ..loader_request(b"/project/a.db", &settings)
            });
            host_loader_kind(loader)
        };
        let loaded_as = |loader: Loader| Some(HostLoaderKind::Loader(loader));
        let expected = loaded_as(Loader::SqliteEmbedded);
        assert_eq!(kind_for(b"sqlite", Some(b"true")), expected);
        let expected = loaded_as(Loader::Sqlite);
        assert_eq!(kind_for(b"sqlite", Some(b"false")), expected);
        assert_eq!(kind_for(b"sqlite", None), loaded_as(Loader::Sqlite));
        assert_eq!(kind_for(b"text", Some(b"true")), loaded_as(Loader::Text));
    });
}

#[test]
fn plugin_loader_decides_language() {
    let files = [("types.d.ts", "declare const a: 1;"), ("hello.tmpl", "")];
    with_host(&files, |fixture| {
        let host = fixture.host;
        assert_eq!(host.script_kind(TEMPLATE), None);
        let template = fixture.parse(TEMPLATE, BY_NAME);
        assert_eq!(template.hir.kind, FileKind::Ts);
        assert!(!template.hir.is_js && !template.hir.has_errors);
        let source = payload_of(&template);
        let expected = (SourceKind::Program, Loader::Ts);
        assert_eq!((source.kind, source.loader), expected);
        assert!(source.is_from_plugin && source.plugin_module.is_none());
        assert_eq!(host.script_kind(TEMPLATE), Some(ScriptKind::Ts));

        let data = fixture.parse(DATA, BY_NAME);
        let source = payload_of(&data);
        let expected = (SourceKind::Data, Loader::Json);
        assert_eq!((source.kind, source.loader), expected);
        assert!(source.is_from_plugin);
        assert_eq!(host.script_kind(DATA), None);
        let calls = [
            "load /project/hello.tmpl",
            "load /project/a.data",
            "parse_data /project/a.data",
        ];
        assert_eq!(fixture.take_calls(), calls);

        let declarations = fixture.parse(b"/project/types.d.ts", BY_NAME);
        assert_eq!(declarations.hir.kind, FileKind::Declaration);
        assert!(declarations.hir.source_len > 0);
        assert!(!payload_of(&declarations).is_from_plugin);
        let library = b"/bundled:///libs/lib.es5.d.ts";
        assert!(!host.read_source(library).is_empty());
        assert!(fixture.take_calls().is_empty());
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn typed_file_keeps_its_text_beside_javascript_from_a_plugin() {
    let on_disk = "export type N = number; export const n: N = 1;";
    let files = [("erased.tsx", on_disk), ("erased.js", on_disk)];
    with_host(&files, |fixture| {
        let host = fixture.host;
        assert_eq!(host.loader_of_code_in_place_of_typed_file(ERASED), None);
        let code = fixture.parse(ERASED, BY_NAME);
        assert!(code.hir.is_js && !code.hir.has_errors);
        let source = payload_of(&code);
        assert_eq!(source.loader, Loader::Js);
        assert!(source.is_from_plugin);
        let javascript = to_host_loader(Loader::Js, ERASED);
        assert_ne!(javascript, BY_NAME);
        let in_place = host.loader_of_code_in_place_of_typed_file(ERASED);
        assert_eq!(in_place, Some(javascript));
        assert_eq!(&*fixture.read_code(ERASED), ERASED_TEXT);
        assert_eq!(&*host.read_source(ERASED), on_disk.as_bytes());
        assert_eq!(host.script_kind(ERASED), None);

        let untyped = b"/project/erased.js";
        fixture.parse(untyped, BY_NAME);
        assert_eq!(host.loader_of_code_in_place_of_typed_file(untyped), None);
        assert_eq!(&*host.read_source(untyped), ERASED_TEXT);
        fixture.parse(TEMPLATE, BY_NAME);
        assert_eq!(host.loader_of_code_in_place_of_typed_file(TEMPLATE), None);
        assert_eq!(&*host.read_source(TEMPLATE), TYPESCRIPT_TEXT);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn script_kind_asks_only_plugins_that_see_the_file() {
    with_host(&[("without-plugin.vue", "")], |fixture| {
        let expected = Some(ScriptKind::Tsx);
        assert_eq!(fixture.host.script_kind(WITHOUT_PLUGIN), expected);
        assert_eq!(fixture.host.script_kind(b"/project/missing.tmpl"), None);
        assert!(fixture.take_calls().is_empty());
    });
}

#[test]
fn every_tree_has_a_payload() {
    let files = [
        ("a.ts", "export {};"),
        ("a.json", "{}"),
        ("a.toml", "a = 1"),
        ("types.d.ts", "declare const a: 1;"),
    ];
    with_host(&files, |fixture| {
        let as_text = to_host_loader(Loader::Text, b"/project/a.ts");
        let cases: [(&[u8], HostLoader, SourceKind, Loader); 5] = [
            (b"/project/a.ts", BY_NAME, SourceKind::Program, Loader::Ts),
            (b"/project/a.ts", as_text, SourceKind::Data, Loader::Text),
            (b"/project/a.json", BY_NAME, SourceKind::Data, Loader::Json),
            (b"/project/a.toml", BY_NAME, SourceKind::Data, Loader::Toml),
            (
                b"/project/types.d.ts",
                BY_NAME,
                SourceKind::Program,
                Loader::Ts,
            ),
        ];
        for (path, host_loader, kind, loader) in cases {
            let parsed = fixture.parse(path, host_loader);
            let source = payload_of(&parsed);
            let name = BStr::new(path);
            assert_eq!((source.kind, source.loader), (kind, loader), "{name}");
            assert!(!source.is_from_plugin && source.plugin_module.is_none());
            assert!(source.web_assembly.is_none() && !source.is_page);
        }
        let messages = fixture.take_messages();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].starts_with(b"TS100050: "));
    });
}

#[test]
fn plugin_module_name_is_in_the_payload() {
    with_host(&[], |fixture| {
        let module = fixture.resolve_to_path(b"virtual:config");
        let parsed = fixture.parse(&module, BY_NAME);
        assert_eq!(parsed.hir.kind, FileKind::Ts);
        let source = payload_of(&parsed);
        let expected = PluginModuleName {
            namespace: Box::from(&b"v"[..]),
            path: Box::from(VIRTUAL_CONFIG),
        };
        assert_eq!(source.plugin_module.as_ref(), Some(&expected));
        assert!(source.is_from_plugin);
        let typescript = (SourceKind::Program, Loader::Ts);
        assert_eq!((source.kind, source.loader), typescript);
    });
}

#[test]
fn plugin_module_data_is_parsed_under_its_plugin_path() {
    with_host(&[], |fixture| {
        let module = fixture.resolve_to_path(b"virtual:data");
        let parsed = fixture.parse(&module, BY_NAME);
        assert_eq!(payload_of(&parsed).kind, SourceKind::Data);
        let calls = ["resolve virtual:data", "load data", "parse_data data"];
        assert_eq!(fixture.take_calls(), calls);
    });
}

#[test]
fn unknown_host_loader_is_an_internal_error() {
    with_host(&[("a.ts", "export const n: number = 1;")], |fixture| {
        let parsed = fixture.parse(b"/project/a.ts", HostLoader(200));
        assert_eq!(parsed.hir.kind, FileKind::Ts);
        assert!(!parsed.hir.has_errors);
        assert_eq!(payload_of(&parsed).loader, Loader::Ts);
        let messages = fixture.take_messages();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].ends_with(b"unknown host loader 200 for /project/a.ts"));
    });
}

#[test]
fn entry_point_with_unknown_name_that_is_not_text_is_a_file() {
    let directory = TemporaryDirectory::new("host_binary_entry_point");
    directory.write("tool", "\u{FFFD}\u{1}\u{2}");
    directory.write("with.dots.in-its-name", "console.log(1);\n");
    directory.write("main.ts", "\u{FFFD}");
    let aot = AotOptions::default();
    with_host_under(aot, directory.path(), Vec::new(), |fixture| {
        let host = fixture.host;
        let path = |name: &[u8]| [&from_native(directory.path())[..], b"/", name].concat();
        let kind_of = |name: &[u8]| host_loader_kind(loader_of(host, &path(name), None));
        let file = HostLoaderKind::Loader(Loader::File);
        assert_eq!(kind_of(b"tool"), Some(file));
        assert_eq!(host.script_kind(&path(b"tool")), None);
        let tsx = HostLoaderKind::Loader(Loader::Tsx);
        assert_eq!(kind_of(b"with.dots.in-its-name"), Some(tsx));
        assert_eq!(kind_of(b"main.ts"), Some(HostLoaderKind::ByName));
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn evaluated_text_is_served_as_javascript() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let text = EvaluatedText {
            call: ExprId(3),
            form: EvaluatedTextForm::FunctionBody,
            callee: BuiltinPath {
                id: BuiltinId::Function,
                mutability: Mutability::ConstantUnlessWritten,
            },
            texts: [fixture.atoms.intern(b"return this")].into_iter().collect(),
        };
        let path = host.evaluated_texts.add(MAIN, &text, &fixture.atoms);
        let path = path.expect("the text is a function body");
        assert!(host.is_file(&path));
        assert_eq!(host.realpath(&path), path);
        assert_eq!(host.script_kind(&path), None);
        assert_eq!(loader_of(host, &path, Some(b"text")), BY_NAME);
        let expected = b"(function anonymous(\n) {\nreturn this\n})";
        assert_eq!(host.read(&path).as_deref(), Some(&expected[..]));

        let parsed = fixture.parse(&path, BY_NAME);
        assert!(parsed.hir.is_js && !parsed.hir.has_errors);
        let source = payload_of(&parsed);
        let javascript = (SourceKind::EvaluatedText, Loader::Js);
        assert_eq!((source.kind, source.loader), javascript);
        assert!(!host.is_plugin_source(&path));
        assert!(fixture.take_calls().is_empty());

        assert!(!host.is_file(b"/$bun/text/%2fproject%2fmain.ts/4.cjs"));
    });
}

#[test]
fn react_compiler_declarations_are_served() {
    with_host(&[], |fixture| {
        let (host, path) = (fixture.host, react_compiler::DECLARATIONS_PATH);
        assert!(host.is_file(path));
        assert_eq!(host.realpath(path), path);
        let expected = Some(react_compiler::DECLARATIONS);
        assert_eq!(host.read(path).as_deref(), expected);
        assert_eq!(&*host.read_source(path), react_compiler::DECLARATIONS);
        assert_eq!(host.script_kind(path), None);
        assert_eq!(loader_of(host, path, None), BY_NAME);
        let parsed = fixture.parse(path, BY_NAME);
        assert_eq!(parsed.hir.kind, FileKind::Declaration);
        assert!(!parsed.hir.has_errors);
        assert_eq!(payload_of(&parsed).loader, Loader::Ts);
        assert!(fixture.take_calls().is_empty());
    });
}

#[test]
fn host_paths_are_not_directories() {
    with_host(&[("src/a.ts", "export {};")], |fixture| {
        let host = fixture.host;
        let module = fixture.resolve_to_path(b"virtual:config");
        assert!(is_host_path(&module));
        assert!(host.is_file(&module));
        assert_eq!(host.realpath(&module), module);

        let host_directories: [&[u8]; 4] =
            [b"/$bun/", b"/$bun/js", b"/$bun/plugin", b"/$bun/plugin/v"];
        for path in host_directories {
            assert!(!host.is_dir(path), "{}", BStr::new(path));
            assert!(!host.is_file(path), "{}", BStr::new(path));
            let name = BStr::new(path);
            assert_eq!(host.entries(path), (Vec::new(), Vec::new()), "{name}");
            assert!(host.list_dir(path).is_empty(), "{}", BStr::new(path));
        }
        assert!(!host.is_dir(&module));

        assert!(host.is_dir(b"/project/src"));
        assert_eq!(host.list_dir(b"/project/src"), [b"a.ts"]);
    });
}

#[test]
fn bun_sources_are_not_served() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        for path in [&b"/$bun/js/node/fs.ts"[..], b"/$bun/js/tsconfig.json"] {
            assert!(!host.is_file(path), "{}", BStr::new(path));
            assert_eq!(host.read(path), None, "{}", BStr::new(path));
        }
    });
}

#[test]
fn plugin_source_is_text_from_on_load() {
    let files = [("hello.tmpl", ""), ("plain.ts", "export {};")];
    with_host(&files, |fixture| {
        let host = fixture.host;
        let virtual_module = fixture.resolve_to_path(b"virtual:config");
        let plain: &[u8] = b"/project/plain.ts";
        for path in [TEMPLATE, &virtual_module[..], plain] {
            assert!(!fixture.read_code(path).is_empty(), "{}", BStr::new(path));
            assert_eq!(host.read_source(path), fixture.read_code(path));
        }
        assert!(host.is_plugin_source(TEMPLATE));
        assert!(host.is_plugin_source(&virtual_module));
        assert!(!host.is_plugin_source(plain));
        assert_eq!(host.read(&virtual_module).as_deref(), Some(TYPESCRIPT_TEXT));
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn file_read_for_its_types_alone_is_not_shown_to_plugins() {
    with_host(&[("hello.tmpl", "on the disk")], |fixture| {
        let host = fixture.host;
        assert_eq!(&*host.read_source(TEMPLATE), b"on the disk");
        assert_eq!(host.script_kind(TEMPLATE), None);
        assert!(!host.is_plugin_source(TEMPLATE));
        assert!(fixture.take_calls().is_empty());
    });
}

#[test]
fn only_missing_files_are_unreadable() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        assert!(host.read_source(b"/project/missing.ts").is_empty());
        assert!(host.read_source(b"/project/missing.d.ts").is_empty());
        let missing: [&[u8]; 2] = [b"/project/missing.ts", b"/project/missing.d.ts"];
        assert_eq!(host.take_unreadable(), missing);
        assert!(host.take_unreadable().is_empty());
        assert!(fixture.take_messages().is_empty());

        assert!(fixture.read_code(b"/project/failed.ts").is_empty());
        assert!(host.take_unreadable().is_empty());
        assert_eq!(fixture.take_messages(), [b"the plugin failed"]);
    });
}

#[test]
fn deferred_read_of_missing_file_is_unreadable() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        assert!(matches!(host.read_code(NEVER_LOADED), CodeRead::Deferred));
        assert!(host.read_source(NEVER_LOADED).is_empty());
        assert!(host.take_unreadable().is_empty());
        assert!(host.finish_deferred_reads().is_empty());
        assert_eq!(host.take_unreadable(), [NEVER_LOADED]);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn deferred_read_gets_text_and_loader_of_plugin() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let read = host.read_code(DEFERRED_TEMPLATE);
        assert!(matches!(read, CodeRead::Deferred));
        assert!(!host.is_plugin_source(DEFERRED_TEMPLATE));

        let texts = host.finish_deferred_reads();
        let expected = [(DEFERRED_TEMPLATE.to_vec(), Cow::Borrowed(TYPESCRIPT_TEXT))];
        assert_eq!(texts, expected);
        assert!(host.is_plugin_source(DEFERRED_TEMPLATE));
        assert_eq!(host.script_kind(DEFERRED_TEMPLATE), Some(ScriptKind::Ts));
        let parsed = fixture.parse(DEFERRED_TEMPLATE, BY_NAME);
        assert_eq!(parsed.hir.kind, FileKind::Ts);
        assert!(!parsed.hir.has_errors);
        assert!(payload_of(&parsed).is_from_plugin);
        assert!(host.take_unreadable().is_empty());
        assert_eq!(fixture.take_calls(), ["load /project/deferred.tmpl"]);
    });
}
