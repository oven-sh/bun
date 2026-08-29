//! This is the code for the object returned by Bun.listen().

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_boringssl_sys as boring_sys;
use bun_core::{EncodedSlice, String as BunString};
use bun_io::KeepAlive;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bun_string_jsc;
use bun_jsc::strong::Optional as Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, StringJsc as _,
};
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

use crate::jsc_hooks::with_ssl_ctx_cache;

// Route through the codegen'd `toJS` wrapper so we can hand the C++ side the
// already-heap-allocated `Listener` (the embedded `group` is linked into the
// loop's intrusive list at its final address before this call, so the
// `Box::new`-then-move that the `#[JsClass]` `to_js(self)` impl does would
// invalidate that link).
use crate::generated_classes::js_Listener;

/// Allocated by `listen()`; the JS wrapper holds the creation ref (released by
/// `finalize`). Every JS-exposed method takes `&self`; per-field interior
/// mutability via `Cell` (Copy) / `JsCell` (non-Copy).
#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct Listener {
    ref_count: Cell<u32>,
    pub(crate) handlers: Rc<Handlers>,
    pub(crate) listener: JsCell<ListenerType>,

    pub poll_ref: JsCell<KeepAlive>,
    pub(crate) connection: JsCell<UnixOrHost>,
    /// Embedded sweep/iteration list-head for every accepted socket on this
    /// listener. `group.ext` = `*Listener`, so the dispatch handler recovers us
    /// from the socket without a context-ext lookup. Registered as an LSAN
    /// root region for its whole life (see `Listener::init_group`); `Drop`
    /// unlinks it.
    pub(crate) group: JsCell<uws::SocketGroup>,
    /// The one `SSL_CTX` ref `listen()` built; released by `do_stop`/`finalize`.
    /// `SSL_new()` per-accept takes its own ref, so accepted sockets outlive a
    /// stopped listener safely.
    pub(crate) secure_ctx: JsCell<Option<boring_sys::OwnedSslCtx>>,
    pub(crate) ssl: bool,
    pub(crate) protos: Option<Box<[u8]>>,
    pub(crate) reject_unauthorized: bool,
    /// Accepted sockets carry `Flags::PAUSE_ON_CONNECT` (see `NewSocket::on_open`).
    pub(crate) pause_on_connect: bool,
    pub(crate) strong_data: JsCell<Strong>,
    /// Reference to this listener's JS wrapper. Strong while it is listening or
    /// has connections, downgraded to weak once idle so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
}

#[derive(Default)]
pub enum ListenerType {
    Uws(*mut uws_sys::ListenSocket),
    /// The context's address is registered with libuv (`uv_pipe.data`) for
    /// the lifetime of the handle, so it is held as an `OwnedThis` (never a
    /// `Box` move that would assert `noalias` over it); released through
    /// `WindowsNamedPipeListeningContext::close`, which frees it once libuv
    /// lets go of the pipe.
    NamedPipe(bun_ptr::OwnedThis<WindowsNamedPipeListeningContext>),
    #[default]
    None,
}

