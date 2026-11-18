//! What `openDevTools()` shows: the frontend that comes with the web engine, connected to the sessions of this process.

use core::cell::OnceCell;
use std::rc::{Rc, Weak};

use bun_jsc::Strong;
use bun_ui::protocol::Clipboard;
use bun_web::headers::HeaderList;

use super::connection::{Client, Connection};
use super::contents::Contents;
use crate::contents;
use crate::generated_bindgen::window::js_DesktopBaseWindow;
use crate::prelude::*;
use crate::session::{self, Session};
use crate::task::{self, Timer};
use crate::value::{Value, quote};
use crate::view::View;
use crate::webview::engine::{self, Engine};
use crate::webview::wire;
use crate::window::{Plan, Window};
use crate::{dialog, files, paths, text};

const BINDING: &str = "toHost";
const ORIGIN: &str = "devtools://devtools";
const BUNDLED: &str = "devtools://devtools/bundled/";
const DOCK_SIDE: &str = "currentDockState";
const MOST_AT_ONCE: usize = 4 << 20;

#[derive(Default)]
struct Shared {
    session: OnceCell<Root<Session>>,
    /// The `preferences` of the frontend, the `bounds` of its window and its `zoom` level.
    settings: RefCell<Option<Value>>,
    saving: RefCell<Option<Timer>>,
}

state!(fn shared() -> Shared);

fn path_of_settings() -> JsResult<String> {
    Ok(files::join(&[&paths::path("userData")?, "DevTools.json"]))
}

fn read_settings() -> JsResult<()> {
    if shared().settings.borrow().is_none() {
        let read = files::read(&path_of_settings()?).and_then(|it| Value::parse(&it));
        let known = record! { "preferences": Value::empty() }.and(&read.unwrap_or_default());
        shared().settings.replace(Some(known));
    }
    Ok(())
}

fn with_settings<T>(act: impl FnOnce(&mut Value) -> T) -> JsResult<T> {
    read_settings()?;
    Ok(act(shared().settings.borrow_mut().get_or_insert_default()))
}

fn save_settings() -> JsResult<()> {
    if shared().saving.take().is_some() {
        let json = with_settings(|it| it.to_json())?;
        let _ = files::write(&path_of_settings()?, json.as_bytes(), 0o600);
    }
    Ok(())
}

fn change_settings(change: impl FnOnce(&mut Value)) -> JsResult<()> {
    with_settings(change)?;
    (shared().saving.borrow_mut())
        .get_or_insert_with(|| Timer::new(1000, || task::report(save_settings())));
    Ok(())
}

fn change_preferences(change: impl FnOnce(&mut Value)) -> JsResult<()> {
    change_settings(|it| {
        let mut preferences = it.take("preferences");
        change(&mut preferences);
        it.set("preferences", preferences);
    })
}

/// It stores nothing and reaches nothing.
fn secluded_session() -> JsResult<&'static Session> {
    if let Some(known) = shared().session.get() {
        return Ok(known.get());
    }
    let session = session::from_partition(&format!("devtools-{}", text::random_uuid()))?;
    let refuse =
        procedure(|given| call(argument(given, 1), &[object!({ "cancel": true })]).map(drop))?;
    let urls = ["http", "https", "ws", "wss", "ftp"].map(|it| format!("{it}://*/*"));
    let urls = urls.into_iter().chain(["file:///*".to_owned()]);
    let filter = record! { "urls": urls.collect::<Value>() };
    let requests = get(session.to_js(), "webRequest")?;
    invoke(requests, "onBeforeRequest", &[js(&filter)?, refuse])?;
    Ok(shared().session.get_or_init(|| Root::new(session)).get())
}

