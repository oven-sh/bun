use super::*;
use crate::program::code_test_host::{ParsePayload, TEXT_LOADER};

const MIXED_PROGRAM: &[(&str, &str)] = &[
    (
        "/main.ts",
        "import \"./a\"\n\
         import \"./dep.js\"\n\
         import \"./types.d.ts\"\n\
         import \"./x/one\"\n\
         import \"./y/two\"",
    ),
    ("/a.ts", "import \"./b\""),
    (
        "/b.ts",
        "import \"./a\"\nimport type t from \"./only-types\"",
    ),
    ("/only-types.ts", ""),
    ("/dep.js", "import \"./deeper.js\""),
    ("/deeper.js", ""),
    ("/types.d.ts", ""),
    ("/x/one.ts", "import \"pkg\""),
    ("/x/node_modules/pkg/package.json", "pkg@1.0.0"),
    ("/x/node_modules/pkg/index.js", ""),
    ("/x/node_modules/pkg/index.d.ts", ""),
    ("/y/two.ts", "import \"pkg\""),
    ("/y/node_modules/pkg/package.json", "pkg@1.0.0"),
    ("/y/node_modules/pkg/index.js", ""),
    ("/y/node_modules/pkg/index.d.ts", ""),
];

#[derive(PartialEq, Eq, Debug)]
struct FileSummary {
    name: String,
    role: FileRole,
    is_compiled: bool,
    is_in_types_program: bool,
    is_from_external_library: bool,
    edges: Vec<FileId>,
    code_edges: Vec<FileId>,
}

#[derive(PartialEq, Eq, Debug)]
struct ProgramSummary {
    files: Vec<FileSummary>,
    entry_points: Vec<FileId>,
    compiled_files: Vec<FileId>,
    order: Vec<FileId>,
}

fn summarize(files: &Files<'_>) -> ProgramSummary {
    let summarize_file = |file: FileId| {
        let module = files.module(file);
        FileSummary {
            name: name_of(files, file),
            role: module.role,
            is_compiled: files.is_compiled(file),
            is_in_types_program: module.is_in_types_program,
            is_from_external_library: module.is_from_external_library,
            edges: module.edges.to_vec(),
            code_edges: module.code_edges.to_vec(),
        }
    };
    ProgramSummary {
        files: all_files(files).into_iter().map(summarize_file).collect(),
        entry_points: files.entry_points().to_vec(),
        compiled_files: files.compiled_files().to_vec(),
        order: files.order.to_vec(),
    }
}

fn payload_path(files: &Files<'_>, file: FileId) -> Option<String> {
    let payload = files.host_payload(file)?;
    let payload: &ParsePayload = payload.downcast_ref().expect("a payload of the test host");
    Some(payload.path.as_bstr().to_string())
}

fn rank_of(files: &Files<'_>, path: &str) -> usize {
    let file = file_at(files, path);
    let rank = files.order.iter().position(|&ordered| ordered == file);
    rank.unwrap_or_else(|| panic!("{path} is not ordered"))
}

#[test]
fn ids_follow_walk_order() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\""),
        ("/a.ts", "import \"./b\""),
        ("/b.ts", ""),
    ]);
    with_program(&host, &["/main.ts"], |files| {
        assert!(files.is_compile_build());
        let all = all_files(files);
        assert_eq!(names_of(files, &all), ["/b.ts", "/a.ts", "/main.ts"]);
        assert_eq!(files.compiled_files(), all);
        assert_eq!(files.entry_points(), [FileId(2)]);
        assert_eq!(files.order, all);
        for &file in &all {
            assert_eq!(files.role(file), FileRole::Checked);
            assert!(files.is_compiled(file));
        }
    });
}

#[test]
fn entry_points_stay_in_build_order() {
    let host = host_of(&[("/first.ts", "import \"./second\""), ("/second.ts", "")]);
    with_program(&host, &["/first.ts", "/second.ts"], |files| {
        let entry_points = names_of(files, files.entry_points());
        assert_eq!(entry_points, ["/first.ts", "/second.ts"]);
        assert_eq!(
            names_of(files, files.compiled_files()),
            ["/second.ts", "/first.ts"]
        );
    });
}

#[test]
fn every_file_is_ordered_once_after_loaded_files() {
    with_program(&host_of(MIXED_PROGRAM), &["/main.ts"], |files| {
        let mut ordered = files.order.to_vec();
        ordered.sort_unstable();
        assert_eq!(ordered, all_files(files));
        let loads = [
            ("/main.ts", "/a.ts"),
            ("/main.ts", "/dep.js"),
            ("/main.ts", "/types.d.ts"),
            ("/dep.js", "/deeper.js"),
            ("/b.ts", "/only-types.ts"),
            ("/x/one.ts", "/x/node_modules/pkg/index.js"),
            ("/x/one.ts", "/x/node_modules/pkg/index.d.ts"),
            ("/y/two.ts", "/y/node_modules/pkg/index.js"),
        ];
        for (importer, loaded) in loads {
            assert!(
                rank_of(files, loaded) < rank_of(files, importer),
                "{importer}: {loaded}"
            );
        }
    });
}

