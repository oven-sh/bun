use std::sync::OnceLock;

use crate::ThreadPool;
#[cfg(windows)]
use crate::fifo_pool::{Config, FifoPool};

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

// The only impl: `OwnedTask::__callback` trusts `from_task_ptr`, so no type may override it.
impl<T: bun_core::IntrusiveField<Task>> IntrusiveWorkTask for T {}

/// An [`IntrusiveWorkTask`] that a [`ThreadPool`] owns. [`Batch::from_owned`] performs the `Box` →
/// raw-pointer hand-off and [`__callback`](OwnedTask::__callback) recovers
/// `Box<Self>` via [`IntrusiveWorkTask::from_task_ptr`], so call sites never
/// touch `Box::into_raw`/`from_raw` directly.
///
/// [`run`](OwnedTask::run) executes on an arbitrary worker thread (hence the
/// `Send` bound).
pub trait OwnedTask: IntrusiveWorkTask + Send + 'static {
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
        // `Batch::from_owned` leaked. The thread pool guarantees this
        // callback fires exactly once per scheduled task, so reclaiming the
        // `Box` here is sound.
        let this = unsafe { Box::from_raw(Self::from_task_ptr(task)) };
        this.run();
    }
}

/// Implements [`IntrusiveWorkTask`] for a struct that embeds an intrusive
/// `task: Task` field. Expands to [`bun_core::intrusive_field!`].
///
/// ```ignore
/// intrusive_work_task!(UninstallTask, task);
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
        impl<$($gen)*> $crate::work_pool::OwnedTask for $ty {
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
    ($ty:ty, $field:ident) => {
        $crate::intrusive_work_task!($ty, $field);
        // SAFETY: see macro doc — the type is moved to a worker thread by design.
        unsafe impl ::core::marker::Send for $ty {}
        impl $crate::work_pool::OwnedTask for $ty {
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) { <$ty>::run_owned(self) }
        }
    };
}

fn task_from_owned<T: OwnedTask>(mut task: Box<T>) -> *mut Task {
    task.task_mut().callback = T::__callback;
    let raw = Box::into_raw(task);
    // SAFETY: `raw` is a live heap allocation, which the task now owns. The `Task` is
    // projected from the raw pointer, so that it covers the whole allocation.
    unsafe { T::field_of(raw) }
}

impl Batch {
    /// [`OwnedTask::run`] gets the `Box` back on a thread of the pool that schedules the batch.
    pub fn from_owned<T: OwnedTask>(task: Box<T>) -> Batch {
        Batch::from(task_from_owned(task))
    }
}

struct Call<F> {
    task: Task,
    run: F,
}

intrusive_work_task!([F] Call<F>, task);

impl<F: FnOnce() + Send + 'static> OwnedTask for Call<F> {
    fn run(self: Box<Self>) {
        (self.run)();
    }
}

pub(crate) fn task_from_fn(run: impl FnOnce() + Send + 'static) -> *mut Task {
    let task = Task::default();
    task_from_owned(Box::new(Call { task, run }))
}

impl Batch {
    pub fn from_fn(run: impl FnOnce() + Send + 'static) -> Batch {
        Batch::from(task_from_fn(run))
    }
}

static POOL: OnceLock<ThreadPool> = OnceLock::new();

#[cold]
fn create() -> ThreadPool {
    ThreadPool::init(crate::thread_pool::Config {
        max_threads: u32::from(bun_core::get_thread_count()),
        stack_size: crate::thread_pool::POOL_THREAD_STACK_SIZE,
    })
}

/// For calls on open files. On Windows those pin their directory, so they do not wait behind computations.
pub struct FilePool;

impl FilePool {
    #[cfg(windows)]
    pub fn get() -> &'static FifoPool {
        static POOL: std::sync::LazyLock<FifoPool> = std::sync::LazyLock::new(|| {
            let threads = bun_core::env_var::UV_THREADPOOL_SIZE.get().unwrap_or(4);
            FifoPool::new(Config {
                name: "File I/O",
                max_threads: threads.clamp(1, 1024) as usize,
                stack_size: 4 * 1024 * 1024,
                on_thread_start: bun_core::Output::Source::configure_thread_no_js,
                has_new_threads: true,
            })
        });
        &POOL
    }

    pub fn go(run: impl FnOnce() + Send + 'static) {
        #[cfg(windows)]
        Self::get().go(run);
        #[cfg(not(windows))]
        WorkPool::schedule(task_from_fn(run));
    }
}

/// For calls of scripts on pipes, consoles and other devices, which can take any time.
#[cfg(windows)]
pub static DEVICE_POOL: FifoPool = FifoPool::new(Config {
    name: "Device I/O",
    max_threads: 512,
    stack_size: 4 * 1024 * 1024,
    on_thread_start: bun_core::Output::Source::configure_thread_no_js,
    has_new_threads: false,
});

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        POOL.get_or_init(create)
    }

    pub fn schedule(task: *mut Task) {
        Self::get().schedule(Batch::from(task));
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
