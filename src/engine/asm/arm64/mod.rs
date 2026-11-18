//! AArch64.

pub mod abi;
mod arithmetic;
mod assembler;
mod compare;
mod constant;
mod float;
mod immediate;
mod integer;
mod layout;
mod load_store;
mod macro_assembler;
mod neon;
mod neon_opcode;
mod opcode;
mod pairing;
pub mod patch;
mod registers;
mod scalar_float;
mod shuffle;
mod vector;
mod vector_arithmetic;

pub use assembler::Assembler;
pub use constant::ConstantMove;
pub use float::FloatFlags;
pub use immediate::{ArithmeticImm, BitmaskImm, FloatImm};
pub use load_store::{AccessSize, Mem, PairMem};
pub use macro_assembler::MacroAssembler;
pub use neon::VectorImm;
pub use neon_opcode::*;
pub use opcode::*;
pub use pairing::PlainAccess;
pub use registers::*;
