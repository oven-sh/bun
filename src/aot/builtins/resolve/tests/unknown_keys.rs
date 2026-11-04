use super::*;

const SPELL_WHAT_NO_BINDING_STANDS_FOR: &[&str] = &[
    "f.sort();",
    "f['call'];",
    "f[key];",
    "f[names[0]];",
    "const { map } = f;",
    "for (const item of f) g(item);",
    "[...f];",
    "async function h() { await f; }",
    "function* h() { yield f; }",
    "f.for('nodejs.util.inspect.custom');",
];

#[test]
fn a_name_off_a_value_that_no_binding_stands_for_asks_nothing() {
    for setup in [PROGRAM, RUNTIME] {
        for source in SPELL_WHAT_NO_BINDING_STANDS_FOR {
            with_case(setup, source, |case| {
                assert!(case.resolved.uses().is_empty(), "{source}")
            });
        }
    }
}
