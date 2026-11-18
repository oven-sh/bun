//! What a preload script sees, and its channel to the app.

use std::time::Instant;

use bun_jsc::bindgen::Result as CallbackResult;
use bun_jsc::{JSPromise, JSString};
use bun_web::tasks::{self, Work};

use crate::bridge::Link;
use crate::contents::page::Page;
use crate::generated_bindgen::electron::DesktopProcess;
use crate::generated_bindgen::renderer::{
    ExecutionScript, RendererContextBridge, RendererCrashReporter, RendererElectron, RendererIpc,
    RendererProcess, RendererWebUtils, WebSource, js_RendererContextBridge,
    js_RendererCrashReporter, js_RendererElectron, js_RendererIpc, js_RendererPreload as fields,
    js_RendererProcess, js_RendererWebFrame as frames, js_RendererWebUtils,
};
use crate::generated_bindgen::system::js_DesktopShell;
use crate::ipc::Sender;
use crate::prelude::*;
use crate::realm::{self, Module, Realm, answer_to};
use crate::{files, modules, process};

const PATIENCE: f64 = 5000.;

state!(fn active() -> RefCell<Vec<(*const Realm, Root<Preload>)>>);

pub(crate) struct Init {
    pub(crate) global: JSValue,
    pub(crate) members: JSValue,
    pub(crate) host: JSValue,
    pub(crate) page: JSValue,
    pub(crate) contents: JSValue,
    pub(crate) is_isolated: bool,
    pub(crate) is_sandboxed: bool,
    pub(crate) integrates_node: bool,
    pub(crate) document_path: String,
    pub(crate) additional_arguments: Vec<String>,
}

pub(crate) struct Preload {
    frame_id: u32,
    process_id: u32,
    is_isolated: bool,
    is_sandboxed: bool,
    started: Instant,
    is_disposed: Cell<bool>,
}

fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or(JSValue::UNDEFINED)
}

fn frame_of(page: JSValue) -> JSValue {
    cast(page).map_or(JSValue::UNDEFINED, Page::handle)
}

fn captured(value: JSValue) -> &'static Preload {
    cast(value).expect("it was captured")
}

