//! 7.1. Context modes and context ID lookup for literals.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum ContextType {
    Lsb6 = 0,
    Msb6 = 1,
    Utf8 = 2,
    Signed = 3,
}

impl ContextType {
    pub(crate) const fn from_bits(bits: u8) -> Self {
        match bits & 3 {
            0 => Self::Lsb6,
            1 => Self::Msb6,
            2 => Self::Utf8,
            _ => Self::Signed,
        }
    }
}

/// What the last byte (`.0`) and the one before it (`.1`) each add to the context ID.
pub(crate) struct ContextLut([u8; 256], [u8; 256]);

impl ContextLut {
    #[inline(always)]
    #[allow(clippy::indexing_slicing, reason = "a u8 is in range of 256 elements")]
    pub(crate) fn context(&self, p1: u8, p2: u8) -> u8 {
        self.0[p1 as usize] | self.1[p2 as usize]
    }
}

#[inline(always)]
pub(crate) fn context_lut(mode: ContextType) -> &'static ContextLut {
    match mode {
        ContextType::Lsb6 => &LSB6,
        ContextType::Msb6 => &MSB6,
        ContextType::Utf8 => &UTF8,
        ContextType::Signed => &SIGNED,
    }
}

/// `Lut0` of the RFC for ASCII.
#[rustfmt::skip]
const UTF8_LAST_ASCII: [u8; 128] = [
     0,  0,  0,  0,  0,  0,  0,  0,  0,  4,  4,  0,  0,  4,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     8, 12, 16, 12, 12, 20, 12, 16, 24, 28, 12, 12, 32, 12, 36, 12,
    44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 32, 32, 24, 40, 28, 12,
    12, 48, 52, 52, 52, 48, 52, 52, 52, 48, 52, 52, 52, 52, 52, 48,
    52, 52, 52, 52, 52, 48, 52, 52, 52, 52, 52, 24, 12, 28, 12, 12,
    12, 56, 60, 60, 60, 56, 60, 60, 60, 56, 60, 60, 60, 60, 60, 56,
    60, 60, 60, 60, 60, 56, 60, 60, 60, 60, 60, 24, 12, 28, 12,  0,
];

/// `Lut2` of the RFC.
const fn signed_magnitude(byte: usize) -> u8 {
    match byte {
        0 => 0,
        1..=15 => 1,
        16..=63 => 2,
        64..=127 => 3,
        128..=191 => 4,
        192..=239 => 5,
        240..=254 => 6,
        _ => 7,
    }
}

#[allow(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const fn build(mode: ContextType) -> ContextLut {
    let mut lut = ContextLut([0; 256], [0; 256]);
    let mut i = 0usize;
    while i < 256 {
        let (last, before) = match mode {
            ContextType::Lsb6 => ((i & 63) as u8, 0),
            ContextType::Msb6 => ((i >> 2) as u8, 0),
            ContextType::Utf8 => (
                match i {
                    0..=127 => UTF8_LAST_ASCII[i],
                    128..=191 => (i & 1) as u8,
                    _ => 2 + (i & 1) as u8,
                },
                match i as u8 {
                    b'0'..=b'9' | b'A'..=b'Z' | 224..=255 => 2,
                    b'a'..=b'z' => 3,
                    b'!'..=b'~' => 1,
                    _ => 0,
                },
            ),
            ContextType::Signed => (signed_magnitude(i) << 3, signed_magnitude(i)),
        };
        lut.0[i] = last;
        lut.1[i] = before;
        i += 1;
    }
    lut
}

static LSB6: ContextLut = build(ContextType::Lsb6);
static MSB6: ContextLut = build(ContextType::Msb6);
static UTF8: ContextLut = build(ContextType::Utf8);
static SIGNED: ContextLut = build(ContextType::Signed);
