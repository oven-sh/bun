#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_str` — B-1 minimal compiling surface.
//! Full Phase-A draft preserved in `lib_draft_b1.rs` (gated).
//! B-2: un-gate module-by-module, replace stubs with real impls.

// Small data-structure modules — un-gated in B-2.
#[path = "HashedString.rs"]  pub mod hashed_string;
#[path = "PathString.rs"]    pub mod path_string;
#[path = "SmolStr.rs"]       pub mod smol_str;
#[path = "StringBuilder.rs"] pub mod string_builder;
#[path = "StringJoiner.rs"]  pub mod string_joiner;
#[path = "escapeRegExp.rs"]  pub mod escape_reg_exp;

#[path = "MutableString.rs"] pub mod mutable_string;
pub mod wtf;

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
impl ZigString {
    pub const fn init(s: &[u8]) -> Self { Self { ptr: s.as_ptr(), len: s.len() } }
    pub fn init_utf16(s: &[u16]) -> Self {
        // High bit on len marks UTF-16 (matches ZigString.zig is16BitMask).
        Self { ptr: s.as_ptr().cast(), len: s.len() | (1usize << (usize::BITS - 1)) }
    }
}

/// `ZigString.Slice` — a borrowed-or-owned UTF-8 byte slice. Replaces the
/// Zig allocator-vtable trick (`StringImplAllocator` etc.) with explicit ownership.
pub enum ZigStringSlice {
    /// Borrowed; never freed (`fromUTF8NeverFree`).
    Static(*const u8, usize),
    /// Heap-owned; Drop frees via global mimalloc.
    Owned(Vec<u8>),
    /// Backed by a WTFStringImpl ref; Drop derefs it. Stored as raw ptr to
    /// avoid wtf-module cycle; `wtf::to_latin1_slice` constructs this.
    WTF { string_impl: *mut wtf::WTFStringImplStruct, ptr: *const u8, len: usize },
}
impl ZigStringSlice {
    pub const EMPTY: Self = Self::Static(core::ptr::null(), 0);
    pub fn from_utf8_never_free(s: &[u8]) -> Self { Self::Static(s.as_ptr(), s.len()) }
    pub fn init_owned(v: Vec<u8>) -> Self { Self::Owned(v) }
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Static(p, l) if *l == 0 => &[],
            // SAFETY: constructor guarantees ptr/len describe a valid slice for self's lifetime.
            Self::Static(p, l) => unsafe { core::slice::from_raw_parts(*p, *l) },
            Self::Owned(v) => v.as_slice(),
            Self::WTF { ptr, len, .. } if *len == 0 => &[],
            // SAFETY: WTF variant holds a ref; latin1 buffer valid while ref held.
            Self::WTF { ptr, len, .. } => unsafe { core::slice::from_raw_parts(*ptr, *len) },
        }
    }
}
impl Drop for ZigStringSlice {
    fn drop(&mut self) {
        if let Self::WTF { string_impl, .. } = *self {
            // SAFETY: constructor took a ref; we now release it.
            unsafe { wtf::Bun__WTFStringImpl__deref(string_impl) }
        }
    }
}

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
    #[inline] pub fn is_identifier_part(c: u32) -> bool { is_identifier_continue(c) }
    /// Whole-string check. Port of `js_lexer.isIdentifier`. ASCII-only fast path;
    /// non-ASCII via hook (ES_NEXT tables installed by bun_js_parser at startup).
    pub fn is_identifier(s: &[u8]) -> bool {
        if s.is_empty() { return false; }
        let mut iter = crate::strings::CodepointIterator::init(s);
        let mut cur = crate::strings::Cursor::default();
        if !iter.next(&mut cur) || !is_identifier_start(cur.c as u32) { return false; }
        while iter.next(&mut cur) {
            if !is_identifier_continue(cur.c as u32) { return false; }
        }
        true
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
