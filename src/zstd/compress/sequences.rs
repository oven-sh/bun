//! `zstd_compress_sequences.c`: how the sequences of a block are encoded.

use core::num::NonZero;

use super::fse::{
    self, FSE_NCOUNTBOUND, FseCTable, FseRepeat, FseSymbolTransform, PredefinedCTable,
};
use super::internal::{FseCTables, LongLengthType, SeqDef, Strategy};
use crate::common::{
    DEFAULT_MAX_OFF, LL_BITS, LL_DEFAULT_NORM, LL_DEFAULT_NORM_LOG, LL_FSE_LOG, MAX_LL, MAX_ML,
    MAX_SEQ, ML_BITS, ML_DEFAULT_NORM, ML_DEFAULT_NORM_LOG, ML_FSE_LOG, OF_DEFAULT_NORM,
    OF_DEFAULT_NORM_LOG, OFF_FSE_LOG, SymbolEncodingType,
};
use crate::error::{Error, Result};
use crate::util::{SliceExt, highbit32};

/// `-log2(x / 256)` in units of 1/256 of a bit, for `x` from 1 to 255. The entry for 0 is not used.
#[rustfmt::skip]
static K_INVERSE_PROBABILITY_LOG256: [u32; 256] = [
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

/// What the C code has for a cost that could not be computed: an error code, which is more than any cost.
fn cost_or_error(cost: Result<usize>) -> usize {
    cost.unwrap_or_else(|code| 0usize.wrapping_sub(code as usize))
}

/// `ZSTD_useLowProbCount`: with few sequences, counts of -1 hurt more than they help.
const fn use_low_prob_count(nb_seq: usize) -> bool {
    nb_seq >= 2048
}

/// `ZSTD_NCountCost`: how many bytes the header of a table for `count` takes.
fn ncount_cost(count: &[u32], max: u32, nb_seq: usize, fse_log: u32) -> Result<usize> {
    let mut wksp = [0u8; FSE_NCOUNTBOUND];
    let mut norm = [0i16; MAX_SEQ as usize + 1];
    let table_log = fse::optimal_table_log(fse_log, nb_seq, max);
    fse::normalize_count(
        &mut norm,
        table_log,
        count,
        nb_seq,
        max,
        use_low_prob_count(nb_seq),
    )?;
    fse::write_ncount(&mut wksp, &norm, max, table_log)
}

/// `ZSTD_entropyCost`: how many bits it takes to encode the distribution `count`, which adds up to `total`, with a
/// table made for it.
fn entropy_cost(count: &[u32], max: u32, total: usize) -> Result<usize> {
    let mut cost: u32 = 0;
    for &c in count.sub(..=max as usize)? {
        let mut norm = 256u32.wrapping_mul(c) as usize / total.max(1);
        if c != 0 && norm == 0 {
            norm = 1;
        }
        cost = cost.wrapping_add(c.wrapping_mul(K_INVERSE_PROBABILITY_LOG256.at(norm)?));
    }
    Ok((cost >> 8) as usize)
}

/// `ZSTD_fseBitCost`: how many bits it takes to encode the distribution `count` with `ctable`, which is an error if
/// the table lacks one of the symbols.
pub(crate) fn fse_bit_cost(ctable: &FseCTable, count: &[u32], max: u32) -> Result<usize> {
    const K_ACCURACY_LOG: u32 = 8;
    let mut cost: usize = 0;
    if ctable.max_symbol_value < max {
        return Err(Error::Generic);
    }
    let bad_cost = (ctable.table_log + 1) << K_ACCURACY_LOG;
    for (s, &c) in count.sub(..=max as usize)?.iter().enumerate() {
        if c == 0 {
            continue;
        }
        let bit_cost = ctable.bit_cost(s as u32, K_ACCURACY_LOG);
        if bit_cost >= bad_cost {
            return Err(Error::Generic);
        }
        cost += c as usize * bit_cost as usize;
    }
    Ok(cost >> K_ACCURACY_LOG)
}

/// `ZSTD_crossEntropyCost`: how many bits it takes to encode the distribution `count` with a table made from `norm`.
pub(crate) fn cross_entropy_cost(
    norm: &[i16],
    accuracy_log: u32,
    count: &[u32],
    max: u32,
) -> Result<usize> {
    let shift = 8 - accuracy_log;
    let mut cost: usize = 0;
    let len = max as usize + 1;
    for (&n, &c) in norm.sub(..len)?.iter().zip(count.sub(..len)?) {
        let norm_acc = if n != -1 { n as u32 } else { 1 };
        let norm256 = norm_acc << shift;
        cost += c.wrapping_mul(K_INVERSE_PROBABILITY_LOG256.at(norm256 as usize)?) as usize;
    }
    Ok(cost >> 8)
}

/// `ZSTD_selectEncodingType`
pub(crate) fn select_encoding_type(
    repeat_mode: &mut FseRepeat,
    count: &[u32],
    max: u32,
    most_frequent: usize,
    nb_seq: usize,
    fse_log: u32,
    prev_ctable: &FseCTable,
    default_norm: &[i16],
    default_norm_log: u32,
    is_default_allowed: bool,
    strategy: Strategy,
) -> Result<SymbolEncodingType> {
    if most_frequent == nb_seq {
        *repeat_mode = FseRepeat::None;
        if is_default_allowed && nb_seq <= 2 {
            // A run of 1 or 2 costs more than the predefined table does.
            return Ok(SymbolEncodingType::Basic);
        }
        return Ok(SymbolEncodingType::Rle);
    }
    if strategy < Strategy::Lazy {
        if is_default_allowed {
            const STATIC_FSE_NB_SEQ_MAX: usize = 1000;
            let mult = 10 - strategy as usize;
            const BASE_LOG: usize = 3;
            let dynamic_fse_nb_seq_min = ((1usize << default_norm_log) * mult) >> BASE_LOG;
            if *repeat_mode == FseRepeat::Valid && nb_seq < STATIC_FSE_NB_SEQ_MAX {
                return Ok(SymbolEncodingType::Repeat);
            }
            if nb_seq < dynamic_fse_nb_seq_min || most_frequent < (nb_seq >> (default_norm_log - 1))
            {
                *repeat_mode = FseRepeat::None;
                return Ok(SymbolEncodingType::Basic);
            }
        }
    } else {
        let basic_cost = cost_or_error(if is_default_allowed {
            cross_entropy_cost(default_norm, default_norm_log, count, max)
        } else {
            Err(Error::Generic)
        });
        let repeat_cost = cost_or_error(if *repeat_mode != FseRepeat::None {
            fse_bit_cost(prev_ctable, count, max)
        } else {
            Err(Error::Generic)
        });
        let ncount_cost = cost_or_error(ncount_cost(count, max, nb_seq, fse_log));
        let compressed_cost = (ncount_cost << 3).wrapping_add(entropy_cost(count, max, nb_seq)?);

        if basic_cost <= repeat_cost && basic_cost <= compressed_cost {
            *repeat_mode = FseRepeat::None;
            return Ok(SymbolEncodingType::Basic);
        }
        if repeat_cost <= compressed_cost {
            return Ok(SymbolEncodingType::Repeat);
        }
    }
    *repeat_mode = FseRepeat::Check;
    Ok(SymbolEncodingType::Compressed)
}

const fn t(delta_find_state: i32, delta_nb_bits: u32) -> FseSymbolTransform {
    FseSymbolTransform {
        delta_find_state,
        delta_nb_bits,
    }
}

/// What [`FseCTable::build`] makes of [`LL_DEFAULT_NORM`].
#[rustfmt::skip]
static LL_DEFAULT_CTABLE: PredefinedCTable = PredefinedCTable::new(
    LL_DEFAULT_NORM_LOG,
    [
         64,  65,  86, 107,  66,  87, 108,  88, 109,  67, 110,  68,  89,  90, 111,  69,
        112,  70,  91,  92, 113,  71, 114,  72,  93,  94, 115,  73, 116,  95,  74, 117,
         75,  96,  97, 118,  76, 119,  77,  98,  99, 120,  78, 121,  79, 100, 101, 122,
         80, 123,  81, 102, 103,  82, 104,  83, 105,  84, 106,  85, 127, 126, 125, 124,
    ],
    [
        t(-4, 327552), t( 1, 327584), t( 5, 393088), t( 7, 393088), t( 9, 393088), t(11, 393088),
        t(13, 393088), t(15, 393088), t(17, 393088), t(19, 393088), t(21, 393088), t(23, 393088),
        t(25, 393088), t(28, 393152), t(29, 393152), t(30, 393152), t(30, 393088), t(32, 393088),
        t(34, 393088), t(36, 393088), t(38, 393088), t(40, 393088), t(42, 393088), t(44, 393088),
        t(46, 393088), t(47, 327584), t(51, 393088), t(54, 393152), t(55, 393152), t(56, 393152),
        t(57, 393152), t(58, 393152), t(59, 393152), t(60, 393152), t(61, 393152), t(62, 393152),
    ],
);

/// What [`FseCTable::build`] makes of [`OF_DEFAULT_NORM`].
#[rustfmt::skip]
static OF_DEFAULT_CTABLE: PredefinedCTable = PredefinedCTable::new(
    OF_DEFAULT_NORM_LOG,
    [
         32,  55,  46,  37,  51,  42,  33,  56,  38,  47,  43,  52,  34,  57,  48,  39,
         53,  44,  35,  58,  49,  40,  54,  45,  36,  50,  41,  63,  62,  61,  60,  59,
    ],
    [
        t(-1, 327648), t( 0, 327648), t( 1, 327648), t( 2, 327648), t( 3, 327648), t( 4, 327648),
        t( 4, 327616), t( 6, 327616), t( 8, 327616), t(11, 327648), t(12, 327648), t(13, 327648),
        t(14, 327648), t(15, 327648), t(16, 327648), t(17, 327648), t(18, 327648), t(19, 327648),
        t(20, 327648), t(21, 327648), t(22, 327648), t(23, 327648), t(24, 327648), t(25, 327648),
        t(26, 327648), t(27, 327648), t(28, 327648), t(29, 327648), t(30, 327648),
    ],
);

/// What [`FseCTable::build`] makes of [`ML_DEFAULT_NORM`].
#[rustfmt::skip]
static ML_DEFAULT_CTABLE: PredefinedCTable = PredefinedCTable::new(
    ML_DEFAULT_NORM_LOG,
    [
         64,  65,  86, 107, 108,  66,  87, 109,  67,  88,  89, 110,  68, 111,  69,  90,
         91, 112,  70, 113,  92,  71, 114,  93,  72, 115,  94,  73, 116,  95,  74, 117,
         96,  75, 118,  97,  76, 119,  98,  77, 120,  99,  78, 100,  79, 101,  80, 102,
         81, 103,  82, 104,  83, 105,  84, 106,  85, 127, 126, 125, 124, 123, 122, 121,
    ],
    [
        t(-1, 393152), t(-3, 327552), t( 2, 327584), t( 6, 393088), t( 8, 393088), t(10, 393088),
        t(12, 393088), t(14, 393088), t(16, 393088), t(19, 393152), t(20, 393152), t(21, 393152),
        t(22, 393152), t(23, 393152), t(24, 393152), t(25, 393152), t(26, 393152), t(27, 393152),
        t(28, 393152), t(29, 393152), t(30, 393152), t(31, 393152), t(32, 393152), t(33, 393152),
        t(34, 393152), t(35, 393152), t(36, 393152), t(37, 393152), t(38, 393152), t(39, 393152),
        t(40, 393152), t(41, 393152), t(42, 393152), t(43, 393152), t(44, 393152), t(45, 393152),
        t(46, 393152), t(47, 393152), t(48, 393152), t(49, 393152), t(50, 393152), t(51, 393152),
        t(52, 393152), t(53, 393152), t(54, 393152), t(55, 393152), t(56, 393152), t(57, 393152),
        t(58, 393152), t(59, 393152), t(60, 393152), t(61, 393152), t(62, 393152),
    ],
);

/// What is particular to literal lengths, to offsets or to match lengths in how a table is made.
pub(crate) struct CodeKind {
    pub(crate) fse_log: u32,
    pub(crate) default_norm: &'static [i16],
    pub(crate) default_norm_log: u32,
    /// The largest code that the predefined table has.
    pub(crate) default_max: u32,
    default_ctable: &'static PredefinedCTable,
}

pub(crate) static LL_KIND: CodeKind = CodeKind {
    fse_log: LL_FSE_LOG,
    default_norm: &LL_DEFAULT_NORM,
    default_norm_log: LL_DEFAULT_NORM_LOG,
    default_max: MAX_LL,
    default_ctable: &LL_DEFAULT_CTABLE,
};

pub(crate) static OF_KIND: CodeKind = CodeKind {
    fse_log: OFF_FSE_LOG,
    default_norm: &OF_DEFAULT_NORM,
    default_norm_log: OF_DEFAULT_NORM_LOG,
    default_max: DEFAULT_MAX_OFF,
    default_ctable: &OF_DEFAULT_CTABLE,
};

pub(crate) static ML_KIND: CodeKind = CodeKind {
    fse_log: ML_FSE_LOG,
    default_norm: &ML_DEFAULT_NORM,
    default_norm_log: ML_DEFAULT_NORM_LOG,
    default_max: MAX_ML,
    default_ctable: &ML_DEFAULT_CTABLE,
};

/// `ZSTD_buildCTable`: makes the table for `nb_seq` codes, the last of which is `last_code` and of which `count` is the
/// distribution, and writes what the decoder needs to make the same one. Returns how many bytes that takes.
pub(crate) fn build_ctable(
    dst: &mut [u8],
    next_ctable: &mut FseCTable,
    kind: &CodeKind,
    ty: SymbolEncodingType,
    count: &mut [u32],
    max: u32,
    nb_seq: usize,
    last_code: u8,
    prev_ctable: &FseCTable,
) -> Result<usize> {
    match ty {
        SymbolEncodingType::Rle => {
            next_ctable.build_rle(max as u8)?;
            let Some(first) = dst.first_mut() else {
                return Err(Error::DstSizeTooSmall);
            };
            *first = max as u8;
            Ok(1)
        }
        SymbolEncodingType::Repeat => {
            next_ctable.clone_from(prev_ctable);
            Ok(0)
        }
        SymbolEncodingType::Basic => {
            next_ctable.set_predefined(kind.default_ctable);
            Ok(0)
        }
        SymbolEncodingType::Compressed => {
            let mut norm = [0i16; MAX_SEQ as usize + 1];
            let table_log = fse::optimal_table_log(kind.fse_log, nb_seq, max);
            // The last code is the first state, which takes no transition.
            let last_count = count.at_mut(usize::from(last_code))?;
            let without_last = usize::from(*last_count > 1);
            *last_count -= without_last as u32;
            let nb_seq_1 = nb_seq - without_last;
            let normalized = fse::normalize_count(
                &mut norm,
                table_log,
                count,
                nb_seq_1,
                max,
                use_low_prob_count(nb_seq_1),
            );
            *count.at_mut(usize::from(last_code))? += without_last as u32;
            normalized?;
            let ncount_size = fse::write_ncount(dst, &norm, max, table_log)?;
            next_ctable.build(&norm, max, table_log)?;
            Ok(ncount_size)
        }
    }
}

/// The code of a length or of an offset. As the index into a table of 64, it takes no check.
#[rustfmt::skip]
#[derive(Clone, Copy, Default)]
#[repr(u8)]
pub(crate) enum Code {
    #[default]
     C0,  C1,  C2,  C3,  C4,  C5,  C6,  C7,  C8,  C9, C10, C11, C12, C13, C14, C15,
    C16, C17, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31,
    C32, C33, C34, C35, C36, C37, C38, C39, C40, C41, C42, C43, C44, C45, C46, C47,
    C48, C49, C50, C51, C52, C53, C54, C55, C56, C57, C58, C59, C60, C61, C62, C63,
}
use Code::*;

impl Code {
    #[rustfmt::skip]
    const ALL: [Self; 64] = [
         C0,  C1,  C2,  C3,  C4,  C5,  C6,  C7,  C8,  C9, C10, C11, C12, C13, C14, C15,
        C16, C17, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31,
        C32, C33, C34, C35, C36, C37, C38, C39, C40, C41, C42, C43, C44, C45, C46, C47,
        C48, C49, C50, C51, C52, C53, C54, C55, C56, C57, C58, C59, C60, C61, C62, C63,
    ];

    /// `code` is less than 64.
    #[inline(always)]
    fn new(code: u32) -> Self {
        (Self::ALL.get(code as usize & 63).copied()).unwrap_or_default()
    }
}

/// The code of a length, and the bits that follow the code in the stream.
#[derive(Clone, Copy)]
struct LengthCode {
    code: Code,
    nb_bits: u32,
    bits: u32,
}

/// [`LengthCode`] for the lengths below `N`.
struct LengthCodes<const N: usize> {
    code: [Code; N],
    nb_bits: [u8; N],
    bits: [u8; N],
}

impl<const N: usize> LengthCodes<N> {
    #[inline(always)]
    fn get(&self, length: u16) -> Option<LengthCode> {
        let index = usize::from(length);
        Some(LengthCode {
            code: *self.code.get(index)?,
            nb_bits: u32::from(*self.nb_bits.get(index)?),
            bits: u32::from(*self.bits.get(index)?),
        })
    }

    /// From `N` on, a code is for the lengths of one binary logarithm, to which `delta` is added.
    fn get_any(&self, length: u16, delta: u32) -> LengthCode {
        self.get(length).unwrap_or_else(|| {
            let log = highbit32(u32::from(length));
            LengthCode {
                code: Code::new(log + delta),
                nb_bits: log,
                bits: u32::from(length) & !(1 << log),
            }
        })
    }
}

/// `ZSTD_LLcode`
#[rustfmt::skip]
static LL_CODES: LengthCodes<64> = LengthCodes {
    code: [
         C0,  C1,  C2,  C3,  C4,  C5,  C6,  C7,  C8,  C9, C10, C11, C12, C13, C14, C15,
        C16, C16, C17, C17, C18, C18, C19, C19, C20, C20, C20, C20, C21, C21, C21, C21,
        C22, C22, C22, C22, C22, C22, C22, C22, C23, C23, C23, C23, C23, C23, C23, C23,
        C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24, C24,
    ],
    nb_bits: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2,
        3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    ],
    bits: [
         0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
         0,  1,  0,  1,  0,  1,  0,  1,  0,  1,  2,  3,  0,  1,  2,  3,
         0,  1,  2,  3,  4,  5,  6,  7,  0,  1,  2,  3,  4,  5,  6,  7,
         0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
    ],
};

