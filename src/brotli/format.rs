//! The numbers of RFC 7932 and of its large window extension (RFC 9841) that both directions need.

pub(crate) const LITERAL_SYMBOLS: usize = 256;
pub(crate) const COMMAND_SYMBOLS: usize = 704;
pub(crate) const BLOCK_LENGTH_SYMBOLS: usize = 26;
pub(crate) const MAX_BLOCK_TYPES: usize = 256;

pub(crate) const MAX_CODE_LENGTH: usize = 15;
pub(crate) const CODE_LENGTH_CODES: usize = 18;
pub(crate) const REPEAT_PREVIOUS_CODE_LENGTH: u8 = 16;
pub(crate) const REPEAT_ZERO_CODE_LENGTH: u8 = 17;
pub(crate) const INITIAL_REPEATED_CODE_LENGTH: u8 = 8;
pub(crate) const MAX_CODE_LENGTH_CODE_LENGTH: usize = 5;
pub(crate) const CODE_LENGTH_CODE_ORDER: [u8; CODE_LENGTH_CODES] =
    [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15];
/// The number of bits and their value, for each length that a code for code lengths may have.
pub(crate) const CODE_LENGTH_CODE_LENGTH_CODES: [(u8, u8); MAX_CODE_LENGTH_CODE_LENGTH + 1] =
    [(2, 0), (4, 7), (3, 3), (2, 2), (2, 1), (4, 15)];

/// Two for [`REPEAT_PREVIOUS_CODE_LENGTH`], three for [`REPEAT_ZERO_CODE_LENGTH`].
#[inline(always)]
pub(crate) const fn repeat_extra_bits(symbol: u32) -> u32 {
    symbol - 14
}

pub(crate) const MIN_WINDOW_BITS: u32 = 10;
pub(crate) const MAX_WINDOW_BITS: u32 = 24;
pub(crate) const LARGE_MAX_WINDOW_BITS: u32 = 30;
pub(crate) const WINDOW_GAP: usize = 16;

pub(crate) const DISTANCE_SHORT_CODES: u32 = 16;
/// Which of the last distances each short code refers to, and what it adds.
pub(crate) const SHORT_CODE_BASES: [u8; 16] = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
pub(crate) const SHORT_CODE_DELTAS: [i8; 16] =
    [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3];
pub(crate) const MAX_POSTFIX_BITS: u32 = 3;
pub(crate) const MAX_DIRECT_CODES: u32 = 15 << MAX_POSTFIX_BITS;
const MAX_DISTANCE_BITS: u32 = 24;
const LARGE_MAX_DISTANCE_BITS: u32 = 62;
pub(crate) const MAX_ALLOWED_DISTANCE: u32 = 0x7FFF_FFFC;
/// The last one first.
pub(crate) const INITIAL_DISTANCES: [u32; 4] = [4, 11, 15, 16];

pub(crate) const MAX_DICTIONARY_SIZE: usize = 1 << 30;
const _: () = assert!(
    max_backward_distance(LARGE_MAX_WINDOW_BITS) + MAX_DICTIONARY_SIZE
        <= MAX_ALLOWED_DISTANCE as usize
);

