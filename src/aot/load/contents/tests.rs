use std::borrow::Cow;
use std::fmt::Write;
use std::num::NonZeroU32;

use bstr::BStr;
use bun_ast::{Loader, Log};
use bun_core::strings;
use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::FoldOptions;
use bun_sema::hir::ExprId;
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::import_sites::{ENCODERS, ImportSiteKind, ImportSpecifier};
use bun_sema::program::{FileId, Files};
use bun_sema::session::Arena;

use super::load_names::{
    find_library_modules_that_unknown_names_may_stand_for, modules_named_in, names_plugin,
};
use super::worker_entries::source_path_of;
use super::{
    FileContents, FoundBecause, FoundEntryPoint, PlaceOfName, ProgramContents, WorkerNameForm,
    WorkerStart,
};
use crate::builtins::RuntimeModule::{
    self, BunWrap, NodeDgram, NodeOs, NodeTty, NodeV8, NodeVm, NodeZlib,
};
use crate::builtins::{BuiltinId, Mutability, Resolved};
use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, run_build};
use crate::compile::{Build, LoadedBuild};
use crate::load::ProjectId;
use crate::load::source_provider::{
    DataFailure, DeferredLoad, Failed, LoadRequest, Loaded, ModuleName, Resolution, ResolveRequest,
    SourceFile, SourceProvider, WithoutServices,
};
use crate::load::sources::parsed_source;
use crate::module_keys::name_of_text;

const WORKER: &str = "postMessage(1);";
const PATH_OF_COPY: &[u8] = b"/$bunfs/root/w-0a1b2c3d.ts";
const PATH_OF_WORKER: &[u8] = b"/project/w.ts";
const TEXT_MADE_BY_PLUGIN: &[u8] = b"made by a plugin";
const PARTS: usize = 48;

struct EmbedsFiles;

impl SourceProvider for EmbedsFiles {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        WithoutServices.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn has_resolve_plugins(&self) -> bool {
        false
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, _module: ModuleName<'_>) -> bool {
        false
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        WithoutServices.finish_deferred_loads(log)
    }

    fn decode_data_url(&self, url: &[u8]) -> Option<Vec<u8>> {
        let comma = strings::index_of_char_usize(url, b',')?;
        let digit = |digit: u8| (digit as char).to_digit(16);
        let mut text = Vec::new();
        let mut rest = &url[comma + 1..];
        while let [byte, following @ ..] = rest {
            rest = following;
            if let (b'%', [high, low, following @ ..]) = (*byte, rest) {
                text.push((digit(*high)? * 16 + digit(*low)?) as u8);
                rest = following;
            } else {
                text.push(*byte);
            }
        }
        Some(text)
    }

    fn loader_of_blob(&self, r#type: Option<&[u8]>) -> Option<Loader> {
        r#type.is_none().then_some(Loader::Tsx)
    }

    fn write_url(&self, text: &[u8], base: Option<&[u8]>) -> Option<Vec<u8>> {
        let Some(base) = base.filter(|_| text.starts_with(b".")) else {
            let mut url = Vec::new();
            for &byte in text {
                match byte.is_ascii() {
                    true => url.push(byte),
                    false => url.extend(format!("%{byte:02X}").into_bytes()),
                }
            }
            return Some(url);
        };
        let mut segments: Vec<&[u8]> = strings::split(base, b"/").collect();
        segments.pop();
        for segment in strings::split(text, b"/") {
            match segment {
                b"." => {}
                b".." => {
                    segments.pop();
                }
                _ => segments.push(segment),
            }
        }
        Some(segments.join(&b"/"[..]))
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        match file.loader {
            Loader::File => Ok(DataModule::Value {
                default: arena.alloc(DataValue::String(atoms.intern(PATH_OF_COPY))),
                exports_keys: false,
            }),
            _ => WithoutServices.parse_data(file, arena, atoms, log),
        }
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        WithoutServices.check_embedded_files(log)
    }
}

struct EmbedsWhatPluginMakes {
    asset_paths_ignore_contents: bool,
}

impl SourceProvider for EmbedsWhatPluginMakes {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        EmbedsFiles.fold_options(arena, atoms, log)
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        EmbedsFiles.resolve(request, log)
    }

    fn has_resolve_plugins(&self) -> bool {
        false
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        match request.module.path == PATH_OF_WORKER {
            true => Ok(Loaded::Source {
                contents: Cow::Borrowed(TEXT_MADE_BY_PLUGIN),
                loader: Loader::File,
                is_from_plugin: true,
            }),
            false => EmbedsFiles.load(request, log),
        }
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        module.path == PATH_OF_WORKER
    }

    fn finish_deferred_loads(&self, log: &mut Log) -> Vec<DeferredLoad> {
        EmbedsFiles.finish_deferred_loads(log)
    }

    fn asset_paths_ignore_contents(&self) -> bool {
        self.asset_paths_ignore_contents
    }

    fn parse_data<'s>(
        &self,
        file: &SourceFile<'_>,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> Result<DataModule<'s>, DataFailure> {
        EmbedsFiles.parse_data(file, arena, atoms, log)
    }

    fn check_embedded_files(&self, log: &mut Log) -> Result<(), Failed> {
        EmbedsFiles.check_embedded_files(log)
    }
}

fn executable(files: &[(&str, &str)]) -> TestProject {
    TestProject::new(files, &default_settings())
}

fn test_run(files: &[(&str, &str)]) -> TestProject {
    let mut project = executable(files);
    project.runs_tests = true;
    project
}

fn load_from<R>(
    project: &TestProject,
    provider: &dyn SourceProvider,
    then: impl FnOnce(&Build<'_>, &LoadedBuild<'_, '_>) -> R,
) -> R {
    run_build(project, BUNDLED_LIBS, provider, |build| {
        build.with_loaded_projects(|build, loaded| Ok(then(build, &loaded)))
    })
}

fn load<R>(project: &TestProject, then: impl FnOnce(&LoadedBuild<'_, '_>) -> R) -> R {
    load_from(project, &EmbedsFiles, |_, loaded| then(loaded))
}

fn files_of<'l, 's>(loaded: &'l LoadedBuild<'_, 's>) -> &'l Files<'s> {
    loaded.project(ProjectId::Application).loaded.files()
}

fn find_file(files: &Files<'_>, name: &str) -> Option<FileId> {
    let file = files.by_path.get(format!("/project/{name}").as_bytes())?;
    files.is_compiled(file).then_some(file)
}

fn file_named(files: &Files<'_>, name: &str) -> FileId {
    find_file(files, name).unwrap_or_else(|| panic!("{name} is not in the program"))
}

fn contents_of<'s>(files: &Files<'s>, name: &str) -> &'s FileContents {
    let source = parsed_source(files, file_named(files, name));
    &source.expect("every compiled file has a payload").contents
}

fn holds_library_module(loaded: &LoadedBuild<'_, '_>, module: RuntimeModule) -> bool {
    let library = &loaded.project(ProjectId::Runtime).sources;
    library.runtime_module_file(module).is_some()
}

fn text_of(files: &Files<'_>, atom: Atom) -> String {
    BStr::new(files.atoms.bytes(atom)).to_string()
}

fn describe_name(files: &Files<'_>, file: FileId, name: &ImportSpecifier) -> String {
    let alternatives = files.analysis(file).alternatives_of(name).iter();
    let texts: Vec<String> = alternatives
        .map(|alternative| match *alternative {
            ImportSpecifier::Constant(text) => text_of(files, text),
            ImportSpecifier::Pattern { prefix, suffix } => {
                format!("{}*{}", text_of(files, prefix), text_of(files, suffix))
            }
            ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => "?".to_owned(),
        })
        .collect();
    texts.join(" | ")
}

fn describe_start(files: &Files<'_>, file: FileId, start: &WorkerStart) -> String {
    let name = describe_name(files, file, &start.name);
    format!("{:?} {name}", start.form)
}

fn describe_starts(files: &Files<'_>, name: &str, are_given_to_constructor: bool) -> Vec<String> {
    let file = file_named(files, name);
    let starts = contents_of(files, name).worker_starts.iter();
    starts
        .filter(|start| (start.place == PlaceOfName::Constructor) == are_given_to_constructor)
        .map(|start| describe_start(files, file, start))
        .collect()
}

fn describe_found(found: &[FoundEntryPoint]) -> Vec<String> {
    let found = found.iter();
    found
        .map(|it| format!("{} {:?}", BStr::new(&it.name), it.because))
        .collect()
}

fn describe_names_written(build: &Build<'_>) -> Vec<String> {
    let names = build.started_workers.names.iter();
    names
        .map(|it| {
            let (name, file) = (BStr::new(&it.public_path), BStr::new(&it.source_path));
            format!("{name} {file}")
        })
        .collect()
}

fn describe_entry_points(loaded: &LoadedBuild<'_, '_>) -> Vec<String> {
    let files = files_of(loaded);
    let sources = &loaded.project(ProjectId::Application).sources;
    let entry_points = sources.entry_points().iter();
    entry_points
        .map(|entry| {
            let path = source_path_of(files.module(entry.file).file_name());
            format!("{:?} {}", entry.kind, BStr::new(&path))
        })
        .collect()
}

fn assert_found_follow_written(loaded: &LoadedBuild<'_, '_>, written_count: usize) {
    let found = loaded.contents.found_entry_points.iter();
    let found: Vec<String> = found
        .map(|it| format!("Additional {}", BStr::new(&it.source_path)))
        .collect();
    assert_eq!(describe_entry_points(loaded)[written_count..], found);
}

fn describe_names_added(files: &Files<'_>, contents: &ProgramContents) -> Vec<String> {
    let added = contents.names_added_to_builtins.iter();
    added
        .map(|&(holder, name)| format!("{holder:?}.{}", text_of(files, name)))
        .collect()
}

fn flags_of(loaded: &LoadedBuild<'_, '_>) -> [bool; 7] {
    let contents = loaded.contents;
    [
        contents.mocks_any_module,
        contents.any_module_loads_again,
        contents.loads_by_unknown_name,
        contents.loads_by_unknown_path,
        names_plugin(files_of(loaded)),
        contents.names_worker_constructor,
        contents.hands_worker_constructor_on,
    ]
}

fn describe_file_contents(files: &Files<'_>, file: FileId, contents: &FileContents) -> String {
    let names = &contents.names;
    let modules = names.modules.iter();
    let modules: Vec<String> = modules
        .map(|it| {
            format!(
                "{} {} {:?}",
                it.argument.0,
                text_of(files, it.name),
                it.module
            )
        })
        .collect();
    let starts = contents.worker_starts.iter();
    let starts: Vec<String> = starts
        .map(|it| {
            let places = (it.at.0, it.name_node.0, it.place);
            format!("{places:?} {}", describe_start(files, file, it))
        })
        .collect();
    let flags = [
        names.loads_by_unknown_name,
        names.loads_by_path_alone,
        names.loads_by_unknown_path,
        contents.names_worker_constructor,
        contents.hands_worker_constructor_on,
        contents.starts_worker_out_of_sight,
    ];
    format!(
        "{modules:?} {:?} {:?} {:?} {:?} {starts:?} {flags:?}",
        names.written_as_values,
        names.unknown_names_at,
        names.files_missing_at_build_at,
        names.data_missing_at_build_at
    )
}

fn describe_program(loaded: &LoadedBuild<'_, '_>) -> String {
    let (files, contents) = (files_of(loaded), loaded.contents);
    let found = contents.found_entry_points.iter();
    let found: Vec<String> = found
        .map(|it| {
            let started_at = it.started_at.as_ref();
            let started_at = started_at.map(|(file, at)| format!("{}:{at}", BStr::new(file)));
            let (path, name) = (BStr::new(&it.source_path), BStr::new(&it.name));
            format!("{path} {name} {:?} {started_at:?}", it.because)
        })
        .collect();
    let mut text = format!(
        "{found:#?}\n{:?}\n{:?}\n{:?}\n{:#?}\n",
        contents.replaced_builtins,
        describe_names_added(files, contents),
        flags_of(loaded),
        describe_entry_points(loaded)
    );
    for &file in files.compiled_files() {
        let Some(source) = parsed_source(files, file) else {
            continue;
        };
        let path = BStr::new(files.module(file).file_name());
        let described = describe_file_contents(files, file, &source.contents);
        let _ = writeln!(text, "{path} {described}");
    }
    text
}

