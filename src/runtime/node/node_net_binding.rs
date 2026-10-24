use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};

use crate::generated_bindgen::socket_body::SocketHandle;
use crate::socket::{Listener, NewSocket, SocketFlags};

pub(crate) fn new_detached_socket(cx: &mut JsScope<'_>, is_ssl: bool) -> JSValue {
    fn make<const SSL: bool>(global: &JSGlobalObject) -> JSValue {
        let socket = NewSocket::<SSL>::new(None);
        // node:net and node:tls check the server's identity in JS (`checkServerIdentity`).
        socket.flags.set(SocketFlags::DEFERS_SERVER_IDENTITY);
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
