//
//

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

use super::util::validators;
use crate::api::{Listener, TCPSocket, TLSSocket};

// Zig: `pub var autoSelectFamilyDefault: bool = true;`
// PORT NOTE: reshaped for borrowck — Rust forbids safe `static mut`; use AtomicBool.
pub static AUTO_SELECT_FAMILY_DEFAULT: AtomicBool = AtomicBool::new(true);

pub fn get_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(AUTO_SELECT_FAMILY_DEFAULT.load(Ordering::Relaxed)))
    }
    JSFunction::create(global, "getDefaultAutoSelectFamily", getter, 0, Default::default())
}

pub fn set_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old(1);
        if arguments.len() < 1 {
            return global.throw(format_args!("missing argument"));
        }
        let arg = arguments.slice()[0];
        if !arg.is_boolean() {
            return global.throw_invalid_arguments(format_args!("autoSelectFamilyDefault"));
        }
        let value = arg.to_boolean();
        AUTO_SELECT_FAMILY_DEFAULT.store(value, Ordering::Relaxed);
        Ok(JSValue::from(value))
    }
    JSFunction::create(global, "setDefaultAutoSelectFamily", setter, 1, Default::default())
}

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

pub fn get_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(
            AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT.with(|v| v.get()),
        ))
    }
    JSFunction::create(
        global,
        "getDefaultAutoSelectFamilyAttemptTimeout",
        getter,
        0,
        Default::default(),
    )
}

pub fn set_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old(1);
        if arguments.len() < 1 {
            return global.throw(format_args!("missing argument"));
        }
        let arg = arguments.slice()[0];
        let mut value = validators::validate_int32(global, arg, "value", format_args!(""), Some(1), None)?;
        if value < 10 {
            value = 10;
        }
        AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT
            .with(|v| v.set(u32::try_from(value).unwrap()));
        Ok(JSValue::js_number(value))
    }
    JSFunction::create(
        global,
        "setDefaultAutoSelectFamilyAttemptTimeout",
        setter,
        1,
        Default::default(),
    )
}

pub use bun_jsc::codegen::JSSocketAddress::get_constructor as SocketAddress;

pub use bun_jsc::codegen::JSBlockList::get_constructor as BlockList;

#[bun_jsc::host_fn]
pub fn new_detached_socket(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<1>();
    let is_ssl = args[0].to_boolean();

    if !is_ssl {
        // TODO(port): TCPSocket::new struct-init shape — verify field names/defaults in Phase B
        let socket = TCPSocket::new(TCPSocket {
            socket: crate::api::Socket::Detached,
            ref_count: Default::default(),
            protos: None,
            handlers: None,
            ..Default::default()
        });
        Ok(socket.get_this_value(global))
    } else {
        // TODO(port): TLSSocket::new struct-init shape — verify field names/defaults in Phase B
        let socket = TLSSocket::new(TLSSocket {
            socket: crate::api::Socket::Detached,
            ref_count: Default::default(),
            protos: None,
            handlers: None,
            ..Default::default()
        });
        Ok(socket.get_this_value(global))
    }
}

#[bun_jsc::host_fn]
pub fn do_connect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [prev, opts] = frame.arguments_as_array::<2>();
    let maybe_tcp = prev.as_type::<TCPSocket>();
    let maybe_tls = prev.as_type::<TLSSocket>();
    Listener::connect_inner(global, maybe_tcp, maybe_tls, opts)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_net_binding.zig (106 lines)
//   confidence: medium
//   todos:      2
//   notes:      JSFunction::create signature, TCPSocket/TLSSocket init shape, and codegen re-exports need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
