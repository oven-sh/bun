//! Compares what generated code does on the host with what the operations are defined to give.
//!
//! `VECTOR_TEST_SEED` and `VECTOR_TEST_COUNT` change the random operands and how many there are.

#![allow(clippy::disallowed_methods)]

#[path = "support/vector_machine.rs"]
mod machine;
#[path = "support/shuffles.rs"]
mod shuffles;
#[path = "support/vectors.rs"]
mod vectors;

use std::fmt::Debug;
use std::sync::LazyLock;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{
    Features, Relaxed, ScratchNeeds, VectorBinary, VectorReduce, VectorShift, VectorTernary,
    VectorUnary, lanes,
};
use machine::{Aliasing, Values, aliasings, assemble, run, sources};
use vectors::{Operands, Random};

const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];
const SIGNS: [Sign; 2] = [Sign::Signed, Sign::Unsigned];
const NO_SCRATCH: ScratchNeeds = ScratchNeeds { gprs: 0, fprs: 0 };

fn setting(name: &str, default: u64) -> u64 {
    std::env::var(name).map_or(default, |value| value.parse().unwrap())
}

fn seed() -> u64 {
    setting("VECTOR_TEST_SEED", 1)
}

fn count(default: u64) -> usize {
    setting("VECTOR_TEST_COUNT", default) as usize
}

static FEATURE_SETS: LazyLock<Vec<Features>> = LazyLock::new(|| {
    #[cfg(target_arch = "x86_64")]
    let all = [
        Features::empty(),
        Features::AVX,
        Features::AVX | Features::AVX2,
        Features::AVX | Features::FMA,
        Features::AVX | Features::AVX2 | Features::FMA | Features::BMI1,
    ];
    #[cfg(target_arch = "aarch64")]
    let all = [Features::empty(), Features::DOTPROD, Features::SHA3];
    let host = Features::host();
    all.into_iter().filter(|&set| host.contains(set)).collect()
});

/// Those that differ in how data is moved.
static FEATURE_SETS_FOR_MOVES: LazyLock<Vec<Features>> = LazyLock::new(|| {
    #[cfg(target_arch = "x86_64")]
    let for_arithmetic = Features::FMA;
    #[cfg(target_arch = "aarch64")]
    let for_arithmetic = Features::all();
    let all = FEATURE_SETS.iter().copied();
    all.filter(|set| !set.intersects(for_arithmetic)).collect()
});

type Emit<'a> = &'a dyn Fn(&mut MacroAssembler, [Fpr; 4], [Gpr; 4]);

struct Case<'a> {
    name: &'a dyn Debug,
    /// How many of the vector registers it names, from the destination on.
    vectors: usize,
    features: &'a [Features],
    needs: &'a dyn Fn(Features) -> ScratchNeeds,
    emit: Emit<'a>,
}

