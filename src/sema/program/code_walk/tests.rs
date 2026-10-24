#![cfg(not(miri))]

use super::*;
use crate::program::code_test_host::{
    HostEvent, StatementsHost, TEXT_LOADER, TestBuild, with_compile_context,
};
use crate::resolve::{CodeHost, HostResolution};

const GRAPH: &[(&str, &str)] = &[
    (
        "/main.ts",
        "import \"./chain-a\"\nimport \"./left\"\nimport \"./right\"\nimport \"./cycle-a\"",
    ),
    ("/chain-a.ts", "import \"./chain-b\""),
    ("/chain-b.ts", ""),
    ("/left.ts", "import \"./shared\""),
    ("/right.ts", "import \"./shared\""),
    ("/shared.ts", ""),
    ("/cycle-a.ts", "import \"./cycle-b\""),
    ("/cycle-b.ts", "import \"./cycle-a\""),
];

#[derive(PartialEq, Eq, Debug)]
struct WalkedEntry {
    path: String,
    loader: HostLoader,
    role: FileRole,
    host_module: Option<HostModuleId>,
    package_depth: u32,
    targets: Vec<u32>,
}

#[derive(PartialEq, Eq, Debug)]
struct Walked {
    entries: Vec<WalkedEntry>,
    entry_points: Vec<u32>,
}

impl Walked {
    fn paths(&self) -> Vec<&str> {
        self.entries
            .iter()
            .map(|entry| entry.path.as_str())
            .collect()
    }

    fn entry(&self, path: &str) -> &WalkedEntry {
        let mut entries = self.entries.iter().filter(|entry| entry.path == path);
        let entry = entries.next().expect("the path has an entry");
        assert!(entries.next().is_none(), "{path} has two entries");
        entry
    }
}

fn host_of(files: &'static [(&'static str, &'static str)]) -> StatementsHost {
    StatementsHost {
        files,
        ..StatementsHost::default()
    }
}

fn with_code_files<R>(
    host: &StatementsHost,
    entry_points: &[&str],
    test: impl FnOnce(&CodeFiles<'_, '_>) -> R,
) -> R {
    let build = TestBuild::new(host, entry_points);
    let read_now = |paths: Vec<Vec<u8>>| {
        for path in paths {
            host.read_in_background(&path);
        }
    };
    with_compile_context(&build, |context| {
        test(&context.load_code_files(&read_now, &Default::default(), &mut || {}))
    })
}

fn walk(host: &StatementsHost, entry_points: &[&str]) -> Walked {
    with_code_files(host, entry_points, |files| Walked {
        entries: (files.entries.iter())
            .map(|entry| WalkedEntry {
                path: entry.key.path.as_bstr().to_string(),
                loader: entry.key.loader,
                role: entry.role,
                host_module: entry.host_module,
                package_depth: entry.package_depth,
                targets: entry.targets.clone(),
            })
            .collect(),
        entry_points: files.entry_points.clone(),
    })
}

fn find_entry<'f, 's, 'r>(files: &'f CodeFiles<'s, 'r>, path: &str) -> &'f CodeEntry<'s, 'r> {
    let mut entries = files.entries.iter();
    let entry = entries.find(|entry| entry.key.path == path.as_bytes());
    entry.expect("the path has an entry")
}

fn read(path: &str) -> HostEvent {
    HostEvent::ReadCode(path.into())
}

fn parsed(path: &str) -> HostEvent {
    HostEvent::ParsedCode(path.into())
}

fn position(events: &[HostEvent], event: &HostEvent) -> usize {
    let found = events.iter().position(|it| it == event);
    found.unwrap_or_else(|| panic!("{event:?} is not among {events:?}"))
}

fn count(events: &[HostEvent], event: &HostEvent) -> usize {
    events.iter().filter(|&it| it == event).count()
}

#[test]
fn imported_file_comes_before_importer() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\""),
        ("/a.ts", "import \"./b\""),
        ("/b.ts", ""),
    ]);
    let walked = walk(&host, &["/main.ts"]);
    assert_eq!(walked.paths(), ["/b.ts", "/a.ts", "/main.ts"]);
    let targets: Vec<&[u32]> = (walked.entries.iter())
        .map(|entry| entry.targets.as_slice())
        .collect();
    assert_eq!(targets, [&[][..], &[0], &[1]]);
    assert_eq!(walked.entry_points, [2]);
}

