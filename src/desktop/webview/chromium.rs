//! An installed Chrome, Chromium or Edge as the web engine: what the helper does with the API of Electron, as far as
//! the DevTools protocol goes.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use bun_web::pattern::{MatchPattern, UrlFilter};
use bun_web::scheme;
use bun_web::url::Url;

use super::chromium_page::{Frame, Page};
use super::engine::{self, Call, Engine, Failure, Order, Reply, Target};
use super::notices;
use crate::prelude::*;
use crate::task::{self, Later, Sequence};
use crate::text::{base64, from_base64, origin_of, split, split_once};
use crate::value::{Value, quote};

pub(super) const WORLD: &str = "bun:desktop:frame";
const CLIPBOARD: &str = "https://clipboard.invalid";
const MEDIA: &str = "https://media.invalid";
const SAME_SITE: [(&str, &str); 3] = [
    ("strict", "Strict"),
    ("lax", "Lax"),
    ("no_restriction", "None"),
];

/// Chrome has no custom schemes. `app://host/` is `https://host.app.invalid/` to it.
pub(super) fn to_engine(href: &str) -> String {
    let is_custom = |it: &Url| {
        !matches!(
            it.scheme(),
            b"http" | b"https" | b"file" | b"ws" | b"wss" | b"ftp"
        ) && !it.host().is_empty()
            && scheme::is_standard(it.scheme())
    };
    match Url::parse(href.as_bytes()).filter(is_custom) {
        Some(url) => {
            let rest = href.get(origin_of(href).len()..).unwrap_or_default();
            format!(
                "https://{}.{}.invalid{rest}",
                string(url.host()),
                string(url.scheme())
            )
        }
        None => href.to_owned(),
    }
}

pub(super) fn from_engine(href: &str) -> String {
    let convert = || {
        let after_scheme = href.strip_prefix("https://")?;
        let (host, rest) = after_scheme.split_at(crate::text::before(after_scheme, "/").len());
        let (host, scheme) =
            bun_core::strings::rsplit_once_char(host.strip_suffix(".invalid")?.as_bytes(), b'.')?;
        scheme::is_standard(scheme).then(|| format!("{}://{}{rest}", string(scheme), string(host)))
    };
    convert().unwrap_or_else(|| href.to_owned())
}

pub(super) fn switches(profile: &str) -> impl Iterator<Item = String> {
    let fixed = [
        "--remote-debugging-pipe",
        "--headless",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-startup-window",
        "--disable-auto-reload",
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        // What comes out of it cannot be held up.
        "--disable-back-forward-cache",
        "--deny-permission-prompts",
        // The handler of the app decides.
        "--disable-popup-blocking",
    ];
    fixed
        .into_iter()
        .map(String::from)
        .chain([format!("--user-data-dir={profile}")])
}

pub(super) fn unsupported(what: &str) -> Failure {
    Failure::new(format!(
        "{what} needs Electron as the web engine. See app.setWebEngine()."
    ))
}

fn header(name: &Value, value: impl Into<Value>) -> Value {
    record! { "name": name, "value": value }
}

fn to_headers(headers: &Value) -> Value {
    let each = |(name, value): &(Value, Value)| match value.is_list() {
        true => value
            .items()
            .iter()
            .map(|it| header(name, it.display()))
            .collect(),
        false => vec![header(name, value.display())],
    };
    headers.members().iter().flat_map(each).collect()
}

struct Filter {
    urls: UrlFilter,
    types: Value,
}

#[derive(Default)]
pub(super) struct Session {
    id: i32,
    pub(super) context: RefCell<Value>,
    pub(super) user_agent: RefCell<Option<String>>,
    schemes: RefCell<BTreeSet<String>>,
    filters: RefCell<BTreeMap<&'static str, Filter>>,
    proxy: RefCell<Value>,
    visited: RefCell<BTreeSet<String>>,
    cookies: RefCell<BTreeMap<String, Value>>,
}

#[derive(Default)]
pub(super) struct Backend {
    pub(super) user_agent: String,
    pub(super) media: RefCell<Value>,
    /// By the ids of their frames.
    pub(super) pages: RefCell<BTreeMap<Box<str>, Rc<Page>>>,
    pub(super) frame_added: RefCell<Later<()>>,
    last_id: Cell<i32>,
    sessions: RefCell<BTreeMap<i32, Rc<Session>>>,
    views: RefCell<BTreeMap<i32, Rc<Page>>>,
    /// The calls for the windows that a page is about to open.
    expected: RefCell<BTreeMap<i32, Vec<Call>>>,
    queue: Sequence,
    clipboard: RefCell<Option<Later<Result<Rc<str>, Failure>>>>,
}

