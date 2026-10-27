//! `lossless_enc.c`, `lossless_common.h`: fixed-point logarithms and entropies, prefix codes, colour transforms.

use crate::util::{Checked, SliceExt};

/// The number of fractional bits of every logarithm, entropy and cost.
pub(crate) const LOG_2_PRECISION_BITS: u32 = 23;
const LOG_LOOKUP_IDX_MAX: u32 = 256;
const APPROX_LOG_WITH_CORRECTION_MAX: u32 = 65536;
const APPROX_LOG_MAX: u32 = 4096;
/// `(1 << LOG_2_PRECISION_BITS) / ln(2)`
const LOG_2_RECIPROCAL_FIXED_DOUBLE: f64 = 12102203.161561485379934310913085937500;
const LOG_2_RECIPROCAL_FIXED: u64 = 12102203;

/// `round(log2(i) * (1 << LOG_2_PRECISION_BITS))`
#[rustfmt::skip]
static LOG2_TABLE: [u32; LOG_LOOKUP_IDX_MAX as usize] = [
    0, 0, 8388608, 13295629, 16777216, 19477745, 21684237, 23549800, 25165824,
    26591258, 27866353, 29019816, 30072845, 31041538, 31938408, 32773374, 33554432, 34288123,
    34979866, 35634199, 36254961, 36845429, 37408424, 37946388, 38461453, 38955489, 39430146,
    39886887, 40327016, 40751698, 41161982, 41558811, 41943040, 42315445, 42676731, 43027545,
    43368474, 43700062, 44022807, 44337167, 44643569, 44942404, 45234037, 45518808, 45797032,
    46069003, 46334996, 46595268, 46850061, 47099600, 47344097, 47583753, 47818754, 48049279,
    48275495, 48497560, 48715624, 48929828, 49140306, 49347187, 49550590, 49750631, 49947419,
    50141058, 50331648, 50519283, 50704053, 50886044, 51065339, 51242017, 51416153, 51587818,
    51757082, 51924012, 52088670, 52251118, 52411415, 52569616, 52725775, 52879946, 53032177,
    53182516, 53331012, 53477707, 53622645, 53765868, 53907416, 54047327, 54185640, 54322389,
    54457611, 54591338, 54723604, 54854440, 54983876, 55111943, 55238669, 55364082, 55488208,
    55611074, 55732705, 55853126, 55972361, 56090432, 56207362, 56323174, 56437887, 56551524,
    56664103, 56775645, 56886168, 56995691, 57104232, 57211808, 57318436, 57424133, 57528914,
    57632796, 57735795, 57837923, 57939198, 58039632, 58139239, 58238033, 58336027, 58433234,
    58529666, 58625336, 58720256, 58814437, 58907891, 59000628, 59092661, 59183999, 59274652,
    59364632, 59453947, 59542609, 59630625, 59718006, 59804761, 59890898, 59976426, 60061354,
    60145690, 60229443, 60312620, 60395229, 60477278, 60558775, 60639726, 60720140, 60800023,
    60879382, 60958224, 61036555, 61114383, 61191714, 61268554, 61344908, 61420785, 61496188,
    61571124, 61645600, 61719620, 61793189, 61866315, 61939001, 62011253, 62083076, 62154476,
    62225457, 62296024, 62366182, 62435935, 62505289, 62574248, 62642816, 62710997, 62778797,
    62846219, 62913267, 62979946, 63046260, 63112212, 63177807, 63243048, 63307939, 63372484,
    63436687, 63500551, 63564080, 63627277, 63690146, 63752690, 63814912, 63876816, 63938405,
    63999682, 64060650, 64121313, 64181673, 64241734, 64301498, 64360969, 64420148, 64479040,
    64537646, 64595970, 64654014, 64711782, 64769274, 64826495, 64883447, 64940132, 64996553,
    65052711, 65108611, 65164253, 65219641, 65274776, 65329662, 65384299, 65438691, 65492840,
    65546747, 65600416, 65653847, 65707044, 65760008, 65812741, 65865245, 65917522, 65969575,
    66021404, 66073013, 66124403, 66175575, 66226531, 66277275, 66327806, 66378127, 66428240,
    66478146, 66527847, 66577345, 66626641, 66675737, 66724635, 66773336, 66821842, 66870154,
    66918274, 66966204, 67013944, 67061497,
];

