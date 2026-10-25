use core::cell::Cell;
use core::ptr::NonNull;

use bun_core::Utf8Bytes;
use bun_jsc::JsCell;
use bun_jsc::bindgen::{self, Callable, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_uws::{self as uws, AnyWebSocket, WebSocketBehavior};
use bun_uws_sys::web_socket::{WebSocketHandler, WebSocketUpgradeServer, Wrap};
use bun_uws_sys::{Opcode, SendStatus};

use crate::generated_bindgen::server::js_ServerWebSocket as js;
use crate::server::WebSocketServerHandler;
use crate::server::jsc::{
    self, AbortSignal, ArrayBuffer, CommonAbortReason, JSGlobalObject, JSType, JSValue, JsError,
    JsRef, JsResult,
};
use crate::server::web_socket_server_context::HandlerFlags;
use crate::webcore::{Blob, BlobExt};

bun_output::declare_scope!(WebSocketServer, visible);

/// The JS type that `ws.binaryType` selects for binary messages, pings and pongs.
use crate::generated_bindgen::server::BinaryType;

// Stored inline in its JS wrapper, which `this_value` keeps alive while uWS has the address as the socket's user data.
//
// Every uws/JS callback into this socket can re-enter
// — `on_open` → `ws.cork(JS)` → `ws.close()` → `on_close` mutates `flags` /
// `this_value` of the SAME socket. A `&mut Self` receiver would alias under
// Stacked Borrows. Receivers therefore take `&self`; per-field interior
// mutability (`Cell` for `Copy` flags/signal, `JsCell` for the non-`Copy`
// `JsRef`) carries the writes.
pub(crate) struct ServerWebSocket {
    // Lives in `ServerConfig.websocket` for the server's lifetime.
    handler: bun_ptr::BackRef<WebSocketServerHandler>,
    this_value: JsCell<JsRef>,
    flags: Cell<Flags>,
    // `AbortSignal` is an opaque C++ type
    // with intrusive WebCore ref-counting (ref/unref) — never `Arc`. The init
    // caller transfers a +1 ref; `drop`/`on_close` unref it.
    signal: Cell<Option<NonNull<AbortSignal>>>,
}

// We pack the per-socket data into this struct below:
// ssl:1, closed:1, ws_package:1, binary_type:4, packed_websocket_ptr:57
#[repr(transparent)]
#[derive(Copy, Clone, Default)]
pub(crate) struct Flags(u64);

impl Flags {
    const SSL_BIT: u64 = 1 << 0;
    const CLOSED_BIT: u64 = 1 << 1;
    const WS_PACKAGE_BIT: u64 = 1 << 2;
    const BINARY_TYPE_SHIFT: u32 = 3;
    const BINARY_TYPE_MASK: u64 = 0b1111 << Self::BINARY_TYPE_SHIFT;
    const PTR_SHIFT: u32 = 7;
    const PTR_MASK: u64 = (1u64 << 57) - 1;

    #[inline]
    pub(crate) fn ssl(self) -> bool {
        self.0 & Self::SSL_BIT != 0
    }
    #[inline]
    pub(crate) fn set_ssl(&mut self, v: bool) {
        if v {
            self.0 |= Self::SSL_BIT;
        } else {
            self.0 &= !Self::SSL_BIT;
        }
    }
    #[inline]
    pub(crate) fn closed(self) -> bool {
        self.0 & Self::CLOSED_BIT != 0
    }
    #[inline]
    pub(crate) fn set_closed(&mut self, v: bool) {
        if v {
            self.0 |= Self::CLOSED_BIT;
        } else {
            self.0 &= !Self::CLOSED_BIT;
        }
    }
    /// Set on sockets that belong to the `ws` package ([`WsPackageSocket`]).
    #[inline]
    pub(crate) fn ws_package(self) -> bool {
        self.0 & Self::WS_PACKAGE_BIT != 0
    }
    #[inline]
    pub(crate) fn set_ws_package(&mut self) {
        self.0 |= Self::WS_PACKAGE_BIT;
    }
    #[inline]
    pub(crate) fn binary_type(self) -> BinaryType {
        match ((self.0 & Self::BINARY_TYPE_MASK) >> Self::BINARY_TYPE_SHIFT) as u8 {
            0 => BinaryType::Nodebuffer,
            1 => BinaryType::Arraybuffer,
            2 => BinaryType::Uint8array,
            3 => BinaryType::Blob,
            // Only `set_binary_type` writes this field, so any other value is memory corruption.
            n => unreachable!("invalid BinaryType {n}"),
        }
    }
    #[inline]
    pub(crate) fn set_binary_type(&mut self, v: BinaryType) {
        self.0 = (self.0 & !Self::BINARY_TYPE_MASK)
            | (((v as u8 as u64) << Self::BINARY_TYPE_SHIFT) & Self::BINARY_TYPE_MASK);
    }
    #[inline]
    pub(crate) fn packed_websocket_ptr(self) -> u64 {
        (self.0 >> Self::PTR_SHIFT) & Self::PTR_MASK
    }
    #[inline]
    pub(crate) fn set_packed_websocket_ptr(&mut self, v: u64) {
        self.0 = (self.0 & !(Self::PTR_MASK << Self::PTR_SHIFT))
            | ((v & Self::PTR_MASK) << Self::PTR_SHIFT);
    }

    #[inline]
    fn websocket(self) -> AnyWebSocket {
        // Ensure those other bits are zeroed out
        let ptr = self.packed_websocket_ptr() as usize as *mut uws::RawWebSocket;
        if self.ssl() {
            // SAFETY: packed_websocket_ptr was set from ws.raw() in on_open; non-null while !closed
            AnyWebSocket::Ssl(ptr)
        } else {
            // SAFETY: same as above
            AnyWebSocket::Tcp(ptr)
        }
    }
}

/// RFC 6455 §5.5: control frame payloads are at most 125 bytes.
const MAX_CONTROL_FRAME_PAYLOAD: usize = 125;
/// RFC 6455 §5.5.1: a Close frame's payload is a 2-byte code followed by the reason.
const MAX_CLOSE_REASON: usize = MAX_CONTROL_FRAME_PAYLOAD - 2;

fn throw_control_frame_too_large(global: &JSGlobalObject, len: usize) -> JsError {
    let err = global.create_range_error_instance(format_args!(
        "The data size must not be greater than {} bytes. Received {} bytes.",
        MAX_CONTROL_FRAME_PAYLOAD, len,
    ));
    global.throw_value(err)
}

/// Maps a uWS `SendStatus` to the JS-visible number contract shared by every
/// `ServerWebSocket` send-ish method (Backpressure → -1, Success → byte_len,
/// Dropped → 0) and emits the matching `WebSocketServer` debug log.
///
/// `len` is the **byte** length actually written.
#[inline]
pub(super) fn send_status_to_js(status: SendStatus, len: usize, op: &'static str) -> JSValue {
    match status {
        SendStatus::Backpressure => {
            bun_output::scoped_log!(WebSocketServer, "{}() backpressure ({} bytes)", op, len);
            JSValue::js_number(-1.0)
        }
        SendStatus::Success => {
            bun_output::scoped_log!(WebSocketServer, "{}() success ({} bytes)", op, len);
            JSValue::js_number(len as f64)
        }
        SendStatus::Dropped => {
            bun_output::scoped_log!(WebSocketServer, "{}() dropped ({} bytes)", op, len);
            JSValue::js_number(0.0)
        }
    }
}

/// Which message types a send or publish method accepts.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Accept {
    /// BufferSource and Blob are sent as binary. Everything else is stringified, except
    /// `undefined` and `null`, which throw.
    Any,
    /// Like `Any`, but `undefined` and `null` are stringified too. Used by `server.publish()`.
    AnyOrNullish,
    Text,
    Binary,
    /// Ping/pong payload: a string, BufferSource, Blob, or nothing.
    Control,
}

