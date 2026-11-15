use core::cell::Cell;
use std::rc::Rc;

use crate::jsc::{JSArrayIterator, JSGlobalObject, JSValue, MarkedArgumentBuffer};
use bun_core::{String as BunString, strings};

use super::my_sql_value::Value;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError;
use bun_sql::mysql::protocol::new_writer::NewWriter;
use bun_sql::mysql::protocol::prepared_statement;
use bun_sql::mysql::query_status::Status;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use crate::jsc::js_error_to_mysql;

use super::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use super::my_sql_statement::MySQLStatement;
use bun_ptr::CellExt as _;

bun_core::declare_scope!(MySQLQuery, visible);

pub struct MySQLQuery {
    /// Shared with the connection's `StatementCache`. Held from the first write until the end.
    statement: Cell<Option<Rc<MySQLStatement>>>,
    /// The payload of the COM_STMT_EXECUTE, while `statement` is being prepared.
    staged_execute: Cell<Vec<u8>>,
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
    const RESULT_MODE_SHIFT: u8 = 2;
    const RESULT_MODE_MASK: u8 = 0b11 << Self::RESULT_MODE_SHIFT;
    /// Set by [`MySQLQuery::discard_response`]: the query is already rejected,
    /// but the server is still answering it. It stays in flight at the queue
    /// head, and the rest of its response is skipped, until the terminator of
    /// its last result set or the end of the reply to its COM_STMT_PREPARE.
    const DISCARD_RESPONSE: u8 = 1 << 4;
    /// A COM_QUERY whose text has a `;`. A server that is told to KILL QUERY between two statements
    /// ends the text and says nothing, after it promised a further result: the reply to a command
    /// written behind it would be taken for that result.
    const SEVERAL_STATEMENTS: u8 = 1 << 5;

    #[inline]
    fn bigint(self) -> bool {
        self.0 & Self::BIGINT != 0
    }
    #[inline]
    fn simple(self) -> bool {
        self.0 & Self::SIMPLE != 0
    }
    #[inline]
    fn discard_response(self) -> bool {
        self.0 & Self::DISCARD_RESPONSE != 0
    }
    #[inline]
    fn set_discard_response(&mut self) {
        self.0 |= Self::DISCARD_RESPONSE;
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
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// The one step of a request that runs user JS: it borrows neither request nor connection.
    pub(crate) fn bind<'a>(
        global_object: &'a JSGlobalObject,
        binding_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<Vec<Value<'a>>, AnyMySQLError> {
        let mut iter =
            JSArrayIterator::init(binding_value, global_object).map_err(js_error_to_mysql)?;
        let mut params = Vec::with_capacity(iter.len as usize);
        while let Some(js_value) = iter.next().map_err(js_error_to_mysql)? {
            params.push(Value::from_js(global_object, js_value, roots)?);
        }
        Ok(params)
    }

