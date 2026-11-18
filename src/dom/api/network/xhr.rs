//! <https://xhr.spec.whatwg.org/>

use core::time::Duration;

use bun_web::exec::{self, Either};
use bun_web::headers::{
    digits, is_forbidden_method, is_forbidden_request_header, is_token, normalize_method,
    trim_http_whitespace,
};
use bun_web::mime::{self, Mime};
use bun_web::net::NetError;
use bun_web::net::body::{Chunk, Data, FOR_DATA, Share, Source as _};
use bun_web::net::fetch::Controller;
use bun_web::net::response::{Head, Response as Fetched};
use bun_web::permissions_policy::Feature;
use bun_web::request::{Credentials, InitiatorType, RequestBody};
use bun_web::runtime::create_blob;
use bun_web::tasks::{self, TaskId};

use super::body::{Body, TEXT, URL_ENCODED, array_buffer, copy_of_buffer, parse_json};
use super::headers::is_header_value;
use super::request::Options;
use super::response::About;
use super::*;
use crate::api::events::{now, swap_top_level};
use crate::api::markup;
use crate::api::realm::block_on;
use crate::api::storage::ProgressEvent;
use crate::order::Order as _;

type ResponseType = XMLHttpRequestResponseType;

const UNSENT: u16 = 0;
const OPENED: u16 = 1;
const HEADERS_RECEIVED: u16 = 2;
const LOADING: u16 = 3;
const DONE: u16 = 4;
const PROGRESS_INTERVAL: f64 = 50.0;

struct Received {
    about: About,
    url: Url,
    headers: HeaderList,
    bytes: Vec<u8>,
}

#[repr(C)]
pub(crate) struct XMLHttpRequest {
    pub(crate) base: XMLHttpRequestEventTarget,
    pub(crate) fields: js_XMLHttpRequest::Fields,
    state: Cell<u16>,
    is_sent: Cell<bool>,
    is_synchronous: Cell<bool>,
    is_uploaded: Cell<bool>,
    tells_upload: Cell<bool>,
    with_credentials: Cell<bool>,
    response_type: Cell<ResponseType>,
    timeout: Cell<u32>,
    timer: Cell<Option<TaskId>>,
    sent_at: Cell<f64>,
    /// What an earlier one still has to do is not done.
    generation: Cell<u32>,
    options: RefCell<Option<Box<Options>>>,
    headers: RefCell<HeaderList>,
    overridden_type: RefCell<Option<Mime>>,
    controller: RefCell<Option<Controller>>,
    /// `None` is a network error.
    received: RefCell<Option<Box<Received>>>,
}

fn invalid_state<'a>(heap: &JsHeap<'a>, message: &str) -> Error<'a> {
    dom_error(heap, DomError::InvalidStateError, message)
}

fn progress<'a>(cx: Cx<'_, 'a>, target: &'a EventTarget, name: Known, loaded: u64, total: u64) {
    if target.has_listeners(name) {
        dispatch(
            cx,
            target,
            ProgressEvent::new(
                target.realm(&cx.heap),
                name,
                loaded,
                Some(total).filter(|it| *it != 0),
            ),
        );
    }
}

/// For what a script has called.
fn below_script<'a, R>(cx: Cx<'_, 'a>, steps: impl FnOnce(Cx<'_, 'a>) -> R) -> R {
    let was_at_top_level = swap_top_level(false);
    let result = steps(cx);
    swap_top_level(was_at_top_level);
    result
}

struct Running {
    kept: Kept,
    generation: u32,
}

