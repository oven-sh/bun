//! A `WebContents` while its page is in the web engine.

use std::rc::Rc;

use bun_ui::protocol::{Input, SurfaceCommand};
use bun_web::exec::{Either, race};
use bun_web::host::Keystroke;

use super::chromium::to_engine;
use super::debugger::Debugger;
use super::engine::{self, Kind, Order, Target};
use super::input;
use super::remote::{Emitted, Remote, Role, is_about_main_frame, is_prevented};
use super::view::View;
use crate::contents::inspection::News;
use crate::contents::{Contents, Document, Entry, How, Request};
use crate::generated_bindgen::webview::{SurfaceEvent, js_WebEngineRemote as fields};
use crate::prelude::*;
use crate::session::readable;
use crate::task::LocalFuture;
use crate::text::{base64, before, encode_component, origin_of};
use crate::value::Value;
use crate::{ipc, screen, task};

pub(super) struct Guest {
    is_opened_by_page: bool,
    /// How many entries of the history it has started with.
    first_entries: Cell<usize>,
    is_shown: Cell<bool>,
    pub(super) is_destroyed: Cell<bool>,
    last_search: Cell<u32>,
    last_asked_for: RefCell<String>,
    /// The entries of the history around its own.
    before: RefCell<Vec<Rc<Entry>>>,
    after: RefCell<Vec<Rc<Entry>>>,
    /// It shows an empty document in place of the one that has asked for the navigation. The app hears nothing of it.
    stands_in: Cell<bool>,
    /// What the engine has said about the page meanwhile.
    withheld: RefCell<Value>,
    /// Until the engine has removed the entry of that document, which is the first of the history.
    has_spare_entry: Cell<bool>,
    relayed: RefCell<Option<Rc<Relayed>>>,
}

/// A navigation that a document in the engine starts.
struct Relayed {
    url: String,
    replaces: bool,
    is_announced: bool,
    has_started: Cell<bool>,
    end: task::Later<()>,
}

/// The document that has asked for a navigation.
pub(crate) struct Source {
    pub(crate) origin: String,
    pub(crate) is_by_user: bool,
    pub(crate) replaces: bool,
    /// The app has had its say.
    pub(crate) is_announced: bool,
}

pub(crate) struct Load<'a> {
    pub(crate) url: &'a str,
    pub(crate) request: &'a Request,
    pub(crate) user_agent: Option<&'a str>,
    pub(crate) base_of_data: Option<&'a str>,
}

pub(crate) fn create(
    contents: &Contents,
    how: How,
    is_opened_by_page: bool,
) -> JsResult<&'static Remote> {
    let (engine, session) = contents.get_session().link()?;
    let (size, scale) = match contents.size() {
        Some(size) => (
            [
                get(size, "width")?.as_number(),
                get(size, "height")?.as_number(),
            ],
            get(size, "scale")?.as_number(),
        ),
        None => ([800., 600.], screen::primary_display()?.scale.into()),
    };
    let view = View::new(&engine, contents.surface(), size, scale, false)?;
    let history = contents.history().borrow();
    let (index, skipped) = match how {
        How::Traverse(index) => (index, 1),
        How::Push => (history.index + 1, usize::MAX),
        How::Replace | How::Reload => (history.index, 1),
    };
    let (before, rest) = history.entries.split_at(index.min(history.entries.len()));
    let guest = Guest {
        is_opened_by_page,
        first_entries: 1.into(),
        is_shown: false.into(),
        is_destroyed: false.into(),
        last_search: 0.into(),
        last_asked_for: Default::default(),
        before: before.to_vec().into(),
        after: rest.get(skipped..).unwrap_or_default().to_vec().into(),
        stands_in: false.into(),
        withheld: Default::default(),
        has_spare_entry: false.into(),
        relayed: Default::default(),
    };
    drop(history);
    let object = contents.to_js();
    let remote = Remote::create(object, object, view, session, Role::Guest(guest))?;
    for handlers in [ipc::main()?, get(object, "ipc")?] {
        engine.send(Order::Handle {
            channels: ipc::channels_of(handlers)?,
        });
    }
    engine.send(if is_opened_by_page {
        Order::Expect(remote.view.id)
    } else {
        Order::Create(remote.describe_guest()?)
    });
    (remote.view.may_rest)
        .set(get(contents.preferences(), "backgroundThrottling")? != JSValue::FALSE);
    remote.apply_settings(&|method, values| remote.apply(method, values))?;
    remote.change_background()?;
    Ok(remote)
}