#[test]
fn file_imported_twice_has_one_entry() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./left\"\nimport \"./right\"\nimport \"./left\"",
        ),
        ("/left.ts", "import \"./shared\""),
        ("/right.ts", "import \"./shared\""),
        ("/shared.ts", ""),
    ]);
    let walked = walk(&host, &["/main.ts"]);
    assert_eq!(
        walked.paths(),
        ["/shared.ts", "/left.ts", "/right.ts", "/main.ts"]
    );
    assert_eq!(walked.entry("/main.ts").targets, [1, 2, 1]);
    assert_eq!(walked.entry("/right.ts").targets, [0]);
    assert_eq!(count(&host.events(), &read("/shared.ts")), 1);
}

#[test]
fn first_visit_orders_cycle() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\""),
        ("/a.ts", "import \"./b\""),
        ("/b.ts", "import \"./a\"\nimport \"./main\""),
    ]);
    let walked = walk(&host, &["/main.ts"]);
    assert_eq!(walked.paths(), ["/b.ts", "/a.ts", "/main.ts"]);
    assert_eq!(walked.entry("/b.ts").targets, [1, 2]);
}

#[test]
fn entry_points_are_walked_in_order() {
    let files: &[(&str, &str)] = &[
        ("/first.ts", ""),
        ("/second.ts", "import \"./first\"\nimport \"./third\""),
        ("/third.ts", ""),
    ];
    let walked = walk(&host_of(files), &["/first.ts", "/second.ts", "/third.ts"]);
    assert_eq!(walked.paths(), ["/first.ts", "/third.ts", "/second.ts"]);
    assert_eq!(walked.entry_points, [0, 2, 1]);

    let walked = walk(&host_of(files), &["/third.ts", "/second.ts"]);
    assert_eq!(walked.paths(), ["/third.ts", "/first.ts", "/second.ts"]);
    assert_eq!(walked.entry_points, [0, 2]);
}

#[test]
fn order_does_not_depend_on_threads() {
    let expected = walk(&host_of(GRAPH), &["/main.ts"]);
    let paths = [
        "/chain-b.ts",
        "/chain-a.ts",
        "/shared.ts",
        "/left.ts",
        "/right.ts",
        "/cycle-b.ts",
        "/cycle-a.ts",
        "/main.ts",
    ];
    assert_eq!(expected.paths(), paths);
    let with_threads = StatementsHost {
        threads: 8,
        ..host_of(GRAPH)
    };
    let hosts = [
        with_threads,
        host_of(GRAPH).with_process_io_pool(1),
        host_of(GRAPH).with_process_io_pool(4),
    ];
    for host in &hosts {
        assert_eq!(
            walk(host, &["/main.ts"]),
            expected,
            "{} threads",
            host.threads
        );
    }
}

#[test]
fn loader_is_part_of_identity() {
    let host = StatementsHost {
        loaders: &[("/data.ts", Some("text"), TEXT_LOADER)],
        ..host_of(&[
            (
                "/main.ts",
                "import \"./data.ts\"\n\
                 import \"./data.ts\" with { type: \"text\" }\n\
                 import \"./again\"",
            ),
            ("/again.ts", "import \"./data.ts\" with { type: \"text\" }"),
            ("/data.ts", "import \"./only-code\""),
            ("/only-code.ts", ""),
        ])
    };
    let walked = walk(&host, &["/main.ts"]);
    let paths = [
        "/only-code.ts",
        "/data.ts",
        "/data.ts",
        "/again.ts",
        "/main.ts",
    ];
    assert_eq!(walked.paths(), paths);
    let (as_code, as_text) = (&walked.entries[1], &walked.entries[2]);
    assert_eq!(
        (as_code.loader, as_code.role),
        (HostLoader::default(), FileRole::Checked)
    );
    assert_eq!(as_code.targets, [0]);
    assert_eq!(
        (as_text.loader, as_text.role),
        (TEXT_LOADER, FileRole::Inferred)
    );
    assert!(as_text.targets.is_empty());
    assert_eq!(walked.entry("/again.ts").targets, [2]);
    assert_eq!(walked.entry("/main.ts").targets, [1, 2, 3]);
    assert_eq!(count(&host.events(), &read("/data.ts")), 2);
}

