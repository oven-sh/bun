use super::abi;
use super::assembler::Assembler;
use super::immediate::BitmaskImm;
use super::load_store::{Mem, PairMem};
use super::macro_assembler::{MacroAssembler, all_ones, unsigned};
use super::neon_opcode::{Arrangement, NeonAcross, NeonUnary};
use super::opcode::{
    AddSub, AtomicUpdate, Barrier, Bitfield, Cc, Extend, IndexExtend, Logical, MoveWide,
    MultiplyAdd, MultiplyAddLong, Select, ShiftOp, Unary, WithCarry,
};
use super::registers::{FP, LR, SP, ZR};
use crate::assembly::{MacroAssembly, Options, Scratch};
use crate::features::Arm64Features;
use crate::label::{Code, CodeTooLarge, Label, Target};
use crate::operand::{
    Address, Amount, AtomicOp, Cond, FloatWidth, Memory, RegOrImm, RegOrMem, ResultCond, Shift,
    Sign, Size, Src, TestCond, Width,
};
use crate::register::{Fpr, Gpr, RegisterSet};

const USUAL_SCRATCH: Scratch = Scratch {
    gprs: [Some(abi::SCRATCH_GPRS[0]), Some(abi::SCRATCH_GPRS[1])],
    fprs: [Some(abi::SCRATCH_FPRS[0]), Some(abi::SCRATCH_FPRS[1])],
};

/// Debuggers continue after this one.
const BREAKPOINT: u16 = 0xf000;
const TRAP: u16 = 1;

/// `amount` is taken modulo the width.
#[inline(always)]
fn constant_shift(shift: Shift, width: Width, amount: u8) -> (ShiftOp, u8) {
    let (op, amount) = match shift {
        Shift::Left => (ShiftOp::Lsl, amount),
        Shift::RightLogical => (ShiftOp::Lsr, amount),
        Shift::RightArithmetic => (ShiftOp::Asr, amount),
        Shift::RotateLeft => (ShiftOp::Ror, amount.wrapping_neg()),
        Shift::RotateRight => (ShiftOp::Ror, amount),
    };
    (op, amount % width.bits())
}

#[inline(always)]
fn extending_bitfield(sign: Sign) -> Bitfield {
    match sign {
        Sign::Signed => Bitfield::Sbfm,
        Sign::Unsigned => Bitfield::Ubfm,
    }
}

/// What can be done to memory in place.
#[derive(Clone, Copy)]
enum Update {
    AddSub(AddSub),
    Logical(Logical),
}

impl MacroAssembler {
    #[inline(always)]
    fn add_sub_setting_flags(&mut self, op: AddSub, width: Width, dst: Gpr, lhs: Gpr, rhs: Src) {
        if let Src::Imm(rhs) | Src::Untrusted(rhs) = rhs
            && let Some((op, imm)) = op.with_constant(width, rhs)
        {
            return self.asm.add_sub_imm(op, width, dst, lhs, imm);
        }
        let rhs = self.register_for(width, rhs);
        self.asm.add_sub(op, width, dst, lhs, rhs);
    }

    #[inline(always)]
    fn logical(&mut self, op: Logical, width: Width, dst: Gpr, lhs: Gpr, rhs: Src) {
        if let Src::Imm(rhs) | Src::Untrusted(rhs) = rhs {
            return self.logical_with_constant(op, width, dst, lhs, unsigned(width, rhs));
        }
        let rhs = self.register_for(width, rhs);
        self.asm.logical(op, width, dst, lhs, rhs);
    }

    fn logical_with_constant(&mut self, op: Logical, width: Width, dst: Gpr, lhs: Gpr, rhs: u64) {
        if dst == SP || lhs == SP {
            return self.and_with_stack_pointer(op, dst, lhs, rhs);
        }
        let width = if op == Logical::And && rhs >> 32 == 0 {
            Width::W32
        } else {
            width
        };
        if let Some(imm) = BitmaskImm::new(width, rhs) {
            return self.asm.logical_imm(op, dst, lhs, imm);
        }
        match (op, rhs == 0, rhs == all_ones(width)) {
            (Logical::And, true, _) | (Logical::Orr, _, true) => {
                self.move_constant(width, dst, rhs as i64)
            }
            (Logical::And, _, true) | (_, true, _) => self.move_int(width, dst, lhs),
            (_, _, true) => self.asm.mvn(width, dst, lhs),
            _ => {
                let rhs = self.constant_beside(lhs, width, rhs as i64);
                self.asm.logical(op, width, dst, lhs, rhs);
            }
        }
    }

