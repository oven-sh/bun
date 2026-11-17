//! The kernels of `bun_webp`, from src/jsc/bindings/highway_webp_*.cpp.

unsafe extern "C" {
    safe fn highway_webp_inverse_dct(coefficients: &mut [[i16; 64]; 6], non_zero: u32);

    safe fn highway_webp_reconstruct_subblocks(
        above: &[u8; 16],
        above_right: &[u8; 4],
        left: &[u8; 20],
        modes: &[[u8; 4]; 4],
        residuals: &[[i16; 64]; 4],
        samples: &mut [[u8; 16]; 16],
    );

    fn highway_webp_filter_normally(
        y: *mut u8,
        y_stride: usize,
        u: *mut u8,
        v: *mut u8,
        uv_stride: usize,
        strengths: *const FilterStrength,
        count: usize,
        has_above: bool,
    );

    fn highway_webp_filter_simply(
        y: *mut u8,
        y_stride: usize,
        strengths: *const FilterStrength,
        count: usize,
        has_above: bool,
    );

    fn highway_webp_upsample(
        upper: *const u8,
        lower: *const u8,
        to_upper: *mut u8,
        to_lower: *mut u8,
        count: usize,
    );

    fn highway_webp_yuv_to_rgba(
        y: *const u8,
        u: *const u8,
        v: *const u8,
        alpha: *const u8,
        rgba: *mut [u8; 4],
        width: usize,
    );

    fn highway_webp_undo_prediction(
        row: *mut [u8; 4],
        above: *const [u8; 4],
        width: usize,
        tiles: *const [u8; 4],
        tile_bits: u32,
    );

    fn highway_webp_undo_cross_color(
        row: *mut [u8; 4],
        width: usize,
        tiles: *const [u8; 4],
        tile_bits: u32,
    );
}

/// Turns the coefficients of a macroblock's 24 blocks into what is added to their prediction. Four blocks are side by
/// side, in four rows of 16. If none of them has its bit in `non_zero` set, they are left alone. Otherwise those that
/// do not have it have only zeros.
#[inline(always)]
pub fn inverse_dct(coefficients: &mut [[i16; 64]; 6], non_zero: u32) {
    highway_webp_inverse_dct(coefficients, non_zero);
}

/// Predicts each 4 by 4 samples of a macroblock's luma from those before them, and adds what `inverse_dct()` left.
/// `left` has the sample in the corner, the 16 below it, and 3 that do not count. `modes` are numbered as in libwebp.
#[inline(always)]
pub fn reconstruct_subblocks(
    above: &[u8; 16],
    above_right: &[u8; 4],
    left: &[u8; 20],
    modes: &[[u8; 4]; 4],
    residuals: &[[i16; 64]; 4],
    samples: &mut [[u8; 16]; 16],
) {
    highway_webp_reconstruct_subblocks(above, above_right, left, modes, residuals, samples);
}

/// How the loop filter treats a macroblock.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct FilterStrength {
    /// For the edges inside of it, 4 less than for those around it. 0: it is left as it is.
    pub edge_limit: u8,
    pub interior_limit: u8,
    pub high_variance_threshold: u8,
    pub filters_inner_edges: bool,
}

/// One channel of a row of macroblocks, below some rows of the macroblocks above.
pub struct Plane<'a> {
    pub samples: &'a mut [u8],
    pub stride: usize,
    /// Where in `samples` the first macroblock starts.
    pub start: usize,
}

impl Plane<'_> {
    /// To the first of `count` macroblocks of `size` samples by `size`, which have `rows_above`.
    #[inline(always)]
    fn as_mut_ptr(&mut self, size: usize, count: usize, rows_above: usize) -> *mut u8 {
        let below = self.samples.len().saturating_sub(self.start);
        assert!(
            count <= self.stride / size
                && self.stride <= below / size
                && self.stride.saturating_mul(rows_above) <= self.start
        );
        self.samples.as_mut_ptr().wrapping_add(self.start)
    }
}

