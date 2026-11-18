mod machine;
mod support;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Amount, Shift, Src};
use machine::operands::{CONSTANTS, OFFSETS, SCALES, SP};
use machine::values::{mask, sign_extend};
use machine::{Case, Harness, Operation, SIGNS, SIZES, WIDTHS, host, moving_stack_pointer, op};

const SHIFTS: [Shift; 5] = [
    Shift::Left,
    Shift::RightLogical,
    Shift::RightArithmetic,
    Shift::RotateLeft,
    Shift::RotateRight,
];

fn extended(sign: Sign, size: Size, value: u64) -> i128 {
    match sign {
        Sign::Signed => sign_extend(size, value).into(),
        Sign::Unsigned => (value & mask(size)).into(),
    }
}

fn shifted(shift: Shift, width: Width, value: u64, amount: u32) -> u64 {
    let short = value as u32;
    match (shift, width) {
        (Shift::Left, _) => value << amount,
        (Shift::RightLogical, _) => (value & mask(width.size())) >> amount,
        (Shift::RightArithmetic, _) => (sign_extend(width.size(), value) >> amount) as u64,
        (Shift::RotateLeft, Width::W32) => short.rotate_left(amount).into(),
        (Shift::RotateRight, Width::W32) => short.rotate_right(amount).into(),
        (Shift::RotateLeft, Width::W64) => value.rotate_left(amount),
        (Shift::RotateRight, Width::W64) => value.rotate_right(amount),
    }
}

fn binary(operation: fn(Width, Gpr, Gpr, Src) -> Operation, model: fn(u64, u64) -> u64) {
    let mut h = Harness::new();
    for width in WIDTHS {
        for (index, ([dst, lhs], rhs)) in h.sources().into_iter().enumerate() {
            let case = Case::new(operation(width, dst, lhs, rhs), move |m| {
                m.set(width, dst, model(m.get(width, lhs), m.read(width, rhs)));
            });
            let case = case.reads(width.size(), lhs).reads(width.size(), rhs);
            h.add(case.with_all_boundaries(index == 4));
        }
    }
}

#[test]
fn add() {
    binary(|w, d, a, b| op!(add(w, d, a, b)), u64::wrapping_add);
}

#[test]
fn sub() {
    binary(|w, d, a, b| op!(sub(w, d, a, b)), u64::wrapping_sub);
}

#[test]
fn mul() {
    binary(|w, d, a, b| op!(mul(w, d, a, b)), u64::wrapping_mul);
}

#[test]
fn and() {
    binary(|w, d, a, b| op!(and(w, d, a, b)), |a, b| a & b);
}

#[test]
fn or() {
    binary(|w, d, a, b| op!(or(w, d, a, b)), |a, b| a | b);
}

#[test]
fn xor() {
    binary(|w, d, a, b| op!(xor(w, d, a, b)), |a, b| a ^ b);
}

#[test]
fn constants_near_powers_of_two() {
    let mut h = Harness::new();
    for width in WIDTHS {
        for power in (0..64).map(|log2| 1i64 << log2) {
            for near in [-1, 0, 1].map(|delta| power.wrapping_add(delta)) {
                for rhs in [near, near.wrapping_neg()] {
                    for [dst, lhs] in h.gprs() {
                        let mut add = |operation, model: fn(u64, u64) -> u64| {
                            let case = Case::new(operation, move |m| {
                                m.set(width, dst, model(m.get(width, lhs), rhs as u64));
                            });
                            h.add(case.reads(width.size(), lhs));
                        };
                        add(op!(mul(width, dst, lhs, rhs)), u64::wrapping_mul);
                        add(op!(add(width, dst, lhs, rhs)), u64::wrapping_add);
                        add(op!(sub(width, dst, lhs, rhs)), u64::wrapping_sub);
                        add(op!(and(width, dst, lhs, rhs)), |a, b| a & b);
                    }
                }
            }
        }
    }
}

