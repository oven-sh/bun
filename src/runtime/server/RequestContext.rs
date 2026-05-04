use core::ffi::{c_uint, c_void};
use core::ptr::NonNull;
use std::sync::Arc;
use std::rc::Rc;
use std::io::Write as _;

use bun_core::Output;
use bun_str::{self as bun_string, String as BunString};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, CallFrame, JsResult, VirtualMachine};
use bun_jsc::webcore::{self as WebCore, Blob, Body, FetchHeaders, Request, Response, ReadableStream, AbortSignal, CookieMap, ByteStream};
use bun_jsc::api::{AnyRequestContext, NativePromiseContext};
use bun_http::{self as HTTP, MimeType, Method};
use bun_uws::{self as uws, AnyResponse, SocketAddress, WebSocketUpgradeContext};
use bun_logger as logger;
use bun_sys;
use bun_paths::PathBuffer;
use bun_collections::{HiveArray, ByteList};
use bun_runtime::server::{FileResponseStream, HTTPStatusText, RangeRequest};
use bun_runtime::api::S3;
use bun_js_parser::runtime::Fallback;
use bun_schema::api as Api;

bun_output::declare_scope!(RequestContext, visible);
bun_output::declare_scope!(ReadableStream, visible);

macro_rules! ctx_log { ($($t:tt)*) => { bun_output::scoped_log!(RequestContext, $($t)*) }; }
macro_rules! stream_log { ($($t:tt)*) => { bun_output::scoped_log!(ReadableStream, $($t)*) }; }

/// Q: Why is this needed?
/// A: The dev server needs to attach its own callback when the request is
///    aborted.
///
/// Q: Why can't the dev server just call `.setAbortHandler(...)` then?
/// A: It can't, because that is *already* called by the RequestContext, setting
///    the callback and the user data context pointer.
///
///    If it did, it would *overwrite* the user data context pointer (this
///    is what it did before), causing segfaults.
pub struct AdditionalOnAbortCallback {
    pub cb: fn(*mut c_void),
    pub data: NonNull<c_void>,
    pub deref_fn: fn(*mut c_void),
}

impl AdditionalOnAbortCallback {
    pub fn deref(&self) {
        (self.deref_fn)(self.data.as_ptr());
    }
}

// TODO(port): Zig `NewRequestContext(comptime ssl_enabled: bool, comptime debug_mode: bool,
// comptime ThisServer: type, comptime http3: bool) type` — modeled here as a generic struct
// with const-generic flags and a generic `ThisServer` type param. Associated `App`/`Req`/`Resp`
// type aliases are selected via the `Transport` helper trait below; Phase B may need to adjust
// once the uws crate's surface is finalized.
pub trait Transport {
    type Response;
    type Request;
}

// TODO(port): the Zig picks `uws.H3.Response` vs `uws.NewApp(ssl_enabled).Response` and
// `uws.H3.Request` vs `uws.Request`. Phase B: implement `Transport` for the four
// (ssl_enabled, http3) combinations in bun_uws.
pub struct TransportFor<const SSL_ENABLED: bool, const HTTP3: bool>;
impl<const SSL_ENABLED: bool, const HTTP3: bool> Transport for TransportFor<SSL_ENABLED, HTTP3> {
    // TODO(port): wire to bun_uws::H3::Response / bun_uws::NewApp<SSL_ENABLED>::Response
    type Response = uws::Response;
    type Request = uws::Request;
}

pub type Req<const SSL_ENABLED: bool, const HTTP3: bool> =
    <TransportFor<SSL_ENABLED, HTTP3> as Transport>::Request;
pub type Resp<const SSL_ENABLED: bool, const HTTP3: bool> =
    <TransportFor<SSL_ENABLED, HTTP3> as Transport>::Response;

// TODO(port): jsc.WebCore.HTTPServerWritable(ssl_enabled, http3) — comptime type fn.
pub type ResponseStream<const SSL_ENABLED: bool, const HTTP3: bool> =
    WebCore::HTTPServerWritable<SSL_ENABLED, HTTP3>;
pub type ResponseStreamJSSink<const SSL_ENABLED: bool, const HTTP3: bool> =
    <ResponseStream<SSL_ENABLED, HTTP3> as WebCore::Writable>::JSSink;

/// This pre-allocates up to 2,048 RequestContext structs.
/// It costs about 655,632 bytes.
// TODO(port): bun.HiveArray(RequestContext, if (bun.heap_breakdown.enabled) 0 else 2048).Fallback
pub type RequestContextStackAllocator<ThisServer, const SSL: bool, const DBG: bool, const H3: bool> =
    bun_collections::hive_array::Fallback<RequestContext<ThisServer, SSL, DBG, H3>, 2048>;

thread_local! {
    // TODO(port): Zig `pub threadlocal var pool: ?*RequestContextStackAllocator = null;` is
    // per-monomorphization. Rust thread_local! cannot be generic; Phase B: move into ThisServer
    // or use a per-instantiation static via macro.
    static POOL: core::cell::Cell<*mut c_void> = const { core::cell::Cell::new(core::ptr::null_mut()) };
}

pub struct RequestContext<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const HTTP3: bool> {
    pub server: Option<*const ThisServer>,
    pub resp: Option<*mut Resp<SSL_ENABLED, HTTP3>>,
    /// thread-local default heap allocator
    /// this prevents an extra pthread_getspecific() call which shows up in profiling
    // TODO(port): allocator field deleted — global mimalloc per PORTING.md §Allocators.
    pub req: Option<*mut Req<SSL_ENABLED, HTTP3>>,
    pub request_weakref: Request::WeakRef,
    pub signal: Option<Arc<AbortSignal>>,
    pub method: HTTP::Method,
    pub cookies: Option<Rc<CookieMap>>,

    pub flags: Flags<DEBUG_MODE>,

    pub upgrade_context: Option<*mut WebSocketUpgradeContext>,

    /// We can only safely free once the request body promise is finalized
    /// and the response is rejected
    // TODO(port): bare JSValue heap field — kept alive via manual protect()/unprotect()
    // (response_protected flag); revisit bun_jsc::Strong in Phase B.
    pub response_jsvalue: JSValue,
    pub ref_count: u8,

    /// Weak: for plain Blob/InternalBlob bodies the Response JSValue is
    /// not protected (hot path), so GC may finalize it while we're parked
    /// on tryEnd() backpressure. onAbort / handleResolveStream /
    /// handleRejectStream only use this for best-effort readable-stream
    /// cleanup and safely observe null instead of UAF. File/.Locked
    /// bodies still protect() response_jsvalue, so the pointer stays
    /// valid for renderMetadata() on those paths.
    pub response_weakref: Response::WeakRef,
    pub blob: WebCore::Blob::Any,

    pub sendfile: SendfileContext,
    pub range: RangeRequest::Raw,

    pub request_body_readable_stream_ref: WebCore::ReadableStream::Strong,
    pub request_body: Option<Rc<WebCore::body::value::HiveRef>>,
    pub request_body_buf: Vec<u8>,
    pub request_body_content_len: usize,

    pub sink: Option<Box<ResponseStreamJSSink<SSL_ENABLED, HTTP3>>>,
    pub byte_stream: Option<NonNull<ByteStream>>,
    /// This keeps the Response body's ReadableStream alive.
    pub response_body_readable_stream_ref: WebCore::ReadableStream::Strong,

    /// Used in errors
    pub pathname: BunString,

    /// Used either for temporary blob data or fallback
    /// When the response body is a temporary value
    pub response_buf_owned: Vec<u8>,

    /// Defer finalization until after the request handler task is completed?
    // TODO(port): LIFETIMES.tsv = BORROW_PARAM Option<&'a mut bool>; raw ptr used to avoid <'a> in Phase A
    pub defer_deinit_until_callback_completes: Option<*mut bool>,

    pub additional_on_abort: Option<AdditionalOnAbortCallback>,

    // TODO: support builtin compression
}

impl<ThisServer, const SSL_ENABLED: bool, const DEBUG_MODE: bool, const HTTP3: bool>
    RequestContext<ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>
