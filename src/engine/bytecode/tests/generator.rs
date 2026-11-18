use bun_engine_bytecode::{
    BuiltinValue, Code, Compiler, Dump, Host, Instrumentation, Request, SourceCache,
    Specialization, verify,
};
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, PropertyName, StringRef, Text};

struct NoHost;

impl Host for NoHost {
    fn private_name(&self, _: Text<'_>) -> Option<Identifier> {
        None
    }

    fn builtin_value(&self, _: PropertyName<'_>) -> Option<BuiltinValue> {
        None
    }

    fn version(&self) -> u32 {
        0
    }
}

fn request<'a>(source: &'a StringRef, cache: Option<&'a mut SourceCache>) -> Request<'a> {
    const STACK: usize = 512 << 10;
    let marker = 0u8;
    Request {
        source,
        cache,
        host: &NoHost,
        instrumentation: Instrumentation::empty(),
        stack_limit: (&raw const marker).addr() - STACK,
    }
}

/// Where the functions start that have come with their code, which is what they get on their own.
fn starts_of_eager_functions(code: &Code, source: &StringRef, starts: &mut Vec<u32>) {
    let dump = |code: &Code| Dump::new(code, source.text()).with_positions().to_string();
    for function in &*code.functions {
        let Some(eager) = function.code(Specialization::Call) else {
            continue;
        };
        let lazy = Compiler::default()
            .function(request(source, None), function, Specialization::Call)
            .unwrap();
        verify(&eager, function.outer_scope().map(|it| &**it)).unwrap();
        assert_eq!(dump(&eager), dump(&lazy), "{source}");
        starts.push(function.range().start);
        starts_of_eager_functions(&eager, source, starts);
    }
}

fn eager_functions(source: &StringRef, cache: &mut SourceCache) -> Vec<u32> {
    let script = Compiler::default().script(request(source, Some(cache)), false, None);
    let mut starts = Vec::new();
    starts_of_eager_functions(&script.unwrap().code, source, &mut starts);
    starts.sort_unstable();
    starts
}

#[test]
fn functions_that_are_called_at_once_come_with_their_code() {
    for (source, expected) in [
        ("(function (a, b) { return () => a + b })", &[1][..]),
        ("(function f() { return () => f })()", &[1]),
        ("(function () { 'use strict'; this }())", &[1]),
        ("(function () { arguments }).call(a)", &[1]),
        ("!function (a = () => b, b) { var b }()", &[1]),
        ("a = (({ b }) => eval(b))(c)", &[5]),
        ("(async () => { await a })()", &[1]),
        ("(function (a) { (() => a)() })()", &[1, 17]),
        ("(function () {})(a, function () {})", &[1, 20]),
        ("(function () {})(a, (function () {}))", &[1, 21]),
        ("a(function () {}, () => {})", &[]),
        ("a = (function () {}), (() => {}) || b", &[]),
        ("[(function () {}), (function () {})]", &[]),
        ("({ a: (function () {}) })", &[]),
        ("function a() { (function () {})() }", &[]),
        ("new (function () {})(), new ((function () {}))", &[]),
        ("throw (function () {})()", &[7]),
        ("class A { static a = (function () {})() }", &[]),
        ("while ((function () {})());", &[8]),
    ] {
        let source = StringRef::from_literal(source);
        let found = eager_functions(&source, &mut SourceCache::default());
        assert_eq!(found, expected, "{source}");
    }
}

#[test]
fn only_so_many_trees_are_kept() {
    let source = StringRef::from_str(&"(function () { a, b, c, d })();".repeat(20_000));
    let count = eager_functions(&source, &mut SourceCache::default()).len();
    assert!((5_000..15_000).contains(&count), "{count}");
}
