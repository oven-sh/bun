use super::*;
use crate::load::source_provider::{
    DeferredLoad, Failed, LoadRequest, Loaded, MacroCall, ModuleName, Resolution, ResolveRequest,
    SourceFile,
};
use crate::load::{SourceKind, host_platform, read_file_bytes};
use crate::lower::Fragment;
use crate::statistics::{LimitId, StatisticId};
use bun_core::strings::contains;
use bun_sema::atom::Interner;
use bun_sema::fold::{Constant, Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::{DataModule, DataValue};
use bun_sema::resolve::JsxSettings;
use bun_sema::session::Arena;

const DEBUG_CALL: &str = "export function probe() { if (DEBUG) probeDebug(); }";
const DEBUG_IMPORT: [(&str, &str); 2] = [
    ("main.js", "if (DEBUG) import(\"./debug.js\");\nexport {};"),
    ("debug.js", "export {};"),
];
const TYPE_ERROR: [(&str, &str); 1] = [("a.ts", "export const x: number = \"a\";")];

struct DebugIsFalse;

impl SourceProvider for DebugIsFalse {
    fn fold_options<'s>(
        &self,
        arena: &'s Arena,
        atoms: &Interner<'s>,
        log: &mut Log,
    ) -> FoldOptions<'s> {
        let define = Define {
            path: DefinePath {
                root: DefineRoot::Global(atoms.intern(b"DEBUG")),
                members: &[],
            },
            value: DefineValue::Constant(Constant::Boolean(false)),
        };
        FoldOptions {
            defines: arena.alloc_slice_copy(&[define]),
            ..WithoutServices.fold_options(arena, atoms, log)
        }
    }

    fn resolve(&self, request: &ResolveRequest<'_>, log: &mut Log) -> Result<Resolution, Failed> {
        WithoutServices.resolve(request, log)
    }

    fn load(&self, request: &LoadRequest<'_>, log: &mut Log) -> Result<Loaded, Failed> {
        WithoutServices.load(request, log)
    }

    fn has_load_plugin(&self, module: ModuleName<'_>) -> bool {
        WithoutServices.has_load_plugin(module)
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
        WithoutServices.parse_data(file, arena, atoms, log)
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

fn has_string(fragment: &Fragment, text: &str) -> bool {
    fragment.strings.find(text.as_bytes()).is_some()
}

fn find_defining_fragment<'a>(
    lowered_files: &'a [(FileId, LoweredFile)],
    function_name: &str,
) -> Option<&'a Fragment> {
    let mut fragments = lowered_files.iter().map(|(_, lowered)| &lowered.fragment);
    fragments.find(|fragment| {
        let mut names = fragment
            .functions
            .iter()
            .filter_map(|(_, function)| function.name);
        names.any(|name| fragment.strings.get(name) == function_name.as_bytes())
    })
}

#[track_caller]
fn find_probe_fragment(lowered_files: &[(FileId, LoweredFile)]) -> &Fragment {
    let fragment = find_defining_fragment(lowered_files, "probe");
    fragment.expect("no fragment has a function named probe")
}

fn lower_function_text(embeds_function_source: bool) -> Vec<u8> {
    let aot = AotOptions {
        embeds_function_source,
        ..AotOptions::default()
    };
    let files = [("main.js", DEBUG_CALL)];
    let project = TestProject::new(&files, &default_settings()).with_aot_options(aot);
    let lowered = lower_application(&project);
    find_probe_fragment(&lowered).module.function_text.clone()
}

fn lowering_options(embeds_function_text: bool) -> LoweringOptions {
    LoweringOptions {
        platform: host_platform(),
        embeds_function_text,
        reports_type_mismatches: false,
        removable: Default::default(),
        minifies_identifiers: false,
    }
}

fn find_compiled_file(input: &BindInput<'_, '_>, public_path: &[u8]) -> Option<FileId> {
    let mut files = input.files.compiled_files().iter().copied();
    files.find(|&file| input.sources.module_paths(file).public_path == public_path)
}

fn classic_settings() -> TranspileSettings {
    TranspileSettings {
        jsx: JsxSettings {
            runtime: JsxRuntime::Classic,
            factory: vec![b"h".to_vec(), b"create".to_vec()],
            fragment: vec![b"h".to_vec(), b"Fragment".to_vec()],
            ..JsxSettings::default()
        },
        ..default_settings()
    }
}

