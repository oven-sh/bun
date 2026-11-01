use super::support::{TestProgram, check, with_program};
use crate::Report;
use crate::compile::FileWork;
use crate::compile::queue::{LOWERING_ROUNDS, ROLE_ROUNDS, run_queue};
use bun_sema::check::{Checker, Requested};
use bun_sema::program::FileId;
use bun_sema::util::SharedSort;
use bun_threading::{Condvar, Guarded};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::ThreadId;

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

fn run_pass<'s>(
    program: &TestProgram<'_, 's>,
    options: PassOptions,
    requested: &(dyn Fn(FileId) -> Requested + Sync),
    after_file: &(dyn Fn(&mut Checker<'_, 's>, FileId) + Sync),
) -> Report {
    let files = program.files();
    let mut to_check: Vec<FileId> = (0..files.modules.len() as u32).map(FileId).collect();
    to_check.shared_sort_by_key(|&file| files.rank_of_file(file));
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
            first_round: options.first_round,
            left_out_bodies: None,
        },
    )
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

fn is_tree_of_last_file_packed_away(is_last_pass: bool) -> bool {
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
        program.files().let_trees_go_behind(&to_check);
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
                first_round: LOWERING_ROUNDS,
                left_out_bodies: None,
            },
        );
        let is_gone = program.files().is_tree_gone(last);
        program.files().watch_no_more();
        is_gone
    })
}

#[test]
fn the_tree_of_the_last_file_of_the_last_pass_is_not_packed_away() {
    assert!(!is_tree_of_last_file_packed_away(true));
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
        // Each error is about an object literal that holds a type the file doesn't import, which is looked for among
        // the exports of every namespace that it does import.
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
        // The exports of each namespace, of `makers` and of the file itself, and the globals.
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
