mod machine;
mod support;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Amount, RegOrImm, RegOrMem, Src};
use machine::operands::{CONSTANTS, SP};
use machine::values::{mask, sign_extend};
use machine::{Case, Harness, Machine, Operation, WIDTHS, op};

const NARROW: [Size; 2] = [Size::S8, Size::S16];

fn holds(cond: Cond, size: Size, lhs: u64, rhs: u64) -> bool {
    let (a, b) = (lhs & mask(size), rhs & mask(size));
    let (x, y) = (sign_extend(size, lhs), sign_extend(size, rhs));
    match cond {
        Cond::Eq => a == b,
        Cond::Ne => a != b,
        Cond::Lt => x < y,
        Cond::Ge => x >= y,
        Cond::Le => x <= y,
        Cond::Gt => x > y,
        Cond::Below => a < b,
        Cond::AboveEq => a >= b,
        Cond::BelowEq => a <= b,
        Cond::Above => a > b,
    }
}

fn passes(cond: TestCond, size: Size, value: u64, mask: u64) -> bool {
    let masked = sign_extend(size, value & mask);
    match cond {
        TestCond::Zero => masked == 0,
        TestCond::NonZero => masked != 0,
        TestCond::Negative => masked < 0,
        TestCond::NonNegative => masked >= 0,
    }
}

/// `exact` gives the result without bounds, for operands that are taken as signed or as unsigned.
fn result_and_outcome(
    cond: ResultCond,
    size: Size,
    lhs: u64,
    rhs: u64,
    exact: fn(i128, i128) -> i128,
) -> (u64, bool) {
    let signed = exact(sign_extend(size, lhs).into(), sign_extend(size, rhs).into());
    let unsigned = exact((lhs & mask(size)).into(), (rhs & mask(size)).into());
    let result = signed as u64 & mask(size);
    let (cond, is_inverted) = (ResultCond::ALL[cond as usize & !1], cond as usize % 2 == 1);
    let holds = match cond {
        ResultCond::Zero => result == 0,
        ResultCond::Negative => sign_extend(size, result) < 0,
        ResultCond::Overflow => i128::from(sign_extend(size, result)) != signed,
        _ => i128::from(result) != unsigned,
    };
    (result, holds != is_inverted)
}

/// `N` other registers and the two sides of a comparison.
fn comparisons<const N: usize, const AND_ONE: usize>(
    h: &mut Harness,
) -> Vec<([Gpr; N], RegOrMem, Src)> {
    let mut all = Vec::new();
    for (registers, rhs) in h.sources::<AND_ONE>() {
        all.push((*registers.first_chunk().unwrap(), registers[N].into(), rhs));
    }
    for (others, lhs, rhs) in h.memories_and_operands::<N, AND_ONE>() {
        all.push((others, lhs.into(), rhs.into()));
    }
    all
}

fn tests<const N: usize, const AND_ONE: usize>(
    h: &mut Harness,
) -> Vec<([Gpr; N], RegOrMem, RegOrImm)> {
    let mut all = Vec::new();
    for (registers, mask) in h.registers_or_constants::<AND_ONE>() {
        all.push((*registers.first_chunk().unwrap(), registers[N].into(), mask));
    }
    for (others, value, mask) in h.memories_and_operands::<N, AND_ONE>() {
        all.push((others, value.into(), mask));
    }
    let values = h.registers_or_memories::<N>();
    for bit in 0..64 {
        let (others, value) = h.random.pick(&values);
        all.push((others, value, RegOrImm::Imm(1 << bit)));
        let (others, value) = h.random.pick(&values);
        all.push((others, value, RegOrImm::Imm(0x25 << bit)));
    }
    all
}

/// Makes it likely that few of the bits of the mask are set.
fn sparse(case: Case, size: Size, value: RegOrMem, mask: RegOrImm) -> Case {
    let (RegOrImm::Imm(mask) | RegOrImm::Untrusted(mask)) = mask else {
        return case;
    };
    case.given(move |m, random| {
        let one_bit = 1 << random.below(size.bits().into());
        let new = random.next() & !mask as u64 | random.pick(&[0, one_bit]);
        match value {
            _ if random.below(2) == 0 => {}
            RegOrMem::Reg(reg) => m.set64(reg, new),
            RegOrMem::Mem(memory) => m.store(size, memory, new),
        }
        true
    })
}