    #[cold]
    fn and_with_stack_pointer(&mut self, op: Logical, dst: Gpr, mut lhs: Gpr, rhs: u64) {
        assert!(op == Logical::And);
        let temp = if dst == SP { self.data_scratch() } else { dst };
        if lhs == SP {
            self.asm.mov_sp(temp, SP);
            lhs = temp;
        }
        if let Some(imm) = BitmaskImm::new(Width::W64, rhs) {
            return self.asm.logical_imm(op, dst, lhs, imm);
        }
        self.logical_with_constant(op, Width::W64, temp, lhs, rhs);
        self.move64(dst, temp);
    }

    fn multiply_by_constant(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: i64) {
        let log2 = |value: i64| {
            let value = unsigned(width, value);
            value
                .is_power_of_two()
                .then(|| value.trailing_zeros() as u8)
        };
        let shifted = |masm: &mut Self, op, first, amount| {
            masm.asm
                .add_sub_shifted(op, width, dst, first, lhs, ShiftOp::Lsl, amount);
        };
        if let Some(amount) = log2(rhs) {
            self.shift(Shift::Left, width, dst, lhs, amount);
        } else if let Some(amount) = log2(rhs.wrapping_neg()) {
            shifted(self, AddSub::Sub, ZR, amount);
        } else if let Some(amount) = log2(rhs.wrapping_sub(1)) {
            shifted(self, AddSub::Add, lhs, amount);
        } else if let Some(amount) = log2(1i64.wrapping_sub(rhs)) {
            shifted(self, AddSub::Sub, lhs, amount);
        } else {
            let rhs = self.constant_beside(lhs, width, rhs);
            self.asm.mul(width, dst, lhs, rhs);
        }
    }

    #[inline(always)]
    fn update_memory(&mut self, op: Update, size: Size, dst: Memory, src: RegOrImm) {
        match src {
            RegOrImm::Reg(src) => {
                let (data, mem) = (self.data_scratch(), self.mem(size, dst));
                self.asm.ldr(data, mem);
                self.update_with_register(op, size.width(), data, src);
                self.asm.str(data, mem);
            }
            RegOrImm::Imm(src) | RegOrImm::Untrusted(src) => {
                self.update_memory_with_constant(op, size, dst, src)
            }
        }
    }

    #[inline(always)]
    fn update_with_register(&mut self, op: Update, width: Width, data: Gpr, src: Gpr) {
        match op {
            Update::AddSub(op) => self.asm.add_sub(op, width, data, data, src),
            Update::Logical(op) => self.asm.logical(op, width, data, data, src),
        }
    }

    fn update_memory_with_constant(&mut self, op: Update, size: Size, dst: Memory, src: i64) {
        let (width, above) = (size.width(), 64 - size.bits());
        let (data, mut mem) = (self.data_scratch(), self.mem(size, dst));
        self.asm.ldr(data, mem);
        let stored_bits = u64::MAX >> above;
        let src = src as u64 & stored_bits;
        if let Update::AddSub(op) = op
            && let Some((op, imm)) = op.with_constant(width, (src as i64) << above >> above)
        {
            self.asm.add_sub_imm(op, width, data, data, imm);
        } else if let Update::Logical(op) = op
            && let Some(imm) = BitmaskImm::new(width, src * (u64::MAX / stored_bits))
        {
            self.asm.logical_imm(op, data, data, imm);
        } else {
            let src = self.constant_beside(data, width, src as i64);
            self.update_with_register(op, width, data, src);
            mem = self.mem(size, dst);
        }
        self.asm.str(data, mem);
    }

