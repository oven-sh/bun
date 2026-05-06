//! Port of `src/string/immutable.zig` — `bun.strings` namespace.
//! SIMD-accelerated immutable string utilities operating on `&[u8]` (NOT `&str`).

use core::cmp::Ordering;
use core::ffi::c_int;

use bun_alloc::AllocError;
use bun_collections::BoundedArray;
use bun_core::Error;
use bun_highway as highway;
use bun_simdutf_sys::simdutf;

pub use self::unicode::{
    decode_wtf8_rune_t, decode_wtf8_rune_t_multibyte, wtf8_byte_sequence_length,
    wtf8_byte_sequence_length_with_invalid, CodepointIterator, Cursor, NewCodePointIterator,
    UnsignedCodepointIterator,
};

// Sub-modules (peer files under `src/string/immutable/`).
// B-2: heavy submodules gated; minimal inline `unicode` provides the 5 fns
// immutable.rs itself needs. Un-gate each below as their deps land.
#[path = "immutable/exact_size_matcher.rs"] pub mod exact_size_matcher;
// AsciiVector/AsciiU16Vector are scalar `ScalarVec` wrappers (see below) so
// the `if ENABLE_SIMD { .. }` branches type-check; `ENABLE_SIMD = false`
// keeps them dead at runtime. PERF(port): swap to bun_highway in Phase B.
#[path = "immutable/escapeHTML.rs"]         pub mod escape_html;
#[path = "immutable/grapheme.rs"] pub mod grapheme;
#[path = "immutable/grapheme_tables.rs"] pub mod grapheme_tables;
#[path = "immutable/paths.rs"]              pub mod paths;
#[path = "immutable/unicode.rs"]            mod unicode_draft;
#[path = "immutable/visible.rs"]            mod visible_impl;

// Transcoding helpers from `unicode_draft` that have no T0 `bun_core::strings`
// equivalent yet — re-export so downstream `bun_str::strings::*` callers (e.g.
// runtime/webcore/encoding.rs) resolve. These return `unicode_draft::EncodeIntoResult`,
// which is field-compatible with `bun_core::strings::EncodeIntoResult`.
pub use unicode_draft::{
    allocate_latin1_into_utf8, copy_latin1_into_ascii, copy_latin1_into_utf16,
    copy_latin1_into_utf8_stop_on_non_ascii, copy_u16_into_u8, copy_utf16_into_utf8_impl,
    element_length_utf8_into_utf16, BOM,
};

mod escape_reg_exp { pub use crate::escape_reg_exp::*; }

/// `bun.strings.visible` — terminal-visible-width helpers (East-Asian-width +
/// grapheme-aware; SIMD paths demoted to scalar `ScalarVec` for B-2).
pub use visible_impl::{
    is_amgiguous_codepoint_type, is_full_width_codepoint_type, is_zero_width_codepoint_type,
    visible, visible_codepoint_width, visible_codepoint_width_maybe_emoji,
    visible_codepoint_width_type,
};

/// PORT NOTE (B-2): minimal scalar fallback that predates `visible_impl` —
/// kept for diff parity with callers that imported `visible_fallback::*`.
/// New code should use [`visible`] (the real impl).
#[doc(hidden)]
pub mod visible_fallback {
    pub mod width {
        pub mod exclude_ansi_colors {
            use crate::immutable::{index_of_char_usize, wtf8_byte_sequence_length};

            /// Skip a CSI/OSC escape starting at `input[0] == ESC`; returns
            /// the byte length consumed (at least 1). Mirrors the parser in
            /// `visible.zig:visibleLatin1WidthExcludeANSIColors`.
            fn skip_ansi(input: &[u8]) -> usize {
                debug_assert!(!input.is_empty() && input[0] == 0x1b);
                if input.len() < 2 { return input.len(); }
                match input[1] {
                    b'[' => {
                        // CSI: ESC '[' ... <0x40..=0x7E>
                        let mut i = 2;
                        while i < input.len() {
                            if (0x40..=0x7E).contains(&input[i]) { return i + 1; }
                            i += 1;
                        }
                        input.len()
                    }
                    b']' => {
                        // OSC: ESC ']' ... (BEL | ST | ESC '\')
                        let mut i = 2;
                        while i < input.len() {
                            match input[i] {
                                0x07 | 0x9c => return i + 1,
                                0x1b if i + 1 < input.len() && input[i + 1] == b'\\' => return i + 2,
                                _ => i += 1,
                            }
                        }
                        input.len()
                    }
                    _ => 1,
                }
            }

            /// Visible terminal width of a UTF-8 string, treating ANSI escape
            /// sequences as zero-width.
            ///
            /// PORT NOTE (B-2): scalar fallback — counts 1 column per
            /// codepoint. Full East-Asian-width / grapheme handling is in the
            /// gated `visible_draft` module; un-gate to replace this.
            pub fn utf8(input: &[u8]) -> usize {
                let mut w = 0usize;
                let mut i = 0usize;
                while i < input.len() {
                    let b = input[i];
                    if b == 0x1b {
                        i += skip_ansi(&input[i..]);
                        continue;
                    }
                    if b < 0x80 {
                        // C0 controls are zero-width.
                        if b >= 0x20 && b != 0x7f { w += 1; }
                        i += 1;
                    } else {
                        let len = wtf8_byte_sequence_length(b).max(1) as usize;
                        w += 1;
                        i += len.min(input.len() - i);
                    }
                }
                w
            }

            /// Byte index of the longest prefix of `input` whose visible
            /// width is `<= max_width`. ANSI escapes are zero-width and
            /// always included; never splits a multi-byte UTF-8 codepoint.
            pub fn utf8_index_at_width(input: &[u8], max_width: usize) -> usize {
                let mut w = 0usize;
                let mut i = 0usize;
                while i < input.len() {
                    let b = input[i];
                    if b == 0x1b {
                        i += skip_ansi(&input[i..]);
                        continue;
                    }
                    let (cw, len) = if b < 0x80 {
                        (if b >= 0x20 && b != 0x7f { 1usize } else { 0 }, 1usize)
                    } else {
                        let l = wtf8_byte_sequence_length(b).max(1) as usize;
                        (1, l.min(input.len() - i))
                    };
                    if w + cw > max_width {
                        return i;
                    }
                    w += cw;
                    i += len;
                }
                input.len()
            }

            pub fn latin1(input: &[u8]) -> usize { utf8(input) }

            /// Visible terminal width of a UTF-16 string, treating ANSI
            /// escape sequences as zero-width.
            ///
            /// PORT NOTE (B-2): scalar fallback — counts 1 column per
            /// codepoint and ignores `ambiguous_as_wide`. Full
            /// East-Asian-width / grapheme handling lives in the gated
            /// `visible_draft` module; un-gate to replace this.
            pub fn utf16(input: &[u16], ambiguous_as_wide: bool) -> usize {
                let _ = ambiguous_as_wide;
                let mut w = 0usize;
                let mut i = 0usize;
                while i < input.len() {
                    let c = input[i];
                    if c == 0x1b {
                        // Re-use the byte-level ANSI parser by narrowing the
                        // ASCII run; CSI/OSC sequences are 7-bit clean.
                        let mut j = i;
                        let mut buf = [0u8; 64];
                        let take = (input.len() - i).min(buf.len());
                        for k in 0..take {
                            let u = input[i + k];
                            buf[k] = if u < 0x80 { u as u8 } else { 0xff };
                        }
                        j += skip_ansi(&buf[..take]);
                        i = j;
                        continue;
                    }
                    if c < 0x80 {
                        if c >= 0x20 && c != 0x7f { w += 1; }
                        i += 1;
                    } else if (0xD800..0xDC00).contains(&c)
                        && i + 1 < input.len()
                        && (0xDC00..0xE000).contains(&input[i + 1])
                    {
                        // Surrogate pair → one codepoint.
                        w += 1;
                        i += 2;
                    } else {
                        w += 1;
                        i += 1;
                    }
                }
                w
            }
        }
    }
}

/// Minimal `unicode` surface needed by `immutable.rs` itself (CodepointIterator
/// + WTF-8 decode). Full transcoding suite (to_utf8_*, convert_utf16_*) lives
/// in the gated `unicode_draft` module — un-gate after simdutf wiring.
pub mod unicode {
    use super::{CodePoint, U3Fast};

    #[inline]
    pub const fn wtf8_byte_sequence_length(first: u8) -> u8 {
        if first < 0x80 { 1 }
        else if (first & 0xE0) == 0xC0 { 2 }
        else if (first & 0xF0) == 0xE0 { 3 }
        else if (first & 0xF8) == 0xF0 { 4 }
        else { 1 }
    }
    /// Same table; the Zig version distinguished only by 0-on-invalid intent
    /// (which the body doesn't actually do — both return 1 for invalid).
    #[inline]
    pub const fn wtf8_byte_sequence_length_with_invalid(first: u8) -> u8 {
        wtf8_byte_sequence_length(first)
    }

    #[inline]
    pub fn decode_wtf8_rune_t_multibyte<T>(p: &[u8; 4], len: U3Fast, zero: T) -> T
    where T: Copy + From<u8> + core::ops::Shl<u32, Output = T> + core::ops::BitOr<Output = T> + PartialOrd,
    {
        debug_assert!(len > 1);
        let s1 = p[1];
        if (s1 & 0xC0) != 0x80 { return zero; }
        if len == 2 {
            let cp = (T::from(p[0] & 0x1F) << 6) | T::from(s1 & 0x3F);
            if cp < T::from(0x80) { return zero; }
            return cp;
        }
        let s2 = p[2];
        if (s2 & 0xC0) != 0x80 { return zero; }
        if len == 3 {
            let cp = (T::from(p[0] & 0x0F) << 12) | (T::from(s1 & 0x3F) << 6) | T::from(s2 & 0x3F);
            // 0x800 doesn't fit u8; compare via known-safe construction
            // (T is i32 or u32 in practice — see CodePointZero impls)
            if cp < ((T::from(0x08) << 8) | T::from(0)) { return zero; }
            return cp;
        }
        let s3 = p[3];
        if (s3 & 0xC0) != 0x80 { return zero; }
        let cp = (T::from(p[0] & 0x07) << 18)
            | (T::from(s1 & 0x3F) << 12)
            | (T::from(s2 & 0x3F) << 6)
            | T::from(s3 & 0x3F);
        // 0x10000..=0x10FFFF range check — only meaningful for i32/u32.
        // Construct bounds via shifts to stay within From<u8>.
        let lo = T::from(1) << 16;                    // 0x1_0000
        let hi = (T::from(0x10) << 16) | (T::from(0xFF) << 8) | T::from(0xFF); // 0x10_FFFF
        if cp < lo || cp > hi { return zero; }
        cp
    }

    #[inline]
    pub fn decode_wtf8_rune_t<T>(p: &[u8; 4], len: U3Fast, zero: T) -> T
    where T: Copy + From<u8> + core::ops::Shl<u32, Output = T> + core::ops::BitOr<Output = T> + PartialOrd,
    {
        if len == 0 { return zero; }
        if len == 1 { return T::from(p[0]); }
        decode_wtf8_rune_t_multibyte(p, len, zero)
    }

    /// `CodepointIterator` — yields WTF-8 codepoints with byte-width.
    pub struct NewCodePointIterator<'a> {
        pub bytes: &'a [u8],
        pub i: usize,
        pub width: u8,
        pub c: CodePoint,
    }
    pub type CodepointIterator<'a> = NewCodePointIterator<'a>;
    pub type UnsignedCodepointIterator<'a> = NewCodePointIterator<'a>;

    impl<'a> NewCodePointIterator<'a> {
        pub const ZERO_VALUE: CodePoint = -1;
        pub fn init(bytes: &'a [u8]) -> Self { Self { bytes, i: 0, width: 0, c: 0 } }
        pub fn init_offset(bytes: &'a [u8], i: usize) -> Self { Self { bytes, i, width: 0, c: 0 } }
        pub fn next_codepoint(&mut self) -> CodePoint {
            if self.i >= self.bytes.len() { return -1; }
            let len = wtf8_byte_sequence_length(self.bytes[self.i]);
            let mut buf = [0u8; 4];
            let avail = (self.bytes.len() - self.i).min(4);
            buf[..avail].copy_from_slice(&self.bytes[self.i..self.i + avail]);
            let cp = decode_wtf8_rune_t::<CodePoint>(&buf, len, -1);
            self.width = len;
            self.i += len as usize;
            self.c = cp;
            cp
        }
    }

    #[derive(Default, Clone, Copy)]
    pub struct Cursor { pub i: u32, pub width: u8, pub c: CodePoint }

    impl<'a> NewCodePointIterator<'a> {
        /// Zig-style cursor advance. Returns `false` at end.
        pub fn next(&self, cursor: &mut Cursor) -> bool {
            let pos = cursor.i as usize + cursor.width as usize;
            if pos >= self.bytes.len() { return false; }
            let len = wtf8_byte_sequence_length(self.bytes[pos]);
            let mut buf = [0u8; 4];
            let avail = (self.bytes.len() - pos).min(len as usize).min(4);
            buf[..avail].copy_from_slice(&self.bytes[pos..pos + avail]);
            let cp = decode_wtf8_rune_t::<CodePoint>(&buf, len, -1);
            cursor.i = pos as u32;
            if cp == -1 {
                cursor.c = super::UNICODE_REPLACEMENT as CodePoint;
                cursor.width = 1;
            } else {
                cursor.c = cp;
                cursor.width = len;
            }
            true
        }
    }

    /// `toUTF16Literal` — port of `unicode.zig:toUTF16Literal` →
    /// `std.unicode.utf8ToUtf16LeStringLiteral`. Zig evaluated this at
    /// `comptime` into a `Holder.value` const yielding `[:0]const u16`; the
    /// Rust runtime port returns an owned `Box<[u16]>` (no `Box::leak` per
    /// PORTING.md §Forbidden). Prefer the const `crate::w!("…")` macro at call
    /// sites with literal inputs — this fn exists for the residual runtime
    /// callers that thread `&[u8]` through.
    pub fn to_utf16_literal(s: &[u8]) -> Box<[u16]> {
        if s.is_empty() {
            return Box::new([]);
        }
        // `std.unicode.utf8ToUtf16LeStringLiteral` requires valid UTF-8 (Zig
        // would `catch unreachable` at comptime). simdutf gives us the exact
        // UTF-16 code-unit length, then a validating convert.
        let out_len = super::simdutf::length::utf16::from::utf8(s);
        let mut out = vec![0u16; out_len].into_boxed_slice();
        let written = super::simdutf::convert::utf8::to::utf16::le(s, &mut out);
        debug_assert_eq!(
            written, out_len,
            "to_utf16_literal: input must be valid UTF-8 (was comptime-checked in Zig)",
        );
        out
    }
}
/// Strip a leading UTF-8 BOM (`EF BB BF`) if present. Mirrors
/// `bun.strings.withoutUTF8BOM` (immutable.zig:2332 → unicode.withoutUTF8BOM).
#[inline]
pub fn without_utf8_bom(bytes: &[u8]) -> &[u8] {
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        &bytes[3..]
    } else {
        bytes
    }
}

