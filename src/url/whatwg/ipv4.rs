use bun_engine_text::CodeUnit;

use crate::{Error, Result};

fn without_last_dot(domain: &[u8]) -> &[u8] {
    domain.strip_suffix(b".").unwrap_or(domain)
}

/// The ends in a number checker, for a lowercase domain.
pub(crate) fn ends_in_number(domain: &[u8]) -> bool {
    let domain = without_last_dot(domain);
    if !domain
        .last()
        .is_some_and(|last| last.is_ascii_hexdigit() || *last == b'x')
    {
        return false;
    }
    let start = bun_highway::last_index_of_char(domain, b'.').map_or(0, |dot| dot + 1);
    match &domain[start..] {
        [b'0', b'x', digits @ ..] => digits.iter().all(u8::is_ascii_hexdigit),
        digits => digits.iter().all(u8::is_ascii_digit),
    }
}

/// The IPv4 number parser. No address has a number that takes more than 32 bits.
fn number(part: &[u8]) -> Option<u32> {
    let (digits, radix) = match part {
        [] => return None,
        [b'0', b'x', digits @ ..] => (digits, 16),
        [b'0', digits @ ..] => (digits, 8),
        digits => (digits, 10),
    };
    digits.iter().try_fold(0u32, |value, digit| {
        value
            .checked_mul(radix)?
            .checked_add(digit.digit_value(radix)?)
    })
}

/// The IPv4 parser, for a lowercase domain that ends in a number.
pub(crate) fn parse(domain: &[u8]) -> Result<u32> {
    let mut rest = without_last_dot(domain);
    let mut address = 0;
    let mut bits_left = 32;
    while let Some(dot) = bun_highway::index_of_char(rest, b'.') {
        bits_left -= 8;
        match number(&rest[..dot]) {
            Some(value @ 0..=255) if bits_left > 0 => address |= value << bits_left,
            _ => return Err(Error::Invalid),
        }
        rest = &rest[dot + 1..];
    }
    match number(rest) {
        Some(value) if value.unbounded_shr(bits_left) == 0 => Ok(address | value),
        _ => Err(Error::Invalid),
    }
}

/// The length of what `text` starts with, if [`serialize`] writes that for some address.
pub(crate) fn serialized_length(text: &[u8]) -> Option<usize> {
    let digit = |at: usize| text.get(at)?.digit_value(10);
    let mut at = 0;
    for part in 0..4 {
        if part != 0 {
            text.get(at).filter(|&&byte| byte == b'.')?;
            at += 1;
        }
        let first = digit(at)?;
        at += 1;
        if first != 0
            && let Some(second) = digit(at)
        {
            at += 1;
            if let Some(third) = digit(at) {
                u8::try_from(first * 100 + second * 10 + third).ok()?;
                at += 1;
            }
        }
    }
    Some(at)
}

pub(crate) fn serialize(address: u32, storage: &mut [u8; 16]) -> &[u8] {
    let mut length = 0;
    for part in address.to_be_bytes() {
        let digits = [part / 100, part / 10 % 10, part % 10];
        let leading_zeros = usize::from(part < 100) + usize::from(part < 10);
        for digit in &digits[leading_zeros..] {
            storage[length] = b'0' + digit;
            length += 1;
        }
        storage[length] = b'.';
        length += 1;
    }
    &storage[..length - 1]
}
