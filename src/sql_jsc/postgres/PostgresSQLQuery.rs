use core::cell::Cell;
use core::mem;

use crate::error::ThrowSqlError;
use crate::jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsRef, JsResult, VirtualMachineSqlExt as _,
};
use crate::shared::query_ctor_args::QueryCtorArgs;
use bun_core::String as BunString;
use bun_jsc::JsCell;
use bun_ptr::AsCtxPtr;

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
pub use js::to_js;

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
    pub statement: Cell<Option<*mut PostgresSQLStatement>>,
    pub query: BunString,
    pub cursor_name: BunString,

    pub this_value: JsCell<JsRef>,

    pub status: Cell<Status>,

    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread refcount.
    // `#[derive(CellRefCounted)]` provides `ref_()`/`deref()` and the `AnyRefCounted`
    // bridge so `ScopedRef<PostgresSQLQuery>` brackets re-entrant callback paths.
    ref_count: Cell<u32>,

    pub flags: Cell<Flags>,
}

// On drop: deref the statement (if any), then deref query/cursor_name.
// `BunString` is `Copy` (FFI by-value, NO `Drop`), so the
// +1 ref taken by `to_bun_string` in `call()` must be released here explicitly.
// `destroy` is `heap::take` in `deref_`.
impl Drop for PostgresSQLQuery {
    fn drop(&mut self) {
        self.release_statement();
        self.query.deref();
        self.cursor_name.deref();
    }
}

impl Default for PostgresSQLQuery {
    fn default() -> Self {
        Self {
            statement: Cell::new(None),
            query: BunString::empty(),
            cursor_name: BunString::empty(),
            this_value: JsCell::new(JsRef::empty()),
            status: Cell::new(Status::Pending),
            ref_count: Cell::new(1),
            flags: Cell::new(Flags::default()),
        }
    }
}

// Note: a plain struct with public
// fields because `PostgresSQLConnection.rs` reads/writes these directly
// (`req.flags.simple`, `req.flags.binary = ...`, `req.flags.result_mode`).
// Bit-packing is not load-bearing here.
#[derive(Clone, Copy)]
pub struct Flags {
    pub is_done: bool,
    pub binary: bool,
    pub bigint: bool,
    pub simple: bool,
    pub pipelined: bool,
    /// Set when this request's dispatch incremented the connection's
    /// `pipelined_requests` / `nonpipelinable_requests` counter; cleared when
    /// `finish_request` consumes that contribution. Makes the decrement
    /// idempotent across the three `finish_request` call sites.
    pub counted: bool,
    /// Set once the ErrorResponse handler has transparently re-prepared this
    /// request's statement after a 26000/0A000 invalidation, so a second
    /// invalidation on the retry is surfaced instead of looping.
    pub reprepared: bool,
    pub result_mode: PostgresSQLQueryResultMode,
}

impl Default for Flags {
    fn default() -> Self {
        Self {
            is_done: false,
            binary: false,
            bigint: false,
            simple: false,
            pipelined: false,
            counted: false,
            reprepared: false,
            result_mode: PostgresSQLQueryResultMode::Objects,
        }
    }
}

pub use bun_sql::shared::query_status::Status;

impl PostgresSQLQuery {
    // `ref_()`/`deref()` provided by `#[derive(CellRefCounted)]`.

    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the `Cell<Flags>` through `&self`.
    #[inline]
    pub fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// RAII `ref()`/`deref()` bracket around `self`. One audited
    /// `ScopedRef::new` here replaces N per-site
    /// `unsafe { ScopedRef::new(self.as_ctx_ptr()) }` — `&self` is the live
    /// `heap::alloc` payload (held by the connection's request FIFO), so the
    /// [`ScopedRef::new`] precondition (live, non-null) is always satisfied.
    #[inline]
    pub fn ref_guard(&self) -> bun_ptr::ScopedRef<Self> {
        // SAFETY: `&self` ⇒ the allocation is live and non-null.
        unsafe { bun_ptr::ScopedRef::new(self.as_ctx_ptr()) }
    }

