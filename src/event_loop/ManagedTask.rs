//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::{JsResult, Task};

/// The context of a [`ManagedTask::new_boxed`] task.
pub trait RunOnce: Sized {
    fn run(self) -> JsResult<()>;
    /// The task was released unrun (its VM is tearing down: script is
    /// forbidden, the JSC heap is still alive). Default: just drop.
    fn cancelled(self) {}
}

pub struct ManagedTask {
    // Opaque userdata pointer round-tripped through `new`/`run`; raw by design.
    pub ctx: Option<NonNull<c_void>>,
    pub(crate) callback: fn(*mut c_void) -> JsResult<()>,
    pub cleanup: Option<fn(*mut c_void)>,
    /// Held by the thread that boxed a `new_boxed` payload (which need not be
    /// `Send`); `run`/`release` assert they are on it. Debug-only, zero-sized
    /// in release.
    origin: bun_core::ThreadLock,
}

impl ManagedTask {
    pub(crate) fn task(this: *mut ManagedTask) -> Task {
        // Per §Dispatch (tag+ptr), name the tag explicitly.
        Task::new(crate::task_tag::ManagedTask, this.cast())
    }

    /// # Safety
    /// `this` must be the live `*mut ManagedTask` embedded in a `Task` returned
    /// by `new()`/`new_boxed()`; ownership transfers — `this` is freed (via
    /// `heap::take`) before return on both Ok and Err paths.
    pub unsafe fn run(this: *mut ManagedTask) -> JsResult<()> {
        // SAFETY: `this` was produced by `heap::into_raw` in `new`/`new_boxed`
        // (caller contract). Reconstituting the Box here frees it at scope
        // exit on both the Ok and Err paths.
        let this = unsafe { bun_core::heap::take(this) };
        this.origin.lock_or_assert();
        let callback = this.callback;
        let ctx = this.ctx;
        callback(ctx.unwrap().as_ptr())
    }

    /// Free without running: the owned context (if `new_boxed`) is dropped.
    ///
    /// # Safety
    /// As [`run`](Self::run); the task is not queued anywhere.
    pub unsafe fn release(this: *mut ManagedTask) {
        // SAFETY: fn contract.
        let this = unsafe { bun_core::heap::take(this) };
        this.origin.lock_or_assert();
        if let (Some(cleanup), Some(ctx)) = (this.cleanup, this.ctx) {
            cleanup(ctx.as_ptr());
        }
    }

    // A per-(Type, Callback) trampoline is folded away by storing
    // the type-erased fn pointer directly — `fn(*mut T)` and `fn(*mut c_void)` share ABI.
    pub fn new<T>(ctx: *mut T, callback: fn(*mut T) -> JsResult<()>) -> Task {
        let managed = bun_core::heap::into_raw(Box::new(ManagedTask {
            // SAFETY: `fn(*mut T) -> R` and `fn(*mut c_void) -> R` have identical
            // ABI for all `T: Sized`; `run` passes back the exact pointer stored
            // in `ctx` below, so the callee observes its original `*mut T`.
            callback: unsafe {
                bun_ptr::cast_fn_ptr::<fn(*mut T) -> JsResult<()>, fn(*mut c_void) -> JsResult<()>>(
                    callback,
                )
            },
            ctx: NonNull::new(ctx.cast::<c_void>()),
            cleanup: None,
            origin: bun_core::ThreadLock::init_unlocked(),
        }));
        ManagedTask::task(managed)
    }

    /// A task that owns `ctx` and [`run`](RunOnce::run)s it (or drops it if
    /// the queue is released unrun). `T` need not be `Send`: the `Task` is for
    /// this thread's own queue (`enqueue_task`), never a `ConcurrentTask` /
    /// `JsPoster` hand-off to another thread — debug builds assert that.
    pub fn new_boxed<T: RunOnce + 'static>(ctx: Box<T>) -> Task {
        fn run<T: RunOnce>(p: *mut c_void) -> JsResult<()> {
            // SAFETY: `p` is the `Box<T>` `new_boxed` leaked into `ctx`; `run`
            // passes it back exactly once.
            T::run(*unsafe { bun_core::heap::take(p.cast::<T>()) })
        }
        fn drop_ctx<T: RunOnce>(p: *mut c_void) {
            // SAFETY: `p` is the `Box<T>` `new_boxed` leaked into `ctx`.
            T::cancelled(*unsafe { bun_core::heap::take(p.cast::<T>()) });
        }
        let managed = bun_core::heap::into_raw(Box::new(ManagedTask {
            callback: run::<T>,
            ctx: NonNull::new(bun_core::heap::into_raw(ctx).cast::<c_void>()),
            cleanup: Some(drop_ctx::<T>),
            origin: bun_core::ThreadLock::init_locked(),
        }));
        ManagedTask::task(managed)
    }
}
