use super::abi;
use super::assembler::{Assembler, GprMem, Rm};
use super::opcode::{Alu, BitCount, BitTest, Cc, ShiftOp, ShiftX, Sse, SseLoad, SseStore, Unary};
use super::registers::{RAX, RBP, RCX, RDX, RSP};
use crate::assembly::{MacroAssembly, Options, Scratch};
use crate::blinding::Blinding;
use crate::features::X64Features;
use crate::label::{Code, CodeTooLarge, Label, Target};
use crate::operand::{
    Absolute, Address, Amount, AtomicOp, Cond, Memory, RegOrImm, RegOrMem, ResultCond, Scale,
    Shift, Sign, Size, Src, TestCond, Width,
};
use crate::register::{Fpr, Gpr, RegisterSet};

pub struct MacroAssembler {
    pub(super) asm: Assembler,
    scratch: Scratch,
    blinding: Blinding,
}

const USUAL_SCRATCH: Scratch = Scratch {
    gprs: [Some(abi::SCRATCH_GPR), None],
    fprs: [Some(abi::SCRATCH_FPRS[0]), Some(abi::SCRATCH_FPRS[1])],
};

/// What the second operand of most instructions can be.
#[derive(Clone, Copy)]
enum Operand {
    Reg(Gpr),
    Mem(Address),
    Imm(i32),
}

/// What an instruction with a destination in memory can read.
#[derive(Clone, Copy)]
enum Stored {
    Reg(Gpr),
    Imm(i32),
}

#[inline]
fn short_immediate(size: Size, value: i64) -> Option<i32> {
    if size == Size::S64 {
        i32::try_from(value).ok()
    } else {
        Some(value as i32)
    }
}

impl MacroAssembler {
    #[inline]
    pub fn assembler(&mut self) -> &mut Assembler {
        &mut self.asm
    }

    #[inline]
    pub(super) fn scratch_gpr(&self) -> Gpr {
        self.scratch.gprs[0].expect("the operation needs a scratch register")
    }

    #[inline]
    pub(super) fn scratch_fpr(&self, index: usize) -> Fpr {
        self.scratch.fprs[index].expect("the operation needs a scratch register")
    }

    #[inline(always)]
    pub(super) fn address(&mut self, memory: impl Into<Memory>) -> Address {
        match memory.into() {
            Memory::Address(address) => address,
            Memory::Absolute(address) => self.absolute(address, None),
        }
    }

    fn absolute(&mut self, address: Absolute, base: Option<Gpr>) -> Address {
        if let Ok(offset) = i32::try_from(address.0) {
            return Assembler::absolute(offset);
        }
        let base = base.unwrap_or_else(|| self.scratch_gpr());
        self.asm.mov_imm(base, address.0 as i64);
        Address::new(base, 0)
    }

    #[inline(always)]
    fn address_for_load(&mut self, memory: impl Into<Memory>, dst: Gpr) -> Address {
        match memory.into() {
            Memory::Address(address) => address,
            Memory::Absolute(address) => self.absolute(address, Some(dst)),
        }
    }

    #[inline(always)]
    fn reg_or_mem(&mut self, operand: impl Into<RegOrMem>) -> GprMem {
        match operand.into() {
            RegOrMem::Reg(reg) => Rm::Reg(reg),
            RegOrMem::Mem(memory) => Rm::Mem(self.address(memory)),
        }
    }

    fn move_blinded(&mut self, width: Width, dst: Gpr, value: i64, key: u32) {
        match width {
            Width::W32 => {
                self.asm.mov_imm(dst, (value as u32 ^ key).into());
                self.asm.alu_imm(Alu::Xor, Size::S32, dst, key as i32);
            }
            Width::W64 => {
                let rotation = key % 63 + 1;
                self.asm.mov_imm(dst, value.rotate_left(rotation));
                self.asm
                    .shift_imm(ShiftOp::Ror, Size::S64, dst, rotation as u8);
            }
        }
    }

    #[inline]
    fn constant(&mut self, size: Size, value: i64) -> Stored {
        if let Some(short) = short_immediate(size, value) {
            return Stored::Imm(short);
        }
        let scratch = self.scratch_gpr();
        self.asm.mov_imm(scratch, value);
        Stored::Reg(scratch)
    }

    fn untrusted_constant(&mut self, size: Size, value: i64) -> Stored {
        if let Some(scratch) = self.scratch.gprs[0]
            && size >= Size::S32
            && let Some(key) = self.blinding.key_for(size.width(), value)
        {
            self.move_blinded(size.width(), scratch, value, key);
            return Stored::Reg(scratch);
        }
        self.constant(size, value)
    }

    #[inline(always)]
    fn stored(&mut self, size: Size, src: impl Into<RegOrImm>) -> Stored {
        match src.into() {
            RegOrImm::Reg(reg) => Stored::Reg(reg),
            RegOrImm::Imm(value) => self.constant(size, value),
            RegOrImm::Untrusted(value) => self.untrusted_constant(size, value),
        }
    }

    #[inline(always)]
    fn operand(&mut self, width: Width, src: impl Into<Src>) -> Operand {
        let stored = match src.into() {
            Src::Reg(reg) => return Operand::Reg(reg),
            Src::Mem(memory) => return Operand::Mem(self.address(memory)),
            Src::Imm(value) => self.constant(width.size(), value),
            Src::Untrusted(value) => self.untrusted_constant(width.size(), value),
        };
        match stored {
            Stored::Reg(reg) => Operand::Reg(reg),
            Stored::Imm(value) => Operand::Imm(value),
        }
    }