    fn atomic_update_in_a_loop(
        &mut self,
        op: AtomicOp,
        size: Size,
        dst: Gpr,
        base: Gpr,
        operand: Gpr,
        temp: Gpr,
    ) {
        let width = size.width();
        let again = self.here();
        self.asm.ldaxr(size, dst, base);
        match op {
            AtomicOp::Add => self.asm.add_sub(AddSub::Add, width, temp, dst, operand),
            AtomicOp::Sub => self.asm.add_sub(AddSub::Sub, width, temp, dst, operand),
            AtomicOp::And => self.asm.logical(Logical::And, width, temp, dst, operand),
            AtomicOp::Or => self.asm.logical(Logical::Orr, width, temp, dst, operand),
            AtomicOp::Xor => self.asm.logical(Logical::Eor, width, temp, dst, operand),
            AtomicOp::Exchange => {}
        }
        let (status, new) = if op == AtomicOp::Exchange {
            (temp, operand)
        } else {
            (self.data_scratch(), temp)
        };
        self.asm.stlxr(size, status, new, base);
        self.asm.cbnz(Width::W32, status, again);
    }
}

impl MacroAssembly for MacroAssembler {
    type Features = Arm64Features;

    const FRAME_POINTER: Gpr = abi::FRAME_POINTER;
    const STACK_POINTER: Gpr = abi::STACK_POINTER;
    const NUMBER_TAG: Gpr = abi::NUMBER_TAG;
    const NOT_CELL_MASK: Gpr = abi::NOT_CELL_MASK;
    const ARGUMENT_GPRS: &'static [Gpr] = &abi::ARGUMENT_GPRS;
    const ARGUMENT_FPRS: &'static [Fpr] = &abi::ARGUMENT_FPRS;
    const DIVISION_CLOBBERS: RegisterSet = RegisterSet::EMPTY;
    const ATOMIC_CLOBBERS: RegisterSet = RegisterSet::EMPTY;
    const PUSH_SIZE: i32 = 16;

    fn new(options: Options<Arm64Features>) -> Self {
        Self {
            asm: Assembler::new(options.features),
            scratch: USUAL_SCRATCH,
        }
    }

    #[inline]
    fn features(&self) -> Arm64Features {
        self.asm.features
    }

    fn finish(self) -> Result<Code, CodeTooLarge> {
        self.asm.finish()
    }

    fn take_code(&mut self) -> Result<Code, CodeTooLarge> {
        self.asm.take_code()
    }

    fn restart(&mut self, options: Options<Arm64Features>, spent: Option<Code>) {
        self.asm.restart(options.features, spent);
        self.scratch = USUAL_SCRATCH;
    }

    #[inline]
    fn size(&self) -> usize {
        if self.asm.buffer.overflowed {
            usize::MAX
        } else {
            self.asm.buffer.len as usize
        }
    }

    fn reserve(&mut self, bytes: usize) {
        self.asm.buffer.reserve(bytes);
    }

    #[inline]
    fn scratch(&self) -> Scratch {
        self.scratch
    }

    #[inline]
    fn set_scratch(&mut self, scratch: Scratch) -> Scratch {
        core::mem::replace(&mut self.scratch, scratch)
    }

    #[inline]
    fn new_label(&mut self) -> Label {
        self.asm.new_label()
    }

    #[inline]
    fn bind(&mut self, label: Label) {
        self.asm.bind(label);
    }

    fn alias(&mut self, label: Label, target: Label) {
        self.asm.buffer.alias(label, target);
    }

    #[inline]
    fn external(&mut self, target: Target) -> Label {
        self.asm.buffer.external(target)
    }

    #[inline]
    fn mark(&mut self) -> Label {
        self.asm.buffer.mark()
    }

    fn align(&mut self, alignment: u32, max_padding: u32) {
        assert!(alignment.is_power_of_two() && alignment <= 64);
        self.asm.pad(
            alignment.trailing_zeros() as u8,
            max_padding.min(alignment - 1) as u8,
        );
    }

    #[inline]
    fn jump(&mut self, target: Label) {
        self.asm.b(target);
    }

    #[inline]
    fn jump_indirect(&mut self, target: impl Into<RegOrMem>) {
        let target = self.register_for(Width::W64, target.into().into());
        self.asm.br(target);
    }

    fn jump_table(&mut self, index: Gpr, targets: &[Label]) {
        let table = self.asm.buffer.jump_table(targets);
        let origin = self.data_scratch();
        self.asm.adr(origin, table);
        let entry = Mem::indexed(Size::S32, origin, index, IndexExtend::Lsl, true);
        self.asm.ldrs(Width::W64, index, entry);
        self.asm
            .add_sub(AddSub::Add, Width::W64, origin, origin, index);
        self.asm.br(origin);
    }

    #[inline]
    fn call(&mut self, target: Label) {
        self.asm.bl(target);
    }

