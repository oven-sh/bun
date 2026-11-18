//! What `bun_web::tasks` needs of the event loop.

use bun_jsc::virtual_machine::VirtualMachine;

use crate::jsc_hooks::timer_all_of;

unsafe extern "Rust" {
    safe fn __bun_web_pump(vm: &VirtualMachine);
}

/// Stands for the pump in the queue of immediates.
pub(crate) const PUMP: *mut () = core::ptr::null_mut();

pub(crate) fn release_pump(vm: &VirtualMachine) {
    timer_all_of(vm).increment_immediate_ref(-1, vm.uws_loop());
}

pub(crate) fn pump(vm: &VirtualMachine) {
    release_pump(vm);
    __bun_web_pump(vm);
}

#[unsafe(no_mangle)]
fn __bun_web_queue_pump(vm: &VirtualMachine) {
    timer_all_of(vm).increment_immediate_ref(1, vm.uws_loop());
    vm.event_loop().enqueue_immediate_task(PUMP);
}