/// `ZSTD_MLcode`
#[rustfmt::skip]
static ML_CODES: LengthCodes<128> = LengthCodes {
    code: [
         C0,  C1,  C2,  C3,  C4,  C5,  C6,  C7,  C8,  C9, C10, C11, C12, C13, C14, C15,
        C16, C17, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31,
        C32, C32, C33, C33, C34, C34, C35, C35, C36, C36, C36, C36, C37, C37, C37, C37,
        C38, C38, C38, C38, C38, C38, C38, C38, C39, C39, C39, C39, C39, C39, C39, C39,
        C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40, C40,
        C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41, C41,
        C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42,
        C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42, C42,
    ],
    nb_bits: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
        4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    ],
    bits: [
         0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
         0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
         0,  1,  0,  1,  0,  1,  0,  1,  0,  1,  2,  3,  0,  1,  2,  3,
         0,  1,  2,  3,  4,  5,  6,  7,  0,  1,  2,  3,  4,  5,  6,  7,
         0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
         0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
         0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
        16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    ],
};

const LL_DELTA_CODE: u32 = 19;
const ML_DELTA_CODE: u32 = 36;

/// The codes of a sequence, and the bits that follow them.
#[derive(Clone, Copy, Default)]
pub(crate) struct SeqCodes {
    /// The bits for the literal length, above them those for the match length, above them those for the offset, and
    /// above them a bit set. If there are too many for the sequence to be written at once, only the bit set.
    extra_bits: u32,
    pub(crate) ll: Code,
    pub(crate) of: Code,
    pub(crate) ml: Code,
}

