use core::ffi::c_void;
use core::mem::{offset_of, MaybeUninit};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::io::Write as _;

use bun_core::{self, FeatureFlags};
use bun_logger::{Loc, Log};
use bun_str::{self, MutableString};
use bun_threading::thread_pool::{self, Batch, Task, ThreadPool};
use bun_threading::Channel;
use bun_url::{PercentEncoding, URL};

use bun_dotenv::Loader as DotEnvLoader;
use bun_http_types::Encoding;
use bun_picohttp as picohttp;

use crate::headers::{self, Headers};
use crate::http_client_result::{self, HTTPClientResult};
use crate::{
    FetchRedirect, HTTPClient, HTTPRequestBody, HTTPThread, HTTPVerboseLevel, Method, Signals,
    ThreadlocalAsyncHTTP,
};

// TODO(port): SSLConfig lives under bun_runtime::api::server::ServerConfig; verify crate path in Phase B.
use bun_runtime::api::server::server_config::ssl_config::SharedPtr as SSLConfigSharedPtr;

bun_output::declare_scope!(AsyncHTTP, visible);

pub struct AsyncHTTP<'a> {
    pub request: Option<picohttp::Request>,
    pub response: Option<picohttp::Response>,
    pub request_headers: headers::EntryList,
    pub response_headers: headers::EntryList,
    pub response_buffer: &'a mut MutableString,
    pub request_body: HTTPRequestBody,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc is used everywhere.
    pub request_header_buf: &'a [u8],
    pub method: Method,
    pub url: URL,
    pub http_proxy: Option<URL>,
    pub real: Option<&'a mut AsyncHTTP<'a>>,
    /// Intrusive link for `UnboundedQueue(AsyncHTTP, .next)` in HTTPThread.
    pub next: *mut AsyncHTTP<'a>,

    pub task: thread_pool::Task,
    pub result_callback: http_client_result::Callback,

    pub redirected: bool,

    pub response_encoding: Encoding,
    pub verbose: HTTPVerboseLevel,

    pub client: HTTPClient,
    pub waiting_deffered: bool,
    pub finalized: bool,
    pub err: Option<bun_core::Error>,
    pub async_http_id: u32,

    pub state: AtomicState,
    pub elapsed: u64,
    pub gzip_elapsed: u64,

    pub signals: Signals,
}

pub static ACTIVE_REQUESTS_COUNT: AtomicUsize = AtomicUsize::new(0);
pub static MAX_SIMULTANEOUS_REQUESTS: AtomicUsize = AtomicUsize::new(256);

pub fn load_env(logger: &mut Log, env: &mut DotEnvLoader) {
    if let Some(max_http_requests) = env.get(b"BUN_CONFIG_MAX_HTTP_REQUESTS") {
        // TODO(port): narrow error set
        // PORT NOTE: env vars are bytes — never round-trip through &str. Zig used std.fmt.parseInt
        // on []const u8 directly; map to the byte-slice parser in bun_str::strings.
        let max: u16 = match bun_str::strings::parse_int::<u16>(max_http_requests, 10).ok() {
            Some(v) => v,
            None => {
                logger
                    .add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "BUN_CONFIG_MAX_HTTP_REQUESTS value \"{}\" is not a valid integer between 1 and 65535",
                            bstr::BStr::new(max_http_requests),
                        ),
                    )
                    .expect("unreachable");
                return;
            }
        };
        if max == 0 {
            logger
                .add_warning_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "BUN_CONFIG_MAX_HTTP_REQUESTS value must be a number between 1 and 65535"
                    ),
                )
                .expect("unreachable");
            return;
        }
        MAX_SIMULTANEOUS_REQUESTS.store(usize::from(max), Ordering::Relaxed);
    }
}

impl<'a> AsyncHTTP<'a> {
    pub fn signal_header_progress(&mut self) {
        let Some(progress) = self.signals.header_progress else {
            return;
        };
        progress.store(true, Ordering::Release);
    }

    pub fn enable_response_body_streaming(&mut self) {
        let Some(stream) = self.signals.response_body_streaming else {
            return;
        };
        stream.store(true, Ordering::Release);
    }

