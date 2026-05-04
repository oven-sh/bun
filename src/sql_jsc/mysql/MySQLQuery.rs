use core::ffi::c_void;
use std::rc::Rc;

use bun_jsc::{JSGlobalObject, JSValue, MarkedArgumentBuffer};
use bun_str::String as BunString;

use bun_sql::mysql::mysql_request as mysql_request;
use bun_sql::mysql::mysql_types::Value;
use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, AnyMySQLError};
use bun_sql::mysql::protocol::prepared_statement as prepared_statement;
use bun_sql::mysql::query_status::Status;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use crate::mysql::protocol::signature::Signature;
use crate::shared::query_binding_iterator::QueryBindingIterator;

use super::js_mysql_connection::MySQLConnection;
use super::mysql_statement::MySQLStatement;

bun_output::declare_scope!(MySQLQuery, visible);

macro_rules! debug {
    ($($arg:tt)*) => { bun_output::scoped_log!(MySQLQuery, $($arg)*) };
}

pub struct MySQLQuery {
    // TODO(port): LIFETIMES.tsv classifies this as `Option<Rc<MySQLStatement>>`, but the
    // Zig uses intrusive `bun.ptr.RefCount` (ref()/deref()) and mutates `stmt.status` /
    // `stmt.execution_flags` in place. Phase B must decide between `IntrusiveRc<MySQLStatement>`
    // (matches Zig ABI, allows `&mut` via raw ptr) or `Rc<RefCell<MySQLStatement>>`.
    statement: Option<Rc<MySQLStatement>>,
    query: BunString,

    status: Status,
    flags: Flags,
}