impl SeqCodes {
    /// With more than this on top of the bits that leave the three states, a sequence may not fit the container.
    const MAX_EXTRA_BITS: u32 = 64 - 7 - (LL_FSE_LOG + ML_FSE_LOG + OFF_FSE_LOG) - 1;

    /// `None` if there are too many extra bits.
    #[inline(always)]
    fn new(ll: LengthCode, ml: LengthCode, off_base: u32) -> Option<Self> {
        let of = highbit32(off_base);
        if ll.nb_bits + ml.nb_bits + of > Self::MAX_EXTRA_BITS {
            return None;
        }
        // The highest bit of `off_base`, which the code stands for, is the bit set above the others.
        let above_ll = (off_base << (ml.nb_bits & 31)) | ml.bits;
        Some(Self {
            extra_bits: (above_ll << (ll.nb_bits & 31)) | ll.bits,
            ll: ll.code,
            of: Code::new(of),
            ml: ml.code,
        })
    }

    /// `*self = codes`, without putting the fields together first.
    #[inline(always)]
    fn set(&mut self, codes: Self) {
        self.extra_bits = codes.extra_bits;
        self.ll = codes.ll;
        self.of = codes.of;
        self.ml = codes.ml;
    }

    fn ll_bits(self) -> u32 {
        u32::from(LL_BITS.get(self.ll as usize).copied().unwrap_or(0))
    }

