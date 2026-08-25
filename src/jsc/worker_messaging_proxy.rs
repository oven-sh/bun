//! FFI surface of `WebCore::WorkerMessagingProxy` (WorkerMessagingProxy.h),
//! the parent<->worker relationship object a [`WebWorker`](crate::WebWorker)
//! thread reports to.

use bun_core::String as BunString;

use crate::{JSGlobalObject, JSValue};

bun_opaque::opaque_ffi! {
    /// `WebCore::WorkerMessagingProxy`. `ThreadSafeRefCounted` on the C++ side;
    /// every entry point below is documented for the thread it is called from.
    pub struct WorkerMessagingProxy;
}

// SAFETY: the C++ object is `ThreadSafeRefCounted` and built to be reached from
// both the parent and the worker thread; `&WorkerMessagingProxy` covers no
// Rust-visible bytes (opaque ZST), so sharing it exposes no Rust state.
unsafe impl Send for WorkerMessagingProxy {}
// SAFETY: as above.
unsafe impl Sync for WorkerMessagingProxy {}

unsafe extern "C" {
    /// Worker thread: 'online' — post `workerGlobalScopeStarted` to the parent
    /// and start delivering queued messages.
    safe fn WebWorker__workerGlobalScopeStarted(
        proxy: &WorkerMessagingProxy,
        global: &JSGlobalObject,
    );
    /// Worker thread, last call: post `workerGlobalScopeDestroyed` to the
    /// parent, which joins the thread from that task.
    safe fn WebWorker__workerGlobalScopeDestroyed(
        proxy: &WorkerMessagingProxy,
        exit_code: i32,
        stopped_by_parent: bool,
    );
    /// Parent thread, while it is exiting: terminate, join and release the
    /// worker thread (`WorkerMessagingProxy::parentContextWillDestroy`).
    safe fn WebWorker__parentContextWillDestroy(proxy: &WorkerMessagingProxy);
    /// Worker thread: dispatch 'error' on the worker's global scope, then
    /// report it to the parent's `Worker` object. May leave an exception pending.
    safe fn WebWorker__dispatchError(
        global: &JSGlobalObject,
        proxy: &WorkerMessagingProxy,
        message: BunString,
        err: JSValue,
    );
}

impl WorkerMessagingProxy {
    #[inline]
    pub fn worker_global_scope_started(&self, global: &JSGlobalObject) {
        WebWorker__workerGlobalScopeStarted(self, global)
    }

    #[inline]
    pub fn worker_global_scope_destroyed(&self, exit_code: i32, stopped_by_parent: bool) {
        WebWorker__workerGlobalScopeDestroyed(self, exit_code, stopped_by_parent)
    }

    /// Only from the thread that owns the worker's parent context; callers go
    /// through `WebWorker::parent_context_will_destroy`, which checks that.
    #[inline]
    pub(crate) fn parent_context_will_destroy(&self) {
        WebWorker__parentContextWillDestroy(self)
    }

    /// May leave an exception pending on `global`.
    #[inline]
    pub fn dispatch_error(&self, global: &JSGlobalObject, message: BunString, err: JSValue) {
        WebWorker__dispatchError(global, self, message, err)
    }
}