where
    ThisServer: ServerLike, // TODO(port): trait bound capturing the methods/fields used on ThisServer
{
    pub const IS_H3: bool = HTTP3;
    const RESP_KIND: uws::ResponseKind = uws::ResponseKind::from(SSL_ENABLED, HTTP3);

    pub fn set_signal_aborted(&mut self, reason: jsc::CommonAbortReason) {
        if let Some(signal) = &self.signal {
            if let Some(server) = self.server {
                // SAFETY: server is valid while RequestContext is alive (BACKREF)
                signal.signal(unsafe { (*server).global_this() }, reason);
            }
        }
    }

    pub fn dev_server(&self) -> Option<&bun_bake::DevServer> {
        let server = self.server?;
        // SAFETY: server is valid while RequestContext is alive (BACKREF)
        unsafe { (*server).dev_server() }
    }

    pub fn memory_cost(&self) -> usize {
        // The Sink and ByteStream aren't owned by this.
        core::mem::size_of::<Self>()
            + self.request_body_buf.capacity()
            + self.response_buf_owned.capacity()
            + self.blob.memory_cost()
    }

    #[inline]
    pub fn is_async(&self) -> bool {
        self.defer_deinit_until_callback_completes.is_none()
    }

    fn drain_microtasks(&self) {
        if self.is_async() {
            return;
        }
        if let Some(server) = self.server {
            // SAFETY: BACKREF
            unsafe { (*server).vm() }.drain_microtasks();
        }
    }

    pub fn set_abort_handler(&mut self) {
        if self.flags.has_abort_handler() {
            return;
        }
        if let Some(resp) = self.resp {
            self.flags.set_has_abort_handler(true);
            // SAFETY: FFI handle valid while resp is Some
            unsafe { (*resp).on_aborted(Self::on_abort, self) };
        }
    }

    pub fn set_cookies(&mut self, cookie_map: Option<Rc<CookieMap>>) {
        if let Some(cookies) = self.cookies.take() {
            drop(cookies); // deref
        }
        self.cookies = cookie_map;
        // Rc clone is the ref(); the Zig does ref() because the param is borrowed.
        // TODO(port): if callers pass an already-owned Rc, the extra ref is a no-op here.
    }

    pub fn set_timeout_handler(&mut self) {
        if self.flags.has_timeout_handler() {
            return;
        }
        if let Some(resp) = self.resp {
            self.flags.set_has_timeout_handler(true);
            // SAFETY: FFI handle valid while resp is Some
            unsafe { (*resp).on_timeout(Self::on_timeout, self) };
        }
    }

    #[bun_jsc::host_fn]
    pub fn on_resolve(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onResolve");

        let arguments = callframe.arguments_old(2);
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments.ptr[1]) else {
            // The cell's destructor already released the ref (the Promise
            // was collected before a prior microtask turn reached us).
            return Ok(JSValue::UNDEFINED);
        };
        let _guard = scopeguard::guard((), |_| ctx.deref());

        let result = arguments.ptr[0];
        result.ensure_still_alive();

        Self::handle_resolve(ctx, result);
        Ok(JSValue::UNDEFINED)
    }

    fn render_missing_invalid_response(&mut self, value: JSValue) {
        let class_name = value.get_class_info_name().unwrap_or(b"");

        if let Some(server) = self.server {
            // SAFETY: BACKREF
            let global_this: &JSGlobalObject = unsafe { (*server).global_this() };

            Output::enable_buffering();
            let writer = Output::error_writer();

            if class_name == b"Response" {
                Output::err_generic(
                    "Expected a native Response object, but received a polyfilled Response object. Bun.serve() only supports native Response objects.",
                    (),
                );
            } else if !value.is_empty() && !global_this.has_exception() {
                let mut formatter = jsc::ConsoleObject::Formatter {
                    global_this,
                    quote_strings: true,
                    ..Default::default()
                };
                Output::err_generic(
                    "Expected a Response object, but received '{}'",
                    (value.to_fmt(&mut formatter),),
                );
                // formatter dropped at scope end (Drop impl)
            } else {
                Output::err_generic("Expected a Response object", ());
            }

            Output::flush();
            if !global_this.has_exception() {
                jsc::ConsoleObject::write_trace(&mut writer, global_this);
            }
            Output::flush();
        }
        self.render_missing();
    }

    fn handle_resolve(ctx: &mut Self, value: JSValue) {
        if ctx.is_aborted_or_ended() || ctx.did_upgrade_web_socket() {
            return;
        }

        if ctx.server.is_none() {
            ctx.render_missing_invalid_response(value);
            return;
        }
        if value.is_empty_or_undefined_or_null() || !value.is_cell() {
            ctx.render_missing_invalid_response(value);
            return;
        }

        let Some(response) = value.as_::<Response>() else {
            ctx.render_missing_invalid_response(value);
            return;
        };
        ctx.response_jsvalue = value;
        debug_assert!(!ctx.flags.response_protected());
        ctx.flags.set_response_protected(true);
        value.protect();

        if ctx.method == Method::HEAD {
            if let Some(resp) = ctx.resp {
                let mut pair = HeaderResponsePair { this: ctx, response };
                // SAFETY: FFI handle
                unsafe { (*resp).run_corked_with_type(Self::do_render_head_response, &mut pair) };
            }
            return;
        }

        ctx.render(response);
    }

    pub fn should_render_missing(&self) -> bool {
        // If we did not respond yet, we should render missing
        // To allow this all the conditions above should be true:
        // 1 - still has a response (not detached)
        // 2 - not aborted
        // 3 - not marked completed
        // 4 - not marked pending
        // 5 - is the only reference of the context
        // 6 - is not waiting for request body
        // 7 - did not call sendfile
        ctx_log!(
            "RequestContext(0x{:x}).shouldRenderMissing {} {} {} {} {} {} {}",
            self as *const _ as usize,
            if self.resp.is_some() { "has response" } else { "no response" },
            if self.flags.aborted() { "aborted" } else { "not aborted" },
            if self.flags.has_marked_complete() { "marked complete" } else { "not marked complete" },
            if self.flags.has_marked_pending() { "marked pending" } else { "not marked pending" },
            if self.ref_count == 1 { "only reference" } else { "not only reference" },
            if self.flags.is_waiting_for_request_body() { "waiting for request body" } else { "not waiting for request body" },
            if self.flags.has_sendfile_ctx() { "has sendfile context" } else { "no sendfile context" },
        );
        self.resp.is_some()
            && !self.flags.aborted()
            && !self.flags.has_marked_complete()
            && !self.flags.has_marked_pending()
            && self.ref_count == 1
            && !self.flags.is_waiting_for_request_body()
            && !self.flags.has_sendfile_ctx()
    }

    pub fn is_dead_request(&self) -> bool {
        // check if has pending promise or extra reference (aka not the only reference)
        if self.ref_count > 1 {
            return false;
        }
        // check if the body is Locked (streaming)
        if let Some(body) = &self.request_body {
            if matches!(body.value, Body::Value::Locked(_)) {
                return false;
            }
        }

        true
    }

    /// destroy RequestContext, should be only called by deref or if defer_deinit_until_callback_completes is ref is set to true
    // TODO(port): named `deinit` (not Drop) because RequestContext is pool-allocated and
    // explicitly returned to a HiveArray; Drop semantics don't apply.
    pub fn deinit(&mut self) {
        ctx_log!("deinit");
        self.detach_response();
        self.end_request_streaming_and_drain();
        // TODO: has_marked_complete is doing something?
        self.flags.set_has_marked_complete(true);

        if let Some(defer_deinit) = self.defer_deinit_until_callback_completes {
            // SAFETY: caller stack local, valid while set
            unsafe { *defer_deinit = true };
            ctx_log!("deferred deinit <d> ({:p})<r>", self);
            return;
        }

        ctx_log!("deinit<d> ({:p})<r>", self);
        if cfg!(debug_assertions) {
            debug_assert!(self.flags.has_finalized());
        }

        self.request_body_buf = Vec::new();
        self.response_buf_owned = Vec::new();
        self.response_weakref.deref();

        if let Some(body) = self.request_body.take() {
            drop(body); // unref
        }

        if let Some(cb) = self.additional_on_abort.take() {
            cb.deref();
        }

        if let Some(server) = self.server.take() {
            // SAFETY: BACKREF; pool put + onRequestComplete
            unsafe {
                if HTTP3 {
                    (*server).h3_request_pool_allocator().put(self);
                } else {
                    (*server).request_pool_allocator().put(self);
                }
                (*server).on_request_complete();
            }
        }
    }

    pub fn deref(&mut self) {
        stream_log!("deref {} -> {}", self.ref_count, self.ref_count - 1);
        debug_assert!(self.ref_count > 0);
        let ref_count = self.ref_count;
        self.ref_count -= 1;
        if ref_count == 1 {
            self.finalize_without_deinit();
            self.deinit();
        }
    }

    pub fn ref_(&mut self) {
        stream_log!("ref {} -> {}", self.ref_count, self.ref_count + 1);
        self.ref_count += 1;
    }

    #[bun_jsc::host_fn]
    pub fn on_reject(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        ctx_log!("onReject");

        let arguments = callframe.arguments_old(2);
        let Some(ctx) = NativePromiseContext::take::<Self>(arguments.ptr[1]) else {
            // The cell's destructor already released the ref (the Promise
            // was collected before a prior microtask turn reached us).
            return Ok(JSValue::UNDEFINED);
        };
        let _guard = scopeguard::guard((), |_| ctx.deref());

        let err = arguments.ptr[0];
        Self::handle_reject(
            ctx,
            if !err.is_empty_or_undefined_or_null() { err } else { JSValue::UNDEFINED },
        );
        Ok(JSValue::UNDEFINED)
    }

    fn handle_reject(ctx: &mut Self, value: JSValue) {
        if ctx.is_aborted_or_ended() {
            return;
        }

        let resp = ctx.resp.unwrap();
        // SAFETY: FFI handle, just checked Some
        let has_responded = unsafe { (*resp).has_responded() };
        if !has_responded {
            let original_state = ctx.defer_deinit_until_callback_completes;
            let mut should_deinit_context = match original_state {
                // SAFETY: defer_deinit is a caller stack local valid while set
                Some(defer_deinit) => unsafe { *defer_deinit },
                None => false,
            };
            ctx.defer_deinit_until_callback_completes = Some(&mut should_deinit_context);
            ctx.run_error_handler(value);
            ctx.defer_deinit_until_callback_completes = original_state;
            // we try to deinit inside runErrorHandler so we just return here and let it deinit
            if should_deinit_context {
                ctx.deinit();
                return;
            }
        }
        // check again in case it get aborted after runErrorHandler
        if ctx.is_aborted_or_ended() {
            return;
        }

        // I don't think this case happens?
        if ctx.did_upgrade_web_socket() {
            return;
        }

        // SAFETY: FFI handle
        if unsafe { !(*resp).has_responded() }
            && !ctx.flags.has_marked_pending()
            && !ctx.flags.is_error_promise_pending()
        {
            ctx.render_missing();
            return;
        }
    }

    pub fn render_missing(&mut self) {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            unsafe { (*resp).run_corked_with_type(Self::render_missing_corked, self) };
        }
    }

    pub fn render_missing_corked(ctx: &mut Self) {
        if let Some(resp) = ctx.resp {
            // SAFETY: FFI handle
            let resp = unsafe { &mut *resp };
            if !DEBUG_MODE {
                if !ctx.flags.has_written_status() {
                    resp.write_status(b"204 No Content");
                }
                ctx.flags.set_has_written_status(true);
                ctx.end(b"", ctx.should_close_connection());
                return;
            }
            // avoid writing the status again and mismatching the content-length
            if ctx.flags.has_written_status() {
                ctx.end(b"", ctx.should_close_connection());
                return;
            }

            if ctx.flags.is_web_browser_navigation() {
                resp.write_status(b"200 OK");
                ctx.flags.set_has_written_status(true);

                resp.write_header(b"content-type", MimeType::HTML.value);
                resp.write_header(b"content-encoding", b"gzip");
                resp.write_header_int(b"content-length", WELCOME_PAGE_HTML_GZ.len() as u64);
                ctx.end(WELCOME_PAGE_HTML_GZ, ctx.should_close_connection());
                return;
            }
            const MISSING_CONTENT: &[u8] =
                b"Welcome to Bun! To get started, return a Response object.";
            resp.write_status(b"200 OK");
            resp.write_header(b"content-type", MimeType::TEXT.value);
            resp.write_header_int(b"content-length", MISSING_CONTENT.len() as u64);
            ctx.flags.set_has_written_status(true);
            ctx.end(MISSING_CONTENT, ctx.should_close_connection());
        }
    }

    pub fn render_default_error(
        &mut self,
        // TODO(port): arena_allocator param dropped; this is a non-AST crate, allocations use global mimalloc.
        // PERF(port): was arena bulk-free — profile in Phase B
        log: &mut logger::Log,
        err: bun_core::Error,
        exceptions: &[Api::JsException],
        fmt: core::fmt::Arguments<'_>, // TODO(port): Zig `comptime fmt: string, args: anytype`
    ) {
        if !self.flags.has_written_status() {
            self.flags.set_has_written_status(true);
            if let Some(resp) = self.resp {
                // SAFETY: FFI handle
                unsafe {
                    (*resp).write_status(b"500 Internal Server Error");
                    (*resp).write_header(b"content-type", MimeType::HTML.value);
                }
            }
        }

        let mut message: Vec<u8> = Vec::new();
        let _ = write!(&mut message, "{}", Output::pretty_fmt(fmt, false));
        let fallback_container = Box::new(Api::FallbackMessageContainer {
            message: message.into_boxed_slice(),
            router: None,
            reason: Api::FallbackReason::FetchEventHandler,
            cwd: VirtualMachine::get().transpiler.fs.top_level_dir.clone(),
            problems: Api::Problems {
                // TODO(port): @intFromError(err) — bun_core::Error is NonZeroU16
                code: err.code() as u16,
                name: err.name(),
                exceptions: exceptions.to_vec(),
                build: log.to_api().expect("unreachable"),
            },
        });

        // TODO(port): `if (comptime fmt.len > 0)` — fmt::Arguments has no const len; always print.
        Output::pretty_errorln(fmt);
        Output::flush();

        // Explicitly use the global allocator and *not* the arena
        let mut bb: Vec<u8> = Vec::new();

        Fallback::render_backend(&fallback_container, &mut bb).expect("unreachable");
        let try_end_ok = match self.resp {
            None => true,
            Some(resp) => unsafe {
                // SAFETY: FFI handle
                (*resp).try_end(&bb, bb.len(), self.should_close_connection())
            },
        };
        if try_end_ok {
            drop(bb);
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.finalize_without_deinit();
            self.deref();
            return;
        }

        self.flags.set_has_marked_pending(true);
        self.response_buf_owned = bb;

        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            unsafe { (*resp).on_writable(Self::on_writable_complete_response_buffer, self) };
        }
    }

    pub fn render_response_buffer(&mut self) {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            unsafe { (*resp).on_writable(Self::on_writable_response_buffer, self) };
        }
    }

    /// Drain a partial response buffer
    pub fn drain_response_buffer_and_metadata(&mut self) {
        if let Some(resp) = self.resp {
            self.render_metadata();

            // SAFETY: FFI handle
            unsafe { (*resp).write(&self.response_buf_owned) };
        }
        self.response_buf_owned.clear();
    }

    pub fn end(&mut self, data: &[u8], close_connection: bool) {
        ctx_log!("end");
        if let Some(resp) = self.resp {
            // SAFETY: self outlives the guard; deref runs on the same thread before pool put
            let _guard = scopeguard::guard(self as *mut Self, |s| unsafe { (*s).deref() });

            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            unsafe { (*resp).end(data, close_connection) };
        }
    }

    pub fn end_stream(&mut self, close_connection: bool) {
        ctx_log!("endStream");
        if let Some(resp) = self.resp {
            // SAFETY: self outlives the guard; deref runs on the same thread before pool put
            let _guard = scopeguard::guard(self as *mut Self, |s| unsafe { (*s).deref() });

            self.detach_response();
            self.end_request_streaming_and_drain();
            // This will send a terminating 0\r\n\r\n chunk to the client
            // We only want to do that if they're still expecting a body
            // We cannot call this function if the Content-Length header was previously set
            // SAFETY: FFI handle
            unsafe {
                if (*resp).state().is_response_pending() {
                    (*resp).end_stream(close_connection);
                }
            }
        }
    }

    pub fn end_without_body(&mut self, close_connection: bool) {
        ctx_log!("endWithoutBody");
        if let Some(resp) = self.resp {
            // SAFETY: self outlives the guard; deref runs on the same thread before pool put
            let _guard = scopeguard::guard(self as *mut Self, |s| unsafe { (*s).deref() });

            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            unsafe { (*resp).end_without_body(close_connection) };
        }
    }

    pub fn force_close(&mut self) {
        if let Some(resp) = self.resp {
            // SAFETY: self outlives the guard; deref runs on the same thread before pool put
            let _guard = scopeguard::guard(self as *mut Self, |s| unsafe { (*s).deref() });
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            unsafe { (*resp).force_close() };
        }
    }

    pub fn on_writable_response_buffer(
        this: &mut Self,
        _write_offset: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        ctx_log!("onWritableResponseBuffer");

        debug_assert!(this.resp == Some(resp));
        if this.is_aborted_or_ended() {
            return false;
        }
        this.end(b"", this.should_close_connection());
        false
    }

    // TODO: should we cork?
    pub fn on_writable_complete_response_buffer_and_metadata(
        this: &mut Self,
        write_offset: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBufferAndMetadata");
        debug_assert!(this.resp == Some(resp));

        if this.is_aborted_or_ended() {
            return false;
        }

        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        if this.method == Method::HEAD {
            this.end_without_body(this.should_close_connection());
            return false;
        }

        // PORT NOTE: reshaped for borrowck — pass raw ptr to slice to avoid overlapping &mut
        let items = this.response_buf_owned.as_slice() as *const [u8];
        // SAFETY: response_buf_owned not mutated until after the call
        this.send_writable_bytes_for_complete_response_buffer(unsafe { &*items }, write_offset, resp)
    }

    pub fn on_writable_complete_response_buffer(
        this: &mut Self,
        write_offset: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        ctx_log!("onWritableCompleteResponseBuffer");
        debug_assert!(this.resp == Some(resp));
        if this.is_aborted_or_ended() {
            return false;
        }
        let items = this.response_buf_owned.as_slice() as *const [u8];
        // SAFETY: response_buf_owned not mutated until after the call
        this.send_writable_bytes_for_complete_response_buffer(unsafe { &*items }, write_offset, resp)
    }

    #[inline]
    fn any_response(r: *mut Resp<SSL_ENABLED, HTTP3>) -> uws::AnyResponse {
        if HTTP3 {
            uws::AnyResponse::H3(r)
        } else if SSL_ENABLED {
            uws::AnyResponse::SSL(r)
        } else {
            uws::AnyResponse::TCP(r)
        }
    }

    // TODO(port): in-place init — `this` is a pre-allocated slot in a HiveArray pool.
    pub fn create(
        this: &mut core::mem::MaybeUninit<Self>,
        server: *const ThisServer,
        req: *mut Req<SSL_ENABLED, HTTP3>,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
        should_deinit_context: Option<*mut bool>,
        method: Option<HTTP::Method>,
    ) {
        // SAFETY: req is a valid uWS request handle for the duration of the callback
        let resolved_method = method
            .or_else(|| HTTP::Method::which(unsafe { (*req).method() }))
            .unwrap_or(HTTP::Method::GET);
        // SAFETY: writing to MaybeUninit slot
        unsafe {
            this.as_mut_ptr().write(Self {
                resp: Some(resp),
                req: Some(req),
                method: resolved_method,
                server: Some(server),
                defer_deinit_until_callback_completes: should_deinit_context,
                range: RangeRequest::raw_from_request(if HTTP3 {
                    RangeRequest::ReqRef::H3(req)
                } else {
                    RangeRequest::ReqRef::H1(req)
                }),
                request_weakref: Request::WeakRef::EMPTY,
                signal: None,
                cookies: None,
                flags: Flags::<DEBUG_MODE>::default(),
                upgrade_context: None,
                response_jsvalue: JSValue::ZERO,
                ref_count: 1,
                response_weakref: Response::WeakRef::EMPTY,
                blob: WebCore::Blob::Any::Blob(Blob::default()),
                // SAFETY: SendfileContext is POD; matches Zig `= undefined`
                sendfile: unsafe { core::mem::zeroed() },
                request_body_readable_stream_ref: WebCore::ReadableStream::Strong::default(),
                request_body: None,
                request_body_buf: Vec::new(),
                request_body_content_len: 0,
                sink: None,
                byte_stream: None,
                response_body_readable_stream_ref: WebCore::ReadableStream::Strong::default(),
                pathname: BunString::empty(),
                response_buf_owned: Vec::new(),
                additional_on_abort: None,
            });
        }

        ctx_log!("create<d> ({:p})<r>", this.as_ptr());
    }

    pub fn on_timeout(this: &mut Self, resp: *mut Resp<SSL_ENABLED, HTTP3>) {
        debug_assert!(this.resp == Some(resp));
        debug_assert!(this.server.is_some());

        let mut any_js_calls = false;
        // SAFETY: BACKREF, just asserted Some
        let server = unsafe { &*this.server.unwrap() };
        let vm = server.vm();
        let global_this = server.global_this();
        let _guard = scopeguard::guard((), |_| {
            // This is a task in the event loop.
            // If we called into JavaScript, we must drain the microtask queue
            if any_js_calls {
                vm.drain_microtasks();
            }
        });

        if let Some(request) = this.request_weakref.get() {
            if request
                .internal_event_callback
                .trigger(Request::InternalJSEventCallback::EventType::Timeout, global_this)
            {
                any_js_calls = true;
            }
        }
    }

    pub fn on_abort(this: &mut Self, resp: *mut Resp<SSL_ENABLED, HTTP3>) {
        ctx_log!("onAbort");
        debug_assert!(this.resp == Some(resp));
        // An HTTP/3 stream is destroyed once both sides FIN, so this also
        // fires after a successful end(). HTTP/1 sockets persist for
        // keep-alive, so the equivalent never happens there. Drop the
        // pointer; everything else cleans up via the resolve/reject path.
        if HTTP3 {
            // SAFETY: FFI handle
            if unsafe { (*resp).has_responded() } {
                this.resp = None;
                this.flags.set_has_abort_handler(false);
                return;
            }
        }
        debug_assert!(!this.flags.aborted());
        debug_assert!(this.server.is_some());
        // mark request as aborted
        this.flags.set_aborted(true);
        if let Some(abort) = this.additional_on_abort.take() {
            (abort.cb)(abort.data.as_ptr());
            abort.deref();
        }

        this.detach_response();
        let mut any_js_calls = false;
        // SAFETY: BACKREF, just asserted Some
        let server = unsafe { &*this.server.unwrap() };
        let vm = server.vm();
        let global_this = server.global_this();
        // PORT NOTE: reshaped for borrowck — defer block captures `this` and `any_js_calls`
        let this_ptr = this as *mut Self;
        let _guard = scopeguard::guard((), |_| {
            // This is a task in the event loop.
            // If we called into JavaScript, we must drain the microtask queue
            if any_js_calls {
                vm.drain_microtasks();
            }
            // SAFETY: this outlives the guard
            unsafe { (*this_ptr).deref() };
        });

        if let Some(request) = this.request_weakref.get() {
            request.request_context = AnyRequestContext::NULL;
            if request
                .internal_event_callback
                .trigger(Request::InternalJSEventCallback::EventType::Abort, global_this)
            {
                any_js_calls = true;
            }
            // we can already clean this strong refs
            request.internal_event_callback.deinit();
            this.request_weakref.deref();
        }
        // if signal is not aborted, abort the signal
        if let Some(signal) = this.signal.take() {
            if !signal.aborted() {
                signal.signal(global_this, jsc::CommonAbortReason::ConnectionClosed);
                any_js_calls = true;
            }
            signal.pending_activity_unref();
            drop(signal); // unref
        }

        // if have sink, call onAborted on sink
        if let Some(wrapper) = &mut this.sink {
            wrapper.sink.abort();
            return;
        }

        // if we can, free the request now.
        if this.is_dead_request() {
            this.finalize_without_deinit();
        } else {
            if this.end_request_streaming().unwrap_or(true) {
                // TODO: properly propagate exception upwards
                any_js_calls = true;
            }

            if let Some(response) = this.response_weakref.get() {
                if let Some(stream) = response.get_body_readable_stream(global_this) {
                    let _keep = jsc::EnsureStillAlive(stream.value);
                    response.detach_readable_stream(global_this);
                    stream.abort(global_this);
                    any_js_calls = true;
                }
            }
        }
    }

    // This function may be called multiple times
    // so it's important that we can safely do that
    pub fn finalize_without_deinit(&mut self) {
        ctx_log!("finalizeWithoutDeinit<d> ({:p})<r>", self);
        self.blob.detach();
        debug_assert!(self.server.is_some());
        // SAFETY: BACKREF
        let global_this = unsafe { (*self.server.unwrap()).global_this() };

        #[cfg(debug_assertions)]
        {
            ctx_log!("finalizeWithoutDeinit: has_finalized {}", self.flags.has_finalized());
            self.flags.set_has_finalized(true);
        }

        if !self.response_jsvalue.is_empty() {
            ctx_log!("finalizeWithoutDeinit: response_jsvalue != .zero");
            if self.flags.response_protected() {
                self.response_jsvalue.unprotect();
                self.flags.set_response_protected(false);
            }
            self.response_jsvalue = JSValue::ZERO;
        }
        self.response_weakref.deref();

        self.request_body_readable_stream_ref.deinit();

        if let Some(cookies) = self.cookies.take() {
            drop(cookies); // deref
        }

        if let Some(request) = self.request_weakref.get() {
            request.request_context = AnyRequestContext::NULL;
            // we can already clean this strong refs
            request.internal_event_callback.deinit();
            self.request_weakref.deref();
        }

        // if signal is not aborted, abort the signal
        if let Some(signal) = self.signal.take() {
            if self.flags.aborted() && !signal.aborted() {
                signal.signal(global_this, jsc::CommonAbortReason::ConnectionClosed);
            }
            signal.pending_activity_unref();
            drop(signal); // unref
        }

        // Case 1:
        // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
        // but we received nothing or the connection was aborted
        // the promise is pending
        // Case 2:
        // User ignored the body and the connection was aborted or ended
        // Case 3:
        // Stream was not consumed and the connection was aborted or ended
        let _ = self.end_request_streaming(); // TODO: properly propagate exception upwards

        if let Some(stream) = self.byte_stream.take() {
            ctx_log!("finalizeWithoutDeinit: stream != null");
            // SAFETY: kept alive by response_body_readable_stream_ref (BORROW_FIELD)
            unsafe { stream.as_ref().unpipe_without_deref() };
        }

        self.response_body_readable_stream_ref.deinit();

        if !self.pathname.is_empty() {
            self.pathname.deref();
            self.pathname = BunString::empty();
        }
    }

    fn on_file_stream_complete(ctx: *mut c_void, _resp: uws::AnyResponse) {
        // SAFETY: ctx is a *RequestContext registered with FileResponseStream
        let this: &mut Self = unsafe { &mut *(ctx as *mut Self) };
        this.detach_response();
        this.end_request_streaming_and_drain();
        this.deref();
    }

    fn on_file_stream_abort(ctx: *mut c_void, resp: uws::AnyResponse) {
        // SAFETY: ctx is a *RequestContext registered with FileResponseStream
        let this: &mut Self = unsafe { &mut *(ctx as *mut Self) };
        // Route through the real onAbort so flags.aborted, request.signal,
        // and additional_on_abort fire exactly as they did pre-consolidation.
        let r = if HTTP3 {
            resp.h3()
        } else if SSL_ENABLED {
            resp.ssl()
        } else {
            resp.tcp()
        };
        Self::on_abort(this, r);
    }

    fn on_file_stream_error(ctx: *mut c_void, resp: uws::AnyResponse, _err: bun_sys::Error) {
        // FileResponseStream already force-closed the socket; just clean up.
        Self::on_file_stream_complete(ctx, resp);
    }

    pub fn on_writable_bytes(
        this: &mut Self,
        write_offset: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        ctx_log!("onWritableBytes");
        debug_assert!(this.resp == Some(resp));
        if this.is_aborted_or_ended() {
            return false;
        }

        // Copy to stack memory to prevent aliasing issues in release builds
        let blob = this.blob;
        let bytes = blob.slice();

        let _ = this.send_writable_bytes_for_blob(bytes, write_offset, resp);
        true
    }

    pub fn send_writable_bytes_for_blob(
        &mut self,
        bytes_: &[u8],
        write_offset_: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        debug_assert!(self.resp == Some(resp));
        let write_offset: usize = write_offset_ as usize;

        let bytes = &bytes_[bytes_.len().min(write_offset)..];
        // SAFETY: FFI handle
        if unsafe { (*resp).try_end(bytes, bytes_.len(), self.should_close_connection()) } {
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.deref();
            true
        } else {
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            unsafe { (*resp).on_writable(Self::on_writable_bytes, self) };
            true
        }
    }

    pub fn send_writable_bytes_for_complete_response_buffer(
        &mut self,
        bytes_: &[u8],
        write_offset_: u64,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
    ) -> bool {
        let write_offset: usize = write_offset_ as usize;
        debug_assert!(self.resp == Some(resp));

        let bytes = &bytes_[bytes_.len().min(write_offset)..];
        // SAFETY: FFI handle
        if unsafe { (*resp).try_end(bytes, bytes_.len(), self.should_close_connection()) } {
            self.response_buf_owned.clear();
            self.detach_response();
            self.end_request_streaming_and_drain();
            self.deref();
        } else {
            self.flags.set_has_marked_pending(true);
            // SAFETY: FFI handle
            unsafe { (*resp).on_writable(Self::on_writable_complete_response_buffer, self) };
        }

        true
    }

    pub fn do_sendfile(&mut self, blob: Blob) {
        if self.is_aborted_or_ended() {
            return;
        }
        if self.flags.has_sendfile_ctx() {
            return;
        }

        if self.resp.is_none() || self.server.is_none() {
            return;
        }
        // SAFETY: BACKREF
        let global_this = unsafe { (*self.server.unwrap()).global_this() };
        let resp = self.resp.unwrap();

        self.blob = WebCore::Blob::Any::Blob(blob);
        let file = &self.blob.store().unwrap().data.file;
        let mut file_buf = PathBuffer::uninit();
        let auto_close = !matches!(file.pathlike, WebCore::PathLike::Fd(_));
        let fd: bun_sys::Fd = if !auto_close {
            file.pathlike.fd()
        } else {
            match bun_sys::open(
                file.pathlike.path().slice_z(&mut file_buf),
                bun_sys::O::RDONLY | bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC,
                0,
            ) {
                bun_sys::Result::Ok(fd_) => fd_,
                bun_sys::Result::Err(err) => {
                    let Ok(js_err) =
                        err.with_path(file.pathlike.path().slice()).to_js(global_this)
                    else {
                        return self.render_production_error(500);
                    };
                    return self.run_error_handler(js_err);
                }
            }
        };

        let stat: bun_sys::Stat = match bun_sys::fstat(fd) {
            bun_sys::Result::Ok(s) => s,
            bun_sys::Result::Err(err) => {
                if auto_close {
                    fd.close();
                }
                let Ok(js_err) = err.with_path_like(&file.pathlike).to_js(global_this) else {
                    return self.render_production_error(500);
                };
                return self.run_error_handler(js_err);
            }
        };

        let is_regular = bun_sys::is_regular_file(stat.mode);
        let (file_type, pollable): (bun_io::FileType, bool) = 'brk: {
            let mode = i64::try_from(stat.mode).unwrap();
            if bun_sys::S::isfifo(mode) || bun_sys::S::ischr(mode) {
                break 'brk (bun_io::FileType::Pipe, true);
            }
            if bun_sys::S::issock(mode) {
                break 'brk (bun_io::FileType::Socket, true);
            }
            if bun_sys::S::isdir(mode) {
                if auto_close {
                    fd.close();
                }
                let mut sys = bun_sys::Error {
                    errno: bun_sys::E::ISDIR as _,
                    syscall: bun_sys::Syscall::Read,
                    ..Default::default()
                }
                .with_path_like(&file.pathlike)
                .to_system_error();
                sys.message = BunString::static_("Cannot stream a directory as a response body");
                return self.run_error_handler(sys.to_error_instance(global_this));
            }
            (bun_io::FileType::File, false)
        };

        let original_size = match &self.blob {
            WebCore::Blob::Any::Blob(b) => b.size,
            _ => unreachable!(),
        };
        let stat_size: Blob::SizeType =
            Blob::SizeType::try_from(stat.size.max(0)).unwrap();
        if let WebCore::Blob::Any::Blob(b) = &mut self.blob {
            b.size = if is_regular { stat_size } else { original_size.min(stat_size) };
        }

        self.flags.set_needs_content_length(true);
        let blob_offset = match &self.blob {
            WebCore::Blob::Any::Blob(b) => b.offset,
            _ => unreachable!(),
        };
        self.sendfile = SendfileContext {
            remain: blob_offset + original_size,
            offset: blob_offset,
            total: 0,
        };
        if is_regular && auto_close {
            self.flags.set_needs_content_range(
                self.sendfile.remain.saturating_sub(self.sendfile.offset) != stat_size,
            );
        }
        if is_regular {
            self.sendfile.offset = self.sendfile.offset.min(stat_size);
            self.sendfile.remain = self
                .sendfile
                .remain
                .max(self.sendfile.offset)
                .min(stat_size)
                .saturating_sub(self.sendfile.offset);
        }

        // Honor an incoming Range: header for whole-file responses. We
        // don't compose Range with a user-supplied .slice() because the
        // Content-Range arithmetic gets ambiguous; the slice path keeps
        // its existing slice-as-range behavior. `offset == 0` alone is
        // insufficient — `Bun.file(p).slice(0, n)` has offset 0 — so we
        // also check the size: an unsliced blob has either the unset-size
        // sentinel or, if JS already read `.size`, the stat'd size; a
        // `.slice(0, n)` blob has `n < stat_size`. Skip if the user
        // already set Content-Range or a non-200 status — they're
        // managing partial responses themselves.
        let user_handles_range = if let Some(r) = self.response_weakref.get() {
            r.status_code() != 200
                || r.get_init_headers()
                    .map(|h| h.fast_has(FetchHeaders::Name::ContentRange))
                    .unwrap_or(false)
        } else {
            false
        };
        let is_whole_file =
            blob_offset == 0 && (original_size == Blob::MAX_SIZE || original_size == stat_size);
        // RFC 9110 §14.2: Range is only defined for GET (HEAD mirrors GET's headers).
        let method_allows_range = self.method == Method::GET || self.method == Method::HEAD;
        if is_regular
            && method_allows_range
            && !user_handles_range
            && is_whole_file
            && self.range != RangeRequest::Raw::None
        {
            match self.range.resolve(stat_size) {
                RangeRequest::Resolved::None => {}
                RangeRequest::Resolved::Satisfiable(r) => {
                    self.sendfile.offset = Blob::SizeType::try_from(r.start).unwrap();
                    self.sendfile.remain = Blob::SizeType::try_from(r.end - r.start + 1).unwrap();
                    self.sendfile.total = stat_size;
                    self.flags.set_needs_content_range(true);
                }
                RangeRequest::Resolved::Unsatisfiable => {
                    if auto_close {
                        fd.close();
                    }
                    let mut crbuf = [0u8; 64];
                    self.do_write_status(416);
                    if let Some(response) = self.response_weakref.get() {
                        if let Some(headers_) = response.swap_init_headers() {
                            self.do_write_headers(&headers_);
                            headers_.deref();
                        }
                    }
                    let cr = {
                        let mut w = &mut crbuf[..];
                        let _ = write!(w, "bytes */{}", stat_size);
                        let written = 64 - w.len();
                        &crbuf[..written]
                    };
                    // SAFETY: FFI handle
                    unsafe {
                        (*resp).write_header(b"content-range", cr);
                        (*resp).write_header(b"accept-ranges", b"bytes");
                        let close = (*resp).should_close_connection();
                        self.detach_response();
                        self.end_request_streaming_and_drain();
                        (*resp).end(b"", close);
                    }
                    self.deref();
                    return;
                }
            }
        }

        // SAFETY: FFI handle
        unsafe { (*resp).run_corked_with_type(Self::render_metadata, self) };

        if (is_regular && self.sendfile.remain == 0) || !self.method.has_body() {
            if auto_close {
                fd.close();
            }
            // SAFETY: FFI handle
            let close = unsafe { (*resp).should_close_connection() };
            self.detach_response();
            self.end_request_streaming_and_drain();
            // SAFETY: FFI handle
            unsafe { (*resp).end(b"", close) };
            self.deref();
            return;
        }

        // FileResponseStream registers its own onAborted/onWritable with itself
        // as userData. uWS keeps a single shared userData slot per response, so
        // any later setAbortHandler()/onWritable() from this RequestContext would
        // stomp it and hand FileResponseStream's callbacks a *RequestContext.
        self.flags.set_has_sendfile_ctx(true);
        self.flags.set_has_abort_handler(true);
        self.flags.set_has_marked_pending(true);

        // SAFETY: BACKREF
        let server = unsafe { &*self.server.unwrap() };
        FileResponseStream::start(FileResponseStream::Options {
            fd,
            auto_close,
            resp: Self::any_response(resp),
            vm: server.vm(),
            file_type,
            pollable,
            offset: self.sendfile.offset,
            length: if is_regular { Some(self.sendfile.remain as u64) } else { None },
            idle_timeout: server.config().idle_timeout,
            ctx: self as *mut Self as *mut c_void,
            on_complete: Self::on_file_stream_complete,
            on_abort: Self::on_file_stream_abort,
            on_error: Self::on_file_stream_error,
        });
    }

    pub fn do_render_with_body_locked(this: *mut c_void, value: &mut WebCore::Body::Value) {
        // SAFETY: this is a *RequestContext registered as lock.task
        Self::do_render_with_body(unsafe { &mut *(this as *mut Self) }, value, None);
    }

    fn render_with_blob_from_body_value(&mut self) {
        if self.is_aborted_or_ended() {
            return;
        }

        if self.blob.needs_to_read_file() {
            if !self.flags.has_sendfile_ctx() {
                if let WebCore::Blob::Any::Blob(b) = self.blob {
                    self.do_sendfile(b);
                }
            }
            return;
        }

        self.do_render_blob();
    }

    fn handle_first_stream_write(this: &mut Self) {
        if !this.flags.has_written_status() {
            this.render_metadata();
        }
    }

    fn do_render_stream(pair: &mut StreamPair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>) {
        ctx_log!("doRenderStream");
        let this = pair.this;
        let stream = pair.stream;
        debug_assert!(this.server.is_some());
        // SAFETY: BACKREF
        let global_this = unsafe { (*this.server.unwrap()).global_this() };

        if this.is_aborted_or_ended() {
            stream.cancel(global_this);
            this.response_body_readable_stream_ref.deinit();
            return;
        }
        let resp = this.resp.unwrap();

        stream.value.ensure_still_alive();

        let mut response_stream = Box::new(ResponseStreamJSSink::<SSL_ENABLED, HTTP3> {
            sink: ResponseStream::<SSL_ENABLED, HTTP3>::Sink {
                res: resp,
                buffer: ByteList::default(),
                on_first_write: Some(Self::handle_first_stream_write as *const _),
                ctx: this as *mut Self as *mut c_void,
                global_this,
                ..Default::default()
            },
        });
        let signal = &mut response_stream.sink.signal;
        // PORT NOTE: reshaped for borrowck — keep raw ptr to the boxed sink so we can
        // move the Box into self.sink and still mutate through it.
        let response_stream_ptr: *mut ResponseStreamJSSink<SSL_ENABLED, HTTP3> =
            &mut *response_stream;
        this.sink = Some(response_stream);
        // SAFETY: response_stream_ptr is valid; Box is now owned by self.sink
        let response_stream = unsafe { &mut *response_stream_ptr };

        *signal = ResponseStream::<SSL_ENABLED, HTTP3>::JSSink::SinkSignal::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        debug_assert!(signal.is_dead());
        // we need to render metadata before assignToStream because the stream can call res.end
        // and this would auto write an 200 status
        if !this.flags.has_written_status() {
            this.render_metadata();
        }

        // We are already corked!
        let assignment_result: JSValue = ResponseStream::<SSL_ENABLED, HTTP3>::JSSink::assign_to_stream(
            global_this,
            stream.value,
            response_stream,
            &mut signal.ptr as *mut _ as *mut *mut c_void,
        );

        assignment_result.ensure_still_alive();

        // assert that it was updated
        debug_assert!(!signal.is_dead());

        #[cfg(debug_assertions)]
        {
            // SAFETY: FFI handle
            if unsafe { (*resp).has_responded() } {
                stream_log!("responded");
            }
        }

        this.flags.set_aborted(this.flags.aborted() || response_stream.sink.aborted);

        if let Some(err_value) = assignment_result.to_error() {
            stream_log!("returned an error");
            response_stream.detach(global_this);
            this.sink = None; // sink.destroy() — Box drops
            return this.handle_reject(err_value);
        }

        // SAFETY: FFI handle
        if unsafe { (*resp).has_responded() } {
            stream_log!("done");
            response_stream.detach(global_this);
            this.sink = None; // sink.destroy() — Box drops
            stream.done(global_this);
            this.response_body_readable_stream_ref.deinit();
            this.end_stream(this.should_close_connection());
            return;
        }

        // A fully-synchronous ReadableStream can drain through writeBytes
        // and reach endFromJS() inside assignToStream(). If tryEnd() then
        // hits transport backpressure (common on QUIC right after the
        // HEADERS frame), the sink parks a pending_flush promise and
        // registers onWritable, but assignToStream() itself returns
        // undefined. Surface that promise here so the request waits for
        // the drain instead of falling through to the cancel path below.
        let mut effective_result = assignment_result;
        if effective_result.is_empty_or_undefined_or_null() {
            if let Some(flush) = response_stream.sink.pending_flush {
                effective_result = flush.to_js();
            }
        }

        if !effective_result.is_empty_or_undefined_or_null() {
            effective_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = effective_result.as_any_promise() {
                stream_log!("returned a promise");
                this.drain_microtasks();

                match promise.status() {
                    jsc::PromiseStatus::Pending => {
                        stream_log!("promise still Pending");
                        if !this.flags.has_written_status() {
                            response_stream.sink.on_first_write = None;
                            response_stream.sink.ctx = core::ptr::null_mut();
                            this.render_metadata();
                        }

                        // TODO: should this timeout?
                        let body_value = this.response_weakref.get().unwrap().get_body_value();
                        *body_value = Body::Value::Locked(Body::Locked {
                            readable: WebCore::ReadableStream::Strong::init(stream, global_this),
                            global: global_this,
                            ..Default::default()
                        });
                        this.ref_();
                        let cell = NativePromiseContext::create(global_this, this);
                        let _ = effective_result.then_with_value(
                            global_this,
                            cell,
                            Self::on_resolve_stream,
                            Self::on_reject_stream,
                        ); // TODO: properly propagate exception upwards
                        // the response_stream should be GC'd
                    }
                    jsc::PromiseStatus::Fulfilled => {
                        stream_log!("promise Fulfilled");
                        let mut response_body_readable_stream_ref =
                            core::mem::take(&mut this.response_body_readable_stream_ref);
                        let _guard = scopeguard::guard((), |_| {
                            stream.done(global_this);
                            response_body_readable_stream_ref.deinit();
                        });

                        this.handle_resolve_stream();
                    }
                    jsc::PromiseStatus::Rejected => {
                        stream_log!("promise Rejected");
                        let mut response_body_readable_stream_ref =
                            core::mem::take(&mut this.response_body_readable_stream_ref);
                        let _guard = scopeguard::guard((), |_| {
                            stream.cancel(global_this);
                            response_body_readable_stream_ref.deinit();
                        });
                        this.handle_reject_stream(global_this, promise.result(global_this.vm()));
                    }
                }
                return;
            } else {
                // if is not a promise we treat it as Error
                stream_log!("returned an error");
                response_stream.detach(global_this);
                this.sink = None; // sink.destroy() — Box drops
                return this.handle_reject(effective_result);
            }
        }

        if this.is_aborted_or_ended() {
            response_stream.detach(global_this);
            stream.cancel(global_this);
            let _guard =
                scopeguard::guard((), |_| this.response_body_readable_stream_ref.deinit());

            response_stream.sink.mark_done();
            response_stream.sink.on_first_write = None;

            response_stream.sink.finalize();
            this.sink = None; // sink.destroy() — Box drops
            return;
        }
        let mut response_body_readable_stream_ref =
            core::mem::take(&mut this.response_body_readable_stream_ref);
        let _guard = scopeguard::guard((), |_| response_body_readable_stream_ref.deinit());

        let is_in_progress = response_stream.sink.has_backpressure
            || !(response_stream.sink.wrote == 0 && response_stream.sink.buffer.len == 0);

        if !stream.is_locked(global_this) && !is_in_progress {
            // TODO: properly propagate exception upwards
            if let Ok(Some(comparator)) =
                WebCore::ReadableStream::from_js(stream.value, global_this)
            {
                if core::mem::discriminant(&comparator.ptr) == core::mem::discriminant(&stream.ptr)
                {
                    stream_log!("is not locked");
                    response_stream.sink.on_first_write = None;
                    response_stream.sink.ctx = core::ptr::null_mut();
                    response_stream.detach(global_this);
                    response_stream.sink.mark_done();
                    response_stream.sink.finalize();
                    this.sink = None; // sink.destroy() — Box drops
                    this.render_missing();
                    return;
                }
            }
        }

        stream_log!("is in progress, but did not return a Promise. Finalizing request context");
        response_stream.sink.on_first_write = None;
        response_stream.sink.ctx = core::ptr::null_mut();
        response_stream.detach(global_this);
        stream.cancel(global_this);
        response_stream.sink.mark_done();
        response_stream.sink.finalize();
        this.sink = None; // sink.destroy() — Box drops
        this.render_missing();
    }

    pub fn did_upgrade_web_socket(&self) -> bool {
        self.upgrade_context
            .map(|p| p as usize == usize::MAX)
            .unwrap_or(false)
    }

    fn to_async_without_abort_handler(&mut self, req: *mut Req<SSL_ENABLED, HTTP3>, request_object: &mut Request) {
        debug_assert!(self.server.is_some());

        // For HTTP/3, prepareJsRequestContextFor() already eagerly
        // populated url+headers (the lazy getRequest() path is H1-only),
        // so the guards below short-circuit and `req` is never read.
        if !HTTP3 {
            request_object.request_context.set_request(req);
        }

        if request_object.ensure_url().is_err() {
            request_object.url = BunString::empty();
        }

        // we have to clone the request headers here since they will soon belong to a different request
        if !request_object.has_fetch_headers() {
            if !HTTP3 {
                request_object.set_fetch_headers(FetchHeaders::create_from_uws(req));
            }
        }

        // This object dies after the stack frame is popped
        // so we have to clear it in here too
        request_object.request_context.detach_request();
    }

    pub fn to_async(&mut self, req: *mut Req<SSL_ENABLED, HTTP3>, request_object: &mut Request) {
        ctx_log!("toAsync");
        self.to_async_without_abort_handler(req, request_object);
        if DEBUG_MODE {
            self.pathname = request_object.url.clone();
        }
        self.set_abort_handler();
    }

    fn end_request_streaming_and_drain(&mut self) {
        debug_assert!(self.server.is_some());

        if self.end_request_streaming().unwrap_or(true) {
            // TODO: properly propagate exception upwards
            // SAFETY: BACKREF
            unsafe { (*self.server.unwrap()).vm() }.drain_microtasks();
        }
    }

    fn end_request_streaming(&mut self) -> Result<bool, jsc::JsTerminated> {
        debug_assert!(self.server.is_some());

        self.request_body_buf = Vec::new();

        // if we cannot, we have to reject pending promises
        // first, we reject the request body promise
        if let Some(body) = &mut self.request_body {
            // User called .blob(), .json(), text(), or .arrayBuffer() on the Request object
            // but we received nothing or the connection was aborted
            if matches!(body.value, Body::Value::Locked(_)) {
                // SAFETY: BACKREF
                let global_this = unsafe { (*self.server.unwrap()).global_this() };
                body.value.to_error_instance(
                    Body::ValueError::AbortReason(jsc::CommonAbortReason::ConnectionClosed),
                    global_this,
                )?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn detach_response(&mut self) {
        self.request_body_buf = Vec::new();

        if let Some(resp) = self.resp.take() {
            // SAFETY: FFI handle
            unsafe {
                if self.flags.is_waiting_for_request_body() {
                    self.flags.set_is_waiting_for_request_body(false);
                    (*resp).clear_on_data();
                }
                if self.flags.has_abort_handler() {
                    (*resp).clear_aborted();
                    self.flags.set_has_abort_handler(false);
                }
                if self.flags.has_timeout_handler() {
                    (*resp).clear_timeout();
                    self.flags.set_has_timeout_handler(false);
                }
            }
        }
    }

    pub fn is_aborted_or_ended(&self) -> bool {
        // resp == null or aborted or server.stop(true)
        self.resp.is_none()
            || self.flags.aborted()
            || self.server.is_none()
            // SAFETY: BACKREF, just checked Some
            || unsafe { (*self.server.unwrap()).flags().terminated }
    }

    pub fn do_render_head_response_after_s3_size_resolved(
        pair: &mut HeaderResponseSizePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>,
    ) {
        let this = pair.this;
        this.render_metadata();

        if let Some(resp) = this.resp {
            // SAFETY: FFI handle
            unsafe { (*resp).write_header_int(b"content-length", pair.size as u64) };
        }
        this.end_without_body(this.should_close_connection());
        this.deref();
    }

    pub fn on_s3_size_resolved(result: S3::S3StatResult, this: &mut Self) {
        // SAFETY: this outlives the guard; deref runs on the same thread before pool put
        let _guard = scopeguard::guard(this as *mut Self, |t| unsafe { (*t).deref() });
        if let Some(resp) = this.resp {
            let size = match result {
                S3::S3StatResult::Failure(_) | S3::S3StatResult::NotFound => 0,
                S3::S3StatResult::Success(stat) => stat.size,
            };
            let mut pair = HeaderResponseSizePair { this, size };
            // SAFETY: FFI handle
            unsafe {
                (*resp).run_corked_with_type(
                    Self::do_render_head_response_after_s3_size_resolved,
                    &mut pair,
                )
            };
        }
    }

    fn do_render_head_response(
        pair: &mut HeaderResponsePair<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3>,
    ) {
        let this = pair.this;
        let response = pair.response;
        if this.resp.is_none() {
            return;
        }
        // we will render the content-length header later manually so we set this to false
        this.flags.set_needs_content_length(false);
        // Always this.renderMetadata() before sending the content-length or transfer-encoding header so status is sent first

        let resp = this.resp.unwrap();
        this.set_response(response);
        let Some(server) = this.server else {
            // server detached?
            this.render_metadata();
            // SAFETY: FFI handle
            unsafe { (*resp).write_header_int(b"content-length", 0) };
            this.end_without_body(this.should_close_connection());
            return;
        };
        // SAFETY: BACKREF
        let global_this = unsafe { (*server).global_this() };
        if let Some(headers) = response.get_fetch_headers() {
            // first respect the headers
            if !HTTP3 {
                if let Some(transfer_encoding) =
                    headers.fast_get(FetchHeaders::Name::TransferEncoding)
                {
                    // fastGet() borrows the header map's StringImpl; renderMetadata() ->
                    // doWriteHeaders() calls fastRemove(.TransferEncoding) and derefs the
                    // FetchHeaders, freeing that StringImpl before we write it. Clone so
                    // the bytes outlive renderMetadata().
                    let transfer_encoding_str = transfer_encoding.to_slice_clone();
                    this.render_metadata();
                    // SAFETY: FFI handle
                    unsafe {
                        (*resp).write_header(b"transfer-encoding", transfer_encoding_str.slice())
                    };
                    this.end_without_body(this.should_close_connection());
                    return;
                }
            }
            if let Some(content_length) = headers.fast_get(FetchHeaders::Name::ContentLength) {
                // Parse before renderMetadata(): doWriteHeaders() will fastRemove(.ContentLength)
                // and deref the FetchHeaders, freeing the borrowed StringImpl.
                let content_length_str = content_length.to_slice();
                let len: usize =
                    bun_str::strings::parse_int::<usize>(content_length_str.slice(), 10)
                        .unwrap_or(0);
                drop(content_length_str);

                this.render_metadata();
                // SAFETY: FFI handle
                unsafe { (*resp).write_header_int(b"content-length", len as u64) };
                this.end_without_body(this.should_close_connection());
                return;
            }
        }
        // not content-length or transfer-encoding so we need to respect the body
        let body_value = response.get_body_value();
        body_value.to_blob_if_possible();
        match body_value {
            Body::Value::InternalBlob(_) | Body::Value::WTFStringImpl(_) => {
                let mut blob = body_value.use_as_any_blob_allow_non_utf8_string();
                let size = blob.size();
                this.render_metadata();

                // SAFETY: FFI handle
                unsafe {
                    if size == Blob::MAX_SIZE {
                        (*resp).write_header_int(b"content-length", 0);
                    } else {
                        (*resp).write_header_int(b"content-length", size as u64);
                    }
                }
                this.end_without_body(this.should_close_connection());
                blob.detach();
            }

            Body::Value::Blob(blob) => {
                if blob.is_s3() {
                    // we need to read the size asynchronously
                    // in this case should always be a redirect so should not hit this path, but in case we change it in the future lets handle it
                    this.ref_();

                    let credentials = blob.store.as_ref().unwrap().data.s3.get_credentials();
                    let path = blob.store.as_ref().unwrap().data.s3.path();
                    let env = global_this.bun_vm().transpiler.env;

                    let _ = S3::stat(
                        credentials,
                        path,
                        Self::on_s3_size_resolved as *const _,
                        this as *mut Self as *mut c_void,
                        env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
                        blob.store.as_ref().unwrap().data.s3.request_payer,
                    ); // TODO: properly propagate exception upwards
                    return;
                }
                this.render_metadata();

                blob.resolve_size();
                // SAFETY: FFI handle
                unsafe {
                    if blob.size == Blob::MAX_SIZE {
                        (*resp).write_header_int(b"content-length", 0);
                    } else {
                        (*resp).write_header_int(b"content-length", blob.size as u64);
                    }
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Locked(_) => {
                this.render_metadata();
                if !HTTP3 {
                    // SAFETY: FFI handle
                    unsafe { (*resp).write_header(b"transfer-encoding", b"chunked") };
                }
                this.end_without_body(this.should_close_connection());
            }
            Body::Value::Used | Body::Value::Null | Body::Value::Empty | Body::Value::Error(_) => {
                this.render_metadata();
                // SAFETY: FFI handle
                unsafe { (*resp).write_header_int(b"content-length", 0) };
                this.end_without_body(this.should_close_connection());
            }
        }
    }

    // Each HTTP request or TCP socket connection is effectively a "task".
    //
    // However, unlike the regular task queue, we don't drain the microtask
    // queue at the end.
    //
    // Instead, we drain it multiple times, at the points that would
    // otherwise "halt" the Response from being rendered.
    //
    // - If you return a Promise, we drain the microtask queue once
    // - If you return a streaming Response, we drain the microtask queue (possibly the 2nd time this task!)
    pub fn on_response(
        ctx: &mut Self,
        this: &ThisServer,
        request_value: JSValue,
        response_value: JSValue,
    ) {
        request_value.ensure_still_alive();
        response_value.ensure_still_alive();
        ctx.drain_microtasks();

        if ctx.is_aborted_or_ended() {
            return;
        }
        // if you return a Response object or a Promise<Response>
        // but you upgraded the connection to a WebSocket
        // just ignore the Response object. It doesn't do anything.
        // it's better to do that than to throw an error
        if ctx.did_upgrade_web_socket() {
            return;
        }

        if response_value.is_empty_or_undefined_or_null() {
            ctx.render_missing_invalid_response(response_value);
            return;
        }

        if let Some(err_value) = response_value.to_error() {
            ctx.run_error_handler(err_value);
            return;
        }

        if let Some(response) = response_value.as_::<Response>() {
            ctx.response_jsvalue = response_value;
            ctx.response_jsvalue.ensure_still_alive();
            ctx.flags.set_response_protected(false);
            if ctx.method == Method::HEAD {
                if let Some(resp) = ctx.resp {
                    let mut pair = HeaderResponsePair { this: ctx, response };
                    // SAFETY: FFI handle
                    unsafe {
                        (*resp).run_corked_with_type(Self::do_render_head_response, &mut pair)
                    };
                }
                return;
            } else {
                let body_value = response.get_body_value();
                body_value.to_blob_if_possible();

                match body_value {
                    Body::Value::Blob(blob) => {
                        if blob.needs_to_read_file() {
                            response_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                    }
                    Body::Value::Locked(_) => {
                        response_value.protect();
                        ctx.flags.set_response_protected(true);
                    }
                    _ => {}
                }
                ctx.render(response);
            }
            return;
        }

        let vm = this.vm();

        if let Some(promise) = response_value.as_any_promise() {
            // If we immediately have the value available, we can skip the extra event loop tick
            match promise.unwrap(vm.global.vm(), jsc::PromiseUnwrap::MarkHandled) {
                jsc::PromiseUnwrapResult::Pending => {
                    ctx.ref_();
                    let cell = NativePromiseContext::create(this.global_this(), ctx);
                    let _ = response_value.then_with_value(
                        this.global_this(),
                        cell,
                        Self::on_resolve,
                        Self::on_reject,
                    ); // TODO: properly propagate exception upwards
                    return;
                }
                jsc::PromiseUnwrapResult::Fulfilled(fulfilled_value) => {
                    // if you return a Response object or a Promise<Response>
                    // but you upgraded the connection to a WebSocket
                    // just ignore the Response object. It doesn't do anything.
                    // it's better to do that than to throw an error
                    if ctx.did_upgrade_web_socket() {
                        return;
                    }

                    if fulfilled_value.is_empty_or_undefined_or_null() {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    }
                    let Some(response) = fulfilled_value.as_::<Response>() else {
                        ctx.render_missing_invalid_response(fulfilled_value);
                        return;
                    };

                    ctx.response_jsvalue = fulfilled_value;
                    ctx.response_jsvalue.ensure_still_alive();
                    ctx.flags.set_response_protected(false);
                    if ctx.method == Method::HEAD {
                        if let Some(resp) = ctx.resp {
                            let mut pair = HeaderResponsePair { this: ctx, response };
                            // SAFETY: FFI handle
                            unsafe {
                                (*resp).run_corked_with_type(
                                    Self::do_render_head_response,
                                    &mut pair,
                                )
                            };
                        }
                        return;
                    }
                    let body_value = response.get_body_value();
                    body_value.to_blob_if_possible();
                    match body_value {
                        Body::Value::Blob(blob) => {
                            if blob.needs_to_read_file() {
                                fulfilled_value.protect();
                                ctx.flags.set_response_protected(true);
                            }
                        }
                        Body::Value::Locked(_) => {
                            fulfilled_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                        _ => {}
                    }
                    ctx.render(response);
                    return;
                }
                jsc::PromiseUnwrapResult::Rejected(err) => {
                    ctx.handle_reject(err);
                    return;
                }
            }
        }
    }

    pub fn handle_resolve_stream(req: &mut Self) {
        stream_log!("handleResolveStream");

        let mut wrote_anything = false;
        if let Some(mut wrapper) = req.sink.take() {
            req.flags.set_aborted(req.flags.aborted() || wrapper.sink.aborted);
            wrote_anything = wrapper.sink.wrote > 0;

            wrapper.sink.finalize();
            let g = wrapper.sink.global_this;
            wrapper.detach(g);
            // wrapper.sink.destroy() — Box drops at scope end
        }

        if let Some(resp) = req.response_weakref.get() {
            debug_assert!(req.server.is_some());
            // SAFETY: BACKREF
            let global_this = unsafe { (*req.server.unwrap()).global_this() };
            let body_value = resp.get_body_value();
            if let Some(stream) = resp.get_body_readable_stream(global_this) {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);

                stream.done(global_this);
            }

            *body_value = Body::Value::Used;
        }

        if req.is_aborted_or_ended() {
            return;
        }

        stream_log!("onResolve({})", wrote_anything);
        if !req.flags.has_written_status() {
            req.render_metadata();
        }
        req.end_stream(req.should_close_connection());
    }

    #[bun_jsc::host_fn]
    pub fn on_resolve_stream(_global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        stream_log!("onResolveStream");
        let args = callframe.arguments_old(2);
        let Some(req) = NativePromiseContext::take::<Self>(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let _guard = scopeguard::guard((), |_| req.deref());
        req.handle_resolve_stream();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn on_reject_stream(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        stream_log!("onRejectStream");
        let args = callframe.arguments_old(2);
        let Some(req) = NativePromiseContext::take::<Self>(args.ptr[args.len - 1]) else {
            return Ok(JSValue::UNDEFINED);
        };
        let err = args.ptr[0];
        let _guard = scopeguard::guard((), |_| req.deref());

        req.handle_reject_stream(global_this, err);
        Ok(JSValue::UNDEFINED)
    }

    pub fn handle_reject_stream(req: &mut Self, global_this: &JSGlobalObject, err: JSValue) {
        stream_log!("handleRejectStream");

        if let Some(mut wrapper) = req.sink.take() {
            if let Some(prom) = wrapper.sink.pending_flush.take() {
                // The promise value was protected when pending_flush was
                // assigned (flushFromJS / endFromJS). Drop that root before
                // abandoning the pointer, otherwise it leaks for the
                // lifetime of the VM.
                prom.to_js().unprotect();
            }
            wrapper.sink.done = true;
            req.flags.set_aborted(req.flags.aborted() || wrapper.sink.aborted);
            wrapper.sink.finalize();
            let g = wrapper.sink.global_this;
            wrapper.detach(g);
            // wrapper.sink.destroy() — Box drops at scope end
        }

        if let Some(resp) = req.response_weakref.get() {
            let body_value = resp.get_body_value();

            if let Some(stream) = resp.get_body_readable_stream(global_this) {
                stream.value.ensure_still_alive();
                resp.detach_readable_stream(global_this);
                stream.done(global_this);
            }

            if matches!(body_value, Body::Value::Locked(_)) {
                *body_value = Body::Value::Used;
            }
        }

        // aborted so call finalizeForAbort
        if req.is_aborted_or_ended() {
            return;
        }

        stream_log!("onReject()");

        if !req.flags.has_written_status() {
            req.render_metadata();
        }

        if DEBUG_MODE {
            if let Some(server) = req.server {
                if !err.is_empty_or_undefined_or_null() {
                    // SAFETY: BACKREF
                    let server = unsafe { &*server };
                    let mut exception_list: Vec<Api::JsException> = Vec::new();
                    server.vm().run_error_handler(err, &mut exception_list);

                    if let Some(_dev_server) = server.dev_server() {
                        // Render the error fallback HTML page like renderDefaultError does
                        if !req.flags.has_written_status() {
                            req.flags.set_has_written_status(true);
                            if let Some(resp) = req.resp {
                                // SAFETY: FFI handle
                                unsafe {
                                    (*resp).write_status(b"500 Internal Server Error");
                                    (*resp).write_header(b"content-type", MimeType::HTML.value);
                                }
                            }
                        }

                        // Create error message for the stream rejection
                        let fallback_container = Box::new(Api::FallbackMessageContainer {
                            message: b"Stream error during server-side rendering"
                                .to_vec()
                                .into_boxed_slice(),
                            router: None,
                            reason: Api::FallbackReason::FetchEventHandler,
                            cwd: server.vm().transpiler.fs.top_level_dir.clone(),
                            problems: Api::Problems {
                                code: 500,
                                name: "StreamError",
                                exceptions: exception_list,
                                build: Api::Build { msgs: Vec::new() },
                            },
                        });

                        let mut bb: Vec<u8> = Vec::new();

                        Fallback::render_backend(&fallback_container, &mut bb)
                            .expect("unreachable");

                        if let Some(resp) = req.resp {
                            // SAFETY: FFI handle
                            unsafe { (*resp).write(&bb) };
                        }

                        req.end_stream(req.should_close_connection());
                        return;
                    }
                }
            }
        }
        req.end_stream(req.should_close_connection());
    }

    pub fn do_render_with_body(
        this: &mut Self,
        value: &mut WebCore::Body::Value,
        owned_readable: Option<WebCore::ReadableStream>,
    ) {
        this.drain_microtasks();

        // If a ReadableStream can trivially be converted to a Blob, do so.
        // If it's a WTFStringImpl and it cannot be used as a UTF-8 string, convert it to a Blob.
        value.to_blob_if_possible();
        // SAFETY: BACKREF
        let global_this = unsafe { (*this.server.unwrap()).global_this() };
        match value {
            Body::Value::Error(err_ref) => {
                let _ = value.use_();
                if this.is_aborted_or_ended() {
                    return;
                }
                this.run_error_handler(err_ref.to_js(global_this));
                return;
            }
            // .InlineBlob,
            Body::Value::WTFStringImpl(_)
            | Body::Value::InternalBlob(_)
            | Body::Value::Blob(_) => {
                // toBlobIfPossible checks for WTFString needing a conversion.
                this.blob = value.use_as_any_blob_allow_non_utf8_string();
                this.render_with_blob_from_body_value();
                return;
            }
            Body::Value::Locked(lock) => {
                if this.is_aborted_or_ended() {
                    return;
                }
                let readable_stream: Option<WebCore::ReadableStream> = 'brk: {
                    if let Some(stream) = lock.readable.get(global_this) {
                        // we hold the stream alive until we're done with it
                        this.response_body_readable_stream_ref = lock.readable;
                        break 'brk Some(stream);
                    }
                    if let Some(stream) = owned_readable {
                        // response owns the stream, so we hold a strong reference to it
                        this.response_body_readable_stream_ref =
                            WebCore::ReadableStream::Strong::init(stream, global_this);
                        break 'brk Some(stream);
                    }
                    None
                };
                if let Some(stream) = readable_stream {
                    *value = Body::Value::Used;

                    if stream.is_locked(global_this) {
                        stream_log!("was locked but it shouldn't be");
                        let mut err = jsc::SystemError {
                            code: BunString::static_(
                                <&'static str>::from(jsc::node::ErrorCode::ERR_STREAM_CANNOT_PIPE),
                            ),
                            message: BunString::static_(
                                "Stream already used, please create a new one",
                            ),
                            ..Default::default()
                        };
                        stream.value.unprotect();
                        let js_err = err.to_error_instance(global_this);
                        this.run_error_handler(js_err);
                        return;
                    }

                    match stream.ptr {
                        WebCore::ReadableStream::Ptr::Invalid => {
                            this.response_body_readable_stream_ref.deinit();
                            // Stream is invalid, render empty body
                            this.do_render_blob();
                            return;
                        }
                        // toBlobIfPossible will typically convert .Blob streams, or .File streams into a Blob object, but cannot always.
                        WebCore::ReadableStream::Ptr::Blob(_)
                        | WebCore::ReadableStream::Ptr::File(_)
                        // These are the common scenario:
                        | WebCore::ReadableStream::Ptr::JavaScript(_)
                        | WebCore::ReadableStream::Ptr::Direct(_) => {
                            if let Some(resp) = this.resp {
                                let mut pair = StreamPair { stream, this };
                                // SAFETY: FFI handle
                                unsafe {
                                    (*resp).run_corked_with_type(Self::do_render_stream, &mut pair)
                                };
                            }
                            return;
                        }

                        WebCore::ReadableStream::Ptr::Bytes(byte_stream) => {
                            debug_assert!(byte_stream.pipe.ctx.is_null());
                            debug_assert!(this.byte_stream.is_none());
                            if this.resp.is_none() {
                                // we don't have a response, so we can discard the stream
                                stream.done(global_this);
                                this.response_body_readable_stream_ref.deinit();
                                return;
                            }
                            let resp = this.resp.unwrap();
                            // If we've received the complete body by the time this function is called
                            // we can avoid streaming it and just send it all at once.
                            if byte_stream.has_received_last_chunk {
                                let byte_list = byte_stream.drain();
                                this.blob = WebCore::Blob::Any::from_array_list(
                                    byte_list.move_to_list_managed(),
                                );
                                this.response_body_readable_stream_ref.deinit();
                                this.do_render_blob();
                                return;
                            }
                            this.ref_();
                            byte_stream.pipe = WebCore::Pipe::wrap::<Self>(Self::on_pipe).init(this);
                            // Deinit the old Strong reference before creating a new one
                            // to avoid leaking the Strong.Impl memory
                            this.response_body_readable_stream_ref.deinit();
                            this.response_body_readable_stream_ref =
                                WebCore::ReadableStream::Strong::init(stream, global_this);

                            this.byte_stream = Some(NonNull::from(byte_stream));
                            let response_buf = byte_stream.drain();
                            this.response_buf_owned = response_buf.move_to_list();

                            // we don't set size here because even if we have a hint
                            // uWebSockets won't let us partially write streaming content
                            this.blob.detach();

                            // if we've received metadata and part of the body, send everything we can and drain
                            if !this.response_buf_owned.is_empty() {
                                // SAFETY: FFI handle
                                unsafe {
                                    (*resp).run_corked_with_type(
                                        Self::drain_response_buffer_and_metadata,
                                        this,
                                    )
                                };
                            } else {
                                // if we only have metadata to send, send it now
                                // SAFETY: FFI handle
                                unsafe {
                                    (*resp).run_corked_with_type(Self::render_metadata, this)
                                };
                            }
                            return;
                        }
                    }
                }

                if lock.on_receive_value.is_some() || lock.task.is_some() {
                    // someone else is waiting for the stream or waiting for `onStartStreaming`
                    let Ok(readable) = value.to_readable_stream(global_this) else {
                        return;
                    }; // TODO: properly propagate exception upwards
                    readable.ensure_still_alive();
                    this.do_render_with_body(value, None);
                    return;
                }

                // when there's no stream, we need to
                lock.on_receive_value = Some(Self::do_render_with_body_locked);
                lock.task = Some(this as *mut Self as *mut c_void);

                return;
            }
            _ => {}
        }

        this.do_render_blob();
    }

    pub fn on_pipe(this: &mut Self, stream: WebCore::streams::Result) {
        // TODO(port): allocator param dropped — global mimalloc per §Allocators
        let mut stream_ = stream;
        let stream_needs_deinit =
            matches!(stream, WebCore::streams::Result::Owned(_) | WebCore::streams::Result::OwnedAndDone(_));
        let is_done = stream.is_done();
        let this_ptr = this as *mut Self;
        let _guard = scopeguard::guard((), |_| {
            if is_done {
                // SAFETY: this outlives the guard
                unsafe { (*this_ptr).deref() };
            }
            if stream_needs_deinit {
                match &mut stream_ {
                    WebCore::streams::Result::OwnedAndDone(owned)
                    | WebCore::streams::Result::Owned(owned) => owned.deinit(),
                    _ => unreachable!(),
                }
            }
        });

        if this.is_aborted_or_ended() {
            return;
        }
        let resp = this.resp.unwrap();

        let chunk = stream.slice();
        // on failure, it will continue to allocate
        // we can't do buffering ourselves here or it won't work
        // uSockets will append and manage the buffer
        // so any write will buffer if the write fails
        // SAFETY: FFI handle
        if unsafe { (*resp).write(chunk) } == uws::WriteResult::WantMore {
            if is_done {
                this.end_stream(this.should_close_connection());
            }
        } else {
            // when it's the last one, we just want to know if it's done
            if is_done {
                this.flags.set_has_marked_pending(true);
                // SAFETY: FFI handle
                unsafe { (*resp).on_writable(Self::on_writable_response_buffer, this) };
            }
        }
    }

    pub fn do_render_blob(&mut self) {
        // We are not corked
        // The body is small
        // Faster to do the memcpy than to do the two network calls
        // We are not streaming
        // This is an important performance optimization
        if self.flags.has_abort_handler() && self.blob.fast_size() < 16384 - 1024 {
            if let Some(resp) = self.resp {
                // SAFETY: FFI handle
                unsafe { (*resp).run_corked_with_type(Self::do_render_blob_corked, self) };
            }
        } else {
            self.do_render_blob_corked();
        }
    }

    pub fn do_render_blob_corked(&mut self) {
        self.render_metadata();
        self.render_bytes();
    }

    pub fn do_render(&mut self) {
        ctx_log!("doRender");

        if self.is_aborted_or_ended() {
            return;
        }
        let response = self.response_weakref.get().unwrap();
        // SAFETY: BACKREF
        let global_this = unsafe { (*self.server.unwrap()).global_this() };
        self.do_render_with_body(
            response.get_body_value(),
            response.get_body_readable_stream(global_this),
        );
    }

    pub fn render_production_error(&mut self, status: u16) {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            let resp = unsafe { &mut *resp };
            match status {
                404 => {
                    if !self.flags.has_written_status() {
                        resp.write_status(b"404 Not Found");
                        self.flags.set_has_written_status(true);
                    }
                    self.end_without_body(self.should_close_connection());
                }
                _ => {
                    if !self.flags.has_written_status() {
                        resp.write_status(b"500 Internal Server Error");
                        resp.write_header(b"content-type", b"text/plain");
                        self.flags.set_has_written_status(true);
                    }

                    self.end(b"Something went wrong!", self.should_close_connection());
                }
            }
        }
    }

    pub fn run_error_handler(&mut self, value: JSValue) {
        self.run_error_handler_with_status_code(value, 500);
    }

    fn ensure_pathname(&self) -> PathnameFormatter<'_, ThisServer, SSL_ENABLED, DEBUG_MODE, HTTP3> {
        PathnameFormatter { ctx: self }
    }

    #[inline]
    pub fn should_close_connection(&self) -> bool {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            return unsafe { (*resp).should_close_connection() };
        }
        false
    }

    fn finish_running_error_handler(&mut self, value: JSValue, status: u16) {
        let Some(server) = self.server else {
            return self.render_production_error(status);
        };
        // SAFETY: BACKREF
        let server = unsafe { &*server };
        let vm: &VirtualMachine = server.vm();
        let global_this = server.global_this();
        if DEBUG_MODE {
            // PERF(port): was arena bulk-free — profile in Phase B
            let mut exception_list: Vec<Api::JsException> = Vec::new();
            let prev_exception_list = vm.on_unhandled_rejection_exception_list;
            vm.on_unhandled_rejection_exception_list = Some(&mut exception_list);
            (vm.on_unhandled_rejection)(vm, global_this, value);
            vm.on_unhandled_rejection_exception_list = prev_exception_list;

            self.render_default_error(
                vm.log,
                bun_core::err!("ExceptionOcurred"),
                &exception_list,
                format_args!(
                    "<r><red>{}<r> - <b>{}<r> failed",
                    <&'static str>::from(self.method),
                    self.ensure_pathname()
                ),
            );
        } else {
            if status != 404 {
                (vm.on_unhandled_rejection)(vm, global_this, value);
            }
            self.render_production_error(status);
        }

        vm.log.reset();
    }

    pub fn run_error_handler_with_status_code_dont_check_responded(
        &mut self,
        value: JSValue,
        status: u16,
    ) {
        jsc::mark_binding!();
        if let Some(server) = self.server {
            // SAFETY: BACKREF
            let server = unsafe { &*server };
            if !server.config().on_error.is_empty() && !self.flags.has_called_error_handler() {
                self.flags.set_has_called_error_handler(true);
                let result = server
                    .config()
                    .on_error
                    .call(
                        server.global_this(),
                        server.js_value().try_get().unwrap_or(JSValue::UNDEFINED),
                        &[value],
                    )
                    .unwrap_or_else(|err| server.global_this().take_exception(err));
                let _keep = jsc::EnsureStillAlive(result);
                if !result.is_empty_or_undefined_or_null() {
                    if let Some(err) = result.to_error() {
                        self.finish_running_error_handler(err, status);
                        return;
                    } else if let Some(promise) = result.as_any_promise() {
                        self.process_on_error_promise(result, promise, value, status);
                        return;
                    } else if let Some(response) = result.as_::<Response>() {
                        self.render(response);
                        return;
                    }
                }
            }
        }

        self.finish_running_error_handler(value, status);
    }

    fn process_on_error_promise(
        ctx: &mut Self,
        promise_js: JSValue,
        promise: jsc::AnyPromise,
        value: JSValue,
        status: u16,
    ) {
        debug_assert!(ctx.server.is_some());
        // SAFETY: BACKREF
        let server = unsafe { &*ctx.server.unwrap() };
        let vm = server.vm();

        match promise.unwrap(vm.global.vm(), jsc::PromiseUnwrap::MarkHandled) {
            jsc::PromiseUnwrapResult::Pending => {
                ctx.flags.set_is_error_promise_pending(true);
                ctx.ref_();
                let cell = NativePromiseContext::create(server.global_this(), ctx);
                let _ = promise_js.then_with_value(
                    server.global_this(),
                    cell,
                    Self::on_resolve,
                    Self::on_reject,
                ); // TODO: properly propagate exception upwards
            }
            jsc::PromiseUnwrapResult::Fulfilled(fulfilled_value) => {
                // if you return a Response object or a Promise<Response>
                // but you upgraded the connection to a WebSocket
                // just ignore the Response object. It doesn't do anything.
                // it's better to do that than to throw an error
                if ctx.did_upgrade_web_socket() {
                    return;
                }

                let Some(response) = fulfilled_value.as_::<Response>() else {
                    ctx.finish_running_error_handler(value, status);
                    return;
                };

                ctx.response_jsvalue = fulfilled_value;
                ctx.response_jsvalue.ensure_still_alive();
                ctx.flags.set_response_protected(false);

                let body_value = response.get_body_value();
                body_value.to_blob_if_possible();
                match body_value {
                    Body::Value::Blob(blob) => {
                        if blob.needs_to_read_file() {
                            fulfilled_value.protect();
                            ctx.flags.set_response_protected(true);
                        }
                    }
                    Body::Value::Locked(_) => {
                        fulfilled_value.protect();
                        ctx.flags.set_response_protected(true);
                    }
                    _ => {}
                }
                ctx.render(response);
                return;
            }
            jsc::PromiseUnwrapResult::Rejected(err) => {
                ctx.finish_running_error_handler(err, status);
                return;
            }
        }
    }

    pub fn run_error_handler_with_status_code(&mut self, value: JSValue, status: u16) {
        jsc::mark_binding!();
        // SAFETY: FFI handle, just checked is_some()
        if self.resp.is_none() || unsafe { (*self.resp.unwrap()).has_responded() } {
            return;
        }

        self.run_error_handler_with_status_code_dont_check_responded(value, status);
    }

    pub fn render_metadata(&mut self) {
        let Some(resp) = self.resp else { return };
        // SAFETY: FFI handle
        let resp = unsafe { &mut *resp };

        // For plain in-memory bodies this runs synchronously from
        // render() before any backpressure gap, so the Response is
        // always live here. File / stream bodies that call this after
        // an async hop keep the Response rooted via response_protected.
        let response: &mut Response = self.response_weakref.get().unwrap();
        let mut status = response.status_code();
        let mut needs_content_range = self.flags.needs_content_range()
            && (self.sendfile.total > 0 || self.sendfile.remain < self.blob.size());

        let size = if needs_content_range {
            self.sendfile.remain
        } else {
            self.blob.size()
        };

        status = if status == 200 && size == 0 && !self.blob.is_detached() {
            204
        } else {
            status
        };

        let (content_type, needs_content_type, content_type_needs_free) =
            get_content_type(response.get_init_headers(), &self.blob);
        let _ct_guard = scopeguard::guard((), |_| {
            if content_type_needs_free {
                content_type.deinit();
            }
        });
        let mut has_content_disposition = false;
        let mut has_content_range = false;
        if let Some(headers_) = response.swap_init_headers() {
            has_content_disposition = headers_.fast_has(FetchHeaders::Name::ContentDisposition);
            has_content_range = headers_.fast_has(FetchHeaders::Name::ContentRange);
            // For .slice()-driven ranges, only promote to 206 if the user
            // also set Content-Range (preserves the old contract). For an
            // incoming Range: header (sendfile.total > 0) we always 206.
            needs_content_range =
                needs_content_range && (self.sendfile.total > 0 || has_content_range);
            if needs_content_range {
                status = 206;
            }

            self.do_write_status(status);
            self.do_write_headers(&headers_);
            headers_.deref();
        } else if needs_content_range {
            status = 206;
            self.do_write_status(status);
        } else {
            self.do_write_status(status);
        }

        if let Some(cookies) = self.cookies.take() {
            // SAFETY: BACKREF
            let global_this = unsafe { (*self.server.unwrap()).global_this() };
            let r = cookies.write(global_this, Self::RESP_KIND, self.resp.unwrap() as *mut c_void);
            drop(cookies); // deref
            if r.is_err() {
                return;
            } // TODO: properly propagate exception upwards
        }

        if needs_content_type
            // do not insert the content type if it is the fallback value
            // we may not know the content-type when streaming
            && (!self.blob.is_detached()
                || content_type.value.as_ptr() != MimeType::OTHER.value.as_ptr())
        {
            resp.write_header(b"content-type", content_type.value);
        }

        // Advertise the QUIC endpoint on H1/H2 responses so browsers can
        // discover it (RFC 7838). Multiple Alt-Svc fields are valid, so a
        // user-supplied one composes rather than conflicts.
        // TODO(port): `@hasDecl(ThisServer, "h3AltSvc")` — model as optional trait method.
        if !HTTP3 {
            // SAFETY: BACKREF
            if let Some(alt) = unsafe { (*self.server.unwrap()).h3_alt_svc() } {
                resp.write_header(b"alt-svc", alt);
            }
        }

        // automatically include the filename when:
        // 1. Bun.file("foo")
        // 2. The content-disposition header is not present
        if !has_content_disposition && content_type.category.autoset_filename() {
            if let Some(filename) = self.blob.get_file_name() {
                let basename = bun_paths::basename(filename);
                if !basename.is_empty() {
                    let mut filename_buf = [0u8; 1024];
                    let truncated = &basename[..basename.len().min(1024 - 32)];
                    let header_value = {
                        let mut w = &mut filename_buf[..];
                        if write!(w, "filename=\"{}\"", bstr::BStr::new(truncated)).is_ok() {
                            let written = 1024 - w.len();
                            &filename_buf[..written]
                        } else {
                            &b""[..]
                        }
                    };
                    resp.write_header(b"content-disposition", header_value);
                }
            }
        }

        if self.flags.needs_content_length() {
            resp.write_header_int(b"content-length", size as u64);
            resp.mark_wrote_content_length_header();
            self.flags.set_needs_content_length(false);
        }

        if needs_content_range && !has_content_range {
            let mut content_range_buf = [0u8; 1024];

            let header_value = if self.sendfile.total > 0 {
                // We resolved an incoming Range header against the
                // stat'd size, so the total is meaningful.
                let mut w = &mut content_range_buf[..];
                if write!(
                    w,
                    "bytes {}-{}/{}",
                    self.sendfile.offset,
                    self.sendfile.offset + self.sendfile.remain.saturating_sub(1),
                    self.sendfile.total
                )
                .is_ok()
                {
                    let written = 1024 - w.len();
                    &content_range_buf[..written]
                } else {
                    &b"bytes */*"[..]
                }
            } else {
                // For .slice()-driven ranges we omit the full size:
                // it can change between requests and may leak PII.
                let mut w = &mut content_range_buf[..];
                if write!(
                    w,
                    "bytes {}-{}/*",
                    self.sendfile.offset,
                    self.sendfile.offset + self.sendfile.remain.saturating_sub(1)
                )
                .is_ok()
                {
                    let written = 1024 - w.len();
                    &content_range_buf[..written]
                } else {
                    &b"bytes */*"[..]
                }
            };
            resp.write_header(b"content-range", header_value);
            if self.sendfile.total > 0 {
                resp.write_header(b"accept-ranges", b"bytes");
            }
            self.flags.set_needs_content_range(false);
        }
    }

    fn do_write_status(&mut self, status: u16) {
        debug_assert!(!self.flags.has_written_status());
        self.flags.set_has_written_status(true);

        let Some(resp) = self.resp else { return };
        // SAFETY: FFI handle
        let resp = unsafe { &mut *resp };
        if let Some(text) = HTTPStatusText::get(status) {
            resp.write_status(text);
        } else {
            let mut buf = [0u8; 48];
            let mut w = &mut buf[..];
            let _ = write!(w, "{} HM", status);
            let written = 48 - w.len();
            resp.write_status(&buf[..written]);
        }
    }

    fn do_write_headers(&mut self, headers: &FetchHeaders) {
        ctx_log!("writeHeaders");
        headers.fast_remove(FetchHeaders::Name::ContentLength);
        headers.fast_remove(FetchHeaders::Name::TransferEncoding);
        if HTTP3 {
            // RFC 9114 §4.2: connection-specific fields are malformed.
            headers.fast_remove(FetchHeaders::Name::Connection);
            headers.fast_remove(FetchHeaders::Name::KeepAlive);
            headers.fast_remove(FetchHeaders::Name::ProxyConnection);
            headers.fast_remove(FetchHeaders::Name::Upgrade);
        }
        if let Some(resp) = self.resp {
            headers.to_uws_response(Self::RESP_KIND, resp);
        }
    }

    pub fn render_bytes(&mut self) {
        // copy it to stack memory to prevent aliasing issues in release builds
        let blob = self.blob;
        let bytes = blob.slice();
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            if unsafe { !(*resp).try_end(bytes, bytes.len(), self.should_close_connection()) } {
                self.flags.set_has_marked_pending(true);
                // SAFETY: FFI handle
                unsafe { (*resp).on_writable(Self::on_writable_bytes, self) };
                return;
            }
        }
        self.detach_response();
        self.end_request_streaming_and_drain();
        self.deref();
    }

    /// Replace the tracked Response. Drops the previous weak ref (if any)
    /// before taking a new one so the old Response's allocation can be
    /// freed once its own strong refs go to zero.
    fn set_response(&mut self, response: &mut Response) {
        if self.response_weakref.raw_ptr() == Some(response as *mut _) {
            return;
        }
        self.response_weakref.deref();
        self.response_weakref = Response::WeakRef::init_ref(response);
    }

    pub fn render(&mut self, response: &mut Response) {
        ctx_log!("render");
        self.set_response(response);

        self.do_render();
    }

    pub fn on_buffered_body_chunk(
        this: &mut Self,
        resp: *mut Resp<SSL_ENABLED, HTTP3>,
        chunk: &[u8],
        last: bool,
    ) {
        ctx_log!("onBufferedBodyChunk {} {}", chunk.len(), last);

        debug_assert!(this.resp == Some(resp));

        this.flags.set_is_waiting_for_request_body(!last);
        if this.is_aborted_or_ended() || this.flags.has_marked_complete() {
            return;
        }
        if !last && chunk.is_empty() {
            // Sometimes, we get back an empty chunk
            // We have to ignore those chunks unless it's the last one
            return;
        }
        // SAFETY: BACKREF
        let server = unsafe { &*this.server.unwrap() };
        let vm = server.vm();
        let global_this = server.global_this();

        // After the user does request.body,
        // if they then do .text(), .arrayBuffer(), etc
        // we can no longer hold the strong reference from the body value ref.
        if let Some(readable) = this.request_body_readable_stream_ref.get(global_this) {
            debug_assert!(this.request_body_buf.is_empty());
            vm.event_loop().enter();
            let _exit = scopeguard::guard((), |_| vm.event_loop().exit());

            if !last {
                let _ = readable.ptr.bytes().on_data(
                    WebCore::streams::Result::Temporary(ByteList::from_borrowed_slice_dangerous(
                        chunk,
                    )),
                ); // TODO: properly propagate exception upwards
            } else {
                let mut strong = core::mem::take(&mut this.request_body_readable_stream_ref);
                let _strong_guard = scopeguard::guard((), |_| strong.deinit());
                if let Some(request_body) = this.request_body.take() {
                    drop(request_body); // unref
                }

                readable.value.ensure_still_alive();
                let _ = readable.ptr.bytes().on_data(
                    WebCore::streams::Result::TemporaryAndDone(
                        ByteList::from_borrowed_slice_dangerous(chunk),
                    ),
                ); // TODO: properly propagate exception upwards
            }

            return;
        }

        // This is the start of a task, so it's a good time to drain
        if let Some(body) = this.request_body.clone() {
            // The up-front maxRequestBodySize check in server.zig only
            // sees Content-Length. HTTP/3 (and H1 chunked) bodies may
            // omit it, so cap accumulated bytes here too — otherwise a
            // single CL-less stream can grow request_body_buf without
            // bound.
            if this.request_body_buf.len().saturating_add(chunk.len())
                > server.config().max_request_body_size
            {
                this.request_body_buf = Vec::new();
                // SAFETY: FFI handle
                unsafe { (*resp).clear_on_data() };
                this.flags.set_is_waiting_for_request_body(false);

                let loop_ = vm.event_loop();
                loop_.enter();
                let _exit = scopeguard::guard((), |_| loop_.exit());
                // Reject the pending body first so endRequestStreaming()
                // below (via this.endWithoutBody) doesn't substitute a
                // generic ConnectionClosed. toErrorInstance handles
                // .Locked itself (rejects the promise, deinits the
                // readable, calls onReceiveValue).
                let _ = body.value.to_error_instance(
                    Body::ValueError::Message(BunString::static_(
                        "Request body exceeded maxRequestBodySize",
                    )),
                    global_this,
                );

                // Route through the normal end path so this.resp is
                // detached and the base ref released. Writing directly on
                // the raw uWS response left this.resp pointing at a
                // completed (and soon freed) response — uWS markDone()
                // clears onAborted so no abort ever fires to release the
                // ref, and a later handleResolve()/handleReject() from an
                // async handler would dereference the stale pointer.
                // SAFETY: FFI handle
                if this.resp.is_some() && unsafe { !(*resp).has_responded() } {
                    this.flags.set_has_written_status(true);
                    // SAFETY: FFI handle
                    unsafe { (*resp).write_status(b"413 Payload Too Large") };
                }
                this.end_without_body(!HTTP3);
                return;
            }

            if last {
                let bytes = &mut this.request_body_buf;

                let old = core::mem::replace(&mut body.value, Body::Value::Null);

                let total = bytes.len() + chunk.len();
                'getter: {
                    // if (total <= jsc.WebCore.InlineBlob.available_bytes) {
                    //     if (total == 0) {
                    //         body.value = .{ .Empty = {} };
                    //         break :getter;
                    //     }
                    //
                    //     body.value = .{ .InlineBlob = jsc.WebCore.InlineBlob.concat(bytes.items, chunk) };
                    //     this.request_body_buf.clearAndFree(this.allocator);
                    // } else {
                    // TODO(port): ensureTotalCapacityPrecise can OOM in Zig; Rust Vec aborts.
                    bytes.reserve_exact(total.saturating_sub(bytes.len()));

                    let prev_len = bytes.len();
                    // SAFETY: capacity reserved above; bytes are written immediately below
                    unsafe { bytes.set_len(total) };
                    let slice = &mut bytes[prev_len..];
                    slice[..chunk.len()].copy_from_slice(chunk);
                    body.value = Body::Value::InternalBlob(WebCore::InternalBlob {
                        bytes: core::mem::take(bytes),
                    });
                    // }
                    let _ = &'getter ();
                }
                this.request_body_buf = Vec::new();

                if matches!(old, Body::Value::Locked(_)) {
                    let loop_ = vm.event_loop();
                    loop_.enter();
                    let _exit = scopeguard::guard((), |_| loop_.exit());

                    let _ = old.resolve(&mut body.value, global_this, None); // TODO: properly propagate exception upwards
                }
                return;
            }

            if this.request_body_buf.capacity() == 0 {
                this.request_body_buf.reserve_exact(
                    this.request_body_content_len
                        .min(MAX_REQUEST_BODY_PREALLOCATE_LENGTH),
                );
            }
            this.request_body_buf.extend_from_slice(chunk);
        }
    }

    pub fn on_start_streaming_request_body(&mut self) -> WebCore::DrainResult {
        ctx_log!("onStartStreamingRequestBody");
        if self.is_aborted_or_ended() {
            return WebCore::DrainResult::Aborted;
        }

        // This means we have received part of the body but not the whole thing
        if !self.request_body_buf.is_empty() {
            let emptied = core::mem::take(&mut self.request_body_buf);
            let cap = emptied.capacity();
            return WebCore::DrainResult::Owned {
                list: emptied,
                size_hint: if cap < MAX_REQUEST_BODY_PREALLOCATE_LENGTH {
                    cap
                } else {
                    0
                },
            };
        }

        WebCore::DrainResult::EstimatedSize(self.request_body_content_len)
    }

    pub fn on_start_buffering(&mut self) {
        if let Some(server) = self.server {
            ctx_log!("onStartBuffering");
            // TODO: check if is someone calling onStartBuffering other than onStartBufferingCallback
            // if is not, this should be removed and only keep protect + setAbortHandler
            // HTTP/3 (RFC 9114): Content-Length is optional; the body is
            // delimited by stream FIN, so the H1 "no CL + no TE ⇒ empty"
            // shortcut would drop it.
            if !HTTP3
                && !self.flags.is_transfer_encoding()
                && self.request_body_content_len == 0
            {
                // no content-length or 0 content-length
                // no transfer-encoding
                if let Some(body) = &mut self.request_body {
                    let mut old = core::mem::replace(&mut body.value, Body::Value::Null);
                    if let Body::Value::Locked(l) = &mut old {
                        l.on_receive_value = None;
                    }
                    let mut new_body: Body::Value = Body::Value::Null;
                    // SAFETY: BACKREF
                    let global_this = unsafe { (*server).global_this() };
                    let _ = old.resolve(&mut new_body, global_this, None); // TODO: properly propagate exception upwards
                    body.value = new_body;
                }
            }
        }
    }

    pub fn on_request_body_readable_stream_available(
        ptr: *mut c_void,
        global_this: &JSGlobalObject,
        readable: WebCore::ReadableStream,
    ) {
        // SAFETY: ptr is a *RequestContext
        let this = unsafe { &mut *(ptr as *mut Self) };
        debug_assert!(this.request_body_readable_stream_ref.held.impl_.is_none());
        this.request_body_readable_stream_ref =
            WebCore::ReadableStream::Strong::init(readable, global_this);
    }

    pub fn on_start_buffering_callback(this: *mut c_void) {
        // SAFETY: this is a *RequestContext
        unsafe { &mut *(this as *mut Self) }.on_start_buffering();
    }

    pub fn on_start_streaming_request_body_callback(this: *mut c_void) -> WebCore::DrainResult {
        // SAFETY: this is a *RequestContext
        unsafe { &mut *(this as *mut Self) }.on_start_streaming_request_body()
    }

    pub fn get_remote_socket_info(&self) -> Option<SocketAddress> {
        let resp = self.resp?;
        // SAFETY: FFI handle
        unsafe { (*resp).get_remote_socket_info() }
    }

    pub fn set_timeout(&mut self, seconds: c_uint) -> bool {
        if let Some(resp) = self.resp {
            // SAFETY: FFI handle
            unsafe { (*resp).timeout(seconds.min(255)) };
            if seconds > 0 {
                // we only set the timeout callback if we wanna the timeout event to be triggered
                // the connection will be closed so the abort handler will be called after the timeout
                if let Some(req) = self.request_weakref.get() {
                    if req.internal_event_callback.has_callback() {
                        self.set_timeout_handler();
                    }
                }
            } else {
                // if the timeout is 0, we don't need to trigger the timeout event
                // SAFETY: FFI handle
                unsafe { (*resp).clear_timeout() };
            }
            return true;
        }
        false
    }
}

const MAX_REQUEST_BODY_PREALLOCATE_LENGTH: usize = 1024 * 256;

// TODO(port): Zig `comptime { @export(...) }` block — these export
// `Bun__HTTPRequestContext{Debug?}{H3|TLS|}__{onResolve,onReject,onResolveStream,onRejectStream}`.
// Phase B: emit per-monomorphization `#[unsafe(no_mangle)] pub extern "C"` shims via macro
// (cannot be generic). The `#[bun_jsc::host_fn]` attribute on the methods provides the ABI.

pub struct StreamPair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub stream: WebCore::ReadableStream,
}

