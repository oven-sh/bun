#![feature(adt_const_params)]
#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![allow(incomplete_features)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ─── B-2 un-gate ────────────────────────────────────────────────────────────
// Phase-A draft of `braces` is now wired up. Remaining lower-tier gaps are
// flagged inline with `// TODO(b2-blocked): bun_X::Y` and reported upstream.
#[path = "braces.rs"]
pub mod braces;

// Re-exports the Phase-A draft expected at crate root (it did `use crate::{...}`).
pub use braces::{has_eq_sign, CharIter, InputChar, ShellCharIter, ShellCharIterState, StringEncoding};
