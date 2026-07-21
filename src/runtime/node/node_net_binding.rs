//
//

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_io::KeepAlive;
use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_uws as uws;

use crate::node::util::validators;
use crate::socket::{Listener, NativeCallbacks, NewSocket, SocketFlags, TCPSocket, TLSSocket};

pub(crate) static AUTO_SELECT_FAMILY_DEFAULT: AtomicBool = AtomicBool::new(true);

// This is only used to provide the getDefaultAutoSelectFamilyAttemptTimeout and
// setDefaultAutoSelectFamilyAttemptTimeout functions, not currently read by any other code. It's
// `threadlocal` because Node.js expects each Worker to have its own copy of this, and currently
// it can only be accessed by accessor functions which run on each Worker's main JavaScript thread.
//
// If this becomes used in more places, and especially if it can be read by other threads, we may
// need to store it as a field in the VirtualMachine instead of in a `threadlocal`.
thread_local! {
    // Node's default is 250ms with a documented floor of 10ms, but the CLI
    // default in node_options.h is 500ms; the vendored test/common multiplies
    // the default by 5 (upstream) assuming 500.
    pub(crate) static AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT: Cell<u32> = const { Cell::new(500) };
}

pub(crate) fn get_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn(export = "Bun__NodeNet__getDefaultAutoSelectFamily")]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::from(
            AUTO_SELECT_FAMILY_DEFAULT.load(Ordering::Relaxed),
        ))
    }
    // `#[bun_jsc::host_fn]` emits a `__jsc_host_<name>` shim with the raw `JSHostFn` ABI.
    JSFunction::create(
        global,
        "getDefaultAutoSelectFamily",
        __jsc_host_getter,
        0,
        Default::default(),
    )
}

pub(crate) fn set_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn(export = "Bun__NodeNet__setDefaultAutoSelectFamily")]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw(format_args!("missing argument")));
        }
        let arg = arguments.slice()[0];
        if !arg.is_boolean() {
            return Err(global.throw_invalid_arguments(format_args!("autoSelectFamilyDefault")));
        }
        let value = arg.to_boolean();
        AUTO_SELECT_FAMILY_DEFAULT.store(value, Ordering::Relaxed);
        Ok(JSValue::from(value))
    }
    JSFunction::create(
        global,
        "setDefaultAutoSelectFamily",
        __jsc_host_setter,
        1,
        Default::default(),
    )
}

pub(crate) fn get_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn(export = "Bun__NodeNet__getDefaultAutoSelectFamilyAttemptTimeout")]
    fn getter(_global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_number(f64::from(
            AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT.with(|v| v.get()),
        )))
    }
    JSFunction::create(
        global,
        "getDefaultAutoSelectFamilyAttemptTimeout",
        __jsc_host_getter,
        0,
        Default::default(),
    )
}

pub(crate) fn set_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
    #[bun_jsc::host_fn(export = "Bun__NodeNet__setDefaultAutoSelectFamilyAttemptTimeout")]
    fn setter(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = frame.arguments_old::<1>();
        if arguments.len < 1 {
            return Err(global.throw(format_args!("missing argument")));
        }
        let arg = arguments.slice()[0];
        let mut value =
            validators::validate_int32(global, arg, format_args!("value"), Some(1), None)?;
        if value < 10 {
            value = 10;
        }
        AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT
            .with(|v| v.set(u32::try_from(value).expect("int cast")));
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

// codegen (`generated_js2native.rs`) snake-cases the symbol; alias the
// PascalCase fns so both spellings resolve.
pub use self::{BlockList as block_list, SocketAddress as socket_address};

// Forward to the codegen'd `js_${Type}::get_constructor` wrappers — they go through
// `jsc_abi_extern!` so the extern uses `extern "sysv64"` on win-x64 (matching
// C++ `JSC_CALLCONV`). A bare `extern "C"` redecl here would be the wrong ABI on
// Windows and trips `clashing_extern_declarations`.
#[allow(non_snake_case)]
pub fn SocketAddress(global: &JSGlobalObject) -> JSValue {
    crate::generated_classes::js_SocketAddress::get_constructor(global)
}

#[allow(non_snake_case)]
pub fn BlockList(global: &JSGlobalObject) -> JSValue {
    crate::generated_classes::js_BlockList::get_constructor(global)
}

#[bun_jsc::host_fn]
pub(crate) fn new_detached_socket(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<1>();
    let is_ssl = args[0].to_boolean();

    // Only `socket`, `ref_count`, `protos`, `handlers` are
    // specified; the rest take their struct defaults.
    fn make<const SSL: bool>(global: &JSGlobalObject) -> JSValue {
        let socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED),
            ref_count: bun_ptr::RefCount::init(),
            protos: JsCell::new(None),
            handlers: JsCell::new(None),
            local_binding: JsCell::new(None),
            // — defaults —
            owned_ssl_ctx: Cell::new(None),
            // node:net/node:tls own server-identity (`checkServerIdentity`)
            // policy in JS, so a hostname mismatch is never enforced natively.
            flags: Cell::new(SocketFlags::default() | SocketFlags::DEFERS_SERVER_IDENTITY),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        });
        socket.get_this_value(global)
    }

    Ok(if !is_ssl {
        make::<false>(global)
    } else {
        make::<true>(global)
    })
}

#[bun_jsc::host_fn]
pub(crate) fn do_connect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [prev, opts] = frame.arguments_as_array::<2>();
    let maybe_tcp = prev.as_::<TCPSocket>();
    let maybe_tls = prev.as_::<TLSSocket>();
    Listener::connect_inner(global, maybe_tcp, maybe_tls, opts)
}