impl Case<'_> {
    /// Runs the code for each set of features that makes a difference. The scalars are no addresses.
    fn for_all_features(
        &self,
        aliasing: Aliasing,
        inputs: &[Values],
        random: &mut Random,
        mut check: impl FnMut(Features, Vec<(u128, u64)>),
    ) {
        let choice = random.next();
        let mut known: Vec<Vec<u8>> = Vec::new();
        for &features in self.features {
            let needs = (self.needs)(features);
            let operands = machine::Operands::new(aliasing, needs, false, &mut Random(choice));
            let code = assemble(features, &operands, |masm| {
                (self.emit)(masm, operands.fprs, operands.gprs);
            });
            if known.iter().any(|bytes| bytes == code.bytes()) {
                continue;
            }
            // SAFETY: the host has the features, and the operation does not access memory.
            let results = unsafe { run(&code, &operands, inputs.iter().copied()) };
            check(features, results);
            known.push(code.bytes().to_vec());
        }
    }

    /// `expected` gets the sources and gives what is in the destinations, of which `None` stands for one that is kept.
    fn check(
        &self,
        inputs: &[Values],
        random: &mut Random,
        expected: impl Fn([u128; 3], u64) -> (Option<u128>, Option<u64>),
    ) {
        self.check_with(inputs, random, |_, a, x| expected(a, x), |_, _, _| false);
    }

    fn check_with(
        &self,
        inputs: &[Values],
        random: &mut Random,
        expected: impl Fn(Relaxed, [u128; 3], u64) -> (Option<u128>, Option<u64>),
        is_allowed_too: impl Fn([u128; 3], u128, u128) -> bool,
    ) {
        let mut known = Vec::new();
        for aliasing in aliasings(self.vectors) {
            let order = sources(aliasing);
            let sources = |input: &Values| order.map(|source| input.vectors[1 + source]);
            self.for_all_features(aliasing, inputs, random, |features, results| {
                let relaxed = MacroAssembler::relaxed(features);
                let index = known.iter().position(|(key, _)| *key == (order, relaxed));
                let index = index.unwrap_or_else(|| {
                    let of = |input| expected(relaxed, sources(input), input.scalars[1]);
                    known.push(((order, relaxed), inputs.iter().map(of).collect::<Vec<_>>()));
                    known.len() - 1
                });
                let before = (1..4).find(|&source| aliasing[source] == 0).unwrap_or(0);
                for ((input, actual), expected) in inputs.iter().zip(results).zip(&known[index].1) {
                    let vector = expected.0.unwrap_or(input.vectors[before]);
                    let scalar = expected.1.unwrap_or(input.scalars[0]);
                    assert!(
                        (actual.0 == vector || is_allowed_too(sources(input), vector, actual.0))
                            && actual.1 == scalar,
                        "{:?} with {features:?} and {aliasing:?}\n   sources {:032x?} {:x}\n  expected \
                         {vector:032x} {scalar:x}\n    actual {:032x} {:x}",
                        self.name,
                        sources(input),
                        input.scalars[1],
                        actual.0,
                        actual.1,
                    );
                }
            });
        }
    }
}

fn inputs(operands: &[[u128; 3]], random: &mut Random) -> Vec<Values> {
    let input = |&[a, b, c]: &[u128; 3]| Values {
        vectors: [random.bits(), a, b, c],
        scalars: [(); 4].map(|()| random.next()),
    };
    operands.iter().map(input).collect()
}

fn random_inputs(count: usize, random: &mut Random) -> Vec<Values> {
    let operands: Vec<_> = (0..count)
        .map(|_| [(); 3].map(|()| random.bits()))
        .collect();
    inputs(&operands, random)
}

/// The bits without the sign, those of infinity, and those of the canonical NaN.
fn float_lane(width: FloatWidth, vector: u128, lane: u8) -> (u64, u64, u64) {
    let bits = lanes::extract(width.width().size(), Sign::Unsigned, vector, lane);
    match width {
        FloatWidth::F32 => (bits & 0x7fff_ffff, 0x7f80_0000, 0x7fc0_0000),
        FloatWidth::F64 => (bits & u64::MAX >> 1, 0x7ff0 << 48, 0x7ff8 << 48),
    }
}

/// WebAssembly, "NaN Propagation".
fn differs_in_nans_only(
    (from, to): (FloatWidth, FloatWidth),
    sources: &[u128],
    expected: u128,
    actual: u128,
) -> bool {
    let size = to.width().size();
    (0..lanes::count(size)).all(|lane| {
        let bits = |vector| lanes::extract(size, Sign::Unsigned, vector, lane);
        let (magnitude, infinity, canonical) = float_lane(to, expected, lane);
        if magnitude <= infinity {
            return bits(expected) == bits(actual);
        }
        let has_payload = sources.iter().any(|&source| {
            let (magnitude, infinity, canonical) = float_lane(from, source, lane);
            magnitude > infinity && magnitude != canonical
        });
        let magnitude = float_lane(to, actual, lane).0;
        magnitude == canonical || has_payload && magnitude > canonical
    })
}

#[test]
fn unary() {
    let (operands, random) = (Operands::new(seed(), count(400)), &mut Random(seed()));
    for &op in VectorUnary::ALL {
        let widths = op.nan_lanes().map(|to| match op {
            VectorUnary::F32x4DemoteF64x2Zero => (FloatWidth::F64, to),
            VectorUnary::F64x2PromoteLowF32x4 => (FloatWidth::F32, to),
            _ => (to, to),
        });
        // All boundaries come to all lanes of the second vector sooner than to those of the first.
        let all = operands.of(op).iter().map(|&[a, b, c]| [b, c, a]);
        let some: Vec<_> = all.rev().take(count(400) + 600).collect();
        Case {
            name: &op,
            vectors: 2,
            features: &FEATURE_SETS,
            needs: &|features| MacroAssembler::scratch_for_unary(features, op),
            emit: &|masm, [dst, a, ..], _| masm.vector_unary(op, dst, a),
        }
        .check_with(
            &inputs(&some, random),
            random,
            |relaxed, [a, ..], _| (Some(op.evaluate_with(relaxed, a)), None),
            |sources, expected, actual| {
                widths.is_some_and(|widths| {
                    differs_in_nans_only(widths, &sources[..1], expected, actual)
                })
            },
        );
    }
}