    pub fn clear_data(&mut self) {
        // PORT NOTE: `response_headers.deinit(allocator)` becomes drop-in-place via assignment.
        self.response_headers = headers::EntryList::default();
        self.request = None;
        self.response = None;
        // TODO(port): ZigString.Slice ownership semantics — verify deinit is needed or Drop handles it.
        self.client.unix_socket_path.deinit();
        self.client.unix_socket_path = bun_str::zig_string::Slice::empty();
    }
}

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum State {
    Pending = 0,
    Scheduled = 1,
    Sending = 2,
    Success = 3,
    Fail = 4,
}

#[repr(transparent)]
pub struct AtomicState(AtomicU32);

impl AtomicState {
    pub const fn new(s: State) -> Self {
        Self(AtomicU32::new(s as u32))
    }
    pub fn store(&self, s: State, order: Ordering) {
        self.0.store(s as u32, order);
    }
    pub fn load(&self, order: Ordering) -> State {
        // SAFETY: only ever stored via `store` above with valid `State` discriminants.
        unsafe { core::mem::transmute::<u32, State>(self.0.load(order)) }
    }
}

#[derive(Default)]
pub struct Options<'a> {
    pub http_proxy: Option<URL>,
    pub proxy_headers: Option<Headers>,
    // PORT NOTE: Zig had `?[]u8` (mutable slice); only ever read, so `&[u8]` here.
    pub hostname: Option<&'a [u8]>,
    pub signals: Option<Signals>,
    pub unix_socket_path: Option<bun_str::zig_string::Slice>,
    pub disable_timeout: Option<bool>,
    pub verbose: Option<HTTPVerboseLevel>,
    pub disable_keepalive: Option<bool>,
    pub disable_decompression: Option<bool>,
    pub reject_unauthorized: Option<bool>,
    pub tls_props: Option<SSLConfigSharedPtr>,
}

struct Preconnect {
    // TODO(port): self-referential — `async_http.response_buffer` borrows `self.response_buffer`.
    // Zig relied on stable heap addresses from `bun.TrivialNew`. Phase B: Pin<Box<Self>> or raw ptr.
    // TODO(port): in-place init — MaybeUninit because AsyncHTTP holds `&mut MutableString` (non-null)
    // so `mem::zeroed()` is UB; Zig wrote the field after heap allocation once the address was stable.
    async_http: MaybeUninit<AsyncHTTP<'static>>,
    response_buffer: MutableString,
    url: URL,
    is_url_owned: bool,
}

impl Preconnect {
    pub fn new(init: Preconnect) -> *mut Preconnect {
        // bun.TrivialNew(@This()) — heap-allocate and return raw pointer for intrusive use.
        Box::into_raw(Box::new(init))
    }

    pub fn on_result(this: *mut Preconnect, _: &mut AsyncHTTP<'_>, _: HTTPClientResult) {
        // SAFETY: `this` was produced by `Preconnect::new` (Box::into_raw) and is uniquely owned here;
        // `async_http` was fully written in `preconnect()` before scheduling.
        unsafe {
            (*this).response_buffer.deinit();
            let async_http = (*this).async_http.assume_init_mut();
            async_http.clear_data();
            async_http.client.deinit();
            if (*this).is_url_owned {
                // PORT NOTE: Zig freed `url.href` via default_allocator. In Rust the owned href
                // would be a `Box<[u8]>`/`Vec<u8>` on URL; rely on Drop in Phase B.
                // TODO(port): verify URL.href ownership model.
            }
            drop(Box::from_raw(this));
        }
    }
}

pub fn preconnect(url: URL, is_url_owned: bool) {
    if !FeatureFlags::IS_FETCH_PRECONNECT_SUPPORTED {
        if is_url_owned {
            // PORT NOTE: Zig freed url.href here. See note in Preconnect::on_result.
            // TODO(port): verify URL.href ownership model.
            drop(url);
        }
        return;
    }

    // TODO(port): self-referential init — `&mut this.response_buffer` is borrowed by
    // `this.async_http` while both live in the same heap allocation. Phase B: split allocation
    // or use raw pointer for `response_buffer` field.
    let this = Preconnect::new(Preconnect {
        async_http: MaybeUninit::uninit(),
        response_buffer: MutableString::default(),
        url,
        is_url_owned,
    });

    // SAFETY: `this` is a freshly Box-allocated, uniquely-owned pointer; we in-place write
    // `async_http` before any read and before it can be observed by another thread.
    unsafe {
        (*this).async_http.write(AsyncHTTP::init(
            Method::GET,
            (*this).url.clone(),
            headers::EntryList::default(),
            b"",
            &mut *(&mut (*this).response_buffer as *mut MutableString),
            b"",
            http_client_result::Callback::new::<Preconnect>(this, Preconnect::on_result),
            FetchRedirect::Manual,
            Options::default(),
        ));
        let async_http = (*this).async_http.assume_init_mut();
        async_http.client.flags.is_preconnect_only = true;

        crate::http_thread().schedule(Batch::from(&mut async_http.task));
    }
}

