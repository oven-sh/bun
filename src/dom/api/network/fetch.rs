//! <https://fetch.spec.whatwg.org/#fetch-method>

use bun_jsc::{Strong, cpp};
use bun_web::client::DeferError;
use bun_web::headers::is_cors_safelisted;
use bun_web::net::fetch::Controller;
use bun_web::request::{Credentials, InitiatorType, Mode, RequestBody};
use bun_web::streams;

use super::body::{Body, Content, failure};
use super::request::{Options, Parts};
use super::*;
use crate::api::realm::{hold, quota_exceeded_with};

/// What a signal aborts.
pub(crate) struct PendingFetch {
    controller: Controller,
    _interior: bindgen::Interior,
}

#[optimize(size)]
fn abort<'a>(
    cx: Cx<'_, 'a>,
    [pending, _]: [JsLocal<'a>; 2],
    _: u64,
    _: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let Some(pending) = PendingFetch::from_js(&cx.heap, pending.to_js()) else {
        return Ok(JSValue::UNDEFINED);
    };
    let local = |it: Option<JSValue>| JsLocal::new(&cx.heap, it.unwrap_or(JSValue::UNDEFINED));
    let (promise, signal) = (
        local(js_PendingFetch::promise(pending)).as_promise(),
        local(js_PendingFetch::signal(pending)).as_abort_signal(),
    );
    let reason = signal.map_or(JSValue::UNDEFINED, |it| it.reason(&cx.heap));
    promise.map_or(Ok(()), |it| it.reject(cx, reason))?;
    js_PendingFetch::upload(pending).map_or(Ok(()), |it| {
        cpp::ReadableStreamReader__cancel(cx.global(), it, reason)
    })?;
    if let Some(it) =
        js_PendingFetch::response(pending).and_then(|it| Response::from_js(&cx.heap, it))
    {
        it.abort_body();
    }
    pending.controller.abort();
    Ok(JSValue::UNDEFINED)
}

#[optimize(size)]
fn send<'a>(
    cx: Cx<'_, 'a>,
    scope: &'a WindowTarget,
    Parts {
        options,
        headers,
        body,
        signal,
    }: Parts<'a>,
) -> Result<'a, JSValue> {
    if let Some(signal) = signal.filter(|it| it.is_aborted()) {
        let reason = signal.reason(&cx.heap);
        body.cancel(cx, reason)?;
        return Err(Error::from_value(JsLocal::new(&cx.heap, reason)));
    }
    let client = client_of(&cx.heap)
        .filter(|it| !options.keepalive || it.may_keep_alive(body.length().unwrap_or(0)))
        .ok_or_else(|| failure(cx, None))?;
    let mut request = options.into_request(&client, headers.list().clone(), InitiatorType::Fetch);
    let upload;
    (request.body, upload) = body.into_upload(cx)?;
    let controller = Controller::default();
    let guest = (!request.keepalive && scope.shares_realm(&cx.heap)).then(|| {
        scope.note_fetch(&controller);
        Strong::create(scope.to_js(), cx.global())
    });
    let pending = signal.map(|signal| {
        let pending = js_PendingFetch::create(
            &cx.heap,
            PendingFetch {
                controller: controller.clone(),
                _interior: Default::default(),
            },
        );
        js_PendingFetch::set_signal(pending, signal.to_js());
        js_PendingFetch::set_upload(pending, upload.map_or(JSValue::ZERO, JsLocal::to_js));
        let algorithm = cx
            .heap
            .create_callback(abort, [pending.to_js(), JSValue::UNDEFINED], 0);
        (pending, signal.add_algorithm(cx, algorithm))
    });
    let held = pending.map(|it| (Strong::create(it.0.to_js(), cx.global()), it.1));
    let promise = streams::promise_for(
        cx,
        async move { client.fetch(request, &controller).await },
        move |cx, fetched| {
            let pending = held
                .as_ref()
                .and_then(|it| PendingFetch::from_js(&cx.heap, it.0.get()));
            let signal = pending.and_then(js_PendingFetch::signal);
            let following = signal
                .zip(held.map(|it| it.1))
                .map(|it| Following(Strong::create(it.0, cx.global()), it.1))
                .map(|it| hold(&cx.heap, it));
            if guest
                .and_then(|it| WindowTarget::from_js(&cx.heap, it.get()))
                .is_some_and(WindowTarget::is_disposed)
            {
                return Ok(JsLocal::new(&cx.heap, cx.heap.create_promise().to_js()));
            }
            let fetched = fetched.map_err(|_| failure(cx, signal))?;
            let response = Response::of_fetched(&cx.heap, fetched, Box::new(following));
            if let Some((pending, signal)) = pending.zip(signal) {
                js_Message::set_followed(response, signal);
                js_PendingFetch::set_response(pending, response.to_js());
            }
            Ok(response.as_object(&cx.heap).as_value())
        },
    );
    if let Some(it) = pending {
        js_PendingFetch::set_promise(it.0, promise.to_js());
    }
    Ok(promise.to_js())
}

