//! A client.

use core::cell::OnceCell;
use std::rc::{Rc, Weak};

use bun_jsc::Strong;

use super::contents::{self, Contents};
use super::engine::EngineSession;
use super::frames::Frames;
use super::input::Input;
use super::page::PageSession;
use super::{Emit, Failure, Outcome, Reply, Session, ask, done, random_id, target_id_of, unknown};
use crate::contents::inspection::{News, Observer};
use crate::generated_bindgen::session::CookieDetails;
use crate::prelude::*;
use crate::task::{self, Later};
use crate::value::Value;
use crate::webview::remote::Remote;
use crate::{app, session, text};

fn lasts(method: &str) -> bool {
    let (domain, name) = text::split_once(method, ".").unwrap_or_default();
    matches!(name, "enable" | "disable")
        || (name.starts_with("set")
            && matches!(domain, "Emulation" | "Network" | "Page" | "Security"))
        || matches!(
            method,
            "Page.addScriptToEvaluateOnNewDocument" | "Runtime.addBinding" | "Target.setAutoAttach"
        )
}

type Opened = Result<Rc<dyn Session>, Failure>;

/// A `WebContents`, whichever engine has its page.
struct ContentsSession {
    connection: Weak<Connection>,
    contents: Contents,
    emit: Emit,
    observer: OnceCell<Rc<Observer>>,
    current: RefCell<Later<Opened>>,
    guest: RefCell<Option<Root<Remote>>>,
    commands: task::Sequence,
    input: Input,
    settings: RefCell<Vec<(String, Value)>>,
    /// Its id, and who is told that it has ended.
    parent: Option<(Rc<str>, Emit)>,
}

impl ContentsSession {
    fn new(
        connection: &Rc<Connection>,
        contents: Contents,
        parent: Option<(Rc<str>, Emit)>,
    ) -> JsResult<Rc<ContentsSession>> {
        let session = Rc::new(ContentsSession {
            connection: Rc::downgrade(connection),
            contents,
            emit: connection.emitter(parent.as_ref().map(|it| Rc::clone(&it.0))),
            observer: OnceCell::new(),
            current: RefCell::default(),
            guest: RefCell::default(),
            commands: task::Sequence::default(),
            input: Input::default(),
            settings: RefCell::default(),
            parent,
        });
        let weak = Rc::downgrade(&session);
        let observer = Observer::new(false, move |news| match (weak.upgrade(), news) {
            (Some(it), News::GuestCommitted) => it.guest_committed(),
            (Some(it), News::DocumentCreated) => it.document_created(),
            (Some(it), News::Destroyed) => {
                it.detach();
                Ok(())
            }
            _ => Ok(()),
        });
        (session.contents).observe(session.observer.get_or_init(|| observer));
        match session.contents.guest() {
            Some(guest) => {
                let attached = session.open_guest(guest);
                let opened = async { attached.await.map(|it| it as Rc<dyn Session>) };
                session.current.replace(Later::of(opened));
            }
            None => drop(session.open_page(connection)?),
        }
        Ok(session)
    }

    fn open_guest(
        &self,
        guest: &Remote,
    ) -> impl Future<Output = Result<Rc<EngineSession>, Failure>> + use<> {
        self.guest.replace(Some(Root::new(guest)));
        EngineSession::attach(
            Weak::clone(&self.connection),
            Root::new(guest),
            target_id_of(self.contents.object()),
            Rc::clone(&self.emit),
            false,
        )
    }

    fn open_page(&self, connection: &Rc<Connection>) -> JsResult<Rc<PageSession>> {
        self.guest.take();
        let page = connection.local(self.contents.clone(), Rc::clone(&self.emit))?;
        let current = Later::default();
        current.set(Ok(Rc::clone(&page) as Rc<dyn Session>));
        self.current.replace(current);
        Ok(page)
    }

    fn with_current(&self, act: impl FnOnce(Opened) + 'static) {
        let current = self.current.borrow().clone();
        self.commands.add(async { act(current.await) });
    }

