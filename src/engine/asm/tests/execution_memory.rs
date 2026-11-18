mod machine;
mod support;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{AtomicOp, Memory, RegOrImm};
use machine::operands::{OFFSETS, SCALES, SP};
use machine::values::{mask, sign_extend};
use machine::{Case, FLOAT_WIDTHS, Harness, Machine, Operation, SIZES, WIDTHS, host, op};

const ALL_OFFSETS: usize = OFFSETS.len();

#[test]
fn loads() {
    let mut h = Harness::new();
    for size in SIZES {
        for ([dst], src) in h.memories(ALL_OFFSETS) {
            let case = Case::new(op!(load(size, dst, src)), move |m| {
                m.set64(dst, m.load(size, src));
            });
            h.add(case.reads(size, src).keeps_first_scratch());
        }
    }
}

#[test]
fn every_register_in_an_address() {
    let mut h = Harness::new();
    let registers = h.operand_registers;
    for base in registers.gprs().chain([SP]) {
        for index in registers.gprs().map(Some).chain([None]) {
            for offset in [0, 8, 300] {
                let address = match index {
                    Some(index) => Address::indexed(base, index, h.random.pick(&SCALES), offset),
                    None => Address::new(base, offset),
                };
                let (reg, size) = (h.any_gpr(), h.random.pick(&SIZES));
                let case = Case::new(op!(load(size, reg, address)), move |m| {
                    m.set64(reg, m.load(size, address));
                });
                h.add(case.accesses(address));
                let case = Case::new(op!(store(size, address, reg)), move |m| {
                    m.store(size, address, m.get64(reg));
                });
                h.add(case.accesses(address));
            }
            let (dst, rhs) = (h.any_gpr(), index.unwrap_or(SP));
            h.add(Case::new(op!(add64(dst, base, rhs)), move |m| {
                m.set64(dst, m.get64(base).wrapping_add(m.get64(rhs)));
            }));
        }
    }
}

#[test]
fn loads_that_extend_the_sign() {
    let mut h = Harness::new();
    for size in SIZES {
        for width in WIDTHS.into_iter().filter(|width| size <= width.size()) {
            for ([dst], src) in h.memories(ALL_OFFSETS / 2) {
                let case = Case::new(op!(load_signed(size, width, dst, src)), move |m| {
                    m.set(width, dst, sign_extend(size, m.load(size, src)) as u64);
                });
                h.add(case.reads(size, src).keeps_first_scratch());
            }
        }
    }
}

fn update(operation: fn(Size, Memory, RegOrImm) -> Operation, model: fn(u64, u64) -> u64) {
    let mut h = Harness::new();
    for size in SIZES {
        let mut operands = h.memories_and_operands::<0, 1>();
        let registers = h.memories(ALL_OFFSETS / 4).into_iter();
        operands.extend(registers.map(|([src], dst)| ([], dst, src.into())));
        for ([], dst, src) in operands {
            let case = Case::new(operation(size, dst, src), move |m| {
                let new = model(m.load(size, dst), m.read(Width::W64, src));
                m.store(size, dst, new);
            });
            h.add(case.reads(size, dst).reads(size, src));
        }
    }
}

#[test]
fn stores() {
    update(|size, dst, src| op!(store(size, dst, src)), |_, new| new);
}

#[test]
fn add_to_memory() {
    update(
        |size, dst, src| op!(add_to_memory(size, dst, src)),
        u64::wrapping_add,
    );
}

#[test]
fn and_to_memory() {
    update(
        |size, dst, src| op!(and_to_memory(size, dst, src)),
        |a, b| a & b,
    );
}

#[test]
fn or_to_memory() {
    update(
        |size, dst, src| op!(or_to_memory(size, dst, src)),
        |a, b| a | b,
    );
}

