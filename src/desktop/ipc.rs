//! `ipcMain`, and what a message from a frame sets off.

use bun_jsc::{JSMap, JSString};

use crate::generated_bindgen::ipc::{js_ElectronIpcEvent as events, js_ElectronIpcMain as fields};
use crate::prelude::*;
use crate::value::Value;
use crate::webview::engine::{self, Order};
use crate::webview::wire;

state!(fn main_object() -> StrongCell);

pub(crate) fn main() -> JsResult<JSValue> {
    if !main_object().is_some() {
        main_object().set(keep(IpcMain::create()?));
    }
    Ok(main_object().get().unwrap_or_default())
}

#[derive(Default)]
pub(crate) struct IpcMain(#[expect(dead_code)] HasFields);

pub(crate) fn channels_of(ipc: JSValue) -> JsResult<Value> {
    let handlers = cast::<IpcMain>(ipc).and_then(fields::handlers);
    let entries = handlers.map_or_else(|| array(&[]), wire::items_of)?;
    with_elements(entries, |it| {
        it.iter()
            .step_by(2)
            .map(|it| wire::data_from_js(*it))
            .collect()
    })
}

impl IpcMain {
    pub(crate) fn create() -> JsResult<JSValue> {
        Ok(fields::create(heap(), IpcMain::default())
            .initialize()?
            .to_js())
    }

    /// An `error` message that nobody listens to must not throw.
    fn initialize(&self) -> JsResult<&Self> {
        invoke(self.to_js(), "on", &[js("error")?, procedure(|_| Ok(()))?]).map(|_| self)
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
    ) -> JsResult<&'a Self> {
        structure.create(&cx.heap, IpcMain::default()).initialize()
    }

    pub(crate) fn get_invoke_handlers(&self) -> JSValue {
        if fields::handlers(self).is_none() {
            fields::set_handlers(self, JSMap::create(global()));
        }
        fields::handlers(self).unwrap_or_default()
    }

    pub(crate) fn handler(&self, channel: JSValue) -> JsResult<Option<JSValue>> {
        let found = fields::handlers(self)
            .map(|it| map_in(it).get(global(), channel))
            .transpose()?;
        Ok(found.filter(|it| it.is_callable()))
    }

    fn add(
        &self,
        channel: JSValue,
        handler: JSValue,
        wrap: impl FnOnce() -> JsResult<JSValue>,
    ) -> JsResult<()> {
        if self.handler(channel)?.is_some() {
            return Err(error(format_args!(
                "Attempted to register a second handler for '{}'",
                text_of(channel)?
            )));
        }
        if !handler.is_callable() {
            let kind = handler.js_type_string(global());
            return Err(type_error(format_args!(
                "Expected handler to be a function, but found type '{kind}'"
            )));
        }
        map_in(self.get_invoke_handlers()).set(global(), channel, wrap()?)?;
        if let Some(engine) = engine::running() {
            engine.send(Order::Handle {
                channels: list![wire::data_from_js(channel)?],
            });
        }
        Ok(())
    }

    pub(crate) fn handle<'a>(
        &self,
        _: Cx<'a, '_>,
        channel: JsLocal<'a, JSString>,
        handler: JsLocal<'a>,
    ) -> JsResult<()> {
        self.add(channel.to_js(), handler.to_js(), || Ok(handler.to_js()))
    }

    pub(crate) fn handle_once<'a>(
        &self,
        _: Cx<'a, '_>,
        channel: JsLocal<'a, JSString>,
        handler: JsLocal<'a>,
    ) -> JsResult<()> {
        self.add(channel.to_js(), handler.to_js(), || {
            let handlers = self.get_invoke_handlers();
            function(
                array(&[handlers, channel.to_js(), handler.to_js()])?,
                |captured, arguments| {
                    let [handlers, channel, handler] =
                        [0, 1, 2].map(|it| captured.get_index(global(), it));
                    map_in(handlers?).remove(global(), channel?)?;
                    call(handler?, arguments)
                },
            )
        })
    }

    pub(crate) fn remove_handler<'a>(
        &self,
        _: Cx<'a, '_>,
        channel: JsLocal<'a, JSString>,
    ) -> JsResult<()> {
        fields::handlers(self)
            .map(|it| map_in(it).remove(global(), channel.to_js()))
            .transpose()
            .map(drop)
    }
}

/// `frame` is a `WebFrameMain`.
#[derive(Clone, Copy)]
pub(crate) struct Sender {
    pub(crate) contents: JSValue,
    pub(crate) frame: JSValue,
    pub(crate) frame_id: u32,
    pub(crate) process_id: u32,
}

#[repr(C)]
pub(crate) struct IpcEvent {
    pub(crate) base: Event,
    pub(crate) fields: events::Fields,
    frame_id: u32,
    process_id: u32,
    can_reply: bool,
    /// The frame may have sent it while it was unloaded.
    is_being_delivered: Cell<bool>,
}

