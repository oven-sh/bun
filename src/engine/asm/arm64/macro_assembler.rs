//! Turns operands into what instructions take. The first scratch register is for data, the second for addresses.

use super::assembler::Assembler;
use super::constant::ConstantMove;
use super::immediate::{ArithmeticImm, signed};
use super::load_store::{AccessSize, Mem, PairMem};
use super::opcode::{AddSub, Extend, IndexExtend, MoveWide, ShiftOp};
use super::registers::{SP, ZR};
use crate::assembly::Scratch;
use crate::operand::{Absolute, Address, Memory, Scale, Size, Src, Width};
use crate::register::{Fpr, Gpr};

pub struct MacroAssembler {
    pub(super) asm: Assembler,
    pub(super) scratch: Scratch,
}

/// The bits of `value` that an operation of that width reads.
#[inline(always)]
pub(super) fn unsigned(width: Width, value: i64) -> u64 {
    match width {
        Width::W32 => (value as u32).into(),
        Width::W64 => value as u64,
    }
}

#[inline(always)]
pub(super) fn all_ones(width: Width) -> u64 {
    unsigned(width, -1)
}

#[inline(always)]
fn scale_fits(size: AccessSize, scale: Scale) -> bool {
    scale == Scale::One || scale.log2() == size.log2_bytes()
}

impl MacroAssembler {
    #[inline]
    pub fn assembler(&mut self) -> &mut Assembler {
        &mut self.asm
    }

    #[inline]
    pub(super) fn data_scratch(&self) -> Gpr {
        self.scratch.gprs[0].expect("the operation needs a scratch register")
    }

    #[inline]
    pub(super) fn address_scratch(&self) -> Gpr {
        self.scratch.gprs[1].expect("the operation needs a scratch register")
    }

    #[inline]
    pub(super) fn scratch_fpr(&self, index: usize) -> Fpr {
        self.scratch.fprs[index].expect("the operation needs a scratch register")
    }

    #[inline(always)]
    pub fn move_constant(&mut self, width: Width, dst: Gpr, value: i64) {
        match u16::try_from(value) {
            Ok(short) => self
                .asm
                .move_wide(MoveWide::Movz, Width::W32, dst, short, 0),
            Err(_) => self.move_long_constant(width, dst, value),
        }
    }

    fn move_long_constant(&mut self, width: Width, dst: Gpr, value: i64) {
        self.asm
            .move_constant(dst, ConstantMove::new(width, value as u64));
    }

    /// The zero register, or a scratch register other than `taken`.
    #[inline]
    pub(super) fn constant_beside(&mut self, taken: Gpr, width: Width, value: i64) -> Gpr {
        if unsigned(width, value) == 0 {
            return ZR;
        }
        let temp = self.scratch_beside(taken);
        self.move_constant(width, temp, value);
        temp
    }

    #[inline]
    pub(super) fn scratch_beside(&self, taken: Gpr) -> Gpr {
        if self.scratch.gprs[0] == Some(taken) {
            self.address_scratch()
        } else {
            self.data_scratch()
        }
    }

    /// Fills the rest of the first scratch register with zeros.
    #[inline(always)]
    pub(super) fn load_data(&mut self, size: Size, src: Memory) -> Gpr {
        let data = self.data_scratch();
        let src = self.mem_for_load(size, src, data);
        self.asm.ldr(data, src);
        data
    }

    /// The first scratch register unless the operand is in a register, which may be the zero register.
    #[inline(always)]
    pub(super) fn register_for(&mut self, width: Width, src: Src) -> Gpr {
        match src {
            Src::Reg(reg) => reg,
            Src::Imm(value) | Src::Untrusted(value) => self.constant_beside(ZR, width, value),
            Src::Mem(memory) => self.load_data(width.size(), memory),
        }
    }

    /// Any of the registers may be `sp` in an operation of 64 bits.
    #[inline(always)]
    pub(super) fn add_sub_registers(
        &mut self,
        op: AddSub,
        width: Width,
        dst: Gpr,
        lhs: Gpr,
        rhs: Gpr,
    ) {
        if dst == SP || lhs == SP || rhs == SP {
            self.add_sub_with_stack_pointer(op, dst, lhs, rhs);
        } else {
            self.asm.add_sub(op, width, dst, lhs, rhs);
        }
    }

