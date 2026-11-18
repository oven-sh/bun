use bun_core::vec::BorrowedCursor;
use bun_highway::checksums::{adler32, copy_and_adler32, copy_and_crc32, crc32};

const ADLER32_START: u32 = 1;

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
            Self::None => out.append(bytes),
            Self::Adler32(adler) => *adler = copy_and_adler32(*adler, bytes, out),
            Self::Crc32 { crc, len } => {
                *crc = copy_and_crc32(*crc, bytes, out);
                *len = len.wrapping_add(bytes.len() as u32);
            }
        }
    }
}