// Transcoding suite re-exported from bun_core (T0).
pub use self::unicode::to_utf16_literal;
/// `bun.strings.w` — comptime UTF-8→UTF-16 literal. In Rust this **must** be a
/// macro (callers write `bun_string::strings::w!("…")`); a `fn` returning
/// `&'static [u16]` would require leaking. Re-export of the crate-root `w!`.
pub use crate::w;
pub use bun_core::strings::{
    EncodeIntoResult, copy_latin1_into_utf8, copy_utf16_into_utf8,
    element_length_latin1_into_utf8, element_length_utf16_into_utf8,
    to_utf8_alloc_z, to_utf8_from_latin1_z,
};

/// memmem — libc on posix, scalar fallback on windows.
#[cfg(not(windows))]
pub unsafe fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() { return Some(0); }
    let p = unsafe {
        libc::memmem(
            haystack.as_ptr().cast(), haystack.len(),
            needle.as_ptr().cast(), needle.len(),
        )
    };
    if p.is_null() { None } else { Some(p as usize - haystack.as_ptr() as usize) }
}
#[cfg(windows)]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    bstr::ByteSlice::find(haystack, needle)
}

/// `bun.reinterpretSlice` — `&[T]` → `&[u8]` view (T must be u8/u16 in practice).
#[inline]
fn reinterpret_to_u8<T: Copy>(s: &[T]) -> &[u8] {
    // SAFETY: u8 has align 1; reading any `T: Copy` as bytes is sound.
    unsafe { core::slice::from_raw_parts(s.as_ptr().cast(), core::mem::size_of_val(s)) }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Encoding {
    Ascii,
    Utf8,
    Latin1,
    Utf16,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum AsciiStatus {
    Unknown,
    AllAscii,
    NonAscii,
}

impl AsciiStatus {
    pub fn from_bool(is_all_ascii: Option<bool>) -> AsciiStatus {
        match is_all_ascii {
            None => AsciiStatus::Unknown,
            Some(true) => AsciiStatus::AllAscii,
            Some(false) => AsciiStatus::NonAscii,
        }
    }
}

/// Returned by classification functions that do not discriminate between utf8 and ascii.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EncodingNonAscii {
    Utf8,
    Utf16,
    Latin1,
}

#[inline]
pub fn contains_char(self_: &[u8], char: u8) -> bool {
    index_of_char(self_, char).is_some()
}

#[inline]
pub fn contains_char_t<T: Copy + Eq + Into<u32>>(self_: &[T], char: u8) -> bool {
    // TODO(port): Zig dispatched on T at comptime; in Rust we branch on size_of.
    if core::mem::size_of::<T>() == 1 {
        // SAFETY: T is u8-sized; reinterpret as &[u8].
        let bytes = unsafe { core::slice::from_raw_parts(self_.as_ptr() as *const u8, self_.len()) };
        contains_char(bytes, char)
    } else {
        self_.iter().any(|c| (*c).into() == char as u32)
    }
}

#[inline]
pub fn contains(self_: &[u8], str: &[u8]) -> bool {
    // Zig: containsT(u8) → indexOfT(u8) → indexOf, which routes through
    // std.mem.indexOf and returns None for empty needle. The generic
    // index_of_t below returns Some(0) for empty, so dispatch to the
    // u8-specific index_of (which matches Zig/std.mem semantics).
    index_of(self_, str).is_some()
}

#[inline]
pub fn contains_t<T: Eq>(self_: &[T], str: &[T]) -> bool {
    index_of_t(self_, str).is_some()
}

#[inline]
pub fn contains_case_insensitive_ascii(self_: &[u8], str: &[u8]) -> bool {
    let mut start: usize = 0;
    while start + str.len() <= self_.len() {
        if eql_case_insensitive_ascii_ignore_length(&self_[start..start + str.len()], str) {
            return true;
        }
        start += 1;
    }
    false
}

/// Zig: `std.meta.Int(.unsigned, @bitSizeOf(usize) - 1)` — fits in 63/31 bits so
/// `?OptionalUsize` is word-sized via niche. Rust `Option<u32>` already niches; keep
/// `u32` to match call sites that take `u32` indices throughout this module.
pub type OptionalUsize = u32;

pub fn index_of_any(slice: &[u8], str: &'static [u8]) -> Option<OptionalUsize> {
    match str.len() {
        0 => unreachable!("str cannot be empty"),
        1 => index_of_char(slice, str[0]),
        _ => highway::index_of_any_char(slice, str).map(|i| OptionalUsize::try_from(i).unwrap()),
    }
}

pub fn index_of_any16(self_: &[u16], str: &'static [u16]) -> Option<OptionalUsize> {
    index_of_any_t(self_, str)
}

pub fn index_of_any_t<T: Copy + Eq>(str: &[T], chars: &'static [T]) -> Option<OptionalUsize> {
    // TODO(port): Zig specialized T==u8 → index_of_any (highway). Rust cannot
    // dispatch on type identity without specialization; callers with u8 should
    // call index_of_any directly.
    for (i, c) in str.iter().enumerate() {
        // PERF(port): was `inline for` over chars — profile in Phase B
        for a in chars {
            if *c == *a {
                return Some(OptionalUsize::try_from(i).unwrap());
            }
        }
    }
    None
}

#[inline]
pub fn contains_comptime(self_: &[u8], str: &'static [u8]) -> bool {
    debug_assert!(!str.is_empty(), "Don't call this with an empty string plz.");

    let Some(start) = self_.iter().position(|&b| b == str[0]) else {
        return false;
    };
    let mut remain = &self_[start..];
    // PERF(port): Zig used a comptime-sized integer bitcast for the comparison.
    // Use slice equality; LLVM should emit equivalent code for small fixed lengths.
    while remain.len() >= str.len() {
        if &remain[..str.len()] == str {
            return true;
        }
        let Some(next_start) = remain[1..].iter().position(|&b| b == str[0]) else {
            return false;
        };
        remain = &remain[1 + next_start..];
    }
    false
}

pub use contains as includes;

pub fn in_map_case_insensitive<V: Copy>(
    self_: &[u8],
    map: &'static phf::Map<&'static [u8], V>,
) -> Option<V> {
    // Zig delegated to bun.String.ascii(self).inMapCaseInsensitive(map).
    // phf doesn't do case-insensitive natively; lowercase into a stack buffer.
    if self_.len() > 256 { return None; }
    let mut buf = [0u8; 256];
    for (i, &b) in self_.iter().enumerate() { buf[i] = b.to_ascii_lowercase(); }
    map.get(&buf[..self_.len()]).copied()
    // TODO(b2): bun.String.inMapCaseInsensitive uses ASCII-lowered key; verify
    // all phf maps in callers store lowercase keys.
}

#[inline]
pub fn contains_any(in_: &[&[u8]], target: &[u8]) -> bool {
    // TODO(port): Zig accepted `anytype` and handled both `[]const u8` and `u8` elements.
    for str in in_ {
        if contains(str, target) {
            return true;
        }
    }
    false
}

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json
/// - The name must be less than or equal to 214 characters. This includes the scope for scoped packages.
/// - The names of scoped packages can begin with a dot or an underscore. This is not permitted without a scope.
/// - New packages must not have uppercase letters in the name.
/// - The name ends up being part of a URL, an argument on the command line, and
///   a folder name. Therefore, the name can't contain any non-URL-safe
///   characters.
pub fn is_npm_package_name(target: &[u8]) -> bool {
    if target.len() > 214 {
        return false;
    }
    is_npm_package_name_ignore_length(target)
}

pub fn is_npm_package_name_ignore_length(target: &[u8]) -> bool {
    if target.is_empty() {
        return false;
    }

    let scoped = match target[0] {
        // Old packages may have capital letters
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'$' | b'-' => false,
        b'@' => true,
        _ => return false,
    };

    let mut slash_index: usize = 0;
    for (i, &c) in target[1..].iter().enumerate() {
        match c {
            // Old packages may have capital letters
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {}
            b'/' => {
                if !scoped {
                    return false;
                }
                if slash_index > 0 {
                    return false;
                }
                slash_index = i + 1;
            }
            // issue#7045, package "@~3/svelte_mount"
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent#description
            // It escapes all characters except: A–Z a–z 0–9 - _ . ! ~ * ' ( )
            b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => {
                if !scoped || slash_index > 0 {
                    return false;
                }
            }
            _ => return false,
        }
    }

    !scoped || (slash_index > 0 && slash_index + 1 < target.len())
}

pub fn is_uuid(str: &[u8]) -> bool {
    if str.len() != UUID_LEN {
        return false;
    }
    for i in 0..8 {
        match str[i] {
            b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => {}
            _ => return false,
        }
    }
    if str[8] != b'-' {
        return false;
    }
    for i in 9..13 {
        match str[i] {
            b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => {}
            _ => return false,
        }
    }
    if str[13] != b'-' {
        return false;
    }
    for i in 14..18 {
        match str[i] {
            b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => {}
            _ => return false,
        }
    }
    if str[18] != b'-' {
        return false;
    }
    for i in 19..23 {
        match str[i] {
            b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => {}
            _ => return false,
        }
    }
    if str[23] != b'-' {
        return false;
    }
    for i in 24..36 {
        match str[i] {
            b'0'..=b'9' | b'a'..=b'f' | b'A'..=b'F' => {}
            _ => return false,
        }
    }
    true
}

pub const UUID_LEN: usize = 36;

pub fn starts_with_uuid(str: &[u8]) -> bool {
    is_uuid(&str[0..str.len().min(UUID_LEN)])
}

/// https://github.com/npm/cli/blob/63d6a732c3c0e9c19fd4d147eaa5cc27c29b168d/node_modules/%40npmcli/redact/lib/matchers.js#L7
/// /\b(npms?_)[a-zA-Z0-9]{36,48}\b/gi
/// Returns the length of the secret if one exist.
pub fn starts_with_npm_secret(str: &[u8]) -> u8 {
    if str.len() < b"npm_".len() + 36 {
        return 0;
    }

    if !has_prefix_case_insensitive(str, b"npm") {
        return 0;
    }

    let mut i: u8 = b"npm".len() as u8;

    if str[i as usize] == b'_' {
        i += 1;
    } else if str[i as usize] == b's' || str[i as usize] == b'S' {
        i += 1;
        if str[i as usize] != b'_' {
            return 0;
        }
        i += 1;
    } else {
        return 0;
    }

    let min_len = i + 36;
    let max_len = i + 48;

    while i < max_len {
        if i as usize == str.len() {
            return if i >= min_len { i } else { 0 };
        }

        match str[i as usize] {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' => {}
            _ => return if i >= min_len { i } else { 0 },
        }
        i += 1;
    }

    i
}

fn starts_with_redacted_item(text: &[u8], item: &'static [u8]) -> Option<(usize, usize)> {
    if !has_prefix_comptime(text, item) {
        return None;
    }

    let mut whitespace = false;
    let mut offset: usize = item.len();
    while offset < text.len() && WHITESPACE_CHARS.contains(&text[offset]) {
        offset += 1;
        whitespace = true;
    }
    if offset == text.len() {
        return None;
    }
    // TODO(b0): lexer arrives from move-in (MOVE_DOWN bun_js_parser::lexer → string)
    let cont = crate::lexer::is_identifier_continue(text[offset] as u32);

    // must be another identifier
    if !whitespace && cont {
        return None;
    }

    // `null` is not returned after this point. Redact to the next
    // newline if anything is unexpected
    if cont {
        let rest = &text[offset..];
        return Some((offset, index_of_char(rest, b'\n').map_or(rest.len(), |i| i as usize)));
    }
    offset += 1;

    let mut end = offset;
    while end < text.len() && WHITESPACE_CHARS.contains(&text[end]) {
        end += 1;
    }

    if end == text.len() {
        return Some((offset, text[offset..].len()));
    }

    match text[end] {
        q @ (b'\'' | b'"' | b'`') => {
            // attempt to find closing
            let opening = end;
            end += 1;
            while end < text.len() {
                match text[end] {
                    b'\\' => {
                        // skip
                        end += 1;
                        end += 1;
                    }
                    c if c == q => {
                        // closing
                        return Some((opening + 1, (end - 1) - opening));
                    }
                    _ => {
                        end += 1;
                    }
                }
            }

            let rest = &text[offset..];
            let len = index_of_char(rest, b'\n').map_or(rest.len(), |i| i as usize);
            Some((offset, len))
        }
        _ => {
            let rest = &text[offset..];
            let len = index_of_char(rest, b'\n').map_or(rest.len(), |i| i as usize);
            Some((offset, len))
        }
    }
}

/// Returns offset and length of first secret found.
pub fn starts_with_secret(str: &[u8]) -> Option<(usize, usize)> {
    if let Some((offset, len)) = starts_with_redacted_item(str, b"_auth") {
        return Some((offset, len));
    }
    if let Some((offset, len)) = starts_with_redacted_item(str, b"_authToken") {
        return Some((offset, len));
    }
    if let Some((offset, len)) = starts_with_redacted_item(str, b"email") {
        return Some((offset, len));
    }
    if let Some((offset, len)) = starts_with_redacted_item(str, b"_password") {
        return Some((offset, len));
    }
    if let Some((offset, len)) = starts_with_redacted_item(str, b"token") {
        return Some((offset, len));
    }

    if starts_with_uuid(str) {
        return Some((0, 36));
    }

    let npm_secret_len = starts_with_npm_secret(str);
    if npm_secret_len > 0 {
        return Some((0, npm_secret_len as usize));
    }

    if let Some((offset, len)) = find_url_password(str) {
        return Some((offset, len));
    }

    None
}

pub fn find_url_password(text: &[u8]) -> Option<(usize, usize)> {
    if !has_prefix_comptime(text, b"http") {
        return None;
    }
    let mut offset: usize = b"http".len();
    if has_prefix_comptime(&text[offset..], b"://") {
        offset += b"://".len();
    } else if has_prefix_comptime(&text[offset..], b"s://") {
        offset += b"s://".len();
    } else {
        return None;
    }
    let mut remain = &text[offset..];
    let end = index_of_char(remain, b'\n').map_or(remain.len(), |i| i as usize);
    remain = &remain[0..end];
    let at = index_of_char(remain, b'@')? as usize;
    let colon = index_of_char_neg(&remain[0..at], b':');
    if colon == -1 || colon as usize == at - 1 {
        return None;
    }
    offset += usize::try_from(colon + 1).unwrap();
    let len: usize = at - usize::try_from(colon + 1).unwrap();
    Some((offset, len))
}

pub fn index_any_comptime(target: &[u8], chars: &'static [u8]) -> Option<usize> {
    for (i, &parent) in target.iter().enumerate() {
        // PERF(port): was `inline for` — profile in Phase B
        for &char in chars {
            if char == parent {
                return Some(i);
            }
        }
    }
    None
}

pub fn index_any_comptime_t<T: Copy + Eq>(target: &[T], chars: &'static [T]) -> Option<usize> {
    for (i, parent) in target.iter().enumerate() {
        // PERF(port): was `inline for` — profile in Phase B
        for char in chars {
            if *char == *parent {
                return Some(i);
            }
        }
    }
    None
}

pub fn index_equal_any(in_: &[&[u8]], target: &[u8]) -> Option<usize> {
    for (i, str) in in_.iter().enumerate() {
        if eql_long(str, target, true) {
            return Some(i);
        }
    }
    None
}

pub fn repeating_alloc(count: usize, char: u8) -> Result<Box<[u8]>, AllocError> {
    // PORT NOTE: allocator param dropped (global mimalloc).
    Ok(vec![char; count].into_boxed_slice())
}

pub fn repeating_buf(self_: &mut [u8], char: u8) {
    self_.fill(char);
}

pub fn index_of_char_neg(self_: &[u8], char: u8) -> i32 {
    for (i, &c) in self_.iter().enumerate() {
        if c == char {
            return i32::try_from(i).unwrap();
        }
    }
    -1
}

pub fn index_of_signed(self_: &[u8], str: &[u8]) -> i32 {
    // std.mem.indexOf returns 0 for an empty needle; bun's `index_of` returns
    // None. Match Zig semantics here (immutable.zig:412).
    if str.is_empty() {
        return 0;
    }
    match index_of(self_, str) {
        Some(i) => i32::try_from(i).unwrap(),
        None => -1,
    }
}

/// Returns last index of `char` before a character `before`.
pub fn last_index_before_char(in_: &[u8], char: u8, before: u8) -> Option<usize> {
    let before_pos = index_of_char(in_, before).map_or(in_.len(), |i| i as usize);
    last_index_of_char(&in_[0..before_pos], char)
}

#[inline]
pub fn last_index_of_char(self_: &[u8], char: u8) -> Option<usize> {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: memrchr scans within [self_.ptr, self_.ptr + self_.len).
        let start = unsafe { libc::memrchr(self_.as_ptr().cast(), char as c_int, self_.len()) };
        if start.is_null() { return None; }
        return Some(start as usize - self_.as_ptr() as usize);
    }
    #[cfg(not(target_os = "linux"))]
    {
        last_index_of_char_t(self_, char)
    }
}

