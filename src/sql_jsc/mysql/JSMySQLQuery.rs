use core::cell::Cell;

use crate::generated_bindgen::js_my_sql_query::js_MySQLQuery as js;
use crate::jsc::{
    JSArrayIterator, JSGlobalObject, JSValue, JsRef, JsResult, MarkedArgumentBuffer,
    VirtualMachine, VirtualMachineSqlExt as _, bun_string_jsc, js_error_to_mysql,
};
use crate::shared::cached_structure::Undescribed;
use crate::shared::query_ctor_args;
use bun_core::strings;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsCell};
use bun_ptr::{AsCtxPtr, BackRef, RefPtr};
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError};
use bun_sql::mysql::protocol::column_definition41::ColumnDefinition41;
use bun_sql::mysql::protocol::prepared_statement::{Execute, set_statement_id};
use bun_sql::mysql::session::Command;
use bun_sql::mysql::{MySQLQueryResult, mysql_request};
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use super::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use super::my_sql_statement::{MySQLStatement, describe};
use super::my_sql_value::Value;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;

bun_core::define_scoped_log!(debug, MySQLQuery, visible);

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct JSMySQLQuery {
    this_value: JsCell<JsRef>,
    ref_count: Cell<u32>,
    global_object: BackRef<JSGlobalObject>,
    query: bun_core::String,
    state: JsCell<State>,
    pub(crate) bigint: bool,
    pub(crate) simple: bool,
    pub(crate) result_mode: Cell<SQLQueryResultMode>,
    undescribed: JsCell<Undescribed<Vec<ColumnDefinition41>>>,
}

/// `rejected`: JS has its answer. The rest of the server's is read and dropped.
enum State {
    New,
    Queued,
    /// Its parameters are being read.
    Binding,
    Preparing {
        statement: RefPtr<MySQLStatement>,
        execute: Vec<u8>,
        rejected: bool,
    },
    Prepared {
        statement: RefPtr<MySQLStatement>,
        execute: Vec<u8>,
    },
    Running {
        statement: RefPtr<MySQLStatement>,
        rejected: bool,
        /// KILL QUERY between two of them ends the text silently, after a further result was promised.
        several_statements: bool,
    },
    Done,
}

/// Each returns whether the caller has something to deliver.
impl State {
    fn result(&mut self, is_last_result: bool) -> bool {
        let State::Running { rejected, .. } = *self else {
            return false;
        };
        if is_last_result {
            *self = State::Done;
        }
        !rejected
    }

    fn fail(&mut self) -> bool {
        match core::mem::replace(self, State::Done) {
            State::New | State::Queued | State::Binding | State::Prepared { .. } => true,
            State::Preparing { rejected, .. } | State::Running { rejected, .. } => !rejected,
            State::Done => false,
        }
    }

    /// Stays in flight: the rest of the response would go to the next request.
    fn discard_response(&mut self) -> bool {
        match self {
            State::Preparing { rejected, .. } | State::Running { rejected, .. } => {
                !core::mem::replace(rejected, true)
            }
            _ => self.fail(),
        }
    }

    /// The server runs a query that it has to its end: only an unwritten one is cancelled.
    fn cancel(&mut self) -> bool {
        !matches!(self, State::Running { .. }) && self.discard_response()
    }
}

impl JSMySQLQuery {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    // The generator counts the struct itself.
    pub(crate) fn estimated_size(&self) -> usize {
        0
    }

    pub fn finalize(&self) {
        debug!("MySQLQuery finalize");
        self.this_value.with_mut(|v| v.finalize());
    }

    pub(crate) fn create_query<'a>(
        cx: &mut JsScope<'a>,
        query: bun_core::String,
        values: JsLocal<'a, JSArray>,
        pending_value: JsLocal<'a, JSArray>,
        bigint: bool,
        simple: bool,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let (values, pending_value) = (values.to_js(), pending_value.to_js());
        query_ctor_args::validate(global_this, &query, values, simple)?;

        let this = RefPtr::new(Self {
            this_value: JsCell::new(JsRef::empty()),
            ref_count: Cell::new(1),
            global_object: BackRef::new(global_this),
            query,
            state: JsCell::new(State::New),
            bigint,
            simple,
            result_mode: Cell::new(SQLQueryResultMode::Objects),
            undescribed: JsCell::new(Undescribed::default()),
        });
        let this = js::wrap(this, global_this);
        let this_value = this.to_js();
        this.this_value.with_mut(|v| v.set_weak(this_value));