    fn is_scratch_base(&self, address: Address) -> bool {
        self.scratch.gprs[0] == Some(address.base)
    }

    #[inline]
    pub(super) fn copy(&mut self, width: Width, dst: Gpr, src: Gpr) {
        if dst != src {
            self.asm.mov(width, dst, src);
        }
    }

    /// Only `op` touches the flags.
    #[inline(always)]
    fn commutative(&mut self, op: Alu, width: Width, dst: Gpr, lhs: Gpr, rhs: Operand) {
        let size = width.size();
        match rhs {
            Operand::Reg(rhs) if rhs == dst => self.asm.alu(op, size, dst, lhs),
            Operand::Reg(rhs) => {
                self.copy(width, dst, lhs);
                self.asm.alu(op, size, dst, rhs);
            }
            Operand::Imm(rhs) => {
                self.copy(width, dst, lhs);
                self.asm.alu_imm(op, size, dst, rhs);
            }
            Operand::Mem(rhs) if dst == lhs => self.asm.alu(op, size, dst, rhs),
            Operand::Mem(rhs) => {
                self.asm.mov(width, dst, rhs);
                self.asm.alu(op, size, dst, lhs);
            }
        }
    }

    /// Only `op` touches the flags.
    #[inline(always)]
    fn subtract(&mut self, op: Alu, width: Width, dst: Gpr, lhs: Gpr, rhs: Operand) {
        let mut rhs = match rhs {
            Operand::Reg(reg) => Rm::Reg(reg),
            Operand::Mem(address) => Rm::Mem(address),
            Operand::Imm(rhs) => {
                self.copy(width, dst, lhs);
                self.asm.alu_imm(op, width.size(), dst, rhs);
                return;
            }
        };
        if dst != lhs {
            if rhs.uses(dst) {
                let scratch = self.scratch_gpr();
                self.asm.mov(width, scratch, rhs);
                rhs = Rm::Reg(scratch);
            }
            self.asm.mov(width, dst, lhs);
        }
        self.asm.alu(op, width.size(), dst, rhs);
    }

    #[inline(always)]
    fn multiply(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: Operand) {
        match rhs {
            Operand::Reg(rhs) if rhs == dst => self.asm.imul(width, dst, lhs),
            Operand::Reg(rhs) => {
                self.copy(width, dst, lhs);
                self.asm.imul(width, dst, rhs);
            }
            Operand::Imm(rhs) => self.asm.imul_imm(width, dst, lhs, rhs),
            Operand::Mem(rhs) if dst == lhs => self.asm.imul(width, dst, rhs),
            Operand::Mem(rhs) => {
                self.asm.mov(width, dst, rhs);
                self.asm.imul(width, dst, lhs);
            }
        }
    }

    fn and_constant(&mut self, width: Width, dst: Gpr, lhs: Gpr, mask: i64) {
        let mask = if width == Width::W32 {
            (mask as u32).into()
        } else {
            mask
        };
        match mask {
            0xff => self.asm.movzx(Size::S8, dst, lhs),
            0xffff => self.asm.movzx(Size::S16, dst, lhs),
            0xffff_ffff => self.asm.mov(Width::W32, dst, lhs),
            0..0xffff_ffff => {
                self.commutative(Alu::And, Width::W32, dst, lhs, Operand::Imm(mask as i32))
            }
            _ => {
                let mask = self.operand(width, mask);
                self.commutative(Alu::And, width, dst, lhs, mask);
            }
        }
    }

    fn shift_by_register(&mut self, op: ShiftOp, width: Width, dst: Gpr, src: Gpr, amount: Gpr) {
        let without_rcx = match op {
            ShiftOp::Shl => Some(ShiftX::Shlx),
            ShiftOp::Shr => Some(ShiftX::Shrx),
            ShiftOp::Sar => Some(ShiftX::Sarx),
            ShiftOp::Rol | ShiftOp::Ror => None,
        };
        if let Some(op) = without_rcx
            && self.asm.has(X64Features::BMI2)
        {
            return self.asm.shiftx(op, width, dst, src, amount);
        }
        // A shift by zero may leave the upper half as it is.
        let size = width.size();
        if dst == RCX {
            let scratch = self.scratch_gpr();
            self.asm.mov(width, scratch, src);
            self.copy(Width::W32, RCX, amount);
            self.asm.shift_cl(op, size, scratch);
            self.asm.mov(width, RCX, scratch);
        } else if amount == RCX {
            self.move_int(width, dst, src);
            self.asm.shift_cl(op, size, dst);
        } else {
            let scratch = self.scratch_gpr();
            self.copy(Width::W64, scratch, RCX);
            self.asm.mov(Width::W32, RCX, amount);
            self.move_int(width, dst, if src == RCX { scratch } else { src });
            self.asm.shift_cl(op, size, dst);
            self.copy(Width::W64, RCX, scratch);
        }
    }

    fn divide(&mut self, sign: Sign, width: Width, lhs: Gpr, rhs: Gpr) {
        assert!(!Self::DIVISION_CLOBBERS.contains(rhs));
        self.copy(width, RAX, lhs);
        match sign {
            Sign::Signed => {
                self.asm.extend_sign_into_rdx(width);
                self.asm.unary(Unary::Idiv, width.size(), rhs);
            }
            Sign::Unsigned => {
                self.asm.alu(Alu::Xor, Size::S32, RDX, RDX);
                self.asm.unary(Unary::Div, width.size(), rhs);
            }
        }
    }

