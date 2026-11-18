mod machine;
mod support;

use bun_engine_asm::RegOrMem;
use bun_engine_asm::prelude::*;
use machine::values::Random;
use machine::{Case, Harness, Operation, op};

const NUMBER_TAG: u64 = 0xfffe_0000_0000_0000;
const NOT_CELL_MASK: u64 = NUMBER_TAG | 2;
const DOUBLE_OFFSET: u64 = 1 << 49;
const CANONICAL_NAN: u64 = 0x7ff8 << 48;

#[derive(Clone, Copy, PartialEq)]
enum Value {
    Empty,
    Null,
    Undefined,
    Boolean,
    Int32,
    Double,
    Cell,
}

fn classify(bits: u64) -> Value {
    match bits {
        0 => Value::Empty,
        0x02 => Value::Null,
        0x0a => Value::Undefined,
        0x06 | 0x07 => Value::Boolean,
        _ if bits >> 32 == NUMBER_TAG >> 32 => Value::Int32,
        _ if bits >= DOUBLE_OFFSET => Value::Double,
        _ => Value::Cell,
    }
}

fn any_double(random: &mut Random) -> u64 {
    let special = [
        0.0,
        -0.0,
        1.5,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::MIN_POSITIVE,
    ];
    let value = [random.pick(&special), f64::from_bits(random.next())][random.below(2)];
    if value.is_nan() {
        CANONICAL_NAN
    } else {
        value.to_bits()
    }
}

fn any_value(random: &mut Random) -> u64 {
    let word = random.next();
    match random.below(4) {
        0 => NUMBER_TAG | random.pick(&[0, 2, 6, 10, 0x8000_0000, 0xffff_ffff, word >> 32]),
        1 => any_double(random) + DOUBLE_OFFSET,
        2 => random.pick(&[8, 16, 1 << 32, 1 << 48, (word >> 15 & !7).max(8)]),
        _ => random.pick(&[0, 0x02, 0x06, 0x07, 0x0a]),
    }
}

fn harness() -> Harness {
    let mut h = Harness::new();
    h.operand_registers -= abi::PINNED;
    h
}

fn with_tags(case: Case) -> Case {
    case.given(|m, _| {
        m.set64(abi::NUMBER_TAG, NUMBER_TAG);
        m.set64(abi::NOT_CELL_MASK, NOT_CELL_MASK);
        true
    })
}

fn about(value: RegOrMem, operation: Operation, holds: impl Fn(Value) -> bool + 'static) -> Case {
    let case = Case::new(operation, move |m| {
        holds(classify(m.read(Width::W64, value)))
    });
    with_tags(case.reads(Size::S64, value)).given(move |m, random| {
        match value {
            RegOrMem::Reg(reg) => m.set64(reg, any_value(random)),
            RegOrMem::Mem(memory) => m.store(Size::S64, memory, any_value(random)),
        }
        true
    })
}

#[test]
fn kinds_of_values() {
    use Value::*;
    let mut h = harness();
    let mut values = h.registers_or_memories();
    values.extend(
        (0..40)
            .map(|_| ([], h.any_gpr().into()))
            .collect::<Vec<_>>(),
    );
    for ([], v) in values {
        let mut add = |operation, kinds: &'static [Value], wanted: bool| {
            h.add(about(v, operation, move |kind| {
                kinds.contains(&kind) == wanted
            }));
        };
        add(op!(branch_if_number(v) => target), &[Int32, Double], true);
        add(
            op!(branch_if_not_number(v) => target),
            &[Int32, Double],
            false,
        );
        add(op!(branch_if_cell(v) => target), &[Cell, Empty], true);
        add(op!(branch_if_not_cell(v) => target), &[Cell, Empty], false);
        add(op!(branch_if_empty(v) => target), &[Empty], true);
        add(op!(branch_if_not_empty(v) => target), &[Empty], false);
        add(op!(branch_if_undefined(v) => target), &[Undefined], true);
        add(
            op!(branch_if_not_undefined(v) => target),
            &[Undefined],
            false,
        );
        add(op!(branch_if_null(v) => target), &[Null], true);
        add(op!(branch_if_not_null(v) => target), &[Null], false);
        if let RegOrMem::Reg(reg) = v {
            add(op!(branch_if_int32(reg) => target), &[Int32], true);
            add(op!(branch_if_not_int32(reg) => target), &[Int32], false);
        }
    }
}

