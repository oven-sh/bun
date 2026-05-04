use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::{self, Output};
use bun_str::{self as bstr_mod, strings, String as BunString};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, VirtualMachine};
use bun_uws as uws;
use bun_aio::KeepAlive;
use bun_boringssl as BoringSSL;
use bun_collections::{HashMap, StringMap, OffsetByteList};
use bun_core::api::Timer::EventLoopTimer;
use bun_jsc::webcore::AutoFlusher;

use crate::postgres::data_cell as DataCell;
use crate::shared::CachedStructure as PostgresCachedStructure;
use crate::postgres::PostgresRequest;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use bun_sql::postgres::SocketMonitor;
use bun_sql::postgres::PostgresProtocol as protocol;
use crate::postgres::AuthenticationState;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::Data;
use bun_sql::postgres::SSLMode;
use bun_sql::postgres::Status;
use bun_sql::postgres::TLSStatus;
use bun_sql::postgres::{AnyPostgresError, create_postgres_error, postgres_error_to_js};

type Socket = uws::AnySocket;

bun_output::declare_scope!(Postgres, visible);
macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(Postgres, $($arg)*) };
}

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

// TODO(port): PreparedStatementsMap uses IdentityContext(u64) (key is already a hash) at 80% load.
type PreparedStatementsMap = HashMap<u64, *mut PostgresSQLStatement>;

pub mod js {
    pub use bun_jsc::codegen::JSPostgresSQLConnection::*;
}
pub use js::{from_js, from_js_direct, to_js};

#[bun_jsc::JsClass]
pub struct PostgresSQLConnection {
    // TODO(port): bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive refcount;
    // ref()/deref() forward to this. When it hits 0, `deinit` runs and frees the Box.
    pub socket: Socket,
    pub status: Status,
    pub ref_count: Cell<u32>,

    pub write_buffer: OffsetByteList,
    pub read_buffer: OffsetByteList,
    pub last_message_start: u32,
    pub requests: PostgresRequest::Queue,
    /// number of pipelined requests (Bind/Execute/Prepared statements)
    pub pipelined_requests: u32,
    /// number of non-pipelined requests (Simple/Copy)
    pub nonpipelinable_requests: u32,

    pub poll_ref: KeepAlive,
    pub global_object: *mut JSGlobalObject,
    pub vm: *mut VirtualMachine,
    pub statements: PreparedStatementsMap,
    pub prepared_statement_id: u64,
    pub pending_activity_count: AtomicU32,
    // Self-wrapper back-ref (the JS object that owns this payload). Stored as a
    // weak `JsRef`, never a bare `JSValue` — this struct is heap-allocated and
    // the conservative GC scan covers stack/registers only.
    pub js_value: bun_jsc::JsRef,

    pub backend_parameters: StringMap,
    pub backend_key_data: protocol::BackendKeyData,

    // TODO(port): self-referential — `database`/`user`/`password`/`path`/`options` are
    // slices into `options_buf` (built via StringBuilder in `call`). Struct is Box-allocated
    // and never moves (intrusive refcount), so raw fat pointers are sound. Phase B: consider
    // (offset,len) pairs or a dedicated borrowed-slice newtype.
    pub database: *const [u8],
    pub user: *const [u8],
    pub password: *const [u8],
    pub path: *const [u8],
    pub options: *const [u8],
    pub options_buf: Box<[u8]>,

    pub authentication_state: AuthenticationState,

    /// `us_ssl_ctx_t` built from `tls_config` at construct time. Applied via
    /// `us_socket_adopt_tls` when the server replies `S` to the SSLRequest.
    pub secure: Option<*mut uws::SslCtx>,
    pub tls_config: jsc::api::ServerConfig::SSLConfig,
    pub tls_status: TLSStatus,
    pub ssl_mode: SSLMode,

    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,

    pub flags: ConnectionFlags,

    /// Before being connected, this is a connection timeout timer.
    /// After being connected, this is an idle timeout timer.
    pub timer: EventLoopTimer,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    pub max_lifetime_timer: EventLoopTimer,
    pub auto_flusher: AutoFlusher,
}

