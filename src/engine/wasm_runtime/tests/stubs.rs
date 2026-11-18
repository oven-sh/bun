//! Code that is written by hand takes the place of optimized code.

#![allow(clippy::disallowed_types)]

mod support;

use std::sync::atomic::{AtomicU32, Ordering};

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Options as AssemblerOptions, Reg};
use bun_engine_wasm_compiler::abi::{
    INSTANCE, LOW_GUARD_SIZE, MEMORY_BASE, SLOT, Stubs, Trap, callee_word, frame,
};
use bun_engine_wasm_compiler::{CallSite, CompiledFunction, Environment, InlineFrame};
use bun_engine_wasm_format::{CodeIndex, FuncIndex, MemoryIndex};
use bun_engine_wasm_runtime::{Optimizer, Options, Tiering};
use support::machine::{Failure, Machine, spoil_registers};
use support::{engine, options, with_machine};

const FRAME_SIZE: u32 = 16;

fn function(
    env: &Environment<'_>,
    code: CodeIndex,
    body: impl FnOnce(&mut MacroAssembler) -> Vec<Label>,
) -> (CompiledFunction, Vec<u32>) {
    let mut masm = MacroAssembler::new(AssemblerOptions {
        features: env.features,
        shorten_jumps: false,
        seed: 0,
    });
    let callee = callee_word(env.module.func_index(code));
    masm.enter_frame();
    masm.store64(Address::new(abi::FRAME_POINTER, frame::INSTANCE), INSTANCE);
    masm.store64(Address::new(abi::FRAME_POINTER, frame::CALLEE), callee);
    masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, FRAME_SIZE);
    let labels = body(&mut masm);
    masm.leave_frame();
    masm.ret();
    let code = masm.finish().unwrap();
    let offsets = labels.into_iter().map(|it| code.offset_of(it)).collect();
    let compiled = CompiledFunction {
        code,
        entry_offset: 0,
        frame_size: FRAME_SIZE,
        call_sites: Vec::new(),
        clauses: Vec::new(),
        inline_frames: Vec::new(),
        inline_ranges: Vec::new(),
        direct_calls: Vec::new(),
    };
    (compiled, offsets)
}

/// Replaces the code of a function at its first call, for the second.
fn with_optimizer(optimizer: Optimizer, test: impl FnOnce(&Machine) + Send) {
    let options = Options {
        tiering: Tiering::After(1),
        use_threads: false,
        optimizer,
        ..options()
    };
    with_machine(engine(options), test);
}

fn free_registers() -> RegisterSet {
    let frame = RegisterSet::of(&[abi::FRAME_POINTER, abi::STACK_POINTER], &[]);
    let pinned = RegisterSet::of(&[INSTANCE, MEMORY_BASE], &[]);
    #[cfg(target_arch = "aarch64")]
    let pinned = pinned | {
        use bun_engine_asm::arm64::{LR, X16};
        RegisterSet::of(&[LR, X16], &[])
    };
    abi::ALL - frame - pinned
}

fn place_of(reg: Reg, base: i32) -> Address {
    Address::new(MEMORY_BASE, base + reg.index() as i32 * 16)
}

const AFTER: i32 = 1024;

#[test]
fn registers_are_kept() {
    static LOOP_ENTRIES: AtomicU32 = AtomicU32::new(0);
    let optimizer: Optimizer = |_, env, code, loop_entry, _| {
        spoil_registers();
        if loop_entry.is_some() {
            LOOP_ENTRIES.fetch_add(1, Ordering::Relaxed);
            return None;
        }
        let Stubs {
            write_barrier,
            tier_up_at_entry,
            tier_up_in_loop,
            ..
        } = *env.stubs;
        let stub = [write_barrier, tier_up_at_entry, tier_up_in_loop][code.usize()];
        let each_alone = || {
            free_registers()
                .into_iter()
                .map(|it| (it, RegisterSet::EMPTY.with(it)))
        };
        let (compiled, _) = function(env, code, |masm| {
            for (reg, set) in each_alone() {
                masm.load_registers(set, 16, place_of(reg, 0));
            }
            masm.call_address(stub);
            for (reg, set) in each_alone() {
                masm.store_registers(set, 16, place_of(reg, AFTER));
            }
            Vec::new()
        });
        Some(compiled)
    };
    with_optimizer(optimizer, |machine| {
        let instance = machine.load(
            r#"(memory 1) (func (export "0")) (func (export "1"))
            (func (export "2") (param i32) (if (local.get 0) (then (loop))))"#,
            &[],
        );
        let memory = instance.memory(MemoryIndex(0));
        let cases = [
            ("0", &[][..], instance.cell().address()),
            ("1", &[], 77),
            ("2", &[0], 0),
        ];
        for (name, arguments, slot) in cases {
            let mut before = [0; AFTER as usize];
            for reg in free_registers() {
                let size = if reg.index() < 32 { 8 } else { 16 };
                before[reg.index() * 16..][..size].fill(reg.index() as u8 + 1);
            }
            before[Reg::from(SLOT).index() * 16..][..8].copy_from_slice(&slot.to_le_bytes());
            memory.write(0, &before).unwrap();
            machine.invoke(instance, name, arguments).unwrap();
            machine.invoke(instance, name, arguments).unwrap();
            let mut after = [0; AFTER as usize];
            memory.read(AFTER as u64, &mut after).unwrap();
            assert_eq!(before, after, "{name}");
        }
        assert_eq!(LOOP_ENTRIES.load(Ordering::Relaxed), 1);
    });
}

