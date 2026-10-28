use super::*;

const OTHER_TEXTS: &[&str] = &[
    "process.on('exit', f);",
    "process.once(\"SIGINT\", f);",
    "process.addListener('exit', f); process.prependListener('beforeExit', f);",
    "process.prependOnceListener('uncaughtException', f);",
    "process.on('exit' as string, f);",
    "process.on(`exit`, f);",
    "process.on('a text that is in no table', f);",
    "void process.on('exit', f);",
    "if (x) process.on('exit', f);",
    "let p; p = process; p.on('exit', f);",
    "for (const name of ['SIGINT', 'SIGTERM']) process.on(name, f);",
    "for (const name of ['SIGINT', 'SIGTERM'] as const) process.on(name, () => f(name));",
    "for (let name of ['SIGINT']) { process.once(name, f); }",
    "for (var name of ['SIGINT']) process.on(name, f);",
    "['SIGINT', 'SIGTERM'].forEach(name => process.on(name, f));",
    "['SIGINT', 'SIGTERM'].forEach(name => { process.on(name, f); });",
    "['SIGINT', 'SIGTERM'].forEach(function (name, index) { process.on(name, f); });",
    "(['SIGINT', 'SIGTERM'] as const).forEach(async name => process.on(name, f));",
    "const names = ['SIGINT', 'SIGTERM']; for (const name of names) process.on(name, f);",
    "const names = ['SIGINT', 'SIGTERM'] as const; names.forEach(name => process.on(name, f));",
    "const names = ['SIGINT']; for (const name of names) process.on(name, f); names.forEach(name => process.off(name, f));",
    "for (const name of []) process.on(name, f);",
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
    "let p; p = process; p.on('message', f);",
    "for (const name of ['exit', 'message']) process.on(name, f);",
    "['exit', 'disconnect'].forEach(name => process.on(name, f));",
    "for (const name of ['exit', other]) process.on(name, f);",
    "for (const name of ['exit', ...others]) process.on(name, f);",
    "for (const name of ['exit', , 'SIGINT']) process.on(name, f);",
    "for (const name of others) process.on(name, f);",
    "for (const name in ['exit']) process.on(name, f);",
    "for await (const name of ['exit']) process.on(name, f);",
    "for (const [name] of ['exit']) process.on(name, f);",
    "for (const { name } of ['exit']) process.on(name, f);",
    "for (let name of ['exit']) { name = other; process.on(name, f); }",
    "for (let name of ['exit']) { g(() => { name = other; }); process.on(name, f); }",
    "let name; for (name of ['exit']) process.on(name, f);",
    "for (var name of ['exit']) process.on(name, f); var name = other;",
    "for (const name of ['exit']) { eval(text); process.on(name, f); }",
    "for (const name of ['exit']) g(process.on(name, f));",
    "['exit'].map(name => process.on(name, f));",
    "['exit'].forEach((index, name) => process.on(name, f));",
    "['exit'].forEach((name = other) => process.on(name, f));",
    "['exit'].forEach((...names) => process.on(names, f));",
    "['exit'].forEach(({ name }) => process.on(name, f));",
    "['exit'].forEach((name, index, all) => { all.push(other); process.on(name, f); });",
    "['exit'].forEach(function (name) { arguments[0] = other; process.on(name, f); });",
    "['exit'].forEach(function again(name) { g(again); process.on(name, f); });",
    "['exit'].forEach(name => { name = other; process.on(name, f); });",
    "others.forEach(name => process.on(name, f));",
    "({ forEach: g }).forEach(name => process.on(name, f));",
    "['exit'].forEach(g, name => process.on(name, f));",
    "g(name => process.on(name, f));",
    "const listen = name => process.on(name, f); ['exit'].forEach(listen); listen(other);",
    "const names = ['exit']; names.push(other); for (const name of names) process.on(name, f);",
    "const names = ['exit']; names[0] = other; for (const name of names) process.on(name, f);",
    "const names = ['exit']; g(names); for (const name of names) process.on(name, f);",
    "const names = ['exit']; names.forEach((name, index, all) => all.push(other)); for (const name of names) process.on(name, f);",
    "const names = ['exit']; names.forEach(g); for (const name of names) process.on(name, f);",
    "let names = ['exit']; names = others; for (const name of names) process.on(name, f);",
    "export const names = ['exit']; for (const name of names) process.on(name, f);",
    "const names = ['exit']; export { names }; for (const name of names) process.on(name, f);",
    "const names = ['exit'], same = names; same.push(other); for (const name of names) process.on(name, f);",
    "const names = ['exit']; for (const name of names) { names.length = 0; process.on(name, f); }",
];

fn needs_what_some_texts_need(case: &Case<'_, '_>) -> bool {
    let lists = table::entry(BuiltinId::EventEmitterPrototypeOn).calls_for_texts();
    let mut functions = lists.iter().flat_map(|listed| listed.calls).peekable();
    assert!(functions.peek().is_some());
    let used = &case.resolved.uses().functions;
    let found = functions.filter(|function| used.contains(function)).count();
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
    with_case(PROGRAM, "process.on('exit', f);", |case| {
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