pub(crate) const fn max_backward_distance(window_bits: u32) -> usize {
    (1 << window_bits) - WINDOW_GAP
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Alphabet {
    pub(crate) size: u32,
    /// Of a symbol in the description of a simple prefix code.
    pub(crate) symbol_bits: u32,
}

impl Alphabet {
    pub(crate) const LITERALS: Self = Self::new(LITERAL_SYMBOLS as u32);
    pub(crate) const COMMANDS: Self = Self::new(COMMAND_SYMBOLS as u32);
    pub(crate) const BLOCK_LENGTHS: Self = Self::new(BLOCK_LENGTH_SYMBOLS as u32);

    pub(crate) const fn new(size: u32) -> Self {
        Self {
            size,
            symbol_bits: (size - 1).bit_width(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct DistanceParams {
    pub(crate) postfix_bits: u32,
    pub(crate) direct_codes: u32,
    pub(crate) alphabet: Alphabet,
    pub(crate) max_distance: usize,
}

impl DistanceParams {
    pub(crate) const fn new(postfix_bits: u32, direct_codes: u32, large_window: bool) -> Self {
        let (alphabet, max_distance) = if large_window {
            let (size, max) = large_window_limits(postfix_bits, direct_codes);
            let nominal = alphabet(postfix_bits, direct_codes, LARGE_MAX_DISTANCE_BITS);
            (Alphabet { size, ..nominal }, max)
        } else {
            let max = direct_codes + (((1 << MAX_DISTANCE_BITS) - 1) << (postfix_bits + 2));
            (alphabet(postfix_bits, direct_codes, MAX_DISTANCE_BITS), max)
        };
        Self {
            postfix_bits,
            direct_codes,
            alphabet,
            max_distance: max_distance as usize,
        }
    }
}

const fn alphabet(postfix_bits: u32, direct_codes: u32, max_distance_bits: u32) -> Alphabet {
    Alphabet::new(DISTANCE_SHORT_CODES + direct_codes + (max_distance_bits << (postfix_bits + 1)))
}

/// The alphabet size and the largest distance of the whole groups of codes within [`MAX_ALLOWED_DISTANCE`].
const fn large_window_limits(postfix_bits: u32, direct_codes: u32) -> (u32, u32) {
    let offset = ((MAX_ALLOWED_DISTANCE - direct_codes) >> postfix_bits) + 4;
    let bits = offset.ilog2() - 1;
    let forbidden_group = ((bits - 1) << 1) | ((offset >> bits) & 1);
    let group = forbidden_group - 1;
    let bits = (group >> 1) + 1;
    let start = (1 << (bits + 1)) - 4 + ((group & 1) << bits);
    let postfix = (1 << postfix_bits) - 1;
    (
        ((group << postfix_bits) | postfix) + direct_codes + DISTANCE_SHORT_CODES + 1,
        ((start + (1 << bits) - 1) << postfix_bits) + postfix + direct_codes + 1,
    )
}

/// A symbol for the values in `base..base + (1 << extra_bits)`.
#[derive(Clone, Copy)]
pub(crate) struct LengthCode {
    pub(crate) base: u16,
    pub(crate) extra_bits: u8,
}

#[allow(clippy::indexing_slicing)] // Runs at compile time.
const fn length_codes<const N: usize>(first: u16, extra_bits: [u8; N]) -> [LengthCode; N] {
    let mut codes = [LengthCode {
        base: first,
        extra_bits: extra_bits[0],
    }; N];
    let mut i = 1;
    while i < N {
        codes[i] = LengthCode {
            base: codes[i - 1].base + (1 << extra_bits[i - 1]),
            extra_bits: extra_bits[i],
        };
        i += 1;
    }
    codes
}

pub(crate) const BLOCK_LENGTH_CODES: [LengthCode; BLOCK_LENGTH_SYMBOLS] = length_codes(
    1,
    [
        2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24,
    ],
);

pub(crate) const INSERT_LENGTH_CODES: [LengthCode; 24] = length_codes(
    0,
    [
        0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
    ],
);

pub(crate) const COPY_LENGTH_CODES: [LengthCode; 24] = length_codes(
    2,
    [
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
    ],
);

/// The command symbols before it use the last distance.
pub(crate) const FIRST_COMMAND_WITH_DISTANCE: usize = 128;
/// Only the copies below it have such symbols.
pub(crate) const SHORT_COPY_END: usize = COPY_LENGTH_CODES[16].base as usize;

/// Indexes into [`INSERT_LENGTH_CODES`] and [`COPY_LENGTH_CODES`].
pub(crate) struct CommandCodes {
    pub(crate) insert: usize,
    pub(crate) copy: usize,
}

impl CommandCodes {
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    pub(crate) const fn of(symbol: usize) -> Self {
        const INSERT: [usize; COMMAND_SYMBOLS / 64] = [0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16];
        const COPY: [usize; COMMAND_SYMBOLS / 64] = [0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16];
        let cell = symbol / 64;
        Self {
            insert: INSERT[cell] + symbol / 8 % 8,
            copy: COPY[cell] + symbol % 8,
        }
    }
}

/// Prefix codes are in the stream with their first bit lowest.
#[inline(always)]
#[allow(clippy::indexing_slicing)] // A `u8` into 256 entries.
pub(crate) const fn reverse_byte(byte: u8) -> u8 {
    static REVERSED: [u8; 256] = {
        let mut reversed = [0; 256];
        let mut i = 0;
        while i < 256 {
            reversed[i] = (i as u8).reverse_bits();
            i += 1;
        }
        reversed
    };
    REVERSED[byte as usize]
}
