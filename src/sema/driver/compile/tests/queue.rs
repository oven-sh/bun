use super::support::{TestProgram, check, with_program};
use crate::Report;
use crate::compile::FileWork;
use crate::compile::queue::{LOWERING_ROUNDS, ROLE_ROUNDS, run_queue};
use bun_sema::check::{Checker, Requested};
use bun_sema::program::{FileId, Files, ReadingTask};
use bun_sema::util::SharedSort;
use bun_threading::{Condvar, Guarded};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::ThreadId;
use std::time::{Duration, Instant};

#[derive(Copy, Clone)]
struct PassOptions {
    frees_trees: bool,
    first_round: u32,
}

const LOWERING_PASS: PassOptions = PassOptions {
    frees_trees: false,
    first_round: LOWERING_ROUNDS,
};

const ROLE_PASS: PassOptions = PassOptions {
    frees_trees: false,
    first_round: ROLE_ROUNDS,
};

fn run_pass_over<'s>(
    program: &TestProgram<'_, 's>,
    to_check: Vec<FileId>,
    options: PassOptions,
    requested: &(dyn Fn(FileId) -> Requested + Sync),
    after_file: &(dyn Fn(&mut Checker<'_, 's>, FileId) + Sync),
) -> Report {
    run_queue(
        program.loaded,
        program.host,
        program.request,
        to_check,
        &FileWork {
            requested,
            after_file: Some(after_file),
            after_commit: &|_| {},
            beside_file: None,
            frees_tree: &|_| options.frees_trees,
            is_last_pass: &|| false,
            note_cycles_entered: None,
            cycles_entered_before: &Default::default,
            first_round: options.first_round,
            left_out_bodies: None,
        },
    )
}

fn run_pass<'s>(
    program: &TestProgram<'_, 's>,
    options: PassOptions,
    requested: &(dyn Fn(FileId) -> Requested + Sync),
    after_file: &(dyn Fn(&mut Checker<'_, 's>, FileId) + Sync),
) -> Report {
    let files = program.files();
    let mut to_check: Vec<FileId> = (0..files.modules.len() as u32).map(FileId).collect();
    to_check.shared_sort_by_key(|&file| files.rank_of_file(file));
    run_pass_over(program, to_check, options, requested, after_file)
}

fn check_all_files<'s>(
    program: &TestProgram<'_, 's>,
    options: PassOptions,
    after_file: &(dyn Fn(&mut Checker<'_, 's>, FileId) + Sync),
) -> Report {
    run_pass(program, options, &|_| Requested::All, after_file)
}

fn count_reported(report: &Report, file: FileId, code: u32) -> usize {
    let in_file = report.diagnostics.iter().filter(|it| it.file == Some(file));
    in_file.filter(|it| it.code == code).count()
}

fn codes_reported(report: &Report, file: FileId) -> Vec<u32> {
    let in_file = report.diagnostics.iter().filter(|it| it.file == Some(file));
    in_file.map(|it| it.code).collect()
}

fn import_chain(count: usize) -> Vec<(String, String)> {
    let text_of = |index: usize| match index.checked_sub(1) {
        None => "export const value0 = 0;".to_owned(),
        Some(before) => format!(
            "import {{ value{before} }} from \"./file{before}\";\n\
             export const value{index} = value{before} + 1;"
        ),
    };
    (0..count)
        .map(|index| (format!("file{index}.ts"), text_of(index)))
        .collect()
}

#[test]
fn each_file_is_visited() {
    let chain = import_chain(40);
    let files = chain.iter().map(|(path, text)| (&path[..], &text[..]));
    let files: Vec<(&str, &str)> = files.collect();
    with_program(&files, &["./file39.ts"], 4, |program| {
        let modules = program.files().modules.iter();
        let calls: Vec<AtomicUsize> = modules.map(|_| AtomicUsize::new(0)).collect();
        assert_eq!(calls.len(), chain.len() + 1);
        let report = check_all_files(program, LOWERING_PASS, &|_, file| {
            calls[file.idx()].fetch_add(1, Ordering::Relaxed);
        });
        assert!(calls.iter().all(|count| count.load(Ordering::Relaxed) != 0));
        assert_eq!(report.rounds[0].files, calls.len());
        assert!(report.diagnostics.is_empty());
        assert!(report.incomplete.is_empty());
    });
}

