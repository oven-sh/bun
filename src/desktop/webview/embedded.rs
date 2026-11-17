//! An `<iframe>` of a page of the app. The web engine has it in an empty document with the origin and the policies of
//! the page.

use std::rc::Rc;

use bun_jsc::webcore_types::Blob as JsBlob;
use bun_web::convert::{blob_from_js, resolve_blob_url};
use bun_web::net::body::Blob;
use bun_web::runtime::{create_blob, create_file};
use bun_web::url::Url;

use super::embedder::{Embedder, embedder, holder};
use super::engine::{self, Order};
use super::remote::{Emitted, Remote, Role, field, is_about_main_frame, is_prevented};
use super::view::{Painted, View};
use super::{input, wire};

use crate::generated_bindgen::webview::{
    SurfaceEvent, js_WebEngineFrameControls as controls, js_WebEngineRemote as fields,
};
use crate::ports::{self, Carrier};
use crate::prelude::*;
use crate::realm;
use crate::session::Session;
use crate::task::{Later, Sequence};
use crate::text::{contains, encode_component, escape_html, origin_of, split, split_once};
use crate::value::Value;
use bun_ui::protocol::SHIFT;

#[derive(Default)]
pub(super) struct Embedded {
    is_ready: Later<()>,
    outbox: Sequence,
    has_crashed: Cell<bool>,
    has_painted: Cell<bool>,
    style: RefCell<Option<(bool, String)>>,
}

/// Without what the page does not have, or may not delegate.
fn restrict(allow: &str, page: &dyn Embedder) -> String {
    let policy = page.permissions_policy();
    let is_in_name = |it: char| it.is_ascii_alphanumeric() || matches!(it, '-' | '_');
    let lists: Vec<(&str, &str)> = (split(&policy, ")").filter_map(|it| split_once(it, "=(")))
        .map(|(before, list)| (&before[before.trim_end_matches(is_in_name).len()..], list))
        .collect();
    let name_of = |directive: &str| {
        directive
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_owned()
    };
    let mut kept: Vec<String> = split(allow, ";")
        .filter(|it| lists.iter().all(|list| list.0 != name_of(it)))
        .filter(|it| page.has_feature(&name_of(it)))
        .map(str::to_owned)
        .collect();
    for (name, list) in &lists {
        let asked = split(allow, ";").filter(|it| name_of(it) == *name).last();
        let wanted = asked.map(|it| {
            it.split_whitespace()
                .skip(1)
                .filter(|it| *it != "'src'")
                .collect::<Vec<_>>()
        });
        let is_granted = |origin: &&str| {
            wanted
                .as_ref()
                .is_some_and(|it| it.is_empty() || it.contains(&"*") || it.contains(origin))
        };
        let granted: Vec<&str> = split(list, "\"")
            .skip(1)
            .step_by(2)
            .filter(is_granted)
            .collect();
        kept.push(format!(
            "{name} {}",
            if granted.is_empty() {
                "'none'".to_owned()
            } else {
                granted.join(" ")
            }
        ));
    }
    kept.join(";")
}

/// What the attribute allows of what the page is allowed.
fn confine(attribute: Option<&str>, page: &dyn Embedder) -> Option<String> {
    let Some(mut flags) = page.sandbox_flags() else {
        return attribute.map(str::to_owned);
    };
    flags.retain(|flag| {
        attribute.is_none_or(|it| {
            it.split_whitespace()
                .any(|it| it.eq_ignore_ascii_case(flag))
        })
    });
    Some(flags.join(" "))
}

/// Its first item is the index in `blobs`, until the bytes have been read.
fn handle_of(blob: Blob, file: [Value; 2], blobs: &RefCell<Vec<Blob>>) -> Vec<Value> {
    let (index, mime, [name, modified]) = (blobs.borrow().len(), string(&blob.mime), file);
    blobs.borrow_mut().push(blob);
    vec![
        Value::Bytes(None, index.to_ne_bytes().into()),
        mime.into(),
        name,
        modified,
    ]
}

