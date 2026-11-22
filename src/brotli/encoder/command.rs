//! How a command is encoded (RFC 7932 sections 4 and 5).

use super::bit_writer::{Bits, Code};
use super::input_block::InputBlock;
use super::log2::log2_floor;
use super::matching::match_length;
use crate::context::{DISTANCE_CONTEXTS, distance_context};
use crate::format::{
    COMMAND_SYMBOLS, COPY_LENGTH_CODES, CommandCodes, DISTANCE_SHORT_CODES, DistanceParams,
    FIRST_COMMAND_WITH_DISTANCE, INSERT_LENGTH_CODES, LengthCode, MAX_CODE_LENGTH,
};
use crate::memory::{self, Result};

/// The code for each length below `N`.
pub(super) const fn codes_of_short_lengths<const N: usize>(codes: &[LengthCode; 24]) -> [u8; N] {
    let mut table = [0; N];
    let (mut length, mut code) = (0, 0);
    while length < N {
        if codes[code + 1].base as usize == length {
            code += 1;
        }
        table[length] = code as u8;
        length += 1;
    }
    table
}

#[inline(always)]
pub(super) fn insert_length_code(length: usize) -> usize {
    static SHORT: [u8; 130] = codes_of_short_lengths(&INSERT_LENGTH_CODES);
    if let Some(&code) = SHORT.get(length) {
        usize::from(code)
    } else if length < 2114 {
        log2_floor(length - 66) as usize + 10
    } else if length < 6210 {
        21
    } else if length < 22594 {
        22
    } else {
        23
    }
}

#[inline(always)]
pub(super) fn copy_length_code(length: usize) -> usize {
    static SHORT: [u8; 134] = codes_of_short_lengths(&COPY_LENGTH_CODES);
    if let Some(&code) = SHORT.get(length) {
        usize::from(code)
    } else if length < 2118 {
        log2_floor(length - 70) as usize + 12
    } else {
        23
    }
}

#[inline(always)]
pub(super) const fn combine_length_codes(
    insert: usize,
    copy: usize,
    use_last_distance: bool,
) -> u16 {
    static SYMBOLS: [[[u16; 32]; 32]; 2] = {
        let mut symbols = [[[0; 32]; 32]; 2];
        let mut symbol = COMMAND_SYMBOLS;
        while symbol > 0 {
            symbol -= 1;
            let CommandCodes { insert, copy } = CommandCodes::of(symbol);
            symbols[1][insert][copy] = symbol as u16;
            if symbol >= FIRST_COMMAND_WITH_DISTANCE {
                symbols[0][insert][copy] = symbol as u16;
            }
        }
        symbols
    };
    SYMBOLS[use_last_distance as usize][insert % 32][copy % 32]
}

#[derive(Clone, Copy)]
struct Meaning {
    insert_base: u16,
    copy_base: u16,
    insert_extra_bits: u8,
    copy_extra_bits: u8,
    distance_context: u8,
}

/// Of each command symbol.
static MEANINGS: [Meaning; COMMAND_SYMBOLS.next_power_of_two()] = {
    const fn meaning(insert: LengthCode, copy: LengthCode) -> Meaning {
        Meaning {
            insert_base: insert.base,
            copy_base: copy.base,
            insert_extra_bits: insert.extra_bits,
            copy_extra_bits: copy.extra_bits,
            distance_context: distance_context(copy),
        }
    }
    let mut meanings = [meaning(INSERT_LENGTH_CODES[0], COPY_LENGTH_CODES[0]); _];
    let mut symbol = 0;
    while symbol < COMMAND_SYMBOLS {
        let CommandCodes { insert, copy } = CommandCodes::of(symbol);
        meanings[symbol] = meaning(INSERT_LENGTH_CODES[insert], COPY_LENGTH_CODES[copy]);
        symbol += 1;
    }
    meanings
};

impl Meaning {
    const fn extra_bits(self) -> u32 {
        (self.insert_extra_bits + self.copy_extra_bits) as u32
    }

    const fn fits_one_code(self) -> bool {
        MAX_CODE_LENGTH as u32 + self.extra_bits() <= Bits::MAX_COUNT
    }
}

/// What moves the extra bits of the two lengths to the top of a word.
static MULTIPLIERS: [[u64; 2]; COMMAND_SYMBOLS.next_power_of_two()] = {
    const fn below(bits: u32) -> u64 {
        1u64.unbounded_shl(u64::BITS - bits)
    }
    let mut multipliers = [[0; 2]; _];
    let mut symbol = 0;
    while symbol < COMMAND_SYMBOLS {
        let meaning = MEANINGS[symbol];
        if meaning.fits_one_code() {
            let copy = meaning.copy_extra_bits as u32;
            multipliers[symbol] = [below(meaning.extra_bits()), below(copy)];
        }
        symbol += 1;
    }
    multipliers
};

