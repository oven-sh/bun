//! `cargo test --release -p bun_engine_asm --test emission_speed -- --ignored --nocapture --test-threads 1`

#![allow(clippy::disallowed_macros)]

mod support;
#[path = "machine/values.rs"]
mod values;

use std::hint::black_box;
use std::time::Instant;

use bun_engine_asm::{
    Address, Argument, Arm64Features, CallAssembly, Code, Cond, FloatAssembly, FloatCond, Fpr, Gpr,
    Label, Options, ResultCond, Scale, ValueAssembly, X64Features, arm64, x64,
};
use values::Random;

const OPERATIONS: usize = 400;
const FUNCTIONS: usize = 200;
const ROUNDS: usize = 200;

#[derive(Clone, Copy)]
struct Operation {
    kind: u8,
    slots: [i32; 3],
    gprs: [Gpr; 3],
    fprs: [Fpr; 3],
    constant: i64,
    target: usize,
}

fn function(random: &mut Random) -> Vec<Operation> {
    let operations = (0..OPERATIONS).map(|index| Operation {
        kind: random.below(8) as u8,
        slots: [(); 3].map(|()| -8 * (1 + (random.below(64) >> random.below(4)) as i32)),
        gprs: [(); 3].map(|()| Gpr::new(random.pick(&[0, 1, 2, 3, 6, 7, 8, 9, 10, 12]))),
        fprs: [(); 3].map(|()| Fpr::new(random.below(12) as u8)),
        constant: match random.below(4) {
            0 => 0x7f00_0000_0000 + (random.next() >> 24 & !7) as i64,
            1 => (random.next() >> 40) as i64,
            _ => random.below(200) as i64,
        },
        target: (index + random.below(24))
            .saturating_sub(8)
            .min(OPERATIONS - 1),
    });
    operations.collect()
}

/// Fixed registers, values in the frame, and slow paths after the rest.
#[inline(never)]
fn templates<M: FloatAssembly>(masm: &mut M, operations: &[Operation], labels: &[Label]) {
    let [a, b, c, vm] = [0, 2, 6, 13].map(Gpr::new);
    let slot = |offset| Address::new(M::FRAME_POINTER, offset);
    let mut slow_paths = Vec::with_capacity(operations.len());
    for (operation, &label) in operations.iter().zip(labels) {
        let [dst, lhs, rhs] = operation.slots.map(slot);
        let (slow, done) = (masm.new_label(), masm.new_label());
        masm.bind(label);
        match operation.kind {
            0 | 1 => {
                masm.load64(a, lhs);
                masm.load64(b, rhs);
                masm.branch_if_not_int32(a, slow);
                masm.branch_if_not_int32(b, slow);
                masm.branch_add32(ResultCond::Overflow, c, a, b, slow);
                masm.box_int32(a, c);
                masm.store64(dst, a);
            }
            2 => {
                masm.load64(a, lhs);
                masm.branch_if_not_cell(a, slow);
                masm.load64(b, Address::new(vm, -operation.slots[1] * 4));
                masm.load32(c, Address::new(b, 0));
                masm.branch32(Cond::Ne, Address::new(a, 0), c, slow);
                masm.load32_signed64(c, Address::new(b, 4));
                masm.load64(a, Address::indexed(a, c, Scale::Eight, 16));
                masm.store64(dst, a);
            }
            3 => {
                masm.load64(a, lhs);
                masm.branch_if_not_int32(a, slow);
                masm.branch32(
                    Cond::Lt,
                    a,
                    operation.constant as i32,
                    labels[operation.target],
                );
            }
            4 => {
                masm.load64(a, lhs);
                masm.store64(Address::new(M::STACK_POINTER, 8), a);
                masm.store32(Address::new(M::STACK_POINTER, 16), 2);
                masm.load64(b, Address::new(vm, 64));
                masm.branch64(Cond::Ne, Address::new(b, 8), a, slow);
                masm.call_indirect(Address::new(b, 16));
                masm.add64(M::STACK_POINTER, M::FRAME_POINTER, -640);
                masm.store64(dst, a);
            }
            5 => {
                masm.move64(a, operation.constant);
                masm.store64(dst, a);
                continue;
            }
            6 => {
                masm.transfer64(dst, lhs);
                continue;
            }
            _ => {
                masm.branch_add32_to_memory(ResultCond::NonNegative, Address::new(vm, 32), 1, slow);
                masm.jump(labels[operation.target]);
            }
        }
        masm.bind(done);
        slow_paths.push((slow, done, dst, lhs));
    }
    let failure = masm.here();
    masm.leave_frame();
    masm.ret();
    for (slow, done, dst, lhs) in slow_paths {
        masm.bind(slow);
        masm.move_arguments(&[vm.into(), Argument::Load64(lhs), a.into()]);
        masm.call_address(0x1000);
        masm.branch_if_empty(a, failure);
        masm.store64(dst, a);
        masm.jump(done);
    }
}

