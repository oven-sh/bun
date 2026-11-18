//! Assemblers for x86-64 and AArch64 and the macro assembler over them.

#![forbid(unsafe_code)]

pub mod arm64;
mod assembly;
mod blinding;
mod buffer;
mod family;
mod features;
mod label;
mod operand;
mod register;
mod vector;
#[path = "x86_64/mod.rs"]
pub mod x64;

pub use assembly::{
    Argument, CallAssembly, FloatAssembly, MacroAssembly, Options, Reuse, Scratch, ScratchNeeds,
    ValueAssembly, VectorAssembly,
};
pub use features::{Arm64Features, X64Features};
pub use label::{Code, CodeTooLarge, Label, Relocation, RelocationKind, Target};
pub use operand::{
    Absolute, Address, Amount, AtomicOp, Cond, FloatCond, FloatWidth, Memory, NegativeZero,
    RegOrImm, RegOrMem, ResultCond, Rounding, Scale, Shift, Sign, Size, Src, TestCond, Untrusted,
    Width,
};
pub use register::{Bank, Fpr, Gpr, Reg, RegisterSet, RegisterSetIter};
pub use vector::{
    Relaxed, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary, lanes,
};

#[cfg(target_arch = "aarch64")]
pub use {arm64 as host, features::Arm64Features as Features};
#[cfg(target_arch = "x86_64")]
pub use {features::X64Features as Features, x64 as host};

/// That of the processor that runs the engine.
pub use host::{MacroAssembler, abi, patch};

/// What code that generates code for the host needs in scope.
pub mod prelude {
    pub use crate::{
        Absolute, Address, Argument, CallAssembly, Cond, FloatAssembly, FloatCond, FloatWidth, Fpr,
        Gpr, Label, MacroAssembler, MacroAssembly, RegisterSet, ResultCond, Scale, Sign, Size,
        TestCond, Untrusted, ValueAssembly, VectorAssembly, Width, abi,
    };
}
