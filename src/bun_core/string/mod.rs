//! `bun_core::string` — `String` and friends.
//!
//! `String` is the FFI-compatible 5-variant tagged union shared with C++
//! (`BunString` in `src/jsc/bindings/BunString.cpp`). `EncodedSlice<'a>` is
//! the pointer-tagged borrowed view; `Utf8Bytes<'a>` is the borrowed-or-owned
//! UTF-8 byte slice.

pub use crate::w;

#[path = "escapeRegExp.rs"]
pub mod escape_reg_exp;
#[path = "HashedString.rs"]
pub mod hashed_string;
#[path = "SmolStr.rs"]
pub mod smol_str;
#[path = "StringBuilder.rs"]
pub mod string_builder;
#[path = "StringJoiner.rs"]
pub mod string_joiner;

#[path = "MutableString.rs"]
pub mod mutable_string;
pub mod wtf;

// Canonical byte-oriented `Write` trait — re-exported by `bun_io::write`.
pub mod write;
pub use write::Write;

// SIMD-backed scanners over highway/simdutf FFI. Public as
// `bun_core::strings` (the alias in lib.rs); `immutable` is the module name.
#[path = "immutable.rs"]
pub mod immutable;
use crate::strings;

// Unicode ID-Start/ID-Continue two-stage tables.
// Pure data with no upward deps; hosted here so [`lexer`], [`mutable_string`],
// and [`immutable::unicode`] get full Unicode coverage without depending on
// `bun_js_parser`. `bun_js_parser::lexer::identifier` re-exports this module.
#[path = "identifier.rs"]
pub mod identifier;

use core::marker::PhantomData;
use core::sync::atomic::{AtomicUsize, Ordering};
pub use wtf::{WTFStringImpl, WTFStringImplExt, WTFStringImplStruct};

// ──────────────────────────────────────────────────────────────────────────
// `String` / `&Str` / `StringView<'a>` — 5-variant tagged WTFString-or-
// EncodedSlice, 24 bytes on 64-bit, ABI-identical to C++ `BunString`.
//
// - `String` owns (like `std::string::String`): one ref when WTF-backed,
//   otherwise `'static` bytes (`from_static`) or `Empty`/`Dead`. `Drop` =
//   `deref()`; `Clone` never allocates. A by-value `String` in an
//   `extern "C"` signature means ownership crosses, exactly like `Box<T>`.
// - `&Str` is the borrow (like `&str`) and carries the read API; `String`,
//   `StringView` and `JSStringView` deref to it. Read-only parameters are
//   `&Str` in Rust and across `extern "C"` (`const BunString*`).
//   `Str::to_owned()` is the one explicit allocation.
// - `StringView<'a>` is the by-value carrier for a borrow C++ returns
//   (`Bun::borrowStringView`) or for caller bytes (`from_bytes`/`utf8`/
//   `utf16`/`latin1`); only it carries the `EncodedSlice` tag with
//   non-`'static` bytes. Only constructors and an `'a`-precise `to_utf8`
//   of its own.
// ──────────────────────────────────────────────────────────────────────────

/// Discriminant for [`String`]'s representation.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    Dead = 0,
    WTFStringImpl = 1,
    EncodedSlice = 2,
    StaticEncodedSlice = 3,
    Empty = 4,
}

/// C-layout untagged union over [`String`]'s payload representations.
#[repr(C)]
#[derive(Clone, Copy)]
union StringImpl<'a> {
    encoded: EncodedSlice<'a>,
    wtf_string_impl: WTFStringImpl,
    // .StaticEncodedSlice aliases .encoded; .Dead/.Empty are zero-width.
}

/// Known as `BunString` in C++. Not a Rust `enum`: C++ mutates `tag` and
/// `value` independently across FFI.
#[repr(C)]
pub struct String {
    tag: Tag,
    value: StringImpl<'static>,
}

/// The borrowed form, only ever behind `&` (like `str`): what `String`,
/// [`StringView`] and `JSStringView` deref to. Same 24 bytes.
#[repr(C)]
pub struct Str {
    tag: Tag,
    value: StringImpl<'static>,
}

/// By-value carrier for a borrow of `'a` (C++-returned views, caller bytes);
/// never owns a ref. Derefs to [`Str`]; deliberately not `Clone`, so
/// `.to_owned()` always means [`Str::to_owned`]. Same 24 bytes.
#[repr(C)]
pub struct StringView<'a> {
    tag: Tag,
    value: StringImpl<'a>,
}

// C++ mirror: `struct BunString { BunStringTag tag; BunStringImpl impl; }`
// (`headers-handwritten.h`); returned **by value** from every `BunString__*`
// FFI below, so size/align drift is silent ABI corruption.
crate::assert_ffi_layout!(String, 24, 8);
crate::assert_ffi_layout!(Str, 24, 8);
crate::assert_ffi_layout!(StringView<'static>, 24, 8);
// FFI surface from `src/jsc/bindings/BunString.cpp`. Constructors return an
// owned +1 (declared `-> String`).
unsafe extern "C" {
    fn BunString__fromBytes(bytes: *const u8, len: usize) -> String;
    fn BunString__fromLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF16(bytes: *const u16, len: usize) -> String;
    fn BunString__fromUTF16ToLatin1(bytes: *const u16, len: usize) -> String;
    safe fn BunString__fromLatin1Unitialized(len: usize) -> String;
    safe fn BunString__fromUTF16Unitialized(len: usize) -> String;
    // `&mut String` / `&Str` are ABI-identical to the C++ `BunString*`
    // (thin non-null pointer to a `#[repr(C)]` struct, asserted by
    // `assert_ffi_layout!` above). C++ reads/writes only the `tag`/`value`
    // fields in place; the type encodes the sole pointer-validity precondition,
    // so `safe fn` discharges the link-time proof here.
    safe fn BunString__threadIsolatedCopy(this: &String) -> String;
    safe fn BunString__makeThreadShareable(this: &mut String);
    safe fn BunString__substring(base: &String, start: usize, len: usize) -> String;
    fn BunString__createAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__tryCreateAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternalLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternalUTF16(units: *const u16, len: usize) -> String;
    fn BunString__createStaticExternalLatin1WithHash(
        bytes: *const u8,
        len: usize,
        hash: u32,
    ) -> String;
    fn BunString__createExternal(
        bytes: *const u8,
        len: usize,
        is_latin1: bool,
        ctx: *mut core::ffi::c_void,
        callback: Option<extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize)>,
    ) -> String;
    fn BunString__createExternalGloballyAllocatedLatin1(bytes: *mut u8, len: usize) -> String;
    fn BunString__createExternalGloballyAllocatedUTF16(bytes: *mut u16, len: usize) -> String;
}

/// `ctx` is the pointer passed into `create_external`; `buffer` is the
/// `[*]u8`/`[*]u16` storage; `len` is the character count.
///
/// C++ signature (`BunString.cpp` `BunString__createExternal`):
/// `void (*)(void*, void*, size_t)` — the third arg is `size_t`, **not**
/// `unsigned`. A `u32` here would truncate on 64-bit and (worse) shift the
/// stack/register layout for the callee on Win64 where `size_t` ≠ `unsigned`.
pub(crate) type ExternalStringImplFreeFunction<Ctx> =
    extern "C" fn(ctx: Ctx, buffer: *mut core::ffi::c_void, len: usize);

impl<'a> StringView<'a> {
    pub const EMPTY: StringView<'static> = StringView {
        tag: Tag::Empty,
        value: StringImpl {
            encoded: EncodedSlice::EMPTY,
        },
    };
    pub const DEAD: StringView<'static> = StringView {
        tag: Tag::Dead,
        value: StringImpl {
            encoded: EncodedSlice::EMPTY,
        },
    };

    /// View of a `'static` ASCII literal (see [`String::from_static`]).
    #[inline]
    pub fn from_static<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> StringView<'static> {
        debug_assert!(s.as_ref().is_ascii());
        StringView {
            tag: Tag::StaticEncodedSlice,
            value: StringImpl {
                encoded: EncodedSlice::latin1(s.as_ref()),
            },
        }
    }

    #[inline]
    pub const fn from_encoded(encoded: EncodedSlice<'a>) -> Self {
        Self {
            tag: Tag::EncodedSlice,
            value: StringImpl { encoded },
        }
    }
    /// Borrow `bytes` (no copy); scans and tags UTF-8 if any byte is non-ASCII.
    #[inline]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self::from_encoded(EncodedSlice::from_bytes(bytes))
    }
    /// Borrow `bytes` as UTF-8 (no copy, no scan).
    #[inline]
    pub fn utf8(bytes: &'a [u8]) -> Self {
        Self::from_encoded(EncodedSlice::utf8(bytes))
    }
    /// Borrow `units` as UTF-16 (no copy).
    #[inline]
    pub fn utf16(units: &'a [u16]) -> Self {
        Self::from_encoded(EncodedSlice::utf16(units))
    }
    /// Borrow `bytes` as Latin-1 (no copy, no scan); for bytes already known
    /// ASCII or genuinely Latin-1.
    #[inline]
    pub fn latin1(bytes: &'a [u8]) -> Self {
        Self::from_encoded(EncodedSlice::latin1(bytes))
    }
    /// [`Str::to_utf8`] for the full `'a` rather than the borrow of `self`
    /// (the carrier may be a temporary while its bytes live for `'a`).
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'a> {
        match self.tag {
            // SAFETY: active field per `tag`; the view borrows the impl for `'a`.
            Tag::WTFStringImpl => unsafe { &*self.value.wtf_string_impl }.to_utf8(),
            // SAFETY: active field per `tag`; the bytes are borrowed for `'a`.
            Tag::EncodedSlice => unsafe { self.value.encoded }.to_utf8(),
            Tag::StaticEncodedSlice => Utf8Bytes::Borrowed(self.static_bytes()),
            Tag::Dead | Tag::Empty => Utf8Bytes::EMPTY,
        }
    }
}

