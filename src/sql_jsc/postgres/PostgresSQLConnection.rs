use bun_collections::{VecExt, ByteVecExt};
use core::cell::{Cell, UnsafeCell};
use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::{self, Output};
use bun_string::{self as bstr_mod, strings, String as BunString};
use crate::jsc::{
    self as jsc, CallFrame, EventLoopSqlExt as _, HasAutoFlush, JSGlobalObject,
    JSGlobalObjectSqlExt as _, JSValue, JsResult, VirtualMachine, VirtualMachineSqlExt as _,
};
use bun_uws as uws;
use bun_aio::KeepAlive;
use bun_boringssl as BoringSSL;
use bun_collections::{HashMap, StringMap, OffsetByteList};
use crate::jsc::EventLoopTimer;
use crate::jsc::webcore::AutoFlusher;

use crate::postgres::data_cell as DataCell;
use crate::shared::sql_data_cell::{Tag as DataCellTag, Value as DataCellValue};
use crate::shared::CachedStructure as PostgresCachedStructure;
use crate::postgres::postgres_request as PostgresRequest;
use crate::postgres::postgres_request::MessageType;
use crate::postgres::PostgresSQLQuery;
use crate::postgres::postgres_sql_query::{self, Status as QueryStatus, js as query_js};
use crate::postgres::PostgresSQLStatement;
use crate::postgres::postgres_sql_statement::{Status as StatementStatus, Error as StatementError};
use crate::postgres::sasl::SASLStatus;
use bun_sql::shared::SQLQueryResultMode;
use crate::jsc::{EventLoopTimerState, EventLoopTimerTag};
use bun_sql::postgres::SocketMonitor;
use bun_sql::postgres::PostgresProtocol as protocol;
use crate::postgres::AuthenticationState;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::Data;
use bun_sql::postgres::SSLMode;
use bun_sql::postgres::Status;
use bun_sql::postgres::TLSStatus;
use bun_sql::postgres::AnyPostgresError;
use crate::postgres::error_jsc::{create_postgres_error, postgres_error_to_js};
use bun_sql::postgres::PostgresErrorOptions;

// Aliases for PostgresRequest's `on_data` dispatch (Zig used PascalCase nested types).
pub use bun_sql::postgres::SSLMode as SslMode;
pub use bun_sql::postgres::TLSStatus as TlsStatus;

type Socket = uws::AnySocket;

bun_core::declare_scope!(Postgres, visible);
macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(Postgres, $($arg)*) };
}

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

// TODO(b2-blocked): #[crate::jsc::JsClass] proc-macro attr
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct PostgresSQLConnection {
    // TODO(port): bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive refcount;
    // ref()/deref() forward to this. When it hits 0, `deinit` runs and frees the Box.
    pub socket: Socket,
    pub status: Status,
    // Private — intrusive refcount invariant; reach via `ref_()`/`deref()`
    // (provided by `#[derive(CellRefCounted)]` above).
    ref_count: Cell<u32>,

    pub write_buffer: OffsetByteList,
    // `read_buffer` / `last_message_start` are wrapped in interior-mutability cells
    // because `Reader` (see below) accesses them through a `*mut Self` *while* a
    // sibling `&mut PostgresSQLConnection` is live in `PostgresRequest::on_data` /
    // `on()`. Under Stacked Borrows that `&mut` retag inserts SharedRW (not Unique)
    // for `UnsafeCell` bytes, so the Reader's raw-derived access stays valid.
    // `write_buffer` does NOT need this: every `self.writer()` call site consumes
    // the Writer before `self` is reborrowed again.
    // Private — `UnsafeCell` aliasing invariant; only `Reader` and `on_data`
    // touch these (both in this module).
    read_buffer: UnsafeCell<OffsetByteList>,
    last_message_start: Cell<u32>,
    pub requests: PostgresRequest::Queue,
    /// number of pipelined requests (Bind/Execute/Prepared statements)
    pub pipelined_requests: u32,
    /// number of non-pipelined requests (Simple/Copy)
    pub nonpipelinable_requests: u32,

    pub poll_ref: KeepAlive,
    // `*const`, not `*mut`: derived from a `&JSGlobalObject` in `call()`, so provenance is
    // read-only. Only ever dereferenced as `&*` via `global()`; never written through.
    pub global_object: *const JSGlobalObject,
    pub vm: *mut VirtualMachine,
    pub statements: PreparedStatementsMap,
    pub prepared_statement_id: u64,
    pub pending_activity_count: AtomicU32,
    // Self-wrapper back-ref (the JS object that owns this payload). Stored as a
    // weak `JsRef`, never a bare `JSValue` — this struct is heap-allocated and
    // the conservative GC scan covers stack/registers only.
    pub js_value: crate::jsc::JsRef,

    pub backend_parameters: StringMap,
    pub backend_key_data: protocol::BackendKeyData,

    // TODO(port): self-referential — `database`/`user`/`password`/`path`/`options` are
    // slices into `options_buf` (built via StringBuilder in `call`). Struct is Box-allocated
    // and never moves (intrusive refcount), so raw fat pointers are sound. Phase B: consider
    // (offset,len) pairs or a dedicated borrowed-slice newtype.
    // Private — self-referential invariant; reassigning `options_buf` is UAF.
    // Reach via `database()`/`user()`/`password()`/`path()`/`options()`.
    database: *const [u8],
    user: *const [u8],
    password: *const [u8],
    path: *const [u8],
    options: *const [u8],
    options_buf: Box<[u8]>,

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
    // Private — intrusive heap node; cross-crate `container_of` goes through
    // [`Self::from_timer_ptr`] instead of `offset_of!` on the field.
    timer: EventLoopTimer,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    // Private — see `timer`; recovered via [`Self::from_max_lifetime_timer_ptr`].
    max_lifetime_timer: EventLoopTimer,
    pub auto_flusher: AutoFlusher,
}

impl PostgresSQLConnection {
    /// Intrusive backref: recover the embedding connection from a
    /// pointer to its intrusive `timer` node. Exposed so the cross-crate
    /// `bun_runtime` timer dispatch (`__bun_fire_timer`) does not need
    /// field-level visibility into this struct.
    ///
    /// # Safety
    /// `t` must point at the `timer` field of a live `PostgresSQLConnection`
    /// (i.e. the timer's tag is `PostgresSQLConnectionTimeout`).
    #[inline]
    pub unsafe fn from_timer_ptr(t: *mut EventLoopTimer) -> *mut Self {
        // SAFETY: caller contract.
        unsafe { bun_core::from_field_ptr!(Self, timer, t) }
    }

    /// Intrusive backref: see [`Self::from_timer_ptr`].
    ///
    /// # Safety
    /// `t` must point at the `max_lifetime_timer` field of a live
    /// `PostgresSQLConnection` (tag `PostgresSQLConnectionMaxLifetime`).
    #[inline]
    pub unsafe fn from_max_lifetime_timer_ptr(t: *mut EventLoopTimer) -> *mut Self {
        // SAFETY: caller contract.
        unsafe {
            bun_core::from_field_ptr!(Self, max_lifetime_timer, t)
        }
    }
}

impl PostgresSQLConnection {
    #[inline]
    fn global(&self) -> &JSGlobalObject {
        // SAFETY: JSC_BORROW — global_object outlives this connection (owned by VM).
        unsafe { &*self.global_object }
    }
    /// SAFETY: returns `&mut VirtualMachine` derived from `&self`; two calls
    /// alias the same VM. Caller must not hold another live `&mut` to it.
    /// (JSC_BORROW — vm outlives this connection.)
    ///
    /// PORT NOTE: the returned lifetime is **unbounded** (not tied to `&self`).
    /// `self.vm` is a raw pointer to the singleton VM, so the borrow does not
    /// actually overlap any of `self`'s own bytes; tying it to `&self` made
    /// `vm.timer().remove(&mut self.timer)` / holding `event_loop` across
    /// `&mut self` calls impossible under borrowck.
    #[inline]
    unsafe fn vm<'a>(&self) -> &'a mut VirtualMachine {
        unsafe { &mut *self.vm }
    }

    /// `KeepAlive::{ref_,unref}` take an `EventLoopCtx` (manual vtable, lives in
    /// `bun_aio`). The sql_jsc-side `VirtualMachine` is a thin façade with no
    /// direct conversion; route through the global hook (`get_vm_ctx(.Js)`) which
    /// resolves to the same singleton VM stored in `self.vm`.
    #[inline]
    fn vm_ctx(&self) -> bun_aio::EventLoopCtx {
        bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
    }

    // ---- self-referential connection-string slices ----------------------------
    // `database`/`user`/`password`/`path`/`options` are raw `*const [u8]` fat
    // pointers into `self.options_buf`. They are populated once in `call()` (each
    // initialised to `b""` then re-pointed at the StringBuilder allocation that
    // becomes `options_buf`) and never reassigned. The struct is Box-allocated
    // via `heap::alloc` and freed only when the intrusive refcount hits zero,
    // so `options_buf` — and thus every slice — remains valid for any `&self`.
    //
    // NOTE: the returned borrow is tied to `&self`. Call sites that must hold a
    // slice across a `&mut self` reborrow (e.g. the SASLContinue password hoist)
    // still go through the raw field directly; see PORT NOTEs at those sites.

    #[inline]
    pub fn database(&self) -> &[u8] {
        // SAFETY: points into `self.options_buf`; set once at construction, never
        // null, never reassigned. Valid for the lifetime of `&self`.
        unsafe { &*self.database }
    }

    #[inline]
    pub fn user(&self) -> &[u8] {
        // SAFETY: see `database()` — slice into `self.options_buf`.
        unsafe { &*self.user }
    }

    #[inline]
    pub fn password(&self) -> &[u8] {
        // SAFETY: see `database()` — slice into `self.options_buf`.
        unsafe { &*self.password }
    }

    #[inline]
    pub fn path(&self) -> &[u8] {
        // SAFETY: see `database()` — slice into `self.options_buf`.
        unsafe { &*self.path }
    }

    #[inline]
    pub fn options(&self) -> &[u8] {
        // SAFETY: see `database()` — slice into `self.options_buf`.
        unsafe { &*self.options }
    }

    #[inline]
    fn socket_is_closed(&self) -> bool {
        match &self.socket {
            Socket::SocketTcp(s) => s.is_closed(),
            Socket::SocketTls(s) => s.is_closed(),
        }
    }