pub(crate) struct Frontend {
    inspected: Contents,
    contents: Contents,
    /// Unless the app shows the contents itself.
    view: Option<Root<View>>,
    window: RefCell<Option<Root<Window>>>,
    connection: RefCell<Option<Rc<Connection>>>,
    link: OnceCell<(Rc<Engine>, Rc<str>)>,
    /// Where the frontend runs: the number, which other processes use too, and the unique id.
    context: RefCell<Option<(i32, String)>>,
    /// The emitter, the event and the function.
    listeners: RefCell<Vec<[Strong; 3]>>,
    outbox: RefCell<String>,
    can_dock: bool,
    takes_focus: Cell<bool>,
    is_loaded: Cell<bool>,
    is_closed: Cell<bool>,
    title: RefCell<Option<String>>,
    /// The URLs, and where the user wanted them.
    saved: RefCell<Vec<(String, String)>>,
    to_reveal: Cell<Option<[f64; 2]>>,
}

impl Frontend {
    /// `shown_in` is what `setDevToolsWebContents()` got.
    pub(crate) fn open(
        inspected: &contents::Contents,
        shown_in: Option<&contents::Contents>,
        options: &Value,
        panel: Option<&str>,
    ) -> JsResult<Option<Rc<Frontend>>> {
        if !engine::is_available()? {
            warn(
                "openDevTools() shows the developer tools of Electron, Chrome, Edge or Chromium, and none of them was found. See app.setWebEngine().",
            )?;
            return Ok(None);
        }
        let mode = options["mode"].text();
        let can_dock = shown_in.is_none() && mode != "detach" && inspected.view().is_some();
        if matches!(mode, "left" | "right" | "bottom" | "undocked") {
            change_preferences(|it| it.set(DOCK_SIDE, quote(mode)))?;
        }
        let view = match shown_in {
            Some(_) => None,
            None => Some(View::for_dev_tools(object!({
                "webEngine": true,
                "session": secluded_session()?.to_js(),
                "spellcheck": false,
                "devTools": false,
            }))?),
        };
        let own = view.and_then(|it| cast(it.contents()?));
        let frontend = Rc::new(Frontend {
            inspected: Contents::new(inspected),
            contents: Contents::new(shown_in.or(own).expect("one of them is there")),
            view: view.map(Root::new),
            window: RefCell::default(),
            connection: RefCell::default(),
            link: OnceCell::new(),
            context: RefCell::default(),
            listeners: RefCell::default(),
            outbox: RefCell::default(),
            can_dock,
            takes_focus: (!matches!(options["activate"], Value::Bool(false))).into(),
            is_loaded: Cell::default(),
            is_closed: Cell::default(),
            title: (options["title"].as_text().filter(|it| !it.is_empty()))
                .map(String::from)
                .into(),
            saved: RefCell::default(),
            to_reveal: Cell::default(),
        });
        if inspected.is_destroyed() || frontend.contents.is_destroyed() {
            return frontend.close().map(|()| None);
        }
        frontend.contents.set_inspects(Some(inspected));
        frontend.connect()?;
        frontend.watch_contents()?;
        let panel = panel.map(|it| format!("panel={it}"));
        let query = [can_dock.then_some("can_dock=true"), panel.as_deref()];
        let query = query.into_iter().flatten().collect::<Vec<_>>().join("&");
        let mark = if query.is_empty() { "" } else { "?" };
        let url = format!("{BUNDLED}devtools_app.html{mark}{query}");
        let this = Rc::clone(&frontend);
        let load = async move {
            let is_done = this.is_closed.get() || matches!(this.load(url).await, Ok(true));
            if !is_done && !this.is_closed.get() {
                task::report(warn("The web engine could not show its developer tools"));
                task::report(this.inspected.end_dev_tools());
            }
        };
        later::soon(move |_| {
            task::spawn(load);
            Ok(())
        });
        Ok(Some(frontend))
    }

    fn connect(self: &Rc<Self>) -> JsResult<()> {
        self.connection.take().map_or(Ok(()), |it| it.close())?;
        self.outbox.take();
        let this = Rc::downgrade(self);
        let send = move |json: String| this.upgrade().map_or((), |it| it.post(&json));
        let target = Some(self.inspected.clone());
        let connection = Connection::new(Box::new(send), Client::Person, target)?;
        self.connection.replace(Some(connection));
        Ok(())
    }