impl Guest {
    /// What the app gets to know of the state of the page.
    pub(super) fn disclose(&self, mut state: Value) -> Option<Value> {
        if self.stands_in.get() && state["url"].is_truthy() {
            self.withheld.replace(state);
            return None;
        }
        (self.has_spare_entry).update(|it| it && state["entries"].items().len() != 1);
        if self.has_spare_entry.get() {
            let entries = state.take("entries").into_items().into_iter().skip(1);
            state.set("entries", entries.collect::<Value>());
            state.set("index", (state["index"].number() - 1.).max(0.));
        }
        Some(state)
    }

    /// Whether the app hears of it.
    fn follow_relay(&self, remote: &Remote, emitted: &mut Emitted) -> JsResult<bool> {
        let relayed = self.relayed.borrow().clone();
        let name = &*emitted.name;
        let is_about_it =
            |it: &Relayed| is_about_main_frame(emitted) && emitted.argument(0).is(&it.url);
        match (name, &relayed) {
            ("did-start-navigation", Some(it)) if is_about_it(it) => it.has_started.set(true),
            ("will-frame-navigate" | "will-navigate", Some(it))
                if it.is_announced && is_about_it(it) =>
            {
                return Ok(false);
            }
            ("did-stop-loading", Some(it)) if it.has_started.get() => {
                self.end_relay();
                return Ok(true);
            }
            ("render-process-gone", _) => {
                self.end_relay();
                return remote.is_committed();
            }
            _ => {}
        }
        if !self.stands_in.get() {
            return Ok(true);
        }
        let Some(relayed) = relayed.filter(|it| it.has_started.get()) else {
            return Ok(false);
        };
        if name == "navigation-entry-committed" {
            self.stands_in.set(false);
            self.has_spare_entry.set(true);
            remote.update(self.withheld.take())?;
            remote.view.tell_page("navigationHistory.clear", list![]);
            if let Some(replaces) = emitted.arguments.get_mut(2) {
                *replaces = relayed.replaces.into();
            }
        }
        Ok(true)
    }

    pub(super) fn end_relay(&self) {
        self.relayed.take().inspect(|it| it.end.set(()));
    }

    pub(super) fn painted(&self, remote: &Remote) -> JsResult<()> {
        if self.stands_in.get() {
            return Ok(());
        }
        if let Some(listener) = fields::on_frame(remote).filter(|it| it.is_callable()) {
            let bitmap = answer((ui()?.capture)(remote.view.surface, None.into()))?;
            let area = object!({ "x": 0, "y": 0, "width": bitmap.width, "height": bitmap.height });
            call(
                listener,
                &[NativeImage::from_pixels(bitmap).to_js(global()), area],
            )?;
        }
        if self.is_shown.replace(true) {
            Ok(())
        } else {
            announce(remote.contents(), "ready-to-show", &[])
        }
    }

    pub(super) fn update(&self, remote: &Remote) -> JsResult<()> {
        let mirrored = (remote.mirrored.borrow()).pick(&["zoomLevel", "entries", "index"]);
        (remote.view.zoom).set(1.2f64.powf(mirrored["zoomLevel"].number()));
        let own = &mirrored["entries"];
        if !own[0]["url"].is_truthy() || !remote.is_committed()? {
            return Ok(());
        }
        if own.items().len() != self.first_entries.get() {
            self.after.take();
        }
        let own = own.items().iter().zip(0..).map(|(it, index)| {
            let document = Document::Guest(remote.id(), index);
            Entry::new(it["url"].display(), it["title"].text().to_owned(), document)
        });
        let (before, after) = (self.before.borrow(), self.after.borrow());
        let mut history = remote.host().history().borrow_mut();
        history.entries = (before.iter().cloned().chain(own))
            .chain(after.iter().cloned())
            .collect();
        history.index =
            (before.len() + mirrored["index"].number() as usize).min(history.entries.len() - 1);
        Ok(())
    }

