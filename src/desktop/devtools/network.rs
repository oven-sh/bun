//! The domains `Network` and `Fetch`.

use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use bun_web::headers::HeaderList;
use bun_web::net::NetError;
use bun_web::net::body::{Body, Data, SharedBytes};
use bun_web::net::embedder::{About, Details, Outgoing, Paused, Received, RequestEvent};
use bun_web::net::response::{Answer, Cached, is_null_body_status};
use bun_web::request::{Destination, RequestBody};
use bun_web::time::wall_now;
use bun_web::url::Url;

use super::contents::Contents;
use super::{Emit, Failure, Outcome, seconds, target_id_of};
use crate::contents::inspection;
use crate::prelude::*;
use crate::session::load::{all_at_once, from_pairs, latin1};
use crate::task::{self, LocalFuture};
use crate::text;
use crate::value::Value;

const ROOM_FOR_BODIES: usize = 100 << 20;

/// `*` is any text, `?` any character, and a backslash escapes.
fn matches(pattern: &[u8], text: &[u8]) -> bool {
    let (mut pattern, mut text, mut retry) = (pattern, text, None);
    loop {
        match (pattern, text) {
            ([b'*', after @ ..], _) => (pattern, retry) = (after, Some((after, text))),
            ([b'?', after @ ..], [_, rest @ ..]) => (pattern, text) = (after, rest),
            ([b'\\', a, after @ ..], [b, rest @ ..]) if a == b => (pattern, text) = (after, rest),
            ([a, after @ ..], [b, rest @ ..]) if a == b && (*a != b'\\' || after.is_empty()) => {
                (pattern, text) = (after, rest);
            }
            ([], []) => return true,
            _ => match retry {
                Some((after, [_, rest @ ..])) => {
                    (pattern, text, retry) = (after, rest, Some((after, rest)));
                }
                _ => return false,
            },
        }
    }
}

struct Known {
    id: u32,
    kind: &'static str,
    redirect: Value,
    sent: f64,
}

#[derive(Default)]
struct State {
    watchers: RefCell<Vec<Weak<Watcher>>>,
    requests: RefCell<Vec<Known>>,
    last_pause: Cell<u32>,
}

state!(fn state() -> State);

/// For one session.
pub(super) struct Watcher {
    contents: Contents,
    emit: Emit,
    reports: Cell<bool>,
    patterns: RefCell<Vec<String>>,
    paused: RefCell<Vec<(String, task::Sender<Value>)>>,
    bodies: RefCell<VecDeque<Kept>>,
    /// The last of each parameter of the commands that change how requests fare.
    conditions: RefCell<Value>,
    /// The request for the document that is to come.
    next_loader: RefCell<Option<String>>,
    /// The token of a document, and the request that it has come from.
    loader: RefCell<(String, String)>,
}

struct Kept {
    request: String,
    url: String,
    body: SharedBytes,
}

fn watchers_of(contents: JSValue) -> Vec<Rc<Watcher>> {
    let all = state().watchers.borrow();
    let all = all.iter().filter_map(Weak::upgrade);
    all.filter(|it| it.contents.object() == contents).collect()
}

fn watchers_of_page(page: JSValue) -> Vec<Rc<Watcher>> {
    inspection::around(page).map_or_else(Vec::new, |it| watchers_of(it.to_js()))
}

impl Watcher {
    pub(super) fn new(contents: Contents, emit: Emit) -> Rc<Watcher> {
        Rc::new(Watcher {
            contents,
            emit,
            reports: Cell::default(),
            patterns: RefCell::default(),
            paused: RefCell::default(),
            bodies: RefCell::default(),
            conditions: Value::empty().into(),
            next_loader: RefCell::default(),
            loader: RefCell::default(),
        })
    }

    fn update(self: &Rc<Self>) -> JsResult<()> {
        let pauses = !self.patterns.borrow().is_empty();
        if !pauses {
            self.paused.take();
        }
        bun_web::net::session::set_any_inspected();
        let mut watchers = state().watchers.borrow_mut();
        watchers.retain(|it| it.as_ptr() != Rc::as_ptr(self));
        if self.reports.get() || pauses {
            watchers.push(Rc::downgrade(self));
        }
        drop(watchers);
        (self.contents).inspect_network(!watchers_of(self.contents.object()).is_empty());
        Ok(())
    }

