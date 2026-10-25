#![cfg(not(miri))]

use super::*;
use crate::program::code_file::load_code_file;
use crate::program::code_load::CodeTarget;
use crate::program::code_test_host::{
    StatementsHost, TestBuild, load_files, to_paths, with_compile_context,
};
use crate::resolve::{CodeFailure, CodeFile};

const FILE: CodeResolution<'static> = CodeResolution::File(CodeFile {
    path: b"/a.js",
    host_module: None,
});

const FILE_CANDIDATE: ComputedCandidate<'static> = ComputedCandidate::File(CodeFile {
    path: b"/a.js",
    host_module: None,
});

const fn host_module_candidate(id: u32) -> ComputedCandidate<'static> {
    ComputedCandidate::HostModule(HostModuleId(id))
}

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_context<R>(
    host: &StatementsHost,
    test: impl FnOnce(&CodeLoadContext<'_, '_, '_>) -> R,
) -> R {
    with_compile_context(&TestBuild::new(host, &[]), test)
}

fn with_build<R>(build: &TestBuild<'_>, test: impl FnOnce(&Files<'_>) -> R) -> R {
    let session = Session::new();
    test(&load_files(&session, build))
}

fn load_module<'s, 'r>(context: &CodeLoadContext<'_, 's, 'r>, path: &str) -> Box<Loaded<'s, 'r>> {
    let path = context.resolver.keep(path.as_bytes());
    let target = CodeTarget::of_path(path, HostLoader::default());
    let arena = context.session.arena();
    let text = context.host.read_source(path);
    let parsed = load_code_file(context, arena, target, text, false, &[]);
    context.answer_types_question(arena, target.key, parsed).0
}

fn code_files_without_entries<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    is_in_types_program: &[bool],
) -> CodeFiles<'s, 'r> {
    CodeFiles {
        session: context.session,
        atoms: context.atoms,
        is_case_sensitive: true,
        entries: Vec::new(),
        entry_points: Vec::new(),
        entry_of_file: Vec::new(),
        is_in_types_program: is_in_types_program.to_vec(),
        typed_files_with_other_code: FxHashSet::default(),
    }
}

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let file = files.by_path.get(path.as_bytes());
    file.unwrap_or_else(|| panic!("{path} is not in the program"))
}

fn names_of(files: &Files<'_>, ids: &[FileId]) -> Vec<String> {
    let names = ids.iter().map(|&file| files.module(file).file_name());
    names.map(|name| name.as_bstr().to_string()).collect()
}

struct Ordered {
    seen: Vec<bool>,
    libs: Vec<FileId>,
    others: Vec<FileId>,
}

fn order_unseen_files(files: &Files<'_>, seen: &[FileId]) -> Ordered {
    let mut ordered = Ordered {
        seen: vec![false; files.modules.len()],
        libs: Vec::new(),
        others: Vec::new(),
    };
    for file in seen {
        ordered.seen[file.idx()] = true;
    }
    files.order_code_files(&mut ordered.seen, &mut ordered.libs, &mut ordered.others);
    ordered
}

fn assert_has_no_files(graph: &CodeGraph<'_>) {
    let files = graph.viewed();
    assert!(files.entry_points.is_empty());
    assert!(files.compiled_files.is_empty());
    assert!(files.is_compiled.is_empty());
    assert!(files.host_modules.is_empty());
    assert!(graph.host_payloads.is_empty());
}

#[test]
fn only_file_resolutions_advance_targets() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let (written, chosen) = (atoms.intern(b"written"), atoms.intern(b"chosen"));
    let external = |kind: ExternalKind| CodeResolution::External {
        specifier: b"chosen",
        kind,
    };
    let resolutions = [
        FILE,
        CodeResolution::HostModule(HostModuleId(7)),
        external(ExternalKind::UncompiledCode),
        external(ExternalKind::HostValue),
        FILE,
        CodeResolution::Erased,
        CodeResolution::NotFound(CodeFailure::PackageNotFound),
    ];
    let target_files = [Some(FileId(3)), None, Some(FileId(9))];
    let mut targets = TargetFiles(target_files.iter());
    let answers: Vec<CodeAnswer<'_>> = (resolutions.iter())
        .map(|resolution| constant_answer(&atoms, Some(written), resolution, &mut targets))
        .collect();
    let external = |specifier: Atom, kind: ExternalKind| CodeAnswer::External { specifier, kind };
    let expected = [
        CodeAnswer::File(FileId(3)),
        CodeAnswer::HostModule(HostModuleId(7)),
        external(chosen, ExternalKind::UncompiledCode),
        external(chosen, ExternalKind::HostValue),
        external(written, ExternalKind::UncompiledCode),
        CodeAnswer::Erased,
        CodeAnswer::NotFound(CodeFailure::PackageNotFound),
    ];
    assert_eq!(answers, expected);
    assert_eq!(targets.0.as_slice(), [Some(FileId(9))]);
    assert!(!targets.is_exhausted());
    assert_eq!(targets.next_file(), Some(FileId(9)));
    assert!(targets.is_exhausted());
}

