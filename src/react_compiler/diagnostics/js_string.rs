//! A JavaScript string value. JS strings are sequences of UTF-16 code units
//! with no validity requirement, so a value can contain unpaired surrogate
//! halves that Rust's `String` cannot represent. `JsString` keeps the common
//! valid case as UTF-8 and falls back to code units only when the value is
//! ill-formed, so the compiler computes on true program values instead of
//! replacement characters or escape hatches.
//!
//! Storage is arena-backed (`StoreStr` / `StoreSlice<u16>`): `JsString` is held
//! inside HIR nodes (`PrimitiveValue::String`) which live in `AstVec`s that are
//! bulk-freed without running `Drop`, so the representation must not own a heap
//! allocation.
//!
//! Wire format: the babel bridge transports lone surrogates as
//! `__SURROGATE_XXXX__` markers (see `sanitizeJsonSurrogates` in bridge.ts),
//! because serde_json can neither parse nor emit a lone `\uXXXX` escape.

use core::fmt;
use core::hash::{Hash, Hasher};

use bun_alloc::{AstAlloc, AstVec};
use bun_ast::{StoreSlice, StoreStr};

/// Invariant: `Repr::Utf8` holds every well-formed value and `Repr::Wtf16`
/// only ill-formed ones (at least one unpaired surrogate). `PartialEq`/`Hash`
/// are only sound under this invariant: a well-formed value smuggled into
/// `Wtf16` would compare unequal to its `Utf8` twin. The representation is
/// private so the invariant holds by construction; match on
/// [`JsString::as_ref`] to branch on well-formedness.
#[derive(Debug, Clone, Copy)]
pub struct JsString(Repr);

#[derive(Debug, Clone, Copy)]
enum Repr {
    /// A well-formed string (no unpaired surrogates), stored as arena UTF-8.
    Utf8(StoreStr),
    /// An ill-formed string, stored as arena UTF-16 code units.
    Wtf16(StoreSlice<u16>),
}

/// Borrowed view of a [`JsString`] for callers that need to branch on
/// well-formedness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsStringRef<'a> {
    Utf8(&'a str),
    Wtf16(&'a [u16]),
}

#[inline]
fn utf8(s: StoreStr) -> &'static str {
    // SAFETY: `Repr::Utf8` is only constructed from `&str`/`String` or from a
    // successfully decoded UTF-16 sequence, so the bytes are always valid
    // UTF-8 by invariant.
    unsafe { core::str::from_utf8_unchecked(s.slice()) }
}

#[inline]
fn arena_utf8(s: &str) -> StoreStr {
    let mut v: AstVec<u8> = AstAlloc::vec_with_capacity(s.len());
    v.extend_from_slice(s.as_bytes());
    StoreStr::new(v.leak())
}

#[inline]
fn arena_u16(units: &[u16]) -> StoreSlice<u16> {
    StoreSlice::new_mut(AstAlloc::vec_from_slice(units).leak())
}

impl JsString {
    /// Build from UTF-16 code units, normalizing to UTF-8 when well-formed.
    pub fn from_code_units(units: &[u16]) -> Self {
        let mut utf8_len = 0usize;
        for r in char::decode_utf16(units.iter().copied()) {
            match r {
                Ok(c) => utf8_len += c.len_utf8(),
                Err(_) => return JsString(Repr::Wtf16(arena_u16(units))),
            }
        }
        let mut buf: AstVec<u8> = AstAlloc::vec_with_capacity(utf8_len);
        let mut tmp = [0u8; 4];
        for c in char::decode_utf16(units.iter().copied()).flatten() {
            buf.extend_from_slice(c.encode_utf8(&mut tmp).as_bytes());
        }
        JsString(Repr::Utf8(StoreStr::new(buf.leak())))
    }