#[inline]
pub fn last_index_of_char_t<T: Eq>(self_: &[T], char: T) -> Option<usize> {
    self_.iter().rposition(|c| *c == char)
}

#[inline]
pub fn last_index_of(self_: &[u8], str: &[u8]) -> Option<usize> {
    // TODO(port): std.mem.lastIndexOf — using bstr cold-path helper.
    bstr::ByteSlice::rfind(self_, str)
}

pub fn index_of(self_: &[u8], str: &[u8]) -> Option<usize> {
    let self_len = self_.len();
    let str_len = str.len();

    // > Both old and new libc's have the bug that if needle is empty,
    // > haystack-1 (instead of haystack) is returned. And glibc 2.0 makes it
    // > worse, returning a pointer to the last byte of haystack. This is fixed
    // > in glibc 2.1.
    if self_len == 0 || str_len == 0 || self_len < str_len {
        return None;
    }

    if str_len == 1 {
        return index_of_char_usize(self_, str[0]);
    }
    // SAFETY: lengths validated above; memmem reads within bounds.
    let i = unsafe { memmem(self_, str) }?;
    debug_assert!(i < self_len);
    Some(i)
}

pub fn index_of_t<T: Eq>(haystack: &[T], needle: &[T]) -> Option<usize> {
    // TODO(port): Zig specialized T==u8 → index_of (memmem). Callers with u8
    // should call index_of directly; generic path uses naive search.
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

pub fn split<'a>(self_: &'a [u8], delimiter: &'a [u8]) -> SplitIterator<'a> {
    SplitIterator { buffer: self_, index: Some(0), delimiter }
}

pub struct SplitIterator<'a> {
    pub buffer: &'a [u8],
    pub index: Option<usize>,
    pub delimiter: &'a [u8],
}

impl<'a> SplitIterator<'a> {
    /// Returns a slice of the first field. This never fails.
    /// Call this only to get the first field and then use `next` to get all subsequent fields.
    pub fn first(&mut self) -> &'a [u8] {
        debug_assert!(self.index.unwrap() == 0);
        self.next().unwrap()
    }

    /// Returns a slice of the next field, or null if splitting is complete.
    pub fn next(&mut self) -> Option<&'a [u8]> {
        let start = self.index?;
        let end = if let Some(delim_start) = index_of(&self.buffer[start..], self.delimiter) {
            let del = delim_start + start;
            self.index = Some(del + self.delimiter.len());
            delim_start + start
        } else {
            self.index = None;
            self.buffer.len()
        };

        Some(&self.buffer[start..end])
    }

    /// Returns a slice of the remaining bytes. Does not affect iterator state.
    pub fn rest(&self) -> &'a [u8] {
        let end = self.buffer.len();
        let start = self.index.unwrap_or(end);
        &self.buffer[start..end]
    }

    /// Resets the iterator to the initial slice.
    pub fn reset(&mut self) {
        self.index = Some(0);
    }
}

pub fn cat(first: &[u8], second: &[u8]) -> Result<Box<[u8]>, AllocError> {
    // PORT NOTE: allocator param dropped (global mimalloc).
    let mut out = Vec::with_capacity(first.len() + second.len());
    out.extend_from_slice(first);
    out.extend_from_slice(second);
    Ok(out.into_boxed_slice())
}

// 31 character string or a slice
#[repr(C)]
pub struct StringOrTinyString {
    remainder_buf: [u8; StringOrTinyString::MAX],
    meta: StringOrTinyStringMeta,
}

#[repr(transparent)]
#[derive(Copy, Clone, Default)]
struct StringOrTinyStringMeta(u8);

impl StringOrTinyStringMeta {
    #[inline]
    fn remainder_len(self) -> u8 {
        self.0 & 0x7f
    }
    #[inline]
    fn is_tiny_string(self) -> u8 {
        self.0 >> 7
    }
    #[inline]
    fn new(remainder_len: u8, is_tiny_string: u8) -> Self {
        Self((remainder_len & 0x7f) | (is_tiny_string << 7))
    }
}

const _: () = assert!(core::mem::size_of::<StringOrTinyString>() == 32);

impl StringOrTinyString {
    pub const MAX: usize = 31;

    #[inline]
    pub fn slice(&self) -> &[u8] {
        // This is a switch expression instead of a statement to make sure it uses the faster assembly
        match self.meta.is_tiny_string() {
            1 => &self.remainder_buf[0..self.meta.remainder_len() as usize],
            0 => {
                let ptr = usize::from_le_bytes(
                    self.remainder_buf[0..core::mem::size_of::<usize>()].try_into().unwrap(),
                ) as *const u8;
                let len = usize::from_le_bytes(
                    self.remainder_buf
                        [core::mem::size_of::<usize>()..core::mem::size_of::<usize>() * 2]
                        .try_into()
                        .unwrap(),
                );
                // SAFETY: ptr/len were stored from a live &[u8] in init(); caller keeps it alive.
                unsafe { core::slice::from_raw_parts(ptr, len) }
            }
            _ => unreachable!(),
        }
    }

    // PORT NOTE: Zig deinit was a no-op (commented-out free). No Drop impl.

    pub fn init_append_if_needed<A: Appender>(
        stringy: &[u8],
        appendy: &mut A,
    ) -> Result<StringOrTinyString, AllocError> {
        if stringy.len() <= StringOrTinyString::MAX {
            return Ok(StringOrTinyString::init(stringy));
        }
        Ok(StringOrTinyString::init(appendy.append(stringy)?))
    }

    pub fn init_lower_case_append_if_needed<A: Appender>(
        stringy: &[u8],
        appendy: &mut A,
    ) -> Result<StringOrTinyString, AllocError> {
        if stringy.len() <= StringOrTinyString::MAX {
            return Ok(StringOrTinyString::init_lower_case(stringy));
        }
        Ok(StringOrTinyString::init(appendy.append_lower_case(stringy)?))
    }

    pub fn init(stringy: &[u8]) -> StringOrTinyString {
        match stringy.len() {
            0 => StringOrTinyString {
                remainder_buf: [0; Self::MAX],
                meta: StringOrTinyStringMeta::new(0, 1),
            },
            1..=Self::MAX => {
                let mut tiny = StringOrTinyString {
                    remainder_buf: [0; Self::MAX],
                    meta: StringOrTinyStringMeta::new(stringy.len() as u8, 1),
                };
                let len = tiny.meta.remainder_len() as usize;
                tiny.remainder_buf[0..len].copy_from_slice(&stringy[0..len]);
                tiny
            }
            _ => {
                let mut tiny = StringOrTinyString {
                    remainder_buf: [0; Self::MAX],
                    meta: StringOrTinyStringMeta::new(0, 0),
                };
                tiny.remainder_buf[0..core::mem::size_of::<usize>()]
                    .copy_from_slice(&(stringy.as_ptr() as usize).to_le_bytes());
                tiny.remainder_buf[core::mem::size_of::<usize>()..core::mem::size_of::<usize>() * 2]
                    .copy_from_slice(&stringy.len().to_le_bytes());
                tiny
            }
        }
    }

    pub fn init_lower_case(stringy: &[u8]) -> StringOrTinyString {
        match stringy.len() {
            0 => StringOrTinyString {
                remainder_buf: [0; Self::MAX],
                meta: StringOrTinyStringMeta::new(0, 1),
            },
            1..=Self::MAX => {
                let mut tiny = StringOrTinyString {
                    remainder_buf: [0; Self::MAX],
                    meta: StringOrTinyStringMeta::new(stringy.len() as u8, 1),
                };
                let _ = copy_lowercase(stringy, &mut tiny.remainder_buf);
                tiny
            }
            _ => {
                let mut tiny = StringOrTinyString {
                    remainder_buf: [0; Self::MAX],
                    meta: StringOrTinyStringMeta::new(0, 0),
                };
                tiny.remainder_buf[0..core::mem::size_of::<usize>()]
                    .copy_from_slice(&(stringy.as_ptr() as usize).to_le_bytes());
                tiny.remainder_buf[core::mem::size_of::<usize>()..core::mem::size_of::<usize>() * 2]
                    .copy_from_slice(&stringy.len().to_le_bytes());
                tiny
            }
        }
    }
}

/// Trait for the `Appender` parameter on `StringOrTinyString::init*_append_if_needed`.
/// Zig used `comptime Appender: type` + duck-typed `.append`/`.appendLowerCase`.
pub trait Appender {
    fn append(&mut self, s: &[u8]) -> Result<&[u8], AllocError>;
    fn append_lower_case(&mut self, s: &[u8]) -> Result<&[u8], AllocError>;
}

pub fn copy_lowercase<'a>(in_: &[u8], out: &'a mut [u8]) -> &'a [u8] {
    let mut in_slice = in_;
    // PORT NOTE: reshaped for borrowck — track output offset instead of reslicing &mut.
    let mut out_off: usize = 0;

    'begin: loop {
        for (i, &c) in in_slice.iter().enumerate() {
            if let b'A'..=b'Z' = c {
                out[out_off..out_off + i].copy_from_slice(&in_slice[0..i]);
                out[out_off + i] = c.to_ascii_lowercase();
                let end = i + 1;
                in_slice = &in_slice[end..];
                out_off += end;
                continue 'begin;
            }
        }

        out[out_off..out_off + in_slice.len()].copy_from_slice(in_slice);
        break;
    }

    &out[0..in_.len()]
}

pub fn copy_lowercase_if_needed<'a>(in_: &'a [u8], out: &'a mut [u8]) -> &'a [u8] {
    let mut in_slice = in_;
    let mut out_off: usize = 0;
    let mut any = false;

    'begin: loop {
        for (i, &c) in in_slice.iter().enumerate() {
            if let b'A'..=b'Z' = c {
                out[out_off..out_off + i].copy_from_slice(&in_slice[0..i]);
                out[out_off + i] = c.to_ascii_lowercase();
                let end = i + 1;
                in_slice = &in_slice[end..];
                out_off += end;
                any = true;
                continue 'begin;
            }
        }

        if any {
            out[out_off..out_off + in_slice.len()].copy_from_slice(in_slice);
        }
        break;
    }

    if any { &out[0..in_.len()] } else { in_ }
}

/// Copy a string into a buffer
/// Return the copied version
pub fn copy<'a>(buf: &'a mut [u8], src: &[u8]) -> &'a [u8] {
    let len = buf.len().min(src.len());
    if len > 0 {
        buf[0..len].copy_from_slice(&src[0..len]);
    }
    &buf[0..len]
}

/// startsWith except it checks for non-empty strings
pub fn has_prefix(self_: &[u8], str: &[u8]) -> bool {
    !str.is_empty() && starts_with(self_, str)
}

pub fn starts_with(self_: &[u8], str: &[u8]) -> bool {
    if str.len() > self_.len() {
        return false;
    }
    eql_long(&self_[0..str.len()], str, false)
}

/// Transliterated from:
/// https://github.com/rust-lang/rust/blob/91376f416222a238227c84a848d168835ede2cc3/library/core/src/str/mod.rs#L188
pub fn is_on_char_boundary(self_: &[u8], idx: usize) -> bool {
    // 0 is always ok.
    // Test for 0 explicitly so that it can optimize out the check
    // easily and skip reading string data for that case.
    // Note that optimizing `self.get(..idx)` relies on this.
    if idx == 0 {
        return true;
    }

    // For `idx >= self.len` we have two options:
    //
    // - idx == self.len
    //   Empty strings are valid, so return true
    // - idx > self.len
    //   In this case return false
    //
    // The check is placed exactly here, because it improves generated
    // code on higher opt-levels. See PR #84751 for more details.
    if idx >= self_.len() {
        return idx == self_.len();
    }

    is_utf8_char_boundary(self_[idx])
}

pub fn is_utf8_char_boundary(c: u8) -> bool {
    // This is bit magic equivalent to: b < 128 || b >= 192
    (c as i8) >= -0x40
}

pub fn starts_with_case_insensitive_ascii(self_: &[u8], prefix: &[u8]) -> bool {
    self_.len() >= prefix.len() && eql_case_insensitive_ascii(&self_[0..prefix.len()], prefix, false)
}

pub fn starts_with_generic<T: Copy>(self_: &[T], str: &[T]) -> bool {
    if str.len() > self_.len() {
        return false;
    }
    eql_long(
        reinterpret_to_u8(&self_[0..str.len()]),
        reinterpret_to_u8(str),
        false,
    )
}

#[inline]
pub fn ends_with(self_: &[u8], str: &[u8]) -> bool {
    str.is_empty() || self_.ends_with(str)
}

#[inline]
pub fn ends_with_comptime(self_: &[u8], str: &'static [u8]) -> bool {
    self_.len() >= str.len() && eql_comptime_ignore_len(&self_[self_.len() - str.len()..], str)
}

#[inline]
pub fn starts_with_char(self_: &[u8], char: u8) -> bool {
    !self_.is_empty() && self_[0] == char
}

#[inline]
pub fn ends_with_char(self_: &[u8], char: u8) -> bool {
    !self_.is_empty() && self_[self_.len() - 1] == char
}

#[inline]
pub fn ends_with_char_or_is_zero_length(self_: &[u8], char: u8) -> bool {
    self_.is_empty() || self_[self_.len() - 1] == char
}

