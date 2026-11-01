//! `async`/`.await` on the JS event loop. How it fits the loop's rules: `src/async/README.md`.
//!
//! The VM owns its futures ([`VirtualMachine::futures`]) and polls them on the JS thread. There is no
//! second scheduler: a wake-up is a [`Task`] in [`EventLoop::tasks`](crate::event_loop::EventLoop)
//! like any other.

use core::cell::Cell;
use core::future::Future;
use core::marker::PhantomData;
use core::pin::Pin;
use core::sync::atomic::{AtomicBool, Ordering};
use core::task::{Context, Poll};
use std::rc::Rc;
use std::sync::Arc;

use bun_async::{Refused, Schedule, Slot, TaskId, Tasks};
use bun_event_loop::{Task, task_tag};
use bun_io::KeepAlive;

use crate::bindgen::JsScope;
use crate::job::{Completion, Job, JobContext, JsAffine};
use crate::virtual_machine::VirtualMachine;
use crate::vm_handle::{LoopKind, Ticket};
use crate::{
    ContextId, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue, JsError, JsResult, JsThread,
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

/// What the JS loop keeps with each task.
#[derive(Clone, Copy)]
pub struct OnJsLoop {
    kind: LoopKind,
    /// The task is polled inside it, and goes when it stops.
    context: ContextId,
}

impl Schedule for OnJsLoop {
    /// `Err`: what the future's JS left pending, for whoever polled it to fold.
    type Output = JsResult<()>;

    fn with_tasks<R>(f: impl FnOnce(&Tasks<Self>) -> R) -> Option<R> {
        let vm = VirtualMachine::get_or_null()?;
        // SAFETY: this thread's live VM; the field is only ever borrowed shared.
        Some(f(unsafe { &(*vm).futures }))
    }

    fn schedule(self, id: TaskId) {
        let vm = VirtualMachine::get_mut_ptr();
        let queued = Task::new(task_tag::Future, id.into_ptr(), self.context);
        // SAFETY: this thread's live VM; a statement-scoped `&mut` to one of its loops.
        unsafe {
            // The macro loop only ticks while a macro is waited on. See `macro_loop_if_not_running`.
            if self.kind == LoopKind::Macro && (*vm).macro_mode {
                (*vm).macro_event_loop.enqueue_task(queued);
            } else {
                (*vm).regular_event_loop.enqueue_task(queued);
            }
        }
    }
}

/// The event loop reached a [`task_tag::Future`] task, whose `ptr` is a [`TaskId`].
pub fn run_queued(ptr: *mut ()) -> JsResult<()> {
    OnJsLoop::with_tasks(|tasks| tasks.run(TaskId::from_ptr(ptr)))
        .flatten()
        .unwrap_or(Ok(()))
}

/// The task whose poll the caller is inside. What it awaits keeps this for [`resume_now`].
pub fn running_task() -> Option<TaskId> {
    OnJsLoop::with_tasks(Tasks::running).flatten()
}

/// Poll `task`, which `waker` wakes, now and in its context, instead of queueing it: for a promise
/// reaction, so that a future continues where an `async function` awaiting the same promise would.
/// The caller is not beneath anything the future owns, since the future may end and drop it.
pub fn resume_now(task: Option<TaskId>, waker: core::task::Waker) -> JsResult<()> {
    let vm = VirtualMachine::get();
    let Some((id, on)) = task.and_then(|id| Some((id, vm.futures.scheduler_of(id)?))) else {
        waker.wake();
        return Ok(());
    };
    let _context = vm.enter_context(on.context);
    // `waker` is held across the poll, so that dropping it does not find an orphan first.
    vm.futures.run(id).unwrap_or(Ok(()))
}

/// It will not: the VM or the task's context has stopped.
pub fn release_queued(ptr: *mut ()) {
    OnJsLoop::with_tasks(|tasks| tasks.cancel(TaskId::from_ptr(ptr)));
}

/// `context` stops: drop its futures. Whether any was dropped: one that is being polled goes when
/// that poll returns.
pub(crate) fn cancel_of_context(context: ContextId) -> bool {
    OnJsLoop::with_tasks(|tasks| tasks.cancel_where(|on| on.context == context)) > Some(0)
}

pub(crate) fn any_of_context(context: ContextId) -> bool {
    OnJsLoop::with_tasks(|tasks| tasks.any(|on| on.context == context)) == Some(true)
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

    /// What the loop does with an `Err` a future ends with, for a future that goes on: `error` is
    /// reported as uncaught.
    pub fn report_uncaught(&self, error: JsError) {
        let _ = crate::task::report_error_or_terminate(self.global(), error);
    }

    /// Run `work` on the work pool, as a [`Job`]. It starts now; awaiting collects the result.
    #[track_caller]
    pub fn blocking<T, F>(&self, work: F) -> Blocking<T>
    where
        T: Send + 'static,
        F: FnOnce() -> T + Send + 'static,
    {
        self.blocking_with((), move |_| work())
    }

    /// [`blocking`](Self::blocking) for work that uses memory JS owns in place, through a
    /// [`JsPtr`](crate::JsPtr) and the job's [`Ticket`]. `keeps` is what keeps that memory where it
    /// is (a `PinnedArrayBuffer`). It is dropped on the JS thread once `work` has ended, whether or
    /// not anything still awaits the result.
    #[track_caller]
    pub fn blocking_with<K, T, F>(&self, keeps: K, work: F) -> Blocking<T>
    where
        K: JsAffine + 'static,
        T: Send + 'static,
        F: FnOnce(&Ticket) -> T + Send + 'static,
    {
        let blocking = Blocking {
            awaited: Rc::new(Awaited {
                result: Slot::new(),
                by: Cell::new(None),
            }),
            abandoned: Arc::new(AtomicBool::new(false)),
            keeps_loop_alive: Some(LoopRef::new()),
        };
        Job::<PoolWork<K, T, F>>::schedule(
            &self.thread(),
            OnPool {
                work: Some(work),
                result: None,
                abandoned: Arc::clone(&blocking.abandoned),
            },
            (Waiting(Rc::clone(&blocking.awaited)), keeps),
        );
        blocking
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
    let (vm, context) = (cx.vm(), cx.context());
    let js = JsTask {
        global: GlobalRef::new(cx.global()),
        context: context.id(),
    };
    let on = OnJsLoop {
        kind: vm.current_loop_kind(),
        context: context.id(),
    };
    let id = match vm.futures.spawn(future(js), on) {
        Ok(id) => id,
        Err(Refused::Closed) => return Ok(()),
        Err(Refused::Full) => return Err(cx.global().throw_out_of_memory()),
    };
    let finished = vm.futures.run(id);
    if finished.is_none() && context.is_stopped() {
        // Script of a disposed graph is still starting things: they go on the next turn of the loop.
        crate::VirtualMachineRef::get()
            .as_mut()
            .stop_graph_context_again(context.id());
    }
    finished.unwrap_or(Ok(()))
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

/// See [`JsTask::blocking`]. It keeps the process alive until it has the result. Dropping it abandons
/// the work: skipped if the pool has not started it, and its result dropped if it has.
#[must_use = "dropping it abandons the work"]
pub struct Blocking<T> {
    awaited: Rc<Awaited<T>>,
    abandoned: Arc<AtomicBool>,
    keeps_loop_alive: Option<LoopRef>,
}

struct Awaited<T> {
    result: Slot<T>,
    by: Cell<Option<TaskId>>,
}

// SAFETY: `T: Send`, so it points to no cell, and a `JsError` made on a pool
// thread says nothing about this VM.
unsafe impl<T> AwaitSafe for Blocking<T> {}

impl<T> Future for Blocking<T> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        let this = self.get_mut();
        this.awaited.by.set(running_task());
        let result = core::task::ready!(this.awaited.result.poll_take(cx));
        this.keeps_loop_alive = None;
        Poll::Ready(result)
    }
}

impl<T> Drop for Blocking<T> {
    fn drop(&mut self) {
        self.abandoned.store(true, Ordering::Relaxed);
    }
}

struct PoolWork<K, T, F>(PhantomData<fn(K, F) -> T>);

struct OnPool<T, F> {
    work: Option<F>,
    result: Option<T>,
    abandoned: Arc<AtomicBool>,
}

struct Waiting<T>(Rc<Awaited<T>>);
// SAFETY: a `Job` leaves its `Js` half alone off the JS thread.
unsafe impl<T> JsAffine for Waiting<T> {}

impl<K, T, F> JobContext for PoolWork<K, T, F>
where
    K: JsAffine + 'static,
    T: Send + 'static,
    F: FnOnce(&Ticket) -> T + Send + 'static,
{
    type OffThread = OnPool<T, F>;
    type Js = (Waiting<T>, K);

    /// The [`Blocking`] does.
    const KEEPS_LOOP_ALIVE: bool = false;

    fn run(on_pool: &mut OnPool<T, F>, done: Completion<Self>) -> Option<Completion<Self>> {
        if !on_pool.abandoned.load(Ordering::Relaxed) {
            on_pool.result = on_pool.work.take().map(|work| work(done.ticket()));
        }
        Some(done)
    }

    /// The future continues in this task, not in one more.
    fn then(on_pool: OnPool<T, F>, (waiting, keeps): Self::Js, _: &JsThread<'_>) -> JsResult<()> {
        drop(keeps);
        let Some(result) = on_pool.result else {
            return Ok(());
        };
        let (waker, by) = (waiting.0.result.fill_quietly(result), waiting.0.by.get());
        drop(waiting);
        waker.map_or(Ok(()), |waker| resume_now(by, waker))
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