#[test]
fn import_in_folded_code_is_not_loaded() {
    let host = host_of(&[
        (
            "/main.ts",
            "if (false) import(\"./dead\")\nif (false) require(\"./dead-too\")\nimport(\"./live\")",
        ),
        ("/dead.ts", ""),
        ("/dead-too.ts", ""),
        ("/live.ts", ""),
    ]);
    assert_eq!(walk(&host, &["/main.ts"]).paths(), ["/live.ts", "/main.ts"]);
    let events = host.events();
    assert_eq!(count(&events, &read("/live.ts")), 1);
    assert_eq!(count(&events, &read("/dead.ts")), 0);
    assert_eq!(count(&events, &read("/dead-too.ts")), 0);
}

#[test]
fn deferred_read_is_finished_after_every_other_file() {
    let files: &[(&str, &str)] = &[
        ("/main.ts", "import \"./late\"\nimport \"./a\""),
        ("/late.ts", "import \"./after\""),
        ("/a.ts", "import \"./b\""),
        ("/b.ts", ""),
        ("/after.ts", ""),
    ];
    for threads in [1, 8] {
        let host = StatementsHost {
            deferred: &[("/late.ts", ScriptKind::Ts)],
            threads,
            ..host_of(files)
        };
        let walked = walk(&host, &["/main.ts"]);
        let paths = ["/after.ts", "/late.ts", "/b.ts", "/a.ts", "/main.ts"];
        assert_eq!(walked.paths(), paths, "{threads} threads");
        let events = host.events();
        assert_eq!(count(&events, &HostEvent::FinishedDeferredReads), 1);
        let finished = position(&events, &HostEvent::FinishedDeferredReads);
        for path in ["/main.ts", "/a.ts", "/b.ts"] {
            assert!(
                position(&events, &parsed(path)) < finished,
                "{path}, {threads} threads"
            );
        }
        for path in ["/late.ts", "/after.ts"] {
            assert!(
                finished < position(&events, &parsed(path)),
                "{path}, {threads} threads"
            );
        }
    }
}

#[test]
fn no_file_waits_behind_a_read_by_plugin() {
    let files: &[(&str, &str)] = &[
        (
            "/main.ts",
            "import \"./slow\"\nimport \"./slower\"\nimport \"./slowest\"\nimport \"./a\"",
        ),
        ("/slow.ts", ""),
        ("/slower.ts", ""),
        ("/slowest.ts", "import \"./after\""),
        ("/a.ts", "import \"./b\""),
        ("/b.ts", ""),
        ("/after.ts", ""),
    ];
    let read_by_plugin: &[(&str, &str)] = &[
        ("/slow.ts", "/b.ts"),
        ("/slower.ts", "/b.ts"),
        ("/slowest.ts", "/b.ts"),
    ];
    let hosts = [
        StatementsHost {
            read_by_plugin,
            threads: 4,
            ..host_of(files)
        },
        StatementsHost {
            read_by_plugin,
            ..host_of(files)
        }
        .with_process_io_pool(4),
    ];
    for host in hosts {
        let walked = walk(&host, &["/main.ts"]);
        assert!(!host.has_waited_in_vain.load(Ordering::Relaxed));
        let paths = [
            "/slow.ts",
            "/slower.ts",
            "/after.ts",
            "/slowest.ts",
            "/b.ts",
            "/a.ts",
            "/main.ts",
        ];
        assert_eq!(walked.paths(), paths);
        let events = host.events();
        for path in paths {
            assert_eq!(count(&events, &read(path)), 1, "{path}");
            assert_eq!(count(&events, &parsed(path)), 1, "{path}");
        }
    }
}

const WITH_ASSETS: &[(&str, &str)] = &[
    (
        "/main.ts",
        "import \"./first.bin\"\nimport \"./slow\"\nimport \"./a\"\nimport \"./second.bin\"",
    ),
    ("/first.bin", "import \"./never\""),
    ("/second.bin", "import \"./never\""),
    ("/slow.ts", "import \"./after\""),
    ("/a.ts", "import \"./b\""),
    ("/b.ts", ""),
    ("/after.ts", ""),
    ("/never.ts", ""),
];
const ASSETS_READ_BY_PLUGIN: &[(&str, &str)] = &[
    ("/first.bin", "/b.ts"),
    ("/second.bin", "/b.ts"),
    ("/slow.ts", "/b.ts"),
];
const ASSETS: &[&str] = &["/first.bin", "/second.bin"];

