// ─── std.mem.bytesAsSlice / sliceAsBytes ─────────────────────────────────────
/// Zig `std.mem.bytesAsSlice(T, bytes)` for `&mut [u8]` → `&mut [T]`.
///
/// SAFETY (caller-upheld):
/// * `bytes.as_ptr()` must be aligned to `align_of::<T>()` — Zig spells this
///   as `@alignCast`, which is a *checked* operation (illegal-behavior trap in
///   safe builds). We mirror that with a hard `assert!` rather than
///   `debug_assert!`: forming a misaligned `&mut [T]` is instant UB in Rust
///   even if never dereferenced, so this must not be silently elided in
///   release. The check is a single AND+CMP and every current call site is
///   immediately followed by a syscall, so the cost is negligible.
/// * `T` must be plain-old-data — every byte pattern in `bytes[..len/size]`
///   must be a valid `T` (callers use `u16`/`u32` only),
/// * the trailing `len % size_of::<T>()` bytes are silently dropped from the
///   reinterpreted view, matching Zig's `bytesAsSlice` semantics.
#[inline]
pub unsafe fn bytes_as_slice_mut<T>(bytes: &mut [u8]) -> &mut [T] {
    assert!(
        bytes.as_ptr().cast::<T>().is_aligned(),
        "bytes_as_slice_mut: misaligned for {}",
        core::any::type_name::<T>(),
    );
    let len = bytes.len() / core::mem::size_of::<T>();
    // SAFETY: alignment + validity preconditions documented above.
    unsafe { core::slice::from_raw_parts_mut(bytes.as_mut_ptr().cast::<T>(), len) }
}

// ─── Unaligned<T> ─────────────────────────────────────────────────────────────
/// Port of Zig's `align(1) T` element type. Rust references and slices require
/// natural alignment for `T`; producing a `&[u16]` from an odd address is
/// instant UB even if never dereferenced. `#[repr(packed)]` on this wrapper
/// drops the alignment requirement to 1, so `&[Unaligned<T>]` is the sound
/// translation of `[]align(1) T`. Reads/writes go through `ptr::read_unaligned`
/// / `ptr::write_unaligned` (the compiler emits byte-wise or unaligned-load
/// instructions as appropriate for the target).
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct Unaligned<T: Copy>(T);

impl<T: Copy> Unaligned<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(value)
    }

    #[inline(always)]
    pub fn get(self) -> T {
        // `self` is by-value (already moved into an aligned local), so a plain
        // field read is fine; the `packed` repr only affects in-place borrows.
        self.0
    }

    #[inline(always)]
    pub fn set(&mut self, value: T) {
        // SAFETY: `self` points to `size_of::<T>()` writable bytes; alignment
        // is 1 by `#[repr(packed)]`, hence `write_unaligned`.
        unsafe { core::ptr::addr_of_mut!(self.0).write_unaligned(value) }
    }

    /// Reinterpret `&[Unaligned<T>]` as `&[T]` once the caller has proven
    /// `ptr` is naturally aligned (Zig `@alignCast`). Panics in debug if not.
    #[inline]
    pub fn slice_align_cast(slice: &[Unaligned<T>]) -> &[T] {
        debug_assert!(
            (slice.as_ptr() as usize).is_multiple_of(core::mem::align_of::<T>()),
            "Unaligned::slice_align_cast: pointer is not {}-byte aligned",
            core::mem::align_of::<T>(),
        );
        // SAFETY: same address, same length, same element size; alignment
        // precondition asserted above. `Unaligned<T>` is `repr(C, packed)`
        // around a single `T`, so layout is byte-identical.
        unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<T>(), slice.len()) }
    }

    /// Mutable counterpart of [`slice_align_cast`].
    #[inline]
    pub fn slice_align_cast_mut(slice: &mut [Unaligned<T>]) -> &mut [T] {
        debug_assert!(
            (slice.as_ptr() as usize).is_multiple_of(core::mem::align_of::<T>()),
            "Unaligned::slice_align_cast_mut: pointer is not {}-byte aligned",
            core::mem::align_of::<T>(),
        );
        // SAFETY: see `slice_align_cast`; `&mut` exclusivity is preserved.
        unsafe { core::slice::from_raw_parts_mut(slice.as_mut_ptr().cast::<T>(), slice.len()) }
    }
}

