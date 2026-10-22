use bun_collections::VecExt;
use bun_jsc::JsCell;
use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::jsc::api::server_config::SSLConfig;
use crate::jsc::{
    self as jsc, AutoFlush, CallFrame, JSGlobalObject, JSValue, JsResult, Strong, VirtualMachine,
    VirtualMachineSqlExt as _, bun_string_jsc, run_callback,
};
use bun_boringssl as BoringSSL;
use bun_boringssl_sys::OwnedSslCtx;
use bun_collections::OffsetByteList;
use bun_collections::smallvec::SmallVec;
use bun_core::fmt::ConnTimeoutKind;
use bun_core::strings;
use bun_core::{self};
use bun_io::KeepAlive;
use bun_jsc::rare_data::SocketGroups;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef, RefPtr};
use bun_uws as uws;
use std::rc::Rc;

use crate::jsc::EventLoopTimerTag;
use crate::postgres::AuthenticationState;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::data_cell as DataCell;
use crate::postgres::error_jsc::{
    create_postgres_error, postgres_error_to_js, postgres_error_to_js_with_hint,
};
use crate::postgres::postgres_request as PostgresRequest;
use crate::postgres::postgres_request::MessageType;
use crate::postgres::postgres_sql_query::{self, Cancel, RequestCounter, Status as QueryStatus};
use crate::postgres::postgres_sql_statement::{
    Error as StatementError, StatementCache, Status as StatementStatus,
};
use crate::postgres::sasl::{self, ChannelBinding, Gs2Flag, Refusal, SASL, SASLStatus};
use crate::shared::CachedStructure as PostgresCachedStructure;
use crate::shared::connection_ctor_args::ConnectionCtorArgs;
use crate::shared::connection_timers::{ConnectionTimers, Phase, TimedConnection};
use crate::shared::server_identity;
use crate::shared::start_tls::{start_tls, verifies_certificate};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::PostgresErrorOptions;
use bun_sql::postgres::Status;
use bun_sql::postgres::TLSStatus;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::postgres::postgres_types::{Int4, ResultFormats};
use bun_sql::postgres::socket_monitor as SocketMonitor;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::Data;
use bun_sql::shared::SQLQueryResultMode;
use bun_sql::shared::SSLMode;

type Socket = uws::AnySocket;

bun_core::define_scoped_log!(debug, Postgres, visible);

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

const CANCEL_REQUEST_TIMEOUT_MS: u32 = 5_000;

const CANCELLED_ON_THE_WIRE: &[u8] =
    b"The server has received the query and may still run it. Its result is discarded.";

pub mod js {
    pub use crate::jsc::codegen::JSPostgresSQLConnection::*;
}

#[path = "CopyStream.rs"]
mod copy_stream;

use crate::jsc::verify_error_to_js;

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLConnection {
    pub(crate) socket: JsCell<Socket>,
    pub(crate) status: Cell<Status>,
    ref_count: Cell<u32>,

    pub(crate) write_buffer: JsCell<OffsetByteList>,
    read_buffer: JsCell<OffsetByteList>,
    last_message_start: Cell<usize>,
    pub(crate) requests: JsCell<PostgresRequest::Queue>,
    /// number of requests in flight whose Bind and Execute are written
    pub(crate) pipelined_requests: Cell<u32>,
    /// number of non-pipelined requests (Simple/Copy)
    pub(crate) nonpipelinable_requests: Cell<u32>,
    /// number of requests with something left to write (Pending, Preparing): the tail of `requests`
    pub(crate) pending_requests: Cell<u32>,
    advancing: Cell<bool>,

    pub(crate) poll_ref: JsCell<KeepAlive>,
    pub(crate) global_object: BackRef<JSGlobalObject>,
    vm: BackRef<VirtualMachine>,
    pub(crate) statements: JsCell<StatementCache>,
    prepared_statement_id: Cell<u64>,
    /// `ReadyForQuery::transaction_status` of the last one.
    transaction_status: Cell<u8>,
    pub(crate) pending_activity_count: AtomicU32,
    // The wrapper. Weak: `has_pending_activity` is what keeps it alive.
    pub(crate) js_value: JsCell<crate::jsc::JsRef>,

    backend_key_data: Cell<Option<protocol::BackendKeyData>>,
    /// Of a connection that only carries a CancelRequest, until it ends.
    cancel_target: JsCell<Option<CancelTarget>>,

    // Self-referential — `database`/`user`/`password`/`path`/`options` are slices
    // into `options_buf` (built by `ConnectionStrings::new`). Struct is Box-allocated
    // and never moves (intrusive refcount), so the `RawSlice` backing-outlives-holder
    // invariant holds. Private — reassigning `options_buf` is UAF.
    // Reach via `database()`/`user()`/`password()`/`path()`/`options()`.
    database: bun_ptr::RawSlice<u8>,
    user: bun_ptr::RawSlice<u8>,
    password: bun_ptr::RawSlice<u8>,
    /// SASLprep(password), which is what SCRAM hashes.
    scram_password: bun_ptr::RawSlice<u8>,
    path: bun_ptr::RawSlice<u8>,
    options: bun_ptr::RawSlice<u8>,
    options_buf: Box<[u8]>,

    pub(crate) authentication_state: JsCell<AuthenticationState>,

    /// `us_ssl_ctx_t` built from `tls_config` at construct time. Applied via
    /// `us_socket_adopt_tls` when the server replies `S` to the SSLRequest.
    pub(crate) secure: Option<OwnedSslCtx>,
    /// Shared with the connection that carries a CancelRequest for this one.
    pub(crate) tls_config: Rc<SSLConfig>,
    pub(crate) tls_status: Cell<TLSStatus>,
    pub(crate) ssl_mode: SSLMode,
    channel_binding: ChannelBinding,

    pub(crate) flags: Cell<ConnectionFlags>,
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

/// While it lives, `advance()` returns at once: converting a parameter runs user code, and a query
/// which that code starts here is written by the `advance()` that is running.
struct Advancing<'a>(&'a PostgresSQLConnection);

impl Drop for Advancing<'_> {
    fn drop(&mut self) {
        self.0.advancing.set(false);
    }
}

struct RowCells(SmallVec<[DataCell::SQLDataCell; 70]>);

impl Drop for RowCells {
    fn drop(&mut self) {
        for cell in &mut self.0 {
            cell.deinit();
        }
    }
}

bun_event_loop::impl_timer_owner!(PostgresSQLConnection;
    from_timer_ptr => timers.timer,
    from_max_lifetime_timer_ptr => timers.max_lifetime_timer,
);

impl Drop for PostgresSQLConnection {
    fn drop(&mut self) {
        self.disconnect();
        // `free_sensitive`: the connection options carry the password.
        for b in self.options_buf.iter_mut() {
            // SAFETY: plain byte write; volatile so it is not elided.
            unsafe { core::ptr::write_volatile(b, 0) };
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
    fn event_loop(&self) -> &'static mut crate::jsc::EventLoop {
        VirtualMachine::get().event_loop_mut()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }

    #[inline]
    pub(crate) fn user(&self) -> &[u8] {
        self.user.slice()
    }

    #[inline]
    pub(crate) fn password(&self) -> &[u8] {
        self.password.slice()
    }

    /// `&mut SASL` if `authentication_state` is the `Sasl` variant.
    ///
    /// SAFETY (encapsulated): single-JS-thread; callers hold the returned
    /// `&mut SASL` only for the synchronous packet-handler body and drop it
    /// before any call that touches `authentication_state` again
    /// (`self.writer()` / `self.flush_data()` / `self.fail()` do not).
    #[inline]
    #[allow(clippy::mut_from_ref)] // body projects through `JsCell` (UnsafeCell-backed); see SAFETY note
    fn sasl_state_mut(&self) -> Option<&mut SASL> {
        // SAFETY: see doc comment — single-JS-thread, no re-entrant access to
        // `authentication_state` for the borrow's lifetime.
        match unsafe { self.authentication_state.get_mut() } {
            AuthenticationState::Sasl(s) => Some(s),
            _ => None,
        }
    }

    fn refuse_authentication(&self, refusal: Refusal) {
        self.fail_fmt(refusal.code, format_args!("{}", refusal.message));
    }
}

impl TimedConnection for PostgresSQLConnection {
    fn timers(&self) -> &ConnectionTimers {
        &self.timers
    }

    fn phase(&self) -> Phase {
        match self.status.get() {
            Status::Connected => Phase::Connected,
            Status::Failed => Phase::Failed,
            Status::SentStartupMessage => {
                Phase::Connecting(" (sent startup message, but never received response)")
            }
            _ => Phase::Connecting(""),
        }
    }

    fn has_requests(&self) -> bool {
        self.has_query_running()
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
        self.fail_fmt(code, message);
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
        self.status.get() == Status::Connected
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
    pub fn get_on_notification(_this: &Self, this_value: JSValue, _: &JSGlobalObject) -> JSValue {
        js::onnotification_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn set_on_notification(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::onnotification_set_cached(this_value, global, value);
    }

    /// `on_handshake` sends the StartupMessage.
    pub(crate) fn setup_tls(&self) {
        let started = start_tls(
            self.as_ctx_ptr(),
            *self.socket.get(),
            (
                uws::SocketKind::PostgresTls,
                SocketGroups::postgres_group::<true>,
            ),
            self.secure.as_ref(),
            &self.tls_config,
            self.ssl_mode,
            |socket| self.socket.set(socket),
        );
        if started.is_err() {
            self.fail(
                b"Failed to upgrade to TLS",
                AnyPostgresError::TLSUpgradeFailed,
            );
        }
    }

    pub(crate) fn start(&self) {
        self.start_max_lifetime_timer();
        // A CancelRequest has one time budget, from dial to hang-up.
        if self.cancel_target.get().is_none() {
            self.reset_connection_timeout();
        }
        self.send_startup_message();

        self.drain_internal();
    }

    pub fn has_pending_activity(this: &Self) -> bool {
        // Called on GC thread; reads only atomic field.
        this.pending_activity_count.load(Ordering::Acquire) > 0
    }

    fn update_has_pending_activity(&self) {
        let a: u32 = if !self.requests.get().is_empty() {
            1
        } else {
            0
        };
        let b: u32 = match self.status.get() {
            // Terminal states: nothing more will happen on this connection, so
            // allow GC to collect the JS wrapper (and ultimately call deinit()).
            // We must still outlive the socket's onClose callback, which
            // re-enters here (via failWithJSValue's defer) with
            // isClosed() == true, at which point GC can proceed.
            Status::Disconnected | Status::Failed => (!self.socket.get().is_closed()) as u32,
            _ => 1,
        };
        self.pending_activity_count.store(a + b, Ordering::Release);
    }

    pub(crate) fn set_status(&self, status: Status) {
        let current = self.status.get();
        if current == status {
            return;
        }
        // `Failed` is terminal: `fail_with_js_value` already closed the socket
        // and rejected every pending request. Nothing may transition out of it.
        if current == Status::Failed {
            return;
        }
        self.status.set(status);
        self.reset_connection_timeout();
        if status == Status::Connected {
            self.update_flags(|f| f.insert(ConnectionFlags::ON_CONNECT_PENDING));
            self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));
        }
        self.update_has_pending_activity();
    }

