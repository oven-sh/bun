#![cfg(not(miri))]

use super::*;
use crate::hir::StmtId;
use crate::program::code_test_host::{StatementsHost, TestBuild, load_files};
use crate::program::few_in;
use crate::session::Session;

/// Running tasks and awaited commits are counted for the whole process.
static ONE_TEST_AT_A_TIME: Guarded<()> = Guarded::new(());

// Each file here has an import, which makes it a module. Every file can see what a script declares, so a script's trees
// are never freed. The first file of a program keeps its trees too, and here that is `a.ts` or `b.ts`.
// No code loads `far.ts`, so a build would not list it for `let_trees_go_behind`, and neither does any test.
// Trees are freed only while a listed file is still uncommitted, so `rest.ts` is committed last or never.
const SOURCES: &[(&str, &str)] = &[
    (
        "/main.ts",
        "import \"./a\"\n\
         import \"./first\"\n\
         import \"./second\"\n\
         import \"./late\"\n\
         import \"./one\"\n\
         import \"./barrel\"\n\
         import \"./rest\"",
    ),
    ("/a.ts", "import \"./b\""),
    ("/b.ts", "import \"./a\""),
    ("/first.ts", "import \"./a\""),
    ("/second.ts", "import \"./a\""),
    ("/late.ts", "import \"./mid\""),
    ("/mid.ts", "import type far from \"./far\""),
    ("/far.ts", "import \"./a\""),
    ("/one.ts", "import \"./two\""),
    ("/two.ts", "import \"./one\""),
    ("/barrel.ts", "import \"./x\""),
    ("/x.ts", "import \"./a\""),
    ("/rest.ts", "import \"./a\""),
];

struct Program<'a, 's> {
    files: &'a Files<'s>,
}

// The list of watched cells belongs to the whole process, so a test removes its own cells even when it fails.
impl Drop for Program<'_, '_> {
    fn drop(&mut self) {
        self.files.watch_no_more();
    }
}

impl Program<'_, '_> {
    fn file(&self, path: &str) -> FileId {
        let file = self.files.by_path.get(path.as_bytes());
        file.expect("it is loaded")
    }

    fn let_trees_go_behind(&self, paths: &[&str]) {
        let listed: Vec<FileId> = paths.iter().map(|path| self.file(path)).collect();
        self.files.let_trees_go_behind(&listed);
    }

    fn commit_in_a_task(&self, paths: &[&str]) {
        let _task = ReadingTask::begin();
        for path in paths {
            self.files.note_commit(self.file(path));
        }
    }

    fn states_of<const N: usize>(&self, paths: [&str; N]) -> [u8; N] {
        paths.map(|path| self.files.modules[self.file(path).idx()].state.load(SeqCst))
    }

    fn has_statements(&self, path: &str) -> bool {
        !self.files.modules[self.file(path).idx()]
            .hir
            .stmts
            .is_empty()
    }
}

fn with_program(test: impl FnOnce(&Program<'_, '_>)) {
    with_export_stars_in(&[], test);
}

// The host parses no `export`. An `import "./x"` refers to `x.ts` as `export * from "./x"` does, and this is what the
// binder leaves for that statement.
fn note_export_star(files: &mut Files<'_>, path: &str) {
    let file = files.by_path.get(path.as_bytes()).expect("it is loaded");
    let arena = files.arena;
    let bound = &mut files.modules[file.idx()].bound;
    bound.export_stars = few_in(vec![(bound.file_symbol, StmtId(0))], arena);
}

fn with_export_stars_in(paths: &[&str], test: impl FnOnce(&Program<'_, '_>)) {
    let _alone = ONE_TEST_AT_A_TIME.lock();
    let host = StatementsHost {
        files: SOURCES,
        ..StatementsHost::default()
    };
    let session = Session::new();
    let mut files = load_files(&session, &TestBuild::new(&host, &["/main.ts"]));
    for path in paths {
        note_export_star(&mut files, path);
    }
    test(&Program { files: &files });
}

#[test]
fn trees_go_while_a_file_is_left_to_lower_and_none_behind_the_last() {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/first.ts", "/second.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/main.ts", "/first.ts"]);
        assert_eq!(program.states_of(["/first.ts"]), [GONE]);

        let spans_the_rest = ReadingTask::begin();
        program.commit_in_a_task(&["/second.ts"]);
        assert_eq!(program.states_of(["/second.ts"]), [HERE]);
        program.files.note_commit(program.file("/rest.ts"));
        drop(spans_the_rest);
        assert_eq!(program.states_of(["/second.ts", "/rest.ts"]), [HERE, HERE]);

        program.files.watch_no_more();
        assert_eq!(AWAITED_COMMITS.load(SeqCst), 0);
    });
}

// `late.ts` imports only `mid.ts`, but a type that it finds there leads its task into `far.ts`.
#[test]
fn a_tree_stays_until_every_file_that_can_reach_it_is_committed() {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/late.ts", "/mid.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/main.ts", "/mid.ts"]);
        assert_eq!(
            program.states_of(["/main.ts", "/mid.ts", "/far.ts"]),
            [GONE, HERE, HERE]
        );
        {
            let _task = ReadingTask::begin();
            assert!(program.has_statements("/far.ts"));
            program.files.note_commit(program.file("/late.ts"));
        }
        assert_eq!(
            program.states_of(["/late.ts", "/mid.ts", "/far.ts"]),
            [GONE, GONE, GONE]
        );
    });
}

