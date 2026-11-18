use core::cell::RefCell;
use core::time::Duration;

use bun_engine_macros::native_abi;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringBuilder, StringRef, Text, names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(GlobalObject::create_for_shadow_realm(cx, &HOOKS)),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn with_realm(body: impl FnOnce(&mut Cx)) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

fn run(cx: &mut Cx, source: &str) -> JsResult<Value> {
    let (text, url) = (StringRef::from_str(source), StringRef::from_str("test.js"));
    let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
}

fn text(cx: &mut Cx, value: Value) -> String {
    value.to_string_view(cx).unwrap().text().to_string()
}

fn run_to_text(cx: &mut Cx, source: &str) -> String {
    let value = run(cx, source).unwrap();
    text(cx, value)
}

fn define(cx: &Cx, name: &'static str, function: NativeFunction) {
    let name = Identifier::from_literal(name);
    let (intrinsic, attributes) = (Intrinsic::None, Attributes::NONE);
    (cx.global()).put_direct_native_function(cx, name.name(), 0, function, intrinsic, attributes);
}

fn function_names(vm: &Vm, frames: &[StackFrame]) -> StringRef {
    let mut names = StringBuilder::new();
    for frame in frames {
        names.push_latin1(b'|');
        names.push_text(frame.function_name(vm).text());
    }
    names.into_string()
}

/// The global `errors` gets many whose innermost function nothing else refers to.
const ERRORS_OF_DEAD_FUNCTIONS: &str = "var errors = [];
for (let i = 0; i < 100; i++) errors[i] = (function dies() { return new RangeError('m' + i) })();";

fn errors_without_frames(cx: &mut Cx) -> usize {
    let errors = run(cx, "errors").unwrap();
    let error = |index| errors.get_index(cx, index).unwrap().cast::<ErrorInstance>();
    (0..100).map(error).filter(|it| !it.has_any_frame()).count()
}

#[test]
fn the_stack_outlives_the_functions_in_it() {
    with_realm(|cx| {
        run(cx, ERRORS_OF_DEAD_FUNCTIONS).unwrap();
        assert_eq!(errors_without_frames(cx), 0);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(errors_without_frames(cx) > 90);
        let all = "errors.every(it => it.stack === errors[0].stack && it.line === 2)";
        assert_eq!(run(cx, all).unwrap(), Value::TRUE);
        assert_eq!(
            run_to_text(
                cx,
                "[errors[7].stack, errors[7].column, errors[7].sourceURL].join()"
            ),
            "dies@test.js:2:83\nglobal code@test.js:2:95,83,test.js"
        );
    });
}

#[test]
fn a_captured_stack_outlives_the_functions_in_it() {
    with_realm(|cx| {
        let source = "var errors = [];
for (let i = 0; i < 100; i++) (function dies() { Error.captureStackTrace(errors[i] = new Error) })();";
        run(cx, source).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(
            run_to_text(cx, "errors[7].stack + Reflect.ownKeys(errors[8])"),
            "dies@test.js:2:73\nglobal code@test.js:2:99stack,line,column,sourceURL"
        );
    });
}

#[test]
fn frames_that_an_old_error_is_given_are_watched_too() {
    #[native_abi]
    fn recapture(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        let error = frame.argument(0).cast::<ErrorInstance>();
        error.capture_stack_trace(cx, 1);
        Ok(Value::UNDEFINED)
    }
    with_realm(|cx| {
        define(cx, "recapture", recapture);
        let source = "var errors = [];
function again() { for (let e of errors) (function young() { recapture(e) })() }
function make() { for (let i = 0; i < 100; i++) errors[i] = new Error }";
        run(cx, source).unwrap();
        for name in ["again", "make"] {
            let function = run(cx, name).unwrap();
            cx.call(function, Value::UNDEFINED, &[]).unwrap();
        }
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(errors_without_frames(cx), 0);
        let again = run(cx, "again").unwrap();
        cx.call(again, Value::UNDEFINED, &[]).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Eden));
        assert!(errors_without_frames(cx) > 90);
        assert_eq!(
            run_to_text(cx, "errors[7].stack"),
            "young@test.js:2:71\nagain@test.js:2:77"
        );
    });
}

