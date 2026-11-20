use bun_jsc::JsCell;
use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::Ordering;

use crate::jsc::api::server_config::SSLConfig;
use crate::jsc::{
    self as jsc, AutoFlush, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine,
    VirtualMachineSqlExt as _, bun_string_jsc, run_callback,
};
use bun_boringssl as BoringSSL;
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::OffsetByteList;
use bun_collections::smallvec::SmallVec;
use bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING;
use bun_core::fmt::ConnTimeoutKind;
use bun_core::strings;
use bun_core::{self};
use bun_io::KeepAlive;
use bun_jsc::rare_data::SocketGroups;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef, RefPtr};
use bun_uws as uws;
use std::rc::Rc;

use crate::jsc::EventLoopTimerTag;
use crate::postgres::data_cell as DataCell;
use crate::postgres::error_jsc::{
    create_postgres_error, postgres_error_to_js, postgres_error_to_js_with_hint,
};
use crate::postgres::postgres_request as PostgresRequest;
use crate::postgres::postgres_sql_query;
use crate::postgres::postgres_sql_statement::{
    Columns, Error as StatementError, StatementCache, declared,
};
use crate::postgres::protocol::error_response_jsc;
use crate::postgres::{PostgresSQLQuery, PostgresSQLStatement};
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use crate::shared::connection_timers::{self, ConnectionTimers, TimedConnection};
use crate::shared::server_identity;
use crate::shared::start_tls::{start_tls, verifies_certificate};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::PostgresErrorOptions;
use bun_sql::postgres::frontend;
use bun_sql::postgres::handshake::{ChannelBinding, ConnectionStrings, Handshake, Phase, Refusal};
use bun_sql::postgres::pipeline::{self, Cached, OnCancel, OnError, Protocol, Step, Turn};
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::{Int4, ResultFormats};
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::SQLQueryResultMode;
use bun_sql::shared::SSLMode;

type Socket = uws::AnySocket;
type Pipeline = pipeline::Pipeline<RefPtr<PostgresSQLQuery>, StatementError, JsCell<Columns>>;
type Entry = pipeline::Entry<RefPtr<PostgresSQLQuery>, StatementError, JsCell<Columns>>;

bun_core::define_scoped_log!(debug, Postgres, visible);

const CANCEL_REQUEST_TIMEOUT_MS: u32 = 5_000;

const CANCELLED_ON_THE_WIRE: &[u8] =
    b"The server has received the query and may still run it. Its result is discarded.";

use crate::generated_bindgen::postgres_sql_connection::js_PostgresSQLConnection as js;

#[path = "CopyStream.rs"]
mod copy_stream;

use crate::jsc::verify_error_to_js;

/// The `onnotification` callback, with the channel and the payload.
struct PendingNotification {
    callback: JSValue,
    arguments: [JSValue; 2],
}

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLConnection {
    socket: JsCell<Socket>,
    ref_count: Cell<u32>,

    handshake: JsCell<Handshake>,
    pipeline: JsCell<Pipeline>,

    write_buffer: JsCell<OffsetByteList>,
    read_buffer: JsCell<OffsetByteList>,
    /// While set, a read from a nested event loop tick only appends to `read_buffer`.
    defer_reads: Cell<bool>,
    writer: Cell<Writer>,

    pub(crate) poll_ref: KeepAlive,
    global_object: BackRef<JSGlobalObject>,
    vm: BackRef<VirtualMachine>,
    statements: JsCell<StatementCache>,
    /// The wrapper. Strong until the connection has failed and let go of its socket and its requests.
    js_value: JsCell<crate::jsc::JsRef>,

    backend_key_data: Cell<Option<protocol::BackendKeyData>>,
    /// Of a connection that only carries a CancelRequest, until it ends.
    cancel_target: JsCell<Option<Seat>>,

    /// `us_ssl_ctx_t` built from `tls_config` at construct time. Applied via
    /// `us_socket_adopt_tls` when the server replies `S` to the SSLRequest.
    secure: Option<OwnedSslCtx>,
    /// Shared with the connection that carries a CancelRequest for this one.
    tls_config: Rc<SSLConfig>,

    flags: Cell<ConnectionFlags>,
    timers: ConnectionTimers,
    auto_flush_registered: Cell<bool>,

    /// Interned notification channel names; see `channel_name_js`.
    channel_names: JsCell<Vec<InternedChannel>>,

    /// The CopyData payloads of the read that is being parsed; see `flush_copy_out`.
    copy_out: JsCell<Vec<u8>>,
}

struct InternedChannel {
    bytes: Box<[u8]>,
    js: Strong,
}

#[derive(Clone, Copy)]
enum Writer {
    Idle,
    /// A query that user code starts now is written by the `advance()` that is running.
    Advancing,
    /// The request at the end of the write buffer is not complete.
    Encoding {
        start: usize,
    },
    /// That request was dropped. The server answers those ahead of it and hangs up.
    Terminated,
}

bun_event_loop::impl_timer_owner!(PostgresSQLConnection;
    from_timer_ptr => timers.timer,
    from_max_lifetime_timer_ptr => timers.max_lifetime_timer,
);

impl Drop for PostgresSQLConnection {
    fn drop(&mut self) {
        self.timers.stop();
        self.unregister_auto_flusher();
        if self.is_ready() {
            self.close_socket();
        }
    }
}

impl PostgresSQLConnection {
    /// Read-modify-write the packed `Cell<ConnectionFlags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut ConnectionFlags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_object.get()
    }

    #[inline]
    fn event_loop(&self) -> &'static crate::jsc::EventLoop {
        VirtualMachine::get().event_loop()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }

    #[inline]
    fn state(&self) -> &Phase {
        self.handshake.get().phase()
    }

    #[inline]
    fn is_ready(&self) -> bool {
        matches!(self.state(), Phase::Ready { .. })
    }

    #[inline]
    pub(crate) fn is_closed(&self) -> bool {
        matches!(self.state(), Phase::Closed { .. })
    }

    pub(crate) fn names_statements(&self) -> bool {
        let flags = self.flags.get();
        !flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
    }

    /// `f` runs no JS.
    fn write<T>(&self, f: impl FnOnce(&mut Vec<u8>) -> T) -> T {
        self.write_buffer
            .with_mut(|buffer| f(&mut buffer.byte_list))
    }

    /// Adds to the request that `write_next` began. `ConnectionClosed`: it is not in the buffer any more.
    #[inline]
    pub(crate) fn encode_more<T>(
        &self,
        f: impl FnOnce(&mut Vec<u8>) -> Result<T, AnyPostgresError>,
    ) -> Result<T, AnyPostgresError> {
        match self.writer.get() {
            Writer::Encoding { .. } => self.write(f),
            _ => Err(AnyPostgresError::ConnectionClosed),
        }
    }

    /// User code inside a Bind runs the event loop. It may wait for a request that cannot be written before it returns.
    fn abandon_incomplete_request(&self) {
        if let Writer::Encoding { start } = self.writer.get() {
            self.writer.set(Writer::Terminated);
            self.write(|out| {
                out.truncate(start);
                out.extend_from_slice(&frontend::TERMINATE);
            });
        }
    }
}

impl TimedConnection for PostgresSQLConnection {
    fn timers(&self) -> &ConnectionTimers {
        &self.timers
    }

    fn phase(&self) -> connection_timers::Phase {
        use connection_timers::Phase::{Connected, Connecting, Failed};
        match self.state() {
            Phase::Dialing | Phase::SslRequest { .. } | Phase::TlsHandshake => Connecting(""),
            Phase::Startup(_) | Phase::CancelSent => {
                Connecting(" (sent startup message, but never received response)")
            }
            Phase::Ready { .. } => Connected,
            Phase::Closed { .. } => Failed,
        }
    }

