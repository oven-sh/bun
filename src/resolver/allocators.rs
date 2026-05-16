//! ── bun_alloc::allocators re-export ──────────────────────────────────────
//! `Result`/`ItemStatus` live at the `bun_alloc` crate root (re-exported via
//! `bun_alloc::allocators`); add the `Status` alias the resolver body spells.

pub use bun_alloc::ItemStatus as Status;
pub use bun_alloc::allocators::*;
