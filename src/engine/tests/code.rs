use std::rc::Rc;

use bun_engine_bytecode::Specialization;
use bun_engine_bytecode::cache::Payload;
use bun_engine_macros::native_abi;
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

const CALLS_BEFORE_COMPILING: i32 = 33;

fn with_realm(body: impl FnOnce(&mut Cx)) {
    let mut options = Options::default();
    options.code_lease_multiplier = 0.0;
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

fn evaluate(cx: &mut Cx, text: &str) -> Value {
    let text = StringRef::from_str(text);
    let provider = SourceProvider::build(text, None, SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap()
}

fn code_block_of(function: Value) -> Option<Gc<CodeBlock>> {
    (function.cast::<JsFunction>().executable()).code_block(Specialization::Call)
}

/// Returns the tier that it is in afterwards.
#[inline(never)]
fn call(cx: &mut Cx, function: Value, times: i32) -> Tier {
    for _ in 0..times {
        cx.call(function, Value::UNDEFINED, &[]).unwrap();
    }
    code_block_of(function).unwrap().tier()
}

#[test]
fn what_has_the_same_code_shares_the_warm_up_and_the_machine_code() {
    with_realm(|cx| {
        #[inline(never)]
        fn evaluate_and_call(cx: &mut Cx, times: i32) -> Tier {
            let function = evaluate(cx, "() => 1");
            call(cx, function, times)
        }
        for _ in 0..CALLS_BEFORE_COMPILING {
            assert_eq!(evaluate_and_call(cx, 2), Tier::Interpreter);
        }
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(evaluate_and_call(cx, 2), Tier::Interpreter);
        assert_eq!(evaluate_and_call(cx, 3), Tier::Baseline);
        assert_eq!(evaluate_and_call(cx, 1), Tier::Baseline);
    });
}

#[test]
fn texts_that_come_back_keep_their_code_however_many_they_are() {
    with_realm(|cx| {
        let count = 3 * cx.code_cache_max_entries() / 2;
        let compile_all = || -> Vec<_> {
            let texts = (0..count).map(|index| StringRef::from_str(&format!("a{index}")));
            let providers = texts.map(|it| SourceProvider::build(it, None, SourceType::Program));
            (providers.map(|it| cx.compile_script(&it.finish(), None).unwrap())).collect()
        };
        let mut rounds = core::iter::repeat_with(compile_all).skip(4);
        let (earlier, later) = (rounds.next().unwrap(), rounds.next().unwrap());
        assert!(earlier.iter().zip(&later).all(|(a, b)| Rc::ptr_eq(a, b)));
    });
}

#[test]
fn compilation_can_be_delayed() {
    with_realm(|cx| {
        let function = evaluate(cx, "() => 1");
        cx.set_tier_up_scale(8.0);
        let period = CALLS_BEFORE_COMPILING + 1;
        assert_eq!(call(cx, function, 3 * period), Tier::Interpreter);
        cx.set_tier_up_scale(1.0);
        assert_eq!(call(cx, function, period), Tier::Baseline);
    });
}

#[test]
fn a_delay_is_served_by_all_that_have_the_same_code() {
    with_realm(|cx| {
        cx.set_tier_up_scale(4.0);
        let period = CALLS_BEFORE_COMPILING + 1;
        let tiers = [3 * period, period].map(|calls| {
            let function = evaluate(cx, "() => 1");
            call(cx, function, calls)
        });
        assert_eq!(tiers, [Tier::Interpreter, Tier::Baseline]);
    });
}

#[test]
fn a_frame_changes_over_to_code_that_a_call_further_in_has_had_compiled() {
    with_realm(|cx| {
        let function = evaluate(
            cx,
            "function f(inner) { if (!inner) for (let i = 0; i < 1000; i++) f(true); } f",
        );
        assert_eq!(call(cx, function, 1), Tier::Baseline);
        let code_block = code_block_of(function).unwrap();
        assert_eq!(code_block.interpreter_counter().get(), 1);
    });
}

/// With leases that take no time: one collection to look at the code, and one to see that it has not run since.
fn let_code_expire(cx: &Cx) {
    cx.heap.collect_and_sweep(Some(Scope::Full));
    cx.heap.collect_and_sweep(Some(Scope::Full));
    cx.discard_unlinked_code();
}

#[test]
fn code_expires_unless_it_runs() {
    with_realm(|cx| {
        for calls in [1, CALLS_BEFORE_COMPILING + 1] {
            let [idle, busy] = ["() => 1", "() => 2"].map(|text| evaluate(cx, text));
            let tier = call(cx, idle, calls);
            call(cx, busy, calls);
            for _ in 0..3 {
                cx.heap.collect_and_sweep(Some(Scope::Full));
                assert_eq!(call(cx, busy, 1), tier);
            }
            assert!(code_block_of(idle).is_none());
            assert_eq!(call(cx, idle, 1), Tier::Interpreter);
        }
    });
}

#[test]
fn what_is_made_again_goes_with_what_has_stayed() {
    with_realm(|cx| {
        evaluate(
            cx,
            "function tagged() { return (it => it)`x` }
            function* count() { for (let i = 0; ; i++) yield () => i }
            function outer(x) { return () => eval('x') }
            function make() { return class { #p = 1; static read(it) { return it.#p } } }
            var first = tagged(), counter = count(), zero = counter.next().value, inner = outer(7), A = make();
            inner(); A.read(new A)",
        );
        let before = cx.bytecode_count();
        let_code_expire(cx);
        assert!(cx.bytecode_count() < before / 2);
        let result = evaluate(
            cx,
            "[tagged() === first, zero(), counter.next().value(), inner(), outer(8)(), A.read(new A)].join()",
        );
        let result = result.to_string_view(cx).unwrap();
        assert_eq!(result.text().to_string(), "true,0,1,7,8,1");
    });
}

#[test]
fn stored_positions_that_are_not_in_the_text_are_not_used() {
    with_realm(|cx| {
        let text = "try { null.x } catch (error) { error.message + ' ' + error.column }";
        let source = || {
            let text = StringRef::from_str(text);
            SourceCode::whole(SourceProvider::build(text, None, SourceType::Program).finish())
        };
        let bytes = cx.encode_program(&source().provider, false, 0).unwrap();
        let mut run = |damage: &dyn Fn(&mut [u8])| {
            let (source, mut bytes) = (source(), bytes.clone());
            // Entries of four bytes: how far on the instruction and the divot are, and the extent to either side.
            damage(bytes.last_chunk_mut::<{ 3 * 4 }>().unwrap());
            (source.provider).set_bytecode(Payload::intact(bytes.into()), 0);
            cx.clear_code_cache();
            let result = evaluate_script(cx, &source, Value::UNDEFINED).unwrap();
            result.to_string_ref(cx).unwrap().to_string()
        };
        let message = "null is not an object (evaluating 'null.x') 11";
        assert_eq!(run(&|_| {}), message);
        for field in 1..4 {
            assert_eq!(run(&|it| it[field] = 0x7f), "null is not an object 1");
        }
    });
}

#[test]
fn machine_code_that_has_been_replaced_goes_once_no_frame_is_in_it() {
    #[native_abi]
    fn collect(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
        cx.heap.collect_and_sweep(Some(Scope::Eden));
        Ok(Value::UNDEFINED)
    }
    with_realm(|cx| {
        let collect = JsFunction::native(cx, 0, &StringRef::empty(), collect);
        let function = evaluate(
            cx,
            "var seldom = {}, then = () => {}; function f() { if (seldom === f) return seldom.length; then(); return 1 } f",
        );
        call(cx, function, CALLS_BEFORE_COMPILING + 1);
        let first = Rc::downgrade(&code_block_of(function).unwrap().compiled().unwrap());
        let prepare = evaluate(
            cx,
            "collect => { then = () => { seldom = f; for (let i = 0; i < 1000; i++) f(); collect() } }",
        );
        (cx.call(prepare, Value::UNDEFINED, &[collect.into()])).unwrap();
        call(cx, function, 1);
        assert_eq!(first.strong_count(), 1);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(first.strong_count(), 0);
    });
}

#[test]
fn a_call_site_that_stays_finds_the_new_code() {
    with_realm(|cx| {
        evaluate(
            cx,
            "function* count(n) { yield 0; let sum = 0; for (let i = 0; i < n; i++) sum += i; yield sum }
            function* keepCalling() { for (;;) { const it = count(1000); it.next(); yield it } }
            count(0).next();
            var caller = keepCalling(), old = caller.next().value;",
        );
        cx.discard_all_code();
        evaluate(cx, "old.next(); var young = caller.next().value");
        let [function, old, young] = ["count", "old", "young"].map(|it| evaluate(cx, it));
        let executable_of = |it: Value| it.cast::<Coroutine>().executable().address();
        let function = function.cast::<JsFunction>().executable().address();
        assert_ne!(executable_of(old), function);
        assert_eq!(executable_of(young), function);
    });
}

#[test]
fn what_suspended_code_keeps_alive() {
    const CASES: [(&str, bool); 15] = [
        ("async function(it) { await 0; await never }", true),
        ("async it => { String(it); await 0; await never }", true),
        (
            "async function() { await 0; await never }.bind(make())",
            true,
        ),
        ("async function(...rest) { await 0; await never }", true),
        ("async function(it = 1) { await 0; await never }", true),
        ("async function() { arguments; await 0; await never }", true),
        (
            "async function(it) { () => it; await 0; await never }",
            true,
        ),
        ("async function*(it) { yield; yield }", true),
        ("function*(it) { yield; yield }", true),
        (
            "function*() { const it = make(); yield; String(it); yield }",
            true,
        ),
        (
            "function*() { const it = make(); () => it; yield; yield }",
            true,
        ),
        (
            "async function(it) { await 0; it = null; await never }",
            false,
        ),
        ("function*(it) { yield; it = null; yield }", false),
        (
            "function*() { const it = make(); String(it); yield; yield }",
            false,
        ),
        ("function*(it) { yield }", false),
    ];
    const INSTANCES: usize = 20;
    for (function, keeps) in CASES {
        with_realm(|cx| {
            evaluate(
                cx,
                &format!(
                    "var last, never = new Promise(() => {{}}), running = [], refs = [];
                    function make() {{ const it = {{}}; last = new WeakRef(it); return it }}
                    for (let i = 0; i < {INSTANCES}; i++) {{
                        last = null;
                        const f = {function}, it = f(last ? 0 : make());
                        it.next?.(), it.next?.(), running.push(it), refs.push(last);
                    }}"
                ),
            );
            cx.drain_microtasks().unwrap();
            cx.heap.collect_and_sweep(Some(Scope::Full));
            let alive = evaluate(cx, "refs.filter(it => it.deref()).length").as_int32();
            let expected = if keeps {
                INSTANCES..=INSTANCES
            } else {
                0..=INSTANCES / 2
            };
            assert!(expected.contains(&(alive.unwrap() as usize)), "{function}");
        });
    }
}
