use bun_engine_asm::x64::*;
use bun_engine_asm::{Address, Code, Fpr, Gpr, MacroAssembly, Options, Size, Width, X64Features};

use super::processor::Context;
use super::stub;

pub(super) type Enter = unsafe extern "sysv64" fn(*mut Context);

const SAVED: [Gpr; 6] = [RBX, RBP, R12, R13, R14, R15];

pub(super) fn stubs(context: usize) -> Code {
    let mut masm = MacroAssembler::new(Options {
        features: X64Features::empty(),
        shorten_jumps: false,
        seed: 0,
    });
    let [called, returned, interrupted] = [(); 3].map(|()| masm.new_label());
    for index in 0..stub::ENTER {
        let a = masm.assembler();
        if index == stub::SIGNAL {
            a.movabs(RAX, context as u64);
            a.jmp(interrupted);
        } else {
            a.push(RAX);
            a.push_imm(index as i32);
            a.jmp(if index == stub::RETURN {
                returned
            } else {
                called
            });
        }
        masm.align(stub::SIZE as u32, stub::SIZE as u32);
    }

    let a = masm.assembler();
    let field = |offset| Address::new(RAX, offset);
    let gpr = |reg| field(Context::offset_of_gpr(reg));
    let fpr = |reg| field(Context::offset_of_fpr(reg));
    let others = || (1..16).map(Gpr::new);
    for reg in SAVED {
        a.push(reg);
    }
    a.mov(Width::W64, RAX, RDI);
    a.mov_store(Size::S64, field(Context::HOST_STACK), RSP);
    a.mov(Width::W64, RSP, gpr(RSP));
    a.mov(Width::W64, RCX, field(Context::PC));
    a.mov_store(Size::S64, Address::new(RSP, -8), RCX);
    a.mov(Width::W64, RCX, field(Context::COMPARED));
    a.alu(Alu::Cmp, Size::S64, RCX, field(Context::COMPARED + 8));
    for reg in (0..16).map(Fpr::new) {
        a.sse_unary(SseUnary::Movups, reg, fpr(reg));
    }
    for reg in others() {
        a.mov(Width::W64, reg, gpr(reg));
    }
    a.mov(Width::W64, RAX, gpr(RAX));
    a.jmp_indirect(Address::new(RSP, -8));

    for (label, has_return_address) in [(returned, false), (called, true)] {
        a.bind(label);
        a.movabs(RAX, context as u64);
        a.pop_mem(field(Context::REASON));
        a.pop_mem(gpr(RAX));
        if has_return_address {
            a.pop_mem(field(Context::PC));
        }
        a.jmp(interrupted);
    }
    a.bind(interrupted);
    for reg in others() {
        a.mov_store(Size::S64, gpr(reg), reg);
    }
    for reg in (0..16).map(Fpr::new) {
        a.sse_store(SseStore::Movups, fpr(reg), reg);
    }
    a.mov(Width::W64, RSP, field(Context::HOST_STACK));
    for reg in SAVED.into_iter().rev() {
        a.pop(reg);
    }
    a.ret();
    masm.finish().unwrap()
}

/// `stack_pointer` is that before the call.
pub(super) fn prepare_call(context: &mut Context, stack_pointer: u64, return_address: u64) {
    context.set_gpr(RSP, stack_pointer - 8);
    super::processor::write(stack_pointer - 8, &return_address.to_le_bytes());
}

pub(super) fn program_counter(state: &libc::mcontext_t) -> u64 {
    state.gregs[libc::REG_RIP as usize] as u64
}

pub(super) fn divert(state: &mut libc::mcontext_t, context: &mut Context, to: u64) {
    context.set_gpr(RAX, state.gregs[libc::REG_RAX as usize] as u64);
    state.gregs[libc::REG_RIP as usize] = to as i64;
}
