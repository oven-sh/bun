//! This is the code for the object returned by Bun.listen().

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::mem::size_of;
use std::rc::Rc;

use bun_boringssl_sys as boring_sys;
use bun_core::{EncodedSlice, String as BunString};
use bun_io::KeepAlive;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::strong::Optional as Strong;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, StringJsc as _};
use bun_sys::{self, Fd};
use bun_uws as uws;
use bun_uws_sys as uws_sys;

use crate::api::SSLContextCache::SSLContextCache;
use crate::api::bun_secure_context::SecureContext;
use crate::generated_bindgen::listener::{TLSListener, js_Listener as js};
use crate::socket::SSLConfig;
use crate::socket::{
    Handlers, NewSocket, SocketConfig, SocketFlags, SocketMode, TCPSocket, TLSSocket,
};

#[cfg(windows)]
use crate::socket::WindowsNamedPipe;

#[cfg(windows)]
use core::ptr::NonNull;

#[cfg(windows)]
use bun_core::strings;
#[cfg(windows)]
use bun_jsc::GlobalRef;
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_node_path as node_path;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

bun_output::define_scoped_log!(log, Listener, visible);

/// `HotMapEntry::tag` of a `Listener`. `crate::server::AnyServerTag` owns 0..=3.
const HOT_MAP_TAG_LISTENER: u8 = 4;

pub(crate) struct Listener {
    pub(crate) handlers: Rc<Handlers>,
    pub(crate) listener: Cell<ListenerType>,

    pub poll_ref: JsCell<KeepAlive>,
    pub(crate) connection: UnixOrHost,
    /// Embedded sweep/iteration list-head for every accepted socket on this
    /// listener. `group.ext` = `*Listener`, so the dispatch handler recovers us
    /// from the socket without a context-ext lookup.
    pub(crate) group: JsCell<uws::SocketGroup>,
    /// `SSL_CTX` for accepted sockets; dropped on close. `SSL_new()`
    /// per-accept takes its own ref, so accepted sockets outlive a stopped
    /// listener safely.
    pub(crate) secure_ctx: JsCell<Option<boring_sys::OwnedSslCtx>>,
    pub(crate) ssl: bool,
    pub(crate) protos: Option<Box<[u8]>>,
    pub(crate) reject_unauthorized: bool,
    /// Accepted sockets carry `Flags::PAUSE_ON_CONNECT` (see `NewSocket::on_open`).
    pub(crate) pause_on_connect: bool,
    default_timeout: bool,
    /// Unless set, accepted sockets carry `Flags::ENDS_ON_PEER_FIN`.
    pub(crate) allow_half_open: bool,
    /// The `SocketConfig::socket_flags()` this listener was opened with.
    pub(crate) socket_flags: i32,
    pub(crate) strong_data: JsCell<Strong>,
    /// Reference to this listener's JS wrapper. Strong while it is listening or
    /// has connections, downgraded to weak once idle so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
    /// Armed while listening: the listener stops with the context that opened it.
    pub(crate) abort_handle: bun_jsc::AbortHandle,
    /// That context: where an accepted socket that leaves the listener's group (a TLS upgrade) goes.
    pub(crate) context: bun_jsc::ContextId,
    /// This listener's key in `VirtualMachine::hot_map()` while it's registered there.
    pub(crate) hot_key: JsCell<Option<Box<[u8]>>>,
    /// The `hot_reload_counter` of the last run that listened on this address.
    pub(crate) hot_run: Cell<u32>,
}

bun_jsc::impl_abort_handle_owner!(Listener, abort_handle, |this, _cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not finalized).
    Listener::do_stop(unsafe { &*this }, true)
});

#[derive(Clone, Copy, Default)]
pub(crate) enum ListenerType {
    Uws(*mut uws_sys::ListenSocket),
    /// Raw heap pointer (not `Box`) to a `WindowsNamedPipeListeningContext`.
    /// The context's address is registered with libuv (`uv_pipe.data`) for the
    /// lifetime of the handle, so we must never assert `noalias` over it via a
    /// Box move or `&mut Listener` that transitively covers the context — that
    /// would invalidate the pointer libuv holds under Stacked Borrows. Ownership
    /// is still unique; freed via `close_pipe_and_deinit` → `on_pipe_closed` → `deinit`.
    #[cfg(windows)]
    NamedPipe(NonNull<WindowsNamedPipeListeningContext>),
    #[default]
    None,
}

impl Listener {
    pub(crate) fn get_data<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        log!("getData()");
        match self.strong_data.get().get() {
            Some(data) => JsLocal::new(heap, data),
            None => JsLocal::UNDEFINED,
        }
    }

    pub(crate) fn set_data(&self, cx: &mut JsScope<'_>, value: JsLocal<'_>) {
        log!("setData()");
        self.strong_data
            .with_mut(|s| s.set(cx.global(), value.to_js()));
    }
}

/// The `SSL_CTX` of the native `SecureContext` in `tls.secureContext`, which alone asks for TLS.
fn prebuilt_ssl_ctx(
    vm: &VirtualMachine,
    global: &JSGlobalObject,
    opts: JSValue,
    config: &mut SocketConfig,
    is_server: bool,
) -> JsResult<Option<boring_sys::OwnedSslCtx>> {
    let Some(tls_js) = opts.get_truthy(global, "tls")? else {
        return Ok(None);
    };
    let Some(ctx) = SecureContext::ctx_from_options(global, tls_js)? else {
        return Ok(None);
    };
    // The context is served as it is: its trust store would not be the `ca` written next to `requestCert`.
    if is_server
        && config.ssl.as_ref().is_some_and(|ssl| ssl.request_cert != 0)
        && !crate::socket::server_ctx_requests_cert(Some(ctx.as_ptr()))
    {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "TLSOptions.requestCert needs a secureContext that was created with requestCert"
                ),
            )
            .throw());
    }
    if config.ssl.is_none() {
        config.ssl = Some(vm.tls_config(Default::default(), is_server));
    }
    Ok(Some(ctx))
}

#[derive(Clone)]
pub(crate) enum UnixOrHost {
    Unix(Box<[u8]>),
    Host { host: Box<[u8]>, port: u16 },
    Fd(Fd),
}

