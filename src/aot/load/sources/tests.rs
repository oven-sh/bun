use std::borrow::Cow;
use std::num::NonZeroUsize;

use bun_ast::Log;
use bun_builtin_sources::Archive;
use bun_options_types::aot_options::AotOptions;
use bun_sema::atom::Interner;
use bun_sema::check::aot::FileOrigin;
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{ExprKind, FnKind};
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::program::CodeAnswer;
use bun_sema::resolve::{CodeHost, CodeOptions};
use bun_sema::session::{Arena, Session};
use bun_sema_driver::{CompileRequest, EntryPoints, Libs, load_program};
use bun_threading::Guarded;

use super::*;
use crate::builtins::BuiltinNames;
use crate::compile::testing::{
    default_settings, set_up_output, with_bind_input, with_bind_input_and_provider,
    with_loaded_build, with_project_view, with_runtime_bind_input,
};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{InternalError, LoadMessages, Span};
use crate::engine::ExecutableIdentity;
use crate::ir::run_serially;
use crate::load::host::{LoadHost, LoadHostInput, create_disk};
use crate::load::host_platform;
use crate::load::module_paths::{file_ids, is_linkable};
use crate::load::project::PerProject;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, Resolution, ResolveRequest, SourceFile,
    SourceProvider, WithoutServices,
};
use crate::options::{LoadOptions, Options, PathOptions};
use crate::statistics::{LimitId, LimitValues, Loss, Stage};

const VIRTUAL_PAGE: &[u8] = b"page.html";

#[derive(Default)]
struct TestPlugins {
    page_paths: Guarded<Vec<Vec<u8>>>,
}

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
        let path: &[u8] = match request.specifier {
            b"virtual:config" => b"config",
            b"virtual:page" => VIRTUAL_PAGE,
            _ => return WithoutServices.resolve(request, log),
        };
        Ok(Resolution::Module {
            namespace: b"v".to_vec(),
            path: path.to_vec(),
        })
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        if request.module.namespace != b"v" {
            return WithoutServices.load(request, log);
        }
        let (text, loader): (&'static [u8], Loader) = match request.module.path {
            VIRTUAL_PAGE => (b"<html></html>", Loader::Html),
            _ => (b"export default 1;", Loader::Js),
        };
        Ok(Loaded::Source {
            contents: Cow::Borrowed(text),
            loader,
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
    ) -> Result<DataModule<'s>, Failed> {
        match file.loader {
            Loader::Html => {
                self.page_paths.lock().push(file.path.to_vec());
                Ok(DataModule::Page)
            }
            Loader::Wasm => Ok(DataModule::RuntimeRequire {
                specifier: atoms.intern(file.path),
                loader_type: None,
                member: None,
            }),
            _ => WithoutServices.parse_data(file, arena, atoms, log),
        }
    }

    fn run_macro<'s>(
        &self,
        call: &MacroCall<'_, 's>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<&'s DataValue<'s>, Failed> {
        WithoutServices.run_macro(call, arena, atoms, log)
    }

    fn bundle_pages<'s>(
        &self,
        pages: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<Vec<&'s DataValue<'s>>, Failed> {
        WithoutServices.bundle_pages(pages, arena, atoms, log)
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
    max_string_bytes: usize,
}

