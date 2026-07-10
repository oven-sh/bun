//! `async fn` → `JSPromise` bridge.
//!
//! [`js_promise`] is the blessed way to implement a promise-returning native
//! API as a Rust future: it creates a pending promise, spawns the future onto
//! the JS event loop (`bun_event_loop::AsyncTask::spawn`), and settles the
//! promise when the future completes. Settlement happens inside the task
//! drain loop, so microtasks run at exactly the same point they do for every
//! hand-rolled completion task, with no extra ceremony.
//!
//! The future may capture `!Send` JS-thread state; anything held across an
//! `.await` must be GC-rooted (`Strong`/`JsRef` — never a bare `JSValue`).
//! Rejection follows the same contract as host functions: return
//! `Err(JsError)` with the exception pending (e.g. via
//! `global.throw_value(...)`); the bridge takes the exception, attaches async
//! stack frames from the promise's await chain, and rejects — mirroring
//! `JSPromise::reject` + `reject_with_async_stack`.

use core::future::Future;

use crate::{JSGlobalObject, JSPromiseStrong, JSValue, JsError, JsResult};

/// Create a JS promise driven by `fut`.
///
/// **Eager, like `new Promise(executor)`**: `fut` runs synchronously up to
/// its first `.await` before this returns — pool work and I/O it issues
/// start at exactly the point a hand-rolled task would have started them.
/// When work begins is observable API surface; conversions must not defer it.
/// A future that is ready immediately settles the promise synchronously
/// (JS-legal: reactions still run on the microtask queue).
///
/// `Ok(v)` resolves with `v`; `Err` rejects with the pending VM exception
/// (async stack attached); termination leaves the promise pending, like
/// every existing task that observes a dying VM.
pub fn js_promise<Fut>(global: &JSGlobalObject, fut: Fut) -> JSValue
where
    Fut: Future<Output = JsResult<JSValue>> + 'static,
{
    let mut promise = JSPromiseStrong::init(global);
    let value = promise.value();
    let global_ptr = core::ptr::from_ref(global);
    bun_event_loop::AsyncTask::spawn(async move {
        let result = fut.await;
        // SAFETY: spawned futures are polled — and, via the shutdown release
        // hook, dropped — on the JS thread while the VM is alive; the global
        // outlives every spawned task (same contract as the raw
        // `*const JSGlobalObject` every completion task stores today).
        let global = unsafe { &*global_ptr };
        let _ = match result {
            Ok(v) => promise.resolve(global, v),
            // The VM is going away; leave the promise pending (matches every
            // existing completion path that observes termination).
            Err(JsError::Terminated) => Ok(()),
            Err(JsError::OutOfMemory) => {
                promise.reject_with_async_stack(global, Ok(global.create_out_of_memory_error()))
            }
            Err(_) => match global.try_take_exception() {
                Some(exception) => {
                    // Match `JSPromise::reject`'s normalization: unwrap a
                    // `JSC::Exception` cell to the thrown error so the
                    // rejection reason and async-stack attachment behave
                    // exactly like a plain `throw`.
                    let exception = exception.to_error().unwrap_or(exception);
                    promise.reject_with_async_stack(global, Ok(exception))
                }
                // Same contract violation `JSPromise::reject` panics on: an
                // `Err` future output requires the exception to be pending.
                None => panic!(
                    "js_promise: future returned Err but the exception was cleared before it could be read."
                ),
            },
        };
    });
    value
}
