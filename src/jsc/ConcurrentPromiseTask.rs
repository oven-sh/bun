use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask, TaskTag, Taskable};
use bun_io::{self as Async, KeepAlive};
use bun_threading::{IntrusiveWorkTask as _, WorkPoolTask, work_pool::WorkPool};

use crate::event_loop::EventLoop;
use crate::js_promise::{JSPromise, Strong as JSPromiseStrong};
use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JsTerminated};
use bun_ptr::BackRef;

/// The `Context` type parameter for [`ConcurrentPromiseTask`] must implement this trait:
/// - `run(&mut self)` — performs the work on the thread pool
/// - `then(&mut self, &mut JSPromise)` — resolves the promise with the result on the JS thread
pub trait ConcurrentPromiseTaskContext: Sized {
    /// Tag this `ConcurrentPromiseTask<Self>` carries when enqueued back onto the
    /// JS event loop's concurrent queue (`task_tag::*`).
    const TASK_TAG: TaskTag;

    fn run(&mut self);
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated>;
}

/// A generic task that runs work on a thread pool and resolves a JavaScript Promise with the result.
/// This allows CPU-intensive operations to be performed off the main JavaScript thread while
/// maintaining a Promise-based API for JavaScript consumers.
///
/// The Context type must implement:
/// - `run(*Context)` - performs the work on the thread pool
/// - `then(*Context, jsc.JSPromise)` - resolves the promise with the result on the JS thread
pub struct ConcurrentPromiseTask<'a, Context: ConcurrentPromiseTaskContext> {
    // Owned here so dropping the task frees the context.
    pub ctx: Box<Context>,
    pub task: WorkPoolTask,
    /// BACKREF — captured from the JS-thread VM at create time; the VM (and its
    /// `EventLoop`) outlives every task scheduled on it.
    pub event_loop: BackRef<EventLoop>,
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,

    // This is a poll because we want it to enter the uSockets loop
    // (`ref` is a Rust keyword, hence `ref_`)
    pub ref_: KeepAlive,
}

bun_threading::intrusive_work_task!(['a, Context: ConcurrentPromiseTaskContext] ConcurrentPromiseTask<'a, Context>, task);

// SAFETY: `ConcurrentPromiseTask` is heap-allocated and only its address crosses
// threads via the intrusive `task` node and the concurrent queue. All access to
// `ctx` / `promise` / `global_this` is sequenced by the work-pool → on_finish →
// run_from_js hand-off; raw pointers are inert.
unsafe impl<C: ConcurrentPromiseTaskContext> Send for ConcurrentPromiseTask<'_, C> {}

impl<Context: ConcurrentPromiseTaskContext> Taskable for ConcurrentPromiseTask<'_, Context> {
    const TAG: TaskTag = Context::TASK_TAG;
}

impl<'a, Context: ConcurrentPromiseTaskContext> ConcurrentPromiseTask<'a, Context> {
    pub fn create_on_js_thread(global_this: &'a JSGlobalObject, value: Box<Context>) -> Box<Self> {
        // `VirtualMachine::get()` returns the JS-thread singleton; the VM and
        // its `EventLoop` outlive every task scheduled on it.
        let event_loop = BackRef::new(VirtualMachine::get().as_mut().event_loop_shared());
        let mut this = Box::new(Self {
            event_loop,
            ctx: value,
            task: WorkPoolTask {
                node: Default::default(),
                callback: Self::run_from_thread_pool,
            },
            promise: JSPromiseStrong::init(global_this),
            global_this,
            concurrent_task: ConcurrentTask::default(),
            ref_: KeepAlive::default(),
        });
        this.ref_.ref_(Async::js_vm_ctx());
        this
    }

    pub unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable via `WorkPoolTask::callback` for the `task`
        // field initialised in `create_on_js_thread`, so `from_task_ptr`
        // recovers the live heap `Self`, owned by the pool for this callback.
        let this = unsafe { Self::from_task_ptr(task) };
        // SAFETY: `this` is the live heap `Self` recovered above. The single
        // deref; the borrow ends before `on_finish` publishes `this` to the JS
        // thread's concurrent queue.
        unsafe { &mut *this }.ctx.run();
        Self::on_finish(this);
    }

    pub fn run_from_js(&mut self) -> Result<(), JsTerminated> {
        let promise = self.promise.swap();
        self.ref_.unref(Async::js_vm_ctx());

        self.ctx.then(promise)
    }

    pub fn schedule(&mut self) {
        WorkPool::schedule(&raw mut self.task);
    }

    fn on_finish(this: *mut Self) {
        // SAFETY: only called from `run_from_thread_pool` with the live heap
        // allocation. Only the intrusive field is borrowed: `from` stores
        // `this` without dereferencing it, so `this` stays valid for the queue.
        let event_loop = unsafe { (*this).event_loop };
        // SAFETY: same invariant — only the intrusive `concurrent_task` field is
        // borrowed, and `from` stores `this` without dereferencing it.
        let concurrent_task = unsafe { &mut (*this).concurrent_task };
        let task = core::ptr::NonNull::from(concurrent_task.from(this, AutoDeinit::ManualDeinit));
        // No borrow of `*this` is live here: once enqueued, the JS thread may
        // run and free the job before this call returns.
        event_loop.enqueue_task_concurrent(task);
    }

    /// Frees the heap allocation backing this task.
    /// `promise.deinit()` is handled by `JSPromiseStrong: Drop`.
    pub fn destroy(self: Box<Self>) {
        drop(self);
    }
}
