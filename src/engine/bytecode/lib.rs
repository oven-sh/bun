//! The instruction set, the bytecode generator and the serialized form of code.

#![forbid(unsafe_code)]

mod assembler;
mod bytes;
pub mod cache;
mod code;
mod comparator;
mod compiler;
mod constant;
mod dump;
mod effects;
mod function;
mod generator;
mod graph;
mod host;
mod instruction;
mod liveness;
mod metadata;
mod operand;
mod positions;
mod scope;
mod table;
#[cfg(test)]
mod unit_tests;
mod verifier;

pub use bun_engine_syntax::{
    EvalContext, FunctionFlags, FunctionKind, KnownCapture, KnownFunction, SourceCache,
};
pub use code::*;
pub use comparator::{Comparator, Known, SortKey};
pub use compiler::{BuiltinFunction, Compiler, Instrumentation, Request};
pub use constant::*;
pub use dump::Dump;
pub use effects::{EdgeKind, Run, Written};
pub use function::{FunctionInfo, FunctionRef, Origin, Specialization, Visibility};
pub use graph::{BlockIndex, Edge, Graph};
pub use host::{BuiltinValue, Host};
pub use instruction::{Flow, Instruction, Instructions, Op, Opcode, RawInstruction, Shape, op};
pub use liveness::{Liveness, Locals, Walk};
pub use metadata::{MetadataKind, MetadataLayout};
pub use operand::*;
pub use positions::{Position, Positions};
pub use scope::{ScopeKind, Slot, SlotFlags, SlotKind, StaticScope};
pub use verifier::{Fault, VerifyError, verify};