/// A converted message argument. Keeps the JS value that owns the bytes alive.
pub(super) enum Payload<'a> {
    Buffer(ArrayBuffer),
    Bytes {
        bytes: &'a [u8],
        _owner: jsc::EnsureStillAlive,
    },
    Text(jsc::JSStringView<'a>),
}

impl Payload<'_> {
    #[inline]
    pub(super) fn opcode(&self) -> Opcode {
        match self {
            Payload::Text(_) => Opcode::Text,
            Payload::Buffer(_) | Payload::Bytes { .. } => Opcode::Binary,
        }
    }

    #[inline]
    pub(super) fn bytes(&self) -> Utf8Bytes<'_> {
        match self {
            Payload::Buffer(buffer) => Utf8Bytes::Borrowed(buffer.slice()),
            Payload::Bytes { bytes, .. } => Utf8Bytes::Borrowed(bytes),
            Payload::Text(view) => view.to_utf8(),
        }
    }
}

/// Converting an argument can run user JS that closes the socket or stops the
/// server, so every method converts all of its arguments before it reads native state.
#[inline]
pub(super) fn payload_from_js<'a>(
    global_this: &'a JSGlobalObject,
    fn_name: &'static str,
    value: JSValue,
    accept: Accept,
) -> JsResult<Payload<'a>> {
    if value.is_undefined_or_null() {
        match accept {
            Accept::Control => {
                return Ok(Payload::Bytes {
                    bytes: &[],
                    _owner: jsc::EnsureStillAlive(value),
                });
            }
            Accept::Any => {
                return Err(
                    global_this.throw(format_args!("{fn_name} requires a non-empty message"))
                );
            }
            Accept::AnyOrNullish | Accept::Text | Accept::Binary => {}
        }
    }
    if accept != Accept::Text {
        if let Some(buffer) = value.as_array_buffer(global_this) {
            return Ok(Payload::Buffer(buffer));
        }
        if let Some(blob) = value.as_class_ref::<Blob>() {
            let Some(bytes) = blob.in_memory_view() else {
                return Err(global_this.throw(format_args!(
                    "{fn_name} cannot send a file- or S3-backed Blob synchronously; await blob.bytes() first"
                )));
            };
            return Ok(Payload::Bytes {
                bytes,
                _owner: jsc::EnsureStillAlive(value),
            });
        }
    }
    let expected = match accept {
        Accept::Any | Accept::AnyOrNullish => None,
        Accept::Text | Accept::Control if value.is_string() => None,
        Accept::Text => Some("a string"),
        Accept::Binary => Some("a Blob or BufferSource"),
        Accept::Control => Some("a string, Blob, or BufferSource"),
    };
    if let Some(expected) = expected {
        return Err(global_this.throw(format_args!("{fn_name} expects {expected}")));
    }
    Ok(Payload::Text(value.to_js_string_view(global_this)?))
}

/// Topics must be non-empty strings. Exception: `publishText("")` returns 0 instead of throwing,
/// for backwards compatibility.
#[inline]
fn topic_from_js<'a>(
    global_this: &'a JSGlobalObject,
    fn_name: &'static str,
    value: JSValue,
    empty: EmptyTopic,
) -> JsResult<jsc::JSStringView<'a>> {
    if !value.is_string() {
        return Err(global_this.throw_invalid_argument_type_value(b"topic", b"string", value));
    }
    let topic = value.to_js_string_view(global_this)?;
    if topic.is_empty() && matches!(empty, EmptyTopic::Reject) {
        return Err(global_this.throw(format_args!("{fn_name} requires a non-empty topic name")));
    }
    Ok(topic)
}

#[derive(Clone, Copy)]
enum EmptyTopic {
    Reject,
    Allow,
}

#[inline]
fn compress_from_js(
    global_this: &JSGlobalObject,
    fn_name: &'static str,
    value: JSValue,
) -> JsResult<bool> {
    if value.is_undefined() {
        return Ok(false);
    }
    if !value.is_boolean() {
        return Err(global_this.throw(format_args!("{fn_name} expects compress to be a boolean")));
    }
    Ok(value.to_boolean())
}

/// Releases the ref and the pending-activity count that `init`'s caller transferred.
fn release_signal(signal: Option<NonNull<AbortSignal>>) {
    if let Some(signal) = signal {
        super::request_context::signal_release(signal);
    }
}