impl Listener {
    fn new(
        vm: &VirtualMachine,
        context: bun_jsc::ContextId,
        config: &mut SocketConfig,
        connection: UnixOrHost,
        secure_ctx: Option<boring_sys::OwnedSslCtx>,
    ) -> Listener {
        Listener {
            handlers: Rc::clone(&config.handlers),
            listener: Cell::new(ListenerType::None),
            poll_ref: JsCell::new(KeepAlive::init()),
            connection,
            group: JsCell::new(uws::SocketGroup::default()),
            secure_ctx: JsCell::new(secure_ctx),
            ssl: config.ssl.is_some(),
            protos: config.ssl.as_mut().and_then(|s| s.take_protos()),
            reject_unauthorized: crate::socket::resolve_reject_unauthorized(
                vm,
                config.ssl.as_ref(),
                true,
            ),
            pause_on_connect: config.pause_on_connect,
            default_timeout: config.default_timeout,
            allow_half_open: config.allow_half_open,
            socket_flags: config.socket_flags(),
            strong_data: JsCell::new(Strong::empty()),
            this_value: JsCell::new(JsRef::empty()),
            abort_handle: bun_jsc::AbortHandle::for_owner::<Listener>(),
            context,
            hot_key: JsCell::new(None),
            hot_run: Cell::new(0),
        }
    }

    pub(crate) fn reload(&self, cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let opts = options.to_js();

        if matches!(self.listener.get(), ListenerType::None)
            && self.handlers.active_connections.get() == 0
        {
            return Err(global.throw(format_args!("Listener is closed")));
        }

        if !opts.is_object() {
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
        self.handlers.apply_reload(global, &reloaded);

        Ok(())
    }

    // Note: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub(crate) fn listen(cx: &bun_jsc::JsThread<'_>, opts: JSValue) -> JsResult<JSValue> {
        log!("listen");
        if !opts.is_object() {
            return Err(cx
                .global()
                .throw_invalid_arguments(format_args!("Expected object")));
        }

        // SAFETY: VirtualMachine::get() returns the per-thread VM; valid for program lifetime.
        let vm = VirtualMachine::get().as_mut();

        let mut socket_config = SocketConfig::from_js(vm, opts, cx.global(), SocketMode::Server)?;
        // Teardown handled by Drop on SocketConfig; `handlers` is an `Rc` the
        // `Listener` clones out of it.
        //
        // The handlers cell has no JS wrapper holding it yet — root it until
        // `js::handlers_set_cached` below.
        let _cell_root = socket_config.handlers.root_cell(cx.global());

        let port = socket_config.port;
        if port.is_some() {
            let hostname = socket_config.hostname_or_unix.slice();
            if !bun_dns::is_valid_hostname(hostname) {
                return Err(cx.global().throw_value(
                    crate::dns_jsc::cares_jsc::not_a_hostname_error(cx.global(), hostname),
                ));
            }
        }
        let prebuilt_ctx = prebuilt_ssl_ctx(vm, cx.global(), opts, &mut socket_config, true)?;
        let ssl_enabled = socket_config.ssl.is_some();
        let socket_flags = socket_config.socket_flags();
        let allow_half_open = socket_config.allow_half_open;

        // `--hot` runs the module again while the previous run's listener still holds the address.
        let hot_key = hot_reload_key(&socket_config);
        let hot_run = VirtualMachine::get().hot_reload_counter;
        let stale = hot_key
            .as_deref()
            .and_then(|key| VirtualMachine::get().as_mut().hot_map()?.get_entry(key))
            .filter(|entry| entry.tag == HOT_MAP_TAG_LISTENER)
            // SAFETY: `do_stop` and `Drop` remove the entry, so a registered listener is live.
            .map(|entry| unsafe { &*entry.ptr.cast::<Listener>() })
            // This run's own listener isn't stale. Binding again fails with EADDRINUSE, which port probes rely on.
            .filter(|previous| previous.hot_run.get() != hot_run);
        if let Some(previous) = stale {
            // With the same options it keeps listening, so no connection is refused. TLS options can't be compared.
            let unchanged = !ssl_enabled
                && !previous.ssl
                && previous.socket_flags == socket_flags
                && previous.allow_half_open == allow_half_open
                && previous.default_timeout == socket_config.default_timeout
                && previous.context == cx.context().id();
            if let Some(this_value) = previous.this_value.get().try_get().filter(|_| unchanged) {
                previous
                    .handlers
                    .copy_callbacks_from(cx.global(), &socket_config.handlers);
                let default_data = socket_config.default_data;
                previous.strong_data.with_mut(|data| {
                    if default_data.is_empty() {
                        data.deinit();
                    } else {
                        data.set(cx.global(), default_data);
                    }
                });
                previous.hot_run.set(hot_run);
                return Ok(this_value);
            }
        }
        // Frees the address. The stale listener's connections stay open and run the new handlers.
        let stop_stale = |handlers: &Handlers| {
            if let Some(previous) = stale {
                previous.handlers.copy_callbacks_from(cx.global(), handlers);
                Listener::do_stop(previous, false);
            }
        };

        let secure_ctx = match (prebuilt_ctx, socket_config.ssl.as_ref()) {
            (None, Some(ssl_cfg)) => {
                let mut create_err = uws::create_bun_socket_error_t::none;
                let ctx =
                    SSLContextCache::with(|cache| cache.get_or_create(ssl_cfg, &mut create_err));
                if ctx.is_none() {
                    return Err(cx.global().throw_value(
                        crate::socket::uws_jsc::create_bun_socket_error_to_js(
                            create_err,
                            cx.global(),
                        ),
                    ));
                }
                ctx
            }
            (prebuilt_ctx, _) => prebuilt_ctx,
        };

        #[cfg(windows)]
        if port.is_none() {
            // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
            let mut buf = bun_paths::path_buffer_pool::get();
            if let Some(pipe_name) =
                normalize_pipe_name(socket_config.hostname_or_unix.slice(), buf.as_mut_slice())
            {
                // Note: reshaped — `pipe_name` borrows `buf`; copy to an owned
                // buffer so the borrow ends before we `mem::take` from
                // `socket_config` below.
                let mut pipe_buf = bun_paths::path_buffer_pool::get();
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

                let default_data = socket_config.default_data;
                let context = cx.context().id();
                let this_value =
                    Listener::new(vm, context, &mut socket_config, connection, secure_ctx)
                        .into_js_wrapper(cx.global());
                let js_value = this_value.to_js();
                let this: *mut Listener = this_value.payload_ptr().as_ptr();
                // SAFETY: the payload of `this_value`; every field touched below
                // is `Cell`/`JsCell` or `&self`, so a shared borrow suffices.
                let this_ref = unsafe { &*this };
                stop_stale(&this_ref.handlers);
                // TODO: server_name is not supported on named pipes, I belive its , lets wait for
                // someone to ask for it

                // we need to add support for the backlog parameter on listen here we use the
                // default value of nodejs
                match WindowsNamedPipeListeningContext::listen(
                    cx.global(),
                    &pipe_buf[..pipe_len],
                    511,
                    this,
                ) {
                    Ok(named_pipe) => {
                        this_ref.listener.set(ListenerType::NamedPipe(
                            NonNull::new(named_pipe)
                                .expect("listen returns a non-null heap pointer"),
                        ));
                    }
                    Err(e) => {
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
                                    return Err(cx
                                        .global()
                                        .throw_value(err.to_error_instance(cx.global())));
                                }
                            }
                        }
                        let detail = match &e {
                            ListenPipeError::Other(err) => err.name(),
                            // Sys whose errno has no node-style code (EUNKNOWN / UV_EAI_*).
                            ListenPipeError::Sys(..) => "UNKNOWN",
                        };
                        return Err(cx.global().throw_invalid_arguments(format_args!(
                            "Failed to listen at {}: {}",
                            bstr::BStr::new(&pipe_buf[..pipe_len]),
                            detail
                        )));
                    }
                }

