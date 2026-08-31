use core::cell::Cell;
use core::ffi::c_void;
use core::mem;
use core::ptr::NonNull;

use bun_core::Utf8Bytes;
use bun_jsc::bun_string_jsc;
use bun_jsc::{ComptimeStringMapExt as _, JsCell};
use bun_uws::{self as uws, AnyWebSocket};
use bun_uws_sys::web_socket::WebSocketHandler;
use bun_uws_sys::{Opcode, SendStatus};

use crate::server::WebSocketServerHandler;
use crate::server::jsc::{
    self, AbortSignal, ArrayBuffer, CallFrame, CommonAbortReason, JSGlobalObject, JSType, JSValue,
    JsError, JsRef, JsResult,
};
use crate::server::web_socket_server_context::HandlerFlags;
use crate::webcore::{Blob, BlobExt};

bun_output::declare_scope!(WebSocketServer, visible);

/// The JS type that `ws.binaryType` selects for binary messages, pings and pongs.
#[repr(u8)]
#[derive(Copy, Clone)]
pub(crate) enum BinaryType {
    Buffer = 0,
    ArrayBuffer = 1,
    Uint8Array = 2,
    Blob = 3,
}

bun_core::comptime_string_map! {
    /// The spellings `bun_jsc::BinaryType` accepted for the first three types, plus "blob".
    static BINARY_TYPE_MAP: BinaryType = {
        b"ArrayBuffer" => BinaryType::ArrayBuffer,
        b"Buffer" => BinaryType::Buffer,
        b"Uint8Array" => BinaryType::Uint8Array,
        b"arraybuffer" => BinaryType::ArrayBuffer,
        b"blob" => BinaryType::Blob,
        b"buffer" => BinaryType::Buffer,
        b"nodebuffer" => BinaryType::Buffer,
        b"uint8array" => BinaryType::Uint8Array,
    };
}

// No `'a` on a `.classes.ts` m_ctx payload — the JS wrapper outlives any
// stack frame. The handler lives in `ServerConfig.websocket` for the server's
// lifetime, so a raw back-pointer + SAFETY notes is the runtime shape.
//
// R-2: every uws/JS callback into this socket can re-enter
// — `on_open` → `ws.cork(JS)` → `ws.close()` → `on_close` mutates `flags` /
// `this_value` on the SAME `m_ctx`. A `&mut Self` receiver would alias under
// Stacked Borrows. Receivers therefore take `&self`; per-field interior
// mutability (`Cell` for `Copy` flags/signal, `JsCell` for the non-`Copy`
// `JsRef`) carries the writes.
#[bun_jsc::JsClass]
pub struct ServerWebSocket {
    handler: bun_ptr::BackRef<WebSocketServerHandler>,
    this_value: JsCell<JsRef>,
    flags: Cell<Flags>,
    // `AbortSignal` is an opaque C++ type
    // with intrusive WebCore ref-counting (ref/unref) — never `Arc`. The init
    // caller transfers a +1 ref; `finalize`/`on_close` unref it.
    signal: Cell<Option<NonNull<AbortSignal>>>,
}

// We pack the per-socket data into this struct below:
// ssl:1, closed:1, <unused>:1, binary_type:4, packed_websocket_ptr:57
#[repr(transparent)]
#[derive(Copy, Clone, Default)]
pub struct Flags(u64);