impl<'a> AsyncHTTP<'a> {
    pub fn init(
        method: Method,
        url: URL,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        response_buffer: &'a mut MutableString,
        request_body: &'a [u8],
        callback: http_client_result::Callback,
        redirect_type: FetchRedirect,
        options: Options<'a>,
    ) -> AsyncHTTP<'a> {
        let async_http_id = if options
            .signals
            .as_ref()
            .map(|s| s.aborted.is_some())
            .unwrap_or(false)
        {
            crate::ASYNC_HTTP_ID_MONOTONIC.fetch_add(1, Ordering::Relaxed)
        } else {
            0
        };

        let signals = options.signals.clone().unwrap_or_default();
        let http_proxy = options.http_proxy.clone();

        // PORT NOTE: reshaped for borrowck — Zig wrote `this.* = .{ .client = undefined, ... }`
        // then `this.client = .{...}`. Rust has no `undefined` and `mem::zeroed::<HTTPClient>()` is
        // UB (HTTPClient has Option/slice/enum fields, not #[repr(C)] POD), so build the client
        // literal first and move it into the AsyncHTTP literal.
        let client = HTTPClient {
            method,
            url: url.clone(),
            header_entries: headers.clone(),
            header_buf: headers_buf,
            hostname: options.hostname,
            signals: options.signals.unwrap_or_else(|| signals.clone()),
            async_http_id,
            http_proxy: http_proxy.clone(),
            proxy_headers: options.proxy_headers,
            redirect_type,
            ..HTTPClient::default()
        };

        let mut this = AsyncHTTP {
            request: None,
            response: None,
            request_headers: headers,
            response_headers: headers::EntryList::default(),
            response_buffer,
            request_body: HTTPRequestBody::Bytes(request_body),
            request_header_buf: headers_buf,
            method,
            url,
            http_proxy,
            real: None,
            next: core::ptr::null_mut(),
            task: thread_pool::Task {
                callback: start_async_http,
            },
            result_callback: callback,
            redirected: false,
            response_encoding: Encoding::Identity,
            verbose: HTTPVerboseLevel::None,
            client,
            waiting_deffered: false,
            finalized: false,
            err: None,
            async_http_id,
            state: AtomicState::new(State::Pending),
            elapsed: 0,
            gzip_elapsed: 0,
            signals,
        };
        if let Some(val) = options.unix_socket_path {
            debug_assert!(this.client.unix_socket_path.length() == 0);
            this.client.unix_socket_path = val;
        }
        if let Some(val) = options.disable_timeout {
            this.client.flags.disable_timeout = val;
        }
        if let Some(val) = options.verbose {
            this.client.verbose = val;
        }
        if let Some(val) = options.disable_decompression {
            this.client.flags.disable_decompression = val;
        }
        if let Some(val) = options.disable_keepalive {
            this.client.flags.disable_keepalive = val;
        }
        if let Some(val) = options.reject_unauthorized {
            this.client.flags.reject_unauthorized = val;
        }
        if let Some(val) = options.tls_props {
            this.client.tls_props = Some(val);
        }

