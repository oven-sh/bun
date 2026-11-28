//! `req.socket._handle` of a node:http server: a `TCPSocket` / `TLSSocket` over `InternalSocket::UwsHttp` until `leave_http` adopts the `us_socket_t`.

use core::ffi::{c_int, c_void};
use std::rc::Rc;

use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_ptr::{AsCtxPtr as _, RefPtr};
use bun_uws::{self as uws, us_socket_t};
use bun_websocket::deflate::Params;

use super::{Handlers, NewSocket, SocketFlags};
use crate::dispatch::fold;
use crate::server::{AnyServer, ServerWebSocket};

type Transport<const SSL: bool> = uws::NewSocketHandler<SSL>;

/// What the handle of each connection of one node:http server starts with, as a `Listener` has it for its connections.
pub(crate) struct AcceptedSocketConfig {
    pub(crate) handlers: Rc<Handlers>,
    /// `ALPNProtocols`, in wire format.
    pub(crate) protos: Option<Box<[u8]>>,
    /// The handle's first `data`, where node:net's `open` handler finds its accept function. The server wrapper's `socketData` slot keeps it alive.
    pub(crate) data: JSValue,
}

impl<const SSL: bool> NewSocket<SSL> {
    fn accept_from_http(
        config: &AcceptedSocketConfig,
        s: *mut us_socket_t,
        reject_unauthorized: bool,
    ) -> RefPtr<Self> {
        let this = Self::new(Some(Rc::clone(&config.handlers)));
        let transport = Transport::<SSL>::from_uws_http(s);
        this.socket.set(transport);
        this.protos.set(config.protos.clone());
        this.update_flags(|f| {
            f.set(SocketFlags::REJECT_UNAUTHORIZED, reject_unauthorized);
            f.insert(SocketFlags::NO_DELAY | SocketFlags::HELD_BY_SERVER);
        });
        let global = config.handlers.global_object;
        Self::data_set_cached(this.get_this_value(&global), &global, config.data);
        this
    }

    /// Bytes read from the connection, after TLS decryption. uWS counts them while it owns the connection.
    pub(crate) fn total_bytes_read(&self) -> u64 {
        match self.socket.get().socket {
            uws::InternalSocket::UwsHttp(s) => Bun__NodeHTTPServerSocket__bytesRead(s, SSL),
            _ => self.bytes_read.get(),
        }
    }

    /// What `socket.write()` wrote and the bodies of the finished responses, plus the body of the response that has the connection while uWS owns it.
    pub(crate) fn total_bytes_written(&self) -> u64 {
        let own = self.bytes_written.get();
        match self.socket.get().socket {
            uws::InternalSocket::UwsHttp(s) => {
                own + Bun__NodeHTTPServerSocket__responseBytesWritten(s, SSL)
            }
            _ => own,
        }
    }

    /// The bytes that the kernel hasn't taken yet, sealed TLS records too. uWS and the response that has the connection hold them while uWS owns it.
    pub(crate) fn write_queue_size(&self) -> u64 {
        let socket = self.socket.get();
        match socket.socket {
            uws::InternalSocket::UwsHttp(s) => Bun__NodeHTTPServerSocket__writeQueueSize(s, SSL),
            _ => {
                self.buffered_data_for_node_net.get().len() as u64
                    + u64::from(socket.ssl_spill_len())
            }
        }
    }

