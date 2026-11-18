use std::rc::{Rc, Weak};

use core::cell::{Cell, RefCell};

use bun_engine_text::{StringImpl, Text};
use bun_engine_vm::{Cx, Gc, GcFree, GlobalObject, JsResult, Strong, Value, Vm};

use crate::AsyncCallType;
use crate::debugger::Debugger;
use crate::domains::{Audit, Console, Heap, Runtime, ScriptProfiler};
use crate::protocol::{Error, ErrorCode, Json, Object, Outcome, Request, event, object, response};
use crate::remote::{ObjectId, Registries, Remote};
use crate::stopwatch::Stopwatch;

/// What the embedder provides.
pub trait Host: GcFree {
    fn has_frontend(&self) -> bool;

    /// To all frontends. Leaves the heap alone.
    fn send(&self, message: &StringImpl);

    /// For a domain of the embedder, which sends the response. False if there is no such domain.
    fn dispatch(&self, cx: &mut Cx, id: i32, domain: Text<'_>, method: Text<'_>) -> bool;

    /// Hands messages to `Controller::dispatch` until `is_done` is set.
    fn run_while_paused(&self, cx: &mut Cx, is_done: &Cell<bool>);

    fn frontend_initialized(&self);

    /// One of those of `Runtime.RemoteObject`, or undefined. Is not asked about objects of the standard library.
    fn subtype(&self, cx: &mut Cx, value: Value) -> Value;

    /// An array of objects with a `name` and a `value`, in place of what the engine knows.
    fn internal_properties(&self, cx: &mut Cx, value: Value) -> JsResult<Option<Value>>;
}

/// Inspects a realm.
pub struct Controller {
    this: Weak<Controller>,
    pub(crate) host: Box<dyn Host>,
    global: bun_engine_vm::Weak<GlobalObject>,
    kept_global: RefCell<Option<Strong<Gc<GlobalObject>>>>,
    pub(crate) stopwatch: Stopwatch,
    pub(crate) registries: Registries,
    pub(crate) debugger: Debugger,
    pub(crate) runtime: Runtime,
    pub(crate) console: Console,
    pub(crate) heap: Heap,
    pub(crate) script_profiler: ScriptProfiler,
    pub(crate) audit: Audit,
}

impl Controller {
    /// For the realm of `cx`.
    pub fn new(cx: &Cx, host: Box<dyn Host>) -> Rc<Controller> {
        Rc::new_cyclic(|this| Controller {
            this: Weak::clone(this),
            host,
            global: bun_engine_vm::Weak::new(cx, cx.global()),
            kept_global: RefCell::new(None),
            stopwatch: Stopwatch::started(),
            registries: Registries::default(),
            debugger: Debugger::default(),
            runtime: Runtime::default(),
            console: Console::default(),
            heap: Heap::default(),
            script_profiler: ScriptProfiler::default(),
            audit: Audit::default(),
        })
    }

    pub(crate) fn downgrade(&self) -> Weak<Controller> {
        Weak::clone(&self.this)
    }