fn binary(is_included: impl Fn(&str) -> bool) {
    let (operands, random) = (Operands::new(seed(), count(400)), &mut Random(seed()));
    for &op in VectorBinary::ALL {
        if !is_included(&format!("{op:?}")) {
            continue;
        }
        let is_exact = op.is_relaxed()
            && MacroAssembler::relaxed(Features::host()).contains(Relaxed::SECOND_OPERAND_MIN_MAX);
        let width = op.nan_lanes().filter(|_| !is_exact);
        let mut all = operands.of(op).to_vec();
        if format!("{op:?}").contains("ExtMul") {
            let other_halves = |item: &[u128; 3]| item.map(|vector| vector.rotate_left(64));
            all.extend(operands.of(op).iter().map(other_halves));
        }
        Case {
            name: &op,
            vectors: 3,
            features: &FEATURE_SETS,
            needs: &|features| MacroAssembler::scratch_for_binary(features, op),
            emit: &|masm, [dst, a, b, _], _| masm.vector_binary(op, dst, a, b),
        }
        .check_with(
            &inputs(&all, random),
            random,
            |relaxed, [a, b, _], _| (Some(op.evaluate_with(relaxed, a, b)), None),
            |sources, expected, actual| {
                width.is_some_and(|width| {
                    differs_in_nans_only((width, width), &sources[..2], expected, actual)
                })
            },
        );
    }
}

#[test]
fn binary_on_integers() {
    binary(|name| !name.starts_with('F'));
}

#[test]
fn binary_on_singles() {
    binary(|name| name.starts_with("F32"));
}

#[test]
fn binary_on_doubles() {
    binary(|name| name.starts_with("F64"));
}

#[test]
fn ternary() {
    let (operands, random) = (Operands::new(seed(), count(400)), &mut Random(seed()));
    for &op in VectorTernary::ALL {
        let all = operands.of(op);
        let some: Vec<_> = all
            .iter()
            .copied()
            .step_by((all.len() / 1500) | 1)
            .collect();
        Case {
            name: &op,
            vectors: 4,
            features: &FEATURE_SETS,
            needs: &|features| MacroAssembler::scratch_for_ternary(features, op),
            emit: &|masm, [dst, a, b, c], _| masm.vector_ternary(op, dst, a, b, c),
        }
        .check_with(
            &inputs(&some, random),
            random,
            |relaxed, [a, b, c], _| (Some(op.evaluate_with(relaxed, a, b, c)), None),
            |sources, expected, actual| {
                op.nan_lanes().is_some_and(|width| {
                    differs_in_nans_only((width, width), &sources, expected, actual)
                })
            },
        );
    }
}

#[test]
fn shifts() {
    let (operands, random) = (Operands::new(seed(), count(400)), &mut Random(seed()));
    for &op in VectorShift::ALL {
        let mut inputs = inputs(operands.of(op), random);
        for (amount, input) in inputs.iter_mut().rev().enumerate().take(300) {
            input.scalars[1] = input.scalars[1] << 32 | amount as u64;
        }
        Case {
            name: &op,
            vectors: 2,
            features: &FEATURE_SETS,
            needs: &|features| MacroAssembler::scratch_for_shift(features, op, false),
            emit: &|masm, [dst, a, ..], [_, amount, ..]| masm.vector_shift(op, dst, a, amount),
        }
        .check(&inputs, random, |[a, ..], amount| {
            (Some(op.evaluate(a, amount as u32)), None)
        });
        let some: Vec<_> = inputs.into_iter().rev().step_by(7).take(60).collect();
        for amount in (0..=op.lanes().bits() + 1).chain([127, 128, 255]) {
            Case {
                name: &(op, amount),
                vectors: 2,
                features: &FEATURE_SETS,
                needs: &|features| MacroAssembler::scratch_for_shift(features, op, true),
                emit: &|masm, [dst, a, ..], _| masm.vector_shift(op, dst, a, amount),
            }
            .check(&some, random, |[a, ..], _| {
                (Some(op.evaluate(a, amount.into())), None)
            });
        }
    }
}

