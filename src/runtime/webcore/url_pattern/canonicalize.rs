//! <https://urlpattern.spec.whatwg.org/#canon-encoding-callbacks>

use bun_core::fmt::{ItoaBuf, itoa};
use bun_core::{BoundedArray, EncodedSlice, String, strings};
use bun_url::whatwg::{Parsed, URL};

use super::{Kind, PatternError};

pub(super) static SPECIAL_SCHEMES: [(&[u8], Option<u16>); 6] = [
    (b"ftp", Some(21)),
    (b"file", None),
    (b"http", Some(80)),
    (b"https", Some(443)),
    (b"ws", Some(80)),
    (b"wss", Some(443)),
];

/// `None` for a scheme that is not special.
fn special_scheme(protocol: EncodedSlice<'_>) -> Option<&'static (&'static [u8], Option<u16>)> {
    SPECIAL_SCHEMES
        .iter()
        .find(|(scheme, _)| protocol.eq_ascii(scheme))
}

pub(super) fn default_port(protocol: EncodedSlice<'_>) -> Option<u16> {
    special_scheme(protocol)?.1
}

/// Latin-1 or UTF-16, and what holds it.
pub(super) enum Text<'t> {
    Borrowed(EncodedSlice<'t>),
    Owned(String),
    PartOf(Parsed, fn(&URL) -> EncodedSlice<'_>),
    Digits(BoundedArray<u8, 5>),
}

impl<'t> Text<'t> {
    pub(super) const EMPTY: Self = Self::Borrowed(EncodedSlice::EMPTY);
    pub(super) const WILDCARD: Self = Self::Borrowed(EncodedSlice::latin1(b"*"));

    pub(super) fn get(&self) -> EncodedSlice<'_> {
        match self {
            Self::Borrowed(text) => *text,
            Self::Owned(string) => string.to_encoded_slice(),
            Self::PartOf(url, part) => part(url),
            Self::Digits(digits) => EncodedSlice::latin1(digits.as_slice()),
        }
    }

    fn port(port: Option<u16>) -> Self {
        let mut digits = BoundedArray::new();
        if let Some(port) = port {
            digits.append_slice_assume_capacity(itoa(&mut ItoaBuf::new(), port));
        }
        Self::Digits(digits)
    }

    pub(super) fn component_of(url: &'t URL, kind: Kind) -> Self {
        match kind {
            Kind::Protocol => Self::Borrowed(url.protocol()),
            Kind::Username => Self::Owned(url.username()),
            Kind::Password => Self::Owned(url.password()),
            Kind::Hostname => Self::Borrowed(url.host()),
            Kind::Pathname => Self::Borrowed(url.pathname()),
            Kind::Port => Self::port(u16::try_from(url.port()).ok()),
            Kind::Search => Self::Borrowed(url.query()),
            Kind::Hash => Self::Borrowed(url.fragment_identifier()),
        }
    }
}

pub(super) fn allocated(string: String) -> Result<String, PatternError> {
    if string.is_dead() {
        return Err(PatternError::OutOfMemory);
    }
    Ok(string)
}

fn check_length(length: usize) -> Result<(), PatternError> {
    if length > String::max_length() {
        return Err(PatternError::OutOfMemory);
    }
    Ok(())
}

/// They are not all empty.
pub(super) fn concat<'t>(
    pieces: impl Iterator<Item = EncodedSlice<'t>> + Clone,
) -> Result<String, PatternError> {
    let length = pieces.clone().map(|piece| piece.len).sum();
    let mut start = 0;
    if !pieces.clone().any(|piece| piece.is_16bit()) {
        let (string, units) = String::create_uninitialized_latin1(length);
        let string = allocated(string)?;
        for piece in pieces {
            units[start..][..piece.len].copy_from_slice(piece.slice());
            start += piece.len;
        }
        return Ok(string);
    }
    let (string, units) = String::create_uninitialized_utf16(length);
    let string = allocated(string)?;
    for piece in pieces {
        let units = &mut units[start..][..piece.len];
        if piece.is_16bit() {
            units.copy_from_slice(piece.utf16_slice());
        } else {
            strings::copy_u8_into_u16(units, piece.slice());
        }
        start += piece.len;
    }
    Ok(string)
}

fn concat_within_limit(
    first: EncodedSlice<'_>,
    second: EncodedSlice<'_>,
) -> Result<String, PatternError> {
    check_length(first.len + second.len)?;
    concat([first, second].into_iter())
}

fn dummy_url() -> Parsed {
    Parsed::from_string(&String::static_("https://w/")).expect("a valid URL")
}