    /// uWS has let go of `s`, which is open, and has destructed its ext: nothing here may ask the `UwsHttp` transport. `unsent` is what uWS accepted and the kernel hasn't taken.
    fn leave_http(
        self: RefPtr<Self>,
        s: *mut us_socket_t,
        unsent: &[u8],
        reads_paused: bool,
        bytes_read: u64,
        response_bytes_written: u64,
    ) {
        self.bytes_read.set(bytes_read);
        self.bytes_written
            .set(self.bytes_written.get() + response_bytes_written);
        let handlers = self.get_handlers();
        let vm = VirtualMachine::get();
        let loop_ = vm.uws_loop();
        let group = vm
            .client_socket_groups_in(vm.context_of(handlers.context()))
            .bun_connect_group::<SSL>(loop_);
        let kind = if SSL {
            uws::SocketKind::BunSocketTls
        } else {
            uws::SocketKind::BunSocketTcp
        };
        let adopted =
            Transport::<SSL>::adopt_group(s, group, kind, self.as_ptr(), |owner, socket| {
                // SAFETY: `owner` is `self`.
                unsafe { (*owner).socket.set(socket) }
            });
        debug_assert!(adopted, "the caller checks that the socket is open");
        self.update_flags(|f| f.remove(SocketFlags::HELD_BY_SERVER));
        if self.ref_pollref_on_connect.get() {
            self.poll_ref.ref_(bun_io::js_vm_ctx());
        }
        // Every reason but the handle's own pause, which is node:net's full buffer, belonged to the HTTP connection.
        if reads_paused && !self.flags.get().contains(SocketFlags::IS_PAUSED) {
            self.socket.get().resume_stream();
        }
        if !unsent.is_empty() {
            self.buffered_data_for_node_net
                .with_mut(|queued| queued.append_slice(unsent));
            let socket = self.socket.get();
            fold(self.on_writable(socket));
        }
    }
}

/// What the `ws` package negotiated for one connection. `handshake` is the whole 101 response head.
pub(crate) struct WebSocketUpgrade<'a> {
    pub(crate) websocket: JSValue,
    pub(crate) handlers: JSValue,
    pub(crate) handshake: &'a [u8],
    pub(crate) behavior: uws::WebSocketBehavior,
    pub(crate) deflate_params: Option<Params>,
}

unsafe extern "C" {
    safe fn Bun__NodeHTTPServerSocket__bytesRead(s: *mut us_socket_t, ssl: bool) -> u64;
    safe fn Bun__NodeHTTPServerSocket__responseBytesWritten(s: *mut us_socket_t, ssl: bool) -> u64;
    safe fn Bun__NodeHTTPServerSocket__writeQueueSize(s: *mut us_socket_t, ssl: bool) -> u64;
    safe fn Bun__getNodeHTTPServerSocketThisValue(is_ssl: bool, socket: *mut c_void) -> JSValue;
    fn Bun__NodeHTTPSocket__prepareForWebSocket(
        ssl: bool,
        s: *mut us_socket_t,
        handle: *mut c_void,
    );
}

impl<const SSL: bool> NewSocket<SSL> {
    /// The open `us_socket_t` of a connection that `server_handlers`' server accepted and that has left HTTP with nothing queued.
    fn socket_for_web_socket(
        &self,
        server_handlers: Option<&Rc<Handlers>>,
    ) -> Option<*mut us_socket_t> {
        let accepted_by_server = matches!(
            (self.handlers.get(), server_handlers),
            (Some(own), Some(servers)) if Rc::ptr_eq(own, servers)
        );
        let socket = self.socket.get();
        self.own_connected_socket().filter(|_| {
            accepted_by_server
                && !socket.is_closed()
                && !socket.is_shutdown()
                && self.buffered_data_for_node_net.get().len() == 0
        })
    }

    /// Makes the connection a WebSocket of `server` for the `ws` package. Returns the `ServerWebSocket`, or `None` with nothing written.
    pub(crate) fn become_web_socket(
        &self,
        global: &JSGlobalObject,
        server: AnyServer,
        server_handlers: Option<&Rc<Handlers>>,
        upgrade: &WebSocketUpgrade<'_>,
    ) -> JsResult<Option<JSValue>> {
        if server.terminated() || self.socket_for_web_socket(server_handlers).is_none() {
            return Ok(None);
        }
        server.init_ws_package_handlers(global, upgrade.handlers)?;
        // That read properties of an object, which can run script.
        let Some(s) = self.socket_for_web_socket(server_handlers) else {
            return Ok(None);
        };
        // SAFETY: its ext holds only this socket's pointer.
        let adopted =
            unsafe { adopt_into_web_socket(SSL, s, self.as_ctx_ptr().cast(), server, upgrade) };
        let Some(ws) = adopted else {
            return Ok(None);
        };
        self.update_flags(|f| f.insert(SocketFlags::HELD_BY_SERVER));
        self.bytes_written
            .set(self.bytes_written.get() + upgrade.handshake.len() as u64);
        // The server holds the event loop for its WebSockets.
        self.poll_ref.unref(bun_io::js_vm_ctx());
        if self.flags.get().contains(SocketFlags::IS_PAUSED) {
            self.update_flags(|f| f.remove(SocketFlags::IS_PAUSED));
            self.socket.get().resume_stream();
        }
        Ok(Some(ws))
    }
}

