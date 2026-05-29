//! Shared (reference-counted) pointers.
//!
//! Per `docs/PORTING.md` §Pointers, the Rust port maps `bun.ptr.Shared(*T)` →
//! `std::rc::Rc<T>` and `bun.ptr.AtomicShared(*T)` → `std::sync::Arc<T>` directly,
//! and explicitly forbids introducing a custom `bun_ptr::Shared<T>` to shave the
//! weak-count header word ("4 uses tree-wide, 8 bytes per allocation is negligible,
//! and you lose `Rc::downgrade`/`make_mut`/`get_mut`").
//!
//! This module therefore re-exports `Rc`/`Arc`/`Weak` under the Zig names so that
//! mechanical `bun_ptr::shared::*` references resolve, and documents the 1:1 method
//! mapping for reviewers diffing against `src/ptr/shared.zig`.

use std::rc::Rc;

// ───────────────────────────────────────────────────────────────────────────────
// Options
// ───────────────────────────────────────────────────────────────────────────────

pub struct Options {
    pub atomic: bool,

    pub allow_weak: bool,

    /// Whether to call `deinit` on the data before freeing it, if such a method exists.
    pub deinit: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            atomic: false,
            allow_weak: false,
            deinit: true,
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Shared / AtomicShared
// ───────────────────────────────────────────────────────────────────────────────

pub type Shared<T> = Rc<T>;

/// A thread-safe shared pointer allocated using a specific type of allocator.
//

/// Like `Shared`, but takes explicit options.
//

// ───────────────────────────────────────────────────────────────────────────────
// Weak
// ───────────────────────────────────────────────────────────────────────────────

pub type Weak<T> = std::rc::Weak<T>;

// `RawCount` was `u32` in Zig; std uses `usize`. The overflow assertion
// (`old != maxInt(RawCount)`) is replaced by std's own abort-on-overflow check
// in `Arc::clone` (it aborts if the count would exceed `isize::MAX`).

// ported from: src/ptr/shared.zig