fn branch(width: Width) {
    let (mut h, size) = (Harness::new(), width.size());
    for cond in Cond::ALL {
        for (index, ([], lhs, rhs)) in comparisons::<0, 1>(&mut h).into_iter().enumerate() {
            let case = Case::new(op!(branch(width, cond, lhs, rhs) => target), move |m| {
                holds(cond, size, m.read(width, lhs), m.read(width, rhs))
            });
            let case = case.reads(size, lhs).reads(size, rhs);
            h.add(case.with_all_boundaries(index == 1));
        }
    }
}

#[test]
fn branch32() {
    branch(Width::W32);
}

#[test]
fn branch64() {
    branch(Width::W64);
}

fn compare(width: Width) {
    let (mut h, size) = (Harness::new(), width.size());
    for cond in Cond::ALL {
        for ([dst], lhs, rhs) in comparisons::<1, 2>(&mut h) {
            let case = Case::new(op!(compare(width, cond, dst, lhs, rhs)), move |m| {
                let result = holds(cond, size, m.read(width, lhs), m.read(width, rhs));
                m.set64(dst, result.into());
            });
            h.add(case.reads(size, lhs).reads(size, rhs));
        }
    }
}

#[test]
fn compare32() {
    compare(Width::W32);
}

#[test]
fn compare64() {
    compare(Width::W64);
}

#[test]
fn constants_next_to_short_ones() {
    let mut h = Harness::new();
    let round = [
        0,
        1 << 12,
        0xe << 12,
        1 << 16,
        0xfff << 12,
        1 << 24,
        1 << 31,
        1 << 32,
        i64::MIN,
    ];
    for width in WIDTHS {
        let size = width.size();
        for cond in Cond::ALL {
            for near in round
                .into_iter()
                .flat_map(|value| [value, value.wrapping_neg()])
            {
                for rhs in [-2, -1, 0, 1, 2].map(|delta| near.wrapping_add(delta)) {
                    let lhs = h.any_gpr();
                    let operation = op!(branch(width, cond, lhs, rhs) => target);
                    let case = Case::new(operation, move |m| {
                        holds(cond, size, m.get64(lhs), rhs as u64)
                    });
                    h.add(case.reads(size, lhs).reads(size, rhs));
                }
            }
        }
    }
}

#[test]
fn the_stack_pointer_is_compared() {
    let mut h = Harness::new();
    let sp = h.stack_pointer() as i64;
    for cond in Cond::ALL {
        let near = [sp - 1, sp, sp + 1].map(|value| ([], Src::Imm(value)));
        for ([], rhs) in h.sources().into_iter().chain(near) {
            let case = Case::new(op!(branch64(cond, SP, rhs) => target), move |m| {
                holds(cond, Size::S64, m.get64(SP), m.read(Width::W64, rhs))
            });
            h.add(case.reads(Size::S64, sp).reads(Size::S64, rhs));
        }
    }
}

#[test]
fn branch_test() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in TestCond::ALL {
            for ([], value, mask) in tests::<0, 1>(&mut h) {
                let operation = op!(branch_test(width, cond, value, mask) => target);
                let case = Case::new(operation, move |m| {
                    passes(cond, size, m.read(width, value), m.read(width, mask))
                });
                let case = case.reads(size, value).reads(size, mask);
                h.add(sparse(case, size, value, mask));
            }
        }
    }
}

#[test]
fn test() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in TestCond::ALL {
            for ([dst], value, mask) in tests::<1, 2>(&mut h) {
                let case = Case::new(op!(test(width, cond, dst, value, mask)), move |m| {
                    let result = passes(cond, size, m.read(width, value), m.read(width, mask));
                    m.set64(dst, result.into());
                });
                let case = case.reads(size, value).reads(size, mask);
                h.add(sparse(case, size, value, mask));
            }
        }
    }
}

