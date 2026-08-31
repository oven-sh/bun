//! A compiled `RegExp` for crates that sit below `bun_jsc` (which owns the
//! Yarr FFI) but need to match user-supplied patterns without a VM: `.npmrc`
//! hoist patterns here, `--mangle-props` in the bundler. The bodies of the
//! `extern "Rust"` functions below are defined in `bun_jsc::regular_expression`
//! and resolved at link time; this module is their only declaration site.

use core::ptr::NonNull;

unsafe extern "Rust" {
    fn __bun_regex_compile(pattern: &[u8], js_flags: &[u8]) -> Option<NonNull<()>>;
    fn __bun_regex_matches(regex: NonNull<()>, input: &[u8]) -> bool;
    fn __bun_regex_drop(regex: NonNull<()>);
}

/// Owns a compiled pattern. Matching uses scratch state inside the pattern, so
/// the handle is `!Sync`; compile one per thread instead of sharing.
// FORWARD_DECL(b0): the pointee is a JSC-side object that only `bun_jsc` can name.
pub struct RegularExpression(NonNull<()>);

impl RegularExpression {
    /// `pattern` is a `RegExp` source and `js_flags` its flags string (`b""` for
    /// none); every flag is supported. `None` if either is invalid.
    /// Initializes JSC if nothing has yet; `NodeLinker::RegularExpression` says when that matters.
    #[inline]
    pub fn compile(pattern: &[u8], js_flags: &[u8]) -> Option<Self> {
        // SAFETY: link-time extern; both arguments are only borrowed for the call.
        unsafe { __bun_regex_compile(pattern, js_flags) }.map(Self)
    }

    /// `regexp.test(input)` for a freshly created `RegExp`.
    #[inline]
    pub fn matches(&self, input: &[u8]) -> bool {
        // SAFETY: self.0 was produced by `__bun_regex_compile` and is live until Drop.
        unsafe { __bun_regex_matches(self.0, input) }
    }
}

impl Drop for RegularExpression {
    fn drop(&mut self) {
        // SAFETY: self.0 was produced by `__bun_regex_compile`; consumed here.
        unsafe { __bun_regex_drop(self.0) }
    }
}
