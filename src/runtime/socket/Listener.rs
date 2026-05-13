//! This is the code for the object returned by Bun.listen().

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_boringssl as boringssl;
use bun_boringssl_sys as boring_sys;
use bun_core::{self as strings_mod, strings};
use bun_io::KeepAlive;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::strong::Optional as Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::zig_string::ZigString;
use bun_jsc::{
    self as jsc, CallFrame, GlobalRef, JSGlobalObject, JSValue, JsCell, JsClass, JsResult,
};
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, PathBuffer};
use bun_sys::{self, Fd};
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::api::bun_secure_context::SecureContext;
use crate::node::path as node_path;
use crate::socket::{
    Handlers, NewSocket, SocketConfig, SocketFlags, SocketMode, TCPSocket, TLSSocket,
};
use crate::socket::{SSLConfig, SSLConfigFromJs};

#[cfg(windows)]
use crate::socket::WindowsNamedPipeContext;

#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

bun_output::define_scoped_log!(log, Listener, visible);

/// Bridge to the per-VM digest-keyed weak `SSL_CTX*` cache. The
/// `bun_jsc::rare_data::SSLContextCache` slot is an opaque cycle-break stub;
/// the concrete cache lives on `crate::jsc_hooks::RuntimeState`.
#[inline]
fn vm_ssl_ctx_cache() -> *mut crate::api::SSLContextCache::SSLContextCache {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(
        !state.is_null(),
        "runtime_state() before init_runtime_state"
    );
    // SAFETY: `state` is the per-thread `RuntimeState` boxed in
    // `init_runtime_state`; address-stable until VM teardown.
    unsafe { core::ptr::addr_of_mut!((*state).ssl_ctx_cache) }
}

