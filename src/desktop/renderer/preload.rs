//! What a preload script sees, and its channel to the app.

use std::time::Instant;

use bun_jsc::{JSMap, JSPromise, JSString, from_js_host_call_generic};
use bun_web::channel::{Endpoint, Message, Serialized, Transferred};
use bun_web::convert::path_of_file;
use bun_web::dom;
use bun_web::exec::block_pages;
use bun_web::host::{Host, Relation};
use bun_web::page::{Order, Outcome, Query};
use bun_web::remote::is_page_process;
use bun_web::renderer::Preloads;
use bun_web::tasks::{self, Work};

use super::{Document, Nearby, Step, disposed, ports_in};
use crate::bridge::Link;
use crate::generated_bindgen::electron::DesktopProcess;
use crate::generated_bindgen::renderer::{
    ExecutionScript, RendererContextBridge, RendererCrashReporter, RendererElectron, RendererIpc,
    RendererProcess, RendererWebUtils, WebSource, js_RendererContextBridge,
    js_RendererCrashReporter, js_RendererElectron, js_RendererIpc, js_RendererPreload as fields,
    js_RendererProcess, js_RendererWebFrame as frames, js_RendererWebUtils,
};
use crate::generated_bindgen::system::js_DesktopShell;
use crate::prelude::*;
use crate::realm::{self, Module, Realm, answer_to};
use crate::{files, modules, process, task};

state!(fn active() -> RefCell<Vec<(*const Realm, Root<Preload>)>>);

pub(crate) struct Preload {
    is_sandboxed: bool,
    started: Instant,
    is_disposed: Cell<bool>,
    last_ticket: Cell<u32>,
}

fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or(JSValue::UNDEFINED)
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

    pub(super) fn create(
        document: &Document,
        window: JSValue,
        members: JSValue,
        it: Preloads,
    ) -> JsResult<&'static Preload> {
        let realm = realm::of(window);
        let preload = Preload {
            is_sandboxed: it.is_sandboxed,
            started: Instant::now(),
            is_disposed: false.into(),
            last_ticket: 0.into(),
        };
        let preload = fields::create(heap(), preload);
        fields::set_global(preload, window);
        fields::set_document(preload, Some(document));
        fields::set_process(preload, preload.describe_process(&it)?);
        active().borrow_mut().push((realm, Root::new(preload)));

        members.put(realm, b"process", field(fields::process(preload)));
        members.put(realm, b"global", window);
        for name in ["Buffer", "setImmediate", "clearImmediate"] {
            members.put(realm, name.as_bytes(), realm::native(realm, name)?);
        }
        if it.integrates_node {
            members.put(realm, b"module", preload.module()?);
            members.put(realm, b"require", preload.require_from(it.document_path)?);
        }
        Ok(preload)
    }

    fn realm(&self) -> &'static Realm {
        realm::of(field(fields::global(self)))
    }

    fn document(&self) -> &Document {
        fields::document(self).expect("it was made with one")
    }

    fn ask<T>(&self, question: impl FnOnce(&Host) -> T) -> JsResult<T> {
        from_js_host_call_generic(self.realm(), || question(&self.document().host))
    }

    fn describe_process(&self, it: &Preloads) -> JsResult<JSValue> {
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
            if let Some(environment) = &it.environment {
                let copy = JSValue::create_empty_object(realm, 0);
                for (name, value) in environment {
                    JSValue::put_to_property_key(copy, realm, js(&**name)?, js(&**value)?)?;
                }
                own.put(realm, b"env", copy);
            }
        }
        let more = it.additional_arguments.iter().cloned();
        let arguments: Vec<String> = [process::executable(), "--type=renderer".into()]
            .into_iter()
            .chain(more)
            .collect();
        own.put(realm, b"type", js("renderer")?);
        own.put(realm, b"argv", arguments.into_js(realm)?);
        own.put(
            realm,
            b"contextIsolated",
            self.document().isolates_context.into(),
        );
        own.put(
            realm,
            b"sandboxed",
            if self.is_sandboxed {
                JSValue::TRUE
            } else {
                JSValue::UNDEFINED
            },
        );
        own.put(realm, b"isMainFrame", it.is_main_frame.into());
        own.put(
            realm,
            b"contextId",
            js(format!("{}-{}", it.process, self.document().id))?,
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

    pub(super) fn run(&self, script: JSValue, file: &str) -> JsResult<()> {
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

    pub(super) fn loaded(&self) -> JsResult<()> {
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

    pub(super) fn dispose(&self) {
        self.is_disposed.set(true);
        active().borrow_mut().retain(|it| !same(it.1.get(), self));
    }

    // ── from the app ──

    pub(super) fn send(
        &self,
        channel: JSValue,
        values: JSValue,
        ports: Vec<Endpoint>,
    ) -> JsResult<()> {
        let values = realm::clone(global(), self.realm(), values)?;
        self.queue(channel, values, ports);
        Ok(())
    }

    pub(super) fn accept(&self, channel: &str, message: Message) -> JsResult<()> {
        let values = realm::unpack(self.realm(), &message.value)?;
        self.queue(js(channel)?, values, ports_in(message.transferred));
        Ok(())
    }

    fn queue(&self, channel: JSValue, values: JSValue, ports: Vec<Endpoint>) {
        let work = match ports.is_empty() {
            true => Work::Function(|realm, _, task| Self::receive(realm, task, Vec::new()), 0),
            false => Work::Once(Box::new(|realm, task| Self::receive(realm, task, ports))),
        };
        let values = [self.to_js(), channel, values];
        tasks::post(self.realm(), Priority::Visible, work, &values);
    }

    fn receive(realm: &Realm, task: &[JSValue], given: Vec<Endpoint>) -> JsResult<()> {
        let &[preload, channel, values] = task else {
            return Ok(());
        };
        if captured(preload).is_disposed.get() {
            return Ok(());
        }
        let (ipc, ports) = (
            js_RendererIpc::CLASS.constructor(JsHeap::from_global(realm)),
            JSValue::create_empty_array(realm, 0)?,
        );
        for port in given {
            let adopted = captured(preload).document().adopt_port(port);
            ports.push(realm, answer_to(realm, adopted)?)?;
        }
        let event = bun_ui::object!(realm, { "sender": ipc, "ports": ports });
        with_elements_after(&[channel, event], values, |all| {
            invoke_in(realm, ipc, "emit", all).map(drop)
        })
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.is_disposed.get()
    }

    /// Of a value of the realm of the app.
    pub(crate) fn copy(&self, value: JSValue) -> JsResult<JSValue> {
        realm::clone(global(), self.realm(), value)
    }

    /// The error is a message.
    pub(crate) fn reply(&self, promise: JSValue, result: Result<JSValue, JSValue>) {
        let work = Work::Function(Self::receive_reply, result.is_err().into());
        let values = [self.to_js(), promise, result.unwrap_or_else(|it| it)];
        tasks::post(self.realm(), Priority::Visible, work, &values);
    }

    fn pending(&self) -> &'static mut JSMap {
        if fields::pending(self).is_none() {
            fields::set_pending(self, JSMap::create(global()));
        }
        map_in(field(fields::pending(self)))
    }

    pub(super) fn accept_reply(
        &self,
        ticket: u32,
        result: Result<Message, String>,
    ) -> JsResult<()> {
        let promise = self.pending().get(global(), js(ticket)?)?;
        self.pending().remove(global(), js(ticket)?)?;
        let result = match result {
            Ok(message) => Ok(realm::unpack(self.realm(), &message.value)?),
            Err(message) => Err(js(message)?),
        };
        self.reply(promise, result);
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

    // ── to the app ──

    fn post(&self, deliver: Step, more: [JSValue; 4]) {
        let [channel, values, third, fourth] = more;
        let values = [self.document().owner(), channel, values, third, fourth];
        tasks::post(
            global(),
            Priority::Host,
            Work::Function(deliver, 0),
            &values,
        );
    }

    fn post_message(
        &self,
        channel: JSValue,
        values: Packed,
        ports: Option<Vec<Endpoint>>,
    ) -> JsResult<()> {
        match values {
            Packed::Nearby(app, values) => {
                let ports = field(ports.map(app.wrap_ports).transpose()?);
                self.post(app.send, [channel, values, ports, JSValue::UNDEFINED]);
            }
            Packed::Far(value) => {
                let has_ports = ports.is_some();
                let message = Message {
                    transferred: ports.into_iter().flatten().map(Transferred::Port).collect(),
                    ..value.into()
                };
                (self.document().host).ipc_send(text_of(channel)?, message, has_ports);
            }
        }
        Ok(())
    }

    fn invoke(&self, channel: JSValue, values: Packed, promise: JSValue) -> JsResult<()> {
        match values {
            Packed::Nearby(app, values) => {
                self.post(app.invoke, [channel, values, self.to_js(), promise]);
            }
            Packed::Far(value) => {
                self.last_ticket.update(|it| it.wrapping_add(1));
                let ticket = self.last_ticket.get();
                self.pending().set(global(), js(ticket)?, promise)?;
                (self.document().host).ipc_invoke(text_of(channel)?, value.into(), ticket);
            }
        }
        Ok(())
    }

    fn send_and_wait(&self, channel: JSValue, values: Packed) -> JsResult<JSValue> {
        let value = match values {
            Packed::Nearby(app, values) => {
                return self.copy((app.send_and_wait)(
                    self.document().owner(),
                    channel,
                    values,
                )?);
            }
            Packed::Far(value) => value,
        };
        let (answer, answered) = task::oneshot();
        let (channel, now) = (text_of(channel)?, std::rc::Rc::new(Cell::new(None)));
        let slot = std::rc::Rc::clone(&now);
        self.ask(|it| {
            it.ipc_send_sync(channel, value.into(), move |_, it| {
                slot.set(Some(it));
                answer.send(());
            })
        })?;
        let answer = now.take().or_else(|| {
            block_pages(global(), answered);
            now.take()
        });
        match answer.flatten().ok_or_else(disposed)? {
            Ok(message) => realm::unpack(self.realm(), &message.value),
            Err(message) => Err(error(format_args!("{message}"))),
        }
    }

    fn link_to(&self, world: u32) -> JsResult<(Link<'static>, &'static Realm)> {
        if !self.document().isolates_context {
            let message = "contextBridge API can only be used when contextIsolation is enabled";
            return Err(self.realm().throw(format_args!("{message}")));
        }
        let world = answer_to(self.realm(), self.document().world_with_id(world))?;
        let world = realm::of(world.window);
        Ok((Link::new(self.realm(), world), world))
    }
}

enum Packed {
    /// In the realm of the app.
    Nearby(&'static Nearby, JSValue),
    Far(Serialized),
}

fn pack(realm: &Realm, preload: Option<&Preload>, values: &[JSValue]) -> JsResult<Packed> {
    let values = JSValue::create_array_from_slice(realm, values)?;
    Ok(match preload.and_then(|it| it.document().nearby) {
        Some(app) => Packed::Nearby(app, realm::clone(realm, global(), values)?),
        None => Packed::Far(realm::pack(realm, values)?),
    })
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
        let realm = cx.global();
        let preload = Preload::of(realm);
        let channel = valid_channel(realm, "send", channel)?;
        let values = pack(realm, preload, JsLocal::to_js_slice(values))?;
        preload.map_or(Ok(()), |it| it.post_message(channel, values, None))
    }

    pub(crate) fn send_sync<'a>(
        cx: Cx<'a, '_>,
        channel: JsLocal<'a>,
        values: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let realm = cx.global();
        let channel = valid_channel(realm, "sendSync", channel)?;
        let values = pack(realm, Preload::of(realm), JsLocal::to_js_slice(values))?;
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
        let realm = cx.global();
        let preload = Preload::of(realm);
        let channel = valid_channel(realm, "invoke", channel)?;
        let values = pack(realm, preload, JsLocal::to_js_slice(values))?;
        let promise = JSPromise::create(realm).to_js();
        preload.map_or(Ok(()), |it| it.invoke(channel, values, promise))?;
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
        let (values, mut ports) = (pack(realm, Some(preload), &[message.to_js()])?, Vec::new());
        for port in transfer.into_iter().flatten() {
            let released = answer_to(realm, preload.document().release_port(port.to_js()))?;
            ports.push(released.ok_or_else(|| {
                realm.throw_type_error(format_args!("Invalid value for transfer"))
            })?);
        }
        preload.post_message(channel, values, Some(ports))
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

fn set_zoom(realm: &Realm, value: f64, is_level: bool) -> JsResult<()> {
    match Preload::of_or_throw(realm)?.ask(|it| it.set_zoom(value, is_level))? {
        Some(problem) => Err(realm.throw(format_args!("{problem}"))),
        None => Ok(()),
    }
}

pub(crate) struct WebFrame {
    page: u32,
    token: String,
}

macro_rules! relatives {
    ($($method:ident: $kind:ident),*) => {$(
        pub(crate) fn $method(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
            self.relative(cx.global(), Relation::$kind)
        }
    )*};
}

macro_rules! finders {
    ($($method:ident: $kind:ident),*) => {$(
        pub(crate) fn $method<'a>(&self, cx: Cx<'a, '_>, text: JsLocal<'a, JSString>) -> JsResult<JSValue> {
            self.relative(cx.global(), Relation::$kind(text_of(text.to_js())?))
        }
    )*};
}

impl WebFrame {
    fn create(realm: &Realm, page: u32, token: String) -> JSValue {
        frames::create(JsHeap::from_global(realm), WebFrame { page, token }).to_js()
    }

    fn tell(&self, realm: &Realm, order: Order) -> JsResult<()> {
        Preload::of_or_throw(realm)?;
        let obey = || dom::obey(self.page, order);
        answer_to(realm, from_js_host_call_generic(global(), obey))
    }

    fn relative(&self, realm: &Realm, relation: Relation) -> JsResult<JSValue> {
        let found = Preload::of_or_throw(realm)?.ask(|it| it.relative(self.page, relation))?;
        let found = answer_to(realm, found.ok_or_else(disposed))?;
        Ok(found.map_or(JSValue::NULL, |it| {
            WebFrame::create(realm, it.page, it.token)
        }))
    }

    fn execute(
        &self,
        realm: &Realm,
        world: u32,
        code: JSValue,
        is_by_user: bool,
        callback: JSValue,
    ) -> JsResult<JSValue> {
        let preload = Preload::of_or_throw(realm)?;
        if is_by_user {
            preload.ask(Host::activated_by_preload)?;
        }
        let promise = realm::adopt(realm, Document::execute(self.page, world, code, is_by_user))?;
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
        Preload::of_or_throw(cx.global())?;
        js(self.page)
    }

    pub(crate) fn get_frame_token(&self, cx: Cx<'_, '_>) -> JsResult<JSValue> {
        Preload::of_or_throw(cx.global())?;
        js(&*self.token)
    }

    relatives!(
        get_top: Top,
        get_parent: Parent,
        get_opener: Opener,
        get_first_child: FirstChild,
        get_next_sibling: NextSibling
    );

    finders!(find_frame_by_token: Token, find_frame_by_name: Name);

    pub(crate) fn get_frame_for_selector<'a>(
        &self,
        cx: Cx<'a, '_>,
        selector: JsLocal<'a, JSString>,
    ) -> JsResult<JSValue> {
        Preload::of_or_throw(cx.global())?;
        let select = || {
            let document = Document::of(self.page).ok_or_else(disposed)?;
            document.inspect("selectFrame", &[selector.to_js()])
        };
        let page = answer_to(cx.global(), select())?.get_number();
        self.relative(
            cx.global(),
            Relation::Selected(page.unwrap_or_default() as u32),
        )
    }

    pub(crate) fn find_frame_by_routing_id(&self, cx: Cx<'_, '_>, id: f64) -> JsResult<JSValue> {
        let page = Some(id as u32).filter(|it| f64::from(*it) == id);
        self.relative(cx.global(), Relation::Page(page.unwrap_or_default()))
    }

    pub(crate) fn get_zoom_factor(&self, cx: Cx<'_, '_>) -> JsResult<f64> {
        Ok(Preload::of_or_throw(cx.global())?.ask(Host::zoom)?[0])
    }

    pub(crate) fn set_zoom_factor(&self, cx: Cx<'_, '_>, factor: f64) -> JsResult<()> {
        set_zoom(cx.global(), factor, false)
    }

    pub(crate) fn get_zoom_level(&self, cx: Cx<'_, '_>) -> JsResult<f64> {
        Ok(Preload::of_or_throw(cx.global())?.ask(Host::zoom)?[1])
    }

    pub(crate) fn set_zoom_level(&self, cx: Cx<'_, '_>, level: f64) -> JsResult<()> {
        set_zoom(cx.global(), level, true)
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
        Preload::of_or_throw(cx.global())?;
        let css = text_of(css.to_js())?;
        match dom::answer(self.page, Query::InsertSheet { css, is_of_user }) {
            Some(Outcome::InsertSheet(key)) => js(key.to_string()),
            _ => js("0"),
        }
    }

    pub(crate) fn remove_inserted_css<'a>(
        &self,
        cx: Cx<'a, '_>,
        key: JsLocal<'a, JSString>,
    ) -> JsResult<()> {
        let key = key.to_js().to_number(cx.global())? as u32;
        self.tell(cx.global(), Order::RemoveSheet { key })
    }

    pub(crate) fn insert_text<'a>(
        &self,
        cx: Cx<'a, '_>,
        text: JsLocal<'a, JSString>,
    ) -> JsResult<()> {
        let text = text_of(text.to_js())?;
        self.tell(cx.global(), Order::InsertText { text })
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
        Preload::of_or_throw(cx.global())?;
        let ids = Document::of(self.page).map(Document::isolated_worlds);
        ids.transpose()?.unwrap_or_default().into_js(cx.global())
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
        let document = Preload::of_or_throw(cx.global())?.document();
        let find = || {
            let file =
                (document.world_of_preload()?).carry(file.to_js(), document.world_with_id(0)?)?;
            let path = file.is_object().then(|| path_of_file(global(), file));
            path.filter(|it| it.is_string()).map_or_else(|| js(""), Ok)
        };
        answer_to(cx.global(), find())
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
            let document = preload.document();
            let frame = WebFrame::create(cx.global(), document.id, string(&document.client.token));
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

    pub(crate) fn crash(cx: Cx<'_, '_>) -> JsResult<()> {
        if is_page_process() {
            DesktopProcess::crash();
        }
        Preload::of_or_throw(cx.global())?.ask(Host::crashed)
    }

    pub(crate) fn hang(cx: Cx<'_, '_>) -> JsResult<()> {
        if is_page_process() {
            DesktopProcess::hang();
        }
        Err((cx.global()).throw(format_args!("process.hang() needs the option sandbox")))
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