pub struct HeaderResponseSizePair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub size: usize,
}

pub struct HeaderResponsePair<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    pub this: &'a mut RequestContext<ThisServer, SSL, DBG, H3>,
    pub response: &'a mut Response,
}

pub struct PathnameFormatter<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> {
    ctx: &'a RequestContext<ThisServer, SSL, DBG, H3>,
}

impl<'a, ThisServer, const SSL: bool, const DBG: bool, const H3: bool> core::fmt::Display
    for PathnameFormatter<'a, ThisServer, SSL, DBG, H3>
{
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let this = self.ctx;

        if !this.pathname.is_empty() {
            return write!(writer, "{}", this.pathname);
        }

        if !this.flags.has_abort_handler() {
            if let Some(req) = this.req {
                // SAFETY: FFI handle valid while req is Some
                return write!(writer, "{}", bstr::BStr::new(unsafe { (*req).url() }));
            }
        }

        writer.write_str("/")
    }
}

// Retained only for `renderMetadata` to compute Content-Range / Content-Length
// for file-blob bodies; the actual fd/socket bookkeeping lives in
// `FileResponseStream` now.
#[derive(Default, Clone, Copy)]
pub struct SendfileContext {
    pub remain: Blob::SizeType,
    pub offset: Blob::SizeType,
    /// When non-zero, the Content-Range total (`/{total}` instead of `/*`).
    pub total: Blob::SizeType,
}