impl Preload {
    /// `None` once the document is gone.
    fn of(realm: &Realm) -> Option<&'static Preload> {
        active()
            .borrow()
            .iter()
            .find(|it| core::ptr::eq(it.0, realm))
            .map(|it| it.1.get())
    }

    fn of_or_throw(realm: &Realm) -> JsResult<&'static Preload> {
        Preload::of(realm).ok_or_else(|| realm.throw(format_args!("The frame was disposed")))
    }

    pub(crate) fn create(it: &Init) -> JsResult<&'static Preload> {
        let (sender, realm) = (
            Sender::new(it.contents, frame_of(it.page))?,
            realm::of(it.global),
        );
        let preload = Preload {
            frame_id: sender.frame_id,
            process_id: sender.process_id,
            is_isolated: it.is_isolated,
            is_sandboxed: it.is_sandboxed,
            started: Instant::now(),
            is_disposed: false.into(),
        };
        let preload = fields::create(heap(), preload);
        fields::set_global(preload, it.global);
        fields::set_host(preload, it.host);
        fields::set_page(preload, it.page);
        fields::set_contents(preload, sender.contents);
        fields::set_process(preload, preload.describe_process(it)?);
        active().borrow_mut().push((realm, Root::new(preload)));

        let members = it.members;
        members.put(realm, b"process", field(fields::process(preload)));
        members.put(realm, b"global", it.global);
        for name in ["Buffer", "setImmediate", "clearImmediate"] {
            members.put(realm, name.as_bytes(), realm::native(realm, name)?);
        }
        if it.integrates_node {
            members.put(realm, b"module", preload.module()?);
            members.put(
                realm,
                b"require",
                preload.require_from(it.document_path.clone())?,
            );
        }
        Ok(preload)
    }

    fn realm(&self) -> &'static Realm {
        realm::of(field(fields::global(self)))
    }

    fn sender(&self) -> Sender {
        let (contents, frame) = (
            field(fields::contents(self)),
            frame_of(field(fields::page(self))),
        );
        Sender {
            contents,
            frame,
            frame_id: self.frame_id,
            process_id: self.process_id,
        }
    }

    fn ask(&self, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        answer_to(
            self.realm(),
            invoke(field(fields::host(self)), method, arguments),
        )
    }

    fn describe_process(&self, it: &Init) -> JsResult<JSValue> {
        let (realm, real) = (self.realm(), process::object());
        let own = match self.is_sandboxed {
            true => js_RendererProcess::CLASS.constructor(JsHeap::from_global(realm)),
            false => realm::create_object(realm, real),
        };
        if self.is_sandboxed {
            for name in ["arch", "platform", "pid", "execPath", "version"] {
                own.put(realm, name.as_bytes(), get(real, name)?);
            }
            for name in ["versions", "env"] {
                let (all, copy) = (get(real, name)?, JSValue::create_empty_object(realm, 0));
                let mut keys = all.keys(global())?.array_iterator(global())?;
                while let Some(key) = keys.next()? {
                    let value = get_by_value(global(), all, key)?
                        .to_js_string(global())?
                        .to_js();
                    JSValue::put_to_property_key(copy, realm, key, value)?;
                }
                own.put(realm, name.as_bytes(), copy);
            }
        }
        let more = it.additional_arguments.iter().cloned();
        let arguments: Vec<String> = [process::executable(), "--type=renderer".into()]
            .into_iter()
            .chain(more)
            .collect();
        own.put(realm, b"type", js("renderer")?);
        own.put(realm, b"argv", arguments.into_js(realm)?);
        own.put(realm, b"contextIsolated", self.is_isolated.into());
        own.put(
            realm,
            b"sandboxed",
            if self.is_sandboxed {
                JSValue::TRUE
            } else {
                JSValue::UNDEFINED
            },
        );
        own.put(
            realm,
            b"isMainFrame",
            get(self.sender().frame, "parent")?.is_null().into(),
        );
        own.put(
            realm,
            b"contextId",
            js(format!("{}-{}", self.process_id, self.frame_id))?,
        );
        Ok(own)
    }

    fn module(&self) -> JsResult<JSValue> {
        Ok(
            bun_ui::object!(self.realm(), { "exports": JSValue::create_empty_object(self.realm(), 0) }),
        )
    }

    fn require_from(&self, file: String) -> JsResult<JSValue> {
        Ok(function_in(
            self.realm(),
            self.to_js(),
            move |preload, arguments| captured(preload).require(&file, argument(arguments, 0)),
        ))
    }

    fn require(&self, from: &str, id: JSValue) -> JsResult<JSValue> {
        let (realm, this) = (self.realm(), field(fields::global(self)));
        let name = string(&id.to_utf8(realm)?);
        if let "electron" | "electron/renderer" | "electron/common" = &*name {
            return Ok(js_RendererElectron::CLASS.constructor(JsHeap::from_global(realm)));
        }
        if !self.is_sandboxed {
            return call(
                invoke(
                    realm::require(global(), Module::Module)?,
                    "createRequire",
                    &[js(from)?],
                )?,
                &[id],
            );
        }
        match name.strip_prefix("node:").unwrap_or(&name) {
            "events" => realm::require(realm, Module::Events),
            "url" => realm::require(realm, Module::Url),
            "timers" => {
                let timers = JSValue::create_empty_object(realm, 0);
                for name in ["setImmediate", "clearImmediate"] {
                    timers.put(realm, name.as_bytes(), realm::native(realm, name)?);
                }
                for name in ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] {
                    timers.put(realm, name.as_bytes(), field(this.get(realm, name)?));
                }
                Ok(timers)
            }
            _ => Err(realm.throw(format_args!("module not found: {name}"))),
        }
    }

    pub(crate) fn run(&self, script: JSValue, file: &str) -> JsResult<()> {
        let (realm, path, module) = (self.realm(), file.to_owned(), self.module()?);
        let exports = get(module, "exports")?;
        let arguments = [
            self.require_from(path.clone())?,
            field(fields::process(self)),
            realm::native(realm, "Buffer")?,
            field(fields::global(self)),
            realm::native(realm, "setImmediate")?,
            realm::native(realm, "clearImmediate")?,
            exports,
            module,
            js(file)?,
            js(files::parent(&path).unwrap_or("/"))?,
        ];
        script
            .call(
                realm,
                exports,
                &arguments[..if self.is_sandboxed { 8 } else { 10 }],
            )
            .map(drop)
    }

    pub(crate) fn loaded(&self) -> JsResult<()> {
        if !self.is_sandboxed {
            return Ok(());
        }
        invoke_in(
            self.realm(),
            field(fields::process(self)),
            "emit",
            &[js("loaded")?],
        )
        .map(drop)
    }

    pub(crate) fn dispose(&self) {
        self.is_disposed.set(true);
        active().borrow_mut().retain(|it| !same(it.1.get(), self));
    }

    // ── from the app ──

    pub(crate) fn send(&self, channel: JSValue, values: JSValue, ports: JSValue) -> JsResult<()> {
        let realm = self.realm();
        let values = realm::clone(global(), realm, values)?;
        let values = [self.to_js(), channel, values, ports];
        tasks::post(
            realm,
            Priority::Visible,
            Work::Function(Self::receive, 0),
            &values,
        );
        Ok(())
    }

    fn receive(realm: &Realm, _: u64, task: &[JSValue]) -> JsResult<()> {
        let &[preload, channel, values, given] = task else {
            return Ok(());
        };
        if captured(preload).is_disposed.get() {
            return Ok(());
        }
        let (ipc, ports) = (
            js_RendererIpc::CLASS.constructor(JsHeap::from_global(realm)),
            JSValue::create_empty_array(realm, 0)?,
        );
        for index in 0..given.get_length(realm)? as u32 {
            let parked = crate::ports::park(given.get_index(realm, index)?);
            ports.push(realm, captured(preload).ask("adoptPort", &[js(parked)?])?)?;
        }
        let event = bun_ui::object!(realm, { "sender": ipc, "ports": ports });
        with_elements_after(&[channel, event], values, |all| {
            invoke_in(realm, ipc, "emit", all).map(drop)
        })
    }

    // ── to the app ──

    fn post(
        &self,
        deliver: fn(&Realm, u64, &[JSValue]) -> JsResult<()>,
        channel: JSValue,
        values: JSValue,
        last: JSValue,
    ) {
        tasks::post(
            global(),
            Priority::Host,
            Work::Function(deliver, 0),
            &[self.to_js(), channel, values, last],
        );
    }

    fn deliver_message(_: &Realm, _: u64, task: &[JSValue]) -> JsResult<()> {
        let &[preload, channel, values, ports] = task else {
            return Ok(());
        };
        let sender = captured(preload).sender();
        if invoke(sender.contents, "isDestroyed", &[])?.to_boolean() {
            return Ok(());
        }
        sender.send(channel, values, Some(ports).filter(|it| it.is_object()))
    }

    fn deliver_invocation(_: &Realm, _: u64, task: &[JSValue]) -> JsResult<()> {
        fn settled<'a>(
            _: Cx<'a, '_>,
            [preload, pending]: [JsLocal<'a>; 2],
            is_rejected: u64,
            arguments: &'a [JsLocal<'a>],
        ) -> CallbackResult<'a, JSValue> {
            let [promise, channel] = [0, 1].map(|it| pending.to_js().get_index(global(), it));
            let value = argument(JsLocal::to_js_slice(arguments), 0);
            let result = if is_rejected == 0 {
                Ok(value)
            } else {
                Err(value)
            };
            captured(preload.to_js()).reply(promise?, channel?, result)?;
            Ok(JSValue::UNDEFINED)
        }
        let &[preload, channel, values, promise] = task else {
            return Ok(());
        };
        match catch(captured(preload).sender().invoke(channel, values))? {
            Ok(result) if result.is_object() => {
                let pending = array(&[promise, channel])?;
                let reaction = |is_rejected| {
                    heap()
                        .create_callback(settled, [preload, pending], is_rejected)
                        .to_js()
                };
                react(global(), result, reaction(0), reaction(1))
            }
            result => captured(preload).reply(promise, channel, result),
        }
    }

    fn reply(
        &self,
        promise: JSValue,
        channel: JSValue,
        result: Result<JSValue, JSValue>,
    ) -> JsResult<()> {
        let result = match result {
            Ok(_) if self.is_disposed.get() => return Ok(()),
            Ok(value) => catch(realm::clone(global(), self.realm(), value))?,
            failure => failure,
        };
        let (value, is_rejected) = match result {
            Ok(value) => (value, 0),
            Err(thrown) => {
                let channel = text_of(channel)?;
                let message = js(format!("Error occurred in handler for '{channel}':"))?;
                invoke(
                    get(global().to_js_value(), "console")?,
                    "error",
                    &[message, thrown],
                )?;
                let reason = catch(text_of(thrown))?.unwrap_or_default();
                (
                    js(format!(
                        "Error invoking remote method '{channel}': {reason}"
                    ))?,
                    1,
                )
            }
        };
        let work = Work::Function(Self::receive_reply, is_rejected);
        tasks::post(
            self.realm(),
            Priority::Visible,
            work,
            &[self.to_js(), promise, value],
        );
        Ok(())
    }

    fn receive_reply(realm: &Realm, is_rejected: u64, task: &[JSValue]) -> JsResult<()> {
        let &[preload, promise, value] = task else {
            return Ok(());
        };
        if captured(preload).is_disposed.get() {
            return Ok(());
        }
        let result = if is_rejected == 0 {
            Ok(value)
        } else {
            Err(realm.throw(format_args!("{}", text_of(value)?)))
        };
        realm::settle(realm, promise, result)
    }

    fn send_and_wait(&self, channel: JSValue, values: JSValue) -> JsResult<JSValue> {
        let (sender, event) = (self.sender(), self.sender().event(true));
        sender.dispatch(Some("ipc-message-sync"), event, channel, values)?;
        if event.answer().is_none() && sender.is_listened_to(channel)? {
            let done = std::rc::Rc::new(Deferred::new());
            let (answered, given_up) = (std::rc::Rc::clone(&done), std::rc::Rc::clone(&done));
            event.on_answer(procedure(move |_| answered.resolve(JSValue::UNDEFINED))?);
            // All pages wait, so an answer that depends on one of them never comes.
            let _timer = later::after(PATIENCE, move |_| given_up.resolve(JSValue::UNDEFINED));
            invoke(field(fields::host(self)), "block", &[done.promise()])?;
        }
        match event.answer() {
            Some(answer) => realm::clone(global(), self.realm(), answer),
            None => Err(error(format_args!(
                "event.returnValue of '{}' was not set",
                text_of(channel)?
            ))),
        }
    }

    fn link_to(&self, world: u32) -> JsResult<(Link<'static>, &'static Realm)> {
        if !self.is_isolated {
            let message = "contextBridge API can only be used when contextIsolation is enabled";
            return Err(self.realm().throw(format_args!("{message}")));
        }
        let world = realm::of(self.ask("window", &[js(world)?])?);
        Ok((Link::new(self.realm(), world), world))
    }
}

