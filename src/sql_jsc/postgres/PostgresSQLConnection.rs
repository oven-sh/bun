use bun_collections::VecExt;
use bun_jsc::JsCell;
use core::cell::Cell;
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use crate::jsc::EventLoopTimer;
use crate::jsc::webcore::AutoFlusher;
use crate::jsc::{
    self as jsc, CallFrame, HasAutoFlush, JSGlobalObject, JSGlobalObjectSqlExt as _, JSValue,
    JsResult, VirtualMachine, VirtualMachineSqlExt as _,
};
use bun_boringssl as BoringSSL;
use bun_collections::{HashMap, OffsetByteList, StringMap};
use bun_core::strings;
use bun_core::{self};
use bun_io::KeepAlive;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef};
use bun_uws as uws;
use core::ptr::NonNull;

use crate::jsc::{EventLoopTimerState, EventLoopTimerTag};
use crate::postgres::AuthenticationState;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::PostgresSQLStatement;
use crate::postgres::data_cell as DataCell;
use crate::postgres::error_jsc::{create_postgres_error, postgres_error_to_js};
use crate::postgres::postgres_request as PostgresRequest;
use crate::postgres::postgres_request::MessageType;
use crate::postgres::postgres_sql_query::{self, Status as QueryStatus};
use crate::postgres::postgres_sql_statement::{Error as StatementError, Status as StatementStatus};
use crate::postgres::sasl::SASLStatus;
use crate::shared::CachedStructure as PostgresCachedStructure;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::PostgresErrorOptions;
use bun_sql::postgres::PostgresProtocol as protocol;
use bun_sql::postgres::SSLMode;
use bun_sql::postgres::SocketMonitor;
use bun_sql::postgres::Status;
use bun_sql::postgres::TLSStatus;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::Data;
use bun_sql::shared::SQLQueryResultMode;

// Aliases for PostgresRequest's `on_data` dispatch (Zig used PascalCase nested types).
pub use bun_sql::postgres::SSLMode as SslMode;
pub use bun_sql::postgres::TLSStatus as TlsStatus;

type Socket = uws::AnySocket;

bun_core::define_scoped_log!(debug, Postgres, visible);

const MAX_PIPELINE_SIZE: usize = u16::MAX as usize; // about 64KB per connection

// TODO(port): PreparedStatementsMap uses IdentityContext(u64) (key is already a hash) at 80% load.
type PreparedStatementsMap = HashMap<u64, *mut PostgresSQLStatement>;

pub mod js {
    pub use crate::jsc::codegen::JSPostgresSQLConnection::*;
}
pub use js::{from_js, from_js_direct, to_js};

impl jsc::JsClass for PostgresSQLConnection {
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        // Ownership transfers to the JSC wrapper's m_ctx; freed via `finalize`.
        js::to_js(bun_core::heap::into_raw(Box::new(self)), global)
    }
    fn from_js(value: JSValue) -> Option<*mut Self> {
        js::from_js(value)
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        js::from_js_direct(value)
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        js::get_constructor(global)
    }
}

// `verify_error_to_js` sunk to `bun_jsc::system_error`; reach it via
// `crate::jsc::verify_error_to_js`.
use crate::jsc::verify_error_to_js;

#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct PostgresSQLConnection {
    // TODO(port): bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive refcount;
    // ref()/deref() forward to this. When it hits 0, `deinit` runs and frees the Box.
    pub socket: JsCell<Socket>,
    pub status: Cell<Status>,
    // Private — intrusive refcount invariant; reach via `ref_()`/`deref()`
    // (provided by `#[derive(CellRefCounted)]` above).
    ref_count: Cell<u32>,

    pub write_buffer: JsCell<OffsetByteList>,
    // Private — `JsCell` aliasing invariant; only `Reader` and `on_data`
    // touch these (both in this module).
    read_buffer: JsCell<OffsetByteList>,
    last_message_start: Cell<u32>,
    pub requests: JsCell<PostgresRequest::Queue>,
    /// number of pipelined requests (Bind/Execute/Prepared statements)
    pub pipelined_requests: Cell<u32>,
    /// number of non-pipelined requests (Simple/Copy)
    pub nonpipelinable_requests: Cell<u32>,

    pub poll_ref: JsCell<KeepAlive>,
    // Read-only back-reference to the JS global; the VM/global strictly outlives
    // every connection it creates. Only ever borrowed via `global()`.
    pub global_object: BackRef<JSGlobalObject>,
    // JSC_BORROW: process-lifetime singleton. `BackRef` so `vm()` is a safe
    // deref; constructed via `new_mut` (write provenance from `&mut *vm_ptr`)
    // so `vm_mut()`'s `&mut *as_ptr()` is sound.
    pub vm: BackRef<VirtualMachine>,
    pub statements: JsCell<PreparedStatementsMap>,
    pub prepared_statement_id: Cell<u64>,
    pub pending_activity_count: AtomicU32,
    // Self-wrapper back-ref (the JS object that owns this payload). Stored as a
    // weak `JsRef`, never a bare `JSValue` — this struct is heap-allocated and
    // the conservative GC scan covers stack/registers only.
    pub js_value: JsCell<crate::jsc::JsRef>,

    pub backend_parameters: JsCell<StringMap>,
    pub backend_key_data: JsCell<protocol::BackendKeyData>,

    database: bun_ptr::RawSlice<u8>,
    user: bun_ptr::RawSlice<u8>,
    password: bun_ptr::RawSlice<u8>,
    path: bun_ptr::RawSlice<u8>,
    options: bun_ptr::RawSlice<u8>,
    options_buf: Box<[u8]>,

    pub authentication_state: JsCell<AuthenticationState>,

    /// `us_ssl_ctx_t` built from `tls_config` at construct time. Applied via
    /// `us_socket_adopt_tls` when the server replies `S` to the SSLRequest.
    pub secure: Option<*mut uws::SslCtx>,
    pub tls_config: jsc::api::ServerConfig::SSLConfig,
    pub tls_status: Cell<TLSStatus>,
    pub ssl_mode: SSLMode,

    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,

    pub flags: Cell<ConnectionFlags>,

    timer: JsCell<EventLoopTimer>,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    // Private — see `timer`; recovered via [`Self::from_max_lifetime_timer_ptr`].
    max_lifetime_timer: JsCell<EventLoopTimer>,
    pub auto_flusher: JsCell<AutoFlusher>,
}

bun_event_loop::impl_timer_owner!(PostgresSQLConnection;
    from_timer_ptr => timer,
    from_max_lifetime_timer_ptr => max_lifetime_timer,
);

impl PostgresSQLConnection {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the packed `Cell<ConnectionFlags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut ConnectionFlags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    // ─────────────────────────────────────────────────────────────────────────

    #[inline]
    fn global(&self) -> &JSGlobalObject {
        self.global_object.get()
    }
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }

    #[inline]
    fn vm_mut(&self) -> &'static mut VirtualMachine {
        VirtualMachine::get_mut()
    }

    #[inline]
    fn event_loop(&self) -> &'static mut crate::jsc::EventLoop {
        // `vm_mut()` yields the process-lifetime `'static mut VM` (see above);
        // the event loop it owns lives for the VM's lifetime. Single-JS-thread
        // invariant ⇒ callers never hold two `&mut EventLoop` at once.
        self.vm_mut().event_loop_mut()
    }

    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::posix_event_loop::get_vm_ctx(bun_io::AllocatorType::Js)
    }

    #[inline]
    pub fn database(&self) -> &[u8] {
        self.database.slice()
    }

    #[inline]
    pub fn user(&self) -> &[u8] {
        self.user.slice()
    }

    #[inline]
    pub fn password(&self) -> &[u8] {
        self.password.slice()
    }

    #[inline]
    pub fn path(&self) -> &[u8] {
        self.path.slice()
    }

    #[inline]
    pub fn options(&self) -> &[u8] {
        self.options.slice()
    }

    /// Project `&mut SASL` from `authentication_state` if it is currently the
    /// `Sasl` variant. One audited [`JsCell::get_mut`] here replaces the three
    /// per-site unchecked `authentication_state.get_mut()` derefs in the SASL
    /// handshake arms of [`on`](Self::on).
    ///
    /// SAFETY (encapsulated): single-JS-thread; callers hold the returned
    /// `&mut SASL` only for the synchronous packet-handler body and drop it
    /// before any call that touches `authentication_state` again
    /// (`self.writer()` / `self.flush_data()` / `self.fail()` do not).
    #[inline]
    #[allow(clippy::mut_from_ref)] // body projects through `JsCell` (UnsafeCell-backed); see SAFETY note
    fn sasl_state_mut(&self) -> Option<&mut crate::postgres::sasl::SASL> {
        // SAFETY: see doc comment — single-JS-thread, no re-entrant access to
        // `authentication_state` for the borrow's lifetime.
        match unsafe { self.authentication_state.get_mut() } {
            AuthenticationState::Sasl(s) => Some(s),
            _ => None,
        }
    }

    pub fn on_auto_flush(&self) -> bool {
        <Self as HasAutoFlush>::on_auto_flush(self.as_ctx_ptr())
    }
}

impl HasAutoFlush for PostgresSQLConnection {
    fn on_auto_flush(this: *mut Self) -> bool {
        let this = ParentRef::from(NonNull::new(this).expect("auto-flush ctx non-null"));
        this.on_auto_flush_impl()
    }
}

