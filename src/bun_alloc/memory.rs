//! Basic utilities for working with memory and objects.

use crate::AllocError;

/// Allocates memory for a value of type `T` and initializes the memory with `value`.
///
/// In Zig this routed through `bun.tryNew` for extra assertions when `allocator` was
/// `bun.default_allocator`. In Rust the global allocator *is* mimalloc (via
/// `#[global_allocator]`), so the default-vs-custom branch collapses and this is
/// `Box::new`.
// PORT NOTE: `allocator: std.mem.Allocator` param deleted per §Allocators (non-AST
// crate). The `Environment.allow_assert && isDefault(allocator)` branch is gone with it.
#[inline]
pub fn create<T>(value: T) -> Result<Box<T>, AllocError> {
    // PERF(port): Zig `allocator.create` is fallible; Rust `Box::new` aborts on OOM.
    // If fallible allocation is required in Phase B, swap to `Box::try_new` (nightly
    // `allocator_api`) or a manual `alloc::alloc` + `ptr::write` pair.
    Ok(Box::new(value))
}

/// Frees memory previously allocated by `create`.
///
/// The memory must have been allocated by the `create` function in this namespace.
// PORT NOTE: `allocator` param deleted. In Rust, `Box<T>` drops at scope exit, so
// most call sites should delete the `destroy` call entirely rather than invoke this.
#[inline]
pub fn destroy<T>(ptr: Box<T>) {
    drop(ptr);
}

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
pub unsafe fn rebase_slice<'a>(
    slice: &[u8],
    old_base: *const u8,
    new_base: *const u8,
) -> &'a [u8] {
    let offset = (slice.as_ptr() as usize) - (old_base as usize);
    // SAFETY: caller contract above guarantees `new_base.add(offset)` is in-bounds for
    // `slice.len()` bytes.
    unsafe { core::slice::from_raw_parts(new_base.add(offset), slice.len()) }
}

/// Removes the trailing sentinel from an owned sentinel-terminated buffer, returning
/// a plain owned slice that can be freed normally.
///
/// Most allocators perform this without allocating new memory, but unlike a raw cast
/// this will not break allocators that need the exact allocation size to free.
///
/// In Zig this was generic over `[:x]T` / `[*:x]T` via `@typeInfo`. Rust has no
/// sentinel-carrying slice type in the type system, so this is specialized to the
/// overwhelmingly common case: NUL-terminated bytes (`[:0]u8`).
// TODO(port): add `drop_sentinel_u16` (for `[:0]u16` / WStr) if a caller needs it.
pub fn drop_sentinel(mut buf: Vec<u8>) -> Result<Box<[u8]>, AllocError> {
    // Zig: try `allocator.remap(slice, slice.len)` (shrink by 1), else dupe+free.
    // Rust: `Vec` already tracks capacity vs. len; popping the NUL and shrinking is
    // the moral equivalent of `remap`. `into_boxed_slice` reallocates only if
    // `cap != len`, matching the Zig fallback.
    debug_assert_eq!(buf.last().copied(), Some(0), "buffer is not NUL-terminated");
    buf.pop();
    Ok(buf.into_boxed_slice())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_alloc/memory.zig (210 lines)
//   confidence: medium
//   todos:      2
//   notes:      create/destroy/init_default collapse to Box/Default; generic @typeInfo-driven deinit dropped (Rust Drop covers it); drop_sentinel specialized to [:0]u8.
// ──────────────────────────────────────────────────────────────────────────
