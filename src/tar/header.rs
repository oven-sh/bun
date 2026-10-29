//! The 512-byte header block.

use crate::num::parse_field;
use bun_core::strings;
use core::ops::Range;

pub(crate) const BLOCK_SIZE: usize = 512;
pub(crate) type Block = [u8; BLOCK_SIZE];

/// How many bytes fill the last block up behind `size` bytes.
pub(crate) fn padding_for(size: u64) -> u64 {
    size.wrapping_neg() % BLOCK_SIZE as u64
}

pub(crate) const NAME: Range<usize> = 0..100;
pub(crate) const MODE: Range<usize> = 100..108;
pub(crate) const UID: Range<usize> = 108..116;
pub(crate) const GID: Range<usize> = 116..124;
pub(crate) const SIZE: Range<usize> = 124..136;
pub(crate) const MTIME: Range<usize> = 136..148;
pub(crate) const CHECKSUM: Range<usize> = 148..156;
pub(crate) const TYPEFLAG: usize = 156;
pub(crate) const LINKNAME: Range<usize> = 157..257;
/// `magic` and `version` together.
pub(crate) const MAGIC: Range<usize> = 257..265;
pub(crate) const DEVMAJOR: Range<usize> = 329..337;
pub(crate) const DEVMINOR: Range<usize> = 337..345;
pub(crate) const PREFIX: Range<usize> = 345..500;

pub(crate) const USTAR_MAGIC: &[u8; 8] = b"ustar\x0000";

pub(crate) fn name(h: &Block) -> &[u8] {
    &h[NAME]
}
pub(crate) fn mode(h: &Block) -> i64 {
    parse_field(&h[MODE])
}
pub(crate) fn size(h: &Block) -> i64 {
    parse_field(&h[SIZE])
}
pub(crate) fn mtime(h: &Block) -> i64 {
    parse_field(&h[MTIME])
}
pub(crate) fn typeflag(h: &Block) -> u8 {
    h[TYPEFLAG]
}
pub(crate) fn linkname(h: &Block) -> &[u8] {
    &h[LINKNAME]
}
pub(crate) fn magic(h: &Block) -> &[u8] {
    &h[MAGIC]
}
pub(crate) fn prefix(h: &Block) -> &[u8] {
    &h[PREFIX]
}

/// The GNU header reuses the `prefix` area.
pub(crate) mod gnu {
    use super::Block;
    use core::ops::Range;

    pub(crate) const MAGIC: &[u8; 8] = b"ustar  \0";

    /// An offset and a length.
    pub(crate) const SPARSE_ENTRY_SIZE: usize = 2 * SPARSE_NUMBER_SIZE;
    pub(crate) const SPARSE_NUMBER_SIZE: usize = 12;

    const SPARSE: Range<usize> = 386..482;
    const IS_EXTENDED: usize = 482;
    const REAL_SIZE: Range<usize> = 483..495;
    /// A block of 21 more sparse entries.
    const EXTENSION_SPARSE: Range<usize> = 0..504;
    const EXTENSION_IS_EXTENDED: usize = 504;

    pub(crate) fn sparse(h: &Block) -> &[u8] {
        &h[SPARSE]
    }
    pub(crate) fn is_extended(h: &Block) -> bool {
        h[IS_EXTENDED] != 0
    }
    pub(crate) fn real_size(h: &Block) -> &[u8] {
        &h[REAL_SIZE]
    }
    pub(crate) fn extension_sparse(h: &Block) -> &[u8] {
        &h[EXTENSION_SPARSE]
    }
    pub(crate) fn extension_is_extended(h: &Block) -> bool {
        h[EXTENSION_IS_EXTENDED] != 0
    }
}

pub(crate) fn is_null(h: &Block) -> bool {
    strings::index_of_not_char(h, 0).is_none()
}

/// Old BSD, Solaris and HP-UX tars summed signed bytes, so either sum is accepted.
pub(crate) fn checksum_ok(h: &Block) -> bool {
    let field = &h[CHECKSUM];
    if !field.iter().all(|c| matches!(c, b' ' | 0 | b'0'..=b'7')) {
        return false;
    }
    let expected = parse_field(field);
    let sum = |bytes: &[u8]| bytes.iter().map(|&b| u32::from(b)).sum::<u32>();
    // The field itself counts as spaces.
    let unsigned = i64::from(sum(h) - sum(field) + sum(&[b' '; CHECKSUM.end - CHECKSUM.start]));
    if expected == unsigned {
        return true;
    }
    let negative = h.iter().filter(|&&b| b.cast_signed() < 0).count() as i64;
    expected == unsigned - negative * (1 << u8::BITS)
}

fn number_field_looks_valid(field: &[u8]) -> bool {
    // Base-256, or empty.
    if matches!(field.first(), Some(0x80 | 0xff | 0)) {
        return true;
    }
    let rest = strings::trim_leading_char(field, b' ');
    let digits = rest
        .iter()
        .position(|c| !matches!(c, b'0'..=b'7'))
        .unwrap_or(rest.len());
    rest.iter().skip(digits).all(|c| matches!(c, b' ' | 0))
}

pub(crate) fn has_magic(h: &Block) -> bool {
    magic(h) == USTAR_MAGIC || magic(h) == gnu::MAGIC
}

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read_support_format_tar.c#L393
/// Whether every field that can be checked holds what a header would.
pub(crate) fn is_plausible(h: &Block) -> bool {
    checksum_ok(h)
        && matches!(typeflag(h), 0 | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z')
        && [
            &h[MODE],
            &h[UID],
            &h[GID],
            &h[MTIME],
            &h[SIZE],
            &h[DEVMAJOR],
            &h[DEVMINOR],
        ]
        .into_iter()
        .all(number_field_looks_valid)
}
