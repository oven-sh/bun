mod machine;
mod support;

use std::sync::Barrier;
use std::sync::atomic::{AtomicU64, Ordering};

use bun_engine_asm::prelude::*;
use bun_engine_asm::{AtomicOp, Features};
use machine::operands::SP;
use machine::{Harness, Registers, SIZES, host, install};

const THREADS: u64 = 4;
const ROUNDS: u64 = 20_001;

/// Each thread runs `step` many times. It gets the address, a register with a bit of the thread's own, and three others.
fn shared_value_after(
    size: Size,
    step: impl Fn(&mut MacroAssembler, Address, Gpr, [Gpr; 3]),
) -> Vec<u64> {
    let [_, base, bit, rounds, a, b, c] = *abi::TEMPORARY_GPRS.first_chunk().unwrap();
    let results = [Features::empty(), Features::host()].map(|features| {
        let mut masm = Harness::assembler(features, true, 0);
        masm.move32(rounds, ROUNDS);
        let again = masm.here();
        step(&mut masm, Address::new(base, 0), bit, [a, b, c]);
        masm.branch_sub32(ResultCond::NonZero, rounds, rounds, 1, again);
        host::exit(masm.assembler());
        let code = install(&masm.finish().unwrap());
        let (shared, start) = (AtomicU64::new(0), Barrier::new(THREADS as usize));
        std::thread::scope(|scope| {
            for thread in 0..THREADS {
                let (code, start) = (&code, &start);
                let address = shared.as_ptr().expose_provenance();
                scope.spawn(move || {
                    let mut h = Harness::new();
                    let mut registers = Registers {
                        fprs: [0; 32],
                        gprs: [0; 32],
                        host_stack: 0,
                    };
                    let mut set = |reg: Gpr, value| registers.gprs[reg.number() as usize] = value;
                    set(SP, h.stack_pointer() as u64);
                    set(base, address as u64);
                    set(bit, 1 << thread);
                    bun_engine_exec_memory::synchronize_instructions();
                    start.wait();
                    h.execute(code.start(), &mut registers);
                });
            }
        });
        shared.load(Ordering::SeqCst) & machine::values::mask(size)
    });
    results.into()
}

fn assert_all(results: &[u64], size: Size, expected: u64) {
    let expected = expected & machine::values::mask(size);
    assert!(
        results.iter().all(|&result| result == expected),
        "{results:?}"
    );
}

#[test]
fn no_update_is_lost() {
    let total = ROUNDS * ((1 << THREADS) - 1);
    for size in SIZES {
        let updates = |first, second: Option<AtomicOp>| {
            shared_value_after(size, |masm, address, bit, [old, temp, _]| {
                for op in [Some(first), second].into_iter().flatten() {
                    masm.atomic_update(op, size, old, address, bit, temp);
                }
            })
        };
        assert_all(&updates(AtomicOp::Add, None), size, total);
        assert_all(&updates(AtomicOp::Sub, None), size, total.wrapping_neg());
        assert_all(&updates(AtomicOp::Or, Some(AtomicOp::Xor)), size, 0);
        let set_and_cleared =
            shared_value_after(size, |masm, address, bit, [old, temp, others]| {
                masm.atomic_update(AtomicOp::Xor, size, old, address, bit, temp);
                masm.not64(others, bit);
                masm.atomic_update(AtomicOp::And, size, old, address, others, temp);
            });
        assert_all(&set_and_cleared, size, 0);
    }
}

#[test]
fn what_is_exchanged_is_not_lost() {
    for size in SIZES {
        let total = shared_value_after(size, |masm, address, bit, [old, temp, zero]| {
            masm.move32(zero, 0);
            masm.atomic_update(AtomicOp::Exchange, size, old, address, zero, temp);
            masm.add64(zero, old, bit);
            masm.atomic_update(AtomicOp::Add, size, old, address, zero, temp);
        });
        assert_all(&total, size, ROUNDS * ((1 << THREADS) - 1));
    }
}

#[test]
fn one_thread_at_a_time_replaces_what_it_expects() {
    for size in SIZES {
        let total = shared_value_after(size, |masm, address, bit, [expected, new, temp]| {
            let old = abi::RETURN_GPRS[0];
            let again = masm.here();
            masm.atomic_load(size, expected, address);
            masm.add64(new, expected, bit);
            masm.atomic_compare_exchange(size, old, address, expected, new, temp);
            masm.branch64(Cond::Ne, old, expected, again);
        });
        assert_all(&total, size, ROUNDS * ((1 << THREADS) - 1));
    }
}
