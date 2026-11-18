mod machine;
mod support;

use std::cmp::Ordering;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{NegativeZero, Rounding};
use machine::model::Unspecified;
use machine::operands::OFFSETS;
use machine::values::{Boundaries, Kind, sign_extend};
use machine::{Case, FLOAT_WIDTHS, Harness, Operation, Outcome, SIGNS, WIDTHS, op};

fn sign_bit(width: FloatWidth) -> u64 {
    1 << (width.width().bits() - 1)
}

fn binary(
    operation: fn(FloatWidth, Fpr, Fpr, Fpr) -> Operation,
    single: fn(f32, f32) -> f32,
    double: fn(f64, f64) -> f64,
) {
    let mut h = Harness::new();
    for width in FLOAT_WIDTHS {
        for round in 0..24 {
            for [dst, lhs, rhs] in h.fprs() {
                let case = Case::new(operation(width, dst, lhs, rhs), move |m| {
                    let (a, b) = (m.float(width, lhs), m.float(width, rhs));
                    let result = match width {
                        FloatWidth::F32 => single(a as f32, b as f32).into(),
                        FloatWidth::F64 => double(a, b),
                    };
                    m.set_float(width, dst, result);
                });
                let case = case.reads_float(width, lhs).reads_float(width, rhs);
                h.add(case.with_all_boundaries(round == 0 && dst == rhs && lhs != rhs));
            }
        }
    }
}

#[test]
fn add() {
    binary(
        |w, d, a, b| op!(add_float(w, d, a, b)),
        |a, b| a + b,
        |a, b| a + b,
    );
}

#[test]
fn sub() {
    binary(
        |w, d, a, b| op!(sub_float(w, d, a, b)),
        |a, b| a - b,
        |a, b| a - b,
    );
}

#[test]
fn mul() {
    binary(
        |w, d, a, b| op!(mul_float(w, d, a, b)),
        |a, b| a * b,
        |a, b| a * b,
    );
}

#[test]
fn div() {
    binary(
        |w, d, a, b| op!(div_float(w, d, a, b)),
        |a, b| a / b,
        |a, b| a / b,
    );
}

fn first_in_order(a: f64, b: f64, wanted: Ordering) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a.total_cmp(&b) == wanted {
        a
    } else {
        b
    }
}

#[test]
fn min() {
    binary(
        |w, d, a, b| op!(min_float(w, d, a, b)),
        |a, b| first_in_order(a.into(), b.into(), Ordering::Less) as f32,
        |a, b| first_in_order(a, b, Ordering::Less),
    );
}

#[test]
fn max() {
    binary(
        |w, d, a, b| op!(max_float(w, d, a, b)),
        |a, b| first_in_order(a.into(), b.into(), Ordering::Greater) as f32,
        |a, b| first_in_order(a, b, Ordering::Greater),
    );
}

#[test]
fn signs() {
    let mut h = Harness::new();
    for width in FLOAT_WIDTHS {
        let bit = sign_bit(width);
        for round in 0..24 {
            for [dst, a, b] in h.fprs() {
                let case = Case::new(op!(copysign_float(width, dst, a, b)), move |m| {
                    let bits = m.float_bits(width, a) & !bit | m.float_bits(width, b) & bit;
                    m.set_float_bits(width, dst, bits);
                });
                h.add(case.reads_float(width, a).reads_float(width, b));
                let case = Case::new(op!(abs_float(width, dst, a)), move |m| {
                    m.set_float_bits(width, dst, m.float_bits(width, a) & !bit);
                });
                h.add(case.reads_float(width, a).with_all_boundaries(round == 0));
                let case = Case::new(op!(neg_float(width, dst, a)), move |m| {
                    m.set_float_bits(width, dst, m.float_bits(width, a) ^ bit);
                });
                h.add(case.reads_float(width, a).with_all_boundaries(round == 0));
            }
        }
    }
}