    #[inline]
    fn socket_close(&self) {
        match &self.socket {
            Socket::SocketTcp(s) => s.close(uws::CloseKind::Normal),
            Socket::SocketTls(s) => s.close(uws::CloseKind::Normal),
        }
    }

    /// Dispatch `write` across the `AnySocket` variants (method missing on the enum).
    #[inline]
    fn socket_write(&self, data: &[u8]) -> i32 {
        match &self.socket {
            Socket::SocketTcp(s) => s.write(data),
            Socket::SocketTls(s) => s.write(data),
        }
    }

    /// Dispatch `set_timeout` across the `AnySocket` variants (method missing on the enum).
    #[inline]
    fn socket_set_timeout(&self, seconds: core::ffi::c_uint) {
        match &self.socket {
            Socket::SocketTcp(s) => s.set_timeout(seconds),
            Socket::SocketTls(s) => s.set_timeout(seconds),
        }
    }

    pub fn on_auto_flush(&mut self) -> bool {
        <Self as HasAutoFlush>::on_auto_flush(self)
    }
}

impl HasAutoFlush for PostgresSQLConnection {
    fn on_auto_flush(this: *mut Self) -> bool {
        // SAFETY: `this` is the live `*mut PostgresSQLConnection` registered
        // with the deferred-task queue; the queue runs on the JS thread with
        // exclusive access.
        let this = unsafe { &mut *this };
        this.on_auto_flush_impl()
    }
}

