use core::cell::Cell;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_engine_inspector::{AsyncCallType, Controller, Host, ProfilingReason};
use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef, Text};
use bun_engine_vm::{
    Cx, GcFree, GlobalObject, JsResult, MessageLevel, MessageType, SourceProvider, Value,
};

/// What owns the `InspectorBackend` in C++.
enum InspectorController {}

unsafe extern "C" {
    fn engine_host_inspector_send(controller: *mut InspectorController, message: &StringImpl);
    fn engine_host_inspector_has_frontend(controller: *mut InspectorController) -> bool;
    fn engine_host_inspector_dispatch(
        controller: *mut InspectorController,
        id: i32,
        domain: &StringImpl,
        method: &StringImpl,
    ) -> bool;
    fn engine_host_inspector_run_while_paused(
        controller: *mut InspectorController,
        is_done: *mut bool,
    );
    fn engine_host_inspector_frontend_initialized(controller: *mut InspectorController);
    fn engine_host_inspector_subtype(
        controller: *mut InspectorController,
        cx: &mut Cx,
        value: Value,
    ) -> Value;
    fn engine_host_inspector_internal_properties(
        controller: *mut InspectorController,
        cx: &mut Cx,
        value: Value,
    ) -> Option<Value>;
}

/// Empty once C++ has destroyed it.
#[derive(Clone)]
struct Owner(Rc<Cell<Option<NonNull<InspectorController>>>>);

// SAFETY: no cell.
unsafe impl GcFree for Owner {}

impl Owner {
    /// If a frontend is connected to it.
    fn connected(&self) -> Option<*mut InspectorController> {
        let controller = self.0.get()?.as_ptr();
        // SAFETY: not destroyed.
        unsafe { engine_host_inspector_has_frontend(controller) }.then_some(controller)
    }
}

impl Host for Owner {
    fn has_frontend(&self) -> bool {
        self.connected().is_some()
    }

    fn send(&self, message: &StringImpl) {
        if let Some(controller) = self.connected() {
            // SAFETY: not destroyed.
            unsafe { engine_host_inspector_send(controller, message) }
        }
    }

    fn dispatch(&self, _: &mut Cx, id: i32, domain: Text<'_>, method: Text<'_>) -> bool {
        let (domain, method) = (StringRef::from_text(domain), StringRef::from_text(method));
        self.connected().is_some_and(|controller| {
            // SAFETY: as above.
            unsafe { engine_host_inspector_dispatch(controller, id, &domain, &method) }
        })
    }

    fn run_while_paused(&self, _: &mut Cx, is_done: &Cell<bool>) {
        if let Some(controller) = self.connected() {
            // SAFETY: as above.
            unsafe { engine_host_inspector_run_while_paused(controller, is_done.as_ptr()) }
        }
    }

    fn frontend_initialized(&self) {
        if let Some(controller) = self.connected() {
            // SAFETY: as above.
            unsafe { engine_host_inspector_frontend_initialized(controller) }
        }
    }

    fn subtype(&self, cx: &mut Cx, value: Value) -> Value {
        self.connected().map_or(Value::UNDEFINED, |controller| {
            // SAFETY: as above.
            unsafe { engine_host_inspector_subtype(controller, cx, value) }
        })
    }

    fn internal_properties(&self, cx: &mut Cx, value: Value) -> JsResult<Option<Value>> {
        let properties = self.connected().and_then(|controller| {
            // SAFETY: as above.
            unsafe { engine_host_inspector_internal_properties(controller, cx, value) }
        });
        cx.check_exception()?;
        Ok(properties)
    }
}

struct InspectorBackend {
    controller: Rc<Controller>,
    owner: Owner,
}

#[export]
unsafe fn inspector_create(cx: &Cx, owner: *mut InspectorController) -> *mut InspectorBackend {
    let owner = Owner(Rc::new(Cell::new(NonNull::new(owner))));
    let controller = Controller::new(cx, Box::new(owner.clone()));
    Box::into_raw(Box::new(InspectorBackend { controller, owner }))
}

#[export]
unsafe fn inspector_destroy(backend: *mut InspectorBackend) {
    // SAFETY: from `inspector_create`.
    let backend = unsafe { Box::from_raw(backend) };
    backend.owner.0.set(None);
}

#[export]
fn inspector_did_connect_first_frontend(backend: &InspectorBackend, cx: &mut Cx) {
    backend.controller.did_connect_first_frontend(cx);
}

#[export]
fn inspector_will_disconnect_frontend(backend: &InspectorBackend, cx: &mut Cx) {
    backend.controller.will_disconnect_frontend(cx);
}

#[export]
fn inspector_did_disconnect_last_frontend(backend: &InspectorBackend) {
    backend.controller.did_disconnect_last_frontend();
}

#[export]
fn inspector_discard_values(backend: &InspectorBackend) {
    backend.controller.discard_values();
}

#[export]
fn inspector_dispatch(backend: &InspectorBackend, cx: &mut Cx, message: Text<'_>) {
    backend.controller.dispatch(cx, message);
}

#[export]
fn inspector_console_message(
    backend: &InspectorBackend,
    cx: &mut Cx,
    kind: MessageType,
    level: MessageLevel,
    arguments: &[Value],
) -> JsResult<()> {
    (backend.controller).console_message(cx, kind, level, arguments)
}

#[export]
fn inspector_console_profile(backend: &InspectorBackend, cx: &mut Cx, title: &StringImpl) {
    backend.controller.console_profile(cx, title);
}

#[export]
fn inspector_console_profile_end(backend: &InspectorBackend, cx: &mut Cx, title: &StringImpl) {
    backend.controller.console_profile_end(cx, title);
}

#[export]
fn inspector_is_interactively_debugging(backend: &InspectorBackend) -> bool {
    backend.controller.is_interactively_debugging()
}

#[export]
fn inspector_is_paused(backend: &InspectorBackend) -> bool {
    backend.controller.is_paused()
}

#[export]
fn inspector_continue_program(backend: &InspectorBackend) {
    backend.controller.continue_program();
}

#[export]
fn inspector_did_schedule_async_call(
    backend: &InspectorBackend,
    cx: &mut Cx,
    kind: AsyncCallType,
    id: u64,
    is_single_shot: bool,
) {
    (backend.controller).did_schedule_async_call(cx, kind, id, is_single_shot);
}

#[export]
fn inspector_did_cancel_async_call(backend: &InspectorBackend, kind: AsyncCallType, id: u64) {
    backend.controller.did_cancel_async_call(kind, id);
}

#[export]
fn inspector_will_dispatch_async_call(backend: &InspectorBackend, kind: AsyncCallType, id: u64) {
    backend.controller.will_dispatch_async_call(kind, id);
}

#[export]
fn inspector_did_dispatch_async_call(backend: &InspectorBackend, kind: AsyncCallType, id: u64) {
    backend.controller.did_dispatch_async_call(kind, id);
}

#[export]
fn inspector_will_evaluate_script(backend: &InspectorBackend, start: &mut f64) -> bool {
    let began = backend.controller.will_evaluate_script();
    began.map(|it| *start = it).is_some()
}

#[export]
fn inspector_did_evaluate_script(backend: &InspectorBackend, start: f64, reason: ProfilingReason) {
    backend.controller.did_evaluate_script(start, reason);
}

#[export]
fn global_has_debugger(global: &GlobalObject) -> bool {
    global.debugger().is_some()
}

#[export]
fn global_report_source_to_debugger(cx: &Cx, provider: &SourceProvider) {
    if let Some(debugger) = cx.global().debugger() {
        debugger.did_parse(cx, provider, None);
    }
}
