//! Pattern_White_Space, an immutable property. ICU4C: patternprops.cpp

#[inline]
pub(crate) fn is_white_space(c: u32) -> bool {
    matches!(
        c,
        0x9..=0xd | 0x20 | 0x85 | 0x200e | 0x200f | 0x2028 | 0x2029
    )
}

/// Returns the index after the white space at `start`.
pub(crate) fn skip_white_space(s: &[u16], start: usize) -> usize {
    let mut i = start;
    while s.get(i).is_some_and(|&c| is_white_space(u32::from(c))) {
        i += 1;
    }
    i
}

fn is_syntax(c: u32) -> bool {
    matches!(c, 0x21..=0x2f | 0x3a..=0x40 | 0x5b..=0x5e | 0x60 | 0x7b..=0x7e | 0xa1..=0xa7 | 0xa9 | 0xab..=0xac | 0xae | 0xb0..=0xb1 | 0xb6 | 0xbb | 0xbf | 0xd7 | 0xf7 | 0x2010..=0x2027 | 0x2030..=0x203e | 0x2041..=0x2053 | 0x2055..=0x205e | 0x2190..=0x245f | 0x2500..=0x2775 | 0x2794..=0x2bff | 0x2e00..=0x2e7f | 0x3001..=0x3003 | 0x3008..=0x3020 | 0x3030 | 0xfd3e..=0xfd3f | 0xfe45..=0xfe46)
}

/// Returns the length of the pattern identifier at the start of `s`.
pub(crate) fn skip_identifier(s: &[u16]) -> usize {
    let is_part = |&&c: &&u16| !is_syntax(c.into()) && !is_white_space(c.into());
    s.iter().take_while(is_part).count()
}
