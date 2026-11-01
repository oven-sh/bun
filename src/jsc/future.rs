//! `async`/`.await` on the JS event loop. How it fits the loop's rules: `src/async/README.md`.
//!
//! [`spawn`] boxes a future and polls it on the JS thread. There is no second
//! scheduler: a wake-up is a [`Task`] in [`EventLoop::tasks`](crate::event_loop::EventLoop)
//! like any other.

use core::cell::UnsafeCell;
use core::future::Future;
use core::pin::Pin;
use core::ptr::NonNull;
use core::task::{Context, Poll};

use bun_async::task::{self, Runnable, Schedule};
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;
use bun_event_loop::{Task, task_tag};
use bun_io::KeepAlive;
use bun_threading::work_pool::WorkPool;

use crate::bindgen::JsScope;
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::{LoopKind, Posted, Ticket, VmHandle};
use crate::{
    AbortHandle, ContextId, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue, JsError, JsResult,
    JsThread,
};

// ── AwaitSafe ─────────────────────────────────────────────────────────────

/// May be a local of an `async fn` that is alive across an `.await`.
///
/// The collector finds the `JSValue`s of a running function by scanning the
/// stack. A suspended future is not on the stack, so a cell only it points to
/// is collected under it. The compiler already works out which types a future
/// stores across its suspension points (that is how it decides `Send`), and
/// this auto trait asks the same question: everything is `AwaitSafe` unless it
/// holds one of the types refused below.
///
/// # Safety
/// Implement it by hand only for a type that keeps the cells it points to alive
/// by itself (a handle the collector knows about).
#[diagnostic::on_unimplemented(
    message = "`{Self}` cannot be held across an `.await`",
    label = "stored in the suspended future, which the garbage collector does not scan",
    note = "keep a `Strong` across the `.await` and read the `JSValue` back after it, or finish with the value before awaiting"
)]
pub unsafe auto trait AwaitSafe {}

