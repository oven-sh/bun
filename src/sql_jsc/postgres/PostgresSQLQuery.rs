use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsRef, JsResult, VirtualMachineSqlExt as _};
use crate::shared::cached_structure::Undescribed;
use crate::shared::query_ctor_args;
use crate::shared::row_decoder::RowDecoder;
use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsCell};
use bun_ptr::{AsCtxPtr, RefPtr};

use super::PostgresSQLConnection;
use super::PostgresSQLStatement;
use super::Signature;
use super::command_tag_jsc::CommandTagJsc;
use super::error_jsc::postgres_error_to_js;
use super::postgres_request as PostgresRequest;
use super::postgres_sql_statement::{ResultDescription, Status as StatementStatus, describe};
use bun_sql::postgres::CommandTag;
use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::postgres_types::ResultFormats;
use bun_sql::shared::ConnectionFlags;
use bun_sql::shared::SQLQueryResultMode as PostgresSQLQueryResultMode;

bun_core::declare_scope!(Postgres, visible);

pub(crate) use crate::generated_bindgen::postgres_sql_query::js_PostgresSQLQuery as js;

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLQuery {
    /// Shared with the connection's named-statement map (each holder owns one ref).
    pub(crate) statement: JsCell<Option<RefPtr<PostgresSQLStatement>>>,
    /// The connection whose queue it is in.
    connection: JsCell<Option<RefPtr<PostgresSQLConnection>>>,
    pub(crate) query: BunString,
    undescribed: JsCell<Undescribed<ResultDescription>>,

    pub(crate) this_value: JsCell<JsRef>,

    pub(crate) status: Cell<Status>,

    ref_count: Cell<u32>,

    pub(crate) flags: Cell<Flags>,

    pub(crate) row_type: Cell<u32>,
}

