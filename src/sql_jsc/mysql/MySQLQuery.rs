use core::cell::RefCell;

use crate::jsc::{JSArrayIterator, JSGlobalObject, JSValue, MarkedArgumentBuffer};
use bun_core::{String as BunString, strings};

use super::my_sql_value::Value;
use bun_sql::mysql::mysql_request;
use bun_sql::mysql::protocol::any_mysql_error::AnyMySQLError;
use bun_sql::mysql::protocol::new_writer::{NewWriterWrap, WriterContext};
use bun_sql::mysql::protocol::prepared_statement;
use bun_sql::mysql::query_status::Status;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use crate::jsc::js_error_to_mysql;

use super::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use super::my_sql_statement::MySQLStatement;
use bun_ptr::RefPtr;

bun_core::declare_scope!(MySQLQuery, visible);

pub struct MySQLQuery {
    /// Shared with the connection's `StatementCache`. Held from the first write until the end.
    statement: Option<RefPtr<MySQLStatement>>,
    /// The payload of the COM_STMT_EXECUTE, while `statement` is being prepared.
    staged_execute: Vec<u8>,
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

#[derive(Clone, Copy)]
struct Staging<'a>(&'a RefCell<Vec<u8>>);

impl WriterContext for Staging<'_> {
    fn offset(self) -> usize {
        self.0.borrow().len()
    }

    fn write(self, bytes: &[u8]) -> Result<(), AnyMySQLError> {
        self.0.borrow_mut().extend_from_slice(bytes);
        Ok(())
    }

    fn pwrite(self, bytes: &[u8], offset: usize) -> Result<(), AnyMySQLError> {
        self.0.borrow_mut()[offset..][..bytes.len()].copy_from_slice(bytes);
        Ok(())
    }

    fn truncate(self, offset: usize) {
        self.0.borrow_mut().truncate(offset);
    }

    fn copy_within(self, src: core::ops::Range<usize>, dest: usize) {
        self.0.borrow_mut().copy_within(src, dest);
    }
}

impl MySQLQuery {
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
        &mut self,
        connection: &MySQLConnection,
        params: &[Value<'_>],
    ) -> Result<(), AnyMySQLError> {
        // A parameter's getter can close the connection, which ends the request.
        if self.status != Status::Binding {
            return Ok(());
        }
        let query = self.query.to_utf8();
        if let Some(statement) = connection.cached_statement(query.slice(), params) {
            let writer = connection.get_writer();
            let mut packet = writer.start(0)?;
            prepared_statement::Execute {
                statement_id: statement.statement_id,
                params,
            }
            .write(writer)?;
            packet.end()?;
            self.statement = Some(statement);
            self.status = Status::Running;
            return Ok(());
        }
        let staged = RefCell::new(Vec::new());
        // The server refuses to prepare more than it can count in 16 bits, and says it better.
        if params.len() <= usize::from(u16::MAX) {
            prepared_statement::Execute {
                statement_id: 0,
                params,
            }
            .write(NewWriterWrap {
                wrapped: Staging(&staged),
            })?;
        }
        self.statement = Some(connection.prepare_statement(query.slice(), params)?);
        self.staged_execute = staged.into_inner();
        self.status = Status::Preparing;
        Ok(())
    }

    /// `false`: the request is `Binding`, the caller reads the parameters and calls `execute`.
    pub(crate) fn start(&mut self, connection: &MySQLConnection) -> Result<bool, AnyMySQLError> {
        if self.flags.simple() {
            let query = self.query.to_utf8();
            mysql_request::execute_query(query.slice(), connection.get_writer())?;
            if strings::contains_char(query.slice(), b';') {
                self.flags.0 |= Flags::SEVERAL_STATEMENTS;
            }
            self.statement = Some(RefPtr::new(MySQLStatement::unprepared()));
            self.status = Status::Running;
            return Ok(true);
        }
        let Some(statement) = &self.statement else {
            self.status = Status::Binding;
            return Ok(false);
        };
        // Its COM_STMT_PREPARE has been answered.
        if !statement.parameter_count_matches() {
            return Err(AnyMySQLError::WrongNumberOfParametersProvided);
        }
        // [0x17] [statement id: 4 bytes] ...
        self.staged_execute[1..5].copy_from_slice(&statement.statement_id.to_le_bytes());
        let writer = connection.get_writer();
        let mut packet = writer.start(0)?;
        writer.write(&self.staged_execute)?;
        packet.end()?;
        self.staged_execute = Vec::new();
        self.status = Status::Running;
        Ok(true)
    }