    fn ml_bits(self) -> u32 {
        u32::from(ML_BITS.get(self.ml as usize).copied().unwrap_or(0))
    }

    /// Whether `extra_bits` lacks the extra bits.
    fn has_many_bits(self) -> bool {
        self.extra_bits == 1
            && self.ll_bits() + self.ml_bits() + self.of as u32 > Self::MAX_EXTRA_BITS
    }
}

/// How many times each code occurs.
pub(crate) type CodeCounts = [u32; 64];

#[inline(always)]
fn count_code(counts: &mut CodeCounts, code: Code, delta: u32) {
    if let Some(count) = counts.get_mut(code as usize) {
        *count = count.wrapping_add(delta);
    }
}

/// What `HIST_count` tells about counts.
#[derive(Clone, Copy)]
pub(crate) struct CountsSummary {
    pub(crate) max_symbol_value: u32,
    pub(crate) largest: usize,
}

pub(crate) fn summarize(counts: &CodeCounts) -> CountsSummary {
    CountsSummary {
        max_symbol_value: counts.iter().rposition(|&c| c != 0).unwrap_or(0) as u32,
        largest: counts.iter().copied().max().unwrap_or(0) as usize,
    }
}

/// The distributions of the codes of some sequences.
pub(crate) struct SeqHistograms {
    pub(crate) ll: CodeCounts,
    pub(crate) of: CodeCounts,
    pub(crate) ml: CodeCounts,
    /// Whether some sequence has too many extra bits to be written at once.
    pub(crate) many_bits: bool,
}