    /// Runs at the end of the read, so that a failure later in that read reports `onclose` alone.
    fn notify_connected(&self) {
        if !self
            .flags
            .get()
            .contains(ConnectionFlags::ON_CONNECT_PENDING)
        {
            return;
        }
        self.update_flags(|f| f.remove(ConnectionFlags::ON_CONNECT_PENDING));
        if self.status.get() != Status::Connected {
            return;
        }
        let Some(on_connect) = self.consume_on_connect_callback(self.global()) else {
            return;
        };
        let js_value = self.js_value.get().get();
        js_value.ensure_still_alive();
        run_callback(self.global(), on_connect, &[JSValue::NULL, js_value]);
    }

    pub fn finalize(&self) {
        debug!("PostgresSQLConnection finalize");
        self.timers.stop();
        self.js_value.with_mut(|r| r.finalize());
    }

    /// Keep the process alive only while a connected connection has something in flight.
    pub(crate) fn update_poll_ref(&self) {
        if self.status.get() != Status::Connected {
            return;
        }
        let flags = self.flags.get();
        // What a paused COPY TO STDOUT waits for is its consumer, which is in this process.
        let idle = !flags.contains(ConnectionFlags::KEEP_ALIVE_REQUESTED)
            && (flags.contains(ConnectionFlags::COPY_OUT_PAUSED)
                || (!self.has_query_running() && self.write_buffer.get().remaining().is_empty()));
        if idle {
            self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));
        } else {
            self.poll_ref.with_mut(|r| r.r#ref(self.vm_ctx()));
        }
    }

    pub(crate) fn flush_data_and_reset_timeout(&self) {
        self.reset_connection_timeout();
        // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
        self.register_auto_flusher();
    }

    pub(crate) fn flush_data(&self) {
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

    pub(crate) fn fail_with_js_value(&self, value: JSValue) {
        self.timers.stop();
        if self.status.get() == Status::Failed {
            self.update_has_pending_activity();
            return;
        }

        let sent_first_message = self.status.get() == Status::SentStartupMessage
            && self.write_buffer.get().remaining().is_empty();
        self.status.set(Status::Failed);

        let _guard = self.ref_guard();
        // Read first: without a socket nothing native keeps the wrapper of a failed connection.
        let on_close_opt = self.consume_on_close_callback(self.global());
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
        self.clean_up_requests(Some(value));
        self.update_has_pending_activity();
        if let Some(target) = self.cancel_target.take() {
            target
                .session
                .on_cancel_connection_closed(&target.request, sent_first_message);
        }
    }

    pub(crate) fn fail_fmt(&self, code: &[u8], args: core::fmt::Arguments<'_>) {
        let mut message: Vec<u8> = Vec::new();
        use std::io::Write as _;
        let _ = write!(&mut message, "{}", args);

        let err = match create_postgres_error(
            self.global(),
            &message,
            &PostgresErrorOptions {
                code,
                ..Default::default()
            },
        ) {
            Ok(v) => v,
            Err(e) => self.global().take_error(e),
        };

        self.fail_with_js_value(err);
    }

    pub(crate) fn fail(&self, message: &[u8], err: AnyPostgresError) {
        debug!(
            "failed: {}: {}",
            bstr::BStr::new(message),
            <&'static str>::from(err)
        );

        let global_object = self.global();

        self.fail_with_js_value(postgres_error_to_js(global_object, Some(message), err));
    }

    pub(crate) fn on_close(&self) {
        // A close before the handshake finished means the server (or an
        // intermediary like a container port proxy) accepted the TCP
        // connection but went away before completing startup — e.g. the
        // database is still initializing. Report it as a connect failure
        // (the connection was never established) rather than a closed
        // connection so the error is actionable.
        self.handle_socket_failure(|this| match this.status.get() {
            Status::Connecting | Status::SentStartupMessage => this.fail(
                b"Connection closed before the connection was established",
                AnyPostgresError::ConnectionFailed,
            ),
            _ => this.fail(b"Connection closed", AnyPostgresError::ConnectionClosed),
        });
    }

    pub(crate) fn on_connect_error(&self) {
        self.handle_socket_failure(|this| {
            this.fail(b"Failed to connect", AnyPostgresError::ConnectionRefused);
        });
    }

    fn handle_socket_failure(&self, fail: impl FnOnce(&Self)) {
        self.unregister_auto_flusher();
        let event_loop = self.event_loop();
        event_loop.enter();
        self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));
        fail(self);
        event_loop.exit();
    }

    fn send_startup_message(&self) {
        if self.status.get() != Status::Connecting {
            return;
        }
        debug!("sendStartupMessage");
        self.status.set(Status::SentStartupMessage);
        let cancel_request = self
            .cancel_target
            .get()
            .as_ref()
            .map(CancelTarget::cancel_request);
        if let Some(cancel_request) = cancel_request {
            match cancel_request {
                Some(packet) => {
                    if let Err(err) = self.writer().write(&packet) {
                        self.fail(b"Failed to write cancel request", err);
                    }
                }
                None => self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed),
            }
            return;
        }
        let msg = protocol::StartupMessage {
            user: Data::Temporary(self.user),
            database: Data::Temporary(self.database),
            options: Data::Temporary(self.options),
        };
        if let Err(err) = msg.write_internal(self.writer()) {
            self.fail(b"Failed to write startup message", err);
        }
    }

    fn start_tls(&self) {
        debug!("startTLS");
        let offset: u8 = match self.tls_status.get() {
            TLSStatus::MessageSent(count) => count,
            _ => 0,
        };
        let ssl_request: [u8; 8] = [
            0x00, 0x00, 0x00, 0x08, // Length
            0x04, 0xD2, 0x16, 0x2F, // SSL request code
        ];

        let written = self.socket.get().write(&ssl_request[offset as usize..]);
        if written > 0 {
            self.tls_status.set(TLSStatus::MessageSent(
                offset + u8::try_from(written).expect("int cast"),
            ));
        } else {
            self.tls_status.set(TLSStatus::MessageSent(offset));
        }
    }

    pub(crate) fn on_open(&self, socket: uws::AnySocket) {
        self.socket.set(socket);
        // What ends a query whose peer is gone without a FIN. Not a unix socket's option.
        if self.path.slice().is_empty() {
            let _ = match socket {
                Socket::SocketTcp(tcp) => tcp.set_keep_alive(true, 60),
                Socket::SocketTls(tls) => tls.set_keep_alive(true, 60),
            };
        }

        self.poll_ref.with_mut(|r| r.r#ref(self.vm_ctx()));
        self.update_has_pending_activity();

        if matches!(
            self.tls_status.get(),
            TLSStatus::MessageSent(_) | TLSStatus::Pending
        ) {
            self.start_tls();
            return;
        }

        self.start();
    }

    /// verify-full's name check, asked inside the handshake.
    pub fn server_identity(&self, ssl: &mut bun_boringssl_sys::SSL) -> BoringSSL::ServerIdentity {
        BoringSSL::server_identity(ssl, self.native_identity_hostname())
    }

    /// The name verify-full matches, in and after the handshake. Empty (none configured) matches no certificate.
    /// `tls.checkServerIdentity` replaces the match, as in Node.
    fn native_identity_hostname(&self) -> Option<&[u8]> {
        (self.tls_config.reject_unauthorized() != 0
            && self.ssl_mode == SSLMode::VerifyFull
            && self.check_server_identity_callback().is_none())
        .then(|| self.tls_config.server_name_bytes())
    }

    fn check_server_identity_callback(&self) -> Option<JSValue> {
        self.js_value
            .get()
            .try_get()
            .and_then(js::check_server_identity_get_cached)
    }

    pub(crate) fn on_handshake(&self, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        debug!("onHandshake: {} {}", success, ssl_error.error_no);
        // The server rejected us, whatever `rejectUnauthorized` says, or its chain does not verify.
        if success != 1
            || (ssl_error.error_no != 0 && verifies_certificate(&self.tls_config, self.ssl_mode))
        {
            let v = verify_error_to_js(&ssl_error, self.global());
            self.fail_with_js_value(v);
            return;
        }
        // A TLS 1.2 server can renegotiate. BoringSSL refuses another certificate then.
        if self.status.get() != Status::Connecting {
            return;
        }

        let socket = *self.socket.get();
        if let Some(callback) = self.check_server_identity_callback() {
            // It can close this connection.
            let _guard = self.ref_guard();
            let hostname = self.tls_config.server_name_bytes();
            if let Err(reason) = server_identity::check(self.global(), callback, &socket, hostname)
            {
                self.fail_with_js_value(reason);
                return;
            }
            if self.status.get() != Status::Connecting {
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

    pub(crate) fn on_drain(&self) {
        debug!("onDrain");
        let _guard = self.ref_guard();
        self.update_flags(|f| f.remove(ConnectionFlags::HAS_BACKPRESSURE));
        // Don't send any other messages while we're waiting for TLS.
        if let TLSStatus::MessageSent(sent) = self.tls_status.get() {
            if sent < 8 {
                self.start_tls();
            }
            return;
        }

        self.drain_internal();
        self.on_copy_drain();
    }

    fn drain_internal(&self) {
        debug!("drainInternal");
        let event_loop = self.event_loop();
        event_loop.enter();

        self.flush_data();

        if !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            // no backpressure yet so pipeline more if possible and flush again
            self.advance();
            self.flush_data();
        }
        event_loop.exit();
    }

    pub(crate) fn on_data(&self, data: &[u8]) {
        let _guard = self.ref_guard();
        // A server answers a CancelRequest by hanging up. This one is not to be talked to.
        if self.cancel_target.get().is_some() && self.status.get() == Status::SentStartupMessage {
            self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed);
            return;
        }
        self.update_flags(|f| f.insert(ConnectionFlags::IS_PROCESSING_DATA));

        let event_loop = self.event_loop();
        event_loop.enter();
        SocketMonitor::read(data);
        // reset the head to the last message so remaining reflects the right amount of bytes
        self.read_buffer
            .with_mut(|rb| rb.head = self.last_message_start.get());

        let mut done = false;
        if self.read_buffer.get().remaining().is_empty() {
            let mut consumed: usize = 0;
            let mut offset: usize = 0;
            let reader = protocol::StackReader::init(data, &mut consumed, &mut offset);
            match PostgresRequest::on_data(self, reader) {
                Ok(()) => {}
                Err(err) => {
                    if err == AnyPostgresError::ShortRead {
                        #[cfg(debug_assertions)]
                        debug!(
                            "read_buffer: empty and received short read: last_message_start: {}, head: {}, len: {}",
                            offset,
                            consumed,
                            data.len()
                        );

                        self.last_message_start.set(0);
                        self.read_buffer.with_mut(|rb| {
                            rb.head = 0;
                            rb.byte_list.clear();
                            rb.write(&data[offset..])
                                .expect("failed to write to read buffer");
                        });
                    } else {
                        bun_core::handle_error_return_trace(err);
                        self.fail(b"Failed to read data", err);
                    }
                }
            }
            // no need to reset anything, its already empty
            done = true;
        }
        if !done {
            // read buffer is not empty, so we need to write the data to the buffer and then read it
            self.read_buffer
                .with_mut(|rb| rb.write(data).expect("failed to write to read buffer"));
            let reader = self.buffered_reader();
            match PostgresRequest::on_data(self, reader) {
                Ok(()) => {
                    debug!("clean read_buffer");
                    // success, we read everything! let's reset the last message start and the head
                    self.last_message_start.set(0);
                    self.read_buffer.with_mut(|rb| rb.head = 0);
                }
                Err(err) => {
                    if err != AnyPostgresError::ShortRead {
                        bun_core::handle_error_return_trace(err);
                        self.fail(b"Failed to read data", err);
                    } else {
                        #[cfg(debug_assertions)]
                        {
                            let lms = self.last_message_start.get();
                            let rb = self.read_buffer.get();
                            debug!(
                                "read_buffer: not empty and received short read: last_message_start: {}, head: {}, len: {}",
                                lms,
                                rb.head,
                                rb.byte_list.len()
                            );
                        }
                        // A long reply whose reads all end inside a message would be kept whole.
                        self.read_buffer.with_mut(|rb| {
                            rb.head = 0;
                            rb.consume(self.last_message_start.get());
                            self.last_message_start.set(rb.head);
                        });
                    }
                }
            }
        }

        self.stop_cancelled_head();
        self.flush_copy_out();
        self.notify_connected();
        event_loop.exit();
        self.update_poll_ref();
        self.update_flags(|f| f.remove(ConnectionFlags::IS_PROCESSING_DATA));

        if self.status.get() == Status::Connected {
            self.reset_connection_timeout();
        }
    }
}

#[bun_jsc::host_fn(export = "PostgresSQLConnection__createInstance")]
pub(crate) fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let vm = global_object.bun_vm().as_mut();
    // The connection is the calling script's.
    let context = global_object.bun_vm().context_of_caller(callframe);
    let arguments = callframe.arguments();
    let Some(args) = ConnectionCtorArgs::parse(global_object, &mut *vm, arguments)? else {
        return Ok(JSValue::ZERO);
    };
    let (secure, tls_config) = (args.secure, args.tls_config);
    // Next to `rejectUnauthorized: false` it is not asked, as in Node.
    let check_server_identity = server_identity::callback_of(global_object, arguments[6])?
        .filter(|_| verifies_certificate(&tls_config, args.ssl_mode));
    let channel_binding = ChannelBinding::from_js(global_object, callframe.argument(18))?;

    let options_str = arguments[7].to_bun_string(global_object)?;
    let scram_password_str = callframe.argument(20).to_bun_string(global_object)?;
    let (username, password, scram_password, database, options, path) = (
        args.username_str.to_utf8(),
        args.password_str.to_utf8(),
        scram_password_str.to_utf8(),
        args.database_str.to_utf8(),
        options_str.to_utf8(),
        args.path_str.to_utf8(),
    );

    // Reject null bytes in connection parameters to prevent Postgres startup
    // message parameter injection (null bytes act as field terminators in the
    // wire protocol's key\0value\0 format).
    for (entry, name) in [
        (username.slice(), &b"username"[..]),
        (password.slice(), b"password"),
        (database.slice(), b"database"),
        (path.slice(), b"path"),
    ] {
        if !entry.is_empty() && strings::contains_char(entry, 0) {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "{} must not contain null bytes",
                bstr::BStr::new(name)
            )));
        }
    }

    let hostname = args.hostname_str.to_utf8();
    open(
        global_object,
        vm.postgres_socket_group::<false>(context),
        ConnectParams {
            hostname: hostname.slice(),
            port: args.port,
            strings: ConnectionStrings::new(
                username.slice(),
                password.slice(),
                scram_password.slice(),
                database.slice(),
                options.slice(),
                path.slice(),
            ),
            secure,
            tls_config: Rc::new(tls_config),
            ssl_mode: args.ssl_mode,
            channel_binding,
            idle_timeout_ms: args.idle_timeout_ms,
            connection_timeout_ms: args.connection_timeout_ms,
            max_lifetime_ms: args.max_lifetime_ms,
            use_unnamed_prepared_statements: arguments[14].as_boolean(),
            on_connect: arguments[9],
            on_close: arguments[10],
            on_retire: callframe.argument(16),
            column_transform: callframe.argument(19),
            check_server_identity,
            cancel: None,
        },
    )
    .map_err(|_| {
        let mut message: Vec<u8> = Vec::new();
        use std::io::Write as _;
        let _ = if path.slice().is_empty() {
            write!(
                &mut message,
                "Failed to connect to {}:{}",
                bstr::BStr::new(hostname.slice()),
                args.port
            )
        } else {
            write!(
                &mut message,
                "Failed to connect to {}",
                bstr::BStr::new(path.slice())
            )
        };
        global_object.throw_value(postgres_error_to_js(
            global_object,
            Some(&message),
            AnyPostgresError::ConnectionRefused,
        ))
    })
}