#[test]
fn roots_rounding_and_changes_of_width() {
    let mut h = Harness::new();
    let roundings: [(Rounding, fn(f64) -> f64); 4] = [
        (Rounding::Down, f64::floor),
        (Rounding::Up, f64::ceil),
        (Rounding::TowardZero, f64::trunc),
        (Rounding::Nearest, f64::round_ties_even),
    ];
    for round in 0..16 {
        for [dst, src] in h.fprs() {
            let mut add = |operation, from, to, model: fn(f64) -> f64| {
                let case = Case::new(operation, move |m| {
                    m.set_float(to, dst, model(m.float(from, src)));
                });
                h.add(case.reads_float(from, src).with_all_boundaries(round < 2));
            };
            let [single, double] = FLOAT_WIDTHS;
            add(op!(convert_f32_to_f64(dst, src)), single, double, |a| a);
            add(op!(convert_f64_to_f32(dst, src)), double, single, |a| a);
            add(op!(sqrt_float(double, dst, src)), double, double, f64::sqrt);
            add(op!(sqrt_float(single, dst, src)), single, single, |a| {
                (a as f32).sqrt().into()
            });
            for width in FLOAT_WIDTHS {
                for (rounding, model) in roundings {
                    let operation = op!(round_float(rounding, width, dst, src));
                    add(operation, width, width, model);
                }
            }
        }
    }
}

#[test]
fn moves() {
    let mut h = Harness::new();
    h.use_first_scratch_for_operands();
    for _ in 0..40 {
        for [dst, src] in h.fprs() {
            let case = Case::new(op!(move_float(dst, src)), move |m| {
                m.set_float_bits(FloatWidth::F64, dst, m.vector(src) as u64);
            });
            h.add(case.keeps_first_scratch());
            let case = Case::new(op!(move_vector(dst, src)), move |m| {
                m.set_vector(dst, m.vector(src));
            });
            h.add(case.keeps_first_scratch());
        }
        let (gpr, fpr) = (h.any_gpr(), h.any_fpr());
        for width in FLOAT_WIDTHS {
            let case = Case::new(op!(move_bits_to_float(width, fpr, gpr)), move |m| {
                m.set_float_bits(width, fpr, m.get64(gpr));
            });
            h.add(case.keeps_first_scratch());
            let case = Case::new(op!(move_float_to_bits(width, gpr, fpr)), move |m| {
                m.set64(gpr, m.float_bits(width, fpr));
            });
            h.add(case.keeps_first_scratch());
        }
    }
}

#[test]
fn constants() {
    let mut h = Harness::new();
    h.use_first_scratch_for_operands();
    let boundaries = Boundaries::new();
    for width in FLOAT_WIDTHS {
        let short = (-600..600).map(|n| machine::values::float_bits(width, f64::from(n) / 16.0));
        let special = boundaries.of(Kind::Float(width)).iter().copied();
        for bits in short.chain(special) {
            let above = match width {
                FloatWidth::F32 => h.random.next() << 32,
                FloatWidth::F64 => 0,
            };
            let (dst, given) = (h.any_fpr(), bits | above);
            let case = Case::new(op!(move_float_constant(width, dst, given)), move |m| {
                m.set_float_bits(width, dst, bits);
            });
            h.add(case.keeps_first_scratch());
        }
    }
    let dst = h.any_fpr();
    h.add(Case::new(op!(move_f64_constant(dst, -0.1)), move |m| {
        m.set_float(FloatWidth::F64, dst, -0.1);
    }));
}

