//! Operands for tests of vector operations.

#![allow(clippy::disallowed_methods)]
#![allow(dead_code, reason = "each test uses a part")]

use std::fmt::Debug;

use bun_engine_asm::{Size, lanes};

pub(crate) struct Random(pub(crate) u64);

impl Random {
    /// SplitMix64.
    pub(crate) fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut mixed = self.0;
        mixed = (mixed ^ mixed >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mixed = (mixed ^ mixed >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
        mixed ^ mixed >> 31
    }

    pub(crate) fn below(&mut self, limit: usize) -> usize {
        (self.next() % limit as u64) as usize
    }

    pub(crate) fn bits(&mut self) -> u128 {
        u128::from(self.next()) << 64 | u128::from(self.next())
    }
}

/// Values of a lane at which operations change their behaviour.
struct Boundaries {
    lanes: Size,
    values: Vec<u64>,
}

fn integers(lanes: Size) -> Boundaries {
    let bits = lanes.bits();
    let mut values = vec![0x5555_5555_5555_5555, 0x0f0f_0f0f_0f0f_0f0f, 15, 16, 17, 31];
    for power in [0, 1, bits / 2 - 1, bits / 2, bits - 2, bits - 1] {
        values.extend([-1, 0, 1].map(|delta| (1u64 << power).wrapping_add_signed(delta)));
    }
    with_opposites(lanes, values, u64::wrapping_neg)
}

const ROUNDING_TIES: [f64; 7] = [0.5, 1.5, 2.5, 3.5, 32_767.5, 65_535.5, 4_194_303.5];
const CONVERSION_LIMITS: [f64; 8] = [
    1.0,
    8_388_608.0,
    16_777_216.0,
    2_147_483_648.0,
    4_294_967_296.0,
    4_503_599_627_370_496.0,
    9_223_372_036_854_775_808.0,
    18_446_744_073_709_551_616.0,
];

fn floats(lanes: Size, fraction_bits: u8, more: &[f64], bits: fn(f64) -> u64) -> Boundaries {
    let sign = 1 << (lanes.bits() - 1);
    let (least_normal, infinity) = (1 << fraction_bits, bits(f64::INFINITY));
    let quiet = least_normal >> 1;
    let mut values = vec![0, 1, sign - 1, infinity | 0x1234, infinity | quiet >> 1];
    let exact = ROUNDING_TIES.iter().chain(&CONVERSION_LIMITS).chain(more);
    let special = [least_normal, infinity, infinity | quiet];
    for value in exact.copied().map(bits).chain(special) {
        values.extend([value - 1, value, value + 1]);
    }
    with_opposites(lanes, values, |value| value ^ sign)
}

fn with_opposites(lanes: Size, values: Vec<u64>, opposite: impl Fn(u64) -> u64) -> Boundaries {
    let mask = u64::MAX >> (64 - lanes.bits());
    let both = values
        .into_iter()
        .flat_map(|value| [value, opposite(value)]);
    let mut values: Vec<u64> = both.map(|value| value & mask).collect();
    values.sort_unstable();
    values.dedup();
    Boundaries { lanes, values }
}

fn boundaries() -> [Boundaries; 6] {
    let between_integers = [2_147_483_647.0, 2_147_483_647.5, 2_147_483_649.0];
    let between_unsigned = [4_294_967_295.0, 4_294_967_295.5];
    let (least, greatest) = (f64::from(f32::from_bits(1)), f64::from(f32::MAX));
    let between_singles = [
        least / 2.0,
        least * 1.5,
        f32::MIN_POSITIVE.into(),
        1.0 + f64::from(f32::EPSILON) / 2.0,
        1.0 + f64::from(f32::EPSILON) * 1.5,
        greatest,
        greatest + 2f64.powi(103),
    ];
    let doubles = [&between_integers[..], &between_unsigned, &between_singles].concat();
    [
        integers(Size::S8),
        integers(Size::S16),
        integers(Size::S32),
        integers(Size::S64),
        floats(Size::S32, 23, &[], |value| (value as f32).to_bits().into()),
        floats(Size::S64, 52, &doubles, f64::to_bits),
    ]
}

impl Boundaries {
    fn vector(&self, mut index: impl FnMut() -> usize) -> u128 {
        (0..lanes::count(self.lanes)).fold(0, |vector, lane| {
            let value = self.values[index() % self.values.len()];
            lanes::replace(self.lanes, vector, lane, value)
        })
    }

