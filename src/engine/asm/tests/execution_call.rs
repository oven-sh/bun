mod machine;
mod support;

use bun_engine_asm::prelude::*;
use machine::operands::{OFFSETS, SP};
use machine::{Case, Harness, Machine, Operation, op};

fn value_of(m: &Machine, argument: Argument) -> u64 {
    match argument {
        Argument::Gpr(reg) => m.get64(reg),
        Argument::Fpr(reg) => m.vector(reg) as u64,
        Argument::Imm(value) => value as u64,
        Argument::Load32(src) => m.load(Size::S32, src),
        Argument::Load64(src) | Argument::LoadF64(src) => m.load(Size::S64, src),
        Argument::AddressOf(address) => m.address(address) as u64,
    }
}

/// Mostly from the registers that carry arguments. The loads share two addresses.
fn any_arguments(h: &mut Harness) -> (Vec<Argument>, [Address; 2]) {
    let gpr = |h: &mut Harness| {
        let other = h.any_gpr();
        let argument = h.random.pick(&abi::ARGUMENT_GPRS);
        h.random.pick(&[argument, argument, argument, other])
    };
    let (base, offset) = (gpr(h), h.random.pick(&OFFSETS[..OFFSETS.len() - 1]));
    let addresses = [Address::new(base, offset), Address::new(SP, 0x208)];
    let kinds = 1 + h.random.below(7);
    let arguments = (0..h.random.below(20)).map(|_| {
        let address = h
            .random
            .pick(&addresses)
            .plus(-8 * h.random.below(3) as i32);
        match h.random.below(kinds) {
            0 => Argument::Gpr(gpr(h)),
            1 => {
                let other = h.any_fpr();
                let argument = h.random.pick(&abi::ARGUMENT_FPRS);
                Argument::Fpr(h.random.pick(&[argument, argument, argument, other]))
            }
            2 => Argument::Load64(address),
            3 => Argument::AddressOf(Address::new(gpr(h), h.random.pick(&OFFSETS))),
            4 => Argument::Load32(address),
            5 => Argument::LoadF64(address),
            _ => Argument::Imm(h.random.pick(&machine::operands::CONSTANTS)),
        }
    });
    (arguments.collect(), addresses)
}

fn moving(arguments: Vec<Argument>) -> Case {
    let emitted = arguments.clone();
    let name = format!("move_arguments({arguments:x?})");
    let operation = Operation::custom(name, move |masm, _| masm.move_arguments(&emitted));
    let mut names = RegisterSet::of(&abi::ARGUMENT_GPRS, &abi::ARGUMENT_FPRS);
    for &argument in &arguments {
        match argument {
            Argument::Gpr(reg) => names.insert(reg),
            Argument::Fpr(reg) => names.insert(reg),
            Argument::Imm(_) => {}
            Argument::Load32(address)
            | Argument::Load64(address)
            | Argument::LoadF64(address)
            | Argument::AddressOf(address) => names.insert(address.base()),
        }
    }
    Case::new(operation.naming(names), move |m| {
        let values: Vec<u64> = arguments.iter().map(|&each| value_of(m, each)).collect();
        let (mut gprs, mut fprs) = (abi::ARGUMENT_GPRS.iter(), abi::ARGUMENT_FPRS.iter());
        let mut on_stack = 0;
        for (argument, value) in arguments.iter().zip(values) {
            if matches!(argument, Argument::Fpr(_) | Argument::LoadF64(_)) {
                if let Some(&dst) = fprs.next() {
                    m.set_float_bits(FloatWidth::F64, dst, value);
                    continue;
                }
            } else if let Some(&dst) = gprs.next() {
                m.set64(dst, value);
                continue;
            }
            m.store(Size::S64, Address::new(SP, on_stack), value);
            on_stack += 8;
        }
        assert_eq!(
            MacroAssembler::stack_size_of_arguments(&arguments),
            on_stack as u32
        );
    })
}

#[test]
fn arguments_are_moved_as_if_at_once() {
    let mut h = Harness::new();
    for _ in 0..machine::scaled_runs(1500) {
        let (arguments, [first, second]) = any_arguments(&mut h);
        h.add(moving(arguments).accesses(first).accesses(second));
    }
}

#[test]
fn every_choice_among_four_argument_registers() {
    let mut h = Harness::new();
    for choice in 0..256 {
        let sources = [0, 2, 4, 6].map(|shift| choice >> shift & 3);
        h.add(moving(sources.map(|n| abi::ARGUMENT_GPRS[n].into()).into()));
        h.add(moving(sources.map(|n| abi::ARGUMENT_FPRS[n].into()).into()));
        let address = |n: usize| Address::new(abi::ARGUMENT_GPRS[n], 0x1234_5678);
        h.add(moving(
            sources.map(|n| Argument::AddressOf(address(n))).into(),
        ));
    }
}

#[test]
fn constants_become_arguments() {
    let mut h = Harness::new();
    let arguments = vec![(-1i32).into(), u32::MAX.into(), usize::MAX.into()];
    let [first, second, third] = *abi::ARGUMENT_GPRS.first_chunk().unwrap();
    let operation = Operation::custom("move_arguments".into(), move |masm, _| {
        masm.move_arguments(&arguments)
    });
    h.add(Case::new(operation, move |m| {
        m.set64(first, u64::MAX);
        m.set64(second, u32::MAX.into());
        m.set64(third, u64::MAX);
    }));
}

