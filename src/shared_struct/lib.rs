//! Cross-thread storage for TC39 shared structs (https://github.com/tc39/proposal-structs).
//!
//! A [`SharedBlock`] is a fixed-length array of atomic 64-bit slots. Each worker's
//! JS object for a shared struct is a thin view over one block, so reads and writes
//! reach the same memory with no copy. A slot holds a NaN-boxed [`Value`]: a
//! primitive, an interned string, or a reference to another block.

mod mutex;
mod value;

pub use mutex::{Abort, Condition, LockError, Mutex, Never, WaitOutcome};
pub use value::{SharedBlock, Value};
