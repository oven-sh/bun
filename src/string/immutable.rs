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
#[cfg(any())] #[path = "immutable/exact_size_matcher.rs"] pub mod exact_size_matcher_draft;
#[cfg(any())] #[path = "immutable/escapeHTML.rs"]         mod escape_html_draft;
#[cfg(any())] #[path = "immutable/grapheme.rs"]           pub mod grapheme_draft;
#[cfg(any())] #[path = "immutable/paths.rs"]              mod paths_draft;
#[cfg(any())] #[path = "immutable/unicode.rs"]            mod unicode_draft;
#[cfg(any())] #[path = "immutable/visible.rs"]            mod visible_draft;

pub mod exact_size_matcher { pub struct ExactSizeMatcher<const N: usize>; }
pub mod grapheme {}
mod escape_html {}
mod escape_reg_exp { pub use crate::escape_reg_exp::*; }
mod paths {}
mod visible {}

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
            cursor.c = decode_wtf8_rune_t::<CodePoint>(&buf, len, -1);
            cursor.i = pos as u32;
            cursor.width = len;
            true
        }
    }

    /// `toUTF16Literal` — comptime in Zig (`std.unicode.utf8ToUtf16LeStringLiteral`).
    /// In Rust callers should use a `const` UTF-16 literal directly; this
    /// runtime fallback leaks (call-site is rare and the Zig version was
    /// comptime-only anyway).
    pub fn to_utf16_literal(s: &[u8]) -> &'static [u16] {
        // TODO(b2): const-eval via build script or const fn; runtime path leaks.
        // ASCII fast path (covers all current call sites — comptime literals).
        let v: Vec<u16> = s.iter().map(|&b| b as u16).collect();
        debug_assert!(s.iter().all(|&b| b < 0x80), "to_utf16_literal: non-ASCII literal needs const-eval path");
        Box::leak(v.into_boxed_slice())
    }
}
// Placeholder: full transcoding suite re-exported once `unicode_draft` un-gates.
pub use self::unicode::to_utf16_literal;

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
    contains_t(self_, str)
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
    while offset < text.len() && text[offset].is_ascii_whitespace() {
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
    while end < text.len() && text[end].is_ascii_whitespace() {
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
        if eql_long::<true>(str, target) {
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
    eql_long::<false>(&self_[0..str.len()], str)
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
    self_.len() >= prefix.len() && eql_case_insensitive_ascii::<false>(&self_[0..prefix.len()], prefix)
}

pub fn starts_with_generic<T: Copy>(self_: &[T], str: &[T]) -> bool {
    if str.len() > self_.len() {
        return false;
    }
    eql_long::<false>(
        reinterpret_to_u8(&self_[0..str.len()]),
        reinterpret_to_u8(str),
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
    eql_long::<false>(self_, other)
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

pub fn eql_comptime_utf16(self_: &[u16], alt: &'static [u8]) -> bool {
    eql_comptime_check_len_with_type::<u16, true>(self_, to_utf16_literal(alt))
}

pub fn eql_comptime_ignore_len(self_: &[u8], alt: &'static [u8]) -> bool {
    eql_comptime_check_len_with_type::<u8, false>(self_, alt)
}

pub fn has_prefix_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len() && eql_comptime_check_len_with_type::<u8, false>(&self_[0..alt.len()], alt)
}

pub fn has_prefix_comptime_utf16(self_: &[u16], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len()
        && eql_comptime_check_len_with_type::<u16, false>(&self_[0..alt.len()], to_utf16_literal(alt))
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
    b: &'static [T],
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
    b: &'static [T],
) -> bool {
    // PORT NOTE: Zig coerced array-by-value `b` to a pointer here. Rust callers
    // already pass `&'static [T]`.
    eql_comptime_check_len_with_known_type::<T, CHECK_LEN>(a, b)
}

pub fn eql_case_insensitive_ascii_ignore_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii::<false>(a, b)
}

pub fn eql_case_insensitive_asciii_check_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii::<true>(a, b)
}

pub fn eql_case_insensitive_ascii<const CHECK_LEN: bool>(a: &[u8], b: &[u8]) -> bool {
    if CHECK_LEN {
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
    eql_long::<false>(
        reinterpret_to_u8(a_str),
        reinterpret_to_u8(b_str),
    )
}

pub fn eql_long<const CHECK_LEN: bool>(a_str: &[u8], b_str: &[u8]) -> bool {
    let len = b_str.len();

    if CHECK_LEN {
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

// PORT NOTE: AsciiVector / @Vector aliases dropped — Zig SIMD types have no
// stable Rust equivalent. Hot loops below use scalar fallbacks with
// `// PERF(port)` markers; Phase B routes through bun_highway/portable_simd.
pub const ASCII_VECTOR_SIZE: usize = 16;
pub const ASCII_U16_VECTOR_SIZE: usize = 8;

pub fn first_non_ascii(slice: &[u8]) -> Option<u32> {
    let result = simdutf::validate::with_errors::ascii(slice);
    if result.status == simdutf::Status::SUCCESS {
        return None;
    }
    Some(result.count as u32)
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

/// Update all strings in a struct pointing to "from" to point to "to".
// TODO(port): Zig used `std.meta.fields(Type)` reflection to find every `[]const u8`
// field. Rust has no field reflection; Phase B should provide a per-type derive
// (e.g. `#[derive(MoveSlices)]`) or hand-written impls at call sites.
pub fn move_all_slices<T>(_container: &mut T, _from: &[u8], _to: &[u8]) {
    unimplemented!("move_all_slices: requires field reflection — see TODO(port)")
}

pub fn move_slice<'a>(slice: &[u8], from: &[u8], to: &'a [u8]) -> &'a [u8] {
    if cfg!(debug_assertions) {
        debug_assert!(from.len() <= to.len() && from.len() >= slice.len());
        // assert we are in bounds
        debug_assert!(
            (from.as_ptr() as usize + from.len()) >= slice.as_ptr() as usize + slice.len()
                && (from.as_ptr() as usize <= slice.as_ptr() as usize)
        );
        debug_assert!(eql_long::<false>(from, &to[0..from.len()])); // data should be identical
    }

    let ptr_offset = slice.as_ptr() as usize - from.as_ptr() as usize;
    let result = &to[ptr_offset..][0..slice.len()];

    if cfg!(debug_assertions) {
        debug_assert!(eql_long::<false>(slice, result)); // data should be identical
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
            if eql_long::<true>(check, item) {
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
    dest: &mut &[u8],
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
        *dest = b"";
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
            if eql_long::<true>(stack_copy, interned) {
                *dest = interned;
                return Ok(());
            }
        }
    }

    let is_needed = 'brk: {
        let out = *dest;
        let mut remain = out;

        for arg in args {
            // PORT NOTE: Zig has `args.len` here (likely a bug); preserved verbatim.
            if args.len() > remain.len() {
                break 'brk true;
            }

            if eql_long::<true>(&remain[0..args.len()], arg) {
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

    let buf = concat_with_length(args, total_length)?;
    // TODO(port): lifetime — Zig stored a freshly-allocated slice into `*[]const u8`
    // and the caller owns it. In Rust the caller should own a `Box<[u8]>`; leaking
    // here to match Zig semantics. Phase B: change signature to return ownership.
    *dest = Box::leak(buf);
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
    fn fmt(&self, _f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        #[cfg(any())]
        {
            // TODO(b2-gated): bun.js_printer.writePreQuotedString — MOVE_DOWN
            // bun_js_parser::printer → bun_string::printer (string/lib.rs has
            // a `printer` stub mod but not write_pre_quoted_string yet).
            return crate::printer::write_pre_quoted_string(
                self.data, _f, self.flags.quote_char, false, self.flags.json, self.flags.str_encoding,
            );
        }
        todo!("QuoteEscapeFormat::fmt: printer::write_pre_quoted_string")
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable.zig (2431 lines)
//   confidence: medium
//   todos:      13
//   notes:      SIMD @Vector loops (count_char, index_of_not_char, index_of_needs_url_encode, encode_bytes_to_hex, first_non_ascii16) ported as scalar with PERF(port) markers; comptime-type dispatch (T==u8) approximated via size_of checks; move_all_slices needs reflection derive; concat_if_needed leaks Box to match Zig out-param ownership.
// ──────────────────────────────────────────────────────────────────────────
