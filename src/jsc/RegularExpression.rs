use core::marker::{PhantomData, PhantomPinned};

use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::Yarr::RegularExpression`.
    pub struct RegularExpression;
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

bun_core::named_error_set!(RegularExpressionError);

// TODO(port): move to bun_jsc_sys
//
// `RegularExpression` is an opaque `UnsafeCell`-backed ZST handle, so
// `&RegularExpression` is ABI-identical to a non-null `*const` and C++ mutating
// internal Yarr state through it is interior mutation invisible to Rust. The
// query/compile shims are therefore declared `safe fn`; only `deinit` (which
// frees the allocation) keeps a raw `*mut` and stays `unsafe`.
unsafe extern "C" {
    safe fn Yarr__RegularExpression__init(pattern: BunString, flags: u16)
    -> *mut RegularExpression;
    fn Yarr__RegularExpression__deinit(pattern: *mut RegularExpression);
    safe fn Yarr__RegularExpression__isValid(this: &RegularExpression) -> bool;
    safe fn Yarr__RegularExpression__matchedLength(this: &RegularExpression) -> i32;
    // C++: int Yarr__RegularExpression__searchRev(RegularExpression*, BunString) (bindings/RegularExpression.cpp:30)
    safe fn Yarr__RegularExpression__searchRev(this: &RegularExpression, string: BunString) -> i32;
    safe fn Yarr__RegularExpression__matches(this: &RegularExpression, string: BunString) -> i32;
}

impl RegularExpression {
    #[inline]
    pub fn init(
        pattern: BunString,
        flags: Flags,
    ) -> Result<*mut RegularExpression, RegularExpressionError> {
        let regex = Yarr__RegularExpression__init(pattern, flags as u16);
        // `RegularExpression` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null-ZST deref proof (panics on null, which
        // `Yarr__RegularExpression__init` never returns).
        if !RegularExpression::opaque_mut(regex).is_valid() {
            // SAFETY: `regex` is a valid live Yarr handle we just allocated; consumed here.
            unsafe { Self::destroy(regex) };
            return Err(RegularExpressionError::InvalidRegExp);
        }
        // TODO(port): consider an owning wrapper with Drop instead of returning a raw *mut.
        Ok(regex)
    }

    #[inline]
    pub fn is_valid(&mut self) -> bool {
        Yarr__RegularExpression__isValid(self)
    }

    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&mut self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&mut self, str: BunString) -> bool {
        Yarr__RegularExpression__matches(self, str) >= 0
    }

    #[inline]
    pub fn search_rev(&mut self, str: BunString) -> i32 {
        Yarr__RegularExpression__searchRev(self, str)
    }

    #[inline]
    pub fn matched_length(&mut self) -> i32 {
        Yarr__RegularExpression__matchedLength(self)
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
    // `RegularExpression` is an `opaque_ffi!` ZST handle; `opaque_mut` is the
    // centralised non-null deref proof. `regex` was produced by
    // `__bun_regex_compile` and remains live until `__bun_regex_drop`.
    RegularExpression::opaque_mut(regex.as_ptr().cast()).matches(*input)
}

#[unsafe(no_mangle)]
pub fn __bun_regex_drop(regex: core::ptr::NonNull<()>) {
    // SAFETY: `regex` was produced by `__bun_regex_compile`; consumed here.
    unsafe { RegularExpression::destroy(regex.as_ptr().cast()) }
}

// ported from: src/jsc/RegularExpression.zig