macro_rules! not_await_safe {
    ($($(#[$doc:meta])* $ty:ty),+ $(,)?) => { $($(#[$doc])* impl !AwaitSafe for $ty {})+ };
}
not_await_safe! {
    JSValue,
    // A reference or pointer to one of these is refused with it.
    crate::JSCell,
    crate::JSObject,
    crate::JSString,
    crate::JSPromise,
    crate::JSArray,
    crate::JSFunction,
    crate::JSMap,
    crate::JSBigInt,
    crate::JSUint8Array,
    crate::Exception,
    /// "An exception is pending" is only true until the loop runs something else.
    JsError,
    // What brackets a stretch of the JS thread's stack.
    crate::CallFrame,
    crate::MarkedArgumentBuffer,
    crate::TopExceptionScope,
    JsThread<'_>,
    crate::virtual_machine::ContextScope<'_>,
    crate::event_loop::EventLoopEnterGuard,
    crate::event_loop::EventLoopEnterNoCheckpointGuard,
}
// SAFETY: `protect()`ed for as long as it exists.
unsafe impl AwaitSafe for crate::Protected {}

// ── the scheduler ─────────────────────────────────────────────────────────

/// The part of a task's allocation that belongs to the JS loop.
pub struct OnJsLoop {
    /// Carries a wake-up from another thread through the loop's concurrent queue.
    node: UnsafeCell<ConcurrentTaskItem>,
    handle: VmHandle,
    kind: LoopKind,
    /// Compared on any thread; dereferenced only where it is the thread's own VM.
    vm: *mut VirtualMachine,
    context: ContextId,
    /// JS thread only, and disarmed there before the allocation can be freed elsewhere.
    abort: AbortHandle,
}

// SAFETY: off the JS thread only `schedule` runs, which reads `Copy` fields set
// at construction, clones the (thread-safe) handle, and writes `node`, which is
// its alone while the task is being queued. Dropping it elsewhere drops the
// handle and a disarmed `AbortHandle`, which is a no-op.
unsafe impl Send for OnJsLoop {}
// SAFETY: as above.
unsafe impl Sync for OnJsLoop {}

// SAFETY: both queues are drained by the VM's own thread, and a refused post drops the task.
unsafe impl Schedule for OnJsLoop {
    /// `Err`: what the future's JS left pending, for whoever polled it to fold.
    type Output = JsResult<()>;

    fn schedule(task: Runnable<Self>) {
        let this = task.scheduler();
        let (vm, kind, context) = (this.vm, this.kind, this.context);
        if VirtualMachine::get_or_null() == Some(vm) {
            let queued = Task::new(task_tag::Future, task.into_raw().as_ptr(), context);
            // SAFETY: this thread's live VM; a statement-scoped `&mut` to one of its loops.
            unsafe {
                // The macro loop only ticks while a macro is waited on. See `macro_loop_if_not_running`.
                if kind == LoopKind::Macro && (*vm).macro_mode {
                    (*vm).macro_event_loop.enqueue_task(queued);
                } else {
                    (*vm).regular_event_loop.enqueue_task(queued);
                }
            }
            return;
        }
        // The JS thread may run and free the task before `post` returns.
        let handle = this.handle.clone();
        // SAFETY: projects to a field of the live task.
        let node = unsafe { UnsafeCell::raw_get(&raw const (*task.scheduler_ptr().as_ptr()).node) };
        let raw = task.into_raw();
        // SAFETY: a task is queued by one thread at a time, and is in no queue now.
        let node = unsafe {
            node.write(ConcurrentTaskItem {
                task: Task::new(task_tag::Future, raw.as_ptr(), context),
                next: bun_threading::Link::new(),
                auto_delete: false,
            });
            NonNull::new_unchecked(node)
        };
        if let Posted::Refused(_) = handle.post(kind, node) {
            // The VM has closed, and dropped every future on its way.
            // SAFETY: refused, so still this thread's.
            drop(unsafe { Runnable::<Self>::from_raw(raw) });
        }
    }

    fn finished(&self) {
        self.abort.disarm();
    }
}

crate::impl_abort_handle_owner!(OnJsLoop, abort, |this, _cause| {
    // SAFETY: armed, so the task is allocated; `this` was derived from
    // `Runnable::scheduler_ptr` in `spawn`; contexts stop on the JS thread.
    unsafe { task::cancel(NonNull::new_unchecked(this)) }
});

/// The event loop reached a [`task_tag::Future`] task.
///
/// # Safety
/// `ptr` is the `Task::ptr` [`OnJsLoop::schedule`] queued, once; the JS thread.
pub unsafe fn run_queued(ptr: *mut ()) -> JsResult<()> {
    // SAFETY: fn contract.
    unsafe { Runnable::<OnJsLoop>::from_raw(NonNull::new_unchecked(ptr)).run() }.unwrap_or(Ok(()))
}

/// It will not: the VM or the task's context has stopped.
///
/// # Safety
/// As [`run_queued`].
pub unsafe fn release_queued(ptr: *mut ()) {
    // SAFETY: fn contract.
    unsafe { Runnable::<OnJsLoop>::from_raw(NonNull::new_unchecked(ptr)).cancel() }
}

// ── spawning ──────────────────────────────────────────────────────────────

/// What a future on the JS loop reaches its VM through. It is only ever polled
/// on the JS thread, inside its context, while both are alive.
#[derive(Clone, Copy)]
pub struct JsTask {
    global: GlobalRef,
    context: ContextId,
}

impl JsTask {
    #[inline]
    pub fn global(&self) -> &JSGlobalObject {
        &self.global
    }

    #[inline]
    pub fn vm(&self) -> &VirtualMachine {
        self.global.bun_vm()
    }

    /// For the APIs that take the tree's proof of being on the JS thread.
    #[inline]
    pub fn thread(&self) -> JsThread<'_> {
        self.global.js_thread(self.vm().context_of(self.context))
    }

    /// Run JavaScript through the bindings API. What `f` makes cannot outlive
    /// it, so none of it reaches an `.await`.
    #[inline]
    pub fn scope<R>(&self, f: impl for<'call> FnOnce(&mut JsScope<'call>) -> R) -> R {
        // SAFETY: the loop (or a host function, for the first poll) entered this
        // future's poll, and no other `JsScope` can be borrowed across an `.await`.
        unsafe { JsScope::with(self.global.as_ptr(), f) }
    }

    /// Run `work` on the work pool. It starts now; awaiting collects the result.
    #[track_caller]
    pub fn blocking<T, F>(&self, work: F) -> Blocking<T>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        Blocking {
            keeps_loop_alive: LoopRef::new(),
            work: bun_async::blocking(WorkPool::schedule, self.vm().ticket(), work),
        }
    }
}

