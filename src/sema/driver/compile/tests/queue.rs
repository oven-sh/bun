use super::support::{TestProgram, check, with_program};
use crate::Report;
use crate::compile::FileWork;
use crate::compile::queue::{LOWERING_ROUNDS, ROLE_ROUNDS, run_queue};
use bun_sema::check::{Checker, Requested};
use bun_sema::program::{FileId, ReadingTask};
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
            note_cycles_entered: None,
            cycles_entered_before: &Default::default,
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
                note_cycles_entered: None,
                cycles_entered_before: &Default::default,
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

// `late.ts` is checked when the trees of `far.ts`, which it has nothing to do with, are packed away. Whether they still are, in the
// task that has checked it, which keeps what it reads until it ends, and behind it.
// None: the tests beside this one held every bit that a task can have, so the trees of `far.ts` stay for good.
fn are_trees_left_packed_away_by_an_import_without_types() -> Option<(Option<bool>, bool)> {
    let files = [
        (
            "main.ts",
            "import \"./a.ts\";\nimport \"./far.ts\";\nimport \"./late.ts\";\n",
        ),
        // Every task reads the file with the lowest number, which holds the symbol of `undefined`.
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
        files.let_trees_go_behind(&[far, late]);
        {
            let _task = ReadingTask::begin();
            files.note_commit(far);
        }
        // Trees wait for the tasks that began before the commit, and those of the tests beside this one count too. The end of any
        // task lets go what waits no more.
        while !files.is_tree_gone(far) {
            if files.is_tree_kept(far) {
                files.watch_no_more();
                return None;
            }
            drop(ReadingTask::begin());
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let is_gone_in_task = Guarded::new(None);
        let report = run_queue(
            program.loaded,
            program.host,
            program.request,
            vec![late],
            &FileWork {
                requested: &|_| Requested::All,
                after_file: Some(&|_, _| *is_gone_in_task.lock() = Some(files.is_tree_gone(far))),
                after_commit: &|_| {},
                beside_file: None,
                frees_tree: &|_| true,
                is_last_pass: &|| false,
                note_cycles_entered: None,
                cycles_entered_before: &Default::default,
                first_round: LOWERING_ROUNDS,
                left_out_bodies: None,
            },
        );
        let is_gone_behind = files.is_tree_gone(far);
        files.watch_no_more();
        let codes: Vec<u32> = (report.diagnostics.iter())
            .filter(|diagnostic| diagnostic.file == Some(late))
            .map(|diagnostic| diagnostic.code)
            .collect();
        assert!(codes.contains(&7016), "{codes:?}");
        Some((*is_gone_in_task.lock(), is_gone_behind))
    })
}

// The hint under the error says whether the program has `@types/untyped`, which every module is asked about. What is read of each is
// a list that stays when its trees go, so none has to come back.
#[test]
fn an_import_of_a_package_without_types_brings_no_tree_back() {
    let answer = std::iter::repeat_with(are_trees_left_packed_away_by_an_import_without_types);
    assert_eq!(answer.flatten().next(), Some((Some(true), true)));
}