#[test]
fn implied_file_without_id_is_named_by_path() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let target_files = [None];
    let mut targets = TargetFiles(target_files.iter());
    let expected = CodeAnswer::External {
        specifier: atoms.intern(b"/a.js"),
        kind: ExternalKind::UncompiledCode,
    };
    assert_eq!(constant_answer(&atoms, None, &FILE, &mut targets), expected);
    assert!(targets.is_exhausted());
}

#[test]
fn constant_site_is_answered_with_written_specifier() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let written = atoms.intern(b"./a");
    let target_files = [Some(FileId(2)), None];
    let mut targets = TargetFiles(target_files.iter());
    let mut answer = || {
        let specifier = ImportSpecifier::Constant(written);
        answer_of(
            &atoms,
            arena,
            specifier,
            &SiteResolution::Constant(FILE),
            &mut targets,
        )
    };
    assert_eq!(answer(), CodeAnswer::File(FileId(2)));
    let expected = CodeAnswer::External {
        specifier: written,
        kind: ExternalKind::UncompiledCode,
    };
    assert_eq!(answer(), expected);
}

#[test]
fn computed_answer_is_sorted_and_unique() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let candidates = [
        FILE_CANDIDATE,
        host_module_candidate(9),
        FILE_CANDIDATE,
        host_module_candidate(4),
        FILE_CANDIDATE,
        host_module_candidate(9),
    ];
    let target_files = [8, 2, 8, 5].map(|file| Some(FileId(file)));
    let mut targets = TargetFiles(target_files.iter());
    let spelling = |text: &'static [u8], candidate| ComputedSpelling { text, candidate };
    let resolution = SiteResolution::Computed(ComputedResolution::Candidates {
        candidates: &candidates,
        spellings: &[spelling(b"./a", 2), spelling(b"./b", 0), spelling(b"c", 3)],
    });
    let answer = answer_of(
        &atoms,
        arena,
        ImportSpecifier::Unknown,
        &resolution,
        &mut targets,
    );
    let expected = ComputedTargets::Modules {
        files: &[FileId(2), FileId(8)],
        host_modules: &[HostModuleId(4), HostModuleId(9)],
        spellings: &[
            (atoms.intern(b"./a"), ComputedTarget::File(FileId(2))),
            (atoms.intern(b"./b"), ComputedTarget::File(FileId(8))),
            (
                atoms.intern(b"c"),
                ComputedTarget::HostModule(HostModuleId(4)),
            ),
        ],
    };
    assert_eq!(answer, CodeAnswer::Computed(expected));
    assert_eq!(targets.0.as_slice(), [Some(FileId(5))]);
}

#[test]
fn computed_answer_without_candidate_is_empty_set() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let target_files = [];
    let mut targets = TargetFiles(target_files.iter());
    let resolution = SiteResolution::Computed(ComputedResolution::Candidates {
        candidates: &[],
        spellings: &[],
    });
    let answer = answer_of(
        &atoms,
        arena,
        ImportSpecifier::Unknown,
        &resolution,
        &mut targets,
    );
    let expected = ComputedTargets::Modules {
        files: &[],
        host_modules: &[],
        spellings: &[],
    };
    assert_eq!(answer, CodeAnswer::Computed(expected));
}

