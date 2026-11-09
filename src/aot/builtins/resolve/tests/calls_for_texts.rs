use super::*;

const OTHER_TEXTS: &[&str] = &[
    "process.on('exit', () => {});",
    "process.once(\"SIGINT\", () => {});",
    "process.addListener('exit', () => {}); process.prependListener('beforeExit', () => {});",
    "process.prependOnceListener('uncaughtException', () => {});",
    "process.on('exit' as string, () => {});",
    "process.on(`exit`, () => {});",
    "process.on('a text that is in no table', () => {});",
    "void process.on('exit', () => {});",
    "if (x) process.on('exit', () => {});",
    "process.on(x ? 'exit' : 'SIGINT', () => {});",
    "for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => {});",
    "for (const name of ['SIGINT', 'SIGTERM'] as const) process.on(name, () => f(name));",
    "for (let name of ['SIGINT']) { process.once(name, () => {}); }",
    "const names = ['SIGINT', 'SIGTERM']; for (const name of names) process.on(name, () => {});",
];

const LISTED_OR_UNKNOWN_TEXTS: &[&str] = &[
    "process.on('message', f);",
    "process.once('disconnect', f);",
    "process.on('exit', f); process.on('message', g);",
    "process.on('message', g); process.on('exit', f);",
    "process.on(event, f);",
    "process.on(x ? 'exit' : 'message', f);",
    "process.on(...operands);",
    "process.on();",
    "process.on('exit', f).on('message', g);",
    "const p = process.on('exit', f);",
    "g(process.on('exit', f));",
    "() => process.on('exit', f);",
    "g(process.on);",
    "const on = process.on;",
    "const { on } = process;",
    "process.on.call(process, 'exit', f);",
    "process.on`exit`;",
    "g(process);",
    "for (const name of ['exit', 'message']) process.on(name, f);",
    "for (const name of ['exit', 'SIGINT', other]) process.on(name, f);",
    "for (const name of ['exit', 'SIGINT', ...others]) process.on(name, f);",
    "for (const name of ['exit', , 'SIGINT']) process.on(name, f);",
    "for (const name of others) process.on(name, f);",
    "for (const name in ['exit', 'SIGINT']) process.on(name, f);",
    "for await (const name of ['exit', 'SIGINT']) process.on(name, f);",
    "for (const [name] of ['exit', 'SIGINT']) process.on(name, f);",
    "for (const { name } of ['exit', 'SIGINT']) process.on(name, f);",
    "for (let name of ['exit', 'SIGINT']) { name = other; process.on(name, f); }",
    "for (let name of ['exit', 'SIGINT']) { g(() => { name = other; }); process.on(name, f); }",
    "let name; for (name of ['exit', 'SIGINT']) process.on(name, f);",
    "for (var name of ['exit', 'SIGINT']) process.on(name, f); var name = other;",
    "for (const name of ['exit', 'SIGINT']) { eval(text); process.on(name, f); }",
    "for (const name of ['exit', 'SIGINT']) g(process.on(name, f));",
    "const names = ['exit', 'SIGINT']; names.push(other); for (const name of names) process.on(name, f);",
    "const names = ['exit', 'SIGINT']; names[0] = other; for (const name of names) process.on(name, f);",
    "const names = ['exit', 'SIGINT']; g(names); for (const name of names) process.on(name, f);",
    "let names = ['exit', 'SIGINT']; names = others; for (const name of names) process.on(name, f);",
    "export const names = ['exit', 'SIGINT']; for (const name of names) process.on(name, f);",
    "const names = ['exit', 'SIGINT']; export { names }; for (const name of names) process.on(name, f);",
    "const names = ['exit', 'SIGINT'], same = names; same.push(other); for (const name of names) process.on(name, f);",
    "const names = ['exit', 'SIGINT']; for (const name of names) { names.length = 0; process.on(name, f); }",
];

fn needs_what_some_texts_need(case: &Case<'_, '_>) -> bool {
    let lists = table::entry(BuiltinId::EventEmitterPrototypeOn).calls_for_texts();
    let mut functions = lists.iter().flat_map(|listed| listed.calls).peekable();
    assert!(functions.peek().is_some());
    let used = case.resolved.uses();
    let is_used = |function: &table::RuntimeFunction| used.functions.contains(function);
    let found = functions.filter(|function| is_used(function)).count();
    assert!(
        found == 0 || found == lists.iter().map(|listed| listed.calls.len()).sum::<usize>(),
        "{}",
        case.source
    );
    found != 0
}

#[test]
fn a_call_that_writes_another_text_does_without() {
    for setup in [PROGRAM, RUNTIME] {
        for source in OTHER_TEXTS {
            with_case(setup, source, |case| {
                assert!(!needs_what_some_texts_need(case), "{source}");
                assert!(case.mentions(BuiltinId::Process), "{source}");
            });
        }
    }
    with_case(PROGRAM, "process.on('exit', () => {});", |case| {
        assert!(case.mentions(BuiltinId::EventEmitterPrototypeOn));
    });
}

#[test]
fn any_other_mention_needs_everything() {
    for setup in [PROGRAM, RUNTIME] {
        for source in LISTED_OR_UNKNOWN_TEXTS {
            with_case(setup, source, |case| {
                assert!(needs_what_some_texts_need(case), "{source}")
            });
        }
    }
}

#[test]
fn a_test_run_may_replace_how_lists_are_walked() {
    const REPLACED: [&[u32]; 2] = [
        &[BuiltinId::ArrayPrototypeSymbolIterator.to_wire()],
        &[BuiltinId::ArrayIteratorPrototypeNext.to_wire()],
    ];
    let [iterator_replaced, next_replaced] = REPLACED.map(|replaced| Setup {
        replaced,
        ..RUNTIME
    });
    for setup in [TEST_RUN, iterator_replaced, next_replaced] {
        let source = "for (const name of ['SIGINT', 'SIGTERM']) process.on(name, f);";
        with_case(setup, source, |case| {
            assert!(needs_what_some_texts_need(case), "{source}")
        });
        let source = "process.on('SIGINT', () => {});";
        with_case(setup, source, |case| {
            assert!(!needs_what_some_texts_need(case), "{source}")
        });
    }
}
