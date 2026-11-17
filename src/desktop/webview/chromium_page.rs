//! A page in Chromium, in the terms of a `webContents`.

use std::rc::Rc;

use bun_ui::protocol::FramePixels;
use bun_web::net::NetError;
use bun_web::url::{Url, percent_decode};

use super::chromium::{Browser, Session, WORLD, from_engine, to_engine, unsupported};
use super::engine::{Awaited, Failure, Reply};
use super::notices;
use super::remote::Emitted;
use crate::files;
use crate::prelude::*;
use crate::task::{self, Later, Sequence};
use crate::text::{before, from_base64, origin_of, split_once};
use crate::value::{Value, quote};

const TITLE: &str = "titleChanged";
const WATCH_TITLE: &str = "if(top===self){let t='',w=n=>{o.disconnect();o.observe(n,{subtree:true,childList:true,characterData:true})},\
    o=new MutationObserver(()=>t===document.title||titleChanged(t=document.title));w(document);\
    addEventListener('DOMContentLoaded',()=>w(document.head??document))}";

pub(super) struct Frame {
    id: i32,
    key: Box<str>,
    parent: Option<i32>,
    pub(super) session: RefCell<Rc<str>>,
    /// The URL, the origin and the name.
    about: RefCell<Value>,
    world: Cell<Option<i32>>,
    is_loading: Cell<bool>,
    /// Its document has not had its `load` event.
    is_unfinished: Cell<bool>,
    was_opened: Cell<bool>,
    /// The id of the navigation that was announced last.
    started: RefCell<String>,
    /// The URL and the error, for when the page about it is there.
    failure: RefCell<Option<(String, String)>>,
}

/// A navigation that the app has asked for. What the page did before is still being reported.
#[derive(Default)]
enum Wish {
    #[default]
    None,
    /// For a URL, or else for an entry of the history.
    Sent(Option<String>),
    /// With the id that its document is going to have, if it gets one.
    Begun(Option<String>),
}

pub(super) struct Page {
    browser: Browser,
    pub(super) id: i32,
    pub(super) target: Box<str>,
    pub(super) session: Rc<str>,
    pub(super) owner: Rc<Session>,
    /// A URL, and the document that it gets.
    pub(super) stub: RefCell<Option<(String, String)>>,
    wish: RefCell<Wish>,
    wishes: Cell<u32>,
    is_reload: Cell<bool>,
    pub(super) request: RefCell<Value>,
    pub(super) opening: RefCell<Value>,
    frames: RefCell<Vec<Rc<Frame>>>,
    state: RefCell<Value>,
    loading: RefCell<Option<Later<Result<(), Failure>>>>,
    /// The id of the request, the frame, the URL and the response.
    documents: RefCell<Vec<(Box<str>, Box<str>, String)>>,
    responses: RefCell<Vec<(Box<str>, Value)>>,
    /// The history has to be asked for.
    pub(super) news: Sequence,
    /// The ids of the entries, and the index.
    committed: RefCell<(Vec<i32>, usize)>,
    last_frame: Cell<i32>,
    user_agent: RefCell<Option<String>>,
    size: Cell<[f64; 2]>,
    scale: f64,
    runs_scripts: bool,
}

fn failure_to_load(code: &str, errno: i32, url: &str) -> Failure {
    let details = record! { "errno": errno, "code": code, "url": url };
    Failure {
        details,
        ..Failure::new(format!("{code} ({errno}) loading '{url}'"))
    }
}

fn title_of(url: &str) -> &str {
    let shown = url.strip_prefix("http://").unwrap_or(url);
    match split_once(shown.strip_prefix("https://").unwrap_or(shown), "/") {
        Some((_, "")) => &shown[..shown.len() - 1],
        _ => shown,
    }
}

fn is_same(a: &str, b: &str) -> bool {
    Url::parse(a.as_bytes()).is_some_and(|it| Url::parse(b.as_bytes()) == Some(it))
}

fn take<T>(list: &RefCell<Vec<T>>, is_it: impl Fn(&T) -> bool) -> Option<T> {
    let at = list.borrow().iter().position(is_it)?;
    Some(list.borrow_mut().remove(at))
}

impl Page {
    pub(super) fn new(
        browser: Browser,
        options: &Value,
        target: &str,
        session: Rc<str>,
        owner: Rc<Session>,
    ) -> Rc<Page> {
        let state = record! { "url": "", "title": "", "isLoading": false, "isLoadingMainFrame": false, "zoomLevel": 0, "entries": list![], "index": 0 };
        Rc::new(Page {
            browser,
            id: options["id"].int(),
            target: target.into(),
            session,
            owner,
            stub: Default::default(),
            wish: Default::default(),
            wishes: 0.into(),
            is_reload: false.into(),
            request: Default::default(),
            opening: Default::default(),
            frames: Default::default(),
            state: state.into(),
            loading: Default::default(),
            documents: Default::default(),
            responses: Default::default(),
            news: Default::default(),
            committed: Default::default(),
            last_frame: Default::default(),
            user_agent: Default::default(),
            size: [options["width"].number(), options["height"].number()].into(),
            scale: options["scale"].number(),
            runs_scripts: !matches!(options["preferences"]["javascript"], Value::Bool(false)),
        })
    }

    fn inspect(&self, method: &str, params: Value) -> Awaited {
        self.browser.0.inspect(method, params, &self.session)
    }

