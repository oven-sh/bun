use bun_engine_asm::arm64::*;
use bun_engine_asm::{Arm64Features, Code, Fpr, Gpr, Size, Width};

use super::{Registers, slot};

pub(crate) type Enter = unsafe extern "C" fn(*mut Registers);

pub(crate) const LLVM_ARGUMENTS: [&str; 2] = crate::support::ARM64;
pub(crate) const STACK_MISALIGNMENT: usize = 0;
pub(crate) const UNCHECKED: &[Gpr] = &[X18, LR];
pub(crate) const SHIFT_REGISTERS: &[Gpr] = &[];
pub(crate) const DIVISION_REGISTERS: &[Gpr] = &[];
pub(crate) const ATOMIC_REGISTERS: &[Gpr] = &[];

fn word(base: Gpr, offset: i32) -> Mem {
    Mem::offset(Size::S64, base, offset.into()).unwrap()
}

pub(crate) fn enter() -> Code {
    let mut a = Assembler::new(Arm64Features::empty());
    let gpr = |base, reg| word(base, Registers::offset_of_gpr(reg));
    let fpr = |base, reg| {
        Mem::offset(AccessSize::S128, base, Registers::offset_of_fpr(reg).into()).unwrap()
    };
    let checked = || (0..30).map(Gpr::new).filter(|&reg| reg != X18);
    let (push, pop) = (
        Mem::pre_index(Size::S64, SP, -16).unwrap(),
        Mem::post_index(Size::S64, SP, 16).unwrap(),
    );
    let back = a.new_label();
    for number in 19..=30 {
        a.str(Gpr::new(number), push);
    }
    for number in 8..=15 {
        a.str_fpr(Fpr::new(number), push);
    }
    a.mov_sp(X9, SP);
    a.str(X9, word(X0, Registers::HOST_STACK));
    a.ldr(X9, gpr(X0, SP));
    a.mov_sp(SP, X9);
    a.adr(X9, back);
    a.str(X9, word(SP, slot::EXIT));
    for reg in (0..32).map(Fpr::new) {
        a.ldr_fpr(reg, fpr(X0, reg));
    }
    a.mov(Width::W64, LR, X0);
    for reg in checked() {
        a.ldr(reg, gpr(LR, reg));
    }
    a.cmp(Width::W64, X0, X1);
    a.ldr(LR, word(SP, slot::ENTRY));
    a.br(LR);
    a.bind(back);
    a.ldr(LR, word(SP, slot::REGISTERS));
    for reg in checked() {
        a.str(reg, gpr(LR, reg));
    }
    for reg in (0..32).map(Fpr::new) {
        a.str_fpr(reg, fpr(LR, reg));
    }
    a.mov_sp(X9, SP);
    a.str(X9, gpr(LR, SP));
    a.ldr(X9, word(LR, Registers::HOST_STACK));
    a.mov_sp(SP, X9);
    for number in (8..=15).rev() {
        a.ldr_fpr(Fpr::new(number), pop);
    }
    for number in (19..=30).rev() {
        a.ldr(Gpr::new(number), pop);
    }
    a.ret();
    a.finish().unwrap()
}

pub(crate) fn exit(a: &mut Assembler) {
    a.ldr(LR, word(SP, slot::EXIT));
    a.br(LR);
}

pub(crate) fn note_fall_through(a: &mut Assembler) {
    a.str(ZR, word(SP, slot::BRANCHED));
}

pub(crate) fn exchange_with_stack_pointer(a: &mut Assembler, reg: Gpr) {
    a.mov_sp(LR, SP);
    a.mov_sp(SP, reg);
    a.mov(Width::W64, reg, LR);
}