fn message(
    realm: &Realm,
    method: &str,
    channel: JsLocal<'_>,
    values: &[JsLocal<'_>],
) -> JsResult<(JSValue, JSValue)> {
    let values = JSValue::create_array_from_slice(realm, JsLocal::to_js_slice(values))?;
    Ok((
        valid_channel(realm, method, channel)?,
        realm::clone(realm, global(), values)?,
    ))
}

fn valid_channel(realm: &Realm, method: &str, channel: JsLocal<'_>) -> JsResult<JSValue> {
    if channel.to_js().is_string_literal() {
        return Ok(channel.to_js());
    }
    Err(realm.throw_type_error(format_args!(
        "Error processing argument at index 0 of {method}, conversion failure: channel must be a string"
    )))
}

impl RendererIpc {
    pub(crate) fn send<'a>(
        cx: Cx<'a, '_>,
        channel: JsLocal<'a>,
        values: &[JsLocal<'a>],
    ) -> JsResult<()> {
        let (channel, values) = message(cx.global(), "send", channel, values)?;
        if let Some(preload) = Preload::of(cx.global()) {
            preload.post(
                Preload::deliver_message,
                channel,
                values,
                JSValue::UNDEFINED,
            );
        }
        Ok(())
    }

    pub(crate) fn send_sync<'a>(
        cx: Cx<'a, '_>,
        channel: JsLocal<'a>,
        values: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let realm = cx.global();
        let (channel, values) = message(realm, "sendSync", channel, values)?;
        answer_to(
            realm,
            Preload::of_or_throw(realm)?.send_and_wait(channel, values),
        )
    }

    pub(crate) fn send_to_host() {}

    pub(crate) fn invoke<'a>(
        cx: Cx<'a, '_>,
        channel: JsLocal<'a>,
        values: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let (channel, values) = message(cx.global(), "invoke", channel, values)?;
        let promise = JSPromise::create(cx.global()).to_js();
        if let Some(preload) = Preload::of(cx.global()) {
            preload.post(Preload::deliver_invocation, channel, values, promise);
        }
        Ok(promise)
    }

    pub(crate) fn post_message<'a>(
        cx: Cx<'a, '_>,
        channel: JsLocal<'a>,
        message: JsLocal<'a>,
        transfer: Option<JsList<'a, JsLocal<'a, JSObject>>>,
    ) -> JsResult<()> {
        let realm = cx.global();
        let (channel, Some(preload)) = (
            valid_channel(realm, "postMessage", channel)?,
            Preload::of(realm),
        ) else {
            return Ok(());
        };
        let values = JSValue::create_array_from_slice(realm, &[message.to_js()])?;
        let (values, ports) = (realm::clone(realm, global(), values)?, array(&[])?);
        for port in transfer.into_iter().flatten() {
            let parked = preload.ask("releasePort", &[port.to_js()])?;
            if !parked.is_number() {
                return Err(realm.throw_type_error(format_args!("Invalid value for transfer")));
            }
            ports.push(global(), crate::ports::unpark(parked.as_number()))?;
        }
        preload.post(Preload::deliver_message, channel, values, ports);
        Ok(())
    }
}