/// `round(i * log2(i) * (1 << LOG_2_PRECISION_BITS))`
#[rustfmt::skip]
static SLOG2_TABLE: [u64; LOG_LOOKUP_IDX_MAX as usize] = [
    0, 0, 16777216, 39886887, 67108864, 97388723, 130105423,
    164848600, 201326592, 239321324, 278663526, 319217973, 360874141, 403539997,
    447137711, 491600606, 536870912, 582898099, 629637592, 677049776, 725099212,
    773754010, 822985323, 872766924, 923074875, 973887230, 1025183802, 1076945958,
    1129156447, 1181799249, 1234859451, 1288323135, 1342177280, 1396409681, 1451008871,
    1505964059, 1561265072, 1616902301, 1672866655, 1729149526, 1785742744, 1842638548,
    1899829557, 1957308741, 2015069397, 2073105127, 2131409817, 2189977618, 2248802933,
    2307880396, 2367204859, 2426771383, 2486575220, 2546611805, 2606876748, 2667365819,
    2728074942, 2789000187, 2850137762, 2911484006, 2973035382, 3034788471, 3096739966,
    3158886666, 3221225472, 3283753383, 3346467489, 3409364969, 3472443085, 3535699182,
    3599130679, 3662735070, 3726509920, 3790452862, 3854561593, 3918833872, 3983267519,
    4047860410, 4112610476, 4177515704, 4242574127, 4307783833, 4373142952, 4438649662,
    4504302186, 4570098787, 4636037770, 4702117480, 4768336298, 4834692645, 4901184974,
    4967811774, 5034571569, 5101462912, 5168484389, 5235634615, 5302912235, 5370315922,
    5437844376, 5505496324, 5573270518, 5641165737, 5709180782, 5777314477, 5845565671,
    5913933235, 5982416059, 6051013057, 6119723161, 6188545324, 6257478518, 6326521733,
    6395673979, 6464934282, 6534301685, 6603775250, 6673354052, 6743037185, 6812823756,
    6882712890, 6952703725, 7022795412, 7092987118, 7163278025, 7233667324, 7304154222,
    7374737939, 7445417707, 7516192768, 7587062379, 7658025806, 7729082328, 7800231234,
    7871471825, 7942803410, 8014225311, 8085736859, 8157337394, 8229026267, 8300802839,
    8372666477, 8444616560, 8516652476, 8588773618, 8660979393, 8733269211, 8805642493,
    8878098667, 8950637170, 9023257446, 9095958945, 9168741125, 9241603454, 9314545403,
    9387566451, 9460666086, 9533843800, 9607099093, 9680431471, 9753840445, 9827325535,
    9900886263, 9974522161, 10048232765, 10122017615, 10195876260, 10269808253, 10343813150,
    10417890516, 10492039919, 10566260934, 10640553138, 10714916116, 10789349456, 10863852751,
    10938425600, 11013067604, 11087778372, 11162557513, 11237404645, 11312319387, 11387301364,
    11462350205, 11537465541, 11612647010, 11687894253, 11763206912, 11838584638, 11914027082,
    11989533899, 12065104750, 12140739296, 12216437206, 12292198148, 12368021795, 12443907826,
    12519855920, 12595865759, 12671937032, 12748069427, 12824262637, 12900516358, 12976830290,
    13053204134, 13129637595, 13206130381, 13282682202, 13359292772, 13435961806, 13512689025,
    13589474149, 13666316903, 13743217014, 13820174211, 13897188225, 13974258793, 14051385649,
    14128568535, 14205807192, 14283101363, 14360450796, 14437855239, 14515314443, 14592828162,
    14670396151, 14748018167, 14825693972, 14903423326, 14981205995, 15059041743, 15136930339,
    15214871554, 15292865160, 15370910930, 15449008641, 15527158071, 15605359001, 15683611210,
    15761914485, 15840268608, 15918673369, 15997128556, 16075633960, 16154189373, 16232794589,
    16311449405, 16390153617, 16468907026, 16547709431, 16626560636, 16705460444, 16784408661,
    16863405094, 16942449552, 17021541845, 17100681785,
];

