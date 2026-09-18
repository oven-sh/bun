//! `bun_core::wtf` — thin FFI wrappers over linked WebKit (WTF, JSC) utilities.
//!
//! Per docs/PORTING.md §Forbidden patterns, we never re-implement C/C++
//! library code in Rust. WebKit is statically linked into the binary, so
//! tier-0 callers declare the C symbol directly — no `bun_jsc` crate
//! dependency is required to reference it.

unsafe extern "C" {
    // src/jsc/bindings/wtf-bindings.cpp:
    //   extern "C" double Bun__parseDateString(const unsigned char* string, size_t length)
    fn Bun__parseDateString(bytes: *const u8, length: usize) -> f64;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDate;

impl core::fmt::Display for InvalidDate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidDate")
    }
}
impl core::error::Error for InvalidDate {}

/// Same forms and result as JS `Date.parse` in bun. `Err` on empty or unreadable input.
pub fn parse_date(s: &[u8]) -> Result<f64, InvalidDate> {
    if s.is_empty() {
        return Err(InvalidDate);
    }
    // SAFETY: s.as_ptr() is valid for s.len() bytes.
    let ms = unsafe { Bun__parseDateString(s.as_ptr(), s.len()) };
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