impl RendererContextBridge {
    pub(crate) fn expose_in_main_world<'a>(
        cx: Cx<'a, '_>,
        key: JsLocal<'a, JSString>,
        api: JsLocal<'a>,
    ) -> JsResult<()> {
        Self::expose_in_isolated_world(cx, 0, key, api)
    }

    pub(crate) fn expose_in_isolated_world<'a>(
        cx: Cx<'a, '_>,
        world: u32,
        key: JsLocal<'a, JSString>,
        api: JsLocal<'a>,
    ) -> JsResult<()> {
        Preload::of_or_throw(cx.global())?
            .link_to(world)?
            .0
            .expose(key.to_js(), api.to_js())
    }

    pub(crate) fn execute_in_main_world<'a>(
        cx: Cx<'a, '_>,
        script: &ExecutionScript<'a>,
    ) -> JsResult<JSValue> {
        let realm = cx.global();
        let (link, world) = Preload::of_or_throw(realm)?.link_to(0)?;
        let source = js(format!("({})", script.func.to_js().to_bun_string(realm)?))?;
        let world = bun_web::realm::Realm::of(world).expect("the realm of a page");
        match catch(world.evaluate(source, b"", b""))? {
            Err(thrown) => link.back().pass(Err(realm.throw_value(thrown))),
            Ok(function) => match script.args {
                Some(it) => with_elements(it.to_js(), |all| {
                    link.call(function, JSValue::UNDEFINED, all)
                }),
                None => link.call(function, JSValue::UNDEFINED, &[]),
            },
        }
    }
}

