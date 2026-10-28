use super::*;
use crate::builtins::RuntimeFunction;

// Each is cut into the part in front of the bar and the part behind it.
const HANDED_TO_THE_OTHER_PART: &[&str] = &[
    "const p = process;| function f() { return p.stdin; }",
    "function f() { return p.stdin; }| const p = process;",
    "let held; held = process;| function f() { return held.stdin; }",
    "function g(o) { return o.stdin; }| g(process);",
    "const { stdin } = process;| function f() { return stdin; }",
];

fn needs_of(source: &str, parts: Option<&[&str]>) -> (Vec<RuntimeModule>, Vec<RuntimeFunction>) {
    with_parts(RUNTIME, source, parts, |case| {
        let uses = case.resolved.uses();
        (uses.modules.to_vec(), uses.functions.to_vec())
    })
}

#[test]
fn the_parts_of_a_file_need_what_the_file_needs() {
    for cut in HANDED_TO_THE_OTHER_PART {
        let (first, second) = cut.split_once('|').unwrap();
        let source = format!("{first}{second}");
        let (modules, functions) = needs_of(&source, None);
        assert!(!modules.is_empty() && !functions.is_empty(), "{source}");
        let (first_modules, first_functions) = needs_of(&source, Some(&[first]));
        let (second_modules, second_functions) = needs_of(&source, Some(&[second]));
        let has_module =
            |it: &RuntimeModule| first_modules.contains(it) || second_modules.contains(it);
        let has_function =
            |it: &RuntimeFunction| first_functions.contains(it) || second_functions.contains(it);
        assert!(modules.iter().all(has_module), "{source}");
        assert!(functions.iter().all(has_function), "{source}");
    }
}

#[test]
fn a_binding_that_stays_in_its_part_is_followed() {
    let source = "function f() { const p = process; return p.pid; } function g() { return 1; }";
    with_parts(
        RUNTIME,
        source,
        Some(&["function f() { const p = process; return p.pid; }"]),
        |case| {
            assert!(case.mentions(BuiltinId::ProcessPid));
            assert!(!case.exposes(BuiltinId::Process));
        },
    );
}

#[test]
fn a_part_pays_for_its_own_expressions_alone() {
    let others: String = (0..50)
        .map(|index| format!("function f{index}(a, b) {{ return a + b * {index}; }} "))
        .collect();
    let part = "function g() { return process.pid; }";
    let source = format!("{others}{part}");
    let states_of =
        |parts: Option<&[&str]>| with_parts(RUNTIME, &source, parts, |case| case.states);
    assert!(states_of(None) > 200);
    assert!(states_of(Some(&[part])) < 10);
}