// `NewFlags(comptime debug_mode: bool)` — packed struct(u16). All fields are bool
// (with two debug-conditional ones), so `bitflags!` over u16 works. The Zig void/padding
// fields collapse to absent bits in release; here we keep all bits and just gate the
// `is_web_browser_navigation` / `has_finalized` accessors on the const params.
bitflags::bitflags! {
    #[derive(Default, Clone, Copy)]
    pub struct FlagsBits: u16 {
        const HAS_MARKED_COMPLETE         = 1 << 0;
        const HAS_MARKED_PENDING          = 1 << 1;
        const HAS_ABORT_HANDLER           = 1 << 2;
        const HAS_TIMEOUT_HANDLER         = 1 << 3;
        const HAS_SENDFILE_CTX            = 1 << 4;
        const HAS_CALLED_ERROR_HANDLER    = 1 << 5;
        const NEEDS_CONTENT_LENGTH        = 1 << 6;
        const NEEDS_CONTENT_RANGE         = 1 << 7;
        /// Used to avoid looking at the uws.Request struct after it's been freed
        const IS_TRANSFER_ENCODING        = 1 << 8;
        /// Used to identify if request can be safely deinitialized
        const IS_WAITING_FOR_REQUEST_BODY = 1 << 9;
        /// Used in renderMissing in debug mode to show the user an HTML page
        /// Used to avoid looking at the uws.Request struct after it's been freed
        const IS_WEB_BROWSER_NAVIGATION   = 1 << 10;
        const HAS_WRITTEN_STATUS          = 1 << 11;
        const RESPONSE_PROTECTED          = 1 << 12;
        const ABORTED                     = 1 << 13;
        const HAS_FINALIZED               = 1 << 14;
        const IS_ERROR_PROMISE_PENDING    = 1 << 15;
    }
}

