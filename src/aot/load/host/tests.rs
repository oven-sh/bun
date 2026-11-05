use std::sync::atomic::AtomicUsize;

use bstr::ByteSlice;
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
use crate::builtins::RuntimeModule;
use crate::compile::testing::{
    TemporaryDirectory, default_settings, lower_program_with_provider, with_loaded_build,
    with_loaded_test_run,
};
use crate::diagnostic_codes::Code;
use crate::diagnostics::Diagnostics;
use crate::engine::ExecutableIdentity;
use crate::load::host_platform;
use crate::load::runtime_modules::HOST_VALUE_MODULE;
use crate::load::source_provider::{
    DataFailure, DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest,
    WithoutServices,
};
use crate::options::{LoadOptions, PathOptions, RemovableOptions};

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
const ASSET: &[u8] = b"/project/logo.png";
const DEFERRED_ASSET: &[u8] = b"/project/deferred.png";
const ASSET_FROM_PLUGIN: &[u8] = b"smaller";
const PAGE: &[u8] = b"/project/page.html";
const DEFERRED_BUNDLE: &[u8] = b"/project/deferred-bundle.js";
const STILL_DEFERRED: &[u8] = b"/project/still-deferred.ts";
const STILL_DEFERRED_ASSET: &[u8] = b"/project/still-deferred.png";
const BUNDLED_COMMONJS_TEXT: &str = "// @bun @bun-cjs\n\
    (function(exports, require, module, __filename, __dirname) {module.exports = 1;})";

