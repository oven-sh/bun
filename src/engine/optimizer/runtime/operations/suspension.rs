//! For code that suspends, and for exceptions.

use bun_engine_macros::native_abi;
use bun_engine_vm::{
    self as vm, CallFrame, Coroutine, Cx, Gc, JsAsyncFunctionGenerator, JsAsyncGenerator,
    JsGenerator, JsPromise, JsResult, Value,
};

use super::{Address, Answer, Operation, Returned};

operations! {
    CREATE_GENERATOR: fn create_generator(cx: &mut Cx, frame: &CallFrame) -> JsResult<Gc<JsGenerator>> {
        JsGenerator::for_frame(cx, frame)
    }
    CREATE_ASYNC_GENERATOR: fn create_async_generator(
        cx: &mut Cx, frame: &CallFrame
    ) -> JsResult<Gc<JsAsyncGenerator>> {
        JsAsyncGenerator::for_frame(cx, frame)
    }
    AWAIT: fn await_value(cx: &mut Cx, generator: Gc<JsAsyncFunctionGenerator>, value: Value) -> Answer {
        generator.await_value(cx, value).map(|()| true).into()
    }
    ASYNC_RETURN: fn async_return(cx: &mut Cx, generator: Option<Value>, value: Value) -> JsResult<Gc<JsPromise>> {
        vm::async_return(cx, generator, value)
    }
    ASYNC_THROW: fn async_throw(cx: &Cx, generator: Option<Value>, reason: Value) -> Gc<JsPromise> {
        vm::async_throw(cx, generator, reason)
    }
    REQUEST_STEP: fn request_step(
        cx: &mut Cx, iterator: Value, asker: Gc<Coroutine>, value: Option<Value>
    ) -> JsResult<Value> {
        vm::request_async_step(cx, iterator, asker, value)
    }
    THROW: fn throw(cx: &Cx, value: Value) -> JsResult<Value> {
        Err(cx.throw(value))
    }
}
