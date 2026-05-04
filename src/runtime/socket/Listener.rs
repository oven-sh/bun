//! This is the code for the object returned by Bun.listen().

use core::ffi::{c_char, c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_boringssl_sys as boring_sys;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine};
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, PathBuffer};
use bun_str::{self as strings_mod, strings, ZigString};
use bun_sys::{self, Fd};
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::api::server_config::SSLConfig;
use crate::api::{SecureContext, SocketHandlers as Handlers, TCPSocket, TLSSocket};
use crate::node::path as node_path;
use crate::socket::{NewSocket, SocketConfig, WindowsNamedPipeContext};

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

declare_scope!(Listener, visible);

macro_rules! log {
    ($($arg:tt)*) => { scoped_log!(Listener, $($arg)*) };
}

#[bun_jsc::JsClass]
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
    NamedPipe(Box<WindowsNamedPipeListeningContext>),
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
        let args = frame.arguments_old(1);

        if args.len() < 1
            || (matches!(this.listener, ListenerType::None) && this.handlers.active_connections == 0)
        {
            return global.throw("Expected 1 argument");
        }

        let opts = args.ptr(0);
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global.throw_value(global.to_invalid_arguments("Expected options object"));
        }

        let socket_obj = match opts.get(global, "socket")? {
            Some(v) => v,
            None => return global.throw("Expected \"socket\" object"),
        };

        let handlers = Handlers::from_js(global, socket_obj, this.handlers.mode == Handlers::Mode::Server)?;
        // Preserve the live connection count across the struct assignment. `Handlers.fromJS`
        // returns `active_connections = 0`, but existing accepted sockets each hold a +1 via
        // `markActive`. Without this, closing any of them after reload would underflow the
        // counter (panic in safe builds, wrap in release).
        let active_connections = this.handlers.active_connections;
        this.handlers.deinit();
        this.handlers = handlers;
        this.handlers.active_connections = active_connections;

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn listen(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        log!("listen");
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global.throw_invalid_arguments("Expected object");
        }

        let vm = VirtualMachine::get();

        let mut socket_config = SocketConfig::from_js(vm, opts, global, true)?;
        // PORT NOTE: `defer socket_config.deinitExcludingHandlers()` — handled by Drop on SocketConfig
        // (excluding handlers, which are moved out below). // TODO(port): verify SocketConfig Drop semantics

        let handlers = &mut socket_config.handlers;
        // Only deinit handlers if there's an error; otherwise we put them in a `Listener` and
        // need them to stay alive.
        // TODO(port): errdefer handlers.deinit() — scopeguard captures &mut into socket_config; reshaped below.

        let hostname_or_unix = &mut socket_config.hostname_or_unix;
        let port = socket_config.port;
        let ssl = socket_config.ssl.as_mut();
        let ssl_enabled = ssl.is_some();
        let socket_flags = socket_config.socket_flags();

        #[cfg(windows)]
        if port.is_none() {
            // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
            let mut buf = PathBuffer::uninit();
            if let Some(pipe_name) = normalize_pipe_name(hostname_or_unix.slice(), buf.as_mut_slice()) {
                let connection = UnixOrHost::Unix(hostname_or_unix.into_owned_slice());

                let mut socket = Listener {
                    handlers: handlers.clone(), // TODO(port): by-value move of Handlers
                    connection,
                    ssl: ssl_enabled,
                    listener: ListenerType::None,
                    protos: ssl.as_mut().and_then(|s| s.take_protos()),
                    poll_ref: KeepAlive::init(),
                    group: uws::SocketGroup::default(),
                    secure_ctx: None,
                    strong_data: Strong::empty(),
                    strong_self: Strong::empty(),
                };

                vm.event_loop().ensure_waker();

                if !socket_config.default_data.is_empty() {
                    socket.strong_data = Strong::create(socket_config.default_data, global);
                }

                let this: *mut Listener = Box::into_raw(Box::new(socket));
                // SAFETY: just allocated, non-null, exclusive
                let this_ref = unsafe { &mut *this };
                // TODO: server_name is not supported on named pipes, I belive its , lets wait for
                // someone to ask for it

                // On error, clean up everything `this` owns *except* `this.handlers`: the outer
                // `errdefer handlers.deinit()` already unprotects those JSValues, and `this.handlers`
                // is a by-value copy of the same struct, so calling `this.deinit()` here would
                // unprotect the same callbacks a second time.
                // TODO(port): errdefer — partial cleanup of `this` excluding handlers; needs scopeguard
                // capturing *mut Listener with disjoint field cleanup.

                // we need to add support for the backlog parameter on listen here we use the
                // default value of nodejs
                let named_pipe = match WindowsNamedPipeListeningContext::listen(
                    global,
                    pipe_name,
                    511,
                    ssl.as_deref(),
                    this_ref,
                ) {
                    Ok(np) => np,
                    Err(_) => {
                        // TODO(port): run partial cleanup (errdefer) before throwing
                        return global.throw_invalid_arguments_fmt(format_args!(
                            "Failed to listen at {}",
                            bstr::BStr::new(pipe_name)
                        ));
                    }
                };
                this_ref.listener = ListenerType::NamedPipe(named_pipe);

                let this_value = this_ref.to_js(global);
                this_ref.strong_self.set(global, this_value);
                this_ref.poll_ref.ref_(handlers.vm);
                return Ok(this_value);
            }
        }

        vm.event_loop().ensure_waker();

        // Allocate the Listener up front so the embedded `group` has its final
        // address before we hand it to listen() (it's linked into the loop's
        // intrusive list).
        let this: *mut Listener = Box::into_raw(Box::new(Listener {
            handlers: handlers.clone(), // TODO(port): by-value move of Handlers
            // Placeholder until `this_ref.connection = connection` below; Zig used `undefined`.
            // Cannot `mem::zeroed()` a Rust enum (UB).
            connection: UnixOrHost::Fd(Fd::invalid()),
            ssl: ssl_enabled,
            protos: ssl.as_mut().and_then(|s| s.take_protos()),
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
        // group lives inside a mimalloc page. `process.exit()` from JS makes
        // `Zig__GlobalObject__destructOnExit` early-return (vm.entryScope set), so
        // `finalize()`/`deinit()` never run and the accepted sockets' 88-byte
        // `us_create_poll` allocations are reported as leaked. Registering the
        // embedded group as a root region restores the same reachability the old
        // libc-malloc'd `us_socket_context_t` chain gave LSAN. Paired unregister
        // in `deinit()` (and the errdefer below).
        bun_core::asan::register_root_region(
            &this_ref.group as *const _ as *const c_void,
            size_of::<uws::SocketGroup>(),
        );
        let mut listener_allocated = true;
        let cleanup = scopeguard::guard((), |()| {
            if listener_allocated {
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
                this_ref.group.deinit();
                // SAFETY: reclaim the Box we leaked via into_raw
                drop(unsafe { Box::from_raw(this) });
            }
        });
        // TODO(port): errdefer — `cleanup` closure above approximates the Zig errdefer; verify
        // borrow scoping in Phase B (captures `listener_allocated` + raw `this`).

        if let Some(ssl_cfg) = ssl.as_ref() {
            let mut create_err = uws::CreateBunSocketError::None;
            match ssl_cfg.as_usockets().create_ssl_context(&mut create_err) {
                Some(ctx) => this_ref.secure_ctx = Some(ctx),
                None => {
                    return global.throw_value(create_err.to_js(global));
                }
            }
        }
        let kind: uws::SocketKind = if ssl_enabled {
            uws::SocketKind::BunListenerTls
        } else {
            uws::SocketKind::BunListenerTcp
        };

        let hostname = hostname_or_unix.into_owned_slice();
        // errdefer bun.default_allocator.free(hostname) — Box<[u8]> drops on error path automatically
        let mut connection: UnixOrHost = if let Some(port_) = port {
            UnixOrHost::Host { host: hostname, port: port_ }
        } else if let Some(fd) = socket_config.fd {
            // PORT NOTE: hostname is dropped here (Zig leaked it on this arm — same behavior not preserved)
            drop(hostname);
            UnixOrHost::Fd(fd)
        } else {
            UnixOrHost::Unix(hostname)
        };

        let mut errno: c_int = 0;
        let listen_socket: Option<*mut uws_sys::ListenSocket> = 'brk: {
            match &mut connection {
                UnixOrHost::Host { host, port } => {
                    let hostz = bun_str::ZStr::from_bytes(host);
                    let ls = this_ref.group.listen(
                        kind,
                        this_ref.secure_ctx,
                        hostz.as_ptr() as *const c_char,
                        *port,
                        socket_flags,
                        size_of::<*mut c_void>(),
                        &mut errno,
                    );
                    if let Some(s) = ls {
                        *port = u16::try_from(uws::ListenSocket::get_local_port(s)).unwrap();
                    }
                    break 'brk ls;
                }
                UnixOrHost::Unix(u) => {
                    let pathz = bun_str::ZStr::from_bytes(u);
                    break 'brk this_ref.group.listen_unix(
                        kind,
                        this_ref.secure_ctx,
                        pathz.as_ptr() as *const c_char,
                        pathz.len(),
                        socket_flags,
                        size_of::<*mut c_void>(),
                        &mut errno,
                    );
                }
                UnixOrHost::Fd(fd) => {
                    let err = jsc::SystemError {
                        errno: bun_sys::SystemErrno::EINVAL as i32,
                        code: bun_str::String::static_("EINVAL"),
                        message: bun_str::String::static_(
                            "Bun does not support listening on a file descriptor.",
                        ),
                        syscall: bun_str::String::static_("listen"),
                        fd: fd.uv(),
                        ..Default::default()
                    };
                    return global.throw_value(err.to_error_instance(global));
                }
            }
        };
        let listen_socket = match listen_socket {
            Some(ls) => ls,
            None => {
                // PORT NOTE: reshaped for borrowck — extract hostname bytes for error formatting
                let hostname_bytes: &[u8] = match &connection {
                    UnixOrHost::Host { host, .. } => host,
                    UnixOrHost::Unix(u) => u,
                    UnixOrHost::Fd(_) => b"",
                };
                let err = global.create_error_instance_fmt(format_args!(
                    "Failed to listen at {}",
                    bstr::BStr::new(hostname_bytes)
                ));
                log!("Failed to listen {}", errno);
                if errno != 0 {
                    err.put(global, ZigString::static_("syscall"), bun_str::String::create_utf8_for_js(global, b"listen")?);
                    err.put(global, ZigString::static_("errno"), JSValue::js_number(errno));
                    err.put(global, ZigString::static_("address"), ZigString::init_utf8(hostname_bytes).to_js(global));
                    if let Some(p) = port {
                        err.put(global, ZigString::static_("port"), JSValue::js_number(p));
                    }
                    if let Some(str_) = bun_sys::SystemErrno::init(errno) {
                        err.put(
                            global,
                            ZigString::static_("code"),
                            ZigString::init(<&'static str>::from(str_).as_bytes()).to_js(global),
                        );
                    }
                }
                return global.throw_value(err);
            }
        };

        this_ref.connection = connection;
        this_ref.listener = ListenerType::Uws(listen_socket);
        if !socket_config.default_data.is_empty() {
            this_ref.strong_data = Strong::create(socket_config.default_data, global);
        }

        if let Some(ssl_config) = ssl {
            // `ssl_enabled` ⇒ `createSSLContext` succeeded above ⇒ `secure_ctx` set.
            let secure = this_ref.secure_ctx.expect("unreachable");
            if let Some(server_name) = ssl_config.server_name {
                // SAFETY: server_name is a NUL-terminated C string from SSLConfig
                if unsafe { core::ffi::CStr::from_ptr(server_name) }.to_bytes().len() > 0 {
                    // Registering the default cert under its own server_name is a
                    // hint for sni_cb, not load-bearing — sni_find() miss falls
                    // through to the default SSL_CTX anyway. A false here (e.g.
                    // hostname already added via addContext before listen) is
                    // benign, so don't fail the whole listen() for it.
                    let _ = uws::ListenSocket::add_server_name(listen_socket, server_name, secure.as_ptr(), core::ptr::null_mut());
                }
            }
        }

        listener_allocated = false; // ownership now on `this`; deinit handles cleanup
        scopeguard::ScopeGuard::into_inner(cleanup);
        let this_value = this_ref.to_js(global);
        this_ref.strong_self.set(global, this_value);
        this_ref.poll_ref.ref_(handlers.vm);

        Ok(this_value)
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Listener> {
        global.throw("Cannot construct Listener")
    }

    pub fn on_name_pipe_created<const SSL: bool>(listener: &mut Listener) -> *mut NewSocket<SSL> {
        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: Default::default(),
            handlers: &mut listener.handlers as *mut Handlers,
            socket: NewSocket::<SSL>::Socket::DETACHED,
            protos: listener.protos.as_deref().map(|p| p as *const [u8]), // TODO(port): protos borrow semantics
            flags: NewSocket::<SSL>::Flags { owned_protos: false, ..Default::default() },
            ..Default::default()
        });
        // SAFETY: NewSocket::new returns a valid heap pointer
        unsafe { (*this_socket).ref_() };
        if let Some(default_data) = listener.strong_data.get() {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::js::data_set_cached(
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

        let this_socket = Box::into_raw(Box::new(NewSocket::<SSL> {
            ref_count: Default::default(),
            handlers: &mut listener.handlers as *mut Handlers,
            socket,
            protos: listener.protos.as_deref().map(|p| p as *const [u8]), // TODO(port): protos borrow semantics
            flags: NewSocket::<SSL>::Flags { owned_protos: false, ..Default::default() },
            ..Default::default()
        }));
        // SAFETY: just allocated
        unsafe { (*this_socket).ref_() };
        if let Some(default_data) = listener.strong_data.get() {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::js::data_set_cached(
                unsafe { (*this_socket).get_this_value(global) },
                global,
                default_data,
            );
        }
        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext storage is at least pointer-sized; we stash *mut NewSocket<SSL>
            unsafe { *ctx = this_socket as *mut c_void };
        }
        socket.socket.connected().set_kind(if SSL {
            uws::SocketKind::BunSocketTls
        } else {
            uws::SocketKind::BunSocketTcp
        });
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
            return global.throw_invalid_arguments("addServerName requires SSL support");
        }
        if !hostname.is_string() {
            return global.throw_invalid_arguments("hostname pattern expects a string");
        }
        let host_str = hostname.to_slice(global)?;
        let server_name = bun_str::ZStr::from_bytes(host_str.slice());
        if server_name.len() == 0 {
            return global.throw_invalid_arguments("hostname pattern cannot be empty");
        }

        let ListenerType::Uws(ls) = this.listener else {
            return Ok(JSValue::UNDEFINED);
        };

        // node:tls passes the native SecureContext (already-built SSL_CTX*) — no
        // re-parse. Bun.listen({tls}) callers may still pass a raw options dict.
        let sni_ctx: *mut boring_sys::SSL_CTX = if let Some(sc) = SecureContext::from_js(tls) {
            sc.borrow()
        } else if let Some(ssl_config) = SSLConfig::from_js(VirtualMachine::get(), global, tls)? {
            let mut cfg = ssl_config;
            // PORT NOTE: `defer cfg.deinit()` — handled by Drop on SSLConfig
            let mut create_err = uws::CreateBunSocketError::None;
            match VirtualMachine::get()
                .rare_data()
                .ssl_ctx_cache()
                .get_or_create(&mut cfg, &mut create_err)
            {
                Some(ctx) => ctx,
                None => {
                    if create_err != uws::CreateBunSocketError::None {
                        return global.throw_value(create_err.to_js(global));
                    }
                    // SAFETY: FFI — ERR_get_error reads thread-local BoringSSL error queue
                    return global.throw_value(boringssl::err_to_js(global, unsafe {
                        boring_sys::ERR_get_error()
                    }));
                }
            }
        } else {
            return Ok(JSValue::UNDEFINED);
        };

        // The C SNI tree SSL_CTX_up_ref()s; drop our build/borrow ref once added.
        uws::ListenSocket::remove_server_name(ls, server_name.as_ptr() as *const c_char);
        let ok = uws::ListenSocket::add_server_name(
            ls,
            server_name.as_ptr() as *const c_char,
            sni_ctx,
            core::ptr::null_mut(),
        );
        // SAFETY: FFI — drop the +1 ref we took via borrow()/get_or_create(); SNI tree up_ref'd its own
        unsafe { boring_sys::SSL_CTX_free(sni_ctx) };
        if !ok {
            // Old entry was already removed; failing silently would leave the
            // hostname with no SNI mapping at all. Surface it.
            return global.throw_value(
                global
                    .err_boringssl(format_args!(
                        "Failed to register SNI for '{}'",
                        bstr::BStr::new(server_name.as_bytes())
                    ))
                    .to_js(),
            );
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.do_stop(true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn stop(this: &mut Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old(1);
        log!("close");

        this.do_stop(
            if arguments.len() > 0 && arguments.ptr(0).is_boolean() {
                arguments.ptr(0).to_boolean()
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
            this.unlink_unix_socket_path();
        }

        // PORT NOTE: Zig `defer switch (listener) {...}` — moved to end of fn body for same ordering.

        if this.handlers.active_connections == 0 {
            this.poll_ref.unref(this.handlers.vm);
            this.strong_self.clear_without_deallocation();
            this.strong_data.clear_without_deallocation();
        } else if force_close {
            this.group.close_all();
        }

        match listener {
            ListenerType::Uws(socket) => uws::ListenSocket::close(socket),
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => named_pipe.close_pipe_and_deinit(),
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
                this_ref.unlink_unix_socket_path();
                uws::ListenSocket::close(socket);
            }
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => named_pipe.close_pipe_and_deinit(),
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
        let buf = bun_paths::path_buffer_pool().get();
        let _ = bun_sys::unlink(bun_paths::z(path, &mut *buf));
    }

    fn deinit(this: *mut Self) {
        log!("deinit");
        // SAFETY: `this` is a Box<Listener> leaked via into_raw; sole owner here
        let this_ref = unsafe { &mut *this };
        this_ref.strong_self.deinit();
        this_ref.strong_data.deinit();
        let vm = this_ref.handlers.vm;
        this_ref.poll_ref.unref(vm);
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
        this_ref.group.deinit();
        if let Some(ctx) = this_ref.secure_ctx {
            // SAFETY: FFI — secure_ctx holds one owned SSL_CTX ref; release it
            unsafe { boring_sys::SSL_CTX_free(ctx.as_ptr()) };
        }

        // connection / protos: dropped by Box::from_raw below
        this_ref.handlers.deinit();
        // SAFETY: reclaim the Box allocated in listen()
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connections_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.handlers.active_connections)
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
        JSValue::js_number(*port)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        match &this.listener {
            ListenerType::Uws(uws_listener) => uws::ListenSocket::socket(*uws_listener, false)
                .fd()
                .to_js_without_making_libuv_owned(),
            _ => JSValue::js_number(-1),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn ref_(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        if matches!(this.listener, ListenerType::None) {
            return Ok(JSValue::UNDEFINED);
        }
        this.poll_ref.ref_(global.bun_vm());
        this.strong_self.set(global, this_value);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unref(this: &mut Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(global.bun_vm());
        if this.handlers.active_connections == 0 {
            this.strong_self.clear_without_deallocation();
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn connect(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        Self::connect_inner(global, None, None, opts)
    }

    pub fn connect_inner(
        global: &JSGlobalObject,
        prev_maybe_tcp: Option<&mut TCPSocket>,
        prev_maybe_tls: Option<&mut TLSSocket>,
        opts: JSValue,
    ) -> JsResult<JSValue> {
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global.throw_invalid_arguments("Expected options object");
        }
        let vm = global.bun_vm();

        // is_server=false: this is the client connect path. Handlers.mode must be
        // .client so markInactive() takes the allocator.destroy branch — the
        // .server branch does @fieldParentPtr("handlers", this) to reach a
        // Listener, but here handlers live in a standalone allocator.create()
        // block (see below), so that would read past the allocation.
        let mut socket_config = SocketConfig::from_js(vm, opts, global, false)?;
        // PORT NOTE: `defer socket_config.deinitExcludingHandlers()` — Drop on SocketConfig

        let handlers = &mut socket_config.handlers;
        // Only deinit handlers if there's an error; otherwise we put them in a `TCPSocket` or
        // `TLSSocket` and need them to stay alive.
        // TODO(port): errdefer handlers.deinit()

        let hostname_or_unix = &mut socket_config.hostname_or_unix;
        let port = socket_config.port;
        let ssl = socket_config.ssl.as_mut();
        let ssl_enabled = ssl.is_some();
        let default_data = socket_config.default_data;

        vm.event_loop().ensure_waker();

        let mut connection: UnixOrHost = 'blk: {
            if let Some(fd_) = opts.get_truthy(global, "fd")? {
                if fd_.is_number() {
                    let fd = fd_.as_file_descriptor();
                    break 'blk UnixOrHost::Fd(fd);
                }
            }
            let host = hostname_or_unix.into_owned_slice();
            if let Some(port_) = port {
                UnixOrHost::Host { host, port: port_ }
            } else {
                UnixOrHost::Unix(host)
            }
        };
        // errdefer connection.deinit() — Box drops on error path

        // Resolve the prebuilt SSL_CTX before the platform branches so the Windows
        // named-pipe path can adopt it. node:tls passes the native SecureContext as
        // `tls.secureContext` so we share its already-built SSL_CTX (CA bundle,
        // cert chain, ciphers) instead of rebuilding ~50 KB of BoringSSL state per
        // connect. SSL_new() up_ref()s again per socket, so the SecureContext can
        // be GC'd while the connection is alive.
        //
        // Hoisted from below `isNamedPipe`: on this branch `[buntls]` no longer
        // spreads `{ca,cert,key}` into the `tls` object, so the `SSLConfig` parsed
        // from it is empty and the named-pipe SSLWrapper would build a fresh CTX
        // with no trust store → DEPTH_ZERO_SELF_SIGNED_CERT. The SSLConfig fallback
        // (defaultClientSslCtx / createSSLContext) stays after the named-pipe
        // early-return — that path uses uSockets and threads the CTX through
        // `socket.owned_ssl_ctx`, which has nothing to share with named-pipe.
        let mut owned_ssl_ctx: Option<NonNull<boring_sys::SSL_CTX>> = None;
        if ssl_enabled {
            let native_sc: Option<&mut SecureContext> = 'blk: {
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
                owned_ssl_ctx = NonNull::new(sc.borrow());
            }
        }
        // errdefer if (owned_ssl_ctx) |c| BoringSSL.SSL_CTX_free(c);
        // Guard stays armed across every fallible `?`/throw below; disarmed via into_inner
        // only once ownership transfers to the socket (just before connect_finish).
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
                UnixOrHost::Fd(fd) => 'brk: {
                    let uvfd = fd.uv();
                    let fd_type = uv::uv_guess_handle(uvfd);
                    if fd_type == uv::Handle::Type::NamedPipe {
                        break 'brk true;
                    }
                    if fd_type == uv::Handle::Type::Unknown {
                        // is not a libuv fd, check if it's a named pipe
                        // @ptrFromInt(@as(usize, @intCast(uvfd))) — checked widen, then int→ptr
                        let osfd: uv::uv_os_fd_t = usize::try_from(uvfd).unwrap() as uv::uv_os_fd_t;
                        if bun_sys::windows::GetFileType(osfd) == bun_sys::windows::FILE_TYPE_PIPE {
                            // yay its a named pipe lets make it a libuv fd
                            *fd = Fd::from_native(osfd)
                                .make_libuv_owned()
                                .unwrap_or_else(|_| panic!("failed to allocate file descriptor"));
                            break 'brk true;
                        }
                    }
                    false
                }
                _ => false,
            };
            if is_named_pipe {
                default_data.ensure_still_alive();

                let handlers_ptr: *mut Handlers = Box::into_raw(Box::new(handlers.clone())); // TODO(port): by-value move of Handlers
                // SAFETY: just allocated
                unsafe { (*handlers_ptr).mode = Handlers::Mode::Client };

                let promise = jsc::JSPromise::create(global);
                let promise_value = promise.to_js();
                // SAFETY: handlers_ptr was just Box::into_raw'd above; exclusive access
                unsafe { (*handlers_ptr).promise.set(global, promise_value) };

                if ssl_enabled {
                    let tls = if let Some(prev) = prev_maybe_tls {
                        if let Some(prev_handlers) = prev.handlers {
                            // SAFETY: prev_handlers was Box::into_raw'd
                            unsafe {
                                (*prev_handlers).deinit();
                                drop(Box::from_raw(prev_handlers));
                            }
                        }
                        debug_assert!(prev.this_value.is_not_empty());
                        prev.handlers = Some(handlers_ptr);
                        debug_assert!(matches!(prev.socket.socket, TLSSocket::SocketState::Detached));
                        // Free old resources before reassignment to prevent memory leaks
                        // when sockets are reused for reconnection (common with MongoDB driver)
                        prev.connection = Some(connection);
                        if prev.flags.owned_protos {
                            prev.protos = None; // drop old Box
                        }
                        prev.protos = ssl.as_mut().and_then(|s| s.take_protos());
                        prev.server_name = ssl.as_mut().and_then(|s| s.take_server_name());
                        prev
                    } else {
                        // TODO(port): TLSSocket::new returns *mut — reconcile &mut vs *mut in Phase B
                        // SAFETY: TLSSocket::new returns a fresh non-null heap pointer; exclusive here
                        unsafe {
                            &mut *TLSSocket::new(TLSSocket {
                                ref_count: Default::default(),
                                handlers: Some(handlers_ptr),
                                socket: TLSSocket::Socket::DETACHED,
                                connection: Some(connection),
                                protos: ssl.as_mut().and_then(|s| s.take_protos()),
                                server_name: ssl.as_mut().and_then(|s| s.take_server_name()),
                                ..Default::default()
                            })
                        }
                    };

                    TLSSocket::js::data_set_cached(tls.get_this_value(global), global, default_data);
                    tls.poll_ref.ref_(handlers.vm);
                    tls.ref_();

                    // Transfer the borrowed CTX into the pipe's SSLWrapper. From
                    // here it owns the ref on every path (initWithCTX adopts on
                    // success, initTLSWrapper frees on failure), so null our local
                    // before the call so the errdefer above can't double-free.
                    let ctx_for_pipe = (*ssl_ctx_guard).take();
                    let named_pipe = match &connection {
                        // TODO(port): `connection` was moved into `tls` above; Zig aliased — Phase B must re-order
                        UnixOrHost::Unix(_) => match WindowsNamedPipeContext::connect(
                            global,
                            pipe_name.unwrap(),
                            ssl.as_deref().cloned(),
                            ctx_for_pipe,
                            WindowsNamedPipeContext::SocketType::Tls(tls),
                        ) {
                            Ok(np) => np,
                            Err(_) => return Ok(promise_value),
                        },
                        UnixOrHost::Fd(fd) => match WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            ssl.as_deref().cloned(),
                            ctx_for_pipe,
                            WindowsNamedPipeContext::SocketType::Tls(tls),
                        ) {
                            Ok(np) => np,
                            Err(_) => return Ok(promise_value),
                        },
                        _ => unreachable!(),
                    };
                    tls.socket = TLSSocket::Socket::from_named_pipe(named_pipe);
                } else {
                    let tcp = if let Some(prev) = prev_maybe_tcp {
                        debug_assert!(prev.this_value.is_not_empty());
                        if let Some(prev_handlers) = prev.handlers {
                            // SAFETY: prev_handlers was Box::into_raw'd by an earlier connect; sole owner
                            unsafe {
                                (*prev_handlers).deinit();
                                drop(Box::from_raw(prev_handlers));
                            }
                        }
                        prev.handlers = Some(handlers_ptr);
                        debug_assert!(matches!(prev.socket.socket, TCPSocket::SocketState::Detached));
                        // Adopt `connection` (heap-owned for .unix) so the socket's
                        // deinit frees it; matches the TLS arm above and the
                        // non-pipe arm below. Previously `.connection = null`
                        // dropped the duped pipe-path bytes on the floor.
                        prev.connection = Some(connection);
                        debug_assert!(prev.protos.is_none());
                        debug_assert!(prev.server_name.is_none());
                        prev
                    } else {
                        // SAFETY: TCPSocket::new returns a fresh non-null heap pointer; exclusive here
                        unsafe {
                            &mut *TCPSocket::new(TCPSocket {
                                ref_count: Default::default(),
                                handlers: Some(handlers_ptr),
                                socket: TCPSocket::Socket::DETACHED,
                                connection: Some(connection),
                                protos: None,
                                server_name: None,
                                ..Default::default()
                            })
                        }
                    };
                    tcp.ref_();
                    TCPSocket::js::data_set_cached(tcp.get_this_value(global), global, default_data);
                    tcp.poll_ref.ref_(handlers.vm);

                    let named_pipe = match &connection {
                        // TODO(port): `connection` was moved into `tcp` above; Zig aliased — Phase B must re-order
                        UnixOrHost::Unix(_) => match WindowsNamedPipeContext::connect(
                            global,
                            pipe_name.unwrap(),
                            None,
                            None,
                            WindowsNamedPipeContext::SocketType::Tcp(tcp),
                        ) {
                            Ok(np) => np,
                            Err(_) => return Ok(promise_value),
                        },
                        UnixOrHost::Fd(fd) => match WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            None,
                            None,
                            WindowsNamedPipeContext::SocketType::Tcp(tcp),
                        ) {
                            Ok(np) => np,
                            Err(_) => return Ok(promise_value),
                        },
                        _ => unreachable!(),
                    };
                    tcp.socket = TCPSocket::Socket::from_named_pipe(named_pipe);
                }
                return Ok(promise_value);
            }
        }

        // SecureContext was already borrowed above; build the SSL_CTX from
        // SSLConfig only if no SecureContext was passed. doConnect hands
        // `socket.owned_ssl_ctx` to the per-VM connect group.
        if ssl_enabled && ssl_ctx_guard.is_none() {
            if let Some(ssl_cfg) = ssl.as_ref() {
                // Per-VM weak `SSLContextCache`: identical configs (including the
                // common `tls:true` / `{servername}`-only / `{ALPNProtocols}`-only
                // cases — those fields aren't in the digest because they're
                // applied per-SSL, not per-CTX) share one `SSL_CTX*`. The
                // `requires_custom_request_ctx` gate is gone; the cache makes the
                // default-vs-custom distinction by content.
                let mut create_err = uws::CreateBunSocketError::None;
                *ssl_ctx_guard = match vm.rare_data().ssl_ctx_cache().get_or_create(ssl_cfg, &mut create_err) {
                    Some(c) => NonNull::new(c),
                    None => {
                        return global.throw_value(create_err.to_js(global));
                    }
                };
            }
        }
        // (errdefer for owned_ssl_ctx already armed at the earlier lookup site;
        // duplicating it here would double-free on error.)

        default_data.ensure_still_alive();

        let handlers_ptr: *mut Handlers = Box::into_raw(Box::new(handlers.clone())); // TODO(port): by-value move of Handlers
        // SAFETY: just allocated
        unsafe { (*handlers_ptr).mode = Handlers::Mode::Client };

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
                prev_maybe_tls.map(|p| p as *mut TLSSocket as *mut NewSocket<true>), // TODO(port): TLSSocket == NewSocket<true>
                handlers_ptr,
                handlers.vm,
                connection,
                ssl,
                owned_ssl_ctx,
                default_data,
                socket_config.allow_half_open,
                port,
                promise_value,
            )
        } else {
            connect_finish::<false>(
                global,
                prev_maybe_tcp.map(|p| p as *mut TCPSocket as *mut NewSocket<false>), // TODO(port): TCPSocket == NewSocket<false>
                handlers_ptr,
                handlers.vm,
                connection,
                ssl,
                owned_ssl_ctx,
                default_data,
                socket_config.allow_half_open,
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
            return global.throw_invalid_arguments("Expected object");
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];
        let address_bytes: &[u8] = match uws::ListenSocket::get_local_address(socket, &mut buf) {
            Ok(b) => b,
            Err(_) => return Ok(JSValue::UNDEFINED),
        };
        // TODO(port): std.net.Address — replaced with bun_core::fmt::format_ip taking raw bytes
        let family_js = match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        let formatted = match address_bytes.len() {
            4 => bun_core::fmt::format_ip4(
                <[u8; 4]>::try_from(address_bytes).unwrap(),
                0,
                &mut text_buf,
            ),
            16 => bun_core::fmt::format_ip6(
                <[u8; 16]>::try_from(address_bytes).unwrap(),
                0,
                &mut text_buf,
            ),
            _ => return Ok(JSValue::UNDEFINED),
        };
        let address_js = ZigString::init(formatted).to_js(global);
        let port_js = JSValue::js_number(uws::ListenSocket::get_local_port(socket));

        out.put(global, bun_str::String::static_("family"), family_js);
        out.put(global, bun_str::String::static_("address"), address_js);
        out.put(global, bun_str::String::static_("port"), port_js);
        Ok(JSValue::UNDEFINED)
    }
}

