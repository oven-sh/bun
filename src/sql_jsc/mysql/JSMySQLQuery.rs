use core::cell::Cell;
use core::ptr::NonNull;

use crate::jsc::codegen::{js_mysql_connection, js_mysql_query as js};
use crate::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSGlobalObjectSqlExt as _, JSValue, JsRef, JsResult,
    VirtualMachine, VirtualMachineSqlExt as _,
};
use bun_jsc::JsCell;
use bun_ptr::{AsCtxPtr, BackRef, ParentRef};
use bun_sql::mysql::MySQLQueryResult;
use bun_sql::mysql::protocol::any_mysql_error::{self as AnyMySQLError};
use bun_sql::postgres::command_tag::CommandTag;
use bun_sql::shared::sql_query_result_mode::SQLQueryResultMode;

use super::js_mysql_connection::MySQLConnection;
use crate::mysql::protocol::any_mysql_error_jsc::mysql_error_to_js;
use crate::postgres::command_tag_jsc::CommandTagJsc as _;
// PORT NOTE: `my_sql_query` exports both the `MySQLQuery` *struct* and a
// `declare_scope!`-generated `MySQLQuery` *static* (ScopedLogger). Importing
// the name once pulls in both namespaces, so the `debug!` macro below resolves
// against the imported static — no second `declare_scope!` here.
use super::my_sql_query::MySQLQuery;
use super::my_sql_statement::MySQLStatement;

bun_core::define_scoped_log!(debug, MySQLQuery);

// TODO(b2-blocked): #[bun_jsc::JsClass] — proc-macro emits shims typed against
// `bun_jsc::{JSGlobalObject, CallFrame, JSValue, JsError}`, which are distinct
// from this crate's local `crate::jsc::*` mirror types until `crate::jsc`
// becomes `pub use bun_jsc as jsc;` (see lib.rs TODO). Re-enable then.
//
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut JSMySQLQuery` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either.
#[derive(bun_ptr::CellRefCounted)]
#[ref_count(destroy = Self::deinit)]
pub struct JSMySQLQuery {
    this_value: JsCell<JsRef>,
    // unfortunately we cannot use #ref_count here
    ref_count: Cell<u32>,
    // Process-lifetime backrefs (JSC_BORROW on m_ctx payload).
    vm: BackRef<VirtualMachine>,
    global_object: BackRef<JSGlobalObject>,
    query: JsCell<MySQLQuery>,
}

// Intrusive refcount (bun.ptr.RefCount): `ref_()`/`deref()` provided by
// `#[derive(CellRefCounted)]`; `destroy` routes to `Self::deinit` via the
// struct-level `#[ref_count(destroy = …)]` attribute.

