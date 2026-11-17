use core::cell::Cell;
use core::ffi::c_void;

use bun_jsc::bindgen::{Callable, JsLocal, JsScope};

use crate::generated_bindgen::js_my_sql_connection::js_MySQLConnection as js;
use crate::jsc::api::server_config::SSLConfig;
use crate::jsc::{
    AutoFlush, EventLoopTimerTag, GlobalRef, JSGlobalObject, JSValue, JsCell, JsRef, JsResult,
    VirtualMachine, VirtualMachineSqlExt as _, run_callback,
};
use crate::shared::cached_structure::{column_name_to_js, transform_name};
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use crate::shared::connection_timers::{ConnectionTimers, Phase, TimedConnection};
use crate::shared::server_identity;
use crate::shared::sql_data_cell::SQLDataCell;
use crate::shared::start_tls::{StartTlsError, start_tls, verifies_certificate};
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::OffsetByteList;
use bun_core::fmt::ConnTimeoutKind;
use bun_core::strings;
use bun_jsc::rare_data::SocketGroups;
use bun_ptr::{AsCtxPtr, BackRef, RefPtr};
use bun_sql::mysql::auth_method::Transport;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLErrorT;
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::packet_reader::PacketReader;
use bun_sql::mysql::session::{Command, Event, Failure, Login, Packet, ReplyEvent, Session, State};
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::SSLMode;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_my_sql_query::JSMySQLQuery;
use super::my_sql_request_queue::MySQLRequestQueue;
use super::my_sql_statement::{MySQLStatement, StatementCache};
use super::my_sql_value::Value;
use super::protocol::result_set::{self as ResultSet};
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;

bun_core::declare_scope!(MySQLConnection, visible);

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

// JS can re-enter any method, so they all take `&self` and the fields are cells.
/// `MySQLConnection`, declared in `JSMySQLConnection.bind.ts`.
#[derive(bun_ptr::CellRefCounted)]
pub struct JSMySQLConnection {
    ref_count: Cell<u32>,
    js_value: JsCell<JsRef>,
    global_object: GlobalRef,
    vm: BackRef<VirtualMachine>,
    poll_ref: bun_io::JsKeepAlive,
    /// Held from the socket's open to its close.
    socket_ref: Cell<Option<RefPtr<Self>>>,

    socket: Cell<AnySocket>,
    secure: Option<OwnedSslCtx>,
    tls_config: SSLConfig,

    session: JsCell<Session>,
    queue: MySQLRequestQueue,
    statements: JsCell<StatementCache>,

    write_buffer: JsCell<OffsetByteList>,
    has_backpressure: Cell<bool>,
    read_buffer: JsCell<OffsetByteList>,
    reading: Cell<Reading>,
    /// The handshake finished during this read; `onconnect` runs at the end of it.
    on_connect_pending: Cell<bool>,

    auto_flush_registered: Cell<bool>,
    timers: ConnectionTimers,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Reading {
    Idle,
    LastPacket,
    /// A read from a nested event loop tick only appends to `read_buffer`.
    Deferring,
}

bun_event_loop::impl_timer_owner!(JSMySQLConnection;
    from_timer_ptr => timers.timer,
    from_max_lifetime_timer_ptr => timers.max_lifetime_timer,
);

impl Drop for JSMySQLConnection {
    fn drop(&mut self) {
        self.unregister_auto_flusher();
    }
}

impl JSMySQLConnection {
    /// verify-full's name check, asked inside the handshake.
    pub fn server_identity(
        &self,
        ssl: &mut bun_boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        bun_boringssl::server_identity(ssl, self.native_identity_hostname())
    }

    /// The name verify-full matches, unless `tls.checkServerIdentity` does. Empty matches no certificate.
    fn native_identity_hostname(&self) -> Option<&[u8]> {
        (self.tls_config.reject_unauthorized() != 0
            && self.session.get().ssl_mode() == SSLMode::VerifyFull
            && self.check_server_identity_callback().is_none())
        .then(|| self.tls_config.server_name_bytes())
    }