    fn multiply_into_rdx_rax(&mut self, sign: Sign, lhs: Gpr, rhs: Gpr) {
        assert!(!Self::DIVISION_CLOBBERS.contains(rhs));
        self.copy(Width::W64, RAX, lhs);
        self.asm.unary(
            if sign == Sign::Signed {
                Unary::Imul
            } else {
                Unary::Mul
            },
            Size::S64,
            rhs,
        );
    }

    /// `if_zero` is what the scan would give for the bit past the last.
    fn scan_bits(&mut self, op: BitCount, width: Width, dst: Gpr, src: Gpr, if_zero: u8) {
        let scratch = self.scratch_gpr();
        self.asm.mov_imm(scratch, if_zero.into());
        self.asm.bit_count(op, width, dst, src);
        self.asm.cmov(Cc::E, Width::W32, dst, scratch);
    }

    /// Returns a register that holds the shifted value and is not `keep`.
    fn shifted(
        &mut self,
        width: Width,
        dst: Gpr,
        keep: Gpr,
        src: Gpr,
        shift: Shift,
        amount: u8,
    ) -> Gpr {
        let shifted = if dst == keep { self.scratch_gpr() } else { dst };
        self.shift(shift, width, shifted, src, amount);
        shifted
    }

    #[inline(always)]
    fn update_memory(&mut self, op: Alu, size: Size, dst: Memory, src: RegOrImm) {
        let address = self.address(dst);
        let src = match src {
            RegOrImm::Imm(value) | RegOrImm::Untrusted(value) if self.is_scratch_base(address) => {
                match short_immediate(size, value) {
                    Some(short) => Stored::Imm(short),
                    None => return self.update_memory_in_a_vector_register(op, address, value),
                }
            }
            _ => self.stored(size, src),
        };
        match src {
            Stored::Reg(src) => self.asm.alu_mem(op, size, address, src),
            Stored::Imm(src) => self.asm.alu_imm(op, size, address, src),
        }
    }

    #[cold]
    fn update_memory_in_a_vector_register(&mut self, op: Alu, address: Address, value: i64) {
        let op = match op {
            Alu::Add => Sse::Paddq,
            Alu::And => Sse::Pand,
            Alu::Or => Sse::Por,
            _ => unreachable!("no such update"),
        };
        let data = self.scratch_fpr(0);
        self.asm.sse_load(SseLoad::Movsd, data, address);
        self.sse_with_constant(op, data, data, (value as u64).into());
        self.asm.sse_store(SseStore::Movsd, address, data);
    }

    /// A signal may arrive at any time, and overwrite what is below the stack pointer.
    #[cold]
    fn set_stack_pointer(&mut self, op: Alu, lhs: Gpr, rhs: Operand) {
        let scratch = self.scratch_gpr();
        match (op, rhs) {
            (Alu::Sub, Operand::Imm(_)) => self.subtract(op, Width::W64, scratch, lhs, rhs),
            (Alu::Sub, Operand::Reg(rhs)) => {
                self.neg(Width::W64, scratch, rhs);
                self.asm.alu(Alu::Add, Size::S64, scratch, lhs);
            }
            (Alu::Sub, Operand::Mem(rhs)) => {
                self.asm.mov(Width::W64, scratch, rhs);
                return self.set_stack_pointer(op, lhs, Operand::Reg(scratch));
            }
            _ => self.commutative(op, Width::W64, scratch, lhs, rhs),
        }
        self.asm.mov(Width::W64, RSP, scratch);
    }

    fn store_long_constant_at_absolute(&mut self, dst: Absolute, value: i64) {
        let (gpr, fpr) = (self.scratch_gpr(), self.scratch_fpr(0));
        self.asm.mov_imm(gpr, value);
        self.asm.movd_to_xmm(Width::W64, fpr, gpr);
        let dst = self.address(dst);
        self.asm.sse_store(SseStore::Movsd, dst, fpr);
    }

    #[inline(always)]
    fn set_flags_for_compare(&mut self, width: Width, lhs: RegOrMem, rhs: Src) {
        let size = width.size();
        match lhs {
            RegOrMem::Reg(lhs) => match self.operand(width, rhs) {
                Operand::Reg(rhs) => self.asm.alu(Alu::Cmp, size, lhs, rhs),
                Operand::Mem(rhs) => self.asm.alu(Alu::Cmp, size, lhs, rhs),
                Operand::Imm(0) => self.asm.test(size, lhs, lhs),
                Operand::Imm(rhs) => self.asm.alu_imm(Alu::Cmp, size, lhs, rhs),
            },
            RegOrMem::Mem(lhs) => match rhs {
                Src::Reg(rhs) => self.update_memory(Alu::Cmp, size, lhs, RegOrImm::Reg(rhs)),
                Src::Imm(rhs) | Src::Untrusted(rhs)
                    if matches!(lhs, Memory::Absolute(_))
                        && short_immediate(size, rhs).is_none() =>
                {
                    let scratch = self.scratch_gpr();
                    self.load(size, scratch, lhs);
                    let rhs = self.asm.constant(u128::from(rhs as u64), 8);
                    self.asm.alu(Alu::Cmp, size, scratch, rhs);
                }
                Src::Imm(rhs) => self.update_memory(Alu::Cmp, size, lhs, RegOrImm::Imm(rhs)),
                Src::Untrusted(rhs) => {
                    self.update_memory(Alu::Cmp, size, lhs, RegOrImm::Untrusted(rhs))
                }
                Src::Mem(_) => unreachable!("two operands in memory"),
            },
        }
    }

