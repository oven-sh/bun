//! Branch-prediction hints — Rust port of Zig's `@branchHint`.

/// Mark the surrounding branch as cold/unlikely. Port of Zig
/// `@branchHint(.unlikely)` / `@branchHint(.cold)` (docs/PORTING.md:211).
///
/// Calling a `#[cold]` callee makes LLVM treat the *call site's* basic block
/// as cold and lay it out off the hot path. `#[inline(never)]` is required:
/// if the empty body is inlined the call instruction — and with it the hint —
/// disappears. Do NOT mark this `#[inline]` / `#[inline(always)]`.
///
/// ```ignore
/// if rare {
///     bun_core::hint::cold();
///     return Err(e);
/// }
/// ```
// TODO: replace with `core::hint::cold_path()` once rust-lang/rust#117174
// stabilizes (then drop `#[inline(never)]`).
#[cold]
#[inline(never)]
pub const fn cold() {}