pub fn ends_with_any(self_: &[u8], str: &[u8]) -> bool {
    let end = self_[self_.len() - 1];
    for &char in str {
        if char == end {
            return true;
        }
    }
    false
}

pub fn quoted_alloc(self_: &[u8]) -> Result<Box<[u8]>, AllocError> {
    let mut count: usize = 0;
    for &char in self_ {
        count += (char == b'"') as usize;
    }

    if count == 0 {
        return Ok(Box::<[u8]>::from(self_));
    }

    let mut i: usize = 0;
    let mut out = vec![0u8; self_.len() + count].into_boxed_slice();
    for &char in self_ {
        if char == b'"' {
            out[i] = b'\\';
            i += 1;
        }
        out[i] = char;
        i += 1;
    }

    Ok(out)
}

pub fn eql_any_comptime(self_: &[u8], list: &'static [&'static [u8]]) -> bool {
    // PERF(port): was `inline for` — profile in Phase B
    for item in list {
        if eql_comptime_check_len_with_type::<u8, true>(self_, item) {
            return true;
        }
    }
    false
}

/// Count the occurrences of a character in an ASCII byte array
/// uses SIMD
pub fn count_char(self_: &[u8], char: u8) -> usize {
    // PERF(port): Zig used @Vector(16, u8) + @popCount + @reduce.
    // Phase A: scalar count; Phase B: portable_simd or highway intrinsic.
    let mut total: usize = 0;
    for &c in self_ {
        total += (c == char) as usize;
    }
    total
}

pub fn ends_with_any_comptime(self_: &[u8], str: &'static [u8]) -> bool {
    if str.len() < 10 {
        let last = self_[self_.len() - 1];
        // PERF(port): was `inline for` — profile in Phase B
        for &char in str {
            if char == last {
                return true;
            }
        }
        false
    } else {
        ends_with_any(self_, str)
    }
}

pub fn eql(self_: &[u8], other: &[u8]) -> bool {
    if self_.len() != other.len() {
        return false;
    }
    eql_long(self_, other, false)
}

pub fn eql_comptime_t<T: Copy + Eq>(self_: &[T], alt: &'static [u8]) -> bool {
    // TODO(port): Zig dispatched on T at comptime (u16 → eql_comptime_utf16).
    if core::mem::size_of::<T>() == 2 {
        // SAFETY: T is u16-sized; reinterpret as &[u16].
        let s16 = unsafe { core::slice::from_raw_parts(self_.as_ptr() as *const u16, self_.len()) };
        return eql_comptime_utf16(s16, alt);
    }
    // SAFETY: T is u8-sized in remaining branch.
    let s8 = unsafe { core::slice::from_raw_parts(self_.as_ptr() as *const u8, self_.len()) };
    eql_comptime(s8, alt)
}

pub fn eql_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    eql_comptime_check_len_with_type::<u8, true>(self_, alt)
}

pub fn eql_comptime_utf16(self_: &[u16], alt: &[u8]) -> bool {
    // Compare bytewise, widening each ASCII byte of `alt` on the fly — avoids
    // materializing (and leaking) a `&'static [u16]`. All call sites pass
    // ASCII literals (Zig was `comptime`).
    debug_assert!(alt.iter().all(|&b| b < 0x80));
    self_.len() == alt.len()
        && self_.iter().zip(alt.iter()).all(|(&u, &b)| u == b as u16)
}

pub fn eql_comptime_ignore_len(self_: &[u8], alt: &[u8]) -> bool {
    eql_comptime_check_len_with_type::<u8, false>(self_, alt)
}

pub fn has_prefix_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len() && eql_comptime_check_len_with_type::<u8, false>(&self_[0..alt.len()], alt)
}

pub fn has_prefix_comptime_utf16(self_: &[u16], alt: &'static [u8]) -> bool {
    debug_assert!(alt.iter().all(|&b| b < 0x80));
    self_.len() >= alt.len()
        && self_[..alt.len()].iter().zip(alt.iter()).all(|(&u, &b)| u == b as u16)
}

pub fn has_prefix_comptime_type<T: Copy + Eq>(self_: &[T], alt: &'static [T]) -> bool {
    // TODO(port): Zig accepted heterogeneous `alt: anytype` and widened u8→u16 via `w(alt)`.
    // Rust callers must pass the correctly-typed literal (use `crate::w!` for u16).
    self_.len() >= alt.len() && eql_comptime_check_len_with_type::<T, false>(&self_[0..alt.len()], alt)
}

pub fn has_suffix_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len()
        && eql_comptime_check_len_with_type::<u8, false>(&self_[self_.len() - alt.len()..], alt)
}

#[cfg(debug_assertions)]
fn eql_comptime_check_len_u8(a: &[u8], b: &[u8], check_len: bool) -> bool {
    eql_comptime_debug_runtime_fallback(a, b, check_len)
}
#[cfg(not(debug_assertions))]
fn eql_comptime_check_len_u8(a: &[u8], b: &'static [u8], check_len: bool) -> bool {
    eql_comptime_check_len_u8_impl(a, b, check_len)
}

fn eql_comptime_debug_runtime_fallback(a: &[u8], b: &[u8], check_len: bool) -> bool {
    if check_len { a == b } else { &a[0..b.len()] == b }
}

#[allow(dead_code)]
fn eql_comptime_check_len_u8_impl(a: &[u8], b: &'static [u8], check_len: bool) -> bool {
    // PERF(port): Zig unrolled at comptime over b.len in usize/u32/u16/u8 chunks.
    // Rust cannot iterate a runtime slice at const-eval. Slice equality compiles
    // to memcmp; for short literals LLVM should emit comparable code.
    if check_len {
        if a.len() != b.len() {
            return false;
        }
    }
    // SAFETY: when !check_len, callers guarantee a.len() >= b.len() (mirrors Zig contract).
    unsafe { a.get_unchecked(0..b.len()) == b }
}

fn eql_comptime_check_len_with_known_type<T: Copy + Eq, const CHECK_LEN: bool>(
    a: &[T],
    b: &[T],
) -> bool {
    if core::mem::size_of::<T>() != 1 {
        return eql_comptime_check_len_u8(
            reinterpret_to_u8(a),
            reinterpret_to_u8(b),
            CHECK_LEN,
        );
    }
    // SAFETY: T is u8-sized.
    let a8 = unsafe { core::slice::from_raw_parts(a.as_ptr() as *const u8, a.len()) };
    let b8 = unsafe { core::slice::from_raw_parts(b.as_ptr() as *const u8, b.len()) };
    eql_comptime_check_len_u8(a8, b8, CHECK_LEN)
}

/// Check if two strings are equal with one of the strings being a comptime-known value
///
///   strings.eql_comptime(input, b"hello world");
///   strings.eql_comptime(input, b"hai");
pub fn eql_comptime_check_len_with_type<T: Copy + Eq, const CHECK_LEN: bool>(
    a: &[T],
    b: &[T],
) -> bool {
    // PORT NOTE: Zig coerced array-by-value `b` to a pointer here. The Zig
    // version's `comptime` literal is unenforceable in Rust, so accept any
    // slice; callers are still expected to pass literals.
    eql_comptime_check_len_with_known_type::<T, CHECK_LEN>(a, b)
}

pub fn eql_case_insensitive_ascii_ignore_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii(a, b, false)
}

pub fn eql_case_insensitive_ascii_check_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii(a, b, true)
}

/// Preserves Zig's triple-`i` typo (`eqlCaseInsensitiveASCIIICheckLength`); both
/// spellings are reachable from ported call sites until the next typo sweep.
#[inline]
pub fn eql_case_insensitive_asciii_check_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii(a, b, true)
}

// PORT NOTE: Zig's `comptime check_len: bool` was first ported as a const
// generic, but the dominant call shape across the tree passes it as a runtime
// 3rd arg (`eql_case_insensitive_ascii(a, b, true)`). Accept it at runtime —
// the branch is trivially predicted/inlined; callers wanting the
// length-agnostic forms still have the `_check_length` / `_ignore_length`
// wrappers above.
#[inline]
pub fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], check_len: bool) -> bool {
    if check_len {
        if a.len() != b.len() {
            return false;
        }
        if a.is_empty() {
            return true;
        }
    }

    debug_assert!(!b.is_empty());
    debug_assert!(!a.is_empty());

    // SAFETY: a and b are non-empty; strncasecmp reads up to a.len() bytes from each.
    unsafe { libc::strncasecmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0 }
}

pub fn eql_case_insensitive_t<T: Copy + Into<u32>>(a: &[T], b: &[u8]) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    if core::mem::size_of::<T>() == 1 {
        // SAFETY: T is u8-sized.
        let a8 = unsafe { core::slice::from_raw_parts(a.as_ptr() as *const u8, a.len()) };
        return eql_case_insensitive_ascii_ignore_length(a8, b);
    }

    debug_assert_eq!(a.len(), b.len());
    for (c, &d) in a.iter().zip(b) {
        let c: u32 = (*c).into();
        let d = d as u32;
        if (b'a' as u32..=b'z' as u32).contains(&c) {
            if c != d && c & 0b1101_1111 != d { return false; }
        } else if (b'A' as u32..=b'Z' as u32).contains(&c) {
            if c != d && c | 0b0010_0000 != d { return false; }
        } else if c != d {
            return false;
        }
    }

    true
}

pub fn has_prefix_case_insensitive_t<T: Copy + Into<u32>>(str: &[T], prefix: &[u8]) -> bool {
    if str.len() < prefix.len() {
        return false;
    }
    eql_case_insensitive_t(&str[0..prefix.len()], prefix)
}

pub fn has_prefix_case_insensitive(str: &[u8], prefix: &[u8]) -> bool {
    has_prefix_case_insensitive_t(str, prefix)
}

pub fn eql_long_t<T: Copy, const CHECK_LEN: bool>(a_str: &[T], b_str: &[T]) -> bool {
    if CHECK_LEN {
        let len = b_str.len();
        if len == 0 {
            return a_str.is_empty();
        }
        if a_str.len() != len {
            return false;
        }
    }
    eql_long(
        reinterpret_to_u8(a_str),
        reinterpret_to_u8(b_str),
        false,
    )
}

// PORT NOTE: same rationale as `eql_case_insensitive_ascii` — Zig's
// `comptime check_len: bool` becomes a runtime 3rd arg to match the dominant
// ported call shape (`eql_long(a, b, true)`).
#[inline]
pub fn eql_long(a_str: &[u8], b_str: &[u8], check_len: bool) -> bool {
    let len = b_str.len();

    if check_len {
        if len == 0 {
            return a_str.is_empty();
        }
        if a_str.len() != len {
            return false;
        }
    } else if cfg!(debug_assertions) {
        debug_assert!(b_str.len() <= a_str.len());
    }

    // SAFETY: a_str.len() >= b_str.len() by contract above; raw-pointer walk
    // mirrors Zig's word-chunked compare exactly.
    unsafe {
        let end = b_str.as_ptr().add(len);
        let mut a = a_str.as_ptr();
        let mut b = b_str.as_ptr();

        if a == b {
            return true;
        }

        {
            let mut dword_length = len >> 3;
            while dword_length > 0 {
                if (a as *const usize).read_unaligned() != (b as *const usize).read_unaligned() {
                    return false;
                }
                b = b.add(core::mem::size_of::<usize>());
                if b == end {
                    return true;
                }
                a = a.add(core::mem::size_of::<usize>());
                dword_length -= 1;
            }
        }

        if core::mem::size_of::<usize>() == 8 {
            if (len & 4) != 0 {
                if (a as *const u32).read_unaligned() != (b as *const u32).read_unaligned() {
                    return false;
                }
                b = b.add(core::mem::size_of::<u32>());
                if b == end {
                    return true;
                }
                a = a.add(core::mem::size_of::<u32>());
            }
        }

        if (len & 2) != 0 {
            if (a as *const u16).read_unaligned() != (b as *const u16).read_unaligned() {
                return false;
            }
            b = b.add(core::mem::size_of::<u16>());
            if b == end {
                return true;
            }
            a = a.add(core::mem::size_of::<u16>());
        }

        if (len & 1) != 0 && *a != *b {
            return false;
        }

        true
    }
}

#[inline]
pub fn append(self_: &[u8], other: &[u8]) -> Result<Box<[u8]>, AllocError> {
    let mut buf = Vec::with_capacity(self_.len() + other.len());
    buf.extend_from_slice(self_);
    buf.extend_from_slice(other);
    Ok(buf.into_boxed_slice())
}

#[inline]
pub fn concat_alloc_t<T: Copy>(strs: &[&[T]]) -> Result<Box<[T]>, AllocError> {
    // PORT NOTE: Zig took `strs: anytype` (tuple) and inline-for'd. Slice-of-slices here.
    let len: usize = strs.iter().map(|s| s.len()).sum();
    let mut buf = Vec::with_capacity(len);
    for s in strs {
        buf.extend_from_slice(s);
    }
    Ok(buf.into_boxed_slice())
}

#[inline]
pub fn concat_buf_t<'a, T: Copy>(out: &'a mut [T], strs: &[&[T]]) -> Result<&'a mut [T], Error> {
    let mut off: usize = 0;
    for s in strs {
        if s.len() > out.len() - off {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        out[off..off + s.len()].copy_from_slice(s);
        off += s.len();
    }
    Ok(&mut out[0..off])
}

pub fn index(self_: &[u8], str: &[u8]) -> i32 {
    match index_of(self_, str) {
        Some(i) => i32::try_from(i).unwrap(),
        None => -1,
    }
}

/// Returns a substring starting at `start` up to the end of the string.
/// If `start` is greater than the string's length, returns an empty string.
pub fn substring(self_: &[u8], start: Option<usize>, stop: Option<usize>) -> &[u8] {
    let sta = start.unwrap_or(0);
    let sto = stop.unwrap_or(self_.len());
    &self_[sta.min(self_.len())..sto.min(self_.len())]
}

// PORT NOTE: AsciiVector / @Vector aliases — Zig SIMD types have no stable
// Rust equivalent. Exposed as thin scalar wrappers so dead-SIMD branches
// type-check; `ENABLE_SIMD = false` makes those branches unreachable at
// runtime. Hot loops use scalar fallbacks with `// PERF(port)` markers;
// Phase B routes through bun_highway/portable_simd.
pub const ENABLE_SIMD: bool = false;
pub const ASCII_VECTOR_SIZE: usize = 16;
pub const ASCII_U16_VECTOR_SIZE: usize = 8;

/// Scalar stand-in for Zig `@Vector(N, T)` — just enough surface
/// (`splat`/`from_slice`/`simd_eq`/`simd_gt`) for the `escape_html` SIMD
/// branches to type-check. Every method is a plain elementwise loop.
/// PERF(port): replace with `core::simd::Simd<T, N>` or `bun_highway` lanes.
#[derive(Clone, Copy)]
pub struct ScalarVec<T: Copy + Eq + Ord + Default, const N: usize>(pub [T; N]);

/// Lane mask returned by `simd_eq`/`simd_gt`. `BitOr` combines masks; `any()`
/// reduces to a single bool (Zig `@reduce(.Max, mask) == 1`).
#[derive(Clone, Copy)]
pub struct ScalarMask<const N: usize>(pub [bool; N]);