/// `DivRound` by a positive constant.
#[inline]
pub(crate) const fn div_round<const B: i64>(a: i64) -> i64 {
    if a < 0 {
        a.wrapping_sub(B / 2) / B
    } else {
        a.wrapping_add(B / 2) / B
    }
}

/// `BitsLog2Floor`, and 0 for 0.
#[inline]
pub(crate) const fn bits_log2_floor(n: u32) -> u32 {
    31 - (n | 1).leading_zeros()
}

/// `(small << log_cnt) + rest`, with `small` below `LOG_LOOKUP_IDX_MAX`.
struct Split {
    small: u32,
    log_cnt: u32,
    rest: u32,
}

/// `v` is at least `LOG_LOOKUP_IDX_MAX`.
#[inline]
fn split_for_lookup(v: u32) -> Split {
    let log_cnt = bits_log2_floor(v).saturating_sub(7);
    Split {
        small: v >> log_cnt,
        log_cnt,
        rest: v & ((1 << log_cnt) - 1),
    }
}

#[inline]
fn lookup_log2(v: u32) -> u32 {
    LOG2_TABLE.get(v as usize).copied().unwrap_or(0)
}

fn fast_slog2_slow(v: u32) -> u64 {
    if v < APPROX_LOG_WITH_CORRECTION_MAX {
        let Split {
            small,
            log_cnt,
            rest,
        } = split_for_lookup(v);
        // log2(1 + d) is about d / ln(2) for the small d that `rest` amounts to.
        let correction = LOG_2_RECIPROCAL_FIXED * u64::from(rest);
        let log_2 = u64::from(lookup_log2(small)) + (u64::from(log_cnt) << LOG_2_PRECISION_BITS);
        u64::from(v) * log_2 + correction
    } else {
        let v = f64::from(v);
        (LOG_2_RECIPROCAL_FIXED_DOUBLE * v * v.ln() + 0.5) as u64
    }
}

fn fast_log2_slow(v: u32) -> u32 {
    if v < APPROX_LOG_WITH_CORRECTION_MAX {
        let Split {
            small,
            log_cnt,
            rest,
        } = split_for_lookup(v);
        let mut log_2 = lookup_log2(small) + (log_cnt << LOG_2_PRECISION_BITS);
        if v >= APPROX_LOG_MAX {
            let correction = LOG_2_RECIPROCAL_FIXED * u64::from(rest);
            log_2 += ((correction + u64::from(v) / 2) / u64::from(v)) as u32;
        }
        log_2
    } else {
        (LOG_2_RECIPROCAL_FIXED_DOUBLE * f64::from(v).ln() + 0.5) as u32
    }
}

/// `VP8LFastLog2`: `log2(v)`, and 0 for 0.
#[inline]
pub(crate) fn fast_log2(v: u32) -> u32 {
    match LOG2_TABLE.get(v as usize) {
        Some(&log) => log,
        None => fast_log2_slow(v),
    }
}

/// `VP8LFastSLog2`: `v * log2(v)`, and 0 for 0.
#[inline]
pub(crate) fn fast_slog2(v: u32) -> u64 {
    match SLOG2_TABLE.get(v as usize) {
        Some(&slog) => slog,
        None => fast_slog2_slow(v),
    }
}

/// `VP8LPrefixCode`: how a length or a distance is written.
#[derive(Clone, Copy)]
pub(crate) struct PrefixCode {
    /// The symbol that goes through the entropy coder.
    pub(crate) code: usize,
    /// How many bits follow it as they are.
    pub(crate) extra_bits: u32,
    pub(crate) extra_bits_value: u32,
}

