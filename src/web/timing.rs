//! https://w3c.github.io/resource-timing/

use bun_core::strings;

use crate::Bytes;
use crate::headers::{collect_quoted, digits, is_token_byte, split};
use crate::mime;
use crate::net::response::{Cached, Head, Protocol, ResponseType, Timing};
use crate::request::InitiatorType;
use crate::time::monotonic_now;

#[derive(Clone)]
pub struct ServerTiming {
    pub name: Bytes,
    pub duration: f64,
    pub description: Bytes,
}

fn token_at_start(text: &[u8]) -> &[u8] {
    &text[..text.iter().take_while(|it| is_token_byte(**it)).count()]
}

fn parse_server_timing(header: &[u8]) -> Vec<ServerTiming> {
    let mut metrics = Vec::new();
    for metric in split(header, b',') {
        let name = split(metric, b';').next().unwrap_or_default();
        let token = token_at_start(name);
        if token.is_empty() {
            break;
        }
        let value = |wanted: &[u8]| -> Option<Vec<u8>> {
            let found = split(metric, b';')
                .skip(1)
                .find(|it| token == name && token_at_start(it).eq_ignore_ascii_case(wanted))?;
            let text = found[wanted.len()..]
                .trim_ascii_start()
                .strip_prefix(b"=")?
                .trim_ascii_start();
            if !text.starts_with(b"\"") {
                return Some(token_at_start(text).to_vec());
            }
            let followed = [text, b";"].concat();
            let (value, rest) = collect_quoted(&followed);
            (!rest.is_empty()).then_some(value)
        };
        let duration = value(b"dur")
            .and_then(|it| core::str::from_utf8(&it).ok()?.parse().ok())
            .filter(|it: &f64| it.is_finite());
        metrics.push(ServerTiming {
            name: token.into(),
            duration: duration.unwrap_or(0.0),
            description: value(b"desc").unwrap_or_default().into(),
        });
        if token != name {
            break;
        }
    }
    metrics
}

fn name_of_encoding(value: &[u8]) -> &'static [u8] {
    let known: [&[u8]; 7] = [b"", b"br", b"dcb", b"dcz", b"deflate", b"gzip", b"zstd"];
    let unknown: &[u8] = if strings::contains_char(value, b',') {
        b"multiple"
    } else {
        b"@unknown"
    };
    known
        .into_iter()
        .find(|it| it.eq_ignore_ascii_case(value.trim_ascii()))
        .unwrap_or(unknown)
}

keywords! {
    #[derive(Default)]
    pub enum NavigationType {
        #[default]
        Navigate = b"navigate",
        Reload = b"reload",
        BackForward = b"back_forward",
    }
}

/// What the page may know. The times are in milliseconds since the epoch, and 0 is none.
#[derive(Clone)]
pub struct ResourceTiming {
    pub name: Bytes,
    pub initiator_type: InitiatorType,
    pub blocks_rendering: bool,
    pub allows_timing: bool,
    pub timing: Timing,
    pub response_end: f64,
    pub redirects: u8,
    pub is_secure: bool,
    pub is_from_cache: bool,
    pub protocol: Protocol,
    pub content_type: Bytes,
    pub content_encoding: &'static [u8],
    pub status: u16,
    pub encoded_size: u64,
    pub decoded_size: u64,
    pub transfer_size: u64,
    pub server_timing: Vec<ServerTiming>,
}

impl ResourceTiming {
    pub fn of_failure(name: &[u8], initiator_type: InitiatorType, start: f64) -> ResourceTiming {
        ResourceTiming {
            name: name.into(),
            initiator_type,
            blocks_rendering: false,
            allows_timing: false,
            timing: Timing {
                start,
                fetch_start: start,
                ..Timing::default()
            },
            response_end: monotonic_now(),
            redirects: 0,
            is_secure: false,
            is_from_cache: false,
            protocol: Protocol::None,
            content_type: Bytes::default(),
            content_encoding: b"",
            status: 0,
            encoded_size: 0,
            decoded_size: 0,
            transfer_size: 0,
            server_timing: Vec::new(),
        }
    }

    /// Of a document that was not fetched.
    pub fn of_nothing(name: &[u8], start: f64) -> ResourceTiming {
        ResourceTiming {
            response_end: start,
            ..ResourceTiming::of_failure(name, InitiatorType::Navigation, start)
        }
    }

    pub fn of_response(
        name: &[u8],
        initiator_type: InitiatorType,
        head: &Head,
        size: u64,
    ) -> ResourceTiming {
        let mut record = ResourceTiming::of_failure(name, initiator_type, head.timing.start);
        let encoding = head.headers.get_or_empty(b"content-encoding");
        let encoded = digits(&head.headers.get_or_empty(b"content-length"))
            .filter(|it| *it > 0 && !encoding.is_empty())
            .unwrap_or(size);
        if head.kind != ResponseType::Opaque {
            record.content_type = head
                .headers
                .mime()
                .map_or_else(Bytes::default, |it| mime::minimize(it.essence()).into());
            record.content_encoding = name_of_encoding(&encoding);
            (record.status, record.encoded_size, record.decoded_size) =
                (head.status, encoded, size);
        }
        let is_navigation = initiator_type == InitiatorType::Navigation;
        if head.allows_timing || is_navigation {
            record.allows_timing = !is_navigation || head.exposes_redirects;
            (record.timing, record.redirects, record.protocol) =
                (head.timing, head.redirects, head.protocol);
            (record.is_secure, record.is_from_cache) =
                (head.url.scheme() == b"https", head.cached != Cached::No);
            record.server_timing =
                parse_server_timing(&head.headers.get_or_empty(b"server-timing"));
            record.transfer_size = match head.cached {
                Cached::Local => 0,
                Cached::Validated => 300,
                Cached::No => encoded + 300,
            };
        }
        record
    }
}