    /// There is nobody to ask while a document takes the place of another.
    async fn insist(&self, method: &str, params: Value) -> Reply {
        for _ in 0..1000 {
            match self.inspect(method, params.clone()).await {
                Err(it) if it.says("Not attached to an active page") => task::sleep(5).await,
                reply => return reply,
            }
        }
        Err(Failure::new("The page does not respond"))
    }

    /// The app has asked for the navigation that is under way.
    pub(super) fn is_expected(&self) -> bool {
        matches!(*self.wish.borrow(), Wish::Begun(_))
    }

    fn is_superseded(&self) -> bool {
        matches!(*self.wish.borrow(), Wish::Sent(_))
    }

    fn begin(&self, navigation: &Value) {
        let (kind, id) = (navigation["navigationType"].text(), &navigation["loaderId"]);
        self.is_reload.set(kind.starts_with("reload"));
        let has_document = !matches!(kind, "sameDocument" | "historySameDocument");
        let begun = || Wish::Begun(has_document.then(|| id.display()));
        self.wish.replace(match self.wish.take() {
            Wish::Sent(Some(url)) if is_same(&url, navigation["url"].text()) => begun(),
            Wish::Sent(None) if !matches!(kind, "differentDocument" | "sameDocument") => begun(),
            Wish::Begun(Some(known)) if id.is(&known) => begun(),
            Wish::Begun(_) => Wish::None,
            other => other,
        });
    }

    /// The headers and the body that the app has given.
    pub(super) fn given_for(&self, url: &str) -> Value {
        let wanted = to_engine(self.state.borrow()["wanted"].text());
        match is_same(before(&wanted, "#"), url) {
            true => self.request.borrow().clone(),
            false => Value::Undefined,
        }
    }

    /// Whether it is what the app has asked for.
    fn arrive(&self, document: Option<&str>) -> bool {
        let is_it = matches!(&*self.wish.borrow(), Wish::Begun(it) if it.as_deref() == document);
        if is_it {
            self.wish.take();
        }
        is_it
    }

    async fn navigate(self: &Rc<Self>, url: Option<String>, method: &str, params: Value) -> Reply {
        self.wishes.update(|it| it + 1);
        let (page, number) = (Rc::clone(self), self.wishes.get());
        self.wish.replace(Wish::Sent(url));
        let reply = self.insist(method, params).await;
        if method != "Page.navigate" && reply.is_ok() {
            return reply;
        }
        // It has begun by now, or it never will.
        self.news.add(async move {
            if page.wishes.get() == number && page.is_superseded() {
                page.wish.take();
                if !page.state.borrow()["isLoadingMainFrame"].is_truthy() {
                    page.abort("ERR_FAILED", -2);
                }
            }
        });
        reply
    }

    pub(super) fn tell(&self, method: &str, params: Value) {
        self.browser.0.command(method, params, &self.session);
    }

    fn set(&self, name: &str, value: impl Into<Value>) {
        self.state.borrow_mut().set(name, value.into());
    }

    pub(super) fn url(&self) -> String {
        self.state.borrow()["url"].display()
    }

    pub(super) fn frames(&self) -> Vec<Rc<Frame>> {
        self.frames.borrow().clone()
    }

    fn frame(&self, key: &str) -> Option<Rc<Frame>> {
        self.frames
            .borrow()
            .iter()
            .find(|it| *it.key == *key)
            .cloned()
    }

    pub(super) fn frame_with_id(&self, id: i32) -> Option<Rc<Frame>> {
        self.frames.borrow().iter().find(|it| it.id == id).cloned()
    }

    /// Of the script that holds the `<iframe>`.
    pub(super) fn world(&self) -> Option<i32> {
        self.frame(&self.target)?.world.get()
    }

    fn describe(&self, frame: &Frame) -> Value {
        let ids = record! {
            "id": frame.id,
            "view": self.id,
            "parent": frame.parent,
            "processId": -self.id,
            "osProcessId": 0,
            "routingId": frame.id,
            "frameTreeNodeId": frame.id,
            "frameToken": &*frame.key,
        };
        ids.and(&frame.about.borrow())
    }

    pub(super) fn handle(&self, key: &str) -> Value {
        self.frame(key).map_or(Value::Null, |it| {
            Value::Handle(vec!["frame".into(), self.describe(&it)])
        })
    }

    pub(super) fn send_state(&self) {
        let frames: Value = self.frames().iter().map(|it| self.describe(it)).collect();
        let state = record! { "frames": frames }.and(&self.state.borrow());
        task::report(
            self.browser
                .0
                .view(self.id)
                .map_or(Ok(()), |it| it.update(state)),
        );
    }

    /// Returns whether the default was prevented.
    pub(super) fn emit(&self, name: &str, details: Value, arguments: Vec<Value>) -> bool {
        self.send_state();
        notices::emit_on_view(
            &self.browser.0,
            self.id,
            Emitted {
                name: name.into(),
                details,
                arguments,
            },
        )
    }

    fn emit_for_frame(&self, name: &str, key: &str, details: Value, arguments: Value) -> bool {
        let ids = [
            (*self.target == *key).into(),
            (-self.id).into(),
            self.frame(key).map(|it| it.id).into(),
        ];
        self.emit(
            name,
            details,
            arguments.into_items().into_iter().chain(ids).collect(),
        )
    }

