use std::borrow::Cow;
use std::num::NonZeroUsize;

use bstr::BString;
use bun_ast::Log;
use bun_builtin_sources::Archive;
use bun_options_types::aot_options::AotOptions;
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir_from_data::DataModule;
use bun_sema::program::CodeAnswer;
use bun_sema::resolve::{CodeHost, CodeOptions};
use bun_sema::session::{Arena, Session};
use bun_sema_driver::{CompileRequest, EntryPoints, Libs, load_program};

use super::*;
use crate::builtins::BuiltinNames;
use crate::compile::testing::{
    default_settings, set_up_output, with_bind_input, with_bind_input_and_provider,
    with_loaded_build, with_runtime_bind_input,
};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{InternalError, LoadMessages, Span};
use crate::engine::ExecutableIdentity;
use crate::ir::run_serially;
use crate::load::contents::{FoundBecause, FoundEntryPoint};
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::host_platform;
use crate::load::module_paths::{file_ids, is_linkable};
use crate::load::project::PerProject;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::source_provider::{
    DataFailure, DeferredLoad, Failed, LoadRequest, Loaded, Resolution, ResolveRequest, SourceFile,
    SourceProvider, WithoutServices,
};
use crate::options::{LoadOptions, Options, PathOptions};
use crate::statistics::Stage;

const TEXT_OF_PLUGIN_MODULE: &[u8] = b"export default 1;";

struct TestPlugins;

impl SourceProvider for TestPlugins {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        if request.specifier != b"virtual:config" {
            return WithoutServices.resolve(request, log);
        }
        Ok(Resolution::Module {
            namespace: b"v".to_vec(),
            path: b"config".to_vec(),
        })
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        if request.module.namespace != b"v" {
            return WithoutServices.load(request, log);
        }
        Ok(Loaded::Source {
            contents: Cow::Borrowed(TEXT_OF_PLUGIN_MODULE),
            loader: Loader::Js,
            is_from_plugin: true,
        })
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        match file.loader {
            Loader::Wasm => Ok(DataModule::RuntimeRequire {
                specifier: atoms.intern(file.path),
                loader_type: None,
                member: None,
            }),
            _ => WithoutServices.parse_data(file, arena, atoms, log),
        }
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

#[derive(Copy, Clone)]
enum TestHost {
    Application,
    DiskWithoutPayloads,
}

struct LoadSetup<'a> {
    host: TestHost,
    entry_points: &'a [&'a str],
}

impl Default for LoadSetup<'static> {
    fn default() -> LoadSetup<'static> {
        LoadSetup {
            host: TestHost::Application,
            entry_points: &["main.ts"],
        }
    }
}

fn to_byte_strings(texts: &[&str]) -> Vec<Vec<u8>> {
    texts.iter().map(|text| text.as_bytes().to_vec()).collect()
}

fn create_options<'a>(
    aot: &'a AotOptions,
    files: &[(&str, &str)],
    entry_points: &[&str],
) -> Options<'a> {
    let mut in_memory_files: Vec<(Vec<u8>, Vec<u8>)> = files
        .iter()
        .map(|(name, text)| (project_path(name), text.as_bytes().to_vec()))
        .collect();
    in_memory_files.sort_unstable();
    Options {
        aot,
        executable_identity: ExecutableIdentity([0; 16]),
        image_form: None,
        entry_points: to_byte_strings(entry_points),
        code: CodeOptions::bun_run(b"/project"),
        typescript_libs: Libs::Bundled(bun_sema_standalone::TYPESCRIPT_LIBS),
        load: LoadOptions {
            in_memory_files,
            ..LoadOptions::new(b"/project".to_vec())
        },
        paths: PathOptions {
            module_prefix: b"/$bunfs/root/".to_vec(),
            root_directory: b"/project".to_vec(),
            entry_point_names: to_byte_strings(entry_points),
            entry_point_file_names: Vec::new(),
        },
        removable: Default::default(),
        lists_modules: false,
        minifies_identifiers: false,
    }
}

