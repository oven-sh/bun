pub mod body;
pub mod builder;
pub mod declared;
pub mod entry_parameters;
pub mod ids;
pub mod keys;
#[cfg(test)]
pub mod limits;
pub mod parallel;
#[cfg(any(test, feature = "ir_text"))]
pub mod print;
pub mod program;
pub mod property_keys;
pub mod references;
pub mod sections;
pub mod strings;
#[cfg(test)]
mod type_constants;
pub mod types;

#[rustfmt::skip]
pub mod generated;

mod body_decode;
mod finish;
mod name_class;
#[cfg(any(test, feature = "ir_text"))]
mod print_body;
#[cfg(any(test, feature = "ir_text"))]
mod print_names;
mod ssa;
mod type_union;
mod wtf8;

#[cfg(test)]
pub mod testing;
#[cfg(test)]
mod tests;

pub use body::{
    BlockView, Body, FieldWord, StreamError, TargetView, TerminatorView, ValueView, Words,
};
pub use builder::{BuilderScratch, Edge, FunctionBuilder, Handler, LocalVariable};
pub use declared::{DeclaredType, Mapped, PositionFlags};
pub use entry_parameters::EntryPosition;
pub use generated::{ContentsSlot, Opcode};
pub use ids::{
    ABSENT_WORD, BlockId, DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId,
    ModuleFailureId, ModuleId, PropertyKeyId, StringId, TypeId, TypeSiteId, ValueId, VariableId,
};
pub use keys::{ClassSlot, FunctionKey, LayoutKey, PrivateStatePart, VariableKey};
pub use name_class::classify_name;
pub use parallel::{InParallel, drop_each, for_each_mut, run_serially};
#[cfg(any(test, feature = "ir_text"))]
pub use print::{Printer, print_function, print_program};
pub use program::{NameTables, Program};
pub use property_keys::{PropertyKey, PropertyKeyKind, PropertyKeyTable, WellKnownSymbol};
pub use references::{IdMap, Reference, ReferenceKind};
pub use sections::{ListCounts, SectionWriter, WireSpan};
pub use strings::StringTable;
pub use types::{ClassPart, OpaqueKind, PreparedType, Primitives, Type, TypeFlags, TypeTable};
pub use wtf8::is_canonical_wtf8;
