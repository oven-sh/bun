use core::cell::UnsafeCell;
use core::future::Future;
use core::pin::Pin;
use core::sync::atomic::{AtomicU8, Ordering};
use core::task::{Context, Poll, Waker};
use std::sync::Arc;
use std::sync::OnceLock;

use crate::ThreadPool;

pub use crate::thread_pool::Batch;
pub use crate::thread_pool::Task;

pub struct WorkPool;

/// A type that embeds an intrusive `task: Task` field. Declares the byte
/// offset of that field once and provides the canonical container-of recovery
/// used by every `fn(task: *mut Task)` thread-pool trampoline.
///
/// Implement via [`intrusive_work_task!`]; the trait carries the safety
/// contract so call sites need only assert "scheduled via this field".
///
/// # Safety
/// Inherited from [`bun_core::IntrusiveField<Task>`]: `OFFSET` MUST equal
/// `core::mem::offset_of!(Self, <task field>)`.
pub unsafe trait IntrusiveWorkTask: bun_core::IntrusiveField<Task> {
    /// Safe accessor for the intrusive `task: Task` field
    /// (`&mut self.task`); [`WorkPool::schedule_owned`] uses this to install
    /// the callback without raw byte-offset arithmetic.
    #[inline]
    fn task_mut(&mut self) -> &mut Task {
        self.field_mut()
    }

    /// Back-compat alias for [`bun_core::IntrusiveField::from_field_ptr`].
    ///
    /// # Safety
    /// `task` must point to the [`Task`] field embedded in a live `Self`
    /// allocation, with provenance covering the whole allocation.
    #[inline(always)]
    unsafe fn from_task_ptr(task: *mut Task) -> *mut Self {
        // SAFETY: caller upholds the trait safety contract above.
        unsafe { Self::from_field_ptr(task) }
    }
}

/// An [`IntrusiveWorkTask`] that the [`WorkPool`] takes ownership of by value
/// (`Box<Self>`). [`WorkPool::schedule_owned`] performs the `Box` →
/// raw-pointer hand-off and [`__callback`](OwnedTask::__callback) recovers
/// `Box<Self>` via [`IntrusiveWorkTask::from_task_ptr`], so call sites never
/// touch `Box::into_raw`/`from_raw` directly.
///
/// # Safety
/// [`run`](OwnedTask::run) executes on an arbitrary worker thread (hence the
/// `Send` bound).
pub unsafe trait OwnedTask: IntrusiveWorkTask + Send + 'static {
    /// Run the task. Receives ownership of the heap allocation; dropping
    /// `self` frees it.
    fn run(self: Box<Self>);

    /// The C-ABI thread-pool callback shim. Generic over `Self`; recovers the
    /// owning `Box<Self>` from the intrusive `*mut Task` and dispatches to
    /// [`OwnedTask::run`]. This is the **single** `Box::from_raw` for every
    /// `OwnedTask` implementor.
    #[doc(hidden)]
    unsafe fn __callback(task: *mut Task) {
        // SAFETY: `task` points to the `Task` field inside a `Box<Self>` that
        // `WorkPool::schedule_owned` leaked. The thread pool guarantees this
        // callback fires exactly once per scheduled task, so reclaiming the
        // `Box` here is sound.
        let this = unsafe { Box::from_raw(Self::from_task_ptr(task)) };
        this.run();
    }
}

/// Implements [`IntrusiveWorkTask`] for a struct that embeds an intrusive
/// `task: Task` field. Expands to [`bun_core::intrusive_field!`] + a marker
/// impl; brings [`IntrusiveWorkTask::from_task_ptr`] into scope for the
/// type's `fn(*mut Task)` trampolines.
///
/// ```ignore
/// intrusive_work_task!(ReadFile, task);
/// intrusive_work_task!([Ctx] CryptoJob<Ctx>, task);
/// intrusive_work_task!(['a] AsyncHTTP<'a>, task);
/// ```
#[macro_export]
macro_rules! intrusive_work_task {
    // Generic/lifetime form. The leading `[..]` disambiguates from the
    // plain-type arm so the `:ty` fragment below never sees a `<const ..>`
    // and hard-errors.
    ([$($gen:tt)*] $ty:ty, $field:ident) => {
        ::bun_core::intrusive_field!([$($gen)*] $ty, $field: $crate::work_pool::Task);
        // SAFETY: `IntrusiveField<Task>` impl above supplies the offset/field.
        unsafe impl<$($gen)*> $crate::work_pool::IntrusiveWorkTask for $ty {}
    };
    ($ty:ty, $field:ident) => {
        ::bun_core::intrusive_field!($ty, $field: $crate::work_pool::Task);
        // SAFETY: `IntrusiveField<Task>` impl above supplies the offset/field.
        unsafe impl $crate::work_pool::IntrusiveWorkTask for $ty {}
    };
}