                if !default_data.is_empty() {
                    this_ref
                        .strong_data
                        .set(Strong::create(default_data, cx.global()));
                }
                // The listener holds the handlers cell in a visited slot; every
                // accepted socket shares the same cell.
                js::handlers_set_cached(js_value, cx.global(), this_ref.handlers.cell());
                this_ref
                    .handlers
                    .set_listener(Some(this_value.payload_ptr()));
                this_ref
                    .this_value
                    .with_mut(|r| r.set_strong(js_value, cx.global()));
                this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
                // SAFETY: its address does not change; leaves its context in `Drop`.
                unsafe { bun_jsc::AbortHandle::arm_owner(this, cx.context()) };
                this_ref.register_for_hot_reload(hot_key);
                return Ok(js_value);
            }
        }

        vm.event_loop_ref().ensure_waker();

        // Make the object up front so the embedded `group` has its final
        // address before we hand it to listen() (it's linked into the loop's
        // intrusive list).
        let default_data = socket_config.default_data;
        let hostname_owned: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
            .into_vec()
            .into_boxed_slice();
        let fd_opt = socket_config.fd;
        // `connection` is a placeholder until the bind below has the port.
        let placeholder = UnixOrHost::Fd(Fd::invalid());
        let context = cx.context().id();
        let this_value = Listener::new(vm, context, &mut socket_config, placeholder, secure_ctx)
            .into_js_wrapper(cx.global());
        let js_value = this_value.to_js();
        let this: *mut Listener = this_value.payload_ptr().as_ptr();
        // SAFETY: the payload of `this_value`; every field touched through this
        // borrow is `Cell`/`JsCell` or `&self`. The one plain-field write
        // (`connection`, below) goes through the root pointer instead.
        let this_ref = unsafe { &*this };
        this_ref
            .group
            .with_mut(|g| g.init(uws::Loop::get(), None, this.cast::<c_void>()));
        // `Listener` is stored inside its wrapper, so LSAN can't trace `loop->data.head →
        // this.group → head_sockets → us_socket_t` once the only pointer into the
        // group lives inside the JS heap. Registering the embedded group as a
        // root region restores reachability for the accepted sockets' allocations.
        // Paired unregister in `Drop`.
        bun_core::asan::register_root_region(
            this_ref.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );

        // Only the bind can fail from here, so a run with a broken certificate leaves the stale listener serving.
        stop_stale(&this_ref.handlers);
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
            let err = cx.global().create_error_instance(format_args!(
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
                    cx.global(),
                    b"syscall",
                    BunString::static_("listen").to_js(cx.global())?,
                );
                err.put(cx.global(), b"errno", JSValue::js_number(errno as f64));
                err.put(
                    cx.global(),
                    b"address",
                    bun_string_jsc::create_utf8_for_js(cx.global(), hostname_bytes)?,
                );
                if let Some(p) = port {
                    err.put(cx.global(), b"port", JSValue::js_number(p as f64));
                }
                if let Some(str_) = bun_sys::SystemErrno::init(errno as i64) {
                    err.put(
                        cx.global(),
                        b"code",
                        BunString::static_(<&'static str>::from(str_)).to_js(cx.global())?,
                    );
                }
            }
            return Err(cx.global().throw_value(err));
        }

        // SAFETY: nothing else has the wrapper yet; scoped write through the
        // root pointer so no `&mut Listener` is materialized (`this_ref` never
        // reads `connection`).
        unsafe { (*this).connection = connection };
        this_ref.listener.set(ListenerType::Uws(listen_socket));
        if !default_data.is_empty() {
            this_ref
                .strong_data
                .set(Strong::create(default_data, cx.global()));
        }

        // The listener holds the handlers cell in a visited slot; every
        // accepted socket shares the same cell.
        js::handlers_set_cached(js_value, cx.global(), this_ref.handlers.cell());
        this_ref
            .handlers
            .set_listener(Some(this_value.payload_ptr()));
        this_ref
            .this_value
            .with_mut(|r| r.set_strong(js_value, cx.global()));
        this_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        // SAFETY: its address does not change; leaves its context in `Drop`.
        unsafe { bun_jsc::AbortHandle::arm_owner(this, cx.context()) };
        this_ref.register_for_hot_reload(hot_key);

        Ok(js_value)
    }

    /// Lets the next `--hot` run that listens on this address find this listener.
    fn register_for_hot_reload(&self, key: Option<Box<[u8]>>) {
        let Some(key) = key else { return };
        let Some(hot) = VirtualMachine::get().as_mut().hot_map() else {
            return;
        };
        if hot.get_entry(&key).is_some() {
            return;
        }
        hot.insert_raw(
            &key,
            bun_jsc::rare_data::HotMapEntry {
                tag: HOT_MAP_TAG_LISTENER,
                ptr: std::ptr::from_ref(self).cast_mut().cast::<()>(),
            },
        );
        self.hot_key.set(Some(key));
        self.hot_run.set(VirtualMachine::get().hot_reload_counter);
    }

    fn unregister_for_hot_reload(&self) {
        let Some(key) = self.hot_key.with_mut(Option::take) else {
            return;
        };
        if let Some(hot) = VirtualMachine::get().as_mut().hot_map() {
            hot.remove(&key);
        }
    }

    fn accepted_socket_flags(&self) -> SocketFlags {
        let mut flags = SocketFlags::empty();
        // Also what the context in use was built with: `tls.secureContext` need not come with the options again.
        let ctx = self.secure_ctx.get().as_ref().map(|ctx| ctx.as_ptr());
        flags.set(
            SocketFlags::REJECT_UNAUTHORIZED,
            self.reject_unauthorized || crate::socket::server_ctx_rejects_unauthorized(ctx),
        );
        flags.set(SocketFlags::PAUSE_ON_CONNECT, self.pause_on_connect);
        flags.set(SocketFlags::ENDS_ON_PEER_FIN, !self.allow_half_open);
        flags
    }

    #[cfg(windows)]
    pub(crate) fn on_name_pipe_created<const SSL: bool>(
        listener: &Listener,
    ) -> bun_ptr::ThisPtr<NewSocket<SSL>> {
        // The pipe attaches later, and `on_create` only touches a socket that is connected.
        Self::on_create::<SSL>(listener, uws::NewSocketHandler::<SSL>::DETACHED)
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

        let this_socket = NewSocket::<SSL>::new(Some(Rc::clone(&listener.handlers)));
        this_socket.socket.set(socket);
        this_socket.protos.set(listener.protos.clone());
        this_socket.flags.set(listener.accepted_socket_flags());
        let s = this_socket;
        s.ref_();
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
        // Whether or not there is a `timeout` handler yet: `reload()` and `--hot` can bring one.
        if listener.default_timeout {
            this_socket.timeout_seconds.set(120);
            socket.set_timeout(120);
        }
        this_socket
    }

    pub(crate) fn dispose(&self, _: &mut JsScope<'_>) {
        self.do_stop(true);
    }

    pub(crate) fn stop(&self, _: &mut JsScope<'_>, close_active_connections: JsLocal<'_>) {
        log!("close");
        self.do_stop(close_active_connections.to_js() == JSValue::TRUE);
    }

    fn do_stop(&self, force_close: bool) {
        self.unregister_for_hot_reload();
        let connections = self.handlers.active_connections.get();
        // Accepted sockets have no handle of their own: this one is how their context's stop
        // reaches them, so it stays until they are gone (`Handlers::mark_inactive`).
        if force_close || connections == 0 {
            self.abort_handle.leave();
        }
        if matches!(self.listener.get(), ListenerType::None) {
            // Stopped gracefully earlier; what is still connected goes now.
            if force_close && connections != 0 {
                self.group.with_mut(|g| g.close_all());
            }
            return;
        }
        let listener = self.listener.replace(ListenerType::None);

        if matches!(listener, ListenerType::Uws(_)) {
            self.unlink_unix_socket_path();
        }

        // The listener's poll_ref tracks the listening socket only; accepted
        // sockets each have their own (see `on_create`). Drop it now so a
        // closed server whose connections the caller unref'd lets the process
        // exit like Node does.
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        if connections == 0 {
            self.this_value.with_mut(|r| r.downgrade());
            self.strong_data
                .with_mut(|s| s.clear_without_deallocation());
        } else if force_close {
            self.group.with_mut(|g| g.close_all());
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
            ListenerType::None => {}
        }

        self.secure_ctx.set(None);
    }

    /// Match Node.js/libuv: unlink the unix socket file before closing the listening fd.
    /// Unlinking after close would race with another process creating a socket at the same path.
    fn unlink_unix_socket_path(&self) {
        let UnixOrHost::Unix(path) = &self.connection else {
            return;
        };
        // Abstract sockets (Linux) start with a NUL byte and have no filesystem entry.
        if path.is_empty() || path[0] == 0 {
            return;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        let _ = bun_sys::unlink(bun_paths::resolve_path::z(path, &mut buf));
    }

    pub(crate) fn get_unix(&self) -> Option<&[u8]> {
        match &self.connection {
            UnixOrHost::Unix(unix) => Some(unix),
            _ => None,
        }
    }

    pub(crate) fn get_hostname(&self) -> Option<&[u8]> {
        match &self.connection {
            UnixOrHost::Host { host, .. } => Some(host),
            _ => None,
        }
    }

    pub(crate) fn get_port(&self) -> Option<u16> {
        match &self.connection {
            UnixOrHost::Host { port, .. } => Some(*port),
            _ => None,
        }
    }

    pub(crate) fn get_fd<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        let fd = match self.listener.get() {
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
        };
        JsLocal::new(heap, fd)
    }

    pub(crate) fn r#ref<'a>(&self, this_value: JsWrapper<'a, Self>, cx: &mut JsScope<'a>) {
        if matches!(self.listener.get(), ListenerType::None) {
            return;
        }
        self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        self.this_value
            .with_mut(|r| r.set_strong(this_value.to_js(), cx.global()));
    }

    pub(crate) fn unref(&self) {
        // `this_value` stays strong: the wrapper roots the handlers a future
        // accept dispatches into. `do_stop` / `mark_inactive` downgrade it
        // once the listen socket is closed.
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
    }

    // Note: no #[bun_jsc::host_fn] — BunObject.rs::static_adapters owns the
    // C-ABI shim (it extracts `opts` from the CallFrame and calls this directly).
    pub(crate) fn connect(cx: &bun_jsc::JsThread<'_>, opts: JSValue) -> JsResult<JSValue> {
        Self::connect_inner(cx, None, None, opts)
    }

    /// `Bun.connect`, and node:net's dial (which hands in the socket it already made).
    pub(crate) fn connect_inner(
        cx: &bun_jsc::JsThread<'_>,
        prev_maybe_tcp: Option<*mut TCPSocket>,
        prev_maybe_tls: Option<*mut TLSSocket>,
        opts: JSValue,
    ) -> JsResult<JSValue> {
        // What script of a disposed `Bun.ModuleGraph` opens is closed at once and reports nothing.
        // Dialing would report: a port that refuses (a listener the same script just made is one,
        // closed at birth) fails inside the call, and a loop that redials on failure would never
        // yield, where it did while the graph was live and the port accepted.
        if cx.context().is_stopped() {
            return Ok(jsc::JSPromise::create(cx.global()).to_js());
        }
        if !opts.is_object() {
            return Err(cx
                .global()
                .throw_invalid_arguments(format_args!("Expected options object")));
        }
        let vm = VirtualMachine::get().as_mut();

        // Client mode: these handlers have no owning listener, so
        // `mark_inactive` skips the listener-release branch.
        let mut socket_config = SocketConfig::from_js(vm, opts, cx.global(), SocketMode::Client)?;
        // No JS wrapper holds the handlers cell until `connect_finish` creates
        // the socket's; the option getters below run user JS that can GC.
        let handlers = Rc::clone(&socket_config.handlers);
        let _cell_root = handlers.root_cell(cx.global());

        let port = socket_config.port;
        let mut owned_ssl_ctx = prebuilt_ssl_ctx(vm, cx.global(), opts, &mut socket_config, false)?;
        // Without a SecureContext, the context is built from the config, for a socket and for a named pipe alike.
        if owned_ssl_ctx.is_none()
            && let Some(ssl_cfg) = socket_config.ssl.as_ref()
        {
            // Identical configs share one `SSL_CTX*`. servername and ALPNProtocols are applied per SSL, so they aren't compared.
            let mut create_err = uws::create_bun_socket_error_t::none;
            owned_ssl_ctx =
                SSLContextCache::with(|cache| cache.get_or_create(ssl_cfg, &mut create_err));
            if owned_ssl_ctx.is_none() {
                return Err(cx.global().throw_value(
                    crate::socket::uws_jsc::create_bun_socket_error_to_js(create_err, cx.global()),
                ));
            }
        }
        let ssl_enabled = socket_config.ssl.is_some();
        let default_data = socket_config.default_data;

        vm.event_loop_ref().ensure_waker();

        let connection: UnixOrHost = if let Some(fd) = socket_config.fd {
            UnixOrHost::Fd(fd)
        } else {
            let host: Box<[u8]> = core::mem::take(&mut socket_config.hostname_or_unix)
                .into_vec()
                .into_boxed_slice();
            match port {
                Some(port) => UnixOrHost::Host { host, port },
                None => UnixOrHost::Unix(host),
            }
        };
        let local_binding = socket_config.local_binding.take();

        default_data.ensure_still_alive();

        let allow_half_open = socket_config.allow_half_open;
        let pause_on_connect = socket_config.pause_on_connect;
        let fd_is_write_only = socket_config.fd_is_write_only;
        let mut ssl_taken = socket_config.ssl.take();

        let promise = jsc::JSPromise::create(cx.global());
        let promise_value = promise.to_js();
        handlers.set_promise(cx.global(), promise_value);

        // Note: `switch (ssl_enabled) { inline else => |is_ssl_enabled| {...} }` —
        // dispatched to a const-generic helper for monomorphization.
        if ssl_enabled {
            connect_finish::<true>(
                cx,
                prev_maybe_tls,
                handlers,
                connection,
                local_binding,
                ssl_taken.as_mut(),
                owned_ssl_ctx,
                default_data,
                allow_half_open,
                pause_on_connect,
                fd_is_write_only,
                port,
                promise_value,
            )
        } else {
            connect_finish::<false>(
                cx,
                prev_maybe_tcp,
                handlers,
                connection,
                local_binding,
                ssl_taken.as_mut(),
                owned_ssl_ctx,
                default_data,
                allow_half_open,
                pause_on_connect,
                fd_is_write_only,
                port,
                promise_value,
            )
        }
    }

    pub(crate) fn getsockname(&self, cx: &mut JsScope<'_>, out: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let ListenerType::Uws(socket) = self.listener.get() else {
            return Ok(());
        };

        let out = out.to_js();
        if !out.is_object() {
            return Err(global.throw_invalid_arguments(format_args!("Expected object")));
        }

        let mut buf = [0u8; 64];
        // S008: `ListenSocket` is an `opaque_ffi!` ZST — safe deref.
        let socket_ref = bun_opaque::opaque_deref_mut(socket);
        let address_bytes = socket_ref.get_local_address(&mut buf).ok();
        let is_ipv6 = address_bytes.is_some_and(|bytes| bytes.len() == 16);
        let address_js = super::socket_body::ip_address_to_js(global, address_bytes)?;
        if address_js.is_undefined() {
            return Ok(());
        }
        let port_js = match socket_ref.get_local_port() {
            Some(p) => JSValue::js_number(p as f64),
            None => JSValue::UNDEFINED,
        };

        bun_jsc::cpp::JSSocketAddressDTO__assign(global, out, address_js, port_js, is_ipv6)?;
        Ok(())
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        // Closing the sockets reaches this struct again through their handlers, so no `&mut` spans it.
        let this = &*self;
        log!("finalize");
        this.unregister_for_hot_reload();
        this.abort_handle.leave();
        match this.listener.replace(ListenerType::None) {
            ListenerType::Uws(socket) => {
                this.unlink_unix_socket_path();
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
            ListenerType::None => {}
        }
        this.this_value.with_mut(|r| r.finalize());
        this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));

        // Before force-closing: an accepted socket's `on_close` must not release this listener's refs a second time.
        this.handlers.set_listener(None);
        if this.handlers.active_connections.get() > 0 {
            this.group.with_mut(|g| g.close_all());
        }
        bun_core::asan::unregister_root_region(
            this.group.as_ptr().cast::<c_void>(),
            size_of::<uws::SocketGroup>(),
        );
        // SAFETY: zeroed or init'd in listen(); not concurrently walked.
        unsafe { uws::SocketGroup::destroy(this.group.as_ptr()) };
    }
}