#[test]
fn the_first_scratch_register_as_an_operand() {
    let mut h = Harness::new();
    let scratch = Harness::default_scratch();
    let (scratch, float) = (scratch.gprs[0].unwrap(), scratch.fprs[0].unwrap());
    for ([reg], address) in h.addresses(&[scratch], ALL_OFFSETS) {
        let size = h.random.pick(&SIZES);
        let case = Case::new(op!(load(size, reg, address)), move |m| {
            m.set64(reg, m.load(size, address));
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(store(size, address, reg)), move |m| {
            m.store(size, address, m.get64(reg));
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(compute_address(reg, address)), move |m| {
            m.set64(reg, m.address(address) as u64);
        });
        h.add(case.keeps_first_scratch());
        let case = Case::new(op!(load_signed(size, Width::W64, reg, address)), move |m| {
            m.set64(reg, sign_extend(size, m.load(size, address)) as u64);
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(load_f64(float, address)), move |m| {
            m.set_vector(float, m.load(Size::S64, address).into());
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(store_f32(address, float)), move |m| {
            m.store(Size::S32, address, m.vector(float) as u64);
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(load_vector(float, address)), move |m| {
            m.set_vector(float, m.load_vector(address));
        });
        h.add(case.accesses(address).keeps_first_scratch());
        let case = Case::new(op!(store_vector(address, float)), move |m| {
            m.store_vector(address, m.vector(float));
        });
        h.add(case.accesses(address).keeps_first_scratch());
    }
    for ([low, high], address) in h.addresses(&[scratch], 4) {
        let case = Case::new(op!(store_pair64(address, low, high)), move |m| {
            m.store(Size::S64, address, m.get64(low));
            m.store(Size::S64, address.plus(8), m.get64(high));
        });
        h.add(case.accesses(address).keeps_first_scratch());
        if low != high {
            let case = Case::new(op!(load_pair64(low, high, address)), move |m| {
                let both = [address, address.plus(8)].map(|src| m.load(Size::S64, src));
                m.set64(low, both[0]);
                m.set64(high, both[1]);
            });
            h.add(case.accesses(address).keeps_first_scratch());
        }
    }
}

#[test]
fn integers_are_loaded_from_an_absolute_address_without_scratch_registers() {
    let mut h = Harness::new();
    for src in h.absolute_addresses() {
        for size in SIZES {
            let dst = h.any_gpr();
            let operation = op!(load(size, dst, src)).wrapped(dst, |masm, _, emit| {
                masm.set_scratch(bun_engine_asm::Scratch {
                    gprs: [None; 2],
                    fprs: [None; 2],
                });
                emit(masm);
            });
            let case = Case::new(operation, move |m| m.set64(dst, m.load(size, src)));
            h.add(case.accesses(src));
        }
    }
}

#[cfg(target_os = "linux")]
#[test]
fn absolute_addresses_are_of_all_lengths() {
    let addresses = Harness::new().absolute_addresses();
    for range in [0..1 << 31, 1 << 31..1 << 32, 1 << 32..usize::MAX] {
        assert!(addresses.iter().any(|address| range.contains(&address.0)));
    }
}

#[test]
fn pairs() {
    let mut h = Harness::new();
    for width in WIDTHS {
        let (size, next) = (width.size(), i32::from(width.size().bytes()));
        for ([low, high], address) in h.addresses(&[], ALL_OFFSETS / 3) {
            let case = Case::new(op!(store_pair(width, address, low, high)), move |m| {
                m.store(size, address, m.get64(low));
                m.store(size, address.plus(next), m.get64(high));
            });
            h.add(case.accesses(address));
            if low != high {
                let case = Case::new(op!(load_pair(width, low, high, address)), move |m| {
                    let both = [address, address.plus(next)].map(|src| m.load(size, src));
                    m.set64(low, both[0]);
                    m.set64(high, both[1]);
                });
                h.add(case.accesses(address).keeps_first_scratch());
            }
        }
    }
}

#[test]
fn transfer() {
    let mut h = Harness::new();
    for size in SIZES {
        for ([base, index], src) in h.addresses(&[], 3) {
            let (scale, offset) = (h.random.pick(&SCALES), h.random.pick(&OFFSETS));
            let near = src.plus(h.random.pick(&[0, 1, 4, 8]));
            let mut destinations = vec![near];
            if !src.uses(base) {
                destinations.push(Address::new(base, offset));
            }
            if base != index && !(src.uses(base) && src.uses(index)) {
                destinations.push(Address::indexed(base, index, scale, offset));
            }
            for dst in destinations {
                let case = Case::new(op!(transfer(size, dst, src)), move |m| {
                    m.store(size, dst, m.load(size, src));
                });
                h.add(case.accesses(src).accesses(dst));
            }
        }
    }
}

#[test]
fn floats_and_vectors() {
    let mut h = Harness::new();
    for ([], memory) in h.memories(ALL_OFFSETS) {
        let reg = h.any_fpr();
        let mut add_load = |case: Case| match memory {
            Memory::Address(_) => h.add(case.accesses(memory).keeps_first_scratch()),
            Memory::Absolute(_) => h.add(case.accesses(memory)),
        };
        add_load(Case::new(op!(load_vector(reg, memory)), move |m| {
            m.set_vector(reg, m.load_vector(memory));
        }));
        for width in FLOAT_WIDTHS {
            add_load(Case::new(op!(load_float(width, reg, memory)), move |m| {
                m.set_vector(reg, m.load(width.width().size(), memory).into());
            }));
        }
        let case = Case::new(op!(store_vector(memory, reg)), move |m| {
            m.store_vector(memory, m.vector(reg));
        });
        h.add(case.accesses(memory));
        for width in FLOAT_WIDTHS {
            let case = Case::new(op!(store_float(width, memory, reg)), move |m| {
                m.store(width.width().size(), memory, m.vector(reg) as u64);
            });
            h.add(case.accesses(memory));
        }
    }
}

#[test]
fn what_changes_nothing() {
    let mut h = Harness::new();
    for ([], address) in h.addresses(&[], ALL_OFFSETS) {
        h.add(Case::new(op!(prefetch(address)), |_| {}).accesses(address));
    }
    h.add(Case::new(op!(memory_fence()), |_| {}));
    h.add(Case::new(op!(store_fence()), |_| {}));
    h.add(Case::new(op!(load_fence()), |_| {}));
    h.add(Case::new(op!(nop()), |_| {}));
}

fn aligned(size: Size, address: Address) -> Address {
    address.plus(-(address.offset() & (i32::from(size.bytes()) - 1)))
}

#[test]
fn atomic_loads_and_stores() {
    let mut h = Harness::new();
    for size in SIZES {
        for ([reg], address) in h.addresses(&[], ALL_OFFSETS / 3) {
            let address = aligned(size, address);
            let case = Case::new(op!(atomic_load(size, reg, address)), move |m| {
                m.set64(reg, m.load(size, address));
            });
            h.add(case.accesses(address).aligned(size));
            let case = Case::new(op!(atomic_store(size, address, reg)), move |m| {
                m.store(size, address, m.get64(reg));
            });
            h.add(case.accesses(address).aligned(size));
        }
    }
}

fn avoids_clobbers(address: Address, others: &[Gpr]) -> bool {
    let mut clobbers = MacroAssembler::ATOMIC_CLOBBERS.gprs();
    clobbers.all(|reg| !address.uses(reg) && !others.contains(&reg))
}

#[test]
fn atomic_updates() {
    let mut h = Harness::new();
    let operations: [(AtomicOp, fn(u64, u64) -> u64); 6] = [
        (AtomicOp::Add, u64::wrapping_add),
        (AtomicOp::Sub, u64::wrapping_sub),
        (AtomicOp::And, |a, b| a & b),
        (AtomicOp::Or, |a, b| a | b),
        (AtomicOp::Xor, |a, b| a ^ b),
        (AtomicOp::Exchange, |_, b| b),
    ];
    for size in SIZES {
        for (which, model) in operations {
            for ([dst, operand, temp], address) in h.addresses(host::ATOMIC_REGISTERS, 4) {
                let differ = dst != operand && dst != temp && temp != operand;
                if !differ
                    || address.uses(dst)
                    || address.uses(temp)
                    || !avoids_clobbers(address, &[operand, temp])
                {
                    continue;
                }
                let address = aligned(size, address);
                let operation = op!(atomic_update(which, size, dst, address, operand, temp));
                let case = Case::new(operation, move |m| {
                    let old = m.load(size, address);
                    m.store(size, address, model(old, m.get64(operand)));
                    m.set64(dst, old);
                    m.forget(temp);
                });
                let case = case.reads(size, address).reads(size, operand).aligned(size);
                h.add(case.clobbers(MacroAssembler::ATOMIC_CLOBBERS));
            }
        }
    }
}

#[test]
fn atomic_compare_exchange() {
    let mut h = Harness::new();
    for size in SIZES {
        for ([dst, expected, new, temp], address) in h.addresses(host::ATOMIC_REGISTERS, 4) {
            if [dst, expected, new].contains(&temp)
                || address.uses(temp)
                || dst != expected && (dst == new || address.uses(dst))
                || !avoids_clobbers(address, &[new, temp])
            {
                continue;
            }
            let address = aligned(size, address);
            let operation = op!(atomic_compare_exchange(
                size, dst, address, expected, new, temp
            ));
            let case = Case::new(operation, move |m| {
                let old = m.load(size, address);
                if old == m.get64(expected) & mask(size) {
                    m.store(size, address, m.get64(new));
                }
                m.set64(dst, old);
                m.forget(temp);
            });
            let case = case
                .reads(size, expected)
                .reads(size, new)
                .accesses(address);
            let case = case.given(move |m, random| {
                let flipped = random.pick(&[0, 0, 1, 0x80, 1 << (size.bits() - 1)]);
                m.store(size, address, m.get64(expected) ^ flipped);
                true
            });
            h.add(case.aligned(size).clobbers(MacroAssembler::ATOMIC_CLOBBERS));
        }
    }
}

/// `first` moves the stack pointer by `distance`, and a constant moves it back.
fn moving_by(distance: i32, operation: Operation, model: impl Fn(&mut Machine) + 'static) -> Case {
    let operation = operation.wrapped(SP, move |masm, _, emit| {
        emit(masm);
        masm.sub64(SP, SP, distance);
    });
    Case::new(operation, model)
}

#[test]
fn pushes_and_pops() {
    let mut h = Harness::new();
    let step = MacroAssembler::PUSH_SIZE;
    for _ in 0..40 {
        for [low, high] in h.gprs() {
            h.add(moving_by(-step, op!(push(low)), move |m| {
                m.store(Size::S64, Address::new(SP, -step), m.get64(low));
            }));
            h.add(moving_by(step, op!(pop(low)), move |m| {
                m.set64(low, m.load(Size::S64, Address::new(SP, 0)));
            }));
            h.add(moving_by(-16, op!(push_pair(low, high)), move |m| {
                m.store(Size::S64, Address::new(SP, -16), m.get64(low));
                m.store(Size::S64, Address::new(SP, -8), m.get64(high));
            }));
            if low != high {
                h.add(moving_by(16, op!(pop_pair(low, high)), move |m| {
                    m.set64(low, m.load(Size::S64, Address::new(SP, 0)));
                    m.set64(high, m.load(Size::S64, Address::new(SP, 8)));
                }));
            }
        }
    }
}