    fn verifies_certificate(&self) -> bool {
        verifies_certificate(&self.tls_config, self.session.get().ssl_mode())
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    #[inline]
    fn event_loop(&self) -> &'static crate::jsc::EventLoop {
        VirtualMachine::get().event_loop()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
}

impl TimedConnection for JSMySQLConnection {
    fn timers(&self) -> &ConnectionTimers {
        &self.timers
    }

    fn phase(&self) -> Phase {
        match self.session.get().state() {
            State::Ready(_) => Phase::Connected,
            State::Failed => Phase::Failed,
            State::Dial => Phase::Connecting(""),
            State::Greeting
            | State::TlsHandshake(_)
            | State::IdentityCheck(_)
            | State::Verdict(_)
            | State::PublicKey(_) => Phase::Connecting(" (during authentication)"),
            State::SessionSetup => Phase::Connecting(" (during session setup)"),
        }
    }

    fn has_requests(&self) -> bool {
        !self.is_idle()
    }

    fn is_processing_data(&self) -> bool {
        self.reading.get() != Reading::Idle
    }

    fn fail_timeout(&self, kind: ConnTimeoutKind, message: core::fmt::Arguments<'_>) {
        let code = match kind {
            ConnTimeoutKind::Idle => AnyMySQLErrorT::IdleTimeout,
            ConnTimeoutKind::Connection => AnyMySQLErrorT::ConnectionTimedOut,
            ConnTimeoutKind::MaxLifetime => AnyMySQLErrorT::LifetimeTimeout,
        };
        self.fail_fmt(code, message);
    }

    fn notify_retiring(&self) {
        let Some(js_value) = self.js_value.get().try_get() else {
            return;
        };
        if let Some(on_retire) = js::onretire_take_cached(js_value, &self.global_object) {
            run_callback(&self.global_object, on_retire, &[]);
        }
    }
}

impl AutoFlush for JSMySQLConnection {
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    fn auto_flush_registered(&self) -> &Cell<bool> {
        &self.auto_flush_registered
    }

    fn can_flush(&self) -> bool {
        !self.has_backpressure.get()
            && self.is_connected()
            && (!self.write_buffer.get().is_empty() || self.queue.is_waiting_to_write())
    }

    fn on_auto_flush(&self) -> bool {
        let _guard = self.ref_guard();
        // With backpressure, onWritable drains.
        if !self.has_backpressure.get() {
            self.drain_internal();
        }
        let again = self.can_flush();
        self.auto_flush_registered.set(again);
        again
    }
}

impl JSMySQLConnection {
    #[inline]
    fn is_connected(&self) -> bool {
        matches!(self.session.get().state(), State::Ready(_))
    }

    /// Connecting or connected: not failed, and not closed.
    #[inline]
    pub(crate) fn is_active(&self) -> bool {
        !matches!(self.session.get().state(), State::Failed)
    }

    fn awaits_tls_handshake(&self) -> bool {
        matches!(self.session.get().state(), State::TlsHandshake(_))
    }

    #[inline]
    fn is_idle(&self) -> bool {
        self.queue.is_empty() && self.write_buffer.get().is_empty()
    }

    #[inline]
    pub(crate) fn is_able_to_write(&self) -> bool {
        self.is_connected()
            && !self.has_backpressure.get()
            && self.write_buffer.get().len() < MAX_PIPELINE_SIZE
    }

    /// Appends to the write buffer.
    #[inline]
    pub(crate) fn write<R>(&self, write: impl FnOnce(&mut Vec<u8>) -> R) -> R {
        self.write_buffer
            .with_mut(|buffer| write(&mut buffer.byte_list))
    }

    fn flush_data(&self) {
        let chunk = self.write_buffer.get().remaining();
        if self.has_backpressure.get() || chunk.is_empty() {
            return;
        }
        let wrote = usize::try_from(self.socket.get().write(chunk)).unwrap_or(0);
        self.has_backpressure.set(wrote < chunk.len());
        bun_core::scoped_log!(MySQLConnection, "wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            SocketMonitor::write(&chunk[..wrote]);
            self.write_buffer.with_mut(|buffer| buffer.consume(wrote));
        }
    }

