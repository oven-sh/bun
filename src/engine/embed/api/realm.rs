use core::ffi::c_void;

use bun_engine_macros::export;
use bun_engine_number::Random;
use bun_engine_text::{PropertyName, StringImpl, StringRef};
use bun_engine_vm::{
    Attributes, CellKind, Cx, Gc, GlobalObject, JsCell, JsObject, RealmSlot, RealmWatchpoint,
    Shape, Value, Vm,
};

use super::hooks::{REALM_HOOKS, REALM_HOOKS_WITH_WASM_STREAMING};

#[export]
unsafe fn global_construct(
    place: *mut GlobalObject,
    vm: &Vm,
    shape: Gc<Shape>,
    methods: *const c_void,
    has_wasm_streaming: bool,
) {
    let _defer = vm.heap.defer_collection();
    let hooks = if has_wasm_streaming {
        &REALM_HOOKS_WITH_WASM_STREAMING
    } else {
        &REALM_HOOKS
    };
    let init = GlobalObject::init(vm, shape, hooks, methods);
    // SAFETY: a new cell that is large enough.
    unsafe { GlobalObject::initialize(place, init) }
}

#[export]
unsafe fn global_destroy(global: *mut GlobalObject) {
    // SAFETY: dead, and not used again.
    unsafe { global.drop_in_place() }
}

#[export]
fn global_finish_creation(global: &GlobalObject, vm: &Vm) {
    global.finish_creation(vm);
}

#[export]
fn global_sandbox(global: &GlobalObject) -> Option<Gc<JsObject>> {
    global.sandbox()
}

#[export]
fn global_set_sandbox(global: &GlobalObject, sandbox: Gc<JsObject>) {
    global.set_sandbox(Some(sandbox));
}

#[export]
fn global_slot(cx: &Cx, slot: RealmSlot) -> Gc<JsCell> {
    cx.global().slot(cx, slot)
}

#[export]
fn global_add_static_global(cx: &Cx, name: PropertyName<'_>, value: Value, attributes: Attributes) {
    (cx.global()).add_static_global(cx, name, value, attributes.for_shape());
}

#[export]
fn global_invalidate_watchpoints(cx: &Cx, which: RealmWatchpoint) {
    cx.global().watchpoints_unchecked(which).invalidate(cx);
}

#[export]
fn global_set_eval_enabled(global: &GlobalObject, is_enabled: bool, message: &StringImpl) {
    let message = (!is_enabled).then(|| StringRef::retain(message));
    global.eval_disabled_message().replace(message);
}

#[export]
fn global_set_webassembly_enabled(global: &GlobalObject, is_enabled: bool, message: &StringImpl) {
    let message = (!is_enabled).then(|| StringRef::retain(message));
    global.webassembly_disabled_message().replace(message);
}

#[export]
fn global_stack_trace_limit(global: &GlobalObject, limit: &mut u32) -> bool {
    let found = global.stack_trace_limit();
    found.map(|found| *limit = found).is_some()
}

#[export]
fn global_date_now(global: &GlobalObject) -> f64 {
    global.date_now()
}

#[export]
fn global_random_seed(global: &GlobalObject) -> u32 {
    global.random_state().get().seed()
}

#[export]
fn global_set_random_seed(global: &GlobalObject, seed: u32) {
    global.random_state().set(Random::new(seed));
}
