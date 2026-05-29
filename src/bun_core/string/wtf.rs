use crate::string::strings;
// TODO(port): ZigString.Slice is a nested type in Zig; in Rust it lives alongside ZigString.
use crate::string::ZigStringSlice;

pub use bun_alloc::{WTFStringImpl, WTFStringImplPtr, WTFStringImplStruct};

pub use crate::external_shared::WTFString;

/// `WTF::RefPtr<T>` — a nullable owning reference into an externally-refcounted
/// object. Generic re-export so callers can write `wtf::RefPtr<StringImpl>`
/// (matching the C++ spelling) without reaching into `bun_ptr` directly.
pub type RefPtr<T> = crate::external_shared::ExternalShared<T>;

/// `WTF::StringImpl` — alias to the layout-mirroring struct so call sites can
/// spell `wtf::StringImpl` (used by `wtf::RefPtr<StringImpl>`).
pub type StringImpl = WTFStringImplStruct;

pub trait WTFStringImplExt {
    fn to_latin1_slice(&self) -> ZigStringSlice;
    fn to_utf8(&self) -> ZigStringSlice;
    fn to_utf8_without_ref(&self) -> ZigStringSlice;
    fn to_utf8_borrowed(&self) -> ZigStringSlice;
    fn to_owned_slice_z(&self) -> crate::ZBox;
    fn to_utf8_if_needed(&self) -> Option<ZigStringSlice>;
    fn can_use_as_utf8(&self) -> bool;
    fn utf8_byte_length(&self) -> usize;
    fn utf8_slice(&self) -> &[u8];
}

impl WTFStringImplExt for WTFStringImplStruct {
    #[inline]
    fn to_latin1_slice(&self) -> ZigStringSlice {
        self.r#ref();
        let s = self.latin1_slice();
        // ZigStringSlice::WTF derefs `self` on Drop — replaces the Zig
        // StringImplAllocator vtable trick with explicit ownership.
        // SAFETY: `self` is a live WTF::StringImpl with refcount just bumped above;
        // we store only a `*const` (never materialize `&mut`) and the matching
        // deref happens via FFI on Drop. Mutation of m_ref_count is C++-side
        // interior mutability, same as `r#ref`/`deref` already rely on.
        ZigStringSlice::WTF {
            string_impl: std::ptr::from_ref::<Self>(self),
            ptr: s.as_ptr(),
            len: s.len(),
        }
    }

    #[inline]
    fn to_utf8(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return self.to_latin1_slice();
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    #[inline]
    fn to_utf8_without_ref(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return ZigStringSlice::from_utf8_never_free(self.latin1_slice());
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    #[inline]
    fn to_utf8_borrowed(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            // All-ASCII Latin-1: borrow the impl's own bytes, no refcount bump.
            let s = self.latin1_slice();
            return ZigStringSlice::WtfBorrowed {
                string_impl: std::ptr::from_ref::<Self>(self),
                ptr: s.as_ptr(),
                len: s.len(),
            };
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Allocates a NUL-terminated UTF-8 copy. Port of `toOwnedSliceZ`.
    /// `.len()` excludes the sentinel (Zig `[:0]u8` semantics).
    fn to_owned_slice_z(&self) -> crate::ZBox {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                return utf8;
            }
            // ASCII: copy bytes; ZBox appends the NUL.
            return crate::ZBox::from_vec_with_nul(self.latin1_slice().to_vec());
        }
        strings::to_utf8_alloc_z(self.utf16_slice())
    }

    fn to_utf8_if_needed(&self) -> Option<ZigStringSlice> {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return Some(ZigStringSlice::init_owned(utf8));
            }

            return None;
        }

        Some(ZigStringSlice::init_owned(strings::to_utf8_alloc(
            self.utf16_slice(),
        )))
    }

    /// Avoid using this in code paths that are about to get the string as a UTF-8
    /// In that case, use to_utf8_if_needed instead.
    fn can_use_as_utf8(&self) -> bool {
        self.is_8bit() && strings::is_all_ascii(self.latin1_slice())
    }

    fn utf8_byte_length(&self) -> usize {
        if self.is_8bit() {
            let input = self.latin1_slice();
            if !input.is_empty() {
                strings::element_length_latin1_into_utf8(input)
            } else {
                0
            }
        } else {
            let input = self.utf16_slice();
            if !input.is_empty() {
                strings::element_length_utf16_into_utf8(input)
            } else {
                0
            }
        }
    }

    /// Caller must ensure that the string is 8-bit and ASCII.
    #[inline]
    fn utf8_slice(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.can_use_as_utf8());
        }
        self.raw_bytes(self.length() as usize)
    }
}

// `WTF.parseDouble` canonical now lives in bun_core::fmt (tier-0) so
// `bun_interchange` (yaml/toml) and `bun_js_parser::lexer` can call it without
// any string/jsc dep. Re-exported here to keep the Zig namespace shape.
pub use crate::fmt::{InvalidCharacter, parse_double};

// ported from: src/string/wtf.zig
