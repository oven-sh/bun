//! Closures, promises, abort signals and typed arrays, for the algorithms of Web APIs.

use super::*;
use crate::generated_bindgen::native_callback::js_NativeCallback;
use crate::{AbortSignal, JSPromise, JSType};

unsafe extern "C" {
    safe fn Bun__Bindgen__reactToPromise(
        global: &JSGlobalObject,
        promise: JSValue,
        on_fulfilled: JSValue,
        on_rejected: JSValue,
    );
    safe fn Bun__Bindgen__promiseResolve(global: &JSGlobalObject, value: JSValue) -> JSValue;
    safe fn Bun__Bindgen__getCommonProperty(
        global: &JSGlobalObject,
        value: JSValue,
        property: CommonProperty,
    ) -> JSValue;
    safe fn Bun__Bindgen__isSafeToRecurse(global: &JSGlobalObject) -> bool;
    safe fn Bun__Bindgen__detach(global: &JSGlobalObject, buffer: JSValue);
    safe fn Bun__Bindgen__signalAbort(global: &JSGlobalObject, signal: JSValue, reason: JSValue);
    safe fn Bun__Bindgen__addAbortAlgorithm(signal: JSValue, algorithm: JSValue) -> u32;
    safe fn Bun__Bindgen__removeAbortAlgorithm(signal: JSValue, id: u32);
    fn Bun__Bindgen__createDependentSignal(
        global: &JSGlobalObject,
        sources: *const JSValue,
        count: usize,
    ) -> JSValue;
}

/// Gets what [`JsHeap::create_callback`] was given, and what it is called with.
pub type CallbackBody = for<'a> fn(
    cx: &mut JsScope<'a>,
    captured: [JsLocal<'a>; 2],
    data: u64,
    arguments: &'a [JsLocal<'a>],
) -> Result<'a, JSValue>;

pub struct NativeCallback {
    body: CallbackBody,
    data: u64,
}

impl NativeCallback {
    pub(crate) fn call_instance<'a>(
        &self,
        this: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        arguments: &'a [JsLocal<'a>],
    ) -> Result<'a, JSValue> {
        let captured = [
            js_NativeCallback::first_get_cached(this.to_js()),
            js_NativeCallback::second_get_cached(this.to_js()),
        ];
        let captured = captured.map(|it| JsLocal::from_raw(it.unwrap_or(JSValue::UNDEFINED)));
        (self.body)(cx, captured, self.data, arguments)
    }
}

impl<'a> JsHeap<'a> {
    /// A function that keeps `captured` alive. It is not for scripts to see.
    pub fn create_callback(
        &self,
        body: CallbackBody,
        captured: [JSValue; 2],
        data: u64,
    ) -> JsLocal<'a, Callable> {
        let global = self.global_object();
        let callback = crate::JsClass::to_js(NativeCallback { body, data }, global);
        js_NativeCallback::first_set_cached(callback, global, captured[0]);
        js_NativeCallback::second_set_cached(callback, global, captured[1]);
        JsLocal::from_raw(callback)
    }

    pub fn queue_microtask(&self, callback: JsLocal<'a, Callable>, argument: JSValue) {
        self.global_object()
            .queue_microtask(callback.0, &[argument]);
    }

    pub fn create_promise(&self) -> JsLocal<'a, JSPromise> {
        JsLocal::from_raw(JSPromise::create(self.global_object()).to_js())
    }

    pub fn create_abort_signal(&self) -> JsLocal<'a, AbortSignal> {
        JsLocal::from_raw(AbortSignal::create(self.global_object()))
    }

    /// <https://dom.spec.whatwg.org/#create-a-dependent-abort-signal>
    pub fn create_dependent_signal(
        &self,
        sources: &[JsLocal<'a, AbortSignal>],
    ) -> JsLocal<'a, AbortSignal> {
        // SAFETY: a `JsLocal` is a transparent `JSValue`, and these are signals.
        JsLocal::from_raw(unsafe {
            Bun__Bindgen__createDependentSignal(
                self.global_object(),
                sources.as_ptr().cast(),
                sources.len(),
            )
        })
    }

    /// Takes over the allocation, which is not empty and has a whole number of elements.
    pub fn create_typed_array_from_box(
        &self,
        kind: JSType,
        bytes: Box<[u8]>,
    ) -> Result<'a, JsLocal<'a, BufferSource>> {
        let buffer = ArrayBuffer::from_bytes(Box::leak(bytes), kind);
        let (context, free) = (
            buffer.ptr.cast(),
            crate::array_buffer::MarkedArrayBuffer_deallocator,
        );
        // SAFETY: an allocation of the default allocator that nothing else owns, which `free` frees.
        JsLocal::from_js_result(unsafe {
            buffer.to_js_with_context(self.global_object(), context, Some(free))
        })
    }
}

