//! What `bun:test` puts into the async context while a test or hook callback
//! runs, so that everything the callback awaits, schedules or registers keeps
//! pointing back at that invocation of it.
//!
//! `expect()` attributes itself to whatever entry the runner is executing at
//! the moment it is called. When the runner abandons an invocation that is
//! still running (it timed out, or an unhandled error failed it while it was
//! awaiting), that rule would attribute the rest of its body (snapshot names,
//! `expect()` counts) to whatever entry runs next. So every invocation runs
//! with one of these in its context and `Execution` flips [`RefData::abandoned`]
//! when it gives up on the invocation; `bun_test::caller_ref` then attributes
//! JS running under an abandoned invocation's context to that invocation, whose
//! `RefData` no longer resolves to a running entry, instead of to the entry
//! running now. Invocations that completed are never consulted, so a callback
//! registered by one entry and invoked during a later one (a server started in
//! `beforeAll`, ...) still attributes to the entry that is running, as before.
//!
//! The ref is the only thing added to the context: what the callback itself
//! does to the context (`als.enterWith()` in a `beforeEach`) stays visible to
//! the entries that follow, as it did before (see `Bun__AsyncContextRef__enter`
//! in AsyncContextFrame.cpp).
//!
//! [`RefData::abandoned`]: crate::test_runner::bun_test::RefData::abandoned

use bun_jsc::{JSGlobalObject, JSValue, JsClass as _, JsResult};

use crate::test_runner::bun_test::RefDataPtr;

#[bun_jsc::JsClass(no_construct, no_constructor)] // codegen wires to_js / from_js
pub struct AsyncContextRef {
    /// Owned `+1`, released in `finalize`.
    r#ref: RefDataPtr,
}

/// Returned by [`AsyncContextRef::enter`]: what to invoke in place of the
/// callback, and the ref wrapper to hand to [`AsyncContextRef::leave`] once it
/// returned. Plain `JSValue`s (not an `Option`) so the conservative stack scan
/// keeps both alive across the call.
pub(crate) struct Entered {
    pub(crate) callable: JSValue,
    pub(crate) ref_js: JSValue,
}

impl AsyncContextRef {
    // Codegen's `host_fn_finalize` calls this via `|b| AsyncContextRef::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        // `RefPtr` has no `Drop` (src/ptr/ref_count.rs); release explicitly
        // before the Box frees the allocation.
        self.r#ref.deref();
    }

    /// Puts `refdata` into the async context `callback` is about to be invoked
    /// with, so that it and every continuation of it carry the ref. Takes over
    /// the caller's `+1` on `refdata`.
    pub(crate) fn enter(global: &JSGlobalObject, callback: JSValue, refdata: RefDataPtr) -> JsResult<Entered> {
        // `to_js` boxes `self` and hands the pointer to the wrapper; `finalize` releases the ref.
        let ref_js = AsyncContextRef { r#ref: refdata }.to_js(global);
        let callable = bun_jsc::cpp::Bun__AsyncContextRef__enter(global, callback, ref_js);
        ref_js.ensure_still_alive();
        Ok(Entered { callable: callable?, ref_js })
    }

    /// Takes the ref back out of the context. Runs right after the callback
    /// returned, before microtasks are drained, which is also when a wrapped
    /// callback's context is restored by `Bun__JSValue__call`.
    pub(crate) fn leave(global: &JSGlobalObject, ref_js: JSValue) -> JsResult<()> {
        let result = bun_jsc::cpp::Bun__AsyncContextRef__leave(global, ref_js);
        ref_js.ensure_still_alive();
        result
    }

    /// A `+1` to the `RefData` of the abandoned invocation whose async context
    /// the currently running JS descends from, or `None` when it descends from
    /// no invocation or from one the runner did not abandon.
    pub(crate) fn abandoned_caller(global: &JSGlobalObject) -> Option<RefDataPtr> {
        let this = Self::from_js(bun_jsc::cpp::Bun__AsyncContextRef__current(global))?;
        // SAFETY: `from_js` returned the live payload of a wrapper that the
        // current async context (a GC-visited array) keeps alive for this call.
        let refdata: &RefDataPtr = unsafe { &(*this).r#ref };
        if !refdata.abandoned.get() {
            return None;
        }
        Some(refdata.dupe_ref())
    }
}