#[test]
fn inlined_functions_are_in_the_trace() {
    const NONE: u32 = u32::MAX;
    let optimizer: Optimizer = |_, env, code, _, _| {
        let (mut compiled, offsets) = function(env, code, |masm| {
            let [first, second, third, fourth] = [(); 4].map(|()| masm.new_label());
            let choice = abi::ARGUMENT_GPRS[0];
            let below = Address::new(MEMORY_BASE, -(LOW_GUARD_SIZE as i32));
            masm.branch32(Cond::Eq, choice, 1, first);
            masm.branch32(Cond::Eq, choice, 2, second);
            masm.branch32(Cond::Eq, choice, 3, third);
            masm.branch32(Cond::Eq, choice, 4, fourth);
            masm.load8(choice, Address::new(MEMORY_BASE, -1));
            masm.bind(fourth);
            masm.call_address(env.stubs.traps[Trap::Unreachable as usize]);
            masm.bind(first);
            masm.load8(choice, Address::new(MEMORY_BASE, -1));
            masm.bind(second);
            masm.load8(choice, below);
            masm.bind(third);
            masm.call_address(env.stubs.traps[Trap::CastFailure as usize]);
            vec![first, second, third, masm.mark()]
        });
        let frame = |func, caller| InlineFrame {
            func: FuncIndex(func),
            caller,
        };
        compiled.inline_frames = vec![
            frame(5, NONE),
            frame(6, 0),
            frame(7, InlineFrame::NO_CALLER),
        ];
        compiled.inline_ranges = vec![(offsets[0], 1), (offsets[1], 2), (offsets[2], NONE)];
        compiled.call_sites = vec![CallSite {
            return_offset: offsets[3],
            first_clause: NONE,
            handler_offset: 0,
            inline_frame: 0,
        }];
        Some(compiled)
    };
    with_optimizer(optimizer, |machine| {
        let instance = machine.load(r#"(memory 1) (func (export "f") (param i32))"#, &[]);
        machine.invoke(instance, "f", &[0]).unwrap();
        let cases = [
            (Trap::MemoryOutOfBounds, &[0][..]),
            (Trap::MemoryOutOfBounds, &[6, 5, 0]),
            (Trap::MemoryOutOfBounds, &[7]),
            (Trap::CastFailure, &[5, 0]),
            (Trap::Unreachable, &[0]),
        ];
        for (choice, (trap, trace)) in (0..).zip(cases) {
            assert_eq!(
                machine.invoke(instance, "f", &[choice]),
                Err(Failure::Trap(trap))
            );
            assert_eq!(*machine.stack_trace.borrow(), trace);
        }
    });
}

#[test]
fn every_trap_arrives_wherever_the_stack_pointer_is() {
    let optimizer: Optimizer = |_, env, code, _, _| {
        let (compiled, _) = function(env, code, |masm| {
            masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, 4096 * code.0);
            masm.call_address(env.stubs.traps[code.usize()]);
            Vec::new()
        });
        Some(compiled)
    };
    with_optimizer(optimizer, |machine| {
        let functions = (0..Trap::COUNT).map(|n| format!(r#"(func (export "{n}"))"#));
        let instance = machine.load(&functions.collect::<Vec<_>>().concat(), &[]);
        for (n, &trap) in Trap::ALL.iter().enumerate() {
            machine.invoke(instance, &n.to_string(), &[]).unwrap();
            assert_eq!(
                machine.invoke(instance, &n.to_string(), &[]),
                Err(Failure::Trap(trap))
            );
        }
    });
}
