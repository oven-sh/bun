use core::cell::Cell;
use core::ptr::NonNull;

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, VirtualMachine};
use bun_jsc::codegen::js_mysql_query as js;
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError};
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::postgres::command_tag::CommandTag;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use super::js_mysql_connection::MySQLConnection;
use super::mysql_query::MySQLQuery;
use super::mysql_statement::MySQLStatement;

bun_output::declare_scope!(MySQLQuery, visible);

macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(MySQLQuery, $($arg)*) };
}

#[bun_jsc::JsClass]
pub struct JSMySQLQuery {
    this_value: JsRef,
    // unfortunately we cannot use #ref_count here
    ref_count: Cell<u32>,
    // TODO(port): lifetime — heap-stored borrow of VM/global (JSC_BORROW on m_ctx payload)
    vm: NonNull<VirtualMachine>,
    global_object: NonNull<JSGlobalObject>,
    query: MySQLQuery,
}

// Intrusive refcount (bun.ptr.RefCount): ref/deref drive deinit when count hits 0.
impl JSMySQLQuery {
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }

    pub fn deref(&mut self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: self was allocated via Box::into_raw in create_instance; count hit 0.
            unsafe { Self::deinit(self as *mut Self) };
        }
    }
}

impl JSMySQLQuery {
    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    #[bun_jsc::host_fn]
    pub fn constructor(
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        global_this.throw_invalid_arguments("MySQLQuery cannot be constructed directly", &[])
    }

    unsafe fn deinit(this: *mut Self) {
        // SAFETY: called once when ref_count reaches 0; `this` came from Box::into_raw.
        unsafe {
            (*this).query.cleanup();
            drop(Box::from_raw(this));
        }
    }

    pub fn finalize(this: *mut Self) {
        debug!("MySQLQuery finalize");

        // SAFETY: finalize runs on the mutator thread during lazy sweep; `this` is valid.
        unsafe {
            (*this).this_value.finalize();
            (*this).deref();
        }
    }

    #[bun_jsc::host_fn]
    pub fn create_instance(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global_this.bun_vm(), arguments);
        // defer args.deinit() — handled by Drop
        let Some(query) = args.next_eat() else {
            return global_this.throw("query must be a string", &[]);
        };
        let Some(values) = args.next_eat() else {
            return global_this.throw("values must be an array", &[]);
        };

        if !query.is_string() {
            return global_this.throw("query must be a string", &[]);
        }

        if values.js_type() != bun_jsc::JSType::Array {
            return global_this.throw("values must be an array", &[]);
        }

