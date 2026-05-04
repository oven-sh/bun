use core::cell::Cell;
use core::ffi::c_void;

use bun_aio::KeepAlive;
use bun_boringssl as boringssl;
use bun_core::{err, fmt as bun_fmt, timespec, StringBuilder};
use bun_jsc::{
    api::server_config::SSLConfig, api::timer::EventLoopTimer, codegen::JSMySQLConnection as js,
    webcore::AutoFlusher, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, VirtualMachine,
};
use bun_ptr::IntrusiveRc;
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError, Error as AnyMySQLErrorT};
use bun_sql::mysql::protocol::error_packet::ErrorPacket;
use bun_sql::mysql::protocol::new_reader::NewReader;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::ssl_mode::SSLMode;
use bun_sql::mysql::MySQLQueryResult;
use bun_sql_jsc::shared::CachedStructure;
use bun_str::strings;
use bun_uws::{self as uws, AnySocket, NewSocketHandler, SocketTCP};

use super::js_mysql_query::JSMySQLQuery;
use super::mysql_connection::{self, MySQLConnection};
use super::mysql_statement::MySQLStatement;
use super::protocol::result_set::{self as ResultSet};

bun_output::declare_scope!(MySQLConnection, visible);

const NS_PER_MS: u64 = 1_000_000;

#[bun_jsc::JsClass]
pub struct JSMySQLConnection {
    // intrusive refcount (bun.ptr.RefCount mixin); destroy callback = `deinit`
    ref_count: Cell<u32>,
    js_value: JsRef,
    // LIFETIMES.tsv: JSC_BORROW — assigned from createInstance param; never freed
    // TODO(port): lifetime — JSC_BORROW rust_type is `&JSGlobalObject`; struct lifetime deferred to Phase B
    global_object: &JSGlobalObject,
    // LIFETIMES.tsv: STATIC — globalObject.bunVM() singleton
    vm: &'static VirtualMachine,
    poll_ref: KeepAlive,

    connection: MySQLConnection,

    pub auto_flusher: AutoFlusher,

    pub idle_timeout_interval_ms: u32,
    pub connection_timeout_ms: u32,
    /// Before being connected, this is a connection timeout timer.
    /// After being connected, this is an idle timeout timer.
    pub timer: EventLoopTimer,

    /// This timer controls the maximum lifetime of a connection.
    /// It starts when the connection successfully starts (i.e. after handshake is complete).
    /// It stops when the connection is closed.
    pub max_lifetime_interval_ms: u32,
    pub max_lifetime_timer: EventLoopTimer,
}

// pub const ref = RefCount.ref; pub const deref = RefCount.deref;
// → provided by IntrusiveRc trait impl
impl bun_ptr::IntrusiveRefCounted for JSMySQLConnection {
    fn ref_count(&self) -> &Cell<u32> {
        &self.ref_count
    }
    fn destroy(this: *mut Self) {
        // SAFETY: called by IntrusiveRc when count hits 0; `this` is the unique owner.
        unsafe { (*this).deinit() };
    }
}

impl JSMySQLConnection {
    #[inline]
    pub fn ref_(&self) {
        IntrusiveRc::ref_(self);
    }
    #[inline]
    pub fn deref(&self) {
        IntrusiveRc::deref(self);
    }

    pub fn on_auto_flush(&mut self) -> bool {
        bun_output::scoped_log!(MySQLConnection, "onAutoFlush");
        if self.connection.has_backpressure() {
            self.auto_flusher.registered = false;
            // if we have backpressure, wait for onWritable
            return false;
        }

        // drain as much as we can
        self.drain_internal();

        // if we dont have backpressure and if we still have data to send, return true otherwise return false and wait for onWritable
        let keep_flusher_registered = self.connection.can_flush();
        self.auto_flusher.registered = keep_flusher_registered;
        keep_flusher_registered
    }

    fn register_auto_flusher(&mut self) {
        if !self.auto_flusher.registered // should not be registered
            && self.connection.can_flush()
        {
            AutoFlusher::register_deferred_microtask_with_type_unchecked(self, self.vm);
            self.auto_flusher.registered = true;
        }
    }

