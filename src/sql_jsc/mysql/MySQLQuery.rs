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

bun_core::define_scoped_log!(debug, MySQLQuery, visible);

pub struct MySQLQuery {
    /// This query's ref on its statement; the connection's
    /// `PreparedStatementsMap` may hold another on the same statement.
    statement: Option<bun_ptr::RefPtr<MySQLStatement>>,
    query: BunString,

    status: Status,
    flags: Flags,
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
    const RESULT_MODE_MASK: u8 = 0b11 << Self::RESULT_MODE_SHIFT; // SQLQueryResultMode is 2 bits (3 bool + 2 + 3 pad = 8)

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
    fn bind<'a>(
        param_types: &[Param],
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &'a MarkedArgumentBuffer,
    ) -> Result<Vec<Value<'a>>, AnyMySQLError> {
        let mut iter = QueryBindingIterator::init(binding_value, columns_value, global_object)
            .map_err(js_error_to_mysql)?;

        let mut i: u32 = 0;
        let len = param_types.len();
        let mut params: Vec<Value<'a>> = Vec::with_capacity(len);
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

        Ok(params)
    }

    /// Bind and execute this query's (prepared) statement.
    fn bind_and_execute<C: WriterContext>(
        &mut self,
        writer: NewWriter<C>,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
    ) -> Result<(), AnyMySQLError> {
        {
            let stmt = self
                .statement
                .as_deref()
                .expect("bind_and_execute: statement set");
            let params_len = stmt.params.get().len();
            debug_assert!(
                params_len == stmt.params_received.get() as usize && stmt.statement_id.get() > 0,
                "statement is not prepared",
            );
            if stmt.signature.fields.len() != params_len {
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
            self.bind_and_execute_impl(writer, global_object, binding_value, columns_value, roots)
        })
    }

    fn bind_and_execute_impl<C: WriterContext>(
        &mut self,
        writer: NewWriter<C>,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<(), AnyMySQLError> {
        let statement: &MySQLStatement = self
            .statement
            .as_deref()
            .expect("bind_and_execute: statement set");

        // Bind before touching the writer so a bind failure (user-triggerable via JS
        // getters / param-count mismatch) doesn't leave a partial packet header in
        // the connection's write buffer.
        let params = Self::bind(
            &statement.signature.fields,
            global_object,
            binding_value,
            columns_value,
            roots,
        )?;
        self.status = Status::Binding;
        // `defer execute.deinit()` — `params: Vec<Value>` drops at end of scope.

        let execute = prepared_statement::Execute {
            statement_id: statement.statement_id.get(),
            flags: 0,
            iteration_count: 1,
            param_types: &statement.signature.fields,
            new_params_bind_flag: statement.has_execution_flag(ExecutionFlags::NEED_TO_SEND_PARAMS),
            params: &params,
        };

        let mut packet = writer.start(0)?;
        execute.write(writer)?;
        packet.end()?;
        statement.remove_execution_flag(ExecutionFlags::NEED_TO_SEND_PARAMS);
        self.status = Status::Running;
        Ok(())
    }

    fn run_simple_query(&mut self, connection: &MySQLConnection) -> crate::Result<()> {
        if self.status != Status::Pending || !connection.can_execute_query() {
            debug!("cannot execute query");
            // cannot execute query
            return Ok(());
        }
        let query_str = self.query.to_utf8();
        let writer = connection.get_writer();
        if self.statement.is_none() {
            // The query is the only owner of a simple statement.
            self.statement = Some(MySQLStatement::new(
                Signature::empty(),
                my_sql_statement::Status::Parsing,
            ));
        }
        mysql_request::execute_query(query_str.slice(), writer)?;

        self.status = Status::Running;
        Ok(())
    }

    fn run_prepared_query(
        &mut self,
        connection: &MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> crate::Result<()> {
        let mut query_str: Option<bun_core::Utf8Bytes<'_>> = None;

        if self.statement.is_none() {
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
            query_str = Some(query);
            // errdefer signature.deinit() — `Signature: Drop` handles the error path.
            // For a signature the connection has already prepared, this is a
            // new ref on that statement (the signature is dropped); otherwise
            // a fresh statement the connection's map now also references.
            let (stmt, found_existing) = match connection.statement_for_signature(signature) {
                Ok(v) => v,
                Err(err) => {
                    // `err` is `bun_core::AllocError`; `throw_error` takes
                    // `crate::Error` (`From<AllocError>` → OutOfMemory).
                    let _ = global_object
                        .throw_error(crate::Error::from(err), "failed to allocate statement");
                    return Err(crate::Error::JSError);
                }
            };

            if found_existing && stmt.status.get() == my_sql_statement::Status::Failed {
                let error_response = stmt.error_response.get().to_js(global_object);
                drop(stmt);
                // If the statement failed, we need to throw the error
                let _ = global_object.throw_value(error_response);
                return Err(crate::Error::JSError);
            }
            self.statement = Some(stmt);
        }
        let stmt: &MySQLStatement = self.statement.as_deref().expect("self.statement set above");
        match stmt.status.get() {
            my_sql_statement::Status::Failed => {
                debug!("failed");
                let error_response = stmt.error_response.get().to_js(global_object);
                // If the statement failed, we need to throw the error
                let _ = global_object.throw_value(error_response);
                return Err(crate::Error::JSError);
            }
            my_sql_statement::Status::Prepared => {
                if connection.can_pipeline() {
                    debug!("bindAndExecute");
                    let writer = connection.get_writer();
                    if let Err(err) =
                        self.bind_and_execute(writer, global_object, binding_value, columns_value)
                    {
                        if !global_object.has_exception() {
                            let _ = global_object.throw_value(mysql_error_to_js(
                                global_object,
                                Some(b"failed to bind and execute query"),
                                err,
                            ));
                        }
                        return Err(crate::Error::JSError);
                    }
                    self.flags.set_pipelined(true);
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
                    stmt.status.set(my_sql_statement::Status::Parsing);
                }
            }
        }
        Ok(())
    }

    /// Takes ownership of `query`; `cleanup()` releases it.
    pub(crate) fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: None,
            query,
            status: Status::Pending,
            flags: Flags::new(bigint, simple),
        }
    }

    pub(crate) fn run_query(
        &mut self,
        connection: &MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> crate::Result<()> {
        if self.flags.simple() {
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
    pub(crate) fn set_result_mode(&mut self, result_mode: SQLQueryResultMode) {
        self.flags.set_result_mode(result_mode);
    }

    #[inline]
    pub(crate) fn result(&mut self, is_last_result: bool) -> bool {
        if self.status == Status::Success || self.status == Status::Fail {
            return false;
        }
        self.status = if is_last_result {
            Status::Success
        } else {
            Status::PartialResponse
        };

        true
    }

    pub(crate) fn fail(&mut self) -> bool {
        if self.status == Status::Fail || self.status == Status::Success {
            return false;
        }
        self.status = Status::Fail;

        true
    }

    pub(crate) fn cleanup(&mut self) {
        drop(self.statement.take());
        self.query = BunString::EMPTY;
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        self.status == Status::Success || self.status == Status::Fail
    }

    #[inline]
    pub(crate) fn is_running(&self) -> bool {
        match self.status {
            Status::Running | Status::Binding | Status::PartialResponse => true,
            Status::Success | Status::Fail | Status::Pending => false,
        }
    }

    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.status == Status::Pending
    }

    #[inline]
    pub(crate) fn is_being_prepared(&self) -> bool {
        self.status == Status::Pending
            && self
                .get_statement()
                .is_some_and(|s| s.status.get() == my_sql_statement::Status::Parsing)
    }

    #[inline]
    pub(crate) fn is_pipelined(&self) -> bool {
        self.flags.pipelined()
    }

    #[inline]
    pub(crate) fn is_simple(&self) -> bool {
        self.flags.simple()
    }

    #[inline]
    pub(crate) fn is_bigint_supported(&self) -> bool {
        self.flags.bigint()
    }

    #[inline]
    pub(crate) fn get_result_mode(&self) -> SQLQueryResultMode {
        self.flags.result_mode()
    }

    #[inline]
    pub(crate) fn mark_as_prepared(&self) {
        if self.status == Status::Pending {
            if let Some(statement) = self.get_statement() {
                if statement.status.get() == my_sql_statement::Status::Parsing
                    && statement.params.get().len() == statement.params_received.get() as usize
                    && statement.statement_id.get() > 0
                {
                    statement.status.set(my_sql_statement::Status::Prepared);
                }
            }
        }
    }

    #[inline]
    pub(crate) fn get_statement(&self) -> Option<&MySQLStatement> {
        self.statement.as_deref()
    }
}