    fn has_requests(&self) -> bool {
        self.pipeline.get().is_busy()
    }

    fn is_processing_data(&self) -> bool {
        self.flags
            .get()
            .contains(ConnectionFlags::IS_PROCESSING_DATA)
    }

    fn fail_timeout(&self, kind: ConnTimeoutKind, message: core::fmt::Arguments<'_>) {
        let code: &[u8] = match kind {
            ConnTimeoutKind::Idle => b"ERR_POSTGRES_IDLE_TIMEOUT",
            ConnTimeoutKind::Connection => b"ERR_POSTGRES_CONNECTION_TIMEOUT",
            ConnTimeoutKind::MaxLifetime => b"ERR_POSTGRES_LIFETIME_TIMEOUT",
        };
        let options = PostgresErrorOptions {
            code,
            ..Default::default()
        };
        let global = self.global();
        self.fail_with_js_value(
            create_postgres_error(global, message.to_string().as_bytes(), &options)
                .unwrap_or_else(|err| global.take_error(err)),
        );
    }

    fn notify_retiring(&self) {
        let Some(js_value) = self.js_value.get().try_get() else {
            return;
        };
        if let Some(on_retire) = js::onretire_get_cached(js_value) {
            let _guard = self.ref_guard();
            run_callback(self.global(), on_retire, &[]);
        }
    }
}

impl AutoFlush for PostgresSQLConnection {
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    fn auto_flush_registered(&self) -> &Cell<bool> {
        &self.auto_flush_registered
    }

    fn can_flush(&self) -> bool {
        self.is_ready()
            && !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
            && self.write_buffer.get().len() > 0
    }

    fn on_auto_flush(&self) -> bool {
        let _guard = self.ref_guard();
        // With backpressure, onWritable drains.
        if !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            self.drain_internal();
        }
        let again = self.can_flush();
        self.auto_flush_registered.set(again);
        again
    }
}

impl PostgresSQLConnection {
    /// `on_handshake` sends the StartupMessage.
    fn setup_tls(&self) {
        let started = start_tls(
            self.as_ctx_ptr(),
            *self.socket.get(),
            (
                uws::SocketKind::PostgresTls,
                SocketGroups::postgres_group::<true>,
            ),
            self.secure.as_ref(),
            &self.tls_config,
            self.handshake.get().ssl_mode,
            |socket| self.socket.set(socket),
        );
        if started.is_err() {
            self.fail(
                b"Failed to upgrade to TLS",
                AnyPostgresError::TLSUpgradeFailed,
            );
        }
    }