#[test]
fn a_second_thread_works_beside_a_file_that_takes_as_long_as_the_round() {
    let long: String = (0..3000)
        .map(|index| format!("export const value{index} = one + one + one + one;\n"))
        .collect();
    let long = format!("const one = 1;\n{long}");
    let files = [
        ("main.ts", "import \"./long.ts\";\nimport \"./short.ts\";\n"),
        ("long.ts", &long[..]),
        ("short.ts", "export const one = 1;\n"),
    ];
    with_program(&files, &["./main.ts"], 4, |program| {
        let long_file = program.file("long.ts");
        let beside: Guarded<Vec<(FileId, ThreadId)>> = Guarded::new(Vec::new());
        let has_worked_beside = Condvar::new();
        let visiting_thread: Guarded<Option<ThreadId>> = Guarded::new(None);
        let all = program.files().modules.len() as u32;
        let mut to_check: Vec<FileId> = (0..all).map(FileId).collect();
        to_check.shared_sort_by_key(|&file| program.files().rank_of_file(file));
        run_queue(
            program.loaded,
            program.host,
            program.request,
            to_check,
            &FileWork {
                requested: &|_| Requested::All,
                after_file: Some(&|_, file| {
                    if file != long_file {
                        return;
                    }
                    *visiting_thread.lock() = Some(std::thread::current().id());
                    let mut beside = beside.lock();
                    while beside.iter().all(|it| it.0 != long_file) {
                        has_worked_beside.wait_guarded(&mut beside);
                    }
                }),
                after_commit: &|_| {},
                beside_file: Some(&|file| {
                    beside.lock().push((file, std::thread::current().id()));
                    has_worked_beside.notify_all();
                }),
                frees_tree: &|_| false,
                is_last_pass: &|| false,
                note_cycles_entered: None,
                cycles_entered_before: &Default::default,
                first_round: LOWERING_ROUNDS,
                left_out_bodies: None,
            },
        );
        let beside = beside.lock();
        assert_eq!(beside.len(), 1);
        assert_eq!(beside[0].0, long_file);
        assert_ne!(Some(beside[0].1), *visiting_thread.lock());
    });
}

struct EndsWatch<'a, 's>(&'a Files<'s>);

impl Drop for EndsWatch<'_, '_> {
    fn drop(&mut self) {
        self.0.watch_no_more();
    }
}

fn let_trees_go_behind<'a, 's>(files: &'a Files<'s>, listed: &[FileId]) -> EndsWatch<'a, 's> {
    files.let_trees_go_behind(listed);
    EndsWatch(files)
}

fn check_and_let_trees_go(
    program: &TestProgram<'_, '_>,
    to_check: Vec<FileId>,
    pass: PassOptions,
) -> Report {
    let options = PassOptions {
        frees_trees: true,
        ..pass
    };
    run_pass_over(program, to_check, options, &|_| Requested::All, &|_, _| {})
}

const LONGEST_WAIT: Duration = Duration::from_secs(60);

fn wait_until_tree_is_gone(files: &Files<'_>, file: FileId) -> Option<()> {
    let began = Instant::now();
    while !files.is_tree_gone(file) {
        if files.is_tree_kept(file) {
            return None;
        }
        assert!(began.elapsed() < LONGEST_WAIT, "the trees of {file:?} stay");
        drop(ReadingTask::begin());
        std::thread::sleep(Duration::from_millis(1));
    }
    Some(())
}

fn ask_until_answered<T>(ask: fn() -> Option<T>) -> T {
    const MOST_ATTEMPTS: usize = 100;
    let answer = (0..MOST_ATTEMPTS).find_map(|_| ask());
    answer.expect("the trees stay for good every time")
}