    pub(crate) fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: None,
            staged_execute: Vec::new(),
            query,
            status: Status::Pending,
            flags: Flags::new(bigint, simple),
        }
    }

    #[inline]
    pub(crate) fn set_result_mode(&mut self, result_mode: SQLQueryResultMode) {
        self.flags.set_result_mode(result_mode);
    }

    /// Returns whether the caller has a result to deliver.
    #[inline]
    pub(crate) fn result(&mut self, is_last_result: bool) -> bool {
        if self.is_completed() {
            return false;
        }
        if self.flags.discard_response() {
            if is_last_result {
                self.end(Status::Fail);
            }
            return false;
        }
        if is_last_result {
            self.end(Status::Success);
        } else {
            self.status = Status::PartialResponse;
        }

        true
    }

    /// The reply to its COM_STMT_PREPARE is complete.
    pub(crate) fn prepared(&mut self) {
        if self.flags.discard_response() {
            self.end(Status::Fail);
        } else {
            self.status = Status::Pending;
        }
    }

    fn end(&mut self, status: Status) {
        self.status = status;
        self.statement = None;
        self.staged_execute = Vec::new();
    }

    /// Returns whether the caller has a rejection to deliver.
    pub(crate) fn fail(&mut self) -> bool {
        if self.is_completed() {
            return false;
        }
        self.end(Status::Fail);

        !self.flags.discard_response()
    }

    /// Stays in flight while the server still answers it: `advance()` would hand the rest of a
    /// `Fail` head's response to the next request. Returns whether to deliver a rejection.
    pub(crate) fn discard_response(&mut self) -> bool {
        if matches!(self.status, Status::Pending | Status::Binding) {
            return self.fail();
        }
        if self.is_completed() {
            return false;
        }
        if self.flags.discard_response() {
            return false;
        }
        self.flags.set_discard_response();

        true
    }

    /// The server runs a query that it has to its end: only an unwritten one is cancelled.
    /// Returns whether the caller has a rejection to deliver.
    pub(crate) fn cancel(&mut self) -> bool {
        match self.status {
            Status::Pending | Status::Binding | Status::Preparing => self.discard_response(),
            Status::Running | Status::PartialResponse | Status::Success | Status::Fail => false,
        }
    }

    #[inline]
    pub(crate) fn is_discarding_response(&self) -> bool {
        self.flags.discard_response()
    }

    #[inline]
    pub(crate) fn is_completed(&self) -> bool {
        self.status == Status::Success || self.status == Status::Fail
    }

    /// The server's next packet answers this request, or its parameters are being read.
    #[inline]
    pub(crate) fn is_in_flight(&self) -> bool {
        match self.status {
            Status::Preparing | Status::Binding | Status::Running | Status::PartialResponse => true,
            Status::Success | Status::Fail | Status::Pending => false,
        }
    }

    /// It is written, and the next request can be written behind it.
    #[inline]
    pub(crate) fn can_be_followed(&self) -> bool {
        matches!(self.status, Status::Running | Status::PartialResponse)
            && self.flags.0 & Flags::SEVERAL_STATEMENTS == 0
    }

    #[inline]
    pub(crate) fn is_pending(&self) -> bool {
        self.status == Status::Pending
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
    pub(crate) fn text(&self) -> &BunString {
        &self.query
    }

    #[inline]
    #[allow(clippy::mut_from_ref)] // goes through a raw intrusive pointer; see SAFETY note below
    pub(crate) fn get_statement(&self) -> Option<&mut MySQLStatement> {
        // SAFETY: kept alive by the ref we hold. Returning `&mut` permits
        // shared mutation through the intrusive pointer; the lifetime is
        // bounded by `&self`, which owns one ref.
        self.statement
            .as_ref()
            .map(|stmt| unsafe { &mut *stmt.as_ptr() })
    }

    pub(crate) fn statement_ref(&self) -> Option<RefPtr<MySQLStatement>> {
        self.statement.clone()
    }
}