fn use_embedder_format(cx: &Cx) {
    let hooks = &cx.embedder().errors;
    hooks.compute_stack.set(Some(|cx, error, location| {
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let names = function_names(cx, &error.stack_frames());
        location.position.line += 1000;
        match error.sanitized_to_string(cx) {
            Ok(header) => cx
                .new_string_from_parts(&[header.text(), names.text()])
                .unwrap()
                .into(),
            Err(_) => Value::UNDEFINED,
        }
    }));
    hooks.format_frames.set(Some(|vm, frames, location| {
        location.position.line += 2000;
        location.source_url = Some(StringRef::from_literal("late.js"));
        function_names(vm, frames)
    }));
}

#[test]
fn the_embedder_formats_the_stack() {
    with_realm(|cx| {
        use_embedder_format(cx);
        run(cx, ERRORS_OF_DEAD_FUNCTIONS).unwrap();
        let describe = "[it.stack, it.line, it.column, it.sourceURL].join()";
        assert_eq!(
            run_to_text(cx, &format!("var it = errors[1]; {describe}")),
            "RangeError: m1|dies|global code,1000,0,"
        );
        assert_eq!(
            run_to_text(
                cx,
                &format!("it = errors[2]; it.message = 'new'; {describe}")
            ),
            "RangeError: new|dies|global code,2000,0,late.js"
        );
        for index in ["(function f() { return new Error })()", "errors[3]"] {
            let source = format!(
                "it = {index}; it.name = Symbol();
                 try {{ it.stack; 'no' }} catch (e) {{ [e.name, it.stack, 'stack' in it].join() }}"
            );
            assert_eq!(run_to_text(cx, &source), "TypeError,,true");
        }
    });
}

#[test]
fn what_the_formatter_does_not_find_on_an_error_is_found_on_the_next() {
    with_realm(|cx| {
        cx.embedder().errors.compute_stack.set(Some(|cx, error, _| {
            let format = cx.global().get(cx, names::format).unwrap();
            cx.call(format, Value::UNDEFINED, &[error.into()]).unwrap()
        }));
        let source = "const stackOf = error => error.stack, has = error => 'line' in error;
            const set = error => (error.stack = 'set', error);
            var format = error => {
                for (let i = 0; i < 9; i++) stackOf(error), has(error);
                set(error);
                return 'text';
            };
            for (let i = 0; i < 9; i++) stackOf(new Error);
            format = error => 'text';
            [stackOf(new Error), has(new Error), stackOf(set(new Error))]";
        assert_eq!(run_to_text(cx, source), "text,true,set");
    });
}

#[test]
fn an_inquiry_does_not_ask_the_embedder() {
    with_realm(|cx| {
        use_embedder_format(cx);
        let error = run(cx, "new Error").unwrap().cast::<ErrorInstance>();
        assert_eq!(error.get_pure(cx, names::stack), None);
        assert!(!error.is_materialized());
    });
}

#[test]
fn a_syntax_error_is_where_the_parser_stopped() {
    with_realm(|cx| {
        let thrown = run(cx, "\n\n1 +* 2").unwrap_err();
        let error = cx.catch_value(thrown).unwrap().cast::<ErrorInstance>();
        assert!(error.is_parse_error());
        assert_eq!(error.get(cx, names::line).unwrap(), 3.into());
        let url = error.get(cx, names::sourceURL).unwrap();
        assert_eq!(text(cx, url), "test.js");

        use_embedder_format(cx);
        let source = "try { Function('\\n1 +* 2') } catch (e) { e.line + e.stack }";
        assert_eq!(
            run_to_text(cx, source),
            "1004SyntaxError: Unexpected token '*'|Function|global code"
        );
    });
}

