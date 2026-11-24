//! Frames and parameters as text. A comma ends a frame. Bytes are `-` for none, `#` and hexadecimal digits, `*` and a
//! length of [`filler`], or themselves with `%` and two digits for what cannot be written. Other long ones are shown as
//! `~` and their length.

use bun_core::strings::split_once_char;
use bun_qpack::{Decoder, Encoder, Indexing};

pub(crate) const MAX: u64 = (1 << 62) - 1;

/// `i` is an integer, `b` bytes behind their length, and a hexadecimal digit stands for one more byte than it says.
pub(crate) const FRAMES: [(u64, &str, &str); 24] = [
    (0x01, "ping", ""),
    (0x04, "reset_stream", "iii"),
    (0x05, "stop_sending", "ii"),
    (0x06, "crypto", "ib"),
    (0x07, "new_token", "b"),
    (0x0e, "stream", "iib"),
    (0x0f, "fin", "iib"),
    (0x10, "max_data", "i"),
    (0x11, "max_stream_data", "ii"),
    (0x12, "max_streams_bidi", "i"),
    (0x13, "max_streams_uni", "i"),
    (0x14, "data_blocked", "i"),
    (0x15, "stream_data_blocked", "ii"),
    (0x16, "streams_blocked_bidi", "i"),
    (0x17, "streams_blocked_uni", "i"),
    (0x18, "new_connection_id", "iibf"),
    (0x19, "retire_connection_id", "i"),
    (0x1a, "path_challenge", "7"),
    (0x1b, "path_response", "7"),
    (0x1c, "close", "iib"),
    (0x1d, "application_close", "ib"),
    (0x1e, "handshake_done", ""),
    (0x31, "datagram", "b"),
    (0xaf, "ack_frequency", "iiii"),
];

/// And whether the value is an integer.
const PARAMETERS: [(u64, &str, bool); 20] = [
    (0x00, "original_destination_connection_id", false),
    (0x01, "max_idle_timeout", true),
    (0x02, "stateless_reset_token", false),
    (0x03, "max_udp_payload_size", true),
    (0x04, "max_data", true),
    (0x05, "max_stream_data_bidi_local", true),
    (0x06, "max_stream_data_bidi_remote", true),
    (0x07, "max_stream_data_uni", true),
    (0x08, "max_streams_bidi", true),
    (0x09, "max_streams_uni", true),
    (0x0a, "ack_delay_exponent", true),
    (0x0b, "max_ack_delay", true),
    (0x0c, "disable_active_migration", false),
    (0x0d, "preferred_address", false),
    (0x0e, "active_connection_id_limit", true),
    (0x0f, "initial_source_connection_id", false),
    (0x10, "retry_source_connection_id", false),
    (0x11, "version_information", false),
    (0x20, "max_datagram_frame_size", true),
    (0xff02_de1a, "min_ack_delay", true),
];

const HTTP3_FRAMES: [(u64, &str); 10] = [
    (0x00, "data"),
    (0x01, "headers"),
    (0x03, "cancel_push"),
    (0x04, "settings"),
    (0x05, "push_promise"),
    (0x07, "goaway"),
    (0x0c, "origin"),
    (0x0d, "max_push_id"),
    (0xf0700, "priority_update"),
    (0xf0701, "priority_update_push"),
];

pub(crate) fn varint(value: u64) -> Vec<u8> {
    let class = [1 << 6, 1 << 14, 1 << 30].partition_point(|&it| it <= value);
    let word = value | (class as u64) << ((8 << class) - 2);
    word.to_be_bytes()[8 - (1 << class)..].to_vec()
}

pub(crate) fn prefixed(bytes: &[u8]) -> Vec<u8> {
    [&varint(bytes.len() as u64), bytes].concat()
}

pub(crate) fn take<'a>(input: &mut &'a [u8], len: usize) -> &'a [u8] {
    input.split_off(..len).unwrap()
}

pub(crate) fn try_varint(input: &mut &[u8]) -> Option<u64> {
    let bytes = input.split_off(..1 << (input.first()? >> 6))?;
    let word = (bytes.iter()).fold(0, |word, &byte| word << 8 | u64::from(byte));
    Some(word & (u64::MAX >> (66 - 8 * bytes.len())))
}

pub(crate) fn take_varint(input: &mut &[u8]) -> u64 {
    try_varint(input).unwrap()
}