impl Str {
    #[inline]
    pub const fn tag(&self) -> Tag {
        self.tag
    }
    #[inline]
    pub fn is_dead(&self) -> bool {
        self.tag == Tag::Dead
    }

    /// The active `EncodedSlice` variant; callers branch on `self.tag` first.
    #[inline(always)]
    fn encoded(&self) -> EncodedSlice<'_> {
        debug_assert!(matches!(
            self.tag,
            Tag::EncodedSlice | Tag::StaticEncodedSlice
        ));
        // SAFETY: `tag` is `EncodedSlice`/`StaticEncodedSlice` ⇒ `encoded` is
        // the active union field (`Copy` POD).
        unsafe { self.value.encoded }
    }
    /// Borrow the live `WTF::StringImpl`; callers branch on
    /// `self.tag == WTFStringImpl` first.
    #[inline(always)]
    fn as_wtf(&self) -> &WTFStringImplStruct {
        debug_assert_eq!(self.tag, Tag::WTFStringImpl);
        // SAFETY: `tag == WTFStringImpl` ⇒ `wtf_string_impl` is the active
        // union field and a non-null `*mut WTFStringImplStruct` kept alive
        // (refcount ≥ 1) for at least as long as `&self`.
        unsafe { &*self.value.wtf_string_impl }
    }
    /// `from_static` stores an ASCII `'static` literal with no encoding tag.
    #[inline]
    fn static_bytes(&self) -> &'static [u8] {
        debug_assert_eq!(self.tag, Tag::StaticEncodedSlice);
        // SAFETY: `StaticEncodedSlice` ⇒ `encoded` is active and was built by
        // `from_static` from `'static` bytes.
        unsafe { self.value.encoded }.detach_lifetime().slice()
    }

    #[inline]
    pub fn len(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().len(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().len,
            Tag::Dead | Tag::Empty => 0,
        }
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn is_utf16(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => !self.as_wtf().is_8bit(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().is_16bit(),
            _ => false,
        }
    }
    pub fn is_utf8(&self) -> bool {
        matches!(self.tag, Tag::EncodedSlice | Tag::StaticEncodedSlice) && self.encoded().is_utf8()
    }
    pub fn is_8bit(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().is_8bit(),
            Tag::EncodedSlice => !self.encoded().is_16bit(),
            _ => true,
        }
    }
    /// Coarse encoding classifier.
    pub fn encoding(&self) -> strings::EncodingNonAscii {
        if self.is_utf16() {
            strings::EncodingNonAscii::Utf16
        } else if self.is_utf8() {
            strings::EncodingNonAscii::Utf8
        } else {
            strings::EncodingNonAscii::Latin1
        }
    }

    /// Borrow as an `EncodedSlice` (any tag; no ref taken).
    pub fn to_encoded_slice(&self) -> EncodedSlice<'_> {
        match self.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded(),
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() {
                    EncodedSlice::latin1(w.latin1_slice())
                } else {
                    EncodedSlice::utf16(w.utf16_slice())
                }
            }
            _ => EncodedSlice::EMPTY,
        }
    }
    /// Raw byte view (Latin-1 or UTF-16 bytes — NOT necessarily UTF-8).
    pub fn byte_slice(&self) -> &[u8] {
        match self.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().byte_slice(),
            Tag::WTFStringImpl => self.as_wtf().byte_slice(),
            _ => &[],
        }
    }
    /// Latin-1 byte view; debug-asserts `is_8bit()`.
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().latin1_slice(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().slice(),
            _ => &[],
        }
    }
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(self.is_utf16());
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_slice(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf16_slice(),
            _ => &[],
        }
    }
    /// Raw UTF-8 byte slice; debug-asserts `as_utf8().is_some()` (use
    /// [`as_utf8`](Self::as_utf8) for the checked variant).
    #[inline]
    fn utf8_slice(&self) -> &[u8] {
        debug_assert!(self.as_utf8().is_some());
        self.byte_slice()
    }
    /// `Some(utf8_bytes)` only if this is already valid UTF-8 with no
    /// transcoding needed.
    pub fn as_utf8(&self) -> Option<&[u8]> {
        match self.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() && strings::is_all_ascii(w.latin1_slice()) {
                    Some(w.latin1_slice())
                } else {
                    None
                }
            }
            Tag::EncodedSlice | Tag::StaticEncodedSlice => {
                let encoded = self.encoded();
                if encoded.is_16bit() {
                    return None;
                }
                if encoded.is_utf8() || strings::is_all_ascii(encoded.slice()) {
                    return Some(encoded.slice());
                }
                None
            }
            _ => Some(b""),
        }
    }
    /// UTF-8 bytes of the viewed storage: borrowed when already UTF-8 (incl.
    /// 8-bit all-ASCII), otherwise a transcoded copy. Never takes a ref.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'_> {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().to_utf8(),
            Tag::EncodedSlice => self.encoded().to_utf8(),
            Tag::StaticEncodedSlice => Utf8Bytes::Borrowed(self.static_bytes()),
            _ => Utf8Bytes::EMPTY,
        }
    }
    pub fn to_owned_slice(&self) -> Vec<u8> {
        self.to_utf8().into_vec()
    }
    /// Allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(&self) -> crate::ZBox {
        self.to_encoded_slice().to_owned_slice_z()
    }

    /// Bitwise by-value copy of these 24 bytes (no ref taken), for the few
    /// places that store a borrow by value.
    #[inline(always)]
    pub const fn as_view(&self) -> StringView<'_> {
        StringView {
            tag: self.tag,
            value: self.value,
        }
    }

    /// The one explicit allocation: another ref to a WTF-backed string,
    /// bitwise for `'static`/`Empty`/`Dead`, a WTF copy of borrowed bytes.
    pub fn to_owned(&self) -> String {
        match self.tag {
            Tag::WTFStringImpl => {
                self.as_wtf().r#ref();
                // SAFETY: `tag == WTFStringImpl` ⇒ `wtf_string_impl` is active.
                String::adopt_wtf_impl(unsafe { self.value.wtf_string_impl })
            }
            Tag::EncodedSlice => {
                let encoded = self.encoded();
                if encoded.is_16bit() {
                    String::clone_utf16(encoded.utf16_slice())
                } else if encoded.is_utf8() {
                    String::clone_utf8(encoded.slice())
                } else {
                    String::clone_latin1(encoded.slice())
                }
            }
            Tag::StaticEncodedSlice => String::from_static(self.static_bytes()),
            Tag::Empty => String::EMPTY,
            Tag::Dead => String::DEAD,
        }
    }

    /// `self.to_owned()` when `other` is byte-equal to `self`, else
    /// `String::clone_utf8(other)`.
    #[inline]
    pub fn create_if_different(&self, other: &[u8]) -> String {
        if self.eql_utf8(other) {
            return self.to_owned();
        }
        String::clone_utf8(other)
    }

    /// Encoding-aware equality.
    pub fn eql(&self, other: &Str) -> bool {
        self.to_encoded_slice().eql(other.to_encoded_slice())
    }
    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        self.to_utf8().slice() == other
    }
    /// Equality against ASCII bytes. Dispatches on encoding so only
    /// `ascii.len()` units are touched; never scans or transcodes `self`.
    #[inline]
    pub fn eq_ascii(&self, ascii: &[u8]) -> bool {
        self.to_encoded_slice().eq_ascii(ascii)
    }
    /// ASCII prefix check. Dispatches on encoding so only `ascii.len()`
    /// units are touched; never scans or transcodes `self`.
    #[inline]
    pub fn starts_with_ascii(&self, ascii: &[u8]) -> bool {
        self.to_encoded_slice().starts_with_ascii(ascii)
    }
    /// Code unit at `index`, widened to `u16` regardless of encoding. Caller
    /// must ensure `index < self.len()`.
    #[inline]
    pub fn char_at(&self, index: usize) -> u16 {
        self.to_encoded_slice().char_at(index)
    }
    pub fn index_of_ascii_char(&self, chr: u8) -> Option<usize> {
        debug_assert!(chr < 128);
        if self.is_utf16() {
            self.utf16_slice().iter().position(|&c| c == chr as u16)
        } else {
            strings::index_of_char_usize(self.byte_slice(), chr)
        }
    }
    /// Exact number of UTF-8 bytes needed to encode `self`.
    pub fn utf8_byte_length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().utf8_byte_length(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf8_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }
    /// Number of bytes the UTF-16LE encoding of `self` would occupy.
    pub fn utf16_byte_length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_byte_length(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf16_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// Clamp to `len` code units; for a WTF-backed string longer than `len`
    /// the result is an `EncodedSlice` view into the impl's buffer.
    #[inline]
    pub fn trunc(&self, len: usize) -> StringView<'_> {
        if self.len() <= len {
            return self.as_view();
        }
        StringView::from_encoded(self.to_encoded_slice().trunc(len))
    }
    /// `start_index..` to end.
    pub fn substring(&self, start_index: usize) -> StringView<'_> {
        let len = self.len();
        self.substring_range(start_index.min(len), len)
    }
    /// `start_index..end_index`.
    pub fn substring_range(&self, start_index: usize, end_index: usize) -> StringView<'_> {
        match self.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice | Tag::WTFStringImpl => {
                StringView::from_encoded(
                    self.to_encoded_slice()
                        .substring_range(start_index, end_index),
                )
            }
            Tag::Dead | Tag::Empty => self.as_view(),
        }
    }

    /// Narrow into `dst` iff non-empty, fits, and every code unit is ASCII
    /// (`< 0x80`). Returns `Some(&mut dst[..len])` on success.
    pub(crate) fn ascii_into<'d>(&self, dst: &'d mut [u8]) -> Option<&'d mut [u8]> {
        let len = self.len();
        if len == 0 || len > dst.len() {
            return None;
        }
        if self.is_utf16() {
            crate::strings::narrow_ascii_u16(self.utf16_slice(), dst)
        } else {
            let src = self.byte_slice();
            if strings::first_non_ascii(src).is_some() {
                return None;
            }
            let dst = &mut dst[..len];
            dst.copy_from_slice(src);
            Some(dst)
        }
    }
    /// Case-insensitive ASCII lookup against a comptime string map whose keys
    /// are lowercase ASCII. UTF-16 inputs are narrowed (non-ASCII code unit ⇒
    /// miss); 8-bit inputs delegate straight to
    /// [`strings::in_map_case_insensitive`].
    pub fn in_map_case_insensitive<M: crate::comptime_string_map::ComptimeStringMap>(
        &self,
        map: &M,
    ) -> Option<M::Value>
    where
        M::Value: Copy,
    {
        if self.is_utf16() {
            let mut buf = [0u8; 256];
            strings::in_map_case_insensitive(self.ascii_into(&mut buf)?, map)
        } else {
            strings::in_map_case_insensitive(self.byte_slice(), map)
        }
    }
    /// Terminal column width, treating ANSI escape sequences as zero-width.
    pub fn visible_width_exclude_ansi_colors(&self, ambiguous_as_wide: bool) -> usize {
        use crate::strings::visible::width::exclude_ansi_colors as w;
        if self.is_utf16() {
            return w::utf16(self.utf16_slice(), ambiguous_as_wide);
        }
        if self.is_utf8() {
            return w::utf8(self.encoded().slice());
        }
        w::latin1(self.latin1_slice(), ambiguous_as_wide)
    }
    /// Encode into `buf` as NUL-terminated UTF-16, returning the unit count
    /// (excluding the NUL), or `None` when the UTF-16 form plus the NUL would
    /// not fit. The caller owns mapping `None` to an error (e.g.
    /// `ENAMETOOLONG`).
    pub fn encode_into_utf16_buf_z(&self, buf: &mut [u16]) -> Option<usize> {
        let cap = buf.len().checked_sub(1)?;
        let len = match self.encoding() {
            strings::EncodingNonAscii::Utf8 => {
                strings::try_convert_utf8_to_utf16_in_buffer(&mut buf[..cap], self.utf8_slice())?
                    .len()
            }
            strings::EncodingNonAscii::Utf16 => {
                let src = self.utf16_slice();
                if src.len() > cap {
                    return None;
                }
                buf[..src.len()].copy_from_slice(src);
                src.len()
            }
            strings::EncodingNonAscii::Latin1 => {
                let src = self.latin1_slice();
                if src.len() > cap {
                    return None;
                }
                strings::copy_latin1_into_utf16(&mut buf[..src.len()], src);
                src.len()
            }
        };
        buf[len] = 0;
        Some(len)
    }
}
impl core::fmt::Display for Str {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = self.to_utf8();
        // SAFETY: `to_utf8` always yields valid UTF-8 — it transcodes
        // Latin-1/UTF-16 and borrows already-UTF-8 inputs.
        f.write_str(unsafe { core::str::from_utf8_unchecked(s.slice()) })
    }
}
impl core::fmt::Display for String {
    #[inline]
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&**self, f)
    }
}
impl core::fmt::Display for StringView<'_> {
    #[inline]
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&**self, f)
    }
}
impl core::ops::Deref for String {
    type Target = Str;
    #[inline(always)]
    fn deref(&self) -> &Str {
        // SAFETY: same `#[repr(C)]` 24 bytes; every `String` tag is a valid `Str`.
        unsafe { &*core::ptr::from_ref(self).cast::<Str>() }
    }
}
impl core::ops::Deref for StringView<'_> {
    type Target = Str;
    #[inline(always)]
    fn deref(&self) -> &Str {
        // SAFETY: same `#[repr(C)]` 24 bytes; the `&self` borrow bounds every
        // slice `Str` hands out, and it cannot outlive `'a`.
        unsafe { &*core::ptr::from_ref(self).cast::<Str>() }
    }
}
impl AsRef<Str> for String {
    #[inline(always)]
    fn as_ref(&self) -> &Str {
        self
    }
}
impl AsRef<Str> for StringView<'_> {
    #[inline(always)]
    fn as_ref(&self) -> &Str {
        self
    }
}
impl core::borrow::Borrow<Str> for String {
    #[inline(always)]
    fn borrow(&self) -> &Str {
        self
    }
}
impl std::borrow::ToOwned for Str {
    type Owned = String;
    #[inline]
    fn to_owned(&self) -> String {
        Str::to_owned(self)
    }
}
impl PartialEq for Str {
    #[inline]
    fn eq(&self, other: &Str) -> bool {
        self.eql(other)
    }
}

