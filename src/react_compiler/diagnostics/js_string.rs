//! A JavaScript string value as it appears in HIR (`PrimitiveValue::String`).
//!
//! Thin newtype over the parser's own `E::EString` arena node, so lowering is
//! a pointer copy and codegen hands the same node back. The wrapper exists
//! only to give `PrimitiveValue` value-semantic `PartialEq`/`Hash`/`Display`
//! (`StoreRef` is pointer-identity).

use core::fmt;
use core::hash::{Hash, Hasher};

use bun_alloc::{AstAlloc, AstVec};
use bun_ast::{E, StoreRef, expr};
use bun_core::{BStr, strings};

/// Invariant: the wrapped `EString` is never roped (`next.is_none()`).
/// Lowering flattens the rare rope case so every consumer here can ignore it.
#[derive(Clone, Copy)]
pub struct JsString(StoreRef<E::EString>);

impl fmt::Debug for JsString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "JsString({self})")
    }
}

impl JsString {
    #[inline]
    pub fn new(s: StoreRef<E::EString>) -> Self {
        debug_assert!(s.get().next.is_none());
        Self(s)
    }

    /// Arena-allocate an `EString` from WTF-8 input. ASCII stays 8-bit;
    /// non-ASCII is widened to UTF-16 to match the parser's `EString`
    /// encoding convention (so `eql_string`/`hash` agree across sources).
    pub fn from_wtf8_bytes(bytes: &[u8]) -> Self {
        let s = if strings::first_non_ascii(bytes).is_none() {
            E::EString::init(bun_ast::data_store_dupe_str(bytes))
        } else {
            let mut buf: AstVec<u16> = AstAlloc::vec_with_capacity(bytes.len());
            buf.extend(core::iter::repeat_n(0u16, bytes.len()));
            let n = strings::convert_utf8_to_utf16_in_buffer(&mut buf, bytes).len();
            buf.truncate(n);
            E::EString::init_utf16(buf.leak())
        };
        Self(expr::data::Store::append(s))
    }

    /// Arena-allocate an `EString` from UTF-16 code units.
    pub fn from_code_units(units: &[u16]) -> Self {
        Self(expr::data::Store::append(E::EString::init_utf16(
            AstAlloc::vec_from_slice(units).leak(),
        )))
    }

    #[inline]
    pub fn as_estring(&self) -> StoreRef<E::EString> {
        self.0
    }

    #[inline]
    pub fn estring(&self) -> &E::EString {
        self.0.get()
    }

    /// WTF-8 bytes when stored 8-bit; `None` for UTF-16.
    #[inline]
    pub fn as_bytes(&self) -> Option<&[u8]> {
        let s = self.0.get();
        (!s.is_utf16).then(|| s.slice8())
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.get().data.is_empty()
    }

    /// JS `String.prototype.length` (UTF-16 code-unit count).
    pub fn len_utf16(&self) -> usize {
        let s = self.0.get();
        if let Some(n) = s.javascript_length() {
            return n as usize;
        }
        // 8-bit non-ASCII WTF-8: count code units by lead byte.
        s.slice8()
            .iter()
            .filter(|&&b| b & 0xC0 != 0x80)
            .map(|&b| if b >= 0xF0 { 2 } else { 1 })
            .sum()
    }
}

impl From<&str> for JsString {
    fn from(s: &str) -> Self {
        Self::from_wtf8_bytes(s.as_bytes())
    }
}

impl From<String> for JsString {
    fn from(s: String) -> Self {
        Self::from_wtf8_bytes(s.as_bytes())
    }
}

impl PartialEq for JsString {
    fn eq(&self, other: &Self) -> bool {
        self.0.get().eql_string(other.0.get())
    }
}
impl Eq for JsString {}

impl Hash for JsString {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.0.get().hash().hash(h);
    }
}

impl PartialEq<str> for JsString {
    fn eq(&self, other: &str) -> bool {
        self.0.get().eql_bytes(other.as_bytes())
    }
}

impl PartialEq<&str> for JsString {
    fn eq(&self, other: &&str) -> bool {
        self.0.get().eql_bytes(other.as_bytes())
    }
}

impl fmt::Display for JsString {
    /// Debug-printer form: WTF-8 bytes via `BStr`; UTF-16 with lone surrogates
    /// rendered as lowercase `\udXXX` escapes (matches `JSON.stringify`).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = self.0.get();
        if !s.is_utf16 {
            return BStr::new(s.slice8()).fmt(f);
        }
        for r in char::decode_utf16(s.slice16().iter().copied()) {
            match r {
                Ok(c) => f.write_fmt(format_args!("{c}"))?,
                Err(e) => write!(f, "\\u{:04x}", e.unpaired_surrogate())?,
            }
        }
        Ok(())
    }
}
