//! `net`

use std::collections::BTreeMap;
use std::rc::Rc;

use bun_web::exec::{Either, race};
use bun_web::headers::{HeaderList, is_token, is_valid_value};
use bun_web::net::NetError;
use bun_web::net::body::{Chunk, Writer, pipe};
use bun_web::net::embedder::ClientId;
use bun_web::net::fetch::{Controller, Observer};
use bun_web::net::response::Response;
use bun_web::origin::Origin;
use bun_web::request::{Credentials, RequestBody};
use bun_web::streams::Incoming;
use bun_web::url::Url;

use super::load::{
    REDIRECT_CANCELLED, REDIRECT_FORBIDDEN, Sender, all_at_once, bytes_of, error_to_js, from_pairs,
    grouped, latin1, request_for,
};
use super::{Session, online};
use crate::generated_bindgen::session::{
    ElectronNet, js_ElectronClientRequest as fields, js_ElectronIncomingMessage,
    js_ElectronWebSocket,
};
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::task::{self, LocalFuture};
use crate::text::contains;
use crate::value::Value;
use crate::webview::wire;

fn become_stream(object: JSValue, kind: &str, options: JSValue) -> JsResult<()> {
    get(realm::require(global(), Module::Stream)?, kind)?
        .call(global(), object, &[options])
        .map(drop)
}

pub(crate) struct IncomingMessage(Option<Rc<Incoming>>);

fn headers_as_node_has_them(headers: &HeaderList) -> Value {
    const FIRST_WINS: [&str; 18] = [
        "age",
        "authorization",
        "content-length",
        "content-type",
        "etag",
        "expires",
        "from",
        "host",
        "if-modified-since",
        "if-unmodified-since",
        "last-modified",
        "location",
        "max-forwards",
        "proxy-authorization",
        "referer",
        "retry-after",
        "server",
        "user-agent",
    ];
    let reduce = |(name, values): &(Value, Value)| match name.text() {
        "set-cookie" => values.clone(),
        name if FIRST_WINS.contains(&name) => values[0].clone(),
        _ => values
            .items()
            .iter()
            .map(Value::text)
            .collect::<Vec<_>>()
            .join(", ")
            .into(),
    };
    Value::Record(
        grouped(headers)
            .members()
            .iter()
            .map(|it| (it.0.clone(), reduce(it)))
            .collect(),
    )
}

impl IncomingMessage {
    fn create(Response { head, body }: Response) -> JsResult<&'static IncomingMessage> {
        let message =
            js_ElectronIncomingMessage::create(heap(), IncomingMessage(body.map(Incoming::new)));
        become_stream(message.to_js(), "Readable", JSValue::UNDEFINED)?;
        let members = record! {
            "statusCode": i32::from(head.status),
            "statusMessage": latin1(&head.status_text),
            "headers": headers_as_node_has_them(&head.headers),
            "rawHeaders": head.headers.iter().flat_map(|it| [it.0, it.1]).map(latin1).collect::<Value>(),
            "httpVersion": "1.1",
            "httpVersionMajor": 1,
            "httpVersionMinor": 1,
        };
        for (name, value) in members.members() {
            message
                .to_js()
                .put(global(), name.text().as_bytes(), js(value)?);
        }
        Ok(message)
    }

    pub(crate) fn read(&self, _: Cx<'_, '_>) -> JsResult<()> {
        let Some(body) = self.0.clone() else {
            return invoke(self.to_js(), "push", &[JSValue::NULL]).map(drop);
        };
        let message = keep(self.to_js());
        bun_web::exec::spawn(async move {
            let result = match bun_web::exec::never_at_once(body.read()).await {
                Ok(chunk) => (chunk.map_or(Ok(JSValue::NULL), |it| buffer(&it)))
                    .and_then(|it| invoke(message.get(), "push", &[it])),
                Err(error) => invoke(message.get(), "destroy", &[error_to_js(error)]),
            };
            task::report(result.map(drop));
        });
        Ok(())
    }

    pub(crate) fn destroy<'a>(
        &self,
        _: Cx<'a, '_>,
        error: JsLocal<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        if let Some(it) = self.0.as_ref() {
            it.cancel();
        }
        call(callback.to_js(), &[error.to_js()]).map(drop)
    }
}

