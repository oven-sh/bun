use bun_engine_bytecode::{BlockIndex, Liveness};
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

/// The completion value, or what is thrown.
fn run(source: &str) -> String {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let (text, url) = (StringRef::from_str(source), StringRef::from_str("test.js"));
    let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
    let value = evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
        .unwrap_or_else(|thrown| cx.catch_value(thrown).unwrap());
    value.to_string_view(cx).unwrap().text().to_string()
}

#[test]
fn assignments_to_patterns_nest() {
    for (before, after) in [
        ("[a = ", "] = []"),
        ("({ b: a = ", " } = {})"),
        ("({ [", "]: a } = {})"),
        ("[list[", "]] = []"),
        ("[[", "].a] = []"),
        ("[{ b: [", "].a }] = [{}]"),
        ("[class { static { ", " } }.a] = []"),
        ("for ([class { static { ", " } }]; false; );"),
    ] {
        let (before, after, gap) = (before.repeat(8), after.repeat(8), " ".repeat(5000));
        let source = format!("var a, list = [], count = 0; {before}{gap}count++{after}; count");
        assert_eq!(run(&source), "1", "{source}");
    }
}

#[test]
fn a_function_in_the_body_takes_the_place_of_a_parameter() {
    for parameters in ["a", "a = 1", "a, b = 1", "{ a } = {}", "...a"] {
        let source = format!("(function ({parameters}) {{ function a() {{}} return typeof a }})()");
        assert_eq!(run(&source), "function", "{source}");
    }
}

#[test]
fn parameters_do_not_see_what_the_body_declares() {
    for declaration in ["var", "let", "const"] {
        let function = format!("function (b = a) {{ {declaration} a = 2; () => a; return b }}");
        let source = format!("with ({{ a: 1 }}) ({function})()");
        assert_eq!(run(&source), "1", "{source}");
        let source = format!("(function () {{ eval('var a = 1'); return ({function})() }})()");
        assert_eq!(run(&source), "1", "{source}");
    }
}

#[test]
fn spreading_nothing_passes_no_first_argument() {
    let source = "Array.prototype[0] = '1';
        [function () { 'use strict'; return this }.call(...[]), eval(...[])].map(String)";
    assert_eq!(run(source), "undefined,undefined");
}

#[test]
fn code_writes_its_locals_before_it_reads_them() {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let text = "await using resource = null; const it = new FinalizationRegistry(Object);";
    let provider = SourceProvider::build(StringRef::from_str(text), None, SourceType::Module);
    let module = cx.compile_module(&provider.finish(), None, true);
    let liveness = Liveness::new(&module.ok().unwrap().code.body).unwrap();
    assert!(liveness.live_in(BlockIndex(0)).is_empty());
}

#[test]
fn functions_nest_in_the_tests_of_loops() {
    let (before, after) = ("while ((() => { count++;".repeat(12), "})());".repeat(12));
    assert_eq!(run(&format!("var count = 0; {before}{after} count")), "12");
}