/// Runs when `on_close` returns.
struct OnCloseCleanup<'a> {
    signal: Option<NonNull<AbortSignal>>,
    downgrade: Option<&'a JsCell<JsRef>>,
}

impl Drop for OnCloseCleanup<'_> {
    fn drop(&mut self) {
        release_signal(self.signal);
        if let Some(this_value) = self.downgrade {
            // The `server` traced edge set in `init` must outlive this
            // wrapper: `self.handler` points into the server's allocation
            // and publish()/send() still work on closed sockets (#36788).
            this_value.with_mut(|v| v.downgrade());
        }
    }
}

impl ServerWebSocket {
    #[inline]
    fn websocket(&self) -> AnyWebSocket {
        self.flags.get().websocket()
    }

    /// `None` once closed.
    pub(crate) fn us_socket(&self) -> Option<*mut bun_uws::us_socket_t> {
        (!self.is_closed()).then(|| self.websocket().us_socket())
    }

    /// R-2 helper: read-modify-write the packed `Cell<Flags>` through `&self`.
    /// `Flags` is a `Copy` `u64` so the load/store pair is the same codegen as
    /// the old `&mut self` field write.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    /// The handler lives in `ServerConfig.websocket` for the server's lifetime;
    /// non-null while any `ServerWebSocket` exists. All `ServerWebSocket` state
    /// is interior-mutable (`Cell`/`JsCell`), so the borrow tied to `&self`
    /// does not conflict with flag mutation.
    #[inline]
    fn handler(&self) -> &WebSocketServerHandler {
        self.handler.get()
    }