fn narrow_constants(size: Size) -> impl Iterator<Item = i32> {
    let bytes = (0..256).step_by(if size == Size::S8 { 1 } else { 15 });
    let bits = (0..16).flat_map(|bit| [1 << bit, 3 << bit, !(1 << bit), (1 << bit) - 1]);
    let more = [
        0xd800,
        0xdc00,
        0xfc00,
        0xf001,
        0xf000,
        0xefff,
        0xaaaa,
        0x8181,
        0x1234_8001,
    ];
    let usual = CONSTANTS.into_iter().map(|constant| constant as i32);
    usual.chain(bytes).chain(bits).chain(more)
}

#[test]
fn narrow_comparisons() {
    let mut h = Harness::new();
    for size in NARROW {
        for cond in Cond::ALL {
            let memories = h.memories(2);
            for rhs in narrow_constants(size) {
                let ([dst], lhs) = h.random.pick(&memories);
                let outcome = move |m: &Machine| holds(cond, size, m.load(size, lhs), rhs as u64);
                let operation = op!(branch_narrow(size, cond, lhs, rhs) => target);
                let case = Case::new(operation, move |m| outcome(m));
                h.add(case.reads(size, lhs).reads(size, rhs));
                let operation = op!(compare_narrow(size, cond, dst, lhs, rhs));
                let case = Case::new(operation, move |m| m.set64(dst, outcome(m).into()));
                h.add(case.reads(size, lhs).reads(size, rhs));
            }
        }
    }
}

#[test]
fn narrow_tests() {
    let mut h = Harness::new();
    for size in NARROW {
        for cond in TestCond::ALL {
            let memories = h.memories(2);
            for mask in narrow_constants(size) {
                let ([dst], value) = h.random.pick(&memories);
                let outcome =
                    move |m: &Machine| passes(cond, size, m.load(size, value), mask as u64);
                let mut add = |case: Case| {
                    let case = case.reads(size, value).reads(size, mask);
                    h.add(sparse(case, size, value.into(), mask.into()));
                };
                let operation = op!(branch_test_narrow(size, cond, value, mask) => target);
                add(Case::new(operation, move |m| outcome(m)));
                let operation = op!(test_narrow(size, cond, dst, value, mask));
                add(Case::new(operation, move |m| {
                    m.set64(dst, outcome(m).into())
                }));
            }
        }
    }
}

#[test]
fn branch_test_bit() {
    let mut h = Harness::new();
    for width in WIDTHS {
        for cond in [TestCond::Zero, TestCond::NonZero] {
            let mut operands = Vec::new();
            for bit in (0..=65).chain([127, 255]) {
                operands.push((h.any_gpr(), Amount::Imm(bit)));
                let patterns = h.gprs().into_iter();
                operands.extend(patterns.map(|[value, bit]| (value, Amount::Reg(bit))));
            }
            for (value, bit) in operands {
                let operation = op!(branch_test_bit(width, cond, value, bit) => target);
                let case = Case::new(operation, move |m| {
                    let is_set = m.get64(value) >> m.amount(width, bit) & 1 != 0;
                    is_set == (cond == TestCond::NonZero)
                });
                h.add(case.reads(width.size(), value).reads_amount(bit));
            }
        }
    }
}

fn arithmetic(
    width: Width,
    conditions: &[ResultCond],
    operation: fn(Width, ResultCond, Gpr, Gpr, Src) -> Operation,
    exact: fn(i128, i128) -> i128,
) {
    let (mut h, size) = (Harness::new(), width.size());
    for &cond in conditions {
        for (index, ([dst, lhs], rhs)) in h.sources().into_iter().enumerate() {
            let case = Case::new(operation(width, cond, dst, lhs, rhs), move |m| {
                let (a, b) = (m.get64(lhs), m.read(width, rhs));
                let (result, outcome) = result_and_outcome(cond, size, a, b, exact);
                m.set64(dst, result);
                outcome
            });
            let case = case.reads(size, lhs).reads(size, rhs);
            h.add(case.with_all_boundaries(index == 4));
        }
    }
}