    fn close_current(&self) {
        self.with_current(|it| it.iter().for_each(|it| it.close()));
    }

    fn restore(&self, session: &Rc<dyn Session>) {
        let settings = self.settings.borrow().clone();
        for (method, params) in settings {
            let params = params.with("runImmediately", true);
            Rc::clone(session).handle(&method, params, Box::new(drop));
        }
    }

    fn guest_committed(self: Rc<Self>) -> JsResult<()> {
        let Some(guest) = self.contents.guest() else {
            return Ok(());
        };
        self.close_current();
        (self.emit)("Runtime.executionContextsCleared", Value::empty());
        let (attached, this) = (self.open_guest(guest), Rc::clone(&self));
        self.current.replace(Later::of(async move {
            let engine = attached.await?;
            let session = Rc::clone(&engine) as Rc<dyn Session>;
            let tree = ask(Rc::clone(&session), "Page.getFrameTree", Value::empty());
            Rc::clone(&session).handle("Page.enable", Value::empty(), Box::new(drop));
            engine.announce(&tree.await?["frameTree"], true);
            this.restore(&session);
            Ok(session)
        }));
        Ok(())
    }

    fn document_created(&self) -> JsResult<()> {
        let has_left_guest = self.guest.borrow().is_some() && self.contents.guest().is_none();
        if let Some(connection) = self.connection.upgrade().filter(|_| has_left_guest) {
            self.close_current();
            let page = self.open_page(&connection)?;
            page.document_created()?;
            self.restore(&(page as Rc<dyn Session>));
        }
        Ok(())
    }

    async fn change_engine(self: Rc<Self>, params: Value) -> Outcome {
        let frame = record! { "frameId": &*target_id_of(self.contents.object()) };
        if let Err(error) = task::outcome(self.contents.load_url(&params)).await {
            let code = text_of(get(error.get(), "code")?)?;
            return Ok(frame.with("errorText", format!("net::{code}")));
        }
        let tree = ask(self, "Page.getFrameTree", Value::empty()).await?;
        Ok(frame.with("loaderId", &tree["frameTree"]["frame"]["loaderId"]))
    }

    fn detach(&self) {
        let Some((id, emit)) = &self.parent else {
            return;
        };
        self.close();
        if let Some(connection) = self.connection.upgrade() {
            connection.remove(id);
        }
        let target = target_id_of(self.contents.object());
        let params = record! { "sessionId": &**id, "targetId": &*target };
        emit("Target.detachedFromTarget", params);
    }
}

impl Session for ContentsSession {
    fn handle(self: Rc<Self>, method: &str, params: Value, reply: Reply) {
        let guest = self.guest.borrow().as_ref().map(Root::get);
        match method {
            "Target.getTargetInfo" => {
                let info = self.contents.info().map_err(Failure::from);
                return reply(info.map(|it| record! { "targetInfo": it }));
            }
            "Page.close" => {
                self.contents.close_later();
                return reply(Ok(Value::empty()));
            }
            "Page.navigate" => match self.contents.is_for_guest(params["url"].text()) {
                Ok(is_for_guest) if is_for_guest == guest.is_some() => {}
                Ok(_) => return task::spawn(async { reply(self.change_engine(params).await) }),
                Err(error) => return reply(Err(error.into())),
            },
            _ => {}
        }
        if let Some(guest) = guest.filter(|_| method != "Input.dispatchTouchEvent")
            && let Some(result) = self.input.run(&self.contents, method, &params)
        {
            let (result, idle) = (done(result), guest.idle());
            return task::spawn(async {
                idle.await;
                reply(result);
            });
        }
        if lasts(method) {
            (self.settings.borrow_mut()).push((method.into(), params.clone()));
        }
        let method = method.to_owned();
        self.with_current(move |current| match current {
            Ok(session) => session.handle(&method, params, reply),
            Err(error) => reply(Err(error)),
        });
    }

