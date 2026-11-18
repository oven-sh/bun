use core::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use bun_engine_text::StringRef;
use bun_engine_vm::heap::Scope;
use bun_engine_vm::{CollectionObserver, Cx, Gc, GlobalObject, JsFunction, Value, Vm};

use crate::Controller;
use crate::profiling::{HeapProfiler, SnapshotKind};
use crate::protocol::{Object, Outcome, Request, object};
use crate::remote::{Detail, as_scripts_see_it, function_details, settle};

struct Observer {
    controller: Weak<Controller>,
    start: Cell<Option<f64>>,
}

impl CollectionObserver for Observer {
    fn will_collect(&self) {
        let controller = self.controller.upgrade();
        self.start.set(controller.map(|it| it.stopwatch.elapsed()));
    }

    fn did_collect(&self, scope: Scope) {
        if let Some((controller, start)) = self.controller.upgrade().zip(self.start.take()) {
            let collection = object! {
                "type": if scope == Scope::Full { "full" } else { "partial" },
                "startTime": start,
                "endTime": controller.stopwatch.elapsed(),
            };
            let params = object! { "collection": collection };
            controller.notify("Heap.garbageCollected", params);
        }
    }
}

#[derive(Default)]
pub(crate) struct Heap {
    /// While the domain is enabled.
    observer: RefCell<Option<Rc<Observer>>>,
    is_tracking: Cell<bool>,
}

impl Heap {
    pub(crate) fn disable(&self, vm: &Vm) -> Outcome<()> {
        (self.observer.take()).ok_or("Heap domain already disabled")?;
        self.is_tracking.set(false);
        HeapProfiler::of(vm).restart_identifiers();
        Ok(())
    }
}

const NO_REALM: &str = "Unable to get object details - GlobalObject";

fn value_with_identifier(vm: &Vm, identifier: i32) -> Outcome<Value> {
    let profiler = HeapProfiler::of(vm);
    if !profiler.has_snapshot() {
        return Err("No heap snapshot".into());
    }
    let cell = (profiler.cell_with_identifier(vm, identifier as u32))
        .ok_or("No object for identifier, it may have been collected")?;
    Ok(as_scripts_see_it(cell).ok_or(NO_REALM)?)
}

fn realm_of(value: Value) -> Outcome<Gc<GlobalObject>> {
    Ok((value.as_object().and_then(|it| it.realm())).ok_or(NO_REALM)?)
}

impl Controller {
    fn enable_heap(&self, vm: &Vm) -> Outcome<()> {
        if self.heap.observer.borrow().is_some() {
            return Err("Heap domain already enabled".into());
        }
        let observer = Rc::new(Observer {
            controller: self.downgrade(),
            start: Cell::new(None),
        });
        vm.add_collection_observer(Rc::<Observer>::downgrade(&observer));
        self.heap.observer.replace(Some(observer));
        Ok(())
    }

    fn take_snapshot(&self, cx: &mut Cx) -> Outcome {
        let profiler = HeapProfiler::of(cx);
        let data = profiler.snapshot(&mut cx.into(), SnapshotKind::Inspector, &|_| true);
        let data = data.map_err(|_| "Out of memory")?;
        Ok(object! { "timestamp": self.stopwatch.elapsed(), "snapshotData": data })
    }

    fn set_tracking(&self, cx: &mut Cx, is_tracking: bool, event: &'static str) -> Outcome<()> {
        if self.heap.is_tracking.replace(is_tracking) != is_tracking {
            self.notify(event, self.take_snapshot(cx)?);
        }
        Ok(())
    }

    fn preview_heap_object(&self, cx: &mut Cx, identifier: i32) -> Outcome {
        let value = value_with_identifier(cx, identifier)?;
        if value.is_string() || value.is_bigint() {
            let text = value.to_string_ref(cx);
            return Ok(object! { "string" => settle(cx, text) });
        }
        let cx = cx.in_realm(realm_of(value)?);
        if let Some(function) = value.downcast::<JsFunction>() {
            let details = function_details(function).ok_or("Cannot resolve function details.")?;
            return Ok(object! { "functionDetails": details });
        }
        let preview = self.quietly(cx, |cx| {
            let preview = self.remote(cx).preview(cx, value);
            settle(cx, preview)
        });
        Ok(object! { "preview" => preview })
    }

    fn wrap_heap_object(&self, cx: &mut Cx, identifier: i32, group: &StringRef) -> Outcome {
        let value = value_with_identifier(cx, identifier)?;
        let result = self.quietly(cx.in_realm(realm_of(value)?), |cx| {
            let result = self.remote(cx).wrap(cx, value, group, Detail::Preview);
            settle(cx, result)
        });
        Ok(object! { "result": result.ok_or("Internal error: unable to cast Object")? })
    }

    pub(crate) fn dispatch_heap(
        &self,
        cx: &mut Cx,
        method: &str,
        request: &Request<'_>,
    ) -> Outcome<Option<Object>> {
        let params = &request.params;
        match method {
            "enable" => self.enable_heap(cx)?,
            "disable" => self.heap.disable(cx)?,
            "gc" => cx.heap.collect_and_sweep(Some(Scope::Full)),
            "snapshot" => return self.take_snapshot(cx).map(Some),
            "startTracking" => self.set_tracking(cx, true, "Heap.trackingStart")?,
            "stopTracking" => self.set_tracking(cx, false, "Heap.trackingComplete")?,
            "getPreview" => {
                let identifier = params.required("heapObjectId");
                params.check()?;
                return self.preview_heap_object(cx, identifier).map(Some);
            }
            "getRemoteObject" => {
                let identifier = params.required("heapObjectId");
                let group = params.optional("objectGroup").unwrap_or_default();
                params.check()?;
                return self.wrap_heap_object(cx, identifier, &group).map(Some);
            }
            _ => return Err(params.no_such_method()),
        }
        Ok(Some(object! {}))
    }
}
