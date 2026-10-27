//! `http1Internals` of `bun:internal-for-testing`: how the HTTP client reads a
//! response head and a chunked body, so tables of cases need no server.

use std::fmt::Write as _;
use std::sync::atomic::Ordering;

use bun_picohttp::{
    ChunkedDecoder, ChunkedStatus, HEAD_BYTES_READ, HeadScanner, Header, ParseResponseError,
    Response,
};

/// `parseResponse(data, slots)`: `malformed`, `incomplete`, or
/// `1.<minor> <status> <reason> <length of the head>` and a `<name>:<value>`
/// per header. Each part is `<offset in data>+<length>`.
pub(crate) fn parse_response(data: &[u8], slots: usize) -> String {
    let mut headers = vec![Header::ZERO; slots];
    let response = match Response::parse(data, &mut headers) {
        Ok(response) => response,
        Err(ParseResponseError::MalformedHttpResponse) => return "malformed".into(),
        Err(ParseResponseError::ShortRead) => return "incomplete".into(),
    };
    let offset = |part: &[u8]| part.as_ptr().addr().wrapping_sub(data.as_ptr().addr());
    let mut log = format!(
        "1.{} {} {}+{} {}",
        response.minor_version,
        response.status_code,
        offset(response.status),
        response.status.len(),
        response.bytes_read,
    );
    for header in response.headers.list {
        let (name, value) = (header.name(), header.value());
        _ = write!(
            log,
            " {}+{}:{}+{}",
            offset(name),
            name.len(),
            offset(value),
            value.len(),
        );
    }
    log
}

/// `receiveResponse(data, slots, piece)`: see `http1Internals`.
pub(crate) fn receive_response(data: &[u8], slots: usize, piece: usize) -> String {
    let mut headers = vec![Header::ZERO; slots];
    let mut log = String::new();
    for way in ["parse", "fetch", "ws"] {
        let mut scanner = HeadScanner::default();
        let mut received = 0;
        let found = loop {
            received = data.len().min(received + piece.max(1));
            let buf = &data[..received];
            let found = match way {
                "parse" => Response::parse(buf, &mut headers).map(|head| head.bytes_read),
                "fetch" => Response::parse_received(buf, &mut headers, &mut scanner)
                    .map(|head| head.bytes_read),
                _ => scanner.scan(buf, slots),
            };
            if found != Err(ParseResponseError::ShortRead) || received == data.len() {
                break found;
            }
        };
        _ = match found {
            Err(ParseResponseError::ShortRead) => writeln!(log, "{received} incomplete"),
            Err(ParseResponseError::MalformedHttpResponse) => writeln!(log, "{received} malformed"),
            Ok(len) => writeln!(log, "{received} {len}"),
        };
    }
    log
}

/// `headBytesRead()`
pub(crate) fn head_bytes_read() -> usize {
    HEAD_BYTES_READ.load(Ordering::Relaxed)
}

/// `decodeChunked(data, cuts)`: `data` decoded in pieces that end at `cuts` and
/// at its end. All of them, also those after the body has ended or failed,
/// which both clients can decode. A line per piece:
/// `<status> <length of the data> <t if in the trailers> <the piece afterwards, in hex>`.
pub(crate) fn decode_chunked(data: &[u8], cuts: Vec<usize>) -> String {
    let mut decoder = ChunkedDecoder::default();
    let mut log = String::new();
    let mut start = 0;
    for end in cuts.into_iter().chain([data.len()]) {
        let end = end.clamp(start, data.len());
        let mut piece = data[start..end].to_vec();
        start = end;
        let decoded = decoder.decode(&mut piece);
        match decoded.status {
            ChunkedStatus::Incomplete => log.push_str("incomplete"),
            ChunkedStatus::Malformed => log.push_str("malformed"),
            ChunkedStatus::Complete { trailing } => _ = write!(log, "complete+{trailing}"),
        }
        let in_trailers = if decoder.is_in_trailers() { 't' } else { '-' };
        _ = write!(log, " {} {in_trailers} ", decoded.len);
        for byte in piece {
            _ = write!(log, "{byte:02x}");
        }
        log.push('\n');
    }
    log
}
