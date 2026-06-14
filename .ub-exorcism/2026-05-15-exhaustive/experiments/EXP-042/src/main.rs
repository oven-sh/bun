//! EXP-042 — Mirror of `runtime::cli::repl::vm_mut`
//!
//! Production shape (src/runtime/cli/repl.rs:94-101):
//!
//!     #[allow(invalid_reference_casting)]
//!     fn vm_mut<'a>(vm: &'a VirtualMachine) -> &'a mut VirtualMachine {
//!         let ptr: *mut VirtualMachine = core::ptr::from_ref(vm).cast_mut();
//!         unsafe { &mut *ptr }
//!     }
//!
//! Validity invariants require that `&mut T` carry Unique provenance. Forging
//! `&mut T` from `&T` is UB on creation, regardless of whether it is later
//! written through. Miri Tree Borrows is expected to reject the `&mut *ptr`
//! reborrow with "attempting reborrow from disabled location" or, depending
//! on the precise transition order, a SharedReadOnly→Disabled write fault on
//! the subsequent mutation.

struct VM {
    counter: u32,
}

#[allow(invalid_reference_casting)]
fn vm_mut<'a>(vm: &'a VM) -> &'a mut VM {
    let ptr: *mut VM = core::ptr::from_ref(vm).cast_mut();
    unsafe { &mut *ptr }
}

fn main() {
    let vm = VM { counter: 0 };
    let m = vm_mut(&vm);
    m.counter += 1;
    core::hint::black_box(m.counter);
}
