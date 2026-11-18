//! The binary format of WebAssembly: types, modules, instructions and their validation.

#![forbid(unsafe_code)]

mod alloc;
mod builtins;
mod custom;
mod decode;
mod driver;
mod error;
mod index;
pub mod limits;
mod module;
pub mod opcode;
mod ops;
mod parse;
mod reader;
mod types;
mod validate;
mod visitor;

pub use alloc::OutOfMemory;
pub use builtins::{CompileOptions, Provided, StringBuiltin};
pub use custom::{BranchHint, BranchHints, Names};
pub use driver::{Driver, FunctionBody, LoopEffects, LoopFlags};
pub use error::{Error, ErrorKind};
pub use index::{
    CodeIndex, DataIndex, ElemIndex, FuncIndex, GlobalIndex, MemoryIndex, TableIndex, TagIndex,
    TypeIndex,
};
pub use module::{
    ConstCode, ConstExpr, CustomSection, Data, DataMode, Elem, ElemItem, ElemMode, Export, Extern,
    Features, FunctionFacts, FunctionFlags, Global, Import, ImportCounts, Limits, Memory, Module,
    ModuleHeader, Span, Table,
};
pub use ops::{
    BrTable, Catch, Catches, FloatBinaryOp, FloatUnaryOp, Flow, IntBinaryOp, IntUnaryOp, LaneType,
    LoadOp, MemArg, StoreOp, VectorLoadOp,
};
pub use parse::{Bodies, Parser, UnvalidatedModule, ValidatedBodies};
pub use types::{
    AbstractHeapType, ArrayType, BlockType, CanonicalType, CanonicalValType, Field, FieldType,
    FuncType, HeapType, RefType, Rtt, StorageType, StructType, TypeKind, Types, ValKind, ValType,
    canonical_group_count,
};
pub use validate::{Scratch, validate_function};
pub use visitor::{
    Visit, VisitControl, VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
    Visitor,
};
