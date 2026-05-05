#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_str` — B-1 minimal compiling surface.
//! Full Phase-A draft preserved in `lib_draft_b1.rs` (gated).
//! B-2: un-gate module-by-module, replace stubs with real impls.

#[cfg(any())] #[path = "lib_draft_b1.rs"] mod draft;
#[cfg(any())] pub mod immutable;
#[cfg(any())] #[path = "HashedString.rs"] pub mod hashed_string;
#[cfg(any())] #[path = "MutableString.rs"] pub mod mutable_string;
#[cfg(any())] #[path = "PathString.rs"] pub mod path_string;
#[cfg(any())] #[path = "SmolStr.rs"] pub mod smol_str;
#[cfg(any())] #[path = "StringBuilder.rs"] pub mod string_builder;
#[cfg(any())] #[path = "StringJoiner.rs"] pub mod string_joiner;
#[cfg(any())] pub mod wtf;

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

pub struct PathString(pub Box<[u8]>);
pub struct MutableString(pub Vec<u8>);
pub struct HashedString { pub hash: u64, pub bytes: Box<[u8]> }
pub struct SmolStr; // B-2

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

// ──────────────────────────────────────────────────────────────────────────
// `strings` (= `bun.strings.*`) — highway SIMD scanners.
// B-1 stubs route to bstr/std; PERF(port) markers for B-2 highway FFI swap.
// ──────────────────────────────────────────────────────────────────────────
pub mod strings {
    use bstr::ByteSlice;
    pub use super::encoding::Encoding;

    // PERF(port): these MUST become FFI to highway_* (src/highway/) in B-2.
    #[inline] pub fn index_of_char(s: &[u8], c: u8) -> Option<usize> { s.iter().position(|&b| b == c) }
    #[inline] pub fn index_of(s: &[u8], n: &[u8]) -> Option<usize> { s.find(n) }
    #[inline] pub fn index_of_any(s: &[u8], set: &[u8]) -> Option<usize> { s.iter().position(|b| set.contains(b)) }
    #[inline] pub fn contains(s: &[u8], n: &[u8]) -> bool { s.find(n).is_some() }
    #[inline] pub fn contains_char(s: &[u8], c: u8) -> bool { s.contains(&c) }
    #[inline] pub fn eql(a: &[u8], b: &[u8]) -> bool { a == b }
    #[inline] pub fn eql_case_insensitive_ascii<const CHECK_LEN: bool>(a: &[u8], b: &[u8]) -> bool {
        if CHECK_LEN && a.len() != b.len() { return false; }
        a.eq_ignore_ascii_case(b)
    }
    #[inline] pub fn first_non_ascii(s: &[u8]) -> Option<usize> { s.iter().position(|&b| b >= 0x80) }
    #[inline] pub fn has_prefix(s: &[u8], p: &[u8]) -> bool { s.starts_with(p) }
    #[inline] pub fn has_suffix(s: &[u8], p: &[u8]) -> bool { s.ends_with(p) }
}
pub use strings as immutable; // legacy alias

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
