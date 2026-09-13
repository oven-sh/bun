//! One WebTransport session over HTTP/3, as `Bun.serve`'s `webtransport`
//! handlers see it. Datagrams only — the unreliable half is the reason to
//! reach for WebTransport over a WebSocket.
//!
//! Lifetime is the CONNECT stream's, owned by the native layer. The wrapper
//! holds a strong self-reference while that stream lives, since a session with
//! no JS references must still deliver datagrams, and downgrades it on close.

use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_uws_sys::h3::{DatagramResult, Request, Response, WebTransport};

use crate::server::WebTransportHandler;
use crate::server::jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult};

/// Every callback can re-enter: a `datagram` handler calling `session.close()`
/// reaches this object before the outer frame returns. Hence `&self` receivers
/// and `Cell`/`JsCell` state.
#[bun_jsc::JsClass(no_constructor)]
pub struct WebTransportSession {
    /// `None` once the session has gone; JS can hold the object indefinitely.
    session: Cell<Option<NonNull<WebTransport>>>,
    this_value: JsCell<JsRef>,
    /// Points into `ServerConfig.webtransport_handler`, which outlives every
    /// session on the server it configures.
    handler: bun_ptr::BackRef<WebTransportHandler>,
    global: bun_ptr::BackRef<JSGlobalObject>,
    /// Kept live by the session count this took out in `accept`: the server
    /// cannot deinit while that count is non-zero.
    server: crate::server::AnyServer,
}

#[allow(non_snake_case)]
pub mod js {
    ::bun_jsc::codegen_cached_accessors!("WebTransportSession"; data);
}

/// What the CONNECT route should do with a request, decided before anything is
/// written back.
pub(crate) enum Decision {
    /// Not ours; back to the router. Answering every CONNECT here would take
    /// them all away from `fetch` the moment `webtransport` was added.
    Yield,
    /// Accept, with the value the `upgrade` handler returned as the session's
    /// `data`.
    Accept(JSValue),
    /// The `upgrade` handler returned a `Response`; send it instead of opening
    /// a session.
    Refuse(JSValue),
    /// The `upgrade` handler threw. The exception has already been reported.
    Failed,
}

/// The CONNECT as a `Request` for the `upgrade` handler. `:authority` reaches
/// Rust as `host`, `url()` is the path with its query, and HTTP/3 is always
/// TLS, so the URL the browser asked for is recoverable.
///
/// Also returns the raw allocation: the request context set here borrows
/// `res`, and `decide` must sever it before the stream's owner resumes.
fn build_request(
    global: &JSGlobalObject,
    req: &mut Request,
    res: &mut Response,
) -> Option<(JSValue, *mut crate::webcore::Request)> {
    use crate::webcore::Request as WebRequest;
    use crate::webcore::response::HeadersRef;
    use bun_core::fmt as bun_fmt;
    use bun_jsc::FetchHeaders;

    // SAFETY: `req` is the live uWS request for this callback; the headers are
    // copied out, not borrowed. `create_from_h3` returns +1, which `adopt`
    // takes over.
    let headers = unsafe {
        HeadersRef::adopt(FetchHeaders::create_from_h3(
            core::ptr::from_mut(req).cast::<c_void>(),
        ))
    };
    // Owned before `url()` takes the second borrow: both alias the same uWS
    // buffer.
    let prefix: Option<Vec<u8>> = req
        .header(b"host")
        .filter(|host| WebRequest::is_valid_host_header(host))
        .map(|host| {
            let mut s = Vec::new();
            let fmt = bun_fmt::HostFormatter {
                is_https: true,
                host,
                port: None,
            };
            let _ = core::fmt::Write::write_fmt(
                &mut bun_fmt::VecWriter(&mut s),
                format_args!("https://{fmt}"),
            );
            s
        });
    let path = req.url();
    let mut url = prefix.unwrap_or_default();
    if url.is_empty() || !path.starts_with(b"/") {
        url = path.to_vec();
    } else {
        url.extend_from_slice(path);
    }

    let mut request = Box::new(WebRequest::init2(
        bun_core::String::clone_utf8(&url),
        Some(headers),
        crate::webcore::body::hive_alloc(crate::webcore::body::Value::Null),
        bun_http_types::Method::Method::CONNECT,
    ));
    request.request_context =
        crate::server::AnyRequestContext::webtransport_connect(core::ptr::from_mut(res));
    let request = bun_core::heap::into_raw(request);
    // SAFETY: just allocated; `to_js` hands the allocation to the JS wrapper,
    // whose finalizer frees it.
    Some((unsafe { (*request).to_js(global) }, request))
}