impl PostgresSQLConnection {
    // pub const ref = RefCount.ref; pub const deref = RefCount.deref;
    // TODO(port): intrusive refcount methods provided by bun_ptr::IntrusiveRc derive.
    pub fn r#ref(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: ref_count hit zero; we are the last owner of this Box-allocated struct.
            unsafe { (*(self as *const Self as *mut Self)).deinit() };
        }
    }

    #[inline]
    fn global(&self) -> &JSGlobalObject {
        // SAFETY: JSC_BORROW — global_object outlives this connection (owned by VM).
        unsafe { &*self.global_object }
    }
    #[inline]
    fn vm(&self) -> &mut VirtualMachine {
        // SAFETY: JSC_BORROW — vm outlives this connection.
        unsafe { &mut *self.vm }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        if self.flags.has_backpressure {
            debug!("onAutoFlush: has backpressure");
            self.auto_flusher.registered = false;
            // if we have backpressure, wait for onWritable
            return false;
        }
        self.r#ref();
        debug!("onAutoFlush: draining");
        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = !self.flags.has_backpressure && self.write_buffer.len() > 0;
        debug!("onAutoFlush: keep_flusher_registered: {}", keep_flusher_registered);
        self.auto_flusher.registered = keep_flusher_registered;
        self.deref();
        keep_flusher_registered
    }

    fn register_auto_flusher(&mut self) {
        let data_to_send = self.write_buffer.len();
        debug!(
            "registerAutoFlusher: backpressure: {} registered: {} data_to_send: {}",
            self.flags.has_backpressure, self.auto_flusher.registered, data_to_send
        );

        if !self.auto_flusher.registered // should not be registered
            && !self.flags.has_backpressure // if has backpressure we need to wait for onWritable event
            && data_to_send > 0 // we need data to send
            && self.status == Status::Connected
        // and we need to be connected
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, self.vm());
            self.auto_flusher.registered = true;
        }
    }

    fn unregister_auto_flusher(&mut self) {
        debug!("unregisterAutoFlusher registered: {}", self.auto_flusher.registered);
        if self.auto_flusher.registered {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, self.vm());
            self.auto_flusher.registered = false;
        }
    }

    fn get_timeout_interval(&self) -> u32 {
        match self.status {
            Status::Connected => self.idle_timeout_interval_ms,
            Status::Failed => 0,
            _ => self.connection_timeout_ms,
        }
    }

    pub fn disable_connection_timeout(&mut self) {
        if self.timer.state == EventLoopTimer::State::ACTIVE {
            self.vm().timer.remove(&mut self.timer);
        }
        self.timer.state = EventLoopTimer::State::CANCELLED;
    }

    pub fn reset_connection_timeout(&mut self) {
        // if we are processing data, don't reset the timeout, wait for the data to be processed
        if self.flags.is_processing_data {
            return;
        }
        let interval = self.get_timeout_interval();
        if self.timer.state == EventLoopTimer::State::ACTIVE {
            self.vm().timer.remove(&mut self.timer);
        }
        if interval == 0 {
            return;
        }

        self.timer.next = bun_core::timespec::ms_from_now(bun_core::timespec::Mode::AllowMockedTime, i64::from(interval));
        self.vm().timer.insert(&mut self.timer);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_queries(_this: &Self, this_value: JSValue, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(value) = js::queries_get_cached(this_value) {
            return Ok(value);
        }

        let array = JSValue::create_empty_array(global_object, 0)?;
        js::queries_set_cached(this_value, global_object, array);

        Ok(array)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_connect(_this: &Self, this_value: JSValue, _global_object: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onconnect_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_connect(_this: &mut Self, this_value: JSValue, global_object: &JSGlobalObject, value: JSValue) {
        js::onconnect_set_cached(this_value, global_object, value);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_close(_this: &Self, this_value: JSValue, _global_object: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onclose_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_close(_this: &mut Self, this_value: JSValue, global_object: &JSGlobalObject, value: JSValue) {
        js::onclose_set_cached(this_value, global_object, value);
    }

    pub fn setup_tls(&mut self) {
        debug!("setupTLS");
        let tls_group = self.vm().rare_data().postgres_group(self.vm(), true);
        let Some(new_socket) = self.socket.socket_tcp().socket.connected.adopt_tls(
            tls_group,
            uws::SocketKind::PostgresTls,
            self.secure.unwrap(),
            self.tls_config.server_name,
            core::mem::size_of::<Option<*mut PostgresSQLConnection>>(),
            core::mem::size_of::<Option<*mut PostgresSQLConnection>>(),
        ) else {
            self.fail("Failed to upgrade to TLS", AnyPostgresError::TLSUpgradeFailed);
            return;
        };
        // SAFETY: ext slot is sized for `Option<*mut PostgresSQLConnection>` above.
        unsafe { *new_socket.ext::<Option<*mut PostgresSQLConnection>>() = Some(self as *mut Self) };
        self.socket = Socket::SocketTLS(uws::SocketTLS { socket: uws::SocketState::Connected(new_socket) });
        // ext is now repointed; safe to kick the handshake (any dispatch lands here).
        new_socket.start_tls_handshake();
        self.start();
    }

    fn setup_max_lifetime_timer_if_necessary(&mut self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        if self.max_lifetime_timer.state == EventLoopTimer::State::ACTIVE {
            return;
        }

        self.max_lifetime_timer.next =
            bun_core::timespec::ms_from_now(bun_core::timespec::Mode::AllowMockedTime, i64::from(self.max_lifetime_interval_ms));
        self.vm().timer.insert(&mut self.max_lifetime_timer);
    }

    pub fn on_connection_timeout(&mut self) {
        debug!("onConnectionTimeout");

        self.timer.state = EventLoopTimer::State::FIRED;
        if self.flags.is_processing_data {
            return;
        }

        if self.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        match self.status {
            Status::Connected => {
                self.fail_fmt(
                    b"ERR_POSTGRES_IDLE_TIMEOUT",
                    format_args!(
                        "Idle timeout reached after {}",
                        bun_core::fmt::fmt_duration_one_decimal(
                            (self.idle_timeout_interval_ms as u64).saturating_mul(1_000_000)
                        )
                    ),
                );
            }
            Status::SentStartupMessage => {
                self.fail_fmt(
                    b"ERR_POSTGRES_CONNECTION_TIMEOUT",
                    format_args!(
                        "Connection timeout after {} (sent startup message, but never received response)",
                        bun_core::fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(1_000_000)
                        )
                    ),
                );
            }
            _ => {
                self.fail_fmt(
                    b"ERR_POSTGRES_CONNECTION_TIMEOUT",
                    format_args!(
                        "Connection timeout after {}",
                        bun_core::fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(1_000_000)
                        )
                    ),
                );
            }
        }
    }

    pub fn on_max_lifetime_timeout(&mut self) {
        debug!("onMaxLifetimeTimeout");
        self.max_lifetime_timer.state = EventLoopTimer::State::FIRED;
        if self.status == Status::Failed {
            return;
        }
        self.fail_fmt(
            b"ERR_POSTGRES_LIFETIME_TIMEOUT",
            format_args!(
                "Max lifetime timeout reached after {}",
                bun_core::fmt::fmt_duration_one_decimal(
                    (self.max_lifetime_interval_ms as u64).saturating_mul(1_000_000)
                )
            ),
        );
    }

    fn start(&mut self) {
        self.setup_max_lifetime_timer_if_necessary();
        self.reset_connection_timeout();
        self.send_startup_message();

        self.drain_internal();
    }

    #[bun_jsc::host_call]
    pub extern fn has_pending_activity(this: *mut Self) -> bool {
        // SAFETY: called on GC thread; reads only atomic field.
        unsafe { (*this).pending_activity_count.load(Ordering::Acquire) > 0 }
    }

    fn update_has_pending_activity(&mut self) {
        let a: u32 = if self.requests.readable_length() > 0 { 1 } else { 0 };
        let b: u32 = match self.status {
            // Terminal states: nothing more will happen on this connection, so
            // allow GC to collect the JS wrapper (and ultimately call deinit()).
            // We must still outlive the socket's onClose callback — for SSL
            // sockets `close(.normal)` defers the actual close until the peer's
            // close_notify arrives, so the struct must stay alive until then.
            // The socket's onClose re-enters here (via failWithJSValue's defer)
            // with isClosed() == true, at which point GC can proceed.
            Status::Disconnected | Status::Failed => (!self.socket.is_closed()) as u32,
            _ => 1,
        };
        self.pending_activity_count.store(a + b, Ordering::Release);
    }

    pub fn set_status(&mut self, status: Status) {
        if self.status == status {
            return;
        }
        // PORT NOTE: reshaped for borrowck — `defer this.updateHasPendingActivity()` moved to explicit calls below.

        self.status = status;
        self.reset_connection_timeout();
        if self.vm().is_shutting_down() {
            self.update_has_pending_activity();
            return;
        }

        match status {
            Status::Connected => {
                let Some(on_connect) = self.consume_on_connect_callback(self.global()) else {
                    self.update_has_pending_activity();
                    return;
                };
                let js_value = self.js_value.get();
                js_value.ensure_still_alive();
                self.global().queue_microtask(on_connect, &[JSValue::NULL, js_value]);
                self.poll_ref.unref(self.vm());
            }
            _ => {}
        }
        self.update_has_pending_activity();
    }

    pub fn finalize(this: *mut Self) {
        debug!("PostgresSQLConnection finalize");
        // SAFETY: called on mutator thread during lazy sweep; `this` is valid.
        let this = unsafe { &mut *this };
        this.stop_timers();
        this.js_value.finalize();
        this.deref();
    }

    pub fn flush_data_and_reset_timeout(&mut self) {
        self.reset_connection_timeout();
        // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
        self.register_auto_flusher();
    }

    pub fn flush_data(&mut self) {
        // we know we still have backpressure so just return we will flush later
        if self.flags.has_backpressure {
            debug!("flushData: has backpressure");
            return;
        }

        let chunk = self.write_buffer.remaining();
        if chunk.is_empty() {
            debug!("flushData: no data to flush");
            return;
        }

        let wrote = self.socket.write(chunk);
        self.flags.has_backpressure = wrote < 0 || (wrote as usize) < chunk.len();
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            SocketMonitor::write(&chunk[..usize::try_from(wrote).unwrap()]);
            self.write_buffer.consume(u32::try_from(wrote).unwrap());
        }
    }

    pub fn fail_with_js_value(&mut self, value: JSValue) {
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.updateHasPendingActivity()` +
        // `defer this.refAndClose(value)`; expanded inline at each return below.
        self.stop_timers();
        if self.status == Status::Failed {
            self.update_has_pending_activity();
            return;
        }

        self.status = Status::Failed;

        self.r#ref();
        // we defer the refAndClose so the on_close will be called first before we reject the pending requests
        let on_close_opt = self.consume_on_close_callback(self.global());
        if let Some(on_close) = on_close_opt {
            let event_loop = self.vm().event_loop();
            event_loop.enter();
            let mut js_error = value.to_error().unwrap_or(value);
            if js_error.is_empty() {
                js_error = postgres_error_to_js(self.global(), Some(b"Connection closed"), AnyPostgresError::ConnectionClosed);
            }
            js_error.ensure_still_alive();
            let queries = self.get_queries_array();
            if let Err(e) = on_close.call(self.global(), JSValue::UNDEFINED, &[js_error, queries]) {
                self.global().report_active_exception_as_unhandled(e);
            }
            event_loop.exit();
        }
        self.ref_and_close(Some(value));
        self.deref();
        self.update_has_pending_activity();
    }

    pub fn fail_fmt(&mut self, code: &[u8], args: core::fmt::Arguments<'_>) {
        // PORT NOTE: Zig used `comptime fmt: [:0]const u8, args: anytype` → collapsed to fmt::Arguments.
        let mut message: Vec<u8> = Vec::new();
        use std::io::Write as _;
        let _ = write!(&mut message, "{}", args);

        let err = match create_postgres_error(self.global(), &message, create_postgres_error::Options { code: Some(code), ..Default::default() }) {
            Ok(v) => v,
            Err(e) => self.global().take_error(e),
        };

        self.fail_with_js_value(err);
    }

    pub fn fail(&mut self, message: &[u8], err: AnyPostgresError) {
        debug!("failed: {}: {}", bstr::BStr::new(message), <&'static str>::from(err));

        let global_object = self.global();

        self.fail_with_js_value(postgres_error_to_js(global_object, Some(message), err));
    }

    pub fn on_close(&mut self) {
        self.unregister_auto_flusher();

        if self.vm().is_shutting_down() {
            self.stop_timers();
            if self.status == Status::Failed {
                self.update_has_pending_activity();
                return;
            }

            self.status = Status::Failed;
            self.clean_up_requests(None);
            self.update_has_pending_activity();
        } else {
            let event_loop = self.vm().event_loop();
            event_loop.enter();
            self.poll_ref.unref(self.vm());

            self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed);
            event_loop.exit();
        }
    }

    fn send_startup_message(&mut self) {
        if self.status != Status::Connecting {
            return;
        }
        debug!("sendStartupMessage");
        self.status = Status::SentStartupMessage;
        // SAFETY: user/database/options are valid slices into options_buf for the lifetime of self.
        let mut msg = protocol::StartupMessage {
            user: Data::Temporary(unsafe { &*self.user }),
            database: Data::Temporary(unsafe { &*self.database }),
            options: Data::Temporary(unsafe { &*self.options }),
        };
        if let Err(err) = msg.write_internal(self.writer()) {
            self.fail(b"Failed to write startup message", err);
        }
    }

    fn start_tls(&mut self, socket: uws::AnySocket) {
        debug!("startTLS");
        let offset: u8 = match self.tls_status {
            TLSStatus::MessageSent(count) => count,
            _ => 0,
        };
        let ssl_request: [u8; 8] = [
            0x00, 0x00, 0x00, 0x08, // Length
            0x04, 0xD2, 0x16, 0x2F, // SSL request code
        ];

        let written = socket.write(&ssl_request[offset as usize..]);
        if written > 0 {
            self.tls_status = TLSStatus::MessageSent(offset + u8::try_from(written).unwrap());
        } else {
            self.tls_status = TLSStatus::MessageSent(offset);
        }
    }

    pub fn on_open(&mut self, socket: uws::AnySocket) {
        self.socket = socket;

        self.poll_ref.r#ref(self.vm());
        self.update_has_pending_activity();

        if matches!(self.tls_status, TLSStatus::MessageSent(_) | TLSStatus::Pending) {
            self.start_tls(socket);
            return;
        }

        self.start();
    }

    pub fn on_handshake(&mut self, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        debug!("onHandshake: {} {}", success, ssl_error.error_no);
        let handshake_success = success == 1;
        if handshake_success {
            if self.tls_config.reject_unauthorized != 0 {
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            let Ok(v) = ssl_error.to_js(self.global()) else { return };
                            self.fail_with_js_value(v);
                            return;
                        }

                        // SAFETY: native handle of a connected TLS socket is `SSL*`.
                        let ssl_ptr: *mut BoringSSL::c::SSL = self.socket.get_native_handle().cast();
                        if let Some(servername) = unsafe { BoringSSL::c::SSL_get_servername(ssl_ptr, 0).as_ref() } {
                            // SAFETY: SSL_get_servername returns a NUL-terminated C string.
                            let hostname = unsafe { core::ffi::CStr::from_ptr(servername as *const _ as *const core::ffi::c_char) }.to_bytes();
                            if !BoringSSL::check_server_identity(ssl_ptr, hostname) {
                                let Ok(v) = ssl_error.to_js(self.global()) else { return };
                                self.fail_with_js_value(v);
                            }
                        }
                    }
                    // require is the same as prefer
                    SSLMode::Require | SSLMode::Prefer | SSLMode::Disable => {}
                }
            }
        } else {
            // if we are here is because server rejected us, and the error_no is the cause of this
            // no matter if reject_unauthorized is false because we are disconnected by the server
            let Ok(v) = ssl_error.to_js(self.global()) else { return };
            self.fail_with_js_value(v);
        }
    }

    pub fn on_timeout(&mut self) {
        debug!("onTimeout");
    }

    pub fn on_drain(&mut self) {
        debug!("onDrain");
        self.flags.has_backpressure = false;
        // Don't send any other messages while we're waiting for TLS.
        if let TLSStatus::MessageSent(sent) = self.tls_status {
            if sent < 8 {
                self.start_tls(self.socket);
            }
            return;
        }

        self.drain_internal();
    }

    fn drain_internal(&mut self) {
        debug!("drainInternal");
        if self.vm().is_shutting_down() {
            return self.close();
        }

        let event_loop = self.vm().event_loop();
        event_loop.enter();

        self.flush_data();

        if !self.flags.has_backpressure && self.flags.is_ready_for_query {
            // no backpressure yet so pipeline more if possible and flush again
            self.advance();
            self.flush_data();
        }
        event_loop.exit();
    }

    pub fn on_data(&mut self, data: &[u8]) {
        self.r#ref();
        self.flags.is_processing_data = true;
        let vm = self.vm();

        self.disable_connection_timeout();
        // PORT NOTE: Zig `defer { ... }` block expanded after the body below; cannot use scopeguard
        // because it captures &mut self alongside the body.

        let event_loop = vm.event_loop();
        event_loop.enter();
        SocketMonitor::read(data);
        // reset the head to the last message so remaining reflects the right amount of bytes
        self.read_buffer.head = self.last_message_start;

        let mut done = false;
        if self.read_buffer.remaining().is_empty() {
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
                            offset, consumed, data.len()
                        );

                        self.read_buffer.head = 0;
                        self.last_message_start = 0;
                        self.read_buffer.byte_list.len = 0;
                        self.read_buffer.write(&data[offset..]).expect("failed to write to read buffer");
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
            self.read_buffer.write(data).expect("failed to write to read buffer");
            match PostgresRequest::on_data(self, self.buffered_reader()) {
                Ok(()) => {
                    debug!("clean read_buffer");
                    // success, we read everything! let's reset the last message start and the head
                    self.last_message_start = 0;
                    self.read_buffer.head = 0;
                }
                Err(err) => {
                    if err != AnyPostgresError::ShortRead {
                        bun_core::handle_error_return_trace(err);
                        self.fail(b"Failed to read data", err);
                    } else {
                        #[cfg(debug_assertions)]
                        debug!(
                            "read_buffer: not empty and received short read: last_message_start: {}, head: {}, len: {}",
                            self.last_message_start, self.read_buffer.head, self.read_buffer.byte_list.len
                        );
                    }
                }
            }
        }

        event_loop.exit();
        // === defer block ===
        if self.status == Status::Connected && !self.has_query_running() && self.write_buffer.remaining().is_empty() {
            // Don't keep the process alive when there's nothing to do.
            self.poll_ref.unref(vm);
        } else if self.status == Status::Connected {
            // Keep the process alive if there's something to do.
            self.poll_ref.r#ref(vm);
        }
        self.flags.is_processing_data = false;

        // reset the connection timeout after we're done processing the data
        self.reset_connection_timeout();
        self.deref();
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<*mut PostgresSQLConnection> {
        global_object.throw("PostgresSQLConnection cannot be constructed directly", &[])
    }
}

// comptime { @export(&jsc.toJSHostFn(call), .{ .name = "PostgresSQLConnection__createInstance" }) }
// TODO(port): the #[bun_jsc::host_fn] attribute on `call` should emit the correct
// `#[unsafe(no_mangle)] extern "C"` shim named `PostgresSQLConnection__createInstance`.
#[unsafe(no_mangle)]
pub extern "C" fn PostgresSQLConnection__createInstance(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    bun_jsc::to_js_host_fn(call)(global, callframe)
}

#[bun_jsc::host_fn]
pub fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let vm = global_object.bun_vm();
    let arguments = callframe.arguments();
    let hostname_str = arguments[0].to_bun_string(global_object)?;
    let port = arguments[1].coerce::<i32>(global_object)?;

    let username_str = arguments[2].to_bun_string(global_object)?;
    let password_str = arguments[3].to_bun_string(global_object)?;
    let database_str = arguments[4].to_bun_string(global_object)?;
    let ssl_mode: SSLMode = match arguments[5].to_int32() {
        0 => SSLMode::Disable,
        1 => SSLMode::Prefer,
        2 => SSLMode::Require,
        3 => SSLMode::VerifyCa,
        4 => SSLMode::VerifyFull,
        _ => SSLMode::Disable,
    };

    let tls_object = arguments[6];

    let mut tls_config: jsc::api::ServerConfig::SSLConfig = Default::default();
    let mut secure: Option<*mut uws::SslCtx> = None;
    if ssl_mode != SSLMode::Disable {
        tls_config = if tls_object.is_boolean() && tls_object.to_boolean() {
            Default::default()
        } else if tls_object.is_object() {
            match jsc::api::ServerConfig::SSLConfig::from_js(vm, global_object, tls_object) {
                Ok(opt) => opt.unwrap_or_default(),
                Err(_) => return Ok(JSValue::ZERO),
            }
        } else {
            return global_object.throw_invalid_arguments("tls must be a boolean or an object", &[]);
        };

        if global_object.has_exception() {
            drop(tls_config);
            return Ok(JSValue::ZERO);
        }

        // We always request the cert so we can verify it and also we manually
        // abort the connection if the hostname doesn't match. Built here (not
        // at STARTTLS time) so cert/CA errors throw synchronously. Goes
        // through the per-VM weak `SSLContextCache` so every connection in the
        // pool — and every reconnect — shares one `SSL_CTX*` per distinct
        // config instead of building a fresh one per `PostgresSQLConnection`.
        let mut err: uws::create_bun_socket_error_t = uws::create_bun_socket_error_t::None;
        secure = vm.rare_data().ssl_ctx_cache().get_or_create_opts(tls_config.as_usockets_for_client_verification(), &mut err);
        if secure.is_none() {
            drop(tls_config);
            return global_object.throw_value(err.to_js(global_object));
        }
    }
    // Covers `try arguments[7/8].toBunString()` and the null-byte rejection
    // below. Ownership passes into `ptr.*` once allocated — locals are nulled
    // there so the connect-fail path's `ptr.deinit()` is the sole cleanup.
    let errdefer_guard = scopeguard::guard((secure, &mut tls_config as *mut _), |(secure, tls_config)| {
        if let Some(s) = secure {
            // SAFETY: SSL_CTX_free is safe to call on a valid SSL_CTX*.
            unsafe { BoringSSL::c::SSL_CTX_free(s) };
        }
        // SAFETY: tls_config is still valid; drop it.
        unsafe { core::ptr::drop_in_place(tls_config) };
        // TODO(port): errdefer — this guard captures raw ptr to tls_config; revisit ownership in Phase B.
    });

    let mut username: &[u8] = b"";
    let mut password: &[u8] = b"";
    let mut database: &[u8] = b"";
    let mut options: &[u8] = b"";
    let mut path: &[u8] = b"";

    let options_str = arguments[7].to_bun_string(global_object)?;

    let path_str = arguments[8].to_bun_string(global_object)?;

    let options_buf: Box<[u8]> = 'brk: {
        let mut b = bun_str::StringBuilder::default();
        b.cap += username_str.utf8_byte_length() + 1
            + password_str.utf8_byte_length() + 1
            + database_str.utf8_byte_length() + 1
            + options_str.utf8_byte_length() + 1
            + path_str.utf8_byte_length() + 1;

        let _ = b.allocate();
        let u = username_str.to_utf8_without_ref();
        username = b.append(u.slice());
        drop(u);

        let p = password_str.to_utf8_without_ref();
        password = b.append(p.slice());
        drop(p);

        let d = database_str.to_utf8_without_ref();
        database = b.append(d.slice());
        drop(d);

        let o = options_str.to_utf8_without_ref();
        options = b.append(o.slice());
        drop(o);

        let _path = path_str.to_utf8_without_ref();
        path = b.append(_path.slice());
        drop(_path);

        break 'brk b.allocated_slice();
    };
    // TODO(port): username/password/database/options/path now borrow from `options_buf`;
    // when stored in the struct below they become raw `*const [u8]` (self-referential).

    // Reject null bytes in connection parameters to prevent Postgres startup
    // message parameter injection (null bytes act as field terminators in the
    // wire protocol's key\0value\0 format).
    for (entry, name) in [
        (username, &b"username"[..]),
        (password, b"password"),
        (database, b"database"),
        (path, b"path"),
    ] {
        if !entry.is_empty() && entry.iter().any(|&c| c == 0) {
            drop(options_buf);
            // tls_config / secure released by the errdefer above.
            // TODO(port): Zig used `entry[1] ++ " must not contain null bytes"` (comptime concat).
            return global_object.throw_invalid_arguments_fmt(format_args!(
                "{} must not contain null bytes",
                bstr::BStr::new(name)
            ));
        }
    }

    let on_connect = arguments[9];
    let on_close = arguments[10];
    let idle_timeout = arguments[11].to_int32();
    let connection_timeout = arguments[12].to_int32();
    let max_lifetime = arguments[13].to_int32();
    let use_unnamed_prepared_statements = arguments[14].as_boolean();

    let ptr: *mut PostgresSQLConnection = Box::into_raw(Box::new(PostgresSQLConnection {
        socket: Socket::SocketTCP(uws::SocketTCP { socket: uws::SocketState::Detached }),
        status: Status::Connecting,
        ref_count: Cell::new(1),
        write_buffer: OffsetByteList::default(),
        read_buffer: OffsetByteList::default(),
        last_message_start: 0,
        requests: PostgresRequest::Queue::init(),
        pipelined_requests: 0,
        nonpipelinable_requests: 0,
        poll_ref: KeepAlive::default(),
        global_object: global_object as *const _ as *mut JSGlobalObject,
        vm: vm as *const _ as *mut VirtualMachine,
        statements: PreparedStatementsMap::default(),
        prepared_statement_id: 0,
        pending_activity_count: AtomicU32::new(0),
        js_value: bun_jsc::JsRef::weak(JSValue::UNDEFINED),
        backend_parameters: StringMap::init(true),
        backend_key_data: protocol::BackendKeyData::default(),
        database: database as *const [u8],
        user: username as *const [u8],
        password: password as *const [u8],
        path: path as *const [u8],
        options: options as *const [u8],
        options_buf,
        authentication_state: AuthenticationState::Pending,
        secure,
        tls_config,
        tls_status: if ssl_mode != SSLMode::Disable { TLSStatus::Pending } else { TLSStatus::None },
        ssl_mode,
        idle_timeout_interval_ms: u32::try_from(idle_timeout).unwrap(),
        connection_timeout_ms: u32::try_from(connection_timeout).unwrap(),
        flags: ConnectionFlags {
            use_unnamed_prepared_statements,
            ..Default::default()
        },
        timer: EventLoopTimer {
            tag: EventLoopTimer::Tag::PostgresSQLConnectionTimeout,
            next: bun_core::timespec::EPOCH,
            ..Default::default()
        },
        max_lifetime_interval_ms: u32::try_from(max_lifetime).unwrap(),
        max_lifetime_timer: EventLoopTimer {
            tag: EventLoopTimer::Tag::PostgresSQLConnectionMaxLifetime,
            next: bun_core::timespec::EPOCH,
            ..Default::default()
        },
        auto_flusher: AutoFlusher::default(),
    }));
    // Ownership transferred into `ptr`; disarm the errdefer.
    scopeguard::ScopeGuard::into_inner(errdefer_guard);

    // SAFETY: ptr was just Box-allocated above.
    let this = unsafe { &mut *ptr };

    {
        let hostname = hostname_str.to_utf8();

        // Postgres always opens plain TCP first (SSLRequest happens in-band),
        // so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()`
        // adopts into `postgres_tls_group` after the server's `S`.
        let group = vm.rare_data().postgres_group(vm, false);
        // SAFETY: path is a valid slice into options_buf which is owned by *ptr.
        let path_slice = unsafe { &*this.path };
        let result = if !path_slice.is_empty() {
            uws::SocketTCP::connect_unix_group(group, uws::SocketKind::Postgres, None, path_slice, ptr, false)
        } else {
            uws::SocketTCP::connect_group(group, uws::SocketKind::Postgres, None, hostname.slice(), port, ptr, false)
        };

        this.socket = Socket::SocketTCP(match result {
            Ok(s) => s,
            Err(err) => {
                this.deinit();
                return global_object.throw_error(err, "failed to connect to postgresql");
            }
        });
    }

    // only call toJS if connectUnixAnon does not fail immediately
    this.update_has_pending_activity();
    this.reset_connection_timeout();
    this.poll_ref.r#ref(vm);
    let js_value = js::to_js(ptr, global_object);
    js_value.ensure_still_alive();
    this.js_value = bun_jsc::JsRef::weak(js_value);
    js::onconnect_set_cached(js_value, global_object, on_connect);
    js::onclose_set_cached(js_value, global_object, on_close);
    bun_core::analytics::Features::postgres_connections.fetch_add(1);
    Ok(js_value)
}

/// Referenced by `dispatch.zig` (kind = `.postgres[_tls]`). Now the only
/// caller — `configure()` is gone.
pub struct SocketHandler<const SSL: bool>;

impl<const SSL: bool> SocketHandler<SSL> {
    type SocketType = uws::NewSocketHandler<SSL>;

    fn _socket(s: Self::SocketType) -> Socket {
        if SSL {
            Socket::SocketTLS(s)
        } else {
            Socket::SocketTCP(s)
        }
    }

    pub fn on_open(this: &mut PostgresSQLConnection, socket: Self::SocketType) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_open(Self::_socket(socket));
    }

    fn on_handshake_(this: &mut PostgresSQLConnection, _: Self::SocketType, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_handshake(success, ssl_error);
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    // TODO(port): conditional associated const fn — in Rust, expose `Option<fn(...)>`.
    pub const ON_HANDSHAKE: Option<fn(&mut PostgresSQLConnection, Self::SocketType, i32, uws::us_bun_verify_error_t)> =
        if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(this: &mut PostgresSQLConnection, _socket: Self::SocketType, _: i32, _: Option<*mut c_void>) {
        this.on_close();
    }

    pub fn on_end(this: &mut PostgresSQLConnection, _socket: Self::SocketType) {
        this.on_close();
    }

    pub fn on_connect_error(this: &mut PostgresSQLConnection, _socket: Self::SocketType, _: i32) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_close();
    }

    pub fn on_timeout(this: &mut PostgresSQLConnection, _socket: Self::SocketType) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_timeout();
    }

    pub fn on_data(this: &mut PostgresSQLConnection, _socket: Self::SocketType, data: &[u8]) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_data(data);
    }

    pub fn on_writable(this: &mut PostgresSQLConnection, _socket: Self::SocketType) {
        if this.vm().is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_drain();
    }
}

