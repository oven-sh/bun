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

// macOS sets file path limit to 1024
// Since a pointer on x64 is 64 bits and only 46 bits are used
// We can safely store the entire path slice in a single u64.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub struct PathString(PathStringBackingInt);

impl PathString {
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

    pub fn estimated_size(self) -> usize {
        self.len()
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = self.ptr();
        if ptr == 0 {
            // Rust forbids slice::from_raw_parts(null, 0); return a valid empty slice.
            return &[];
        }
        // SAFETY: PathString::init was given a live &[u8] of this len; caller
        // guarantees the borrowed memory outlives this PathString.
        unsafe { core::slice::from_raw_parts(ptr as *const u8, self.len()) }
    }

    #[inline]
    pub fn slice_assume_z(&self) -> &ZStr {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = self.ptr();
        if ptr == 0 {
            return ZStr::EMPTY;
        }
        // SAFETY: caller asserts the backing buffer has a NUL at [len].
        unsafe { ZStr::from_raw(ptr as *const u8, self.len()) }
    }

    /// Create a PathString from a borrowed slice. No allocation occurs.
    #[inline]
    pub fn init(str: &[u8]) -> Self {
        // Zig: @setRuntimeSafety(false) — "cast causes pointer to be null" is
        // fine here. if it is null, the len will be 0.
        let ptr = (str.as_ptr() as usize as PathStringBackingInt) & Self::PTR_MASK; // @truncate
        let len = (str.len() as PathStringBackingInt) << POINTER_BITS; // @truncate into PathInt
        Self(ptr | len)
    }

    #[inline]
    pub fn init_owned(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        let raw: *mut [u8] = crate::heap::into_raw(bytes.into_boxed_slice());
        // SAFETY: `raw` is a fresh non-null allocation; reborrow only to pack
        // ptr+len into the backing int.
        Self::init(unsafe { &*raw })
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
        drop(unsafe { crate::heap::take(std::ptr::slice_from_raw_parts_mut(ptr as *mut u8, len)) });
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

// ported from: src/string/PathString.zig