pub(crate) fn take_prefixed<'a>(input: &mut &'a [u8]) -> &'a [u8] {
    let len = take_varint(input);
    take(input, len as usize)
}

/// What `*` stands for at this place of a stream.
pub(crate) fn filler(offset: u64, len: usize) -> Vec<u8> {
    let at = offset..offset + len as u64;
    at.map(|at| b'a' + ((at + at / 26 / 26) % 26) as u8)
        .collect()
}

pub(crate) fn hex(digits: &str) -> Vec<u8> {
    let digits: Vec<_> = digits.chars().filter_map(|it| it.to_digit(16)).collect();
    (digits.chunks(2).map(|it| (it[0] << 4 | it[1]) as u8)).collect()
}

fn integer(token: &str) -> u64 {
    match token.strip_prefix("0x") {
        Some(digits) => u64::from_str_radix(digits, 16).unwrap(),
        None => token.parse().unwrap(),
    }
}

fn bytes_at(offset: u64, token: &str) -> Vec<u8> {
    match token.split_at(token.len().min(1)) {
        ("", _) | ("-", "") => Vec::new(),
        ("#", digits) => hex(digits),
        ("*", len) if !len.is_empty() => filler(offset, len.parse().unwrap()),
        _ => {
            let (mut rest, mut out) = (token, Vec::new());
            while let Some(&first) = rest.as_bytes().first() {
                let is_escape = first == b'%';
                out.push(if is_escape {
                    hex(&rest[1..3])[0]
                } else {
                    first
                });
                rest = &rest[if is_escape { 3 } else { 1 }..];
            }
            out
        }
    }
}

pub(crate) fn bytes(token: &str) -> Vec<u8> {
    bytes_at(0, token)
}

pub(crate) fn show(bytes: &[u8]) -> String {
    let is_plain = |it: &u8| it.is_ascii_graphic() && *it != b'%';
    let follows = |[a, b]: &[u8; 2]| matches!(b.wrapping_sub(*a), 1 | 2 | 231 | 232);
    let is_filler = bytes.array_windows().all(follows);
    match bytes {
        [] => "-".into(),
        _ if bytes.len() > 32 && is_filler => format!("*{}", bytes.len()),
        _ if bytes.len() > 32 => format!("~{}", bytes.len()),
        [b'#', ..] | [b'*', _, ..] | [b'-'] | [.., b','] => show_hex(bytes),
        _ if bytes.iter().all(is_plain) => bytes.escape_ascii().to_string(),
        _ => show_hex(bytes),
    }
}

/// However long.
pub(crate) fn show_hex(bytes: &[u8]) -> String {
    let digits = bytes.iter().flat_map(|it| [it >> 4, it & 15]);
    let digits = digits.filter_map(|it| char::from_digit(it.into(), 16));
    ['#'].into_iter().chain(digits).collect()
}

pub(crate) fn groups(text: &str) -> Vec<Vec<&str>> {
    let mut groups = vec![Vec::new()];
    for token in text.split_ascii_whitespace() {
        let last = token.strip_suffix(',');
        groups.last_mut().unwrap().push(last.unwrap_or(token));
        groups.extend(last.map(|_| Vec::new()));
    }
    groups.retain(|it| !it.is_empty());
    groups
}

fn pair(token: &str, separator: u8) -> Option<(&str, &str)> {
    let (left, _) = split_once_char(&token.as_bytes()[1..], separator)?;
    Some((&token[..1 + left.len()], &token[2 + left.len()..]))
}

/// `ack 7-9 3 +10` has two ranges and a delay.
fn ack(tokens: &[&str]) -> Vec<u8> {
    let delay = tokens.last().unwrap().strip_prefix('+');
    let ranges = &tokens[..tokens.len() - usize::from(delay.is_some())];
    let (mut out, mut above) = (vec![0x02], None);
    for range in ranges {
        let (low, high) = pair(range, b'-').unwrap_or((range, range));
        let (low, high) = (integer(low), integer(high));
        match above.replace(low) {
            Some(above) => out.extend(varint(above - high - 2)),
            None => out.extend(
                [high, delay.map_or(0, integer), ranges.len() as u64 - 1]
                    .map(varint)
                    .concat(),
            ),
        }
        out.extend(varint(high - low));
    }
    out
}