impl SeqHistograms {
    #[inline(always)]
    fn add(&mut self, codes: SeqCodes) {
        count_code(&mut self.ll, codes.ll, 1);
        count_code(&mut self.of, codes.of, 1);
        count_code(&mut self.ml, codes.ml, 1);
    }

    /// The codes of any sequence, which are not counted.
    fn codes_of(&mut self, ll: LengthCode, ml: LengthCode, off_base: u32) -> SeqCodes {
        SeqCodes::new(ll, ml, off_base).unwrap_or_else(|| {
            self.many_bits = true;
            SeqCodes {
                extra_bits: 1,
                ll: ll.code,
                of: Code::new(highbit32(off_base)),
                ml: ml.code,
            }
        })
    }

    /// For a sequence that takes more than the tables of [`seq_to_codes`].
    #[cold]
    #[inline(never)]
    fn add_unusual(&mut self, seq: SeqDef) -> SeqCodes {
        let codes = self.codes_of(
            LL_CODES.get_any(seq.lit_length, LL_DELTA_CODE),
            ML_CODES.get_any(seq.ml_base, ML_DELTA_CODE),
            seq.off_base,
        );
        self.add(codes);
        codes
    }
}

/// `ZSTD_seqToCodes`, and the distributions of the codes. `codes` is as long as `sequences`. One length of the sequence
/// `long_length_pos`, if there is such a sequence, is 0x10000 more than it says, unless `long_length_type` is `None`.
pub(crate) fn seq_to_codes(
    codes: &mut [SeqCodes],
    sequences: &[SeqDef],
    long_length_type: LongLengthType,
    long_length_pos: usize,
) -> SeqHistograms {
    let mut histograms = SeqHistograms {
        ll: [0; 64],
        of: [0; 64],
        ml: [0; 64],
        many_bits: false,
    };
    for (codes, seq) in codes.iter_mut().zip(sequences) {
        if let (Some(ll), Some(ml)) = (LL_CODES.get(seq.lit_length), ML_CODES.get(seq.ml_base))
            && let Some(usual) = SeqCodes::new(ll, ml, seq.off_base)
        {
            codes.set(usual);
            histograms.add(usual);
        } else {
            *codes = histograms.add_unusual(*seq);
        }
    }
    if long_length_type != LongLengthType::None
        && let (Some(codes), Some(seq)) = (
            codes.get_mut(long_length_pos),
            sequences.get(long_length_pos),
        )
    {
        let mut ll = LL_CODES.get_any(seq.lit_length, LL_DELTA_CODE);
        let mut ml = ML_CODES.get_any(seq.ml_base, ML_DELTA_CODE);
        let (length, counts, code, bits) = if long_length_type == LongLengthType::LiteralLength {
            (&mut ll, &mut histograms.ll, MAX_LL, seq.lit_length)
        } else {
            (&mut ml, &mut histograms.ml, MAX_ML, seq.ml_base)
        };
        count_code(counts, length.code, 1u32.wrapping_neg());
        *length = LengthCode {
            code: Code::new(code),
            nb_bits: 16,
            bits: u32::from(bits),
        };
        count_code(counts, length.code, 1);
        *codes = histograms.codes_of(ll, ml, seq.off_base);
    }
    histograms
}