#[test]
fn a_call_that_fails_is_named_without_a_stack() {
    with_realm(|cx| {
        let source = "Error.stackTraceLimit = 0; try { Math.a() } catch (e) { e.message }";
        assert_eq!(
            run_to_text(cx, source),
            "Math.a is not a function. (In 'Math.a()', 'Math.a' is undefined)"
        );
    });
}

#[test]
fn an_error_without_frames_can_get_some_later() {
    with_realm(|cx| {
        let error = ErrorInstance::new(cx, ErrorType::Error, None);
        assert_eq!(error.get(cx, names::stack).unwrap(), Value::UNDEFINED);
        assert!(!error.is_materialized());
        let source = run(cx, "(function f() { return new Error })()").unwrap();
        let frames = source.cast::<ErrorInstance>().stack_frames();
        error.set_stack_frames(cx, &frames[..1]);
        let stack = error.get(cx, names::stack).unwrap();
        assert_eq!(text(cx, stack), "f@test.js:1:24");

        let position = LineColumn { line: 3, column: 4 };
        let (url, stack) = (StringRef::from_literal("u"), StringRef::from_literal("s"));
        let copy = ErrorInstance::with_info(
            cx,
            ErrorType::UriError,
            None,
            position,
            Some(url),
            Some(stack),
        );
        (cx.global()).put_direct(cx, names::value, copy.into(), Attributes::NONE);
        assert_eq!(
            run_to_text(
                cx,
                "[value.name, value.line, value.column, value.sourceURL, value.stack]"
            ),
            "URIError,3,4,u,s"
        );
    });
}

#[test]
fn an_exception_has_a_stack_unless_it_is_sure_to_be_caught() {
    #[native_abi]
    fn last_depth(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
        let exception = cx.last_exception().unwrap();
        let before = exception.stack().len();
        Ok((before * 10 + exception.stack_for_reporting(cx).len()).into())
    }
    with_realm(|cx| {
        define(cx, "lastDepth", last_depth);
        let thrown = run(cx, "function f() { try { throw 1 } finally {} } f()").unwrap_err();
        let exception = cx.catch(thrown).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(
            stack_trace_text(cx, exception.stack()).to_string(),
            "f@test.js:1:29\nglobal code@test.js:1:46"
        );
        let caught = "try { (function () { throw new Error })() } catch {} lastDepth()";
        assert_eq!(run(cx, caught).unwrap(), 2.into());
        let through_native = "try { [1, 2].sort(() => { throw 1 }) } catch {} lastDepth()";
        assert_eq!(run(cx, through_native).unwrap(), 33.into());
    });
}

#[test]
fn urls_are_shortened_for_reports() {
    with_realm(|cx| {
        let long = format!("data:,{}%20{}", "a".repeat(1016), "b".repeat(100));
        for (url, expected) in [
            ("https://user:secret@host/a@b?q#f", "https://host/a@b"),
            ("file:///a/b.js#x?y", "file:///a/b.js"),
            ("/a/b?c.js", "/a/b?c.js"),
            (&long, &long[..1022]),
        ] {
            let (source, url) = (
                StringRef::from_str("new Error().stack"),
                StringRef::from_str(url),
            );
            let provider = SourceProvider::build(source, Some(url), SourceType::Program).finish();
            let stack =
                evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED).unwrap();
            assert_eq!(text(cx, stack), format!("global code@{expected}:1:10"));
        }
    });
}

