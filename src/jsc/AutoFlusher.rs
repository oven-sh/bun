use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_core::IntrusiveField;
use bun_event_loop::deferred_task_queue::DeferredTask;
use bun_ptr::OptionCellExt as _;

use crate::virtual_machine::VirtualMachine;

/// Its owner's entry in a `DeferredTaskQueue` of this thread, and what it holds while it has one.
pub struct AutoFlusher<Held = ()>(Cell<Option<Held>>);

/// SAFETY: a value does not move while it is registered.
pub unsafe trait AutoFlush<Held = ()>: IntrusiveField<AutoFlusher<Held>> {
    /// Whether to run again after the next turn. SAFETY: `this` is live.
    unsafe fn on_auto_flush(this: *mut Self) -> bool;
}

impl<Held> Default for AutoFlusher<Held> {
    fn default() -> Self {
        Self(Cell::new(None))
    }
}

impl AutoFlusher {
    pub fn register(owner: &impl AutoFlush, vm: &VirtualMachine) {
        Self::register_holding(owner, vm, || ());
    }
}

impl<Held> AutoFlusher<Held> {
    pub fn register_holding<T: AutoFlush<Held>>(
        owner: &T,
        vm: &VirtualMachine,
        held: impl FnOnce() -> Held,
    ) {
        /// SAFETY: `this` is the registered field of a `T`.
        unsafe fn run<T: AutoFlush<Held>, Held>(this: NonNull<c_void>) -> bool {
            // SAFETY: fn contract.
            unsafe { T::on_auto_flush(T::from_field_ptr(this.as_ptr().cast())) }
        }
        /// SAFETY: as for `run`.
        unsafe fn removed<Held>(this: NonNull<c_void>) {
            // SAFETY: fn contract. The borrow ends before the drop, which can free the owner.
            drop(
                unsafe { this.cast::<AutoFlusher<Held>>().as_ref() }
                    .0
                    .take(),
            );
        }

        // SAFETY: a field of `owner`.
        let this = unsafe { NonNull::new_unchecked(T::field_of(NonNull::from(owner).as_ptr())) };
        // SAFETY: as above.
        let flusher = unsafe { this.as_ref() };
        if flusher.is_registered() {
            return;
        }
        flusher.0.set(Some(held()));
        let task = const {
            &DeferredTask {
                run: run::<T, Held>,
                removed: removed::<Held>,
            }
        };
        // SAFETY: `owner` does not move, and the entry goes when `flusher` drops.
        unsafe { vm.event_loop().deferred_tasks.post_task(this.cast(), task) };
    }

    pub fn is_registered(&self) -> bool {
        self.0.is_some()
    }

    pub fn unregister(&self) {
        if let Some(_held) = self.0.take() {
            let (vm, this) = (VirtualMachine::get(), NonNull::from(self).cast());
            // Not `event_loop()`: a macro can have started or returned since `register`.
            let removed = vm.regular_event_loop.deferred_tasks.unregister_task(this)
                || vm.macro_event_loop.deferred_tasks.unregister_task(this);
            debug_assert!(removed);
        }
    }
}

impl<Held> Drop for AutoFlusher<Held> {
    fn drop(&mut self) {
        self.unregister();
    }
}