    pub(super) fn emit_navigation(
        &self,
        name: &str,
        key: &str,
        url: &str,
        is_same_document: bool,
    ) -> bool {
        let details = record! {
            "url": url,
            "isSameDocument": is_same_document,
            "isMainFrame": *self.target == *key,
            "frame": self.handle(key),
            "initiator": (self.frames.borrow().len() == 1).then(|| self.handle(key)),
        };
        self.emit_for_frame(name, key, details, list![url, is_same_document])
    }

    pub(super) fn add_frame(
        self: &Rc<Self>,
        key: &str,
        session: &Rc<str>,
        parent: &str,
    ) -> Rc<Frame> {
        if let Some(known) = self.frame(key) {
            known.session.replace(Rc::clone(session));
            known.world.set(None);
            return known;
        }
        let frame = Rc::new(Frame {
            id: self.browser.new_id(),
            key: key.into(),
            parent: self.frame(parent).map(|it| it.id),
            session: Rc::clone(session).into(),
            about: record! { "url": "", "origin": "null", "name": "" }.into(),
            world: None.into(),
            is_loading: false.into(),
            is_unfinished: false.into(),
            was_opened: false.into(),
            started: Default::default(),
            failure: Default::default(),
        });
        self.frames.borrow_mut().push(Rc::clone(&frame));
        self.browser
            .pages
            .borrow_mut()
            .insert(key.into(), Rc::clone(self));
        if !parent.is_empty() {
            self.emit(
                "frame-created",
                record! {},
                vec![record! { "frame": self.handle(key) }],
            );
        }
        frame
    }

    fn remove_children(&self, frame: &Frame) {
        self.frames()
            .iter()
            .filter(|it| it.parent == Some(frame.id))
            .for_each(|it| self.remove_frame(&it.key));
    }

    pub(super) fn remove_frame(&self, key: &str) {
        if let Some(frame) = take(&self.frames, |it| *it.key == *key) {
            self.browser.pages.borrow_mut().remove(key);
            self.remove_children(&frame);
        }
    }