/// One bit alone, all but one bit, and all but one lane of each size.
fn sparse_and_dense() -> Vec<[u128; 3]> {
    let mut all = Vec::new();
    for bit in 0..128 {
        all.extend([[1 << bit, 0, 0], [!(1 << bit), 0, 0]]);
    }
    for size in SIZES {
        for lane in 0..lanes::count(size) {
            for fill in [1, 1 << (size.bits() - 1), u64::MAX] {
                let vector = lanes::replace(size, lanes::splat(size, fill), lane, 0);
                all.push([vector, 0, 0]);
            }
        }
    }
    all
}

#[test]
fn reductions() {
    let (operands, random) = (Operands::new(seed(), count(400)), &mut Random(seed()));
    let inputs_for = |op: VectorReduce, random: &mut Random| {
        inputs(&[operands.of(op), &sparse_and_dense()].concat(), random)
    };
    for &op in VectorReduce::ALL {
        Case {
            name: &op,
            vectors: 1,
            features: &FEATURE_SETS,
            needs: &|features| MacroAssembler::scratch_for_reduce(features, op),
            emit: &|masm, [_, a, ..], [dst, ..]| masm.vector_reduce(op, dst, a),
        }
        .check(&inputs_for(op, random), random, |[a, ..], _| {
            (None, Some(op.evaluate(a).into()))
        });
    }
    for cond in [TestCond::Zero, TestCond::NonZero] {
        Case {
            name: &cond,
            vectors: 1,
            features: &FEATURE_SETS,
            needs: &MacroAssembler::scratch_for_branch_test,
            emit: &|masm, [_, a, ..], [dst, ..]| {
                let taken = masm.new_label();
                masm.move32(dst, 1);
                masm.branch_test_vector(cond, a, taken);
                masm.move32(dst, 0);
                masm.bind(taken);
            },
        }
        .check(
            &inputs_for(VectorReduce::AnyTrue, random),
            random,
            |[a, ..], _| (None, Some(((a == 0) == (cond == TestCond::Zero)).into())),
        );
    }
}

fn without_scratch<'a>(name: &'a dyn Debug, vectors: usize, emit: Emit<'a>) -> Case<'a> {
    Case {
        name,
        vectors,
        features: &FEATURE_SETS_FOR_MOVES,
        needs: &|_| NO_SCRATCH,
        emit,
    }
}

#[test]
fn integer_lanes() {
    let random = &mut Random(seed());
    let inputs = random_inputs(50, random);
    for size in SIZES {
        without_scratch(&("splat", size), 1, &|masm, [dst, ..], [_, x, ..]| {
            masm.splat_int(size, dst, x);
        })
        .check(&inputs, random, |_, x| (Some(lanes::splat(size, x)), None));
        for lane in 0..lanes::count(size) {
            without_scratch(
                &("replace", size, lane),
                2,
                &|masm, [dst, a, ..], [_, x, ..]| masm.replace_int_lane(size, dst, a, lane, x),
            )
            .check(&inputs, random, |[a, ..], x| {
                (Some(lanes::replace(size, a, lane, x)), None)
            });
            for sign in SIGNS {
                without_scratch(
                    &("extract", size, sign, lane),
                    1,
                    &|masm, [_, a, ..], [dst, ..]| masm.extract_int_lane(size, sign, dst, a, lane),
                )
                .check(&inputs, random, |[a, ..], _| {
                    (None, Some(lanes::extract(size, sign, a, lane)))
                });
            }
        }
    }
}