    #[cold]
    fn add_sub_with_stack_pointer(&mut self, op: AddSub, dst: Gpr, mut lhs: Gpr, mut rhs: Gpr) {
        if rhs == SP && lhs != SP && op == AddSub::Add {
            core::mem::swap(&mut lhs, &mut rhs);
        }
        if rhs == SP {
            rhs = self.scratch_beside(lhs);
            self.asm.mov_sp(rhs, SP);
        }
        self.asm
            .add_sub_extended(op, Width::W64, dst, lhs, rhs, Extend::Uxtx, 0);
    }

    /// Leaves the flags and the first scratch register alone.
    #[inline(always)]
    pub fn add_constant(&mut self, width: Width, dst: Gpr, lhs: Gpr, value: i64) {
        match AddSub::Add.with_constant(width, value) {
            Some((op, imm)) => self.asm.add_sub_imm(op, width, dst, lhs, imm),
            None => self.add_long_constant(width, dst, lhs, value),
        }
    }

    fn add_long_constant(&mut self, width: Width, dst: Gpr, lhs: Gpr, value: i64) {
        let value = signed(width, value);
        let (constant, magnitude) = (ConstantMove::new(width, value as u64), value.unsigned_abs());
        let temp = if dst == lhs || dst == SP {
            self.scratch.gprs[1].filter(|&temp| temp != lhs)
        } else {
            Some(dst)
        };
        // A move does not wait for `lhs`.
        if (constant.instructions() > 1 || lhs == SP || temp.is_none())
            && let Some(high) = ArithmeticImm::new(magnitude & !0xfff)
            && let Some(low) = ArithmeticImm::new(magnitude & 0xfff)
        {
            let op = if value < 0 { AddSub::Sub } else { AddSub::Add };
            // A signal may arrive in between, and overwrite what is below the stack pointer.
            let partial = if dst == SP && lhs != SP {
                self.address_scratch()
            } else {
                dst
            };
            self.asm.add_sub_imm(op, width, partial, lhs, high);
            self.asm.add_sub_imm(op, width, dst, partial, low);
            return;
        }
        let temp = temp.expect("the operation needs a scratch register");
        self.asm.move_constant(temp, constant);
        self.add_sub_registers(AddSub::Add, width, dst, lhs, temp);
    }

    fn add_index(&mut self, dst: Gpr, base: Gpr, index: Gpr, scale: Scale) {
        let (op, width, amount) = (AddSub::Add, Width::W64, scale.log2());
        if dst == SP || base == SP {
            self.asm
                .add_sub_extended(op, width, dst, base, index, Extend::Uxtx, amount);
        } else {
            self.asm
                .add_sub_shifted(op, width, dst, base, index, ShiftOp::Lsl, amount);
        }
    }

    /// Leaves the flags and the first scratch register alone.
    pub(super) fn add_index_and_offset(&mut self, dst: Gpr, address: Address) {
        let Address {
            base,
            index,
            scale,
            offset,
        } = address;
        if offset == 0 {
            return self.add_index(dst, base, index, scale);
        }
        if dst == index {
            self.add_index(dst, base, index, scale);
            return self.add_constant(Width::W64, dst, dst, offset.into());
        }
        let partial = if dst == SP {
            self.address_scratch()
        } else {
            dst
        };
        self.add_constant(Width::W64, partial, base, offset.into());
        self.add_index(dst, partial, index, scale);
    }

    /// May overwrite the second scratch register.
    #[inline(always)]
    pub fn mem(&mut self, size: impl Into<AccessSize>, memory: impl Into<Memory>) -> Mem {
        self.mem_through(size.into(), memory.into(), None)
    }

    /// Prefers `dst` to the second scratch register.
    #[inline(always)]
    pub(super) fn mem_for_load(&mut self, size: Size, memory: impl Into<Memory>, dst: Gpr) -> Mem {
        self.mem_through(size.into(), memory.into(), Some(dst))
    }

