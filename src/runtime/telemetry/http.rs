//! HTTP semantic-convention helpers shared by Bun.serve, node:http and fetch.
//! https://opentelemetry.io/docs/specs/semconv/http/http-spans/

use bun_http::Method;
use bun_telemetry::{SpanWriter, StatusCode};

/// `http.request.method` value: the canonical token for known methods,
/// `_OTHER` otherwise (semconv requires a bounded set).
#[inline]
pub fn method_name(m: Method) -> &'static str {
    match m {
        Method::GET => "GET",
        Method::HEAD => "HEAD",
        Method::POST => "POST",
        Method::PUT => "PUT",
        Method::DELETE => "DELETE",
        Method::CONNECT => "CONNECT",
        Method::OPTIONS => "OPTIONS",
        Method::TRACE => "TRACE",
        Method::PATCH => "PATCH",
        Method::QUERY => "QUERY",
        _ => "_OTHER",
    }
}

/// Write `http.response.status_code` and, per semconv, mark the span as an
/// error for 5xx (server) / 4xx+5xx (client).
#[inline]
pub fn status_attrs(w: &mut SpanWriter<'_>, status: u16, is_server: bool) {
    if status == 0 {
        return;
    }
    w.attr("http.response.status_code", status);
    let is_error = if is_server {
        status >= 500
    } else {
        status >= 400
    };
    if is_error {
        let mut buf = [0u8; 3];
        buf[0] = b'0' + ((status / 100) % 10) as u8;
        buf[1] = b'0' + ((status / 10) % 10) as u8;
        buf[2] = b'0' + (status % 10) as u8;
        w.attr("error.type", &buf[..]);
        w.status(StatusCode::Error, b"");
    }
}