    /// A websocket event is dispatched inside the context of the script that gave the handlers:
    /// what a handler throws, and what the socket reports with no `error` handler, is that context's.
    #[inline]
    fn enter_handlers_context(&self) -> bun_jsc::virtual_machine::ContextScope<'_> {
        self.handler().vm().enter_context(self.handler().context)
    }

    /// `send` / `sendText` / `sendBinary`
    #[inline]
    fn send_message(
        &self,
        global_this: &JSGlobalObject,
        message_value: JSValue,
        compress_value: JSValue,
        fn_name: &'static str,
        accept: Accept,
    ) -> JsResult<JSValue> {
        // A closed socket ignores the call, whatever the arguments are. A `close` handler that
        // passes `undefined` here must not throw.
        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }
        let compress = compress_from_js(global_this, fn_name, compress_value)?;
        let payload = payload_from_js(global_this, fn_name, message_value, accept)?;
        let bytes = payload.bytes();

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "{}() closed", fn_name);
            return Ok(JSValue::js_number(0.0));
        }
        Ok(send_status_to_js(
            self.websocket()
                .send(bytes.slice(), payload.opcode(), compress, true),
            bytes.len(),
            fn_name,
        ))
    }

    /// Backs the `ws` package's `sendWebSocketFrame`. The caller picks the opcode (0 is a
    /// continuation frame) and `fin`.
    pub(crate) fn send_frame(
        &self,
        global_this: &JSGlobalObject,
        data: JSValue,
        opcode: Opcode,
        fin: bool,
        compress: bool,
    ) -> JsResult<JSValue> {
        let payload = payload_from_js(global_this, "send", data, Accept::Any)?;
        let bytes = payload.bytes();

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }
        Ok(send_status_to_js(
            self.websocket().send(bytes.slice(), opcode, compress, fin),
            bytes.len(),
            "send",
        ))
    }

    /// `ping` / `pong`
    #[inline]
    fn send_control(
        &self,
        global_this: &JSGlobalObject,
        data: JSValue,
        fn_name: &'static str,
        opcode: Opcode,
    ) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }
        let payload = payload_from_js(global_this, fn_name, data, Accept::Control)?;
        let bytes = payload.bytes();
        if bytes.len() > MAX_CONTROL_FRAME_PAYLOAD {
            return Err(throw_control_frame_too_large(global_this, bytes.len()));
        }

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }
        Ok(send_status_to_js(
            self.websocket().send(bytes.slice(), opcode, false, true),
            bytes.len(),
            fn_name,
        ))
    }

    /// `publish` / `publishText` / `publishBinary`. Publishes through the app if the socket
    /// is closed or the server set `publishToSelf`.
    #[inline]
    fn publish_message(
        &self,
        global_this: &JSGlobalObject,
        topic_value: JSValue,
        message_value: JSValue,
        compress_value: JSValue,
        fn_name: &'static str,
        accept: Accept,
    ) -> JsResult<JSValue> {
        let empty = if matches!(accept, Accept::Text) {
            EmptyTopic::Allow
        } else {
            EmptyTopic::Reject
        };
        let topic_view = topic_from_js(global_this, fn_name, topic_value, empty)?;
        let topic = topic_view.to_utf8();
        let compress = compress_from_js(global_this, fn_name, compress_value)?;
        let payload = payload_from_js(global_this, fn_name, message_value, accept)?;
        let bytes = payload.bytes();
        if topic_view.is_empty() {
            return Ok(JSValue::js_number(0.0));
        }

        let handler = self.handler();
        let Some(app) = handler.app else {
            bun_output::scoped_log!(WebSocketServer, "{}() closed", fn_name);
            return Ok(JSValue::js_number(0.0));
        };
        let status = if !handler.flags.contains(HandlerFlags::PUBLISH_TO_SELF) && !self.is_closed()
        {
            self.websocket()
                .publish(topic.slice(), bytes.slice(), payload.opcode(), compress)
        } else {
            AnyWebSocket::publish_with_options(
                handler.flags.contains(HandlerFlags::SSL),
                app,
                topic.slice(),
                bytes.slice(),
                payload.opcode(),
                compress,
            )
        };
        Ok(send_status_to_js(status, bytes.len(), fn_name))
    }

    /// `subscribe` / `unsubscribe` / `isSubscribed`
    #[inline]
    fn topic_dispatch(
        &self,
        global_this: &JSGlobalObject,
        topic: JSValue,
        fn_name: &'static str,
        op: impl FnOnce(AnyWebSocket, &[u8]) -> bool,
    ) -> JsResult<bool> {
        if self.is_closed() {
            return Ok(false);
        }
        let topic = topic_from_js(global_this, fn_name, topic, EmptyTopic::Reject)?;

        if self.is_closed() {
            return Ok(false);
        }
        Ok(op(self.websocket(), topic.to_utf8().slice()))
    }

    /// Initialize a ServerWebSocket with the given handler, data value, and signal.
    /// The signal will not be ref'd inside the ServerWebSocket init function, but will unref itself when the ServerWebSocket is destroyed.
    pub(crate) fn init(
        handler: &WebSocketServerHandler,
        data_value: JSValue,
        signal: Option<NonNull<AbortSignal>>,
    ) -> *mut ServerWebSocket {
        let global_object = handler.global_object();
        let this_value = ServerWebSocket {
            handler: bun_ptr::BackRef::new(handler),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::default()),
            signal: Cell::new(signal),
        }
        .into_js_wrapper(global_object);
        let js_value = this_value.to_js();
        let this = this_value.payload_ptr().as_ptr();
        // SAFETY: the struct is stored inline in the wrapper, which `this_value` keeps alive.
        let this_ref = unsafe { &*this };
        this_ref
            .this_value
            .set(JsRef::init_strong(js_value, global_object));
        js::data_set_cached(js_value, global_object, data_value);
        // Both callers bail out when `handler.server.is_none()`,
        // so this is normally `Some`; keep the `and_then` as
        // defense-in-depth (option getters between that guard and here can
        // re-enter JS and `stop(true)`, and `js_value_for_dispatch` returns
        // `None` once the wrapper is `Finalized` or the VM's script gate has
        // closed).
        if let Some(server_js) = handler.server.and_then(|s| s.js_value_for_dispatch()) {
            js::server_set_cached(js_value, global_object, server_js);
        }
        this
    }

    /// `init` for a `ws` package socket. `handler` holds the package's callbacks, which are
    /// called with `websocket` as `this`.
    pub(crate) fn init_for_ws_package(
        handler: &WebSocketServerHandler,
        websocket: JSValue,
    ) -> *mut ServerWebSocket {
        let this = Self::init(handler, websocket, None);
        // SAFETY: `init` just made it. See the SAFETY comments there.
        unsafe { &*this }.update_flags(Flags::set_ws_package);
        this
    }

    /// The JS wrapper. `None` once the socket has closed and the wrapper was collected.
    pub(crate) fn js_value(&self) -> Option<JSValue> {
        self.this_value.get().try_get()
    }

    /// Undoes `init` when uWS rejects the upgrade. Neither `on_open` nor `on_close` runs for
    /// such a socket.
    pub(crate) fn discard_unopened(&self) {
        self.update_flags(|f| f.set_closed(true));
        release_signal(self.signal.take());
        self.this_value.with_mut(|v| v.downgrade());
    }

    pub(crate) fn memory_cost(&self) -> usize {
        if self.flags.get().closed() {
            return 0;
        }
        self.websocket().memory_cost()
    }

    /// Stores the uWS socket pointer and increments the server's open WebSocket count.
    fn attach(&self, ws: AnyWebSocket) {
        self.update_flags(|f| {
            f.set_packed_websocket_ptr(ws.raw() as usize as u64);
            f.set_closed(false);
            f.set_ssl(matches!(ws, AnyWebSocket::Ssl(_)));
        });
        // Live-socket accounting lives on the server (`Cell`), reached
        // through the type-erased backref so the shared `&Handler` suffices.
        if let Some(server) = self.handler().server {
            server.on_websocket_opened();
        }
    }

    /// R-2 (noalias re-entrancy): `&self`, NOT `&mut self`. `ws.cork(...)`
    /// re-enters JS which can `ws.close()` / `ws.send()` on this same socket
    /// via the JS wrapper, flipping `flags.closed`. All state lives
    /// behind `Cell`/`JsCell`, so the re-entrant frame's writes are visible
    /// here without aliasing a `noalias` borrow. `handler`/`vm`/`global_object`
    /// are detached `&'a` borrows of the server config (a separate allocation),
    /// so they may legally span the call.
    pub(crate) fn on_open(&self, ws: AnyWebSocket) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "OnOpen");
        self.attach(ws);

        let handler = self.handler();
        let vm = handler.vm();
        let server = handler.server;
        let global_object = handler.global_object();
        let on_open_handler = handler.on_open;
        let on_error = handler.on_error;

        if on_open_handler.is_empty_or_undefined_or_null() {
            return Ok(());
        }

        let this_value = self.js_value().unwrap_or(JSValue::UNDEFINED);
        let args = [this_value];

        let _loop_guard = vm.enter_event_loop_scope();

        if let Err(e) = call_corked(
            ws,
            global_object,
            on_open_handler,
            JSValue::UNDEFINED,
            &args,
        ) {
            let err_value = global_object.take_error(e);
            bun_output::scoped_log!(WebSocketServer, "onOpen exception");

            let mut closed_here = false;
            if !self.flags.get().closed() {
                self.update_flags(|f| f.set_closed(true));
                // we un-gracefully close the connection if there was an exception
                // we don't want any event handlers to fire after this for anything other than error()
                // https://github.com/oven-sh/bun/issues/1480
                // (`close()` re-enters `on_close`, which skips its own
                // accounting because the closed flag is already set.)
                self.websocket().close();
                closed_here = true;
                this_value.unprotect();
            }

            let handled =
                handler.run_error_callback(on_error, global_object, this_value, err_value);
            if closed_here {
                if let Some(server) = server {
                    // May run the idle pass; no `&Handler` borrow is live here.
                    server.on_websocket_closed();
                }
            }
            return handled;
        }
        Ok(())
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub(crate) fn on_message(
        &self,
        ws: AnyWebSocket,
        message: &[u8],
        opcode: Opcode,
    ) -> JsResult<()> {
        bun_output::scoped_log!(
            WebSocketServer,
            "onMessage({}): {}",
            opcode.0,
            bstr::BStr::new(message)
        );
        let on_message_handler = self.handler().on_message;
        let on_error = self.handler().on_error;
        if on_message_handler.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        let global_object = self.handler().global_object();
        // This is the start of a task.
        let vm = self.handler().vm();

        let _loop_guard = vm.enter_event_loop_scope();

        let data = match opcode {
            Opcode::Text => bun_string_jsc::create_utf8_for_js(global_object, message),
            Opcode::Binary => self.binary_to_js(global_object, message),
            _ => unreachable!(),
        };
        let data = match data {
            Ok(data) => data,
            Err(e) => {
                // Copying the message for the handler failed. Close the connection instead of
                // silently dropping a message.
                let err_value = global_object.take_error(e);
                if err_value.is_termination_exception() {
                    return Err(e);
                }
                // Without an `error` handler, only the 1011 close reports the failure. An uncaught
                // exception would exit the process.
                let reported = if on_error.is_empty_or_undefined_or_null() {
                    Ok(())
                } else {
                    self.handler().run_error_callback(
                        on_error,
                        global_object,
                        self.js_value().unwrap_or(JSValue::UNDEFINED),
                        err_value,
                    )
                };
                if !self.is_closed() {
                    ws.fail_out_of_memory();
                }
                return reported;
            }
        };
        let arguments = [self.js_value().unwrap_or(JSValue::UNDEFINED), data];

        let result = match call_corked(
            ws,
            global_object,
            on_message_handler,
            JSValue::UNDEFINED,
            &arguments,
        ) {
            Ok(result) => result,
            Err(e) => {
                let err_value = global_object.take_error(e);
                return self.handler().run_error_callback(
                    on_error,
                    global_object,
                    arguments[0],
                    err_value,
                );
            }
        };

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::js_promise::Status::Rejected => {
                    // Value discarded; the side
                    // effect (JSC__JSPromise__result) conditionally sets
                    // `isHandledFlag` so this doesn't surface as an
                    // unhandledRejection.
                    let _ = promise.result(global_object.vm());
                    return Ok(());
                }
                _ => {}
            }
        }
        Ok(())
    }

    #[inline]
    pub(crate) fn is_closed(&self) -> bool {
        self.flags.get().closed()
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub(crate) fn on_drain(&self, _ws: AnyWebSocket) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "onDrain");
        let handler = self.handler();
        let vm = handler.vm();
        if self.is_closed() {
            return Ok(());
        }

        let on_drain = handler.on_drain;
        let on_error = handler.on_error;
        if !on_drain.is_empty() {
            let global_object = handler.global_object();

            let args = [self.js_value().unwrap_or(JSValue::UNDEFINED)];
            let _loop_guard = vm.enter_event_loop_scope();
            if let Err(e) = call_corked(
                self.websocket(),
                global_object,
                on_drain,
                JSValue::UNDEFINED,
                &args,
            ) {
                let err_value = global_object.take_error(e);
                handler.run_error_callback(on_error, global_object, args[0], err_value)?;
            }
        }
        Ok(())
    }

    fn binary_to_js(&self, global_this: &JSGlobalObject, data: &[u8]) -> JsResult<JSValue> {
        match self.flags.get().binary_type() {
            BinaryType::Nodebuffer => ArrayBuffer::create_buffer(global_this, data),
            BinaryType::Uint8array => {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, data)
            }
            BinaryType::Arraybuffer => {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, data)
            }
            BinaryType::Blob => {
                let mut bytes = Vec::new();
                if bytes.try_reserve_exact(data.len()).is_err() {
                    return Err(bun_jsc::JsError::OutOfMemory);
                }
                bytes.extend_from_slice(data);
                let blob = Blob::new(Blob::init(bytes, global_this));
                // SAFETY: `blob` is the live allocation `Blob::new` just made. `BlobExt::to_js`
                // reports the payload size to the GC, which the by-value `JsClass::to_js` skips.
                Ok(unsafe { BlobExt::to_js(&*blob, global_this) })
            }
        }
    }

    pub(crate) fn on_ping(&self, _ws: AnyWebSocket, data: &[u8]) -> JsResult<()> {
        self.on_ping_or_pong("onPing", self.handler().on_ping, data)
    }

    pub(crate) fn on_pong(&self, _ws: AnyWebSocket, data: &[u8]) -> JsResult<()> {
        self.on_ping_or_pong("onPong", self.handler().on_pong, data)
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    fn on_ping_or_pong(&self, name: &'static str, cb: JSValue, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "{}: {}", name, bstr::BStr::new(data));
        let handler = self.handler();
        let on_error = handler.on_error;
        if cb.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        let global_this = handler.global_object();

        // This is the start of a task.
        let _loop_guard = handler.vm().enter_event_loop_scope();

        let data = self.binary_to_js(global_this, data)?;
        let args = [self.js_value().unwrap_or(JSValue::UNDEFINED), data];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_error(e);
            bun_output::scoped_log!(WebSocketServer, "{} error", name);
            handler.run_error_callback(on_error, global_this, args[0], err)?;
        }
        Ok(())
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    /// Re-entrant `ws.close()` from the close handler routes through the same
    /// `Cell<Flags>` / `JsCell<JsRef>`, so no `noalias` view is invalidated.
    pub(crate) fn on_close(&self, _ws: AnyWebSocket, code: i32, message: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "onClose");
        // TODO: Can this called inside finalize?
        let handler = self.handler();
        // Copy the erased server handle out now: the guard below runs after
        // every `handler` borrow has expired, and `on_websocket_closed` may
        // form `&mut NewServer` (which owns the handler storage) to run the
        // idle pass when this was the last live socket.
        let server = handler.server;
        let was_closed = self.is_closed();
        self.update_flags(|f| f.set_closed(true));
        // Whoever set the closed flag owns the decrement; close()/terminate()
        // and on_open's error path each decrement themselves when they flip it.
        scopeguard::defer! {
            if !was_closed {
                if let Some(server) = server {
                    server.on_websocket_closed();
                }
            }
        }
        let signal = self.signal.take();

        // Downgrade + signal
        // cleanup runs at fn exit. `this_value` is not mutated between here and
        // the deferred `downgrade()`, so hoisting these reads is sound.
        let was_not_empty = self.this_value.get().is_not_empty();
        let cached_this = self.js_value().unwrap_or(JSValue::UNDEFINED);
        let _cleanup = OnCloseCleanup {
            signal,
            downgrade: was_not_empty.then_some(&self.this_value),
        };

        let vm = handler.vm();

        // on_open's error branch closes the socket, landing here nested with
        // the termination from its handler still pending: it belongs to that
        // frame, so this dispatch neither enters JS over it nor claims it.
        if handler.global_object().has_exception() {
            return Ok(());
        }

        // Copy to a stack local before `sig.signal()` re-enters JS: a GC
        // between the test and the `.call(...)` could otherwise collect it.
        let on_close_handler = handler.on_close;
        let on_error = handler.on_error;
        if !on_close_handler.is_empty_or_undefined_or_null() {
            let global_object = handler.global_object();

            let _loop_guard = vm.enter_event_loop_scope();

            if let Some(sig) = signal {
                // `sig` is held alive by the +1 ref released in `_cleanup`;
                // BackRef invariant (pointee outlives the temporary) holds.
                let sig = bun_ptr::BackRef::from(sig);
                if !sig.aborted() {
                    sig.signal(handler.global_object(), CommonAbortReason::ConnectionClosed);
                }
            }

            let message_js = match bun_string_jsc::create_utf8_for_js(global_object, message) {
                Ok(v) => v,
                Err(e) => {
                    let err = global_object.take_error(e);
                    bun_output::scoped_log!(
                        WebSocketServer,
                        "onClose error (message) {}",
                        was_not_empty
                    );
                    return handler.run_error_callback(on_error, global_object, cached_this, err);
                }
            };

            let call_args = [cached_this, JSValue::js_number(code as f64), message_js];
            if let Err(e) = on_close_handler.call(global_object, JSValue::UNDEFINED, &call_args) {
                let err = global_object.take_error(e);
                bun_output::scoped_log!(WebSocketServer, "onClose error {}", was_not_empty);
                return handler.run_error_callback(on_error, global_object, cached_this, err);
            }
        } else if let Some(sig) = signal {
            let _loop_guard = vm.enter_event_loop_scope();

            // `sig` is held alive by the +1 ref released in `_cleanup`;
            // BackRef invariant (pointee outlives the temporary) holds.
            let sig = bun_ptr::BackRef::from(sig);
            if !sig.aborted() {
                sig.signal(handler.global_object(), CommonAbortReason::ConnectionClosed);
            }
        }
        Ok(())
    }

    pub(crate) fn behavior<ServerType, const SSL: bool>(
        opts: &WebSocketBehavior,
    ) -> WebSocketBehavior
    where
        ServerType: WebSocketUpgradeServer<SSL>,
    {
        Wrap::<ServerType, Self, SSL>::apply(opts)
    }

    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, Self> {
        Err(heap.error(format_args!("Cannot construct ServerWebSocket")))
    }

    pub(crate) fn publish(
        &self,
        cx: &mut JsScope<'_>,
        topic: JsLocal<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.publish_message(
            cx.global(),
            topic.to_js(),
            data.to_js(),
            compress.to_js(),
            "publish",
            Accept::Any,
        )
    }

    pub(crate) fn publish_text(
        &self,
        cx: &mut JsScope<'_>,
        topic: JsLocal<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.publish_message(
            cx.global(),
            topic.to_js(),
            data.to_js(),
            compress.to_js(),
            "publishText",
            Accept::Text,
        )
    }

    pub(crate) fn publish_binary(
        &self,
        cx: &mut JsScope<'_>,
        topic: JsLocal<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.publish_message(
            cx.global(),
            topic.to_js(),
            data.to_js(),
            compress.to_js(),
            "publishBinary",
            Accept::Binary,
        )
    }

    pub(crate) fn cork(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_, Callable>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let this_value = this_value.to_js();
        let callback = callback.to_js();

        if self.is_closed() {
            return callback.call(global_this, this_value, &[this_value]);
        }
        call_corked(
            self.websocket(),
            global_this,
            callback,
            this_value,
            &[this_value],
        )
    }

    pub(crate) fn send(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.send_message(
            cx.global(),
            data.to_js(),
            compress.to_js(),
            "send",
            Accept::Any,
        )
    }

    pub(crate) fn send_text(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.send_message(
            cx.global(),
            data.to_js(),
            compress.to_js(),
            "sendText",
            Accept::Text,
        )
    }

    pub(crate) fn send_binary(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        compress: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        self.send_message(
            cx.global(),
            data.to_js(),
            compress.to_js(),
            "sendBinary",
            Accept::Binary,
        )
    }

    pub(crate) fn ping(&self, cx: &mut JsScope<'_>, data: JsLocal<'_>) -> JsResult<JSValue> {
        self.send_control(cx.global(), data.to_js(), "ping", Opcode::Ping)
    }

    pub(crate) fn pong(&self, cx: &mut JsScope<'_>, data: JsLocal<'_>) -> JsResult<JSValue> {
        self.send_control(cx.global(), data.to_js(), "pong", Opcode::Pong)
    }

    pub(crate) fn get_ready_state(&self) -> i32 {
        bun_output::scoped_log!(WebSocketServer, "getReadyState()");

        if self.is_closed() {
            return 3;
        }

        1
    }

    // R-2: `&self` — `websocket().end()` synchronously dispatches `on_close`
    // on this same socket; a `&mut self` here would alias.
    pub(crate) fn close(
        &self,
        cx: &mut JsScope<'_>,
        code: JsLocal<'_>,
        reason: JsLocal<'_>,
    ) -> JsResult<()> {
        let global_this = cx.global();
        let (code, reason) = (code.to_js(), reason.to_js());
        bun_output::scoped_log!(WebSocketServer, "close()");

        if self.is_closed() {
            return Ok(());
        }

        let code: i32 = if code.is_undefined() {
            1000
        } else if code.is_number() {
            code.coerce_to_i32(global_this)?
        } else {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "close requires a numeric code or undefined"
            )));
        };
        let reason: Utf8Bytes = if reason.is_undefined() {
            Utf8Bytes::EMPTY
        } else {
            reason.to_utf8(global_this)?
        };
        let reason = bun_core::strings::truncate_to_char_boundary(reason.slice(), MAX_CLOSE_REASON);

        if self.is_closed() {
            return Ok(());
        }

        if self.flags.get().ws_package() {
            // Only send the Close frame. The socket stays open until `on_close`.
            self.websocket().end(code, reason);
            return Ok(());
        }

        // Copy the server backref BEFORE end(): on_close re-enters and the
        // user's close handler may call stop(true), which clears handler.server.
        let server = self.handler().server;
        self.update_flags(|f| f.set_closed(true));
        self.websocket().end(code, reason);
        // on_close re-entered with was_closed=true so it skipped the
        // accounting; balance the count here.
        if let Some(server) = server {
            server.on_websocket_closed();
        }
        Ok(())
    }

    // R-2: `&self` — `websocket().close()` synchronously dispatches `on_close`.
    pub(crate) fn terminate(&self, _: &mut JsScope<'_>) {
        bun_output::scoped_log!(WebSocketServer, "terminate()");

        if self.is_closed() {
            return;
        }

        // Copy the server backref BEFORE close(): on_close re-enters and the
        // user's close handler may call stop(true), which clears handler.server.
        let server = self.handler().server;
        self.update_flags(|f| f.set_closed(true));
        self.websocket().close();
        // on_close re-entered with was_closed=true so it skipped the
        // accounting; balance the count here.
        if let Some(server) = server {
            server.on_websocket_closed();
        }
    }

    pub(crate) fn get_binary_type(&self) -> BinaryType {
        bun_output::scoped_log!(WebSocketServer, "getBinaryType()");

        self.flags.get().binary_type()
    }

    pub(crate) fn set_binary_type(&self, value: BinaryType) {
        bun_output::scoped_log!(WebSocketServer, "setBinaryType()");

        self.update_flags(|f| f.set_binary_type(value));
    }

    pub(crate) fn get_buffered_amount(&self) -> usize {
        bun_output::scoped_log!(WebSocketServer, "getBufferedAmount()");

        if self.is_closed() {
            return 0;
        }

        self.websocket().get_buffered_amount()
    }

    pub(crate) fn subscribe(&self, cx: &mut JsScope<'_>, topic: JsLocal<'_>) -> JsResult<bool> {
        self.topic_dispatch(
            cx.global(),
            topic.to_js(),
            "subscribe",
            AnyWebSocket::subscribe,
        )
    }

    pub(crate) fn unsubscribe(&self, cx: &mut JsScope<'_>, topic: JsLocal<'_>) -> JsResult<bool> {
        self.topic_dispatch(
            cx.global(),
            topic.to_js(),
            "unsubscribe",
            AnyWebSocket::unsubscribe,
        )
    }

    pub(crate) fn is_subscribed(&self, cx: &mut JsScope<'_>, topic: JsLocal<'_>) -> JsResult<bool> {
        self.topic_dispatch(
            cx.global(),
            topic.to_js(),
            "isSubscribed",
            AnyWebSocket::is_subscribed,
        )
    }

    pub(crate) fn get_subscriptions(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        if self.is_closed() {
            return JSValue::create_empty_array(global_this, 0);
        }

        // Get the JSValue directly from C++
        Ok(
            crate::socket::uws_jsc::any_web_socket_get_topics_as_js_array(
                self.websocket(),
                global_this,
            ),
        )
    }

    pub(crate) fn pause(&self) {
        if !self.is_closed() {
            self.websocket().pause();
        }
    }

    pub(crate) fn resume(&self) {
        if !self.is_closed() {
            self.websocket().resume();
        }
    }

    pub(crate) fn get_is_paused(&self) -> bool {
        !self.is_closed() && self.websocket().is_paused()
    }

    pub(crate) fn get_remote_address(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let address_bytes = self.websocket().get_remote_address(&mut buf);
        // `format_ip` strips trailing `:port` and `[..]`. Use `SocketAddr{V4,V6}` so
        // `format_ip`'s strip logic sees the expected `addr:port` / `[addr]:port`
        // shape — passing a bare `IpAddr` would corrupt IPv6 (no brackets/port,
        // so the rfind(':') strip eats the last hextet).
        let address: std::net::SocketAddr = match address_bytes.len() {
            4 => std::net::SocketAddrV4::new(
                std::net::Ipv4Addr::from(<[u8; 4]>::try_from(&address_bytes[0..4]).unwrap()),
                0,
            )
            .into(),
            16 => std::net::SocketAddrV6::new(
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(&address_bytes[0..16]).unwrap()),
                0,
                0,
                0,
            )
            .into(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        let text = bun_core::fmt::format_ip(&address, &mut text_buf).expect("unreachable");
        bun_string_jsc::create_utf8_for_js(cx.global(), text)
    }
}