/// VP8's normal loop filter, for as many macroblocks as there are `strengths`. Four rows are above them. Unless
/// `has_above`, the edge to those is that of the picture.
#[inline(always)]
pub fn filter_normally(
    [mut y, mut u, mut v]: [Plane; 3],
    strengths: &[FilterStrength],
    has_above: bool,
) {
    assert_eq!(u.stride, v.stride);
    let count = strengths.len();
    // SAFETY: the kernel stays within the macroblocks and the four rows above them, which `as_mut_ptr()` checks.
    unsafe {
        highway_webp_filter_normally(
            y.as_mut_ptr(16, count, 4),
            y.stride,
            u.as_mut_ptr(8, count, 4),
            v.as_mut_ptr(8, count, 4),
            u.stride,
            strengths.as_ptr(),
            count,
            has_above,
        );
    }
}

/// The simple one, which is for luma alone and needs two rows.
#[inline(always)]
pub fn filter_simply(mut y: Plane, strengths: &[FilterStrength], has_above: bool) {
    let count = strengths.len();
    // SAFETY: the kernel stays within the macroblocks and the two rows above them, which `as_mut_ptr()` checks.
    unsafe {
        highway_webp_filter_simply(
            y.as_mut_ptr(16, count, 2),
            y.stride,
            strengths.as_ptr(),
            count,
            has_above,
        );
    }
}

/// The most samples that `upsample()` and `yuv_to_rgba()` take at once.
pub const ROW_STEP: usize = 32;

/// From two rows of chroma to the two rows of pixels between them: two samples for each of the first `count` pairs of
/// neighbors. All slices are long enough for a multiple of `ROW_STEP` pairs.
#[inline(always)]
pub fn upsample(from: [&[u8]; 2], to: [&mut [u8]; 2], count: usize) {
    let padded = count.div_ceil(ROW_STEP).saturating_mul(ROW_STEP);
    assert!(from.iter().all(|row| row.len() > padded));
    assert!(to.iter().all(|row| row.len() / 2 >= padded));
    let ([upper, lower], [to_upper, to_lower]) = (from, to);
    // SAFETY: the kernel goes no further than asserted above.
    unsafe {
        highway_webp_upsample(
            upper.as_ptr(),
            lower.as_ptr(),
            to_upper.as_mut_ptr(),
            to_lower.as_mut_ptr(),
            count,
        );
    }
}

/// `width` pixels from `start` on, in the place of those that `rgba` has there and in the room behind them. The inputs
/// are long enough for a multiple of `ROW_STEP` pixels.
#[inline(always)]
pub fn yuv_to_rgba(yuva: [&[u8]; 4], rgba: &mut Vec<[u8; 4]>, start: usize, width: usize) {
    assert!(start <= rgba.len() && width <= rgba.capacity() - start);
    let padded = width.next_multiple_of(ROW_STEP);
    assert!(yuva.iter().all(|row| row.len() >= padded));
    let [y, u, v, alpha] = yuva.map(<[u8]>::as_ptr);
    // SAFETY: the kernel writes all of the `width` pixels, and reads no more than asserted above.
    unsafe {
        highway_webp_yuv_to_rgba(y, u, v, alpha, rgba.as_mut_ptr().add(start), width);
        rgba.set_len(rgba.len().max(start + width));
    }
}

/// Undoes VP8L's predictor transform for a row other than the first, whose pixels have alpha last. The second byte of
/// a tile is the mode for `1 << tile_bits` pixels.
#[inline(always)]
pub fn undo_prediction(row: &mut [[u8; 4]], above: &[[u8; 4]], tiles: &[[u8; 4]], tile_bits: u32) {
    assert!(!row.is_empty() && row.len() == above.len());
    assert!(tile_bits < 16 && (row.len() - 1) >> tile_bits < tiles.len());
    // SAFETY: the kernel stays within `row.len()` pixels of both rows, and reads the tiles of those.
    unsafe {
        highway_webp_undo_prediction(
            row.as_mut_ptr(),
            above.as_ptr(),
            row.len(),
            tiles.as_ptr(),
            tile_bits,
        );
    }
}