/// `VP8LPrefixEncode`. 0 is not a length or a distance, but the cost model asks for it.
#[inline]
pub(crate) fn prefix_encode(distance: u32) -> PrefixCode {
    if distance <= 2 {
        return PrefixCode {
            code: distance.saturating_sub(1) as usize,
            extra_bits: 0,
            extra_bits_value: 0,
        };
    }
    let distance = distance - 1;
    let highest_bit = bits_log2_floor(distance);
    let extra_bits = highest_bit - 1;
    let second_highest_bit = (distance >> extra_bits) & 1;
    PrefixCode {
        code: (2 * highest_bit + second_highest_bit) as usize,
        extra_bits,
        extra_bits_value: distance & ((1 << extra_bits) - 1),
    }
}

/// The histogram of the tiles done so far, with the terms of its entropy: every candidate is compared with it.
pub(crate) struct Accumulated {
    counts: [u32; 256],
    /// `fast_slog2` of each count.
    slog2: [u64; 256],
    sum: u32,
    slog2_sum: u64,
}

impl Accumulated {
    pub(crate) const fn new() -> Self {
        Self {
            counts: [0; 256],
            slog2: [0; 256],
            sum: 0,
            slog2_sum: 0,
        }
    }

    pub(crate) fn add(&mut self, x: &[u32; 256]) {
        for ((&x, count), slog2) in x.iter().zip(&mut self.counts).zip(&mut self.slog2) {
            if x != 0 {
                *count += x;
                self.sum += x;
                let old = core::mem::replace(slog2, fast_slog2(*count));
                self.slog2_sum = self.slog2_sum.wrapping_add(*slog2).wrapping_sub(old);
            }
        }
    }
}

/// `VP8LCombinedShannonEntropy`: the entropy of `x` plus that of `x + y`. Where `x` is 0, `y` has the term already.
pub(crate) fn combined_shannon_entropy(x: &[u32; 256], y: &Accumulated) -> u64 {
    let mut retval = y.slog2_sum;
    let mut sum_x = 0u32;
    for ((x, y_counts), y_slog2) in x
        .as_chunks::<8>()
        .0
        .iter()
        .zip(y.counts.as_chunks::<8>().0)
        .zip(y.slog2.as_chunks::<8>().0)
    {
        if *x == [0; 8] {
            continue;
        }
        for ((&x, &y), &y_slog2) in x.iter().zip(y_counts).zip(y_slog2) {
            if x != 0 {
                sum_x += x;
                retval = retval
                    .wrapping_add(fast_slog2(x) + fast_slog2(x + y))
                    .wrapping_sub(y_slog2);
            }
        }
    }
    (fast_slog2(sum_x) + fast_slog2(sum_x + y.sum)).wrapping_sub(retval)
}

/// `VP8LBitEntropy`
#[derive(Clone, Copy, Default)]
pub(crate) struct BitEntropy {
    pub(crate) entropy: u64,
    /// The sum of the population.
    pub(crate) sum: u32,
    /// How many elements are not 0.
    pub(crate) nonzeros: u32,
    pub(crate) max_val: u32,
    /// The start of the last run of elements that are not 0.
    pub(crate) nonzero_code: usize,
}

/// `VP8LStreaks`: runs of equal elements. The first index says whether the elements are other than 0.
#[derive(Clone, Copy, Default)]
pub(crate) struct Streaks {
    /// How many runs are longer than 3.
    pub(crate) counts: [u32; 2],
    /// The total length of the runs, by whether they are longer than 3.
    pub(crate) streaks: [[u32; 2]; 2],
}

/// `VP8LBitsEntropyUnrefined`
pub(crate) fn bits_entropy_unrefined(array: &[u32]) -> BitEntropy {
    let mut entropy = BitEntropy::default();
    for (i, &count) in array.iter().enumerate() {
        if count != 0 {
            entropy.sum += count;
            entropy.nonzero_code = i;
            entropy.nonzeros += 1;
            entropy.entropy += fast_slog2(count);
            entropy.max_val = entropy.max_val.max(count);
        }
    }
    entropy.entropy = fast_slog2(entropy.sum).wrapping_sub(entropy.entropy);
    entropy
}