impl Running {
    /// `None` if it is over.
    #[optimize(size)]
    async fn step<T: 'static>(
        &self,
        steps: impl for<'a> FnOnce(Cx<'_, 'a>, &'a XMLHttpRequest) -> T + 'static,
    ) -> Option<T> {
        let generation = self.generation;
        let goes_on = self.kept.in_task(move |cx, this| {
            let this = XMLHttpRequest::from_js(&cx.heap, this.to_js())
                .filter(|it| it.generation.get() == generation)?;
            let result = steps(cx, this);
            (this.generation.get() == generation).then_some(result)
        });
        goes_on.await?
    }

    #[optimize(size)]
    async fn tell_upload(
        &self,
        controller: &Controller,
        length: u64,
    ) -> Option<core::convert::Infallible> {
        let Some(upload) = &controller.upload else {
            return core::future::pending().await;
        };
        let mut last = now();
        loop {
            let sent = upload.changed().await;
            if sent != length && now() - last >= PROGRESS_INTERVAL {
                last = now();
                self.step(move |cx, this| {
                    this.upload()
                        .map_or((), |it| progress(cx, it, atom!("progress"), sent, length))
                })
                .await?;
            }
        }
    }

    #[optimize(size)]
    async fn receive(
        &self,
        Fetched { head, body }: Fetched,
        length: u64,
    ) -> Option<bun_web::net::Result<()>> {
        let (total, mut body) = (
            expected_length(&head.headers),
            body.filter(|_| !head.is_cors_cross_origin())
                .unwrap_or_default(),
        );
        self.step(move |cx, this| this.start_response(cx, &head, length))
            .await?;
        let (mut received, mut told, mut last, mut share, mut is_whole) =
            (0, 0, f64::NEG_INFINITY, Share::of(&FOR_DATA), false);
        loop {
            let interval = async {
                match is_whole {
                    false => core::future::pending().await,
                    true => exec::sleep(Duration::from_millis(PROGRESS_INTERVAL as u64)).await,
                }
            };
            let chunk = match exec::race(body.read(), interval).await {
                exec::Either::First(Ok(Some(chunk))) => chunk,
                exec::Either::First(Ok(None)) => break,
                exec::Either::First(Err(error)) => return Some(Err(error)),
                exec::Either::Second(()) => Chunk::Owned(Vec::new()),
            };
            if let Err(error) = share.grow(if body.gathered() == 0 { chunk.len() } else { 0 }) {
                return Some(Err(error));
            }
            received += chunk.len() as u64;
            let (arrived, is_first) = (received.max(body.gathered()), told == 0);
            let tells = now() - last >= PROGRESS_INTERVAL && arrived > told;
            if tells {
                (last, told) = (now(), arrived);
            }
            let unread = self
                .step(move |cx, this| {
                    this.take_chunk(cx, chunk, tells.then_some((arrived, total)), is_first)
                })
                .await?;
            if let Some(mut unread) = unread {
                body.expect_read_to_end(&FOR_DATA, &mut unread);
                (received, share, is_whole) = (0, Share::of(&FOR_DATA), true);
            }
        }
        self.step(move |cx, this| this.finish(cx, received, total, received > told))
            .await
            .map(Ok)
    }
}

fn expected_length(headers: &HeaderList) -> u64 {
    headers
        .get(b"content-length")
        .filter(|_| !headers.contains(b"content-encoding"))
        .and_then(|it| digits(&it))
        .unwrap_or(0)
}

impl XMLHttpRequest {
    #[optimize(size)]
    pub(crate) fn constructor() -> XMLHttpRequest {
        XMLHttpRequest {
            base: EventTarget::default().into(),
            fields: Default::default(),
            state: Cell::new(UNSENT),
            is_sent: Cell::default(),
            is_synchronous: Cell::default(),
            is_uploaded: Cell::default(),
            tells_upload: Cell::default(),
            with_credentials: Cell::default(),
            response_type: Cell::new(ResponseType::Empty),
            timeout: Cell::default(),
            timer: Cell::default(),
            sent_at: Cell::default(),
            generation: Cell::default(),
            options: RefCell::default(),
            headers: RefCell::default(),
            overridden_type: RefCell::default(),
            controller: RefCell::default(),
            received: RefCell::default(),
        }
    }

    fn upload(&self) -> Option<&XMLHttpRequestUpload> {
        js_XMLHttpRequest::upload(self)
            .filter(|_| self.tells_upload.get() && !self.is_uploaded.get())
    }