/// Undoes VP8L's cross-color transform for a row of RGBA. A tile has the multipliers red to blue, green to blue and
/// green to red for `1 << tile_bits` pixels.
#[inline(always)]
pub fn undo_cross_color(row: &mut [[u8; 4]], tiles: &[[u8; 4]], tile_bits: u32) {
    assert!(tile_bits < 16 && row.len().div_ceil(1 << tile_bits) <= tiles.len());
    // SAFETY: the kernel stays within `row`, and reads the tiles of its pixels.
    unsafe { highway_webp_undo_cross_color(row.as_mut_ptr(), row.len(), tiles.as_ptr(), tile_bits) }
}

// ─── Lossy encoder ──────────────────────────────────────────────────────────

unsafe extern "C" {
    safe fn highway_webp_convert(
        pixels: &[&[[u8; 4]; 16]; 16],
        colors: &LinearColors,
        gamma: &GammaTable,
        out: &mut Macroblock,
    );

    safe fn highway_webp_analyze(
        samples: &Macroblock,
        luma_edges: &Edges,
        chroma_edges: &Edges,
        out: &mut [Histograms; 2],
    );

    safe fn highway_webp_try_luma_modes(
        samples: &Macroblock,
        edges: &Edges,
        non_zero_around: u64,
        y2_context: u8,
        ac: &Quantizer,
        y2: &Quantizer,
        source: &mut LumaSource,
        out: &mut LumaCandidates,
    ) -> u8;

    safe fn highway_webp_try_straight_modes(
        edge_start: u64,
        edge_end: u64,
        context: u8,
        block: usize,
        source: &LumaSource,
        quantizer: &Quantizer,
        texture_lambda: i32,
        out: &mut SubblockCandidates,
    ) -> u8;

    safe fn highway_webp_try_diagonal_modes(
        edge_start: u64,
        edge_end: u64,
        context: u8,
        block: usize,
        source: &LumaSource,
        quantizer: &Quantizer,
        texture_lambda: i32,
        out: &mut SubblockCandidates,
    ) -> u8;

    safe fn highway_webp_try_chroma_modes(
        samples: &Macroblock,
        edges: &Edges,
        non_zero_around: u64,
        quantizer: &Quantizer,
        errors_around: Option<&[[i16; 8]; 2]>,
        out: &mut ChromaCandidates,
    ) -> bool;
}

/// 4x4 samples, by column and row.
pub type Block = [[u8; 4]; 4];

#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Macroblock {
    pub luma: [Block; 16],
    /// U, then V.
    pub chroma: [Block; 8],
}

/// For each sample of chroma, 4 times the average of the pixels that it covers, below `1 << 14`.
#[repr(C)]
#[derive(Default)]
pub struct LinearColors {
    /// By red, green or blue, row in the upper or lower half, the half, and column.
    pub sums: [[[[u16; 8]; 2]; 4]; 3],
}

#[repr(C)]
pub struct GammaTable {
    /// For each 512 steps of a sum.
    pub values: [u8; 32],
    /// The difference to the next value.
    pub slopes: [u8; 32],
}

/// The samples around the luma of a macroblock, or around its U and then its V.
#[repr(C)]
pub struct Edges {
    pub above: [u8; 16],
    /// From the bottom up.
    pub left: [u8; 16],
    /// Of luma, only the first counts.
    pub above_left: [u8; 2],
    pub dc: [u8; 2],
}

/// `level = ((|coefficient| + sharpening) * reciprocal + bias) >> 17`. Each value is there twice.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Quantizer {
    /// For the first row of coefficients, and for the others.
    pub steps: [[[i16; 2]; 4]; 2],
    pub reciprocals: [[[i16; 2]; 4]; 2],
    /// The lower 16 bits.
    pub doubled_reciprocals: [[[i16; 2]; 4]; 2],
    /// `2 * (65536 - bias) - 1`
    pub limits: [[[i16; 2]; 4]; 2],
    pub sharpening: [[[i16; 2]; 4]; 4],
}

