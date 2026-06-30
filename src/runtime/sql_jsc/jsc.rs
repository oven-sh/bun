//! `bun_jsc` re-export façade for the SQL bindings.
//!
//! `bun_jsc` surface re-exported wholesale; items below are SQL-specific glue
//! (extension traits [`JSGlobalObjectSqlExt`], [`VirtualMachineSqlExt`],
//! [`EventLoopSqlExt`], …).
//!
//! [`RareData`] here is the **per-VM SQL state** (`mysql_context` /
//! `postgresql_context`) that `bun_runtime::jsc_hooks::RuntimeState` owns by
//! value — it is *not* a view of `bun_jsc::rare_data::RareData` (which holds
//! the per-protocol `SocketGroup`s and is reached via the inherent
//! `VirtualMachine::rare_data()`).

#![warn(unused_must_use)]

use core::ffi::{c_char, c_void};
use core::ptr::NonNull;

// ──────────────────────────────────────────────────────────────────────────
// Core handles — re-exported from `bun_jsc` so proc-macro generated wrappers
// (which hard-code `bun_jsc::JSGlobalObject` / `bun_jsc::CallFrame` / …) see
// the same types as user code importing `crate::sql_jsc::jsc::*`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::*;

// ──────────────────────────────────────────────────────────────────────────
// host_fn helpers (mirrors bun_jsc::host_fn::from_js_host_call*; kept local
// for the few extension-trait bodies below that call extern "C" symbols
// directly).
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// uws.create_bun_socket_error_t::toJS
//
// Canonical impl (and the `boringssl_err_to_js` it calls) lives in
// `bun_jsc::system_error`; re-exported here for the SQL connection
// `createInstance` paths.
// ──────────────────────────────────────────────────────────────────────────