struct ConnectionStrings {
    buf: Box<[u8]>,
    user: bun_ptr::RawSlice<u8>,
    password: bun_ptr::RawSlice<u8>,
    scram_password: bun_ptr::RawSlice<u8>,
    database: bun_ptr::RawSlice<u8>,
    options: bun_ptr::RawSlice<u8>,
    path: bun_ptr::RawSlice<u8>,
}

impl ConnectionStrings {
    fn new(
        user: &[u8],
        password: &[u8],
        scram_password: &[u8],
        database: &[u8],
        options: &[u8],
        path: &[u8],
    ) -> Self {
        let mut b = bun_core::StringBuilder::default();
        for string in [user, password, scram_password, database, options, path] {
            b.count_z(string);
        }
        let _ = b.allocate();
        // The buffer never moves again, so each slice can outlive the borrow of `b`.
        let user = bun_ptr::RawSlice::new(b.append_z(user).as_bytes());
        let password = bun_ptr::RawSlice::new(b.append_z(password).as_bytes());
        let scram_password = bun_ptr::RawSlice::new(b.append_z(scram_password).as_bytes());
        let database = bun_ptr::RawSlice::new(b.append_z(database).as_bytes());
        let options = bun_ptr::RawSlice::new(b.append_z(options).as_bytes());
        let path = bun_ptr::RawSlice::new(b.append_z(path).as_bytes());
        Self {
            buf: b.move_to_slice(),
            user,
            password,
            scram_password,
            database,
            options,
            path,
        }
    }
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
    on_retire: JSValue,
    column_transform: JSValue,
    check_server_identity: Option<JSValue>,
    cancel: Option<CancelTarget>,
}

struct CancelTarget {
    session: RefPtr<PostgresSQLConnection>,
    request: RefPtr<PostgresSQLQuery>,
}

impl CancelTarget {
    /// `None`: the backend has gone on to another request.
    fn cancel_request(&self) -> Option<[u8; 16]> {
        let session = &*self.session;
        if session.status.get() == Status::Connected && !session.is_running(&self.request) {
            return None;
        }
        Some(session.backend_key_data.get()?.cancel_request())
    }
}

