use crate::error::ThrowSqlError;
use crate::jsc::{JSGlobalObject, JSValue, MarkedArgumentBuffer};
use bun_core::String as BunString;

use super::my_sql_value::Value;
use bun_sql::mysql::mysql_param::Param;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError;
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::new_writer::{NewWriter, WriterContext};
use bun_sql::mysql::protocol::prepared_statement;
use bun_sql::mysql::query_status::Status;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use crate::jsc::js_error_to_mysql;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
use crate::mysql::protocol::signature::Signature;
use crate::shared::query_binding_iterator::QueryBindingIterator;

use super::js_mysql_connection::MySQLConnection;
use super::my_sql_statement::{self as my_sql_statement, ExecutionFlags, MySQLStatement};
use bun_jsc::JsCell;
use bun_ptr::RefPtr;
use core::cell::Cell;

bun_core::define_scoped_log!(debug, MySQLQuery, visible);

/// Every field is interior-mutable and every method takes `&self`: the conversion of
/// the parameters runs user code (`toJSON`, index getters) while `run_query` is on the
/// stack, and that code can reach this request again through `cancel()` or a close of
/// its connection.
pub struct MySQLQuery {
    /// Shared with the connection's `PreparedStatementsMap` (each holder owns
    /// one ref).
    statement: JsCell<Option<RefPtr<MySQLStatement>>>,
    query: BunString,

    status: Cell<Status>,
    flags: Cell<Flags>,
}

/// Not all fields are `bool`, so per PORTING.md this is a transparent `u8` with shift accessors.
#[repr(transparent)]
#[derive(Copy, Clone, Default)]
struct Flags(u8);

impl Flags {
    const BIGINT: u8 = 1 << 0;
    const SIMPLE: u8 = 1 << 1;
    const PIPELINED: u8 = 1 << 2;
    const RESULT_MODE_SHIFT: u8 = 3;
    const RESULT_MODE_MASK: u8 = 0b11 << Self::RESULT_MODE_SHIFT; // SQLQueryResultMode is 2 bits (4 bool + 2 + 2 pad = 8)
    /// The query is already rejected, but the queue still needs it.
    /// - [`MySQLQuery::discard_response`]: the server is still answering it. It
    ///   stays in flight at the queue head, and the rest of its response is
    ///   skipped, until the terminator of its last result set.
    /// - [`MySQLQuery::cancel`]: its statement is being prepared. It stays
    ///   pending until the COM_STMT_PREPARE is answered, and then ends with no
    ///   COM_STMT_EXECUTE.
    const REJECTED: u8 = 1 << 5;

    #[inline]
    fn bigint(self) -> bool {
        self.0 & Self::BIGINT != 0
    }
    #[inline]
    fn simple(self) -> bool {
        self.0 & Self::SIMPLE != 0
    }
    #[inline]
    fn pipelined(self) -> bool {
        self.0 & Self::PIPELINED != 0
    }
    #[inline]
    fn set_pipelined(&mut self, v: bool) {
        if v {
            self.0 |= Self::PIPELINED;
        } else {
            self.0 &= !Self::PIPELINED;
        }
    }
    #[inline]
    fn rejected(self) -> bool {
        self.0 & Self::REJECTED != 0
    }
    #[inline]
    fn set_rejected(&mut self) {
        self.0 |= Self::REJECTED;
    }
    #[inline]
    fn result_mode(self) -> SQLQueryResultMode {
        // result_mode bits were written from a valid SQLQueryResultMode
        // discriminant (`set_result_mode`); the unreachable 4th bit-state
        // traps.
        match (self.0 & Self::RESULT_MODE_MASK) >> Self::RESULT_MODE_SHIFT {
            0 => SQLQueryResultMode::Objects,
            1 => SQLQueryResultMode::Values,
            2 => SQLQueryResultMode::Raw,
            n => unreachable!("invalid SQLQueryResultMode {n}"),
        }
    }
    #[inline]
    fn set_result_mode(&mut self, m: SQLQueryResultMode) {
        self.0 = (self.0 & !Self::RESULT_MODE_MASK) | ((m as u8) << Self::RESULT_MODE_SHIFT);
    }
    #[inline]
    fn new(bigint: bool, simple: bool) -> Self {
        let mut f = 0u8;
        if bigint {
            f |= Self::BIGINT;
        }
        if simple {
            f |= Self::SIMPLE;
        }
        // result_mode default = .objects (assumed discriminant 0)
        Self(f)
    }
}

