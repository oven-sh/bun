//! Branch-prediction hints — Rust port of Zig's `@branchHint`.

#[cold]
#[inline(never)]
pub const fn cold() {}
