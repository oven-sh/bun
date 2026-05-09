use crate::strings;
// TODO(port): ZigString.Slice is a nested type in Zig; in Rust it lives alongside ZigString.
use crate::ZigStringSlice;

// Canonical layout lives in `bun_alloc` (lowest-tier crate) so the
// `is_wtf_allocator` vtable-identity check is a local pointer compare with no
// upward dependency. Re-exported here for back-compat with existing
// `bun_string::wtf::*` / `bun_string::WTFStringImpl*` import paths.
pub use bun_alloc::{WTFStringImpl, WTFStringImplPtr, WTFStringImplStruct};

/// Behaves like `WTF::Ref<WTF::StringImpl>`. The
/// [`bun_ptr::ExternalSharedDescriptor`] impl lives in `bun_ptr` (orphan rule:
/// trait owner gets the impl since the type is foreign to both `bun_ptr` and
/// `bun_string`).
pub use bun_ptr::WTFString;

/// `WTF::RefPtr<T>` — a nullable owning reference into an externally-refcounted
/// object. Generic re-export so callers can write `wtf::RefPtr<StringImpl>`
/// (matching the C++ spelling) without reaching into `bun_ptr` directly.
pub type RefPtr<T> = bun_ptr::ExternalShared<T>;

/// `WTF::StringImpl` — alias to the layout-mirroring struct so call sites can
/// spell `wtf::StringImpl` (used by `wtf::RefPtr<StringImpl>`).
pub type StringImpl = WTFStringImplStruct;

/// Extension methods on [`WTFStringImplStruct`] that depend on
/// `bun_string` types ([`ZigStringSlice`], `bun_core::ZBox`) or
/// `crate::strings::*` transcoding. Kept as a trait because the struct is
/// defined in `bun_alloc` and an inherent `impl` here would violate the orphan
/// rule. Glob-imported via `bun_string::WTFStringImplExt` so method-call syntax
/// keeps working at every existing callsite.
pub trait WTFStringImplExt {
    fn to_latin1_slice(&self) -> ZigStringSlice;
    fn to_utf8(&self) -> ZigStringSlice;
    fn to_utf8_without_ref(&self) -> ZigStringSlice;
    fn to_owned_slice_z(&self) -> bun_core::ZBox;
    fn to_utf8_if_needed(&self) -> Option<ZigStringSlice>;
    fn can_use_as_utf8(&self) -> bool;
    fn utf8_byte_length(&self) -> usize;
    fn utf8_slice(&self) -> &[u8];
}

impl WTFStringImplExt for WTFStringImplStruct {
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

    fn to_utf8(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return self.to_latin1_slice();
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    fn to_utf8_without_ref(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return ZigStringSlice::from_utf8_never_free(self.latin1_slice());
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Allocates a NUL-terminated UTF-8 copy. Port of `toOwnedSliceZ`.
    /// `.len()` excludes the sentinel (Zig `[:0]u8` semantics).
    fn to_owned_slice_z(&self) -> bun_core::ZBox {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                return utf8;
            }
            // ASCII: copy bytes; ZBox appends the NUL.
            return bun_core::ZBox::from_vec_with_nul(self.latin1_slice().to_vec());
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
                // Port: latin1→utf8 length is just elementLengthLatin1IntoUTF8
                // (each high byte becomes 2 utf8 bytes). The Zig went through
                // jsc.WebCore.encoding.byteLengthU8 but for Utf8 target that
                // reduces to the same arithmetic.
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

// PORT NOTE: Zig's `StringImplAllocator` was a `std.mem.Allocator` vtable trick
// (alloc() bumped ref, free() dropped it) so a `ZigString.Slice` would deref the
// WTFStringImpl when freed. Replaced by `ZigStringSlice::WTF { .. }` explicit
// ownership variant — see `to_latin1_slice` above. No allocator trait needed.

// ──────────────────────────────────────────────────────────────────────────
// move-in: parse_double (MOVE_DOWN ← src/jsc/WTF.zig `WTF.parseDouble`)
//
// Thin wrapper around WebKit's WTF__parseDouble. Lives here so
// `bun_interchange` (yaml) and `bun_js_parser::lexer` can call it without
// depending on `bun_jsc`.
// ──────────────================================================────────────

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct InvalidCharacter;

pub fn parse_double(buf: &[u8]) -> Result<f64, InvalidCharacter> {
    if buf.is_empty() {
        return Err(InvalidCharacter);
    }
    let mut count: usize = 0;
    // SAFETY: buf is a valid slice; WTF__parseDouble reads at most `length` bytes.
    let res = unsafe { WTF__parseDouble(buf.as_ptr(), buf.len(), &raw mut count) };
    if count == 0 {
        return Err(InvalidCharacter);
    }
    Ok(res)
}

unsafe extern "C" {
    fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64;
}

// ported from: src/string/wtf.zig
