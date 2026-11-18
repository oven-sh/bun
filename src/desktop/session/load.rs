//! The requests of the app itself.

use std::rc::Rc;

use bun_jsc::AbortSignal;
use bun_web::convert::{isomorphic_encode, resolve_blob_url};
use bun_web::exec::with_js;
use bun_web::headers::HeaderList;
use bun_web::js_embedder::{answer_from_js, answer_to_js};
use bun_web::net::body::{Body, Data};
use bun_web::net::embedder::ClientId;
use bun_web::net::fetch::{self, Controller, Initiator, Observer, Role};
use bun_web::net::response::{Answer, Response};
use bun_web::net::{NetError, Result};
use bun_web::origin::Origin;
use bun_web::request::{Credentials, Destination, Mode, Request, RequestBody};
use bun_web::runtime::create_response;
use bun_web::streams::{self, body_of_stream};
use bun_web::url::Url;

use super::Session;
use crate::prelude::*;
use crate::task::LocalFuture;
use crate::value::Value;
use crate::webview::wire;
use crate::{realm, task};

pub(super) fn error_to_js(error: NetError) -> JSValue {
    with_js(|cx| streams::error_to_js(cx, error).to_js())
}

pub(super) fn rejection(error: NetError) -> bun_jsc::JsError {
    global().throw_value(error_to_js(error))
}

pub(super) fn error_from_js(thrown: JSValue) -> NetError {
    with_js(|cx| streams::error_from_js(cx, JsLocal::new(&cx.heap, thrown)))
}

pub(super) fn or_failure<T>(result: JsResult<T>) -> Result<T> {
    catch(result).map_or(Err(NetError::Aborted), |it| it.map_err(error_from_js))
}

pub(crate) fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|it| char::from(*it)).collect()
}

fn from_latin1(text: &str) -> Vec<u8> {
    isomorphic_encode(&bun_core::String::clone_utf8(text.as_bytes()))
}

pub(super) fn to_pairs(headers: &HeaderList) -> Value {
    headers
        .iter()
        .map(|it| list![latin1(it.0), latin1(it.1)])
        .collect()
}

pub(crate) fn from_pairs(pairs: &Value) -> HeaderList {
    pairs
        .items()
        .iter()
        .map(|it| (from_latin1(it[0].text()), from_latin1(&it[1].display())))
        .collect()
}

/// Each member is a value, or a list of them.
pub(crate) fn from_record(record: &Value) -> HeaderList {
    let values = |it: &'_ Value| {
        if it.is_list() {
            it.items().to_vec()
        } else {
            vec![it.clone()]
        }
    };
    let flatten = |(name, it): &(Value, Value)| {
        values(it)
            .into_iter()
            .map(|it| list![name, it])
            .collect::<Vec<_>>()
    };
    from_pairs(&record.members().iter().flat_map(flatten).collect())
}

pub(super) fn grouped(headers: &HeaderList) -> Value {
    let group = |name| {
        (
            latin1(name).to_ascii_lowercase().into(),
            headers.values(name).map(latin1).collect(),
        )
    };
    Value::Record(headers.combined().map(|it| group(it.0)).collect())
}

fn headers_from_js(headers: JSValue) -> JsResult<HeaderList> {
    let all = Rc::new(RefCell::new(HeaderList::default()));
    let collected = Rc::clone(&all);
    let add = procedure(move |given| {
        let bytes = |index| {
            JsResult::Ok(isomorphic_encode(
                &argument(given, index).to_bun_string(global())?,
            ))
        };
        collected.borrow_mut().append(&bytes(1)?, &bytes(0)?);
        Ok(())
    })?;
    invoke(headers, "forEach", &[add])?;
    Ok(all.take())
}

pub(super) fn bytes_of(value: JSValue) -> Option<Vec<u8>> {
    value
        .as_array_buffer(global())
        .map(|it| it.byte_slice().to_vec())
}

pub(super) fn body_of(stream: JSValue) -> JsResult<Body> {
    with_js(|cx| {
        body_of_stream(cx, stream)
            .map(|it| it.body)
            .map_err(|it| it.into_js_error(cx.global()))
    })
}

