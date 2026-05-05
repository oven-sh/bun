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
pub use wtf::{WTFStringImpl, WTFStringImplStruct};

// ──────────────────────────────────────────────────────────────────────────
// `bun.String` — 5-variant tagged WTFString-or-ZigString. extern layout
// must match Zig `extern struct { tag: Tag, value: StringImpl }` (= C++
// `BunString` in BunString.cpp), 24 bytes on 64-bit.
// ──────────────────────────────────────────────────────────────────────────
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union StringImpl {
    zig: ZigString,
    wtf: WTFStringImpl, // *mut WTFStringImplStruct
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct String {
    tag: Tag,
    // repr(C) inserts 7 bytes padding here (StringImpl is 8-aligned).
    value: StringImpl,
}

const _: () = assert!(core::mem::size_of::<String>() == 24);
const _: () = assert!(core::mem::align_of::<String>() == 8);

// FFI surface from `src/jsc/bindings/BunString.cpp`. All return a fresh
// WTF-backed `String` with refcount = 1; caller must `deref()` (or transfer).
unsafe extern "C" {
    fn BunString__fromBytes(bytes: *const u8, len: usize) -> String;
    fn BunString__fromLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF8(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF16(bytes: *const u16, len: usize) -> String;
    fn BunString__fromUTF16ToLatin1(bytes: *const u16, len: usize) -> String;
    fn BunString__fromLatin1Unitialized(len: usize) -> String;
    fn BunString__fromUTF16Unitialized(len: usize) -> String;
    fn BunString__toWTFString(this: *mut String);
    fn BunString__toThreadSafe(this: *mut String);
    fn BunString__createAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__tryCreateAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternal(bytes: *const u8, len: usize, isLatin1: bool) -> String;
    fn BunString__toInt32(this: *const String) -> i64;
}

impl String {
    pub const EMPTY: Self = Self { tag: Tag::Empty, value: StringImpl { zig: ZigString::EMPTY } };
    pub const DEAD: Self = Self { tag: Tag::Dead, value: StringImpl { zig: ZigString::EMPTY } };

    #[inline] pub const fn empty() -> Self { Self::EMPTY }
    #[inline] pub const fn dead() -> Self { Self::DEAD }
    #[inline] pub fn tag(&self) -> Tag { self.tag }

    /// `bun.String.init(ZigString)` — borrow a ZigString (caller owns memory).
    #[inline]
    pub const fn init(z: ZigString) -> Self {
        Self { tag: Tag::ZigString, value: StringImpl { zig: z } }
    }

    /// `bun.String.borrowUTF8` — borrow `s` (no copy, no refcount). Caller
    /// must keep `s` alive for the String's lifetime.
    #[inline]
    pub fn borrow_utf8(s: &[u8]) -> Self {
        Self::init(ZigString::init_utf8(s))
    }
    #[inline]
    pub fn borrow_utf16(s: &[u16]) -> Self {
        Self::init(ZigString::init_utf16(s))
    }
    #[inline]
    pub fn ascii(s: &[u8]) -> Self {
        Self::init(ZigString::init(s))
    }

    /// `bun.String.static` — `'static` slice; converted to JS via
    /// `WTF::ExternalStringImpl` without copying.
    #[inline]
    pub fn static_(s: &'static [u8]) -> Self {
        // Zig: ZigString.init(input) — no UTF-8 mark on the static path.
        Self { tag: Tag::StaticZigString, value: StringImpl { zig: ZigString::init(s) } }
    }

    /// `bun.String.cloneUTF8` — copies `s` into a fresh WTF::StringImpl
    /// (refcount = 1). Caller must `deref()` or transfer ownership.
    pub fn clone_utf8(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        // BunString__fromBytes auto-detects all-ASCII → Latin1, else UTF-8.
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromBytes(s.as_ptr(), s.len()) }
    }
    pub fn clone_latin1(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        unsafe { BunString__fromLatin1(s.as_ptr(), s.len()) }
    }
    /// `bun.String.cloneUTF16` — narrows to Latin-1 if all-ASCII (string.zig:207).
    pub fn clone_utf16(s: &[u16]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
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
        unsafe { BunString__createAtom(s.as_ptr(), s.len()) }
    }
    /// `bun.String.tryCreateAtom` — `None` if `bytes` is non-ASCII or too long
    /// to atomize (string.zig:270).
    pub fn try_create_atom(bytes: &[u8]) -> Option<Self> {
        // SAFETY: bytes describes a valid slice.
        let atom = unsafe { BunString__tryCreateAtom(bytes.as_ptr(), bytes.len()) };
        if atom.tag == Tag::Dead { None } else { Some(atom) }
    }
    /// `bun.String.createAtomIfPossible` — atomized strings are interned in a
    /// thread-local table; falls back to a regular WTF copy if atomization
    /// fails. Cannot be used cross-thread (string.zig:278).
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
    /// `bun.String.createStaticExternal` — wraps `bytes` in a
    /// `WTF::ExternalStringImpl` that will **never** be freed. Only use for
    /// dynamically-allocated data with process lifetime (string.zig:427).
    pub fn create_static_external(bytes: &[u8], is_latin1: bool) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: bytes describes a valid slice; C++ side stores ptr/len
        // without copying and never frees it.
        unsafe { BunString__createStaticExternal(bytes.as_ptr(), bytes.len(), is_latin1) }
    }
    /// `bun.String.createFormat` — formats `args` into a temporary buffer and
    /// copies the result into a fresh WTF-backed string. Port collapses Zig's
    /// `(comptime fmt, args: anytype)` into [`core::fmt::Arguments`].
    pub fn create_format(args: core::fmt::Arguments<'_>) -> Self {
        use core::fmt::Write;
        // PORT NOTE: Zig used a 512-byte stackFallback. SmallVec<512> would be
        // ideal; for B-2 a heap buffer is acceptable (cold path, error msgs).
        if let Some(s) = args.as_str() {
            return Self::clone_utf8(s.as_bytes());
        }
        let mut buf = std::string::String::with_capacity(128);
        let _ = buf.write_fmt(args);
        Self::clone_utf8(buf.as_bytes())
    }
    /// Returns `(String, ptr)` where `ptr` is `len` writable bytes — or
    /// `(dead, null)` if WTF allocation failed (string.zig:128 checks
    /// `tag == .Dead` before using the buffer).
    pub fn create_uninitialized_latin1(len: usize) -> (Self, *mut u8) {
        let s = unsafe { BunString__fromLatin1Unitialized(len) };
        if s.tag != Tag::WTFStringImpl {
            return (s, core::ptr::null_mut());
        }
        debug_assert_eq!(unsafe { (*s.value.wtf).ref_count() }, 1);
        // SAFETY: WTF tag verified above; impl has a writable latin1 buffer of `len`.
        let ptr = unsafe { (*s.value.wtf).m_ptr.latin1 as *mut u8 };
        (s, ptr)
    }
    pub fn create_uninitialized_utf16(len: usize) -> (Self, *mut u16) {
        let s = unsafe { BunString__fromUTF16Unitialized(len) };
        if s.tag != Tag::WTFStringImpl {
            return (s, core::ptr::null_mut());
        }
        debug_assert_eq!(unsafe { (*s.value.wtf).ref_count() }, 1);
        let ptr = unsafe { (*s.value.wtf).m_ptr.utf16 as *mut u16 };
        (s, ptr)
    }
    /// Convert in place to a WTF-backed string (consuming the borrow).
    pub fn to_wtf_string(&mut self) {
        unsafe { BunString__toWTFString(self) }
    }
    pub fn to_thread_safe(&mut self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { BunString__toThreadSafe(self) }
        }
    }
    pub fn to_int32(&self) -> Option<i32> {
        let v = unsafe { BunString__toInt32(self) };
        if v > i32::MAX as i64 { None } else { Some(v as i32) }
    }

    /// `String.ref()` — increment WTF refcount; no-op for other tags.
    #[inline]
    pub fn ref_(&self) {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: WTF tag guarantees value.wtf is a valid live impl.
            unsafe { (*self.value.wtf).r#ref() }
        }
    }
    /// `String.deref()` — decrement WTF refcount; no-op for other tags.
    #[inline]
    pub fn deref(&self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { (*self.value.wtf).deref() }
        }
    }
    /// `String.dupeRef()` — copy + ref.
    #[inline]
    pub fn dupe_ref(&self) -> Self {
        self.ref_();
        *self
    }

    #[inline]
    pub fn length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).length() as usize },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.len },
            Tag::Dead | Tag::Empty => 0,
        }
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.tag == Tag::Empty || self.length() == 0
    }
    pub fn is_utf16(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => unsafe { !(*self.value.wtf).is_8bit() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.is_16bit() },
            _ => false,
        }
    }
    pub fn is_utf8(&self) -> bool {
        matches!(self.tag, Tag::ZigString | Tag::StaticZigString)
            && unsafe { self.value.zig.is_utf8() }
    }
    pub fn is_8bit(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).is_8bit() },
            Tag::ZigString => unsafe { !self.value.zig.is_16bit() },
            _ => true,
        }
    }
    /// Raw byte view (Latin-1 or UTF-16 bytes — NOT necessarily UTF-8).
    pub fn byte_slice(&self) -> &[u8] {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.byte_slice() },
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).byte_slice() },
            _ => &[],
        }
    }
    /// Latin-1 byte view; debug-asserts `is_8bit()`.
    pub fn latin1(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).latin1_slice() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.slice() },
            _ => &[],
        }
    }
    pub fn utf16(&self) -> &[u16] {
        debug_assert!(self.is_utf16());
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).utf16_slice() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.utf16_slice() },
            _ => &[],
        }
    }
    pub fn ensure_hash(&self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { (*self.value.wtf).ensure_hash() }
        }
    }

    /// `String.toUTF8` — borrowed-or-owned UTF-8 byte slice.
    /// - `WTFStringImpl`: refs the impl (Latin-1, all-ASCII) or transcodes (Latin-1/UTF-16 → owned).
    /// - `ZigString`: borrows (UTF-8) or transcodes (UTF-16/non-ASCII Latin-1).
    /// - `StaticZigString`: borrows always.
    pub fn to_utf8(&self) -> ZigStringSlice {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_utf8() },
            Tag::ZigString => unsafe { self.value.zig.to_slice() },
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(unsafe { self.value.zig.slice() })
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    pub fn to_utf8_without_ref(&self) -> ZigStringSlice {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_utf8_without_ref() },
            Tag::ZigString => unsafe { self.value.zig.to_slice() },
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(unsafe { self.value.zig.slice() })
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    /// Returns `Some(utf8_bytes)` only if this is already valid UTF-8 with no
    /// transcoding needed (string.zig:571 `asUTF8`).
    pub fn as_utf8(&self) -> Option<&[u8]> {
        match self.tag {
            Tag::WTFStringImpl => unsafe {
                let w = &*self.value.wtf;
                if w.is_8bit() && strings::is_all_ascii(w.latin1_slice()) {
                    Some(w.latin1_slice())
                } else { None }
            },
            Tag::ZigString | Tag::StaticZigString => {
                // SAFETY: tag guarantees `value.zig` is the active variant.
                let z = unsafe { &self.value.zig };
                if z.is_16bit() { return None; }
                if z.is_utf8() { return Some(z.slice()); }
                if strings::is_all_ascii(z.slice()) { return Some(z.slice()); }
                None
            }
            _ => Some(b""),
        }
    }
    pub fn to_owned_slice(&self) -> Vec<u8> {
        self.to_utf8().into_vec()
    }

    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        // PORT NOTE: no `as_utf8()` fast-path here — for a 16-bit ZigString,
        // `as_utf8()` would call `slice()` (which debug-asserts !is_16bit) and
        // `is_all_ascii` on the wrong byte view. Match Zig's `eqlUTF8` and go
        // straight through encoding-aware `to_utf8_without_ref`.
        self.to_utf8_without_ref().slice() == other
    }
    pub fn eql_comptime(&self, lit: &'static [u8]) -> bool { self.eql_utf8(lit) }

    #[inline] pub fn is_dead(&self) -> bool { self.tag == Tag::Dead }

    /// `bun.String.static` (alt. spelling for callers that prefer `from_*`).
    #[inline]
    pub fn from_static(s: &'static [u8]) -> Self { Self::static_(s) }

    /// `bun.String.fromBytes` — borrow `value` without copying or refcounting;
    /// auto-tags UTF-8 if `value` contains any non-ASCII byte (string.zig:504).
    #[inline]
    pub fn from_bytes(value: &[u8]) -> Self {
        Self::init(ZigString::from_bytes(value))
    }

    /// `bun.String.clone` — produce an owned, WTF-backed copy of `self`.
    /// WTF-backed inputs just bump the refcount; ZigString inputs are copied
    /// into a fresh WTF::StringImpl (string.zig:244).
    pub fn clone(&self) -> Self {
        if self.tag == Tag::WTFStringImpl {
            return self.dupe_ref();
        }
        if self.is_empty() {
            return Self::EMPTY;
        }
        if self.is_utf16() {
            let len = self.length();
            let (new, ptr) = Self::create_uninitialized_utf16(len);
            if new.tag != Tag::Dead {
                // SAFETY: ptr points to `len` writable u16s; tag ≠ WTFStringImpl
                // is excluded above so `value.zig` is the active variant.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        self.value.zig.utf16_slice().as_ptr(),
                        ptr,
                        len,
                    );
                }
            }
            return new;
        }
        Self::clone_utf8(self.byte_slice())
    }

    /// `bun.String.toZigString` — borrow as a `ZigString` (no ref taken).
    pub fn to_zig_string(&self) -> ZigString {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig },
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_zig_string() },
            _ => ZigString::EMPTY,
        }
    }

    /// `bun.String.eql` — encoding-aware equality (string.zig:1014).
    pub fn eql(&self, other: &Self) -> bool {
        self.to_zig_string().eql(other.to_zig_string())
    }

    /// `bun.String.utf8ByteLength` — exact number of UTF-8 bytes needed to
    /// encode `self` (string.zig:292).
    pub fn utf8_byte_length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).utf8_byte_length() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.utf8_byte_length() },
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(&self) -> bun_core::ZBox {
        self.to_zig_string().to_owned_slice_z()
    }

    // `to_js` / `transfer_to_js` / `create_utf8_for_js` are tier-6 (jsc) — the
    // *_jsc alias pattern: deleted here per PORTING.md, defined as extension
    // trait in `bun_jsc`.
}
impl Default for String {
    #[inline] fn default() -> Self { Self::EMPTY }
}
// `String` is just a tag + raw ptr; thread-safety of the underlying WTF impl
// is gated by `to_thread_safe()` at the call site (matches Zig).
unsafe impl Send for String {}
unsafe impl Sync for String {}

