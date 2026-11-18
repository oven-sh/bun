use core::mem::take;

use super::FloatAssembly;
use crate::operand::Address;
use crate::register::{Bank, Fpr, Gpr, Reg, RegisterSet};

/// An argument of a C function. Addresses have no index.
#[derive(Clone, Copy, Debug)]
pub enum Argument {
    Gpr(Gpr),
    Fpr(Fpr),
    Imm(i64),
    Load32(Address),
    Load64(Address),
    LoadF64(Address),
    AddressOf(Address),
}

impl From<Gpr> for Argument {
    fn from(reg: Gpr) -> Self {
        Self::Gpr(reg)
    }
}

impl From<Fpr> for Argument {
    fn from(reg: Fpr) -> Self {
        Self::Fpr(reg)
    }
}

impl From<i32> for Argument {
    fn from(value: i32) -> Self {
        Self::Imm(value.into())
    }
}

impl From<u32> for Argument {
    fn from(value: u32) -> Self {
        Self::Imm(value.into())
    }
}

impl From<usize> for Argument {
    fn from(value: usize) -> Self {
        Self::Imm(value as i64)
    }
}

impl Argument {
    #[inline]
    fn is_float(&self) -> bool {
        matches!(self, Self::Fpr(_) | Self::LoadF64(_))
    }

    #[inline]
    fn source(&self) -> Option<Reg> {
        match *self {
            Self::Gpr(reg) => Some(reg.into()),
            Self::Fpr(reg) => Some(reg.into()),
            Self::Imm(_) => None,
            Self::Load32(address)
            | Self::Load64(address)
            | Self::LoadF64(address)
            | Self::AddressOf(address) => {
                assert!(!address.has_index());
                Some(address.base.into())
            }
        }
    }

    fn with_source(&self, reg: Reg) -> Self {
        let rebase = |address: Address| Address::new(reg.gpr(), address.offset);
        match *self {
            Self::Gpr(_) => Self::Gpr(reg.gpr()),
            Self::Fpr(_) => Self::Fpr(reg.fpr()),
            Self::Load32(address) => Self::Load32(rebase(address)),
            Self::Load64(address) => Self::Load64(rebase(address)),
            Self::AddressOf(address) => Self::AddressOf(rebase(address)),
            Self::Imm(_) | Self::LoadF64(_) => unreachable!("in no cycle"),
        }
    }
}

const MOST_IN_REGISTERS: usize = 16;

#[derive(Clone, Copy)]
struct Move {
    argument: u8,
    dst: Reg,
    /// What it has yet to read, or else `dst`.
    src: Reg,
}

/// Moves to registers that take place as if at once.
struct Moves {
    items: [Move; MOST_IN_REGISTERS],
    len: usize,
    /// What the moves read, apart from their own destinations.
    read: RegisterSet,
}

impl Moves {
    const NONE: Self = Self {
        items: [Move {
            argument: 0,
            dst: Reg::from_index(0),
            src: Reg::from_index(0),
        }; MOST_IN_REGISTERS],
        len: 0,
        read: RegisterSet::EMPTY,
    };

    #[inline]
    fn push(&mut self, item: Move) {
        if item.src != item.dst {
            self.read.insert(item.src);
        }
        self.items[self.len] = item;
        self.len += 1;
    }

    /// Each move reads one register at most, so a cycle that is opened with a scratch register unwinds before another
    /// needs it.
    #[inline]
    fn emit(&mut self, masm: &mut impl FloatAssembly, arguments: &[Argument]) {
        let mut opened = None;
        while self.len != 0 {
            let (len, read) = (take(&mut self.len), take(&mut self.read));
            for index in 0..len {
                let item = self.items[index];
                let argument = &arguments[usize::from(item.argument)];
                match opened {
                    _ if read.contains(item.dst) => self.push(item),
                    Some((reader, copy)) if reader == item.dst => {
                        move_one(masm, item.dst, &argument.with_source(copy))
                    }
                    _ => move_one(masm, item.dst, argument),
                }
            }
            if self.len == len {
                let first = &mut self.items[0];
                opened = Some((first.dst, copy_to_scratch(masm, first.src)));
                self.read.remove(first.src);
                first.src = first.dst;
            }
        }
    }
}

fn copy_to_scratch(masm: &mut impl FloatAssembly, src: Reg) -> Reg {
    const NEEDED: &str = "arguments are moved through a scratch register";
    match src.bank() {
        Bank::Gpr => {
            let copy = masm.scratch().gprs[0].expect(NEEDED);
            masm.move64(copy, src.gpr());
            copy.into()
        }
        Bank::Fpr => {
            let copy = masm.scratch().fprs[0].expect(NEEDED);
            masm.move_float(copy, src.fpr());
            copy.into()
        }
    }
}