        let pending_value: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let columns: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let js_bigint: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);
        let js_simple: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);

        let bigint = js_bigint.is_boolean() && js_bigint.as_boolean();
        let simple = js_simple.is_boolean() && js_simple.as_boolean();
        if simple {
            if values.get_length(global_this)? > 0 {
                return global_this
                    .throw_invalid_arguments("simple query cannot have parameters", &[]);
            }
            if query.get_length(global_this)? >= i32::MAX as usize {
                return global_this.throw_invalid_arguments("query is too long", &[]);
            }
        }
        if !pending_value.js_type().is_array_like() {
            return global_this.throw_invalid_argument_type("query", "pendingValue", "Array");
        }

        let this = Box::into_raw(Box::new(Self {
            this_value: JsRef::empty(),
            ref_count: Cell::new(1),
            vm: NonNull::from(global_this.bun_vm()),
            global_object: NonNull::from(global_this),
            query: MySQLQuery::init(query.to_bun_string(global_this)?, bigint, simple),
        }));
        // SAFETY: just allocated; uniquely owned here until handed to the JS wrapper.
        let this = unsafe { &mut *this };

        let this_value = this.to_js(global_this);
        this_value.ensure_still_alive();
        this.this_value.set_weak(this_value);

        this.set_binding(values);
        this.set_pending_value(pending_value);
        if !columns.is_undefined() {
            this.set_columns(columns);
        }

        Ok(this_value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_run(
        this: &mut Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        debug!("doRun");
        this.ref_();
        let _guard = scopeguard::guard(this as *mut Self, |p| {
            // SAFETY: `p` points to `*this`, which outlives this scope (m_ctx payload).
            unsafe { (*p).deref() };
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through guard pointer.
        // SAFETY: guard holds the only raw alias; no concurrent access.
        let this = unsafe { &mut **_guard };

        let arguments = callframe.arguments();
        if arguments.len() < 2 {
            return global_object.throw_invalid_arguments(
                "run must be called with 2 arguments connection and target",
                &[],
            );
        }
        let Some(connection) = arguments[0].as_::<MySQLConnection>() else {
            return global_object.throw("connection must be a MySQLConnection", &[]);
        };
        let target = arguments[1];
        if !target.is_object() {
            return global_object.throw_invalid_argument_type("run", "query", "Query");
        }
        this.set_target(target);
        if let Err(err) = this.run(connection) {
            if !global_object.has_exception() {
                return global_object.throw_value(AnyMySQLError::mysql_error_to_js(
                    global_object,
                    "failed to execute query",
                    err,
                ));
            }
            return Err(bun_jsc::JsError::Thrown);
        }
        connection.enqueue_request(this);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_cancel(
        _this: &mut Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO: we can cancel a query that is pending aka not pipelined yet we just need fail it
        // if is running is not worth/viable to cancel the whole connection
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_done(
        _this: &mut Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO: investigate why this function is needed
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_mode_from_js(
        this: &mut Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let js_mode = callframe.argument(0);
        if js_mode.is_empty_or_undefined_or_null() || !js_mode.is_number() {
            return global_object.throw_invalid_argument_type("setMode", "mode", "Number");
        }

        let mode_value = js_mode.coerce::<i32>(global_object)?;
        let Ok(mode) = SQLQueryResultMode::try_from(mode_value) else {
            return global_object.throw_invalid_argument_type_value("mode", "Number", js_mode);
        };
        this.query.set_result_mode(mode);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_pending_value_from_js(
        this: &mut Self,
        _global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = callframe.argument(0);
        this.set_pending_value(result);
        Ok(JSValue::UNDEFINED)
    }

    pub fn resolve(&mut self, queries_array: JSValue, result: MySQLQueryResult) {
        self.ref_();
        let is_last_result = result.is_last_result;
        let _guard = scopeguard::guard(self as *mut Self, move |p| {
            // SAFETY: `p` points to `*self`; defer runs at scope exit on the same thread.
            unsafe {
                if (*p).this_value.is_not_empty() && is_last_result {
                    (*p).this_value.downgrade();
                }
                (*p).deref();
            }
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through guard pointer.
        // SAFETY: see above.
        let this = unsafe { &mut **_guard };

        if !this.query.result(is_last_result) {
            return;
        }
        if this.vm().is_shutting_down() {
            return;
        }

        let Some(target_value) = this.get_target() else { return };
        let Some(this_value) = this.this_value.try_get() else { return };
        this_value.ensure_still_alive();
        let tag = CommandTag::Select(result.result_count);
        let Ok(js_tag) = tag.to_js_tag(this.global_object()) else {
            debug_assert!(false, "in MySQLQuery Tag should always be a number");
            return;
        };
        js_tag.ensure_still_alive();

        let Some(function) = this.vm().rare_data().mysql_context.on_query_resolve_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryResolveFn is not callable");

        let event_loop = this.vm().event_loop();

        let pending_value = this.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        pending_value.ensure_still_alive();
        this.set_pending_value(JSValue::UNDEFINED);

        event_loop.run_callback(
            function,
            this.global_object(),
            this_value,
            &[
                target_value,
                pending_value,
                js_tag,
                tag.to_js_number(),
                if queries_array.is_empty() { JSValue::UNDEFINED } else { queries_array },
                JSValue::from(is_last_result),
                JSValue::js_number(result.last_insert_id),
                JSValue::js_number(result.affected_rows),
            ],
        );
    }

    pub fn mark_as_failed(&mut self) {
        // Attention: we cannot touch JS here
        // If you need to touch JS, you wanna to use reject or reject_with_js_value instead
        self.ref_();
        let _guard = scopeguard::guard(self as *mut Self, |p| {
            // SAFETY: `p` aliases `*self` for the duration of this scope only.
            unsafe { (*p).deref() };
        });
        // SAFETY: see above.
        let this = unsafe { &mut **_guard };
        if this.this_value.is_not_empty() {
            this.this_value.downgrade();
        }
        let _ = this.query.fail();
    }

    pub fn reject(&mut self, queries_array: JSValue, err: AnyMySQLError::Error) {
        if self.vm().is_shutting_down() {
            self.mark_as_failed();
            return;
        }
        if let Some(err_) = self.global_object().try_take_exception() {
            self.reject_with_js_value(queries_array, err_);
        } else {
            let instance = AnyMySQLError::mysql_error_to_js(
                self.global_object(),
                "Failed to bind query",
                err,
            );
            instance.ensure_still_alive();
            self.reject_with_js_value(queries_array, instance);
        }
    }

    pub fn reject_with_js_value(&mut self, queries_array: JSValue, err: JSValue) {
        self.ref_();

        let _guard = scopeguard::guard(self as *mut Self, |p| {
            // SAFETY: `p` aliases `*self` for the duration of this scope only.
            unsafe {
                if (*p).this_value.is_not_empty() {
                    (*p).this_value.downgrade();
                }
                (*p).deref();
            }
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through guard pointer.
        // SAFETY: see above.
        let this = unsafe { &mut **_guard };

        if !this.query.fail() {
            return;
        }

        if this.vm().is_shutting_down() {
            return;
        }
        let Some(target_value) = this.get_target() else { return };

        let mut js_error = err.to_error().unwrap_or(err);
        if js_error.is_empty() {
            js_error = AnyMySQLError::mysql_error_to_js(
                this.global_object(),
                "Query failed",
                AnyMySQLError::Error::UnknownError,
            );
        }
        debug_assert!(!js_error.is_empty(), "js_error is zero");
        js_error.ensure_still_alive();
        let Some(function) = this.vm().rare_data().mysql_context.on_query_reject_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryRejectFn is not callable");
        let event_loop = this.vm().event_loop();
        let js_array = if queries_array.is_empty() { JSValue::UNDEFINED } else { queries_array };
        js_array.ensure_still_alive();
        let Some(this_value) = this.this_value.try_get() else { return };
        event_loop.run_callback(
            function,
            this.global_object(),
            this_value,
            &[target_value, js_error, js_array],
        );
    }

    pub fn run(&mut self, connection: &mut MySQLConnection) -> Result<(), AnyMySQLError::Error> {
        if self.vm().is_shutting_down() {
            debug!("run cannot run a query if the VM is shutting down");
            // cannot run a query if the VM is shutting down
            return Ok(());
        }
        if !self.query.is_pending() || self.query.is_being_prepared() {
            debug!("run already running or being prepared");
            // already running or completed
            return Ok(());
        }
        let global_object = self.global_object();
        self.this_value.upgrade(global_object);
        let errguard = scopeguard::guard(self as *mut Self, |p| {
            // SAFETY: errdefer rollback; `p` valid for this scope.
            unsafe {
                (*p).this_value.downgrade();
                let _ = (*p).query.fail();
            }
        });
        // PORT NOTE: reshaped for borrowck — re-borrow through guard pointer.
        // SAFETY: see above.
        let this = unsafe { &mut **errguard };

        let columns_value = this.get_columns().unwrap_or(JSValue::UNDEFINED);
        let binding_value = this.get_binding().unwrap_or(JSValue::UNDEFINED);
        if let Err(err) =
            this.query
                .run_query(connection, global_object, columns_value, binding_value)
        {
            debug!("run failed to execute query");
            if !global_object.has_exception() {
                return global_object.throw_value(AnyMySQLError::mysql_error_to_js(
                    global_object,
                    "failed to execute query",
                    err,
                ));
            }
            return Err(AnyMySQLError::Error::JSError);
        }
        // disarm errdefer on success
        scopeguard::ScopeGuard::into_inner(errguard);
        Ok(())
    }

    #[inline]
    pub fn is_completed(&self) -> bool {
        self.query.is_completed()
    }
    #[inline]
    pub fn is_running(&self) -> bool {
        self.query.is_running()
    }
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.query.is_pending()
    }
    #[inline]
    pub fn is_being_prepared(&self) -> bool {
        self.query.is_being_prepared()
    }
    #[inline]
    pub fn is_pipelined(&self) -> bool {
        self.query.is_pipelined()
    }
    #[inline]
    pub fn is_simple(&self) -> bool {
        self.query.is_simple()
    }
    #[inline]
    pub fn is_bigint_supported(&self) -> bool {
        self.query.is_bigint_supported()
    }
    #[inline]
    pub fn get_result_mode(&self) -> SQLQueryResultMode {
        self.query.get_result_mode()
    }
    // TODO: isolate statement modification away from the connection
    pub fn get_statement(&mut self) -> Option<&mut MySQLStatement> {
        self.query.get_statement()
    }

    pub fn mark_as_prepared(&mut self) {
        self.query.mark_as_prepared();
    }

    #[inline]
    pub fn set_pending_value(&mut self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.try_get() {
            js::pending_value_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    pub fn get_pending_value(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.try_get() {
            return js::pending_value_get_cached(value);
        }
        None
    }

    #[inline]
    fn set_target(&mut self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.try_get() {
            js::target_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_target(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.try_get() {
            return js::target_get_cached(value);
        }
        None
    }

    #[inline]
    fn set_columns(&mut self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.try_get() {
            js::columns_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_columns(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.try_get() {
            return js::columns_get_cached(value);
        }
        None
    }
    #[inline]
    fn set_binding(&mut self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.try_get() {
            js::binding_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_binding(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.try_get() {
            return js::binding_get_cached(value);
        }
        None
    }

    // Helpers for stored raw pointers.
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        // SAFETY: vm outlives every JSMySQLQuery (owned by the runtime).
        unsafe { self.vm.as_ref() }
    }
    #[inline]
    fn global_object(&self) -> &JSGlobalObject {
        // SAFETY: global outlives every JSMySQLQuery (owned by the VM).
        unsafe { self.global_object.as_ref() }
    }
}

// TODO(port): @export(&jsc.toJSHostFn(createInstance), .{ .name = "MySQLQuery__createInstance" })
// — the #[bun_jsc::host_fn] macro on `create_instance` should emit this with
// #[unsafe(no_mangle)] under the name "MySQLQuery__createInstance"; verify codegen wiring.

pub use js::{from_js, from_js_direct, to_js};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/JSMySQLQuery.zig (402 lines)
//   confidence: medium
//   todos:      2
//   notes:      intrusive RefCount + defer/errdefer modeled via scopeguard over *mut Self; vm/global stored as NonNull (no LIFETIMES.tsv rows); verify host_fn export name for create_instance
// ──────────────────────────────────────────────────────────────────────────