impl<T: Copy + Eq + Ord + Default, const N: usize> ScalarVec<T, N> {
    #[inline]
    pub fn splat(v: T) -> Self {
        Self([v; N])
    }
    #[inline]
    pub fn from_slice(s: &[T]) -> Self {
        let mut out = [T::default(); N];
        out.copy_from_slice(&s[..N]);
        Self(out)
    }
    #[inline]
    pub fn simd_eq(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N {
            m[i] = self.0[i] == other.0[i];
        }
        ScalarMask(m)
    }
    #[inline]
    pub fn simd_gt(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] > other.0[i]; }
        ScalarMask(m)
    }
    #[inline]
    pub fn simd_ge(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] >= other.0[i]; }
        ScalarMask(m)
    }
    #[inline]
    pub fn simd_lt(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] < other.0[i]; }
        ScalarMask(m)
    }
    #[inline]
    pub fn simd_le(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] <= other.0[i]; }
        ScalarMask(m)
    }
    #[inline]
    pub fn simd_ne(self, other: Self) -> ScalarMask<N> {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] != other.0[i]; }
        ScalarMask(m)
    }
}
impl<const N: usize> core::ops::BitOr for ScalarMask<N> {
    type Output = Self;
    #[inline]
    fn bitor(self, rhs: Self) -> Self {
        let mut m = [false; N];
        for i in 0..N {
            m[i] = self.0[i] | rhs.0[i];
        }
        Self(m)
    }
}
impl<const N: usize> core::ops::BitAnd for ScalarMask<N> {
    type Output = Self;
    #[inline]
    fn bitand(self, rhs: Self) -> Self {
        let mut m = [false; N];
        for i in 0..N { m[i] = self.0[i] & rhs.0[i]; }
        Self(m)
    }
}
impl<const N: usize> core::ops::BitOrAssign for ScalarMask<N> {
    #[inline]
    fn bitor_assign(&mut self, rhs: Self) {
        for i in 0..N { self.0[i] |= rhs.0[i]; }
    }
}
impl<const N: usize> ScalarMask<N> {
    #[inline]
    pub fn any(self) -> bool {
        self.0.iter().any(|&b| b)
    }
    /// Packs lane truth into the low N bits of a u64 (LSB = lane 0). Mirrors
    /// `core::simd::Mask::to_bitmask` so `popcount`/`trailing_zeros` work.
    #[inline]
    pub fn to_bitmask(self) -> u64 {
        debug_assert!(N <= 64);
        let mut bits: u64 = 0;
        for i in 0..N {
            bits |= (self.0[i] as u64) << i;
        }
        bits
    }
}

pub type AsciiVector = ScalarVec<u8, ASCII_VECTOR_SIZE>;
pub type AsciiU16Vector = ScalarVec<u16, ASCII_U16_VECTOR_SIZE>;

/// `strings.utf16Codepoint` — surrogate-pair length + decoded code point.
/// Minimal version for `escape_html` (only `.len` is used there); the full
/// FFFD-replacing variant lives in the gated `unicode_draft`.
#[derive(Clone, Copy)]
pub struct Utf16CodepointLen {
    pub code_point: u32,
    pub len: u8,
}
#[inline]
pub fn utf16_codepoint(input: &[u16]) -> Utf16CodepointLen {
    let c0 = input[0] as u32;
    if c0 & !0x03ff == 0xd800 {
        // high surrogate
        if input.len() < 2 {
            return Utf16CodepointLen { code_point: c0, len: 1 };
        }
        let c1 = input[1] as u32;
        if c1 & !0x03ff != 0xdc00 {
            // PORT NOTE: Zig (unicode.zig:1378) falls THROUGH the dead
            // `if (input.len == 1)` and returns `len = 2` here. The sole
            // caller (escape_html) advances by `.len`; preserve len=2 to
            // match Zig's iteration behaviour.
            return Utf16CodepointLen { code_point: c0, len: 2 };
        }
        Utf16CodepointLen {
            code_point: 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)),
            len: 2,
        }
    } else {
        Utf16CodepointLen { code_point: c0, len: 1 }
    }
}

/// `strings.UTF16Replacement` — decoded UTF-16 codepoint with surrogate
/// metadata. Used by `visible_utf16_width_fn` and the (gated) `unicode_draft`
/// transcoding suite.
#[derive(Clone, Copy)]
pub struct UTF16Replacement {
    pub code_point: u32,
    pub len: U3Fast,
    /// Explicit fail boolean to distinguish a Unicode Replacement Codepoint
    /// that was already in the input from a genuine decode error.
    pub fail: bool,
    pub can_buffer: bool,
    pub is_lead: bool,
}
impl Default for UTF16Replacement {
    fn default() -> Self {
        Self { code_point: UNICODE_REPLACEMENT, len: 0, fail: false, can_buffer: true, is_lead: false }
    }
}
impl UTF16Replacement {
    #[inline]
    pub fn utf8_width(self) -> U3Fast {
        match self.code_point {
            0..=0x7F => 1,
            0x80..=0x7FF => 2,
            0x800..=0xFFFF => 3,
            _ => 4,
        }
    }
}

/// `strings.utf16CodepointWithFFFD` — surrogate-pair decode that reports
/// failure (`fail`/`is_lead`) instead of silently passing the lead through
/// (unicode.zig:1378 vs. `utf16_codepoint`).
pub fn utf16_codepoint_with_fffd(input: &[u16]) -> UTF16Replacement {
    let c0 = input[0] as u32;
    if c0 & !0x03ff == 0xd800 {
        // surrogate pair
        if input.len() == 1 {
            return UTF16Replacement { len: 1, is_lead: true, ..Default::default() };
        }
        let c1 = input[1] as u32;
        if c1 & !0x03ff != 0xdc00 {
            // PORT NOTE: unicode.zig has a dead `if input.len() == 1` here
            // (already excluded above); preserved fail+is_lead branch only.
            return UTF16Replacement {
                fail: true,
                len: 1,
                code_point: UNICODE_REPLACEMENT,
                is_lead: true,
                ..Default::default()
            };
        }
        UTF16Replacement {
            len: 2,
            code_point: 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)),
            ..Default::default()
        }
    } else if c0 & !0x03ff == 0xdc00 {
        UTF16Replacement { fail: true, len: 1, code_point: UNICODE_REPLACEMENT, ..Default::default() }
    } else {
        UTF16Replacement { code_point: c0, len: 1, ..Default::default() }
    }
}

/// `w!("foo")` → `&'static [u16]` UTF-16 literal (ASCII-only). Zig's `bun.w`.
#[macro_export]
macro_rules! w {
    ($s:literal) => {{
        const __B: &[u8] = $s.as_bytes();
        const __N: usize = __B.len();
        const __W: [u16; __N] = {
            let mut out = [0u16; __N];
            let mut i = 0;
            while i < __N {
                debug_assert!(__B[i] < 0x80, "w! is ASCII-only");
                out[i] = __B[i] as u16;
                i += 1;
            }
            out
        };
        &__W as &'static [u16]
    }};
}

pub fn first_non_ascii(slice: &[u8]) -> Option<u32> {
    let result = simdutf::validate::with_errors::ascii(slice);
    if result.status == simdutf::Status::SUCCESS {
        return None;
    }
    Some(result.count as u32)
}

/// `bun.strings.isValidUTF8` — SIMD-validated UTF-8 check (immutable.zig).
/// Wraps `simdutf::validate::utf8`; the gated `unicode_draft` adds a
/// `bun.FeatureFlags.use_simdutf` toggle + scalar fallback.
#[inline]
pub fn is_valid_utf8(slice: &[u8]) -> bool {
    simdutf::validate::utf8(slice)
}

pub use index_of_newline_or_non_ascii as index_of_newline_or_non_ascii_or_ansi;

/// Checks if slice[offset..] has any < 0x20 or > 127 characters
pub fn index_of_newline_or_non_ascii(slice_: &[u8], offset: u32) -> Option<u32> {
    index_of_newline_or_non_ascii_check_start::<true>(slice_, offset)
}

pub fn index_of_space_or_newline_or_non_ascii(slice_: &[u8], offset: u32) -> Option<u32> {
    let slice = &slice_[offset as usize..];
    let remaining = slice;

    if remaining.is_empty() {
        return None;
    }

    if remaining[0] > 127 || (remaining[0] < 0x20 && remaining[0] != 0x09) {
        return Some(offset);
    }

    let i = highway::index_of_space_or_newline_or_non_ascii(remaining)?;
    Some((i as u32) + offset)
}

pub fn index_of_newline_or_non_ascii_check_start<const CHECK_START: bool>(
    slice_: &[u8],
    offset: u32,
) -> Option<u32> {
    let slice = &slice_[offset as usize..];
    let remaining = slice;

    if remaining.is_empty() {
        return None;
    }

    if CHECK_START {
        // this shows up in profiling
        if remaining[0] > 127 || (remaining[0] < 0x20 && remaining[0] != 0x09) {
            return Some(offset);
        }
    }

    let i = highway::index_of_newline_or_non_ascii(remaining)?;
    Some((i as u32) + offset)
}

pub fn contains_newline_or_non_ascii_or_quote(text: &[u8]) -> bool {
    highway::contains_newline_or_non_ascii_or_quote(text)
}

/// Supports:
/// - `"`
/// - `'`
/// - "`"
pub fn index_of_needs_escape_for_java_script_string(slice: &[u8], quote_char: u8) -> Option<u32> {
    if slice.is_empty() {
        return None;
    }
    highway::index_of_needs_escape_for_javascript_string(slice, quote_char)
}

pub fn index_of_needs_url_encode(slice: &[u8]) -> Option<u32> {
    if slice.is_empty() {
        return None;
    }

    #[inline(always)]
    fn needs(c: u8) -> bool {
        c >= 127
            || c < 0x20
            || c == b'%'
            || c == b'\\'
            || c == b'"'
            || c == b'#'
            || c == b'?'
            || c == b'['
            || c == b']'
            || c == b'^'
            || c == b'|'
            || c == b'~'
    }

    if needs(slice[0]) {
        return Some(0);
    }

    // PERF(port): Zig used @Vector(16,u8) compare + @ctz on bitmask. Scalar loop
    // here; Phase B: portable_simd or a highway entry point.
    for (i, &char) in slice.iter().enumerate() {
        if char > 127
            || char < 0x20
            || char == b'\\'
            || char == b'%'
            || char == b'"'
            || char == b'#'
            || char == b'?'
            || char == b'['
            || char == b']'
            || char == b'^'
            || char == b'|'
            || char == b'~'
        {
            return Some(i as u32);
        }
    }

    None
}

pub fn index_of_char_z(slice_z: &crate::ZStr, char: u8) -> Option<u64> {
    // Zig returned ?u63; use u64 in Rust (no u63).
    highway::index_of_char(slice_z.as_bytes(), char).map(|i| i as u64)
}

pub fn index_of_char(slice: &[u8], char: u8) -> Option<u32> {
    index_of_char_usize(slice, char).map(|i| i as u32)
}

pub fn index_of_char_usize(slice: &[u8], char: u8) -> Option<usize> {
    highway::index_of_char(slice, char)
}

pub fn index_of_char_pos(slice: &[u8], char: u8, start_index: usize) -> Option<usize> {
    if start_index >= slice.len() {
        return None;
    }
    let result = highway::index_of_char(&slice[start_index..], char)?;
    debug_assert!(slice.len() > result + start_index);
    Some(result + start_index)
}

pub fn index_of_any_pos_comptime(
    slice: &[u8],
    chars: &'static [u8],
    start_index: usize,
) -> Option<usize> {
    if chars.len() == 1 {
        return index_of_char_pos(slice, chars[0], start_index);
    }
    if start_index >= slice.len() {
        return None;
    }
    slice[start_index..]
        .iter()
        .position(|b| chars.contains(b))
        .map(|i| i + start_index)
}

pub fn index_of_char16_usize(slice: &[u16], char: u16) -> Option<usize> {
    slice.iter().position(|&c| c == char)
}

pub fn index_of_not_char(slice: &[u8], char: u8) -> Option<u32> {
    if slice.is_empty() {
        return None;
    }

    if slice[0] != char {
        return Some(0);
    }

    // PERF(port): Zig used @Vector(16,u8) != splat + @ctz. Scalar loop here.
    for (i, &current) in slice.iter().enumerate() {
        if current != char {
            return Some(i as u32);
        }
    }

    None
}

const INVALID_CHAR: u8 = 0xff;
const HEX_TABLE: [u8; 256] = {
    let mut values: [u8; 256] = [INVALID_CHAR; 256];
    values[b'0' as usize] = 0;
    values[b'1' as usize] = 1;
    values[b'2' as usize] = 2;
    values[b'3' as usize] = 3;
    values[b'4' as usize] = 4;
    values[b'5' as usize] = 5;
    values[b'6' as usize] = 6;
    values[b'7' as usize] = 7;
    values[b'8' as usize] = 8;
    values[b'9' as usize] = 9;
    values[b'A' as usize] = 10;
    values[b'B' as usize] = 11;
    values[b'C' as usize] = 12;
    values[b'D' as usize] = 13;
    values[b'E' as usize] = 14;
    values[b'F' as usize] = 15;
    values[b'a' as usize] = 10;
    values[b'b' as usize] = 11;
    values[b'c' as usize] = 12;
    values[b'd' as usize] = 13;
    values[b'e' as usize] = 14;
    values[b'f' as usize] = 15;
    values
};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum DecodeHexError {
    #[error("InvalidByteSequence")]
    InvalidByteSequence,
}

pub fn decode_hex_to_bytes<Char: Copy + Into<u32>>(
    destination: &mut [u8],
    source: &[Char],
) -> Result<usize, DecodeHexError> {
    _decode_hex_to_bytes::<Char, false>(destination, source)
}

pub fn decode_hex_to_bytes_truncate<Char: Copy + Into<u32>>(
    destination: &mut [u8],
    source: &[Char],
) -> usize {
    _decode_hex_to_bytes::<Char, true>(destination, source).unwrap_or(0)
}

#[inline]
fn _decode_hex_to_bytes<Char: Copy + Into<u32>, const TRUNCATE: bool>(
    destination: &mut [u8],
    source: &[Char],
) -> Result<usize, DecodeHexError> {
    let dest_len = destination.len();
    let mut remain = &mut destination[..];
    let mut input = source;

    while !remain.is_empty() && input.len() > 1 {
        let int0: u32 = input[0].into();
        let int1: u32 = input[1].into();
        if core::mem::size_of::<Char>() > 1 {
            if int0 > u8::MAX as u32 || int1 > u8::MAX as u32 {
                if TRUNCATE {
                    break;
                }
                return Err(DecodeHexError::InvalidByteSequence);
            }
        }
        let a = HEX_TABLE[(int0 as u8) as usize];
        let b = HEX_TABLE[(int1 as u8) as usize];
        if a == INVALID_CHAR || b == INVALID_CHAR {
            if TRUNCATE {
                break;
            }
            return Err(DecodeHexError::InvalidByteSequence);
        }
        remain[0] = (a << 4) | b;
        remain = &mut remain[1..];
        input = &input[2..];
    }

    if !TRUNCATE {
        if !remain.is_empty() && !input.is_empty() {
            return Err(DecodeHexError::InvalidByteSequence);
        }
    }

    Ok(dest_len - remain.len())
}