/// Bits on their way to the stream, with a bit set above them: the first to be written are the lowest.
#[derive(Clone, Copy)]
struct SeqBits(u64);

impl SeqBits {
    /// The lowest `nb_bits` of `bits`, which is less than 32.
    #[inline(always)]
    fn new(bits: u32, nb_bits: u32) -> Self {
        let above = 1 << (nb_bits & 31);
        Self((u64::from(bits) & (above - 1)) | above)
    }

    /// `FSE_encodeSymbol`: the bits that leave the state go below the others.
    #[inline(always)]
    fn encode_below(&mut self, table: &FseCTable, state: &mut u32, code: Code) {
        let transform = (table.symbol_tt.get(code as usize).copied()).unwrap_or_default();
        let nb_bits = state.wrapping_add(transform.delta_nb_bits) >> 16;
        let kept = state.wrapping_shr(nb_bits);
        // Taking `kept` from what comes above the state cancels the bits that stay in it.
        self.0 = (self.0.wrapping_sub(u64::from(kept)))
            .wrapping_shl(nb_bits)
            .wrapping_add(u64::from(*state));
        let next = kept.wrapping_add_signed(transform.delta_find_state) as usize;
        let state_table = &table.state_table;
        *state = u32::from((state_table.get(next & (state_table.len() - 1)).copied()).unwrap_or(0));
    }
}