#[test]
fn files_that_import_each_other_go_together() {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/one.ts", "/two.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/main.ts", "/one.ts"]);
        assert_eq!(program.states_of(["/one.ts", "/two.ts"]), [HERE, HERE]);
        program.commit_in_a_task(&["/two.ts"]);
        assert_eq!(program.states_of(["/one.ts", "/two.ts"]), [GONE, GONE]);
    });
}

fn states_once_barrel_and_x_are_committed(program: &Program<'_, '_>) -> [u8; 3] {
    program.let_trees_go_behind(&["/main.ts", "/barrel.ts", "/x.ts", "/rest.ts"]);
    program.commit_in_a_task(&["/main.ts", "/barrel.ts", "/x.ts"]);
    program.states_of(["/main.ts", "/barrel.ts", "/x.ts"])
}

#[test]
fn a_file_with_an_export_star_stays_with_what_it_refers_to() {
    with_program(|program| {
        assert_eq!(
            states_once_barrel_and_x_are_committed(program),
            [GONE, GONE, GONE]
        );
    });
    with_export_stars_in(&["/barrel.ts"], |program| {
        assert_eq!(
            states_once_barrel_and_x_are_committed(program),
            [GONE, HERE, HERE]
        );
    });
}

fn with_trees_of_first_gone(test: impl FnOnce(&Program<'_, '_>)) {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/first.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/main.ts", "/first.ts"]);
        assert_eq!(program.states_of(["/first.ts"]), [GONE]);
        test(program);
    });
}

#[test]
#[should_panic(expected = "the trees of /first.ts are read after they were freed")]
fn a_task_that_reads_trees_that_are_gone_panics() {
    with_trees_of_first_gone(|program| {
        let _task = ReadingTask::begin();
        program.has_statements("/first.ts");
    });
}

#[test]
#[should_panic(expected = "the trees of /first.ts are read after they were freed")]
fn trees_that_are_gone_do_not_come_back_when_the_watch_ends() {
    with_trees_of_first_gone(|program| {
        program.files.watch_no_more();
        assert_eq!(program.states_of(["/first.ts"]), [GONE]);
        program.has_statements("/first.ts");
    });
}

#[test]
#[should_panic(expected = "the trees of /first.ts are read after they were freed")]
fn keeping_trees_that_are_gone_panics() {
    with_trees_of_first_gone(|program| program.files.keep_tree(program.file("/first.ts")));
}

#[test]
fn what_stays_of_a_file_is_read_when_its_trees_are_gone() {
    with_trees_of_first_gone(|program| {
        let _reading = ReadingNoTrees::begin();
        let first = &program.files.modules[program.file("/first.ts").idx()];
        assert_eq!(first.file_name(), b"/first.ts");
    });
}

// `second.ts` shows that trees went. No task runs when the statements are read.
fn assert_first_is_kept_behind_all_commits(program: &Program<'_, '_>) {
    program.commit_in_a_task(&["/rest.ts"]);
    assert_eq!(program.states_of(["/first.ts", "/second.ts"]), [KEPT, GONE]);
    assert!(program.has_statements("/first.ts"));
}

#[test]
fn a_tree_kept_before_the_watch_stays_behind_all_commits() {
    with_program(|program| {
        program.files.keep_tree(program.file("/first.ts"));
        program.let_trees_go_behind(&["/main.ts", "/first.ts", "/second.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/main.ts", "/first.ts", "/second.ts"]);
        assert_first_is_kept_behind_all_commits(program);
    });
}

// The task has yet to commit `main.ts`, which refers to `first.ts`.
#[test]
fn a_tree_kept_by_a_task_that_can_reach_it_stays_behind_all_commits() {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/first.ts", "/second.ts", "/rest.ts"]);
        program.commit_in_a_task(&["/first.ts", "/second.ts"]);
        {
            let _task = ReadingTask::begin();
            program.files.keep_tree(program.file("/first.ts"));
            program.files.note_commit(program.file("/main.ts"));
        }
        assert_first_is_kept_behind_all_commits(program);
    });
}

// The watch ends when `first.ts` is committed and `main.ts`, which refers to it, is not.
#[test]
fn a_watch_that_ends_between_two_commits_awaits_no_commit() {
    with_program(|program| {
        let before = AWAITED_COMMITS.load(SeqCst);
        program.let_trees_go_behind(&["/first.ts", "/main.ts"]);
        program.commit_in_a_task(&["/first.ts"]);
        program.files.watch_no_more();
        assert_eq!(AWAITED_COMMITS.load(SeqCst), before);
    });
}

#[test]
fn trees_go_while_a_task_that_outlasts_the_others_runs() {
    with_program(|program| {
        program.let_trees_go_behind(&["/main.ts", "/first.ts", "/rest.ts"]);
        let long_task = ReadingTask::begin();
        // SAFETY: it has read nothing.
        unsafe { ReadingTask::repin() };
        program.commit_in_a_task(&["/main.ts", "/first.ts"]);
        assert_eq!(program.states_of(["/first.ts"]), [HERE]);

        // SAFETY: as above.
        unsafe { ReadingTask::repin() };
        drop(ReadingTask::begin());
        assert_eq!(program.states_of(["/first.ts"]), [GONE]);

        drop(long_task);
        program.files.watch_no_more();
        assert_eq!(AWAITED_COMMITS.load(SeqCst), 0);
    });
}

#[test]
fn a_watch_that_ends_early_awaits_no_commit() {
    with_program(|program| {
        let before = AWAITED_COMMITS.load(SeqCst);
        program.let_trees_go_behind(&["/main.ts"]);
        program.files.watch_no_more();
        assert_eq!(AWAITED_COMMITS.load(SeqCst), before);
    });
}