    pub(super) async fn attach(self: &Rc<Self>, session: Rc<str>) {
        let (engine, page, from) = (&self.browser.0, Rc::clone(self), Rc::clone(&session));
        engine.listen(
            &session,
            Rc::new(move |method, params| page.notice(method, params, &from)),
        );
        let user_agent = (self.user_agent.borrow().clone())
            .or_else(|| self.owner.user_agent.borrow().clone())
            .unwrap_or_else(|| self.browser.user_agent.clone());
        let commands = [
            ("Page.enable", record! {}),
            (
                "Page.setLifecycleEventsEnabled",
                record! { "enabled": true },
            ),
            ("Runtime.enable", record! {}),
            ("Network.enable", record! {}),
            ("Log.enable", record! {}),
            (
                "Runtime.addBinding",
                record! { "name": TITLE, "executionContextName": TITLE },
            ),
            (
                "Page.addScriptToEvaluateOnNewDocument",
                record! { "source": WATCH_TITLE, "worldName": TITLE },
            ),
            (
                "Target.setAutoAttach",
                record! { "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true },
            ),
            (
                "Emulation.setUserAgentOverride",
                record! { "userAgent": user_agent },
            ),
            (
                "Emulation.setEmulatedMedia",
                self.browser.media.borrow().clone(),
            ),
            (
                "Emulation.setScriptExecutionDisabled",
                record! { "value": !self.runs_scripts },
            ),
        ];
        for reply in commands.map(|(method, params)| engine.inspect(method, params, &session)) {
            let _ = reply.await;
        }
        engine.command("Runtime.runIfWaitingForDebugger", record! {}, &session);
    }

    pub(super) fn resize(&self) -> Awaited {
        let zoom = 1.2f64.powf(self.state.borrow()["zoomLevel"].number());
        let [width, height] = self.size.get().map(|it| (it / zoom).round());
        let metrics = record! { "width": width, "height": height, "deviceScaleFactor": self.scale * zoom, "mobile": false };
        self.inspect("Emulation.setDeviceMetricsOverride", metrics)
    }

    pub(super) fn set_background(&self, [a, r, g, b]: [u8; 4]) {
        let color = record! { "r": r, "g": g, "b": b, "a": f64::from(a) / 255. };
        self.tell(
            "Emulation.setDefaultBackgroundColorOverride",
            record! { "color": color },
        );
    }

    pub(super) fn acknowledge_frame(&self) {
        self.tell(
            "Page.screencastFrameAck",
            record! { "sessionId": self.last_frame.get() },
        );
    }

    pub(super) fn read_cookies(&self) {
        task::spawn(self.browser.clone().read_cookies(Rc::clone(&self.owner)));
    }

    pub(super) fn download(&self, url: &str, name: &Value) -> JsResult<()> {
        let Some(contents) = self.browser.0.view(self.id).map(|it| it.contents()) else {
            return Ok(());
        };
        let arguments = [
            js(from_engine(url))?,
            JSValue::UNDEFINED,
            contents,
            js(name)?,
        ];
        invoke(get(contents, "session")?, "downloadURL", &arguments).map(drop)
    }

    async fn update_history(&self) {
        let Ok(history) = self.insist("Page.getNavigationHistory", record! {}).await else {
            return;
        };
        let (entries, index) = (&history["entries"], history["currentIndex"].number());
        let describe = |it: &Value| {
            it.pick(&["id", "title"])
                .with("url", from_engine(it["url"].text()))
        };
        self.set(
            "entries",
            entries.items().iter().map(describe).collect::<Value>(),
        );
        self.set("index", index);
        self.send_state();
    }

    fn change_title(&self, title: &str, is_news: bool) {
        let state = self.state.borrow().clone();
        if state["isErrorPage"].is_truthy() {
            return;
        }
        let url = state["url"].text();
        self.set(
            "title",
            if title.is_empty() {
                title_of(url)
            } else {
                title
            },
        );
        self.set("ownTitle", title);
        if is_news || !state["ownTitle"].is(title) {
            self.emit(
                "page-title-updated",
                record! {},
                vec![title.into(), true.into()],
            );
        }
    }

    fn title_in_history(&self) -> String {
        let state = self.state.borrow();
        state["entries"][state["index"].number() as usize]["title"].display()
    }

    fn settle(&self, frame: &Frame, result: Result<(), Failure>) {
        if let Some(loading) = (self.target == frame.key && !self.is_superseded())
            .then(|| self.loading.take())
            .flatten()
        {
            loading.set(result);
        }
    }

    /// Returns the URL that the app has asked for, if it is waiting for it.
    pub(super) fn abort(&self, code: &str, errno: i32) -> Option<String> {
        let (loading, url) = (
            self.loading.take()?,
            self.state.borrow()["wanted"].display(),
        );
        loading.set(Err(failure_to_load(code, errno, &url)));
        Some(url)
    }

    fn report_failure(&self, frame: &Frame) {
        let Some((url, code)) = frame.failure.take() else {
            return;
        };
        let errno = NetError::number_of(&code).unwrap_or(-2);
        for name in ["did-fail-provisional-load", "did-fail-load"] {
            self.emit_for_frame(name, &frame.key, record! {}, list![errno, &*code, &*url]);
        }
        self.settle(frame, Err(failure_to_load(&code, errno, &url)));
    }

    fn fail(&self, key: &str, url: &str, text: &str) {
        let code = text.strip_prefix("net::").unwrap_or(text);
        // The server has said something, if only a status.
        if !matches!(code, "ERR_ABORTED" | "ERR_HTTP_RESPONSE_CODE_FAILURE")
            && let Some(frame) = self.frame(key)
        {
            frame.failure.replace(Some((url.into(), code.into())));
        }
    }

    /// Returns whether its document was still loading.
    fn abandon(&self, frame: &Frame) -> bool {
        let was_unfinished = frame.is_unfinished.take();
        let is_about_error = self.state.borrow()["isErrorPage"].is_truthy();
        if was_unfinished && !(is_about_error && frame.key == self.target) {
            let about = list![-3, "", &frame.about.borrow()["url"]];
            self.emit_for_frame("did-fail-load", &frame.key, record! {}, about);
        }
        was_unfinished
    }

    fn update_loading(&self) {
        let is_loading = self.frames().iter().any(|it| it.is_loading.get());
        let main = self.frame(&self.target);
        self.set(
            "isLoadingMainFrame",
            main.is_some_and(|it| it.is_loading.get()),
        );
        if self.state.borrow()["isLoading"].is_truthy() != is_loading {
            self.set("isLoading", is_loading);
            let name = if is_loading {
                "did-start-loading"
            } else {
                "did-stop-loading"
            };
            self.emit(name, false.into(), Vec::new());
        }
    }

    fn stopped(&self, frame: &Frame) {
        self.read_cookies();
        self.report_failure(frame);
        let (code, errno) = match self.abandon(frame) {
            true => ("", -3),
            false => ("ERR_FAILED", -2),
        };
        frame.is_loading.set(false);
        if frame.key == self.target && self.is_expected() {
            self.wish.take();
        }
        self.update_loading();
        let url = self.state.borrow()["wanted"].display();
        self.settle(frame, Err(failure_to_load(code, errno, &url)));
    }

    fn started(&self, key: &str, id: &str, url: &str) {
        if self
            .frame(key)
            .is_none_or(|it| it.started.replace(id.into()) == id)
        {
            return;
        }
        let is_expected = *self.target == *key && self.is_expected();
        if *self.target == *key && !is_expected && !self.is_superseded() {
            self.abort("ERR_ABORTED", -3);
        }
        self.emit_navigation("did-start-navigation", key, url, false);
        // The others are held up in `Browser::intercept`.
        let scheme = before(&to_engine(url), ":").to_owned();
        if !is_expected && !matches!(&*scheme, "http" | "https" | "file" | "about" | "data") {
            let names = ["will-frame-navigate", "will-navigate"];
            let mut names = names[..1 + usize::from(*self.target == *key)].iter();
            if names.any(|name| self.emit_navigation(name, key, url, false)) {
                self.tell("Page.stopLoading", record! {});
            }
        }
    }

    /// Returns whether it is at an entry of the history that there was before, but for the last one.
    async fn committed(&self, is_main: bool, is_in_page: bool) -> bool {
        let ids = || {
            let state = self.state.borrow();
            let ids = state["entries"].items().iter().map(|it| it["id"].int());
            (ids.collect::<Vec<_>>(), state["index"].number() as usize)
        };
        if is_main && self.committed.borrow().0.is_empty() {
            // Of the empty page that it was made with.
            let _ = self.insist("Page.resetNavigationHistory", record! {}).await;
        }
        self.update_history().await;
        let (now, index) = ids();
        let (before, last_index) = self.committed.replace((now.clone(), index));
        let (entry, last) = (now.get(index), before.get(last_index));
        if entry == last && !is_main {
            return false;
        }
        let replaces = match last {
            Some(last) if entry == Some(last) => {
                is_in_page || self.state.borrow()["isErrorPage"].is_truthy()
            }
            Some(last) => index == last_index && !now.contains(last),
            None => true,
        };
        let arguments = list![self.url(), is_in_page, replaces];
        self.emit(
            "navigation-entry-committed",
            record! {},
            arguments.into_items(),
        );
        entry != last && entry.is_some_and(|it| before.contains(it))
    }

    async fn navigated(self: &Rc<Self>, it: &Value, session: &Rc<str>) {
        let (key, is_main) = (it["id"].text(), it["id"].is(&self.target));
        let frame = self.add_frame(key, session, it["parentId"].text());
        let unreachable = it["unreachableUrl"].as_text();
        let url = from_engine(&unreachable.map_or_else(
            || it["url"].display() + it["urlFragment"].text(),
            str::to_owned,
        ));
        if url.starts_with("about:") {
            self.started(key, it["loaderId"].text(), &url);
        }
        self.abandon(&frame);
        frame.is_unfinished.set(true);
        self.remove_children(&frame);
        // Until the context of its scripts tells whether it is sandboxed.
        frame
            .about
            .replace(record! { "url": &*url, "origin": "null", "name": it["name"].text() });
        if is_main {
            self.set("url", &*url);
            self.set("isCrashed", false);
            if self.stub.borrow().is_some() {
                self.bypass_service_worker(false);
            }
            if !self.arrive(it["loaderId"].as_text()) && matches!(*self.wish.borrow(), Wish::None) {
                self.request.take();
            }
            self.set("isErrorPage", unreachable.is_some());
            if !self.is_reload.take() {
                self.set("title", title_of(&url));
                self.set("ownTitle", "");
            }
        }
        self.committed(is_main, false).await;
        if frame.failure.borrow().is_some() {
            return self.report_failure(&frame);
        }
        let status = take(&self.responses, |known| it["loaderId"].is(&known.0))
            .map_or_else(|| list![-1, ""], |it| it.1);
        let arguments = list![url, &status[0], &status[1]];
        self.emit_for_frame("did-frame-navigate", key, record! {}, arguments.clone());
        if is_main {
            self.emit("did-navigate", record! {}, arguments.into_items());
        }
    }

    async fn notice_in_order(self: Rc<Self>, method: &str, params: &Value, session: &Rc<str>) {
        let key = params["frameId"].text();
        match (method, self.frame(key)) {
            ("Page.frameAttached", _) => {
                self.add_frame(key, session, params["parentFrameId"].text());
            }
            ("Page.frameDetached", _) => {
                if !params["reason"].is("swap") {
                    self.remove_frame(key);
                }
                self.update_loading();
                self.send_state();
            }
            ("Page.frameStartedLoading", Some(frame)) => {
                frame.is_loading.set(true);
                self.update_loading();
            }
            ("Page.frameStoppedLoading", Some(frame)) if frame.is_loading.get() => {
                self.stopped(&frame)
            }
            ("Page.frameNavigated", _) => self.navigated(&params["frame"], session).await,
            ("Page.navigatedWithinDocument", Some(frame)) => {
                let (url, is_main) = (from_engine(params["url"].text()), frame.key == self.target);
                self.emit_navigation("did-start-navigation", key, &url, true);
                frame.about.borrow_mut().set("url", &*url);
                if is_main {
                    self.set("url", &*url);
                    self.arrive(None);
                }
                let is_back = self.committed(is_main, true).await;
                self.emit_for_frame("did-navigate-in-page", key, record! {}, list![url]);
                if is_main {
                    self.change_title(&self.title_in_history(), is_back);
                }
                if !frame.is_unfinished.get() && !self.is_expected() {
                    self.settle(&frame, Ok(()));
                }
            }
            ("Page.frameStartedNavigating", Some(frame)) if frame.key == self.target => {
                self.begin(params)
            }
            ("Page.documentOpened", _) => {
                let frame = self.frame(params["frame"]["id"].text());
                frame.inspect(|it| it.was_opened.set(true));
            }
            ("Page.lifecycleEvent", Some(frame)) => match params["name"].text() {
                "init" if !frame.was_opened.take() && !frame.is_loading.get() => {
                    frame.is_unfinished.set(!frame.started.borrow().is_empty())
                }
                "load" if frame.is_unfinished.take() => {
                    self.emit_for_frame("did-frame-finish-load", key, record! {}, list![]);
                    if frame.key == self.target {
                        // Unless it is for the next document.
                        let loading = matches!(*self.wish.borrow(), Wish::None)
                            .then(|| self.loading.take())
                            .flatten();
                        self.emit("did-finish-load", false.into(), Vec::new());
                        loading.inspect(|it| it.set(Ok(())));
                    }
                }
                _ => {}
            },
            ("Runtime.bindingCalled", _) => {
                self.update_history().await;
                let title = params["payload"].text();
                self.change_title(&title[..title.floor_char_boundary(4096)], false);
            }
            ("Page.domContentEventFired", _) if *session == self.session => {
                self.update_history().await;
                self.change_title(&self.title_in_history(), false);
                self.emit("dom-ready", record! {}, Vec::new());
            }
            ("Network.requestWillBeSent", _) if params["type"].is("Document") => {
                let (id, request) = (params["requestId"].text(), &params["request"]);
                let url = from_engine(&(request["url"].display() + request["urlFragment"].text()));
                take(&self.documents, |it| *it.0 == *id);
                self.documents
                    .borrow_mut()
                    .push((id.into(), key.into(), url.clone()));
                self.started(key, id, &url);
            }
            ("Network.responseReceived", _) if params["type"].is("Document") => {
                let status = list![
                    &params["response"]["status"],
                    &params["response"]["statusText"]
                ];
                self.responses
                    .borrow_mut()
                    .push((params["loaderId"].text().into(), status));
            }
            ("Network.loadingFinished", _) => {
                take(&self.documents, |it| params["requestId"].is(&it.0));
            }
            ("Network.loadingFailed", _) => {
                if let Some((_, key, url)) =
                    take(&self.documents, |it| params["requestId"].is(&it.0))
                {
                    let blocked = format!(
                        "ERR_BLOCKED_BY_{}",
                        params["blockedReason"].text().to_ascii_uppercase()
                    );
                    let text = Some(params["errorText"].text()).filter(|it| !it.is_empty());
                    self.fail(&key, &url, text.unwrap_or(&blocked));
                }
            }
            _ => {}
        }
    }

    fn log(&self, level: &str, message: String, line: f64, source: &str) {
        let (number, level) = match level {
            "debug" | "verbose" => (0, "debug"),
            "warning" => (2, "warning"),
            "error" | "assert" => (3, "error"),
            _ => (1, "info"),
        };
        let details = record! { "message": &*message, "level": level, "lineNumber": line, "sourceId": source };
        self.emit(
            "console-message",
            details,
            list![number, message, line, source].into_items(),
        );
    }

    fn show_dialog(&self, params: &Value, session: &Rc<str>) -> JsResult<()> {
        let (engine, session) = (Rc::clone(&self.browser.0), Rc::clone(session));
        let close = move |answer: Value| {
            engine.command(
                "Page.handleJavaScriptDialog",
                record! { "accept": answer[0].is_truthy() },
                &session,
            );
        };
        if params["type"].is("beforeunload") {
            let leaves = self.emit("will-prevent-unload", record! {}, Vec::new());
            if !leaves {
                self.wish.take();
            }
            if let Some(url) = (!leaves).then(|| self.abort("ERR_ABORTED", -3)).flatten() {
                let about = list![-3, "ERR_ABORTED", url];
                self.emit_for_frame("did-fail-load", &self.target, record! {}, about);
            }
            close(list![leaves]);
            return Ok(());
        }
        let about = record! {
            "dialogType": &params["type"],
            "messageText": &params["message"],
            "frame": self.handle(params["frameId"].text()),
        };
        self.browser.0.view(self.id).map_or(Ok(()), |it| {
            it.show_dialog(&about, Value::Function(Rc::new(close)))
        })
    }

    fn notice(self: &Rc<Self>, method: &str, params: &Value, session: &Rc<str>) -> JsResult<()> {
        let (engine, page) = (&self.browser.0, Rc::clone(self));
        let is_main_session = *session == self.session;
        let in_order = || {
            let (page, session) = (Rc::clone(self), Rc::clone(session));
            let (method, params) = (method.to_owned(), params.clone());
            (self.news).add(async move { page.notice_in_order(&method, &params, &session).await });
        };
        match method {
            "Target.attachedToTarget" => {
                let (target, child) = (&params["targetInfo"], Rc::from(params["sessionId"].text()));
                if target["type"].is("iframe") {
                    self.add_frame(
                        target["targetId"].text(),
                        &child,
                        target["parentFrameId"].text(),
                    );
                    task::spawn(async move { page.attach(child).await });
                } else {
                    engine.command("Runtime.runIfWaitingForDebugger", record! {}, &child);
                }
            }
            "Target.detachedFromTarget" => engine.ignore(params["sessionId"].text()),
            "Inspector.targetCrashed" if is_main_session => {
                self.set("isCrashed", true);
                if let Some(frame) = self.frame(&self.target) {
                    self.remove_children(&frame);
                    frame.about.borrow_mut().set("url", "");
                }
                self.emit(
                    "render-process-gone",
                    record! {},
                    vec![record! { "reason": "crashed", "exitCode": -1 }],
                );
            }
            "Page.frameAttached"
            | "Page.frameDetached"
            | "Page.frameStartedLoading"
            | "Page.frameStoppedLoading"
            | "Page.frameStartedNavigating"
            | "Page.frameNavigated"
            | "Page.navigatedWithinDocument"
            | "Page.documentOpened"
            | "Page.lifecycleEvent"
            | "Page.domContentEventFired"
            | "Network.requestWillBeSent"
            | "Network.responseReceived"
            | "Network.loadingFinished"
            | "Network.loadingFailed" => in_order(),
            "Runtime.bindingCalled" if is_main_session && params["name"].is(TITLE) => in_order(),
            "Page.windowOpen" => drop(self.opening.replace(params.clone())),
            "Page.screencastFrame" => {
                self.last_frame.set(params["sessionId"].int());
                return notices::paint(
                    engine,
                    self.id,
                    FramePixels::Encoded(from_base64(params["data"].text()).into()),
                );
            }
            "Page.javascriptDialogOpening" => return self.show_dialog(params, session),
            "Runtime.executionContextCreated" => {
                let context = &params["context"];
                let Some(frame) = self.frame(context["auxData"]["frameId"].text()) else {
                    return Ok(());
                };
                if context["name"].is(WORLD) {
                    frame.world.set(Some(context["id"].int()));
                }
                if context["auxData"]["isDefault"].is_truthy() {
                    let origin = Some(context["origin"].text())
                        .filter(|it| *it != "://")
                        .unwrap_or("null");
                    frame.about.borrow_mut().set("origin", from_engine(origin));
                    self.send_state();
                }
            }
            "Runtime.bindingCalled"
                if is_main_session && self.world() == Some(params["executionContextId"].int()) =>
            {
                let message = Value::buffer(&from_base64(params["payload"].text()));
                return engine
                    .view(self.id)
                    .map_or(Ok(()), |it| it.receive(&message));
            }
            "Runtime.consoleAPICalled" => {
                let caller = &params["stackTrace"]["callFrames"][0];
                let shown = |it: &Value| {
                    let found = ["value", "description", "type"]
                        .into_iter()
                        .find(|name| !it[*name].is_nothing());
                    it[found.unwrap_or_default()].display()
                };
                let message = params["args"]
                    .items()
                    .iter()
                    .map(shown)
                    .collect::<Vec<_>>()
                    .join(" ");
                let line = caller["lineNumber"].as_number().map_or(0., |it| it + 1.);
                self.log(params["type"].text(), message, line, caller["url"].text());
            }
            "Runtime.exceptionThrown" => {
                let it = &params["exceptionDetails"];
                let message = format!(
                    "{} {}",
                    it["text"].text(),
                    before(it["exception"]["description"].text(), "\n")
                );
                self.log(
                    "error",
                    message.trim().to_owned(),
                    it["lineNumber"].number() + 1.,
                    it["url"].text(),
                );
            }
            "Log.entryAdded" => {
                let it = &params["entry"];
                self.log(
                    it["level"].text(),
                    it["text"].display(),
                    it["lineNumber"].number(),
                    it["url"].text(),
                );
            }
            "Network.responseReceivedExtraInfo" => {
                if params["headers"]
                    .members()
                    .iter()
                    .any(|it| it.0.text().eq_ignore_ascii_case("set-cookie"))
                {
                    self.read_cookies();
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) async fn evaluate(
        &self,
        expression: &str,
        frame: &Frame,
        world: Option<&str>,
        user_gesture: bool,
    ) -> Reply {
        let (engine, session) = (&self.browser.0, frame.session.borrow().clone());
        let context = match world {
            Some(name) => {
                let world = record! { "frameId": &*frame.key, "worldName": name };
                engine
                    .inspect("Page.createIsolatedWorld", world, &session)
                    .await?
                    .take("executionContextId")
            }
            None if frame.key != self.target && session == self.session => {
                return Err(unsupported("executeJavaScript in this frame"));
            }
            None => Value::Undefined,
        };
        let params = record! {
            "expression": expression,
            "contextId": context,
            "userGesture": user_gesture,
            "awaitPromise": true,
            "returnByValue": true,
        };
        let mut reply = engine.inspect("Runtime.evaluate", params, &session).await?;
        let thrown = &reply["exceptionDetails"];
        match thrown.is_truthy() {
            true => Err(Failure::new(
                thrown["exception"]["description"]
                    .as_text()
                    .unwrap_or_else(|| thrown["text"].text()),
            )),
            false => Ok(reply.take("result").take("value")),
        }
    }

    async fn evaluate_at_top(
        &self,
        expression: &str,
        world: Option<&str>,
        user_gesture: bool,
    ) -> Reply {
        let top = self
            .frame(&self.target)
            .ok_or_else(|| Failure::new("Object has been destroyed"))?;
        self.evaluate(expression, &top, world, user_gesture).await
    }

    async fn when_loaded(&self) {
        let loading = self.loading.borrow().clone();
        if let Some(loading) = loading {
            let _ = loading.await;
        }
    }

    fn bypass_service_worker(&self, bypasses: bool) {
        self.tell(
            "Network.setBypassServiceWorker",
            record! { "bypass": bypasses },
        );
    }

    /// Returns the URL that has the markup of the `data:` URL.
    async fn substitute(&self, url: &str, base: &str, is_local: bool) -> String {
        let html = string(&percent_decode(
            split_once(url, ",").unwrap_or_default().1.as_bytes(),
        ));
        let mut url = before(&to_engine(base), "#").to_owned();
        if url.starts_with("file:") {
            let file = files::join(&[&self.browser.0.directory, &format!("page{}.html", self.id)]);
            let _ = files::write(&file, html.as_bytes(), 0o600);
            url = files::to_url(&file);
        }
        self.stub.replace(Some((url.clone(), html)));
        self.bypass_service_worker(true);
        if !is_local {
            return url;
        }
        // A response that is made up counts as one from the internet.
        let grant = |name| {
            let permission = record! {
                "permission": record! { "name": name },
                "setting": "granted",
                "origin": origin_of(&url),
                "browserContextId": &*self.owner.context.borrow(),
            };
            self.browser
                .0
                .inspect("Browser.setPermission", permission, "")
        };
        for reply in ["local-network-access", "local-network", "loopback-network"].map(grant) {
            let _ = reply.await;
        }
        url
    }

    async fn load(self: Rc<Self>, url: &str, options: &Value) -> Reply {
        self.stub.take();
        let url = match options["baseURLForDataURL"].as_text() {
            Some(base) => (self.substitute(url, base, options["isLocal"].is_truthy())).await,
            None => url.to_owned(),
        };
        let loading = Later::default();
        self.abort("ERR_ABORTED", -3);
        self.loading.replace(Some(loading.clone()));
        self.set("wanted", &*url);
        self.request
            .replace(options.pick(&["extraHeaders", "postData"]));
        let place = record! { "url": to_engine(&url), "referrer": &options["httpReferrer"] };
        let wanted = Some(to_engine(&url));
        if self.navigate(wanted, "Page.navigate", place).await.is_err() {
            loading.set(Err(failure_to_load("ERR_FAILED", -2, &url)));
        }
        loading.await.map(|()| Value::Undefined)
    }

    pub(super) async fn perform(self: Rc<Self>, method: &str, arguments: &Value) -> Reply {
        let (first, second) = (&arguments[0], &arguments[1]);
        let (command, params) = match method {
            "loadURL" => return self.load(first.text(), second).await,
            "executeJavaScript" => {
                self.when_loaded().await;
                return self
                    .evaluate_at_top(&first.display(), None, second.is_truthy())
                    .await;
            }
            "executeJavaScriptInIsolatedWorld" => {
                self.when_loaded().await;
                let code = second
                    .items()
                    .iter()
                    .map(|it| it["code"].text())
                    .collect::<Vec<_>>()
                    .join(";\n");
                let world = first.is_truthy().then(|| format!("world {}", first.int()));
                return self.evaluate_at_top(&code, world.as_deref(), false).await;
            }
            "insertCSS" => {
                let (key, css) = (self.browser.new_id(), quote(first.text()));
                let add = format!(
                    "{{const s=new CSSStyleSheet;s.replaceSync({css});(globalThis.sheets??={{}})[{key}]=s;\
                     document.adoptedStyleSheets.push(s)}}"
                );
                return self
                    .evaluate_at_top(&add, Some("css"), false)
                    .await
                    .map(|_| key.to_string().into());
            }
            "removeInsertedCSS" => {
                let key: i32 = first.text().parse().unwrap_or(0);
                let remove = format!(
                    "void(document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==globalThis.sheets?.[{key}]))"
                );
                return self.evaluate_at_top(&remove, Some("css"), false).await;
            }
            "capturePage" => {
                let clip = first.is_truthy().then(|| first.clone().with("scale", 1));
                let shot = self
                    .insist("Page.captureScreenshot", record! { "clip": clip })
                    .await?;
                return Ok(Value::Handle(vec![
                    "image".into(),
                    Value::buffer(&from_base64(shot["data"].text())),
                ]));
            }
            "printToPDF" => {
                let options = first.pick(&[
                    "landscape",
                    "printBackground",
                    "scale",
                    "pageRanges",
                    "preferCSSPageSize",
                ]);
                return Ok(Value::buffer(&from_base64(
                    self.inspect("Page.printToPDF", options).await?["data"].text(),
                )));
            }
            "downloadURL" => {
                return Ok((
                    task::report(self.download(first.text(), &Value::Undefined)),
                    Value::Undefined,
                )
                    .1);
            }
            "setZoomLevel" | "setZoomFactor" | "setContentSize" => {
                match method {
                    "setZoomLevel" => self.set("zoomLevel", first),
                    "setZoomFactor" => self.set("zoomLevel", first.number().log(1.2)),
                    _ => self.size.set([first.number(), second.number()]),
                }
                return self.resize().await;
            }
            "setBackgroundColor" => {
                let argb =
                    u32::from_str_radix(first.text().trim_start_matches('#'), 16).unwrap_or(0);
                return Ok((self.set_background(argb.to_be_bytes()), Value::Undefined).1);
            }
            "navigationHistory.clear" => {
                let _ = self.insist("Page.resetNavigationHistory", record! {}).await;
                return Ok((self.update_history().await, Value::Undefined).1);
            }
            "navigationHistory.goToIndex" => {
                self.request.take();
                let entry = self.state.borrow()["entries"][first.number() as usize]["id"].clone();
                let entry = record! { "entryId": entry };
                return (self.navigate(None, "Page.navigateToHistoryEntry", entry)).await;
            }
            "reload" | "reloadIgnoringCache" => {
                let how = record! { "ignoreCache": method != "reload" };
                return self.navigate(None, "Page.reload", how).await;
            }
            "setUserAgent" => {
                self.user_agent.replace(first.as_text().map(str::to_owned));
                (
                    "Emulation.setUserAgentOverride",
                    record! { "userAgent": first },
                )
            }
            "stop" => ("Page.stopLoading", record! {}),
            "close" => ("Page.close", record! {}),
            "forcefullyCrashRenderer" => ("Page.crash", record! {}),
            "insertText" => ("Input.insertText", record! { "text": first }),
            "startPainting" => ("Page.startScreencast", record! { "format": "png" }),
            "stopPainting" => ("Page.stopScreencast", record! {}),
            "undo" | "redo" | "cut" | "copy" | "paste" | "pasteAndMatchStyle" | "delete"
            | "selectAll" | "unselect" => (
                "Input.dispatchKeyEvent",
                record! { "type": "rawKeyDown", "commands": list![method] },
            ),
            _ => return Err(unsupported(method)),
        };
        let _ = self.insist(command, params).await;
        Ok(Value::Undefined)
    }
}
