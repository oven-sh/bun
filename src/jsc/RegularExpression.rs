use core::marker::{PhantomData, PhantomPinned};

use bun_str::String as BunString;

/// Opaque FFI handle for `JSC::Yarr::RegularExpression`.
#[repr(C)]
pub struct RegularExpression {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Flags {
    None = 0,

    HasIndices = 1 << 0,
    Global = 1 << 1,
    IgnoreCase = 1 << 2,
    Multiline = 1 << 3,
    DotAll = 1 << 4,
    Unicode = 1 << 5,
    UnicodeSets = 1 << 6,
    Sticky = 1 << 7,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum RegularExpressionError {
    #[error("InvalidRegExp")]
    InvalidRegExp,
}

impl From<RegularExpressionError> for bun_core::Error {
    fn from(e: RegularExpressionError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

// TODO(port): move to bun_jsc_sys
unsafe extern "C" {
    fn Yarr__RegularExpression__init(pattern: BunString, flags: u16) -> *mut RegularExpression;
    fn Yarr__RegularExpression__deinit(pattern: *mut RegularExpression);
    fn Yarr__RegularExpression__isValid(this: *mut RegularExpression) -> bool;
    fn Yarr__RegularExpression__matchedLength(this: *mut RegularExpression) -> i32;
    fn Yarr__RegularExpression__searchRev(this: *mut RegularExpression) -> i32;
    fn Yarr__RegularExpression__matches(this: *mut RegularExpression, string: BunString) -> i32;
}

impl RegularExpression {
    #[inline]
    pub fn init(
        pattern: BunString,
        flags: Flags,
    ) -> Result<*mut RegularExpression, RegularExpressionError> {
        // SAFETY: FFI call into JSC Yarr; `pattern` is #[repr(C)] and passed by value.
        let regex = unsafe { Yarr__RegularExpression__init(pattern, flags as u16) };
        // SAFETY: Yarr__RegularExpression__init always returns a non-null heap allocation.
        let regex_ref = unsafe { &mut *regex };
        if !regex_ref.is_valid() {
            // SAFETY: `regex` is a valid live Yarr handle we just allocated; consumed here.
            unsafe { Self::destroy(regex) };
            return Err(RegularExpressionError::InvalidRegExp);
        }
        // TODO(port): consider an owning wrapper with Drop instead of returning a raw *mut.
        Ok(regex)
    }

    #[inline]
    pub fn is_valid(&mut self) -> bool {
        // SAFETY: `self` is a valid live Yarr RegularExpression handle.
        unsafe { Yarr__RegularExpression__isValid(self) }
    }

    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&mut self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&mut self, str: BunString) -> bool {
        // SAFETY: `self` is a valid live Yarr RegularExpression handle.
        unsafe { Yarr__RegularExpression__matches(self, str) >= 0 }
    }

    #[inline]
    pub fn search_rev(&mut self, str: BunString) -> i32 {
        // TODO(port): Zig source passes `str` here but the extern decl takes no string
        // argument — mirrors the upstream mismatch; verify C++ signature in Phase B.
        let _ = str;
        // SAFETY: `self` is a valid live Yarr RegularExpression handle.
        unsafe { Yarr__RegularExpression__searchRev(self) }
    }

    #[inline]
    pub fn matched_length(&mut self) -> i32 {
        // SAFETY: `self` is a valid live Yarr RegularExpression handle.
        unsafe { Yarr__RegularExpression__matchedLength(self) }
    }

    /// Destroys the FFI-allocated handle. Caller must not use `this` afterwards.
    #[inline]
    pub unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` is a valid live Yarr RegularExpression handle; consumed here.
        unsafe { Yarr__RegularExpression__deinit(this) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/RegularExpression.zig (57 lines)
//   confidence: high
//   todos:      3
//   notes:      search_rev arg mismatch mirrors Zig bug; init returns raw *mut (FFI-owned)
// ──────────────────────────────────────────────────────────────────────────
