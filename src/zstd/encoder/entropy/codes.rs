//! The sequences section.

use bun_highway::with_bmi2;
use bun_zstd_decoder::array::{At, get_or_allocate};
use bun_zstd_decoder::format::{
    CodeKind, DEFAULT_LITERAL_LENGTHS, DEFAULT_MATCH_LENGTHS, DEFAULT_OFFSETS, Distribution,
    Encoding, LITERAL_LENGTH_BITS, LITERAL_LENGTH_TABLE_LOG_MAX, LONG_SEQUENCE_COUNT,
    MATCH_LENGTH_BITS, MATCH_LENGTH_TABLE_LOG_MAX, MAX_OFFSET_CODE, OFFSET_TABLE_LOG_MAX,
};
use bun_zstd_decoder::{Error, Result};

use super::Reuse;
use super::bit_writer::BitWriter;
use super::fse::{self, Normalized, SYMBOLS, Shape};
use crate::bytes::put;
use crate::parameters::Strategy;
use crate::sequences::{CodeCounts, Sequence};

type Histogram = super::histogram::Histogram<SYMBOLS>;

/// `-log2(index / 256) * 256`
#[rustfmt::skip]
static INVERSE_PROBABILITY_LOG: [u16; 256] = [
    0, 2048, 1792, 1642, 1536, 1453, 1386, 1329, 1280, 1236, 1197, 1162, 1130, 1100, 1073, 1047,
    1024, 1001, 980, 960, 941, 923, 906, 889, 874, 859, 844, 830, 817, 804, 791, 779,
    768, 756, 745, 734, 724, 714, 704, 694, 685, 676, 667, 658, 650, 642, 633, 626,
    618, 610, 603, 595, 588, 581, 574, 567, 561, 554, 548, 542, 535, 529, 523, 517,
    512, 506, 500, 495, 489, 484, 478, 473, 468, 463, 458, 453, 448, 443, 438, 434,
    429, 424, 420, 415, 411, 407, 402, 398, 394, 390, 386, 382, 377, 373, 370, 366,
    362, 358, 354, 350, 347, 343, 339, 336, 332, 329, 325, 322, 318, 315, 311, 308,
    305, 302, 298, 295, 292, 289, 286, 282, 279, 276, 273, 270, 267, 264, 261, 258,
    256, 253, 250, 247, 244, 241, 239, 236, 233, 230, 228, 225, 222, 220, 217, 215,
    212, 209, 207, 204, 202, 199, 197, 194, 192, 190, 187, 185, 182, 180, 178, 175,
    173, 171, 168, 166, 164, 162, 159, 157, 155, 153, 151, 149, 146, 144, 142, 140,
    138, 136, 134, 132, 130, 128, 126, 123, 121, 119, 117, 115, 114, 112, 110, 108,
    106, 104, 102, 100, 98, 96, 94, 93, 91, 89, 87, 85, 83, 82, 80, 78,
    76, 74, 73, 71, 69, 67, 66, 64, 62, 61, 59, 57, 55, 54, 52, 50,
    49, 47, 46, 44, 42, 41, 39, 37, 36, 34, 33, 31, 30, 28, 26, 25,
    23, 22, 20, 19, 17, 16, 14, 13, 11, 10, 8, 7, 5, 4, 2, 1,
];

#[rustfmt::skip]
const OFFSET_BITS: [u8; MAX_OFFSET_CODE + 1] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
];

const fn padded(bits: &[u8]) -> [u8; SYMBOLS] {
    let mut padded = [0; SYMBOLS];
    padded.split_at_mut(bits.len()).0.copy_from_slice(bits);
    padded
}

/// Added to a code, makes it a symbol, which fits in a byte and which no other kind has.
pub(crate) const fn first_symbol(kind: CodeKind) -> usize {
    kind as usize * SYMBOLS
}

fn histogram(kind: CodeKind, counts: &CodeCounts) -> Histogram {
    let by_kind = counts.as_chunks().0.get(kind as usize);
    Histogram::new(*by_kind.unwrap_or(&[0; _]))
}

type Tables = fse::Tables<2048, 256>;

struct Alphabet {
    table_log_max: u32,
    predefined: Normalized,
    extra_bits: [u8; SYMBOLS],
}

impl Alphabet {
    const fn new(table_log_max: u32, predefined: &Distribution<'_>, extra_bits: &[u8]) -> Self {
        let predefined = Normalized::predefined(predefined);
        Self {
            table_log_max,
            predefined,
            extra_bits: padded(extra_bits),
        }
    }

