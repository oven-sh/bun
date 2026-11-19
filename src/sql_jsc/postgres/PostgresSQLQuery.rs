use core::cell::Cell;

use crate::jsc::{JSGlobalObject, JSValue, JsRef, JsResult, VirtualMachineSqlExt as _};
use crate::shared::cached_structure::Undescribed;
use crate::shared::query_ctor_args;
use bun_core::String as BunString;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSArray, JsCell};
use bun_ptr::{AsCtxPtr, RefPtr};

use super::PostgresSQLConnection;
use super::PostgresSQLStatement;
use super::command_tag_jsc::CommandTagJsc;
use super::error_jsc::postgres_error_to_js;
use super::postgres_request as PostgresRequest;
use super::postgres_sql_statement::{ResultDescription, describe};
use bun_sql::postgres::CommandTag;
use bun_sql::postgres::any_postgres_error::AnyPostgresError;
use bun_sql::postgres::pipeline::{self, Protocol};
use bun_sql::postgres::postgres_types::ResultFormats;
use bun_sql::shared::SQLQueryResultMode as PostgresSQLQueryResultMode;

bun_core::declare_scope!(Postgres, visible);

pub(crate) use crate::generated_bindgen::postgres_sql_query::js_PostgresSQLQuery as js;

// JS can re-enter any method, so they all take `&self` and the fields are cells.
#[derive(bun_ptr::CellRefCounted)]
pub struct PostgresSQLQuery {
    place: JsCell<Place>,
    turn: Cell<u64>,
    pub(crate) query: BunString,
    undescribed: JsCell<Undescribed<ResultDescription>>,

    pub(crate) this_value: JsCell<JsRef>,

    ref_count: Cell<u32>,

    pub(crate) bigint: bool,
    simple: bool,
    /// See `PostgresRequest::stage_parameters`.
    pub(crate) staged: Cell<bool>,
    /// What its Bind asked for.
    pub(crate) formats: Cell<ResultFormats>,
    pub(crate) copy: Cell<CopyStream>,
    pub(crate) result_mode: Cell<PostgresSQLQueryResultMode>,
}

enum Place {
    New,
    Queued(RefPtr<PostgresSQLConnection>),
    Ended,
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

impl pipeline::Request for PostgresSQLQuery {
    fn turn(&self) -> &Cell<u64> {
        &self.turn
    }
}

impl PostgresSQLQuery {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    pub(crate) fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    #[inline]
    pub(crate) fn connection(&self) -> Option<RefPtr<PostgresSQLConnection>> {
        match self.place.get() {
            Place::Queued(connection) => Some(connection.clone()),
            Place::New | Place::Ended => None,
        }
    }

