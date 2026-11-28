use bun_core::strings::ByteSet;
use bun_hpack::{Decoder, Error};
use bun_http_types::Method::Method;
use bun_http_types::h2::ErrorCode;
use bun_http1::byte_sets::{CONTENT_OR_DELETE, TOKEN};
use bun_http1::request::is_path_for;

/// As for HTTP/1.
const MAX_FIELDS: usize = 200;
/// `": "` and the line end, so that the limits are those of HTTP/1.
const FIELD_OVERHEAD: usize = 4;

static NOT_AT_SIGN: ByteSet = ByteSet::new(&[0..=b'?', b'A'..=0xff]);

pub(super) struct DecodeBuffer<F> {
    bytes: Vec<u8>,
    fields: Vec<F>,
    scratch: Vec<u8>,
}

impl<F> Default for DecodeBuffer<F> {
    fn default() -> Self {
        Self {
            bytes: Vec::new(),
            fields: Vec::new(),
            scratch: Vec::new(),
        }
    }
}

/// RFC 9113 §8.2.1
fn is_valid_name(name: &[u8]) -> bool {
    !name.is_empty()
        && (name.iter()).all(|&byte| TOKEN.contains(byte) && !byte.is_ascii_uppercase())
}

fn is_valid_value(value: &[u8]) -> bool {
    let is_blank = |byte: Option<&u8>| matches!(byte, Some(b' ' | b'\t'));
    !is_blank(value.first())
        && !is_blank(value.last())
        && CONTENT_OR_DELETE.prefix_len(value) == value.len()
}

fn parse_content_length(value: &[u8]) -> Option<u64> {
    let digits = value.iter().try_fold(0i64, |len, byte| {
        let digit = byte.is_ascii_digit().then(|| byte - b'0')?;
        len.checked_mul(10)?.checked_add(digit.into())
    });
    digits.filter(|_| !value.is_empty()).map(|len| len as u64)
}

enum Name {
    Method,
    Scheme,
    Path,
    Authority,
    Host,
    ContentLength,
    Te,
    Expect,
    Forbidden,
    Other,
}

impl Name {
    fn new(name: &[u8], static_index: u8) -> Self {
        match static_index {
            0 => {}
            1 => return Self::Authority,
            2 | 3 => return Self::Method,
            4 | 5 => return Self::Path,
            6 | 7 => return Self::Scheme,
            8..=14 | 57 => return Self::Forbidden,
            28 => return Self::ContentLength,
            35 => return Self::Expect,
            38 => return Self::Host,
            _ => return Self::Other,
        }
        match name {
            b":authority" => Self::Authority,
            b":method" => Self::Method,
            b":path" => Self::Path,
            b":scheme" => Self::Scheme,
            b"content-length" => Self::ContentLength,
            b"expect" => Self::Expect,
            b"host" => Self::Host,
            b"te" => Self::Te,
            b"connection" | b"keep-alive" | b"proxy-connection" | b"transfer-encoding"
            | b"upgrade" => Self::Forbidden,
            _ if is_valid_name(name) => Self::Other,
            _ => Self::Forbidden,
        }
    }
}

/// What the fields say about their request. What is missing is empty.
#[derive(Default)]
pub(super) struct Head<'a> {
    method: &'a [u8],
    scheme: &'a [u8],
    pub(super) path: &'a [u8],
    authority: &'a [u8],
    host: &'a [u8],
    expect: Option<&'a [u8]>,
    pub(super) content_length: Option<u64>,
    has_regular_field: bool,
    pub(super) has_malformed_field: bool,
}