impl Backend {
    pub(super) fn new(user_agent: String) -> Backend {
        Backend {
            user_agent,
            media: Value::empty().into(),
            ..Default::default()
        }
    }

    pub(super) fn close(&self) {
        drop((self.pages.take(), self.views.take()));
    }
}

#[derive(Clone)]
pub(super) struct Browser(pub(super) Rc<Engine>);

impl core::ops::Deref for Browser {
    type Target = Backend;

    fn deref(&self) -> &Backend {
        &self.0.backend
    }
}

/// A request that is paused.
struct Paused<'a> {
    browser: &'a Browser,
    params: &'a Value,
}

impl Paused<'_> {
    async fn reply(&self, method: &str, more: Value) -> Result<(), Failure> {
        self.browser
            .inspect(method, more.with("requestId", &self.params["requestId"]))
            .await
            .map(drop)
    }

    async fn refuse(&self, reason: &str) -> Result<(), Failure> {
        self.reply("Fetch.failRequest", record! { "errorReason": reason })
            .await
    }

    async fn fulfill(
        &self,
        status: impl Into<Value>,
        headers: Value,
        body: &[u8],
    ) -> Result<(), Failure> {
        let response =
            record! { "responseCode": status, "responseHeaders": headers, "body": base64(body) };
        self.reply("Fetch.fulfillRequest", response).await
    }

    async fn fulfill_with_html(&self, html: &str) -> Result<(), Failure> {
        self.fulfill(
            200,
            list![header(&"content-type".into(), "text/html")],
            html.as_bytes(),
        )
        .await
    }
}

