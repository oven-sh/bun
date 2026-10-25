use bun_ast::Loader;
use bun_builtin_sources::Archive;
use bun_sema::hir::FileKind;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{CodeImportForm, CodeRead, LoaderRequest, ParseOptions};
use bun_sema::session::Session;

use super::*;
use crate::builtins::RuntimeModule;
use crate::builtins::table::STARTUP_FUNCTIONS;
use crate::compile::testing::{default_settings, set_up_output};
use crate::load::host::tests::{payload_of, take_messages};
use crate::load::host_platform;
use crate::load::loaders::BY_NAME;

const FS_SOURCE: &[u8] = b"/$bun/js/node/fs.ts";
const CONFIGURATION: &[u8] = b"/$bun/js/tsconfig.json";
const MISSING_SOURCE: &[u8] = b"/$bun/js/node/missing.ts";
const LIBRARY: &[u8] = b"/bundled:///libs/lib.es5.d.ts";
const PROGRAM_FILE: &[u8] = b"/project/src/a.ts";
const PROGRAM_TEXT: &[u8] = b"export {};";
const MISSING_PROGRAM_FILE: &[u8] = b"/project/src/missing.ts";

struct Fixture<'f, 's> {
    host: &'f RuntimeHost<'f>,
    session: &'s Session,
    atoms: Interner<'s>,
}

impl<'s> Fixture<'_, 's> {
    fn runtime_modules(&self) -> &RuntimeModules {
        self.host.runtime_modules
    }

    fn resolve(&self, specifier: &[u8], importer: &[u8], kind: CodeImportKind) -> HostResolution {
        self.host.resolve_code(&CodeRequest {
            specifier,
            importer,
            directory: b"/$bun/js/node",
            kind,
            form: CodeImportForm::Static,
        })
    }

    fn import(&self, specifier: &[u8], importer: &[u8]) -> HostResolution {
        self.resolve(specifier, importer, CodeImportKind::Import)
    }

    fn parse(&self, path: &[u8]) -> ParsedCode<'s> {
        let settings = default_settings();
        let request = CodeParseRequest {
            path,
            loader: BY_NAME,
            options: ParseOptions::default(),
            reads_jsdoc: true,
            settings: &settings,
            declared_module_type: DeclaredModuleType::Unknown,
        };
        let (arena, text) = (self.session.arena(), self.host.read_source(path));
        self.host.parse_code(arena, &request, &text, &self.atoms)
    }

    fn function_file(&self) -> Vec<u8> {
        let runtime_modules = self.runtime_modules();
        let path = runtime_modules.function_file_path(STARTUP_FUNCTIONS[0]);
        path.expect("a function that runs at startup has a file")
    }

    fn prelude_file(&self) -> Vec<u8> {
        let path = self.runtime_modules().prelude_paths().next();
        path.expect("the prelude has a file")
    }

    fn take_messages(&self) -> Vec<Vec<u8>> {
        take_messages(self.host.messages)
    }
}

fn with_host<R>(then: impl FnOnce(&Fixture<'_, '_>) -> R) -> R {
    set_up_output();
    let already_read = [(PROGRAM_FILE.to_vec(), PROGRAM_TEXT.to_vec())];
    let mut disk = Disk::with_already_read(1, already_read.into_iter().collect(), b"/project");
    disk.bundled_libs = Some(bun_sema_standalone::TYPESCRIPT_LIBS);
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let builtin_names = BuiltinNames::new(&atoms);
    let runtime_modules = RuntimeModules::new(Archive::embedded(), false);
    let messages = LoadMessages::default();
    let host = RuntimeHost {
        disk: &disk,
        runtime_modules: &runtime_modules,
        builtin_names: &builtin_names,
        platform: host_platform(),
        messages: &messages,
        unreadable: Guarded::default(),
    };
    then(&Fixture {
        host: &host,
        session: &session,
        atoms,
    })
}

fn host_module_id(module: RuntimeModule) -> HostModuleId {
    HostModuleId(module.registry_id())
}

fn fs_source() -> HostResolution {
    HostResolution::ModuleSource {
        module: host_module_id(RuntimeModule::NodeFs),
        path: FS_SOURCE.to_vec(),
    }
}