    /// In bits.
    fn predefined_cost(&self, counts: &[u32]) -> Option<usize> {
        if counts.len() > self.predefined.max_symbol + 1 {
            return None;
        }
        let shift = 8 - self.predefined.table_log;
        let pairs = counts.iter().zip(self.predefined.counts);
        let cost = pairs.map(|(&count, share)| {
            let share = usize::from(share.unsigned_abs()) << shift;
            count * u32::from(*INVERSE_PROBABILITY_LOG.at(share))
        });
        Some((cost.sum::<u32>() >> 8) as usize)
    }

    /// In bits, with the description of the table.
    fn compressed_cost(&self, counts: &[u32], total: usize) -> Result<usize> {
        let log = fse::table_log_for(self.table_log_max, total, counts.len().saturating_sub(1), 2);
        let normalized = Normalized::new(counts, total, log, allows_less_than_1(total))?;
        let description_len = normalized.write(&mut [0; 128])?;
        let cost = counts.iter().map(|&count| {
            let share = (256 * count as usize / total).max(1);
            count * u32::from(*INVERSE_PROBABILITY_LOG.at(share))
        });
        Ok(description_len * 8 + (cost.sum::<u32>() >> 8) as usize)
    }
}

static ALPHABETS: [Alphabet; 3] = [
    Alphabet::new(
        LITERAL_LENGTH_TABLE_LOG_MAX,
        &DEFAULT_LITERAL_LENGTHS,
        &LITERAL_LENGTH_BITS,
    ),
    Alphabet::new(OFFSET_TABLE_LOG_MAX, &DEFAULT_OFFSETS, &OFFSET_BITS),
    Alphabet::new(
        MATCH_LENGTH_TABLE_LOG_MAX,
        &DEFAULT_MATCH_LENGTHS,
        &MATCH_LENGTH_BITS,
    ),
];

/// A table for each [`CodeKind`].
struct TableSet {
    tables: Tables,
    shapes: [Shape; 3],
}

impl TableSet {
    const EMPTY: Self = Self {
        tables: Tables::EMPTY,
        shapes: [Shape::EMPTY; 3],
    };

    fn copy_from(&mut self, other: &Self, kind: CodeKind) {
        let shape = *other.shapes.at(kind as usize);
        *self.shapes.at_mut(kind as usize) = shape;
        self.tables.copy_from(&other.tables, shape);
    }

    fn build(&mut self, kind: CodeKind, normalized: &Normalized) {
        *self.shapes.at_mut(kind as usize) = self.tables.build(kind as usize, normalized);
    }

    fn cost(&self, kind: CodeKind, counts: &[u32]) -> Option<usize> {
        self.tables.cost(*self.shapes.at(kind as usize), counts)
    }
}

static PREDEFINED: TableSet = {
    let [literal_lengths, offsets, match_lengths] = &ALPHABETS;
    let mut tables = Tables::EMPTY;
    let shapes = [
        tables.build(0, &literal_lengths.predefined),
        tables.build(1, &offsets.predefined),
        tables.build(2, &match_lengths.predefined),
    ];
    TableSet { tables, shapes }
};

/// Tables without such counts are faster to build, which small blocks notice.
fn allows_less_than_1(sequence_count: usize) -> bool {
    sequence_count >= 2048
}

/// How many bytes it takes to tell the number of sequences.
pub(crate) fn count_len(count: usize) -> usize {
    1 + usize::from(count >= 128) + usize::from(count >= LONG_SEQUENCE_COUNT)
}

