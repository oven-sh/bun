use core::cell::Cell;
use core::mem::MaybeUninit;

use bun_core::strings::{
    self, ByteSet, eql_case_insensitive_ascii_check_length as eql_ignoring_case,
};
use bun_core::vec::BorrowedBuf;
use bun_http_types::Method::Method;

use super::{RequestError, RequestOptions};
use crate::byte_sets::{
    ABOVE_SPACE, CONTENT, CONTENT_OR_DELETE, LIST_ELEMENT, METHOD, NOT_QUESTION_MARK, NOT_SLASH,
    RELAXED_CONTENT, TOKEN, UPPERCASE_METHOD, VISIBLE,
};

/// 2 fewer than `UWS_HTTP_MAX_HEADERS_COUNT` in HttpParser.h.
pub(super) const MAX_FIELDS: usize = 198;
const MAX_TRAILER_FIELDS: usize = 199;
pub(super) const BLANKS: &[u8] = b" \t";

#[derive(Clone, Copy)]
pub struct Field<'a> {
    pub name: &'a [u8],
    pub value: &'a [u8],
}

pub(super) type FieldStorage<'a> = [MaybeUninit<Field<'a>>; MAX_FIELDS];

/// The head of a request, for as long as it is dispatched.
pub struct Request<'a> {
    line: RequestLine<'a>,
    /// Every known method fits.
    lowercase_method: [u8; 16],
    fields: &'a [Cell<Field<'a>>],
    names: NameFilter,
    pub(super) after_head: &'a [u8],
    pub(super) has_transfer_encoding: bool,
    pub(super) ends_connection: bool,
}

pub(super) enum Stop {
    Short,
    Failed(RequestError),
}

impl From<RequestError> for Stop {
    fn from(error: RequestError) -> Self {
        Self::Failed(error)
    }
}

impl<'a> Request<'a> {
    /// Returns the request and the length of its head, which `bytes` starts with.
    pub(super) fn parse<const IS_NODE: bool>(
        bytes: &'a [u8],
        storage: &'a mut FieldStorage<'a>,
        options: &RequestOptions,
    ) -> Result<(Self, usize), Stop> {
        let (line, mut rest) = RequestLine::parse::<IS_NODE>(bytes, options)?;

        // Like llhttp, it counts the target, the names and the values.
        let mut size = 0;
        let mut count = |bytes: &[u8]| {
            size += bytes.len() as u64;
            match options.max_header_size {
                max if max != 0 && size >= max => Err(RequestError::HeadTooLarge),
                _ => Ok(()),
            }
        };
        count(line.target)?;

        let max_fields = match options.max_headers_count as usize {
            0 => MAX_FIELDS,
            max => max.min(MAX_FIELDS),
        };
        let values = match options.has_lenient_values {
            true => &RELAXED_CONTENT,
            false if IS_NODE => &CONTENT,
            false => &CONTENT_OR_DELETE,
        };
        let mut fields = BorrowedBuf::from(storage.as_mut_slice());
        let mut names = NameFilter::default();
        let rest = loop {
            match rest {
                [b'\r', b'\n', rest @ ..] => break rest,
                [] | [b'\r'] => return Err(Stop::Short),
                [_] if fields.len() == 0 => return Err(Stop::Short),
                [b'\r', ..] if fields.len() != 0 => return Err(RequestError::InvalidRequest.into()),
                _ if fields.len() == max_fields => return Err(RequestError::HeadTooLarge.into()),
                _ => {}
            }
            let (name, after_name) = split_run(rest, &TOKEN);
            count(name)?;
            let (value, after_value) = match after_name {
                [] => return Err(Stop::Short),
                [b':', value @ ..] if !name.is_empty() => split_run(value, values),
                _ => return Err(RequestError::InvalidField.into()),
            };
            let ([] | [b'\r', ..]) = after_value else {
                return Err(RequestError::InvalidField.into());
            };
            let value = strings::trim_left(value, BLANKS);
            count(value)?;
            rest = match after_value {
                [_, b'\n', rest @ ..] => rest,
                [_, _, ..] => return Err(RequestError::LfExpected.into()),
                _ => return Err(Stop::Short),
            };
            let value = strings::trim_right(value, BLANKS);
            fields.unfilled().append(&[Field { name, value }]);
            names.add(name);
        };

        let request = Self {
            line,
            lowercase_method: bytes
                .first_chunk()
                .map_or([0; 16], |start| start.map(|byte| byte | 0x20)),
            fields: Cell::from_mut(fields.into_filled_mut()).as_slice_of_cells(),
            names,
            after_head: &[],
            has_transfer_encoding: false,
            ends_connection: false,
        };
        Ok((request, bytes.len() - rest.len()))
    }