fn is_tree_of_last_file_gone(is_last_pass: bool) -> bool {
    let files = [
        ("main.ts", "import \"./last.ts\";\nimport \"./short.ts\";\n"),
        ("last.ts", "export const two = 1 + 1;\n"),
        ("short.ts", "export const one = 1;\n"),
    ];
    with_program(&files, &["./main.ts"], 4, |program| {
        let last = program.file("last.ts");
        let committed = Guarded::new(0usize);
        let has_committed = Condvar::new();
        let all = program.files().modules.len();
        let mut to_check: Vec<FileId> = (0..all as u32).map(FileId).collect();
        to_check.shared_sort_by_key(|&file| program.files().rank_of_file(file));
        let _watch = let_trees_go_behind(program.files(), &to_check);
        run_queue(
            program.loaded,
            program.host,
            program.request,
            to_check,
            &FileWork {
                requested: &|_| Requested::All,
                after_file: Some(&|_, file| {
                    let mut committed = committed.lock();
                    while file == last && *committed + 1 < all {
                        has_committed.wait_guarded(&mut committed);
                    }
                }),
                after_commit: &|_| {
                    *committed.lock() += 1;
                    has_committed.notify_all();
                },
                beside_file: None,
                frees_tree: &|_| true,
                is_last_pass: &|| is_last_pass,
                note_cycles_entered: None,
                cycles_entered_before: &Default::default,
                first_round: LOWERING_ROUNDS,
                left_out_bodies: None,
            },
        );
        program.files().is_tree_gone(last)
    })
}

#[test]
fn the_tree_of_the_last_file_of_the_last_pass_stays() {
    assert!(!is_tree_of_last_file_gone(true));
}

fn codes_reported_for_an_import_without_types() -> Option<Vec<u32>> {
    let files = [
        (
            "main.ts",
            "import \"./a.ts\";\nimport \"./far.ts\";\nimport \"./late.ts\";\n",
        ),
        ("a.ts", "export const first = [1].join();\n"),
        ("far.ts", "export const far = [1, 2, 3].join();\n"),
        (
            "late.ts",
            "import { x } from \"untyped\";\nexport const text: string = String(x);\n",
        ),
        (
            "node_modules/untyped/package.json",
            "{ \"name\": \"untyped\", \"version\": \"1.0.0\", \"main\": \"index.js\" }",
        ),
        ("node_modules/untyped/index.js", "exports.x = 1;\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let [far, late] = ["far.ts", "late.ts"].map(|path| program.file(path));
        let files = program.files();
        let _watch = let_trees_go_behind(files, &[far, late]);
        {
            let _task = ReadingTask::begin();
            files.note_commit(far);
        }
        wait_until_tree_is_gone(files, far)?;
        let report = check_and_let_trees_go(program, vec![late], LOWERING_PASS);
        Some(codes_reported(&report, late))
    })
}

#[test]
fn an_import_of_a_package_without_types_reads_no_tree_that_is_gone() {
    let codes = ask_until_answered(codes_reported_for_an_import_without_types);
    assert!(codes.contains(&7016), "{codes:?}");
}

fn check_file_that_reaches_a_tree_through_types() -> Option<()> {
    let files = [
        (
            "main.ts",
            "import \"./a\";\nimport \"./mid\";\nimport \"./near\";\n\
             import \"./late\";\nimport \"./rest\";\n",
        ),
        ("a.ts", "export const first = [1].join();\n"),
        (
            "far.ts",
            "export interface Far { far: number }\nexport const far: Far = { far: 1 };\n",
        ),
        (
            "mid.ts",
            "import { far } from \"./far\";\nexport const mid = far;\n",
        ),
        ("near.ts", "export const near = [1, 2, 3];\n"),
        (
            "late.ts",
            "import { mid } from \"./mid\";\nexport const late: number = mid.far;\n",
        ),
        ("rest.ts", "export const rest = [4];\n"),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let [far, mid, near, late, rest] =
            ["far.ts", "mid.ts", "near.ts", "late.ts", "rest.ts"].map(|path| program.file(path));
        let files = program.files();
        let before_late = vec![far, mid, near];
        let rank = |file: &FileId| files.rank_of_file(*file);
        assert!(before_late.is_sorted_by_key(rank));
        let _watch = let_trees_go_behind(files, &[far, mid, near, late, rest]);
        check_and_let_trees_go(program, before_late, ROLE_PASS);
        wait_until_tree_is_gone(files, near)?;
        assert!(!files.is_tree_gone(far));
        let report = check_and_let_trees_go(program, vec![late], LOWERING_PASS);
        let codes = codes_reported(&report, late);
        assert!(codes.is_empty(), "{codes:?}");
        wait_until_tree_is_gone(files, far)
    })
}

#[test]
fn a_tree_reached_through_the_types_of_another_file_stays_until_its_reader_is_committed() {
    ask_until_answered(check_file_that_reaches_a_tree_through_types);
}