fn argument_of_only_load(files: &Files<'_>, file: FileId) -> ExprId {
    let [site] = files.analysis(file).import_sites[..] else {
        panic!("the file has one import site");
    };
    site.specifier_node
}

fn mutabilities_of(files: &Files<'_>, name: &str, builtin: BuiltinId) -> Vec<Mutability> {
    let file = file_named(files, name);
    let source = parsed_source(files, file).expect("every compiled file has a payload");
    let expressions = (0..files.hir(file).exprs.len() as u32).map(ExprId);
    expressions
        .filter_map(|expression| match source.builtins.of_expr(expression) {
            Some(Resolved::Builtin(path)) if path.id == builtin => Some(path.mutability),
            _ => None,
        })
        .collect()
}

#[test]
fn each_form_of_a_name_finds_the_file_that_the_worker_starts_from() {
    let forms: [(&str, &str, &[&str], &[&str]); 7] = [
        (
            "src/start.ts",
            r#"new Worker("./w.ts");"#,
            &["AsWritten ./w.ts"],
            &["w.ts"],
        ),
        (
            "src/start.ts",
            r#"new Worker(import.meta.dir + "/w.ts");"#,
            &["FromOwnFolder ./w.ts"],
            &["src/w.ts"],
        ),
        (
            "src/start.ts",
            r#"new Worker(new URL("./w.ts", import.meta.url));"#,
            &["FromOwnFolder ./w.ts", "Resolved(UrlObject) ./w.ts"],
            &["src/w.ts"],
        ),
        (
            "src/start.cjs",
            r#"new Worker(require.resolve("./w.ts"));"#,
            &["Resolved(Path) ./w.ts"],
            &["src/w.ts"],
        ),
        (
            "src/start.ts",
            r#"new Worker(import.meta.resolve("./w.ts"));"#,
            &["Resolved(Url) ./w.ts"],
            &["src/w.ts"],
        ),
        (
            "src/start.ts",
            r#"new Worker(process.argv[2] ? "./w.ts" : "./src/w.ts");"#,
            &["AsWritten ./src/w.ts | ./w.ts"],
            &["src/w.ts", "w.ts"],
        ),
        (
            "src/start.ts",
            r#"new Worker(import.meta.dir + "/pool/" + process.argv[2] + ".ts");"#,
            &["FromOwnFolder ./pool/*.ts"],
            &["src/pool/a.ts", "src/pool/b.ts"],
        ),
    ];
    for (file, text, accepted, found) in forms {
        let main = format!("import \"./{file}\";");
        let project = executable(&[
            ("main.ts", &main),
            (file, text),
            ("w.ts", WORKER),
            ("src/w.ts", WORKER),
            ("src/pool/a.ts", WORKER),
            ("src/pool/b.ts", WORKER),
        ]);
        load(&project, |loaded| {
            let starts = describe_starts(files_of(loaded), file, true);
            let [start] = &starts[..] else {
                panic!("{text}: {starts:?}");
            };
            assert!(accepted.contains(&start.as_str()), "{text}: {start}");
            let mut names = describe_found(&loaded.contents.found_entry_points);
            names.sort_unstable();
            let expected = found.iter().map(|name| format!("{name} StartsWorker"));
            assert_eq!(names, expected.collect::<Vec<String>>(), "{text}");
            assert_found_follow_written(loaded, 1);
        });
    }
}