    pub(crate) fn execute(
        &self,
        connection: &MySQLConnection,
        params: &[Value<'_>],
    ) -> Result<(), AnyMySQLError> {
        // A parameter's getter can close the connection, which ends the request.
        if self.status.get() != Status::Binding {
            return Ok(());
        }
        let query = self.query.to_utf8();
        if let Some(statement) = connection.cached_statement(query.slice(), params) {
            connection.with_writer(|writer| {
                let packet = writer.start(0)?;
                prepared_statement::Execute {
                    statement_id: statement.statement_id.get(),
                    params,
                }
                .write(writer)?;
                packet.end(writer)
            })?;
            self.statement.set(Some(statement));
            self.status.set(Status::Running);
            return Ok(());
        }
        let mut staged = Vec::new();
        // The server refuses to prepare more than it can count in 16 bits, and says it better.
        if params.len() <= usize::from(u16::MAX) {
            prepared_statement::Execute {
                statement_id: 0,
                params,
            }
            .write(&mut NewWriter::new(&mut staged))?;
        }
        self.statement
            .set(Some(connection.prepare_statement(query.slice(), params)?));
        self.staged_execute.set(staged);
        self.status.set(Status::Preparing);
        Ok(())
    }

    /// `false`: the request is `Binding`, the caller reads the parameters and calls `execute`.
    pub(crate) fn start(&self, connection: &MySQLConnection) -> Result<bool, AnyMySQLError> {
        if self.flags.get().simple() {
            let query = self.query.to_utf8();
            connection.with_writer(|writer| mysql_request::execute_query(query.slice(), writer))?;
            if strings::contains_char(query.slice(), b';') {
                self.update_flags(|f| f.0 |= Flags::SEVERAL_STATEMENTS);
            }
            self.statement
                .set(Some(Rc::new(MySQLStatement::unprepared())));
            self.status.set(Status::Running);
            return Ok(true);
        }
        let Some(statement) = self.statement() else {
            self.status.set(Status::Binding);
            return Ok(false);
        };
        // Its COM_STMT_PREPARE has been answered.
        if !statement.parameter_count_matches() {
            return Err(AnyMySQLError::WrongNumberOfParametersProvided);
        }
        // [0x17] [statement id: 4 bytes] ...
        let mut staged = self.staged_execute.take();
        staged[1..5].copy_from_slice(&statement.statement_id.get().to_le_bytes());
        connection.with_writer(|writer| {
            let packet = writer.start(0)?;
            writer.write(&staged)?;
            packet.end(writer)
        })?;
        self.status.set(Status::Running);
        Ok(true)
    }

    pub(crate) fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: Cell::new(None),
            staged_execute: Cell::default(),
            query,
            status: Cell::new(Status::Pending),
            flags: Cell::new(Flags::new(bigint, simple)),
        }
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
        if self.flags.get().discard_response() {
            if is_last_result {
                self.end(Status::Fail);
            }
            return false;
        }
        if is_last_result {
            self.end(Status::Success);
        } else {
            self.status.set(Status::PartialResponse);
        }

        true
    }

    /// The reply to its COM_STMT_PREPARE is complete.
    pub(crate) fn prepared(&self) {
        if self.flags.get().discard_response() {
            self.end(Status::Fail);
        } else {
            self.status.set(Status::Pending);
        }
    }

    fn end(&self, status: Status) {
        self.status.set(status);
        self.statement.set(None);
        self.staged_execute.set(Vec::new());
    }

    /// Returns whether the caller has a rejection to deliver.
    pub(crate) fn fail(&self) -> bool {
        if self.is_completed() {
            return false;
        }
        self.end(Status::Fail);

        !self.flags.get().discard_response()
    }

    /// Stays in flight while the server still answers it: `advance()` would hand the rest of a
    /// `Fail` head's response to the next request. Returns whether to deliver a rejection.
    pub(crate) fn discard_response(&self) -> bool {
        if matches!(self.status.get(), Status::Pending | Status::Binding) {
            return self.fail();
        }
        if self.is_completed() {
            return false;
        }
        if self.flags.get().discard_response() {
            return false;
        }
        self.update_flags(Flags::set_discard_response);

        true
    }

    /// The server runs a query that it has to its end: only an unwritten one is cancelled.
    /// Returns whether the caller has a rejection to deliver.
    pub(crate) fn cancel(&self) -> bool {
        match self.status.get() {
            Status::Pending | Status::Binding | Status::Preparing => self.discard_response(),
            Status::Running | Status::PartialResponse | Status::Success | Status::Fail => false,
        }
    }

    #[inline]
    pub(crate) fn is_discarding_response(&self) -> bool {
        self.flags.get().discard_response()
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        matches!(self.status.get(), Status::Success | Status::Fail)
    }

    /// The server's next packet answers this request, or its parameters are being read.
    #[inline]
    pub(crate) fn is_in_flight(&self) -> bool {
        match self.status.get() {
            Status::Preparing | Status::Binding | Status::Running | Status::PartialResponse => true,
            Status::Success | Status::Fail | Status::Pending => false,
        }
    }

    /// It is written, and the next request can be written behind it.
    #[inline]
    pub(crate) fn can_be_followed(&self) -> bool {
        matches!(self.status.get(), Status::Running | Status::PartialResponse)
            && self.flags.get().0 & Flags::SEVERAL_STATEMENTS == 0
    }

    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.status.get() == Status::Pending
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
    pub(crate) fn text(&self) -> &BunString {
        &self.query
    }

    pub(crate) fn statement(&self) -> Option<Rc<MySQLStatement>> {
        let statement = self.statement.take();
        let clone = statement.clone();
        self.statement.put_back(statement);
        clone
    }
}
