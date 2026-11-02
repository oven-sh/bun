#![cfg(not(miri))]

use super::*;
use crate::program::code_test_host::{StatementsHost, TestBuild, load_files};
use crate::session::Session;

/// The tasks and the commits that are awaited are those of the process.
static ONE_TEST_AT_A_TIME: Guarded<()> = Guarded::new(());

#[test]
fn trees_go_while_a_file_is_left_to_lower_and_none_behind_the_last() {
    let _alone = ONE_TEST_AT_A_TIME.lock();
    let host = StatementsHost {
        files: &[
            (
                "/main.ts",
                "import \"./first\"\nimport \"./second\"\nexport const main = [1, 2, 3]",
            ),
            ("/first.ts", "export const first = [1, 2, 3]"),
            ("/second.ts", "export const second = [1, 2, 3]"),
        ],
        ..StatementsHost::default()
    };
    let session = Session::new();
    let files = load_files(&session, &TestBuild::new(&host, &["/main.ts"]));
    let [main, first, second] = [&b"/main.ts"[..], b"/first.ts", b"/second.ts"]
        .map(|path| files.by_path.get(path).expect("it is loaded"));
    let state_of = |file: FileId| files.modules[file.idx()].state.load(SeqCst);

    files.let_trees_go_behind(&[main, first, second]);
    {
        let _task = ReadingTask::begin();
        files.note_commit(first);
    }
    assert_eq!(state_of(first), GONE);

    let spans_the_rest = ReadingTask::begin();
    {
        let _task = ReadingTask::begin();
        files.note_commit(second);
    }
    assert_eq!(state_of(second), HERE);
    files.note_commit(main);
    drop(spans_the_rest);
    assert_eq!([state_of(second), state_of(main)], [HERE, HERE]);

    files.watch_no_more();
    assert_eq!(AWAITED_COMMITS.load(SeqCst), 0);
}

#[test]
fn a_watch_that_ends_early_awaits_no_commit() {
    let _alone = ONE_TEST_AT_A_TIME.lock();
    let host = StatementsHost {
        files: &[("/main.ts", "export const main = [1, 2, 3]")],
        ..StatementsHost::default()
    };
    let session = Session::new();
    let files = load_files(&session, &TestBuild::new(&host, &["/main.ts"]));
    let main = files.by_path.get(b"/main.ts").expect("it is loaded");
    let before = AWAITED_COMMITS.load(SeqCst);
    files.let_trees_go_behind(&[main]);
    files.watch_no_more();
    assert_eq!(AWAITED_COMMITS.load(SeqCst), before);
}
