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
    /// JS event loop's concurrent queue (`task_tag::*`). Mirrors Zig's
    /// per-instantiation `TaggedPointerUnion` membership (e.g. `CopyFilePromiseTask`).
    const TASK_TAG: TaskTag;

    fn run(&mut self);
    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated>;
}

pub struct ConcurrentPromiseTask<'a, Context: ConcurrentPromiseTaskContext> {
    // Zig: `ctx: *Context` — heap-allocated by caller (e.g. `bun.new(CopyFile, ...)`).
    // Owned here so dropping the task frees the context (matches Zig `Context.deinit()` → `bun.destroy`).
    pub ctx: Box<Context>,
    pub task: WorkPoolTask,
    /// BACKREF — captured from the JS-thread VM at create time; the VM (and its
    /// `EventLoop`) outlives every task scheduled on it.
    pub event_loop: BackRef<EventLoop>,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc (non-AST crate)
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,

    // This is a poll because we want it to enter the uSockets loop
    // PORT NOTE: `ref` is a Rust keyword; field renamed to `ref_`.
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
    // Zig: `pub const new = bun.TrivialNew(@This());` — folded into `Box::new` below.

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

    fn on_finish(this: *mut Self) {
        // SAFETY: only called from `run_from_thread_pool` above with the live
        // heap allocation recovered via `from_field_ptr!`.
        // `concurrent_task` is an intrusive field of `*this`; `from`
        // re-initializes it in place and returns the same address. Passing
        // `this` while holding `&mut *this` is sound because `from` only stores
        // the pointer (does not dereference it).
        let this_ref = unsafe { &mut *this };
        let event_loop = this_ref.event_loop;
        let task = core::ptr::NonNull::from(
            this_ref
                .concurrent_task
                .from(this, AutoDeinit::ManualDeinit),
        );
        // `task` is the live `concurrent_task` field of the heap-allocated
        // job; the queue takes ownership of its intrusive `next` link.
        event_loop.enqueue_task_concurrent(task);
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

// ported from: src/jsc/ConcurrentPromiseTask.zig
