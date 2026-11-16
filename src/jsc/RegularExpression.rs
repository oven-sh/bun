use core::ptr::NonNull;

use bun_core::String as BunString;

bun_opaque::sealed_handle! {
    /// Opaque FFI handle for `Bun::RegularExpression` (RegularExpression.cpp).
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
        flags: Flags,
    ) -> OwnedRegularExpression;
    fn Yarr__RegularExpression__deinit(pattern: *mut RegularExpression);
    safe fn Yarr__RegularExpression__isValid(this: &RegularExpression) -> bool;
    safe fn Yarr__RegularExpression__matches(this: &RegularExpression, string: &BunString) -> i32;
}

// SAFETY: made by `Yarr__RegularExpression__init`, and again by `__bun_regex_drop` from one that was not dropped.
bun_opaque::owned_handle! {
    pub struct OwnedRegularExpression(RegularExpression) => unsafe Yarr__RegularExpression__deinit;
}

impl OwnedRegularExpression {
    pub fn new(pattern: &BunString, flags: Flags) -> Result<Self, RegularExpressionError> {
        let regex = Yarr__RegularExpression__init(pattern, flags);
        if !Yarr__RegularExpression__isValid(&regex) {
            return Err(RegularExpressionError::InvalidRegExp);
        }
        Ok(regex)
    }
}

impl RegularExpression {
    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&mut self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&self, str: &BunString) -> bool {
        Yarr__RegularExpression__matches(self, str) >= 0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_install_types::NodeLinker` / `bun_install::PnpmMatcher` extern impls.
//
// Those lower-tier crates cannot name `bun_jsc::OwnedRegularExpression`.
// The bodies live here as `#[no_mangle]` Rust-ABI
// fns, declared `extern "Rust"` on the low-tier side; link-time resolved.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
fn __bun_regex_compile(pattern: &BunString) -> Option<NonNull<()>> {
    // Idempotent. Only the install commands reach this before initializing
    // JSC themselves, and the defaults are right for them; every other command
    // has already initialized JSC with its own options by the time a matcher
    // first runs (see `bun_install_types::NodeLinker::RegularExpression`).
    crate::initialize(crate::InitializeOptions::default());
    let regex = OwnedRegularExpression::new(pattern, Flags::None).ok()?;
    Some(core::mem::ManuallyDrop::new(regex).0.cast())
}

/// # Safety
/// `regex` is from `__bun_regex_compile` and was not given to `__bun_regex_drop`.
#[unsafe(no_mangle)]
unsafe fn __bun_regex_matches(regex: NonNull<()>, input: &BunString) -> bool {
    // SAFETY: the caller's contract.
    unsafe { regex.cast::<RegularExpression>().as_ref() }.matches(input)
}

/// # Safety
/// As [`__bun_regex_matches`].
#[unsafe(no_mangle)]
unsafe fn __bun_regex_drop(regex: NonNull<()>) {
    drop(OwnedRegularExpression(regex.cast()));
}

// `bun_yarr` is below this crate too. It calls RegularExpression.cpp itself: this is all it needs from here.
#[unsafe(no_mangle)]
fn __bun_yarr_initialize() {
    // Idempotent. `bun lint` and `bun fmt` reach this before anything else starts JSC, and the defaults are theirs.
    crate::initialize(crate::InitializeOptions::default());
}