    fn close(&self) {
        if let Some(observer) = self.observer.get() {
            self.contents.unobserve(observer);
        }
        self.close_current();
    }
}

pub(super) fn targets() -> JsResult<Vec<Value>> {
    let mut targets = Vec::new();
    for it in contents::all() {
        if !it.is_undecided()? {
            targets.push(it.info()?);
        }
    }
    Ok(targets)
}

pub(super) fn product() -> JsResult<String> {
    let versions = get(crate::process::object(), "versions")?;
    Ok(format!("Chrome/{}", text_of(get(versions, "chrome")?)?))
}

pub(super) fn user_agent() -> JsResult<String> {
    text_of(get(app::object(), "userAgentFallback")?)
}

const SAME_SITE: [[&str; 2]; 3] = [
    ["lax", "Lax"],
    ["no_restriction", "None"],
    ["strict", "Strict"],
];

fn cookies() -> Outcome {
    let cookies = session::default()?.all_cookies().into_items().into_iter();
    let cookies = cookies.map(|mut it| {
        let (expires, same_site) = (it.take("expirationDate"), it.take("sameSite"));
        let same_site = SAME_SITE.iter().find(|it| same_site.is(it[0]));
        (it.with("expires", expires.as_number().unwrap_or(-1.)))
            .with("sameSite", same_site.map(|it| it[1]))
    });
    Ok(record! { "cookies": cookies.collect::<Value>() })
}

fn set_cookie(it: &Value) -> JsResult<()> {
    let domain = it["domain"].text();
    let url = it["url"].as_text().map_or_else(
        || {
            format!(
                "http{}://{}{}",
                if it["secure"].is_truthy() { "s" } else { "" },
                domain.strip_prefix('.').unwrap_or(domain),
                it["path"].as_text().unwrap_or("/"),
            )
        },
        String::from,
    );
    let same_site = SAME_SITE.iter().find(|name| it["sameSite"].is(name[1]));
    let text = |name: &str| it[name].as_text().map(str::as_bytes);
    session::default()?.set_cookie(&CookieDetails {
        url: Some(url.as_bytes()),
        name: text("name"),
        value: text("value"),
        domain: text("domain").filter(|it| it.starts_with(b".")),
        path: text("path"),
        secure: (!it["secure"].is_nothing()).then(|| it["secure"].is_truthy()),
        http_only: it["httpOnly"].is_truthy(),
        expiration_date: it["expires"].as_number().filter(|it| *it > 0.),
        same_site: same_site.map(|it| it[0].as_bytes()),
    })
}

pub(super) struct Connection {
    socket: Strong,
    sessions: RefCell<Vec<(Rc<str>, Rc<dyn Session>)>>,
    pages: RefCell<Vec<Weak<ContentsSession>>>,
    browser_sessions: RefCell<Vec<String>>,
    /// For a connection to one page.
    only: OnceCell<Rc<ContentsSession>>,
    /// The listener for new `WebContents`.
    auto_attach: RefCell<Option<Strong>>,
}

impl Connection {
    pub(super) fn new(socket: JSValue, target: Option<Contents>) -> JsResult<Rc<Connection>> {
        let connection = Rc::new(Connection {
            socket: keep(socket),
            sessions: RefCell::default(),
            pages: RefCell::default(),
            browser_sessions: RefCell::default(),
            only: OnceCell::new(),
            auto_attach: RefCell::default(),
        });
        if let Some(target) = target {
            let close = function(socket, |socket, _| invoke(socket, "close", &[]))?;
            target.invoke("once", &[js("destroyed")?, close])?;
            let session = ContentsSession::new(&connection, target, None)?;
            connection.only.get_or_init(|| session);
        }
        Ok(connection)
    }

    fn send(&self, message: &Value) {
        let text = js(message.to_json());
        task::report(text.and_then(|it| invoke(self.socket.get(), "send", &[it]).map(drop)));
    }

