use bun_engine_bytecode::Specialization;
use bun_engine_standalone as _;
use bun_engine_text::StringRef;
use bun_engine_vm::heap::{HeapKind, Scope};
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

#[inline(never)]
fn warm_up(cx: &mut Cx, function: Value) {
    for _ in 0..1000 {
        cx.call(function, Value::UNDEFINED, &[]).unwrap();
    }
}

#[inline(never)]
fn tier_of(function: Value) -> Tier {
    let executable = function.cast::<JsFunction>().executable();
    executable.code_block(Specialization::Call).unwrap().tier()
}

#[test]
fn optimized_code_expires_unless_it_is_the_best_that_there_can_be() {
    let mut options = Options::default();
    (options.use_quick_optimizer, options.use_full_optimizer) = (true, true);
    options.use_concurrent_jit = false;
    options.threshold_for_full_optimizer = i32::MAX;
    options.code_lease_multiplier = 0.0;
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let [best, other] = ["() => 1", "() => 2"].map(|text| {
        let text = StringRef::from_str(text);
        let provider = SourceProvider::build(text, None, SourceType::Program).finish();
        evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap()
    });
    let executable = best.cast::<JsFunction>().executable();
    (executable.cast::<ScriptExecutable>()).restrict(Restrictions::NEVER_FULLY_OPTIMIZE);
    for function in [other, best] {
        warm_up(cx, function);
        assert_eq!(tier_of(function), Tier::QuickOptimized);
    }
    for _ in 0..2 {
        cx.heap.collect_and_sweep(Some(Scope::Full));
    }
    assert_eq!(tier_of(best), Tier::QuickOptimized);
    assert_eq!(tier_of(other), Tier::Baseline);
}