#[test]
fn unknown_answer_keeps_cause_and_advances_past_file_candidates() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let host_modules = [
        host_module_candidate(9),
        FILE_CANDIDATE,
        host_module_candidate(4),
    ];
    let target_files = [Some(FileId(1)), Some(FileId(6))];
    let mut targets = TargetFiles(target_files.iter());
    let resolution = SiteResolution::Computed(ComputedResolution::All {
        cause: ComputedUnknown::NoConstantPrefix,
        host_modules: &host_modules,
    });
    let answer = answer_of(
        &atoms,
        arena,
        ImportSpecifier::Unknown,
        &resolution,
        &mut targets,
    );
    let expected = ComputedTargets::All {
        cause: ComputedUnknown::NoConstantPrefix,
        host_modules: &[HostModuleId(4), HostModuleId(9)],
    };
    assert_eq!(answer, CodeAnswer::Computed(expected));
    assert_eq!(targets.0.as_slice(), [Some(FileId(6))]);
}

#[test]
fn host_modules_come_from_constant_names_alone() {
    let ids = [HostModuleId(4), HostModuleId(9)];
    let constant = CodeAnswer::HostModule(HostModuleId(7));
    assert_eq!(host_modules_of(&constant), [HostModuleId(7)]);

    let others = [
        CodeAnswer::Computed(ComputedTargets::Modules {
            files: &[FileId(1)],
            host_modules: &ids,
            spellings: &[],
        }),
        CodeAnswer::Computed(ComputedTargets::All {
            cause: ComputedUnknown::NoPattern,
            host_modules: &ids,
        }),
        CodeAnswer::File(FileId(1)),
        CodeAnswer::External {
            specifier: known::require,
            kind: ExternalKind::HostValue,
        },
        CodeAnswer::Erased,
        CodeAnswer::NotFound(CodeFailure::ModuleNotFound),
    ];
    for answer in &others {
        assert!(host_modules_of(answer).is_empty(), "{answer:?}");
    }
}

#[test]
fn unique_files_keep_first_occurrence() {
    let (a, b, c) = (FileId(4), FileId(1), FileId(8));
    let targets = [Some(a), None, Some(b), Some(a), Some(c), None, Some(b)];
    assert_eq!(unique_files(&targets), [a, b, c]);
    assert!(unique_files(&[None, None]).is_empty());
    assert!(unique_files(&[]).is_empty());
}

#[test]
fn file_set_contains_only_members() {
    let session = Session::new();
    let set = file_set_in(4, &[FileId(2), FileId(0)], session.arena());
    assert_eq!(set, [true, false, true, false]);
    assert!(file_set_in(4, &[], session.arena()).is_empty());
}

#[test]
fn sorted_set_is_ascending_without_repeats() {
    let session = Session::new();
    let members = vec![FileId(4), FileId(1), FileId(4), FileId(0)];
    let set = sorted_set_in(members, session.arena());
    assert_eq!(set, [FileId(0), FileId(1), FileId(4)]);
    assert!(sorted_set_in(Vec::<FileId>::new(), session.arena()).is_empty());
}

#[test]
fn graph_without_files_matches_empty_graph() {
    let session = Session::new();
    let graph = CodeFiles::into_code_graph(None, &[], &session);
    assert_eq!(graph.is_compile_build, CodeGraph::EMPTY.is_compile_build);
    assert_has_no_files(&graph);
}

#[test]
fn build_without_files_is_compile_build() {
    let host = host_of(&[]);
    with_context(&host, |context| {
        let code_files = code_files_without_entries(context, &[]);
        let graph = CodeFiles::into_code_graph(Some(code_files), &[], context.session);
        assert!(graph.is_compile_build);
        assert_has_no_files(&graph);
    });
}

#[test]
fn edges_to_files_outside_types_program_are_removed() {
    let host = host_of(&[("/main.ts", "")]);
    with_context(&host, |context| {
        let arena = context.session.arena();
        let mut loaded = load_module(context, "/main.ts");
        let module = &mut *loaded.module;
        let (first, code_only, last) = (FileId(0), FileId(1), FileId(2));
        module.edges = slice_in(&[first, code_only, last, code_only], arena);
        let (a, b) = (context.atoms.intern(b"./a"), context.atoms.intern(b"./b"));
        module.imports.insert((a, ResolutionMode::None), first);
        module.imports.insert((b, ResolutionMode::None), code_only);
        module.imports.insert((b, ResolutionMode::Require), last);

        let code_files = code_files_without_entries(context, &[true, false, true]);
        code_files.remove_code_only_edges(module, arena);
        assert_eq!(module.edges, [first, last]);
        assert_eq!(module.imports.len(), 2);
        assert_eq!(module.imports.get(&(a, ResolutionMode::None)), Some(&first));
        assert_eq!(module.imports.get(&(b, ResolutionMode::None)), None);
        assert_eq!(
            module.imports.get(&(b, ResolutionMode::Require)),
            Some(&last)
        );
    });
}

