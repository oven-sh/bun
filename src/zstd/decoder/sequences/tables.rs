//! The decoding tables for sequences.

use bun_highway::with_bmi2;

use crate::array::{At, in_range};
use crate::bits::Width;
use crate::bounded::Bounded;
use crate::error::{Error, Result};
use crate::format::{
    CodeKind, DEFAULT_LITERAL_LENGTHS, DEFAULT_MATCH_LENGTHS, DEFAULT_OFFSETS, Distribution,
    LITERAL_LENGTH_BASES, LITERAL_LENGTH_BITS, LITERAL_LENGTH_TABLE_LOG_MAX, MATCH_LENGTH_BASES,
    MATCH_LENGTH_BITS, MATCH_LENGTH_TABLE_LOG_MAX, MAX_LITERAL_LENGTH_CODE, MAX_MATCH_LENGTH_CODE,
    MAX_OFFSET_CODE, MIN_MATCH, OFFSET_TABLE_LOG_MAX,
};
use crate::fse::{Spread, read_counts};

/// More bits than a reader ever has, so that it goes on with care.
const NEEDS_CARE: u8 = 128;

#[derive(Clone, Copy)]
#[repr(C, align(8))]
pub(super) struct LengthRow {
    /// Of both kinds, plus [`NEEDS_CARE`] if the length may not fit in 16 bits.
    pub(super) total_bits: u8,
    pub(super) state_bits: Width,
    pub(super) extra_bits: Width,
    /// To which `state_bits` are added.
    pub(super) next: u16,
    /// To which `extra_bits` are added: the low bits of [`Self::full_base`].
    pub(super) base: u16,
}

#[derive(Clone, Copy)]
#[repr(C, align(8))]
pub(super) struct OffsetRow {
    /// Of both kinds, plus [`NEEDS_CARE`] if the offset may not fit in 31 bits.
    pub(super) total_bits: u8,
    pub(super) state_bits: Width,
    pub(super) extra_bits: Width,
    pub(super) next: u8,
    /// The sum is -2, -1 or 0 for a repeated offset.
    pub(super) base: i32,
}

impl LengthRow {
    const EMPTY: Self = Self::of_code(0, 0);

    const fn of_code(base: u32, extra_bits: u8) -> Self {
        Self {
            total_bits: extra_bits + if extra_bits >= 15 { NEEDS_CARE } else { 0 },
            state_bits: Width::W0,
            extra_bits: Width::new(extra_bits as u32),
            next: 0,
            base: base as u16,
        }
    }

    pub(super) fn full_base(self) -> u32 {
        u32::from(self.base) | (self.extra_bits as u32 & 16) << 12
    }
}

impl OffsetRow {
    const EMPTY: Self = Self {
        base: 0,
        ..Self::of_code(0)
    };

    const fn of_code(code: u8) -> Self {
        Self {
            total_bits: code + if code == 31 { NEEDS_CARE } else { 0 },
            state_bits: Width::W0,
            extra_bits: Width::new(code as u32),
            next: 0,
            base: ((1i64 << code) - 3) as i32,
        }
    }
}

const CODES_MAX: usize = 64;

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const fn length_codes(len_min: u32, bases: &[u32], extra_bits: &[u8]) -> [LengthRow; CODES_MAX] {
    let (mut codes, mut code) = ([LengthRow::EMPTY; CODES_MAX], 0);
    while code < extra_bits.len() {
        codes[code] = LengthRow::of_code(len_min + bases[code], extra_bits[code]);
        code += 1;
    }
    codes
}

const LITERAL_LENGTH_CODES: [LengthRow; CODES_MAX] =
    length_codes(0, &LITERAL_LENGTH_BASES, &LITERAL_LENGTH_BITS);
const MATCH_LENGTH_CODES: [LengthRow; CODES_MAX] =
    length_codes(MIN_MATCH, &MATCH_LENGTH_BASES, &MATCH_LENGTH_BITS);
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const OFFSET_CODES: [OffsetRow; CODES_MAX] = {
    let (mut codes, mut code) = ([OffsetRow::EMPTY; _], 0);
    while code <= MAX_OFFSET_CODE {
        codes[code] = OffsetRow::of_code(code as u8);
        code += 1;
    }
    codes
};

impl CodeKind {
    fn max_code(self) -> usize {
        match self {
            Self::LiteralLength => MAX_LITERAL_LENGTH_CODE,
            Self::Offset => MAX_OFFSET_CODE,
            Self::MatchLength => MAX_MATCH_LENGTH_CODE,
        }
    }

    fn table_log_max(self) -> u32 {
        match self {
            Self::LiteralLength => LITERAL_LENGTH_TABLE_LOG_MAX,
            Self::Offset => OFFSET_TABLE_LOG_MAX,
            Self::MatchLength => MATCH_LENGTH_TABLE_LOG_MAX,
        }
    }
}

pub(super) const LENGTH_ROWS: usize = 1 << LITERAL_LENGTH_TABLE_LOG_MAX;
const _: () = assert!(LITERAL_LENGTH_TABLE_LOG_MAX == MATCH_LENGTH_TABLE_LOG_MAX);

