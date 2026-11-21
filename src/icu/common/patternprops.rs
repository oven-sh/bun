//! Pattern_White_Space, an immutable property. ICU4C: patternprops.cpp

#[inline]
pub(crate) fn is_white_space(c: u32) -> bool {
    matches!(
        c,
        0x9..=0xd | 0x20 | 0x85 | 0x200e | 0x200f | 0x2028 | 0x2029
    )
}
