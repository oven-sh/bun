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

fn with_realm(body: impl FnOnce(&mut Cx)) {
    let mut options = Options::default();
    options.use_concurrent_gc = true;
    options.number_of_gc_markers = 3;
    options.collect_continuously = true;
    options.concurrent_gc_max_headroom = 1000.0;
    options.delay_gc_threads = true;
    options.verify_gc = true;
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

/// How many have been lost.
fn move_tokens(cx: &mut Cx, steps: i32, seed: i32) -> Value {
    let text = StringRef::from_str(include_str!("concurrent_marking.js"));
    let provider = SourceProvider::build(text, None, SourceType::Program).finish();
    let function = evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap();
    (cx.call(
        function,
        Value::UNDEFINED,
        &[steps.into(), seed.into(), 1.into()],
    ))
    .unwrap()
}

#[test]
fn nothing_is_lost_while_it_moves() {
    with_realm(|cx| assert!(move_tokens(cx, 200_000, 1) == 0.into()));
}

#[test]
fn heaps_mark_side_by_side() {
    std::thread::scope(|scope| {
        for seed in 2..6 {
            scope
                .spawn(move || with_realm(|cx| assert!(move_tokens(cx, 50_000, seed) == 0.into())));
        }
    });
}

#[test]
fn a_heap_goes_in_the_middle_of_a_collection() {
    for seed in 0..20 {
        with_realm(|cx| {
            move_tokens(cx, 50, seed);
            while cx.heap.collection_scope().is_none() {
                cx.heap.request_collection(Some(Scope::Full).into());
                cx.heap.collect_if_necessary();
            }
        });
    }
}