/// What to prepend the codes to, for [`Command::with_lengths`].
pub(super) const ROOM_FOR_LENGTHS: [Code; COMMAND_SYMBOLS] = {
    let mut room = [Code::EMPTY; _];
    let mut symbol = 0;
    while symbol < COMMAND_SYMBOLS {
        let (meaning, [insert, copy]) = (MEANINGS[symbol], MULTIPLIERS[symbol]);
        if meaning.fits_one_code() {
            let bases = (insert.wrapping_mul(meaning.insert_base as u64))
                .wrapping_add(copy.wrapping_mul(meaning.copy_base as u64));
            room[symbol] = Code::new(meaning.extra_bits(), bases.wrapping_neg());
        }
        symbol += 1;
    }
    room
};

/// What to prepend the code to, for [`Command::with_distance`].
pub(super) const fn room_for_distance(params: &DistanceParams, symbol: u32) -> Code {
    match symbol.checked_sub(DISTANCE_SHORT_CODES + params.direct_codes) {
        Some(past) => Code::new(1 + (past >> (params.postfix_bits + 1)), 0),
        None => Code::EMPTY,
    }
}

#[inline(always)]
fn command_symbol(insert_length: usize, copy_length: usize, use_last_distance: bool) -> u16 {
    combine_length_codes(
        insert_length_code(insert_length),
        copy_length_code(copy_length),
        use_last_distance,
    )
}

pub(super) const DISTANCE_CODE_OFFSET: usize = DISTANCE_SHORT_CODES as usize - 1;

#[derive(Clone, Copy)]
pub(super) struct DistancePrefix {
    /// The symbol in the low 10 bits, and above it the number of extra bits.
    packed: u16,
    /// At the top.
    extra: u32,
}

impl DistancePrefix {
    /// `code` is a short code, or the distance plus [`DISTANCE_CODE_OFFSET`].
    #[inline(always)]
    pub(super) fn new(code: usize, params: &DistanceParams) -> Self {
        let first = (DISTANCE_SHORT_CODES + params.direct_codes) as usize;
        if code < first {
            return Self {
                packed: code as u16,
                extra: 0,
            };
        }
        match params.postfix_bits {
            0 => Self::past_direct_codes(code, first, 0),
            postfix_bits => Self::past_direct_codes(code, first, postfix_bits),
        }
    }

    #[inline(always)]
    fn past_direct_codes(code: usize, first: usize, postfix_bits: u32) -> Self {
        let distance = (1 << (postfix_bits + 2)) + (code - first);
        let postfix = distance & ((1 << postfix_bits) - 1);
        let bits = (log2_floor(distance) - 1 - postfix_bits) as usize;
        // 2 or 3 in the high half.
        let aligned = ((distance >> postfix_bits) as u64) << (32 - bits);
        let group = 2 * bits + (aligned >> 32) as usize - 4;
        Self {
            packed: ((bits << 10) | (first + (group << postfix_bits) + postfix)) as u16,
            extra: aligned as u32,
        }
    }

    #[inline(always)]
    pub(super) fn symbol(self) -> usize {
        usize::from(self.packed & 0x3FF)
    }

    #[inline(always)]
    pub(super) fn extra_bits(self) -> u32 {
        u32::from(self.packed >> 10)
    }

    /// The inverse of [`new`](Self::new).
    pub(super) fn code(self, params: &DistanceParams) -> usize {
        let first = (DISTANCE_SHORT_CODES + params.direct_codes) as usize;
        let Some(symbol) = self.symbol().checked_sub(first) else {
            return self.symbol();
        };
        let high = symbol >> params.postfix_bits;
        let low = symbol & ((1 << params.postfix_bits) - 1);
        let offset = ((2 + (high & 1)) << self.extra_bits()) - 4;
        let extra = self.extra >> (32 - self.extra_bits());
        ((offset + extra as usize) << params.postfix_bits) + low + first
    }
}

/// Literals, then a copy.
#[derive(Clone, Copy)]
pub(super) struct Command {
    insert_length: u32,
    /// The length in the low 25 bits, and above it what to add for the length in the stream.
    copy_length: u32,
    distance_extra: u32,
    symbol: u16,
    distance_prefix: u16,
}

impl Command {
    /// `coded_copy_length` differs from `copy_length` for a transformed word of the static dictionary.
    #[inline(always)]
    pub(super) fn new(
        params: &DistanceParams,
        insert_length: usize,
        copy_length: usize,
        coded_copy_length: usize,
        distance_code: usize,
    ) -> Self {
        let distance = DistancePrefix::new(distance_code, params);
        let delta = coded_copy_length.wrapping_sub(copy_length) as u32;
        Self {
            insert_length: insert_length as u32,
            copy_length: copy_length as u32 | (delta << 25),
            distance_extra: distance.extra,
            symbol: command_symbol(insert_length, coded_copy_length, distance_code == 0),
            distance_prefix: distance.packed,
        }
    }

    pub(super) fn insert_only(insert_length: usize) -> Self {
        Self {
            insert_length: insert_length as u32,
            copy_length: 4 << 25,
            distance_extra: 0,
            symbol: command_symbol(insert_length, 4, false),
            distance_prefix: DISTANCE_SHORT_CODES as u16,
        }
    }

    pub(super) fn extend_copy(&mut self, by: usize) {
        self.copy_length += by as u32;
        self.symbol = command_symbol(
            self.insert_length(),
            self.coded_copy_length(),
            self.distance().symbol() == 0,
        );
    }

