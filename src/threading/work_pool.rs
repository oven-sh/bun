use std::sync::OnceLock;

use crate::ThreadPool;

pub use crate::thread_pool::Batch;
pub use crate::thread_pool::Task;

pub struct WorkPool;

/// A type that embeds an intrusive [`Task`] node and can be scheduled on the
/// [`WorkPool`] by value (`Box<Self>`). Implementors declare the byte offset
/// of their `task: Task` field; [`WorkPool::schedule_owned`] performs the
/// `Box` → raw-pointer hand-off and the C-ABI callback shim recovers
/// `Box<Self>` via `container_of`, so call sites never touch
/// `Box::into_raw`/`from_raw` directly.
///
/// # Safety
/// `TASK_OFFSET` MUST equal `core::mem::offset_of!(Self, <task field>)` where
/// the field is of type [`Task`]. Getting this wrong is UB (the shim casts
/// through it).
pub unsafe trait OwnedTask: Sized + 'static {
    /// `core::mem::offset_of!(Self, task)`.
    const TASK_OFFSET: usize;

    /// Run the task. Receives ownership of the heap allocation; dropping
    /// `self` frees it (Zig: `bun.destroy(this)` at end of callback).
    fn run(self: Box<Self>);

    /// The C-ABI thread-pool callback shim. Generic over `Self`; recovers the
    /// owning `Box<Self>` from the intrusive `*mut Task` and dispatches to
    /// [`OwnedTask::run`]. This is the **single** `Box::from_raw` for every
    /// `OwnedTask` implementor.
    #[doc(hidden)]
    unsafe fn __callback(task: *mut Task) {
        // SAFETY: `task` points to the `Task` field at `Self::TASK_OFFSET`
        // inside a `Box<Self>` that `WorkPool::schedule_owned` leaked. The
        // thread pool guarantees this callback fires exactly once per
        // scheduled task, so reclaiming the `Box` here is sound.
        let this = unsafe { Box::from_raw(task.cast::<u8>().sub(Self::TASK_OFFSET).cast::<Self>()) };
        this.run();
    }
}

// PORT NOTE: Zig used `bun.once` (a `Lock`+bool+data lazy-init pattern). Per
// PORTING.md §Concurrency, that maps to `std::sync::OnceLock<T>` — std handles
// the double-checked locking and gives a `&'static ThreadPool` directly.
static POOL: OnceLock<ThreadPool> = OnceLock::new();

#[cold]
fn create() -> ThreadPool {
    ThreadPool::init(crate::thread_pool::Config {
        max_threads: u32::from(bun_core::get_thread_count()),
        stack_size: crate::thread_pool::DEFAULT_THREAD_STACK_SIZE,
    })
}

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        POOL.get_or_init(create)
    }

    pub fn schedule_batch(batch: Batch) {
        Self::get().schedule(batch);
    }

    pub fn schedule(task: *mut Task) {
        Self::get().schedule(Batch::from(task));
    }

    /// Schedule a heap-allocated task by value. The pool takes ownership of
    /// the `Box`; [`OwnedTask::run`] receives it back on a worker thread.
    /// Replaces the open-coded `Box::into_raw` + `&raw mut (*p).task` +
    /// `@fieldParentPtr`-in-callback pattern.
    pub fn schedule_owned<T: OwnedTask>(mut task: Box<T>) {
        // Install the monomorphized shim as the intrusive callback.
        // SAFETY: `TASK_OFFSET` is the verified offset of a `Task` field
        // (trait contract); the write is in-bounds.
        unsafe {
            let slot = (core::ptr::from_mut(&mut *task).cast::<u8>())
                .add(T::TASK_OFFSET)
                .cast::<Task>();
            (*slot).callback = T::__callback;
            (*slot).node = crate::thread_pool::Node::default();
        }
        // The single into_raw for every OwnedTask scheduler call.
        let raw = Box::into_raw(task);
        // SAFETY: `raw` is live for the pool's lifetime; offset is valid.
        Self::schedule(unsafe { raw.cast::<u8>().add(T::TASK_OFFSET).cast::<Task>() });
    }

    pub fn go<C: Send + 'static>(
        context: C,
        function: fn(C),
    ) -> Result<(), bun_alloc::AllocError> {
        // PERF(port): `function` was a comptime param in Zig (monomorphized into the
        // callback); stored as a runtime field here — profile in Phase B.
        #[repr(C)]
        struct TaskType<C> {
            task: Task,
            context: C,
            function: fn(C),
        }

        unsafe fn callback<C>(task: *mut Task) {
            // SAFETY: `task` points to the `task` field of a `TaskType<C>` allocated below
            // via Box::into_raw; recover the parent pointer, run the user fn, then free.
            unsafe {
                let this_task = task.cast::<u8>()
                    .sub(core::mem::offset_of!(TaskType<C>, task))
                    .cast::<TaskType<C>>();
                let this_task = Box::from_raw(this_task);
                (this_task.function)(this_task.context);
            }
        }

        let task_ = Box::into_raw(Box::new(TaskType::<C> {
            task: Task {
                node: crate::thread_pool::Node::default(),
                callback: callback::<C>,
            },
            context,
            function,
        }));
        // SAFETY: task_ is a valid Box-allocated TaskType<C>; .task is its first field.
        Self::schedule(unsafe { &raw mut (*task_).task });
        Ok(())
    }
}

// ported from: src/threading/work_pool.zig
