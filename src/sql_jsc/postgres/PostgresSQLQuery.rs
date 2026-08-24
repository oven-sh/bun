use core::cell::Cell;
use core::mem;

use crate::error::ThrowSqlError;
use crate::jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsRef, JsResult, VirtualMachineSqlExt as _,
};
use crate::shared::query_ctor_args::QueryCtorArgs;
use bun_core::String as BunString;
use bun_jsc::JsCell;
use bun_ptr::{BackRef, RefPtr, ThisPtr};

use super::PostgresSQLConnection;
use super::PostgresSQLStatement;
use super::Signature;
use super::command_tag_jsc::CommandTagJsc;
use super::error_jsc::postgres_error_to_js;
use super::postgres_request as PostgresRequest;
use super::postgres_sql_connection;
use super::postgres_sql_statement::Status as StatementStatus;
use bun_sql::postgres::CommandTag;
use bun_sql::postgres::PostgresProtocol as protocol;
use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::SQLQueryResultMode as PostgresSQLQueryResultMode;

bun_core::declare_scope!(Postgres, visible);

pub use crate::jsc::codegen::JSPostgresSQLQuery as js;

//
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut PostgresSQLQuery` —
// `&mut T` auto-derefs to `&T` so the impls below compile against either.
// `UnsafeCell` (which both `Cell` and `JsCell` wrap) suppresses LLVM `noalias`
// on `&T`, structurally eliminating the PROVEN_CACHED miscompiles that the
// previous `from_mut(self)` raw-pointer dances papered over.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLQuery {
    /// The ref this query holds on its statement (also referenced by the
    /// connection's prepared-statement map for named statements).
    pub(crate) statement: JsCell<Option<RefPtr<PostgresSQLStatement>>>,
    pub(crate) query: BunString,

    pub(crate) this_value: JsCell<JsRef>,

    pub(crate) status: Cell<Status>,

    // Intrusive single-thread refcount (`CellRefCounted`): held as `RefPtr`
    // (connection request queue, JS wrapper) / `ref_guard()` (re-entrant paths).
    ref_count: Cell<u32>,

    pub(crate) flags: Cell<Flags>,
    /// This allocation's root pointer, for the `&self` paths that take refs
    /// on it (`ref_guard`, the connection's request queue).
    this_ptr: Cell<Option<BackRef<PostgresSQLQuery, bun_ptr::Root>>>,
}

impl Drop for PostgresSQLQuery {
    fn drop(&mut self) {
        self.release_statement();
    }
}

impl PostgresSQLQuery {
    /// Heap-allocate a query; the returned ref is the one its JS wrapper
    /// adopts (`js::to_js`; released by `finalize`).
    fn new(query: BunString, flags: Flags) -> ThisPtr<Self> {
        let this = RefPtr::new(Self {
            statement: JsCell::new(None),
            query,
            this_value: JsCell::new(JsRef::empty()),
            status: Cell::new(Status::Pending),
            ref_count: Cell::new(1),
            flags: Cell::new(flags),
            this_ptr: Cell::new(None),
        })
        .into_this_ptr();
        this.this_ptr.set(Some(this.into()));
        this
    }
}

// Note: a plain struct with public
// fields because `PostgresSQLConnection.rs` reads/writes these directly
// (`req.flags.simple`, `req.flags.binary = ...`, `req.flags.result_mode`).
// Bit-packing is not load-bearing here.
#[derive(Clone, Copy)]
pub struct Flags {
    pub(crate) is_done: bool,
    pub(crate) binary: bool,
    pub(crate) bigint: bool,
    pub(crate) simple: bool,
    /// Which connection counter this request's dispatch incremented; reset to
    /// `None` when `finish_request` consumes that contribution, so the
    /// decrement is idempotent across its call sites.
    pub(crate) counter: RequestCounter,
    pub(crate) result_mode: PostgresSQLQueryResultMode,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RequestCounter {
    None,
    /// `PostgresSQLConnection::nonpipelinable_requests`
    Nonpipelinable,
    /// `PostgresSQLConnection::pipelined_requests`
    Pipelined,
}

impl Default for Flags {
    fn default() -> Self {
        Self {
            is_done: false,
            binary: false,
            bigint: false,
            simple: false,
            counter: RequestCounter::None,
            result_mode: PostgresSQLQueryResultMode::Objects,
        }
    }
}

pub use bun_sql::shared::query_status::Status;

impl PostgresSQLQuery {
    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the `Cell<Flags>` through `&self`.
    #[inline]
    pub(crate) fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// This allocation's root pointer (see the `this_ptr` field).
    #[inline]
    pub(crate) fn this_ptr(&self) -> ThisPtr<Self> {
        self.this_ptr
            .get()
            .expect("PostgresSQLQuery used before PostgresSQLQuery::new")
            .this_ptr()
    }

    /// Holds a ref on `self` for the guard's scope.
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        RefPtr::from_this(self.this_ptr())
    }

    /// This query's statement, if it has one yet.
    #[inline]
    pub(crate) fn statement(&self) -> Option<&PostgresSQLStatement> {
        self.statement.get().as_deref()
    }

    /// Release the ref this query holds on its `statement`, clearing the field.
    #[inline]
    pub(crate) fn release_statement(&self) {
        drop(self.statement.replace(None));
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub(crate) fn get_target(
        &self,
        global_object: &JSGlobalObject,
        clean_target: bool,
    ) -> Option<JSValue> {
        let this_value = self.this_value.get().try_get()?;
        let target = js::target_get_cached(this_value)?;
        if clean_target {
            js::target_set_cached(this_value, global_object, JSValue::ZERO);
        }
        Some(target)
    }

    /// Runs before the JS wrapper's ref is dropped.
    pub fn finalize(&self) {
        bun_core::scoped_log!(Postgres, "PostgresSQLQuery finalize");
        self.this_value.with_mut(|r| r.finalize());
    }

    pub(crate) fn on_write_fail(
        &self,
        err: AnyPostgresError,
        global_object: &JSGlobalObject,
        queries_array: JSValue,
    ) {
        // R-2: every field touched below is `Cell`/`JsCell`-backed, so `&self`
        // is sufficient and `noalias` is suppressed. `ref_guard()` brackets the
        // JS-re-entrant `run_callback` so a re-entrant `deref()` cannot free
        // `*self` mid-body.
        let _guard = self.ref_guard();
        self.status.set(Status::Fail);
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        let vm = crate::jsc::VirtualMachine::get();
        let function = vm
            .with_sql_state(|s| s.postgresql_context.on_query_reject_fn.get())
            .unwrap();
        let event_loop = vm.event_loop_mut();
        let js_err = postgres_error_to_js(global_object, None, err);
        event_loop.run_callback(
            function,
            global_object,
            this_value,
            &[
                target_value,
                js_err.to_error().unwrap_or(js_err),
                queries_array,
            ],
        );
    }

    pub(crate) fn on_js_error(&self, err: JSValue, global_object: &JSGlobalObject) {
        // R-2: see `on_write_fail` — `&self` + Cell/JsCell, `ref_guard()` brackets re-entry.
        let _guard = self.ref_guard();
        self.status.set(Status::Fail);
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        let vm = crate::jsc::VirtualMachine::get();
        let function = vm
            .with_sql_state(|s| s.postgresql_context.on_query_reject_fn.get())
            .unwrap();
        let event_loop = vm.event_loop_mut();
        event_loop.run_callback(
            function,
            global_object,
            this_value,
            &[target_value, err.to_error().unwrap_or(err)],
        );
    }

    pub(crate) fn on_error(
        &self,
        err: &super::postgres_sql_statement::Error,
        global_object: &JSGlobalObject,
    ) {
        let Ok(e) = err.to_js(global_object) else {
            return;
        };
        self.on_js_error(e, global_object);
    }

    pub(crate) fn allow_gc(this_value: JSValue, global_object: &JSGlobalObject) {
        if this_value.is_empty() {
            return;
        }

        this_value.ensure_still_alive();
        js::binding_set_cached(this_value, global_object, JSValue::ZERO);
        js::pending_value_set_cached(this_value, global_object, JSValue::ZERO);
        js::target_set_cached(this_value, global_object, JSValue::ZERO);
    }

    pub(crate) fn on_result(
        &self,
        command_tag_str: &[u8],
        global_object: &JSGlobalObject,
        connection: JSValue,
        is_last: bool,
    ) {
        // R-2: see `on_write_fail` — `&self` + Cell/JsCell, `ref_guard()` brackets re-entry.
        let _guard = self.ref_guard();
        self.status.set(if is_last {
            Status::Success
        } else {
            Status::PartialResponse
        });
        let tag = CommandTag::init(command_tag_str);
        let js_tag: JSValue = match tag.to_js_tag(global_object) {
            Ok(v) => v,
            Err(e) => return self.on_js_error(global_object.take_exception(e), global_object),
        };
        js_tag.ensure_still_alive();

        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _last = scopeguard::guard((), |_| {
            if is_last {
                Self::allow_gc(this_value, global_object);
                self.this_value.with_mut(|r| r.downgrade());
            }
        });
        let Some(target_value) = self.get_target(global_object, is_last) else {
            return;
        };

        let vm = crate::jsc::VirtualMachine::get();
        let function = vm
            .with_sql_state(|s| s.postgresql_context.on_query_resolve_fn.get())
            .unwrap();
        let event_loop = vm.event_loop_mut();

        event_loop.run_callback(
            function,
            global_object,
            this_value,
            &[
                target_value,
                js::pending_value_take_cached(this_value, global_object)
                    .unwrap_or(JSValue::UNDEFINED),
                js_tag,
                tag.to_js_number(),
                if connection.is_empty() {
                    JSValue::UNDEFINED
                } else {
                    postgres_sql_connection::js::queries_get_cached(connection)
                        .unwrap_or(JSValue::UNDEFINED)
                },
                JSValue::from(is_last),
            ],
        );
    }

    pub fn constructor(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<*mut PostgresSQLQuery> {
        let _ = callframe;
        Err(global_this.throw(format_args!(
            "PostgresSQLQuery cannot be constructed directly"
        )))
    }

    pub fn estimated_size(&self) -> usize {
        mem::size_of::<PostgresSQLQuery>()
    }

    // Registered directly as `createQuery` via
    // `put_host_functions!` in `postgres.rs`, so no exported symbol is needed.
    pub(crate) fn call(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let QueryCtorArgs {
            query,
            values,
            pending_value,
            columns,
            bigint,
            simple,
        } = QueryCtorArgs::parse(global_this, callframe.arguments())?;

        let this = PostgresSQLQuery::new(
            query.to_bun_string(global_this)?,
            Flags {
                bigint,
                simple,
                ..Default::default()
            },
        );

        // The JS wrapper adopts the allocation's first ref.
        let this_value = js::to_js(this.as_ptr(), global_this);
        this_value.ensure_still_alive();
        this.this_value.set(JsRef::init_weak(this_value));

        js::binding_set_cached(this_value, global_this, values);
        js::pending_value_set_cached(this_value, global_this, pending_value);
        if !columns.is_undefined() {
            js::columns_set_cached(this_value, global_this, columns);
        }

        Ok(this_value)
    }

    pub fn do_done(
        this: &Self,
        global_object: &JSGlobalObject,
        _: &CallFrame,
    ) -> JsResult<JSValue> {
        let _ = global_object;
        this.update_flags(|f| f.is_done = true);
        Ok(JSValue::UNDEFINED)
    }

    pub fn set_pending_value_from_js(
        _this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = callframe.argument(0);
        let this_value = callframe.this();
        js::pending_value_set_cached(this_value, global_object, result);
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

        let mode = js_mode.coerce::<i32>(global_object)?;
        let result_mode = match mode {
            0 => PostgresSQLQueryResultMode::Objects,
            1 => PostgresSQLQueryResultMode::Values,
            2 => PostgresSQLQueryResultMode::Raw,
            _ => {
                return Err(
                    global_object.throw_invalid_argument_type_value(b"mode", b"Number", js_mode)
                );
            }
        };
        this.update_flags(|f| f.result_mode = result_mode);
        Ok(JSValue::UNDEFINED)
    }

    // The connection's request queue takes its own ref on `this` (`RefPtr::from_this`)
    // once the query is enqueued; the JS wrapper (on-stack for this call) holds the other.
    pub fn do_run(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        // `from_js_ref` wraps the m_ctx payload in a `ParentRef` — the JS wrapper
        // is on-stack (rooted by `arguments[0]`) so GC cannot finalize it for the
        // duration of this call, satisfying the `ParentRef` outlives-holder
        // invariant. R-2: shared borrow — every connection field accessed below is
        // `Cell`/`JsCell`.
        let Some(connection) = postgres_sql_connection::js::from_js_ref(arguments[0]) else {
            return Err(
                global_object.throw(format_args!("connection must be a PostgresSQLConnection"))
            );
        };
        let connection: &PostgresSQLConnection = &connection;

        let query = arguments[1];

        if !query.is_object() {
            return Err(global_object.throw_invalid_argument_type("run", "query", "Query"));
        }

        let this_value = callframe.this();
        let binding_value = js::binding_get_cached(this_value).unwrap_or_default();
        let query_str = this.query.to_utf8();
        // query_str: Utf8Slice<'_> — Drop frees.
        let writer = connection.writer();
        // Shared cleanup for every error-return path below: drop any statement
        // ref this query took.
        let release_query_ref = || {
            this.release_statement();
        };
        // Shared error tail: throw `err` as a postgres error unless an exception
        // is already pending.
        let throw_write_error = |msg: &[u8], err: AnyPostgresError| -> JsError {
            if !global_object.has_exception() {
                return global_object.throw_value(postgres_error_to_js(
                    global_object,
                    Some(msg),
                    err,
                ));
            }
            JsError::Thrown
        };

        if this.flags.get().simple {
            bun_core::scoped_log!(Postgres, "executeQuery");

            // Query is simple and it's the only owner of the statement
            this.statement.set(Some(PostgresSQLStatement::new(
                Signature::empty(),
                StatementStatus::Parsing,
            )));

            let can_execute = !connection.has_query_running();
            if can_execute {
                if let Err(err) = PostgresRequest::execute_query(query_str.slice(), writer) {
                    release_query_ref();
                    return Err(throw_write_error(b"failed to execute query", err));
                }
                {
                    let mut f = connection.flags.get();
                    f.set(ConnectionFlags::IS_READY_FOR_QUERY, false);
                    connection.flags.set(f);
                }
                connection
                    .nonpipelinable_requests
                    .set(connection.nonpipelinable_requests.get() + 1);
                this.update_flags(|f| f.counter = RequestCounter::Nonpipelinable);
                this.status.set(Status::Running);
            } else {
                this.status.set(Status::Pending);
            }
            if !connection.enqueue_request(this.this_ptr()) {
                release_query_ref();
                return Err(global_object.throw_out_of_memory());
            }
            if this.status.get() == Status::Pending {
                connection.note_request_pending();
            }

            // Request is enqueued: keep the event loop alive until the server
            // responds. KeepAlive is a flag (not a count), so taking this any
            // earlier would leave it stuck Active on the synchronous-error
            // returns above.
            connection.poll_ref.with_mut(|r| {
                r.ref_(bun_io::posix_event_loop::get_vm_ctx(
                    bun_io::AllocatorType::Js,
                ))
            });

            this.this_value.with_mut(|r| r.upgrade(global_object));
            js::target_set_cached(this_value, global_object, query);
            if this.status.get() == Status::Running {
                connection.flush_data_and_reset_timeout();
            } else {
                connection.reset_connection_timeout();
            }
            return Ok(JSValue::UNDEFINED);
        }

        let columns_value: JSValue =
            js::columns_get_cached(this_value).unwrap_or(JSValue::UNDEFINED);

        let signature = match Signature::generate(
            global_object,
            query_str.slice(),
            binding_value,
            columns_value,
            connection.prepared_statement_id.get(),
            connection
                .flags
                .get()
                .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS),
        ) {
            Ok(s) => s,
            Err(err) => {
                if !global_object.has_exception() {
                    return Err(global_object.throw_sql_error(err, "failed to generate signature"));
                }
                return Err(JsError::Thrown);
            }
        };

        let has_params = signature.fields.len() > 0;
        let mut did_write = false;
        'enqueue: {
            // Whether `connection.statements` has a slot reserved under
            // `signature.name` for the statement this query will create.
            let mut has_connection_entry = false;
            if !connection
                .flags
                .get()
                .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
            {
                // Zero-allocation hit probe: `get_or_put` below boxes the key
                // bytes even when the entry already exists, and a hit (an
                // already-prepared named statement) is the steady state.
                let existing_stmt = connection
                    .statements
                    .get()
                    .get(&signature.name[..])
                    .and_then(|slot| slot.as_ref().cloned());
                if let Some(stmt) = existing_stmt {
                    // This query's ref on the shared statement.
                    this.statement.set(Some(stmt));
                    let stmt = this.statement().expect("statement set above");
                    drop(signature);

                    match stmt.status.get() {
                        StatementStatus::Failed => {
                            // `error_response` is `Some` when status == Failed.
                            let error_response = stmt.error_response_to_js(global_object);
                            this.release_statement();
                            return Err(global_object.throw_value(error_response?));
                        }
                        StatementStatus::Prepared => {
                            // Only write ahead of the FIFO drain when every queued
                            // request has already emitted its bytes; otherwise this
                            // Bind+Execute would overtake an earlier unwritten
                            // request on the wire while reply attribution stays FIFO.
                            if (!connection.has_query_running() || connection.can_pipeline())
                                && connection.pending_requests.get() == 0
                            {
                                this.update_flags(|f| f.binary = !stmt.fields.get().is_empty());
                                bun_core::scoped_log!(Postgres, "bindAndExecute");

                                // bindAndExecute will bind + execute, it will change to running after binding is complete
                                if let Err(err) = PostgresRequest::bind_and_execute(
                                    global_object,
                                    stmt,
                                    binding_value,
                                    columns_value,
                                    writer,
                                ) {
                                    release_query_ref();
                                    return Err(throw_write_error(
                                        b"failed to bind and execute query",
                                        err,
                                    ));
                                }
                                {
                                    let mut f = connection.flags.get();
                                    f.set(ConnectionFlags::IS_READY_FOR_QUERY, false);
                                    connection.flags.set(f);
                                }
                                this.status.set(Status::Binding);
                                this.update_flags(|f| f.counter = RequestCounter::Pipelined);
                                connection
                                    .pipelined_requests
                                    .set(connection.pipelined_requests.get() + 1);

                                did_write = true;
                            }
                        }
                        StatementStatus::Parsing | StatementStatus::Pending => {}
                    }

                    break 'enqueue;
                }
                // Reserve the map slot now (empty) so an allocation failure
                // surfaces before anything is written; filled in below once
                // the statement exists.
                if let Err(err) = connection
                    .statements
                    .with_mut(|s| s.get_or_put(&signature.name).map(|_| ()))
                {
                    drop(signature);
                    release_query_ref();
                    return Err(global_object
                        .throw_error(crate::Error::from(err), "failed to allocate statement"));
                }
                has_connection_entry = true;
            }
            let can_execute = !connection.has_query_running();

            if can_execute {
                // If it does not have params, we can write and execute immediately in one go
                if !has_params {
                    bun_core::scoped_log!(Postgres, "prepareAndQueryWithSignature");
                    // prepareAndQueryWithSignature will write + bind + execute, it will change to running after binding is complete
                    if let Err(err) = PostgresRequest::prepare_and_query_with_signature(
                        global_object,
                        query_str.slice(),
                        binding_value,
                        writer,
                        &signature,
                    ) {
                        if has_connection_entry {
                            let _ = connection
                                .statements
                                .with_mut(|m| m.remove(&signature.name[..]));
                        }
                        drop(signature);
                        release_query_ref();
                        return Err(throw_write_error(b"failed to prepare and query", err));
                    }
                    {
                        let mut f = connection.flags.get();
                        f.set(ConnectionFlags::IS_READY_FOR_QUERY, false);
                        f.set(ConnectionFlags::WAITING_TO_PREPARE, true);
                        connection.flags.set(f);
                    }
                    this.status.set(Status::Binding);
                    did_write = true;
                } else if !connection
                    .flags
                    .get()
                    .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS)
                {
                    // Named prepared statements: send Parse+Describe+Sync now and wait
                    // for ParameterDescription before sending Bind+Execute in advance().
                    bun_core::scoped_log!(Postgres, "writeQuery");

                    if let Err(err) = PostgresRequest::write_query(
                        query_str.slice(),
                        &signature.prepared_statement_name,
                        &signature.fields,
                        writer,
                    ) {
                        if has_connection_entry {
                            let _ = connection
                                .statements
                                .with_mut(|m| m.remove(&signature.name[..]));
                        }
                        drop(signature);
                        release_query_ref();
                        return Err(throw_write_error(b"failed to write query", err));
                    }
                    if let Err(err) = writer.write(&protocol::SYNC) {
                        if has_connection_entry {
                            let _ = connection
                                .statements
                                .with_mut(|m| m.remove(&signature.name[..]));
                        }
                        drop(signature);
                        release_query_ref();
                        return Err(throw_write_error(b"failed to flush", err));
                    }
                    {
                        let mut f = connection.flags.get();
                        f.set(ConnectionFlags::IS_READY_FOR_QUERY, false);
                        f.set(ConnectionFlags::WAITING_TO_PREPARE, true);
                        connection.flags.set(f);
                    }
                    did_write = true;
                }
                // Unnamed prepared statements with params: skip writeQuery+Sync here.
                // advance() will send Parse+Describe+Bind+Execute atomically via
                // parseAndBindAndExecute(), preventing PgBouncer from splitting them.
            }
            {
                let stmt = PostgresSQLStatement::new(
                    signature,
                    if did_write {
                        StatementStatus::Parsing
                    } else {
                        StatementStatus::Pending
                    },
                );
                // we only have a connection entry if we are using named prepared statements
                if has_connection_entry {
                    connection
                        .prepared_statement_id
                        .set(connection.prepared_statement_id.get() + 1);
                    // Two refs: one for this.statement, one for the
                    // connection.statements map slot reserved above.
                    let for_map = stmt.clone();
                    connection.statements.with_mut(|m| {
                        match m.get_mut(&for_map.signature.name[..]) {
                            Some(slot @ None) => *slot = Some(for_map),
                            // Gone, or already filled by a re-entrant run.
                            _ => drop(for_map),
                        }
                    });
                }
                this.statement.set(Some(stmt));
            }
        }

        if !connection.enqueue_request(this.this_ptr()) {
            release_query_ref();
            return Err(global_object.throw_out_of_memory());
        }
        if this.status.get() == Status::Pending {
            connection.note_request_pending();
        }
        // Request is enqueued: keep the event loop alive until the server
        // responds. See the matching call in the simple-query branch above
        // for why this must come after every fallible step.
        connection.poll_ref.with_mut(|r| {
            r.ref_(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });

        this.this_value.with_mut(|r| r.upgrade(global_object));

        js::target_set_cached(this_value, global_object, query);
        if did_write {
            connection.flush_data_and_reset_timeout();
        } else {
            connection.reset_connection_timeout();
            // For unnamed prepared statements with params, we skip writeQuery+Sync
            // in the enqueue path and let advance() handle it atomically.
            connection.advance_and_flush();
        }
        Ok(JSValue::UNDEFINED)
    }

    pub fn do_cancel(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let _ = callframe;
        let _ = global_object;
        let _ = this;

        Ok(JSValue::UNDEFINED)
    }
}