/// One of each [`CodeKind`].
#[repr(C)]
pub(crate) struct SequenceTables {
    pub(super) literal_lengths: [LengthRow; LENGTH_ROWS],
    pub(super) match_lengths: [LengthRow; LENGTH_ROWS],
    pub(super) offsets: [OffsetRow; 1 << OFFSET_TABLE_LOG_MAX],
    logs: [u32; 3],
}

pub(crate) static PREDEFINED_TABLES: SequenceTables = {
    let mut tables = SequenceTables::EMPTY;
    tables.fill(CodeKind::LiteralLength, &DEFAULT_LITERAL_LENGTHS);
    tables.fill(CodeKind::Offset, &DEFAULT_OFFSETS);
    tables.fill(CodeKind::MatchLength, &DEFAULT_MATCH_LENGTHS);
    tables
};

#[inline(always)]
const fn first_rows<T>(rows: &mut [T], log: u32) -> &mut [T] {
    match rows.split_at_mut_checked(1 << log) {
        Some((rows, _)) => rows,
        None => &mut [],
    }
}

impl SequenceTables {
    pub(crate) const EMPTY: Self = Self {
        literal_lengths: [LengthRow::EMPTY; _],
        match_lengths: [LengthRow::EMPTY; _],
        offsets: [OffsetRow::EMPTY; _],
        logs: [0; _],
    };

    #[inline(always)]
    pub(super) fn log(&self, kind: CodeKind) -> u32 {
        *self.logs.at(kind as usize)
    }

    #[inline(always)]
    #[expect(clippy::indexing_slicing, reason = "below the lengths")]
    const fn fill(&mut self, kind: CodeKind, distribution: &Distribution<'_>) {
        let log = distribution.table_log;
        self.logs[kind as usize] = log;
        let mut states = Spread::<{ LENGTH_ROWS + 8 }, CODES_MAX>::EMPTY;
        states.fill(distribution.counts, log);
        macro_rules! fill {
            ($rows:expr, $codes:expr) => {{
                let mut rows = first_rows($rows, log);
                while let [row, rest @ ..] = rows {
                    let state = states.next_state();
                    *row = $codes[in_range::<CODES_MAX>(state.symbol as usize)];
                    row.total_bits = row.total_bits.plus(state.bits as u8);
                    row.state_bits = Width::new(state.bits);
                    row.next = state.baseline as _;
                    rows = rest;
                }
            }};
        }
        let (rows, codes) = match kind {
            CodeKind::LiteralLength => (&mut self.literal_lengths, &LITERAL_LENGTH_CODES),
            CodeKind::MatchLength => (&mut self.match_lengths, &MATCH_LENGTH_CODES),
            CodeKind::Offset => return fill!(&mut self.offsets, &OFFSET_CODES),
        };
        fill!(rows, codes);
    }

    /// From the description at the start of `src`, whose length it returns.
    pub(crate) fn read(&mut self, kind: CodeKind, src: &[u8]) -> Result<usize> {
        with_bmi2(
            #[inline(always)]
            || {
                let mut counts = [0; CODES_MAX];
                let allowed = counts.get_mut(..=kind.max_code());
                let description = read_counts(src, allowed.ok_or(Error::Internal)?)?;
                if description.table_log > kind.table_log_max() {
                    return Err(Error::CorruptionDetected);
                }
                let distribution = Distribution {
                    counts: (counts.get(..=description.max_symbol)).ok_or(Error::Internal)?,
                    table_log: description.table_log,
                };
                self.fill(kind, &distribution);
                Ok(description.len)
            },
        )
    }

    /// For sequences that all have `code`.
    pub(crate) fn set_rle(&mut self, kind: CodeKind, code: u8) -> Result<()> {
        let code = usize::from(code);
        if code > kind.max_code() {
            return Err(Error::CorruptionDetected);
        }
        *self.logs.at_mut(kind as usize) = 0;
        match kind {
            CodeKind::LiteralLength => self.literal_lengths[0] = *LITERAL_LENGTH_CODES.at(code),
            CodeKind::Offset => self.offsets[0] = *OFFSET_CODES.at(code),
            CodeKind::MatchLength => self.match_lengths[0] = *MATCH_LENGTH_CODES.at(code),
        }
        Ok(())
    }

    pub(crate) fn copy_from(&mut self, other: &Self, kind: CodeKind) {
        fn copy<T: Copy>(from: &[T], to: &mut [T], len: usize) {
            to.iter_mut()
                .zip(from)
                .take(len)
                .for_each(|(to, from)| *to = *from);
        }

        let log = other.log(kind);
        *self.logs.at_mut(kind as usize) = log;
        match kind {
            CodeKind::LiteralLength => {
                copy(&other.literal_lengths, &mut self.literal_lengths, 1 << log)
            }
            CodeKind::Offset => copy(&other.offsets, &mut self.offsets, 1 << log),
            CodeKind::MatchLength => copy(&other.match_lengths, &mut self.match_lengths, 1 << log),
        }
    }

    /// Whether so many matches are out of the cache that it pays to ask for them ahead of time.
    pub(super) fn has_many_far_offsets(&self) -> bool {
        let log = self.log(CodeKind::Offset);
        let rows = self.offsets.iter().take(1 << log);
        let far = rows.map(|row| usize::from(row.extra_bits as u32 > 22));
        let far = far.fold(0, usize::plus);
        far << (OFFSET_TABLE_LOG_MAX - log) >= 7
    }
}
