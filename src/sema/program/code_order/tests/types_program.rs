use super::*;
use crate::program::code_test_host::to_paths;

const TYPESCRIPT_IMPORTS_JAVASCRIPT: &[(&str, &str)] =
    &[("/main.ts", "import \"./dep.js\""), ("/dep.js", "")];

const PACKAGE_WITH_DECLARATIONS: &[(&str, &str)] = &[
    ("/main.ts", "import \"pkg\""),
    ("/main.js", "import \"pkg\""),
    ("/node_modules/pkg/package.json", "pkg@1.0.0"),
    ("/node_modules/pkg/index.js", ""),
    ("/node_modules/pkg/index.d.ts", ""),
];

#[test]
fn javascript_runs_outside_types_program_without_allow_js() {
    with_program(
        &host_of(TYPESCRIPT_IMPORTS_JAVASCRIPT),
        &["/main.ts"],
        |files| {
            let (dep, main) = (file_at(files, "/dep.js"), file_at(files, "/main.ts"));
            assert_eq!(files.modules.len(), 2);
            assert_eq!(files.role(dep), FileRole::Inferred);
            assert!(files.compiled(dep).is_some());
            assert!(!files.module(dep).is_in_types_program);
            assert!(files.module(main).is_in_types_program);
            assert!(files.module(main).imports.is_empty());
            assert!(files.module(main).edges.is_empty());
            assert_eq!(files.module(main).code_edges, [dep]);
            assert_eq!(files.code_answers(main), [CodeAnswer::File(dep)]);
        },
    );
}

#[test]
fn javascript_is_in_types_program_with_allow_js() {
    let host = host_of(TYPESCRIPT_IMPORTS_JAVASCRIPT);
    let build = TestBuild {
        options: Options {
            allow_js: true,
            ..Options::default()
        },
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let (dep, main) = (file_at(files, "/dep.js"), file_at(files, "/main.ts"));
        assert_eq!(files.modules.len(), 2);
        assert_eq!(files.role(dep), FileRole::Inferred);
        assert!(files.compiled(dep).is_some());
        assert!(files.module(dep).is_in_types_program);
        assert_eq!(imported_files(files, main), [dep]);
        assert_eq!(files.module(main).edges, [dep]);
        assert_eq!(files.module(main).code_edges, [dep]);
    });
}

#[test]
fn checked_file_sees_declarations_and_runs_javascript() {
    with_program(
        &host_of(PACKAGE_WITH_DECLARATIONS),
        &["/main.ts"],
        |files| {
            let main = file_at(files, "/main.ts");
            let code = file_at(files, "/node_modules/pkg/index.js");
            let declarations = file_at(files, "/node_modules/pkg/index.d.ts");
            assert_eq!(files.code_answers(main), [CodeAnswer::File(code)]);
            assert_eq!(imported_files(files, main), [declarations]);

            assert_eq!(files.role(code), FileRole::Inferred);
            assert!(files.is_compiled(code));
            assert!(!files.module(code).is_in_types_program);

            assert_eq!(files.role(declarations), FileRole::TypesOnly);
            assert!(!files.is_compiled(declarations));
            assert!(files.compiled(declarations).is_none());
            assert!(files.code_answers(declarations).is_empty());
            assert!(files.module(declarations).is_in_types_program);
        },
    );
}

#[test]
fn inferred_file_imports_code_targets() {
    with_program(
        &host_of(PACKAGE_WITH_DECLARATIONS),
        &["/main.js"],
        |files| {
            let main = file_at(files, "/main.js");
            let code = file_at(files, "/node_modules/pkg/index.js");
            assert_eq!(files.role(main), FileRole::Inferred);
            assert_eq!(files.code_answers(main), [CodeAnswer::File(code)]);
            assert_eq!(imported_files(files, main), [code]);
            let declarations = file_at(files, "/node_modules/pkg/index.d.ts");
            assert_eq!(imported_files(files, code), [declarations]);
            assert_eq!(files.role(declarations), FileRole::TypesOnly);
            assert_eq!(files.modules.len(), 3);
            for file in [main, code] {
                assert!(!files.module(file).is_in_types_program);
            }
        },
    );
}

#[test]
fn required_file_is_import_of_inferred_file() {
    let host = host_of(&[
        ("/main.js", "require(\"./a.js\")\nrequire(\"./missing.js\")"),
        ("/a.js", ""),
    ]);
    with_program(&host, &["/main.js"], |files| {
        let (a, main) = (file_at(files, "/a.js"), file_at(files, "/main.js"));
        assert_eq!(imported_files(files, main), [a]);
    });
}

