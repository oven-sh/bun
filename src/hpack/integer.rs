//! Prefix integers (§5.1).

/// `flags` holds the bits above the prefix.
pub(crate) fn encode(out: &mut Vec<u8>, flags: u8, prefix_bits: u32, value: u32) {
    let prefix_max = (1u32 << prefix_bits) - 1;
    if value < prefix_max {
        out.push(flags | value as u8);
        return;
    }
    out.push(flags | prefix_max as u8);
    let mut rest = value - prefix_max;
    while rest >= 128 {
        out.push(rest as u8 | 0x80);
        rest >>= 7;
    }
    out.push(rest as u8);
}

/// Moves `pos` past the integer. `None` if it is cut off, over 32 bits, or zero-padded to 6 bytes.
#[inline]
pub(crate) fn decode(src: &[u8], pos: &mut usize, prefix_bits: u32) -> Option<u32> {
    let prefix_max = (1u32 << prefix_bits) - 1;
    let value = u32::from(*src.get(*pos)?) & prefix_max;
    *pos += 1;
    // Nine in ten fit the prefix, and the rest rarely take more than one byte.
    if value < prefix_max {
        return Some(value);
    }
    decode_continuation(src, pos, value)
}

#[cold]
fn decode_continuation(src: &[u8], pos: &mut usize, mut value: u32) -> Option<u32> {
    let mut shift = 0;
    loop {
        let byte = u32::from(*src.get(*pos)?);
        *pos += 1;
        let bits = byte & 0x7f;
        if shift == 28 && (byte & 0x80 != 0 || bits == 0 || bits > 0xf) {
            return None;
        }
        value = value.checked_add(bits << shift)?;
        if byte & 0x80 == 0 {
            return Some(value);
        }
        shift += 7;
    }
}