macro_rules! weigh {
    ($abi:literal) => {
        extern $abi fn weigh(
            a: u64, b: f64, c: u64, d: u64, e: u64, f: u64, g: u64, h: u64, i: u64, j: u64, k: u64,
            l: f64, m: f64, n: f64, o: f64, p: f64, q: f64, r: f64, s: f64, t: u64, u: f64,
        ) -> u64 {
            let floats = [b, l, m, n, o, p, q, r, s, u].map(f64::to_bits);
            let all = [a, c, d, e, f, g, h, i, j, k, t].into_iter().chain(floats);
            all.fold(0, |sum, value| sum.wrapping_mul(31).wrapping_add(value))
        }
    };
}

#[cfg(target_arch = "aarch64")]
weigh!("C");
#[cfg(target_arch = "x86_64")]
weigh!("sysv64");

#[test]
fn a_function_finds_its_arguments() {
    const FLOATS: [usize; 10] = [1, 11, 12, 13, 14, 15, 16, 17, 18, 20];
    let mut h = Harness::new();
    h.operand_registers.remove(abi::FRAME_POINTER);
    for _ in 0..100 {
        let arguments: Vec<Argument> = (0..21)
            .map(|index| match FLOATS.contains(&index) {
                true => h.any_fpr().into(),
                false => h.any_gpr().into(),
            })
            .collect();
        let emitted = arguments.clone();
        let operation = Operation::custom("call".into(), move |masm, _| {
            let size = MacroAssembler::stack_size_of_arguments(&emitted);
            masm.enter_frame();
            masm.sub64(SP, SP, size.next_multiple_of(16));
            masm.move_arguments(&emitted);
            masm.call_address(weigh as *const () as usize);
            masm.leave_frame();
        });
        let case = Case::new(operation, move |m| {
            let (floats, integers): (Vec<_>, Vec<_>) =
                (arguments.iter()).partition(|argument| matches!(argument, Argument::Fpr(_)));
            let all = integers.into_iter().chain(floats);
            let sum = all.fold(0u64, |sum, &argument| {
                sum.wrapping_mul(31).wrapping_add(value_of(m, argument))
            });
            m.set64(abi::RETURN_GPRS[0], sum);
            for reg in abi::CALLEE_SAVED_LOW_HALF.fprs() {
                m.set_float_bits(FloatWidth::F64, reg, m.vector(reg) as u64);
            }
        });
        h.add(case.clobbers(abi::CALLER_SAVED).overwrites_free_stack());
    }
}

#[test]
fn sets_of_registers_are_stored_and_loaded() {
    let mut h = Harness::new();
    for ([], address) in h.addresses(&[], OFFSETS.len()) {
        if address.offset() > i32::MAX - 128 {
            continue;
        }
        let vector_bytes = h.random.pick(&[8, 16]);
        let mut registers = RegisterSet::EMPTY;
        for _ in 0..h.random.below(4) {
            registers.insert(h.any_gpr());
        }
        for _ in 0..h.random.below(4) {
            registers.insert(h.any_fpr());
        }
        let first_float = address.plus(8 * registers.gprs().count() as i32);
        let operation = op!(store_registers(registers, vector_bytes, address));
        let case = Case::new(operation, move |m| {
            for (index, reg) in (0..).zip(registers.gprs()) {
                m.store(Size::S64, address.plus(8 * index), m.get64(reg));
            }
            for (index, reg) in (0..).zip(registers.fprs()) {
                let dst = first_float.plus(vector_bytes * index);
                match vector_bytes {
                    8 => m.store(Size::S64, dst, m.vector(reg) as u64),
                    _ => m.store_vector(dst, m.vector(reg)),
                }
            }
        });
        h.add(case.accesses(address));
        if registers.gprs().any(|reg| address.uses(reg)) {
            continue;
        }
        let operation = op!(load_registers(registers, vector_bytes, address));
        let case = Case::new(operation, move |m| {
            for (index, reg) in (0..).zip(registers.gprs()) {
                m.set64(reg, m.load(Size::S64, address.plus(8 * index)));
            }
            for (index, reg) in (0..).zip(registers.fprs()) {
                let src = first_float.plus(vector_bytes * index);
                match vector_bytes {
                    8 => m.set_float_bits(FloatWidth::F64, reg, m.load(Size::S64, src)),
                    _ => m.set_vector(reg, m.load_vector(src)),
                }
            }
        });
        h.add(case.accesses(address));
    }
}

#[test]
fn all_registers_survive_a_round_trip() {
    let mut h = Harness::new();
    let all = h.operand_registers;
    for vector_bytes in [8, 16] {
        let operation =
            Operation::custom(format!("round trip with {vector_bytes}"), move |masm, _| {
                masm.store_registers(all, vector_bytes, Address::new(SP, 0x400));
                all.gprs().for_each(|reg| masm.move64(reg, 0));
                all.fprs().for_each(|reg| masm.move_f64_constant(reg, 0.0));
                masm.load_registers(all, vector_bytes, Address::new(SP, 0x400));
            });
        h.add(Case::new(operation, move |m| {
            for reg in all.fprs().filter(|_| vector_bytes == 8) {
                m.set_float_bits(FloatWidth::F64, reg, m.vector(reg) as u64);
            }
        }));
    }
}