pub use bytemuck::NoUninit;

/// Port of Zig `std.mem.asBytes(&v)`: reinterpret a value's storage as a
/// borrowed byte slice.
///
/// Safe: the [`bytemuck::NoUninit`] bound statically guarantees `T` is `Copy`,
/// `'static`, and contains no uninitialized (padding) bytes, so every byte of
/// the returned slice is initialized and reading it is defined behaviour.
#[inline]
pub fn bytes_of<T: bytemuck::NoUninit>(v: &T) -> &[u8] {
    bytemuck::bytes_of(v)
}

/// Mutable counterpart of [`bytes_of`]: reinterpret `&mut T` as `&mut [u8]`.
///
/// Safe: the [`bytemuck::Pod`] bound guarantees `T` has no padding bytes and
/// every bit pattern is a valid `T`, so writing arbitrary bytes through the
/// returned slice cannot produce an invalid value.
#[inline]
pub fn bytes_of_mut<T: bytemuck::Pod>(v: &mut T) -> &mut [u8] {
    bytemuck::bytes_of_mut(v)
}

// ─── Slice reinterpretation (canonical) ───────────────────────────────────────
// Port of Zig `bun.reinterpretSlice` / `std.mem.bytesAsSlice` / `sliceAsBytes`.
// Zig has ONE polymorphic `reinterpretSlice(comptime T, slice: anytype)` that
// handles const+mut via comptime; Rust splits by mutability and offers two
// safety surfaces:
//   - `cast_slice` / `cast_slice_mut`  → SAFE, bytemuck-bounded, panics on
//     misalign or `len % size_of::<B>() != 0`. Use for Pod↔Pod (u8↔u16 etc.).
//   - `bytes_as_slice_mut`             → UNSAFE escape hatch, unbounded `T`,
//     TRUNCATES trailing bytes (Zig `@divTrunc`). Use only when `T` is not
//     `AnyBitPattern` or the input length is intentionally not a multiple.
// Every current caller targets `u16` over an even-length buffer, so the safe
// path is the default.

/// Port of Zig `std.mem.sliceAsBytes` / `bun.reinterpretSlice` for the
/// read-only `&[A]` → `&[B]` direction. Safe: the [`bytemuck::NoUninit`] bound
/// on `A` guarantees every source byte is initialized, and
/// [`bytemuck::AnyBitPattern`] on `B` guarantees every byte pattern is a valid
/// `B`. Panics if size/alignment don't divide evenly (same as `bytemuck`).
#[inline]
pub fn cast_slice<A: bytemuck::NoUninit, B: bytemuck::AnyBitPattern>(a: &[A]) -> &[B] {
    bytemuck::cast_slice(a)
}

/// Mutable counterpart of [`cast_slice`]: reinterpret `&mut [A]` as `&mut [B]`.
/// Safe: both [`bytemuck::Pod`] bounds guarantee every byte pattern is valid in
/// both directions and there are no uninitialized bytes. Panics on misalignment
/// or if `a.len() * size_of::<A>() % size_of::<B>() != 0` (same as `bytemuck`).
#[inline]
pub fn cast_slice_mut<A: bytemuck::Pod, B: bytemuck::Pod>(a: &mut [A]) -> &mut [B] {
    bytemuck::cast_slice_mut(a)
}

/// Port of Zig `std.mem.sliceAsBytes`: reinterpret `&[T]` as `&[u8]`.
///
/// This is [`cast_slice`] with the output type fixed to `u8`, so callers never
/// need a `::<_, u8>` turbofish. Safe: [`bytemuck::NoUninit`] guarantees every
/// byte of `T` is initialized; `align_of::<u8>() == 1` and
/// `size_of::<T>() % 1 == 0` mean the bytemuck size/align checks are trivially
/// satisfied and this never panics.
#[inline]
pub fn slice_as_bytes<T: bytemuck::NoUninit>(s: &[T]) -> &[u8] {
    bytemuck::cast_slice(s)
}
