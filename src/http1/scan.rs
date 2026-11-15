//! Lengths of byte runs. The loops are shaped so that LLVM tests 16 bytes at once.

const BLOCK: usize = 16;

/// RFC 9110 §5.6.2 `tchar`.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static IS_TOKEN: [bool; 256] = {
    let mut table = [false; 256];
    let mut rest: &[u8] =
        b"!#$%&'*+-.^_`|~0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    while let [byte, tail @ ..] = rest {
        table[*byte as usize] = true;
        rest = tail;
    }
    table
};

fn is_token(byte: u8) -> bool {
    IS_TOKEN.get(usize::from(byte)) == Some(&true)
}

pub(crate) fn is_control(byte: u8) -> bool {
    byte.is_ascii_control() && byte != b'\t'
}

/// False for letters, digits, `-` and `.`, which nearly all field names are made of.
fn is_rare_in_token(byte: u8) -> bool {
    let is_letter = (byte | 0x20).wrapping_sub(b'a') < 26;
    let is_dash_to_nine = byte.wrapping_sub(b'-') <= b'9' - b'-';
    !(is_letter || (is_dash_to_nine && byte != b'/'))
}

/// Bit `i` is `test(block[i])`.
#[inline(always)]
fn mask(block: &[u8; BLOCK], test: impl Fn(u8) -> bool) -> u16 {
    let mut bits = 0;
    for (i, &byte) in block.iter().enumerate() {
        bits |= u16::from(test(byte)) << i;
    }
    bits
}

/// How many bytes come before the first one that passes `test`.
#[inline(always)]
pub(crate) fn len_before(bytes: &[u8], test: impl Fn(u8) -> bool + Copy) -> usize {
    let (blocks, tail) = bytes.as_chunks();
    for (i, block) in blocks.iter().enumerate() {
        let found = mask(block, test);
        if found != 0 {
            return i * BLOCK + found.trailing_zeros() as usize;
        }
    }
    match bytes.last_chunk() {
        Some(last) => bytes.len() - BLOCK + mask(last, test).trailing_zeros() as usize,
        None => tail.iter().take_while(|&&byte| !test(byte)).count(),
    }
}

/// How many bytes come before the first control character other than HTAB.
#[inline(always)]
pub(crate) fn content_len(bytes: &[u8]) -> usize {
    len_before(bytes, is_control)
}

/// How many `tchar`s `bytes` starts with.
#[inline(always)]
pub(crate) fn token_len(bytes: &[u8]) -> usize {
    let (blocks, tail) = bytes.as_chunks();
    for (i, block) in blocks.iter().enumerate() {
        let mut rare = mask(block, is_rare_in_token);
        while rare != 0 {
            let at = rare.trailing_zeros() as usize;
            if !block.get(at).is_some_and(|&byte| is_token(byte)) {
                return i * BLOCK + at;
            }
            rare &= rare - 1;
        }
    }
    bytes.len() - tail.len() + tail.iter().take_while(|&&byte| is_token(byte)).count()
}