impl WebTransportSession {
    fn init(
        global: &JSGlobalObject,
        handler: &WebTransportHandler,
        session: NonNull<WebTransport>,
        data_value: JSValue,
        server: crate::server::AnyServer,
    ) -> *mut WebTransportSession {
        let this = bun_core::heap::into_raw(Box::new(WebTransportSession {
            session: Cell::new(Some(session)),
            this_value: JsCell::new(JsRef::empty()),
            handler: bun_ptr::BackRef::new(handler),
            global: bun_ptr::BackRef::new(global),
            server,
        }));
        // SAFETY: just allocated; ownership transfers to the JS wrapper, which
        // frees it through the generated finalizer.
        let this_value = unsafe { WebTransportSession::to_js_ptr(this, global) };
        // SAFETY: just allocated and not yet reachable from any other frame.
        let this_ref = unsafe { &*this };
        this_ref
            .this_value
            .set(JsRef::init_strong(this_value, global));
        js::data_set_cached(this_value, global, data_value);
        this
    }

    /// The JS wrapper, for dispatching a handler at it. `None` once the
    /// wrapper has been finalized.
    pub(crate) fn js_value(&self) -> Option<JSValue> {
        self.this_value.get().try_get()
    }

    /// Ask the `upgrade` handler whether to open a session. Split from
    /// [`Self::accept`] because refusing writes a `Response`, which needs the
    /// server. Nothing is written to `res` here.
    pub(crate) fn decide(
        global: &JSGlobalObject,
        on_upgrade: JSValue,
        req: &mut Request,
        res: &mut Response,
        server_value: JSValue,
    ) -> Decision {
        if !req.is_webtransport() {
            return Decision::Yield;
        }
        if on_upgrade.is_empty_or_undefined_or_null() {
            return Decision::Accept(JSValue::UNDEFINED);
        }
        // `init2` copies the URL and headers, so a handler that keeps the
        // Request keeps something valid. The fetch path would drag a
        // RequestContext, abort signal and body slot along for a CONNECT that
        // has none — but the one piece a session cannot do without is
        // `server.requestIP()`, the only handle on a peer opening sessions
        // faster than it should. So the request borrows the CONNECT stream
        // for exactly the `upgrade` call, and is severed below.
        let (request_value, request_ptr) = match build_request(global, req, res) {
            Some(v) => v,
            None => return Decision::Failed,
        };
        let vm = VirtualMachine::get();
        let _loop_guard = vm.enter_event_loop_scope();
        // `server` is the second argument, as in `fetch`: `requestIP` lives
        // there, and the handler-declared-separately pattern has no other way
        // to reach it before `Bun.serve` returns.
        let returned = on_upgrade.call(global, JSValue::UNDEFINED, &[request_value, server_value]);
        // On every path out of the call, throwing included: a kept Request now
        // answers `requestIP` with null, as a fetch request does once its
        // response is gone.
        // SAFETY: the JS wrapper holds the allocation live, and no reference
        // to it exists in this frame.
        unsafe { (*request_ptr).request_context = crate::server::AnyRequestContext::NULL };
        let returned = match returned {
            Ok(v) => v,
            Err(e) => {
                let err = global.take_exception(e);
                // Reported rather than routed to the server's `error` handler,
                // which answers with a `Response`: this throw has already
                // decided its answer. Same as a throwing websocket handler.
                VirtualMachine::get().as_mut().run_error_handler(err, None);
                return Decision::Failed;
            }
        };
        request_value.ensure_still_alive();
        // A `Response` is the refusal, anything else is `session.data`: one
        // return value doing one job each way, and nobody wants a `Response`
        // as session data.
        if crate::webcore::response::from_js(returned).is_some() {
            return Decision::Refuse(returned);
        }
        Decision::Accept(returned)
    }

