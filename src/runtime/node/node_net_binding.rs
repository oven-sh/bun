//
//

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};

// ─── type defs (real) ─────────────────────────────────────────────────────

// Zig: `pub var autoSelectFamilyDefault: bool = true;`
// PORT NOTE: reshaped for borrowck — Rust forbids safe `static mut`; use AtomicBool.
pub static AUTO_SELECT_FAMILY_DEFAULT: AtomicBool = AtomicBool::new(true);

/// This is only used to provide the getDefaultAutoSelectFamilyAttemptTimeout and
/// setDefaultAutoSelectFamilyAttemptTimeout functions, not currently read by any other code. It's
/// `threadlocal` because Node.js expects each Worker to have its own copy of this, and currently
/// it can only be accessed by accessor functions which run on each Worker's main JavaScript thread.
///
/// If this becomes used in more places, and especially if it can be read by other threads, we may
/// need to store it as a field in the VirtualMachine instead of in a `threadlocal`.
thread_local! {
    pub static AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT: Cell<u32> = const { Cell::new(250) };
}

// ─── gated: JSC binding fns ───────────────────────────────────────────────
// All bodies build `JSFunction`/`JSValue` and reach `crate::api::{Listener,
// TCPSocket, TLSSocket}` whose struct shapes / `bun_jsc::codegen` re-exports
// are not yet stable. The two statics above are the only JSC-free state.
// TODO(b2-blocked): un-gate once bun_jsc JSFunction/codegen + crate::api socket types land.

mod _impl {
use super::*;

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

use crate::node::util::validators;

pub fn get_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(AUTO_SELECT_FAMILY_DEFAULT.load(Ordering::Relaxed)))
    }
    // `#[bun_jsc::host_fn]` emits a `__jsc_host_<name>` shim with the raw `JSHostFn` ABI.
    JSFunction::create(global, "getDefaultAutoSelectFamily", __jsc_host_getter, 0, Default::default())
}

pub fn set_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw(format_args!("missing argument")));
        }
        let arg = arguments.slice()[0];
        if !arg.is_boolean() {
            return global.throw_invalid_arguments(format_args!("autoSelectFamilyDefault"));
        }
        let value = arg.to_boolean();
        AUTO_SELECT_FAMILY_DEFAULT.store(value, Ordering::Relaxed);
        Ok(JSValue::from(value))
    }
    JSFunction::create(global, "setDefaultAutoSelectFamily", __jsc_host_setter, 1, Default::default())
}

pub fn get_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            f64::from(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT.with(|v| v.get())),
        ))
    }
    JSFunction::create(
        global,
        "getDefaultAutoSelectFamilyAttemptTimeout",
        __jsc_host_getter,
        0,
        Default::default(),
    )
}

pub fn set_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw(format_args!("missing argument")));
        }
        let arg = arguments.slice()[0];
        let mut value = validators::validate_int32(global, arg, format_args!("value"), Some(1), None)?;
        if value < 10 {
            value = 10;
        }
        AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT
            .with(|v| v.set(u32::try_from(value).unwrap()));
        Ok(JSValue::js_number(f64::from(value)))
    }
    JSFunction::create(
        global,
        "setDefaultAutoSelectFamilyAttemptTimeout",
        __jsc_host_setter,
        1,
        Default::default(),
    )
}

// Zig: `pub const SocketAddress = bun.jsc.Codegen.JSSocketAddress.getConstructor;`
// The per-class `JS${Type}` codegen modules are not yet emitted in Rust; bind the
// `${Type}__getConstructor` externs directly (same symbols the `#[bun_jsc::JsClass]`
// proc-macro wires up — see src/jsc_macros/lib.rs `get_ctor_sym`).
#[allow(non_snake_case)]
pub fn SocketAddress(global: &JSGlobalObject) -> JSValue {
    unsafe extern "C" {
        #[link_name = "SocketAddress__getConstructor"]
        fn __get_constructor(global: *mut JSGlobalObject) -> JSValue;
    }
    // SAFETY: codegen'd C++ getter; global is a live JSGlobalObject.
    unsafe { __get_constructor(global.as_mut_ptr()) }
}

// Zig: `pub const BlockList = jsc.Codegen.JSBlockList.getConstructor;`
#[allow(non_snake_case)]
pub fn BlockList(global: &JSGlobalObject) -> JSValue {
    unsafe extern "C" {
        #[link_name = "BlockList__getConstructor"]
        fn __get_constructor(global: *mut JSGlobalObject) -> JSValue;
    }
    // SAFETY: codegen'd C++ getter; global is a live JSGlobalObject.
    unsafe { __get_constructor(global.as_mut_ptr()) }
}

#[bun_jsc::host_fn]
pub fn new_detached_socket(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<1>();
    let _is_ssl = args[0].to_boolean();

    // Zig:
    //   const socket = bun.api.{TCP,TLS}Socket.new(.{
    //       .socket = .detached, .ref_count = .init(),
    //       .protos = null, .handlers = null,
    //   });
    //   return socket.getThisValue(globalThis);
    //
    // The Rust `crate::socket::NewSocket<SSL>` struct shape currently lacks
    // `new()`/`get_this_value()` and the `JsClass` codegen impl (the per-
    // monomorphisation `JS{TCP,TLS}Socket` codegen externs are not yet wired —
    // see socket_body.rs `to_js`).
    todo!("blocked_on: crate::socket::NewSocket<SSL>::{{new,get_this_value}} + jsc.Codegen.JS{{TCP,TLS}}Socket")
}

#[bun_jsc::host_fn]
pub fn do_connect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [_prev, opts] = frame.arguments_as_array::<2>();
    // Zig: `prev.as(bun.api.{TCP,TLS}Socket)` — requires `JsClass` impl on
    // `NewSocket<SSL>`, which the `#[bun_jsc::JsClass]` derive cannot emit for
    // a const-generic type (two distinct codegen classes). Until those externs
    // land, fall back to the no-prev-socket path so `Bun.connect()` (which
    // passes `null` here) still works.
    // TODO(port): wire `prev.as_::<TCPSocket>()` / `prev.as_::<TLSSocket>()` once
    // `impl JsClass for NewSocket<{false,true}>` exists.
    crate::socket::listener::Listener::connect_inner(global, None, None, opts)
}
} // mod _impl

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_net_binding.zig (106 lines)
//   confidence: medium
//   todos:      2
//   notes:      JSFunction::create signature, TCPSocket/TLSSocket init shape, and codegen re-exports need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