    pub(crate) fn in_inspected_realm<'a>(&self, cx: &'a mut Cx) -> Option<&'a mut Cx> {
        let global = self.global.get(cx)?;
        Some(cx.in_realm(global))
    }

    pub fn did_connect_first_frontend(&self, cx: &mut Cx) {
        let global = self.global.get(cx);
        (self.kept_global).replace(global.map(|global| Strong::new(cx, global)));
    }

    /// Whichever it is, all domains are disabled.
    pub fn will_disconnect_frontend(&self, cx: &mut Cx) {
        let Some(cx) = self.in_inspected_realm(cx) else {
            return;
        };
        self.console.disable();
        self.runtime.set_collects_coverage(cx, false);
        if self.debugger.is_enabled() {
            self.disable_debugger(cx);
        }
        self.script_profiler.abandon(cx);
        let _ = self.heap.disable(cx);
    }

    pub fn did_disconnect_last_frontend(&self) {
        self.registries.clear();
        self.audit.tear_down();
        self.kept_global.take();
    }

    /// No frontend is left, and none is to come.
    pub fn discard_values(&self) {
        self.did_disconnect_last_frontend();
        self.console.discard_messages();
    }

    /// Leaves no exception.
    pub fn dispatch(&self, cx: &mut Cx, message: Text<'_>) {
        // What is asked for may be to let go of this.
        let _this = self.this.upgrade();
        let message = Json::parse(cx, message);
        let request = match Request::new(message.as_ref()) {
            Ok(request) => request,
            Err((id, error)) => return self.respond(id, Err(error)),
        };
        let Some(cx) = self.in_inspected_realm(cx) else {
            return;
        };
        if let Some(outcome) = self.carry_out(cx, &request).transpose() {
            self.respond(Some(request.id), outcome);
        }
    }

    /// `None` if the response is sent elsewhere.
    fn carry_out(&self, cx: &mut Cx, request: &Request<'_>) -> Outcome<Option<Object>> {
        type Domain = fn(&Controller, &mut Cx, &str, &Request<'_>) -> Outcome<Option<Object>>;
        const DOMAINS: [(&str, Domain); 7] = [
            ("Runtime", Controller::dispatch_runtime),
            ("Debugger", Controller::dispatch_debugger),
            ("Console", Controller::dispatch_console),
            ("Inspector", Controller::dispatch_inspector),
            ("Heap", Controller::dispatch_heap),
            ("ScriptProfiler", Controller::dispatch_script_profiler),
            ("Audit", Controller::dispatch_audit),
        ];
        let (domain, method) = (request.domain, request.method);
        if let Some((_, dispatch)) = DOMAINS.iter().find(|it| domain.eq_ascii(it.0)) {
            return dispatch(self, cx, &method.to_string(), request);
        }
        if self.host.dispatch(cx, request.id, domain, method) {
            return Ok(None);
        }
        let message = format_args!("'{domain}' domain was not found");
        Err(Error::new(ErrorCode::MethodNotFound, message))
    }

    fn dispatch_inspector(
        &self,
        _: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        match method {
            "enable" | "disable" => {}
            "initialized" => self.host.frontend_initialized(),
            _ => return Err(request.params.no_such_method()),
        }
        Ok(Some(object! {}))
    }

    pub(crate) fn respond(&self, id: Option<i32>, outcome: Outcome) {
        let too_long = || response(id, Err("Out of memory".into())).to_text();
        if let Some(message) = response(id, outcome).to_text().or_else(too_long) {
            self.host.send(&message);
        }
    }

    fn send_event(&self, method: &'static str, params: Option<Object>) {
        if self.host.has_frontend()
            && let Some(message) = event(method, params).to_text()
        {
            self.host.send(&message);
        }
    }

    pub(crate) fn notify(&self, method: &'static str, params: Object) {
        self.send_event(method, Some(params));
    }

    pub(crate) fn notify_without_params(&self, method: &'static str) {
        self.send_event(method, None);
    }

    /// For the realm of `cx`.
    pub(crate) fn remote(&self, cx: &Cx) -> Remote<'_> {
        Remote::new(self, self.registries.of_realm(cx))
    }

    /// For the realm that the id is from.
    pub(crate) fn remote_for(&self, vm: &Vm, id: Text<'_>) -> Option<(Remote<'_>, ObjectId)> {
        let id = ObjectId::parse(vm, id)?;
        let registry = self.registries.find(vm, id.realm)?;
        Some((Remote::new(self, registry), id))
    }

    /// What `run` calls may compile strings, and `run` catches what it throws.
    pub(crate) fn on_behalf_of_frontend<T>(
        &self,
        cx: &mut Cx,
        run: impl FnOnce(&mut Cx) -> T,
    ) -> T {
        let global = cx.global();
        let eval_disabled_message = global.eval_disabled_message().take();
        self.debugger.catching_calls.update(|count| count + 1);
        let result = run(cx);
        self.debugger.catching_calls.update(|count| count - 1);
        if eval_disabled_message.is_some() {
            (global.eval_disabled_message()).replace(eval_disabled_message);
        }
        result
    }

    /// The same for a look at values, which is no occasion to pause on exceptions.
    pub(crate) fn quietly<T>(&self, cx: &mut Cx, run: impl FnOnce(&mut Cx) -> T) -> T {
        (self.debugger).ignoring_exceptions_if(true, || self.on_behalf_of_frontend(cx, run))
    }

    pub fn is_paused(&self) -> bool {
        self.debugger.is_paused()
    }

    pub fn continue_program(&self) {
        self.debugger.continue_program();
    }

    pub fn is_interactively_debugging(&self) -> bool {
        self.debugger.is_enabled() && self.debugger.breakpoints_are_active()
    }

    pub fn did_schedule_async_call(
        &self,
        cx: &mut Cx,
        kind: AsyncCallType,
        id: u64,
        is_single_shot: bool,
    ) {
        if self.is_interactively_debugging() {
            (self.debugger.async_calls).did_schedule(cx, (kind, id), is_single_shot);
        }
    }

    pub fn did_cancel_async_call(&self, kind: AsyncCallType, id: u64) {
        self.debugger.async_calls.did_cancel((kind, id));
    }

    pub fn will_dispatch_async_call(&self, kind: AsyncCallType, id: u64) {
        self.debugger.async_calls.will_dispatch((kind, id));
    }

    pub fn did_dispatch_async_call(&self, kind: AsyncCallType, id: u64) {
        self.debugger.async_calls.did_dispatch((kind, id));
    }
}
