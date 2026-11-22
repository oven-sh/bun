use super::*;
use crate::builtins::RuntimeUses;

const BIND_AN_OVERLOAD_THAT_RUNS_NO_OTHER_CODE: &[&str] = &[
    "setTimeout(() => {}, 1);",
    "setTimeout(() => {});",
    "setTimeout(() => {}, 0, f, g);",
    "setTimeout(() => {}, 2147483647);",
    "setTimeout((() => {}) as any, 1 as number);",
    "const wait = 5; setTimeout(() => {}, wait);",
    "setTimeout(() => {}, 1); setTimeout(() => {}, 2);",
    "setTimeout(() => {}, 1_000);",
    "setTimeout(() => {}, 1e3);",
    "setTimeout(() => {}, 0x10);",
    "setTimeout(() => {}, +1);",
    "setTimeout(() => {}, 1.0);",
    "setTimeout(() => {}, 2 ** 31 - 1);",
    "setTimeout(async () => {}, 1);",
    "globalThis.setTimeout(() => {}, 1);",
    "if (setTimeout(() => {}, 1)) f();",
    "while (setTimeout(() => {}, 1)) break;",
    "function h(setTimeout) { setTimeout(f, g); }",
];

const MAY_RUN_OTHER_CODE_OR_HAND_THE_TIMER_ON: &[&str] = &[
    "setTimeout(f, 1);",
    "setTimeout(function () {}, 1);",
    "setTimeout(function* () {}, 1);",
    "setTimeout(() => {}, f);",
    "setTimeout(() => {}, -1);",
    "setTimeout(() => {}, -0);",
    "setTimeout(() => {}, 1.5);",
    "setTimeout(() => {}, 2147483648);",
    "setTimeout(() => {}, 2 ** 31);",
    "setTimeout(class {}, 1);",
    "let wait = 5; wait = f; setTimeout(() => {}, wait);",
    "setTimeout(() => {}, '1');",
    "setTimeout(() => {}, { valueOf() { return 1; } });",
    "setTimeout(...f);",
    "setTimeout(() => {}, ...f);",
    "setTimeout();",
    "const later = setTimeout;",
    "f(setTimeout);",
    "setTimeout.call(f, () => {}, 1);",
    "setTimeout(() => {}, 1); setTimeout(f, 1);",
    "const held = setTimeout(() => {}, 1);",
    "f(setTimeout(() => {}, 1));",
    "+setTimeout(() => {}, 1);",
    "`${setTimeout(() => {}, 1)}`;",
    "setTimeout(() => {}, 1) == 1;",
    "f[setTimeout(() => {}, 1)];",
    "!setTimeout(() => {}, 1);",
    "export default setTimeout(() => {}, 1);",
    "new setTimeout(() => {}, 1);",
];

fn holds_what_a_call_that_runs_other_code_calls(setup: Setup, source: &str) -> bool {
    let called = table::entry(BuiltinId::SetTimeout).calls_where_call_runs_other_code();
    assert!(!called.is_empty());
    with_case(setup, source, |case| {
        let functions = &case.resolved.uses().functions;
        called.iter().all(|function| functions.contains(function))
    })
}

#[test]
fn a_call_is_judged_by_the_overload_that_its_written_operands_bind() {
    let holds = holds_what_a_call_that_runs_other_code_calls;
    let quiet = BIND_AN_OVERLOAD_THAT_RUNS_NO_OTHER_CODE.iter();
    let loud_by_mistake: Vec<_> = quiet.filter(|source| holds(PROGRAM, source)).collect();
    assert!(loud_by_mistake.is_empty(), "{loud_by_mistake:?}");
    let loud = MAY_RUN_OTHER_CODE_OR_HAND_THE_TIMER_ON.iter();
    let quiet_by_mistake: Vec<_> = loud.filter(|source| !holds(PROGRAM, source)).collect();
    assert!(quiet_by_mistake.is_empty(), "{quiet_by_mistake:?}");
}

#[test]
fn a_call_in_text_of_the_library_is_not_judged() {
    assert!(holds_what_a_call_that_runs_other_code_calls(
        RUNTIME,
        "setTimeout(() => {}, 1);"
    ));
}

const BRING_NOTHING_AT_ALL: &[&str] = &[
    "setTimeout(() => {}, 1);",
    "setTimeout(() => console.log('a'), 1);",
    "setTimeout(() => { console.log('a', 1); }, 1);",
    "setInterval(() => console.log('a'), 1);",
    "setTimeout(() => setTimeout(() => console.log('a'), 1), 1);",
    "console.log(-1);",
    "console.log(1 + 2);",
    "console.log(`a`);",
    "console.log(`a${1}`);",
    "const a = 'a'; console.log(a);",
    "const a = 1, b = a + 1; console.log(a, b);",
];

const HAND_A_NATIVE_SOMETHING_TO_ASK: &[&str] = &[
    "setTimeout(() => console.log(f), 1);",
    "setTimeout(() => [1], 1);",
    "setTimeout(() => {}, 1, [1]);",
    "setTimeout(() => this, 1);",
    "const tick = () => {}; setTimeout(tick, 1);",
    "console.log(() => {});",
    "let a = 'a'; a = f; console.log(a);",
];

#[test]
fn a_quiet_call_and_what_it_is_handed_bring_nothing() {
    let brings_something = |source: &&&str| {
        with_case(PROGRAM, source, |case| {
            *case.resolved.uses() != RuntimeUses::default()
        })
    };
    let brought: Vec<_> = BRING_NOTHING_AT_ALL
        .iter()
        .filter(brings_something)
        .collect();
    assert!(brought.is_empty(), "{brought:?}");
    let is_quiet = |source: &&&str| {
        with_case(PROGRAM, source, |case| {
            let uses = case.resolved.uses();
            !(uses.asks.may_hand_values_to_natives || uses.lets_in_what_nobody_names)
        })
    };
    let quiet: Vec<_> = HAND_A_NATIVE_SOMETHING_TO_ASK
        .iter()
        .filter(is_quiet)
        .collect();
    assert!(quiet.is_empty(), "{quiet:?}");
}