    fn on(
        self: &Rc<Self>,
        emitter: JSValue,
        event: &str,
        act: fn(&Frontend, &[JSValue]) -> JsResult<()>,
    ) -> JsResult<()> {
        let this = Rc::downgrade(self);
        let listener = procedure(move |given| match this.upgrade() {
            Some(this) if !this.is_closed.get() => act(&this, given),
            _ => Ok(()),
        })?;
        let event = js(event)?;
        (self.listeners.borrow_mut()).push([emitter, event, listener].map(keep));
        invoke(emitter, "on", &[event, listener]).map(drop)
    }

    fn watch_contents(self: &Rc<Self>) -> JsResult<()> {
        let contents = self.contents.object();
        for event in ["destroyed", "render-process-gone"] {
            self.on(contents, event, |it, _| it.inspected.end_dev_tools())?;
        }
        self.on(contents, "focus", |it, _| {
            it.announce("devtools-focused", &[])
        })?;
        self.on(contents, "will-navigate", |_, given| {
            match text_of(argument(given, 1))?.starts_with(BUNDLED) {
                true => Ok(()),
                false => invoke(argument(given, 0), "preventDefault", &[]).map(drop),
            }
        })?;
        if self.view.is_none() {
            return Ok(());
        }
        let deny = function(JSValue::UNDEFINED, |_, _| Ok(object!({ "action": "deny" })))?;
        invoke(contents, "setWindowOpenHandler", &[deny]).map(drop)
    }

    async fn load(self: &Rc<Self>, url: String) -> JsResult<bool> {
        let guest = Root::new(self.contents.guest_at_any_rate()?);
        let blank = self.contents.invoke("loadURL", &[js("about:blank")?]);
        if task::outcome(blank).await.is_err() {
            return Ok(false);
        }
        let Some([session, frame]) = guest.get().start_session().await else {
            return Ok(false);
        };
        let (engine, this) = (Rc::clone(guest.get().engine()), Rc::downgrade(self));
        let hear = move |method: &str, params: &Value| match (method, Weak::upgrade(&this)) {
            ("Runtime.executionContextCreated", Some(this)) => {
                let (it, data) = (&params["context"], &params["context"]["auxData"]);
                if data["frameId"].is(&frame) && data["isDefault"].is_truthy() {
                    let ids = || (it["id"].int(), it["uniqueId"].text().to_owned());
                    this.context.replace(it["origin"].is(ORIGIN).then(ids));
                }
                Ok(())
            }
            ("Runtime.executionContextsCleared", Some(this)) => {
                this.context.take();
                Ok(())
            }
            ("Runtime.bindingCalled", Some(this))
                if this.runs_in(params["executionContextId"].int()) =>
            {
                this.receive(params["payload"].text())
            }
            _ => Ok(()),
        };
        engine.listen(&session, Rc::new(hear));
        let platform = match () {
            () if IS_MAC => "mac",
            () if cfg!(windows) => "windows",
            () => "linux",
        };
        let source = format!(
            "({})('{BINDING}', '{platform}')",
            include_str!("frontend.js")
        );
        engine.command("Runtime.enable", Value::empty(), &session);
        engine.command("Page.enable", Value::empty(), &session);
        engine.command("Runtime.addBinding", record! { "name": BINDING }, &session);
        let script = record! { "source": source };
        let added = engine.inspect("Page.addScriptToEvaluateOnNewDocument", script, &session);
        self.link.get_or_init(|| (engine, session));
        if added.await.is_err() || self.is_closed.get() {
            return Ok(false);
        }
        let loaded = self.contents.invoke("loadURL", &[js(url)?]);
        Ok(task::outcome(loaded).await.is_ok())
    }

    fn runs_in(&self, context: i32) -> bool {
        (self.context.borrow().as_ref()).is_some_and(|it| it.0 == context)
    }