impl String {
    pub const EMPTY: Self = Self {
        tag: Tag::Empty,
        value: StringImpl {
            encoded: EncodedSlice::EMPTY,
        },
    };
    pub const DEAD: Self = Self {
        tag: Tag::Dead,
        value: StringImpl {
            encoded: EncodedSlice::EMPTY,
        },
    };

    /// `'static` ASCII slice (no encoding tag, no scan); `to_utf8`/`into_utf8`
    /// borrow the bytes directly. Generic over `str`/`[u8]` so call sites may
    /// pass either `"lit"` or `b"lit"`.
    #[inline]
    pub fn from_static<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> Self {
        let v = StringView::from_static(s);
        Self {
            tag: v.tag,
            value: v.value,
        }
    }

    /// Copies `s` into a fresh WTF::StringImpl.
    pub fn clone_utf8(s: &[u8]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // BunString__fromBytes auto-detects all-ASCII → Latin1, else UTF-8.
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromBytes(s.as_ptr(), s.len()) }
    }
    pub fn clone_latin1(s: &[u8]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromLatin1(s.as_ptr(), s.len()) }
    }
    /// Copies `s` into a fresh WTF::StringImpl; narrows to Latin-1 if all-ASCII.
    pub fn clone_utf16(s: &[u16]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // SAFETY: s.as_ptr()/len describe a valid u16 slice.
        unsafe {
            if strings::first_non_ascii16(s).is_none() {
                BunString__fromUTF16ToLatin1(s.as_ptr(), s.len())
            } else {
                BunString__fromUTF16(s.as_ptr(), s.len())
            }
        }
    }
    pub fn create_atom(s: &[u8]) -> Self {
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__createAtom(s.as_ptr(), s.len()) }
    }
    /// `None` if `bytes` is non-ASCII or too long to atomize.
    pub fn try_create_atom(bytes: &[u8]) -> Option<Self> {
        // SAFETY: bytes describes a valid slice.
        let atom = unsafe { BunString__tryCreateAtom(bytes.as_ptr(), bytes.len()) };
        if atom.tag == Tag::Dead {
            None
        } else {
            Some(atom)
        }
    }
    /// Atomized strings are interned in a thread-local table; falls back to a
    /// regular WTF copy if atomization fails. Cannot be used cross-thread.
    pub fn create_atom_if_possible(bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() < 64 {
            if let Some(atom) = Self::try_create_atom(bytes) {
                return atom;
            }
        }
        Self::clone_utf8(bytes)
    }
    /// Wraps `bytes` in a `WTF::ExternalStringImpl` that calls
    /// `callback(ctx, buffer, len)` when the impl is destroyed.
    ///
    /// External strings are WTF strings whose bytes live elsewhere; `bytes` is
    /// borrowed (not copied). If `bytes.len() > max_length()`, `callback` is
    /// invoked immediately and a `dead` string is returned.
    ///
    /// `Ctx` must be a pointer-sized type (raw pointer or `&T`); enforced by
    /// the const-assert below to keep the C-ABI cast sound.
    pub fn create_external<Ctx>(
        bytes: &[u8],
        is_latin1: bool,
        ctx: Ctx,
        callback: ExternalStringImplFreeFunction<Ctx>,
    ) -> Self {
        use core::ffi::c_void;
        // `Ctx` must be a pointer-sized, pointer-aligned handle.
        struct AssertPtrSized<C>(core::marker::PhantomData<C>);
        impl<C> AssertPtrSized<C> {
            const OK: () = {
                assert!(core::mem::size_of::<C>() == core::mem::size_of::<*mut c_void>());
                // The bit-reinterpret below reads `*mut c_void` out of a stack
                // slot aligned for `Ctx`; rule out a `Ctx` like `[u8; 8]`
                // (align 1) which would make that read under-aligned.
                assert!(core::mem::align_of::<C>() >= core::mem::align_of::<*mut c_void>());
            };
        }
        let () = AssertPtrSized::<Ctx>::OK;
        debug_assert!(!bytes.is_empty());
        if bytes.len() > Self::max_length() {
            callback(ctx, bytes.as_ptr().cast_mut().cast::<c_void>(), bytes.len());
            return Self::DEAD;
        }
        // The const-assert above only checks size/alignment, so an owning
        // pointer-sized `Ctx` (e.g.
        // `Box<T>`) would otherwise be dropped here and later double-freed by
        // the WTF finalizer. Ownership transfers to the external string;
        // suppress the local drop.
        let ctx = core::mem::ManuallyDrop::new(ctx);
        // SAFETY: Ctx is pointer-sized and pointer-aligned (const-asserted
        // above); read the bits as `*mut c_void`.
        let ctx_erased: *mut c_void = unsafe {
            core::ptr::from_ref::<Ctx>(&*ctx)
                .cast::<*mut c_void>()
                .read()
        };
        let cb_erased: Option<extern "C" fn(*mut c_void, *mut c_void, usize)> =
            // SAFETY: same ABI; first param erased per the const-assert above.
            Some(unsafe { crate::cast_fn_ptr::<
                ExternalStringImplFreeFunction<Ctx>,
                extern "C" fn(*mut c_void, *mut c_void, usize),
            >(callback) });
        // SAFETY: bytes describes a valid slice; len <= max_length checked.
        let s = unsafe {
            BunString__createExternal(
                bytes.as_ptr(),
                bytes.len(),
                is_latin1,
                ctx_erased,
                cb_erased,
            )
        };
        debug_assert!(s.tag != Tag::WTFStringImpl || s.as_wtf().ref_count() == 1);
        s
    }

    /// Max `WTF::StringImpl` length (in characters, not bytes):
    /// [`STRING_ALLOCATION_LIMIT`] clamped to [`WTF_STRING_MAX_LENGTH`].
    #[inline]
    pub fn max_length() -> usize {
        STRING_ALLOCATION_LIMIT
            .load(Ordering::Relaxed)
            .min(WTF_STRING_MAX_LENGTH)
    }

    /// Zero-copy: a refcounted `WTF::ExternalStringImpl` over `bytes`; the
    /// impl never copies or frees them.
    pub fn create_static_external_latin1(bytes: &'static [u8]) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: bytes describes a valid slice; C++ side stores ptr/len
        // without copying and never frees it.
        unsafe { BunString__createStaticExternalLatin1(bytes.as_ptr(), bytes.len()) }
    }
    /// [`Self::create_static_external_latin1`] with `WTF::StringImpl::hash()` of `bytes` already known, so the
    /// result is thread-shareable without reading the bytes.
    pub fn create_static_external_latin1_with_hash(bytes: &'static [u8], hash: u32) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: as above; `hash` is StringImpl::hash() of `bytes`.
        unsafe { BunString__createStaticExternalLatin1WithHash(bytes.as_ptr(), bytes.len(), hash) }
    }
    /// UTF-16 form of [`Self::create_static_external_latin1`].
    pub fn create_static_external_utf16(units: &'static [u16]) -> Self {
        debug_assert!(!units.is_empty());
        // SAFETY: the C++ side takes the length in code units and stores
        // ptr/len without copying or freeing.
        unsafe { BunString__createStaticExternalUTF16(units.as_ptr(), units.len()) }
    }
    /// Formats `args` into a WTF-backed string; an argument-free ASCII
    /// literal is returned as `from_static` without copying.
    pub fn create_format(args: core::fmt::Arguments<'_>) -> Self {
        use core::fmt::Write;
        if let Some(s) = args.as_str() {
            return if s.is_ascii() {
                Self::from_static(s)
            } else {
                Self::clone_utf8(s.as_bytes())
            };
        }
        let mut buf = std::string::String::with_capacity(128);
        let _ = buf.write_fmt(args);
        Self::clone_utf8(buf.as_bytes())
    }
    /// Returns `(String, ptr)` where `ptr` is `len` writable bytes — or
    /// `(dead, null)` if WTF allocation failed (check `tag == .Dead` before
    /// using the buffer).
    pub fn create_uninitialized_latin1(len: usize) -> (Self, &'static mut [u8]) {
        let s = BunString__fromLatin1Unitialized(len);
        if s.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(s.as_wtf().ref_count(), 1);
        // SAFETY: WTF tag verified above; impl has a writable latin1 buffer of
        // `len`. `ptr` points at `len` writable bytes owned by the new WTF
        // impl; the `'static` lifetime is actually tied to `s` — caller must
        // not outlive it.
        let buf = unsafe {
            let ptr = (*s.value.wtf_string_impl).m_ptr.latin1.cast_mut();
            core::slice::from_raw_parts_mut(ptr, len)
        };
        (s, buf)
    }
    pub fn create_uninitialized_utf16(len: usize) -> (Self, &'static mut [u16]) {
        let s = BunString__fromUTF16Unitialized(len);
        if s.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(s.as_wtf().ref_count(), 1);
        // SAFETY: see `create_uninitialized_latin1`.
        let buf = unsafe {
            let ptr = (*s.value.wtf_string_impl).m_ptr.utf16.cast_mut();
            core::slice::from_raw_parts_mut(ptr, len)
        };
        (s, buf)
    }

    /// Takes ownership of a globally-allocated (mimalloc-backed) Latin-1
    /// buffer and wraps it in a WTF::ExternalStringImpl. `DEAD` (bytes freed)
    /// when longer than [`Self::max_length`].
    pub fn create_external_globally_allocated_latin1(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() > Self::max_length() {
            return Self::DEAD;
        }
        // Do NOT call `into_boxed_slice()` — when `len < capacity` it issues a
        // shrink_to_fit realloc. mimalloc's `mi_free` only needs the original
        // base pointer (capacity is recovered from the heap), so leaking the
        // spare capacity to the ExternalStringImpl finalizer is correct.
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        let (ptr, len) = (bytes.as_mut_ptr(), bytes.len());
        // SAFETY: ownership transferred to WTF::ExternalStringImpl, which frees
        // via mimalloc (the global allocator).
        unsafe { BunString__createExternalGloballyAllocatedLatin1(ptr, len) }
    }

    /// UTF-16 form of [`Self::create_external_globally_allocated_latin1`].
    pub fn create_external_globally_allocated_utf16(bytes: Vec<u16>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() > Self::max_length() {
            return Self::DEAD;
        }
        // See `create_external_globally_allocated_latin1` — avoid the
        // `into_boxed_slice()` shrink-realloc when `len < capacity`.
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        let (ptr, len) = (bytes.as_mut_ptr(), bytes.len());
        // SAFETY: see `create_external_globally_allocated_latin1`.
        unsafe { BunString__createExternalGloballyAllocatedUTF16(ptr, len) }
    }

    /// UTF-8 `bytes` → external WTF-backed string: adopts the allocation as
    /// Latin-1 when all-ASCII, otherwise adopts a UTF-16 transcode of it.
    /// `DEAD` when longer than [`Self::max_length`].
    pub fn from_owned_utf8(bytes: Vec<u8>) -> Result<Self, crate::AllocError> {
        match strings::to_utf16_alloc(&bytes, false, false) {
            Ok(None) => Ok(Self::create_external_globally_allocated_latin1(bytes)),
            Ok(Some(utf16)) => Ok(Self::create_external_globally_allocated_utf16(utf16)),
            Err(_) => Err(crate::AllocError),
        }
    }

    /// Clone an OS-native path slice into a WTF-backed string (UTF-8 on
    /// POSIX, UTF-16 on Windows).
    pub fn create_from_os_path(os_path: crate::OSPathSlice<'_>) -> Self {
        #[cfg(not(windows))]
        {
            Self::clone_utf8(os_path)
        }
        #[cfg(windows)]
        {
            Self::clone_utf16(os_path)
        }
    }
    /// `WTF::adoptRef` — wrap a raw `*mut WTFStringImplStruct`, **adopting**
    /// an existing +1 ref (no inc). Inverse of [`leak_wtf_impl`]. Null → `EMPTY`.
    ///
    /// [`leak_wtf_impl`]: Self::leak_wtf_impl
    #[inline]
    pub fn adopt_wtf_impl(wtf: WTFStringImpl) -> Self {
        if wtf.is_null() {
            return Self::EMPTY;
        }
        Self {
            tag: Tag::WTFStringImpl,
            value: StringImpl {
                wtf_string_impl: wtf,
            },
        }
    }
    /// `WTF::RefPtr(ptr)` — wrap a raw `*mut WTFStringImplStruct` someone else
    /// keeps alive, taking a **new** ref for the returned `String`.
    #[inline]
    pub fn retain_wtf_impl(wtf: WTFStringImpl) -> Self {
        let s = Self::adopt_wtf_impl(wtf);
        if s.tag == Tag::WTFStringImpl {
            s.as_wtf().r#ref();
        }
        s
    }
    /// Extract the raw `*mut WTFStringImplStruct`
    /// from a WTF-backed string, transferring ownership of the +1 ref to the caller. Returns
    /// null for non-WTF tags. Used by SQL data-cell paths that hand the impl pointer to C++.
    #[inline]
    pub fn leak_wtf_impl(self) -> WTFStringImpl {
        let this = core::mem::ManuallyDrop::new(self);
        if this.tag == Tag::WTFStringImpl {
            // SAFETY: tag checked.
            unsafe { this.value.wtf_string_impl }
        } else {
            core::ptr::null_mut()
        }
    }
    /// Zero-copy `start..end` of a WTF-backed string: a +1 impl that shares
    /// `self`'s buffer and keeps it alive (cf. [`Str::substring_range`], a view).
    pub fn substring_shared(&self, start: usize, end: usize) -> String {
        debug_assert!(self.tag == Tag::WTFStringImpl);
        debug_assert!(start <= end && end <= self.len());
        BunString__substring(self, start, end - start)
    }
    /// An isolated copy of a WTF-backed impl (+1, `clone()` for other tags),
    /// for handing the value to one other thread; not for sharing one impl
    /// between VMs.
    pub fn thread_isolated_copy(&self) -> String {
        let copy = if self.tag == Tag::WTFStringImpl {
            BunString__threadIsolatedCopy(self)
        } else {
            self.clone()
        };
        debug_assert!(copy.is_thread_isolated());
        copy
    }
    /// Make a WTF-backed impl safe to hand to any number of threads/VMs:
    /// isolated if it was an atom/symbol/substring, pre-hashed, and never
    /// atomized in place; hand it out with `clone()`.
    pub fn make_thread_shareable(&mut self) {
        if self.tag == Tag::WTFStringImpl {
            BunString__makeThreadShareable(self)
        }
        debug_assert!(self.is_thread_shareable());
    }
    /// What [`thread_isolated_copy`] yields: no thread-affine state (not an
    /// atom, symbol or substring), so the value may be handed to one other
    /// thread. Non-WTF tags are inert and always qualify.
    #[inline]
    pub(crate) fn is_thread_isolated(&self) -> bool {
        self.tag != Tag::WTFStringImpl || self.as_wtf().is_thread_isolated()
    }
    /// What [`make_thread_shareable`] yields: isolated, pre-hashed and never
    /// atomized in place, so any number of threads may hold it.
    #[inline]
    pub(crate) fn is_thread_shareable(&self) -> bool {
        self.tag != Tag::WTFStringImpl || self.as_wtf().is_thread_shareable()
    }
    pub fn ensure_hash(&self) {
        if self.tag == Tag::WTFStringImpl {
            self.as_wtf().ensure_hash()
        }
    }

    #[inline]
    fn deref(&self) {
        if self.tag == Tag::WTFStringImpl {
            self.as_wtf().deref()
        }
    }

    /// Consuming [`to_utf8`] for storing the result: moves `self`'s ref into
    /// `Shared` (8-bit all-ASCII WTF) or transcodes, so the result never
    /// depends on `self`'s backing.
    ///
    /// [`to_utf8`]: Self::to_utf8
    pub fn into_utf8(self) -> Utf8Bytes<'static> {
        match self.tag {
            Tag::WTFStringImpl => {
                let wtf = self.as_wtf();
                if !wtf.is_8bit() {
                    return Utf8Bytes::Owned(strings::to_utf8_alloc(wtf.utf16_slice()));
                }
                if let Some(utf8) = strings::to_utf8_from_latin1(wtf.latin1_slice()) {
                    return Utf8Bytes::Owned(utf8);
                }
                Utf8Bytes::Shared(self)
            }
            Tag::StaticEncodedSlice => Utf8Bytes::Borrowed(self.static_bytes()),
            Tag::EncodedSlice => self.to_utf8().into_owned(),
            _ => Utf8Bytes::EMPTY,
        }
    }
    /// Consume `self` into a [`Utf8WithString`].
    #[inline]
    pub fn into_utf8_with_string(self) -> Utf8WithString {
        let utf8 = match self.to_utf8() {
            Utf8Bytes::Owned(v) => Some(v),
            _ => None,
        };
        Utf8WithString { utf8, string: self }
    }

    /// [`into_utf8_with_string`] then [`Utf8WithString::make_thread_isolated`].
    ///
    /// [`into_utf8_with_string`]: Self::into_utf8_with_string
    #[inline]
    pub fn into_utf8_with_string_thread_isolated(self) -> Utf8WithString {
        let mut out = self.into_utf8_with_string();
        out.make_thread_isolated();
        out
    }
    /// Owned allocation size in bytes (not character count). `0` for
    /// static/empty/dead.
    pub fn estimated_size(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => self.as_wtf().byte_length(),
            _ => 0,
        }
    }
}
impl crate::OptionsEnvArg for String {
    #[inline]
    fn from_slice(s: &[u8]) -> Self {
        String::clone_utf8(s)
    }
    #[inline]
    fn from_buf(buf: Vec<u8>) -> Self {
        String::clone_utf8(&buf)
    }
}

