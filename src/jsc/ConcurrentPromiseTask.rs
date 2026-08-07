use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask, TaskTag, Taskable};
use bun_io::{self as Async, KeepAlive};
use bun_threading::{IntrusiveWorkTask as _, WorkPoolTask, work_pool::WorkPool};

use crate::js_promise::{JSPromise, Strong as JSPromiseStrong};
use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JsTerminated};

/// The `Context` type parameter for [`ConcurrentPromiseTask`] must implement this trait:
/// - `run(&mut self)` — performs the work on the thread pool
/// - `then(&mut self, &mut JSPromise)` — resolves the promise with the result on the JS thread
pub trait ConcurrentPromiseTaskContext: Sized {
    /// Tag this `ConcurrentPromiseTask<Self>` carries when enqueued back onto the
    /// JS event loop's concurrent queue (`task_tag::*`).
    const TASK_TAG: TaskTag;

    fn run(&mut self);
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated>;

    /// The VM was torn down before the completion could be delivered. Runs on
    /// the pool thread with the context handed over whole: drop what is
    /// portable, forget what belongs to the JS heap or must only be touched on
    /// the JS thread (`Strong`s, non-atomic refs to JS-side objects) — a plain
    /// `drop(self)` is right only when `Drop` touches nothing of that kind.
    /// No default: every context states what it holds.
    fn release_off_thread(self: Box<Self>);
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
    pub(crate) task: WorkPoolTask,
    /// Where the pool thread delivers the completion.
    loop_handle: crate::LoopHandle,
    /// JS thread only.
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    pub(crate) concurrent_task: ConcurrentTask,

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

impl<Context: ConcurrentPromiseTaskContext> crate::Postable for ConcurrentPromiseTask<'_, Context> {
    unsafe fn loop_handle(this: *mut Self) -> *const crate::LoopHandle {
        // SAFETY: fn contract.
        unsafe { &raw const (*this).loop_handle }
    }
    unsafe fn concurrent_task(this: *mut Self) -> core::ptr::NonNull<ConcurrentTask> {
        // The embedded task, re-initialised in place (`from` only stores `this`).
        // SAFETY: fn contract.
        core::ptr::NonNull::from(unsafe {
            (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit)
        })
    }
    /// The context (an owned `Box<Context>`, portable by this type's `Send`
    /// contract) and the carrier's storage; the promise handle and keep-alive
    /// belong to a heap/loop that no longer exist and are forgotten, not dropped.
    unsafe fn release_refused(this: *mut Self) {
        // SAFETY: fn contract; `ctx` is moved out (not dropped here).
        unsafe {
            Context::release_off_thread(core::ptr::read(&raw const (*this).ctx));
            core::ptr::drop_in_place(&raw mut (*this).loop_handle);
            std::alloc::dealloc(this.cast(), std::alloc::Layout::new::<Self>());
        }
    }
}

impl<'a, Context: ConcurrentPromiseTaskContext> ConcurrentPromiseTask<'a, Context> {
    pub fn create_on_js_thread(global_this: &'a JSGlobalObject, value: Box<Context>) -> Box<Self> {
        let vm = VirtualMachine::get();
        let mut this = Box::new(Self {
            loop_handle: vm.loop_handle(),
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

    pub(crate) unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: only reachable via `WorkPoolTask::callback` (unsafe-fn-ptr
        // slot — safe-fn coerces) for the `task` field initialised in
        // `create_on_js_thread`; the WorkPool calls back with exactly that
        // field, so `from_task_ptr` recovers the live heap `Self` parent,
        // exclusively owned by the work pool for this callback's duration.
        let this = unsafe { Self::from_task_ptr(task) };
        // SAFETY: `this` is alive for the duration of the thread-pool callback;
        // exclusively owned by the work pool at this point.
        unsafe { (*this).ctx.run() };
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

    /// Pool thread: deliver the completion to the VM (or release, if it is gone).
    fn on_finish(this: *mut Self) {
        // SAFETY: only called from `run_from_thread_pool` above with the live
        // heap allocation; the work pool owns it exclusively for this callback.
        unsafe { crate::post_job(this) };
    }

    /// Frees the heap allocation backing this task.
    ///
    /// # Safety
    /// `this` must have been produced by `heap::alloc` (via [`create_on_js_thread`] /
    /// the `.manual_deinit` concurrent-task path) and must not be used afterwards.
    pub unsafe fn destroy(this: *mut Self) {
        // `promise.deinit()` is handled by `JSPromiseStrong: Drop`.
        // SAFETY: caller contract above.
        drop(unsafe { bun_core::heap::take(this) });
    }
}