/// SAFETY: `s` is from `socket_for_web_socket`. Its ext holds only `handle`, which the WebSocket keeps as its socket data. `None` with nothing written.
unsafe fn adopt_into_web_socket(
    ssl: bool,
    s: *mut us_socket_t,
    handle: *mut c_void,
    server: AnyServer,
    upgrade: &WebSocketUpgrade<'_>,
) -> Option<JSValue> {
    let handler = server.ws_package_handler()?;
    let context = server.ws_package_context(upgrade.behavior)?;
    let ws = ServerWebSocket::init_for_ws_package(handler.get(), upgrade.websocket).payload_guard();
    // SAFETY: the caller's contract. `init` made `ws` keep its wrapper alive until the WebSocket closes.
    unsafe {
        Bun__NodeHTTPSocket__prepareForWebSocket(ssl, s, handle);
        let user_data = ws.as_ptr().cast();
        context.adopt(s, ssl, user_data, upgrade.deflate_params, upgrade.handshake);
    }
    Some(ws.to_js())
}

/// Runs `$body` with `$this: &NewSocket<SSL>` for a handle that `Bun__NodeHTTPSocket__create` returned.
/// With `$take` (`init_ref` or `from_raw`), `$this` is a `RefPtr` and `$socket` its transport.
macro_rules! with_handle {
    ($ssl:expr, $handle:expr, |$this:ident| $body:expr) => {
        if $ssl {
            // SAFETY: the caller's contract.
            let $this = unsafe { &*$handle.cast::<NewSocket<true>>() };
            $body
        } else {
            // SAFETY: the caller's contract.
            let $this = unsafe { &*$handle.cast::<NewSocket<false>>() };
            $body
        }
    };
    ($ssl:expr, $handle:expr, $take:ident, |$this:ident, $socket:pat_param| $body:expr) => {
        if $ssl {
            // SAFETY: the caller's contract.
            let $this = unsafe { RefPtr::<NewSocket<true>>::$take($handle.cast()) };
            let $socket = $this.socket.get();
            $body
        } else {
            // SAFETY: the caller's contract.
            let $this = unsafe { RefPtr::<NewSocket<false>>::$take($handle.cast()) };
            let $socket = $this.socket.get();
            $body
        }
    };
}

/// Returns the connection's ref. SAFETY: `config` is a server's `node_socket_config`, and `s` is an open connection of that server.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__create(
    config: *const AcceptedSocketConfig,
    s: *mut us_socket_t,
    ssl: bool,
    reject_unauthorized: bool,
) -> *mut c_void {
    // SAFETY: the caller's contract.
    let config = unsafe { &*config };
    if ssl {
        NewSocket::<true>::accept_from_http(config, s, reject_unauthorized)
            .into_raw()
            .cast()
    } else {
        NewSocket::<false>::accept_from_http(config, s, false)
            .into_raw()
            .cast()
    }
}

/// SAFETY: here and below, `handle` came from `create` with the same `ssl`, and C++ still holds the connection's ref on it.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onOpen(handle: *mut c_void, ssl: bool) {
    with_handle!(ssl, handle, init_ref, |this, socket| fold(
        this.on_open(socket)
    ))
}

/// uWS has sent all that it buffered for the connection.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onWritable(handle: *mut c_void, ssl: bool) {
    with_handle!(ssl, handle, init_ref, |this, socket| fold(
        this.on_writable(socket)
    ))
}

