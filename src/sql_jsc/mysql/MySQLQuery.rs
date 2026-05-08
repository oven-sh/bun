use core::ffi::c_void;
use core::marker::PhantomData;

use crate::jsc::{JSGlobalObject, JSValue, MarkedArgumentBuffer};
use bun_string::String as BunString;

use bun_sql::mysql::mysql_param::Param;
use bun_sql::mysql::mysql_request as mysql_request;
use bun_sql::mysql::mysql_types::FieldType;
use super::my_sql_value::Value;
use bun_sql::mysql::protocol::any_mysql_error::{self as any_mysql_error, AnyMySQLError};
use bun_sql::mysql::protocol::column_definition41::ColumnFlags;
use bun_sql::mysql::protocol::new_writer::{NewWriter, WriterContext};
use bun_sql::mysql::protocol::prepared_statement::{self as prepared_statement, ExecuteParams};
use bun_sql::mysql::query_status::Status;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::mysql::protocol::error_packet_jsc::ErrorPacketJsc;
use crate::mysql::protocol::signature::Signature;
use crate::shared::query_binding_iterator::QueryBindingIterator;
use crate::jsc::js_error_to_mysql;

use super::js_mysql_connection::MySQLConnection;
use super::my_sql_statement::{self as my_sql_statement, ExecutionFlags, MySQLStatement};

bun_core::declare_scope!(MySQLQuery, visible);

macro_rules! debug {
    ($($arg:tt)*) => { bun_core::scoped_log!(MySQLQuery, $($arg)*) };
}

pub struct MySQLQuery {
    // Intrusive refcount (`MySQLStatement::ref_` / `::deref`). Null = none.
    // Zig uses `bun.ptr.RefCount` and mutates `stmt.status` / `stmt.execution_flags`
    // in place; the connection's `PreparedStatementsMap` also stores `*mut MySQLStatement`,
    // so this pointer participates in the same intrusive ownership graph (each holder
    // owns one ref).
    statement: *mut MySQLStatement,
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
        // result_mode bits were written from a valid SQLQueryResultMode
        // discriminant (`set_result_mode`); 3-variant exhaustive match.
        match (self.0 & Self::RESULT_MODE_MASK) >> Self::RESULT_MODE_SHIFT {
            1 => SQLQueryResultMode::Values,
            2 => SQLQueryResultMode::Raw,
            _ => SQLQueryResultMode::Objects,
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

        self.status = Status::Binding;
        Ok(params)
    }

