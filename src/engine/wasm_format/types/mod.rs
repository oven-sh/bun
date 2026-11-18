mod canonical;
mod defined;
pub(crate) mod display;
mod layout;
mod value;

pub use canonical::{CanonicalType, CanonicalValType, Rtt, canonical_group_count};
pub use defined::{ArrayType, Field, FuncType, StructType, Types};
pub(crate) use defined::{GroupError, Subtyping, TypesBuilder};
pub use value::{
    AbstractHeapType, BlockType, FieldType, HeapType, RefType, StorageType, TypeKind, ValKind,
    ValType,
};
