//! What the run time keeps for a `Vm`.

use core::cell::{OnceCell, RefCell};
use core::ops::Range;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_vm::{GcFree, Vm};
use bun_engine_wasm_runtime::{STACK_RESERVE, Store, Vm as HostVm};

use crate::engine::engine;

#[derive(Default)]
struct Extension {
    store: OnceCell<Rc<Store>>,
    /// What the collector has been told to scan of the slots of the interpreter.
    scanned: RefCell<Range<usize>>,
}

// SAFETY: a store refers to no cell that it needs alive.
unsafe impl GcFree for Extension {}

/// What WebAssembly can use of the stack.
fn stack(vm: &Vm) -> Range<usize> {
    let limit = (vm.usual_stack_limit()).max(vm.stack_bounds().end + STACK_RESERVE);
    limit..vm.stack_bounds().origin
}

/// Made when it is first asked for. `None` if there is no room for the code that every module needs.
pub(crate) fn store(vm: &Vm) -> Option<Rc<Store>> {
    let extension = vm.extension::<Extension>();
    if let Some(store) = extension.store.get() {
        return Some(Rc::clone(store));
    }
    let address = core::ptr::from_ref(vm).expose_provenance();
    // SAFETY: what is made with the store belongs to cells of the `Vm`, and the stack reaches that far.
    let store = unsafe { Store::new(engine()?, HostVm(address), stack(vm)) };
    let interrupts = Arc::clone(store.interrupts());
    vm.traps().observe(Box::new(move |traps| {
        interrupts.update(|| traps.need_handling());
    }));
    Some(Rc::clone(extension.store.get_or_init(|| store)))
}

fn existing_store(vm: &Vm) -> Option<Rc<Store>> {
    vm.existing_extension::<Extension>()?.store.get().cloned()
}

/// For the collector, with the words on the stack that point into executable memory.
pub fn release_code_not_on_stack(vm: &Vm, addresses: &[usize]) {
    if let Some(store) = existing_store(vm) {
        // SAFETY: the thread is in the collector, which has looked at all that it keeps of frames.
        unsafe { store.release_code_not_on_stack(addresses) };
    }
}

/// The slots that the interpreter is using hold references, and are scanned like the stack. Those above them are
/// dead, and keep nothing alive.
pub fn will_mark(vm: &Vm) {
    let Some(extension) = vm.existing_extension::<Extension>() else {
        return;
    };
    let values = (extension.store.get()).map_or(0..0, |it| it.interpreted_values());
    let mut scanned = extension.scanned.borrow_mut();
    if *scanned == values {
        return;
    }
    vm.remove_conservative_range(&scanned);
    // SAFETY: the slots stay mapped while the store is there, and nothing marks once it is gone.
    unsafe { vm.add_conservative_range(values.clone()) };
    *scanned = values;
}

/// # Safety
/// `vm` is from the store of a `Vm` of this thread that is alive, and whoever has its `Cx` is in a call that borrows
/// that.
pub(crate) unsafe fn vm_of<'a>(vm: HostVm) -> &'a Vm {
    // SAFETY: the caller's.
    unsafe { &*core::ptr::with_exposed_provenance(vm.0) }
}