impl Drop for ServerWebSocket {
    fn drop(&mut self) {
        bun_output::scoped_log!(WebSocketServer, "finalize");
        release_signal(self.signal.take());
    }
}

// Delegate straight to the inherent methods above.
impl WebSocketHandler for ServerWebSocket {
    // R-2: trait keeps `*mut Self` (FFI userdata round-trip needs raw write
    // provenance); the single `&*this` reborrow here is the ONE audited unsafe
    // boundary. Inherent `on_*` take `&self`, so the re-entrant JS dispatch
    // never stacks a `noalias` `&mut ServerWebSocket`. These are the uWS
    // callbacks' landing frames: what a handler left pending is folded here.
    #[inline(always)]
    unsafe fn on_open(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract — `this` is the live user-data slot.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_open(ws));
    }
    #[inline(always)]
    unsafe fn on_message(this: *mut Self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        // SAFETY: per trait contract.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_message(ws, message, opcode));
    }
    #[inline(always)]
    unsafe fn on_drain(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_drain(ws));
    }
    #[inline(always)]
    unsafe fn on_ping(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_ping(ws, message));
    }
    #[inline(always)]
    unsafe fn on_pong(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_pong(ws, message));
    }
    #[inline(always)]
    unsafe fn on_close(this: *mut Self, ws: AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: per trait contract.
        let this = unsafe { &*this };
        let _context = this.enter_handlers_context();
        crate::dispatch::fold(this.on_close(ws, code, message));
    }
}

