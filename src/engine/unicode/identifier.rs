use crate::tables::{ID_BITS, ID_CONTINUE_CHUNKS, ID_START_CHUNKS};

#[inline]
fn contains(chunks: &[u8], c: u32) -> bool {
    chunks.get((c >> 9) as usize).is_some_and(|&chunk| {
        ID_BITS[usize::from(chunk)][(c >> 6 & 7) as usize] >> (c & 63) & 1 != 0
    })
}

/// The property ID_Start.
#[inline]
pub fn is_id_start(c: u32) -> bool {
    contains(&ID_START_CHUNKS, c)
}

/// The property ID_Continue, which ZWNJ and ZWJ have.
#[inline]
pub fn is_id_continue(c: u32) -> bool {
    contains(&ID_CONTINUE_CHUNKS, c)
}

/// IdentifierStartChar of ECMA-262.
#[inline]
pub fn is_identifier_start(c: u32) -> bool {
    is_id_start(c) || c == u32::from(b'$') || c == u32::from(b'_')
}

/// IdentifierPartChar of ECMA-262.
#[inline]
pub fn is_identifier_part(c: u32) -> bool {
    is_id_continue(c) || c == u32::from(b'$')
}