const CHUNK_LEN: usize = 16;

/// Splits a population into runs of equal values.
struct Runs {
    bit_entropy: BitEntropy,
    stats: Streaks,
    /// The value of the current run, where it starts, and where it ends so far.
    val: u32,
    start: usize,
    end: usize,
}

impl Runs {
    fn new(first: u32) -> Self {
        Self {
            bit_entropy: BitEntropy::default(),
            stats: Streaks::default(),
            val: first,
            start: 0,
            end: 0,
        }
    }

    /// `GetEntropyUnrefinedHelper`: takes in the current run.
    #[inline]
    fn end_run(&mut self) {
        let streak = (self.end - self.start) as u32;
        let [zero, nonzero] = &mut self.stats.streaks;
        let [zero_count, nonzero_count] = &mut self.stats.counts;
        let (streaks, count) = if self.val != 0 {
            let bit_entropy = &mut self.bit_entropy;
            bit_entropy.sum += self.val * streak;
            bit_entropy.nonzeros += streak;
            bit_entropy.nonzero_code = self.start;
            bit_entropy.entropy += fast_slog2(self.val) * u64::from(streak);
            bit_entropy.max_val = bit_entropy.max_val.max(self.val);
            (nonzero, nonzero_count)
        } else {
            (zero, zero_count)
        };
        let [short, long] = streaks;
        if streak > 3 {
            *count += 1;
            *long += streak;
        } else {
            *short += streak;
        }
    }

    #[inline]
    fn push(&mut self, val: u32) {
        if val != self.val {
            self.end_run();
            self.val = val;
            self.start = self.end;
        }
        self.end += 1;
    }

    /// The population of a small tile is little else than long runs of 0, which this goes through quickly.
    #[inline]
    fn push_chunk(&mut self, chunk: impl Iterator<Item = u32> + Clone) {
        let val = self.val;
        if chunk
            .clone()
            .fold(0, |differences, v| differences | (v ^ val))
            == 0
        {
            self.end += CHUNK_LEN;
        } else {
            chunk.for_each(|val| self.push(val));
        }
    }

    fn finish(mut self) -> (BitEntropy, Streaks) {
        self.end_run();
        self.bit_entropy.entropy =
            fast_slog2(self.bit_entropy.sum).wrapping_sub(self.bit_entropy.entropy);
        (self.bit_entropy, self.stats)
    }
}

/// `VP8LGetEntropyUnrefined`
pub(crate) fn get_entropy_unrefined(x: &[u32]) -> (BitEntropy, Streaks) {
    let mut runs = Runs::new(x.first().copied().unwrap_or(0));
    let (chunks, rest) = x.as_chunks::<CHUNK_LEN>();
    for chunk in chunks {
        runs.push_chunk(chunk.iter().copied());
    }
    rest.iter().for_each(|&val| runs.push(val));
    runs.finish()
}

/// `VP8LGetCombinedEntropyUnrefined`: of `x + y`, which are of the same length.
pub(crate) fn get_combined_entropy_unrefined(x: &[u32], y: &[u32]) -> (BitEntropy, Streaks) {
    let first = x.iter().zip(y).next().map_or(0, |(x, y)| x + y);
    let mut runs = Runs::new(first);
    let (x_chunks, x_rest) = x.as_chunks::<CHUNK_LEN>();
    let (y_chunks, y_rest) = y.as_chunks::<CHUNK_LEN>();
    for (x, y) in x_chunks.iter().zip(y_chunks) {
        runs.push_chunk(x.iter().zip(y).map(|(x, y)| x + y));
    }
    for (x, y) in x_rest.iter().zip(y_rest) {
        runs.push(x + y);
    }
    runs.finish()
}

