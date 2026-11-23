//! What the kernels take and fill in.

/// 4x4 samples, by column and row.
pub(crate) type Block = [[u8; 4]; 4];

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Macroblock {
    pub(crate) luma: [Block; 16],
    /// U, then V.
    pub(crate) chroma: [Block; 8],
}

/// For each sample of chroma, 4 times the average of the pixels that it covers, below `1 << 14`.
#[derive(Default)]
pub(crate) struct LinearColors {
    /// By red, green or blue, row in the upper or lower half, the half, and column.
    pub(crate) sums: [[[[u16; 8]; 2]; 4]; 3],
}

pub(crate) struct GammaTable {
    /// For each 512 steps of a sum.
    pub(crate) values: [u8; 32],
    /// The difference to the next value.
    pub(crate) slopes: [u8; 32],
}

/// The samples around the luma of a macroblock, or around its U and then its V.
pub(crate) struct Edges {
    pub(crate) above: [u8; 16],
    /// From the bottom up.
    pub(crate) left: [u8; 16],
    /// Of luma, only the first counts.
    pub(crate) above_left: [u8; 2],
    pub(crate) dc: [u8; 2],
}

/// `level = ((|coefficient| + sharpening) * reciprocal + bias) >> 17`. Each value is there twice.
#[derive(Clone, Copy)]
pub(crate) struct Quantizer {
    /// For the first row of coefficients, and for the others.
    pub(crate) steps: [[[i16; 2]; 4]; 2],
    pub(crate) reciprocals: [[[i16; 2]; 4]; 2],
    /// The lower 16 bits.
    pub(crate) doubled_reciprocals: [[[i16; 2]; 4]; 2],
    /// `2 * (65536 - bias) - 1`
    pub(crate) limits: [[[i16; 2]; 4]; 2],
    pub(crate) sharpening: [[[i16; 2]; 4]; 4],
}

/// The highest magnitude that `Candidates::symbols` tells from the others.
pub(crate) const MAX_SYMBOL: u8 = 67;
/// The mode of a subblock is not DC, and no more than 3 levels behind the first are other than zero.
pub(crate) const IS_FLAT: u8 = 128;

/// What becomes of a block with each of `2 * PAIRS` prediction modes. Mode `m` is in pair `m / 2`, in the lower half of
/// the numbers if it is even.
#[repr(C)]
pub(crate) struct Candidates<const PAIRS: usize> {
    /// By row, pair and column, twice 16 bits.
    pub(crate) levels: [[[u32; 4]; PAIRS]; 4],
    /// By half of the zigzag order, pair and position in the half, twice 8 bits: the magnitude of the level, up to
    /// `MAX_SYMBOL`, plus `MAX_SYMBOL + 1` times the context that it is coded in.
    pub(crate) symbols: [[[u16; 8]; PAIRS]; 2],
    /// Of the decoded block: the bottom row from the left, then the rest of the right column from the bottom.
    pub(crate) edges: [[[u8; 8]; 2]; PAIRS],
}

impl<const PAIRS: usize> Candidates<PAIRS> {
    const ZERO: Self = Self {
        levels: [[[0; _]; _]; _],
        symbols: [[[0; _]; _]; _],
        edges: [[[0; _]; _]; _],
    };
}

/// The luma of a macroblock as the kernels need it.
#[repr(C)]
pub(crate) struct LumaSource {
    pub(super) columns: [[[i16; 8]; 16]; 4],
    pub(super) spectra: [[[i16; 4]; 16]; 4],
    pub(super) textures: [i32; 16],
}

#[repr(C)]
pub(crate) struct LumaCandidates {
    pub(crate) blocks: [Candidates<2>; 16],
    /// Without edges.
    pub(crate) y2: Candidates<2>,
    /// By half of the blocks, pair, block in the half and mode in the pair: 4 times the position behind the last level
    /// other than zero, plus the context there.
    pub(crate) ends: [[[[u8; 2]; 8]; 2]; 2],
    /// By pair, 8 times the same.
    pub(crate) y2_ends: [[[u8; 2]; 8]; 2],
    pub(crate) squared_errors: [i32; 4],
    pub(crate) texture_differences: [i32; 4],
}

/// Whether any magnitude is `MAX_SYMBOL` or more.
#[derive(Clone, Copy)]
pub(crate) struct LumaSaturation {
    pub(crate) blocks: bool,
    pub(crate) y2: bool,
}

#[repr(C)]
pub(crate) struct SubblockCandidates {
    /// There are 10 modes.
    pub(crate) block: Candidates<6>,
    /// By mode, times 256.
    pub(crate) distortions: [i32; 16],
    /// By mode, as in `LumaCandidates`, plus `IS_FLAT`.
    pub(crate) ends: [u8; 32],
}

#[repr(C)]
pub(crate) struct ChromaCandidates {
    pub(crate) blocks: [Candidates<2>; 8],
    pub(crate) ends: [[[u8; 2]; 8]; 2],
    /// How many levels are neither the first of a block nor zero. By pair, 8 times the same.
    pub(crate) ac_counts: [[[u8; 2]; 8]; 2],
    pub(crate) squared_errors: [i32; 4],
    /// Of blocks 1 and 2, then of block 3 and something else: by pair, block, plane and mode in the pair.
    pub(crate) dc_errors: [[[[[i16; 2]; 2]; 2]; 2]; 2],
}

/// Room for the kernels to write to. The order of the fields, here and in the parts, keeps the vectors aligned.
#[repr(C, align(32))]
pub(crate) struct Scratch {
    pub(crate) source: LumaSource,
    pub(crate) luma: LumaCandidates,
    pub(crate) subblock: SubblockCandidates,
    pub(crate) chroma: ChromaCandidates,
}

impl Default for Scratch {
    #[inline(always)]
    fn default() -> Self {
        const {
            Self {
                source: LumaSource {
                    columns: [[[0; _]; _]; _],
                    spectra: [[[0; _]; _]; _],
                    textures: [0; _],
                },
                luma: LumaCandidates {
                    blocks: [Candidates::ZERO; _],
                    y2: Candidates::ZERO,
                    ends: [[[[0; _]; _]; _]; _],
                    y2_ends: [[[0; _]; _]; _],
                    squared_errors: [0; _],
                    texture_differences: [0; _],
                },
                subblock: SubblockCandidates {
                    block: Candidates::ZERO,
                    distortions: [0; _],
                    ends: [0; _],
                },
                chroma: ChromaCandidates {
                    blocks: [Candidates::ZERO; _],
                    ends: [[[0; _]; _]; _],
                    ac_counts: [[[0; _]; _]; _],
                    squared_errors: [0; _],
                    dc_errors: [[[[[0; _]; _]; _]; _]; _],
                },
            }
        }
    }
}

/// For DC and TrueMotion prediction, how the coefficients spread over 32 bins.
#[derive(Clone, Copy, Default)]
pub(crate) struct Histograms {
    pub(crate) highest_count: [u32; 2],
    pub(crate) last_bin: [u32; 2],
}
