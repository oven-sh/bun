#![allow(dead_code, clippy::disallowed_methods, clippy::disallowed_types)]

#[path = "../../../wasm_runtime/tests/support/text.rs"]
mod text;

use bun_engine_macros::native_abi;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;
use bun_engine_wasm::WasmStreamingCompiler;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(GlobalObject::create_for_shadow_realm(cx, &HOOKS)),
    compile_wasm_streaming: Some(|cx, promise, source, options| {
        let compiler = WasmStreamingCompiler::new(cx, promise, false, None, options);
        stream(cx, &compiler, source);
    }),
    instantiate_wasm_streaming: Some(|cx, promise, source, imports, options| {
        let compiler = WasmStreamingCompiler::new(cx, promise, true, imports, options);
        stream(cx, &compiler, source);
    }),
};

/// A view stands for a response, and anything else is why there is none.
fn stream(cx: &mut Cx, compiler: &WasmStreamingCompiler, source: Value) {
    let Some(view) = source.downcast::<JsArrayBufferView>() else {
        return compiler.fail(cx, source);
    };
    let bytes = view.bytes(&cx.no_gc()).try_to_vec().unwrap();
    bytes.chunks(3).for_each(|it| compiler.add_bytes(it));
    compiler.finish(cx);
}

/// What every script of the tests starts with.
const HARNESS: &str = include_str!("harness.js");

fn with_realm(options: Options, body: impl FnOnce(&mut Cx)) {
    set_options(options);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

fn evaluate(cx: &mut Cx, source: &str, url: &str) -> JsResult<Value> {
    let (text, url) = (StringRef::from_str(source), StringRef::from_str(url));
    let provider = SourceProvider::build(text, Some(url), SourceType::Program).finish();
    evaluate_script(cx, &SourceCode::whole(provider), Value::UNDEFINED)
}

fn describe(cx: &mut Cx, _: Thrown) -> String {
    let Some(exception) = cx.clear_exception() else {
        return "an exception that is gone".into();
    };
    let value = exception.value();
    match value.to_string_view(cx) {
        Ok(text) => text.text().to_string(),
        Err(_) => "an error that has no text".into(),
    }
}

/// The bytes of a module in the text form.
#[native_abi]
fn assemble(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let source = frame.argument(0).to_string_view(cx)?.text().to_string();
    let mut bytes = root_vec();
    bytes.extend((text::assemble(&source).into_iter()).map(|byte| Value::int32(byte.into())));
    Ok(cx.new_array_from(&bytes)?.into())
}

#[native_abi]
fn collect(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let is_full = frame.argument(0).to_boolean(cx);
    (cx.heap).collect_and_sweep(Some(if is_full { Scope::Full } else { Scope::Eden }));
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn terminate(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(cx.throw_termination())
}

/// Whether the call of the function is terminated.
#[native_abi]
fn is_terminated(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let result = cx.call(frame.argument(0), Value::UNDEFINED, &[]);
    let has_thrown = result.is_err() && cx.has_pending_termination_exception();
    cx.cancel_termination();
    Ok(has_thrown.into())
}

/// What a script may ask of the test.
pub(crate) fn helpers(cx: &mut Cx) {
    let functions: [(_, NativeFunction); _] = [
        ("assemble", assemble),
        ("collect", collect),
        ("terminate", terminate),
        ("isTerminated", is_terminated),
    ];
    for (name, function) in functions {
        let (name, attributes) = (Identifier::from_literal(name), Attributes::empty());
        let global = cx.global();
        global.put_direct_native_function(
            cx,
            name.name(),
            1,
            function,
            Intrinsic::None,
            attributes,
        );
    }
}

pub(crate) fn options() -> Options {
    let mut options = Options::default();
    options.use_wasm_memory64 = true;
    options.use_wasm_type_reflection = true;
    options
}

/// Runs the script after the harness. Its exception, if any, fails the test.
pub(crate) fn run(source: &str) {
    run_with(options(), source, helpers);
}

pub(crate) fn run_with(options: Options, source: &str, prepare: impl FnOnce(&mut Cx)) {
    with_realm(options, |cx| {
        let run_loop = RunLoop::install(cx);
        prepare(cx);
        if let Err(thrown) = evaluate(cx, HARNESS, "harness.js") {
            panic!("the harness threw {}", describe(cx, thrown));
        }
        if let Err(thrown) = evaluate(cx, source, "test.js") {
            panic!("{}", describe(cx, thrown));
        }
        if let Err(thrown) = cx.drain_microtasks().and_then(|()| run_loop.run(cx)) {
            panic!("a task threw {}", describe(cx, thrown));
        }
        if let Err(thrown) = evaluate(cx, "runChecks()", "checks.js") {
            panic!("{}", describe(cx, thrown));
        }
    });
}
