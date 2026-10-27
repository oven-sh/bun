//! A heuristic for telling UTF-8 text from other data.

use crate::util::{Checked, SliceExt};

/// The `min_fraction` for [`is_mostly_utf8`] that the encoder uses.
pub(crate) const MIN_UTF8_RATIO: f64 = 0.75;

/// The length of the UTF-8 character at the start of `input`, of which `size` bytes count, or `None` if there is none.
fn parse_as_utf8(input: &[u8], size: usize) -> Checked<Option<usize>> {
    let b0 = u32::from(input.at(0)?);
    if b0 & 0x80 == 0 && b0 > 0 {
        return Ok(Some(1));
    }
    let continuation = |i: usize| {
        input
            .at(i)
            .map(|b| (b & 0xC0 == 0x80).then_some(u32::from(b & 0x3F)))
    };
    if size > 1 && b0 & 0xE0 == 0xC0 {
        if let Some(b1) = continuation(1)? {
            if ((b0 & 0x1F) << 6) | b1 > 0x7F {
                return Ok(Some(2));
            }
        }
    }
    if size > 2 && b0 & 0xF0 == 0xE0 {
        if let (Some(b1), Some(b2)) = (continuation(1)?, continuation(2)?) {
            if ((b0 & 0x0F) << 12) | (b1 << 6) | b2 > 0x7FF {
                return Ok(Some(3));
            }
        }
    }
    if size > 3 && b0 & 0xF8 == 0xF0 {
        if let (Some(b1), Some(b2), Some(b3)) =
            (continuation(1)?, continuation(2)?, continuation(3)?)
        {
            let symbol = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
            if symbol > 0xFFFF && symbol <= 0x10_FFFF {
                return Ok(Some(4));
            }
        }
    }
    Ok(None)
}

/// Whether more than `min_fraction` of the `length` bytes from `pos` on are UTF-8.
pub(crate) fn is_mostly_utf8(
    data: &[u8],
    pos: usize,
    mask: usize,
    length: usize,
    min_fraction: f64,
) -> Checked<bool> {
    let mut size_utf8 = 0usize;
    let mut i = 0usize;
    while i < length {
        match parse_as_utf8(data.sub((pos + i) & mask..)?, length - i)? {
            Some(bytes_read) => {
                i += bytes_read;
                size_utf8 += bytes_read;
            }
            None => i += 1,
        }
    }
    Ok(size_utf8 as f64 > min_fraction * length as f64)
}
