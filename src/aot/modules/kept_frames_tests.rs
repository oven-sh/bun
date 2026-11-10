use bun_sema::bind::Parent;
use bun_sema::import_sites::ends_in_call_that_reads_frame_of_caller;

use crate::modules::testing::{file_named, member_named, with_test_run_graph};

/// Whether `function` keeps its frame for the call of `method` that it ends in.
fn keeps_frame_in(head: &str, function: &str, method: &str) -> bool {
    let text = format!("{head} export const actual = {function};");
    let files = [
        ("a.test.ts", text.as_str()),
        ("dep.cjs", "module.exports = 1;"),
    ];
    with_test_run_graph(&files, |_, input| {
        let file = file_named(input, "a.test.ts");
        let (hir, bound) = (input.files.hir(file), input.files.bound(file));
        let Parent::Expr(call) = bound.parent_of_expr(member_named(input, file, method)) else {
            panic!("the member is called");
        };
        ends_in_call_that_reads_frame_of_caller(hir, bound, call)
    })
}

fn keeps_frame(head: &str, receiver: &str) -> bool {
    let function = format!("() => {receiver}.requireActual('./dep.cjs')");
    keeps_frame_in(head, &function, "requireActual")
}

fn keeps_frame_of_mock_module(head: &str, receiver: &str) -> bool {
    let function = format!("() => {receiver}.module('./dep.cjs', () => ({{}}))");
    keeps_frame_in(head, &function, "module")
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
fn frame_is_kept_for_module_of_the_mock_that_an_import_binds_and_of_no_other() {
    let keeps = keeps_frame_of_mock_module;
    assert!(keeps("import { mock } from 'bun:test';", "mock"));
    assert!(keeps(
        "import { mock as mockOfBun } from 'bun:test';",
        "mockOfBun"
    ));
    assert!(keeps("import { mock } from 'vitest';", "(mock as any)"));
    assert!(keeps("import { mock } from '@jest/globals';", "mock"));
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
    assert!(!keeps("", "mock"));
}

#[test]
fn mock_module_stays_a_tail_call_where_its_path_is_a_parameter_of_the_function() {
    let keeps =
        |function: &str| keeps_frame_in("import { mock } from 'bun:test';", function, "module");
    assert!(keeps(
        "() => { const path = './dep.cjs'; return mock.module(path, () => ({})); }"
    ));
    assert!(keeps(
        "(path: string) => () => mock.module(path, () => ({}))"
    ));
    assert!(keeps(
        "(path: string) => mock.module(String(path), () => ({}))"
    ));
    assert!(!keeps("(path: string) => mock.module(path, () => ({}))"));
    assert!(!keeps(
        "function (path: string) { return mock.module(path, () => ({})); }"
    ));
    assert!(!keeps(
        "(path: unknown) => mock.module(path as string, () => ({}))"
    ));
    assert!(!keeps(
        "({ path }: { path: string }) => mock.module(path, () => ({}))"
    ));
    assert!(!keeps(
        "(path = './dep.cjs') => mock.module(path, () => ({}))"
    ));
    assert!(!keeps(
        "(...given: [string, () => object]) => mock.module(...given)"
    ));
}