impl Browser {
    pub(super) fn start(self) {
        let browser = self.clone();
        self.0.listen(
            "",
            Rc::new(move |method, params| browser.notice(method, params)),
        );
        let pages = list![record! { "type": "page" }];
        let discovered = self.inspect(
            "Target.setDiscoverTargets",
            record! { "discover": true, "filter": &pages },
        );
        let attach = record! { "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true, "filter": pages };
        let steps = [
            discovered,
            self.inspect("Target.setAutoAttach", attach),
            self.update_interception(),
        ];
        self.queue.add(async {
            for step in steps {
                let _ = step.await;
            }
        });
    }

    fn notice(&self, method: &str, params: &Value) -> JsResult<()> {
        match method {
            "Fetch.requestPaused" => {
                let (browser, params) = (self.clone(), params.clone());
                task::spawn(async move {
                    let paused = Paused {
                        browser: &browser,
                        params: &params,
                    };
                    if browser.intercept(&paused).await.is_err() {
                        let _ = paused.refuse("Failed").await;
                    }
                });
                Ok(())
            }
            "Target.attachedToTarget" if params["waitingForDebugger"].is_truthy() => {
                self.opened(params);
                Ok(())
            }
            "Target.targetDestroyed" => self.destroyed(params["targetId"].text()),
            "Browser.downloadWillBegin" => {
                let frame = params["frameId"].text();
                self.page(frame).map_or(Ok(()), |page| {
                    let name = params["suggestedFilename"].as_text();
                    page.download(params["url"].text(), Some(page.wish_in(frame, name)?))
                })
            }
            _ => Ok(()),
        }
    }

    pub(super) fn new_id(&self) -> i32 {
        self.last_id.update(|it| it + 1);
        self.last_id.get()
    }

    fn inspect(&self, method: &str, params: Value) -> engine::Awaited {
        self.0.inspect(method, params, "")
    }

    fn page(&self, frame: &str) -> Option<Rc<Page>> {
        self.pages.borrow().get(frame).cloned()
    }

    /// A request of a frame can overtake the news that there is such a frame.
    async fn page_that_gets(&self, frame: &str) -> Option<Rc<Page>> {
        while self.page(frame).is_none() && !frame.is_empty() && self.sessions.borrow().len() > 1 {
            let added = self.frame_added.borrow().clone();
            task::within(5000, added).await?;
        }
        self.page(frame)
    }

    fn view(&self, id: i32) -> Option<Rc<Page>> {
        self.views.borrow().get(&id).cloned()
    }

    fn session(&self, id: i32) -> Result<Rc<Session>, Failure> {
        self.sessions
            .borrow()
            .get(&id)
            .cloned()
            .ok_or_else(|| Failure::new("Object has been destroyed"))
    }

    pub(super) fn run(self, order: Order) {
        if let Order::Painted(id) = order {
            return self.view(id).map_or((), |it| it.acknowledge_frame());
        }
        let browser = self.clone();
        self.queue
            .add(async move { drop(browser.execute(order).await) });
    }

    fn update_interception(&self) -> engine::Awaited {
        let sessions = self.sessions.borrow();
        let listens = |name| {
            sessions
                .values()
                .any(|it| it.filters.borrow().contains_key(name))
        };
        let is_handled = |scheme| {
            sessions
                .values()
                .any(|it| it.schemes.borrow().contains(scheme))
        };
        let sees_all = listens("onBeforeRequest")
            || listens("onBeforeSendHeaders")
            || is_handled("https")
            || is_handled("http");
        let mut patterns = match sees_all {
            true => vec![record! {}],
            false => vec![
                record! { "resourceType": "Document" },
                record! { "urlPattern": "https://*.invalid/*" },
            ],
        };
        if listens("onHeadersReceived") {
            patterns.push(record! { "requestStage": "Response" });
        }
        self.inspect(
            "Fetch.enable",
            record! { "patterns": Value::List(patterns) },
        )
    }

    async fn ask(&self, session: &Session, event: &str, details: &Value, more: Value) -> Value {
        let is_wanted = session.filters.borrow().get(event).is_some_and(|it| {
            Url::parse(details["url"].text().as_bytes()).is_some_and(|url| it.urls.matches(&url))
                && (!it.types.is_list()
                    || it
                        .types
                        .items()
                        .iter()
                        .any(|it| it.is(details["resourceType"].text())))
        });
        let Some(of_app) = self.0.session(session.id).filter(|_| is_wanted) else {
            return Value::Undefined;
        };
        let answer = Later::default();
        let (details, given) = (details.clone().and(&more), answer.clone());
        let callback = Value::Function(Rc::new(move |it| given.set(it[0].clone())));
        task::report(of_app.call_request_listener(event, &details, &callback));
        answer.await
    }

    async fn request(&self, mut message: Vec<Value>) -> Reply {
        message.resize_with(5, Default::default);
        notices::answer_later(&self.0, &message)
            .await
            .map_err(Failure::new)
    }

    async fn intercept(&self, paused: &Paused<'_>) -> Result<(), Failure> {
        let (params, request) = (paused.params, &paused.params["request"]);
        let (frame, kind, href) = (
            params["frameId"].text(),
            params["resourceType"].text(),
            request["url"].text(),
        );
        if matches!(href.strip_suffix('/'), Some(CLIPBOARD | MEDIA)) {
            return paused.fulfill_with_html("").await;
        }
        let is_document = kind == "Document";
        let page = match is_document {
            true => self.page_that_gets(frame).await,
            false => self.page(frame),
        };
        if let Some(page) = page.as_ref().filter(|_| is_document) {
            page.news.finished().await;
        }
        let main_page = page
            .as_ref()
            .filter(|it| is_document && *it.target == *frame);
        let (is_main_frame, expecting) =
            (main_page.is_some(), main_page.filter(|it| it.is_expected()));
        let stub = expecting
            .and_then(|it| it.stub.borrow().clone())
            .filter(|it| it.0 == href);
        match stub {
            Some(_) if href.starts_with("file:") => {
                return paused.reply("Fetch.continueRequest", record! {}).await;
            }
            Some((_, html)) => return paused.fulfill_with_html(&html).await,
            None => {}
        }
        // A worker has no frame. What cannot be put to the listeners of a session that has some does not go out.
        let only = Some(self.sessions.borrow())
            .filter(|it| it.len() == 1)
            .and_then(|it| it.values().next().cloned());
        let Some(session) = page.as_ref().map(|it| Rc::clone(&it.owner)).or(only) else {
            return paused.refuse("BlockedByClient").await;
        };
        let url = from_engine(href);
        if is_document {
            session.visited.borrow_mut().insert(origin_of(&url));
        }
        let digits = params["requestId"]
            .text()
            .bytes()
            .filter(u8::is_ascii_digit);
        let details = record! {
            "id": digits.fold(0u64, |all, it| (all * 10 + u64::from(it - b'0')) % 10u64.pow(15)) as f64,
            "url": &*url,
            "method": &request["method"],
            "timestamp": bun_core::time::milli_timestamp() as f64,
            "resourceType": match kind {
                _ if is_main_frame => "mainFrame",
                "Document" => "subFrame",
                "Stylesheet" => "stylesheet",
                "Script" => "script",
                "Image" => "image",
                "Font" => "font",
                "Media" => "media",
                "XHR" | "Fetch" | "EventSource" => "xhr",
                "Ping" => "ping",
                "WebSocket" => "webSocket",
                _ => "other",
            },
            "referrer": from_engine(request["headers"]["Referer"].text()),
            "webContents": page.as_ref().map(|it| Value::Handle(vec!["view".into(), it.id.into()])),
            "frame": page.as_ref().map(|it| it.handle(frame)),
        };
        if let Some(status) = params["responseStatusCode"].as_number() {
            let mut grouped = Value::empty();
            for it in params["responseHeaders"].items() {
                let values = grouped
                    .take(it["name"].text())
                    .into_items()
                    .into_iter()
                    .chain([it["value"].clone()]);
                grouped.set(it["name"].text(), values.collect::<Value>());
            }
            let line = format!("HTTP/1.1 {status} {}", params["responseStatusText"].text());
            let received =
                record! { "responseHeaders": grouped, "statusCode": status, "statusLine": line };
            let answer = self
                .ask(&session, "onHeadersReceived", &details, received)
                .await;
            if answer["cancel"].is_truthy() {
                return paused.refuse("BlockedByClient").await;
            }
            let changed = match answer["responseHeaders"].is_truthy() {
                true => {
                    record! { "responseCode": status, "responseHeaders": to_headers(&answer["responseHeaders"]) }
                }
                false => record! {},
            };
            return paused.reply("Fetch.continueResponse", changed).await;
        }
        if params["responseErrorReason"].is_truthy() {
            return paused.reply("Fetch.continueRequest", record! {}).await;
        }
        let is_redirect = params["redirectedRequestId"].is_truthy();
        if let Some(page) = page
            .as_ref()
            .filter(|_| is_document && (is_redirect || expecting.is_none()))
        {
            let names: &[&str] = match (is_redirect, is_main_frame) {
                (true, _) => &["will-redirect"],
                (_, true) => &["will-frame-navigate", "will-navigate"],
                _ => &["will-frame-navigate"],
            };
            let whole = format!("{url}{}", request["urlFragment"].text());
            let referrer = request["headers"]["Referer"].text();
            if names
                .iter()
                .any(|name| page.emit_navigation(name, frame, &whole, false, referrer))
            {
                return paused.refuse("Aborted").await;
            }
            if is_redirect {
                page.emit_navigation("did-redirect-navigation", frame, &whole, false, referrer);
            }
        }
        let before = self
            .ask(&session, "onBeforeRequest", &details, record! {})
            .await;
        if before["cancel"].is_truthy() {
            return paused.refuse("BlockedByClient").await;
        }
        if before["redirectURL"].is_truthy() {
            let location = header(&"location".into(), to_engine(before["redirectURL"].text()));
            return paused.fulfill(307, list![location], b"").await;
        }
        if let Some(page) = main_page.filter(|_| is_redirect) {
            page.request.take();
        }
        let asked = (expecting.map(|it| it.given_for(href))).unwrap_or_default();
        let mut headers = request["headers"].clone();
        for (name, value) in
            split(asked["extraHeaders"].text(), "\n").filter_map(|it| split_once(it, ":"))
        {
            headers.set(name, value.trim());
        }
        let mut sending = self
            .ask(
                &session,
                "onBeforeSendHeaders",
                &details,
                record! { "requestHeaders": &headers },
            )
            .await;
        if sending["cancel"].is_truthy() {
            return paused.refuse("BlockedByClient").await;
        }
        if sending["requestHeaders"].is_truthy() {
            headers = sending.take("requestHeaders");
        }
        let scheme = crate::text::before(&url, ":");
        if !session.schemes.borrow().contains(scheme) {
            let body = asked["postData"][0]["bytes"].as_bytes();
            let (method, body) = (body.map(|_| "POST"), body.map(|it| base64(it)));
            let changed =
                record! { "headers": to_headers(&headers), "method": method, "postData": body };
            return paused.reply("Fetch.continueRequest", changed).await;
        }
        let parts = request["postDataEntries"]
            .items()
            .iter()
            .flat_map(|it| from_base64(it["bytes"].text()));
        let body = request["postDataEntries"]
            .is_list()
            .then(|| Value::buffer(&parts.collect::<Vec<u8>>()));
        let description = record! { "url": &*url, "method": &request["method"], "headers": headers, "body": body };
        let id = self.new_id();
        let response = self
            .request(vec![
                "fetch".into(),
                session.id.into(),
                scheme.into(),
                id.into(),
                description,
            ])
            .await?;
        if !response.is_truthy() {
            return paused.refuse("Failed").await;
        }
        let mut body = Vec::new();
        while response["hasBody"].is_truthy()
            && let Value::Bytes(_, chunk) = self.request(vec!["pull".into(), id.into()]).await?
        {
            body.extend_from_slice(&chunk);
        }
        let convert = |it: &Value| match it[0].is("location") {
            true => header(&it[0], to_engine(it[1].text())),
            false => header(&it[0], &it[1]),
        };
        paused
            .fulfill(
                &response["status"],
                response["headers"].items().iter().map(convert).collect(),
                &body,
            )
            .await
    }

    async fn adopt(
        &self,
        options: &Value,
        target: &str,
        session: Rc<str>,
        has_opener: bool,
    ) -> Result<Rc<Page>, Failure> {
        let page = Page::new(
            self.clone(),
            options,
            target,
            Rc::clone(&session),
            self.session(options["session"].int())?,
        );
        self.views.borrow_mut().insert(page.id, Rc::clone(&page));
        page.has_relatives.set(has_opener);
        page.add_frame(target, &session, "");
        let frame = record! { "frame": page.handle(target) };
        page.emit("frame-created", record! {}, vec![frame]);
        if options["isFrame"].is_truthy()
            && let Ok(Ok((wire, sources))) = catch(engine::sources())
        {
            let source = format!(
                "{{{wire}
                const send = (_, bytes) => toApp(bytes.toBase64());
                const on = (_, listener) => (globalThis.fromApp = text => listener(0, Uint8Array.fromBase64(text)));
                const require = () => ({{ ipcRenderer: {{ send, on }} }});
                {}}}",
                &*sources.frame
            );
            page.tell(
                "Runtime.addBinding",
                record! { "name": "toApp", "executionContextName": WORLD },
            );
            page.tell(
                "Page.addScriptToEvaluateOnNewDocument",
                record! { "source": source, "worldName": WORLD },
            );
        }
        page.set_background([0; 4]);
        drop(page.resize());
        page.attach(session).await;
        page.tell("Page.startScreencast", record! { "format": "png" });
        if let Some(it) = self.0.view(page.id) {
            it.view.target_id.set(Some(target.into()));
        }
        let calls = self.expected.borrow_mut().remove(&page.id);
        calls
            .into_iter()
            .flatten()
            .for_each(|it| self.clone().run(Order::Call(it)));
        Ok(page)
    }

    fn opened(&self, params: &Value) {
        let (session, target) = (params["sessionId"].text(), &params["targetInfo"]);
        let Some(opener) = self.page(target["openerId"].text()) else {
            self.0
                .command("Runtime.runIfWaitingForDebugger", record! {}, session);
            return self
                .0
                .command("Target.detachFromTarget", params.pick(&["sessionId"]), "");
        };
        let opening = opener.opening.take();
        let features: Vec<&str> = opening["windowFeatures"]
            .items()
            .iter()
            .map(Value::text)
            .collect();
        let details = record! {
            "url": from_engine(opening["url"].as_text().unwrap_or_else(|| target["url"].text())),
            "frameName": Some(opening["windowName"].text()).filter(|it| *it != "_blank").unwrap_or_default(),
            "features": features.join(","),
            "disposition": "new-window",
            "referrer": record! { "url": opener.url(), "policy": "strict-origin-when-cross-origin" },
        };
        let options = notices::answer(
            &self.0,
            &mut [
                "open".into(),
                opener.id.into(),
                details,
                0.into(),
                0.into(),
                0.into(),
            ],
        );
        if options.is_truthy() {
            opener.has_relatives.set(true);
            let (browser, target, session) =
                (self.clone(), target["targetId"].display(), session.into());
            return task::spawn(async move {
                drop(browser.adopt(&options, &target, session, true).await)
            });
        }
        self.0
            .command("Target.closeTarget", target.pick(&["targetId"]), "");
        self.0
            .command("Runtime.runIfWaitingForDebugger", record! {}, session);
    }

    fn destroyed(&self, target: &str) -> JsResult<()> {
        let Some(page) = self.page(target).filter(|it| *it.target == *target) else {
            return Ok(());
        };
        page.abort("ERR_FAILED", -2);
        page.remove_frame(target);
        self.views.borrow_mut().remove(&page.id);
        self.0.ignore(&page.session);
        page.read_cookies();
        self.0.view(page.id).map_or(Ok(()), |it| it.destroyed())
    }

    pub(super) async fn read_cookies(self, session: Rc<Session>) {
        let context = record! { "browserContextId": &*session.context.borrow() };
        let Ok(found) = self.inspect("Storage.getCookies", context).await else {
            return;
        };
        let mut now = BTreeMap::new();
        for it in found["cookies"]
            .items()
            .iter()
            .filter(|it| !it["partitionKey"].is_truthy())
        {
            let same_site = SAME_SITE
                .iter()
                .find(|name| it["sameSite"].is(name.1))
                .map_or("unspecified", |it| it.0);
            let mut cookie = (it.pick(&[
                "name", "value", "domain", "path", "secure", "httpOnly", "session",
            ]))
            .with("hostOnly", !it["domain"].text().starts_with('.'))
            .with("sameSite", same_site);
            if !it["session"].is_truthy() {
                cookie.set("expirationDate", &it["expires"]);
            }
            now.insert(
                ["domain", "path", "name"]
                    .map(|name| it[name].text())
                    .join("\n"),
                cookie,
            );
        }
        let before = session.cookies.replace(now.clone());
        let removed = before
            .iter()
            .filter(|it| !now.contains_key(it.0))
            .map(|it| (it.1, true));
        let is_new = |it: &(&String, &Value)| {
            before
                .get(it.0)
                .is_none_or(|old| old.to_json() != it.1.to_json())
        };
        for (cookie, is_removed) in removed.chain(now.iter().filter(is_new).map(|it| (it.1, false)))
        {
            let of_app = self.0.session(session.id);
            task::report(of_app.map_or(Ok(()), |it| {
                it.receive_cookie(cookie, "explicit", is_removed)
            }));
        }
    }

    /// Returns its target and a session.
    async fn open_own_page(
        &self,
        origin: &str,
        permissions: Value,
    ) -> Result<(Value, Rc<str>), Failure> {
        let context = self
            .inspect("Target.createBrowserContext", record! {})
            .await?;
        self.inspect(
            "Browser.grantPermissions",
            record! { "origin": origin, "permissions": permissions }.and(&context),
        )
        .await?;
        let target = self
            .inspect("Target.createTarget", context.with("url", "about:blank"))
            .await?
            .take("targetId");
        let session = self.0.attach(target.text()).await?;
        self.0
            .inspect(
                "Emulation.setFocusEmulationEnabled",
                record! { "enabled": true },
                &session,
            )
            .await?;
        self.0
            .inspect(
                "Page.navigate",
                record! { "url": format!("{origin}/") },
                &session,
            )
            .await?;
        Ok((target, session))
    }

    /// The browser has a clipboard of its own, which only a page can use.
    async fn use_clipboard(&self, expression: &str) -> Reply {
        let browser = self.clone();
        let open = async move {
            Ok(browser
                .open_own_page(
                    CLIPBOARD,
                    list!["clipboardReadWrite", "clipboardSanitizedWrite"],
                )
                .await?
                .1)
        };
        let session = self
            .clipboard
            .borrow_mut()
            .get_or_insert_with(|| Later::of(open))
            .clone();
        let params =
            record! { "expression": expression, "awaitPromise": true, "returnByValue": true };
        Ok(self
            .0
            .inspect("Runtime.evaluate", params, &session.await?)
            .await?
            .take("result")
            .take("value"))
    }

    fn frame(&self, id: i32) -> Option<(Rc<Page>, Rc<Frame>)> {
        self.views
            .borrow()
            .values()
            .find_map(|page| Some((Rc::clone(page), page.frame_with_id(id)?)))
    }

    async fn perform(self, target: Target, method: Box<str>, arguments: Value) -> Reply {
        let first = &arguments[0];
        match (target, &*method) {
            (Target::View(id) | Target::Window(id), method) => {
                self.view(id)
                    .ok_or_else(|| unsupported(method))?
                    .perform(method, &arguments)
                    .await
            }
            (Target::Object(id), "executeJavaScript") => {
                let (page, frame) = self
                    .frame(id)
                    .ok_or_else(|| Failure::new("Object has been destroyed"))?;
                page.evaluate(&first.display(), &frame, None, false).await
            }
            (Target::Object(id), "reload") => Ok(self
                .frame(id)
                .map(|it| it.0.tell("Page.reload", record! {}))
                .is_some()
                .into()),
            (Target::Module("clipboard"), "readText") => {
                self.use_clipboard("navigator.clipboard.readText()").await
            }
            (Target::Module("clipboard"), _) => {
                self.use_clipboard(&format!(
                    "navigator.clipboard.writeText({})",
                    quote(first.text())
                ))
                .await
            }
            (Target::Session(id), "setUserAgent") => {
                self.session(id)?
                    .user_agent
                    .replace(first.as_text().map(str::to_owned));
                Ok(Value::Undefined)
            }
            (Target::Session(id), "setProxy") => {
                if first["pacScript"].is_truthy() || first["mode"].is("auto_detect") {
                    return Err(unsupported("A PAC script"));
                }
                let server = match first["mode"].text() {
                    "direct" => "direct://".into(),
                    "system" => Value::Undefined,
                    _ => first["proxyRules"].clone(),
                };
                let proxy = record! { "proxyServer": server, "proxyBypassList": &first["proxyBypassRules"] };
                self.renew(&*self.session(id)?, proxy).await
            }
            (Target::Session(id), "clearData" | "clearStorageData") => {
                self.clear(&self.session(id)?, first).await
            }
            (Target::Session(_), method)
                if ["clear", "close", "force", "setSpell", "disableNetwork"]
                    .iter()
                    .any(|it| method.starts_with(it)) =>
            {
                Ok(Value::Undefined)
            }
            (_, method) => Err(unsupported(method)),
        }
    }

    /// The cookies come from the app, which has removed those that have to go.
    async fn clear(&self, session: &Rc<Session>, options: &Value) -> Reply {
        const KINDS: [(&str, &str); 7] = [
            ("cachestorage", "cache_storage"),
            ("filesystem", "file_systems"),
            ("filesystems", "file_systems"),
            ("indexdb", "indexeddb"),
            ("indexeddb", "indexeddb"),
            ("localstorage", "local_storage"),
            ("serviceworkers", "service_workers"),
        ];
        let asked = [&options["storages"], &options["dataTypes"]]
            .into_iter()
            .find(|it| it.is_list());
        let is_asked = |name| {
            asked.is_none_or(|it| {
                it.items()
                    .iter()
                    .any(|it| it.text().eq_ignore_ascii_case(name))
            })
        };
        let kinds = KINDS
            .iter()
            .filter(|it| is_asked(it.0))
            .map(|it| it.1)
            .collect::<Vec<_>>()
            .join(",");
        let origins: Vec<String> = match (&options["origins"], options["origin"].as_text()) {
            (listed, _) if listed.is_list() => listed.items().iter().map(Value::display).collect(),
            (_, Some(origin)) => vec![origin.to_owned()],
            _ => {
                let is_kept = |it: &String| {
                    options["excludeOrigins"]
                        .items()
                        .iter()
                        .any(|kept| origin_of(kept.text()) == *it)
                };
                session
                    .visited
                    .borrow()
                    .iter()
                    .filter(|it| !is_kept(it))
                    .cloned()
                    .collect()
            }
        };
        if kinds.is_empty() || origins.is_empty() {
            return Ok(Value::Undefined);
        }
        let page = self
            .views
            .borrow()
            .values()
            .find(|it| Rc::ptr_eq(&it.owner, session))
            .cloned();
        let Some(page) = page else {
            let proxy = session.proxy.borrow().clone();
            return self.renew(session, proxy).await;
        };
        for origin in origins {
            let what = record! { "origin": origin_of(&to_engine(&(origin_of(&origin) + "/"))), "storageTypes": &*kinds };
            let _ = self
                .0
                .inspect("Storage.clearDataForOrigin", what, &page.session)
                .await;
        }
        Ok(Value::Undefined)
    }

    async fn renew(&self, session: &Session, proxy: Value) -> Reply {
        session.proxy.replace(proxy.clone());
        let context = self.inspect("Target.createBrowserContext", proxy).await?;
        let old = session.context.replace(context["browserContextId"].clone());
        self.inspect(
            "Browser.setDownloadBehavior",
            context.with("behavior", "deny").with("eventsEnabled", true),
        )
        .await?;
        let cookies = self
            .0
            .session(session.id)
            .map(|it| it.all_cookies())
            .unwrap_or_default();
        self.set_cookies(session, &cookies, &Value::Undefined).await;
        if old.is_truthy() {
            self.0.command(
                "Target.disposeBrowserContext",
                record! { "browserContextId": old },
                "",
            );
        }
        Ok(Value::Undefined)
    }

    async fn set_cookies(&self, session: &Session, stored: &Value, removed: &Value) {
        let set = |it: &Value, expires: &Value| {
            let cookie = (it.pick(&["name", "value", "domain", "path", "secure", "httpOnly"]))
                .with(
                    "sameSite",
                    SAME_SITE
                        .iter()
                        .find(|name| it["sameSite"].is(name.0))
                        .map(|it| it.1),
                )
                .with("expires", expires);
            let params = record! { "cookies": list![cookie], "browserContextId": &*session.context.borrow() };
            self.inspect("Storage.setCookies", params)
        };
        let removals = removed.items().iter().map(|it| set(it, &1.into()));
        let all: Vec<_> = removals
            .chain(
                stored
                    .items()
                    .iter()
                    .map(|it| set(it, &it["expirationDate"])),
            )
            .collect();
        for reply in all {
            let _ = reply.await;
        }
    }

    async fn execute(&self, order: Order) -> Result<(), Failure> {
        match order {
            Order::Call(call) => {
                if let Target::View(id) | Target::Window(id) = call.target
                    && let Some(calls) = self.expected.borrow_mut().get_mut(&id)
                {
                    calls.push(call);
                    return Ok(());
                }
                let Call {
                    reply,
                    target,
                    method,
                    arguments,
                    holds_up,
                } = call;
                let (browser, holds_up) = (self.clone(), holds_up || &*method == "setContentSize");
                let done = Later::of(async move {
                    let result = browser.clone().perform(target, method, arguments).await;
                    browser.0.settle(reply, result);
                });
                if holds_up {
                    done.await;
                }
            }
            Order::Media { reply } => {
                let opened = self
                    .open_own_page(MEDIA, list!["audioCapture", "speakerSelection"])
                    .await;
                self.0.settle(reply, opened.map(|it| it.0));
            }
            Order::Session { id, .. } => {
                let session = Rc::new(Session {
                    id,
                    ..Default::default()
                });
                self.sessions.borrow_mut().insert(id, Rc::clone(&session));
                self.renew(&session, record! {}).await?;
            }
            Order::Cookies {
                session,
                stored,
                removed,
            } => {
                self.set_cookies(&*self.session(session)?, &stored, &removed)
                    .await
            }
            Order::SendCookies { reply, session } => {
                self.clone().read_cookies(self.session(session)?).await;
                self.0.settle(reply, Ok(Value::Undefined));
            }
            Order::Expect(id) if self.view(id).is_none() => {
                drop(self.expected.borrow_mut().insert(id, Vec::new()))
            }
            Order::WebRequest {
                session,
                event,
                filter,
            } => {
                let session = self.session(session)?;
                session.filters.borrow_mut().remove(event);
                if filter.is_truthy() {
                    let patterns = |name: &str| {
                        filter[name]
                            .items()
                            .iter()
                            .filter_map(|it| MatchPattern::parse(it.text().as_bytes()))
                            .collect()
                    };
                    let urls = UrlFilter {
                        included: patterns("urls"),
                        excluded: patterns("excludeUrls"),
                    };
                    session.filters.borrow_mut().insert(
                        event,
                        Filter {
                            urls,
                            types: filter["types"].clone(),
                        },
                    );
                }
                self.update_interception().await?;
            }
            Order::Protocol {
                session,
                scheme,
                is_handled,
            } => {
                let session = self.session(session)?;
                match is_handled {
                    true => session.schemes.borrow_mut().insert(scheme),
                    false => session.schemes.borrow_mut().remove(&scheme),
                };
                self.update_interception().await?;
            }
            Order::Theme {
                is_dark,
                reduces_motion,
                increases_contrast,
                forces_colors,
                reduces_transparency,
            } => {
                let prefers = |what: &str, is_on: bool, on: &str, off: &str| {
                    record! { "name": format!("prefers-{what}"), "value": if is_on { on } else { off } }
                };
                let features = list![
                    prefers("color-scheme", is_dark, "dark", "light"),
                    prefers("reduced-motion", reduces_motion, "reduce", ""),
                    prefers("contrast", increases_contrast, "more", ""),
                    prefers("reduced-transparency", reduces_transparency, "reduce", ""),
                    record! { "name": "forced-colors", "value": if forces_colors { "active" } else { "" } }
                ];
                self.media.replace(record! { "features": features });
                for frame in self.views.borrow().values().flat_map(|it| it.frames()) {
                    self.0.command(
                        "Emulation.setEmulatedMedia",
                        self.media.borrow().clone(),
                        &frame.session.borrow(),
                    );
                }
            }
            Order::Create(options) => {
                let context = self
                    .session(options["session"].int())?
                    .context
                    .borrow()
                    .clone();
                let place = record! { "url": "about:blank", "newWindow": true, "browserContextId": context };
                let target = self
                    .inspect("Target.createTarget", place)
                    .await?
                    .take("targetId");
                let session = self.0.attach(target.text()).await?;
                let page = self.adopt(&options, target.text(), session, false).await?;
                let preload = &options["preferences"]["preload"];
                if preload.is_truthy() {
                    page.emit(
                        "preload-error",
                        record! {},
                        vec![preload.clone(), unsupported("preload").error],
                    );
                }
            }
            Order::Destroy(id) => {
                if let Some(page) = self.view(id) {
                    self.inspect("Target.closeTarget", record! { "targetId": &*page.target })
                        .await?;
                }
            }
            Order::Frame { view, message } => {
                if let Some(page) = self.view(view) {
                    let expression = format!("fromApp(\"{}\")", base64(&message));
                    page.tell(
                        "Runtime.evaluate",
                        record! { "expression": expression, "contextId": page.world() },
                    );
                }
            }
            _ => {}
        }
        Ok(())
    }
}