        if let Some(proxy) = &options.http_proxy {
            if !proxy.username.is_empty() {
                // PERF(port): was stack-fallback (4096) — profile in Phase B
                let username = match PercentEncoding::decode_alloc(proxy.username) {
                    Ok(u) => u,
                    Err(err) => {
                        bun_output::scoped_log!(
                            AsyncHTTP,
                            "failed to decode proxy username: {}",
                            err
                        );
                        return this;
                    }
                };

                if !proxy.password.is_empty() {
                    // PERF(port): was stack-fallback (4096) — profile in Phase B
                    let password = match PercentEncoding::decode_alloc(proxy.password) {
                        Ok(p) => p,
                        Err(err) => {
                            bun_output::scoped_log!(
                                AsyncHTTP,
                                "failed to decode proxy password: {}",
                                err
                            );
                            return this;
                        }
                    };

                    // concat user and password
                    let mut auth: Vec<u8> = Vec::with_capacity(username.len() + 1 + password.len());
                    write!(&mut auth, "{}:{}", bstr::BStr::new(&username), bstr::BStr::new(&password))
                        .expect("unreachable");
                    let size = bun_base64::standard_encode_len(auth.len());
                    let mut buf = vec![0u8; size + b"Basic ".len()];
                    let encoded_len =
                        bun_base64::url_safe_encode(&mut buf[b"Basic ".len()..], &auth);
                    buf[..b"Basic ".len()].copy_from_slice(b"Basic ");
                    buf.truncate(b"Basic ".len() + encoded_len);
                    this.client.proxy_authorization = Some(buf.into_boxed_slice());
                } else {
                    // only use user
                    let size = bun_base64::standard_encode_len(username.len());
                    let mut buf = vec![0u8; size + b"Basic ".len()];
                    let encoded_len =
                        bun_base64::url_safe_encode(&mut buf[b"Basic ".len()..], &username);
                    buf[..b"Basic ".len()].copy_from_slice(b"Basic ");
                    buf.truncate(b"Basic ".len() + encoded_len);
                    this.client.proxy_authorization = Some(buf.into_boxed_slice());
                }
            }
        }
        this
    }

    pub fn init_sync(
        method: Method,
        url: URL,
        headers: headers::EntryList,
        headers_buf: &'a [u8],
        response_buffer: &'a mut MutableString,
        request_body: &'a [u8],
        http_proxy: Option<URL>,
        hostname: Option<&'a [u8]>,
        redirect_type: FetchRedirect,
    ) -> AsyncHTTP<'a> {
        Self::init(
            method,
            url,
            headers,
            headers_buf,
            response_buffer,
            request_body,
            // PORT NOTE: Zig passed `undefined` for callback in sync mode.
            http_client_result::Callback::default(),
            redirect_type,
            Options {
                http_proxy,
                hostname,
                ..Options::default()
            },
        )
    }

    fn reset(&mut self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let aborted = self.client.aborted;
        self.client = HTTPClient::init(
            self.method,
            self.client.url.clone(),
            self.client.header_entries.clone(),
            self.client.header_buf,
            aborted,
        )?;
        self.client.http_proxy = self.http_proxy.clone();

        if let Some(proxy) = &self.http_proxy {
            // TODO: need to understand how is possible to reuse Proxy with TSL, so disable keepalive if url is HTTPS
            self.client.flags.disable_keepalive = self.url.is_https();
            if !proxy.username.is_empty() {
                // PERF(port): was stack-fallback (4096) — profile in Phase B
                let username = match PercentEncoding::decode_alloc(proxy.username) {
                    Ok(u) => u,
                    Err(err) => {
                        bun_output::scoped_log!(
                            AsyncHTTP,
                            "failed to decode proxy username: {}",
                            err
                        );
                        return Ok(());
                    }
                };

                if !proxy.password.is_empty() {
                    // PERF(port): was stack-fallback (4096) — profile in Phase B
                    let password = match PercentEncoding::decode_alloc(proxy.password) {
                        Ok(p) => p,
                        Err(err) => {
                            bun_output::scoped_log!(
                                AsyncHTTP,
                                "failed to decode proxy password: {}",
                                err
                            );
                            return Ok(());
                        }
                    };

                    // concat user and password
                    let mut auth: Vec<u8> = Vec::with_capacity(username.len() + 1 + password.len());
                    write!(&mut auth, "{}:{}", bstr::BStr::new(&username), bstr::BStr::new(&password))
                        .expect("unreachable");
                    let size = bun_base64::standard_encode_len(auth.len());
                    let mut buf = vec![0u8; size + b"Basic ".len()];
                    let encoded_len =
                        bun_base64::url_safe_encode(&mut buf[b"Basic ".len()..], &auth);
                    buf[..b"Basic ".len()].copy_from_slice(b"Basic ");
                    buf.truncate(b"Basic ".len() + encoded_len);
                    self.client.proxy_authorization = Some(buf.into_boxed_slice());
                } else {
                    // only use user
                    let size = bun_base64::standard_encode_len(username.len());
                    let mut buf = vec![0u8; size + b"Basic ".len()];
                    let encoded_len =
                        bun_base64::url_safe_encode(&mut buf[b"Basic ".len()..], &username);
                    buf[..b"Basic ".len()].copy_from_slice(b"Basic ");
                    buf.truncate(b"Basic ".len() + encoded_len);
                    self.client.proxy_authorization = Some(buf.into_boxed_slice());
                }
            }
        }
        Ok(())
    }

    pub fn schedule(&mut self, batch: &mut Batch) {
        self.state.store(State::Scheduled, Ordering::Relaxed);
        batch.push(Batch::from(&mut self.task));
    }
}