impl Default for String {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}
// SAFETY: `String` is a tag + raw ptr to a `WTF::StringImpl` (or `'static`
// bytes / the empty / dead sentinel). All non-WTF tags are trivially
// `Send + Sync` (no interior mutability, no refcount). A `WTF::StringImpl`'s
// refcount is atomic; the hazards are per-thread atom tables and the lazily
// computed hash/flags (see "Cross-thread string hazards" in `src/CLAUDE.md`).
//
// We keep the blanket impls to match the C++ `BunString`
// FFI contract (the type must round-trip by value through `extern "C"` and sit
// in `Send + Sync` containers), and instead enforce the invariant at the
// boundary: code that moves a `String` to one other thread calls
// [`String::thread_isolated_copy`], code that shares one impl between
// threads/VMs calls [`String::make_thread_shareable`] (asserting
// [`String::is_thread_isolated`] / [`String::is_thread_shareable`]).
unsafe impl Send for String {}
// SAFETY: same contract as the `Send` impl above — a hand-off requires
// `is_thread_isolated()`, sharing `is_thread_shareable()`; non-WTF tags are
// inert and trivially `Sync`.
unsafe impl Sync for String {}

impl Drop for String {
    #[inline]
    fn drop(&mut self) {
        self.deref();
    }
}
impl Clone for String {
    /// Never allocates: +1 on the same `WTF::StringImpl`, bitwise otherwise.
    #[inline]
    fn clone(&self) -> Self {
        debug_assert!(
            self.tag != Tag::EncodedSlice,
            "owned String never holds a borrowed slice"
        );
        if self.tag == Tag::WTFStringImpl {
            self.as_wtf().r#ref();
        }
        Self {
            tag: self.tag,
            value: self.value,
        }
    }
}

