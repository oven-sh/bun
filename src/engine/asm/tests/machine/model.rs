//! The state on which a test says what an operation does.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Amount, Memory, Reg, Src};

use super::memory;
use super::values::{mask, sign_extend};

#[repr(C, align(16))]
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Registers {
    pub(crate) fprs: [u128; 32],
    pub(crate) gprs: [u64; 32],
    pub(crate) host_stack: u64,
}

impl Registers {
    pub(crate) const HOST_STACK: i32 = std::mem::offset_of!(Self, host_stack) as i32;

    pub(crate) fn offset_of_gpr(reg: Gpr) -> i32 {
        std::mem::offset_of!(Self, gprs) as i32 + 8 * i32::from(reg.number())
    }

    pub(crate) fn offset_of_fpr(reg: Fpr) -> i32 {
        std::mem::offset_of!(Self, fprs) as i32 + 16 * i32::from(reg.number())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Outcome {
    FallsThrough,
    Branches,
    Either,
}

impl From<bool> for Outcome {
    fn from(branches: bool) -> Self {
        if branches {
            Self::Branches
        } else {
            Self::FallsThrough
        }
    }
}

impl From<()> for Outcome {
    fn from((): ()) -> Self {
        Self::FallsThrough
    }
}

/// What the interface leaves open.
#[derive(Clone, Copy)]
pub(crate) enum Unspecified {
    All(Reg),
    IfBranched(Gpr),
    WithinWidth(Gpr, Width),
    AboveFloat(Fpr, FloatWidth),
    WhichQuietNan(Fpr, FloatWidth),
    WhichHalfNan(Gpr),
}

pub(crate) struct Machine {
    pub(crate) registers: Registers,
    pub(crate) unspecified: Vec<Unspecified>,
    pub(crate) written: RegisterSet,
}

pub(crate) fn quiet_nan_bits(width: FloatWidth) -> u64 {
    match width {
        FloatWidth::F32 => 0x7fc0_0000,
        FloatWidth::F64 => 0x7ff8 << 48,
    }
}

impl Machine {
    pub(crate) fn get64(&self, reg: Gpr) -> u64 {
        self.registers.gprs[usize::from(reg.number())]
    }

    pub(crate) fn set64(&mut self, reg: Gpr, value: u64) {
        self.written.insert(reg);
        self.registers.gprs[usize::from(reg.number())] = value;
    }

    pub(crate) fn get(&self, width: Width, reg: Gpr) -> u64 {
        self.get64(reg) & mask(width.size())
    }

    pub(crate) fn get_signed(&self, width: Width, reg: Gpr) -> i64 {
        sign_extend(width.size(), self.get64(reg))
    }

    pub(crate) fn set(&mut self, width: Width, reg: Gpr, value: u64) {
        self.set64(reg, value & mask(width.size()));
    }

    pub(crate) fn address(&self, memory: impl Into<Memory>) -> usize {
        let address = match memory.into() {
            Memory::Address(address) => address,
            Memory::Absolute(address) => return address.0,
        };
        let index = address
            .index()
            .map_or(0, |(index, scale)| self.get64(index) << scale.log2());
        self.get64(address.base())
            .wrapping_add(index)
            .wrapping_add_signed(address.offset().into()) as usize
    }

    pub(crate) fn load_vector(&self, src: impl Into<Memory>) -> u128 {
        let mut bytes = [0; 16];
        memory::read(self.address(src), &mut bytes);
        u128::from_le_bytes(bytes)
    }

    pub(crate) fn store_vector(&mut self, dst: impl Into<Memory>, value: u128) {
        memory::write(self.address(dst), &value.to_le_bytes());
    }

    pub(crate) fn load(&self, size: Size, src: impl Into<Memory>) -> u64 {
        self.load_vector(src) as u64 & mask(size)
    }

    pub(crate) fn store(&mut self, size: Size, dst: impl Into<Memory>, value: u64) {
        let bytes = value.to_le_bytes();
        memory::write(self.address(dst), &bytes[..size.bytes().into()]);
    }

    pub(crate) fn read(&self, width: Width, src: impl Into<Src>) -> u64 {
        match src.into() {
            Src::Reg(reg) => self.get(width, reg),
            Src::Imm(value) | Src::Untrusted(value) => value as u64 & mask(width.size()),
            Src::Mem(memory) => self.load(width.size(), memory),
        }
    }

    pub(crate) fn amount(&self, width: Width, amount: Amount) -> u32 {
        let amount = match amount {
            Amount::Reg(reg) => self.get64(reg) as u32,
            Amount::Imm(amount) => amount.into(),
        };
        amount % u32::from(width.bits())
    }

    pub(crate) fn vector(&self, reg: Fpr) -> u128 {
        self.registers.fprs[usize::from(reg.number())]
    }

    pub(crate) fn set_vector(&mut self, reg: Fpr, value: u128) {
        self.written.insert(reg);
        self.registers.fprs[usize::from(reg.number())] = value;
    }

    pub(crate) fn float_bits(&self, width: FloatWidth, reg: Fpr) -> u64 {
        self.vector(reg) as u64 & mask(width.width().size())
    }

    /// Exact, but for what tells NaNs apart.
    pub(crate) fn float(&self, width: FloatWidth, reg: Fpr) -> f64 {
        let bits = self.float_bits(width, reg);
        match width {
            FloatWidth::F32 => f32::from_bits(bits as u32).into(),
            FloatWidth::F64 => f64::from_bits(bits),
        }
    }

    pub(crate) fn set_float_bits(&mut self, width: FloatWidth, reg: Fpr, bits: u64) {
        self.set_vector(reg, (bits & mask(width.width().size())).into());
        self.unspecified.push(Unspecified::AboveFloat(reg, width));
    }

    /// The result of arithmetic, which is rounded to the width.
    pub(crate) fn set_float(&mut self, width: FloatWidth, reg: Fpr, value: f64) {
        self.set_float_bits(width, reg, super::values::float_bits(width, value));
        if value.is_nan() {
            self.unspecified
                .push(Unspecified::WhichQuietNan(reg, width));
        }
    }

    pub(crate) fn forget(&mut self, reg: impl Into<Reg>) {
        self.unspecified.push(Unspecified::All(reg.into()));
    }

    /// Takes from `actual` what may be anything.
    pub(crate) fn accept(&mut self, actual: &Registers, branched: bool) {
        let gpr = |reg: Gpr| actual.gprs[usize::from(reg.number())];
        let fpr = |reg: Fpr| actual.fprs[usize::from(reg.number())];
        for index in 0..self.unspecified.len() {
            match self.unspecified[index] {
                Unspecified::All(reg) if reg.index() < 32 => self.set64(reg.gpr(), gpr(reg.gpr())),
                Unspecified::All(reg) => self.set_vector(reg.fpr(), fpr(reg.fpr())),
                Unspecified::IfBranched(reg) if branched => self.set64(reg, gpr(reg)),
                Unspecified::IfBranched(_) => {}
                Unspecified::WithinWidth(reg, width) => self.set(width, reg, gpr(reg)),
                Unspecified::AboveFloat(reg, width) => {
                    let float = u128::from(mask(width.width().size()));
                    self.set_vector(reg, self.vector(reg) & float | fpr(reg) & !float);
                }
                Unspecified::WhichQuietNan(reg, width) => {
                    let quiet = quiet_nan_bits(width);
                    if fpr(reg) as u64 & quiet == quiet {
                        self.set_vector(reg, fpr(reg));
                    }
                }
                Unspecified::WhichHalfNan(reg) => {
                    if gpr(reg) & !0x81ff == 0x7e00 {
                        self.set64(reg, gpr(reg));
                    }
                }
            }
        }
    }
}