impl PostgresSQLConnection {
    fn on_auto_flush_impl(&mut self) -> bool {
        if self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
            debug!("onAutoFlush: has backpressure");
            self.auto_flusher.registered = false;
            // if we have backpressure, wait for onWritable
            return false;
        }
        self.ref_();
        debug!("onAutoFlush: draining");
        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) && self.write_buffer.len() > 0;
        debug!("onAutoFlush: keep_flusher_registered: {}", keep_flusher_registered);
        self.auto_flusher.registered = keep_flusher_registered;
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(std::ptr::from_mut::<Self>(self)) };
        keep_flusher_registered
    }

    fn register_auto_flusher(&mut self) {
        let data_to_send = self.write_buffer.len();
        debug!(
            "registerAutoFlusher: backpressure: {} registered: {} data_to_send: {}",
            self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE), self.auto_flusher.registered, data_to_send
        );

        if !self.auto_flusher.registered // should not be registered
            && !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) // if has backpressure we need to wait for onWritable event
            && data_to_send > 0 // we need data to send
            && self.status == Status::Connected
        // and we need to be connected
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked::<Self>(self, unsafe { self.vm() });
            self.auto_flusher.registered = true;
        }
    }

    fn unregister_auto_flusher(&mut self) {
        debug!("unregisterAutoFlusher registered: {}", self.auto_flusher.registered);
        if self.auto_flusher.registered {
            AutoFlusher::unregister_deferred_microtask_with_type::<Self>(self, unsafe { self.vm() });
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
        // PORT NOTE: reshaped for borrowck — `self.vm()` borrows `*self` while
        // `&mut self.timer` needs a disjoint mutable borrow. Route through the
        // raw VM pointer (the VM and the timer field are independent objects).
        let vm: *mut VirtualMachine = self.vm;
        if self.timer.state == EventLoopTimerState::ACTIVE {
            // SAFETY: `vm` is the live VM singleton stored in this connection.
            unsafe { &mut *vm }.timer().remove(&mut self.timer);
        }
        self.timer.state = EventLoopTimerState::CANCELLED;
    }

    pub fn reset_connection_timeout(&mut self) {
        // if we are processing data, don't reset the timeout, wait for the data to be processed
        if self.flags.contains(ConnectionFlags::IS_PROCESSING_DATA) {
            return;
        }
        let interval = self.get_timeout_interval();
        // PORT NOTE: reshaped for borrowck — see `disable_connection_timeout`.
        let vm: *mut VirtualMachine = self.vm;
        if self.timer.state == EventLoopTimerState::ACTIVE {
            // SAFETY: `vm` is the live VM singleton stored in this connection.
            unsafe { &mut *vm }.timer().remove(&mut self.timer);
        }
        if interval == 0 {
            return;
        }

        self.timer.next = bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::AllowMockedTime, i64::from(interval));
        // SAFETY: `vm` is the live VM singleton stored in this connection.
        unsafe { &mut *vm }.timer().insert(&mut self.timer);
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(getter)] proc-macro attr
    pub fn get_queries(_this: &Self, this_value: JSValue, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        if let Some(value) = js::queries_get_cached(this_value) {
            return Ok(value);
        }

        let array = JSValue::create_empty_array(global_object, 0)?;
        js::queries_set_cached(this_value, global_object, array);

        Ok(array)
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(getter)] proc-macro attr
    pub fn get_on_connect(_this: &Self, this_value: JSValue, _global_object: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onconnect_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(setter)] proc-macro attr
    pub fn set_on_connect(_this: &mut Self, this_value: JSValue, global_object: &JSGlobalObject, value: JSValue) {
        js::onconnect_set_cached(this_value, global_object, value);
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(getter)] proc-macro attr
    pub fn get_on_close(_this: &Self, this_value: JSValue, _global_object: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onclose_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(setter)] proc-macro attr
    pub fn set_on_close(_this: &mut Self, this_value: JSValue, global_object: &JSGlobalObject, value: JSValue) {
        js::onclose_set_cached(this_value, global_object, value);
    }

    pub fn setup_tls(&mut self) {
        debug!("setupTLS");
        // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `vm` mutably
        // while `postgres_group` also wants `&VirtualMachine`; route through a
        // raw pointer (Zig passed the same `vm` twice with no aliasing rules).
        let vm_ptr: *mut VirtualMachine = self.vm;
        // SAFETY: `vm_ptr` is the live VM singleton; the two derefs do not
        // produce overlapping `&mut` (rare_data accesses a disjoint field).
        let tls_group: *mut bun_uws::SocketGroup =
            unsafe { (*vm_ptr).rare_data().postgres_group::<true>(&*vm_ptr) };

        // Zig: `this.socket.SocketTCP.socket.connected` — at this point we are
        // a plain TCP socket in the Connected state.
        let Socket::SocketTcp(tcp) = &self.socket else {
            self.fail(b"Failed to upgrade to TLS", AnyPostgresError::TLSUpgradeFailed);
            return;
        };
        let uws::InternalSocket::Connected(raw) = tcp.socket else {
            self.fail(b"Failed to upgrade to TLS", AnyPostgresError::TLSUpgradeFailed);
            return;
        };

        // SAFETY: `secure` is set to a live `SSL_CTX*` before `setup_tls` is
        // reached (Zig: `this.secure.?`).
        let ssl_ctx = unsafe { &mut *self.secure.expect("secure SSL_CTX must be set before setupTLS") };
        let server_name = self.tls_config.server_name();
        let sni = if server_name.is_null() {
            None
        } else {
            // SAFETY: `server_name` is a NUL-terminated C string owned by
            // `tls_config` for the connection lifetime.
            Some(unsafe { bun_core::ffi::cstr(server_name) })
        };
        // Zig: `@sizeOf(?*PostgresSQLConnection)` — `?*T` is an 8-byte null-niche
        // optional. The Rust layout-equivalent is `Option<NonNull<T>>`; using
        // `Option<*mut T>` here would request 16 bytes (separate discriminant)
        // and desync with the trampoline reader (uws_handlers.rs) which reads
        // the slot as `Option<NonNull<_>>`.
        let ext_size = core::mem::size_of::<Option<core::ptr::NonNull<PostgresSQLConnection>>>() as i32;

        // SAFETY: `raw` is a live connected `us_socket_t*`; `tls_group` is a
        // live SocketGroup; adopt_tls may realloc and return a different ptr.
        let Some(new_socket) = (unsafe { &mut *raw }).adopt_tls(
            // SAFETY: `tls_group` is non-null (lazy-init in `postgres_group`).
            unsafe { &mut *tls_group },
            bun_uws::SocketKind::PostgresTls,
            ssl_ctx,
            sni,
            ext_size,
            ext_size,
        ) else {
            self.fail(b"Failed to upgrade to TLS", AnyPostgresError::TLSUpgradeFailed);
            return;
        };
        let new_socket = new_socket.as_ptr();
        // SAFETY: ext slot is sized for `Option<NonNull<PostgresSQLConnection>>`
        // above and `new_socket` is a live us_socket_t. Zig: `ext(?*PostgresSQLConnection).* = this`.
        unsafe {
            *(*new_socket).ext::<Option<core::ptr::NonNull<PostgresSQLConnection>>>() =
                core::ptr::NonNull::new(std::ptr::from_mut::<Self>(self));
        }
        self.socket = Socket::SocketTls(uws::SocketTLS { socket: uws::InternalSocket::Connected(new_socket) });
        // ext is now repointed; safe to kick the handshake (any dispatch lands here).
        // SAFETY: `new_socket` is a live us_socket_t with an attached SSL*.
        unsafe { (*new_socket).start_tls_handshake() };
        self.start();
    }

    fn setup_max_lifetime_timer_if_necessary(&mut self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        if self.max_lifetime_timer.state == EventLoopTimerState::ACTIVE {
            return;
        }

        self.max_lifetime_timer.next =
            bun_core::Timespec::ms_from_now(bun_core::TimespecMockMode::AllowMockedTime, i64::from(self.max_lifetime_interval_ms));
        // PORT NOTE: reshaped for borrowck — see `disable_connection_timeout`.
        let vm: *mut VirtualMachine = self.vm;
        // SAFETY: `vm` is the live VM singleton stored in this connection.
        unsafe { &mut *vm }.timer().insert(&mut self.max_lifetime_timer);
    }

    pub fn on_connection_timeout(&mut self) {
        debug!("onConnectionTimeout");

        self.timer.state = EventLoopTimerState::FIRED;
        if self.flags.contains(ConnectionFlags::IS_PROCESSING_DATA) {
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
        self.max_lifetime_timer.state = EventLoopTimerState::FIRED;
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

    // Codegen (`generated_classes.rs`) calls this as `T::has_pending_activity(&*this)`;
    // match that shape so the same body satisfies both the C-ABI thunk and direct
    // Rust callers. The atomic load is `&self`-only, so the `*mut Self` receiver
    // was never required.
    pub fn has_pending_activity(this: &Self) -> bool {
        // Called on GC thread; reads only atomic field.
        this.pending_activity_count.load(Ordering::Acquire) > 0
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
            Status::Disconnected | Status::Failed => (!self.socket_is_closed()) as u32,
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
        if unsafe { self.vm() }.is_shutting_down() {
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
                self.poll_ref.unref(self.vm_ctx());
            }
            _ => {}
        }
        self.update_has_pending_activity();
    }

    pub fn finalize(mut self: Box<Self>) {
        debug!("PostgresSQLConnection finalize");
        self.stop_timers();
        self.js_value.finalize();
        // Refcounted: release the JS wrapper's +1; allocation may outlive this
        // call if other refs remain, so hand ownership back to the raw refcount.
        // SAFETY: `self` is a live Box-allocated connection; `deref` frees on count==0.
        unsafe { Self::deref(Box::into_raw(self)) };
    }

    pub fn flush_data_and_reset_timeout(&mut self) {
        self.reset_connection_timeout();
        // defer flushing, so if many queries are running in parallel in the same connection, we don't flush more than once
        self.register_auto_flusher();
    }

    pub fn flush_data(&mut self) {
        // we know we still have backpressure so just return we will flush later
        if self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
            debug!("flushData: has backpressure");
            return;
        }

        let chunk = self.write_buffer.remaining();
        if chunk.is_empty() {
            debug!("flushData: no data to flush");
            return;
        }

        let wrote = self.socket_write(chunk);
        self.flags.set(ConnectionFlags::HAS_BACKPRESSURE, wrote < 0 || (wrote as usize) < chunk.len());
        debug!("flushData: wrote {}/{} bytes", wrote, chunk.len());
        if wrote > 0 {
            SocketMonitor::write(&chunk[..usize::try_from(wrote).expect("int cast")]);
            self.write_buffer.consume(u32::try_from(wrote).expect("int cast"));
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

        self.ref_();
        // we defer the refAndClose so the on_close will be called first before we reject the pending requests
        let on_close_opt = self.consume_on_close_callback(self.global());
        if let Some(on_close) = on_close_opt {
            let event_loop = unsafe { self.vm().event_loop_mut() };
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
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(std::ptr::from_mut::<Self>(self)) };
        self.update_has_pending_activity();
    }

    pub fn fail_fmt(&mut self, code: &[u8], args: core::fmt::Arguments<'_>) {
        // PORT NOTE: Zig used `comptime fmt: [:0]const u8, args: anytype` → collapsed to fmt::Arguments.
        let mut message: Vec<u8> = Vec::new();
        use std::io::Write as _;
        let _ = write!(&mut message, "{}", args);

        let err = match create_postgres_error(self.global(), &message, PostgresErrorOptions { code, ..Default::default() }) {
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

        if unsafe { self.vm() }.is_shutting_down() {
            self.stop_timers();
            if self.status == Status::Failed {
                self.update_has_pending_activity();
                return;
            }

            self.status = Status::Failed;
            self.clean_up_requests(None);
            self.update_has_pending_activity();
        } else {
            let event_loop = unsafe { self.vm().event_loop_mut() };
            event_loop.enter();
            self.poll_ref.unref(self.vm_ctx());

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
        let mut msg = protocol::StartupMessage {
            user: Data::Temporary(std::ptr::from_ref::<[u8]>(self.user())),
            database: Data::Temporary(std::ptr::from_ref::<[u8]>(self.database())),
            options: Data::Temporary(std::ptr::from_ref::<[u8]>(self.options())),
        };
        if let Err(err) = msg.write_internal(self.writer()) {
            self.fail(b"Failed to write startup message", AnyPostgresError::from(err));
        }
    }

    // PORT NOTE: Zig passed `socket` by value; both call sites have already
    // stored it into `self.socket`, so dispatch through `socket_write` instead
    // (avoids moving the non-`Copy` `AnySocket` enum out of `self`).
    fn start_tls(&mut self) {
        debug!("startTLS");
        let offset: u8 = match self.tls_status {
            TLSStatus::MessageSent(count) => count,
            _ => 0,
        };
        let ssl_request: [u8; 8] = [
            0x00, 0x00, 0x00, 0x08, // Length
            0x04, 0xD2, 0x16, 0x2F, // SSL request code
        ];

        let written = self.socket_write(&ssl_request[offset as usize..]);
        if written > 0 {
            self.tls_status = TLSStatus::MessageSent(offset + u8::try_from(written).expect("int cast"));
        } else {
            self.tls_status = TLSStatus::MessageSent(offset);
        }
    }

    pub fn on_open(&mut self, socket: uws::AnySocket) {
        self.socket = socket;

        self.poll_ref.r#ref(self.vm_ctx());
        self.update_has_pending_activity();

        if matches!(self.tls_status, TLSStatus::MessageSent(_) | TLSStatus::Pending) {
            self.start_tls();
            return;
        }

        self.start();
    }

    pub fn on_handshake(&mut self, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        debug!("onHandshake: {} {}", success, ssl_error.error_no);
        let handshake_success = success == 1;
        if handshake_success {
            if self.tls_config.reject_unauthorized() != 0 {
                // only reject the connection if reject_unauthorized == true
                match self.ssl_mode {
                    // https://github.com/porsager/postgres/blob/6ec85a432b17661ccacbdf7f765c651e88969d36/src/connection.js#L272-L279
                    SSLMode::VerifyCa | SSLMode::VerifyFull => {
                        if ssl_error.error_no != 0 {
                            let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else { return };
                            self.fail_with_js_value(v);
                            return;
                        }

                        // SAFETY: native handle of a connected TLS socket is `SSL*`.
                        let ssl_ptr: *mut BoringSSL::c::SSL = self.socket.get_native_handle().map_or(core::ptr::null_mut(), |p| p.cast());
                        if let Some(servername) = unsafe { BoringSSL::c::SSL_get_servername(ssl_ptr, 0).as_ref() } {
                            // SAFETY: SSL_get_servername returns a NUL-terminated C string.
                            let hostname = unsafe { bun_core::ffi::cstr(std::ptr::from_ref(servername).cast::<core::ffi::c_char>()) }.to_bytes();
                            // SAFETY: `ssl_ptr` is the live SSL* of a connected TLS socket.
                            if !BoringSSL::check_server_identity(unsafe { &mut *ssl_ptr }, hostname) {
                                let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else { return };
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
            let Ok(v) = verify_error_to_js(&ssl_error, self.global()) else { return };
            self.fail_with_js_value(v);
        }
    }

    pub fn on_timeout(&mut self) {
        debug!("onTimeout");
    }

    pub fn on_drain(&mut self) {
        debug!("onDrain");
        self.flags.remove(ConnectionFlags::HAS_BACKPRESSURE);
        // Don't send any other messages while we're waiting for TLS.
        if let TLSStatus::MessageSent(sent) = self.tls_status {
            if sent < 8 {
                self.start_tls();
            }
            return;
        }

        self.drain_internal();
    }

    fn drain_internal(&mut self) {
        debug!("drainInternal");
        if unsafe { self.vm() }.is_shutting_down() {
            return self.close();
        }

        // PORT NOTE: reshaped for borrowck — `self.vm()` ties the returned
        // `&EventLoop` to `&*self`, blocking the `&mut self` calls below. The
        // event loop is a VM-owned singleton independent of this struct, so
        // route through the raw VM pointer.
        let vm: *mut VirtualMachine = self.vm;
        // SAFETY: `vm` is the live VM singleton stored in this connection.
        let event_loop = unsafe { (*vm).event_loop_mut() };
        event_loop.enter();

        self.flush_data();

        if !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) && self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY) {
            // no backpressure yet so pipeline more if possible and flush again
            self.advance();
            self.flush_data();
        }
        event_loop.exit();
    }

    pub fn on_data(&mut self, data: &[u8]) {
        self.ref_();
        self.flags.insert(ConnectionFlags::IS_PROCESSING_DATA);
        // PORT NOTE: reshaped for borrowck — see `drain_internal`.
        let vm: *mut VirtualMachine = self.vm;

        self.disable_connection_timeout();
        // PORT NOTE: Zig `defer { ... }` block expanded after the body below; cannot use scopeguard
        // because it captures &mut self alongside the body.

        // SAFETY: `vm` is the live VM singleton stored in this connection.
        let event_loop = unsafe { (*vm).event_loop_mut() };
        event_loop.enter();
        SocketMonitor::read(data);
        // reset the head to the last message so remaining reflects the right amount of bytes
        self.read_buffer.get_mut().head = self.last_message_start.get();

        let mut done = false;
        if self.read_buffer.get_mut().remaining().is_empty() {
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

                        self.read_buffer.get_mut().head = 0;
                        self.last_message_start.set(0);
                        self.read_buffer.get_mut().byte_list.clear();
                        self.read_buffer.get_mut().write(&data[offset..]).expect("failed to write to read buffer");
                    } else {
                        { let _ = err; /* TODO(port): bun_crash_handler::handle_error_return_trace */ };
                        self.fail(b"Failed to read data", err);
                    }
                }
            }
            // no need to reset anything, its already empty
            done = true;
        }
        if !done {
            // read buffer is not empty, so we need to write the data to the buffer and then read it
            self.read_buffer.get_mut().write(data).expect("failed to write to read buffer");
            // PORT NOTE: reshaped for borrowck — build reader (raw backref) before reborrowing self.
            let reader = self.buffered_reader();
            match PostgresRequest::on_data(self, reader) {
                Ok(()) => {
                    debug!("clean read_buffer");
                    // success, we read everything! let's reset the last message start and the head
                    self.last_message_start.set(0);
                    self.read_buffer.get_mut().head = 0;
                }
                Err(err) => {
                    if err != AnyPostgresError::ShortRead {
                        { let _ = err; /* TODO(port): bun_crash_handler::handle_error_return_trace */ };
                        self.fail(b"Failed to read data", err);
                    } else {
                        #[cfg(debug_assertions)]
                        {
                            let lms = self.last_message_start.get();
                            let rb = self.read_buffer.get_mut();
                            debug!(
                                "read_buffer: not empty and received short read: last_message_start: {}, head: {}, len: {}",
                                lms, rb.head, rb.byte_list.len()
                            );
                        }
                    }
                }
            }
        }

        event_loop.exit();
        // === defer block ===
        if self.status == Status::Connected && !self.has_query_running() && self.write_buffer.remaining().is_empty() {
            // Don't keep the process alive when there's nothing to do.
            self.poll_ref.unref(self.vm_ctx());
        } else if self.status == Status::Connected {
            // Keep the process alive if there's something to do.
            self.poll_ref.r#ref(self.vm_ctx());
        }
        self.flags.remove(ConnectionFlags::IS_PROCESSING_DATA);

        // reset the connection timeout after we're done processing the data
        self.reset_connection_timeout();
        // SAFETY: `self` is a live Box-allocated connection; this releases one ref.
        unsafe { Self::deref(std::ptr::from_mut::<Self>(self)) };
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn] proc-macro attr
    pub fn constructor(global_object: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<*mut PostgresSQLConnection> {
        Err(global_object.throw(format_args!("PostgresSQLConnection cannot be constructed directly")))
    }
}

// comptime { @export(&jsc.toJSHostFn(call), .{ .name = "PostgresSQLConnection__createInstance" }) }
// TODO(port): the #[crate::jsc::host_fn] attribute on `call` should emit the correct
// `#[unsafe(no_mangle)] extern "C"` shim named `PostgresSQLConnection__createInstance`.
#[unsafe(no_mangle)]
pub extern "C" fn PostgresSQLConnection__createInstance(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC always passes valid non-null global/callframe pointers.
    let (g, f) = unsafe { (&*global, &*callframe) };
    match call(g, f) {
        Ok(v) => v,
        Err(_) => JSValue::ZERO,
    }
}

// TODO(b2-blocked): #[crate::jsc::host_fn] proc-macro attr
pub fn call(global_object: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM via raw ptr,
    // no other live borrow in this scope.
    let vm_ptr = global_object.sql_vm_ptr();
    let vm = unsafe { &mut *vm_ptr };
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
            match jsc::api::ServerConfig::SSLConfig::from_js(&mut *vm, global_object, tls_object) {
                Ok(opt) => opt.unwrap_or_default(),
                Err(_) => return Ok(JSValue::ZERO),
            }
        } else {
            return Err(global_object.throw_invalid_arguments(format_args!("tls must be a boolean or an object")));
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
        let mut err: uws::create_bun_socket_error_t = uws::create_bun_socket_error_t::none;
        secure = vm.ssl_ctx_cache().get_or_create_opts(tls_config.as_usockets_for_client_verification(), &mut err);
        if secure.is_none() {
            drop(tls_config);
            // TODO(port): Zig `err.toJS(globalObject)` — `to_js` lives as an extension
            // in the runtime _jsc crate and isn't reachable from sql_jsc; throw the
            // static message instead.
            return Err(global_object.throw(format_args!(
                "{}",
                core::str::from_utf8(err.message().unwrap_or(b"Failed to create SSL context")).unwrap_or("Failed to create SSL context")
            )));
        }
    }
    // Covers `try arguments[7/8].toBunString()` and the null-byte rejection
    // below. Ownership passes into `ptr.*` once allocated — `into_inner`
    // recovers them just before the Box is built so the connect-fail path's
    // `ptr.deinit()` is the sole cleanup.
    // PORT NOTE: guard owns `(secure, tls_config)` by value. Do NOT
    // `drop_in_place` a stack local that Rust would also auto-drop on unwind —
    // that double-frees. The closure's `_tls_config` is dropped exactly once by
    // normal scope-exit drop here.
    let errdefer_guard = scopeguard::guard((secure, tls_config), |(secure, _tls_config)| {
        if let Some(s) = secure {
            // SAFETY: SSL_CTX_free is safe to call on a valid SSL_CTX*.
            unsafe { BoringSSL::c::SSL_CTX_free(s) };
        }
    });

    // PORT NOTE: `StringBuilder::append` takes `&mut self` and returns a borrow
    // of the backing buffer, so successive appends can't keep their `&[u8]`
    // results live across each other. The buffer is allocated once and never
    // moved (`move_to_slice` hands back the same allocation), so detach each
    // result to a raw `*const [u8]` immediately — the struct stores them as
    // raw pointers anyway (self-referential into `options_buf`).
    let mut username: *const [u8] = b"";
    let mut password: *const [u8] = b"";
    let mut database: *const [u8] = b"";
    let mut options: *const [u8] = b"";
    let mut path: *const [u8] = b"";

    let options_str = arguments[7].to_bun_string(global_object)?;

    let path_str = arguments[8].to_bun_string(global_object)?;

    let options_buf: Box<[u8]> = 'brk: {
        let mut b = bun_string::StringBuilder::default();
        b.cap += username_str.utf8_byte_length() + 1
            + password_str.utf8_byte_length() + 1
            + database_str.utf8_byte_length() + 1
            + options_str.utf8_byte_length() + 1
            + path_str.utf8_byte_length() + 1;

        let _ = b.allocate();
        let u = username_str.to_utf8_without_ref();
        username = std::ptr::from_ref::<[u8]>(b.append(u.slice()));
        drop(u);

        let p = password_str.to_utf8_without_ref();
        password = std::ptr::from_ref::<[u8]>(b.append(p.slice()));
        drop(p);

        let d = database_str.to_utf8_without_ref();
        database = std::ptr::from_ref::<[u8]>(b.append(d.slice()));
        drop(d);

        let o = options_str.to_utf8_without_ref();
        options = std::ptr::from_ref::<[u8]>(b.append(o.slice()));
        drop(o);

        let _path = path_str.to_utf8_without_ref();
        path = std::ptr::from_ref::<[u8]>(b.append(_path.slice()));
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
        // SAFETY: each ptr is either `b""` (static) or points into `options_buf`,
        // which is live for this scope.
        let entry = unsafe { &*entry };
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

    // Ownership transferred into `ptr`; disarm the errdefer and recover the
    // moved `secure`/`tls_config` for the struct literal below.
    let (secure, tls_config) = scopeguard::ScopeGuard::into_inner(errdefer_guard);

    let ptr: *mut PostgresSQLConnection = bun_core::heap::into_raw(Box::new(PostgresSQLConnection {
        socket: Socket::SocketTcp(uws::SocketTCP { socket: uws::InternalSocket::Detached }),
        status: Status::Connecting,
        ref_count: Cell::new(1),
        write_buffer: OffsetByteList::default(),
        read_buffer: UnsafeCell::new(OffsetByteList::default()),
        last_message_start: Cell::new(0),
        requests: PostgresRequest::Queue::init(),
        pipelined_requests: 0,
        nonpipelinable_requests: 0,
        poll_ref: KeepAlive::default(),
        // `&T` → `*const T` coercion; field is `*const` (read-only provenance) and only
        // ever dereferenced as `&*` via `global()`.
        global_object,
        // `VirtualMachine::get()` returns the singleton `*mut` with full write provenance
        // (same pointer as `global_object.bun_vm()`, asserted in debug builds). Avoids
        // deriving `*mut` from the `&VirtualMachine` above, which would make `vm()`'s
        // `&mut *self.vm` UB.
        vm: VirtualMachine::get_mut_ptr(),
        statements: PreparedStatementsMap::default(),
        prepared_statement_id: 0,
        pending_activity_count: AtomicU32::new(0),
        js_value: crate::jsc::JsRef::empty(),
        backend_parameters: StringMap::init(true),
        backend_key_data: protocol::BackendKeyData::default(),
        database,
        user: username,
        password,
        path,
        options,
        options_buf,
        authentication_state: AuthenticationState::Pending,
        secure,
        tls_config,
        tls_status: if ssl_mode != SSLMode::Disable { TLSStatus::Pending } else { TLSStatus::None },
        ssl_mode,
        idle_timeout_interval_ms: u32::try_from(idle_timeout).expect("int cast"),
        connection_timeout_ms: u32::try_from(connection_timeout).expect("int cast"),
        flags: if use_unnamed_prepared_statements {
            ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS
        } else {
            ConnectionFlags::empty()
        },
        timer: EventLoopTimer::init_paused(EventLoopTimerTag::PostgresSQLConnectionTimeout),
        max_lifetime_interval_ms: u32::try_from(max_lifetime).expect("int cast"),
        max_lifetime_timer: EventLoopTimer::init_paused(
            EventLoopTimerTag::PostgresSQLConnectionMaxLifetime,
        ),
        auto_flusher: AutoFlusher::default(),
    }));

    // SAFETY: ptr was just Box-allocated above.
    let this = unsafe { &mut *ptr };

    {
        let hostname = hostname_str.to_utf8();

        // Postgres always opens plain TCP first (SSLRequest happens in-band),
        // so even `ssl_mode != .disable` lands in the TCP group; `setupTLS()`
        // adopts into `postgres_tls_group` after the server's `S`.
        // PORT NOTE: reshaped for borrowck — `rare_data()` borrows `*vm_ptr`
        // mutably and `postgres_group` needs a `&VirtualMachine`; route both
        // through the raw singleton pointer (cf. `setup_tls`).
        // SAFETY: `vm_ptr` is the live VM singleton; the two derefs do not
        // overlap (rare_data() returns a disjoint `&mut RareData`).
        let group = unsafe { (*vm_ptr).rare_data().postgres_group::<false>(&*vm_ptr) };
        // SAFETY: path is a valid slice into options_buf which is owned by *ptr.
        let path_slice = unsafe { &*this.path };
        let result = if !path_slice.is_empty() {
            uws::SocketTCP::connect_unix_group(group, uws::SocketKind::Postgres, None, path_slice, ptr, false)
        } else {
            uws::SocketTCP::connect_group(group, uws::SocketKind::Postgres, None, hostname.slice(), port, ptr, false)
        };

        this.socket = Socket::SocketTcp(match result {
            Ok(s) => s,
            Err(err) => {
                PostgresSQLConnection::deinit(ptr);
                return Err(global_object.throw_error(err.into(), "failed to connect to postgresql"));
            }
        });
    }

    // only call toJS if connectUnixAnon does not fail immediately
    this.update_has_pending_activity();
    this.reset_connection_timeout();
    this.poll_ref.ref_(this.vm_ctx());
    let js_value = js::to_js(ptr, global_object);
    js_value.ensure_still_alive();
    this.js_value = crate::jsc::JsRef::init_weak(js_value);
    js::onconnect_set_cached(js_value, global_object, on_connect);
    js::onclose_set_cached(js_value, global_object, on_close);
    /* TODO(port): bun_core::analytics::Features::POSTGRES_CONNECTIONS counter */ ();
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

    pub fn on_open(this: &mut PostgresSQLConnection, socket: SocketType<SSL>) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_open(Self::_socket(socket));
    }

    fn on_handshake_(this: &mut PostgresSQLConnection, _: SocketType<SSL>, success: i32, ssl_error: uws::us_bun_verify_error_t) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_handshake(success, ssl_error);
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    // TODO(port): conditional associated const fn — in Rust, expose `Option<fn(...)>`.
    pub const ON_HANDSHAKE: Option<fn(&mut PostgresSQLConnection, SocketType<SSL>, i32, uws::us_bun_verify_error_t)> =
        if SSL { Some(Self::on_handshake_) } else { None };

    pub fn on_close(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>, _: i32, _: Option<*mut c_void>) {
        this.on_close();
    }

    pub fn on_end(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>) {
        this.on_close();
    }

    pub fn on_connect_error(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>, _: i32) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_close();
    }

    pub fn on_timeout(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_timeout();
    }

    pub fn on_data(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>, data: &[u8]) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_data(data);
    }

    pub fn on_writable(this: &mut PostgresSQLConnection, _socket: SocketType<SSL>) {
        if unsafe { this.vm() }.is_shutting_down() {
            #[cold]
            fn cold(this: &mut PostgresSQLConnection) { this.close(); }
            cold(this);
            return;
        }
        this.on_drain();
    }
}

