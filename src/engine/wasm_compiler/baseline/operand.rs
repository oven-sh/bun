//! Values on the operand stack, and how each kind of value is moved.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Reg, RegOrImm};
use bun_engine_wasm_format::{ValKind, ValType};

use super::Function;

/// A type and a [`Place`] in two words, which are passed in registers.
#[derive(Clone, Copy)]
pub(super) struct Operand {
    head: u64,
    payload: u64,
}

#[derive(Clone, Copy)]
pub(super) enum Place {
    /// One of 32 bits has the upper half clear. It is no vector.
    Constant(u64),
    /// On the stack, nothing else is in the register.
    Register(Reg),
    /// What the local holds now.
    Local(u32),
    /// At this offset in the frame.
    Slot(i32),
    /// What a local of type `i32` holds now, plus a short constant.
    Sum(u32, i32),
}

impl Operand {
    const CONSTANT: u64 = 0;
    const REGISTER: u64 = 1;
    const LOCAL: u64 = 2;
    const SLOT: u64 = 3;
    const SUM: u64 = Self::LOCAL | 4;
    const PLACE_MASK: u64 = 7;
    const TYPE_SHIFT: u32 = 32;

    #[inline(always)]
    const fn new(ty: ValType, place: u64, payload: u64) -> Self {
        Self {
            head: (ty.to_bits() as u64) << Self::TYPE_SHIFT | place,
            payload,
        }
    }

    #[inline(always)]
    pub(super) const fn of_bits(ty: ValType, bits: u64) -> Self {
        Self::new(ty, Self::CONSTANT, bits)
    }

    #[inline(always)]
    pub(super) fn int(width: Width, value: u64) -> Self {
        match width {
            Width::W32 => Self::of_bits(ValType::I32, u64::from(value as u32)),
            Width::W64 => Self::of_bits(ValType::I64, value),
        }
    }

    #[inline(always)]
    pub(super) fn in_register(ty: ValType, reg: impl Into<Reg>) -> Self {
        Self::new(ty, Self::REGISTER, reg.into().index() as u64)
    }

    #[inline(always)]
    pub(super) fn of_local(ty: ValType, local: u32) -> Self {
        Self::new(ty, Self::LOCAL, local.into())
    }

    #[inline(always)]
    pub(super) fn sum(local: u32, addend: i32) -> Option<Self> {
        let payload = u64::from(addend as u32) << 32 | u64::from(local);
        let is_short = addend.unsigned_abs() < 1 << 23;
        is_short.then_some(Self::new(ValType::I32, Self::SUM, payload))
    }

    #[inline(always)]
    pub(super) fn in_slot(ty: ValType, offset: i32) -> Self {
        Self::new(ty, Self::SLOT, offset as u64)
    }

    #[inline(always)]
    pub(super) fn ty(self) -> ValType {
        ValType::from_bits((self.head >> Self::TYPE_SHIFT) as u32)
    }

    #[inline(always)]
    pub(super) fn kind(self) -> ValKind {
        self.ty().kind()
    }

    #[inline(always)]
    pub(super) fn place(self) -> Place {
        match self.head & Self::PLACE_MASK {
            Self::CONSTANT => Place::Constant(self.payload),
            Self::REGISTER => Place::Register(self.register()),
            Self::LOCAL => Place::Local(self.payload as u32),
            Self::SLOT => Place::Slot(self.payload as i32),
            _ => Place::Sum(self.payload as u32, (self.payload >> 32) as i32),
        }
    }

    /// The value takes up the same place as one of type `ty`.
    #[inline(always)]
    pub(super) fn with_type(self, ty: ValType) -> Self {
        Self::new(ty, self.head & Self::PLACE_MASK, self.payload)
    }

    #[inline(always)]
    pub(super) fn constant(self) -> Option<u64> {
        (self.head & Self::PLACE_MASK == Self::CONSTANT).then_some(self.payload)
    }

    /// It is in one.
    #[inline(always)]
    pub(super) fn register(self) -> Reg {
        debug_assert!(self.head & Self::PLACE_MASK == Self::REGISTER);
        Reg::from_index(self.payload as usize % Reg::COUNT)
    }

    #[inline(always)]
    pub(super) fn is_local(self, local: u32) -> bool {
        self.head & Self::PLACE_MASK == Self::LOCAL && self.payload == local.into()
    }

    #[inline(always)]
    pub(super) fn depends_on(self, local: u32) -> bool {
        self.head & Self::SLOT == Self::LOCAL && self.payload as u32 == local
    }
}

#[inline(always)]
pub(super) fn bank(kind: ValKind) -> Bank {
    match kind {
        ValKind::F32 | ValKind::F64 | ValKind::V128 => Bank::Fpr,
        ValKind::I32 | ValKind::I64 | ValKind::Ref => Bank::Gpr,
    }
}

#[inline(always)]
pub(super) fn untrusted(bits: u64) -> RegOrImm {
    Untrusted(bits).into()
}

#[cfg(target_arch = "x86_64")]
const SCRATCH_GPR: Gpr = abi::SCRATCH_GPR;
#[cfg(target_arch = "aarch64")]
const SCRATCH_GPR: Gpr = abi::SCRATCH_GPRS[0];
const SCRATCH_FPR: Fpr = abi::SCRATCH_FPRS[0];

/// The one that moves, loads and stores leave alone.
pub(super) fn scratch(bank: Bank) -> Reg {
    match bank {
        Bank::Gpr => SCRATCH_GPR.into(),
        Bank::Fpr => SCRATCH_FPR.into(),
    }
}