    fn unregister_auto_flusher(&mut self) {
        if self.auto_flusher.registered {
            AutoFlusher::unregister_deferred_microtask_with_type(self, self.vm);
            self.auto_flusher.registered = false;
        }
    }

    fn stop_timers(&mut self) {
        bun_output::scoped_log!(MySQLConnection, "stopTimers");
        if self.timer.state == EventLoopTimer::State::ACTIVE {
            self.vm.timer.remove(&mut self.timer);
        }
        if self.max_lifetime_timer.state == EventLoopTimer::State::ACTIVE {
            self.vm.timer.remove(&mut self.max_lifetime_timer);
        }
    }

    fn get_timeout_interval(&self) -> u32 {
        match self.connection.status {
            mysql_connection::Status::Connected => {
                if self.connection.is_idle() {
                    return self.idle_timeout_interval_ms;
                }
                0
            }
            mysql_connection::Status::Failed => 0,
            _ => self.connection_timeout_ms,
        }
    }

    pub fn reset_connection_timeout(&mut self) {
        let interval = self.get_timeout_interval();
        bun_output::scoped_log!(MySQLConnection, "resetConnectionTimeout {}", interval);
        if self.timer.state == EventLoopTimer::State::ACTIVE {
            self.vm.timer.remove(&mut self.timer);
        }
        if self.connection.status == mysql_connection::Status::Failed
            || self.connection.is_processing_data()
            || interval == 0
        {
            return;
        }

        self.timer.next =
            timespec::ms_from_now(timespec::Mode::AllowMockedTime, interval.into());
        self.vm.timer.insert(&mut self.timer);
    }