fn send_sync_callback(
    this: &mut SingleHTTPChannel,
    async_http: &mut AsyncHTTP<'_>,
    result: HTTPClientResult,
) {
    // PORT NOTE: reshaped for borrowck — Zig did `async_http.real.?.* = async_http.*` (struct copy
    // back into the original). In Rust `AsyncHTTP` is not `Copy` and `real` borrows mutably; copy
    // fields back individually in Phase B or rethink as raw ptr.
    // TODO(port): copy `async_http` state back into `*async_http.real`.
    let real = async_http.real.as_deref_mut().unwrap();
    // SAFETY: Zig copies the whole struct; `response_buffer` is the only field re-assigned after.
    // Phase B must decide which fields actually need copying.
    real.response_buffer = unsafe {
        // Re-borrow the same buffer the clone was using.
        &mut *(async_http.response_buffer as *mut MutableString)
    };
    this.channel.write_item(result).expect("unreachable");
}

impl<'a> AsyncHTTP<'a> {
    pub fn send_sync(&mut self) -> Result<picohttp::Response, bun_core::Error> {
        HTTPThread::init(&Default::default());

        // PORT NOTE: Zig leaks `ctx` (never destroyed). Preserve that for now.
        let ctx: &'static mut SingleHTTPChannel = Box::leak(Box::new(SingleHTTPChannel::init()));
        self.result_callback =
            http_client_result::Callback::new::<SingleHTTPChannel>(ctx, send_sync_callback);

        let mut batch = Batch::default();
        self.schedule(&mut batch);
        crate::http_thread().schedule(batch);

        let result = ctx.channel.read_item().expect("unreachable");
        if let Some(err) = result.fail {
            return Err(err);
        }
        debug_assert!(result.metadata.is_some());
        Ok(result.metadata.unwrap().response)
    }

