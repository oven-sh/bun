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
/// - `TASK_OFFSET` MUST equal `core::mem::offset_of!(Self, <task field>)`
///   where the field is of type [`Task`] and [`task_mut`](OwnedTask::task_mut)
///   MUST return a borrow of that same field. The shim casts through the
///   offset; a mismatch is UB.
/// - [`run`](OwnedTask::run) executes on an arbitrary worker thread (hence
///   the `Send` bound).
pub unsafe trait OwnedTask: Send + Sized + 'static {
    /// `core::mem::offset_of!(Self, task)`. Used only for the `container_of`
    /// recovery in [`__callback`](OwnedTask::__callback) and the schedule
    /// argument; the install step uses the safe [`task_mut`] accessor.
    const TASK_OFFSET: usize;

    /// Safe accessor for the intrusive `task: Task` field. Implementors
    /// return `&mut self.task`; [`WorkPool::schedule_owned`] uses this to
    /// install the callback without raw byte-offset arithmetic.
    fn task_mut(&mut self) -> &mut Task;

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
        let this = unsafe { Box::from_raw(bun_core::container_of::<Self, _>(task, Self::TASK_OFFSET)) };
        this.run();
    }
}

/// Implements [`OwnedTask`] (and the required `Send`) for a struct that
/// embeds an intrusive `task: Task` field and is scheduled fire-and-forget
/// via [`WorkPool::schedule_owned`]. Expands to the `TASK_OFFSET` constant,
/// the `task_mut` accessor, and `unsafe impl Send` — the implementor supplies
/// only `fn run(self: Box<Self>)`.
///
/// ```ignore
/// owned_task!(HashJob, task);
/// impl HashJob { fn run_owned(self: Box<Self>) { /* ... */ } }
/// ```
///
/// The `Send` impl is part of the macro because every `OwnedTask` is *by
/// construction* sent to a worker thread — Zig's `WorkPool.schedule` had no
/// such bound and the per-type fields (raw `*mut EventLoop`, `*const
/// JSGlobalObject`) are auto-`!Send` only nominally. The safety obligation
/// ("all fields are sound to move across threads") is restated once here
/// rather than at every `WorkPool::schedule(addr_of_mut!((*p).task))` site.
#[macro_export]
macro_rules! owned_task {
    // Generic form (`owned_task!([const B: bool] CpSingleTask<B>, task);`).
    // The leading `[..]` disambiguates from the plain-type arm so the `:ty`
    // fragment below never sees a `<const ..>` and hard-errors.
    ([$($gen:tt)*] $ty:ty, $field:ident) => {
        // SAFETY: see plain-type arm.
        unsafe impl<$($gen)*> ::core::marker::Send for $ty {}
        // SAFETY: see plain-type arm.
        unsafe impl<$($gen)*> $crate::work_pool::OwnedTask for $ty {
            const TASK_OFFSET: usize = ::core::mem::offset_of!($ty, $field);
            #[inline]
            fn task_mut(&mut self) -> &mut $crate::work_pool::Task { &mut self.$field }
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
    ($ty:ty, $field:ident) => {
        // SAFETY: scheduled via `WorkPool::schedule_owned`; see macro doc — the
        // type is moved to a worker thread by design (Zig had no Send check).
        unsafe impl ::core::marker::Send for $ty {}
        // SAFETY: `TASK_OFFSET`/`task_mut` agree (`$field` is the intrusive
        // `Task`); `run` forwards to the inherent `run_owned`.
        unsafe impl $crate::work_pool::OwnedTask for $ty {
            const TASK_OFFSET: usize = ::core::mem::offset_of!($ty, $field);
            #[inline]
            fn task_mut(&mut self) -> &mut $crate::work_pool::Task { &mut self.$field }
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
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
    /// `container_of`-in-callback pattern.
    pub fn schedule_owned<T: OwnedTask>(mut task: Box<T>) {
        // Install the monomorphized shim via the safe accessor — no raw
        // byte-offset write. `node` is left as the caller initialized it
        // (always `Node::default()`); the Zig path never reset it at schedule
        // time either.
        task.task_mut().callback = T::__callback;
        // The single into_raw for every OwnedTask scheduler call. Derive the
        // intrusive `*mut Task` *after* into_raw so provenance covers the full
        // allocation and there is exactly one raw-pointer derivation.
        let raw = Box::into_raw(task);
        // SAFETY: `raw` is a live heap allocation now owned by the pool;
        // `TASK_OFFSET` is the trait-contract offset of a `Task` field.
        Self::schedule(unsafe { raw.cast::<u8>().add(T::TASK_OFFSET).cast::<Task>() });
    }

    /// `Box::new` + [`schedule_owned`](Self::schedule_owned). Convenience for
    /// the common case where the task is constructed inline at the call site.
    #[inline]
    pub fn schedule_new<T: OwnedTask>(task: T) {
        Self::schedule_owned(Box::new(task));
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
                let this_task = bun_core::from_field_ptr!(TaskType<C>, task, task);
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
