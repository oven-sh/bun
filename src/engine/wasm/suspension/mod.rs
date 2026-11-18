//! JavaScript Promise Integration.

mod activation;
mod resume;

use bun_engine_bytecode::Visibility;
use bun_engine_text::StringRef;
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::heap::ParkedStack;
use bun_engine_vm::{
    Intrinsic, JsFunctionWithFields, JsPromise, NativeExecutable, NativeFunction, Thrown,
    errors as vm_errors,
};
use bun_engine_wasm_runtime::suspension::Frames;

use self::activation::Activation;
pub(crate) use self::resume::initialize as initialize_resumer;
use crate::define::new_constructor;
use crate::errors::{self, Kind};
use crate::function::WasmFunction;
use crate::namespace::{Namespace, Slot, shape_for_new_target};
use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::position_of(names::constructor),
]);

define_object!(Prototype, "WebAssembly.Suspending", PROTOTYPE_PROPERTIES);

#[cell(name = "WebAssembly.Suspending")]
pub(crate) struct Suspending {
    base: JsObject,
    wrapped: Gc<JsObject>,
}

impl Suspending {
    /// It can be called.
    pub(crate) fn wrapped(&self) -> Gc<JsObject> {
        self.wrapped
    }
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let prototype = Prototype::create(cx, cx.object_prototype().into());
    let spec = ShapeSpec::of::<Suspending>();
    let shape = Shape::create(cx, Some(cx.global()), prototype.into(), spec);
    namespace.put(Slot::SuspendingShape, shape);
    let name = names::wasmSuspending;
    let constructor = new_constructor(cx, call, construct, 1, name, &prototype);
    namespace.put(Slot::SuspendingConstructor, constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(vm_errors::throw_called_without_new(
        cx,
        "WebAssembly.Suspending",
    ))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [wrapped] = *frame.arguments() else {
        return Err(cx.throw_type_error("new WebAssembly.Suspending() requires 1 argument"));
    };
    let Some(wrapped) = wrapped.as_object().filter(|it| it.is_callable()) else {
        return Err(cx.throw_type_error("Argument 0 must be a function"));
    };
    let shape = shape_for_new_target(cx, frame, Slot::SuspendingShape)?;
    let base = JsObjectInit::new(cx, shape);
    Ok((cx.allocate::<Suspending>(SuspendingInit { base, wrapped })).into())
}

/// One that stack traces do not show.
fn hidden_function(
    cx: &Cx,
    name: &'static str,
    function: NativeFunction,
    fields: [Value; 2],
) -> Value {
    let executable = NativeExecutable::shared(
        cx,
        1,
        StringRef::from_literal(name),
        function,
        native_not_a_constructor,
        Intrinsic::None,
        Visibility::Private,
    );
    JsFunctionWithFields::create(cx, executable, fields).into()
}

#[native_abi]
pub(crate) fn promising(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let wrapped = frame.argument(0);
    if !wrapped.is::<WasmFunction>() {
        return Err(cx.throw_type_error("Argument 0 must be a WebAssembly exported function"));
    }
    resume::make_stub(cx)?;
    let (name, fields) = ("WebAssembly.promising", [wrapped, Value::UNDEFINED]);
    Ok(hidden_function(cx, name, call_promising, fields))
}

#[native_abi]
fn call_promising(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [wrapped, _] = JsFunctionWithFields::fields_of_callee(frame);
    let promise = JsPromise::new(cx);
    run(cx, promise, wrapped, Value::UNDEFINED, frame.arguments())?;
    Ok(promise.into())
}

/// Settles the promise, unless the call is suspended.
fn run(
    cx: &mut Cx,
    promise: Gc<JsPromise>,
    callee: Value,
    this: Value,
    arguments: &[Value],
) -> JsResult<()> {
    match Activation::run(cx, promise, |cx| cx.call(callee, this, arguments)) {
        Some(Ok(value)) => promise.resolve(cx, value),
        Some(Err(thrown)) => promise.reject_with_caught(cx, thrown),
        None => Ok(()),
    }
}

pub(crate) fn throw_not_in_promising_call(cx: &Cx) -> Thrown {
    let message = "Suspending function called outside of a promising() context";
    errors::throw(cx, Kind::Suspend, message)
}

/// Succeeds if the frames have been saved, to go on when the promise is settled that `wrapped` returns.
pub(crate) fn suspend(
    cx: &mut Cx,
    frames: Option<Frames<'_>>,
    wrapped: Value,
    arguments: &[Value],
) -> JsResult<()> {
    let activation = Activation::innermost(cx).filter(|it| it.has_made_last_entry(cx));
    let Some(activation) = activation else {
        return Err(throw_not_in_promising_call(cx));
    };
    let Some(frames) = frames.filter(|it| it.caller() == cx.top_entry_frame()) else {
        let message =
            "JavaScript frames found between WebAssembly.Suspending and WebAssembly.promising";
        return Err(errors::throw(cx, Kind::Suspend, message));
    };
    let returned = cx.call(wrapped, Value::UNDEFINED, arguments)?;
    let awaited = match returned.downcast::<JsPromise>() {
        Some(promise) => promise,
        None => JsPromise::new_resolved(cx, returned)?,
    };
    let stack = ParkedStack::create(cx, frames.word_count(), |words| frames.save(words));
    let fields = [cx.or_out_of_memory(stack)?.as_value(), activation.suspend()];
    let [on_fulfilled, on_rejected] = [resume_with::<false>, resume_with::<true>]
        .map(|function| hidden_function(cx, "", function, fields));
    awaited.perform_then(cx, on_fulfilled, on_rejected, Value::UNDEFINED);
    Ok(())
}

#[native_abi]
fn resume_with<const THROWS: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [stack, promise] = JsFunctionWithFields::fields_of_callee(frame);
    let resumer = Namespace::of(cx).get(cx, Slot::Resumer).as_value();
    let arguments = [frame.argument(0), THROWS.into()];
    run(cx, promise.cast(), resumer, stack, &arguments)?;
    Ok(Value::UNDEFINED)
}