// PORT NOTE: hoisted from `switch (ssl_enabled) { inline else => |is_ssl_enabled| {...} }` body
// in connect_inner. // PERF(port): was comptime bool dispatch — preserved via const generic.
fn connect_finish<const IS_SSL: bool>(
    global: &JSGlobalObject,
    maybe_previous: Option<*mut NewSocket<IS_SSL>>,
    handlers_ptr: *mut Handlers,
    handlers_vm: *mut VirtualMachine,
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
        debug_assert!(prev.this_value.is_not_empty());
        if let Some(prev_handlers) = prev.handlers {
            // SAFETY: prev_handlers was Box::into_raw'd
            unsafe {
                (*prev_handlers).deinit();
                drop(Box::from_raw(prev_handlers));
            }
        }
        prev.handlers = Some(handlers_ptr);
        debug_assert!(matches!(prev.socket.socket, NewSocket::<IS_SSL>::SocketState::Detached));
        // Free old resources before reassignment to prevent memory leaks
        // when sockets are reused for reconnection (common with MongoDB driver)
        prev.connection = Some(connection);
        if prev.flags.owned_protos {
            prev.protos = None; // drop old Box
        }
        prev.protos = ssl.as_mut().and_then(|s| s.take_protos());
        prev.server_name = ssl.as_mut().and_then(|s| s.take_server_name());
        if let Some(old) = prev.owned_ssl_ctx {
            // SAFETY: FFI — old is the previous owned SSL_CTX ref on this reused socket
            unsafe { boring_sys::SSL_CTX_free(old.as_ptr()) };
        }
        prev.owned_ssl_ctx = owned_ssl_ctx;
        prev_ptr
    } else {
        Box::into_raw(Box::new(NewSocket::<IS_SSL> {
            ref_count: Default::default(),
            handlers: Some(handlers_ptr),
            socket: NewSocket::<IS_SSL>::Socket::DETACHED,
            connection: Some(connection),
            protos: ssl.as_mut().and_then(|s| s.take_protos()),
            server_name: ssl.as_mut().and_then(|s| s.take_server_name()),
            owned_ssl_ctx,
            ..Default::default()
        }))
    };
    // Ownership moved into `socket`; disarm the errdefer.
    // (owned_ssl_ctx consumed above)
    // SAFETY: socket is a valid heap pointer
    let socket_ref = unsafe { &mut *socket };
    socket_ref.ref_();
    NewSocket::<IS_SSL>::js::data_set_cached(socket_ref.get_this_value(global), global, default_data);
    socket_ref.flags.allow_half_open = allow_half_open;
    // PORT NOTE: reshaped for borrowck — Zig stored `connection` in the socket field and passed
    // the same value to doConnect (single allocation, aliased read). We moved it into the field
    // above and re-borrow from there.
    // TODO(port): do_connect signature may need `&UnixOrHost`; reconcile in Phase B.
    if let Err(_) = socket_ref.do_connect(socket_ref.connection.as_ref().unwrap()) {
        let _ = socket_ref.handle_connect_error(if port.is_none() {
            bun_sys::SystemErrno::ENOENT as c_int
        } else {
            bun_sys::SystemErrno::ECONNREFUSED as c_int
        });
        // Balance the unconditional `socket.ref()` above. `handleConnectError`
        // only derefs when the socket was attached (`needs_deref`), which is
        // never true on this synchronous-failure path — the socket is still
        // `.detached`. This applies to reused (`prev`) sockets as well; the
        // guard that skipped them leaked one ref per failed reconnect.
        socket_ref.deref();
        return Ok(promise_value);
    }

    // if this is from node:net there's surface where the user can .ref() and .deref()
    // before the connection starts. make sure we honor that here.
    // in the Bun.connect path, this will always be true at this point in time.
    if socket_ref.ref_pollref_on_connect {
        socket_ref.poll_ref.ref_(handlers_vm);
    }

    Ok(promise_value)
}