/// Zig: `packed struct(u8) { bigint, simple, pipelined: bool, result_mode: SQLQueryResultMode, _padding: u3 }`
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
        // SAFETY: result_mode bits were written from a valid SQLQueryResultMode discriminant.
        unsafe {
            core::mem::transmute::<u8, SQLQueryResultMode>(
                (self.0 & Self::RESULT_MODE_MASK) >> Self::RESULT_MODE_SHIFT,
            )
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
    fn bind(
        &mut self,
        execute: &mut prepared_statement::Execute,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<(), AnyMySQLError> {
        let mut iter = QueryBindingIterator::init(binding_value, columns_value, global_object)?;

        let mut i: u32 = 0;
        let len = execute.param_types.len();
        let mut params: Vec<Value> = Vec::with_capacity(len);
        // errdefer { for params[0..i] deinit; free(params) } — deleted: `Vec<Value>` drops on `?`.

        while let Some(js_value) = iter.next()? {
            if i as usize >= len {
                // The binding array yielded more values than the prepared statement
                // expects. This can happen when the user-supplied array is mutated (e.g.
                // from an index getter) between signature generation and binding. Fail
                // loudly instead of writing past the end of `params`/`param_types`.
                return Err(AnyMySQLError::WrongNumberOfParametersProvided);
            }
            let param = &execute.param_types[i as usize];
            params.push(Value::from_js(
                js_value,
                global_object,
                param.r#type,
                param.flags.unsigned(),
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

        self.status = Status::Binding;
        execute.params = params.into_boxed_slice();
        Ok(())
    }

    fn bind_and_execute<W>(
        &mut self,
        writer: W,
        statement: &mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
    ) -> Result<(), AnyMySQLError> {
        debug_assert!(
            statement.params.len() == statement.params_received as usize && statement.statement_id > 0,
            "statement is not prepared",
        );
        if statement.signature.fields.len() != statement.params.len() {
            return Err(AnyMySQLError::WrongNumberOfParametersProvided);
        }

        // BLOB parameters borrow ArrayBuffer/Blob bytes rather than copying.
        // Converting later parameters can run user JS (index getters, toJSON,
        // toString coercion) which could drop the last reference to an earlier
        // buffer and force GC. Root every borrowed JSValue in a stack-scoped
        // MarkedArgumentBuffer so the wrapper (and its RefPtr<ArrayBuffer>)
        // survives until execute.deinit() has unpinned and released the borrow.
        struct Ctx<'a, W> {
            this: &'a mut MySQLQuery,
            writer: W,
            statement: &'a mut MySQLStatement,
            global_object: &'a JSGlobalObject,
            binding_value: JSValue,
            columns_value: JSValue,
            result: Result<(), AnyMySQLError>,
        }

        // TODO(port): `MarkedArgumentBuffer::run` expects an `extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer)`.
        // A generic `extern "C" fn` is fine (monomorphized per `W`), but Phase B must confirm the
        // bun_jsc API shape — it may instead take a Rust closure and handle the trampoline internally.
        extern "C" fn run<W>(ctx: *mut Ctx<'_, W>, roots: *mut MarkedArgumentBuffer) {
            // SAFETY: `ctx` and `roots` are valid for the duration of `MarkedArgumentBuffer::run`;
            // the buffer is stack-scoped on the C++ side and outlives this call.
            let ctx = unsafe { &mut *ctx };
            let roots = unsafe { &mut *roots };
            ctx.result = MySQLQuery::bind_and_execute_impl(
                ctx.this,
                &mut ctx.writer,
                ctx.statement,
                ctx.global_object,
                ctx.binding_value,
                ctx.columns_value,
                roots,
            );
        }

        let mut ctx = Ctx {
            this: self,
            writer,
            statement,
            global_object,
            binding_value,
            columns_value,
            result: Ok(()),
        };
        MarkedArgumentBuffer::run(&mut ctx as *mut _ as *mut c_void, run::<W>);
        ctx.result
    }

    fn bind_and_execute_impl<W>(
        &mut self,
        writer: &mut W,
        statement: &mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<(), AnyMySQLError> {
        let mut execute = prepared_statement::Execute {
            statement_id: statement.statement_id,
            param_types: statement.signature.fields.clone(), // TODO(port): Zig borrows the slice; Phase B should make `Execute.param_types` a `&[_]`.
            new_params_bind_flag: statement.execution_flags.need_to_send_params,
            iteration_count: 1,
            ..Default::default()
        };
        // `defer execute.deinit()` — deleted: `Execute` impls `Drop`.

        // Bind before touching the writer so a bind failure (user-triggerable via JS
        // getters / param-count mismatch) doesn't leave a partial packet header in
        // the connection's write buffer.
        self.bind(&mut execute, global_object, binding_value, columns_value, roots)?;
        let mut packet = writer.start(0)?;
        execute.write(writer)?;
        packet.end()?;
        statement.execution_flags.need_to_send_params = false;
        self.status = Status::Running;
        Ok(())
    }

    fn run_simple_query(&mut self, connection: &mut MySQLConnection) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if self.status != Status::Pending || !connection.can_execute_query() {
            debug!("cannot execute query");
            // cannot execute query
            return Ok(());
        }
        let query_str = self.query.to_utf8();
        let writer = connection.get_writer();
        if self.statement.is_none() {
            let stmt = Rc::new(MySQLStatement {
                signature: Signature::empty(),
                status: super::mysql_statement::Status::Parsing,
                // TODO(port): Zig sets intrusive `ref_count = .initExactRefs(1)`; with `Rc` the
                // single owner here gives strong_count == 1 implicitly.
                ..Default::default()
            });
            self.statement = Some(stmt);
        }
        mysql_request::execute_query(query_str.as_slice(), writer)?;

        self.status = Status::Running;
        Ok(())
    }

    fn run_prepared_query(
        &mut self,
        connection: &mut MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        let mut query_str: Option<bun_str::Utf8Slice<'_>> = None;
        // `defer if (query_str) |str| str.deinit()` — deleted: `Utf8Slice` impls `Drop`.

        if self.statement.is_none() {
            let query = self.query.to_utf8();
            let mut signature = match Signature::generate(global_object, query.as_slice(), binding_value, columns_value) {
                Ok(s) => s,
                Err(err) => {
                    if !global_object.has_exception() {
                        return global_object
                            .throw_value(any_mysql_error::mysql_error_to_js(global_object, "failed to generate signature", err));
                    }
                    return Err(bun_core::err!("JSError"));
                }
            };
            query_str = Some(query);
            // errdefer signature.deinit() — `Signature: Drop` handles the error path; on the
            // found_existing success path below we explicitly drop it (Zig calls deinit + reassigns empty).
            let entry = match connection.get_statement_from_signature_hash(bun_wyhash::hash(&signature.name)) {
                Ok(e) => e,
                Err(err) => return global_object.throw_error(err, "failed to allocate statement"),
            };

            if entry.found_existing {
                let stmt = entry.value_ptr.clone();
                // TODO(port): mutation through `Rc<MySQLStatement>` — see field note. Reading `status`
                // is fine; Phase B must expose interior mutability or use `IntrusiveRc`.
                if stmt.status == super::mysql_statement::Status::Failed {
                    let error_response = stmt.error_response.to_js(global_object);
                    // If the statement failed, we need to throw the error
                    return global_object.throw_value(error_response);
                }
                // Zig: `this.#statement = stmt; stmt.ref();` — with `Rc`, the clone above IS the ref.
                self.statement = Some(stmt);
                drop(signature);
                signature = Signature::default();
                let _ = signature; // matches Zig reassign-to-empty; silences unused.
            } else {
                let stmt = Rc::new(MySQLStatement {
                    signature,
                    status: super::mysql_statement::Status::Pending,
                    statement_id: 0,
                    // TODO(port): Zig sets intrusive `ref_count = .initExactRefs(2)` (self + map).
                    // With `Rc`, storing two clones below yields strong_count == 2.
                    ..Default::default()
                });
                self.statement = Some(stmt.clone());
                *entry.value_ptr = stmt;
            }
        }
        // TODO(port): `Rc::get_mut` will fail when the connection map also holds a ref. The Zig
        // mutates through a shared `*MySQLStatement`. Phase B: `IntrusiveRc` or `RefCell`.
        let stmt = self.statement.as_ref().expect("set above");
        match stmt.status {
            super::mysql_statement::Status::Failed => {
                debug!("failed");
                let error_response = stmt.error_response.to_js(global_object);
                // If the statement failed, we need to throw the error
                return global_object.throw_value(error_response);
            }
            super::mysql_statement::Status::Prepared => {
                if connection.can_pipeline() {
                    debug!("bindAndExecute");
                    let writer = connection.get_writer();
                    // TODO(port): needs `&mut MySQLStatement`; see field note.
                    let stmt_mut = Rc::get_mut(self.statement.as_mut().unwrap())
                        .expect("TODO(port): shared mutation — switch to IntrusiveRc/RefCell");
                    if let Err(err) =
                        self.bind_and_execute(writer, stmt_mut, global_object, binding_value, columns_value)
                    {
                        if !global_object.has_exception() {
                            return global_object.throw_value(any_mysql_error::mysql_error_to_js(
                                global_object,
                                "failed to bind and execute query",
                                err,
                            ));
                        }
                        return Err(bun_core::err!("JSError"));
                    }
                    self.flags.set_pipelined(true);
                }
            }
            super::mysql_statement::Status::Parsing => {
                debug!("parsing");
            }
            super::mysql_statement::Status::Pending => {
                if connection.can_prepare_query() {
                    debug!("prepareRequest");
                    let writer = connection.get_writer();
                    let query = match query_str.take() {
                        Some(q) => q,
                        None => self.query.to_utf8(),
                    };
                    if let Err(err) =
                        mysql_request::prepare_request(query.as_slice(), writer)
                    {
                        return global_object.throw_error(err, "failed to prepare query");
                    }
                    // TODO(port): needs `&mut MySQLStatement`; see field note.
                    Rc::get_mut(self.statement.as_mut().unwrap())
                        .expect("TODO(port): shared mutation")
                        .status = super::mysql_statement::Status::Parsing;
                }
            }
        }
        Ok(())
    }

    /// Takes ownership of `query` (caller must have already ref'd it, e.g. via
    /// `JSValue.toBunString`). `cleanup()` will deref it exactly once.
    pub fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: None,
            query,
            status: Status::Pending,
            flags: Flags::new(bigint, simple),
        }
    }

    pub fn run_query(
        &mut self,
        connection: &mut MySQLConnection,
        global_object: &JSGlobalObject,
        columns_value: JSValue,
        binding_value: JSValue,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        if self.flags.simple() {
            debug!("runSimpleQuery");
            return self.run_simple_query(connection);
        }
        debug!("runPreparedQuery");
        self.run_prepared_query(
            connection,
            global_object,
            if columns_value.is_empty() { JSValue::UNDEFINED } else { columns_value },
            if binding_value.is_empty() { JSValue::UNDEFINED } else { binding_value },
        )
    }

    #[inline]
    pub fn set_result_mode(&mut self, result_mode: SQLQueryResultMode) {
        self.flags.set_result_mode(result_mode);
    }

    #[inline]
    pub fn result(&mut self, is_last_result: bool) -> bool {
        if self.status == Status::Success || self.status == Status::Fail {
            return false;
        }
        self.status = if is_last_result { Status::Success } else { Status::PartialResponse };

        true
    }

    pub fn fail(&mut self) -> bool {
        if self.status == Status::Fail || self.status == Status::Success {
            return false;
        }
        self.status = Status::Fail;

        true
    }

    pub fn cleanup(&mut self) {
        // Zig: `if (this.#statement) |s| { s.deref(); this.#statement = null; }`
        // With `Rc`, dropping the `Some` IS the deref.
        self.statement = None;
        // Zig: `var q = this.#query; defer q.deref(); this.#query = .empty;`
        // `BunString` derefs on Drop; assigning `empty()` drops the old value.
        self.query = BunString::empty();
    }

    #[inline]
    pub fn is_completed(&self) -> bool {
        self.status == Status::Success || self.status == Status::Fail
    }

    #[inline]
    pub fn is_running(&self) -> bool {
        match self.status {
            Status::Running | Status::Binding | Status::PartialResponse => true,
            Status::Success | Status::Fail | Status::Pending => false,
        }
    }

    #[inline]
    pub fn is_pending(&self) -> bool {
        self.status == Status::Pending
    }

    #[inline]
    pub fn is_being_prepared(&self) -> bool {
        self.status == Status::Pending
            && self
                .statement
                .as_ref()
                .is_some_and(|s| s.status == super::mysql_statement::Status::Parsing)
    }

    #[inline]
    pub fn is_pipelined(&self) -> bool {
        self.flags.pipelined()
    }

    #[inline]
    pub fn is_simple(&self) -> bool {
        self.flags.simple()
    }

    #[inline]
    pub fn is_bigint_supported(&self) -> bool {
        self.flags.bigint()
    }

    #[inline]
    pub fn get_result_mode(&self) -> SQLQueryResultMode {
        self.flags.result_mode()
    }

    #[inline]
    pub fn mark_as_prepared(&mut self) {
        if self.status == Status::Pending {
            if let Some(statement) = self.statement.as_mut() {
                // TODO(port): needs `&mut MySQLStatement`; see field note. Zig always mutates
                // through the shared `*MySQLStatement`; do not silently no-op when the Rc is shared.
                let statement = Rc::get_mut(statement)
                    .expect("TODO(port): shared mutation — switch to IntrusiveRc/RefCell");
                if statement.status == super::mysql_statement::Status::Parsing
                    && statement.params.len() == statement.params_received as usize
                    && statement.statement_id > 0
                {
                    statement.status = super::mysql_statement::Status::Prepared;
                }
            }
        }
    }

    #[inline]
    pub fn get_statement(&self) -> Option<&MySQLStatement> {
        self.statement.as_deref()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql_jsc/mysql/MySQLQuery.zig (334 lines)
//   confidence: medium
//   todos:      15
//   notes:      LIFETIMES.tsv mandates Rc<MySQLStatement> but Zig uses intrusive refcount with shared mutation; Phase B must pick IntrusiveRc or RefCell. MarkedArgumentBuffer::run trampoline shape needs confirming.
// ──────────────────────────────────────────────────────────────────────────