    #[inline(always)]
    fn mem_through(&mut self, size: AccessSize, memory: Memory, temp: Option<Gpr>) -> Mem {
        match memory {
            Memory::Address(address) => {
                if let Some((index, scale)) = address.index() {
                    if address.offset == 0 && scale_fits(size, scale) {
                        let scaled = scale != Scale::One;
                        return Mem::indexed(size, address.base, index, IndexExtend::Lsl, scaled);
                    }
                } else if let Some(mem) = Mem::offset(size, address.base, address.offset.into()) {
                    return mem;
                }
                self.in_steps(size, address, temp)
            }
            Memory::Absolute(address) => self.absolute(size, address, temp),
        }
    }

    fn absolute(&mut self, size: AccessSize, address: Absolute, temp: Option<Gpr>) -> Mem {
        let temp = temp.unwrap_or_else(|| self.address_scratch());
        let (address, low) = (address.0 as i64, address.0 as i64 & 0xffff);
        let (mem, base) = match Mem::scaled(size, temp, low) {
            Some(mem) => (mem, address - low),
            None => (Mem::at(size, temp), address),
        };
        self.move_constant(Width::W64, temp, base);
        mem
    }

    fn in_steps(&mut self, size: AccessSize, address: Address, temp: Option<Gpr>) -> Mem {
        let Address {
            base, index, scale, ..
        } = address;
        let offset = i64::from(address.offset);
        let temp = match temp {
            Some(temp) if !address.uses(temp) => temp,
            _ => self.address_scratch(),
        };
        if !address.has_index() {
            return self.distant(size, base, offset, temp);
        }
        let near = Mem::offset(size, temp, offset);
        let adds_at_once = AddSub::Add.with_constant(Width::W64, offset).is_some();
        if scale_fits(size, scale) && (adds_at_once || near.is_none()) {
            self.add_constant(Width::W64, temp, base, offset);
            let scaled = scale != Scale::One;
            return Mem::indexed(size, temp, index, IndexExtend::Lsl, scaled);
        }
        if let Some(mem) = near {
            self.add_index(temp, base, index, scale);
            return mem;
        }
        if let Some(mem) = Mem::offset(size, temp, offset & 0xfff)
            && let Some((op, rest)) = AddSub::Add.with_constant(Width::W64, offset & !0xfff)
        {
            self.add_index(temp, base, index, scale);
            self.asm.add_sub_imm(op, Width::W64, temp, temp, rest);
            return mem;
        }
        self.add_index_and_offset(temp, address);
        Mem::at(size, temp)
    }

    fn distant(&mut self, size: AccessSize, base: Gpr, offset: i64, temp: Gpr) -> Mem {
        let constant = ConstantMove::new(Width::W64, offset as u64);
        if constant.instructions() > 1
            && let Some(mem) = Mem::offset(size, temp, offset & 0xfff)
            && let Some((op, rest)) = AddSub::Add.with_constant(Width::W64, offset & !0xfff)
        {
            self.asm.add_sub_imm(op, Width::W64, temp, base, rest);
            return mem;
        }
        self.asm.move_constant(temp, constant);
        Mem::indexed(size, base, temp, IndexExtend::Lsl, false)
    }

    /// May overwrite the second scratch register.
    #[inline]
    pub(super) fn pair_mem(&mut self, size: impl Into<AccessSize>, address: Address) -> PairMem {
        let size = size.into();
        if !address.has_index()
            && let Some(mem) = PairMem::offset(size, address.base, address.offset.into())
        {
            return mem;
        }
        self.pair_in_steps(size, address)
    }

    fn pair_in_steps(&mut self, size: AccessSize, address: Address) -> PairMem {
        let temp = self.address_scratch();
        if let Some(mem) = PairMem::offset(size, temp, address.offset.into()) {
            self.add_index(temp, address.base, address.index, address.scale);
            return mem;
        }
        let base = self.base_register(address);
        PairMem::offset(size, base, 0).unwrap()
    }

    /// A register that holds the address, for the instructions that take no offset. It may be `sp` or the second
    /// scratch register.
    pub fn base_register(&mut self, address: Address) -> Gpr {
        if !address.has_index() && address.offset == 0 {
            return address.base;
        }
        let temp = self.address_scratch();
        if address.has_index() {
            self.add_index_and_offset(temp, address);
        } else {
            self.add_constant(Width::W64, temp, address.base, address.offset.into());
        }
        temp
    }
}