    pub fn method(&self) -> &'a [u8] {
        self.line.method
    }

    /// One that is too long to be known stays as it was sent.
    pub fn lowercase_method(&self) -> &[u8] {
        let method = self.line.method;
        self.lowercase_method.get(..method.len()).unwrap_or(method)
    }

    pub fn target(&self) -> &'a [u8] {
        self.line.target
    }

    /// The target without its query, and without the scheme and the authority of an absolute one.
    pub fn path(&self) -> &'a [u8] {
        let (path, _) = split_run(self.line.target, &NOT_QUESTION_MARK);
        match skip_scheme(path).map(|rest| split_run(rest, &NOT_SLASH)) {
            None => path,
            Some((_, [])) => b"/",
            Some((_, path)) => path,
        }
    }

    pub fn is_http_1_0(&self) -> bool {
        self.line.is_http_1_0
    }

    pub(super) fn is_connect(&self) -> bool {
        self.line.is_connect
    }

    /// What follows the head in the read that completed it.
    pub fn after_head(&self) -> &'a [u8] {
        self.after_head
    }

    /// Whether `Transfer-Encoding` frames the body.
    pub fn has_transfer_encoding(&self) -> bool {
        self.has_transfer_encoding
    }

    /// Its framing leaves no room for another request (RFC 9112 §6.3).
    pub fn ends_connection(&self) -> bool {
        self.ends_connection
    }

    #[inline]
    pub fn fields(&self) -> impl ExactSizeIterator<Item = Field<'a>> + use<'a> {
        self.fields.iter().map(Cell::get)
    }

    pub fn field_at(&self, index: usize) -> Option<Field<'a>> {
        self.fields.get(index).map(Cell::get)
    }

    #[inline]
    pub(super) fn may_have(&self, name: &[u8]) -> bool {
        self.names.may_have(name)
    }

    #[inline]
    fn find(&self, name: &[u8]) -> Option<&'a Cell<Field<'a>>> {
        if !self.may_have(name) {
            return None;
        }
        let mut fields = self.fields.iter();
        fields.find(|field| eql_ignoring_case(field.get().name, name))
    }

    /// The value of the first field of that name.
    #[inline]
    pub fn field(&self, name: &[u8]) -> Option<&'a [u8]> {
        self.find(name).map(|field| field.get().value)
    }

    /// Empties the value of the first field of that name.
    pub fn clear_field(&self, name: &[u8]) {
        if let Some(field) = self.find(name) {
            field.update(|field| Field {
                value: b"",
                ..field
            });
        }
    }

    #[inline]
    pub(super) fn values(&self, name: &'static [u8]) -> impl Iterator<Item = &'a [u8]> + use<'a> {
        let fields = if self.may_have(name) {
            self.fields
        } else {
            &[]
        };
        let fields = fields.iter().map(Cell::get);
        fields.filter_map(move |field| eql_ignoring_case(field.name, name).then_some(field.value))
    }

    pub(super) fn has_in_connection(&self, option: &[u8]) -> bool {
        let mut values = self.values(b"connection");
        values.any(|value| has_element(value, option))
    }

    /// llhttp reads `Proxy-Connection` like `Connection`.
    pub fn has_in_connection_or_proxy_connection(&self, option: &[u8]) -> bool {
        let mut values = self.values(b"proxy-connection");
        self.has_in_connection(option) || values.any(|value| has_element(value, option))
    }

    /// llhttp's `upgrade` flag, for a method other than CONNECT.
    pub(super) fn is_upgrade(&self) -> bool {
        self.values(b"upgrade").any(|value| !value.is_empty())
            && self.has_in_connection_or_proxy_connection(b"upgrade")
    }
}

struct RequestLine<'a> {
    method: &'a [u8],
    target: &'a [u8],
    is_http_1_0: bool,
    /// With a target that is not a path.
    is_connect: bool,
}