#[repr(transparent)]
#[derive(Default, Clone, Copy)]
pub struct Flags<const DEBUG_MODE: bool>(FlagsBits);

macro_rules! flag_accessor {
    ($get:ident, $set:ident, $bit:ident) => {
        #[inline] pub fn $get(&self) -> bool { self.0.contains(FlagsBits::$bit) }
        #[inline] pub fn $set(&mut self, v: bool) { self.0.set(FlagsBits::$bit, v) }
    };
}

impl<const DEBUG_MODE: bool> Flags<DEBUG_MODE> {
    flag_accessor!(has_marked_complete, set_has_marked_complete, HAS_MARKED_COMPLETE);
    flag_accessor!(has_marked_pending, set_has_marked_pending, HAS_MARKED_PENDING);
    flag_accessor!(has_abort_handler, set_has_abort_handler, HAS_ABORT_HANDLER);
    flag_accessor!(has_timeout_handler, set_has_timeout_handler, HAS_TIMEOUT_HANDLER);
    flag_accessor!(has_sendfile_ctx, set_has_sendfile_ctx, HAS_SENDFILE_CTX);
    flag_accessor!(has_called_error_handler, set_has_called_error_handler, HAS_CALLED_ERROR_HANDLER);
    flag_accessor!(needs_content_length, set_needs_content_length, NEEDS_CONTENT_LENGTH);
    flag_accessor!(needs_content_range, set_needs_content_range, NEEDS_CONTENT_RANGE);
    flag_accessor!(is_transfer_encoding, set_is_transfer_encoding, IS_TRANSFER_ENCODING);
    flag_accessor!(is_waiting_for_request_body, set_is_waiting_for_request_body, IS_WAITING_FOR_REQUEST_BODY);
    flag_accessor!(has_written_status, set_has_written_status, HAS_WRITTEN_STATUS);
    flag_accessor!(response_protected, set_response_protected, RESPONSE_PROTECTED);
    flag_accessor!(aborted, set_aborted, ABORTED);
    flag_accessor!(is_error_promise_pending, set_is_error_promise_pending, IS_ERROR_PROMISE_PENDING);