#[test]
fn pairs() {
    let mut h = Harness::new();
    h.use_first_scratch_for_operands();
    for ([], address) in h.addresses(&[], OFFSETS.len()) {
        for [low, high] in h.fprs() {
            let case = Case::new(op!(store_pair_f64(address, low, high)), move |m| {
                m.store(Size::S64, address, m.vector(low) as u64);
                m.store(Size::S64, address.plus(8), m.vector(high) as u64);
            });
            h.add(case.accesses(address).keeps_first_scratch());
            if address.offset() > i32::MAX - 16 {
                continue;
            }
            let case = Case::new(op!(store_pair_vector(address, low, high)), move |m| {
                m.store_vector(address, m.vector(low));
                m.store_vector(address.plus(16), m.vector(high));
            });
            h.add(case.accesses(address).keeps_first_scratch());
            if low == high {
                continue;
            }
            let case = Case::new(op!(load_pair_f64(low, high, address)), move |m| {
                m.set_float_bits(FloatWidth::F64, low, m.load(Size::S64, address));
                m.set_float_bits(FloatWidth::F64, high, m.load(Size::S64, address.plus(8)));
            });
            h.add(case.accesses(address).keeps_first_scratch());
            let case = Case::new(op!(load_pair_vector(low, high, address)), move |m| {
                m.set_vector(low, m.load_vector(address));
                m.set_vector(high, m.load_vector(address.plus(16)));
            });
            h.add(case.accesses(address).keeps_first_scratch());
        }
    }
}

fn half_to_double(bits: u16) -> f64 {
    let (exponent, fraction) = (i32::from(bits >> 10 & 31), f64::from(bits & 0x3ff));
    let magnitude = match exponent {
        0 => fraction * 2f64.powi(-24),
        31 if fraction == 0.0 => f64::INFINITY,
        31 => f64::NAN,
        _ => (1024.0 + fraction) * 2f64.powi(exponent - 25),
    };
    if bits >> 15 == 0 {
        magnitude
    } else {
        -magnitude
    }
}

/// Not for NaN.
fn double_to_half(value: f64) -> u16 {
    const INFINITY: u16 = 0x7c00;
    let sign = u16::from(value.is_sign_negative()) << 15;
    let magnitude = value.abs();
    if magnitude >= 65_520.0 {
        return sign | INFINITY;
    }
    let exponent = ((magnitude.to_bits() >> 52) as i32 - 1023).max(-14);
    let units = (magnitude * 2f64.powi(10 - exponent)).round_ties_even() as u16;
    sign | ((((exponent + 14) as u16) << 10) + units)
}

/// Where there are no instructions for them, the case branches.
fn if_supported(operation: Operation) -> Operation {
    operation.wrapped(RegisterSet::EMPTY, |masm, target, emit| {
        if masm.supports_f16() {
            emit(masm);
        } else {
            masm.jump(target);
        }
    })
}

#[test]
fn half_precision() {
    let mut h = Harness::new();
    for round in 0..200 {
        let (gpr, fpr, keeper) = (h.any_gpr(), h.any_fpr(), h.any_gpr());
        let operation = if_supported(op!(convert_f64_to_f16_bits(gpr, fpr)));
        let case = Case::new(operation, move |m| {
            let value = m.float(FloatWidth::F64, fpr);
            if value.is_nan() {
                m.set64(gpr, 0x7e00);
                m.unspecified.push(Unspecified::WhichHalfNan(gpr));
            } else {
                m.set64(gpr, double_to_half(value).into());
            }
            m.unspecified.push(Unspecified::IfBranched(gpr));
            Outcome::Either
        });
        let case = case.reads_float(FloatWidth::F64, fpr);
        if round < 4 {
            h.add(case.with_all_boundaries(true));
        } else {
            h.add(case.given(move |m, random| {
                let below = random.below(0x7c00) as u16;
                let middle =
                    (half_to_double(below) + half_to_double(below + 1).min(65_536.0)) / 2.0;
                let near = middle
                    .to_bits()
                    .wrapping_add_signed(random.pick(&[-1, 0, 1]));
                m.set_vector(fpr, (near | random.next() << 63).into());
                true
            }));
        }

        let operation = op!(convert_f16_bits_to_f64(fpr, gpr));
        let operation = operation.wrapped(keeper, move |masm, _, emit| {
            emit(masm);
            masm.canonicalize_nan(fpr);
            masm.move_f64_to_bits(keeper, fpr);
        });
        let case = Case::new(if_supported(operation), move |m| {
            let value = half_to_double(m.get64(gpr) as u16);
            m.set64(
                keeper,
                if value.is_nan() {
                    0x7ff8 << 48
                } else {
                    value.to_bits()
                },
            );
            m.unspecified.push(Unspecified::IfBranched(keeper));
            m.forget(fpr);
            Outcome::Either
        });
        h.add(case.reads(Size::S16, gpr).with_all_boundaries(round < 4));
    }
}

