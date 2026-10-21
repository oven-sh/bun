use core::cell::Cell;
use core::ptr::NonNull;

use crate::jsc::codegen::js_mysql_query as js;
use crate::jsc::{
    CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, MarkedArgumentBuffer, VirtualMachine,
    VirtualMachineSqlExt as _, bun_string_jsc,
};
use crate::shared::cached_structure::Undescribed;
use crate::shared::query_ctor_args::QueryCtorArgs;
use bun_jsc::JsCell;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef, RefPtr};
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError};
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use super::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
// The struct, and the `declare_scope!` static of the same name that `debug!` below logs to.
use super::my_sql_query::MySQLQuery;
use super::my_sql_statement::{MySQLStatement, describe};

bun_core::define_scoped_log!(debug, MySQLQuery);

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct JSMySQLQuery {
    this_value: JsCell<JsRef>,
    ref_count: Cell<u32>,
    global_object: BackRef<JSGlobalObject>,
    query: JsCell<MySQLQuery>,
    undescribed: JsCell<Undescribed<Vec<ColumnDefinition41>>>,
}

impl JSMySQLQuery {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    pub fn finalize(&self) {
        debug!("MySQLQuery finalize");
        self.this_value.with_mut(|v| v.finalize());
    }

    // Reached from JS via `put_host_functions!` in `mysql.rs`.
    pub(crate) fn create_instance(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let QueryCtorArgs {
            query,
            values,
            pending_value,
            bigint,
            simple,
        } = QueryCtorArgs::parse(global_this, callframe.arguments())?;

        let this_ptr = bun_core::heap::into_raw(Box::new(Self {
            this_value: JsCell::new(JsRef::empty()),
            ref_count: Cell::new(1),
            global_object: BackRef::new(global_this),
            query: JsCell::new(MySQLQuery::init(
                query.to_bun_string(global_this)?,
                bigint,
                simple,
            )),
            undescribed: JsCell::new(Undescribed::default()),
        }));
        let this = ParentRef::from(NonNull::new(this_ptr).expect("heap::into_raw non-null"));

        let this_value = js::to_js(this_ptr, global_this);
        this_value.ensure_still_alive();
        this.this_value.with_mut(|v| v.set_weak(this_value));

        js::binding_set_cached(this_value, global_this, values);
        js::pending_value_set_cached(this_value, global_this, pending_value);

        Ok(this_value)
    }