    /// A message of the protocol, or a list: what to call and its arguments.
    fn post(self: &Rc<Self>, json: &str) {
        let mut outbox = self.outbox.borrow_mut();
        let was_empty = outbox.is_empty();
        outbox.extend([if was_empty { "[" } else { "," }, json]);
        let is_full = outbox.len() > MOST_AT_ONCE;
        drop(outbox);
        if is_full {
            self.flush();
        } else if was_empty {
            let this = Rc::clone(self);
            later::soon(move |_| {
                this.flush();
                Ok(())
            });
        }
    }

    fn flush(&self) {
        let (all, context) = (self.outbox.take(), self.context.borrow().clone());
        if let (Some((engine, session)), Some((_, context))) = (self.link.get(), context)
            && !all.is_empty()
        {
            let expression = format!("{BINDING}Receive({})", quote(&(all + "]")));
            let params =
                record! { "expression": expression, "uniqueContextId": context, "silent": true };
            self.contents.guest().inspect(|it| it.wake());
            engine.command("Runtime.evaluate", params, session);
        }
    }

    pub(crate) fn tell(self: &Rc<Self>, call: &Value) {
        self.post(&call.to_json());
    }

    fn announce(&self, event: &str, arguments: &[JSValue]) -> JsResult<()> {
        announce(self.inspected.object(), event, arguments)
    }

    fn receive(self: &Rc<Self>, payload: &str) -> JsResult<()> {
        if self.is_closed.get() {
            return Ok(());
        }
        if payload.starts_with('{') {
            let connection = self.connection.borrow().clone();
            connection.inspect(|it| it.receive(payload.as_bytes()));
            return Ok(());
        }
        let message = Value::parse(payload.as_bytes()).unwrap_or_default();
        let (id, method, given) = (message[0].int(), message[1].text(), &message[2]);
        if method == "loadNetworkResource" {
            task::spawn(Rc::clone(self).load_resource(id, given.clone()));
            return Ok(());
        }
        let answer = self.obey(method, given)?;
        if id != 0 {
            self.tell(&list![id, answer]);
        }
        Ok(())
    }

    fn obey(self: &Rc<Self>, method: &str, given: &Value) -> JsResult<Value> {
        let first = given[0].text();
        match method {
            "getPreferences" => return with_settings(|it| it["preferences"].clone()),
            "getPreference" => return with_settings(|it| it["preferences"][first].clone()),
            "setPreference" => change_preferences(|it| it.set(first, &given[1]))?,
            "removePreference" => change_preferences(|it| drop(it.take(first)))?,
            "clearPreferences" => change_preferences(|it| *it = Value::empty())?,
            "getHostConfig" => return Ok(Value::empty()),
            "getSyncInformation" => {
                return Ok(record! { "isSyncActive": false, "arePreferencesSynced": false });
            }
            "loadCompleted" => self.loaded()?,
            "reattach" => self.connect()?,
            "setIsDocked" => self.show(given[0].is_truthy() && self.can_dock)?,
            "setInspectedPageBounds" => self.make_room(&given[0])?,
            "closeWindow" => {
                let inspected = self.inspected.clone();
                later::soon(move |_| inspected.end_dev_tools());
            }
            "bringToFront" => self.contents.bring_to_front()?,
            "inspectElementCompleted" => self.contents.bring_to_front()?,
            "inspectedURLChanged" if self.title.borrow().is_none() => {
                self.name_window(format!("Developer Tools - {first}"))?;
            }
            "copyText" => {
                let contents = Clipboard {
                    text: Maybe::Yes(first.into()),
                    ..Clipboard::default()
                };
                bun_ui::clipboard::write(global(), contents, false)?;
            }
            "openInNewTab" => self.announce("devtools-open-url", &[js(first)?])?,
            "openSearchResultsInNewTab" => self.announce("devtools-search-query", &[js(first)?])?,
            "save" => task::spawn(Rc::clone(self).save(given.clone())),
            "append" => self.append(first, given[1].text()),
            "zoomIn" => self.zoom(|it| it + 0.5)?,
            "zoomOut" => self.zoom(|it| it - 0.5)?,
            "resetZoom" => self.zoom(|_| 0.)?,
            _ => return Ok(record! { "error": "Not supported", "statusCode": 404 }),
        }
        Ok(Value::Undefined)
    }

