use bun_core::vec::BorrowedCursor;
use bun_highway::checksums::{adler32, copy_and_adler32, copy_and_crc32, crc32};

const ADLER32_START: u32 = 1;
/// For more, glibc's `memcpy` may take `rep movsb`.
const MAX_COPIED_BY_VECTORS: usize = 2048;

// https://sourceware.org/bugzilla/show_bug.cgi?id=30994
fn append_long(bytes: &[u8], mut out: BorrowedCursor<'_, u8>) {
    let to = out.with_unfilled_buf(|buf| buf.filled().as_ptr().addr());
    if let 1..32 = to.wrapping_sub(bytes.as_ptr().addr()) % 4096 {
        for piece in bytes.chunks(MAX_COPIED_BY_VECTORS) {
            out.append(piece);
        }
    } else {
        out.append(bytes);
    }
}

/// What the trailer of a container is computed from.
#[derive(Clone, Copy)]
pub(crate) enum Checksum {
    None,
    Adler32(u32),
    /// `len` is modulo 2^32, like the field that holds it.
    Crc32 {
        crc: u32,
        len: u32,
    },
}

impl Checksum {
    pub(crate) const ZLIB: Self = Self::Adler32(ADLER32_START);
    pub(crate) const GZIP: Self = Self::Crc32 { crc: 0, len: 0 };

    pub(crate) fn add(&mut self, bytes: &[u8]) {
        match self {
            Self::None => {}
            Self::Adler32(adler) => *adler = adler32(*adler, bytes),
            Self::Crc32 { crc, len } => {
                *crc = crc32(*crc, bytes);
                *len = len.wrapping_add(bytes.len() as u32);
            }
        }
    }

    /// Goes by the copy, as a script may be writing to `bytes`.
    #[inline(always)]
    pub(crate) fn copy(&mut self, bytes: &[u8], mut out: BorrowedCursor<'_, u8>) {
        match self {
            Self::None if bytes.len() <= MAX_COPIED_BY_VECTORS => out.append(bytes),
            Self::None => append_long(bytes, out),
            Self::Adler32(adler) => *adler = copy_and_adler32(*adler, bytes, out),
            Self::Crc32 { crc, len } => {
                *crc = copy_and_crc32(*crc, bytes, out);
                *len = len.wrapping_add(bytes.len() as u32);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use bun_core::vec::BorrowedBuf;

    use super::*;

    #[test]
    fn long_pieces_are_appended_at_any_distance() {
        for distance in [8191, 8192, 8193, 8223, 8224] {
            let mut bytes: [u8; 14_000] = core::array::from_fn(|at| (at % 251) as u8);
            let (from, to) = bytes.split_at_mut(distance);
            let (from, mut out) = (from.split_at(5000).0, BorrowedBuf::from(to));
            append_long(from, out.unfilled());
            assert_eq!(out.filled(), from);
        }
    }
}