impl IpcEvent {
    pub(crate) fn get_type(&self) -> &'static str {
        "frame"
    }

    /// If it still has the document that has sent the message.
    fn frame(&self) -> JsResult<Option<JSValue>> {
        let frame = events::frame(self).unwrap_or(JSValue::NULL);
        let is_same = get(frame, "routingId")?.as_number() == f64::from(self.frame_id);
        let is_there = self.is_being_delivered.get() || !get(frame, "detached")?.to_boolean();
        Ok((is_same && is_there).then_some(frame))
    }

    pub(crate) fn get_sender_frame(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(self.frame()?.unwrap_or(JSValue::NULL))
    }

    pub(crate) fn get_frame_id(&self) -> u32 {
        self.frame_id
    }

    pub(crate) fn get_process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn get_ports(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        if events::ports(self).is_none() {
            events::set_ports(self, array(&[])?);
        }
        Ok(events::ports(self).unwrap_or_default())
    }

    pub(crate) fn get_reply(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        if !self.can_reply {
            return Ok(JSValue::UNDEFINED);
        }
        function(self.to_js(), |event, arguments| {
            let frame = cast::<IpcEvent>(event)
                .map(IpcEvent::frame)
                .transpose()?
                .flatten();
            frame.map_or(Ok(JSValue::UNDEFINED), |it| invoke(it, "send", arguments))
        })
    }

    pub(crate) fn get_return_value(&self) -> JSValue {
        JSValue::UNDEFINED
    }

    pub(crate) fn set_return_value<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
        events::set_answer(self, value.to_js());
        events::on_answer(self)
            .map(|it| call(it, &[value.to_js()]))
            .transpose()
            .map(drop)
    }

    pub(crate) fn answer(&self) -> Option<JSValue> {
        events::answer(self)
    }

    pub(crate) fn on_answer(&self, listener: JSValue) {
        events::set_on_answer(self, listener);
    }

    fn while_delivered<T>(&self, deliver: impl FnOnce() -> T) -> T {
        self.is_being_delivered.set(true);
        let result = deliver();
        self.is_being_delivered.set(false);
        result
    }
}

impl Sender {
    pub(crate) fn new(contents: JSValue, frame: JSValue) -> JsResult<Sender> {
        let (frame_id, process_id) = (
            get(frame, "routingId")?.as_number() as u32,
            get(frame, "processId")?.as_number() as u32,
        );
        Ok(Sender {
            contents,
            frame,
            frame_id,
            process_id,
        })
    }

    pub(crate) fn event(self, can_reply: bool) -> &'static IpcEvent {
        let event = IpcEvent {
            base: Event::default(),
            fields: Default::default(),
            frame_id: self.frame_id,
            process_id: self.process_id,
            can_reply,
            is_being_delivered: false.into(),
        };
        let event = events::create(heap(), event);
        events::set_sender(event, self.contents);
        events::set_frame(event, self.frame);
        event
    }

    fn receivers(self) -> JsResult<[JSValue; 3]> {
        Ok([get(self.frame, "ipc")?, get(self.contents, "ipc")?, main()?])
    }

    /// `kind` is the event of the `webContents`.
    pub(crate) fn dispatch(
        self,
        kind: Option<&str>,
        event: &IpcEvent,
        channel: JSValue,
        values: JSValue,
    ) -> JsResult<()> {
        with_elements_after(
            &[JSValue::UNDEFINED, event.to_js(), channel],
            values,
            |all| {
                event.while_delivered(|| {
                    if let Some(kind) = kind {
                        all[0] = js(kind)?;
                        invoke(self.contents, "emit", all)?;
                    }
                    all.swap(1, 2);
                    for receiver in self.receivers()? {
                        invoke(receiver, "emit", &all[1..])?;
                    }
                    Ok(())
                })
            },
        )
    }

    pub(crate) fn send(
        self,
        channel: JSValue,
        values: JSValue,
        ports: Option<JSValue>,
    ) -> JsResult<()> {
        let event = self.event(true);
        events::set_ports(event, ports.unwrap_or_default());
        self.dispatch(Some("ipc-message"), event, channel, values)
    }

    pub(crate) fn send_without_event(
        self,
        channel: JSValue,
        values: JSValue,
        ports: JSValue,
    ) -> JsResult<()> {
        let event = self.event(true);
        events::set_ports(event, ports);
        self.dispatch(None, event, channel, values)
    }

    pub(crate) fn is_listened_to(self, channel: JSValue) -> JsResult<bool> {
        for receiver in self.receivers()? {
            if invoke(receiver, "listenerCount", &[channel])?.to_boolean() {
                return Ok(true);
            }
        }
        has_listeners(self.contents, "ipc-message-sync")
    }

    pub(crate) fn invoke(self, channel: JSValue, values: JSValue) -> JsResult<JSValue> {
        for receiver in self.receivers()?.into_iter().filter_map(cast::<IpcMain>) {
            if let Some(handler) = receiver.handler(channel)? {
                let event = self.event(false);
                return with_elements_after(&[event.to_js()], values, |all| {
                    event.while_delivered(|| call(handler, all))
                });
            }
        }
        Err(error(format_args!(
            "No handler registered for '{}'",
            text_of(channel)?
        )))
    }
}