impl core::fmt::Display for EncodedSlice<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.is_utf8() {
            return write!(f, "{}", crate::fmt::s(self.slice()));
        }
        if self.is_16bit() {
            return crate::fmt::format_utf16_type(self.utf16_slice(), f);
        }
        crate::fmt::format_latin1(self.slice(), f)
    }
}

// `EncodedSlice` pointer-tag scheme. Flag bits live in the pointer's high
// byte; untagging truncates to 53 bits.
const TAG_UTF8_BIT: usize = 1usize << 61;
const TAG_GLOBAL_BIT: usize = 1usize << 62;
const TAG_UTF16_BIT: usize = 1usize << 63;
const UNTAG_MASK: usize = (1usize << 53) - 1;

/// `{tagged ptr, len}` with encoding bits (Latin-1 / UTF-8 / UTF-16 / global)
/// in the pointer's high byte; borrows `'a`. Also the [`String`] union arm.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct EncodedSlice<'a> {
    /// Tagged pointer — never dereference directly; use `untagged_ptr()`.
    _unsafe_ptr_do_not_use: *const u8,
    pub len: usize,
    _marker: PhantomData<&'a [u8]>,
}
crate::assert_ffi_layout!(EncodedSlice<'static>, 16, 8);

impl<'a> EncodedSlice<'a> {
    pub const EMPTY: Self = Self::from_tagged_ptr(b"".as_ptr(), 0);

    /// Construct from an already-tagged pointer + length pair. `ptr` is stored
    /// verbatim — tag bits are not touched. Caller vouches for `'a`.
    #[inline]
    pub(crate) const fn from_tagged_ptr(ptr: *const u8, len: usize) -> Self {
        Self {
            _unsafe_ptr_do_not_use: ptr,
            len,
            _marker: PhantomData,
        }
    }
    #[inline(always)]
    const fn detach_lifetime(self) -> EncodedSlice<'static> {
        EncodedSlice::from_tagged_ptr(self._unsafe_ptr_do_not_use, self.len)
    }

    /// Raw tagged pointer (top-bit flags intact). Do **not** dereference.
    #[inline]
    const fn tagged_ptr(self) -> *const u8 {
        self._unsafe_ptr_do_not_use
    }
    #[inline]
    pub const fn is_empty(self) -> bool {
        self.len == 0
    }
    #[inline]
    pub fn is_16bit(self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & TAG_UTF16_BIT != 0
    }
    #[inline]
    pub fn is_utf8(self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & TAG_UTF8_BIT != 0
    }
    #[inline]
    pub fn is_globally_allocated(self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & TAG_GLOBAL_BIT != 0
    }
    #[inline]
    fn mark(&mut self, bit: usize) {
        self._unsafe_ptr_do_not_use = ((self._unsafe_ptr_do_not_use as usize) | bit) as *const u8;
    }
    /// Strip the flag bits — truncate to the low 53 bits.
    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        ((ptr as usize) & UNTAG_MASK) as *const u8
    }

    /// Borrow `s` as Latin-1/ASCII (no encoding tag).
    #[inline]
    pub const fn latin1(s: &'a [u8]) -> Self {
        Self::from_tagged_ptr(s.as_ptr(), s.len())
    }
    /// Borrow UTF-8 bytes (sets the UTF-8 ptr-tag).
    #[inline]
    pub fn utf8(s: &'a [u8]) -> Self {
        let mut slice = Self::latin1(s);
        slice.mark(TAG_UTF8_BIT);
        slice
    }
    /// Borrow UTF-16 code units (sets the 16-bit ptr-tag).
    #[inline]
    pub fn utf16(s: &'a [u16]) -> Self {
        let mut slice = Self::from_tagged_ptr(s.as_ptr().cast(), s.len());
        slice.mark(TAG_UTF16_BIT);
        slice
    }

    /// Wrap a globally-allocated UTF-16 buffer whose ownership is being
    /// handed to C++: sets the 16-bit and global ptr-tags.
    #[inline]
    pub fn utf16_global(s: &'a [u16]) -> Self {
        let mut slice = Self::utf16(s);
        slice.mark(TAG_GLOBAL_BIT);
        slice
    }

    /// Borrow `slice`; if it contains any non-ASCII byte, sets the UTF-8
    /// ptr-tag.
    #[inline]
    pub fn from_bytes(slice: &'a [u8]) -> Self {
        if !strings::is_all_ascii(slice) {
            Self::utf8(slice)
        } else {
            Self::latin1(slice)
        }
    }

    #[inline]
    fn untagged_ptr(self) -> *const u8 {
        Self::untagged(self.tagged_ptr())
    }
    /// 8-bit byte view (Latin-1 or UTF-8). Caller must ensure `!is_16bit()`.
    #[inline]
    pub fn slice(self) -> &'a [u8] {
        if self.len == 0 {
            return &[];
        }
        debug_assert!(
            !self.is_16bit(),
            "EncodedSlice::slice() on UTF-16; use to_utf8()"
        );
        // SAFETY: the constructor stored a valid ptr/len for `'a`; flag bits
        // stripped.
        unsafe { core::slice::from_raw_parts(self.untagged_ptr(), self.len) }
    }
    /// UTF-16 code-unit view. Caller must ensure `is_16bit()`.
    #[inline]
    pub fn utf16_slice(self) -> &'a [u16] {
        if self.len == 0 {
            return &[];
        }
        debug_assert!(self.is_16bit());
        // SAFETY: a 16-bit-tagged constructor stored a 2-byte-aligned ptr
        // valid for `len` u16 units for `'a`; flag bits stripped (the cast
        // goes `usize → *const u16` directly to keep the alignment lint quiet).
        unsafe { core::slice::from_raw_parts(self.untagged_ptr() as usize as *const u16, self.len) }
    }
    /// Raw bytes regardless of encoding (`len * 2` for UTF-16).
    pub fn byte_slice(self) -> &'a [u8] {
        if self.len == 0 {
            return &[];
        }
        let bytes = if self.is_16bit() {
            self.len * 2
        } else {
            self.len
        };
        // SAFETY: constructor stored a valid ptr for `len` elements of the
        // tagged width; `bytes` is exactly that element count times element
        // size.
        unsafe { core::slice::from_raw_parts(self.untagged_ptr(), bytes) }
    }

    /// Exact UTF-8 byte length needed to encode this string.
    pub(crate) fn utf8_byte_length(self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return crate::strings::element_length_utf16_into_utf8(self.utf16_slice());
        }
        let s = self.slice();
        // SAFETY: s describes a valid byte slice.
        unsafe { bun_simdutf_sys::simdutf::simdutf__utf8_length_from_latin1(s.as_ptr(), s.len()) }
    }

    /// Number of bytes the UTF-16LE encoding of this string would occupy.
    pub(crate) fn utf16_byte_length(self) -> usize {
        if self.is_utf8() {
            let s = self.slice();
            // SAFETY: s describes a valid byte slice.
            return unsafe {
                bun_simdutf_sys::simdutf::simdutf__utf16_length_from_utf8(s.as_ptr(), s.len())
            } * 2;
        }
        if self.is_16bit() {
            return self.len * 2;
        }
        // Latin-1 → one UTF-16 code unit per byte.
        self.len * 2
    }

    /// Allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(self) -> crate::ZBox {
        if self.is_utf8() {
            let mut v = self.slice().to_vec();
            v.push(0);
            return crate::ZBox::from_vec_with_nul(v);
        }
        let mut list = if self.is_16bit() {
            crate::strings::to_utf8_alloc(self.utf16_slice())
        } else {
            crate::strings::allocate_latin1_into_utf8_with_list(Vec::new(), 0, self.slice())
        };
        list.push(0);
        crate::ZBox::from_vec_with_nul(list)
    }

    /// First index whose code unit matches any byte in `chars`. The 16-bit
    /// branch narrows each unit to the Latin-1 range before comparing.
    pub fn index_of_any(self, chars: &[u8]) -> Option<usize> {
        if self.is_16bit() {
            self.utf16_slice()
                .iter()
                .position(|&c| c < 256 && chars.contains(&(c as u8)))
        } else {
            crate::strings::index_of_any(self.slice(), chars)
        }
    }

    /// Code unit at `i`, widened to `u16` regardless of encoding. Caller must
    /// ensure `i < self.len`.
    #[inline]
    pub fn char_at(self, i: usize) -> u16 {
        debug_assert!(i < self.len);
        if self.is_16bit() {
            self.utf16_slice()[i]
        } else {
            self.slice()[i] as u16
        }
    }

    /// Encoding-aware equality against ASCII bytes.
    pub fn eq_ascii(self, ascii: &[u8]) -> bool {
        debug_assert!(ascii.is_ascii(), "eq_ascii expects ASCII");
        if self.is_16bit() {
            return strings::eql_comptime_utf16(self.utf16_slice(), ascii);
        }
        if self.len != ascii.len() {
            return false;
        }
        strings::eql_comptime_ignore_len(self.slice(), ascii)
    }

    /// Encoding-aware ASCII prefix check.
    pub fn starts_with_ascii(self, ascii: &[u8]) -> bool {
        debug_assert!(ascii.is_ascii(), "starts_with_ascii expects ASCII");
        if self.is_16bit() {
            let s = self.utf16_slice();
            return s.len() >= ascii.len() && s.iter().zip(ascii).all(|(&c, &a)| c == u16::from(a));
        }
        self.slice().starts_with(ascii)
    }

    /// Encoding-aware equality.
    pub(crate) fn eql(self, other: EncodedSlice<'_>) -> bool {
        if self.len == 0 || other.len == 0 {
            return self.len == other.len;
        }
        let l16 = self.is_16bit();
        let r16 = other.is_16bit();
        if l16 && r16 {
            return self.utf16_slice() == other.utf16_slice();
        }
        if !l16 && !r16 {
            return self.slice() == other.slice();
        }
        // Mixed encoding — go through the UTF-8 view.
        self.to_utf8().slice() == other.to_utf8().slice()
    }

    /// `Display`-format into `buf`, NUL-terminate, and return the borrowed
    /// `&ZStr`. Errors if the formatted output (plus NUL) would not fit.
    pub fn slice_z_buf(self, buf: &mut crate::PathBuffer) -> crate::CrateResult<&ZStr> {
        use std::io::Write as _;
        let buf_slice: &mut [u8] = &mut buf[..];
        let start_len = buf_slice.len();
        let mut cursor: &mut [u8] = buf_slice;
        write!(cursor, "{}", self).map_err(|_| crate::CrateError::NoSpaceLeft)?;
        let written = start_len - cursor.len();
        if written >= buf.len() {
            return Err(crate::CrateError::NoSpaceLeft);
        }
        buf[written] = 0;
        Ok(ZStr::from_buf(&buf[..], written))
    }

    /// Re-wrap a sub-range of the underlying storage, preserving the
    /// UTF-8/16-bit/global tag bits.
    pub fn substring_range(self, start_index: usize, end_index: usize) -> Self {
        if self.is_16bit() {
            let mut out = Self::utf16(&self.utf16_slice()[start_index..end_index]);
            if self.is_globally_allocated() {
                out.mark(TAG_GLOBAL_BIT);
            }
            return out;
        }
        let mut out = Self::latin1(&self.slice()[start_index..end_index]);
        if self.is_utf8() {
            out.mark(TAG_UTF8_BIT);
        }
        if self.is_globally_allocated() {
            out.mark(TAG_GLOBAL_BIT);
        }
        out
    }
    #[inline]
    pub fn substring(self, start_index: usize) -> Self {
        self.substring_range(start_index.min(self.len), self.len)
    }
    /// Clamp `len`, preserving the pointer (and its tag bits) verbatim.
    #[inline]
    pub(crate) fn trunc(self, len: usize) -> Self {
        Self::from_tagged_ptr(self.tagged_ptr(), self.len.min(len))
    }
    /// Borrowed-or-owned UTF-8: borrows when UTF-8-tagged or all-ASCII 8-bit,
    /// transcodes UTF-16 and Latin-1 with high bytes.
    #[inline]
    pub fn to_utf8(self) -> Utf8Bytes<'a> {
        if self.len == 0 {
            return Utf8Bytes::EMPTY;
        }
        if self.is_16bit() {
            return Utf8Bytes::Owned(crate::strings::to_utf8_alloc(self.utf16_slice()));
        }
        let bytes = self.slice();
        if !self.is_utf8() {
            // Non-UTF-8 = Latin-1; transcode if any byte ≥ 0x80.
            if let Some(v) = crate::strings::to_utf8_from_latin1(bytes) {
                return Utf8Bytes::Owned(v);
            }
        }
        Utf8Bytes::Borrowed(bytes)
    }

    /// Allocate a fresh UTF-8 `Vec<u8>` regardless of the source encoding.
    pub fn to_owned_slice(self) -> Vec<u8> {
        self.to_utf8().into_vec()
    }
}