impl PostgresSQLConnection {
    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.r#ref(this.vm());
        this.update_has_pending_activity();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(this.vm());
        this.update_has_pending_activity();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flush(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    fn close(&mut self) {
        self.disconnect();
        self.unregister_auto_flusher();
        self.write_buffer.clear_and_free();
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_close(this: &mut Self, _global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    pub fn stop_timers(&mut self) {
        if self.timer.state == EventLoopTimer::State::ACTIVE {
            self.vm().timer.remove(&mut self.timer);
        }
        if self.max_lifetime_timer.state == EventLoopTimer::State::ACTIVE {
            self.vm().timer.remove(&mut self.max_lifetime_timer);
        }
    }

    // TODO(port): `deinit` is the intrusive-refcount destructor (called when ref_count hits 0).
    // Not `impl Drop` because it frees `self`'s own Box and is also called directly on the
    // connect-fail path before any JS wrapper exists. Non-pub: callers are `deref()` and the
    // connect-fail path in `call()`, both in this file.
    fn deinit(&mut self) {
        self.disconnect();
        self.stop_timers();
        for stmt_ptr in self.statements.values() {
            // SAFETY: statements map owns a ref to each statement.
            unsafe { (**stmt_ptr).deref() };
        }
        // statements/requests/write_buffer/read_buffer/backend_parameters dropped below.
        // PORT NOTE: Zig called .deinit() on each; Rust Drop handles Vec/HashMap/OffsetByteList.

        bun_core::free_sensitive(&mut self.options_buf);

        // tls_config dropped by Box drop below.
        if let Some(s) = self.secure {
            // SAFETY: SSL_CTX_free on a valid SSL_CTX*.
            unsafe { BoringSSL::c::SSL_CTX_free(s) };
        }
        // SAFETY: self was Box-allocated in `call()`; ref_count is 0; reclaim.
        unsafe { drop(Box::from_raw(self as *mut Self)) };
    }

    fn clean_up_requests(&mut self, js_reason: Option<JSValue>) {
        while let Some(request) = self.current() {
            // SAFETY: request is a valid *mut PostgresSQLQuery owned by the queue.
            let request = unsafe { &mut *request };
            match request.status {
                // pending we will fail the request and the stmt will be marked as error ConnectionClosed too
                PostgresSQLQuery::Status::Pending => {
                    let Some(stmt) = request.statement else {
                        // `continue` in Zig with `orelse continue` — but we still need to deref+discard.
                        // PORT NOTE: Zig `orelse continue` skips the deref/discard at the bottom too;
                        // matching that behavior here.
                        continue;
                    };
                    // SAFETY: stmt is a valid *mut PostgresSQLStatement.
                    let stmt = unsafe { &mut *stmt };
                    stmt.error_response = Some(PostgresSQLStatement::ErrorResponse::PostgresError(AnyPostgresError::ConnectionClosed));
                    stmt.status = PostgresSQLStatement::Status::Failed;
                    if !self.vm().is_shutting_down() {
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, self.global());
                        } else {
                            request.on_error(
                                PostgresSQLStatement::ErrorResponse::PostgresError(AnyPostgresError::ConnectionClosed),
                                self.global(),
                            );
                        }
                    }
                }
                // in the middle of running
                PostgresSQLQuery::Status::Binding
                | PostgresSQLQuery::Status::Running
                | PostgresSQLQuery::Status::PartialResponse => {
                    self.finish_request(request);
                    if !self.vm().is_shutting_down() {
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, self.global());
                        } else {
                            request.on_error(
                                PostgresSQLStatement::ErrorResponse::PostgresError(AnyPostgresError::ConnectionClosed),
                                self.global(),
                            );
                        }
                    }
                }
                // just ignore success and fail cases
                PostgresSQLQuery::Status::Success | PostgresSQLQuery::Status::Fail => {}
            }
            request.deref();
            self.requests.discard(1);
        }
    }

    fn ref_and_close(&mut self, js_reason: Option<JSValue>) {
        // refAndClose is always called when we wanna to disconnect or when we are closed

        if !self.socket.is_closed() {
            // event loop need to be alive to close the socket
            self.poll_ref.r#ref(self.vm());
            // will unref on socket close
            self.socket.close();
        }

        // cleanup requests
        self.clean_up_requests(js_reason);
    }

    pub fn disconnect(&mut self) {
        self.stop_timers();
        self.unregister_auto_flusher();
        if self.status == Status::Connected {
            self.status = Status::Disconnected;
            self.ref_and_close(None);
        }
    }

    fn current(&self) -> Option<*mut PostgresSQLQuery> {
        if self.requests.readable_length() == 0 {
            return None;
        }
        Some(self.requests.peek_item(0))
    }

    pub fn has_query_running(&self) -> bool {
        !self.flags.is_ready_for_query || self.current().is_some()
    }

    pub fn can_pipeline(&self) -> bool {
        if bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING.get() {
            #[cold]
            fn cold() -> bool { false }
            return cold();
        }

        self.nonpipelinable_requests == 0 // need to wait for non pipelinable requests to finish
            && !self.flags.use_unnamed_prepared_statements // unnamed statements are not pipelinable
            && !self.flags.waiting_to_prepare // cannot pipeline when waiting prepare
            && !self.flags.has_backpressure // dont make sense to buffer more if we have backpressure
            && self.write_buffer.len() < MAX_PIPELINE_SIZE // buffer is too big need to flush before pipeline more
    }
}