/// The states of the three encoders.
#[derive(Clone, Copy)]
struct SeqStates {
    lit_length: u32,
    match_length: u32,
    offset_bits: u32,
}

/// `BIT_CStream_t`, without a container: what a byte lacks is added to it in the output.
struct SeqStream<'a> {
    /// In the byte that `bit_pos` is in, that bit is set, and those above it are not.
    dst: &'a mut [u8],
    bit_pos: usize,
}

impl SeqStream<'_> {
    /// `BIT_addBits` and `BIT_flushBits`: `seq` makes at most 56 bits. `None` if the output is too small, which is found
    /// out first so that there is less to keep while `seq` is at work.
    #[inline(always)]
    fn write_with(&mut self, seq: impl FnOnce() -> SeqBits) -> Option<()> {
        let pos = self.bit_pos >> 3;
        if pos > self.dst.len().checked_sub(size_of::<u64>())? {
            return None;
        }
        let out: &mut [u8; 8] = self.dst.get_mut(pos..)?.first_chunk_mut()?;
        let seq = NonZero::new(seq().0)?;
        let [partial, ..] = *out;
        // The lowest of the new bits replaces the bit set.
        let bits = (seq.get() - 1).wrapping_shl(self.bit_pos as u32 & 7);
        *out = bits.wrapping_add(u64::from(partial)).to_le_bytes();
        self.bit_pos += seq.ilog2() as usize;
        Some(())
    }

    #[inline(always)]
    fn write(&mut self, bits: u32, nb_bits: u32) -> Option<()> {
        self.write_with(|| SeqBits::new(bits, nb_bits))
    }
}