fn zoom(realm: &Realm, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
    answer_to(
        realm,
        invoke(
            Preload::of_or_throw(realm)?.sender().contents,
            method,
            arguments,
        ),
    )
}

#[derive(Default)]
pub(crate) struct WebFrame(#[expect(dead_code)] HasFields);

macro_rules! relatives {
    ($($method:ident: $kind:literal),*) => {$(
        pub(crate) fn $method(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
            self.relative(cx.global(), $kind, JSValue::UNDEFINED)
        }
    )*};
}

macro_rules! finders {
    ($($method:ident: $kind:literal),*) => {$(
        pub(crate) fn $method<'a>(&self, cx: Cx<'a, '_>, text: JsLocal<'a, JSString>) -> JsResult<JSValue> {
            self.relative(cx.global(), $kind, text.to_js())
        }
    )*};
}

impl WebFrame {
    fn create(realm: &Realm, host: JSValue) -> JSValue {
        let frame = frames::create(JsHeap::from_global(realm), WebFrame::default());
        frames::set_host(frame, host);
        frame.to_js()
    }

    fn ask(&self, realm: &Realm, method: &str, arguments: &[JSValue]) -> JsResult<JSValue> {
        Preload::of_or_throw(realm)?;
        answer_to(realm, invoke(field(frames::host(self)), method, arguments))
    }

