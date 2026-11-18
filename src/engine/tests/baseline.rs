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
    let mut options = Options::default();
    options.jit_policy_scale = 0.1;
    set_options(options);
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
fn hot_code_does_what_cold_code_does() {
    assert_eq!(run(include_str!("baseline.js")), "done");
}
