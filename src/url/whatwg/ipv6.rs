use core::ops::Range;

use bun_engine_text::CodeUnit;

use crate::{Error, Result, ipv4};

type Address = [u16; 8];

/// The IPv6 parser, for what is between the brackets.
pub(crate) fn parse(input: &[u8]) -> Result<Address> {
    let mut address = [0; 8];
    let mut count = 0;
    let mut compress = None;
    let mut rest = input;
    if let [b':', after_colon @ ..] = rest {
        if after_colon.first() != Some(&b':') {
            return Err(Error::Invalid);
        }
        rest = after_colon;
    }
    while !rest.is_empty() {
        if count == 8 {
            return Err(Error::Invalid);
        }
        if let [b':', after_colon @ ..] = rest {
            if compress.is_some() {
                return Err(Error::Invalid);
            }
            rest = after_colon;
            count += 1;
            compress = Some(count);
            continue;
        }
        let digits = rest.iter().take(4).map_while(|digit| digit.digit_value(16));
        let (value, length) = digits.fold((0, 0), |(value, length), digit| {
            (value << 4 | digit as u16, length + 1)
        });
        match &rest[length..] {
            [b'.', ..] if count <= 6 && ipv4::serialized_length(rest) == Some(rest.len()) => {
                let embedded = ipv4::parse(rest)?;
                address[count] = (embedded >> 16) as u16;
                address[count + 1] = embedded as u16;
                count += 2;
                break;
            }
            [] => rest = &[],
            [b':', after_colon @ ..] if !after_colon.is_empty() => rest = after_colon,
            _ => return Err(Error::Invalid),
        }
        address[count] = value;
        count += 1;
    }
    match compress {
        Some(compress) => address[compress..].rotate_right(8 - count),
        None if count != 8 => return Err(Error::Invalid),
        None => {}
    }
    Ok(address)
}

/// The first of the longest runs of two or more zeros.
fn compressed_pieces(address: &Address) -> Range<usize> {
    let mut longest = 8..8;
    let mut start = 0;
    for (index, &piece) in address.iter().enumerate() {
        if piece != 0 {
            start = index + 1;
        } else if index + 1 - start > longest.len().max(1) {
            longest = start..index + 1;
        }
    }
    longest
}

/// With the brackets.
pub(crate) fn serialize<'a>(address: &Address, storage: &'a mut [u8; 41]) -> &'a [u8] {
    let mut length = 0;
    let mut push = |byte| {
        storage[length] = byte;
        length += 1;
    };
    let compressed = compressed_pieces(address);
    push(b'[');
    for (index, &piece) in address.iter().enumerate() {
        if compressed.contains(&index) {
            if index == 0 {
                push(b':');
            }
            if index == compressed.start {
                push(b':');
            }
            continue;
        }
        let digit_count = (19 - (piece | 1).leading_zeros()) / 4;
        for digit in (0..digit_count).rev() {
            push(b"0123456789abcdef"[usize::from(piece >> (4 * digit) & 15)]);
        }
        if index != 7 {
            push(b':');
        }
    }
    push(b']');
    &storage[..length]
}