impl Listener {
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_data(this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getData()");
        this.strong_data.get().get().unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(setter)]
    pub(crate) fn set_data(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
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

impl Listener {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn reload(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [opts] = frame.arguments_as_array::<1>();

        if frame.arguments_count() < 1
            || (matches!(*this.listener.get(), ListenerType::None)
                && this.handlers.active_connections.get() == 0)
        {
            return Err(global.throw(format_args!("Expected 1 argument")));
        }

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
    pub(crate) fn listen(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
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
        let pause_on_connect = socket_config.pause_on_connect;

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

                let this = bun_ptr::RefPtr::new(Listener {
                    ref_count: Cell::new(1),
                    handlers,
                    connection: JsCell::new(connection),
                    ssl: ssl_enabled,
                    listener: JsCell::new(ListenerType::None),
                    protos: protos_taken,
                    reject_unauthorized: crate::socket::resolve_reject_unauthorized(
                        vm,
                        ssl_cfg_taken.as_ref(),
                        true,
                    ),
                    pause_on_connect,
                    poll_ref: JsCell::new(KeepAlive::init()),
                    group: JsCell::new(uws::SocketGroup::default()),
                    secure_ctx: JsCell::new(None),
                    strong_data: JsCell::new(Strong::empty()),
                    this_value: JsCell::new(JsRef::empty()),
                });
                Self::init_group(&this);
                if !default_data.is_empty() {
                    this.strong_data.set(Strong::create(default_data, global));
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
                    &this,
                ) {
                    Ok(named_pipe) => {
                        this.listener.set(ListenerType::NamedPipe(named_pipe));
                    }
                    Err(e) => {
                        // Drops connection, protos, and the handlers `Rc`.
                        drop(this);
                        // Surface coded syscall failures the way node:net
                        // does (EADDRINUSE vs EACCES need different caller
                        // handling) rather than an invalid-arguments TypeError.
                        if let ListenPipeError::Sys(sys_err, uv_errno) = &e {
                            // get_error_code_tag_name does not reject EUNKNOWN /
                            // UV_EAI_* (>=3000); neither is a node-style code, so
                            // route those through the generic error below.
                            if let Some((name, se)) = sys_err.get_error_code_tag_name() {
                                if se != bun_sys::SystemErrno::EUNKNOWN && (se as u16) < 3000 {
                                    let err = jsc::SystemError {
                                        errno: *uv_errno,
                                        code: bun_core::String::static_(name).into(),
                                        message: bun_core::String::clone_utf8(
                                            format!(
                                                "listen {}: {}",
                                                name,
                                                bstr::BStr::new(&pipe_buf[..pipe_len])
                                            )
                                            .as_bytes(),
                                        )
                                        .into(),
                                        syscall: bun_core::String::static_("listen").into(),
                                        path: bun_core::String::clone_utf8(&pipe_buf[..pipe_len])
                                            .into(),
                                        ..Default::default()
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

                return Ok(Self::into_js(this, global));
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

        let this = bun_ptr::RefPtr::new(Listener {
            ref_count: Cell::new(1),
            handlers,
            // Placeholder until `this.connection.set(connection)` below.
            connection: JsCell::new(UnixOrHost::Fd(Fd::invalid())),
            ssl: ssl_enabled,
            protos: protos_taken,
            reject_unauthorized: crate::socket::resolve_reject_unauthorized(
                vm,
                ssl_cfg_taken.as_ref(),
                true,
            ),
            pause_on_connect,
            listener: JsCell::new(ListenerType::None),
            poll_ref: JsCell::new(KeepAlive::init()),
            group: JsCell::new(uws::SocketGroup::default()),
            secure_ctx: JsCell::new(None),
            strong_data: JsCell::new(Strong::empty()),
            this_value: JsCell::new(JsRef::empty()),
        });
        Self::init_group(&this);
        // An early return below drops `this`, releasing the half-built
        // listener (its `Drop` unlinks the group).
        let this_ref: &Listener = &this;

        if let Some(ssl_cfg) = ssl_cfg_taken.as_ref() {
            let mut create_err = uws::create_bun_socket_error_t::none;
            match ssl_cfg.as_usockets().create_ssl_context(&mut create_err) {
                Some(ctx) => this_ref.secure_ctx.set(Some(ctx)),
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

        let secure_ctx_ptr: Option<*mut uws::SslCtx> =
            this_ref.secure_ctx.get().as_ref().map(|p| p.as_ptr());

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
                    if let Some(p) = bun_opaque::opaque_deref_mut(ls).get_local_port() {
                        *port = p;
                    }
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
                let fd_native = fd.native() as uws_sys::LIBUS_SOCKET_DESCRIPTOR;
                this_ref.group.with_mut(|g| {
                    g.listen_fd(
                        kind,
                        secure_ctx_ptr,
                        fd_native,
                        511,
                        socket_flags,
                        size_of::<*mut c_void>() as c_int,
                        &mut errno,
                    )
                })
            }
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
            let mapped = bun_sys::SystemErrno::init(errno as i64);
            let errno = if mapped == Some(bun_sys::SystemErrno::ENAMETOOLONG)
                || (matches!(connection, UnixOrHost::Fd(_))
                    && matches!(
                        mapped,
                        Some(bun_sys::SystemErrno::ENOTSOCK)
                            | Some(bun_sys::SystemErrno::EBADF)
                            | Some(bun_sys::SystemErrno::EOPNOTSUPP)
                    )) {
                bun_sys::SystemErrno::EINVAL as c_int
            } else {
                errno
            };
            if errno != 0 {
                err.put(
                    global,
                    b"syscall",
                    BunString::static_("listen").to_js(global)?,
                );
                err.put(global, b"errno", JSValue::js_number(errno as f64));
                err.put(
                    global,
                    b"address",
                    bun_string_jsc::create_utf8_for_js(global, hostname_bytes)?,
                );
                if let Some(p) = port {
                    err.put(global, b"port", JSValue::js_number(p as f64));
                }
                if let Some(str_) = bun_sys::SystemErrno::init(errno as i64) {
                    err.put(
                        global,
                        b"code",
                        BunString::static_(<&'static str>::from(str_)).to_js(global)?,
                    );
                }
            }
            return Err(global.throw_value(err));
        }

        this_ref.connection.set(connection);
        this_ref.listener.set(ListenerType::Uws(listen_socket));
        if !default_data.is_empty() {
            this_ref
                .strong_data
                .set(Strong::create(default_data, global));
        }

        if let Some(ssl_config) = ssl_cfg_taken.as_ref() {
            // `ssl_enabled` ⇒ `createSSLContext` succeeded above ⇒ `secure_ctx` set.
            let secure = this_ref
                .secure_ctx
                .get()
                .as_ref()
                .expect("unreachable")
                .as_ptr();
            if let Some(server_name) = ssl_config.server_name_cstr() {
                if !server_name.to_bytes().is_empty() {
                    // Registering the default cert under its own server_name is a
                    // hint for sni_cb, not load-bearing — sni_find() miss falls
                    // through to the default SSL_CTX anyway.
                    // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                    let _ = bun_opaque::opaque_deref_mut(listen_socket).add_server_name(
                        server_name,
                        secure,
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
                bun_opaque::opaque_deref_mut(listen_socket)
                    .on_server_name::<super::uws_handlers::BunServerName<true>>();
            }
        }

        Ok(Self::into_js(this, global))
    }

    /// `group.ext` = this listener, so dispatch recovers it from an accepted
    /// socket. `Listener` is mimalloc-allocated, so LSAN can't trace
    /// `loop->data.head → this.group → head_sockets → us_socket_t` once the
    /// only pointer into the group lives inside a mimalloc page; registering
    /// the embedded group as a root region restores reachability for the
    /// accepted sockets' allocations. `Drop` unregisters and unlinks it.
    fn init_group(this: &bun_ptr::RefPtr<Self>) {
        this.group
            .with_mut(|g| g.init(uws::Loop::get(), None, this.as_ptr().cast::<c_void>()));
        bun_core::asan::register_root_region(
            this.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
    }

    /// Hand the creation ref to a new JS wrapper (released by `finalize`) and
    /// register the now-live listener with its handlers, the event loop and
    /// the VM's active-handle set.
    fn into_js(this: bun_ptr::RefPtr<Self>, global: &JSGlobalObject) -> JSValue {
        let this = this.into_this_ptr();
        let this_value = js_Listener::to_js(this.as_ptr(), global);
        // The listener holds the handlers cell in a visited slot; every
        // accepted socket shares the same cell.
        js_Listener::handlers_set_cached(this_value, global, this.handlers.cell());
        this.handlers.set_listener(&this);
        this.this_value
            .with_mut(|r| r.set_strong(this_value, global));
        this.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            bun_core::handle_oom(handles.put(
                crate::jsc_hooks::ActiveHandle::Listener(NonNull::from(&*this)),
                (),
            ));
        }
        this_value
    }

    // `OWNED_PROTOS` stays unset: accepted sockets clone the listener's `protos`.
    fn accepted_socket_flags(&self) -> SocketFlags {
        let mut flags = SocketFlags::empty();
        flags.set(SocketFlags::REJECT_UNAUTHORIZED, self.reject_unauthorized);
        flags.set(SocketFlags::PAUSE_ON_CONNECT, self.pause_on_connect);
        flags
    }

    #[cfg(windows)]
    pub(crate) fn on_name_pipe_created<const SSL: bool>(
        listener: &Listener,
    ) -> bun_ptr::ThisPtr<NewSocket<SSL>> {
        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            io_ref: Cell::new(None),
            named_pipe_ref: Cell::new(None),
            handlers: JsCell::new(Some(Rc::clone(&listener.handlers))),
            socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED),
            protos: JsCell::new(listener.protos.clone()),
            // `protos` is `Option<Box<[u8]>>` so we clone the listener's slice.
            flags: Cell::new(listener.accepted_socket_flags()),
            owned_ssl_ctx: JsCell::new(None),
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
        // The named-pipe context's ref; the JS wrapper adopts the creation ref.
        let s = this_socket.this_ptr();
        NewSocket::hold_io_ref(s);
        let _ = this_socket.into_this_ptr();
        // See `on_create`: each accepted named-pipe connection holds the loop
        // on its own so `conn.unref()` is meaningful.
        s.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
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
    pub(crate) fn on_create<const SSL: bool>(
        listener: &Listener,
        socket: uws::NewSocketHandler<SSL>,
    ) -> bun_ptr::ThisPtr<NewSocket<SSL>> {
        jsc::mark_binding!();
        log!("onCreate");

        debug_assert!(SSL == listener.ssl);

        let this_socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            ref_count: bun_ptr::RefCount::init(),
            io_ref: Cell::new(None),
            named_pipe_ref: Cell::new(None),
            handlers: JsCell::new(Some(Rc::clone(&listener.handlers))),
            socket: Cell::new(socket),
            protos: JsCell::new(listener.protos.clone()),
            // `protos` is `Option<Box<[u8]>>` so each accepted socket clones
            // the listener's slice; one small allocation per accept.
            flags: Cell::new(listener.accepted_socket_flags()),
            owned_ssl_ctx: JsCell::new(None),
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
        // The ext slot's ref; the JS wrapper adopts the creation ref.
        let s = this_socket.this_ptr();
        NewSocket::hold_io_ref(s);
        let this_socket = this_socket.into_this_ptr();
        // Each accepted socket holds the event loop on its own (same as a
        // client socket after `connect_finish`), so `conn.unref()` works and
        // `server.unref()`/`server.close()` don't tear out live connections'
        // hold. on_close/mark_inactive already unref this.
        s.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        let default_data = listener.strong_data.get().get();
        if let Some(default_data) = default_data {
            let global = listener.handlers.global_object;
            NewSocket::<SSL>::data_set_cached(s.get_this_value(&global), &global, default_data);
        }
        socket.set_ext_owner(Some(NonNull::from(this_socket)));
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

    pub(crate) fn add_server_name(
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
        let host_str = hostname.to_utf8(global)?;
        let server_name_bytes = host_str.slice();
        if server_name_bytes.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("hostname pattern cannot be empty"))
            );
        }
        // NUL-terminate for the C `const char*` parameter. Interior NULs are
        // tolerated — the C SNI tree just truncates at the first one, so build
        // the `&CStr` up to the first NUL instead of asserting via
        // `ZStr::as_cstr()`.
        let server_name_z = bun_core::ZBox::from_bytes(server_name_bytes);
        let server_name =
            core::ffi::CStr::from_bytes_until_nul(server_name_z.as_zstr().as_bytes_with_nul())
                .expect("ZBox is NUL-terminated");

        let ListenerType::Uws(ls) = *this.listener.get() else {
            return Ok(JSValue::UNDEFINED);
        };

        // Both real callers (node:tls addContext, node:net) pass a native
        // SecureContext; enforcement policy stays server-level, like Node's.
        // The dict branch is defensive for the internal binding's raw form.
        let sni_ctx: boring_sys::OwnedSslCtx = if let Some(sc) = tls.as_class_ref::<SecureContext>()
        {
            sc.ctx.clone()
        } else if let Some(ssl_config) = {
            // SAFETY: per-thread VM; valid for program lifetime.
            let vm = VirtualMachine::get().as_mut();
            SSLConfig::from_js(vm, global, tls)?
        } {
            // Note: `cfg` cleanup handled by Drop on SSLConfig
            let mut create_err = uws::create_bun_socket_error_t::none;
            match with_ssl_ctx_cache(|cache| cache.get_or_create(&ssl_config, &mut create_err)) {
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

        // The C SNI tree SSL_CTX_up_ref()s; ours drops here.
        // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let ls_ref = bun_opaque::opaque_deref_mut(ls);
        ls_ref.remove_server_name(server_name);
        let ok = ls_ref.add_server_name(server_name, sni_ctx.as_ptr(), core::ptr::null_mut());
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
    pub(crate) fn dispose(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::do_stop(this, true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn stop(
        this: &Self,
        _global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [arg0] = frame.arguments_as_array::<1>();
        log!("close");

        Self::do_stop(
            this,
            if frame.arguments_count() > 0 && arg0.is_boolean() {
                arg0.to_boolean()
            } else {
                false
            },
        );

        Ok(JSValue::UNDEFINED)
    }

    /// The VM (or the finished `--isolate` file) is being torn down: stop
    /// listening and close accepted connections now, while script can still
    /// run their close handlers, instead of from the GC finalizer.
    pub(crate) fn stop_for_vm_teardown(this: &Self) {
        Self::do_stop(this, true);
    }

    fn do_stop(this: &Self, force_close: bool) {
        if matches!(*this.listener.get(), ListenerType::None) {
            return;
        }
        let listener = this.listener.replace(ListenerType::None);
        if let Some(handles) = crate::jsc_hooks::active_handles() {
            handles.swap_remove(&crate::jsc_hooks::ActiveHandle::Listener(NonNull::from(
                this,
            )));
        }

        if matches!(listener, ListenerType::Uws(_)) {
            Self::unlink_unix_socket_path(this);
        }

        // The listener's poll_ref tracks the listening socket only; accepted
        // sockets each have their own (see `on_create`). Drop it now so a
        // closed server whose connections the caller unref'd lets the process
        // exit like Node does.
        this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        if this.handlers.active_connections.get() == 0 {
            this.this_value.with_mut(|r| r.downgrade());
            this.strong_data
                .with_mut(|s| s.clear_without_deallocation());
        } else if force_close {
            this.group.with_mut(|g| g.close_all());
        }

        Self::close_listen_socket(listener);

        this.secure_ctx.set(None);
    }

    /// Close whichever transport `listen()` opened (already taken out of
    /// `self.listener` by the caller, unix path already unlinked).
    fn close_listen_socket(listener: ListenerType) {
        match listener {
            ListenerType::Uws(socket) => {
                // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(socket).close();
            }
            #[cfg(windows)]
            ListenerType::NamedPipe(named_pipe) => {
                WindowsNamedPipeListeningContext::close(named_pipe)
            }
            #[cfg(not(windows))]
            ListenerType::NamedPipe(named_pipe) => drop(named_pipe),
            ListenerType::None => {}
        }
    }

    /// Runs before the JS wrapper's ref is dropped.
    pub fn finalize(&self) {
        log!("finalize");
        let listener = self.listener.replace(ListenerType::None);
        if !matches!(listener, ListenerType::None) {
            if let Some(handles) = crate::jsc_hooks::active_handles() {
                handles.swap_remove(&crate::jsc_hooks::ActiveHandle::Listener(NonNull::from(
                    self,
                )));
            }
        }
        if matches!(listener, ListenerType::Uws(_)) {
            Self::unlink_unix_socket_path(self);
        }
        Self::close_listen_socket(listener);

        self.this_value.with_mut(|r| r.finalize());
        self.strong_data.with_mut(|s| s.deinit());
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));

        // Clear the back-pointer before force-closing: this listener is
        // already releasing its own `poll_ref`/`this_value`, so an accepted
        // socket's `on_close` must not reach back in and release them a
        // second time.
        self.handlers.clear_listener();
        if self.handlers.active_connections.get() > 0 {
            self.group.with_mut(|g| g.close_all());
        }
        // A Listener torn down without do_stop() still owns its ref;
        // do_stop() already took it when it ran.
        self.secure_ctx.set(None);
        // connection / protos / the handlers `Rc` drop with the last ref.
    }

    /// Match Node.js/libuv: unlink the unix socket file before closing the listening fd.
    /// Unlinking after close would race with another process creating a socket at the same path.
    fn unlink_unix_socket_path(this: &Self) {
        let connection = this.connection.get();
        let UnixOrHost::Unix(path) = connection else {
            return;
        };
        // Abstract sockets (Linux) start with a NUL byte and have no filesystem entry.
        if path.is_empty() || path[0] == 0 {
            return;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let _ = bun_sys::unlink(bun_paths::resolve_path::z(path, &mut buf));
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        log!("deinit");
        debug_assert!(matches!(*self.listener.get(), ListenerType::None));
        Self::close_listen_socket(self.listener.replace(ListenerType::None));
        self.handlers.clear_listener();
        bun_core::asan::unregister_root_region(
            self.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
        self.group.with_mut(|g| g.unlink());
    }
}

impl Listener {
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_unix(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let connection = this.connection.get();
        let UnixOrHost::Unix(unix) = connection else {
            return Ok(JSValue::UNDEFINED);
        };
        bun_string_jsc::create_utf8_for_js(global, unix)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_hostname(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let connection = this.connection.get();
        let UnixOrHost::Host { host, .. } = connection else {
            return Ok(JSValue::UNDEFINED);
        };
        bun_string_jsc::create_utf8_for_js(global, host)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        let connection = this.connection.get();
        let UnixOrHost::Host { port, .. } = connection else {
            return JSValue::UNDEFINED;
        };
        JSValue::js_number(*port as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        match *this.listener.get() {
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
    pub fn js_ref(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let this_value = frame.this();
        if matches!(*this.listener.get(), ListenerType::None) {
            return Ok(JSValue::UNDEFINED);
        }
        this.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        this.this_value
            .with_mut(|r| r.set_strong(this_value, global));
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn unref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        // `this_value` stays strong: the wrapper roots the handlers a future
        // accept dispatches into. `do_stop` / `mark_inactive` downgrade it
        // once the listen socket is closed.
        Ok(JSValue::UNDEFINED)
    }

    // Note: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub(crate) fn connect(global: &JSGlobalObject, opts: JSValue) -> JsResult<JSValue> {
        Self::connect_inner(global, None, None, opts)
    }

    pub(crate) fn connect_inner(
        global: &JSGlobalObject,
        prev_maybe_tcp: Option<bun_ptr::ThisPtr<TCPSocket>>,
        prev_maybe_tls: Option<bun_ptr::ThisPtr<TLSSocket>>,
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
            let local_addr_slice = local_addr_js.to_utf8(global)?;
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
        let mut owned_ssl_ctx: Option<boring_sys::OwnedSslCtx> = None;
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
                owned_ssl_ctx = Some(sc.ctx.clone());
            }
        }

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
                    let tls: bun_ptr::ThisPtr<TLSSocket> = if let Some(prev) = prev_maybe_tls {
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
                            io_ref: Cell::new(None),
                            named_pipe_ref: Cell::new(None),
                            handlers: JsCell::new(Some(Rc::clone(&handlers))),
                            socket: Cell::new(uws::NewSocketHandler::<true>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            local_binding: JsCell::new(local_binding.clone()),
                            protos: JsCell::new(ssl_taken.as_mut().and_then(|s| s.take_protos())),
                            server_name: JsCell::new(
                                ssl_taken.as_mut().and_then(|s| s.take_server_name()),
                            ),
                            owned_ssl_ctx: JsCell::new(None),
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
                        // The JS wrapper adopts the creation ref (`get_this_value` below).
                        .into_this_ptr()
                    };
                    let tls_ref = tls;
                    tls_ref.reset_client_tls_flags(crate::socket::resolve_reject_unauthorized(
                        vm,
                        ssl_taken.as_ref(),
                        false,
                    ));
                    tls_ref.update_flags(|f| {
                        f.set(
                            SocketFlags::PAUSE_ON_CONNECT,
                            socket_config.pause_on_connect,
                        )
                    });
                    TLSSocket::data_set_cached(
                        tls_ref.get_this_value(global),
                        global,
                        default_data,
                    );
                    tls_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
                    TLSSocket::hold_io_ref(tls_ref);

                    let ctx_for_pipe = owned_ssl_ctx.take();
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
                        socket: uws::InternalSocket::Pipe(named_pipe),
                    });
                } else {
                    let tcp: bun_ptr::ThisPtr<TCPSocket> = if let Some(prev) = prev_maybe_tcp {
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
                            io_ref: Cell::new(None),
                            named_pipe_ref: Cell::new(None),
                            handlers: JsCell::new(Some(Rc::clone(&handlers))),
                            socket: Cell::new(uws::NewSocketHandler::<false>::DETACHED),
                            connection: JsCell::new(Some(connection)),
                            local_binding: JsCell::new(local_binding.clone()),
                            protos: JsCell::new(None),
                            server_name: JsCell::new(None),
                            owned_ssl_ctx: JsCell::new(None),
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
                        // The JS wrapper adopts the creation ref (`get_this_value` below).
                        .into_this_ptr()
                    };
                    let tcp_ref = tcp;
                    tcp_ref.update_flags(|f| {
                        f.set(
                            SocketFlags::PAUSE_ON_CONNECT,
                            socket_config.pause_on_connect,
                        )
                    });
                    TCPSocket::hold_io_ref(tcp_ref);
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
                        socket: uws::InternalSocket::Pipe(named_pipe),
                    });
                }
                return Ok(promise_value);
            }
        }

        // A SecureContext's ctx was already cloned above; build the SSL_CTX from
        // SSLConfig only if no SecureContext was passed. doConnect hands
        // `socket.owned_ssl_ctx` to the per-VM connect group.
        if ssl_enabled && owned_ssl_ctx.is_none() {
            if let Some(ssl_cfg) = socket_config.ssl.as_ref() {
                // Per-VM weak `SSLContextCache`: identical configs (including the
                // common `tls:true` / `{servername}`-only / `{ALPNProtocols}`-only
                // cases — those fields aren't in the digest because they're
                // applied per-SSL, not per-CTX) share one `SSL_CTX*`. The
                // `requires_custom_request_ctx` gate is gone; the cache makes the
                // default-vs-custom distinction by content.
                let mut create_err = uws::create_bun_socket_error_t::none;
                owned_ssl_ctx =
                    with_ssl_ctx_cache(|cache| cache.get_or_create(ssl_cfg, &mut create_err));
                if owned_ssl_ctx.is_none() {
                    return Err(global.throw_value(
                        crate::socket::uws_jsc::create_bun_socket_error_to_js(create_err, global),
                    ));
                }
            }
        }
        default_data.ensure_still_alive();

        let allow_half_open = socket_config.allow_half_open;
        let pause_on_connect = socket_config.pause_on_connect;
        let mut ssl_taken = socket_config.ssl.take();

        let promise = jsc::JSPromise::create(global);
        let promise_value = promise.to_js();
        handlers.set_promise(global, promise_value);

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
                pause_on_connect,
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
                pause_on_connect,
                port,
                promise_value,
            )
        }
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn getsockname(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let ListenerType::Uws(socket) = *this.listener.get() else {
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
        let address_js = EncodedSlice::latin1(formatted).to_js(global);
        let port_js = match socket_ref.get_local_port() {
            Some(p) => JSValue::js_number(p as f64),
            None => JSValue::UNDEFINED,
        };

        out.put(global, b"family", family_js);
        out.put(global, b"address", address_js);
        out.put(global, b"port", port_js);
        Ok(JSValue::UNDEFINED)
    }
}

// Note: hoisted from the body of connect_inner; dispatched via const generic.
fn connect_finish<const IS_SSL: bool>(
    global: &JSGlobalObject,
    maybe_previous: Option<bun_ptr::ThisPtr<NewSocket<IS_SSL>>>,
    handlers: Rc<Handlers>,
    connection: UnixOrHost,
    local_binding: Option<(Box<[u8]>, u16)>,
    mut ssl: Option<&mut SSLConfig>,
    owned_ssl_ctx: Option<boring_sys::OwnedSslCtx>,
    default_data: JSValue,
    allow_half_open: bool,
    pause_on_connect: bool,
    port: Option<u16>,
    promise_value: JSValue,
) -> JsResult<JSValue> {
    let vm = handlers.vm;
    let socket: bun_ptr::ThisPtr<NewSocket<IS_SSL>> = if let Some(prev) = maybe_previous {
        debug_assert!(prev.this_value.get().is_not_empty());
        // `node:net` allows `socket.connect()` on an already-connected /
        // still-connecting socket. Close the previous native socket before
        // reusing this wrapper so `do_connect` does not alias two native
        // sockets onto one ext slot.
        NewSocket::detach_for_reconnect(prev);
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
        prev.owned_ssl_ctx.set(owned_ssl_ctx);
        prev
    } else {
        NewSocket::<IS_SSL>::new(NewSocket::<IS_SSL> {
            ref_count: bun_ptr::RefCount::init(),
            io_ref: Cell::new(None),
            named_pipe_ref: Cell::new(None),
            handlers: JsCell::new(Some(handlers)),
            socket: Cell::new(uws::NewSocketHandler::<IS_SSL>::DETACHED),
            connection: JsCell::new(Some(connection)),
            local_binding: JsCell::new(local_binding),
            protos: JsCell::new(ssl.as_mut().and_then(|s| s.take_protos())),
            server_name: JsCell::new(ssl.as_mut().and_then(|s| s.take_server_name())),
            owned_ssl_ctx: JsCell::new(owned_ssl_ctx),
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
        // The JS wrapper adopts the creation ref (`get_this_value` below).
        .into_this_ptr()
    };
    // Either the caller's JS-owned socket (reconnect) or the fresh one above.
    let socket_ref = socket;
    NewSocket::hold_io_ref(socket_ref);
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
    socket_ref.update_flags(|f| {
        f.set(SocketFlags::ALLOW_HALF_OPEN, allow_half_open);
        f.set(SocketFlags::PAUSE_ON_CONNECT, pause_on_connect);
    });
    // Held for the connect attempt regardless of `ref_pollref_on_connect`; `on_open` applies that.
    socket_ref
        .poll_ref
        .with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
    // Note: `do_connect` reads `self.connection` directly so no second
    // borrow is needed here.
    // An already-open fd socket runs `on_open` synchronously; what settling
    // the connect promise there left pending is not a connect failure.
    let opened_err = match NewSocket::do_connect(socket_ref) {
        Ok(()) => None,
        Err(crate::Error::Js(err)) => Some(err),
        Err(_) => {
            // Winsock sets the Win32 last-error, not the CRT `_errno()` that
            // `last_errno()` reads.
            #[cfg(windows)]
            let os_errno = {
                let mut e = bun_sys::last_error() as c_int;
                // Node reports ENOENT for a missing pipe path; Winsock's AF_UNIX
                // connect error does not, so probe.
                if port.is_none() {
                    if let Some(UnixOrHost::Unix(path)) = socket_ref.connection.get() {
                        if !bun_sys::exists(path) {
                            e = bun_sys::SystemErrno::ENOENT as c_int;
                        }
                    }
                }
                e
            };
            #[cfg(not(windows))]
            let os_errno = bun_sys::last_errno();
            let errno = if port.is_none() {
                // Preserve the real errno from the failed connect(2) on a unix path:
                // connecting to an existing non-socket file is ENOTSOCK, a
                // permission-denied path is EACCES, a missing one is ENOENT.
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
                // Releases the `io_ref` taken above.
                let handled = NewSocket::<IS_SSL>::handle_connect_error(this, errno, 0);
                // A `connectError` handler that threw on this synchronous failure
                // throws from `connect()`.
                handled?;
                return Ok(promise_value);
            }
        }
    };

    // What settling the connect promise in `on_open` left pending (allocation
    // failure, a terminating VM).
    if let Some(err) = opened_err {
        return Err(err);
    }
    Ok(promise_value)
}

#[bun_jsc::host_fn]
pub(crate) fn js_add_server_name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let [listener, hostname, tls] = frame.arguments_as_array::<3>();
    if frame.arguments_count() < 3 {
        return Err(global.throw_not_enough_arguments(
            "addServerName",
            3,
            frame.arguments_count() as usize,
        ));
    }
    if let Some(this) = listener.as_class_ref::<Listener>() {
        return Listener::add_server_name(this, global, hostname, tls);
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
    pub(crate) uv_pipe: JsCell<uv::Pipe>,
    /// The `Listener` owning this context; cleared by `close` before the
    /// listener lets go of it, so a late connection callback sees `None`.
    pub(crate) listener: Cell<Option<bun_ptr::BackRef<Listener>>>,
    pub global_this: GlobalRef,
    /// JSC_BORROW: process-lifetime singleton; `&'static` so call sites read
    /// `self.vm.is_shutting_down()` without a raw-pointer deref.
    pub(crate) vm: &'static VirtualMachine,
    pub ctx: JsCell<Option<boring_sys::OwnedSslCtx>>, // server reuses the same ctx
}

#[cfg(not(windows))]
pub struct WindowsNamedPipeListeningContext {
    _priv: (),
}

/// `c_int`: raw libuv return code so JS `err.errno` is the platform-correct UV value.
#[cfg(windows)]
enum ListenPipeError {
    Sys(bun_sys::Error, c_int),
    Other(crate::Error),
}

#[cfg(windows)]
impl uv::ConnectionHandler for WindowsNamedPipeListeningContext {
    fn on_connection(&self, status: uv::ReturnCode) {
        let Some(listener) = self.listener.get() else {
            // we are deiniting/closing
            return;
        };
        if status != uv::ReturnCode::ZERO {
            // connection dropped
            return;
        }
        let listener: &Listener = listener.get();
        use crate::socket::windows_named_pipe_context::SocketType as PipeSocketType;
        let socket: PipeSocketType = if self.ctx.get().is_some() {
            PipeSocketType::Tls(Listener::on_name_pipe_created::<true>(listener))
        } else {
            PipeSocketType::Tcp(Listener::on_name_pipe_created::<false>(listener))
        };

        let client = WindowsNamedPipeContext::create(&self.global_this, socket);

        let accepted = self.uv_pipe.with_mut(|server| {
            client
                .named_pipe
                .accept_from(server, self.ctx.get().as_ref().map(|c| c.ctx()))
        });
        if accepted.is_err() {
            // connection dropped
            // Release the only ref, which goes 1→0 → schedule_deinit → next-tick free. The
            // deferred path is required because `accept_from` may have already `uv_pipe_init`'d
            // the client's inner handle on the loop; freeing the backing storage in-callback
            // before `uv_close` completes is the exact pattern libuv forbids.
            WindowsNamedPipeContext::release_conn_ref(client);
            return;
        }
        // May run user JS (`onOpen`), which can stop the listener: our pipe is
        // no longer borrowed, and `close` keeps `self` alive until libuv has
        // released the handle.
        client.named_pipe.start_accepted();
    }
}

#[cfg(windows)]
impl uv::PipeOwner for WindowsNamedPipeListeningContext {
    fn pipe(&self) -> &JsCell<uv::Pipe> {
        &self.uv_pipe
    }
}

#[cfg(windows)]
impl WindowsNamedPipeListeningContext {
    /// Stop accepting: detach from the listener and close the pipe; `this` is
    /// freed once libuv has released the handle (right away if it was never
    /// initialised).
    pub(crate) fn close(this: bun_ptr::OwnedThis<Self>) {
        this.listener.set(None);
        uv::Pipe::close_owner(this);
    }

    fn listen(
        global_this: &JSGlobalObject,
        path: &[u8],
        backlog: i32,
        ssl_config: Option<&SSLConfig>,
        listener: &Listener,
    ) -> Result<bun_ptr::OwnedThis<WindowsNamedPipeListeningContext>, ListenPipeError> {
        // Heap-allocate at the final address so libuv can
        // store a pointer back into `uv_pipe`.
        let this = bun_ptr::OwnedThis::new(WindowsNamedPipeListeningContext {
            uv_pipe: JsCell::new(bun_core::ffi::zeroed()),
            listener: Cell::new(Some(bun_ptr::BackRef::new(listener))),
            global_this: GlobalRef::from(global_this),
            vm: global_this.bun_vm(),
            ctx: JsCell::new(None),
        });
        // On an early return `close` frees the context (via `uv_close` once
        // the pipe handle is registered with the loop, directly before that),
        // SSL context included; disarmed via `into_inner` on success.
        let this = scopeguard::guard(this, Self::close);

        if let Some(ssl_options) = ssl_config {
            boringssl::load();

            let ctx_opts = ssl_options.as_usockets();
            let mut err = uws::create_bun_socket_error_t::none;
            // Create SSL context using uSockets to match behavior of node.js
            match ctx_opts.create_ssl_context(&mut err) {
                Some(ctx) => this.ctx.set(Some(ctx)),
                None => return Err(ListenPipeError::Other(crate::Error::InvalidOptions)),
            }
        }

        let uv_loop = this.vm.uv_loop().cast();
        let init_result = this.uv_pipe.with_mut(|p| p.init(uv_loop, false));
        if init_result.is_err() {
            return Err(ListenPipeError::Other(crate::Error::FailedToInitPipe));
        }

        let owner = bun_ptr::BackRef::new(&**this);
        let listen_rc = if path[path.len() - 1] == 0 {
            // is already null terminated
            this.uv_pipe
                .with_mut(|p| p.listen_named_pipe_with(&path[..path.len() - 1], backlog, owner))
        } else {
            let mut path_buf = PathBuffer::uninit();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);
            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            this.uv_pipe
                .with_mut(|p| p.listen_named_pipe_with(&path_buf[..len], backlog, owner))
        };
        if listen_rc.is_err() {
            // Surface the real error code: EADDRINUSE (name taken) vs
            // EACCES (pipe namespace denied) need different caller
            // handling, and a generic bind failure hides that.
            use bun_sys::ReturnCodeExt as _;
            let raw = listen_rc.int();
            return Err(match listen_rc.to_error(bun_sys::Tag::listen) {
                Some(err) => ListenPipeError::Sys(err, raw),
                // Unreachable in practice: the uv→errno mapping is total.
                None => ListenPipeError::Other(crate::Error::FailedToBindPipe),
            });
        }
        //TODO: add readableAll and writableAll support if someone needs it
        // if(uv.uv_pipe_chmod(&this.uvPipe, uv.UV_WRITABLE | uv.UV_READABLE) != 0) {
        // this.closePipeAndDeinit();
        // return error.FailedChmodPipe;
        //}

        // `uv_listen` made the pipe an active+ref'd uv handle. Strip libuv's
        // loop ref so the owning `Listener`'s `poll_ref` is the only thing
        // keeping the process alive (the contract usockets' libuv backend
        // applies to its handles); otherwise `server.unref()` drops the
        // `poll_ref` but the uv handle still pins `uv_loop_alive` and the
        // process never exits.
        this.uv_pipe.with_mut(|p| p.unref());

        Ok(scopeguard::ScopeGuard::into_inner(this))
    }
}

/// Run the JS `serverName` handler (Node's `SNICallback`) for the accepted
/// TLS socket whose ClientHello asked for `hostname`.
///
/// `us_select_cert_cb` (the early select-certificate callback) reaches this
/// FIRST for every ClientHello carrying a servername - the user SNICallback
/// takes precedence over the static SNI tree (Node semantics) - so the JS
/// callback can pick a context for the requested hostname. A returned context
/// applies to the in-flight handshake only (`SSL_set_SSL_CTX` takes its own
/// reference; nothing is cached in the SNI tree), so the callback runs
/// per-connection the way Node's does. `Default` falls back to the static
/// tree (bind hostname + addContext entries), then the default context. An
/// asynchronous SNICallback answers `Suspend`: the handshake suspends
/// (select-certificate retry) until the JS resolution calls
/// `handle.resumeSNI(...)` -> `us_socket_sni_resolve()`.
///
/// `from_listener` picks the handler's `this`: the accepting listener's
/// `data` (the owning net.Server) for `Bun.listen` sockets, or - for a
/// server-side socket adopted into TLS from an fd, which has no listen socket
/// - the socket's own `data` (node:tls stores the JS TLSSocket carrying
/// `_SNICallback` there). The socket's JS wrapper is passed along either way:
/// it is the resume handle an asynchronous SNICallback uses, and its
/// lifecycle is GC-managed, so a resume after the socket died is a safe no-op.
pub(crate) fn resolve_server_name(
    tls: bun_ptr::ThisPtr<TLSSocket>,
    hostname: &core::ffi::CStr,
    from_listener: bool,
) -> uws_sys::SniDecision {
    jsc::mark_binding!();
    // An idle socket can drop its Handlers while the us_socket_t lives on;
    // `get_handlers()` would panic. Same guard as `select_alpn_callback`.
    if !tls.has_handlers() {
        return uws_sys::SniDecision::Default;
    }
    let handlers = tls.get_handlers();
    let callback = handlers.on_server_name();
    if callback.is_empty() {
        return uws_sys::SniDecision::Default;
    }
    // No `Handlers::enter`/`exit` scope here: that protocol tracks the
    // accepted-socket callback lifecycle, and running it from inside the
    // handshake corrupts `active_connections` for every subsequent accept.
    // The socket, its handlers and the listener are structurally alive for
    // this synchronous dispatch.
    let global = handlers.global_object;
    let socket_handle = tls.get_this_value(&global);
    let this_value = if from_listener {
        let Some(listener) = handlers.listener() else {
            return uws_sys::SniDecision::Default;
        };
        // Pass the listener's `data` rather than minting a JS wrapper for
        // the Listener itself - `to_js` here would create a second cell
        // owning the same struct.
        listener
            .strong_data
            .get()
            .get()
            .unwrap_or(JSValue::UNDEFINED)
    } else {
        TLSSocket::data_get_cached(socket_handle).unwrap_or(JSValue::UNDEFINED)
    };
    // Peer-supplied SNI bytes, decoded as Latin-1 like Node's `OneByteString`.
    let js_name = EncodedSlice::latin1(hostname.to_bytes()).to_js(&global);
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
        return uws_sys::SniDecision::Suspend;
    }
    if result.to_error().is_some() {
        return uws_sys::SniDecision::Abort;
    }
    if result.is_undefined_or_null() {
        return uws_sys::SniDecision::Default;
    }
    if let Some(sc) = result.as_class_ref::<SecureContext>() {
        return uws_sys::SniDecision::Context(sc.ctx.clone());
    }
    // Anything else is not a SecureContext: Node treats this as an invalid SNI
    // context and drops the connection.
    uws_sys::SniDecision::Abort
}
