use bun_jsc::bindgen::JsScope;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::socket::{Listener, NewSocket, SocketFlags, TCPSocket, TLSSocket};

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

#[bun_jsc::host_fn]
pub(crate) fn do_connect(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let [prev, opts] = frame.arguments_as_array::<2>();
    let maybe_tcp = prev.as_::<TCPSocket>();
    let maybe_tls = prev.as_::<TLSSocket>();
    Listener::connect_inner(
        &global.js_thread_of_caller(frame),
        maybe_tcp,
        maybe_tls,
        opts,
    )
}
