use std::sync::OnceLock;

use crate::ThreadPool;

pub use crate::thread_pool::Batch;
pub use crate::thread_pool::Task;

pub struct WorkPool;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/threading/work_pool.zig (58 lines)
//   confidence: medium
//   todos:      1
//   notes:      bun.once → std::sync::OnceLock (§Concurrency); comptime fn param stored as runtime field
// ──────────────────────────────────────────────────────────────────────────