    pub(super) fn emit(&self, remote: &Remote, mut emitted: Emitted) -> JsResult<bool> {
        if !self.follow_relay(remote, &mut emitted)? {
            return Ok(false);
        }
        let name = &*emitted.name;
        match name {
            "ready-to-show" => return Ok(false),
            "did-frame-navigate" => remote.take_place()?,
            "did-fail-load" if emitted.argument(0).int() != -3 => remote.take_place()?,
            "dom-ready" if remote.main_frame()?.is_object() => {
                emit(remote.main_frame()?, name, &[])?
            }
            "did-start-loading" => {
                return remote.host().guest_is_loading(remote, true).map(|()| false);
            }
            "did-stop-loading" => {
                remote.view.accessibility_changed();
                return remote
                    .host()
                    .guest_is_loading(remote, false)
                    .map(|()| false);
            }
            "did-start-navigation"
                if emitted.details["isMainFrame"].is_truthy()
                    && remote.host().has_announced_start() =>
            {
                return Ok(false);
            }
            "enter-html-full-screen" | "leave-html-full-screen" => {
                if let Some(window) = remote.window().map(JsInterface::to_js) {
                    invoke(window, "setFullScreen", &[name.starts_with("enter").into()])?;
                    emit(window, name, &[])?;
                }
            }
            _ => {}
        }
        let (is_navigation, host) = (name == "will-navigate", remote.host());
        let may_return = (is_navigation || name == "will-redirect")
            && emitted.details["isMainFrame"].is_truthy();
        let has_arrived = match name {
            "did-navigate" => emitted.argument(1).number() < 300.,
            "did-navigate-in-page" => emitted.argument(1).is_truthy(),
            _ => false,
        };
        let url = emitted.argument(0).clone();
        emitted.on(remote.contents(), |event| {
            if let Some(event) = event.filter(|it| may_return && !it.get_default_prevented()) {
                let initiator = if is_navigation {
                    get(event.to_js(), "initiator")?
                } else {
                    remote.main_frame()?
                };
                if host.take_over(url.display(), initiator, How::Push)? {
                    event.prevent_default();
                }
            }
            if has_arrived && !self.is_destroyed.get() {
                let how = How::Traverse(host.history().borrow().index);
                host.take_over(url.display(), remote.main_frame()?, how)?;
            }
            is_prevented(event)
        })
    }

    pub(super) fn engine_closed(&self, remote: &Remote) -> JsResult<()> {
        let reason = if remote.engine().has_answered.get() {
            "crashed"
        } else {
            "launch-failed"
        };
        let was_shown = remote.is_committed()?;
        remote.end()?;
        remote.host().report_loading()?;
        if was_shown {
            let url = Some(remote.mirrored("url").text().to_owned()).filter(|it| !it.is_empty());
            (remote.host()).has_crashed_at(url.unwrap_or_else(|| self.last_asked_for.take()));
        }
        let gone = Emitted {
            name: "render-process-gone".into(),
            details: Value::empty(),
            arguments: vec![record! { "reason": reason, "exitCode": -1 }],
        };
        gone.on(remote.contents(), |_| Ok(()))
    }
}