/// `VP8LSubtractGreenFromBlueAndRed`
pub(crate) fn subtract_green_from_blue_and_red(argb_data: &mut [u32]) {
    for argb in argb_data {
        let green = (*argb >> 8) & 0xff;
        let new_r = ((*argb >> 16) & 0xff).wrapping_sub(green) & 0xff;
        let new_b = (*argb & 0xff).wrapping_sub(green) & 0xff;
        *argb = (*argb & 0xff00_ff00) | (new_r << 16) | new_b;
    }
}

/// `VP8LMultipliers`: signed, in 3.5 fixed point.
#[derive(Clone, Copy, Default)]
pub(crate) struct Multipliers {
    pub(crate) green_to_red: u8,
    pub(crate) green_to_blue: u8,
    pub(crate) red_to_blue: u8,
}

#[inline]
const fn color_transform_delta(color_pred: u8, color: u8) -> i32 {
    (color_pred as i8 as i32 * color as i8 as i32) >> 5
}

#[inline]
const fn transform_color_red(green_to_red: u8, argb: u32) -> u8 {
    let [_, green, red, _] = argb.to_le_bytes();
    (red as i32 - color_transform_delta(green_to_red, green)) as u8
}

#[inline]
const fn transform_color_blue(green_to_blue: u8, red_to_blue: u8, argb: u32) -> u8 {
    let [blue, green, red, _] = argb.to_le_bytes();
    (blue as i32
        - color_transform_delta(green_to_blue, green)
        - color_transform_delta(red_to_blue, red)) as u8
}

/// `VP8LTransformColor`
pub(crate) fn transform_color(m: Multipliers, data: &mut [u32]) {
    for argb in data {
        let new_red = transform_color_red(m.green_to_red, *argb);
        let new_blue = transform_color_blue(m.green_to_blue, m.red_to_blue, *argb);
        *argb = (*argb & 0xff00_ff00) | (u32::from(new_red) << 16) | u32::from(new_blue);
    }
}

/// The most pixels that a tile of the colour transform has.
const MAX_COLOR_TILE_SIZE: usize = 32 * 32;

/// The pixels of a tile, one channel after another so that trying a multiplier on all of them vectorises.
pub(crate) struct ColorTile {
    len: usize,
    /// Each is a signed byte.
    red: [i16; MAX_COLOR_TILE_SIZE],
    green: [i16; MAX_COLOR_TILE_SIZE],
    blue: [i16; MAX_COLOR_TILE_SIZE],
}

/// `ColorTransformDelta` of two signed bytes.
#[inline]
const fn delta(color_pred: i16, color: i16) -> i16 {
    (color_pred * color) >> 5
}

/// Equal values often follow each other and an increment waits for the one before, so they go to different tables.
fn histogram_of(values: &[u8]) -> [u32; 256] {
    let mut histos = [[0u32; 256]; 4];
    let (quads, rest) = values.as_chunks::<4>();
    for quad in quads {
        for (histo, &value) in histos.iter_mut().zip(quad) {
            if let Some(count) = histo.get_mut(usize::from(value)) {
                *count += 1;
            }
        }
    }
    let [mut sum, others @ ..] = histos;
    for &value in rest {
        if let Some(count) = sum.get_mut(usize::from(value)) {
            *count += 1;
        }
    }
    for other in &others {
        add_vector_eq(other, &mut sum);
    }
    sum
}

impl ColorTile {
    /// `argb` goes from the first pixel of the tile to its last.
    pub(crate) fn new(argb: &[u32], stride: usize, tile_width: usize) -> Checked<Self> {
        let mut tile = Self {
            len: 0,
            red: [0; MAX_COLOR_TILE_SIZE],
            green: [0; MAX_COLOR_TILE_SIZE],
            blue: [0; MAX_COLOR_TILE_SIZE],
        };
        for row in argb.chunks(stride.max(1)) {
            let row = row.sub(..tile_width)?;
            let range = tile.len..tile.len + tile_width;
            for (((&argb, red), green), blue) in row
                .iter()
                .zip(tile.red.sub_mut(range.clone())?)
                .zip(tile.green.sub_mut(range.clone())?)
                .zip(tile.blue.sub_mut(range)?)
            {
                let [b, g, r, _] = argb.to_le_bytes();
                *red = (r as i8).into();
                *green = (g as i8).into();
                *blue = (b as i8).into();
            }
            tile.len += tile_width;
        }
        Ok(tile)
    }

