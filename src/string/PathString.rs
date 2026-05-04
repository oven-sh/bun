use core::fmt;

use bun_paths::MAX_PATH_BYTES;
use bun_str::ZStr;

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
// TODO(port): Zig picks the backing integer type (u64 vs u128) at comptime from
// USE_SMALL_PATH_STRING_. Stable Rust cannot select a type alias from a const
// bool; all supported Bun targets are 64-bit so we hard-code u64 and assert the
// invariant below. Revisit if a target needs the u128 layout.
type PathStringBackingInt = u64;

// Bit widths of the packed fields (Zig packed-struct order: ptr in low bits, len in high bits).
const POINTER_BITS: u32 = if USE_SMALL_PATH_STRING_ { 53 } else { usize::BITS };
#[allow(dead_code)]
const LEN_BITS: u32 = if USE_SMALL_PATH_STRING_ { PATH_INT_LEN_BITS } else { usize::BITS };

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

    const PTR_MASK: PathStringBackingInt = (1 as PathStringBackingInt).wrapping_shl(POINTER_BITS).wrapping_sub(1);

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
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }

    pub const EMPTY: Self = Self(0);
}

impl fmt::Display for PathString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(bstr::BStr::new(self.slice()), f)
    }
}

#[cfg(not(target_arch = "wasm32"))]
const _: () = {
    if USE_SMALL_PATH_STRING_ {
        assert!(core::mem::size_of::<PathString>() * 8 == 64, "PathString must be 64 bits");
    } else {
        // TODO(port): unreachable on current targets (backing int is hard-coded u64).
        assert!(core::mem::size_of::<PathString>() * 8 == 128, "PathString must be 128 bits");
    }
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/PathString.zig (64 lines)
//   confidence: medium
//   todos:      2
//   notes:      packed-struct → repr(transparent) u64 with shift accessors; comptime u64/u128 backing-type selection hard-coded to u64 (all Bun targets are 64-bit)
// ──────────────────────────────────────────────────────────────────────────
