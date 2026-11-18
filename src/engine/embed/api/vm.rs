use core::ffi::c_void;
use core::ptr::NonNull;

use bun_engine_macros::export;
use bun_engine_text::{PropertyName, STATIC_ATOM_COUNT};
use bun_engine_vm::heap::HeapKind;
use bun_engine_vm::{
    AfterDeferral, Cx, Exception, Gc, RealmSlot, SourceProvider, Value, Vm, VmRef,
};

use super::console::CONSOLE_HOOKS;

unsafe extern "C" {
    safe fn engine_host_destroy_vm_members(vm: &Vm);
    fn engine_host_delete_source_provider(provider: *mut SourceProvider);
}

fn destroy_members(vm: &Vm) {
    engine_host_destroy_vm_members(vm);
}

/// With one reference. The counts are what the generated headers say.
#[export]
fn vm_create(kind: HeapKind, static_atom_count: usize, realm_slot_count: usize) -> *mut Vm {
    assert!(static_atom_count == STATIC_ATOM_COUNT && realm_slot_count == RealmSlot::COUNT);
    // SAFETY: what it does.
    unsafe { SourceProvider::set_embedder_deleter(engine_host_delete_source_provider) };
    let vm = bun_engine::create_vm(kind);
    // SAFETY: nothing else has it.
    let embedder = unsafe { vm.get() }.embedder();
    embedder.destroy_members.set(Some(destroy_members));
    embedder.console.set(Some(&CONSOLE_HOOKS));
    vm.into_raw().as_ptr()
}

#[export]
unsafe fn vm_release(vm: *const Vm) {
    // SAFETY: a reference that C++ holds.
    drop(unsafe { VmRef::from_raw(NonNull::new_unchecked(vm.cast_mut())) });
}

#[export]
fn vm_hard_stack_limit(vm: &Vm) -> *mut c_void {
    core::ptr::without_provenance_mut(vm.hard_stack_limit())
}

struct Task {
    run: unsafe extern "C" fn(*mut c_void),
    context: *mut c_void,
}

#[export]
unsafe fn vm_when_idle(vm: &Vm, run: unsafe extern "C" fn(*mut c_void), context: *mut c_void) {
    let task = Task { run, context };
    // SAFETY: the two go together.
    vm.when_idle(move |_| unsafe { (task.run)(task.context) });
}

#[export]
fn vm_clear_kept_objects(vm: &Vm) {
    vm.clear_kept_objects();
}

#[export]
fn vm_register_private_name(vm: &Vm, name: PropertyName<'_>, symbol: PropertyName<'_>) {
    let name = name.to_atom().expect("no symbol");
    vm.register_private_name(name, symbol.to_identifier());
}

#[export]
fn vm_set_tier_up_scale(vm: &Vm, scale: f64) {
    vm.set_tier_up_scale(scale);
}

#[export]
fn vm_delete_unlinked_code(vm: &Vm) {
    vm.discard_unlinked_code();
}

#[export]
fn vm_clear_source_caches(vm: &Vm) {
    vm.clear_source_caches();
}

#[export]
fn vm_delete_all_code(vm: &Vm) {
    vm.discard_all_code();
}

#[export]
fn throw_value(cx: &mut Cx, value: Value) -> Option<Gc<Exception>> {
    let _ = cx.throw(value);
    cx.notify_debugger_of_exception();
    cx.exception()
}

#[export]
fn vm_has_exception_after_handling_traps(vm: &Vm) -> bool {
    vm.handle_traps_without_realm();
    vm.has_exception()
}

/// From any thread.
#[export]
fn vm_request_termination(vm: &Vm) {
    vm.traps().request_termination();
}

#[export]
fn vm_termination_exception(vm: &Vm) -> Gc<Exception> {
    vm.termination_exception()
}

#[export]
fn vm_throw_termination(vm: &Vm) {
    vm.throw_termination_exception();
}

/// Whether there was anything to cancel.
#[export]
fn vm_cancel_termination(vm: &Vm) -> bool {
    vm.cancel_termination()
}

#[export]
fn vm_begin_termination_deferral(vm: &Vm) {
    vm.begin_termination_deferral();
}

#[export]
fn vm_end_termination_deferral(vm: &Vm, throws_now: bool) {
    vm.end_termination_deferral(if throws_now {
        AfterDeferral::Throw
    } else {
        AfterDeferral::RaiseTrap
    });
}

#[export]
fn vm_is_termination_deferred(vm: &Vm) -> bool {
    vm.is_termination_deferred()
}

#[export]
fn vm_replace_is_handling_error(vm: &Vm, value: bool) -> bool {
    vm.replace_is_handling_error(value)
}
