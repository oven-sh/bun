//! Typed registration/recovery pairing for the work pool: Box in, `&mut C` in
//! the callback, Box out.
//!
//! The raw [`Task`] callback shape is `unsafe fn(*mut Task)` — every consumer
//! used to `Box::into_raw` its own struct, stash the resulting pointer in the
//! pool, and `Box::from_raw` + `container_of` it back inside the callback,
//! restating the "this pointer is really a `MyTask`" invariant at both ends.
//! [`ScheduledTask<C>`] carries that invariant in its type parameter instead:
//! [`ScheduledTask::new`] is the only place the trampoline is installed and
//! [`ScheduledTask::schedule`] is the only place the allocation is leaked, so
//! the `*mut Task` the pool hands back to the trampoline is a
//! `ScheduledTask<C>` for the same `C` by construction.
//!
//! The single remaining `unsafe` for this callback shape is the trampoline.

use crate::thread_pool::{Node, Task};
use crate::work_pool::WorkPool;

/// A unit of work the pool runs with exclusive access to `&mut self`.
///
/// The wrapper (not the implementor) owns the intrusive [`Task`] plumbing, so
/// implementors are plain structs with no `#[repr(C)]` / field-offset
/// obligations.
///
/// `Send + 'static` because the context is moved to an arbitrary worker
/// thread and outlives the scheduling scope. A non-`Send` context is a
/// compile error at the [`ScheduledTask::new`] call site:
///
/// ```compile_fail
/// use bun_threading::scheduled_task::{ScheduledContext, ScheduledTask};
///
/// struct NotSend(*mut u8);
/// impl ScheduledContext for NotSend {
///     fn run(&mut self) {}
/// }
/// // error[E0277]: `*mut u8` cannot be sent between threads safely
/// let _ = ScheduledTask::new(NotSend(core::ptr::null_mut()));
/// ```
pub trait ScheduledContext: Send + Sized + 'static {
    /// Runs on a worker thread. The trampoline recovers the heap allocation
    /// and lends the context out as `&mut C` for the duration of the call.
    fn run(&mut self);

    /// Receives the heap allocation back after [`run`](Self::run) returns,
    /// still on the worker thread. The default drops it (fire-and-forget);
    /// override to hand the box onward, e.g. to an event-loop completion
    /// queue.
    fn finish(task: Box<ScheduledTask<Self>>) {
        drop(task);
    }
}

/// Owning pair of an intrusive work-pool [`Task`] and its typed context.
///
/// `#[repr(C)]` with `task` first so the `*mut Task` the pool threads through
/// its intrusive queue is the same address as the `ScheduledTask<C>`
/// allocation — the trampoline's container-of is a pointer cast.
#[repr(C)]
pub struct ScheduledTask<C: ScheduledContext> {
    task: Task,
    context: C,
}

impl<C: ScheduledContext> ScheduledTask<C> {
    /// Heap-allocate a task around `context` with the typed trampoline
    /// pre-installed. This is the registration half of the pairing: the only
    /// callback ever stored in this `Task` is `Self::trampoline`, which
    /// recovers the same `ScheduledTask<C>`.
    pub fn new(context: C) -> Box<Self> {
        Box::new(Self {
            task: Task {
                node: Node::default(),
                callback: Self::trampoline,
            },
            context,
        })
    }

    /// Shared access to the context before scheduling / after recovery.
    #[inline]
    pub fn context(&self) -> &C {
        &self.context
    }

    /// Exclusive access to the context before scheduling / after recovery.
    #[inline]
    pub fn context_mut(&mut self) -> &mut C {
        &mut self.context
    }

    /// Unwrap the context (e.g. out of the box recovered by
    /// [`ScheduledContext::finish`]; `Box<Self>` auto-derefs and frees the
    /// allocation).
    #[inline]
    pub fn into_context(self) -> C {
        self.context
    }

    /// Box in: hand the allocation to the global [`WorkPool`]. Ownership
    /// returns to Rust inside [`Self::trampoline`], which gives it back to
    /// [`ScheduledContext::finish`].
    pub fn schedule(self: Box<Self>) {
        WorkPool::schedule(Self::into_task_ptr(self));
    }

    /// `Box::new` + [`schedule`](Self::schedule) for contexts built inline at
    /// the call site.
    #[inline]
    pub fn schedule_new(context: C) {
        Self::new(context).schedule();
    }

    /// Leak the box into the intrusive `*mut Task` the pool links into its
    /// queue. Private: pairing with [`Self::trampoline`] is what makes the
    /// recovery sound, so no other callback may ever see this pointer.
    fn into_task_ptr(self: Box<Self>) -> *mut Task {
        const { assert!(core::mem::offset_of!(Self, task) == 0) };
        Box::into_raw(self).cast::<Task>()
    }

    /// The work-pool trampoline for this `C`: Box out, `&mut C` for the
    /// handler, Box handed to [`ScheduledContext::finish`].
    ///
    /// This is the single `unsafe` for the work-pool callback shape.
    unsafe fn trampoline(task: *mut Task) {
        const { assert!(core::mem::offset_of!(Self, task) == 0) };
        // SAFETY: type-pairing proof. `Self::trampoline` is private and only
        // ever installed by `Self::new`, and the resulting `Box<Self>` is only
        // ever leaked into the pool by `Self::into_task_ptr` (also private).
        // The pool invokes `task.callback` exactly once with the same `*mut
        // Task` it was given, so `task` is the (offset-0) `task` field of a
        // live, uniquely-owned `ScheduledTask<C>` heap allocation for this
        // exact `C`. Reclaiming the `Box` here is therefore sound and cannot
        // double-free.
        let mut this: Box<Self> = unsafe { Box::from_raw(task.cast::<Self>()) };
        this.context.run();
        C::finish(this);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    struct Ctx {
        runs: u32,
        done: mpsc::Sender<u32>,
    }

    impl ScheduledContext for Ctx {
        fn run(&mut self) {
            self.runs += 1;
        }

        fn finish(task: Box<ScheduledTask<Self>>) {
            // Box out: the same allocation `schedule` leaked comes back here
            // with the mutation `run` made through `&mut self` visible.
            let ctx = task.into_context();
            ctx.done.send(ctx.runs).expect("test receiver alive");
        }
    }

    /// Example adoption: schedule onto the real global pool. Cannot run under
    /// Miri (the pool's futex park path is a foreign syscall).
    #[test]
    #[cfg_attr(miri, ignore)]
    fn round_trips_through_the_pool() {
        let (tx, rx) = mpsc::channel();
        ScheduledTask::schedule_new(Ctx { runs: 0, done: tx });
        assert_eq!(rx.recv().expect("task ran"), 1);
    }

    /// Drive the trampoline directly (no pool, no FFI) so the Box-in →
    /// `&mut C` → Box-out round trip is observable single-threaded — and so
    /// Miri can check the recovery for aliasing/UAF.
    #[test]
    fn trampoline_recovers_the_same_allocation() {
        let (tx, rx) = mpsc::channel();
        let task =
            ScheduledTask::<Ctx>::into_task_ptr(ScheduledTask::new(Ctx { runs: 0, done: tx }));
        // SAFETY: `task` came from `into_task_ptr` on a `ScheduledTask<Ctx>`
        // and is invoked exactly once, exactly as the pool would.
        unsafe { ((*task).callback)(task) };
        // `run` executed on this thread, mutated the context through `&mut C`,
        // and `finish` observed that mutation in the recovered Box.
        assert_eq!(rx.recv().expect("finish ran"), 1);
    }
}