    #[inline]
    fn call_indirect(&mut self, target: impl Into<RegOrMem>) {
        let target = self.register_for(Width::W64, target.into().into());
        self.asm.blr(target);
    }

    #[inline]
    fn ret(&mut self) {
        self.asm.ret();
    }

    fn move_label_address(&mut self, dst: Gpr, label: Label) {
        self.asm.adr(dst, label);
    }

    fn breakpoint(&mut self) {
        self.asm.brk(BREAKPOINT);
    }

    fn abort(&mut self, reason: u16) {
        self.move32(abi::SCRATCH_GPRS[0], u32::from(reason));
        self.asm.brk(TRAP);
    }

    fn nop(&mut self) {
        self.asm.nop();
    }

    fn patchable_jump(&mut self, target: Label) -> Label {
        self.asm.leave_replaceable_bytes();
        self.asm.b(target);
        self.mark()
    }

    fn patchable_call(&mut self, target: Label) -> Label {
        self.asm.leave_replaceable_bytes();
        self.asm.bl(target);
        self.mark()
    }

    fn patchable_move64(&mut self, dst: Gpr, value: u64) -> Label {
        self.asm.leave_replaceable_bytes();
        for shift in [0, 16, 32, 48] {
            let op = if shift == 0 {
                MoveWide::Movz
            } else {
                MoveWide::Movk
            };
            self.asm
                .move_wide(op, Width::W64, dst, (value >> shift) as u16, shift);
        }
        self.mark()
    }

    fn replaceable_point(&mut self) -> Label {
        self.asm.replaceable_point()
    }

    fn enter_frame(&mut self) {
        self.push_pair(FP, LR);
        self.asm.mov_sp(FP, SP);
    }

    fn leave_frame(&mut self) {
        self.asm.mov_sp(SP, FP);
        self.pop_pair(FP, LR);
    }

    fn push(&mut self, src: Gpr) {
        self.asm
            .str(src, Mem::pre_index(Size::S64, SP, -16).unwrap());
    }

    fn pop(&mut self, dst: Gpr) {
        self.asm
            .ldr(dst, Mem::post_index(Size::S64, SP, 16).unwrap());
    }

    fn push_pair(&mut self, low: Gpr, high: Gpr) {
        self.asm
            .stp(low, high, PairMem::pre_index(Size::S64, SP, -16).unwrap());
    }

    fn pop_pair(&mut self, low: Gpr, high: Gpr) {
        self.asm
            .ldp(low, high, PairMem::post_index(Size::S64, SP, 16).unwrap());
    }

    #[inline]
    fn move_int(&mut self, width: Width, dst: Gpr, src: impl Into<RegOrImm>) {
        match src.into() {
            RegOrImm::Reg(src) if width == Width::W32 => self.asm.mov(width, dst, src),
            RegOrImm::Reg(src) if dst == src => {}
            RegOrImm::Reg(src) if dst == SP || src == SP => self.asm.mov_sp(dst, src),
            RegOrImm::Reg(src) => self.asm.mov(width, dst, src),
            RegOrImm::Imm(value) | RegOrImm::Untrusted(value) => {
                self.move_constant(width, dst, value)
            }
        }
    }

    fn swap(&mut self, a: Gpr, b: Gpr) {
        if a != b {
            let temp = self.address_scratch();
            self.asm.mov(Width::W64, temp, a);
            self.asm.mov(Width::W64, a, b);
            self.asm.mov(Width::W64, b, temp);
        }
    }

    #[inline]
    fn extend(&mut self, from: Size, sign: Sign, width: Width, dst: Gpr, src: Gpr) {
        assert!(from <= width.size());
        let width = if sign == Sign::Unsigned {
            from.width()
        } else {
            width
        };
        if from == width.size() {
            self.move_int(width, dst, src);
        } else {
            self.asm
                .bitfield_extract(extending_bitfield(sign), width, dst, src, 0, from.bits());
        }
    }

    #[inline]
    fn compute_address(&mut self, dst: Gpr, address: Address) {
        if address.has_index() {
            self.add_index_and_offset(dst, address);
        } else {
            self.add64(dst, address.base, address.offset);
        }
    }

    #[inline]
    fn load(&mut self, size: Size, dst: Gpr, src: impl Into<Memory>) {
        let src = self.mem_for_load(size, src, dst);
        self.asm.ldr(dst, src);
    }