    fn start(&self) {
        self.start_max_lifetime_timer();
        match self.cancel_target.get() {
            None => {
                self.reset_connection_timeout();
                let sent = self.write(|out| self.handshake.with_mut(|it| it.send_startup(out)));
                if let Err(err) = sent {
                    self.fail(b"Failed to write startup message", err);
                }
            }
            // One time budget, from dial to hang-up.
            Some(target) => match target.cancel_request() {
                Some(packet) => {
                    self.write(|out| self.handshake.with_mut(|it| it.send_cancel(&packet, out)))
                }
                None => self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed),
            },
        }
        self.drain_internal();
    }

    /// Runs at the end of the read, so that a failure later in that read reports `onclose` alone.
    fn notify_connected(&self) {
        if !self.handshake.with_mut(Handshake::announce) {
            return;
        }
        let js_value = self.js_value.get().get();
        if let Some(on_connect) = js::onconnect_take_cached(js_value, self.global()) {
            run_callback(self.global(), on_connect, &[JSValue::NULL, js_value]);
        }
    }

    pub fn finalize(&self) {
        debug!("PostgresSQLConnection finalize");
        self.timers.stop();
        self.js_value.with_mut(|r| r.finalize());
    }

    /// Keep the process alive only while a connected connection has something in flight.
    pub(crate) fn update_poll_ref(&self) {
        if !self.is_ready() {
            return;
        }
        let flags = self.flags.get();
        // What a paused COPY TO STDOUT waits for is its consumer, which is in this process.
        let idle = !flags.contains(ConnectionFlags::KEEP_ALIVE_REQUESTED)
            && (flags.contains(ConnectionFlags::COPY_OUT_PAUSED)
                || (!self.has_requests() && self.write_buffer.get().is_empty()));
        if idle {
            self.poll_ref.unref(self.vm_ctx());
        } else {
            self.poll_ref.r#ref(self.vm_ctx());
        }
    }

    pub(crate) fn flush_data_and_reset_timeout(&self) {
        self.reset_connection_timeout();
        // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
        self.register_auto_flusher();
    }

    fn flush_data(&self) {
        self.abandon_incomplete_request();
        // we know we still have backpressure so just return we will flush later
        if self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            debug!("flushData: has backpressure");
            return;
        }

        let chunk = self.write_buffer.get().remaining();
        if chunk.is_empty() {
            debug!("flushData: no data to flush");
            return;
        }

        let wrote = self.socket.get().write(chunk);
        self.update_flags(|f| {
            f.set(
                ConnectionFlags::HAS_BACKPRESSURE,
                wrote < 0 || (wrote as usize) < chunk.len(),
            )
        });
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            let wrote = usize::try_from(wrote).expect("int cast");
            SocketMonitor::write(&chunk[..wrote]);
            self.write_buffer.with_mut(|b| b.consume(wrote));
        }
    }

    fn release_wrapper(&self) {
        if self.is_closed() && self.pipeline.get().is_empty() && self.socket.get().is_closed() {
            self.js_value.with_mut(|r| r.downgrade());
        }
    }

    fn fail_with_js_value(&self, value: JSValue) {
        self.timers.stop();
        if self.is_closed() {
            self.release_wrapper();
            return;
        }

        let asked = matches!(self.state(), Phase::CancelSent) && self.write_buffer.get().is_empty();
        self.handshake.with_mut(Handshake::close);

        let _guard = self.ref_guard();
        // Read first: without a socket nothing native keeps the wrapper of a failed connection.
        let on_close_opt = js::onclose_take_cached(self.js_value.get().get(), self.global());
        // The socket closes before `onclose`, which may dial again. Requests are rejected after it.
        self.close_socket();
        if let Some(on_close) = on_close_opt {
            let mut js_error = value.to_error().unwrap_or(value);
            if js_error.is_empty() {
                js_error = postgres_error_to_js(
                    self.global(),
                    Some(b"Connection closed"),
                    AnyPostgresError::ConnectionClosed,
                );
            }
            js_error.ensure_still_alive();
            // Reported here rather than returned: the pending queries are still
            // rejected below whatever `onclose` did.
            run_callback(self.global(), on_close, &[js_error]);
        }
        while let Some(entry) = self.pipeline.with_mut(Pipeline::pop) {
            self.end_rejected(entry, Some(value));
        }
        self.release_wrapper();
        if let Some(target) = self.cancel_target.take() {
            target
                .session
                .on_cancel_connection_closed(target.turn, asked);
        }
    }

    fn fail(&self, message: &[u8], err: AnyPostgresError) {
        debug!(
            "failed: {}: {}",
            bstr::BStr::new(message),
            <&'static str>::from(err)
        );

        let global_object = self.global();

        self.fail_with_js_value(postgres_error_to_js(global_object, Some(message), err));
    }

    fn refuse(&self, refusal: &Refusal) {
        self.fail(refusal.message.as_bytes(), refusal.error);
    }

    fn on_close(&self) {
        self.handle_socket_failure(|this| match this.state() {
            Phase::Ready { .. } | Phase::Closed { .. } => {
                this.fail(b"Connection closed", AnyPostgresError::ConnectionClosed)
            }
            // The pool dials again: the database may still be starting, behind a proxy that is up.
            _ => this.fail(
                b"Connection closed before the connection was established",
                AnyPostgresError::ConnectionFailed,
            ),
        });
    }

    fn on_connect_error(&self) {
        self.handle_socket_failure(|this| {
            this.fail(b"Failed to connect", AnyPostgresError::ConnectionRefused);
        });
    }

    fn handle_socket_failure(&self, fail: impl FnOnce(&Self)) {
        self.unregister_auto_flusher();
        let _entered = self.event_loop().enter_scope();
        self.poll_ref.unref(self.vm_ctx());
        fail(self);
    }

    fn request_tls(&self) {
        let socket = self.socket.get();
        self.handshake
            .with_mut(|it| it.request_tls(|bytes| socket.write(bytes).max(0) as usize));
    }

    fn on_open(&self, socket: uws::AnySocket) {
        self.socket.set(socket);
        // What ends a query whose peer is gone without a FIN. Not a unix socket's option.
        if self.handshake.get().strings.path().is_empty() {
            let _ = match socket {
                Socket::SocketTcp(tcp) => tcp.set_keep_alive(true, 60),
                Socket::SocketTls(tls) => tls.set_keep_alive(true, 60),
            };
        }

        self.poll_ref.r#ref(self.vm_ctx());

        if self.handshake.get().ssl_mode == SSLMode::Disable {
            self.start();
        } else {
            self.request_tls();
        }
    }

    /// verify-full's name check, asked inside the handshake.
    pub fn server_identity(&self, ssl: &mut bun_boringssl_sys::SSL) -> BoringSSL::ServerIdentity {
        BoringSSL::server_identity(ssl, self.native_identity_hostname())
    }

    /// The name verify-full matches, in and after the handshake. Empty (none configured) matches no certificate.
    /// `tls.checkServerIdentity` replaces the match, as in Node.
    fn native_identity_hostname(&self) -> Option<&[u8]> {
        (self.tls_config.reject_unauthorized() != 0
            && self.handshake.get().ssl_mode == SSLMode::VerifyFull
            && self.check_server_identity_callback().is_none())
        .then(|| self.tls_config.server_name_bytes())
    }

    fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.js_value
            .get()
            .try_get()
            .and_then(js::check_server_identity_get_cached)
    }

    fn on_handshake(&self, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        debug!("onHandshake: {} {}", success, ssl_error.error_no);
        // The server rejected us, whatever `rejectUnauthorized` says, or its chain does not verify.
        let ssl_mode = self.handshake.get().ssl_mode;
        if success != 1
            || (ssl_error.error_no != 0 && verifies_certificate(&self.tls_config, ssl_mode))
        {
            let v = verify_error_to_js(&ssl_error, self.global());
            self.fail_with_js_value(v);
            return;
        }
        // A TLS 1.2 server can renegotiate. BoringSSL refuses another certificate then.
        if !matches!(self.state(), Phase::TlsHandshake) {
            return;
        }

        let socket = *self.socket.get();
        if let Some(callback) = self.check_server_identity_callback() {
            // It can close this connection, or see a renegotiation through from a nested tick.
            let _guard = self.ref_guard();
            let hostname = self.tls_config.server_name_bytes();
            if let Err(reason) = server_identity::check(self.global(), callback, &socket, hostname)
            {
                self.fail_with_js_value(reason);
                return;
            }
            if !matches!(self.state(), Phase::TlsHandshake) {
                return;
            }
        } else if let Some(hostname) = self.native_identity_hostname() {
            let ssl = match &socket {
                Socket::SocketTls(tls) => tls.ssl_mut(),
                Socket::SocketTcp(_) => None,
            };
            if hostname.is_empty()
                || !ssl.is_some_and(|ssl| uws::check_server_identity(ssl, hostname))
            {
                let v = verify_error_to_js(&ssl_error, self.global());
                self.fail_with_js_value(v);
                return;
            }
        }

        self.start();
    }

    fn on_drain(&self) {
        debug!("onDrain");
        let _guard = self.ref_guard();
        self.update_flags(|f| f.remove(ConnectionFlags::HAS_BACKPRESSURE));
        if let Phase::SslRequest { .. } = self.state() {
            return self.request_tls();
        }

        self.drain_internal();
        self.on_copy_drain();
    }

    fn drain_internal(&self) {
        debug!("drainInternal");
        let _entered = self.event_loop().enter_scope();
        let had_requests = self.has_requests();

        self.flush_data();

        if !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            // no backpressure yet so pipeline more if possible and flush again
            self.advance();
            self.flush_data();
        }

        // No reply is coming that would see to these.
        if !self.has_requests() {
            if had_requests {
                self.reset_connection_timeout();
            }
            self.update_poll_ref();
        }
    }

    fn on_data(&self, data: &[u8]) {
        let _guard = self.ref_guard();
        // A server answers a CancelRequest by hanging up. This one is not to be talked to.
        if let Phase::CancelSent = self.state() {
            self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed);
            return;
        }
        SocketMonitor::read(data);
        if self.defer_reads.get() {
            bun_core::handle_oom(self.read_buffer.with_mut(|buffer| buffer.write(data)));
            return;
        }
        self.update_flags(|f| f.insert(ConnectionFlags::IS_PROCESSING_DATA));

        let entered = self.event_loop().enter_scope();

        let mut result = self.parse(data);
        while let Ok(Some(pending)) = result {
            run_callback(self.global(), pending.callback, &pending.arguments);
            result = self.parse(b"");
        }
        if let Err(err) = result
            && err != AnyPostgresError::ShortRead
        {
            self.fail(b"Failed to read data", err);
        }

        self.stop_cancelled_head();
        self.flush_copy_out();
        self.notify_connected();
        drop(entered);
        self.update_poll_ref();
        self.update_flags(|f| f.remove(ConnectionFlags::IS_PROCESSING_DATA));

        if self.is_ready() {
            self.reset_connection_timeout();
        }
    }

    /// Handles what is buffered, then `data`, up to a notification. The rest is in `read_buffer`.
    fn parse(&self, mut data: &[u8]) -> Result<Option<PendingNotification>, AnyPostgresError> {
        let mut buffer = self.read_buffer.take();
        let result = loop {
            let cursor = Cell::new(0usize);
            let message_start = Cell::new(0usize);
            let result;
            if buffer.remaining().is_empty() {
                let reader = protocol::NewReader::new(data, &cursor, &message_start);
                result = self.read_messages(&reader);
                if let Ok(Some(_)) | Err(AnyPostgresError::ShortRead) = result {
                    bun_core::handle_oom(buffer.write(&data[message_start.get()..]));
                }
            } else {
                bun_core::handle_oom(buffer.write(data));
                let reader = protocol::NewReader::new(buffer.remaining(), &cursor, &message_start);
                result = self.read_messages(&reader);
                buffer.consume(message_start.get());
            }
            let read_meanwhile = self.read_buffer.take();
            bun_core::handle_oom(buffer.write(read_meanwhile.remaining()));
            if read_meanwhile.is_empty() || !matches!(result, Err(AnyPostgresError::ShortRead)) {
                break result;
            }
            data = b"";
        };
        self.read_buffer.set(buffer);
        self.defer_reads.set(false);
        result
    }
}