    /// `statement` is a raw `*mut MySQLStatement` (not `&mut`) because the sole caller,
    /// `run_prepared_query`, must derive it from `self.statement` and then call this
    /// `&mut self` method — a `&mut MySQLStatement` rooted in `*self` would overlap that
    /// reborrow. The Zig original (.zig:59) likewise passes an independent `*MySQLStatement`.
    fn bind_and_execute<C: WriterContext>(
        &mut self,
        writer: NewWriter<C>,
        statement: *mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
    ) -> Result<(), AnyMySQLError> {
        {
            // SAFETY: `statement` is non-null and kept alive by the intrusive ref held in
            // `self.statement` for the duration of this call; no other `&mut` to it
            // exists (caller passes the raw pointer before reborrowing `self`). This
            // block only reads.
            let stmt = unsafe { &*statement };
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
        struct Ctx<'a, C: WriterContext> {
            this: &'a mut MySQLQuery,
            writer: NewWriter<C>,
            statement: *mut MySQLStatement,
            global_object: &'a JSGlobalObject,
            binding_value: JSValue,
            columns_value: JSValue,
            result: Result<(), AnyMySQLError>,
        }

        // TODO(port): `MarkedArgumentBuffer::run` expects an `extern "C" fn(*mut Ctx, *mut MarkedArgumentBuffer)`.
        // A generic `extern "C" fn` is fine (monomorphized per `C`), but Phase B must confirm the
        // bun_jsc API shape — it may instead take a Rust closure and handle the trampoline internally.
        extern "C" fn run<C: WriterContext>(ctx: *mut Ctx<'_, C>, roots: *mut MarkedArgumentBuffer) {
            // SAFETY (single-owner): `ctx` points at the caller's stack-local `Ctx`; the only
            // Rust borrow of it was the ephemeral `&mut ctx as *mut _` used to derive this
            // pointer at the `MarkedArgumentBuffer::run` call site, so no other `&mut` aliases
            // it for the duration of this callback. `roots` points at a C++-stack-allocated
            // `JSC::MarkedArgumentBuffer` that the trampoline hands exclusively to this
            // callback and never re-enters; both outlive this call.
            let ctx = unsafe { &mut *ctx };
            let roots = unsafe { &mut *roots };
            ctx.result = MySQLQuery::bind_and_execute_impl(
                ctx.this,
                ctx.writer,
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
        MarkedArgumentBuffer::run(&mut ctx, run::<C>);
        ctx.result
    }

    fn bind_and_execute_impl<C: WriterContext>(
        &mut self,
        writer: NewWriter<C>,
        statement: *mut MySQLStatement,
        global_object: &JSGlobalObject,
        binding_value: JSValue,
        columns_value: JSValue,
        roots: &mut MarkedArgumentBuffer,
    ) -> Result<(), AnyMySQLError> {
        // SAFETY: `statement` was copied from `self.statement` by `run_prepared_query`;
        // the intrusive ref held there keeps the allocation alive across this call. The
        // caller passes the raw pointer before reborrowing `self`, so this is the only
        // live mutable access path to the statement for the duration of this function
        // (matches Zig .zig:74 which takes an independent `*MySQLStatement`).
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

        // Thunks bridging the higher-tier `Value` into the lower-tier `ExecuteParams`
        // hooks (which can't name `Value` directly across crates).
        fn is_null_thunk(ctx: *mut c_void, i: usize) -> bool {
            // SAFETY: `ctx` is `params.as_ptr()` and `i < params.len()` (asserted by
            // the `len` field passed alongside, checked in `Execute::write_internal`).
            unsafe { matches!(*ctx.cast::<Value>().add(i), Value::Null) }
        }
        fn to_data_thunk(
            ctx: *mut c_void,
            i: usize,
            ft: FieldType,
        ) -> Result<bun_sql::shared::Data, any_mysql_error::Error> {
            // SAFETY: same as `is_null_thunk`.
            unsafe { (*ctx.cast::<Value>().add(i)).to_data(ft) }
        }

        let execute = prepared_statement::Execute {
            statement_id: statement.statement_id,
            flags: 0,
            iteration_count: 1,
            param_types: &statement.signature.fields,
            new_params_bind_flag: statement
                .execution_flags
                .contains(ExecutionFlags::NEED_TO_SEND_PARAMS),
            params: ExecuteParams {
                len: params.len(),
                ctx: params.as_ptr().cast_mut().cast::<c_void>(),
                is_null: is_null_thunk,
                to_data: to_data_thunk,
                _marker: PhantomData,
            },
        };

        let mut packet = writer.start(0)?;
        execute.write(writer)?;
        packet.end()?;
        statement
            .execution_flags
            .remove(ExecutionFlags::NEED_TO_SEND_PARAMS);
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
        if self.statement.is_null() {
            // Zig: `bun.new(MySQLStatement, .{ .signature = .empty(), .status = .parsing, .ref_count = .initExactRefs(1) })`.
            // `heap::alloc` yields a heap allocation with intrusive ref_count == 1
            // (the `Default` impl sets `ref_count = Cell::new(1)`).
            // FRU (`..Default::default()`) is illegal for `Drop` types; mutate instead.
            let mut stmt = Box::new(MySQLStatement::default());
            stmt.signature = Signature::empty();
            stmt.status = my_sql_statement::Status::Parsing;
            self.statement = bun_core::heap::into_raw(stmt);
        }
        mysql_request::execute_query(query_str.slice(), writer)?;

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
        let mut query_str: Option<bun_string::zig_string::Slice> = None;
        // `defer if (query_str) |str| str.deinit()` — deleted: `Utf8Slice` impls `Drop`.

        if self.statement.is_null() {
            let query = self.query.to_utf8();
            let mut signature = match Signature::generate(global_object, query.slice(), binding_value, columns_value) {
                Ok(s) => s,
                Err(err) => {
                    if !global_object.has_exception() {
                        // PORT NOTE: Zig calls `AnyMySQLError.mysqlErrorToJS` here, but the
                        // Rust `Signature::generate` returns a wider `bun_core::Error`. Use
                        // `throw_error` (which builds an `Error` instance from the error
                        // name + message) instead of forcing into the MySQL enum.
                        let _ = global_object.throw_error(err, "failed to generate signature");
                    }
                    return Err(bun_core::err!("JSError"));
                }
            };
            query_str = Some(query);
            // errdefer signature.deinit() — `Signature: Drop` handles the error path; on the
            // found_existing success path below we explicitly drop it (Zig calls deinit + reassigns empty).
            let entry = match connection.get_statement_from_signature_hash(bun_wyhash::hash(&signature.name)) {
                Ok(e) => e,
                Err(err) => {
                    let _ = global_object.throw_error(err, "failed to allocate statement");
                    return Err(bun_core::err!("JSError"));
                }
            };

            if entry.found_existing {
                let stmt: *mut MySQLStatement = *entry.value_ptr;
                // SAFETY: `found_existing` ⇒ the map already holds a live, ref-counted
                // `*mut MySQLStatement`; this thread is the only mutator.
                if unsafe { (*stmt).status } == my_sql_statement::Status::Failed {
                    // SAFETY: same as above.
                    let error_response = unsafe { (*stmt).error_response.to_js(global_object) };
                    // If the statement failed, we need to throw the error
                    let _ = global_object.throw_value(error_response);
                    return Err(bun_core::err!("JSError"));
                }
                // Zig: `this.#statement = stmt; stmt.ref();`
                self.statement = stmt;
                // SAFETY: `stmt` is a live boxed `MySQLStatement` (owned by the map).
                unsafe { (*stmt).ref_() };
                drop(signature);
                signature = Signature::default();
                let _ = signature; // matches Zig reassign-to-empty; silences unused.
            } else {
                // Zig: `bun.new(MySQLStatement, .{ .ref_count = .initExactRefs(2), ... })`
                // — one ref for `self.statement`, one for the map entry.
                // FRU (`..Default::default()`) is illegal for `Drop` types; mutate instead.
                let mut stmt = Box::new(MySQLStatement::default());
                stmt.signature = signature;
                stmt.status = my_sql_statement::Status::Pending;
                stmt.statement_id = 0;
                stmt.init_exact_refs(2);
                let stmt = bun_core::heap::into_raw(stmt);
                self.statement = stmt;
                *entry.value_ptr = stmt;
            }
        }
        let stmt: *mut MySQLStatement = self.statement;
        debug_assert!(!stmt.is_null(), "set above");
        // SAFETY: `stmt` is non-null and kept alive by the intrusive ref in
        // `self.statement`; this thread is the only mutator.
        match unsafe { (*stmt).status } {
            my_sql_statement::Status::Failed => {
                debug!("failed");
                // SAFETY: `stmt` is live (intrusive ref held by `self.statement`).
                let error_response = unsafe { (*stmt).error_response.to_js(global_object) };
                // If the statement failed, we need to throw the error
                let _ = global_object.throw_value(error_response);
                return Err(bun_core::err!("JSError"));
            }
            my_sql_statement::Status::Prepared => {
                if connection.can_pipeline() {
                    debug!("bindAndExecute");
                    let writer = connection.get_writer();
                    // Pass the raw `*mut MySQLStatement` separately from `&mut self`
                    // (matches Zig .zig:183/195 which passes an independent `*MySQLStatement`).
                    if let Err(err) =
                        self.bind_and_execute(writer, stmt, global_object, binding_value, columns_value)
                    {
                        if !global_object.has_exception() {
                            let _ = global_object.throw_value(mysql_error_to_js(
                                global_object,
                                Some(b"failed to bind and execute query"),
                                err,
                            ));
                        }
                        return Err(bun_core::err!("JSError"));
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
                        let _ = global_object.throw_error(err, "failed to prepare query");
                        return Err(bun_core::err!("JSError"));
                    }
                    // SAFETY: `stmt` is live (intrusive ref held by `self.statement`).
                    unsafe { (*stmt).status = my_sql_statement::Status::Parsing };
                }
            }
        }
        Ok(())
    }

    /// Takes ownership of `query` (caller must have already ref'd it, e.g. via
    /// `JSValue.toBunString`). `cleanup()` will deref it exactly once.
    pub fn init(query: BunString, bigint: bool, simple: bool) -> Self {
        Self {
            statement: core::ptr::null_mut(),
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
        if !self.statement.is_null() {
            let s = self.statement;
            self.statement = core::ptr::null_mut();
            // SAFETY: `s` is a live boxed `MySQLStatement` we held one intrusive ref on.
            unsafe { MySQLStatement::deref(s) };
        }
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
            && !self.statement.is_null()
            // SAFETY: non-null and kept alive by the intrusive ref in `self.statement`.
            && unsafe { (*self.statement).status } == my_sql_statement::Status::Parsing
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
            if !self.statement.is_null() {
                // SAFETY: non-null and kept alive by the intrusive ref in
                // `self.statement`; this thread is the only mutator (matches Zig
                // shared `*MySQLStatement` mutation).
                let statement = unsafe { &mut *self.statement };
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
    pub fn get_statement(&self) -> Option<&mut MySQLStatement> {
        // SAFETY: when non-null, `self.statement` is a live boxed `MySQLStatement`
        // kept alive by the intrusive ref we hold. Returning `&mut` mirrors Zig's
        // `?*MySQLStatement` (shared mutation through the intrusive pointer); the
        // lifetime is bounded by `&self`, which owns one ref.
        unsafe { self.statement.as_mut() }
    }
}

// ported from: src/sql_jsc/mysql/MySQLQuery.zig