/// UTF-8 bytes derived from a string: borrowed when the source is already
/// UTF-8 (incl. 8-bit all-ASCII), otherwise a transcoded copy, or a view kept
/// alive by the WTF-backed `String` it holds.
#[derive(Clone)]
pub enum Utf8Bytes<'a> {
    Borrowed(&'a [u8]),
    Owned(Vec<u8>),
    /// 8-bit all-ASCII `Tag::WTFStringImpl` string; the bytes are its buffer.
    Shared(String),
}
impl Default for Utf8Bytes<'_> {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}
impl<'a> Utf8Bytes<'a> {
    pub const EMPTY: Self = Self::Borrowed(b"");
    /// Detach from any `'a` borrow: `Borrowed` is copied; `Owned`/`Shared`
    /// pass through.
    #[inline]
    pub fn into_owned(self) -> Utf8Bytes<'static> {
        match self {
            Self::Borrowed(b) => Utf8Bytes::Owned(b.to_vec()),
            Self::Owned(v) => Utf8Bytes::Owned(v),
            Self::Shared(s) => Utf8Bytes::Shared(s),
        }
    }
    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Borrowed(b) => b,
            Self::Owned(v) => v,
            Self::Shared(s) => s.as_wtf().latin1_slice(),
        }
    }
    /// Consume into an owned `Vec<u8>` — moves out the buffer if `Owned`,
    /// allocates a copy otherwise.
    pub fn into_vec(self) -> Vec<u8> {
        match self {
            Self::Owned(v) => v,
            other => other.slice().to_vec(),
        }
    }
    /// True iff the bytes are a transcoded/copied buffer rather than a view
    /// of the source string.
    #[inline]
    pub fn is_owned(&self) -> bool {
        matches!(self, Self::Owned(_))
    }
}
impl core::ops::Deref for Utf8Bytes<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.slice()
    }
}
impl AsRef<[u8]> for Utf8Bytes<'_> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.slice()
    }
}