#[test]
fn archive_files_are_read() {
    with_host(|fixture| {
        let host = fixture.host;
        let text = fixture.runtime_modules().read(FS_SOURCE);
        let text = text.expect("the archive has the source of node:fs");
        assert!(!text.is_empty());
        assert!(host.is_file(FS_SOURCE));
        assert_eq!(host.realpath(FS_SOURCE), FS_SOURCE);
        assert_eq!(host.read(FS_SOURCE).as_deref(), Some(&*text));
        assert_eq!(host.read_source(FS_SOURCE), text);
        let CodeRead::Text(code) = host.read_code(FS_SOURCE) else {
            panic!("no read of the archive is deferred");
        };
        assert_eq!(code, text);
        assert!(host.is_file(CONFIGURATION));
        let configuration = host.read(CONFIGURATION);
        assert!(configuration.is_some_and(|text| !text.is_empty()));
        assert!(host.take_unreadable().is_empty());
    });
}

#[test]
fn archive_directories_are_listed() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(host.is_dir(b"/$bun/js") && host.is_dir(b"/$bun/js/node"));
        assert!(!host.is_file(b"/$bun/js/node"));
        assert!(!host.is_dir(FS_SOURCE));
        assert!(!host.is_dir(b"/$bun/plugin"));

        let (files, directories) = host.entries(b"/$bun/js");
        assert!(files.contains(&b"tsconfig.json".to_vec()));
        assert!(directories.contains(&b"node".to_vec()));
        assert_eq!(host.list_dir(b"/$bun/js"), [files, directories].concat());

        assert_eq!(host.entries(b"/$bun/plugin"), (Vec::new(), Vec::new()));
        assert!(host.list_dir(FS_SOURCE).is_empty());
    });
}

#[test]
fn internal_module_resolves_from_archive_importer() {
    with_host(|fixture| {
        let specifier = b"internal/validators";
        let HostResolution::ModuleSource { module, path } = fixture.import(specifier, FS_SOURCE)
        else {
            panic!("an internal module has source");
        };
        let kind = RuntimeModule::from_registry_id(module.0).map(RuntimeFileKind::Module);
        assert!(kind.is_some());
        assert_eq!(fixture.runtime_modules().file_kind(&path), kind);

        let unclaimed = HostResolution::Unclaimed;
        assert_eq!(fixture.import(specifier, PROGRAM_FILE), unclaimed);
        assert_eq!(fixture.import(specifier, b""), unclaimed);
        let host = fixture.host;
        assert_eq!(host.resolve_runtime_module(specifier), unclaimed);
        let validators = host.find_runtime_modules(b"internal/validators", b"");
        assert!(validators.is_empty());
    });
}

#[test]
fn relative_import_of_module_keeps_module_id() {
    with_host(|fixture| {
        let path_module = host_module_id(RuntimeModule::NodePath);
        let path_source = fixture.runtime_modules().module_resolution(path_module);
        assert!(matches!(path_source, HostResolution::ModuleSource { .. }));
        assert_eq!(fixture.import(b"./path", FS_SOURCE), path_source);
        assert_eq!(fixture.import(b"node:path", FS_SOURCE), path_source);
        let actual = fixture.import(b"../internal/validators", FS_SOURCE);
        assert_eq!(actual, fixture.import(b"internal/validators", FS_SOURCE));

        let unclaimed = HostResolution::Unclaimed;
        assert_eq!(fixture.import(b"./nothing", FS_SOURCE), unclaimed);
        assert_eq!(fixture.import(b"./path", PROGRAM_FILE), unclaimed);
    });
}

#[test]
fn module_with_source_is_module_source() {
    with_host(|fixture| {
        let host = fixture.host;
        let module_path = fixture.runtime_modules().module_path(RuntimeModule::NodeFs);
        assert_eq!(module_path, Some(FS_SOURCE));
        for specifier in [&b"fs"[..], b"node:fs"] {
            for importer in [FS_SOURCE, b"/$bun/js/node/os.ts"] {
                assert_eq!(fixture.import(specifier, importer), fs_source());
                let required = fixture.resolve(specifier, importer, CodeImportKind::Require);
                assert_eq!(required, fs_source());
            }
            assert_eq!(host.resolve_runtime_module(specifier), fs_source());
        }
    });
}