// Note: hoisted from the body of connect_inner; dispatched via const generic.
fn connect_finish<const IS_SSL: bool>(
    cx: &bun_jsc::JsThread<'_>,
    maybe_previous: Option<*mut NewSocket<IS_SSL>>,
    handlers: Rc<Handlers>,
    connection: UnixOrHost,
    local_binding: Option<(Box<[u8]>, u16)>,
    mut ssl: Option<&mut SSLConfig>,
    owned_ssl_ctx: Option<boring_sys::OwnedSslCtx>,
    default_data: JSValue,
    allow_half_open: bool,
    pause_on_connect: bool,
    fd_is_write_only: bool,
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
        prev.set_handlers(cx.global(), Some(handlers));
        debug_assert!(prev.socket.get().is_detached());
        prev
    } else {
        NewSocket::<IS_SSL>::new(Some(handlers))
    };
    socket.connection.set(Some(connection));
    socket.local_binding.set(local_binding);
    socket
        .protos
        .set(ssl.as_mut().and_then(|s| s.take_protos()));
    socket
        .server_name
        .set(ssl.as_mut().and_then(|s| s.take_server_name()));
    // Either the caller's JS-owned socket (reconnect) or the fresh one above.
    let socket_ref = socket;
    socket_ref.ref_();
    NewSocket::<IS_SSL>::data_set_cached(
        socket_ref.this_value_for_connect(cx.global()),
        cx.global(),
        default_data,
    );
    socket_ref.reset_client_tls_flags(
        IS_SSL && crate::socket::resolve_reject_unauthorized(vm, ssl.as_deref(), false),
    );
    socket_ref.update_flags(|f| {
        f.set(SocketFlags::ENDS_ON_PEER_FIN, !allow_half_open);
        f.set(SocketFlags::PAUSE_ON_CONNECT, pause_on_connect);
        f.set(SocketFlags::WRITE_ONLY_FD, fd_is_write_only);
    });
    // Held for the connect attempt regardless of `ref_pollref_on_connect`; `on_open` applies that.
    socket_ref
        .poll_ref
        .with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
    let opened = match socket_ref.do_connect(cx, owned_ssl_ctx) {
        Ok(opened) => opened,
        Err(errno) => {
            let is_unix = port.is_none();
            // Winsock's AF_UNIX connect doesn't report a missing path as ENOENT, which is what Node reports.
            #[cfg(windows)]
            let errno = match socket_ref.connection.get() {
                Some(UnixOrHost::Unix(path)) if is_unix && !bun_sys::exists(path) => {
                    bun_sys::SystemErrno::ENOENT
                }
                _ => errno,
            };
            let errno = match errno {
                // libuv reports UV_EINVAL for a pipe path it cannot express.
                bun_sys::SystemErrno::ENAMETOOLONG if is_unix => bun_sys::SystemErrno::EINVAL,
                bun_sys::SystemErrno::SUCCESS if is_unix => bun_sys::SystemErrno::ENOENT,
                bun_sys::SystemErrno::SUCCESS => bun_sys::SystemErrno::ECONNREFUSED,
                errno => errno,
            };
            {
                let this = socket;
                let handled = NewSocket::<IS_SSL>::handle_connect_error(this, errno);
                // Balance the unconditional `socket_ref.ref_()` above.
                NewSocket::deref(&this);
                // A `connectError` handler that threw on this synchronous failure
                // throws from `connect()`.
                handled?;
                return Ok(promise_value);
            }
        }
    };

    // What settling the connect promise in `on_open` left pending: an allocation failure, a terminating VM.
    opened?;
    Ok(promise_value)
}