    pub fn do_run(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        debug!("doRun");
        let _guard = this.ref_guard();

        let arguments = callframe.arguments();
        if arguments.len() < 2 {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "run must be called with 2 arguments connection and target"
            )));
        }
        let Some(connection) = arguments[0].as_class_ref::<MySQLConnection>() else {
            return Err(global_object.throw(format_args!("connection must be a MySQLConnection")));
        };
        let target = arguments[1];
        if !target.is_object() {
            return Err(global_object.throw_invalid_argument_type("run", "query", "Query"));
        }
        // A connection that failed or closed answers nothing: a query queued on it would hold the
        // event loop for ever. The pool hears of a close through `onclose` and stops handing the
        // connection out, except a disposed `Bun.ModuleGraph`'s, which is told nothing.
        if !connection.is_active() {
            return Err(global_object.throw_value(mysql_error_to_js(
                global_object,
                Some(b"Connection closed"),
                AnyMySQLError::Error::ConnectionClosed,
            )));
        }
        if this.is_completed() {
            return Ok(JSValue::UNDEFINED);
        }
        js::target_set_cached(callframe.this(), global_object, target);
        // Until it ends: the wrapper holds the target, the parameters and the rows.
        this.this_value.with_mut(|v| v.upgrade(global_object));
        connection.enqueue_request(this.ref_guard());
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_cancel(
        this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let _entered = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
        // The queue drops a request that ended when it gets to it.
        this.reject_when(
            MySQLQuery::cancel,
            this.error_to_js(AnyMySQLError::Error::QueryCancelled),
        );
        Ok(JSValue::UNDEFINED)
    }

    pub fn set_mode_from_js(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let js_mode = callframe.argument(0);
        if js_mode.is_empty_or_undefined_or_null() || !js_mode.is_number() {
            return Err(global_object.throw_invalid_argument_type("setMode", "mode", "Number"));
        }

        let mode_value = js_mode.coerce::<i32>(global_object)?;
        let mode = match mode_value {
            0 => SQLQueryResultMode::Objects,
            1 => SQLQueryResultMode::Values,
            2 => SQLQueryResultMode::Raw,
            _ => {
                return Err(
                    global_object.throw_invalid_argument_type_value(b"mode", b"Number", js_mode)
                );
            }
        };
        this.query.with_mut(|q| q.set_result_mode(mode));
        Ok(JSValue::UNDEFINED)
    }

    pub fn set_pending_value_from_js(
        this: &Self,
        _global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = callframe.argument(0);
        this.set_pending_value(result);
        Ok(JSValue::UNDEFINED)
    }

    fn last_insert_id_to_js(&self, value: u64) -> JsResult<JSValue> {
        if value <= bun_jsc::MAX_SAFE_INTEGER as u64 {
            return Ok(JSValue::js_number_from_uint64(value));
        }
        if self.is_bigint_supported() {
            return JSValue::from_uint64_no_truncate(self.global_object(), value);
        }
        let mut buffer = bun_core::fmt::ItoaBuf::new();
        bun_string_jsc::create_utf8_for_js(
            self.global_object(),
            bun_core::fmt::itoa(&mut buffer, value),
        )
    }

    /// `result.statement`, or the number that `describe_result` makes it for.
    fn description(&self, has_columns: bool) -> JsResult<JSValue> {
        let query = self.query.get();
        match query.get_statement() {
            Some(_) if query.is_discarding_response() => Ok(JSValue::NULL),
            Some(statement) if statement.statement_id > 0 => {
                statement.description(self.global_object(), query.text(), has_columns)
            }
            Some(statement) => Ok(self
                .undescribed
                .with_mut(|results| results.push(statement.take_columns(has_columns)))),
            None => Ok(JSValue::NULL),
        }
    }

    pub fn describe_result(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        match this
            .undescribed
            .with_mut(|results| results.take(callframe.argument(0)))
        {
            Some(columns) => describe(global_object, this.query.get().text(), &[], &columns),
            None => Ok(JSValue::NULL),
        }
    }

    pub(crate) fn resolve(&self, result: &MySQLQueryResult) {
        let _guard = self.ref_guard();
        let is_last_result = result.is_last_result;
        let _downgrade = is_last_result.then(|| DowngradeOnDrop(self));
        // Rejected here; `result()` below has nothing to deliver and ends it at its last result.
        let reject = |err| {
            self.reject_when(
                MySQLQuery::discard_response,
                self.global_object().take_exception(err),
            );
            JSValue::UNDEFINED
        };
        let last_insert_id = self
            .last_insert_id_to_js(result.last_insert_id)
            .unwrap_or_else(reject);
        // `result()` lets go of the statement at the last result.
        let statement = self.description(result.has_columns).unwrap_or_else(reject);

        if !self.query.with_mut(|q| q.result(is_last_result)) {
            return;
        }

        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        this_value.ensure_still_alive();
        let Some(target_value) = js::target_get_cached(this_value) else {
            return;
        };
        let vm = VirtualMachine::get_mut();
        let Some(function) = vm.sql_state().mysql_context.on_query_resolve_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryResolveFn is not callable");

        let pending_value = self.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        pending_value.ensure_still_alive();
        self.set_pending_value(JSValue::UNDEFINED);

        vm.event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            function,
            self.global_object(),
            this_value,
            &[
                target_value,
                pending_value,
                JSValue::js_number(result.result_count as f64),
                JSValue::js_boolean(is_last_result),
                last_insert_id,
                JSValue::js_number(result.affected_rows as f64),
                statement,
            ],
        );
    }

    pub(crate) fn mark_as_failed(&self) {
        // Attention: we cannot touch JS here
        // If you need to touch JS, you wanna to use reject or reject_with_js_value instead
        let _guard = self.ref_guard();
        if self.this_value.get().is_not_empty() {
            self.this_value.with_mut(|v| v.downgrade());
        }
        let _ = self.query.with_mut(|q| q.fail());
    }

    pub(crate) fn reject(&self, err: AnyMySQLError::Error) {
        self.reject_with_js_value(self.error_to_js(err));
    }

    /// The client cannot decode a row of this query's result. Reject the query
    /// now, but leave it in flight (`MySQLQuery::discard_response`): the
    /// connection keeps it at the queue head and skips the rest of its
    /// response.
    pub(crate) fn reject_undecodable_row(&self, err: AnyMySQLError::Error) {
        self.reject_when(MySQLQuery::discard_response, self.error_to_js(err));
    }

    pub(crate) fn reject_with_js_value(&self, err: JSValue) {
        self.reject_when(MySQLQuery::fail, err);
    }

    fn error_to_js(&self, err: AnyMySQLError::Error) -> JSValue {
        if let Some(err_) = self.global_object().try_take_exception() {
            return err_;
        }
        let instance = mysql_error_to_js(self.global_object(), None, err);
        instance.ensure_still_alive();
        instance
    }

    /// `transition` moves the query to its rejected state, and returns whether
    /// a rejection is still to be delivered to JS.
    fn reject_when(&self, transition: fn(&mut MySQLQuery) -> bool, err: JSValue) {
        let _guard = self.ref_guard();

        if !self.query.with_mut(transition) {
            return;
        }
        let _downgrade = DowngradeOnDrop(self);

        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let Some(target_value) = js::target_get_cached(this_value) else {
            return;
        };

        let mut js_error = err.to_error().unwrap_or(err);
        if js_error.is_empty() {
            js_error = mysql_error_to_js(
                self.global_object(),
                Some(b"Query failed"),
                AnyMySQLError::Error::UnknownError,
            );
        }
        debug_assert!(!js_error.is_empty(), "js_error is zero");
        js_error.ensure_still_alive();
        let vm = VirtualMachine::get_mut();
        let Some(function) = vm.sql_state().mysql_context.on_query_reject_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryRejectFn is not callable");
        vm.event_loop_mut().run_callback(
            bun_event_loop::ContextId::NONE,
            function,
            self.global_object(),
            this_value,
            &[target_value, js_error],
        );
    }

    pub(crate) fn run(&self, connection: &MySQLConnection) -> Result<(), AnyMySQLError::Error> {
        if self.query.with_mut(|q| q.start(connection))? {
            return Ok(());
        }
        let this_value = self.this_value.get().try_get();
        let binding_value = this_value
            .and_then(js::binding_get_cached)
            .unwrap_or(JSValue::UNDEFINED);
        // `params` is on the malloc heap: `roots` keeps the buffers in it alive.
        MarkedArgumentBuffer::new(|roots| {
            let params = MySQLQuery::bind(self.global_object(), binding_value, roots)?;
            self.query.with_mut(|q| q.execute(connection, &params))
        })
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        self.query.get().is_completed()
    }
    #[inline]
    pub(crate) fn is_in_flight(&self) -> bool {
        self.query.get().is_in_flight()
    }
    #[inline]
    pub(crate) fn can_be_followed(&self) -> bool {
        self.query.get().can_be_followed()
    }
    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.query.get().is_pending()
    }
    #[inline]
    pub(crate) fn prepared(&self) {
        self.query.with_mut(|q| q.prepared());
    }
    #[inline]
    pub(crate) fn is_discarding_response(&self) -> bool {
        self.query.get().is_discarding_response()
    }
    #[inline]
    pub(crate) fn is_simple(&self) -> bool {
        self.query.get().is_simple()
    }
    #[inline]
    pub(crate) fn is_bigint_supported(&self) -> bool {
        self.query.get().is_bigint_supported()
    }
    #[inline]
    pub(crate) fn get_result_mode(&self) -> SQLQueryResultMode {
        self.query.get().get_result_mode()
    }
    // TODO: isolate statement modification away from the connection
    pub(crate) fn get_statement(&self) -> Option<&mut MySQLStatement> {
        self.query.get().get_statement()
    }

    pub(crate) fn statement_ref(&self) -> Option<RefPtr<MySQLStatement>> {
        self.query.get().statement_ref()
    }

    #[inline]
    pub(crate) fn set_pending_value(&self, result: JSValue) {
        if let Some(value) = self.this_value.get().try_get() {
            js::pending_value_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    pub(crate) fn get_pending_value(&self) -> Option<JSValue> {
        if let Some(value) = self.this_value.get().try_get() {
            return js::pending_value_get_cached(value);
        }
        None
    }

    #[inline]
    fn global_object(&self) -> &JSGlobalObject {
        self.global_object.get()
    }
}

struct DowngradeOnDrop<'a>(&'a JSMySQLQuery);

impl Drop for DowngradeOnDrop<'_> {
    fn drop(&mut self) {
        if self.0.this_value.get().is_not_empty() {
            self.0.this_value.with_mut(|v| v.downgrade());
        }
    }
}
