use std::num::NonZeroUsize;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, Features, Options, Target};
use bun_engine_exec_memory::{
    CodeHandle, Owner, Priority, link, lock_owners, owner_of_running_code, replace_with_jump,
    set_move_value, set_transfer_target, transfer_target,
};

const RESULT: Gpr = abi::RETURN_GPRS[0];

fn assembler(shorten_jumps: bool) -> MacroAssembler {
    MacroAssembler::new(Options {
        features: Features::host(),
        shorten_jumps,
        seed: 1,
    })
}

fn install(code: &Code) -> CodeHandle {
    link(code, Priority::Required, |_| unreachable!()).unwrap()
}

fn returning(value: i32) -> CodeHandle {
    let mut masm = assembler(false);
    masm.move32(RESULT, value);
    masm.ret();
    install(&masm.finish().unwrap())
}

fn run(code: &CodeHandle) -> u64 {
    // SAFETY: every function of these tests has this type.
    unsafe { std::mem::transmute::<usize, extern "C" fn() -> u64>(code.start())() }
}

extern "C" fn native() -> u64 {
    77
}

#[test]
fn calls_reach_native_functions_and_symbols() {
    let other = returning(5);
    let mut masm = assembler(false);
    masm.enter_frame();
    masm.push_pair(abi::SAVED_GPRS[0], abi::SAVED_GPRS[1]);
    masm.call_address(native as *const () as usize);
    masm.move64(abi::SAVED_GPRS[0], RESULT);
    let symbol = masm.external(Target::Symbol(9));
    masm.call(symbol);
    masm.add64(RESULT, RESULT, abi::SAVED_GPRS[0]);
    masm.pop_pair(abi::SAVED_GPRS[0], abi::SAVED_GPRS[1]);
    masm.leave_frame();
    masm.ret();
    let code = link(&masm.finish().unwrap(), Priority::Optional, |index| {
        assert_eq!(index, 9);
        other.start()
    });
    assert_eq!(run(&code.unwrap()), 82);
}

#[test]
fn live_code_changes() {
    for shorten_jumps in [false, true] {
        let (one, two) = (returning(1), returning(2));
        let mut masm = assembler(shorten_jumps);
        let skip = masm.new_label();
        masm.jump(skip);
        masm.bind(skip);
        let point = masm.replaceable_point();
        let next = masm.here();
        let value = masm.patchable_move64(RESULT, 0);
        let done = masm.new_label();
        masm.branch_if_not_zero64(RESULT, done);
        let first = masm.external_address(one.start());
        let jump = masm.patchable_jump(first);
        masm.bind(done);
        masm.ret();
        let code = masm.finish().unwrap();
        assert!(
            code.offset_of(next) as usize
                >= code.offset_of(point) as usize + bun_engine_asm::patch::REPLACEMENT_JUMP_SIZE
        );
        let handle = install(&code);
        let at = |label| handle.address(code.offset_of(label));
        assert_eq!(run(&handle), 1);
        // SAFETY: the labels are of the kinds these take, and only this thread runs the code.
        unsafe {
            assert_eq!(transfer_target(at(jump)), one.start());
            set_transfer_target(at(jump), two.start()).unwrap();
            assert_eq!(run(&handle), 2);
            set_transfer_target(at(jump), native as *const () as usize).unwrap();
            assert_eq!(transfer_target(at(jump)), native as *const () as usize);
            assert_eq!(run(&handle), 77);
            set_move_value(at(value), 0x1234_5678_9abc_def0);
            assert_eq!(run(&handle), 0x1234_5678_9abc_def0);
            replace_with_jump(at(point), one.start()).unwrap();
            assert_eq!(run(&handle), 1);
        }
    }
}

#[test]
fn an_address_leads_to_the_owner() {
    let mut masm = assembler(false);
    for _ in 0..5000 {
        masm.nop();
    }
    let code = install(&masm.finish().unwrap());
    let owner = Owner(NonZeroUsize::new(0x1230).unwrap());
    assert_eq!(lock_owners().owner_of(code.start()), None);
    code.set_owner(owner);
    let last = code.start() + code.len() - 1;
    for address in [code.start(), code.start() + 2500, last] {
        assert_eq!(lock_owners().owner_of(address), Some(owner));
        // SAFETY: the handle keeps the code.
        assert_eq!(unsafe { owner_of_running_code(address) }, Some(owner));
    }
    for address in [
        0,
        native as *const () as usize,
        code.start() - 1,
        last + 1,
        last + (100 << 20),
    ] {
        assert_eq!(lock_owners().owner_of(address), None);
    }
    drop(code);
    assert_eq!(lock_owners().owner_of(last), None);
}