    #[inline(always)]
    pub(super) fn insert_length(&self) -> usize {
        self.insert_length as usize
    }

    #[inline(always)]
    pub(super) fn copy_length(&self) -> usize {
        (self.copy_length & 0x1FF_FFFF) as usize
    }

    #[inline(always)]
    fn coded_copy_length(&self) -> usize {
        self.copy_length()
            .wrapping_add_signed((self.copy_length as i32 >> 25) as isize)
    }

    #[inline(always)]
    pub(super) fn symbol(&self) -> usize {
        usize::from(self.symbol)
    }

    #[inline(always)]
    pub(super) fn distance(&self) -> DistancePrefix {
        DistancePrefix {
            packed: self.distance_prefix,
            extra: self.distance_extra,
        }
    }

    pub(super) fn set_distance(&mut self, distance: DistancePrefix) {
        self.distance_prefix = distance.packed;
        self.distance_extra = distance.extra;
    }

    /// Whether the stream has a distance symbol for this command.
    #[inline(always)]
    pub(super) fn has_distance_symbol(&self) -> bool {
        self.copy_length() != 0 && self.symbol() >= FIRST_COMMAND_WITH_DISTANCE
    }

    #[inline(always)]
    fn meaning(&self) -> &'static Meaning {
        &MEANINGS[self.symbol() % MEANINGS.len()]
    }

    #[inline(always)]
    pub(super) fn distance_context(&self) -> usize {
        usize::from(self.meaning().distance_context) % DISTANCE_CONTEXTS
    }

    /// What [`with_lengths`](Self::with_lengths) leaves out.
    pub(super) fn separate_length_extra(&self) -> Option<Bits> {
        let meaning = self.meaning();
        if meaning.fits_one_code() {
            return None;
        }
        let insert = Bits::new(
            u32::from(meaning.insert_extra_bits),
            u64::from(self.insert_length - u32::from(meaning.insert_base)),
        );
        Some(insert.then(Bits::new(
            u32::from(meaning.copy_extra_bits),
            (self.coded_copy_length() - usize::from(meaning.copy_base)) as u64,
        )))
    }

    #[inline(always)]
    pub(super) fn with_lengths(&self, code: Code) -> Code {
        let [insert, copy] = MULTIPLIERS[self.symbol() % MULTIPLIERS.len()];
        // The product drops what is above the length.
        let coded = (self.copy_length).wrapping_add_signed(self.copy_length as i32 >> 25);
        code.plus(insert.wrapping_mul(u64::from(self.insert_length)))
            .plus(copy.wrapping_mul(u64::from(coded)))
    }

    #[inline(always)]
    pub(super) fn with_distance(&self, code: Code) -> Code {
        code.plus(u64::from(self.distance_extra) << 32)
    }
}

/// The commands of the meta-block that is not written yet.
pub(super) struct Commands {
    pub(super) list: Vec<Command>,
    pub(super) literal_count: usize,
    /// Literals after the last command.
    pub(super) pending_literals: usize,
    /// The latest first.
    pub(super) last_distances: [i32; 4],
}

impl Commands {
    pub(super) fn new(last_distances: [i32; 4]) -> Self {
        Self {
            list: Vec::new(),
            literal_count: 0,
            pending_literals: 0,
            last_distances,
        }
    }

    /// With some more, which tends to be enough for the next blocks.
    pub(super) fn try_reserve(&mut self, count: usize) -> Result<()> {
        if self.list.capacity() - self.list.len() < count {
            memory::try_reserve(&mut self.list, count + count / 2)?;
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn remember_distance(&mut self, distance: usize) {
        let [a, b, c, _] = self.last_distances;
        self.last_distances = [distance as i32, a, b, c];
    }

    pub(super) fn end_with_pending_literals(&mut self) {
        if self.pending_literals > 0 {
            self.list.push(Command::insert_only(self.pending_literals));
            self.literal_count += core::mem::take(&mut self.pending_literals);
        }
    }

    /// Returns how far the last copy goes on into `block`, which comes after `processed` bytes.
    pub(super) fn extend_last(&mut self, block: &InputBlock<'_>, processed: u64) -> usize {
        let Some(last) = self.list.last_mut().filter(|_| self.pending_literals == 0) else {
            return 0;
        };
        let distance = self.last_distances[0] as usize;
        let code = last.distance().code(&block.params.distance);
        if code > DISTANCE_CODE_OFFSET && code - DISTANCE_CODE_OFFSET != distance {
            return 0;
        }
        let copied = last.copy_length();
        let start = (processed - copied as u64).min(u64::from(u32::MAX)) as usize;
        let source = if distance <= block.max_backward(start) {
            Some(block.window.from(block.position - distance))
        } else {
            block
                .dictionary
                .and_then(|d| d.at_distance(distance, block.dictionary_end_distance(start)))
                .and_then(|source| source.get(copied..))
        };
        let data = block.data_from(block.position);
        let extension = source.map_or(0, |source| match_length(source, data));
        last.extend_copy(extension);
        extension
    }
}