pub(crate) struct ClientRequest {
    session: &'static Session,
    url: Url,
    options: Value,
    headers: RefCell<Vec<(String, String)>>,
    controller: Controller,
    body: RefCell<Vec<u8>>,
    upload: RefCell<Option<Rc<Writer>>>,
    is_chunked: Cell<bool>,
    has_started: Cell<bool>,
    /// While `redirect` is emitted.
    follows: Cell<Option<bool>>,
    refusal: Cell<Option<&'static str>>,
    sent: Cell<Option<u64>>,
    size: Cell<u64>,
}

state!(fn in_flight() -> RefCell<BTreeMap<u32, Root<ClientRequest>>>);

fn url_of(options: &Value) -> JsResult<Url> {
    let invalid = || type_error(format_args!("Invalid URL"));
    if options["url"].is_truthy() {
        return Url::parse(options["url"].display().as_bytes()).ok_or_else(invalid);
    }
    let protocol = options["protocol"].as_text().unwrap_or("http:");
    if !matches!(protocol, "http:" | "https:") {
        return Err(error(format_args!(
            "ClientRequest only supports http: and https: protocols"
        )));
    }
    let port = if options["port"].is_truthy() {
        format!(":{}", options["port"].display())
    } else {
        String::new()
    };
    let host = || {
        format!(
            "{}{port}",
            options["hostname"].as_text().unwrap_or("localhost")
        )
    };
    let (host, path) = (
        options["host"].as_text().map_or_else(host, str::to_owned),
        options["path"].as_text().unwrap_or("/"),
    );
    if contains(path, " ") {
        return Err(type_error(format_args!(
            "Request path contains unescaped characters"
        )));
    }
    Url::parse(format!("{protocol}//{host}").as_bytes())
        .and_then(|it| it.join(path.as_bytes()))
        .ok_or_else(invalid)
}

impl Observer for ClientRequest {
    fn follows<'a>(
        &'a self,
        status: u16,
        method: &'a [u8],
        target: &'a Url,
        headers: &'a HeaderList,
    ) -> LocalFuture<'a, bool> {
        let policy = self.options["redirect"].as_text().unwrap_or("follow");
        if policy == "error" {
            self.refusal.set(Some(REDIRECT_FORBIDDEN));
            return Box::pin(async { false });
        }
        self.follows.set(Some(policy == "follow"));
        let tell = || {
            let arguments = [
                js(u32::from(status))?,
                js(string(method))?,
                js(string(target.href()))?,
                js(&grouped(headers))?,
            ];
            emit(self.to_js(), "redirect", &arguments)
        };
        task::report(tell());
        let follows = self.follows.take() == Some(true);
        if !follows {
            self.refusal.set(Some(REDIRECT_CANCELLED));
        }
        Box::pin(async move { follows })
    }
}

