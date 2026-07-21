//! This is the code for the object returned by Bun.listen().

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_boringssl_sys as boring_sys;
use bun_io::KeepAlive;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::strong::Optional as Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::zig_string::ZigString;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult};
use bun_sys::{self, Fd};
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::api::bun_secure_context::SecureContext;
use crate::socket::{
    Handlers, NewSocket, SocketConfig, SocketFlags, SocketMode, TCPSocket, TLSSocket,
};
use crate::socket::{SSLConfig, SSLConfigFromJs};

#[cfg(windows)]
use crate::socket::WindowsNamedPipeContext;

#[cfg(windows)]
use crate::node::path as node_path;
#[cfg(windows)]
use bun_boringssl as boringssl;
#[cfg(windows)]
use bun_core::strings;
#[cfg(windows)]
use bun_jsc::GlobalRef;
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_paths::PathBuffer;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

bun_output::define_scoped_log!(log, Listener, visible);

/// Runs `f` against this thread's `SSL_CTX` cache. Takes a callback rather than
/// handing out a `&'static mut`, which two callers could hold at once.
#[inline]
fn with_ssl_ctx_cache<R>(
    f: impl FnOnce(&mut crate::api::SSLContextCache::SSLContextCache) -> R,
) -> R {
    let state = crate::jsc_hooks::runtime_state();
    debug_assert!(
        !state.is_null(),
        "runtime_state() before init_runtime_state"
    );
    // SAFETY: `state` is the per-thread `RuntimeState` boxed in
    // `init_runtime_state`, address-stable until VM teardown, and only the JS
    // thread reaches here — so this `&mut` is unique for `f`'s duration.
    f(unsafe { &mut (*state).ssl_ctx_cache })
}

