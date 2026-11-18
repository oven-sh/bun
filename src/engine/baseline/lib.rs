//! The baseline compiler: a template of machine code for each instruction, and the stubs of the inline caches.

mod compiler;
mod emit;
pub mod ic;
mod profiles;
pub mod registers;
mod runtime;
mod tables;
mod thunks;

pub use runtime::{adopt, catch_address, did_collect, entry, resume_entry, tier_up};