/// The highest magnitude that `Candidates::symbols` tells from the others.
pub const MAX_SYMBOL: u8 = 67;
/// The mode of a subblock is not DC, and no more than 3 levels behind the first are other than zero.
pub const IS_FLAT: u8 = 128;

/// What becomes of a block with each of `2 * PAIRS` prediction modes. Mode `m` is in pair `m / 2`, in the lower half of
/// the numbers if it is even.
#[repr(C)]
pub struct Candidates<const PAIRS: usize> {
    /// By row, pair and column, twice 16 bits.
    pub levels: [[[u32; 4]; PAIRS]; 4],
    /// By half of the zigzag order, pair and position in the half, twice 8 bits: the magnitude of the level, up to
    /// `MAX_SYMBOL`, plus `MAX_SYMBOL + 1` times the context that it is coded in.
    pub symbols: [[[u16; 8]; PAIRS]; 2],
    /// Of the decoded block: the bottom row from the left, then the rest of the right column from the bottom.
    pub edges: [[[u8; 8]; 2]; PAIRS],
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
pub struct LumaSource {
    columns: [[[i16; 8]; 16]; 4],
    spectra: [[[i16; 4]; 16]; 4],
    textures: [i32; 16],
}

#[repr(C)]
pub struct LumaCandidates {
    pub blocks: [Candidates<2>; 16],
    /// Without edges.
    pub y2: Candidates<2>,
    /// By half of the blocks, pair, block in the half and mode in the pair: 4 times the position behind the last level
    /// other than zero, plus the context there.
    pub ends: [[[[u8; 2]; 8]; 2]; 2],
    /// By pair, 8 times the same.
    pub y2_ends: [[[u8; 2]; 8]; 2],
    pub squared_errors: [i32; 4],
    pub texture_differences: [i32; 4],
}

/// Whether any magnitude is `MAX_SYMBOL` or more.
#[derive(Clone, Copy)]
pub struct LumaSaturation {
    pub blocks: bool,
    pub y2: bool,
}

#[repr(C)]
pub struct SubblockCandidates {
    /// There are 10 modes.
    pub block: Candidates<6>,
    /// By mode, times 256.
    pub distortions: [i32; 16],
    /// By mode, as in `LumaCandidates`, plus `IS_FLAT`.
    pub ends: [u8; 32],
}

#[repr(C)]
pub struct ChromaCandidates {
    pub blocks: [Candidates<2>; 8],
    pub ends: [[[u8; 2]; 8]; 2],
    /// How many levels are neither the first of a block nor zero. By pair, 8 times the same.
    pub ac_counts: [[[u8; 2]; 8]; 2],
    pub squared_errors: [i32; 4],
    /// Of blocks 1 and 2, then of block 3 and something else: by pair, block, plane and mode in the pair.
    pub dc_errors: [[[[[i16; 2]; 2]; 2]; 2]; 2],
}

/// Room for the kernels to write to.
#[repr(C, align(32))]
pub struct Scratch {
    pub source: LumaSource,
    pub luma: LumaCandidates,
    pub subblock: SubblockCandidates,
    pub chroma: ChromaCandidates,
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
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Histograms {
    pub highest_count: [u32; 2],
    pub last_bin: [u32; 2],
}

// The same numbers are in highway_webp_encoder.cpp.
const _: () = assert!(
    size_of::<Macroblock>() == 384
        && size_of::<LinearColors>() == 384
        && size_of::<GammaTable>() == 64
        && size_of::<Edges>() == 36
        && size_of::<Quantizer>() == 192
        && size_of::<LumaSource>() == 1600
        && size_of::<LumaCandidates>() == 3936
        && size_of::<SubblockCandidates>() == 768
        && size_of::<ChromaCandidates>() == 1936
        && size_of::<Histograms>() == 16
);

/// Luma from the rows of `pixels`, and chroma from `colors`.
#[inline(always)]
pub fn convert(
    pixels: &[&[[u8; 4]; 16]; 16],
    colors: &LinearColors,
    gamma: &GammaTable,
    out: &mut Macroblock,
) {
    highway_webp_convert(pixels, colors, gamma, out);
}

#[inline(always)]
fn bytes(flags: [[bool; 4]; 2]) -> u64 {
    let [low, high] = flags.map(|it| u64::from(u32::from_le_bytes(it.map(u8::from))));
    low | high << 32
}

/// For luma and chroma.
#[inline(always)]
pub fn analyze(samples: &Macroblock, luma_edges: &Edges, chroma_edges: &Edges) -> [Histograms; 2] {
    let mut out = [Histograms::default(); 2];
    highway_webp_analyze(samples, luma_edges, chroma_edges, &mut out);
    out
}

/// DC, TrueMotion, vertical and horizontal. Fills `source`. `non_zero_around` is for the blocks above and those to the
/// left. `ac` has to make zero of the first coefficient.
#[inline(always)]
pub fn try_luma_modes(
    samples: &Macroblock,
    edges: &Edges,
    non_zero_around: [[bool; 4]; 2],
    y2_context: u8,
    [ac, y2]: [&Quantizer; 2],
    source: &mut LumaSource,
    out: &mut LumaCandidates,
) -> LumaSaturation {
    let around = bytes(non_zero_around);
    let bits = highway_webp_try_luma_modes(samples, edges, around, y2_context, ac, y2, source, out);
    LumaSaturation {
        blocks: bits & 1 != 0,
        y2: bits & 2 != 0,
    }
}

#[derive(Clone, Copy)]
pub struct Subblock {
    pub index: usize,
    /// 13 samples, from the lowest byte: up along the left, around the corner and to the right.
    pub edge: u128,
    /// How many of the blocks above and to the left have levels other than zero.
    pub context: u8,
}

/// The first 4 modes, numbered as in libwebp. Returns the highest of their ends, or `u8::MAX` if any magnitude is
/// `MAX_SYMBOL` or more.
#[inline(always)]
pub fn try_straight_modes(
    block: Subblock,
    source: &LumaSource,
    quantizer: &Quantizer,
    texture_lambda: i32,
    out: &mut SubblockCandidates,
) -> u8 {
    let (start, end) = (block.edge as u64, (block.edge >> 64) as u64);
    let (context, index) = (block.context, block.index);
    highway_webp_try_straight_modes(
        start,
        end,
        context,
        index,
        source,
        quantizer,
        texture_lambda,
        out,
    )
}

/// The same for the other 6 modes. What `out` has for the first 4 stays.
#[inline(always)]
pub fn try_diagonal_modes(
    block: Subblock,
    source: &LumaSource,
    quantizer: &Quantizer,
    texture_lambda: i32,
    out: &mut SubblockCandidates,
) -> u8 {
    let (start, end) = (block.edge as u64, (block.edge >> 64) as u64);
    let (context, index) = (block.context, block.index);
    highway_webp_try_diagonal_modes(
        start,
        end,
        context,
        index,
        source,
        quantizer,
        texture_lambda,
        out,
    )
}

/// `errors_around`, from above and from the left, are passed on from one DC to the next. They are by block and plane,
/// each twice. Returns whether any magnitude is `MAX_SYMBOL` or more.
#[inline(always)]
pub fn try_chroma_modes(
    samples: &Macroblock,
    edges: &Edges,
    non_zero_around: [[bool; 4]; 2],
    quantizer: &Quantizer,
    errors_around: Option<&[[i16; 8]; 2]>,
    out: &mut ChromaCandidates,
) -> bool {
    let around = bytes(non_zero_around);
    highway_webp_try_chroma_modes(samples, edges, around, quantizer, errors_around, out)
}