/// Also checks that there is room for what has to follow.
pub(super) fn write_count(count: usize, out: &mut [u8]) -> Result<usize> {
    let [first, second, third, _] = out.first_chunk_mut().ok_or(Error::DstSizeTooSmall)?;
    let len = count_len(count);
    match len {
        1 => *first = count as u8,
        2 => [*first, *second] = (count as u16 + 0x8000).to_be_bytes(),
        _ => {
            *first = 0xFF;
            [*second, *third] = ((count - LONG_SEQUENCE_COUNT) as u16).to_le_bytes();
        }
    }
    Ok(len)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct CodesChoice([Encoding; 3]);

impl CodesChoice {
    pub(crate) const PREDEFINED: Self = Self([Encoding::Basic; 3]);
    const REPEATED: Self = Self([Encoding::Repeat; 3]);

    pub(super) fn modes(self) -> u8 {
        let [literal_lengths, offsets, match_lengths] = self.0.map(|encoding| encoding as u8);
        literal_lengths << 6 | offsets << 4 | match_lengths << 2
    }
}

pub(super) struct Chosen {
    pub(super) choice: CodesChoice,
    /// Of the descriptions of the tables.
    pub(super) len: usize,
    /// Of the description of the last compressed table.
    last_compressed_len: usize,
}

impl Chosen {
    const PREDEFINED: Self = Self {
        choice: CodesChoice::PREDEFINED,
        len: 0,
        last_compressed_len: 0,
    };

    /// https://github.com/facebook/zstd/pull/1146
    pub(super) fn trips_old_decoders(&self, stream_len: usize) -> bool {
        self.last_compressed_len != 0 && self.last_compressed_len + stream_len < 4
    }
}

/// More than the three can take.
const DESCRIPTIONS_LEN_MAX: usize = 160;

/// How sequences are going to be encoded.
pub(crate) struct CodesPlan {
    chosen: Chosen,
    descriptions: [u8; DESCRIPTIONS_LEN_MAX],
}

impl CodesPlan {
    pub(crate) fn choice(&self) -> CodesChoice {
        self.chosen.choice
    }

    pub(crate) fn has_descriptions(&self) -> bool {
        self.chosen.len != 0
    }
}

fn select(
    alphabet: &Alphabet,
    reuse: Reuse,
    repeated_cost: impl FnOnce(&[u32]) -> Option<usize>,
    histogram: &Histogram,
    total: usize,
    strategy: Strategy,
) -> Result<Encoding> {
    let counts = histogram.used();
    let allows_predefined = histogram.max_symbol <= alphabet.predefined.max_symbol;
    if histogram.largest_count == total {
        return Ok(if allows_predefined && total <= 2 {
            Encoding::Basic
        } else {
            Encoding::Rle
        });
    }
    if strategy < Strategy::Lazy {
        if allows_predefined {
            let log = alphabet.predefined.table_log;
            if reuse == Reuse::Always && total < 1000 {
                return Ok(Encoding::Repeat);
            }
            let min_total = ((10 - strategy as usize) << log) >> 3;
            if total < min_total || histogram.largest_count < total >> (log - 1) {
                return Ok(Encoding::Basic);
            }
        }
        return Ok(Encoding::Compressed);
    }
    let predefined = alphabet.predefined_cost(counts).unwrap_or(usize::MAX);
    let repeated = match reuse {
        Reuse::Never => None,
        _ => repeated_cost(counts),
    };
    let repeated = repeated.unwrap_or(usize::MAX);
    let compressed = alphabet.compressed_cost(counts, total)?;
    Ok(if predefined <= repeated && predefined <= compressed {
        Encoding::Basic
    } else if repeated <= compressed {
        Encoding::Repeat
    } else {
        Encoding::Compressed
    })
}

/// The tables that a decoder has, and those for the next block.
pub(crate) struct CodeTables {
    current: Option<Box<TableSet>>,
    next: Option<Box<TableSet>>,
    reuse: [Reuse; 3],
}

impl CodeTables {
    pub(super) const EMPTY: Self = Self {
        current: None,
        next: None,
        reuse: [Reuse::Never; 3],
    };

    pub(crate) fn reuse_mut(&mut self, kind: CodeKind) -> &mut Reuse {
        self.reuse.at_mut(kind as usize)
    }

    pub(crate) fn load(
        &mut self,
        kind: CodeKind,
        normalized: &Normalized,
        reuse: Reuse,
    ) -> Result<()> {
        get_or_allocate(&mut self.current, || TableSet::EMPTY)?.build(kind, normalized);
        *self.reuse_mut(kind) = reuse;
        Ok(())
    }

    /// See [`fse::Tables::max_bits`].
    pub(crate) fn max_bits(&self, kind: CodeKind, code: usize) -> u32 {
        let TableSet { tables, shapes } = self.current.as_deref().unwrap_or(&PREDEFINED);
        tables.max_bits(*shapes.at(kind as usize), code)
    }

    pub(super) fn copy_from(&mut self, other: &Self) -> Result<()> {
        if let Some(from) = &other.current {
            let to = get_or_allocate(&mut self.current, || TableSet::EMPTY)?;
            for kind in CodeKind::ALL {
                to.copy_from(from, kind);
            }
        }
        self.reuse = other.reuse;
        Ok(())
    }

    fn chosen(&self, choice: CodesChoice) -> &TableSet {
        let built = match choice {
            CodesChoice::PREDEFINED => None,
            CodesChoice::REPEATED => self.current.as_deref(),
            _ => self.next.as_deref(),
        };
        built.unwrap_or(&PREDEFINED)
    }

    pub(super) fn accept(&mut self, choice: CodesChoice) {
        if choice != CodesChoice::REPEATED {
            core::mem::swap(&mut self.current, &mut self.next);
        }
        for (reuse, encoding) in self.reuse.iter_mut().zip(choice.0) {
            match encoding {
                Encoding::Basic | Encoding::Rle => *reuse = Reuse::Never,
                Encoding::Compressed => *reuse = Reuse::IfComplete,
                Encoding::Repeat => {}
            }
        }
    }

    /// Builds the tables for `sequences`, of which there are some, and writes their descriptions.
    pub(super) fn choose(
        &mut self,
        sequences: &[Sequence],
        counts: &CodeCounts,
        strategy: Strategy,
        out: &mut [u8],
    ) -> Result<Chosen> {
        let mut chosen = Chosen::PREDEFINED;
        let current = self.current.as_deref().unwrap_or(&PREDEFINED);
        let [first, second, third] = CodeKind::ALL;
        let mut histograms = [
            histogram(first, counts),
            histogram(second, counts),
            histogram(third, counts),
        ];
        for (kind, histogram) in CodeKind::ALL.into_iter().zip(&histograms) {
            let (alphabet, reuse) = (ALPHABETS.at(kind as usize), *self.reuse.at(kind as usize));
            let repeated_cost = |counts: &[u32]| current.cost(kind, counts);
            let total = sequences.len();
            *chosen.choice.0.at_mut(kind as usize) =
                select(alphabet, reuse, repeated_cost, histogram, total, strategy)?;
        }
        if let CodesChoice::PREDEFINED | CodesChoice::REPEATED = chosen.choice {
            return Ok(chosen);
        }

        let next = get_or_allocate(&mut self.next, || TableSet::EMPTY)?;
        let last = sequences.last().ok_or(Error::Internal)?;
        let kinds = CodeKind::ALL.into_iter().zip(chosen.choice.0);
        for ((kind, encoding), histogram) in kinds.zip(&mut histograms) {
            let (alphabet, last) = (ALPHABETS.at(kind as usize), last.code(kind));
            let out = out.get_mut(chosen.len..).ok_or(Error::Internal)?;
            match encoding {
                Encoding::Basic => next.copy_from(&PREDEFINED, kind),
                Encoding::Repeat => next.copy_from(current, kind),
                Encoding::Rle => {
                    *next.shapes.at_mut(kind as usize) =
                        next.tables.build_for_one(kind as usize, last);
                    *out.first_mut().ok_or(Error::DstSizeTooSmall)? = last as u8;
                    chosen.len += 1;
                }
                Encoding::Compressed => {
                    let mut total = sequences.len();
                    let log =
                        fse::table_log_for(alphabet.table_log_max, total, histogram.max_symbol, 2);
                    // The first state stands for it.
                    let count = histogram.counts.at_mut(last);
                    if *count > 1 {
                        *count -= 1;
                        total -= 1;
                    }
                    let normalized =
                        Normalized::new(histogram.used(), total, log, allows_less_than_1(total))?;
                    chosen.last_compressed_len = normalized.write(out)?;
                    chosen.len += chosen.last_compressed_len;
                    next.build(kind, &normalized);
                }
            }
        }
        Ok(chosen)
    }

    pub(crate) fn plan(
        &mut self,
        sequences: &[Sequence],
        counts: &CodeCounts,
        strategy: Strategy,
    ) -> Result<CodesPlan> {
        let mut descriptions = [0; _];
        let chosen = if sequences.is_empty() {
            Chosen::PREDEFINED
        } else {
            self.choose(sequences, counts, strategy, &mut descriptions)?
        };
        Ok(CodesPlan {
            chosen,
            descriptions,
        })
    }

    /// Of the descriptions and the stream.
    pub(crate) fn estimated_len(&self, plan: &CodesPlan, counts: &CodeCounts) -> usize {
        let lens = CodeKind::ALL.into_iter().map(|kind| {
            let (alphabet, histogram) = (ALPHABETS.at(kind as usize), histogram(kind, counts));
            let bits = match plan.choice().0.at(kind as usize) {
                Encoding::Basic => alphabet.predefined_cost(histogram.used()),
                Encoding::Rle => Some(0),
                _ => self.chosen(plan.choice()).cost(kind, histogram.used()),
            };
            let pairs = histogram.counts.iter().zip(alphabet.extra_bits);
            let extra_bits: u32 = pairs.map(|(&count, bits)| count * u32::from(bits)).sum();
            (bits.unwrap_or_default() + extra_bits as usize) / 8
        });
        plan.chosen.len + lens.sum::<usize>()
    }

    /// For a part of the sequences of `plan`. Also tells whether later parts can repeat its tables.
    pub(crate) fn write_part(
        &self,
        plan: &CodesPlan,
        sequences: &[Sequence],
        describes_tables: bool,
        out: &mut [u8],
    ) -> Result<Option<(usize, bool)>> {
        let count_len = write_count(sequences.len(), out)?;
        if sequences.is_empty() {
            return Ok(Some((count_len, false)));
        }
        let out = out.get_mut(count_len..).unwrap_or_default();
        let (modes, out) = out.split_first_mut().ok_or(Error::Internal)?;
        let (choice, descriptions) = if describes_tables {
            let descriptions = plan.descriptions.get(..plan.chosen.len);
            (plan.choice(), descriptions.unwrap_or_default())
        } else {
            (CodesChoice([Encoding::Repeat; 3]), &[][..])
        };
        *modes = choice.modes();
        put(out, descriptions).ok_or(Error::DstSizeTooSmall)?;
        let out = out.get_mut(descriptions.len()..).unwrap_or_default();
        let stream_len = self.encode(plan.choice(), sequences, out)?;

        let len = 1 + descriptions.len() + stream_len;
        // https://github.com/facebook/zstd/pull/1664
        if len < 4 || (describes_tables && plan.chosen.trips_old_decoders(stream_len)) {
            return Ok(None);
        }
        Ok(Some((count_len + len, true)))
    }

    /// `choice` is the last one that was made. Returns the length of the stream.
    pub(super) fn encode(
        &self,
        choice: CodesChoice,
        sequences: &[Sequence],
        out: &mut [u8],
    ) -> Result<usize> {
        let set = self.chosen(choice);
        let len = with_bmi2(
            #[inline(always)]
            move || encode(set, sequences, out),
        );
        len.ok_or(Error::DstSizeTooSmall)
    }
}

#[inline(always)]
fn encode(
    TableSet { tables, shapes }: &TableSet,
    sequences: &[Sequence],
    out: &mut [u8],
) -> Option<usize> {
    const ROOM_AFTER_FLUSH: u32 = 64 - 8;
    const ROOM_AFTER_STATES: u32 = ROOM_AFTER_FLUSH
        - LITERAL_LENGTH_TABLE_LOG_MAX
        - OFFSET_TABLE_LOG_MAX
        - MATCH_LENGTH_TABLE_LOG_MAX;
    let mut writer = BitWriter::new(out)?;
    // The checks of hardened builds make it too large. In others, it gets better registers if it is not forced.
    let add_extra_bits = #[cfg_attr(bun_hardened, inline(always))]
    |writer: &mut BitWriter<'_>, sequence: &Sequence| {
        let (mut bits, mut count) = sequence.extra_bits();
        if count > ROOM_AFTER_STATES {
            writer.flush()?;
            if count > ROOM_AFTER_FLUSH {
                core::hint::cold_path();
                writer.add(bits as u32, 32);
                writer.flush()?;
                (bits, count) = (bits >> 32, count - 32);
            }
        }
        writer.add_all(bits, count);
        writer.flush()
    };

    let (last, rest) = sequences.split_last()?;
    // Or else the compiler narrows them to 16 bits, and spills one.
    let [mut literal_state, mut offset_state, mut match_state] =
        core::hint::black_box(last.symbols().map(|symbol| tables.first_state(symbol)));
    add_extra_bits(&mut writer, last)?;

    for sequence in rest.iter().rev() {
        let [literal_symbol, offset_symbol, match_symbol] = sequence.symbols();
        tables.encode(&mut writer, &mut offset_state, offset_symbol);
        tables.encode(&mut writer, &mut match_state, match_symbol);
        tables.encode(&mut writer, &mut literal_state, literal_symbol);
        add_extra_bits(&mut writer, sequence)?;
    }

    let [literal_shape, offset_shape, match_shape] = *shapes;
    match_shape.finish(&mut writer, match_state)?;
    offset_shape.finish(&mut writer, offset_state)?;
    literal_shape.finish(&mut writer, literal_state)?;
    writer.finish()
}

#[test]
fn costs_are_logarithms() {
    for (share, cost) in INVERSE_PROBABILITY_LOG.into_iter().enumerate().skip(1) {
        assert_eq!(cost, (-(share as f64 / 256.0).log2() * 256.0) as u16);
    }
}

#[test]
fn offset_codes_are_numbers_of_bits() {
    assert!(OFFSET_BITS.into_iter().eq(0..32));
}
