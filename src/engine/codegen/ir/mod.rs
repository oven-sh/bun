//! Functions in SSA form. Blocks take parameters, for which edges carry arguments.

mod builder;
mod effects;
mod entities;
pub mod evaluate;
mod function;
mod node;
mod op;
mod patchpoint;
mod print;
mod validate;

pub use builder::{Builder, Operand};
pub use effects::{EffectFlags, Effects, HeapRange};
pub use entities::{
    Block, Cases, Edge, Entity, Heap, Patchpoint, Slot, Span, State, Table, Value, Variable,
    VectorConstant,
};
pub(crate) use entities::{Pool, entities};
pub use function::{Edges, Entry, Function, SlotData, Successor};
pub use node::{NodeInfo, NodeKind};
pub use op::{
    Access, AccessFlags, Binary, Bits64, Checked, Exit, Lanes, Load, Op, Origin, Store, Token,
    Type, Unary, Wide,
};
pub use patchpoint::{Action, Boundary, Input, Location, Output, PatchpointData, PatchpointFlags};
pub use validate::validate;