impl MySQLQuery {
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut flags = self.flags.get();
        f(&mut flags);
        self.flags.set(flags);
    }

    /// User code runs while a request is encoded: `toJSON` and the index getters of
    /// its parameters. That code can complete the request with `cancel()` or with a
    /// close of the connection. A completed request is not written.
    fn ensure_pending(&self) -> Result<(), AnyMySQLError> {
        if self.is_pending() {
            Ok(())
        } else {
            Err(AnyMySQLError::QueryCancelled)
        }
    }

    fn bind(
        &self,
        param_types: &[Param],
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<Vec<Value>, AnyMySQLError> {
        let mut iter = QueryBindingIterator::init(binding_value, columns_value, global_object)
            .map_err(js_error_to_mysql)?;

        let mut i: u32 = 0;
        let len = param_types.len();
        let mut params: Vec<Value> = Vec::with_capacity(len);
        // errdefer { for params[0..i] deinit; free(params) } — deleted: `Vec<Value>` drops on `?`.

        while let Some(js_value) = iter.next().map_err(js_error_to_mysql)? {
            if i as usize >= len {
                // The binding array yielded more values than the prepared statement
                // expects. This can happen when the user-supplied array is mutated (e.g.
                // from an index getter) between signature generation and binding. Fail
                // loudly instead of writing past the end of `params`/`param_types`.
                return Err(AnyMySQLError::WrongNumberOfParametersProvided);
            }
            let param = &param_types[i as usize];
            params.push(Value::from_js(
                js_value,
                global_object,
                param.r#type,
                param.flags.contains(ColumnFlags::UNSIGNED),
                roots,
            )?);
            i += 1;
        }

        if iter.any_failed() {
            return Err(AnyMySQLError::InvalidQueryBinding);
        }

        if i as usize != len {
            // Fewer values than the prepared statement expects; the remaining slots
            // would be uninitialized.
            return Err(AnyMySQLError::WrongNumberOfParametersProvided);
        }

        self.ensure_pending()?;
        self.status.set(Status::Binding);
        Ok(params)
    }

    /// `statement` is a raw `*mut MySQLStatement` (not `&mut`): the sole caller,
    /// `run_prepared_query`, copies it out of `self.statement`.
    fn bind_and_execute<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
        statement: *mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
    ) -> Result<(), AnyMySQLError> {
        {
            // `statement` is non-null and kept alive by the intrusive ref held in
            // `self.statement` for the duration of this call; no other `&mut` to it
            // exists. This block only reads — `ParentRef` yields `&T`.
            let stmt = bun_ptr::ParentRef::from(
                core::ptr::NonNull::new(statement).expect("bind_and_execute: statement non-null"),
            );
            debug_assert!(
                stmt.params.len() == stmt.params_received as usize && stmt.statement_id > 0,
                "statement is not prepared",
            );
            if stmt.signature.fields.len() != stmt.params.len() {
                return Err(AnyMySQLError::WrongNumberOfParametersProvided);
            }
        }

        // BLOB parameters borrow ArrayBuffer/Blob bytes rather than copying.
        // Converting later parameters can run user JS (index getters, toJSON,
        // toString coercion) which could drop the last reference to an earlier
        // buffer and force GC. Root every borrowed JSValue in a stack-scoped
        // MarkedArgumentBuffer so the wrapper (and its RefPtr<ArrayBuffer>)
        // survives until execute.deinit() has unpinned and released the borrow.
        //
        // `MarkedArgumentBuffer::new` is the safe closure trampoline — the
        // `*mut Ctx` / `*mut MarkedArgumentBuffer` backref derefs are
        // centralised in `bun_jsc`, so no per-site `Ctx` struct + `extern "C"`
        // thunk is needed here.
        MarkedArgumentBuffer::new(|roots| {
            self.bind_and_execute_impl(
                writer,
                statement,
                global_object,
                binding_value,
                columns_value,
                roots,
            )
        })
    }

    fn bind_and_execute_impl<C: WriterContext>(
        &self,
        writer: NewWriter<C>,
        statement: *mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<(), AnyMySQLError> {
        // SAFETY: `statement` was copied from `self.statement` by `run_prepared_query`;
        // the intrusive ref held there keeps the allocation alive across this call, and
        // this is the only live mutable access path to the statement for the duration
        // of this function.
        let statement = unsafe { &mut *statement };

        // Bind before touching the writer so a bind failure (user-triggerable via JS
        // getters / param-count mismatch) doesn't leave a partial packet header in
        // the connection's write buffer.
        let params = self.bind(
            &statement.signature.fields,
            global_object,
            binding_value,
            columns_value,
            roots,
        )?;
        // `defer execute.deinit()` — `params: Vec<Value>` drops at end of scope.

        let execute = prepared_statement::Execute {
            statement_id: statement.statement_id,
            flags: 0,
            iteration_count: 1,
            param_types: &statement.signature.fields,
            new_params_bind_flag: statement
                .execution_flags
                .contains(ExecutionFlags::NEED_TO_SEND_PARAMS),
            params: &params,
        };

        let mut packet = writer.start(0)?;
        execute.write(writer)?;
        packet.end()?;
        statement
            .execution_flags
            .remove(ExecutionFlags::NEED_TO_SEND_PARAMS);
        self.status.set(Status::Running);
        Ok(())
    }

    fn run_simple_query(&self, connection: &MySQLConnection) -> crate::Result<()> {
        if !self.is_pending() || !connection.can_execute_query() {
            debug!("cannot execute query");
            // cannot execute query
            return Ok(());
        }
        let query_str = self.query.to_utf8();
        let writer = connection.get_writer();
        if self.statement.get().is_none() {
            self.statement.set(Some(RefPtr::new(MySQLStatement::new(
                Signature::empty(),
                my_sql_statement::Status::Parsing,
            ))));
        }
        mysql_request::execute_query(query_str.slice(), writer)?;

        self.status.set(Status::Running);
        Ok(())
    }

    fn run_prepared_query(
        &self,
        connection: &MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> crate::Result<()> {
        let mut query_str: Option<bun_core::Utf8Bytes<'_>> = None;

        if self.statement.get().is_none() {
            let query = self.query.to_utf8();
            let signature = match Signature::generate(
                global_object,
                query.slice(),
                binding_value,
                columns_value,
            ) {
                Ok(s) => s,
                Err(err) => {
                    if !global_object.has_exception() {
                        let _ = global_object.throw_sql_error(err, "failed to generate signature");
                    }
                    return Err(crate::Error::JSError);
                }
            };
            // `generate` read the binding array, which runs its index getters.
            self.ensure_pending()?;
            query_str = Some(query);
            // errdefer signature.deinit() — `Signature: Drop` handles the error path; on the
            // found_existing success path below we explicitly drop it.
            let entry = match connection.get_statement_from_signature_name(&signature.name) {
                Ok(e) => e,
                Err(err) => {
                    // `err` is `bun_core::AllocError`; `throw_error` takes
                    // `crate::Error` (`From<AllocError>` → OutOfMemory).
                    let _ = global_object
                        .throw_error(crate::Error::from(err), "failed to allocate statement");
                    return Err(crate::Error::JSError);
                }
            };

            match entry.value_ptr {
                Some(stmt) => {
                    if stmt.status == my_sql_statement::Status::Failed {
                        let error_response = stmt.error_response.to_js(global_object);
                        // If the statement failed, we need to throw the error
                        let _ = global_object.throw_value(error_response);
                        return Err(crate::Error::JSError);
                    }
                    self.statement.set(Some(stmt.clone()));
                }
                slot @ None => {
                    let stmt = RefPtr::new(MySQLStatement::new(
                        signature,
                        my_sql_statement::Status::Pending,
                    ));
                    self.statement.set(Some(stmt.clone()));
                    *slot = Some(stmt);
                }
            }
        }
        // `stmt` is kept alive by the ref in `self.statement`; separate heap
        // allocation (never aliases `*self`). `ParentRef` collapses the
        // read-only derefs below into one safe `Deref`; the `.Pending` arm's
        // status write goes through `get_statement()`.
        let stmt = (self.statement.get().as_ref())
            .expect("set above")
            .as_non_null();
        let (stmt, stmt_ref) = (stmt.as_ptr(), bun_ptr::ParentRef::from(stmt));
        match stmt_ref.status {
            my_sql_statement::Status::Failed => {
                debug!("failed");
                let error_response = stmt_ref.error_response.to_js(global_object);
                // If the statement failed, we need to throw the error
                let _ = global_object.throw_value(error_response);
                return Err(crate::Error::JSError);
            }
            my_sql_statement::Status::Prepared => {
                if connection.can_pipeline() {
                    debug!("bindAndExecute");
                    let writer = connection.get_writer();
                    // Pass the raw `*mut MySQLStatement` separately from `self`.
                    if let Err(err) = self.bind_and_execute(
                        writer,
                        stmt,
                        global_object,
                        binding_value,
                        columns_value,
                    ) {
                        if !global_object.has_exception() {
                            let _ = global_object.throw_value(mysql_error_to_js(
                                global_object,
                                Some(b"failed to bind and execute query"),
                                err,
                            ));
                        }
                        return Err(crate::Error::JSError);
                    }
                    self.update_flags(|f| f.set_pipelined(true));
                }
            }
            my_sql_statement::Status::Parsing => {
                debug!("parsing");
            }
            my_sql_statement::Status::Pending => {
                if connection.can_prepare_query() {
                    debug!("prepareRequest");
                    let writer = connection.get_writer();
                    let query = match query_str.take() {
                        Some(q) => q,
                        None => self.query.to_utf8(),
                    };
                    if let Err(err) = mysql_request::prepare_request(query.slice(), writer) {
                        let _ =
                            global_object.throw_sql_error(err.into(), "failed to prepare query");
                        return Err(crate::Error::JSError);
                    }
                    // `self.statement` was set in both branches above; route
                    // through the single-unsafe accessor instead of a raw
                    // `(*stmt)` deref so the write goes via the same audited
                    // intrusive-pointer path as every other status mutation.
                    self.get_statement()
                        .expect("self.statement set above")
                        .status = my_sql_statement::Status::Parsing;
                }
            }
        }
        Ok(())
    }

    /// Takes ownership of `query`; `cleanup()` releases it.
    pub(crate) fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: JsCell::new(None),
            query,
            status: Cell::new(Status::Pending),
            flags: Cell::new(Flags::new(bigint, simple)),
        }
    }

    pub(crate) fn run_query(
        &self,
        connection: &MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> crate::Result<()> {
        if self.flags.get().simple() {
            debug!("runSimpleQuery");
            return self.run_simple_query(connection);
        }
        debug!("runPreparedQuery");
        self.run_prepared_query(
            connection,
            global_object,
            if columns_value.is_empty() {
                JSValue::UNDEFINED
            } else {
                columns_value
            },
            if binding_value.is_empty() {
                JSValue::UNDEFINED
            } else {
                binding_value
            },
        )
    }

    #[inline]
    pub(crate) fn set_result_mode(&self, result_mode: SQLQueryResultMode) {
        self.update_flags(|f| f.set_result_mode(result_mode));
    }

    /// Returns whether the caller has a result to deliver.
    #[inline]
    pub(crate) fn result(&self, is_last_result: bool) -> bool {
        if self.is_completed() {
            return false;
        }
        if self.flags.get().rejected() {
            if is_last_result {
                self.status.set(Status::Fail);
            }
            return false;
        }
        self.status.set(if is_last_result {
            Status::Success
        } else {
            Status::PartialResponse
        });

        true
    }

    /// Returns whether the caller has a rejection to deliver.
    pub(crate) fn fail(&self) -> bool {
        if self.is_completed() {
            return false;
        }
        self.status.set(Status::Fail);

        !self.flags.get().rejected()
    }

    /// The client cannot decode a row of this query's result. The caller
    /// rejects the query now, but the status stays in flight: the server is
    /// still answering, and a `Fail` head would let `advance()` pop it and hand
    /// the rest of its response to the next request. [`Self::result`] ends it
    /// at its last terminator. Returns whether the caller has a rejection to
    /// deliver.
    pub(crate) fn discard_response(&self) -> bool {
        if !self.is_running() {
            return self.fail();
        }
        if self.flags.get().rejected() {
            return false;
        }
        self.update_flags(Flags::set_rejected);

        true
    }

    #[inline]
    pub(crate) fn is_discarding_response(&self) -> bool {
        self.flags.get().rejected()
    }

    /// `cancel()` on a request with no COM_QUERY or COM_STMT_EXECUTE on the
    /// wire. The caller rejects the query now. A request whose statement is
    /// being prepared stays pending: the reply of the COM_STMT_PREPARE goes to
    /// the queue head, which this request can be. `JSMySQLQuery::run` ends it
    /// when its turn comes. Returns whether the caller has a rejection to
    /// deliver.
    pub(crate) fn cancel(&self) -> bool {
        if !self.is_pending() || self.flags.get().rejected() {
            return false;
        }
        if !self.is_being_prepared() {
            return self.fail();
        }
        self.update_flags(Flags::set_rejected);

        true
    }

    /// Rejected by [`Self::cancel`], and still pending.
    #[inline]
    pub(crate) fn is_cancelled(&self) -> bool {
        self.is_pending() && self.flags.get().rejected()
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        let status = self.status.get();
        status == Status::Success || status == Status::Fail
    }

    #[inline]
    pub(crate) fn is_running(&self) -> bool {
        match self.status.get() {
            Status::Running | Status::Binding | Status::PartialResponse => true,
            Status::Success | Status::Fail | Status::Pending => false,
        }
    }

    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.status.get() == Status::Pending
    }

    #[inline]
    pub(crate) fn is_being_prepared(&self) -> bool {
        self.is_pending()
            && self
                .get_statement()
                .is_some_and(|s| s.status == my_sql_statement::Status::Parsing)
    }

    #[inline]
    pub(crate) fn is_pipelined(&self) -> bool {
        self.flags.get().pipelined()
    }

    #[inline]
    pub(crate) fn is_simple(&self) -> bool {
        self.flags.get().simple()
    }

    #[inline]
    pub(crate) fn is_bigint_supported(&self) -> bool {
        self.flags.get().bigint()
    }

    #[inline]
    pub(crate) fn get_result_mode(&self) -> SQLQueryResultMode {
        self.flags.get().result_mode()
    }

    #[inline]
    pub(crate) fn mark_as_prepared(&self) {
        if self.is_pending() {
            if let Some(statement) = self.get_statement() {
                if statement.status == my_sql_statement::Status::Parsing
                    && statement.params.len() == statement.params_received as usize
                    && statement.statement_id > 0
                {
                    statement.status = my_sql_statement::Status::Prepared;
                }
            }
        }
    }

    #[inline]
    #[allow(clippy::mut_from_ref)] // goes through a raw intrusive pointer; see SAFETY note below
    pub(crate) fn get_statement(&self) -> Option<&mut MySQLStatement> {
        // SAFETY: kept alive by the ref we hold. Returning `&mut` permits
        // shared mutation through the intrusive pointer; the lifetime is
        // bounded by `&self`, which owns one ref.
        (self.statement.get().as_ref()).map(|stmt| unsafe { &mut *stmt.as_ptr() })
    }
}