fn with_freeze_input<R>(
    files: &[(&str, &str)],
    setup: &LoadSetup<'_>,
    then: impl FnOnce(&FreezeInput<'_, '_>) -> R,
) -> R {
    set_up_output();
    let aot = AotOptions::default();
    let options = create_options(&aot, files, setup.entry_points);
    let disk = create_disk(&options, NonZeroUsize::MIN);
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let builtin_names = BuiltinNames::new(&atoms);
    let archive = Archive::embedded();
    let runtime_modules = RuntimeModules::new(archive, false);
    let messages = LoadMessages::default();
    let application_host = LoadHost::new(LoadHostInput {
        disk: &disk,
        provider: &WithoutServices,
        options: &options,
        runtime_modules: &runtime_modules,
        messages: &messages,
        builtin_names: &builtin_names,
        platform: host_platform(),
    });
    let host: &dyn CodeHost = match setup.host {
        TestHost::Application => &application_host,
        TestHost::DiskWithoutPayloads => &disk,
    };
    let fold_options = FoldOptions {
        max_string_bytes: usize::MAX,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, session.arena());
    let request = CompileRequest {
        entry_points: EntryPoints::Written(&options.entry_points),
        code: &options.code,
        fold: &fold,
        atoms,
        libs: options.typescript_libs,
        project_origin: FileOrigin::NoFile,
        threads: NonZeroUsize::MIN,
        progress: None,
        left_out_bodies: None,
        discards_first_visits: false,
        order: 1,
    };
    let loaded = load_program(&session, host, &request).expect("every entry point is found");
    then(&FreezeInput {
        project: ProjectId::Application,
        files: loaded.files(),
        options: &options,
        manifest: archive.manifest(),
        host_loaded_modules: &[],
        modules_named_at_run_time: &[],
        found_entry_points: &[],
        levels_above_root: None,
    })
}

fn freeze_with_entry_point_names(
    input: &FreezeInput<'_, '_>,
    names: &[&str],
) -> Result<FrozenSources, InternalError> {
    let aot = AotOptions::default();
    let options = create_options(&aot, &[], names);
    let input = FreezeInput {
        options: &options,
        ..*input
    };
    freeze_sources(&input, &run_serially)
}

fn project_path(name: &str) -> Vec<u8> {
    format!("/project/{name}").into_bytes()
}

fn file_at(files: &Files<'_>, name: &str) -> FileId {
    let file = files.by_path.get(&project_path(name));
    file.unwrap_or_else(|| panic!("{name} is not in the program"))
}

fn files_at(files: &Files<'_>, name: &str) -> Vec<FileId> {
    let path = project_path(name);
    file_ids(files.modules.len())
        .filter(|&file| files.module(file).file_name() == path)
        .collect()
}

fn public_paths_at(files: &Files<'_>, sources: &Sources, name: &str) -> Vec<(Loader, Vec<u8>)> {
    let mut found: Vec<(Loader, Vec<u8>)> = files_at(files, name)
        .into_iter()
        .filter(|&file| is_linkable(files, file))
        .map(|file| {
            let public_path = sources.module_paths(file).public_path.to_vec();
            (sources.loader(file), public_path)
        })
        .collect();
    found.sort_by(|a, b| a.1.cmp(&b.1));
    found
}

fn entry_point_kind(sources: &Sources, file: FileId) -> Option<EntryPointKind> {
    let mut entry_points = sources.entry_points().iter();
    let entry_point = entry_points.find(|entry_point| entry_point.file == file)?;
    Some(entry_point.kind)
}

fn freeze_runtime_project(files: &Files<'_>, host_loaded_modules: &[RuntimeModule]) -> Sources {
    let aot = AotOptions::default();
    let options = create_options(&aot, &[], &["main.ts"]);
    let input = FreezeInput {
        project: ProjectId::Runtime,
        files,
        options: &options,
        manifest: Archive::embedded().manifest(),
        host_loaded_modules,
        modules_named_at_run_time: &[],
        found_entry_points: &[],
        levels_above_root: None,
    };
    freeze_sources(&input, &run_serially).unwrap().sources
}