    fn set_state<'a>(&'a self, cx: Cx<'_, 'a>, state: u16) {
        self.state.set(state);
        if self.has_listeners(atom!("readystatechange")) {
            fire(cx, self, atom!("readystatechange"), EventInit::default());
        }
    }

    #[optimize(size)]
    fn terminate(&self, cx: Cx<'_, '_>) {
        self.generation.update(|it| it + 1);
        if let Some(it) = self.controller.take() {
            it.abort();
        }
        if let Some(it) = self.timer.take() {
            tasks::cancel(cx.global(), it);
        }
    }

    fn forget_response(&self) {
        self.received.take();
        js_XMLHttpRequest::set_text(self, JSValue::ZERO);
        js_XMLHttpRequest::set_value(self, JSValue::ZERO);
    }

    fn blocks_window(&self, heap: &JsHeap<'_>) -> bool {
        self.is_synchronous.get() && heap.is_window() && self.state.get() != UNSENT
    }

    pub(crate) fn get_ready_state(&self) -> u16 {
        self.state.get()
    }

    pub(crate) fn open<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        method: &DomString,
        url: &DomString,
    ) -> Result<'a> {
        self.open_with(cx, method, url, true, None, None)
    }

    #[optimize(size)]
    pub(crate) fn open_with<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        method: &DomString,
        url: &DomString,
        is_async: bool,
        name: Option<&[u8]>,
        password: Option<&[u8]>,
    ) -> Result<'a> {
        let method = bytes_of(method);
        client_or_program(self.realm(&cx.heap))
            .ok_or_else(|| invalid_state(&cx.heap, "The document is not active."))?;
        if !is_token(&method) {
            return Err(cx.heap.dom_exception(
                DomError::SyntaxError,
                format_args!("'{}' is not a valid HTTP method.", bstr::BStr::new(&method)),
            ));
        }
        if is_forbidden_method(&method) {
            return Err(cx.heap.dom_exception(
                DomError::SecurityError,
                format_args!("'{}' HTTP method is unsupported.", bstr::BStr::new(&method)),
            ));
        }
        let url = parse_url_in_encoding(self.realm(&cx.heap), url)
            .ok_or_else(|| dom_error(&cx.heap, DomError::SyntaxError, "Invalid URL"))?;
        if !is_async
            && cx.heap.is_window()
            && (self.timeout.get() != 0 || self.response_type.get() != ResponseType::Empty)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidAccessError,
                "A synchronous request of a document has no timeout and no response type.",
            ));
        }
        self.terminate(cx);
        self.is_sent.set(false);
        self.tells_upload.set(false);
        self.is_synchronous.set(!is_async);
        let mut options = Options::new(url.with_credentials(name, password));
        options.method = normalize_method(&method).into();
        self.options.replace(Some(options.into()));
        self.headers.take();
        self.forget_response();
        if self.state.get() != OPENED {
            below_script(cx, |cx| self.set_state(cx, OPENED));
        }
        Ok(())
    }

    fn check_opened<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        if self.state.get() == OPENED && !self.is_sent.get() {
            Ok(())
        } else {
            Err(invalid_state(heap, "The object's state must be OPENED."))
        }
    }

    #[optimize(size)]
    pub(crate) fn set_request_header<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &DomString,
        value: &DomString,
    ) -> Result<'a> {
        let (name, value) = (bytes_of(name), bytes_of(value));
        let value = trim_http_whitespace(&value);
        self.check_opened(heap)?;
        if !is_token(&name) || !is_header_value(value) {
            return Err(heap.dom_exception(
                DomError::SyntaxError,
                format_args!("'{}' is not a valid header.", bstr::BStr::new(&name)),
            ));
        }
        if !is_forbidden_request_header(&name, value) {
            let combined = self
                .headers
                .borrow()
                .get(&name)
                .map_or_else(|| value.to_vec(), |it| [&it, &b", "[..], value].concat());
            self.headers.borrow_mut().set(&name, &combined);
        }
        Ok(())
    }

    pub(crate) fn get_timeout(&self) -> u32 {
        self.timeout.get()
    }

    #[optimize(size)]
    pub(crate) fn set_timeout<'a>(&'a self, cx: Cx<'_, 'a>, timeout: u32) -> Result<'a> {
        if self.blocks_window(&cx.heap) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidAccessError,
                "A synchronous request of a document has no timeout.",
            ));
        }
        self.timeout.set(timeout);
        if self.controller.borrow().is_some() {
            self.start_timer(cx);
        }
        Ok(())
    }

    #[optimize(size)]
    fn start_timer<'a>(&'a self, cx: Cx<'_, 'a>) {
        if let Some(it) = self.timer.take() {
            tasks::cancel(cx.global(), it);
        }
        if self.timeout.get() != 0 {
            let left = (self.sent_at.get() + f64::from(self.timeout.get()) - now()).max(0.0);
            self.time_out_after(&cx.heap, left, true);
        }
    }

    /// What has arrived during a long task comes first.
    #[optimize(size)]
    fn time_out_after(&self, heap: &JsHeap<'_>, delay: f64, may_wait: bool) {
        const GRACE: f64 = 10.0;
        let due = now() + delay;
        self.timer.set(queue_task_after(
            self.realm(heap),
            delay,
            [self.to_js()],
            move |cx, [this]| {
                let Some(this) = XMLHttpRequest::from_js(&cx.heap, this.to_js()) else {
                    return;
                };
                if may_wait && now() - due > GRACE {
                    this.time_out_after(&cx.heap, GRACE, false)
                } else {
                    this.fail(cx, atom!("timeout"))
                }
            },
        ));
    }

    pub(crate) fn get_with_credentials(&self) -> bool {
        self.with_credentials.get()
    }

    #[optimize(size)]
    pub(crate) fn set_with_credentials<'a>(&self, heap: &JsHeap<'a>, value: bool) -> Result<'a> {
        if self.state.get() > OPENED || self.is_sent.get() {
            return Err(invalid_state(heap, "The request has been sent."));
        }
        self.with_credentials.set(value);
        Ok(())
    }

    pub(crate) fn get_upload<'a>(&self, heap: &JsHeap<'a>) -> &'a XMLHttpRequestUpload {
        js_XMLHttpRequestUpload::create(self.realm(heap), Default::default())
    }

    #[optimize(size)]
    fn extract<'a>(&'a self, cx: Cx<'_, 'a>, body: JsLocal<'a>) -> Result<'a, Data> {
        let (data, mime, is_text) = if let Some(doc) = Doc::from_js(&cx.heap, body.to_js()) {
            let (text, mime) = markup::serialize_document(cx, doc)?;
            (
                Data::Bytes(text.to_utf8().into_owned().into_bytes().into()),
                Some([mime, b";charset=UTF-8"].concat().into()),
                true,
            )
        } else {
            let (data, mime) = Body::extract_data(cx, body)?;
            let is_text = matches!(mime.as_deref(), Some(TEXT | URL_ENCODED))
                && body
                    .to_js()
                    .as_class_ref::<bun_jsc::webcore_types::Blob>()
                    .is_none();
            (data, mime, is_text)
        };
        let mut headers = self.headers.borrow_mut();
        let Some(given) = headers.get(b"content-type").map(|it| Mime::parse(&it)) else {
            headers.set_if_absent(b"Content-Type", mime.as_deref().unwrap_or_default());
            return Ok(data);
        };
        if let Some(mut given) = given.filter(|it| {
            is_text
                && it
                    .parameter(b"charset")
                    .is_some_and(|it| !it.eq_ignore_ascii_case(b"utf-8"))
        }) {
            given.set_parameter(b"charset", b"UTF-8");
            headers.set(b"Content-Type", &given.serialize());
        }
        Ok(data)
    }

    #[optimize(size)]
    pub(crate) fn send<'a>(&'a self, cx: Cx<'_, 'a>, body: JsLocal<'a>) -> Result<'a> {
        copy_of_buffer(cx, body).map(drop)?;
        self.check_opened(&cx.heap)?;
        let takes_body = || {
            !self
                .options
                .borrow()
                .as_ref()
                .is_none_or(|it| it.has_get_or_head())
        };
        let data = (!body.to_js().is_undefined_or_null() && takes_body())
            .then(|| self.extract(cx, body))
            .transpose()?
            .filter(|_| takes_body());
        self.check_opened(&cx.heap)?;
        let realm = self.realm(&cx.heap);
        let (Some(mut options), Some(client)) = (
            self.options.borrow().as_deref().cloned(),
            client_or_program(realm),
        ) else {
            return Err(invalid_state(&cx.heap, "The document is not active."));
        };
        self.tells_upload
            .set(js_XMLHttpRequest::upload(self).is_some_and(|it| it.has_any_listener()));
        options.credentials = if self.with_credentials.get() {
            Credentials::Include
        } else {
            Credentials::SameOrigin
        };
        options.uses_preflight = self.tells_upload.get();
        self.is_uploaded.set(data.is_none());
        self.is_sent.set(true);
        let length = data.as_ref().map_or(0, Data::len);
        let mut request = options.into_request(
            &client,
            self.headers.borrow().clone(),
            InitiatorType::XmlHttpRequest,
        );
        request.body = data.map(RequestBody::Data);
        if self.is_synchronous.get() {
            let timeout = Some(self.timeout.get())
                .filter(|it| *it != 0)
                .map(|it| Duration::from_millis(it.into()));
            let may_block = !realm.is_window() || client.may_use(Feature::SyncXhr);
            let loading = async move {
                client
                    .fetch_whole(request, &Controller::default())
                    .await
                    .ok()
            };
            let (error, loaded) = match if may_block {
                block_on(cx, loading, timeout)
            } else {
                Some(None)
            } {
                Some(loaded) => (DomError::NetworkError, loaded),
                None => (DomError::TimeoutError, None),
            };
            let Some(loaded) = loaded else {
                self.state.set(DONE);
                self.is_sent.set(false);
                let url = self
                    .options
                    .borrow()
                    .as_ref()
                    .map(|it| it.url.href().to_vec())
                    .unwrap_or_default();
                return Err(cx.heap.dom_exception(
                    error,
                    format_args!("Failed to load '{}'.", bstr::BStr::new(&url)),
                ));
            };
            self.accept(&loaded.head, loaded.bytes.to_vec());
            below_script(cx, |cx| {
                self.finish(
                    cx,
                    loaded.bytes.len() as u64,
                    expected_length(&loaded.head.headers),
                    false,
                )
            });
            return Ok(());
        }
        let generation = self.generation.get();
        below_script(cx, |cx| {
            progress(cx, self, atom!("loadstart"), 0, 0);
            if let Some(it) = self.upload() {
                progress(cx, it, atom!("loadstart"), 0, length);
            }
        });
        if self.generation.get() != generation {
            return Ok(());
        }
        let controller = if self.tells_upload.get() {
            Controller::with_upload_progress()
        } else {
            Controller::default()
        };
        self.controller.replace(Some(controller.clone()));
        self.sent_at.set(now());
        self.start_timer(cx);
        let running = Running {
            kept: Kept::new(cx, self.to_js()),
            generation,
        };
        spawn(self.realm(&cx.heap), async move {
            let Either::Second(fetched) = exec::race(
                running.tell_upload(&controller, length),
                client.fetch(request, &controller),
            )
            .await
            else {
                return;
            };
            let outcome = match fetched {
                Ok(fetched) => running.receive(fetched, length).await,
                Err(error) => Some(Err(error)),
            };
            if let Some(Err(error)) = outcome {
                running
                    .step(move |cx, this| {
                        this.fail(
                            cx,
                            if error == NetError::Aborted {
                                atom!("abort")
                            } else {
                                atom!("error")
                            },
                        )
                    })
                    .await;
            }
        });
        Ok(())
    }

    fn accept(&self, head: &Head, bytes: Vec<u8>) {
        self.received.replace(Some(
            Received {
                about: About::of(head),
                url: head.url.clone(),
                headers: head.exposed_headers(),
                bytes,
            }
            .into(),
        ));
    }

    #[optimize(size)]
    fn start_response<'a>(&'a self, cx: Cx<'_, 'a>, head: &Head, length: u64) {
        let (upload, generation) = (self.upload(), self.generation.get());
        self.is_uploaded.set(true);
        if let Some(upload) = upload.filter(|_| !head.is_from_service_worker) {
            [atom!("progress"), atom!("load"), atom!("loadend")]
                .into_iter()
                .for_each(|it| progress(cx, upload, it, length, length));
        }
        if self.generation.get() == generation {
            self.accept(head, Vec::new());
            self.set_state(cx, HEADERS_RECEIVED);
        }
    }

    #[optimize(size)]
    /// Gives the first one back if nothing can be read before the end.
    fn take_chunk<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        chunk: Chunk,
        to_tell: Option<(u64, u64)>,
        is_first: bool,
    ) -> Option<Vec<u8>> {
        if let Some(Received { bytes, .. }) = self.received.borrow_mut().as_deref_mut() {
            if bytes.is_empty() {
                *bytes = chunk.into_vec();
            } else {
                bytes.extend_from_slice(&chunk);
            }
        }
        js_XMLHttpRequest::set_text(self, JSValue::ZERO);
        if let (Some((received, total)), generation) = (to_tell, self.generation.get()) {
            self.set_state(cx, LOADING);
            if self.generation.get() == generation {
                progress(cx, self, atom!("progress"), received, total);
            }
        }
        let is_whole = is_first
            && !matches!(
                self.response_type.get(),
                ResponseType::Empty | ResponseType::Text
            );
        self.received
            .borrow_mut()
            .as_mut()
            .filter(|_| is_whole)
            .map(|it| core::mem::take(&mut it.bytes))
    }

    #[optimize(size)]
    fn finish<'a>(&'a self, cx: Cx<'_, 'a>, received: u64, total: u64, has_untold_progress: bool) {
        let generation = self.generation.get();
        if has_untold_progress {
            progress(cx, self, atom!("progress"), received, total);
        }
        if self.generation.get() != generation {
            return;
        }
        self.controller.take();
        if let Some(it) = self.timer.take() {
            tasks::cancel(cx.global(), it);
        }
        js_XMLHttpRequest::set_text(self, JSValue::ZERO);
        self.is_sent.set(false);
        self.set_state(cx, DONE);
        if self.generation.get() == generation {
            progress(cx, self, atom!("load"), received, total);
            progress(cx, self, atom!("loadend"), received, total);
        }
    }

    /// <https://xhr.spec.whatwg.org/#request-error-steps>
    #[optimize(size)]
    fn fail<'a>(&'a self, cx: Cx<'_, 'a>, name: Known) {
        self.terminate(cx);
        self.is_sent.set(false);
        self.forget_response();
        self.set_state(cx, DONE);
        let upload = self.upload();
        self.is_uploaded.set(true);
        for target in upload.map(|it| &***it).into_iter().chain([&***self]) {
            progress(cx, target, name, 0, 0);
            progress(cx, target, atom!("loadend"), 0, 0);
        }
    }

    #[optimize(size)]
    pub(crate) fn abort<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.terminate(cx);
        if matches!(
            (self.state.get(), self.is_sent.get()),
            (OPENED, true) | (HEADERS_RECEIVED | LOADING, _)
        ) {
            below_script(cx, |cx| self.fail(cx, atom!("abort")));
        }
        if self.state.get() == DONE {
            self.state.set(UNSENT);
            self.forget_response();
        }
    }

    pub(crate) fn get_response_url<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(
            self.received
                .borrow()
                .as_ref()
                .map_or(b"", |it| &it.about.url),
        )
    }

    pub(crate) fn get_status(&self) -> u16 {
        self.received
            .borrow()
            .as_ref()
            .map_or(0, |it| it.about.status)
    }

    pub(crate) fn get_status_text<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        heap.create_latin1_string(
            self.received
                .borrow()
                .as_ref()
                .map_or(b"", |it| &it.about.status_text),
        )
    }

    pub(crate) fn get_response_header<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> Option<Str<'a>> {
        Some(
            heap.create_latin1_string(
                &self
                    .received
                    .borrow()
                    .as_ref()?
                    .headers
                    .get(&bytes_of(name))?,
            ),
        )
    }

    pub(crate) fn get_all_response_headers<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        let received = self.received.borrow();
        let mut sorted = received
            .as_ref()
            .map(|it| it.headers.sorted_and_combined())
            .unwrap_or_default();
        sorted.order_by_cached_key(|it| it.0.to_ascii_uppercase());
        heap.create_latin1_string(
            &sorted
                .iter()
                .flat_map(|it| [&it.0[..], b": ", &it.1, b"\r\n"])
                .collect::<Vec<_>>()
                .concat(),
        )
    }

    #[optimize(size)]
    pub(crate) fn override_mime_type<'a>(&self, heap: &JsHeap<'a>, mime: &[u8]) -> Result<'a> {
        if self.state.get() >= LOADING {
            return Err(invalid_state(
                heap,
                "The MIME type cannot be overridden when the state is LOADING or DONE.",
            ));
        }
        self.overridden_type
            .replace(Mime::parse(mime).or_else(|| Mime::parse(b"application/octet-stream")));
        Ok(())
    }

    pub(crate) fn get_response_type(&self) -> ResponseType {
        self.response_type.get()
    }

    #[optimize(size)]
    pub(crate) fn set_response_type<'a>(
        &self,
        heap: &JsHeap<'a>,
        value: ResponseType,
    ) -> Result<'a> {
        if value == ResponseType::Document && !heap.is_window() {
            return Ok(());
        }
        if self.state.get() >= LOADING {
            return Err(invalid_state(
                heap,
                "The type cannot be set when the state is LOADING or DONE.",
            ));
        }
        if self.blocks_window(heap) {
            return Err(dom_error(
                heap,
                DomError::InvalidAccessError,
                "A synchronous request of a document has no response type.",
            ));
        }
        self.response_type.set(value);
        Ok(())
    }

    /// <https://xhr.spec.whatwg.org/#final-mime-type>, and the final encoding.
    fn final_type(&self, received: &Received) -> Option<(Mime, Option<Encoding>)> {
        let (of_response, overridden) = (
            received
                .headers
                .mime()
                .or_else(|| Mime::parse(b"text/xml"))?,
            self.overridden_type.borrow().clone(),
        );
        let encoding = overridden
            .iter()
            .chain([&of_response])
            .find_map(|it| it.parameter(b"charset"))
            .and_then(Encoding::for_label);
        Some((overridden.unwrap_or(of_response), encoding))
    }

    #[optimize(size)]
    fn text<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        if let Some(text) = js_XMLHttpRequest::text(self) {
            return Ok(text);
        }
        let received = self.received.borrow();
        let Some((received, (mime, encoding))) = received
            .as_ref()
            .filter(|_| self.state.get() >= LOADING)
            .and_then(|it| Some((it, self.final_type(it)?)))
        else {
            return Ok(heap.create_latin1_string(b"").to_js());
        };
        let may_be_declared =
            self.response_type.get() == ResponseType::Empty && mime::is_xml(mime.essence());
        let encoding = encoding
            .or_else(|| Encoding::declared_in_xml(&received.bytes).filter(|_| may_be_declared))
            .unwrap_or_default();
        let text = heap
            .create_utf8_string(
                encoding
                    .decode(&received.bytes, self.state.get() != DONE)
                    .as_bytes(),
            )?
            .to_js();
        js_XMLHttpRequest::set_text(self, text);
        Ok(text)
    }

    #[optimize(size)]
    fn convert<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        Received {
            bytes,
            url,
            headers,
            ..
        }: &mut Received,
        mime: &Mime,
        encoding: Option<Encoding>,
    ) -> Result<'a, JSValue> {
        let realm = self.realm(&cx.heap);
        Ok(match self.response_type.get() {
            ResponseType::ArrayBuffer => array_buffer(realm, Chunk::Owned(core::mem::take(bytes)))?,
            ResponseType::Blob => {
                create_blob(global_of(realm), core::mem::take(bytes), &mime.serialize())
            }
            ResponseType::Json => {
                parse_json(cx, bytes).or_else(|it| cx.catch(it).map(|_| JSValue::NULL))?
            }
            kind => {
                let is_html = mime.essence() == b"text/html";
                if bytes.is_empty()
                    || if is_html {
                        kind == ResponseType::Empty
                    } else {
                        !mime::is_xml(mime.essence())
                    }
                {
                    return Ok(JSValue::NULL);
                }
                let declared = || {
                    if is_html {
                        Encoding::declared_in_html(bytes)
                    } else {
                        Encoding::declared_in_xml(bytes)
                    }
                };
                let encoding = Encoding::for_bom(bytes)
                    .or(encoding)
                    .or_else(declared)
                    .unwrap_or_default();
                let source = DomString::from_utf8(&encoding.decode(bytes, false));
                let Some(shown) = WindowTarget::of_realm(realm).and_then(WindowTarget::doc) else {
                    return Ok(JSValue::NULL);
                };
                let describe = |doc: &Doc| {
                    doc.set_url(DomString::from_latin1(url.href()));
                    doc.set_base_url(doc.url());
                    doc.set_legacy_encoding(
                        (!encoding.is_utf8())
                            .then(|| encoding.name().to_ascii_lowercase().as_str().into()),
                    );
                    doc.set_last_modified(
                        headers
                            .get(b"last-modified")
                            .map(|it| DomString::from_latin1(&it)),
                    );
                };
                markup::parse_response(
                    cx,
                    shown,
                    &source,
                    &DomString::from_latin1(mime.essence()).to_utf8(),
                    describe,
                )?
                .map_or(JSValue::NULL, |it| it.to_js())
            }
        })
    }

    #[optimize(size)]
    fn object<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if let Some(value) = js_XMLHttpRequest::value(self) {
            return Ok(value);
        }
        let (mut received, generation) = (self.received.take(), self.generation.get());
        let found = received
            .as_mut()
            .filter(|_| self.state.get() == DONE)
            .and_then(|it| Some((self.final_type(it)?, it)));
        let value =
            found.map(|((mime, encoding), received)| self.convert(cx, received, &mime, encoding));
        if self.generation.get() != generation {
            return Ok(value.transpose()?.unwrap_or(JSValue::NULL));
        }
        self.received.replace(received);
        let value = value.transpose()?;
        js_XMLHttpRequest::set_value(self, value.unwrap_or_default());
        Ok(value.unwrap_or(JSValue::NULL))
    }

    pub(crate) fn get_response<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if matches!(
            self.response_type.get(),
            ResponseType::Empty | ResponseType::Text
        ) {
            self.text(&cx.heap)
        } else {
            self.object(cx)
        }
    }

    pub(crate) fn get_response_text<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if !matches!(
            self.response_type.get(),
            ResponseType::Empty | ResponseType::Text
        ) {
            return Err(invalid_state(
                &cx.heap,
                "The value is only accessible if the object's 'responseType' is '' or 'text'.",
            ));
        }
        self.text(&cx.heap)
    }

    pub(crate) fn get_response_xml<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        if !matches!(
            self.response_type.get(),
            ResponseType::Empty | ResponseType::Document
        ) {
            return Err(invalid_state(
                &cx.heap,
                "The value is only accessible if the object's 'responseType' is '' or 'document'.",
            ));
        }
        self.object(cx)
    }
}