    pub(super) fn emitter(self: &Rc<Self>, session: Option<Rc<str>>) -> Emit {
        let connection = Rc::downgrade(self);
        Rc::new(move |method, params| {
            if let Some(connection) = connection.upgrade() {
                connection.send(&record! {
                    "method": method,
                    "params": params,
                    "sessionId": session.as_deref(),
                });
            }
        })
    }

    pub(super) fn add(&self, id: Rc<str>, session: Rc<dyn Session>) {
        self.sessions.borrow_mut().push((id, session));
    }

    pub(super) fn remove(&self, id: &str) {
        self.sessions.borrow_mut().retain(|it| *it.0 != *id);
    }

    pub(super) fn local(
        self: &Rc<Self>,
        contents: Contents,
        emit: Emit,
    ) -> JsResult<Rc<PageSession>> {
        let frames = Frames::new(Rc::downgrade(self), contents.clone(), Rc::clone(&emit));
        PageSession::new(contents, emit, Some(frames))
    }

    fn attach(self: &Rc<Self>, contents: Contents, parent: Option<&str>) -> JsResult<Value> {
        let (id, emit): (Rc<str>, _) = (random_id().into(), self.emitter(parent.map(Rc::from)));
        let parent = (Rc::clone(&id), Rc::clone(&emit));
        let session = ContentsSession::new(self, contents, Some(parent))?;
        self.pages.borrow_mut().retain(|it| it.strong_count() > 0);
        self.pages.borrow_mut().push(Rc::downgrade(&session));
        let info = session.contents.info()?;
        self.add(Rc::clone(&id), session);
        let params = record! { "sessionId": &*id, "targetInfo": info, "waitingForDebugger": false };
        emit("Target.attachedToTarget", params);
        Ok(record! { "sessionId": &*id })
    }

    fn attach_soon(self: &Rc<Self>, contents: Contents) {
        let connection = Rc::downgrade(self);
        later::soon(move |_| {
            (connection.upgrade()).map_or(Ok(()), |it| it.attach_when_decided(contents))
        });
    }

    fn attach_when_decided(self: &Rc<Self>, contents: Contents) -> JsResult<()> {
        if self.auto_attach.borrow().is_none() || contents.is_destroyed() {
            return Ok(());
        }
        if !contents.is_undecided()? {
            return self.attach(contents, None).map(drop);
        }
        let waiting = Rc::new(RefCell::new(None::<Rc<Observer>>));
        let (connection, slot, decided) =
            (Rc::downgrade(self), Rc::clone(&waiting), contents.clone());
        let observer = Observer::new(false, move |news| {
            if let News::GuestCommitted | News::DocumentCreated | News::Destroyed = news
                && let Some(observer) = slot.take()
            {
                decided.unobserve(&observer);
                if let Some(connection) = connection.upgrade() {
                    connection.attach_soon(decided.clone());
                }
            }
            Ok(())
        });
        contents.observe(&observer);
        waiting.replace(Some(observer));
        Ok(())
    }

    fn set_auto_attach(self: &Rc<Self>, is_on: bool) -> JsResult<()> {
        if is_on == self.auto_attach.borrow().is_some() {
            return Ok(());
        }
        let event = js("web-contents-created")?;
        if let Some(listener) = self.auto_attach.take() {
            return invoke(app::object(), "off", &[event, listener.get()]).map(drop);
        }
        let connection = Rc::downgrade(self);
        let listener = procedure(move |arguments| {
            if let Some(connection) = connection.upgrade() {
                (cast(argument(arguments, 1)).into_iter())
                    .for_each(|it| connection.attach_soon(Contents::new(it)));
            }
            Ok(())
        })?;
        self.auto_attach.replace(Some(keep(listener)));
        invoke(app::object(), "on", &[event, listener])?;
        (contents::all().into_iter()).try_for_each(|it| self.attach_when_decided(it))
    }