#[derive(Default)]
struct ScriptedProvider {
    calls: Guarded<Vec<String>>,
    name_checks: AtomicUsize,
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
            ASSET => (ASSET_FROM_PLUGIN, Loader::File),
            NEVER_LOADED | DEFERRED_TEMPLATE | DEFERRED_ASSET | DEFERRED_BUNDLE
            | STILL_DEFERRED | STILL_DEFERRED_ASSET => {
                return Ok(Loaded::Deferred);
            }
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
        let from_plugin = |text: &'static [u8], loader: Loader| Loaded::Source {
            contents: Cow::Borrowed(text),
            loader,
            is_from_plugin: true,
        };
        let answers = [
            (NEVER_LOADED, Loaded::NotFound),
            (DEFERRED_TEMPLATE, from_plugin(TYPESCRIPT_TEXT, Loader::Ts)),
            (DEFERRED_ASSET, from_plugin(ASSET_FROM_PLUGIN, Loader::File)),
            (
                DEFERRED_BUNDLE,
                from_plugin(BUNDLED_COMMONJS_TEXT.as_bytes(), Loader::Js),
            ),
            (STILL_DEFERRED, Loaded::Deferred),
            (STILL_DEFERRED_ASSET, Loaded::Deferred),
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

    fn set_embedded_contents(&self, file: &SourceFile<'_>, _log: &mut Log) -> Result<(), Failed> {
        let embedded = [file.path, b" = ", file.contents].concat();
        self.record_call("set_embedded_contents", &embedded);
        Ok(())
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        self.record_call("parse_data", file.path);
        match file.loader {
            Loader::Html => Ok(DataModule::Page),
            _ => WithoutServices.parse_data(file, arena, atoms, log),
        }
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        self.name_checks.fetch_add(1, Ordering::Relaxed);
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
        self.parse_text(path, loader, &self.read_code(path))
    }

    fn parse_text(&self, path: &[u8], loader: HostLoader, text: &[u8]) -> ParsedCode<'s> {
        let settings = default_settings();
        let request = CodeParseRequest {
            package_module_type: DeclaredModuleType::Unknown,
            path,
            loader,
            options: ParseOptions::default(),
            reads_jsdoc: true,
            settings: &settings,
            declared_module_type: DeclaredModuleType::Unknown,
        };
        let arena = self.session.arena();
        self.host.parse_code(arena, &request, text, &self.atoms)
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

    fn take_refusal(&self, code: Code) -> Vec<u8> {
        let mut messages = self.take_messages();
        let texts: Vec<&BStr> = messages.iter().map(BStr::new).collect();
        let prefix = format!("TS{}: ", code.number());
        assert!(
            texts.len() == 1 && texts[0].starts_with(prefix.as_bytes()),
            "{texts:?}"
        );
        messages.remove(0)
    }

    fn assert_refused_as_still_deferred(&self, path: &[u8]) {
        let message = self.take_refusal(Code::UnsupportedOption);
        for named in [path, b"still defers"] {
            assert!(message.contains_str(named), "{}", BStr::new(&message));
        }
    }

    fn parse_failure_of(&self, path: &[u8]) -> Option<Vec<u8>> {
        let parsed = self.parse(path, BY_NAME);
        payload_of(&parsed).parse_failure.clone()
    }

    fn finish_asset_reads(&self, paths: &[&[u8]]) {
        assert!(self.host.start_background_reads(paths));
        for path in paths {
            self.host.read_in_background(path);
        }
        self.host.finish_background_reads();
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

fn in_memory_files_of(files: &[(&str, &str)]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let in_memory_file = |(name, text): &(&str, &str)| {
        let path = format!("/project/{name}").into_bytes();
        (path, text.as_bytes().to_vec())
    };
    let mut in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = files.iter().map(in_memory_file).collect();
    in_memory_files.sort_unstable();
    in_memory_files
}

fn with_host<R>(files: &[(&str, &str)], then: impl FnOnce(&Fixture<'_, '_>) -> R) -> R {
    let files = in_memory_files_of(files);
    with_host_under(AotOptions::default(), b"/project", files, then)
}

fn with_test_run_host<R>(files: &[(&str, &str)], then: impl FnOnce(&Fixture<'_, '_>) -> R) -> R {
    let aot = AotOptions {
        runs_tests: true,
        runs_in_place: true,
        ..AotOptions::default()
    };
    with_host_under(aot, b"/project", in_memory_files_of(files), then)
}

fn with_host_under<R>(
    aot: AotOptions,
    root: &[u8],
    in_memory_files: Vec<(Vec<u8>, Vec<u8>)>,
    then: impl FnOnce(&Fixture<'_, '_>) -> R,
) -> R {
    let mut load = LoadOptions::new(root.to_vec());
    load.in_memory_files = in_memory_files;
    load.runs_tests = aot.runs_tests;
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
            entry_point_file_names: Vec::new(),
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
    let host = LoadHost::new(LoadHostInput {
        disk: &disk,
        provider: &provider,
        options: &options,
        runtime_modules: &runtime_modules,
        messages: &messages,
        builtin_names: &builtin_names,
        platform: host_platform(),
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
        is_linked_by_bundler: true,
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
fn module_that_only_the_host_has_is_host_value() {
    with_host(&[], |fixture| {
        let host_value = HostResolution::External {
            specifier: HOST_VALUE_MODULE.as_bytes().to_vec(),
            kind: ExternalKind::HostValue,
        };
        assert_eq!(
            fixture.resolve(HOST_VALUE_MODULE.as_bytes(), MAIN),
            host_value
        );
        let resolved = (fixture.host).resolve_runtime_module(HOST_VALUE_MODULE.as_bytes());
        assert_eq!(resolved, host_value);
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
        let cases: [(&[u8], Option<&[u8]>, HostLoaderKind); 11] = [
            (b"/project/a.ts", None, by_name),
            (b"/project/a.ts", Some(b""), by_name),
            (b"/project/a.txt", Some(b"text"), named(Loader::Text)),
            (b"/project/a.ts", Some(b"ts"), named(Loader::Ts)),
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
        fixture.take_refusal(Code::MacrosDisabled);
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
#[should_panic(expected = "Macros are disabled")]
fn macro_import_stops_build() {
    let main = "import { answer } from \"./answer.ts\" with { type: \"macro\" };\n\
        console.log(answer());";
    let files = [
        ("main.ts", main),
        ("answer.ts", "export function answer() { return 42; }"),
    ];
    with_loaded_build(&files, &default_settings(), |_, _| {});
}

#[test]
#[should_panic(expected = "Macros are disabled")]
fn macro_tag_stops_build() {
    let main = "import { answer } from \"./answer.ts\" with { type: \"macro\" };\n\
        console.log(answer`text`);";
    let answer = "export function answer(texts: TemplateStringsArray) { return texts.length; }";
    let files = [("main.ts", main), ("answer.ts", answer)];
    with_loaded_build(&files, &default_settings(), |_, _| {});
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
        assert_eq!(failure_of(b"/project/wrong.ts"), None);
        let wrong = parse_as_required(fixture, b"/project/wrong.ts");
        assert!(!wrong.hir.diagnostics.is_empty());
    });
}

#[test]
fn executable_carries_text_that_only_its_name_calls_a_program() {
    with_texts_that_only_their_load_calls_programs(false, |fixture| {
        let carried = fixture.parse(b"/project/prose", BY_NAME);
        let source = payload_of(&carried);
        assert_eq!(source.parse_failure, None);
        assert_eq!(
            (source.kind, source.loader),
            (SourceKind::Data, Loader::File)
        );
        let required = parse_as_required(fixture, b"/project/library.so");
        let source = payload_of(&required);
        let said = source.parse_failure.as_deref();
        assert_eq!(said, Some(&b"Invalid character. (1:1)"[..]));
        assert_eq!(source.kind, SourceKind::Program);
        for path in [&b"/project/program.so"[..], b"/project/wrong.ts"] {
            let parsed = parse_as_required(fixture, path);
            let source = payload_of(&parsed);
            assert_eq!(source.parse_failure, None);
            assert_eq!(
                (source.kind, source.loader),
                (SourceKind::Program, Loader::Ts)
            );
        }
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
        assert!(source.plugin_module.is_none());
        assert_eq!(host.script_kind(TEMPLATE), Some(ScriptKind::Ts));

        let data = fixture.parse(DATA, BY_NAME);
        let source = payload_of(&data);
        let expected = (SourceKind::Data, Loader::Json);
        assert_eq!((source.kind, source.loader), expected);
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
            assert!(source.plugin_module.is_none());
            assert!(source.web_assembly.is_none());
            assert_eq!(source.byte_count, fixture.read_code(path).len(), "{name}");
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
        assert!(host.take_unreadable().is_empty());
        assert_eq!(fixture.take_calls(), ["load /project/deferred.tmpl"]);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn code_that_stays_deferred_is_refused() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let read = host.read_code(STILL_DEFERRED);
        assert!(matches!(read, CodeRead::Deferred));
        assert!(fixture.take_messages().is_empty());

        assert!(host.finish_deferred_reads().is_empty());
        assert!(host.take_unreadable().is_empty());
        fixture.assert_refused_as_still_deferred(STILL_DEFERRED);
    });
}

#[test]
fn asset_contents_come_from_plugin_or_disk() {
    with_host(&[("plain.png", "as on disk")], |fixture| {
        fixture.finish_asset_reads(&[ASSET, b"/project/plain.png"]);
        let calls = [
            "load /project/logo.png",
            "load /project/plain.png",
            "set_embedded_contents /project/logo.png = smaller",
            "set_embedded_contents /project/plain.png = as on disk",
        ];
        assert_eq!(fixture.take_calls(), calls);
        assert!(fixture.host.take_unreadable().is_empty());
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn assets_of_a_later_round_join_those_of_an_earlier_round() {
    with_host(&[("plain.png", "as on disk")], |fixture| {
        let host = fixture.host;
        let plain: &[u8] = b"/project/plain.png";
        assert!(host.start_background_reads(&[plain]));
        assert!(host.start_background_reads(&[ASSET, plain]));
        assert_eq!(host.background_reads(), [ASSET, plain]);
        host.finish_background_reads();
        let calls = [
            "load /project/logo.png",
            "set_embedded_contents /project/logo.png = smaller",
            "load /project/plain.png",
            "set_embedded_contents /project/plain.png = as on disk",
        ];
        assert_eq!(fixture.take_calls(), calls);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn deferred_asset_read_is_finished_in_place() {
    with_host(&[], |fixture| {
        fixture.finish_asset_reads(&[DEFERRED_ASSET]);
        let calls = [
            "load /project/deferred.png",
            "set_embedded_contents /project/deferred.png = smaller",
        ];
        assert_eq!(fixture.take_calls(), calls);
        assert!(fixture.host.take_unreadable().is_empty());
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn asset_that_stays_deferred_is_refused() {
    with_host(&[], |fixture| {
        fixture.finish_asset_reads(&[STILL_DEFERRED_ASSET]);
        assert_eq!(fixture.take_calls(), ["load /project/still-deferred.png"]);
        assert!(fixture.host.take_unreadable().is_empty());
        fixture.assert_refused_as_still_deferred(STILL_DEFERRED_ASSET);
    });
}

#[test]
fn asset_loaded_by_plugin_with_another_loader_is_refused() {
    for path in [TEMPLATE, DEFERRED_TEMPLATE] {
        with_host(&[], |fixture| {
            fixture.finish_asset_reads(&[path]);
            let message = fixture.take_refusal(Code::UnsupportedOption);
            for named in [path, b"--loader .tmpl:ts"] {
                assert!(message.contains_str(named), "{}", BStr::new(&message));
            }
        });
    }
}

#[test]
fn missing_asset_is_unreadable() {
    with_host(&[], |fixture| {
        let missing: [&[u8]; 2] = [b"/project/missing.png", NEVER_LOADED];
        fixture.finish_asset_reads(&missing);
        let mut unreadable = fixture.host.take_unreadable();
        unreadable.sort_unstable();
        unreadable.dedup();
        assert_eq!(unreadable, missing);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn names_of_embedded_files_are_checked_without_any_background_read() {
    with_host(&[], |fixture| {
        fixture.host.finish_background_reads();
        assert_eq!(fixture.provider.name_checks.load(Ordering::Relaxed), 1);
    });
}

#[test]
fn body_of_bundled_commonjs_is_parsed() {
    let files = [
        ("bundled.js", BUNDLED_COMMONJS_TEXT),
        ("transpiled.js", "// @bun\nexport {};"),
    ];
    with_host(&files, |fixture| {
        fixture.parse(b"/project/transpiled.js", BY_NAME);
        assert!(fixture.take_messages().is_empty());
        let bundled = fixture.parse(b"/project/bundled.js", BY_NAME);
        assert_eq!(bundled.hir.fns.len(), 0);
        assert_eq!(bundled.hir.ids(bundled.hir.body).len(), 1);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn file_marked_as_bundled_commonjs_without_the_function_is_refused() {
    let files = [("bare.js", "// @bun @bun-cjs\nmodule.exports = 1;")];
    with_host(&files, |fixture| {
        fixture.parse(b"/project/bare.js", BY_NAME);
        fixture.take_refusal(Code::UnsupportedOption);
    });
}

#[test]
fn bundled_commonjs_that_is_not_loaded_as_code_is_accepted() {
    with_host(&[("bundled.js", BUNDLED_COMMONJS_TEXT)], |fixture| {
        let (host, path) = (fixture.host, &b"/project/bundled.js"[..]);
        let text = fixture.parse(path, loader_of(host, path, Some(b"text")));
        assert_eq!(payload_of(&text).kind, SourceKind::Data);
        assert_eq!(&*host.read_source(path), BUNDLED_COMMONJS_TEXT.as_bytes());
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn body_of_deferred_bundled_commonjs_is_parsed() {
    with_host(&[], |fixture| {
        let host = fixture.host;
        let read = host.read_code(DEFERRED_BUNDLE);
        assert!(matches!(read, CodeRead::Deferred));
        assert!(fixture.take_messages().is_empty());

        let texts = host.finish_deferred_reads();
        let text = Cow::Borrowed(BUNDLED_COMMONJS_TEXT.as_bytes());
        assert_eq!(texts, [(DEFERRED_BUNDLE.to_vec(), text)]);
        let bundled = fixture.parse_text(DEFERRED_BUNDLE, BY_NAME, &texts[0].1);
        assert_eq!(bundled.hir.fns.len(), 0);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn method_named_glob_of_another_object_is_loaded() {
    let main = "const own = { meta: { glob: (pattern: string) => pattern } };\n\
        console.log(own.meta.glob(\"./pages/*.ts\"));";
    with_loaded_build(&[("main.ts", main)], &default_settings(), |_, _| {});
}

#[test]
fn html_import_in_executable_waits_for_its_bundle() {
    with_host(&[("page.html", "<p></p>")], |fixture| {
        let host = fixture.host;
        assert!(!host.leaves_to_run_time(PAGE));
        assert!(!host.is_read_by_plugin(PAGE));
        let page = fixture.parse(PAGE, loader_of(host, PAGE, None));
        let source = payload_of(&page);
        let expected = (SourceKind::Data, Loader::Html);
        assert_eq!((source.kind, source.loader), expected);
        assert!(matches!(page.host_values, [(_, HostValue::Deferred)]));
        assert!(fixture.take_messages().is_empty());

        let text = fixture.parse(PAGE, loader_of(host, PAGE, Some(b"text")));
        let source = payload_of(&text);
        let expected = (SourceKind::Data, Loader::Text);
        assert_eq!((source.kind, source.loader), expected);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn html_import_in_place_is_refused() {
    let aot = AotOptions {
        runs_in_place: true,
        ..AotOptions::default()
    };
    let files = in_memory_files_of(&[("page.html", "<p></p>")]);
    with_host_under(aot, b"/project", files, |fixture| {
        fixture.parse(PAGE, loader_of(fixture.host, PAGE, None));
        let message = fixture.take_refusal(Code::UnsupportedOption);
        assert!(message.contains_str(PAGE), "{}", BStr::new(&message));
    });
}

#[test]
fn html_import_in_test_run_is_left_to_run_time() {
    with_test_run_host(&[("page.html", "<p></p>")], |fixture| {
        let host = fixture.host;
        assert!(host.leaves_to_run_time(PAGE));
        fixture.parse(PAGE, loader_of(host, PAGE, None));
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn page_not_named_as_one_fails_where_a_test_run_loads_it() {
    let files = [("fragment.txt", "<p></p>"), ("page.html", "<p></p>")];
    with_test_run_host(&files, |fixture| {
        let as_page = to_host_loader_of_attribute(Loader::Html);
        let fragment = fixture.parse(b"/project/fragment.txt", as_page);
        let source = payload_of(&fragment);
        let expected = (SourceKind::Data, Loader::Html);
        assert_eq!((source.kind, source.loader), expected);
        let said = source.parse_failure.as_deref();
        assert_eq!(said, Some(PAGE_NOT_NAMED_AS_ONE));
        assert_eq!(fixture.parse_failure_of(PAGE), None);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
#[should_panic(expected = "a query string works on an import of code")]
fn query_string_require_in_executable_stops_build() {
    let files = [
        ("main.cjs", "require(\"./lib.cjs?again\");"),
        ("lib.cjs", "exports.a = 1;"),
    ];
    lower_program_with_provider(&files, &default_settings(), &ScriptedProvider::default());
}

#[test]
fn query_string_import_in_test_run_is_left_to_run_time() {
    with_test_run_host(&[("lib.ts", "export {};")], |fixture| {
        match fixture.resolve(b"./lib.ts?again", MAIN) {
            HostResolution::External { specifier, kind } => {
                assert_eq!(kind, ExternalKind::UncompiledCode);
                assert!(specifier.ends_with(b"?again"), "{}", BStr::new(&specifier));
            }
            other => panic!("expected uncompiled code, got {other:?}"),
        }
        let unclaimed = HostResolution::Unclaimed;
        assert_eq!(fixture.resolve(b"./lib.ts", MAIN), unclaimed);
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn test_file_that_is_no_program_fails_where_it_is_loaded() {
    let files = [("main.ts", "this is no program")];
    with_test_run_host(&files, |fixture| {
        let parsed = fixture.parse(MAIN, BY_NAME);
        assert!(parsed.hir.diagnostics.is_empty() && parsed.hir.has_module_syntax);
        let source = payload_of(&parsed);
        assert_eq!(source.kind, SourceKind::Program);
        let said = source.parse_failure.as_deref();
        assert_eq!(said, Some(&b"';' expected. (1:6)"[..]));
    });
    with_host(&files, |fixture| {
        let parsed = fixture.parse(MAIN, BY_NAME);
        assert!(!parsed.hir.diagnostics.is_empty());
        assert_eq!(payload_of(&parsed).parse_failure, None);
    });
}

#[test]
fn blank_json_fails_where_a_test_run_loads_it() {
    let files = [("blank.json", " \n"), ("empty.json", "{}")];
    let (blank, empty): (&[u8], &[u8]) = (b"/project/blank.json", b"/project/empty.json");
    with_test_run_host(&files, |fixture| {
        let said = fixture.parse_failure_of(blank);
        let expected = &b"JSON Parse error: Unexpected EOF"[..];
        assert_eq!(said.as_deref(), Some(expected));
        assert_eq!(fixture.parse_failure_of(empty), None);
    });
    with_host(&files, |fixture| {
        assert_eq!(fixture.parse_failure_of(blank), None);
    });
}

#[test]
fn json_that_json_parse_refuses_fails_where_a_test_run_loads_it() {
    let files = [
        ("hexadecimal.json", "{\"n\": 0x10}"),
        ("two.json", "{\"a\": 1} {\"b\": 2}"),
        ("quotes.json", "{'a': 1}"),
        ("tsconfig.json", "{\"n\": 0x10}"),
        ("strict.json", " {\"n\": [16, 1e3, \"\\u0041\"]}\n"),
    ];
    let refused = Some(&b"JSON Parse error: Unable to parse JSON string"[..]);
    let path_of = |name: &str| [b"/project/", name.as_bytes()].concat();
    with_test_run_host(&files, |fixture| {
        for name in ["hexadecimal.json", "two.json", "quotes.json"] {
            let said = fixture.parse_failure_of(&path_of(name));
            assert_eq!(said.as_deref(), refused, "{name}");
        }
        let said = fixture.parse_failure_of(&path_of("tsconfig.json"));
        assert_ne!(said.as_deref(), refused);
        assert_eq!(fixture.parse_failure_of(&path_of("strict.json")), None);
    });
    with_host(&files, |fixture| {
        for (name, _) in files {
            let said = fixture.parse_failure_of(&path_of(name));
            assert_ne!(said.as_deref(), refused, "{name}");
        }
    });
}

fn describe_file_of_test_run(name: &str, text: &str) -> String {
    let files = [
        (name, text),
        ("config.js", "export const mode = 1;"),
        (
            "reads.js",
            "import { mode } from './config.js'; export const seen = mode;",
        ),
    ];
    with_loaded_test_run(&files, &default_settings(), |_, loaded| {
        let project = loaded.project(crate::load::ProjectId::Application);
        let files = project.loaded.files();
        let path = format!("/project/{name}");
        let file = files.by_path.get(path.as_bytes());
        let tree = files.hir(file.expect("the file is in the program"));
        let statements = tree.ids(tree.body).map(|it| match tree[it].kind {
            hir::StmtKind::Import(import) => {
                format!("import {}", BStr::new(files.atoms.bytes(tree[import].spec)))
            }
            hir::StmtKind::Var(_) => "declaration".to_string(),
            hir::StmtKind::Expr(_) => "expression".to_string(),
            _ => "statement".to_string(),
        });
        let statements = statements.collect::<Vec<String>>().join(" | ");
        let count = |is_counted: &dyn Fn(hir::ExprKind) -> bool| {
            let expressions = tree.exprs.iter();
            expressions.filter(|it| is_counted(it.kind)).count()
        };
        let is_made = |name| files.atoms.bytes(name).starts_with(b"%");
        let made = count(&|kind| matches!(kind, hir::ExprKind::Ident(name) if is_made(name)));
        let loads = count(&|kind| matches!(kind, hir::ExprKind::ImportCall { .. }));
        format!("{statements} | {made} made | {loads} import()")
    })
}

#[test]
fn a_test_run_leaves_a_file_under_the_mark_as_it_is_written() {
    let rows = [
        (
            "typeof jest; expect(1);",
            "expression | expression | 0 made | 0 import()",
        ),
        (
            "import { vi } from 'bun:test'; import { seen } from './reads.js'; vi.mock('./config.js', () => ({ mode: 2 })); seen;",
            "import bun:test | import ./reads.js | expression | expression | 0 made | 0 import()",
        ),
        (
            "import { jest } from 'bun:test'; import './reads.js'; jest.mock('./config.js', () => ({ mode: 2 }));",
            "import bun:test | import ./reads.js | expression | 0 made | 0 import()",
        ),
        (
            "import { vi } from 'bun:test'; import './reads.js'; const made = vi.hoisted(() => 1);",
            "import bun:test | import ./reads.js | declaration | 0 made | 0 import()",
        ),
        (
            "import { vi } from 'bun:test'; vi.doMock(import('./config.js'), () => ({ mode: 2 }));",
            "import bun:test | expression | 0 made | 1 import()",
        ),
        (
            "import { assert } from 'vitest'; assert;",
            "import vitest | expression | 0 made | 0 import()",
        ),
    ];
    for (text, as_written) in rows {
        for mark in [
            "// @bun\n",
            "// @bun @bytecode\n",
            "#!/usr/bin/env bun\n// @bun\n",
        ] {
            let described = describe_file_of_test_run("a.test.js", &format!("{mark}{text}"));
            assert_eq!(described, as_written, "{mark}{text}");
        }
        for no_mark in ["", "\n// @bun\n", "/* @bun */\n"] {
            let described = describe_file_of_test_run("a.test.js", &format!("{no_mark}{text}"));
            assert_ne!(described, as_written, "{no_mark}{text}");
        }
    }
    let as_written = "expression | expression | 0 made | 0 import()";
    let head = "(function(exports, require, module, __filename, __dirname) {";
    let marked = format!("// @bun @bun-cjs\n{head}typeof jest; expect(1);}})");
    let described = describe_file_of_test_run("a.test.cjs", &marked);
    assert_eq!(described, as_written);
    let described = describe_file_of_test_run("a.test.cjs", "typeof jest; expect(1);");
    assert_ne!(described, as_written);
}
