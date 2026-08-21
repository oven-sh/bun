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

/// Split `host[:port]` (as found in a Host header / URL authority).
pub fn split_host_port(host: &[u8]) -> (&[u8], Option<u16>) {
    if host.first() == Some(&b'[') {
        // [v6]:port
        if let Some(end) = bun_core::strings::index_of_char_usize(host, b']') {
            let h = &host[..=end];
            let rest = &host[end + 1..];
            if rest.first() == Some(&b':') {
                return (h, parse_port(&rest[1..]));
            }
            return (h, None);
        }
        return (host, None);
    }
    // A port is at most 5 digits, so only the last 6 bytes can hold the ':'.
    let mut i = host.len();
    let stop = host.len().saturating_sub(6);
    while i > stop {
        i -= 1;
        if host[i] == b':' {
            return (&host[..i], parse_port(&host[i + 1..]));
        }
    }
    (host, None)
}

fn parse_port(s: &[u8]) -> Option<u16> {
    if s.is_empty() || s.len() > 5 {
        return None;
    }
    let mut n: u32 = 0;
    for &c in s {
        if !c.is_ascii_digit() {
            return None;
        }
        n = n * 10 + (c - b'0') as u32;
    }
    u16::try_from(n).ok()
}
