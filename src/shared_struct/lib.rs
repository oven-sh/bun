//! Cross-thread storage for TC39 shared structs (https://github.com/tc39/proposal-structs).
//!
//! A [`SharedBlock`] is a fixed-length array of atomic 64-bit slots. Each worker's
//! JS object for a shared struct is a thin view over one block, so reads and writes
//! reach the same memory with no copy. A slot holds a NaN-boxed [`Value`]: a
//! primitive, an interned string, a reference to another block, or a sync primitive.

mod mutex;
mod shape;
mod value;

pub use mutex::{
    Abort, Condition, LockError, Mutex, Never, WaitOutcome, notify_count, timeout_from_millis,
};
pub use shape::{ShapeError, StructShape, is_array_index};
pub use value::{SharedBlock, Value};
