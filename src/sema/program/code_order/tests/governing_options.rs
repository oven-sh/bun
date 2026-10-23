use super::*;
use crate::program::code_test_host::to_paths;
use crate::program::projects::lenient_options;
use crate::resolve::CodeOptions;

const ES2020_CONFIG: &str = "{ compilerOptions: { target: \"es2020\" } }";
const UNREADABLE_CONFIG: &str = "unreadable";

fn strict_options() -> Options {
    Options {
        strict_null_checks: true,
        no_implicit_any: true,
        ..Options::default()
    }
}

fn options_at<'s>(files: &Files<'s>, path: &str) -> &'s Options {
    files.module_options(file_at(files, path))
}

#[test]
fn nested_project_is_governed_by_own_configuration() {
    let host = host_of(&[
        ("/main.ts", "import \"./packages/lib/index\""),
        ("/packages/lib/tsconfig.json", ES2020_CONFIG),
        (
            "/packages/lib/index.ts",
            "import \"./util\"\nimport type t from \"./types\"",
        ),
        ("/packages/lib/util.ts", ""),
        ("/packages/lib/types.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        assert_eq!(files.options.target, ScriptTarget::None);
        assert!(std::ptr::eq(options_at(files, "/main.ts"), files.options));

        let project = options_at(files, "/packages/lib/index.ts");
        assert_eq!(project.target, ScriptTarget::ES2020);
        assert!(std::ptr::eq(
            options_at(files, "/packages/lib/util.ts"),
            project
        ));
        assert!(std::ptr::eq(
            options_at(files, "/packages/lib/types.ts"),
            project
        ));
    });
}

#[test]
fn configuration_of_program_governs_as_program() {
    let host = host_of(&[("/tsconfig.json", ES2020_CONFIG), ("/main.ts", "")]);
    let build = TestBuild {
        options: Options {
            config_path: b"/tsconfig.json".to_vec(),
            ..Options::default()
        },
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        assert!(std::ptr::eq(options_at(files, "/main.ts"), files.options));
        assert_eq!(files.options.target, ScriptTarget::None);
    });
}

#[test]
fn file_under_unreadable_configuration_has_options_of_program() {
    let host = host_of(&[
        ("/main.ts", "import \"./app/index\""),
        ("/app/tsconfig.json", UNREADABLE_CONFIG),
        ("/app/index.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        assert!(std::ptr::eq(
            options_at(files, "/app/index.ts"),
            files.options
        ));
    });
}

#[test]
fn dependency_without_configuration_is_checked_leniently() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\"\nimport \"other\""),
        ("/node_modules/dep/index.ts", "import \"./lib/util\""),
        ("/node_modules/dep/lib/util.ts", ""),
        ("/node_modules/other/index.ts", ""),
    ]);
    let build = TestBuild {
        options: strict_options(),
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let program = options_at(files, "/main.ts");
        assert!(std::ptr::eq(program, files.options));
        assert!(program.strict_null_checks && program.no_implicit_any);

        let dep = options_at(files, "/node_modules/dep/index.ts");
        assert!(!dep.strict_null_checks && !dep.no_implicit_any);
        assert_eq!(dep.base_dir, b"/node_modules/dep");
        assert!(std::ptr::eq(
            options_at(files, "/node_modules/dep/lib/util.ts"),
            dep
        ));

        let other = options_at(files, "/node_modules/other/index.ts");
        assert!(!std::ptr::eq(other, dep));
        assert!(!other.strict_null_checks);
        assert_eq!(other.base_dir, b"/node_modules/other");
    });
}

#[test]
fn dependency_configuration_governs_dependency() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\""),
        ("/node_modules/dep/tsconfig.json", ES2020_CONFIG),
        ("/node_modules/dep/index.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let dep = options_at(files, "/node_modules/dep/index.ts");
        assert_eq!(dep.target, ScriptTarget::ES2020);
    });
}