fn fill_handles(value: &mut Value, contents: &[Rc<[u8]>]) {
    match value {
        Value::Handle(handle) => {
            if let Some(Value::Bytes(_, bytes)) = handle.first_mut()
                && let Some(read) = bytes
                    .first_chunk()
                    .and_then(|it| contents.get(usize::from_ne_bytes(*it)))
            {
                *bytes = Rc::clone(read);
            }
        }
        Value::List(items) | Value::Set(items) => {
            items.iter_mut().for_each(|it| fill_handles(it, contents))
        }
        Value::Record(pairs) | Value::Map(pairs) => {
            pairs
                .iter_mut()
                .flat_map(|it| [&mut it.0, &mut it.1])
                .for_each(|it| fill_handles(it, contents));
        }
        Value::Shared(_, it) => fill_handles(it, contents),
        _ => {}
    }
}

fn to_blob(handle: &[Value]) -> JsResult<JSValue> {
    let [bytes, mime, name, modified] = handle else {
        return Ok(JSValue::UNDEFINED);
    };
    let (bytes, mime) = (
        bytes.as_bytes().map(|it| it.to_vec()).unwrap_or_default(),
        mime.text().as_bytes(),
    );
    Ok(match name {
        Value::Undefined => create_blob(global(), bytes, mime),
        name => create_file(
            global(),
            bytes,
            name.display().as_bytes(),
            mime,
            modified.number(),
        ),
    })
}

fn create(object: JSValue, element: JSValue, deliver: JSValue) -> JsResult<&'static Remote> {
    let page = embedder(object);
    let (contents, state) = (page.web_contents()?, page.holder());
    let (engine, session) = Session::of(contents)?.link()?;
    let view = View::new(
        &engine,
        holder(state).surface_of_window(),
        [300., 150.],
        invoke(element, "scale", &[])?.to_number(global())?,
        true,
    )?;
    let remote = Remote::create(
        contents,
        state,
        view,
        session,
        Role::Frame(Embedded::default()),
    )?;
    fields::set_page(remote, object);
    fields::set_element(remote, element);
    fields::set_deliver(remote, deliver);
    fields::set_embedder(remote, page.frame()?);
    let (given, mut preferences) = (holder(state).preferences(), Value::empty());
    for name in [
        "images",
        "webSecurity",
        "spellcheck",
        "plugins",
        "autoplayPolicy",
        "disableDialogs",
        "javascript",
    ] {
        preferences.set(name, wire::data_from_js(get(given, name)?)?);
    }
    engine.send(Order::Create(remote.view.describe(session, preferences)));
    remote.apply_settings(&|method, values| {
        if !contains(method, "Zoom") && !contains(method, "Emulation") {
            remote.view.tell_page(method, values);
        }
    })?;
    remote.view.tell_page("setZoomMode", list!["isolated"]);
    let send = listener(remote, |it, given| it.send_packet(argument(given, 0)))?;
    let receive = listener(remote, |it, given| {
        it.deliver(argument(given, 0), argument(given, 1))
    })?;
    fields::set_carrier(remote, Some(Carrier::create(send, 0, receive)));

    let meta =
        |name: &str, value: &str| format!("<meta {name} content=\"{}\">", escape_html(value));
    let policies = page.security_policies();
    let mut head: String = policies
        .iter()
        .map(|it| meta("http-equiv=Content-Security-Policy", it))
        .collect();
    if !page.referrer_policy().is_empty() {
        head += &meta("name=referrer", &string(page.referrer_policy()));
    }
    let (url, origin) = (page.url()?, page.origin()?);
    let base = (origin != "null").then(|| {
        if url.starts_with("about:") {
            origin + "/"
        } else {
            url
        }
    });
    let empty = format!(
        "data:text/html,{}",
        encode_component(&format!("<!doctype html>{head}<body>"))
    );
    remote.view.tell_page(
        "loadURL",
        list![
            empty,
            record! { "baseURLForDataURL": base, "isLocal": true }
        ],
    );
    Ok(remote)
}