#[test]
fn integers_to_floats() {
    let mut h = Harness::new();
    for round in 0..40 {
        for sign in SIGNS {
            for from in WIDTHS {
                for to in FLOAT_WIDTHS {
                    let (dst, src) = (h.any_fpr(), h.any_gpr());
                    let operation = op!(convert_int_to_float(sign, from, to, dst, src));
                    let case = Case::new(operation, move |m| {
                        let value: i128 = match sign {
                            Sign::Signed => m.get_signed(from, src).into(),
                            Sign::Unsigned => m.get(from, src).into(),
                        };
                        let rounded = match to {
                            FloatWidth::F32 => (value as f32).into(),
                            FloatWidth::F64 => value as f64,
                        };
                        m.set_float(to, dst, rounded);
                    });
                    let case = case.reads(from.size(), src);
                    h.add(
                        case.with_all_boundaries(round == 0)
                            .given(move |m, random| {
                                if round % 2 == 1 {
                                    let tie = 1 << random.pick(&[7, 10, 39, 40]);
                                    let value = random.next() & !(2 * tie - 1) | tie;
                                    m.set64(
                                        src,
                                        value.wrapping_add_signed(random.pick(&[-1, 0, 1])),
                                    );
                                }
                                true
                            }),
                    );
                }
            }
        }
    }
}

fn limits(sign: Sign, width: Width) -> (i128, i128) {
    match sign {
        Sign::Signed => (-1 << (width.bits() - 1), (1 << (width.bits() - 1)) - 1),
        Sign::Unsigned => (0, (1 << width.bits()) - 1),
    }
}

fn truncated(value: f64, sign: Sign, width: Width) -> Option<u64> {
    let (least, greatest) = limits(sign, width);
    let integer = value as i128;
    (!value.is_nan() && least <= integer && integer <= greatest).then_some(integer as u64)
}

#[test]
fn floats_to_integers() {
    let mut h = Harness::new();
    for round in 0..24 {
        for from in FLOAT_WIDTHS {
            for sign in SIGNS {
                for to in WIDTHS {
                    let (dst, src) = (h.any_gpr(), h.any_fpr());
                    let mut add = |case: Case| {
                        h.add(case.reads_float(from, src).with_all_boundaries(round < 4));
                    };
                    let operation = op!(truncate_float(from, sign, to, dst, src));
                    add(Case::new(operation, move |m| {
                        match truncated(m.float(from, src), sign, to) {
                            Some(integer) => m.set(to, dst, integer),
                            None => m.unspecified.push(Unspecified::WithinWidth(dst, to)),
                        }
                    }));

                    let operation = op!(truncate_float_saturating(from, sign, to, dst, src));
                    add(Case::new(operation, move |m| {
                        let (least, greatest) = limits(sign, to);
                        let integer = (m.float(from, src) as i128).clamp(least, greatest);
                        m.set(to, dst, integer as u64);
                    }));

                    let operation =
                        op!(truncate_float_or_branch(from, sign, to, dst, src) => target);
                    add(Case::new(operation, move |m| {
                        let integer = truncated(m.float(from, src), sign, to);
                        m.set(to, dst, integer.unwrap_or(0));
                        m.unspecified.push(Unspecified::IfBranched(dst));
                        integer.is_none()
                    }));
                }
            }
        }
    }
}

