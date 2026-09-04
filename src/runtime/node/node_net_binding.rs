//
//

use core::cell::Cell;

use bun_io::KeepAlive;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_uws as uws;

use crate::socket::{Listener, NativeCallbacks, NewSocket, SocketFlags, TCPSocket, TLSSocket};

// codegen (`generated_js2native.rs`) snake-cases the symbol; alias the
// PascalCase fns so both spellings resolve.
pub(crate) use self::{BlockList as block_list, SocketAddress as socket_address};

// Forward to the codegen'd `js_${Type}::get_constructor` wrappers — they go through
// `jsc_abi_extern!` so the extern uses `extern "sysv64"` on win-x64 (matching
// C++ `JSC_CALLCONV`). A bare `extern "C"` redecl here would be the wrong ABI on
// Windows and trips `clashing_extern_declarations`.
#[allow(non_snake_case)]
pub(crate) fn SocketAddress(global: &JSGlobalObject) -> JSValue {
    crate::generated_classes::js_SocketAddress::get_constructor(global)
}

#[allow(non_snake_case)]
pub(crate) fn BlockList(global: &JSGlobalObject) -> JSValue {
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
            owned_ssl_ctx: JsCell::new(None),
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
