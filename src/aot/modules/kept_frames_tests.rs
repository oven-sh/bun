use bun_sema::bind::Parent;
use bun_sema::import_sites::ends_in_call_that_reads_frame_of_caller;

use crate::modules::testing::{file_named, member_named, with_test_run_graph};

fn keeps_frame(head: &str, receiver: &str) -> bool {
    let text = format!("{head} export const actual = () => {receiver}.requireActual('./dep.cjs');");
    let files = [
        ("a.test.ts", text.as_str()),
        ("dep.cjs", "module.exports = 1;"),
    ];
    with_test_run_graph(&files, |_, input| {
        let file = file_named(input, "a.test.ts");
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let Parent::Expr(call) = bound.parent_of_expr(member_named(input, file, "requireActual"))
        else {
            panic!("the member is called");
        };
        ends_in_call_that_reads_frame_of_caller(hir, bound, call)
    })
}

#[test]
fn frame_is_kept_for_the_name_that_an_import_binds_and_for_no_other() {
    assert!(keeps_frame("import { jest } from 'bun:test';", "jest"));
    assert!(keeps_frame(
        "import { jest as runner } from 'bun:test';",
        "runner"
    ));
    assert!(keeps_frame(
        "import { jest } from '@jest/globals';",
        "(jest as any)"
    ));
    assert!(!keeps_frame(
        "import { jest } from 'bun:test'; const alias = jest;",
        "alias"
    ));
    assert!(!keeps_frame(
        "const { jest: required } = require('bun:test');",
        "required"
    ));
    assert!(!keeps_frame(
        "import * as runner from 'bun:test';",
        "runner.jest"
    ));
    assert!(!keeps_frame("import { vi } from 'bun:test';", "vi"));
}
