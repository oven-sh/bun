//! `bun_core::wtf` — thin FFI wrappers over linked WTF (WebKit) utilities.
//!
//! Per docs/PORTING.md §Forbidden patterns, we never re-implement C/C++
//! library code in Rust. WTF is statically linked into the binary, so
//! tier-0 callers declare the C symbol directly — no `bun_jsc` crate
//! dependency is required to reference it.
//!
//! Source of truth: `src/jsc/bindings/wtf-bindings.cpp` (`Bun__parseDateTimeString`),
//! which forwards to `v8::ParseDateTimeString` in
//! vendor/WebKit `Source/JavaScriptCore/runtime/JSDateMath-v8.{h,cpp}`, the
//! parser behind JS `Date.parse`.
//!
//! Note: the parser sets a `local` out-param so the JS `Date` constructor can
//! later apply the VM's tz offset. The C shim discards it, so local-time
//! inputs return their naive UTC value here.

unsafe extern "C" {
    // src/jsc/bindings/wtf-bindings.cpp:
    //   extern "C" double Bun__parseDateTimeString(const Latin1Character* string, size_t length)
    fn Bun__parseDateTimeString(bytes: *const u8, length: usize) -> f64;
}

/// Direct call to the parser. Returns NaN for any input `Date.parse` rejects.
/// `s` is treated as Latin-1.
#[inline]
pub(crate) fn parse_date_raw(s: &[u8]) -> f64 {
    // SAFETY: s.as_ptr() is valid for s.len() bytes.
    unsafe { Bun__parseDateTimeString(s.as_ptr(), s.len()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDate;

impl core::fmt::Display for InvalidDate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidDate")
    }
}
impl core::error::Error for InvalidDate {}

/// What JS `Date.parse` returns for `buf`, without a VM. `Err` where `Date.parse` returns NaN.
/// `2000-01-01T00:00:00.000Z` → `Ok(946684800000.0)`.
pub fn parse_date(buf: &[u8]) -> Result<f64, InvalidDate> {
    if buf.is_empty() {
        return Err(InvalidDate);
    }
    let ms = parse_date_raw(buf);
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