    fn loaded(self: &Rc<Self>) -> JsResult<()> {
        self.zoom(|it| it)?;
        if !self.can_dock {
            self.show(false)?;
        }
        if self.is_loaded.replace(true) {
            return Ok(());
        }
        self.to_reveal
            .take()
            .inspect(|it| self.reveal_element_at(*it));
        self.announce("devtools-opened", &[])
    }

    fn show(self: &Rc<Self>, is_docked: bool) -> JsResult<()> {
        let Some(view) = self.view.as_ref().map(Root::get) else {
            return Ok(());
        };
        let host = self.inspected.view();
        if is_docked {
            self.leave_window()?;
            host.map_or(Ok(()), |it| it.dock(Some(view)))?;
        } else if self.window.borrow().is_none() {
            host.map_or(Ok(()), |it| it.dock(None))?;
            self.enter_window(view)?;
        }
        match self.takes_focus.replace(true) {
            true => self.contents.bring_to_front(),
            false => Ok(()),
        }
    }

    fn enter_window(self: &Rc<Self>, view: &View) -> JsResult<()> {
        let bounds = with_settings(|it| it["bounds"].clone())?;
        let bounds = ["x", "y", "width", "height"].map(|it| bounds[it].as_number().map(finite));
        let plan = Plan::for_dev_tools(self.title()?, bounds, self.takes_focus.get());
        let window = Window::open(plan, |it| js_DesktopBaseWindow::create(heap(), it))?;
        self.window.replace(Some(Root::new(window)));
        window.show_view(view)?;
        for event in ["move", "resize"] {
            self.on(window.to_js(), event, |it, _| it.remember_bounds())?;
        }
        self.on(window.to_js(), "closed", |it, _| match it.window.take() {
            Some(_) => it.inspected.end_dev_tools(),
            None => Ok(()),
        })
    }

    fn remember_bounds(&self) -> JsResult<()> {
        let Some(window) = self.own_window() else {
            return Ok(());
        };
        let it = window.bounds()?;
        let bounds = record! { "x": it.x, "y": it.y, "width": it.width, "height": it.height };
        change_settings(|it| it.set("bounds", bounds))
    }

    fn leave_window(&self) -> JsResult<()> {
        let Some(window) = self.window.take() else {
            return Ok(());
        };
        window.get().show_view(View::create())?;
        window.get().destroy_now()
    }