fn open(
    global_object: &JSGlobalObject,
    group: &mut uws::SocketGroup,
    params: ConnectParams<'_>,
) -> Result<JSValue, uws::ConnectError> {
    let ConnectionStrings {
        buf: options_buf,
        user: username,
        password,
        scram_password,
        database,
        options,
        path,
    } = params.strings;
    let carries_cancel_request = params.cancel.is_some();

    let ptr: *mut PostgresSQLConnection =
        bun_core::heap::into_raw(Box::new(PostgresSQLConnection {
            socket: JsCell::new(Socket::SocketTcp(uws::SocketTCP {
                socket: uws::InternalSocket::Detached,
            })),
            status: Cell::new(Status::Connecting),
            ref_count: Cell::new(1),
            write_buffer: JsCell::new(OffsetByteList::default()),
            read_buffer: JsCell::new(OffsetByteList::default()),
            last_message_start: Cell::new(0),
            requests: JsCell::new(PostgresRequest::Queue::new()),
            pipelined_requests: Cell::new(0),
            nonpipelinable_requests: Cell::new(0),
            pending_requests: Cell::new(0),
            advancing: Cell::new(false),
            poll_ref: JsCell::new(KeepAlive::default()),
            global_object: BackRef::new(global_object),
            vm: BackRef::from(
                core::ptr::NonNull::new(VirtualMachine::get_mut_ptr()).expect("vm singleton"),
            ),
            statements: JsCell::new(StatementCache::default()),
            prepared_statement_id: Cell::new(0),
            transaction_status: Cell::new(b'I'),
            pending_activity_count: AtomicU32::new(0),
            js_value: JsCell::new(crate::jsc::JsRef::empty()),
            backend_key_data: Cell::new(None),
            cancel_target: JsCell::new(params.cancel),
            database,
            user: username,
            password,
            scram_password,
            path,
            options,
            options_buf,
            authentication_state: JsCell::new(AuthenticationState::Pending),
            secure: params.secure,
            tls_config: params.tls_config,
            tls_status: Cell::new(if params.ssl_mode != SSLMode::Disable {
                TLSStatus::Pending
            } else {
                TLSStatus::None
            }),
            ssl_mode: params.ssl_mode,
            channel_binding: params.channel_binding,
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
        }));

    let this = ParentRef::from(core::ptr::NonNull::new(ptr).expect("heap::into_raw non-null"));

    {
        // Postgres always opens plain TCP first (SSLRequest happens in-band),
        // so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()`
        // adopts into `postgres_tls_group` after the server's `S`.
        let path_slice = this.path.slice();
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

        this.socket.set(Socket::SocketTcp(match result {
            Ok(s) => s,
            Err(err) => {
                // SAFETY: fresh allocation, sole ref.
                drop(unsafe { bun_core::heap::take(ptr) });
                return Err(err);
            }
        }));
    }

    // only call toJS if connectUnixAnon does not fail immediately
    this.update_has_pending_activity();
    this.reset_connection_timeout();
    this.poll_ref.with_mut(|r| r.ref_(this.vm_ctx()));
    let js_value = js::to_js(ptr, global_object);
    js_value.ensure_still_alive();
    this.js_value.set(crate::jsc::JsRef::init_weak(js_value));
    js::onconnect_set_cached(js_value, global_object, params.on_connect);
    if params.column_transform.is_callable() {
        js::column_transform_set_cached(js_value, global_object, params.column_transform);
    }
    js::onclose_set_cached(js_value, global_object, params.on_close);
    if params.on_retire.is_callable() {
        js::onretire_set_cached(js_value, global_object, params.on_retire);
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
    pub fn do_ref(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.update_flags(|f| f.insert(ConnectionFlags::KEEP_ALIVE_REQUESTED));
        this.poll_ref.with_mut(|p| p.ref_(this.vm_ctx()));
        this.update_has_pending_activity();
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_flush(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_hold(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.timers.set_checked_out(true);
        if this.status.get() == Status::Connected {
            this.reset_connection_timeout();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_unhold(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.timers.set_checked_out(false);
        if this.status.get() == Status::Connected {
            this.reset_connection_timeout();
        }
        this.retire_if_idle();
        Ok(JSValue::UNDEFINED)
    }

    fn is_in_transaction(&self) -> bool {
        self.transaction_status.get() != b'I'
    }

    /// Also while a request that user code has seen rejected can still change it.
    pub fn get_in_transaction(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(
            self.is_in_transaction()
                || self
                    .current()
                    .is_some_and(|head| head.flags.get().discard_response),
        )
    }

    /// Of the login that is under way or was refused.
    pub fn get_sasl(&self, _: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(matches!(
            self.authentication_state.get(),
            AuthenticationState::Sasl(_) | AuthenticationState::SaslVerified { .. }
        ))
    }

    fn close(&self) {
        // `disconnect()` only tears down connected sockets.
        if matches!(
            self.status.get(),
            Status::Connecting | Status::SentStartupMessage
        ) {
            self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed);
        } else {
            self.disconnect();
        }
        self.unregister_auto_flusher();
        self.write_buffer.with_mut(|b| b.clear_and_free());
    }

    pub fn do_close(
        this: &Self,
        _global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    fn clean_up_requests(&self, js_reason: Option<JSValue>) {
        while let Some(request) = self.current() {
            if !matches!(
                request.status.get(),
                QueryStatus::Success | QueryStatus::Fail
            ) {
                self.count(&request, RequestCounter::None);
                let global = self.global();
                let reason = js_reason.unwrap_or_else(|| {
                    postgres_error_to_js(global, None, AnyPostgresError::ConnectionClosed)
                });
                request.on_js_error(reason, global);
            }
            self.discard_request(&request);
        }
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
            self.poll_ref.with_mut(|r| r.ref_(self.vm_ctx()));
            // will unref on socket close
            socket.close_now();
        }
    }

    pub(crate) fn disconnect(&self) {
        self.timers.stop();
        self.unregister_auto_flusher();
        if self.status.get() == Status::Connected {
            self.status.set(Status::Disconnected);
            self.close_socket();
            self.clean_up_requests(None);
        }
    }

    /// The queue's head request, if any. A [`ParentRef`] (a `&T` without a lifetime), so that the
    /// queue can change while the caller holds it.
    fn current(&self) -> Option<ParentRef<PostgresSQLQuery>> {
        self.requests
            .get()
            .front()
            .map(|req| ParentRef::from(req.as_non_null()))
    }

    /// The request that a result belongs to: the head, once its Bind or its Query is written.
    fn executed(&self) -> Result<ParentRef<PostgresSQLQuery>, AnyPostgresError> {
        let head = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
        match head.status.get() {
            QueryStatus::Pending | QueryStatus::Preparing => {
                Err(AnyPostgresError::UnexpectedMessage)
            }
            _ => Ok(head),
        }
    }

    /// Pop the FIFO head if it is still `request` (re-entrant JS may already
    /// have removed it), dropping the queue's ref.
    #[inline]
    fn discard_request(&self, request: &PostgresSQLQuery) {
        if self
            .requests
            .get()
            .front()
            .is_some_and(|f| core::ptr::eq(f.as_ptr(), request))
        {
            request.leave_queue();
            self.requests.with_mut(|q| q.pop_front());
        }
    }

    /// A request stays in the queue until the ReadyForQuery that ends its reply.
    pub(crate) fn has_query_running(&self) -> bool {
        self.current().is_some() || self.flags.get().contains(ConnectionFlags::CANCEL_IN_FLIGHT)
    }

    fn is_running(&self, request: &PostgresSQLQuery) -> bool {
        self.current()
            .is_some_and(|head| core::ptr::eq(&raw const *head, request))
            && !matches!(
                request.status.get(),
                QueryStatus::Pending | QueryStatus::Success | QueryStatus::Fail
            )
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

    pub(crate) fn cancel(&self, request: &PostgresSQLQuery) {
        if request.is_rejected() {
            return;
        }
        request.cancel_copy();
        let status = request.status.get();
        match status {
            QueryStatus::Success | QueryStatus::Fail => {}
            QueryStatus::Pending => {
                self.reject_unwritten(request, self.cancelled_error(None));
                // What waited behind it may not have to wait any more.
                self.advance();
                self.flush_data_and_reset_timeout();
                self.update_poll_ref();
                self.retire_if_idle();
            }
            QueryStatus::Preparing
            | QueryStatus::Binding
            | QueryStatus::Running
            | QueryStatus::PartialResponse => {
                request.update_flags(|f| f.cancel = Cancel::Wanted);
                self.stop_cancelled_head();
                let hint: Option<&[u8]> = match status {
                    // Its Bind is never written. A backend can wait for a lock inside Parse.
                    QueryStatus::Preparing => None,
                    // The backend answers the request that it is asked to stop with an error.
                    _ if request.flags.get().cancel != Cancel::Wanted => return,
                    _ => Some(CANCELLED_ON_THE_WIRE),
                };
                request.reject_in_flight(self.cancelled_error(hint), self.global());
            }
        }
    }

    /// A CancelRequest names the backend, which stops what it is at work on when the signal comes:
    /// the head of the queue, or whatever is written behind it by then. So none goes out while
    /// somebody waits for a request that is written. Nothing is written until it is dealt with.
    fn stop_cancelled_head(&self) {
        let requests = self.requests.get();
        let written = requests
            .len()
            .saturating_sub(self.pending_requests.get() as usize);
        if let Some(head) = self.current()
            && head.flags.get().cancel == Cancel::Wanted
            && self.is_running(&head)
            && requests
                .iter()
                .take(written)
                .all(|request| request.flags.get().cancel == Cancel::Wanted)
            && self.send_cancel_request(&head)
        {
            head.update_flags(|f| f.cancel = Cancel::No);
        }
    }

    /// A CancelRequest travels on a connection of its own. `false`: there is no way to ask now.
    fn send_cancel_request(&self, request: &PostgresSQLQuery) -> bool {
        if self.backend_key_data.get().is_none()
            || self.flags.get().contains(ConnectionFlags::CANCEL_IN_FLIGHT)
        {
            return false;
        }
        let socket = self.socket.get();
        let uws::InternalSocket::Connected(raw) = *socket.socket() else {
            return false;
        };

        // The address of the peer: its name can resolve to another server by now.
        let mut hostname = [0u8; 46];
        let mut hostname_len = 0;
        let mut port = 0;
        if self.path.slice().is_empty() {
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
        // Before the dial: a dial that fails at once ends the hold by itself.
        self.update_flags(|f| f.insert(ConnectionFlags::CANCEL_IN_FLIGHT));
        let dialed = open(
            self.global(),
            group,
            ConnectParams {
                hostname: &hostname[..hostname_len],
                port,
                strings: ConnectionStrings::new(b"", b"", b"", b"", b"", self.path.slice()),
                secure: self.secure.clone(),
                tls_config: Rc::clone(&self.tls_config),
                // Encrypted exactly when this session is, whatever `prefer` would allow.
                ssl_mode: match (self.tls_status.get(), self.ssl_mode) {
                    (TLSStatus::SslOk, SSLMode::Prefer) => SSLMode::Require,
                    (TLSStatus::SslOk, mode) => mode,
                    _ => SSLMode::Disable,
                },
                channel_binding: self.channel_binding,
                idle_timeout_ms: 0,
                connection_timeout_ms: match self.timers.connection_timeout_ms {
                    0 => CANCEL_REQUEST_TIMEOUT_MS,
                    session => session.min(CANCEL_REQUEST_TIMEOUT_MS),
                },
                max_lifetime_ms: 0,
                use_unnamed_prepared_statements: false,
                on_connect: JSValue::ZERO,
                on_close: JSValue::ZERO,
                on_retire: JSValue::UNDEFINED,
                column_transform: JSValue::UNDEFINED,
                check_server_identity: self.check_server_identity_callback(),
                cancel: Some(CancelTarget {
                    session: self.ref_guard(),
                    request: request.ref_guard(),
                }),
            },
        );
        if dialed.is_err() {
            self.update_flags(|f| f.remove(ConnectionFlags::CANCEL_IN_FLIGHT));
        }
        dialed.is_ok()
    }

    /// `asked`: the CancelRequest for `request` went out, and the server has dealt with it.
    fn on_cancel_connection_closed(&self, request: &PostgresSQLQuery, asked: bool) {
        self.update_flags(|f| f.remove(ConnectionFlags::CANCEL_IN_FLIGHT));
        if self.status.get() != Status::Connected {
            return;
        }
        if !asked && self.is_running(request) {
            request.reject_in_flight(
                self.cancelled_error(Some(CANCELLED_ON_THE_WIRE)),
                self.global(),
            );
        }
        self.stop_cancelled_head();
        self.drain_internal();
        self.reset_connection_timeout();
        self.update_poll_ref();
        self.retire_if_idle();
    }

    #[inline]
    pub(crate) fn take_prepared_statement_id(&self) -> u64 {
        let id = self.prepared_statement_id.get();
        self.prepared_statement_id.set(id + 1);
        id
    }

    /// Called right before a Parse is written: the Sync that follows the Parse covers the Close.
    pub(crate) fn close_evicted_statements(&self) {
        while let Some(statement) = self.statements.with_mut(|cache| cache.evict()) {
            if PostgresRequest::write_close_statement(
                &statement.signature.prepared_statement_name,
                self.writer(),
            )
            .is_err()
            {
                return;
            }
        }
    }

    /// A request is in the counter that its flags name, whatever a server makes of its status.
    pub(crate) fn count(&self, request: &PostgresSQLQuery, counter: RequestCounter) {
        let cell = |counter| match counter {
            RequestCounter::None => None,
            RequestCounter::Pending => Some(&self.pending_requests),
            RequestCounter::Nonpipelinable => Some(&self.nonpipelinable_requests),
            RequestCounter::Pipelined => Some(&self.pipelined_requests),
        };
        if let Some(from) = cell(request.flags.get().counter) {
            debug_assert!(from.get() > 0, "request counter underflow");
            from.set(from.get().saturating_sub(1));
        }
        if let Some(to) = cell(counter) {
            to.set(to.get() + 1);
        }
        request.update_flags(|f| f.counter = counter);
    }

    pub(crate) fn can_pipeline(&self) -> bool {
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
        {
            bun_core::hint::cold();
            return false;
        }

        let flags = self.flags.get();
        self.nonpipelinable_requests.get() == 0 // need to wait for non pipelinable requests to finish
            && !flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS) // unnamed statements are not pipelinable
            && !flags.contains(ConnectionFlags::WAITING_TO_PREPARE) // cannot pipeline when waiting prepare
            && !flags.contains(ConnectionFlags::HAS_BACKPRESSURE) // dont make sense to buffer more if we have backpressure
            && self.write_buffer.get().len() < MAX_PIPELINE_SIZE // buffer is too big need to flush before pipeline more
    }
}

// Made by `writer()` and never stored: the connection outlives it.
#[derive(Clone, Copy)]
pub struct Writer {
    pub(crate) connection: BackRef<PostgresSQLConnection>,
}

impl protocol::WriterContext for Writer {
    fn write(self, data: &[u8]) -> Result<(), AnyPostgresError> {
        self.connection
            .write_buffer
            .with_mut(|b| b.write(data))
            .map_err(|_| AnyPostgresError::OutOfMemory)?;
        Ok(())
    }

    fn pwrite(self, data: &[u8], index: usize) -> Result<(), AnyPostgresError> {
        self.connection.write_buffer.with_mut(|b| {
            let index = b.head + index;
            b.byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        });
        Ok(())
    }

    fn offset(self) -> usize {
        self.connection.write_buffer.get().len()
    }
}

impl PostgresSQLConnection {
    pub(crate) fn writer(&self) -> protocol::NewWriter<Writer> {
        protocol::NewWriter {
            wrapped: Writer {
                connection: BackRef::new(self),
            },
        }
    }
}

// Made by `buffered_reader()` and never stored: the connection outlives it.
#[derive(Clone, Copy)]
pub struct Reader {
    pub(crate) connection: BackRef<PostgresSQLConnection>,
}

impl Reader {
    #[inline]
    fn read_buffer(&self) -> &OffsetByteList {
        self.connection.read_buffer.get()
    }
}

impl protocol::ReaderContext for Reader {
    fn mark_message_start(&mut self) {
        let head = self.read_buffer().head;
        self.connection.last_message_start.set(head);
    }

    fn peek(&self) -> &[u8] {
        self.read_buffer().remaining()
    }

    fn skip(&mut self, count: usize) {
        self.connection.read_buffer.with_mut(|buf| {
            buf.head = buf.head.saturating_add(count).min(buf.byte_list.len());
        });
    }

    fn ensure_length(&mut self, count: usize) -> bool {
        let buf = self.read_buffer();
        buf.head + count <= buf.byte_list.len()
    }

    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        let remaining = self.read_buffer().remaining();
        if remaining.len() < count {
            return Err(AnyPostgresError::ShortRead);
        }

        // `skip()` does not reallocate the buffer that the slice points into.
        let slice = bun_ptr::RawSlice::new(&remaining[..count]);
        protocol::ReaderContext::skip(self, count);
        Ok(Data::Temporary(slice))
    }

    fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        let remain = self.read_buffer().remaining();

        if let Some(zero) = strings::index_of_char(remain, 0) {
            // `RawSlice` backref into read_buffer (not reallocated by skip()).
            let slice = bun_ptr::RawSlice::new(&remain[..zero as usize]);
            protocol::ReaderContext::skip(self, zero as usize + 1);
            return Ok(Data::Temporary(slice));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

impl PostgresSQLConnection {
    pub(crate) fn buffered_reader(&self) -> protocol::NewReader<Reader> {
        protocol::NewReader {
            wrapped: Reader {
                connection: BackRef::new(self),
            },
        }
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

    fn has_request_in_flight(&self) -> bool {
        self.pipelined_requests.get() > 0 || self.nonpipelinable_requests.get() > 0
    }

    /// `None` too while the last request that is written waits for its turn to be stopped: with
    /// another one behind it, `stop_cancelled_head` could not ask for that.
    fn first_unwritten(&self) -> Option<RefPtr<PostgresSQLQuery>> {
        let requests = self.requests.get();
        let written = requests
            .len()
            .checked_sub(self.pending_requests.get() as usize);
        debug_assert!(written.is_some(), "pending_requests exceeds the queue");
        let written = written?;
        if written
            .checked_sub(1)
            .and_then(|last| requests.get(last))
            .is_some_and(|last| last.flags.get().cancel == Cancel::Wanted)
        {
            return None;
        }
        requests.get(written).cloned()
    }

    /// `false`: it is not in the queue any more.
    fn remove_unwritten(&self, request: &PostgresSQLQuery) -> bool {
        let requests = self.requests.get();
        let written = requests
            .len()
            .saturating_sub(self.pending_requests.get() as usize);
        let Some(index) = requests
            .iter()
            .skip(written)
            .position(|queued| core::ptr::eq(queued.as_ptr(), request))
        else {
            return false;
        };
        self.count(request, RequestCounter::None);
        request.leave_queue();
        self.requests.with_mut(|q| q.remove(written + index));
        true
    }

    fn reject_unwritten(&self, request: &PostgresSQLQuery, error: JSValue) {
        if self.remove_unwritten(request) {
            request.on_js_error(error, self.global());
        }
    }

    /// A message that was not written to its end is in the buffer: the stream cannot go on.
    fn fail_write(&self, err: AnyPostgresError) -> bool {
        self.fail(b"Failed to write query", err);
        false
    }

    fn note_request_bound(&self, request: &PostgresSQLQuery) {
        self.count(request, RequestCounter::Pipelined);
        request.status.set(QueryStatus::Binding);
    }

    /// `false`: user code ran, or threw and the request is rejected. What was read before is stale.
    fn stage(&self, request: &PostgresSQLQuery, values: JSValue, types: &[Int4]) -> bool {
        if request.flags.get().staged {
            return true;
        }
        request.update_flags(|f| f.staged = true);
        // That code can wait for the reply to a request that is still in the write buffer.
        self.register_auto_flusher();
        let prepared = !self
            .flags
            .get()
            .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS);
        match PostgresRequest::stage_parameters(self.global(), values, types, prepared) {
            Ok(replaced) => !replaced,
            Err(err) => {
                let error = self.global().take_exception(err);
                self.reject_unwritten(request, error);
                false
            }
        }
    }

    /// The only place that writes a request.
    pub(crate) fn advance(&self) {
        if self.advancing.replace(true) {
            return;
        }
        let _advancing = Advancing(self);
        debug!("advance");
        while self.status.get() == Status::Connected
            && !self
                .flags
                .get()
                .intersects(ConnectionFlags::HAS_BACKPRESSURE | ConnectionFlags::CANCEL_IN_FLIGHT)
            && self.dispatch_next()
        {}
    }

    /// `false`: the first unwritten request has to wait.
    fn dispatch_next(&self) -> bool {
        let Some(req) = self.first_unwritten() else {
            return false;
        };
        if req.status.get() == QueryStatus::Preparing {
            return false;
        }
        debug_assert!(req.status.get() == QueryStatus::Pending);

        if req.flags.get().simple {
            if self.has_request_in_flight() {
                return false;
            }
            let query = req.query.to_utf8();
            debug!("execute simple query: {}", bstr::BStr::new(query.slice()));
            // Alone: a Sync elicits a second ReadyForQuery, a Flush stops the server's idle timers.
            if let Err(err) = protocol::write_query(query.slice(), &mut self.writer()) {
                return self.fail_write(err);
            }
            self.count(&req, RequestCounter::Nonpipelinable);
            req.status.set(QueryStatus::Running);
            return true;
        }

        // User code can end the request while its parameters are converted.
        let _statement_ref = req.statement.get().clone();
        let (Some(statement), Some(this_value)) =
            (req.statement_mut(), req.this_value.get().try_get())
        else {
            debug_assert!(false, "a queued request has a statement and a wrapper");
            return self.remove_unwritten(&req);
        };
        let values = postgres_sql_query::js::binding_get_cached(this_value).unwrap_or_default();
        let unnamed = self
            .flags
            .get()
            .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS);

        match statement.status {
            StatementStatus::Failed => {
                debug_assert!(statement.error_response.is_some());
                let error = match &statement.error_response {
                    Some(error) => error
                        .to_js(self.global())
                        .unwrap_or_else(|err| self.global().take_error(err)),
                    None => JSValue::UNDEFINED,
                };
                self.reject_unwritten(&req, error);
            }
            // Replies go to the requests in queue order: nothing is written past this one.
            StatementStatus::Parsing => return false,
            StatementStatus::Prepared => {
                if self.has_request_in_flight() && !self.can_pipeline() {
                    return false;
                }
                if !self.stage(&req, values, statement.parameter_types()) {
                    return true;
                }
                // Whether an unnamed statement is described before its Bind depends on the values.
                // A statement without parameters is prepared before its RowDescription arrives.
                let formats = if unnamed || statement.fields.is_empty() {
                    ResultFormats::Text
                } else if req.flags.get().result_mode == SQLQueryResultMode::Raw {
                    ResultFormats::Raw
                } else {
                    ResultFormats::Decodable
                };
                req.update_flags(|f| f.formats = formats);
                if let Err(err) = if unnamed {
                    PostgresRequest::parse_and_bind_and_execute(
                        self.global(),
                        req.query.to_utf8().slice(),
                        statement,
                        values,
                        formats,
                        false,
                        self.writer(),
                    )
                } else {
                    PostgresRequest::bind_and_execute(
                        self.global(),
                        statement,
                        values,
                        formats,
                        self.writer(),
                    )
                } {
                    return self.fail_write(err);
                }
                self.note_request_bound(&req);
            }
            StatementStatus::Pending => {
                if self.has_request_in_flight() {
                    return false;
                }
                let describe_first =
                    req.flags.get().describe_first && !statement.signature.fields.is_empty();
                if !describe_first && !self.stage(&req, values, statement.parameter_types()) {
                    return true;
                }
                self.close_evicted_statements();
                let query = req.query.to_utf8();
                if let Err(err) = if describe_first {
                    PostgresRequest::parse_and_describe(
                        query.slice(),
                        &statement.signature,
                        self.writer(),
                    )
                } else {
                    PostgresRequest::parse_and_bind_and_execute(
                        self.global(),
                        query.slice(),
                        statement,
                        values,
                        ResultFormats::Text,
                        true,
                        self.writer(),
                    )
                } {
                    return self.fail_write(err);
                }
                statement.status = StatementStatus::Parsing;
                self.update_flags(|f| f.insert(ConnectionFlags::WAITING_TO_PREPARE));
                if describe_first {
                    req.status.set(QueryStatus::Preparing);
                } else {
                    self.note_request_bound(&req);
                }
            }
        }
        true
    }

    pub(crate) fn on<Context: protocol::ReaderContext>(
        &self,
        message_type: MessageType,
        mut reader: protocol::NewReader<Context>,
    ) -> Result<(), AnyPostgresError> {
        #[inline(always)]
        fn pg_err(e: crate::Error) -> AnyPostgresError {
            e.name().parse().unwrap_or(AnyPostgresError::JSError)
        }
        debug!("on({})", <&'static str>::from(message_type));

        match message_type {
            MessageType::DataRow => {
                let request = self.executed()?;
                if request.is_rejected() {
                    // Already rejected, GC protection dropped: discard until ReadyForQuery.
                    return reader.skip_message();
                }

                let statement = request
                    .statement_mut()
                    .ok_or(AnyPostgresError::ExpectedStatement)?;
                let mut structure: JSValue = JSValue::UNDEFINED;
                // `structure()` borrows `*statement` mutably for as long as its result lives, and
                // the fields are read below: hence the lifetime-erased `ParentRef`. `request`
                // keeps the statement alive.
                let mut cached_structure: Option<ParentRef<PostgresCachedStructure>> = None;
                let request_flags = request.flags.get();
                // explicit use switch without else so if new modes are added, we don't forget to check for duplicate fields
                match request_flags.result_mode {
                    SQLQueryResultMode::Objects => {
                        let owner = self.js_value.get().try_get().unwrap_or_default();
                        let cs = statement.structure(owner, self.global());
                        structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                        cached_structure = Some(ParentRef::new(cs));
                    }
                    SQLQueryResultMode::Raw | SQLQueryResultMode::Values => {
                        // no need to check for duplicate fields or structure
                    }
                }

                // Seeded with the field's column kind so a short DataRow still
                // matches the Structure built from these fields.
                let mut cells = RowCells(
                    statement
                        .fields
                        .iter()
                        .enumerate()
                        .map(|(i, field)| {
                            DataCell::SQLDataCell::null_for_column(i as u32, &field.name_or_index)
                        })
                        .collect(),
                );
                let mut putter = DataCell::Putter {
                    list: &mut cells.0,
                    fields: &statement.fields,
                    formats: request_flags.formats,
                    bigint: request_flags.bigint,
                    global_object: self.global(),
                };

                // Tells a cell the client cannot decode from a framing error of `decode` itself.
                let mut cell_failed = false;
                let decode_result = if request_flags.result_mode == SQLQueryResultMode::Raw {
                    protocol::DataRow::decode((), &mut reader, |(), i, b| putter.put_raw(i, b))
                } else {
                    protocol::DataRow::decode((), &mut reader, |(), i, b| {
                        putter.put(i, b).inspect_err(|_| cell_failed = true)
                    })
                };
                if let Err(err) = decode_result {
                    if !cell_failed {
                        return Err(err);
                    }
                    let js_err = self.undecodable_row_error(err)?;
                    request.reject_in_flight(js_err, self.global());
                    return Ok(());
                }

                let Some(this_value) = request.this_value.get().try_get() else {
                    debug_assert!(false, "query value was freed earlier than expected");
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                let pending_value = postgres_sql_query::js::pending_value_get_cached(this_value)
                    .unwrap_or_default();
                pending_value.ensure_still_alive();
                let result = match putter.to_js(
                    pending_value,
                    structure,
                    statement.fields_flags,
                    request_flags.result_mode,
                    cached_structure.as_deref(),
                ) {
                    Ok(result) => result,
                    Err(err) => {
                        let js_err = self.undecodable_row_error(err)?;
                        request.reject_in_flight(js_err, self.global());
                        return Ok(());
                    }
                };

                if pending_value.is_empty() {
                    postgres_sql_query::js::pending_value_set_cached(
                        this_value,
                        self.global(),
                        result,
                    );
                }
            }
            MessageType::CopyData => {
                let upcoming = reader.peek().len();
                let message = protocol::CopyData::decode_internal(reader.reborrow())?;
                self.on_copy_data(message.data.slice(), upcoming);
            }
            MessageType::ParameterStatus => {
                protocol::ParameterStatus::decode_internal(reader.reborrow())?;
            }
            MessageType::ReadyForQuery => {
                let ready_for_query = protocol::ReadyForQuery::decode_internal(reader.reborrow())?;

                if self.status.get() != Status::Connected
                    && !matches!(self.authentication_state.get(), AuthenticationState::Ok)
                {
                    debug!("ReadyForQuery before authentication completed");
                    return Err(AnyPostgresError::UnexpectedMessage);
                }

                self.transaction_status
                    .set(ready_for_query.transaction_status);
                self.set_status(Status::Connected);
                self.update_flags(|f| f.remove(ConnectionFlags::WAITING_TO_PREPARE));

                if let Some(request) = self.current() {
                    if request.flags.get().discard_response {
                        // The end of the response it was kept in flight for.
                        self.count(&request, RequestCounter::None);
                        let request = request.ref_guard();
                        self.discard_request(&request);
                        request.end_rejected(self.global());
                    } else if request.status.get() == QueryStatus::PartialResponse {
                        self.count(&request, RequestCounter::None);
                        // if is a partial response, just signal that the query is now complete
                        request.on_result(b"", self.global(), true);
                        self.discard_request(&request);
                    } else if request.status.get() == QueryStatus::Preparing {
                        request.status.set(QueryStatus::Pending);
                    }
                }
                self.advance();
                self.retire_if_idle();

                self.register_auto_flusher();
                self.update_has_pending_activity();
            }
            MessageType::CommandComplete => {
                let request = self.executed()?;
                if request.is_rejected() {
                    return reader.skip_message();
                }

                let mut cmd: protocol::CommandComplete = Default::default();
                cmd.decode_internal(reader.reborrow())?;
                debug!("-> {}", bstr::BStr::new(cmd.command_tag.slice()));

                request.on_result(cmd.command_tag.slice(), self.global(), false);
                self.update_has_pending_activity();
            }
            MessageType::BindComplete => {
                reader.eat_message(&protocol::BIND_COMPLETE)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                if request.status.get() == QueryStatus::Binding {
                    request.status.set(QueryStatus::Running);
                }
            }
            MessageType::ParseComplete => {
                reader.eat_message(&protocol::PARSE_COMPLETE)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                if let Some(statement) = request.statement_mut() {
                    // if we have params wait for parameter description
                    if statement.status == StatementStatus::Parsing
                        && statement.signature.fields.is_empty()
                    {
                        statement.status = StatementStatus::Prepared;
                        self.update_flags(|f| f.remove(ConnectionFlags::WAITING_TO_PREPARE));
                    }
                }
            }
            MessageType::ParameterDescription => {
                let description =
                    protocol::ParameterDescription::decode_internal(reader.reborrow())?;
                let request = match self.current() {
                    Some(r) => r,
                    None => {
                        drop(description.parameters);
                        return Err(AnyPostgresError::ExpectedRequest);
                    }
                };
                let statement = match request.statement_mut() {
                    Some(s) => s,
                    None => {
                        drop(description.parameters);
                        return Err(AnyPostgresError::ExpectedStatement);
                    }
                };
                statement.parameters = description.parameters;
                if statement.status == StatementStatus::Parsing {
                    statement.status = StatementStatus::Prepared;
                    self.update_flags(|f| f.remove(ConnectionFlags::WAITING_TO_PREPARE));
                }
            }
            MessageType::RowDescription => {
                use crate::shared::cached_structure::{column_name_to_js, transform_name};
                let mut description = protocol::RowDescription::decode_internal(reader.reborrow())?;
                let request = match self.current() {
                    Some(r) => r,
                    None => return Err(AnyPostgresError::ExpectedRequest),
                };
                match request.statement_mut() {
                    // The transform threw at an earlier result of this simple query.
                    Some(s) if s.status == StatementStatus::Failed => return Ok(()),
                    Some(_) => {}
                    None => return Err(AnyPostgresError::ExpectedStatement),
                }
                if let Some(transform) = self
                    .js_value
                    .get()
                    .try_get()
                    .and_then(js::column_transform_get_cached)
                {
                    // User code: it can close the connection or start a query.
                    let _guard = request.ref_guard();
                    let global = self.global();
                    for field in description.fields.iter_mut() {
                        match column_name_to_js(global, &field.name_or_index)
                            .and_then(|name| transform_name(global, transform, name))
                        {
                            Ok(renamed) => field.name_or_index = renamed,
                            Err(e @ jsc::JsError::Thrown) => {
                                let err = global.take_exception(e);
                                // The requests that wait for the statement get the same answer.
                                if let Some(statement) = request.statement_mut() {
                                    statement.status = StatementStatus::Failed;
                                    statement.error_response =
                                        Some(StatementError::Thrown(Strong::create(err, global)));
                                    self.statements.with_mut(|cache| cache.discard(statement));
                                }
                                request.reject_in_flight(err, global);
                                return Ok(());
                            }
                            Err(e) => return Err(jsc::js_error_to_postgres(e)),
                        }
                        if self.status.get() != Status::Connected {
                            return Ok(());
                        }
                    }
                }
                let Some(statement) = request.statement_mut() else {
                    return Ok(());
                };
                // A simple-mode query containing multiple statements (e.g.
                // "SELECT 1; SELECT a, b FROM t") receives one RowDescription per
                // result set while the same statement stays current() until
                // ReadyForQuery. Free any previous fields before overwriting and
                // invalidate state derived from them so the next DataRow builds
                // the correct structure instead of reusing a stale cached one.
                statement.fields = description.fields.into_vec();
                statement.cached_structure = Default::default();
                statement.needs_duplicate_check = true;
                statement.fields_flags = Default::default();
            }
            MessageType::Authentication => {
                let auth = protocol::Authentication::decode_internal(&mut reader)?;

                match &auth {
                    protocol::Authentication::SASL(offered) => {
                        // libpq: "duplicate SASL authentication request".
                        if !matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Pending
                        ) {
                            debug!("duplicate AuthenticationSASL");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        let socket = self.socket.get();
                        let tls = match &socket {
                            Socket::SocketTls(tls) => tls.ssl_mut(),
                            Socket::SocketTcp(_) => None,
                        };
                        match SASL::init(
                            *offered,
                            self.channel_binding,
                            tls,
                            self.ssl_mode != SSLMode::Disable,
                        ) {
                            Ok(sasl) => self
                                .authentication_state
                                .set(AuthenticationState::Sasl(Box::new(sasl))),
                            Err(refusal) => {
                                self.refuse_authentication(refusal);
                                return Ok(());
                            }
                        }

                        let mut mechanism_buf = [0u8; 128];
                        // `sasl` borrow ends before `self.writer()`/`self.flush_data()`
                        // below (neither touches `authentication_state`).
                        let Some(sasl) = self.sasl_state_mut() else {
                            unreachable!()
                        };
                        let mechanism = {
                            use std::io::Write as _;
                            let mut cursor = &mut mechanism_buf[..];
                            let _ = write!(
                                cursor,
                                "{}n=*,r={}",
                                bstr::BStr::new(sasl.gs2_flag.header()),
                                bstr::BStr::new(sasl.nonce())
                            );
                            let written = 128 - cursor.len();
                            mechanism_buf[written] = 0;
                            &mechanism_buf[..written]
                        };
                        let response = protocol::SASLInitialResponse {
                            mechanism: Data::Temporary(bun_ptr::RawSlice::new(
                                sasl.gs2_flag.mechanism(),
                            )),
                            data: Data::Temporary(bun_ptr::RawSlice::new(mechanism)),
                        };

                        response.write_internal(self.writer())?;
                        debug!("SASL");
                        self.flush_data();
                    }
                    protocol::Authentication::SASLContinue(cont) => {
                        let password: &[u8] = self.scram_password.slice();
                        // `sasl` borrow ends before `self.writer()`/`self.flush_data()`
                        // below (neither touches `authentication_state`).
                        let Some(sasl) = self.sasl_state_mut() else {
                            debug!("Unexpected SASLContinue for authentication state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        };

                        if sasl.status != SASLStatus::Init {
                            debug!("Unexpected SASLContinue for SASL state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        debug!("SASLContinue");

                        // RFC 5802 §5.1: the server's combined nonce MUST begin with
                        // the client nonce we sent in the client-first-message.
                        if !cont.r.slice().starts_with(sasl.nonce()) {
                            debug!("SASLContinue server nonce does not start with client nonce");
                            return Err(AnyPostgresError::InvalidMessage);
                        }

                        let iteration_count = cont.iteration_count()?;
                        // RFC 7677 §4: SCRAM-SHA-256 requires a minimum of 4096
                        // iterations. Cap the upper bound to avoid a CPU-burn DoS
                        // from a malicious/MITM'd server sending i ≈ u32::MAX.
                        if !(4096..=10_000_000).contains(&iteration_count) {
                            let mut message: Vec<u8> = Vec::new();
                            {
                                use std::io::Write as _;
                                let _ = write!(
                                    &mut message,
                                    "SCRAM-SHA-256 iteration count {} is out of range: it must be between 4096 and 10000000",
                                    iteration_count
                                );
                            }
                            self.fail(&message, AnyPostgresError::SASLIterationCountOutOfRange);
                            return Ok(());
                        }

                        // Bound the *encoded* length before allocating: a
                        // malicious/MITM'd server can otherwise force an
                        // arbitrarily large decode_alloc here. 1024 decoded
                        // bytes ≈ 1368 base64 chars; round up generously.
                        let server_salt_b64 = cont.s.slice();
                        if server_salt_b64.is_empty() || server_salt_b64.len() > 2048 {
                            debug!(
                                "SASLContinue encoded salt length out of range: {}",
                                server_salt_b64.len()
                            );
                            return Err(AnyPostgresError::InvalidMessage);
                        }
                        let server_salt_decoded_base64 = bun_base64::decode_alloc(server_salt_b64)
                            .map_err(|e| match e {
                                bun_base64::DecodeAllocError::DecodingFailed => {
                                    AnyPostgresError::SASL_SIGNATURE_INVALID_BASE64
                                }
                            })?;
                        if server_salt_decoded_base64.is_empty()
                            || server_salt_decoded_base64.len() > 1024
                        {
                            debug!(
                                "SASLContinue salt length out of range: {}",
                                server_salt_decoded_base64.len()
                            );
                            return Err(AnyPostgresError::InvalidMessage);
                        }
                        sasl.compute_salted_password(
                            &server_salt_decoded_base64,
                            iteration_count,
                            password,
                        )
                        .map_err(pg_err)?;
                        drop(server_salt_decoded_base64);

                        let mut channel_binding_buf = [0u8; sasl::CHANNEL_BINDING_BASE64_MAX_LEN];
                        let channel_binding =
                            bstr::BStr::new(sasl.channel_binding_base64(&mut channel_binding_buf));

                        let mut auth_string: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut auth_string,
                                "n=*,r={},r={},s={},i={},c={},r={}",
                                bstr::BStr::new(sasl.nonce()),
                                bstr::BStr::new(cont.r.slice()),
                                bstr::BStr::new(cont.s.slice()),
                                bstr::BStr::new(cont.i.slice()),
                                channel_binding,
                                bstr::BStr::new(cont.r.slice()),
                            );
                        }
                        sasl.compute_server_signature(&auth_string)
                            .map_err(pg_err)?;

                        let client_key = sasl.client_key();
                        let client_key_signature =
                            sasl.client_key_signature(&client_key, &auth_string);
                        let mut client_key_xor_buffer = [0u8; 32];
                        debug_assert_eq!(client_key.len(), client_key_signature.len());
                        for ((out, a), b) in client_key_xor_buffer
                            .iter_mut()
                            .zip(client_key.iter())
                            .zip(client_key_signature.iter())
                        {
                            *out = a ^ b;
                        }

                        // base64 of 32 bytes → ceil(32/3)*4 = 44; +4 slack.
                        let mut client_key_xor_base64_buf = [0u8; 48];
                        let xor_base64_len = bun_base64::encode(
                            &mut client_key_xor_base64_buf,
                            &client_key_xor_buffer,
                        );

                        let mut payload: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut payload,
                                "c={},r={},p={}",
                                channel_binding,
                                bstr::BStr::new(cont.r.slice()),
                                bstr::BStr::new(&client_key_xor_base64_buf[..xor_base64_len]),
                            );
                        }

                        let response = protocol::SASLResponse {
                            data: Data::Temporary(bun_ptr::RawSlice::new(payload.as_slice())),
                        };

                        sasl.status = SASLStatus::Continue;
                        response.write_internal(&mut self.writer())?;
                        self.flush_data();
                    }
                    protocol::Authentication::SASLFinal { data: final_data } => {
                        // `sasl` borrow ends before `self.fail()` /
                        // `self.authentication_state.set()` below.
                        let Some(sasl) = self.sasl_state_mut() else {
                            debug!("SASLFinal - Unexpected SASLContinue for authentication state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        };

                        if sasl.status != SASLStatus::Continue {
                            debug!("SASLFinal - Unexpected SASLContinue for SASL state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }

                        if sasl.server_signature_len == 0 {
                            debug!("SASLFinal - Server signature is empty");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }

                        let server_signature = sasl.server_signature();

                        // This will usually start with "v="
                        let comparison_signature = final_data.slice();

                        if comparison_signature.len() < 2
                            || !BoringSSL::c::constant_time_eq(
                                server_signature,
                                &comparison_signature[2..],
                            )
                        {
                            debug!(
                                "SASLFinal - SASL Server signature mismatch\nExpected: {}\nActual: {}",
                                bstr::BStr::new(server_signature),
                                bstr::BStr::new(&comparison_signature[2..])
                            );
                            self.fail(
                                b"The server did not return the correct signature",
                                AnyPostgresError::SASL_SIGNATURE_MISMATCH,
                            );
                        } else {
                            debug!("SASLFinal - SASL Server signature match");
                            let channel_bound = sasl.gs2_flag == Gs2Flag::TlsServerEndPoint;
                            self.authentication_state
                                .set(AuthenticationState::SaslVerified { channel_bound });
                        }
                    }
                    protocol::Authentication::Ok => {
                        // RFC 5802 §5: once a SCRAM exchange has begun, the
                        // server must prove itself via SASLFinal (whose
                        // signature check above moves the state to `SaslVerified`)
                        // before AuthenticationOk is acceptable. Accepting Ok
                        // mid-exchange would let a MITM skip the
                        // server-signature verification.
                        if matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Sasl(_)
                        ) {
                            debug!("AuthenticationOk before SASL exchange completed");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        if self.channel_binding == ChannelBinding::Require
                            && !matches!(
                                self.authentication_state.get(),
                                AuthenticationState::SaslVerified {
                                    channel_bound: true
                                }
                            )
                        {
                            self.refuse_authentication(Refusal::NOT_BOUND);
                            return Ok(());
                        }
                        debug!("Authentication OK");
                        self.authentication_state.set(AuthenticationState::Ok);
                    }

                    protocol::Authentication::Unknown => {
                        self.fail(
                            b"Unknown authentication method",
                            AnyPostgresError::UNKNOWN_AUTHENTICATION_METHOD,
                        );
                    }

                    protocol::Authentication::ClearTextPassword => {
                        if !matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Pending
                        ) {
                            debug!("duplicate AuthenticationCleartextPassword");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        if self.channel_binding == ChannelBinding::Require {
                            self.refuse_authentication(Refusal::NOT_A_SASL_REQUEST);
                            return Ok(());
                        }
                        debug!("ClearTextPassword");
                        let response = protocol::PasswordMessage {
                            // password is a valid slice into options_buf.
                            password: Data::Temporary(self.password),
                        };

                        self.authentication_state
                            .set(AuthenticationState::ClearText);
                        response.write_internal(&mut self.writer())?;
                        self.flush_data();
                    }

                    protocol::Authentication::MD5Password { salt } => {
                        if !matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Pending
                        ) {
                            debug!("duplicate AuthenticationMD5Password");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        if self.channel_binding == ChannelBinding::Require {
                            self.refuse_authentication(Refusal::NOT_A_SASL_REQUEST);
                            return Ok(());
                        }
                        debug!("MD5Password");
                        // Format is: md5 + md5(md5(password + username) + salt)
                        let mut first_hash_buf: [u8; 16] = Default::default();
                        let mut first_hash_str = [0u8; 32];
                        let mut final_hash_buf: [u8; 16] = Default::default();
                        let mut final_hash_str = [0u8; 32];
                        let mut final_password_buf = [0u8; 36];

                        // First hash: md5(password + username)
                        let mut first_hasher = bun_sha_hmac::MD5::init();
                        first_hasher.update(self.password());
                        first_hasher.update(self.user());
                        first_hasher.r#final(&mut first_hash_buf);
                        let first_hash_str_output = {
                            let n = bun_core::fmt::bytes_to_hex_lower(
                                &first_hash_buf,
                                &mut first_hash_str,
                            );
                            &first_hash_str[..n]
                        };

                        // Second hash: md5(first_hash + salt)
                        let mut final_hasher = bun_sha_hmac::MD5::init();
                        final_hasher.update(first_hash_str_output);
                        final_hasher.update(salt);
                        final_hasher.r#final(&mut final_hash_buf);
                        let final_hash_str_output = {
                            let n = bun_core::fmt::bytes_to_hex_lower(
                                &final_hash_buf,
                                &mut final_hash_str,
                            );
                            &final_hash_str[..n]
                        };

                        // Format final password as "md5" + final_hash
                        let final_password = {
                            use std::io::Write as _;
                            let mut cur = &mut final_password_buf[..];
                            let _ = write!(cur, "md5{}", bstr::BStr::new(final_hash_str_output));
                            let n = 36 - cur.len();
                            final_password_buf[n] = 0;
                            &final_password_buf[..n]
                        };

                        let response = protocol::PasswordMessage {
                            password: Data::Temporary(bun_ptr::RawSlice::new(final_password)),
                        };

                        self.authentication_state.set(AuthenticationState::Md5);
                        response.write_internal(&mut self.writer())?;
                        self.flush_data();
                    }

                    protocol::Authentication::KerberosV5 => self.fail(
                        b"Kerberos V5 authentication is not supported",
                        AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD,
                    ),
                    protocol::Authentication::GSS
                    | protocol::Authentication::GSSContinue { .. } => self.fail(
                        b"GSSAPI authentication is not supported",
                        AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD,
                    ),
                    protocol::Authentication::SSPI => self.fail(
                        b"SSPI authentication is not supported",
                        AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD,
                    ),
                }
            }
            MessageType::NoData => {
                reader.eat_message(&protocol::NO_DATA)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                if request.status.get() == QueryStatus::Binding {
                    request.status.set(QueryStatus::Running);
                }
            }
            MessageType::BackendKeyData => {
                self.backend_key_data
                    .set(Some(protocol::BackendKeyData::decode_internal(
                        reader.reborrow(),
                    )?));
            }
            MessageType::ErrorResponse => {
                let err = protocol::ErrorResponse::decode_internal(reader.reborrow())?;

                // In the handshake, with nothing in flight or on a fatal error, the session ends.
                let request = match self.status.get() {
                    Status::Connecting | Status::SentStartupMessage => None,
                    _ if err.is_fatal() => None,
                    _ => self.current(),
                };
                let Some(request) = request else {
                    let v =
                        crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                    drop(err);
                    self.fail_with_js_value(v);
                    return Ok(());
                };
                let js_err =
                    crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                if let Some(stmt) = request.statement_mut() {
                    if stmt.status == StatementStatus::Parsing && err.is_query_canceled() {
                        // It says nothing about the statement: the next request parses it again.
                        stmt.status = StatementStatus::Pending;
                    } else if stmt.status == StatementStatus::Parsing {
                        stmt.status = StatementStatus::Failed;
                        stmt.error_response = Some(
                            crate::postgres::postgres_sql_statement::Error::Protocol(err),
                        );
                        // The request still holds another ref; this cannot drop to 0.
                        self.statements.with_mut(|cache| cache.remove(stmt));
                    } else if stmt.status == StatementStatus::Prepared
                        && !stmt.signature.prepared_statement_name.is_empty()
                        // Before BindComplete nothing of the statement has run. After it the same
                        // code comes from the query itself.
                        && request.status.get() == QueryStatus::Binding
                        && err.invalidates_prepared_statement()
                    {
                        // What is written behind it runs whatever becomes of it, so a retry would run
                        // after that. In a transaction block a retry gets 25P02.
                        if self.pipelined_requests.get() == 1
                            && !request.flags.get().retried
                            && !self.is_in_transaction()
                        {
                            let replacement = self.statements.with_mut(|cache| {
                                cache.replace(request.query.to_utf8().slice(), stmt, || {
                                    self.take_prepared_statement_id()
                                })
                            });
                            request.statement.set(Some(replacement));
                            request.update_flags(|f| {
                                f.retried = true;
                                f.formats = ResultFormats::Text;
                            });
                            // It keeps its place: nothing is written until its ReadyForQuery, then it.
                            self.count(&request, RequestCounter::Pending);
                            request.status.set(QueryStatus::Preparing);
                            return Ok(());
                        }
                        self.statements.with_mut(|cache| cache.discard(stmt));
                    }
                }
                self.update_has_pending_activity();
                request.reject_at_ready_for_query(js_err, self.global());
            }
            MessageType::PortalSuspended => {
                reader.skip_message()?;
                debug!("TODO PortalSuspended");
            }
            MessageType::CloseComplete => {
                // The answer to `close_evicted_statements`.
                reader.eat_message(&protocol::CLOSE_COMPLETE)?;
            }
            MessageType::CopyInResponse => {
                reader.skip_message()?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                self.on_copy_in_response(&request)?;
            }
            MessageType::NoticeResponse => {
                debug!("UNSUPPORTED NoticeResponse");
                let _resp = protocol::NoticeResponse::decode_internal(reader.reborrow())?;
            }
            MessageType::NotificationResponse => {
                let resp = protocol::NotificationResponse::decode_internal(reader.reborrow())?;
                self.on_notification(resp.channel.slice(), resp.payload.slice())?;
            }
            MessageType::EmptyQueryResponse => {
                reader.eat_message(&protocol::EMPTY_QUERY_RESPONSE)?;
                let request = self.executed()?;
                if request.is_rejected() {
                    return Ok(());
                }
                request.on_result(b"", self.global(), false);
                self.update_has_pending_activity();
            }
            MessageType::CopyOutResponse => {
                reader.skip_message()?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                self.on_copy_out_response(&request);
            }
            MessageType::CopyDone => {
                reader.skip_message()?;
                self.on_copy_done();
            }
            MessageType::CopyBothResponse => {
                reader.skip_message()?;
                self.fail(
                    b"Streaming replication is not supported",
                    AnyPostgresError::CopyNotSupported,
                );
            }
        }
        Ok(())
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
    /// failure like any other in [`Self::on`]: `JSError` takes the pending exception.
    fn on_notification(&self, channel: &[u8], payload: &[u8]) -> Result<(), AnyPostgresError> {
        let Some(this_value) = self.js_value.get().try_get() else {
            return Ok(());
        };
        let Some(callback) = js::onnotification_get_cached(this_value) else {
            return Ok(());
        };
        let global = self.global();
        let channel_js = self.channel_name_js(global, channel)?;
        let payload_js = bun_string_jsc::create_utf8_for_js(global, payload)
            .map_err(crate::jsc::js_error_to_postgres)?;
        run_callback(global, callback, &[channel_js, payload_js]);
        Ok(())
    }

    pub(crate) fn consume_on_connect_callback(
        &self,
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        debug!("consumeOnConnectCallback");
        let js_value = self.js_value.get().get();
        let on_connect = js::onconnect_get_cached(js_value)?;
        debug!("consumeOnConnectCallback exists");

        js::onconnect_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_connect)
    }

    pub(crate) fn consume_on_close_callback(
        &self,
        global_object: &JSGlobalObject,
    ) -> Option<JSValue> {
        debug!("consumeOnCloseCallback");
        let js_value = self.js_value.get().get();
        let on_close = js::onclose_get_cached(js_value)?;
        debug!("consumeOnCloseCallback exists");
        js::onclose_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_close)
    }
}