    /// `VP8LCollectColorRedTransforms`: the histogram of red after the transform.
    pub(crate) fn collect_color_red_transforms(&self, green_to_red: u8) -> [u32; 256] {
        let green_to_red = i16::from(green_to_red as i8);
        let mut values = [0u8; MAX_COLOR_TILE_SIZE];
        for ((value, &red), &green) in values
            .iter_mut()
            .zip(&self.red)
            .zip(&self.green)
            .take(self.len)
        {
            *value = (red - delta(green_to_red, green)) as u8;
        }
        histogram_of(values.get(..self.len).unwrap_or_default())
    }

    /// `VP8LCollectColorBlueTransforms`: the histogram of blue after the transform.
    pub(crate) fn collect_color_blue_transforms(
        &self,
        green_to_blue: u8,
        red_to_blue: u8,
    ) -> [u32; 256] {
        let green_to_blue = i16::from(green_to_blue as i8);
        let red_to_blue = i16::from(red_to_blue as i8);
        let mut values = [0u8; MAX_COLOR_TILE_SIZE];
        for (((value, &red), &green), &blue) in values
            .iter_mut()
            .zip(&self.red)
            .zip(&self.green)
            .zip(&self.blue)
            .take(self.len)
        {
            *value = (blue - delta(green_to_blue, green) - delta(red_to_blue, red)) as u8;
        }
        histogram_of(values.get(..self.len).unwrap_or_default())
    }
}

/// `VP8LVectorMismatch`: how many elements the two have in common at their start.
#[inline]
pub(crate) fn vector_mismatch(array1: &[u32], array2: &[u32]) -> usize {
    // Most matches end at once.
    let pairs = array1.iter().zip(array2).take(8);
    match pairs.take_while(|(a, b)| a == b).count() {
        8 => long_vector_mismatch(array1, array2),
        short => short,
    }
}

#[inline(never)]
fn long_vector_mismatch(array1: &[u32], array2: &[u32]) -> usize {
    let chunks = array1.as_chunks::<8>().0.iter().zip(array2.as_chunks().0);
    let start = 8 * chunks.take_while(|(a, b)| a == b).count();
    let rest = array1.iter().zip(array2).skip(start);
    start + rest.take_while(|(a, b)| a == b).count()
}

/// `VP8LBundleColorMap`: packs `1 << xbits` palette indices into the green channel of each pixel.
pub(crate) fn bundle_color_map(row: &[u8], xbits: u32, dst: &mut [u32]) {
    if xbits == 0 {
        for (&index, dst) in row.iter().zip(dst) {
            *dst = 0xff00_0000 | (u32::from(index) << 8);
        }
        return;
    }
    let bit_depth = 8 >> xbits;
    for (indices, dst) in row.chunks(1 << xbits).zip(dst) {
        let mut code = 0xff00_0000;
        let mut shift = 8;
        for &index in indices {
            code |= u32::from(index) << shift;
            shift += bit_depth;
        }
        *dst = code;
    }
}

/// `VP8LExtraCost`: how many extra bits the lengths or distances counted in `population` take.
pub(crate) fn extra_cost(population: &[u32]) -> u32 {
    population
        .as_chunks()
        .0
        .iter()
        .skip(2)
        .zip(1..)
        .map(|(&[even, odd], extra_bits)| extra_bits * (even + odd))
        .sum()
}

/// `VP8LAddVectorEq`
#[inline]
pub(crate) fn add_vector_eq(a: &[u32], out: &mut [u32]) {
    for (out, a) in out.iter_mut().zip(a) {
        *out += a;
    }
}
