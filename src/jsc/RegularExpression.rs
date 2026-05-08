use core::marker::{PhantomData, PhantomPinned};

use bun_string::String as BunString;

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
    // C++: int Yarr__RegularExpression__searchRev(RegularExpression*, BunString) (bindings/RegularExpression.cpp:30)
    fn Yarr__RegularExpression__searchRev(this: *mut RegularExpression, string: BunString) -> i32;
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
        // SAFETY: `self` is a valid live Yarr RegularExpression handle.
        unsafe { Yarr__RegularExpression__searchRev(self, str) }
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
// `bun_install_types::NodeLinker` / `bun_install::PnpmMatcher` extern impls.
//
// Those lower-tier crates cannot name `jsc::RegularExpression`. Zig
// (`PnpmMatcher.zig`) called `bun.jsc.RegularExpression.init` inline after
// `bun.jsc.initialize(false)`. The bodies live here as `#[no_mangle]` Rust-ABI
// fns, declared `extern "Rust"` on the low-tier side; link-time resolved.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub fn __bun_regex_compile(pattern: BunString) -> Option<core::ptr::NonNull<()>> {
    // Zig: `bun.jsc.initialize(false)` before first compile (idempotent).
    crate::initialize(false);
    match RegularExpression::init(pattern, Flags::None) {
        Ok(r) => core::ptr::NonNull::new(r.cast()),
        Err(_) => None,
    }
}

#[unsafe(no_mangle)]
pub fn __bun_regex_matches(regex: core::ptr::NonNull<()>, input: &BunString) -> bool {
    // SAFETY: `regex` was produced by `__bun_regex_compile`.
    unsafe { (*regex.as_ptr().cast::<RegularExpression>()).matches(*input) }
}

#[unsafe(no_mangle)]
pub fn __bun_regex_drop(regex: core::ptr::NonNull<()>) {
    // SAFETY: `regex` was produced by `__bun_regex_compile`; consumed here.
    unsafe { RegularExpression::destroy(regex.as_ptr().cast()) }
}

// ported from: src/jsc/RegularExpression.zig