fn branch_add(width: Width) {
    arithmetic(
        width,
        &ResultCond::ALL,
        |w, cond, d, a, b| op!(branch_add(w, cond, d, a, b) => target),
        |a, b| a + b,
    );
}

fn branch_sub(width: Width) {
    arithmetic(
        width,
        &ResultCond::ALL,
        |w, cond, d, a, b| op!(branch_sub(w, cond, d, a, b) => target),
        |a, b| a - b,
    );
}

#[test]
fn branch_add32() {
    branch_add(Width::W32);
}

#[test]
fn branch_add64() {
    branch_add(Width::W64);
}

#[test]
fn branch_sub32() {
    branch_sub(Width::W32);
}

#[test]
fn branch_sub64() {
    branch_sub(Width::W64);
}

#[test]
fn branch_mul_overflow() {
    for width in WIDTHS {
        arithmetic(
            width,
            &[ResultCond::Overflow; 3],
            |w, _, d, a, b| op!(branch_mul_overflow(w, d, a, b) => target),
            i128::wrapping_mul,
        );
    }
}

#[test]
fn branch_neg() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in ResultCond::ALL[..6].iter().copied() {
            for round in 0..8 {
                for [dst, src] in h.gprs() {
                    let operation = op!(branch_neg(width, cond, dst, src) => target);
                    let case = Case::new(operation, move |m| {
                        let (result, outcome) =
                            result_and_outcome(cond, size, 0, m.get64(src), |a, b| a - b);
                        m.set64(dst, result);
                        outcome
                    });
                    h.add(case.reads(size, src).with_all_boundaries(round == 0));
                }
            }
        }
    }
}

#[test]
fn branch_add_to_memory() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in ResultCond::ALL {
            let memories = h.memories(4);
            for src in CONSTANTS.map(|constant| constant as i32) {
                for _ in 0..3 {
                    let ([], dst) = h.random.pick(&memories);
                    let operation = op!(branch_add_to_memory(width, cond, dst, src) => target);
                    let case = Case::new(operation, move |m| {
                        let (old, src) = (m.load(size, dst), i64::from(src) as u64);
                        let (result, outcome) =
                            result_and_outcome(cond, size, old, src, |a, b| a + b);
                        m.store(size, dst, result);
                        outcome
                    });
                    h.add(case.reads(size, dst).reads(size, src));
                }
            }
        }
    }
}

#[test]
fn select() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in Cond::ALL {
            for ([dst, lhs, then, or], rhs) in h.registers_or_constants() {
                let operation = op!(select(width, cond, dst, lhs, rhs, then, or));
                let case = Case::new(operation, move |m| {
                    let outcome = holds(cond, size, m.get64(lhs), m.read(width, rhs));
                    m.set64(dst, m.get64(if outcome { then } else { or }));
                });
                h.add(case.reads(size, lhs).reads(size, rhs));
            }
        }
    }
}

#[test]
fn select_test() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let size = width.size();
        for cond in TestCond::ALL {
            for ([dst, value, then, or], mask) in h.registers_or_constants() {
                let operation = op!(select_test(width, cond, dst, value, mask, then, or));
                let case = Case::new(operation, move |m| {
                    let outcome = passes(cond, size, m.get64(value), m.read(width, mask));
                    m.set64(dst, m.get64(if outcome { then } else { or }));
                });
                let case = case.reads(size, value).reads(size, mask);
                h.add(sparse(case, size, value.into(), mask));
            }
        }
    }
}

#[test]
fn comparisons_with_zero() {
    let mut h = Harness::new();
    for ([], value) in h.registers_or_memories() {
        let mut add = |operation, width: Width, if_zero: bool| {
            let case = Case::new(operation, move |m| (m.read(width, value) == 0) == if_zero);
            h.add(case.reads(width.size(), value).reads(width.size(), 0));
        };
        add(op!(branch_if_zero32(value) => target), Width::W32, true);
        add(
            op!(branch_if_not_zero32(value) => target),
            Width::W32,
            false,
        );
        add(op!(branch_if_zero64(value) => target), Width::W64, true);
        add(
            op!(branch_if_not_zero64(value) => target),
            Width::W64,
            false,
        );
    }
}
