#[path = "support/vectors.rs"]
mod vectors;

use bun_engine_asm::{
    FloatWidth, Relaxed, Shift, Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary,
    VectorUnary, lanes,
};
use vectors::Operands;

const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
const COUNTING: u128 = 0x0f0e_0d0c_0b0a_0908_0706_0504_0302_0100;

fn vector<const N: usize>(values: [i64; N]) -> u128 {
    let size = SIZES[(16 / N).trailing_zeros() as usize];
    (0..).zip(values).fold(0, |vector, (lane, value)| {
        lanes::replace(size, vector, lane, value as u64)
    })
}

fn f32x4(values: [f32; 4]) -> u128 {
    vector(values.map(|value| value.to_bits().into()))
}

fn f64x2(values: [f64; 2]) -> u128 {
    vector(values.map(|value| value.to_bits() as i64))
}

#[test]
fn lanes_are_read_and_written() {
    assert_eq!(lanes::splat(Size::S8, 0x1ff), u128::MAX);
    assert_eq!(lanes::splat(Size::S32, 0x1_0000_0002), vector([2; 4]));
    let negative = !COUNTING;
    assert_eq!(
        lanes::extract(Size::S8, Sign::Signed, negative, 15),
        0xffff_fff0
    );
    assert_eq!(lanes::extract(Size::S8, Sign::Unsigned, negative, 15), 0xf0);
    assert_eq!(
        lanes::extract(Size::S16, Sign::Signed, negative, 1),
        0xffff_fcfd
    );
    assert_eq!(
        lanes::extract(Size::S32, Sign::Signed, negative, 3),
        0xf0f1_f2f3
    );
    assert_eq!(
        lanes::extract(Size::S64, Sign::Signed, negative, 1),
        0xf0f1_f2f3_f4f5_f6f7
    );
    assert_eq!(
        lanes::replace(Size::S16, u128::MAX, 7, 0x1_1234),
        vector([-1, -1, -1, -1, -1, -1, -1, 0x1234])
    );
    assert_eq!(
        lanes::extend(Size::S16, Sign::Signed, 0x8000_7fff_ffff_0001),
        vector([1, -1, 0x7fff, -0x8000])
    );
    assert_eq!(
        lanes::extend(Size::S32, Sign::Unsigned, 0x8000_0000_ffff_ffff),
        vector([0xffff_ffff, 0x8000_0000])
    );
    let indices = [
        31,
        0,
        16,
        15,
        32,
        lanes::ZERO,
        255,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
    ];
    assert_eq!(
        lanes::shuffle(COUNTING, negative, indices),
        vector([0xf0, 0, 0xff, 15, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    );
}

#[test]
fn integers() {
    use VectorBinary::*;
    let a = vector([-0x8000, -0x8000, 0x7fff, -1, 0x4000, 1, 0x100, -0x81]);
    let b = vector([-0x8000, -0x7fff, 0x7fff, -1, 1, -1, 0xff, 0x80]);
    for (op, expected) in [
        (
            I16x8Q15MulrSatS,
            vector([0x7fff, 0x7fff, 0x7ffe, 0, 1, 0, 2, -1]),
        ),
        (
            I16x8AvgrU,
            vector([0x8000, 0x8001, 0x7fff, -1, 0x2001, 0x8000, 0x100, 0x8000]),
        ),
        (
            I16x8AddSatS,
            vector([-0x8000, -0x8000, 0x7fff, -2, 0x4001, 0, 0x1ff, -1]),
        ),
        (I16x8SubSatU, vector([0, 0, 0, 0, 0x3fff, 0, 1, 0xfeff])),
        (I16x8LtU, vector([0, -1, 0, 0, 0, -1, 0, 0])),
        (I16x8GeS, vector([-1, 0, -1, -1, -1, -1, -1, 0])),
        (
            I32x4DotI16x8S,
            vector([0x7fff_8000, 0x3fff_0002, 0x3fff, 0xbe80]),
        ),
        (
            I32x4ExtMulHighI16x8U,
            vector([0x4000, 0xffff, 0xff00, 0x7f_bf80]),
        ),
        (
            I8x16NarrowI16x8U,
            vector([0, 0, 255, 0, 255, 1, 255, 0, 0, 0, 255, 0, 1, 0, 255, 128]),
        ),
        (
            I8x16NarrowI16x8S,
            vector([
                -128, -128, 127, -1, 127, 1, 127, -128, -128, -128, 127, -1, 1, -1, 127, 127,
            ]),
        ),
    ] {
        assert_eq!(op.evaluate(a, b), expected, "{op:?}");
    }
    assert_eq!(I32x4DotI16x8S.evaluate(a, a) as u32, 0x8000_0000);
    assert_eq!(VectorUnary::I16x8Abs.evaluate(a) as u32, 0x8000_8000);
    assert_eq!(
        VectorUnary::I32x4ExtAddPairwiseI16x8U.evaluate(a),
        vector([0x1_0000, 0x1_7ffe, 0x4001, 0x1_007f])
    );
    assert_eq!(VectorReduce::I16x8Bitmask.evaluate(a), 0b1000_1011);
    assert_eq!(VectorReduce::I16x8AllTrue.evaluate(a), 1);
    assert_eq!(VectorReduce::I8x16AllTrue.evaluate(a), 0);
    assert_eq!(VectorReduce::AnyTrue.evaluate(1 << 127), 1);
}

#[test]
fn shifts_count_modulo_the_size_of_a_lane() {
    for &op in VectorShift::ALL {
        let (size, bits) = (op.lanes(), u32::from(op.lanes().bits()));
        let top = 1 << (bits - 1);
        let expected = match op.kind() {
            Shift::Left => 2,
            Shift::RightLogical => top >> 1,
            _ => top | top >> 1,
        };
        let a = lanes::splat(size, top | 1);
        assert_eq!(op.evaluate(a, bits), a);
        assert_eq!(op.evaluate(a, 5 * bits + 1), lanes::splat(size, expected));
    }
}

#[test]
fn floats() {
    let (nan, signalling) = (f32::from_bits(0x7fc0_0000), f32::from_bits(0xff80_0001));
    let a = f32x4([0.0, -0.0, signalling, 1.0]);
    let b = f32x4([-0.0, 0.0, 1.0, signalling]);
    for (op, expected) in [
        (VectorBinary::F32x4Min, f32x4([-0.0, -0.0, nan, nan])),
        (VectorBinary::F32x4Max, f32x4([0.0, 0.0, nan, nan])),
        (VectorBinary::F32x4Pmin, a),
        (VectorBinary::F32x4Pmax, a),
        (VectorBinary::F32x4Div, f32x4([nan; 4])),
        (VectorBinary::F32x4Ne, vector([0, 0, -1, -1])),
        (VectorBinary::F32x4Ge, vector([-1, -1, 0, 0])),
    ] {
        assert_eq!(op.evaluate(a, b), expected, "{op:?}");
    }
    let limits = f32x4([nan, -3e9, 3e9, 5e9]);
    for (op, a, expected) in [
        (
            VectorUnary::F32x4Neg,
            a,
            f32x4([-0.0, 0.0, f32::from_bits(0x7f80_0001), -1.0]),
        ),
        (
            VectorUnary::F32x4Nearest,
            f32x4([0.5, 1.5, -0.5, -2.5]),
            f32x4([0.0, 2.0, -0.0, -2.0]),
        ),
        (
            VectorUnary::I32x4TruncSatF32x4S,
            limits,
            vector([0, i32::MIN.into(), i32::MAX.into(), i32::MAX.into()]),
        ),
        (
            VectorUnary::I32x4TruncSatF32x4U,
            limits,
            vector([0, 0, 3_000_000_000, -1]),
        ),
        (
            VectorUnary::I32x4TruncSatF64x2UZero,
            f64x2([4_294_967_295.9, -0.9]),
            vector([-1, 0, 0, 0]),
        ),
        (
            VectorUnary::F32x4ConvertI32x4U,
            vector([-1, 0x8000_0080, 0x8000_0081, 0]),
            f32x4([4_294_967_296.0, 2_147_483_648.0, 2_147_483_904.0, 0.0]),
        ),
        (
            VectorUnary::F32x4DemoteF64x2Zero,
            f64x2([1e300, -f64::NAN]),
            f32x4([f32::INFINITY, nan, 0.0, 0.0]),
        ),
    ] {
        assert_eq!(op.evaluate(a), expected, "{op:?}");
    }
}

#[test]
fn choices_for_relaxed_operations() {
    let a = 0x7f7f_7f7f_7f7f_7f7f_8080_8080_8080_8080;
    let b = vector([
        -128, -128, -128, -128, -127, -127, -127, -127, -128, -128, -128, -128, -1, -1, -1, -1,
    ]);
    for (relaxed, expected) in [
        (Relaxed::empty(), [-65535, 65026, -65021, -504]),
        (Relaxed::UNSIGNED_DOT, [-65535, -65534, 65027, 65538]),
        (Relaxed::WIDE_DOT_ADD, [65537, 65026, -65021, -504]),
        (Relaxed::all(), [-65535, -66046, 65027, 129_544]),
    ] {
        let op = VectorTernary::I32x4RelaxedDotI8x16I7x16AddS;
        assert_eq!(
            op.evaluate_with(relaxed, a, b, vector([1, 2, 3, 4])),
            vector(expected)
        );
    }

    let (greatest, two) = (f32x4([f32::MAX; 4]), f32x4([2.0; 4]));
    let op = VectorTernary::F32x4RelaxedNmadd;
    assert_eq!(
        op.evaluate(greatest, two, greatest),
        f32x4([f32::NEG_INFINITY; 4])
    );
    assert_eq!(
        op.evaluate_with(Relaxed::FUSED_MADD, greatest, two, greatest),
        f32x4([f32::MIN; 4])
    );

    let op = VectorTernary::I32x4RelaxedLaneselect;
    let mask = vector([-1, 0, 0xffff_0000, 0xffff]);
    assert_eq!(op.evaluate(u128::MAX, 0, mask), mask);
    assert_eq!(
        op.evaluate_with(Relaxed::all(), u128::MAX, 0, mask),
        vector([-1, 0, -1, 0])
    );

    let op = VectorBinary::I8x16RelaxedSwizzle;
    assert_eq!(op.evaluate(COUNTING, 0x0081_1101), 0x01);
    assert_eq!(
        op.evaluate_with(Relaxed::all(), COUNTING, 0x0081_1101),
        0x0101
    );

    let (a, b) = (f64x2([f64::NAN, -0.0]), f64x2([1.0, 0.0]));
    for op in [VectorBinary::F64x2RelaxedMin, VectorBinary::F64x2RelaxedMax] {
        assert_eq!(op.evaluate_with(Relaxed::all(), a, b), b);
        assert_eq!(op.evaluate_with(Relaxed::all(), b, a), a);
    }
}

#[test]
fn what_fits_is_truncated_whatever_the_choice() {
    use VectorUnary::*;
    let operands = Operands::new(1, 2000);
    for (op, from, least) in [
        (I32x4RelaxedTruncF32x4S, Size::S32, -2_147_483_648.0),
        (I32x4RelaxedTruncF32x4U, Size::S32, 0.0),
        (I32x4RelaxedTruncF64x2SZero, Size::S64, -2_147_483_648.0),
        (I32x4RelaxedTruncF64x2UZero, Size::S64, 0.0),
    ] {
        for &[a, ..] in operands.of(op) {
            let mut difference = op.evaluate(a) ^ op.evaluate_with(Relaxed::all(), a);
            for lane in 0..lanes::count(from) {
                let bits = lanes::extract(from, Sign::Unsigned, a, lane);
                let value = match from {
                    Size::S32 => f32::from_bits(bits as u32).into(),
                    _ => f64::from_bits(bits),
                };
                if !(least..least + 4_294_967_296.0).contains(&value.trunc()) {
                    difference = lanes::replace(Size::S32, difference, lane, 0);
                }
            }
            assert_eq!(difference, 0, "{op:?} {a:#x}");
        }
    }
}

fn is_mask(size: Size, vector: u128) -> bool {
    let top_bits = vector & lanes::splat(size, 1 << (size.bits() - 1));
    vector == (top_bits >> (size.bits() - 1)) * u128::from(u64::MAX >> (64 - size.bits()))
}

/// From signalling NaNs of either width.
fn makes_nan(evaluate: impl Fn(u128) -> u128) -> Option<FloatWidth> {
    let result = evaluate(lanes::splat(Size::S64, 0x7ff0_0000_7f80_0001));
    if result as u32 == 0x7fc0_0000 {
        Some(FloatWidth::F32)
    } else {
        (result as u64 == 0x7ff8_0000_0000_0000).then_some(FloatWidth::F64)
    }
}

#[test]
fn queries_agree_with_the_results() {
    let operands = Operands::new(2, 100);
    let some = |all: &[[u128; 3]]| -> Vec<_> {
        all.iter().copied().step_by((all.len() / 300) | 1).collect()
    };
    let all = Relaxed::all();
    for &op in VectorUnary::ALL {
        let operands = some(operands.of(op));
        let same = |&[a, ..]: &[u128; 3]| op.evaluate(a) == op.evaluate_with(all, a);
        assert_eq!(op.is_relaxed(), !operands.iter().all(same), "{op:?}");
        assert_eq!(op.nan_lanes(), makes_nan(|a| op.evaluate(a)), "{op:?}");
    }
    for &op in VectorBinary::ALL {
        let operands = some(operands.of(op));
        let same = |&[a, b, _]: &[u128; 3]| op.evaluate(a, b) == op.evaluate_with(all, a, b);
        assert_eq!(op.is_relaxed(), !operands.iter().all(same), "{op:?}");
        assert_eq!(op.nan_lanes(), makes_nan(|a| op.evaluate(a, a)), "{op:?}");
        let commutes = |&[a, b, _]: &[u128; 3]| {
            op.evaluate(a, b) == op.evaluate(b, a)
                && op.evaluate_with(all, a, b) == op.evaluate_with(all, b, a)
        };
        assert_eq!(op.is_commutative(), operands.iter().all(commutes), "{op:?}");
        let results: Vec<_> = operands
            .iter()
            .map(|&[a, b, _]| op.evaluate(a, b))
            .collect();
        let are_masks = |&size: &Size| results.iter().all(|&result| is_mask(size, result));
        assert_eq!(
            op.mask_lanes(),
            SIZES.into_iter().rev().find(are_masks),
            "{op:?}"
        );
    }
    for &op in VectorTernary::ALL {
        let operands = some(operands.of(op));
        let same = |&[a, b, c]: &[u128; 3]| op.evaluate(a, b, c) == op.evaluate_with(all, a, b, c);
        assert_eq!(op.is_relaxed(), !operands.iter().all(same), "{op:?}");
        assert_eq!(
            op.nan_lanes(),
            makes_nan(|a| op.evaluate(a, a, a)),
            "{op:?}"
        );
    }
}