/// uWS callbacks for a `ws` package socket. Handlers are called with the `data` value (the
/// package's WebSocket) as `this`, and payloads are Buffers. There's no `open` handler because
/// the upgrade call returns the socket.
#[repr(transparent)]
pub(crate) struct WsPackageSocket(ServerWebSocket);

impl WsPackageSocket {
    pub(crate) fn behavior<const SSL: bool>(
        max_payload_length: u32,
        auto_pong: bool,
        skip_utf8_validation: bool,
        compression: bool,
    ) -> WebSocketBehavior {
        Wrap::<(), Self, SSL>::ws_package(
            max_payload_length,
            auto_pong,
            skip_utf8_validation,
            compression,
        )
    }

    /// Anything `callback` throws becomes an uncaught exception.
    fn call<const N: usize>(
        &self,
        callback: JSValue,
        args: impl FnOnce(&JSGlobalObject) -> JsResult<[JSValue; N]>,
    ) -> JsResult<()> {
        let socket = &self.0;
        let Some(this_value) = socket.js_value() else {
            return Ok(());
        };
        if callback.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        let handler = socket.handler();
        let global_object = handler.global_object();

        // This is the start of a task.
        let _loop_guard = handler.vm().enter_event_loop_scope();

        let args = args(global_object)?;
        let websocket = js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        let result = if socket.is_closed() {
            callback.call(global_object, websocket, &args)
        } else {
            call_corked(
                socket.websocket(),
                global_object,
                callback,
                websocket,
                &args,
            )
        };
        if let Err(e) = result {
            let err = global_object.take_error(e);
            return handler.run_error_callback(JSValue::ZERO, global_object, this_value, err);
        }
        Ok(())
    }

