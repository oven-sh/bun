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

fn evaluate(cx: &mut Cx, text: &str) -> Value {
    let text = StringRef::from_str(text);
    let provider = SourceProvider::build(text, None, SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap()
}

/// How many jobs, each queued by the one before, run before the handlers of the promise.
fn turns_until_settled(promise: &str) -> i32 {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let source = format!(
        "var turns = 0, result;
        ({promise}).then(() => (result = turns), () => (result = turns));
        (function turn() {{ if (turns < 20) Promise.resolve().then(() => (turns++, turn())); }})();"
    );
    evaluate(cx, &source);
    cx.drain_microtasks().unwrap();
    evaluate(cx, "result").as_int32().unwrap()
}

#[test]
fn awaiting_a_thenable_takes_the_turns_of_a_promise_that_is_resolved_with_it() {
    for (resolution, turns) in [
        ("1", 2),
        ("{ then(resolve) { resolve(1) } }", 3),
        ("Promise.resolve()", 4),
        ("Promise.reject()", 4),
    ] {
        let thenable = format!("{{ then(resolve) {{ resolve({resolution}) }} }}");
        for promise in [
            format!("(async () => {{ await {thenable} }})()"),
            format!("(async function* () {{ yield {thenable} }})().next()"),
            format!("(async function* () {{}})().return({thenable})"),
            format!("Promise.resolve({thenable}).then()"),
        ] {
            assert_eq!(turns_until_settled(&promise), turns, "{promise}");
        }
    }
}

#[test]
fn finally_waits_for_the_callback_and_then_follows_the_outcome() {
    for (returned, turns) in [
        ("1", 3),
        ("({})", 3),
        ("Promise.resolve()", 3),
        ("Promise.reject()", 3),
        ("{ throw 1 }", 1),
        ("Promise.resolve().then()", 4),
        ("({ then(resolve) { resolve(1) } })", 4),
        ("({ then(resolve) { resolve(Promise.resolve()) } })", 6),
        ("(class extends Promise {}).resolve()", 5),
    ] {
        for start in ["resolve", "reject"] {
            let promise = format!("Promise.{start}({{}}).finally(() => {returned})");
            assert_eq!(turns_until_settled(&promise), turns, "{promise}");
        }
    }
}
