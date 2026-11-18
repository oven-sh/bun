//! What goes into registers and memory.

#![allow(dead_code, reason = "each test uses a part")]

use bun_engine_asm::{FloatWidth, Size};

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

    pub(crate) fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.below(items.len())]
    }

    pub(crate) fn vector(&mut self) -> u128 {
        u128::from(self.next()) << 64 | u128::from(self.next())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Int(Size),
    Float(FloatWidth),
}

impl Kind {
    pub(crate) fn size(self) -> Size {
        match self {
            Self::Int(size) => size,
            Self::Float(width) => width.width().size(),
        }
    }
}

pub(crate) fn mask(size: Size) -> u64 {
    u64::MAX >> (64 - size.bits())
}

pub(crate) fn sign_extend(size: Size, value: u64) -> i64 {
    let above = 64 - size.bits();
    (value as i64) << above >> above
}

fn sorted(mut values: Vec<u64>, size: Size) -> Vec<u64> {
    for value in &mut values {
        *value &= mask(size);
    }
    values.sort_unstable();
    values.dedup();
    values
}

fn integers(size: Size) -> Vec<u64> {
    let mut values = vec![
        0x5555_5555_5555_5555,
        0x0123_4567_89ab_cdef,
        46_341,
        3_037_000_500,
    ];
    for power in [0, 1, 5, 6, 7, 8, 15, 16, 31, 32, 62, 63] {
        values.extend([-1, 0, 1].map(|delta| (1u64 << power).wrapping_add_signed(delta)));
    }
    values.extend(values.clone().into_iter().map(u64::wrapping_neg));
    sorted(values, size)
}

pub(crate) fn float_bits(width: FloatWidth, value: f64) -> u64 {
    match width {
        FloatWidth::F32 => (value as f32).to_bits().into(),
        FloatWidth::F64 => value.to_bits(),
    }
}

fn floats(width: FloatWidth) -> Vec<u64> {
    let size = width.width().size();
    let sign = 1 << (size.bits() - 1);
    let infinity = float_bits(width, f64::INFINITY);
    let least_normal = infinity.isolate_lowest_one();
    let mut values = vec![0, 1, sign - 1, infinity | 0x1234];
    let powers = [-25, -24, -14, 0, 23, 24, 31, 32, 52, 53, 63, 64, 84].map(|n| 2f64.powi(n));
    let others = [
        0.5,
        1.5,
        2.5,
        0.1,
        65_504.0,
        65_520.0,
        1.0 + 1.0 / 2048.0,
        1.0 + 3.0 / 2048.0,
        2_147_483_647.0,
        2_147_483_647.5,
        2_147_483_648.5,
        2_147_483_649.0,
        4_294_967_295.0,
        4_294_967_295.5,
        f32::MAX.into(),
        f32::MIN_POSITIVE.into(),
    ];
    let exact = powers.into_iter().chain(others);
    let special = [least_normal, infinity, infinity | least_normal >> 1];
    for value in exact.map(|value| float_bits(width, value)).chain(special) {
        values.extend([value - 1, value, value + 1]);
    }
    values.extend(values.clone().into_iter().map(|value| value ^ sign));
    let mut values = sorted(values, size);
    let (one, quiet) = (float_bits(width, 1.0), least_normal >> 1);
    let foremost = [
        0,
        1,
        one,
        one + 1,
        infinity - 1,
        infinity,
        infinity + 1,
        infinity | quiet,
    ];
    values.sort_by_key(|value| !foremost.contains(&(value & !sign)));
    values
}

/// The boundaries of floats start with this many that are worth pairing with all others.
pub(crate) const FOREMOST_FLOATS: usize = 16;

/// The values at which operations change their behaviour.
pub(crate) struct Boundaries {
    integers: [Vec<u64>; 4],
    floats: [Vec<u64>; 2],
}

impl Boundaries {
    pub(crate) fn new() -> Self {
        Self {
            integers: [Size::S8, Size::S16, Size::S32, Size::S64].map(integers),
            floats: [FloatWidth::F32, FloatWidth::F64].map(floats),
        }
    }

    pub(crate) fn of(&self, kind: Kind) -> &[u64] {
        match kind {
            Kind::Int(size) => &self.integers[size as usize],
            Kind::Float(width) => &self.floats[width as usize],
        }
    }

    /// Often close to `related`, which is another operand.
    pub(crate) fn draw(&self, kind: Kind, related: Option<u64>, random: &mut Random) -> u64 {
        let size = kind.size();
        let sign = 1u64 << (size.bits() - 1);
        let step = random.pick(&[0, 0, 1, -1]);
        let value = match (random.below(8), related, kind) {
            (0..=2, Some(related), _) => related.wrapping_add_signed(step),
            (3, Some(related), Kind::Float(_)) => related ^ sign,
            (3, Some(related), Kind::Int(_)) => random
                .pick(&[
                    related.wrapping_neg(),
                    !related,
                    sign.wrapping_sub(related),
                    sign.wrapping_add(related),
                    sign / (sign_extend(size, related).unsigned_abs() | 1),
                ])
                .wrapping_add_signed(step),
            (4, _, Kind::Int(_)) => random.next() >> random.below(64),
            (4, _, Kind::Float(width)) => {
                let integer = (random.next() as i64 >> random.below(64)) as f64;
                float_bits(width, integer / random.pick(&[1.0, 2.0, 4.0, 4096.0]))
            }
            (5, ..) => random.next(),
            _ => random.pick(self.of(kind)),
        };
        value & mask(size)
    }
}
