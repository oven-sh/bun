#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_str` — B-1 minimal compiling surface.
//! Full Phase-A draft preserved in `lib_draft_b1.rs` (gated).
//! B-2: un-gate module-by-module, replace stubs with real impls.

// Small data-structure modules — un-gated in B-2.
#[path = "HashedString.rs"]  pub mod hashed_string;
#[path = "PathString.rs"]    pub mod path_string;
#[path = "SmolStr.rs"]       pub mod smol_str;
// TODO(b2-blocked): StringBuilder needs simdutf transcoding + String::to_utf8.
#[cfg(any())] #[path = "StringBuilder.rs"] pub mod string_builder;
pub mod string_builder {
    #[derive(Default)]
    pub struct StringBuilder { pub buf: Vec<u8>, pub len: usize, pub cap: usize }
}
#[path = "StringJoiner.rs"]  pub mod string_joiner;
#[path = "escapeRegExp.rs"]  pub mod escape_reg_exp;

// TODO(b2-blocked): MutableString + wtf both need `strings::{to_utf8_alloc,
// to_utf8_from_latin1, copy_utf16_into_utf8, CodepointIterator}` (the SIMD
// transcoding suite from immutable.rs) + WTFStringImpl FFI. Un-gate after
// `immutable` lands.
#[cfg(any())] #[path = "MutableString.rs"] pub mod mutable_string;
#[cfg(any())] pub mod wtf;
pub mod mutable_string {
    /// `bun.MutableString` — growable byte buffer (`Vec<u8>` newtype).
    #[derive(Default)]
    pub struct MutableString(pub Vec<u8>);
}
pub mod wtf {
    pub use bun_alloc::WTFStringImplStruct as WTFStringImpl;
}

// `bun.strings.*` — 132 SIMD-backed scanners over highway/simdutf FFI.
// Submodules (unicode_draft etc.) gated inside; core scalar+highway fns real.
#[path = "immutable.rs"] pub mod immutable;
// Full Phase-A draft of string.zig (the 5-variant String impl). Real
// `String`/`ZigString` already MOVE-IN'd to bun_alloc (T0); re-exported below.
#[cfg(any())] #[path = "lib_draft_b1.rs"] mod draft;

use core::sync::atomic::{AtomicPtr, Ordering};

// ──────────────────────────────────────────────────────────────────────────
// `bun.String` — 5-variant tagged WTFString-or-slice. B-1: opaque 24-byte
// shell so type-checking works; B-2 wires WTFStringImpl FFI.
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct String {
    tag: Tag,
    _pad: [u8; 7],
    ptr: *const u8,
    len: usize,
}
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tag { Dead = 0, WTF, Zig, Static, Empty }
impl String {
    pub const EMPTY: Self = Self { tag: Tag::Empty, _pad: [0; 7], ptr: core::ptr::null(), len: 0 };
    pub fn borrow_utf8(s: &[u8]) -> Self {
        Self { tag: Tag::Zig, _pad: [0; 7], ptr: s.as_ptr(), len: s.len() }
    }
    pub fn deref(&self) {}
    pub fn ref_(&self) {}
    pub fn is_empty(&self) -> bool { self.len == 0 }
    pub fn tag(&self) -> Tag { self.tag }
}
unsafe impl Send for String {}
unsafe impl Sync for String {}

#[repr(C)] pub struct WTFStringImpl { _p: [u8; 0] }
pub type WTFString = *const WTFStringImpl;
#[repr(C)] pub struct ZigString { ptr: *const u8, len: usize }

// PORTING.md: ZStr/WStr are length-carrying NUL-terminated slices.
// bun_core re-exports these; we are the canonical home.
pub use bun_core::{ZStr, WStr};

/// `bun.schema.api.StringPointer` — `(offset, length)` into an external buffer.
/// Widely used as a flat span descriptor (lockfile, HTTP headers, etc.).
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct StringPointer {
    pub offset: u32,
    pub length: u32,
}

pub use path_string::PathString;
pub use mutable_string::MutableString;
pub use hashed_string::HashedString;
pub use smol_str::SmolStr;
pub use string_builder::StringBuilder;

// ──────────────────────────────────────────────────────────────────────────
// `encoding` — Node.js Buffer encoding tag. Self-contained.
// ──────────────────────────────────────────────────────────────────────────
pub mod encoding {
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub enum Encoding {
        #[default] Utf8 = 0, Ucs2, Utf16le, Latin1, Ascii, Base64, Base64url, Hex, Buffer,
    }
    impl Encoding {
        pub fn is_binary_to_text(self) -> bool {
            matches!(self, Self::Hex | Self::Base64 | Self::Base64url)
        }
    }
}
pub use encoding::Encoding as NodeEncoding;

// `strings` is the canonical Zig namespace name; alias to the real module.
pub use immutable as strings;

// ──────────────────────────────────────────────────────────────────────────
// `lexer` — identifier predicates (ASCII fast path + hook for Unicode).
// ──────────────────────────────────────────────────────────────────────────
pub mod lexer {
    use core::sync::atomic::{AtomicPtr, Ordering};
    pub static ID_START_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static ID_CONTINUE_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    #[inline] pub fn is_identifier_start(c: u32) -> bool {
        (c as u8 as u32 == c) && ((c as u8).is_ascii_alphabetic() || c == b'_' as u32 || c == b'$' as u32)
        // TODO(b2): non-ASCII via ID_START_ESNEXT_HOOK
    }
    #[inline] pub fn is_identifier_continue(c: u32) -> bool {
        is_identifier_start(c) || (c as u8 as u32 == c && (c as u8).is_ascii_digit())
    }
}

pub mod lexer_tables {
    pub static STRICT_MODE_RESERVED_WORDS_REMAP: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
        b"implements" => b"_implements".as_slice(),
        b"interface" => b"_interface".as_slice(),
        b"let" => b"_let".as_slice(),
        b"package" => b"_package".as_slice(),
        b"private" => b"_private".as_slice(),
        b"protected" => b"_protected".as_slice(),
        b"public" => b"_public".as_slice(),
        b"static" => b"_static".as_slice(),
        b"yield" => b"_yield".as_slice(),
    };
}

// Hook slot: bun_runtime sets the WTFString allocation cap.
pub static STRING_ALLOCATION_LIMIT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
