use bun_engine_asm::arm64::*;
use bun_engine_asm::{Arm64Features, Code, Fpr, Gpr, MacroAssembly, Options, Size, Width};

use super::processor::Context;
use super::stub;

pub(super) type Enter = unsafe extern "C" fn(*mut Context);

pub(super) fn stubs(context: usize) -> Code {
    let mut masm = MacroAssembler::new(Options {
        features: Arm64Features::empty(),
        shorten_jumps: false,
        seed: 0,
    });
    let (called, interrupted) = (masm.new_label(), masm.new_label());
    for index in 0..stub::ENTER {
        if index == stub::SIGNAL {
            masm.move64(X16, context);
            masm.jump(interrupted);
        } else {
            masm.move64(X17, index);
            masm.jump(called);
        }
        masm.align(stub::SIZE as u32, stub::SIZE as u32);
    }

    let field = |base, offset: i32| Mem::offset(Size::S64, base, offset.into()).unwrap();
    let gpr = |base, reg| field(base, Context::offset_of_gpr(reg));
    let fpr = |base, reg| {
        Mem::offset(AccessSize::S128, base, Context::offset_of_fpr(reg).into()).unwrap()
    };
    let others = || {
        (0..31)
            .map(Gpr::new)
            .filter(|reg| ![X16, X17, X18].contains(reg))
    };
    let (push, pop) = (
        Mem::pre_index(Size::S64, SP, -16).unwrap(),
        Mem::post_index(Size::S64, SP, 16).unwrap(),
    );
    let a = masm.assembler();
    for number in 19..=30 {
        a.str(Gpr::new(number), push);
    }
    for number in 8..=15 {
        a.str_fpr(Fpr::new(number), push);
    }
    a.mov(Width::W64, X17, X0);
    a.mov_sp(X16, SP);
    a.str(X16, field(X17, Context::HOST_STACK));
    a.ldr(X16, gpr(X17, SP));
    a.mov_sp(SP, X16);
    a.ldr(X0, field(X17, Context::COMPARED));
    a.ldr(X1, field(X17, Context::COMPARED + 8));
    a.cmp(Width::W64, X0, X1);
    for reg in (0..32).map(Fpr::new) {
        a.ldr_fpr(reg, fpr(X17, reg));
    }
    for reg in others() {
        a.ldr(reg, gpr(X17, reg));
    }
    a.ldr(X16, field(X17, Context::PC));
    a.ldr(X17, gpr(X17, X17));
    a.br(X16);

    masm.bind(called);
    masm.move64(X16, context);
    let a = masm.assembler();
    a.str(X17, field(X16, Context::REASON));
    a.str(LR, field(X16, Context::PC));
    a.bind(interrupted);
    for reg in others() {
        a.str(reg, gpr(X16, reg));
    }
    for reg in (0..32).map(Fpr::new) {
        a.str_fpr(reg, fpr(X16, reg));
    }
    a.mov_sp(X17, SP);
    a.str(X17, gpr(X16, SP));
    a.ldr(X17, field(X16, Context::HOST_STACK));
    a.mov_sp(SP, X17);
    for number in (8..=15).rev() {
        a.ldr_fpr(Fpr::new(number), pop);
    }
    for number in (19..=30).rev() {
        a.ldr(Gpr::new(number), pop);
    }
    a.ret();
    masm.finish().unwrap()
}

/// `stack_pointer` is that before the call.
pub(super) fn prepare_call(context: &mut Context, stack_pointer: u64, return_address: u64) {
    context.set_gpr(SP, stack_pointer);
    context.set_gpr(LR, return_address);
}

pub(super) fn program_counter(state: &libc::mcontext_t) -> u64 {
    state.pc
}

pub(super) fn divert(state: &mut libc::mcontext_t, _: &mut Context, to: u64) {
    state.pc = to;
}
