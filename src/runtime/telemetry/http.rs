//! HTTP semantic-convention helpers shared by Bun.serve, node:http and fetch.
//! https://opentelemetry.io/docs/specs/semconv/http/http-spans/

use bun_telemetry::SpanWriter;
pub use bun_telemetry::http_record::method_name;

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
        let mut buf = bun_core::fmt::ItoaBuf::new();
        w.error(bun_core::fmt::itoa(&mut buf, status), b"");
    }
}
