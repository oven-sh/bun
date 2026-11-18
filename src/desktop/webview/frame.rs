//! `WebFrameMain`, for a frame in the web engine.

use std::rc::Rc;

use super::engine::{self, Engine, Order, Target};
use super::remote::Remote;
use crate::generated_bindgen::webview::js_ElectronRemoteFrame as frames;
use crate::ipc::IpcMain;
use crate::prelude::*;
use crate::value::Value;

/// The ids of the pages in this process are below it.
pub(super) const FIRST_PROCESS_ID: i32 = 1 << 20;

pub(crate) struct RemoteFrame {
    engine: Rc<Engine>,
    pub(super) id: i32,
    about: RefCell<Value>,
}

/// The frame that is described, which may be the one of the app that has the `<iframe>`.
pub(super) fn update(engine: &Rc<Engine>, about: &Value) -> JSValue {
    let embedder = engine.view(about["view"].int()).and_then(Remote::embedder);
    if let Some(embedder) = embedder.filter(|_| !about["parent"].is_truthy()) {
        return embedder;
    }
    let id = about["id"].int();
    let frame = engine
        .object(id)
        .and_then(cast::<RemoteFrame>)
        .unwrap_or_else(|| {
            let frame = RemoteFrame {
                engine: Rc::clone(engine),
                id,
                about: Value::empty().into(),
            };
            let frame = frames::create(heap(), frame);
            engine.add_object(id, frame.to_js());
            frame
        });
    frame.about.replace(frame.about.take().and(about));
    frame.to_js()
}

impl RemoteFrame {
    pub(super) fn detach(&self) {
        self.about.borrow_mut().set("detached", true);
        self.engine.remove_object(self.id);
        self.engine.send(Order::Release(self.id));
    }

    fn owner(&self) -> Option<&'static Remote> {
        self.engine.view(self.number("view"))
    }

    fn number(&self, name: &str) -> i32 {
        self.about.borrow()[name].int()
    }

    pub(super) fn origin(&self) -> String {
        self.about.borrow()["origin"].display()
    }

    fn parent(&self) -> Option<JSValue> {
        let parent = Some(self.number("parent")).filter(|it| *it != 0)?;
        self.engine
            .object(parent)
            .or_else(|| self.owner()?.embedder())
    }

    fn collect(&self, found: JSValue, is_deep: bool, depth: u32) -> JsResult<()> {
        let Some(owner) = self.owner().filter(|_| depth < 1000) else {
            return Ok(());
        };
        for frame in owner.frames() {
            let frame = frame?;
            if frame.number("parent") == self.id {
                found.push(global(), frame.to_js())?;
                if is_deep {
                    frame.collect(found, true, depth + 1)?;
                }
            }
        }
        Ok(())
    }

    fn perform(&self, method: &str, arguments: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let arguments = engine::list_from_js(JsLocal::to_js_slice(arguments))?;
        Ok(engine::promise(self.engine.perform(
            Target::Object(self.id),
            method,
            arguments,
        )))
    }

    pub(crate) fn get_ipc(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        IpcMain::create()
    }

    pub(crate) fn get_url(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&self.about.borrow()["url"])
    }

    pub(crate) fn get_origin(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&self.about.borrow()["origin"])
    }

    pub(crate) fn get_name(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&self.about.borrow()["name"])
    }

    pub(crate) fn get_frame_token(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(&self.about.borrow()["frameToken"])
    }

    pub(crate) fn get_routing_id(&self) -> i32 {
        self.number("routingId")
    }

    pub(crate) fn get_os_process_id(&self) -> i32 {
        self.number("osProcessId")
    }

    pub(crate) fn get_process_id(&self) -> i32 {
        FIRST_PROCESS_ID.saturating_add(self.number("processId"))
    }

    pub(crate) fn get_frame_tree_node_id(&self) -> i32 {
        FIRST_PROCESS_ID.saturating_add(self.number("frameTreeNodeId"))
    }

    pub(crate) fn get_parent(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(self.parent().unwrap_or(JSValue::NULL))
    }

    pub(crate) fn get_top(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let top = self.parent().map(|it| get(it, "top")).transpose()?;
        Ok(top
            .filter(|it| it.is_object())
            .unwrap_or_else(|| self.to_js()))
    }

    pub(crate) fn get_frames(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let found = array(&[])?;
        self.collect(found, false, 0).map(|()| found)
    }

    pub(crate) fn get_frames_in_subtree(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let found = array(&[self.to_js()])?;
        self.collect(found, true, 0).map(|()| found)
    }

    pub(crate) fn get_detached(&self) -> bool {
        self.about.borrow()["detached"].is_truthy() || self.owner().is_none()
    }

    pub(crate) fn get_visibility_state(&self, _: Cx<'_, '_>) -> JsResult<&'static str> {
        let is_visible = self.owner().map(Remote::is_visible).transpose()?;
        Ok(if is_visible == Some(true) {
            "visible"
        } else {
            "hidden"
        })
    }

    pub(crate) fn send<'a>(&self, _: Cx<'a, '_>, values: &[JsLocal<'a>]) -> JsResult<()> {
        let values = JsLocal::to_js_slice(values);
        if !argument(values, 0).is_string_literal() {
            return Err(type_error(format_args!(
                "Missing required channel argument"
            )));
        }
        self.engine.tell(
            Target::Object(self.id),
            "send",
            engine::list_from_js(values)?,
        );
        Ok(())
    }

    pub(crate) fn post_message<'a>(&self, _: Cx<'a, '_>, values: &[JsLocal<'a>]) -> JsResult<()> {
        let values = engine::list_from_js(JsLocal::to_js_slice(values))?;
        self.engine
            .tell(Target::Object(self.id), "postMessage", values);
        Ok(())
    }

    pub(crate) fn reload(&self) -> bool {
        self.engine.tell(Target::Object(self.id), "reload", list![]);
        true
    }

    pub(crate) fn collect_java_script_call_stack(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.perform("collectJavaScriptCallStack", &[])
    }

    pub(crate) fn execute_java_script<'a>(
        &self,
        _: Cx<'a, '_>,
        values: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        self.perform("executeJavaScript", values)
    }

    pub(crate) fn print_to_pdf<'a>(
        &self,
        _: Cx<'a, '_>,
        values: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        self.perform("printToPDF", values)
    }
}
