//! This is the code for the object returned by Bun.listen().

use core::ffi::{c_char, c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_boringssl_sys as boring_sys;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsClass, JsResult};
use bun_jsc::strong::Optional as Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::zig_string::ZigString;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, PathBuffer};
use bun_str::{self as strings_mod, strings};
use bun_sys::{self, Fd};
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::api::bun_secure_context::SecureContext;
use crate::node::path as node_path;
use crate::socket::{Handlers, NewSocket, SocketConfig, SocketFlags, SocketMode, TCPSocket, TLSSocket};
use crate::socket::SSLConfig;

#[cfg(windows)]
use crate::socket::WindowsNamedPipeContext;

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

declare_scope!(Listener, visible);

macro_rules! log {
    ($($arg:tt)*) => { scoped_log!(Listener, $($arg)*) };
}

// ── Local shim (Phase D) ────────────────────────────────────────────────
// upstream in bun_jsc; bridge it here over `throw_invalid_arguments`.
trait JSGlobalObjectListenerExt {
    fn throw_not_enough_arguments(&self, name_: &str, expected: usize, got: usize) -> jsc::JsError;
}
impl JSGlobalObjectListenerExt for JSGlobalObject {
    fn throw_not_enough_arguments(&self, name_: &str, expected: usize, got: usize) -> jsc::JsError {
        self.throw_invalid_arguments(format_args!(
            "Not enough arguments to '{name_}'. Expected {expected}, got {got}."
        ))
    }
}

/// Bridge JS-thread `VirtualMachine` to the aio-level `EventLoopCtx` used by
/// `KeepAlive::ref_/unref`.
#[inline]
fn vm_event_loop_ctx() -> bun_aio::EventLoopCtx {
    bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
}

/// Bridge to the per-VM digest-keyed weak `SSL_CTX*` cache. The
/// `bun_jsc::rare_data::SSLContextCache` slot is an opaque cycle-break stub;
/// the concrete cache lives on `crate::jsc_hooks::RuntimeState`.
#[inline]
fn vm_ssl_ctx_cache() -> *mut crate::api::SSLContextCache::SSLContextCache {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(!state.is_null(), "runtime_state() before init_runtime_state");
    // SAFETY: `state` is the per-thread `RuntimeState` boxed in
    // `init_runtime_state`; address-stable until VM teardown.
    unsafe { core::ptr::addr_of_mut!((*state).ssl_ctx_cache) }
}

// `jsc.Codegen.JSListener.toJS` — direct extern so we can hand the C++ side an
// already-heap-allocated `*mut Listener` (the embedded `group` is linked into
// the loop's intrusive list at its final address before this call, so the
// `Box::new`-then-move that the `#[JsClass]` `to_js(self)` impl does would
// invalidate that link).
#[allow(improper_ctypes)]
#[cfg(all(windows, target_arch = "x86_64"))]
unsafe extern "sysv64" {
    #[link_name = "Listener__create"]
    fn Listener__create(global: *mut JSGlobalObject, ptr: *mut Listener) -> JSValue;
}
#[allow(improper_ctypes)]
#[cfg(not(all(windows, target_arch = "x86_64")))]
unsafe extern "C" {
    #[link_name = "Listener__create"]
    fn Listener__create(global: *mut JSGlobalObject, ptr: *mut Listener) -> JSValue;
}

#[bun_jsc::JsClass(no_constructor)]
pub struct Listener {
    pub handlers: Handlers,
    pub listener: ListenerType,

    pub poll_ref: KeepAlive,
    pub connection: UnixOrHost,
    /// Embedded sweep/iteration list-head for every accepted socket on this
    /// listener. `group.ext` = `*Listener`, so the dispatch handler recovers us
    /// from the socket without a context-ext lookup.
    pub group: uws::SocketGroup,
    /// `SSL_CTX*` for accepted sockets. One owned ref; `SSL_CTX_free` on close.
    /// `SSL_new()` per-accept takes its own ref, so accepted sockets outlive a
    /// stopped listener safely.
    pub secure_ctx: Option<NonNull<boring_sys::SSL_CTX>>,
    pub ssl: bool,
    pub protos: Option<Box<[u8]>>,

    pub strong_data: Strong,
    pub strong_self: Strong,
}

pub enum ListenerType {
    Uws(*mut uws_sys::ListenSocket),
    /// Raw heap pointer (not `Box`) to match .zig:31 `*WindowsNamedPipeListeningContext`.
    /// The context's address is registered with libuv (`uv_pipe.data`) for the
    /// lifetime of the handle, so we must never assert `noalias` over it via a
    /// Box move or `&mut Listener` that transitively covers the context — that
    /// would invalidate the pointer libuv holds under Stacked Borrows. Ownership
    /// is still unique; freed via `close_pipe_and_deinit` → `on_pipe_closed` → `deinit`.
    NamedPipe(NonNull<WindowsNamedPipeListeningContext>),
    None,
}

impl Default for ListenerType {
    fn default() -> Self {
        ListenerType::None
    }
}

impl Listener {
    #[bun_jsc::host_fn(getter)]
    pub fn get_data(this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getData()");
        this.strong_data.get().unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(this: &mut Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        log!("setData()");
        this.strong_data.set(global, value);
        Ok(true)
    }
}

#[derive(Clone)]
pub enum UnixOrHost {
    Unix(Box<[u8]>),
    Host { host: Box<[u8]>, port: u16 },
    Fd(Fd),
}

impl UnixOrHost {
    pub fn clone_owned(&self) -> UnixOrHost {
        match self {
            UnixOrHost::Unix(u) => UnixOrHost::Unix(Box::<[u8]>::from(&**u)),
            UnixOrHost::Host { host, port } => UnixOrHost::Host {
                host: Box::<[u8]>::from(&**host),
                port: *port,
            },
            UnixOrHost::Fd(f) => UnixOrHost::Fd(*f),
        }
    }
    // PORT NOTE: deinit() deleted — Box<[u8]> fields auto-drop.
}

impl Listener {
    #[bun_jsc::host_fn(method)]
    pub fn reload(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_old::<1>();

        if args.len < 1
            || (matches!(this.listener, ListenerType::None) && this.handlers.active_connections == 0)
        {
            return Err(global.throw(format_args!("Expected 1 argument")));
        }

        let opts = args.ptr[0];
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected options object")));
        }