/// `None` unless `listener` is listening on a socket, with TLS.
fn tls_listen_socket<'a>(listener: &TLSListener<'a>) -> Option<&'a mut uws_sys::ListenSocket> {
    let listen_socket = match listener {
        TLSListener::Listener(this) => match this.listener.get() {
            ListenerType::Uws(listen_socket) if this.ssl => listen_socket,
            _ => return None,
        },
        TLSListener::Https(server) => server.listener.get()?.cast(),
        TLSListener::DebugHttps(server) => server.listener.get()?.cast(),
        TLSListener::Ignored(_) => return None,
    };
    Some(bun_opaque::opaque_deref_mut(listen_socket))
}

/// `addContext()` of a `tls.Server` or an `https.Server` that is listening.
pub(crate) fn add_server_name(listener: TLSListener<'_>, hostname: &[u8], context: &SecureContext) {
    // No ClientHello can carry a NUL, so this pattern matches nothing, as in Node.
    if bun_core::strings::contains_char(hostname, 0) {
        return;
    }
    let Some(listen_socket) = tls_listen_socket(&listener) else {
        return;
    };
    let hostname = bun_core::ZBox::from_bytes(hostname);
    listen_socket.add_server_name(hostname.as_zstr().as_cstr(), context.ctx.as_ptr());
}