    /// Answer an extended CONNECT by opening a session, and run the `open`
    /// handler. A connection that never negotiated the extension gets a 501
    /// and no session.
    pub(crate) fn accept(
        global: &JSGlobalObject,
        handler: &WebTransportHandler,
        req: &mut Request,
        res: &mut Response,
        data_value: JSValue,
        server: crate::server::AnyServer,
    ) {
        let Some(session) = res.upgrade_webtransport(req, core::ptr::null_mut()) else {
            res.write_status(b"501 Not Implemented");
            res.end(b"", false);
            return;
        };
        // SAFETY: a non-null session from `upgrade_webtransport`.
        let session = unsafe { NonNull::new_unchecked(session) };

        // Before any handler runs: the count is what keeps the server wrapper
        // from being downgraded while this session can still dispatch.
        server.note_webtransport_opened_any();
        let this = Self::init(global, handler, session, data_value, server);
        // The native session is what every later callback arrives holding, so
        // it carries the pointer back to this object.
        // SAFETY: `session` is live, and `this` outlives it — the wrapper is
        // only collectable once `dispatch_close` has released it.
        unsafe { session.as_ptr().as_mut().unwrap_unchecked() }
            .set_user_data(this.cast::<c_void>());

        // SAFETY: just created and reachable only from here.
        let this_ref = unsafe { &*this };
        let on_open = handler.on_open;
        if on_open.is_empty_or_undefined_or_null() {
            return;
        }
        let Some(this_value) = this_ref.js_value() else {
            return;
        };
        let vm = VirtualMachine::get();
        let _loop_guard = vm.enter_event_loop_scope();
        if let Err(e) = on_open.call(global, JSValue::UNDEFINED, &[this_value]) {
            let err = global.take_exception(e);
            report(global, err);
        }
    }

    fn dispatch_datagram(&self, data: &[u8]) {
        let cb = self.handler.get().on_datagram;
        if cb.is_empty_or_undefined_or_null() {
            return;
        }
        let global = self.global.get();
        let Some(this_value) = self.js_value() else {
            return;
        };
        // A fresh Uint8Array per datagram: the receive buffer is lsquic's and
        // is reused before the next turn of the loop.
        let bytes = match crate::server::jsc::ArrayBuffer::create::<
            { crate::server::jsc::JSType::Uint8Array },
        >(global, data)
        {
            Ok(bytes) => bytes,
            // Allocation failure, already thrown. Taken here because this
            // frame returns into lsquic's packet processing, where a pending
            // exception would surface against whatever JS ran next.
            Err(e) => {
                let err = global.take_exception(e);
                report(global, err);
                return;
            }
        };
        let vm = VirtualMachine::get();
        let _loop_guard = vm.enter_event_loop_scope();
        if let Err(e) = cb.call(global, JSValue::UNDEFINED, &[this_value, bytes]) {
            let err = global.take_exception(e);
            report(global, err);
        }
    }

    fn dispatch_drain(&self) {
        let cb = self.handler.get().on_drain;
        if cb.is_empty_or_undefined_or_null() {
            return;
        }
        // The queue is per connection and the empty-again signal fans out to
        // every session on it, so a close racing the fire is ordinary — not
        // worth a callback into a session already told it is over.
        if self.session.get().is_none() {
            return;
        }
        let global = self.global.get();
        let Some(this_value) = self.js_value() else {
            return;
        };
        let vm = VirtualMachine::get();
        let _loop_guard = vm.enter_event_loop_scope();
        if let Err(e) = cb.call(global, JSValue::UNDEFINED, &[this_value]) {
            let err = global.take_exception(e);
            report(global, err);
        }
    }

