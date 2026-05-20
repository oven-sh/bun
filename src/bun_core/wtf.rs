//! `bun_core::wtf` — thin FFI wrappers over linked WTF (WebKit) utilities.
//!
//! Per docs/PORTING.md §Forbidden patterns, we never re-implement C/C++
//! library code in Rust. WTF is statically linked into the binary, so
//! tier-0 callers declare the C symbol directly — no `bun_jsc` crate
//! dependency is required to reference it.
//!
//! Source of truth: `src/jsc/bindings/wtf-bindings.cpp` (`WTF__parseES5Date`),
//! which forwards to `WTF::parseES5Date` in
//! vendor/WebKit `Source/WTF/wtf/DateMath.{h,cpp}`.
//!
//! PORT NOTE: WTF's `parseES5Date` sets an `isLocalTime` out-param so the JS
//! `Date` constructor can later apply the VM's tz offset. The C shim discards
//! it (matching `src/jsc/WTF.zig`), so local-time inputs return their naive
//! UTC value here too.

unsafe extern "C" {
    // src/jsc/bindings/wtf-bindings.cpp:
    //   extern "C" double WTF__parseES5Date(const Latin1Character* string, size_t length)
    fn WTF__parseES5Date(bytes: *const u8, length: usize) -> f64;
}

/// Direct call to `WTF::parseES5Date`. Returns NaN for any input the WTF
/// parser rejects. `s` is treated as Latin-1.
#[inline]
pub fn parse_es5_date_raw(s: &[u8]) -> f64 {
    // SAFETY: s.as_ptr() is valid for s.len() bytes.
    unsafe { WTF__parseES5Date(s.as_ptr(), s.len()) }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDate;

impl core::fmt::Display for InvalidDate {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str("InvalidDate")
    }
}
impl core::error::Error for InvalidDate {}

impl From<InvalidDate> for crate::Error {
    fn from(_: InvalidDate) -> Self {
        crate::Error::from_name("InvalidDate")
    }
}

/// `bun.jsc.wtf.parseES5Date` shape — `Err` on empty input or non-finite result.
/// `2000-01-01T00:00:00.000Z` → `Ok(946684800000.0)`.
pub fn parse_es5_date(buf: &[u8]) -> Result<f64, InvalidDate> {
    if buf.is_empty() {
        return Err(InvalidDate);
    }
    let ms = parse_es5_date_raw(buf);
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
    InvalidCharacter, RefPtr, StringImpl, WTFString, WTFStringImpl, WTFStringImplExt,
    WTFStringImplStruct, parse_double,
};

// ported from: src/jsc/WTF.zig
