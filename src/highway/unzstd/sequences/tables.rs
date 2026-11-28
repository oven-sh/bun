//! The decoding tables. What the rows of the three states add up to is all that it takes to make out a sequence.

use core::mem::MaybeUninit;
use std::sync::Once;

/// In the order of their tables in a block.
pub(super) const LITERAL_LENGTH: usize = 0;
pub(super) const OFFSET: usize = 1;
pub(super) const MATCH_LENGTH: usize = 2;

const LOG_MAX: [u32; 3] = [9, 8, 9];
const ROWS_MAX: usize = 512;
const FIRST_ROW: [usize; 3] = [0, 2 * ROWS_MAX, ROWS_MAX];
pub const CODES_MAX: usize = 64;

/// How many bits a load has for the next sequence at least.
pub(super) const REFILLED: u32 = 56;
/// The lowest byte of a row has this, less all bits that it takes. Modulo 64, the sum is what a load has left.
const SPARE_BIAS: [u32; 3] = [64, REFILLED, 64];
const STATE_BITS_SHIFT: u32 = 8;
/// The low 16 bits of the address of the first row that may be next. Their sum has two more.
const NEXT_SHIFT: u32 = 16;
/// In its place, while a table is filled.
const RANK: u64 = 1 << NEXT_SHIFT;
const EXTRA_BITS_SHIFT: [u32; 3] = [34, 53, 43];
/// What is above the extra bits in a length.
const PREFIX_SHIFT: [u32; 3] = [39, 0, 48];
/// The sum is negative, or overflows at last, with more than `EXTRA_BITS_MAX` or a length of `LONG_LEN`.
const BUDGET_SHIFT: u32 = 58;
const EXTRA_BITS_MAX: u32 = REFILLED - LOG_MAX[0] - LOG_MAX[1] - LOG_MAX[2];
pub(super) const LONG_LEN: u32 = 2048;

/// A sum that leaves the offsets to repeat as they are.
pub(super) const FILLER: u64 = 1 << PREFIX_SHIFT[LITERAL_LENGTH];

/// By symbol: the part of a row that follows from it.
pub struct Codes {
    kind: usize,
    rows: [u64; CODES_MAX],
}

impl Codes {
    pub const OFFSETS: Self = {
        let (mut rows, mut code) = ([0; _], 0);
        while code < CODES_MAX {
            let bits = code as u32 % 32;
            rows[code] = Self::row(OFFSET, 0, bits, EXTRA_BITS_MAX.wrapping_sub(bits));
            code += 1;
        }
        Self { kind: OFFSET, rows }
    };

    pub const fn literal_lengths(bases: &[u32], extra_bits: &[u8]) -> Self {
        Self::lengths(LITERAL_LENGTH, 16, bases, extra_bits)
    }

    /// From the shortest on.
    pub const fn match_lengths(bases: &[u32], extra_bits: &[u8]) -> Self {
        Self::lengths(MATCH_LENGTH, 32, bases, extra_bits)
    }

    const fn lengths(kind: usize, prefixes: u32, bases: &[u32], extra_bits: &[u8]) -> Self {
        let (mut rows, mut code) = ([0; _], 0);
        while code < extra_bits.len() {
            let bits = extra_bits[code] as u32;
            let prefix = bases[code] >> bits;
            assert!(bits <= 16 && prefix < prefixes && prefix << bits == bases[code]);
            let is_long = (prefix + 1) << bits > LONG_LEN;
            let cost = if is_long { EXTRA_BITS_MAX + 1 } else { bits };
            rows[code] = Self::row(kind, prefix, bits, cost.wrapping_neg());
            code += 1;
        }
        while code < CODES_MAX {
            rows[code] = rows[0];
            code += 1;
        }
        Self { kind, rows }
    }

    const fn row(kind: usize, prefix: u32, extra_bits: u32, budget: u32) -> u64 {
        (SPARE_BIAS[kind] - extra_bits) as u64
            | (prefix as u64) << PREFIX_SHIFT[kind]
            | (budget as u64) << BUDGET_SHIFT
            | (extra_bits as u64) << EXTRA_BITS_SHIFT[kind]
    }
}

