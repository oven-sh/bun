use core::fmt;

use crate::MAX_PATH_BYTES;
use crate::string::ZStr;

// const PathIntLen = std.math.IntFittingRange(0, bun.MAX_PATH_BYTES);
// Compute the number of bits needed to hold 0..=MAX_PATH_BYTES.
const PATH_INT_LEN_BITS: u32 = {
    let mut n: usize = MAX_PATH_BYTES;
    let mut bits: u32 = 0;
    while n > 0 {
        bits += 1;
        n >>= 1;
    }
    bits
};

const USE_SMALL_PATH_STRING_: bool = (usize::BITS - PATH_INT_LEN_BITS) >= 53;

// const PathStringBackingIntType = if (use_small_path_string_) u64 else u128;
// Zig picks the backing integer at comptime: u64 if 53 ptr bits + len bits fit
// (MAX_PATH_BYTES ≤ 2048 → ≤ 11 len bits); u128 otherwise (Linux/Android
// MAX_PATH_BYTES=4096 → 13 len bits → 64-13=51 < 53; Windows → way more).
// Stable Rust cannot select a type from a const bool, so cfg by OS — this list
// MUST track `MAX_PATH_BYTES` in `bun_core/util.rs`. The const-assert below
// verifies they agree.
#[cfg(any(
    target_os = "linux",
    target_os = "android",
    windows,
    target_arch = "wasm32"
))]
type PathStringBackingInt = u128;
#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    windows,
    target_arch = "wasm32"
)))]
type PathStringBackingInt = u64; // macOS / FreeBSD / OpenBSD / NetBSD / DragonFly / Solaris / iOS

// Bit widths of the packed fields (Zig packed-struct order: ptr in low bits, len in high bits).
const POINTER_BITS: u32 = if USE_SMALL_PATH_STRING_ {
    53
} else {
    usize::BITS
};
#[allow(dead_code)]
const LEN_BITS: u32 = if USE_SMALL_PATH_STRING_ {
    PATH_INT_LEN_BITS
} else {
    usize::BITS
};

// macOS sets file path limit to 1024
// Since a pointer on x64 is 64 bits and only 46 bits are used
// We can safely store the entire path slice in a single u64.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub struct PathString(PathStringBackingInt);

impl PathString {
    // pub const PathInt / PointerIntType — Zig exposed these as type aliases; in
    // Rust the packed accessors below replace them.
    pub const USE_SMALL_PATH_STRING: bool = USE_SMALL_PATH_STRING_;

    const PTR_MASK: PathStringBackingInt = (1 as PathStringBackingInt)
        .wrapping_shl(POINTER_BITS)
        .wrapping_sub(1);

    #[inline(always)]
    fn ptr(self) -> usize {
        (self.0 & Self::PTR_MASK) as usize
    }

    #[inline(always)]
    fn len(self) -> usize {
        (self.0 >> POINTER_BITS) as usize
    }

    pub fn estimated_size(&self) -> usize {
        self.len()
    }

