//! `WebTransportSession` — one WebTransport session over HTTP/3, as the
//! `webtransport` handlers on `Bun.serve` see it.
//!
//! Only datagrams. A session's streams would be a second, reliable channel
//! with its own backpressure story; the reason an application reaches for
//! WebTransport over a WebSocket in the first place is the unreliable half,
//! and that is the half implemented here.
//!
//! Lifetime is the CONNECT stream's, which the native layer owns. This
//! wrapper holds a strong self-reference for as long as that stream lives — a
//! session with no JS references still has to be able to deliver a datagram —
//! and downgrades it when the session goes, after which the wrapper is
//! collectable and its finalizer drops the box.

use core::cell::Cell;
use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;

use bun_jsc::JsCell;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_uws_sys::h3::{DatagramResult, Request, Response, WebTransport};

use crate::server::WebTransportHandler;
use crate::server::jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult};

/// R-2 (re-entrancy): every callback into a session can re-enter it — a
/// `datagram` handler calling `session.close()` reaches this same object
/// before the outer frame returns. Receivers take `&self` and the state lives
/// behind `Cell`/`JsCell`.
#[bun_jsc::JsClass(no_constructor)]
pub struct WebTransportSession {
    /// `None` once the session has gone. Checked by every method: JS can hold
    /// the object indefinitely, and the native session dies with its stream.
    session: Cell<Option<NonNull<WebTransport>>>,
    this_value: JsCell<JsRef>,
    /// Points into `ServerConfig.webtransport_handler`, which outlives every
    /// session on the server it configures.
    handler: bun_ptr::BackRef<WebTransportHandler>,
    global: bun_ptr::BackRef<JSGlobalObject>,
}

#[allow(non_snake_case)]
pub mod js {
    ::bun_jsc::codegen_cached_accessors!("WebTransportSession"; data);
}

