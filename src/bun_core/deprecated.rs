// ──────────────────────────────────────────────────────────────────────────
// BufferedReader
// ──────────────────────────────────────────────────────────────────────────

// Plain storage for a buffered reader. The only
// in-tree consumer (`pack_command::BufferedFileReader`) supplies its own read shim
// over `bun_sys::read`, so this stays a bare struct: no reader trait, no methods.
// (The dedicated stdin instance lives at `output::BufferedStdin`.)
pub struct BufferedReader<const BUFFER_SIZE: usize, R> {
    pub unbuffered_reader: R,
    pub buf: [u8; BUFFER_SIZE],
    pub start: usize,
    pub end: usize,
}

// ──────────────────────────────────────────────────────────────────────────
// SinglyLinkedList
// ──────────────────────────────────────────────────────────────────────────
//
// DEDUP(D050): the Rust port of `SinglyLinkedList` / `SinglyLinkedNode` was
// removed — the canonical implementation lives at
// `bun_collections::pool::{SinglyLinkedList, Node}`. The two had diverged
// (`data: T` vs `data: MaybeUninit<T>`, `*mut`-null vs `Option<*mut>` returns)
// and this copy had zero callers outside its own unit test. New consumers
// should depend on `bun_collections::pool` directly.

// ──────────────────────────────────────────────────────────────────────────
// RapidHash
// ──────────────────────────────────────────────────────────────────────────

// Canonical impl lives in the leaf `bun_hash` crate; re-export so the
// historical `crate::deprecated::RapidHash` path keeps resolving.
pub use bun_hash::RapidHash;
