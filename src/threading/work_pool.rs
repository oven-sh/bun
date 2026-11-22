use std::sync::OnceLock;

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

impl Batch {
    /// [`OwnedTask::run`] gets the `Box` back on a thread of the pool that schedules the batch.
    pub fn from_owned<T: OwnedTask>(mut task: Box<T>) -> Batch {
        task.task_mut().callback = T::__callback;
        let raw = Box::into_raw(task);
        // SAFETY: `raw` is a live heap allocation, which the batch now owns. The `Task` is
        // projected from the raw pointer, so that it covers the whole allocation.
        Batch::from(unsafe { T::field_of(raw) })
    }
}

/// The tasks that one scheduler has under way, which tells it when to use `WorkPool::schedule_lone`.
#[derive(Default)]
pub struct UnderWay {
    tasks: u32,
    /// One bit for each of the last 8 tasks, the newest in bit 0: it began beside another.
    company: u8,
}

impl UnderWay {
    /// Counts a task in. Whether it is alone: it and the 7 before it each began with no other under way.
    pub fn begin(&mut self) -> bool {
        // The first task of a batch begins with no other under way too, and so does a single task before the batch.
        self.company = (self.company << 1) | u8::from(self.tasks != 0);
        self.tasks += 1;
        self.company == 0
    }

    /// Counts out a task that `begin` counted in.
    pub fn end(&mut self) {
        self.tasks -= 1;
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

impl WorkPool {
    #[inline]
    pub fn get() -> &'static ThreadPool {
        POOL.get_or_init(create)
    }

    pub fn schedule(task: *mut Task) {
        Self::get().schedule(Batch::from(task));
    }

    /// See `ThreadPool::schedule_lone`. `UnderWay::begin` says when to call it.
    pub fn schedule_lone(task: *mut Task) {
        Self::get().schedule_lone(task);
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

#[cfg(test)]
mod tests {
    use super::UnderWay;

    /// Whether each of `count` tasks is alone, when each ends before the next begins.
    fn one_by_one(under_way: &mut UnderWay, count: usize) -> Vec<bool> {
        let each = |_| {
            let alone = under_way.begin();
            under_way.end();
            alone
        };
        (0..count).map(each).collect()
    }

    /// Whether each of `count` tasks is alone, when all begin before the first ends.
    fn at_once(under_way: &mut UnderWay, count: usize) -> Vec<bool> {
        let alone = (0..count).map(|_| under_way.begin()).collect();
        (0..count).for_each(|_| under_way.end());
        alone
    }

    #[test]
    fn tasks_that_begin_one_after_the_other_are_alone() {
        let mut under_way = UnderWay::default();
        assert_eq!(one_by_one(&mut under_way, 20), [true; 20]);
    }

    #[test]
    fn the_seven_tasks_after_one_that_began_beside_another_are_not_alone() {
        let mut under_way = UnderWay::default();
        assert_eq!(at_once(&mut under_way, 3), [true, false, false]);
        assert_eq!(one_by_one(&mut under_way, 9), [false, false, false, false, false, false, false, true, true]);
    }

    #[test]
    fn the_first_task_of_a_batch_is_alone_only_after_seven_that_came_one_by_one() {
        let mut under_way = UnderWay::default();
        at_once(&mut under_way, 2);
        for single_tasks in [0, 1, 2, 6] {
            for _ in 0..3 {
                assert_eq!(one_by_one(&mut under_way, single_tasks), vec![false; single_tasks]);
                assert_eq!(at_once(&mut under_way, 2), [false, false]);
            }
        }
        assert_eq!(one_by_one(&mut under_way, 7), [false; 7]);
        assert_eq!(at_once(&mut under_way, 2), [true, false]);
    }
}