pub(crate) fn create_connection<'a>(
    cx: &mut JsScope<'a>,
    hostname: &[u8],
    port: f64,
    username: &[u8],
    password: &[u8],
    database: &[u8],
    ssl_mode: u8,
    tls: JsLocal<'a>,
    query: &[u8],
    path: &[u8],
    on_connected: JsLocal<'a, Callable>,
    on_disconnected: JsLocal<'a, Callable>,
    idle_timeout: f64,
    connection_timeout: f64,
    max_lifetime: f64,
    use_unnamed_prepared_statements: bool,
    _: JsLocal<'a>,
    on_retire: Option<JsLocal<'a, Callable>>,
    _: JsLocal<'a>,
    channel_binding: u8,
    column_transform: Option<JsLocal<'a, Callable>>,
    scram_password: &[u8],
) -> JsResult<JSValue> {
    let global_object = cx.global();
    let vm = global_object.bun_vm();
    let port = port as i32;
    // The connection is the calling script's.
    let context = global_object.bun_vm().context_of_caller();
    let Some(args) = ConnectionCtorArgs::parse(
        global_object,
        hostname,
        ssl_mode,
        tls.to_js(),
        idle_timeout,
        connection_timeout,
        max_lifetime,
    )?
    else {
        return Ok(JSValue::ZERO);
    };
    let (secure, tls_config) = (args.secure, args.tls_config);
    // Next to `rejectUnauthorized: false` it is not asked, as in Node.
    let check_server_identity = server_identity::callback_of(global_object, tls.to_js())?
        .filter(|_| verifies_certificate(&tls_config, args.ssl_mode));

    // Reject null bytes in connection parameters to prevent Postgres startup
    // message parameter injection (null bytes act as field terminators in the
    // wire protocol's key\0value\0 format).
    for (entry, name) in [
        (username, &b"username"[..]),
        (password, b"password"),
        (database, b"database"),
        (path, b"path"),
    ] {
        if !entry.is_empty() && strings::contains_char(entry, 0) {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "{} must not contain null bytes",
                bstr::BStr::new(name)
            )));
        }
    }

    open(
        global_object,
        vm.postgres_socket_group::<false>(context),
        ConnectParams {
            hostname,
            port,
            strings: ConnectionStrings::new(
                username,
                password,
                scram_password,
                database,
                query,
                path,
            ),
            secure,
            tls_config: Rc::new(tls_config),
            ssl_mode: args.ssl_mode,
            channel_binding: ChannelBinding::ALL[usize::from(channel_binding)],
            idle_timeout_ms: args.idle_timeout_ms,
            connection_timeout_ms: args.connection_timeout_ms,
            max_lifetime_ms: args.max_lifetime_ms,
            use_unnamed_prepared_statements,
            on_connect: on_connected.to_js(),
            on_close: on_disconnected.to_js(),
            on_retire: on_retire.map(JsLocal::to_js),
            column_transform: column_transform.map(JsLocal::to_js),
            check_server_identity,
            cancel: None,
        },
    )
    .map_err(|_| {
        let mut message: Vec<u8> = Vec::new();
        use std::io::Write as _;
        let _ = if path.is_empty() {
            write!(
                &mut message,
                "Failed to connect to {}:{}",
                bstr::BStr::new(hostname),
                port
            )
        } else {
            write!(
                &mut message,
                "Failed to connect to {}",
                bstr::BStr::new(path)
            )
        };
        global_object.throw_value(postgres_error_to_js(
            global_object,
            Some(&message),
            AnyPostgresError::ConnectionRefused,
        ))
    })
}

struct ConnectParams<'a> {
    /// Dialed when the path of `strings` is empty.
    hostname: &'a [u8],
    port: i32,
    strings: ConnectionStrings,
    secure: Option<OwnedSslCtx>,
    tls_config: Rc<SSLConfig>,
    ssl_mode: SSLMode,
    channel_binding: ChannelBinding,
    idle_timeout_ms: u32,
    connection_timeout_ms: u32,
    max_lifetime_ms: u32,
    use_unnamed_prepared_statements: bool,
    on_connect: JSValue,
    on_close: JSValue,
    on_retire: Option<JSValue>,
    column_transform: Option<JSValue>,
    check_server_identity: Option<JSValue>,
    cancel: Option<Seat>,
}

/// A request in the queue of `session`.
#[derive(Clone)]
pub(crate) struct Seat {
    session: RefPtr<PostgresSQLConnection>,
    turn: Turn,
}

impl Seat {
    pub(crate) fn cancel(&self) {
        self.session.cancel(self.turn);
    }

    /// `None`: the backend has gone on to another request.
    fn cancel_request(&self) -> Option<[u8; 16]> {
        let session = &*self.session;
        if session.is_ready() && session.pipeline.get().running(self.turn).is_none() {
            return None;
        }
        Some(session.backend_key_data.get()?.cancel_request())
    }
}

fn open(
    global_object: &JSGlobalObject,
    group: &uws::SocketGroup,
    params: ConnectParams<'_>,
) -> Result<JSValue, uws::ConnectError> {
    let carries_cancel_request = params.cancel.is_some();

    let this = RefPtr::new(PostgresSQLConnection {
        socket: JsCell::new(Socket::SocketTcp(uws::SocketTCP {
            socket: uws::InternalSocket::Detached,
        })),
        ref_count: Cell::new(1),
        handshake: JsCell::new(Handshake::new(
            params.strings,
            params.ssl_mode,
            params.channel_binding,
        )),
        pipeline: JsCell::new(Pipeline::new(
            !params.use_unnamed_prepared_statements
                && BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING.get() != Some(true),
        )),
        write_buffer: JsCell::new(OffsetByteList::default()),
        read_buffer: JsCell::new(OffsetByteList::default()),
        defer_reads: Cell::new(false),
        writer: Cell::new(Writer::Idle),
        poll_ref: KeepAlive::default(),
        global_object: BackRef::new(global_object),
        vm: BackRef::new(VirtualMachine::get()),
        statements: JsCell::new(StatementCache::default()),
        js_value: JsCell::new(crate::jsc::JsRef::empty()),
        backend_key_data: Cell::new(None),
        cancel_target: JsCell::new(params.cancel),
        secure: params.secure,
        tls_config: params.tls_config,
        flags: Cell::new(if params.use_unnamed_prepared_statements {
            ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS
        } else {
            ConnectionFlags::empty()
        }),
        timers: ConnectionTimers::new(
            params.idle_timeout_ms,
            params.connection_timeout_ms,
            params.max_lifetime_ms,
            EventLoopTimerTag::PostgresSQLConnectionTimeout,
            EventLoopTimerTag::PostgresSQLConnectionMaxLifetime,
        ),
        auto_flush_registered: Cell::new(false),
        channel_names: JsCell::new(Vec::new()),
        copy_out: JsCell::new(Vec::new()),
    });
    let ptr = this.as_ptr();

    {
        // Postgres always opens plain TCP first (SSLRequest happens in-band),
        // so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()`
        // adopts into `postgres_tls_group` after the server's `S`.
        let path_slice = this.handshake.get().strings.path();
        let result = if !path_slice.is_empty() {
            uws::SocketTCP::connect_unix_group(
                group,
                uws::SocketKind::Postgres,
                None,
                path_slice,
                ptr,
                false,
            )
        } else {
            uws::SocketTCP::connect_group(
                group,
                uws::SocketKind::Postgres,
                None,
                params.hostname,
                params.port,
                ptr,
                false,
            )
        };

        this.socket.set(Socket::SocketTcp(result?));
    }

    // only call toJS if connectUnixAnon does not fail immediately
    this.reset_connection_timeout();
    this.poll_ref.ref_(this.vm_ctx());
    let this = js::wrap(this, global_object);
    let js_value = this.to_js();
    this.js_value
        .set(crate::jsc::JsRef::init_strong(js_value, global_object));
    js::onconnect_set_cached(js_value, global_object, params.on_connect);
    if let Some(column_transform) = params.column_transform {
        js::column_transform_set_cached(js_value, global_object, column_transform);
    }
    js::onclose_set_cached(js_value, global_object, params.on_close);
    if let Some(on_retire) = params.on_retire {
        js::onretire_set_cached(js_value, global_object, on_retire);
    }
    if let Some(callback) = params.check_server_identity {
        js::check_server_identity_set_cached(js_value, global_object, callback);
    }
    if !carries_cancel_request {
        bun_analytics::features::postgres_connections.fetch_add(1, Ordering::Relaxed);
    }
    Ok(js_value)
}