pub(crate) fn frame(tokens: &[&str]) -> Vec<u8> {
    let (name, fields) = (tokens[0], &tokens[1..]);
    let Some((kind, _, layout)) = FRAMES.iter().find(|it| it.1 == name) else {
        return match (name, fields) {
            ("ack", _) => ack(fields),
            ("padding", [len]) => vec![0; integer(len) as usize],
            (_, []) => hex(name.strip_prefix('#').expect(name)),
            _ => panic!("{tokens:?}"),
        };
    };
    assert_eq!(layout.len(), fields.len(), "{tokens:?}");
    let (mut out, mut offset) = (varint(*kind), 0);
    for (field, token) in layout.chars().zip(fields) {
        out.extend(match field {
            'i' => {
                offset = integer(token);
                varint(offset)
            }
            'b' => prefixed(&bytes_at(offset, token)),
            _ => bytes(token),
        });
    }
    out
}

pub(crate) fn frames(text: &str) -> Vec<u8> {
    groups(text).iter().flat_map(|it| frame(it)).collect()
}

/// Of the frames that have them.
pub(crate) struct Decoded<'a> {
    pub(crate) name: &'static str,
    pub(crate) integers: Vec<u64>,
    pub(crate) bytes: Vec<&'a [u8]>,
    pub(crate) text: String,
}

/// An ACK frame has the lowest and the highest number of each range as its integers.
fn decode_ack<'a>(input: &mut &[u8]) -> Decoded<'a> {
    let [mut high, delay, count] = [(); 3].map(|()| take_varint(input));
    let (mut integers, mut text) = (Vec::new(), String::from("ack"));
    for at in 0..=count {
        if at > 0 {
            high = integers[integers.len() - 2] - take_varint(input) - 2;
        }
        let low = high - take_varint(input);
        integers.extend([low, high]);
        text += &match low == high {
            true => format!(" {low}"),
            false => format!(" {low}-{high}"),
        };
    }
    if delay > 0 {
        text += &format!(" +{delay}");
    }
    Decoded {
        name: "ack",
        integers,
        bytes: Vec::new(),
        text,
    }
}

/// Without PADDING frames.
pub(crate) fn decode(mut payload: &[u8]) -> Vec<Decoded<'_>> {
    let (input, mut out) = (&mut payload, Vec::new());
    while !input.is_empty() {
        let len = input.len();
        let kind = take_varint(input);
        // RFC 9000 §12.4.
        assert_eq!(len - input.len(), varint(kind).len());
        let (kind, layout) = match kind {
            0x00 => continue,
            0x02 => {
                out.push(decode_ack(input));
                continue;
            }
            kind @ 0x08..=0x0f => {
                let layout = ["i-r", "i-b", "iir", "iib"][kind as usize >> 1 & 3];
                (kind | 0x06, Some(layout))
            }
            kind => (kind, None),
        };
        let &(_, name, usual) = FRAMES.iter().find(|it| it.0 == kind).unwrap();
        let (mut integers, mut bytes, mut text) = (Vec::new(), Vec::new(), String::from(name));
        for field in layout.unwrap_or(usual).chars() {
            if let 'i' | '-' = field {
                let value = if field == 'i' { take_varint(input) } else { 0 };
                let is_code = match kind {
                    0x04 | 0x05 => integers.len() == 1,
                    0x1c | 0x1d => integers.is_empty(),
                    _ => false,
                };
                text += &match is_code {
                    true => format!(" {value:#x}"),
                    false => format!(" {value}"),
                };
                integers.push(value);
                continue;
            }
            let value = match field {
                'b' => take_prefixed(input),
                'r' => std::mem::take(input),
                _ => take(input, 1 + field.to_digit(16).unwrap() as usize),
            };
            text += &format!(" {}", show(value));
            bytes.push(value);
        }
        out.push(Decoded {
            name,
            integers,
            bytes,
            text,
        });
    }
    out
}

/// `name=value`. There is no value if nothing follows the sign.
pub(crate) fn parameter(token: &str) -> (u64, Option<Vec<u8>>) {
    let (name, value) = pair(token, b'=').unwrap();
    let known = PARAMETERS.iter().find(|it| it.1 == name);
    let value = match value.as_bytes().first() {
        None => None,
        Some(b'0'..=b'9') => Some(varint(integer(value))),
        Some(_) => Some(bytes(value)),
    };
    (known.map_or_else(|| integer(name), |it| it.0), value)
}

