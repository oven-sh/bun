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

/// A `T` that stays shared (`&T` / [`ThisPtr`](bun_ptr::ThisPtr)) while the
/// pool holds its embedded task node: the node sits in a [`Cell`](core::cell::Cell)
/// (built by [`shared_work_task_node`]) and the pool re-enters `T` through a
/// `ThisPtr`, on a pool thread, concurrently with whatever the scheduling
/// thread still does to `T`. Implement via [`shared_work_task!`], which
/// carries the contract; schedule with [`WorkPool::schedule_shared`].
///
/// # Safety
/// Whoever calls `schedule_shared` keeps `T` allocated, and its node
/// untouched, until `run_work_task` is done with it; and every field of `T`
/// is either confined to one side (the pool's `run_work_task`, or the
/// scheduling thread) for that span or synchronized — `T` need not be `Sync`
/// otherwise, so the type system does not check this.
pub unsafe trait SharedWorkTask: bun_core::IntrusiveField<core::cell::Cell<Task>> {
    /// Pool thread.
    fn run_work_task(this: bun_ptr::ThisPtr<Self>);
}

/// The task node for a [`SharedWorkTask`], to store in the field its
/// `IntrusiveField` impl names.
pub fn shared_work_task_node<T: SharedWorkTask>() -> core::cell::Cell<Task> {
    /// # Safety
    /// Only installed by [`shared_work_task_node`], so `task` is the node
    /// embedded in a live `T` that [`WorkPool::schedule_shared`] handed to the pool.
    unsafe fn run<T: SharedWorkTask>(task: *mut Task) {
        // SAFETY: fn contract (`Cell<Task>` is `repr(transparent)` over `Task`).
        let this = unsafe { T::from_field_ptr(task.cast::<core::cell::Cell<Task>>()) };
        // SAFETY: fn contract — the scheduler keeps `T` live for this call.
        T::run_work_task(unsafe { bun_ptr::ThisPtr::new(this) });
    }
    core::cell::Cell::new(Task {
        node: Default::default(),
        callback: run::<T>,
    })
}

/// Implements [`SharedWorkTask`] for a struct that embeds a
/// `$field: Cell<Task>` node and has an inherent
/// `fn run_work_task(this: ThisPtr<Self>)` (pool thread). The invocation is
/// where the trait's contract is vouched for: say next to it which fields the
/// pool side touches and what keeps the value alive while it is scheduled.
#[macro_export]
macro_rules! shared_work_task {
    ($ty:ty, $field:ident) => {
        ::bun_core::intrusive_field!($ty, $field: ::core::cell::Cell<$crate::work_pool::Task>);
        // SAFETY: see macro doc — the invoker states the confinement / liveness at the call site.
        unsafe impl $crate::work_pool::SharedWorkTask for $ty {
            #[inline]
            fn run_work_task(this: ::bun_ptr::ThisPtr<Self>) {
                <$ty>::run_work_task(this)
            }
        }
    };
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

    pub fn schedule(task: *mut Task) {
        Self::get().schedule(Batch::from(task));
    }

    /// Hand `this`'s embedded [`SharedWorkTask`] node to the pool (see the
    /// trait's contract).
    pub fn schedule_shared<T: SharedWorkTask>(this: bun_ptr::ThisPtr<T>) {
        // SAFETY: `ThisPtr` invariant — `this` is a live `T`, so projecting to its
        // node stays in bounds; `Cell<Task>` is `repr(transparent)` over `Task`.
        Self::schedule(unsafe { T::field_of(this.as_ptr()) }.cast::<Task>());
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