impl Flags {
    const SSL_BIT: u64 = 1 << 0;
    const CLOSED_BIT: u64 = 1 << 1;
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
    pub fn closed(self) -> bool {
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
    #[inline]
    pub(crate) fn binary_type(self) -> BinaryType {
        match ((self.0 & Self::BINARY_TYPE_MASK) >> Self::BINARY_TYPE_SHIFT) as u8 {
            0 => BinaryType::Buffer,
            1 => BinaryType::ArrayBuffer,
            2 => BinaryType::Uint8Array,
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

// Codegen: JSServerWebSocket wrapper cached property accessors.
// `js::data_{get,set}_cached` are emitted by `.classes.ts` codegen
// (`generate-classes.ts` → `${T}__data{Get,Set}Cached`).
#[allow(non_snake_case)]
pub mod js {
    // Emits `{data,server}_{get,set}_cached`. Getter maps `JSValue::ZERO` → `None`;
    // setter forwards through the JSC `WriteBarrier<Unknown>` slot.
    ::bun_jsc::codegen_cached_accessors!("ServerWebSocket"; data, server);
}

/// RFC 6455 §5.5: control frame payloads are at most 125 bytes.
const MAX_CONTROL_FRAME_PAYLOAD: usize = 125;

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
/// `len` is the **byte** length actually written — callers holding an
/// `ArrayBuffer` view must pass `buffer.slice().len()`, not the typed-array
/// element count. `suffix` is `"bytes"` or `"bytes string"`.
#[inline]
pub(super) fn send_status_to_js(
    status: SendStatus,
    len: usize,
    op: &'static str,
    suffix: &'static str,
) -> JSValue {
    match status {
        SendStatus::Backpressure => {
            bun_output::scoped_log!(
                WebSocketServer,
                "{}() backpressure ({} {})",
                op,
                len,
                suffix
            );
            JSValue::js_number(-1.0)
        }
        SendStatus::Success => {
            bun_output::scoped_log!(WebSocketServer, "{}() success ({} {})", op, len, suffix);
            JSValue::js_number(len as f64)
        }
        SendStatus::Dropped => {
            bun_output::scoped_log!(WebSocketServer, "{}() dropped ({} {})", op, len, suffix);
            JSValue::js_number(0.0)
        }
    }
}

#[inline]
pub(super) fn blob_payload<'a>(
    global_this: &JSGlobalObject,
    fn_name: &'static str,
    value: JSValue,
) -> JsResult<Option<&'a [u8]>> {
    let Some(blob) = value.as_class_ref::<Blob>() else {
        return Ok(None);
    };
    if blob.needs_to_read_file() || blob.is_s3() {
        return Err(global_this.throw(format_args!(
            "{fn_name} cannot send a file- or S3-backed Blob synchronously; await blob.bytes() first"
        )));
    }
    Ok(Some(blob.shared_view()))
}

/// Handler state a `publish*` method reads once up front (`publish_ctx`).
#[derive(Clone, Copy)]
struct PublishCtx {
    /// The server's `uws_app_t*`; `ssl` says which `NewApp<SSL>` it is.
    app: *mut c_void,
    ssl: bool,
    publish_to_self: bool,
}

impl ServerWebSocket {
    #[inline]
    fn websocket(&self) -> AnyWebSocket {
        self.flags.get().websocket()
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

    // ──────────────────────────────────────────────────────────────────────
    // Shared helpers for the publish*/send* family.
    //
    // These collapse duplicated per-method blocks while remaining
    // byte-identical in observable behaviour — including the `args_len > 1`
    // guard on `compress` even when compress is args[2] (long-standing
    // user-visible behavior; do not "fix").
    //
    // A unified `publish_prologue` covering the full callframe header was
    // considered and rejected: publishText omits the empty-topic check and
    // reuses "publish" in its min-args message (both user-visible), so a single
    // prologue would either change user-visible errors or carry per-caller
    // bool flags — net more code than three small orthogonal helpers.
    // ──────────────────────────────────────────────────────────────────────

    /// The handler state a publish needs, or `None` when the server has been
    /// torn down (`handler.app == None`). The "publish() closed" log + `0`
    /// return is the caller's responsibility (it varies in nothing, but keeping
    /// it inline preserves the per-method `scoped_log!` callsite).
    #[inline]
    fn publish_ctx(&self) -> Option<PublishCtx> {
        let handler = self.handler();
        let app = handler.app?;
        let flags = handler.flags;
        Some(PublishCtx {
            app,
            ssl: flags.contains(HandlerFlags::SSL),
            publish_to_self: flags.contains(HandlerFlags::PUBLISH_TO_SELF),
        })
    }

    /// Shared `compress` argument validation for publish*/send*. Preserves the
    /// `args.len > 1` guard verbatim (even where compress is `args[2]`).
    #[inline]
    fn parse_compress_arg(
        global_this: &JSGlobalObject,
        fn_name: &'static str,
        compress_value: JSValue,
        args_len: usize,
    ) -> JsResult<bool> {
        if !compress_value.is_boolean()
            && !compress_value.is_undefined()
            && !compress_value.is_empty()
        {
            return Err(
                global_this.throw(format_args!("{fn_name} expects compress to be a boolean"))
            );
        }
        Ok(args_len > 1 && compress_value.to_boolean())
    }

    /// Route a publish through either the per-socket uWS handle (when
    /// `!publish_to_self && !closed`) or the app-wide broadcast, then map the
    /// aggregated `SendStatus` to the JS number contract shared with `send()`.
    #[inline]
    fn do_publish(
        &self,
        ctx: PublishCtx,
        topic: &[u8],
        buffer: &[u8],
        opcode: Opcode,
        compress: bool,
    ) -> JSValue {
        let status = if !ctx.publish_to_self && !self.is_closed() {
            self.websocket().publish(topic, buffer, opcode, compress)
        } else {
            AnyWebSocket::publish_with_options(ctx.ssl, ctx.app, topic, buffer, opcode, compress)
        };
        send_status_to_js(status, buffer.len(), "publish", "bytes")
    }

    /// Shared body for `subscribe` / `unsubscribe` / `isSubscribed`: identical
    /// arg-count guard, closed short-circuit, string-type guard, UTF-8 slice,
    /// non-empty guard, then dispatch to the uWS topic op. Only the JS-visible
    /// name and the terminal op differ.
    #[inline]
    fn topic_dispatch(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        fn_name: &'static str,
        op: impl FnOnce(AnyWebSocket, &[u8]) -> bool,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<1>();
        if callframe.arguments_count() < 1 {
            return Err(global_this.throw(format_args!("{fn_name} requires at least 1 argument")));
        }

        if self.is_closed() {
            return Ok(JSValue::FALSE);
        }

        if !args[0].is_string() {
            return Err(global_this.throw_invalid_argument_type_value(b"topic", b"string", args[0]));
        }

        let topic_view = args[0].to_js_string_view(global_this)?;
        let topic = topic_view.to_utf8();

        if topic.slice().is_empty() {
            return Err(
                global_this.throw(format_args!("{fn_name} requires a non-empty topic name"))
            );
        }

        Ok(JSValue::from(op(self.websocket(), topic.slice())))
    }

    // pub const js = jsc.Codegen.JSServerWebSocket; — provided by #[bun_jsc::JsClass]
    // toJS / fromJS / fromJSDirect — provided by codegen (see `to_js_ptr` / `JsClass` impl)

    /// Initialize a ServerWebSocket with the given handler, data value, and signal.
    /// The signal will not be ref'd inside the ServerWebSocket init function, but will unref itself when the ServerWebSocket is destroyed.
    pub(crate) fn init(
        handler: &WebSocketServerHandler,
        data_value: JSValue,
        signal: Option<NonNull<AbortSignal>>,
    ) -> *mut ServerWebSocket {
        let global_object = handler.global_object();
        let this = bun_core::heap::into_raw(Box::new(ServerWebSocket {
            handler: bun_ptr::BackRef::new(handler),
            this_value: JsCell::new(JsRef::empty()),
            flags: Cell::new(Flags::default()),
            signal: Cell::new(signal),
        }));
        // Get a strong ref and downgrade when terminating/close and GC will be able to collect the newly created value
        // SAFETY: `this` was just `heap::alloc`'d; ownership transfers to the
        // C++ JS wrapper (freed via `ServerWebSocketClass__finalize` → `finalize`).
        let this_value = unsafe { ServerWebSocket::to_js_ptr(this, global_object) };
        // SAFETY: just allocated; the JS wrapper holds the box but does not
        // touch the Rust fields concurrently (single JS thread). R-2: shared
        // borrow + `JsCell::set` — no `&mut Self` formed.
        let this_ref = unsafe { &*this };
        this_ref
            .this_value
            .set(JsRef::init_strong(this_value, global_object));
        js::data_set_cached(this_value, global_object, data_value);
        // Both callers route through `on_upgrade`'s `handler.server.is_none()`
        // refusal, so this is normally `Some`; keep the `and_then` as
        // defense-in-depth (option getters between that guard and here can
        // re-enter JS and `stop(true)`, and `js_value_for_dispatch` returns
        // `None` once the wrapper is `Finalized` or the VM's script gate has
        // closed).
        if let Some(server_js) = handler.server.and_then(|s| s.js_value_for_dispatch()) {
            js::server_set_cached(this_value, global_object, server_js);
        }
        this
    }

    pub(crate) fn memory_cost(&self) -> usize {
        if self.flags.get().closed() {
            return mem::size_of::<ServerWebSocket>();
        }
        self.websocket().memory_cost() + mem::size_of::<ServerWebSocket>()
    }

    /// R-2 (noalias re-entrancy): `&self`, NOT `&mut self`. `ws.cork(...)`
    /// re-enters JS which can `ws.close()` / `ws.send()` on this same socket
    /// via the JS wrapper's `m_ptr`, flipping `flags.closed`. All state lives
    /// behind `Cell`/`JsCell`, so the re-entrant frame's writes are visible
    /// here without aliasing a `noalias` borrow. `handler`/`vm`/`global_object`
    /// are detached `&'a` borrows of the server config (a separate allocation),
    /// so they may legally span the call.
    pub(crate) fn on_open(&self, ws: AnyWebSocket) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "OnOpen");
        self.update_flags(|f| {
            f.set_packed_websocket_ptr(ws.raw() as usize as u64);
            f.set_closed(false);
            f.set_ssl(matches!(ws, AnyWebSocket::Ssl(_)));
        });

        let handler = self.handler();
        let vm = handler.vm();
        // Live-socket accounting lives on the server (`Cell`), reached
        // through the type-erased backref so the shared `&Handler` suffices.
        let server = handler.server;
        if let Some(server) = server {
            server.on_websocket_opened();
        }
        let global_object = handler.global_object();
        let on_open_handler = handler.on_open;
        let on_error = handler.on_error;

        if on_open_handler.is_empty_or_undefined_or_null() {
            return Ok(());
        }

        let this_value = self
            .this_value
            .get()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED);
        let args = [this_value];

        let _loop_guard = vm.enter_event_loop_scope();

        let mut corker = Corker {
            args: &args,
            global_object,
            this_value: JSValue::ZERO,
            callback: on_open_handler,
            result: Ok(JSValue::ZERO),
        };
        ws.cork(&mut corker, Corker::run);
        if let Err(e) = corker.result {
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

            let handled = handler.run_error_callback(on_error, global_object, err_value);
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
        // Converting the payload threw (or the VM is terminating): there is
        // no message to deliver; the handler's landing frame folds it.
        let data = data?;
        let arguments = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            data,
        ];

        let mut corker = Corker {
            args: &arguments,
            global_object,
            this_value: JSValue::ZERO,
            callback: on_message_handler,
            result: Ok(JSValue::ZERO),
        };

        ws.cork(&mut corker, Corker::run);
        let result = match corker.result {
            Ok(result) => result,
            Err(e) => {
                let err_value = global_object.take_error(e);
                return self
                    .handler()
                    .run_error_callback(on_error, global_object, err_value);
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

            let args = [self
                .this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED)];
            let mut corker = Corker {
                args: &args,
                global_object,
                this_value: JSValue::ZERO,
                callback: on_drain,
                result: Ok(JSValue::ZERO),
            };
            let _loop_guard = vm.enter_event_loop_scope();
            self.websocket().cork(&mut corker, Corker::run);
            if let Err(e) = corker.result {
                let err_value = global_object.take_error(e);
                handler.run_error_callback(on_error, global_object, err_value)?;
            }
        }
        Ok(())
    }

