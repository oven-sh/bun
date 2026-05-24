//! Basic utilities for working with memory and objects.

/// Default-initializes a value of type `T`.
///
/// Zig tried, in order: `T.initDefault()`, then `T.init()`, then `.{}`. All three
/// collapse into Rust's `Default` trait — types that had `initDefault`/`init` in Zig
/// should `impl Default` in their Rust port.
// PORT NOTE: `std.meta.hasFn` (≈ `@hasDecl`) fallback chain → single `Default` bound
// per §Comptime reflection ("optional behavior → trait with default method").
#[inline]
pub fn init_default<T: Default>() -> T {
    T::default()
}

// ──────────────────────────────────────────────────────────────────────────────
// PORT NOTE: `exemptedFromDeinit`, `deinitIsVoid`, and `deinit` are intentionally
// NOT ported as functions.
//
// Zig's `bun.memory.deinit(ptr_or_slice)` walked `@typeInfo` to:
//   - recurse into slices/arrays/optionals/error-unions,
//   - call `.deinit()` on struct / tagged-union pointees (unless the type set
//     `pub const deinit = void;` or was in an exemption list), and
//   - finally write `undefined` over the memory if the pointer was mutable.
//
// Rust's `Drop` already does the recursive part automatically: dropping a value
// drops every field, every `Vec`/`Box` element, every `Option`/`Result` payload.
// The "write undefined" poisoning has no safe Rust equivalent (and is a debug aid,
// not semantics).
//
// Call sites:
//   - `bun.memory.deinit(&x)`       → delete (let `x` drop at scope exit).
//   - `bun.memory.deinit(slice)`    → delete (slice elements drop with their owner).
//   - explicit early release        → `drop(x)` or a type-specific `close(self)`.
//
// `@typeInfo` has no Rust equivalent (§Comptime reflection), so a faithful generic
// port is not possible — and per §Idiom map, `deinit` definitions become `impl Drop`
// on the target type, not a free function here.
//
// TODO(port): if any caller relied on the `*x = undefined` poisoning to catch UAF in
// debug, add `#[cfg(debug_assertions)] unsafe { ptr::write_bytes(p, 0xAA, 1) }` at
// that call site.
// ──────────────────────────────────────────────────────────────────────────────

/// Rebase a slice from one memory buffer to another buffer.
///
/// Given a slice which points into a memory buffer with base `old_base`, return a
/// slice which points to the same offset in a new memory buffer with base `new_base`,
/// preserving the length of the slice.
///
/// ```text
/// const old_base = [6]u8{};
/// assert(@ptrToInt(&old_base) == 0x32);
///
///            0x32 0x33 0x34 0x35 0x36 0x37
/// old_base |????|????|????|????|????|????|
///                    ^
///                    |<-- slice --->|
///
/// const new_base = [6]u8{};
/// assert(@ptrToInt(&new_base) == 0x74);
/// const output = rebaseSlice(slice, old_base, new_base)
///
///            0x74 0x75 0x76 0x77 0x78 0x79
/// new_base |????|????|????|????|????|????|
///                    ^
///                    |<-- output -->|
/// ```
///
/// # Safety
/// - `slice` must point into the allocation starting at `old_base`.
/// - `new_base` must point to a valid allocation of at least
///   `(slice.as_ptr() - old_base) + slice.len()` bytes.
/// - The returned lifetime `'a` must not outlive the allocation at `new_base`.
pub unsafe fn rebase_slice<'a>(slice: &[u8], old_base: *const u8, new_base: *const u8) -> &'a [u8] {
    let offset = (slice.as_ptr() as usize) - (old_base as usize);
    // SAFETY: caller contract above guarantees `new_base.add(offset)` is in-bounds for
    // `slice.len()` bytes.
    unsafe { core::slice::from_raw_parts(new_base.add(offset), slice.len()) }
}

// ported from: src/bun_alloc/memory.zig