    pub(super) fn report(self: &Rc<Self>, reports: bool) -> JsResult<()> {
        self.reports.set(reports);
        self.update()
    }

    pub(super) fn intercept(self: &Rc<Self>, patterns: Vec<String>) -> JsResult<()> {
        self.patterns.replace(patterns);
        self.update()
    }

    pub(super) fn close(self: &Rc<Self>) -> JsResult<()> {
        self.reports.set(false);
        self.intercept(Vec::new())
    }

    pub(super) fn resume(&self, params: Value) -> Outcome {
        let mut paused = self.paused.borrow_mut();
        let at = paused.iter().position(|it| params["requestId"].is(&it.0));
        let (_, request) = paused.swap_remove(at.ok_or("Invalid InterceptionId.")?);
        request.send(params);
        Ok(Value::empty())
    }

    fn body_of(&self, params: &Value) -> Result<SharedBytes, Failure> {
        let bodies = self.bodies.borrow();
        let found = bodies.iter().find(|it| params["requestId"].is(&it.request));
        Ok((found.ok_or("No resource with given identifier found")?.body).clone())
    }

    pub(super) fn body(&self, params: &Value) -> Outcome {
        Ok(record! { "body": text::base64(&self.body_of(params)?), "base64Encoded": true })
    }

    pub(super) fn search(&self, params: &Value) -> Outcome {
        Ok(record! { "result": super::scripts::search(&string(&self.body_of(params)?), params) })
    }

    pub(super) fn body_from(&self, url: &str) -> Option<SharedBytes> {
        let bodies = self.bodies.borrow();
        Some(bodies.iter().rfind(|it| it.url == url)?.body.clone())
    }

    pub(super) fn change_conditions(&self, params: &Value) {
        self.conditions.replace(self.conditions.take().and(params));
    }

    pub(super) fn loader(&self) -> String {
        let token = self.contents.token();
        if self.loader.borrow().0 != token {
            let request = self.next_loader.take().unwrap_or_else(|| token.clone());
            self.loader.replace((token, request));
        }
        self.loader.borrow().1.clone()
    }

    fn obstacle(&self, url: &Url) -> Option<NetError> {
        let conditions = self.conditions.borrow();
        let is_blocked = |it: &Value| matches(format!("*{}*", it.text()).as_bytes(), url.href());
        if conditions["urls"].items().iter().any(is_blocked) {
            return Some(NetError::BlockedByClient);
        }
        (conditions["offline"].is_truthy() && url.is_http())
            .then_some(NetError::InternetDisconnected)
    }

    fn tell(&self, method: &str, params: &Value) -> JsResult<()> {
        if self.reports.get() {
            let about = record! {
                "frameId": &*target_id_of(self.contents.object()),
                "loaderId": match params["type"].is("Document") {
                    true => params["requestId"].display(),
                    false => self.loader(),
                },
                "documentURL": self.contents.page().url(),
                "timestamp": seconds(),
            };
            (self.emit)(method, about.and(params));
        }
        Ok(())
    }

    fn pause(&self, url: &[u8], about: &Value) -> Option<task::Receiver<Value>> {
        let is_wanted = (self.patterns.borrow().iter()).any(|it| matches(it.as_bytes(), url));
        if !is_wanted || url.starts_with(b"data:") {
            return None;
        }
        state().last_pause.update(|it| it + 1);
        let (id, (resume, answer)) = (
            format!("paused.{}", state().last_pause.get()),
            task::oneshot(),
        );
        self.paused.borrow_mut().push((id.clone(), resume));
        (self.emit)(
            "Fetch.requestPaused",
            record! {
                "requestId": id,
                "networkId": &about["requestId"],
                "request": &about["request"],
                "resourceType": &about["type"],
                "frameId": &*target_id_of(self.contents.object()),
            },
        );
        Some(answer)
    }
}

pub(super) fn record_of(headers: &HeaderList, separator: &str) -> Value {
    let member = |name| {
        let values = headers.values(name).map(latin1).collect::<Vec<_>>();
        let name = latin1(name).to_ascii_lowercase();
        (name.into(), values.join(separator).into())
    };
    Value::Record(headers.combined().map(|it| member(it.0)).collect())
}