/// Registers that are chosen while compiling.
#[inline(never)]
fn allocated<M: FloatAssembly>(masm: &mut M, operations: &[Operation], labels: &[Label]) {
    let (memory, trap) = (Gpr::new(13), masm.new_label());
    for (operation, &label) in operations.iter().zip(labels) {
        let ([a, b, c], [x, y, z]) = (operation.gprs, operation.fprs);
        let (slot, constant) = (operation.slots[0], operation.constant);
        masm.bind(label);
        match operation.kind {
            0 => {
                masm.add32(a, b, c);
                masm.xor32(b, a, c);
                masm.shl32(c, a, constant as u8);
            }
            1 => {
                masm.add32(a, b, constant as i32);
                masm.and32(b, a, constant as i32);
                masm.mul32(c, a, b);
            }
            2 => {
                masm.load32(a, Address::indexed(memory, b, Scale::One, -slot));
                masm.store32(Address::indexed(memory, c, Scale::One, 0), a);
                masm.load8(b, Address::indexed(memory, c, Scale::One, 0));
            }
            3 => {
                masm.load64(a, Address::new(M::FRAME_POINTER, slot));
                masm.sub64(b, a, c);
                masm.store64(Address::new(M::FRAME_POINTER, slot), b);
            }
            4 => {
                masm.load_f64(x, Address::indexed(memory, a, Scale::One, 0));
                masm.mul_f64(y, x, z);
                masm.add_f64(z, y, x);
                masm.branch_f64(FloatCond::Lt, x, y, labels[operation.target]);
            }
            5 => {
                masm.move64(a, constant);
                masm.move32(b, c);
                masm.compare32(Cond::Below, c, a, b);
            }
            6 => {
                masm.branch32(Cond::AboveEq, a, b, trap);
                masm.select32(Cond::Eq, a, b, 0, c, a);
            }
            _ => {
                masm.branch_if_zero32(a, labels[operation.target]);
                masm.branch32(Cond::Ne, b, constant as i32, labels[operation.target]);
            }
        }
    }
    masm.ret();
    masm.bind(trap);
    masm.breakpoint();
}

fn measure<M: FloatAssembly>(
    name: &str,
    options: Options<M::Features>,
    llvm_arguments: &[&str],
    emit: fn(&mut M, &[Operation], &[Label]),
    bytes_for_each: usize,
) {
    let mut random = Random(1);
    let functions: Vec<_> = (0..FUNCTIONS).map(|_| function(&mut random)).collect();
    let compile = |operations: &[Operation]| -> Code {
        let mut masm = M::new(options);
        masm.reserve(operations.len() * bytes_for_each);
        let labels: Vec<Label> = operations.iter().map(|_| masm.new_label()).collect();
        emit(&mut masm, operations, &labels);
        masm.finish().unwrap()
    };
    let bytes: Vec<u8> = (functions.iter())
        .flat_map(|operations| compile(operations).bytes().to_vec())
        .collect();
    let instructions = support::disassemble(llvm_arguments, &bytes).unwrap().len();
    let seconds = (0..ROUNDS).map(|_| {
        let start = Instant::now();
        for operations in &functions {
            black_box(compile(black_box(operations)));
        }
        start.elapsed().as_secs_f64()
    });
    let best = seconds.fold(f64::INFINITY, f64::min);
    println!(
        "{name}: {:.2} ns for each of {instructions} instructions, {} bytes",
        best * 1e9 / instructions as f64,
        bytes.len()
    );
}

fn options<Features>(features: Features, shorten_jumps: bool) -> Options<Features> {
    Options {
        features,
        shorten_jumps,
        seed: 1,
    }
}

#[test]
#[ignore = "a measurement"]
fn x64() {
    for shorten_jumps in [false, true] {
        let (options, llvm) = (
            options(X64Features::all(), shorten_jumps),
            ["-triple=x86_64"],
        );
        println!("shorten_jumps: {shorten_jumps}");
        measure::<x64::MacroAssembler>("x64 templates", options, &llvm, templates, 64);
        measure::<x64::MacroAssembler>("x64 allocated", options, &llvm, allocated, 24);
    }
}

#[test]
#[ignore = "a measurement"]
fn arm64() {
    let options = options(Arm64Features::all(), false);
    measure::<arm64::MacroAssembler>("arm64 templates", options, &support::ARM64, templates, 64);
    measure::<arm64::MacroAssembler>("arm64 allocated", options, &support::ARM64, allocated, 24);
}
