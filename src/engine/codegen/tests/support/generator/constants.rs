//! Numbers at which things tend to go wrong.

use bun_engine_asm::{Size, lanes};
use bun_engine_codegen::ir::Type;

use super::Class;
use crate::support::datum::all_bits;
use crate::support::memory::{Layout, Region};
use crate::support::random::Random;

pub(super) fn integer(ty: Type, random: &mut Random) -> i64 {
    let width = u32::from(ty.width().bits());
    let power = |random: &mut Random| 1i64 << random.below(width as usize);
    let edge = |random: &mut Random| 1i64 << random.pick(&[7, 8, 15, 16, 31, width - 1, width / 2]);
    let value = match random.below(16) {
        0 => 0,
        1 => 1,
        2 => -1,
        3 | 4 => random.between(-8, 40),
        5 => power(random),
        6 => power(random).wrapping_sub(1),
        7 => power(random).wrapping_neg(),
        8 => power(random).wrapping_add(1),
        9 => edge(random).wrapping_add(random.between(-2, 2)),
        10 => edge(random)
            .wrapping_neg()
            .wrapping_add(random.between(-2, 2)),
        11 => power(random).wrapping_sub(power(random)),
        12 => !power(random).wrapping_sub(power(random)),
        13 => random.between(-5000, 70000),
        14 => random.pick(&[
            0x5555_5555_5555_5555,
            0x00ff_00ff_00ff_00ff,
            0x0f0f_0f0f_0f0f_0f0f,
            -0x0002_0000_0000_0000,
        ]),
        _ => random.next() as i64 >> random.pick(&[0, 0, 16, 32, 40]),
    };
    if ty == Type::I32 {
        (value as i32).into()
    } else {
        value
    }
}

pub(super) fn float(ty: Type, random: &mut Random) -> u64 {
    const SPECIAL: [f64; 24] = [
        0.0,
        -0.0,
        1.0,
        -1.0,
        2.0,
        0.5,
        -0.5,
        0.25,
        1.5,
        2.5,
        0.1,
        f64::INFINITY,
        f64::NEG_INFINITY,
        2_147_483_647.0,
        2_147_483_648.0,
        -2_147_483_648.0,
        -2_147_483_649.0,
        4_294_967_295.0,
        4_294_967_296.0,
        9_223_372_036_854_775_808.0,
        -9_223_372_036_854_775_808.0,
        18_446_744_073_709_551_616.0,
        16_777_217.0,
        65520.0,
    ];
    let (exponent_bits, fraction_bits) = if ty == Type::F32 { (8, 23) } else { (11, 52) };
    let sign = u64::from(random.flip()) << (exponent_bits + fraction_bits);
    let infinity = ((1 << exponent_bits) - 1) << fraction_bits;
    let quiet = 1 << (fraction_bits - 1);
    let number = match random.below(16) {
        0..6 => random.pick(&SPECIAL),
        6..10 => random.between(-40, 40) as f64 / 4.0,
        10 => 2f64.powi(random.between(-160, 160) as i32),
        11 => f64::from(f32::from_bits(random.next() as u32)),
        12 => return sign | infinity | quiet,
        13 => return sign | infinity | random.pick(&[1, quiet | 1, quiet / 2, 2 * quiet - 1]),
        14 => {
            return sign
                | random.pick(&[
                    1,
                    2 * quiet - 1,
                    2 * quiet,
                    infinity - 1,
                    infinity - 2 * quiet,
                ]);
        }
        _ => return random.next() & all_bits(ty) as u64,
    };
    if ty == Type::F32 {
        (number as f32).to_bits().into()
    } else {
        number.to_bits()
    }
}

pub(super) fn vector(random: &mut Random) -> u128 {
    let size = random.pick(&[Size::S8, Size::S16, Size::S32, Size::S64]);
    let is_float = size >= Size::S32 && random.flip();
    let lane = |random: &mut Random| match size {
        Size::S32 if is_float => float(Type::F32, random),
        Size::S64 if is_float => float(Type::F64, random),
        _ => integer(size.width().into(), random) as u64,
    };
    match random.below(8) {
        0 => 0,
        1 => u128::MAX,
        2 | 3 => lanes::splat(size, lane(random)),
        4 => random.next128(),
        _ => (0..lanes::count(size)).fold(0, |vector, index| {
            lanes::replace(size, vector, index, lane(random))
        }),
    }
}

#[derive(Clone, Copy)]
pub(super) struct Temper<'a> {
    /// The lower it is, the likelier it is that arithmetic does not overflow and that indices are in range.
    pub(super) level: usize,
    pub(super) remarkable: &'a [i64],
}

fn tempered_integer(ty: Type, temper: Temper<'_>, random: &mut Random) -> i64 {
    match temper.level {
        0 => random.between(0, 12),
        1 if !random.one_in(4) => random.between(-20, 300),
        2 if random.flip() => random.next() as i64,
        3 if !random.one_in(4) => {
            let (number, other) = (
                random.pick(temper.remarkable),
                random.pick(temper.remarkable),
            );
            let related = [
                number,
                number,
                number.wrapping_neg(),
                number.wrapping_sub(other),
                number ^ other,
            ];
            random
                .pick(&related)
                .wrapping_add(random.pick(&[0, 0, -1, 1]))
        }
        _ => integer(ty, random),
    }
}

fn tempered_float(ty: Type, temper: Temper<'_>, random: &mut Random) -> u64 {
    let number = match temper.level {
        0 => random.between(-100, 100) as f64 / 8.0,
        3 if random.flip() => {
            random.pick(temper.remarkable) as f64 + random.pick(&[0.0, 0.5, -1.0])
        }
        _ => return float(ty, random),
    };
    if ty == Type::F32 {
        (number as f32).to_bits().into()
    } else {
        number.to_bits()
    }
}

pub(super) fn word(temper: Temper<'_>, random: &mut Random) -> u64 {
    let half = |random: &mut Random| match random.below(3) {
        0 => tempered_float(Type::F32, temper, random),
        _ => (tempered_integer(Type::I32, temper, random) as u32).into(),
    };
    match random.below(4) {
        0 => tempered_float(Type::F64, temper, random),
        1 => half(random) << 32 | half(random),
        _ => tempered_integer(Type::I64, temper, random) as u64,
    }
}

pub(super) fn argument(
    class: Class,
    temper: Temper<'_>,
    layout: &Layout,
    random: &mut Random,
) -> u128 {
    let bits = |ty, value: i64| u128::from(value as u64) & all_bits(ty);
    match class {
        Class::Data(Type::V128) if temper.level == 0 => {
            u128::from(word(temper, random)) << 64 | u128::from(word(temper, random))
        }
        Class::Data(Type::V128) => vector(random),
        Class::Data(ty) if ty.is_float() => tempered_float(ty, temper, random).into(),
        Class::Data(ty) => bits(ty, tempered_integer(ty, temper, random)),
        Class::Index { below, .. } => random.below(below as usize) as u128,
        Class::Divisor(ty) => {
            let divisor = bits(ty, tempered_integer(ty, temper, random));
            if divisor == 0 || divisor == all_bits(ty) {
                3
            } else {
                divisor
            }
        }
        Class::Pointer(pointer) => {
            assert!(pointer.region == Region::Objects);
            layout.object(random.next()).into()
        }
        Class::Callee(signature) => layout.callees[2 * signature + random.below(2)].into(),
        Class::Loose(_) | Class::LooseLanes(_) | Class::Narrowable | Class::Identity => {
            unreachable!("arguments are determined")
        }
    }
}