/// Implements [`OwnedTask`] (and the required `Send`) for a struct that
/// embeds an intrusive `task: Task` field and is scheduled fire-and-forget
/// via [`WorkPool::schedule_owned`]. Expands to [`intrusive_work_task!`] +
/// `unsafe impl Send` + the `run` forward — the implementor supplies only an
/// inherent `fn run_owned(self: Box<Self>)`.
///
/// The `Send` impl is part of the macro because every `OwnedTask` is *by
/// construction* sent to a worker thread — the per-type fields (raw `*mut
/// EventLoop`, `*const JSGlobalObject`) are auto-`!Send` only nominally. The
/// safety obligation
/// ("all fields are sound to move across threads") is restated once here
/// rather than at every `WorkPool::schedule(addr_of_mut!((*p).task))` site.
#[macro_export]
macro_rules! owned_task {
    ([$($gen:tt)*] $ty:ty, $field:ident) => {
        $crate::intrusive_work_task!([$($gen)*] $ty, $field);
        // SAFETY: see macro doc — the type is moved to a worker thread by design.
        unsafe impl<$($gen)*> ::core::marker::Send for $ty {}
        // SAFETY: `run` forwards to the inherent `run_owned`.
        unsafe impl<$($gen)*> $crate::work_pool::OwnedTask for $ty {
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
    ($ty:ty, $field:ident) => {
        $crate::intrusive_work_task!($ty, $field);
        // SAFETY: see macro doc — the type is moved to a worker thread by design.
        unsafe impl ::core::marker::Send for $ty {}
        // SAFETY: `run` forwards to the inherent `run_owned`.
        unsafe impl $crate::work_pool::OwnedTask for $ty {
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
}

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
        // (always `Node::default()`).
        task.task_mut().callback = T::__callback;
        // The single into_raw for every OwnedTask scheduler call. Derive the
        // intrusive `*mut Task` *after* into_raw so provenance covers the full
        // allocation and there is exactly one raw-pointer derivation.
        let raw = Box::into_raw(task);
        // SAFETY: `raw` is a live heap allocation now owned by the pool;
        // `IntrusiveField::field_of` projects to the embedded `Task`.
        Self::schedule(unsafe { T::field_of(raw) });
    }

    /// `Box::new` + [`schedule_owned`](Self::schedule_owned). Convenience for
    /// the common case where the task is constructed inline at the call site.
    #[inline]
    pub fn schedule_new<T: OwnedTask>(task: T) {
        Self::schedule_owned(Box::new(task));
    }

    pub fn go<C: Send + 'static>(context: C, function: fn(C)) -> Result<(), bun_alloc::AllocError> {
        // PERF: `function` is stored as a runtime field rather than
        // monomorphized into the callback — profile if it shows up on a hot path.
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

// ─── awaitable offload ───────────────────────────────────────────────────────

/// Oneshot completion state. `RUNNING`: the job may still produce a value.
/// `WAKER_BUSY`: the poller is swapping the waker; completion spins briefly.
/// `DONE`: the value is written and release-published.
const RUNNING: u8 = 0;
const WAKER_BUSY: u8 = 1;
const DONE: u8 = 2;

/// Result cell shared between the pool thread and the awaiting task.
///
/// `value` is written only by the pool thread before `DONE` and read only by
/// the poller after observing `DONE`. `waker` is touched by the poller before
/// the job is scheduled or inside the `WAKER_BUSY` window, and by the pool
/// thread only after winning the `RUNNING→DONE` transition — never
/// concurrently.
struct Oneshot<T> {
    state: AtomicU8,
    value: UnsafeCell<Option<T>>,
    waker: UnsafeCell<Option<Waker>>,
}

// SAFETY: cross-thread access to the `UnsafeCell`s is mediated by the `state`
// protocol documented above; `T: Send` is required by [`run`]'s bounds.
unsafe impl<T: Send> Sync for Oneshot<T> {}

/// Run `f` on the global [`WorkPool`] and await its result.
///
/// Lazy: nothing is scheduled until the first poll (a future that is never
/// polled never runs the closure). Once scheduled, the closure runs exactly
/// once even if the future is dropped early — there is no cancellation, same
/// as every existing pool task; the result is then discarded with the shared
/// cell.
pub fn run<T, F>(f: F) -> RunOnWorkPool<T, F>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    RunOnWorkPool {
        shared: Arc::new(Oneshot {
            state: AtomicU8::new(RUNNING),
            value: UnsafeCell::new(None),
            waker: UnsafeCell::new(None),
        }),
        job: Some(f),
    }
}

/// Future returned by [`run`].
pub struct RunOnWorkPool<T: Send + 'static, F: FnOnce() -> T + Send + 'static> {
    shared: Arc<Oneshot<T>>,
    job: Option<F>,
}

// No field is structurally pinned: `job` is moved out (never polled through)
// and `shared` is an `Arc`. The future itself holds no self-references.
impl<T: Send + 'static, F: FnOnce() -> T + Send + 'static> Unpin for RunOnWorkPool<T, F> {}

impl<T: Send + 'static, F: FnOnce() -> T + Send + 'static> Future for RunOnWorkPool<T, F> {
    type Output = T;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<T> {
        // `RunOnWorkPool` is `Unpin` (`Arc` + `Option<F>`), so no projection.
        let this = self.get_mut();

        if let Some(job) = this.job.take() {
            // First poll: register the waker BEFORE scheduling so the
            // completion can never miss it, then hand the job to the pool.
            // SAFETY: the job is not yet scheduled — no other thread exists
            // that could touch `waker`.
            unsafe { *this.shared.waker.get() = Some(cx.waker().clone()) };

            fn finish<T, F>((shared, job): (Arc<Oneshot<T>>, F))
            where
                F: FnOnce() -> T + Send + 'static,
                T: Send + 'static,
            {
                let value = job();
                // SAFETY: the pool thread is the only writer of `value`, and
                // the poller reads it only after observing `DONE`.
                unsafe { *shared.value.get() = Some(value) };
                // Win the baton; a poller mid-waker-swap holds `WAKER_BUSY`
                // for a few instructions at most.
                while shared
                    .state
                    .compare_exchange(RUNNING, DONE, Ordering::AcqRel, Ordering::Acquire)
                    .is_err()
                {
                    std::thread::yield_now();
                }
                // SAFETY: once `DONE` is published the poller never touches
                // `waker` again (it goes straight to the value).
                if let Some(waker) = unsafe { (*shared.waker.get()).take() } {
                    waker.wake();
                }
            }

            let shared = Arc::clone(&this.shared);
            bun_core::handle_oom(WorkPool::go((shared, job), finish::<T, F>));
            return Poll::Pending;
        }

        if this.shared.state.load(Ordering::Acquire) == DONE {
            // SAFETY: `DONE` was release-published after the value write;
            // the single poller takes the value exactly once.
            let value = unsafe { (*this.shared.value.get()).take() };
            return Poll::Ready(value.expect("RunOnWorkPool polled after completion"));
        }

        // Re-polled before completion (e.g. a spurious wake of the parent
        // task): refresh the waker under the `WAKER_BUSY` baton so the
        // completion can't read it concurrently.
        match this.shared.state.compare_exchange(
            RUNNING,
            WAKER_BUSY,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => {
                // SAFETY: `WAKER_BUSY` excludes the completion's waker read.
                unsafe { *this.shared.waker.get() = Some(cx.waker().clone()) };
                this.shared.state.store(RUNNING, Ordering::Release);
                Poll::Pending
            }
            Err(_) => {
                // Completion won the race; the value is ready now.
                // SAFETY: as in the `DONE` fast path above.
                let value = unsafe { (*this.shared.value.get()).take() };
                Poll::Ready(value.expect("RunOnWorkPool polled after completion"))
            }
        }
    }
}