fn started_background_reads() -> HostEvent {
    HostEvent::StartedBackgroundReads(ASSETS.iter().map(|&path| path.into()).collect())
}

fn hosts_with_assets(change: impl Fn(StatementsHost) -> StatementsHost) -> [StatementsHost; 2] {
    let host = || {
        change(StatementsHost {
            read_by_plugin: ASSETS_READ_BY_PLUGIN,
            background_readable: ASSETS,
            ..host_of(WITH_ASSETS)
        })
    };
    let on_four_threads = StatementsHost {
        threads: 4,
        ..host()
    };
    [on_four_threads, host().with_process_io_pool(4)]
}

#[test]
fn assets_are_read_in_background_after_all_other_files() {
    for host in hosts_with_assets(|host| host) {
        let walked = walk(&host, &["/main.ts"]);
        assert!(!host.has_waited_in_vain.load(Ordering::Relaxed));
        let paths = [
            "/first.bin",
            "/after.ts",
            "/slow.ts",
            "/b.ts",
            "/a.ts",
            "/second.bin",
            "/main.ts",
        ];
        assert_eq!(walked.paths(), paths);
        let events = host.events();
        let started = position(&events, &started_background_reads());
        assert_eq!(count(&events, &started_background_reads()), 1);
        for path in ["/main.ts", "/slow.ts", "/after.ts", "/a.ts", "/b.ts"] {
            assert_eq!(count(&events, &read(path)), 1, "{path}");
            assert!(position(&events, &parsed(path)) < started, "{path}");
        }
        for &path in ASSETS {
            assert_eq!(count(&events, &read(path)), 0, "{path}");
            assert_eq!(
                count(&events, &HostEvent::BackgroundRead(path.into())),
                1,
                "{path}"
            );
            assert_eq!(count(&events, &parsed(path)), 1, "{path}");
            assert!(started < position(&events, &parsed(path)), "{path}");
        }
    }
}

#[test]
fn assets_are_read_normally_if_host_rejects_background_reads() {
    let rejects_background_reads = |host| StatementsHost {
        rejects_background_reads: true,
        ..host
    };
    for host in hosts_with_assets(rejects_background_reads) {
        let walked = walk(&host, &["/main.ts"]);
        assert!(!host.has_waited_in_vain.load(Ordering::Relaxed));
        let paths = [
            "/never.ts",
            "/first.bin",
            "/after.ts",
            "/slow.ts",
            "/b.ts",
            "/a.ts",
            "/second.bin",
            "/main.ts",
        ];
        assert_eq!(walked.paths(), paths);
        let events = host.events();
        assert_eq!(count(&events, &started_background_reads()), 1);
        for path in paths {
            assert_eq!(count(&events, &read(path)), 1, "{path}");
            assert_eq!(count(&events, &parsed(path)), 1, "{path}");
            assert_eq!(
                count(&events, &HostEvent::BackgroundRead(path.into())),
                0,
                "{path}"
            );
        }
    }
}

#[test]
fn assets_are_read_before_deferred_reads_finish() {
    let with_deferred_read = |host| StatementsHost {
        deferred: &[("/after.ts", ScriptKind::Ts)],
        ..host
    };
    for host in hosts_with_assets(with_deferred_read) {
        walk(&host, &["/main.ts"]);
        let events = host.events();
        assert_eq!(count(&events, &started_background_reads()), 0);
        let finished = position(&events, &HostEvent::FinishedDeferredReads);
        for &path in ASSETS {
            assert_eq!(count(&events, &read(path)), 1, "{path}");
            assert!(position(&events, &parsed(path)) < finished, "{path}");
        }
    }
}

#[test]
fn deferred_reads_are_finished_together() {
    let host = StatementsHost {
        deferred: &[("/late.ts", ScriptKind::Ts), ("/later.ts", ScriptKind::Ts)],
        ..host_of(&[
            ("/main.ts", "import \"./late\"\nimport \"./later\""),
            ("/late.ts", ""),
            ("/later.ts", ""),
        ])
    };
    assert_eq!(
        walk(&host, &["/main.ts"]).paths(),
        ["/late.ts", "/later.ts", "/main.ts"]
    );
    let events = host.events();
    assert_eq!(count(&events, &HostEvent::FinishedDeferredReads), 1);
    assert_eq!(count(&events, &parsed("/late.ts")), 1);
    assert_eq!(count(&events, &parsed("/later.ts")), 1);
}