/// From a `Response`, or what looks like one.
pub(super) fn answer_of(response: JSValue, maps_file: bool) -> JsResult<Answer> {
    let is_alike = response.is_object()
        && !response.is_instance_of(global(), realm::native(global(), "Response")?)?;
    let response = if is_alike {
        realm::construct("Response", &[get(response, "body")?, response])?
    } else {
        response
    };
    with_js(|cx| {
        answer_from_js(cx, JsLocal::new(&cx.heap, response), maps_file)
            .map_err(|it| it.into_js_error(cx.global()))
    })
}

pub(super) fn response_of(answer: Answer) -> JsResult<JSValue> {
    with_js(|cx| {
        answer_to_js(cx, answer)
            .map(|it| it.to_js())
            .map_err(|it| it.into_js_error(cx.global()))
    })
}

pub(super) fn to_answer(Response { head, body }: Response) -> Answer {
    Answer::new(
        head.status,
        &head.status_text,
        head.headers,
        body.unwrap_or_default(),
    )
}

pub(super) fn request_for(url: &str) -> Result<Request> {
    let url = Url::parse(url.as_bytes()).ok_or(NetError::InvalidUrl)?;
    let mut request = Request::new(url, Destination::Empty, Mode::Cors, Credentials::SameOrigin);
    if request.url.scheme() == b"blob" {
        request.blob = resolve_blob_url(&request.url);
    }
    Ok(request)
}

pub(crate) fn all_at_once(bytes: Vec<u8>) -> RequestBody {
    RequestBody::Data(Data::Bytes(bytes.into()))
}

pub(super) const REDIRECT_CANCELLED: &str = "Redirect was cancelled";
pub(super) const REDIRECT_FORBIDDEN: &str =
    "Attempted to redirect, but redirect policy was 'error'";

struct Redirects {
    refusal: Option<&'static str>,
    has_refused: Cell<bool>,
}

impl Observer for Redirects {
    fn follows<'a>(
        &'a self,
        _: u16,
        _: &'a [u8],
        _: &'a Url,
        _: &'a HeaderList,
    ) -> LocalFuture<'a, bool> {
        self.has_refused.set(self.refusal.is_some());
        Box::pin(async { !self.has_refused.get() })
    }
}

/// With whether the request wanted to leave.
struct StaysAt(Origin, Cell<bool>);

impl Observer for StaysAt {
    fn allows(&self, request: &Request, _: Option<&Url>) -> bool {
        self.1.set(!self.0.is_origin_of(&request.url));
        !self.1.get()
    }
}

/// No redirect leads to what the app serves.
struct StaysOnWeb;

impl Observer for StaysOnWeb {
    fn allows(&self, request: &Request, first: Option<&Url>) -> bool {
        first.is_none() || request.url.is_http()
    }
}

#[derive(Default)]
pub(super) struct Sender {
    pub(super) origin: Option<Origin>,
    pub(super) bypasses_handlers: bool,
    pub(super) client: Option<ClientId>,
    pub(super) is_page: bool,
}

impl Session {
    pub(super) async fn load(
        &self,
        request: Request,
        sender: Sender,
        observer: &dyn Observer,
        controller: &Controller,
    ) -> Result<Response> {
        let (user_agent, language) = (
            or_failure(self.user_agent())?,
            or_failure(self.accept_language())?,
        );
        let role = match sender.is_page {
            true => Role::Page,
            false => Role::App {
                bypasses_handlers: sender.bypasses_handlers,
            },
        };
        let mut initiator = Initiator::new(
            role,
            sender.origin,
            user_agent.as_bytes(),
            language.as_bytes(),
        );
        initiator.client = sender.client;
        fetch::fetch(&self.network, &initiator, request, observer, controller)
            .await
            .map_err(|it| it.error)
    }