/// `setSecureContext()` of a `tls.Server` or an `https.Server` that is listening. Accepted sockets keep their context.
pub(crate) fn set_secure_context(listener: TLSListener<'_>, context: &SecureContext) {
    if let Some(listen_socket) = tls_listen_socket(&listener) {
        listen_socket.set_default_ssl_ctx(&context.ctx);
    }
    let TLSListener::Listener(this) = listener else {
        return;
    };
    if this.ssl && !matches!(this.listener.get(), ListenerType::None) {
        this.secure_ctx.set(Some(context.ctx.clone()));
    }
}

/// The address's key in `VirtualMachine::hot_map()`. `None` without `--hot`, or if two listeners can hold the address at once.
fn hot_reload_key(config: &SocketConfig) -> Option<Box<[u8]>> {
    VirtualMachine::get().as_mut().hot_map()?;
    if config.reuse_port || config.fd.is_some() || config.port == Some(0) {
        return None;
    }
    let mut key = b"[listen]-".to_vec();
    key.extend_from_slice(config.hostname_or_unix.slice());
    if let Some(port) = config.port {
        key.extend_from_slice(format!(":{port}").as_bytes());
    }
    Some(key.into_boxed_slice())
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

/// What a connection dials if it's a named pipe.
#[cfg(windows)]
pub(crate) enum NamedPipe<'a> {
    Path(&'a [u8]),
    Fd(Fd),
}

/// Writes a pipe's normalized name to `buffer`.
#[cfg(windows)]
pub(crate) fn named_pipe<'a>(
    connection: &UnixOrHost,
    buffer: &'a mut [u8],
) -> Option<NamedPipe<'a>> {
    use bun_sys::FdExt as _;
    match connection {
        // we check if the path is a named pipe otherwise we try to connect using AF_UNIX
        UnixOrHost::Unix(path) => normalize_pipe_name(path, buffer).map(NamedPipe::Path),
        UnixOrHost::Fd(fd) if fd.kind() == bun_core::FdKind::System => None,
        UnixOrHost::Fd(fd) => {
            let uvfd = fd.uv();
            let fd_type = uv::uv_guess_handle(uvfd);
            if fd_type == uv::HandleType::NamedPipe {
                return Some(NamedPipe::Fd(*fd));
            }
            // is not a libuv fd, check if it's a named pipe
            let osfd: uv::uv_os_fd_t = uvfd as usize as uv::uv_os_fd_t;
            if fd_type != uv::HandleType::Unknown
                || bun_sys::windows::GetFileType(osfd) != bun_sys::windows::FILE_TYPE_PIPE
            {
                return None;
            }
            // yay its a named pipe lets make it a libuv fd
            Some(NamedPipe::Fd(
                Fd::from_system(osfd)
                    .make_lib_uv_owned()
                    .unwrap_or_else(|_| panic!("failed to allocate file descriptor")),
            ))
        }
        UnixOrHost::Host { .. } => None,
    }
}