/// The HTTP side of a connection that uWS owns, a JSNodeHTTPServerSocket. `None` for every other socket.
pub(crate) fn http_connection_of<const SSL: bool>(socket: &NewSocket<SSL>) -> Option<JSValue> {
    match socket.socket.get().socket {
        uws::InternalSocket::UwsHttp(s) => {
            Some(Bun__getNodeHTTPServerSocketThisValue(SSL, s.cast())).filter(|it| !it.is_empty())
        }
        _ => None,
    }
}

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__globalObject(
    handle: *mut c_void,
    ssl: bool,
) -> *const JSGlobalObject {
    with_handle!(ssl, handle, |this| core::ptr::from_ref::<JSGlobalObject>(
        &this.get_handlers().global_object
    ))
}

/// A read that the JS socket gets before the HTTP parser does. SAFETY: `data` is valid for `length` bytes.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onData(
    handle: *mut c_void,
    ssl: bool,
    data: *const u8,
    length: usize,
) {
    // SAFETY: the caller's contract.
    let data = unsafe { bun_core::ffi::slice(data, length) };
    with_handle!(ssl, handle, init_ref, |this, socket| fold(
        this.on_data(socket, data)
    ))
}

#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onEnd(handle: *mut c_void, ssl: bool) {
    with_handle!(ssl, handle, init_ref, |this, socket| fold(
        this.on_end(socket)
    ))
}

/// Another response takes the connection from one that wrote `bytes` of body.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__addBytesWritten(
    handle: *mut c_void,
    ssl: bool,
    bytes: u64,
) {
    with_handle!(ssl, handle, |this| {
        this.bytes_written.set(this.bytes_written.get() + bytes)
    })
}

/// uWS closed the connection and is about to free the `us_socket_t`. JavaScript hears of it in `onClose`.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__forgetConnection(
    handle: *mut c_void,
    ssl: bool,
) {
    with_handle!(ssl, handle, |this| {
        this.bytes_read.set(this.total_bytes_read());
        this.bytes_written.set(this.total_bytes_written());
        this.socket.set(Transport::DETACHED)
    })
}

/// The WebSocket that `become_web_socket` made of the connection closed.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__forgetWebSocket(
    handle: *mut c_void,
    ssl: bool,
    sent_everything: bool,
) {
    with_handle!(ssl, handle, |this| {
        this.update_flags(|f| f.set(SocketFlags::CLOSED_WITH_ALL_DATA_SENT, sent_everything));
        this.socket.set(Transport::DETACHED)
    })
}

/// The TLS handshake ended. The socket can be closed when this returns.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onHandshake(
    handle: *mut c_void,
    success: c_int,
    verify_error: uws::us_bun_verify_error_t,
) {
    // SAFETY: the caller's contract, for a TLS connection.
    let this = unsafe { RefPtr::<NewSocket<true>>::init_ref(handle.cast()) };
    let socket = this.socket.get();
    fold(this.on_handshake(socket, success, verify_error))
}

/// Releases the connection's ref, so `handle` dangles when this returns.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__onClose(
    handle: *mut c_void,
    ssl: bool,
    read_error: c_int,
    run_script: bool,
) {
    with_handle!(ssl, handle, from_raw, |this, _| {
        this.update_flags(|f| f.remove(SocketFlags::HELD_BY_SERVER));
        if !run_script {
            this.update_flags(|f| f.insert(SocketFlags::CLOSED_SILENTLY));
        }
        fold(this.on_close(Transport::DETACHED, read_error, None))
    })
}

/// The ext slot of `s` takes over the connection's ref. SAFETY: `s` is open, `HttpResponse::leaveHttp()` has run on it, and `unsent` is valid for `unsent_length` bytes.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__NodeHTTPSocket__leaveHttp(
    handle: *mut c_void,
    ssl: bool,
    s: *mut us_socket_t,
    unsent: *const u8,
    unsent_length: usize,
    reads_paused: bool,
    bytes_read: u64,
    response_bytes_written: u64,
) {
    // SAFETY: the caller's contract.
    let unsent = unsafe { bun_core::ffi::slice(unsent, unsent_length) };
    with_handle!(ssl, handle, init_ref, |this, _| this.leave_http(
        s,
        unsent,
        reads_paused,
        bytes_read,
        response_bytes_written
    ))
}
