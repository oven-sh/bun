//! What built-ins that are written in JavaScript, and the embedder, call.

use bun_engine_bytecode::Visibility;
use bun_engine_text::StringRef;
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{JsAsyncFromSyncIterator, JsFunction, JsPromise, NativeFunction, RealmSlot};

use crate::prelude::*;

macro_rules! private_functions {
    ($($slot:ident, $init:ident: $function:ident, $intrinsic:ident;)*) => {
        pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
            match slot {
                $(RealmSlot::$slot => cx.global().$init(create(cx, $function, Intrinsic::$intrinsic)),)*
                _ => return false,
            }
            true
        }
    };
}

private_functions! {
    private_resolve_promise, init_private_resolve_promise: resolve_promise, None;
    private_reject_promise, init_private_reject_promise: reject_promise, None;
    private_resolve_promise_once, init_private_resolve_promise_once: resolve_promise_once,
        ResolvePromiseWithFirstResolvingFunctionCallCheck;
    private_reject_promise_once, init_private_reject_promise_once: reject_promise_once,
        RejectPromiseWithFirstResolvingFunctionCallCheck;
    private_perform_promise_then, init_private_perform_promise_then: perform_promise_then, None;
    private_promise_resolve, init_private_promise_resolve: promise_resolve, PromiseResolve;
    private_promise_reject, init_private_promise_reject: promise_reject, PromiseReject;
    private_async_from_sync_iterator_create, init_private_async_from_sync_iterator_create:
        async_from_sync_iterator_create, None;
}

fn create(cx: &Cx, function: NativeFunction, intrinsic: Intrinsic) -> Gc<JsFunction> {
    let (name, constructor) = (StringRef::empty(), native_not_a_constructor);
    let visibility = Visibility::Private;
    JsFunction::native_with(cx, 0, &name, function, constructor, intrinsic, visibility)
}

#[inline(always)]
fn promise_and_value(frame: &CallFrame) -> (Gc<JsPromise>, Value) {
    (frame.argument(0).cast(), frame.argument(1))
}

#[native_abi]
fn resolve_promise(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (promise, value) = promise_and_value(frame);
    promise.resolve_promise(cx, value)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn reject_promise(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (promise, reason) = promise_and_value(frame);
    promise.reject_promise(cx, reason);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn resolve_promise_once(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (promise, value) = promise_and_value(frame);
    promise.resolve(cx, value)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn reject_promise_once(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (promise, reason) = promise_and_value(frame);
    promise.reject(cx, reason);
    Ok(Value::UNDEFINED)
}

/// The promise, the two handlers, what gets their result and, optionally, a second argument for them.
#[native_abi]
fn perform_promise_then(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (promise, on_fulfilled) = promise_and_value(frame);
    let [on_rejected, result, context] = [2, 3, 4].map(|index| frame.argument(index));
    promise.perform_then_with_context(cx, on_fulfilled, on_rejected, result, context);
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn promise_resolve(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (constructor, value) = (frame.argument(0).cast(), frame.argument(1));
    JsPromise::resolve_with_constructor(cx, constructor, value).map(Into::into)
}

#[native_abi]
fn promise_reject(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (constructor, reason) = (frame.argument(0).cast(), frame.argument(1));
    JsPromise::reject_with_constructor(cx, constructor, reason).map(Into::into)
}

#[native_abi]
fn async_from_sync_iterator_create(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(iterator) = frame.argument(0).as_object() else {
        let message = "Only objects can be wrapped by async-from-sync wrapper";
        return Err(cx.throw_type_error(message));
    };
    JsAsyncFromSyncIterator::for_iterator(cx, iterator).map(Into::into)
}
