#![deny(unsafe_op_in_unsafe_fn)]

use std::cell::Cell;
use std::ptr::NonNull;

thread_local! {
    static VM: Cell<Option<NonNull<VirtualMachine>>> = const { Cell::new(None) };
}

struct VirtualMachine {
    value: Cell<u32>,
}

// Mirrors `src/jsc/VirtualMachine.rs:611-612`.
unsafe impl Sync for VirtualMachine {}
unsafe impl Send for VirtualMachine {}

impl VirtualMachine {
    fn set_current(vm: *mut VirtualMachine) {
        VM.set(NonNull::new(vm));
    }

    fn get_or_null() -> Option<*mut VirtualMachine> {
        VM.get().map(NonNull::as_ptr)
    }

    fn get_mut_ptr() -> *mut VirtualMachine {
        debug_assert!(Self::get_or_null().is_some());
        // Mirrors `VirtualMachine::get_mut_ptr()` in release mode: the caller
        // contract says a VM exists on the current thread, but the API itself is safe.
        unsafe { Self::get_or_null().unwrap_unchecked() }
    }

    fn get() -> &'static VirtualMachine {
        unsafe { &*Self::get_mut_ptr() }
    }

    fn as_mut(&self) -> &mut VirtualMachine {
        debug_assert!(core::ptr::eq(self, Self::get_mut_ptr()));
        unsafe { &mut *Self::get_mut_ptr() }
    }
}

fn main() {
    let vm = Box::leak(Box::new(VirtualMachine {
        value: Cell::new(0),
    }));
    VirtualMachine::set_current(vm);

    let captured: &'static VirtualMachine = VirtualMachine::get();

    std::thread::scope(|scope| {
        scope.spawn(move || {
            // This is safe Rust in the model, as in Bun: `VirtualMachine: Sync`
            // lets `&VirtualMachine` cross threads, and `as_mut` is a safe method.
            // The spawned thread has no VM in its thread-local slot, so
            // `get_mut_ptr().unwrap_unchecked()` violates its precondition.
            captured.as_mut().value.set(1);
        });
    });
}