    pub fn on_async_http_callback(
        &mut self,
        async_http: &mut AsyncHTTP<'_>,
        result: HTTPClientResult,
    ) {
        debug_assert!(self.real.is_some());

        let callback = self.result_callback;
        self.elapsed = crate::http_thread().timer.read().saturating_sub(self.elapsed);

        // TODO: this condition seems wrong: if we started with a non-default value, we might
        // report a redirect even if none happened
        self.redirected = self.client.flags.redirected;
        if result.is_success() {
            self.err = None;
            if let Some(metadata) = &result.metadata {
                self.response = Some(metadata.response.clone());
            }
            self.state.store(State::Success, Ordering::Relaxed);
        } else {
            self.err = result.fail;
            self.response = None;
            self.state.store(State::Fail, Ordering::Relaxed);
        }

        #[cfg(feature = "debug_logs")]
        {
            if crate::socket_async_http_abort_tracker().count() > 0 {
                bun_output::scoped_log!(
                    AsyncHTTP,
                    "bun.http.socket_async_http_abort_tracker count: {}",
                    crate::socket_async_http_abort_tracker().count()
                );
            }
        }

        if crate::socket_async_http_abort_tracker().capacity() > 10_000
            && crate::socket_async_http_abort_tracker().count() < 100
        {
            let count = crate::socket_async_http_abort_tracker().count();
            crate::socket_async_http_abort_tracker().shrink_and_free(count);
        }

        if result.has_more {
            (callback.function)(callback.ctx, async_http, result);
        } else {
            {
                self.client.deinit();
                // SAFETY: `async_http` is the `async_http` field of a `ThreadlocalAsyncHTTP`
                // (allocated by HTTPThread); recover the parent via field offset.
                let threadlocal_http: &mut ThreadlocalAsyncHTTP = unsafe {
                    &mut *((async_http as *mut AsyncHTTP<'_> as *mut u8)
                        .sub(offset_of!(ThreadlocalAsyncHTTP, async_http))
                        .cast::<ThreadlocalAsyncHTTP>())
                };
                bun_output::scoped_log!(AsyncHTTP, "onAsyncHTTPCallback: {:?}", self.elapsed);
                (callback.function)(callback.ctx, async_http, result);
                // PORT NOTE: Zig `defer threadlocal_http.deinit()` — explicit call after callback.
                threadlocal_http.deinit();
            }

            let active_requests = ACTIVE_REQUESTS_COUNT.fetch_sub(1, Ordering::Relaxed);
            debug_assert!(active_requests > 0);
        }

        if (!crate::http_thread().queued_tasks.is_empty()
            || !crate::http_thread().deferred_tasks.is_empty())
            && ACTIVE_REQUESTS_COUNT.load(Ordering::Relaxed)
                < MAX_SIMULTANEOUS_REQUESTS.load(Ordering::Relaxed)
        {
            crate::http_thread().loop_.loop_.wakeup();
        }
    }
}

pub fn start_async_http(task: *mut Task) {
    // SAFETY: `task` points to the `task` field of an `AsyncHTTP` scheduled via `schedule()`.
    let this: &mut AsyncHTTP<'_> = unsafe {
        &mut *((task as *mut u8)
            .sub(offset_of!(AsyncHTTP<'static>, task))
            .cast::<AsyncHTTP<'_>>())
    };
    this.on_start();
}

impl<'a> AsyncHTTP<'a> {
    pub fn on_start(&mut self) {
        let _ = ACTIVE_REQUESTS_COUNT.fetch_add(1, Ordering::Relaxed);
        self.err = None;
        self.state.store(State::Sending, Ordering::Relaxed);
        self.client.result_callback = http_client_result::Callback::new::<AsyncHTTP<'_>>(
            self,
            AsyncHTTP::on_async_http_callback,
        );

        self.elapsed = crate::http_thread().timer.read();
        if self.response_buffer.list.capacity() == 0 {
            // PORT NOTE: Zig reassigned `response_buffer.allocator = bun.http.default_allocator`.
            // MutableString in Rust uses the global allocator unconditionally; nothing to do.
        }
        self.client
            .start(self.request_body.clone(), self.response_buffer);
    }
}

// TODO(port): `HTTPCallbackPair` — Zig anonymous tuple `.{ *AsyncHTTP, HTTPClientResult }`.
// Using raw pointer to avoid lifetime parameter on the type alias.
pub type HTTPCallbackPair = (*mut AsyncHTTP<'static>, HTTPClientResult);

// TODO(port): `Channel(T, .{ .Static = N })` — model buffer policy as const-generic capacity.
pub type HTTPChannel = Channel<HTTPCallbackPair, 1000>;

// 32 pointers much cheaper than 1000 pointers
pub struct SingleHTTPChannel {
    channel: Channel<HTTPClientResult, 8>,
}

impl SingleHTTPChannel {
    pub fn reset(&mut self) {}
    pub fn init() -> SingleHTTPChannel {
        SingleHTTPChannel {
            channel: Channel::<HTTPClientResult, 8>::init(),
        }
    }
}

pub struct HTTPChannelContext {
    pub http: AsyncHTTP<'static>,
    // TODO(port): lifetime — no init/assignment found in src/http/; appears unused.
    pub channel: Option<NonNull<HTTPChannel>>,
}

impl HTTPChannelContext {
    pub fn callback(data: HTTPCallbackPair) {
        // SAFETY: `data.0` points to the `http` field of an `HTTPChannelContext`.
        let this: &mut HTTPChannelContext = unsafe {
            &mut *((data.0 as *mut u8)
                .sub(offset_of!(HTTPChannelContext, http))
                .cast::<HTTPChannelContext>())
        };
        // SAFETY: channel is set by the owner before scheduling; Zig dereferenced unconditionally.
        unsafe { this.channel.unwrap().as_mut() }
            .write_item(data)
            .expect("unreachable");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/AsyncHTTP.zig (494 lines)
//   confidence: medium
//   todos:      13
//   notes:      <'a> on AsyncHTTP per LIFETIMES.tsv creates self-ref in Preconnect (MaybeUninit in-place init) & send_sync_callback struct-copy; Phase B may need raw ptrs. base64/Channel/Callback::new/parse_int signatures assumed.
// ──────────────────────────────────────────────────────────────────────────
