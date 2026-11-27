//! Integers with a prefix (RFC 7541 §5.1).

use crate::{Error, Result};

const _: () = assert!(usize::BITS >= 64);

/// `first` holds the prefix, and `rest` is what follows it.
#[inline(always)]
pub(crate) fn read(first: u8, prefix_bits: u32, rest: &mut &[u8]) -> Result<usize> {
    let full = u8::MAX >> (8 - prefix_bits);
    let prefix = first & full;
    if prefix < full {
        return Ok(prefix.into());
    }
    let mut value = usize::from(full);
    // Enough for any `u32`.
    for shift in [0, 7, 14, 21, 28] {
        let &byte = rest.split_off_first().ok_or(Error::Malformed)?;
        value += usize::from(byte & 0x7f) << shift;
        if byte < 0x80 {
            return Ok(value);
        }
    }
    Err(Error::Malformed)
}

/// `pattern` is what goes above the prefix.
#[inline(always)]
pub(crate) fn write(pattern: u8, prefix_bits: u32, value: usize, mut put: impl FnMut(u8)) {
    let full = u8::MAX >> (8 - prefix_bits);
    let Some(mut rest) = value.checked_sub(full.into()) else {
        return put(pattern | value as u8);
    };
    put(pattern | full);
    while rest >= 0x80 {
        put(0x80 | rest as u8);
        rest >>= 7;
    }
    put(rest as u8);
}

/// How many bytes [`write`] puts.
#[inline(always)]
pub(crate) fn written_len(prefix_bits: u32, value: usize) -> usize {
    let mut len = 0;
    write(0, prefix_bits, value, |_| len += 1);
    len
}