    pub fn as_ref(&self) -> JsStringRef<'_> {
        match self.0 {
            Repr::Utf8(s) => JsStringRef::Utf8(utf8(s)),
            Repr::Wtf16(units) => JsStringRef::Wtf16(units.slice()),
        }
    }

    /// The UTF-8 view, when the value is well-formed.
    pub fn as_str(&self) -> Option<&str> {
        match self.0 {
            Repr::Utf8(s) => Some(utf8(s)),
            Repr::Wtf16(_) => None,
        }
    }

    pub fn code_units(&self) -> Vec<u16> {
        match self.0 {
            Repr::Utf8(s) => utf8(s).encode_utf16().collect(),
            Repr::Wtf16(units) => units.slice().to_vec(),
        }
    }

    /// Length in UTF-16 code units (JS `String.prototype.length`).
    pub fn len_utf16(&self) -> usize {
        match self.0 {
            Repr::Utf8(s) => utf8(s).encode_utf16().count(),
            Repr::Wtf16(units) => units.slice().len(),
        }
    }

    /// Decode the bridge wire form: a UTF-8 string in which lone surrogates
    /// appear as `__SURROGATE_XXXX__` markers (uppercase hex, mirroring what
    /// `sanitizeJsonSurrogates` emits and `restoreJsonSurrogates` accepts).
    ///
    /// All scanning is byte-wise: a marker is 18 ASCII bytes, so byte-slice
    /// comparisons cannot land on a UTF-8 char boundary the way `str` range
    /// indexing can when multibyte text follows the prefix.
    pub fn from_marker_string(s: &str) -> Self {
        const PREFIX: &[u8] = b"__SURROGATE_";
        const MARKER_LEN: usize = 18;
        if !s.contains("__SURROGATE_") {
            return JsString(Repr::Utf8(arena_utf8(s)));
        }
        let bytes = s.as_bytes();
        let mut units: Vec<u16> = Vec::with_capacity(s.len());
        let mut pos = 0;
        let mut segment_start = 0;
        while let Some(found) = s[pos..].find("__SURROGATE_") {
            let idx = pos + found;
            let tail = &bytes[idx..];
            let well_formed = tail.len() >= MARKER_LEN
                && &tail[MARKER_LEN - 2..MARKER_LEN] == b"__"
                && tail[PREFIX.len()..PREFIX.len() + 4]
                    .iter()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_lowercase());
            if well_formed {
                let mut unit = 0u16;
                for &b in &tail[PREFIX.len()..PREFIX.len() + 4] {
                    let d = match b {
                        b'0'..=b'9' => b - b'0',
                        _ => b - b'A' + 10,
                    };
                    unit = (unit << 4) | d as u16;
                }
                units.extend(s[segment_start..idx].encode_utf16());
                units.push(unit);
                pos = idx + MARKER_LEN;
                segment_start = pos;
            } else {
                // Not a well-formed marker: keep the literal text and continue
                // scanning after the prefix.
                pos = idx + PREFIX.len();
            }
        }
        units.extend(s[segment_start..].encode_utf16());
        JsString::from_code_units(&units)
    }

    /// Encode to the bridge wire form (markers for unpaired surrogates).
    pub fn to_marker_string(&self) -> String {
        match self.0 {
            Repr::Utf8(s) => utf8(s).to_owned(),
            Repr::Wtf16(units) => {
                use core::fmt::Write;
                let units = units.slice();
                let mut out = String::with_capacity(units.len() * 2);
                let mut iter = units.iter().copied().peekable();
                while let Some(unit) = iter.next() {
                    match unit {
                        0xD800..=0xDBFF => {
                            if let Some(&next) = iter.peek() {
                                if (0xDC00..=0xDFFF).contains(&next) {
                                    iter.next();
                                    let cp = 0x10000
                                        + ((unit as u32 - 0xD800) << 10)
                                        + (next as u32 - 0xDC00);
                                    out.push(char::from_u32(cp).expect("valid supplementary"));
                                    continue;
                                }
                            }
                            let _ = write!(out, "__SURROGATE_{unit:04X}__");
                        }
                        0xDC00..=0xDFFF => {
                            let _ = write!(out, "__SURROGATE_{unit:04X}__");
                        }
                        _ => {
                            out.push(
                                char::from_u32(unit as u32).expect("BMP non-surrogate is a char"),
                            );
                        }
                    }
                }
                out
            }
        }
    }
}

impl From<String> for JsString {
    fn from(s: String) -> Self {
        // A Rust String is valid UTF-8 and so cannot contain an unpaired
        // surrogate; constructing Utf8 directly preserves the invariant.
        JsString(Repr::Utf8(arena_utf8(&s)))
    }
}

impl From<&str> for JsString {
    fn from(s: &str) -> Self {
        JsString(Repr::Utf8(arena_utf8(s)))
    }
}

impl PartialEq for JsString {
    fn eq(&self, other: &Self) -> bool {
        match (self.0, other.0) {
            (Repr::Utf8(a), Repr::Utf8(b)) => a.slice() == b.slice(),
            (Repr::Wtf16(a), Repr::Wtf16(b)) => a.slice() == b.slice(),
            _ => false,
        }
    }
}
impl Eq for JsString {}

