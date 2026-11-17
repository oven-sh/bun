use bun_core::vec::BorrowedCursor;
pub use bun_highway::zlib::crc32;

const ADLER32_START: u32 = 1;

pub fn adler32(bytes: &[u8]) -> u32 {
    bun_highway::zlib::adler32(ADLER32_START, bytes)
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

    /// Goes by the copy, as a script may be writing to `bytes`.
    pub(crate) fn copy(&mut self, bytes: &[u8], out: &mut BorrowedCursor<'_, u8>) {
        out.with_unfilled_buf(|out| {
            out.unfilled().append(bytes);
            self.update(out.filled());
        });
    }

    #[inline]
    pub(crate) fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::None => {}
            Self::Adler32(adler) => *adler = bun_highway::zlib::adler32(*adler, bytes),
            Self::Crc32 { crc, len } => {
                *crc = crc32(*crc, bytes);
                *len = len.wrapping_add(bytes.len() as u32);
            }
        }
    }
}