#[test]
fn kinds_that_need_another_register() {
    use Value::*;
    let mut h = harness();
    for _ in 0..40 {
        for [value, temp] in h.gprs() {
            let mut add = |operation, kinds: &'static [Value], wanted: bool| {
                let holds = move |kind| kinds.contains(&kind) == wanted;
                let case = about(value.into(), operation, holds);
                h.add(case.clobbers(RegisterSet::of(&[temp], &[])));
            };
            add(
                op!(branch_if_boolean(value, temp) => target),
                &[Boolean],
                true,
            );
            let operation = op!(branch_if_null_or_undefined(value, temp) => target);
            add(operation, &[Null, Undefined], true);
            let operation = op!(branch_if_not_null_or_undefined(value, temp) => target);
            add(operation, &[Null, Undefined], false);

            let case = Case::new(
                op!(branch_if_not_boolean(value, temp) => target),
                move |m| {
                    let bits = m.get64(value);
                    if classify(bits) != Boolean {
                        m.forget(temp);
                        return true;
                    }
                    m.set64(temp, bits & 1);
                    false
                },
            );
            h.add(case.given(move |m, random| {
                m.set64(value, any_value(random));
                true
            }));
        }
    }
}

#[test]
fn boxing() {
    let mut h = harness();
    for _ in 0..40 {
        for [dst, src] in h.gprs() {
            let case = Case::new(op!(box_int32(dst, src)), move |m| {
                m.set64(dst, NUMBER_TAG + m.get64(src));
            });
            h.add(with_tags(case.reads(Size::S32, src)).given(move |m, _| {
                m.set64(src, m.get(Width::W32, src));
                true
            }));
            let case = Case::new(op!(box_boolean(dst, src)), move |m| {
                m.set64(dst, [0x06, 0x07][m.get64(src) as usize]);
            });
            h.add(case.given(move |m, random| {
                m.set64(src, random.next() & 1);
                true
            }));
            let fpr = h.any_fpr();
            let case = Case::new(op!(box_double(dst, fpr)), move |m| {
                m.set64(dst, m.vector(fpr) as u64 + DOUBLE_OFFSET);
            });
            h.add(with_tags(case).given(move |m, random| {
                m.set_vector(fpr, random.vector() << 64 | u128::from(any_double(random)));
                true
            }));
            let case = Case::new(op!(unbox_double(fpr, src, dst)), move |m| {
                m.set_float_bits(FloatWidth::F64, fpr, m.get64(src) - DOUBLE_OFFSET);
                m.forget(dst);
            });
            h.add(with_tags(case).given(move |m, random| {
                m.set64(src, any_double(random) + DOUBLE_OFFSET);
                true
            }));
        }
    }
}

#[test]
fn nan_and_tags() {
    let mut h = harness();
    for _ in 0..8 {
        let value = h.any_fpr();
        let case = Case::new(op!(canonicalize_nan(value)), move |m| {
            if m.float(FloatWidth::F64, value).is_nan() {
                m.set_float_bits(FloatWidth::F64, value, CANONICAL_NAN);
            }
        });
        h.add(
            case.reads_float(FloatWidth::F64, value)
                .with_all_boundaries(true),
        );
    }
    h.add(Case::new(op!(load_tags()), |m| {
        m.set64(abi::NUMBER_TAG, NUMBER_TAG);
        m.set64(abi::NOT_CELL_MASK, NOT_CELL_MASK);
    }));
}