impl<'a> RequestLine<'a> {
    fn parse<const IS_NODE: bool>(
        bytes: &'a [u8],
        options: &RequestOptions,
    ) -> Result<(Self, &'a [u8]), Stop> {
        let methods = match options.has_strict_methods {
            true => &UPPERCASE_METHOD,
            false => &METHOD,
        };
        let (method, rest) = match split_run(bytes, methods) {
            ([], _) | (_, [b'\r' | b'!'..=0xff, ..]) => {
                return Err(RequestError::InvalidMethod.into());
            }
            (_, []) => return Err(Stop::Short),
            (method, [b' ', rest @ ..]) => (method, rest),
            _ => return Err(RequestError::InvalidVersion.into()),
        };
        let is_connect = match (method, rest) {
            (_, [b'/', ..]) => false,
            (b"PRI", [b'*', ..]) => return Err(after_pri(bytes)),
            (b"CONNECT", _) => true,
            _ if rest.len() > b"https://".len() && skip_scheme(rest).is_some() => false,
            _ if rest.len() <= b"https://".len() && split_run(rest, &ABOVE_SPACE).1.is_empty() => {
                return Err(Stop::Short);
            }
            _ => return Err(RequestError::InvalidRequest.into()),
        };
        if options.has_strict_methods && Method::find(method).is_none() {
            return Err(RequestError::InvalidMethod.into());
        }

        let (target, rest) = split_run(rest, if IS_NODE { &VISIBLE } else { &ABOVE_SPACE });
        if IS_NODE && !matches!(rest, [] | [b' ' | b'\r' | b'\n', ..]) {
            return Err(RequestError::InvalidTarget.into());
        }
        if options.max_header_size != 0 && target.len() as u64 > options.max_header_size {
            return Err(RequestError::HeadTooLarge.into());
        }

        const HTTP_1_1: &[u8; 11] = b" HTTP/1.1\r\n";
        const HTTP_1_0: &[u8; 11] = b" HTTP/1.0\r\n";
        let (is_http_1_0, rest) = match rest.split_first_chunk() {
            Some((HTTP_1_1, rest @ [_, ..])) => (false, rest),
            Some((HTTP_1_0, rest @ [_, ..])) => (true, rest),
            _ if HTTP_1_1.starts_with(rest) || HTTP_1_0.starts_with(rest) => {
                return Err(Stop::Short);
            }
            _ => return Err(RequestError::InvalidVersion.into()),
        };
        let line = Self {
            method,
            target,
            is_http_1_0,
            is_connect,
        };
        Ok((line, rest))
    }
}

#[cold]
fn after_pri(bytes: &[u8]) -> Stop {
    const PREFACE: &[u8] = b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
    if bytes.starts_with(PREFACE) {
        RequestError::Http2Preface.into()
    } else if PREFACE.starts_with(bytes) {
        Stop::Short
    } else {
        RequestError::InvalidRequest.into()
    }
}

fn skip_scheme(target: &[u8]) -> Option<&[u8]> {
    match target.split_first_chunk::<4>()? {
        (http, [b':', b'/', b'/', rest @ ..] | [b's' | b'S', b':', b'/', b'/', rest @ ..]) => {
            eql_ignoring_case(http, b"http").then_some(rest)
        }
        _ => None,
    }
}

/// The first fields of a trailer section, which ends in an empty line. None if one is malformed.
pub fn parse_trailers(section: &[u8], has_lenient_values: bool) -> Vec<Field<'_>> {
    let values = match has_lenient_values {
        true => &RELAXED_CONTENT,
        false => &CONTENT,
    };
    let (mut fields, mut rest) = (Vec::new(), section);
    while fields.len() < MAX_TRAILER_FIELDS && !rest.starts_with(b"\r\n") {
        let (name @ [_, ..], [b':', value @ ..]) = split_run(rest, &TOKEN) else {
            return Vec::new();
        };
        let (value, [b'\r', b'\n', next @ ..]) = split_run(value, values) else {
            return Vec::new();
        };
        let value = strings::trim(value, BLANKS);
        fields.push(Field { name, value });
        rest = next;
    }
    fields
}

/// By llhttp's grammar of `Connection`, where a control character ends the list.
fn has_element(mut list: &[u8], expected: &[u8]) -> bool {
    loop {
        let (element, rest) = list.split_at(LIST_ELEMENT.short_prefix_len(list));
        let is_expected = eql_ignoring_case(strings::trim(element, BLANKS), expected);
        match rest {
            [] => return is_expected,
            [b',', ..] if is_expected => return true,
            [b',', rest @ ..] => list = rest,
            _ => return false,
        }
    }
}

#[inline]
pub(super) fn split_run<'a>(bytes: &'a [u8], set: &ByteSet) -> (&'a [u8], &'a [u8]) {
    (bytes.split_at_checked(set.prefix_len(bytes))).unwrap_or((bytes, &[]))
}

/// A Bloom filter without collisions among the common names of request fields.
#[derive(Default)]
struct NameFilter([u64; 4]);

impl NameFilter {
    #[inline]
    fn bits(name: &[u8]) -> Option<[u8; 4]> {
        let (&first, &middle) = (name.first()?, name.get(name.len() / 2)?);
        let &[before_last, last] = name.last_chunk()?;
        let features = [first, last, before_last, middle].map(|byte| byte.to_ascii_lowercase());
        let hash = u32::from_le_bytes(features).wrapping_mul(1_843_993_368);
        Some(hash.to_le_bytes())
    }

    #[inline]
    fn add(&mut self, name: &[u8]) {
        for bit in Self::bits(name).into_iter().flatten() {
            if let Some(word) = self.0.get_mut(usize::from(bit >> 6)) {
                *word |= 1 << (bit & 63);
            }
        }
    }

    #[inline]
    fn may_have(&self, name: &[u8]) -> bool {
        Self::bits(name).into_iter().flatten().all(|bit| {
            let word = self.0.get(usize::from(bit >> 6));
            word.is_some_and(|word| word >> (bit & 63) & 1 != 0)
        })
    }
}