fn collect_implied_modules(files: &Files<'_>, sources: &Sources) -> Vec<RuntimeModule> {
    let compiled_files = files.compiled_files().iter();
    let compiled_modules = compiled_files.filter_map(|&file| files.compiled(file));
    let implied_answers = compiled_modules.flat_map(|compiled| compiled.implied_answers);
    implied_answers
        .filter_map(|&answer| match answer {
            CodeAnswer::HostModule(id) => RuntimeModule::from_registry_id(id.0),
            CodeAnswer::File(file) => match sources.kind(file) {
                SourceKind::RuntimeModule(module) => Some(module),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

#[test]
fn lowering_kind_joins_source_kinds() {
    let program = Some(lower::SourceKind::Program);
    assert_eq!(SourceKind::Program.lowering_kind(), program);
    assert_eq!(SourceKind::Data.lowering_kind(), program);
    let module = RuntimeModule::NodeFs;
    assert_eq!(
        SourceKind::RuntimeModule(module).lowering_kind(),
        Some(lower::SourceKind::RuntimeModule(module))
    );
    assert_eq!(
        SourceKind::RuntimeFunctions.lowering_kind(),
        Some(lower::SourceKind::RuntimeFunctions)
    );
    assert_eq!(SourceKind::TypesOnly.lowering_kind(), None);
}

#[test]
#[should_panic(expected = "parse_code gives every tree a payload")]
fn missing_payload_panics() {
    parsed_source_mut(&mut None);
}

#[test]
#[should_panic(expected = "the payload of a tree is a ParsedSource")]
fn payload_of_another_type_panics() {
    let payload: HostPayload = Box::new(0u8);
    parsed_source_mut(&mut Some(payload));
}

#[test]
fn kinds_and_loaders_follow_payloads() {
    let main = "import data from './data.json';\n\
                import note from './note.txt';\n\
                export default [data, note];";
    let files = [
        ("main.ts", main),
        ("data.json", "{}"),
        ("note.txt", "a"),
        ("globals.d.ts", "declare const a: 1;"),
    ];
    with_bind_input(&files, &default_settings(), |input| {
        let sources = input.sources;
        assert_eq!(sources.project(), ProjectId::Application);
        let describe = |name: &str| {
            let file = file_at(input.files, name);
            let payload = parsed_source(input.files, file);
            assert!(
                !payload.is_some_and(|it| it.plugin_module.is_some()),
                "{name}"
            );
            (
                sources.kind(file),
                sources.loader(file),
                sources.is_data(file),
            )
        };
        assert_eq!(
            describe("main.ts"),
            (SourceKind::Program, Loader::Ts, false)
        );
        assert_eq!(
            describe("data.json"),
            (SourceKind::Data, Loader::Json, true)
        );
        assert_eq!(describe("note.txt"), (SourceKind::Data, Loader::Text, true));
        assert_eq!(
            describe("globals.d.ts"),
            (SourceKind::TypesOnly, Loader::Ts, false)
        );

        let declarations = file_at(input.files, "globals.d.ts");
        assert!(parsed_source(input.files, declarations).is_none());
        assert!(parsed_source(input.files, file_at(input.files, "main.ts")).is_some());
        let paths = sources.module_paths(declarations);
        assert_eq!(paths.display_path, b"globals.d.ts");
        assert_eq!(
            sources.diagnostic_path(declarations),
            b"/project/globals.d.ts"
        );
    });
}

#[test]
fn entry_point_uses_configured_name() {
    let files = [("main.ts", "import './app.js';"), ("app.js", "export {};")];
    with_freeze_input(&files, &LoadSetup::default(), |input| {
        let sources = freeze_with_entry_point_names(input, &["app.js"])
            .unwrap()
            .sources;
        let main = input.files.entry_points()[0];
        let paths = sources.module_paths(main);
        assert_eq!(paths.public_path, b"/$bunfs/root/app.js");
        assert_eq!(paths.display_path, b"main.ts");
        assert_eq!(&*sources.path_in_stack_traces(main), b"main.ts");
        assert_eq!(sources.diagnostic_path(main), b"/project/main.ts");
        assert_eq!(sources.kind(main), SourceKind::Program);
        let expected = vec![(Loader::Jsx, b"/$bunfs/root/app.js?jsx".to_vec())];
        assert_eq!(public_paths_at(input.files, &sources, "app.js"), expected);
    });
}

#[test]
fn in_place_stack_traces_have_disk_paths() {
    let files = [
        ("main.ts", "import './src/deep.ts';"),
        ("src/deep.ts", "export {};"),
    ];
    with_freeze_input(&files, &LoadSetup::default(), |input| {
        let paths_with = |runs_in_place| {
            let aot = AotOptions {
                runs_in_place,
                ..AotOptions::default()
            };
            let options = create_options(&aot, &[], &["main.ts"]);
            let input = FreezeInput {
                options: &options,
                ..*input
            };
            let sources = freeze_sources(&input, &run_serially).unwrap().sources;
            ["main.ts", "src/deep.ts"].map(|name| {
                let file = file_at(input.files, name);
                BString::from(&*sources.path_in_stack_traces(file))
            })
        };
        assert_eq!(paths_with(false), ["main.ts", "src/deep.ts"]);
        if !cfg!(windows) {
            assert_eq!(
                paths_with(true),
                ["/project/main.ts", "/project/src/deep.ts"]
            );
        }
    });
}

#[test]
fn entry_point_name_cannot_leave_module_prefix() {
    with_freeze_input(
        &[("main.ts", "export {};")],
        &LoadSetup::default(),
        |input| {
            let sources = freeze_with_entry_point_names(input, &["../out/app.js"])
                .unwrap()
                .sources;
            let main = input.files.entry_points()[0];
            let public_path = sources.module_paths(main).public_path;
            assert_eq!(public_path, b"/$bunfs/_.._/_.._/out/app.js");
        },
    );
}

#[test]
fn command_line_files_are_entry_points_in_order() {
    let files = [
        ("a.ts", "import './c.ts';"),
        ("b.ts", "export {};"),
        ("c.ts", "export {};"),
    ];
    let setup = LoadSetup {
        entry_points: &["b.ts", "a.ts", "b.ts"],
        ..LoadSetup::default()
    };
    with_freeze_input(&files, &setup, |input| {
        let sources = freeze_sources(input, &run_serially).unwrap().sources;
        let expected = [
            EntryPoint {
                file: file_at(input.files, "b.ts"),
                kind: EntryPointKind::Main,
            },
            EntryPoint {
                file: file_at(input.files, "a.ts"),
                kind: EntryPointKind::Additional,
            },
        ];
        assert_eq!(sources.entry_points(), expected);
    });
}

#[test]
fn found_entry_point_follows_the_written_ones_under_its_own_name() {
    let files = [("main.ts", "export {};"), ("plugin.ts", "export {};")];
    let setup = LoadSetup {
        entry_points: &["main.ts", "plugin.ts"],
        ..LoadSetup::default()
    };
    with_freeze_input(&files, &setup, |input| {
        let aot = AotOptions::default();
        let options = create_options(&aot, &[], &["main.ts"]);
        let found_entry_points = [FoundEntryPoint {
            source_path: project_path("plugin.ts"),
            name: b"found.js".to_vec(),
            because: FoundBecause::NamedByData,
            started_at: None,
            starts: Vec::new(),
            is_guess: false,
        }];
        let input = FreezeInput {
            options: &options,
            found_entry_points: &found_entry_points,
            ..*input
        };
        let sources = freeze_sources(&input, &run_serially).unwrap().sources;
        let plugin = file_at(input.files, "plugin.ts");
        let expected = [
            EntryPoint {
                file: file_at(input.files, "main.ts"),
                kind: EntryPointKind::Main,
            },
            EntryPoint {
                file: plugin,
                kind: EntryPointKind::Additional,
            },
        ];
        assert_eq!(sources.entry_points(), expected);
        assert_eq!(sources.public_path(plugin), b"/$bunfs/root/found.js");
    });
}

#[test]
fn test_runner_loads_what_a_computed_name_may_reach() {
    let kinds_with = |name: &str| {
        let test = format!(
            "import {{ vi }} from 'bun:test'; import './src/user.ts'; import './other.ts'; await vi.importMock({name});"
        );
        let files = [
            ("a.test.ts", &test[..]),
            ("src/user.ts", "import './counter.ts';"),
            ("src/counter.ts", "export {};"),
            ("other.ts", "export {};"),
        ];
        let setup = LoadSetup {
            entry_points: &["a.test.ts"],
            ..LoadSetup::default()
        };
        with_freeze_input(&files, &setup, |input| {
            let sources = freeze_sources(input, &run_serially).unwrap().sources;
            ["src/user.ts", "src/counter.ts", "other.ts"]
                .map(|name| entry_point_kind(&sources, file_at(input.files, name)))
        })
    };
    let loaded = Some(EntryPointKind::LoadedByTestRunner);
    assert_eq!(kinds_with("'./src/counter.ts'"), [None, loaded, None]);
    assert_eq!(
        kinds_with("import.meta.dir + '/src/' + globalThis.name + '.ts'"),
        [loaded, loaded, None]
    );
    assert_eq!(kinds_with("globalThis.name"), [loaded, loaded, loaded]);
}

#[test]
fn equal_public_paths_are_internal_error() {
    let files = [("a.ts", "export {};"), ("b.ts", "export {};")];
    let setup = LoadSetup {
        entry_points: &["a.ts", "b.ts"],
        ..LoadSetup::default()
    };
    with_freeze_input(&files, &setup, |input| {
        assert!(freeze_sources(input, &run_serially).is_ok());
        let frozen = freeze_with_entry_point_names(input, &["app.js", "app.js"]);
        let error = frozen.err().expect("both entry points are named app.js");
        assert_eq!(error.stage, Stage::Load);
        let prefix = b"two modules have the path /$bunfs/root/app.js: ";
        assert_eq!(error.message.strip_prefix(prefix), Some(&b"a.ts, b.ts"[..]));
    });
}

#[test]
fn projects_cannot_share_a_public_path() {
    let files = [("main.ts", "import 'node:os';")];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        let projects = loaded.projects.as_ref();
        let projects = projects.map(|_, project| (project.loaded.files(), &project.sources));
        assert!(check_unique_paths_across_projects(projects).is_ok());

        let application = projects.application;
        let error = check_unique_paths_across_projects(PerProject {
            application,
            runtime: application,
        })
        .unwrap_err();
        assert_eq!(error.stage, Stage::Load);
        let prefix = b"two modules have the path /$bunfs/root/main.ts: ";
        assert!(error.message.starts_with(prefix));
    });
}

#[test]
fn plugin_module_uses_namespace_and_path() {
    let main = "import config from 'virtual:config';\n\
                import text from 'virtual:config' with { type: 'text' };\n\
                console.log(config, text);";
    let files = [("main.js", main)];
    with_bind_input_and_provider(&files, &default_settings(), &TestPlugins, |input| {
        let sources = input.sources;
        let mut found: Vec<(Loader, &[u8], &[u8])> = file_ids(input.files.modules.len())
            .filter(|&file| {
                parsed_source(input.files, file).is_some_and(|it| it.plugin_module.is_some())
            })
            .map(|file| {
                let paths = sources.module_paths(file);
                (sources.loader(file), paths.public_path, paths.display_path)
            })
            .collect();
        found.sort_by_key(|&(_, public_path, _)| public_path);
        let expected: [(Loader, &[u8], &[u8]); 2] = [
            (Loader::Js, b"v:config", b"v:config"),
            (Loader::Js, b"v:config?text", b"v:config?text"),
        ];
        assert_eq!(found, expected);
    });
}

#[test]
fn second_loader_of_path_has_suffix() {
    let main = "import a from './dep.ts';\n\
                import b from './dep.ts' with { type: 'text' };\n\
                console.log(a, b);";
    let files = [("main.ts", main), ("dep.ts", "export default 1;")];
    with_bind_input(&files, &default_settings(), |input| {
        let expected = vec![
            (Loader::Ts, b"/$bunfs/root/dep.ts".to_vec()),
            (Loader::Text, b"/$bunfs/root/dep.ts?text".to_vec()),
        ];
        assert_eq!(
            public_paths_at(input.files, input.sources, "dep.ts"),
            expected
        );
    });
}

#[test]
fn form_that_attribute_asks_for_stands_under_the_path_where_no_attribute_chooses_the_same() {
    let main = "import note from './note.txt' with { type: 'text' };\nconsole.log(note);";
    let files = [("main.ts", main), ("note.txt", "export default 1;")];
    with_bind_input(&files, &default_settings(), |input| {
        let expected = vec![(Loader::Text, b"/$bunfs/root/note.txt".to_vec())];
        assert_eq!(
            public_paths_at(input.files, input.sources, "note.txt"),
            expected
        );
    });
}

#[test]
fn only_loader_of_path_has_suffix_where_no_attribute_chooses_another() {
    let main = "import note from './note.ts' with { type: 'text' };\nconsole.log(note);";
    let files = [("main.ts", main), ("note.ts", "export default 1;")];
    with_bind_input(&files, &default_settings(), |input| {
        let expected = vec![(Loader::Text, b"/$bunfs/root/note.ts?text".to_vec())];
        assert_eq!(
            public_paths_at(input.files, input.sources, "note.ts"),
            expected
        );
    });
}

#[test]
fn runtime_module_is_a_file_of_the_runtime_project_alone_and_uses_its_specifier() {
    let files = [("main.ts", "import fs from 'node:fs';\nconsole.log(fs);")];
    with_bind_input(&files, &default_settings(), |input| {
        let sources = input.sources;
        assert_eq!(sources.runtime_module_file(RuntimeModule::NodeFs), None);
        assert!(sources.runtime_module_files().is_empty());
        let main = input.files.entry_points()[0];
        assert_eq!(sources.runtime_function(main, b"from"), None);
    });
    with_runtime_bind_input(&files, |input| {
        let sources = input.sources;
        assert_eq!(sources.project(), ProjectId::Runtime);
        let file = sources.runtime_module_file(RuntimeModule::NodeFs).unwrap();
        let paths = sources.module_paths(file);
        assert_eq!(paths.public_path, b"node:fs");
        assert_eq!(paths.display_path, b"node:fs");
        assert_eq!(
            sources.kind(file),
            SourceKind::RuntimeModule(RuntimeModule::NodeFs)
        );
        assert_eq!(sources.runtime_function(file, b"readFile"), None);
    });
}

#[test]
fn runtime_module_files_ascend_by_registry_id() {
    let main = "import 'node:path';\nimport 'node:os';\nimport 'node:fs';";
    with_runtime_bind_input(&[("main.ts", main)], |input| {
        let modules = input.sources.runtime_module_files();
        assert!(modules.is_sorted_by(|a, b| a.0.registry_id() < b.0.registry_id()));
        for imported in [
            RuntimeModule::NodePath,
            RuntimeModule::NodeOs,
            RuntimeModule::NodeFs,
        ] {
            assert!(
                modules.iter().any(|&(module, _)| module == imported),
                "{imported:?}"
            );
        }
        for &(module, file) in modules {
            assert_eq!(
                input.sources.runtime_module_file(module),
                Some(file),
                "{module:?}"
            );
            assert_eq!(input.sources.kind(file), SourceKind::RuntimeModule(module));
        }
    });
}

#[test]
fn runtime_functions_are_found_and_their_files_are_library_entry_points() {
    let mut functions = table::runtime_functions().iter();
    let decorators = functions
        .find(|data| data.file == "prelude/decorators")
        .unwrap();
    with_runtime_bind_input(&[("main.ts", "export {};")], |input| {
        let path = [VIRTUAL_ROOT, b"builtins/JSBufferConstructor.ts"].concat();
        let file = input.files.by_path.get(&path).unwrap();
        assert_eq!(input.sources.kind(file), SourceKind::RuntimeFunctions);
        let id = Archive::embedded()
            .manifest()
            .builtin_function_id(&path, b"from");
        assert!(id.is_some());
        assert_eq!(
            input.sources.runtime_function(file, b"from"),
            id.map(RuntimeFunction)
        );
        assert_eq!(input.sources.runtime_function(file, b"noSuchExport"), None);

        let path = [VIRTUAL_ROOT, decorators.file.as_bytes(), b".ts"].concat();
        let file = input.files.by_path.get(&path).unwrap();
        assert_eq!(input.sources.kind(file), SourceKind::RuntimeFunctions);
        let export_name = decorators.export_name.as_bytes();
        let manifest = Archive::embedded().manifest();
        assert_eq!(manifest.builtin_function_id(&path, export_name), None);
        let found = input.sources.runtime_function(file, export_name);
        assert_eq!(found, Some(decorators.function));
        assert_eq!(input.sources.runtime_function(file, b"noSuchExport"), None);

        let sources = input.sources;
        let entry_points = sources.entry_points();
        assert!(entry_points.is_sorted_by_key(|entry_point| (entry_point.kind, entry_point.file)));
        let libraries: Vec<FileId> = entry_points
            .iter()
            .filter(|entry_point| entry_point.kind == EntryPointKind::Library)
            .map(|entry_point| entry_point.file)
            .collect();
        let compiled_files = input.files.compiled_files().iter().copied();
        let mut function_files: Vec<FileId> = compiled_files
            .filter(|&file| sources.kind(file) == SourceKind::RuntimeFunctions)
            .collect();
        function_files.sort_unstable();
        assert!(!libraries.is_empty());
        assert_eq!(libraries, function_files);

        let is_command_line_file = |entry_point: &EntryPoint| {
            matches!(
                entry_point.kind,
                EntryPointKind::Main | EntryPointKind::Additional
            )
        };
        assert!(!entry_points.iter().any(is_command_line_file));
    });
}

#[test]
fn implied_runtime_module_is_host_loaded() {
    with_runtime_bind_input(&[("main.ts", "process.stdout.write('a');")], |input| {
        let file = input.sources.runtime_module_file(RuntimeModule::NodeTty);
        let kind = entry_point_kind(input.sources, file.unwrap());
        assert_eq!(kind, Some(EntryPointKind::HostLoadedModule));
    });

    let files = [
        ("main.ts", "import 'node:os';"),
        ("/$bun/js/node/os.ts", "export default Bun.sql;"),
    ];
    with_runtime_bind_input(&files, |input| {
        let sources = freeze_runtime_project(input.files, &[]);
        let implied_modules = collect_implied_modules(input.files, &sources);
        assert!(implied_modules.contains(&RuntimeModule::BunSql));
        assert!(!implied_modules.contains(&RuntimeModule::NodeOs));
        let kind_of = |module| entry_point_kind(&sources, sources.runtime_module_file(module)?);
        assert_eq!(
            kind_of(RuntimeModule::BunSql),
            Some(EntryPointKind::HostLoadedModule)
        );
        assert_eq!(
            kind_of(RuntimeModule::NodeOs),
            Some(EntryPointKind::ImportedModule)
        );
        for &(module, file) in sources.runtime_module_files() {
            let expected = if implied_modules.contains(&module) {
                EntryPointKind::HostLoadedModule
            } else {
                EntryPointKind::ImportedModule
            };
            assert_eq!(
                entry_point_kind(&sources, file),
                Some(expected),
                "{module:?}"
            );
        }
    });
}

#[test]
fn imported_runtime_module_is_host_loaded_where_it_is_listed() {
    with_runtime_bind_input(&[("main.ts", "import 'node:os';")], |input| {
        let file = input.sources.runtime_module_file(RuntimeModule::NodeOs);
        let kind = entry_point_kind(input.sources, file.unwrap());
        assert_eq!(kind, Some(EntryPointKind::ImportedModule));
        let kind_with_list = |host_loaded_modules: &[RuntimeModule]| {
            let sources = freeze_runtime_project(input.files, host_loaded_modules);
            let file = sources.runtime_module_file(RuntimeModule::NodeOs)?;
            entry_point_kind(&sources, file)
        };
        let (os, path) = (RuntimeModule::NodeOs, RuntimeModule::NodePath);
        assert_eq!(kind_with_list(&[]), Some(EntryPointKind::ImportedModule));
        assert_eq!(
            kind_with_list(&[path]),
            Some(EntryPointKind::ImportedModule)
        );
        assert_eq!(
            kind_with_list(&[path, os, os]),
            Some(EntryPointKind::HostLoadedModule)
        );
    });
}

#[test]
fn compiled_file_without_payload_is_internal_error() {
    let setup = LoadSetup {
        host: TestHost::DiskWithoutPayloads,
        ..LoadSetup::default()
    };
    with_freeze_input(&[("main.ts", "export {};")], &setup, |input| {
        let main = input.files.entry_points()[0];
        assert!(input.files.is_compiled(main));
        assert!(parsed_source(input.files, main).is_none());
        let error = freeze_sources(input, &run_serially)
            .err()
            .expect("main.ts has no payload");
        assert_eq!(error.stage, Stage::Load);
        assert_eq!(error.message, b"no payload for /project/main.ts");
    });
}

#[test]
fn diagnostics_of_a_payload_land_on_its_file_in_order() {
    let main = "import { value } from './dep.ts';\n\
                import text from './dep.ts' with { type: 'text' };\n\
                export default [value, text];";
    let dependency = "import { double } from './macro.ts' with { type: 'macro' };\n\
                      export const value = double(Math.random());\n\
                      export const other = double(Date.now());";
    let files = [
        ("main.ts", main),
        ("dep.ts", dependency),
        (
            "macro.ts",
            "export function double(n: number) { return 2 * n; }",
        ),
    ];
    with_freeze_input(&files, &LoadSetup::default(), |input| {
        let FrozenSources {
            sources,
            diagnostics,
        } = freeze_sources(input, &run_serially).unwrap();
        let find_compiled_as = |loader: Loader| {
            let mut files = files_at(input.files, "dep.ts").into_iter();
            files.find(|&file| input.files.is_compiled(file) && sources.loader(file) == loader)
        };
        assert!(find_compiled_as(Loader::Text).is_some());
        let script = find_compiled_as(Loader::Ts).unwrap();

        let span_of = |call: &str| {
            let start = dependency.find(call).unwrap() as u32;
            Span {
                file: script,
                start,
                end: start + call.len() as u32,
            }
        };
        let first_call = span_of("double(Math.random())");
        let second_call = span_of("double(Date.now())");
        let reported: Vec<(Code, Option<Span>)> = diagnostics
            .iter()
            .map(|diagnostic| (diagnostic.code, diagnostic.span))
            .collect();
        let expected = [
            (Code::MacrosDisabled, Some(first_call)),
            (Code::MacrosDisabled, Some(second_call)),
        ];
        assert_eq!(reported, expected);
    });
}

#[test]
fn web_assembly_file_is_listed() {
    let main = "import module from './a.wasm';\n\
                import data from './data.json';\n\
                export default [module, data];";
    let files = [("main.ts", main), ("a.wasm", "\0asm"), ("data.json", "{}")];
    with_bind_input_and_provider(&files, &default_settings(), &TestPlugins, |input| {
        let module = file_at(input.files, "a.wasm");
        assert_eq!(input.sources.web_assembly_files(), [module]);
        assert_eq!(input.sources.loader(module), Loader::Wasm);
        let bytes = &parsed_source(input.files, module).unwrap().web_assembly;
        assert_eq!(bytes.as_deref(), Some(&b"\0asm"[..]));
    });
}

#[test]
fn order_of_runs_does_not_change_frozen_files() {
    let names: Vec<String> = (0..200).map(|index| format!("f{index}.ts")).collect();
    let main: String = names
        .iter()
        .map(|name| format!("import './{name}';\n"))
        .collect();
    let mut files = vec![("main.ts", main.as_str())];
    files.extend(names.iter().map(|name| (name.as_str(), "export {};")));
    let in_reverse = |count: usize, work: &(dyn Fn(usize) + Sync)| {
        for index in (0..count).rev() {
            work(index);
        }
    };
    with_freeze_input(&files, &LoadSetup::default(), |input| {
        let expected = freeze_sources(input, &run_serially).unwrap().sources;
        let sources = freeze_sources(input, &in_reverse).unwrap().sources;
        for file in file_ids(input.files.modules.len()) {
            assert_eq!(sources.module_paths(file), expected.module_paths(file));
            assert_eq!(
                sources.diagnostic_path(file),
                expected.diagnostic_path(file)
            );
            assert_eq!(sources.kind(file), expected.kind(file));
        }
    });
}
