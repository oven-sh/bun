use bun_engine_asm::x64::*;
use bun_engine_asm::{Address, Code, Fpr, Gpr, Size, Width, X64Features};

use super::{Registers, slot};

pub(crate) type Enter = unsafe extern "sysv64" fn(*mut Registers);

pub(crate) const LLVM_ARGUMENTS: [&str; 2] = ["-triple=x86_64", "--output-asm-variant=1"];
/// As on entry to a function.
pub(crate) const STACK_MISALIGNMENT: usize = 8;
pub(crate) const UNCHECKED: &[Gpr] = &[];
pub(crate) const SHIFT_REGISTERS: &[Gpr] = &[RCX];
pub(crate) const DIVISION_REGISTERS: &[Gpr] = &[RAX, RDX];
pub(crate) const ATOMIC_REGISTERS: &[Gpr] = &[RAX];

const SAVED: [Gpr; 6] = [RBX, RBP, R12, R13, R14, R15];

pub(crate) fn enter() -> Code {
    let mut a = Assembler::new(X64Features::empty(), false);
    let gpr = |reg: Gpr| Address::new(RDI, Registers::offset_of_gpr(reg));
    let fpr = |reg: Fpr| Address::new(RDI, Registers::offset_of_fpr(reg));
    let others = || (0..16).map(Gpr::new).filter(|&reg| reg != RDI);
    let host_stack = Address::new(RDI, Registers::HOST_STACK);
    let back = a.new_label();
    for reg in SAVED {
        a.push(reg);
    }
    a.mov_store(Size::S64, host_stack, RSP);
    a.mov(Width::W64, RSP, gpr(RSP));
    a.lea(Width::W64, RAX, Assembler::label_address(back));
    a.mov_store(Size::S64, Address::new(RSP, slot::EXIT), RAX);
    for reg in (0..16).map(Fpr::new) {
        a.sse_unary(SseUnary::Movups, reg, fpr(reg));
    }
    for reg in others() {
        a.mov(Width::W64, reg, gpr(reg));
    }
    a.mov(Width::W64, RDI, gpr(RDI));
    a.alu(Alu::Cmp, Size::S64, RAX, RCX);
    a.jmp_indirect(Address::new(RSP, slot::ENTRY));
    a.bind(back);
    a.xchg(Size::S64, Address::new(RSP, slot::REGISTERS), RDI);
    for reg in others() {
        a.mov_store(Size::S64, gpr(reg), reg);
    }
    a.mov(Width::W64, RAX, Address::new(RSP, slot::REGISTERS));
    a.mov_store(Size::S64, gpr(RDI), RAX);
    for reg in (0..16).map(Fpr::new) {
        a.sse_store(SseStore::Movups, fpr(reg), reg);
    }
    a.mov(Width::W64, RSP, host_stack);
    for reg in SAVED.into_iter().rev() {
        a.pop(reg);
    }
    a.ret();
    a.finish().unwrap()
}

pub(crate) fn exit(a: &mut Assembler) {
    a.jmp_indirect(Address::new(RSP, slot::EXIT));
}

pub(crate) fn note_fall_through(a: &mut Assembler) {
    a.mov_store_imm(Size::S64, Address::new(RSP, slot::BRANCHED), 0);
}

pub(crate) fn exchange_with_stack_pointer(a: &mut Assembler, reg: Gpr) {
    a.xchg(Size::S64, reg, RSP);
}
