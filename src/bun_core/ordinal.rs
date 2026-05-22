// ──────────────────────────────────────────────────────────────────────────
// Small helpers from src/bun.zig that downstream crates need.
// ──────────────────────────────────────────────────────────────────────────

/// Zig `bun.Generation` (bun.zig:1926) — bumped each rebuild/rescan to
/// invalidate stale cache entries.
pub type Generation = u16;

// ── Ordinal ───────────────────────────────────────────────────────────────
// Port of `OrdinalT(c_int)` (bun.zig:3421). ABI-equivalent of WTF::OrdinalNumber:
// a zero-based index where -1 means "invalid". Represented as a transparent
// newtype rather than a Rust enum so the full `c_int` range round-trips across
// FFI without UB.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Ordinal(pub core::ffi::c_int);

impl Ordinal {
    pub const INVALID: Self = Self(-1);
    pub const START: Self = Self(0);

    #[inline]
    pub const fn from_zero_based(int: core::ffi::c_int) -> Self {
        debug_assert!(int >= 0);
        Self(int)
    }
    #[inline]
    pub const fn from_one_based(int: core::ffi::c_int) -> Self {
        debug_assert!(int > 0);
        Self(int - 1)
    }
    #[inline]
    pub const fn zero_based(self) -> core::ffi::c_int {
        self.0
    }
    #[inline]
    pub const fn one_based(self) -> core::ffi::c_int {
        self.0 + 1
    }
    /// Add two ordinal numbers together. Both are converted to zero-based before addition.
    #[inline]
    pub const fn add(self, b: Self) -> Self {
        Self::from_zero_based(self.0 + b.0)
    }
    /// Add a scalar value to an ordinal number.
    #[inline]
    pub const fn add_scalar(self, inc: core::ffi::c_int) -> Self {
        Self::from_zero_based(self.0 + inc)
    }
    #[inline]
    pub const fn is_valid(self) -> bool {
        self.0 >= 0
    }
}
impl Default for Ordinal {
    #[inline]
    fn default() -> Self {
        Self::INVALID
    }
}