#[test]
fn float_lanes() {
    let random = &mut Random(seed());
    let mut inputs = random_inputs(50, random);
    inputs[0].vectors = [0xfff0_0001_ff80_0001_7ff0_0001_7f80_0001; 4];
    for width in [FloatWidth::F32, FloatWidth::F64] {
        let size = width.width().size();
        without_scratch(&("splat", width), 2, &|masm, [dst, a, ..], _| {
            masm.splat_float(width, dst, a);
        })
        .check(&inputs, random, |[a, ..], _| {
            (Some(lanes::splat(size, a as u64)), None)
        });
        for lane in 0..lanes::count(size) {
            without_scratch(&("replace", width, lane), 3, &|masm, [dst, a, b, _], _| {
                masm.replace_float_lane(width, dst, a, lane, b);
            })
            .check(&inputs, random, |[a, b, _], _| {
                (Some(lanes::replace(size, a, lane, b as u64)), None)
            });
            let get = |vector, lane| lanes::extract(size, Sign::Unsigned, vector, lane);
            without_scratch(&("extract", width, lane), 2, &|masm, [dst, a, ..], _| {
                masm.extract_float_lane(width, dst, a, lane);
            })
            .check_with(
                &inputs,
                random,
                |_, [a, ..], _| (Some(get(a, lane).into()), None),
                |_, expected, actual| get(expected, 0) == get(actual, 0),
            );
        }
    }
}

fn with_one_scratch<'a>(name: &'a dyn Debug, vectors: usize, emit: Emit<'a>) -> Case<'a> {
    Case {
        name,
        vectors,
        features: &FEATURE_SETS,
        needs: &|_| ScratchNeeds { gprs: 0, fprs: 1 },
        emit,
    }
}

#[test]
fn searching_text() {
    let random = &mut Random(seed());
    let mut changed = |sources: usize, change: &dyn Fn(u128) -> u128| {
        let mut inputs = inputs(&sparse_and_dense(), random);
        inputs.extend(random_inputs(count(400), random));
        for input in &mut inputs {
            for vector in &mut input.vectors[1..=sources] {
                *vector = change(*vector);
            }
        }
        inputs
    };
    let masks = changed(1, &|a| VectorShift::I8x16ShrS.evaluate(a, 7));
    let set_masks = changed(1, &|a| VectorShift::I8x16ShrS.evaluate(a | 1 << 127, 7));
    let signed = changed(2, &|a| VectorShift::I16x8ShrS.evaluate(a, 8));
    let unsigned = changed(2, &|a| VectorShift::I16x8ShrU.evaluate(a, 8));
    let bits = changed(1, &|a| {
        u128::from_le_bytes(a.to_le_bytes().map(|byte| 1 << (byte % 8)))
    });

    let bits_for_byte = 1 << MacroAssembler::BYTE_MASK_SHIFT;
    with_one_scratch(&"mask", 1, &|masm, [_, a, ..], [dst, ..]| {
        masm.move_byte_mask(dst, a);
    })
    .check(&masks, random, |[a, ..], _| {
        let append = |mask, byte| mask << bits_for_byte | u64::from(byte) >> (8 - bits_for_byte);
        (None, Some(a.to_be_bytes().into_iter().fold(0, append)))
    });
    with_one_scratch(&"first", 1, &|masm, [_, a, ..], [dst, ..]| {
        masm.move_byte_mask(dst, a);
        masm.first_in_byte_mask(dst, dst);
    })
    .check(&set_masks, random, |[a, ..], _| {
        (None, Some((a.trailing_zeros() / 8).into()))
    });
    let mut in_registers = random_inputs(16, random);
    for (byte, input) in in_registers.iter_mut().enumerate() {
        input.scalars[1] =
            u64::MAX >> (64 - 16 * bits_for_byte) & u64::MAX << (byte * bits_for_byte);
    }
    with_one_scratch(&"first", 1, &|masm, _, [dst, mask, ..]| {
        masm.first_in_byte_mask(dst, mask);
    })
    .check(&in_registers, random, |_, mask| {
        let byte = mask.trailing_zeros() >> MacroAssembler::BYTE_MASK_SHIFT;
        (None, Some(byte.into()))
    });
    let even = std::array::from_fn(|byte| 2 * byte as u8);
    for (sign, inputs) in SIGNS.into_iter().zip([signed, unsigned]) {
        with_one_scratch(&sign, 3, &|masm, [dst, a, b, _], _| {
            masm.narrow_to_bytes(sign, dst, a, b);
        })
        .check(&inputs, random, |[a, b, _], _| {
            (Some(lanes::shuffle(a, b, even)), None)
        });
    }
    with_one_scratch(&"test", 3, &|masm, [dst, bit, value, _], _| {
        masm.test_bit_in_bytes(dst, value, bit);
    })
    .check(&bits, random, |[a, b, _], _| {
        (Some(VectorBinary::I8x16Ne.evaluate(a & b, 0)), None)
    });
}