    pub fn on_connection_timeout(&mut self) {
        self.timer.state = EventLoopTimer::State::FIRED;

        if self.connection.is_processing_data() {
            return;
        }

        if self.connection.status == mysql_connection::Status::Failed {
            return;
        }

        if self.get_timeout_interval() == 0 {
            self.reset_connection_timeout();
            return;
        }

        match self.connection.status {
            mysql_connection::Status::Connected => {
                self.fail_fmt(
                    err!("IdleTimeout"),
                    format_args!(
                        "Idle timeout reached after {}",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.idle_timeout_interval_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            mysql_connection::Status::Connecting => {
                self.fail_fmt(
                    err!("ConnectionTimedOut"),
                    format_args!(
                        "Connection timeout after {}",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            mysql_connection::Status::Handshaking
            | mysql_connection::Status::Authenticating
            | mysql_connection::Status::AuthenticationAwaitingPk => {
                self.fail_fmt(
                    err!("ConnectionTimedOut"),
                    format_args!(
                        "Connection timeout after {} (during authentication)",
                        bun_fmt::fmt_duration_one_decimal(
                            (self.connection_timeout_ms as u64).saturating_mul(NS_PER_MS)
                        )
                    ),
                );
            }
            mysql_connection::Status::Disconnected | mysql_connection::Status::Failed => {}
        }
    }

    pub fn on_max_lifetime_timeout(&mut self) {
        self.max_lifetime_timer.state = EventLoopTimer::State::FIRED;
        if self.connection.status == mysql_connection::Status::Failed {
            return;
        }
        self.fail_fmt(
            err!("LifetimeTimeout"),
            format_args!(
                "Max lifetime timeout reached after {}",
                bun_fmt::fmt_duration_one_decimal(
                    (self.max_lifetime_interval_ms as u64).saturating_mul(NS_PER_MS)
                )
            ),
        );
    }

    fn setup_max_lifetime_timer_if_necessary(&mut self) {
        if self.max_lifetime_interval_ms == 0 {
            return;
        }
        if self.max_lifetime_timer.state == EventLoopTimer::State::ACTIVE {
            return;
        }

        self.max_lifetime_timer.next = timespec::ms_from_now(
            timespec::Mode::AllowMockedTime,
            self.max_lifetime_interval_ms.into(),
        );
        self.vm.timer.insert(&mut self.max_lifetime_timer);
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        global_object.throw("MySQLConnection cannot be constructed directly", format_args!(""))
    }

    pub fn enqueue_request(&mut self, item: *mut JSMySQLQuery) {
        bun_output::scoped_log!(MySQLConnection, "enqueueRequest");
        self.connection.enqueue_request(item);
        self.reset_connection_timeout();
        self.register_auto_flusher();
    }

    pub fn close(&mut self) {
        self.ref_();
        self.stop_timers();
        self.unregister_auto_flusher();
        let _guard = scopeguard::guard((), |_| {
            // TODO(port): errdefer — captures &mut self across guard; Phase B may need reshape
            self.update_reference_type();
            self.deref();
        });
        if self.vm.is_shutting_down() {
            self.connection.close();
        } else {
            self.connection
                .clean_queue_and_close(None, self.get_queries_array());
        }
    }

    fn drain_internal(&mut self) {
        bun_output::scoped_log!(MySQLConnection, "drainInternal");
        if self.vm.is_shutting_down() {
            return self.close();
        }
        self.ref_();
        let _ref_guard = scopeguard::guard((), |_| self.deref());
        let event_loop = self.vm.event_loop();
        event_loop.enter();
        let _loop_guard = scopeguard::guard((), |_| event_loop.exit());
        self.ensure_js_value_is_alive();
        if let Err(e) = self.connection.flush_queue() {
            debug_assert_eq!(e, err!("AuthenticationFailed"));
            self.fail(b"Authentication failed", e);
            return;
        }
    }

    /// Intrusive-refcount destroy callback. Not `Drop` — this type is a
    /// `.classes.ts` `m_ctx` payload; teardown is driven by `finalize()` → `deref()`.
    /// Private: only `IntrusiveRefCounted::destroy` calls this.
    fn deinit(&mut self) {
        self.stop_timers();
        self.poll_ref.unref(self.vm);
        self.unregister_auto_flusher();

        self.connection.cleanup();
        // bun.destroy(this) — freeing the Box is handled by IntrusiveRc::destroy.
        // TODO(port): confirm IntrusiveRc frees allocation after this returns.
    }

    fn ensure_js_value_is_alive(&self) {
        if let Some(value) = self.js_value.try_get() {
            value.ensure_still_alive();
        }
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(MySQLConnection, "finalize");
        // SAFETY: called on mutator thread during lazy sweep; `this` is the m_ctx ptr.
        unsafe {
            (*this).js_value.finalize();
            (*this).deref();
        }
    }

    fn update_reference_type(&mut self) {
        if self.connection.is_active() {
            bun_output::scoped_log!(MySQLConnection, "connection is active");
            if self.js_value.is_not_empty() && self.js_value.is_weak() {
                bun_output::scoped_log!(MySQLConnection, "strong ref until connection is closed");
                self.js_value.upgrade(self.global_object);
            }
            if self.connection.status == mysql_connection::Status::Connected
                && self.connection.is_idle()
            {
                self.poll_ref.unref(self.vm);
            } else {
                self.poll_ref.ref_(self.vm);
            }
            return;
        }
        if self.js_value.is_not_empty() && self.js_value.is_strong() {
            self.js_value.downgrade();
        }
        self.poll_ref.unref(self.vm);
    }

    #[bun_jsc::host_fn]
    pub fn create_instance(
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let vm = global_object.bun_vm();
        let arguments = callframe.arguments();
        let hostname_str = arguments[0].to_bun_string(global_object)?;
        // defer hostname_str.deref() — Drop on bun_str::String
        let port = arguments[1].coerce::<i32>(global_object)?;

        let username_str = arguments[2].to_bun_string(global_object)?;
        let password_str = arguments[3].to_bun_string(global_object)?;
        let database_str = arguments[4].to_bun_string(global_object)?;
        // TODO: update this to match MySQL.
        let ssl_mode: SSLMode = match arguments[5].to_int32() {
            0 => SSLMode::Disable,
            1 => SSLMode::Prefer,
            2 => SSLMode::Require,
            3 => SSLMode::VerifyCa,
            4 => SSLMode::VerifyFull,
            _ => SSLMode::Disable,
        };

        let tls_object = arguments[6];

        let mut tls_config: SSLConfig = SSLConfig::default();
        let mut secure: Option<*mut uws::SslCtx> = None;
        if ssl_mode != SSLMode::Disable {
            tls_config = if tls_object.is_boolean() && tls_object.to_boolean() {
                SSLConfig::default()
            } else if tls_object.is_object() {
                match SSLConfig::from_js(vm, global_object, tls_object) {
                    Ok(Some(c)) => c,
                    Ok(None) => SSLConfig::default(),
                    Err(_) => return Ok(JSValue::ZERO),
                }
            } else {
                return global_object
                    .throw_invalid_arguments("tls must be a boolean or an object", format_args!(""));
            };

            if global_object.has_exception() {
                drop(tls_config);
                return Ok(JSValue::ZERO);
            }

            // We always request the cert so we can verify it and also we manually
            // abort the connection if the hostname doesn't match. Built here so
            // CA/cert errors throw synchronously, applied later by upgradeToTLS.
            // Goes through the per-VM weak `SSLContextCache` so every pooled
            // connection / reconnect shares one `SSL_CTX*` per distinct config.
            let mut err = uws::CreateBunSocketError::None;
            secure = vm
                .rare_data()
                .ssl_ctx_cache()
                .get_or_create_opts(tls_config.as_usockets_for_client_verification(), &mut err);
            if secure.is_none() {
                drop(tls_config);
                return global_object.throw_value(err.to_js(global_object));
            }
        }
        // Covers `try arguments[7/8].toBunString()` and the null-byte rejection
        // below. Ownership passes to `MySQLConnection.init` once `Box::new`
        // succeeds — we null the locals at that point so the connect-fail path
        // (which `deref()`s the connection) doesn't double-free.
        let mut tls_guard = scopeguard::guard((secure, tls_config), |(s, cfg)| {
            if let Some(s) = s {
                // SAFETY: secure was created by ssl_ctx_cache; we own one ref until transferred.
                unsafe { boringssl::c::SSL_CTX_free(s) };
            }
            drop(cfg);
        });

        let mut username: &[u8] = b"";
        let mut password: &[u8] = b"";
        let mut database: &[u8] = b"";
        let mut options: &[u8] = b"";
        let mut path: &[u8] = b"";

        let options_str = arguments[7].to_bun_string(global_object)?;
        let path_str = arguments[8].to_bun_string(global_object)?;

        let options_buf: Box<[u8]> = 'brk: {
            let mut b = StringBuilder::default();
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
            username = b.append(u.slice());

            let p = password_str.to_utf8_without_ref();
            password = b.append(p.slice());

            let d = database_str.to_utf8_without_ref();
            database = b.append(d.slice());

            let o = options_str.to_utf8_without_ref();
            options = b.append(o.slice());

            let _path = path_str.to_utf8_without_ref();
            path = b.append(_path.slice());

            break 'brk b.allocated_slice();
        };

        // Reject null bytes in connection parameters to prevent protocol injection
        // (null bytes act as field terminators in the MySQL wire protocol).
        for (slice, msg) in [
            (username, "username must not contain null bytes"),
            (password, "password must not contain null bytes"),
            (database, "database must not contain null bytes"),
            (path, "path must not contain null bytes"),
        ] {
            if !slice.is_empty() && strings::index_of_char(slice, 0).is_some() {
                drop(options_buf);
                // tls_config / secure released by the guard above.
                return global_object.throw_invalid_arguments(msg, format_args!(""));
            }
        }

        let on_connect = arguments[9];
        let on_close = arguments[10];
        let idle_timeout = arguments[11].to_int32();
        let connection_timeout = arguments[12].to_int32();
        let max_lifetime = arguments[13].to_int32();
        let use_unnamed_prepared_statements = arguments[14].as_boolean();
        // MySQL doesn't support unnamed prepared statements
        let _ = use_unnamed_prepared_statements;

        // Ownership transferred into `ptr.connection`; disarm the errdefer so the
        // connect-fail `ptr.deref()` is the sole cleanup path from here on.
        let (secure, tls_config) = scopeguard::ScopeGuard::into_inner(tls_guard);

        let ptr: *mut JSMySQLConnection = Box::into_raw(Box::new(JSMySQLConnection {
            ref_count: Cell::new(1),
            js_value: JsRef::empty(),
            global_object,
            vm,
            poll_ref: KeepAlive::default(),
            connection: MySQLConnection::init(
                database,
                username,
                password,
                options,
                options_buf,
                tls_config,
                secure,
                ssl_mode,
            ),
            auto_flusher: AutoFlusher::default(),
            idle_timeout_interval_ms: u32::try_from(idle_timeout).unwrap(),
            connection_timeout_ms: u32::try_from(connection_timeout).unwrap(),
            max_lifetime_interval_ms: u32::try_from(max_lifetime).unwrap(),
            timer: EventLoopTimer {
                tag: EventLoopTimer::Tag::MySQLConnectionTimeout,
                next: timespec::EPOCH,
                ..Default::default()
            },
            max_lifetime_timer: EventLoopTimer {
                tag: EventLoopTimer::Tag::MySQLConnectionMaxLifetime,
                next: timespec::EPOCH,
                ..Default::default()
            },
        }));
        // SAFETY: ptr was just allocated and is non-null; we hold the only reference.
        let this = unsafe { &mut *ptr };

        {
            let hostname = hostname_str.to_utf8();

            // MySQL always opens plain TCP first; STARTTLS adopts into the TLS
            // group after the SSLRequest exchange.
            let group = vm.rare_data().mysql_group(vm, false);
            let result = if !path.is_empty() {
                SocketTCP::connect_unix_group(group, uws::DispatchKind::Mysql, None, path, ptr, false)
            } else {
                SocketTCP::connect_group(
                    group,
                    uws::DispatchKind::Mysql,
                    None,
                    hostname.slice(),
                    port,
                    ptr,
                    false,
                )
            };
            let socket = match result {
                Ok(s) => s,
                Err(e) => {
                    this.deref();
                    return global_object.throw_error(e, "failed to connect to mysql");
                }
            };
            this.connection.set_socket(AnySocket::SocketTCP(socket));
        }
        this.connection.status = mysql_connection::Status::Connecting;
        this.reset_connection_timeout();
        this.poll_ref.ref_(vm);
        let js_value = this.to_js(global_object);
        js_value.ensure_still_alive();
        this.js_value.set_strong(js_value, global_object);
        js::onconnect_set_cached(js_value, global_object, on_connect);
        js::onclose_set_cached(js_value, global_object, on_close);

        Ok(js_value)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_queries(
        _this: &Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if let Some(value) = js::queries_get_cached(this_value) {
            return Ok(value);
        }

        let array = JSValue::create_empty_array(global_object, 0)?;
        js::queries_set_cached(this_value, global_object, array);

        Ok(array)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.connection.status == mysql_connection::Status::Connected)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_connect(_this: &Self, this_value: JSValue, _: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onconnect_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_connect(
        _this: &mut Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        js::onconnect_set_cached(this_value, global_object, value);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_close(_this: &Self, this_value: JSValue, _: &JSGlobalObject) -> JSValue {
        if let Some(value) = js::onclose_get_cached(this_value) {
            return value;
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_close(
        _this: &mut Self,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        js::onclose_set_cached(this_value, global_object, value);
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.ref_(this.vm);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(this.vm);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_flush(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.register_auto_flusher();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_close(
        this: &mut Self,
        _global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        this.stop_timers();

        let _guard = scopeguard::guard((), |_| this.update_reference_type());
        // TODO(port): errdefer — guard captures &mut self; Phase B may need reshape
        this.connection
            .clean_queue_and_close(None, this.get_queries_array());
        Ok(JSValue::UNDEFINED)
    }

    fn consume_on_connect_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm.is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.try_get() {
            let on_connect = js::onconnect_get_cached(value)?;
            js::onconnect_set_cached(value, global_object, JSValue::ZERO);
            return Some(on_connect);
        }
        None
    }

    fn consume_on_close_callback(&self, global_object: &JSGlobalObject) -> Option<JSValue> {
        if self.vm.is_shutting_down() {
            return None;
        }
        if let Some(value) = self.js_value.try_get() {
            let on_close = js::onclose_get_cached(value)?;
            js::onclose_set_cached(value, global_object, JSValue::ZERO);
            return Some(on_close);
        }
        None
    }

    pub fn get_queries_array(&self) -> JSValue {
        if self.vm.is_shutting_down() {
            return JSValue::UNDEFINED;
        }
        if let Some(value) = self.js_value.try_get() {
            return js::queries_get_cached(value).unwrap_or(JSValue::UNDEFINED);
        }
        JSValue::UNDEFINED
    }

    #[inline]
    pub fn is_able_to_write(&self) -> bool {
        self.connection.is_able_to_write()
    }
    #[inline]
    pub fn is_connected(&self) -> bool {
        self.connection.status == mysql_connection::Status::Connected
    }
    #[inline]
    pub fn can_pipeline(&mut self) -> bool {
        self.connection.can_pipeline()
    }
    #[inline]
    pub fn can_prepare_query(&mut self) -> bool {
        self.connection.can_prepare_query()
    }
    #[inline]
    pub fn can_execute_query(&mut self) -> bool {
        self.connection.can_execute_query()
    }
    #[inline]
    pub fn get_writer(&mut self) -> NewWriter<mysql_connection::Writer> {
        self.connection.writer()
    }

    fn fail_fmt(&mut self, error_code: AnyMySQLErrorT, args: core::fmt::Arguments<'_>) {
        // bun.handleOom(std.fmt.allocPrint(...)) → write into Vec<u8>
        let mut message: Vec<u8> = Vec::new();
        {
            use std::io::Write;
            let _ = write!(&mut message, "{}", args);
        }

        let err = AnyMySQLError::mysql_error_to_js(self.global_object, &message, error_code);
        self.fail_with_js_value(err);
    }

    fn fail_with_js_value(&mut self, value: JSValue) {
        self.ref_();

        // TODO(port): errdefer — this guard runs the trailing cleanup on every exit path,
        // mirroring Zig `defer { ... }`. Captures &mut self; Phase B borrowck reshape likely.
        let _guard = scopeguard::guard((), |_| {
            if self.vm.is_shutting_down() {
                self.connection.close();
            } else {
                self.connection
                    .clean_queue_and_close(Some(value), self.get_queries_array());
            }
            self.update_reference_type();
            self.deref();
        });
        self.stop_timers();

        if self.connection.status == mysql_connection::Status::Failed {
            return;
        }

        self.connection.status = mysql_connection::Status::Failed;
        if self.vm.is_shutting_down() {
            return;
        }

        let Some(on_close) = self.consume_on_close_callback(self.global_object) else {
            return;
        };
        on_close.ensure_still_alive();
        let loop_ = self.vm.event_loop();
        // loop.enter();
        // defer loop.exit();
        self.ensure_js_value_is_alive();
        let mut js_error = value.to_error().unwrap_or(value);
        if js_error.is_empty() {
            js_error = AnyMySQLError::mysql_error_to_js(
                self.global_object,
                b"Connection closed",
                err!("ConnectionClosed"),
            );
        }
        js_error.ensure_still_alive();

        let queries_array = self.get_queries_array();
        queries_array.ensure_still_alive();
        // self.global_object.queue_microtask(on_close, &[js_error, queries_array]);
        loop_.run_callback(
            on_close,
            self.global_object,
            JSValue::UNDEFINED,
            &[js_error, queries_array],
        );
    }

    fn fail(&mut self, message: &[u8], err: AnyMySQLErrorT) {
        let instance = AnyMySQLError::mysql_error_to_js(self.global_object, message, err);
        self.fail_with_js_value(instance);
    }

    pub fn on_connection_estabilished(&mut self) {
        if self.vm.is_shutting_down() {
            return;
        }
        let Some(on_connect) = self.consume_on_connect_callback(self.global_object) else {
            return;
        };
        on_connect.ensure_still_alive();
        let js_value = self.js_value.try_get().unwrap_or(JSValue::UNDEFINED);
        js_value.ensure_still_alive();
        self.global_object
            .queue_microtask(on_connect, &[JSValue::NULL, js_value]);
    }

    pub fn on_query_result(&mut self, request: &mut JSMySQLQuery, result: MySQLQueryResult) {
        request.resolve(self.get_queries_array(), result);
    }

    pub fn on_result_row<C>(
        &mut self,
        request: &mut JSMySQLQuery,
        statement: &mut MySQLStatement,
        reader: NewReader<C>,
    ) -> Result<(), OnResultRowError> {
        let result_mode = request.get_result_mode();
        // PERF(port): was stack-fallback allocator (4096 bytes)
        let mut row = ResultSet::Row {
            global_object: self.global_object,
            columns: &statement.columns,
            binary: !request.is_simple(),
            raw: result_mode == ResultMode::Raw,
            bigint: request.is_bigint_supported(),
            ..Default::default()
        };
        let mut structure: JSValue = JSValue::UNDEFINED;
        let mut cached_structure: Option<CachedStructure> = None;
        match result_mode {
            ResultMode::Objects => {
                cached_structure = if let Some(value) = self.js_value.try_get() {
                    Some(statement.structure(value, self.global_object))
                } else {
                    None
                };
                structure = cached_structure
                    .as_ref()
                    .unwrap()
                    .js_value()
                    .unwrap_or(JSValue::UNDEFINED);
            }
            ResultMode::Raw | ResultMode::Values => {
                // no need to check for duplicate fields or structure
            }
        }
        // defer row.deinit(allocator) — Drop on ResultSet::Row
        if let Err(e) = row.decode(reader) {
            if e == err!("ShortRead") {
                return Err(OnResultRowError::ShortRead);
            }
            self.connection.queue.mark_current_request_as_finished(request);
            request.reject(self.get_queries_array(), e);
            return Ok(());
        }
        let pending_value = request.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        // Process row data
        let row_value = row
            .to_js(
                self.global_object,
                pending_value,
                structure,
                &statement.fields_flags,
                result_mode,
                cached_structure,
            )
            .map_err(|_| OnResultRowError::JSError)?;
        if let Some(err) = self.global_object.try_take_exception() {
            self.connection.queue.mark_current_request_as_finished(request);
            request.reject_with_js_value(self.get_queries_array(), err);
            return Ok(());
        }
        statement.result_count += 1;

        if pending_value.is_empty_or_undefined_or_null() {
            request.set_pending_value(row_value);
        }
        Ok(())
    }

    pub fn on_error(&mut self, request: Option<&mut JSMySQLQuery>, err: AnyMySQLErrorT) {
        if let Some(request) = request {
            if self.vm.is_shutting_down() {
                request.mark_as_failed();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                request.reject_with_js_value(self.get_queries_array(), err_);
            } else {
                request.reject(self.get_queries_array(), err);
            }
        } else {
            if self.vm.is_shutting_down() {
                self.close();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail(b"Connection closed", err);
            }
        }
    }

    pub fn on_error_packet(&mut self, request: Option<&mut JSMySQLQuery>, err: ErrorPacket) {
        if let Some(request) = request {
            if self.vm.is_shutting_down() {
                request.mark_as_failed();
            } else {
                if let Some(err_) = self.global_object.try_take_exception() {
                    request.reject_with_js_value(self.get_queries_array(), err_);
                } else {
                    request
                        .reject_with_js_value(self.get_queries_array(), err.to_js(self.global_object));
                }
            }
        } else {
            if self.vm.is_shutting_down() {
                self.close();
                return;
            }
            if let Some(err_) = self.global_object.try_take_exception() {
                self.fail_with_js_value(err_);
            } else {
                self.fail_with_js_value(err.to_js(self.global_object));
            }
        }
    }

    pub fn get_statement_from_signature_hash(
        &mut self,
        signature_hash: u64,
    ) -> Result<mysql_connection::PreparedStatementsMapGetOrPutResult, bun_core::Error> {
        // TODO(port): narrow error set
        self.connection.statements.get_or_put(signature_hash)
    }
}

/// Referenced by `dispatch.zig` (kind = `.mysql[_tls]`).
pub struct SocketHandler<const SSL: bool>;

impl<const SSL: bool> SocketHandler<SSL> {
    pub type SocketType = NewSocketHandler<SSL>;

    fn _socket(s: Self::SocketType) -> AnySocket {
        if SSL {
            return AnySocket::SocketTLS(s);
        }
        AnySocket::SocketTCP(s)
    }

    pub fn on_open(this: &mut JSMySQLConnection, s: Self::SocketType) {
        let socket = Self::_socket(s);
        this.connection.set_socket(socket);

        if matches!(socket, AnySocket::SocketTCP(_)) {
            // This handshake is not TLS handleshake is actually the MySQL handshake
            // When a connection is upgraded to TLS, the onOpen callback is called again and at this moment we dont wanna to change the status to handshaking
            this.connection.status = mysql_connection::Status::Handshaking;
            this.ref_(); // keep a ref for the socket
        }
        // Only set up the timers after all status changes are complete — the timers rely on the status to determine timeouts.
        this.setup_max_lifetime_timer_if_necessary();
        this.reset_connection_timeout();
        this.update_reference_type();
    }

    fn on_handshake_<S>(
        this: &mut JSMySQLConnection,
        _: S,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) {
        let handshake_was_successful = match this.connection.do_handshake(success, ssl_error) {
            Ok(v) => v,
            Err(e) => {
                return this.fail_fmt(e, format_args!("Failed to send handshake response"));
            }
        };
        if !handshake_was_successful {
            let Ok(v) = ssl_error.to_js(this.global_object) else {
                return;
            };
            this.fail_with_js_value(v);
        }
    }

    // pub const onHandshake = if (ssl) onHandshake_ else null;
    // TODO(port): conditional associated const on const-generic bool — Phase B wires this
    // via the dispatch table (only register on_handshake when SSL == true).

    pub fn on_close(this: &mut JSMySQLConnection, _: Self::SocketType, _: i32, _: Option<*mut c_void>) {
        let _guard = scopeguard::guard((), |_| this.deref());
        this.fail(b"Connection closed", err!("ConnectionClosed"));
    }

    pub fn on_end(_: &mut JSMySQLConnection, socket: Self::SocketType) {
        // no half closed sockets
        socket.close(uws::CloseReason::Normal);
    }

    pub fn on_connect_error(this: &mut JSMySQLConnection, _: Self::SocketType, _: i32) {
        // TODO: proper propagation of the error
        this.fail(b"Connection closed", err!("ConnectionClosed"));
    }

    pub fn on_timeout(this: &mut JSMySQLConnection, _: Self::SocketType) {
        this.fail(b"Connection timeout", err!("ConnectionTimedOut"));
    }

    pub fn on_data(this: &mut JSMySQLConnection, _: Self::SocketType, data: &[u8]) {
        this.ref_();
        let _ref_guard = scopeguard::guard((), |_| this.deref());
        let vm = this.vm;

        // TODO(port): errdefer — guard captures &mut this; Phase B may need reshape
        let _tail_guard = scopeguard::guard((), |_| {
            // reset the connection timeout after we're done processing the data
            this.reset_connection_timeout();
            this.update_reference_type();
            this.register_auto_flusher();
        });
        if this.vm.is_shutting_down() {
            // we are shutting down lets not process the data
            return;
        }

        let event_loop = vm.event_loop();
        event_loop.enter();
        let _loop_guard = scopeguard::guard((), |_| event_loop.exit());
        this.ensure_js_value_is_alive();

        if let Err(e) = this.connection.read_and_process_data(data) {
            this.on_error(None, e);
        }
    }

    pub fn on_writable(this: &mut JSMySQLConnection, _: Self::SocketType) {
        this.connection.reset_backpressure();
        this.drain_internal();
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum OnResultRowError {
    #[error("ShortRead")]
    ShortRead,
    #[error("JSError")]
    JSError,
}
impl From<OnResultRowError> for bun_core::Error {
    fn from(e: OnResultRowError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

// TODO(port): ResultMode enum lives in JSMySQLQuery / shared — placeholder import.
use super::js_mysql_query::ResultMode;

// pub const js = jsc.Codegen.JSMySQLConnection; — re-exported via `use ... as js` above.
// fromJS / fromJSDirect / toJS — provided by #[bun_jsc::JsClass] derive.

pub type Writer = mysql_connection::Writer;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/JSMySQLConnection.zig (801 lines)
//   confidence: medium
//   todos:      9
//   notes:      scopeguard closures capture &mut self (borrowck reshape needed); SocketHandler conditional onHandshake unresolved; global_object JSC_BORROW lifetime deferred
// ──────────────────────────────────────────────────────────────────────────