impl Remote {
    /// Of a guest.
    pub(super) fn host(&self) -> &'static Contents {
        cast(self.contents()).expect("it was made for one")
    }

    pub(crate) fn id(&self) -> i32 {
        self.view.id
    }

    fn guest(&self) -> Option<&Guest> {
        match &self.role {
            Role::Guest(guest) => Some(guest),
            Role::Frame(_) => None,
        }
    }

    pub(super) fn is_committed(&self) -> JsResult<bool> {
        Ok(self.guest().is_some() && self.host().guest().is_some_and(|it| same(it, self)))
    }

    /// It is in captures, and a dark page only gets its dark canvas if it is opaque.
    fn background(&self) -> JsResult<String> {
        Ok(format!("#{:08x}", self.host().background().rotate_right(8)))
    }

    pub(crate) fn change_background(&self) -> JsResult<()> {
        self.view
            .tell_window("setBackgroundColor", list![self.background()?]);
        Ok(())
    }

    pub(super) fn describe_guest(&self) -> JsResult<Value> {
        let (given, mut preferences) = (self.holder().preferences(), Value::empty());
        for name in texts_of(given.keys(global())?)?
            .iter()
            .filter(|it| !matches!(&***it, "session" | "partition"))
        {
            preferences.set(
                name,
                engine::from_js(get_by_value(global(), given, js(&**name)?)?)?,
            );
        }
        if let Some(preload) = preferences
            .take("preload")
            .as_text()
            .filter(|it| !it.is_empty())
        {
            preferences.set("preload", readable(self.engine(), preload));
        }
        Ok(self
            .view
            .describe(self.session, preferences)
            .with("background", self.background()?))
    }

    fn apply(&self, method: &str, values: Value) {
        let first = values[0].clone();
        self.view.tell_page(method, values);
        match method {
            "setZoomLevel" => self.mirrored.borrow_mut().set("zoomLevel", first),
            "setFrameRate" => self.view.frame_rate.set(first.number()),
            "setBackgroundThrottling" => {
                self.view.may_rest.set(first.is_truthy());
                self.view.wake();
            }
            _ => {}
        }
    }

    /// Of what the `WebContents` shows.
    pub(crate) fn take_place(&self) -> JsResult<()> {
        if self.is_committed()? {
            return Ok(());
        }
        let host = self.host();
        host.guest().map(Remote::end).transpose()?;
        host.leave_page()?;
        host.set_guest(Some(self));
        tell(Command::Surface {
            id: self.view.surface,
            command: SurfaceCommand::Show(self.view.image),
        })?;
        if host.is_focused() {
            self.view.input(Input::Focus)?;
        }
        self.view.accessibility_changed();
        if let Some(guest) = self.guest()
            && self.mirrored("entries").is_truthy()
        {
            guest.update(self)?;
        }
        host.notify(News::GuestCommitted)
    }

    pub(crate) fn load(&self, it: &Load<'_>) -> engine::Awaited {
        let line = |it: (&[u8], &[u8])| format!("{}: {}", string(it.0), string(it.1));
        let headers: Vec<String> = it.request.headers.iter().map(line).collect();
        let part = |it: &[u8]| list![record! { "type": "rawData", "bytes": Value::buffer(it) }];
        let options = record! {
            "extraHeaders": headers.join("\n"),
            "postData": it.request.body.as_deref().map(part),
            "httpReferrer": it.request.referrer.as_deref(),
            "userAgent": it.user_agent,
            "baseURLForDataURL": it.base_of_data,
        };
        if let Some(guest) = self.guest() {
            guest.last_asked_for.replace(it.url.to_owned());
            guest.end_relay();
            if guest.stands_in.get() {
                guest.relayed.replace(Some(Rc::new(Relayed {
                    url: it.url.to_owned(),
                    replaces: true,
                    is_announced: false,
                    has_started: false.into(),
                    end: Default::default(),
                })));
            }
        }
        self.ask("loadURL", list![it.url, options])
    }

    pub(super) fn stands_in(&self) -> bool {
        self.guest().is_some_and(|it| it.stands_in.get())
    }

    pub(crate) fn shows_origin(&self, origin: &str) -> JsResult<bool> {
        let frame = self.frames().next().transpose()?;
        Ok(origin != "null" && !self.stands_in() && frame.is_some_and(|it| it.origin() == origin))
    }

    /// To the engine, what the app loads is what the user has asked for: it gets all cookies, and servers are told so.
    pub(crate) fn load_for(
        &self,
        source: &Source,
        it: &Load<'_>,
    ) -> JsResult<LocalFuture<'static, engine::Reply>> {
        let Some(guest) = self.guest() else {
            return Ok(Box::pin(self.load(it)));
        };
        guest.last_asked_for.replace(it.url.to_owned());
        guest.end_relay();
        let (is_there, kind) = (self.shows_origin(&source.origin)?, self.engine().kind);
        let standing_in = (!is_there).then(|| {
            guest.stands_in.set(true);
            let referrer =
                (it.request.referrer.as_deref()).filter(|it| origin_of(it) == source.origin);
            let policy = match referrer {
                Some(_) => string(it.request.referrer_policy.as_bytes()),
                None => "no-referrer".to_owned(),
            };
            let is_known = match before(&source.origin, ":") {
                "http" | "https" => true,
                "null" | "file" => false,
                _ => kind == Kind::Electron,
            };
            let base = referrer.map_or_else(|| format!("{}/", source.origin), str::to_owned);
            let empty = format!(
                "<!doctype html><meta name=referrer content={policy}><link rel=icon href=data:,><body>"
            );
            let empty = format!("data:text/html,{}", encode_component(&empty));
            let options = record! { "baseURLForDataURL": is_known.then_some(base) };
            self.ask("loadURL", list![empty, options])
        });
        let url = match kind {
            Kind::Electron => it.url.to_owned(),
            Kind::Chromium => to_engine(it.url),
        };
        let content_type = it.request.headers.get(b"content-type");
        let arguments = list![
            url,
            if is_there && !source.replaces {
                "assign"
            } else {
                "replace"
            },
            (content_type.filter(|_| it.request.body.is_some())).map(|it| string(&it)),
            it.request.body.as_deref().map(base64)
        ];
        let script = record! {
            "expression": format!("({})(...{})", include_str!("navigate.js"), arguments.to_json()),
            "userGesture": source.is_by_user,
            "awaitPromise": true,
        };
        let relayed = Rc::new(Relayed {
            url: it.url.to_owned(),
            replaces: source.replaces,
            is_announced: source.is_announced,
            has_started: false.into(),
            end: Default::default(),
        });
        guest.relayed.replace(Some(Rc::clone(&relayed)));
        let view = Rc::clone(&self.view);
        let start = async move {
            if let Some(it) = standing_in {
                it.await.ok()?;
            }
            let session = view.attach().await?;
            let reply = view
                .engine
                .inspect("Runtime.evaluate", script, &session)
                .await;
            let session = record! { "sessionId": &*session };
            view.engine.command("Target.detachFromTarget", session, "");
            // It is an error if the document is gone by then.
            reply
                .map_or(true, |it| !it["exceptionDetails"].is_truthy())
                .then_some(())
        };
        Ok(Box::pin(async move {
            let end = relayed.end.clone();
            if let Either::Second(Some(())) = race(end.clone(), start).await {
                end.await;
            }
            Ok(Value::Undefined)
        }))
    }

    pub(crate) fn get_is_opened_by_page(&self) -> bool {
        self.guest().is_some_and(|it| it.is_opened_by_page)
    }

    pub(crate) fn debugger(&self) -> &Debugger {
        fields::inspector(self).unwrap_or_else(|| {
            let created = Debugger::create(std::rc::Rc::clone(&self.view));
            fields::set_inspector(self, Some(created));
            created
        })
    }

    pub(crate) fn set(&self, method: &str, values: JSValue) -> JsResult<()> {
        self.apply(method, engine::from_js(values)?);
        Ok(())
    }

    /// The news of a cookie can be later than that of the navigation.
    pub(crate) fn fetch_cookies(&self) -> engine::Awaited {
        let session = self.session;
        (self.engine()).request(|reply| Order::SendCookies { reply, session })
    }

    pub(crate) fn clear_history(&self) {
        if let Some(guest) = self.guest() {
            guest.before.take();
            guest.after.take();
        }
        self.view.tell_page("navigationHistory.clear", list![]);
    }

    pub(crate) fn remove_entry(&self, entry: &Rc<Entry>) {
        match (entry.document(), self.guest()) {
            (Document::Guest(view, index), _) if view == self.id() => {
                (self.view).tell_page("navigationHistory.removeEntryAtIndex", list![index]);
            }
            (_, Some(guest)) => {
                for list in [&guest.before, &guest.after] {
                    list.borrow_mut().retain(|it| !Rc::ptr_eq(it, entry));
                }
            }
            _ => {}
        }
    }

    /// Goes to an entry of the history, and takes over those around it that are for the web engine too.
    pub(crate) fn traverse(&self, load: &Load<'_>, index: usize) -> JsResult<engine::Awaited> {
        let Some(guest) = (self.guest()).filter(|_| self.engine().kind == Kind::Electron) else {
            return Ok(self.load(load));
        };
        let entries = self.host().history().borrow().entries.clone();
        if index >= entries.len() {
            return Ok(self.load(load));
        }
        let is_for_guest = |at: usize| self.host().is_for_guest(&entries[at].url());
        let (mut first, mut end) = (index, index + 1);
        while first > 0 && is_for_guest(first - 1)? {
            first -= 1;
        }
        while end < entries.len() && is_for_guest(end)? {
            end += 1;
        }
        guest.before.replace(entries[..first].to_vec());
        guest.after.replace(entries[end..].to_vec());
        guest.first_entries.set(end - first);
        let describe = |it: &Rc<Entry>| record! { "url": it.url(), "title": it.title() };
        let own: Value = entries[first..end].iter().map(describe).collect();
        let options = record! { "entries": own, "index": index - first };
        Ok(self.ask("navigationHistory.restore", list![options]))
    }

    pub(crate) fn handle_event(&self, event: JSValue) -> JsResult<()> {
        SurfaceEvent::from_js(global(), event, |it| {
            if *it.t == *b"resize" {
                self.view.shown_at.set(self.view.scale);
                self.view.resize([it.width, it.height]);
                return Ok(());
            }
            let input = input::from_script(&it, self.view.zoom.get())?;
            if let Some(Input::Key(key)) = &input
                && self.host().before_input(&Keystroke {
                    is_down: key.is_down,
                    key: (*key.key).into(),
                    code: (*key.code).into(),
                    location: key.location.into(),
                    modifiers: key.modifiers.into(),
                    repeats: key.is_repeat,
                    is_composing: key.is_composing,
                })?
            {
                return tell(Command::KeyWasHandled);
            }
            input.map_or(Ok(()), |it| self.view.input(it))
        })
    }

    pub(crate) fn environment_changed(&self) -> JsResult<()> {
        self.view
            .set_visible(self.is_visible()? || self.guest().is_some_and(|it| !it.is_shown.get()));
        Ok(())
    }

    /// It fails until the engine has started to paint.
    pub(crate) fn capture(&self, values: &[JSValue]) -> JsResult<JSValue> {
        let (view, values) = (
            std::rc::Rc::clone(&self.view),
            engine::list_from_js(values)?,
        );
        Ok(engine::promise(async move {
            let capture = || {
                view.wake();
                view.engine
                    .perform(Target::View(view.id), "capturePage", values.clone())
            };
            for _ in 0..10 {
                if let Ok(image) = capture().await {
                    return Ok(image);
                }
                task::sleep(100).await;
            }
            capture().await
        }))
    }

    pub(crate) fn subscribe(&self, listener: JSValue) {
        fields::set_on_frame(self, listener);
    }

    pub(crate) fn find_in_page(&self, values: &[JSValue]) -> JsResult<u32> {
        self.view
            .tell_page("findInPage", engine::list_from_js(values)?);
        Ok(self.guest().map_or(0, |it| {
            it.last_search.update(|it| it + 1);
            it.last_search.get()
        }))
    }
}
