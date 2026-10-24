use std::fmt::Write;

use bun_sema::hir::{FnKind, StmtKind};

use super::{analyze_source, first_field, is_field, storage_in};
use crate::lower::captures::{Capture, max_captures};
use crate::lower::scope::{Placement, Storage};

fn is_for_loop(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::For { .. })
}

fn storage_of_i(statements: &str) -> Storage {
    let source = format!("export function g(n, f) {{ {statements} }}");
    storage_in("main.mjs", &source, "i")
}

#[test]
fn loop_variable_is_copied() {
    let source = "export function g(n, f) { for (let i = 0; i < n; i++) f(() => i); }";
    analyze_source("main.mjs", source, |probe| {
        let statement = probe.first_statement(is_for_loop);
        let expected = Placement {
            storage: Storage::Local,
            has_local: true,
            is_immutable: false,
            is_shared: true,
        };
        assert_eq!(probe.placement_of("i"), expected);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("i")]);
        assert!(!probe.has_environment(probe.bound.own_scope(statement)));
        assert_eq!(probe.stored_in_loop(statement), [probe.binding("i")]);
    });
}

#[test]
fn top_level_loop_variable_is_copied() {
    let source = "export const list = []; for (let i = 0; i < 3; i++) list.push(() => i);";
    analyze_source("main.js", source, |probe| {
        assert_eq!(probe.placement_of("i").storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("i")]);
    });
}

#[test]
fn every_kind_of_store_in_the_update_is_allowed() {
    let updates = [
        "i += 2",
        "i = i + 1",
        "--i",
        "i++, i++",
        "[i] = [i + 1]",
        "({ i } = f(i))",
        "i = f(i)",
        "i += n ? 1 : 2",
    ];
    for update in updates {
        let statements = format!("for (let i = 0; i < n; {update}) f(() => i);");
        assert_eq!(storage_of_i(&statements), Storage::Local, "{update}");
    }
}

#[test]
fn closures_in_the_head_the_test_and_the_body_copy() {
    let loops = [
        "for (let i = 0, h = () => i; i < n; i++) f(h);",
        "for (let i = 0; f(() => i) < n; i++) {}",
        "for (let i = 0; i < n; i++) f(() => () => i);",
        "for (let i = 0; i < n; i++) f(class { m() { return i; } });",
        "for (let i = 0; i < n; i++) { for (let j = 0; j < n; f(() => i), j++) {} }",
    ];
    for statements in loops {
        assert_eq!(storage_of_i(statements), Storage::Local, "{statements}");
    }
    let generator = "export function* g(n) { for (let i = 0; i < n; i += yield) yield () => i; }";
    assert_eq!(storage_in("main.mjs", generator, "i"), Storage::Local);
}

#[test]
fn store_outside_the_update_needs_a_field() {
    let loops = [
        "for (let i = 0; i < n; i++) { f(() => i); i += 2; }",
        "for (let i = 0; i++ < n; i++) f(() => i);",
        "for (let i = 0, j = (i = 1); i < n; i++) f(() => i + j);",
        "for (let i = 0; i < n; i++) f(() => i++);",
        "for (let i = 0, h = () => i++; i < n; h()) f(() => i);",
        "for (let i = 0; i < n; ) { f(() => i); i++; }",
        "for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++, i++) f(() => i); }",
    ];
    for statements in loops {
        assert!(is_field(storage_of_i(statements)), "{statements}");
    }
}

#[test]
fn function_in_the_update_needs_a_field() {
    let updates = [
        "f(() => i), i++",
        "i++, f(() => i)",
        "i++, f(function () { return i; })",
        "i++, f({ m() { return i; } })",
        "i++, f(class { m() { return i; } })",
        "i++, f(() => n)",
    ];
    for update in updates {
        let statements = format!("for (let i = 0; i < n; {update}) f(() => i);");
        assert!(is_field(storage_of_i(&statements)), "{update}");
    }
}

#[test]
fn variable_declared_elsewhere_needs_a_field() {
    let loops = [
        "for (var i = 0; i < n; i++) f(() => i);",
        "let i = 0; for (; i < n; i++) f(() => i);",
        "let i; for (i = 0; i < n; i++) f(() => i);",
        "let i = 0; for (let j = 0; j < n; j++, i++) f(() => i);",
        "let i = 0; while (i < n) { f(() => i); i++; }",
    ];
    for statements in loops {
        assert!(is_field(storage_of_i(statements)), "{statements}");
    }
}

#[test]
fn loop_variable_seen_by_eval_has_a_field() {
    let source = "export function g(n, f, s) { \
        for (let i = 0; i < n; i++) { f(() => i); eval(s); } }";
    analyze_source("main.mjs", source, |probe| {
        let placement = probe.placement_of("i");
        assert!(is_field(placement.storage));
        assert!(!placement.has_local && !placement.is_immutable);
    });
}

#[test]
fn dead_store_in_the_body_is_ignored() {
    let statements = "for (let i = 0; i < n; i++) { if (false) { i = 9; } f(() => i); }";
    assert_eq!(storage_of_i(statements), Storage::Local);
}

#[test]
fn each_variable_of_the_head_is_decided_alone() {
    let source = "export function g(n, f) { \
        for (let i = 0, j = 0; i < n; i++, j++) { f(() => i + j); j += 1; } }";
    analyze_source("main.mjs", source, |probe| {
        let scope = probe.bound.own_scope(probe.first_statement(is_for_loop));
        assert_eq!(probe.placement_of("i").storage, Storage::Local);
        let field = Storage::Field { scope, field: 0 };
        assert_eq!(probe.placement_of("j").storage, field);
        let expected = [Capture::Environment(scope), probe.copy_of("i")];
        assert_eq!(probe.captures(probe.arrow()), expected);
    });
}

#[test]
fn field_of_a_loop_variable_is_not_immutable() {
    let source = "export function g(n, f) { \
        for (let i = 0; i < n; i++) { function h() { return i; } f(h, () => i); } }";
    analyze_source("main.mjs", source, |probe| {
        let scope = probe.bound.own_scope(probe.first_statement(is_for_loop));
        let expected = first_field(scope, false);
        assert_eq!(probe.placement_of("i"), expected);
        assert_eq!(probe.captures_of("h"), [Capture::Environment(scope)]);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("i")]);
    });
}

#[test]
fn closure_over_the_capture_limit_takes_the_environment() {
    let (mut declarations, mut mentions) = (String::new(), String::new());
    for index in 0..max_captures() {
        let _ = write!(declarations, " const v{index} = {index};");
        let _ = write!(mentions, "v{index}, ");
    }
    let source = format!(
        "export function g(n, f) {{{declarations} \
         for (let i = 0; i < n; i++) f(() => [{mentions}i], () => i); }}"
    );
    analyze_source("main.mjs", &source, |probe| {
        let scope = probe.bound.own_scope(probe.first_statement(is_for_loop));
        let [all, one] = probe.functions(FnKind::Arrow)[..] else {
            panic!("the source has two arrow functions");
        };
        assert!(probe.has_too_many_captures(probe.key(all)));
        assert!(probe.captures(all).contains(&Capture::Environment(scope)));
        assert_eq!(probe.captures(one), [probe.copy_of("i")]);
        let placement = probe.placement_of("i");
        assert!(is_field(placement.storage));
        assert!(!placement.has_local && !placement.is_immutable);
    });
}