    fn own_window(&self) -> Option<&'static Window> {
        self.window.borrow().as_ref().map(Root::get)
    }

    fn make_room(&self, it: &Value) -> JsResult<()> {
        let [x, y, width, height] =
            ["x", "y", "width", "height"].map(|name| finite(it[name].number()));
        let room = Rect {
            x,
            y,
            width,
            height,
        };
        self.inspected.view().map_or(Ok(()), |it| it.confine(room))
    }

    fn name_window(&self, title: String) -> JsResult<()> {
        self.own_window()
            .map_or(Ok(()), |it| it.change_title(title))
    }

    pub(crate) fn title(&self) -> JsResult<String> {
        let given = self.title.borrow().clone();
        let url = || self.inspected.url_for_app();
        given.map_or_else(|| Ok(format!("Developer Tools - {}", url()?)), Ok)
    }

    pub(crate) fn set_title(&self, title: String) -> JsResult<()> {
        self.title.replace(Some(title.clone()));
        self.name_window(title)
    }

    fn zoom(self: &Rc<Self>, change: fn(f64) -> f64) -> JsResult<()> {
        let before = with_settings(|it| it["zoom"].number())?;
        let level = change(before).clamp(-3., 5.);
        if level != before {
            change_settings(|it| it.set("zoom", level))?;
        }
        self.tell(&list!["zoom", 1.2_f64.powf(level)]);
        self.flush();
        (self.contents.invoke("setZoomLevel", &[js(level)?])).map(drop)
    }

    fn path_chosen_for(&self, url: &str) -> Option<String> {
        (self.saved.borrow().iter()).find_map(|it| (it.0 == url).then(|| it.1.clone()))
    }

    async fn choose_path(&self, url: &str) -> Option<String> {
        let ask = || {
            let options = object!({ "defaultPath": files::name(text::before(url, "?")) });
            invoke(dialog::object(), "showSaveDialog", &[options])
        };
        let chosen = task::outcome(ask()).await.ok()?;
        let chosen = wire::data_from_js(chosen.get()).ok()?;
        let path = Some(chosen["filePath"].text()).filter(|it| !it.is_empty())?;
        self.saved.borrow_mut().retain(|it| it.0 != url);
        self.saved.borrow_mut().push((url.into(), path.into()));
        Some(path.into())
    }

    async fn save(self: Rc<Self>, given: Value) {
        let (url, contents) = (given[0].text(), given[1].text());
        let path = match self.path_chosen_for(url).filter(|_| !given[2].is_truthy()) {
            Some(known) => Some(known),
            None => self.choose_path(url).await,
        };
        let write = |path: &String| match given[3].is_truthy() {
            true => files::write(path, &text::from_base64(contents), 0o666).is_ok(),
            false => files::write(path, contents.as_bytes(), 0o666).is_ok(),
        };
        self.tell(&match path.filter(write) {
            Some(path) => list!["savedURL", url, path],
            None => list!["canceledSaveURL", url],
        });
    }

    fn append(self: &Rc<Self>, url: &str, contents: &str) {
        if let Some(path) = self.path_chosen_for(url) {
            let _ = files::append(&path, contents.as_bytes());
        }
        self.tell(&list!["appendedToURL", url]);
    }

    /// Source maps
    async fn load_resource(self: Rc<Self>, id: i32, given: Value) {
        let (url, stream) = (given[0].text(), &given[2]);
        let loaded = self.inspected.load_whole(url).await;
        let missing = || (404, HeaderList::default(), Vec::new());
        let (status, headers, body) = loaded.unwrap_or_else(missing);
        for chunk in body.chunks(MOST_AT_ONCE / 4 * 3) {
            self.tell(&list!["streamWrite", stream, text::base64(chunk), true]);
        }
        let headers = super::network::record_of(&headers, ", ");
        let result = record! { "statusCode": i32::from(status), "headers": headers };
        self.tell(&list![id, result]);
    }

    pub(crate) fn activate(&self) -> JsResult<()> {
        match self.is_loaded.get() {
            true => self.contents.bring_to_front(),
            false => Ok(()),
        }
    }

    /// In the viewport.
    pub(crate) fn reveal_element_at(&self, point: [f64; 2]) {
        match self.connection.borrow().as_ref() {
            Some(connection) if self.is_loaded.get() => connection.reveal(point),
            _ => self.to_reveal.set(Some(point)),
        }
    }

    pub(crate) fn is_open(&self) -> bool {
        self.is_loaded.get()
    }

    pub(crate) fn contents(&self) -> &contents::Contents {
        &self.contents
    }

    pub(crate) fn close(&self) -> JsResult<()> {
        if self.is_closed.replace(true) {
            return Ok(());
        }
        let had_focus = self.contents.is_focused();
        self.connection.take().map_or(Ok(()), |it| it.close())?;
        if let Some((engine, session)) = self.link.get() {
            engine.ignore(session);
            let params = record! { "sessionId": &**session };
            engine.command("Target.detachFromTarget", params, "");
        }
        self.contents.set_inspects(None);
        for [emitter, event, listener] in self.listeners.take() {
            invoke(emitter.get(), "off", &[event.get(), listener.get()])?;
        }
        if self.view.is_some() {
            self.inspected.view().map_or(Ok(()), |it| it.dock(None))?;
            self.leave_window()?;
            if !self.contents.is_destroyed() {
                self.contents.invoke("destroy", &[])?;
            }
        }
        save_settings()?;
        if had_focus && !self.inspected.is_destroyed() {
            self.inspected.take_focus()?;
        }
        match self.is_loaded.get() {
            true => self.announce("devtools-closed", &[]),
            false => Ok(()),
        }
    }
}
