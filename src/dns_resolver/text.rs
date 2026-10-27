//! Classifying and splitting the bytes of names and configuration files, the way c-ares does.

use bun_core::strings;

/// isspace(3) in the C locale.
const SPACES: &[u8] = b" \t\n\r\x0b\x0c";

/// isprint(3) in the C locale.
pub(crate) fn is_print(byte: u8) -> bool {
    matches!(byte, 0x20..=0x7e)
}

pub(crate) fn all_print(bytes: &[u8]) -> bool {
    bytes.iter().all(|&byte| is_print(byte))
}

/// Letters, digits and `-._/*`: what a host name is made of, plus `_` (SRV), `/` (classless
/// in-addr.arpa) and `*` (wildcards seen in CNAMEs).
pub(crate) fn is_hostname_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'/' | b'*')
}

pub(crate) fn is_hostname(bytes: &[u8]) -> bool {
    bytes.iter().all(|&byte| is_hostname_byte(byte))
}

pub(crate) fn trim_start(text: &[u8]) -> &[u8] {
    strings::trim_left(text, SPACES)
}

pub(crate) fn trim(text: &[u8]) -> &[u8] {
    strings::trim(text, SPACES)
}

/// The bytes at the start of `text` that `belongs` takes, and the rest.
pub(crate) fn take_while(text: &[u8], belongs: impl Fn(u8) -> bool) -> (&[u8], &[u8]) {
    let count = text.iter().take_while(|&&byte| belongs(byte)).count();
    text.split_at_checked(count).unwrap_or((text, &[]))
}

/// What is before the first white space, and the rest.
pub(crate) fn word(text: &[u8]) -> (&[u8], &[u8]) {
    take_while(text, |byte| !strings::contains_char(SPACES, byte))
}

/// `INET6_ADDRSTRLEN`.
pub(crate) const ADDRESS_SIZE: usize = 46;
pub(crate) const HOST_NAME_SIZE: usize = 256;

/// `text` if all of it prints and it would fit c-ares's buffer of `size` bytes with a NUL.
pub(crate) fn printable_within(text: &[u8], size: usize) -> Option<&[u8]> {
    (text.len() < size && all_print(text)).then_some(text)
}

/// The parts of `text` between any of `delimiters`, trimmed, without the blank ones.
pub(crate) fn fields<'a>(text: &'a [u8], delimiters: &'a [u8]) -> impl Iterator<Item = &'a [u8]> {
    strings::tokenize_any(text, delimiters)
        .map(trim)
        .filter(|part| !part.is_empty())
}

/// The first part of `text` before a `delimiter` that is not blank, and all that follows that
/// delimiter unless it is blank. Both trimmed.
pub(crate) fn key_and_value(text: &[u8], delimiter: u8) -> Option<(&[u8], Option<&[u8]>)> {
    let mut rest = text;
    loop {
        let (part, after) = match strings::split_once_char(rest, delimiter) {
            Some((part, after)) => (part, Some(after)),
            None => (rest, None),
        };
        let part = trim(part);
        if !part.is_empty() {
            return Some((part, after.map(trim).filter(|value| !value.is_empty())));
        }
        rest = after?;
    }
}

/// Digits only, so no sign.
pub(crate) fn parse_uint(text: &[u8]) -> Option<u32> {
    if text.is_empty() {
        return None;
    }
    text.iter().try_fold(0u32, |value, &byte| {
        let digit = char::from(byte).to_digit(10)?;
        value.checked_mul(10)?.checked_add(digit)
    })
}