pub(crate) use bun_jsc::system_error::create_bun_socket_error_to_js;

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
    fn sql_vm_ptr(&self) -> *mut VirtualMachine;
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
    #[inline]
    fn sql_vm_ptr(&self) -> *mut VirtualMachine {
        JSC__JSGlobalObject__bunVM(self).cast::<VirtualMachine>()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// VirtualMachine / EventLoop — direct re-exports from bun_jsc.
//
// This module depends on bun_jsc, so the previous opaque-ZST view
// structs that round-tripped through Rust→Rust extern "C" shims
// (Bun__VM__global / Bun__VM__eventLoop / Bun__EventLoop__enterLoop / …)
// were a layering workaround. SQL-specific accessors that bun_jsc doesn't
// expose at this tier (sql_state(), timer()) are provided
// as the [VirtualMachineSqlExt] extension trait.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_io::KeepAlive;
pub use bun_jsc::event_loop::{EventLoop, EventLoopEnterGuard as EventLoopGuard};
pub use bun_jsc::virtual_machine::VirtualMachine;

/// Per-VM SQL state — the concrete crate::sql_jsc::mysql::MySQLContext /
/// crate::sql_jsc::postgres::PostgresSQLContext.
/// The bun_jsc::rare_data::RareData slots for these are opaque
/// (cycle break: bun_jsc cannot name bun_runtime::sql_jsc types), so the
/// storage lives in crate::jsc_hooks::RuntimeState.sql_rare and is reached via
/// [VirtualMachineSqlExt::sql_state].
#[repr(C)]
pub struct RareData {
    pub mysql_context: crate::sql_jsc::mysql::MySQLContext,
    pub postgresql_context: crate::sql_jsc::postgres::PostgresSQLContext,
}

/// SQL-specific accessors on [VirtualMachine] for state owned by the
/// higher-tier bun_runtime::jsc_hooks::RuntimeState.
pub(crate) trait VirtualMachineSqlExt {
    /// RareData.{mysql,postgresql}_context. Named sql_state to avoid
    /// shadowing the inherent VirtualMachine::rare_data() (which returns the
    /// bun_jsc RareData holding the per-protocol SocketGroups).
    fn sql_state(&mut self) -> &mut RareData;
    /// vm.timer — the Timer::All heap.
    fn timer(&mut self) -> &mut bun_jsc::timer::All;
    /// bun_io::EventLoopCtx for the JS-thread VM, for KeepAlive::{ref_,unref}.
    fn vm_ctx(&self) -> bun_io::EventLoopCtx;
    /// Lazy-init `RareData`'s per-protocol uws [`bun_uws::SocketGroup`].
    /// Encapsulates the `rare_data(&mut self)` / `*_group(.., &VirtualMachine)`
    /// borrowck conflict (the two borrows touch field-disjoint state) so the
    /// four call sites need no per-site raw-pointer dance.
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
    /// See [`Self::postgres_socket_group`].
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup;
    // NOTE: `event_loop_mut` lives on `VirtualMachine` as a safe inherent
    // accessor (single audited deref under the JS-thread-singleton invariant);
    // the former unsafe trait shim here was dead — inherent methods always win
    // method resolution over this extension trait.
}
impl VirtualMachineSqlExt for VirtualMachine {
    #[inline]
    fn sql_state(&mut self) -> &mut RareData {
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState`; `sql_rare` is
        // an embedded field with stable address for the VM lifetime.
        unsafe { &mut (*state).sql_rare }
    }
    #[inline]
    fn timer(&mut self) -> &mut bun_jsc::timer::All {
        bun_jsc::timer::timer_all_mut()
    }
    #[inline]
    fn vm_ctx(&self) -> bun_io::EventLoopCtx {
        bun_io::js_vm_ctx()
    }
    #[inline]
    fn postgres_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        // `rare_data()` returns the boxed `&mut RareData` (disjoint allocation);
        // `*_group` only reads `vm.uws_loop()`. Route the read-only `vm`
        // argument through the JS-thread singleton accessor instead of a
        // raw-pointer split-borrow — `VirtualMachine::get()` is `&'static`
        // and doesn't borrow `self`, so borrowck is satisfied without a
        // per-site raw-pointer deref.
        self.rare_data()
            .postgres_group::<SSL>(VirtualMachine::get())
    }
    #[inline]
    fn mysql_socket_group<const SSL: bool>(&mut self) -> &mut bun_uws::SocketGroup {
        // See `postgres_socket_group` — singleton `&'static` for the read-only
        // `vm` argument avoids the raw-pointer split-borrow.
        self.rare_data().mysql_group::<SSL>(VirtualMachine::get())
    }
}

/// RAII enter()/exit() for [EventLoop] — wraps the inherent (unsafe,
/// raw-pointer) bun_jsc::event_loop::EventLoop::enter_scope.
pub(crate) trait EventLoopSqlExt {
    fn entered(&mut self) -> EventLoopGuard;
}
impl EventLoopSqlExt for EventLoop {
    #[inline]
    fn entered(&mut self) -> EventLoopGuard {
        // SAFETY: self is the live VM-owned event loop; the guard holds the
        // raw pointer so no &mut is held across re-entrant JS.
        unsafe { EventLoop::enter_scope(self) }
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
// `Timer::All` (the heap container) is `bun_jsc::timer::All`; reached via
// [`VirtualMachineSqlExt::timer`].
// ──────────────────────────────────────────────────────────────────────────

pub use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

// ──────────────────────────────────────────────────────────────────────────
// AutoFlusher — thin VM-taking wrapper over
// bun_jsc::event_loop::EventLoop::deferred_tasks.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Debug)]
pub struct AutoFlusher {
    pub registered: bool,
}

/// SQL connection types implement this to participate in deferred flushing.
pub trait HasAutoFlush: Sized {
    fn on_auto_flush(this: *mut Self) -> bool;
}

impl AutoFlusher {
    pub fn register_deferred_microtask_with_type_unchecked<T: HasAutoFlush>(
        this: *mut T,
        vm: &VirtualMachine,
    ) {
        // Body is fully safe — `cast()` is safe and `on_auto_flush` takes a
        // raw pointer by value. `ctx` is the `*mut T` registered below; the
        // queue feeds it back unchanged. A safe `extern "C" fn` coerces to the
        // `DeferredRepeatingTask` fn-pointer type.
        extern "C" fn trampoline<T: HasAutoFlush>(ctx: *mut c_void) -> bool {
            T::on_auto_flush(ctx.cast::<T>())
        }
        // `event_loop_mut()` is the canonical safe `&mut EventLoop` accessor
        // (single audited deref inside `VirtualMachine`); `deferred_tasks` is an
        // embedded field with stable address for the VM lifetime.
        let q = &mut vm.event_loop_mut().deferred_tasks;
        q.post_task(NonNull::new(this.cast::<c_void>()), trampoline::<T>);
    }
    pub fn unregister_deferred_microtask_with_type<T>(this: *mut T, vm: &VirtualMachine) {
        // See register_deferred_microtask_with_type_unchecked.
        let q = &mut vm.event_loop_mut().deferred_tasks;
        q.unregister_task(NonNull::new(this.cast::<c_void>()));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// api::server_config::SSLConfig — owning handle to a boxed
// `bun_http::ssl_config::SSLConfig`.
//
// `None` = the default-constructed config (callers that pass `tls: true` with
// no overrides); the two fields SQL reads (`server_name`,
// `reject_unauthorized`) and `as_usockets_for_client_verification` come from
// the canonical `bun_http::ssl_config::SSLConfig`.
// ──────────────────────────────────────────────────────────────────────────

pub mod api {
    use super::*;
    pub mod server_config {
        use super::*;
        use bun_http::ssl_config::SSLConfig as HttpSSLConfig;

        /// Owning handle to a `Box<bun_http::ssl_config::SSLConfig>`. `None` =
        /// the default-constructed config — callers that pass
        /// `tls: true` get an SSLConfig with no overrides.
        #[derive(Default)]
        pub struct SSLConfig(Option<Box<HttpSSLConfig>>);

        impl SSLConfig {
            /// `SSLConfig.server_name` — the SNI hostname C string, or null
            /// when unset / default.
            #[inline]
            pub fn server_name(&self) -> *const c_char {
                match &self.0 {
                    None => core::ptr::null(),
                    Some(cfg) => cfg.server_name,
                }
            }

            /// `SSLConfig.reject_unauthorized` — non-zero rejects on verify error.
            #[inline]
            pub fn reject_unauthorized(&self) -> i32 {
                match &self.0 {
                    None => 0,
                    Some(cfg) => cfg.reject_unauthorized,
                }
            }

            /// `SSLConfig.fromJS(vm, global, value)` — VM is accepted but
            /// unused (recovered from `global`).
            pub fn from_js<V>(
                _vm: V,
                global: &JSGlobalObject,
                value: JSValue,
            ) -> JsResult<Option<Self>> {
                let cfg =
                    match crate::socket::ssl_config::from_js(global.bun_vm_ref(), global, value) {
                        Ok(cfg) => cfg,
                        Err(JsError::OutOfMemory) => {
                            let _ = global.throw_out_of_memory();
                            None
                        }
                        Err(_) => None,
                    };
                if global.has_exception() {
                    debug_assert!(cfg.is_none());
                    return Err(JsError::Thrown);
                }
                Ok(cfg.map(|cfg| Self(Some(Box::new(cfg)))))
            }

            /// `SSLConfig.asUSocketsForClientVerification` — projects to the
            /// `#[repr(C)]` `BunSocketContextOptions` for client mode
            /// (request_cert=1, reject_unauthorized=0; SQL re-verifies hostname
            /// itself). Returns `Default` for the empty/`tls:true` config.
            pub fn as_usockets_for_client_verification(&self) -> bun_uws::BunSocketContextOptions {
                match &self.0 {
                    None => bun_uws::BunSocketContextOptions {
                        request_cert: 1,
                        reject_unauthorized: 0,
                        ..Default::default()
                    },
                    Some(cfg) => cfg.as_usockets_for_client_verification(),
                }
            }
        }
    }
}

pub mod webcore {
    pub use super::AutoFlusher;

    pub use crate::webcore::Blob;
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
        as crate::sql_jsc::postgres::PostgresSQLConnection { queries, onconnect, onclose });
    ::bun_jsc::js_class_module!(
        JSPostgresSQLQuery = "PostgresSQLQuery" as crate::sql_jsc::postgres::PostgresSQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );

    ::bun_jsc::js_class_module!(js_mysql_connection = "MySQLConnection"
        as crate::sql_jsc::mysql::js_mysql_connection::JSMySQLConnection { queries, onconnect, onclose });
    pub use js_mysql_connection as JSMySQLConnection;

    ::bun_jsc::js_class_module!(
        js_mysql_query = "MySQLQuery" as crate::sql_jsc::mysql::js_mysql_query::JSMySQLQuery,
        impl_js_class {
            binding,
            columns,
            pendingValue,
            target
        }
    );
    pub use js_mysql_query as JSMySQLQuery;
}

pub use bun_jsc::JSFunction;

/// `bun_jsc::JSValue::put_host_functions`-shaped helper for the SQL binding
/// objects. Macro (not fn) because each entry's `$f` is a *distinct* fn-item
/// ZST routed through [`bun_jsc::js_function::IntoJsHostFn`] — a
/// `&[(&str, JSHostFn, u32)]` slice can't hold heterogeneous safe-Rust
/// signatures. Expands to the same `put`/`JSFunction::create_from_host_fn`
/// ladder the open-coded sites used; returns the receiver for chaining.
#[macro_export]
macro_rules! put_host_functions {
    ($obj:expr, $global:expr, [ $( ($name:literal, $f:expr, $arity:expr) ),* $(,)? ]) => {{
        let __obj: $crate::sql_jsc::jsc::JSValue = $obj;
        let __g = $global;
        $(
            __obj.put(
                __g,
                $name.as_bytes(),
                $crate::sql_jsc::jsc::JSFunction::create_from_host_fn(__g, $name, $f, $arity, ::core::default::Default::default()),
            );
        )*
        __obj
    }};
}

// ──────────────────────────────────────────────────────────────────────────
// CallFrame helpers — `bun_jsc::ArgumentsSlice` exists; this local variant
// keeps the `&VirtualMachine` (local view) signature the SQL callsites use.
// ──────────────────────────────────────────────────────────────────────────

pub mod call_frame {
    use super::*;
    /// Cursor over a `&[JSValue]`.
    pub(crate) struct ArgumentsSlice<'a> {
        remaining: &'a [JSValue],
        _vm: *const c_void,
    }
    impl<'a> ArgumentsSlice<'a> {
        /// Generic over the VM handle so it accepts both the local
        /// [`VirtualMachine`] and `bun_jsc`'s (callers pass `global.bun_vm()`,
        /// which returns a raw `*mut VirtualMachine`). The VM is not
        /// dereferenced, so it's accepted by-value and dropped.
        pub(crate) fn init<V>(_vm: V, slice: &'a [JSValue]) -> Self {
            Self {
                remaining: slice,
                _vm: core::ptr::null(),
            }
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

// ──────────────────────────────────────────────────────────────────────────
// MarkedArgumentBuffer::run — C++-side trampoline. `bun_jsc::MarkedArgumentBuffer`
// exposes `new(f)`; the SQL callsites use the lower-level `run(ctx, fn_ptr)`
// shape, kept here as a free fn (cannot add inherent methods to a foreign type).
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// extern "C" — **C++** JSC bindings (src/jsc/bindings/bindings.cpp) used by
// the extension traits above. No Rust-defined symbols are declared here.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    // JSValue — by-value `JSValue` (encoded NaN-boxed u64) + scalar args; the
    // C++ side reads no caller memory and upholds no invariants the caller must
    // discharge, so these are `safe fn`.

    // JSGlobalObject — `&JSGlobalObject` is ABI-identical to a non-null
    // `*const JSGlobalObject`; the reference type discharges the validity
    // precondition, so `safe fn`. Returned pointer is opaque (caller derefs
    // under its own SAFETY obligation).
    safe fn JSC__JSGlobalObject__bunVM(this: &JSGlobalObject) -> *mut c_void;

}