/// An algorithm of a signal.
pub(super) struct Following(Strong, u32);

pub(super) fn follow<'a>(
    cx: Cx<'_, 'a>,
    signal: JsLocal<'a, bun_jsc::AbortSignal>,
    controller: &Controller,
) -> Following {
    let pending = js_PendingFetch::create(
        &cx.heap,
        PendingFetch {
            controller: controller.clone(),
            _interior: Default::default(),
        },
    );
    let algorithm = cx
        .heap
        .create_callback(abort, [pending.to_js(), JSValue::UNDEFINED], 0);
    Following(
        Strong::create(signal.to_js(), cx.global()),
        signal.add_algorithm(cx, algorithm),
    )
}

impl Following {
    pub(super) fn reason<'a>(&self, heap: &JsHeap<'a>) -> Option<Error<'a>> {
        let signal = JsLocal::new(heap, self.0.get())
            .as_abort_signal()
            .filter(|it| it.is_aborted())?;
        Some(Error::from_value(JsLocal::new(heap, signal.reason(heap))))
    }
}

impl Drop for Following {
    fn drop(&mut self) {
        bun_web::exec::with_js(|cx| {
            JsLocal::new(&cx.heap, self.0.get())
                .as_abort_signal()
                .map(|it| it.remove_algorithm(self.1))
        });
    }
}

impl FetchingScope {
    pub(crate) fn fetch<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        input: DomRequestInfo<'a>,
        init: &DomRequestInit<'a>,
    ) -> Result<'a, JSValue> {
        let parts = Parts::new(cx, &input, init)?;
        send(cx, self, parts)
    }
}

pub(crate) struct FetchLaterResult(Rc<Cell<bool>>);

impl FetchLaterResult {
    pub(crate) fn get_activated(&self) -> bool {
        self.0.get()
    }
}

fn cancel_deferred<'a>(
    cx: Cx<'_, 'a>,
    _: [JsLocal<'a>; 2],
    id: u64,
    _: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    client_of(&cx.heap).map(|it| it.cancel_deferred_fetch(id as u32));
    Ok(JSValue::UNDEFINED)
}