    fn flush_queue(&self) {
        self.flush_data();
        if self.awaits_tls_handshake() {
            if !self.has_backpressure.get() {
                self.upgrade_to_tls();
            }
            return;
        }
        // Under backpressure too: the next reply is for the request behind the one that just ended.
        self.queue.advance(self);
        self.flush_data();
    }

    fn upgrade_to_tls(&self) {
        let started = start_tls(
            self.as_ctx_ptr(),
            self.socket.get(),
            (uws::SocketKind::MysqlTls, SocketGroups::mysql_group::<true>),
            self.secure.as_ref(),
            &self.tls_config,
            self.session.get().ssl_mode(),
            |socket| self.socket.set(socket),
        );
        // `NotPlain`: the handshake is under way.
        if let Err(StartTlsError::Failed) = started {
            self.on_error(AnyMySQLErrorT::AuthenticationFailed);
        }
    }

    pub(crate) fn enqueue_request(&self, item: RefPtr<JSMySQLQuery>) {
        bun_core::scoped_log!(MySQLConnection, "enqueueRequest");
        let _entered = self.entered_from_js();
        self.queue.add(item);
        self.queue.advance(self);
        self.on_queue_changed();
    }

    /// Keeps a callback's exit from draining microtasks in the middle of the calling JS frame.
    fn entered_from_js(&self) -> bun_jsc::event_loop::EventLoopEnterNoCheckpointGuard<'_> {
        self.vm().enter_event_loop_scope_without_checkpoint()
    }

    fn on_queue_changed(&self) {
        if self.retire_if_idle() {
            return;
        }
        if self.is_connected() {
            self.reset_connection_timeout();
        }
        self.update_reference_type();
        self.register_auto_flusher();
    }