impl<'a> Head<'a> {
    fn add_field(&mut self, name: &[u8], value: &'a [u8], static_index: u8) {
        let name = Name::new(name, static_index);
        let pseudo_header = match name {
            Name::Method => Some(&mut self.method),
            Name::Scheme => Some(&mut self.scheme),
            Name::Path => Some(&mut self.path),
            Name::Authority => Some(&mut self.authority),
            _ => None,
        };
        let is_malformed = if let Some(slot) = pseudo_header {
            self.has_regular_field
                || value.is_empty()
                || !core::mem::replace(slot, value).is_empty()
        } else {
            self.has_regular_field = true;
            match name {
                Name::Forbidden => true,
                Name::Te => !value.eq_ignore_ascii_case(b"trailers"),
                Name::Host => !core::mem::replace(&mut self.host, value).is_empty(),
                Name::ContentLength => {
                    let is_repeated = self.content_length.is_some();
                    self.content_length = parse_content_length(value);
                    is_repeated || self.content_length.is_none()
                }
                Name::Expect => {
                    self.expect.get_or_insert(value);
                    false
                }
                _ => false,
            }
        };
        self.has_malformed_field |= is_malformed || !is_valid_value(value);
    }

    /// RFC 9113 §8.3.1
    pub(super) fn is_malformed(&self) -> bool {
        let is_target_valid = is_path_for(self.method, self.path)
            && match self.method {
                b"CONNECT" => self.scheme.is_empty() && !self.authority.is_empty(),
                _ => !self.scheme.is_empty(),
            };
        let is_authority_valid = match (self.authority, self.host) {
            (b"", host) => !host.is_empty(),
            (authority, host) => {
                (host.is_empty() || host == authority)
                    && NOT_AT_SIGN.prefix_len(authority) == authority.len()
            }
        };
        self.has_malformed_field
            || !is_target_valid
            || !is_authority_valid
            || self.method.is_empty()
            || TOKEN.prefix_len(self.method) != self.method.len()
    }

    pub(super) fn known_method(&self) -> Option<Method> {
        Method::find_uppercase(self.method)
    }

    pub(super) fn authority(&self) -> &'a [u8] {
        match self.authority {
            b"" => self.host,
            authority => authority,
        }
    }

    pub(super) fn expects_continue(&self) -> bool {
        self.expect == Some(b"100-continue")
    }
}

fn copy_to<'a>(room: &mut &'a mut [u8], bytes: &[u8]) -> &'a [u8] {
    let copy;
    (copy, *room) = core::mem::take(room).split_at_mut(bytes.len());
    copy.copy_from_slice(bytes);
    copy
}

impl<F> DecodeBuffer<F> {
    /// `None` if there is more than `max_size`, or there are too many fields.
    pub(super) fn decode(
        &mut self,
        decoder: &mut Decoder,
        block: &[u8],
        (max_size, hard_max_size): (usize, usize),
        is_trailer_section: bool,
        new_field: impl Fn(&[u8], &[u8]) -> F,
    ) -> Result<Option<(Head<'_>, &[F])>, ErrorCode> {
        self.bytes.resize(max_size, 0);
        self.fields.clear();
        let mut room = self.bytes.as_mut_slice();
        let mut head = Head::default();
        let (mut size, mut count) = (0, 0);
        let mut fields = decoder.decode(block, &mut self.scratch);
        // Past the limits it goes on for the sake of the dynamic table.
        while let Some(field) = fields.next().map_err(|error| match error {
            Error::FieldTooLong => ErrorCode::ENHANCE_YOUR_CALM,
            Error::Malformed => ErrorCode::COMPRESSION_ERROR,
        })? {
            size += field.name.len() + field.value.len() + FIELD_OVERHEAD;
            count += 1;
            if size > hard_max_size || count > MAX_FIELDS * 2 {
                return Err(ErrorCode::ENHANCE_YOUR_CALM);
            }
            if size > max_size || count > MAX_FIELDS {
                continue;
            }
            if is_trailer_section {
                head.has_malformed_field |=
                    !is_valid_name(field.name) || !is_valid_value(field.value);
                continue;
            }
            let name = match field.static_index {
                0 => copy_to(&mut room, field.name),
                index => bun_hpack::static_name(index),
            };
            let value = copy_to(&mut room, field.value);
            head.add_field(name, value, field.static_index);
            self.fields.push(new_field(name, value));
        }
        Ok((size <= max_size && count <= MAX_FIELDS).then_some((head, &self.fields)))
    }
}
