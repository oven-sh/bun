//! What runs on the thread of the `Vm`: making plans, installing code, and what that code calls.

pub(crate) mod cells;
mod code;
mod exits;
mod materialize;
pub(crate) mod operations;
pub(crate) mod operators;
mod plan;
mod probes;
mod queue;
pub(crate) mod registers;
pub(crate) mod search;
mod thunks;
mod tiering;
pub(crate) mod varargs;

pub(crate) use thunks::Thunks;
pub use tiering::{did_collect, jettison, tier_up};
