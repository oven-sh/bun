//! Canonical byte-oriented `Write` trait.
//!
//! HOSTED IN `bun_string` so the trait sits *below* every consumer in the dep
//! DAG: `bun_io → bun_string` already exists, and `bun_string` already depends
//! on `bun_core` (error type), `bun_alloc` (`ArenaVec`), and `bun_collections`
//! (`BoundedArray`). The trait body itself was pushed one level lower into
//! `crate::io` (that crate has zero upward deps) so even `bun_collections`
//! can implement it; this module re-exports it verbatim and adds the
//! big-endian integer helper. `bun_io` re-exports this module
//! (`pub use bun_core::write::*;`) and layers its sink types
//! (`FixedBufferStream`, `BufWriter`, `FmtAdapter`, `DiscardingWriter`) on top,
//! so the existing `bun_io::Write` importers are unaffected.

/// `Result<T>` over `core::fmt::Error` so `?` composes everywhere.
pub type Result<T = ()> = core::result::Result<T, core::fmt::Error>;

pub use crate::io::{IntLe, Write};
