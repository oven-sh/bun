//! RFC 7932 sections 7.1 and 7.2: the contexts of literals and of distances.

use crate::format::LengthCode;

pub(crate) const LITERAL_CONTEXT_BITS: u32 = 6;
pub(crate) const LITERAL_CONTEXTS: usize = 1 << LITERAL_CONTEXT_BITS;
pub(crate) const DISTANCE_CONTEXT_BITS: u32 = 2;
pub(crate) const DISTANCE_CONTEXTS: usize = 1 << DISTANCE_CONTEXT_BITS;

#[derive(Clone, Copy)]
pub(crate) enum ContextMode {
    Lsb6,
    Msb6,
    Utf8,
    Signed,
}

impl ContextMode {
    pub(crate) fn from_bits(bits: u32) -> Self {
        match bits & 3 {
            0 => Self::Lsb6,
            1 => Self::Msb6,
            2 => Self::Utf8,
            _ => Self::Signed,
        }
    }

    pub(crate) fn lut(self) -> &'static ContextLut {
        static LSB6: ContextLut = ContextLut::new(ContextMode::Lsb6);
        static MSB6: ContextLut = ContextLut::new(ContextMode::Msb6);
        static UTF8: ContextLut = ContextLut::new(ContextMode::Utf8);
        static SIGNED: ContextLut = ContextLut::new(ContextMode::Signed);
        match self {
            Self::Lsb6 => &LSB6,
            Self::Msb6 => &MSB6,
            Self::Utf8 => &UTF8,
            Self::Signed => &SIGNED,
        }
    }
}

pub(crate) struct ContextLut {
    last: [u8; 256],
    second_last: [u8; 256],
}

impl ContextLut {
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    const fn new(mode: ContextMode) -> Self {
        let mut lut = Self {
            last: [0; 256],
            second_last: [0; 256],
        };
        let mut i = 0;
        while i < 256 {
            let byte = i as u8;
            (lut.last[i], lut.second_last[i]) = match mode {
                ContextMode::Lsb6 => (byte & 0x3F, 0),
                ContextMode::Msb6 => (byte >> 2, 0),
                ContextMode::Utf8 => (utf8_last(byte), utf8_second_last(byte)),
                ContextMode::Signed => (signed(byte) << 3, signed(byte)),
            };
            i += 1;
        }
        lut
    }

    /// What `byte` adds to the context of the next literal, and to that of the one after it.
    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
    pub(crate) fn parts(&self, byte: u8) -> [u8; 2] {
        let byte = usize::from(byte);
        [self.last[byte], self.second_last[byte]]
    }

    /// In `0..LITERAL_CONTEXTS`.
    #[inline(always)]
    #[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
    pub(crate) fn context(&self, last: u8, second_last: u8) -> usize {
        let context = self.last[usize::from(last)] | self.second_last[usize::from(second_last)];
        usize::from(context)
    }
}

const fn utf8_last(byte: u8) -> u8 {
    match byte {
        b'\t' | b'\n' | b'\r' => 4,
        0..=0x1F | 0x7F => 0,
        b' ' => 8,
        b'"' | b'\'' => 16,
        b'%' => 20,
        b'(' | b'<' | b'[' | b'{' => 24,
        b')' | b'>' | b']' | b'}' => 28,
        b',' | b':' | b';' => 32,
        b'.' => 36,
        b'=' => 40,
        b'0'..=b'9' => 44,
        b'A' | b'E' | b'I' | b'O' | b'U' => 48,
        b'B'..=b'Z' => 52,
        b'a' | b'e' | b'i' | b'o' | b'u' => 56,
        b'b'..=b'z' => 60,
        0x80..=0xBF => byte & 1,
        0xC0..=0xFF => 2 + (byte & 1),
        _ => 12,
    }
}

const fn utf8_second_last(byte: u8) -> u8 {
    match byte {
        0..=b' ' | 0x7F..=0xDF => 0,
        b'0'..=b'9' | b'A'..=b'Z' | 0xE0..=0xFF => 2,
        b'a'..=b'z' => 3,
        _ => 1,
    }
}

const fn signed(byte: u8) -> u8 {
    match byte {
        0 => 0,
        1..=15 => 1,
        16..=63 => 2,
        64..=127 => 3,
        128..=191 => 4,
        192..=239 => 5,
        240..=254 => 6,
        255 => 7,
    }
}

pub(crate) const fn distance_context(copy: LengthCode) -> u8 {
    if copy.base > 4 {
        3
    } else {
        copy.base as u8 - 2
    }
}
