//! `bun_core::wtf` — thin FFI wrappers over linked WTF (WebKit) utilities.
//!
//! Per docs/PORTING.md §Forbidden patterns, we never re-implement C/C++
//! library code in Rust. WTF is statically linked into the binary, so
//! tier-0 callers declare the C symbol directly — no `bun_jsc` crate
//! dependency is required to reference it.

unsafe extern "C" {
    // src/jsc/bindings/wtf-bindings.cpp
    fn Bun__parseDateTimeString(bytes: *const u8, length: usize) -> f64;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDate;

impl core::fmt::Display for InvalidDate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidDate")
    }
}
impl core::error::Error for InvalidDate {}

/// JS `Date.parse(buf)` with no VM, except that a date-time with no time zone reads as UTC.
pub fn parse_date(buf: &[u8]) -> Result<f64, InvalidDate> {
    if buf.is_empty() {
        return Err(InvalidDate);
    }
    // SAFETY: `buf.as_ptr()` is valid for `buf.len()` bytes.
    let ms = unsafe { Bun__parseDateTimeString(buf.as_ptr(), buf.len()) };
    if ms.is_finite() {
        Ok(ms)
    } else {
        Err(InvalidDate)
    }
}

// `WTF::parseDouble` — re-exported from the merged `string::wtf` module so
// `bun_core::wtf::parse_double` (formerly `bun_core::wtf::parse_double`)
// resolves unchanged.
pub use crate::string::wtf::{
    InvalidCharacter, WTFString, WTFStringImpl, WTFStringImplExt, WTFStringImplStruct, parse_double,
};