pub struct SocketHandler<const SSL: bool>;

pub type SocketType<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn socket(s: SocketType<SSL>) -> Socket {
        if SSL {
            Socket::SocketTls(uws::SocketTLS { socket: s.socket })
        } else {
            Socket::SocketTcp(uws::SocketTCP { socket: s.socket })
        }
    }

    pub fn on_open(this: &PostgresSQLConnection, socket: SocketType<SSL>) {
        this.on_open(Self::socket(socket));
    }

    fn on_handshake(
        this: &PostgresSQLConnection,
        _: SocketType<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        this.on_handshake(success, ssl_error);
    }

    pub const ON_HANDSHAKE: Option<
        fn(&PostgresSQLConnection, SocketType<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub fn on_close(
        this: &PostgresSQLConnection,
        _socket: SocketType<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        // usockets frees this socket at end-of-tick; drop the stored pointer
        // now so nothing (timer callbacks, ref()) dereferences it
        // after the free.
        this.socket
            .set(Socket::SocketTcp(uws::SocketTCP::detached()));
        this.on_close();
    }

    pub fn on_end(this: &PostgresSQLConnection, _socket: SocketType<SSL>) {
        this.on_close();
    }

    pub fn on_connect_error(this: &PostgresSQLConnection, _socket: SocketType<SSL>, _: i32) {
        // As in `on_close`.
        this.socket
            .set(Socket::SocketTcp(uws::SocketTCP::detached()));
        this.on_connect_error();
    }

    pub fn on_timeout(_: &PostgresSQLConnection, _: SocketType<SSL>) {}

    pub fn on_data(this: &PostgresSQLConnection, _socket: SocketType<SSL>, data: &[u8]) {
        this.on_data(data);
    }

    pub fn on_writable(this: &PostgresSQLConnection, _socket: SocketType<SSL>) {
        this.on_drain();
    }
}