/// A UTF-8 view of `string`: `utf8` holds a transcoded copy when
/// `string` is not already UTF-8 (or when there is no `string`);
/// otherwise the bytes are read from `string` on demand.
#[derive(Clone, Default)]
pub struct Utf8WithString {
    utf8: Option<Vec<u8>>,
    string: String,
}

impl Utf8WithString {
    /// Wrap `string` (any encoding) only to hand it to JS via `into_parts`;
    /// `slice()` debug-asserts it is not called on a non-UTF-8 `string`.
    #[inline]
    pub fn js_only(string: String) -> Self {
        Self { utf8: None, string }
    }

    /// True iff the UTF-8 bytes are read straight out of a WTF-backed
    /// `string` (no transcoded copy).
    #[inline]
    pub fn is_shared(&self) -> bool {
        self.utf8.is_none() && self.string.tag == Tag::WTFStringImpl
    }

    /// The UTF-8 bytes.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        if let Some(utf8) = &self.utf8 {
            return utf8;
        }
        self.string.utf8_slice()
    }

    /// Detach the UTF-8 bytes for storing: moves the transcoded copy out, or
    /// moves `string`'s ref into a `Shared` slice.
    pub fn into_utf8(self) -> Utf8Bytes<'static> {
        match self.utf8 {
            Some(utf8) => Utf8Bytes::Owned(utf8),
            None => self.string.into_utf8(),
        }
    }

    /// `(transcoded copy, string)`.
    pub fn into_parts(self) -> (Option<Vec<u8>>, String) {
        (self.utf8, self.string)
    }

    /// For handing the value to one work-pool job that is dropped back on
    /// the JS thread: keep a WTF-backed `string` only when it backs the bytes
    /// and is not an atom/symbol, otherwise own the bytes and drop it.
    pub fn make_thread_isolated(&mut self) {
        if self.string.tag != Tag::WTFStringImpl {
            return;
        }
        if self.utf8.is_none() {
            let wtf = self.string.as_wtf();
            // The job only reads the bytes and the deref happens on the JS thread, so a plain/substring impl may stay.
            if !wtf.is_atom() && !wtf.is_symbol() {
                return;
            }
            self.utf8 = Some(self.slice().to_vec());
        }
        self.string = String::EMPTY;
    }

    /// For a holder that may be dropped on any thread (a `Blob` store): the
    /// bytes end up owned by this value alone — the transcoded `utf8` if
    /// there is one (the WTF backing is dropped), else a
    /// [`String::thread_isolated_copy`] that is never handed to JS.
    pub fn thread_isolated_copy(self) -> Self {
        if self.string.tag != Tag::WTFStringImpl {
            return self;
        }
        let string = if self.utf8.is_some() {
            String::EMPTY
        } else {
            self.string.thread_isolated_copy()
        };
        Self {
            utf8: self.utf8,
            string,
        }
    }
}

// PORTING.md: ZStr/WStr are length-carrying NUL-terminated slices.
// bun_core re-exports these; we are the canonical home.
pub use crate::{WStr, ZStr};

pub use crate::StringPointer;

pub use hashed_string::HashedString;
pub use mutable_string::MutableString;
pub use smol_str::SmolStr;
pub use string_builder::StringBuilder;

// ──────────────────────────────────────────────────────────────────────────
// `encoding` — Node.js Buffer encoding tag. Self-contained.
// ──────────────────────────────────────────────────────────────────────────
pub mod encoding {
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub enum Encoding {
        #[default]
        Utf8 = 0,
        Ucs2,
        Utf16le,
        Latin1,
        Ascii,
        Base64,
        Base64url,
        Hex,
        Buffer,
    }
}
pub use encoding::Encoding as NodeEncoding;

// ──────────────────────────────────────────────────────────────────────────
// `lexer` — identifier predicates. Thin `u32`-taking wrapper over the
// [`identifier`] two-stage Unicode tables (moved down from `bun_js_parser`).
// ──────────────────────────────────────────────────────────────────────────
pub mod lexer {
    #[inline]
    pub fn is_identifier_start(c: u32) -> bool {
        crate::string::identifier::is_identifier_start(c as i32)
    }
    #[inline]
    pub(crate) fn is_identifier_continue(c: u32) -> bool {
        crate::string::identifier::is_identifier_part(c as i32)
    }
    #[inline]
    pub fn is_identifier_part(c: u32) -> bool {
        is_identifier_continue(c)
    }
    pub use crate::string::identifier::{is_identifier, is_identifier_utf16};
}

pub mod lexer_tables {
    crate::comptime_string_map! {
        /// The 9 strict-mode reserved words (ES2015 §11.6.2.2) mapped to the
        /// underscore-prefixed replacement used by
        /// `MutableString::ensure_valid_identifier` to mangle a name that is
        /// already a syntactically valid identifier but would collide with a
        /// strict-mode reserved word. Single source of truth —
        /// [`STRICT_MODE_RESERVED_WORDS`], [`is_strict_mode_reserved_word`],
        /// and [`strict_mode_reserved_word_remap`] all derive from it.
        static STRICT_MODE_RESERVED_WORD_REMAP: &'static [u8] = {
            b"implements" => b"_implements",
            b"interface" => b"_interface",
            b"let" => b"_let",
            b"package" => b"_package",
            b"private" => b"_private",
            b"protected" => b"_protected",
            b"public" => b"_public",
            b"static" => b"_static",
            b"yield" => b"_yield",
        };
    }

    /// The 9 strict-mode reserved words as a plain array, for callers that
    /// only need `.len()` / `.iter()`.
    pub const STRICT_MODE_RESERVED_WORDS: [&[u8]; 9] = {
        let entries = __ComptimeStringMap_STRICT_MODE_RESERVED_WORD_REMAP::ENTRIES;
        assert!(entries.len() == 9);
        let mut out: [&[u8]; 9] = [&[]; 9];
        let mut i = 0;
        while i < out.len() {
            out[i] = entries[i].0;
            i += 1;
        }
        out
    };

    /// Hot-path strict-mode reserved-word membership check.
    #[inline]
    pub fn is_strict_mode_reserved_word(s: &[u8]) -> bool {
        STRICT_MODE_RESERVED_WORD_REMAP.contains_key(s)
    }

    /// Underscore-prefixed replacement for a strict-mode reserved word
    /// (`b"let"` → `b"_let"`); `None` for any other input.
    #[inline]
    pub fn strict_mode_reserved_word_remap(s: &[u8]) -> Option<&'static [u8]> {
        STRICT_MODE_RESERVED_WORD_REMAP.get(s).copied()
    }
}

/// Process-wide WTF::StringImpl character-count cap, exported for C++ as
/// `Bun__stringSyntheticAllocationLimit`. The value lives here (not `bun_jsc`)
/// because [`String::max_length`] / `create_external*` need it without an
/// upward dep; `bun_jsc::VirtualMachine` writes it during init / via the
/// `setSyntheticAllocationLimitForTesting` hook.
#[unsafe(export_name = "Bun__stringSyntheticAllocationLimit")]
pub static STRING_ALLOCATION_LIMIT: AtomicUsize = AtomicUsize::new(u32::MAX as usize);

/// Mirror of `WTF::StringImpl::MaxLength` (`INT32_MAX`), which C++ enforces
/// with `RELEASE_ASSERT` in the `StringImplShape` constructors.
pub const WTF_STRING_MAX_LENGTH: usize = i32::MAX as usize;