impl core::fmt::Display for String {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = self.to_utf8_without_ref();
        f.write_str(unsafe { core::str::from_utf8_unchecked(s.slice()) })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `ZigString` — `{ ptr: *const u8, len: usize }` with flag bits in the
// POINTER's high bits (NOT len): bit 63 = is16Bit, 62 = isGloballyAllocated,
// 61 = isUTF8. `untagged()` truncates to 53 bits (matches ZigString.zig:629).
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ZigString {
    ptr: *const u8,
    pub len: usize,
}
const ZS_UTF8_BIT: usize = 1usize << 61;
const ZS_GLOBAL_BIT: usize = 1usize << 62;
const ZS_16BIT_BIT: usize = 1usize << 63;
const ZS_UNTAG_MASK: usize = (1usize << 53) - 1;

impl ZigString {
    pub const EMPTY: Self = Self { ptr: b"".as_ptr(), len: 0 };

    #[inline]
    pub const fn init(s: &[u8]) -> Self {
        Self { ptr: s.as_ptr(), len: s.len() }
    }
    /// `ZigString.initUTF8` — borrow UTF-8 bytes (sets the UTF-8 ptr-tag).
    #[inline]
    pub fn init_utf8(s: &[u8]) -> Self {
        let mut z = Self::init(s);
        z.mark_utf8();
        z
    }
    /// `ZigString.initUTF16` — borrow UTF-16 code units (sets the 16-bit ptr-tag).
    #[inline]
    pub fn init_utf16(s: &[u16]) -> Self {
        let mut z = Self { ptr: s.as_ptr().cast(), len: s.len() };
        z.mark_utf16();
        z
    }

