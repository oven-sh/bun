//! The `webtransport` handler block on `Bun.serve`, and how a session gets
//! from an extended CONNECT to those handlers.
//!
//! A session does not go through `fetch`. WebTransport's CONNECT is not a
//! request an application would ever want to answer with a `Response` — there
//! is no body and no status to choose beyond accept or refuse — so routing it
//! through the request path would mean building a `Request`, a
//! `RequestContext` and a promise per session in order to throw all three
//! away. The handlers below are registered straight onto the HTTP/3 app as a
//! CONNECT route instead, and ordinary HTTP/3 on the same server is untouched.

use crate::server::jsc::{JSGlobalObject, JSValue, JsResult};

/// The three callbacks, held as raw `JSValue` shadows. The GC roots are the
/// server wrapper's `wtOn*` WriteBarrier slots, written by
/// `NewServer::write_wt_handler_slots`; these are the hot-path reads, exactly
/// as the websocket handler does it.
pub struct WebTransportHandler {
    pub(crate) on_open: JSValue,
    pub(crate) on_datagram: JSValue,
    pub(crate) on_close: JSValue,
}

impl WebTransportHandler {
    pub fn from_js(global: &JSGlobalObject, object: JSValue) -> JsResult<WebTransportHandler> {
        let mut handler = WebTransportHandler {
            on_open: JSValue::ZERO,
            on_datagram: JSValue::ZERO,
            on_close: JSValue::ZERO,
        };

        let pairs: [(&'static str, &mut JSValue); 3] = [
            ("open", &mut handler.on_open),
            ("datagram", &mut handler.on_datagram),
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
            return Err(global.throw_invalid_arguments(format_args!(
                "webtransport expects at least an 'open' or 'datagram' handler"
            )));
        }

        Ok(handler)
    }
}