impl JSMySQLQuery {
    /// RAII `ref()`/`deref()` bracket around `self`. One audited
    /// `ScopedRef::new` here replaces N per-site
    /// `unsafe { ScopedRef::new(self.as_ctx_ptr()) }` — `&self` is the live
    /// m_ctx payload by construction, so the [`ScopedRef::new`] precondition
    /// (live, non-null) is always satisfied.
    #[inline]
    pub fn ref_guard(&self) -> bun_ptr::ScopedRef<Self> {
        // SAFETY: `&self` ⇒ the allocation is live and non-null.
        unsafe { bun_ptr::ScopedRef::new(self.as_ctx_ptr()) }
    }

    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn] — free-fn shim emitted inside an
    // `impl` block tries to call `constructor()` unqualified; re-enable once the
    // proc-macro emits `Self::constructor` for receiverless impl items.
    pub fn constructor(
        global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Self> {
        Err(global_this
            .throw_invalid_arguments(format_args!("MySQLQuery cannot be constructed directly")))
    }

    fn deinit(this: *mut Self) {
        // SAFETY: routed only through `CellRefCounted::destroy` (refcount==0);
        // `this` is the sole live owner of its `heap::alloc` allocation.
        unsafe {
            (*this).query.with_mut(|q| q.cleanup());
            drop(bun_core::heap::take(this));
        }
    }

    pub fn finalize(self: Box<Self>) {
        debug!("MySQLQuery finalize");
        bun_ptr::finalize_js_box(self, |this| this.this_value.with_mut(|v| v.finalize()));
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(export = "MySQLQuery__createInstance")]
    // — same proc-macro limitation as `constructor` above.
    pub fn create_instance(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let mut args = jsc::call_frame::ArgumentsSlice::init(global_this.sql_vm(), arguments);
        // defer args.deinit() — handled by Drop
        let Some(query) = args.next_eat() else {
            return Err(global_this.throw(format_args!("query must be a string")));
        };
        let Some(values) = args.next_eat() else {
            return Err(global_this.throw(format_args!("values must be an array")));
        };

        if !query.is_string() {
            return Err(global_this.throw(format_args!("query must be a string")));
        }

        if values.js_type() != jsc::JSType::Array {
            return Err(global_this.throw(format_args!("values must be an array")));
        }

        let pending_value: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let columns: JSValue = args.next_eat().unwrap_or(JSValue::UNDEFINED);
        let js_bigint: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);
        let js_simple: JSValue = args.next_eat().unwrap_or(JSValue::FALSE);

        let bigint = js_bigint.is_boolean() && js_bigint.as_boolean();
        let simple = js_simple.is_boolean() && js_simple.as_boolean();
        if simple {
            if values.get_length(global_this)? > 0 {
                return Err(global_this
                    .throw_invalid_arguments(format_args!("simple query cannot have parameters")));
            }
            if query.get_length(global_this)? >= i32::MAX as u64 {
                return Err(global_this.throw_invalid_arguments(format_args!("query is too long")));
            }
        }
        if !pending_value.js_type().is_array_like() {
            return Err(global_this.throw_invalid_argument_type("query", "pendingValue", "Array"));
        }

        let this_ptr = bun_core::heap::into_raw(Box::new(Self {
            this_value: JsCell::new(JsRef::empty()),
            ref_count: Cell::new(1),
            // Stored with full write provenance for later `&mut *p` at use sites.
            vm: BackRef::from(
                NonNull::new(global_this.sql_vm_ptr()).expect("sql_vm_ptr() is non-null"),
            ),
            global_object: BackRef::new(global_this),
            query: JsCell::new(MySQLQuery::init(
                query.to_bun_string(global_this)?,
                bigint,
                simple,
            )),
        }));
        // `heap::into_raw` is `Box::into_raw` — never null. Uniquely owned here
        // until handed to the JS wrapper. R-2: every field is interior-mutable,
        // so a shared `ParentRef` deref is sufficient even for the writes below.
        let this = ParentRef::from(NonNull::new(this_ptr).expect("heap::into_raw non-null"));

        let this_value = js::to_js(this_ptr, global_this);
        this_value.ensure_still_alive();
        this.this_value.with_mut(|v| v.set_weak(this_value));

        this.set_binding(values);
        this.set_pending_value(pending_value);
        if !columns.is_undefined() {
            this.set_columns(columns);
        }

        Ok(this_value)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_run(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        debug!("doRun");
        let _guard = this.ref_guard();

        let arguments = callframe.arguments();
        if arguments.len() < 2 {
            return Err(global_object.throw_invalid_arguments(format_args!(
                "run must be called with 2 arguments connection and target"
            )));
        }
        // `from_js_ref` wraps the m_ctx payload in a `ParentRef` — the backing
        // JSC wrapper is rooted by `arguments[0]` for this frame, satisfying the
        // `ParentRef` outlives-holder invariant. R-2: shared `&` only — every
        // `MySQLConnection` method reached below is `&self` post-migration.
        let Some(connection) = js_mysql_connection::from_js_ref(arguments[0]) else {
            return Err(global_object.throw(format_args!("connection must be a MySQLConnection")));
        };
        let connection: &MySQLConnection = &connection;
        let target = arguments[1];
        if !target.is_object() {
            return Err(global_object.throw_invalid_argument_type("run", "query", "Query"));
        }
        this.set_target(target);
        if let Err(err) = this.run(connection) {
            if !global_object.has_exception() {
                return Err(global_object.throw_value(mysql_error_to_js(
                    global_object,
                    "failed to execute query",
                    err,
                )));
            }
            return Err(jsc::JsError::Thrown);
        }
        connection.enqueue_request(this.as_ctx_ptr());
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_cancel(
        _this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO: we can cancel a query that is pending aka not pipelined yet we just need fail it
        // if is running is not worth/viable to cancel the whole connection
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn do_done(
        _this: &Self,
        _global_object: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO: investigate why this function is needed
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn set_mode_from_js(
        this: &Self,
        global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let js_mode = callframe.argument(0);
        if js_mode.is_empty_or_undefined_or_null() || !js_mode.is_number() {
            return Err(global_object.throw_invalid_argument_type("setMode", "mode", "Number"));
        }

        let mode_value = js_mode.coerce::<i32>(global_object)?;
        // PORT NOTE: `std.meta.intToEnum` → manual range match (no `TryFrom<i32>`
        // on `SQLQueryResultMode`; it's a plain `#[repr(u8)]` enum).
        let mode = match mode_value {
            0 => SQLQueryResultMode::Objects,
            1 => SQLQueryResultMode::Values,
            2 => SQLQueryResultMode::Raw,
            _ => {
                return Err(
                    global_object.throw_invalid_argument_type_value(b"mode", b"Number", js_mode)
                );
            }
        };
        this.query.with_mut(|q| q.set_result_mode(mode));
        Ok(JSValue::UNDEFINED)
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)] — see JsClass note above.
    pub fn set_pending_value_from_js(
        this: &Self,
        _global_object: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let result = callframe.argument(0);
        this.set_pending_value(result);
        Ok(JSValue::UNDEFINED)
    }

    pub fn resolve(&self, queries_array: JSValue, result: MySQLQueryResult) {
        // `ref_guard` brackets re-entry; drops *after* `_downgrade` so the
        // allocation outlives the closure body.
        let _guard = self.ref_guard();
        let is_last_result = result.is_last_result;
        // R-2: `&Self` is `Copy`; the guard captures it by value and runs on
        // every exit path (defer). All mutation is `JsCell`-backed.
        let _downgrade = scopeguard::guard(self, move |s| {
            if s.this_value.get().is_not_empty() && is_last_result {
                s.this_value.with_mut(|v| v.downgrade());
            }
        });

        if !self.query.with_mut(|q| q.result(is_last_result)) {
            return;
        }
        if self.vm().is_shutting_down() {
            return;
        }

        let Some(target_value) = self.get_target() else {
            return;
        };
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        this_value.ensure_still_alive();
        let tag = CommandTag::Select(result.result_count);
        let Ok(js_tag) = tag.to_js_tag(self.global_object()) else {
            debug_assert!(false, "in MySQLQuery Tag should always be a number");
            return;
        };
        js_tag.ensure_still_alive();

        let Some(function) = self
            .vm_mut()
            .sql_state()
            .mysql_context
            .on_query_resolve_fn
            .get()
        else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryResolveFn is not callable");

        let pending_value = self.get_pending_value().unwrap_or(JSValue::UNDEFINED);
        pending_value.ensure_still_alive();
        self.set_pending_value(JSValue::UNDEFINED);

        let event_loop = self.event_loop();

        event_loop.run_callback(
            function,
            self.global_object(),
            this_value,
            &[
                target_value,
                pending_value,
                js_tag,
                tag.to_js_number(),
                if queries_array.is_empty() {
                    JSValue::UNDEFINED
                } else {
                    queries_array
                },
                JSValue::js_boolean(is_last_result),
                JSValue::js_number(result.last_insert_id as f64),
                JSValue::js_number(result.affected_rows as f64),
            ],
        );
    }

    pub fn mark_as_failed(&self) {
        // Attention: we cannot touch JS here
        // If you need to touch JS, you wanna to use reject or reject_with_js_value instead
        let _guard = self.ref_guard();
        if self.this_value.get().is_not_empty() {
            self.this_value.with_mut(|v| v.downgrade());
        }
        let _ = self.query.with_mut(|q| q.fail());
    }

    pub fn reject(&self, queries_array: JSValue, err: AnyMySQLError::Error) {
        if self.vm().is_shutting_down() {
            self.mark_as_failed();
            return;
        }
        if let Some(err_) = self.global_object().try_take_exception() {
            self.reject_with_js_value(queries_array, err_);
        } else {
            let instance = mysql_error_to_js(self.global_object(), "Failed to bind query", err);
            instance.ensure_still_alive();
            self.reject_with_js_value(queries_array, instance);
        }
    }

    pub fn reject_with_js_value(&self, queries_array: JSValue, err: JSValue) {
        // `ref_guard` brackets re-entry; drops *after* `_downgrade` so the
        // allocation outlives the closure body.
        let _guard = self.ref_guard();
        // R-2: `&Self` is `Copy`; the guard captures it by value and runs on
        // every exit path (defer). All mutation is `JsCell`-backed.
        let _downgrade = scopeguard::guard(self, |s| {
            if s.this_value.get().is_not_empty() {
                s.this_value.with_mut(|v| v.downgrade());
            }
        });

        if !self.query.with_mut(|q| q.fail()) {
            return;
        }

        if self.vm().is_shutting_down() {
            return;
        }
        let Some(target_value) = self.get_target() else {
            return;
        };

        let mut js_error = err.to_error().unwrap_or(err);
        if js_error.is_empty() {
            js_error = mysql_error_to_js(
                self.global_object(),
                "Query failed",
                AnyMySQLError::Error::UnknownError,
            );
        }
        debug_assert!(!js_error.is_empty(), "js_error is zero");
        js_error.ensure_still_alive();
        let Some(function) = self
            .vm_mut()
            .sql_state()
            .mysql_context
            .on_query_reject_fn
            .get()
        else {
            return;
        };
        debug_assert!(function.is_callable(), "onQueryRejectFn is not callable");
        let event_loop = self.event_loop();
        let js_array = if queries_array.is_empty() {
            JSValue::UNDEFINED
        } else {
            queries_array
        };
        js_array.ensure_still_alive();
        let Some(this_value) = self.this_value.get().try_get() else {
            return;
        };
        event_loop.run_callback(
            function,
            self.global_object(),
            this_value,
            &[target_value, js_error, js_array],
        );
    }

    pub fn run(&self, connection: &MySQLConnection) -> Result<(), AnyMySQLError::Error> {
        if self.vm().is_shutting_down() {
            debug!("run cannot run a query if the VM is shutting down");
            // cannot run a query if the VM is shutting down
            return Ok(());
        }
        {
            let q = self.query.get();
            if !q.is_pending() || q.is_being_prepared() {
                debug!("run already running or being prepared");
                // already running or completed
                return Ok(());
            }
        }
        let global_object: &JSGlobalObject = self.global_object();
        self.this_value.with_mut(|v| v.upgrade(global_object));
        // R-2: errdefer rollback — `&Self` is `Copy`; the guard captures it by
        // value, mutation is `JsCell`-backed, and `into_inner` disarms on the
        // success path below.
        let errguard = scopeguard::guard(self, |s| {
            s.this_value.with_mut(|v| v.downgrade());
            let _ = s.query.with_mut(|q| q.fail());
        });

        let columns_value = self.get_columns().unwrap_or(JSValue::UNDEFINED);
        let binding_value = self.get_binding().unwrap_or(JSValue::UNDEFINED);
        // R-2: `JsCell::with_mut` scopes the `&mut MySQLQuery` to the closure
        // body. `run_query` may run user JS (binding getters), which could
        // re-enter another host-fn on this `JSMySQLQuery`; that re-entrant call
        // would form a fresh `&Self` — sound, since the noalias attribute is
        // suppressed by the `UnsafeCell` in `JsCell`. A re-entrant `with_mut`
        // on `self.query` would still alias; `set_mode_from_js` is the only
        // such path and is not reachable from a binding getter in well-formed
        // SQL usage. This mirrors the pre-R-2 behaviour but with the *outer*
        // `&mut self` UB structurally eliminated.
        if let Err(err) = self
            .query
            .with_mut(|q| q.run_query(connection, global_object, columns_value, binding_value))
        {
            debug!("run failed to execute query");
            if !global_object.has_exception() {
                // PORT NOTE: Zig `return globalObject.throwValue(...)` returns
                // `error.JSError` into the `AnyMySQLError.Error!void` set; in
                // Rust we throw for side-effect and map to the enum variant.
                let _ = global_object.throw_value(mysql_error_to_js(
                    global_object,
                    "failed to execute query",
                    err,
                ));
            }
            return Err(AnyMySQLError::Error::JSError);
        }
        // disarm errdefer on success
        scopeguard::ScopeGuard::into_inner(errguard);
        Ok(())
    }

    #[inline]
    pub fn is_completed(&self) -> bool {
        self.query.get().is_completed()
    }
    #[inline]
    pub fn is_running(&self) -> bool {
        self.query.get().is_running()
    }
    #[inline]
    pub fn is_pending(&self) -> bool {
        self.query.get().is_pending()
    }
    #[inline]
    pub fn is_being_prepared(&self) -> bool {
        self.query.get().is_being_prepared()
    }
    #[inline]
    pub fn is_pipelined(&self) -> bool {
        self.query.get().is_pipelined()
    }
    #[inline]
    pub fn is_simple(&self) -> bool {
        self.query.get().is_simple()
    }
    #[inline]
    pub fn is_bigint_supported(&self) -> bool {
        self.query.get().is_bigint_supported()
    }
    #[inline]
    pub fn get_result_mode(&self) -> SQLQueryResultMode {
        self.query.get().get_result_mode()
    }
    // TODO: isolate statement modification away from the connection
    pub fn get_statement(&self) -> Option<&mut MySQLStatement> {
        self.query.get().get_statement()
    }

    pub fn mark_as_prepared(&self) {
        self.query.with_mut(|q| q.mark_as_prepared());
    }

    #[inline]
    pub fn set_pending_value(&self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.get().try_get() {
            js::pending_value_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    pub fn get_pending_value(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.get().try_get() {
            return js::pending_value_get_cached(value);
        }
        None
    }

    #[inline]
    fn set_target(&self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.get().try_get() {
            js::target_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_target(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.get().try_get() {
            return js::target_get_cached(value);
        }
        None
    }

    #[inline]
    fn set_columns(&self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.get().try_get() {
            js::columns_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_columns(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.get().try_get() {
            return js::columns_get_cached(value);
        }
        None
    }
    #[inline]
    fn set_binding(&self, result: JSValue) {
        if self.vm().is_shutting_down() {
            return;
        }
        if let Some(value) = self.this_value.get().try_get() {
            js::binding_set_cached(value, self.global_object(), result);
        }
    }
    #[inline]
    fn get_binding(&self) -> Option<JSValue> {
        if self.vm().is_shutting_down() {
            return None;
        }
        if let Some(value) = self.this_value.get().try_get() {
            return js::binding_get_cached(value);
        }
        None
    }

    // Helpers for stored back-references.
    #[inline]
    fn vm(&self) -> &VirtualMachine {
        self.vm.get()
    }
    #[inline]
    fn vm_mut(&self) -> &'static mut VirtualMachine {
        VirtualMachine::get_mut()
    }
    /// `&mut EventLoop` for `run_callback`. Routes through the inherent safe
    /// `VirtualMachine::event_loop_mut` accessor — the loop is a disjoint heap
    /// allocation owned by the JS-thread VM singleton stored in `self.vm`;
    /// single-thread affinity ⇒ no two `&mut EventLoop` coexist.
    #[inline]
    fn event_loop(&self) -> &mut crate::jsc::EventLoop {
        self.vm().event_loop_mut()
    }
    #[inline]
    fn global_object(&self) -> &JSGlobalObject {
        self.global_object.get()
    }
}

// TODO(port): @export(&jsc.toJSHostFn(createInstance), .{ .name = "MySQLQuery__createInstance" })
// — the #[bun_jsc::host_fn] macro on `create_instance` should emit this with
// #[unsafe(no_mangle)] under the name "MySQLQuery__createInstance"; verify codegen wiring.

pub use js::{from_js, from_js_direct, to_js};

// ported from: src/sql_jsc/mysql/JSMySQLQuery.zig