/// From the upper half of a row or a sum.
#[inline(always)]
pub(super) fn extra_bits_and_prefix(upper: u32, kind: usize) -> (u32, u32) {
    let prefix = match kind {
        OFFSET => 1,
        LITERAL_LENGTH => (upper >> (PREFIX_SHIFT[kind] - 32)) % 16,
        _ => (upper >> (PREFIX_SHIFT[kind] - 32)) % 32,
    };
    ((upper >> (EXTRA_BITS_SHIFT[kind] - 32)) % 32, prefix)
}

#[inline(always)]
pub(super) fn state_bits(row: u64) -> u32 {
    u32::from((row >> STATE_BITS_SHIFT) as u8)
}

/// To which the bits for the state are added.
#[inline(always)]
pub(super) fn next_state(row: u64) -> usize {
    (row >> (NEXT_SHIFT + 3)) as usize % ROWS_MAX
}

/// One of each kind. The first `1 << log` rows of each are set, and lead to none but these. Their addresses differ in 12 bits.
#[repr(C, align(4096))]
pub struct Tables {
    rows: [MaybeUninit<u64>; 2 * ROWS_MAX + ROWS_MAX / 2],
    logs: [u32; 3],
    /// The low bits of the address of the first row, as the rows have it.
    addresses: [u16; 3],
    /// Whether so many take two chunks that it pays to copy two for all.
    pub(super) has_long_matches: bool,
    /// Whether so many are out of the caches that it pays to ask for them ahead of time.
    pub(super) has_far_matches: bool,
}

/// From a code with a rank from 1 on in `log + 1` bits. As a float, that has the next state for a mantissa.
#[inline(always)]
fn finished_row(ranked: u64, log: u32, address: u16) -> u64 {
    const LARGE: f64 = (1u64 << (53 - NEXT_SHIFT)) as f64;
    const PER_BIT: u64 = (1 << STATE_BITS_SHIFT) - 1;
    let twice = f64::from_bits(ranked & (((2 << log) - 1) * RANK) | LARGE.to_bits()) - LARGE;
    // This only changes 0.
    let float = twice.to_bits() | 2f64.to_bits();
    let next = float >> (52 - 3 - NEXT_SHIFT - log) & (((8 << log) - 1) * RANK);
    let fixed = (1024 + log) as u64 * PER_BIT + address as u64 * RANK;
    (ranked & !(0xFFFF * RANK) | next).wrapping_add(fixed.wrapping_sub((float >> 52) * PER_BIT))
}

impl Tables {
    /// With little written.
    pub fn allocate() -> Option<Box<Self>> {
        let mut tables = Box::try_new_uninit().ok()?;
        Self::clear(&mut tables);
        // SAFETY: just now.
        Some(unsafe { tables.assume_init() })
    }