fn byte2hex(char: u8) -> u8 {
    match char {
        0..=9 => char + b'0',
        10..=15 => char - 10 + b'a',
        _ => unreachable!(),
    }
}

pub fn encode_bytes_to_hex(destination: &mut [u8], source: &[u8]) -> usize {
    if cfg!(debug_assertions) {
        debug_assert!(!destination.is_empty());
        debug_assert!(!source.is_empty());
    }
    let to_write = if destination.len() < source.len() * 2 {
        destination.len() - destination.len() % 2
    } else {
        source.len() * 2
    };

    let to_read = to_write / 2;

    let remaining = &source[0..to_read];
    let mut remaining_dest = &mut destination[..];
    // PERF(port): Zig had a @Vector(16,u8) interlace fast path. Scalar loop here;
    // Phase B: portable_simd shuffle or LUT.
    for &c in remaining {
        const CHARSET: &[u8; 16] = b"0123456789abcdef";
        remaining_dest[0] = CHARSET[(c >> 4) as usize];
        remaining_dest[1] = CHARSET[(c & 15) as usize];
        remaining_dest = &mut remaining_dest[2..];
    }

    to_read * 2
}

/// Leave a single leading char
/// ```
/// trim_subsequent_leading_chars("foo\n\n\n\n", '\n') -> "foo\n"
/// ```
pub fn trim_subsequent_leading_chars(slice: &[u8], char: u8) -> &[u8] {
    if slice.is_empty() {
        return slice;
    }
    let mut end = slice.len() - 1;
    let mut endend = slice.len();
    while end > 0 && slice[end] == char {
        endend = end + 1;
        end -= 1;
    }
    &slice[0..endend]
}

pub fn trim_leading_char(slice: &[u8], char: u8) -> &[u8] {
    if let Some(i) = index_of_not_char(slice, char) {
        return &slice[i as usize..];
    }
    b""
}

/// Trim leading pattern of 2 bytes
///
/// e.g.
/// `trim_leading_pattern2("abcdef", 'a', 'b') == "cdef"`
pub fn trim_leading_pattern2(slice_: &[u8], byte1: u8, byte2: u8) -> &[u8] {
    let mut slice = slice_;
    while slice.len() >= 2 {
        if slice[0] == byte1 && slice[1] == byte2 {
            slice = &slice[2..];
        } else {
            break;
        }
    }
    slice
}

/// prefix is of type &[u8] or &[u16]
pub fn trim_prefix_comptime<'a, T: Copy + Eq>(buffer: &'a [T], prefix: &'static [T]) -> &'a [T] {
    if has_prefix_comptime_type(buffer, prefix) {
        &buffer[prefix.len()..]
    } else {
        buffer
    }
}

pub fn trim_suffix_comptime<'a>(buffer: &'a [u8], suffix: &'static [u8]) -> &'a [u8] {
    if has_suffix_comptime(buffer, suffix) {
        &buffer[0..buffer.len() - suffix.len()]
    } else {
        buffer
    }
}

/// Non-comptime variants — runtime prefix/suffix may borrow from a non-static
/// buffer (`hosted_git_info`, `npm-pack-args` parsers).
#[inline]
pub fn trim_prefix<'a>(buffer: &'a [u8], prefix: &[u8]) -> &'a [u8] {
    if buffer.len() >= prefix.len() && &buffer[..prefix.len()] == prefix {
        &buffer[prefix.len()..]
    } else {
        buffer
    }
}

#[inline]
pub fn trim_suffix<'a>(buffer: &'a [u8], suffix: &[u8]) -> &'a [u8] {
    if buffer.len() >= suffix.len() && &buffer[buffer.len() - suffix.len()..] == suffix {
        &buffer[..buffer.len() - suffix.len()]
    } else {
        buffer
    }
}

/// Get the line number and the byte offsets of `line_range_count` above the desired line number
/// The final element is the end index of the desired line
#[derive(Copy, Clone, Default)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

pub fn index_of_line_ranges<const LINE_RANGE_COUNT: usize>(
    text: &[u8],
    target_line: u32,
) -> BoundedArray<LineRange, LINE_RANGE_COUNT> {
    if text.is_empty() {
        return BoundedArray::default();
    }

    let mut ranges = BoundedArray::<LineRange, LINE_RANGE_COUNT>::default();

    let mut current_line: u32 = 0;
    let Some(first_newline_or_nonascii_i) =
        index_of_newline_or_non_ascii_check_start::<true>(text, 0)
    else {
        if target_line == 0 {
            // PERF(port): was assume_capacity
            ranges.push(LineRange { start: 0, end: text.len() as u32 });
        }
        return ranges;
    };

    let mut iter = CodepointIterator::init_offset(text, 0);
    let mut cursor = unicode::Cursor { i: first_newline_or_nonascii_i, ..Default::default() };
    const NL: i32 = b'\n' as i32;
    const CR: i32 = b'\r' as i32;
    let first_newline_range: LineRange = 'brk: {
        while iter.next(&mut cursor) {
            match cursor.c {
                NL => {
                    current_line += 1;
                    break 'brk LineRange { start: 0, end: cursor.i };
                }
                CR => {
                    if iter.next(&mut cursor) && cursor.c == NL {
                        current_line += 1;
                        break 'brk LineRange { start: 0, end: cursor.i };
                    }
                }
                _ => {}
            }
        }
        let _ = ranges.push(LineRange { start: 0, end: text.len() as u32 });
        return ranges;
    };

    ranges.push(first_newline_range);

    if target_line == 0 {
        return ranges;
    }

    let mut prev_end = first_newline_range.end;
    while let Some(current_i) =
        index_of_newline_or_non_ascii_check_start::<true>(text, cursor.i + cursor.width as u32)
    {
        cursor.i = current_i;
        cursor.width = 0;
        let advanced = iter.next(&mut cursor);
        debug_assert!(advanced);
        let current_line_range: LineRange = match cursor.c {
            NL => {
                let start = prev_end;
                prev_end = cursor.i;
                LineRange { start, end: cursor.i + 1 }
            }
            CR => {
                let current_end = cursor.i;
                if iter.next(&mut cursor) && cursor.c == NL {
                    let r = LineRange { start: prev_end, end: current_end };
                    prev_end = cursor.i; // Zig: `defer prev_end = cursor.i;`
                    r
                } else {
                    LineRange { start: prev_end, end: cursor.i + 1 }
                }
            }
            _ => continue,
        };

        if ranges.len() == LINE_RANGE_COUNT && current_line <= target_line {
            let mut new_ranges = BoundedArray::<LineRange, LINE_RANGE_COUNT>::default();
            new_ranges.extend_from_slice(&ranges.as_slice()[1..]);
            ranges = new_ranges;
        }
        ranges.push(current_line_range);

        if current_line >= target_line {
            return ranges;
        }

        current_line += 1;
    }

    if ranges.len() == LINE_RANGE_COUNT && current_line <= target_line {
        let mut new_ranges = BoundedArray::<LineRange, LINE_RANGE_COUNT>::default();
        new_ranges.extend_from_slice(&ranges.as_slice()[1..]);
        ranges = new_ranges;
    }

    ranges
}

/// Get N lines from the start of the text
pub fn get_lines_in_text<const LINE_RANGE_COUNT: usize>(
    text: &[u8],
    line: u32,
) -> Option<BoundedArray<&[u8], LINE_RANGE_COUNT>> {
    let ranges = index_of_line_ranges::<LINE_RANGE_COUNT>(text, line);
    if ranges.len() == 0 {
        return None;
    }
    let mut results = BoundedArray::<&[u8], LINE_RANGE_COUNT>::default();
    for range in ranges.as_slice() {
        results.push(&text[range.start as usize..range.end as usize]);
    }
    results.as_mut_slice().reverse();
    Some(results)
}

pub fn first_non_ascii16(slice: &[u16]) -> Option<u32> {
    // PERF(port): Zig used @Vector(8,u16) max-reduce + @ctz on bitmask. Scalar
    // loop here; Phase B: portable_simd or simdutf utf16 validator.
    for (i, &char) in slice.iter().enumerate() {
        if char > 127 {
            return Some(i as u32);
        }
    }
    None
}

// this is std.mem.trim except it doesn't forcibly change the slice to be const
pub fn trim<'a>(slice: &'a [u8], values_to_strip: &'static [u8]) -> &'a [u8] {
    let mut begin: usize = 0;
    let mut end: usize = slice.len();

    while begin < end && values_to_strip.contains(&slice[begin]) {
        begin += 1;
    }
    while end > begin && values_to_strip.contains(&slice[end - 1]) {
        end -= 1;
    }
    &slice[begin..end]
}

pub fn trim_spaces(slice: &[u8]) -> &[u8] {
    trim(slice, &WHITESPACE_CHARS)
}

pub fn is_all_whitespace(slice: &[u8]) -> bool {
    let mut begin: usize = 0;
    while begin < slice.len() && WHITESPACE_CHARS.contains(&slice[begin]) {
        begin += 1;
    }
    begin == slice.len()
}

pub const WHITESPACE_CHARS: [u8; 6] = [b' ', b'\t', b'\n', b'\r', 0x0B /* VT */, 0x0C /* FF */];

pub fn length_of_leading_whitespace_ascii(slice: &[u8]) -> usize {
    'brk: for (i, &c) in slice.iter().enumerate() {
        for &wc in &WHITESPACE_CHARS {
            if c == wc {
                continue 'brk;
            }
        }
        return i;
    }
    slice.len()
}

pub fn join(slices: &[&[u8]], delimiter: &[u8]) -> Result<Box<[u8]>, AllocError> {
    // PORT NOTE: std.mem.join — reimplemented over Vec<u8> (no allocator param).
    if slices.is_empty() {
        return Ok(Box::default());
    }
    let total: usize =
        slices.iter().map(|s| s.len()).sum::<usize>() + delimiter.len() * (slices.len() - 1);
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(slices[0]);
    for s in &slices[1..] {
        out.extend_from_slice(delimiter);
        out.extend_from_slice(s);
    }
    Ok(out.into_boxed_slice())
}

pub fn order(a: &[u8], b: &[u8]) -> Ordering {
    let len = a.len().min(b.len());
    // SAFETY: both pointers valid for `len` bytes.
    let cmp = unsafe { libc::memcmp(a.as_ptr().cast(), b.as_ptr().cast(), len) };
    match cmp.signum() {
        0 => a.len().cmp(&b.len()),
        1 => Ordering::Greater,
        -1 => Ordering::Less,
        _ => unreachable!(),
    }
}

pub fn cmp_strings_asc(_: &(), a: &[u8], b: &[u8]) -> bool {
    order(a, b) == Ordering::Less
}

pub fn cmp_strings_desc(_: &(), a: &[u8], b: &[u8]) -> bool {
    order(a, b) == Ordering::Greater
}

/// Every time you read a non^2 sized integer, Zig masks off the extra bits.
/// This is a meaningful performance difference, including in release builds.
pub type U3Fast = u8;

pub fn sort_asc(in_: &mut [&[u8]]) {
    // TODO: experiment with simd to see if it's faster
    in_.sort_unstable_by(|a, b| order(a, b));
}

pub fn sort_desc(in_: &mut [&[u8]]) {
    // TODO: experiment with simd to see if it's faster
    in_.sort_unstable_by(|a, b| order(b, a));
}

pub struct StringArrayByIndexSorter<'a> {
    pub keys: &'a [&'a [u8]],
}

impl<'a> StringArrayByIndexSorter<'a> {
    pub fn less_than(&self, a: usize, b: usize) -> bool {
        order(self.keys[a], self.keys[b]) == Ordering::Less
    }

    pub fn init(keys: &'a [&'a [u8]]) -> Self {
        Self { keys }
    }
}

pub fn is_ascii_hex_digit(c: u8) -> bool {
    c.is_ascii_hexdigit()
}

pub fn to_ascii_hex_value(character: u8) -> u8 {
    if cfg!(debug_assertions) {
        debug_assert!(is_ascii_hex_digit(character));
    }
    match character {
        0..=b'@' => character - b'0',
        _ => (character - b'A' + 10) & 0xF,
    }
}

/// Zig: `fn NewLengthSorter(comptime Type, comptime field) type`.
/// Rust cannot take a field name as a const param; use an accessor fn.
pub struct LengthSorter<T, F: Fn(&T) -> &[u8]>(pub F, core::marker::PhantomData<T>);
impl<T, F: Fn(&T) -> &[u8]> LengthSorter<T, F> {
    pub fn less_than(&self, lhs: &T, rhs: &T) -> bool {
        (self.0)(lhs).len() < (self.0)(rhs).len()
    }
}

pub struct GlobLengthSorter<T, F: Fn(&T) -> &[u8]>(pub F, core::marker::PhantomData<T>);
impl<T, F: Fn(&T) -> &[u8]> GlobLengthSorter<T, F> {
    pub fn less_than(&self, lhs: &T, rhs: &T) -> bool {
        // Assert: keyA ends with "/" or contains only a single "*".
        // Assert: keyB ends with "/" or contains only a single "*".
        let key_a = (self.0)(lhs);
        let key_b = (self.0)(rhs);

        // Let baseLengthA be the index of "*" in keyA plus one, if keyA contains "*", or the length of keyA otherwise.
        // Let baseLengthB be the index of "*" in keyB plus one, if keyB contains "*", or the length of keyB otherwise.
        let star_a = index_of_char(key_a, b'*');
        let star_b = index_of_char(key_b, b'*');
        let base_length_a = star_a.map_or(key_a.len(), |i| i as usize);
        let base_length_b = star_b.map_or(key_b.len(), |i| i as usize);

        // If baseLengthA is greater than baseLengthB, return -1.
        // If baseLengthB is greater than baseLengthA, return 1.
        if base_length_a > base_length_b {
            return true;
        }
        if base_length_b > base_length_a {
            return false;
        }

        // If keyA does not contain "*", return 1.
        // If keyB does not contain "*", return -1.
        if star_a.is_none() {
            return false;
        }
        if star_b.is_none() {
            return true;
        }

        // If the length of keyA is greater than the length of keyB, return -1.
        // If the length of keyB is greater than the length of keyA, return 1.
        if key_a.len() > key_b.len() {
            return true;
        }
        if key_b.len() > key_a.len() {
            return false;
        }

        false
    }
}