/// Where [`encode_run`] leaves things.
struct Encoded {
    states: SeqStates,
    bit_pos: usize,
}

/// From the last of `codes` to the first. `None` if the output is too small.
///
/// On its own, so that nothing else competes for the registers.
#[inline(never)]
fn encode_run(
    dst: &mut [u8],
    bit_pos: usize,
    tables: &FseCTables,
    states: SeqStates,
    codes: &[SeqCodes],
) -> Option<Encoded> {
    let mut stream = SeqStream { dst, bit_pos };
    let mut states = SeqStates {
        lit_length: states.lit_length,
        match_length: states.match_length,
        offset_bits: states.offset_bits,
    };
    for seq_codes in codes.iter().rev() {
        stream.write_with(|| {
            let mut seq = SeqBits(u64::from(seq_codes.extra_bits));
            seq.encode_below(
                &tables.litlength_c_table,
                &mut states.lit_length,
                seq_codes.ll,
            );
            seq.encode_below(
                &tables.matchlength_c_table,
                &mut states.match_length,
                seq_codes.ml,
            );
            seq.encode_below(
                &tables.offcode_c_table,
                &mut states.offset_bits,
                seq_codes.of,
            );
            seq
        })?;
    }
    Some(Encoded {
        states,
        bit_pos: stream.bit_pos,
    })
}

/// Returns the size of the stream in bits, or `None` if the output is too small.
fn encode_sequences_into(
    dst: &mut [u8],
    tables: &FseCTables,
    codes: &[SeqCodes],
    sequences: &[SeqDef],
    many_bits: bool,
) -> Option<usize> {
    *dst.first_mut()? = 1;
    let mut stream = SeqStream { dst, bit_pos: 0 };
    let last_codes = codes.last()?;
    let mut states = SeqStates {
        lit_length: (tables.litlength_c_table).first_state(last_codes.ll as u8),
        match_length: (tables.matchlength_c_table).first_state(last_codes.ml as u8),
        offset_bits: tables.offcode_c_table.first_state(last_codes.of as u8),
    };
    // The sequence whose extra bits are to be written: the last one, which has nothing else to write,
    let mut apart = codes.len() - 1;
    loop {
        let (seq_codes, seq) = (codes.get(apart)?, sequences.get(apart)?);
        stream.write(u32::from(seq.lit_length), seq_codes.ll_bits())?;
        stream.write(u32::from(seq.ml_base), seq_codes.ml_bits())?;
        stream.write(seq.off_base, seq_codes.of as u32)?;

        // then each that has too many.
        let left = codes.get(..apart)?;
        let next = if many_bits {
            left.iter().rposition(|codes| codes.has_many_bits())
        } else {
            None
        };
        let run = encode_run(
            stream.dst,
            stream.bit_pos,
            tables,
            states,
            left.get(next.unwrap_or(0)..)?,
        )?;
        states = run.states;
        stream.bit_pos = run.bit_pos;
        match next {
            Some(next) => apart = next,
            None => break,
        }
    }

    // `FSE_flushCState`
    stream.write(states.match_length, tables.matchlength_c_table.table_log)?;
    stream.write(states.offset_bits, tables.offcode_c_table.table_log)?;
    stream.write(states.lit_length, tables.litlength_c_table.table_log)?;
    // `BIT_closeCStream`: a bit set, which is there.
    Some(stream.bit_pos + 1)
}

/// `ZSTD_encodeSequences`: `codes` are those of `sequences`, of which there is at least one. Without `many_bits`, none
/// has too many extra bits to be written at once.
pub(crate) fn encode_sequences(
    dst: &mut [u8],
    tables: &FseCTables,
    codes: &[SeqCodes],
    sequences: &[SeqDef],
    many_bits: bool,
) -> Result<usize> {
    let capacity = dst.len();
    encode_sequences_into(dst, tables, codes, sequences, many_bits)
        // The stream has to end before the last position that a container can be written to.
        .filter(|nb_bits| (nb_bits >> 3) + size_of::<u64>() < capacity)
        .map(|nb_bits| nb_bits.div_ceil(8))
        .ok_or(Error::DstSizeTooSmall)
}