#[test]
fn to_int32() {
    let mut h = Harness::new();
    for round in 0..100 {
        let (dst, src) = (h.any_gpr(), h.any_fpr());
        let operation = op!(truncate_f64_to_int32_modular(dst, src) => target);
        let case = Case::new(operation, move |m| {
            let value = m.float(FloatWidth::F64, src);
            let has_low_bits = value.abs() < 2f64.powi(100);
            m.set(
                Width::W32,
                dst,
                if has_low_bits {
                    value as i128 as u64
                } else {
                    0
                },
            );
            if value.abs() < 2f64.powi(63) {
                return Outcome::FallsThrough;
            }
            m.unspecified.push(Unspecified::IfBranched(dst));
            Outcome::Either
        });
        let case = case.reads_float(FloatWidth::F64, src);
        h.add(case.with_all_boundaries(round < 4));
    }
}

#[test]
fn exact_conversions() {
    let mut h = Harness::new();
    for round in 0..40 {
        for width in WIDTHS {
            for zero in [NegativeZero::Accept, NegativeZero::Reject] {
                let (dst, src) = (h.any_gpr(), h.any_fpr());
                let operation = op!(convert_f64_to_int_exact(width, dst, src, zero) => target);
                let case = Case::new(operation, move |m| {
                    let value = m.float(FloatWidth::F64, src);
                    let is_rejected = zero == NegativeZero::Reject && value.to_bits() == 1 << 63;
                    let integer = truncated(value, Sign::Signed, width)
                        .filter(|_| value.trunc() == value && !is_rejected);
                    m.set(width, dst, integer.unwrap_or(0));
                    m.unspecified.push(Unspecified::IfBranched(dst));
                    integer.is_none()
                });
                let case = case.reads_float(FloatWidth::F64, src);
                h.add(case.with_all_boundaries(round < 4));
            }
        }
    }
}

fn holds(cond: FloatCond, lhs: f64, rhs: f64) -> bool {
    use Ordering::{Equal, Greater, Less};
    let order = lhs.partial_cmp(&rhs);
    match cond {
        FloatCond::Eq => matches!(order, Some(Equal)),
        FloatCond::Ne => matches!(order, Some(Less | Greater)),
        FloatCond::Lt => matches!(order, Some(Less)),
        FloatCond::Le => matches!(order, Some(Less | Equal)),
        FloatCond::Gt => matches!(order, Some(Greater)),
        FloatCond::Ge => matches!(order, Some(Greater | Equal)),
        FloatCond::EqOrUnordered => matches!(order, Some(Equal) | None),
        FloatCond::NeOrUnordered => matches!(order, Some(Less | Greater) | None),
        FloatCond::LtOrUnordered => matches!(order, Some(Less) | None),
        FloatCond::LeOrUnordered => matches!(order, Some(Less | Equal) | None),
        FloatCond::GtOrUnordered => matches!(order, Some(Greater) | None),
        FloatCond::GeOrUnordered => matches!(order, Some(Greater | Equal) | None),
        FloatCond::Ordered => order.is_some(),
        FloatCond::Unordered => order.is_none(),
    }
}

/// Every order of the operands comes up often.
fn compared(case: Case, width: FloatWidth, lhs: Fpr, rhs: Fpr) -> Case {
    let case = case.reads_float(width, lhs).reads_float(width, rhs);
    case.given(move |m, random| {
        for reg in [lhs, rhs] {
            if random.below(6) == 0 {
                let nan = machine::model::quiet_nan_bits(width);
                m.set_vector(reg, m.vector(reg) | u128::from(nan));
            }
        }
        true
    })
}

