//! What the library finds out about its caller is the same if that has been inlined.

use bun_engine_standalone as _;
use bun_engine_text::{StringRef, names};
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

fn run(cx: &mut Cx, text: &str) -> Value {
    let provider =
        SourceProvider::build(StringRef::from_str(text), None, SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap()
}

#[test]
fn a_proxy_is_called_in_the_realm_of_its_caller() {
    let mut options = Options::default();
    (options.use_quick_optimizer, options.use_full_optimizer) = (true, true);
    options.force_eager_compilation = true;
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let other = GlobalObject::create(cx, &HOOKS);
    let source = "
        const list = (target, ...rest) => rest.find(Array.isArray);
        const proxy = new Proxy(function () {}, { apply: list, construct: list });
        () => proxy() instanceof Array && new proxy() instanceof Array";
    let caller = run(cx.in_realm(other), source);
    (cx.global()).put_direct(cx, names::caller, caller, Attributes::NONE);
    let source = "let count = 0; for (let i = 0; i < 2000; i++) count += caller(); count";
    assert_eq!(run(cx, source), 2000.into());
}