    #[inline]
    pub fn is_web_browser_navigation(&self) -> bool {
        DEBUG_MODE && self.0.contains(FlagsBits::IS_WEB_BROWSER_NAVIGATION)
    }
    #[inline]
    pub fn set_is_web_browser_navigation(&mut self, v: bool) {
        if DEBUG_MODE {
            self.0.set(FlagsBits::IS_WEB_BROWSER_NAVIGATION, v)
        }
    }

    #[inline]
    pub fn has_finalized(&self) -> bool {
        cfg!(debug_assertions) && self.0.contains(FlagsBits::HAS_FINALIZED)
    }
    #[inline]
    pub fn set_has_finalized(&mut self, v: bool) {
        #[cfg(debug_assertions)]
        self.0.set(FlagsBits::HAS_FINALIZED, v);
        #[cfg(not(debug_assertions))]
        let _ = v;
    }
}

fn get_content_type(
    headers: Option<&FetchHeaders>,
    blob: &WebCore::Blob::Any,
) -> (MimeType, bool, bool) {
    let mut needs_content_type = true;
    let mut content_type_needs_free = false;

    let content_type: MimeType = 'brk: {
        if let Some(headers_) = headers {
            if let Some(content) = headers_.fast_get(FetchHeaders::Name::ContentType) {
                needs_content_type = false;

                let content_slice = content.to_slice();
                // TODO(port): Zig passes allocator iff the slice was heap-allocated; here
                // MimeType::init takes ownership of a clone when needed and reports via the flag.
                let mt = MimeType::init(content_slice.slice(), &mut content_type_needs_free);
                drop(content_slice);
                break 'brk mt;
            }
        }

        if !blob.content_type().is_empty() {
            MimeType::by_name(blob.content_type())
        } else if let Some(content) = MimeType::sniff(blob.slice()) {
            content
        } else if blob.was_string() {
            MimeType::TEXT
            // TODO: should we get the mime type off of the Blob.Store if it exists?
            // A little wary of doing this right now due to causing some breaking change
        } else {
            MimeType::OTHER
        }
    };

    (content_type, needs_content_type, content_type_needs_free)
}

