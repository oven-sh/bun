use core::mem::offset_of;

use bun_aio::{self as Async, KeepAlive};
use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask, Taskable, TaskTag};
use bun_threading::{work_pool::WorkPool, WorkPoolTask};

use crate::event_loop::EventLoop;
use crate::js_promise::{JSPromise, Strong as JSPromiseStrong};
use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JsTerminated};

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

/// A generic task that runs work on a thread pool and resolves a JavaScript Promise with the result.
/// This allows CPU-intensive operations to be performed off the main JavaScript thread while
/// maintaining a Promise-based API for JavaScript consumers.
///
/// The Context type must implement:
/// - `run(*Context)` - performs the work on the thread pool
/// - `then(*Context, jsc.JSPromise)` - resolves the promise with the result on the JS thread
pub struct ConcurrentPromiseTask<'a, Context: ConcurrentPromiseTaskContext> {
    // Zig: `ctx: *Context` — heap-allocated by caller (e.g. `bun.new(CopyFile, ...)`).
    // Owned here so dropping the task frees the context (matches Zig `Context.deinit()` → `bun.destroy`).
    pub ctx: Box<Context>,
    pub task: WorkPoolTask,
    pub event_loop: *const EventLoop,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc (non-AST crate)
    pub promise: JSPromiseStrong,
    pub global_this: &'a JSGlobalObject,
    pub concurrent_task: ConcurrentTask,

    // This is a poll because we want it to enter the uSockets loop
    // PORT NOTE: `ref` is a Rust keyword; field renamed to `ref_`.
    pub ref_: KeepAlive,
}

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
        // SAFETY: `VirtualMachine::get()` returns the JS-thread singleton; the VM
        // and its `EventLoop` outlive every task scheduled on it.
        let event_loop = VirtualMachine::get().as_mut().event_loop();
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
        this.ref_.ref_(js_event_loop_ctx());
        this
    }

    /// SAFETY: `task` points to the `task` field of a heap-allocated `Self`
    /// created in [`create_on_js_thread`].
    pub unsafe fn run_from_thread_pool(task: *mut WorkPoolTask) {
        // SAFETY: recover the parent via offset_of (Zig: `@fieldParentPtr`).
        let this: *mut Self = unsafe {
            task.cast::<u8>()
                .sub(offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: `this` is alive for the duration of the thread-pool callback;
        // exclusively owned by the work pool at this point.
        unsafe { (*this).ctx.run() };
        // SAFETY: same allocation as above.
        unsafe { Self::on_finish(this) };
    }

    pub fn run_from_js(&mut self) -> Result<(), JsTerminated> {
        let promise = self.promise.swap();
        self.ref_.unref(js_event_loop_ctx());

        self.ctx.then(promise)
    }

    pub fn schedule(&mut self) {
        WorkPool::schedule(&raw mut self.task);
    }

    /// SAFETY: `this` is the live heap allocation from [`create_on_js_thread`],
    /// called from the thread-pool callback after `Context::run` completes.
    unsafe fn on_finish(this: *mut Self) {
        // SAFETY: `event_loop` was captured from the JS-thread VM at create time
        // and outlives this task.
        let event_loop = unsafe { &*(*this).event_loop };
        // SAFETY: `concurrent_task` is an intrusive field of `*this`; `from`
        // re-initializes it in place and returns the same address. Passing
        // `this` while holding `&mut concurrent_task` is sound because `from`
        // only stores the pointer (does not dereference it).
        let task =
            std::ptr::from_mut(unsafe { (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit) });
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

/// Bridge to the aio-level `EventLoopCtx` used by `KeepAlive`.
/// `ConcurrentPromiseTask` always runs on the JS event loop, so the global `Js`
/// ctx is the correct erasure (Zig passed `this.event_loop.virtual_machine`).
#[inline]
fn js_event_loop_ctx() -> Async::EventLoopCtx {
    Async::posix_event_loop::get_vm_ctx(Async::AllocatorType::Js)
}

// ported from: src/jsc/ConcurrentPromiseTask.zig