    fn binary_to_js(&self, global_this: &JSGlobalObject, data: &[u8]) -> JsResult<JSValue> {
        match self.flags.get().binary_type() {
            BinaryType::Buffer => ArrayBuffer::create_buffer(global_this, data),
            BinaryType::Uint8Array => {
                ArrayBuffer::create::<{ JSType::Uint8Array }>(global_this, data)
            }
            BinaryType::ArrayBuffer => {
                ArrayBuffer::create::<{ JSType::ArrayBuffer }>(global_this, data)
            }
            BinaryType::Blob => {
                let blob = Blob::new(Blob::init(data.to_vec(), global_this));
                // SAFETY: `blob` is the live allocation `Blob::new` just made. `BlobExt::to_js`
                // reports the payload size to the GC, which the by-value `JsClass::to_js` skips.
                Ok(unsafe { BlobExt::to_js(&*blob, global_this) })
            }
        }
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub(crate) fn on_ping(&self, _ws: AnyWebSocket, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "onPing: {}", bstr::BStr::new(data));
        let handler = self.handler();
        let cb = handler.on_ping;
        let on_error = handler.on_error;
        let vm = handler.vm();
        if cb.is_empty_or_undefined_or_null() {
            return Ok(());
        }
        let global_this = handler.global_object();

        // This is the start of a task.
        let _loop_guard = vm.enter_event_loop_scope();

        let data = self.binary_to_js(global_this, data)?;
        let args = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            data,
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_error(e);
            bun_output::scoped_log!(WebSocketServer, "onPing error");
            handler.run_error_callback(on_error, global_this, err)?;
        }
        Ok(())
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    pub(crate) fn on_pong(&self, _ws: AnyWebSocket, data: &[u8]) -> JsResult<()> {
        bun_output::scoped_log!(WebSocketServer, "onPong: {}", bstr::BStr::new(data));
        let handler = self.handler();
        let cb = handler.on_pong;
        let on_error = handler.on_error;
        if cb.is_empty_or_undefined_or_null() {
            return Ok(());
        }

        let global_this = handler.global_object();
        let vm = handler.vm();

        // This is the start of a task.
        let _loop_guard = vm.enter_event_loop_scope();

        let data = self.binary_to_js(global_this, data)?;
        let args = [
            self.this_value
                .get()
                .try_get()
                .unwrap_or(JSValue::UNDEFINED),
            data,
        ];
        if let Err(e) = cb.call(global_this, JSValue::UNDEFINED, &args) {
            let err = global_this.take_error(e);
            bun_output::scoped_log!(WebSocketServer, "onPong error");
            handler.run_error_callback(on_error, global_this, err)?;
        }
        Ok(())
    }