    /// The caller holds a ref.
    fn drain_internal(&self) {
        bun_core::scoped_log!(MySQLConnection, "drainInternal");
        {
            let _loop_guard = self.event_loop().enter_scope();
            self.ensure_js_value_is_alive();
            self.flush_queue();
            self.retire_if_idle();
        }
        self.on_queue_changed();
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.get().try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(&self) {
        bun_core::scoped_log!(MySQLConnection, "finalize");
        self.js_value.with_mut(|r| r.finalize());
    }

    fn update_reference_type(&self) {
        if self.is_active() {
            bun_core::scoped_log!(MySQLConnection, "connection is active");
            if self.js_value.get().is_not_empty() && !self.js_value.get().is_strong() {
                bun_core::scoped_log!(MySQLConnection, "strong ref until connection is closed");
                self.js_value.with_mut(|r| r.upgrade(&self.global_object));
            }
            let ctx = self.vm_ctx();
            if self.is_connected() && self.is_idle() {
                self.poll_ref.unref(ctx);
            } else {
                self.poll_ref.r#ref(ctx);
            }
            return;
        }
        if self.js_value.get().is_not_empty() && self.js_value.get().is_strong() {
            self.js_value.with_mut(|r| r.downgrade());
        }
        let ctx = self.vm_ctx();
        self.poll_ref.unref(ctx);
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
        _: JsLocal<'a>,
        path: &[u8],
        on_connected: JsLocal<'a, Callable>,
        on_disconnected: JsLocal<'a, Callable>,
        idle_timeout: f64,
        connection_timeout: f64,
        max_lifetime: f64,
        _: JsLocal<'a>,
        allow_public_key_retrieval: bool,
        on_retire: Option<JsLocal<'a, Callable>>,
        found_rows: bool,
        _: JsLocal<'a>,
        column_transform: Option<JsLocal<'a, Callable>>,
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
        let check_server_identity = server_identity::callback_of(global_object, tls.to_js())?;

        let username: Box<[u8]> = Box::from(username);
        let password: Box<[u8]> = Box::from(password);
        let database: Box<[u8]> = Box::from(database);
        let path: Box<[u8]> = Box::from(path);

        // Reject null bytes in connection parameters to prevent protocol injection
        // (null bytes act as field terminators in the MySQL wire protocol).
        for (slice, msg) in [
            (&username[..], "username must not contain null bytes"),
            (&password[..], "password must not contain null bytes"),
            (&database[..], "database must not contain null bytes"),
            (&path[..], "path must not contain null bytes"),
        ] {
            if !slice.is_empty() && strings::index_of_char(slice, 0).is_some() {
                return Err(global_object.throw_invalid_arguments(format_args!("{msg}")));
            }
        }

        let this = RefPtr::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsCell::new(JsRef::empty()),
            global_object: GlobalRef::from(global_object),
            vm: BackRef::new(VirtualMachine::get()),
            poll_ref: Default::default(),
            socket: Cell::new(AnySocket::SocketTcp(SocketTCP::detached())),
            secure,
            tls_config,
            session: JsCell::new(Session::new(
                Login {
                    user: username,
                    password,
                    database,
                    ssl_mode: args.ssl_mode,
                    allow_public_key_retrieval,
                    found_rows,
                },
                if path.is_empty() {
                    Transport::Tcp
                } else {
                    Transport::UnixSocket
                },
            )),
            queue: MySQLRequestQueue::init(),
            statements: JsCell::default(),
            write_buffer: JsCell::default(),
            has_backpressure: Cell::new(false),
            read_buffer: JsCell::default(),
            reading: Cell::new(Reading::Idle),
            on_connect_pending: Cell::new(false),
            socket_ref: Cell::new(None),
            auto_flush_registered: Cell::new(false),
            timers: ConnectionTimers::new(
                args.idle_timeout_ms,
                args.connection_timeout_ms,
                args.max_lifetime_ms,
                EventLoopTimerTag::MySQLConnectionTimeout,
                EventLoopTimerTag::MySQLConnectionMaxLifetime,
            ),
        });
        let ptr = this.as_ptr();

        {
            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            let group = vm.mysql_socket_group::<false>(context);
            let result = if !path.is_empty() {
                SocketTCP::connect_unix_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    &path[..],
                    ptr,
                    false,
                )
            } else {
                SocketTCP::connect_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    hostname,
                    port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(_) => {
                    let mut message = b"Failed to connect".to_vec();
                    if !path.is_empty() {
                        message.extend_from_slice(b" to ");
                        message.extend_from_slice(&path);
                    }
                    return Err(global_object.throw_value(mysql_error_to_js(
                        global_object,
                        Some(&message),
                        AnyMySQLErrorT::ConnectionRefused,
                    )));
                }
            };
            this.socket.set(AnySocket::SocketTcp(socket));
        }
        this.reset_connection_timeout();
        this.poll_ref.r#ref(vm.vm_ctx());
        let this = js::wrap(this, global_object);
        let js_value = this.to_js();
        this.js_value
            .with_mut(|r| r.set_strong(js_value, global_object));
        js::onconnect_set_cached(js_value, global_object, on_connected.to_js());
        if let Some(column_transform) = column_transform {
            js::column_transform_set_cached(js_value, global_object, column_transform.to_js());
        }
        js::onclose_set_cached(js_value, global_object, on_disconnected.to_js());
        if let Some(on_retire) = on_retire {
            js::onretire_set_cached(js_value, global_object, on_retire.to_js());
        }
        // Next to `rejectUnauthorized: false` it is not asked, as in Node.
        if let Some(callback) = check_server_identity.filter(|_| this.verifies_certificate()) {
            js::check_server_identity_set_cached(js_value, global_object, callback);
        }