// `jsc.Codegen.JSListener.toJS` — route through the codegen'd wrapper so we
// can hand the C++ side an already-heap-allocated `*mut Listener` (the
// embedded `group` is linked into the loop's intrusive list at its final
// address before this call, so the `Box::new`-then-move that the `#[JsClass]`
// `to_js(self)` impl does would invalidate that link).
use crate::generated_classes::js_Listener;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut Listener` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either.
#[bun_jsc::JsClass(no_constructor)]
pub struct Listener {
    pub handlers: JsCell<Handlers>,
    pub listener: Cell<ListenerType>,

    pub poll_ref: JsCell<KeepAlive>,
    pub connection: UnixOrHost,
    /// Embedded sweep/iteration list-head for every accepted socket on this
    /// listener. `group.ext` = `*Listener`, so the dispatch handler recovers us
    /// from the socket without a context-ext lookup.
    pub group: JsCell<uws::SocketGroup>,
    /// `SSL_CTX*` for accepted sockets. One owned ref; `SSL_CTX_free` on close.
    /// `SSL_new()` per-accept takes its own ref, so accepted sockets outlive a
    /// stopped listener safely.
    pub secure_ctx: Option<NonNull<boring_sys::SSL_CTX>>,
    pub ssl: bool,
    pub protos: Option<Box<[u8]>>,

    pub strong_data: JsCell<Strong>,
    pub strong_self: JsCell<Strong>,
}

#[derive(Clone, Copy)]
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
        this.strong_data.get().get().unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        log!("setData()");
        this.strong_data.with_mut(|s| s.set(global, value));
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
    pub fn reload(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_old::<1>();

        if args.len < 1
            || (matches!(this.listener.get(), ListenerType::None)
                && this.handlers.get().active_connections.get() == 0)
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

        let handlers = Handlers::from_js(
            global,
            socket_obj,
            this.handlers.get().mode == SocketMode::Server,
        )?;
        // Preserve the live connection count across the struct assignment. `Handlers.fromJS`
        // returns `active_connections = 0`, but existing accepted sockets each hold a +1 via
        // `markActive`. Without this, closing any of them after reload would underflow the
        // counter (panic in safe builds, wrap in release).
        // PORT NOTE: Zig `this.handlers.deinit()` — Drop handles unprotect; assignment below drops old.
        this.handlers.with_mut(|h| {
            let active_connections = h.active_connections.get();
            *h = handlers;
            h.active_connections.set(active_connections);
        });

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
        let vm = VirtualMachine::get().as_mut();

        let mut socket_config = SocketConfig::from_js(vm, opts, global, true)?;
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
            if let Some(pipe_name) =
                normalize_pipe_name(socket_config.hostname_or_unix.slice(), buf.as_mut_slice())
            {
                // PORT NOTE: reshaped — `pipe_name` borrows `buf`; copy to an owned
                // buffer so the borrow ends before we move `socket_config` below.
                let mut pipe_buf = PathBuffer::uninit();
                let pipe_len = pipe_name.len();
                pipe_buf[..pipe_len].copy_from_slice(pipe_name);

                // PORT NOTE: Zig `intoOwnedSlice` — transfer the allocation out
                // of `socket_config` so the `mem::forget` below doesn't leak it.
                let connection = UnixOrHost::Unix(
                    core::mem::take(&mut socket_config.hostname_or_unix)
                        .into_vec()
                        .into_boxed_slice(),
                );

                vm.event_loop_ref().ensure_waker();

                // PORT NOTE: by-value move of Handlers — see the non-pipe arm below
                // for rationale on `ptr::read` + `mem::forget`.
                // SAFETY: socket_config.handlers is valid; we forget socket_config to avoid double-drop.
                let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
                let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
                let default_data = socket_config.default_data;
                let ssl_cfg_taken = socket_config.ssl.take();
                core::mem::forget(socket_config);

                let this: *mut Listener = bun_core::heap::into_raw(Box::new(Listener {
                    handlers: JsCell::new(handlers_moved),
                    connection,
                    ssl: ssl_enabled,
                    listener: Cell::new(ListenerType::None),
                    protos: protos_taken,
                    poll_ref: JsCell::new(KeepAlive::init()),
                    group: JsCell::new(uws::SocketGroup::default()),
                    secure_ctx: None,
                    strong_data: JsCell::new(Strong::empty()),
                    strong_self: JsCell::new(Strong::empty()),
                }));
                // SAFETY: just allocated, non-null, exclusive
                let this_ref = unsafe { &mut *this };
                if !default_data.is_empty() {
                    this_ref
                        .strong_data
                        .set(Strong::create(default_data, global));
                }
                // TODO: server_name is not supported on named pipes, I belive its , lets wait for
                // someone to ask for it

                // we need to add support for the backlog parameter on listen here we use the
                // default value of nodejs
                match WindowsNamedPipeListeningContext::listen(
                    global,
                    &pipe_buf[..pipe_len],
                    511,
                    ssl_cfg_taken.as_ref(),
                    this,
                ) {
                    Ok(named_pipe) => {
                        this_ref.listener.set(ListenerType::NamedPipe(
                            NonNull::new(named_pipe)
                                .expect("listen returns a non-null heap pointer"),
                        ));
                    }
                    Err(_) => {
                        // On error, clean up everything `this` owns *except* `this.handlers`: the outer
                        // `errdefer handlers.deinit()` already unprotects those JSValues, and `this.handlers`
                        // is a by-value copy of the same struct, so calling `this.deinit()` here would
                        // unprotect the same callbacks a second time.
                        // PORT NOTE: in this port `handlers` was *moved* (not copied), so we
                        // recover it from the box before freeing and let it drop here for the
                        // same single-unprotect effect.
                        this_ref.strong_data.with_mut(|s| s.deinit());
                        // SAFETY: reclaim the Box we leaked via into_raw; drops connection,
                        // protos, and (the moved) handlers exactly once.
                        drop(unsafe { bun_core::heap::take(this) });
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Failed to listen at {}",
                            bstr::BStr::new(&pipe_buf[..pipe_len])
                        )));
                    }
                }

                // SAFETY: `global` is live; ownership of `this` (heap-allocated above)
                // transfers to the C++ wrapper.
                let this_value = js_Listener::to_js(this, global);
                this_ref.strong_self.with_mut(|s| s.set(global, this_value));
                this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
                return Ok(this_value);
            }
        }

        vm.event_loop_ref().ensure_waker();

        // Allocate the Listener up front so the embedded `group` has its final
        // address before we hand it to listen() (it's linked into the loop's
        // intrusive list).
        // PORT NOTE: by-value move of Handlers. Zig copied the struct then ran
        // `deinitExcludingHandlers()` on the original. Here we read the handlers
        // out by raw ptr and prevent double-drop by clearing the source via
        // `deinit_excluding_handlers` + `mem::forget`.
        // SAFETY: socket_config.handlers is valid; we forget socket_config below to avoid double-drop.
        let handlers_moved: Handlers =
            unsafe { core::ptr::read(&raw const socket_config.handlers) };
        let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
        let default_data = socket_config.default_data;
        // PORT NOTE: Zig `intoOwnedSlice` — transfer the allocation out of
        // `socket_config` so the `mem::forget` below doesn't leak it.
        let hostname_owned: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
            .into_vec()
            .into_boxed_slice();
        let fd_opt = socket_config.fd;
        let ssl_cfg_taken = socket_config.ssl.take();
        // Prevent double-drop of `handlers` (moved out above).
        core::mem::forget(socket_config);

        let this: *mut Listener = bun_core::heap::into_raw(Box::new(Listener {
            handlers: JsCell::new(handlers_moved),
            // Placeholder until `this_ref.connection = connection` below; Zig used `undefined`.
            // Cannot `mem::zeroed()` a Rust enum (UB).
            connection: UnixOrHost::Fd(Fd::invalid()),
            ssl: ssl_enabled,
            protos: protos_taken,
            listener: Cell::new(ListenerType::None),
            poll_ref: JsCell::new(KeepAlive::init()),
            group: JsCell::new(uws::SocketGroup::default()),
            secure_ctx: None,
            strong_data: JsCell::new(Strong::empty()),
            strong_self: JsCell::new(Strong::empty()),
        }));
        // SAFETY: just allocated, non-null, exclusive
        let this_ref = unsafe { &mut *this };
        this_ref
            .group
            .with_mut(|g| g.init(uws::Loop::get(), None, this.cast::<c_void>()));
        // `Listener` is mimalloc-allocated, so LSAN can't trace `loop->data.head →
        // this.group → head_sockets → us_socket_t` once the only pointer into the
        // group lives inside a mimalloc page. Registering the embedded group as a
        // root region restores reachability for the accepted sockets' allocations.
        // Paired unregister in `deinit()` (and the errdefer below).
        bun_core::asan::register_root_region(
            this_ref.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
        // errdefer: on any early return below, tear down the half-built Listener.
        // Disarmed via `into_inner` once ownership transfers to the JS wrapper.
        let cleanup = scopeguard::guard(this, |this| {
            // SAFETY: this is still the sole owner on the error path
            let this_ref = unsafe { &mut *this };
            if let Some(c) = this_ref.secure_ctx {
                // SAFETY: FFI — secure_ctx holds one owned SSL_CTX ref from create_ssl_context
                unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) };
            }
            // protos: Box drops automatically when Listener is dropped below
            bun_core::asan::unregister_root_region(
                this_ref.group.as_ptr().cast::<c_void>(),
                size_of::<uws::SocketGroup>(),
            );
            // SAFETY: group was init'd above; not concurrently walked.
            unsafe { uws::SocketGroup::destroy(this_ref.group.as_ptr()) };
            // SAFETY: reclaim the Box we leaked via into_raw
            drop(unsafe { bun_core::heap::take(this) });
        });

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
            UnixOrHost::Host {
                host: hostname_owned,
                port: port_,
            }
        } else if let Some(fd) = fd_opt {
            // PORT NOTE: hostname is dropped here (Zig leaked it on this arm — same behavior not preserved)
            drop(hostname_owned);
            UnixOrHost::Fd(fd)
        } else {
            UnixOrHost::Unix(hostname_owned)
        };

        let secure_ctx_ptr: Option<*mut uws::SslCtx> = this_ref
            .secure_ctx
            .map(|p| p.as_ptr().cast::<uws::SslCtx>());

        let mut errno: c_int = 0;
        let listen_socket: *mut uws_sys::ListenSocket = match &mut connection {
            UnixOrHost::Host { host, port } => {
                // NUL-terminate for the C `const char*` parameter. Zig used
                // `dupeZ` + raw `.ptr`, which tolerates interior NULs (the C
                // side just truncates at the first one). Build the `&CStr` via
                // `from_ptr` so we match that instead of asserting via
                // `ZStr::as_cstr()`.
                let hostz = bun_core::ZBox::from_bytes(&host[..]);
                // SAFETY: `hostz` is NUL-terminated and outlives `host_cstr`.
                let host_cstr = unsafe { core::ffi::CStr::from_ptr(hostz.as_ptr()) };
                let ls = this_ref.group.with_mut(|g| {
                    g.listen(
                        kind,
                        secure_ctx_ptr,
                        Some(host_cstr),
                        *port as c_int,
                        socket_flags,
                        size_of::<*mut c_void>() as c_int,
                        &mut errno,
                    )
                });
                if !ls.is_null() {
                    // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                    *port = u16::try_from(bun_opaque::opaque_deref_mut(ls).get_local_port())
                        .expect("int cast");
                }
                ls
            }
            UnixOrHost::Unix(u) => this_ref.group.with_mut(|g| {
                g.listen_unix(
                    kind,
                    secure_ctx_ptr,
                    u,
                    socket_flags,
                    size_of::<*mut c_void>() as c_int,
                    &mut errno,
                )
            }),
            UnixOrHost::Fd(fd) => {
                let err = jsc::SystemError {
                    errno: bun_sys::SystemErrno::EINVAL as c_int,
                    code: bun_core::String::static_("EINVAL"),
                    message: bun_core::String::static_(
                        "Bun does not support listening on a file descriptor.",
                    ),
                    syscall: bun_core::String::static_("listen"),
                    fd: fd.uv(),
                    path: bun_core::String::empty(),
                    hostname: bun_core::String::empty(),
                    dest: bun_core::String::empty(),
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
                err.put(
                    global,
                    b"syscall",
                    jsc::bun_string_jsc::create_utf8_for_js(global, b"listen")?,
                );
                err.put(global, b"errno", JSValue::js_number(errno as f64));
                err.put(
                    global,
                    b"address",
                    ZigString::init_utf8(hostname_bytes).to_js(global),
                );
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
        this_ref.listener.set(ListenerType::Uws(listen_socket));
        if !default_data.is_empty() {
            this_ref
                .strong_data
                .set(Strong::create(default_data, global));
        }

        if let Some(ssl_config) = ssl_cfg_taken.as_ref() {
            // `ssl_enabled` ⇒ `createSSLContext` succeeded above ⇒ `secure_ctx` set.
            let secure = this_ref.secure_ctx.expect("unreachable");
            if let Some(server_name) = ssl_config.server_name_cstr() {
                if !server_name.to_bytes().is_empty() {
                    // Registering the default cert under its own server_name is a
                    // hint for sni_cb, not load-bearing — sni_find() miss falls
                    // through to the default SSL_CTX anyway.
                    // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                    let _ = bun_opaque::opaque_deref_mut(listen_socket).add_server_name(
                        server_name,
                        secure.as_ptr().cast(),
                        core::ptr::null_mut(),
                    );
                }
            }
        }

        let this = scopeguard::ScopeGuard::into_inner(cleanup); // ownership transfers to JS wrapper
        // SAFETY: `global` is live; ownership of `this` (heap-allocated above)
        // transfers to the C++ wrapper (freed via `ListenerClass__finalize` →
        // `Listener::finalize` → `deinit`).
        let this_value = js_Listener::to_js(this, global);
        this_ref.strong_self.with_mut(|s| s.set(global, this_value));
        this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));

        Ok(this_value)
    }

    pub fn on_name_pipe_created<const SSL: bool>(listener: &Listener) -> *mut NewSocket<SSL> {
        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: Cell::new(NonNull::new(listener.handlers.as_ptr())),
            socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED),
            protos: JsCell::new(listener.protos.clone()),
            // PORT NOTE: Zig shared the listener's slice (`owned_protos = false`);
            // here `protos` is `Option<Box<[u8]>>` so we clone instead of borrow.
            flags: Cell::new(SocketFlags::empty()),
            owned_ssl_ctx: Cell::new(None),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
            twin: JsCell::new(None),
        });
        // SAFETY: `NewSocket::new` returns a non-null live heap pointer
        // (refcount==1); single JS thread, no other borrow exists yet.
        let s = unsafe { bun_ptr::ThisPtr::new(this_socket) };
        s.ref_();
        if let Some(default_data) = listener.strong_data.get().get() {
            let global = listener.handlers.get().global_object;
            NewSocket::<SSL>::data_set_cached(s.get_this_value(&global), &global, default_data);
        }
        this_socket
    }

    /// Called from `dispatch.zig` `BunListener.onOpen` for every accepted socket.
    /// Allocates the `NewSocket` wrapper, stashes it in the socket ext, then
    /// re-stamps the kind to `.bun_socket_{tcp,tls}` so subsequent events route
    /// straight to `BunSocket` (the listener arm only fires once per accept).
    pub fn on_create<const SSL: bool>(
        listener: &Listener,
        socket: uws::NewSocketHandler<SSL>,
    ) -> *mut NewSocket<SSL> {
        jsc::mark_binding!();
        log!("onCreate");

        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: Cell::new(NonNull::new(listener.handlers.as_ptr())),
            socket: Cell::new(socket),
            protos: JsCell::new(listener.protos.clone()),
            // TODO(port): protos borrow semantics — Zig shared the listener's slice; here we clone.
            flags: Cell::new(SocketFlags::empty()), // owned_protos = false (cloned above)
            owned_ssl_ctx: Cell::new(None),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
            twin: JsCell::new(None),
        });
        // SAFETY: `NewSocket::new` returns a non-null live heap pointer
        // (refcount==1); single JS thread, no other borrow exists yet.
        let s = unsafe { bun_ptr::ThisPtr::new(this_socket) };
        s.ref_();
        let default_data = listener.strong_data.get().get();
        if let Some(default_data) = default_data {
            let global = listener.handlers.get().global_object;
            NewSocket::<SSL>::data_set_cached(s.get_this_value(&global), &global, default_data);
        }
        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext storage is at least pointer-sized; we stash *mut NewSocket<SSL>
            unsafe { *ctx = this_socket.cast::<c_void>() };
        }
        if let uws::InternalSocket::Connected(s) = socket.socket {
            // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
            bun_opaque::opaque_deref_mut(s).set_kind(if SSL {
                uws_sys::SocketKind::BunSocketTls
            } else {
                uws_sys::SocketKind::BunSocketTcp
            });
        }
        socket.set_timeout(120);
        this_socket
    }

    pub fn add_server_name(
        this: &Self,
        global: &JSGlobalObject,
        hostname: JSValue,
        tls: JSValue,
    ) -> JsResult<JSValue> {
        if !this.ssl {
            return Err(
                global.throw_invalid_arguments(format_args!("addServerName requires SSL support"))
            );
        }
        if !hostname.is_string() {
            return Err(
                global.throw_invalid_arguments(format_args!("hostname pattern expects a string"))
            );
        }
        let host_str = hostname.to_slice(global)?;
        let server_name_bytes = host_str.slice();
        if server_name_bytes.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("hostname pattern cannot be empty"))
            );
        }
        // NUL-terminate for the C `const char*` parameter. Zig used
        // `dupeZ` + raw `.ptr` (Listener.zig:377), which tolerates interior
        // NULs — the C SNI tree just truncates at the first one. Build the
        // `&CStr` via `from_ptr` to match that instead of asserting via
        // `ZStr::as_cstr()`. `server_name_z` must outlive the
        // remove_server_name/add_server_name calls below.
        let server_name_z = bun_core::ZBox::from_bytes(server_name_bytes);
        // SAFETY: `server_name_z` is NUL-terminated and lives to end of scope.
        let server_name = unsafe { core::ffi::CStr::from_ptr(server_name_z.as_ptr()) };

        let ListenerType::Uws(ls) = this.listener.get() else {
            return Ok(JSValue::UNDEFINED);
        };

        // node:tls passes the native SecureContext (already-built SSL_CTX*) — no
        // re-parse. Bun.listen({tls}) callers may still pass a raw options dict.
        let sni_ctx: *mut boring_sys::SSL_CTX = if let Some(sc) = SecureContext::from_js(tls) {
            // SAFETY: from_js returned non-null; SecureContext is live for the call.
            unsafe { (*sc).borrow() }
        } else if let Some(ssl_config) = {
            // SAFETY: per-thread VM; valid for program lifetime.
            let vm = VirtualMachine::get().as_mut();
            SSLConfig::from_js(vm, global, tls)?
        } {
            // PORT NOTE: `defer cfg.deinit()` — handled by Drop on SSLConfig
            let mut create_err = uws::create_bun_socket_error_t::none;
            // SAFETY: `vm_ssl_ctx_cache()` returns the per-thread cache; only
            // touched from the JS thread so the `&mut` is unique.
            let cache = unsafe { &mut *vm_ssl_ctx_cache() };
            match cache.get_or_create(&ssl_config, &mut create_err) {
                Some(ctx) => ctx,
                None => {
                    if create_err != uws::create_bun_socket_error_t::none {
                        return Err(global.throw_value(
                            crate::socket::uws_jsc::create_bun_socket_error_to_js(
                                create_err, global,
                            ),
                        ));
                    }
                    let code = boring_sys::ERR_get_error();
                    return Err(
                        global.throw_value(crate::crypto::boringssl_jsc::err_to_js(global, code))
                    );
                }
            }
        } else {
            return Ok(JSValue::UNDEFINED);
        };

        // The C SNI tree SSL_CTX_up_ref()s; drop our build/borrow ref once added.
        // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let ls_ref = bun_opaque::opaque_deref_mut(ls);
        ls_ref.remove_server_name(server_name);
        let ok = ls_ref.add_server_name(server_name, sni_ctx.cast(), core::ptr::null_mut());
        // SAFETY: FFI — drop the +1 ref we took via borrow()/get_or_create(); SNI tree up_ref'd its own
        unsafe { boring_sys::SSL_CTX_free(sni_ctx) };
        if !ok {
            // Old entry was already removed; failing silently would leave the
            // hostname with no SNI mapping at all. Surface it.
            return Err(global.throw_value(
                global
                    .err(
                        jsc::ErrorCode::BORINGSSL,
                        format_args!(
                            "Failed to register SNI for '{}'",
                            bstr::BStr::new(server_name_bytes)
                        ),
                    )
                    .to_js(),
            ));
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Self::do_stop(this, true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn stop(this: &Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    fn do_stop(this: &Self, force_close: bool) {
        if matches!(this.listener.get(), ListenerType::None) {
            return;
        }
        let listener = this.listener.replace(ListenerType::None);

        if matches!(listener, ListenerType::Uws(_)) {
            Self::unlink_unix_socket_path(this);
        }

        // PORT NOTE: Zig `defer switch (listener) {...}` — moved to end of fn body for same ordering.

        if this.handlers.get().active_connections.get() == 0 {
            this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
            this.strong_self
                .with_mut(|s| s.clear_without_deallocation());
            this.strong_data
                .with_mut(|s| s.clear_without_deallocation());
        } else if force_close {
            this.group.with_mut(|g| g.close_all());
        }

        match listener {
            // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
            ListenerType::Uws(socket) => bun_opaque::opaque_deref_mut(socket).close(),
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => {
                // SAFETY: named_pipe is the unique owner; close_pipe_and_deinit
                // schedules the libuv close → on_pipe_closed → deinit chain.
                unsafe {
                    WindowsNamedPipeListeningContext::close_pipe_and_deinit(named_pipe.as_ptr())
                };
            }
            #[cfg(not(windows))]
            ListenerType::NamedPipe(_) => {}
            ListenerType::None => {}
        }
    }

    pub fn finalize(self: Box<Self>) {
        log!("finalize");
        let listener = self.listener.replace(ListenerType::None);
        match listener {
            ListenerType::Uws(socket) => {
                Self::unlink_unix_socket_path(&self);
                // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(socket).close();
            }
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => {
                // SAFETY: named_pipe is the unique owner; close_pipe_and_deinit
                // schedules the libuv close → on_pipe_closed → deinit chain.
                unsafe {
                    WindowsNamedPipeListeningContext::close_pipe_and_deinit(named_pipe.as_ptr())
                };
            }
            #[cfg(not(windows))]
            ListenerType::NamedPipe(_) => {}
            ListenerType::None => {}
        }
        // `deinit` frees the allocation itself (`heap::take`); hand ownership
        // back so its existing raw-ptr teardown path stays intact.
        Self::deinit(Box::into_raw(self));
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
        this_ref.strong_self.with_mut(|s| s.deinit());
        this_ref.strong_data.with_mut(|s| s.deinit());
        this_ref.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        debug_assert!(matches!(this_ref.listener.get(), ListenerType::None));

        // Any still-open accepted sockets hold a `&listener.handlers` pointer, so
        // we cannot free `this` while they're alive. Force-close them; their
        // onClose paths will markInactive against handlers we drop right after.
        if this_ref.handlers.get().active_connections.get() > 0 {
            this_ref.group.with_mut(|g| g.close_all());
        }
        bun_core::asan::unregister_root_region(
            this_ref.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
        // SAFETY: group was init'd in listen(); not concurrently walked.
        unsafe { uws::SocketGroup::destroy(this_ref.group.as_ptr()) };
        if let Some(ctx) = this_ref.secure_ctx {
            // SAFETY: FFI — secure_ctx holds one owned SSL_CTX ref; release it
            unsafe { boring_sys::SSL_CTX_free(ctx.as_ptr()) };
        }

        // connection / protos: dropped by heap::take below
        // PORT NOTE: Zig `this.handlers.deinit()` — Drop on Handlers handles unprotect.
        // SAFETY: reclaim the Box allocated in listen()
        drop(unsafe { bun_core::heap::take(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connections_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.handlers.get().active_connections.get() as f64)
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
        match this.listener.get() {
            ListenerType::Uws(uws_listener) => {
                // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                let socket = bun_opaque::opaque_deref_mut(uws_listener).socket::<false>();
                // Zig: `uws_listener.socket(false).fd().toJSWithoutMakingLibUVOwned()`.
                // On Windows the listening socket fd is a system-kind SOCKET
                // handle; routing it through `.uv()` panics for anything but
                // stdio. The sys_jsc helper branches on kind exactly like
                // fd_jsc.zig (system→u64, uv→i32, posix→i32).
                use bun_sys_jsc::FdJsc as _;
                socket.fd().to_js_without_making_lib_uv_owned()
            }
            _ => JSValue::js_number(-1.0),
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn ref_(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        if matches!(this.listener.get(), ListenerType::None) {
            return Ok(JSValue::UNDEFINED);
        }
        this.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        this.strong_self.with_mut(|s| s.set(global, this_value));
        Ok(JSValue::UNDEFINED)
    }

    /// Codegen calls `Listener::r#ref` (raw-ident lowering of the JS `ref`
    /// property). Forward to [`ref_`] so the existing call sites that spell it
    /// with the trailing underscore keep working.
    #[inline]
    pub fn r#ref(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::ref_(this, global, frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unref(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        if this.handlers.get().active_connections.get() == 0 {
            this.strong_self
                .with_mut(|s| s.clear_without_deallocation());
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
        let vm = VirtualMachine::get().as_mut();

        // is_server=false: this is the client connect path. Handlers.mode must be
        // .client so markInactive() takes the allocator.destroy branch — the
        // .server branch does @fieldParentPtr("handlers", this) to reach a
        // Listener, but here handlers live in a standalone allocator.create()
        // block (see below), so that would read past the allocation.
        let mut socket_config = SocketConfig::from_js(vm, opts, global, false)?;
        // PORT NOTE: `defer socket_config.deinitExcludingHandlers()` — Drop on SocketConfig

        let port = socket_config.port;
        let ssl_enabled = socket_config.ssl.is_some();
        let default_data = socket_config.default_data;

        vm.event_loop_ref().ensure_waker();

        let mut connection: UnixOrHost = 'blk: {
            if let Some(fd_) = opts.get_truthy(global, "fd")? {
                if fd_.is_number() {
                    // TODO(port): `JSValue::as_file_descriptor` — using direct int decode for now.
                    let fd = Fd::from_uv(fd_.to_int32());
                    break 'blk UnixOrHost::Fd(fd);
                }
            }
            // PORT NOTE: Zig `intoOwnedSlice` — transfer the allocation out of
            // `socket_config` so the later `mem::forget` doesn't leak it.
            let host: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
                .into_vec()
                .into_boxed_slice();
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
            use crate::socket::windows_named_pipe_context::SocketType as PipeSocketType;
            use bun_sys::FdExt as _;

            let mut buf = PathBuffer::uninit();
            // PORT NOTE: reshaped for borrowck — `normalize_pipe_name` borrows
            // `buf` for the returned slice; store length and re-borrow after the
            // `connection` match drops.
            let mut pipe_name_len: Option<usize> = None;
            let is_named_pipe = match &mut connection {
                // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
                UnixOrHost::Unix(slice) => match normalize_pipe_name(slice, buf.as_mut_slice()) {
                    Some(name) => {
                        pipe_name_len = Some(name.len());
                        true
                    }
                    None => false,
                },
                UnixOrHost::Fd(fd) => {
                    let uvfd = fd.uv();
                    let fd_type = uv::uv_guess_handle(uvfd);
                    if fd_type == uv::HandleType::NamedPipe {
                        true
                    } else if fd_type == uv::HandleType::Unknown {
                        // is not a libuv fd, check if it's a named pipe
                        let osfd: uv::uv_os_fd_t = uvfd as usize as uv::uv_os_fd_t;
                        if bun_sys::windows::GetFileType(osfd) == bun_sys::windows::FILE_TYPE_PIPE {
                            // yay its a named pipe lets make it a libuv fd
                            *fd = Fd::from_system(osfd)
                                .make_lib_uv_owned()
                                .unwrap_or_else(|_| panic!("failed to allocate file descriptor"));
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                }
                _ => false,
            };
            if is_named_pipe {
                default_data.ensure_still_alive();

                // PORT NOTE: by-value move of Handlers — see `listen()` for rationale.
                // SAFETY: socket_config.handlers is valid; we forget socket_config below.
                let handlers_moved: Handlers = unsafe { core::ptr::read(&socket_config.handlers) };
                let mut ssl_taken = socket_config.ssl.take();
                core::mem::forget(socket_config);

                let mut handlers_box = Box::new(handlers_moved);
                handlers_box.mode = SocketMode::Client;

                let promise = jsc::JSPromise::create(global);
                let promise_value = promise.to_js();
                // Set on the `Box` before `into_raw` so no raw-deref is needed.
                handlers_box
                    .promise
                    .with_mut(|p| p.set(global, promise_value));
                let handlers_ptr: *mut Handlers = bun_core::heap::into_raw(handlers_box);

                if ssl_enabled {
                    let tls: *mut TLSSocket = if let Some(prev_ptr) = prev_maybe_tls {
                        // SAFETY: caller passes a live TLSSocket
                        let prev = unsafe { &*prev_ptr };
                        if let Some(prev_handlers) = prev.handlers.get() {
                            // SAFETY: prev_handlers was heap-allocated
                            unsafe { drop(bun_core::heap::take(prev_handlers.as_ptr())) };
                        }
                        debug_assert!(!prev.this_value.get().is_empty());
                        prev.handlers.set(NonNull::new(handlers_ptr));
                        debug_assert!(matches!(
                            prev.socket.get().socket,
                            uws::InternalSocket::Detached
                        ));
                        // Free old resources before reassignment to prevent memory leaks
                        // when sockets are reused for reconnection (common with MongoDB driver)
                        prev.connection.set(Some(connection));
                        if prev.flags.get().contains(SocketFlags::OWNED_PROTOS) {
                            prev.protos.set(None);
                        }
                        prev.protos
                            .set(ssl_taken.as_mut().and_then(|s| s.take_protos()));
                        prev.server_name
                            .set(ssl_taken.as_mut().and_then(|s| s.take_server_name()));
                        prev_ptr
                    } else {
                        TLSSocket::new(TLSSocket {
                            ref_count: bun_ptr::RefCount::init(),
                            handlers: Cell::new(NonNull::new(handlers_ptr)),
                            socket: Cell::new(uws::NewSocketHandler::<true>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            protos: JsCell::new(ssl_taken.as_mut().and_then(|s| s.take_protos())),
                            server_name: JsCell::new(
                                ssl_taken.as_mut().and_then(|s| s.take_server_name()),
                            ),
                            owned_ssl_ctx: Cell::new(None),
                            flags: Cell::new(SocketFlags::default()),
                            this_value: JsCell::new(jsc::JsRef::empty()),
                            poll_ref: JsCell::new(KeepAlive::init()),
                            ref_pollref_on_connect: Cell::new(true),
                            buffered_data_for_node_net: Default::default(),
                            bytes_written: Cell::new(0),
                            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
                            twin: JsCell::new(None),
                        })
                    };
                    // SAFETY: tls is a valid heap pointer
                    let tls_ref = unsafe { &*tls };
                    TLSSocket::data_set_cached(
                        tls_ref.get_this_value(global),
                        global,
                        default_data,
                    );
                    tls_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
                    tls_ref.ref_();

                    // Transfer the borrowed CTX into the pipe's SSLWrapper. From
                    // here it owns the ref on every path (initWithCTX adopts on
                    // success, initTLSWrapper frees on failure), so null our local
                    // before the call so the errdefer above can't double-free.
                    let ctx_for_pipe =
                        core::mem::replace(&mut *ssl_ctx_guard, None).map(|p| p.as_ptr());
                    // PORT NOTE: re-borrow connection from the socket field — `connection`
                    // was moved into `tls` above (single allocation in Zig, aliased read).
                    let named_pipe_result = match tls_ref.connection.get().as_ref().unwrap() {
                        UnixOrHost::Unix(_) => WindowsNamedPipeContext::connect(
                            global,
                            &buf[..pipe_name_len.unwrap()],
                            ssl_taken.take(),
                            ctx_for_pipe,
                            PipeSocketType::Tls(tls),
                        ),
                        UnixOrHost::Fd(fd) => WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            ssl_taken.take(),
                            ctx_for_pipe,
                            PipeSocketType::Tls(tls),
                        ),
                        _ => unreachable!(),
                    };
                    let named_pipe = match named_pipe_result {
                        Ok(p) => p,
                        Err(_) => return Ok(promise_value),
                    };
                    tls_ref.socket.set(uws::NewSocketHandler {
                        socket: uws::InternalSocket::Pipe(named_pipe.cast()),
                    });
                } else {
                    let tcp: *mut TCPSocket = if let Some(prev_ptr) = prev_maybe_tcp {
                        // SAFETY: caller passes a live TCPSocket
                        let prev = unsafe { &*prev_ptr };
                        debug_assert!(!prev.this_value.get().is_empty());
                        if let Some(prev_handlers) = prev.handlers.get() {
                            // SAFETY: prev_handlers was heap-allocated
                            unsafe { drop(bun_core::heap::take(prev_handlers.as_ptr())) };
                        }
                        prev.handlers.set(NonNull::new(handlers_ptr));
                        debug_assert!(matches!(
                            prev.socket.get().socket,
                            uws::InternalSocket::Detached
                        ));
                        // Adopt `connection` (heap-owned for .unix) so the socket's
                        // deinit frees it; matches the TLS arm above and the
                        // non-pipe arm below. Previously `.connection = null`
                        // dropped the duped pipe-path bytes on the floor.
                        prev.connection.set(Some(connection));
                        debug_assert!(prev.protos.get().is_none());
                        debug_assert!(prev.server_name.get().is_none());
                        prev_ptr
                    } else {
                        TCPSocket::new(TCPSocket {
                            ref_count: bun_ptr::RefCount::init(),
                            handlers: Cell::new(NonNull::new(handlers_ptr)),
                            socket: Cell::new(uws::NewSocketHandler::<false>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            protos: JsCell::new(None),
                            server_name: JsCell::new(None),
                            owned_ssl_ctx: Cell::new(None),
                            flags: Cell::new(SocketFlags::default()),
                            this_value: JsCell::new(jsc::JsRef::empty()),
                            poll_ref: JsCell::new(KeepAlive::init()),
                            ref_pollref_on_connect: Cell::new(true),
                            buffered_data_for_node_net: Default::default(),
                            bytes_written: Cell::new(0),
                            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
                            twin: JsCell::new(None),
                        })
                    };
                    // SAFETY: tcp is a valid heap pointer
                    let tcp_ref = unsafe { &*tcp };
                    tcp_ref.ref_();
                    TCPSocket::data_set_cached(
                        tcp_ref.get_this_value(global),
                        global,
                        default_data,
                    );
                    tcp_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));

                    let named_pipe_result = match tcp_ref.connection.get().as_ref().unwrap() {
                        UnixOrHost::Unix(_) => WindowsNamedPipeContext::connect(
                            global,
                            &buf[..pipe_name_len.unwrap()],
                            None,
                            None,
                            PipeSocketType::Tcp(tcp),
                        ),
                        UnixOrHost::Fd(fd) => WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            None,
                            None,
                            PipeSocketType::Tcp(tcp),
                        ),
                        _ => unreachable!(),
                    };
                    let named_pipe = match named_pipe_result {
                        Ok(p) => p,
                        Err(_) => return Ok(promise_value),
                    };
                    tcp_ref.socket.set(uws::NewSocketHandler {
                        socket: uws::InternalSocket::Pipe(named_pipe.cast()),
                    });
                }
                return Ok(promise_value);
            }
        }

        // SecureContext was already borrowed above; build the SSL_CTX from
        // SSLConfig only if no SecureContext was passed. doConnect hands
        // `socket.owned_ssl_ctx` to the per-VM connect group.
        if ssl_enabled && ssl_ctx_guard.is_none() {
            if let Some(ssl_cfg) = socket_config.ssl.as_ref() {
                // Per-VM weak `SSLContextCache`: identical configs (including the
                // common `tls:true` / `{servername}`-only / `{ALPNProtocols}`-only
                // cases — those fields aren't in the digest because they're
                // applied per-SSL, not per-CTX) share one `SSL_CTX*`. The
                // `requires_custom_request_ctx` gate is gone; the cache makes the
                // default-vs-custom distinction by content.
                let mut create_err = uws::create_bun_socket_error_t::none;
                // SAFETY: `vm_ssl_ctx_cache()` returns the per-thread cache field
                // inside the boxed `RuntimeState`; address-stable until VM teardown.
                let cache = unsafe { &mut *vm_ssl_ctx_cache() };
                match cache.get_or_create(ssl_cfg, &mut create_err) {
                    Some(ctx) => {
                        *ssl_ctx_guard = NonNull::new(ctx.cast::<boring_sys::SSL_CTX>());
                    }
                    None => {
                        return Err(global.throw_value(
                            crate::socket::uws_jsc::create_bun_socket_error_to_js(
                                create_err, global,
                            ),
                        ));
                    }
                }
            }
        }
        // (errdefer for owned_ssl_ctx already armed at the earlier lookup site;
        // duplicating it here would double-free on error.)

        default_data.ensure_still_alive();

        // PORT NOTE: by-value move of Handlers. See `listen()` for rationale.
        // SAFETY: socket_config.handlers is valid; we forget socket_config below to avoid double-drop.
        let handlers_moved: Handlers =
            unsafe { core::ptr::read(&raw const socket_config.handlers) };
        let allow_half_open = socket_config.allow_half_open;
        let mut ssl_taken = socket_config.ssl.take();
        core::mem::forget(socket_config);

        let mut handlers_box = Box::new(handlers_moved);
        handlers_box.mode = SocketMode::Client;

        let promise = jsc::JSPromise::create(global);
        let promise_value = promise.to_js();
        // Set on the `Box` before `into_raw` so no raw-deref is needed.
        handlers_box
            .promise
            .with_mut(|p| p.set(global, promise_value));
        let handlers_ptr: *mut Handlers = bun_core::heap::into_raw(handlers_box);

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
    pub fn getsockname(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let ListenerType::Uws(socket) = this.listener.get() else {
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
        let prev = unsafe { &*prev_ptr };
        // TODO(port): `JsRef::is_not_empty` — assert non-empty wrapper.
        if let Some(prev_handlers) = prev.handlers.get() {
            // SAFETY: prev_handlers was heap-allocated
            unsafe { drop(bun_core::heap::take(prev_handlers.as_ptr())) };
        }
        prev.handlers.set(NonNull::new(handlers_ptr));
        // TODO(port): debug_assert!(matches!(prev.socket.get().socket, InternalSocket::Detached))
        // Free old resources before reassignment to prevent memory leaks
        // when sockets are reused for reconnection (common with MongoDB driver)
        prev.connection.set(Some(connection));
        if prev.flags.get().contains(SocketFlags::OWNED_PROTOS) {
            prev.protos.set(None); // drop old Box
        }
        prev.protos.set(ssl.as_mut().and_then(|s| s.take_protos()));
        prev.server_name
            .set(ssl.as_mut().and_then(|s| s.take_server_name()));
        if let Some(old) = prev.owned_ssl_ctx.get() {
            // SAFETY: FFI — old is the previous owned SSL_CTX ref on this reused socket
            unsafe { boring_sys::SSL_CTX_free(old) };
        }
        prev.owned_ssl_ctx.set(owned_ssl_ctx.map(|p| p.as_ptr()));
        prev_ptr
    } else {
        NewSocket::<IS_SSL>::new(NewSocket::<IS_SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: Cell::new(NonNull::new(handlers_ptr)),
            socket: Cell::new(uws::NewSocketHandler::<IS_SSL>::DETACHED),
            connection: JsCell::new(Some(connection)),
            protos: JsCell::new(ssl.as_mut().and_then(|s| s.take_protos())),
            server_name: JsCell::new(ssl.as_mut().and_then(|s| s.take_server_name())),
            owned_ssl_ctx: Cell::new(owned_ssl_ctx.map(|p| p.as_ptr())),
            flags: Cell::new(SocketFlags::default()),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
            twin: JsCell::new(None),
        })
    };
    // Ownership moved into `socket`; disarm the errdefer.
    // (owned_ssl_ctx consumed above)
    // SAFETY: socket is a valid heap pointer
    let socket_ref = unsafe { &*socket };
    socket_ref.ref_();
    NewSocket::<IS_SSL>::data_set_cached(socket_ref.get_this_value(global), global, default_data);
    // On the reuse-prev path, `prev.this_value` was downgraded to Weak by the
    // previous close's `mark_inactive()`. `get_this_value()` returns the
    // existing wrapper (the Weak `try_get()` succeeds while the JS side still
    // references it via `socket._handle`) but does NOT re-upgrade — so until
    // `on_open()` → `mark_active()` runs, the wrapper is only kept alive by
    // the JS-side reference cycle (`socket._handle` ↔ `wrapper.data.self`).
    // If GC runs before the async TCP connect completes, `finalize()` sets
    // `FINALIZING` + `close_and_detach()` → `on_open` never fires and the JS
    // socket hangs forever with no connect/error/close. Upgrade here so the
    // in-flight connect pins the wrapper. (Same guard as `mark_active`; no-op
    // on the fresh-allocation path where `get_this_value` already
    // `set_strong`'d.) Intentionally diverges from the Zig spec, which has
    // the same race.
    if socket_ref.this_value.get().is_not_empty() {
        socket_ref.this_value.with_mut(|r| r.upgrade(global));
    }
    {
        let mut f = socket_ref.flags.get();
        f.set(SocketFlags::ALLOW_HALF_OPEN, allow_half_open);
        socket_ref.flags.set(f);
    }
    // PORT NOTE: Zig stored `connection` in the socket field and passed the same
    // value to doConnect (single allocation, aliased read). `do_connect` now
    // reads `self.connection` directly so no second borrow is needed here.
    if socket_ref.do_connect().is_err() {
        let errno = if port.is_none() {
            bun_sys::SystemErrno::ENOENT as c_int
        } else {
            bun_sys::SystemErrno::ECONNREFUSED as c_int
        };
        // SAFETY: `socket` is the live heap pointer; `socket_ref`'s `&mut` is no
        // longer used on this branch. `handle_connect_error` takes `*mut Self`
        // (noalias re-entrancy) — no `&mut NewSocket` held across its JS call.
        unsafe {
            let _ = NewSocket::<IS_SSL>::handle_connect_error(socket, errno);
            // Balance the unconditional `socket_ref.ref_()` above.
            (*socket).deref();
        }
        return Ok(promise_value);
    }

    // if this is from node:net there's surface where the user can .ref() and .deref()
    // before the connection starts. make sure we honor that here.
    if socket_ref.ref_pollref_on_connect.get() {
        socket_ref
            .poll_ref
            .with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
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
        // R-2: deref as shared (`&*`) — `add_server_name` takes `&Self`.
        return Listener::add_server_name(
            unsafe { &*this },
            global,
            arguments.ptr[1],
            arguments.ptr[2],
        );
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
    /// BACKREF: the parent `Listener` heap-allocated this context in
    /// `listen_named_pipe` and outlives it (cleared to `None` in
    /// `close_pipe_and_deinit` before the listener is torn down). `BackRef`
    /// centralises the safe deref so call sites don't open-code a raw
    /// `NonNull::as_ref`.
    pub listener: Option<bun_ptr::BackRef<Listener>>,
    pub global_this: GlobalRef,
    /// JSC_BORROW: process-lifetime singleton; `&'static` so call sites read
    /// `self.vm.is_shutting_down()` without a raw-pointer deref.
    pub vm: &'static VirtualMachine,
    pub ctx: Option<NonNull<boring_sys::SSL_CTX>>, // server reuses the same ctx
}

#[cfg(not(windows))]
pub struct WindowsNamedPipeListeningContext {
    _priv: (),
}

#[cfg(not(windows))]
impl WindowsNamedPipeListeningContext {
    /// Unreachable on POSIX — `ListenerType::NamedPipe` is never constructed
    /// here. Kept so the `match` arms in `stop`/`finalize` type-check on both
    /// platforms without per-arm `#[cfg]`.
    pub unsafe fn close_pipe_and_deinit(_this: *mut Self) {}
}

#[cfg(windows)]
impl WindowsNamedPipeListeningContext {
    fn on_client_connect(this: *mut Self, status: uv::ReturnCode) {
        // SAFETY: `this` is the `data` pointer libuv hands back; it was set to a
        // live heap `WindowsNamedPipeListeningContext` in `listen_named_pipe`.
        let this_ref = unsafe { &mut *this };
        let shutting_down = this_ref.vm.is_shutting_down();
        if status != uv::ReturnCode::ZERO || shutting_down || this_ref.listener.is_none() {
            // connection dropped or vm is shutting down or we are deiniting/closing
            return;
        }
        // `BackRef` deref — owner `Listener` outlives this context (see field doc).
        let listener_ref = this_ref.listener.unwrap();
        let listener: &Listener = listener_ref.get();
        use crate::socket::windows_named_pipe_context::SocketType as PipeSocketType;
        let socket: PipeSocketType = if this_ref.ctx.is_some() {
            PipeSocketType::Tls(Listener::on_name_pipe_created::<true>(listener))
        } else {
            PipeSocketType::Tcp(Listener::on_name_pipe_created::<false>(listener))
        };

        let client = WindowsNamedPipeContext::create(&this_ref.global_this, socket);

        // SAFETY: `client` was just heap-allocated by `create()`; exclusive here.
        let result = unsafe {
            (*client)
                .named_pipe
                .get_accepted_by(&mut this_ref.uv_pipe, this_ref.ctx.map(|p| p.as_ptr()))
        };
        if result.is_err() {
            // connection dropped
            // PORT NOTE: Zig (Listener.zig:994) calls `client.deinit()` synchronously here,
            // freeing the ctx before returning from the libuv connection callback. We instead
            // release the only ref, which goes 1→0 → schedule_deinit → next-tick free. The
            // deferred path is kept because `get_accepted_by` may have already `uv_pipe_init`'d
            // the client's inner handle on the loop; freeing the backing storage in-callback
            // before `uv_close` completes is the exact pattern libuv forbids. Drop semantics
            // match Zig's `deinit` (socket.deref() then named_pipe.deinit()), so this is a
            // timing divergence only.
            // SAFETY: `client` was just allocated via `WindowsNamedPipeContext::create`
            // with refcount==1; releasing the only ref schedules deinit.
            unsafe { WindowsNamedPipeContext::deref(client) };
        }
    }

    /// `uv_connection_cb` trampoline — recovers `*Self` from `handle.data`
    /// (set by `Pipe::listen`) and forwards to [`on_client_connect`].
    /// Only ever invoked by libuv (coerces to the `uv_connection_cb` fn-pointer
    /// type at the `Pipe::listen_named_pipe` call site); body wraps its derefs
    /// explicitly — matches the `extern "C" fn` callback convention used in
    /// `udp_socket.rs` / `bun_io::PipeReader`.
    extern "C" fn uv_on_client_connect(handle: *mut uv::uv_stream_t, status: uv::ReturnCode) {
        // SAFETY: `data` was set to `*mut Self` by `Pipe::listen` below.
        let this = unsafe { (*handle).data.cast::<WindowsNamedPipeListeningContext>() };
        Self::on_client_connect(this, status);
    }

    /// `uv_close_cb` trampoline. Only ever invoked by libuv (coerces to the
    /// `uv_close_cb` fn-pointer type at the `Pipe::close` call site); body
    /// wraps its deref explicitly.
    extern "C" fn on_pipe_closed(pipe: *mut uv::Pipe) {
        // SAFETY: `pipe.data` was set to `this` in `close_pipe_and_deinit`.
        let this = unsafe { (*pipe).data.cast::<WindowsNamedPipeListeningContext>() };
        Self::deinit(this);
    }

    /// # Safety
    /// `this` must be the unique owner (the `ListenerType::NamedPipe` slot was
    /// already cleared by the caller).
    pub unsafe fn close_pipe_and_deinit(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live heap allocation.
        unsafe {
            (*this).listener = None;
            (*this).uv_pipe.data = this.cast::<c_void>();
            (*this).uv_pipe.close(Self::on_pipe_closed);
        }
    }

    pub fn listen(
        global_this: &JSGlobalObject,
        path: &[u8],
        backlog: i32,
        ssl_config: Option<&SSLConfig>,
        listener: *mut Listener,
    ) -> Result<*mut WindowsNamedPipeListeningContext, bun_core::Error> {
        // `bun.TrivialNew` — heap-allocate at the final address so libuv can
        // store a pointer back into `uv_pipe`.
        let this = bun_core::heap::into_raw(Box::new(WindowsNamedPipeListeningContext {
            uv_pipe: bun_core::ffi::zeroed(),
            listener: NonNull::new(listener).map(bun_ptr::BackRef::from),
            global_this: GlobalRef::from(global_this),
            vm: global_this.bun_vm(),
            ctx: None,
        }));
        // SAFETY: just allocated, non-null, exclusive.
        let this_ref = unsafe { &mut *this };

        // errdefer: once the uv pipe handle is registered with the loop it must be closed via
        // uv_close; before that point we can free the struct directly. `deinit()` also
        // frees the SSL context if one was created. State `.1` flips once `uv_pipe_init`
        // succeeds; disarmed via `into_inner` on success.
        let mut cleanup = scopeguard::guard((this, false), |(this, pipe_initialized)| {
            if pipe_initialized {
                // SAFETY: pipe is registered with the loop; close → on_pipe_closed → deinit.
                unsafe { Self::close_pipe_and_deinit(this) };
            } else {
                Self::deinit(this);
            }
        });

        if let Some(ssl_options) = ssl_config {
            boringssl::load();

            let ctx_opts = ssl_options.as_usockets();
            let mut err = uws::create_bun_socket_error_t::none;
            // Create SSL context using uSockets to match behavior of node.js
            match ctx_opts.create_ssl_context(&mut err) {
                Some(ctx) => this_ref.ctx = NonNull::new(ctx.cast::<boring_sys::SSL_CTX>()),
                None => return Err(bun_core::err!("InvalidOptions")),
            }
        }

        let init_result = this_ref.uv_pipe.init(this_ref.vm.uv_loop().cast(), false);
        if init_result.is_err() {
            return Err(bun_core::err!("FailedToInitPipe"));
        }
        cleanup.1 = true;

        let listen_rc = if path[path.len() - 1] == 0 {
            // is already null terminated
            this_ref.uv_pipe.listen_named_pipe(
                &path[..path.len() - 1],
                backlog,
                this.cast::<c_void>(),
                Self::uv_on_client_connect,
            )
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);
            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            this_ref.uv_pipe.listen_named_pipe(
                &path_buf[..len],
                backlog,
                this.cast::<c_void>(),
                Self::uv_on_client_connect,
            )
        };
        if listen_rc.is_err() {
            return Err(bun_core::err!("FailedToBindPipe"));
        }
        //TODO: add readableAll and writableAll support if someone needs it
        // if(uv.uv_pipe_chmod(&this.uvPipe, uv.UV_WRITABLE | uv.UV_READABLE) != 0) {
        // this.closePipeAndDeinit();
        // return error.FailedChmodPipe;
        //}

        let (this, _) = scopeguard::ScopeGuard::into_inner(cleanup);
        Ok(this)
    }

    fn deinit(this: *mut Self) {
        // SAFETY: `this` is a live `heap::alloc` allocation; this is the last owner.
        unsafe {
            (*this).listener = None;
            if let Some(ctx) = (*this).ctx.take() {
                boring_sys::SSL_CTX_free(ctx.as_ptr());
            }
            drop(bun_core::heap::take(this));
        }
    }
}

// ported from: src/runtime/socket/Listener.zig