#[test]
fn edges_inside_types_program_are_not_copied() {
    let host = host_of(&[("/main.ts", "")]);
    with_context(&host, |context| {
        let arena = context.session.arena();
        let mut loaded = load_module(context, "/main.ts");
        let edges = slice_in(&[FileId(0), FileId(2)], arena);
        loaded.module.edges = edges;
        let code_files = code_files_without_entries(context, &[true, false, true]);
        code_files.remove_code_only_edges(&mut loaded.module, arena);
        assert!(std::ptr::eq(loaded.module.edges, edges));
    });
}

#[test]
fn file_without_code_entry_is_not_compiled() {
    let host = host_of(&[("/main.ts", "")]);
    with_context(&host, |context| {
        let arena = context.session.arena();
        let mut loaded = load_module(context, "/main.ts");
        assert!(loaded.module.is_in_types_program);
        let code_files = code_files_without_entries(context, &[false]);
        code_files.finish_module(FileId(0), &mut loaded.module, arena);
        assert!(!loaded.module.is_in_types_program);
        assert!(loaded.module.compiled.is_none());
        assert!(loaded.module.code_edges.is_empty());
    });
}

#[test]
fn type_edges_come_before_code_edges() {
    let host = host_of(&[
        (
            "/main.ts",
            "import type t from \"./types\"\nimport \"./a.js\"",
        ),
        ("/types.ts", ""),
        ("/a.js", ""),
    ]);
    with_build(&TestBuild::new(&host, &["/main.ts"]), |files| {
        let module = files.module(file_at(files, "/main.ts"));
        assert_eq!(module.edges, [file_at(files, "/types.ts")]);
        assert_eq!(module.code_edges, [file_at(files, "/a.js")]);
        assert_eq!(edge_at(module, 0), Some(file_at(files, "/types.ts")));
        assert_eq!(edge_at(module, 1), Some(file_at(files, "/a.js")));
        assert_eq!(edge_at(module, 2), None);
    });
}

#[test]
fn file_is_ordered_after_referenced_files() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./a.js\"\nimport type t from \"./types\"",
        ),
        ("/a.js", "import \"./b.js\""),
        ("/b.js", "import \"./a.js\""),
        ("/types.ts", ""),
    ]);
    with_build(&TestBuild::new(&host, &["/main.ts"]), |files| {
        let ordered = order_unseen_files(files, &[]);
        assert!(ordered.libs.is_empty());
        let names = names_of(files, &ordered.others);
        assert_eq!(names, ["/types.ts", "/b.js", "/a.js", "/main.ts"]);
        assert!(ordered.seen.iter().all(|&is_seen| is_seen));
    });
}

#[test]
fn seen_file_is_not_ordered_again() {
    let host = host_of(&[
        ("/main.ts", "import \"./a.js\""),
        ("/a.js", "import \"./b.js\""),
        ("/b.js", ""),
    ]);
    with_build(&TestBuild::new(&host, &["/main.ts"]), |files| {
        let ordered = order_unseen_files(files, &[file_at(files, "/a.js")]);
        assert_eq!(names_of(files, &ordered.others), ["/main.ts", "/b.js"]);
    });
}

#[test]
fn libraries_are_ordered_apart() {
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
        let ordered = order_unseen_files(files, &[]);
        assert_eq!(names_of(files, &ordered.libs), ["/lib/lib.es5.d.ts"]);
        assert_eq!(names_of(files, &ordered.others), ["/main.ts"]);
    });
}

#[test]
fn load_for_check_orders_no_code_file() {
    let host = host_of(&[("/main.ts", "import \"./a\""), ("/a.ts", "")]);
    let session = Session::new();
    let roots = to_paths(&["/main.ts"]);
    let files = Files::load(&session, None, &host, Options::default(), &roots, &|_| {});
    let ordered = order_unseen_files(&files, &[]);
    assert!(ordered.libs.is_empty() && ordered.others.is_empty());
    assert!(ordered.seen.iter().all(|&is_seen| !is_seen));
}