#[test]
fn build_without_deferred_read_finishes_none() {
    let host = host_of(GRAPH);
    walk(&host, &["/main.ts"]);
    assert_eq!(count(&host.events(), &HostEvent::FinishedDeferredReads), 0);
}

#[test]
fn deferred_read_omitted_by_host_is_empty_module() {
    let host = StatementsHost {
        claims: vec![("./ghost", HostResolution::Path(b"/ghost.ts".to_vec()))],
        deferred: &[("/ghost.ts", ScriptKind::Ts)],
        ..host_of(&[("/main.ts", "import \"./ghost\"")])
    };
    with_code_files(&host, &["/main.ts"], |files| {
        let ghost = find_entry(files, "/ghost.ts");
        assert_eq!(ghost.role, FileRole::Checked);
        assert!(ghost.targets.is_empty());
        let loaded = ghost.loaded.lock();
        let hir = &loaded.as_ref().expect("the file is loaded").module.hir;
        assert!(hir.body.is_empty());
        assert_eq!(hir.source_len, 0);
        assert!(!hir.has_errors);
    });
}

#[test]
fn declaration_file_is_types_only_and_not_read() {
    let host = host_of(&[
        ("/main.ts", "import \"./types.d.ts\"\nimport \"./a\""),
        ("/types.d.ts", "import \"./never-followed\""),
        ("/never-followed.ts", ""),
        ("/a.ts", ""),
    ]);
    with_code_files(&host, &["/main.ts"], |files| {
        let paths: Vec<&[u8]> = files.entries.iter().map(|entry| entry.key.path).collect();
        assert_eq!(paths, [&b"/types.d.ts"[..], b"/a.ts", b"/main.ts"]);
        let types = find_entry(files, "/types.d.ts");
        assert_eq!(types.role, FileRole::TypesOnly);
        assert!(types.targets.is_empty());
        assert!(types.loaded.lock().is_none());
        assert!(types.code.lock().is_none());
        assert!(types.payload.is_none());
        assert!(types.settings.is_none());

        let code = find_entry(files, "/a.ts");
        assert_eq!(code.role, FileRole::Checked);
        assert!(code.loaded.lock().is_some());
        assert!(code.code.lock().is_some());
        assert!(code.payload.is_some());
        assert!(code.settings.is_some());
    });
    let events = host.events();
    assert_eq!(count(&events, &read("/types.d.ts")), 0);
    assert_eq!(count(&events, &parsed("/types.d.ts")), 0);
}

#[test]
fn type_only_import_is_predicted_and_not_walked() {
    let host = host_of(&[
        (
            "/main.ts",
            "import type t from \"./only-types\"\nimport \"./a\"",
        ),
        ("/only-types.ts", ""),
        ("/a.ts", ""),
    ]);
    with_code_files(&host, &["/main.ts"], |files| {
        assert_eq!(files.entries.len(), 2);
        let predicted = &find_entry(files, "/main.ts").predicted_type_files;
        assert_eq!(
            predicted[..],
            [(&b"/only-types.ts"[..], false), (&b"/a.ts"[..], false)]
        );
    });
    assert_eq!(count(&host.events(), &read("/only-types.ts")), 0);
}

#[test]
fn package_depth_counts_steps_into_packages() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\""),
        ("/a.ts", "import \"pkg\""),
        (
            "/node_modules/pkg/index.js",
            "import \"./b.js\"\nimport \"nested\"",
        ),
        ("/node_modules/pkg/b.js", ""),
        ("/node_modules/nested/index.js", ""),
    ]);
    let walked = walk(&host, &["/main.ts"]);
    let depth_of = |path: &str| walked.entry(path).package_depth;
    assert_eq!(depth_of("/main.ts"), 0);
    assert_eq!(depth_of("/a.ts"), 0);
    assert_eq!(depth_of("/node_modules/pkg/index.js"), 1);
    assert_eq!(depth_of("/node_modules/pkg/b.js"), 1);
    assert_eq!(depth_of("/node_modules/nested/index.js"), 2);
}