impl Default for PostgresSQLQuery {
    fn default() -> Self {
        Self {
            statement: JsCell::new(None),
            connection: JsCell::new(None),
            query: BunString::EMPTY,
            undescribed: JsCell::new(Undescribed::default()),
            this_value: JsCell::new(JsRef::empty()),
            status: Cell::new(Status::Pending),
            ref_count: Cell::new(1),
            flags: Cell::new(Flags::default()),
            row_type: Cell::new(0),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Flags {
    /// What its Bind asked for.
    pub(crate) formats: ResultFormats,
    pub(crate) bigint: bool,
    pub(crate) simple: bool,
    /// Parse + Describe go out first and Bind waits for the server's parameter types.
    pub(crate) describe_first: bool,
    /// Its values are what `write_bind` sends. See `PostgresRequest::stage_parameters`.
    pub(crate) staged: bool,
    /// It failed while the server still answers it: its response is skipped until `ReadyForQuery`.
    pub(crate) discard_response: bool,
    pub(crate) cancel: Cancel,
    /// Written by `PostgresSQLConnection::count` alone.
    pub(crate) counter: RequestCounter,
    /// The server refused its Bind because the statement was lost or stale, and it was written again.
    pub(crate) retried: bool,
    pub(crate) copy: CopyStream,
    pub(crate) result_mode: PostgresSQLQueryResultMode,
}

/// The stream that `readable()` or `writable()` made for the request. See CopyStream.rs.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CopyStream {
    None,
    Readable,
    /// Between CopyOutResponse and CopyDone.
    ReadableOpen,
    Writable,
    /// Between CopyInResponse and the CopyDone or CopyFail that the stream ends with.
    WritableOpen,
}

/// Of a request that is written.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Cancel {
    No,
    /// `cancel()` was called and no CancelRequest could be sent for it so far.
    Wanted,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RequestCounter {
    None,
    /// `PostgresSQLConnection::pending_requests`
    Pending,
    /// `PostgresSQLConnection::nonpipelinable_requests`
    Nonpipelinable,
    /// `PostgresSQLConnection::pipelined_requests`
    Pipelined,
}

impl Default for Flags {
    fn default() -> Self {
        Self {
            formats: ResultFormats::Text,
            bigint: false,
            simple: false,
            describe_first: false,
            staged: false,
            discard_response: false,
            cancel: Cancel::No,
            counter: RequestCounter::None,
            retried: false,
            copy: CopyStream::None,
            result_mode: PostgresSQLQueryResultMode::Objects,
        }
    }
}

pub use bun_sql::shared::query_status::Status;

impl PostgresSQLQuery {
    /// Read-modify-write the `Cell<Flags>` through `&self`.
    #[inline]
    pub(crate) fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    /// Kept alive by the ref this query holds. All mutation is
    /// single-JS-thread so the `&mut` is exclusive for the borrow's lifetime;
    /// callers must not hold two results live simultaneously (the request
    /// FIFO never does).
    #[inline]
    #[allow(clippy::mut_from_ref)] // intrusive pointer; see doc comment
    pub(crate) fn statement_mut(&self) -> Option<&mut PostgresSQLStatement> {
        // SAFETY: see doc comment.
        self.statement
            .get()
            .as_ref()
            .map(|p| unsafe { &mut *p.as_ptr() })
    }

    #[inline]
    pub(crate) fn connection(&self) -> Option<RefPtr<PostgresSQLConnection>> {
        self.connection.get().clone()
    }

    #[inline]
    pub(crate) fn leave_queue(&self) {
        self.statement.set(None);
        self.connection.set(None);
    }

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

    pub fn finalize(&self) {
        bun_core::scoped_log!(Postgres, "PostgresSQLQuery finalize");
        self.this_value.with_mut(|r| r.finalize());
    }

    /// For a request that is owed no `ReadyForQuery`: its caller takes it out of the queue.
    pub(crate) fn on_js_error(&self, err: JSValue, global_object: &JSGlobalObject) {
        let err = self.kept_error().unwrap_or(err);
        self.status.set(Status::Fail);
        self.reject(err, global_object);
    }

    /// Rejects now. `status`, the counter and the queue head stay until its `ReadyForQuery`.
    pub(crate) fn reject_in_flight(&self, err: JSValue, global_object: &JSGlobalObject) {
        if self.is_rejected() {
            return;
        }
        self.update_flags(|f| f.discard_response = true);
        self.reject(err, global_object);
    }

    /// The server has ended it and says next what became of the transaction. User code hears of the
    /// failure then, as it hears of a result.
    pub(crate) fn reject_at_ready_for_query(&self, err: JSValue, global_object: &JSGlobalObject) {
        if self.is_rejected() {
            return;
        }
        self.update_flags(|f| f.discard_response = true);
        if let Some(this_value) = self.this_value.get().try_get() {
            js::pending_value_set_cached(this_value, global_object, err);
        }
    }

    /// The `ReadyForQuery` of a request with `discard_response`.
    pub(crate) fn end_rejected(&self, global_object: &JSGlobalObject) {
        self.status.set(Status::Fail);
        if let Some(err) = self.kept_error() {
            self.reject(err, global_object);
        }
    }

    /// What `reject_at_ready_for_query` put in the place of the rows. `reject` does nothing a second time.
    fn kept_error(&self) -> Option<JSValue> {
        if !self.flags.get().discard_response {
            return None;
        }
        js::pending_value_get_cached(self.this_value.get().try_get()?)
    }

    pub(crate) fn is_rejected(&self) -> bool {
        self.status.get() == Status::Fail || self.flags.get().discard_response
    }

    fn reject(&self, err: JSValue, global_object: &JSGlobalObject) {
        let _guard = self.ref_guard();
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        let vm = crate::jsc::VirtualMachine::get().as_mut();
        let function = vm
            .sql_state()
            .postgresql_context
            .on_query_reject_fn
            .get()
            .unwrap();
        let event_loop = vm.event_loop_mut();
        event_loop.run_callback(
            bun_event_loop::ContextId::NONE,
            function,
            global_object,
            this_value,
            &[target_value, err.to_error().unwrap_or(err)],
        );
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
        is_last: bool,
    ) {
        let _guard = self.ref_guard();
        self.status.set(if is_last {
            Status::Success
        } else {
            Status::PartialResponse
        });
        let tag = CommandTag::init(command_tag_str);
        let js_tag: JSValue = match tag.to_js_tag(global_object) {
            Ok(v) => v,
            Err(e) => {
                let err = global_object.take_exception(e);
                return if is_last {
                    self.on_js_error(err, global_object)
                } else {
                    self.reject_in_flight(err, global_object)
                };
            }
        };
        js_tag.ensure_still_alive();

        // The last call ends the query and brings no result.
        let statement = match self.statement_mut().filter(|_| !is_last) {
            Some(statement) if statement.is_named() => {
                match statement.description(global_object, &self.query) {
                    Ok(description) => description,
                    Err(e) => {
                        let err = global_object.take_exception(e);
                        return self.reject_in_flight(err, global_object);
                    }
                }
            }
            Some(statement) => self
                .undescribed
                .with_mut(|results| results.push(statement.take_result())),
            None => JSValue::NULL,
        };

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

        let vm = crate::jsc::VirtualMachine::get().as_mut();
        let function = vm
            .sql_state()
            .postgresql_context
            .on_query_resolve_fn
            .get()
            .unwrap();
        let event_loop = vm.event_loop_mut();

        event_loop.run_callback(
            bun_event_loop::ContextId::NONE,
            function,
            global_object,
            this_value,
            &[
                target_value,
                js::pending_value_take_cached(this_value, global_object)
                    .unwrap_or(JSValue::UNDEFINED),
                js_tag,
                tag.to_js_number(),
                JSValue::from(is_last),
                statement,
            ],
        );
    }

    /// `result.statement` of the result for which `on_result` gave this number instead.
    pub fn describe_result(&self, cx: &mut JsScope<'_>, number: JsLocal<'_>) -> JsResult<JSValue> {
        match self
            .undescribed
            .with_mut(|results| results.take(number.to_js()))
        {
            Some((parameters, fields)) => describe(cx.global(), &self.query, &parameters, &fields),
            None => Ok(JSValue::NULL),
        }
    }

    // The generator counts the struct itself.
    pub(crate) fn estimated_size(&self) -> usize {
        0
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

        let ptr = bun_core::heap::into_raw(Box::new(PostgresSQLQuery::default()));

        let this_value = js::to_js(ptr, global_this);
        this_value.ensure_still_alive();

        // SAFETY: ptr is exclusively owned here until returned to JS.
        unsafe {
            (*ptr).query = query;
            (*ptr).this_value.set(JsRef::init_weak(this_value));
            (*ptr).flags.set(Flags {
                bigint,
                simple,
                ..Default::default()
            });
        }

        js::binding_set_cached(this_value, global_this, values);
        js::pending_value_set_cached(this_value, global_this, pending_value);

        Ok(this_value)
    }

    pub fn set_pending_value(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        js::pending_value_set_cached(this_value.to_js(), cx.global(), value.to_js());
    }

    pub fn set_mode(&self, cx: &mut JsScope<'_>, mode: JsLocal<'_>) -> JsResult<()> {
        let global_object = cx.global();
        let js_mode = mode.to_js();
        if !js_mode.is_number() {
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
        self.update_flags(|f| f.result_mode = result_mode);
        Ok(())
    }

    pub fn run(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        connection: &PostgresSQLConnection,
        query: JsLocal<'_>,
    ) -> JsResult<()> {
        let global_object = cx.global();
        let query = query.to_js();

        if !query.is_object() {
            return Err(global_object.throw_invalid_argument_type("run", "query", "Query"));
        }
        self.row_type
            .set(RowDecoder::expected_row_type(global_object, query));

        let this_value = this_value.to_js();
        let binding_value = js::binding_get_cached(this_value).unwrap_or_default();
        let unnamed = connection
            .flags
            .get()
            .contains(ConnectionFlags::USE_UNNAMED_PREPARED_STATEMENTS);
        // Reading the values can run user code, so it comes before any look at the connection's state.
        let mut declared = Vec::new();
        if !self.flags.get().simple {
            declared = Signature::declared_types(global_object, binding_value)?;
            let describe_first =
                !unnamed || PostgresRequest::needs_parameter_types(global_object, binding_value)?;
            self.update_flags(|f| f.describe_first = describe_first);
            // The server takes what is written behind a COPY FROM STDIN for its data. Nothing is
            // written behind a simple query, and the server takes no parameter in a COPY.
            if self.is_copy_statement() {
                declared.clear();
                self.update_flags(|f| f.simple = true);
            }
        }
        if declared.len() > u16::MAX as usize {
            return Err(global_object.throw_value(postgres_error_to_js(
                global_object,
                None,
                AnyPostgresError::TooManyParameters,
            )));
        }
        // That code can have called `cancel()`.
        if self.status.get() != Status::Pending {
            return Err(global_object.throw_value(connection.cancelled_error(None)));
        }

        // A connection that failed or closed answers nothing: a query queued on it would hold the
        // event loop for ever. The pool hears of a close through `onclose` and stops handing the
        // connection out, except a disposed `Bun.ModuleGraph`'s, which is told nothing.
        if connection.status.get().is_closed() {
            return Err(global_object.throw_value(postgres_error_to_js(
                global_object,
                Some(b"Connection closed"),
                AnyPostgresError::ConnectionClosed,
            )));
        }

        let new_statement =
            |id: Option<u64>| PostgresSQLStatement::new(Signature::new(&declared, id));
        self.statement.set(Some(if self.flags.get().simple {
            let mut s = PostgresSQLStatement::default();
            // It has no Parse of its own: the Query message is the whole request.
            s.status = StatementStatus::Parsing;
            RefPtr::new(s)
        } else if unnamed {
            new_statement(None)
        } else {
            let query_str = self.query.to_utf8();
            connection.statements.with_mut(|cache| {
                cache.get(query_str.slice(), &declared).unwrap_or_else(|| {
                    let statement = new_statement(Some(connection.take_prepared_statement_id()));
                    cache.insert(query_str.slice(), statement.clone());
                    statement
                })
            })
        }));

        connection
            .requests
            .with_mut(|q| q.push_back(self.ref_guard()));
        connection.count(self, RequestCounter::Pending);
        self.connection.set(Some(connection.ref_guard()));
        // Request is enqueued: keep the event loop alive until the server responds.
        connection.poll_ref.with_mut(|r| {
            r.ref_(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        self.this_value.with_mut(|r| r.upgrade(global_object));
        js::target_set_cached(this_value, global_object, query);

        connection.advance();
        connection.flush_data_and_reset_timeout();
        // advance() can reject this request with nothing sent: no reply releases the ref then.
        connection.update_poll_ref();
        Ok(())
    }

    pub fn cancel(&self, _: &mut JsScope<'_>) {
        match self.connection() {
            Some(connection) => connection.cancel(self),
            // `run` has not queued it: it refuses a query that is not `Pending`.
            None if self.status.get() == Status::Pending => self.status.set(Status::Fail),
            None => {}
        }
    }
}
