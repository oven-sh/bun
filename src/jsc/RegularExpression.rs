use bun_core::String as BunString;
use bun_core::StringView;

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

// `RegularExpression` is an opaque `UnsafeCell`-backed ZST handle, so
// `&RegularExpression` is ABI-identical to a non-null `*const` and C++ mutating
// internal Yarr state through it is interior mutation invisible to Rust. The
// query/compile shims are therefore declared `safe fn`; only `deinit` (which
// frees the allocation) keeps a raw `*mut` and stays `unsafe`.
unsafe extern "C" {
    safe fn Yarr__RegularExpression__init(
        pattern: &BunString,
        flags: u16,
    ) -> *mut RegularExpression;
    fn Yarr__RegularExpression__deinit(pattern: *mut RegularExpression);
    safe fn Yarr__RegularExpression__isValid(this: &RegularExpression) -> bool;
    safe fn Yarr__RegularExpression__matches(this: &RegularExpression, string: &BunString) -> i32;
}

impl RegularExpression {
    #[inline]
    pub fn init(
        pattern: &BunString,
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
        Ok(regex)
    }

    #[inline]
    pub(crate) fn is_valid(&mut self) -> bool {
        Yarr__RegularExpression__isValid(self)
    }

    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&mut self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&mut self, str: &BunString) -> bool {
        Yarr__RegularExpression__matches(self, str) >= 0
    }

    /// Destroys the FFI-allocated handle. Caller must not use `this` afterwards.
    #[inline]
    pub(crate) unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` is a valid live Yarr RegularExpression handle; consumed here.
        unsafe { Yarr__RegularExpression__deinit(this) }
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `Bun::RegExpMatcher` (RegularExpression.cpp): a
    /// `RegExp` source + flags compiled for `regexp.test(input)` matching.
    /// Unlike `RegularExpression` it supports every RegExp flag.
    struct RegExpMatcher;
}

// Same `safe fn` reasoning as the `RegularExpression` shims above.
unsafe extern "C" {
    safe fn Bun__RegExpMatcher__create(
        pattern: &BunString,
        flags: &BunString,
    ) -> Option<core::ptr::NonNull<RegExpMatcher>>;
    safe fn Bun__RegExpMatcher__matches(this: &RegExpMatcher, input: &BunString) -> bool;
    fn Bun__RegExpMatcher__destroy(this: *mut RegExpMatcher);
}

// ──────────────────────────────────────────────────────────────────────────
// Bodies of the `extern "Rust"` bridge declared in `bun_install_types::regex`,
// which `PnpmMatcher` and the bundler's `--mangle-props` use because their
// crates cannot depend on this one.
// ──────────────────────────────────────────────────────────────────────────

/// `None` if `pattern` or `js_flags` (a `RegExp.prototype.flags` string) is invalid.
#[unsafe(no_mangle)]
fn __bun_regex_compile(pattern: &[u8], js_flags: &[u8]) -> Option<core::ptr::NonNull<()>> {
    // Idempotent. Only `bun install` (hoist patterns) and `bun build` (mangle
    // patterns) get here before initializing JSC, and both use the defaults.
    crate::initialize(crate::InitializeOptions::default());
    // Both strings are only read while compiling, so borrowed views suffice.
    let matcher = Bun__RegExpMatcher__create(
        &StringView::from_bytes(pattern),
        &StringView::from_bytes(js_flags),
    )?;
    Some(matcher.cast())
}

#[unsafe(no_mangle)]
fn __bun_regex_matches(regex: core::ptr::NonNull<()>, input: &[u8]) -> bool {
    // `regex` was produced by `__bun_regex_compile` and is live until
    // `__bun_regex_drop`; `opaque_ref` is the centralised non-null deref proof.
    Bun__RegExpMatcher__matches(
        RegExpMatcher::opaque_ref(regex.as_ptr().cast()),
        &StringView::from_bytes(input),
    )
}

#[unsafe(no_mangle)]
fn __bun_regex_drop(regex: core::ptr::NonNull<()>) {
    // SAFETY: `regex` was produced by `__bun_regex_compile`; consumed here.
    unsafe { Bun__RegExpMatcher__destroy(regex.as_ptr().cast()) }
}