pub struct Writer<'a> {
    pub connection: &'a mut PostgresSQLConnection,
}

impl<'a> Writer<'a> {
    pub fn write(&mut self, data: &[u8]) -> Result<(), AnyPostgresError> {
        let buffer = &mut self.connection.write_buffer;
        buffer.write(data)?;
        Ok(())
    }

    pub fn pwrite(&mut self, data: &[u8], index: usize) -> Result<(), AnyPostgresError> {
        self.connection.write_buffer.byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    pub fn offset(&self) -> usize {
        self.connection.write_buffer.len()
    }
}

impl PostgresSQLConnection {
    pub fn writer(&mut self) -> protocol::NewWriter<Writer<'_>> {
        protocol::NewWriter {
            wrapped: Writer { connection: self },
        }
    }
}

pub struct Reader<'a> {
    pub connection: &'a mut PostgresSQLConnection,
}

impl<'a> Reader<'a> {
    pub fn mark_message_start(&mut self) {
        self.connection.last_message_start = self.connection.read_buffer.head;
    }

    pub fn ensure_length(&self, count: usize) -> bool {
        self.ensure_capacity(count)
    }

    pub fn peek(&self) -> &[u8] {
        self.connection.read_buffer.remaining()
    }

    pub fn skip(&mut self, count: usize) {
        self.connection.read_buffer.head =
            (self.connection.read_buffer.head + (count as u32)).min(self.connection.read_buffer.byte_list.len);
    }