    fn dispatch_close(&self, code: u32, reason: &[u8]) {
        let cb = self.handler.get().on_close;
        let global = self.global.get();
        let this_value = self.js_value();
        // Nulled before any user code runs, so a `close` handler reaching for
        // `sendDatagram()` gets the closed answer rather than a dying stream.
        self.session.set(None);

        if let (Some(this_value), false) = (this_value, cb.is_empty_or_undefined_or_null()) {
            let vm = VirtualMachine::get();
            let _loop_guard = vm.enter_event_loop_scope();
            // into_js, not to_js: `clone_utf8` hands over a +1 that
            // borrowing would never release.
            let reason_js =
                bun_jsc::StringJsc::into_js(bun_core::String::clone_utf8(reason), global)
                    .unwrap_or(JSValue::UNDEFINED);
            let args = [this_value, JSValue::js_number(code as f64), reason_js];
            if let Err(e) = cb.call(global, JSValue::UNDEFINED, &args) {
                let err = global.take_exception(e);
                report(global, err);
            }
        }

        // Only now: until the handler returns this is the wrapper's only root,
        // and a GC inside it would collect the box `self` points at.
        self.this_value.with_mut(|r| r.downgrade());
        // And only after that, since this can run the idle pass that downgrades
        // the server wrapper.
        self.server.on_webtransport_closed();
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn send_datagram(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if callframe.arguments_count() < 1 {
            return Err(global.throw(format_args!("sendDatagram requires 1 argument")));
        }
        // Zero rather than a throw: a datagram is allowed not to arrive, and
        // racing the peer's close is where an exception would be noise.
        let Some(mut session) = self.session.get() else {
            return Ok(JSValue::js_number(0.0));
        };
        // SAFETY: non-null while the cell is `Some`; `dispatch_close` clears
        // it before the stream that owns the native session is freed.
        let session = unsafe { session.as_mut() };

        let value = callframe.argument(0);
        if let Some(buffer) = value.as_array_buffer(global) {
            return Ok(datagram_result_to_js(session.send_datagram(buffer.slice())));
        }

        // The view guard keeps the JSString cell alive while its bytes are read.
        let view = value.to_js_string_view(global)?;
        let slice = view.to_utf8();
        Ok(datagram_result_to_js(session.send_datagram(slice.slice())))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn close(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let Some(mut session) = self.session.get() else {
            return Ok(JSValue::UNDEFINED);
        };
        let [code_value, reason_value] = callframe.arguments_as_array::<2>();
        // Refuse a non-number rather than run a `valueOf` whose exception the
        // non-propagating `to_u32` would swallow, leaving it pending for the
        // reason's `toString` while the session closed as 0.
        let code = if code_value.is_empty_or_undefined_or_null() {
            0u32
        } else if code_value.is_number() {
            code_value.coerce_to_i32(global)? as u32
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "close requires a numeric code or undefined"
            )));
        };
        // SAFETY: as in send_datagram.
        let session = unsafe { session.as_mut() };
        if reason_value.is_empty_or_undefined_or_null() {
            session.close(code, b"");
        } else {
            let view = reason_value.to_js_string_view(global)?;
            let slice = view.to_utf8();
            session.close(code, slice.slice());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn drain(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Advisory, and a closed session has nobody to ask: a no-op, as
        // sendDatagram is for the same race.
        if let Some(mut session) = self.session.get() {
            // SAFETY: as in send_datagram.
            unsafe { session.as_mut() }.drain();
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_max_datagram_size(&self, _global: &JSGlobalObject) -> JSValue {
        let Some(mut session) = self.session.get() else {
            return JSValue::js_number(0.0);
        };
        // SAFETY: as in send_datagram.
        let n = unsafe { session.as_mut() }.max_datagram_size();
        JSValue::js_number(n as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_rtt(&self, _global: &JSGlobalObject) -> JSValue {
        let Some(mut session) = self.session.get() else {
            return JSValue::js_number(0.0);
        };
        // Milliseconds because that is the unit the web platform reports this
        // in (WebTransportConnectionStats.smoothedRtt); lsquic keeps it in
        // microseconds, so the fraction carries the precision.
        // SAFETY: as in send_datagram.
        let us = unsafe { session.as_mut() }.rtt_us();
        JSValue::js_number(f64::from(us) / 1000.0)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_closed(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.session.get().is_none())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_data(&self, _global: &JSGlobalObject) -> JSValue {
        if let Some(this_value) = self.js_value() {
            return js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_data(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        if let Some(this_value) = self.js_value() {
            js::data_set_cached(this_value, global, value);
        }
        Ok(true)
    }

    #[allow(
        clippy::boxed_local,
        reason = "codegen finalize entry point; dropping the box is the reclaim"
    )]
    pub(crate) fn finalize(self: Box<Self>) {
        // Not refcounted: the wrapper is the only owner, so releasing the
        // self-reference's handle and dropping the box is the whole of it.
        self.this_value.with_mut(|v| v.finalize());
    }
}

/// The same three-way answer `ws.send()` gives. The count includes the frame
/// prefix, so an empty payload does not report the `0` that means dropped.
fn datagram_result_to_js(result: DatagramResult) -> JSValue {
    match result {
        DatagramResult::Sent(n) => JSValue::js_number(n as f64),
        DatagramResult::Dropped => JSValue::js_number(0.0),
        DatagramResult::TooLarge => JSValue::js_number(-1.0),
    }
}

fn report(global: &JSGlobalObject, error_value: JSValue) {
    let _ = VirtualMachine::get()
        .as_mut()
        .uncaught_exception(global, error_value, false);
}

/// Registered once per HTTP/3 app; the native session carries the pointer back
/// to its `WebTransportSession`.
pub(crate) extern "C" fn on_datagram(wt: *mut WebTransport, data: *const u8, len: c_uint) {
    // SAFETY: uWS callback contract — `wt` is live for the call, and its user
    // data is the `*mut WebTransportSession` set in `accept`.
    let Some(this) = (unsafe { session_from(wt) }) else {
        return;
    };
    // SAFETY: uWS hands a pointer/length pair valid for the call.
    let bytes = unsafe { bun_core::ffi::slice(data, len as usize) };
    this.dispatch_datagram(bytes);
}

pub(crate) extern "C" fn on_drain(wt: *mut WebTransport) {
    // SAFETY: as for `on_datagram`.
    let Some(this) = (unsafe { session_from(wt) }) else {
        return;
    };
    this.dispatch_drain();
}

pub(crate) extern "C" fn on_close(
    wt: *mut WebTransport,
    code: u32,
    reason: *const u8,
    reason_len: usize,
) {
    // SAFETY: as above.
    let Some(this) = (unsafe { session_from(wt) }) else {
        return;
    };
    // SAFETY: as above.
    let reason = unsafe { bun_core::ffi::slice(reason, reason_len) };
    this.dispatch_close(code, reason);
}

/// # Safety
/// `wt` must be a live session whose user data was set by `accept`.
unsafe fn session_from<'a>(wt: *mut WebTransport) -> Option<&'a WebTransportSession> {
    // SAFETY: the caller upholds this function's contract that `wt` is live.
    let wt = unsafe { wt.as_mut()? };
    let ud = wt.user_data();
    if ud.is_null() {
        return None;
    }
    // SAFETY: `accept` stored a `*mut WebTransportSession` here, and the JS
    // wrapper keeps it alive until `dispatch_close` releases it.
    Some(unsafe { &*ud.cast::<WebTransportSession>() })
}