/// Reflection adapter for [`move_all_slices`]. Zig's `moveAllSlices` used
/// `std.meta.fields(Type)` to enumerate every `[]const u8` field at comptime;
/// Rust has no field reflection, so each container type hand-implements this
/// trait (or, once landed, `#[derive(MoveSlices)]`) to yield the same set of
/// fields as `&mut &'a [u8]` so they can be re-pointed into a new backing
/// buffer of lifetime `'a` without any unsafe.
pub trait MoveSlices<'a> {
    /// Invoke `f` once per byte-slice field of `self`.
    fn for_each_byte_slice_field(&mut self, f: &mut dyn FnMut(&mut &'a [u8]));
}

/// Update all `&[u8]` fields in `container` that currently point into `from`
/// to instead point at the same offset within `to`. Port of
/// `immutable.zig:moveAllSlices`.
pub fn move_all_slices<'a, T: MoveSlices<'a> + ?Sized>(
    container: &mut T,
    from: &[u8],
    to: &'a [u8],
) {
    let from_start = from.as_ptr() as usize;
    let from_end = from_start + from.len();
    container.for_each_byte_slice_field(&mut |field| {
        let slice_start = field.as_ptr() as usize;
        let slice_end = slice_start + field.len();
        // `if (@intFromPtr(from.ptr) + from.len) >= @intFromPtr(slice.ptr) + slice.len
        //   and (@intFromPtr(from.ptr) <= @intFromPtr(slice.ptr))`
        if from_end >= slice_end && from_start <= slice_start {
            *field = move_slice(field, from, to);
        }
    });
}

pub fn move_slice<'a>(slice: &[u8], from: &[u8], to: &'a [u8]) -> &'a [u8] {
    if cfg!(debug_assertions) {
        debug_assert!(from.len() <= to.len() && from.len() >= slice.len());
        // assert we are in bounds
        debug_assert!(
            (from.as_ptr() as usize + from.len()) >= slice.as_ptr() as usize + slice.len()
                && (from.as_ptr() as usize <= slice.as_ptr() as usize)
        );
        debug_assert!(eql_long(from, &to[0..from.len()], false)); // data should be identical
    }

    let ptr_offset = slice.as_ptr() as usize - from.as_ptr() as usize;
    let result = &to[ptr_offset..][0..slice.len()];

    if cfg!(debug_assertions) {
        debug_assert!(eql_long(slice, result, false)); // data should be identical
    }

    result
}

pub use exact_size_matcher::ExactSizeMatcher;

pub const UNICODE_REPLACEMENT: u32 = 0xFFFD;
// UTF-8 encoding of U+FFFD
pub const UNICODE_REPLACEMENT_STR: [u8; 3] = [0xEF, 0xBF, 0xBD];

// inet_pton via direct libc extern (libc crate doesn't expose it on all targets).
unsafe extern "C" {
    fn inet_pton(af: c_int, src: *const u8, dst: *mut u8) -> c_int;
}
const AF_INET: c_int = 2;
#[cfg(target_os = "linux")]  const AF_INET6: c_int = 10;
#[cfg(target_os = "macos")]  const AF_INET6: c_int = 30;
#[cfg(windows)]              const AF_INET6: c_int = 23;
#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
const AF_INET6: c_int = 10;

pub fn is_ip_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() { return false; }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
    unsafe {
        inet_pton(AF_INET, buf.as_ptr(), dst.as_mut_ptr()) > 0
            || inet_pton(AF_INET6, buf.as_ptr(), dst.as_mut_ptr()) > 0
    }
}

pub fn is_ipv6_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() { return false; }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
    unsafe { inet_pton(AF_INET6, buf.as_ptr(), dst.as_mut_ptr()) > 0 }
}

pub fn left_has_any_in_right(to_check: &[&[u8]], against: &[&[u8]]) -> bool {
    for check in to_check {
        for item in against {
            if eql_long(check, item, true) {
                return true;
            }
        }
    }
    false
}

/// Returns true if the input has the prefix and the next character is not an identifier character
/// Also returns true if the input ends with the prefix (i.e. EOF)
///
/// Example:
/// ```text
/// has_prefix_with_word_boundary("console.log", "console") // true
/// has_prefix_with_word_boundary("console.log", "log") // false
/// has_prefix_with_word_boundary("console.log", "console.log") // true
/// ```
pub fn has_prefix_with_word_boundary(input: &[u8], prefix: &'static [u8]) -> bool {
    if has_prefix_comptime(input, prefix) {
        if input.len() == prefix.len() {
            return true;
        }

        let next = &input[prefix.len()..];
        let bytes: [u8; 4] = [
            next[0],
            if next.len() > 1 { next[1] } else { 0 },
            if next.len() > 2 { next[2] } else { 0 },
            if next.len() > 3 { next[3] } else { 0 },
        ];

        let cp = decode_wtf8_rune_t::<i32>(&bytes, wtf8_byte_sequence_length(next[0]), -1);
        if cp < 0 || !crate::lexer::is_identifier_continue(cp as u32) {
            return true;
        }
    }

    false
}

pub fn concat_with_length(args: &[&[u8]], length: usize) -> Result<Box<[u8]>, AllocError> {
    let mut out = vec![0u8; length].into_boxed_slice();
    let mut off: usize = 0;
    for arg in args {
        out[off..off + arg.len()].copy_from_slice(arg);
        off += arg.len();
    }
    debug_assert!(off == length); // all bytes should be used
    Ok(out)
}

pub fn concat(args: &[&[u8]]) -> Result<Box<[u8]>, AllocError> {
    let mut length: usize = 0;
    for arg in args {
        length += arg.len();
    }
    concat_with_length(args, length)
}

pub fn concat_if_needed(
    dest: &mut Box<[u8]>,
    args: &[&[u8]],
    interned_strings_to_check: &[&'static [u8]],
) -> Result<(), AllocError> {
    let total_length: usize = {
        let mut length: usize = 0;
        for arg in args {
            length += arg.len();
        }
        length
    };

    if total_length == 0 {
        *dest = Box::default();
        return Ok(());
    }

    if total_length < 1024 {
        // PERF(port): was stack-fallback allocator. Use a fixed stack buffer.
        let mut stack_buf = [0u8; 1024];
        let mut off: usize = 0;
        for arg in args {
            stack_buf[off..off + arg.len()].copy_from_slice(arg);
            off += arg.len();
        }
        let stack_copy = &stack_buf[0..total_length];
        for &interned in interned_strings_to_check {
            if eql_long(stack_copy, interned, true) {
                // PERF(port): Zig stored the interned slice directly; with an
                // owned `Box<[u8]>` dest we copy once. Hit at most once per
                // JSX config; no leak.
                *dest = Box::from(interned);
                return Ok(());
            }
        }
    }

    let is_needed = 'brk: {
        let mut remain: &[u8] = dest;

        for arg in args {
            // PORT NOTE: Zig has `args.len` here (likely a bug); preserved verbatim.
            if args.len() > remain.len() {
                break 'brk true;
            }

            if eql_long(&remain[0..args.len()], arg, true) {
                remain = &remain[args.len()..];
            } else {
                break 'brk true;
            }
        }

        false
    };

    if !is_needed {
        return Ok(());
    }

    *dest = concat_with_length(args, total_length)?;
    Ok(())
}

pub fn must_escape_yaml_string(contents: &[u8]) -> bool {
    if contents.is_empty() {
        return true;
    }

    match contents[0] {
        b'A'..=b'Z' | b'a'..=b'z' => {
            has_prefix_comptime(contents, b"Yes")
                || has_prefix_comptime(contents, b"No")
                || has_prefix_comptime(contents, b"true")
                || has_prefix_comptime(contents, b"false")
                || contents[1..]
                    .iter()
                    .any(|b| b": \t\r\n\x0B\x0C\\\",[]".contains(b))
        }
        _ => true,
    }
}

#[derive(Copy, Clone)]
pub struct QuoteEscapeFormatFlags {
    pub quote_char: u8,
    pub ascii_only: bool,
    pub json: bool,
    pub str_encoding: Encoding,
}

impl Default for QuoteEscapeFormatFlags {
    fn default() -> Self {
        Self { quote_char: b'"', ascii_only: false, json: false, str_encoding: Encoding::Utf8 }
    }
}

/// usage: print(" string: '{}' ", format_escapes_js("hello'world!"));
// PERF(port): was comptime monomorphization (Zig `comptime flags: QuoteEscapeFormatFlags`) — profile in Phase B
pub fn format_escapes(str: &[u8], flags: QuoteEscapeFormatFlags) -> QuoteEscapeFormat<'_> {
    QuoteEscapeFormat { data: str, flags }
}

pub struct QuoteEscapeFormat<'a> {
    pub data: &'a [u8],
    pub flags: QuoteEscapeFormatFlags,
}

impl core::fmt::Display for QuoteEscapeFormat<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PERF(port): Zig wrote directly to the writer; here we buffer through
        // a Vec so `write_pre_quoted_string`'s `PrinterWriter` bound is met
        // without an adapter for `core::fmt::Formatter`. Profile in Phase B.
        let mut buf: Vec<u8> = Vec::with_capacity(self.data.len() + 8);
        crate::printer::write_pre_quoted_string(
            self.data,
            &mut buf,
            self.flags.quote_char,
            // Zig (immutable.zig:2159) hardcodes `false` here regardless of
            // `flags.ascii_only`; the field is dead in QuoteEscapeFormat.
            false,
            self.flags.json,
            self.flags.str_encoding,
        )
        .map_err(|_| core::fmt::Error)?;
        // SAFETY: write_pre_quoted_string emits UTF-8 (escapes + ASCII + WTF-8).
        f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })
    }
}

/// Generic. Works on &[u8], &[u16], etc
#[inline]
pub fn index_of_scalar<T: Copy + Eq>(input: &[T], scalar: T) -> Option<usize> {
    // TODO(port): Zig specialized T==u8 → index_of_char_usize (highway).
    if core::mem::size_of::<T>() == 1 {
        // SAFETY: T is u8-sized.
        let bytes = unsafe { core::slice::from_raw_parts(input.as_ptr() as *const u8, input.len()) };
        let scalar_u8 = unsafe { *(&scalar as *const T as *const u8) };
        return index_of_char_usize(bytes, scalar_u8);
    }
    input.iter().position(|c| *c == scalar)
}

/// Generic. Works on &[u8], &[u16], etc
pub fn contains_scalar<T: Copy + Eq>(input: &[T], item: T) -> bool {
    index_of_scalar(input, item).is_some()
}

pub fn without_suffix_comptime<'a>(input: &'a [u8], suffix: &'static [u8]) -> &'a [u8] {
    if has_suffix_comptime(input, suffix) {
        return &input[0..input.len() - suffix.len()];
    }
    input
}

pub fn without_prefix_comptime<'a>(input: &'a [u8], prefix: &'static [u8]) -> &'a [u8] {
    if has_prefix_comptime(input, prefix) {
        return &input[prefix.len()..];
    }
    input
}

pub fn without_prefix_comptime_z<'a>(input: &'a crate::ZStr, prefix: &'static [u8]) -> &'a crate::ZStr {
    if has_prefix_comptime(input.as_bytes(), prefix) {
        // SAFETY: trailing NUL is preserved past the new start.
        return unsafe { crate::ZStr::from_raw(input.as_ptr().add(prefix.len()).cast(), input.len() - prefix.len()) };
    }
    input
}

pub fn without_prefix_if_possible_comptime<'a>(input: &'a [u8], prefix: &'static [u8]) -> Option<&'a [u8]> {
    if has_prefix_comptime(input, prefix) {
        return Some(&input[prefix.len()..]);
    }
    None
}

pub struct SplitFirst<'a> {
    pub first: u8,
    pub rest: &'a [u8],
}

/// Returns the first byte of the string and the rest of the string excluding the first byte
pub fn split_first(self_: &[u8]) -> Option<SplitFirst<'_>> {
    if self_.is_empty() {
        return None;
    }
    let first = self_[0];
    Some(SplitFirst { first, rest: &self_[1..] })
}

/// Returns the first byte of the string which matches the expected byte and the rest of the string excluding the first byte
pub fn split_first_with_expected(self_: &[u8], expected: u8) -> Option<&[u8]> {
    if !self_.is_empty() && self_[0] == expected {
        return Some(&self_[1..]);
    }
    None
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PercentEncodeError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("IncompleteUTF8")]
    IncompleteUTF8,
}

pub fn percent_encode_write(
    utf8_input: &[u8],
    writer: &mut Vec<u8>,
) -> Result<(), PercentEncodeError> {
    let mut remaining = utf8_input;
    while let Some(j) = index_of_needs_url_encode(remaining) {
        let j = j as usize;
        let safe = &remaining[0..j];
        remaining = &remaining[j..];
        let code_point_len: usize = wtf8_byte_sequence_length_with_invalid(remaining[0]) as usize;
        if remaining.len() < code_point_len {
            #[cold]
            fn cold() {}
            cold();
            return Err(PercentEncodeError::IncompleteUTF8);
        }

        let to_encode = &remaining[0..code_point_len];
        remaining = &remaining[code_point_len..];

        writer.reserve(safe.len() + b"%FF".len() * code_point_len);

        // Write the safe bytes
        // PERF(port): was assume_capacity
        writer.extend_from_slice(safe);

        // URL encode the code point
        for &byte in to_encode {
            writer.extend_from_slice(&[b'%', byte2hex((byte >> 4) & 0xF), byte2hex(byte & 0xF)]);
        }
    }

    // Write the rest of the string
    writer.extend_from_slice(remaining);
    Ok(())
}

// ───────────── re-exports from sibling modules ─────────────

// B-2: unicode core re-exported at top of file. Remaining submodule re-exports
// land when `unicode_draft`/`visible_draft`/`paths_draft`/`escape_html_draft` un-gate.
pub use crate::escape_reg_exp::escape_reg_exp;
// TODO(b2-gated): full transcoding suite from unicode_draft —
//   to_utf8_alloc / to_utf16_alloc / convert_* / copy_*_into_* / EncodeIntoResult / BOM / etc.
// TODO(b2-gated): visible::{visible, visible_codepoint_width, ...}
// TODO(b2-gated): paths::{to_w_path, basename, add_nt_path_prefix, ...}
// TODO(b2-gated): escape_html::{escape_html_for_latin1_input, escape_html_for_utf16_input}

bun_core::declare_scope!(STR, hidden);
// `log` is `bun.Output.scoped(.STR, .hidden)` — use `bun_core::scoped_log!(STR, ...)`.

pub type CodePoint = i32;

/// SIMD-accelerated iterator that yields slices of text between ANSI escape sequences.
/// The C++ side uses ANSI::findEscapeCharacter (SIMD) and ANSI::consumeANSI.
#[repr(C)]
pub struct ANSIIterator {
    pub input: *const u8,
    pub input_len: usize,
    pub cursor: usize,
    pub slice_ptr: *const u8,
    pub slice_len: usize,
}

impl ANSIIterator {
    pub fn init(input: &[u8]) -> ANSIIterator {
        ANSIIterator {
            input: input.as_ptr(),
            input_len: input.len(),
            cursor: 0,
            slice_ptr: core::ptr::null(),
            slice_len: 0,
        }
    }

    /// Returns the next slice of non-ANSI text, or null when done.
    pub fn next(&mut self) -> Option<&[u8]> {
        // SAFETY: self is #[repr(C)] and matches the C++ layout; Bun__ANSI__next
        // writes slice_ptr/slice_len within [input, input+input_len).
        if unsafe { Bun__ANSI__next(self) } {
            if self.slice_ptr.is_null() {
                return None;
            }
            // SAFETY: slice_ptr/slice_len point into the input buffer per C++ contract.
            return Some(unsafe { core::slice::from_raw_parts(self.slice_ptr, self.slice_len) });
        }
        None
    }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn Bun__ANSI__next(it: *mut ANSIIterator) -> bool;
}