        Ok(js_value)
    }

    pub fn flush(this: &Self) {
        this.register_auto_flusher();
    }

    pub fn close(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed);
    }

    pub fn hold(this: &Self) {
        this.timers.set_checked_out(true);
        this.reset_connection_timeout();
    }

    pub fn unhold(this: &Self, _: &mut JsScope<'_>) {
        let _entered = this.entered_from_js();
        this.timers.set_checked_out(false);
        this.on_queue_changed();
    }

    pub fn get_in_transaction(&self) -> bool {
        self.session.get().is_in_transaction()
    }

    fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.js_value
            .get()
            .try_get()
            .and_then(js::check_server_identity_get_cached)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.get().try_get() {
            return js::onconnect_take_cached(value, global_object);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if let Some(value) = self.js_value.get().try_get() {
            return js::onclose_take_cached(value, global_object);
        }
        None
    }

    #[inline]
    pub(crate) fn cached_statement(
        &self,
        query: &[u8],
        params: &[Value<'_>],
    ) -> Option<RefPtr<MySQLStatement>> {
        self.statements.with_mut(|cache| cache.get(query, params))
    }

    pub(crate) fn prepare_statement(
        &self,
        query: &[u8],
        params: &[Value<'_>],
    ) -> RefPtr<MySQLStatement> {
        let (statement, evicted) = self.statements.with_mut(|cache| {
            let statement = cache.insert(query, params);
            (statement, cache.evict(StatementCache::MAX_STATEMENTS))
        });
        self.write(|out| {
            if let Some(evicted) = evicted {
                mysql_request::close_statement(evicted.wire.get().id, out);
            }
            mysql_request::prepare_request(query, out);
        });
        statement
    }

    /// Without a COM_QUIT the server counts an aborted client.
    fn quit(&self) {
        if self.is_able_to_write()
            && self.write_buffer.get().is_empty()
            && !self.queue.is_head_in_flight()
        {
            self.write(mysql_request::quit);
            self.flush_data();
        }
    }

    fn fail_fmt(&self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = mysql_error_to_js(&self.global_object, Some(&message), error_code);
        self.fail_with_js_value(err);
    }

    /// In this order: the socket closes, `onclose` tells the pool, the requests are rejected.
    fn fail_with_js_value(&self, value: JSValue) {
        if !self.is_active() {
            return;
        }
        let _guard = self.ref_guard();
        self.timers.stop();
        self.quit();
        self.session.with_mut(Session::fail);
        // Raises the socket's close event, which comes back here.
        self.socket.get().close_now();
        self.write_buffer.set(OffsetByteList::default());

        if let Some(on_close) = self.consume_on_close_callback(&self.global_object) {
            on_close.ensure_still_alive();
            self.ensure_js_value_is_alive();
            let mut js_error = value.to_error().unwrap_or(value);
            if js_error.is_empty() {
                js_error = mysql_error_to_js(
                    &self.global_object,
                    Some(b"Connection closed"),
                    AnyMySQLErrorT::ConnectionClosed,
                );
            }
            js_error.ensure_still_alive();

            run_callback(&self.global_object, on_close, &[js_error]);
        }

        self.queue.clean(value);
        self.update_reference_type();
    }

    fn fail(&self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = mysql_error_to_js(&self.global_object, Some(message), err);
        self.fail_with_js_value(instance);
    }

    /// Outside the packet parser, and synchronous like `onclose` so that the two keep their order.
    fn notify_connected(&self) {
        if !self.on_connect_pending.take() || !self.is_connected() {
            return;
        }
        self.start_max_lifetime_timer();
        let Some(on_connect) = self.consume_on_connect_callback(&self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.get().try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        run_callback(&self.global_object, on_connect, &[JSValue::NULL, js_value]);
    }

    fn read(&self, mut data: &[u8]) {
        SocketMonitor::read(data);
        if self.reading.get() == Reading::Deferring {
            self.read_buffer
                .with_mut(|buffer| buffer.byte_list.extend_from_slice(data));
            return;
        }
        self.reading.set(Reading::LastPacket);

        let mut buffer = self.read_buffer.take();
        loop {
            if buffer.is_empty() {
                let rest = self.handle_packets(data);
                buffer.byte_list.extend_from_slice(rest);
            } else {
                buffer.byte_list.extend_from_slice(data);
                let rest = self.handle_packets(buffer.remaining());
                buffer.consume(buffer.len() - rest.len());
            }
            let read_meanwhile = self.read_buffer.take();
            if read_meanwhile.is_empty() {
                break;
            }
            buffer
                .byte_list
                .extend_from_slice(read_meanwhile.remaining());
            data = b"";
        }
        self.read_buffer.set(buffer);
        self.reading.set(Reading::Idle);
    }

    /// Returns what has to wait for more bytes.
    fn handle_packets<'a>(&self, mut rest: &'a [u8]) -> &'a [u8] {
        loop {
            let packet = match self.session.get().next_packet(&mut rest) {
                Ok(Some(packet)) => packet,
                Ok(None) => return rest,
                Err(err) => {
                    self.on_error(err);
                    return b"";
                }
            };
            self.reading.set(match rest {
                [] => Reading::LastPacket,
                _ => Reading::Deferring,
            });
            match self.handle_packet(&packet) {
                Ok(()) => continue,
                Err(Failure::Protocol(err)) => self.on_error(err),
                Err(Failure::Server(err)) => self.fail_with_js_value(self.server_error(&err)),
                Err(Failure::UnsupportedPlugin(name)) => {
                    let err = AnyMySQLErrorT::UnsupportedAuthPlugin;
                    self.fail_fmt(err, format_args!("{err}: {}", bstr::BStr::new(name)));
                }
            }
            return b"";
        }
    }

    fn handle_packet<'p>(&self, packet: &'p Packet<'_>) -> Result<(), Failure<'p>> {
        // The refs are for script, which can end the request.
        if let Some(request) = self.queue.current()
            && let Some((command, statement)) = request.written_command()
        {
            return self.handle_reply(packet, &request, command, &statement);
        }
        let event = self.write(|out| self.session.with_mut(|s| s.on_packet(packet, out)))?;
        match event {
            Event::None => {}
            Event::Flush => self.flush_queue(),
            Event::Connected => {
                self.on_connect_pending.set(true);
                self.queue.advance(self);
            }
        }
        Ok(())
    }

    fn handle_reply<'p>(
        &self,
        packet: &'p Packet<'_>,
        request: &JSMySQLQuery,
        command: Command,
        statement: &MySQLStatement,
    ) -> Result<(), Failure<'p>> {
        let event = statement
            .wire
            .with_mut(|wire| self.session.with_mut(|s| s.on_reply(packet, command, wire)))?;
        match event {
            ReplyEvent::None => {}
            ReplyEvent::Row(reader) => self.on_result_row(request, statement, reader)?,
            ReplyEvent::ColumnsReplaced => statement.clear_structure(),
            ReplyEvent::ColumnRedescribed => statement.clear_description(),
            ReplyEvent::ColumnRenamed(index) => {
                statement.clear_structure();
                // The column transform can run the event loop; rows must wait for it.
                self.reading.set(Reading::Deferring);
                self.on_column_name(request, statement, index)?;
            }
            ReplyEvent::Result(result) => {
                request.resolve(&result);
                // Not only `advance()`: what it writes has to be sent, and the auto flusher may not be registered.
                self.flush_queue();
            }
            ReplyEvent::Prepared => {
                // Also for a request that was cancelled meanwhile: the next execution with as many values would find it.
                if !statement.parameter_count_matches() {
                    self.statements.with_mut(|cache| cache.remove(statement));
                    self.write(|out| mysql_request::close_statement(statement.wire.get().id, out));
                }
                request.prepared();
                self.queue.advance(self);
            }
            ReplyEvent::Refused(err) => {
                // The cache holds handles the server has. The next use of the text prepares again.
                if command == Command::Prepare {
                    self.statements.with_mut(|cache| cache.remove(statement));
                }
                request.reject_with_js_value(self.server_error(&err));
                if err.ends_session() {
                    return Err(AnyMySQLErrorT::ConnectionClosed.into());
                }
                self.flush_queue();
            }
        }
        Ok(())
    }

    /// The packet is skipped whole, so the stream is in step: only a VM that is stopping fails the connection.
    fn on_undecodable_row(
        &self,
        request: &JSMySQLQuery,
        err: AnyMySQLErrorT,
    ) -> Result<(), AnyMySQLErrorT> {
        if self.global_object.has_pending_termination_exception() {
            return Err(AnyMySQLErrorT::JSError);
        }
        request.reject_undecodable_row(err);
        Ok(())
    }

    /// Runs `transform.column.from`, which is user code.
    fn on_column_name(
        &self,
        request: &JSMySQLQuery,
        statement: &MySQLStatement,
        index: usize,
    ) -> Result<(), AnyMySQLErrorT> {
        let Some(transform) = self
            .js_value
            .get()
            .try_get()
            .and_then(js::column_transform_get_cached)
        else {
            return Ok(());
        };
        let forget_name = || statement.with_column(index, |column| column.forget_name());
        if request.is_discarding_response() {
            forget_name();
            return Ok(());
        }
        let Some(column) = statement.wire.get().columns.get(index) else {
            return Ok(());
        };
        let renamed = column_name_to_js(&self.global_object, &column.name_or_index)
            .and_then(|name| transform_name(&self.global_object, transform, name));
        match renamed {
            Ok(renamed) => {
                statement.with_column(index, |column| column.name_or_index = renamed);
                Ok(())
            }
            Err(err) => {
                forget_name();
                self.on_undecodable_row(request, crate::jsc::js_error_to_mysql(err))
            }
        }
    }

    /// Inlined into `handle_reply`, the row decoder loses its own inlining.
    #[inline(never)]
    fn on_result_row(
        &self,
        request: &JSMySQLQuery,
        statement: &MySQLStatement,
        reader: PacketReader<'_>,
    ) -> Result<(), AnyMySQLErrorT> {
        if request.is_discarding_response() {
            return Ok(());
        }
        let result_mode = request.result_mode.get();
        let cached_structure = match result_mode {
            ResultMode::Objects => {
                let owner = self.js_value.get().try_get().unwrap_or_default();
                Some(statement.structure(owner, &self.global_object))
            }
            ResultMode::Raw | ResultMode::Values => None,
        };
        let structure = cached_structure.and_then(|cached| cached.js_value());
        let row = ResultSet::Row {
            global_object: &self.global_object,
            columns: &statement.wire.get().columns,
            binary: !request.simple,
            raw: result_mode == ResultMode::Raw,
            bigint: request.bigint,
        };
        let mut cells = match row.decode(reader) {
            Ok(cells) => cells,
            Err(err) => return self.on_undecodable_row(request, err),
        };
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        let Ok(row_value) = SQLDataCell::to_js_object(
            &self.global_object,
            pending_value,
            structure.unwrap_or(JSValue::UNDEFINED),
            &mut cells,
            statement.fields_flags.get(),
            result_mode as u8,
            cached_structure,
        ) else {
            return self.on_undecodable_row(request, AnyMySQLErrorT::JSError);
        };

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    fn on_error(&self, err: AnyMySQLErrorT) {
        let pending = self.global_object.try_take_exception();
        self.fail_with_js_value(
            pending.unwrap_or_else(|| mysql_error_to_js(&self.global_object, None, err)),
        );
    }

    fn server_error(&self, err: &ErrorPacket<'_>) -> JSValue {
        let pending = self.global_object.try_take_exception();
        pending.unwrap_or_else(|| err.to_js(&self.global_object))
    }
}