    #[inline]
    pub(crate) fn leave_queue(&self) {
        self.place.set(Place::Ended);
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

    /// In the place of the rows, until `ReadyForQuery`.
    pub(crate) fn keep_error(&self, err: JSValue, global_object: &JSGlobalObject) {
        if let Some(this_value) = self.this_value.get().try_get() {
            js::pending_value_set_cached(this_value, global_object, err);
        }
    }

    pub(crate) fn kept_error(&self) -> Option<JSValue> {
        js::pending_value_get_cached(self.this_value.get().try_get()?)
    }

    /// Does nothing a second time.
    pub(crate) fn reject(&self, err: JSValue, global_object: &JSGlobalObject) {
        let _guard = self.ref_guard();
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        let _downgrade = scopeguard::guard((), |_| self.this_value.with_mut(|r| r.downgrade()));
        let Some(target_value) = self.get_target(global_object, true) else {
            return;
        };

        let vm = crate::jsc::VirtualMachine::get();
        let Some(function) = vm
            .sql_state()
            .postgresql_context
            .get()
            .on_query_reject_fn
            .get()
        else {
            return;
        };
        let event_loop = vm.event_loop();
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

    /// The last call has no `statement`: it ends the query and brings no result.
    pub(crate) fn on_result(
        &self,
        command_tag_str: &[u8],
        global_object: &JSGlobalObject,
        statement: Option<&PostgresSQLStatement>,
    ) -> JsResult<()> {
        let _guard = self.ref_guard();
        let is_last = statement.is_none();
        let tag = CommandTag::init(command_tag_str);
        let js_tag = tag.to_js_tag(global_object)?;
        js_tag.ensure_still_alive();

        let statement = match statement {
            Some(statement) if statement.is_named() => statement.columns.with_mut(|columns| {
                columns.description(global_object, &self.query, statement.described())
            })?,
            // The next result starts with no fields: a command without rows has no RowDescription.
            Some(statement) => {
                let result = (statement.take_described(), statement.columns.take().fields);
                self.undescribed.with_mut(|results| results.push(result))
            }
            None => JSValue::NULL,
        };

        let Some(this_value) = self.this_value.get().try_get() else {
            return Ok(());
        };
        let _last = scopeguard::guard((), |_| {
            if is_last {
                Self::allow_gc(this_value, global_object);
                self.this_value.with_mut(|r| r.downgrade());
            }
        });
        let Some(target_value) = self.get_target(global_object, is_last) else {
            return Ok(());
        };

        let vm = crate::jsc::VirtualMachine::get();
        let Some(function) = vm
            .sql_state()
            .postgresql_context
            .get()
            .on_query_resolve_fn
            .get()
        else {
            return Ok(());
        };
        let event_loop = vm.event_loop();

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
        Ok(())
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

        let this = RefPtr::new(PostgresSQLQuery {
            place: JsCell::new(Place::New),
            turn: Cell::new(0),
            query,
            undescribed: JsCell::default(),
            this_value: JsCell::new(JsRef::empty()),
            ref_count: Cell::new(1),
            bigint,
            simple,
            staged: Cell::new(false),
            formats: Cell::new(ResultFormats::Text),
            copy: Cell::new(CopyStream::None),
            result_mode: Cell::new(PostgresSQLQueryResultMode::Objects),
        });
        let this = js::wrap(this, global_this);
        let this_value = this.to_js();
        this.this_value.set(JsRef::init_weak(this_value));

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
        self.result_mode.set(result_mode);
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

        let this_value = this_value.to_js();
        let binding_value = js::binding_get_cached(this_value).unwrap_or_default();
        // Reading the values can run user code, so it comes before any look at the connection's state.
        let mut declared = Vec::new();
        let mut protocol = Protocol::Simple;
        if !self.simple {
            declared = PostgresRequest::declared_types(global_object, binding_value)?;
            let describe_first = connection.names_statements()
                || PostgresRequest::needs_parameter_types(global_object, binding_value)?;
            // What is written behind a COPY FROM STDIN is its data, and nothing is written behind a simple query.
            if self.is_copy_statement() {
                declared.clear();
            } else {
                protocol = Protocol::Extended {
                    describe_first: describe_first && !declared.is_empty(),
                };
            }
        }
        if declared.len() > u16::MAX as usize {
            return Err(global_object.throw_value(postgres_error_to_js(
                global_object,
                None,
                AnyPostgresError::TooManyParameters,
            )));
        }
        // That code can have called `cancel()` or `run()`.
        if !matches!(self.place.get(), Place::New) {
            return Err(global_object.throw_value(connection.cancelled_error(None)));
        }

        // A connection that failed or closed answers nothing: a query queued on it would hold the
        // event loop for ever. The pool hears of a close through `onclose` and stops handing the
        // connection out, except a disposed `Bun.ModuleGraph`'s, which is told nothing.
        if connection.is_closed() {
            return Err(global_object.throw_value(postgres_error_to_js(
                global_object,
                Some(b"Connection closed"),
                AnyPostgresError::ConnectionClosed,
            )));
        }

        connection.enqueue(self, &declared, protocol);
        self.place.set(Place::Queued(connection.ref_guard()));
        // Request is enqueued: keep the event loop alive until the server responds.
        connection.poll_ref.ref_(bun_io::js_vm_ctx());
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
            // `run` refuses it from here on.
            None => self.place.set(Place::Ended),
        }
    }
}