#[bun_jsc::host_fn]
pub fn js_add_server_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = frame.arguments_old(3);
    if arguments.len() < 3 {
        return global.throw_not_enough_arguments("addServerName", 3, arguments.len());
    }
    let listener = arguments.ptr(0);
    if let Some(this) = Listener::from_js(listener) {
        return Listener::add_server_name(this, global, arguments.ptr(1), arguments.ptr(2));
    }
    global.throw("Expected a Listener instance")
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
    pub global_this: *mut JSGlobalObject,
    pub vm: *mut VirtualMachine,
    pub ctx: Option<NonNull<boring_sys::SSL_CTX>>, // server reuses the same ctx
}

#[cfg(windows)]
#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum WindowsNamedPipeListenError {
    #[error("InvalidOptions")]
    InvalidOptions,
    #[error("FailedToInitPipe")]
    FailedToInitPipe,
    #[error("FailedToBindPipe")]
    FailedToBindPipe,
}

#[cfg(windows)]
impl WindowsNamedPipeListeningContext {
    fn on_client_connect(this: &mut Self, status: uv::ReturnCode) {
        // SAFETY: vm is a JSC_BORROW raw pointer that lives for the program
        let vm = unsafe { &*this.vm };
        if status != uv::ReturnCode::ZERO || vm.is_shutting_down() || this.listener.is_none() {
            // connection dropped or vm is shutting down or we are deiniting/closing
            return;
        }
        // SAFETY: BACKREF — listener owns this context and outlives this callback
        let listener = unsafe { this.listener.unwrap().as_mut() };
        let socket: WindowsNamedPipeContext::SocketType = if this.ctx.is_some() {
            WindowsNamedPipeContext::SocketType::Tls(Listener::on_name_pipe_created::<true>(listener))
        } else {
            WindowsNamedPipeContext::SocketType::Tcp(Listener::on_name_pipe_created::<false>(listener))
        };

        // SAFETY: global_this lives forever (JSC_BORROW)
        let client = WindowsNamedPipeContext::create(unsafe { &*this.global_this }, socket);

        let result = client.named_pipe.get_accepted_by(&mut this.uv_pipe, this.ctx);
        if result.is_err() {
            // connection dropped
            client.deinit();
        }
    }

