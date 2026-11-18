//! `compileStreaming` and `instantiateStreaming` (WebAssembly Web API). The embedder reads the response.

use core::cell::{Cell, RefCell};

use bun_engine_vm::{GcFree, JsDestructibleObject, JsFunctionWithFields, JsPromise, WorkKind};
use bun_engine_wasm_runtime::{CompileError, StreamingCompiler};

use crate::compile::{Goal, Pending, promise_for};
use crate::compile_options::CompileOptions;
use crate::engine::engine;
use crate::errors::{self, Kind};
use crate::module::{self, optional_object};
use crate::namespace::{Namespace, Slot};
use crate::prelude::*;

/// What waits for the response. It takes the options through the embedder, and no script sees it.
#[cell(name = "Object")]
struct Request {
    base: JsDestructibleObject,
    promise: Gc<JsPromise>,
    imports: Option<Gc<JsObject>>,
    options: Cell<CompileOptions>,
}

pub(crate) fn initialize(cx: &Cx, namespace: &Namespace) {
    let spec = ShapeSpec::of::<Request>();
    let shape = Shape::create(cx, Some(cx.global()), Value::NULL, spec);
    namespace.put(Slot::StreamingRequestShape, shape);
}

fn await_response(
    cx: &mut Cx,
    source: Value,
    imports: Option<Gc<JsObject>>,
    options: Option<Gc<JsObject>>,
    then: bun_engine_vm::NativeFunction,
) -> JsResult<Gc<JsPromise>> {
    let options = CompileOptions::read(cx, options)?;
    let response = JsPromise::resolved(cx, source)?;
    let promise = JsPromise::new(cx);
    let shape = Namespace::of(cx).shape(cx, Slot::StreamingRequestShape);
    let request = cx.allocate::<Request>(RequestInit {
        base: JsObjectInit::new(cx, shape),
        promise,
        imports,
        options: Cell::new(options),
    });
    let then = JsFunctionWithFields::new(cx, 1, then, [request.into(), Value::UNDEFINED]);
    let reject = promise.create_reject_function(cx);
    response.perform_then(cx, then.into(), reject.into(), Value::UNDEFINED);
    Ok(promise)
}

#[native_abi]
pub(crate) fn compile(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let promise = module::check_is_enabled(cx)
        .and_then(|()| optional_object(cx, frame.argument(1), "second", "compileStreaming"))
        .and_then(|options| await_response(cx, frame.argument(0), None, options, compile_response));
    promise_for(cx, promise)
}

#[native_abi]
pub(crate) fn instantiate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let promise = module::check_is_enabled(cx).and_then(|()| {
        let imports = optional_object(cx, frame.argument(1), "second", "instantiateStreaming")?;
        let options = optional_object(cx, frame.argument(2), "third", "instantiateStreaming")?;
        let source = frame.argument(0);
        await_response(cx, source, imports, options, instantiate_response)
    });
    promise_for(cx, promise)
}

fn request_of(frame: &CallFrame) -> Gc<Request> {
    JsFunctionWithFields::fields_of_callee(frame)[0].cast()
}

#[native_abi]
fn compile_response(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let request = request_of(frame);
    if let Some(hook) = cx.global().hooks().compile_wasm_streaming {
        hook(cx, request.promise, frame.argument(0), request.into());
    }
    cx.check_exception().map(|()| Value::UNDEFINED)
}

#[native_abi]
fn instantiate_response(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (request, response) = (request_of(frame), frame.argument(0));
    if let Some(hook) = cx.global().hooks().instantiate_wasm_streaming {
        let (promise, imports) = (request.promise, request.imports);
        hook(cx, promise, response, imports, request.into());
    }
    cx.check_exception().map(|()| Value::UNDEFINED)
}

/// Settles a promise when the bytes have arrived. Nothing happens any more once it has finished, failed or been
/// cancelled.
pub struct WasmStreamingCompiler(RefCell<Option<Receiving>>);

// SAFETY: the ticket has the cells.
unsafe impl GcFree for WasmStreamingCompiler {}

struct Receiving {
    /// `None` for want of memory.
    compiler: Option<StreamingCompiler>,
    pending: Pending,
}

impl WasmStreamingCompiler {
    /// `options` is what a hook of the realm was given, or undefined.
    pub fn new(
        cx: &Cx,
        promise: Gc<JsPromise>,
        wants_instance: bool,
        imports: Option<Gc<JsObject>>,
        options: Value,
    ) -> WasmStreamingCompiler {
        let options = (options.downcast::<Request>()).map_or_default(|it| it.options.take());
        let goal = match wants_instance {
            true => Goal::ModuleAndInstance {
                imports,
                runs_later: true,
            },
            false => Goal::Module,
        };
        WasmStreamingCompiler(RefCell::new(Some(Receiving {
            compiler: engine().map(StreamingCompiler::new),
            pending: Pending::new(cx, WorkKind::AtSomePoint, promise, options, goal),
        })))
    }

    /// An error waits for `finish`.
    pub fn add_bytes(&self, bytes: &[u8]) {
        let mut receiving = self.0.borrow_mut();
        if let Some(compiler) = receiving.as_mut().and_then(|it| it.compiler.as_mut()) {
            let _ = compiler.feed(bytes);
        }
    }

    pub fn finish(&self, cx: &Cx) {
        let Some(Receiving {
            compiler,
            mut pending,
        }) = self.0.take()
        else {
            return;
        };
        match compiler.map(StreamingCompiler::finish) {
            Some(Ok(parsed)) => {
                pending.is_imminent_now(cx);
                parsed.validate(|compiled| pending.complete(compiled));
            }
            Some(Err(error)) => {
                let error = errors::create(cx, Kind::Compile, format_args!("{error}"));
                pending.reject(cx, error.into());
            }
            None => pending.complete(Err(CompileError::OutOfMemory)),
        }
    }

    pub fn fail(&self, cx: &Cx, reason: Value) {
        if let Some(receiving) = self.0.take() {
            receiving.pending.reject(cx, reason);
        }
    }

    pub fn cancel(&self) {
        if let Some(receiving) = self.0.take() {
            receiving.pending.cancel();
        }
    }
}

impl Drop for WasmStreamingCompiler {
    fn drop(&mut self) {
        self.cancel();
    }
}