impl Default for LoadSetup<'static> {
    fn default() -> LoadSetup<'static> {
        LoadSetup {
            host: TestHost::Application,
            entry_points: &["main.ts"],
            max_string_bytes: usize::MAX,
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
    let limits = LimitValues::for_host();
    let application_host = LoadHost::new(LoadHostInput {
        disk: &disk,
        provider: &WithoutServices,
        options: &options,
        runtime_modules: &runtime_modules,
        messages: &messages,
        builtin_names: &builtin_names,
        platform: host_platform(),
        limits: &limits,
    });
    let host: &dyn CodeHost = match setup.host {
        TestHost::Application => &application_host,
        TestHost::DiskWithoutPayloads => &disk,
    };
    let fold_options = FoldOptions {
        max_string_bytes: setup.max_string_bytes,
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
    };
    let loaded = load_program(&session, host, &request).expect("every entry point is found");
    then(&FreezeInput {
        project: ProjectId::Application,
        files: loaded.files(),
        options: &options,
        manifest: archive.manifest(),
        host_loaded_modules: &[],
        is_world: false,
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
        is_world: false,
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
    assert_eq!(SourceKind::EvaluatedText.lowering_kind(), program);
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
            assert!(!payload.is_some_and(|it| it.is_from_plugin), "{name}");
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
        assert_eq!(sources.diagnostic_path(main), b"/project/main.ts");
        assert_eq!(sources.kind(main), SourceKind::Program);
        let expected = vec![(Loader::Jsx, b"/$bunfs/root/app.js?jsx".to_vec())];
        assert_eq!(public_paths_at(input.files, &sources, "app.js"), expected);
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
            assert_eq!(public_path, b"/$bunfs/root/_.._/out/app.js");
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
    let provider = TestPlugins::default();
    with_bind_input_and_provider(&files, &default_settings(), &provider, |input| {
        let sources = input.sources;
        let mut found: Vec<(Loader, &[u8], &[u8])> = file_ids(input.files.modules.len())
            .filter(|&file| parsed_source(input.files, file).is_some_and(|it| it.is_from_plugin))
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
fn only_loader_of_path_has_no_suffix() {
    let main = "import note from './note.ts' with { type: 'text' };\nconsole.log(note);";
    let files = [("main.ts", main), ("note.ts", "export default 1;")];
    with_bind_input(&files, &default_settings(), |input| {
        let expected = vec![(Loader::Text, b"/$bunfs/root/note.ts".to_vec())];
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
fn macro_diagnostic_lands_on_its_file() {
    let main = "import { value } from './dep.ts';\n\
                import text from './dep.ts' with { type: 'text' };\n\
                export default [value, text];";
    let dependency = "import { double } from './macro.ts' with { type: 'macro' };\n\
                      export const value = double(Math.random());";
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
            ..
        } = freeze_sources(input, &run_serially).unwrap();
        let find_compiled_as = |loader: Loader| {
            let mut files = files_at(input.files, "dep.ts").into_iter();
            files.find(|&file| input.files.is_compiled(file) && sources.loader(file) == loader)
        };
        assert!(find_compiled_as(Loader::Text).is_some());
        let script = find_compiled_as(Loader::Ts).unwrap();

        let argument = "Math.random()";
        let start = dependency.find(argument).unwrap() as u32;
        let span = Span {
            file: script,
            start,
            end: start + argument.len() as u32,
        };
        let reported: Vec<(Code, Option<Span>)> = diagnostics
            .iter()
            .map(|diagnostic| (diagnostic.code, diagnostic.span))
            .collect();
        assert_eq!(reported, [(Code::MacroArgumentNotConstant, Some(span))]);
    });
}

#[test]
fn page_is_listed_with_provider_path() {
    let main = "import page from './index.html';\n\
                import other from 'virtual:page';\n\
                import data from './data.json';\n\
                export default [page, other, data];";
    let files = [
        ("main.ts", main),
        ("index.html", "<html></html>"),
        ("data.json", "{}"),
    ];
    let provider = TestPlugins::default();
    with_bind_input_and_provider(&files, &default_settings(), &provider, |input| {
        let pages = input.sources.pages();
        assert!(pages.is_sorted_by(|a, b| a.0 < b.0));
        for &(file, _) in pages {
            assert!(input.sources.is_data(file));
            assert_eq!(input.sources.loader(file), Loader::Html);
        }
        let mut listed_paths: Vec<&[u8]> = pages.iter().map(|(_, path)| &**path).collect();
        listed_paths.sort_unstable();
        let expected: [&[u8]; 2] = [b"/project/index.html", VIRTUAL_PAGE];
        assert_eq!(listed_paths, expected);
        let mut parsed_paths = provider.page_paths.lock().clone();
        parsed_paths.sort_unstable();
        assert_eq!(parsed_paths, expected);
    });
}

#[test]
fn web_assembly_file_is_listed() {
    let main = "import module from './a.wasm';\n\
                import data from './data.json';\n\
                export default [module, data];";
    let files = [("main.ts", main), ("a.wasm", "\0asm"), ("data.json", "{}")];
    let provider = TestPlugins::default();
    with_bind_input_and_provider(&files, &default_settings(), &provider, |input| {
        let module = file_at(input.files, "a.wasm");
        assert_eq!(input.sources.web_assembly_files(), [module]);
        assert_eq!(input.sources.loader(module), Loader::Wasm);
        let bytes = &parsed_source(input.files, module).unwrap().web_assembly;
        assert_eq!(bytes.as_deref(), Some(&b"\0asm"[..]));
    });
}

#[test]
fn evaluated_function_is_found_by_file_and_call() {
    let source = r#"export const getGlobal = Function("return this");"#;
    with_project_view(&[("main.js", source)], |view| {
        let (files, sources) = (view.files(), view.sources);
        let main = sources.entry_points()[0].file;
        let [((file, call), function)] = *sources.evaluated_functions_of(main) else {
            panic!("expected one compiled text");
        };
        assert_eq!(file, main);
        let ExprKind::Call(call_record) = files.hir(main)[call].kind else {
            panic!("expected a call");
        };
        assert_eq!(sources.evaluated_function(main, call), Some(function));
        assert_eq!(sources.evaluator_of(function.file), Some(main));
        assert_eq!(sources.evaluator_of(main), None);

        assert_eq!(sources.kind(function.file), SourceKind::EvaluatedText);
        let text = parsed_source(files, function.file).unwrap();
        assert_eq!(text.evaluated_function, Some(function.function));
        assert_eq!(
            files.hir(function.file)[function.function].kind,
            FnKind::Expr
        );
        let paths = sources.module_paths(function.file);
        assert!(paths.public_path.starts_with(b"/$bun/text/"));
        assert_eq!(paths.display_path, paths.public_path);
        assert_eq!(sources.diagnostic_path(function.file), paths.public_path);

        let callee = files.hir(main)[call_record].callee;
        assert_eq!(sources.evaluated_function(main, callee), None);
        assert_eq!(sources.evaluated_function(function.file, call), None);
        assert!(sources.evaluated_functions_of(function.file).is_empty());
    });
}

#[test]
fn uncompiled_text_has_no_function() {
    let source = r#"export const getRequire = Function("return require");"#;
    with_project_view(&[("main.js", source)], |view| {
        let (files, sources) = (view.files(), view.sources);
        let main = sources.entry_points()[0].file;
        let [site] = parsed_source(files, main).unwrap().evaluated_text_sites[..] else {
            panic!("expected one evaluated text");
        };
        let implied_answers = files.compiled(main).unwrap().implied_answers;
        let CodeAnswer::File(text_file) = implied_answers[site.implied_answer as usize] else {
            panic!("expected the file of the text");
        };
        assert_eq!(sources.kind(text_file), SourceKind::EvaluatedText);
        assert_eq!(
            parsed_source(files, text_file).unwrap().evaluated_function,
            None
        );
        assert_eq!(sources.evaluated_function(main, site.call), None);
        assert!(sources.evaluated_functions_of(main).is_empty());
    });
}

#[test]
fn folded_string_over_limit_is_a_loss_with_span() {
    let source = "export const long = 'abc' + 'def';\nexport const short = 'ab' + 'cd';";
    let setup = LoadSetup {
        max_string_bytes: 4,
        ..LoadSetup::default()
    };
    with_freeze_input(&[("main.ts", source)], &setup, |input| {
        let counters = freeze_sources(input, &run_serially).unwrap().counters;
        let sum = "'abc' + 'def'";
        let start = source.find(sum).unwrap() as u32;
        let expected = Loss {
            limit: LimitId::MaxFoldedStringBytes,
            subject: Some(Span {
                file: input.files.entry_points()[0],
                start,
                end: start + sum.len() as u32,
            }),
            count: 1,
        };
        assert_eq!(counters.losses(), [expected]);
    });
    with_freeze_input(&[("main.ts", source)], &LoadSetup::default(), |input| {
        assert!(
            freeze_sources(input, &run_serially)
                .unwrap()
                .counters
                .losses()
                .is_empty()
        );
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