// Transcoding allocators live in T0 `bun_core::strings` so collections can
// reach them without a same-tier cycle. Re-export here for callers that go
// through `bun_string::strings`.
pub use bun_core::strings::{
    allocate_latin1_into_utf8_with_list, convert_utf16_to_utf8, convert_utf16_to_utf8_append,
    encode_wtf8_rune, is_all_ascii, latin1_to_codepoint_bytes_assume_not_ascii, to_utf8_alloc,
    to_utf8_append_to_list, to_utf8_from_latin1,
};

#[inline]
pub fn to_utf8_alloc_with_type(utf16: &[u16]) -> Vec<u8> {
    bun_core::strings::to_utf8_alloc(utf16)
}

// ───────────── B-2 Track A: minimal real impls of gated-submodule fns ─────────────
// These mirror the same-named fns in `unicode_draft`/`paths_draft` so dependents
// can link against `bun_string::strings::*` without un-gating the full drafts.
// Each is a thin wrapper over simdutf or the scalar logic from the .zig source.

/// `strings.utf8ByteSequenceLength` — returns 0 for invalid lead bytes
/// (unicode.zig:1509). NOT the same as the WTF-8 variant, which returns 1.
#[inline]
pub fn utf8_byte_sequence_length(first_byte: u8) -> u8 {
    match first_byte {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF7 => 4,
        _ => 0,
    }
}

/// `std.mem.trimLeft(u8, str, chars)` — strip leading chars in `values_to_strip`.
pub fn trim_left<'a>(slice: &'a [u8], values_to_strip: &[u8]) -> &'a [u8] {
    let mut begin = 0usize;
    while begin < slice.len() && values_to_strip.contains(&slice[begin]) {
        begin += 1;
    }
    &slice[begin..]
}

/// `std.mem.trimRight(u8, str, chars)` — strip trailing chars in `values_to_strip`.
pub fn trim_right<'a>(slice: &'a [u8], values_to_strip: &[u8]) -> &'a [u8] {
    let mut end = slice.len();
    while end > 0 && values_to_strip.contains(&slice[end - 1]) {
        end -= 1;
    }
    &slice[..end]
}

/// `std.mem.replacementSize` — byte length of `input` after replacing every
/// occurrence of `needle` with `replacement`.
pub fn replacement_size(input: &[u8], needle: &[u8], replacement: &[u8]) -> usize {
    if needle.is_empty() {
        return input.len();
    }
    let mut size = 0usize;
    let mut i = 0usize;
    while i < input.len() {
        if i + needle.len() <= input.len() && &input[i..i + needle.len()] == needle {
            size += replacement.len();
            i += needle.len();
        } else {
            size += 1;
            i += 1;
        }
    }
    size
}

/// `std.mem.replace` — write `input` into `output` replacing every `needle`
/// with `replacement`; returns the number of replacements made. `output` must
/// be at least `replacement_size(input, needle, replacement)` bytes.
pub fn replace(input: &[u8], needle: &[u8], replacement: &[u8], output: &mut [u8]) -> usize {
    if needle.is_empty() {
        output[..input.len()].copy_from_slice(input);
        return 0;
    }
    let mut i = 0usize;
    let mut o = 0usize;
    let mut count = 0usize;
    while i < input.len() {
        if i + needle.len() <= input.len() && &input[i..i + needle.len()] == needle {
            output[o..o + replacement.len()].copy_from_slice(replacement);
            o += replacement.len();
            i += needle.len();
            count += 1;
        } else {
            output[o] = input[i];
            o += 1;
            i += 1;
        }
    }
    count
}

/// Error from [`parse_int`] (`std.fmt.parseInt` port).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseIntError {
    InvalidCharacter,
    Overflow,
}

/// `std.fmt.parseInt` — parse an integer of type `T` from `buf` in base
/// `radix` (2..=36). Accepts an optional leading `+`/`-`. Port keeps Zig's
/// error set: `Overflow` on range error, `InvalidCharacter` otherwise.
pub fn parse_int<T>(buf: &[u8], radix: u8) -> Result<T, ParseIntError>
where
    T: TryFrom<i128> + TryFrom<u128>,
{
    debug_assert!((2..=36).contains(&radix));
    if buf.is_empty() {
        return Err(ParseIntError::InvalidCharacter);
    }
    let (neg, digits) = match buf[0] {
        b'+' => (false, &buf[1..]),
        b'-' => (true, &buf[1..]),
        _ => (false, buf),
    };
    if digits.is_empty() {
        return Err(ParseIntError::InvalidCharacter);
    }
    let radix_u = radix as u128;
    let mut acc: u128 = 0;
    for &c in digits {
        let d = match c {
            b'0'..=b'9' => (c - b'0') as u128,
            b'a'..=b'z' => (c - b'a' + 10) as u128,
            b'A'..=b'Z' => (c - b'A' + 10) as u128,
            _ => return Err(ParseIntError::InvalidCharacter),
        };
        if d >= radix_u {
            return Err(ParseIntError::InvalidCharacter);
        }
        acc = acc
            .checked_mul(radix_u)
            .and_then(|v| v.checked_add(d))
            .ok_or(ParseIntError::Overflow)?;
    }
    if neg {
        let signed: i128 = if acc == (i128::MAX as u128) + 1 {
            i128::MIN
        } else if acc > i128::MAX as u128 {
            return Err(ParseIntError::Overflow);
        } else {
            -(acc as i128)
        };
        T::try_from(signed).map_err(|_| ParseIntError::Overflow)
    } else {
        T::try_from(acc).map_err(|_| ParseIntError::Overflow)
    }
}

/// `strings.removeLeadingDotSlash` — strip a leading `./` (or `.\` on Windows).
#[inline]
pub fn remove_leading_dot_slash(slice: &[u8]) -> &[u8] {
    if slice.len() >= 2 {
        if &slice[..2] == b"./" || (cfg!(windows) && &slice[..2] == b".\\") {
            return &slice[2..];
        }
    }
    slice
}

/// Compare a UTF-16 string against a UTF-8 string without allocating
/// (`unicode.zig:utf16EqlString`).
pub fn utf16_eql_string(text: &[u16], str: &[u8]) -> bool {
    if text.len() > str.len() {
        // UTF-16 encoding can never be longer than the UTF-8 encoding.
        return false;
    }
    let mut temp = [0u8; 4];
    let n = text.len();
    let mut j: usize = 0;
    let mut i: usize = 0;
    while i < n {
        let mut r1: i32 = text[i] as i32;
        if (0xD800..=0xDBFF).contains(&r1) && i + 1 < n {
            let r2: i32 = text[i + 1] as i32;
            if (0xDC00..=0xDFFF).contains(&r2) {
                r1 = ((r1 - 0xD800) << 10) | ((r2 - 0xDC00) + 0x10000);
                i += 1;
            }
        }
        let width = encode_wtf8_rune(&mut temp, r1 as u32) as usize;
        if j + width > str.len() {
            return false;
        }
        if temp[..width] != str[j..j + width] {
            return false;
        }
        j += width;
        i += 1;
    }
    j == str.len()
}

/// `strings.toUTF16AllocForReal` — like [`to_utf16_alloc`] but **always**
/// returns a `Vec<u16>` (pure-ASCII inputs are widened 1:1 instead of
/// returning `None`). Port of `unicode.zig:toUTF16AllocForReal`.
pub fn to_utf16_alloc_for_real(
    bytes: &[u8],
    fail_if_invalid: bool,
    sentinel: bool,
) -> Result<Vec<u16>, ToUTF16Error> {
    if let Some(v) = to_utf16_alloc(bytes, fail_if_invalid, sentinel)? {
        return Ok(v);
    }
    // All-ASCII path: widen each byte.
    let mut out = Vec::with_capacity(bytes.len() + sentinel as usize);
    out.extend(bytes.iter().map(|&b| b as u16));
    if sentinel {
        out.push(0);
    }
    Ok(out)
}

/// `withoutPrefix` (runtime) — strip `prefix` from `input` if present.
/// Unlike `without_prefix_comptime`, this accepts a non-`'static` prefix.
#[inline]
pub fn without_prefix<'a>(input: &'a [u8], prefix: &[u8]) -> &'a [u8] {
    if has_prefix(input, prefix) {
        &input[prefix.len()..]
    } else {
        input
    }
}

/// `strings.withoutTrailingSlash` — strip trailing `/` or `\` (but not down
/// to empty; matches `paths.zig:withoutTrailingSlash` behavior `len > 1`).
pub fn without_trailing_slash(this: &[u8]) -> &[u8] {
    let mut href = this;
    while href.len() > 1 && matches!(href[href.len() - 1], b'/' | b'\\') {
        href = &href[..href.len() - 1];
    }
    href
}

/// `strings.startsWithWindowsDriveLetterT` — true for `[A-Za-z]:` prefix
/// followed by at least one more byte (Zig: `s.len > 2`).
#[inline]
pub fn starts_with_windows_drive_letter_t<T: Copy + Into<u32>>(s: &[T]) -> bool {
    s.len() > 2 && s[1].into() == b':' as u32 && {
        let c = s[0].into();
        (c >= b'a' as u32 && c <= b'z' as u32) || (c >= b'A' as u32 && c <= b'Z' as u32)
    }
}

/// `strings.convertUTF8toUTF16InBuffer` — best-effort UTF-8 → UTF-16LE into
/// a caller-supplied buffer. Invalid UTF-8 is silently dropped (returns the
/// written prefix). Port of `unicode.zig:convertUTF8toUTF16InBuffer`.
pub fn convert_utf8_to_utf16_in_buffer<'a>(buf: &'a mut [u16], input: &[u8]) -> &'a mut [u16] {
    if input.is_empty() {
        return &mut buf[..0];
    }
    let result = simdutf::convert::utf8::to::utf16::le(input, buf);
    &mut buf[..result]
}

/// `strings.toUTF8ListWithType` — append UTF-8 transcoding of `utf16` onto
/// `list` and return the (possibly-reallocated) list. Port of
/// `unicode.zig:toUTF8ListWithType` (always uses simdutf path; Bun is built
/// with `FeatureFlags.use_simdutf = true`).
pub fn to_utf8_list_with_type(mut list: Vec<u8>, utf16: &[u16]) -> Result<Vec<u8>, AllocError> {
    if utf16.is_empty() {
        return Ok(list);
    }
    // PORT NOTE: Zig's path validates UTF-16 first then falls back to a manual
    // loop on failure (`toUTF8ListWithTypeBun`). For B-2 we route through
    // `bun_core::strings::convert_utf16_to_utf8_append`, which already replaces
    // unpaired surrogates with U+FFFD — semantically equivalent.
    bun_core::strings::convert_utf16_to_utf8_append(&mut list, utf16);
    Ok(list)
}

/// Errors from `to_utf16_alloc` when `fail_if_invalid = true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToUTF16Error {
    InvalidByteSequence,
    OutOfMemory,
}
impl From<AllocError> for ToUTF16Error {
    fn from(_: AllocError) -> Self { ToUTF16Error::OutOfMemory }
}

/// `strings.toUTF16Alloc` — convert UTF-8 → UTF-16LE **iff** `bytes` contains
/// any non-ASCII byte; pure-ASCII inputs return `Ok(None)` (caller keeps the
/// 8-bit form). When `fail_if_invalid` is set, invalid UTF-8 yields
/// `Err(InvalidByteSequence)`; otherwise invalid sequences are replaced with
/// U+FFFD (per `unicode.zig:toUTF16Alloc`). When `sentinel` is set the result
/// includes a trailing 0 u16.
pub fn to_utf16_alloc(
    bytes: &[u8],
    fail_if_invalid: bool,
    sentinel: bool,
) -> Result<Option<Vec<u16>>, ToUTF16Error> {
    let Some(_first) = first_non_ascii(bytes) else { return Ok(None) };

    let out_length = simdutf::length::utf16::from::utf8(bytes);
    let cap = out_length + if sentinel { 1 } else { 0 };
    let mut out = vec![0u16; cap.max(1)];
    let res = simdutf::convert::utf8::to::utf16::with_errors::le(bytes, &mut out[..out_length.max(1)]);
    if res.is_successful() && out_length > 0 {
        if sentinel {
            out[out_length] = 0;
            out.truncate(out_length + 1);
        } else {
            out.truncate(out_length);
        }
        return Ok(Some(out));
    }
    if fail_if_invalid {
        return Err(ToUTF16Error::InvalidByteSequence);
    }
    // Slow path: WTF-8 decode with replacement. Reuse `out` capacity.
    out.clear();
    out.reserve(bytes.len() + if sentinel { 1 } else { 0 });
    let mut remaining = bytes;
    while let Some(i) = first_non_ascii(remaining) {
        let i = i as usize;
        // Copy ASCII prefix as-is (one u16 per byte).
        out.extend(remaining[..i].iter().map(|&b| b as u16));
        remaining = &remaining[i..];
        // Decode one codepoint via the same routine Zig uses
        // (`convertUTF8BytesIntoUTF16`) so the number/position of U+FFFD
        // emissions matches: advance by `replacement.len.max(1)`, not 1.
        let replacement = unicode_draft::convert_utf8_bytes_into_utf16(remaining);
        remaining = &remaining[(replacement.len as usize).max(1)..];
        let c = replacement.code_point;
        if c <= 0xFFFF {
            out.push(c as u16);
        } else {
            out.push(unicode_draft::u16_lead(c));
            out.push(unicode_draft::u16_trail(c));
        }
    }
    out.extend(remaining.iter().map(|&b| b as u16));
    if sentinel {
        out.push(0);
    }
    Ok(Some(out))
}

/// `PATTERN_KEY_COMPARE` from the Node.js ESM resolution spec — the comparator
/// behind `NewGlobLengthSorter`. Returns an [`Ordering`] suitable for
/// `slice.sort_by(|a, b| glob_length_compare(a, b))` to sort in **descending
/// order of specificity** (matches Zig `lessThan` returning `true` ⇒ `Less`).
pub fn glob_length_compare(key_a: &[u8], key_b: &[u8]) -> Ordering {
    let star_a = index_of_char(key_a, b'*');
    let star_b = index_of_char(key_b, b'*');
    let base_length_a = star_a.map_or(key_a.len(), |i| i as usize);
    let base_length_b = star_b.map_or(key_b.len(), |i| i as usize);
    if base_length_a > base_length_b { return Ordering::Less; }
    if base_length_b > base_length_a { return Ordering::Greater; }
    if star_a.is_none() { return Ordering::Greater; }
    if star_b.is_none() { return Ordering::Less; }
    if key_a.len() > key_b.len() { return Ordering::Less; }
    if key_b.len() > key_a.len() { return Ordering::Greater; }
    Ordering::Equal
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable.zig (2431 lines)
//   confidence: medium
//   todos:      13
//   notes:      SIMD @Vector loops (count_char, index_of_not_char, index_of_needs_url_encode, encode_bytes_to_hex, first_non_ascii16) ported as scalar with PERF(port) markers; comptime-type dispatch (T==u8) approximated via size_of checks; move_all_slices needs reflection derive; concat_if_needed leaks Box to match Zig out-param ownership.
// ──────────────────────────────────────────────────────────────────────────