    extern "C" fn on_pipe_closed(pipe: *mut uv::Pipe) {
        // SAFETY: pipe.data was set to `this` in close_pipe_and_deinit
        let this: *mut WindowsNamedPipeListeningContext =
            unsafe { (*pipe).data } as *mut WindowsNamedPipeListeningContext;
        Self::deinit(this);
    }

    pub fn close_pipe_and_deinit(mut self: Box<Self>) {
        self.listener = None;
        let raw = Box::into_raw(self);
        // SAFETY: raw is non-null, just leaked
        unsafe {
            (*raw).uv_pipe.data = raw as *mut c_void;
            (*raw).uv_pipe.close(Self::on_pipe_closed);
        }
    }

    pub fn listen(
        global_this: &JSGlobalObject,
        path: &[u8],
        backlog: i32,
        ssl_config: Option<&SSLConfig>,
        listener: &mut Listener,
    ) -> Result<Box<WindowsNamedPipeListeningContext>, WindowsNamedPipeListenError> {
        let mut this = Box::new(WindowsNamedPipeListeningContext {
            // SAFETY: all-zero is a valid uv::Pipe (C struct)
            uv_pipe: unsafe { core::mem::zeroed::<uv::Pipe>() },
            global_this: global_this as *const _ as *mut JSGlobalObject,
            vm: global_this.bun_vm() as *const _ as *mut VirtualMachine,
            listener: Some(NonNull::from(listener)),
            ctx: None,
        });
        let mut pipe_initialized = false;
        // TODO(port): errdefer — once the uv pipe handle is registered with the loop it must be
        // closed via uv_close; before that point we can free the struct directly. `deinit()` also
        // frees the SSL context if one was created. Reshaped to explicit cleanup at each error
        // return below.

        if let Some(ssl_options) = ssl_config {
            boringssl::load();

            let ctx_opts: uws::SocketContext::BunSocketContextOptions = ssl_options.as_usockets();
            let mut err = uws::CreateBunSocketError::None;
            // Create SSL context using uSockets to match behavior of node.js
            this.ctx = match ctx_opts.create_ssl_context(&mut err) {
                Some(c) => Some(c),
                None => {
                    Self::deinit(Box::into_raw(this));
                    return Err(WindowsNamedPipeListenError::InvalidOptions);
                }
            };
        }

        // SAFETY: vm is valid (JSC_BORROW)
        let init_result = this.uv_pipe.init(unsafe { (*this.vm).uv_loop() }, false);
        if init_result.is_err() {
            Self::deinit(Box::into_raw(this));
            return Err(WindowsNamedPipeListenError::FailedToInitPipe);
        }
        pipe_initialized = true;
        let _ = pipe_initialized;

        let this_ptr = &mut *this as *mut Self;
        let bind_result = if path[path.len() - 1] == 0 {
            // is already null terminated
            // SAFETY: path[len-1] == 0 verified above
            let slice_z = unsafe { bun_str::ZStr::from_raw(path.as_ptr(), path.len() - 1) };
            this.uv_pipe
                .listen_named_pipe(slice_z, backlog, this_ptr, Self::on_client_connect)
                .unwrap_result()
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);

            path_buf[0..len].copy_from_slice(&path[0..len]);
            path_buf[len] = 0;
            // SAFETY: path_buf[len] == 0 written above
            let slice_z = unsafe { bun_str::ZStr::from_raw(path_buf.as_ptr(), len) };
            this.uv_pipe
                .listen_named_pipe(slice_z, backlog, this_ptr, Self::on_client_connect)
                .unwrap_result()
        };
        if bind_result.is_err() {
            this.close_pipe_and_deinit();
            return Err(WindowsNamedPipeListenError::FailedToBindPipe);
        }
        //TODO: add readableAll and writableAll support if someone needs it
        // if(uv.uv_pipe_chmod(&this.uvPipe, uv.UV_WRITABLE | uv.UV_READABLE) != 0) {
        // this.closePipeAndDeinit();
        // return error.FailedChmodPipe;
        //}