#[test]
fn program_does_not_depend_on_threads() {
    let expected = with_program(&host_of(MIXED_PROGRAM), &["/main.ts"], summarize);
    let with_threads = StatementsHost {
        threads: 8,
        ..host_of(MIXED_PROGRAM)
    };
    let hosts = [with_threads, host_of(MIXED_PROGRAM).with_process_io_pool(4)];
    for host in &hosts {
        assert_eq!(with_program(host, &["/main.ts"], summarize), expected);
    }
}

#[test]
fn loader_is_part_of_file_identity() {
    let host = StatementsHost {
        loaders: &[("/data.ts", Some("text"), TEXT_LOADER)],
        ..host_of(&[
            (
                "/main.ts",
                "import \"./data.ts\"\nimport \"./data.ts\" with { type: \"text\" }",
            ),
            ("/data.ts", ""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let (as_code, as_text, main) = (FileId(0), FileId(1), FileId(2));
        let names = names_of(files, &all_files(files));
        assert_eq!(names, ["/data.ts", "/data.ts", "/main.ts"]);
        assert_eq!(files.by_path.get(b"/data.ts"), Some(as_code));
        let loader_of = |file| files.compiled(file).map(|compiled| compiled.loader);
        assert_eq!(loader_of(as_code), Some(HostLoader::default()));
        assert_eq!(loader_of(as_text), Some(TEXT_LOADER));
        assert_eq!(files.role(as_code), FileRole::Checked);
        assert_eq!(files.role(as_text), FileRole::Inferred);
        assert!(files.module(as_code).is_in_types_program);
        assert!(!files.module(as_text).is_in_types_program);
        let answers = [CodeAnswer::File(as_code), CodeAnswer::File(as_text)];
        assert_eq!(files.code_answers(main), answers);
        assert_eq!(imported_files(files, main), [as_code]);
    });
}

#[test]
fn root_file_with_code_is_one_file() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\""),
        ("/a.ts", ""),
        ("/only-root.ts", ""),
    ]);
    let build = TestBuild {
        roots: &["/only-root.ts", "/main.ts"],
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let names = names_of(files, &all_files(files));
        assert_eq!(names, ["/only-root.ts", "/main.ts", "/a.ts"]);
        assert_eq!(
            names_of(files, files.compiled_files()),
            ["/a.ts", "/main.ts"]
        );
        assert_eq!(names_of(files, files.entry_points()), ["/main.ts"]);

        let only_root = file_at(files, "/only-root.ts");
        assert_eq!(files.role(only_root), FileRole::Checked);
        assert!(files.compiled(only_root).is_none());
        assert!(!files.is_compiled(only_root));
        assert!(files.module(only_root).is_in_types_program);
        assert_eq!(payload_path(files, only_root), None);
    });
}

#[test]
fn libraries_load_without_root_files() {
    let host = host_of(&[("/main.ts", ""), ("/lib/lib.es5.d.ts", "")]);
    let build = TestBuild {
        options: Options {
            libs: vec![b"es5".to_vec()],
            lib_dir: b"/lib".to_vec(),
            ..Options::default()
        },
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let library = file_at(files, "/lib/lib.es5.d.ts");
        assert!(files.module(library).is_lib);
        assert_eq!(files.role(library), FileRole::TypesOnly);
        assert!(files.compiled(library).is_none());
        assert_eq!(files.order, [library, file_at(files, "/main.ts")]);
        assert_eq!(names_of(files, files.compiled_files()), ["/main.ts"]);
    });
}

#[test]
fn payload_is_found_by_file() {
    with_program(&host_of(MIXED_PROGRAM), &["/main.ts"], |files| {
        for file in all_files(files) {
            let expected = files.is_compiled(file).then(|| name_of(files, file));
            assert_eq!(payload_path(files, file), expected);
        }
        assert_eq!(
            files
                .host_payload(FileId(files.modules.len() as u32))
                .map(|_| ()),
            None
        );
    });
}

