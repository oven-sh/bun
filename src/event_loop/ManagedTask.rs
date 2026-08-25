//! A one-off queued closure. Use it when adding a dedicated `Task` tag is not
//! worth it; the closure and everything it captured are dropped, not run, if
//! the VM stops first.

use crate::{JsResult, Task};

/// Type-erased head of a [`ManagedTaskOf<F>`]; `Task::ptr` points here.
#[repr(C)]
pub struct ManagedTask {
    run: unsafe fn(*mut ManagedTask) -> JsResult<()>,
    release: unsafe fn(*mut ManagedTask),
}

#[repr(C)]
struct ManagedTaskOf<F> {
    header: ManagedTask,
    f: F,
}

impl ManagedTask {
    /// Queueable task that runs `f` once on the JS thread.
    pub fn new<F: FnOnce() -> JsResult<()> + 'static>(f: F) -> Task {
        let task = bun_core::heap::into_raw(Box::new(ManagedTaskOf {
            header: ManagedTask {
                // SAFETY: only reached through this header, so `p` is this
                // `ManagedTaskOf<F>`; consumes the box.
                run: |p| (unsafe { bun_core::heap::take(p.cast::<ManagedTaskOf<F>>()) }.f)(),
                // SAFETY: as above.
                release: |p| drop(unsafe { bun_core::heap::take(p.cast::<ManagedTaskOf<F>>()) }),
            },
            f,
        }));
        Task::new(crate::task_tag::ManagedTask, task.cast())
    }

    /// # Safety
    /// `this` is the `Task::ptr` of a task built by [`new`](Self::new); it is
    /// consumed.
    pub unsafe fn run(this: *mut ManagedTask) -> JsResult<()> {
        // SAFETY: fn contract.
        unsafe { ((*this).run)(this) }
    }

    /// Drop the closure without running it.
    ///
    /// # Safety
    /// As [`run`](Self::run).
    pub(crate) unsafe fn release_unrun(this: *mut ManagedTask) {
        // SAFETY: fn contract.
        unsafe { ((*this).release)(this) }
    }
}

const _: () = assert!(core::mem::offset_of!(ManagedTaskOf<[usize; 3]>, header) == 0);