pub(super) fn without_prefix(value: EncodedSlice<'_>, prefix: u8) -> EncodedSlice<'_> {
    value.substring(usize::from(value.starts_with_ascii(&[prefix])))
}

fn without_suffix(value: EncodedSlice<'_>, suffix: u8) -> EncodedSlice<'_> {
    match value.len.checked_sub(1) {
        Some(last) if value.char_at(last) == u16::from(suffix) => value.substring_with_len(0, last),
        _ => value,
    }
}

/// The port state of the URL parser, with a state override.
fn parse_port(value: EncodedSlice<'_>) -> Result<u16, PatternError> {
    const INVALID: PatternError =
        PatternError::Type("Invalid input to canonicalize a URL port string.");
    let mut port = None::<u16>;
    for index in 0..value.len {
        match u8::try_from(value.char_at(index)) {
            Ok(b'\t' | b'\n' | b'\r') => {}
            Ok(digit @ b'0'..=b'9') => {
                let shifted = port.unwrap_or(0).checked_mul(10);
                let next = shifted.and_then(|n| n.checked_add(u16::from(digit - b'0')));
                port = Some(next.ok_or(INVALID)?);
            }
            _ => break,
        }
    }
    port.ok_or(INVALID)
}

#[derive(Clone, Copy)]
pub(super) enum Encoding {
    Protocol,
    Username,
    Password,
    Hostname,
    IPv6Hostname,
    Port { default: Option<u16> },
    Pathname,
    OpaquePathname,
    Search,
    Hash,
}

impl Encoding {
    pub(super) fn of_pathname(protocol: EncodedSlice<'_>) -> Self {
        if protocol.is_empty() || special_scheme(protocol).is_some() {
            Self::Pathname
        } else {
            Self::OpaquePathname
        }
    }

    pub(super) fn without_delimiter(self, value: EncodedSlice<'_>) -> EncodedSlice<'_> {
        match self {
            Self::Protocol => without_suffix(value, b':'),
            Self::Search => without_prefix(value, b'?'),
            Self::Hash => without_prefix(value, b'#'),
            _ => value,
        }
    }

    /// The result is ASCII.
    pub(super) fn canonicalize(
        self,
        value: EncodedSlice<'_>,
    ) -> Result<Text<'static>, PatternError> {
        if value.is_empty() {
            return Ok(Text::EMPTY);
        }
        let value = self.without_delimiter(value);
        match self {
            Self::Protocol => {
                let url = concat_within_limit(value, EncodedSlice::latin1(b"://w/"))?;
                let url = Parsed::from_string(&url).ok_or(PatternError::Type(
                    "Invalid input to canonicalize a URL protocol string.",
                ))?;
                Ok(Text::PartOf(url, URL::protocol))
            }
            Self::Username => {
                let mut url = dummy_url();
                url.set_username(value);
                Ok(Text::PartOf(url, URL::encoded_username))
            }
            Self::Password => {
                let mut url = dummy_url();
                url.set_password(value);
                Ok(Text::PartOf(url, URL::encoded_password))
            }
            Self::Hostname => {
                let mut url = dummy_url();
                if !url.set_host(value) {
                    return Err(PatternError::Type(
                        "Invalid input to canonicalize a URL host string.",
                    ));
                }
                Ok(Text::PartOf(url, URL::host))
            }
            Self::IPv6Hostname => {
                let (string, units) = String::create_uninitialized_latin1(value.len);
                let string = allocated(string)?;
                for (index, unit) in units.iter_mut().enumerate() {
                    *unit = u8::try_from(value.char_at(index))
                        .ok()
                        .filter(|c| c.is_ascii_hexdigit() || matches!(c, b'[' | b']' | b':'))
                        .ok_or(PatternError::Type(
                            "Invalid input to canonicalize a URL IPv6 host string.",
                        ))?
                        .to_ascii_lowercase();
                }
                Ok(Text::Owned(string))
            }
            Self::Port { default } => Ok(Text::port(
                Some(parse_port(value)?).filter(|&port| Some(port) != default),
            )),
            Self::Pathname => {
                let mut url = dummy_url();
                if value.starts_with_ascii(b"/") {
                    check_length(value.len)?;
                    url.set_pathname(value);
                    return Ok(Text::PartOf(url, URL::pathname));
                }
                let prefixed = concat_within_limit(EncodedSlice::latin1(b"/-"), value)?;
                url.set_pathname(prefixed.to_encoded_slice());
                Ok(Text::PartOf(url, |url| url.pathname().substring(2)))
            }
            Self::OpaquePathname => {
                let url = concat_within_limit(EncodedSlice::latin1(b"a:"), value)?;
                let url = Parsed::from_string(&url).ok_or(PatternError::Type(
                    "Invalid input to canonicalize a URL opaque path string.",
                ))?;
                Ok(Text::PartOf(url, URL::pathname))
            }
            Self::Search => {
                let mut url = dummy_url();
                url.set_query(value);
                Ok(Text::PartOf(url, URL::query))
            }
            Self::Hash => {
                let mut url = dummy_url();
                url.set_fragment_identifier(value);
                Ok(Text::PartOf(url, URL::fragment_identifier))
            }
        }
    }
}