impl Hash for JsString {
    fn hash<H: Hasher>(&self, h: &mut H) {
        core::mem::discriminant(&self.0).hash(h);
        match self.0 {
            Repr::Utf8(s) => s.slice().hash(h),
            Repr::Wtf16(u) => u.slice().hash(h),
        }
    }
}

impl PartialEq<str> for JsString {
    fn eq(&self, other: &str) -> bool {
        self.as_str() == Some(other)
    }
}

impl PartialEq<&str> for JsString {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == Some(*other)
    }
}

impl fmt::Display for JsString {
    /// JS-source-style escaped text, matching the form TS's debug printer
    /// produces via JSON.stringify: unpaired surrogates print as lowercase
    /// `\udXXX` escapes inside the otherwise UTF-8 text.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use core::fmt::Write as _;
        match self.0 {
            Repr::Utf8(s) => f.write_str(utf8(s)),
            Repr::Wtf16(units) => {
                let mut iter = units.slice().iter().copied().peekable();
                while let Some(unit) = iter.next() {
                    match unit {
                        0xD800..=0xDBFF => {
                            if let Some(&next) = iter.peek() {
                                if (0xDC00..=0xDFFF).contains(&next) {
                                    iter.next();
                                    let cp = 0x10000
                                        + ((unit as u32 - 0xD800) << 10)
                                        + (next as u32 - 0xDC00);
                                    f.write_char(char::from_u32(cp).expect("valid supplementary"))?;
                                    continue;
                                }
                            }
                            write!(f, "\\u{unit:04x}")?;
                        }
                        0xDC00..=0xDFFF => {
                            write!(f, "\\u{unit:04x}")?;
                        }
                        _ => {
                            f.write_char(
                                char::from_u32(unit as u32).expect("BMP non-surrogate is a char"),
                            )?;
                        }
                    }
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::JsString;
    use super::JsStringRef;

    #[test]
    fn as_ref_views_match_well_formedness() {
        assert!(matches!(
            JsString::from("plain").as_ref(),
            JsStringRef::Utf8("plain")
        ));
        assert!(matches!(
            JsString::from_code_units(&[0xD83E]).as_ref(),
            JsStringRef::Wtf16(&[0xD83E])
        ));
        // Well-formed code units normalize to the Utf8 representation, so
        // equal logical strings are equal values regardless of how they
        // were constructed.
        assert_eq!(
            JsString::from_code_units(&"plain".encode_utf16().collect::<Vec<_>>()),
            JsString::from("plain")
        );
    }

    #[test]
    fn marker_round_trip_preserves_lone_surrogates() {
        let js = JsString::from_marker_string("__SURROGATE_D83E__");
        assert_eq!(js.code_units(), vec![0xD83E]);
        assert_eq!(js.to_marker_string(), "__SURROGATE_D83E__");
        assert_eq!(js.to_string(), "\\ud83e");
    }

    #[test]
    fn paired_halves_render_as_the_supplementary_character() {
        let js = JsString::from_code_units(&[0xD83E, 0xDD21]);
        assert_eq!(js.as_str(), Some("\u{1F921}"));
    }

    #[test]
    fn plain_strings_stay_utf8_and_compare_with_str() {
        let js = JsString::from("use memo");
        assert!(js == "use memo");
        assert_eq!(js.to_marker_string(), "use memo");
    }

    #[test]
    fn malformed_marker_text_is_kept_literally() {
        let js = JsString::from_marker_string("__SURROGATE_XYZ__");
        assert_eq!(js.as_str(), Some("__SURROGATE_XYZ__"));
    }

    #[test]
    fn multibyte_text_after_marker_prefix_does_not_panic() {
        let input = "__SURROGATE_\u{20AC}\u{20AC}";
        let js = JsString::from_marker_string(input);
        assert_eq!(js.as_str(), Some(input));

        let truncated = "__SURROGATE_D8";
        assert_eq!(
            JsString::from_marker_string(truncated).as_str(),
            Some(truncated)
        );

        let mixed = "a\u{20AC}__SURROGATE_D83E__b\u{20AC}";
        let js = JsString::from_marker_string(mixed);
        let mut expected: Vec<u16> = "a\u{20AC}".encode_utf16().collect();
        expected.push(0xD83E);
        expected.extend("b\u{20AC}".encode_utf16());
        assert_eq!(js.code_units(), expected);
    }

    #[test]
    fn lowercase_hex_markers_are_not_decoded() {
        // The bridge emits uppercase hex only; lowercase marker-shaped text is
        // user text and must survive verbatim.
        let input = "__SURROGATE_d83e__";
        assert_eq!(JsString::from_marker_string(input).as_str(), Some(input));
    }
}