#[test]
fn dependency_with_unreadable_configuration_is_checked_leniently() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\""),
        ("/node_modules/dep/tsconfig.json", UNREADABLE_CONFIG),
        ("/node_modules/dep/index.ts", ""),
    ]);
    let build = TestBuild {
        options: strict_options(),
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let dep = options_at(files, "/node_modules/dep/index.ts");
        assert!(!std::ptr::eq(dep, files.options));
        assert!(!dep.strict_null_checks);
        assert_eq!(dep.target, ScriptTarget::None);
    });
}

#[test]
fn configuration_above_node_modules_does_not_govern_dependency() {
    let host = host_of(&[
        ("/main.ts", "import \"./app/index\""),
        ("/app/tsconfig.json", ES2020_CONFIG),
        ("/app/index.ts", "import \"dep\""),
        ("/app/node_modules/dep/index.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        assert_eq!(
            options_at(files, "/app/index.ts").target,
            ScriptTarget::ES2020
        );
        let dep = options_at(files, "/app/node_modules/dep/index.ts");
        assert_eq!(dep.target, ScriptTarget::None);
        assert_eq!(dep.base_dir, b"/app/node_modules/dep");
    });
}

#[test]
fn declaration_file_has_options_of_program() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\""),
        ("/node_modules/dep/index.js", ""),
        ("/node_modules/dep/index.d.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let declarations = options_at(files, "/node_modules/dep/index.d.ts");
        assert!(std::ptr::eq(declarations, files.options));
    });
}

#[test]
fn load_for_check_has_options_of_program_everywhere() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./packages/lib/index\"\nimport \"dep\"",
        ),
        ("/packages/lib/tsconfig.json", ES2020_CONFIG),
        ("/packages/lib/index.ts", ""),
        ("/node_modules/dep/index.ts", ""),
    ]);
    let session = Session::new();
    let roots = to_paths(&["/main.ts"]);
    let files = Files::load(&session, None, &host, strict_options(), &roots, &|_| {});
    assert_eq!(files.modules.len(), 3);
    for file in all_files(&files) {
        assert!(std::ptr::eq(files.module_options(file), files.options));
    }
}

#[test]
fn tsconfig_override_replaces_configuration_files() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./packages/lib/index\"\nimport \"dep\"",
        ),
        ("/tsconfig.build.json", ""),
        ("/packages/lib/tsconfig.json", ES2020_CONFIG),
        ("/packages/lib/index.ts", ""),
        ("/node_modules/dep/index.ts", ""),
    ]);
    let build = TestBuild {
        code: CodeOptions {
            tsconfig_override: Some(b"/tsconfig.build.json".to_vec()),
            ..CodeOptions::bun_run(b"/")
        },
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        for file in all_files(files) {
            assert!(std::ptr::eq(files.module_options(file), files.options));
        }
    });
}

#[test]
fn lenient_options_turn_checks_off_and_keep_emit_settings() {
    let program = Options {
        strict_null_checks: true,
        no_implicit_any: true,
        strict_function_types: true,
        no_unused_locals: true,
        isolated_modules: true,
        verbatim_module_syntax: true,
        allow_unreachable_code: Some(false),
        target: ScriptTarget::ES2020,
        module: ModuleKind::Node16,
        jsx: JsxEmit::ReactJsx,
        base_dir: b"/app".to_vec(),
        config_path: b"/app/tsconfig.json".to_vec(),
        ..Options::default()
    };
    let lenient = lenient_options(&program, b"/app/node_modules/dep");
    assert!(!lenient.strict_null_checks);
    assert!(!lenient.no_implicit_any);
    assert!(!lenient.strict_function_types);
    assert!(!lenient.no_unused_locals);
    assert!(!lenient.isolated_modules);
    assert!(!lenient.verbatim_module_syntax);
    assert_eq!(lenient.allow_unreachable_code, Some(true));
    assert_eq!(lenient.target, ScriptTarget::ES2020);
    assert_eq!(lenient.module, ModuleKind::Node16);
    assert_eq!(lenient.jsx, JsxEmit::ReactJsx);
    assert_eq!(lenient.base_dir, b"/app/node_modules/dep");
    assert!(lenient.config_path.is_empty());
}
