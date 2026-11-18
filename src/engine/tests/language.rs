use bun_engine_standalone as _;
use bun_engine_text::StringRef;
use bun_engine_vm::heap::HeapKind;
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

/// Each script has to end with, or throw, what has that text.
fn check<T: AsRef<str>>(cases: impl IntoIterator<Item = (T, &'static str)>) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    for (source, expected) in cases {
        let source = source.as_ref();
        let (text, url) = (StringRef::from_str(source), StringRef::from_str("test.js"));
        let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
        let value = evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
            .unwrap_or_else(|thrown| cx.catch_value(thrown).unwrap());
        let found = value.to_string_view(cx).unwrap().text().to_string();
        assert_eq!(found, expected, "{source:.200}");
    }
}

#[test]
fn a_function_replaces_the_parameter_of_its_name() {
    check(
        [
            "(function (b = 0) { function b() {} return b })()",
            "(function (b, c = 0) { function b() {} return b })(1)",
            "((b = 1) => { function b() {} return b })(2)",
            "(function ({} = 0, b) { function b() {} return b })()",
            "(function (b = 0) { function b() {} return () => b })()()",
            "(function (b) { function b() {} return arguments[0] })(1)",
            "(function (b, c) { function b() {} return (() => c, arguments[0]) })(1)",
        ]
        .map(|call| (format!("typeof {call}"), "function")),
    );
}

#[test]
fn the_last_parameter_of_a_name_counts() {
    check([
        ("(function (a, b, a) { return a })(1, 2, 3)", "3"),
        ("(function (a, b, a) { return () => a })(1, 2, 3)()", "3"),
        (
            "(function (a, b, a) { a = 4; return [...arguments] })(1, 2, 3)",
            "1,2,4",
        ),
        (
            "(function (a, b, a) { (() => a = 4)(); return [...arguments] })(1, 2, 3)",
            "1,2,4",
        ),
        (
            "(function ([a, b], c, { d }, e) { return [a, b, c, d, e] })([1, 2], 3, { d: 4 }, 5)",
            "1,2,3,4,5",
        ),
    ]);
}

#[test]
fn long_chains_of_operators() {
    const LINKS: usize = 50_000;
    let prelude = "var n = 0, o = { get a() { n++; return o }, b(c) { n += c; return o } };
        function f() { n++; return f }";
    check(
        [
            ("n = 0", " + 1 * ++n / n", "", "50000"),
            ("1", " << f.length >>> 0", "", "1"),
            ("1", " ** ++n", "; n", "50000"),
            ("1", " == 1", "", "true"),
            ("1", " && ++n", "", "50000"),
            ("0", " || !++n", " ? 0 : n", "50000"),
            ("null", " ?? void ++n", " ?? n", "50000"),
            ("o", ".a", ".c = n", "50000"),
            ("o", ".b(1)", ", n", "50000"),
            ("o", "?.a?.b(1)", ", n", "100000"),
            ("o.c", "?.a", "", "undefined"),
            ("f", "()``", ", n", "100000"),
            ("f", ".call()", ", n", "50000"),
            ("", "new ", "f, n", "50000"),
            ("", "!", "n", "false"),
            ("", "- ", "++n", "1"),
            ("if (", "!", "f) n = 1; n", "1"),
        ]
        .map(|(head, link, tail, expected)| {
            let chain = link.repeat(LINKS);
            (format!("{prelude}; {head}{chain}{tail}"), expected)
        }),
    );
    let labels: Vec<String> = (0..LINKS).map(|index| format!("l{index}:")).collect();
    let labels = labels.concat();
    check([(format!("{labels} for (;;) {{ 1; break l0 }}"), "1")]);
}

#[test]
fn exits_clean_up_from_the_inside_out() {
    let prelude = "var log = '';
        var open = name => ({ [Symbol.iterator]() { return this }, next: () => ({}), return() { log += name; return {} } });
        var held = name => ({ [Symbol.dispose]() { log += name } });";
    let nest = |exit: &str| {
        format!(
            "x: for (var i = 0; i < 2; i++) {{ y: for (var a of open('a')) try {{ using b = held('b');
                for (var c of open('c')) for (var d of open('d')) try {{ try {{ try {{ {exit} }} catch {{}} }} catch {{}} }}
                finally {{ log += 'e' }} }} finally {{ log += 'f' }} log += '.' }}"
        )
    };
    check(
        [
            ("break x", "edcbfa:undefined"),
            ("continue x", "edcbfaedcbfa:undefined"),
            ("break y", "edcbfa.edcbfa.:undefined"),
            ("if (i) break x; else break y", "edcbfa.edcbfa:undefined"),
            ("if (i) return i; else continue x", "edcbfaedcbfa:1"),
            ("return log + 1", "edcbfa:1"),
        ]
        .map(|(exit, expected)| {
            let body = nest(exit);
            let call = format!("var result = (function () {{ {body} }})(); log + ':' + result");
            (format!("{prelude}{call}"), expected)
        }),
    );
    let (body, nested) = (
        nest("yield"),
        "[[[a = yield] = open('a')] = open('b')] = open('c')",
    );
    let empty = "open = (make => name => Object.assign(make(name), { next: () => ({}) }))(open);";
    check([
        (
            format!("{prelude} var g = function* () {{ {body} }}(); g.next(); g.return(1).value + log"),
            "1edcbfa",
        ),
        (
            format!("{prelude}{empty} var g = function* () {{ {nested} }}(); g.next(); g.return(1).value + log"),
            "1abc",
        ),
        (
            "new class extends Object { constructor() { try { try { try { return } catch {} } catch {} } catch {} } }".into(),
            "ReferenceError: 'super()' must be called in derived constructor before accessing |this| or returning non-object.",
        ),
    ]);
}

#[test]
fn completion_values() {
    check([
        ("1; { var a; { ; } }", "1"),
        ("1; do { 2; { { break } } } while (false)", "2"),
        (
            "1; do { { var a; { break } 2 } } while (false)",
            "undefined",
        ),
        ("1; a: b: { break a }", "1"),
        ("1; a: if (true) { break a }", "undefined"),
    ]);
}