    fn relative(&self, realm: &Realm, kind: &str, more: JSValue) -> JsResult<JSValue> {
        let host = self.ask(realm, "relative", &[js(kind)?, more])?;
        Ok(if host.is_object() {
            WebFrame::create(realm, host)
        } else {
            JSValue::NULL
        })
    }

    fn execute(
        &self,
        realm: &Realm,
        world: u32,
        code: JSValue,
        is_by_user: bool,
        callback: JSValue,
    ) -> JsResult<JSValue> {
        let arguments = [js(world)?, code, is_by_user.into()];
        let promise = realm::adopt(realm, self.ask(realm, "executeJavaScript", &arguments)?)?;
        if callback.is_callable() {
            let tell = |arrange: fn(JSValue) -> [JSValue; 2]| {
                function_in(realm, callback, move |callback, it| {
                    callback.call(
                        realm::of(callback),
                        JSValue::UNDEFINED,
                        &arrange(argument(it, 0)),
                    )
                })
            };
            react(
                realm,
                promise,
                tell(|it| [it, JSValue::UNDEFINED]),
                tell(|it| [JSValue::UNDEFINED, it]),
            )?;
        }
        Ok(promise)
    }

    pub(crate) fn nothing(&self) {}

    pub(crate) fn get_routing_id(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        self.ask(cx.global(), "routingId", &[])
    }

    pub(crate) fn get_frame_token(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        self.ask(cx.global(), "frameToken", &[])
    }

    relatives!(
        get_top: "top",
        get_parent: "parent",
        get_opener: "opener",
        get_first_child: "firstChild",
        get_next_sibling: "nextSibling"
    );

    finders!(
        find_frame_by_token: "token",
        find_frame_by_name: "name",
        get_frame_for_selector: "selector"
    );

    pub(crate) fn find_frame_by_routing_id(&self, cx: Cx<'_, '_>, id: f64) -> JsResult<JSValue> {
        self.relative(cx.global(), "routingId", js(id)?)
    }

    pub(crate) fn get_zoom_factor(&self, cx: Cx<'_, '_>) -> JsResult<f64> {
        zoom(cx.global(), "getZoomFactor", &[]).map(JSValue::as_number)
    }

