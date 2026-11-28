//! The decoding tables for sequences.

use bun_highway::unzstd::{CODES_MAX, Codes, Tables};
use bun_highway::with_avx2;

use crate::error::{Error, Result};
use crate::format::{
    CodeKind, LITERAL_LENGTH_BASES, LITERAL_LENGTH_BITS, LITERAL_LENGTH_TABLE_LOG_MAX,
    MATCH_LENGTH_BASES, MATCH_LENGTH_BITS, MATCH_LENGTH_TABLE_LOG_MAX, MAX_LITERAL_LENGTH_CODE,
    MAX_MATCH_LENGTH_CODE, MAX_OFFSET_CODE, OFFSET_TABLE_LOG_MAX,
};
use crate::fse::{FILL, Spread, read_few_counts};

static LITERAL_LENGTH_CODES: Codes =
    Codes::literal_lengths(&LITERAL_LENGTH_BASES, &LITERAL_LENGTH_BITS);
static MATCH_LENGTH_CODES: Codes = Codes::match_lengths(&MATCH_LENGTH_BASES, &MATCH_LENGTH_BITS);

impl CodeKind {
    fn codes(self) -> &'static Codes {
        match self {
            Self::LiteralLength => &LITERAL_LENGTH_CODES,
            Self::Offset => &Codes::OFFSETS,
            Self::MatchLength => &MATCH_LENGTH_CODES,
        }
    }

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

type Symbols = Spread<{ (1 << LITERAL_LENGTH_TABLE_LOG_MAX) + FILL }>;

/// Of the default distributions.
const PREDEFINED_DESCRIPTIONS: [&[u8]; 3] = [
    b"\x51\x10\x63\x8c\x31\xc6\x18\x63\x0c\x21\xc4\x18\x63\x66\x66\x86\x46\x92\x04\x00",
    b"\x20\x84\x10\x42\x66\x46\x44\x44\x44\x44\x24\x49\x02\x00",
    b"\x21\x14\xc4\x18\x63\x8c\x21\x84\x10\x42\x08\x21\x84\x10\x42\x08\x21\x44\x44\x44\x44\x44\x44\x44\x44\x24\x09\x00\x00",
];

pub(crate) fn predefined_tables() -> &'static Tables {
    Tables::shared(|tables| {
        for (kind, description) in CodeKind::ALL.into_iter().zip(PREDEFINED_DESCRIPTIONS) {
            let len = read_table(tables, kind, description);
            debug_assert_eq!(len, Ok(description.len()));
        }
    })
}

/// From the description at the start of `src`, whose length it returns.
pub(crate) fn read_table(tables: &mut Tables, kind: CodeKind, src: &[u8]) -> Result<usize> {
    with_avx2(
        #[inline(always)]
        || {
            let (mut counts, mut spread) = ([0; CODES_MAX], Symbols::EMPTY);
            let allowed = counts.get_mut(..=kind.max_code()).ok_or(Error::Internal)?;
            let description = read_few_counts(src, kind.table_log_max(), allowed)?;
            let (used, log) = (counts.get(..=description.max_symbol), description.table_log);
            spread.fill(used.ok_or(Error::Internal)?, log);
            tables.fill(kind.codes(), log, &counts, (&spread.symbols, spread.stride));
            Ok(description.len)
        },
    )
}

/// The same for sequences that all have the same code.
pub(crate) fn read_rle_table(tables: &mut Tables, kind: CodeKind, src: &[u8]) -> Result<usize> {
    let code = src.first().map(|&it| usize::from(it));
    let code = code.filter(|&it| it <= kind.max_code());
    tables.set_only(kind.codes(), code.ok_or(Error::CorruptionDetected)?);
    Ok(1)
}

#[test]
fn the_predefined_tables_have_the_default_distributions() -> Result<()> {
    use crate::format::{DEFAULT_LITERAL_LENGTHS, DEFAULT_MATCH_LENGTHS, DEFAULT_OFFSETS};

    let defaults = [
        DEFAULT_LITERAL_LENGTHS,
        DEFAULT_OFFSETS,
        DEFAULT_MATCH_LENGTHS,
    ];
    for (default, description) in defaults.into_iter().zip(PREDEFINED_DESCRIPTIONS) {
        let mut counts = vec![0; default.counts.len()];
        let log = read_few_counts(description, 6, &mut counts)?.table_log;
        assert_eq!((&*counts, log), (default.counts, default.table_log));
    }
    Ok(())
}
