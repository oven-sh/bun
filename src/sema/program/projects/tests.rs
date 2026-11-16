#![cfg(not(miri))]

use super::*;
use crate::program::code_test_host::{StatementsHost, TestBuild, load_files, with_compile_context};
use crate::resolve::{CodeHost, CodeOptions};

const ES2015_CONFIG: &str = "{ compilerOptions: { target: \"es2015\" } }";
const UNREADABLE_CONFIG: &str = "unreadable";

struct UnreadableConfigs {
    config_paths: &'static [&'static str],
    is_case_sensitive: bool,
    lookups: AtomicUsize,
    reads: AtomicUsize,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
struct HostCalls {
    lookups: usize,
    reads: usize,
}

impl UnreadableConfigs {
    fn new(config_paths: &'static [&'static str]) -> UnreadableConfigs {
        UnreadableConfigs {
            config_paths,
            is_case_sensitive: true,
            lookups: AtomicUsize::new(0),
            reads: AtomicUsize::new(0),
        }
    }

    fn calls(&self) -> HostCalls {
        HostCalls {
            lookups: self.lookups.load(Ordering::Relaxed),
            reads: self.reads.load(Ordering::Relaxed),
        }
    }
}

impl Host for UnreadableConfigs {
    fn read(&self, _path: &[u8]) -> Option<Cow<'static, [u8]>> {
        self.reads.fetch_add(1, Ordering::Relaxed);
        None
    }

    fn is_file(&self, path: &[u8]) -> bool {
        self.lookups.fetch_add(1, Ordering::Relaxed);
        self.config_paths.iter().any(|it| it.as_bytes() == path)
    }

    fn is_dir(&self, _path: &[u8]) -> bool {
        false
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        path.to_vec()
    }

    fn list_dir(&self, _path: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        _arena: &'s Arena,
        _path: &[u8],
        _text: &[u8],
        _atoms: &Interner<'s>,
        _options: ParseOptions,
    ) -> hir::File<'s> {
        unreachable!("a file that cannot be read is not parsed")
    }

    fn parse_package_json(&self, _arena: &Arena, _text: &[u8]) -> Option<Json> {
        None
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

impl CodeHost for UnreadableConfigs {}

#[derive(Copy, Clone)]
struct Build {
    config_path: &'static str,
    tsconfig_override: Option<&'static str>,
}

const PROGRAM: Build = Build {
    config_path: "/p/tsconfig.json",
    tsconfig_override: None,
};

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_context<R>(
    host: &dyn CodeHost,
    build: Build,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    let build = TestBuild {
        options: Options {
            config_path: build.config_path.into(),
            current_directory: b"/cwd".to_vec(),
            lib_dir: b"/lib".to_vec(),
            ..Options::default()
        },
        code: CodeOptions {
            tsconfig_override: build.tsconfig_override.map(Vec::from),
            ..CodeOptions::bun_run(b"/p")
        },
        ..TestBuild::new(host, &[])
    };
    with_compile_context(&build, test)
}

fn assert_program_governs(context: &CodeLoadContext<'_, '_, '_>, path: &[u8]) {
    assert!(context.projects.governing(context, path).is_none());
}

fn count_configuration_reads(config_path: &'static str, is_case_sensitive: bool) -> usize {
    let host = UnreadableConfigs {
        is_case_sensitive,
        ..UnreadableConfigs::new(&["/p/tsconfig.json"])
    };
    let build = Build {
        config_path,
        ..PROGRAM
    };
    with_context(&host, build, |context| {
        assert_program_governs(context, b"/p/src/a.ts");
    });
    host.calls().reads
}

fn checks_of(options: &Options) -> Vec<(&'static str, bool)> {
    vec![
        ("strictNullChecks", options.strict_null_checks),
        ("noImplicitAny", options.no_implicit_any),
        (
            "noImplicitAny is specified",
            options.specifies_no_implicit_any,
        ),
        ("noImplicitThis", options.no_implicit_this),
        ("strictFunctionTypes", options.strict_function_types),
        ("strictBindCallApply", options.strict_bind_call_apply),
        (
            "strictBuiltinIteratorReturn",
            options.strict_builtin_iterator_return,
        ),
        (
            "strictPropertyInitialization",
            options.strict_property_initialization,
        ),
        (
            "useUnknownInCatchVariables",
            options.use_unknown_in_catch_variables,
        ),
        (
            "exactOptionalPropertyTypes",
            options.exact_optional_property_types,
        ),
        (
            "noUncheckedIndexedAccess",
            options.no_unchecked_indexed_access,
        ),
        (
            "noPropertyAccessFromIndexSignature",
            options.no_property_access_from_index_signature,
        ),
        ("noImplicitReturns", options.no_implicit_returns),
        ("noImplicitOverride", options.no_implicit_override),
        (
            "noFallthroughCasesInSwitch",
            options.no_fallthrough_cases_in_switch,
        ),
        ("noUnusedLocals", options.no_unused_locals),
        ("noUnusedParameters", options.no_unused_parameters),
        (
            "noUncheckedSideEffectImports",
            options.no_unchecked_side_effect_imports,
        ),
        ("isolatedModules", options.isolated_modules),
        (
            "isolatedModules is reported",
            options.isolated_modules_reported,
        ),
        ("verbatimModuleSyntax", options.verbatim_module_syntax),
        ("erasableSyntaxOnly", options.erasable_syntax_only),
        ("isolatedDeclarations", options.isolated_declarations),
        (
            "rewriteRelativeImportExtensions",
            options.rewrite_relative_import_extensions,
        ),
        (
            "no synthetic default imports",
            options.forbids_synthetic_default_imports,
        ),
        (
            "no unreachable code",
            options.allow_unreachable_code != Some(true),
        ),
        (
            "no unused labels",
            options.allow_unused_labels != Some(true),
        ),
        ("no UMD global access", !options.allow_umd_global_access),
        (
            "no TypeScript extensions in imports",
            !options.allow_importing_ts_extensions,
        ),
    ]
}

fn program_with_every_check() -> Options {
    Options {
        strict_null_checks: true,
        no_implicit_any: true,
        specifies_no_implicit_any: true,
        no_implicit_this: true,
        strict_function_types: true,
        strict_bind_call_apply: true,
        strict_builtin_iterator_return: true,
        strict_property_initialization: true,
        use_unknown_in_catch_variables: true,
        exact_optional_property_types: true,
        no_unchecked_indexed_access: true,
        no_property_access_from_index_signature: true,
        no_implicit_returns: true,
        no_implicit_override: true,
        no_fallthrough_cases_in_switch: true,
        no_unused_locals: true,
        no_unused_parameters: true,
        no_unchecked_side_effect_imports: true,
        isolated_modules: true,
        isolated_modules_reported: true,
        verbatim_module_syntax: true,
        erasable_syntax_only: true,
        isolated_declarations: true,
        rewrite_relative_import_extensions: true,
        forbids_synthetic_default_imports: true,
        allow_unreachable_code: Some(false),
        allow_unused_labels: None,
        allow_umd_global_access: false,
        allow_importing_ts_extensions: false,
        ..Options::default()
    }
}

fn program_with_configuration_file() -> Options {
    let path = |text: &str| text.as_bytes().to_vec();
    Options {
        base_dir: path("/app"),
        paths_base_dir: path("/app"),
        paths: Arc::new(vec![(path("@/*"), vec![path("./src/*")])]),
        base_url: path("/app/src"),
        root_dirs: vec![path("/app/src")],
        out_dir: path("/app/out"),
        root_dir: path("/app/src"),
        declaration_dir: path("/app/types"),
        config_path: path("/app/tsconfig.json"),
        has_config_file: true,
        files: vec![path("/app/main.ts")],
        file_specs: vec![(path("main.ts"), path("/app/main.ts"))],
        include_specs: vec![(path("src"), path("/app/src"))],
        errors: vec![5102],
        problems: vec![Problem::default()],
        referenced_outputs: vec![(path("/lib/a.d.ts"), path("/lib/a.ts"))],
        referenced_projects: [(0, 0)].into_iter().collect(),
        referenced_options: vec![Options::default()],
        project_files: Some(Arc::default()),
        own_roots: Some(1),
        libs: vec![path("es2022")],
        custom_conditions: vec![path("worker")],
        allow_js: true,
        ..Options::default()
    }
}

#[test]
fn program_configuration_is_not_read() {
    assert_eq!(count_configuration_reads("/p/tsconfig.json", true), 0);
    assert_ne!(count_configuration_reads("/P/tsconfig.json", true), 0);
    assert_eq!(count_configuration_reads("/P/tsconfig.json", false), 0);
}

#[test]
fn directory_is_searched_once() {
    let host = UnreadableConfigs::new(&["/p/lib/tsconfig.json"]);
    with_context(&host, PROGRAM, |context| {
        assert_program_governs(context, b"/p/lib/a.ts");
        let first = host.calls();
        assert!(first.lookups > 0 && first.reads > 0);
        assert_program_governs(context, b"/p/lib/b.ts");
        assert_eq!(host.calls(), first);
    });
}

#[test]
fn configuration_file_is_read_once() {
    let host = UnreadableConfigs::new(&["/p/lib/tsconfig.json"]);
    with_context(&host, PROGRAM, |context| {
        assert_program_governs(context, b"/p/lib/a.ts");
        let first = host.calls();
        assert_program_governs(context, b"/p/lib/deep/b.ts");
        assert!(host.calls().lookups > first.lookups);
        assert_eq!(host.calls().reads, first.reads);
    });
}

#[test]
fn tsconfig_override_skips_search_for_configuration_files() {
    let host = UnreadableConfigs::new(&["/p/lib/tsconfig.json"]);
    let build = Build {
        config_path: "/p/other.json",
        tsconfig_override: Some("/p/other.json"),
    };
    with_context(&host, build, |context| {
        assert_program_governs(context, b"/p/lib/a.ts");
        assert_program_governs(context, b"/p/node_modules/dep/index.ts");
    });
    let none = HostCalls {
        lookups: 0,
        reads: 0,
    };
    assert_eq!(host.calls(), none);
}

#[test]
fn only_readable_configuration_file_of_other_project_has_options() {
    let host = host_of(&[
        ("/p/tsconfig.json", ES2015_CONFIG),
        ("/p/lib/tsconfig.json", ES2015_CONFIG),
        ("/p/bad/tsconfig.json", UNREADABLE_CONFIG),
    ]);
    with_context(&host, PROGRAM, |context| {
        let load = |config_path: &[u8]| context.projects.load(context, config_path);
        assert!(matches!(load(b"/p/tsconfig.json"), ConfigAnswer::Program));
        assert!(matches!(
            load(b"/p/bad/tsconfig.json"),
            ConfigAnswer::Unreadable
        ));
        assert!(matches!(
            load(b"/p/missing/tsconfig.json"),
            ConfigAnswer::Unreadable
        ));
        let ConfigAnswer::Project(project) = load(b"/p/lib/tsconfig.json") else {
            panic!("the configuration file is readable");
        };
        assert_eq!(project.target, ScriptTarget::ES2015);
    });
}

#[test]
fn options_of_configuration_file_are_stored() {
    let host = host_of(&[("/p/lib/tsconfig.json", ES2015_CONFIG)]);
    with_context(&host, PROGRAM, |context| {
        let load = || match context.projects.load(context, b"/p/lib/tsconfig.json") {
            ConfigAnswer::Project(project) => project,
            ConfigAnswer::Program | ConfigAnswer::Solution(_) | ConfigAnswer::Unreadable => {
                panic!("the configuration file is readable")
            }
        };
        assert!(std::ptr::eq(load(), load()));
    });
}

#[test]
fn project_has_directories_of_program() {
    let host = host_of(&[("/p/lib/tsconfig.json", ES2015_CONFIG)]);
    with_context(&host, PROGRAM, |context| {
        let project = context.projects.governing(context, b"/p/lib/a.ts");
        let project = project.expect("the directory has a configuration file");
        assert_eq!(project.current_directory, b"/cwd");
        assert_eq!(project.lib_dir, b"/lib");
        assert_eq!(project.base_dir, b"/p/lib");
    });
}

#[test]
fn directories_below_configuration_file_share_options() {
    let host = host_of(&[("/p/lib/tsconfig.json", ES2015_CONFIG)]);
    with_context(&host, PROGRAM, |context| {
        let governing = |path: &[u8]| {
            let project = context.projects.governing(context, path);
            project.expect("a directory above has a configuration file")
        };
        let project = governing(b"/p/lib/a.ts");
        assert!(std::ptr::eq(governing(b"/p/lib/b.ts"), project));
        assert!(std::ptr::eq(governing(b"/p/lib/deep/c.ts"), project));
        assert_program_governs(context, b"/p/other/d.ts");
    });
}

#[test]
fn only_projects_with_configuration_file_name_types() {
    let host = host_of(&[]);
    let types = Some(vec![b"listed".to_vec()]);
    let build = TestBuild {
        options: Options {
            config_path: b"/p/tsconfig.json".to_vec(),
            types: types.clone(),
            ..Options::default()
        },
        ..TestBuild::new(&host, &[])
    };
    let orders: [[&[u8]; 3]; 2] = [
        [
            b"/p/b/tsconfig.json",
            b"/p/a/tsconfig.json",
            b"/p/b/tsconfig.json",
        ],
        [
            b"/p/a/tsconfig.json",
            b"/p/b/tsconfig.json",
            b"/p/a/tsconfig.json",
        ],
    ];
    for order in orders {
        with_compile_context(&build, |context| {
            for config_path in order {
                let package = [&b"/p/node_modules"[..], &config_path[2..4], b"/index.js"].concat();
                let lenient = context.projects.governing_code(context, &package);
                assert_eq!(lenient.map(|it| &it.types), Some(&types));
                context.projects.note_types(context.session.keep(Options {
                    config_path: config_path.to_vec(),
                    types: types.clone(),
                    ..Options::default()
                }));
            }
            let naming_types = context.projects.naming_types();
            let config_paths: Vec<&[u8]> =
                naming_types.iter().map(|it| &it.config_path[..]).collect();
            assert_eq!(
                config_paths,
                [&b"/p/a/tsconfig.json"[..], b"/p/b/tsconfig.json"]
            );
        });
    }
}

#[test]
fn installed_package_directory_is_of_innermost_package() {
    let cases: [(&[u8], &[u8]); 5] = [
        (b"/p/node_modules/dep", b"/p/node_modules/dep"),
        (b"/p/node_modules/dep/lib/deep", b"/p/node_modules/dep"),
        (
            b"/p/node_modules/@scope/dep/lib",
            b"/p/node_modules/@scope/dep",
        ),
        (
            b"/p/node_modules/a/node_modules/b/lib",
            b"/p/node_modules/a/node_modules/b",
        ),
        (b"/p/node_modules", b"/p/node_modules"),
    ];
    for (directory, package_directory) in cases {
        assert_eq!(
            installed_package_directory(directory),
            Some(package_directory)
        );
    }
}

#[test]
fn directory_outside_node_modules_is_in_no_installed_package() {
    let directories: [&[u8]; 4] = [b"/", b"/p", b"/p/src", b"/p/node_modules_backup/dep"];
    for directory in directories {
        assert_eq!(installed_package_directory(directory), None);
    }
}

#[test]
fn lenient_options_turn_off_every_check() {
    let program = program_with_every_check();
    for (name, is_on) in checks_of(&program) {
        assert!(is_on, "{name}");
    }
    let lenient = lenient_options(&program, b"/app/node_modules/dep");
    for (name, is_on) in checks_of(&lenient) {
        assert!(!is_on, "{name}");
    }
}

#[test]
fn lenient_options_have_nothing_of_configuration_file() {
    let program = program_with_configuration_file();
    let lenient = lenient_options(&program, b"/app/node_modules/dep");
    assert_eq!(lenient.base_dir, b"/app/node_modules/dep");
    assert_eq!(lenient.paths_base_dir, b"/app/node_modules/dep");
    assert!(lenient.paths.is_empty());
    let paths = [
        &lenient.base_url,
        &lenient.out_dir,
        &lenient.root_dir,
        &lenient.declaration_dir,
        &lenient.config_path,
    ];
    assert!(paths.iter().all(|path| path.is_empty()));
    assert!(!lenient.has_config_file);
    assert!(lenient.root_dirs.is_empty());
    assert!(lenient.files.is_empty());
    assert!(lenient.file_specs.is_empty());
    assert!(lenient.include_specs.is_empty());
    assert!(lenient.errors.is_empty());
    assert!(lenient.problems.is_empty());
    assert!(lenient.referenced_outputs.is_empty());
    assert!(lenient.referenced_projects.is_empty());
    assert!(lenient.referenced_options.is_empty());
    assert!(lenient.project_files.is_none());
    assert!(lenient.own_roots.is_none());

    assert_eq!(lenient.libs, program.libs);
    assert_eq!(lenient.custom_conditions, program.custom_conditions);
    assert!(lenient.allow_js);
}

#[test]
fn usage_has_options_of_importer() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\""),
        ("/node_modules/dep/index.ts", ""),
    ]);
    let session = Session::new();
    let files = load_files(&session, &TestBuild::new(&host, &["/main.ts"]));
    let dep = files.by_path.get(b"/node_modules/dep/index.ts");
    let dep = dep.expect("the dependency is loaded");
    let of_dep = files.module_options(dep);
    assert!(!std::ptr::eq(of_dep, files.options));
    assert!(std::ptr::eq(files.usage_options(dep), of_dep));
    assert!(std::ptr::eq(
        files.usage_options((dep, ResolutionMode::Require)),
        of_dep
    ));
    assert!(std::ptr::eq(
        files.usage_options(ResolutionMode::Require),
        files.options
    ));
}
