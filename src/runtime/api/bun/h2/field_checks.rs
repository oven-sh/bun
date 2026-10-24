//! The checks nghttp2 makes on the fields of one inbound header block (RFC 9113 §8.2 and §8.3).

use super::stream::RequestMethod;
use bun_http_types::h2::fields::{self, has_control_byte, has_edge_whitespace};
use bun_http_types::{is_token_char, parse_content_length_strict, parse_status_pseudo_header};

const METHOD: u8 = 1;
const SCHEME: u8 = 2;
const AUTHORITY: u8 = 4;
const PATH: u8 = 8;
const STATUS: u8 = 16;
const PROTOCOL: u8 = 32;
const UNKNOWN: u8 = 64;

/// nghttp2_check_method, nghttp2_check_path, check_scheme, check_authority and parse_status_code.
fn is_valid_pseudo_value(bit: u8, value: &[u8]) -> bool {
    let all = |extra: &[u8]| {
        value
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || extra.contains(c))
    };
    match bit {
        METHOD => value.iter().all(|&c| is_token_char(c)),
        PATH => value.iter().all(|&c| c > b' ' && c != 0x7f),
        SCHEME => value.first().is_some_and(u8::is_ascii_alphabetic) && all(b"+-."),
        AUTHORITY => all(b"!$%&'()*+,-.:;=[]_~"),
        STATUS => parse_status_pseudo_header(value).is_some(),
        _ => true,
    }
}

/// What the frame and the session say about a block before its first field.
#[derive(Clone, Copy)]
pub(crate) struct BlockKind {
    pub is_server: bool,
    /// The block arrived in a PUSH_PROMISE, so it's a request although a client receives it.
    pub is_push: bool,
    /// The block opens a stream: a request on a server, or a PUSH_PROMISE.
    pub is_request: bool,
    pub is_trailer: bool,
    /// Our SETTINGS_ENABLE_CONNECT_PROTOCOL. Like nghttp2, the submitted value counts, not the ACKed one.
    pub connect_protocol_enabled: bool,
    pub strict_whitespace: bool,
    /// SETTINGS_MAX_HEADER_LIST_SIZE counts name + value + 32 per field (§10.5.1).
    pub max_list_size: usize,
    pub max_fields: usize,
}

pub(crate) struct FieldChecks {
    kind: BlockKind,
    list_size: usize,
    field_count: usize,
    seen_regular: bool,
    seen_pseudo: u8,
    saw_options: bool,
    http_scheme: bool,
    origin_form: bool,
    asterisk_form: bool,
    /// The list is over a size limit. The rest of the block is only decoded to keep the HPACK table in sync.
    pub rejected: bool,
    pub malformed: bool,
    pub saw_connect: bool,
    pub saw_host: bool,
    pub informational: bool,
    /// `:status` is 204 or 304.
    pub no_body_status: bool,
    pub method: RequestMethod,
    pub content_length: Option<u64>,
}

impl FieldChecks {
    /// `saw_host` is true if an earlier block of the stream had a `host`.
    pub(crate) fn new(kind: BlockKind, saw_host: bool, malformed: bool) -> Self {
        FieldChecks {
            kind,
            list_size: 0,
            field_count: 0,
            seen_regular: false,
            seen_pseudo: 0,
            saw_options: false,
            http_scheme: false,
            origin_form: false,
            asterisk_form: false,
            rejected: false,
            malformed,
            saw_connect: false,
            saw_host,
            informational: false,
            no_body_status: false,
            method: RequestMethod::Other,
            content_length: None,
        }
    }

    fn is_request_like(&self) -> bool {
        self.kind.is_server || self.kind.is_push
    }

    /// Returns true if the field is to be delivered.
    pub(crate) fn accept(&mut self, name: &[u8], value: &[u8]) -> bool {
        self.list_size += name.len() + value.len() + 32;
        self.field_count += 1;
        if self.rejected
            || self.list_size > self.kind.max_list_size
            || self.field_count > self.kind.max_fields
        {
            self.rejected = true;
            return false;
        }
        if self.malformed {
            return false;
        }
        // A CR or LF that reached the application could split a header when it proxies to HTTP/1.
        if fields::is_malformed_name(name) || fields::is_malformed_value(value) {
            self.malformed = true;
            return false;
        }
        let keep = match name.strip_prefix(b":") {
            Some(pseudo) => {
                self.pseudo_header(pseudo, value);
                true
            }
            None => self.regular_field(name, value),
        };
        keep && !self.malformed
    }