#[test]
fn a_deadline_ends_the_script() {
    with_realm(|cx| {
        let cancelled = cx.add_termination_deadline(Duration::from_millis(1));
        cancelled.cancel();
        let did_fire = cancelled.did_fire();
        cx.cancel_termination();
        let (late, never) = (Duration::from_secs(3600), Duration::MAX);
        let others = [late, never].map(|after| cx.add_termination_deadline(after));
        let deadline = cx.add_termination_deadline(Duration::from_millis(5));
        let source = "var caught; try { for (;;); } catch { caught = 1 } finally { caught = 2 }";
        let thrown = run(cx, source).unwrap_err();
        assert!(cx.catch(thrown).is_err());
        assert!(deadline.did_fire() && !cx.has_termination_request());
        assert!(cx.cancel_termination() && !cx.has_pending_termination());
        assert_eq!(run(cx, "caught").unwrap(), Value::UNDEFINED);
        assert!(cancelled.did_fire() == did_fire && others.iter().all(|it| !it.did_fire()));
    });
}

#[test]
fn termination_waits_while_it_is_deferred() {
    with_realm(|cx| {
        cx.traps().request_termination();
        {
            let _defer = cx.defer_termination();
            assert_eq!(run(cx, "(() => 1)()").unwrap(), 1.into());
        }
        {
            let _defer = cx.defer_traps();
            assert_eq!(run(cx, "(() => 2)()").unwrap(), 2.into());
        }
        assert!(cx.handle_traps().is_err());
        assert!(cx.has_pending_termination_exception());
        let _ = cx.throw_type_error("does not take its place");
        {
            let _defer = cx.defer_termination();
            assert!(!cx.has_exception());
        }
        assert!(cx.has_pending_termination_exception());

        cx.clear_exception();
        cx.begin_termination_deferral();
        cx.end_termination_deferral(AfterDeferral::RaiseTrap);
        assert!(!cx.has_exception() && cx.traps().clear(Trap::TERMINATION));
        cx.begin_termination_deferral();
        cx.end_termination_deferral(AfterDeferral::Throw);
        assert!(cx.has_pending_termination_exception());
        {
            let _suspend = cx.suspend_exception();
            assert!(!cx.has_exception() && cx.last_exception().is_none());
        }
        assert!(cx.cancel_termination());
    });
}

#[test]
fn a_native_closure_keeps_what_it_captures() {
    with_realm(|cx| {
        let make = |index: u32| -> Value {
            let captured = JsString::from_text(cx, Text::from_ascii(&format!("captured {index}")));
            let name = StringRef::from_literal("closure");
            let body = move |cx: &mut Cx, frame: &CallFrame, captures: &[Value]| {
                let values = [index.into(), captures[0], frame.argument(0)];
                cx.new_array_from(&values).map(Into::into)
            };
            JsNativeClosure::create(cx, 1, &name, &[captured.into()], body).into()
        };
        let mut closures = root_vec::<Value>();
        closures.extend((0..1000).map(make));
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let result = cx
            .call(closures[999], Value::UNDEFINED, &[Value::TRUE])
            .unwrap();
        assert_eq!(text(cx, result), "999,captured 999,true");
        assert_eq!(
            text(cx, closures[0]),
            "function closure() { [native code] }"
        );
    });
}

thread_local! {
    static LOG: RefCell<Vec<String>> = RefCell::default();
}

fn log(entry: String) -> JsResult<()> {
    LOG.with_borrow_mut(|log| log.push(entry));
    Ok(())
}

static CONSOLE: ConsoleHooks = ConsoleHooks {
    message: |_, kind, level, values| log(format!("{kind:?} {level:?} {values:?}")),
    count: |_, label| log(format!("count {label}")),
    count_reset: |_, label| log(format!("count_reset {label}")),
    profile: |_, title| log(format!("profile {title:?}")),
    profile_end: |_, title| log(format!("profile_end {title:?}")),
    take_heap_snapshot: |_, title| log(format!("take_heap_snapshot {title:?}")),
    time: |_, label| log(format!("time {label}")),
    time_log: |_, label, values| log(format!("time_log {label} {values:?}")),
    time_end: |cx, _| Err(cx.throw_range_error("from the client")),
};