    /// `&self` for the same noalias-reentry reason as `on_open` (R-2).
    /// Re-entrant `ws.close()` from the close handler routes through the same
    /// `Cell<Flags>` / `JsCell<JsRef>`, so no `noalias` view is invalidated.
    pub fn on_close(&self, _ws: AnyWebSocket, code: i32, message: &[u8]) -> JsResult<()> {
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
        let cached_this = self
            .this_value
            .get()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED);
        let this_value_cell: &JsCell<JsRef> = &self.this_value;
        let _cleanup = scopeguard::guard(signal, move |sig| {
            if let Some(sig) = sig {
                // `sig` was stored with a +1 ref by the upgrade caller; it
                // stays live until this paired `unref()`, so the transient
                // `BackRef` (pointee-outlives-holder) is sound for both calls.
                let sig = bun_ptr::BackRef::from(sig);
                sig.pending_activity_unref();
                sig.unref();
            }
            if was_not_empty {
                // The `server` traced edge set in `init` must outlive this
                // wrapper: `self.handler` points into the server's allocation
                // and publish()/send() still work on closed sockets (#36788).
                // R-2: closure-scoped `&mut JsRef` via `JsCell::with_mut` —
                // no raw `*mut` projection needed.
                this_value_cell.with_mut(|v| v.downgrade());
            }
        });

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
                    return handler.run_error_callback(on_error, global_object, err);
                }
            };

            let call_args = [cached_this, JSValue::js_number(code as f64), message_js];
            if let Err(e) = on_close_handler.call(global_object, JSValue::UNDEFINED, &call_args) {
                let err = global_object.take_error(e);
                bun_output::scoped_log!(WebSocketServer, "onClose error {}", was_not_empty);
                return handler.run_error_callback(on_error, global_object, err);
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

    // No `#[bun_jsc::host_fn]` here — the constructor extern shim is
    // emitted by `generated_classes.rs`, which calls `<Self>::constructor`
    // directly.
    pub(crate) fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut ServerWebSocket> {
        Err(global_object.throw(format_args!("Cannot construct ServerWebSocket")))
    }

    // Codegen's `host_fn_finalize` calls this via `|b| ServerWebSocket::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(WebSocketServer, "finalize");
        self.this_value.with_mut(|v| v.finalize());
        if let Some(signal) = self.signal.take() {
            // `signal` was stored with a +1 ref by the upgrade caller; it
            // stays live until this paired `unref()`, so the transient
            // `BackRef` (pointee-outlives-holder) is sound for both calls —
            // same pattern as `on_close()`'s `_cleanup` guard.
            let sig = bun_ptr::BackRef::from(signal);
            sig.pending_activity_unref();
            sig.unref();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn publish(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [topic_value, message_value, compress_value] = callframe.arguments_as_array::<3>();
        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return Err(global_this.throw(format_args!("publish requires a topic string")));
        }

        // ToString on either argument can run user JS that stops the server or
        // triggers GC, so both are converted (and their JSStrings held) before
        // the handler state is read.
        let topic_view = topic_value.to_js_string_view(global_this)?;
        let topic_slice = topic_view.to_utf8();
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publish requires a non-empty topic")));
        }

        let compress = Self::parse_compress_arg(
            global_this,
            "publish",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("publish requires a non-empty message")));
        }

        let array_buffer = message_value.as_array_buffer(global_this);
        let message_view;
        let message_slice;
        let (buffer, opcode): (&[u8], Opcode) = if let Some(array_buffer) = &array_buffer {
            (array_buffer.slice(), Opcode::Binary)
        } else if let Some(slice) = blob_payload(global_this, "publish", message_value)? {
            (slice, Opcode::Binary)
        } else {
            message_view = message_value.to_js_string_view(global_this)?;
            message_slice = message_view.to_utf8();
            (message_slice.slice(), Opcode::Text)
        };

        let Some(ctx) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };

        let ret = self.do_publish(ctx, topic_slice.slice(), buffer, opcode, compress);
        message_value.ensure_still_alive();
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn publish_text(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [topic_value, message_value, compress_value] = callframe.arguments_as_array::<3>();

        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publish()");
            return Err(global_this.throw(format_args!("publish requires at least 1 argument")));
        }

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publish() topic invalid");
            return Err(global_this.throw(format_args!("publishText requires a topic string")));
        }

        let topic_view = topic_value.to_js_string_view(global_this)?;
        let topic_slice = topic_view.to_utf8();

        let compress = Self::parse_compress_arg(
            global_this,
            "publishText",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("publishText requires a non-empty message")));
        }

        let message_view = message_value.to_js_string_view(global_this)?;
        let message_slice = message_view.to_utf8();

        let Some(ctx) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };

        let ret = self.do_publish(
            ctx,
            topic_slice.slice(),
            message_slice.slice(),
            Opcode::Text,
            compress,
        );
        Ok(ret)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn publish_binary(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [topic_value, message_value, compress_value] = callframe.arguments_as_array::<3>();

        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "publishBinary()");
            return Err(
                global_this.throw(format_args!("publishBinary requires at least 1 argument"))
            );
        }

        if topic_value.is_empty_or_undefined_or_null() || !topic_value.is_string() {
            bun_output::scoped_log!(WebSocketServer, "publishBinary() topic invalid");
            return Err(global_this.throw(format_args!("publishBinary requires a topic string")));
        }

        let topic_view = topic_value.to_js_string_view(global_this)?;
        let topic_slice = topic_view.to_utf8();
        if topic_slice.slice().is_empty() {
            return Err(global_this.throw(format_args!("publishBinary requires a non-empty topic")));
        }

        let compress = Self::parse_compress_arg(
            global_this,
            "publishBinary",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(
                global_this.throw(format_args!("publishBinary requires a non-empty message"))
            );
        }

        let array_buffer = message_value.as_array_buffer(global_this);
        let buffer: &[u8] = if let Some(array_buffer) = &array_buffer {
            array_buffer.slice()
        } else if let Some(slice) = blob_payload(global_this, "publishBinary", message_value)? {
            slice
        } else {
            return Err(
                global_this.throw(format_args!("publishBinary expects a Blob or BufferSource"))
            );
        };

        let Some(ctx) = self.publish_ctx() else {
            bun_output::scoped_log!(WebSocketServer, "publish() closed");
            return Ok(JSValue::js_number(0.0));
        };

        let ret = self.do_publish(ctx, topic_slice.slice(), buffer, Opcode::Binary, compress);
        message_value.ensure_still_alive();
        Ok(ret)
    }

    // `passThis: true` in server.classes.ts — wrapper is emitted by
    // generated_classes.rs (ServerWebSocketPrototype__cork) and passes
    // `js_this_value` as a 4th arg, which `#[host_fn(method)]` does not model.
    pub(crate) fn cork(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let [callback] = callframe.arguments_as_array::<1>();

        if callframe.arguments_count() < 1 {
            return Err(global_this.throw_not_enough_arguments("cork", 1, 0));
        }

        if callback.is_empty_or_undefined_or_null() || !callback.is_callable() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"cork",
                b"callback",
                callback,
            ));
        }

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut corker = Corker {
            args: &[this_value],
            global_object: global_this,
            this_value,
            callback,
            result: Ok(JSValue::ZERO),
        };
        self.websocket().cork(&mut corker, Corker::run);

        corker.result
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn send(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [message_value, compress_value] = callframe.arguments_as_array::<2>();

        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "send()");
            return Err(global_this.throw(format_args!("send requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "send() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let compress = Self::parse_compress_arg(
            global_this,
            "send",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if message_value.is_empty_or_undefined_or_null() {
            return Err(global_this.throw(format_args!("send requires a non-empty message")));
        }

        if let Some(buffer) = message_value.as_array_buffer(global_this) {
            let slice = buffer.slice();
            return Ok(send_status_to_js(
                self.websocket().send(slice, Opcode::Binary, compress, true),
                slice.len(),
                "send",
                "bytes",
            ));
        }

        if let Some(slice) = blob_payload(global_this, "send", message_value)? {
            let ret = send_status_to_js(
                self.websocket().send(slice, Opcode::Binary, compress, true),
                slice.len(),
                "send",
                "bytes",
            );
            message_value.ensure_still_alive();
            return Ok(ret);
        }

        {
            let view = message_value.to_js_string_view(global_this)?;
            let slice = view.to_utf8();

            let buffer = slice.slice();
            Ok(send_status_to_js(
                self.websocket().send(buffer, Opcode::Text, compress, true),
                buffer.len(),
                "send",
                "bytes string",
            ))
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn send_text(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [message_value, compress_value] = callframe.arguments_as_array::<2>();

        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendText()");
            return Err(global_this.throw(format_args!("sendText requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendText() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let compress = Self::parse_compress_arg(
            global_this,
            "sendText",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if message_value.is_empty_or_undefined_or_null() || !message_value.is_string() {
            return Err(global_this.throw(format_args!("sendText expects a string")));
        }

        let view = message_value.to_js_string_view(global_this)?;
        let slice = view.to_utf8();

        let buffer = slice.slice();
        Ok(send_status_to_js(
            self.websocket().send(buffer, Opcode::Text, compress, true),
            buffer.len(),
            "sendText",
            "bytes string",
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn send_binary(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [message_value, compress_value] = callframe.arguments_as_array::<2>();

        if callframe.arguments_count() < 1 {
            bun_output::scoped_log!(WebSocketServer, "sendBinary()");
            return Err(global_this.throw(format_args!("sendBinary requires at least 1 argument")));
        }

        if self.is_closed() {
            bun_output::scoped_log!(WebSocketServer, "sendBinary() closed");
            return Ok(JSValue::js_number(0.0));
        }

        let compress = Self::parse_compress_arg(
            global_this,
            "sendBinary",
            compress_value,
            callframe.arguments_count() as usize,
        )?;

        if let Some(buffer) = message_value.as_array_buffer(global_this) {
            let slice = buffer.slice();
            return Ok(send_status_to_js(
                self.websocket().send(slice, Opcode::Binary, compress, true),
                slice.len(),
                "sendBinary",
                "bytes",
            ));
        }

        if let Some(slice) = blob_payload(global_this, "sendBinary", message_value)? {
            let ret = send_status_to_js(
                self.websocket().send(slice, Opcode::Binary, compress, true),
                slice.len(),
                "sendBinary",
                "bytes",
            );
            message_value.ensure_still_alive();
            return Ok(ret);
        }

        Err(global_this.throw(format_args!("sendBinary requires a Blob or BufferSource")))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn ping(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "ping", Opcode::Ping)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn pong(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.send_ping(global_this, callframe, "pong", Opcode::Pong)
    }

    #[inline]
    fn send_ping(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        name: &'static str,
        opcode: Opcode,
    ) -> JsResult<JSValue> {
        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }

        if callframe.arguments_count() > 0 {
            let value = callframe.argument(0);
            if !value.is_empty_or_undefined_or_null() {
                if let Some(data) = value.as_array_buffer(global_this) {
                    let buffer = data.slice();
                    if buffer.len() > MAX_CONTROL_FRAME_PAYLOAD {
                        return Err(throw_control_frame_too_large(global_this, buffer.len()));
                    }
                    return Ok(send_status_to_js(
                        self.websocket().send(buffer, opcode, false, true),
                        buffer.len(),
                        name,
                        "bytes",
                    ));
                } else if let Some(buffer) = blob_payload(global_this, name, value)? {
                    if buffer.len() > MAX_CONTROL_FRAME_PAYLOAD {
                        return Err(throw_control_frame_too_large(global_this, buffer.len()));
                    }
                    let ret = send_status_to_js(
                        self.websocket().send(buffer, opcode, false, true),
                        buffer.len(),
                        name,
                        "bytes",
                    );
                    value.ensure_still_alive();
                    return Ok(ret);
                } else if value.is_string() {
                    let view = value.to_js_string_view(global_this)?;
                    let string_value = view.to_utf8();
                    let buffer = string_value.slice();
                    if buffer.len() > MAX_CONTROL_FRAME_PAYLOAD {
                        return Err(throw_control_frame_too_large(global_this, buffer.len()));
                    }
                    return Ok(send_status_to_js(
                        self.websocket().send(buffer, opcode, false, true),
                        buffer.len(),
                        name,
                        "bytes",
                    ));
                } else {
                    return Err(global_this.throw(format_args!(
                        "{} requires a string, Blob, or BufferSource",
                        name
                    )));
                }
            }
        }

        Ok(send_status_to_js(
            self.websocket().send(&[], opcode, false, true),
            0,
            name,
            "bytes",
        ))
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_data(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getData()");
        if let Some(this_value) = self.this_value.get().try_get() {
            return js::data_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_data(
        &self,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setData()");
        if let Some(this_value) = self.this_value.get().try_get() {
            js::data_set_cached(this_value, global_object, value);
        }
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_ready_state(&self, _global_this: &JSGlobalObject) -> JSValue {
        bun_output::scoped_log!(WebSocketServer, "getReadyState()");

        if self.is_closed() {
            return JSValue::js_number(3.0);
        }

        JSValue::js_number(1.0)
    }

    // `passThis: true` — wrapper emitted by generated_classes.rs.
    // R-2: `&self` — `websocket().end()` synchronously dispatches `on_close`
    // on this same `m_ctx`; a `&mut self` here would alias.
    pub fn close(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        // Since close() can lead to the close() callback being called, let's always ensure the `this` value is up to date.
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        bun_output::scoped_log!(WebSocketServer, "close()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        let code: i32 = 'brk: {
            if args[0].is_undefined() {
                // default exception code
                break 'brk 1000;
            }

            if !args[0].is_number() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "close requires a numeric code or undefined"
                )));
            }

            break 'brk args[0].coerce_to_i32(global_this)?;
        };

        let message_value: Utf8Bytes = 'brk: {
            if args[1].is_undefined() {
                break 'brk Utf8Bytes::EMPTY;
            }
            break 'brk args[1].to_utf8(global_this)?;
        };

        // `to_utf8` can run user `toString()`, which may re-entrantly
        // `ws.close()` and already decrement the count; re-check the guard.
        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
        }

        // Copy the server backref BEFORE end(): on_close re-enters and the
        // user's close handler may call stop(true), which clears handler.server.
        let server = self.handler().server;
        self.update_flags(|f| f.set_closed(true));
        self.websocket().end(code, message_value.slice());
        // on_close re-entered with was_closed=true so it skipped the
        // accounting; balance the count here.
        if let Some(server) = server {
            server.on_websocket_closed();
        }
        Ok(JSValue::UNDEFINED)
    }

    // `passThis: true` — wrapper emitted by generated_classes.rs.
    // R-2: `&self` — `websocket().close()` synchronously dispatches `on_close`.
    pub(crate) fn terminate(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
        _this_value: JSValue,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "terminate()");

        if self.is_closed() {
            return Ok(JSValue::UNDEFINED);
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

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_binary_type(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBinaryType()");

        Ok(match self.flags.get().binary_type() {
            BinaryType::Uint8Array => global_this.common_strings().uint8array(),
            BinaryType::Buffer => global_this.common_strings().nodebuffer(),
            BinaryType::ArrayBuffer => global_this.common_strings().arraybuffer(),
            BinaryType::Blob => global_this.common_strings().blob(),
        })
    }

    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_binary_type(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<bool> {
        bun_output::scoped_log!(WebSocketServer, "setBinaryType()");

        let binary_type = if value.is_string() {
            BINARY_TYPE_MAP.from_js(global_this, value)?
        } else {
            None
        };
        match binary_type {
            Some(val) => {
                self.update_flags(|f| f.set_binary_type(val));
                Ok(true)
            }
            None => Err(global_this.throw(format_args!(
                "binaryType must be either \"uint8array\", \"arraybuffer\", \"nodebuffer\" or \"blob\"",
            ))),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_buffered_amount(
        &self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(WebSocketServer, "getBufferedAmount()");

        if self.is_closed() {
            return Ok(JSValue::js_number(0.0));
        }

        Ok(JSValue::js_number(
            self.websocket().get_buffered_amount() as f64
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn subscribe(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(global_this, callframe, "subscribe", AnyWebSocket::subscribe)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn unsubscribe(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(
            global_this,
            callframe,
            "unsubscribe",
            AnyWebSocket::unsubscribe,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn is_subscribed(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.topic_dispatch(
            global_this,
            callframe,
            "isSubscribed",
            AnyWebSocket::is_subscribed,
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_subscriptions(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_remote_address(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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
        bun_string_jsc::create_utf8_for_js(global_this, text)
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
        crate::dispatch::fold(unsafe { &*this }.on_open(ws));
    }
    #[inline(always)]
    unsafe fn on_message(this: *mut Self, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        // SAFETY: per trait contract.
        crate::dispatch::fold(unsafe { &*this }.on_message(ws, message, opcode));
    }
    #[inline(always)]
    unsafe fn on_drain(this: *mut Self, ws: AnyWebSocket) {
        // SAFETY: per trait contract.
        crate::dispatch::fold(unsafe { &*this }.on_drain(ws));
    }
    #[inline(always)]
    unsafe fn on_ping(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        crate::dispatch::fold(unsafe { &*this }.on_ping(ws, message));
    }
    #[inline(always)]
    unsafe fn on_pong(this: *mut Self, ws: AnyWebSocket, message: &[u8]) {
        // SAFETY: per trait contract.
        crate::dispatch::fold(unsafe { &*this }.on_pong(ws, message));
    }
    #[inline(always)]
    unsafe fn on_close(this: *mut Self, ws: AnyWebSocket, code: i32, message: &[u8]) {
        // SAFETY: per trait contract.
        crate::dispatch::fold(unsafe { &*this }.on_close(ws, code, message));
    }
}

struct Corker<'a> {
    args: &'a [JSValue],
    global_object: &'a JSGlobalObject,
    this_value: JSValue,
    callback: JSValue,
    result: JsResult<JSValue>,
}

impl<'a> Corker<'a> {
    fn run(&mut self) {
        let this_value = self.this_value;
        self.result = self.callback.call(
            self.global_object,
            if this_value.is_empty() {
                JSValue::UNDEFINED
            } else {
                this_value
            },
            self.args,
        );
    }
}