    #[inline(always)]
    pub(super) fn set_flags_for_test(
        &mut self,
        width: Width,
        cond: TestCond,
        value: RegOrMem,
        mask: RegOrImm,
    ) -> Cc {
        let value = self.reg_or_mem(value);
        if let RegOrImm::Imm(mask) = mask {
            return self.test_constant(width, cond, value, mask);
        }
        if let (RegOrImm::Untrusted(mask), Rm::Mem(address)) = (mask, value)
            && self.is_scratch_base(address)
        {
            return self.test_constant(width, cond, value, mask);
        }
        match self.stored(width.size(), mask) {
            Stored::Reg(mask) => self.asm.test(width.size(), value, mask),
            Stored::Imm(mask) => self.asm.test_imm(width.size(), value, mask),
        }
        cond.into()
    }

    fn test_constant(&mut self, width: Width, cond: TestCond, value: GprMem, mask: i64) -> Cc {
        let size = width.size();
        let bits = if width == Width::W32 {
            u64::from(mask as u32)
        } else {
            mask as u64
        };
        if bits == u64::MAX >> (64 - width.bits()) {
            match value {
                Rm::Reg(reg) => self.asm.test(size, reg, reg),
                Rm::Mem(address) => self.asm.alu_imm(Alu::Cmp, size, address, 0),
            }
            return cond.into();
        }
        if matches!(cond, TestCond::Zero | TestCond::NonZero) {
            let byte = bits.trailing_zeros() / 8 % 8;
            let from_byte = bits >> (byte * 8);
            match value {
                Rm::Mem(address) if from_byte <= 0xff && address.offset <= i32::MAX - 8 => {
                    self.asm
                        .test_imm(Size::S8, address.plus(byte as i32), from_byte as i32);
                    return cond.into();
                }
                _ if bits <= 0xff => {
                    self.asm.test_imm(Size::S8, value, bits as i32);
                    return cond.into();
                }
                _ if bits <= u32::MAX.into() => {
                    self.asm.test_imm(Size::S32, value, bits as i32);
                    return cond.into();
                }
                _ if bits.is_power_of_two() => {
                    self.asm
                        .bit_test_imm(BitTest::Bt, width, value, bits.trailing_zeros() as u8);
                    return carry_for(cond);
                }
                _ => {}
            }
        }
        match (short_immediate(size, mask), value) {
            (Some(mask), _) => self.asm.test_imm(size, value, mask),
            (None, Rm::Mem(address)) if self.is_scratch_base(address) => {
                self.asm.mov(width, address.base, address);
                let mask = self.asm.constant(bits.into(), 8);
                self.asm.test(size, mask, address.base);
            }
            (None, _) => {
                let scratch = self.scratch_gpr();
                self.asm.mov_imm(scratch, mask);
                self.asm.test(size, value, scratch);
            }
        }
        cond.into()
    }

    #[inline(always)]
    pub(super) fn set_boolean(
        &mut self,
        dst: Gpr,
        dst_is_read: bool,
        set_flags: impl FnOnce(&mut Self) -> Cc,
    ) {
        if !dst_is_read {
            self.asm.alu(Alu::Xor, Size::S32, dst, dst);
        }
        let cc = set_flags(self);
        self.asm.setcc(cc, dst);
        if dst_is_read {
            self.asm.movzx(Size::S8, dst, dst);
        }
    }

    pub(super) fn select_on_flags(&mut self, cc: Cc, dst: Gpr, then: Gpr, or: Gpr) {
        if dst == then {
            self.asm.cmov(cc.inverted(), Width::W64, dst, or);
        } else {
            self.copy(Width::W64, dst, or);
            self.asm.cmov(cc, Width::W64, dst, then);
        }
    }

    fn zero_extend(&mut self, from: Size, dst: Gpr, src: Gpr) {
        match from {
            Size::S8 | Size::S16 => self.asm.movzx(from, dst, src),
            Size::S32 => self.asm.mov(Width::W32, dst, src),
            Size::S64 => self.copy(Width::W64, dst, src),
        }
    }
}

fn carry_for(cond: TestCond) -> Cc {
    match cond {
        TestCond::Zero => Cc::Ae,
        TestCond::NonZero => Cc::B,
        TestCond::Negative | TestCond::NonNegative => unreachable!("a bit has no sign"),
    }
}

#[inline]
fn reads(operand: Src, reg: Gpr) -> bool {
    match operand {
        Src::Reg(own) => own == reg,
        Src::Mem(Memory::Address(address)) => address.uses(reg),
        Src::Mem(Memory::Absolute(_)) | Src::Imm(_) | Src::Untrusted(_) => false,
    }
}

impl MacroAssembly for MacroAssembler {
    type Features = X64Features;

    const FRAME_POINTER: Gpr = abi::FRAME_POINTER;
    const STACK_POINTER: Gpr = abi::STACK_POINTER;
    const NUMBER_TAG: Gpr = abi::NUMBER_TAG;
    const NOT_CELL_MASK: Gpr = abi::NOT_CELL_MASK;
    const ARGUMENT_GPRS: &'static [Gpr] = &abi::ARGUMENT_GPRS;
    const ARGUMENT_FPRS: &'static [Fpr] = &abi::ARGUMENT_FPRS;
    const DIVISION_CLOBBERS: RegisterSet = RegisterSet::of(&[RAX, RDX], &[]);
    const ATOMIC_CLOBBERS: RegisterSet = RegisterSet::of(&[RAX], &[]);
    const PUSH_SIZE: i32 = 8;