#[test]
fn comparisons() {
    let mut h = Harness::new();
    for width in FLOAT_WIDTHS {
        for cond in FloatCond::ALL {
            for round in 0..12 {
                for [lhs, rhs] in h.fprs() {
                    let operation = op!(branch_float(width, cond, lhs, rhs) => target);
                    let case = Case::new(operation, move |m| {
                        holds(cond, m.float(width, lhs), m.float(width, rhs))
                    });
                    h.add(compared(case, width, lhs, rhs));
                    let dst = h.any_gpr();
                    let operation = op!(compare_float(width, cond, dst, lhs, rhs));
                    let case = Case::new(operation, move |m| {
                        let result = holds(cond, m.float(width, lhs), m.float(width, rhs));
                        m.set64(dst, result.into());
                    });
                    h.add(compared(case, width, lhs, rhs));
                    let operation = op!(branch_float_with_zero(width, cond, lhs) => target);
                    let case = Case::new(operation, move |m| holds(cond, m.float(width, lhs), 0.0));
                    h.add(case.reads_float(width, lhs).with_all_boundaries(round < 2));
                }
            }
        }
    }
}

#[test]
fn every_pair_of_boundaries_is_compared() {
    let mut h = Harness::new();
    for (index, cond) in FloatCond::ALL.into_iter().enumerate() {
        let (width, [lhs, rhs]) = (FLOAT_WIDTHS[index / 2 % 2], h.fprs()[1]);
        let case = Case::new(
            op!(branch_float(width, cond, lhs, rhs) => target),
            move |m| holds(cond, m.float(width, lhs), m.float(width, rhs)),
        );
        let case = case.reads_float(width, lhs).reads_float(width, rhs);
        h.add(case.with_all_boundaries(true));
    }
}

#[test]
fn selects_on_floats() {
    let mut h = Harness::new();
    for width in FLOAT_WIDTHS {
        for cond in FloatCond::ALL {
            for [dst, lhs, rhs, then, or] in h.fprs() {
                let operation = op!(select_float_on_float(width, cond, dst, lhs, rhs, then, or));
                let case = Case::new(operation, move |m| {
                    let outcome = holds(cond, m.float(width, lhs), m.float(width, rhs));
                    let chosen = m.vector(if outcome { then } else { or });
                    m.set_float_bits(FloatWidth::F64, dst, chosen as u64);
                });
                h.add(compared(case, width, lhs, rhs));
            }
            for _ in 0..3 {
                for [lhs, rhs] in h.fprs() {
                    for [dst, then, or] in h.gprs() {
                        let operation = op!(select_on_float(width, cond, dst, lhs, rhs, then, or));
                        let case = Case::new(operation, move |m| {
                            let outcome = holds(cond, m.float(width, lhs), m.float(width, rhs));
                            m.set64(dst, m.get64(if outcome { then } else { or }));
                        });
                        h.add(compared(case, width, lhs, rhs));
                    }
                }
            }
        }
    }
}

#[test]
fn selects_on_integers() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in TestCond::ALL {
            for ([value], mask) in h.registers_or_constants() {
                let patterns = h.fprs();
                let [dst, then, or] = h.random.pick(&patterns);
                let chosen = move |m: &machine::Machine| {
                    let masked = sign_extend(size, m.get64(value) & m.read(width, mask));
                    let outcome = match cond {
                        TestCond::Zero => masked == 0,
                        TestCond::NonZero => masked != 0,
                        TestCond::Negative => masked < 0,
                        TestCond::NonNegative => masked >= 0,
                    };
                    m.vector(if outcome { then } else { or })
                };
                let operation = op!(select_vector_test(width, cond, dst, value, mask, then, or));
                let case = Case::new(operation, move |m| m.set_vector(dst, chosen(m)));
                h.add(case.reads(size, value).reads(size, mask));
                let operation = op!(select_float_test(width, cond, dst, value, mask, then, or));
                let case = Case::new(operation, move |m| {
                    m.set_float_bits(FloatWidth::F64, dst, chosen(m) as u64);
                });
                h.add(case.reads(size, value).reads(size, mask));
            }
        }
    }
}