#[test]
fn constants() {
    let random = &mut Random(seed());
    let inputs = random_inputs(1, random);
    let constants = vectors::constants(random);
    for &bits in &constants {
        without_scratch(&bits, 1, &|masm, [dst, ..], _| {
            masm.move_vector_constant(dst, bits);
        })
        .check(&inputs, random, |_, _| (Some(bits), None));
    }
}

fn check_shuffles(patterns: Vec<[u8; 16]>, random: &mut Random) {
    const DIFFERENT: u128 = 0xefee_edec_ebea_e9e8_e7e6_e5e4_e3e2_e1e0;
    let mut inputs = random_inputs(2, random);
    inputs[0].vectors = [u128::MAX, DIFFERENT, !DIFFERENT, 0];
    for pattern in patterns {
        Case {
            name: &pattern,
            vectors: 3,
            features: &FEATURE_SETS_FOR_MOVES,
            needs: &|features| MacroAssembler::scratch_for_shuffle(features, pattern),
            emit: &|masm, [dst, a, b, _], _| masm.vector_shuffle(dst, a, b, pattern),
        }
        .check(&inputs, random, |[a, b, _], _| {
            (Some(lanes::shuffle(a, b, pattern)), None)
        });
    }
}

fn shuffles_of_wide_lanes(part: usize) {
    let patterns = shuffles::of_wide_lanes().into_iter().skip(part).step_by(4);
    check_shuffles(patterns.collect(), &mut Random(seed()));
}

#[test]
fn shuffles_of_wide_lanes_first_part() {
    shuffles_of_wide_lanes(0);
}

#[test]
fn shuffles_of_wide_lanes_second_part() {
    shuffles_of_wide_lanes(1);
}

#[test]
fn shuffles_of_wide_lanes_third_part() {
    shuffles_of_wide_lanes(2);
}

#[test]
fn shuffles_of_wide_lanes_fourth_part() {
    shuffles_of_wide_lanes(3);
}

#[test]
fn shuffles_with_names() {
    check_shuffles(shuffles::with_names(), &mut Random(seed()));
}

#[test]
fn shuffles_near_those_with_names() {
    let random = &mut Random(seed());
    check_shuffles(shuffles::near_names(count(1500), random), random);
}

#[test]
fn shuffles_that_prepare_a_lane() {
    check_shuffles(shuffles::prepared_lanes(), &mut Random(seed()));
}

#[test]
fn shuffles_that_nearly_interleave() {
    let patterns = shuffles::interleavings_but_for_a_byte();
    check_shuffles(patterns, &mut Random(seed()));
}

#[test]
fn random_shuffles() {
    let random = &mut Random(seed());
    check_shuffles(shuffles::random(count(1500), random), random);
}

#[cfg(unix)]
mod memory {
    use super::*;

    /// One page between two that cannot be accessed.
    struct Page {
        start: *mut u8,
        size: usize,
    }

    impl Page {
        fn new() -> Self {
            // SAFETY: the system picks an address that is not in use, and the middle page is in what it gives.
            unsafe {
                let size = libc::sysconf(libc::_SC_PAGESIZE) as usize;
                let flags = libc::MAP_PRIVATE | libc::MAP_ANON;
                let all = libc::mmap(
                    std::ptr::null_mut(),
                    3 * size,
                    libc::PROT_NONE,
                    flags,
                    -1,
                    0,
                );
                assert!(all != libc::MAP_FAILED);
                let start = all.byte_add(size);
                let protection = libc::PROT_READ | libc::PROT_WRITE;
                assert_eq!(libc::mprotect(start, size, protection), 0);
                Self {
                    start: start.cast(),
                    size,
                }
            }
        }

        fn bytes(&mut self) -> &mut [u8] {
            // SAFETY: mapped until `drop`.
            unsafe { std::slice::from_raw_parts_mut(self.start, self.size) }
        }
    }

    impl Drop for Page {
        fn drop(&mut self) {
            // SAFETY: what `new` mapped.
            unsafe { libc::munmap(self.start.sub(self.size).cast(), 3 * self.size) };
        }
    }