impl PostgresSQLConnection {
    // TODO(b2-blocked): #[crate::jsc::host_fn(method)] proc-macro attr
    pub fn do_ref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.ref_(this.vm_ctx());
        this.update_has_pending_activity();
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(method)] proc-macro attr
    pub fn do_unref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(this.vm_ctx());
        this.update_has_pending_activity();
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(method)] proc-macro attr
    pub fn do_flush(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    fn close(&mut self) {
        self.disconnect();
        self.unregister_auto_flusher();
        self.write_buffer.clear_and_free();
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(method)] proc-macro attr
    pub fn do_close(this: &mut Self, _global_object: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.close();
        Ok(JSValue::UNDEFINED)
    }

    pub fn stop_timers(&mut self) {
        if self.timer.state == EventLoopTimerState::ACTIVE {
            unsafe { self.vm() }.timer().remove(&mut self.timer);
        }
        if self.max_lifetime_timer.state == EventLoopTimerState::ACTIVE {
            unsafe { self.vm() }.timer().remove(&mut self.max_lifetime_timer);
        }
    }

    // TODO(port): `deinit` is the intrusive-refcount destructor (called when ref_count hits 0).
    // Not `impl Drop` because it frees `self`'s own Box and is also called directly on the
    // connect-fail path before any JS wrapper exists. Non-pub: callers are `deref()` and the
    // connect-fail path in `call()`, both in this file.
    //
    // Raw-pointer receiver: this function ends in `heap::take(this)`. A `&mut self`
    // argument would carry a Stacked Borrows protector for the whole frame, and freeing
    // the allocation while that protector is live is UB ("deallocating while item is
    // protected"). Taking `*mut Self` and reborrowing per-call keeps each `&mut` scoped
    // strictly before the dealloc — direct mapping of Zig's `*@This()`.
    fn deinit(this: *mut Self) {
        // SAFETY: sole remaining owner; `this` is a live Box-allocated connection.
        unsafe {
            (*this).disconnect();
            (*this).stop_timers();
            for stmt_ptr in (*this).statements.values() {
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
                for b in buf.iter_mut() { core::ptr::write_volatile(b, 0); }
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

    fn clean_up_requests(&mut self, js_reason: Option<JSValue>) {
        while let Some(request_ptr) = self.current() {
            // SAFETY: request is a valid *mut PostgresSQLQuery owned by the queue.
            let request = unsafe { &mut *request_ptr };
            match request.status {
                // pending we will fail the request and the stmt will be marked as error ConnectionClosed too
                QueryStatus::Pending => {
                    let Some(stmt) = request.statement else {
                        // `continue` in Zig with `orelse continue` — but we still need to deref+discard.
                        // PORT NOTE: Zig `orelse continue` skips the deref/discard at the bottom too;
                        // matching that behavior here.
                        continue;
                    };
                    // SAFETY: stmt is a valid *mut PostgresSQLStatement.
                    let stmt = unsafe { &mut *stmt };
                    stmt.error_response = Some(StatementError::PostgresError(AnyPostgresError::ConnectionClosed));
                    stmt.status = StatementStatus::Failed;
                    if !unsafe { self.vm() }.is_shutting_down() {
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, self.global());
                        } else {
                            request.on_error(
                                StatementError::PostgresError(AnyPostgresError::ConnectionClosed),
                                self.global(),
                            );
                        }
                    }
                }
                // in the middle of running
                QueryStatus::Binding
                | QueryStatus::Running
                | QueryStatus::PartialResponse => {
                    self.finish_request(request);
                    if !unsafe { self.vm() }.is_shutting_down() {
                        if let Some(reason) = js_reason {
                            request.on_js_error(reason, self.global());
                        } else {
                            request.on_error(
                                StatementError::PostgresError(AnyPostgresError::ConnectionClosed),
                                self.global(),
                            );
                        }
                    }
                }
                // just ignore success and fail cases
                QueryStatus::Success | QueryStatus::Fail => {}
            }
            unsafe { PostgresSQLQuery::deref_(request_ptr) };
            self.requests.discard(1);
        }
    }

    fn ref_and_close(&mut self, js_reason: Option<JSValue>) {
        // refAndClose is always called when we wanna to disconnect or when we are closed

        if !self.socket_is_closed() {
            // event loop need to be alive to close the socket
            self.poll_ref.ref_(self.vm_ctx());
            // will unref on socket close
            self.socket_close();
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
        !self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY) || self.current().is_some()
    }

    pub fn can_pipeline(&self) -> bool {
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING.get().unwrap_or(false) {
            #[cold]
            fn cold() -> bool { false }
            return cold();
        }

        self.nonpipelinable_requests == 0 // need to wait for non pipelinable requests to finish
            && !self.flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS) // unnamed statements are not pipelinable
            && !self.flags.contains(ConnectionFlags::WAITING_TO_PREPARE) // cannot pipeline when waiting prepare
            && !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) // dont make sense to buffer more if we have backpressure
            && (self.write_buffer.len() as usize) < MAX_PIPELINE_SIZE // buffer is too big need to flush before pipeline more
    }
}