#[test]
fn preloads_are_entry_points() {
    let rows: [(&str, &str, &[&str]); 8] = [
        ("", r#"{ preload: "./first.ts" }"#, &["first.ts"]),
        (
            "",
            r#"{ preload: ["./second.ts", "./first"] }"#,
            &["first.ts", "second.ts"],
        ),
        (
            r#"const options = { preload: ["./first.ts"] };"#,
            "options",
            &["first.ts"],
        ),
        (
            r#"const more = { preload: "./first.ts" };"#,
            r#"{ name: "spread", ...more }"#,
            &["first.ts"],
        ),
        (
            r#"const preload = ["./second.ts", "./first.ts"];"#,
            "{ preload }",
            &["first.ts", "second.ts"],
        ),
        (
            r#"const first = "./first.ts";"#,
            "{ preload: [first] as string[] }",
            &["first.ts"],
        ),
        (
            r#"const options: object = { ...options, preload: "./first.ts" };"#,
            "options",
            &["first.ts"],
        ),
        ("", r#"{ name: "./first.ts" }"#, &[]),
    ];
    for (before, options, preloaded) in rows {
        let main = format!(r#"{before} new Worker("./w.ts", {options});"#);
        let project = executable(&[
            ("main.ts", &main),
            ("w.ts", WORKER),
            ("first.ts", WORKER),
            ("second.ts", WORKER),
        ]);
        load(&project, |loaded| {
            let mut names = describe_found(&loaded.contents.found_entry_points);
            names.sort_unstable();
            let expected = preloaded.iter().chain(&["w.ts"]);
            let expected = expected.map(|name| format!("{name} StartsWorker"));
            assert_eq!(names, expected.collect::<Vec<String>>(), "{main}");
            assert_found_follow_written(loaded, 1);
        });
    }
}

#[test]
fn file_whose_copy_a_worker_starts_from_is_compiled() {
    let project = executable(&[
        (
            "main.ts",
            r#"import path from "./w.ts" with { type: "file" }; new Worker(path);"#,
        ),
        ("w.ts", WORKER),
    ]);
    load(&project, |loaded| {
        let files = files_of(loaded);
        let main = file_named(files, "main.ts");
        let [start] = contents_of(files, "main.ts").worker_starts[..] else {
            panic!("the file has one start");
        };
        let WorkerNameForm::EmbeddedFile(site) = start.form else {
            panic!("{:?}", start.form);
        };
        let site = files.analysis(main).import_sites[site as usize];
        assert!(matches!(site.kind, ImportSiteKind::Import(_)));
        assert_eq!(describe_name(files, main, &site.specifier), "./w.ts");
        assert_eq!(start.place, PlaceOfName::Constructor);
        let [found] = &loaded.contents.found_entry_points[..] else {
            panic!("one file is found");
        };
        let source_path = source_path_of(b"/project/w.ts");
        assert_eq!(BStr::new(&found.source_path), BStr::new(&source_path));
        assert_eq!(found.because, FoundBecause::StartsWorker);
        assert_found_follow_written(loaded, 1);
    });
}

#[test]
fn copy_that_a_plugin_makes_is_no_entry_point() {
    let project = executable(&[
        (
            "main.ts",
            r#"import path from "./w.ts" with { type: "file" }; new Worker(path);"#,
        ),
        ("w.ts", WORKER),
    ]);
    for asset_paths_ignore_contents in [false, true] {
        let provider = EmbedsWhatPluginMakes {
            asset_paths_ignore_contents,
        };
        load_from(&project, &provider, |_, loaded| {
            let [start] = contents_of(files_of(loaded), "main.ts").worker_starts[..] else {
                panic!("the file has one start");
            };
            let is_embedded = matches!(start.form, WorkerNameForm::EmbeddedFile(_));
            assert!(is_embedded, "{:?}", start.form);
            let found = describe_found(&loaded.contents.found_entry_points);
            assert!(found.is_empty(), "{asset_paths_ignore_contents}: {found:?}");
        });
    }
}

#[test]
fn build_outside_the_root_directory_looks_from_the_working_directory_first() {
    let rows: [(&str, &[&str], &[&str], &[(&str, &str)]); 5] = [
        (r#""./w.ts""#, &["src/w.ts"], &["w.ts"], &[]),
        (
            r#""./src/w.ts""#,
            &["src/w.ts"],
            &["w.ts"],
            &[("./src/w.ts", "src/w.ts")],
        ),
        (
            r#""./w.ts""#,
            &["w.ts", "src/w.ts"],
            &["../w.ts"],
            &[("./w.ts", "w.ts")],
        ),
        (
            r#"process.argv[2] ? "./w.ts" : "./src/v.ts""#,
            &["src/w.ts", "src/v.ts"],
            &["v.ts", "w.ts"],
            &[("./src/v.ts", "src/v.ts")],
        ),
        (
            r#""./jobs/" + process.argv[2] + ".ts""#,
            &["jobs/a.ts", "src/jobs/b.ts"],
            &["../jobs/a.ts", "jobs/b.ts"],
            &[("./jobs/a.ts", "jobs/a.ts")],
        ),
    ];
    for (given, on_disk, found, written) in rows {
        let main = format!("new Worker({given});");
        let mut files = vec![("src/main.ts", &main[..])];
        files.extend(on_disk.iter().map(|&file| (file, WORKER)));
        let mut project = executable(&files);
        project.root_directory = Some(b"/project/src");
        load_from(&project, &EmbedsFiles, |build, loaded| {
            let expected = found.iter().map(|name| format!("{name} StartsWorker"));
            assert_eq!(
                describe_found(&loaded.contents.found_entry_points),
                expected.collect::<Vec<String>>(),
                "{given} beside {on_disk:?}"
            );
            let expected = written.iter().map(|(name, file)| {
                let file = source_path_of(format!("/project/{file}").as_bytes());
                format!("{name} {}", BStr::new(&file))
            });
            assert_eq!(
                describe_names_written(build),
                expected.collect::<Vec<String>>(),
                "{given} beside {on_disk:?}"
            );
            assert_found_follow_written(loaded, 1);
        });
    }
}

#[test]
fn name_like_text_leads_only_to_root_directory_files() {
    let rows: [(&str, &[&str], &[&str], &str); 8] = [
        ("./w.ts", &["src/w.ts"], &["w.ts"], ""),
        ("./w.ts", &["w.ts"], &[], "w.ts (named \"./w.ts\" at "),
        ("./w.ts", &["w.ts", "src/w.ts"], &["w.ts"], ""),
        ("./src/w.ts", &["src/w.ts"], &["w.ts"], ""),
        ("../w.ts", &["w.ts"], &[], "w.ts (named \"../w.ts\" at "),
        ("../src/w.ts", &["src/w.ts"], &["w.ts"], ""),
        (
            "./lib/w.ts",
            &["lib/w.ts"],
            &[],
            "lib/w.ts (named \"./lib/w.ts\" at ",
        ),
        ("./absent.ts", &["w.ts", "src/w.ts"], &[], ""),
    ];
    for (text, on_disk, found, left_out) in rows {
        let main = format!("import {{ start }} from \"./pool.ts\";\nstart(\"{text}\");\n");
        let pool = "export const start = (entry: string) => new Worker(entry);\n";
        let mut files = vec![("src/main.ts", &main[..]), ("src/pool.ts", pool)];
        files.extend(on_disk.iter().map(|&file| (file, WORKER)));
        let mut project = executable(&files);
        project.root_directory = Some(b"/project/src");
        load_from(&project, &EmbedsFiles, |build, loaded| {
            let expected = found.iter().map(|name| format!("{name} MayStartWorker"));
            assert_eq!(
                describe_found(&loaded.contents.found_entry_points),
                expected.collect::<Vec<String>>(),
                "{text} beside {on_disk:?}"
            );
            let said = &build.started_workers.names_left_out;
            assert_eq!(
                said.is_empty(),
                left_out.is_empty(),
                "{text} beside {on_disk:?}"
            );
            let said = BStr::new(said).to_string();
            assert!(said.contains(left_out), "{text} beside {on_disk:?}: {said}");
        });
    }
}

#[test]
fn what_is_left_of_a_path_that_goes_up_past_the_root_is_written_down_in_each_form() {
    let job = ("/jobs/job.ts", "one/jobs/job.ts");
    let rows: [(&str, &[(&str, &str)]); 8] = [
        (
            r#""/$bunfs/root/_.._/beside.ts""#,
            &[("/$bunfs/root/_.._/beside.ts", "one/two/beside.ts")],
        ),
        (r#"import.meta.dir + "/../../jobs/job.ts""#, &[job]),
        (r#"new URL("../../jobs/job.ts", import.meta.url)"#, &[job]),
        (r#"import.meta.resolve("../../jobs/job.ts")"#, &[job]),
        (
            r#"new URL(process.argv[2] ? "../../jobs/job.ts" : "../../../top.ts", import.meta.url)"#,
            &[job, ("/top.ts", "top.ts")],
        ),
        (
            r#"new URL("../../jobs/" + process.argv[2] + ".ts", import.meta.url)"#,
            &[job],
        ),
        (
            r#"join(import.meta.dir, "../../jobs", process.argv[2] + ".ts")"#,
            &[job],
        ),
        (r#"new URL("../beside.ts", import.meta.url)"#, &[]),
    ];
    for (given, written) in rows {
        let main = format!(r#"import {{ join }} from "node:path"; new Worker({given});"#);
        let mut project = executable(&[
            ("one/two/app/main.ts", &main[..]),
            ("one/two/beside.ts", WORKER),
            ("one/jobs/job.ts", WORKER),
            ("top.ts", WORKER),
        ]);
        project.root_directory = Some(b"/project/one/two/app");
        load_from(&project, &EmbedsFiles, |build, loaded| {
            let expected = written.iter().map(|(name, file)| {
                let file = source_path_of(format!("/project/{file}").as_bytes());
                format!("{name} {}", BStr::new(&file))
            });
            assert_eq!(
                describe_names_written(build),
                expected.collect::<Vec<String>>(),
                "{given}"
            );
            assert!(!loaded.contents.found_entry_points.is_empty(), "{given}");
        });
    }
}

#[test]
fn url_of_a_file_above_the_root_says_the_path_of_what_lies_further_up() {
    let rows: [(&str, &[(&str, &str)]); 5] = [
        ("./helper.ts", &[]),
        ("../helper.ts", &[]),
        ("../../helper.ts", &[]),
        (
            "../app/inner.ts",
            &[("/$bunfs/_.._/_.._/app/inner.ts", "one/two/app/inner.ts")],
        ),
        ("../../../helper.ts", &[]),
    ];
    for (joined, written) in rows {
        let job = format!(r#"new Worker(new URL("{joined}", import.meta.url));"#);
        let mut project = executable(&[
            (
                "one/two/app/main.ts",
                r#"new Worker(new URL("../jobs/job.ts", import.meta.url));"#,
            ),
            ("one/two/app/inner.ts", WORKER),
            ("one/two/jobs/job.ts", &job[..]),
            ("one/two/jobs/helper.ts", WORKER),
            ("one/two/helper.ts", WORKER),
            ("one/helper.ts", WORKER),
            ("helper.ts", WORKER),
        ]);
        project.root_directory = Some(b"/project/one/two/app");
        load_from(&project, &EmbedsFiles, |build, loaded| {
            let expected = written.iter().map(|(name, file)| {
                let file = source_path_of(format!("/project/{file}").as_bytes());
                format!("{name} {}", BStr::new(&file))
            });
            assert_eq!(
                describe_names_written(build),
                expected.collect::<Vec<String>>(),
                "{joined}"
            );
            assert_eq!(loaded.contents.found_entry_points.len(), 2, "{joined}");
        });
    }
}

#[test]
fn worker_constructor_is_recognized_by_binding() {
    let texts = [
        (r#"new Worker("./w.ts");"#, true),
        (
            r#"import { Worker } from "node:worker_threads"; new Worker("./w.ts");"#,
            true,
        ),
        (
            r#"import * as threads from "node:worker_threads"; new threads.Worker("./w.ts");"#,
            true,
        ),
        (
            r#"class Worker { constructor(path: string) {} } new Worker("./w.ts");"#,
            false,
        ),
        (
            r#"import { Worker } from "./mine.ts"; new Worker("./w.ts");"#,
            false,
        ),
        (
            r#"const pool = { Worker: class { constructor(path: string) {} } }; new pool.Worker("./w.ts");"#,
            false,
        ),
    ];
    for (text, is_worker) in texts {
        let project = executable(&[
            ("main.ts", text),
            (
                "mine.ts",
                "export class Worker { constructor(path: string) {} }",
            ),
            ("w.ts", WORKER),
        ]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let contents = contents_of(files, "main.ts");
            assert_eq!(contents.names_worker_constructor, is_worker, "{text}");
            let starts = describe_starts(files, "main.ts", true);
            assert_eq!(!starts.is_empty(), is_worker, "{text}");
            assert!(!contents.hands_worker_constructor_on, "{text}");
            let program = loaded.contents;
            assert_eq!(program.names_worker_constructor, is_worker, "{text}");
            assert_eq!(find_file(files, "w.ts").is_some(), is_worker, "{text}");
        });
    }
}

#[test]
fn worker_constructor_used_as_a_value_is_handed_on() {
    for (text, is_handed_on) in [
        (r#"new Worker("./w.ts");"#, false),
        ("export const Made = Worker;", true),
        ("console.log(Worker);", true),
        ("export class Mine extends Worker {}", true),
    ] {
        let project = executable(&[("main.ts", text), ("w.ts", WORKER)]);
        load(&project, |loaded| {
            let contents = contents_of(files_of(loaded), "main.ts");
            assert!(contents.names_worker_constructor, "{text}");
            assert_eq!(contents.hands_worker_constructor_on, is_handed_on, "{text}");
            let program = loaded.contents;
            assert_eq!(program.hands_worker_constructor_on, is_handed_on, "{text}");
        });
    }
}

#[test]
fn place_where_the_load_loses_sight_of_a_worker_of_node_is_noted() {
    let rows: [(&str, &[bool]); 9] = [
        (r#"new Worker("./w.ts");"#, &[]),
        ("new Worker(process.argv[2]);", &[false]),
        ("new Worker(process.argv[2], { eval: true });", &[true]),
        (r#"new Worker("postMessage(1)", { eval: true });"#, &[]),
        ("console.log(typeof Worker);", &[]),
        ("console.log(Worker);", &[false]),
        ("export class Mine extends Worker {}", &[false]),
        ("export { Worker };", &[false]),
        ("new globalThis.Worker(process.argv[2]);", &[]),
    ];
    for (text, expected) in rows {
        let main = format!(r#"import {{ Worker }} from "node:worker_threads"; {text}"#);
        let project = executable(&[("main.ts", &main), ("w.ts", WORKER)]);
        load(&project, |loaded| {
            let contents = contents_of(files_of(loaded), "main.ts");
            let places = contents.node_workers_out_of_sight.iter();
            let noted: Vec<bool> = places.map(|place| place.is_told_to_evaluate).collect();
            assert_eq!(noted, expected, "{text}");
        });
    }
}

#[test]
fn construction_under_the_name_of_the_constructor_is_a_start_where_the_file_hands_the_module_on() {
    let rows: [(&str, &[&str]); 4] = [
        (
            "const startWith = given => new given.Worker(__filename); exports.start = () => startWith(threads);",
            &["lib/own.cjs StartsWorker"],
        ),
        (
            r#"const startWith = options => new options.threads.Worker(require.resolve("./w.ts")); exports.start = () => startWith({ threads });"#,
            &["lib/w.ts StartsWorker"],
        ),
        (
            r#"const startWith = given => new given.Pool(require.resolve("./w.ts")); exports.start = () => startWith(threads);"#,
            &["lib/w.ts MayStartWorker"],
        ),
        (
            r#"exports.start = given => new given.Worker(require.resolve("./w.ts")); exports.isMain = threads.isMainThread;"#,
            &[],
        ),
    ];
    for (text, found) in rows {
        let own = format!(r#"const threads = require("node:worker_threads"); {text}"#);
        let project = executable(&[
            ("main.cjs", r#"require("./lib/own.cjs").start();"#),
            ("lib/own.cjs", &own),
            ("lib/w.ts", WORKER),
        ]);
        load(&project, |loaded| {
            let names = describe_found(&loaded.contents.found_entry_points);
            assert_eq!(names, found, "{text}");
        });
    }
}

#[test]
fn constructor_that_is_looked_up_at_run_time_counts_as_the_global() {
    let texts = [
        (r#"with (process.env) { new Worker("./w.ts"); }"#, false),
        (
            r#"function start(code) { eval(code); return new Worker("./w.ts"); } start("");"#,
            false,
        ),
        (
            r#"with (process.env) { new globalThis.Worker("./w.ts"); }"#,
            false,
        ),
        ("with (process.env) { console.log(Worker); }", true),
        (
            r#"function find(code) { eval(code); return Worker; } find("");"#,
            true,
        ),
    ];
    for (text, is_handed_on) in texts {
        let project = executable(&[("main.cjs", text), ("w.ts", WORKER)]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let contents = contents_of(files, "main.cjs");
            assert!(contents.names_worker_constructor, "{text}");
            assert_eq!(contents.hands_worker_constructor_on, is_handed_on, "{text}");
            assert_eq!(contents.worker_starts.is_empty(), is_handed_on, "{text}");
            assert_eq!(find_file(files, "w.ts").is_some(), !is_handed_on, "{text}");
        });
    }
}

#[test]
fn written_arm_of_a_name_that_is_unknown_otherwise_is_an_entry_point() {
    let rows: [(&str, &[&str]); 9] = [
        (
            r#"require(require("node:path").join(process.env.CONF_FOLDER || __dirname, "conf.cjs"));"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"const load = name => require(name); load(process.env.CONF || "./conf.cjs");"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"require(process.env.CONF || "./conf.cjs");"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"require(process.env.CONF ?? "./conf.cjs");"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"require(process.argv[2] ? process.argv[2] : "./conf.cjs");"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"import(process.env.CONF || "./conf.cjs");"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"const name = process.env.CONF || "./conf.cjs"; require(name);"#,
            &["conf.cjs WrittenInArm"],
        ),
        (
            r#"let name = process.env.CONF || "./conf.cjs"; name = process.argv[2]; require(name);"#,
            &[],
        ),
        (
            r#"require(process.env.CONF); console.log("./conf.cjs");"#,
            &[],
        ),
    ];
    for (text, found) in rows {
        let project = executable(&[("main.cjs", text), ("conf.cjs", "exports.name = 1;")]);
        load(&project, |loaded| {
            let names = describe_found(&loaded.contents.found_entry_points);
            assert_eq!(names, found, "{text}");
        });
    }
}

#[test]
fn worker_start_with_an_unknown_name_is_recorded() {
    let project = executable(&[("main.ts", "new Worker(process.argv[2]);")]);
    load(&project, |loaded| {
        let [start] = contents_of(files_of(loaded), "main.ts").worker_starts[..] else {
            panic!("the file has one start");
        };
        assert_eq!(start.place, PlaceOfName::Constructor);
        assert_eq!(start.name, ImportSpecifier::Unknown);
        assert!(loaded.contents.found_entry_points.is_empty());
    });
}

#[test]
fn code_in_data_url_is_entry_point() {
    const ASK: &str = "const ask = (url: string) => new Worker(url);";
    let rows: [(String, &[&str]); 9] = [
        (
            r#"new Worker("data:text/javascript,postMessage(1)");"#.to_owned(),
            &["data:text/javascript,postMessage(1)"],
        ),
        (
            r#"new Worker("data:text/javascript," + encodeURIComponent("postMessage(8)"));"#
                .to_owned(),
            &["data:text/javascript,postMessage(8)"],
        ),
        (
            format!(
                r#"{ASK} ask("data:text/javascript,postMessage(2)"); ask("data:text/javascript,postMessage(3)");"#
            ),
            &[
                "data:text/javascript,postMessage(2)",
                "data:text/javascript,postMessage(3)",
            ],
        ),
        (
            format!(r#"{ASK} ask("data:text/" + "javascript," + "postMessage(4)");"#),
            &["data:text/javascript,postMessage(4)"],
        ),
        (
            r#"new Worker("data:,postMessage(5)");"#.to_owned(),
            &["data:,postMessage(5)"],
        ),
        (
            format!(r#"{ASK} ask("data:image/png,postMessage(6)");"#),
            &["data:image/png,postMessage(6)"],
        ),
        (
            r#"new Worker("data:text/javascript,postMessage(6);" + process.argv[2]);"#.to_owned(),
            &[],
        ),
        (
            r#"new Worker("data:text/javascript,function (");"#.to_owned(),
            &[],
        ),
        (
            r#"export const url = "data:text/javascript,postMessage(7)";"#.to_owned(),
            &[],
        ),
    ];
    for (main, urls) in rows {
        let project = executable(&[("main.ts", &main)]);
        load(&project, |loaded| {
            let expected = urls.iter().map(|url| format!("{url} StartsWorker"));
            assert_eq!(
                describe_found(&loaded.contents.found_entry_points),
                expected.collect::<Vec<String>>(),
                "{main}"
            );
            let sources = &loaded.project(ProjectId::Application).sources;
            let paths = sources.entry_points()[1..].iter();
            let paths: Vec<String> = paths
                .map(|entry| BStr::new(sources.public_path(entry.file)).to_string())
                .collect();
            assert_eq!(paths, urls, "{main}");
        });
    }
}

#[test]
fn own_path_in_text() {
    let with_path = "data:text/javascript,import(%22%2F%24bunfs%2Froot%2Flib%2Fbeside.ts%22)";
    let with_url =
        "data:text/javascript,import(%22file%3A%2F%2F%2F%24bunfs%2Froot%2Flib%2Fbeside.ts%22)";
    let behind_object_url = name_of_text(Loader::Tsx, br#"import("/$bunfs/root/lib/beside.ts")"#);
    let behind_object_url = BStr::new(&behind_object_url).to_string();
    let rows: [(&str, Option<&str>); 9] = [
        (
            r#"const file = import.meta.dir + "/beside.ts";
            new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));"#,
            Some(with_path),
        ),
        (
            r#"const text = `import("${import.meta.dirname}/beside.ts")`;
            export const start = () => new Worker(`data:text/javascript,${encodeURIComponent(text)}`);"#,
            Some(with_path),
        ),
        (
            r#"const url = new URL("./beside.ts", import.meta.url).href;
            new Worker("data:text/javascript," + encodeURIComponent('import("' + url + '")'));"#,
            Some(with_url),
        ),
        (
            r#"const beside = new URL("../lib/beside.ts", import.meta.url);
            new Worker("data:text/javascript," + encodeURIComponent('import("' + beside.href + '")'));"#,
            Some(with_url),
        ),
        (
            r#"new Worker(URL.createObjectURL(new Blob(['import("', import.meta.dir, '/beside.ts")'])));"#,
            Some(&behind_object_url),
        ),
        (
            r#"const blob = new Blob(['import("' + import.meta.dir + '/beside.ts")']);
            const url = URL.createObjectURL(blob);
            new Worker(url);"#,
            Some(&behind_object_url),
        ),
        (
            r#"import { Worker } from "node:worker_threads";
            new Worker('import("' + import.meta.dir + '/beside.ts")', { eval: true });"#,
            Some(&behind_object_url),
        ),
        (
            r#"const file = import.meta.dir + "/beside.ts" + process.argv[2];
            new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));"#,
            None,
        ),
        (
            r#"let file = import.meta.dir + "/beside";
            file = process.argv[2];
            new Worker("data:text/javascript," + encodeURIComponent('import("' + file + '")'));"#,
            None,
        ),
    ];
    for (starts, name) in rows {
        let project = executable(&[
            ("main.ts", r#"import "./lib/starts.ts";"#),
            ("lib/starts.ts", starts),
            ("lib/beside.ts", "export const beside = 1;"),
        ]);
        load(&project, |loaded| {
            let mut found = describe_found(&loaded.contents.found_entry_points);
            found.retain(|it| it.starts_with("data:") || it.starts_with("blob:"));
            let expected = name.iter().map(|name| format!("{name} StartsWorker"));
            assert_eq!(found, expected.collect::<Vec<String>>(), "{starts}");
            let holds_file = find_file(files_of(loaded), "lib/beside.ts").is_some();
            assert_eq!(holds_file, name.is_some(), "{starts}");
        });
    }
    let main = r#"new Worker("data:text/javascript," + encodeURIComponent("postMessage('" + import.meta.path + "')"));"#;
    load(&executable(&[("main.ts", main)]), |loaded| {
        assert_eq!(
            describe_found(&loaded.contents.found_entry_points),
            ["data:text/javascript,postMessage('%2F%24bunfs%2Froot%2Fmain.ts') StartsWorker"]
        );
    });
}

fn describe_texts_found(loaded: &LoadedBuild<'_, '_>) -> Vec<String> {
    let mut found = describe_found(&loaded.contents.found_entry_points);
    found.retain(|it| it.starts_with("data:") || it.starts_with("blob:"));
    found.sort();
    found
}

#[test]
fn data_url_counts_as_a_url_object_says_it_too() {
    let rows: [(&str, &[&str]); 4] = [
        (
            "new Worker(new URL(\"data:text/javascript,postMessage('\u{e9}')\"));",
            &[
                "data:text/javascript,postMessage('%C3%A9')",
                "data:text/javascript,postMessage('\u{e9}')",
            ],
        ),
        (
            "export const start = (url: URL) => new Worker(url); export const held = \"data:text/javascript,postMessage('\u{20ac}')\";",
            &[
                "data:text/javascript,postMessage('%E2%82%AC')",
                "data:text/javascript,postMessage('\u{20ac}')",
            ],
        ),
        (
            "new Worker(new URL(\"data:text/javascript,\" + encodeURIComponent(\"postMessage('\u{e9}' + '\" + import.meta.path + \"')\")));",
            &["data:text/javascript,postMessage('%C3%A9'%20%2B%20'%2F%24bunfs%2Froot%2Fmain.ts')"],
        ),
        (
            r#"new Worker(new URL("data:text/javascript,postMessage(1)"));"#,
            &["data:text/javascript,postMessage(1)"],
        ),
    ];
    for (main, urls) in rows {
        load(&executable(&[("main.ts", main)]), |loaded| {
            let expected = urls.iter().map(|url| format!("{url} StartsWorker"));
            assert_eq!(
                describe_texts_found(loaded),
                expected.collect::<Vec<String>>(),
                "{main}"
            );
        });
    }
}

#[test]
fn path_that_the_library_makes_of_the_own_path_stands_in_text() {
    const START: &str =
        r#"new Worker("data:text/javascript," + encodeURIComponent("postMessage('" + "#;
    const END: &str = r#" + "')"));"#;
    let rows: [(&str, &str, &str, Option<&str>); 13] = [
        (
            "lib/starts.ts",
            r#"import { fileURLToPath } from "node:url";"#,
            "fileURLToPath(import.meta.url)",
            Some("/$bunfs/root/lib/starts.ts"),
        ),
        (
            "lib/starts.ts",
            r#"import { join } from "node:path";"#,
            r#"join(import.meta.dir, "..", "other.js")"#,
            Some("/$bunfs/root/other.js"),
        ),
        (
            "lib/starts.ts",
            r#"import * as path from "node:path";"#,
            r#"path.resolve(import.meta.dir, "./a/../other.js")"#,
            Some("/$bunfs/root/lib/other.js"),
        ),
        (
            "lib/starts.ts",
            r#"import path from "node:path"; import url from "node:url";"#,
            "path.dirname(url.fileURLToPath(import.meta.url)) + path.sep",
            Some("/$bunfs/root/lib/"),
        ),
        (
            "lib/starts.ts",
            r#"const { pathToFileURL: toUrl } = require("node:url");"#,
            "toUrl(import.meta.path).href",
            Some("file:///$bunfs/root/lib/starts.ts"),
        ),
        (
            "lib/starts.ts",
            "",
            "new URL(import.meta.url).pathname",
            Some("/$bunfs/root/lib/starts.ts"),
        ),
        (
            "lib/starts.ts",
            r#"const beside = new URL("./beside.ts", import.meta.url);"#,
            "beside.toString()",
            Some("file:///$bunfs/root/lib/beside.ts"),
        ),
        (
            "lib/starts.ts",
            "",
            r"String.raw`${import.meta.dir}\n`",
            Some(r"/$bunfs/root/lib\n"),
        ),
        (
            "lib/starts.ts",
            "",
            "String.raw`${import.meta.dir}/${1}${true}`",
            Some("/$bunfs/root/lib/1true"),
        ),
        (
            "lib/starts.cjs",
            "",
            "__filename",
            Some("/project/lib/starts.cjs"),
        ),
        ("lib/starts.cjs", "", "__dirname", Some("/project/lib")),
        (
            "lib/starts.cjs",
            "__filename = process.argv[2];",
            "__filename",
            None,
        ),
        (
            "lib/starts.ts",
            "const join = (...parts: string[]) => parts.join();",
            r#"join(import.meta.dir, "other.js")"#,
            None,
        ),
    ];
    let (_, encode) = ENCODERS[0];
    for (file, ahead, expression, value) in rows {
        let main = format!(r#"import "./{file}";"#);
        let starts = format!("{ahead}\n{START}{expression}{END}");
        load(
            &executable(&[("main.ts", &main), (file, &starts)]),
            |loaded| {
                let expected = value.iter().map(|value| {
                    let text = encode(format!("postMessage('{value}')").as_bytes());
                    let text = text.expect("the text is well formed");
                    format!("data:text/javascript,{} StartsWorker", BStr::new(&text))
                });
                assert_eq!(
                    describe_texts_found(loaded),
                    expected.collect::<Vec<String>>(),
                    "{starts}"
                );
            },
        );
    }
}

#[test]
fn each_text_that_a_worker_may_be_given_is_an_entry_point() {
    const NODE: &str = r#"import { Worker as NodeWorker } from "node:worker_threads";"#;
    let rows: [(String, &[&str]); 7] = [
        (
            format!(
                r#"{NODE} new NodeWorker(process.argv.length > 9 ? "postMessage(1)" : "postMessage(2)", {{ eval: true }});"#
            ),
            &["postMessage(1)", "postMessage(2)"],
        ),
        (
            format!(
                r#"{NODE} const evaluate = (text: string) => new NodeWorker(text, {{ eval: true }}); evaluate("postMessage(3)"); evaluate("postMessage(" + "4)");"#
            ),
            &["postMessage(3)", "postMessage(4)"],
        ),
        (
            r#"new Worker(process.env.URL_OF_WORKER || URL.createObjectURL(new Blob(["postMessage(5)"])));"#
                .to_owned(),
            &["postMessage(5)"],
        ),
        (
            r#"const start = (url: string) => new Worker(url); start(URL.createObjectURL(new Blob(["postMessage(6)"])));"#
                .to_owned(),
            &["postMessage(6)"],
        ),
        (
            format!(
                r#"{NODE} export const evaluate = (text: string) => new NodeWorker(text, {{ eval: true }}); evaluate("postMessage(7)");"#
            ),
            &[],
        ),
        (
            format!(
                r#"{NODE} let text = "postMessage(8)"; text = process.argv[2]; new NodeWorker(text, {{ eval: true }});"#
            ),
            &[],
        ),
        (
            r#"const start = (code: string) => new Worker(URL.createObjectURL(new Blob([code]))); start("postMessage(9)"); start("postMessage(10)");"#
                .to_owned(),
            &["postMessage(9)", "postMessage(10)"],
        ),
    ];
    for (main, texts) in rows {
        load(&executable(&[("main.ts", &main)]), |loaded| {
            let names = texts.iter().map(|text| {
                let name = name_of_text(Loader::Tsx, text.as_bytes());
                format!("{} StartsWorker", BStr::new(&name))
            });
            let mut names: Vec<String> = names.collect();
            names.sort();
            assert_eq!(describe_texts_found(loaded), names, "{main}");
        });
    }
}

#[test]
fn url_counts_whichever_file_names_the_constructor() {
    let imports = [
        (r#"import "./url.ts"; import "./pool.ts";"#, true),
        (r#"import "./pool.ts"; import "./url.ts";"#, true),
        (r#"import "./url.ts";"#, false),
    ];
    for (main, is_found) in imports {
        let project = executable(&[
            ("main.ts", main),
            (
                "url.ts",
                r#"export const url = new URL("./w.ts", import.meta.url);"#,
            ),
            (
                "pool.ts",
                "export const start = (url: URL) => new Worker(url);",
            ),
            ("w.ts", WORKER),
        ]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let starts = describe_starts(files, "url.ts", false);
            assert_eq!(starts, ["FromOwnFolder ./w.ts"], "{main}");
            assert!(!contents_of(files, "url.ts").names_worker_constructor);
            let found: &[&str] = match is_found {
                true => &["w.ts MayStartWorker"],
                false => &[],
            };
            let program = loaded.contents;
            assert_eq!(program.names_worker_constructor, is_found, "{main}");
            assert_eq!(describe_found(&program.found_entry_points), found, "{main}");
            assert_eq!(find_file(files, "w.ts").is_some(), is_found, "{main}");
        });
    }
}

#[test]
fn url_in_a_file_parsed_ahead_of_the_file_that_names_the_constructor_counts() {
    let project = executable(&[
        (
            "main.ts",
            r#"export const url = new URL("./w.ts", import.meta.url); require(require("./config.json").plugin);"#,
        ),
        ("config.json", r#"{ "plugin": "./plugin.ts" }"#),
        (
            "plugin.ts",
            "export const start = (url: URL) => new Worker(url);",
        ),
        ("w.ts", WORKER),
    ]);
    load(&project, |loaded| {
        let files = files_of(loaded);
        let found = &loaded.contents.found_entry_points;
        assert_eq!(
            describe_found(found),
            ["plugin.ts NamedByData", "w.ts MayStartWorker"]
        );
        let [start] = contents_of(files, "main.ts").worker_starts[..] else {
            panic!("the file has one start");
        };
        assert_eq!(found[0].started_at, None);
        let started_at = (b"/project/main.ts".to_vec(), start.at.0);
        assert_eq!(found[1].started_at, Some(started_at));
        assert_found_follow_written(loaded, 1);
    });
}

#[test]
fn url_that_names_no_file_of_code_is_no_entry_point() {
    let urls = [
        (r#"new URL("./w.ts?raw", import.meta.url)"#, false),
        (r#"new URL("./w.ts#part", import.meta.url)"#, false),
        (r#"new URL("./w%2Ets", import.meta.url)"#, false),
        (
            r#"new URL("https://example.com/w.ts", import.meta.url)"#,
            false,
        ),
        (r#"new URL("./w.ts", "file:///elsewhere/")"#, false),
        ("new URL(process.argv[2], import.meta.url)", false),
        (
            r#"new (class URL { constructor(path: string, base: string) {} })("w.ts", import.meta.url)"#,
            true,
        ),
        (r#"new URL("./logo.png", import.meta.url)"#, true),
        (r#"new URL("./types.d.ts", import.meta.url)"#, true),
        (r#"new URL("./missing.ts", import.meta.url)"#, true),
    ];
    for (url, may_name_file) in urls {
        let main = format!(
            "export const start = (url: URL) => new Worker(url);\nexport const url = {url};\n"
        );
        let project = executable(&[
            ("main.ts", &main),
            ("w.ts", WORKER),
            ("logo.png", "no code"),
            ("types.d.ts", "export {};"),
        ]);
        load(&project, |loaded| {
            let starts = describe_starts(files_of(loaded), "main.ts", false);
            assert!(may_name_file || starts.is_empty(), "{url}: {starts:?}");
            let found = describe_found(&loaded.contents.found_entry_points);
            assert!(found.is_empty(), "{url}: {found:?}");
        });
    }
}

#[test]
fn file_whose_path_is_written_elsewhere_counts_where_a_start_is_out_of_sight() {
    let paths = [
        (
            r#"join(import.meta.dir, "lib", "w.ts")"#,
            "FromOwnFolder ./lib/w.ts",
        ),
        (
            r#"resolve(import.meta.dir, "lib/w.ts")"#,
            "FromOwnFolder ./lib/w.ts",
        ),
        (
            r#"import.meta.dir + "/lib/w.ts""#,
            "FromOwnFolder ./lib/w.ts",
        ),
        ("`${import.meta.dir}/lib/w.ts`", "FromOwnFolder ./lib/w.ts"),
        (r#"__dirname + "/lib/w.ts""#, "FromOwnFolder ./lib/w.ts"),
        (
            r#"join(__dirname, "lib", "w.ts")"#,
            "FromOwnFolder ./lib/w.ts",
        ),
        (
            r#"require.resolve("./lib/w.ts")"#,
            "Resolved(Path) ./lib/w.ts",
        ),
        (
            r#"import.meta.resolve("./lib/w.ts")"#,
            "Resolved(Url) ./lib/w.ts",
        ),
        (r#""./lib/w.ts""#, "AsWritten ./lib/w.ts"),
    ];
    let pools = [
        ("new Worker(entry)", "lib/w.ts MayStartWorker"),
        (r#"new Worker("./other.ts")"#, "other.ts StartsWorker"),
    ];
    for (path, described) in paths {
        for (start, found) in pools {
            let main = format!(
                "import {{ join, resolve }} from \"node:path\";\nimport {{ start }} from \"./pool.ts\";\nstart({path});\n"
            );
            let pool = format!("export const start = (entry: string) => {start};\n");
            let project = executable(&[
                ("main.ts", &main),
                ("pool.ts", &pool),
                ("lib/w.ts", WORKER),
                ("other.ts", WORKER),
            ]);
            load(&project, |loaded| {
                let starts = describe_starts(files_of(loaded), "main.ts", false);
                assert_eq!(starts, [described], "{path}");
                let found_by_load = describe_found(&loaded.contents.found_entry_points);
                assert_eq!(found_by_load, [found], "{path}");
            });
        }
    }
}

#[test]
fn embedded_file_of_code_counts_where_a_start_is_out_of_sight() {
    let starts = [
        ("new Worker(table[process.argv[2]])", "/project/w.ts", true),
        (r#"new Worker("./other.ts")"#, "/project/other.ts", false),
    ];
    for (start, source_path, may_start) in starts {
        let main = format!(
            "import path from \"./w.ts\" with {{ type: \"file\" }};\nconst table: Record<string, string> = {{ job: path }};\n{start};\n"
        );
        let project = executable(&[("main.ts", &main), ("w.ts", WORKER), ("other.ts", WORKER)]);
        load(&project, |loaded| {
            let [found] = &loaded.contents.found_entry_points[..] else {
                panic!("one file is found: {start}");
            };
            let source_path = source_path_of(source_path.as_bytes());
            assert_eq!(BStr::new(&found.source_path), BStr::new(&source_path));
            let because = match may_start {
                true => FoundBecause::MayStartWorker,
                false => FoundBecause::StartsWorker,
            };
            assert_eq!(found.because, because, "{start}");
        });
    }
}

#[test]
fn own_file_counts_where_something_else_than_a_built_in_function_gets_it() {
    let rows = [
        ("start(import.meta.url);", true),
        ("start(new URL(import.meta.url));", true),
        ("start(__filename);", true),
        ("start(import.meta?.url);", true),
        ("start(import.meta[\"url\"]);", true),
        ("const { url } = import.meta;\nstart(url);", true),
        ("start(import.meta);", true),
        ("start(pathToFileURL(import.meta.filename).href);", true),
        ("Promise.resolve(import.meta.url).then(start);", true),
        (
            "start(import.meta.dir, import.meta.main, import.meta.env);",
            false,
        ),
        (
            "console.log(import.meta);\nstart(typeof import.meta);",
            false,
        ),
        (
            "const own = fileURLToPath(import.meta.url);\nstart(own);",
            true,
        ),
        (
            "const own = fileURLToPath(import.meta.url);\nstart({ file: own });",
            true,
        ),
        (
            "const own = fileURLToPath(import.meta.url);\nstart(dirname(own));",
            false,
        ),
        (
            "const own = import.meta.path;\nstart(own + \".map\", own.length, `${own}#made`);",
            false,
        ),
        (
            "start(dirname(import.meta.path), import.meta.url.length);",
            false,
        ),
    ];
    for (code, is_taken) in rows {
        let job = format!(
            "import {{ dirname }} from \"node:path\";\nimport {{ fileURLToPath, pathToFileURL }} from \"node:url\";\nimport {{ start }} from \"./pool.ts\";\n{code}\n"
        );
        let pool =
            "export const start = (...given: unknown[]) => new Worker(given[0] as string);\n";
        let project = executable(&[
            ("main.ts", "import \"./job.ts\";\n"),
            ("job.ts", &job),
            ("pool.ts", pool),
        ]);
        load(&project, |loaded| {
            let found = describe_found(&loaded.contents.found_entry_points);
            let expected: &[&str] = match is_taken {
                true => &["job.ts MayStartWorker"],
                false => &[],
            };
            assert_eq!(found, expected, "{code}");
        });
    }
}

#[test]
fn one_load_grows_by_each_file_once() {
    let files = [
        (
            "main.ts",
            r#"new Worker("./first.ts"); new Worker(new URL("./first.ts", import.meta.url)); new Worker("./written.ts");"#,
        ),
        ("written.ts", WORKER),
        ("first.ts", r#"new Worker("./second.ts");"#),
        (
            "second.ts",
            r#"new Worker("./first.ts"); new Worker("./missing.ts");"#,
        ),
    ];
    let project = TestProject::with_entry_points(&files, 2, &default_settings());
    load(&project, |loaded| {
        let found = &loaded.contents.found_entry_points;
        assert_eq!(
            describe_found(found),
            ["first.ts StartsWorker", "second.ts StartsWorker"]
        );
        let [start] = contents_of(files_of(loaded), "first.ts").worker_starts[..] else {
            panic!("the file has one start");
        };
        let started_at = (b"/project/first.ts".to_vec(), start.at.0);
        assert_eq!(found[1].started_at, Some(started_at));
        assert_found_follow_written(loaded, 2);
    });
}

#[test]
fn file_followed_further_than_the_bundler_is_an_entry_point_beside_a_plugin() {
    let plugins: [(&str, &[&str]); 2] = [
        (
            r#"Bun.plugin({ name: "p", setup() {} });"#,
            &["a.ts FollowedFurtherThanBundler"],
        ),
        ("", &[]),
    ];
    for (plugin, found) in plugins {
        let main = format!("{plugin}\nconst name = \"./a.ts\";\nimport(name);\n");
        let project = executable(&[("main.ts", &main), ("a.ts", "export const a = 1;")]);
        load(&project, |loaded| {
            let program = loaded.contents;
            assert_eq!(names_plugin(files_of(loaded)), !plugin.is_empty());
            assert_eq!(
                describe_found(&program.found_entry_points),
                found,
                "{plugin}"
            );
            assert!(find_file(files_of(loaded), "a.ts").is_some(), "{plugin}");
            assert_found_follow_written(loaded, 1);
        });
    }
}

#[test]
fn file_found_for_a_load_is_read_as_that_load_reads_it() {
    use bun_sema::module_format::ModuleFormat::{CommonJs, Esm};
    const NO_KIND: &str = "globalThis.ran = true;";
    const PLUG: (&str, &str) = ("plug.mjs", r#"import "./plain.cjs";"#);
    const WHOLE: (&str, &str) = ("load.cjs", "module.exports = name => require(name);");
    let rows: [(&[(&str, &str)], &str, _); 11] = [
        (
            &[
                (
                    "main.cjs",
                    r#"const say = require("./wrap.cjs")(require); say("./setup.cjs"); import("./setup.cjs");"#,
                ),
                ("wrap.cjs", "module.exports = load => text => [text, load];"),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            Esm,
        ),
        (
            &[
                (
                    "main.cjs",
                    r#"const tools = { load: name => require(name) }; const other = { load: text => text }; other.load("./setup.cjs"); import("./setup.cjs"); tools.load;"#,
                ),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            CommonJs,
        ),
        (
            &[
                (
                    "main.cjs",
                    r#"const say = require("./say.cjs"); say("./setup.cjs"); import("./setup.cjs");"#,
                ),
                (
                    "say.cjs",
                    r#"const load = require("./load.cjs"); module.exports = text => [text, load];"#,
                ),
                WHOLE,
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            Esm,
        ),
        (
            &[
                (
                    "main.cjs",
                    r#"const tools = require("./tools.cjs"); tools.load("./setup.cjs"); import("./setup.cjs");"#,
                ),
                ("tools.cjs", "exports.load = name => require(name);"),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            CommonJs,
        ),
        (
            &[
                (
                    "main.cjs",
                    r#"const other = { load: text => text }; other.load("./setup.cjs"); const bring = require("./load.cjs"); bring("./setup.cjs"); import("./setup.cjs");"#,
                ),
                (
                    "load.cjs",
                    "module.exports = name => require(name); module.exports.load = name => require(name);",
                ),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            CommonJs,
        ),
        (
            &[
                ("main.cjs", r#"require(require("./config.json").plugin);"#),
                ("config.json", r#"{ "plugin": "./plug.mjs" }"#),
                PLUG,
                ("plain.cjs", NO_KIND),
            ],
            "plain.cjs",
            CommonJs,
        ),
        (
            &[
                (
                    "main.mjs",
                    r#"import config from "./config.json"; await import(config.setup);"#,
                ),
                ("config.json", r#"{ "setup": "./setup.cjs" }"#),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            Esm,
        ),
        (
            &[
                ("main.cjs", r#"require("./tools.cjs").load("./plug.mjs");"#),
                ("tools.cjs", "exports.load = name => require(name);"),
                PLUG,
                ("plain.cjs", NO_KIND),
            ],
            "plain.cjs",
            CommonJs,
        ),
        (
            &[
                ("main.cjs", r#"require("./plug.mjs");"#),
                PLUG,
                ("plain.cjs", NO_KIND),
            ],
            "plain.cjs",
            CommonJs,
        ),
        (
            &[
                (
                    "main.mjs",
                    r#"import * as tools from "./tools.mjs"; await tools.load("./setup.cjs");"#,
                ),
                ("tools.mjs", "export const load = name => import(name);"),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            Esm,
        ),
        (
            &[
                ("main.mjs", r#"await import("./setup.cjs");"#),
                ("setup.cjs", NO_KIND),
            ],
            "setup.cjs",
            Esm,
        ),
    ];
    for (files, asked, format) in rows {
        load(&executable(files), |loaded| {
            let loaded = files_of(loaded);
            let analysis = loaded.analysis(file_named(loaded, asked));
            assert_eq!(analysis.module_format, format, "{}", files[0].1);
        });
    }
}

#[test]
fn text_passed_to_what_is_made_with_the_own_require_names_a_file() {
    const DRIVER: &str = "node_modules/driver/index.js WrittenInArm";
    let rows: [(&str, &[&str]); 5] = [
        (
            r#"const bring = require("./tools.cjs")(require); bring("driver");"#,
            &[DRIVER],
        ),
        (r#"require("./tools.cjs")(require)("driver");"#, &[DRIVER]),
        (
            r#"const own = require; require = require("./tools.cjs")(require); require("driver", "first"); require = own;"#,
            &[DRIVER],
        ),
        (
            r#"const bring = require("./tools.cjs")(1); bring("driver");"#,
            &[],
        ),
        (
            r#"if (false) require = 1; const bring = require("./tools.cjs"); bring;"#,
            &[],
        ),
    ];
    for (main, found) in rows {
        let project = executable(&[
            ("main.cjs", main),
            ("tools.cjs", "module.exports = load => name => load(name);"),
            (
                "node_modules/driver/package.json",
                r#"{ "name": "driver", "version": "1.0.0", "main": "index.js" }"#,
            ),
            ("node_modules/driver/index.js", "exports.which = 1;"),
        ]);
        load(&project, |loaded| {
            let described = describe_found(&loaded.contents.found_entry_points);
            assert_eq!(described, found, "{main}");
        });
    }
}

#[test]
fn text_passed_for_a_loaded_parameter_names_a_file() {
    const DRIVER: &str = "node_modules/driver/index.js PassedForParameter";
    const BY_REQUIRE: &str = "exports.load = name => require(name);";
    const WHOLE: &str = "module.exports = name => require(name);";
    let rows: [(&str, &str, &str, &[&str]); 19] = [
        (
            "tools.cjs",
            "exports.readFile = name => require(name);",
            r#"const { readFile } = require("node:fs"); readFile("driver"); require("./tools.cjs");"#,
            &[],
        ),
        (
            "tools.cjs",
            BY_REQUIRE,
            r#"const { load } = require("./tools.cjs"); load("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            BY_REQUIRE,
            r#"const bring = require("./tools.cjs").load; bring("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            WHOLE,
            r#"const load = require("./tools.cjs"); load("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            WHOLE,
            r#"require("./tools.cjs")("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            WHOLE,
            r#"import load from "./tools.cjs"; load("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "function load(name) { return require(name); }\nmodule.exports = { load };",
            r#"require("./tools.cjs").load("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "function load(name) { return require(name); }\nmodule.exports = load;",
            r#"require("./tools.cjs")("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "function load(name) { return require(name); }\nexports.load = load;\nload(\"driver\");",
            r#"require("./tools.cjs");"#,
            &["node_modules/driver/index.js WrittenInArm"],
        ),
        (
            "tools.cjs",
            "module.exports = class Manager { load(name) { return require(name); } };",
            r#"class Special extends require("./tools.cjs") { constructor() { super(); this.driver = this.load("driver"); } }"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "exports.Tools = class { static load(kind, name) { return require(name); } };",
            r#"require("./tools.cjs").Tools.load(1, "driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "module.exports = { load(name) { return require(name); } };",
            r#"require("./tools.cjs").load("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            BY_REQUIRE,
            r#"const tools = require("./tools.cjs"); (0, tools.load)("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            "function load(name) { return require(name); }\nexports.bring = load;",
            r#"require("./tools.cjs").bring("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.mjs",
            "export function load(name) { return import.meta.require(name); }",
            r#"import { load as bring } from "./tools.mjs"; bring("driver");"#,
            &[DRIVER],
        ),
        (
            "tools.cjs",
            BY_REQUIRE,
            r#"require("./tools.cjs").load("doors");"#,
            &["node_modules/doors/door.cjs PassedForParameter"],
        ),
        (
            "tools.cjs",
            "exports.load = name => import(name);",
            r#"require("./tools.cjs").load("doors");"#,
            &["node_modules/doors/door.mjs PassedForParameter"],
        ),
        (
            "tools.cjs",
            BY_REQUIRE,
            r#"const tools = require("./tools.cjs"); tools.load("absent"); tools.other("driver"); tools.load(1, "driver"); tools.load(...[], "driver"); if (false) tools.load("driver");"#,
            &[],
        ),
        (
            "tools.cjs",
            r#"exports.load = name => { name += ""; return require(name); };"#,
            r#"require("./tools.cjs").load("driver");"#,
            &[],
        ),
    ];
    for (tools, loads, main, found) in rows {
        let project = executable(&[
            ("main.mjs", main),
            (tools, loads),
            (
                "node_modules/driver/package.json",
                r#"{ "name": "driver", "version": "1.0.0", "main": "index.js" }"#,
            ),
            ("node_modules/driver/index.js", "exports.which = 1;"),
            (
                "node_modules/doors/package.json",
                r#"{ "name": "doors", "version": "1.0.0", "exports": { ".": { "import": "./door.mjs", "require": "./door.cjs" } } }"#,
            ),
            ("node_modules/doors/door.mjs", "export const which = 2;"),
            ("node_modules/doors/door.cjs", "exports.which = 3;"),
        ]);
        load(&project, |loaded| {
            let program = loaded.contents;
            let described = describe_found(&program.found_entry_points);
            assert_eq!(described, found, "{loads}\n{main}");
            assert!(program.loads_by_unknown_path, "{loads}");
            assert_found_follow_written(loaded, 1);
        });
    }
}

#[test]
fn branch_that_folding_removes_names_nothing() {
    let main = r#"if (false) {
    new Worker("./w.ts");
    console.log(Worker, new URL("./w.ts", import.meta.url), "node:dgram");
    require(process.argv[2]);
    require(process.argv[2] ? "node:vm" : "node:v8");
    process.getBuiltinModule(process.argv[2]);
    delete require.cache[process.argv[2]];
    Bun.plugin({ name: "p", setup() {} });
}"#;
    let project = executable(&[("main.ts", main), ("w.ts", WORKER)]);
    load(&project, |loaded| {
        let files = files_of(loaded);
        let file = file_named(files, "main.ts");
        assert_eq!(
            describe_file_contents(files, file, contents_of(files, "main.ts")),
            describe_file_contents(files, file, &FileContents::default())
        );
        assert!(loaded.contents.found_entry_points.is_empty());
        assert_eq!(flags_of(loaded), [false; 7]);
        assert!(find_file(files, "w.ts").is_none());
    });
}

#[test]
fn each_text_that_a_name_may_be_names_its_library_module() {
    let main = r#"require(process.argv[2] ? "node:vm" : "node:v8");"#;
    load(&executable(&[("main.ts", main)]), |loaded| {
        let files = files_of(loaded);
        let names = &contents_of(files, "main.ts").names;
        let mut expected = [(NodeVm, "node:vm"), (NodeV8, "node:v8")];
        expected.sort_unstable_by_key(|it| it.0.registry_id());
        let named = names.modules.iter();
        let named: Vec<String> = named
            .map(|it| format!("{} {:?}", text_of(files, it.name), it.module))
            .collect();
        assert_eq!(
            named,
            expected.map(|(module, name)| format!("{name} {module:?}"))
        );
        let argument = argument_of_only_load(files, file_named(files, "main.ts"));
        assert_eq!(
            modules_named_in(&names.modules, argument),
            &names.modules[..]
        );
        assert!(!names.loads_by_unknown_name && !names.loads_by_unknown_path);
        assert!(names.unknown_names_at.is_empty());
        assert!(holds_library_module(loaded, NodeVm) && holds_library_module(loaded, NodeV8));
    });
}

#[test]
fn name_known_in_part_brings_no_library_module() {
    let names = [
        (r#""node:v" + process.argv[2]"#, true),
        (r#"`node:${process.argv[2]}`"#, true),
        (r#""bun:" + process.argv[2]"#, true),
        (r#""./locales/" + process.argv[2]"#, false),
        (r#"import.meta.dir + "/" + process.argv[2]"#, false),
        (r#"process.cwd() + "/" + process.argv[2]"#, false),
    ];
    for (name, fits) in names {
        let main = format!("console.log({{ kind: \"node:dgram\" }});\nrequire({name});");
        let project = executable(&[("main.ts", &main), ("locales/en.ts", "export default 1;")]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let found = &contents_of(files, "main.ts").names;
            assert!(found.modules.is_empty(), "{name}");
            assert!(!holds_library_module(loaded, BunWrap), "{name}");
            assert_eq!(found.written_as_values, [NodeDgram], "{name}");
            assert_eq!(found.loads_by_unknown_name, fits, "{name}");
            let held = find_library_modules_that_unknown_names_may_stand_for(files);
            assert_eq!(held.contains(&NodeDgram), fits, "{name}");
            assert!(!fits || holds_library_module(loaded, NodeDgram), "{name}");
            assert!(found.loads_by_unknown_path, "{name}");
            assert_eq!(found.unknown_names_at, [0], "{name}");
        });
    }
}

#[test]
fn call_that_leaves_the_argument_out_passes_undefined() {
    let calls = [
        (r#"below("/inner/");"#, "sub", true),
        (r#"below("/inner/"); below("/inner/");"#, "sub", true),
        (r#"below("/inner/"); below();"#, "sub", false),
        (r#"below(); below("/inner/");"#, "sub", false),
        (r#"below("/inner/"); below();"#, r#"sub = "/inner/""#, true),
    ];
    for (calls, parameter, is_read) in calls {
        let main = format!(
            "const {{ createRequire }} = require(\"node:module\");\nfunction below({parameter}) {{ return createRequire(__dirname + sub)(\"./shelf.cjs\"); }}\n{calls}"
        );
        let files = [
            ("main.cjs", &main[..]),
            ("inner/shelf.cjs", "module.exports = 1;"),
        ];
        load(&executable(&files), |loaded| {
            let files = files_of(loaded);
            let shelf = files
                .atoms
                .lookup(b"./shelf.cjs")
                .map(ImportSpecifier::Constant);
            let mut sites = files
                .analysis(file_named(files, "main.cjs"))
                .import_sites
                .iter();
            assert_eq!(
                sites.any(|site| Some(site.specifier) == shelf),
                is_read,
                "{main}"
            );
        });
    }
}

#[test]
fn load_says_whether_the_build_knows_its_name() {
    let loads = [
        ("loads.ts", r#"require("node:os");"#, false, false),
        ("loads.ts", "require(process.argv[2]);", true, true),
        ("loads.ts", "import(process.argv[2]);", true, true),
        (
            "loads.ts",
            "process.getBuiltinModule(process.argv[2]);",
            true,
            false,
        ),
        ("loads.cjs", "globalThis.kept = [require];", true, true),
    ];
    for (file, text, is_unknown, may_be_path) in loads {
        let main = format!("import \"./{file}\";");
        load(&executable(&[("main.ts", &main), (file, text)]), |loaded| {
            let files = files_of(loaded);
            let names = &contents_of(files, file).names;
            assert_eq!(names.loads_by_unknown_name, is_unknown, "{text}");
            assert_eq!(names.loads_by_unknown_path, may_be_path, "{text}");
            let sites = files.analysis(file_named(files, file)).import_sites.iter();
            let unknown = (0..).zip(sites);
            let unknown: Vec<u32> = unknown
                .filter(|(_, site)| site.specifier == ImportSpecifier::Unknown)
                .map(|(index, _)| index)
                .collect();
            assert_eq!(names.unknown_names_at, unknown, "{text}");
            assert!(names.files_missing_at_build_at.is_empty(), "{text}");
            let program = loaded.contents;
            assert_eq!(program.loads_by_unknown_name, is_unknown, "{text}");
            assert_eq!(program.loads_by_unknown_path, may_be_path, "{text}");
            assert!(is_unknown || holds_library_module(loaded, NodeOs), "{text}");
        });
    }
}

#[test]
fn unknown_name_load_keeps_library_modules_written_as_values() {
    let writes = r#"console.log({ kind: "node:dgram" }, `zlib`, "node:dgram");
export const os = { os: 1 }.os;"#;
    for (loads, are_held) in [("require(process.argv[2]);", true), ("", false)] {
        let main = format!("import \"./writes.ts\";\n{loads}\n");
        let project = executable(&[("main.ts", &main), ("writes.ts", writes)]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let mut written = [NodeDgram, NodeZlib];
            written.sort_unstable_by_key(|module| module.registry_id());
            let names = &contents_of(files, "writes.ts").names;
            assert_eq!(names.written_as_values, written);
            let held = find_library_modules_that_unknown_names_may_stand_for(files);
            for module in written {
                assert_eq!(held.contains(&module), are_held, "{module:?}");
                assert!(
                    !are_held || holds_library_module(loaded, module),
                    "{module:?}"
                );
            }
            assert!(!held.contains(&NodeOs));
        });
    }
}

#[test]
fn unknown_name_load_keeps_library_modules_written_as_keys_of_more_than_one_word() {
    let writes = r#"export const wanted = { "node:zlib": 1, ["node:dgram"]: 2, ["node:" + "vm"]: 3, async_hooks: 4, "os": 5 };
wanted["node:tty"] = 6;
export class Held { "node:v8" = 7; static "bun:wrap" = 8; }
export interface Told { "node:http2": 9 }"#;
    for (loads, are_held) in [("require(process.argv[2]);", true), ("", false)] {
        let main = format!("import \"./writes.ts\";\n{loads}\n");
        let project = executable(&[("main.ts", &main), ("writes.ts", writes)]);
        load(&project, |loaded| {
            let files = files_of(loaded);
            let mut written = [
                NodeZlib,
                NodeDgram,
                NodeVm,
                RuntimeModule::NodeAsync_hooks,
                NodeTty,
                NodeV8,
                BunWrap,
            ];
            written.sort_unstable_by_key(|module| module.registry_id());
            let names = &contents_of(files, "writes.ts").names;
            assert_eq!(names.written_as_keys, written);
            assert!(names.written_as_values.is_empty());
            let held = find_library_modules_that_unknown_names_may_stand_for(files);
            for module in written {
                assert_eq!(held.contains(&module), are_held, "{module:?}");
                assert!(
                    !are_held || holds_library_module(loaded, module),
                    "{module:?}"
                );
            }
            assert!(!held.contains(&NodeOs) && !held.contains(&RuntimeModule::NodeHttp2));
        });
    }
}

#[test]
fn text_made_by_folding_is_written_as_a_value() {
    let texts: [(&str, &[RuntimeModule]); 4] = [
        (r#"["node:d", "gram"].join("")"#, &[NodeDgram]),
        (r#"["node", "dgram"].join(":")"#, &[NodeDgram]),
        (r#"["node:d", process.argv[2]].join("")"#, &[]),
        (r#"["node:d", "gram"].join("") === process.argv[2]"#, &[]),
    ];
    for (text, written) in texts {
        let main = format!("console.log({text});");
        load(&executable(&[("main.mjs", main.as_str())]), |loaded| {
            let names = &contents_of(files_of(loaded), "main.mjs").names;
            assert_eq!(names.written_as_values, written, "{text}");
        });
    }
    let hides_loader = r#"import { createRequire } from "node:module";
const held = new Proxy({}, {});
held.member = createRequire(import.meta.url);
console.log(held.member(["node:d", "gram"].join("")));"#;
    load(&executable(&[("main.mjs", hides_loader)]), |loaded| {
        assert!(loaded.contents.loads_by_unknown_name);
        assert!(holds_library_module(loaded, NodeDgram));
    });
}

#[test]
fn text_in_a_data_file_is_written_as_a_value_and_so_is_a_key_of_more_than_one_word() {
    let main = r#"import { createRequire } from "node:module";
import names from "./names.json";
console.log(createRequire(import.meta.url)(names.list[JSON.parse("1")]));"#;
    let names = r#"{ "list": ["node:os", "node:zlib"], "dgram": 1, "deep": { "one": "tty", "node:vm": 2 } }"#;
    load(
        &executable(&[("main.mjs", main), ("names.json", names)]),
        |loaded| {
            let mut written = [NodeOs, NodeZlib, NodeTty];
            written.sort_unstable_by_key(|module| module.registry_id());
            let spelled = &contents_of(files_of(loaded), "names.json").names;
            assert_eq!(spelled.written_as_values, written);
            assert_eq!(spelled.written_as_keys, [NodeVm]);
            assert!(
                written
                    .iter()
                    .all(|&module| holds_library_module(loaded, module))
            );
            assert!(holds_library_module(loaded, NodeVm));
            let held = find_library_modules_that_unknown_names_may_stand_for(files_of(loaded));
            assert!(held.contains(&NodeVm) && !held.contains(&NodeDgram));
        },
    );
}

#[test]
fn file_that_is_missing_at_build_counts_where_code_may_come_from_disk() {
    for loads_code_from_disk in [false, true] {
        let mut project = executable(&[("main.ts", r#"import("./made.mjs");"#)]);
        project.aot.loads_code_from_disk = loads_code_from_disk;
        load(&project, |loaded| {
            let names = &contents_of(files_of(loaded), "main.ts").names;
            let missing: &[u32] = match loads_code_from_disk {
                true => &[0],
                false => &[],
            };
            assert_eq!(names.files_missing_at_build_at, missing);
            assert!(names.data_missing_at_build_at.is_empty());
        });
    }
}

#[test]
fn data_file_that_is_missing_at_build_is_listed_apart_from_code() {
    for loads_code_from_disk in [false, true] {
        let mut project = executable(&[("main.ts", r#"require("./made.json");"#)]);
        project.aot.loads_code_from_disk = loads_code_from_disk;
        load(&project, |loaded| {
            let names = &contents_of(files_of(loaded), "main.ts").names;
            let missing: &[u32] = match loads_code_from_disk {
                true => &[0],
                false => &[],
            };
            assert_eq!(names.data_missing_at_build_at, missing);
            assert!(names.files_missing_at_build_at.is_empty());
            assert!(!names.loads_by_unknown_name && !names.loads_by_unknown_path);
        });
    }
}

#[test]
fn entry_taken_out_of_the_module_cache_lets_every_module_load_again() {
    let uses = [
        ("delete require.cache[key];", true),
        ("require.cache[key] = undefined;", true),
        ("globalThis.kept = [require.cache];", true),
        (r#"require.extensions[".mine"] = () => {};"#, true),
        ("module.exports = require.cache[key];", false),
        ("const mine = { cache: {} }; delete mine.cache[key];", false),
        ("if (false) delete require.cache[key];", false),
        ("", false),
    ];
    for (statement, loads_again) in uses {
        let text = format!("const key = process.argv[2];\n{statement}\n");
        let project = executable(&[
            ("main.cjs", r#"require("./uses.cjs");"#),
            ("uses.cjs", &text),
        ]);
        let found = load(&project, |loaded| loaded.contents.any_module_loads_again);
        assert_eq!(found, loads_again, "{statement}");
    }
    for (statement, loads_again) in [
        ("jest.resetModules();", true),
        ("jest.clearAllMocks();", false),
    ] {
        let test_file = format!(
            "import {{ jest, test }} from \"bun:test\";\ntest(\"t\", () => {{ {statement} }});\n"
        );
        let project = test_run(&[("a.test.ts", &test_file)]);
        let found = load(&project, |loaded| loaded.contents.any_module_loads_again);
        assert_eq!(found, loads_again, "{statement}");
    }
}

#[test]
fn compiled_file_that_a_test_run_changes_is_listed() {
    let changes = [
        (
            r#"writeFileSync(import.meta.dir + "/made.ts", "export default 2"); await import("./made.ts");"#,
            true,
        ),
        (
            r#"writeFileSync(import.meta.dir + "/out.txt", "x"); await import("./made.ts");"#,
            false,
        ),
        (
            r#"rmSync(import.meta.dir + "/lib", { recursive: true }); await import("./lib/a.ts");"#,
            true,
        ),
        (
            r#"rmSync(import.meta.dir + "/lib"); await import("./lib/a.ts");"#,
            false,
        ),
        (
            r#"rmSync(import.meta.dir + "/tmp", { recursive: true }); await import("./lib/a.ts");"#,
            false,
        ),
        (
            r#"writeFileSync(import.meta.dir + "/lib/" + process.argv[2] + ".ts", ""); await import("./lib/a.ts");"#,
            true,
        ),
        (
            r#"writeFileSync(import.meta.dir + "/lib/" + process.argv[2] + ".txt", ""); await import("./lib/a.ts");"#,
            false,
        ),
        (
            r#"if (false) writeFileSync(import.meta.dir + "/made.ts", ""); await import("./made.ts");"#,
            false,
        ),
        (
            r#"writeFileSync(process.argv[2], ""); await import("./made.ts");"#,
            false,
        ),
    ];
    let loads_again_in = |project_of: fn(&[(&str, &str)]) -> TestProject, statement: &str| {
        let text = format!("import {{ rmSync, writeFileSync }} from \"node:fs\";\n{statement}\n");
        let project = project_of(&[
            ("a.test.ts", &text),
            ("made.ts", "export default 1;"),
            ("lib/a.ts", "export const a = 1;"),
        ]);
        load(&project, |loaded| {
            !loaded.contents.run.loads.files_changed_on_disk.is_empty()
        })
    };
    for (statement, loads_again) in changes {
        assert_eq!(
            loads_again_in(test_run, statement),
            loads_again,
            "{statement}"
        );
    }
    assert!(!loads_again_in(executable, changes[0].0));
}

#[test]
fn file_loaded_under_a_query_lets_every_module_load_again() {
    let loads = [
        (r#"await import("./a.ts?again");"#, true),
        (r#"await import("./a.ts?" + process.argv[2]);"#, true),
        (
            r#"await import(process.argv[2] ? "./a.ts" : "./a.ts?again");"#,
            true,
        ),
        (r#"await import("./a.ts");"#, false),
        (r#"if (false) await import("./a.ts?again");"#, false),
    ];
    for (statement, loads_again) in loads {
        let test_file = format!(
            "import {{ test }} from \"bun:test\";\n{statement}\ntest(\"t\", () => {{}});\n"
        );
        let project = test_run(&[("a.test.ts", &test_file), ("a.ts", "export const a = 1;")]);
        let found = load(&project, |loaded| loaded.contents.any_module_loads_again);
        assert_eq!(found, loads_again, "{statement}");
    }
}

#[test]
fn mock_under_a_name_that_is_not_spelled_may_replace_any_module() {
    let mocks = [
        (r#"mock.module("./a.ts", factory);"#, false),
        (
            r#"mock.module(process.argv[2] ? "./a.ts" : "./b.ts", factory);"#,
            false,
        ),
        (
            r#"mock.module("./" + process.argv[2] + ".ts", factory);"#,
            true,
        ),
        ("mock.module(process.argv[2], factory);", true),
        ("if (false) mock.module(process.argv[2], factory);", false),
        (
            "const mine = { module(name: string) {} }; mine.module(process.argv[2]);",
            false,
        ),
        (
            r#"import { replace } from "a-package"; replace("./a.ts");"#,
            true,
        ),
    ];
    for (statement, mocks_any_module) in mocks {
        let test_file = format!(
            "import {{ mock, test }} from \"bun:test\";\nconst factory = () => ({{}});\n{statement}\ntest(\"t\", () => {{}});\n"
        );
        let project = test_run(&[
            ("a.test.ts", &test_file),
            ("a.ts", "export const a = 1;"),
            ("b.ts", "export const b = 2;"),
            (
                "node_modules/a-package/package.json",
                r#"{ "name": "a-package", "version": "1.0.0", "main": "index.js" }"#,
            ),
            (
                "node_modules/a-package/index.js",
                r#"const { mock } = require("bun:test"); exports.replace = name => mock.module(name, () => ({}));"#,
            ),
        ]);
        let found = load(&project, |loaded| loaded.contents.mocks_any_module);
        assert_eq!(found, mocks_any_module, "{statement}");
    }
}

#[test]
fn mocking_function_used_as_a_value_may_replace_any_module() {
    let uses = [
        (
            "mock",
            "const kept = mock.module; kept(process.argv[2], factory);",
            true,
        ),
        (
            "mock",
            "mock[process.argv[2]](process.argv[3], factory);",
            true,
        ),
        ("vi", "console.log([vi.mock]);", true),
        ("jest", "console.log({ runner: jest });", true),
        ("jest", "export const runner = () => jest;", true),
        ("mock", "console.log(typeof mock.module);", false),
        ("mock", "console.log(mock.module === undefined);", false),
        ("vi", "if (vi.mock) console.log(1);", false),
        ("jest", "console.log(!jest.doMock);", false),
        ("jest", "jest.fn();", false),
    ];
    for (name, statement, mocks_any_module) in uses {
        let test_file = format!(
            "import {{ {name}, test }} from \"bun:test\";\nconst factory = () => ({{}});\n{statement}\ntest(\"t\", () => {{}});\n"
        );
        let project = test_run(&[("a.test.ts", &test_file)]);
        let found = load(&project, |loaded| loaded.contents.mocks_any_module);
        assert_eq!(found, mocks_any_module, "{statement}");
    }
}

#[test]
fn builtin_writes_of_a_test_run_merge_into_one_list() {
    let writes = "Array.from = () => [];\nObject.prototype.zeta = 1;\n";
    let test_file = format!(
        "import {{ test }} from \"bun:test\";\nimport \"./helper.ts\";\nimport \"./reads.ts\";\n{writes}test(\"t\", () => {{}});\n"
    );
    let project = test_run(&[
        ("a.test.ts", &test_file),
        (
            "helper.ts",
            "import { spyOn } from \"bun:test\";\nspyOn(Array.prototype, \"push\");\nArray.from = () => [];\nMath[process.argv[2]] = () => 0;\nObject.prototype.alpha = 1;\n",
        ),
        (
            "reads.ts",
            "export const made = Array.from([1]);\nexport const is = Array.isArray(made);\n",
        ),
    ]);
    load(&project, |loaded| {
        let (files, program) = (files_of(loaded), loaded.contents);
        let replaced = &program.replaced_builtins;
        assert!(replaced.is_sorted_by(|a, b| a < b), "{replaced:?}");
        for member in [
            BuiltinId::ArrayFrom,
            BuiltinId::ArrayPrototypePush,
            BuiltinId::MathMax,
            BuiltinId::MathFloor,
        ] {
            assert!(replaced.contains(&(member as u32)), "{member:?}");
        }
        assert!(!replaced.contains(&(BuiltinId::ArrayIsArray as u32)));
        assert_eq!(
            describe_names_added(files, program),
            ["ObjectPrototype.alpha", "ObjectPrototype.zeta"]
        );
        assert!(program.can_replace_builtins());
        let unlocked = mutabilities_of(files, "reads.ts", BuiltinId::ArrayFrom);
        assert!(!unlocked.is_empty());
        assert!(
            unlocked
                .iter()
                .all(|&it| it == Mutability::ConstantUnlessWritten)
        );
        let left_to_engine = mutabilities_of(files, "reads.ts", BuiltinId::ArrayIsArray);
        assert!(!left_to_engine.is_empty());
        assert!(
            left_to_engine
                .iter()
                .all(|&it| it == Mutability::ConstantUnlessWritten)
        );
    });
    load(&executable(&[("main.ts", writes)]), |loaded| {
        assert!(loaded.contents.replaced_builtins.is_empty());
        assert!(loaded.contents.names_added_to_builtins.is_empty());
        assert!(!loaded.contents.can_replace_builtins());
        let written = mutabilities_of(files_of(loaded), "main.ts", BuiltinId::ArrayFrom);
        assert!(written.iter().all(|&it| it == Mutability::AlwaysLocked));
    });
}

#[test]
fn a_name_that_a_test_adds_to_a_builtin_counts_as_a_replacement_for_the_library() {
    let head = "import { test } from \"bun:test\";\ntest(\"t\", () => {});\n";
    for (write, can_replace) in [
        ("", false),
        ("const own = { emitClose: false };\n", false),
        ("Object.prototype.emitClose = false;\n", true),
        (
            "Object.defineProperty(Object.prototype, \"_writableState\", { get() {} });\n",
            true,
        ),
        ("Function.prototype.extra = 1;\n", true),
    ] {
        let text = format!("{head}{write}");
        load(&test_run(&[("a.test.ts", &text)]), |loaded| {
            assert!(loaded.contents.replaced_builtins.is_empty(), "{write}");
            assert_eq!(
                loaded.contents.can_replace_builtins(),
                can_replace,
                "{write}"
            );
        });
    }
}

#[test]
fn object_that_may_be_written_is_not_an_object_that_is_replaced() {
    let writes: [(&str, &[BuiltinId], &[BuiltinId]); 3] = [
        (
            "expect(new Map()).toBeInstanceOf(Map);",
            &[BuiltinId::MapGroupBy],
            &[
                BuiltinId::Map,
                BuiltinId::MapPrototype,
                BuiltinId::MapPrototypeGet,
            ],
        ),
        (
            "globalThis.Map = class {};",
            &[BuiltinId::Map, BuiltinId::MapPrototypeGet],
            &[],
        ),
        (
            "Array.prototype[process.argv[2]] = () => 0;",
            &[BuiltinId::ArrayPrototypePush],
            &[],
        ),
    ];
    for (statement, held, lacked) in writes {
        let test_file = format!(
            "import {{ expect, test }} from \"bun:test\";\ntest(\"t\", () => {{ {statement} }});\n"
        );
        load(&test_run(&[("a.test.ts", &test_file)]), |loaded| {
            let replaced = &loaded.contents.replaced_builtins;
            for &member in held {
                assert!(
                    replaced.contains(&(member as u32)),
                    "{statement}: {member:?}"
                );
            }
            for &member in lacked {
                assert!(
                    !replaced.contains(&(member as u32)),
                    "{statement}: {member:?}"
                );
            }
        });
    }
}

#[test]
fn name_that_an_executable_adds_to_a_builtin_object_is_listed() {
    let main = "Function.prototype.once = () => {};";
    load(&executable(&[("main.ts", main)]), |loaded| {
        let added = describe_names_added(files_of(loaded), loaded.contents);
        assert_eq!(added, ["FunctionPrototype.once"]);
        assert!(loaded.contents.replaced_builtins.is_empty());
    });
}

fn borrow_files(files: &[(String, String)]) -> Vec<(&str, &str)> {
    let files = files.iter();
    files.map(|(name, text)| (&name[..], &text[..])).collect()
}

fn assert_same_at_1_and_16_threads(mut project: TestProject, check: impl Fn(&LoadedBuild<'_, '_>)) {
    let mut describe_with = |thread_count: u32| {
        project.aot.thread_count = NonZeroU32::new(thread_count);
        load(&project, |loaded| {
            check(loaded);
            describe_program(loaded)
        })
    };
    let expected = describe_with(1);
    for _ in 0..4 {
        assert_eq!(describe_with(16), expected);
    }
}

#[test]
fn what_an_executable_holds_does_not_depend_on_the_threads() {
    let mut main = "export const start = (url: URL) => new Worker(url);\n".to_owned();
    let mut files = vec![("main.ts".to_owned(), String::new())];
    for part in 0..PARTS {
        let _ = writeln!(main, "import \"./part{part}.ts\";");
        let text = format!(
            "export const url = new URL(\"./worker{part}.ts\", import.meta.url);\nconsole.log(\"node:dgram\", \"zlib\");\nrequire(process.argv[{part}] ? \"node:vm\" : \"node:v8\");\nrequire(process.argv[{part}]);\n"
        );
        files.push((format!("part{part}.ts"), text));
        files.push((
            format!("worker{part}.ts"),
            format!("postMessage({part});\n"),
        ));
    }
    files[0].1 = main;
    assert_same_at_1_and_16_threads(executable(&borrow_files(&files)), |loaded| {
        assert_eq!(loaded.contents.found_entry_points.len(), PARTS);
        assert_found_follow_written(loaded, 1);
    });
}

#[test]
fn what_a_test_run_replaces_does_not_depend_on_the_threads() {
    let members = ["Array.from", "Array.isArray", "Math.max", "Math.floor"];
    let mut test_file = "import { test } from \"bun:test\";\n".to_owned();
    let mut files = vec![("a.test.ts".to_owned(), String::new())];
    for part in 0..PARTS {
        let _ = writeln!(test_file, "import \"./helper{part}.ts\";");
        let member = members[part % members.len()];
        let text = format!("{member} = () => 0;\nObject.prototype.added{part} = {part};\n");
        files.push((format!("helper{part}.ts"), text));
    }
    test_file.push_str("test(\"t\", () => {});\n");
    files[0].1 = test_file;
    assert_same_at_1_and_16_threads(test_run(&borrow_files(&files)), |loaded| {
        let program = loaded.contents;
        let replaced = &program.replaced_builtins;
        assert!(replaced.is_sorted_by(|a, b| a < b), "{replaced:?}");
        assert!(replaced.len() >= members.len(), "{replaced:?}");
        let added = describe_names_added(files_of(loaded), program);
        assert_eq!(added.len(), PARTS);
        assert!(added.is_sorted(), "{added:?}");
    });
}

const REQUIRE_OF_ESBUILD: &str = "var __require = /* @__PURE__ */ (x => typeof require !== 'undefined' ? require : typeof Proxy !== 'undefined' ? new Proxy(x, { get: (a, b) => (typeof require !== 'undefined' ? require : a)[b] }) : x)(function (x) { if (typeof require !== 'undefined') return require.apply(this, arguments); throw Error('Dynamic require of \"' + x + '\" is not supported'); });";

fn modules_named_by(loaded: &LoadedBuild<'_, '_>, name: &str) -> Vec<RuntimeModule> {
    let named = contents_of(files_of(loaded), name).names.all_modules();
    named.iter().map(|it| it.module).collect()
}

#[test]
fn a_call_that_is_no_import_site_names_the_library_modules_that_it_loads() {
    let choice = "process.getBuiltinModule(Math.random() ? 'node:vm' : 'node:v8');";
    load(&executable(&[("main.mjs", choice)]), |loaded| {
        let named = modules_named_by(loaded, "main.mjs");
        assert!(
            named.contains(&NodeVm) && named.contains(&NodeV8),
            "{named:?}"
        );
    });
    let alias = format!(
        "{REQUIRE_OF_ESBUILD} __require('node:os'); function load(name) {{ return __require(name); }} load('node:zlib');"
    );
    load(&executable(&[("main.mjs", alias.as_str())]), |loaded| {
        assert!(holds_library_module(loaded, NodeOs));
        assert_eq!(modules_named_by(loaded, "main.mjs"), [NodeZlib]);
    });
}

#[test]
fn a_binding_that_a_file_imports_is_a_loader_where_the_exporter_says_so() {
    let chunk = format!("export {REQUIRE_OF_ESBUILD} export var other = (name) => name;");
    let main = "import { __require, other } from './chunk.mjs'; __require('node:dgram'); other('node:os');";
    let files = [("main.mjs", main), ("chunk.mjs", chunk.as_str())];
    load(&executable(&files), |loaded| {
        assert!(holds_library_module(loaded, NodeDgram));
    });
}