pub(crate) fn decode_parameters(mut input: &[u8]) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    while !input.is_empty() {
        let (id, mut value) = (take_varint(&mut input), take_prefixed(&mut input));
        let &(_, name, is_integer) = PARAMETERS.iter().find(|it| it.0 == id).unwrap();
        out.push(match is_integer {
            true => (name, take_varint(&mut value).to_string()),
            false => (name, show_hex(value)),
        });
    }
    out
}

/// `name=value`, with `!` in front of what is never indexed.
pub(crate) fn fields(tokens: &[&str]) -> Vec<(Vec<u8>, Vec<u8>, Indexing)> {
    let field = |token: &&str| {
        let (name, value) = pair(token, b'=').unwrap();
        match name.strip_prefix('!') {
            Some(name) => (bytes(name), bytes(value), Indexing::Never),
            None => (bytes(name), bytes(value), Indexing::Allowed),
        }
    };
    tokens.iter().map(field).collect()
}

pub(crate) fn show_fields<'a>(fields: impl Iterator<Item = (&'a [u8], &'a [u8])>) -> String {
    let fields = fields.map(|(name, value)| format!(" {}={}", show(name), show(value)));
    fields.collect::<Vec<_>>().concat()
}

fn section(tokens: &[&str]) -> Vec<u8> {
    let (mut encoder, mut out) = (Encoder::new(), Vec::new());
    let mut section = encoder.section(0, &mut out, 0);
    for (name, value, indexing) in fields(tokens) {
        section.field(&name, None, &value, indexing);
    }
    let start = section.finish();
    out.split_off(start)
}

/// The frames of HTTP/3. A number stands for a type that has no name, and `#` for a payload or a frame as it is.
pub(crate) fn http3(text: &str) -> Vec<u8> {
    let frame = |tokens: Vec<&str>| {
        let (name, rest) = (tokens[0], &tokens[1..]);
        if let Some(digits) = name.strip_prefix('#') {
            return hex(digits);
        }
        let known = HTTP3_FRAMES.iter().find(|it| it.1 == name);
        let part = |token: &&str| match (name, token.as_bytes()[0]) {
            ("settings", b'0'..=b'9') => {
                let (id, value) = pair(token, b'=').unwrap();
                [id, value].map(|it| varint(integer(it))).concat()
            }
            ("data", _) => bytes(token),
            (_, b'0'..=b'9') => varint(integer(token)),
            _ => bytes(token),
        };
        let payload = match (name, rest) {
            ("headers", [raw]) if raw.starts_with('#') => bytes(raw),
            ("headers", _) => section(rest),
            _ => rest.iter().flat_map(part).collect(),
        };
        let kind = known.map_or_else(|| integer(name), |it| it.0);
        [varint(kind), prefixed(&payload)].concat()
    };
    groups(text).into_iter().flat_map(frame).collect()
}

/// Takes the frames that are complete.
pub(crate) fn show_http3(input: &mut &[u8], stream: u64, decoder: &mut Decoder) -> String {
    let mut out = Vec::new();
    while let mut rest = *input
        && let Some((kind, len)) = try_varint(&mut rest).zip(try_varint(&mut rest))
        && let Some(mut payload) = rest.split_off(..len as usize)
    {
        *input = rest;
        let mut text = String::from(HTTP3_FRAMES.iter().find(|it| it.0 == kind).unwrap().1);
        match kind {
            0x01 => {
                let mut buffer = Vec::new();
                let lines = decoder.decode(stream, payload, &mut buffer);
                let mut lines = lines.unwrap().unwrap();
                while let Some(it) = lines.next().unwrap() {
                    text += &show_fields([(it.name(), it.value())].into_iter());
                }
            }
            0x04 => {
                while let Some(id) = try_varint(&mut payload) {
                    text += &format!(" {id:#x}={}", take_varint(&mut payload));
                }
            }
            0x07 => text += &format!(" {}", take_varint(&mut payload)),
            0xf0700 => text += &format!(" {} {}", take_varint(&mut payload), show(payload)),
            _ => text += &format!(" {}", show(payload)),
        }
        out.push(text);
    }
    out.join(", ")
}