#[test]
fn unary() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let bits = u64::from(width.bits());
        for round in 0..24 {
            for [dst, src] in h.gprs() {
                let mut add = |operation, model: fn(u64, u64) -> u64| {
                    let case = Case::new(operation, move |m| {
                        m.set(width, dst, model(m.get(width, src), bits));
                    });
                    h.add(case.reads(width.size(), src).with_all_boundaries(round < 2));
                };
                add(op!(neg(width, dst, src)), |a, _| a.wrapping_neg());
                add(op!(not(width, dst, src)), |a, _| !a);
                add(op!(count_leading_zeros(width, dst, src)), |a, bits| {
                    u64::from(a.leading_zeros()) - (64 - bits)
                });
                add(op!(count_trailing_zeros(width, dst, src)), |a, bits| {
                    u64::from(a.trailing_zeros()).min(bits)
                });
                add(op!(count_ones(width, dst, src)), |a, _| {
                    a.count_ones().into()
                });
            }
        }
    }
}

#[test]
fn moves() {
    let mut h = Harness::new();
    h.use_first_scratch_for_operands();
    for width in WIDTHS {
        for _ in 0..4 {
            for ([dst], src) in h.registers_or_constants() {
                let case = Case::new(op!(move_int(width, dst, src)), move |m| {
                    m.set(width, dst, m.read(width, src));
                });
                h.add(case.reads(width.size(), src).keeps_first_scratch());
            }
        }
    }
    for _ in 0..40 {
        for [a, b] in h.gprs() {
            let case = Case::new(op!(swap(a, b)), move |m| {
                let (first, second) = (m.get64(a), m.get64(b));
                m.set64(a, second);
                m.set64(b, first);
            });
            h.add(case.keeps_first_scratch());
        }
    }
}

#[test]
fn extension_and_byte_order() {
    let mut h = Harness::new();
    for round in 0..24 {
        for from in SIZES {
            for [dst, src] in h.gprs() {
                let case = Case::new(op!(swap_bytes(from, dst, src)), move |m| {
                    m.set64(dst, m.get64(src).swap_bytes() >> (64 - from.bits()));
                });
                h.add(case.reads(from, src));
                for width in WIDTHS.into_iter().filter(|width| from <= width.size()) {
                    for sign in SIGNS {
                        let case = Case::new(op!(extend(from, sign, width, dst, src)), move |m| {
                            m.set(width, dst, extended(sign, from, m.get64(src)) as u64);
                        });
                        let case = case.reads(from, src).keeps_first_scratch();
                        h.add(case.with_all_boundaries(round == 0));
                    }
                }
            }
        }
    }
}

#[test]
fn extract_bits() {
    let mut h = Harness::new();
    for width in WIDTHS {
        for first in 0..width.bits() {
            for count in 1..=width.bits() - first {
                for (sign, [dst, src]) in SIGNS.into_iter().zip(h.gprs()) {
                    let src = if (first + count) % 2 == 0 { src } else { dst };
                    let operation = op!(extract_bits(sign, width, dst, src, first, count));
                    let case = Case::new(operation, move |m| {
                        let at_top = m.get64(src) << (64 - first - count);
                        let field = match sign {
                            Sign::Signed => (at_top as i64 >> (64 - count)) as u64,
                            Sign::Unsigned => at_top >> (64 - count),
                        };
                        m.set(width, dst, field);
                    });
                    h.add(case.reads(width.size(), src));
                }
            }
        }
    }
}

#[test]
fn shifts() {
    let mut h = Harness::new();
    for width in WIDTHS {
        for shift in SHIFTS {
            let mut operands = Vec::new();
            for _ in 0..6 {
                let patterns = h.gprs_with(host::SHIFT_REGISTERS).into_iter();
                operands.extend(patterns.map(|[dst, src, by]| (dst, src, Amount::Reg(by))));
            }
            for amount in (0..=65).chain([96, 127, 128, 255]) {
                let patterns = h.gprs().into_iter();
                operands.extend(patterns.map(|[dst, src]| (dst, src, Amount::Imm(amount))));
            }
            for (index, (dst, src, amount)) in operands.into_iter().enumerate() {
                let case = Case::new(op!(shift(shift, width, dst, src, amount)), move |m| {
                    let value = shifted(shift, width, m.get64(src), m.amount(width, amount));
                    m.set(width, dst, value);
                });
                let case = case.reads(width.size(), src).reads_amount(amount);
                h.add(case.with_all_boundaries(index < 16));
            }
        }
    }
}