// ──────────────────────────────────────────────────────────────────────────
// move-in: printer (MOVE_DOWN ← `bun_js_printer`)
//
// Self-contained string-quoting helpers used by `strings::format_escapes`,
// `bun_sourcemap::Chunk` (JSON serialization), and `bun_ast::Expr`.
// Breaking the `bun_js_printer → bun_sourcemap` cycle by hosting the
// pure-string `quoteForJSON` here.
// ──────────────────────────────────────────────────────────────────────────
pub mod printer {
    use crate::string::immutable::{self as strings, Encoding as StrEncoding};
    use crate::string::mutable_string::MutableString;

    use crate::fmt::{hex2_upper, hex4_upper};

    pub const FIRST_ASCII: u32 = 0x20;
    pub const LAST_ASCII: u32 = 0x7E;
    pub const FIRST_HIGH_SURROGATE: u32 = 0xD800;
    pub const LAST_LOW_SURROGATE: u32 = 0xDFFF;

    /// Encode a BMP code unit (`c <= 0xFFFF`, including lone surrogates) as the
    /// 6-byte sequence `\uHHHH` (uppercase hex). Caller feeds the result to its
    /// own byte sink.
    #[inline]
    pub const fn bmp_escape(c: u32) -> [u8; 6] {
        let h = hex4_upper(c as u16);
        [b'\\', b'u', h[0], h[1], h[2], h[3]]
    }

    /// Encode a supplementary code point (`c > 0xFFFF`) as a 12-byte UTF-16
    /// surrogate-pair `\uHHHH\uHHHH` escape (uppercase hex).
    #[inline]
    pub const fn surrogate_pair_escape(c: u32) -> [u8; 12] {
        let [lo, hi] = crate::strings::encode_surrogate_pair(c);
        let l = hex4_upper(lo);
        let h = hex4_upper(hi);
        [
            b'\\', b'u', l[0], l[1], l[2], l[3], b'\\', b'u', h[0], h[1], h[2], h[3],
        ]
    }

    /// Byte-sink alias so `write_pre_quoted_string` works for `Vec<u8>`,
    /// `MutableString`, and any other `crate::io::Write` sink.
    pub use crate::io::Write as PrinterWriter;

    #[inline]
    fn can_print_without_escape(c: i32, ascii_only: bool) -> bool {
        if c <= LAST_ASCII as i32 {
            c >= FIRST_ASCII as i32
                && c != b'\\' as i32
                && c != b'"' as i32
                && c != b'\'' as i32
                && c != b'`' as i32
                && c != b'$' as i32
        } else {
            !ascii_only
                && c != 0xFEFF
                && c != 0x2028
                && c != 0x2029
                && (c < FIRST_HIGH_SURROGATE as i32 || c > LAST_LOW_SURROGATE as i32)
        }
    }

    /// Same algorithm as `bun_js_printer::write_pre_quoted_string`.
    /// PERF: (quote_char, ascii_only, json, encoding) are runtime params —
    /// profile if it shows up on a hot path.
    pub fn write_pre_quoted_string<W: PrinterWriter + ?Sized>(
        text_in: &[u8],
        writer: &mut W,
        quote_char: u8,
        ascii_only: bool,
        json: bool,
        encoding: StrEncoding,
    ) -> crate::CrateResult<()> {
        debug_assert!(!json || quote_char == b'"');
        // utf16 view over the same bytes (only used when encoding == Utf16).
        // Callers pass 2-byte-aligned even-length input for Utf16; `cast_slice`
        // panics (rather than UB) if that contract is violated.
        let text16: &[u16] = if encoding == StrEncoding::Utf16 {
            crate::cast_slice::<u8, u16>(text_in)
        } else {
            &[]
        };
        let n: usize = if encoding == StrEncoding::Utf16 {
            text16.len()
        } else {
            text_in.len()
        };
        let mut i: usize = 0;

        while i < n {
            let width: u8 = match encoding {
                StrEncoding::Latin1 | StrEncoding::Ascii | StrEncoding::Utf16 => 1,
                StrEncoding::Utf8 => strings::wtf8_byte_sequence_length_with_invalid(text_in[i]),
            };
            let clamped_width = (width as usize).min(n.saturating_sub(i));
            let c: i32 = match encoding {
                StrEncoding::Utf8 => {
                    let mut buf = [0u8; 4];
                    buf[..clamped_width].copy_from_slice(&text_in[i..i + clamped_width]);
                    strings::decode_wtf8_rune_t::<i32>(buf, width, 0)
                }
                StrEncoding::Ascii => {
                    debug_assert!(text_in[i] <= 0x7F);
                    text_in[i] as i32
                }
                StrEncoding::Latin1 => text_in[i] as i32,
                StrEncoding::Utf16 => text16[i] as i32,
            };

            if can_print_without_escape(c, ascii_only) {
                match encoding {
                    StrEncoding::Ascii | StrEncoding::Utf8 => {
                        let remain = &text_in[i + clamped_width..];
                        if let Some(j) = strings::index_of_needs_escape_for_java_script_string(
                            remain, quote_char,
                        ) {
                            writer.write_all(&text_in[i..i + clamped_width])?;
                            i += clamped_width;
                            writer.write_all(&remain[..j as usize])?;
                            i += j as usize;
                        } else {
                            writer.write_all(&text_in[i..])?;
                            break;
                        }
                    }
                    StrEncoding::Latin1 | StrEncoding::Utf16 => {
                        let mut cp = [0u8; 4];
                        let cp_len = strings::encode_wtf8_rune(&mut cp, c as u32);
                        writer.write_all(&cp[..cp_len])?;
                        i += clamped_width;
                    }
                }
                continue;
            }

            match c {
                0x07 => {
                    writer.write_all(if json { b"\\u0007" } else { b"\\x07" })?;
                    i += 1;
                }
                0x08 => {
                    writer.write_all(b"\\b")?;
                    i += 1;
                }
                0x0C => {
                    writer.write_all(b"\\f")?;
                    i += 1;
                }
                0x0A => {
                    writer.write_all(if quote_char == b'`' { b"\n" } else { b"\\n" })?;
                    i += 1;
                }
                0x0D => {
                    writer.write_all(b"\\r")?;
                    i += 1;
                }
                0x0B => {
                    writer.write_all(if json { b"\\u000B" } else { b"\\v" })?;
                    i += 1;
                }
                0x5C => {
                    writer.write_all(b"\\\\")?;
                    i += 1;
                }
                0x22 => {
                    writer.write_all(if quote_char == b'"' { b"\\\"" } else { b"\"" })?;
                    i += 1;
                }
                0x27 => {
                    writer.write_all(if quote_char == b'\'' { b"\\'" } else { b"'" })?;
                    i += 1;
                }
                0x60 => {
                    writer.write_all(if quote_char == b'`' { b"\\`" } else { b"`" })?;
                    i += 1;
                }
                0x24 => {
                    if quote_char == b'`' {
                        let next_is_brace = match encoding {
                            StrEncoding::Utf16 => i + 1 < n && text16[i + 1] == b'{' as u16,
                            _ => i + 1 < n && text_in[i + 1] == b'{',
                        };
                        writer.write_all(if next_is_brace { b"\\$" } else { b"$" })?;
                    } else {
                        writer.write_all(b"$")?;
                    }
                    i += 1;
                }
                0x09 => {
                    writer.write_all(if quote_char == b'`' { b"\t" } else { b"\\t" })?;
                    i += 1;
                }
                _ => {
                    i += width as usize;
                    if c <= 0xFF && !json {
                        let h = hex2_upper(c as u8);
                        writer.write_all(&[b'\\', b'x', h[0], h[1]])?;
                    } else if c <= 0xFFFF {
                        writer.write_all(&bmp_escape(c as u32))?;
                    } else {
                        writer.write_all(&surrogate_pair_escape(c as u32))?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Port of `js_printer.quoteForJSON`. MOVE_DOWN so `bun_sourcemap` /
    /// `bun_js_parser` can call it without depending on `bun_js_printer`.
    pub fn quote_for_json(
        text: &[u8],
        bytes: &mut MutableString,
        ascii_only: bool,
    ) -> crate::CrateResult<()> {
        // PERF: consider pre-growing via an estimated UTF-8 length — profile if it shows up on a hot path.
        bytes.append_char(b'"')?;
        write_pre_quoted_string(text, bytes, b'"', ascii_only, true, StrEncoding::Utf8)?;
        bytes.append_char(b'"').expect("unreachable");
        Ok(())
    }
}
pub use printer::quote_for_json;

// ──────────────────────────────────────────────────────────────────────────
// Top-level free helpers.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::ffi::slice_to_nul;

/// Pure path-string helper used by the bundler chunk writer and `css::printer`.
/// Returns `[prefix', suffix']` such that concatenating them produces a
/// reasonably-normalized path (collapses `./` leading and avoids `//`).
/// The two-element-array return shape lets bundler call-sites index it
/// directly.
pub fn cheap_prefix_normalizer<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> [&'a [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if strings::has_prefix_comptime(suffix_no_slash, b"../") {
                b""
            } else {
                b"./"
            },
            suffix_no_slash,
        ];
    }

    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"]                 => "/foo/bar.js"
    let win = crate::Environment::IS_WINDOWS;
    if strings::ends_with_char(prefix, b'/') || (win && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/')
            || (win && strings::starts_with_char(suffix, b'\\'))
        {
            return [prefix, &suffix[1..]];
        }
        // It gets really complicated if we try to deal with URLs more than this.
    }

    [prefix, strings::remove_leading_dot_slash(suffix)]
}

// Re-export `wtf::parse_double` at crate root (callers spell it `bun_core::parse_double`).
pub use wtf::parse_double;
