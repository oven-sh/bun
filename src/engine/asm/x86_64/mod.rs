//! x86-64.

pub mod abi;
mod assembler;
mod float;
mod integer;
mod layout;
mod opcode;
pub mod patch;
mod registers;
mod shuffle;
mod vector;
mod vector_binary;
mod vector_shift;
mod vector_unary;

pub use assembler::{Assembler, FprMem, GprMem, Rm};
pub use float::{FloatFlags, rounding_control};
pub use integer::MacroAssembler;
pub use opcode::*;
pub use registers::*;
pub use vector_binary::single_instruction;
