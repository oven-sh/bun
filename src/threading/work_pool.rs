use std::sync::OnceLock;

use crate::{Guarded, ThreadPool};

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
static DESCRIPTOR_POOL: PoolInOrder =
    PoolInOrder::new("Bun I/O", || u32::from(bun_core::get_thread_count()).max(4));
static OUTPUT_POOL: PoolInOrder = PoolInOrder::new("Bun Output", || 2);

/// Its tasks start in the order they were given in, as the requests of libuv's pool do. Which ends first is open.
struct PoolInOrder {
    name: &'static str,
    max_threads: fn() -> u32,
    pool: OnceLock<ThreadPool>,
    /// What no thread has taken yet, the oldest first.
    waiting: Guarded<Batch>,
}

/// A [`ThreadPool`] keeps no order, so it is given a turn, and the turn takes the oldest task.
struct Turn {
    task: Task,
    pool: &'static PoolInOrder,
}

crate::owned_task!(Turn, task);

impl Turn {
    fn run_owned(self: Box<Self>) {
        let Some(task) = self.pool.waiting.lock().pop() else {
            unreachable!("one turn per task");
        };
        drop(self);
        // SAFETY: the task is live until its callback runs, as for a task that the pool itself holds.
        unsafe { ((*task.as_ptr()).callback)(task.as_ptr()) };
    }
}

impl PoolInOrder {
    const fn new(name: &'static str, max_threads: fn() -> u32) -> PoolInOrder {
        PoolInOrder {
            name,
            max_threads,
            pool: OnceLock::new(),
            waiting: Guarded::new(Batch::EMPTY),
        }
    }

    fn schedule(&'static self, task: *mut Task) {
        self.waiting.lock().push(Batch::from(task));
        let pool = self.pool.get_or_init(|| {
            ThreadPool::init(crate::thread_pool::Config {
                max_threads: (self.max_threads)(),
                stack_size: crate::thread_pool::POOL_THREAD_STACK_SIZE,
            })
            .named(self.name)
            .without_spare_threads()
        });
        WorkPool::schedule_owned_on(
            pool,
            Box::new(Turn {
                task: Task::default(),
                pool: self,
            }),
        );
    }
}

#[cold]
fn create() -> ThreadPool {
    ThreadPool::init(crate::thread_pool::Config {
        max_threads: u32::from(bun_core::get_thread_count()),
        stack_size: crate::thread_pool::POOL_THREAD_STACK_SIZE,
    })
}

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        POOL.get_or_init(create)
    }

    pub fn schedule(task: *mut Task) {
        Self::get().schedule(Batch::from(task));
    }

    /// For a task that works on a descriptor. It can block until somebody outside the process acts (a pipe read), so these have threads of their own.
    pub fn schedule_for_descriptor(task: *mut Task) {
        DESCRIPTOR_POOL.schedule(task);
    }

    /// For a task about the standard output or error. The exit of the process waits for it, so it is behind no other wait.
    pub fn schedule_output(task: *mut Task) {
        OUTPUT_POOL.schedule(task);
    }

    /// Schedule a heap-allocated task by value. The pool takes ownership of
    /// the `Box`; [`OwnedTask::run`] receives it back on a worker thread.
    /// Replaces the open-coded `Box::into_raw` + `&raw mut (*p).task` +
    /// `container_of`-in-callback pattern.
    pub fn schedule_owned<T: OwnedTask>(task: Box<T>) {
        Self::schedule_owned_on(Self::get(), task);
    }

    fn schedule_owned_on<T: OwnedTask>(pool: &ThreadPool, mut task: Box<T>) {
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
        pool.schedule(Batch::from(unsafe { T::field_of(raw) }));
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