#[test]
fn a_search_of_every_module_that_cannot_end_stops_at_once() {
    const MODULES: usize = 30;
    let names: Vec<String> = (0..MODULES).map(|index| format!("m{index}")).collect();
    let imports = ["asks", "asks-too"].into_iter();
    let imports: Vec<String> = imports
        .chain(names.iter().map(|it| &it[..]))
        .map(|name| format!("import \"./{name}\";\n"))
        .chain(["import \"./ring.cjs\";\n".to_owned()])
        .collect();
    let exports_base = |name: &str| format!("export {{ base as {name} }} from \"./base\";\n");
    let mut sources = vec![
        ("main.ts".to_owned(), imports.concat()),
        ("base.ts".to_owned(), "export const base = 1;\n".to_owned()),
        ("asks.ts".to_owned(), exports_base("asks")),
        ("asks-too.ts".to_owned(), exports_base("too")),
        (
            "ring.cjs".to_owned(),
            "exports.name = 1;\nmodule.exports = exports.default;\n".to_owned(),
        ),
    ];
    sources.extend(
        names
            .iter()
            .map(|name| (format!("{name}.ts"), exports_base(name))),
    );
    let files: Vec<(&str, &str)> = sources.iter().map(|it| (&it.0[..], &it.1[..])).collect();
    with_program(&files, &["./main.ts"], 2, |program| {
        let asking = ["asks.ts", "asks-too.ts"].map(|path| program.file(path));
        let searches = Guarded::new(Vec::new());
        check_all_files(program, LOWERING_PASS, &|checker, file| {
            if !asking.contains(&file) {
                return;
            }
            let mut searches = searches.lock();
            if searches.len() < asking.len() {
                checker.set_first_in_order(false, false);
            }
            let searched = checker.search_exports_of_every_module();
            searches.push((searched, checker.was_discarded()));
        });
        let searches: Vec<(usize, bool)> = searches.lock().clone();
        let [(first, true), rest @ .., (_, false)] = &searches[..] else {
            panic!("{searches:?}");
        };
        assert!(*first > MODULES, "{searches:?}");
        let discarded: Vec<usize> = (searches.iter().zip(&searches[1..]))
            .filter(|(_, next)| next.1)
            .map(|(before, next)| next.0 - before.0)
            .collect();
        assert!(!rest.is_empty() && !discarded.is_empty(), "{searches:?}");
        assert!(
            discarded.iter().all(|&searched| searched == 1),
            "{searches:?}"
        );
    });
}

const TYPE_THAT_ITS_READER_DOES_NOT_IMPORT: [(&str, &str); 3] = [
    ("hidden.ts", "export interface Hidden { h: number }\n"),
    ("again.ts", "export type { Hidden } from \"./hidden\";\n"),
    (
        "maker.ts",
        "import type { Hidden } from \"./hidden\";\n\
         export function make(): Hidden { return { h: 1 }; }\n",
    ),
];

const MESSAGE_ABOUT_THAT_TYPE: &str = "import { make } from \"./maker\";\n\
     function take(count: number) { return count; }\ntake({ a: make() });\n";

#[test]
fn a_message_of_a_build_searches_no_module() {
    let main = format!("import \"./other\";\n{MESSAGE_ABOUT_THAT_TYPE}");
    let mut files = TYPE_THAT_ITS_READER_DOES_NOT_IMPORT.to_vec();
    files.push(("other.ts", "import \"./again\";\nexport {};\n"));
    files.push(("main.ts", &main[..]));
    with_program(&files, &["./main.ts"], 1, |program| {
        let searched = AtomicUsize::new(0);
        let report = check_all_files(program, LOWERING_PASS, &|checker, _| {
            searched.store(checker.modules_searched_for_exports(), Ordering::Relaxed);
        });
        assert_eq!(searched.load(Ordering::Relaxed), 0);
        assert_eq!(codes_reported(&report, program.file("main.ts")), [2345]);
    });
}

