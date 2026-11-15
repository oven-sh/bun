use core::ptr::NonNull;
use std::sync::OnceLock;

use bun_ptr::OwnedPtr;

use crate::ThreadPool;

pub use crate::thread_pool::Batch;
pub use crate::thread_pool::Task;

pub struct WorkPool;

/// A type that embeds an intrusive `task: Task` field. Declares the byte
/// offset of that field once and provides the canonical container-of recovery
/// used by every `fn(task: *mut Task)` thread-pool trampoline.
///
/// Implement via [`intrusive_work_task!`]; the supertrait carries the safety
/// contract so call sites need only assert "scheduled via this field".
pub trait IntrusiveWorkTask: bun_core::IntrusiveField<Task> {
    /// Safe accessor for the intrusive `task: Task` field
    /// (`&mut self.task`); [`Batch::from_owned`] uses this to install
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
        // SAFETY: caller upholds the fn contract above.
        unsafe { Self::from_field_ptr(task) }
    }
}

// The only impl: `OwnedTaskIn::__callback` trusts `from_task_ptr`, so no type may override it.
impl<T: bun_core::IntrusiveField<Task>> IntrusiveWorkTask for T {}

/// An [`IntrusiveWorkTask`] that a [`ThreadPool`] owns. [`Batch::from_owned`] performs the `Box` →
/// raw-pointer hand-off and [`__callback`](OwnedTaskIn::__callback) recovers
/// `Box<Self>` via [`IntrusiveWorkTask::from_task_ptr`], so call sites never
/// touch `Box::into_raw`/`from_raw` directly.
///
/// [`run`](OwnedTask::run) executes on an arbitrary worker thread (hence the
/// `Send` bound).
pub trait OwnedTask: IntrusiveWorkTask + Send + 'static {
    /// Run the task. Receives ownership of the heap allocation; dropping
    /// `self` frees it.
    fn run(self: Box<Self>);
}

/// Like [`OwnedTask`], for a task that `P` owns.
pub trait OwnedTaskIn<P>: IntrusiveWorkTask + Sized
where
    P: OwnedPtr<Target = Self> + Send + 'static,
{
    fn run(this: P);

    /// The C-ABI thread-pool callback shim. Generic over `Self`; recovers the
    /// owning `P` from the intrusive `*mut Task` and dispatches to
    /// [`OwnedTaskIn::run`]. This is the **single** `from_raw` for every
    /// implementor.
    #[doc(hidden)]
    unsafe fn __callback(task: *mut Task) {
        // SAFETY: `task` points to the `Task` field behind the `P` that
        // `Batch::from_owned` leaked. The thread pool guarantees this
        // callback fires exactly once per scheduled task, so reclaiming the
        // `P` here is sound.
        let this = unsafe { P::from_raw(NonNull::new_unchecked(Self::from_task_ptr(task))) };
        Self::run(this);
    }
}

impl<T: OwnedTask> OwnedTaskIn<Box<T>> for T {
    fn run(this: Box<T>) {
        this.run();
    }
}

/// Implements [`IntrusiveWorkTask`] for a struct that embeds an intrusive
/// `task: Task` field. Expands to [`bun_core::intrusive_field!`].
///
/// ```ignore
/// intrusive_work_task!(ReadFile, task);
/// intrusive_work_task!([Ctx] CryptoJob<Ctx>, task);
/// ```
#[macro_export]
macro_rules! intrusive_work_task {
    // Generic/lifetime form. The leading `[..]` disambiguates from the
    // plain-type arm so the `:ty` fragment below never sees a `<const ..>`
    // and hard-errors.
    ([$($gen:tt)*] $ty:ty, $field:ident) => {
        ::bun_core::intrusive_field!([$($gen)*] $ty, $field: $crate::work_pool::Task);
    };
    ($ty:ty, $field:ident) => {
        ::bun_core::intrusive_field!($ty, $field: $crate::work_pool::Task);
    };
}

impl Batch {
    /// [`OwnedTaskIn::run`] gets `task` back on a thread of the pool that schedules the batch.
    pub fn from_owned<T, P>(mut task: P) -> Batch
    where
        T: OwnedTaskIn<P>,
        P: OwnedPtr<Target = T> + Send + 'static,
    {
        task.task_mut().callback = T::__callback;
        let raw = P::into_raw(task).as_ptr();
        // SAFETY: `raw` is a live value, which the batch now owns. The `Task` is
        // projected from the raw pointer, so that it covers the whole value.
        unsafe { Batch::from_raw(T::field_of(raw)) }
    }

    /// The task is freed before `f` is called.
    pub fn from_fn<F: FnOnce() + Send + 'static>(f: F) -> Batch {
        struct FnTask<F> {
            task: Task,
            f: F,
        }
        intrusive_work_task!([F] FnTask<F>, task);

        impl<F: FnOnce() + Send + 'static> OwnedTask for FnTask<F> {
            fn run(self: Box<Self>) {
                let f = { self }.f;
                f();
            }
        }

        Batch::from_owned(Box::new(FnTask {
            task: Task::default(),
            f,
        }))
    }
}

static POOL: OnceLock<ThreadPool> = OnceLock::new();

#[cold]
fn config() -> crate::thread_pool::Config {
    crate::thread_pool::Config {
        max_threads: u32::from(bun_core::get_thread_count()),
        ..Default::default()
    }
}

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        ThreadPool::get_or_init(&POOL, config)
    }

    /// # Safety
    /// Same as [`Batch::from_raw`].
    pub unsafe fn schedule(task: *mut Task) {
        // SAFETY: fn contract.
        Self::get().schedule(unsafe { Batch::from_raw(task) });
    }

    /// Schedule a heap-allocated task by value. The pool takes ownership of
    /// the `Box`; [`OwnedTask::run`] receives it back on a worker thread.
    /// Replaces the open-coded `Box::into_raw` + `&raw mut (*p).task` +
    /// `container_of`-in-callback pattern.
    pub fn schedule_owned<T: OwnedTask>(task: Box<T>) {
        Self::get().schedule(Batch::from_owned(task));
    }

    /// `Box::new` + [`schedule_owned`](Self::schedule_owned). Convenience for
    /// the common case where the task is constructed inline at the call site.
    #[inline]
    pub fn schedule_new<T: OwnedTask>(task: T) {
        Self::schedule_owned(Box::new(task));
    }

    pub fn go<C: Send + 'static>(context: C, function: fn(C)) -> Result<(), bun_alloc::AllocError> {
        Self::get().schedule(Batch::from_fn(move || function(context)));
        Ok(())
    }
}