fn compiled_settings(files: &[(&str, &str)], settings: &TranspileSettings) -> TranspileSettings {
    with_bind_input(files, settings, |input| {
        let entry_point = input.sources.entry_points()[0].file;
        let compiled = input.files.compiled(entry_point).unwrap();
        compiled.settings.clone()
    })
}

#[test]
fn default_configuration() {
    let expected = concat!(
        r#"{"compilerOptions":{"lib":["ESNext"],"target":"ESNext","module":"Preserve","#,
        r#""moduleDetection":"force","jsx":"react-jsxdev","allowJs":true,"#,
        r#""moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"#,
        r#""strict":true,"skipLibCheck":true,"jsxImportSource":"react","#,
        r#""experimentalDecorators":false,"emitDecoratorMetadata":false}}"#,
    );
    let written = write_configuration(&default_settings());
    assert_eq!(BStr::new(&written), expected);
}

#[test]
fn classic_configuration() {
    let settings = TranspileSettings {
        use_define_for_class_fields: Some(false),
        ..classic_settings()
    };
    let written = write_configuration(&settings);
    assert!(contains(&written, br#""jsx":"react","#));
    assert!(contains(&written, br#""jsxFactory":"h.create","#));
    assert!(contains(&written, br#""jsxFragmentFactory":"h.Fragment","#));
    assert!(contains(&written, br#""useDefineForClassFields":false"#));
    assert!(!contains(&written, b"jsxImportSource"));
}

#[test]
fn lowers_each_compiled_file_once() {
    let files = [("a.ts", "export const x: number = 1")];
    let settings = default_settings();
    let lowered = lower_program_with_settings(&files, &settings);
    let lowered: Vec<FileId> = lowered.into_iter().map(|(file, _)| file).collect();
    let mut compiled = with_bind_input(&files, &settings, |input| {
        input.files.compiled_files().to_vec()
    });
    compiled.sort_unstable();
    assert!(lowered.is_sorted_by(|a, b| a < b));
    assert_eq!(lowered, compiled);
}

#[test]
fn settings_reach_compiled_module() {
    let settings = TranspileSettings {
        jsx: JsxSettings {
            is_development: false,
            import_source: b"preact".to_vec(),
            ..JsxSettings::default()
        },
        experimental_decorators: true,
        emits_decorator_metadata: true,
        use_define_for_class_fields: Some(false),
    };
    let files = [("a.ts", "export {};")];
    assert_eq!(compiled_settings(&files, &settings), settings);
}

#[test]
fn classic_settings_reach_compiled_module() {
    let settings = classic_settings();
    let files = [("a.ts", "export {};")];
    assert_eq!(compiled_settings(&files, &settings), settings);
}

#[test]
fn configuration_file_overrides_settings() {
    let written = write_configuration(&default_settings());
    let files = [
        ("a.ts", "export {};"),
        (CONFIGURATION_FILE, str::from_utf8(&written).unwrap()),
    ];
    let settings = TranspileSettings {
        experimental_decorators: true,
        ..default_settings()
    };
    assert!(!compiled_settings(&files, &settings).experimental_decorators);
}

#[test]
fn type_errors_do_not_panic() {
    let files = [("a.ts", "const x: number = \"a\";")];
    assert!(!lower_program_with_settings(&files, &default_settings()).is_empty());
}

#[test]
#[should_panic(expected = "Could not resolve")]
fn unresolved_import_panics() {
    lower_program_with_settings(&[("a.ts", "import \"./nope\";")], &default_settings());
}

#[test]
fn provider_defines_reach_lowering() {
    let files = [("main.js", DEBUG_CALL)];
    let settings = default_settings();
    let folded = lower_program_with_provider(&files, &settings, &DebugIsFalse);
    let folded = find_probe_fragment(&folded);
    assert!(!has_string(folded, "DEBUG"));
    assert!(!has_string(folded, "probeDebug"));

    let unfolded = lower_program_with_settings(&files, &settings);
    let unfolded = find_probe_fragment(&unfolded);
    assert!(has_string(unfolded, "DEBUG"));
    assert!(has_string(unfolded, "probeDebug"));
}

#[test]
fn options_reach_lowering() {
    assert_eq!(BStr::new(&lower_function_text(true)), DEBUG_CALL);
    assert!(lower_function_text(false).is_empty());
}

#[test]
fn lowering_options_replace_build_options() {
    let lowered = lower_program(&[("main.js", DEBUG_CALL)], lowering_options(false));
    assert!(
        find_probe_fragment(&lowered)
            .module
            .function_text
            .is_empty()
    );
}

#[test]
fn limits_reach_lowering() {
    let files = [(
        "a.ts",
        "export const x: { a: { b: number } } = { a: { b: 1 } };",
    )];
    let count_losses = |limits: LimitValues| -> usize {
        let lowered = lower_program_with_limits(&files, limits);
        let losses = lowered
            .iter()
            .map(|(_, lowered)| lowered.counters.losses().len());
        losses.sum()
    };
    let mut lowered_limits = LimitValues::for_host();
    lowered_limits.lower(LimitId::MaxTypeNodes, 0);
    assert_eq!(count_losses(LimitValues::for_host()), 0);
    assert!(count_losses(lowered_limits) > 0);
}

#[test]
fn options_keep_requested_thread_count() {
    let project = || TestProject::new(&TYPE_ERROR, &default_settings());
    let unset = project().with_aot_options(AotOptions::default());
    assert_eq!(unset.aot.thread_count, NonZeroU32::new(1));
    let set = project().with_aot_options(AotOptions {
        thread_count: NonZeroU32::new(4),
        ..AotOptions::default()
    });
    assert_eq!(set.aot.thread_count, NonZeroU32::new(4));
}

#[test]
fn react_compiler_mode_reaches_load_options() {
    let mode_of = |project: &TestProject| project.options(BUNDLED_LIBS).load.react_compiler;
    let project = TestProject::new(&TYPE_ERROR, &default_settings());
    assert_eq!(mode_of(&project), ReactCompilerMode::Disabled);
    let project = project.with_react_compiler(ReactCompilerMode::Ssr);
    assert_eq!(mode_of(&project), ReactCompilerMode::Ssr);
}

#[test]
fn first_files_are_entry_points() {
    const NAMES: [&str; 3] = ["probeFirst", "probeSecond", "probeThird"];
    let files = [
        ("first.js", "export function probeFirst() {}"),
        ("second.js", "export function probeSecond() {}"),
        ("third.js", "export function probeThird() {}"),
    ];
    let settings = default_settings();
    let find_lowered_probes = |entry_point_count: usize| {
        let project = TestProject::with_entry_points(&files, entry_point_count, &settings);
        let lowered = lower_application(&project);
        NAMES.map(|name| find_defining_fragment(&lowered, name).is_some())
    };
    assert_eq!(find_lowered_probes(1), [true, false, false]);
    assert_eq!(find_lowered_probes(2), [true, true, false]);
    assert_eq!(find_lowered_probes(3), [true, true, true]);
}

#[test]
fn entry_points_have_names() {
    let files = [("a.js", ""), ("b.js", ""), ("c.js", "")];
    let project = TestProject::with_entry_points(&files, 2, &default_settings());
    assert_eq!(project.entry_points, [b"a.js".to_vec(), b"b.js".to_vec()]);
    assert_eq!(project.paths.entry_point_names, project.entry_points);
    project.options(BUNDLED_LIBS).debug_assert_valid();
}

#[test]
#[should_panic(expected = "3 entry points in 2 files")]
fn entry_point_without_file_panics() {
    let files = [("a.js", ""), ("b.js", "")];
    TestProject::with_entry_points(&files, 3, &default_settings());
}

#[test]
fn lowering_inputs_cover_entry_point() {
    let files = [("a.ts", "import \"./b\";"), ("b.ts", "export {};")];
    with_lowering_inputs(&files, |loaded, inputs, entry_point| {
        assert_eq!(loaded.by_path.get(b"/project/a.ts"), Some(entry_point));
        assert!(inputs.files[entry_point.idx()].is_some());
    });
}

#[test]
fn project_view_shows_application_project() {
    with_project_view(&TYPE_ERROR, |view| {
        assert_eq!(view.sources.project(), ProjectId::Application);
        assert_eq!(view.files().entry_points().len(), 1);
    });
}

#[test]
fn link_returns_program_or_failure() {
    let settings = default_settings();
    let link = |files: &[(&str, &str)]| {
        link_project(&TestProject::new(files, &settings).with_aot_options(AotOptions::default()))
    };
    let statistics = link(&DEBUG_IMPORT).unwrap().summary.statistics;
    assert_eq!(statistics.get(StatisticId::SourceFilesInferred), 2);
    let stage = link(&TYPE_ERROR).err().map(|failed| failed.stage);
    assert_eq!(stage, Some(Stage::Lower));
}

#[test]
fn type_error_is_lowered_and_linked() {
    let settings = default_settings();
    let entry_count =
        lower_and_link_program(&TYPE_ERROR, &settings, |program, _| program.entries.len());
    assert_eq!(entry_count, 1);
}

#[test]
fn provider_and_paths_reach_load() {
    let settings = default_settings();
    with_bind_input(&DEBUG_IMPORT, &settings, |input| {
        assert!(find_compiled_file(input, b"/$bunfs/root/main.js").is_some());
        assert!(find_compiled_file(input, b"/$bunfs/root/debug.js").is_some());
    });
    with_bind_input_and_provider(&DEBUG_IMPORT, &settings, &DebugIsFalse, |input| {
        let main = find_compiled_file(input, b"/$bunfs/root/main.js");
        assert_eq!(main, Some(input.sources.entry_points()[0].file));
        assert!(find_compiled_file(input, b"/$bunfs/root/debug.js").is_none());
    });
}

#[test]
fn virtual_path_replaces_runtime_source() {
    const SOURCE: &str = "export function probe() { return $argumentCount(); }\n";
    let files = [
        ("main.ts", "import \"node:os\";"),
        ("/$bun/js/node/os.ts", SOURCE),
    ];
    with_runtime_bind_input(&files, |input| {
        let file = find_compiled_file(input, b"node:os").unwrap();
        assert!(matches!(
            input.sources.kind(file),
            SourceKind::RuntimeModule(_)
        ));
        assert_eq!(input.files.hir(file).source_len as usize, SOURCE.len());
    });
    let settings = default_settings();
    let lowered = with_build(BUNDLED_LIBS, &files, &settings, &WithoutServices, |build| {
        lower_files(build, ProjectId::Runtime)
    });
    let fragment = find_probe_fragment(&lowered);
    assert!(!has_string(fragment, "$argumentCount"));

    let lowered = lower_program(&files, lowering_options(true));
    assert_eq!(lowered.len(), 2);
    assert!(find_defining_fragment(&lowered[..1], "probe").is_none());
    assert!(find_defining_fragment(&lowered[1..], "probe").is_some());
}

#[test]
fn other_names_are_project_files() {
    assert_eq!(in_memory_path("src/a.ts"), b"/project/src/a.ts");
    assert_eq!(
        in_memory_path("$bun/js/node/os.ts"),
        b"/project/$bun/js/node/os.ts"
    );
    assert_eq!(
        in_memory_path("/$bun/js/node/os.ts"),
        b"/$bun/js/node/os.ts"
    );
}

#[test]
fn loaded_build_has_both_projects() {
    with_loaded_build(&TYPE_ERROR, &default_settings(), |_, loaded| {
        for project in ProjectId::ALL {
            assert_eq!(loaded.project(project).sources.project(), project);
        }
    });
}

#[test]
fn temporary_directory_is_removed_when_dropped() {
    let directory = TemporaryDirectory::new("testing_temporary_directory");
    directory.write("nested/a.txt", "text");
    let path = from_native(&[directory.path(), b"/nested/a.txt"].concat());
    assert_eq!(read_file_bytes(&path).as_deref(), Some(&b"text"[..]));
    drop(directory);
    assert_eq!(read_file_bytes(&path), None);
}

#[test]
fn on_disk_project_compiles_file_under_the_aot_condition() {
    let directory = TemporaryDirectory::new("testing_typed_package");
    let configuration = write_configuration(&default_settings());
    directory.write(CONFIGURATION_FILE, str::from_utf8(&configuration).unwrap());
    directory.write("app.ts", "import \"p\";\n");
    directory.write_typed_package("export const x = 1;\n", "export const x: number = 1;\n");
    let project = TestProject::on_disk(directory.path(), &["app.ts"]);
    let typed_paths = run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            let compiled_files = files.compiled_files().iter().copied();
            let typed_files = compiled_files
                .filter(|&file| files.compiled(file).is_some_and(|it| it.is_aot_source));
            let typed_paths = typed_files.map(|file| files.module(file).file_name().to_vec());
            Ok(typed_paths.collect::<Vec<_>>())
        })
    });
    let [typed_path] = typed_paths.as_slice() else {
        panic!("{} files are aot sources", typed_paths.len());
    };
    assert!(typed_path.ends_with(b"/node_modules/p/x.aot.ts"));
}