impl Embedded {
    pub(super) fn painted(&self, remote: &Remote, painted: &Painted) -> JsResult<()> {
        if !self.has_painted.replace(true) {
            return remote.tell_element("painted", &[js(remote.view.image)?]);
        }
        if !remote.holder().is_mirrored() {
            return Ok(());
        }
        let changed = match painted.area {
            Some([x, y, width, height]) => {
                let [left, top, across, down] = remote
                    .numbers_of_element("box")?
                    .map(|it| it * remote.view.zoom.get());
                let [by_x, by_y] = [across / painted.size[0], down / painted.size[1]];
                object!({
                    "x": left + x * by_x - 1., "y": top + y * by_y - 1., "width": width * by_x + 2., "height": height * by_y + 2.,
                })
            }
            None => object!({}),
        };
        (remote.holder()).mirror(invoke(remote.element(), "scale", &[])?, changed)
    }

    pub(super) fn emit(&self, remote: &Remote, mut emitted: Emitted) -> JsResult<bool> {
        let name = &*emitted.name;
        match name {
            "will-navigate" => {
                return emitted.with(|_, event, _| {
                    let event = event.map_or(JSValue::UNDEFINED, JsInterface::to_js);
                    let (url, frame) = (text_of(get(event, "url")?)?, get(event, "initiator")?);
                    remote.holder().navigate_from(&url, frame).map(|()| true)
                });
            }
            "render-process-gone" => return self.crashed(remote).map(|()| false),
            "enter-html-full-screen" | "leave-html-full-screen" => {
                remote.holder().allow_fullscreen();
                return remote
                    .tell_element("fullscreen", &[name.starts_with("enter").into()])
                    .map(|()| false);
            }
            _ => {}
        }
        let has_prefix = |prefixes: &[&str]| prefixes.iter().any(|it| name.starts_with(it));
        let is_wanted = match name {
            "frame-created" => {
                matches!(&emitted.argument(0)["frame"], Value::Handle(it) if it[1]["parent"].is_truthy())
            }
            "will-frame-navigate"
            | "will-redirect"
            | "did-navigate-in-page"
            | "did-start-navigation"
            | "did-redirect-navigation" => !is_about_main_frame(&emitted),
            _ if has_prefix(&["did-frame-", "did-fail-"]) => !is_about_main_frame(&emitted),
            "certificate-error"
            | "console-message"
            | "context-menu"
            | "login"
            | "audio-state-changed"
            | "update-target-url" => true,
            _ => has_prefix(&["media-", "select-"]),
        };
        if !is_wanted {
            return Ok(false);
        }
        if let ("context-menu", Some(params)) = (name, emitted.arguments.first_mut()) {
            let [x, y] = remote
                .to_surface(["x", "y"].map(|it| params[it].number() / remote.view.zoom.get()))?;
            params.set("x", x);
            params.set("y", y);
            params.set("pageURL", remote.page().url()?);
        }
        emitted.on(remote.contents(), is_prevented)
    }

    pub(super) fn crashed(&self, remote: &Remote) -> JsResult<()> {
        self.has_crashed.set(true);
        self.has_painted.set(false);
        remote.tell_element("painted", &[0.into()])
    }
}

impl Remote {
    fn embedded(&self) -> Option<&Embedded> {
        match &self.role {
            Role::Frame(frame) => Some(frame),
            Role::Guest(_) => None,
        }
    }