    /// Dereference the intrusive `statement` pointer as `&mut`. Mirrors
    /// [`MySQLQuery::get_statement`]: one unchecked deref here replaces N inline
    /// raw-pointer derefs at every protocol dispatch site in
    /// `PostgresSQLConnection::on`.
    ///
    /// SAFETY (encapsulated): when `Some`, the pointer is a live `heap::alloc`
    /// payload kept alive by the intrusive ref this query holds (`ref_()` taken
    /// at `statement.set(Some(_))`). All mutation is single-JS-thread so the
    /// `&mut` is exclusive for the borrow's lifetime; callers must not hold two
    /// results live simultaneously (the request FIFO never does).
    #[inline]
    #[allow(clippy::mut_from_ref)] // intrusive raw pointer; see SAFETY in doc comment
    pub fn statement_mut(&self) -> Option<&mut PostgresSQLStatement> {
        // SAFETY: see doc comment — intrusive ref held by `self` keeps the
        // pointee alive; single-JS-thread exclusivity.
        self.statement.get().map(|p| unsafe { &mut *p })
    }

    /// Release the intrusive ref this query holds on its `statement`, clearing
    /// the field. One audited deref here replaces the per-site
    /// `this.statement.set(None)` + `PostgresSQLStatement::deref(stmt)` pair on
    /// `Drop` and `do_run`'s error paths (6 callers).
    #[inline]
    pub fn release_statement(&self) {
        if let Some(stmt) = self.statement.take() {
            // SAFETY: when `Some`, `stmt` is a live `heap::alloc` payload kept
            // alive by the intrusive ref this query took when it was stored
            // into `self.statement` (`ref_()` / `init_exact_refs`). This
            // releases exactly that ref; may free if no other refs remain.
            unsafe { PostgresSQLStatement::deref(stmt) };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────

    pub fn get_target(
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

    pub fn finalize(self: Box<Self>) {
        bun_core::scoped_log!(Postgres, "PostgresSQLQuery finalize");
        bun_ptr::finalize_js_box(self, |this| this.this_value.with_mut(|r| r.finalize()));
    }

    pub fn on_write_fail(
        &self,
        err: AnyPostgresError,
        global_object: &JSGlobalObject,
        queries_array: JSValue,
    ) {
        // R-2: every field touched below is `Cell`/`JsCell`-backed, so `&self`
        // is sufficient and `noalias` is suppressed. `ScopedRef` brackets the
        // JS-re-entrant `run_callback` so a re-entrant `deref()` cannot free
        // `*self` mid-body.
        let _deref = self.ref_guard();
        self.status.set(Status::Fail);
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM, no other live borrow.
        let vm = crate::jsc::VirtualMachine::get().as_mut();
        let function = vm
            .sql_state()
            .postgresql_context
            .on_query_reject_fn
            .get()
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

    pub fn on_js_error(&self, err: JSValue, global_object: &JSGlobalObject) {
        // R-2: see `on_write_fail` — `&self` + Cell/JsCell, ScopedRef brackets re-entry.
        let _deref = self.ref_guard();
        self.status.set(Status::Fail);
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM, no other live borrow.
        let vm = crate::jsc::VirtualMachine::get().as_mut();
        let function = vm
            .sql_state()
            .postgresql_context
            .on_query_reject_fn
            .get()
            .unwrap();
        let event_loop = vm.event_loop_mut();
        event_loop.run_callback(
            function,
            global_object,
            this_value,
            &[target_value, err.to_error().unwrap_or(err)],
        );
    }

    pub fn on_error(
        &self,
        err: &super::postgres_sql_statement::Error,
        global_object: &JSGlobalObject,
    ) {
        let Ok(e) = err.to_js(global_object) else {
            return;
        };
        self.on_js_error(e, global_object);
    }

    pub fn allow_gc(this_value: JSValue, global_object: &JSGlobalObject) {
        if this_value.is_empty() {
            return;
        }

        this_value.ensure_still_alive();
        js::binding_set_cached(this_value, global_object, JSValue::ZERO);
        js::pending_value_set_cached(this_value, global_object, JSValue::ZERO);
        js::target_set_cached(this_value, global_object, JSValue::ZERO);
    }

    pub fn on_result(
        &self,
        command_tag_str: &[u8],
        global_object: &JSGlobalObject,
        connection: JSValue,
        is_last: bool,
    ) {
        // R-2: see `on_write_fail` — `&self` + Cell/JsCell, ScopedRef brackets re-entry.
        let _deref = self.ref_guard();
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

        // SAFETY: JS-thread only; short-lived `&mut` to the singleton VM, no other live borrow.
        let vm = crate::jsc::VirtualMachine::get().as_mut();
        let function = vm
            .sql_state()
            .postgresql_context
            .on_query_resolve_fn
            .get()
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
    pub fn call(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let QueryCtorArgs {
            query,
            values,
            pending_value,
            columns,
            bigint,
            simple,
        } = QueryCtorArgs::parse(global_this, callframe.arguments())?;

        let ptr = bun_core::heap::into_raw(Box::new(PostgresSQLQuery::default()));

        // SAFETY: ptr was just allocated and is the m_ctx payload; toJS wraps it in the JSCell.
        let this_value = js::to_js(ptr, global_this);
        this_value.ensure_still_alive();

        // SAFETY: ptr is exclusively owned here until returned to JS.
        // Note: `PostgresSQLQuery` implements `Drop`, so functional-record-update
        // (`..Default::default()`) is forbidden (E0509). `ptr` was already
        // `default()`-initialised by `Box::new` above, so just overwrite the
        // three non-default fields in place.
        unsafe {
            (*ptr).query = query.to_bun_string(global_this)?;
            (*ptr).this_value.set(JsRef::init_weak(this_value));
            (*ptr).flags.set(Flags {
                bigint,
                simple,
                ..Default::default()
            });
        }

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

    //
    // Takes `*mut Self` (the JSCell m_ctx payload, i.e. the original `heap::alloc`
    // pointer) rather than `&Self`: `connection.requests.write_item(this_ptr)` below
    // stashes this pointer in a long-lived FIFO, and a `&self`-derived `*mut` would carry
    // borrow-scoped provenance that is invalidated once codegen reuses m_ctx after this
    // call returns (Stacked Borrows). Passing the raw payload pointer through preserves
    // the allocation's root provenance for the queued entry.
    pub fn do_run(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // R-2: `this` is the live m_ctx payload for `callframe.this()`; the JS
        // wrapper is on-stack so GC cannot finalize it. Every mutated field is
        // `Cell`/`JsCell`-backed, so `&Self` suffices. The pointer pushed into
        // `connection.requests` is derived via `core::ptr::from_ref(this).cast_mut()`
        // (write provenance is recovered from the JsCell-backed queue, never from
        // this shared borrow).
        let this_ptr: *mut Self = core::ptr::from_ref(this).cast_mut();
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
        let binding_value = js::binding_get_cached(this_value).unwrap_or(JSValue::ZERO);
        let query_str = this.query.to_utf8();
        // query_str: Utf8Slice<'_> — Drop frees.
        let writer = connection.writer();
        // We need a strong reference to the query so that it doesn't get GC'd
        this.ref_();
        // Shared cleanup for every error-return path below: drop any statement
        // ref this query took plus the speculative `ref_()` above.
        let release_query_ref = || {
            this.release_statement();
            // SAFETY: undoes the speculative `this.ref_()` above; count was ≥2, never frees here.
            unsafe { Self::deref(this_ptr) };
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

            // PostgresSQLStatement is intrusively refcounted; allocate a fresh box and
            // hand ownership to `this.statement` (count = 1).
            // NOTE: PostgresSQLStatement implements Drop, so functional-record-update
            // (`..Default::default()`) is forbidden (E0509). Build + mutate instead.
            let stmt: *mut PostgresSQLStatement = {
                let mut s = PostgresSQLStatement::default();
                s.signature = Signature::empty();
                s.status = StatementStatus::Parsing;
                bun_core::heap::into_raw(Box::new(s))
            };
            // Query is simple and it's the only owner of the statement
            this.statement.set(Some(stmt));

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
                this.update_flags(|f| f.counted = true);
                this.status.set(Status::Running);
            } else {
                this.status.set(Status::Pending);
            }
            if connection
                .requests
                .with_mut(|q| q.write_item(this_ptr))
                .is_err()
            {
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

        let mut signature = match Signature::generate(
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
                // SAFETY: undoes the speculative `this.ref_()` above; count was ≥2, never frees here.
                unsafe { Self::deref(this_ptr) };
                if !global_object.has_exception() {
                    return Err(global_object.throw_sql_error(err, "failed to generate signature"));
                }
                return Err(JsError::Thrown);
            }
        };

        let has_params = signature.fields.len() > 0;
        let mut did_write = false;
        'enqueue: {
            // Note: `connection_entry_value` is a *mut into connection.statements value slot;
            // holding a `&mut` across other &mut connection borrows below trips borrowck, so
            // store the raw `*mut *mut PostgresSQLStatement` and re-dereference at use sites.
            let mut connection_entry_value: Option<*mut *mut PostgresSQLStatement> = None;
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
                    .copied();
                if let Some(stmt_ptr) = existing_stmt {
                    this.statement.set(Some(stmt_ptr));
                    // Route the `&mut` through the audited `statement_mut()`
                    // accessor (just set above ⇒ `Some`); `stmt_ptr` is kept
                    // only for the explicit `deref(stmt_ptr)` cleanup below.
                    let stmt = this.statement_mut().expect("statement set above");
                    stmt.ref_();
                    drop(signature);

                    match stmt.status {
                        StatementStatus::Failed => {
                            this.statement.set(None);
                            // `error_response` is `Some` when status == Failed.
                            let error_response =
                                stmt.error_response.as_ref().unwrap().to_js(global_object)?;
                            // SAFETY: drop the ref we took above.
                            unsafe { PostgresSQLStatement::deref(stmt_ptr) };
                            // SAFETY: undoes the speculative `this.ref_()` above; count was ≥2, never frees here.
                            unsafe { Self::deref(this_ptr) };
                            return Err(global_object.throw_value(error_response));
                        }
                        StatementStatus::Prepared => {
                            // Only write ahead of the FIFO drain when every queued
                            // request has already emitted its bytes; otherwise this
                            // Bind+Execute would overtake an earlier unwritten
                            // request on the wire while reply attribution stays FIFO.
                            if (!connection.has_query_running() || connection.can_pipeline())
                                && connection.pending_requests.get() == 0
                            {
                                this.update_flags(|f| f.binary = !stmt.fields.is_empty());
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
                                this.update_flags(|f| {
                                    f.pipelined = true;
                                    f.counted = true;
                                });
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
                // `JsCell::with_mut` scopes the `&mut PreparedStatementsMap` to
                // the `get_or_put` call (single-JS-thread; no re-entry into JS
                // until after the raw value-slot ptr is captured). Extract the
                // raw slot ptr while the borrow is live so the remainder of
                // this block needs no further `&mut` to the map.
                let entry_value_ptr = match connection.statements.with_mut(|s| {
                    s.get_or_put(&signature.name)
                        .map(|e| std::ptr::from_mut::<*mut PostgresSQLStatement>(e.value_ptr))
                }) {
                    Ok(v) => v,
                    Err(err) => {
                        drop(signature);
                        release_query_ref();
                        return Err(global_object
                            .throw_error(crate::Error::from(err), "failed to allocate statement"));
                    }
                };
                connection_entry_value = Some(entry_value_ptr);
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
                        &mut signature,
                    ) {
                        if connection_entry_value.is_some() {
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
                        if connection_entry_value.is_some() {
                            let _ = connection
                                .statements
                                .with_mut(|m| m.remove(&signature.name[..]));
                        }
                        drop(signature);
                        release_query_ref();
                        return Err(throw_write_error(b"failed to write query", err));
                    }
                    if let Err(err) = writer.write(&protocol::SYNC) {
                        if connection_entry_value.is_some() {
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
                // we only have connection_entry_value if we are using named prepared statements
                if let Some(entry_value) = connection_entry_value {
                    connection
                        .prepared_statement_id
                        .set(connection.prepared_statement_id.get() + 1);
                    // ref_count starts at 2 (one for this.statement,
                    // one for the connection.statements map).
                    let stmt = {
                        let mut s = PostgresSQLStatement::default();
                        s.signature = signature;
                        s.init_exact_refs(2);
                        s.status = if did_write {
                            StatementStatus::Parsing
                        } else {
                            StatementStatus::Pending
                        };
                        bun_core::heap::into_raw(Box::new(s))
                    };
                    this.statement.set(Some(stmt));

                    // SAFETY: `entry_value` points into `connection.statements` and the map has
                    // not been mutated since `get_or_put`. `get_or_put` runs only after the
                    // existing-entry probe missed, so the slot it hands back was
                    // default-initialised to null and a plain store is fine.
                    unsafe { *entry_value = stmt };
                } else {
                    let stmt = {
                        let mut s = PostgresSQLStatement::default();
                        s.signature = signature;
                        s.status = if did_write {
                            StatementStatus::Parsing
                        } else {
                            StatementStatus::Pending
                        };
                        bun_core::heap::into_raw(Box::new(s))
                    };
                    this.statement.set(Some(stmt));
                }
            }
        }

        if connection
            .requests
            .with_mut(|q| q.write_item(this_ptr))
            .is_err()
        {
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