    #[inline]
    fn load_signed(&mut self, size: Size, width: Width, dst: Gpr, src: impl Into<Memory>) {
        assert!(size <= width.size());
        let src = self.mem_for_load(size, src, dst);
        if size == width.size() {
            self.asm.ldr(dst, src);
        } else {
            self.asm.ldrs(width, dst, src);
        }
    }

    #[inline]
    fn store(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        let src = match src.into() {
            RegOrImm::Reg(src) => src,
            RegOrImm::Imm(value) | RegOrImm::Untrusted(value) => {
                let stored = value as u64 & u64::MAX >> (64 - size.bits());
                self.constant_beside(ZR, size.width(), stored as i64)
            }
        };
        let dst = self.mem(size, dst);
        self.asm.str(src, dst);
    }

    fn load_pair(&mut self, width: Width, low: Gpr, high: Gpr, src: Address) {
        let src = self.pair_mem(width, src);
        self.asm.ldp(low, high, src);
    }

    fn store_pair(&mut self, width: Width, dst: Address, low: Gpr, high: Gpr) {
        let dst = self.pair_mem(width, dst);
        self.asm.stp(low, high, dst);
    }

    fn transfer(&mut self, size: Size, dst: Address, src: Address) {
        if dst != src {
            let data = self.load_data(size, src.into());
            self.store(size, dst, data);
        }
    }