    const OFFSETS: [i32; 9] = [0, 1, 8, -8, 255, 4088, 0x1_2345, -0x1_2345, i32::MAX];
    const SCALES: [Option<Scale>; 5] = [
        None,
        Some(Scale::One),
        Some(Scale::Two),
        Some(Scale::Four),
        Some(Scale::Eight),
    ];

    /// `expected` gets the source and the bytes in memory, and gives the destination or else the new bytes.
    fn check(
        name: impl Debug,
        bytes: usize,
        vectors: usize,
        random: &mut Random,
        emit: impl Fn(&mut MacroAssembler, Fpr, Fpr, Address),
        expected: impl Fn(u128, u64) -> Result<u128, u64>,
    ) {
        let mut page = Page::new();
        let forms = OFFSETS
            .iter()
            .flat_map(|&offset| SCALES.map(|scale| (offset, scale)));
        for (features, (offset, scale)) in FEATURE_SETS_FOR_MOVES
            .iter()
            .flat_map(|&features| forms.clone().map(move |form| (features, form)))
        {
            for aliasing in aliasings(vectors) {
                let operands = machine::Operands::new(aliasing, NO_SCRATCH, true, random);
                let ([dst, a, ..], [_, base, index, _]) = (operands.fprs, operands.gprs);
                let address = match scale {
                    Some(scale) => Address::indexed(base, index, scale, offset),
                    None => Address::new(base, offset),
                };
                let code = assemble(features, &operands, |masm| emit(masm, dst, a, address));
                for at in [0, 33, page.size - bytes] {
                    let around = at.saturating_sub(16)..(at + 32).min(page.size);
                    page.bytes()[around.clone()].fill_with(|| random.next() as u8);
                    let mut contents = page.bytes()[around.clone()].to_vec();
                    let place = &mut contents[at - around.start..][..bytes];
                    let mut input = random_inputs(1, random)[0];
                    input.scalars[1] = (page.start.expose_provenance() as u64 + at as u64)
                        .wrapping_sub_signed(offset.into())
                        .wrapping_sub(scale.map_or(0, |scale| input.scalars[2] << scale.log2()));
                    let mut old = [0; 8];
                    old[..bytes].copy_from_slice(place);
                    let vector = expected(input.vectors[1], u64::from_le_bytes(old))
                        .unwrap_or_else(|new| {
                            place.copy_from_slice(&new.to_le_bytes()[..bytes]);
                            input.vectors[0]
                        });
                    // SAFETY: the host has the features, and the address is in the page.
                    let results = unsafe { run(&code, &operands, [input].into_iter()) };
                    assert_eq!(
                        (results[0], &page.bytes()[around]),
                        ((vector, input.scalars[0]), &contents[..]),
                        "{name:?} with {features:?}, {aliasing:?} and {address:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn whole_vectors() {
        let random = &mut Random(seed());
        for size in SIZES {
            check(
                ("splat", size),
                size.bytes().into(),
                1,
                random,
                |masm, dst, _, address| masm.load_vector_splat(size, dst, address),
                |_, bytes| Ok(lanes::splat(size, bytes)),
            );
            for sign in SIGNS.into_iter().filter(|_| size != Size::S64) {
                check(
                    ("extend", size, sign),
                    8,
                    1,
                    random,
                    |masm, dst, _, address| masm.load_vector_extend(size, sign, dst, address),
                    |_, bytes| Ok(lanes::extend(size, sign, bytes)),
                );
            }
        }
    }

    #[test]
    fn single_lanes() {
        let random = &mut Random(seed());
        for size in SIZES {
            for lane in 0..lanes::count(size) {
                check(
                    ("load", size, lane),
                    size.bytes().into(),
                    2,
                    random,
                    |masm, dst, a, address| masm.load_vector_lane(size, dst, a, lane, address),
                    |a, bytes| Ok(lanes::replace(size, a, lane, bytes)),
                );
                check(
                    ("store", size, lane),
                    size.bytes().into(),
                    1,
                    random,
                    |masm, _, a, address| masm.store_vector_lane(size, address, a, lane),
                    |a, _| Err(lanes::extract(size, Sign::Unsigned, a, lane)),
                );
            }
        }
    }
}