pub trait CallAssembly: FloatAssembly {
    /// The bytes at the stack pointer that `move_arguments` writes.
    fn stack_size_of_arguments(arguments: &[Argument]) -> u32 {
        let floats = arguments
            .iter()
            .filter(|argument| argument.is_float())
            .count();
        let on_stack = floats.saturating_sub(Self::ARGUMENT_FPRS.len())
            + (arguments.len() - floats).saturating_sub(Self::ARGUMENT_GPRS.len());
        on_stack as u32 * 8
    }

    /// Puts the arguments where a C function finds them. Those that go on the stack are 64 bits wide.
    fn move_arguments(&mut self, arguments: &[Argument]) {
        let (mut gprs, mut fprs) = (Self::ARGUMENT_GPRS.iter(), Self::ARGUMENT_FPRS.iter());
        let mut moves = Moves::NONE;
        let mut slot = Address::new(Self::STACK_POINTER, 0);
        for (index, argument) in arguments.iter().enumerate() {
            let dst = if argument.is_float() {
                fprs.next().map(|&reg| reg.into())
            } else {
                gprs.next().map(|&reg| reg.into())
            };
            if let Some(dst) = dst {
                moves.push(Move {
                    argument: u8::try_from(index).unwrap(),
                    dst,
                    src: argument.source().unwrap_or(dst),
                });
                continue;
            }
            match *argument {
                Argument::Gpr(src) => self.store64(slot, src),
                Argument::Fpr(src) => self.store_f64(slot, src),
                Argument::Imm(value) => self.store64(slot, value),
                Argument::Load64(src) | Argument::LoadF64(src) => self.transfer64(slot, src),
                Argument::Load32(_) | Argument::AddressOf(_) => {
                    let temp =
                        self.scratch().gprs[0].expect("the operation needs a scratch register");
                    move_one(self, temp.into(), argument);
                    self.store64(slot, temp);
                }
            }
            slot = slot.plus(8);
        }
        moves.emit(self, arguments);
    }

    /// Stores 8 bytes of each general register and then `vector_bytes`, 8 or 16, of each of the others.
    fn store_registers(&mut self, registers: RegisterSet, vector_bytes: i32, mut dst: Address) {
        let mut gprs = registers.gprs();
        while let Some(low) = gprs.next() {
            if let Some(high) = gprs.next() {
                self.store_pair64(dst, low, high);
                dst = dst.plus(16);
            } else {
                self.store64(dst, low);
                dst = dst.plus(8);
            }
        }
        let mut fprs = registers.fprs();
        while let Some(low) = fprs.next() {
            match (fprs.next(), vector_bytes) {
                (Some(high), 8) => self.store_pair_f64(dst, low, high),
                (Some(high), _) => self.store_pair_vector(dst, low, high),
                (None, 8) => self.store_f64(dst, low),
                (None, _) => self.store_vector(dst, low),
            }
            dst = dst.plus(2 * vector_bytes);
        }
    }

    /// Undoes `store_registers`. `src` uses none of the registers.
    fn load_registers(&mut self, registers: RegisterSet, vector_bytes: i32, mut src: Address) {
        let mut gprs = registers.gprs();
        while let Some(low) = gprs.next() {
            if let Some(high) = gprs.next() {
                self.load_pair64(low, high, src);
                src = src.plus(16);
            } else {
                self.load64(low, src);
                src = src.plus(8);
            }
        }
        let mut fprs = registers.fprs();
        while let Some(low) = fprs.next() {
            match (fprs.next(), vector_bytes) {
                (Some(high), 8) => self.load_pair_f64(low, high, src),
                (Some(high), _) => self.load_pair_vector(low, high, src),
                (None, 8) => self.load_f64(low, src),
                (None, _) => self.load_vector(low, src),
            }
            src = src.plus(2 * vector_bytes);
        }
    }
}

impl<M: FloatAssembly> CallAssembly for M {}

fn move_one(masm: &mut impl FloatAssembly, dst: Reg, argument: &Argument) {
    match *argument {
        Argument::Gpr(src) => masm.move64(dst.gpr(), src),
        Argument::Fpr(src) => masm.move_float(dst.fpr(), src),
        Argument::Imm(value) => masm.move64(dst.gpr(), value),
        Argument::Load32(src) => masm.load32(dst.gpr(), src),
        Argument::Load64(src) => masm.load64(dst.gpr(), src),
        Argument::LoadF64(src) => masm.load_f64(dst.fpr(), src),
        Argument::AddressOf(address) => masm.compute_address(dst.gpr(), address),
    }
}
