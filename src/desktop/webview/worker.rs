//! `ServiceWorkerMain`

use std::rc::Rc;

use super::engine::{self, Engine, Order, Target};
use crate::generated_bindgen::webview::js_ElectronServiceWorkerMain as workers;
use crate::ipc::IpcMain;
use crate::prelude::*;
use crate::value::Value;

pub(crate) struct ServiceWorker {
    engine: Rc<Engine>,
    pub(super) id: i32,
    scope: String,
    script_url: String,
    version_id: f64,
    pub(super) session: Cell<i32>,
}

impl ServiceWorker {
    pub(super) fn find(
        engine: &Rc<Engine>,
        [id, scope, script_url, version_id]: &[Value; 4],
    ) -> JSValue {
        engine.object(id.int()).unwrap_or_else(|| {
            let worker = ServiceWorker {
                engine: Rc::clone(engine),
                id: id.int(),
                scope: scope.text().into(),
                script_url: script_url.text().into(),
                version_id: version_id.number(),
                session: 0.into(),
            };
            let worker = workers::create(heap(), worker).to_js();
            engine.add_object(id.int(), worker);
            worker
        })
    }

    fn event(&self) -> JsResult<&'static Event> {
        let session = self
            .engine
            .session(self.session.get())
            .map_or(JSValue::UNDEFINED, JsInterface::to_js);
        (Event::create()
            .with("type", "service-worker")?
            .with("serviceWorker", self.to_js())?)
        .with("session", session)?
        .with("versionId", self.version_id)
    }

    pub(super) fn receive(
        &self,
        channel: JSValue,
        values: JSValue,
        ports: JSValue,
    ) -> JsResult<()> {
        let reply = function(self.to_js(), |it, values| invoke(it, "send", values))?;
        let event = self
            .event()?
            .with("ports", ports)?
            .with("reply", reply)?
            .to_js();
        with_elements_after(&[channel, event], values, |all| {
            invoke(get(self.to_js(), "ipc")?, "emit", all)
        })
        .map(drop)
    }

    pub(super) fn handle(&self, channel: JSValue, values: JSValue) -> JsResult<JSValue> {
        let handler = cast::<IpcMain>(get(self.to_js(), "ipc")?)
            .map(|it| it.handler(channel))
            .transpose()?;
        match handler.flatten() {
            Some(handler) => {
                with_elements_after(&[self.event()?.to_js()], values, |all| call(handler, all))
            }
            None => Err(error(format_args!(
                "No handler registered for '{}'",
                text_of(channel)?
            ))),
        }
    }

    pub(crate) fn get_ipc(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        IpcMain::create()
    }

    pub(crate) fn get_scope(&self) -> &str {
        &self.scope
    }

    pub(crate) fn get_script_url(&self) -> &str {
        &self.script_url
    }

    pub(crate) fn get_version_id(&self) -> f64 {
        self.version_id
    }

    pub(crate) fn is_destroyed(&self) -> bool {
        self.engine.object(self.id).is_none()
    }

    pub(crate) fn send<'a>(&self, _: Cx<'a, '_>, values: &[JsLocal<'a>]) -> JsResult<()> {
        self.engine.tell(
            Target::Object(self.id),
            "send",
            engine::list_from_js(JsLocal::to_js_slice(values))?,
        );
        Ok(())
    }

    pub(crate) fn start_task(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let id = self.engine.new_id();
        self.engine.send(Order::StartTask {
            worker: self.id,
            id,
        });
        let end = listener(self, move |it, _| {
            it.engine.tell(Target::Object(id), "end", list![]);
            it.engine.send(Order::Release(id));
            Ok(())
        })?;
        Ok(object!({ "end": end }))
    }
}