        let socket_obj = match opts.get(global, "socket")? {
            Some(v) => v,
            None => return Err(global.throw(format_args!("Expected \"socket\" object"))),
        };

        // SAFETY: JSC_BORROW — global lives for the program; Handlers stores `&'static`.
        let global_static: &'static JSGlobalObject =
            unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) };
        let handlers = Handlers::from_js(global_static, socket_obj, this.handlers.mode == SocketMode::Server)?;
        // Preserve the live connection count across the struct assignment. `Handlers.fromJS`
        // returns `active_connections = 0`, but existing accepted sockets each hold a +1 via
        // `markActive`. Without this, closing any of them after reload would underflow the
        // counter (panic in safe builds, wrap in release).
        let active_connections = this.handlers.active_connections;
        // PORT NOTE: Zig `this.handlers.deinit()` — Drop handles unprotect; assignment below drops old.
        this.handlers = handlers;
        this.handlers.active_connections = active_connections;

        Ok(JSValue::UNDEFINED)
    }

    // PORT NOTE: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub fn listen(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        log!("listen");
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        // SAFETY: VirtualMachine::get() returns the per-thread VM; valid for program lifetime.
        let vm: &'static mut VirtualMachine = unsafe { &mut *VirtualMachine::get() };
        // SAFETY: JSC_BORROW — global lives for the program.
        let global_static: &'static JSGlobalObject =
            unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) };

        let mut socket_config = SocketConfig::from_js(vm, opts, global_static, true)?;
        // PORT NOTE: `defer socket_config.deinitExcludingHandlers()` — handled by Drop on SocketConfig
        // (excluding handlers, which are moved out below). // TODO(port): verify SocketConfig Drop semantics

        // Only deinit handlers if there's an error; otherwise we put them in a `Listener` and
        // need them to stay alive.
        // TODO(port): errdefer handlers.deinit() — scopeguard captures &mut into socket_config; reshaped below.

        let port = socket_config.port;
        let ssl_enabled = socket_config.ssl.is_some();
        let socket_flags = socket_config.socket_flags();

        #[cfg(windows)]
        if port.is_none() {
            // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
            let mut buf = PathBuffer::uninit();
            if let Some(_pipe_name) = normalize_pipe_name(socket_config.hostname_or_unix.slice(), buf.as_mut_slice()) {
                let _ = (vm, global_static, ssl_enabled);
                todo!("blocked_on: WindowsNamedPipeListeningContext::listen — Windows named-pipe listen path");
            }
        }

        // SAFETY: event_loop() returns a non-null *mut EventLoop owned by the VM.
        unsafe { (*vm.event_loop()).ensure_waker() };

        // Allocate the Listener up front so the embedded `group` has its final
        // address before we hand it to listen() (it's linked into the loop's
        // intrusive list).
        // PORT NOTE: by-value move of Handlers. Zig copied the struct then ran
        // `deinitExcludingHandlers()` on the original. Here we read the handlers
        // out by raw ptr and prevent double-drop by clearing the source via
        // `deinit_excluding_handlers` + `mem::forget`.
        // SAFETY: socket_config.handlers is valid; we forget socket_config below to avoid double-drop.
        let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
        let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
        let default_data = socket_config.default_data;
        let hostname_owned: Box<[u8]> = socket_config.hostname_or_unix.slice().to_vec().into_boxed_slice();
        let fd_opt = socket_config.fd;
        let ssl_cfg_taken = socket_config.ssl.take();
        // Prevent double-drop of `handlers` (moved out above).
        core::mem::forget(socket_config);

        let this: *mut Listener = Box::into_raw(Box::new(Listener {
            handlers: handlers_moved,
            // Placeholder until `this_ref.connection = connection` below; Zig used `undefined`.
            // Cannot `mem::zeroed()` a Rust enum (UB).
            connection: UnixOrHost::Fd(Fd::invalid()),
            ssl: ssl_enabled,
            protos: protos_taken,
            listener: ListenerType::None,
            poll_ref: KeepAlive::init(),
            group: uws::SocketGroup::default(),
            secure_ctx: None,
            strong_data: Strong::empty(),
            strong_self: Strong::empty(),
        }));
        // SAFETY: just allocated, non-null, exclusive
        let this_ref = unsafe { &mut *this };
        this_ref.group.init(uws::Loop::get(), None, this as *mut c_void);
        // `Listener` is mimalloc-allocated, so LSAN can't trace `loop->data.head →
        // this.group → head_sockets → us_socket_t` once the only pointer into the
        // group lives inside a mimalloc page. Registering the embedded group as a
        // root region restores reachability for the accepted sockets' allocations.
        // Paired unregister in `deinit()` (and the errdefer below).
        bun_core::asan::register_root_region(
            &this_ref.group as *const _ as *const c_void,
            size_of::<uws::SocketGroup>(),
        );
        let listener_allocated = core::cell::Cell::new(true);
        let cleanup = scopeguard::guard((), |()| {
            if listener_allocated.get() {
                // SAFETY: this is still the sole owner on the error path
                let this_ref = unsafe { &mut *this };
                if let Some(c) = this_ref.secure_ctx {
                    // SAFETY: FFI — secure_ctx holds one owned SSL_CTX ref from create_ssl_context
                    unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) };
                }
                // protos: Box drops automatically when Listener is dropped below
                bun_core::asan::unregister_root_region(
                    &this_ref.group as *const _ as *const c_void,
                    size_of::<uws::SocketGroup>(),
                );
                // SAFETY: group was init'd above; not concurrently walked.
                unsafe { uws::SocketGroup::destroy(&mut this_ref.group) };
                // SAFETY: reclaim the Box we leaked via into_raw
                drop(unsafe { Box::from_raw(this) });
            }
        });
        // TODO(port): errdefer — `cleanup` closure above approximates the Zig errdefer; verify
        // borrow scoping in Phase B (captures `listener_allocated` + raw `this`).

        if let Some(ssl_cfg) = ssl_cfg_taken.as_ref() {
            let mut create_err = uws::create_bun_socket_error_t::none;
            match ssl_cfg.as_usockets().create_ssl_context(&mut create_err) {
                Some(ctx) => this_ref.secure_ctx = NonNull::new(ctx.cast::<boring_sys::SSL_CTX>()),
                None => {
                    return Err(global.throw_value(
                        crate::socket::uws_jsc::create_bun_socket_error_to_js(create_err, global),
                    ));
                }
            }
        }
        let kind: uws::SocketKind = if ssl_enabled {
            uws::SocketKind::BunListenerTls
        } else {
            uws::SocketKind::BunListenerTcp
        };

        // errdefer bun.default_allocator.free(hostname) — Box<[u8]> drops on error path automatically
        let mut connection: UnixOrHost = if let Some(port_) = port {
            UnixOrHost::Host { host: hostname_owned, port: port_ }
        } else if let Some(fd) = fd_opt {
            // PORT NOTE: hostname is dropped here (Zig leaked it on this arm — same behavior not preserved)
            drop(hostname_owned);
            UnixOrHost::Fd(fd)
        } else {
            UnixOrHost::Unix(hostname_owned)
        };

        let secure_ctx_ptr: Option<*mut uws::SslCtx> =
            this_ref.secure_ctx.map(|p| p.as_ptr().cast::<uws::SslCtx>());

        let mut errno: c_int = 0;
        let listen_socket: *mut uws_sys::ListenSocket = match &mut connection {
            UnixOrHost::Host { host, port } => {
                // NUL-terminate for the C `&CStr` parameter.
                let mut hostz = host.to_vec();
                hostz.push(0);
                // SAFETY: just appended NUL; bytes contain no interior NUL by construction.
                let host_cstr = unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(&hostz) };
                let ls = this_ref.group.listen(
                    kind,
                    secure_ctx_ptr,
                    Some(host_cstr),
                    *port as c_int,
                    socket_flags,
                    size_of::<*mut c_void>() as c_int,
                    &mut errno,
                );
                if !ls.is_null() {
                    // SAFETY: ls is non-null, just returned from listen.
                    *port = u16::try_from(unsafe { &mut *ls }.get_local_port()).unwrap();
                }
                ls
            }
            UnixOrHost::Unix(u) => this_ref.group.listen_unix(
                kind,
                secure_ctx_ptr,
                u,
                socket_flags,
                size_of::<*mut c_void>() as c_int,
                &mut errno,
            ),
            UnixOrHost::Fd(fd) => {
                let err = jsc::SystemError {
                    errno: bun_sys::SystemErrno::EINVAL as c_int,
                    code: bun_str::String::static_("EINVAL"),
                    message: bun_str::String::static_(
                        "Bun does not support listening on a file descriptor.",
                    ),
                    syscall: bun_str::String::static_("listen"),
                    fd: fd.uv(),
                    path: bun_str::String::empty(),
                    hostname: bun_str::String::empty(),
                    dest: bun_str::String::empty(),
                };
                return Err(global.throw_value(err.to_error_instance(global)));
            }
        };
        if listen_socket.is_null() {
            // PORT NOTE: reshaped for borrowck — extract hostname bytes for error formatting
            let hostname_bytes: &[u8] = match &connection {
                UnixOrHost::Host { host, .. } => host,
                UnixOrHost::Unix(u) => u,
                UnixOrHost::Fd(_) => b"",
            };
            let err = global.create_error_instance(format_args!(
                "Failed to listen at {}",
                bstr::BStr::new(hostname_bytes)
            ));
            log!("Failed to listen {}", errno);
            if errno != 0 {
                err.put(global, b"syscall", jsc::bun_string_jsc::create_utf8_for_js(global, b"listen")?);
                err.put(global, b"errno", JSValue::js_number(errno as f64));
                err.put(global, b"address", ZigString::init_utf8(hostname_bytes).to_js(global));
                if let Some(p) = port {
                    err.put(global, b"port", JSValue::js_number(p as f64));
                }
                if let Some(str_) = bun_sys::SystemErrno::init(errno as i64) {
                    err.put(
                        global,
                        b"code",
                        ZigString::init(<&'static str>::from(str_).as_bytes()).to_js(global),
                    );
                }
            }
            return Err(global.throw_value(err));
        }

        this_ref.connection = connection;
        this_ref.listener = ListenerType::Uws(listen_socket);
        if !default_data.is_empty() {
            this_ref.strong_data = Strong::create(default_data, global);
        }

        if let Some(ssl_config) = ssl_cfg_taken.as_ref() {
            // `ssl_enabled` ⇒ `createSSLContext` succeeded above ⇒ `secure_ctx` set.
            let secure = this_ref.secure_ctx.expect("unreachable");
            if let Some(server_name) = ssl_config.server_name.as_deref() {
                if !server_name.to_bytes().is_empty() {
                    // Registering the default cert under its own server_name is a
                    // hint for sni_cb, not load-bearing — sni_find() miss falls
                    // through to the default SSL_CTX anyway.
                    // SAFETY: listen_socket is non-null, just returned from listen.
                    let _ = unsafe { &mut *listen_socket }.add_server_name(
                        server_name,
                        secure.as_ptr().cast(),
                        core::ptr::null_mut(),
                    );
                }
            }
        }

        listener_allocated.set(false); // ownership now on `this`; deinit handles cleanup
        scopeguard::ScopeGuard::into_inner(cleanup);
        // SAFETY: `global` is live; ownership of `this` (Box::into_raw'd above)
        // transfers to the C++ wrapper (freed via `ListenerClass__finalize` →
        // `Listener::finalize` → `deinit`).
        let this_value = unsafe { Listener__create(global.as_mut_ptr(), this) };
        this_ref.strong_self.set(global, this_value);
        this_ref.poll_ref.ref_(vm_event_loop_ctx());

        Ok(this_value)
    }

    // PORT NOTE: no #[bun_jsc::host_fn] — JsClass codegen emits the constructor shim.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Listener> {
        Err(global.throw(format_args!("Cannot construct Listener")))
    }

    pub fn on_name_pipe_created<const SSL: bool>(listener: &mut Listener) -> *mut NewSocket<SSL> {
        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: NonNull::new(&mut listener.handlers as *mut Handlers),
            socket: uws::NewSocketHandler::<SSL>::DETACHED,
            protos: listener.protos.clone(),
            // PORT NOTE: Zig shared the listener's slice (`owned_protos = false`);
            // here `protos` is `Option<Box<[u8]>>` so we clone instead of borrow.
            flags: SocketFlags::empty(),
            owned_ssl_ctx: None,
            this_value: jsc::JsRef::empty(),
            poll_ref: KeepAlive::init(),
            ref_pollref_on_connect: true,
            connection: None,
            server_name: None,
            buffered_data_for_node_net: Default::default(),
            bytes_written: 0,
            native_callback: crate::socket::NativeCallbacks::None,
            twin: None,
        });
        // SAFETY: NewSocket::new returns a valid heap pointer.
        unsafe { (*this_socket).ref_() };
        if let Some(default_data) = listener.strong_data.get() {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::data_set_cached(
                // SAFETY: this_socket just allocated above.
                unsafe { (*this_socket).get_this_value(global) },
                global,
                default_data,
            );
        }
        this_socket
    }

    /// Called from `dispatch.zig` `BunListener.onOpen` for every accepted socket.
    /// Allocates the `NewSocket` wrapper, stashes it in the socket ext, then
    /// re-stamps the kind to `.bun_socket_{tcp,tls}` so subsequent events route
    /// straight to `BunSocket` (the listener arm only fires once per accept).
    pub fn on_create<const SSL: bool>(
        listener: &mut Listener,
        socket: uws::NewSocketHandler<SSL>,
    ) -> *mut NewSocket<SSL> {
        jsc::mark_binding!();
        log!("onCreate");

        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: NonNull::new(&mut listener.handlers as *mut Handlers),
            socket,
            protos: listener.protos.clone(),
            // TODO(port): protos borrow semantics — Zig shared the listener's slice; here we clone.
            flags: SocketFlags::empty(), // owned_protos = false (cloned above)
            owned_ssl_ctx: None,
            this_value: jsc::JsRef::empty(),
            poll_ref: KeepAlive::init(),
            ref_pollref_on_connect: true,
            connection: None,
            server_name: None,
            buffered_data_for_node_net: Default::default(),
            bytes_written: 0,
            native_callback: crate::socket::NativeCallbacks::None,
            twin: None,
        });
        // SAFETY: NewSocket::new returns a valid heap pointer
        unsafe { (*this_socket).ref_() };
        let default_data = listener.strong_data.get();
        if let Some(default_data) = default_data {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::data_set_cached(
                // SAFETY: this_socket just allocated above.
                unsafe { (*this_socket).get_this_value(global) },
                global,
                default_data,
            );
        }
        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext storage is at least pointer-sized; we stash *mut NewSocket<SSL>
            unsafe { *ctx = this_socket as *mut c_void };
        }
        if let uws::InternalSocket::Connected(s) = socket.socket {
            // SAFETY: s is a live us_socket_t* from the accept callback.
            unsafe { &mut *s }.set_kind(if SSL {
                uws_sys::SocketKind::BunSocketTls
            } else {
                uws_sys::SocketKind::BunSocketTcp
            });
        }
        socket.set_timeout(120);
        this_socket
    }

    pub fn add_server_name(
        this: &mut Self,
        global: &JSGlobalObject,
        hostname: JSValue,
        tls: JSValue,
    ) -> JsResult<JSValue> {
        if !this.ssl {
            return Err(global.throw_invalid_arguments(format_args!("addServerName requires SSL support")));
        }
        if !hostname.is_string() {
            return Err(global.throw_invalid_arguments(format_args!("hostname pattern expects a string")));
        }
        let host_str = hostname.to_slice(global)?;
        let server_name_bytes = host_str.slice();
        if server_name_bytes.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!("hostname pattern cannot be empty")));
        }
        // NUL-terminate for the C `&CStr` parameter.
        let mut server_name_buf = server_name_bytes.to_vec();
        server_name_buf.push(0);
        // SAFETY: just appended NUL.
        let server_name = unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(&server_name_buf) };

        let ListenerType::Uws(ls) = this.listener else {
            return Ok(JSValue::UNDEFINED);
        };

        // node:tls passes the native SecureContext (already-built SSL_CTX*) — no
        // re-parse. Bun.listen({tls}) callers may still pass a raw options dict.
        let sni_ctx: *mut boring_sys::SSL_CTX = if let Some(sc) = SecureContext::from_js(tls) {
            // SAFETY: from_js returned non-null; SecureContext is live for the call.
            unsafe { (*sc).borrow() }
        } else if let Some(mut ssl_config) = {
            // SAFETY: per-thread VM; valid for program lifetime.
            let vm = unsafe { &mut *VirtualMachine::get() };
            SSLConfig::from_js(vm, global, tls)?
        } {
            // PORT NOTE: `defer cfg.deinit()` — handled by Drop on SSLConfig
            let _ = ssl_config;
            // `bun_jsc::rare_data::SSLContextCache` is an opaque stub; the real
            // `get_or_create` lives in `crate::api::bun::SSLContextCache` and the
            // RareData→runtime bridge isn't wired yet.
            todo!("blocked_on: bun_jsc::rare_data::SSLContextCache::get_or_create")
        } else {
            return Ok(JSValue::UNDEFINED);
        };

        // The C SNI tree SSL_CTX_up_ref()s; drop our build/borrow ref once added.
        // SAFETY: ls is non-null (Uws variant); the listener is live.
        let ls_ref = unsafe { &mut *ls };
        ls_ref.remove_server_name(server_name);
        let ok = ls_ref.add_server_name(server_name, sni_ctx.cast(), core::ptr::null_mut());
        // SAFETY: FFI — drop the +1 ref we took via borrow()/get_or_create(); SNI tree up_ref'd its own
        unsafe { boring_sys::SSL_CTX_free(sni_ctx) };
        if !ok {
            // Old entry was already removed; failing silently would leave the
            // hostname with no SNI mapping at all. Surface it.
            return Err(global.throw_value(global.create_error_instance(format_args!(
                "Failed to register SNI for '{}'",
                bstr::BStr::new(server_name_bytes)
            ))));
            // TODO(port): Zig used `global.ERR_BORINGSSL(...)` for the error code path.
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Self::do_stop(this, true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn stop(this: &mut Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        log!("close");

        Self::do_stop(
            this,
            if arguments.len > 0 && arguments.ptr[0].is_boolean() {
                arguments.ptr[0].to_boolean()
            } else {
                false
            },
        );

        Ok(JSValue::UNDEFINED)
    }

    fn do_stop(this: &mut Self, force_close: bool) {
        if matches!(this.listener, ListenerType::None) {
            return;
        }
        let listener = core::mem::replace(&mut this.listener, ListenerType::None);

        if matches!(listener, ListenerType::Uws(_)) {
            Self::unlink_unix_socket_path(this);
        }

        // PORT NOTE: Zig `defer switch (listener) {...}` — moved to end of fn body for same ordering.

        if this.handlers.active_connections == 0 {
            this.poll_ref.unref(vm_event_loop_ctx());
            this.strong_self.clear_without_deallocation();
            this.strong_data.clear_without_deallocation();
        } else if force_close {
            this.group.close_all();
        }

        match listener {
            // SAFETY: socket is non-null (Uws variant invariant).
            ListenerType::Uws(socket) => unsafe { &mut *socket }.close(),
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => {
                // SAFETY: named_pipe is the unique owner; close_pipe_and_deinit consumes it.
                unsafe { named_pipe.as_ref() };
                todo!("blocked_on: WindowsNamedPipeListeningContext::close_pipe_and_deinit")
            }
            #[cfg(not(windows))]
            ListenerType::NamedPipe(_) => {}
            ListenerType::None => {}
        }
    }

    pub fn finalize(this: *mut Self) {
        log!("finalize");
        // SAFETY: called from JSC finalizer on mutator thread; `this` is the m_ctx payload
        let this_ref = unsafe { &mut *this };
        let listener = core::mem::replace(&mut this_ref.listener, ListenerType::None);
        match listener {
            ListenerType::Uws(socket) => {
                Self::unlink_unix_socket_path(this_ref);
                // SAFETY: socket is non-null (Uws variant invariant).
                unsafe { &mut *socket }.close();
            }
            #[cfg(windows)]
            ListenerType::NamedPipe(_named_pipe) => {
                todo!("blocked_on: WindowsNamedPipeListeningContext::close_pipe_and_deinit")
            }
            #[cfg(not(windows))]
            ListenerType::NamedPipe(_) => {}
            ListenerType::None => {}
        }
        Self::deinit(this);
    }

    /// Match Node.js/libuv: unlink the unix socket file before closing the listening fd.
    /// Unlinking after close would race with another process creating a socket at the same path.
    fn unlink_unix_socket_path(this: &Self) {
        let UnixOrHost::Unix(path) = &this.connection else {
            return;
        };
        // Abstract sockets (Linux) start with a NUL byte and have no filesystem entry.
        if path.is_empty() || path[0] == 0 {
            return;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let _ = bun_sys::unlink(bun_paths::resolve_path::z(path, &mut buf));
    }

    fn deinit(this: *mut Self) {
        log!("deinit");
        // SAFETY: `this` is a Box<Listener> leaked via into_raw; sole owner here
        let this_ref = unsafe { &mut *this };
        this_ref.strong_self.deinit();
        this_ref.strong_data.deinit();
        this_ref.poll_ref.unref(vm_event_loop_ctx());
        debug_assert!(matches!(this_ref.listener, ListenerType::None));

        // Any still-open accepted sockets hold a `&listener.handlers` pointer, so
        // we cannot free `this` while they're alive. Force-close them; their
        // onClose paths will markInactive against handlers we drop right after.
        if this_ref.handlers.active_connections > 0 {
            this_ref.group.close_all();
        }
        bun_core::asan::unregister_root_region(
            &this_ref.group as *const _ as *const c_void,
            size_of::<uws::SocketGroup>(),
        );
        // SAFETY: group was init'd in listen(); not concurrently walked.
        unsafe { uws::SocketGroup::destroy(&mut this_ref.group) };
        if let Some(ctx) = this_ref.secure_ctx {
            // SAFETY: FFI — secure_ctx holds one owned SSL_CTX ref; release it
            unsafe { boring_sys::SSL_CTX_free(ctx.as_ptr()) };
        }

        // connection / protos: dropped by Box::from_raw below
        // PORT NOTE: Zig `this.handlers.deinit()` — Drop on Handlers handles unprotect.
        // SAFETY: reclaim the Box allocated in listen()
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connections_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.handlers.active_connections as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_unix(this: &Self, global: &JSGlobalObject) -> JSValue {
        let UnixOrHost::Unix(unix) = &this.connection else {
            return JSValue::UNDEFINED;
        };
        ZigString::init(unix).with_encoding().to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hostname(this: &Self, global: &JSGlobalObject) -> JSValue {
        let UnixOrHost::Host { host, .. } = &this.connection else {
            return JSValue::UNDEFINED;
        };
        ZigString::init(host).with_encoding().to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        let UnixOrHost::Host { port, .. } = &this.connection else {
            return JSValue::UNDEFINED;
        };
        JSValue::js_number(*port as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        match &this.listener {
            ListenerType::Uws(uws_listener) => {
                // SAFETY: uws_listener is non-null (Uws variant invariant).
                let socket = unsafe { &mut **uws_listener }.socket::<false>();
                let fd = socket.fd();
                // TODO(port): `Fd::to_js_without_making_libuv_owned` — direct uv() encode for now.
                JSValue::js_number(fd.uv() as f64)
            }
            _ => JSValue::js_number(-1.0),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn ref_(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        if matches!(this.listener, ListenerType::None) {
            return Ok(JSValue::UNDEFINED);
        }
        this.poll_ref.ref_(vm_event_loop_ctx());
        this.strong_self.set(global, this_value);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unref(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(vm_event_loop_ctx());
        if this.handlers.active_connections == 0 {
            this.strong_self.clear_without_deallocation();
        }
        Ok(JSValue::UNDEFINED)
    }

    // PORT NOTE: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub fn connect(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        Self::connect_inner(global, None, None, opts)
    }

    pub fn connect_inner(
        global: &JSGlobalObject,
        prev_maybe_tcp: Option<*mut TCPSocket>,
        prev_maybe_tls: Option<*mut TLSSocket>,
        opts: JSValue,
    ) -> JsResult<JSValue> {
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected options object")));
        }
        // SAFETY: bun_vm() returns a JSC_BORROW that lives for the program; widen to 'static.
        let vm: &'static mut VirtualMachine = unsafe { &mut *VirtualMachine::get() };
        let global_static: &'static JSGlobalObject =
            unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) };

        // is_server=false: this is the client connect path. Handlers.mode must be
        // .client so markInactive() takes the allocator.destroy branch — the
        // .server branch does @fieldParentPtr("handlers", this) to reach a
        // Listener, but here handlers live in a standalone allocator.create()
        // block (see below), so that would read past the allocation.
        let mut socket_config = SocketConfig::from_js(vm, opts, global_static, false)?;
        // PORT NOTE: `defer socket_config.deinitExcludingHandlers()` — Drop on SocketConfig

        let port = socket_config.port;
        let ssl_enabled = socket_config.ssl.is_some();
        let default_data = socket_config.default_data;

        // SAFETY: event_loop() returns a non-null *mut EventLoop owned by the VM.
        unsafe { (*vm.event_loop()).ensure_waker() };

        let mut connection: UnixOrHost = 'blk: {
            if let Some(fd_) = opts.get_truthy(global, "fd")? {
                if fd_.is_number() {
                    // TODO(port): `JSValue::as_file_descriptor` — using direct int decode for now.
                    let fd = Fd::from_uv(fd_.to_int32());
                    break 'blk UnixOrHost::Fd(fd);
                }
            }
            let host: Box<[u8]> = socket_config.hostname_or_unix.slice().to_vec().into_boxed_slice();
            if let Some(port_) = port {
                UnixOrHost::Host { host, port: port_ }
            } else {
                UnixOrHost::Unix(host)
            }
        };
        // errdefer connection.deinit() — Box drops on error path

        // Resolve the prebuilt SSL_CTX before the platform branches so the Windows
        // named-pipe path can adopt it. node:tls passes the native SecureContext as
        // `tls.secureContext` so we share its already-built SSL_CTX.
        let mut owned_ssl_ctx: Option<NonNull<boring_sys::SSL_CTX>> = None;
        if ssl_enabled {
            let native_sc: Option<*mut SecureContext> = 'blk: {
                let Some(tls_js) = opts.get_truthy(global, "tls")? else {
                    break 'blk None;
                };
                if !tls_js.is_object() {
                    break 'blk None;
                }
                let Some(sc_js) = tls_js.get_truthy(global, "secureContext")? else {
                    break 'blk None;
                };
                SecureContext::from_js(sc_js)
            };
            if let Some(sc) = native_sc {
                // SAFETY: from_js returned non-null; SecureContext is live for the call.
                owned_ssl_ctx = NonNull::new(unsafe { (*sc).borrow() });
            }
        }
        // errdefer if (owned_ssl_ctx) |c| BoringSSL.SSL_CTX_free(c);
        let mut ssl_ctx_guard = scopeguard::guard(owned_ssl_ctx, |c| {
            if let Some(c) = c {
                // SAFETY: FFI — c is a live SSL_CTX* with one owned ref from borrow()/get_or_create()
                unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) };
            }
        });

        #[cfg(windows)]
        {
            let mut buf = PathBuffer::uninit();
            let mut pipe_name: Option<&[u8]> = None;
            let is_named_pipe = match &mut connection {
                // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
                UnixOrHost::Unix(slice) => {
                    pipe_name = normalize_pipe_name(slice, buf.as_mut_slice());
                    pipe_name.is_some()
                }
                UnixOrHost::Fd(_fd) => {
                    todo!("blocked_on: uv::uv_guess_handle / Windows named-pipe fd detection")
                }
                _ => false,
            };
            if is_named_pipe {
                let _ = (default_data, prev_maybe_tcp, prev_maybe_tls, pipe_name);
                todo!("blocked_on: WindowsNamedPipeContext::connect/open — Windows named-pipe connect path");
            }
        }

        // SecureContext was already borrowed above; build the SSL_CTX from
        // SSLConfig only if no SecureContext was passed.
        if ssl_enabled && ssl_ctx_guard.is_none() {
            if let Some(_ssl_cfg) = socket_config.ssl.as_ref() {
                // `bun_jsc::rare_data::SSLContextCache` is an opaque stub; the
                // real `get_or_create` lives in `crate::api::bun::SSLContextCache`
                // and the RareData→runtime bridge isn't wired yet.
                let _ = &mut *ssl_ctx_guard;
                todo!("blocked_on: bun_jsc::rare_data::SSLContextCache::get_or_create");
            }
        }

        default_data.ensure_still_alive();

        // PORT NOTE: by-value move of Handlers. See `listen()` for rationale.
        // SAFETY: socket_config.handlers is valid; we forget socket_config below to avoid double-drop.
        let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
        let allow_half_open = socket_config.allow_half_open;
        let mut ssl_taken = socket_config.ssl.take();
        core::mem::forget(socket_config);

        let mut handlers_box = Box::new(handlers_moved);
        handlers_box.mode = SocketMode::Client;
        let handlers_ptr: *mut Handlers = Box::into_raw(handlers_box);

        let promise = jsc::JSPromise::create(global);
        let promise_value = promise.to_js();
        // SAFETY: handlers_ptr was just Box::into_raw'd above; exclusive access
        unsafe { (*handlers_ptr).promise.set(global, promise_value) };

        // Ownership of the SSL_CTX is about to move into the socket; disarm the errdefer.
        let owned_ssl_ctx = scopeguard::ScopeGuard::into_inner(ssl_ctx_guard);

        // PORT NOTE: `switch (ssl_enabled) { inline else => |is_ssl_enabled| {...} }` —
        // dispatched to a const-generic helper for monomorphization.
        if ssl_enabled {
            connect_finish::<true>(
                global,
                prev_maybe_tls,
                handlers_ptr,
                connection,
                ssl_taken.as_mut(),
                owned_ssl_ctx,
                default_data,
                allow_half_open,
                port,
                promise_value,
            )
        } else {
            connect_finish::<false>(
                global,
                prev_maybe_tcp,
                handlers_ptr,
                connection,
                ssl_taken.as_mut(),
                owned_ssl_ctx,
                default_data,
                allow_half_open,
                port,
                promise_value,
            )
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn getsockname(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let ListenerType::Uws(socket) = this.listener else {
            return Ok(JSValue::UNDEFINED);
        };

        let out = frame.arguments_as_array::<1>()[0];
        if !out.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];
        // SAFETY: socket is non-null (Uws variant invariant).
        let socket_ref = unsafe { &mut *socket };
        let address_bytes: &[u8] = match socket_ref.get_local_address(&mut buf) {
            Ok(b) => b,
            Err(_) => return Ok(JSValue::UNDEFINED),
        };
        let family_js = match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        // .zig: `std.net.Address.initIp{4,6}` → `bun.fmt.formatIp` (which strips
        // `:port` and `[]`). Mirror with `SocketAddrV{4,6}` so `format_ip`'s
        // strip logic sees the same `addr:port` / `[addr]:port` shape.
        let formatted: &[u8] = match address_bytes.len() {
            4 => bun_core::fmt::format_ip(
                &std::net::SocketAddrV4::new(
                    std::net::Ipv4Addr::from(<[u8; 4]>::try_from(address_bytes).unwrap()),
                    0,
                ),
                &mut text_buf,
            )
            .unwrap(),
            16 => bun_core::fmt::format_ip(
                &std::net::SocketAddrV6::new(
                    std::net::Ipv6Addr::from(<[u8; 16]>::try_from(address_bytes).unwrap()),
                    0,
                    0,
                    0,
                ),
                &mut text_buf,
            )
            .unwrap(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        let address_js = ZigString::init(formatted).to_js(global);
        let port_js = JSValue::js_number(socket_ref.get_local_port() as f64);

        out.put(global, b"family", family_js);
        out.put(global, b"address", address_js);
        out.put(global, b"port", port_js);
        Ok(JSValue::UNDEFINED)
    }
}

// PORT NOTE: hoisted from `switch (ssl_enabled) { inline else => |is_ssl_enabled| {...} }` body
// in connect_inner. // PERF(port): was comptime bool dispatch — preserved via const generic.
fn connect_finish<const IS_SSL: bool>(
    global: &JSGlobalObject,
    maybe_previous: Option<*mut NewSocket<IS_SSL>>,
    handlers_ptr: *mut Handlers,
    connection: UnixOrHost,
    mut ssl: Option<&mut SSLConfig>,
    owned_ssl_ctx: Option<NonNull<boring_sys::SSL_CTX>>,
    default_data: JSValue,
    allow_half_open: bool,
    port: Option<u16>,
    promise_value: JSValue,
) -> JsResult<JSValue> {
    let socket: *mut NewSocket<IS_SSL> = if let Some(prev_ptr) = maybe_previous {
        // SAFETY: caller passes a live NewSocket<IS_SSL>
        let prev = unsafe { &mut *prev_ptr };
        // TODO(port): `JsRef::is_not_empty` — assert non-empty wrapper.
        if let Some(prev_handlers) = prev.handlers {
            // SAFETY: prev_handlers was Box::into_raw'd
            unsafe { drop(Box::from_raw(prev_handlers.as_ptr())) };
        }
        prev.handlers = NonNull::new(handlers_ptr);
        // TODO(port): debug_assert!(matches!(prev.socket.socket, InternalSocket::Detached))
        // Free old resources before reassignment to prevent memory leaks
        // when sockets are reused for reconnection (common with MongoDB driver)
        prev.connection = Some(connection);
        if prev.flags.contains(SocketFlags::OWNED_PROTOS) {
            prev.protos = None; // drop old Box
        }
        prev.protos = ssl.as_mut().and_then(|s| s.take_protos());
        prev.server_name = ssl.as_mut().and_then(|s| s.take_server_name());
        if let Some(old) = prev.owned_ssl_ctx {
            // SAFETY: FFI — old is the previous owned SSL_CTX ref on this reused socket
            unsafe { boring_sys::SSL_CTX_free(old) };
        }
        prev.owned_ssl_ctx = owned_ssl_ctx.map(|p| p.as_ptr());
        prev_ptr
    } else {
        NewSocket::<IS_SSL>::new(NewSocket::<IS_SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: NonNull::new(handlers_ptr),
            socket: uws::NewSocketHandler::<IS_SSL>::DETACHED,
            connection: Some(connection),
            protos: ssl.as_mut().and_then(|s| s.take_protos()),
            server_name: ssl.as_mut().and_then(|s| s.take_server_name()),
            owned_ssl_ctx: owned_ssl_ctx.map(|p| p.as_ptr()),
            flags: SocketFlags::default(),
            this_value: jsc::JsRef::empty(),
            poll_ref: KeepAlive::init(),
            ref_pollref_on_connect: true,
            buffered_data_for_node_net: Default::default(),
            bytes_written: 0,
            native_callback: crate::socket::NativeCallbacks::None,
            twin: None,
        })
    };
    // Ownership moved into `socket`; disarm the errdefer.
    // (owned_ssl_ctx consumed above)
    // SAFETY: socket is a valid heap pointer
    let socket_ref = unsafe { &mut *socket };
    socket_ref.ref_();
    NewSocket::<IS_SSL>::data_set_cached(socket_ref.get_this_value(global), global, default_data);
    socket_ref.flags.set(SocketFlags::ALLOW_HALF_OPEN, allow_half_open);
    // PORT NOTE: reshaped for borrowck — Zig stored `connection` in the socket field and passed
    // the same value to doConnect (single allocation, aliased read). We moved it into the field
    // above and re-borrow from there.
    // TODO(port): do_connect borrows `&self.connection` while taking `&mut self` — requires
    // disjoint borrow or clone. Clone for now; revisit in Phase B.
    let conn_clone = socket_ref.connection.as_ref().unwrap().clone();
    if socket_ref.do_connect(&conn_clone).is_err() {
        let _ = socket_ref.handle_connect_error(if port.is_none() {
            bun_sys::SystemErrno::ENOENT as c_int
        } else {
            bun_sys::SystemErrno::ECONNREFUSED as c_int
        });
        // Balance the unconditional `socket.ref()` above.
        socket_ref.deref();
        return Ok(promise_value);
    }

    // if this is from node:net there's surface where the user can .ref() and .deref()
    // before the connection starts. make sure we honor that here.
    if socket_ref.ref_pollref_on_connect {
        socket_ref.poll_ref.ref_(vm_event_loop_ctx());
    }

    Ok(promise_value)
}

#[bun_jsc::host_fn]
pub fn js_add_server_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = frame.arguments_old::<3>();
    if arguments.len < 3 {
        return Err(global.throw_not_enough_arguments("addServerName", 3, arguments.len));
    }
    let listener = arguments.ptr[0];
    if let Some(this) = Listener::from_js(listener) {
        // SAFETY: from_js returned a non-null *mut Listener; the JS wrapper holds it.
        return Listener::add_server_name(unsafe { &mut *this }, global, arguments.ptr[1], arguments.ptr[2]);
    }
    Err(global.throw(format_args!("Expected a Listener instance")))
}

fn is_valid_pipe_name(pipe_name: &[u8]) -> bool {
    if !cfg!(windows) {
        return false;
    }
    // check for valid pipe names
    // at minimum we need to have \\.\pipe\ or \\?\pipe\ + 1 char that is not a separator
    pipe_name.len() > 9
        && node_path::is_sep_windows_t::<u8>(pipe_name[0])
        && node_path::is_sep_windows_t::<u8>(pipe_name[1])
        && (pipe_name[2] == b'.' || pipe_name[2] == b'?')
        && node_path::is_sep_windows_t::<u8>(pipe_name[3])
        && strings::eql(&pipe_name[4..8], b"pipe")
        && node_path::is_sep_windows_t::<u8>(pipe_name[8])
        && !node_path::is_sep_windows_t::<u8>(pipe_name[9])
}

fn normalize_pipe_name<'a>(pipe_name: &[u8], buffer: &'a mut [u8]) -> Option<&'a [u8]> {
    #[cfg(windows)]
    {
        debug_assert!(pipe_name.len() < buffer.len());
        if !is_valid_pipe_name(pipe_name) {
            return None;
        }
        // normalize pipe name with can have mixed slashes
        // pipes are simple and this will be faster than using node:path.resolve()
        // we dont wanna to normalize the pipe name it self only the pipe identifier (//./pipe/, //?/pipe/, etc)
        buffer[0..9].copy_from_slice(b"\\\\.\\pipe\\");
        buffer[9..pipe_name.len()].copy_from_slice(&pipe_name[9..]);
        Some(&buffer[0..pipe_name.len()])
    }
    #[cfg(not(windows))]
    {
        let _ = (pipe_name, buffer);
        None
    }
}

#[cfg(windows)]
pub struct WindowsNamedPipeListeningContext {
    pub uv_pipe: uv::Pipe,
    pub listener: Option<NonNull<Listener>>,
    pub global_this: *const JSGlobalObject,
    pub vm: *mut VirtualMachine,
    pub ctx: Option<NonNull<boring_sys::SSL_CTX>>, // server reuses the same ctx
}

#[cfg(not(windows))]
pub struct WindowsNamedPipeListeningContext {
    _priv: (),
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/Listener.zig (1120 lines)
//   confidence: low
//   blocked:    Windows named-pipe listen/connect paths; JsClass::to_js for
//               heap-pinned Listener; Handlers by-value move semantics.
//   notes:      Heavy errdefer/scopeguard reshaping in listen()/connect_inner();
//               `inline else` body hoisted to connect_finish<const IS_SSL>.
// ──────────────────────────────────────────────────────────────────────────