    pub(crate) fn set_zoom_factor(&self, cx: Cx<'_, '_>, factor: f64) -> JsResult<()> {
        zoom(cx.global(), "setZoomFactor", &[js(factor)?]).map(drop)
    }

    pub(crate) fn get_zoom_level(&self, cx: Cx<'_, '_>) -> JsResult<f64> {
        zoom(cx.global(), "getZoomLevel", &[]).map(JSValue::as_number)
    }

    pub(crate) fn set_zoom_level(&self, cx: Cx<'_, '_>, level: f64) -> JsResult<()> {
        zoom(cx.global(), "setZoomLevel", &[js(level)?]).map(drop)
    }

    pub(crate) fn insert_css<'a>(
        &self,
        cx: Cx<'a, '_>,
        css: JsLocal<'a, JSString>,
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let origin = match options.to_js().is_object() {
            true => options.to_js().get(cx.global(), "cssOrigin")?,
            false => None,
        };
        let origin = origin.map(|it| it.to_utf8(cx.global())).transpose()?;
        let is_of_user = origin.is_some_and(|it| *it == *b"user");
        self.ask(cx.global(), "insertCSS", &[css.to_js(), is_of_user.into()])
    }

    pub(crate) fn remove_inserted_css<'a>(
        &self,
        cx: Cx<'a, '_>,
        key: JsLocal<'a, JSString>,
    ) -> JsResult<()> {
        self.ask(cx.global(), "removeInsertedCSS", &[key.to_js()])
            .map(drop)
    }

    pub(crate) fn insert_text<'a>(
        &self,
        cx: Cx<'a, '_>,
        text: JsLocal<'a, JSString>,
    ) -> JsResult<()> {
        self.ask(cx.global(), "insertText", &[text.to_js()])
            .map(drop)
    }

    pub(crate) fn execute_java_script<'a>(
        &self,
        cx: Cx<'a, '_>,
        code: JsLocal<'a, JSString>,
        gesture: JsLocal<'a>,
        callback: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let (is_by_user, callback) = match gesture.to_js().is_callable() {
            true => (false, gesture),
            false => (gesture.to_js().to_boolean(), callback),
        };
        self.execute(cx.global(), 0, code.to_js(), is_by_user, callback.to_js())
    }

    pub(crate) fn execute_java_script_in_isolated_world<'a>(
        &self,
        cx: Cx<'a, '_>,
        world: u32,
        scripts: Vec<WebSource>,
        is_by_user: bool,
        callback: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        let code = scripts
            .into_iter()
            .map(|it| string(&it.code))
            .collect::<Vec<_>>()
            .join(";\n");
        self.execute(cx.global(), world, js(code)?, is_by_user, callback.to_js())
    }

    pub(crate) fn get_resource_usage(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        let realm = cx.global();
        let all = JSValue::create_empty_object(realm, 0);
        for kind in [
            "images",
            "scripts",
            "cssStyleSheets",
            "xslStyleSheets",
            "fonts",
            "other",
        ] {
            let usage = bun_ui::object!(realm, { "count": 0, "size": 0, "liveSize": 0 });
            all.put(realm, kind.as_bytes(), usage);
        }
        Ok(all)
    }

    pub(crate) fn get_isolated_worlds(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        let ids = self.ask(cx.global(), "isolatedWorlds", &[])?;
        realm::clone(global(), cx.global(), ids)
    }

    pub(crate) fn is_word_misspelled(&self) -> bool {
        false
    }

    pub(crate) fn get_word_suggestions(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        JSValue::create_empty_array(cx.global(), 0)
    }
}

impl RendererWebUtils {
    pub(crate) fn get_path_for_file<'a>(cx: Cx<'a, '_>, file: JsLocal<'a>) -> JsResult<JSValue> {
        Preload::of_or_throw(cx.global())?.ask("pathForFile", &[file.to_js()])
    }
}

impl RendererCrashReporter {
    pub(crate) fn nothing() {}

