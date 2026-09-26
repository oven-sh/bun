//! A refcounted object's entry in its VM's [`DeferredTaskQueue`]
//! (`EventLoop.deferred_tasks`): the "flush my write buffer after the
//! microtask queue drains" hook shared by the SQL and Redis clients.
//!
//! The queue stores an erased pointer and calls back with it, so the entry
//! must keep the object alive. [`AutoFlusher`] is that entry as a typed slot
//! on the object: while registered it holds one ref, released when the object
//! unregisters itself or when its callback tells the queue to drop the entry.
//!
//! [`DeferredTaskQueue`]: bun_event_loop::DeferredTaskQueue::DeferredTaskQueue

use core::cell::Cell;
use core::ffi::c_void;

use bun_ptr::{AnyRefCounted, RefPtr, ThisPtr};

use crate::virtual_machine::VirtualMachine;

/// A type with an [`AutoFlusher`] slot.
pub trait AutoFlushTarget: AnyRefCounted + 'static {
    fn auto_flusher(&self) -> &AutoFlusher<Self>;
    /// Runs after the microtask queue drains while registered. Return `true`
    /// to stay registered for the next drain, `false` to drop the entry.
    fn on_auto_flush(this: ThisPtr<Self>) -> bool;
}

/// `T`'s deferred-task registration; see the module docs.
pub struct AutoFlusher<T: AutoFlushTarget> {
    held: Cell<Option<RefPtr<T>>>,
}

impl<T: AutoFlushTarget> Default for AutoFlusher<T> {
    fn default() -> Self {
        Self {
            held: Cell::new(None),
        }
    }
}

impl<T: AutoFlushTarget> AutoFlusher<T> {
    #[inline]
    pub fn is_registered(&self) -> bool {
        let held = self.held.take();
        let registered = held.is_some();
        self.held.set(held);
        registered
    }

    /// Queue `this` for the next deferred-task drain if it is not queued yet.
    pub fn register(this: ThisPtr<T>, vm: &VirtualMachine) {
        let slot = this.auto_flusher();
        if slot.is_registered() {
            return;
        }
        slot.held.set(Some(RefPtr::from_this(this)));
        let found_existing = vm.event_loop_mut().deferred_tasks.post_task(
            core::ptr::NonNull::new(this.as_ptr().cast::<c_void>()),
            run::<T>,
        );
        debug_assert!(!found_existing);
    }

    /// Remove the entry, if any. Releases the ref it held, which may be the
    /// last one.
    pub fn unregister(&self, vm: &VirtualMachine) {
        let Some(held) = self.held.take() else {
            return;
        };
        let removed = vm
            .event_loop_mut()
            .deferred_tasks
            .unregister_task(core::ptr::NonNull::new(held.as_ptr().cast::<c_void>()));
        debug_assert!(removed);
        drop(held);
    }
}

impl<T: AutoFlushTarget> Drop for AutoFlusher<T> {
    fn drop(&mut self) {
        debug_assert!(
            self.held.get_mut().is_none(),
            "AutoFlusher dropped while registered"
        );
    }
}

extern "C" fn run<T: AutoFlushTarget>(ctx: *mut c_void) -> bool {
    // SAFETY: `ctx` is the pointer `register` posted; the queue only calls an
    // entry that is still registered, and a registered entry holds a ref on
    // that `T` (`held`), so it is live here.
    let this = unsafe { ThisPtr::new(ctx.cast::<T>()) };
    // The callback may `unregister` (releasing `held`) and then drop the last
    // other ref from re-entrant JS; keep `this` alive until we are done with it.
    let _alive = RefPtr::from_this(this);
    let keep = T::on_auto_flush(this);
    if keep {
        return true;
    }
    // The queue drops the entry on `false`; release the ref it held.
    drop(this.auto_flusher().held.take());
    false
}