/// `None` for no bytes, or if there is no memory.
pub fn try_zeroed_bytes(len: usize) -> Option<Box<[u8]>> {
    let layout = core::alloc::Layout::array::<u8>(len).ok()?;
    (len > 0).then_some(())?;
    // SAFETY: the size is not zero, and a `Box<[u8]>` of that length has this layout.
    unsafe {
        let bytes = std::alloc::alloc_zeroed(layout);
        (!bytes.is_null()).then(|| Box::from_raw(core::ptr::slice_from_raw_parts_mut(bytes, len)))
    }
}

#[repr(u8)]
#[derive(Clone, Copy)]
pub enum CommonProperty {
    Iterator,
    AsyncIterator,
    Next,
    Return,
    Done,
    Value,
}

impl<'a> JsScope<'a> {
    /// What was thrown. A termination cannot be caught.
    #[cold]
    pub fn catch(&mut self, error: Error<'a>) -> Result<'a, JSValue> {
        let global = self.global();
        let value = match error.0 {
            ErrorState::ToThrow(value) => return Ok(value),
            ErrorState::Pending(JsError::Terminated) => return Err(error),
            ErrorState::Pending(pending) => global.take_error(pending),
        };
        if value.is_termination_exception() {
            return Err(crate::top_exception_scope::thrown(global).into());
        }
        Ok(value)
    }

    /// For what recurses as deep as a script wants it to.
    pub fn check_stack(&mut self) -> Result<'a, ()> {
        let global = self.global();
        if Bun__Bindgen__isSafeToRecurse(global) {
            return Ok(());
        }
        Err(global.throw_stack_overflow().into())
    }

    /// `PromiseResolve(%Promise%, value)`
    pub fn promise_resolve(&mut self, value: JSValue) -> Result<'a, JsLocal<'a, JSPromise>> {
        let global = self.global();
        JsLocal::from_js_result(crate::call_zero_is_throw(global, || {
            Bun__Bindgen__promiseResolve(global, value)
        }))
    }
}

impl<'a> JsLocal<'a> {
    pub fn get(self, cx: &mut JsScope<'a>, property: CommonProperty) -> Result<'a, Self> {
        let global = cx.global();
        JsLocal::from_js_result(crate::call_zero_is_throw(global, || {
            Bun__Bindgen__getCommonProperty(global, self.0, property)
        }))
    }

    pub fn as_any_object(self) -> Option<JsLocal<'a, JSObject>> {
        self.0.is_object().then(|| JsLocal::from_raw(self.0))
    }

    pub fn as_promise(self) -> Option<JsLocal<'a, JSPromise>> {
        self.0.as_promise().map(|_| JsLocal::from_raw(self.0))
    }

    pub fn as_buffer_source(self) -> Option<JsLocal<'a, BufferSource>> {
        (self.0.is_cell() && self.0.js_type().is_array_buffer_like())
            .then(|| JsLocal::from_raw(self.0))
    }

    pub fn as_abort_signal(self) -> Option<JsLocal<'a, AbortSignal>> {
        AbortSignal::from_js(&self.0).map(|_| JsLocal::from_raw(self.0))
    }
}

