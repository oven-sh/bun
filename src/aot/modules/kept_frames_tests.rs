use bun_sema::bind::Parent;
use bun_sema::import_sites::ends_in_call_that_reads_frame_of_caller;

use crate::modules::testing::{file_named, member_named, with_test_run_graph};

fn keeps_frame_of(head: &str, returned: &str, member: &str) -> bool {
    let text = format!("{head} export const actual = () => {returned};");
    let files = [
        ("a.test.ts", text.as_str()),
        ("dep.cjs", "module.exports = 1;"),
    ];
    with_test_run_graph(&files, |_, input| {
        let file = file_named(input, "a.test.ts");
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let Parent::Expr(call) = bound.parent_of_expr(member_named(input, file, member)) else {
            panic!("the member is called");
        };
        ends_in_call_that_reads_frame_of_caller(hir, bound, call)
    })
}

fn keeps_frame(head: &str, receiver: &str) -> bool {
    let returned = format!("{receiver}.requireActual('./dep.cjs')");
    keeps_frame_of(head, &returned, "requireActual")
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

#[test]
fn frame_is_kept_for_mock_module_of_the_name_that_an_import_binds() {
    let keeps = |head: &str, receiver: &str| {
        let returned = format!("{receiver}.module('./dep.cjs', () => ({{}}))");
        keeps_frame_of(head, &returned, "module")
    };
    assert!(keeps("import { mock } from 'bun:test';", "mock"));
    assert!(keeps("import { mock as made } from 'bun:test';", "made"));
    assert!(keeps(
        "import { mock } from '@jest/globals';",
        "(mock as any)"
    ));
    assert!(!keeps(
        "import { mock } from 'bun:test'; const alias = mock;",
        "alias"
    ));
    assert!(!keeps(
        "const { mock: required } = require('bun:test');",
        "required"
    ));
    assert!(!keeps("import * as runner from 'bun:test';", "runner.mock"));
    assert!(!keeps("import { jest } from 'bun:test';", "jest"));
}

#[test]
fn frame_is_kept_for_mock_module_only_where_the_call_writes_the_path() {
    let keeps = |path: &str| {
        let head = "import { mock } from 'bun:test'; const top = './dep.cjs';";
        keeps_frame_of(
            head,
            &format!("mock.module({path}, () => ({{}}))"),
            "module",
        )
    };
    assert!(keeps("'./dep.cjs'"));
    assert!(keeps("`./dep.cjs`"));
    assert!(keeps("'./dep.cjs' as string"));
    assert!(keeps("'a-package'"));
    assert!(!keeps("top"));
    assert!(!keeps("`./${top}`"));
    assert!(!keeps("'./' + 'dep.cjs'"));
}

#[test]
fn frame_is_kept_for_the_statics_of_expect_that_ask_which_file_calls_them() {
    for member in ["addEqualityTesters", "addSnapshotSerializer"] {
        let keeps = |head: &str, receiver: &str| {
            keeps_frame_of(head, &format!("{receiver}.{member}([])"), member)
        };
        assert!(keeps("import { expect } from 'bun:test';", "expect"));
        assert!(keeps("import { expect as claim } from 'vitest';", "claim"));
        assert!(keeps("", "expect"));
        assert!(!keeps(
            "import { expect } from 'bun:test'; const alias = expect;",
            "alias"
        ));
        assert!(!keeps("import { mock } from 'bun:test';", "mock"));
    }
}