// PORT NOTE: reshaped for borrowck — Zig's `Writer.connection: *PostgresSQLConnection`
// is a raw backref (LIFETIMES.tsv BACKREF). Holding `&'a mut PostgresSQLConnection`
// here would alias the `&mut self` that `on()` already holds whenever a write happens
// mid-message-handling. The connection strictly outlives any Writer (Writers are only
// constructed via `self.writer()` and never stored), and write_buffer accesses are
// disjoint from read_buffer accesses.
#[derive(Clone, Copy)]
pub struct Writer {
    pub connection: *mut PostgresSQLConnection,
}

impl Writer {
    #[inline]
    fn write_buffer(&self) -> &mut OffsetByteList {
        // SAFETY: see struct-level PORT NOTE — connection outlives the Writer.
        // Raw-pointer field projection (`addr_of_mut!`) avoids materializing
        // `&mut PostgresSQLConnection`, which would alias the caller's live `&mut self`.
        // Only `write_buffer` is borrowed here, and callers never touch it through
        // `&mut self` while a Writer is live.
        unsafe { &mut *core::ptr::addr_of_mut!((*self.connection).write_buffer) }
    }

    pub fn write(&mut self, data: &[u8]) -> Result<(), AnyPostgresError> {
        self.write_buffer().write(data).map_err(|_| AnyPostgresError::OutOfMemory)?;
        Ok(())
    }

    pub fn pwrite(&mut self, data: &[u8], index: usize) -> Result<(), AnyPostgresError> {
        self.write_buffer().byte_list.slice_mut()[index..][..data.len()].copy_from_slice(data);
        Ok(())
    }

    pub fn offset(&self) -> usize {
        self.write_buffer().len() as usize
    }
}

impl protocol::WriterContext for Writer {
    #[inline]
    fn offset(self) -> usize { Writer::offset(&self) }
    #[inline]
    fn write(mut self, bytes: &[u8]) -> Result<(), AnyPostgresError> { Writer::write(&mut self, bytes) }
    #[inline]
    fn pwrite(mut self, bytes: &[u8], i: usize) -> Result<(), AnyPostgresError> { Writer::pwrite(&mut self, bytes, i) }
}

impl PostgresSQLConnection {
    pub fn writer(&mut self) -> protocol::NewWriter<Writer> {
        protocol::NewWriter {
            wrapped: Writer { connection: std::ptr::from_mut::<PostgresSQLConnection>(self) },
        }
    }
}

// PORT NOTE: reshaped for borrowck — Zig's `Reader.connection: *PostgresSQLConnection`
// is a raw backref (LIFETIMES.tsv BACKREF). `PostgresRequest::on_data` passes both
// `&mut PostgresSQLConnection` and a `NewReader<Reader>` into `on()`; with a borrowed
// `&'a mut` field that is two live `&mut` to the same object. `*mut` mirrors the Zig
// pointer; read_buffer/last_message_start accesses here are disjoint from the
// write_buffer/state mutations done through `&mut self` in `on()`.
#[derive(Clone, Copy)]
pub struct Reader {
    pub connection: *mut PostgresSQLConnection,
}

impl Reader {
    #[inline]
    fn read_buffer(&self) -> &mut OffsetByteList {
        // SAFETY: see struct-level PORT NOTE — connection outlives the Reader.
        // `on()` already holds `&mut PostgresSQLConnection` to the same struct, and
        // under Stacked Borrows that retag covers every byte of the struct. The
        // field is `UnsafeCell<OffsetByteList>`, so that retag inserts SharedRW
        // (not Unique) for these bytes and the raw `*mut` stored in `self.connection`
        // remains a valid tag to derive `&mut` to the cell's interior from. `on()`
        // never touches `read_buffer` through its own `&mut self` while a Reader is
        // live, so no two `&mut OffsetByteList` coexist.
        unsafe { &mut *(*self.connection).read_buffer.get() }
    }