fn timing(sent: f64) -> Value {
    let waited = (seconds() - sent) * 1e3;
    let known = record! {
        "requestTime": sent,
        "sendStart": 0,
        "sendEnd": 0,
        "pushStart": 0,
        "pushEnd": 0,
        "receiveHeadersStart": waited,
        "receiveHeadersEnd": waited,
    };
    let unknown = ["proxy", "dns", "connect", "ssl"].map(|it| [it, "Start", it, "End"]);
    let unknown = unknown
        .as_flattened()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|it| it.concat());
    let unknown = unknown.chain(["workerStart".into(), "workerReady".into()]);
    unknown.fold(known, |all, it| all.with(&it, -1))
}

fn describe(about: &About, response: &Received, sent: f64) -> Value {
    let kind = latin1(&response.headers.get_or_empty(b"content-type"));
    let charset = response
        .headers
        .mime()
        .and_then(|it| it.parameter(b"charset").map(latin1));
    record! {
        "url": string(about.url.href()),
        "status": i32::from(response.status),
        "statusText": latin1(&response.status_text),
        "headers": record_of(&response.headers, "\n"),
        "mimeType": text::before(&kind, ";"),
        "fromDiskCache": response.cached != Cached::No,
        "charset": charset.unwrap_or_default(),
        "encodedDataLength": 0,
        "securityState": if about.url.scheme() == b"http" { "insecure" } else { "secure" },
        "timing": timing(sent),
    }
}

fn request_id(about: &About) -> String {
    format!("request.{}", about.id)
}

pub(crate) fn request_changed(
    page: JSValue,
    event: RequestEvent,
    about: &About,
    details: &Details,
) -> JsResult<()> {
    let mut requests = state().requests.borrow_mut();
    let Some(at) = requests.iter().position(|it| it.id == about.id) else {
        return Ok(());
    };
    let (received, sent) = (details.received.as_ref(), requests[at].sent);
    let response = || Value::from(received.map(|it| describe(about, it, sent)));
    let transferred = match received.is_some_and(|it| it.cached == Cached::Local) {
        true => 0.,
        false => details.size as f64,
    };
    let known = record! { "requestId": request_id(about), "type": requests[at].kind };
    let (method, params) = match event {
        RequestEvent::BeforeRedirect => {
            requests[at].redirect = response();
            return Ok(());
        }
        RequestEvent::ResponseStarted => (
            "Network.responseReceived",
            record! { "response": response(), "hasExtraInfo": false },
        ),
        RequestEvent::Completed => (
            "Network.loadingFinished",
            record! { "encodedDataLength": transferred },
        ),
        RequestEvent::ErrorOccurred => {
            let error = (details.outcome.and_then(Result::err)).unwrap_or(NetError::Failed);
            (
                "Network.loadingFailed",
                record! { "errorText": error.message(), "canceled": error == NetError::Aborted },
            )
        }
        _ => return Ok(()),
    };
    if event != RequestEvent::ResponseStarted {
        requests.swap_remove(at);
    }
    drop(requests);
    let data = record! { "dataLength": details.size as f64, "encodedDataLength": transferred };
    let (data, params) = (known.clone().and(&data), known.and(&params));
    watchers_of_page(page).iter().try_for_each(|it| {
        if event == RequestEvent::Completed {
            it.tell("Network.dataReceived", &data)?;
        }
        it.tell(method, &params)
    })
}

fn kind_of(destination: Option<Destination>) -> &'static str {
    match destination {
        Some(Destination::Empty) => "Fetch",
        Some(Destination::Audio | Destination::Video) => "Media",
        Some(Destination::Document | Destination::Iframe) => "Document",
        Some(Destination::Font) => "Font",
        Some(Destination::Image) => "Image",
        Some(Destination::Script) => "Script",
        Some(Destination::Style) => "Stylesheet",
        _ => "Other",
    }
}

fn decode(base64: &Value) -> Vec<u8> {
    bun_base64::decode_alloc(base64.text().as_bytes()).unwrap_or_default()
}