// The first visit of `late.ts` is thrown away when the trees of `far.ts` are packed away. The queue then follows what `late.ts` imports,
// and what that imports, to see what the next visit has to wait for. How often the trees of `far.ts` come back from then on.
// None: they were not packed away yet. Trees wait for the tasks that began before the commit, and those of the tests beside this one
// count too.
fn times_trees_come_back_for_a_visit_thrown_away() -> Option<u32> {
    let files = [
        (
            "main.ts",
            "import \"./a.ts\";\nimport \"./far.ts\";\nimport \"./mid.ts\";\nimport \"./late.ts\";\n",
        ),
        // Every task reads the file with the lowest number, which holds the symbol of `undefined`.
        ("a.ts", "export const first = [1].join();\n"),
        ("far.ts", "export const far = [1, 2, 3].join();\n"),
        (
            "mid.ts",
            "import \"./far.ts\";\nexport const mid = [4].join();\n",
        ),
        (
            "late.ts",
            "import \"./mid.ts\";\nexport const late = [5].join();\n",
        ),
    ];
    with_program(&files, &["./main.ts"], 1, |program| {
        let [far, mid, late] = ["far.ts", "mid.ts", "late.ts"].map(|path| program.file(path));
        let files = program.files();
        let to_check = vec![far, mid, late];
        let rank = |file: &FileId| files.rank_of_file(*file);
        assert!(to_check.is_sorted_by_key(rank));
        files.let_trees_go_behind(&to_check);
        let visits_of_late = AtomicUsize::new(0);
        let are_here = AtomicUsize::new(0);
        // The visit of `mid.ts`, which names `far.ts`, may have brought them back before.
        let times_before = AtomicUsize::new(0);
        run_queue(
            program.loaded,
            program.host,
            program.request,
            to_check,
            &FileWork {
                requested: &|_| Requested::All,
                after_file: Some(&|checker, file| {
                    if file != late || visits_of_late.fetch_add(1, Ordering::Relaxed) != 0 {
                        return;
                    }
                    // The end of any task lets go what waits no more. This is a thread of the pool that all tests share, so it
                    // does not wait here.
                    drop(ReadingTask::begin());
                    if !files.is_tree_gone(far) {
                        are_here.store(1, Ordering::Relaxed);
                        return;
                    }
                    times_before.store(files.times_tree_came_back(far) as usize, Ordering::Relaxed);
                    checker.discard_until_recheck();
                }),
                after_commit: &|_| {},
                beside_file: None,
                frees_tree: &|_| true,
                is_last_pass: &|| false,
                note_cycles_entered: None,
                cycles_entered_before: &Default::default,
                first_round: LOWERING_ROUNDS,
                left_out_bodies: None,
            },
        );
        let times = files.times_tree_came_back(far) - times_before.load(Ordering::Relaxed) as u32;
        files.watch_no_more();
        if are_here.load(Ordering::Relaxed) != 0 {
            return None;
        }
        assert_eq!(visits_of_late.load(Ordering::Relaxed), 2);
        Some(times)
    })
}

// Of each file it reads the list of what the file imports, which stays when the trees go, so none has to come back.
#[test]
fn a_visit_that_is_thrown_away_brings_no_tree_back() {
    let answer = std::iter::repeat_with(|| {
        let answer = times_trees_come_back_for_a_visit_thrown_away();
        if answer.is_none() {
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        answer
    });
    assert_eq!(answer.flatten().next(), Some(0));
}

// `asks.ts` and `asks-too.ts` are visited by tasks that aren't the first in program order, and each looks through the exports of
// every module. In `ring.cjs`, late in the program, `module.exports = exports.default` leads back to itself. Only the first file that
// leads to such a cycle may enter it, so both tasks are discarded. The second goes straight to the module that stopped the first.
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

// The message says that `{ a: Hidden }` is no number. The file doesn't import `Hidden`, nor a module that exports it, so every
// module of the program is searched for one that does. `line_before`: what stands on the line before the error. Returns how
// many modules were searched and how many diagnostics the file reports.
fn modules_searched_for_a_message(main: &str, line_before: &str) -> (usize, usize) {
    let take = match main.ends_with(".ts") {
        true => "function take(count: number) { return count; }",
        false => "/** @param {number} count */\nfunction take(count) { return count; }",
    };
    let text = format!(
        "import {{ make }} from \"./maker\";\n{take}\n{line_before}\ntake({{ a: make() }});\n"
    );
    let files = [
        ("hidden.ts", "export interface Hidden { h: number }\n"),
        ("again.ts", "export type { Hidden } from \"./hidden\";\n"),
        (
            "maker.ts",
            "import \"./again\";\nimport type { Hidden } from \"./hidden\";\n\
             export function make(): Hidden { return { h: 1 }; }\n",
        ),
        (main, &text[..]),
    ];
    with_program(&files, &[&format!("./{main}")], 1, |program| {
        let main = program.file(main);
        let searched = AtomicUsize::new(0);
        let report = check_all_files(program, LOWERING_PASS, &|checker, _| {
            searched.store(checker.modules_searched_for_exports(), Ordering::Relaxed);
        });
        let in_main = report.diagnostics.iter().filter(|it| it.file == Some(main));
        (searched.load(Ordering::Relaxed), in_main.count())
    })
}

#[test]
fn a_message_that_nobody_reads_searches_no_module() {
    let (searched, reported) = modules_searched_for_a_message("main.ts", "");
    assert!(searched != 0, "{searched} modules");
    assert_eq!(reported, 1);
    for (main, line_before) in [
        ("main.ts", "// @ts-expect-error"),
        ("main.ts", "// @ts-ignore"),
        ("main.ts", "if (false)"),
        ("main.js", ""),
    ] {
        let searched = modules_searched_for_a_message(main, line_before);
        assert_eq!(searched, (0, 0), "{main} {line_before}");
    }
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