    fn pseudo_header(&mut self, name: &[u8], value: &[u8]) {
        let bit: u8 = match name {
            b"method" => METHOD,
            b"scheme" => SCHEME,
            b"authority" => AUTHORITY,
            b"path" => PATH,
            b"status" => STATUS,
            b"protocol" => PROTOCOL,
            _ => UNKNOWN,
        };
        // §8.3: `:status` is the only pseudo-header of a response, and a request doesn't have it.
        let wrong_direction = (bit == STATUS) == self.is_request_like();
        // RFC 8441 §4
        let protocol_disabled =
            self.kind.is_server && bit == PROTOCOL && !self.kind.connect_protocol_enabled;
        // JS drops such a field, so it doesn't count as present. Without strict validation nghttp2 takes a `:protocol` that isn't all whitespace.
        let edge_whitespace = has_edge_whitespace(value)
            && (self.kind.strict_whitespace
                || bit != PROTOCOL
                || value.iter().all(|c| matches!(c, b' ' | b'\t')));
        if self.seen_regular
            || bit == UNKNOWN
            || (self.seen_pseudo & bit) != 0
            || wrong_direction
            || protocol_disabled
            || self.kind.is_trailer
            || value.is_empty()
            || edge_whitespace
            || has_control_byte(value)
            || !is_valid_pseudo_value(bit, value)
        {
            self.malformed = true;
        }
        self.seen_pseudo |= bit;
        match bit {
            METHOD => {
                self.saw_options = value == b"OPTIONS";
                self.method = RequestMethod::from_method(value);
                if self.method == RequestMethod::Connect {
                    self.saw_connect = true;
                    // nghttp2's http_request_on_header refuses CONNECT in a PUSH_PROMISE.
                    self.malformed |= self.kind.is_push;
                }
            }
            STATUS => {
                self.informational = value.len() == 3 && value[0] == b'1';
                self.no_body_status = matches!(value, b"204" | b"304");
            }
            SCHEME => {
                self.http_scheme =
                    value.eq_ignore_ascii_case(b"http") || value.eq_ignore_ascii_case(b"https");
            }
            PATH => {
                self.origin_form = value.starts_with(b"/");
                self.asterisk_form = value == b"*";
            }
            _ => {}
        }
    }

    /// Returns false for a field nghttp2 ignores (NGHTTP2_ERR_IGN_HTTP_HEADER).
    fn regular_field(&mut self, name: &[u8], value: &[u8]) -> bool {
        self.seen_regular = true;
        match name {
            _ if fields::is_connection_specific(name) => self.malformed = true,
            b"host" if self.is_request_like() => {
                if !is_valid_pseudo_value(AUTHORITY, value) {
                    return false;
                }
                // check_pseudo_header: not empty, and one per stream.
                if value.is_empty() || self.saw_host {
                    self.malformed = true;
                }
                self.saw_host = true;
            }
            b"te" => {
                if !value.eq_ignore_ascii_case(b"trailers") {
                    self.malformed = true;
                }
            }
            b"content-length" => match parse_content_length_strict(value) {
                Some(n) if self.content_length.is_none() => self.content_length = Some(n),
                _ => self.malformed = true,
            },
            _ => {}
        }
        !has_control_byte(value)
    }

    /// The checks that need the whole block: nghttp2_http_on_request_headers and nghttp2_http_on_response_headers.
    pub(crate) fn finish(&mut self) {
        if self.rejected {
            return;
        }
        let seen = self.seen_pseudo;
        let has = |bits: u8| (seen & bits) == bits;
        if self.kind.is_request && !self.malformed {
            let extended_connect = has(PROTOCOL);
            // Plain CONNECT has `:authority` and neither `:scheme` nor `:path` (§8.5).
            self.malformed = if self.saw_connect && !extended_connect {
                (seen & (SCHEME | PATH)) != 0 || !has(AUTHORITY)
            } else {
                !has(METHOD | SCHEME | PATH)
                    || (!has(AUTHORITY) && !self.saw_host)
                    || (extended_connect && (!self.saw_connect || !has(AUTHORITY)))
                    || (self.http_scheme
                        && !self.origin_form
                        && !(self.asterisk_form && self.saw_options))
            };
        }
        if !self.kind.is_server && !self.kind.is_request && !self.kind.is_trailer {
            self.malformed |= !has(STATUS);
        }
    }
}