    pub(crate) fn get_parameters(cx: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(JSValue::create_empty_object(cx.global(), 0))
    }
}

fn unless_sandboxed(realm: &Realm, module: fn() -> JSValue) -> JSValue {
    let is_sandboxed = Preload::of(realm).is_none_or(|it| it.is_sandboxed);
    if is_sandboxed {
        JSValue::UNDEFINED
    } else {
        module()
    }
}

macro_rules! modules {
    ($($name:ident: $class:ident;)*) => {$(
        pub(crate) fn $name(heap: &JsHeap<'_>) -> JSValue {
            $class::CLASS.constructor(heap)
        }
    )*};
}

impl RendererElectron {
    modules! {
        get_context_bridge: js_RendererContextBridge;
        get_crash_reporter: js_RendererCrashReporter;
        get_ipc_renderer: js_RendererIpc;
        get_web_utils: js_RendererWebUtils;
    }

    pub(crate) fn get_web_frame(cx: Cx<'_, '_>) -> JsResult<JSValue> {
        let preload = Preload::of_or_throw(cx.global())?;
        if fields::frame(preload).is_none() {
            let frame = WebFrame::create(cx.global(), field(fields::host(preload)));
            fields::set_frame(preload, frame);
        }
        Ok(field(fields::frame(preload)))
    }

    pub(crate) fn get_native_image(heap: &JsHeap<'_>) -> JSValue {
        bun_ui::image::module(heap)
    }

    pub(crate) fn get_clipboard(cx: Cx<'_, '_>) -> JSValue {
        unless_sandboxed(cx.global(), modules::clipboard_of_electron)
    }

    pub(crate) fn get_shell(cx: Cx<'_, '_>) -> JSValue {
        unless_sandboxed(cx.global(), || js_DesktopShell::CLASS.constructor(heap()))
    }
}

macro_rules! copied {
    ($($name:ident),*) => {$(
        pub(crate) fn $name(cx: Cx<'_, '_>) -> JsResult<JSValue> {
            let result = DesktopProcess::$name(cx).and_then(|it| realm::clone(global(), cx.global(), it));
            answer_to(cx.global(), result)
        }
    )*};
}

impl RendererProcess {
    pub(crate) fn next_tick<'a>(
        cx: Cx<'a, '_>,
        callback: JsLocal<'a, Callable>,
        values: &[JsLocal<'a>],
    ) -> JsResult<()> {
        let (realm, values) = (cx.global(), JsLocal::to_js_slice(values));
        let bound = callback.to_js().bind(
            realm,
            JSValue::UNDEFINED,
            &bun_core::String::EMPTY,
            0.,
            values,
        )?;
        realm.queue_microtask(bound, &[]);
        Ok(())
    }

    pub(crate) fn warn<'a>(cx: Cx<'a, '_>, warning: JsLocal<'a, JSString>) -> JsResult<()> {
        let realm = cx.global();
        invoke_in(
            realm,
            field(realm.to_js_value().get(realm, "console")?),
            "warn",
            &[warning.to_js()],
        )
        .map(drop)
    }

    pub(crate) fn uptime(cx: Cx<'_, '_>) -> f64 {
        Preload::of(cx.global()).map_or(0., |it| it.started.elapsed().as_secs_f64())
    }

    pub(crate) fn cwd() -> &'static str {
        "/"
    }

    copied!(
        get_blink_memory_info,
        get_cpu_usage,
        get_heap_statistics,
        get_system_memory_info
    );

    pub(crate) fn get_creation_time() -> f64 {
        process::creation_time()
    }

    pub(crate) fn get_process_memory_info(cx: Cx<'_, '_>) -> JsResult<JSValue> {
        let promise = DesktopProcess::get_process_memory_info(cx);
        let realm = cx.global();
        realm::adopt(realm, answer_to(realm, promise)?)
    }

    pub(crate) fn get_system_version() -> &'static str {
        DesktopProcess::get_system_version()
    }
}