/// uSockets event handlers for the MySQL connection (plain and TLS).
pub struct SocketHandler<const SSL: bool>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn socket(s: NewSocketHandler<SSL>) -> AnySocket {
        if SSL {
            AnySocket::SocketTls(s.assume_ssl())
        } else {
            AnySocket::SocketTcp(s.assume_tcp())
        }
    }

    pub fn on_open(this: &JSMySQLConnection, s: NewSocketHandler<SSL>) {
        this.socket.set(Self::socket(s));
        this.session.with_mut(Session::on_open);
        this.socket_ref.set(Some(this.ref_guard()));
        // The bound on a query whose peer is gone: no timer runs while one is in flight.
        if this.session.get().transport() == Transport::Tcp {
            let _ = s.set_keep_alive(true, 60);
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        // A server can renegotiate, which ends in another handshake event.
        if success == 1 && !this.awaits_tls_handshake() {
            return;
        }
        let socket = this.socket.get();
        let name_matches = |hostname: &[u8]| {
            let AnySocket::SocketTls(tls) = &socket else {
                return false;
            };
            !hostname.is_empty()
                && tls
                    .ssl_mut()
                    .is_some_and(|ssl| uws::check_server_identity(ssl, hostname))
        };
        if success != 1
            || (ssl_error.error_no != 0 && this.verifies_certificate())
            || !this.native_identity_hostname().is_none_or(name_matches)
        {
            let v = crate::jsc::verify_error_to_js(&ssl_error, &this.global_object);
            return this.fail_with_js_value(v);
        }
        this.session.with_mut(Session::on_tls_handshake);
        // The callback can close this connection.
        let _guard = this.ref_guard();
        if let Some(callback) = this.check_server_identity_callback() {
            let hostname = this.tls_config.server_name_bytes();
            if let Err(reason) =
                server_identity::check(&this.global_object, callback, &socket, hostname)
            {
                return this.fail_with_js_value(reason);
            }
        }
        match this.write(|out| this.session.with_mut(|s| s.on_identity_accepted(out))) {
            Ok(()) => this.flush_data(),
            Err(e) => this.fail_fmt(e, format_args!("Failed to send handshake response")),
        }
    }

    pub const ON_HANDSHAKE: Option<
        fn(&JSMySQLConnection, NewSocketHandler<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake) } else { None };

    pub fn on_close(
        this: &JSMySQLConnection,
        _: NewSocketHandler<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        let _guard = this.socket_ref.take();
        // usockets frees this socket at end-of-tick; drop the stored pointer
        // now so nothing (timer callbacks, close) dereferences it after
        // the free.
        this.socket.set(AnySocket::SocketTcp(SocketTCP::detached()));
        match this.phase() {
            // The server, or a port proxy in front of one that is still starting, accepted and left.
            Phase::Connecting(_) => this.fail(
                b"Connection closed before the connection was established",
                AnyMySQLErrorT::ConnectionFailed,
            ),
            Phase::Connected => this.fail(b"Connection closed", AnyMySQLErrorT::ConnectionClosed),
            Phase::Failed => {}
        }
    }

    pub fn on_end(_: &JSMySQLConnection, socket: NewSocketHandler<SSL>) {
        // no half closed sockets
        socket.close(uws::CloseKind::Normal);
    }

    pub fn on_connect_error(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, _: i32) {
        // As in `on_close`.
        this.socket.set(AnySocket::SocketTcp(SocketTCP::detached()));
        this.fail(b"Failed to connect", AnyMySQLErrorT::ConnectionRefused);
    }

    pub fn on_timeout(_: &JSMySQLConnection, _: NewSocketHandler<SSL>) {}

    pub fn on_data(this: &JSMySQLConnection, _: NewSocketHandler<SSL>, data: &[u8]) {
        let _guard = this.ref_guard();
        {
            let _loop_guard = this.event_loop().enter_scope();
            this.ensure_js_value_is_alive();

            this.read(data);
            this.notify_connected();
            this.retire_if_idle();
        }
        this.on_queue_changed();
    }

    pub fn on_writable(this: &JSMySQLConnection, _: NewSocketHandler<SSL>) {
        let _guard = this.ref_guard();
        this.has_backpressure.set(false);
        this.drain_internal();
    }
}

use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode as ResultMode;
