//! The `webtransport` handler block on `Bun.serve`.
//!
//! A session does not go through `fetch`: routing it there would build a
//! `RequestContext` and a promise per session to throw both away. The handlers
//! are registered straight onto the HTTP/3 app as a CONNECT route, and ordinary
//! HTTP/3 on the same server is untouched.

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};

/// Raw `JSValue` shadows for the hot-path reads; the GC roots are the server
/// wrapper's `wtOn*` WriteBarrier slots, as the websocket handler does it.
pub struct WebTransportHandler {
    pub(crate) on_upgrade: JSValue,
    pub(crate) on_open: JSValue,
    pub(crate) on_datagram: JSValue,
    pub(crate) on_drain: JSValue,
    pub(crate) on_close: JSValue,
}

impl WebTransportHandler {
    pub fn from_js(global: &JSGlobalObject, object: JSValue) -> JsResult<WebTransportHandler> {
        let mut handler = WebTransportHandler {
            on_upgrade: JSValue::ZERO,
            on_open: JSValue::ZERO,
            on_datagram: JSValue::ZERO,
            on_drain: JSValue::ZERO,
            on_close: JSValue::ZERO,
        };

        let pairs: [(&'static str, &mut JSValue); 5] = [
            ("upgrade", &mut handler.on_upgrade),
            ("open", &mut handler.on_open),
            ("datagram", &mut handler.on_datagram),
            ("drain", &mut handler.on_drain),
            ("close", &mut handler.on_close),
        ];
        for (key, field) in pairs {
            if let Some(value) = object.get_truthy(global, key)? {
                if !value.is_cell() || !value.is_callable() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "webtransport expects a function for the '{}' option",
                        key
                    )));
                }
                *field = value;
            }
        }

        if handler.on_datagram.is_empty_or_undefined_or_null()
            && handler.on_open.is_empty_or_undefined_or_null()
        {
            // `upgrade` alone accepts sessions and then does nothing with
            // them.
            return Err(global.throw_invalid_arguments(format_args!(
                "webtransport expects at least an 'open' or 'datagram' handler"
            )));
        }

        Ok(handler)
    }
}