#[test]
fn copies_of_package_run_separately_and_share_declarations() {
    let host = host_of(&[
        ("/main.ts", "import \"./x/one\"\nimport \"./y/two\""),
        ("/x/one.ts", "import \"pkg\""),
        ("/x/node_modules/pkg/package.json", "pkg@1.0.0"),
        ("/x/node_modules/pkg/index.js", ""),
        ("/x/node_modules/pkg/index.d.ts", ""),
        ("/y/two.ts", "import \"pkg\""),
        ("/y/node_modules/pkg/package.json", "pkg@1.0.0"),
        ("/y/node_modules/pkg/index.js", ""),
        ("/y/node_modules/pkg/index.d.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let code_of_one = file_at(files, "/x/node_modules/pkg/index.js");
        let code_of_two = file_at(files, "/y/node_modules/pkg/index.js");
        assert_ne!(code_of_one, code_of_two);
        assert!(files.is_compiled(code_of_one) && files.is_compiled(code_of_two));

        let declarations = file_at(files, "/x/node_modules/pkg/index.d.ts");
        assert_eq!(
            file_at(files, "/y/node_modules/pkg/index.d.ts"),
            declarations
        );
        assert_eq!(
            name_of(files, declarations),
            "/x/node_modules/pkg/index.d.ts"
        );
        assert_eq!(files.modules.len(), 6);

        let (one, two) = (file_at(files, "/x/one.ts"), file_at(files, "/y/two.ts"));
        assert_eq!(files.code_answers(one), [CodeAnswer::File(code_of_one)]);
        assert_eq!(files.code_answers(two), [CodeAnswer::File(code_of_two)]);
        assert_eq!(imported_files(files, one), [declarations]);
        assert_eq!(imported_files(files, two), [declarations]);
    });
}

#[test]
fn copies_of_other_versions_keep_own_declarations() {
    let host = host_of(&[
        ("/main.ts", "import \"./x/one\"\nimport \"./y/two\""),
        ("/x/one.ts", "import \"pkg\""),
        ("/x/node_modules/pkg/package.json", "pkg@1.0.0"),
        ("/x/node_modules/pkg/index.d.ts", ""),
        ("/x/node_modules/pkg/index.js", ""),
        ("/y/two.ts", "import \"pkg\""),
        ("/y/node_modules/pkg/package.json", "pkg@2.0.0"),
        ("/y/node_modules/pkg/index.d.ts", ""),
        ("/y/node_modules/pkg/index.js", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let of_one = file_at(files, "/x/node_modules/pkg/index.d.ts");
        let of_two = file_at(files, "/y/node_modules/pkg/index.d.ts");
        assert_ne!(of_one, of_two);
        assert_eq!(files.modules.len(), 7);
    });
}

#[test]
fn typescript_of_dependency_is_from_external_library() {
    let host = host_of(&[
        ("/main.ts", "import \"dep\"\nimport \"./local\""),
        ("/local.ts", ""),
        (
            "/node_modules/dep/index.ts",
            "import type t from \"./types\"\nimport \"./util\"",
        ),
        ("/node_modules/dep/types.ts", ""),
        ("/node_modules/dep/util.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let is_external = |path| files.module(file_at(files, path)).is_from_external_library;
        assert!(!is_external("/main.ts"));
        assert!(!is_external("/local.ts"));
        assert!(is_external("/node_modules/dep/index.ts"));
        assert!(is_external("/node_modules/dep/util.ts"));
        assert!(is_external("/node_modules/dep/types.ts"));

        let index = file_at(files, "/node_modules/dep/index.ts");
        assert_eq!(files.role(index), FileRole::Checked);
        assert!(files.is_compiled(index));
        let types = file_at(files, "/node_modules/dep/types.ts");
        assert_eq!(files.role(types), FileRole::Checked);
        assert!(!files.is_compiled(types));
        assert!(files.module(types).is_in_types_program);
    });
}

#[test]
fn file_of_package_reached_by_relative_path_is_not_external() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"dep\"\nimport \"./node_modules/dep/util\"",
        ),
        ("/node_modules/dep/index.ts", "import \"./util\""),
        ("/node_modules/dep/util.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let is_external = |path| files.module(file_at(files, path)).is_from_external_library;
        assert!(is_external("/node_modules/dep/index.ts"));
        assert!(!is_external("/node_modules/dep/util.ts"));
    });
}

#[test]
fn declaration_file_imported_by_code_is_types_only() {
    let host = host_of(&[
        ("/main.ts", "import \"./types.d.ts\""),
        ("/types.d.ts", "import \"./more\""),
        ("/more.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        let (main, types) = (file_at(files, "/main.ts"), file_at(files, "/types.d.ts"));
        assert_eq!(files.role(types), FileRole::TypesOnly);
        assert!(files.compiled(types).is_none());
        assert_eq!(files.code_answers(main), [CodeAnswer::File(types)]);
        assert_eq!(names_of(files, files.compiled_files()), ["/main.ts"]);

        let more = file_at(files, "/more.ts");
        assert!(files.compiled(more).is_none());
        assert_eq!(imported_files(files, types), [more]);
    });
}

#[test]
fn load_for_check_has_no_code_graph() {
    let host = host_of(TYPESCRIPT_IMPORTS_JAVASCRIPT);
    let session = Session::new();
    let roots = to_paths(&["/main.ts"]);
    let files = Files::load(&session, None, &host, Options::default(), &roots, &|_| {});
    assert!(!files.is_compile_build());
    assert_eq!(names_of(&files, &all_files(&files)), ["/main.ts"]);
    assert!(files.entry_points().is_empty());
    assert!(files.compiled_files().is_empty());
    assert!(files.host_modules().is_empty());
    for file in all_files(&files) {
        assert!(files.compiled(file).is_none());
        assert!(!files.is_compiled(file));
        assert!(files.code_answers(file).is_empty());
        assert!(files.host_payload(file).is_none());
        assert!(files.module(file).code_edges.is_empty());
        assert!(files.module(file).is_in_types_program);
        assert_eq!(files.role(file), FileRole::Checked);
    }
    assert!(host.events().is_empty());
}