#[cfg(windows)]
pub(crate) struct WindowsNamedPipeListeningContext {
    pub(crate) uv_pipe: uv::Pipe,
    /// BACKREF: the parent `Listener` allocated this context in
    /// `listen_named_pipe` and outlives it (cleared to `None` in
    /// `close_pipe_and_deinit` before the listener is torn down). `BackRef`
    /// centralises the safe deref so call sites don't open-code a raw
    /// `NonNull::as_ref`.
    pub(crate) listener: Option<bun_ptr::BackRef<Listener>>,
    pub global_this: GlobalRef,
    /// JSC_BORROW: process-lifetime singleton; `&'static` so call sites read
    /// `self.vm.is_shutting_down()` without a raw-pointer deref.
    pub(crate) vm: &'static VirtualMachine,
}

/// `c_int`: raw libuv return code so JS `err.errno` is the platform-correct UV value.
#[cfg(windows)]
enum ListenPipeError {
    Sys(bun_sys::Error, c_int),
    Other(crate::Error),
}

#[cfg(windows)]
impl WindowsNamedPipeListeningContext {
    fn on_client_connect(this: *mut Self, status: uv::ReturnCode) {
        // SAFETY: `this` is the `data` pointer libuv hands back; it was set to a
        // live heap `WindowsNamedPipeListeningContext` in `listen_named_pipe`.
        // Shared borrow — `on_name_pipe_created` re-enters JS; the one `&mut`
        // (the `uv_pipe` field) is taken through the root pointer below.
        let this_ref = unsafe { &*this };
        if status != uv::ReturnCode::ZERO || this_ref.listener.is_none() {
            // connection dropped, or we are deiniting/closing
            return;
        }
        // `BackRef` deref — owner `Listener` outlives this context (see field doc).
        let listener_ref = this_ref.listener.unwrap();
        let listener: &Listener = listener_ref.get();
        // An accepted pipe is the listening script's.
        let entered = this_ref.vm.enter_context(listener.context);
        use crate::socket::windows_named_pipe::SocketType as PipeSocketType;
        // Owned for the whole accept: JS below can replace the slot through setSecureContext().
        let ssl_ctx = listener.secure_ctx.get().clone();
        let socket: PipeSocketType = if ssl_ctx.is_some() {
            PipeSocketType::Tls(Listener::on_name_pipe_created::<true>(listener))
        } else {
            PipeSocketType::Tcp(Listener::on_name_pipe_created::<false>(listener))
        };

        let client =
            WindowsNamedPipe::create(&this_ref.global_this.js_thread(entered.context()), socket);

        // SAFETY: `client` was just heap-allocated by `create()`; exclusive
        // here. The `&mut` to `uv_pipe` comes from the root pointer, scoped to
        // this call — `this_ref` (shared) never touches `uv_pipe`.
        let result = unsafe { (*client).get_accepted_by(&mut (*this).uv_pipe, ssl_ctx.as_ref()) };
        if result.is_err() {
            // connection dropped
            // Release the only ref, which goes 1→0 → queue_free → next-tick free. The
            // deferred path is required because `get_accepted_by` may have already `uv_pipe_init`'d
            // the client's inner handle on the loop; freeing the backing storage in-callback
            // before `uv_close` completes is the exact pattern libuv forbids.
            // SAFETY: `client` was just allocated via `WindowsNamedPipe::create`
            // with refcount==1; releasing the only ref schedules deinit.
            unsafe { WindowsNamedPipe::deref(client) };
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
    unsafe fn close_pipe_and_deinit(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live heap allocation.
        unsafe {
            (*this).listener = None;
            (*this).uv_pipe.data = this.cast::<c_void>();
            (*this).uv_pipe.close(Self::on_pipe_closed);
        }
    }

    fn listen(
        global_this: &JSGlobalObject,
        path: &[u8],
        backlog: i32,
        listener: *mut Listener,
    ) -> Result<*mut WindowsNamedPipeListeningContext, ListenPipeError> {
        // Heap-allocate at the final address so libuv can
        // store a pointer back into `uv_pipe`.
        let this = bun_core::heap::into_raw(Box::new(WindowsNamedPipeListeningContext {
            uv_pipe: bun_core::ffi::zeroed(),
            listener: NonNull::new(listener).map(bun_ptr::BackRef::from),
            global_this: GlobalRef::from(global_this),
            vm: global_this.bun_vm(),
        }));
        // A pipe handle that is registered with the loop must be closed via uv_close. `.1` flips once `uv_pipe_init` succeeds.
        let mut cleanup = scopeguard::guard((this, false), |(this, pipe_initialized)| {
            if pipe_initialized {
                // SAFETY: pipe is registered with the loop; close → on_pipe_closed → deinit.
                unsafe { Self::close_pipe_and_deinit(this) };
            } else {
                Self::deinit(this);
            }
        });

        // SAFETY: `this` was just allocated above; `&mut uv_pipe` is scoped to
        // this call.
        let init_result = unsafe { (*this).uv_pipe.init((*this).vm.uv_loop().cast(), false) };
        if init_result.is_err() {
            return Err(ListenPipeError::Other(crate::Error::FailedToInitPipe));
        }
        cleanup.1 = true;

        let listen_rc = if path[path.len() - 1] == 0 {
            // is already null terminated
            // SAFETY: `this` is live; `&mut uv_pipe` is scoped to this call.
            unsafe {
                (*this).uv_pipe.listen_named_pipe(
                    &path[..path.len() - 1],
                    backlog,
                    this.cast::<c_void>(),
                    Self::uv_on_client_connect,
                )
            }
        } else {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            // we need to null terminate the path
            let len = path.len().min(path_buf.len() - 1);
            path_buf[..len].copy_from_slice(&path[..len]);
            path_buf[len] = 0;
            // SAFETY: `this` is live; `&mut uv_pipe` is scoped to this call.
            unsafe {
                (*this).uv_pipe.listen_named_pipe(
                    &path_buf[..len],
                    backlog,
                    this.cast::<c_void>(),
                    Self::uv_on_client_connect,
                )
            }
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
        // SAFETY: `this` is live; `&mut uv_pipe` is scoped to this call.
        unsafe { (*this).uv_pipe.unref() };

        let (this, _) = scopeguard::ScopeGuard::into_inner(cleanup);
        Ok(this)
    }

    fn deinit(this: *mut Self) {
        // SAFETY: `this` is a live `heap::alloc` allocation; this is the last owner.
        unsafe {
            (*this).listener = None;
            drop(bun_core::heap::take(this));
        }
    }
}

/// What the JS `serverName` handler answered.
pub(crate) enum ServerNameAnswer {
    /// undefined / null: the default context.
    Default,
    /// A native SecureContext, for this handshake only.
    Context(boring_sys::OwnedSslCtx),
    /// `true`: the SNICallback is asynchronous. `handle.resumeSNI(...)` answers.
    Pending,
    /// An Error, a throw, or any other value: the connection is dropped with no TLS alert.
    Refused,
}

impl ServerNameAnswer {
    pub(crate) fn from_js(result: JSValue) -> Self {
        if result.is_boolean() && result.to_boolean() {
            return Self::Pending;
        }
        if result.to_error().is_some() {
            return Self::Refused;
        }
        if result.is_undefined_or_null() {
            return Self::Default;
        }
        match result.as_class_ref::<SecureContext>() {
            Some(sc) => Self::Context(sc.ctx.clone()),
            // Node treats anything else as an invalid SNI context.
            None => Self::Refused,
        }
    }

    /// Converts the answer to what a `ListenSocket::on_server_name` callback returns to openssl.c.
    pub(crate) fn into_raw(self, abort_handshake: *mut core::ffi::c_int) -> *mut uws_sys::SslCtx {
        let code = match self {
            Self::Default => return core::ptr::null_mut(),
            // The C dispatcher frees this +1 after `SSL_set_SSL_CTX` takes its own.
            Self::Context(ctx) => return ctx.into_raw(),
            Self::Refused => 1,
            Self::Pending => 2,
        };
        if !abort_handshake.is_null() {
            // SAFETY: live out-parameter for the duration of this dispatch.
            unsafe { *abort_handshake = code };
        }
        core::ptr::null_mut()
    }
}

/// `us_select_cert_cb` (openssl.c) calls this for a ClientHello with a server name, on an `SSL` of either engine that `on_open` gave a resolver.
///
/// # Safety
/// `bun_socket` is the live `TLSSocket` that owns the `SSL`, and `hostname` is NUL-terminated for the call. JS-thread only.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn us_dispatch_server_name(
    bun_socket: *mut c_void,
    hostname: *const core::ffi::c_char,
    abort_handshake: *mut core::ffi::c_int,
) -> *mut uws_sys::SslCtx {
    jsc::mark_binding!();
    if bun_socket.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: fn contract.
    let (tls, name) = unsafe {
        (
            bun_ptr::ThisPtr::new(bun_socket.cast::<TLSSocket>()),
            core::ffi::CStr::from_ptr(hostname),
        )
    };
    ask_server_name(tls, name).into_raw(abort_handshake)
}

/// Asks the `serverName` handler of a server-side socket.
fn ask_server_name(tls: bun_ptr::ThisPtr<TLSSocket>, name: &core::ffi::CStr) -> ServerNameAnswer {
    // An idle socket can drop its Handlers while the us_socket_t lives on;
    // `get_handlers()` would panic. Same guard as `us_dispatch_alpn_select`.
    if !tls.has_handlers() {
        return ServerNameAnswer::Default;
    }
    // No `Handlers::enter`/`exit` scope here: that protocol tracks the
    // accepted-socket callback lifecycle, and running it from inside the
    // handshake corrupts `active_connections` for every subsequent accept.
    let handlers = tls.get_handlers();
    let callback = handlers.on_server_name();
    if callback.is_empty()
        || handlers.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running
    {
        return ServerNameAnswer::Default;
    }
    let global = handlers.global_object;
    // The resume handle an asynchronous SNICallback uses (`handle.resumeSNI(...)`).
    // GC-managed, so a resume after the socket died is a safe no-op.
    let socket_handle = tls.get_this_value(&global);
    // The handler's `this` is the `data` that carries `_SNICallback`: the
    // listener's (the net.Server, kept past `stop()` while connections remain)
    // for an accepted socket, the socket's own (the TLSSocket) for an adopted one.
    let this_value = match handlers.listener() {
        Some(listener) => listener.strong_data.get().get(),
        None => TLSSocket::data_get_cached(socket_handle),
    }
    .unwrap_or(JSValue::UNDEFINED);
    // Peer-supplied SNI bytes, decoded as Latin-1 like Node's `OneByteString`.
    let js_name = EncodedSlice::latin1(name.to_bytes()).to_js(&global);
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
    ServerNameAnswer::from_js(result)
}