impl Function<'_> {
    #[cfg(target_arch = "x86_64")]
    #[inline(always)]
    pub(super) fn frame_address(&self, offset: i32) -> Address {
        Address::new(abi::FRAME_POINTER, offset)
    }

    /// Positive offsets reach further.
    #[cfg(target_arch = "aarch64")]
    #[inline(always)]
    pub(super) fn frame_address(&self, offset: i32) -> Address {
        if offset >= -256 {
            Address::new(abi::FRAME_POINTER, offset)
        } else {
            Address::new(abi::STACK_POINTER, self.stack_depth as i32 + offset)
        }
    }

    pub(super) fn load(&mut self, kind: ValKind, dst: Reg, src: Address) {
        match kind {
            ValKind::I32 => self.masm.load32(dst.gpr(), src),
            ValKind::I64 | ValKind::Ref => self.masm.load64(dst.gpr(), src),
            ValKind::F32 => self.masm.load_f32(dst.fpr(), src),
            ValKind::F64 => self.masm.load_f64(dst.fpr(), src),
            ValKind::V128 => self.masm.load_vector(dst.fpr(), src),
        }
    }

    pub(super) fn store(&mut self, kind: ValKind, dst: Address, src: Reg) {
        match kind {
            ValKind::I32 => self.masm.store32(dst, src.gpr()),
            ValKind::I64 | ValKind::Ref => self.masm.store64(dst, src.gpr()),
            ValKind::F32 => self.masm.store_f32(dst, src.fpr()),
            ValKind::F64 => self.masm.store_f64(dst, src.fpr()),
            ValKind::V128 => self.masm.store_vector(dst, src.fpr()),
        }
    }

    pub(super) fn copy(&mut self, kind: ValKind, dst: Reg, src: Reg) {
        match kind {
            ValKind::I32 => self.masm.move32(dst.gpr(), src.gpr()),
            ValKind::I64 | ValKind::Ref => self.masm.move64(dst.gpr(), src.gpr()),
            ValKind::F32 | ValKind::F64 => self.masm.move_float(dst.fpr(), src.fpr()),
            ValKind::V128 => self.masm.move_vector(dst.fpr(), src.fpr()),
        }
    }

    pub(super) fn move_constant(&mut self, kind: ValKind, dst: Reg, bits: u64) {
        match kind {
            ValKind::I32 | ValKind::I64 | ValKind::Ref => {
                self.masm.move64(dst.gpr(), Untrusted(bits));
            }
            ValKind::F32 => (self.masm).move_float_constant(FloatWidth::F32, dst.fpr(), bits),
            ValKind::F64 => (self.masm).move_float_constant(FloatWidth::F64, dst.fpr(), bits),
            ValKind::V128 => self.masm.move_vector_constant(dst.fpr(), bits.into()),
        }
    }

    pub(super) fn store_constant(&mut self, kind: ValKind, dst: Address, bits: u64) {
        match kind {
            ValKind::I32 | ValKind::F32 => self.masm.store32(dst, Untrusted(bits)),
            ValKind::I64 | ValKind::F64 | ValKind::Ref => self.masm.store64(dst, Untrusted(bits)),
            ValKind::V128 => unreachable!("vectors are not kept as constants"),
        }
    }

    pub(super) fn transfer(&mut self, kind: ValKind, dst: Address, src: Address) {
        match kind {
            ValKind::I32 | ValKind::F32 => self.masm.transfer32(dst, src),
            ValKind::I64 | ValKind::F64 | ValKind::Ref => self.masm.transfer64(dst, src),
            ValKind::V128 => {
                self.masm.load_vector(SCRATCH_FPR, src);
                self.masm.store_vector(dst, SCRATCH_FPR);
            }
        }
    }

    /// Where the value is now, if it is a [`Place::Local`]. The register may then be that of the local.
    #[inline(always)]
    pub(super) fn locate(&self, value: Operand) -> Operand {
        let Place::Local(local) = value.place() else {
            return value;
        };
        match self.register_of(local) {
            Some(reg) => Operand::in_register(value.ty(), reg),
            None => Operand::in_slot(value.ty(), self.locals[local as usize].offset),
        }
    }

    /// Takes no register.
    pub(super) fn store_operand(&mut self, dst: Address, value: Operand) {
        let kind = value.kind();
        match self.locate(value).place() {
            Place::Constant(bits) => self.store_constant(kind, dst, bits),
            Place::Register(reg) => self.store(kind, dst, reg),
            Place::Slot(offset) => self.transfer(kind, dst, self.frame_address(offset)),
            Place::Sum(local, addend) => {
                let base = self.register_of(local).unwrap_or_else(|| {
                    self.move_operand(SCRATCH_GPR.into(), Operand::of_local(ValType::I32, local));
                    SCRATCH_GPR.into()
                });
                (self.masm).compute_address(SCRATCH_GPR, Address::new(base.gpr(), addend));
                self.masm.store32(dst, SCRATCH_GPR);
            }
            Place::Local(_) => unreachable!(),
        }
    }

    pub(super) fn move_operand(&mut self, dst: Reg, value: Operand) {
        let kind = value.kind();
        match self.locate(value).place() {
            Place::Constant(bits) => self.move_constant(kind, dst, bits),
            Place::Register(reg) if reg == dst => {}
            Place::Register(reg) => self.copy(kind, dst, reg),
            Place::Slot(offset) => self.load(kind, dst, self.frame_address(offset)),
            Place::Sum(local, addend) => {
                let base = self.register_of(local).unwrap_or_else(|| {
                    self.move_operand(dst, Operand::of_local(ValType::I32, local));
                    dst
                });
                self.masm.add32(dst.gpr(), base.gpr(), addend);
            }
            Place::Local(_) => unreachable!(),
        }
    }
}