    fn new(options: Options<X64Features>) -> Self {
        Self {
            asm: Assembler::new(options.features, options.shorten_jumps),
            scratch: USUAL_SCRATCH,
            blinding: Blinding::new(options.seed),
        }
    }

    #[inline]
    fn features(&self) -> X64Features {
        self.asm.features
    }

    fn finish(self) -> Result<Code, CodeTooLarge> {
        self.asm.finish()
    }

    fn take_code(&mut self) -> Result<Code, CodeTooLarge> {
        self.asm.take_code()
    }

    fn restart(&mut self, options: Options<X64Features>, spent: Option<Code>) {
        self.asm.buffer.restart(spent);
        (self.asm.features, self.asm.shorten_jumps) = (options.features, options.shorten_jumps);
        self.scratch = USUAL_SCRATCH;
        self.blinding = Blinding::new(options.seed);
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
            0,
            max_padding.min(alignment - 1) as u8,
        );
    }

    #[inline]
    fn jump(&mut self, target: Label) {
        self.asm.jmp(target);
    }

    #[inline]
    fn jump_indirect(&mut self, target: impl Into<RegOrMem>) {
        let target = self.reg_or_mem(target);
        self.asm.jmp_indirect(target);
    }

    fn jump_table(&mut self, index: Gpr, targets: &[Label]) {
        let table = self.asm.buffer.jump_table(targets);
        let scratch = self.scratch_gpr();
        self.move_label_address(scratch, table);
        self.asm.movsx(
            Size::S32,
            Width::W64,
            index,
            Address::indexed(scratch, index, Scale::Four, 0),
        );
        self.asm.alu(Alu::Add, Size::S64, index, scratch);
        self.asm.jmp_indirect(index);
    }

    #[inline]
    fn call(&mut self, target: Label) {
        self.asm.call(target);
    }

    #[inline]
    fn call_indirect(&mut self, target: impl Into<RegOrMem>) {
        let target = self.reg_or_mem(target);
        self.asm.call_indirect(target);
    }

    #[inline]
    fn ret(&mut self) {
        self.asm.ret();
    }

    fn move_label_address(&mut self, dst: Gpr, label: Label) {
        self.asm
            .lea(Width::W64, dst, Assembler::label_address(label));
    }

    fn breakpoint(&mut self) {
        self.asm.int3();
    }

    fn abort(&mut self, reason: u16) {
        self.asm.mov_imm(abi::SCRATCH_GPR, reason.into());
        self.asm.int3();
    }

    fn nop(&mut self) {
        self.asm.nops(1);
    }

    fn patchable_jump(&mut self, target: Label) -> Label {
        self.asm.patchable_transfer(false, target);
        self.mark()
    }

    fn patchable_call(&mut self, target: Label) -> Label {
        self.asm.patchable_transfer(true, target);
        self.mark()
    }

    fn patchable_move64(&mut self, dst: Gpr, value: u64) -> Label {
        self.asm.leave_replaceable_bytes();
        self.asm.movabs(dst, value);
        self.mark()
    }

    fn replaceable_point(&mut self) -> Label {
        self.asm.replaceable_point()
    }

    fn enter_frame(&mut self) {
        self.asm.push(RBP);
        self.asm.mov(Width::W64, RBP, RSP);
    }

    fn leave_frame(&mut self) {
        self.asm.leave();
    }

    fn push(&mut self, src: Gpr) {
        self.asm.push(src);
    }

    fn pop(&mut self, dst: Gpr) {
        self.asm.pop(dst);
    }

    fn push_pair(&mut self, low: Gpr, high: Gpr) {
        self.asm.push(high);
        self.asm.push(low);
    }

    fn pop_pair(&mut self, low: Gpr, high: Gpr) {
        assert!(low != high);
        self.asm.pop(low);
        self.asm.pop(high);
    }

    #[inline]
    fn move_int(&mut self, width: Width, dst: Gpr, src: impl Into<RegOrImm>) {
        let value = match src.into() {
            RegOrImm::Reg(src) => return self.zero_extend(width.size(), dst, src),
            RegOrImm::Imm(value) => value,
            RegOrImm::Untrusted(value) => {
                if let Some(key) = self.blinding.key_for(width, value) {
                    return self.move_blinded(width, dst, value, key);
                }
                value
            }
        };
        match if width == Width::W32 {
            (value as u32).into()
        } else {
            value
        } {
            0 => self.asm.alu(Alu::Xor, Size::S32, dst, dst),
            value => self.asm.mov_imm(dst, value),
        }
    }

    fn swap(&mut self, a: Gpr, b: Gpr) {
        if a != b {
            self.asm.xchg(Size::S64, a, b);
        }
    }

    #[inline]
    fn extend(&mut self, from: Size, sign: Sign, width: Width, dst: Gpr, src: Gpr) {
        assert!(from <= width.size());
        if sign == Sign::Unsigned || from == width.size() {
            self.zero_extend(from, dst, src);
        } else {
            self.asm.movsx(from, width, dst, src);
        }
    }

    #[inline]
    fn compute_address(&mut self, dst: Gpr, address: Address) {
        if address.has_index() || address.offset != 0 {
            self.asm.lea(Width::W64, dst, address);
        } else {
            self.copy(Width::W64, dst, address.base);
        }
    }

    #[inline]
    fn load(&mut self, size: Size, dst: Gpr, src: impl Into<Memory>) {
        let src = self.address_for_load(src, dst);
        match size {
            Size::S8 | Size::S16 => self.asm.movzx(size, dst, src),
            Size::S32 | Size::S64 => self.asm.mov(size.width(), dst, src),
        }
    }

    #[inline]
    fn load_signed(&mut self, size: Size, width: Width, dst: Gpr, src: impl Into<Memory>) {
        assert!(size <= width.size());
        let src = self.address_for_load(src, dst);
        if size == width.size() {
            self.asm.mov(width, dst, src);
        } else {
            self.asm.movsx(size, width, dst, src);
        }
    }

    #[inline]
    fn store(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        let (dst, mut src) = (dst.into(), src.into());
        if let (Memory::Absolute(dst), RegOrImm::Imm(value) | RegOrImm::Untrusted(value)) =
            (dst, src)
        {
            if short_immediate(size, value).is_none() {
                return self.store_long_constant_at_absolute(dst, value);
            }
            src = RegOrImm::Imm(value);
        }
        let dst = self.address(dst);
        match self.stored(size, src) {
            Stored::Reg(src) => self.asm.mov_store(size, dst, src),
            Stored::Imm(src) => self.asm.mov_store_imm(size, dst, src),
        }
    }

    fn load_pair(&mut self, width: Width, low: Gpr, high: Gpr, mut src: Address) {
        assert!(low != high);
        let next = width.size().bytes().into();
        if src.uses(low) && src.uses(high) {
            self.asm.lea(Width::W64, low, src);
            src = Address::new(low, 0);
        }
        if src.uses(low) {
            self.asm.mov(width, high, src.plus(next));
            self.asm.mov(width, low, src);
        } else {
            self.asm.mov(width, low, src);
            self.asm.mov(width, high, src.plus(next));
        }
    }

    fn store_pair(&mut self, width: Width, dst: Address, low: Gpr, high: Gpr) {
        self.asm.mov_store(width.size(), dst, low);
        self.asm
            .mov_store(width.size(), dst.plus(width.size().bytes().into()), high);
    }

    fn transfer(&mut self, size: Size, dst: Address, src: Address) {
        if dst != src {
            let scratch = self.scratch_gpr();
            self.load(size, scratch, src);
            self.asm.mov_store(size, dst, scratch);
        }
    }

    #[inline]
    fn add_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Alu::Add, size, dst.into(), src.into());
    }

    #[inline]
    fn and_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Alu::And, size, dst.into(), src.into());
    }

    #[inline]
    fn or_to_memory(&mut self, size: Size, dst: impl Into<Memory>, src: impl Into<RegOrImm>) {
        self.update_memory(Alu::Or, size, dst.into(), src.into());
    }

    fn prefetch(&mut self, address: Address) {
        self.asm.prefetcht0(address);
    }

    #[inline]
    fn add(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match self.operand(width, rhs) {
            Operand::Imm(0) => self.move_int(width, dst, lhs),
            Operand::Imm(rhs) if dst != lhs => self.asm.lea(width, dst, Address::new(lhs, rhs)),
            Operand::Reg(rhs) if dst != lhs && dst != rhs && (lhs, rhs) != (RSP, RSP) => {
                let (base, index) = if rhs == RSP { (rhs, lhs) } else { (lhs, rhs) };
                self.asm
                    .lea(width, dst, Address::indexed(base, index, Scale::One, 0));
            }
            rhs @ Operand::Mem(_) if dst == RSP && lhs != RSP => {
                self.set_stack_pointer(Alu::Add, lhs, rhs)
            }
            rhs => self.commutative(Alu::Add, width, dst, lhs, rhs),
        }
    }

    #[inline]
    fn sub(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match self.operand(width, rhs) {
            Operand::Imm(0) => self.move_int(width, dst, lhs),
            Operand::Imm(rhs) if dst != lhs && rhs != i32::MIN => {
                self.asm.lea(width, dst, Address::new(lhs, -rhs))
            }
            rhs if dst == RSP && lhs != RSP => self.set_stack_pointer(Alu::Sub, lhs, rhs),
            Operand::Reg(rhs) if dst == rhs && dst != lhs => {
                self.asm.unary(Unary::Neg, width.size(), dst);
                self.asm.alu(Alu::Add, width.size(), dst, lhs);
            }
            rhs => self.subtract(Alu::Sub, width, dst, lhs, rhs),
        }
    }

    #[inline]
    fn mul(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        let rhs = self.operand(width, rhs);
        self.multiply(width, dst, lhs, rhs);
    }

    #[inline]
    fn and(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        let rhs = rhs.into();
        if dst == RSP && lhs != RSP {
            let rhs = self.operand(width, rhs);
            return self.set_stack_pointer(Alu::And, lhs, rhs);
        }
        if let Src::Imm(mask) = rhs {
            return self.and_constant(width, dst, lhs, mask);
        }
        let rhs = self.operand(width, rhs);
        self.commutative(Alu::And, width, dst, lhs, rhs);
    }

    #[inline]
    fn or(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        let rhs = self.operand(width, rhs);
        self.commutative(Alu::Or, width, dst, lhs, rhs);
    }

    #[inline]
    fn xor(&mut self, width: Width, dst: Gpr, lhs: Gpr, rhs: impl Into<Src>) {
        match self.operand(width, rhs) {
            Operand::Imm(-1) => self.not(width, dst, lhs),
            rhs => self.commutative(Alu::Xor, width, dst, lhs, rhs),
        }
    }

    fn neg(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.copy(width, dst, src);
        self.asm.unary(Unary::Neg, width.size(), dst);
    }

    fn not(&mut self, width: Width, dst: Gpr, src: Gpr) {
        self.copy(width, dst, src);
        self.asm.unary(Unary::Not, width.size(), dst);
    }

    #[inline]
    fn shift(&mut self, shift: Shift, width: Width, dst: Gpr, src: Gpr, amount: impl Into<Amount>) {
        match amount.into() {
            Amount::Reg(amount) => self.shift_by_register(shift.into(), width, dst, src, amount),
            Amount::Imm(amount) => match amount % width.bits() {
                0 => self.move_int(width, dst, src),
                amount => {
                    self.copy(width, dst, src);
                    self.asm.shift_imm(shift.into(), width.size(), dst, amount);
                }
            },
        }
    }

    fn div(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.divide(sign, width, lhs, rhs);
        self.copy(width, dst, RAX);
    }

    fn rem(&mut self, sign: Sign, width: Width, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.divide(sign, width, lhs, rhs);
        self.copy(width, dst, RDX);
    }

    fn mul_high64(&mut self, sign: Sign, dst: Gpr, lhs: Gpr, rhs: Gpr) {
        self.multiply_into_rdx_rax(sign, lhs, rhs);
        self.copy(Width::W64, dst, RDX);
    }

    fn mul_wide64(&mut self, sign: Sign, low: Gpr, high: Gpr, lhs: Gpr, rhs: Gpr) {
        assert!(low != high);
        self.multiply_into_rdx_rax(sign, lhs, rhs);
        if (low, high) == (RDX, RAX) {
            self.swap(RAX, RDX);
        } else if low == RDX {
            self.copy(Width::W64, high, RDX);
            self.copy(Width::W64, low, RAX);
        } else {
            self.copy(Width::W64, low, RAX);
            self.copy(Width::W64, high, RDX);
        }
    }

    fn add128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]) {
        assert!(![dst[1], lhs[1], rhs[1]].contains(&dst[0]));
        self.commutative(Alu::Add, Width::W64, dst[0], lhs[0], Operand::Reg(rhs[0]));
        self.commutative(Alu::Adc, Width::W64, dst[1], lhs[1], Operand::Reg(rhs[1]));
    }

    fn sub128(&mut self, dst: [Gpr; 2], lhs: [Gpr; 2], rhs: [Gpr; 2]) {
        assert!(![dst[1], lhs[1], rhs[1]].contains(&dst[0]));
        self.subtract(Alu::Sub, Width::W64, dst[0], lhs[0], Operand::Reg(rhs[0]));
        self.subtract(Alu::Sbb, Width::W64, dst[1], lhs[1], Operand::Reg(rhs[1]));
    }

    fn count_leading_zeros(&mut self, width: Width, dst: Gpr, src: Gpr) {
        if self.asm.has(X64Features::LZCNT) {
            return self.asm.bit_count(BitCount::Lzcnt, width, dst, src);
        }
        self.scan_bits(BitCount::Bsr, width, dst, src, 2 * width.bits() - 1);
        self.asm
            .alu_imm(Alu::Xor, Size::S32, dst, i32::from(width.bits()) - 1);
    }

    fn count_trailing_zeros(&mut self, width: Width, dst: Gpr, src: Gpr) {
        if self.asm.has(X64Features::BMI1) {
            return self.asm.bit_count(BitCount::Tzcnt, width, dst, src);
        }
        self.scan_bits(BitCount::Bsf, width, dst, src, width.bits());
    }

    fn count_ones(&mut self, width: Width, dst: Gpr, src: Gpr) {
        if dst != src {
            // Some processors wait for the old value of the destination.
            self.asm.alu(Alu::Xor, Size::S32, dst, dst);
        }
        self.asm.bit_count(BitCount::Popcnt, width, dst, src);
    }

    fn swap_bytes(&mut self, size: Size, dst: Gpr, src: Gpr) {
        match size {
            Size::S8 => self.asm.movzx(size, dst, src),
            Size::S16 => {
                self.asm.movzx(size, dst, src);
                self.asm.shift_imm(ShiftOp::Rol, size, dst, 8);
            }
            Size::S32 | Size::S64 => {
                self.copy(size.width(), dst, src);
                self.asm.bswap(size.width(), dst);
            }
        }
    }

    fn extract_bits(&mut self, sign: Sign, width: Width, dst: Gpr, src: Gpr, first: u8, count: u8) {
        assert!(count != 0 && first + count <= width.bits());
        let above = width.bits() - first - count;
        if sign == Sign::Unsigned && above != 0 && count <= 32 {
            let shifted = if first == 0 { src } else { dst };
            if first != 0 {
                self.shift(Shift::RightLogical, width, dst, src, first);
            }
            return self.and_constant(width, dst, shifted, (1 << count) - 1);
        }
        let right = if sign == Sign::Signed {
            Shift::RightArithmetic
        } else {
            Shift::RightLogical
        };
        self.shift(Shift::Left, width, dst, src, above);
        if count != width.bits() {
            self.shift(right, width, dst, dst, width.bits() - count);
        }
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
        if shift == Shift::Left
            && let Some(scale) = Scale::from_log2(amount)
        {
            return self
                .asm
                .lea(width, dst, Address::indexed(lhs, rhs, scale, 0));
        }
        let shifted = self.shifted(width, dst, lhs, rhs, shift, amount);
        self.commutative(Alu::Add, width, dst, lhs, Operand::Reg(shifted));
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
        let shifted = self.shifted(width, dst, lhs, rhs, shift, amount);
        self.commutative(Alu::Xor, width, dst, lhs, Operand::Reg(shifted));
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
        self.set_flags_for_compare(width, lhs.into(), rhs.into());
        self.asm.jcc(cond.into(), target);
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
        let lhs = self.address(lhs);
        self.asm.alu_imm(Alu::Cmp, size, lhs, rhs);
        self.asm.jcc(cond.into(), target);
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
        let cc = self.set_flags_for_test(width, cond, value.into(), mask.into());
        self.asm.jcc(cc, target);
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
        let value = self.address(value);
        self.asm.test_imm(size, value, mask);
        self.asm.jcc(cond.into(), target);
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
        let cc = match bit.into() {
            Amount::Reg(bit) => {
                self.asm.bt(width, value, bit);
                carry_for(cond)
            }
            Amount::Imm(bit) => {
                assert!(matches!(cond, TestCond::Zero | TestCond::NonZero));
                self.test_constant(Width::W64, cond, Rm::Reg(value), 1 << (bit % width.bits()))
            }
        };
        self.asm.jcc(cc, target);
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
        let rhs = self.operand(width, rhs);
        self.commutative(Alu::Add, width, dst, lhs, rhs);
        self.asm.jcc(cond.into(), target);
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
        let rhs = self.operand(width, rhs);
        self.subtract(Alu::Sub, width, dst, lhs, rhs);
        self.asm.jcc(cond.into(), target);
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
        let rhs = self.operand(width, rhs);
        self.multiply(width, dst, lhs, rhs);
        self.asm.jcc(Cc::O, target);
    }

    fn branch_neg(&mut self, width: Width, cond: ResultCond, dst: Gpr, src: Gpr, target: Label) {
        assert!(!matches!(cond, ResultCond::Carry | ResultCond::NoCarry));
        self.neg(width, dst, src);
        self.asm.jcc(cond.into(), target);
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
        self.add_to_memory(width.size(), dst, src);
        self.asm.jcc(cond.into(), target);
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
        let (lhs, rhs) = (lhs.into(), rhs.into());
        self.set_boolean(dst, reads(lhs.into(), dst) || reads(rhs, dst), |masm| {
            masm.set_flags_for_compare(width, lhs, rhs);
            cond.into()
        });
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
        let lhs = self.address(lhs);
        self.set_boolean(dst, lhs.uses(dst), |masm| {
            masm.asm.alu_imm(Alu::Cmp, size, lhs, rhs);
            cond.into()
        });
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
        let (value, mask) = (value.into(), mask.into());
        self.set_boolean(
            dst,
            reads(value.into(), dst) || reads(mask.into(), dst),
            |masm| masm.set_flags_for_test(width, cond, value, mask),
        );
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
        let value = self.address(value);
        self.set_boolean(dst, value.uses(dst), |masm| {
            masm.asm.test_imm(size, value, mask);
            cond.into()
        });
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
        self.set_flags_for_compare(width, lhs.into(), rhs.into().into());
        self.select_on_flags(cond.into(), dst, then, or);
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
        self.select_on_flags(cc, dst, then, or);
    }

    fn atomic_load(&mut self, size: Size, dst: Gpr, src: Address) {
        self.load(size, dst, src);
    }

    fn atomic_store(&mut self, size: Size, dst: Address, src: Gpr) {
        let scratch = self.scratch_gpr();
        self.asm.mov(size.width(), scratch, src);
        self.asm.xchg(size, dst, scratch);
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
        assert!(dst != operand && !address.uses(dst));
        let width = size.width();
        let op = match op {
            AtomicOp::And => Alu::And,
            AtomicOp::Or => Alu::Or,
            AtomicOp::Xor => Alu::Xor,
            AtomicOp::Add | AtomicOp::Sub | AtomicOp::Exchange => {
                self.asm.mov(width, dst, operand);
                if op == AtomicOp::Sub {
                    self.asm.unary(Unary::Neg, width.size(), dst);
                }
                if op == AtomicOp::Exchange {
                    self.asm.xchg(size, address, dst);
                } else {
                    self.asm.lock();
                    self.asm.xadd(size, address, dst);
                }
                if size < Size::S32 {
                    self.asm.movzx(size, dst, dst);
                }
                return;
            }
        };
        assert!(
            operand != RAX
                && temp != RAX
                && !address.uses(RAX)
                && temp != operand
                && !address.uses(temp)
        );
        self.load(size, RAX, address);
        let again = self.here();
        self.asm.mov(width, temp, RAX);
        self.asm.alu(op, width.size(), temp, operand);
        self.asm.lock();
        self.asm.cmpxchg(size, address, temp);
        self.asm.jcc(Cc::Ne, again);
        self.copy(width, dst, RAX);
    }

    fn atomic_compare_exchange(
        &mut self,
        size: Size,
        dst: Gpr,
        address: Address,
        expected: Gpr,
        replacement: Gpr,
        _temp: Gpr,
    ) {
        assert!(replacement != RAX && !address.uses(RAX));
        self.copy(size.width(), RAX, expected);
        self.asm.lock();
        self.asm.cmpxchg(size, address, replacement);
        self.zero_extend(size, dst, RAX);
    }

    fn memory_fence(&mut self) {
        self.asm.lock();
        self.asm
            .alu_imm(Alu::Or, Size::S32, Address::new(RSP, 0), 0);
    }

    fn store_fence(&mut self) {}

    fn load_fence(&mut self) {}
}
