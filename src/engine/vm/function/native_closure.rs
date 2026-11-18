use bun_engine_bytecode::Visibility;
use bun_engine_macros::{cell, native_abi};
use bun_engine_text::StringRef;

use crate::call::native_not_a_constructor;
use crate::{CallFrame, Cx, Gc, GcFree, Intrinsic, JsFunction, JsResult, NativeExecutable, Value};

/// Gets the values that the function keeps alive.
pub trait NativeClosure: Fn(&mut Cx, &CallFrame, &[Value]) -> JsResult<Value> + GcFree {}

impl<F: Fn(&mut Cx, &CallFrame, &[Value]) -> JsResult<Value> + GcFree> NativeClosure for F {}

struct Body(Box<dyn NativeClosure>);

// SAFETY: a supertrait.
unsafe impl GcFree for Body {}

/// A native function with state of its own. Stack traces do not show it.
#[cell(name = "Function")]
pub struct JsNativeClosure {
    base: JsFunction,
    body: Body,
    #[cfg_attr(rootcheck, rootcheck::allow("made with collection deferred"))]
    captures: Box<[Value]>,
}

impl JsNativeClosure {
    pub fn create(
        cx: &Cx,
        length: u32,
        name: &StringRef,
        captures: &[Value],
        body: impl NativeClosure + 'static,
    ) -> Gc<JsFunction> {
        Self::create_boxed(cx, length, name, captures, Body(Box::new(body)))
    }

    fn create_boxed(
        cx: &Cx,
        length: u32,
        name: &StringRef,
        captures: &[Value],
        body: Body,
    ) -> Gc<JsFunction> {
        let executable = NativeExecutable::shared(
            cx,
            length,
            name.clone(),
            call,
            native_not_a_constructor,
            Intrinsic::None,
            Visibility::Private,
        );
        let base = JsFunction::native_init(cx, cx.native_closure_shape(), executable);
        // Until the cell exists nothing sees the copy.
        let _defer = cx.heap.defer_collection();
        cx.allocate::<JsNativeClosure>(JsNativeClosureInit {
            base,
            body,
            captures: captures.into(),
        })
        .upcast()
    }
}

#[native_abi]
#[cfg_attr(rootcheck, rootcheck::allow("the frame holds its callee"))]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let closure = frame.callee().cast::<JsNativeClosure>();
    (closure.body.0)(cx, frame, &closure.captures)
}