#[test]
fn package_depth_is_lowest_of_all_ways() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"pkg\"\nimport \"./node_modules/pkg/b.js\"",
        ),
        ("/node_modules/pkg/index.js", "import \"./b.js\""),
        ("/node_modules/pkg/b.js", "import \"./c.js\""),
        ("/node_modules/pkg/c.js", ""),
    ]);
    let walked = walk(&host, &["/main.ts"]);
    let depth_of = |path: &str| walked.entry(path).package_depth;
    assert_eq!(depth_of("/node_modules/pkg/index.js"), 1);
    assert_eq!(depth_of("/node_modules/pkg/b.js"), 0);
    assert_eq!(depth_of("/node_modules/pkg/c.js"), 0);
}

fn entry_with_targets(targets: Vec<u32>) -> CodeEntry<'static, 'static> {
    CodeEntry {
        key: LoadKey {
            path: b"",
            loader: HostLoader::default(),
        },
        host_module: None,
        role: FileRole::Inferred,
        package_depth: u32::MAX,
        targets,
        predicted_type_files: Vec::new(),
        jsdoc_imports: Vec::new(),
        loaded: Guarded::new(None),
        code: Guarded::new(None),
        payload: None,
        settings: None,
        package: None,
        side_effects: DeclaredSideEffects::Unspecified,
        file: None,
    }
}

fn package_depths(edges: &[&[(u32, bool)]], entry_points: &[u32]) -> Vec<u32> {
    let targets_of = |edges: &&[(u32, bool)]| edges.iter().map(|edge| edge.0).collect();
    let mut entries: Vec<CodeEntry<'_, '_>> = (edges.iter())
        .map(|edges| entry_with_targets(targets_of(edges)))
        .collect();
    let steps: Vec<Vec<bool>> = (edges.iter())
        .map(|edges| edges.iter().map(|edge| edge.1).collect())
        .collect();
    compute_package_depths(&mut entries, entry_points, &steps);
    entries.iter().map(|entry| entry.package_depth).collect()
}

#[test]
fn later_cheaper_edge_lowers_depth_of_everything_below() {
    let edges: [&[(u32, bool)]; 5] = [
        &[(1, true), (4, false)],
        &[(2, false)],
        &[(3, true)],
        &[],
        &[(1, false)],
    ];
    assert_eq!(package_depths(&edges, &[0]), [0, 0, 0, 1, 0]);
}

#[test]
fn depth_in_cycle_ends() {
    let edges: [&[(u32, bool)]; 3] = [&[(1, true)], &[(2, true)], &[(1, true), (0, true)]];
    assert_eq!(package_depths(&edges, &[0]), [0, 1, 2]);
}

#[test]
fn every_entry_point_has_depth_zero() {
    let edges: [&[(u32, bool)]; 3] = [&[(1, true)], &[(2, true)], &[]];
    assert_eq!(package_depths(&edges, &[0, 1, 1]), [0, 0, 1]);
}

#[test]
fn host_module_does_not_depend_on_importer_order() {
    let source = || HostResolution::ModuleSource {
        module: HostModuleId(3),
        path: b"/bun/fs.ts".to_vec(),
    };
    let by_path_first: &[(&str, &str)] = &[
        ("/main.ts", "import \"/bun/fs.ts\"\nimport \"node:fs\""),
        ("/bun/fs.ts", ""),
    ];
    let by_name_first: &[(&str, &str)] = &[
        ("/main.ts", "import \"node:fs\"\nimport \"/bun/fs.ts\""),
        ("/bun/fs.ts", ""),
    ];
    for files in [by_path_first, by_name_first] {
        let host = StatementsHost {
            claims: vec![("node:fs", source())],
            ..host_of(files)
        };
        let walked = walk(&host, &["/main.ts"]);
        assert_eq!(walked.paths(), ["/bun/fs.ts", "/main.ts"]);
        assert_eq!(
            walked.entry("/bun/fs.ts").host_module,
            Some(HostModuleId(3))
        );
        assert_eq!(walked.entry("/main.ts").host_module, None);
    }
}

#[test]
fn case_insensitive_host_has_one_entry_per_file() {
    let files: &[(&str, &str)] = &[
        ("/main.ts", "import \"./x\"\nimport \"./A\""),
        ("/x.ts", "import \"./a\""),
        ("/a.ts", ""),
    ];
    for threads in [1, 8] {
        let host = StatementsHost {
            is_case_sensitive: false,
            threads,
            ..host_of(files)
        };
        let walked = walk(&host, &["/main.ts"]);
        assert_eq!(
            walked.paths(),
            ["/a.ts", "/x.ts", "/main.ts"],
            "{threads} threads"
        );
        assert_eq!(walked.entry("/main.ts").targets, [1, 0]);
    }
}