#[test]
fn operations_on_a_shifted_operand() {
    let mut h = Harness::new();
    for width in WIDTHS {
        for shift in SHIFTS {
            for amount in (0..=65).chain([255]) {
                for [dst, lhs, rhs] in h.gprs() {
                    let mut add = |operation, model: fn(u64, u64) -> u64| {
                        let case = Case::new(operation, move |m| {
                            let amount = m.amount(width, Amount::Imm(amount));
                            let rhs = shifted(shift, width, m.get64(rhs), amount);
                            m.set(width, dst, model(m.get64(lhs), rhs));
                        });
                        h.add(case.reads(width.size(), lhs).reads(width.size(), rhs));
                    };
                    let operation = op!(xor_shifted(width, dst, lhs, rhs, shift, amount));
                    add(operation, |a, b| a ^ b);
                    if !matches!(shift, Shift::RotateLeft | Shift::RotateRight) {
                        let operation = op!(add_shifted(width, dst, lhs, rhs, shift, amount));
                        add(operation, u64::wrapping_add);
                    }
                }
            }
        }
    }
}

#[test]
fn division() {
    let mut h = Harness::new();
    let clobbers = MacroAssembler::DIVISION_CLOBBERS;
    for width in WIDTHS {
        let size = width.size();
        for sign in SIGNS {
            for round in 0..6 {
                for [dst, lhs, rhs] in h.gprs_with(host::DIVISION_REGISTERS) {
                    if clobbers.contains(rhs) {
                        continue;
                    }
                    let mut add = |operation, model: fn(i128, i128) -> i128| {
                        let case = Case::new(operation, move |m| {
                            let [a, b] = [lhs, rhs].map(|reg| extended(sign, size, m.get64(reg)));
                            m.set(width, dst, model(a, b) as u64);
                        });
                        let case = case.given(move |m, _| {
                            let [a, b] = [lhs, rhs].map(|reg| extended(sign, size, m.get64(reg)));
                            b != 0 && extended(sign, size, (a / b) as u64) == a / b
                        });
                        let case = case.reads(size, lhs).reads(size, rhs).clobbers(clobbers);
                        h.add(case.with_all_boundaries(round == 0 && dst != lhs && lhs != rhs));
                    };
                    add(op!(div(sign, width, dst, lhs, rhs)), |a, b| a / b);
                    add(op!(rem(sign, width, dst, lhs, rhs)), |a, b| a % b);
                }
            }
        }
    }
}

#[test]
fn long_multiplication() {
    let mut h = Harness::new();
    let clobbers = MacroAssembler::DIVISION_CLOBBERS;
    for sign in SIGNS {
        for round in 0..4 {
            for [low, high, lhs, rhs] in h.gprs_with(host::DIVISION_REGISTERS) {
                if clobbers.contains(rhs) {
                    continue;
                }
                let product = move |m: &machine::Machine| {
                    let [a, b] = [lhs, rhs].map(|reg| extended(sign, Size::S64, m.get64(reg)));
                    a.wrapping_mul(b)
                };
                let case = if low == high {
                    Case::new(op!(mul_high64(sign, high, lhs, rhs)), move |m| {
                        m.set64(high, (product(m) >> 64) as u64);
                    })
                } else {
                    Case::new(op!(mul_wide64(sign, low, high, lhs, rhs)), move |m| {
                        let product = product(m);
                        m.set64(low, product as u64);
                        m.set64(high, (product >> 64) as u64);
                    })
                };
                let case = case.reads(Size::S64, lhs).reads(Size::S64, rhs);
                let case = case.with_all_boundaries(round == 0 && high == lhs && lhs != rhs);
                h.add(case.clobbers(clobbers));
            }
        }
    }
}