#[test]
fn computed_specifier_has_no_candidates() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(host.find_runtime_modules(b"", b"").is_empty());
        assert!(host.find_runtime_modules(b"node:", b"fs").is_empty());
        assert!(host.find_runtime_modules(b"bun:", b"jsc").is_empty());
    });
}

#[test]
fn native_module_is_module() {
    with_host(|fixture| {
        let host = fixture.host;
        let native_module = HostResolution::Module(host_module_id(RuntimeModule::BunJsc));
        assert_eq!(fixture.import(b"bun:jsc", FS_SOURCE), native_module);
        assert_eq!(host.resolve_runtime_module(b"bun:jsc"), native_module);
    });
}

#[test]
fn alias_without_id_is_host_value() {
    with_host(|fixture| {
        let host_value = HostResolution::External {
            specifier: b"bun:main".to_vec(),
            kind: ExternalKind::HostValue,
        };
        assert_eq!(fixture.import(b"bun:main", FS_SOURCE), host_value);
        let host = fixture.host;
        assert_eq!(host.resolve_runtime_module(b"bun:main"), host_value);
        assert!(host.find_runtime_modules(b"bun:main", b"").is_empty());
    });
}

#[test]
fn entry_point_is_unclaimed() {
    with_host(|fixture| {
        for specifier in [&b"node:fs"[..], b"bun:jsc", b"bun:main", FS_SOURCE] {
            let resolution = fixture.resolve(specifier, b"", CodeImportKind::EntryPoint);
            let name = BStr::new(specifier);
            assert_eq!(resolution, HostResolution::Unclaimed, "{name}");
        }
    });
}

#[test]
fn bundled_library_is_read_from_disk() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(host.is_file(LIBRARY));
        assert_eq!(host.realpath(LIBRARY), LIBRARY);
        let text = host.read(LIBRARY);
        let text = text.expect("the libraries of TypeScript are bundled");
        assert!(!text.is_empty());
        assert_eq!(host.disk.read(LIBRARY), Some(text));
        assert_eq!(fixture.runtime_modules().file_kind(LIBRARY), None);

        assert!(!host.is_file(b"/bundled:///libs/lib.missing.d.ts"));
        assert_eq!(host.read(b"/bundled:///libs/lib.missing.d.ts"), None);
    });
}

#[test]
fn other_paths_are_served_by_the_disk() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(host.is_file(PROGRAM_FILE) && !host.is_dir(PROGRAM_FILE));
        assert_eq!(host.read(PROGRAM_FILE).as_deref(), Some(PROGRAM_TEXT));
        assert_eq!(&*host.read_source(PROGRAM_FILE), PROGRAM_TEXT);
        assert!(host.is_dir(b"/project/src"));
        let expected = (vec![b"a.ts".to_vec()], Vec::new());
        assert_eq!(host.entries(b"/project/src"), expected);
        assert_eq!(host.list_dir(b"/project/src"), [b"a.ts"]);
        assert!(!host.is_file(MISSING_PROGRAM_FILE));
        assert_eq!(host.read(MISSING_PROGRAM_FILE), None);
    });
}

#[test]
fn payload_kind_follows_file_kind() {
    with_host(|fixture| {
        let (function_file, prelude_file) = (fixture.function_file(), fixture.prelude_file());
        let cases: [(&[u8], SourceKind); 3] = [
            (FS_SOURCE, SourceKind::RuntimeModule(RuntimeModule::NodeFs)),
            (&function_file, SourceKind::RuntimeFunctions),
            (&prelude_file, SourceKind::RuntimeFunctions),
        ];
        for (path, kind) in cases {
            let (parsed, name) = (fixture.parse(path), BStr::new(path));
            assert_eq!(parsed.hir.kind, FileKind::Ts, "{name}");
            assert!(!parsed.hir.is_js && !parsed.hir.has_errors, "{name}");
            assert!(parsed.host_values.is_empty());
            let source = payload_of(&parsed);
            assert_eq!((source.kind, source.loader), (kind, Loader::Ts), "{name}");
            assert!(!source.is_from_plugin && source.plugin_module.is_none());
            assert!(source.web_assembly.is_none() && !source.is_page);
        }
        assert!(fixture.take_messages().is_empty());
        assert!(fixture.host.take_unreadable().is_empty());
    });
}