#[test]
fn case_sensitive_host_has_one_entry_per_spelling() {
    let host = host_of(&[
        ("/main.ts", "import \"./a\"\nimport \"./A\""),
        ("/a.ts", ""),
        ("/A.ts", ""),
    ]);
    assert_eq!(
        walk(&host, &["/main.ts"]).paths(),
        ["/a.ts", "/A.ts", "/main.ts"]
    );
}

#[test]
fn equal_settings_are_copied_once() {
    let host = host_of(&[
        (
            "/main.ts",
            "import \"./x/a\"\nimport \"./y/b\"\nimport \"./z/c\"",
        ),
        ("/x/tsconfig.json", ""),
        ("/x/a.ts", ""),
        ("/y/tsconfig.json", ""),
        ("/y/b.ts", ""),
        ("/z/tsconfig.json", "experimentalDecorators"),
        ("/z/c.ts", ""),
    ]);
    let build = TestBuild::new(&host, &["/main.ts"]);
    with_compile_context(&build, |context| {
        let of_resolver = |path: &[u8]| context.resolver.transpile_settings(path);
        assert!(!std::ptr::eq(
            of_resolver(b"/x/a.ts"),
            of_resolver(b"/y/b.ts")
        ));
        assert_eq!(of_resolver(b"/x/a.ts"), of_resolver(b"/y/b.ts"));

        let files = context.load_code_files(&|_| {}, &Default::default(), &mut || {});
        let settings_of = |path| find_entry(&files, path).settings.expect("a file with code");
        assert!(std::ptr::eq(settings_of("/x/a.ts"), settings_of("/y/b.ts")));
        assert!(std::ptr::eq(
            settings_of("/x/a.ts"),
            settings_of("/main.ts")
        ));
        assert!(!std::ptr::eq(
            settings_of("/x/a.ts"),
            settings_of("/z/c.ts")
        ));
        assert!(!settings_of("/x/a.ts").experimental_decorators);
        assert!(settings_of("/z/c.ts").experimental_decorators);
    });
}

#[test]
fn package_is_copied_once_per_directory() {
    let host = host_of(&[
        ("/main.ts", "import \"pkg\"\nimport \"other\""),
        ("/node_modules/pkg/package.json", "pkg@1.0.0"),
        ("/node_modules/pkg/index.js", "import \"./b.js\""),
        ("/node_modules/pkg/b.js", ""),
        ("/node_modules/other/package.json", "other@2.0.0"),
        ("/node_modules/other/index.js", ""),
    ]);
    with_code_files(&host, &["/main.ts"], |files| {
        let package_of = |path| find_entry(files, path).package;
        assert_eq!(package_of("/main.ts"), None);
        let pkg = package_of("/node_modules/pkg/index.js").expect("a file of a package");
        let expected = EnclosingPackage {
            directory: b"/node_modules/pkg",
            name: b"pkg",
            version: b"1.0.0",
        };
        assert_eq!(pkg, expected);
        let same = package_of("/node_modules/pkg/b.js").expect("a file of a package");
        assert!(std::ptr::eq(pkg.directory, same.directory));
        assert!(std::ptr::eq(pkg.name, same.name));
        let other = package_of("/node_modules/other/index.js").expect("a file of a package");
        assert_eq!((other.name, other.version), (&b"other"[..], &b"2.0.0"[..]));
    });
}

#[test]
fn unreadable_file_is_empty_module() {
    let host = StatementsHost {
        claims: vec![("./ghost", HostResolution::Path(b"/ghost.ts".to_vec()))],
        ..host_of(&[("/main.ts", "import \"./ghost\"")])
    };
    with_code_files(&host, &["/main.ts"], |files| {
        let ghost = find_entry(files, "/ghost.ts");
        assert_eq!(ghost.role, FileRole::Checked);
        assert!(ghost.targets.is_empty());
        let loaded = ghost.loaded.lock();
        let hir = &loaded.as_ref().expect("the file is loaded").module.hir;
        assert!(hir.body.is_empty());
        assert!(!hir.has_errors);
    });
    let events = host.events();
    assert_eq!(count(&events, &read("/ghost.ts")), 1);
    assert_eq!(count(&events, &HostEvent::FinishedDeferredReads), 0);
}