    pub fn ensure_capacity(&self, count: usize) -> bool {
        (self.connection.read_buffer.head as usize) + count <= (self.connection.read_buffer.byte_list.len as usize)
    }

    pub fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        let remaining = self.connection.read_buffer.remaining();
        if (remaining.len() as usize) < count {
            return Err(AnyPostgresError::ShortRead);
        }

        // PORT NOTE: reshaped for borrowck — capture slice ptr before calling skip().
        let slice = &remaining[..count] as *const [u8];
        self.skip(count);
        // SAFETY: slice points into read_buffer which is not reallocated by skip().
        Ok(Data::Temporary(unsafe { &*slice }))
    }

    pub fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        let remain = self.connection.read_buffer.remaining();

        if let Some(zero) = strings::index_of_char(remain, 0) {
            let slice = &remain[..zero as usize] as *const [u8];
            self.skip(zero as usize + 1);
            // SAFETY: slice points into read_buffer which is not reallocated by skip().
            return Ok(Data::Temporary(unsafe { &*slice }));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

impl PostgresSQLConnection {
    pub fn buffered_reader(&mut self) -> protocol::NewReader<Reader<'_>> {
        protocol::NewReader {
            wrapped: Reader { connection: self },
        }
    }

    fn finish_request(&mut self, item: &mut PostgresSQLQuery) {
        match item.status {
            PostgresSQLQuery::Status::Running
            | PostgresSQLQuery::Status::Binding
            | PostgresSQLQuery::Status::PartialResponse => {
                if item.flags.simple {
                    self.nonpipelinable_requests -= 1;
                } else if item.flags.pipelined {
                    self.pipelined_requests -= 1;
                }
            }
            PostgresSQLQuery::Status::Success
            | PostgresSQLQuery::Status::Fail
            | PostgresSQLQuery::Status::Pending => {}
        }
    }

    pub fn can_prepare_query(&self) -> bool {
        self.flags.is_ready_for_query && !self.flags.waiting_to_prepare && self.pipelined_requests == 0
    }

    /// Process pending requests and flush. Called from the enqueue path when
    /// unnamed prepared statements with params skip writeQuery+Sync and need
    /// advance() to send everything atomically on an idle connection.
    pub fn advance_and_flush(&mut self) {
        if !self.flags.has_backpressure && self.flags.is_ready_for_query {
            self.advance();
            self.flush_data();
        }
    }

    fn advance(&mut self) {
        let mut offset: usize = 0;
        debug!("advance");
        // PORT NOTE: Zig `defer { while ... }` cleanup loop runs after the main loop returns;
        // expanded as a closure called at every return point below.
        macro_rules! defer_cleanup {
            ($self:ident) => {{
                while $self.requests.readable_length() > 0 {
                    let result_ptr = $self.requests.peek_item(0);
                    // SAFETY: result is a valid *mut PostgresSQLQuery owned by the queue.
                    let result = unsafe { &mut *result_ptr };
                    // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
                    // so we do the cleanup here
                    match result.status {
                        PostgresSQLQuery::Status::Success => {
                            result.deref();
                            $self.requests.discard(1);
                            continue;
                        }
                        PostgresSQLQuery::Status::Fail => {
                            result.deref();
                            $self.requests.discard(1);
                            continue;
                        }
                        _ => break, // truly current item
                    }
                }
            }};
        }

        while self.requests.readable_length() > offset && !self.flags.has_backpressure {
            if self.vm().is_shutting_down() {
                self.close();
                defer_cleanup!(self);
                return;
            }

            let req_ptr: *mut PostgresSQLQuery = self.requests.peek_item(offset);
            // SAFETY: req is a valid *mut PostgresSQLQuery owned by the queue.
            let req = unsafe { &mut *req_ptr };
            match req.status {
                PostgresSQLQuery::Status::Pending => {
                    if req.flags.simple {
                        if self.pipelined_requests > 0 || !self.flags.is_ready_for_query {
                            debug!(
                                "cannot execute simple query, pipelined_requests: {}, is_ready_for_query: {}",
                                self.pipelined_requests, self.flags.is_ready_for_query
                            );
                            // need to wait for the previous request to finish before starting simple queries
                            defer_cleanup!(self);
                            return;
                        }
                        let query_str = req.query.to_utf8();
                        debug!("execute simple query: {}", bstr::BStr::new(query_str.slice()));
                        if let Err(err) = PostgresRequest::execute_query(query_str.slice(), self.writer()) {
                            if let Some(err_) = self.global().try_take_exception() {
                                req.on_js_error(err_, self.global());
                            } else {
                                req.on_write_fail(err, self.global(), self.get_queries_array());
                            }
                            if offset == 0 {
                                req.deref();
                                self.requests.discard(1);
                            } else {
                                // deinit later
                                req.status = PostgresSQLQuery::Status::Fail;
                            }
                            debug!("executeQuery failed: {}", <&'static str>::from(err));
                            continue;
                        }
                        self.nonpipelinable_requests += 1;
                        self.flags.is_ready_for_query = false;
                        req.status = PostgresSQLQuery::Status::Running;
                        defer_cleanup!(self);
                        return;
                    } else {
                        if let Some(statement_ptr) = req.statement {
                            // SAFETY: statement is a valid *mut PostgresSQLStatement.
                            let statement = unsafe { &mut *statement_ptr };
                            match statement.status {
                                PostgresSQLStatement::Status::Failed => {
                                    debug!("stmt failed");
                                    debug_assert!(statement.error_response.is_some());
                                    req.on_error(statement.error_response.clone().unwrap(), self.global());
                                    if offset == 0 {
                                        req.deref();
                                        self.requests.discard(1);
                                    } else {
                                        // deinit later
                                        req.status = PostgresSQLQuery::Status::Fail;
                                        offset += 1;
                                    }
                                    continue;
                                }
                                PostgresSQLStatement::Status::Prepared => {
                                    let Some(this_value) = req.this_value.try_get() else {
                                        debug_assert!(false, "query value was freed earlier than expected");
                                        if offset == 0 {
                                            req.deref();
                                            self.requests.discard(1);
                                        } else {
                                            // deinit later
                                            req.status = PostgresSQLQuery::Status::Fail;
                                            offset += 1;
                                        }
                                        continue;
                                    };
                                    let binding_value = PostgresSQLQuery::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                    let columns_value = PostgresSQLQuery::js::columns_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                    req.flags.binary = !statement.fields.is_empty();

                                    if self.flags.use_unnamed_prepared_statements {
                                        // For unnamed prepared statements, always include Parse
                                        // before Bind+Execute. The unnamed statement may not exist
                                        // on the current server connection when using PgBouncer or
                                        // other connection poolers in transaction mode.
                                        debug!("parse, bind and execute unnamed stmt");
                                        let query_str = req.query.to_utf8();
                                        if let Err(err) = PostgresRequest::parse_and_bind_and_execute(
                                            self.global(),
                                            query_str.slice(),
                                            statement,
                                            binding_value,
                                            columns_value,
                                            false,
                                            self.writer(),
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            if offset == 0 {
                                                req.deref();
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = PostgresSQLQuery::Status::Fail;
                                                offset += 1;
                                            }
                                            debug!("parse, bind and execute failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                    } else {
                                        debug!("binding and executing stmt");
                                        if let Err(err) = PostgresRequest::bind_and_execute(
                                            self.global(),
                                            statement,
                                            binding_value,
                                            columns_value,
                                            self.writer(),
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            if offset == 0 {
                                                req.deref();
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = PostgresSQLQuery::Status::Fail;
                                                offset += 1;
                                            }
                                            debug!("bind and execute failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                    }

                                    self.flags.is_ready_for_query = false;
                                    req.status = PostgresSQLQuery::Status::Binding;
                                    req.flags.pipelined = true;
                                    self.pipelined_requests += 1;

                                    if self.flags.use_unnamed_prepared_statements || !self.can_pipeline() {
                                        debug!("cannot pipeline more stmt");
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    offset += 1;
                                    continue;
                                }
                                PostgresSQLStatement::Status::Pending => {
                                    if !self.can_prepare_query() {
                                        debug!("need to wait to finish the pipeline before starting a new query preparation");
                                        // need to wait to finish the pipeline before starting a new query preparation
                                        defer_cleanup!(self);
                                        return;
                                    }
                                    // statement is pending, lets write/parse it
                                    let query_str = req.query.to_utf8();
                                    let has_params = !statement.signature.fields.is_empty();
                                    // If it does not have params, we can write and execute immediately in one go
                                    if !has_params {
                                        let Some(this_value) = req.this_value.try_get() else {
                                            debug_assert!(false, "query value was freed earlier than expected");
                                            if offset == 0 {
                                                req.deref();
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = PostgresSQLQuery::Status::Fail;
                                                offset += 1;
                                            }
                                            continue;
                                        };
                                        // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                                        let binding_value = PostgresSQLQuery::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        debug!("prepareAndQueryWithSignature");
                                        if let Err(err) = PostgresRequest::prepare_and_query_with_signature(
                                            self.global(),
                                            query_str.slice(),
                                            binding_value,
                                            self.writer(),
                                            &mut statement.signature,
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                statement.status = PostgresSQLStatement::Status::Failed;
                                                statement.error_response = Some(PostgresSQLStatement::ErrorResponse::PostgresError(err));
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            if offset == 0 {
                                                req.deref();
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = PostgresSQLQuery::Status::Fail;
                                            }
                                            debug!("prepareAndQueryWithSignature failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                        self.flags.is_ready_for_query = false;
                                        self.flags.waiting_to_prepare = true;
                                        req.status = PostgresSQLQuery::Status::Binding;
                                        statement.status = PostgresSQLStatement::Status::Parsing;
                                        self.flush_data_and_reset_timeout();
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    if self.flags.use_unnamed_prepared_statements {
                                        // For unnamed prepared statements, send Parse+Describe+Bind+Execute
                                        // atomically to prevent PgBouncer from splitting them across
                                        // server connections. Uses signature field types for encoding
                                        // (text format for unknowns); actual types will be cached from
                                        // ParameterDescription for subsequent executions.
                                        let Some(this_value) = req.this_value.try_get() else {
                                            debug_assert!(false, "query value was freed earlier than expected");
                                            debug_assert!(offset == 0);
                                            req.deref();
                                            self.requests.discard(1);
                                            continue;
                                        };
                                        let binding_value = PostgresSQLQuery::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        let columns_value = PostgresSQLQuery::js::columns_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        debug!("parseAndBindAndExecute (unnamed, first execution)");
                                        if let Err(err) = PostgresRequest::parse_and_bind_and_execute(
                                            self.global(),
                                            query_str.slice(),
                                            statement,
                                            binding_value,
                                            columns_value,
                                            true,
                                            self.writer(),
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                statement.status = PostgresSQLStatement::Status::Failed;
                                                statement.error_response = Some(PostgresSQLStatement::ErrorResponse::PostgresError(err));
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            debug_assert!(offset == 0);
                                            req.deref();
                                            self.requests.discard(1);
                                            debug!("parseAndBindAndExecute failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                        self.flags.is_ready_for_query = false;
                                        self.flags.waiting_to_prepare = true;
                                        req.status = PostgresSQLQuery::Status::Binding;
                                        statement.status = PostgresSQLStatement::Status::Parsing;
                                        req.flags.pipelined = true;
                                        self.pipelined_requests += 1;
                                        self.flush_data_and_reset_timeout();
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    // Named prepared statements: send Parse+Describe first, wait for
                                    // ParameterDescription, then send Bind+Execute in a second phase.
                                    // This is safe because named statements persist on the connection.
                                    let mut connection_writer = self.writer();
                                    debug!("writing query");
                                    // write query and wait for it to be prepared
                                    if let Err(err) = PostgresRequest::write_query(
                                        query_str.slice(),
                                        &statement.signature.prepared_statement_name,
                                        &statement.signature.fields,
                                        &mut connection_writer,
                                    ) {
                                        if let Some(err_) = self.global().try_take_exception() {
                                            req.on_js_error(err_, self.global());
                                        } else {
                                            statement.error_response = Some(PostgresSQLStatement::ErrorResponse::PostgresError(err));
                                            statement.status = PostgresSQLStatement::Status::Failed;
                                            req.on_write_fail(err, self.global(), self.get_queries_array());
                                        }
                                        debug_assert!(offset == 0);
                                        req.deref();
                                        self.requests.discard(1);
                                        debug!("write query failed: {}", <&'static str>::from(err));
                                        continue;
                                    }
                                    if let Err(err) = connection_writer.write(&protocol::SYNC) {
                                        if let Some(err_) = self.global().try_take_exception() {
                                            req.on_js_error(err_, self.global());
                                        } else {
                                            statement.error_response = Some(PostgresSQLStatement::ErrorResponse::PostgresError(err));
                                            statement.status = PostgresSQLStatement::Status::Failed;
                                            req.on_write_fail(err, self.global(), self.get_queries_array());
                                        }
                                        debug_assert!(offset == 0);
                                        req.deref();
                                        self.requests.discard(1);
                                        debug!("write query (sync) failed: {}", <&'static str>::from(err));
                                        continue;
                                    }
                                    self.flags.is_ready_for_query = false;
                                    self.flags.waiting_to_prepare = true;
                                    statement.status = PostgresSQLStatement::Status::Parsing;
                                    self.flush_data_and_reset_timeout();
                                    defer_cleanup!(self);
                                    return;
                                }
                                PostgresSQLStatement::Status::Parsing => {
                                    // we are still parsing, lets wait for it to be prepared or failed
                                    offset += 1;
                                    continue;
                                }
                            }
                        } else {
                            offset += 1;
                            continue;
                        }
                    }
                }

                PostgresSQLQuery::Status::Running
                | PostgresSQLQuery::Status::Binding
                | PostgresSQLQuery::Status::PartialResponse => {
                    if self.flags.waiting_to_prepare || self.nonpipelinable_requests > 0 {
                        defer_cleanup!(self);
                        return;
                    }
                    let total_requests_running = self.pipelined_requests as usize;
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }
                PostgresSQLQuery::Status::Success => {
                    if offset > 0 {
                        // deinit later
                        req.status = PostgresSQLQuery::Status::Fail;
                        offset += 1;
                        continue;
                    }
                    req.deref();
                    self.requests.discard(1);
                    continue;
                }
                PostgresSQLQuery::Status::Fail => {
                    if offset > 0 {
                        // deinit later
                        offset += 1;
                        continue;
                    }
                    req.deref();
                    self.requests.discard(1);
                    continue;
                }
            }
        }
        defer_cleanup!(self);
    }

    pub fn get_queries_array(&self) -> JSValue {
        let js_value = self.js_value.get();
        if js_value.is_empty_or_undefined_or_null() {
            return JSValue::UNDEFINED;
        }
        js::queries_get_cached(js_value).unwrap_or(JSValue::UNDEFINED)
    }

    // TODO(port): Zig signature is `on(comptime MessageType: @Type(.enum_literal), comptime Context: type, reader)`.
    // Mapped to a const-generic enum + generic Context. Requires `#[derive(ConstParamTy)]` on
    // `protocol::MessageType`. The match below relies on dead-code elimination to monomorphize
    // per-arm like Zig's comptime switch.
    pub fn on<const MESSAGE_TYPE: protocol::MessageType, Context>(
        &mut self,
        reader: protocol::NewReader<Context>,
    ) -> Result<(), AnyPostgresError> {
        debug!("on({})", <&'static str>::from(MESSAGE_TYPE));

        match MESSAGE_TYPE {
            protocol::MessageType::DataRow => {
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: request is a valid *mut PostgresSQLQuery owned by the queue.
                let request = unsafe { &mut *request_ptr };

                let statement_ptr = request.statement.ok_or(AnyPostgresError::ExpectedStatement)?;
                // SAFETY: statement is valid for the duration of the request.
                let statement = unsafe { &mut *statement_ptr };
                let mut structure: JSValue = JSValue::UNDEFINED;
                let mut cached_structure: Option<PostgresCachedStructure> = None;
                // explicit use switch without else so if new modes are added, we don't forget to check for duplicate fields
                match request.flags.result_mode {
                    PostgresSQLQuery::ResultMode::Objects => {
                        cached_structure = Some(statement.structure(self.js_value.get(), self.global()));
                        structure = cached_structure.as_ref().unwrap().js_value().unwrap_or(JSValue::UNDEFINED);
                    }
                    PostgresSQLQuery::ResultMode::Raw | PostgresSQLQuery::ResultMode::Values => {
                        // no need to check for duplicate fields or structure
                    }
                }

                let mut putter = DataCell::Putter {
                    list: &mut [],
                    fields: &statement.fields,
                    binary: request.flags.binary,
                    bigint: request.flags.bigint,
                    global_object: self.global_object,
                    count: 0,
                    // TODO(port): other Putter default fields
                };

                let mut stack_buf: [DataCell::SQLDataCell; 70] =
                    // SAFETY: SQLDataCell is POD; immediately overwritten by memset below.
                    unsafe { core::mem::zeroed() };
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let max_inline = jsc::JSObject::max_inline_capacity();
                let mut heap_cells: Vec<DataCell::SQLDataCell>;
                let mut free_cells = false;
                let cells: &mut [DataCell::SQLDataCell] = if statement.fields.len() >= max_inline {
                    heap_cells = vec![DataCell::SQLDataCell { tag: DataCell::Tag::Null, value: DataCell::Value { null: 0 } }; statement.fields.len()];
                    free_cells = true;
                    &mut heap_cells
                } else {
                    &mut stack_buf[..statement.fields.len().min(max_inline)]
                };
                // make sure all cells are reset if reader short breaks the fields will just be null which is better than undefined behavior
                cells.fill(DataCell::SQLDataCell { tag: DataCell::Tag::Null, value: DataCell::Value { null: 0 } });
                putter.list = cells;

                let decode_result = if request.flags.result_mode == PostgresSQLQuery::ResultMode::Raw {
                    protocol::DataRow::decode(&mut putter, reader, DataCell::Putter::put_raw)
                } else {
                    protocol::DataRow::decode(&mut putter, reader, DataCell::Putter::put)
                };
                // PORT NOTE: Zig `defer { for (cells[0..putter.count]) |*cell| cell.deinit(); if (free_cells) free(cells); }`
                // runs on ALL exits (decode error, to_js error, success). Capture raw pointers so
                // the guard can read `putter.count` after decode/to_js mutate `putter` without
                // tripping borrowck.
                let cells_ptr: *mut DataCell::SQLDataCell = putter.list.as_mut_ptr();
                let count_ptr: *const usize = core::ptr::addr_of!(putter.count);
                let _cells_guard = scopeguard::guard((), move |_| {
                    // SAFETY: cells_ptr points into stack_buf/heap_cells and count_ptr into putter,
                    // both declared earlier in this block and outlive this guard.
                    let count = unsafe { *count_ptr };
                    for i in 0..count {
                        unsafe { (*cells_ptr.add(i)).deinit() };
                    }
                    // `if free_cells free(cells)`: heap_cells Vec drops at scope end.
                });
                decode_result?;

                let Some(this_value) = request.this_value.try_get() else {
                    debug_assert!(false, "query value was freed earlier than expected");
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                let pending_value = PostgresSQLQuery::js::pending_value_get_cached(this_value).unwrap_or(JSValue::ZERO);
                pending_value.ensure_still_alive();
                let result = putter.to_js(
                    self.global(),
                    pending_value,
                    structure,
                    statement.fields_flags,
                    request.flags.result_mode,
                    cached_structure,
                )?;

                if pending_value.is_empty() {
                    PostgresSQLQuery::js::pending_value_set_cached(this_value, self.global(), result);
                }

                let _ = free_cells; // heap_cells dropped at scope end; _cells_guard runs cell.deinit()
            }
            protocol::MessageType::CopyData => {
                let mut copy_data: protocol::CopyData = Default::default();
                copy_data.decode_internal(reader)?;
                drop(copy_data.data);
            }
            protocol::MessageType::ParameterStatus => {
                let mut parameter_status: protocol::ParameterStatus = Default::default();
                parameter_status.decode_internal(reader)?;
                self.backend_parameters.insert(parameter_status.name.slice(), parameter_status.value.slice())?;
                // parameter_status dropped at scope end
            }
            protocol::MessageType::ReadyForQuery => {
                let mut ready_for_query: protocol::ReadyForQuery = Default::default();
                ready_for_query.decode_internal(reader)?;

                self.set_status(Status::Connected);
                self.flags.waiting_to_prepare = false;
                self.flags.is_ready_for_query = true;
                self.socket.set_timeout(300);

                if let Some(request_ptr) = self.current() {
                    // SAFETY: valid queue item.
                    let request = unsafe { &mut *request_ptr };
                    if request.status == PostgresSQLQuery::Status::PartialResponse {
                        self.finish_request(request);
                        // if is a partial response, just signal that the query is now complete
                        request.on_result(b"", self.global(), self.js_value.get(), true);
                    }
                }
                self.advance();

                self.register_auto_flusher();
                self.update_ref();
            }
            protocol::MessageType::CommandComplete => {
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };

                let mut cmd: protocol::CommandComplete = Default::default();
                cmd.decode_internal(reader)?;
                debug!("-> {}", bstr::BStr::new(cmd.command_tag.slice()));

                request.on_result(cmd.command_tag.slice(), self.global(), self.js_value.get(), false);
                self.update_ref();
                // cmd dropped at scope end
            }
            protocol::MessageType::BindComplete => {
                reader.eat_message::<protocol::BindComplete>()?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                if request.status == PostgresSQLQuery::Status::Binding {
                    request.status = PostgresSQLQuery::Status::Running;
                }
            }
            protocol::MessageType::ParseComplete => {
                reader.eat_message::<protocol::ParseComplete>()?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &*request_ptr };
                if let Some(statement_ptr) = request.statement {
                    // SAFETY: request holds a ref on its statement; valid while request is queued.
                    let statement = unsafe { &mut *statement_ptr };
                    // if we have params wait for parameter description
                    if statement.status == PostgresSQLStatement::Status::Parsing && statement.signature.fields.is_empty() {
                        statement.status = PostgresSQLStatement::Status::Prepared;
                        self.flags.waiting_to_prepare = false;
                    }
                }
            }
            protocol::MessageType::ParameterDescription => {
                let mut description: protocol::ParameterDescription = Default::default();
                description.decode_internal(reader)?;
                // errdefer bun.default_allocator.free(description.parameters);
                let request_ptr = match self.current() {
                    Some(r) => r,
                    None => {
                        drop(description.parameters);
                        return Err(AnyPostgresError::ExpectedRequest);
                    }
                };
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &*request_ptr };
                let statement_ptr = match request.statement {
                    Some(s) => s,
                    None => {
                        drop(description.parameters);
                        return Err(AnyPostgresError::ExpectedStatement);
                    }
                };
                // SAFETY: request holds a ref on its statement; valid while request is queued.
                let statement = unsafe { &mut *statement_ptr };
                if !statement.parameters.is_empty() {
                    // PORT NOTE: Box<[T]> drop frees old slice.
                }
                statement.parameters = description.parameters;
                if statement.status == PostgresSQLStatement::Status::Parsing {
                    statement.status = PostgresSQLStatement::Status::Prepared;
                    self.flags.waiting_to_prepare = false;
                }
            }
            protocol::MessageType::RowDescription => {
                let mut description: protocol::RowDescription = Default::default();
                description.decode_internal(reader)?;
                // errdefer description.deinit();
                let request_ptr = match self.current() {
                    Some(r) => r,
                    None => return Err(AnyPostgresError::ExpectedRequest),
                };
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &*request_ptr };
                let statement_ptr = match request.statement {
                    Some(s) => s,
                    None => return Err(AnyPostgresError::ExpectedStatement),
                };
                // SAFETY: request holds a ref on its statement; valid while request is queued.
                let statement = unsafe { &mut *statement_ptr };
                // A simple-mode query containing multiple statements (e.g.
                // "SELECT 1; SELECT a, b FROM t") receives one RowDescription per
                // result set while the same statement stays current() until
                // ReadyForQuery. Free any previous fields before overwriting and
                // invalidate state derived from them so the next DataRow builds
                // the correct structure instead of reusing a stale cached one.
                if !statement.fields.is_empty() {
                    // PORT NOTE: Box<[FieldDescription]> drop runs each field's Drop.
                    statement.fields = Box::default();
                    statement.cached_structure = Default::default();
                    statement.needs_duplicate_check = true;
                    statement.fields_flags = Default::default();
                }
                statement.fields = description.fields;
            }
            protocol::MessageType::Authentication => {
                let mut auth: protocol::Authentication = Default::default();
                auth.decode_internal(reader)?;

                match &auth {
                    protocol::Authentication::SASL => {
                        if !matches!(self.authentication_state, AuthenticationState::SASL(_)) {
                            self.authentication_state = AuthenticationState::SASL(Default::default());
                        }

                        let mut mechanism_buf = [0u8; 128];
                        let AuthenticationState::SASL(sasl) = &mut self.authentication_state else { unreachable!() };
                        let mechanism = {
                            use std::io::Write as _;
                            let mut cursor = &mut mechanism_buf[..];
                            let _ = write!(cursor, "n,,n=*,r={}", bstr::BStr::new(sasl.nonce()));
                            let written = 128 - cursor.len();
                            mechanism_buf[written] = 0;
                            &mechanism_buf[..written]
                        };
                        let mut response = protocol::SASLInitialResponse {
                            mechanism: Data::Temporary(b"SCRAM-SHA-256"),
                            data: Data::Temporary(mechanism),
                        };

                        response.write_internal(self.writer())?;
                        debug!("SASL");
                        self.flush_data();
                    }
                    protocol::Authentication::SASLContinue(cont) => {
                        let AuthenticationState::SASL(sasl) = &mut self.authentication_state else {
                            debug!("Unexpected SASLContinue for authentication state: {}", <&'static str>::from(&self.authentication_state));
                            return Err(AnyPostgresError::UnexpectedMessage);
                        };

                        if sasl.status != AuthenticationState::SaslStatus::Init {
                            debug!("Unexpected SASLContinue for SASL state: {}", <&'static str>::from(sasl.status));
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        debug!("SASLContinue");

                        let iteration_count = cont.iteration_count()?;

                        let server_salt_decoded_base64 = match bun_core::base64::decode_alloc(cont.s) {
                            Ok(v) => v,
                            Err(e) if e == bun_core::err!("DecodingFailed") => {
                                return Err(AnyPostgresError::SASL_SIGNATURE_INVALID_BASE64);
                            }
                            Err(e) => return Err(e.into()),
                        };
                        sasl.compute_salted_password(&server_salt_decoded_base64, iteration_count, self)?;
                        drop(server_salt_decoded_base64);

                        let mut auth_string: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut auth_string,
                                "n=*,r={},r={},s={},i={},c=biws,r={}",
                                bstr::BStr::new(sasl.nonce()),
                                bstr::BStr::new(cont.r),
                                bstr::BStr::new(cont.s),
                                bstr::BStr::new(cont.i),
                                bstr::BStr::new(cont.r),
                            );
                        }
                        sasl.compute_server_signature(&auth_string)?;

                        let client_key = sasl.client_key();
                        let client_key_signature = sasl.client_key_signature(&client_key, &auth_string);
                        let mut client_key_xor_buffer = [0u8; 32];
                        debug_assert_eq!(client_key.len(), client_key_signature.len());
                        for ((out, a), b) in client_key_xor_buffer.iter_mut().zip(client_key.iter()).zip(client_key_signature.iter()) {
                            *out = a ^ b;
                        }

                        // SAFETY: all-zero is a valid [u8; N].
                        let mut client_key_xor_base64_buf: [u8; bun_core::base64::encode_len_from_size(32)] =
                            unsafe { core::mem::zeroed() };
                        let xor_base64_len = bun_core::base64::encode(&mut client_key_xor_base64_buf, &client_key_xor_buffer);

                        let mut payload: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut payload,
                                "c=biws,r={},p={}",
                                bstr::BStr::new(cont.r),
                                bstr::BStr::new(&client_key_xor_base64_buf[..xor_base64_len]),
                            );
                        }

                        let mut response = protocol::SASLResponse {
                            data: Data::Temporary(&payload),
                        };

                        response.write_internal(self.writer())?;
                        sasl.status = AuthenticationState::SaslStatus::Continue;
                        self.flush_data();
                    }
                    protocol::Authentication::SASLFinal(final_) => {
                        let AuthenticationState::SASL(sasl) = &mut self.authentication_state else {
                            debug!("SASLFinal - Unexpected SASLContinue for authentication state: {}", <&'static str>::from(&self.authentication_state));
                            return Err(AnyPostgresError::UnexpectedMessage);
                        };

                        if sasl.status != AuthenticationState::SaslStatus::Continue {
                            debug!("SASLFinal - Unexpected SASLContinue for SASL state: {}", <&'static str>::from(sasl.status));
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }

                        if sasl.server_signature_len == 0 {
                            debug!("SASLFinal - Server signature is empty");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }

                        let server_signature = sasl.server_signature();

                        // This will usually start with "v="
                        let comparison_signature = final_.data.slice();

                        if comparison_signature.len() < 2
                            || server_signature.len() != comparison_signature.len() - 2
                            // SAFETY: pointers are valid; lengths checked above.
                            || unsafe {
                                BoringSSL::c::CRYPTO_memcmp(
                                    server_signature.as_ptr().cast(),
                                    comparison_signature[2..].as_ptr().cast(),
                                    server_signature.len(),
                                )
                            } != 0
                        {
                            debug!(
                                "SASLFinal - SASL Server signature mismatch\nExpected: {}\nActual: {}",
                                bstr::BStr::new(server_signature),
                                bstr::BStr::new(&comparison_signature[2..])
                            );
                            self.fail(b"The server did not return the correct signature", AnyPostgresError::SASL_SIGNATURE_MISMATCH);
                        } else {
                            debug!("SASLFinal - SASL Server signature match");
                            self.authentication_state.zero();
                        }
                    }
                    protocol::Authentication::Ok => {
                        debug!("Authentication OK");
                        self.authentication_state.zero();
                        self.authentication_state = AuthenticationState::Ok;
                    }

                    protocol::Authentication::Unknown => {
                        self.fail(b"Unknown authentication method", AnyPostgresError::UNKNOWN_AUTHENTICATION_METHOD);
                    }

                    protocol::Authentication::ClearTextPassword => {
                        debug!("ClearTextPassword");
                        let mut response = protocol::PasswordMessage {
                            // SAFETY: password is a valid slice into options_buf.
                            password: Data::Temporary(unsafe { &*self.password }),
                        };

                        response.write_internal(self.writer())?;
                        self.flush_data();
                    }

                    protocol::Authentication::MD5Password(md5) => {
                        debug!("MD5Password");
                        // Format is: md5 + md5(md5(password + username) + salt)
                        let mut first_hash_buf: bun_core::sha::MD5::Digest = Default::default();
                        let mut first_hash_str = [0u8; 32];
                        let mut final_hash_buf: bun_core::sha::MD5::Digest = Default::default();
                        let mut final_hash_str = [0u8; 32];
                        let mut final_password_buf = [0u8; 36];

                        // First hash: md5(password + username)
                        let mut first_hasher = bun_core::sha::MD5::init();
                        // SAFETY: password/user are valid slices into options_buf.
                        first_hasher.update(unsafe { &*self.password });
                        first_hasher.update(unsafe { &*self.user });
                        first_hasher.r#final(&mut first_hash_buf);
                        let first_hash_str_output = {
                            use std::io::Write as _;
                            let mut cur = &mut first_hash_str[..];
                            let _ = write!(cur, "{:x}", bun_core::fmt::HexBytes(&first_hash_buf));
                            let n = 32 - cur.len();
                            &first_hash_str[..n]
                        };

                        // Second hash: md5(first_hash + salt)
                        let mut final_hasher = bun_core::sha::MD5::init();
                        final_hasher.update(first_hash_str_output);
                        final_hasher.update(&md5.salt);
                        final_hasher.r#final(&mut final_hash_buf);
                        let final_hash_str_output = {
                            use std::io::Write as _;
                            let mut cur = &mut final_hash_str[..];
                            let _ = write!(cur, "{:x}", bun_core::fmt::HexBytes(&final_hash_buf));
                            let n = 32 - cur.len();
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

                        let mut response = protocol::PasswordMessage {
                            password: Data::Temporary(final_password),
                        };

                        self.authentication_state = AuthenticationState::Md5;
                        response.write_internal(self.writer())?;
                        self.flush_data();
                    }

                    other => {
                        debug!("TODO auth: {}", <&'static str>::from(other));
                        self.fail(b"TODO: support authentication method: {s}", AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD);
                    }
                }
                // auth dropped at scope end (defer auth.deinit())
            }
            protocol::MessageType::NoData => {
                reader.eat_message::<protocol::NoData>()?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                if request.status == PostgresSQLQuery::Status::Binding {
                    request.status = PostgresSQLQuery::Status::Running;
                }
            }
            protocol::MessageType::BackendKeyData => {
                self.backend_key_data.decode_internal(reader)?;
            }
            protocol::MessageType::ErrorResponse => {
                let mut err: protocol::ErrorResponse = Default::default();
                err.decode_internal(reader)?;

                if self.status == Status::Connecting || self.status == Status::SentStartupMessage {
                    let v = err.to_js(self.global());
                    drop(err);
                    self.fail_with_js_value(v);

                    // it shouldn't enqueue any requests while connecting
                    debug_assert!(self.requests.count == 0);
                    return Ok(());
                }

                let Some(request_ptr) = self.current() else {
                    debug!("ErrorResponse: {}", err);
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                let mut is_error_owned = true;
                if let Some(stmt_ptr) = request.statement {
                    // SAFETY: request holds a ref on its statement; valid while request is queued.
                    let stmt = unsafe { &mut *stmt_ptr };
                    if stmt.status == PostgresSQLStatement::Status::Parsing {
                        stmt.status = PostgresSQLStatement::Status::Failed;
                        // TODO(port): ownership transfer of `err` into stmt.error_response (clone for on_error below).
                        stmt.error_response = Some(PostgresSQLStatement::ErrorResponse::Protocol(err.clone()));
                        is_error_owned = false;
                        if self.statements.remove(&bun_wyhash::hash(&stmt.signature.name)).is_some() {
                            stmt.deref();
                        }
                    }
                }

                self.finish_request(request);
                self.update_ref();
                request.on_error(PostgresSQLStatement::ErrorResponse::Protocol(err), self.global());
                let _ = is_error_owned; // err dropped at scope end if still owned
            }
            protocol::MessageType::PortalSuspended => {
                // try reader.eatMessage(&protocol.PortalSuspended);
                // var request = this.current() orelse return error.ExpectedRequest;
                // _ = request;
                debug!("TODO PortalSuspended");
            }
            protocol::MessageType::CloseComplete => {
                reader.eat_message::<protocol::CloseComplete>()?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                request.on_result(b"CLOSECOMPLETE", self.global(), self.js_value.get(), false);
                self.update_ref();
            }
            protocol::MessageType::CopyInResponse => {
                debug!("TODO CopyInResponse");
            }
            protocol::MessageType::NoticeResponse => {
                debug!("UNSUPPORTED NoticeResponse");
                let mut resp: protocol::NoticeResponse = Default::default();
                resp.decode_internal(reader)?;
                // resp dropped at scope end
            }
            protocol::MessageType::EmptyQueryResponse => {
                reader.eat_message::<protocol::EmptyQueryResponse>()?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                request.on_result(b"", self.global(), self.js_value.get(), false);
                self.update_ref();
            }
            protocol::MessageType::CopyOutResponse => {
                debug!("TODO CopyOutResponse");
            }
            protocol::MessageType::CopyDone => {
                debug!("TODO CopyDone");
            }
            protocol::MessageType::CopyBothResponse => {
                debug!("TODO CopyBothResponse");
            }
            // else => @compileError("Unknown message type")
            // PORT NOTE: const-generic enum match is exhaustive in Rust; no compile error needed.
        }
        Ok(())
    }

    pub fn update_ref(&mut self) {
        self.update_has_pending_activity();
        // TODO(port): Zig reads `pending_activity_count.raw` (non-atomic). Using Relaxed load.
        if self.pending_activity_count.load(Ordering::Relaxed) > 0 {
            self.poll_ref.r#ref(self.vm());
        } else {
            self.poll_ref.unref(self.vm());
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.status == Status::Connected)
    }

    pub fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        debug!("consumeOnConnectCallback");
        let js_value = self.js_value.get();
        let on_connect = js::onconnect_get_cached(js_value)?;
        debug!("consumeOnConnectCallback exists");

        js::onconnect_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_connect)
    }

    pub fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        debug!("consumeOnCloseCallback");
        let js_value = self.js_value.get();
        let on_close = js::onclose_get_cached(js_value)?;
        debug!("consumeOnCloseCallback exists");
        js::onclose_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_close)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/postgres/PostgresSQLConnection.zig (1981 lines)
//   confidence: medium
//   todos:      14
//   notes:      .classes.ts payload w/ intrusive refcount; js_value is JsRef (self-wrapper weak); self-referential string fields use raw *const [u8]; heavy defer/borrowck reshaping in advance()/on()/on_data()/fail_with_js_value(); on() uses const-generic MessageType
// ──────────────────────────────────────────────────────────────────────────