/// Start `future` now, on this thread: it runs up to its first `.await` before
/// this returns, as an `async function` does. `Err` is what it threw if it got
/// to its end that soon. From then on the loop polls it, and reports what it
/// throws as uncaught.
pub fn spawn<F>(cx: &JsThread<'_>, future: impl FnOnce(JsTask) -> F) -> JsResult<()>
where
    F: Future<Output = JsResult<()>> + AwaitSafe + 'static,
{
    let vm = cx.vm();
    let js = JsTask {
        global: GlobalRef::new(cx.global()),
        context: cx.context().id(),
    };
    let abort = AbortHandle::for_owner::<OnJsLoop>();
    // By itself it does nothing. What can resume it is counted where it is armed.
    abort.set_only_waits_to_be_closed();
    let task = task::spawn(
        future(js),
        OnJsLoop {
            node: UnsafeCell::new(ConcurrentTaskItem::default()),
            handle: vm.handle(),
            kind: vm.current_loop_kind(),
            vm: VirtualMachine::get_mut_ptr(),
            context: js.context,
            abort,
        },
    );
    // SAFETY: heap-pinned until `finished` disarms it; the JS thread.
    unsafe {
        AbortHandle::arm_owner(task.scheduler_ptr().as_ptr(), cx.context());
        task.run()
    }
    .unwrap_or(Ok(()))
}

/// Why a [`promise`] is rejected.
pub enum Rejection {
    /// With the exception that is pending.
    Thrown(JsError),
    /// With this value, which was never thrown.
    Value(JSValue),
}

impl From<JsError> for Rejection {
    #[inline]
    fn from(error: JsError) -> Self {
        Rejection::Thrown(error)
    }
}

/// [`spawn`] `future` and return the promise that it settles. If its context
/// stops first the promise stays pending: that script hears nothing more.
pub fn promise<F>(cx: &JsThread<'_>, future: impl FnOnce(JsTask) -> F) -> JsResult<JSValue>
where
    F: Future<Output = Result<JSValue, Rejection>> + AwaitSafe + 'static,
{
    let mut promise = JSPromiseStrong::init(cx.global());
    let value = promise.value();
    spawn(cx, move |js| {
        let future = future(js);
        async move {
            match future.await {
                Ok(value) => promise.resolve(js.global(), value),
                Err(Rejection::Value(reason)) => {
                    promise.reject_with_async_stack(js.global(), Ok(reason))
                }
                Err(Rejection::Thrown(error)) => promise.reject(js.global(), Err(error)),
            }
        }
    })?;
    Ok(value)
}

// ── the work pool ─────────────────────────────────────────────────────────

impl bun_async::InFlight for Ticket {
    fn is_cancelled(&self) -> bool {
        self.cancelled()
    }
    fn before_finish(&self) {
        self.before_post();
    }
}

/// One reference on the JS loop, for as long as it exists.
pub struct LoopRef(KeepAlive);

impl LoopRef {
    pub fn new() -> Self {
        let mut keep_alive = KeepAlive::default();
        keep_alive.ref_(bun_io::js_vm_ctx());
        Self(keep_alive)
    }
}

impl Default for LoopRef {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for LoopRef {
    fn drop(&mut self) {
        self.0.unref(bun_io::js_vm_ctx());
    }
}

/// See [`JsTask::blocking`].
#[must_use = "dropping it abandons the work"]
pub struct Blocking<T> {
    work: bun_async::Blocking<T>,
    keeps_loop_alive: LoopRef,
}

// SAFETY: `T: Send`, so it points to no cell, and a `JsError` made on a pool
// thread says nothing about this VM.
unsafe impl<T> AwaitSafe for Blocking<T> {}

impl<T> Future for Blocking<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let this = self.get_mut();
        let value = core::task::ready!(Pin::new(&mut this.work).poll(cx));
        this.keeps_loop_alive.0.unref(bun_io::js_vm_ctx());
        Poll::Ready(value)
    }
}