    /// Nobody but `trusted` gets credentials.
    pub(crate) async fn load_for_tools(
        &self,
        url: &str,
        trusted: Option<Origin>,
    ) -> Result<Response> {
        let (mut request, controller) = (request_for(url)?, Controller::default());
        if let Some(origin) = trusted.filter(|it| it.is_origin_of(&request.url)) {
            let (own, observer) = (request_for(url)?, StaysAt(origin, Cell::default()));
            let loaded = self
                .load(own, Sender::default(), &observer, &controller)
                .await;
            if !observer.1.get() {
                return loaded;
            }
        }
        request.credentials = Credentials::Omit;
        let (sender, controller) = (Sender::default(), Controller::default());
        self.load(request, sender, &StaysOnWeb, &controller).await
    }

    pub(super) async fn load_directly(&self, request: Request) -> Result<Answer> {
        let sender = Sender {
            bypasses_handlers: true,
            ..Default::default()
        };
        self.load(request, sender, &(), &Controller::default())
            .await
            .map(to_answer)
    }

    pub(super) fn fetch_for_script(
        &'static self,
        input: JSValue,
        init: JSValue,
    ) -> JsResult<JSValue> {
        let input = if input.get_class_info_name() == Some(b"URL") {
            get(input, "href")?
        } else {
            input
        };
        let given = realm::construct("Request", &[input, init])?;
        let option = |name| {
            if init.is_object() {
                wire::data_from_js(get(init, name)?)
            } else {
                Ok(Value::Undefined)
            }
        };
        let mut request = request_for(&text_of(get(given, "url")?)?).map_err(rejection)?;
        request.method = text_of(get(given, "method")?)?.as_bytes().into();
        request.headers = headers_from_js(get(given, "headers")?)?;
        let redirects = Redirects {
            refusal: match &*text_of(get(given, "redirect")?)? {
                "follow" => None,
                "manual" => Some(REDIRECT_CANCELLED),
                _ => Some(REDIRECT_FORBIDDEN),
            },
            has_refused: Default::default(),
        };
        request.credentials = Credentials::parse(option("credentials")?.text().as_bytes())
            .unwrap_or(request.credentials);
        request.referrer = Url::parse(option("referrer")?.text().as_bytes());
        let sender = Sender {
            bypasses_handlers: option("bypassCustomProtocolHandlers")?.is_truthy(),
            ..Default::default()
        };
        let (body, is_streamed) = (get(given, "body")?, option("duplex")?.is_truthy());
        let whole =
            (body.is_object() && !is_streamed).then(|| task::outcome(invoke(given, "bytes", &[])));
        if body.is_object() && is_streamed {
            request.body = Some(RequestBody::Stream(Some(body_of(body)?)));
        }
        let (controller, signal) = (Controller::default(), get(given, "signal")?);
        let (aborted, kept) = (controller.clone(), keep(signal));
        invoke(
            signal,
            "addEventListener",
            &[
                js("abort")?,
                procedure(move |_| {
                    aborted.abort();
                    Ok(())
                })?,
            ],
        )?;
        Ok(task::busy_promise(async move {
            if let Some(whole) = whole {
                request.body =
                    bytes_of(whole.await.map_err(|it| task::throw(&it))?.get()).map(all_at_once);
            }
            let reason = || {
                AbortSignal::from_js(&kept.get())
                    .filter(|it| it.aborted())
                    .map(|it| it.js_reason(global()))
            };
            let loaded = if reason().is_none() {
                self.load(request, sender, &redirects, &controller).await
            } else {
                Err(NetError::Aborted)
            };
            let loaded = loaded.map_err(|it| match (reason(), redirects.refusal) {
                (Some(reason), _) => global().throw_value(reason),
                (_, Some(it)) if redirects.has_refused.get() => error(format_args!("{it}")),
                _ => rejection(it),
            })?;
            let (url, is_redirected) = (string(loaded.head.url.href()), loaded.head.redirects > 0);
            let response = match loaded {
                Response { head, body: None } => create_response(
                    global(),
                    head.status,
                    &head.status_text,
                    &head.headers,
                    JSValue::NULL,
                )?,
                loaded => response_of(to_answer(loaded))?,
            };
            response.put_non_enumerable(global(), b"url", js(url)?);
            response.put_non_enumerable(global(), b"redirected", is_redirected.into());
            Ok(response)
        }))
    }
}
