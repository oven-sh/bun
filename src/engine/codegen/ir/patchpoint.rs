//! Calls, and code that the client emits itself.

use bun_engine_asm::{Fpr, Gpr, Reg, RegisterSet, Target};

use super::effects::Effects;
use super::entities::{Span, State, Value, VectorConstant};
use super::op::{Bits64, Token, Type};

/// Where an operand has to be. One that is late keeps its value until the code ends, so it shares no register with a
/// result or with what is clobbered.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Input {
    Anywhere,
    /// Rarely read, so it is no reason to hold a register.
    ColdAnywhere,
    LateAnywhere,
    Register,
    LateRegister,
    /// The code may overwrite the register, which is no result's.
    ConsumedRegister,
    Fixed(Reg),
    LateFixed(Reg),
    /// At this offset from the stack pointer.
    Outgoing(i32),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Output {
    Register,
    /// Written before the operands are read, so it shares a register with none.
    EarlyRegister,
    Fixed(Reg),
    /// At this offset from the stack pointer.
    Outgoing(i32),
}

/// Where a parameter arrives, or a result of the function goes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Boundary {
    Register(Reg),
    /// At this offset from the frame pointer. A parameter stays there unchanged until the function returns.
    Frame(i32),
}

/// Where a value is.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Location {
    Gpr(Gpr),
    Fpr(Fpr),
    /// At this offset from the frame pointer.
    Frame(i32),
    /// The value is the register, which is pinned or the frame pointer, plus this.
    Displaced(Gpr, i32),
    Constant(Bits64),
    VectorConstant(VectorConstant),
}

impl Location {
    #[inline]
    pub fn gpr(self) -> Gpr {
        match self {
            Self::Gpr(reg) => reg,
            _ => unreachable!("not in a general register"),
        }
    }

    #[inline]
    pub fn fpr(self) -> Fpr {
        match self {
            Self::Fpr(reg) => reg,
            _ => unreachable!("not in a vector register"),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    /// The client emits the code.
    Custom,
    /// The client emits code that ends with a call instruction.
    CustomCall,
    Call(Target),
    /// The first operand is the address to call, in a register or in the frame.
    CallIndirect,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub struct PatchpointFlags: u8 {
        /// The client can emit the code only once.
        const UNIQUE = 1 << 0;
        /// The upper half of the register of an I32 result holds anything. Otherwise it is clear.
        const UNEXTENDED_RESULTS = 1 << 1;
        /// The stack pointer has to be computed from the frame pointer afterwards.
        const MOVES_STACK_POINTER = 1 << 2;
        /// The upper half of the register that an I32 operand asks for may hold anything. Otherwise it is clear.
        const UNEXTENDED_OPERANDS = 1 << 3;
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PatchpointData {
    pub action: Action,
    pub token: Token,
    pub effects: Effects,
    pub flags: PatchpointFlags,
    /// Its values are late and cold.
    pub state: State,
    /// Overwritten before the operands are read.
    pub clobbers_early: RegisterSet,
    /// Overwritten after the operands that are not late are read.
    pub clobbers_late: RegisterSet,
    /// Like `clobbers_late`, but the low 64 bits are kept.
    pub clobbers_upper_halves: RegisterSet,
    pub scratch_gprs: u8,
    pub scratch_fprs: u8,
    pub(crate) operands: Span<Value>,
    pub(crate) inputs: Span<Input>,
    pub(crate) results: Span<(Type, Output)>,
}

impl PatchpointData {
    pub fn new(action: Action, token: Token, effects: Effects) -> Self {
        Self {
            action,
            token,
            effects,
            flags: PatchpointFlags::empty(),
            state: State::NONE,
            clobbers_early: RegisterSet::EMPTY,
            clobbers_late: RegisterSet::EMPTY,
            clobbers_upper_halves: RegisterSet::EMPTY,
            scratch_gprs: 0,
            scratch_fprs: 0,
            operands: Span::default(),
            inputs: Span::default(),
            results: Span::default(),
        }
    }
}