#[test]
fn declaration_root_is_types_only() {
    with_host(|fixture| {
        for path in fixture.runtime_modules().declaration_paths() {
            let (parsed, name) = (fixture.parse(&path), BStr::new(&path));
            assert_eq!(parsed.hir.kind, FileKind::Declaration, "{name}");
            assert!(parsed.hir.source_len > 0);
            let source = payload_of(&parsed);
            let expected = (SourceKind::TypesOnly, Loader::Ts);
            assert_eq!((source.kind, source.loader), expected);
        }
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn configuration_file_as_code_is_internal_error() {
    with_host(|fixture| {
        let cases: [(&[u8], &[u8]); 2] = [
            (CONFIGURATION, b"/$bun/js/tsconfig.json was loaded as code"),
            (
                MISSING_SOURCE,
                b"/$bun/js/node/missing.ts was loaded as code",
            ),
        ];
        for (path, message) in cases {
            let parsed = fixture.parse(path);
            assert_eq!(payload_of(&parsed).kind, SourceKind::TypesOnly);
            let messages = fixture.take_messages();
            assert_eq!(messages.len(), 1, "{}", BStr::new(path));
            assert!(
                messages[0].ends_with(message),
                "{}",
                BStr::new(&messages[0])
            );
        }
    });
}

#[test]
fn unknown_host_path_is_unreadable() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(!host.is_file(MISSING_SOURCE));
        assert_eq!(host.read(MISSING_SOURCE), None);
        assert!(host.take_unreadable().is_empty());

        assert!(host.read_source(MISSING_PROGRAM_FILE).is_empty());
        assert!(host.read_source(MISSING_SOURCE).is_empty());
        let CodeRead::Text(code) = host.read_code(b"/$bun/plugin/v/config") else {
            panic!("no read of the archive is deferred");
        };
        assert!(code.is_empty());
        let unreadable: [&[u8]; 3] = [
            MISSING_SOURCE,
            b"/$bun/plugin/v/config",
            MISSING_PROGRAM_FILE,
        ];
        assert_eq!(host.take_unreadable(), unreadable);
        assert!(host.take_unreadable().is_empty());
        assert!(fixture.take_messages().is_empty());
    });
}

#[test]
fn only_function_files_are_library_files_and_only_modules_hoist_top_level_variables() {
    with_host(|fixture| {
        let host = fixture.host;
        let [builtins, private] = fixture.runtime_modules().declaration_paths();
        let (function_file, prelude_file) = (fixture.function_file(), fixture.prelude_file());
        let cases: [(&[u8], bool, bool); 9] = [
            (&function_file, true, false),
            (&prelude_file, true, false),
            (FS_SOURCE, false, true),
            (&builtins, false, false),
            (&private, false, false),
            (CONFIGURATION, false, false),
            (MISSING_SOURCE, false, false),
            (LIBRARY, false, false),
            (PROGRAM_FILE, false, false),
        ];
        for (path, is_library_file, hoists) in cases {
            let name = BStr::new(path);
            assert_eq!(host.is_library_file(path), is_library_file, "{name}");
            assert_eq!(host.hoists_top_level_variables(path), hoists, "{name}");
        }
    });
}

#[test]
fn language_follows_file_name() {
    with_host(|fixture| {
        let host = fixture.host;
        let settings = default_settings();
        for type_attribute in [None, Some(&b"text"[..]), Some(&b"json"[..])] {
            let loader = host.loader_of(&LoaderRequest {
                path: FS_SOURCE,
                kind: CodeImportKind::Import,
                type_attribute,
                embed_attribute: None,
                settings: &settings,
                declared_module_type: DeclaredModuleType::Unknown,
            });
            assert_eq!(loader, BY_NAME);
        }
        assert_eq!(host.script_kind(FS_SOURCE), None);
        assert_eq!(host.script_kind(PROGRAM_FILE), None);
        assert!(host.extra_file_extensions().is_empty());
    });
}

#[test]
fn project_has_no_plugins() {
    with_host(|fixture| {
        let host = fixture.host;
        assert!(!host.read_source(FS_SOURCE).is_empty());
        assert!(!host.is_plugin_source(FS_SOURCE));
        assert!(host.finish_deferred_reads().is_empty());
    });
}