// TODO(port): trait capturing the surface of `ThisServer` used by RequestContext.
// Phase B: replace with the concrete server trait from bun_runtime::server.
pub trait ServerLike {
    fn global_this(&self) -> &JSGlobalObject;
    fn vm(&self) -> &VirtualMachine;
    fn dev_server(&self) -> Option<&bun_bake::DevServer>;
    fn config(&self) -> &bun_runtime::server::ServerConfig;
    fn flags(&self) -> &bun_runtime::server::ServerFlags;
    fn js_value(&self) -> &jsc::JsRef;
    fn on_request_complete(&self);
    fn request_pool_allocator(&self) -> &dyn core::any::Any; // TODO(port): concrete pool type
    fn h3_request_pool_allocator(&self) -> &dyn core::any::Any; // TODO(port): concrete pool type
    fn h3_alt_svc(&self) -> Option<&[u8]> { None }
}

static WELCOME_PAGE_HTML_GZ: &[u8] = include_bytes!("../api/welcome-page.html.gz");

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/RequestContext.zig (2736 lines)
//   confidence: medium
//   todos:      25
//   notes:      comptime type-fn → const-generic struct + ServerLike trait; uws Transport/Response selection, threadlocal pool, and @export block stubbed for Phase B; sink ownership reshaped (Box drop = destroy()); response_jsvalue kept as bare JSValue + manual protect()
// ──────────────────────────────────────────────────────────────────────────