fn codes_reported_about_a_type_that_a_gone_module_exports_again() -> Option<Vec<u32>> {
    let mut files = TYPE_THAT_ITS_READER_DOES_NOT_IMPORT.to_vec();
    files.extend([
        (
            "main.ts",
            "import \"./a\";\nimport \"./again\";\nimport \"./late\";\n",
        ),
        ("a.ts", "export const first = [1].join();\n"),
        ("late.ts", MESSAGE_ABOUT_THAT_TYPE),
    ]);
    with_program(&files, &["./main.ts"], 1, |program| {
        let [again, late] = ["again.ts", "late.ts"].map(|path| program.file(path));
        let files = program.files();
        let _watch = let_trees_go_behind(files, &[again, late]);
        {
            let _task = ReadingTask::begin();
            files.note_commit(again);
        }
        wait_until_tree_is_gone(files, again)?;
        let report = check_and_let_trees_go(program, vec![late], LOWERING_PASS);
        Some(codes_reported(&report, late))
    })
}

#[test]
fn a_message_about_a_type_that_its_file_does_not_import_reads_no_tree_that_is_gone() {
    let codes = ask_until_answered(codes_reported_about_a_type_that_a_gone_module_exports_again);
    assert_eq!(codes, [2345]);
}

#[test]
fn last_call_counts() {
    let files = [
        (
            "a.ts",
            r#"import type { B } from "./b";
            export interface A<T> { b: B<T>; f(x: T): void }"#,
        ),
        (
            "b.ts",
            r#"import type { A } from "./a";
            export interface B<T> { a: A<T>; g(): T }"#,
        ),
        (
            "assigns-a.ts",
            r#"import type { A } from "./a";
            declare const source: A<string>;
            export const target: A<unknown> = source;"#,
        ),
        (
            "assigns-b.ts",
            r#"import type { B } from "./b";
            declare const source: B<string>;
            export const target: B<unknown> = source;"#,
        ),
    ];
    with_program(
        &files,
        &["./assigns-a.ts", "./assigns-b.ts"],
        4,
        |program| {
            let modules = program.files().modules.iter();
            let calls: Vec<AtomicUsize> = modules.map(|_| AtomicUsize::new(0)).collect();
            let build = check(program, &|_, file| {
                calls[file.idx()].fetch_add(1, Ordering::Relaxed) + 1
            });
            let mut expected = ["assigns-a.ts", "assigns-b.ts"].map(|path| {
                let file = program.file(path);
                (file, calls[file.idx()].load(Ordering::Relaxed))
            });
            expected.shared_sort_unstable();
            assert!(expected.iter().all(|&(_, count)| count != 0));
            assert_eq!(build.program.lowered, expected);
        },
    );
}

#[test]
fn requested_diagnostics_are_per_file() {
    let type_error = "export const wrong: string = 1;\n";
    let files = [
        ("main.ts", "import \"./all.ts\";\nimport \"./types.ts\";\n"),
        ("all.ts", type_error),
        ("types.ts", type_error),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let (all, types) = (program.file("all.ts"), program.file("types.ts"));
        let requested = |file: FileId| match file == types {
            true => Requested::Types,
            false => Requested::All,
        };
        let report = run_pass(program, LOWERING_PASS, &requested, &|_, _| {});
        assert_eq!(count_reported(&report, all, 2322), 1);
        assert_eq!(count_reported(&report, types, 2322), 0);
    });
}

fn overflow_stack(checker: &mut Checker<'_, '_>, file: FileId) {
    checker.set_stack_limit(0);
    checker.set_requested(Requested::All);
    checker.check_file(file);
    checker.begin_stack_budget();
}

#[test]
fn stack_overflow_in_after_file_is_not_incomplete() {
    let (open, close) = ("(".repeat(50), ")".repeat(50));
    let deep_text = format!("export const deep = {open}1{close};");
    let next_text = format!(
        "import {{ deep }} from \"./deep\";\n\
         export const next = {open}deep{close};"
    );
    let files = [("deep.ts", &deep_text[..]), ("next.ts", &next_text[..])];
    with_program(&files, &["./next.ts"], 1, |program| {
        let (deep, next) = (program.file("deep.ts"), program.file("next.ts"));
        let rank_of = |file: FileId| program.files().rank_of_file(file);
        assert!(rank_of(deep) < rank_of(next));
        let overflows = AtomicUsize::new(0);
        let report = check_all_files(program, LOWERING_PASS, &|checker, file| {
            if file == deep || file == next {
                overflow_stack(checker, file);
                let has_overflowed = checker.take_ran_out_of_stack();
                overflows.fetch_add(usize::from(has_overflowed), Ordering::Relaxed);
                overflow_stack(checker, file);
            }
        });
        let last_round = report.rounds.last().expect("the queue has run");
        assert_eq!(report.rounds.len(), 2);
        assert_eq!((last_round.tasks, last_round.files), (1, 2));
        assert_eq!(overflows.load(Ordering::Relaxed), 4);
        assert!(report.incomplete.is_empty());
    });
}