    #[inline] pub fn is_utf8(self) -> bool { (self.ptr as usize & ZS_UTF8_BIT) != 0 }
    #[inline] pub fn is_16bit(self) -> bool { (self.ptr as usize & ZS_16BIT_BIT) != 0 }
    #[inline] pub fn is_globally_allocated(self) -> bool { (self.ptr as usize & ZS_GLOBAL_BIT) != 0 }
    #[inline] pub fn mark_utf8(&mut self) { self.ptr = (self.ptr as usize | ZS_UTF8_BIT) as *const u8; }
    #[inline] pub fn mark_utf16(&mut self) { self.ptr = (self.ptr as usize | ZS_16BIT_BIT) as *const u8; }
    #[inline] pub fn mark_global(&mut self) { self.ptr = (self.ptr as usize | ZS_GLOBAL_BIT) as *const u8; }

    /// `ZigString.fromBytes` — borrow `slice`; if it contains any non-ASCII
    /// byte, sets the UTF-8 ptr-tag (ZigString.zig:14).
    #[inline]
    pub fn from_bytes(slice: &[u8]) -> Self {
        if !strings::is_all_ascii(slice) {
            Self::init_utf8(slice)
        } else {
            Self::init(slice)
        }
    }

    /// `ZigString.static` — wraps a `'static` ASCII literal. Zig returned a
    /// `*const ZigString` to a comptime-interned holder; Rust callers consume
    /// the value directly (ZigString is `Copy`), so we return by value.
    #[inline]
    pub const fn static_(slice: &'static [u8]) -> Self {
        Self { ptr: slice.as_ptr(), len: slice.len() }
    }
    /// Alias of `static_` for callers that spell it `static_str`.
    #[inline]
    pub const fn static_str(slice: &'static [u8]) -> Self { Self::static_(slice) }

    /// `ZigString.utf8ByteLength` — exact UTF-8 byte length needed to encode
    /// this string (ZigString.zig:221). UTF-16 → simdutf length; Latin-1
    /// → simdutf utf8-from-latin1 length; UTF-8 → `len`.
    pub fn utf8_byte_length(self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return bun_core::strings::element_length_utf16_into_utf8(self.utf16_slice());
        }
        // Latin-1 path (ZigString.zig delegates to encoding.byteLengthU8(.utf8),
        // which is `simdutf.length.utf8.from.latin1` for the latin1 case).
        let s = self.slice();
        // SAFETY: s describes a valid byte slice.
        unsafe { bun_simdutf_sys::simdutf::simdutf__utf8_length_from_latin1(s.as_ptr(), s.len()) }
    }