impl PostgresSQLConnection {
    fn on_auto_flush_impl(&self) -> bool {
        if self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            debug!("onAutoFlush: has backpressure");
            self.auto_flusher.with_mut(|a| a.registered = false);
            // if we have backpressure, wait for onWritable
            return false;
        }
        self.ref_();
        debug!("onAutoFlush: draining");
        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
            && self.write_buffer.get().len() > 0;
        debug!(
            "onAutoFlush: keep_flusher_registered: {}",
            keep_flusher_registered
        );
        self.auto_flusher
            .with_mut(|a| a.registered = keep_flusher_registered);
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(self.as_ctx_ptr()) };
        keep_flusher_registered
    }

    fn register_auto_flusher(&self) {
        let data_to_send = self.write_buffer.get().len();
        debug!(
            "registerAutoFlusher: backpressure: {} registered: {} data_to_send: {}",
            self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE),
            self.auto_flusher.get().registered,
            data_to_send
        );

        if !self.auto_flusher.get().registered // should not be registered
            && !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) // if has backpressure we need to wait for onWritable event
            && data_to_send > 0 // we need data to send
            && self.status.get() == Status::Connected
        // and we need to be connected
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(
                self.as_ctx_ptr(),
                self.vm(),
            );
            self.auto_flusher.with_mut(|a| a.registered = true);
        }
    }

    fn unregister_auto_flusher(&self) {
        debug!(
            "unregisterAutoFlusher registered: {}",
            self.auto_flusher.get().registered
        );
        if self.auto_flusher.get().registered {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(
                self.as_ctx_ptr(),
                self.vm(),
            );
            self.auto_flusher.with_mut(|a| a.registered = false);
        }
    }

    fn get_timeout_interval(&self) -> u32 {
        match self.status.get() {
            Status::Connected => self.idle_timeout_interval_ms,
            Status::Failed => 0,
            _ => self.connection_timeout_ms,
        }
    }

    pub fn disable_connection_timeout(&self) {
        self.timer.with_mut(|t| {
            if t.state == EventLoopTimerState::ACTIVE {
                self.vm_mut().timer().remove(t);
            }
            t.state = EventLoopTimerState::CANCELLED;
        });
    }

    pub fn reset_connection_timeout(&self) {
        // if we are processing data, don't reset the timeout, wait for the data to be processed
        if self
            .flags
            .get()
            .contains(ConnectionFlags::IS_PROCESSING_DATA)
        {
            return;
        }
        let interval = self.get_timeout_interval();
        self.timer.with_mut(|t| {
            if t.state == EventLoopTimerState::ACTIVE {
                self.vm_mut().timer().remove(t);
            }
            if interval == 0 {
                return;
            }
            t.next = bun_core::Timespec::ms_from_now(
                bun_core::TimespecMockMode::AllowMockedTime,
                i64::from(interval),
            );
            self.vm_mut().timer().insert(t);
        });
    }

    bun_jsc::cached_prop_hostfns! {
        crate::jsc::codegen::JSPostgresSQLConnection;
        lazy_array(get_queries => queries_get_cached, queries_set_cached),
        (get_on_connect, set_on_connect => onconnect_get_cached, onconnect_set_cached),
        (get_on_close,   set_on_close   => onclose_get_cached, onclose_set_cached),
    }

    pub fn setup_tls(&self) {
        debug!("setupTLS");
        // `vm_mut()` is `'static`, so `tls_group` borrows the VM singleton —
        // not `*self` — and stays live across the field reads below.
        let tls_group: &mut bun_uws::SocketGroup = self.vm_mut().postgres_socket_group::<true>();

        // Zig: `this.socket.SocketTCP.socket.connected` — at this point we are
        // a plain TCP socket in the Connected state.
        let Socket::SocketTcp(tcp) = self.socket.get() else {
            self.fail(
                b"Failed to upgrade to TLS",
                AnyPostgresError::TLSUpgradeFailed,
            );
            return;
        };
        let uws::InternalSocket::Connected(raw) = tcp.socket else {
            self.fail(
                b"Failed to upgrade to TLS",
                AnyPostgresError::TLSUpgradeFailed,
            );
            return;
        };

        // SAFETY: `secure` is set to a live `SSL_CTX*` before `setup_tls` is
        // reached (Zig: `this.secure.?`).
        let ssl_ctx = unsafe {
            &mut *self
                .secure
                .expect("secure SSL_CTX must be set before setupTLS")
        };
        let server_name = self.tls_config.server_name();
        let sni = if server_name.is_null() {
            None
        } else {
            // SAFETY: `server_name` is a NUL-terminated C string owned by
            // `tls_config` for the connection lifetime.
            Some(unsafe { bun_core::ffi::cstr(server_name) })
        };
        let ext_size =
            core::mem::size_of::<Option<core::ptr::NonNull<PostgresSQLConnection>>>() as i32;

        // SAFETY: `raw` is a live connected `us_socket_t*`; adopt_tls may
        // realloc and return a different ptr.
        let Some(new_socket) = (unsafe { &mut *raw }).adopt_tls(
            tls_group,
            bun_uws::SocketKind::PostgresTls,
            ssl_ctx,
            sni,
            ext_size,
            ext_size,
        ) else {
            self.fail(
                b"Failed to upgrade to TLS",
                AnyPostgresError::TLSUpgradeFailed,
            );
            return;
        };
        let new_socket = new_socket.as_ptr();
        // SAFETY: `new_socket` is a live us_socket_t freshly returned by
        // `adopt_tls`; ext slot is sized for `Option<NonNull<PostgresSQLConnection>>`
        // above. One `&mut` reborrow drives both safe inherent methods
        // (`ext` / `start_tls_handshake`). Zig: `ext(?*PostgresSQLConnection).* = this`.
        let sock = unsafe { &mut *new_socket };
        *sock.ext::<Option<core::ptr::NonNull<PostgresSQLConnection>>>() =
            core::ptr::NonNull::new(self.as_ctx_ptr());
        self.socket.set(Socket::SocketTls(uws::SocketTLS {
            socket: uws::InternalSocket::Connected(new_socket),
        }));
        // ext is now repointed; safe to kick the handshake (any dispatch lands here).
        sock.start_tls_handshake();
        self.start();
    }

    fn setup_max_lifetime_timer_if_necessary(&self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        self.max_lifetime_timer.with_mut(|t| {
            if t.state == EventLoopTimerState::ACTIVE {
                return;
            }
            t.next = bun_core::Timespec::ms_from_now(
                bun_core::TimespecMockMode::AllowMockedTime,
                i64::from(self.max_lifetime_interval_ms),
            );
            self.vm_mut().timer().insert(t);
        });
    }

    pub fn on_connection_timeout(&self) {
        debug!("onConnectionTimeout");

        self.timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        if self
            .flags
            .get()
            .contains(ConnectionFlags::IS_PROCESSING_DATA)
        {
            return;
        }

        if self.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        use bun_core::fmt::{ConnTimeoutKind::*, fmt_conn_timeout};
        let (code, kind, ms, sfx): (&[u8], _, _, _) = match self.status.get() {
            Status::Connected => (
                b"ERR_POSTGRES_IDLE_TIMEOUT",
                Idle,
                self.idle_timeout_interval_ms,
                "",
            ),
            Status::SentStartupMessage => (
                b"ERR_POSTGRES_CONNECTION_TIMEOUT",
                Connection,
                self.connection_timeout_ms,
                " (sent startup message, but never received response)",
            ),
            _ => (
                b"ERR_POSTGRES_CONNECTION_TIMEOUT",
                Connection,
                self.connection_timeout_ms,
                "",
            ),
        };
        self.fail_fmt(code, format_args!("{}", fmt_conn_timeout(kind, ms, sfx)));
    }

    pub fn on_max_lifetime_timeout(&self) {
        debug!("onMaxLifetimeTimeout");
        self.max_lifetime_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        if self.status.get() == Status::Failed {
            return;
        }
        use bun_core::fmt::{ConnTimeoutKind, fmt_conn_timeout};
        self.fail_fmt(
            b"ERR_POSTGRES_LIFETIME_TIMEOUT",
            format_args!(
                "{}",
                fmt_conn_timeout(
                    ConnTimeoutKind::MaxLifetime,
                    self.max_lifetime_interval_ms,
                    ""
                )
            ),
        );
    }

    fn start(&self) {
        self.setup_max_lifetime_timer_if_necessary();
        self.reset_connection_timeout();
        self.send_startup_message();

        self.drain_internal();
    }

    pub fn has_pending_activity(this: &Self) -> bool {
        // Called on GC thread; reads only atomic field.
        this.pending_activity_count.load(Ordering::Acquire) > 0
    }

    fn update_has_pending_activity(&self) {
        let a: u32 = if self.requests.get().readable_length() > 0 {
            1
        } else {
            0
        };
        let b: u32 = match self.status.get() {
            Status::Disconnected | Status::Failed => (!self.socket.get().is_closed()) as u32,
            _ => 1,
        };
        self.pending_activity_count.store(a + b, Ordering::Release);
    }

    pub fn set_status(&self, status: Status) {
        if self.status.get() == status {
            return;
        }
        // PORT NOTE: reshaped for borrowck — `defer this.updateHasPendingActivity()` moved to explicit calls below.

        self.status.set(status);
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
                let js_value = self.js_value.get().get();
                js_value.ensure_still_alive();
                self.global()
                    .queue_microtask(on_connect, &[JSValue::NULL, js_value]);
                self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));
            }
            _ => {}
        }
        self.update_has_pending_activity();
    }

    pub fn finalize(self: Box<Self>) {
        debug!("PostgresSQLConnection finalize");
        // Refcounted: release the JS wrapper's +1; allocation may outlive this
        // call if other refs remain, so hand ownership back to the raw refcount
        // FIRST so a panic in the work below leaks instead of UAF-ing siblings.
        let this = bun_core::heap::release(self);
        this.stop_timers();
        this.js_value.with_mut(|r| r.finalize());
        // SAFETY: `this` is the live m_ctx allocation; `deref` frees on count==0.
        unsafe { Self::deref(this) };
    }

    pub fn flush_data_and_reset_timeout(&self) {
        self.reset_connection_timeout();
        // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
        self.register_auto_flusher();
    }

    pub fn flush_data(&self) {
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
            SocketMonitor::write(&chunk[..usize::try_from(wrote).expect("int cast")]);
            self.write_buffer
                .with_mut(|b| b.consume(u32::try_from(wrote).expect("int cast")));
        }
    }

    pub fn fail_with_js_value(&self, value: JSValue) {
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.updateHasPendingActivity()` +
        // `defer this.refAndClose(value)`; expanded inline at each return below.
        self.stop_timers();
        if self.status.get() == Status::Failed {
            self.update_has_pending_activity();
            return;
        }

        self.status.set(Status::Failed);

        self.ref_();
        // we defer the refAndClose so the on_close will be called first before we reject the pending requests
        let on_close_opt = self.consume_on_close_callback(self.global());
        if let Some(on_close) = on_close_opt {
            let event_loop = self.event_loop();
            event_loop.enter();
            let mut js_error = value.to_error().unwrap_or(value);
            if js_error.is_empty() {
                js_error = postgres_error_to_js(
                    self.global(),
                    Some(b"Connection closed"),
                    AnyPostgresError::ConnectionClosed,
                );
            }
            js_error.ensure_still_alive();
            let queries = self.get_queries_array();
            if let Err(e) = on_close.call(self.global(), JSValue::UNDEFINED, &[js_error, queries]) {
                self.global().report_active_exception_as_unhandled(e);
            }
            event_loop.exit();
        }
        self.ref_and_close(Some(value));
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(self.as_ctx_ptr()) };
        self.update_has_pending_activity();
    }

    pub fn fail_fmt(&self, code: &[u8], args: core::fmt::Arguments<'_>) {
        // PORT NOTE: Zig used `comptime fmt: [:0]const u8, args: anytype` → collapsed to fmt::Arguments.
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

    pub fn fail(&self, message: &[u8], err: AnyPostgresError) {
        debug!(
            "failed: {}: {}",
            bstr::BStr::new(message),
            <&'static str>::from(err)
        );

        let global_object = self.global();

        self.fail_with_js_value(postgres_error_to_js(global_object, Some(message), err));
    }

    pub fn on_close(&self) {
        self.unregister_auto_flusher();

        if self.vm().is_shutting_down() {
            self.stop_timers();
            if self.status.get() == Status::Failed {
                self.update_has_pending_activity();
                return;
            }

            self.status.set(Status::Failed);
            self.clean_up_requests(None);
            self.update_has_pending_activity();
        } else {
            let event_loop = self.event_loop();
            event_loop.enter();
            self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));

            self.fail(b"Connection closed", AnyPostgresError::ConnectionClosed);
            event_loop.exit();
        }
    }

    fn send_startup_message(&self) {
        if self.status.get() != Status::Connecting {
            return;
        }
        debug!("sendStartupMessage");
        self.status.set(Status::SentStartupMessage);
        let msg = protocol::StartupMessage {
            user: Data::Temporary(self.user),
            database: Data::Temporary(self.database),
            options: Data::Temporary(self.options),
        };
        if let Err(err) = msg.write_internal(self.writer()) {
            self.fail(
                b"Failed to write startup message",
                AnyPostgresError::from(err),
            );
        }
    }

    // PORT NOTE: Zig passed `socket` by value; both call sites have already
    // stored it into `self.socket`, so dispatch through `self.socket.get()` instead
    // (avoids moving the non-`Copy` `AnySocket` enum out of `self`).
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

    pub fn on_open(&self, socket: uws::AnySocket) {
        self.socket.set(socket);

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

    pub fn on_handshake(&self, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        debug!("onHandshake: {} {}", success, ssl_error.error_no);
        let handshake_success = success == 1;
        if handshake_success {
            if self.tls_config.reject_unauthorized() != 0 {
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else {
                                return;
                            };
                            self.fail_with_js_value(v);
                            return;
                        }

                        if self.ssl_mode == SSLMode::VerifyFull {
                            let servername = self.tls_config.server_name();
                            let ok = if servername.is_null() {
                                false
                            } else {
                                // SAFETY: native handle of a connected TLS socket is `SSL*`.
                                let ssl_ptr: *mut BoringSSL::c::SSL = self
                                    .socket
                                    .get()
                                    .get_native_handle()
                                    .map_or(core::ptr::null_mut(), |p| p.cast());
                                // SAFETY: `servername` is a NUL-terminated C string owned by `tls_config`.
                                let hostname =
                                    unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
                                // SAFETY: `ssl_ptr` is the live SSL* of a connected TLS socket.
                                !ssl_ptr.is_null()
                                    && BoringSSL::check_server_identity(
                                        unsafe { &mut *ssl_ptr },
                                        hostname,
                                    )
                            };
                            if !ok {
                                let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else {
                                    return;
                                };
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
            let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else {
                return;
            };
            self.fail_with_js_value(v);
        }
    }

    pub fn on_timeout(&self) {
        debug!("onTimeout");
    }

    pub fn on_drain(&self) {
        debug!("onDrain");
        self.update_flags(|f| f.remove(ConnectionFlags::HAS_BACKPRESSURE));
        // Don't send any other messages while we're waiting for TLS.
        if let TLSStatus::MessageSent(sent) = self.tls_status.get() {
            if sent < 8 {
                self.start_tls();
            }
            return;
        }

        self.drain_internal();
    }

    fn drain_internal(&self) {
        debug!("drainInternal");
        if self.vm().is_shutting_down() {
            return self.close();
        }

        let event_loop = self.event_loop();
        event_loop.enter();

        self.flush_data();

        let flags = self.flags.get();
        if !flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
            && flags.contains(ConnectionFlags::IS_READY_FOR_QUERY)
        {
            // no backpressure yet so pipeline more if possible and flush again
            self.advance();
            self.flush_data();
        }
        event_loop.exit();
    }

    pub fn on_data(&self, data: &[u8]) {
        self.ref_();
        self.update_flags(|f| f.insert(ConnectionFlags::IS_PROCESSING_DATA));

        self.disable_connection_timeout();
        // PORT NOTE: Zig `defer { ... }` block expanded after the body below.

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
                        {
                            let _ = err; /* TODO(port): bun_crash_handler::handle_error_return_trace */
                        };
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
                        {
                            let _ = err; /* TODO(port): bun_crash_handler::handle_error_return_trace */
                        };
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
                    }
                }
            }
        }

        event_loop.exit();
        // === defer block ===
        if self.status.get() == Status::Connected
            && !self.has_query_running()
            && self.write_buffer.get().remaining().is_empty()
        {
            // Don't keep the process alive when there's nothing to do.
            self.poll_ref.with_mut(|r| r.unref(self.vm_ctx()));
        } else if self.status.get() == Status::Connected {
            // Keep the process alive if there's something to do.
            self.poll_ref.with_mut(|r| r.r#ref(self.vm_ctx()));
        }
        self.update_flags(|f| f.remove(ConnectionFlags::IS_PROCESSING_DATA));

        // reset the connection timeout after we're done processing the data
        self.reset_connection_timeout();
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(self.as_ctx_ptr()) };
    }

    pub fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut PostgresSQLConnection> {
        Err(global_object.throw(format_args!(
            "PostgresSQLConnection cannot be constructed directly"
        )))
    }
}

// comptime { @export(&jsc.toJSHostFn(call), .{ .name = "PostgresSQLConnection__createInstance" }) }
// TODO(port): the #[crate::jsc::host_fn] attribute on `call` should emit the correct
// `#[unsafe(no_mangle)]` shim named `PostgresSQLConnection__createInstance`.
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub(crate) unsafe fn PostgresSQLConnection__createInstance(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JSValue {
        match call(global, callframe) {
            Ok(v) => v,
            Err(_) => JSValue::ZERO,
        }
    }
}

pub(crate) fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // `bun_vm()` → `&'static VirtualMachine` (per-thread singleton); `as_mut()`
    // is the canonical safe escape hatch (one audited unsafe in bun_jsc) for
    // `&mut self` helpers like `ssl_ctx_cache()` / `postgres_socket_group()`.
    let vm = global_object.bun_vm().as_mut();
    let arguments = callframe.arguments();
    let hostname_str = bun_core::OwnedString::new(arguments[0].to_bun_string(global_object)?);
    let port = arguments[1].coerce::<i32>(global_object)?;

    let username_str = bun_core::OwnedString::new(arguments[2].to_bun_string(global_object)?);
    let password_str = bun_core::OwnedString::new(arguments[3].to_bun_string(global_object)?);
    let database_str = bun_core::OwnedString::new(arguments[4].to_bun_string(global_object)?);
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
            match jsc::api::ServerConfig::SSLConfig::from_js(&mut *vm, global_object, tls_object) {
                Ok(opt) => opt.unwrap_or_default(),
                Err(_) => return Ok(JSValue::ZERO),
            }
        } else {
            return Err(global_object
                .throw_invalid_arguments(format_args!("tls must be a boolean or an object")));
        };

        if global_object.has_exception() {
            drop(tls_config);
            return Ok(JSValue::ZERO);
        }

        let mut err: uws::create_bun_socket_error_t = uws::create_bun_socket_error_t::none;
        secure = vm
            .ssl_ctx_cache()
            .get_or_create_opts(&tls_config.as_usockets_for_client_verification(), &mut err);
        if secure.is_none() {
            drop(tls_config);
            // TODO(port): Zig `err.toJS(globalObject)` — `to_js` lives as an extension
            // in the runtime _jsc crate and isn't reachable from sql_jsc; throw the
            // static message instead.
            return Err(global_object.throw(format_args!(
                "{}",
                bun_core::fmt::s(err.message().unwrap_or(b"Failed to create SSL context"))
            )));
        }
    }
    let errdefer_guard = scopeguard::guard((secure, tls_config), |(secure, _tls_config)| {
        if let Some(s) = secure {
            // SAFETY: SSL_CTX_free is safe to call on a valid SSL_CTX*.
            unsafe { BoringSSL::c::SSL_CTX_free(s) };
        }
    });

    let username: bun_ptr::RawSlice<u8>;
    let password: bun_ptr::RawSlice<u8>;
    let database: bun_ptr::RawSlice<u8>;
    let options: bun_ptr::RawSlice<u8>;
    let path: bun_ptr::RawSlice<u8>;

    let options_str = bun_core::OwnedString::new(arguments[7].to_bun_string(global_object)?);

    let path_str = bun_core::OwnedString::new(arguments[8].to_bun_string(global_object)?);

    let options_buf: Box<[u8]> = 'brk: {
        let mut b = bun_core::StringBuilder::default();
        b.cap += username_str.utf8_byte_length()
            + 1
            + password_str.utf8_byte_length()
            + 1
            + database_str.utf8_byte_length()
            + 1
            + options_str.utf8_byte_length()
            + 1
            + path_str.utf8_byte_length()
            + 1;

        let _ = b.allocate();
        let u = username_str.to_utf8_without_ref();
        username = bun_ptr::RawSlice::new(b.append(u.slice()));
        drop(u);

        let p = password_str.to_utf8_without_ref();
        password = bun_ptr::RawSlice::new(b.append(p.slice()));
        drop(p);

        let d = database_str.to_utf8_without_ref();
        database = bun_ptr::RawSlice::new(b.append(d.slice()));
        drop(d);

        let o = options_str.to_utf8_without_ref();
        options = bun_ptr::RawSlice::new(b.append(o.slice()));
        drop(o);

        let _path = path_str.to_utf8_without_ref();
        path = bun_ptr::RawSlice::new(b.append(_path.slice()));
        drop(_path);

        break 'brk b.move_to_slice();
    };

    // Reject null bytes in connection parameters to prevent Postgres startup
    // message parameter injection (null bytes act as field terminators in the
    // wire protocol's key\0value\0 format).
    for (entry, name) in [
        (username, &b"username"[..]),
        (password, b"password"),
        (database, b"database"),
        (path, b"path"),
    ] {
        let entry = entry.slice();
        if !entry.is_empty() && entry.contains(&0) {
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

    // Ownership transferred into `ptr`; disarm the errdefer and recover the
    // moved `secure`/`tls_config` for the struct literal below.
    let (secure, tls_config) = scopeguard::ScopeGuard::into_inner(errdefer_guard);

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
            requests: JsCell::new(PostgresRequest::Queue::init()),
            pipelined_requests: Cell::new(0),
            nonpipelinable_requests: Cell::new(0),
            poll_ref: JsCell::new(KeepAlive::default()),
            global_object: BackRef::new(global_object),
            vm: BackRef::new_mut(vm),
            statements: JsCell::new(PreparedStatementsMap::default()),
            prepared_statement_id: Cell::new(0),
            pending_activity_count: AtomicU32::new(0),
            js_value: JsCell::new(crate::jsc::JsRef::empty()),
            backend_parameters: JsCell::new(StringMap::init(true)),
            backend_key_data: JsCell::new(protocol::BackendKeyData::default()),
            database,
            user: username,
            password,
            path,
            options,
            options_buf,
            authentication_state: JsCell::new(AuthenticationState::Pending),
            secure,
            tls_config,
            tls_status: Cell::new(if ssl_mode != SSLMode::Disable {
                TLSStatus::Pending
            } else {
                TLSStatus::None
            }),
            ssl_mode,
            idle_timeout_interval_ms: u32::try_from(idle_timeout).expect("int cast"),
            connection_timeout_ms: u32::try_from(connection_timeout).expect("int cast"),
            flags: Cell::new(if use_unnamed_prepared_statements {
                ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS
            } else {
                ConnectionFlags::empty()
            }),
            timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::PostgresSQLConnectionTimeout,
            )),
            max_lifetime_interval_ms: u32::try_from(max_lifetime).expect("int cast"),
            max_lifetime_timer: JsCell::new(EventLoopTimer::init_paused(
                EventLoopTimerTag::PostgresSQLConnectionMaxLifetime,
            )),
            auto_flusher: JsCell::new(AutoFlusher::default()),
        }));

    // `heap::into_raw` is `Box::into_raw` — never null. Sole owner until
    // `to_js` below. R-2: every field is interior-mutable, so a shared
    // `ParentRef` deref is sufficient for the writes below.
    let this = ParentRef::from(core::ptr::NonNull::new(ptr).expect("heap::into_raw non-null"));

    {
        let hostname = hostname_str.to_utf8();

        // Postgres always opens plain TCP first (SSLRequest happens in-band),
        // so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()`
        // adopts into `postgres_tls_group` after the server's `S`.
        let group = vm.postgres_socket_group::<false>();
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
                hostname.slice(),
                port,
                ptr,
                false,
            )
        };

        this.socket.set(Socket::SocketTcp(match result {
            Ok(s) => s,
            Err(err) => {
                PostgresSQLConnection::deinit(ptr);
                return Err(
                    global_object.throw_error(err.into(), "failed to connect to postgresql")
                );
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
    js::onconnect_set_cached(js_value, global_object, on_connect);
    js::onclose_set_cached(js_value, global_object, on_close);
    /* TODO(port): bun_core::analytics::Features::POSTGRES_CONNECTIONS counter */
    Ok(js_value)
}

/// Referenced by `dispatch.zig` (kind = `.postgres[_tls]`). Now the only
/// caller — `configure()` is gone.
pub struct SocketHandler<const SSL: bool>;

// Inherent associated types are unstable; use a free type alias instead.
pub type SocketType<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> SocketHandler<SSL> {
    fn _socket(s: SocketType<SSL>) -> Socket {
        // `NewSocketHandler<SSL>` has identical layout for any `SSL`; rebuild the
        // monomorphic variant from the inner `InternalSocket`.
        if SSL {
            Socket::SocketTls(uws::SocketTLS { socket: s.socket })
        } else {
            Socket::SocketTcp(uws::SocketTCP { socket: s.socket })
        }
    }

    #[inline]
    fn guarded(this: &PostgresSQLConnection, f: impl FnOnce(&PostgresSQLConnection)) {
        if this.vm().is_shutting_down() {
            bun_core::hint::cold();
            this.close();
            return;
        }
        f(this)
    }

    pub fn on_open(this: &PostgresSQLConnection, socket: SocketType<SSL>) {
        Self::guarded(this, |t| t.on_open(Self::_socket(socket)));
    }

    fn on_handshake_(
        this: &PostgresSQLConnection,
        _: SocketType<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        Self::guarded(this, |t| t.on_handshake(success, ssl_error));
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    // TODO(port): conditional associated const fn — in Rust, expose `Option<fn(...)>`.
    pub const ON_HANDSHAKE: Option<
        fn(&PostgresSQLConnection, SocketType<SSL>, i32, uws::us_bun_verify_error_t),
    > = if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(
        this: &PostgresSQLConnection,
        _socket: SocketType<SSL>,
        _: i32,
        _: Option<*mut c_void>,
    ) {
        this.on_close();
    }

    pub fn on_end(this: &PostgresSQLConnection, _socket: SocketType<SSL>) {
        this.on_close();
    }

    pub fn on_connect_error(this: &PostgresSQLConnection, _socket: SocketType<SSL>, _: i32) {
        Self::guarded(this, |t| t.on_close());
    }

    pub fn on_timeout(this: &PostgresSQLConnection, _socket: SocketType<SSL>) {
        Self::guarded(this, |t| t.on_timeout());
    }

    pub fn on_data(this: &PostgresSQLConnection, _socket: SocketType<SSL>, data: &[u8]) {
        Self::guarded(this, |t| t.on_data(data));
    }

    pub fn on_writable(this: &PostgresSQLConnection, _socket: SocketType<SSL>) {
        Self::guarded(this, |t| t.on_drain());
    }
}

impl PostgresSQLConnection {
    bun_jsc::poll_ref_hostfns!(
        field = poll_ref,
        ctx = vm_ctx,
        after = |this: &Self| this.update_has_pending_activity(),
    );

    pub fn do_flush(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    fn close(&self) {
        self.disconnect();
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

    pub fn stop_timers(&self) {
        self.timer.with_mut(|t| {
            if t.state == EventLoopTimerState::ACTIVE {
                self.vm_mut().timer().remove(t);
            }
        });
        self.max_lifetime_timer.with_mut(|t| {
            if t.state == EventLoopTimerState::ACTIVE {
                self.vm_mut().timer().remove(t);
            }
        });
    }

    fn deinit(this: *mut Self) {
        // SAFETY: sole remaining owner; `this` is a live Box-allocated connection.
        unsafe {
            (*this).disconnect();
            (*this).stop_timers();
            for stmt_ptr in (*this).statements.get().values() {
                // statements map owns a ref to each statement.
                PostgresSQLStatement::deref(*stmt_ptr);
            }
            // statements/requests/write_buffer/read_buffer/backend_parameters dropped below.
            // PORT NOTE: Zig called .deinit() on each; Rust Drop handles Vec/HashMap/OffsetByteList.

            // PORT NOTE: Zig `freeSensitive(allocator, options_buf)` zeroes then frees the
            // backing slice. The Rust `free_sensitive` is the C-string variant; here we
            // volatile-zero the Box<[u8]> in place and let Box::drop free it.
            {
                let buf = &mut *core::ptr::addr_of_mut!((*this).options_buf);
                for b in buf.iter_mut() {
                    core::ptr::write_volatile(b, 0);
                }
            }

            // tls_config dropped by Box drop below.
            if let Some(s) = (*this).secure {
                // SSL_CTX_free on a valid SSL_CTX*.
                BoringSSL::c::SSL_CTX_free(s);
            }
            // Box-allocated in `call()`; ref_count is 0; reclaim.
            drop(bun_core::heap::take(this));
        }
    }

    fn clean_up_requests(&self, js_reason: Option<JSValue>) {
        while self.requests.get().readable_length() > 0 {
            let request_ptr: *mut PostgresSQLQuery = self.requests.get().peek_item(0);
            let request = ParentRef::from(NonNull::new(request_ptr).expect("queue item non-null"));
            match request.status.get() {
                // pending we will fail the request and the stmt will be marked as error ConnectionClosed too
                QueryStatus::Pending => {
                    let Some(stmt) = request.statement_mut() else {
                        // `continue` in Zig with `orelse continue` — but we still need to deref+discard.
                        // PORT NOTE: Zig `orelse continue` skips the deref/discard at the bottom too;
                        // matching that behavior here.
                        continue;
                    };
                    stmt.error_response = Some(StatementError::PostgresError(
                        AnyPostgresError::ConnectionClosed,
                    ));
                    stmt.status = StatementStatus::Failed;
                    if !self.vm().is_shutting_down() {
                        let global = self.global();
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, global);
                        } else {
                            request.on_error(
                                &StatementError::PostgresError(AnyPostgresError::ConnectionClosed),
                                global,
                            );
                        }
                    }
                }
                // in the middle of running
                QueryStatus::Binding | QueryStatus::Running | QueryStatus::PartialResponse => {
                    self.finish_request(&request);
                    if !self.vm().is_shutting_down() {
                        let global = self.global();
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, global);
                        } else {
                            request.on_error(
                                &StatementError::PostgresError(AnyPostgresError::ConnectionClosed),
                                global,
                            );
                        }
                    }
                }
                // just ignore success and fail cases
                QueryStatus::Success | QueryStatus::Fail => {}
            }
            self.discard_request(request_ptr);
        }
    }

    fn ref_and_close(&self, js_reason: Option<JSValue>) {
        // refAndClose is always called when we wanna to disconnect or when we are closed

        if !self.socket.get().is_closed() {
            // event loop need to be alive to close the socket
            self.poll_ref.with_mut(|r| r.ref_(self.vm_ctx()));
            // will unref on socket close
            self.socket.get().close(uws::CloseKind::Normal);
        }

        // cleanup requests
        self.clean_up_requests(js_reason);
    }

    pub fn disconnect(&self) {
        self.stop_timers();
        self.unregister_auto_flusher();
        if self.status.get() == Status::Connected {
            self.status.set(Status::Disconnected);
            self.ref_and_close(None);
        }
    }

    fn current(&self) -> Option<ParentRef<PostgresSQLQuery>> {
        let q = self.requests.get();
        if q.readable_length() == 0 {
            return None;
        }
        Some(ParentRef::from(
            NonNull::new(q.peek_item(0)).expect("queue item non-null"),
        ))
    }

    #[inline]
    fn discard_request(&self, request: *mut PostgresSQLQuery) {
        if self.requests.get().readable_length() == 0 || self.requests.get().peek_item(0) != request
        {
            return;
        }
        // SAFETY: `request` was obtained via `self.requests.get().peek_item(_)`
        // (queue invariant: every stored pointer is a live, heap-allocated
        // `PostgresSQLQuery` with refcount ≥ 1 held by the queue itself); this
        // releases exactly that ref. May free if no other refs remain.
        unsafe { PostgresSQLQuery::deref(request) };
        self.requests.with_mut(|q| q.discard(1));
    }

    pub fn has_query_running(&self) -> bool {
        !self
            .flags
            .get()
            .contains(ConnectionFlags::IS_READY_FOR_QUERY)
            || self.current().is_some()
    }

    pub fn can_pipeline(&self) -> bool {
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
            && (self.write_buffer.get().len() as usize) < MAX_PIPELINE_SIZE // buffer is too big need to flush before pipeline more
    }
}

#[derive(Clone, Copy)]
pub struct Writer {
    pub connection: BackRef<PostgresSQLConnection>,
}

impl Writer {
    pub fn write(&mut self, data: &[u8]) -> Result<(), AnyPostgresError> {
        self.connection
            .write_buffer
            .with_mut(|b| b.write(data))
            .map_err(|_| AnyPostgresError::OutOfMemory)?;
        Ok(())
    }

    pub fn pwrite(&mut self, data: &[u8], index: usize) -> Result<(), AnyPostgresError> {
        self.connection.write_buffer.with_mut(|b| {
            b.byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        });
        Ok(())
    }

    pub fn offset(self) -> usize {
        self.connection.write_buffer.get().len() as usize
    }
}

impl protocol::WriterContext for Writer {
    #[inline]
    fn offset(self) -> usize {
        Writer::offset(self)
    }
    #[inline]
    fn write(mut self, bytes: &[u8]) -> Result<(), AnyPostgresError> {
        Writer::write(&mut self, bytes)
    }
    #[inline]
    fn pwrite(mut self, bytes: &[u8], i: usize) -> Result<(), AnyPostgresError> {
        Writer::pwrite(&mut self, bytes, i)
    }
}

impl PostgresSQLConnection {
    pub fn writer(&self) -> protocol::NewWriter<Writer> {
        protocol::NewWriter {
            wrapped: Writer {
                connection: BackRef::new(self),
            },
        }
    }
}

#[derive(Clone, Copy)]
pub struct Reader {
    pub connection: BackRef<PostgresSQLConnection>,
}

impl Reader {
    #[inline]
    fn read_buffer(&self) -> &OffsetByteList {
        self.connection.read_buffer.get()
    }

    pub(crate) fn mark_message_start(&mut self) {
        let head = self.read_buffer().head;
        self.connection.last_message_start.set(head);
    }

    pub(crate) fn ensure_length(self, count: usize) -> bool {
        self.ensure_capacity(count)
    }

    pub(crate) fn peek(&self) -> &[u8] {
        self.read_buffer().remaining()
    }

    pub(crate) fn skip(&mut self, count: usize) {
        self.connection.read_buffer.with_mut(|buf| {
            buf.head = (buf.head + (count as u32)).min(buf.byte_list.len() as u32);
        });
    }

    pub(crate) fn ensure_capacity(self, count: usize) -> bool {
        let buf = self.read_buffer();
        (buf.head as usize) + count <= buf.byte_list.len()
    }

    pub(crate) fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        let remaining = self.read_buffer().remaining();
        if remaining.len() < count {
            return Err(AnyPostgresError::ShortRead);
        }

        // PORT NOTE: reshaped for borrowck — capture as `RawSlice` before calling
        // skip(); the read_buffer backing storage is not reallocated by skip().
        let slice = bun_ptr::RawSlice::new(&remaining[..count]);
        self.skip(count);
        Ok(Data::Temporary(slice))
    }

    pub(crate) fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        let remain = self.read_buffer().remaining();

        if let Some(zero) = strings::index_of_char(remain, 0) {
            // `RawSlice` backref into read_buffer (not reallocated by skip()).
            let slice = bun_ptr::RawSlice::new(&remain[..zero as usize]);
            self.skip(zero as usize + 1);
            return Ok(Data::Temporary(slice));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

impl protocol::ReaderContext for Reader {
    #[inline]
    fn mark_message_start(&mut self) {
        Reader::mark_message_start(self)
    }
    #[inline]
    fn peek(&self) -> &[u8] {
        Reader::peek(self)
    }
    #[inline]
    fn skip(&mut self, count: usize) {
        Reader::skip(self, count)
    }
    #[inline]
    fn ensure_length(&mut self, count: usize) -> bool {
        Reader::ensure_length(*self, count)
    }
    #[inline]
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        Reader::read(self, count)
    }
    #[inline]
    fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        Reader::read_z(self)
    }
}

impl PostgresSQLConnection {
    pub fn buffered_reader(&self) -> protocol::NewReader<Reader> {
        protocol::NewReader {
            wrapped: Reader {
                connection: BackRef::new(self),
            },
        }
    }

    fn finish_request(&self, item: &PostgresSQLQuery) {
        match item.status.get() {
            QueryStatus::Running | QueryStatus::Binding | QueryStatus::PartialResponse => {
                let flags = item.flags.get();
                if flags.simple {
                    self.nonpipelinable_requests
                        .set(self.nonpipelinable_requests.get() - 1);
                } else if flags.pipelined {
                    self.pipelined_requests
                        .set(self.pipelined_requests.get() - 1);
                }
            }
            QueryStatus::Success | QueryStatus::Fail | QueryStatus::Pending => {}
        }
    }

    pub fn can_prepare_query(&self) -> bool {
        let flags = self.flags.get();
        flags.contains(ConnectionFlags::IS_READY_FOR_QUERY)
            && !flags.contains(ConnectionFlags::WAITING_TO_PREPARE)
            && self.pipelined_requests.get() == 0
    }

    /// Process pending requests and flush. Called from the enqueue path when
    /// unnamed prepared statements with params skip writeQuery+Sync and need
    /// advance() to send everything atomically on an idle connection.
    pub fn advance_and_flush(&self) {
        let flags = self.flags.get();
        if !flags.contains(ConnectionFlags::HAS_BACKPRESSURE)
            && flags.contains(ConnectionFlags::IS_READY_FOR_QUERY)
        {
            self.advance();
            self.flush_data();
        }
    }

    fn advance(&self) {
        let mut offset: usize = 0;
        debug!("advance");
        // PORT NOTE: Zig `defer { while ... }` cleanup loop runs after the main loop returns;
        // expanded as a closure called at every return point below.
        macro_rules! defer_cleanup {
            ($self:ident) => {{
                while $self.requests.get().readable_length() > 0 {
                    let result_ptr = $self.requests.get().peek_item(0);
                    // Queue invariant: every stored pointer is non-null and
                    // live (refcount ≥ 1 held by the queue). R-2: `ParentRef`
                    // yields `&T` only — `PostgresSQLQuery` is Cell/JsCell-backed.
                    let result = ParentRef::from(NonNull::new(result_ptr).expect("queue item non-null"));
                    // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
                    // so we do the cleanup here
                    match result.status.get() {
                        QueryStatus::Success => {
                            $self.discard_request(result_ptr);
                            continue;
                        }
                        QueryStatus::Fail => {
                            $self.discard_request(result_ptr);
                            continue;
                        }
                        _ => break, // truly current item
                    }
                }
            }};
        }

        while self.requests.get().readable_length() > offset
            && !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
        {
            if self.vm().is_shutting_down() {
                self.close();
                defer_cleanup!(self);
                return;
            }

            let req_ptr: *mut PostgresSQLQuery = self.requests.get().peek_item(offset);
            // Queue invariant: every stored pointer is non-null and live
            // (refcount ≥ 1 held by the queue). R-2: `ParentRef` yields `&T`
            // only — `PostgresSQLQuery` is Cell/JsCell-backed.
            let req = ParentRef::from(NonNull::new(req_ptr).expect("queue item non-null"));
            match req.status.get() {
                QueryStatus::Pending => {
                    if req.flags.get().simple {
                        if self.pipelined_requests.get() > 0
                            || !self
                                .flags
                                .get()
                                .contains(ConnectionFlags::IS_READY_FOR_QUERY)
                        {
                            debug!(
                                "cannot execute simple query, pipelined_requests: {}, is_ready_for_query: {}",
                                self.pipelined_requests.get(),
                                self.flags
                                    .get()
                                    .contains(ConnectionFlags::IS_READY_FOR_QUERY)
                            );
                            // need to wait for the previous request to finish before starting simple queries
                            defer_cleanup!(self);
                            return;
                        }
                        let query_str = req.query.to_utf8();
                        debug!(
                            "execute simple query: {}",
                            bstr::BStr::new(query_str.slice())
                        );
                        if let Err(err) =
                            PostgresRequest::execute_query(query_str.slice(), self.writer())
                        {
                            if let Some(err_) = self.global().try_take_exception() {
                                req.on_js_error(err_, self.global());
                            } else {
                                req.on_write_fail(err, self.global(), self.get_queries_array());
                            }
                            if offset == 0 {
                                self.discard_request(req_ptr);
                            } else {
                                // deinit later
                                req.status.set(QueryStatus::Fail);
                            }
                            debug!("executeQuery failed: {}", err);
                            continue;
                        }
                        self.nonpipelinable_requests
                            .set(self.nonpipelinable_requests.get() + 1);
                        self.update_flags(|f| f.remove(ConnectionFlags::IS_READY_FOR_QUERY));
                        req.status.set(QueryStatus::Running);
                        defer_cleanup!(self);
                        return;
                    } else {
                        if let Some(statement) = req.statement_mut() {
                            match statement.status {
                                StatementStatus::Failed => {
                                    debug!("stmt failed");
                                    debug_assert!(statement.error_response.is_some());
                                    // PORT NOTE: `postgres_sql_statement::Error` is not Clone (owns
                                    // protocol::ErrorResponse). Convert to JSValue and forward via
                                    // on_js_error instead of moving the cached error out.
                                    if let Some(ref e) = statement.error_response {
                                        let ev = match e.to_js(self.global()) {
                                            Ok(v) => v,
                                            Err(err) => self.global().take_error(err),
                                        };
                                        req.on_js_error(ev, self.global());
                                    }
                                    if offset == 0 {
                                        self.discard_request(req_ptr);
                                    } else {
                                        // deinit later
                                        req.status.set(QueryStatus::Fail);
                                        offset += 1;
                                    }
                                    continue;
                                }
                                StatementStatus::Prepared => {
                                    let Some(this_value) = req.this_value.get().try_get() else {
                                        debug_assert!(
                                            false,
                                            "query value was freed earlier than expected"
                                        );
                                        if offset == 0 {
                                            self.discard_request(req_ptr);
                                        } else {
                                            // deinit later
                                            req.status.set(QueryStatus::Fail);
                                            offset += 1;
                                        }
                                        continue;
                                    };
                                    let binding_value =
                                        postgres_sql_query::js::binding_get_cached(this_value)
                                            .unwrap_or(JSValue::ZERO);
                                    let columns_value =
                                        postgres_sql_query::js::columns_get_cached(this_value)
                                            .unwrap_or(JSValue::ZERO);
                                    req.update_flags(|f| f.binary = !statement.fields.is_empty());

                                    if self
                                        .flags
                                        .get()
                                        .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
                                    {
                                        debug!("parse, bind and execute unnamed stmt");
                                        let query_str = req.query.to_utf8();
                                        let global = self.global_object;
                                        if let Err(err) =
                                            PostgresRequest::parse_and_bind_and_execute(
                                                &global,
                                                query_str.slice(),
                                                statement,
                                                binding_value,
                                                columns_value,
                                                false,
                                                self.writer(),
                                            )
                                        {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                req.on_write_fail(
                                                    err,
                                                    self.global(),
                                                    self.get_queries_array(),
                                                );
                                            }
                                            if offset == 0 {
                                                self.discard_request(req_ptr);
                                            } else {
                                                // deinit later
                                                req.status.set(QueryStatus::Fail);
                                                offset += 1;
                                            }
                                            debug!(
                                                "parse, bind and execute failed: {}",
                                                <&'static str>::from(err)
                                            );
                                            continue;
                                        }
                                    } else {
                                        debug!("binding and executing stmt");
                                        let global = self.global_object;
                                        if let Err(err) = PostgresRequest::bind_and_execute(
                                            &global,
                                            statement,
                                            binding_value,
                                            columns_value,
                                            self.writer(),
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                req.on_write_fail(
                                                    err,
                                                    self.global(),
                                                    self.get_queries_array(),
                                                );
                                            }
                                            if offset == 0 {
                                                self.discard_request(req_ptr);
                                            } else {
                                                // deinit later
                                                req.status.set(QueryStatus::Fail);
                                                offset += 1;
                                            }
                                            debug!("bind and execute failed: {}", err);
                                            continue;
                                        }
                                    }

                                    self.update_flags(|f| {
                                        f.remove(ConnectionFlags::IS_READY_FOR_QUERY)
                                    });
                                    req.status.set(QueryStatus::Binding);
                                    req.update_flags(|f| f.pipelined = true);
                                    self.pipelined_requests
                                        .set(self.pipelined_requests.get() + 1);

                                    if self
                                        .flags
                                        .get()
                                        .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
                                        || !self.can_pipeline()
                                    {
                                        debug!("cannot pipeline more stmt");
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    offset += 1;
                                    continue;
                                }
                                StatementStatus::Pending => {
                                    if !self.can_prepare_query() {
                                        debug!(
                                            "need to wait to finish the pipeline before starting a new query preparation"
                                        );
                                        // need to wait to finish the pipeline before starting a new query preparation
                                        defer_cleanup!(self);
                                        return;
                                    }
                                    // statement is pending, lets write/parse it
                                    let query_str = req.query.to_utf8();
                                    let has_params = !statement.signature.fields.is_empty();
                                    // If it does not have params, we can write and execute immediately in one go
                                    if !has_params {
                                        let Some(this_value) = req.this_value.get().try_get()
                                        else {
                                            debug_assert!(
                                                false,
                                                "query value was freed earlier than expected"
                                            );
                                            if offset == 0 {
                                                self.discard_request(req_ptr);
                                            } else {
                                                // deinit later
                                                req.status.set(QueryStatus::Fail);
                                                offset += 1;
                                            }
                                            continue;
                                        };
                                        // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                                        let binding_value =
                                            postgres_sql_query::js::binding_get_cached(this_value)
                                                .unwrap_or(JSValue::ZERO);
                                        debug!("prepareAndQueryWithSignature");
                                        let global = self.global_object;
                                        if let Err(err) =
                                            PostgresRequest::prepare_and_query_with_signature(
                                                &global,
                                                query_str.slice(),
                                                binding_value,
                                                self.writer(),
                                                &mut statement.signature,
                                            )
                                        {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                statement.status = StatementStatus::Failed;
                                                statement.error_response =
                                                    Some(StatementError::PostgresError(err));
                                                req.on_write_fail(
                                                    err,
                                                    self.global(),
                                                    self.get_queries_array(),
                                                );
                                            }
                                            if offset == 0 {
                                                self.discard_request(req_ptr);
                                            } else {
                                                // deinit later
                                                req.status.set(QueryStatus::Fail);
                                            }
                                            debug!(
                                                "prepareAndQueryWithSignature failed: {}",
                                                <&'static str>::from(err)
                                            );
                                            continue;
                                        }
                                        self.update_flags(|f| {
                                            f.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                            f.insert(ConnectionFlags::WAITING_TO_PREPARE);
                                        });
                                        req.status.set(QueryStatus::Binding);
                                        statement.status = StatementStatus::Parsing;
                                        self.flush_data_and_reset_timeout();
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    if self
                                        .flags
                                        .get()
                                        .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
                                    {
                                        let Some(this_value) = req.this_value.get().try_get()
                                        else {
                                            debug_assert!(
                                                false,
                                                "query value was freed earlier than expected"
                                            );
                                            debug_assert!(offset == 0);
                                            self.discard_request(req_ptr);
                                            continue;
                                        };
                                        let binding_value =
                                            postgres_sql_query::js::binding_get_cached(this_value)
                                                .unwrap_or(JSValue::ZERO);
                                        let columns_value =
                                            postgres_sql_query::js::columns_get_cached(this_value)
                                                .unwrap_or(JSValue::ZERO);
                                        debug!("parseAndBindAndExecute (unnamed, first execution)");
                                        let global = self.global_object;
                                        if let Err(err) =
                                            PostgresRequest::parse_and_bind_and_execute(
                                                &global,
                                                query_str.slice(),
                                                statement,
                                                binding_value,
                                                columns_value,
                                                true,
                                                self.writer(),
                                            )
                                        {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                statement.status = StatementStatus::Failed;
                                                statement.error_response =
                                                    Some(StatementError::PostgresError(err));
                                                req.on_write_fail(
                                                    err,
                                                    self.global(),
                                                    self.get_queries_array(),
                                                );
                                            }
                                            debug_assert!(offset == 0);
                                            self.discard_request(req_ptr);
                                            debug!(
                                                "parseAndBindAndExecute failed: {}",
                                                <&'static str>::from(err)
                                            );
                                            continue;
                                        }
                                        self.update_flags(|f| {
                                            f.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                            f.insert(ConnectionFlags::WAITING_TO_PREPARE);
                                        });
                                        req.status.set(QueryStatus::Binding);
                                        statement.status = StatementStatus::Parsing;
                                        req.update_flags(|f| f.pipelined = true);
                                        self.pipelined_requests
                                            .set(self.pipelined_requests.get() + 1);
                                        self.flush_data_and_reset_timeout();
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    // Named prepared statements: send Parse+Describe first, wait for
                                    // ParameterDescription, then send Bind+Execute in a second phase.
                                    // This is safe because named statements persist on the connection.
                                    let connection_writer = self.writer();
                                    debug!("writing query");
                                    // write query and wait for it to be prepared
                                    if let Err(err) = PostgresRequest::write_query(
                                        query_str.slice(),
                                        &statement.signature.prepared_statement_name,
                                        &statement.signature.fields,
                                        connection_writer,
                                    ) {
                                        if let Some(err_) = self.global().try_take_exception() {
                                            req.on_js_error(err_, self.global());
                                        } else {
                                            statement.error_response =
                                                Some(StatementError::PostgresError(err));
                                            statement.status = StatementStatus::Failed;
                                            req.on_write_fail(
                                                err,
                                                self.global(),
                                                self.get_queries_array(),
                                            );
                                        }
                                        debug_assert!(offset == 0);
                                        self.discard_request(req_ptr);
                                        debug!("write query failed: {}", <&'static str>::from(err));
                                        continue;
                                    }
                                    if let Err(err) = connection_writer.write(&protocol::SYNC) {
                                        if let Some(err_) = self.global().try_take_exception() {
                                            req.on_js_error(err_, self.global());
                                        } else {
                                            statement.error_response =
                                                Some(StatementError::PostgresError(err));
                                            statement.status = StatementStatus::Failed;
                                            req.on_write_fail(
                                                err,
                                                self.global(),
                                                self.get_queries_array(),
                                            );
                                        }
                                        debug_assert!(offset == 0);
                                        self.discard_request(req_ptr);
                                        debug!(
                                            "write query (sync) failed: {}",
                                            <&'static str>::from(err)
                                        );
                                        continue;
                                    }
                                    self.update_flags(|f| {
                                        f.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                        f.insert(ConnectionFlags::WAITING_TO_PREPARE);
                                    });
                                    statement.status = StatementStatus::Parsing;
                                    self.flush_data_and_reset_timeout();
                                    defer_cleanup!(self);
                                    return;
                                }
                                StatementStatus::Parsing => {
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

                QueryStatus::Running | QueryStatus::Binding | QueryStatus::PartialResponse => {
                    if self
                        .flags
                        .get()
                        .contains(ConnectionFlags::WAITING_TO_PREPARE)
                        || self.nonpipelinable_requests.get() > 0
                    {
                        defer_cleanup!(self);
                        return;
                    }
                    let total_requests_running = self.pipelined_requests.get() as usize;
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }
                QueryStatus::Success => {
                    if offset > 0 {
                        // deinit later
                        req.status.set(QueryStatus::Fail);
                        offset += 1;
                        continue;
                    }
                    self.discard_request(req_ptr);
                    continue;
                }
                QueryStatus::Fail => {
                    if offset > 0 {
                        // deinit later
                        offset += 1;
                        continue;
                    }
                    self.discard_request(req_ptr);
                    continue;
                }
            }
        }
        defer_cleanup!(self);
    }

    pub fn get_queries_array(&self) -> JSValue {
        let Some(js_value) = self.js_value.get().try_get() else {
            return JSValue::UNDEFINED;
        };
        js::queries_get_cached(js_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn on<Context: protocol::ReaderContext>(
        &self,
        message_type: MessageType,
        mut reader: protocol::NewReader<Context>,
    ) -> Result<(), AnyPostgresError> {
        // PORT NOTE: protocol `decode_internal` returns `bun_core::Error`;
        // round-trip through the name-based `From` impl.
        #[inline(always)]
        fn pg_err(e: bun_core::Error) -> AnyPostgresError {
            AnyPostgresError::from(e)
        }
        debug!("on({})", <&'static str>::from(message_type));

        match message_type {
            MessageType::DataRow => {
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;

                let statement = request
                    .statement_mut()
                    .ok_or(AnyPostgresError::ExpectedStatement)?;
                let mut structure: JSValue = JSValue::UNDEFINED;
                let mut cached_structure: Option<ParentRef<PostgresCachedStructure>> = None;
                let request_flags = request.flags.get();
                // explicit use switch without else so if new modes are added, we don't forget to check for duplicate fields
                match request_flags.result_mode {
                    SQLQueryResultMode::Objects => {
                        let owner = self.js_value.get().try_get().unwrap_or(JSValue::ZERO);
                        let cs = statement.structure(owner, self.global());
                        structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                        cached_structure = Some(ParentRef::new(cs));
                    }
                    SQLQueryResultMode::Raw | SQLQueryResultMode::Values => {
                        // no need to check for duplicate fields or structure
                    }
                }

                let mut putter = DataCell::Putter {
                    list: &mut [],
                    fields: &statement.fields,
                    binary: request_flags.binary,
                    bigint: request_flags.bigint,
                    global_object: self.global(),
                    count: 0,
                    // TODO(port): other Putter default fields
                };

                let mut stack_buf = [DataCell::SQLDataCell::default(); 70];
                // PERF(port): was stack-fallback alloc — profile if it shows up on a hot path.
                let max_inline = jsc::JSObject::max_inline_capacity() as usize;
                let mut heap_cells: Vec<DataCell::SQLDataCell>;
                let mut free_cells = false;
                let cells: &mut [DataCell::SQLDataCell] = if statement.fields.len() >= max_inline {
                    heap_cells = (0..statement.fields.len())
                        .map(|_| DataCell::SQLDataCell::default())
                        .collect();
                    free_cells = true;
                    &mut heap_cells
                } else {
                    &mut stack_buf[..statement.fields.len().min(max_inline)]
                };
                // make sure all cells are reset if reader short breaks the fields will just be null which is better than undefined behavior
                for c in cells.iter_mut() {
                    *c = DataCell::SQLDataCell::default();
                }
                putter.list = cells;

                // `DataRow::decode`'s callback is `FnMut`, so capture `&mut putter`
                // directly instead of laundering it through a raw `*mut` context —
                // the by-value `C: Copy` slot is unused (`()`).
                let decode_result = if request_flags.result_mode == SQLQueryResultMode::Raw {
                    protocol::DataRow::decode((), &mut reader, |(), i, b| putter.put_raw(i, b))
                } else {
                    protocol::DataRow::decode((), &mut reader, |(), i, b| putter.put(i, b))
                };
                let cells_ptr: *mut DataCell::SQLDataCell = putter.list.as_mut_ptr();
                let count = putter.count;
                scopeguard::defer! {
                    // SAFETY: cells_ptr points into stack_buf/heap_cells, both declared
                    // earlier in this block and outliving this guard; `count` is the
                    // post-decode element count and never exceeds the slice length.
                    unsafe {
                        for i in 0..count {
                            (*cells_ptr.add(i)).deinit();
                        }
                    }
                    // `if free_cells free(cells)`: heap_cells Vec drops at scope end.
                };
                decode_result?;

                let Some(this_value) = request.this_value.get().try_get() else {
                    debug_assert!(false, "query value was freed earlier than expected");
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                let pending_value = postgres_sql_query::js::pending_value_get_cached(this_value)
                    .unwrap_or(JSValue::ZERO);
                pending_value.ensure_still_alive();
                let result = putter.to_js(
                    self.global(),
                    pending_value,
                    structure,
                    statement.fields_flags,
                    request_flags.result_mode,
                    // `ParentRef::Deref` recovers `&CachedStructure`; statement
                    // outlives this call (held via `request.statement` ref).
                    cached_structure.as_deref(),
                )?;

                if pending_value.is_empty() {
                    postgres_sql_query::js::pending_value_set_cached(
                        this_value,
                        self.global(),
                        result,
                    );
                }

                let _ = free_cells; // heap_cells dropped at scope end; defer! above runs cell.deinit()
            }
            MessageType::CopyData => {
                let copy_data =
                    protocol::CopyData::decode_internal(reader.reborrow()).map_err(pg_err)?;
                drop(copy_data);
            }
            MessageType::ParameterStatus => {
                let parameter_status =
                    protocol::ParameterStatus::decode_internal(reader.reborrow())
                        .map_err(pg_err)?;
                self.backend_parameters
                    .with_mut(|m| {
                        m.insert(
                            parameter_status.name.slice(),
                            parameter_status.value.slice(),
                        )
                    })
                    .map_err(|_| AnyPostgresError::OutOfMemory)?;
                // parameter_status dropped at scope end
            }
            MessageType::ReadyForQuery => {
                let _ready_for_query =
                    protocol::ReadyForQuery::decode_internal(reader.reborrow()).map_err(pg_err)?;

                self.set_status(Status::Connected);
                self.update_flags(|f| {
                    f.remove(ConnectionFlags::WAITING_TO_PREPARE);
                    f.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                });
                self.socket.get().set_timeout(300);

                if let Some(request) = self.current() {
                    if request.status.get() == QueryStatus::PartialResponse {
                        self.finish_request(&request);
                        // if is a partial response, just signal that the query is now complete
                        request.on_result(
                            b"",
                            self.global(),
                            self.js_value.get().try_get().unwrap_or(JSValue::ZERO),
                            true,
                        );
                    }
                }
                self.advance();

                self.register_auto_flusher();
                self.update_ref();
            }
            MessageType::CommandComplete => {
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;

                let mut cmd: protocol::CommandComplete = Default::default();
                cmd.decode_internal(reader.reborrow()).map_err(pg_err)?;
                debug!("-> {}", bstr::BStr::new(cmd.command_tag.slice()));

                request.on_result(
                    cmd.command_tag.slice(),
                    self.global(),
                    self.js_value.get().try_get().unwrap_or(JSValue::ZERO),
                    false,
                );
                self.update_ref();
                // cmd dropped at scope end
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
                    protocol::ParameterDescription::decode_internal(reader.reborrow())
                        .map_err(pg_err)?;
                // errdefer bun.default_allocator.free(description.parameters);
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
                if !statement.parameters.is_empty() {
                    // PORT NOTE: Box<[T]> drop frees old slice.
                }
                statement.parameters = description.parameters;
                if statement.status == StatementStatus::Parsing {
                    statement.status = StatementStatus::Prepared;
                    self.update_flags(|f| f.remove(ConnectionFlags::WAITING_TO_PREPARE));
                }
            }
            MessageType::RowDescription => {
                let description =
                    protocol::RowDescription::decode_internal(reader.reborrow()).map_err(pg_err)?;
                // errdefer description.deinit();
                let request = match self.current() {
                    Some(r) => r,
                    None => return Err(AnyPostgresError::ExpectedRequest),
                };
                let statement = match request.statement_mut() {
                    Some(s) => s,
                    None => return Err(AnyPostgresError::ExpectedStatement),
                };
                statement.fields = description.fields.into_vec();
                statement.cached_structure = Default::default();
                statement.needs_duplicate_check = true;
                statement.fields_flags = Default::default();
            }
            MessageType::Authentication => {
                let auth =
                    protocol::Authentication::decode_internal(&mut reader).map_err(pg_err)?;

                match &auth {
                    protocol::Authentication::SASL => {
                        if !matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Sasl(_)
                        ) {
                            self.authentication_state
                                .set(AuthenticationState::Sasl(Default::default()));
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
                            let _ = write!(cursor, "n,,n=*,r={}", bstr::BStr::new(sasl.nonce()));
                            let written = 128 - cursor.len();
                            mechanism_buf[written] = 0;
                            &mechanism_buf[..written]
                        };
                        let response = protocol::SASLInitialResponse {
                            mechanism: Data::Temporary(bun_ptr::RawSlice::new(b"SCRAM-SHA-256")),
                            data: Data::Temporary(bun_ptr::RawSlice::new(mechanism)),
                        };

                        response.write_internal(self.writer()).map_err(pg_err)?;
                        debug!("SASL");
                        self.flush_data();
                    }
                    protocol::Authentication::SASLContinue(cont) => {
                        let password: &[u8] = self.password();
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

                        let iteration_count = cont.iteration_count().map_err(pg_err)?;
                        // RFC 7677 §4: SCRAM-SHA-256 requires a minimum of 4096
                        // iterations. Cap the upper bound to avoid a CPU-burn DoS
                        // from a malicious/MITM'd server sending i ≈ u32::MAX.
                        if !(4096..=10_000_000).contains(&iteration_count) {
                            debug!(
                                "SASLContinue iteration count out of range: {}",
                                iteration_count
                            );
                            return Err(AnyPostgresError::InvalidMessage);
                        }

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
                        )?;
                        drop(server_salt_decoded_base64);

                        let mut auth_string: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut auth_string,
                                "n=*,r={},r={},s={},i={},c=biws,r={}",
                                bstr::BStr::new(sasl.nonce()),
                                bstr::BStr::new(cont.r.slice()),
                                bstr::BStr::new(cont.s.slice()),
                                bstr::BStr::new(cont.i.slice()),
                                bstr::BStr::new(cont.r.slice()),
                            );
                        }
                        sasl.compute_server_signature(&auth_string)?;

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

                        // base64 of 32 bytes → ceil(32/3)*4 = 44; +4 slack matches Zig encodeLenFromSize.
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
                                "c=biws,r={},p={}",
                                bstr::BStr::new(cont.r.slice()),
                                bstr::BStr::new(&client_key_xor_base64_buf[..xor_base64_len]),
                            );
                        }

                        let response = protocol::SASLResponse {
                            data: Data::Temporary(bun_ptr::RawSlice::new(payload.as_slice())),
                        };

                        sasl.status = SASLStatus::Continue;
                        response
                            .write_internal(&mut self.writer())
                            .map_err(pg_err)?;
                        self.flush_data();
                    }
                    protocol::Authentication::SASLFinal { data: final_data } => {
                        // `sasl` borrow ends before `self.fail()` /
                        // `self.authentication_state.with_mut()` below.
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
                            self.authentication_state.with_mut(|s| s.zero());
                        }
                    }
                    protocol::Authentication::Ok => {
                        if matches!(
                            self.authentication_state.get(),
                            AuthenticationState::Sasl(_)
                        ) {
                            debug!("AuthenticationOk before SASL exchange completed");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        debug!("Authentication OK");
                        self.authentication_state.with_mut(|s| s.zero());
                        self.authentication_state.set(AuthenticationState::Ok);
                    }

                    protocol::Authentication::Unknown => {
                        self.fail(
                            b"Unknown authentication method",
                            AnyPostgresError::UNKNOWN_AUTHENTICATION_METHOD,
                        );
                    }

                    protocol::Authentication::ClearTextPassword => {
                        debug!("ClearTextPassword");
                        let response = protocol::PasswordMessage {
                            // password is a valid slice into options_buf.
                            password: Data::Temporary(self.password),
                        };

                        response
                            .write_internal(&mut self.writer())
                            .map_err(pg_err)?;
                        self.flush_data();
                    }

                    protocol::Authentication::MD5Password { salt } => {
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
                        response
                            .write_internal(&mut self.writer())
                            .map_err(pg_err)?;
                        self.flush_data();
                    }

                    _other => {
                        debug!("TODO auth: unsupported");
                        self.fail(
                            b"TODO: support authentication method: {s}",
                            AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD,
                        );
                    }
                }
                // auth dropped at scope end (defer auth.deinit())
            }
            MessageType::NoData => {
                reader.eat_message(&protocol::NO_DATA)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                if request.status.get() == QueryStatus::Binding {
                    request.status.set(QueryStatus::Running);
                }
            }
            MessageType::BackendKeyData => {
                self.backend_key_data.set(
                    protocol::BackendKeyData::decode_internal(reader.reborrow()).map_err(pg_err)?,
                );
            }
            MessageType::ErrorResponse => {
                let err =
                    protocol::ErrorResponse::decode_internal(reader.reborrow()).map_err(pg_err)?;

                if matches!(
                    self.status.get(),
                    Status::Connecting | Status::SentStartupMessage
                ) {
                    let v =
                        crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                    drop(err);
                    self.fail_with_js_value(v);

                    // it shouldn't enqueue any requests while connecting
                    debug_assert!(self.requests.get().readable_length() == 0);
                    return Ok(());
                }

                let Some(request) = self.current() else {
                    debug!("ErrorResponse: {}", err);
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                // Convert to JS while we still own `err` — Zig's `request.onError` only ever
                // calls `err.toJS`, so materialize the JS value once and route through
                // `on_js_error` to avoid double-ownership of the non-Clone ErrorResponse.
                let js_err =
                    crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                if let Some(stmt) = request.statement_mut() {
                    if stmt.status == StatementStatus::Parsing {
                        stmt.status = StatementStatus::Failed;
                        stmt.error_response = Some(
                            crate::postgres::postgres_sql_statement::Error::Protocol(err),
                        );
                        if self
                            .statements
                            .with_mut(|m| m.remove(&bun_wyhash::hash(&stmt.signature.name)))
                            .is_some()
                        {
                            // SAFETY: `stmt` is a live `Box`-allocated statement; the
                            // request still holds its own ref so this cannot drop to 0.
                            unsafe { PostgresSQLStatement::deref(core::ptr::from_mut(stmt)) };
                        }
                    }
                }
                // If `err` was not moved into stmt above, it drops here automatically.

                self.finish_request(&request);
                self.update_ref();
                request.on_js_error(js_err, self.global());
            }
            MessageType::PortalSuspended => {
                // try reader.eatMessage(&protocol.PortalSuspended);
                // var request = this.current() orelse return error.ExpectedRequest;
                // _ = request;
                debug!("TODO PortalSuspended");
            }
            MessageType::CloseComplete => {
                reader.eat_message(&protocol::CLOSE_COMPLETE)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                request.on_result(
                    b"CLOSECOMPLETE",
                    self.global(),
                    self.js_value.get().get(),
                    false,
                );
                self.update_ref();
            }
            MessageType::CopyInResponse => {
                debug!("TODO CopyInResponse");
            }
            MessageType::NoticeResponse => {
                debug!("UNSUPPORTED NoticeResponse");
                let _resp = protocol::NoticeResponse::decode_internal(reader.reborrow())?;
                // _resp dropped at scope end
            }
            MessageType::EmptyQueryResponse => {
                reader.eat_message(&protocol::EMPTY_QUERY_RESPONSE)?;
                let request = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                request.on_result(b"", self.global(), self.js_value.get().get(), false);
                self.update_ref();
            }
            MessageType::CopyOutResponse => {
                debug!("TODO CopyOutResponse");
            }
            MessageType::CopyDone => {
                debug!("TODO CopyDone");
            }
            MessageType::CopyBothResponse => {
                debug!("TODO CopyBothResponse");
            } // else => @compileError("Unknown message type")
              // PORT NOTE: const-generic enum match is exhaustive in Rust; no compile error needed.
        }
        Ok(())
    }

    pub fn update_ref(&self) {
        self.update_has_pending_activity();
        // TODO(port): Zig reads `pending_activity_count.raw` (non-atomic). Using Relaxed load.
        if self.pending_activity_count.load(Ordering::Relaxed) > 0 {
            self.poll_ref.with_mut(|r| {
                r.r#ref(bun_io::posix_event_loop::get_vm_ctx(
                    bun_io::AllocatorType::Js,
                ))
            });
        } else {
            self.poll_ref.with_mut(|r| {
                r.unref(bun_io::posix_event_loop::get_vm_ctx(
                    bun_io::AllocatorType::Js,
                ))
            });
        }
    }

    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.status.get() == Status::Connected)
    }

    pub fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        debug!("consumeOnConnectCallback");
        let js_value = self.js_value.get().get();
        let on_connect = js::onconnect_get_cached(js_value)?;
        debug!("consumeOnConnectCallback exists");

        js::onconnect_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_connect)
    }

    pub fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        debug!("consumeOnCloseCallback");
        let js_value = self.js_value.get().get();
        let on_close = js::onclose_get_cached(js_value)?;
        debug!("consumeOnCloseCallback exists");
        js::onclose_set_cached(js_value, global_object, JSValue::ZERO);
        Some(on_close)
    }
}

// ported from: src/sql_jsc/postgres/PostgresSQLConnection.zig