fn headers_in(list: &Value) -> Option<HeaderList> {
    let pairs = (list.items().iter()).map(|it| list![&it["name"], &it["value"]]);
    list.is_list().then(|| from_pairs(&pairs.collect()))
}

pub(crate) fn pause(
    page: JSValue,
    about: &About,
    mut request: Outgoing,
) -> LocalFuture<'static, Result<Paused, NetError>> {
    let (id, kind) = (about.id, kind_of(about.destination));
    let mut requests = state().requests.borrow_mut();
    let before = requests.extract_if(.., |it| it.id == id).last();
    requests.push(Known {
        id,
        kind,
        redirect: Value::Undefined,
        sent: seconds(),
    });
    drop(requests);
    let bytes = match &request.body {
        Some(RequestBody::Data(Data::Bytes(bytes))) => Some(bytes),
        _ => None,
    };
    let described = record! {
        "requestId": request_id(about),
        "type": kind,
        "request": record! {
            "url": string(about.url.href()),
            "method": string(&request.method),
            "headers": record_of(&request.headers, ", "),
            "initialPriority": "High",
            "referrerPolicy": "strict-origin-when-cross-origin",
            "hasPostData": request.body.is_some(),
            "postData": bytes.map(|it| string(it)),
            "postDataEntries": bytes.map(|it| list![record! { "bytes": text::base64(it) }]),
        },
        "redirectResponse": before.map(|it| it.redirect),
        "redirectHasExtraInfo": false,
        "initiator": record! { "type": "other" },
        "wallTime": wall_now(),
    };
    let (watchers, url) = (watchers_of_page(page), about.url.clone());
    for it in &watchers {
        if kind == "Document" {
            it.loader();
            it.next_loader.replace(Some(request_id(about)));
        }
        task::report(it.tell("Network.requestWillBeSent", &described));
    }
    Box::pin(async move {
        let mut uses_cache = true;
        for watcher in watchers {
            watcher.obstacle(&url).map_or(Ok(()), Err)?;
            let conditions = watcher.conditions.borrow().clone();
            uses_cache &= !conditions["cacheDisabled"].is_truthy();
            for (name, value) in conditions["headers"].members() {
                (request.headers).set(name.text().as_bytes(), value.text().as_bytes());
            }
            if let latency @ 1.. = conditions["latency"].number() as u64 {
                task::sleep(latency).await;
            }
            let Some(answer) = watcher.pause(url.href(), &described) else {
                continue;
            };
            let answer = answer.await.unwrap_or_default();
            match answer["errorReason"].text() {
                "" => {}
                "Aborted" => return Err(NetError::Aborted),
                "AccessDenied" => return Err(NetError::AccessDenied),
                "BlockedByClient" => return Err(NetError::BlockedByClient),
                "ConnectionRefused" => return Err(NetError::ConnectionRefused),
                _ => return Err(NetError::Failed),
            }
            if let status @ 1.. = answer["responseCode"].int() as u16 {
                let headers = headers_in(&answer["responseHeaders"]).unwrap_or_default();
                let body = match is_null_body_status(status) {
                    true => Body::default(),
                    false => Data::Bytes(decode(&answer["body"]).into()).open(),
                };
                return Ok(Paused::Fulfill(Answer::new(status, b"", headers, body)));
            }
            request.headers = headers_in(&answer["headers"]).unwrap_or(request.headers);
            if let Some(method) = answer["method"].as_text() {
                request.method = method.as_bytes().into();
            }
            if !answer["postData"].is_nothing() {
                request.body = Some(all_at_once(decode(&answer["postData"])));
            }
        }
        Ok(match uses_cache {
            true => Paused::Continue(request),
            false => Paused::ContinueWithoutCache(request),
        })
    })
}

pub(crate) fn keep_body(page: JSValue, about: &About, body: &SharedBytes) {
    for watcher in watchers_of_page(page) {
        let mut bodies = watcher.bodies.borrow_mut();
        bodies.push_back(Kept {
            request: request_id(about),
            url: string(about.url.href()),
            body: body.clone(),
        });
        let mut size = bodies.iter().map(|it| it.body.len() + 1024).sum::<usize>();
        while let Some(oldest) = bodies.pop_front_if(|_| size > ROOM_FOR_BODIES) {
            size -= oldest.body.len() + 1024;
        }
    }
}