#[test]
fn the_console_calls_its_client() {
    with_realm(|cx| {
        cx.embedder().console.set(Some(&CONSOLE));
        run(cx, "console.log(0); console.count(Symbol())").unwrap();
        (cx.global().console_client()).set(core::ptr::dangling_mut());
        let source = "console.log(); console.warn(1, 2); console.dir(); console.table(3); console.clear(4);
            console.assert(true, 5); console.assert(false, 6); console.groupCollapsed(); console.count();
            console.countReset(null); console.timeLog('a', 7); console.profile(null); console.profileEnd(8);
            console.recordEnd(9); try { console.timeEnd() } catch (e) { e.message }";
        assert_eq!(run_to_text(cx, source), "from the client");
        assert_eq!(
            LOG.take(),
            [
                "Log Log []",
                "Log Warning [1, 2]",
                "Table Log [3]",
                "Clear Log []",
                "Assert Error [6]",
                "StartGroupCollapsed Log []",
                "count default",
                "count_reset null",
                "time_log a [7]",
                "profile None",
                "profile_end Some(\"8\")",
            ]
        );
    });
}

#[test]
fn caches_tell_errors_with_frames_from_those_without() {
    with_realm(|cx| {
        let source = "function make(limit) { Error.stackTraceLimit = limit; return new Error('m') }
            function read(e) { return [typeof e.stack, 'line' in e, e.hasOwnProperty('column'), typeof Object.create(e).stack] }
            function write(e) { e.stack = 1; return e.propertyIsEnumerable('stack') }
            function remove(e) { delete e.stack; return typeof e.stack }
            var seen = new Set;
            for (let i = 0; i < 300; i++) {
                if (i === 150) Error.prototype.stack = 0;
                const limit = i % 50 === 49 ? 10 : 0;
                seen.add([limit, read(make(limit)), write(make(limit)), remove(make(limit))].join());
            }
            [...seen].join(' ')";
        assert_eq!(
            run_to_text(cx, source),
            "0,undefined,false,false,undefined,true,undefined \
             10,string,true,true,string,false,undefined \
             0,number,false,false,number,true,number \
             10,string,true,true,string,false,number"
        );
    });
}

#[test]
fn loops_of_the_library_can_be_terminated() {
    const SETUP: &str = "
        var forever = { next: Object.bind(null, { done: false, value: [{}] }) };
        forever[Symbol.iterator] = Object.bind(null, forever);
        var holes = new Array(2 ** 32 - 1);";
    with_realm(|cx| {
        run(cx, SETUP).unwrap();
        for source in [
            "new Set(forever)",
            "new WeakMap(forever)",
            "new Set([1]).isDisjointFrom({ size: 0, has: Boolean, keys: Object.bind(null, forever) })",
            "new Set(holes)",
            "holes.values().includes(1)",
            "new Uint8Array(2 ** 32).set({ length: 2 ** 32 })",
        ] {
            let deadline = cx.add_termination_deadline(Duration::from_millis(5));
            assert!(run(cx, source).is_err(), "{source}");
            assert!(deadline.did_fire() && cx.cancel_termination());
        }
    });
}

#[test]
fn a_debugger_is_told_that_a_variable_has_no_value_yet() {
    /// In the frame that is so many above its own.
    #[native_abi]
    fn evaluate_in_frame(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        let index = frame.argument(0).to_uint32(cx)? as usize;
        let text = frame.argument(1).to_string_ref(cx)?;
        DebuggerFrame::stack_from(cx, 0)[index].evaluate(cx, text)
    }

    with_realm(|cx| {
        cx.global().needs_debug_hooks().set(true);
        define(cx, "evaluateInFrame", evaluate_in_frame);
        let source = "class A {
                field = evaluateInFrame(2, 'try { typeof a } catch (e) { e.name }');
                constructor(a) { function a() {} }
            }
            new A().field";
        assert_eq!(run_to_text(cx, source), "ReferenceError");
    });
}