    /// `code` is the peer's close code (1005 for an empty Close frame), 1006 if the connection
    /// ended without a Close frame, or a negated `uWS::WebSocketFailureKind` with details in
    /// `message`.
    fn on_close(&self, code: i32, message: &[u8]) -> JsResult<()> {
        let socket = &self.0;
        let handler = socket.handler();
        // `on_websocket_closed` may run the idle pass, which clears `handler.server`.
        let server = handler.server;
        let was_closed = socket.is_closed();
        socket.update_flags(|f| f.set_closed(true));

        let result = if handler.global_object().has_exception() {
            Ok(())
        } else {
            self.call(handler.on_close, |global| {
                Ok([
                    JSValue::js_number(f64::from(code)),
                    ArrayBuffer::create_buffer(global, message)?,
                ])
            })
        };

        if socket.this_value.get().is_not_empty() {
            socket.this_value.with_mut(|v| v.downgrade());
        }
        // If `terminate()` already set the flag, it does its own accounting.
        if !was_closed && let Some(server) = server {
            server.on_websocket_closed();
        }
        result
    }

    /// Entry point for every uWS callback. Folds any exception the handler left pending.
    ///
    /// Runs in the context of the script that created the server, like every other `http.Server`
    /// connection event. It doesn't use the handlers' own context, because each server has one
    /// set of handlers and they come from the first upgrade.
    ///
    /// # Safety
    /// `this` is the socket's live user-data slot.
    #[inline(always)]
    unsafe fn dispatch(this: *mut Self, callback: impl FnOnce(&Self) -> JsResult<()>) {
        // SAFETY: per this function's contract.
        let this = unsafe { &*this };
        let handler = this.0.handler();
        // `server` is only cleared when the server drains, and an open socket prevents that.
        let _context = handler
            .server
            .map(|server| handler.vm().enter_context(server.context_id()));
        crate::dispatch::fold(callback(this));
    }
}