        js::binding_set_cached(this_value, global_this, values);
        js::pending_value_set_cached(this_value, global_this, pending_value);

        Ok(this_value)
    }

    pub fn do_run(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        connection: &MySQLConnection,
        query: JsLocal<'_>,
    ) -> JsResult<()> {
        debug!("doRun");
        let _guard = self.ref_guard();

        let global_object = cx.global();
        let query = query.to_js();
        if !query.is_object() {
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
        if !matches!(self.state.get(), State::New) {
            return Ok(());
        }
        self.state.set(State::Queued);
        js::target_set_cached(this_value.to_js(), global_object, query);
        // Until it ends: the wrapper holds the target, the parameters and the rows.
        self.this_value.with_mut(|v| v.upgrade(global_object));
        connection.enqueue_request(self.ref_guard());
        Ok(())
    }

    pub fn cancel(&self, _: &mut JsScope<'_>) {
        let _entered = VirtualMachine::get().enter_event_loop_scope_without_checkpoint();
        // The queue drops a request that ended when it gets to it.
        self.reject_when(
            State::cancel,
            self.error_to_js(AnyMySQLError::Error::QueryCancelled),
        );
    }

    pub fn set_mode(&self, cx: &mut JsScope<'_>, mode: JsLocal<'_>) -> JsResult<()> {
        let global_object = cx.global();
        let js_mode = mode.to_js();
        if !js_mode.is_number() {
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
        self.result_mode.set(mode);
        Ok(())
    }

    pub fn set_pending_value_from_js(&self, value: JsLocal<'_>) {
        self.set_pending_value(value.to_js());
    }

    fn last_insert_id_to_js(&self, value: u64) -> JsResult<JSValue> {
        if value <= bun_jsc::MAX_SAFE_INTEGER as u64 {
            return Ok(JSValue::js_number_from_uint64(value));
        }
        if self.bigint {
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
        let State::Running {
            statement,
            rejected: false,
            ..
        } = self.state.get()
        else {
            return Ok(JSValue::NULL);
        };
        if !self.simple {
            return statement.description(self.global_object(), &self.query, has_columns);
        }
        Ok(self
            .undescribed
            .with_mut(|results| results.push(statement.take_columns(has_columns))))
    }

    pub fn describe_result(&self, cx: &mut JsScope<'_>, number: JsLocal<'_>) -> JsResult<JSValue> {
        match self
            .undescribed
            .with_mut(|results| results.take(number.to_js()))
        {
            Some(columns) => describe(cx.global(), &self.query, &[], &columns),
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
                State::discard_response,
                self.global_object().take_exception(err),
            );
            JSValue::UNDEFINED
        };
        let last_insert_id = self
            .last_insert_id_to_js(result.last_insert_id)
            .unwrap_or_else(reject);
        // `result()` lets go of the statement at the last result.
        let statement = self.description(result.has_columns).unwrap_or_else(reject);

        if !self.state.with_mut(|state| state.result(is_last_result)) {
            return;
        }

        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        this_value.ensure_still_alive();
        let Some(target_value) = js::target_get_cached(this_value) else {
            return;
        };
        let vm = VirtualMachine::get();
        let Some(function) = vm.sql_state().mysql_context.get().on_query_resolve_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryResolveFn is not callable");

        let pending_value = self.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        pending_value.ensure_still_alive();
        self.set_pending_value(JSValue::UNDEFINED);

        vm.event_loop().run_callback(
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
        self.state.set(State::Done);
    }

    pub(crate) fn reject(&self, err: AnyMySQLError::Error) {
        self.reject_with_js_value(self.error_to_js(err));
    }

    pub(crate) fn reject_undecodable_row(&self, err: AnyMySQLError::Error) {
        self.reject_when(State::discard_response, self.error_to_js(err));
    }

    pub(crate) fn reject_with_js_value(&self, err: JSValue) {
        self.reject_when(State::fail, err);
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
    fn reject_when(&self, transition: fn(&mut State) -> bool, err: JSValue) {
        let _guard = self.ref_guard();

        if !self.state.with_mut(transition) {
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
        let vm = VirtualMachine::get();
        let Some(function) = vm.sql_state().mysql_context.get().on_query_reject_fn.get() else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryRejectFn is not callable");
        vm.event_loop().run_callback(
            bun_event_loop::ContextId::NONE,
            function,
            self.global_object(),
            this_value,
            &[target_value, js_error],
        );
    }

    /// For one that `is_pending`.
    pub(crate) fn run(&self, connection: &MySQLConnection) -> Result<(), AnyMySQLError::Error> {
        if let State::Prepared {
            statement,
            mut execute,
        } = self.state.replace(State::Binding)
        {
            // With too many parameters, nothing was staged.
            if !statement.parameter_count_matches()
                || set_statement_id(&mut execute, statement.wire.get().id).is_none()
            {
                return Err(AnyMySQLError::Error::WrongNumberOfParametersProvided);
            }
            connection.write(|out| out.extend_from_slice(&execute));
            self.set_running(statement, false);
            return Ok(());
        }
        if self.simple {
            let query = self.query.to_utf8();
            connection.write(|out| mysql_request::execute_query(query.slice(), out));
            self.set_running(
                RefPtr::new(MySQLStatement::unprepared()),
                strings::contains_char(query.slice(), b';'),
            );
            return Ok(());
        }
        let this_value = self.this_value.get().try_get();
        let binding_value = this_value
            .and_then(js::binding_get_cached)
            .unwrap_or(JSValue::UNDEFINED);
        // `params` is on the malloc heap: `roots` keeps the buffers in it alive.
        MarkedArgumentBuffer::new(|roots| {
            let params = Self::bind(self.global_object(), binding_value, roots)?;
            // A parameter's getter can close the connection, which ends the request.
            if let State::Binding = self.state.get() {
                self.execute(connection, &params);
            }
            Ok(())
        })
    }

    /// The one step of `run` that runs user JS.
    fn bind<'a>(
        global_object: &'a JSGlobalObject,
        binding_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<Vec<Value<'a>>, AnyMySQLError::Error> {
        let mut iter =
            JSArrayIterator::init(binding_value, global_object).map_err(js_error_to_mysql)?;
        let mut params = Vec::with_capacity(iter.len as usize);
        while let Some(js_value) = iter.next().map_err(js_error_to_mysql)? {
            params.push(Value::from_js(global_object, js_value, roots)?);
        }
        Ok(params)
    }

    fn execute(&self, connection: &MySQLConnection, params: &[Value<'_>]) {
        let query = self.query.to_utf8();
        if let Some(statement) = connection.cached_statement(query.slice(), params) {
            let statement_id = statement.wire.get().id;
            connection.write(|out| {
                Execute {
                    statement_id,
                    params,
                }
                .write(out)
            });
            return self.set_running(statement, false);
        }
        let mut execute = Vec::new();
        // The server refuses to prepare more than it can count in 16 bits, and says it better.
        if params.len() <= usize::from(u16::MAX) {
            Execute {
                statement_id: 0,
                params,
            }
            .write(&mut execute);
        }
        self.state.set(State::Preparing {
            statement: connection.prepare_statement(query.slice(), params),
            execute,
            rejected: false,
        });
    }

    fn set_running(&self, statement: RefPtr<MySQLStatement>, several_statements: bool) {
        self.state.set(State::Running {
            statement,
            rejected: false,
            several_statements,
        });
    }

    /// The reply to its COM_STMT_PREPARE is complete.
    pub(crate) fn prepared(&self) {
        if let State::Preparing {
            statement,
            execute,
            rejected: false,
        } = self.state.replace(State::Done)
        {
            self.state.set(State::Prepared { statement, execute });
        }
    }

    /// What the server has to answer.
    #[inline]
    pub(crate) fn written_command(&self) -> Option<(Command, RefPtr<MySQLStatement>)> {
        match self.state.get() {
            State::Preparing { statement, .. } => Some((Command::Prepare, statement.clone())),
            State::Running { statement, .. } => Some((Command::Execute, statement.clone())),
            _ => None,
        }
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        matches!(self.state.get(), State::Done)
    }

    pub(crate) fn is_in_flight(&self) -> bool {
        matches!(
            self.state.get(),
            State::Binding | State::Preparing { .. } | State::Running { .. }
        )
    }

    /// It is written, and the next request can be written behind it.
    #[inline]
    pub(crate) fn can_be_followed(&self) -> bool {
        matches!(
            self.state.get(),
            State::Running {
                several_statements: false,
                ..
            }
        )
    }

    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        matches!(self.state.get(), State::Queued | State::Prepared { .. })
    }

    #[inline]
    pub(crate) fn is_discarding_response(&self) -> bool {
        matches!(self.state.get(), State::Running { rejected: true, .. })
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
