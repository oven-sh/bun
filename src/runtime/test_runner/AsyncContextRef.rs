//! Put into the async context for the duration of one test or hook invocation,
//! so that the invocation's continuations can still be traced back to it.
//!
//! `expect()` belongs to whatever entry the runner is executing when it is
//! called. Once the runner has abandoned an invocation that is still running
//! (timeout, or an unhandled error while it was awaiting), that would be the
//! next entry; `RefData::abandoned` makes `bun_test::caller_ref` attribute such
//! late calls to the abandoned invocation instead, which rejects them.
//! Invocations that completed are never consulted, so callbacks they
//! registered keep belonging to whichever entry runs them.
//!
//! The slot manipulation lives next to `AsyncContextFrame` (AsyncContextFrame.cpp).

use bun_jsc::{JSGlobalObject, JSValue, JsClass as _, JsResult};

use crate::test_runner::bun_test::RefDataPtr;

#[bun_jsc::JsClass(no_construct, no_constructor)] // codegen wires to_js / from_js
pub struct AsyncContextRef {
    /// Owned `+1`, released in `finalize`.
    r#ref: RefDataPtr,
}

impl AsyncContextRef {
    // Codegen calls `finalize(Box<Self>)`; clippy::boxed_local is a false positive.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        self.r#ref.deref(); // `RefPtr` has no `Drop`
    }

    /// Puts `refdata` (a `+1`, consumed) into the context `callback` is about to
    /// run with, and returns what to invoke in its place. Pair with [`Self::leave`].
    pub(crate) fn enter(global: &JSGlobalObject, callback: JSValue, refdata: RefDataPtr) -> JsResult<JSValue> {
        let ref_js = AsyncContextRef { r#ref: refdata }.to_js(global);
        let callable = bun_jsc::cpp::Bun__AsyncContextRef__enter(global, callback, ref_js);
        ref_js.ensure_still_alive();
        callable
    }

    /// Call once the callback returned, before its microtasks run.
    pub(crate) fn leave(global: &JSGlobalObject) -> JsResult<()> {
        bun_jsc::cpp::Bun__AsyncContextRef__leave(global)
    }

    /// A `+1` to the abandoned invocation the running JS descends from, if any.
    pub(crate) fn abandoned_caller(global: &JSGlobalObject) -> Option<RefDataPtr> {
        let this = Self::from_js(bun_jsc::cpp::Bun__AsyncContextRef__current(global))?;
        // SAFETY: the live payload of a wrapper the current context array keeps alive.
        let refdata: &RefDataPtr = unsafe { &(*this).r#ref };
        if !refdata.abandoned.get() {
            return None;
        }
        Some(refdata.dupe_ref())
    }
}