    fn page(&self) -> &'static dyn Embedder {
        embedder(field(fields::page(self)))
    }

    pub(crate) fn element(&self) -> JSValue {
        field(fields::element(self))
    }

    pub(super) fn tell_element(&self, method: &str, arguments: &[JSValue]) -> JsResult<()> {
        match fields::element(self) {
            Some(it) if get(it, method)?.is_callable() => invoke(it, method, arguments).map(drop),
            _ => Ok(()),
        }
    }

    pub(super) fn numbers_of_element<const N: usize>(&self, method: &str) -> JsResult<[f64; N]> {
        let numbers = wire::data_from_js(invoke(self.element(), method, &[])?)?;
        Ok(core::array::from_fn(|it| numbers[it].number()))
    }

    /// Blobs are read asynchronously, and the messages stay in order.
    fn send_with(&self, mut message: Value, blobs: Vec<Blob>) {
        let Some(frame) = self.embedded() else { return };
        let (view, is_ready) = (Rc::clone(&self.view), frame.is_ready.clone());
        frame.outbox.add(async move {
            is_ready.await;
            let mut contents = Vec::new();
            for blob in blobs {
                let Ok(read) = blob.data.open().read_to_end().await else {
                    return;
                };
                contents.push(Rc::from(&*read));
            }
            fill_handles(&mut message, &contents);
            view.engine.send(Order::Frame {
                view: view.id,
                message: wire::encode(&message),
            });
        });
    }

    fn send(&self, message: Value) {
        self.send_with(message, Vec::new());
    }

    fn send_packet(&self, packet: JSValue) -> JsResult<()> {
        let blobs = RefCell::default();
        let packet = wire::from_js(packet, &|it| {
            let Some(blob) = it.as_class_ref::<JsBlob>().and_then(|it| blob_from_js(&it)) else {
                return Ok(None);
            };
            let file = [
                wire::data_from_js(get(it, "name")?)?,
                wire::data_from_js(get(it, "lastModified")?)?,
            ];
            Ok(Some(handle_of(blob, file, &blobs)))
        })?;
        self.send_with(list!["packet", packet], blobs.take());
        Ok(())
    }

    fn deliver(&self, data: JSValue, ports: JSValue) -> JsResult<()> {
        let path: Vec<f64> = wire::data_from_js(get(data, "path")?)?
            .items()
            .iter()
            .map(Value::number)
            .collect();
        let copy = self.page().clone_message(get(data, "message")?)?;
        let origin = js(self.engine().from_engine(&text_of(get(data, "origin")?)?))?;
        let ports: Vec<f64> = elements(ports)?.into_iter().map(ports::park).collect();
        call(
            field(fields::deliver(self)),
            &[copy, origin, js(path)?, js(ports)?],
        )
        .map(drop)
    }

    /// From a process that may have been taken over.
    pub(super) fn receive(&self, bytes: &Value) -> JsResult<()> {
        let (Some(frame), Some(message)) = (self.embedded(), wire::decode_whole(bytes)) else {
            return Ok(());
        };
        let [first, second] = [1, 2].map(|it| message[it].number());
        match message[0].text() {
            "packet" if message[1].is_list() => {
                let accept = || {
                    fields::carrier(self)
                        .map(|it| it.accept(wire::to_js(&message[1], &to_blob)?))
                        .transpose()
                };
                catch(accept()).map(drop)
            }
            "ready" => {
                frame.is_ready.set(());
                Ok(())
            }
            "load" => self.tell_element("loaded", &[js(first)?]),
            "scroll" => self.tell_element("scroll", &[js(first)?, js(second)?]),
            "tab" => self.tell_element("tab", &[js(first)?]),
            "entered" => self
                .view
                .press("Tab", if first < 0. { SHIFT } else { 0 })
                .map(drop),
            _ => Ok(()),
        }
    }

    fn navigate(&self, mut attributes: Value) -> JsResult<()> {
        let (page, source) = (self.page(), attributes["src"].text().to_owned());
        attributes.set("src", self.engine().to_engine(&source));
        attributes.set("allow", restrict(attributes["allow"].text(), page));
        if let Some(sandbox) = confine(attributes["sandbox"].as_text(), page) {
            attributes.set("sandbox", sandbox);
        }
        let is_own_blob = source.starts_with("blob:") && origin_of(&source) == page.origin()?;
        let blob = Url::parse(source.as_bytes())
            .filter(|_| is_own_blob)
            .and_then(|it| resolve_blob_url(&it));
        let blobs = RefCell::default();
        let blob = blob.map(|it| Value::Handle(handle_of(it, Default::default(), &blobs)));
        self.send_with(list!["navigate", attributes, blob], blobs.take());
        Ok(())
    }

    fn place(&self, it: &Placement) {
        if self.view.zoom.replace(it.zoom) != it.zoom {
            self.view.tell_page("setZoomFactor", list![it.zoom]);
        }
        self.view.shown_at.set(it.zoom * self.view.scale);
        self.view.resize(it.size.map(|length| length * it.zoom));
        self.view.set_visible(it.is_visible);
        let style = Some((
            it.size[0] != 0. && it.size[1] != 0.,
            it.color_scheme.clone(),
        ));
        if self
            .embedded()
            .is_some_and(|frame| frame.style.replace(style.clone()) != style)
        {
            let display = if style.is_some_and(|it| it.0) {
                ""
            } else {
                "none"
            };
            self.send(list![
                "style",
                record! { "display": display, "colorScheme": &*it.color_scheme }
            ]);
        }
    }
}