    pub fn mark_message_start(&mut self) {
        let head = self.read_buffer().head;
        // SAFETY: same justification as `read_buffer()` — `last_message_start` is a
        // `Cell<u32>` so the sibling `&mut PostgresSQLConnection` retag leaves a
        // SharedRW tag for these bytes; raw read of the cell pointer is valid.
        unsafe { (*self.connection).last_message_start.set(head) };
    }

    pub fn ensure_length(&self, count: usize) -> bool {
        self.ensure_capacity(count)
    }

    pub fn peek(&self) -> &[u8] {
        self.read_buffer().remaining()
    }

    pub fn skip(&mut self, count: usize) {
        let buf = self.read_buffer();
        buf.head = (buf.head + (count as u32)).min(buf.byte_list.len() as u32);
    }

    pub fn ensure_capacity(&self, count: usize) -> bool {
        let buf = self.read_buffer();
        (buf.head as usize) + count <= (buf.byte_list.len() as usize)
    }

    pub fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> {
        let remaining = self.read_buffer().remaining();
        if (remaining.len() as usize) < count {
            return Err(AnyPostgresError::ShortRead);
        }

        // PORT NOTE: reshaped for borrowck — capture slice ptr before calling skip().
        let slice = &raw const remaining[..count];
        self.skip(count);
        // SAFETY: slice points into read_buffer which is not reallocated by skip().
        Ok(Data::Temporary(unsafe { &raw const *slice }))
    }

    pub fn read_z(&mut self) -> Result<Data, AnyPostgresError> {
        let remain = self.read_buffer().remaining();

        if let Some(zero) = strings::index_of_char(remain, 0) {
            let slice = &raw const remain[..zero as usize];
            self.skip(zero as usize + 1);
            // SAFETY: slice points into read_buffer which is not reallocated by skip().
            return Ok(Data::Temporary(unsafe { &raw const *slice }));
        }

        Err(AnyPostgresError::ShortRead)
    }
}

impl protocol::ReaderContext for Reader {
    #[inline]
    fn mark_message_start(&mut self) { Reader::mark_message_start(self) }
    #[inline]
    fn peek(&self) -> &[u8] { Reader::peek(self) }
    #[inline]
    fn skip(&mut self, count: usize) { Reader::skip(self, count) }
    #[inline]
    fn ensure_length(&mut self, count: usize) -> bool { Reader::ensure_length(self, count) }
    #[inline]
    fn read(&mut self, count: usize) -> Result<Data, AnyPostgresError> { Reader::read(self, count) }
    #[inline]
    fn read_z(&mut self) -> Result<Data, AnyPostgresError> { Reader::read_z(self) }
}

impl PostgresSQLConnection {
    pub fn buffered_reader(&mut self) -> protocol::NewReader<Reader> {
        protocol::NewReader {
            wrapped: Reader { connection: std::ptr::from_mut::<PostgresSQLConnection>(self) },
        }
    }

    fn finish_request(&mut self, item: &mut PostgresSQLQuery) {
        match item.status {
            QueryStatus::Running
            | QueryStatus::Binding
            | QueryStatus::PartialResponse => {
                if item.flags.simple {
                    self.nonpipelinable_requests -= 1;
                } else if item.flags.pipelined {
                    self.pipelined_requests -= 1;
                }
            }
            QueryStatus::Success
            | QueryStatus::Fail
            | QueryStatus::Pending => {}
        }
    }