impl ClientRequest {
    fn create(given: JSValue, callback: JSValue) -> JsResult<&'static ClientRequest> {
        const OPTIONS: [&str; 15] = [
            "url",
            "method",
            "headers",
            "partition",
            "protocol",
            "host",
            "hostname",
            "port",
            "path",
            "redirect",
            "origin",
            "credentials",
            "useSessionCookies",
            "bypassCustomProtocolHandlers",
            "cache",
        ];
        let (mut options, mut session) = (Value::empty(), None);
        if given.is_object() {
            for name in OPTIONS {
                let value = get(given, name)?;
                let is_url = name == "url" && value.is_object();
                options.set(
                    name,
                    if is_url {
                        text_of(value)?.into()
                    } else {
                        wire::data_from_js(value)?
                    },
                );
            }
            let given = get(given, "session")?;
            session = cast::<Session>(given);
            if session.is_none() && given.to_boolean() {
                return Err(type_error(format_args!(
                    "`session` should be an instance of the Session class"
                )));
            }
        } else {
            options.set("url", text_of(given)?);
        }
        if !matches!(
            options["redirect"].as_text(),
            None | Some("follow" | "error" | "manual")
        ) {
            return Err(error(format_args!(
                "redirect mode should be one of follow, error or manual"
            )));
        }
        if !matches!(
            options["headers"],
            Value::Undefined | Value::Null | Value::Record(_)
        ) {
            return Err(type_error(format_args!("headers must be an object")));
        }
        if options["partition"].is_truthy() && options["partition"].as_text().is_none() {
            return Err(type_error(format_args!("`partition` should be a string")));
        }
        let request = ClientRequest {
            session: session
                .map_or_else(|| super::from_partition(options["partition"].text()), Ok)?,
            url: url_of(&options)?,
            options,
            headers: Default::default(),
            controller: Controller::with_upload_progress(),
            body: Default::default(),
            upload: Default::default(),
            is_chunked: Default::default(),
            has_started: Default::default(),
            follows: Default::default(),
            refusal: Default::default(),
            sent: Default::default(),
            size: Default::default(),
        };
        let request = fields::create(heap(), request);
        become_stream(request.to_js(), "Writable", JSValue::UNDEFINED)?;
        fields::set_given(request, bun_jsc::JSMap::create(global()));
        for (name, value) in request.options["headers"].members() {
            request.add_header(js(name)?, js(value)?)?;
        }
        if callback.is_callable() {
            invoke(request.to_js(), "once", &[js("response")?, callback])?;
        }
        Ok(request)
    }

    pub(super) fn with_id(id: ClientId) -> Option<&'static ClientRequest> {
        in_flight().borrow().get(&id.0).map(Root::get)
    }

    fn forget_header(&self, name: &str) {
        self.headers
            .borrow_mut()
            .retain(|it| !it.0.eq_ignore_ascii_case(name));
    }

    /// The values as they were given, by the names in lower case.
    fn given(&self) -> &'static mut bun_jsc::JSMap {
        map_in(fields::given(self).unwrap_or_default())
    }

    fn add_header(&self, name: JSValue, value: JSValue) -> JsResult<()> {
        if !name.is_string() {
            return Err(type_error(format_args!(
                "`name` should be a string in setHeader(name, value)"
            )));
        }
        let name = text_of(name)?;
        if value.is_undefined_or_null() {
            return Err(error(format_args!(
                "`value` required in setHeader(\"{name}\", value)"
            )));
        }
        if self.has_started.get() {
            return Err(error(format_args!("Can't set headers after they are sent")));
        }
        if !is_token(name.as_bytes()) {
            return Err(error(format_args!("Invalid header name: '{name}'")));
        }
        let text = text_of(value)?;
        if !is_valid_value(text.as_bytes()) {
            return Err(error(format_args!(
                "Invalid value for header '{name}': '{text}'"
            )));
        }
        (self.given()).set(global(), js(name.to_ascii_lowercase())?, value)?;
        self.forget_header(&name);
        self.headers.borrow_mut().push((name, text));
        Ok(())
    }

    async fn load(&self, id: ClientId, body: Option<RequestBody>) -> Result<Response, NetError> {
        let (options, mut request) = (&self.options, request_for(&string(self.url.href()))?);
        let origin = options["origin"]
            .as_text()
            .map(|it| Origin::from_serialized(it.as_bytes()));
        request.credentials = match options["credentials"].text() {
            "omit" => Credentials::Omit,
            "same-origin"
                if !origin
                    .as_ref()
                    .is_some_and(|it| it.is_origin_of(&request.url)) =>
            {
                Credentials::Omit
            }
            _ => Credentials::Include,
        };
        request.omits_cookies =
            options["credentials"].is_nothing() && !options["useSessionCookies"].is_truthy();
        request.method = options["method"]
            .as_text()
            .unwrap_or("GET")
            .to_ascii_uppercase()
            .as_bytes()
            .into();
        request.headers = from_pairs(
            &self
                .headers
                .borrow()
                .iter()
                .map(|it| list![&*it.0, &*it.1])
                .collect(),
        );
        request.cache = bun_web::request::CacheMode::parse(options["cache"].text().as_bytes())
            .unwrap_or(request.cache);
        request.body = body;
        let bypasses_handlers = options["bypassCustomProtocolHandlers"].is_truthy();
        let loaded = self.session.load(
            request,
            Sender {
                origin,
                bypasses_handlers,
                client: Some(id),
            },
            self,
            &self.controller,
        );
        let progress = async {
            while let Some(upload) = &self.controller.upload {
                self.sent.set(Some(upload.changed().await));
            }
        };
        match race(loaded, progress).await {
            Either::First(loaded) => loaded,
            Either::Second(()) => Err(NetError::Failed),
        }
    }

    fn loaded(&self, loaded: Result<Response, NetError>) -> JsResult<()> {
        if self.controller.is_aborted() {
            return Ok(());
        }
        match loaded {
            Ok(response) => {
                let response = IncomingMessage::create(response)?;
                fields::set_response(self, Some(response));
                if self.sent.get().is_some() || self.size.get() > 0 {
                    self.sent.set(Some(self.size.get()));
                }
                emit(self.to_js(), "response", &[response.to_js()])
            }
            Err(failure) => {
                let refused = self
                    .refusal
                    .get()
                    .map(|it| global().create_error_instance(format_args!("{it}")));
                let failure = refused.unwrap_or_else(|| error_to_js(failure));
                // It has ended as a stream once all is written.
                if get(self.to_js(), "destroyed")?.to_boolean() {
                    emit(self.to_js(), "error", &[failure])
                } else {
                    invoke(self.to_js(), "destroy", &[failure]).map(drop)
                }
            }
        }
    }

    fn start(&self, body: Option<RequestBody>) {
        self.has_started.set(true);
        let (id, request) = (ClientId::next(), Root::new(self));
        in_flight().borrow_mut().insert(id.0, Root::new(self));
        bun_web::exec::spawn(async move {
            let loaded = bun_web::exec::never_at_once(request.get().load(id, body)).await;
            in_flight().borrow_mut().remove(&id.0);
            task::report(request.get().loaded(loaded));
        });
    }

    pub(crate) fn get_chunked_encoding(&self) -> bool {
        self.is_chunked.get()
    }

    pub(crate) fn set_chunked_encoding(&self, _: Cx<'_, '_>, is_chunked: bool) -> JsResult<()> {
        if self.has_started.get() {
            return Err(error(format_args!(
                "chunkedEncoding can only be set before the request is started"
            )));
        }
        self.is_chunked.set(is_chunked);
        Ok(())
    }

    pub(crate) fn set_header<'a>(
        &self,
        _: Cx<'a, '_>,
        name: JsLocal<'a>,
        value: JsLocal<'a>,
    ) -> JsResult<()> {
        self.add_header(name.to_js(), value.to_js())
    }

    pub(crate) fn get_header(&self, _: Cx<'_, '_>, name: Option<&[u8]>) -> JsResult<JSValue> {
        let name =
            name.ok_or_else(|| error(format_args!("`name` is required for getHeader(name)")))?;
        (self.given()).get(global(), js(string(name).to_ascii_lowercase())?)
    }

    pub(crate) fn remove_header(&self, _: Cx<'_, '_>, name: Option<&[u8]>) -> JsResult<()> {
        let name =
            name.ok_or_else(|| error(format_args!("`name` is required for removeHeader(name)")))?;
        if self.has_started.get() {
            return Err(error(format_args!(
                "Can't remove headers after they are sent"
            )));
        }
        self.forget_header(&string(name));
        (self
            .given()
            .remove(global(), js(string(name).to_ascii_lowercase())?))
        .map(drop)
    }

    pub(crate) fn follow_redirect(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if self.follows.get().is_none() {
            return Err(error(format_args!(
                "followRedirect() called, but was not waiting for a redirect"
            )));
        }
        self.follows.set(Some(true));
        Ok(())
    }

    pub(crate) fn get_upload_progress(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        let sent = self.sent.get();
        Ok(object!({
            "active": self.has_started.get(),
            "started": sent.is_some(),
            "current": sent.unwrap_or(0) as f64,
            "total": sent.map_or(0, |_| self.size.get()) as f64,
        }))
    }

    pub(crate) fn abort(&self, _: Cx<'_, '_>) -> JsResult<()> {
        if self.controller.is_aborted() {
            return Ok(());
        }
        self.controller.abort();
        let aborted = listener(self, |it, _| {
            emit(it.to_js(), "abort", &[])?;
            fields::response(it).map_or(Ok(()), |it| emit(it.to_js(), "aborted", &[]))?;
            invoke(it.to_js(), "destroy", &[]).map(drop)
        })?;
        invoke(crate::process::object(), "nextTick", &[aborted])?;
        fields::response(self).map_or(Ok(()), |it| invoke(it.to_js(), "destroy", &[]).map(drop))
    }

    pub(crate) fn write<'a>(
        &self,
        _: Cx<'a, '_>,
        chunk: JsLocal<'a>,
        _: JsLocal<'a>,
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        let chunk = bytes_of(chunk.to_js()).unwrap_or_default();
        self.size.update(|it| it + chunk.len() as u64);
        if !self.is_chunked.get() {
            self.body.borrow_mut().extend(chunk);
            return call(callback.to_js(), &[]).map(drop);
        }
        if !self.has_started.get() {
            let (writer, body) = pipe(1 << 16);
            self.upload.replace(Some(Rc::new(writer)));
            self.start(Some(RequestBody::Stream(Some(body))));
        }
        let (upload, callback) = (self.upload.borrow().clone(), keep(callback.to_js()));
        task::spawn(async move {
            if let Some(upload) = upload {
                upload.write(Chunk::Owned(chunk));
                upload.ready().await;
            }
            task::report(call(callback.get(), &[]).map(drop));
        });
        Ok(())
    }

    pub(crate) fn finish<'a>(
        &self,
        _: Cx<'a, '_>,
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        match self.upload.take().and_then(Rc::into_inner) {
            Some(upload) => upload.end(Ok(())),
            None => self.start(
                Some(self.body.take())
                    .filter(|it| !it.is_empty())
                    .map(all_at_once),
            ),
        }
        call(callback.to_js(), &[]).map(drop)
    }
}

impl ElectronNet {
    pub(crate) fn get_web_socket(heap: &JsHeap<'_>) -> JSValue {
        js_ElectronWebSocket::CLASS.constructor(heap)
    }

    pub(crate) fn get_online(_: Cx<'_, '_>) -> JsResult<bool> {
        online::is_online()
    }

    pub(crate) fn fetch<'a>(
        cx: Cx<'a, '_>,
        input: JsLocal<'a>,
        init: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        super::default()?.fetch(cx, input, init)
    }

    pub(crate) fn request<'a>(
        _: Cx<'a, '_>,
        options: JsLocal<'a>,
        callback: JsLocal<'a>,
    ) -> JsResult<&'static ClientRequest> {
        ClientRequest::create(options.to_js(), callback.to_js())
    }

    pub(crate) fn resolve_host<'a>(
        cx: Cx<'a, '_>,
        host: &[u8],
        options: JsLocal<'a>,
    ) -> JsResult<JSValue> {
        super::default()?.resolve_host(cx, host, options)
    }
}