fn is_tree_freed(frees_trees: bool) -> bool {
    let text = "export const a = 1;";
    with_program(&[("main.ts", text)], &["./main.ts"], 1, |program| {
        let (files, main) = (program.files(), program.file("main.ts"));
        assert!(files.module(main).is_leaf);
        assert!(!files.hir(main).stmts.is_empty());
        let options = PassOptions {
            frees_trees,
            ..LOWERING_PASS
        };
        check_all_files(program, options, &|_, _| {});
        assert_eq!(&*files.hir(main).text, text.as_bytes());
        files.hir(main).stmts.is_empty()
    })
}

#[test]
fn trees_stay_without_frees_trees() {
    assert!(!is_tree_freed(false));
    assert!(is_tree_freed(true));
}

#[test]
fn aliases_of_an_export_table_are_listed_once() {
    const NAMESPACES: usize = 6;
    const ERRORS: usize = 5;
    let lines = |count: usize, line: &dyn Fn(usize) -> String| -> String {
        (0..count).map(line).collect::<Vec<String>>().join("\n")
    };
    let mut sources = vec![
        (
            "hidden.ts".to_owned(),
            lines(ERRORS, &|i| {
                format!("export interface H{i} {{ h{i}: number }}")
            }),
        ),
        (
            "makers.ts".to_owned(),
            format!(
                "import type * as hidden from \"./hidden\";\n{}",
                lines(ERRORS, &|i| format!(
                    "export function make{i}(): hidden.H{i} {{ return {{ h{i}: {i} }}; }}"
                ))
            ),
        ),
        (
            "main.ts".to_owned(),
            format!(
                "{}\nimport * as makers from \"./makers\";\nexport type Uses = [{}];\n{}\n",
                lines(NAMESPACES, &|k| format!(
                    "import * as X{k} from \"./n{k}\";"
                )),
                (0..NAMESPACES)
                    .map(|k| format!("X{k}.N{k}"))
                    .collect::<Vec<String>>()
                    .join(", "),
                lines(ERRORS, &|i| format!(
                    "export const c{i}: number = {{ a: makers.make{i}() }};"
                )),
            ),
        ),
    ];
    sources.extend((0..NAMESPACES).map(|k| {
        (
            format!("n{k}.ts"),
            format!("export interface N{k} {{ p: number }}\n"),
        )
    }));
    let files: Vec<(&str, &str)> = sources.iter().map(|it| (&it.0[..], &it.1[..])).collect();
    with_program(&files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let read = AtomicUsize::new(0);
        let report = check_all_files(program, LOWERING_PASS, &|checker, file| {
            if file == main {
                read.store(checker.tables_read_for_aliases(), Ordering::Relaxed);
            }
        });
        assert_eq!(count_reported(&report, main, 2322), ERRORS);
        let read = read.load(Ordering::Relaxed);
        assert!(
            (NAMESPACES..=NAMESPACES + 3).contains(&read),
            "{read} tables"
        );
    });
}

#[test]
fn task_numbers_differ_between_passes() {
    let files = [
        ("f.ts", "export function f() {\n  return 1;\n}\n"),
        (
            "main.ts",
            "import { f } from \"./f.ts\";\nexport const a: string = f();\n",
        ),
    ];
    for threads in [1, 4] {
        with_program(&files, &["./main.ts"], threads, |program| {
            let main = program.file("main.ts");
            let first = check_all_files(program, ROLE_PASS, &|_, _| {});
            let second = check_all_files(program, LOWERING_PASS, &|_, _| {});
            assert_eq!(count_reported(&first, main, 2322), 1, "{threads} threads");
            assert_eq!(count_reported(&second, main, 2322), 1, "{threads} threads");
            assert_eq!(first.diagnostics.len(), second.diagnostics.len());
        });
    }
}
