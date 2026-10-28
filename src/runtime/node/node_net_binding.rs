//
//

use core::cell::Cell;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_io::KeepAlive;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsCell, JsResult};
use bun_uws as uws;

use crate::generated_bindgen::socket_body::SocketHandle;
use crate::socket::{Listener, NativeCallbacks, NewSocket, SocketFlags};

static AUTO_SELECT_FAMILY_DEFAULT: AtomicBool = AtomicBool::new(true);

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

pub(crate) fn get_default_auto_select_family() -> bool {
    AUTO_SELECT_FAMILY_DEFAULT.load(Ordering::Relaxed)
}

pub(crate) fn set_default_auto_select_family(value: bool) -> bool {
    AUTO_SELECT_FAMILY_DEFAULT.store(value, Ordering::Relaxed);
    value
}

pub(crate) fn get_default_auto_select_family_attempt_timeout() -> u32 {
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT.get()
}

pub(crate) fn set_default_auto_select_family_attempt_timeout(value: u32) -> u32 {
    let value = value.max(10);
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_DEFAULT.set(value);
    value
}

pub(crate) fn new_detached_socket(cx: &mut JsScope<'_>, is_ssl: bool) -> JSValue {
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
            latest_session: core::cell::Cell::new(None),
        });
        // Weak while idle: `_handle` owns it, and `this_value_for_connect` pins each attempt.
        let value = socket.to_js(global);
        socket.this_value.set(jsc::JsRef::init_weak(value));
        value
    }

    if !is_ssl {
        make::<false>(cx.global())
    } else {
        make::<true>(cx.global())
    }
}

pub(crate) fn do_connect<'a>(
    cx: &mut JsScope<'a>,
    socket: SocketHandle<'a>,
    options: JsLocal<'a>,
) -> JsResult<JSValue> {
    let (maybe_tcp, maybe_tls) = match socket {
        SocketHandle::Tcp(socket) => (Some(socket.as_ctx_ptr()), None),
        SocketHandle::Tls(socket) => (None, Some(socket.as_ctx_ptr())),
        SocketHandle::Ignored(_) => (None, None),
    };
    Listener::connect_inner(&cx.js_thread(), maybe_tcp, maybe_tls, options.to_js())
}
