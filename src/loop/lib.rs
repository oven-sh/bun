#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(unsafe_op_in_unsafe_fn)]
#![allow(ambiguous_glob_reexports, hidden_glob_reexports)]
#![warn(unused_must_use)]

extern crate self as bun_loop;
// Self-aliases so mounted sources' sibling extern refs resolve to this crate
// root (satisfied by the flat re-exports below) until Step 7.13's sed.
pub extern crate self as bun_io;
pub extern crate self as bun_event_loop;
pub extern crate self as bun_spawn;
pub extern crate self as bun_patch;

// ──────────────────────────────────────────────────────────────────────────
// §8 Step 7.1 — absorbed-crate #[path] mounts + flat root re-exports.
// Source files stay at their original disk paths; only crate-of-record changes.
// ──────────────────────────────────────────────────────────────────────────
#[path = "../io/lib.rs"]
pub mod io;
#[path = "../event_loop/lib.rs"]
pub mod event_loop;
#[path = "../spawn/lib.rs"]
pub mod spawn;
#[path = "../patch/lib.rs"]
pub mod patch;

pub use io::*;
pub use event_loop::*;
pub use spawn::*;
pub use patch::*;