    /// `ZigString.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(self) -> bun_core::ZBox {
        if self.is_utf8() {
            let mut v = self.slice().to_vec();
            v.push(0);
            return bun_core::ZBox::from_vec_with_nul(v);
        }
        let mut list = if self.is_16bit() {
            bun_core::strings::to_utf8_alloc(self.utf16_slice())
        } else {
            bun_core::strings::allocate_latin1_into_utf8_with_list(Vec::new(), 0, self.slice())
        };
        list.push(0);
        bun_core::ZBox::from_vec_with_nul(list)
    }

    /// `ZigString.eql` — encoding-aware equality (ZigString.zig).
    pub fn eql(self, other: Self) -> bool {
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
        // Mixed encoding — go through the UTF-8 view (matches Zig's slow path).
        self.to_slice().slice() == other.to_slice().slice()
    }

    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        // Zig: @truncate(u53, @intFromPtr(ptr)) — strips top 11 bits.
        (ptr as usize & ZS_UNTAG_MASK) as *const u8
    }

    /// 8-bit byte slice (asserts !is16Bit in debug — matches Zig `slice()`).
    pub fn slice(&self) -> &[u8] {
        debug_assert!(!self.is_16bit(), "ZigString::slice() on UTF-16 string; use to_slice()");
        if self.len == 0 { return &[]; }
        // Zig caps at u32::MAX (ZigString.zig:642).
        let len = self.len.min(u32::MAX as usize);
        // SAFETY: constructor stored a valid ptr/len; flag bits stripped.
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr), len) }
    }
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(self.is_16bit());
        if self.len == 0 { return &[]; }
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr).cast(), self.len) }
    }
    /// Raw bytes regardless of encoding (`len * 2` for UTF-16).
    pub fn byte_slice(&self) -> &[u8] {
        if self.len == 0 { return &[]; }
        let bytes = if self.is_16bit() { self.len * 2 } else { self.len };
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr), bytes) }
    }
    /// `ZigString.toSlice` — borrowed-or-owned UTF-8.
    pub fn to_slice(&self) -> ZigStringSlice {
        if self.len == 0 { return ZigStringSlice::EMPTY; }
        if self.is_16bit() {
            return ZigStringSlice::Owned(bun_core::strings::to_utf8_alloc(self.utf16_slice()));
        }
        let bytes = self.slice();
        if !self.is_utf8() {
            // Non-UTF-8 ZigString = Latin-1; transcode if any byte ≥ 0x80.
            if let Some(v) = bun_core::strings::to_utf8_from_latin1(bytes) {
                return ZigStringSlice::Owned(v);
            }
            // None ⇒ all-ASCII; safe to borrow as-is.
        }
        ZigStringSlice::Static(Self::untagged(self.ptr), self.len)
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
impl ZigStringSlice {
    /// Consume into an owned `Vec<u8>` — moves out the buffer if `Owned`,
    /// allocates a copy otherwise. WTF-backed slices deref the impl.
    pub fn into_vec(self) -> Vec<u8> {
        // Suppress Drop; we run the variant-specific cleanup ourselves.
        let mut this = core::mem::ManuallyDrop::new(self);
        match &mut *this {
            // SAFETY: `this` is ManuallyDrop so the Vec's destructor won't
            // double-run; we read it out exactly once and never use `this` again.
            Self::Owned(v) => unsafe { core::ptr::read(v) },
            Self::Static(p, l) if *l == 0 => Vec::new(),
            Self::Static(p, l) => unsafe { core::slice::from_raw_parts(*p, *l).to_vec() },
            Self::WTF { string_impl, ptr, len } => {
                let v = if *len == 0 {
                    Vec::new()
                } else {
                    // SAFETY: WTF ref held; latin1/utf8 bytes valid for `len`.
                    unsafe { core::slice::from_raw_parts(*ptr, *len).to_vec() }
                };
                // Paired with the ref taken by the constructor.
                unsafe { wtf::Bun__WTFStringImpl__deref(*string_impl) };
                v
            }
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

/// `bun_str::zig_string` — module path so callers can spell `ZigString.Slice`
/// as `zig_string::Slice` (matches the Zig namespace `ZigString.Slice`).
pub mod zig_string {
    pub use super::ZigString;
    pub use super::ZigStringSlice as Slice;
    impl super::ZigStringSlice {
        /// `ZigString.Slice.empty` — Rust idiom is `EMPTY`, but several
        /// dependents call `.empty()` (matching Zig's `.empty`).
        #[inline]
        pub const fn empty() -> Self { Self::Static(core::ptr::null(), 0) }
    }
}

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