    /// View the packed pointer+length as a byte slice.
    ///
    /// Safe to call: the soundness invariant is upheld by [`PathString::init`]
    /// (now `unsafe fn`) and [`init_owned`], which between them enforce that
    /// the backing bytes outlive every `PathString` copy. A `PathString` with
    /// a null pointer (`Self::EMPTY`) yields an empty slice.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = self.ptr();
        if ptr == 0 {
            // Rust forbids slice::from_raw_parts(null, 0); return a valid empty slice.
            return &[];
        }
        // SAFETY: the constructor (`init` / `init_owned`) has guaranteed that
        // `ptr..ptr+len` points to a live allocation that outlives `self`.
        unsafe { core::slice::from_raw_parts(ptr as *const u8, self.len()) }
    }

    /// View the packed pointer+length as a NUL-terminated byte slice.
    ///
    /// # Safety
    /// The backing buffer must contain a NUL byte at `[len]`. Callers that
    /// constructed the `PathString` via [`PathString::init`] must have passed
    /// a NUL-terminated slice (the `&[u8]` excludes the NUL but the NUL must
    /// be at the byte following it). Callers that constructed via
    /// [`init_owned`] must have included the NUL in the `Vec<u8>`.
    #[inline]
    pub unsafe fn slice_assume_z(&self) -> &ZStr {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = self.ptr();
        if ptr == 0 {
            return ZStr::EMPTY;
        }
        // SAFETY: caller asserts the backing buffer has a NUL at [len], and
        // (via `init`'s safety contract) that the bytes outlive `self`.
        unsafe { ZStr::from_raw(ptr as *const u8, self.len()) }
    }

    /// Pack the pointer and length of a borrowed slice into the `PathString`
    /// backing integer. No allocation; no copy.
    ///
    /// # Safety
    /// The bytes of `str` MUST outlive every subsequent use of the returned
    /// `PathString` (or any `Copy` of it) via [`slice`] / [`slice_assume_z`].
    /// `PathString` is `#[repr(transparent)]` over an integer and carries no
    /// lifetime — the type system cannot enforce this, so the caller must.
    ///
    /// Typical sound uses:
    /// - `str` is `&'static` (string literal, `Box::leak`, a process-lifetime
    ///   intern like `FilenameStore` / `DirnameStore`, embedded-executable data);
    /// - `str` borrows a buffer that is guaranteed to live until the
    ///   `PathString` is dropped / consumed (e.g. the same stack frame, a
    ///   container field that owns the bytes, a caller-maintained buffer
    ///   passed across a task boundary).
    ///
    /// If the `PathString` needs to own its bytes (because no such buffer
    /// exists), use [`init_owned`] instead.
    ///
    /// [`slice`]: Self::slice
    /// [`slice_assume_z`]: Self::slice_assume_z
    /// [`init_owned`]: Self::init_owned
    #[inline]
    pub unsafe fn init(str: &[u8]) -> Self {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = (str.as_ptr() as usize as PathStringBackingInt) & Self::PTR_MASK; // @truncate
        let len = (str.len() as PathStringBackingInt) << POINTER_BITS; // @truncate into PathInt
        Self(ptr | len)
    }

    /// Take ownership of `bytes`, store its raw pointer/len, and forget the
    /// allocation. The returned PathString must be paired with
    /// [`deinit_owned`] (typically by the containing struct's `Drop`) to avoid
    /// a leak — this mirrors Zig, where `Bytes.deinit` runs
    /// `default_allocator.free(stored_name.slice())`.
    ///
    /// PathString itself stays `Copy` (it is a packed pointer), so ownership
    /// is a contract on the *container*, not enforced by the type.
    #[inline]
    pub fn init_owned(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        // Shed any unused capacity so the (ptr,len) pair fully describes the
        // allocation and `deinit_owned` can reconstruct it without tracking
        // capacity separately. `heap::alloc` (not `leak`) is the explicit
        // ownership-transfer-to-raw API; the matching `heap::take` lives
        // in `deinit_owned`.
        let raw: *mut [u8] = crate::heap::into_raw(bytes.into_boxed_slice());
        // SAFETY: `raw` is a fresh `Box<[u8]>` allocation given to us by
        // `heap::into_raw`; its bytes outlive this call (ownership was
        // transferred to the raw pointer, and the matching `deinit_owned`
        // releases them). Reborrow only to pack ptr+len into the backing int.
        unsafe { Self::init(&*raw) }
    }

    /// Free a heap allocation previously adopted by [`init_owned`]. No-op for
    /// `EMPTY`/borrowed-static slices of length 0.
    ///
    /// # Safety
    /// `self` must have been produced by [`init_owned`] (or be empty). Calling
    /// this on a borrowed PathString is UB.
    #[inline]
    pub unsafe fn deinit_owned(&mut self) {
        let ptr = self.ptr();
        let len = self.len();
        *self = Self::EMPTY;
        if ptr == 0 || len == 0 {
            return;
        }
        // SAFETY: caller contract — (ptr,len) is exactly the `Box<[u8]>` that
        // `init_owned` released via `into_raw`.
        drop(unsafe { crate::heap::take(core::slice::from_raw_parts_mut(ptr as *mut u8, len)) });
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub const EMPTY: Self = Self(0);

    /// Zig: `pub const empty: PathString = PathString{};` — value form of
    /// [`EMPTY`] for call sites that read better as a constructor.
    #[inline(always)]
    pub const fn empty() -> Self {
        Self::EMPTY
    }
}

impl fmt::Display for PathString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(bstr::BStr::new(self.slice()), f)
    }
}

#[cfg(not(target_arch = "wasm32"))]
const _: () = {
    if USE_SMALL_PATH_STRING_ {
        assert!(
            core::mem::size_of::<PathString>() * 8 == 64,
            "PathString must be 64 bits"
        );
    } else {
        assert!(
            core::mem::size_of::<PathString>() * 8 == 128,
            "PathString must be 128 bits"
        );
    }
};

// Issue #30816: `init` / `slice_assume_z` are now `unsafe fn` so the
// lifetime / NUL-termination contract lives on the API boundary instead of
// ~50 scattered call-site notes. Rust silently coerces safe `fn` to
// `unsafe fn`, so a positive `const _: unsafe fn(..) = PathString::init`
// binding would NOT catch a regression. The call-site `unsafe { .. }`
// wrappers are the guardrail; reviewers should reject any PR that drops
// the `unsafe` keyword from either fn's signature.

// ported from: src/string/PathString.zig