    #[inline]
    fn add_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Update::AddSub(AddSub::Add), size, dst.into(), src.into());
    }

    #[inline]
    fn and_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Update::Logical(Logical::And), size, dst.into(), src.into());
    }

    #[inline]
    fn or_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Update::Logical(Logical::Orr), size, dst.into(), src.into());
    }

    fn prefetch(&mut self, address: Address) {
        let address = self.mem(Size::S64, address);
        self.asm.prfm(address);
    }

    #[inline]
    fn add(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match rhs.into() {
            Src::Imm(0) | Src::Untrusted(0) => self.move_int(width, dst, lhs),
            Src::Imm(rhs) | Src::Untrusted(rhs) => self.add_constant(width, dst, lhs, rhs),
            rhs => {
                let rhs = self.register_for(width, rhs);
                self.add_sub_registers(AddSub::Add, width, dst, lhs, rhs);
            }
        }
    }

    #[inline]
    fn sub(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match rhs.into() {
            Src::Imm(rhs) | Src::Untrusted(rhs) => self.add(width, dst, lhs, rhs.wrapping_neg()),
            rhs => {
                let rhs = self.register_for(width, rhs);
                self.add_sub_registers(AddSub::Sub, width, dst, lhs, rhs);
            }
        }
    }

    #[inline]
    fn mul(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match rhs.into() {
            Src::Imm(rhs) | Src::Untrusted(rhs) => self.multiply_by_constant(width, dst, lhs, rhs),
            rhs => {
                let rhs = self.register_for(width, rhs);
                self.asm.mul(width, dst, lhs, rhs);
            }
        }
    }

    #[inline]
    fn and(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        self.logical(Logical::And, width, dst, lhs, rhs.into());
    }

    #[inline]
    fn or(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        self.logical(Logical::Orr, width, dst, lhs, rhs.into());
    }

    #[inline]
    fn xor(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        self.logical(Logical::Eor, width, dst, lhs, rhs.into());
    }

    fn neg(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.asm.neg(width, dst, src);
    }

    fn not(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.asm.mvn(width, dst, src);
    }

    #[inline]
    fn shift(&mut self, shift: Shift, width: Width, dst: Gpr, src: Gpr, amount: impl Into<Amount>) {
        match amount.into() {
            Amount::Imm(amount) => match constant_shift(shift, width, amount) {
                (_, 0) => self.move_int(width, dst, src),
                (op, amount) => self.asm.shift_imm(op, width, dst, src, amount),
            },
            Amount::Reg(mut amount) => {
                if shift == Shift::RotateLeft {
                    let negated = self.data_scratch();
                    self.asm.neg(Width::W32, negated, amount);
                    amount = negated;
                }
                let (op, _) = constant_shift(shift, width, 0);
                self.asm.shift(op, width, dst, src, amount);
            }
        }
    }

    fn div(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.asm.div(sign, width, dst, lhs, rhs);
    }

    fn rem(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        let quotient = self.data_scratch();
        self.asm.div(sign, width, quotient, lhs, rhs);
        self.asm
            .multiply_add(MultiplyAdd::Msub, width, dst, quotient, rhs, lhs);
    }

    fn mul_high64(&mut self, sign: Sign, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.asm.multiply_high(sign, dst, lhs, rhs);
    }

    fn mul_wide64(&mut self, sign: Sign, low: Gpr, high: Gpr, lhs: Gpr, rhs: Gpr) {
        assert!(low != high);
        if low != lhs && low != rhs {
            self.asm.mul(Width::W64, low, lhs, rhs);
            self.asm.multiply_high(sign, high, lhs, rhs);
            return;
        }
        let first = if high != lhs && high != rhs {
            high
        } else {
            self.data_scratch()
        };
        self.asm.multiply_high(sign, first, lhs, rhs);
        self.asm.mul(Width::W64, low, lhs, rhs);
        self.move64(high, first);
    }

    fn add128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]) {
        assert!(![dst[1], lhs[1], rhs[1]].contains(&dst[0]));
        self.asm
            .add_sub(AddSub::Adds, Width::W64, dst[0], lhs[0], rhs[0]);
        self.asm
            .with_carry(WithCarry::Adc, Width::W64, dst[1], lhs[1], rhs[1]);
    }

    fn sub128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]) {
        assert!(![dst[1], lhs[1], rhs[1]].contains(&dst[0]));
        self.asm
            .add_sub(AddSub::Subs, Width::W64, dst[0], lhs[0], rhs[0]);
        self.asm
            .with_carry(WithCarry::Sbc, Width::W64, dst[1], lhs[1], rhs[1]);
    }

    fn count_leading_zeros(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.asm.unary(Unary::Clz, width, dst, src);
    }

    fn count_trailing_zeros(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.asm.unary(Unary::Rbit, width, dst, src);
        self.asm.unary(Unary::Clz, width, dst, dst);
    }

    fn count_ones(&mut self, width: Width, dst: Gpr, src: Gpr) {
        let bytes = self.scratch_fpr(0);
        let same_width = match width {
            Width::W32 => FloatWidth::F32,
            Width::W64 => FloatWidth::F64,
        };
        self.asm.fmov_to_fpr(same_width, bytes, src);
        self.asm
            .neon_unary(NeonUnary::Cnt, Arrangement::B8, bytes, bytes);
        self.asm
            .neon_across(NeonAcross::Addv, Arrangement::B8, bytes, bytes);
        self.asm.fmov_from_fpr(FloatWidth::F32, dst, bytes);
    }

    fn swap_bytes(&mut self, size: Size, dst: Gpr, src: Gpr) {
        if size == Size::S8 {
            return self.zero_extend8(dst, src);
        }
        self.asm.unary(Unary::Rev, size.width(), dst, src);
        if size == Size::S16 {
            self.asm.shift_imm(ShiftOp::Lsr, Width::W32, dst, dst, 16);
        }
    }

    fn extract_bits(&mut self, sign: Sign, width: Width, dst: Gpr, src: Gpr, first: u8, count: u8) {
        self.asm
            .bitfield_extract(extending_bitfield(sign), width, dst, src, first, count);
    }

    fn add_shifted(
        &mut self,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        shift: Shift,
        amount: u8,
    ) {
        let (shift, amount) = constant_shift(shift, width, amount);
        self.asm
            .add_sub_shifted(AddSub::Add, width, dst, lhs, rhs, shift, amount);
    }

    fn xor_shifted(
        &mut self,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
        shift: Shift,
        amount: u8,
    ) {
        let (shift, amount) = constant_shift(shift, width, amount);
        self.asm
            .logical_shifted(Logical::Eor, width, dst, lhs, rhs, shift, amount);
    }

    #[inline]
    fn branch(
        &mut self,
        width: Width,
        cond: Cond,
        lhs: impl Into<RegOrMem>,
        rhs: impl Into<Src>,
        target: Label,
    ) {
        self.compare_and_branch(width, cond, lhs.into(), rhs.into(), target);
    }

    #[inline]
    fn branch_narrow(
        &mut self,
        size: Size,
        cond: Cond,
        lhs: impl Into<Memory>,
        rhs: i32,
        target: Label,
    ) {
        let (lhs, rhs) = self.load_narrow_to_compare(size, cond, lhs.into(), rhs);
        self.branch32(cond, lhs, rhs, target);
    }

    #[inline]
    fn branch_test(
        &mut self,
        width: Width,
        cond: TestCond,
        value: impl Into<RegOrMem>,
        mask: impl Into<RegOrImm>,
        target: Label,
    ) {
        self.test_and_branch(width, cond, value.into(), mask.into(), target);
    }

    #[inline]
    fn branch_test_narrow(
        &mut self,
        size: Size,
        cond: TestCond,
        value: impl Into<Memory>,
        mask: i32,
        target: Label,
    ) {
        let (value, cond, mask) = self.load_narrow_to_test(size, cond, value.into(), mask);
        self.branch_test32(cond, value, mask, target);
    }

    #[inline]
    fn branch_test_bit(
        &mut self,
        width: Width,
        cond: TestCond,
        value: Gpr,
        bit: impl Into<Amount>,
        target: Label,
    ) {
        assert!(matches!(cond, TestCond::Zero | TestCond::NonZero));
        let (value, bit) = match bit.into() {
            Amount::Imm(bit) => (value, bit % width.bits()),
            Amount::Reg(bit) => {
                let shifted = self.data_scratch();
                self.asm.shift(ShiftOp::Lsr, width, shifted, value, bit);
                (shifted, 0)
            }
        };
        self.branch_on_bit(value, bit, cond == TestCond::NonZero, target);
    }

    #[inline]
    fn branch_add(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    ) {
        self.add_sub_setting_flags(AddSub::Adds, width, dst, lhs, rhs.into());
        self.asm.b_cond(Cc::after_addition(cond), target);
    }

    #[inline]
    fn branch_sub(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    ) {
        self.add_sub_setting_flags(AddSub::Subs, width, dst, lhs, rhs.into());
        self.asm.b_cond(Cc::after_subtraction(cond), target);
    }

    #[inline]
    fn branch_mul_overflow(
        &mut self,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<Src>,
        target: Label,
    ) {
        let rhs = self.register_for(width, rhs.into());
        match width {
            Width::W32 => {
                self.asm
                    .multiply_add_long(MultiplyAddLong::Smaddl, dst, lhs, rhs, ZR);
                self.asm
                    .add_sub_extended(AddSub::Subs, Width::W64, ZR, dst, dst, Extend::Sxtw, 0);
                self.asm.mov(width, dst, dst);
            }
            Width::W64 => {
                let high = self.address_scratch();
                self.asm.multiply_high(Sign::Signed, high, lhs, rhs);
                self.asm.mul(width, dst, lhs, rhs);
                self.asm
                    .add_sub_shifted(AddSub::Subs, width, ZR, high, dst, ShiftOp::Asr, 63);
            }
        }
        self.asm.b_cond(Cc::Ne, target);
    }

    fn branch_neg(&mut self, width: Width, cond: ResultCond, dst: Gpr, src: Gpr, target: Label) {
        assert!(!matches!(cond, ResultCond::Carry | ResultCond::NoCarry));
        self.asm.add_sub(AddSub::Subs, width, dst, ZR, src);
        self.asm.b_cond(Cc::after_subtraction(cond), target);
    }

    #[inline]
    fn branch_add_to_memory(
        &mut self,
        width: Width,
        cond: ResultCond,
        dst: impl Into<Memory>,
        src: i32,
        target: Label,
    ) {
        let op = Update::AddSub(AddSub::Adds);
        self.update_memory(op, width.size(), dst.into(), src.into());
        self.asm.b_cond(Cc::after_addition(cond), target);
    }

    #[inline]
    fn compare(
        &mut self,
        width: Width,
        cond: Cond,
        dst: Gpr,
        lhs: impl Into<RegOrMem>,
        rhs: impl Into<Src>,
    ) {
        let cc = self.set_flags_for_compare(width, cond, lhs.into(), rhs.into());
        self.asm.cset(dst, cc);
    }

    #[inline]
    fn compare_narrow(
        &mut self,
        size: Size,
        cond: Cond,
        dst: Gpr,
        lhs: impl Into<Memory>,
        rhs: i32,
    ) {
        let (lhs, rhs) = self.load_narrow_to_compare(size, cond, lhs.into(), rhs);
        self.compare32(cond, dst, lhs, rhs);
    }

    #[inline]
    fn test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Gpr,
        value: impl Into<RegOrMem>,
        mask: impl Into<RegOrImm>,
    ) {
        self.test_and_set(width, cond, dst, value.into(), mask.into());
    }

    #[inline]
    fn test_narrow(
        &mut self,
        size: Size,
        cond: TestCond,
        dst: Gpr,
        value: impl Into<Memory>,
        mask: i32,
    ) {
        let (value, cond, mask) = self.load_narrow_to_test(size, cond, value.into(), mask);
        self.test32(cond, dst, value, mask);
    }

    #[inline]
    fn select(
        &mut self,
        width: Width,
        cond: Cond,
        dst: Gpr,
        lhs: Gpr,
        rhs: impl Into<RegOrImm>,
        then: Gpr,
        or: Gpr,
    ) {
        let cc = self.set_flags_for_compare(width, cond, lhs.into(), rhs.into().into());
        self.asm.select(Select::Csel, Width::W64, dst, then, or, cc);
    }

    #[inline]
    fn select_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Gpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Gpr,
        or: Gpr,
    ) {
        let cc = self.set_flags_for_test(width, cond, value.into(), mask.into());
        self.asm.select(Select::Csel, Width::W64, dst, then, or, cc);
    }

    fn atomic_load(&mut self, size: Size, dst: Gpr, src: Address) {
        let src = self.base_register(src);
        self.asm.ldar(size, dst, src);
    }

    fn atomic_store(&mut self, size: Size, dst: Address, src: Gpr) {
        let dst = self.base_register(dst);
        self.asm.stlr(size, src, dst);
    }

    fn atomic_update(
        &mut self,
        op: AtomicOp,
        size: Size,
        dst: Gpr,
        address: Address,
        operand: Gpr,
        temp: Gpr,
    ) {
        assert!(dst != temp && dst != operand && temp != operand);
        assert!(!address.uses(dst) && !address.uses(temp));
        let base = self.base_register(address);
        if !self.asm.has(Arm64Features::LSE) {
            return self.atomic_update_in_a_loop(op, size, dst, base, operand, temp);
        }
        let (op, operand) = match op {
            AtomicOp::Add => (AtomicUpdate::Ldaddal, operand),
            AtomicOp::Sub => {
                self.asm.neg(size.width(), temp, operand);
                (AtomicUpdate::Ldaddal, temp)
            }
            AtomicOp::And => {
                self.asm.mvn(size.width(), temp, operand);
                (AtomicUpdate::Ldclral, temp)
            }
            AtomicOp::Or => (AtomicUpdate::Ldsetal, operand),
            AtomicOp::Xor => (AtomicUpdate::Ldeoral, operand),
            AtomicOp::Exchange => (AtomicUpdate::Swpal, operand),
        };
        self.asm.atomic_update(op, size, operand, dst, base);
    }

    fn atomic_compare_exchange(
        &mut self,
        size: Size,
        dst: Gpr,
        address: Address,
        expected: Gpr,
        replacement: Gpr,
        temp: Gpr,
    ) {
        assert!(dst == expected || dst != replacement && !address.uses(dst));
        assert!(![dst, expected, replacement].contains(&temp) && !address.uses(temp));
        let (base, width) = (self.base_register(address), size.width());
        if self.asm.has(Arm64Features::LSE) {
            self.move64(dst, expected);
            return self.asm.casal(size, dst, replacement, base);
        }
        let old = if dst == expected { temp } else { dst };
        let extend = match size {
            Size::S8 => Extend::Uxtb,
            Size::S16 => Extend::Uxth,
            Size::S32 => Extend::Uxtw,
            Size::S64 => Extend::Uxtx,
        };
        let (status, done) = (self.data_scratch(), self.new_label());
        let again = self.here();
        self.asm.ldaxr(size, old, base);
        self.asm
            .add_sub_extended(AddSub::Subs, width, ZR, old, expected, extend, 0);
        self.asm.b_cond(Cc::Ne, done);
        self.asm.stlxr(size, status, replacement, base);
        self.asm.cbnz(Width::W32, status, again);
        self.bind(done);
        self.move64(dst, old);
    }

    fn memory_fence(&mut self) {
        self.asm.dmb(Barrier::Ish);
    }

    fn store_fence(&mut self) {
        self.asm.dmb(Barrier::Ishst);
    }

    fn load_fence(&mut self) {
        self.asm.dmb(Barrier::Ishld);
    }
}
