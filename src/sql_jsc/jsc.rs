//! `bun_jsc` re-export façade for the SQL bindings.
//!
//! All core handle types (`JSValue`, `JSGlobalObject`, `CallFrame`, `JsError`,
//! `JsResult`, `JSObject`, `JSType`, [`VirtualMachine`],
//! [`EventLoop`], [`KeepAlive`], …) are **re-exported from `bun_jsc` /
//! `bun_io`** so the `#[bun_jsc::JsClass]` / `#[bun_jsc::host_fn]` proc-macros
//! see identical types. SQL-specific helpers that `bun_jsc` doesn't expose at
//! this tier are provided as extension traits ([`JSGlobalObjectSqlExt`],
//! [`VirtualMachineSqlExt`]).
//!
//! [`RareData`] here is the **per-VM SQL state** (`mysql_context` /
//! `postgresql_context`) that `bun_runtime::jsc_hooks::RuntimeState` owns by
//! value — it is *not* a view of `bun_jsc::rare_data::RareData` (which holds
//! the per-protocol `SocketGroup`s and is reached via the inherent
//! `VirtualMachine::rare_data()`).

#![warn(unused_must_use)]

use core::marker::PhantomData;

// ──────────────────────────────────────────────────────────────────────────
// Core handles — re-exported from `bun_jsc` so proc-macro generated wrappers
// (which hard-code `bun_jsc::JSGlobalObject` / `bun_jsc::CallFrame` / …) see
// the same types as user code importing `crate::jsc::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::{
    CallFrame, ErrorBuilder, ErrorCode, ExternColumnIdentifier, GlobalRef, JSArrayIterator,
    JSGlobalObject, JSObject, JSType, JSValue, JsCell, JsError, JsRef, JsResult,
    MarkedArgumentBuffer, StringJsc, Strong, StrongOptional, bun_string_jsc,
};

/// Re-export — `bun_jsc` now defines `IntegerRange` at its crate root and the
/// inherent `JSGlobalObject::{validate_integer_range, validate_big_int_range}`
/// take it directly, so the previous local mirror is gone.
pub use bun_jsc::IntegerRange;