struct Placement {
    size: [f64; 2],
    is_visible: bool,
    color_scheme: String,
    zoom: f64,
}

fn change(set: Option<JSValue>, method: &str, member: JSValue) -> JsResult<()> {
    set.map_or(Ok(()), |it| invoke(it, method, &[member]).map(drop))
}

#[derive(Default)]
pub(crate) struct Controls {
    placement: RefCell<Option<Placement>>,
    is_disposed: Cell<bool>,
}

impl Controls {
    /// `page` is an [`Embedder`].
    pub(crate) fn create(
        page: JSValue,
        element: JSValue,
        deliver: JSValue,
    ) -> JsResult<&'static Controls> {
        let created = controls::create(heap(), Controls::default());
        controls::set_page(created, page);

        controls::set_element(created, element);
        controls::set_deliver(created, deliver);
        let dispose = listener(created, |it, _| it.end())?;
        controls::set_dispose(created, dispose);
        change(created.page().cleanups()?, "add", dispose)?;
        Ok(created)
    }

    fn page(&self) -> &'static dyn Embedder {
        embedder(field(controls::page(self)))
    }

    fn add_frame(&self) -> JsResult<&Remote> {
        let frame = create(
            field(controls::page(self)),
            field(controls::element(self)),
            field(controls::deliver(self)),
        )?;
        controls::set_frame(self, Some(frame));
        change(self.page().frames()?, "add", frame.to_js())?;
        Ok(frame)
    }

    /// False if there is none.
    fn remove_frame(&self) -> JsResult<bool> {
        let Some(frame) = controls::frame(self) else {
            return Ok(false);
        };
        controls::set_frame(self, None);
        change(self.page().frames()?, "delete", frame.to_js())?;
        frame.end().map(|()| true)
    }

    fn changed(&self) -> JsResult<()> {
        holder(self.page().holder()).frames_changed()
    }

    fn end(&self) -> JsResult<()> {
        self.is_disposed.set(true);
        change(
            self.page().cleanups()?,
            "delete",
            field(controls::dispose(self)),
        )?;
        if self.remove_frame()? {
            self.changed()
        } else {
            Ok(())
        }
    }

    fn refuse(&self, url: &str, reason: &str) -> JsResult<()> {
        (self.page()).log_error(&format!("Refused to frame {url} because {reason}"))?;
        let it = Root::new(self);
        post(Priority::Visible, move || {
            match it.get().page().is_disposed() {
                true => Ok(()),
                false => {
                    invoke(field(controls::element(it.get())), "loaded", &[0.into()]).map(drop)
                }
            }
        });
        Ok(())
    }

    pub(crate) fn navigate<'a>(
        &self,
        _: Cx<'a, '_>,
        attributes: JsLocal<'a, JSObject>,
    ) -> JsResult<()> {
        if self.is_disposed.get() {
            return Ok(());
        }
        let attributes = wire::data_from_js(attributes.to_js())?;
        if controls::frame(self)
            .and_then(Remote::embedded)
            .is_some_and(|it| it.has_crashed.get())
        {
            self.remove_frame()?;
        }
        if let Some(frame) = controls::frame(self) {
            return frame.navigate(attributes);
        }
        let source = attributes["src"].text();
        let has_markup = !matches!(attributes["srcdoc"], Value::Undefined);
        if !has_markup && !self.page().may_frame(source) {
            return self.refuse(source, "it violates the Content Security Policy");
        }
        if !engine::is_available()? {
            return self.refuse(source, "there is no web engine");
        }
        let frame = self.add_frame()?;
        if let Some(placement) = &*self.placement.borrow() {
            frame.place(placement);
        }
        self.changed()?;
        frame.navigate(attributes)
    }

    /// The frame is `window.opener` to the page that `guest` is for.
    pub(crate) fn open_popup(&self, guest: &Remote, url: &str, name: &str) -> JsResult<()> {
        let frame = self.add_frame()?;
        fields::set_popup(frame, Some(guest));
        frame.view.set_visible(false);
        frame.send(list!["open", frame.engine().to_engine(url), name]);
        invoke(
            guest.contents(),
            "once",
            &[js("destroyed")?, field(controls::dispose(self))],
        )
        .map(drop)
    }

    pub(crate) fn attribute(
        &self,
        _: Cx<'_, '_>,
        name: &[u8],
        value: Option<&[u8]>,
    ) -> JsResult<()> {
        let (Some(frame), value) = (controls::frame(self), value.map(string)) else {
            return Ok(());
        };
        let value = match name {
            b"allow" => Some(restrict(&value.unwrap_or_default(), self.page())),
            b"sandbox" => confine(value.as_deref(), self.page()),
            _ => value,
        };
        frame.send(list![
            "attribute",
            string(name),
            value.map_or(Value::Null, Value::from)
        ]);
        Ok(())
    }

    pub(crate) fn location<'a>(
        &self,
        _: Cx<'a, '_>,
        path: JsLocal<'a, JSObject>,
        method: &[u8],
        url: &[u8],
    ) -> JsResult<()> {
        let Some(frame) = controls::frame(self) else {
            return Ok(());
        };
        let (path, url) = (
            wire::data_from_js(path.to_js())?,
            frame.engine().to_engine(&string(url)),
        );
        frame.send(list!["location", path, string(method), url]);
        Ok(())
    }

    pub(crate) fn post<'a>(
        &self,
        _: Cx<'a, '_>,
        path: JsLocal<'a, JSObject>,
        envelope: JsLocal<'a, JSObject>,
        target_origin: &[u8],
    ) -> JsResult<()> {
        let opened = bun_web::dom::open_envelope(realm::peek(envelope.to_js()));
        let Some((frame, opened)) = controls::frame(self).zip(opened) else {
            return Ok(());
        };
        let (message, ports) = opened.open(global())?;
        let ports = ports::wrap_all(ports)?;
        let target_origin = frame.engine().to_engine(&string(target_origin));
        let data =
            object!({ "path": path.to_js(), "message": message, "targetOrigin": target_origin });
        fields::carrier(frame).map_or(Ok(()), |it| it.post(0, data, ports))
    }

    pub(crate) fn place(
        &self,
        _: Cx<'_, '_>,
        width: f64,
        height: f64,
        is_visible: bool,
        color_scheme: &[u8],
        zoom: f64,
    ) -> JsResult<()> {
        let placement = Placement {
            size: [width, height],
            is_visible,
            color_scheme: string(color_scheme),
            zoom,
        };
        if let Some(it) = controls::frame(self) {
            it.place(&placement);
        }
        self.placement.replace(Some(placement));
        Ok(())
    }

    pub(crate) fn input<'a>(&self, _: Cx<'a, '_>, event: JsLocal<'a, JSObject>) -> JsResult<()> {
        let Some(frame) = controls::frame(self) else {
            return Ok(());
        };
        let files = get(event.to_js(), "paths")?;
        if !files.is_undefined_or_null() {
            let path_of = |it| self.page().path_of(it);
            let paths = elements(files)?
                .into_iter()
                .map(path_of)
                .collect::<JsResult<Vec<_>>>()?;
            event.to_js().put(global(), b"paths", js(paths)?);
        }
        SurfaceEvent::from_js(global(), event.to_js(), |event| {
            if *event.t == *b"focus" {
                frame.send(list!["focus", event.direction]);
            }
            input::from_script(&event, 1.)?.map_or(Ok(()), |it| frame.view.input(it))
        })
    }

    pub(crate) fn exit_fullscreen(&self) {
        if let Some(it) = controls::frame(self) {
            it.send(list!["exitFullscreen"]);
        }
    }

    pub(crate) fn edit(&self, command: &[u8]) -> bool {
        if let Some(it) = controls::frame(self) {
            it.edit(&string(command));
        }
        true
    }

    pub(crate) fn focused_frame(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        controls::frame(self).map_or(Ok(JSValue::UNDEFINED), Remote::focused_frame)
    }

    pub(crate) fn dispose(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.end()
    }
}
