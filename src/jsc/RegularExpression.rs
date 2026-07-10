use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_core::String as BunString;

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`RegularExpression`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `JSC::Yarr::RegularExpression`. `&Self` is ABI-identical to a non-null
        /// `RegularExpression*`, and carries no `noalias`/`readonly` - C++ mutates
        /// the match cursor through it.
        pub struct RegularExpression;
    }
}

// C++ hands back a `new RegularExpression` (a `+1`); one `RegularExpression`
// handle owns exactly that allocation, and `deinit` (`delete re`) gives it back.
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ `JSC::Yarr::RegularExpression`.
    ///
    /// Owns one allocation; `Drop` deletes it. Every method takes `&self`: the ZST is
    /// `UnsafeCell`-backed and C++ advances the match cursor through the same pointer,
    /// so there is no `&mut self` to have.
    ///
    /// A handle borrowed from a pointer someone else owns (see [`Self::borrow_leaked`])
    /// is a `ManuallyDrop<RegularExpression>` - dropping it would free their regex.
    pub struct RegularExpression(sys::RegularExpression) via Yarr__RegularExpression__deinit;
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

// `&sys::RegularExpression` is ABI-identical to a non-null `RegularExpression*`
// and carries no `noalias`; Yarr mutates through it. Every shim traffics only in
// that plus POD, so all are `safe fn` — `deinit` releases, it is not exclusive.
unsafe extern "C" {
    safe fn Yarr__RegularExpression__init(
        pattern: BunString,
        flags: u16,
    ) -> *mut sys::RegularExpression;
    safe fn Yarr__RegularExpression__deinit(this: &sys::RegularExpression);
    safe fn Yarr__RegularExpression__isValid(this: &sys::RegularExpression) -> bool;
    safe fn Yarr__RegularExpression__matchedLength(this: &sys::RegularExpression) -> i32;
    // C++: int Yarr__RegularExpression__searchRev(RegularExpression*, BunString) (bindings/RegularExpression.cpp:30)
    safe fn Yarr__RegularExpression__searchRev(
        this: &sys::RegularExpression,
        string: BunString,
    ) -> i32;
    safe fn Yarr__RegularExpression__matches(
        this: &sys::RegularExpression,
        string: BunString,
    ) -> i32;
}

/// Construction and queries. `&self` throughout: C++ mutates the match cursor
/// through the same pointer.
impl RegularExpression {
    /// Borrow a regex handed to a foreign owner by [`Self::leak`].
    ///
    /// Takes **no** ownership, hence `ManuallyDrop`: dropping this would free an
    /// allocation the leak's new owner still holds.
    ///
    /// # Safety
    /// `ptr` must be live for the returned handle's lifetime.
    #[inline]
    pub unsafe fn borrow_leaked(ptr: NonNull<sys::RegularExpression>) -> ManuallyDrop<Self> {
        // SAFETY: caller contract; ManuallyDrop never releases it.
        ManuallyDrop::new(unsafe { Self::adopt(ptr) })
    }

    /// C++ `new`s the regex. On an invalid pattern the handle drops here, so the
    /// allocation is freed before the `Err` reaches the caller.
    #[inline]
    pub fn init(pattern: BunString, flags: Flags) -> Result<Self, RegularExpressionError> {
        // SAFETY: C++ `init` transfers a fresh `+1` allocation (or null) to us.
        let regex =
            unsafe { Self::adopt_ptr(Yarr__RegularExpression__init(pattern, flags as u16)) }
                .expect("Yarr__RegularExpression__init returned null");
        if !regex.is_valid() {
            return Err(RegularExpressionError::InvalidRegExp);
        }
        Ok(regex)
    }

    #[inline]
    pub fn is_valid(&self) -> bool {
        Yarr__RegularExpression__isValid(self.raw())
    }

    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&self, str: BunString) -> bool {
        Yarr__RegularExpression__matches(self.raw(), str) >= 0
    }

    #[inline]
    pub fn search_rev(&self, str: BunString) -> i32 {
        Yarr__RegularExpression__searchRev(self.raw(), str)
    }

    #[inline]
    pub fn matched_length(&self) -> i32 {
        Yarr__RegularExpression__matchedLength(self.raw())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_install_types::NodeLinker` / `bun_install::PnpmMatcher` extern impls.
//
// Those lower-tier crates cannot name `jsc::RegularExpression`.
// The bodies live here as `#[no_mangle]` Rust-ABI
// fns, declared `extern "Rust"` on the low-tier side; link-time resolved.
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub(crate) fn __bun_regex_compile(pattern: BunString) -> Option<NonNull<()>> {
    // Initialize JSC before first compile (idempotent).
    crate::initialize(false);
    // The allocation is leaked to the caller, which owns it until `__bun_regex_drop`.
    RegularExpression::init(pattern, Flags::None)
        .ok()
        .map(|r| r.leak().cast::<()>())
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_regex_matches(regex: NonNull<()>, input: &BunString) -> bool {
    // SAFETY: `regex` was leaked by `__bun_regex_compile` and stays live until
    // `__bun_regex_drop`; the borrow releases nothing.
    unsafe { RegularExpression::borrow_leaked(regex.cast()) }.matches(*input)
}

#[unsafe(no_mangle)]
pub(crate) fn __bun_regex_drop(regex: NonNull<()>) {
    // SAFETY: re-adopts the allocation leaked by `__bun_regex_compile`; `Drop` frees it.
    drop(unsafe { RegularExpression::adopt(regex.cast()) })
}