        Ok(this)
    }

    fn run_event(this: &mut Self) {
        // TODO(port): `task_event` field referenced here does not exist on the struct in Zig either —
        // appears to be dead/stale code. Preserved as-is.
        match this.task_event {
            TaskEvent::Deinit => {
                Self::deinit(this as *mut Self);
            }
            TaskEvent::None => panic!("Invalid event state"),
        }
    }

    fn deinit_in_next_tick(this: &mut Self) {
        // TODO(port): `task_event`/`task` fields referenced here do not exist on the struct in Zig
        // either — appears to be dead/stale code. Preserved as-is.
        debug_assert!(this.task_event != TaskEvent::Deinit);
        this.task_event = TaskEvent::Deinit;
        // SAFETY: vm is a JSC_BORROW raw pointer that lives for the program
        unsafe { (*this.vm).enqueue_task(jsc::Task::init(&mut this.task)) };
    }

    fn deinit(this: *mut Self) {
        // SAFETY: `this` was Box::into_raw'd; sole owner
        let this_ref = unsafe { &mut *this };
        this_ref.listener = None;
        if let Some(ctx) = this_ref.ctx.take() {
            // SAFETY: FFI — ctx is the one owned SSL_CTX ref created in listen()
            unsafe { boring_sys::SSL_CTX_free(ctx.as_ptr()) };
        }
        // SAFETY: reclaim Box
        drop(unsafe { Box::from_raw(this) });
    }
}

#[cfg(not(windows))]
pub type WindowsNamedPipeListeningContext = ();

// TODO(port): `task_event` enum referenced by dead code above
#[cfg(windows)]
#[derive(PartialEq, Eq)]
enum TaskEvent {
    None,
    Deinit,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/Listener.zig (1120 lines)
//   confidence: low
//   todos:      23
//   notes:      Heavy errdefer/scopeguard reshaping in listen()/connect_inner(); Handlers by-value copy semantics, NewSocket<SSL> field shapes, do_connect(&UnixOrHost) signature, and Windows named-pipe `connection` aliasing all need Phase B re-audit. `inline else` body hoisted to connect_finish<const IS_SSL>.
// ──────────────────────────────────────────────────────────────────────────
