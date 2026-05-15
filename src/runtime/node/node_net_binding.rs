//
//

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_io::KeepAlive;
use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_uws as uws;

use crate::node::util::validators;
use crate::socket::{Listener, NativeCallbacks, NewSocket, SocketFlags, TCPSocket, TLSSocket};

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

pub fn get_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
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

pub fn set_default_auto_select_family(global: &JSGlobalObject) -> JSValue {
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

pub fn get_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
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

pub fn set_default_auto_select_family_attempt_timeout(global: &JSGlobalObject) -> JSValue {
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

// codegen (`generated_js2native.rs`) snake-cases the Zig symbol; alias the
// PascalCase fns so both spellings resolve.
pub use self::{BlockList as block_list, SocketAddress as socket_address};

// Zig: `pub const SocketAddress = bun.jsc.Codegen.JSSocketAddress.getConstructor;`
// Forward to the codegen'd `js_${Type}::get_constructor` wrappers — they go through
// `jsc_abi_extern!` so the extern uses `extern "sysv64"` on win-x64 (matching
// C++ `JSC_CALLCONV`). A bare `extern "C"` redecl here would be the wrong ABI on
// Windows and trips `clashing_extern_declarations`.
#[allow(non_snake_case)]
pub fn SocketAddress(global: &JSGlobalObject) -> JSValue {
    crate::generated_classes::js_SocketAddress::get_constructor(global)
}

// Zig: `pub const BlockList = jsc.Codegen.JSBlockList.getConstructor;`
#[allow(non_snake_case)]
pub fn BlockList(global: &JSGlobalObject) -> JSValue {
    crate::generated_classes::js_BlockList::get_constructor(global)
}

#[bun_jsc::host_fn]
pub fn new_detached_socket(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<1>();
    let is_ssl = args[0].to_boolean();

    // Zig field-default initializer: only `socket`, `ref_count`, `protos`, `handlers` are
    // specified; the rest take their struct defaults (see `NewSocket` field decls in socket.zig).
    fn make<const SSL: bool>(global: &JSGlobalObject) -> JSValue {
        let socket = NewSocket::<SSL>::new(NewSocket::<SSL> {
            socket: Cell::new(uws::NewSocketHandler::<SSL>::DETACHED),
            ref_count: bun_ptr::RefCount::init(),
            protos: JsCell::new(None),
            handlers: Cell::new(None),
            // — defaults —
            owned_ssl_ctx: Cell::new(None),
            flags: Cell::new(SocketFlags::default()),
            this_value: JsCell::new(jsc::JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            connection: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
        });
        // SAFETY: `NewSocket::new` returns a live heap pointer (`heap::alloc`).
        unsafe { (*socket).get_this_value(global) }
    }

    Ok(if !is_ssl {
        make::<false>(global)
    } else {
        make::<true>(global)
    })
}

#[bun_jsc::host_fn]
pub fn do_connect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [prev, opts] = frame.arguments_as_array::<2>();
    let maybe_tcp = prev.as_::<TCPSocket>();
    let maybe_tls = prev.as_::<TLSSocket>();
    Listener::connect_inner(global, maybe_tcp, maybe_tls, opts)
}

// ported from: src/runtime/node/node_net_binding.zig