    /// Every pair of values is in the same lane of the first two vectors of some item. The values move through the
    /// lanes of the second.
    fn pairs(&self, random: &mut Random) -> Vec<[u128; 3]> {
        let (len, count) = (self.values.len(), usize::from(lanes::count(self.lanes)));
        let items = (0..len * len).step_by(count).map(|first| {
            let (mut a, mut b) = (first.., first..);
            [
                self.vector(|| a.next().unwrap() / len),
                self.vector(|| b.next().map(|pair| pair + pair / len).unwrap()),
                self.vector(|| random.below(len)),
            ]
        });
        items.collect()
    }

    fn random_item(&self, index: usize, random: &mut Random) -> [u128; 3] {
        match index % 4 {
            0 => [(); 3].map(|()| random.bits()),
            1 => [(); 3].map(|()| self.vector(|| random.next() as usize)),
            // Close enough for floats to cancel and for some lanes to be equal.
            2 => {
                let near = random.bits();
                let low = lanes::splat(self.lanes, u64::MAX >> (64 - self.lanes.bits() / 2));
                [(); 3].map(|()| near ^ random.bits() & random.bits() & low)
            }
            _ => [(); 3].map(|()| random.bits() & random.bits() & random.bits() & random.bits()),
        }
    }
}

/// Operands for each kind of lane.
pub(crate) struct Operands([Vec<[u128; 3]>; 6]);

impl Operands {
    /// All pairs of boundaries, and `count` random items of several sorts.
    pub(crate) fn new(seed: u64, count: usize) -> Self {
        let mut random = Random(seed);
        Self(boundaries().map(|kind| {
            let mut all = vec![[0; 3], [u128::MAX; 3]];
            all.extend(kind.pairs(&mut random));
            all.extend((0..count).map(|index| kind.random_item(index, &mut random)));
            all
        }))
    }

    /// For the lanes that `op` reads, which are the last that its name has.
    pub(crate) fn of(&self, op: impl Debug) -> &[[u128; 3]] {
        let name = format!("{op:?}");
        let shapes = ["I8x16", "I16x8", "I32x4", "I64x2", "F32x4", "F64x2"];
        let places = shapes.map(|shape| name.rfind(shape));
        &self.0[(0..places.len()).max_by_key(|&kind| places[kind]).unwrap()]
    }
}

/// Those that have short forms, and their neighbours.
pub(crate) fn constants(random: &mut Random) -> Vec<u128> {
    let mut all = vec![random.bits()];
    for Boundaries { lanes, values } in boundaries() {
        all.extend(values.into_iter().map(|value| lanes::splat(lanes, value)));
    }
    for byte in 0..=255u64 {
        for size in [Size::S8, Size::S16, Size::S32] {
            for shift in (0..size.bits()).step_by(8) {
                all.push(lanes::splat(size, byte << shift));
                all.push(lanes::splat(size, byte << shift | ((1 << shift) - 1)));
            }
        }
        let bytes = (0..8).fold(0, |bytes, bit| {
            bytes | ((byte >> bit & 1) * 0xff) << (8 * bit)
        });
        let magnitude = (16 + byte % 16) as f64 / 128.0 * f64::from(1 << (byte / 16 % 8));
        let float = if byte < 128 { magnitude } else { -magnitude };
        all.extend([
            lanes::splat(Size::S64, bytes),
            lanes::splat(Size::S64, float.to_bits()),
            lanes::splat(Size::S32, (float as f32).to_bits().into()),
        ]);
    }
    let variants = all.into_iter().flat_map(|bits| {
        let flipped = bits ^ 1 << random.below(128);
        let (low32, low64) = (u128::from(bits as u32), u128::from(bits as u64));
        [bits, !bits, low32, low64, bits << 64, flipped]
    });
    let mut all: Vec<_> = variants.collect();
    all.sort_unstable();
    all.dedup();
    all
}
