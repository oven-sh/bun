#![cfg(target_arch = "aarch64")]

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, Features, Options, patch};
use bun_engine_exec_memory::{
    CodeHandle, Priority, link, replace_with_jump, set_transfer_target, transfer_target,
};

const RESULT: Gpr = abi::RETURN_GPRS[0];

fn assembled(emit: impl FnOnce(&mut MacroAssembler)) -> Code {
    let mut masm = MacroAssembler::new(Options {
        features: Features::host(),
        shorten_jumps: false,
        seed: 1,
    });
    emit(&mut masm);
    masm.finish().unwrap()
}

fn install(code: &Code) -> CodeHandle {
    link(code, Priority::Required, |_| unreachable!()).unwrap()
}

fn returning(value: i32) -> CodeHandle {
    install(&assembled(|masm| {
        masm.move32(RESULT, value);
        masm.ret();
    }))
}

fn run(address: usize) -> u64 {
    // SAFETY: every function of this test has this type.
    unsafe { std::mem::transmute::<usize, extern "C" fn() -> u64>(address)() }
}

#[test]
#[ignore = "fills 300 MiB"]
fn code_in_another_region_is_reached() {
    let targets = [1, 2, 3].map(returning);
    let [one, two, three] = targets.each_ref().map(CodeHandle::start);
    let padding = |masm: &mut MacroAssembler| (0..25 << 20).for_each(|_| masm.nop());
    let filler = assembled(padding);
    let _fillers = [install(&filler), install(&filler)];
    let mut labels = None;
    let code = assembled(|masm| {
        let (to_one, again_to_one) = (masm.external_address(one), masm.external_address(one));
        let jump = masm.patchable_jump(to_one);
        let branch = masm.here();
        masm.move32(RESULT, 0);
        masm.branch_if_zero32(RESULT, again_to_one);
        let point = masm.here();
        masm.replaceable_point();
        masm.jump_address(two);
        padding(masm);
        labels = Some([jump, branch, point]);
    });
    for _ in 0..2 {
        let far = install(&code);
        assert!(far.start().abs_diff(one) > patch::REACH);
        let [jump, _, point] = labels
            .unwrap()
            .map(|label| far.address(code.offset_of(label)));
        assert_eq!((run(far.start()), run(point)), (1, 2));
        // SAFETY: the labels are of the kinds these take, and only this thread runs the code.
        unsafe {
            assert_eq!(transfer_target(jump), one);
            set_transfer_target(jump, three).unwrap();
            assert_eq!((transfer_target(jump), run(far.start())), (three, 3));
            set_transfer_target(jump, point).unwrap();
            assert_eq!((transfer_target(jump), run(far.start())), (point, 2));
            replace_with_jump(point, one).unwrap();
            assert_eq!(run(far.start()), 1);
        }
        assert_eq!(run(far.address(code.offset_of(labels.unwrap()[1]))), 1);
    }
}