impl WebSocketHandler for WsPackageSocket {
    #[inline(always)]
    unsafe fn on_open(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract — `this` is the live user-data slot.
        unsafe { &*this }.0.attach(ws);
    }
    #[inline(always)]
    unsafe fn on_message(this: *mut Self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        // SAFETY: per trait contract.
        unsafe {
            Self::dispatch(this, |this| {
                let global = this.0.handler().global_object();
                let buffer = match ArrayBuffer::create_buffer(global, message) {
                    Ok(buffer) => buffer,
                    Err(e) => {
                        // Same as `ServerWebSocket::on_message`. `ws.ts` turns the close into the
                        // socket's 'error' event.
                        if global.take_error(e).is_termination_exception() {
                            return Err(e);
                        }
                        ws.fail_out_of_memory();
                        return Ok(());
                    }
                };
                this.call(this.0.handler().on_message, |_| {
                    Ok([buffer, JSValue::js_boolean(opcode == Opcode::Binary)])
                })
            })
        };
    }
    #[inline(always)]
    unsafe fn on_drain(this: *mut Self, _ws: AnyWebSocket) {
        // SAFETY: per trait contract.
        unsafe {
            Self::dispatch(this, |this| {
                this.call(this.0.handler().on_drain, |_| Ok([]))
            })
        };
    }
    #[inline(always)]
    unsafe fn on_ping(this: *mut Self, _ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe {
            Self::dispatch(this, |this| {
                this.call(this.0.handler().on_ping, |global| {
                    Ok([ArrayBuffer::create_buffer(global, message)?])
                })
            })
        };
    }
    #[inline(always)]
    unsafe fn on_pong(this: *mut Self, _ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe {
            Self::dispatch(this, |this| {
                this.call(this.0.handler().on_pong, |global| {
                    Ok([ArrayBuffer::create_buffer(global, message)?])
                })
            })
        };
    }
    #[inline(always)]
    unsafe fn on_close(this: *mut Self, _ws: AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: per trait contract.
        unsafe { Self::dispatch(this, |this| this.on_close(code, message)) };
    }
}

/// Calls `callback` inside `ws.cork()`, so everything it sends goes out in one write.
#[inline]
fn call_corked(
    ws: AnyWebSocket,
    global_object: &JSGlobalObject,
    callback: JSValue,
    this_value: JSValue,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let mut result = Ok(JSValue::ZERO);
    let mut call = || result = callback.call(global_object, this_value, args);
    ws.cork(&mut call, |call| call());
    result
}