    fn detach(&self, id: &str) {
        self.browser_sessions.borrow_mut().retain(|it| it != id);
        let is_it = |it: &Rc<ContentsSession>| it.parent.as_ref().is_some_and(|it| *it.0 == *id);
        let page = (self.pages.borrow().iter().filter_map(Weak::upgrade)).find(is_it);
        if let Some(page) = page {
            page.detach();
        }
    }

    fn run(self: &Rc<Self>, method: &str, params: &Value, from: Option<&str>) -> Outcome {
        let target = || contents::with_target_id(params["targetId"].text());
        match method {
            "Browser.close" => {
                later::soon(|_| invoke(app::object(), "quit", &[]).map(drop));
                Ok(Value::empty())
            }
            "Browser.getVersion" => Ok(record! {
                "protocolVersion": "1.3",
                "revision": "",
                "jsVersion": bun_core::Global::package_json_version,
                "product": product()?,
                "userAgent": user_agent()?,
            }),
            "Storage.clearCookies" => {
                session::default()?.remove_all_cookies();
                Ok(Value::empty())
            }
            "Storage.getCookies" => cookies(),
            "Storage.setCookies" => done(params["cookies"].items().iter().try_for_each(set_cookie)),
            "Target.attachToBrowserTarget" => {
                let id = random_id();
                self.browser_sessions.borrow_mut().push(id.clone());
                Ok(record! { "sessionId": id })
            }
            "Target.attachToTarget" => {
                Ok(self.attach(target().ok_or("No target with given id found")?, from)?)
            }
            "Target.closeTarget" => {
                target().map_or(Ok(()), |it| it.close_now())?;
                Ok(record! { "success": true })
            }
            "Target.detachFromTarget" => {
                self.detach(params["sessionId"].text());
                Ok(Value::empty())
            }
            "Target.getBrowserContexts" => Ok(record! { "browserContextIds": list![] }),
            "Target.getTargetInfo" => Ok(record! { "targetInfo": record! {
                "targetId": "browser",
                "type": "browser",
                "title": "",
                "url": "",
                "attached": true,
            } }),
            "Target.getTargets" => Ok(record! { "targetInfos": Value::List(targets()?) }),
            "Target.setAutoAttach" => done(self.set_auto_attach(params["autoAttach"].is_truthy())),
            _ => unknown(method),
        }
    }

    pub(super) fn receive(self: &Rc<Self>, text: &[u8]) {
        let Some(mut message) = Value::parse(text) else {
            return;
        };
        let params = Some(message.take("params")).filter(Value::is_truthy);
        let (params, method, id) = (
            params.unwrap_or_else(Value::empty),
            message["method"].text(),
            message["sessionId"].as_text(),
        );
        let (connection, about) = (Rc::clone(self), message.pick(&["id", "sessionId"]));
        let reply = move |outcome: Outcome| {
            connection.send(&match outcome {
                Ok(result) => about.with("result", result),
                Err(Failure(it)) => about.with("error", record! { "code": -32000, "message": it }),
            });
        };
        let known = (self.sessions.borrow().iter())
            .find_map(|it| (Some(&*it.0) == id).then(|| Rc::clone(&it.1)));
        let session = known.or_else(|| Some(Rc::clone(self.only.get()?) as Rc<dyn Session>));
        let is_of_browser =
            id.is_none_or(|id| self.browser_sessions.borrow().iter().any(|it| it == id));
        match session {
            Some(session) if !matches!(text::before(method, "."), "Browser" | "Storage") => {
                session.handle(method, params, Box::new(reply));
            }
            None if !is_of_browser => reply(Err("Session with given id not found.".into())),
            _ => reply(self.run(method, &params, id)),
        }
    }

    pub(super) fn close(self: &Rc<Self>) -> JsResult<()> {
        if let Some(only) = self.only.get() {
            only.close();
        }
        self.sessions.take().iter().for_each(|it| it.1.close());
        self.set_auto_attach(false)
    }
}