/// What the CONNECT route should do with a request, decided before anything is
/// written back.
pub(crate) enum Decision {
    /// Not ours. Back to the router, which falls through to whatever the
    /// application registered — answering every CONNECT here would take them
    /// all away from `fetch` the moment a `webtransport` handler was added.
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

/// The CONNECT as a `Request`, for the `upgrade` handler to inspect.
///
/// `:authority` reaches Rust as `host` and `url()` is the path with its query,
/// which is everything needed to rebuild the URL a browser asked for. HTTP/3 is
/// always TLS, so the scheme is not in question.
fn build_request(global: &JSGlobalObject, req: &mut Request) -> Option<JSValue> {
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
    // The prefix is built while `host` is borrowed and owned before `url()`
    // takes the second borrow — both alias the same uWS buffer.
    let prefix: Option<Vec<u8>> = req
        .header(b"host")
        .filter(|host| WebRequest::is_valid_host_header(host))
        .map(|host| {
            let mut s = Vec::new();
            let fmt = bun_fmt::HostFormatter { is_https: true, host, port: None };
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

    let request = bun_core::heap::into_raw(Box::new(WebRequest::init2(
        bun_core::String::clone_utf8(&url),
        Some(headers),
        crate::webcore::body::hive_alloc(crate::webcore::body::Value::Null),
        bun_http_types::Method::Method::CONNECT,
    )));
    // SAFETY: just allocated; `to_js` hands the allocation to the JS wrapper,
    // whose finalizer frees it.
    Some(unsafe { (*request).to_js(global) })
}

impl WebTransportSession {
    fn init(
        global: &JSGlobalObject,
        handler: &WebTransportHandler,
        session: NonNull<WebTransport>,
        data_value: JSValue,
    ) -> *mut WebTransportSession {
        let this = bun_core::heap::into_raw(Box::new(WebTransportSession {
            session: Cell::new(Some(session)),
            this_value: JsCell::new(JsRef::empty()),
            handler: bun_ptr::BackRef::new(handler),
            global: bun_ptr::BackRef::new(global),
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

    /// Ask the `upgrade` handler, if there is one, whether to open a session.
    ///
    /// Split from [`Self::accept`] because refusing means writing a `Response`,
    /// and the machinery for that needs the server this route belongs to.
    /// Nothing is written to `res` here, so the caller still owns it.
    pub(crate) fn decide(
        global: &JSGlobalObject,
        on_upgrade: JSValue,
        req: &mut Request,
    ) -> Decision {
        if !req.is_webtransport() {
            return Decision::Yield;
        }
        if on_upgrade.is_empty_or_undefined_or_null() {
            return Decision::Accept(JSValue::UNDEFINED);
        }
        // A `Request` built the cheap way: `init2` copies the URL and headers
        // and holds no request context, so it carries nothing that dies with
        // the uWS request under it, and a handler that keeps it keeps
        // something valid. The fetch path's `Request` would drag a
        // RequestContext, an abort signal and a body slot along for a CONNECT
        // that has no body — which is the cost this route exists to avoid.
        let request_value = match build_request(global, req) {
            Some(v) => v,
            None => return Decision::Failed,
        };
        let vm = VirtualMachine::get();
        let _loop_guard = vm.enter_event_loop_scope();
        let returned = match on_upgrade.call(global, JSValue::UNDEFINED, &[request_value]) {
            Ok(v) => v,
            Err(e) => {
                let err = global.take_exception(e);
                // Reported, not routed to the server's `error` handler: that
                // one answers requests with a `Response`, and this throw has
                // already decided its answer — the session is refused with a
                // 500. Same treatment a throwing websocket handler gets.
                VirtualMachine::get()
                    .as_mut()
                    .run_error_handler(err, None);
                return Decision::Failed;
            }
        };
        request_value.ensure_still_alive();
        // A `Response` is the refusal; anything else becomes `session.data`.
        // The two cannot be confused — nobody wants a `Response` as their
        // session data — and it keeps one return value doing one job each way
        // rather than a boolean plus an out-parameter.
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
    ) {
        let Some(session) = res.upgrade_webtransport(req, core::ptr::null_mut()) else {
            res.write_status(b"501 Not Implemented");
            res.end(b"", false);
            return;
        };
        // SAFETY: a non-null session from `upgrade_webtransport`.
        let session = unsafe { NonNull::new_unchecked(session) };

        let this = Self::init(global, handler, session, data_value);
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
        // A fresh Uint8Array per datagram. Handing out a view onto the
        // receive buffer would be faster and wrong: the buffer is lsquic's and
        // is reused before the next turn of the event loop, so anything the
        // handler kept would change underneath it.
        let bytes = match crate::server::jsc::ArrayBuffer::create::<
            { crate::server::jsc::JSType::Uint8Array },
        >(global, data)
        {
            Ok(bytes) => bytes,
            // Allocation failure, which has already thrown. Take it here:
            // this frame returns into lsquic's packet processing, and an
            // exception left pending would be found by whichever JS ran next
            // and reported against that instead.
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

    fn dispatch_close(&self, code: u32, reason: &[u8]) {
        let cb = self.handler.get().on_close;
        let global = self.global.get();
        let this_value = self.js_value();
        // The native session dies with its stream, so it is nulled before any
        // user code runs: a `close` handler reaching for `sendDatagram()` gets
        // the closed answer rather than a pointer into a stream on its way out.
        self.session.set(None);

        if let (Some(this_value), false) = (this_value, cb.is_empty_or_undefined_or_null()) {
            let vm = VirtualMachine::get();
            let _loop_guard = vm.enter_event_loop_scope();
            // transfer_to_js, not to_js: `clone_utf8` hands over a +1 that
            // borrowing would never release.
            let mut reason_string = bun_core::String::clone_utf8(reason);
            let reason_js = bun_jsc::StringJsc::transfer_to_js(&mut reason_string, global)
                .unwrap_or(JSValue::UNDEFINED);
            let args = [this_value, JSValue::js_number(code as f64), reason_js];
            if let Err(e) = cb.call(global, JSValue::UNDEFINED, &args) {
                let err = global.take_exception(e);
                report(global, err);
            }
        }

        // Only now release the self-reference. Until the handler has returned,
        // this reference is the wrapper's only root, and dropping it earlier
        // would let a GC inside the handler collect the wrapper — and with it
        // the box `self` points at.
        self.this_value.with_mut(|r| r.downgrade());
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
        // A closed session reports zero rather than throwing. A datagram is
        // allowed not to arrive, and racing the peer's close is exactly the
        // case where an exception would be noise.
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

        let js_string = value.to_js_string(global)?;
        let view = js_string.view(global);
        let slice = view.to_slice();
        let ret = datagram_result_to_js(session.send_datagram(slice.slice()));
        js_string.ensure_still_alive();
        Ok(ret)
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
        // Coerce before touching the session, and refuse anything that is not
        // a number rather than running a `valueOf` whose exception the
        // non-propagating `to_u32` would swallow — leaving it pending for the
        // reason's `toString` to trip over while the session closed as 0.
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
            let js_string = reason_value.to_js_string(global)?;
            let view = js_string.view(global);
            let slice = view.to_slice();
            session.close(code, slice.slice());
            js_string.ensure_still_alive();
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn drain(
        &self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // A closed session has nobody to ask, and the request is advisory, so
        // this is a no-op rather than a throw -- the same answer sendDatagram
        // gives for the same race.
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

    pub(crate) fn finalize(self: Box<Self>) {
        // Not refcounted: the wrapper is the only owner, so releasing the
        // self-reference's handle and dropping the box is the whole of it.
        self.this_value.with_mut(|v| v.finalize());
    }
}

/// `sendDatagram` reports the bytes queued, `0` for a datagram the
/// connection's queue had no room for, and `-1` for one the peer will not
/// accept — the same three-way answer `ws.send()` gives, so a caller can
/// branch on it the same way. The count includes the session's frame prefix,
/// which is what lets an empty payload report success rather than colliding
/// with the `0` that means dropped.
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

/// Registered once per HTTP/3 app. The native session carries the pointer to
/// its `WebTransportSession`, so neither callback needs to know which server
/// it belongs to.
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
    let wt = unsafe { wt.as_mut()? };
    let ud = wt.user_data();
    if ud.is_null() {
        return None;
    }
    // SAFETY: `accept` stored a `*mut WebTransportSession` here, and the JS
    // wrapper keeps it alive until `dispatch_close` releases it.
    Some(unsafe { &*ud.cast::<WebTransportSession>() })
}