#[test]
fn pairs_of_registers() {
    let mut h = Harness::new();
    for _ in 0..3 {
        for [d0, d1, a0, a1, b0, b1] in h.gprs() {
            if [d1, a1, b1].contains(&d0) {
                continue;
            }
            let (dst, lhs, rhs) = ([d0, d1], [a0, a1], [b0, b1]);
            let mut add = |operation, model: fn(u128, u128) -> u128| {
                let case = Case::new(operation, move |m| {
                    let [a, b] = [lhs, rhs].map(|[low, high]| {
                        u128::from(m.get64(high)) << 64 | u128::from(m.get64(low))
                    });
                    m.set64(d0, model(a, b) as u64);
                    m.set64(d1, (model(a, b) >> 64) as u64);
                });
                let inputs = [a0, b0, a1, b1].into_iter();
                h.add(inputs.fold(case, |case, reg| case.reads(Size::S64, reg)));
            };
            add(op!(add128(dst, lhs, rhs)), u128::wrapping_add);
            add(op!(sub128(dst, lhs, rhs)), u128::wrapping_sub);
        }
    }
}

#[test]
fn compute_address() {
    let mut h = Harness::new();
    for ([dst], address) in h.addresses(&[], OFFSETS.len()) {
        let case = Case::new(op!(compute_address(dst, address)), move |m| {
            m.set64(dst, m.address(address) as u64);
        });
        h.add(case.keeps_first_scratch());
    }
}

/// `operation` writes `dst` and reads neither `keeper` nor memory.
fn with_stack_pointer(
    operation: Operation,
    dst: Gpr,
    keeper: Gpr,
    model: impl Fn(&machine::Machine) -> u64 + 'static,
) -> Case {
    let model = move |m: &mut machine::Machine| m.set64(dst, model(m));
    if dst == SP {
        moving_stack_pointer(operation, keeper, model)
    } else {
        Case::new(operation, model)
    }
}

#[test]
fn the_stack_pointer_as_an_operand() {
    let mut h = Harness::new();
    let keeper = abi::SAVED_GPRS[0];
    h.operand_registers.remove(keeper);
    let constants = CONSTANTS.map(Src::Imm).into_iter();
    let constants = constants.chain(CONSTANTS.map(Src::Untrusted));
    for constant in constants.map(Some).chain([None; 8]) {
        for [dst, lhs, other] in h.gprs_with(&[SP]) {
            let rhs = constant.unwrap_or(Src::Reg(other));
            if constant.is_some() && other != lhs {
                continue;
            }
            let mut add = |operation, model: fn(u64, u64) -> u64| {
                let case = with_stack_pointer(operation, dst, keeper, move |m| {
                    model(m.get64(lhs), m.read(Width::W64, rhs))
                });
                h.add(case.reads(Size::S64, rhs));
            };
            add(op!(add64(dst, lhs, rhs)), u64::wrapping_add);
            add(op!(sub64(dst, lhs, rhs)), u64::wrapping_sub);
            if constant.is_some() {
                add(op!(and64(dst, lhs, rhs)), |a, b| a & b);
            }
        }
    }
    for ([other], rhs) in h.memories(4) {
        for (dst, lhs) in [(SP, other), (SP, SP), (other, SP)] {
            let mut add = |operation, model: fn(u64, u64) -> u64| {
                let case = with_stack_pointer(operation, dst, keeper, move |m| {
                    model(m.get64(lhs), m.load(Size::S64, rhs))
                });
                h.add(case.reads(Size::S64, rhs));
            };
            add(op!(add64(dst, lhs, rhs)), u64::wrapping_add);
            add(op!(sub64(dst, lhs, rhs)), u64::wrapping_sub);
        }
    }
    for [dst, src] in h.gprs_with(&[SP]) {
        let case = with_stack_pointer(op!(move64(dst, src)), dst, keeper, move |m| m.get64(src));
        h.add(case.keeps_first_scratch());
    }
    for offset in OFFSETS {
        for [base, index] in h.gprs_with(&[SP]) {
            let address = if index == SP {
                Address::new(base, offset)
            } else {
                Address::indexed(base, index, h.random.pick(&SCALES), offset)
            };
            let operation = op!(compute_address(SP, address));
            let case =
                with_stack_pointer(operation, SP, keeper, move |m| m.address(address) as u64);
            h.add(case.keeps_first_scratch());
        }
    }
}
