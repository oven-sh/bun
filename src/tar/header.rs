//! The 512-byte header block.

use crate::num::parse_field;
use bun_core::strings;

pub(crate) type Block = [u8; 512];

pub(crate) fn name(h: &Block) -> &[u8] {
    &h[0..100]
}
pub(crate) fn mode(h: &Block) -> i64 {
    parse_field(&h[100..108])
}
pub(crate) fn size(h: &Block) -> i64 {
    parse_field(&h[124..136])
}
pub(crate) fn mtime(h: &Block) -> i64 {
    parse_field(&h[136..148])
}
pub(crate) fn typeflag(h: &Block) -> u8 {
    h[156]
}
pub(crate) fn linkname(h: &Block) -> &[u8] {
    &h[157..257]
}
/// `magic` and `version` together.
pub(crate) fn magic(h: &Block) -> &[u8] {
    &h[257..265]
}
pub(crate) fn prefix(h: &Block) -> &[u8] {
    &h[345..500]
}

/// The GNU header reuses the `prefix` area.
pub(crate) mod gnu {
    use super::Block;

    pub(crate) const MAGIC: &[u8; 8] = b"ustar  \0";

    pub(crate) fn sparse(h: &Block) -> &[u8] {
        &h[386..482]
    }
    pub(crate) fn is_extended(h: &Block) -> bool {
        h[482] != 0
    }
    pub(crate) fn real_size(h: &Block) -> &[u8] {
        &h[483..495]
    }
    /// A block of 21 more sparse entries.
    pub(crate) fn extension_sparse(h: &Block) -> &[u8] {
        &h[0..504]
    }
    pub(crate) fn extension_is_extended(h: &Block) -> bool {
        h[504] != 0
    }
}

pub(crate) fn is_null(h: &Block) -> bool {
    strings::index_of_not_char(h, 0).is_none()
}

/// Old BSD, Solaris and HP-UX tars summed signed bytes, so either sum is accepted.
pub(crate) fn checksum_ok(h: &Block) -> bool {
    let field = &h[148..156];
    if !field.iter().all(|c| matches!(c, b' ' | 0 | b'0'..=b'7')) {
        return false;
    }
    let expected = parse_field(field);
    let sum = |bytes: &[u8]| bytes.iter().map(|&b| u32::from(b)).sum::<u32>();
    // The field itself counts as eight spaces.
    let unsigned = i64::from(sum(h) - sum(field) + 8 * 32);
    if expected == unsigned {
        return true;
    }
    let negative = h.iter().filter(|&&b| b >= 128).count() as i64;
    expected == unsigned - 256 * negative
}

fn number_field_looks_valid(field: &[u8]) -> bool {
    if matches!(field.first(), Some(128 | 255 | 0)) {
        return true;
    }
    let rest = strings::trim_leading_char(field, b' ');
    let digits = rest
        .iter()
        .position(|c| !matches!(c, b'0'..=b'7'))
        .unwrap_or(rest.len());
    rest.iter().skip(digits).all(|c| matches!(c, b' ' | 0))
}

// https://github.com/libarchive/libarchive/blob/27cbc7827172698143e440801fc0ba39ccb4f1f5/libarchive/archive_read_support_format_tar.c#L393
/// How sure we are that `h` starts a tar archive, in bits verified. Zero means it does not.
pub(crate) fn bid(h: &Block) -> u32 {
    if is_null(h) {
        return 10;
    }
    if !checksum_ok(h) {
        return 0;
    }
    let mut bid = 48;
    if magic(h) == b"ustar\x0000" || magic(h) == gnu::MAGIC {
        bid += 56;
    }
    if !matches!(typeflag(h), 0 | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z') {
        return 0;
    }
    bid += 2;
    let fields = [
        &h[100..108],
        &h[108..116],
        &h[116..124],
        &h[136..148],
        &h[124..136],
        &h[329..337],
        &h[337..345],
    ];
    if !fields.into_iter().all(number_field_looks_valid) {
        return 0;
    }
    bid
}