// Route through the codegen'd `toJS` wrapper so we
// can hand the C++ side an already-heap-allocated `*mut Listener` (the
// embedded `group` is linked into the loop's intrusive list at its final
// address before this call, so the `Box::new`-then-move that the `#[JsClass]`
// `to_js(self)` impl does would invalidate that link).
use crate::generated_classes::js_Listener;

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut Listener` — `&mut T` auto-derefs to `&T`
// so the impls below compile against either.
#[bun_jsc::JsClass(no_constructor)]
pub struct Listener {
    pub handlers: Rc<Handlers>,
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
    pub reject_unauthorized: bool,
    pub strong_data: JsCell<Strong>,
    /// Reference to this listener's JS wrapper. Strong while it is listening or
    /// has connections, downgraded to weak once idle so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
}

#[derive(Clone, Copy, Default)]
pub enum ListenerType {
    Uws(*mut uws_sys::ListenSocket),
    /// Raw heap pointer (not `Box`) to a `WindowsNamedPipeListeningContext`.
    /// The context's address is registered with libuv (`uv_pipe.data`) for the
    /// lifetime of the handle, so we must never assert `noalias` over it via a
    /// Box move or `&mut Listener` that transitively covers the context — that
    /// would invalidate the pointer libuv holds under Stacked Borrows. Ownership
    /// is still unique; freed via `close_pipe_and_deinit` → `on_pipe_closed` → `deinit`.
    NamedPipe(NonNull<WindowsNamedPipeListeningContext>),
    #[default]
    None,
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
    // Note: deinit() deleted — Box<[u8]> fields auto-drop.
}

impl Listener {
    #[bun_jsc::host_fn(method)]
    pub fn reload(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_old::<1>();

        if args.len < 1
            || (matches!(this.listener.get(), ListenerType::None)
                && this.handlers.active_connections.get() == 0)
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

        // Validates like construction (the option getters run user JS), then
        // updates the callbacks of the existing cell in place, so the
        // listener and every live socket sharing it pick them up with no swap
        // of the `Handlers` itself.
        let reloaded = Handlers::prepare_reload(global, socket_obj)?;
        this.handlers.apply_reload(global, &reloaded);

        Ok(JSValue::UNDEFINED)
    }

    // Note: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub fn listen(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        log!("listen");
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        // SAFETY: VirtualMachine::get() returns the per-thread VM; valid for program lifetime.
        let vm = VirtualMachine::get().as_mut();

        let mut socket_config = SocketConfig::from_js(vm, opts, global, SocketMode::Server)?;
        // Teardown handled by Drop on SocketConfig; `handlers` is an `Rc` the
        // `Listener` clones out of it.
        //
        // The handlers cell has no JS wrapper holding it yet — root it until
        // `js_Listener::handlers_set_cached` below.
        let _cell_root = socket_config.handlers.root_cell(global);

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
                // Note: reshaped — `pipe_name` borrows `buf`; copy to an owned
                // buffer so the borrow ends before we `mem::take` from
                // `socket_config` below.
                let mut pipe_buf = PathBuffer::uninit();
                let pipe_len = pipe_name.len();
                pipe_buf[..pipe_len].copy_from_slice(pipe_name);

                // Move the hostname bytes into `connection`; `socket_config`
                // drops the emptied slice.
                let connection = UnixOrHost::Unix(
                    core::mem::take(&mut socket_config.hostname_or_unix)
                        .into_vec()
                        .into_boxed_slice(),
                );

                vm.event_loop_ref().ensure_waker();

                let handlers = Rc::clone(&socket_config.handlers);
                let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
                let default_data = socket_config.default_data;
                let ssl_cfg_taken = socket_config.ssl.take();

                let this: *mut Listener = bun_core::heap::into_raw(Box::new(Listener {
                    handlers,
                    connection,
                    ssl: ssl_enabled,
                    listener: Cell::new(ListenerType::None),
                    protos: protos_taken,
                    reject_unauthorized: crate::socket::resolve_reject_unauthorized(
                        vm,
                        ssl_cfg_taken.as_ref(),
                        true,
                    ),
                    poll_ref: JsCell::new(KeepAlive::init()),
                    group: JsCell::new(uws::SocketGroup::default()),
                    secure_ctx: None,
                    strong_data: JsCell::new(Strong::empty()),
                    this_value: JsCell::new(JsRef::empty()),
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
                    Err(e) => {
                        this_ref.strong_data.with_mut(|s| s.deinit());
                        // SAFETY: reclaim the Box we leaked via into_raw; drops connection,
                        // protos, and the handlers `Rc`.
                        drop(unsafe { bun_core::heap::take(this) });
                        // Surface coded syscall failures the way node:net
                        // does (EADDRINUSE vs EACCES need different caller
                        // handling) rather than an invalid-arguments TypeError.
                        if let ListenPipeError::Sys(sys_err, uv_rc) = &e {
                            // get_error_code_tag_name does not reject EUNKNOWN /
                            // UV_EAI_* (>=3000); neither is a node-style code, so
                            // route those through the generic error below.
                            if let Some((name, se)) = sys_err.get_error_code_tag_name() {
                                if se != bun_sys::SystemErrno::EUNKNOWN && (se as u16) < 3000 {
                                    let err = jsc::SystemError {
                                        // The raw negative UV_E* code: node's JS errno
                                        // (-4091 EADDRINUSE on Windows), NOT the
                                        // platform-independent E discriminant (-98).
                                        errno: *uv_rc,
                                        code: bun_core::String::static_(name),
                                        message: bun_core::String::clone_utf8(
                                            format!(
                                                "listen {}: {}",
                                                name,
                                                bstr::BStr::new(&pipe_buf[..pipe_len])
                                            )
                                            .as_bytes(),
                                        ),
                                        syscall: bun_core::String::static_("listen"),
                                        fd: -1,
                                        path: bun_core::String::clone_utf8(&pipe_buf[..pipe_len]),
                                        hostname: bun_core::String::empty(),
                                        dest: bun_core::String::empty(),
                                    };
                                    return Err(global.throw_value(err.to_error_instance(global)));
                                }
                            }
                        }
                        let detail = match &e {
                            ListenPipeError::Other(err) => err.name(),
                            // Sys whose errno has no node-style code (EUNKNOWN / UV_EAI_*).
                            ListenPipeError::Sys(..) => "UNKNOWN",
                        };
                        return Err(global.throw_invalid_arguments(format_args!(
                            "Failed to listen at {}: {}",
                            bstr::BStr::new(&pipe_buf[..pipe_len]),
                            detail
                        )));
                    }
                }

                // SAFETY: `global` is live; ownership of `this` (heap-allocated above)
                // transfers to the C++ wrapper.
                let this_value = js_Listener::to_js(this, global);
                // The listener holds the handlers cell in a visited slot; every
                // accepted socket shares the same cell.
                js_Listener::handlers_set_cached(this_value, global, this_ref.handlers.cell());
                this_ref.handlers.set_listener(NonNull::new(this));
                this_ref
                    .this_value
                    .with_mut(|r| r.set_strong(this_value, global));
                this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
                return Ok(this_value);
            }
        }

        vm.event_loop_ref().ensure_waker();

        // Allocate the Listener up front so the embedded `group` has its final
        // address before we hand it to listen() (it's linked into the loop's
        // intrusive list).
        let handlers = Rc::clone(&socket_config.handlers);
        let protos_taken = socket_config.ssl.as_mut().and_then(|s| s.take_protos());
        let default_data = socket_config.default_data;
        let hostname_owned: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
            .into_vec()
            .into_boxed_slice();
        let fd_opt = socket_config.fd;
        let ssl_cfg_taken = socket_config.ssl.take();

        let this: *mut Listener = bun_core::heap::into_raw(Box::new(Listener {
            handlers,
            // Placeholder until `this_ref.connection = connection` below.
            // Cannot `mem::zeroed()` a Rust enum (UB).
            connection: UnixOrHost::Fd(Fd::invalid()),
            ssl: ssl_enabled,
            protos: protos_taken,
            reject_unauthorized: crate::socket::resolve_reject_unauthorized(
                vm,
                ssl_cfg_taken.as_ref(),
                true,
            ),
            listener: Cell::new(ListenerType::None),
            poll_ref: JsCell::new(KeepAlive::init()),
            group: JsCell::new(uws::SocketGroup::default()),
            secure_ctx: None,
            strong_data: JsCell::new(Strong::empty()),
            this_value: JsCell::new(JsRef::empty()),
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
        // Paired unregister in `deinit()` (and the cleanup guard below).
        bun_core::asan::register_root_region(
            this_ref.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
        // Cleanup guard: on any early return below, tear down the half-built Listener.
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

        // The `hostname` Box<[u8]> drops on error path automatically
        let mut connection: UnixOrHost = if let Some(port_) = port {
            UnixOrHost::Host {
                host: hostname_owned,
                port: port_,
            }
        } else if let Some(fd) = fd_opt {
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
                let hostz = bun_core::ZBox::from_bytes(&host[..]);
                let host_cstr = hostz.as_zstr().as_cstr();
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
            UnixOrHost::Fd(fd) => this_ref.group.with_mut(|g| {
                g.listen_fd(
                    kind,
                    secure_ctx_ptr,
                    fd.native() as uws::LIBUS_SOCKET_DESCRIPTOR,
                    socket_flags,
                    size_of::<*mut c_void>() as c_int,
                    &mut errno,
                )
            }),
        };
        if listen_socket.is_null() {
            // Note: reshaped for borrowck — extract hostname bytes for error formatting
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
            // libuv reports UV_EINVAL for a pipe path it cannot express in a
            // sockaddr_un, which is what Node surfaces for an over-long path.
            // Node's createServerHandle(fd) calls guessHandleType first and
            // returns UV_EINVAL for anything that is not TCP or PIPE, so a
            // non-socket or bad fd surfaces as EINVAL there, not the kernel's
            // ENOTSOCK/EBADF (or WSAENOTSOCK on Windows).
            let mapped = bun_sys::SystemErrno::init(errno as i64);
            let errno = if mapped == Some(bun_sys::SystemErrno::ENAMETOOLONG)
                || (matches!(connection, UnixOrHost::Fd(_))
                    && matches!(
                        mapped,
                        Some(bun_sys::SystemErrno::ENOTSOCK) | Some(bun_sys::SystemErrno::EBADF)
                    )) {
                bun_sys::SystemErrno::EINVAL as c_int
            } else {
                errno
            };
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
            // Register the dynamic SNI dispatch when the JS config provided a
            // `serverName` handler - `us_select_cert_cb` invokes it FIRST for
            // every ClientHello carrying a servername (the user callback takes
            // precedence over the static SNI tree, Node semantics) and
            // installs whichever context it returns on the in-flight SSL. A
            // null return falls back to the static tree (bind hostname +
            // addContext entries), then the default context; an asynchronous
            // resolution suspends the handshake until resumeSNI.
            if !this_ref.handlers.on_server_name().is_empty() {
                // S008: `ListenSocket` is an `opaque_ffi!` ZST - safe deref.
                bun_opaque::opaque_deref_mut(listen_socket).on_server_name(us_dispatch_server_name);
            }
        }

        let this = scopeguard::ScopeGuard::into_inner(cleanup); // ownership transfers to JS wrapper
        // SAFETY: `global` is live; ownership of `this` (heap-allocated above)
        // transfers to the C++ wrapper (freed via `ListenerClass__finalize` →
        // `Listener::finalize` → `deinit`).
        let this_value = js_Listener::to_js(this, global);
        // The listener holds the handlers cell in a visited slot; every
        // accepted socket shares the same cell.
        js_Listener::handlers_set_cached(this_value, global, this_ref.handlers.cell());
        this_ref.handlers.set_listener(NonNull::new(this));
        this_ref
            .this_value
            .with_mut(|r| r.set_strong(this_value, global));
        this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));

        Ok(this_value)
    }

    // `OWNED_PROTOS` stays unset: accepted sockets clone the listener's `protos`.
    fn accepted_socket_flags(&self) -> SocketFlags {
        if self.reject_unauthorized {
            SocketFlags::REJECT_UNAUTHORIZED
        } else {
            SocketFlags::empty()
        }
    }

    pub fn on_name_pipe_created<const SSL: bool>(
        listener: &Listener,
    ) -> bun_ptr::ThisPtr<NewSocket<SSL>> {
        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(Some(Rc::clone(&listener.handlers))),
            socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED),
            protos: JsCell::new(listener.protos.clone()),
            // `protos` is `Option<Box<[u8]>>` so we clone the listener's slice.
            flags: Cell::new(listener.accepted_socket_flags()),
            owned_ssl_ctx: Cell::new(None),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            local_binding: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        });
        let s = this_socket;
        s.ref_();
        if let Some(default_data) = listener.strong_data.get().get() {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::data_set_cached(s.get_this_value(&global), &global, default_data);
        }
        s
    }

    /// Called from `BunListener::on_open` (uws dispatch) for every accepted socket.
    /// Allocates the `NewSocket` wrapper, stashes it in the socket ext, then
    /// re-stamps the kind to `.bun_socket_{tcp,tls}` so subsequent events route
    /// straight to `BunSocket` (the listener arm only fires once per accept).
    pub fn on_create<const SSL: bool>(
        listener: &Listener,
        socket: uws::NewSocketHandler<SSL>,
    ) -> bun_ptr::ThisPtr<NewSocket<SSL>> {
        jsc::mark_binding!();
        log!("onCreate");

        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(Some(Rc::clone(&listener.handlers))),
            socket: Cell::new(socket),
            protos: JsCell::new(listener.protos.clone()),
            // `protos` is `Option<Box<[u8]>>` so each accepted socket clones
            // the listener's slice; one small allocation per accept.
            flags: Cell::new(listener.accepted_socket_flags()),
            owned_ssl_ctx: Cell::new(None),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            local_binding: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(crate::socket::NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        });
        let s = this_socket;
        s.ref_();
        let default_data = listener.strong_data.get().get();
        if let Some(default_data) = default_data {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::data_set_cached(s.get_this_value(&global), &global, default_data);
        }
        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext storage is at least pointer-sized; we stash *mut NewSocket<SSL>
            unsafe { *ctx = this_socket.as_ptr().cast::<c_void>() };
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
        // NUL-terminate for the C `const char*` parameter. Interior NULs are
        // tolerated — the C SNI tree just truncates at the first one. Build the
        // `&CStr` via `from_ptr` to allow that instead of asserting via
        // `ZStr::as_cstr()`. `server_name_z` must outlive the
        // remove_server_name/add_server_name calls below.
        let server_name_z = bun_core::ZBox::from_bytes(server_name_bytes);
        // SAFETY: `server_name_z` is NUL-terminated and lives to end of scope.
        let server_name = unsafe { core::ffi::CStr::from_ptr(server_name_z.as_ptr()) };

        let ListenerType::Uws(ls) = this.listener.get() else {
            return Ok(JSValue::UNDEFINED);
        };

        // Both real callers (node:tls addContext, node:net) pass a native
        // SecureContext; enforcement policy stays server-level, like Node's.
        // The dict branch is defensive for the internal binding's raw form.
        let sni_ctx: *mut boring_sys::SSL_CTX =
            if let Some(sc) = tls.as_class_ref::<SecureContext>() {
                sc.borrow()
            } else if let Some(ssl_config) = {
                // SAFETY: per-thread VM; valid for program lifetime.
                let vm = VirtualMachine::get().as_mut();
                SSLConfig::from_js(vm, global, tls)?
            } {
                // Note: `cfg` cleanup handled by Drop on SSLConfig
                let mut create_err = uws::create_bun_socket_error_t::none;
                match with_ssl_ctx_cache(|cache| cache.get_or_create(&ssl_config, &mut create_err))
                {
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
                        return Err(global
                            .throw_value(crate::crypto::boringssl_jsc::err_to_js(global, code)));
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

        if this.handlers.active_connections.get() == 0 {
            this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
            this.this_value.with_mut(|r| r.downgrade());
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
        this_ref.this_value.with_mut(|r| r.finalize());
        this_ref.strong_data.with_mut(|s| s.deinit());
        this_ref.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        debug_assert!(matches!(this_ref.listener.get(), ListenerType::None));

        // Clear the back-pointer before force-closing: this listener is already
        // releasing its own `poll_ref`/`this_value`, so an accepted socket's
        // `on_close` must not reach back in and release them a second time.
        this_ref.handlers.set_listener(None);
        if this_ref.handlers.active_connections.get() > 0 {
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

        // connection / protos / the handlers `Rc`: dropped by heap::take below
        // SAFETY: reclaim the Box allocated in listen()
        drop(unsafe { bun_core::heap::take(this) });
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connections_count(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.handlers.active_connections.get() as f64)
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
                // On Windows the listening socket fd is a system-kind SOCKET
                // handle; routing it through `.uv()` panics for anything but
                // stdio. The sys_jsc helper branches on kind
                // (system→u64, uv→i32, posix→i32).
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
        this.this_value
            .with_mut(|r| r.set_strong(this_value, global));
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
        if this.handlers.active_connections.get() == 0 {
            this.this_value.with_mut(|r| r.downgrade());
        }
        Ok(JSValue::UNDEFINED)
    }

    // Note: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
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

        // Client mode: these handlers have no owning listener, so
        // `mark_inactive` skips the listener-release branch.
        let mut socket_config = SocketConfig::from_js(vm, opts, global, SocketMode::Client)?;
        // No JS wrapper holds the handlers cell until `connect_finish` creates
        // the socket's; the option getters below run user JS that can GC.
        let handlers = Rc::clone(&socket_config.handlers);
        let _cell_root = handlers.root_cell(global);

        let port = socket_config.port;
        let ssl_enabled = socket_config.ssl.is_some();
        let default_data = socket_config.default_data;

        vm.event_loop_ref().ensure_waker();

        let connection: UnixOrHost = 'blk: {
            if let Some(fd_) = opts.get_truthy(global, "fd")? {
                if fd_.is_number() {
                    #[cfg(windows)]
                    let fd = if opts
                        .get_truthy(global, "fdIsRawSocket")?
                        .is_some_and(|v| v.to_boolean())
                    {
                        Fd::from_system(fd_.to_int32() as u32 as usize as *mut c_void)
                    } else {
                        Fd::from_uv(fd_.to_int32())
                    };
                    #[cfg(not(windows))]
                    let fd = Fd::from_uv(fd_.to_int32());
                    break 'blk UnixOrHost::Fd(fd);
                }
            }
            // Move the hostname bytes into `host`; `socket_config` drops the
            // emptied slice.
            let host: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
                .into_vec()
                .into_boxed_slice();
            if let Some(port_) = port {
                UnixOrHost::Host { host, port: port_ }
            } else {
                UnixOrHost::Unix(host)
            }
        };
        // `connection` Box drops on error path

        // `localAddress`/`localPort`: bind the socket to this address before
        // connecting. node:net validates localAddress as a literal IP and
        // localPort as a number before they reach us.
        let local_binding: Option<(Box<[u8]>, u16)> = 'lb: {
            let Some(local_addr_js) = opts.get_truthy(global, "localAddress")? else {
                break 'lb None;
            };
            if !local_addr_js.is_string() {
                break 'lb None;
            }
            let local_addr_slice = local_addr_js.to_slice(global)?;
            let local_addr_bytes = local_addr_slice.slice();
            if local_addr_bytes.is_empty() {
                break 'lb None;
            }
            let local_port: u16 = match opts.get_truthy(global, "localPort")? {
                Some(p) if p.is_number() => p.to_int32().clamp(0, 65535) as u16,
                _ => 0,
            };
            Some((local_addr_bytes.to_vec().into_boxed_slice(), local_port))
        };

        // Resolve the prebuilt SSL_CTX before the platform branches so the Windows
        // named-pipe path can adopt it. node:tls passes the native SecureContext as
        // `tls.secureContext` so we share its already-built SSL_CTX.
        let mut owned_ssl_ctx: Option<NonNull<boring_sys::SSL_CTX>> = None;
        if ssl_enabled {
            let native_sc: Option<&SecureContext> = 'blk: {
                let Some(tls_js) = opts.get_truthy(global, "tls")? else {
                    break 'blk None;
                };
                if !tls_js.is_object() {
                    break 'blk None;
                }
                let Some(sc_js) = tls_js.get_truthy(global, "secureContext")? else {
                    break 'blk None;
                };
                sc_js.as_class_ref::<SecureContext>()
            };
            if let Some(sc) = native_sc {
                owned_ssl_ctx = NonNull::new(sc.borrow());
            }
        }
        let mut ssl_ctx_guard = scopeguard::guard(owned_ssl_ctx, |c| {
            if let Some(c) = c {
                // SAFETY: FFI — c is a live SSL_CTX* with one owned ref from borrow()/get_or_create()
                unsafe { boring_sys::SSL_CTX_free(c.as_ptr()) };
            }
        });

        #[cfg(windows)]
        let mut connection = connection;
        #[cfg(windows)]
        {
            use crate::socket::windows_named_pipe_context::SocketType as PipeSocketType;
            use bun_sys::FdExt as _;

            let mut buf = PathBuffer::uninit();
            // Note: reshaped for borrowck — `normalize_pipe_name` borrows
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
                UnixOrHost::Fd(fd) if fd.kind() == bun_core::FdKind::System => false,
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

                let mut ssl_taken = socket_config.ssl.take();

                let promise = jsc::JSPromise::create(global);
                let promise_value = promise.to_js();
                handlers.set_promise(global, promise_value);

                if ssl_enabled {
                    let tls: bun_ptr::ThisPtr<TLSSocket> = if let Some(prev_ptr) = prev_maybe_tls {
                        // SAFETY: caller passes a live TLSSocket, owned by its JS wrapper.
                        let prev = unsafe { bun_ptr::ThisPtr::new(prev_ptr) };
                        debug_assert!(!prev.this_value.get().is_empty());
                        prev.set_handlers(global, Some(Rc::clone(&handlers)));
                        debug_assert!(matches!(
                            prev.socket.get().socket,
                            uws::InternalSocket::Detached
                        ));
                        // Free old resources before reassignment to prevent memory leaks
                        // when sockets are reused for reconnection (common with MongoDB driver)
                        prev.connection.set(Some(connection));
                        prev.local_binding.set(local_binding.clone());
                        if prev.flags.get().contains(SocketFlags::OWNED_PROTOS) {
                            prev.protos.set(None);
                        }
                        prev.protos
                            .set(ssl_taken.as_mut().and_then(|s| s.take_protos()));
                        prev.server_name
                            .set(ssl_taken.as_mut().and_then(|s| s.take_server_name()));
                        prev
                    } else {
                        TLSSocket::new(TLSSocket {
                            ref_count: bun_ptr::RefCount::init(),
                            handlers: JsCell::new(Some(Rc::clone(&handlers))),
                            socket: Cell::new(uws::NewSocketHandler::<true>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            local_binding: JsCell::new(local_binding.clone()),
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
                            verify_error: JsCell::new(None),
                        })
                    };
                    let tls_ref = tls;
                    tls_ref.reset_client_tls_flags(crate::socket::resolve_reject_unauthorized(
                        vm,
                        ssl_taken.as_ref(),
                        false,
                    ));
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
                    // before the call so the cleanup guard above can't double-free.
                    let ctx_for_pipe =
                        core::mem::replace(&mut *ssl_ctx_guard, None).map(|p| p.as_ptr());
                    // Note: re-borrow connection from the socket field — `connection`
                    // was moved into `tls` above.
                    let named_pipe_result = match tls_ref.connection.get().as_ref().unwrap() {
                        UnixOrHost::Unix(_) => WindowsNamedPipeContext::connect(
                            global,
                            &buf[..pipe_name_len.unwrap()],
                            ssl_taken.take(),
                            ctx_for_pipe,
                            PipeSocketType::Tls(tls_ref),
                        ),
                        UnixOrHost::Fd(fd) => WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            ssl_taken.take(),
                            ctx_for_pipe,
                            PipeSocketType::Tls(tls_ref),
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
                    let tcp: bun_ptr::ThisPtr<TCPSocket> = if let Some(prev_ptr) = prev_maybe_tcp {
                        // SAFETY: caller passes a live TCPSocket, owned by its JS wrapper.
                        let prev = unsafe { bun_ptr::ThisPtr::new(prev_ptr) };
                        debug_assert!(!prev.this_value.get().is_empty());
                        prev.set_handlers(global, Some(Rc::clone(&handlers)));
                        debug_assert!(matches!(
                            prev.socket.get().socket,
                            uws::InternalSocket::Detached
                        ));
                        // Adopt `connection` (heap-owned for .unix) so the socket's
                        // deinit frees it; matches the TLS arm above and the
                        // non-pipe arm below. Previously `.connection = null`
                        // dropped the duped pipe-path bytes on the floor.
                        prev.connection.set(Some(connection));
                        prev.local_binding.set(local_binding.clone());
                        debug_assert!(prev.protos.get().is_none());
                        debug_assert!(prev.server_name.get().is_none());
                        prev
                    } else {
                        TCPSocket::new(TCPSocket {
                            ref_count: bun_ptr::RefCount::init(),
                            handlers: JsCell::new(Some(Rc::clone(&handlers))),
                            socket: Cell::new(uws::NewSocketHandler::<false>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            local_binding: JsCell::new(local_binding.clone()),
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
                            verify_error: JsCell::new(None),
                        })
                    };
                    let tcp_ref = tcp;
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
                            PipeSocketType::Tcp(tcp_ref),
                        ),
                        UnixOrHost::Fd(fd) => WindowsNamedPipeContext::open(
                            global,
                            *fd,
                            None,
                            None,
                            PipeSocketType::Tcp(tcp_ref),
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
                match with_ssl_ctx_cache(|cache| cache.get_or_create(ssl_cfg, &mut create_err)) {
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
        // (cleanup guard for owned_ssl_ctx already armed at the earlier lookup site;
        // duplicating it here would double-free on error.)

        default_data.ensure_still_alive();

        let allow_half_open = socket_config.allow_half_open;
        let mut ssl_taken = socket_config.ssl.take();

        let promise = jsc::JSPromise::create(global);
        let promise_value = promise.to_js();
        handlers.set_promise(global, promise_value);

        // Ownership of the SSL_CTX is about to move into the socket; disarm the guard.
        let owned_ssl_ctx = scopeguard::ScopeGuard::into_inner(ssl_ctx_guard);

        // Note: `switch (ssl_enabled) { inline else => |is_ssl_enabled| {...} }` —
        // dispatched to a const-generic helper for monomorphization.
        if ssl_enabled {
            connect_finish::<true>(
                global,
                prev_maybe_tls,
                handlers,
                connection,
                local_binding,
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
                handlers,
                connection,
                local_binding,
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
        // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let socket_ref = bun_opaque::opaque_deref_mut(socket);
        let address_bytes: &[u8] = match socket_ref.get_local_address(&mut buf) {
            Ok(b) => b,
            Err(_) => return Ok(JSValue::UNDEFINED),
        };
        let family_js = match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => return Ok(JSValue::UNDEFINED),
        };
        // Format with `SocketAddrV{4,6}` so `format_ip`'s strip logic sees the
        // expected `addr:port` / `[addr]:port` shape.
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

// Note: hoisted from the body of connect_inner; dispatched via const generic.
fn connect_finish<const IS_SSL: bool>(
    global: &JSGlobalObject,
    maybe_previous: Option<*mut NewSocket<IS_SSL>>,
    handlers: Rc<Handlers>,
    connection: UnixOrHost,
    local_binding: Option<(Box<[u8]>, u16)>,
    mut ssl: Option<&mut SSLConfig>,
    owned_ssl_ctx: Option<NonNull<boring_sys::SSL_CTX>>,
    default_data: JSValue,
    allow_half_open: bool,
    port: Option<u16>,
    promise_value: JSValue,
) -> JsResult<JSValue> {
    let vm = handlers.vm;
    let socket: bun_ptr::ThisPtr<NewSocket<IS_SSL>> = if let Some(prev_ptr) = maybe_previous {
        // SAFETY: caller passes a live NewSocket<IS_SSL>, owned by its JS wrapper.
        let prev = unsafe { bun_ptr::ThisPtr::new(prev_ptr) };
        debug_assert!(prev.this_value.get().is_not_empty());
        // `node:net` allows `socket.connect()` on an already-connected /
        // still-connecting socket. Close the previous native socket before
        // reusing this wrapper so `do_connect` does not alias two native
        // sockets onto one ext slot.
        prev.detach_for_reconnect();
        // Dropping the previous `Rc` here is safe even mid-callback: a `Scope`
        // from a `data`/`close` handler that synchronously re-entered `connect`
        // still holds its own reference.
        prev.set_handlers(global, Some(handlers));
        debug_assert!(prev.socket.get().is_detached());
        // Free old resources before reassignment to prevent memory leaks
        // when sockets are reused for reconnection (common with MongoDB driver)
        prev.connection.set(Some(connection));
        prev.local_binding.set(local_binding);
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
        prev
    } else {
        NewSocket::<IS_SSL>::new(NewSocket::<IS_SSL> {
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(Some(handlers)),
            socket: Cell::new(uws::NewSocketHandler::<IS_SSL>::DETACHED),
            connection: JsCell::new(Some(connection)),
            local_binding: JsCell::new(local_binding),
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
            verify_error: JsCell::new(None),
        })
    };
    // Either the caller's JS-owned socket (reconnect) or the fresh one above.
    let socket_ref = socket;
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
    // `set_strong`'d.)
    if socket_ref.this_value.get().is_not_empty() {
        socket_ref.this_value.with_mut(|r| r.upgrade(global));
    }
    socket_ref.reset_client_tls_flags(
        IS_SSL && crate::socket::resolve_reject_unauthorized(vm, ssl.as_deref(), false),
    );
    {
        let mut f = socket_ref.flags.get();
        f.set(SocketFlags::ALLOW_HALF_OPEN, allow_half_open);
        socket_ref.flags.set(f);
    }
    // Note: `do_connect` reads `self.connection` directly so no second
    // borrow is needed here.
    if socket_ref.do_connect().is_err() {
        let errno = if port.is_none() {
            // Preserve the real errno from the failed connect(2) on a unix path:
            // connecting to an existing non-socket file is ENOTSOCK, a
            // permission-denied path is EACCES, a missing one is ENOENT.
            let os_errno = bun_sys::last_errno();
            if os_errno == bun_sys::SystemErrno::ENAMETOOLONG as c_int {
                // libuv reports UV_EINVAL for a pipe path it cannot express.
                bun_sys::SystemErrno::EINVAL as c_int
            } else if os_errno != 0 {
                os_errno
            } else {
                bun_sys::SystemErrno::ENOENT as c_int
            }
        } else {
            // A synchronous TCP connect failure is almost always the local
            // bind() (localAddress/localPort) failing - preserve the errnos a
            // bind() meaningfully produces (EADDRINUSE: port busy,
            // EADDRNOTAVAIL: address not local, EACCES: privileged port,
            // EINVAL: address family mismatch); everything else stays
            // ECONNREFUSED. Mirrors handle_connect_error's whitelist.
            let os_errno = bun_sys::last_errno();
            if os_errno == bun_sys::SystemErrno::EADDRINUSE as c_int
                || os_errno == bun_sys::SystemErrno::EADDRNOTAVAIL as c_int
                || os_errno == bun_sys::SystemErrno::EACCES as c_int
                || os_errno == bun_sys::SystemErrno::EINVAL as c_int
            {
                os_errno
            } else {
                bun_sys::SystemErrno::ECONNREFUSED as c_int
            }
        };
        {
            let this = socket;
            let _ = NewSocket::<IS_SSL>::handle_connect_error(this, errno, 0);
            // Balance the unconditional `socket_ref.ref_()` above.
            NewSocket::deref(&this);
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
pub(crate) fn js_add_server_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = frame.arguments_old::<3>();
    if arguments.len < 3 {
        return Err(global.throw_not_enough_arguments("addServerName", 3, arguments.len));
    }
    let listener = arguments.ptr[0];
    if let Some(this) = listener.as_class_ref::<Listener>() {
        return Listener::add_server_name(this, global, arguments.ptr[1], arguments.ptr[2]);
    }
    Err(global.throw(format_args!("Expected a Listener instance")))
}

#[cfg(windows)]
fn is_valid_pipe_name(pipe_name: &[u8]) -> bool {
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

#[cfg(windows)]
fn normalize_pipe_name<'a>(pipe_name: &[u8], buffer: &'a mut [u8]) -> Option<&'a [u8]> {
    if pipe_name.len() > buffer.len() || !is_valid_pipe_name(pipe_name) {
        return None;
    }
    // normalize pipe name with can have mixed slashes
    // pipes are simple and this will be faster than using node:path.resolve()
    // we dont wanna to normalize the pipe name it self only the pipe identifier (//./pipe/, //?/pipe/, etc)
    buffer[0..9].copy_from_slice(b"\\\\.\\pipe\\");
    buffer[9..pipe_name.len()].copy_from_slice(&pipe_name[9..]);
    Some(&buffer[0..pipe_name.len()])
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

/// `Sys` keeps the structured uv error (for the node-style code/name) plus
/// the raw negative `UV_E*` return code — node's JS `errno` is the host uv
/// code (-4091 for EADDRINUSE on Windows), while `bun_sys::Error::errno`
/// holds the platform-independent `E` discriminant (98), which must never
/// reach JS. `Other` covers the non-syscall setup failures, whose payload
/// names the failure in the caller's generic invalid-arguments message.
#[cfg(windows)]
pub(crate) enum ListenPipeError {
    Sys(bun_sys::Error, core::ffi::c_int),
    Other(crate::Error),
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
            // Release the only ref, which goes 1→0 → schedule_deinit → next-tick free. The
            // deferred path is required because `get_accepted_by` may have already `uv_pipe_init`'d
            // the client's inner handle on the loop; freeing the backing storage in-callback
            // before `uv_close` completes is the exact pattern libuv forbids.
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
    /// `udp_socket.rs` / `bun_io::BufferedReader`.
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
    pub(crate) unsafe fn close_pipe_and_deinit(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live heap allocation.
        unsafe {
            (*this).listener = None;
            (*this).uv_pipe.data = this.cast::<c_void>();
            (*this).uv_pipe.close(Self::on_pipe_closed);
        }
    }

    pub(crate) fn listen(
        global_this: &JSGlobalObject,
        path: &[u8],
        backlog: i32,
        ssl_config: Option<&SSLConfig>,
        listener: *mut Listener,
    ) -> Result<*mut WindowsNamedPipeListeningContext, ListenPipeError> {
        // Heap-allocate at the final address so libuv can
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

        // Cleanup guard: once the uv pipe handle is registered with the loop it must be closed via
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
                None => return Err(ListenPipeError::Other(crate::Error::InvalidOptions)),
            }
        }

        let init_result = this_ref.uv_pipe.init(this_ref.vm.uv_loop().cast(), false);
        if init_result.is_err() {
            return Err(ListenPipeError::Other(crate::Error::FailedToInitPipe));
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
            // Surface the real error code: EADDRINUSE (name taken) vs
            // EACCES (pipe namespace denied) need different caller
            // handling, and a generic bind failure hides that.
            use bun_sys::ReturnCodeExt as _;
            return Err(match listen_rc.to_error(bun_sys::Tag::listen) {
                Some(err) => ListenPipeError::Sys(err, listen_rc.int()),
                // Unreachable in practice: the uv→errno mapping is total.
                None => ListenPipeError::Other(crate::Error::FailedToBindPipe),
            });
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

/// `openssl.c`'s `us_select_cert_cb` (the early select-certificate callback)
/// calls this FIRST for every ClientHello carrying a servername - the user
/// SNICallback takes precedence over the static SNI tree (Node semantics) -
/// so the JS callback can pick a context for the requested hostname. The
/// returned `SSL_CTX*` applies to the in-flight handshake only - the caller
/// installs it with `SSL_set_SSL_CTX`, which takes its own reference, and
/// nothing is cached in the SNI tree, so the callback runs per-connection the
/// way Node's does. A null return falls back to the static tree (bind
/// hostname + addContext entries), then the default context. An asynchronous
/// SNICallback sets `*abort_handshake = 2` instead: the handshake suspends
/// (select-certificate retry) until the JS resolution calls
/// `handle.resumeSNI(...)` -> `us_socket_sni_resolve()`.
///
/// # Safety
/// `ls` is a live listen socket whose accept-group ext holds a `*mut Listener`
/// and `hostname` is a NUL-terminated string valid for the call. JS-thread
/// only.
pub(crate) extern "C" fn us_dispatch_server_name(
    ls: *mut uws_sys::ListenSocket,
    hostname: *const core::ffi::c_char,
    abort_handshake: *mut core::ffi::c_int,
    socket: *mut c_void,
) -> *mut c_void {
    jsc::mark_binding!();
    if ls.is_null() || hostname.is_null() {
        return core::ptr::null_mut();
    }
    // The accept group's ext holds the owning `*mut Listener` for the lifetime
    // of the listen socket. S008: `ListenSocket` is an `opaque_ffi!` ZST.
    let listener_ptr: *mut Listener = bun_opaque::opaque_deref_mut(ls).group().owner::<Listener>();
    if listener_ptr.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: see above — the listen socket keeps the `Listener` alive for the
    // duration of this synchronous handshake dispatch.
    let listener = unsafe { bun_ptr::ThisPtr::new(listener_ptr) };
    let handlers = &listener.handlers;
    if handlers.vm.is_shutting_down() {
        return core::ptr::null_mut();
    }
    let callback = handlers.on_server_name();
    if callback.is_empty() {
        return core::ptr::null_mut();
    }
    // No `Handlers::enter`/`exit` scope here: that protocol tracks the
    // accepted-socket callback lifecycle, and running it against the listener's
    // own handlers from inside the handshake corrupts `active_connections` for
    // every subsequent accept. The listener and its handlers are structurally
    // alive for this synchronous dispatch - the listen socket cannot be freed
    // mid-handshake.
    let global = handlers.global_object;
    // Pass the listener's `data` (the owning net.Server) rather than minting a
    // JS wrapper for the Listener itself - `to_js` here would create a second
    // cell owning the same Rust struct and whichever is collected first frees
    // it out from under the other.
    let this_value = listener
        .strong_data
        .get()
        .get()
        .unwrap_or(JSValue::UNDEFINED);
    // SAFETY: `hostname` is NUL-terminated per the fn contract.
    let name = unsafe { core::ffi::CStr::from_ptr(hostname) };
    let js_name = ZigString::init(name.to_bytes()).to_js(&global);
    // The accepted socket processing this ClientHello: its JS wrapper is the
    // resume handle an asynchronous SNICallback uses (`handle.resumeSNI(...)`)
    // to complete the suspended handshake. The wrapper's lifecycle is
    // GC-managed, so a resume after the socket died is a safe no-op.
    let socket_handle: JSValue = if socket.is_null() {
        JSValue::UNDEFINED
    } else {
        // SAFETY: the C caller passes the live us_socket_t processing this
        // ClientHello; for BunSocketTls sockets the ext slot holds the
        // TLSSocket wrapper.
        let s_ref = uws_sys::us_socket_t::opaque_mut(socket.cast());
        if s_ref.kind() == uws_sys::SocketKind::BunSocketTls {
            match *s_ref.ext::<Option<bun_ptr::ThisPtr<TLSSocket>>>() {
                Some(tls) => tls.get_this_value(&global),
                None => JSValue::UNDEFINED,
            }
        } else {
            JSValue::UNDEFINED
        }
    };
    let result = match callback.call(&global, this_value, &[this_value, js_name, socket_handle]) {
        Ok(v) => v,
        Err(err) => global.take_exception(err),
    };
    // The JS handler returns:
    //   - undefined/null            -> fall through to the default context
    //   - a native SecureContext    -> install it on the in-flight SSL
    //   - `true`                    -> the SNICallback is asynchronous; suspend
    //     the handshake (select_cert_retry) until handle.resumeSNI(...) fires
    //   - an Error (SNICallback reported one, returned an invalid context, or
    //     threw) -> abort the handshake; the connection is dropped without an
    //     alert and the JS side emits 'tlsClientError' from the
    //     handshake-failure path with the stashed error.
    if result.is_boolean() && result.to_boolean() {
        if !abort_handshake.is_null() {
            // SAFETY: live out-parameter for the duration of this dispatch.
            unsafe { *abort_handshake = 2 };
        }
        return core::ptr::null_mut();
    }
    if result.to_error().is_some() {
        if !abort_handshake.is_null() {
            // SAFETY: the C caller passes a live out-parameter for the
            // duration of this synchronous dispatch.
            unsafe { *abort_handshake = 1 };
        }
        return core::ptr::null_mut();
    }
    if result.is_undefined_or_null() {
        return core::ptr::null_mut();
    }
    if let Some(sc) = result.as_class_ref::<SecureContext>() {
        // `SSL_set_SSL_CTX` takes its own reference to the returned SSL_CTX.
        return sc.borrow().cast();
    }
    // Anything else is not a SecureContext: Node treats this as an invalid SNI
    // context and drops the connection.
    if !abort_handshake.is_null() {
        // SAFETY: see above.
        unsafe { *abort_handshake = 1 };
    }
    core::ptr::null_mut()
}