    /// As the first caller `fill`s them.
    #[inline]
    pub fn shared(fill: fn(&mut Self)) -> &'static Self {
        static IS_FILLED: Once = Once::new();
        static mut TABLES: MaybeUninit<Tables> = MaybeUninit::uninit();
        let tables = &raw mut TABLES;
        // SAFETY: nothing refers to them yet.
        IS_FILLED.call_once(|| fill(Self::clear(unsafe { &mut *tables })));
        // SAFETY: nothing changes them any more.
        unsafe { (*tables).assume_init_ref() }
    }

    fn clear(tables: &mut MaybeUninit<Self>) -> &mut Self {
        let at = tables.as_mut_ptr();
        // SAFETY: none of the fields has to be dropped, and the rows may be anything.
        let tables = unsafe {
            (*at).logs = [0; _];
            (*at).addresses = [0; _];
            (*at).has_long_matches = false;
            (*at).has_far_matches = false;
            tables.assume_init_mut()
        };
        for row in FIRST_ROW {
            tables.rows[row].write(0);
        }
        tables
    }

    #[inline(always)]
    pub(super) fn log(&self, kind: usize) -> u32 {
        self.logs[kind]
    }

    #[inline(always)]
    pub(super) fn first_row(&self, kind: usize) -> *const u64 {
        self.rows.as_ptr().wrapping_add(FIRST_ROW[kind]).cast()
    }

    /// Whether the rows know where they are.
    #[inline(always)]
    pub(super) fn is_settled(&self, kind: usize) -> bool {
        self.addresses[kind] == self.first_row(kind).addr() as u16
    }

    /// All are to be set, for the address.
    #[inline(always)]
    fn rows_for(&mut self, kind: usize, log: u32) -> (&mut [MaybeUninit<u64>], u16) {
        assert!(log <= LOG_MAX[kind]);
        let address = self.first_row(kind).addr() as u16;
        (self.logs[kind], self.addresses[kind]) = (log, address);
        (&mut self.rows[FIRST_ROW[kind]..][..1 << log], address)
    }

    /// State `i` has symbol `symbols[i * stride]`, modulo the size of the table. `counts` say how many have each.
    #[inline(always)]
    pub fn fill(
        &mut self,
        codes: &Codes,
        log: u32,
        counts: &[i16; CODES_MAX],
        (symbols, stride): (&[u8; ROWS_MAX + 64], usize),
    ) {
        // One row of a small table says little.
        let ignored = i16::from(log <= 6);
        let have_one_in = |share: u32, counts: &[i16]| {
            let rows = counts.iter().map(|&it| (it.max(ignored) - ignored) as u32);
            (share * rows.sum::<u32>()) >> log != 0
        };
        match codes.kind {
            // From 33 to 66.
            MATCH_LENGTH => self.has_long_matches = have_one_in(24, &counts[30..40]),
            OFFSET => self.has_far_matches = have_one_in(16, &counts[20..32]),
            _ => {}
        }
        assert!(log != 0);
        let (rows, address) = self.rows_for(codes.kind, log);
        // From both ends, as rows with the same symbol wait for each other.
        let ranked = |code: usize, factor, offset| {
            let rank = factor * u64::from(counts[code].unsigned_abs() % 1024) + offset;
            codes.rows[code] | rank << NEXT_SHIFT
        };
        let mut upwards: [_; CODES_MAX] = core::array::from_fn(|code| ranked(code, 1, 0));
        let mut downwards: [_; CODES_MAX] = core::array::from_fn(|code| ranked(code, 2, 1023));
        let mask = (rows.len() - 1) % ROWS_MAX;
        let (mut rest, mut index) = (&mut *rows, 0usize);
        while let [first, middle @ .., last] = rest {
            let ranked = &mut upwards[symbols[index & mask] as usize % CODES_MAX];
            first.write(*ranked);
            *ranked = ranked.wrapping_add(RANK);
            index = index.wrapping_add(stride);
            let ranked = &mut downwards[symbols[index.wrapping_neg() & mask] as usize % CODES_MAX];
            last.write(*ranked);
            *ranked = ranked.wrapping_sub(RANK);
            rest = middle;
        }
        // SAFETY: they are an even number, so all are set.
        for row in unsafe { rows.assume_init_mut() } {
            *row = finished_row(*row, log, address);
        }
    }

    pub fn usual_match_len(&self) -> usize {
        let rows = &self.rows[FIRST_ROW[MATCH_LENGTH]..][..1 << self.logs[MATCH_LENGTH]];
        // SAFETY: they are set.
        let lens = unsafe { rows.assume_init_ref() }.iter().map(|&row| {
            let (extra_bits, prefix) = extra_bits_and_prefix((row >> 32) as u32, MATCH_LENGTH);
            (2 * prefix + 1) << extra_bits.min(7)
        });
        3 + lens.sum::<u32>() as usize / (2 * rows.len())
    }

    /// For sequences that all have `code`.
    pub fn set_only(&mut self, codes: &Codes, code: usize) {
        let (rows, address) = self.rows_for(codes.kind, 0);
        rows[0].write(codes.rows[code % CODES_MAX] | u64::from(address) << NEXT_SHIFT);
    }
}