impl<'a> JsLocal<'a, BufferSource> {
    /// As many bytes as both have behind their offsets. They may be the same memory.
    pub fn copy_from(self, heap: &JsHeap<'a>, offset: usize, source: Self, source_offset: usize) {
        let [to, from] = [(self, offset), (source, source_offset)].map(|(buffer, offset)| {
            buffer.with_bytes(heap, |it| {
                core::ptr::from_ref(it.get(offset..).unwrap_or_default())
            })
        });
        // SAFETY: nothing ran since, and the bytes of a buffer can be written.
        unsafe {
            core::ptr::copy(
                from.cast::<u8>(),
                to.cast::<u8>().cast_mut(),
                from.len().min(to.len()),
            );
        }
    }

    /// As many of them as fit.
    pub fn write(self, heap: &JsHeap<'a>, mut bytes: Vec<u8>) {
        // SAFETY: nothing else is read but `bytes`, which no buffer has.
        unsafe {
            self.with_bytes_mut(heap, |to| {
                bytes.truncate(to.len());
                to[..bytes.len()].copy_from_slice(&bytes);
            });
        }
    }

    /// What it had, or `None` if it was detached before.
    pub fn detach(self, cx: &mut JsScope<'a>) -> Option<Vec<u8>> {
        let global = cx.global();
        let buffer = self.0.as_array_buffer(global)?;
        let bytes = (!buffer.is_detached()).then(|| buffer.byte_slice().to_vec())?;
        Bun__Bindgen__detach(global, self.0);
        Some(bytes)
    }
}

impl<'a> JsLocal<'a, JSPromise> {
    fn promise(self) -> &'a mut JSPromise {
        JSPromise::opaque_mut(self.0.as_promise().expect("a promise"))
    }

    pub fn is_pending(self) -> bool {
        self.promise().status() == crate::js_promise::Status::Pending
    }

    /// Does nothing once it has been resolved or rejected.
    pub fn resolve(self, cx: &mut JsScope<'a>, value: JSValue) -> Result<'a, ()> {
        if self.is_pending() {
            self.promise().resolve(cx.global(), value)?;
        }
        Ok(())
    }

    /// As [`resolve`](Self::resolve).
    pub fn reject(self, cx: &mut JsScope<'a>, reason: JSValue) -> Result<'a, ()> {
        if self.is_pending() {
            self.promise().reject(cx.global(), Ok(reason))?;
        }
        Ok(())
    }

    /// `PerformPromiseThen` without a result.
    pub fn react(
        self,
        heap: &JsHeap<'a>,
        on_fulfilled: Option<JsLocal<'a, Callable>>,
        on_rejected: Option<JsLocal<'a, Callable>>,
    ) {
        let [on_fulfilled, on_rejected] =
            [on_fulfilled, on_rejected].map(|it| it.map_or(JSValue::UNDEFINED, JsLocal::to_js));
        Bun__Bindgen__reactToPromise(heap.global_object(), self.0, on_fulfilled, on_rejected);
    }

    pub fn mark_as_handled(self) {
        self.promise().set_handled();
    }
}

impl<'a> JsLocal<'a, AbortSignal> {
    fn signal(&self) -> crate::WrapperGuard<'_, AbortSignal> {
        AbortSignal::from_js(&self.0).expect("a signal")
    }

    pub fn is_aborted(self) -> bool {
        self.signal().aborted()
    }

    pub fn reason(self, heap: &JsHeap<'a>) -> JSValue {
        self.signal().js_reason(heap.global_object())
    }

    /// <https://dom.spec.whatwg.org/#abortsignal-signal-abort>, with an `AbortError` for `undefined`.
    pub fn abort(self, cx: &mut JsScope<'a>, reason: JSValue) {
        Bun__Bindgen__signalAbort(cx.global(), self.0, reason);
    }

    /// It gets the reason, at once if there is one, and what it throws is reported.
    pub fn add_algorithm(self, _: &mut JsScope<'a>, algorithm: JsLocal<'a, Callable>) -> u32 {
        Bun__Bindgen__addAbortAlgorithm(self.0, algorithm.0)
    }

    pub fn remove_algorithm(self, id: u32) {
        Bun__Bindgen__removeAbortAlgorithm(self.0, id);
    }
}
