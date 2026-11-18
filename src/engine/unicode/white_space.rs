const fn mask(characters: &[u8]) -> u64 {
    let (mut bits, mut index) = (0, 0);
    while index < characters.len() {
        bits |= 1 << characters[index];
        index += 1;
    }
    bits
}

const WHITE_SPACE: u64 = mask(b"\t\x0b\x0c ");
const LINE_TERMINATOR: u64 = mask(b"\n\r");

/// The rest of the category Zs, and ZWNBSP.
const fn is_white_space_above_latin1(c: u32) -> bool {
    matches!(
        c,
        0x1680 | 0x2000..=0x200a | 0x202f | 0x205f | 0x3000 | 0xfeff
    )
}

/// WhiteSpace of ECMA-262.
#[inline]
pub const fn is_white_space(c: u32) -> bool {
    match c {
        0..=0x20 => WHITE_SPACE >> c & 1 != 0,
        0x21..=0xff => c == 0xa0,
        _ => is_white_space_above_latin1(c),
    }
}

/// LineTerminator of ECMA-262.
#[inline]
pub const fn is_line_terminator(c: u32) -> bool {
    matches!(c, 0x0a | 0x0d | 0x2028 | 0x2029)
}

/// StrWhiteSpaceChar of ECMA-262: what `trim` removes and `\s` matches.
#[inline]
pub const fn is_str_white_space(c: u32) -> bool {
    match c {
        0..=0x20 => (WHITE_SPACE | LINE_TERMINATOR) >> c & 1 != 0,
        0x21..=0xff => c == 0xa0,
        _ => is_white_space_above_latin1(c) || c | 1 == 0x2029,
    }
}
