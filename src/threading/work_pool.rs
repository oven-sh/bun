use core::mem::MaybeUninit;
use std::sync::Once;

use crate::ThreadPool;

pub use crate::thread_pool::Batch;
pub use crate::thread_pool::Task;

pub struct WorkPool;

static mut POOL: MaybeUninit<ThreadPool> = MaybeUninit::uninit();
static CREATE_ONCE: Once = Once::new();

#[cold]
fn create() {
    // SAFETY: called exactly once via CREATE_ONCE; no other reference to POOL exists yet.
    unsafe {
        POOL.write(ThreadPool::init(crate::thread_pool::Options {
            max_threads: bun_core::get_thread_count(),
            stack_size: ThreadPool::DEFAULT_THREAD_STACK_SIZE,
        }));
    }
}

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        CREATE_ONCE.call_once(create);
        // SAFETY: CREATE_ONCE guarantees POOL is initialized; ThreadPool is internally
        // synchronized so a shared reference is sound for concurrent schedule() calls.
        // TODO(port): if ThreadPool::schedule needs &mut self, change to *mut ThreadPool.
        unsafe { (*&raw const POOL).assume_init_ref() }
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

        fn callback<C>(task: *mut Task) {
            // SAFETY: `task` points to the `task` field of a `TaskType<C>` allocated below
            // via Box::into_raw; recover the parent pointer, run the user fn, then free.
            unsafe {
                let this_task = (task as *mut u8)
                    .sub(core::mem::offset_of!(TaskType<C>, task))
                    .cast::<TaskType<C>>();
                let this_task = Box::from_raw(this_task);
                (this_task.function)(this_task.context);
            }
        }

        let task_ = Box::into_raw(Box::new(TaskType::<C> {
            task: Task {
                callback: callback::<C>,
                ..Default::default()
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
//   notes:      bun.once → std::sync::Once + static MaybeUninit; ThreadPool::Options/init/schedule signatures assumed; comptime fn param stored as runtime field
// ──────────────────────────────────────────────────────────────────────────