impl DeferringWindow {
    #[optimize(size)]
    pub(crate) fn fetch_later<'a>(
        &self,
        cx: Cx<'_, 'a>,
        input: DomRequestInfo<'a>,
        init: &DeferredRequestInit<'a>,
    ) -> Result<'a, &'a FetchLaterResult> {
        let &DeferredRequestInit {
            body,
            cache,
            credentials,
            duplex,
            headers,
            integrity,
            keepalive,
            mode,
            priority,
            redirect,
            referrer_policy,
            signal,
            window,
            ..
        } = init;
        let (method, referrer) = (init.method.clone(), init.referrer.clone());
        let common = DomRequestInit {
            body,
            cache,
            credentials,
            duplex,
            headers,
            integrity,
            keepalive,
            method,
            mode,
            priority,
            redirect,
            referrer,
            referrer_policy,
            signal,
            window,
        };
        let Parts {
            mut options,
            headers,
            body,
            signal,
        } = Parts::new(cx, &input, &common)?;
        if let Some(signal) = signal.filter(|it| it.is_aborted()) {
            return Err(Error::from_value(JsLocal::new(
                &cx.heap,
                signal.reason(&cx.heap),
            )));
        }
        if init.activate_after.is_some_and(|it| it < 0.0) {
            return Err(cx
                .heap
                .range_error(format_args!("activateAfter cannot be negative.")));
        }
        let client = client_of(&cx.heap)
            .ok_or_else(|| type_error(&cx.heap, "The document is not fully active."))?;
        let length = body
            .length()
            .ok_or_else(|| type_error(&cx.heap, "The body cannot be a ReadableStream."))?;
        let of_headers: usize = headers
            .list()
            .iter()
            .map(|it| it.0.len() + it.1.len())
            .sum();
        let size = options.url.without_fragment().len()
            + options.referrer.as_bytes().len()
            + of_headers
            + length as usize;
        options.keepalive = true;
        let mut request =
            options.into_request(&client, headers.list().clone(), InitiatorType::Fetch);
        request.body = body.into_upload(cx)?.0;
        let id = client.defer_fetch(request, size).map_err(|it| match it {
            DeferError::InsecureUrl => type_error(
                &cx.heap,
                "The URL has to be a potentially trustworthy HTTP(S) URL.",
            ),
            DeferError::QuotaExceeded(left) => quota_exceeded_with(
                cx,
                "The quota of fetchLater() is exceeded.",
                Some([left as f64, size as f64]),
            ),
        })?;
        if let Some(signal) = signal {
            let algorithm =
                cx.heap
                    .create_callback(cancel_deferred, [JSValue::UNDEFINED; 2], id.into());
            signal.add_algorithm(cx, algorithm);
        }
        let is_activated = Rc::new(Cell::new(false));
        if let Some(delay) = init.activate_after {
            let is_activated = Rc::clone(&is_activated);
            queue_task_after(&cx.heap, delay, [], move |_, []| {
                is_activated.set(client.send_deferred_fetch(id))
            });
        }
        Ok(js_FetchLaterResult::create(
            &cx.heap,
            FetchLaterResult(is_activated),
        ))
    }
}

impl NavigatorBeacon {
    /// <https://w3c.github.io/beacon/#sendbeacon-method>
    #[optimize(size)]
    pub(crate) fn send_beacon<'a>(
        &self,
        cx: Cx<'_, 'a>,
        url: &DomString,
        data: JsLocal<'a>,
    ) -> Result<'a, bool> {
        let url = parse_url(&cx.heap, url)
            .filter(Url::is_http)
            .ok_or_else(|| type_error(&cx.heap, "The URL of a beacon has to be an HTTP(S) URL."))?;
        let (body, mime) = if data.to_js().is_undefined_or_null() {
            Default::default()
        } else {
            Body::extract(cx, data, true)?
        };
        let Some(client) = last_client_of(&cx.heap)
            .or_else(|| client_or_program(&cx.heap))
            .filter(|it| it.may_keep_alive(body.length().unwrap_or(0)))
        else {
            return Ok(false);
        };
        if client.blocks_as_mixed_content(&url) {
            return Ok(false);
        }
        let mut options = Options::new(url);
        (options.method, options.credentials, options.keepalive) =
            (b"POST"[..].into(), Credentials::Include, true);
        options.mode = if mime
            .as_ref()
            .is_none_or(|it| is_cors_safelisted(b"content-type", it))
        {
            Mode::NoCors
        } else {
            Mode::Cors
        };
        let mut request = options.into_request(
            &client,
            mime.iter().map(|it| ("Content-Type", it)).collect(),
            InitiatorType::Beacon,
        );
        request.body = if let Content::Data(data) = body.content {
            Some(RequestBody::Data(data))
        } else {
            None
        };
        client.fetch_and_forget(request);
        Ok(true)
    }
}
