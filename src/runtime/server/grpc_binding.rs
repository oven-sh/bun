//! What `bun:grpc` needs of HTTP/2 that `Request` and `Response` do not have.

use std::io::Write as _;

use bun_http_types::ETag::HeaderEntryColumns as _;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{FetchHeaders, JSValue, JsResult};

use crate::webcore::response::HeadersRef;
use crate::webcore::{Request, Response};

/// False if `request` did not come over HTTP/2.
pub(crate) fn accept_call(request: &Request) -> bool {
    let context = request.request_context.get();
    let is_http2 = context.live_http2_response().is_some();
    if is_http2 {
        context.lift_request_stream_limit();
    }
    is_http2
}

/// Makes the trailers of the response to `request`.
pub(crate) fn write_status<'a>(
    cx: &mut JsScope<'a>,
    request: &Request,
    code: u32,
    message: &[u8],
    trailers: JsLocal<'a>,
) -> JsResult<()> {
    let trailers = FetchHeaders::cast(trailers.to_js());
    let trailers = trailers.map(|it| bun_opaque::opaque_deref(it.as_ptr()));
    let trailers = bun_http_jsc::headers_jsc::from_fetch_headers(cx.global(), trailers, None)?;
    let Some(response) = request.request_context.get().live_http2_response() else {
        return Ok(());
    };
    let response = bun_opaque::opaque_deref_mut(response);
    response.write_trailer(b"grpc-status", code.to_string().as_bytes());
    if !message.is_empty() {
        response.write_trailer(b"grpc-message", &percent_encode(message));
    }
    let (names, values) = (
        trailers.entries.items_name(),
        trailers.entries.items_value(),
    );
    for (&name, &value) in names.iter().zip(values) {
        response.write_trailer(trailers.as_str(name), trailers.as_str(value));
    }
    Ok(())
}

/// Clients commonly refuse more than 8 KiB of trailers, some by closing the connection.
const LONGEST_MESSAGE: usize = 4096;

/// `Percent-Encoded` in gRPC's PROTOCOL-HTTP2.md. A field value cannot start or end with a space.
fn percent_encode(message: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(message.len().min(LONGEST_MESSAGE));
    for (index, &byte) in message.iter().enumerate() {
        let starts_character = byte & 0xC0 != 0x80;
        if encoded.len() >= LONGEST_MESSAGE && starts_character {
            encoded.extend_from_slice(b"...");
            break;
        }
        let is_inside = index != 0 && index + 1 != message.len();
        match byte {
            b'!'..=b'$' | b'&'..=b'~' => encoded.push(byte),
            b' ' if is_inside => encoded.push(byte),
            _ => {
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}

pub(crate) fn take_trailers(cx: &mut JsScope<'_>, response: &Response) -> JSValue {
    match response.trailers.take() {
        Some(trailers) => HeadersRef::create_from_headers(&trailers).to_js(cx.global()),
        None => JSValue::UNDEFINED,
    }
}