// ──────────────────────────────────────────────────────────────────────────
// Error bridging.
//
// `impl From<bun_jsc::JsError> for bun_sql::*` would be an orphan (both types
// foreign to this crate), so the conversions are exposed as free fns instead.
// Callers use `.map_err(jsc::js_error_to_postgres)?` / `..._to_mysql)?`.
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub(crate) fn js_error_to_postgres(e: JsError) -> bun_sql::postgres::AnyPostgresError {
    use bun_sql::postgres::AnyPostgresError as E;
    match e {
        JsError::Thrown | JsError::Terminated => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
    }
}
#[inline]
pub(crate) fn js_error_to_mysql(e: JsError) -> bun_sql::mysql::protocol::any_mysql_error::Error {
    use bun_sql::mysql::protocol::any_mysql_error::Error as E;
    match e {
        JsError::Thrown | JsError::Terminated => E::JSError,
        JsError::OutOfMemory => E::OutOfMemory,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// host_fn helpers (mirrors bun_jsc::host_fn::from_js_host_call*; kept local
// for the few extension-trait bodies below that call extern "C" symbols
// directly).
// ──────────────────────────────────────────────────────────────────────────

// `uws.us_bun_verify_error_t::toJS` — sunk to `bun_jsc::system_error` so both
// `bun_runtime` and this crate import the single canonical body (was
// triplicated across runtime/socket/uws_jsc, here, and PostgresSQLConnection).
pub use bun_jsc::system_error::verify_error_to_js;

// ──────────────────────────────────────────────────────────────────────────
// uws.create_bun_socket_error_t::toJS
//
// Same layering note as `verify_error_to_js` above: canonical impl lives in
// `bun_runtime::socket::uws_jsc::create_bun_socket_error_to_js`, but importing
// it would cycle (`bun_runtime` depends on this crate). The body only needs
// `bun_uws` + `bun_boringssl_sys` + `bun_jsc` (all lower-tier), so it is hosted
// here for the SQL connection `createInstance` paths.
// ──────────────────────────────────────────────────────────────────────────

/// `BoringSSL.ERR_toJS` — formats the packed error code into a JS Error with
/// code `BORINGSSL`. Body mirrors `bun_runtime::crypto::boringssl_jsc::err_to_js`
/// (unreachable from here without a cycle).
fn boringssl_err_to_js(global: &JSGlobalObject, err_code: u32) -> JSValue {
    let mut buf = [0u8; 128];
    let reason = bun_boringssl_sys::err_error_string_n(err_code, &mut buf);
    if reason.is_empty() {
        return global
            .err(
                ErrorCode::BORINGSSL,
                format_args!("An unknown BoringSSL error occurred: {}", err_code),
            )
            .to_js();
    }
    global
        .err(
            ErrorCode::BORINGSSL,
            format_args!("BoringSSL {}", bstr::BStr::new(reason)),
        )
        .to_js()
}

pub(crate) fn create_bun_socket_error_to_js(
    err: bun_uws::create_bun_socket_error_t,
    global: &JSGlobalObject,
) -> JSValue {
    use bun_uws::create_bun_socket_error_t as E;
    match err {
        // `us_ssl_ctx_from_options` only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with `.none` and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `getOrCreateOpts(...) orelse return err.toJS()` site correct.
        E::none => boringssl_err_to_js(global, bun_boringssl_sys::ERR_get_error()),
        E::load_ca_file => global
            .err(ErrorCode::BORINGSSL, format_args!("Failed to load CA file"))
            .to_js(),
        E::invalid_ca_file => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid CA file"))
            .to_js(),
        E::invalid_ca => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid CA"))
            .to_js(),
        E::invalid_ciphers => global
            .err(ErrorCode::BORINGSSL, format_args!("Invalid ciphers"))
            .to_js(),
        E::invalid_crl => global
            .err(
                ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to parse CRL"),
            )
            .to_js(),
        E::invalid_ecdh_curve => global
            .err(
                ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to set ECDH curve"),
            )
            .to_js(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSGlobalObject — SQL-specific extension surface.
// ──────────────────────────────────────────────────────────────────────────

/// SQL-side helpers on `JSGlobalObject` not provided by `bun_jsc` (or where
/// the SQL bindings need a slightly different signature).
pub(crate) trait JSGlobalObjectSqlExt {
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a>;
    /// `globalObject.bunVM()` — `bun_jsc::JSGlobalObject::bun_vm()` returns
    /// `&mut VirtualMachine`; this `&`-receiver form is for SQL callsites that
    /// only need shared access.
    fn sql_vm(&self) -> &VirtualMachine;
}

impl JSGlobalObjectSqlExt for JSGlobalObject {
    #[inline]
    fn err_out_of_range<'a>(&'a self, args: core::fmt::Arguments<'a>) -> ErrorBuilder<'a> {
        self.err(ErrorCode::OUT_OF_RANGE, args)
    }
    #[inline]
    fn sql_vm(&self) -> &VirtualMachine {
        // `JSGlobalObject::bun_vm` is the canonical safe accessor (single
        // audited deref in bun_jsc); the VM is a process-lifetime singleton.
        self.bun_vm()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / EventLoop — direct re-exports from bun_jsc.
//
// bun_sql_jsc already depends on bun_jsc, so the previous opaque-ZST view
// structs that round-tripped through Rust→Rust extern "C" shims
// (Bun__VM__global / Bun__VM__eventLoop / Bun__EventLoop__enterLoop / …)
// were a layering workaround. SQL-specific accessors that bun_jsc doesn't
// expose at this tier (with_sql_state(), timer_insert()/timer_remove()) are provided
// as the [VirtualMachineSqlExt] extension trait.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_io::KeepAlive;
pub use bun_jsc::event_loop::{EventLoop, EventLoopEnterGuard as EventLoopGuard};
pub use bun_jsc::virtual_machine::VirtualMachine;

// ──────────────────────────────────────────────────────────────────────────
// SqlRuntimeHooks — manual cold-path vtable (CYCLEBREAK §Dispatch).
//
// `bun_runtime` owns the per-VM `RuntimeState` (timer heap, SSLConfig parser)
// and *depends on* this crate, so direct
// imports would cycle. Instead of Rust→Rust `extern "C"` shims (which let the
// two sides disagree on pointee types — the previous local `EventLoopTimer` /
// `SSLConfig` stubs were layout-incompatible with what `hw_exports.rs` wrote),
// the low tier defines the fn-pointer table and `bun_runtime::jsc_hooks::
// `__BUN_SQL_RUNTIME_HOOKS` defines a `#[no_mangle]` instance. Every signature here
// is checked by the compiler at the registration site.
// ──────────────────────────────────────────────────────────────────────────

pub struct SqlRuntimeHooks {
    /// Run a closure against this thread's [`RareData`] (`runtime_state().sql_rare`).
    pub with_sql_state: fn(&mut dyn FnMut(&mut RareData)),
    /// `Timer.All.insert` / `Timer.All.remove` on this thread's timer heap.
    pub timer_insert: fn(TimerRef),
    pub timer_remove: fn(TimerRef),
    /// `SSLConfig.fromJS` — parse a JS TLS-options object; `None` when the
    /// value carried no TLS options.
    pub ssl_config_from_js: fn(&JSGlobalObject, JSValue) -> JsResult<Option<bun_http::SSLConfig>>,
}

unsafe extern "Rust" {
    /// The single `&'static` instance, defined `#[no_mangle]` in
    /// `bun_runtime::hw_exports::sql_hooks`. Link-time resolved — no
    /// `AtomicPtr`, no init-order hazard. Immutable POD vtable, so reading it
    /// has no preconditions beyond the link succeeding → `safe static`.
    safe static __BUN_SQL_RUNTIME_HOOKS: SqlRuntimeHooks;
}

#[inline]
fn hooks() -> &'static SqlRuntimeHooks {
    &__BUN_SQL_RUNTIME_HOOKS
}

/// Per-VM SQL state — the concrete crate::mysql::MySQLContext /
/// crate::postgres::PostgresSQLContext.
/// The bun_jsc::rare_data::RareData slots for these are opaque
/// (cycle break: bun_jsc cannot name bun_sql_jsc types), so the storage lives
/// in bun_runtime::jsc_hooks::RuntimeState.sql_rare and is reached via
/// [VirtualMachineSqlExt::with_sql_state].
#[repr(C)]
pub struct RareData {
    pub mysql_context: crate::mysql::MySQLContext,
    pub postgresql_context: crate::postgres::PostgresSQLContext,
}

/// SQL-specific accessors on [VirtualMachine] for state owned by the
/// higher-tier bun_runtime::jsc_hooks::RuntimeState.
pub(crate) trait VirtualMachineSqlExt {
    /// RareData.{mysql,postgresql}_context. `f` must not re-enter anything
    /// that reaches this state.
    fn with_sql_state<R>(&self, f: impl FnOnce(&mut RareData) -> R) -> R;
    /// Link / unlink one of a connection's timer slots on vm.timer.
    fn timer_insert(&self, timer: TimerRef);
    fn timer_remove(&self, timer: TimerRef);
    /// bun_io::EventLoopCtx for the JS-thread VM, for KeepAlive::{ref_,unref}.
    fn vm_ctx(&self) -> bun_io::EventLoopCtx;
    /// Lazy-init `RareData`'s per-protocol uws [`bun_uws::SocketGroup`].
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
    /// See [`Self::postgres_socket_group`].
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
}
impl VirtualMachineSqlExt for VirtualMachine {
    #[inline]
    fn with_sql_state<R>(&self, f: impl FnOnce(&mut RareData) -> R) -> R {
        let mut f = Some(f);
        let mut out = None;
        (hooks().with_sql_state)(&mut |state| out = Some((f.take().unwrap())(state)));
        out.unwrap()
    }
    #[inline]
    fn timer_insert(&self, timer: TimerRef) {
        (hooks().timer_insert)(timer)
    }
    #[inline]
    fn timer_remove(&self, timer: TimerRef) {
        (hooks().timer_remove)(timer)
    }
    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
    #[inline]
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        let loop_ = self.uws_loop();
        self.rare_data().postgres_group::<SSL>(loop_)
    }
    #[inline]
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        let loop_ = self.uws_loop();
        self.rare_data().mysql_group::<SSL>(loop_)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Timer heap / EventLoopTimer.
//
// The intrusive `EventLoopTimer` node + `Tag`/`State` enums are the canonical
// `bun_event_loop` types (lower tier — also what `bun_runtime::dispatch::
// fire_timer` reads via `from_field_ptr!`). The previous local `#[repr(C)]`
// stub diverged on layout (`[usize;3]` heap, no `in_heap`) *and* discriminants
// (Tag::PostgresSQLConnectionTimeout=1 vs canonical 8, State::FIRED/CANCELLED
// swapped), so insertion into the real pairing-heap was UB and tag dispatch
// mis-routed.
//
// `Timer::All` (the heap container) lives in `bun_runtime::RuntimeState`;
// reached via [`SqlRuntimeHooks::timer_insert`] / `timer_remove`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, State as EventLoopTimerState, Tag as EventLoopTimerTag, TimerRef,
};

pub use bun_jsc::{AutoFlushTarget, AutoFlusher};

// ──────────────────────────────────────────────────────────────────────────
// api::ServerConfig::SSLConfig — the connection's TLS options.
//
// Parsing a JS `tls: {...}` object needs `node:fs` / `Blob` (high tier), so it
// goes through [`SqlRuntimeHooks::ssl_config_from_js`]; the parsed
// `bun_http::SSLConfig` is owned here.
// ──────────────────────────────────────────────────────────────────────────

pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;

        /// A connection's TLS options. `None` inside = `tls: true`: the
        /// defaults, with no overrides.
        #[derive(Default)]
        pub struct SSLConfig(Option<bun_http::SSLConfig>);

        impl SSLConfig {
            /// The SNI hostname, if one was configured.
            #[inline]
            pub(crate) fn server_name(&self) -> Option<&core::ffi::CStr> {
                self.0
                    .as_ref()
                    .and_then(bun_http::SSLConfig::server_name_cstr)
            }

            /// `SSLConfig.reject_unauthorized` — non-zero rejects on verify error.
            #[inline]
            pub(crate) fn reject_unauthorized(&self) -> i32 {
                self.0.as_ref().map_or(0, |c| c.reject_unauthorized)
            }

            /// `SSLConfig.fromJS(vm, global, value)` — VM is accepted but
            /// unused (the hook recovers it from `global`).
            pub(crate) fn from_js<V>(
                _vm: V,
                global: &JSGlobalObject,
                value: JSValue,
            ) -> JsResult<Option<Self>> {
                match (hooks().ssl_config_from_js)(global, value) {
                    Ok(config) => Ok(config.map(|c| Self(Some(c)))),
                    Err(JsError::OutOfMemory) => Err(global.throw_out_of_memory()),
                    Err(e) => Err(e),
                }
            }

            /// `SSLConfig.asUSocketsForClientVerification` — projects to the
            /// `#[repr(C)]` `us_bun_socket_context_options_t` for client mode
            /// (request_cert=1, reject_unauthorized=0; SQL re-verifies hostname
            /// itself). Returns `Default` for the empty/`tls:true` config.
            pub(crate) fn as_usockets_for_client_verification(
                &self,
            ) -> bun_uws::us_bun_socket_context_options_t {
                match &self.0 {
                    None => bun_uws::us_bun_socket_context_options_t {
                        request_cert: 1,
                        reject_unauthorized: 0,
                        ..Default::default()
                    },
                    Some(c) => c.as_usockets_for_client_verification(),
                }
            }
        }
    }
    /// PascalCase namespace alias.
    #[allow(non_snake_case)]
    pub mod ServerConfig {
        pub use super::server_config::SSLConfig;
    }
}

pub mod webcore {
    pub use bun_jsc::webcore::Blob;
}

/// `bun_jsc::JsClass` — generic downcast trait backing `JSValue::as_<T>()`.
/// Re-exported so the codegen module's blanket impls land on the same trait
/// `bun_jsc::JSValue::as_<T>()` keys on.
pub use bun_jsc::JsClass;

// ──────────────────────────────────────────────────────────────────────────
// codegen::JS{Type} — per-JsClass cached-value getters/setters generated from
// `.classes.ts`.
// ──────────────────────────────────────────────────────────────────────────

pub mod codegen {
    ::bun_jsc::js_class_module!(JSPostgresSQLConnection = "PostgresSQLConnection"
        as crate::postgres::PostgresSQLConnection { queries, onconnect, onclose, onnotification });
    ::bun_jsc::js_class_module!(
        JSPostgresSQLQuery = "PostgresSQLQuery" as crate::postgres::PostgresSQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );

    ::bun_jsc::js_class_module!(js_mysql_connection = "MySQLConnection"
        as crate::mysql::js_my_sql_connection::JSMySQLConnection { queries, onconnect, onclose });
    pub use js_mysql_connection as JSMySQLConnection;

    ::bun_jsc::js_class_module!(
        js_mysql_query = "MySQLQuery" as crate::mysql::js_mysql_query::JSMySQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );
    pub use js_mysql_query as JSMySQLQuery;
}

// ──────────────────────────────────────────────────────────────────────────
// JSFunction — host-function constructor.
//
// Forwards to `bun_jsc::JSFunction::create`; kept local for the
// [`IntoJSHostFn`] plumbing that lets callsites pass safe Rust fns.
// ──────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub(crate) struct JSFunction {
    _opaque: [u8; 0],
    _m: PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

/// `jsc.JSHostFn` — the JSC-ABI host-function pointer JSC dispatches to
/// (`extern "sysv64"` on win-x64, `extern "C"` elsewhere). Re-exported from
/// `bun_jsc` so the cfg-split lives in one place.
pub use bun_jsc::host_fn::JsHostFn as JSHostFn;

pub(crate) trait IntoJSHostFn<Marker>: Sized {
    fn into_js_host_fn(self) -> JSHostFn;
}
#[doc(hidden)]
pub(crate) struct HostFnResult;
#[doc(hidden)]
pub(crate) struct HostFnPlain;

// `jsc_host_abi!` can't express a generic `where` clause, so cfg-split the
// thunk body manually (sysv64 on win-x64, C elsewhere — matches `JSHostFn`).
// The where-clause is bracketed to avoid `tt`-muncher ambiguity against `{`.
// Thunk bodies scope their raw-ptr derefs locally, so the fn itself has no
// caller preconditions; a safe `extern fn` coerces to the `JSHostFn` type.
macro_rules! sql_jsc_host_thunk {
    ($name:ident<$F:ident>($($args:tt)*) -> $ret:ty where [$($bound:tt)+] $body:block) => {
        #[cfg(all(windows, target_arch = "x86_64"))]
        extern "sysv64" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
        #[cfg(not(all(windows, target_arch = "x86_64")))]
        extern "C" fn $name<$F>($($args)*) -> $ret where $($bound)+ $body
    };
}

impl<F> IntoJSHostFn<HostFnResult> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJSHostFn: expected fn item (ZST)"
        );
        let _ = self;
        sql_jsc_host_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes its live global / call frame; both are opaque handles.
                let global = bun_opaque::opaque_deref(g);
                let frame = bun_opaque::opaque_deref(c);
                match f(global, frame) {
                    Ok(v) => v,
                    Err(JsError::OutOfMemory) => { let _ = global.throw_out_of_memory(); JSValue::ZERO }
                    Err(_) => JSValue::ZERO,
                }
            }
        }
        thunk::<F>
    }
}
impl<F> IntoJSHostFn<HostFnPlain> for F
where
    F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static,
{
    fn into_js_host_fn(self) -> JSHostFn {
        debug_assert_eq!(
            core::mem::size_of::<F>(),
            0,
            "IntoJSHostFn: expected fn item (ZST)"
        );
        let _ = self;
        sql_jsc_host_thunk! {
            thunk<F>(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue
            where [F: Fn(&JSGlobalObject, &CallFrame) -> JSValue + Copy + 'static]
            {
                let f: F = bun_core::ffi::conjure_zst::<F>();
                // JSC passes its live global / call frame; both are opaque handles.
                let global = bun_opaque::opaque_deref(g);
                let frame = bun_opaque::opaque_deref(c);
                f(global, frame)
            }
        }
        thunk::<F>
    }
}

pub use bun_jsc::js_function::CreateJSFunctionOptions;

/// `bun_jsc::JSValue::put_host_functions`-shaped helper for the SQL binding
/// objects. Macro (not fn) because each entry's `$f` is a *distinct* fn-item
/// ZST routed through [`IntoJSHostFn`] — a `&[(&str, JSHostFn, u32)]` slice
/// can't hold heterogeneous safe-Rust signatures. Expands to the same
/// `put`/`JSFunction::create` ladder the open-coded sites used; returns the
/// receiver for chaining.
#[macro_export]
macro_rules! put_host_functions {
    ($obj:expr, $global:expr, [ $( ($name:literal, $f:expr, $arity:expr) ),* $(,)? ]) => {{
        let __obj: $crate::jsc::JSValue = $obj;
        let __g = $global;
        $(
            __obj.put(
                __g,
                $name.as_bytes(),
                $crate::jsc::JSFunction::create(__g, $name, $f, $arity, ::core::default::Default::default()),
            );
        )*
        __obj
    }};
}

impl JSFunction {
    /// Accepts a safe Rust `fn(&JSGlobalObject, &CallFrame) -> JSValue` /
    /// `-> JsResult<JSValue>` via [`IntoJSHostFn`].
    pub(crate) fn create<M, F: IntoJSHostFn<M>>(
        global: &JSGlobalObject,
        name: &'static str,
        implementation: F,
        arg_count: u32,
        opts: CreateJSFunctionOptions,
    ) -> JSValue {
        bun_jsc::JSFunction::create(
            global,
            name,
            implementation.into_js_host_fn(),
            arg_count,
            opts,
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame helpers — `bun_jsc::ArgumentsSlice` exists; this local variant
// keeps the `&VirtualMachine` (local view) signature the SQL callsites use.
// ──────────────────────────────────────────────────────────────────────────

pub(crate) mod call_frame {
    use super::*;
    /// Cursor over a `&[JSValue]`.
    pub(crate) struct ArgumentsSlice<'a> {
        remaining: &'a [JSValue],
    }
    impl<'a> ArgumentsSlice<'a> {
        /// Generic over the VM handle so it accepts both the local
        /// [`VirtualMachine`] and `bun_jsc`'s. The VM is not used.
        pub(crate) fn init<V>(_vm: V, slice: &'a [JSValue]) -> Self {
            Self { remaining: slice }
        }
        /// Return the head **and** advance.
        #[inline]
        pub(crate) fn next_eat(&mut self) -> Option<JSValue> {
            let (first, rest) = self.remaining.split_first()?;
            self.remaining = rest;
            Some(*first)
        }
    }
}