    pub fn can_prepare_query(&self) -> bool {
        self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY) && !self.flags.contains(ConnectionFlags::WAITING_TO_PREPARE) && self.pipelined_requests == 0
    }

    /// Process pending requests and flush. Called from the enqueue path when
    /// unnamed prepared statements with params skip writeQuery+Sync and need
    /// advance() to send everything atomically on an idle connection.
    pub fn advance_and_flush(&mut self) {
        if !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) && self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY) {
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
                        QueryStatus::Success => {
                            unsafe { PostgresSQLQuery::deref_(result_ptr) };
                            $self.requests.discard(1);
                            continue;
                        }
                        QueryStatus::Fail => {
                            unsafe { PostgresSQLQuery::deref_(result_ptr) };
                            $self.requests.discard(1);
                            continue;
                        }
                        _ => break, // truly current item
                    }
                }
            }};
        }

        while self.requests.readable_length() > offset && !self.flags.contains(ConnectionFlags::HAS_BACKPRESSURE) {
            if unsafe { self.vm() }.is_shutting_down() {
                self.close();
                defer_cleanup!(self);
                return;
            }

            let req_ptr: *mut PostgresSQLQuery = self.requests.peek_item(offset);
            // SAFETY: req is a valid *mut PostgresSQLQuery owned by the queue.
            let req = unsafe { &mut *req_ptr };
            match req.status {
                QueryStatus::Pending => {
                    if req.flags.simple {
                        if self.pipelined_requests > 0 || !self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY) {
                            debug!(
                                "cannot execute simple query, pipelined_requests: {}, is_ready_for_query: {}",
                                self.pipelined_requests, self.flags.contains(ConnectionFlags::IS_READY_FOR_QUERY)
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
                                unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                self.requests.discard(1);
                            } else {
                                // deinit later
                                req.status = QueryStatus::Fail;
                            }
                            debug!("executeQuery failed: {}", err);
                            continue;
                        }
                        self.nonpipelinable_requests += 1;
                        self.flags.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                        req.status = QueryStatus::Running;
                        defer_cleanup!(self);
                        return;
                    } else {
                        if let Some(statement_ptr) = req.statement {
                            // SAFETY: statement is a valid *mut PostgresSQLStatement.
                            let statement = unsafe { &mut *statement_ptr };
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
                                        unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                        self.requests.discard(1);
                                    } else {
                                        // deinit later
                                        req.status = QueryStatus::Fail;
                                        offset += 1;
                                    }
                                    continue;
                                }
                                StatementStatus::Prepared => {
                                    let Some(this_value) = req.this_value.try_get() else {
                                        debug_assert!(false, "query value was freed earlier than expected");
                                        if offset == 0 {
                                            unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                            self.requests.discard(1);
                                        } else {
                                            // deinit later
                                            req.status = QueryStatus::Fail;
                                            offset += 1;
                                        }
                                        continue;
                                    };
                                    let binding_value = postgres_sql_query::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                    let columns_value = postgres_sql_query::js::columns_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                    req.flags.binary = !statement.fields.is_empty();

                                    if self.flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS) {
                                        // For unnamed prepared statements, always include Parse
                                        // before Bind+Execute. The unnamed statement may not exist
                                        // on the current server connection when using PgBouncer or
                                        // other connection poolers in transaction mode.
                                        debug!("parse, bind and execute unnamed stmt");
                                        let query_str = req.query.to_utf8();
                                        // PORT NOTE: hoist global to avoid &self/&mut self overlap
                                        // with `self.writer()` (JSC_BORROW — global outlives self).
                                        let global = unsafe { &*self.global_object };
                                        if let Err(err) = PostgresRequest::parse_and_bind_and_execute(
                                            global,
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
                                                unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = QueryStatus::Fail;
                                                offset += 1;
                                            }
                                            debug!("parse, bind and execute failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                    } else {
                                        debug!("binding and executing stmt");
                                        // PORT NOTE: hoist global (JSC_BORROW) — see above.
                                        let global = unsafe { &*self.global_object };
                                        if let Err(err) = PostgresRequest::bind_and_execute(
                                            global,
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
                                                unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = QueryStatus::Fail;
                                                offset += 1;
                                            }
                                            debug!("bind and execute failed: {}", err);
                                            continue;
                                        }
                                    }

                                    self.flags.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                    req.status = QueryStatus::Binding;
                                    req.flags.pipelined = true;
                                    self.pipelined_requests += 1;

                                    if self.flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS) || !self.can_pipeline() {
                                        debug!("cannot pipeline more stmt");
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    offset += 1;
                                    continue;
                                }
                                StatementStatus::Pending => {
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
                                                unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = QueryStatus::Fail;
                                                offset += 1;
                                            }
                                            continue;
                                        };
                                        // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                                        let binding_value = postgres_sql_query::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        debug!("prepareAndQueryWithSignature");
                                        // PORT NOTE: hoist global (JSC_BORROW) — see above.
                                        let global = unsafe { &*self.global_object };
                                        if let Err(err) = PostgresRequest::prepare_and_query_with_signature(
                                            global,
                                            query_str.slice(),
                                            binding_value,
                                            self.writer(),
                                            &mut statement.signature,
                                        ) {
                                            if let Some(err_) = self.global().try_take_exception() {
                                                req.on_js_error(err_, self.global());
                                            } else {
                                                statement.status = StatementStatus::Failed;
                                                statement.error_response = Some(StatementError::PostgresError(err));
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            if offset == 0 {
                                                unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                                self.requests.discard(1);
                                            } else {
                                                // deinit later
                                                req.status = QueryStatus::Fail;
                                            }
                                            debug!("prepareAndQueryWithSignature failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                        self.flags.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                        self.flags.insert(ConnectionFlags::WAITING_TO_PREPARE);
                                        req.status = QueryStatus::Binding;
                                        statement.status = StatementStatus::Parsing;
                                        self.flush_data_and_reset_timeout();
                                        defer_cleanup!(self);
                                        return;
                                    }

                                    if self.flags.contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS) {
                                        // For unnamed prepared statements, send Parse+Describe+Bind+Execute
                                        // atomically to prevent PgBouncer from splitting them across
                                        // server connections. Uses signature field types for encoding
                                        // (text format for unknowns); actual types will be cached from
                                        // ParameterDescription for subsequent executions.
                                        let Some(this_value) = req.this_value.try_get() else {
                                            debug_assert!(false, "query value was freed earlier than expected");
                                            debug_assert!(offset == 0);
                                            unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                            self.requests.discard(1);
                                            continue;
                                        };
                                        let binding_value = postgres_sql_query::js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        let columns_value = postgres_sql_query::js::columns_get_cached(this_value).unwrap_or(JSValue::ZERO);
                                        debug!("parseAndBindAndExecute (unnamed, first execution)");
                                        // PORT NOTE: hoist global (JSC_BORROW) — see above.
                                        let global = unsafe { &*self.global_object };
                                        if let Err(err) = PostgresRequest::parse_and_bind_and_execute(
                                            global,
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
                                                statement.status = StatementStatus::Failed;
                                                statement.error_response = Some(StatementError::PostgresError(err));
                                                req.on_write_fail(err, self.global(), self.get_queries_array());
                                            }
                                            debug_assert!(offset == 0);
                                            unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                            self.requests.discard(1);
                                            debug!("parseAndBindAndExecute failed: {}", <&'static str>::from(err));
                                            continue;
                                        }
                                        self.flags.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                        self.flags.insert(ConnectionFlags::WAITING_TO_PREPARE);
                                        req.status = QueryStatus::Binding;
                                        statement.status = StatementStatus::Parsing;
                                        req.flags.pipelined = true;
                                        self.pipelined_requests += 1;
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
                                            statement.error_response = Some(StatementError::PostgresError(err));
                                            statement.status = StatementStatus::Failed;
                                            req.on_write_fail(err, self.global(), self.get_queries_array());
                                        }
                                        debug_assert!(offset == 0);
                                        unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                        self.requests.discard(1);
                                        debug!("write query failed: {}", <&'static str>::from(err));
                                        continue;
                                    }
                                    if let Err(err) = connection_writer.write(&protocol::SYNC) {
                                        if let Some(err_) = self.global().try_take_exception() {
                                            req.on_js_error(err_, self.global());
                                        } else {
                                            statement.error_response = Some(StatementError::PostgresError(err));
                                            statement.status = StatementStatus::Failed;
                                            req.on_write_fail(err, self.global(), self.get_queries_array());
                                        }
                                        debug_assert!(offset == 0);
                                        unsafe { PostgresSQLQuery::deref_(req_ptr) };
                                        self.requests.discard(1);
                                        debug!("write query (sync) failed: {}", <&'static str>::from(err));
                                        continue;
                                    }
                                    self.flags.remove(ConnectionFlags::IS_READY_FOR_QUERY);
                                    self.flags.insert(ConnectionFlags::WAITING_TO_PREPARE);
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

                QueryStatus::Running
                | QueryStatus::Binding
                | QueryStatus::PartialResponse => {
                    if self.flags.contains(ConnectionFlags::WAITING_TO_PREPARE) || self.nonpipelinable_requests > 0 {
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
                QueryStatus::Success => {
                    if offset > 0 {
                        // deinit later
                        req.status = QueryStatus::Fail;
                        offset += 1;
                        continue;
                    }
                    unsafe { PostgresSQLQuery::deref_(req_ptr) };
                    self.requests.discard(1);
                    continue;
                }
                QueryStatus::Fail => {
                    if offset > 0 {
                        // deinit later
                        offset += 1;
                        continue;
                    }
                    unsafe { PostgresSQLQuery::deref_(req_ptr) };
                    self.requests.discard(1);
                    continue;
                }
            }
        }
        defer_cleanup!(self);
    }

    pub fn get_queries_array(&self) -> JSValue {
        let Some(js_value) = self.js_value.try_get() else {
            return JSValue::UNDEFINED;
        };
        js::queries_get_cached(js_value).unwrap_or(JSValue::UNDEFINED)
    }

    // TODO(port): Zig signature is `on(comptime MessageType: @Type(.enum_literal), comptime Context: type, reader)`.
    // Const-generic enum params are unstable, so `message_type` is a runtime arg; the match
    // below still monomorphizes per-Context and the branch is trivially predictable.
    // PORT NOTE: `reader` is taken by-value as a `NewReaderWrap<&mut Context>`
    // (the dispatch loop in `PostgresRequest::on_data` passes
    // `reader.reborrow()` per-message). Per-arm `decode_internal` calls reborrow
    // again via `reader.reborrow()` (see protocol::NewReaderWrap::reborrow).
    pub fn on<Context: protocol::ReaderContext>(
        &mut self,
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
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: request is a valid *mut PostgresSQLQuery owned by the queue.
                let request = unsafe { &mut *request_ptr };

                let statement_ptr = request.statement.ok_or(AnyPostgresError::ExpectedStatement)?;
                // SAFETY: statement is valid for the duration of the request.
                let statement = unsafe { &mut *statement_ptr };
                let mut structure: JSValue = JSValue::UNDEFINED;
                // PORT NOTE: reshaped for borrowck — `statement.structure()` borrows
                // `&mut *statement` and returns `&CachedStructure`; capture it as a raw
                // pointer so `&statement.fields` below does not conflict, and re-derive
                // `Option<&_>` for `to_js` at the call site.
                let mut cached_structure_ptr: *const PostgresCachedStructure = core::ptr::null();
                // explicit use switch without else so if new modes are added, we don't forget to check for duplicate fields
                match request.flags.result_mode {
                    SQLQueryResultMode::Objects => {
                        let owner = self.js_value.try_get().unwrap_or(JSValue::ZERO);
                        let cs = statement.structure(owner, self.global());
                        structure = cs.js_value().unwrap_or(JSValue::UNDEFINED);
                        cached_structure_ptr = std::ptr::from_ref::<PostgresCachedStructure>(cs);
                    }
                    SQLQueryResultMode::Raw | SQLQueryResultMode::Values => {
                        // no need to check for duplicate fields or structure
                    }
                }

                let mut putter = DataCell::Putter {
                    list: &mut [],
                    fields: &statement.fields,
                    binary: request.flags.binary,
                    bigint: request.flags.bigint,
                    global_object: self.global(),
                    count: 0,
                    // TODO(port): other Putter default fields
                };

                let mut stack_buf = [DataCell::SQLDataCell::default(); 70];
                // PERF(port): was stack-fallback alloc — profile in Phase B
                let max_inline = jsc::JSObject::max_inline_capacity() as usize;
                let mut heap_cells: Vec<DataCell::SQLDataCell>;
                let mut free_cells = false;
                let cells: &mut [DataCell::SQLDataCell] = if statement.fields.len() >= max_inline {
                    heap_cells = (0..statement.fields.len()).map(|_| DataCell::SQLDataCell::default()).collect();
                    free_cells = true;
                    &mut heap_cells
                } else {
                    &mut stack_buf[..statement.fields.len().min(max_inline)]
                };
                // make sure all cells are reset if reader short breaks the fields will just be null which is better than undefined behavior
                for c in cells.iter_mut() { *c = DataCell::SQLDataCell::default(); }
                putter.list = cells;

                // PORT NOTE: DataRow::decode takes the context by-value (Copy) and calls the
                // callback with it; pass a raw `*mut Putter` so the closure can mutate it.
                let putter_ptr: *mut DataCell::Putter<'_> = &raw mut putter;
                let decode_result = if request.flags.result_mode == SQLQueryResultMode::Raw {
                    protocol::DataRow::decode(putter_ptr, &mut reader, |p, i, b| {
                        // SAFETY: putter outlives this call.
                        unsafe { &mut *p }.put_raw(i, b)
                    })
                } else {
                    protocol::DataRow::decode(putter_ptr, &mut reader, |p, i, b| {
                        // SAFETY: putter outlives this call.
                        unsafe { &mut *p }.put(i, b)
                    })
                };
                // PORT NOTE: Zig `defer { for (cells[0..putter.count]) |*cell| cell.deinit(); if (free_cells) free(cells); }`
                // runs on ALL exits (decode error, to_js error, success). Capture raw pointers so
                // the guard can read `putter.count` after decode/to_js mutate `putter` without
                // tripping borrowck.
                let cells_ptr: *mut DataCell::SQLDataCell = putter.list.as_mut_ptr();
                let count_ptr: *const usize = core::ptr::addr_of!(putter.count);
                scopeguard::defer! {
                    // SAFETY: cells_ptr points into stack_buf/heap_cells and count_ptr into putter,
                    // both declared earlier in this block and outlive this guard.
                    let count = unsafe { *count_ptr };
                    for i in 0..count {
                        unsafe { (*cells_ptr.add(i)).deinit() };
                    }
                    // `if free_cells free(cells)`: heap_cells Vec drops at scope end.
                };
                decode_result?;

                let Some(this_value) = request.this_value.try_get() else {
                    debug_assert!(false, "query value was freed earlier than expected");
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                let pending_value = postgres_sql_query::js::pending_value_get_cached(this_value).unwrap_or(JSValue::ZERO);
                pending_value.ensure_still_alive();
                let result = putter.to_js(
                    self.global(),
                    pending_value,
                    structure,
                    statement.fields_flags,
                    request.flags.result_mode,
                    // SAFETY: points into `statement.cached_structure`; statement
                    // outlives this call (held via `request.statement` ref).
                    unsafe { cached_structure_ptr.as_ref() },
                )?;

                if pending_value.is_empty() {
                    postgres_sql_query::js::pending_value_set_cached(this_value, self.global(), result);
                }

                let _ = free_cells; // heap_cells dropped at scope end; defer! above runs cell.deinit()
            }
            MessageType::CopyData => {
                let copy_data = protocol::CopyData::decode_internal(reader.reborrow()).map_err(pg_err)?;
                drop(copy_data);
            }
            MessageType::ParameterStatus => {
                let parameter_status = protocol::ParameterStatus::decode_internal(reader.reborrow()).map_err(pg_err)?;
                self.backend_parameters
                    .insert(parameter_status.name.slice(), parameter_status.value.slice())
                    .map_err(|_| AnyPostgresError::OutOfMemory)?;
                // parameter_status dropped at scope end
            }
            MessageType::ReadyForQuery => {
                let _ready_for_query = protocol::ReadyForQuery::decode_internal(reader.reborrow()).map_err(pg_err)?;

                self.set_status(Status::Connected);
                self.flags.remove(ConnectionFlags::WAITING_TO_PREPARE);
                self.flags.insert(ConnectionFlags::IS_READY_FOR_QUERY);
                self.socket_set_timeout(300);

                if let Some(request_ptr) = self.current() {
                    // SAFETY: valid queue item.
                    let request = unsafe { &mut *request_ptr };
                    if request.status == QueryStatus::PartialResponse {
                        self.finish_request(request);
                        // if is a partial response, just signal that the query is now complete
                        request.on_result(b"", self.global(), self.js_value.try_get().unwrap_or(JSValue::ZERO), true);
                    }
                }
                self.advance();

                self.register_auto_flusher();
                self.update_ref();
            }
            MessageType::CommandComplete => {
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };

                let mut cmd: protocol::CommandComplete = Default::default();
                cmd.decode_internal(reader.reborrow()).map_err(pg_err)?;
                debug!("-> {}", bstr::BStr::new(cmd.command_tag.slice()));

                request.on_result(cmd.command_tag.slice(), self.global(), self.js_value.try_get().unwrap_or(JSValue::ZERO), false);
                self.update_ref();
                // cmd dropped at scope end
            }
            MessageType::BindComplete => {
                reader.eat_message(&protocol::BIND_COMPLETE)?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                if request.status == QueryStatus::Binding {
                    request.status = QueryStatus::Running;
                }
            }
            MessageType::ParseComplete => {
                reader.eat_message(&protocol::PARSE_COMPLETE)?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &*request_ptr };
                if let Some(statement_ptr) = request.statement {
                    // SAFETY: request holds a ref on its statement; valid while request is queued.
                    let statement = unsafe { &mut *statement_ptr };
                    // if we have params wait for parameter description
                    if statement.status == StatementStatus::Parsing && statement.signature.fields.is_empty() {
                        statement.status = StatementStatus::Prepared;
                        self.flags.remove(ConnectionFlags::WAITING_TO_PREPARE);
                    }
                }
            }
            MessageType::ParameterDescription => {
                let description = protocol::ParameterDescription::decode_internal(reader.reborrow()).map_err(pg_err)?;
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
                if statement.status == StatementStatus::Parsing {
                    statement.status = StatementStatus::Prepared;
                    self.flags.remove(ConnectionFlags::WAITING_TO_PREPARE);
                }
            }
            MessageType::RowDescription => {
                let description = protocol::RowDescription::decode_internal(reader.reborrow()).map_err(pg_err)?;
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
                    // PORT NOTE: Vec<FieldDescription> drop runs each field's Drop.
                    statement.fields = Vec::new();
                    statement.cached_structure = Default::default();
                    statement.needs_duplicate_check = true;
                    statement.fields_flags = Default::default();
                }
                statement.fields = description.fields.into_vec();
            }
            MessageType::Authentication => {
                let auth = protocol::Authentication::decode_internal(&mut reader).map_err(pg_err)?;

                match &auth {
                    protocol::Authentication::SASL => {
                        if !matches!(self.authentication_state, AuthenticationState::Sasl(_)) {
                            self.authentication_state = AuthenticationState::Sasl(Default::default());
                        }

                        let mut mechanism_buf = [0u8; 128];
                        let AuthenticationState::Sasl(sasl) = &mut self.authentication_state else { unreachable!() };
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

                        response.write_internal(self.writer()).map_err(pg_err)?;
                        debug!("SASL");
                        self.flush_data();
                    }
                    protocol::Authentication::SASLContinue(cont) => {
                        // PORT NOTE: reshaped for borrowck — read `password` (raw
                        // *const [u8] backref into options_buf) before taking
                        // `&mut self.authentication_state`; Zig passed `this` but
                        // compute_salted_password only needs the password slice.
                        // SAFETY: self.password points into self.options_buf for the
                        // lifetime of the connection (see ::init).
                        let password: &[u8] = unsafe { &*self.password };
                        let AuthenticationState::Sasl(sasl) = &mut self.authentication_state else {
                            debug!("Unexpected SASLContinue for authentication state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        };

                        if sasl.status != SASLStatus::Init {
                            debug!("Unexpected SASLContinue for SASL state");
                            return Err(AnyPostgresError::UnexpectedMessage);
                        }
                        debug!("SASLContinue");

                        let iteration_count = cont.iteration_count().map_err(pg_err)?;

                        // SAFETY: cont.s points into cont.data, which is alive for this match arm.
                        let server_salt_decoded_base64 =
                            bun_base64::decode_alloc(unsafe { &*cont.s }).map_err(|e| match e {
                                bun_base64::DecodeAllocError::DecodingFailed => {
                                    AnyPostgresError::SASL_SIGNATURE_INVALID_BASE64
                                }
                            })?;
                        sasl.compute_salted_password(&server_salt_decoded_base64, iteration_count, password)?;
                        drop(server_salt_decoded_base64);

                        let mut auth_string: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut auth_string,
                                "n=*,r={},r={},s={},i={},c=biws,r={}",
                                bstr::BStr::new(sasl.nonce()),
                                // SAFETY: cont.{r,s,i} point into cont.data, alive for this arm.
                                bstr::BStr::new(unsafe { &*cont.r }),
                                bstr::BStr::new(unsafe { &*cont.s }),
                                bstr::BStr::new(unsafe { &*cont.i }),
                                bstr::BStr::new(unsafe { &*cont.r }),
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

                        // base64 of 32 bytes → ceil(32/3)*4 = 44; +4 slack matches Zig encodeLenFromSize.
                        let mut client_key_xor_base64_buf = [0u8; 48];
                        let xor_base64_len = bun_base64::encode(&mut client_key_xor_base64_buf, &client_key_xor_buffer);

                        let mut payload: Vec<u8> = Vec::new();
                        {
                            use std::io::Write as _;
                            let _ = write!(
                                &mut payload,
                                "c=biws,r={},p={}",
                                // SAFETY: cont.r points into cont.data, alive for this arm.
                                bstr::BStr::new(unsafe { &*cont.r }),
                                bstr::BStr::new(&client_key_xor_base64_buf[..xor_base64_len]),
                            );
                        }

                        let mut response = protocol::SASLResponse {
                            data: Data::Temporary(std::ptr::from_ref::<[u8]>(payload.as_slice())),
                        };

                        // PORT NOTE: reshaped for borrowck — set status before
                        // self.writer()/flush_data() so the `sasl` borrow ends
                        // first (Zig order is not load-bearing).
                        sasl.status = SASLStatus::Continue;
                        response.write_internal(&mut self.writer()).map_err(pg_err)?;
                        self.flush_data();
                    }
                    protocol::Authentication::SASLFinal { data: final_data } => {
                        let AuthenticationState::Sasl(sasl) = &mut self.authentication_state else {
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
                            // password is a valid slice into options_buf.
                            password: Data::Temporary(self.password),
                        };

                        response.write_internal(&mut self.writer()).map_err(pg_err)?;
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
                            let n = bun_core::fmt::bytes_to_hex_lower(&first_hash_buf, &mut first_hash_str);
                            &first_hash_str[..n]
                        };

                        // Second hash: md5(first_hash + salt)
                        let mut final_hasher = bun_sha_hmac::MD5::init();
                        final_hasher.update(first_hash_str_output);
                        final_hasher.update(salt);
                        final_hasher.r#final(&mut final_hash_buf);
                        let final_hash_str_output = {
                            let n = bun_core::fmt::bytes_to_hex_lower(&final_hash_buf, &mut final_hash_str);
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
                        response.write_internal(&mut self.writer()).map_err(pg_err)?;
                        self.flush_data();
                    }

                    _other => {
                        debug!("TODO auth: unsupported");
                        self.fail(b"TODO: support authentication method: {s}", AnyPostgresError::UNSUPPORTED_AUTHENTICATION_METHOD);
                    }
                }
                // auth dropped at scope end (defer auth.deinit())
            }
            MessageType::NoData => {
                reader.eat_message(&protocol::NO_DATA)?;
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                if request.status == QueryStatus::Binding {
                    request.status = QueryStatus::Running;
                }
            }
            MessageType::BackendKeyData => {
                self.backend_key_data = protocol::BackendKeyData::decode_internal(reader.reborrow()).map_err(pg_err)?;
            }
            MessageType::ErrorResponse => {
                let err = protocol::ErrorResponse::decode_internal(reader.reborrow()).map_err(pg_err)?;

                if self.status == Status::Connecting || self.status == Status::SentStartupMessage {
                    let v = crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                    drop(err);
                    self.fail_with_js_value(v);

                    // it shouldn't enqueue any requests while connecting
                    debug_assert!(self.requests.readable_length() == 0);
                    return Ok(());
                }

                let Some(request_ptr) = self.current() else {
                    debug!("ErrorResponse: {}", err);
                    return Err(AnyPostgresError::ExpectedRequest);
                };
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                // Convert to JS while we still own `err` — Zig's `request.onError` only ever
                // calls `err.toJS`, so materialize the JS value once and route through
                // `on_js_error` to avoid double-ownership of the non-Clone ErrorResponse.
                let js_err = crate::postgres::protocol::error_response_jsc::to_js(&err, self.global());
                if let Some(stmt_ptr) = request.statement {
                    // SAFETY: request holds a ref on its statement; valid while request is queued.
                    let stmt = unsafe { &mut *stmt_ptr };
                    if stmt.status == StatementStatus::Parsing {
                        stmt.status = StatementStatus::Failed;
                        stmt.error_response =
                            Some(crate::postgres::postgres_sql_statement::Error::Protocol(err));
                        if self.statements.remove(&bun_wyhash::hash(&stmt.signature.name)).is_some() {
                            // SAFETY: `stmt_ptr` is a live `Box`-allocated statement; the
                            // request still holds its own ref so this cannot drop to 0.
                            unsafe { PostgresSQLStatement::deref(stmt_ptr) };
                        }
                    }
                }
                // If `err` was not moved into stmt above, it drops here automatically.

                self.finish_request(request);
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
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                request.on_result(b"CLOSECOMPLETE", self.global(), self.js_value.get(), false);
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
                let request_ptr = self.current().ok_or(AnyPostgresError::ExpectedRequest)?;
                // SAFETY: valid *mut PostgresSQLQuery owned by self.requests queue.
                let request = unsafe { &mut *request_ptr };
                request.on_result(b"", self.global(), self.js_value.get(), false);
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
            self.poll_ref.r#ref(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));
        } else {
            self.poll_ref.unref(bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js));
        }
    }

    // TODO(b2-blocked): #[crate::jsc::host_fn(getter)] proc-macro attr
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

// ported from: src/sql_jsc/postgres/PostgresSQLConnection.zig