#[test]
fn code_file_keeps_analysis_and_payload_when_ids_shift() {
    let host = StatementsHost {
        is_case_sensitive: false,
        ..host_of(&[
            ("/lib.ts", ""),
            ("/main.ts", "import \"./a\""),
            ("/a.ts", ""),
        ])
    };
    let build = TestBuild {
        roots: &["/lib.ts", "/LIB.ts"],
        ..TestBuild::new(&host, &["/main.ts"])
    };
    with_build(&build, |files| {
        let names = names_of(files, &all_files(files));
        assert_eq!(names, ["/lib.ts", "/a.ts", "/main.ts"]);
        let (a, main) = (FileId(1), FileId(2));
        assert_eq!(files.entry_points(), [main]);
        assert_eq!(files.compiled_files(), [a, main]);
        assert_eq!(files.code_answers(main), [CodeAnswer::File(a)]);
        assert_eq!(files.module(main).code_edges, [a]);
        assert_eq!(payload_path(files, a).as_deref(), Some("/a.ts"));
        assert_eq!(payload_path(files, main).as_deref(), Some("/main.ts"));
        assert_eq!(payload_path(files, FileId(0)), None);
        assert!(!files.is_compiled(FileId(0)));
    });
}

#[test]
fn spellings_of_one_file_are_one_module() {
    let host = StatementsHost {
        is_case_sensitive: false,
        ..host_of(&[
            ("/main.ts", "import \"./a\"\nimport \"./b\""),
            ("/a.ts", ""),
            ("/b.ts", "import \"./A\""),
        ])
    };
    with_program(&host, &["/main.ts"], |files| {
        let names = names_of(files, &all_files(files));
        assert_eq!(names, ["/a.ts", "/b.ts", "/main.ts"]);
        let a = file_at(files, "/a.ts");
        assert_eq!(files.by_path.get(b"/A.ts"), Some(a));
        assert!(files.compiled(a).is_some());
        let b = file_at(files, "/b.ts");
        assert_eq!(files.code_answers(b), [CodeAnswer::File(a)]);
        assert_eq!(imported_files(files, b), [a]);
    });
}

fn entry_of_file<'s, 'r>(file: Option<u32>) -> CodeEntry<'s, 'r> {
    CodeEntry {
        key: LoadKey {
            path: b"",
            loader: HostLoader::default(),
        },
        host_module: None,
        role: FileRole::Inferred,
        package_depth: 0,
        targets: Vec::new(),
        predicted_type_files: Vec::new(),
        jsdoc_imports: Vec::new(),
        loaded: Guarded::new(None),
        code: Guarded::new(None),
        payload: None,
        settings: None,
        package: None,
        side_effects: crate::resolve::DeclaredSideEffects::Unspecified,
        file: file.map(FileId),
    }
}

fn with_code_files(
    files_of_entries: &[Option<u32>],
    is_in_types_program: &[bool],
    test: impl FnOnce(CodeFiles<'_, '_>),
) {
    let session = Session::new();
    let mut code_files = CodeFiles {
        session: &session,
        atoms: Interner::new_in(&session),
        is_case_sensitive: true,
        entries: files_of_entries
            .iter()
            .copied()
            .map(entry_of_file)
            .collect(),
        entry_points: Vec::new(),
        entry_of_file: Vec::new(),
        is_in_types_program: is_in_types_program.to_vec(),
        typed_files_with_other_code: FxHashSet::default(),
    };
    code_files.index_entries(is_in_types_program.len());
    test(code_files);
}

#[test]
fn renumbering_moves_entries_to_remaining_files() {
    let is_in_types_program = [true, false, false, true];
    with_code_files(
        &[Some(0), Some(1), Some(3)],
        &is_in_types_program,
        |mut code_files| {
            assert_eq!(code_files.entry_of(FileId(3)), Some(2));
            assert_eq!(code_files.entry_of(FileId(2)), None);

            code_files.renumber(&[Some(FileId(0)), None, Some(FileId(1)), Some(FileId(1))]);
            let files: Vec<Option<FileId>> = code_files.entries.iter().map(|it| it.file).collect();
            assert_eq!(files, [Some(FileId(0)), None, Some(FileId(1))]);
            assert_eq!(code_files.entry_of(FileId(0)), Some(0));
            assert_eq!(code_files.entry_of(FileId(1)), Some(2));
            assert_eq!(code_files.entry_of(FileId(2)), None);
            assert_eq!(code_files.is_in_types_program, [true, true]);
        },
    );
}

#[test]
fn first_entry_of_file_is_found() {
    with_code_files(
        &[Some(1), Some(1), None],
        &[false, false],
        |mut code_files| {
            assert_eq!(code_files.entry_of(FileId(1)), Some(0));
            assert_eq!(code_files.entry_of(FileId(0)), None);
            assert!(code_files.take_loaded(FileId(1)).is_none());
            assert!(!CodeFiles::has_loaded(&Some(code_files), FileId(1)));
            assert!(!CodeFiles::has_loaded(&None, FileId(1)));
        },
    );
}