impl PostgresSQLConnection {
    pub fn r#ref(&self) {
        self.update_flags(|f| f.insert(ConnectionFlags::KEEP_ALIVE_REQUESTED));
        self.poll_ref.ref_(self.vm_ctx());
        self.release_wrapper();
    }

    pub fn flush(&self) {
        self.register_auto_flusher();
    }

    pub fn hold(&self) {
        self.timers.set_checked_out(true);
        if self.is_ready() {
            self.reset_connection_timeout();
        }
    }

    pub fn unhold(&self, _: &mut JsScope<'_>) {
        self.timers.set_checked_out(false);
        if self.is_ready() {
            self.reset_connection_timeout();
        }
        self.retire_if_idle();
    }

    pub fn get_in_transaction(&self) -> bool {
        self.pipeline.get().in_transaction()
    }

    pub fn get_sasl(&self) -> bool {
        self.handshake.get().in_sasl()
    }

    pub fn do_close(&self, _: &mut JsScope<'_>) {
        match self.state() {
            // `on_close` fails it before this returns.
            Phase::Ready { .. } => self.close_socket(),
            Phase::Closed { .. } => {}
            _ => self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed),
        }
        self.unregister_auto_flusher();
        self.abandon_incomplete_request();
        self.write_buffer.with_mut(|b| b.clear_and_free());
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant JS).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    fn close_socket(&self) {
        let socket = *self.socket.get();
        if !socket.is_closed() {
            // event loop need to be alive to close the socket
            self.poll_ref.ref_(self.vm_ctx());
            // will unref on socket close
            socket.close_now();
        }
    }

    pub(crate) fn cancelled_error(&self, hint: Option<&[u8]>) -> JSValue {
        create_postgres_error(
            self.global(),
            b"Query cancelled",
            &PostgresErrorOptions {
                code: b"ERR_POSTGRES_QUERY_CANCELLED",
                hint,
                ..Default::default()
            },
        )
        .unwrap_or_else(|err| self.global().take_error(err))
    }

    fn cancel(&self, turn: Turn) {
        let Some(request) = self.pipeline.with_mut(|it| it.live(turn).cloned()) else {
            return;
        };
        request.cancel_copy();
        match self.pipeline.with_mut(|it| it.cancel(turn)) {
            None => {}
            Some(OnCancel::Unqueued(entry)) => {
                self.end_rejected(entry, Some(self.cancelled_error(None)));
                // What waited behind it may not have to wait any more.
                self.advance();
                self.flush_data_and_reset_timeout();
                self.update_poll_ref();
                self.retire_if_idle();
            }
            Some(OnCancel::InFlight { may_run }) => {
                self.stop_cancelled_head();
                let running = self.pipeline.get().running(turn);
                // The backend answers the request that it is asked to stop with an error.
                if may_run && running.is_some_and(Entry::is_cancelling) {
                    return;
                }
                let hint = may_run.then_some(CANCELLED_ON_THE_WIRE);
                self.reject_in_flight(turn, self.cancelled_error(hint));
            }
        }
    }

    fn stop_cancelled_head(&self) {
        if let Some(head) = self.pipeline.get().to_stop()
            && self.send_cancel_request(head)
        {
            self.pipeline.with_mut(Pipeline::on_cancel_dialed);
        }
    }

    /// A CancelRequest travels on a connection of its own. `false`: there is no way to ask now.
    fn send_cancel_request(&self, turn: Turn) -> bool {
        if self.backend_key_data.get().is_none() {
            return false;
        }
        let handshake = self.handshake.get();
        let socket = self.socket.get();
        let uws::InternalSocket::Connected(raw) = *socket.socket() else {
            return false;
        };

        // The address of the peer: its name can resolve to another server by now.
        let mut hostname = [0u8; 46];
        let mut hostname_len = 0;
        let mut port = 0;
        if handshake.strings.path().is_empty() {
            let mut address = [0u8; 16];
            let (peer, peer_port) = match socket {
                Socket::SocketTcp(tcp) => (tcp.remote_address(&mut address), tcp.remote_port()),
                Socket::SocketTls(tls) => (tls.remote_address(&mut address), tls.remote_port()),
            };
            let (Some(peer), Some(peer_port)) = (peer, peer_port) else {
                return false;
            };
            let ip: std::net::IpAddr = match *peer {
                [a, b, c, d] => std::net::Ipv4Addr::new(a, b, c, d).into(),
                _ => match <[u8; 16]>::try_from(peer) {
                    Ok(v6) => std::net::Ipv6Addr::from(v6).into(),
                    Err(_) => return false,
                },
            };
            use std::io::Write as _;
            let mut unwritten = &mut hostname[..];
            if write!(unwritten, "{ip}").is_err() {
                return false;
            }
            let unwritten = unwritten.len();
            hostname_len = hostname.len() - unwritten;
            port = i32::from(peer_port);
        }

        // SAFETY: `raw` is the live connected socket of this session, in a group of its context.
        let group = unsafe {
            bun_jsc::rare_data::SocketGroups::of((*raw).group())
                .postgres_group::<false>(self.vm().uws_loop())
        };
        open(
            self.global(),
            group,
            ConnectParams {
                hostname: &hostname[..hostname_len],
                port,
                strings: ConnectionStrings::new(b"", b"", b"", b"", b"", handshake.strings.path()),
                secure: self.secure.clone(),
                tls_config: Rc::clone(&self.tls_config),
                // Encrypted exactly when this session is, whatever `prefer` would allow.
                ssl_mode: match (socket, handshake.ssl_mode) {
                    (Socket::SocketTcp(_), _) => SSLMode::Disable,
                    (Socket::SocketTls(_), SSLMode::Prefer) => SSLMode::Require,
                    (Socket::SocketTls(_), mode) => mode,
                },
                channel_binding: handshake.channel_binding,
                idle_timeout_ms: 0,
                connection_timeout_ms: match self.timers.connection_timeout_ms {
                    0 => CANCEL_REQUEST_TIMEOUT_MS,
                    session => session.min(CANCEL_REQUEST_TIMEOUT_MS),
                },
                max_lifetime_ms: 0,
                use_unnamed_prepared_statements: false,
                on_connect: JSValue::ZERO,
                on_close: JSValue::ZERO,
                on_retire: None,
                column_transform: None,
                check_server_identity: self.check_server_identity_callback(),
                cancel: Some(Seat {
                    session: self.ref_guard(),
                    turn,
                }),
            },
        )
        .is_ok()
    }

    /// `asked`: the CancelRequest for `turn` went out, and the server has dealt with it.
    fn on_cancel_connection_closed(&self, turn: Turn, asked: bool) {
        self.pipeline.with_mut(Pipeline::on_cancel_ended);
        if !self.is_ready() {
            return;
        }
        if !asked && self.pipeline.get().running(turn).is_some() {
            self.reject_in_flight(turn, self.cancelled_error(Some(CANCELLED_ON_THE_WIRE)));
        }
        self.stop_cancelled_head();
        self.drain_internal();
        self.reset_connection_timeout();
        self.update_poll_ref();
        self.retire_if_idle();
    }

    /// What a request rejects with for a row the client cannot decode. `Err`: the VM is stopping.
    fn undecodable_row_error(&self, err: AnyPostgresError) -> Result<JSValue, AnyPostgresError> {
        if self.global().has_pending_termination_exception() {
            return Err(err);
        }
        Ok(postgres_error_to_js_with_hint(
            self.global(),
            Some(b"Failed to read data"),
            Some(b"The query may have run on the server. The client could not decode a value in its result. Cast that column to text, or use .raw()."),
            err,
        ))
    }

    pub(crate) fn enqueue(
        &self,
        request: &PostgresSQLQuery,
        types: &[Option<Int4>],
        protocol: Protocol,
    ) -> Seat {
        let statement = match protocol {
            Protocol::Extended { .. } if self.names_statements() => self
                .statements
                .with_mut(|cache| cache.get_or_add(request.query.to_utf8().slice(), types)),
            _ => PostgresSQLStatement::new(None, declared(types), JsCell::default()),
        };
        let request = request.ref_guard();
        Seat {
            session: self.ref_guard(),
            turn: (self.pipeline).with_mut(|it| it.push(request, statement, protocol)),
        }
    }

    fn reject_in_flight(&self, turn: Turn, error: JSValue) {
        if let Some(request) = self.pipeline.with_mut(|it| it.reject(turn).cloned()) {
            request.reject(error, self.global());
        }
    }

    /// The error that the server ended it with comes before `error`.
    fn end_rejected(&self, entry: Entry, error: Option<JSValue>) {
        let kept = entry.keeps_error().then(|| entry.request.kept_error());
        let request = entry.into_request();
        request.leave_queue();
        if let Some(error) = kept.flatten().or(error) {
            request.reject(error, self.global());
        }
    }

    fn reject_unwritten(&self, turn: Turn, error: Option<JSValue>) {
        if let Some(entry) = self.pipeline.with_mut(|it| it.unqueue(turn)) {
            self.end_rejected(entry, error);
        }
    }

    /// A message that was not written to its end is in the buffer: the stream cannot go on.
    fn fail_write(&self, err: AnyPostgresError) -> bool {
        self.fail(b"Failed to write query", err);
        false
    }

    /// `false`: user code ran, or threw and the request is rejected. What was read before is stale.
    fn stage(
        &self,
        request: &PostgresSQLQuery,
        turn: Turn,
        values: JSValue,
        statement: &PostgresSQLStatement,
    ) -> bool {
        if request.staged.replace(true) {
            return true;
        }
        // That code can wait for the reply to a request that is still in the write buffer.
        self.register_auto_flusher();
        match PostgresRequest::stage_parameters(self.global(), values, statement) {
            Ok(replaced) => !replaced,
            Err(err) => {
                let error = self.global().take_exception(err);
                self.reject_unwritten(turn, Some(error));
                false
            }
        }
    }

    /// The only place that writes a request.
    pub(crate) fn advance(&self) {
        let Writer::Idle = self.writer.get() else {
            return;
        };
        self.writer.set(Writer::Advancing);
        while self.is_ready()
            && !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
            && self.write_next()
        {}
        if let Writer::Advancing = self.writer.get() {
            self.writer.set(Writer::Idle);
        }
    }

    /// `false`: the first unwritten request has to wait.
    fn write_next(&self) -> bool {
        let buffered = self.write_buffer.get().len();
        let Some((next, step)) = self.pipeline.get().next(buffered) else {
            return false;
        };
        // User code can end the request while its parameters are converted.
        let (request, statement) = (next.request.clone(), next.statement.clone());
        let turn = next.turn();
        let (Some(step), Some(this_value)) = (step, request.this_value.get().try_get()) else {
            debug_assert!(step.is_none(), "a live request has a wrapper");
            let failure = statement.failure().map(|it| it.to_js(self.global()));
            self.reject_unwritten(turn, failure);
            return true;
        };
        let values = postgres_sql_query::js::binding_get_cached(this_value).unwrap_or_default();
        if let Step::Bind | Step::Parse { bind: true, .. } = step
            && !self.stage(&request, turn, values, &statement)
        {
            return true;
        }

        if let Step::Parse { .. } = step {
            // The Sync that follows the Parse covers the Close.
            while let Some(evicted) = self.statements.with_mut(StatementCache::evict) {
                let _ = self.write(|out| frontend::close_statement(out, &evicted.name));
            }
        }
        let start = self.write(|out| out.len());
        self.writer.set(Writer::Encoding { start });
        match self.encode(&request, &statement, values, step) {
            Ok(()) => {
                self.writer.set(Writer::Advancing);
                if !self.pipeline.with_mut(|it| it.wrote(turn, step)) {
                    self.write(|out| out.truncate(start));
                }
                true
            }
            Err(err @ AnyPostgresError::ConnectionClosed) => {
                if !self.pipeline.get().has_written() {
                    self.fail(b"Connection closed", err);
                }
                false
            }
            Err(err) => self.fail_write(err),
        }
    }

    fn encode(
        &self,
        request: &PostgresSQLQuery,
        statement: &PostgresSQLStatement,
        values: JSValue,
        step: Step,
    ) -> Result<(), AnyPostgresError> {
        debug!(
            "write {}: {}",
            bstr::BStr::new(&statement.name),
            request.query
        );
        let parse = |out: &mut Vec<u8>| {
            let query = request.query.to_utf8();
            frontend::parse(out, &statement.name, query.slice(), &statement.declared)
        };
        let formats = match step {
            // Alone: a Sync elicits a second ReadyForQuery, a Flush stops the server's idle timers.
            Step::Query => {
                return self.write(|out| frontend::query(out, request.query.to_utf8().slice()));
            }
            Step::Parse { close, bind } => {
                self.write(|out| {
                    if close {
                        frontend::close_statement(out, &statement.name)?;
                    }
                    parse(out)?;
                    frontend::describe_statement(out, &statement.name)
                })?;
                if !bind {
                    self.write(|out| out.extend_from_slice(&frontend::SYNC));
                    return Ok(());
                }
                ResultFormats::Text
            }
            // PgBouncer in transaction mode may give this batch to another backend.
            Step::Bind if !statement.is_named() => {
                self.write(parse)?;
                ResultFormats::Text
            }
            // A statement without parameters is prepared before its RowDescription arrives.
            Step::Bind if statement.columns.get().fields.is_empty() => ResultFormats::Text,
            Step::Bind => match request.result_mode.get() {
                SQLQueryResultMode::Raw => ResultFormats::Raw,
                _ => ResultFormats::Decodable,
            },
        };
        request.formats.set(formats);
        PostgresRequest::bind_and_execute(self, self.global(), statement, values, formats)
    }

    /// Stops after a notification: a listener can run the event loop, which reuses the receive buffer.
    fn read_messages(
        &self,
        reader: &protocol::NewReader<'_>,
    ) -> Result<Option<PendingNotification>, AnyPostgresError> {
        if let Phase::SslRequest { .. } = self.state() {
            // The one byte without a frame. What follows it is not a reply to anything, and is dropped.
            let reply = reader.int::<u8>()?;
            match self.handshake.with_mut(|it| it.on_ssl_reply(reply)) {
                Ok(true) => self.setup_tls(),
                Ok(false) => self.start(),
                Err(refusal) => self.refuse(&refusal),
            }
            return Ok(None);
        }
        // A handler can `fail()` and user code can close: the rest of the read is dropped.
        while !self.is_closed() {
            reader.mark_message_start();
            let c = reader.int::<u8>()?;
            debug!("read: {}", c as char);

            let (before, length) = reader.peek_length()?;
            let after = before - length;
            // The column transform can run the event loop; rows must wait for it.
            self.defer_reads.set(after != 0 || c == b'T');

            if c != b'A' {
                self.on_message(c, reader)?;
            } else {
                let notification = protocol::NotificationResponse::decode_internal(reader)?;
                if reader.peek().len() == after
                    && let Some(pending) = self.prepare_notification(&notification)?
                {
                    reader.mark_message_start();
                    return Ok(Some(pending));
                }
            }

            // libpq: "message contents do not agree with length in message".
            if reader.peek().len() != after && !self.is_closed() {
                debug!(
                    "'{}' of length {} left {} of {}",
                    c as char,
                    length,
                    reader.peek().len(),
                    after
                );
                return Err(AnyPostgresError::InvalidMessage);
            }
        }
        Ok(None)
    }

    #[inline]
    fn on_message(&self, c: u8, reader: &protocol::NewReader<'_>) -> Result<(), AnyPostgresError> {
        match c {
            b'D' => self.on_data_row(reader)?,
            b'd' => {
                let upcoming = reader.peek().len();
                self.on_copy_data(reader.body()?, upcoming);
            }
            b'S' => {
                protocol::ParameterStatus::decode_internal(reader)?;
            }
            b'Z' => self.on_ready_for_query(reader)?,
            b'C' => {
                let Some((request, statement, turn)) = self.executed()? else {
                    return reader.skip_message();
                };
                let cmd = protocol::CommandComplete::decode_internal(reader)?;
                self.on_result(&request, &statement, turn, cmd.command_tag)?;
            }
            b'I' => {
                reader.eat_message(&protocol::EMPTY_QUERY_RESPONSE)?;
                if let Some((request, statement, turn)) = self.executed()? {
                    self.on_result(&request, &statement, turn, b"")?;
                }
            }
            b'1' => {
                reader.eat_message(&protocol::PARSE_COMPLETE)?;
                self.pipeline.with_mut(Pipeline::on_parse_complete)?;
            }
            b'2' => {
                reader.eat_message(&protocol::BIND_COMPLETE)?;
                self.pipeline.with_mut(Pipeline::on_bind_complete)?;
            }
            b'n' => {
                reader.eat_message(&protocol::NO_DATA)?;
                self.pipeline.with_mut(Pipeline::on_bind_complete)?;
            }
            b'3' => reader.eat_message(&protocol::CLOSE_COMPLETE)?,
            b't' => {
                let types = protocol::ParameterDescription::decode_internal(reader)?.parameters;
                self.pipeline
                    .with_mut(|it| it.on_parameter_description(types))?;
            }
            b'T' => self.on_row_description(reader)?,
            b'R' => {
                let body = reader.body()?;
                let tls = match self.socket.get() {
                    Socket::SocketTls(tls) => tls.ssl_mut(),
                    Socket::SocketTcp(_) => None,
                };
                let replied = self.write(|out| {
                    self.handshake
                        .with_mut(|it| it.authenticate(body, tls, out))
                });
                match replied {
                    Ok(true) => self.flush_data(),
                    Ok(false) => {}
                    Err(refusal) => self.refuse(&refusal),
                }
            }
            b'K' => self
                .backend_key_data
                .set(Some(protocol::BackendKeyData::decode_internal(reader)?)),
            b'E' => self.on_error_response(protocol::ErrorResponse::decode_internal(reader)?),
            b'N' => {
                protocol::NoticeResponse::decode_internal(reader)?;
            }
            b'G' | b'H' => {
                reader.skip_message()?;
                self.on_copy_response(c == b'G')?;
            }
            b'c' => {
                reader.skip_message()?;
                self.on_copy_done();
            }
            b'W' => self.fail(
                b"Streaming replication is not supported",
                AnyPostgresError::CopyNotSupported,
            ),
            _ => reader.skip_message()?,
        }
        Ok(())
    }

    /// Without a lifetime, so that the queue can change while the caller holds them.
    fn executed(
        &self,
    ) -> Result<
        Option<(
            ParentRef<PostgresSQLQuery>,
            ParentRef<PostgresSQLStatement>,
            Turn,
        )>,
        AnyPostgresError,
    > {
        Ok(self.pipeline.get().executed()?.map(|head| {
            (
                ParentRef::from(head.request.as_non_null()),
                ParentRef::from(head.statement.as_non_null()),
                head.turn(),
            )
        }))
    }

    fn on_data_row(&self, reader: &protocol::NewReader<'_>) -> Result<(), AnyPostgresError> {
        let Some((request, statement, turn)) = self.executed()? else {
            return reader.skip_message();
        };
        let global = self.global();
        let result_mode = request.result_mode.get();
        let objects = match result_mode {
            SQLQueryResultMode::Objects => true,
            SQLQueryResultMode::Raw | SQLQueryResultMode::Values => false,
        };
        if objects {
            let owner = self.js_value.get().try_get().unwrap_or_default();
            statement
                .columns
                .with_mut(|columns| columns.build_structure(owner, global));
        }
        let columns = statement.columns.get();
        let structure = objects.then_some(&columns.structure);

        let mut putter = DataCell::Putter {
            list: SmallVec::new(),
            fields: &columns.fields,
            formats: request.formats.get(),
            bigint: request.bigint,
            global_object: global,
        };
        putter.list.reserve_exact(columns.fields.len());

        // Tells a cell the client cannot decode from a framing error of `decode` itself.
        let mut cell_failed = false;
        let decode_result = if result_mode == SQLQueryResultMode::Raw {
            protocol::DataRow::decode((), reader, |(), i, b| putter.put_raw(i, b))
        } else {
            protocol::DataRow::decode((), reader, |(), i, b| {
                putter.put(i, b).inspect_err(|_| cell_failed = true)
            })
        };
        if let Err(err) = decode_result {
            if !cell_failed {
                return Err(err);
            }
            self.reject_in_flight(turn, self.undecodable_row_error(err)?);
            return Ok(());
        }

        let Some(this_value) = request.this_value.get().try_get() else {
            debug_assert!(false, "query value was freed earlier than expected");
            return Err(AnyPostgresError::ExpectedRequest);
        };
        let pending_value =
            postgres_sql_query::js::pending_value_get_cached(this_value).unwrap_or_default();
        pending_value.ensure_still_alive();
        match putter.to_js(
            pending_value,
            structure
                .and_then(|structure| structure.js_value())
                .unwrap_or(JSValue::UNDEFINED),
            columns.flags,
            result_mode,
            structure,
        ) {
            Ok(result) if pending_value.is_empty() => {
                postgres_sql_query::js::pending_value_set_cached(this_value, global, result)
            }
            Ok(_) => {}
            Err(err) => self.reject_in_flight(turn, self.undecodable_row_error(err)?),
        }
        Ok(())
    }

    fn on_result(
        &self,
        request: &PostgresSQLQuery,
        statement: &PostgresSQLStatement,
        turn: Turn,
        tag: &[u8],
    ) -> Result<(), AnyPostgresError> {
        self.pipeline.with_mut(Pipeline::on_result)?;
        if let Err(err) = request.on_result(tag, self.global(), Some(statement)) {
            self.reject_in_flight(turn, self.global().take_exception(err));
        }
        Ok(())
    }

    fn on_ready_for_query(&self, reader: &protocol::NewReader<'_>) -> Result<(), AnyPostgresError> {
        let status = protocol::ReadyForQuery::decode_internal(reader)?.transaction_status;
        if self.handshake.with_mut(Handshake::on_ready_for_query)? {
            self.poll_ref.unref(self.vm_ctx());
        }
        match self.pipeline.with_mut(|it| it.on_ready_for_query(status)) {
            Some(entry) if entry.is_rejected() => self.end_rejected(entry, None),
            Some(entry) => {
                let request = &entry.request;
                request.leave_queue();
                if let Err(err) = request.on_result(b"", self.global(), None) {
                    request.reject(self.global().take_exception(err), self.global());
                }
            }
            None => {}
        }
        self.advance();
        self.retire_if_idle();
        self.register_auto_flusher();
        Ok(())
    }

    fn on_row_description(&self, reader: &protocol::NewReader<'_>) -> Result<(), AnyPostgresError> {
        use crate::shared::cached_structure::{column_name_to_js, transform_name};
        let mut fields = protocol::RowDescription::decode_internal(reader)?.fields;
        self.pipeline.with_mut(Pipeline::on_row_description)?;
        let head = self.pipeline.get().head()?;
        // The transform threw at an earlier result of this simple query.
        if head.statement.failure().is_some() {
            return Ok(());
        }
        let statement = head.statement.clone();
        if let Some(transform) = self
            .js_value
            .get()
            .try_get()
            .and_then(js::column_transform_get_cached)
        {
            // User code: it can close the connection or start a query.
            let turn = head.turn();
            let global = self.global();
            for field in fields.iter_mut() {
                match column_name_to_js(global, &field.name_or_index)
                    .and_then(|name| transform_name(global, transform, name))
                {
                    Ok(renamed) => field.name_or_index = renamed,
                    Err(e @ jsc::JsError::Thrown) => {
                        let err = global.take_exception(e);
                        statement.fail(StatementError::Thrown(Strong::create(err, global)));
                        self.statements.with_mut(|cache| cache.discard(&statement));
                        self.reject_in_flight(turn, err);
                        return Ok(());
                    }
                    Err(e) => return Err(jsc::js_error_to_postgres(e)),
                }
                if !self.is_ready() {
                    return Ok(());
                }
            }
        }
        statement.columns.set(Columns {
            fields: fields.into_vec(),
            ..Default::default()
        });
        Ok(())
    }

    fn on_error_response(&self, err: protocol::ErrorResponse) {
        let global = self.global();
        let js_err = error_response_jsc::to_js(&err, global);
        if !self.is_ready() || err.is_fatal() {
            return self.fail_with_js_value(js_err);
        }
        let (kind, err) = (err.kind(), StatementError::Protocol(err));
        let replace = |head: &Entry| {
            let query = head.request.query.to_utf8();
            self.statements
                .with_mut(|cache| cache.replace(query.slice(), &head.statement))
        };
        let Some((request, statement, turn, outcome)) = self.pipeline.with_mut(|it| {
            let (head, outcome) = it.on_error(kind, err, replace)?;
            Some((
                head.request.clone(),
                head.statement.clone(),
                head.turn(),
                outcome,
            ))
        }) else {
            return self.fail_with_js_value(js_err);
        };
        match outcome {
            OnError::Retry { cancelled: false } => {}
            OnError::Retry { cancelled: true } => {
                self.reject_in_flight(turn, self.cancelled_error(None))
            }
            OnError::Fail { keep_error, cached } => {
                self.statements.with_mut(|cache| match cached {
                    Cached::Keep => {}
                    Cached::Forget => cache.remove(&statement),
                    Cached::Close => cache.discard(&statement),
                });
                if keep_error {
                    request.keep_error(js_err, global);
                }
            }
        }
    }

    const MAX_INTERNED_CHANNELS: usize = 256;

    fn channel_name_js(
        &self,
        global: &JSGlobalObject,
        channel: &[u8],
    ) -> Result<JSValue, AnyPostgresError> {
        if let Some(entry) = self
            .channel_names
            .get()
            .iter()
            .find(|entry| entry.bytes.as_ref() == channel)
        {
            return Ok(entry.js.get());
        }
        let js = bun_string_jsc::create_utf8_for_js(global, channel)
            .map_err(crate::jsc::js_error_to_postgres)?;
        if self.channel_names.get().len() < Self::MAX_INTERNED_CHANNELS {
            self.channel_names.with_mut(|names| {
                names.push(InternedChannel {
                    bytes: channel.into(),
                    js: Strong::create(js, global),
                })
            });
        }
        Ok(js)
    }

    /// A conversion the VM cut short (OOM, a worker's termination) is this connection's
    /// failure like any other in [`Self::on_data`]: `JSError` takes the pending exception.
    fn prepare_notification(
        &self,
        notification: &protocol::NotificationResponse<'_>,
    ) -> Result<Option<PendingNotification>, AnyPostgresError> {
        let Some(this_value) = self.js_value.get().try_get() else {
            return Ok(None);
        };
        let Some(callback) = js::onnotification_get_cached(this_value) else {
            return Ok(None);
        };
        let global = self.global();
        let channel_js = self.channel_name_js(global, notification.channel)?;
        let payload_js = bun_string_jsc::create_utf8_for_js(global, notification.payload)
            .map_err(crate::jsc::js_error_to_postgres)?;
        Ok(Some(PendingNotification {
            callback,
            arguments: [channel_js, payload_js],
        }))
    }
}
