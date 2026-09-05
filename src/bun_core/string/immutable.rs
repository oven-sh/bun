//! The `bun.strings` namespace:
//! SIMD-accelerated immutable string utilities operating on `&[u8]` (NOT `&str`).

use core::cmp::Ordering;

use crate::BoundedArray;
use crate::CrateError as Error;
use bun_alloc::AllocError;
use bun_highway as highway;
use bun_simdutf_sys::simdutf;

pub use self::unicode::{
    CodepointIterator, Cursor, NewCodePointIterator, UnsignedCodepointIterator,
    contains_non_bmp_code_point_or_is_invalid_identifier, decode_wtf8_rune_t,
    decode_wtf8_rune_t_multibyte, wtf8_byte_sequence_length,
    wtf8_byte_sequence_length_with_invalid,
};

// Sub-modules (peer files under `src/string/immutable/`).
#[path = "immutable/escapeHTML.rs"]
pub mod escape_html;
#[path = "immutable/exact_size_matcher.rs"]
pub mod exact_size_matcher;
pub use escape_html::{html_escape_entity, xml_escape_entity};
#[path = "immutable/unicode.rs"]
mod unicode_draft;
#[path = "immutable/visible.rs"]
mod visible_impl;

// UTF-16 surrogate primitives. The single implementation lives in the
// tier-0 `crate::strings_impl`; re-exported here as part of `bun.strings`.
pub use crate::strings_impl::{
    U16_SURROGATE_OFFSET, decode_surrogate_pair, decode_utf16_with_fffd, decode_wtf16_raw,
    u16_get_supplementary,
};
// Transcoding helpers from `unicode_draft` — re-exported so downstream
// `bun_core::strings::*` callers (e.g. runtime/webcore/encoding.rs) resolve.
pub use unicode_draft::{
    BOM, UTF16Replacement, allocate_latin1_into_utf8, copy_cp1252_into_utf16,
    copy_latin1_into_ascii, copy_latin1_into_utf8_stop_on_non_ascii, copy_latin1_into_utf16,
    copy_u8_into_u16, copy_u16_into_u8, copy_utf16_into_utf8_impl,
    element_length_cp1252_into_utf16, element_length_utf8_into_utf16, to_utf8_list_with_type_bun,
    to_utf16_alloc_maybe_buffered, u16_is_lead, u16_is_trail, utf16_codepoint,
    utf16_codepoint_with_fffd, wtf8_sequence,
};

/// `bun.strings.visible` — terminal-visible-width helpers. The implementation
/// lives in C++ (`src/jsc/bindings/stringWidth.cpp`); this module is the FFI
/// surface for the remaining Rust callers.
pub use visible_impl::visible;

/// `unicode` surface needed by `immutable.rs` itself (CodepointIterator +
/// WTF-8 decode). Full transcoding suite lives in `unicode_draft`.
pub mod unicode {
    use super::CodePoint;

    pub use crate::strings_impl::{
        wtf8_byte_sequence_length, wtf8_byte_sequence_length_with_invalid,
    };

    pub use super::unicode_draft::{decode_wtf8_rune_t, decode_wtf8_rune_t_multibyte};

    /// `CodepointIterator` — yields WTF-8 codepoints with byte-width.
    pub struct NewCodePointIterator<'a> {
        pub bytes: &'a [u8],
    }
    pub type CodepointIterator<'a> = NewCodePointIterator<'a>;
    pub type UnsignedCodepointIterator<'a> = NewCodePointIterator<'a>;

    impl<'a> NewCodePointIterator<'a> {
        pub const ZERO_VALUE: CodePoint = -1;
        pub fn init(bytes: &'a [u8]) -> Self {
            Self { bytes }
        }

        /// True iff any byte in `slice` begins a multi-byte WTF-8 sequence.
        pub fn needs_utf8_decoding(slice: &[u8]) -> bool {
            let mut i = 0usize;
            while i < slice.len() {
                let cp_len = wtf8_byte_sequence_length(slice[i]);
                match cp_len {
                    0 => return false,
                    1 => i += 1,
                    _ => return true,
                }
            }
            false
        }
    }

    #[derive(Default, Clone, Copy)]
    pub struct Cursor {
        pub i: u32,
        pub width: u8,
        pub c: CodePoint,
    }

    impl<'a> NewCodePointIterator<'a> {
        /// Cursor advance. Returns `false` at end.
        // PERF: `#[inline]` alone is hint-only; LLVM declined to inline
        // this cross-crate into `bun_js_printer::print_identifier_ascii_only`
        // (the multibyte slow path makes the body look heavy). Called per-byte
        // of every printed identifier under `ASCII_ONLY=true`. Force it.
        #[inline(always)]
        pub fn next(&self, cursor: &mut Cursor) -> bool {
            let bytes = self.bytes;
            let pos = cursor.i as usize + cursor.width as usize;
            if pos >= bytes.len() {
                return false;
            }
            // `pos < bytes.len()` checked immediately above; LLVM elides both
            // the slice and index bounds checks.
            let tail = &bytes[pos..];
            let first = tail[0];
            cursor.i = pos as u32;
            // ASCII fast path — the overwhelmingly common case for JS source
            // (identifiers, escape-free strings).
            if first < 0x80 {
                cursor.c = first as CodePoint;
                cursor.width = 1;
                return true;
            }
            let len = wtf8_byte_sequence_length(first);
            // `take ∈ 1..=4` clamped to the remaining length.
            let take = (len as usize).min(tail.len());
            let mut buf = [0u8; 4];
            buf[..take].copy_from_slice(&tail[..take]);
            let cp = decode_wtf8_rune_t::<CodePoint>(buf, len, -1);
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

    /// Fused
    /// "must I quote this import/export alias?" predicate for `js_printer`.
    ///
    /// Returns `true` if `text` is empty, OR any codepoint is non-BMP (>U+FFFF,
    /// even if a valid identifier char), OR the codepoint sequence is not a
    /// valid ECMAScript IdentifierName.
    pub fn contains_non_bmp_code_point_or_is_invalid_identifier(text: &[u8]) -> bool {
        let iter = CodepointIterator::init(text);
        let mut curs = Cursor::default();
        if !iter.next(&mut curs) {
            return true;
        }
        if curs.c > 0xFFFF || !crate::string::lexer::is_identifier_start(curs.c as u32) {
            return true;
        }
        while iter.next(&mut curs) {
            if curs.c > 0xFFFF || !crate::string::lexer::is_identifier_continue(curs.c as u32) {
                return true;
            }
        }
        false
    }
}

/// Peek `n` WTF-8 codepoints from `bytes[at..]` and return the spanning slice
/// `bytes[at..end]`. Codepoint width is `wtf8_byte_sequence_length_with_invalid`
/// (invalid lead byte → 1). Stops early at EOF or a truncated trailing sequence,
/// returning the slice up to the last complete codepoint boundary.
///
/// Shared body of `js_parser::Lexer::peek`.
#[inline]
pub fn peek_n_codepoints_wtf8(bytes: &[u8], at: usize, n: usize) -> &[u8] {
    let mut end = at;
    for _ in 0..n {
        if end >= bytes.len() {
            break;
        }
        let cp_len = wtf8_byte_sequence_length_with_invalid(bytes[end]) as usize;
        if end + cp_len > bytes.len() {
            break;
        }
        end += cp_len;
    }
    &bytes[at..end]
}

/// WTF-8 codepoint stepper shared by the JS and JSON lexers.
///
/// The JS and JSON lexers call the same
/// `wtf8_byte_sequence_length_with_invalid` / `decode_wtf8_rune_t_multibyte`
/// pair defined alongside this module, so the stepper belongs here.
///
/// NOT the same algorithm as [`CodepointIterator::next_codepoint`] — that one
/// uses `utf8ByteSequenceLength` + `next_width` lookahead, has no `end`
/// cursor, and does not advance-by-1 on U+FFFD.
pub mod lexer_step {
    use super::{
        CodePoint, UNICODE_REPLACEMENT, decode_wtf8_rune_t_multibyte,
        wtf8_byte_sequence_length_with_invalid,
    };

    /// Non-ASCII tail of [`next_codepoint`]. Kept out-of-line so the hot
    /// ASCII path stays small enough to inline into every `step()` site.
    ///
    /// `#[cold]` is required: with fat LTO + `codegen-units = 1`, LLVM's
    /// single-caller heuristic merges an `#[inline(never)]`-only callee back
    /// into its sole caller, which then makes `next_codepoint` too large to
    /// inline into `next()` (perf showed it as a separate ~2.6% symbol with
    /// the multibyte decode folded in). `cold` parks this in `.text.unlikely`
    /// and survives LTO's IPO inliner.
    #[cold]
    #[inline(never)]
    pub fn next_codepoint_multibyte(contents: &[u8], current: &mut usize, first: u8) -> CodePoint {
        let len = contents.len();
        let cp_len = wtf8_byte_sequence_length_with_invalid(first) as usize;
        let avail = len - *current;

        // The ASCII fast path above handled `first < 0x80`; here `first >= 0x80` but `cp_len`
        // may still be 1 for invalid lead bytes (0x80-0xBF, 0xF8-0xFF) — those must yield the
        // raw byte, NOT the EOF sentinel, so the main lex loop falls through to its syntax-error
        // arm instead of silently emitting TEndOfFile mid-stream.
        let code_point: CodePoint = if cp_len == 1 {
            first as CodePoint
        } else if avail < cp_len {
            // truncated multibyte at EOF
            -1
        } else {
            let mut quad = [0u8; 4];
            // SAFETY: `*current < len` (checked by caller), `cp_len ∈ 2..=4`, and
            // `avail >= cp_len`, so `contents[current..current + cp_len]` is in-bounds.
            // `decode_wtf8_rune_t_multibyte` only dereferences `p[0..len]`; pad bytes are
            // never read.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    contents.as_ptr().add(*current),
                    quad.as_mut_ptr(),
                    cp_len,
                );
            }
            decode_wtf8_rune_t_multibyte(quad, cp_len as u8, UNICODE_REPLACEMENT as CodePoint)
        };

        *current += if code_point != UNICODE_REPLACEMENT as CodePoint {
            cp_len
        } else {
            1
        };

        code_point
    }
}

/// Strip a leading UTF-8 BOM (`EF BB BF`) if present.
#[inline]
pub fn without_utf8_bom(bytes: &[u8]) -> &[u8] {
    if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        &bytes[3..]
    } else {
        bytes
    }
}

// Transcoding suite re-exported from bun_core (T0).
/// Compile-time UTF-8→UTF-16 literal. This **must** be a
/// macro (callers write `bun_core::strings::w!("…")`); a `fn` returning
/// `&'static [u16]` would require leaking. Re-export of the crate-root `w!`.
pub use crate::string::w;
pub use crate::strings_impl::{
    EncodeIntoResult, copy_latin1_into_utf8, copy_utf16_into_utf8,
    copy_utf16_into_utf8_with_utf8_len, element_length_latin1_into_utf8,
    element_length_utf16_into_utf8, encode_surrogate_pair, push_codepoint_utf16, to_utf8_alloc_z,
    to_utf8_from_latin1_z, u16_lead, u16_trail,
};

/// memmem — `highway_memmem` (HWY_DYNAMIC_DISPATCH MemMemImpl), same on all platforms.
#[inline]
pub fn memmem(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    highway::memmem(haystack, needle)
}

/// How the width-generic (`_t`) scanners below hand a `&[T]` to highway: as
/// the 8- or 16-bit lanes the kernels take, or `Wide` for element types they
/// don't, which keep a scalar arm. Safe via [`crate::cast_slice`]: `NoUninit` proves every byte of `T` is
/// initialized; the `u16` view additionally requires `T`'s own alignment.
enum Lanes<'a> {
    U8(&'a [u8]),
    U16(&'a [u16]),
    Wide,
}

#[inline(always)]
fn lanes<T: crate::NoUninit>(s: &[T]) -> Lanes<'_> {
    match (core::mem::size_of::<T>(), core::mem::align_of::<T>()) {
        (1, _) => Lanes::U8(crate::cast_slice::<T, u8>(s)),
        (2, 2) => Lanes::U16(crate::cast_slice::<T, u16>(s)),
        _ => Lanes::Wide,
    }
}

/// `bun.reinterpretSlice` — `&[T]` → `&[u8]` byte view (any width).
#[inline]
fn reinterpret_to_u8<T: crate::NoUninit>(s: &[T]) -> &[u8] {
    crate::cast_slice::<T, u8>(s)
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

/// `char` is an ASCII byte compared against each (possibly wider) element.
#[inline]
pub fn contains_char_t<T: crate::NoUninit + Eq + Into<u32>>(self_: &[T], char: u8) -> bool {
    match lanes(self_) {
        Lanes::U8(s) => contains_char(s, char),
        Lanes::U16(s) => highway::memmem16(s, &[u16::from(char)]).is_some(),
        Lanes::Wide => self_.iter().any(|c| (*c).into() == u32::from(char)),
    }
}

#[inline]
pub fn contains(self_: &[u8], str: &[u8]) -> bool {
    index_of(self_, str).is_some()
}

/// The kernels compare against at most this many set bytes per pass.
const ANY_CHAR_SET_MAX: usize = 16;

/// Index of the first byte in `slice` that appears in `chars` (SIMD via
/// highway). Returns `usize` (unlike the `u32`-returning single-char
/// scanners above) so callers can index with the result directly.
#[inline]
pub fn index_of_any(slice: &[u8], chars: &[u8]) -> Option<usize> {
    match chars.len() {
        0 => None,
        1 => index_of_char_usize(slice, chars[0]),
        2..=ANY_CHAR_SET_MAX => highway::index_of_any_char(slice, chars),
        // Larger sets (none today): one pass per 16-byte chunk, earliest hit wins.
        _ => chars
            .chunks(ANY_CHAR_SET_MAX)
            .filter_map(|set| index_of_any(slice, set))
            .min(),
    }
}

/// [`index_of_any`] starting at `start_index`; the result is absolute.
pub fn index_of_any_pos(slice: &[u8], chars: &[u8], start_index: usize) -> Option<usize> {
    if start_index >= slice.len() {
        return None;
    }
    index_of_any(&slice[start_index..], chars).map(|i| i + start_index)
}

/// Index of the last byte in `slice` that appears in `chars` (SIMD via highway).
#[inline]
pub fn last_index_of_any(slice: &[u8], chars: &[u8]) -> Option<usize> {
    match chars.len() {
        0 => None,
        1 => last_index_of_char(slice, chars[0]),
        2..=ANY_CHAR_SET_MAX => highway::last_index_of_any_char(slice, chars),
        _ => chars
            .chunks(ANY_CHAR_SET_MAX)
            .filter_map(|set| last_index_of_any(slice, set))
            .max(),
    }
}

/// Whether any byte of `slice` appears in `chars` (SIMD via highway).
#[inline]
pub fn contains_any(slice: &[u8], chars: &[u8]) -> bool {
    index_of_any(slice, chars).is_some()
}

pub fn index_of_any16(self_: &[u16], chars: &[u16]) -> Option<usize> {
    index_of_any_t(self_, chars)
}

pub fn index_of_any_t<T: crate::NoUninit + Eq>(str: &[T], chars: &[T]) -> Option<usize> {
    if let (Lanes::U8(s), Lanes::U8(c)) = (lanes(str), lanes(chars)) {
        return index_of_any(s, c);
    }
    // No multi-needle highway kernel for u16; `chars` is a short constant set.
    str.iter().position(|c| chars.iter().any(|d| d == c))
}

pub use contains as includes;

/// Case-insensitive ASCII lookup in a comptime string map whose keys are
/// already lowercase ASCII.
#[inline]
pub fn in_map_case_insensitive<M: crate::comptime_string_map::ComptimeStringMap>(
    self_: &[u8],
    map: &M,
) -> Option<M::Value>
where
    M::Value: Copy,
{
    map.lookup_ascii_case_insensitive(self_).copied()
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

// Secret-redaction scanners are canonical in crate::strings_impl (only callers
// live in bun_core/fmt.rs). Re-exported here to preserve the bun.strings.* path.
pub(crate) use crate::strings_impl::{
    find_url_password, is_uuid, starts_with_npm_secret, starts_with_secret, starts_with_uuid,
};

pub fn index_equal_any(in_: &[&[u8]], target: &[u8]) -> Option<usize> {
    for (i, str) in in_.iter().enumerate() {
        if eql_long(str, target, true) {
            return Some(i);
        }
    }
    None
}

pub fn repeating_alloc(count: usize, char: u8) -> Result<Box<[u8]>, AllocError> {
    // allocator param dropped (global mimalloc).
    Ok(vec![char; count].into_boxed_slice())
}

pub fn index_of_char_neg(self_: &[u8], char: u8) -> i32 {
    match index_of_char_usize(self_, char) {
        Some(i) => i32::try_from(i).expect("int cast"),
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
    highway::last_index_of_char(self_, char)
}

/// Width-generic [`last_index_of_char`].
#[inline]
pub fn last_index_of_char_t<T: crate::NoUninit + Eq>(self_: &[T], char: T) -> Option<usize> {
    match (lanes(self_), lanes(core::slice::from_ref(&char))) {
        (Lanes::U8(s), Lanes::U8(c)) => last_index_of_char(s, c[0]),
        (Lanes::U16(s), Lanes::U16(c)) => highway::memrmem16(s, c),
        _ => self_.iter().rposition(|c| *c == char),
    }
}

/// Start index of the last occurrence of `str`. Empty needle → `Some(len)`.
#[inline]
pub fn last_index_of(self_: &[u8], str: &[u8]) -> Option<usize> {
    highway::memrmem(self_, str)
}

/// Width-generic reverse substring search (last occurrence of `needle`).
/// Empty needle → `Some(len)`.
pub fn last_index_of_t<T: crate::NoUninit + Eq>(haystack: &[T], needle: &[T]) -> Option<usize> {
    match (lanes(haystack), lanes(needle)) {
        (Lanes::U8(h), Lanes::U8(n)) => last_index_of(h, n),
        (Lanes::U16(h), Lanes::U16(n)) => highway::memrmem16(h, n),
        _ => {
            if needle.len() > haystack.len() {
                return None;
            }
            (0..=haystack.len() - needle.len())
                .rev()
                .find(|&i| haystack[i..i + needle.len()] == *needle)
        }
    }
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
    let i = memmem(self_, str)?;
    debug_assert!(i < self_len);
    Some(i)
}

pub fn split<'a>(self_: &'a [u8], delimiter: &'a [u8]) -> SplitIterator<'a> {
    SplitIterator {
        buffer: self_,
        index: Some(0),
        delimiter,
    }
}

/// `str::split_once` for bytes: the text before and after the first `delimiter`.
#[inline]
pub fn split_once_char(self_: &[u8], delimiter: u8) -> Option<(&[u8], &[u8])> {
    let i = index_of_char_usize(self_, delimiter)?;
    Some((&self_[..i], &self_[i + 1..]))
}

/// `str::rsplit_once` for bytes: the text before and after the last `delimiter`.
#[inline]
pub fn rsplit_once_char(self_: &[u8], delimiter: u8) -> Option<(&[u8], &[u8])> {
    let i = last_index_of_char(self_, delimiter)?;
    Some((&self_[..i], &self_[i + 1..]))
}

/// `str::split_once` for bytes with a multi-byte delimiter. An empty
/// delimiter never matches.
#[inline]
pub fn split_once<'a>(self_: &'a [u8], delimiter: &[u8]) -> Option<(&'a [u8], &'a [u8])> {
    let i = index_of(self_, delimiter)?;
    Some((&self_[..i], &self_[i + delimiter.len()..]))
}

/// `str::rsplit_once` for bytes with a multi-byte delimiter. An empty
/// delimiter never matches.
#[inline]
pub fn rsplit_once<'a>(self_: &'a [u8], delimiter: &[u8]) -> Option<(&'a [u8], &'a [u8])> {
    if delimiter.is_empty() {
        return None;
    }
    let i = last_index_of(self_, delimiter)?;
    Some((&self_[..i], &self_[i + delimiter.len()..]))
}

pub struct SplitIterator<'a> {
    pub(crate) buffer: &'a [u8],
    pub(crate) index: Option<usize>,
    pub(crate) delimiter: &'a [u8],
}

impl<'a> SplitIterator<'a> {
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
}

impl<'a> Iterator for SplitIterator<'a> {
    type Item = &'a [u8];

    #[inline]
    fn next(&mut self) -> Option<&'a [u8]> {
        SplitIterator::next(self)
    }
}

// Concrete (not `impl Iterator`) so the borrow of the input visibly ends at
// the iterator's last use rather than at end of scope.
pub type TokenizeIterator<'a> = core::iter::Filter<SplitIterator<'a>, fn(&&'a [u8]) -> bool>;
pub type TokenizeAnyIterator<'a> = core::iter::Filter<SplitAnyIterator<'a>, fn(&&'a [u8]) -> bool>;

fn is_non_empty_field(s: &&[u8]) -> bool {
    !s.is_empty()
}

/// `std.mem.tokenizeSequence` — [`split`] without the empty fields, so runs
/// of the delimiter and leading/trailing delimiters yield nothing.
pub fn tokenize<'a>(self_: &'a [u8], delimiter: &'a [u8]) -> TokenizeIterator<'a> {
    split(self_, delimiter).filter(is_non_empty_field as fn(&&[u8]) -> bool)
}

/// `std.mem.tokenizeAny` — [`split_any`] without the empty fields.
pub fn tokenize_any<'a>(self_: &'a [u8], chars: &'a [u8]) -> TokenizeAnyIterator<'a> {
    split_any(self_, chars).filter(is_non_empty_field as fn(&&[u8]) -> bool)
}

/// `<[u8]>::split` with a multi-byte predicate — `s.split(|b| b == x || b == y)`
/// — as a highway scan: every byte that appears in `chars` is a delimiter.
pub fn split_any<'a>(self_: &'a [u8], chars: &'a [u8]) -> SplitAnyIterator<'a> {
    SplitAnyIterator {
        buffer: self_,
        index: Some(0),
        chars,
    }
}

pub struct SplitAnyIterator<'a> {
    buffer: &'a [u8],
    index: Option<usize>,
    chars: &'a [u8],
}

impl<'a> Iterator for SplitAnyIterator<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        let start = self.index?;
        let end = if let Some(i) = index_of_any(&self.buffer[start..], self.chars) {
            self.index = Some(start + i + 1);
            start + i
        } else {
            self.index = None;
            self.buffer.len()
        };
        Some(&self.buffer[start..end])
    }
}

/// `<[u8]>::rsplit` — fields of `self_` separated by `delimiter`, last to first.
pub fn rsplit<'a>(self_: &'a [u8], delimiter: &'a [u8]) -> RSplitIterator<'a> {
    RSplitIterator {
        buffer: self_,
        end: Some(self_.len()),
        delimiter,
    }
}

pub struct RSplitIterator<'a> {
    buffer: &'a [u8],
    end: Option<usize>,
    delimiter: &'a [u8],
}

impl<'a> Iterator for RSplitIterator<'a> {
    type Item = &'a [u8];

    fn next(&mut self) -> Option<&'a [u8]> {
        let end = self.end?;
        if self.delimiter.is_empty() {
            self.end = None;
            return Some(&self.buffer[..end]);
        }
        let start = if let Some(i) = last_index_of(&self.buffer[..end], self.delimiter) {
            self.end = Some(i);
            i + self.delimiter.len()
        } else {
            self.end = None;
            0
        };
        Some(&self.buffer[start..end])
    }
}

pub fn cat(first: &[u8], second: &[u8]) -> Result<Box<[u8]>, AllocError> {
    // allocator param dropped (global mimalloc).
    let mut out = Vec::with_capacity(first.len() + second.len());
    out.extend_from_slice(first);
    out.extend_from_slice(second);
    Ok(out.into_boxed_slice())
}

// 31 character string or a slice
//
// PERF NOTE: `remainder_buf` is `MaybeUninit` because `init`/`init_lower_case`
// only write `[0..len]` (or `[0..16]` for the slice case) and `slice()` only
// reads `[0..remainder_len]`. Zeroing `[0; 31]` on every call showed up as
// ~0.45% of cycles in the next-lint profile (~6M calls × ~24B avg waste).
// Tail bytes have no validity requirement, so we leave them uninit.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct StringOrTinyString {
    remainder_buf: core::mem::MaybeUninit<[u8; StringOrTinyString::MAX]>,
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
    pub(crate) const MAX: usize = 31;

    #[inline]
    pub fn slice(&self) -> &[u8] {
        let buf = self.remainder_buf.as_ptr().cast::<u8>();
        // This is a switch expression instead of a statement to make sure it uses the faster assembly
        match self.meta.is_tiny_string() {
            1 => {
                // SAFETY: init()/init_lower_case() wrote exactly remainder_len bytes
                // into the start of remainder_buf; tail bytes are uninit but unread.
                unsafe { core::slice::from_raw_parts(buf, self.meta.remainder_len() as usize) }
            }
            0 => {
                const USZ: usize = core::mem::size_of::<usize>();
                let mut ptr_bytes = [0u8; USZ];
                let mut len_bytes = [0u8; USZ];
                // SAFETY: init() wrote ptr.to_le_bytes() at [0..USZ] and len at [USZ..USZ*2].
                unsafe {
                    core::ptr::copy_nonoverlapping(buf, ptr_bytes.as_mut_ptr(), USZ);
                    core::ptr::copy_nonoverlapping(buf.add(USZ), len_bytes.as_mut_ptr(), USZ);
                }
                let ptr = usize::from_le_bytes(ptr_bytes) as *const u8;
                let len = usize::from_le_bytes(len_bytes);
                // SAFETY: ptr/len were stored from a live &[u8] in init(); caller keeps it alive.
                unsafe { core::slice::from_raw_parts(ptr, len) }
            }
            _ => unreachable!(),
        }
    }

    // plain `#[inline]` (not `#[inline(always)]`). These are tiny
    // generic delegators: a length check plus a tail call into the non-generic
    // `init`/`init_lower_case` or the `Appender` method. `#[inline]` lets the
    // small fast path fold into callers (and lets duplicate `A` instantiations
    // be ICF'd at link time / clustered by the symbol-ordering file) without
    // forcing the cold `append*` arm into every call site.
    #[inline]
    pub fn init_append_if_needed<A: Appender>(
        stringy: &[u8],
        appendy: &mut A,
    ) -> Result<StringOrTinyString, AllocError> {
        if stringy.len() <= StringOrTinyString::MAX {
            return Ok(StringOrTinyString::init(stringy));
        }
        Ok(StringOrTinyString::init(appendy.append(stringy)?))
    }

    pub fn init(stringy: &[u8]) -> StringOrTinyString {
        let mut buf = core::mem::MaybeUninit::<[u8; Self::MAX]>::uninit();
        match stringy.len() {
            0 => StringOrTinyString {
                remainder_buf: buf,
                meta: StringOrTinyStringMeta::new(0, 1),
            },
            1..=Self::MAX => {
                // SAFETY: stringy.len() ∈ 1..=31, fits in buf; src/dst can't overlap (dst is local).
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        stringy.as_ptr(),
                        buf.as_mut_ptr().cast::<u8>(),
                        stringy.len(),
                    );
                }
                StringOrTinyString {
                    remainder_buf: buf,
                    meta: StringOrTinyStringMeta::new(stringy.len() as u8, 1),
                }
            }
            _ => {
                const USZ: usize = core::mem::size_of::<usize>();
                let dst = buf.as_mut_ptr().cast::<u8>();
                // SAFETY: 2*USZ <= 16 <= 31 == MAX; src/dst don't overlap.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        (stringy.as_ptr() as usize).to_le_bytes().as_ptr(),
                        dst,
                        USZ,
                    );
                    core::ptr::copy_nonoverlapping(
                        stringy.len().to_le_bytes().as_ptr(),
                        dst.add(USZ),
                        USZ,
                    );
                }
                StringOrTinyString {
                    remainder_buf: buf,
                    meta: StringOrTinyStringMeta::new(0, 0),
                }
            }
        }
    }
}

/// Trait for the `Appender` parameter on `StringOrTinyString::init*_append_if_needed`.
pub trait Appender {
    fn append(&mut self, s: &[u8]) -> Result<&[u8], AllocError>;
    fn append_lower_case(&mut self, s: &[u8]) -> Result<&[u8], AllocError>;
}

pub use crate::strings_impl::{ascii_lowercase_buf, copy_lowercase};

/// Single-pass `copy_lowercase` that avoids the copy when `in_` has no ASCII
/// uppercase byte: returns `in_` unchanged and leaves `out` UNTOUCHED.
/// Otherwise writes the lowercased bytes into `out[..in_.len()]` and returns
/// that prefix. Both borrows share `'a` so the return may alias either.
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

/// Strips the `file:` scheme from an absolute file URL: `file:///p` and
/// `file:/p` both give `/p` (WHATWG). No percent-decoding.
pub fn strip_file_url_prefix(self_: &[u8]) -> &[u8] {
    let rest = if let Some(rest) = self_.strip_prefix(b"file://".as_slice()) {
        rest
    } else if self_.starts_with(b"file:/") {
        &self_[b"file:".len()..]
    } else {
        return self_;
    };
    // A drive-letter URL serializes as `file:///C:/x`. Drop the slash before
    // the drive letter so the result is a native absolute path.
    #[cfg(windows)]
    if rest.len() >= 3 && rest[0] == b'/' && rest[1].is_ascii_alphabetic() && rest[2] == b':' {
        return &rest[1..];
    }
    rest
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
    self_.len() >= prefix.len()
        && eql_case_insensitive_ascii(&self_[0..prefix.len()], prefix, false)
}

pub use crate::strings_impl::{
    has_prefix_t, has_prefix_t as starts_with_generic, has_suffix_t,
    has_suffix_t as ends_with_generic,
};

#[inline]
pub fn ends_with(self_: &[u8], str: &[u8]) -> bool {
    str.is_empty() || self_.ends_with(str)
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

pub fn eql_any_comptime(self_: &[u8], list: &'static [&'static [u8]]) -> bool {
    for item in list {
        if eql_comptime_check_len_with_type::<u8, true>(self_, item) {
            return true;
        }
    }
    false
}

/// Count the occurrences of a character in an ASCII byte array
/// uses SIMD
#[inline]
pub fn count_char(self_: &[u8], char: u8) -> usize {
    highway::count_char(self_, char)
}

/// `std.mem.count` — number of non-overlapping occurrences of `needle`.
/// An empty needle counts as zero occurrences.
pub fn count(self_: &[u8], needle: &[u8]) -> usize {
    match needle.len() {
        0 => 0,
        1 => count_char(self_, needle[0]),
        n => {
            let mut total = 0usize;
            let mut rest = self_;
            while let Some(i) = memmem(rest, needle) {
                total += 1;
                rest = &rest[i + n..];
            }
            total
        }
    }
}

pub fn eql(self_: &[u8], other: &[u8]) -> bool {
    if self_.len() != other.len() {
        return false;
    }
    eql_long(self_, other, false)
}

pub fn eql_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    eql_comptime_check_len_with_type::<u8, true>(self_, alt)
}

pub fn eql_comptime_utf16(self_: &[u16], alt: &[u8]) -> bool {
    // Compare bytewise, widening each ASCII byte of `alt` on the fly — avoids
    // materializing (and leaking) a `&'static [u16]`. All call sites pass
    // ASCII literals.
    debug_assert!(alt.iter().all(|&b| b < 0x80));
    self_.len() == alt.len()
        && self_
            .iter()
            .zip(alt.iter())
            .all(|(&u, &b)| u == u16::from(b))
}

pub fn eql_comptime_ignore_len(self_: &[u8], alt: &[u8]) -> bool {
    eql_comptime_check_len_with_type::<u8, false>(self_, alt)
}

// `const fn` equality for const-context callers (clap param-name lookup,
// MultiArrayList field-name reflection). Runtime callers should prefer `eql`.
pub use crate::strings_impl::{const_bytes_eq, const_str_eq};

pub fn has_prefix_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len()
        && eql_comptime_check_len_with_type::<u8, false>(&self_[0..alt.len()], alt)
}

pub fn has_prefix_comptime_utf16(self_: &[u16], alt: &'static [u8]) -> bool {
    debug_assert!(alt.iter().all(|&b| b < 0x80));
    self_.len() >= alt.len()
        && self_[..alt.len()]
            .iter()
            .zip(alt.iter())
            .all(|(&u, &b)| u == u16::from(b))
}

pub fn has_prefix_comptime_type<T: crate::NoUninit + Eq>(self_: &[T], alt: &'static [T]) -> bool {
    // Callers must pass the correctly-typed literal (use `crate::string::w!` for u16).
    self_.len() >= alt.len()
        && eql_comptime_check_len_with_type::<T, false>(&self_[0..alt.len()], alt)
}

pub fn has_suffix_comptime(self_: &[u8], alt: &'static [u8]) -> bool {
    self_.len() >= alt.len()
        && eql_comptime_check_len_with_type::<u8, false>(&self_[self_.len() - alt.len()..], alt)
}

fn eql_comptime_check_len_u8(a: &[u8], b: &[u8], check_len: bool) -> bool {
    // Slice equality compiles to memcmp; for short literals LLVM emits
    // unrolled fixed-size compares.
    if check_len {
        return a == b;
    }
    debug_assert!(a.len() >= b.len());
    // SAFETY: when `check_len`, the early-return above gives `a.len()==b.len()`.
    // When `!check_len`, callers guarantee `a.len() >= b.len()` (debug-asserted
    // above). LLVM cannot prove the latter, so
    // a checked slice would emit a real bounds check on this hot path
    // (lexer keyword/prefix matching) — keep the unchecked index.
    unsafe { a.get_unchecked(..b.len()) == b }
}

fn eql_comptime_check_len_with_known_type<T: crate::NoUninit + Eq, const CHECK_LEN: bool>(
    a: &[T],
    b: &[T],
) -> bool {
    if core::mem::size_of::<T>() != 1 {
        return eql_comptime_check_len_u8(reinterpret_to_u8(a), reinterpret_to_u8(b), CHECK_LEN);
    }
    // T is u8-sized.
    eql_comptime_check_len_u8(reinterpret_to_u8(a), reinterpret_to_u8(b), CHECK_LEN)
}

/// Check if two strings are equal with one of the strings being a compile-time-known value
///
///   strings.eql_comptime(input, b"hello world");
///   strings.eql_comptime(input, b"hai");
pub(crate) fn eql_comptime_check_len_with_type<T: crate::NoUninit + Eq, const CHECK_LEN: bool>(
    a: &[T],
    b: &[T],
) -> bool {
    // Accepts any slice; callers are still expected to pass literals.
    eql_comptime_check_len_with_known_type::<T, CHECK_LEN>(a, b)
}

pub fn eql_case_insensitive_ascii_ignore_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii(a, b, false)
}

pub use crate::strings_impl::{
    eql_any_case_insensitive_ascii, eql_case_insensitive_ascii_check_length,
};

/// The triple-`i` typo spelling is kept deliberately; both spellings are
/// reachable from existing call sites until the next typo sweep.
#[inline]
pub fn eql_case_insensitive_asciii_check_length(a: &[u8], b: &[u8]) -> bool {
    eql_case_insensitive_ascii(a, b, true)
}

// The libc `strncasecmp`-backed implementation lives in tier-0
// `crate::strings_impl` (so `contains_case_insensitive_ascii` and friends can
// reach it). `check_len` is a runtime 3rd arg because that's the dominant
// call shape across the tree (`eql_case_insensitive_ascii(a, b, true)`);
// callers wanting the length-agnostic forms have the `_check_length` /
// `_ignore_length` wrappers above.
pub use crate::strings_impl::{contains_case_insensitive_ascii, eql_case_insensitive_ascii};

pub fn eql_case_insensitive_t<T: crate::NoUninit + Into<u32>>(a: &[T], b: &[u8]) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    if core::mem::size_of::<T>() == 1 {
        return eql_case_insensitive_ascii_ignore_length(reinterpret_to_u8(a), b);
    }

    debug_assert_eq!(a.len(), b.len());
    for (c, &d) in a.iter().zip(b) {
        let c: u32 = (*c).into();
        let d = u32::from(d);
        if (u32::from(b'a')..=u32::from(b'z')).contains(&c) {
            if c != d && c & 0b1101_1111 != d {
                return false;
            }
        } else if (u32::from(b'A')..=u32::from(b'Z')).contains(&c) {
            if c != d && c | 0b0010_0000 != d {
                return false;
            }
        } else if c != d {
            return false;
        }
    }

    true
}

pub(crate) fn has_prefix_case_insensitive_t<T: crate::NoUninit + Into<u32>>(
    str: &[T],
    prefix: &[u8],
) -> bool {
    if str.len() < prefix.len() {
        return false;
    }
    eql_case_insensitive_t(&str[0..prefix.len()], prefix)
}

pub fn has_prefix_case_insensitive(str: &[u8], prefix: &[u8]) -> bool {
    has_prefix_case_insensitive_t(str, prefix)
}

// same rationale as `eql_case_insensitive_ascii` — `check_len` is a runtime
// 3rd arg to match the dominant call shape (`eql_long(a, b, true)`).
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

    // SAFETY: a_str.len() >= b_str.len() by contract above (checked when
    // `check_len`, debug-asserted otherwise), so the word-chunked raw-pointer
    // walk below never reads past either slice.
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
                if a.cast::<usize>().read_unaligned() != b.cast::<usize>().read_unaligned() {
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
                if a.cast::<u32>().read_unaligned() != b.cast::<u32>().read_unaligned() {
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
            if a.cast::<u16>().read_unaligned() != b.cast::<u16>().read_unaligned() {
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
pub fn append(self_: &[u8], other: &[u8]) -> Box<[u8]> {
    let mut buf = Vec::with_capacity(self_.len() + other.len());
    buf.extend_from_slice(self_);
    buf.extend_from_slice(other);
    buf.into_boxed_slice()
}

#[inline]
pub fn concat_buf_t<'a, T: Copy>(out: &'a mut [T], strs: &[&[T]]) -> Result<&'a mut [T], Error> {
    let mut off: usize = 0;
    for s in strs {
        if s.len() > out.len() - off {
            return Err(crate::CrateError::NoSpaceLeft);
        }
        out[off..off + s.len()].copy_from_slice(s);
        off += s.len();
    }
    Ok(&mut out[0..off])
}

/// Returns a substring starting at `start` up to the end of the string.
/// If `start` is greater than the string's length, returns an empty string.
pub fn substring(self_: &[u8], start: Option<usize>, stop: Option<usize>) -> &[u8] {
    let sta = start.unwrap_or(0);
    let sto = stop.unwrap_or(self_.len());
    &self_[sta.min(self_.len())..sto.min(self_.len())]
}

// (UTF16Replacement / utf16_codepoint{,_with_fffd} — deleted; re-exported from unicode_draft above)

/// `w!("foo")` → `&'static [u16]` UTF-16 literal (ASCII-only). `bun.w`.
#[macro_export]
macro_rules! w {
    ($s:literal) => {{
        const __B: &[u8] = $s.as_bytes();
        const __N: usize = __B.len();
        const __W: [u16; __N] = {
            let mut out = [0u16; __N];
            let mut i = 0;
            while i < __N {
                // Const-evaluated: a non-ASCII byte is a hard compile error in
                // every profile.
                assert!(__B[i] < 0x80, "w! is ASCII-only");
                out[i] = __B[i] as u16;
                i += 1;
            }
            out
        };
        &__W as &'static [u16]
    }};
}

/// Index of the first non-ASCII byte in `slice`, or `None` if all-ASCII.
/// Thin `u32` view over the simdutf-backed [`first_non_ascii_usize`].
#[inline]
pub fn first_non_ascii(slice: &[u8]) -> Option<u32> {
    first_non_ascii_usize(slice).map(|i| i as u32)
}
pub(crate) use crate::strings_impl::first_non_ascii_usize;

/// `bun.strings.isValidUTF8` — SIMD-validated UTF-8 check.
/// Wraps `simdutf::validate::utf8`; the gated `unicode_draft` adds a
/// `bun.FeatureFlags.use_simdutf` toggle + scalar fallback.
#[inline]
pub fn is_valid_utf8(slice: &[u8]) -> bool {
    simdutf::validate::utf8(slice)
}

/// SIMD-validated `&str` view of `bytes`; `None` if not valid UTF-8.
///
/// This is the codebase-wide replacement for `core::str::from_utf8` — every
/// runtime UTF-8 validation goes through simdutf (~3-10× faster than std's
/// scalar DFA on AVX2/NEON). NOT `const`: the one allowed exception is
/// `crate::env::const_str_slice` (compile-time git-SHA slicing), which is
/// the only place `core::str::from_utf8` may appear.
#[inline]
pub fn str_utf8(bytes: &[u8]) -> Option<&str> {
    if simdutf::validate::utf8(bytes) {
        // SAFETY: simdutf just validated `bytes` as well-formed UTF-8.
        Some(unsafe { core::str::from_utf8_unchecked(bytes) })
    } else {
        None
    }
}

pub use index_of_newline_or_non_ascii as index_of_newline_or_non_ascii_or_ansi;

/// Checks if slice[offset..] has any < 0x20 or > 127 characters
// PERF: `#[inline]` — this is the predicate of the source-map column-tracking
// fast path (`Chunk.rs::update_generated_line_and_column`) and the per-rune
// fast-forward inside its slow loop; it's also the LineOffsetTable scan step.
// Without the hint LLVM emits a cross-crate `call` (the body is a couple of
// branches plus a tail-call into the SIMD `highway` routine), so the
// `is_none()` fast path doesn't fold into the caller. Same rationale as
// `str_utf8` above.
#[inline]
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
    // Wrapping cast instead of try_from().unwrap(), which would panic on
    // >4GB inputs.
    Some(i as u32 + offset)
}

#[inline]
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
    // Wrapping cast instead of try_from().unwrap(), which would panic on
    // >4GB inputs.
    Some(i as u32 + offset)
}

pub use highway::contains_newline_or_non_ascii_or_quote;

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

pub(crate) fn index_of_needs_url_encode(slice: &[u8]) -> Option<u32> {
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

    // PERF: scalar loop; consider portable_simd or a highway entry point if hot.
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
            // Wrapping cast.
            return Some(i as u32);
        }
    }

    None
}

pub fn index_of_char_z(slice_z: &crate::string::ZStr, char: u8) -> Option<u64> {
    highway::index_of_char(slice_z.as_bytes(), char).map(|i| i as u64)
}

pub fn index_of_char(slice: &[u8], char: u8) -> Option<u32> {
    // Wrapping cast.
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

pub fn index_of_not_char(slice: &[u8], char: u8) -> Option<u32> {
    if slice.is_empty() {
        return None;
    }

    if slice[0] != char {
        return Some(0);
    }

    // Wrapping cast.
    highway::index_of_not_char(slice, char).map(|i| i as u32)
}

use crate::fmt::{HEX_DECODE_TABLE as HEX_TABLE, HEX_INVALID as INVALID_CHAR};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum DecodeHexError {
    #[error("InvalidByteSequence")]
    InvalidByteSequence,
}

/// Source character types accepted by the hex decoder: `u8` (Latin-1) and
/// `u16` (UTF-16). The associated function routes full pairs through the
/// matching Highway kernel while `_decode_hex_to_bytes` keeps the generic
/// scalar path for short inputs.
///
/// A UTF-16 code unit is classified by its low byte, which is what Node's
/// `Buffer` hex decoder does (`Buffer.from("\uff41", "hex")` sees `'A'`):
/// a unit above 0xFF decodes when its low byte is a hex digit and stops the
/// decode when it is not. The Highway kernels apply the same narrowing.
pub trait HexChar: Copy {
    /// The byte the decoder classifies and looks up in `HEX_TABLE`.
    fn hex_byte(self) -> u8;

    /// Decode up to `min(src.len() / 2, dst.len())` hex pairs with SIMD,
    /// stopping at the first pair containing a non-hex character.
    /// Returns the number of bytes written.
    fn decode_hex_highway(src: &[Self], dst: &mut [u8]) -> usize;
}

impl HexChar for u8 {
    #[inline(always)]
    fn hex_byte(self) -> u8 {
        self
    }

    #[inline(always)]
    fn decode_hex_highway(src: &[Self], dst: &mut [u8]) -> usize {
        highway::decode_hex(src, dst)
    }
}

impl HexChar for u16 {
    #[inline(always)]
    fn hex_byte(self) -> u8 {
        self as u8
    }

    #[inline(always)]
    fn decode_hex_highway(src: &[Self], dst: &mut [u8]) -> usize {
        highway::decode_hex_u16(src, dst)
    }
}

pub fn decode_hex_to_bytes<Char: HexChar>(
    destination: &mut [u8],
    source: &[Char],
) -> Result<usize, DecodeHexError> {
    _decode_hex_to_bytes::<Char, false>(destination, source)
}

pub fn decode_hex_to_bytes_truncate<Char: HexChar>(
    destination: &mut [u8],
    source: &[Char],
) -> usize {
    _decode_hex_to_bytes::<Char, true>(destination, source).unwrap_or(0)
}

#[inline]
fn _decode_hex_to_bytes<Char: HexChar, const TRUNCATE: bool>(
    destination: &mut [u8],
    source: &[Char],
) -> Result<usize, DecodeHexError> {
    // Highway fast path: decode whole pairs in bulk, stopping at the first
    // invalid pair — the same semantics as the scalar loop below. Short inputs
    // stay scalar; the dynamically-dispatched FFI call isn't worth it for a
    // handful of pairs.
    const HIGHWAY_MIN_PAIRS: usize = 16;
    let pairs = destination.len().min(source.len() / 2);
    if pairs >= HIGHWAY_MIN_PAIRS {
        let written = Char::decode_hex_highway(&source[..pairs * 2], &mut destination[..pairs]);
        if written < pairs {
            // Stopped at an invalid character.
            if TRUNCATE {
                return Ok(written);
            }
            return Err(DecodeHexError::InvalidByteSequence);
        }
        if !TRUNCATE && destination.len() > pairs && source.len() > pairs * 2 {
            // Destination space left over with a trailing lone hex digit
            // (mirrors the `!remain.is_empty() && !input.is_empty()` check below).
            return Err(DecodeHexError::InvalidByteSequence);
        }
        return Ok(pairs);
    }

    let dest_len = destination.len();
    let mut remain = &mut destination[..];
    let mut input = source;

    while !remain.is_empty() && input.len() > 1 {
        let a = HEX_TABLE[input[0].hex_byte() as usize];
        let b = HEX_TABLE[input[1].hex_byte() as usize];
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

pub fn encode_bytes_to_hex(destination: &mut [u8], source: &[u8]) -> usize {
    debug_assert!(!destination.is_empty());
    debug_assert!(!source.is_empty());
    let to_write = if destination.len() < source.len() * 2 {
        destination.len() - destination.len() % 2
    } else {
        source.len() * 2
    };

    let to_read = to_write / 2;

    // Runtime-dispatched SIMD kernel for bulk encodes (Buffer.toString("hex"));
    // the scalar LUT loop wins below this size because of the dispatch overhead.
    const HIGHWAY_MIN_LEN: usize = 64;
    if to_read >= HIGHWAY_MIN_LEN {
        highway::encode_hex_lower(&source[..to_read], &mut destination[..to_write]);
        return to_write;
    }

    crate::fmt::bytes_to_hex_lower(&source[..to_read], &mut destination[..to_write])
}

/// Leave a single leading char
/// ```text
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
pub fn trim_prefix_comptime<'a, T: crate::NoUninit + Eq>(
    buffer: &'a [T],
    prefix: &'static [T],
) -> &'a [T] {
    if has_prefix_comptime_type(buffer, prefix) {
        &buffer[prefix.len()..]
    } else {
        buffer
    }
}

/// Runtime variants — prefix/suffix may borrow from a non-static
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
    pub(crate) start: u32,
    pub(crate) end: u32,
}

pub(crate) fn index_of_line_ranges<const LINE_RANGE_COUNT: usize>(
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
            let _ = ranges.push(LineRange {
                start: 0,
                // Wrapping cast.
                end: text.len() as u32,
            }); // OOM/capacity: fire-and-forget
        }
        return ranges;
    };

    let iter = CodepointIterator::init(text);
    let mut cursor = unicode::Cursor {
        i: first_newline_or_nonascii_i,
        ..Default::default()
    };
    const NL: i32 = b'\n' as i32;
    const CR: i32 = b'\r' as i32;
    let first_newline_range: LineRange = 'brk: {
        while iter.next(&mut cursor) {
            match cursor.c {
                NL => {
                    current_line += 1;
                    break 'brk LineRange {
                        start: 0,
                        end: cursor.i,
                    };
                }
                CR => {
                    if iter.next(&mut cursor) && cursor.c == NL {
                        current_line += 1;
                        break 'brk LineRange {
                            start: 0,
                            end: cursor.i,
                        };
                    }
                }
                _ => {}
            }
        }
        let _ = ranges.push(LineRange {
            start: 0,
            // Wrapping cast.
            end: text.len() as u32,
        });
        return ranges;
    };

    let _ = ranges.push(first_newline_range); // OOM/capacity: fire-and-forget

    if target_line == 0 {
        return ranges;
    }

    let mut prev_end = first_newline_range.end;
    while let Some(current_i) =
        index_of_newline_or_non_ascii_check_start::<true>(text, cursor.i + u32::from(cursor.width))
    {
        cursor.i = current_i;
        cursor.width = 0;
        let advanced = iter.next(&mut cursor);
        debug_assert!(advanced);
        let current_line_range: LineRange = match cursor.c {
            NL => {
                let start = prev_end;
                prev_end = cursor.i;
                LineRange {
                    start,
                    end: cursor.i + 1,
                }
            }
            CR => {
                let current_end = cursor.i;
                if iter.next(&mut cursor) && cursor.c == NL {
                    let r = LineRange {
                        start: prev_end,
                        end: current_end,
                    };
                    prev_end = cursor.i;
                    r
                } else {
                    LineRange {
                        start: prev_end,
                        end: cursor.i + 1,
                    }
                }
            }
            _ => continue,
        };

        if ranges.len() == LINE_RANGE_COUNT && current_line <= target_line {
            let mut new_ranges = BoundedArray::<LineRange, LINE_RANGE_COUNT>::default();
            let _ = new_ranges.extend_from_slice(&ranges.as_slice()[1..]); // OOM/capacity: fire-and-forget
            ranges = new_ranges;
        }
        let _ = ranges.push(current_line_range); // OOM/capacity: fire-and-forget

        if current_line >= target_line {
            return ranges;
        }

        current_line += 1;
    }

    if ranges.len() == LINE_RANGE_COUNT && current_line <= target_line {
        let mut new_ranges = BoundedArray::<LineRange, LINE_RANGE_COUNT>::default();
        let _ = new_ranges.extend_from_slice(&ranges.as_slice()[1..]); // OOM/capacity: fire-and-forget
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
        let _ = results.push(&text[range.start as usize..range.end as usize]); // OOM/capacity: fire-and-forget
    }
    results.as_mut_slice().reverse();
    Some(results)
}

pub fn first_non_ascii16(slice: &[u16]) -> Option<u32> {
    // PERF: scalar loop; consider portable_simd or a simdutf utf16 validator if hot.
    for (i, &char) in slice.iter().enumerate() {
        if char > 127 {
            // Wrapping cast.
            return Some(i as u32);
        }
    }
    None
}

pub use crate::strings_impl::trim;

pub fn is_all_whitespace(slice: &[u8]) -> bool {
    let mut begin: usize = 0;
    while begin < slice.len() && WHITESPACE_CHARS.contains(&slice[begin]) {
        begin += 1;
    }
    begin == slice.len()
}

pub const WHITESPACE_CHARS: [u8; 6] = [
    b' ', b'\t', b'\n', b'\r', 0x0B, /* VT */
    0x0C, /* FF */
];

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

// ── Lexicographic slice ordering ──────────────────────────────────────────
// Canonical home for lexicographic slice ordering; exactly one copy of each
// shape lives here.

/// Lexicographic byte-slice ordering (memcmp fast path).
/// Semantically identical to `<[u8] as Ord>::cmp`.
///
/// Delegates to `<[u8] as Ord>::cmp` rather than an extern `libc::memcmp` call:
/// the std specialisation lowers to the `memcmp` LLVM builtin, so LLVM can
/// inline the short-string fast path and skip the PLT trampoline.
/// `#[inline(always)]` because this
/// sits inside `sort_unstable_by` comparators on the install hot path.
#[inline(always)]
pub fn order(a: &[u8], b: &[u8]) -> Ordering {
    a.cmp(b)
}

/// Generic lexicographic slice ordering.
/// For `T = u8` prefer [`order`] (memcmp fast path).
#[inline]
pub fn order_t<T: Ord>(a: &[T], b: &[T]) -> Ordering {
    a.cmp(b)
}

pub fn cmp_strings_asc(_: (), a: &[u8], b: &[u8]) -> bool {
    order(a, b) == Ordering::Less
}

/// `u8` rather than a narrower 3-bit integer type: masking off the extra bits
/// on every read is a meaningful performance difference, including in release
/// builds.
pub type U3Fast = u8;

pub fn sort_asc(in_: &mut [&[u8]]) {
    // Perf: a SIMD comparator might be faster here; never measured.
    in_.sort_unstable_by(|a, b| order(a, b));
}

pub fn sort_desc(in_: &mut [&[u8]]) {
    // Perf: a SIMD comparator might be faster here; never measured.
    in_.sort_unstable_by(|a, b| order(b, a));
}

#[inline]
pub fn to_ascii_hex_value(character: u8) -> u8 {
    // Precondition-based (no Option).
    debug_assert!(character.is_ascii_hexdigit());
    crate::fmt::hex_digit_value(character).expect("ascii hex digit")
}

pub use exact_size_matcher::ExactSizeMatcher;

pub const UNICODE_REPLACEMENT: u32 = 0xFFFD;

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

        let cp = decode_wtf8_rune_t::<i32>(bytes, wtf8_byte_sequence_length(next[0]), -1);
        if cp < 0 || !crate::string::lexer::is_identifier_continue(cp as u32) {
            return true;
        }
    }

    false
}

pub fn concat_with_length(args: &[&[u8]], length: usize) -> Box<[u8]> {
    let mut out = vec![0u8; length].into_boxed_slice();
    let mut off: usize = 0;
    for arg in args {
        out[off..off + arg.len()].copy_from_slice(arg);
        off += arg.len();
    }
    debug_assert!(off == length); // all bytes should be used
    out
}

pub fn concat(args: &[&[u8]]) -> Box<[u8]> {
    let mut length: usize = 0;
    for arg in args {
        length += arg.len();
    }
    concat_with_length(args, length)
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
    pub json: bool,
    pub str_encoding: Encoding,
}

impl Default for QuoteEscapeFormatFlags {
    fn default() -> Self {
        Self {
            quote_char: b'"',
            json: false,
            str_encoding: Encoding::Utf8,
        }
    }
}

/// usage: print(" string: '{}' ", format_escapes_js("hello'world!"));
// PERF: `flags` is a runtime value (not monomorphized) — profile if hot.
pub fn format_escapes(str: &[u8], flags: QuoteEscapeFormatFlags) -> QuoteEscapeFormat<'_> {
    QuoteEscapeFormat { data: str, flags }
}

pub struct QuoteEscapeFormat<'a> {
    pub(crate) data: &'a [u8],
    pub(crate) flags: QuoteEscapeFormatFlags,
}

impl core::fmt::Display for QuoteEscapeFormat<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // PERF: buffer through
        // a Vec so `write_pre_quoted_string`'s `PrinterWriter` bound is met
        // without an adapter for `core::fmt::Formatter`. Profile if hot.
        let mut buf: Vec<u8> = Vec::with_capacity(self.data.len() + 8);
        crate::string::printer::write_pre_quoted_string(
            self.data,
            &mut buf,
            self.flags.quote_char,
            false, // ascii_only
            self.flags.json,
            self.flags.str_encoding,
        )
        .map_err(|_| core::fmt::Error)?;
        // SAFETY: write_pre_quoted_string emits UTF-8 (escapes + ASCII + WTF-8).
        f.write_str(unsafe { core::str::from_utf8_unchecked(&buf) })
    }
}

/// Width-generic [`index_of_char_usize`].
#[inline]
pub fn index_of_scalar<T: crate::NoUninit + Eq>(input: &[T], scalar: T) -> Option<usize> {
    match (lanes(input), lanes(core::slice::from_ref(&scalar))) {
        (Lanes::U8(s), Lanes::U8(c)) => index_of_char_usize(s, c[0]),
        (Lanes::U16(s), Lanes::U16(c)) => highway::memmem16(s, c),
        _ => input.iter().position(|c| *c == scalar),
    }
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

pub fn without_prefix_comptime_z<'a>(
    input: &'a crate::string::ZStr,
    prefix: &'static [u8],
) -> &'a crate::string::ZStr {
    if has_prefix_comptime(input.as_bytes(), prefix) {
        // `as_bytes_with_nul()[prefix.len()..]` keeps the trailing NUL at
        // index `input.len() - prefix.len()` of the sub-slice; `from_buf`
        // debug-asserts it.
        return crate::string::ZStr::from_buf(
            &input.as_bytes_with_nul()[prefix.len()..],
            input.len() - prefix.len(),
        );
    }
    input
}

pub fn without_prefix_if_possible_comptime<'a>(
    input: &'a [u8],
    prefix: &'static [u8],
) -> Option<&'a [u8]> {
    if has_prefix_comptime(input, prefix) {
        return Some(&input[prefix.len()..]);
    }
    None
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
            crate::hint::cold();
            return Err(PercentEncodeError::IncompleteUTF8);
        }

        let to_encode = &remaining[0..code_point_len];
        remaining = &remaining[code_point_len..];

        writer.reserve(safe.len() + b"%FF".len() * code_point_len);

        // Write the safe bytes
        writer.extend_from_slice(safe);

        // URL encode the code point
        for &byte in to_encode {
            let h = crate::fmt::hex2_lower(byte);
            writer.extend_from_slice(&[b'%', h[0], h[1]]);
        }
    }

    // Write the rest of the string
    writer.extend_from_slice(remaining);
    Ok(())
}

// ───────────── re-exports from sibling modules ─────────────

// Unicode core is re-exported at the top of the file. Further transcoding
// helpers (unicode_draft) and path helpers (bun_paths) are re-exported on
// demand as callers need them — see the `crate::strings_impl` re-export block below.
pub use crate::string::escape_reg_exp::{escape_reg_exp, escape_reg_exp_for_package_name_matching};

crate::declare_scope!(STR, hidden);
// `log` is `bun.Output.scoped(.STR, .hidden)` — use `crate::scoped_log!(STR, ...)`.

pub type CodePoint = i32;

/// ASCII hex-digit test for code-point–width inputs (`i32` [`CodePoint`],
/// `u16`, `u32`). Out-of-`u8`-range or negative values return `false`.
/// For plain `u8`, call [`u8::is_ascii_hexdigit`] directly instead.
#[inline]
pub fn is_hex_code_point<T: TryInto<u8>>(cp: T) -> bool {
    cp.try_into().is_ok_and(|b: u8| b.is_ascii_hexdigit())
}

/// Unicode `Zs` (Space_Separator) general category — the exact 17-codepoint
/// set, stable since Unicode 4.0. Shared core of:
///   - ECMAScript `WhiteSpace` (js_parser::lexer)
///   - CommonMark §2.1 "Unicode whitespace" (md::helpers)
/// Callers compose with their own ASCII / U+FEFF / line-terminator extras —
/// those differ per spec and MUST NOT be folded in here (FEFF is Cf, not Zs;
/// 2028/2029 are Zl/Zp).
#[inline]
pub const fn is_unicode_space_separator(cp: u32) -> bool {
    matches!(
        cp,
        0x0020          // SPACE
        | 0x00A0        // NO-BREAK SPACE
        | 0x1680        // OGHAM SPACE MARK
        | 0x2000
            ..=0x200A // EN QUAD..HAIR SPACE
        | 0x202F        // NARROW NO-BREAK SPACE
        | 0x205F        // MEDIUM MATHEMATICAL SPACE
        | 0x3000 // IDEOGRAPHIC SPACE
    )
}

/// SIMD-accelerated iterator that yields slices of text between ANSI escape sequences.
/// The C++ side uses ANSI::findEscapeCharacter (SIMD) and ANSI::consumeANSI.
#[repr(C)]
pub struct ANSIIterator {
    pub(crate) input: *const u8,
    pub(crate) input_len: usize,
    pub(crate) cursor: usize,
    pub(crate) slice_ptr: *const u8,
    pub(crate) slice_len: usize,
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
        if Bun__ANSI__next(self) {
            if self.slice_ptr.is_null() {
                return None;
            }
            // SAFETY: slice_ptr/slice_len point into the input buffer per C++ contract.
            return Some(unsafe { core::slice::from_raw_parts(self.slice_ptr, self.slice_len) });
        }
        None
    }
}

unsafe extern "C" {
    // `&mut ANSIIterator` is ABI-identical to the C++ `ANSIIterator*` (thin
    // non-null pointer to a `#[repr(C)]` POD struct); C++ reads `input`/
    // `input_len`/`cursor` and writes `cursor`/`slice_ptr`/`slice_len`. The
    // `&mut` encodes the only pointer-validity precondition, so `safe fn`
    // discharges the link-time proof and callers need no `unsafe`.
    safe fn Bun__ANSI__next(it: &mut ANSIIterator) -> bool;
}

// Transcoding allocators live in T0 `crate::strings_impl` so collections can
// reach them without a same-tier cycle. Re-export here for callers that go
// through `bun_core::strings`.
pub use crate::strings_impl::{
    allocate_latin1_into_utf8_with_list, convert_utf16_to_utf8, convert_utf16_to_utf8_append,
    encode_wtf8_rune, is_all_ascii, latin1_to_codepoint_bytes_assume_not_ascii, narrow_ascii_u16,
    to_utf8_alloc, to_utf8_alloc_from_le_bytes, to_utf8_append_to_list, to_utf8_from_latin1,
};

#[inline]
pub fn to_utf8_alloc_with_type(utf16: &[u16]) -> Vec<u8> {
    crate::strings_impl::to_utf8_alloc(utf16)
}

// ───────────── minimal real impls of submodule fns ─────────────
// These mirror the same-named fns in `unicode_draft` so dependents can link
// against `bun_core::strings::*` directly. Each is a thin wrapper over simdutf
// or a scalar fallback.

pub use crate::strings_impl::utf8_byte_sequence_length;

/// Strip leading chars in `values_to_strip`.
pub use crate::strings_impl::trim_left;

/// Strip trailing chars in `values_to_strip`.
pub use crate::strings_impl::trim_right;

pub use crate::strings_impl::{replace, replace_owned, replacement_size};

// Defined in crate::fmt; re-exported here for back-compat.
pub use crate::fmt::{ParseIntError, parse_int};

/// Compare a UTF-16 string against a UTF-8 string without allocating.
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
        // `decode_wtf16_raw` avoids the `|`-precedence bug of the old
        // open-coded math, which mis-decoded supplementary code points >= U+20000.
        let (cp, adv) = crate::strings_impl::decode_wtf16_raw(&text[i..]);
        i += adv as usize;
        let width = encode_wtf8_rune(&mut temp, cp);
        if j + width > str.len() {
            return false;
        }
        if temp[..width] != str[j..j + width] {
            return false;
        }
        j += width;
    }
    j == str.len()
}

/// `strings.toUTF16AllocForReal` — like [`to_utf16_alloc`] but **always**
/// returns a `Vec<u16>` (pure-ASCII inputs are widened 1:1 instead of
/// returning `None`).
pub fn to_utf16_alloc_for_real(
    bytes: &[u8],
    fail_if_invalid: bool,
    sentinel: bool,
) -> Result<Vec<u16>, ToUTF16Error> {
    if let Some(v) = to_utf16_alloc(bytes, fail_if_invalid, sentinel)? {
        return Ok(v);
    }
    // All-ASCII path: widen each byte.
    let mut out: Vec<u16> = Vec::new();
    out.try_reserve_exact(bytes.len() + sentinel as usize)
        .map_err(|_| ToUTF16Error::OutOfMemory)?;
    out.extend(bytes.iter().map(|&b| u16::from(b)));
    if sentinel {
        out.push(0);
    }
    Ok(out)
}

/// Strip `prefix` from `input` if present.
/// Unlike `without_prefix_comptime`, this accepts a non-`'static` prefix.
#[inline]
pub fn without_prefix<'a>(input: &'a [u8], prefix: &[u8]) -> &'a [u8] {
    if has_prefix(input, prefix) {
        &input[prefix.len()..]
    } else {
        input
    }
}

// The full `paths` submodule lives in
// `bun_paths::string_paths` (it depends upward on `bun_paths` resolve/pool
// helpers and would cycle here). Callers reach the Windows path-shape
// helpers (`to_nt_path` / `to_kernel32_path` / `from_w_path` / …) via
// `bun_paths::strings::*`; this module re-exports only the path-shape
// primitives that must live at tier-0 (`crate::strings_impl`) so `bun_paths`
// itself can build on them.
pub use crate::strings_impl::{
    PathByte, basename, basename_posix, basename_windows,
    is_windows_absolute_path_missing_drive_letter, remove_leading_dot_slash,
    without_trailing_slash,
};
// Re-export the bun_core implementation so callers can spell
// `strings::convert_utf16_to_utf8_in_buffer` without reaching into `unicode`.
pub use crate::strings_impl::convert_utf16_to_utf8_in_buffer;
// Re-export the NUL-terminated variant so callers can spell
// `strings::convert_utf8_to_utf16_in_buffer_z` (used by the Windows profilers
// to widen output paths for `File::write_file_os_path`).
pub use unicode_draft::convert_utf8_to_utf16_in_buffer_z;

/// `strings.startsWithWindowsDriveLetterT` — true for `[A-Za-z]:` prefix
/// followed by at least one more byte (`s.len() > 2`).
#[inline]
pub fn starts_with_windows_drive_letter_t<T: Copy + Into<u32>>(s: &[T]) -> bool {
    s.len() > 2 && s[1].into() == u32::from(b':') && {
        let c = s[0].into();
        (c >= u32::from(b'a') && c <= u32::from(b'z'))
            || (c >= u32::from(b'A') && c <= u32::from(b'Z'))
    }
}

/// `strings.convertUTF8toUTF16InBuffer` — UTF-8 → UTF-16LE into a caller-supplied
/// buffer (capacity ≥ `input.len()` u16). SIMD fast path via simdutf; on invalid
/// UTF-8 falls back to a scalar WTF-8 decoder that emits U+FFFD for malformed
/// bytes and passes unpaired surrogates through (so non-empty input never yields
/// an empty slice — fixes #8197).
///
/// Panics when the output does not fit. Callers that cannot statically size
/// `buf` for the worst case must use [`try_convert_utf8_to_utf16_in_buffer`].
pub fn convert_utf8_to_utf16_in_buffer<'a>(buf: &'a mut [u16], input: &[u8]) -> &'a mut [u16] {
    let buf_len = buf.len();
    match try_convert_utf8_to_utf16_in_buffer(buf, input) {
        Some(out) => out,
        None => panic!(
            "convert_utf8_to_utf16_in_buffer: buf too small (have {} u16 for {} input bytes)",
            buf_len,
            input.len(),
        ),
    }
}

/// Checked variant of [`convert_utf8_to_utf16_in_buffer`]: returns `None` when
/// the converted output does not fit in `buf`, and never writes past `buf`.
///
/// simdutf's convert API takes only an output *pointer* and writes however
/// many units the input needs, so it must not be entered unless the output
/// provably fits: either `input.len() <= buf.len()` (a UTF-16 unit always
/// consumes at least one UTF-8 byte, and surrogate pairs produce 2 units from
/// 4 bytes), or the exact converted length fits. On invalid input simdutf
/// stops at the first error having written only the valid prefix's units,
/// which is ≤ that same exact-length estimate; the WTF-8 fallback can exceed
/// the estimate (stray continuation bytes become one U+FFFD each), so it
/// re-checks capacity on every write.
pub fn try_convert_utf8_to_utf16_in_buffer<'a>(
    buf: &'a mut [u16],
    input: &[u8],
) -> Option<&'a mut [u16]> {
    if input.is_empty() {
        return Some(&mut buf[..0]);
    }
    if input.len() > buf.len() && element_length_utf8_into_utf16(input) > buf.len() {
        return None;
    }
    let r = simdutf::convert::utf8::to::utf16::with_errors::le(input, buf);
    if r.is_successful() {
        debug_assert!(r.count <= buf.len());
        return Some(&mut buf[..r.count]);
    }
    // WTF-8 fallback (invalid byte → U+FFFD; lone surrogates pass through).
    let mut written = 0usize;
    let mut i = 0usize;
    while i < input.len() {
        let b = input[i];
        if b < 0x80 {
            if written >= buf.len() {
                return None;
            }
            buf[written] = b as u16;
            written += 1;
            i += 1;
        } else {
            let (cp, adv) = decode_wtf8_one(&input[i..]);
            if cp <= 0xFFFF {
                if written >= buf.len() {
                    return None;
                }
                buf[written] = cp as u16;
                written += 1;
            } else {
                if written + 2 > buf.len() {
                    return None;
                }
                let [hi, lo] = encode_surrogate_pair(cp);
                buf[written] = hi;
                buf[written + 1] = lo;
                written += 2;
            }
            i += adv;
        }
    }
    Some(&mut buf[..written])
}

/// Decode one WTF-8 sequence at the head of `s`; invalid lead/truncated → (U+FFFD, 1).
/// Lone surrogates pass through (WTF-8). Helper for [`convert_utf8_to_utf16_in_buffer`].
fn decode_wtf8_one(s: &[u8]) -> (u32, usize) {
    let b0 = s[0];
    if b0 < 0x80 {
        return (b0 as u32, 1);
    }
    let width = wtf8_byte_sequence_length_with_invalid(b0);
    if width == 1 {
        return (0xFFFD, 1);
    }
    let take = (width as usize).min(s.len());
    let mut buf = [0u8; 4];
    buf[..take].copy_from_slice(&s[..take]);
    let cp = decode_wtf8_rune_t::<i32>(buf, width, -1);
    if cp < 0 {
        return (0xFFFD, 1);
    }
    (cp as u32, take)
}

/// `strings.toUTF8ListWithType` — append UTF-8 transcoding of `utf16` onto
/// `list` and return the (possibly-reallocated) list. Always uses the simdutf
/// path; Bun is built with `FeatureFlags.use_simdutf = true`.
pub fn to_utf8_list_with_type(mut list: Vec<u8>, utf16: &[u16]) -> Result<Vec<u8>, AllocError> {
    if utf16.is_empty() {
        return Ok(list);
    }
    // `convert_utf16_to_utf8_append` writes directly into `spare_capacity_mut()` and
    // requires the caller to pre-reserve (its doc says so explicitly); without this
    // reserve a fresh `Vec::new()` has a dangling `0x1` spare pointer and simdutf
    // segfaults writing to it. The +16 padding gives SIMD over-read slack.
    let length = simdutf::length::utf8::from::utf16::le(utf16);
    list.try_reserve(length + 16).map_err(|_| AllocError)?;
    // Route through
    // `crate::strings_impl::convert_utf16_to_utf8_append`, which replaces
    // unpaired surrogates with U+FFFD.
    crate::strings_impl::convert_utf16_to_utf8_append(&mut list, utf16);
    Ok(list)
}

/// Errors from `to_utf16_alloc`. `InvalidByteSequence` is only returned when
/// `fail_if_invalid = true`; `OutOfMemory` can be returned by any call.
///
/// Re-exported from `unicode_draft` so that `to_utf16_alloc_maybe_buffered`
/// (defined there) and `to_utf16_alloc` (defined here) share a single error
/// type — callers like `TextDecoder` match on `strings::ToUTF16Error` for both.
pub use unicode_draft::ToUTF16Error;
impl From<ToUTF16Error> for crate::CrateError {
    fn from(e: ToUTF16Error) -> Self {
        match e {
            ToUTF16Error::InvalidByteSequence => crate::CrateError::InvalidByteSequence,
            ToUTF16Error::OutOfMemory => crate::CrateError::Alloc(bun_alloc::AllocError),
        }
    }
}

/// `strings.toUTF16Alloc` — convert UTF-8 → UTF-16LE **iff** `bytes` contains
/// any non-ASCII byte; pure-ASCII inputs return `Ok(None)` (caller keeps the
/// 8-bit form). When `fail_if_invalid` is set, invalid UTF-8 yields
/// `Err(InvalidByteSequence)`; otherwise invalid sequences are replaced with
/// U+FFFD. When `sentinel` is set the result
/// includes a trailing 0 u16.
pub fn to_utf16_alloc(
    bytes: &[u8],
    fail_if_invalid: bool,
    sentinel: bool,
) -> Result<Option<Vec<u16>>, ToUTF16Error> {
    let Some(_first) = first_non_ascii(bytes) else {
        return Ok(None);
    };

    let out_length = simdutf::length::utf16::from::utf8(bytes);
    let cap = out_length + if sentinel { 1 } else { 0 };
    // Hot path: allocate uninitialised and let simdutf write directly into the
    // spare capacity — avoids the redundant zero-fill of `vec![0u16; cap]`,
    // which for large source files (build/create-next benches) is a measurable
    // memset. `.max(1)` keeps the buffer pointer non-dangling so simdutf never
    // sees `Vec::new()`'s dangling `0x2` sentinel.
    let mut out: Vec<u16> = Vec::new();
    out.try_reserve_exact(cap.max(1))
        .map_err(|_| ToUTF16Error::OutOfMemory)?;
    // SAFETY: `out` has ≥ `out_length` u16 of capacity (just reserved). simdutf
    // never reads from the output buffer and writes at most `out_length` code
    // units (the upper bound returned by `simdutf__utf16_length_from_utf8`), so passing
    // uninitialised storage is sound. We only commit the length after success.
    let res = unsafe {
        simdutf::simdutf__convert_utf8_to_utf16le_with_errors(
            bytes.as_ptr(),
            bytes.len(),
            out.as_mut_ptr(),
        )
    };
    if res.is_successful() && out_length > 0 {
        // SAFETY: on success simdutf has initialised exactly `out_length` u16s
        // at the start of `out`'s allocation, and `out_length <= capacity`.
        unsafe { out.set_len(out_length) };
        if sentinel {
            out.push(0);
        }
        return Ok(Some(out));
    }
    if fail_if_invalid {
        return Err(ToUTF16Error::InvalidByteSequence);
    }
    // Slow path: WTF-8 decode with replacement. `out` is still len 0 (we never
    // committed the failed fast-path write); reuse its capacity.
    out.try_reserve(bytes.len() + if sentinel { 1 } else { 0 })
        .map_err(|_| ToUTF16Error::OutOfMemory)?;
    let mut remaining = bytes;
    while let Some(i) = first_non_ascii(remaining) {
        let i = i as usize;
        // Copy ASCII prefix as-is (one u16 per byte).
        out.extend(remaining[..i].iter().map(|&b| u16::from(b)));
        remaining = &remaining[i..];
        // Decode one codepoint via `convert_utf8_bytes_into_utf16` so the
        // number/position of U+FFFD emissions stays consistent: advance by
        // `replacement.len.max(1)`, not 1.
        let replacement = unicode_draft::convert_utf8_bytes_into_utf16(remaining);
        remaining = &remaining[(replacement.len as usize).max(1)..];
        push_codepoint_utf16(&mut out, replacement.code_point);
    }
    out.extend(remaining.iter().map(|&b| u16::from(b)));
    if sentinel {
        out.push(0);
    }
    Ok(Some(out))
}

/// WTF-8 → UTF-16LE iff `bytes` contains any non-ASCII byte; pure-ASCII inputs return `None`.
pub fn wtf8_to_utf16_alloc(bytes: &[u8]) -> Option<Vec<u16>> {
    let first_non_ascii = first_non_ascii_usize(bytes)?;
    let mut out: Vec<u16> = Vec::with_capacity(bytes.len());
    // SAFETY: `bytes.len()` u16 of capacity is the bound `write_wtf8_as_utf16le` requires.
    unsafe {
        let n = write_wtf8_as_utf16le(bytes, first_non_ascii, out.as_mut_ptr().cast::<u8>());
        out.set_len(n / 2);
    }
    Some(out)
}

/// Writes `bytes` (WTF-8) as little-endian UTF-16 code units starting at `dst` and returns the
/// number of bytes written. `first_non_ascii` is the caller's `strings::first_non_ascii(bytes)`:
/// that prefix is widened directly and only the rest goes through simdutf; a lone surrogate or an
/// invalid byte there falls to a scalar loop (invalid byte → U+FFFD, lone surrogate kept).
///
/// # Safety
/// `dst` must be 2-byte aligned and valid for `2 * bytes.len()` bytes of writes (every input byte yields at
/// most one unit); `first_non_ascii <= bytes.len()` and `bytes[..first_non_ascii]` is ASCII.
pub unsafe fn write_wtf8_as_utf16le(bytes: &[u8], first_non_ascii: usize, dst: *mut u8) -> usize {
    debug_assert!(dst.addr().is_multiple_of(2) && is_all_ascii(&bytes[..first_non_ascii]));
    for (i, &b) in bytes[..first_non_ascii].iter().enumerate() {
        // SAFETY: `2 * i + 1 < 2 * bytes.len()`.
        unsafe {
            dst.add(2 * i)
                .cast::<[u8; 2]>()
                .write_unaligned(u16::from(b).to_le_bytes())
        };
    }
    let mut written = 2 * first_non_ascii;
    let bytes = &bytes[first_non_ascii..];
    #[expect(
        clippy::cast_ptr_alignment,
        reason = "caller contract: dst is 2-byte aligned"
    )]
    // SAFETY: caller contract; simdutf writes at most `utf16_length_from_utf8(bytes) <= bytes.len()` units.
    let res = unsafe {
        simdutf::simdutf__convert_utf8_to_utf16le_with_errors(
            bytes.as_ptr(),
            bytes.len(),
            dst.add(written).cast::<u16>(),
        )
    };
    if res.is_successful() {
        return written + res.count * 2;
    }
    let mut put = |unit: u16| {
        // SAFETY: at most one unit per input byte consumed, within the caller's `2 * bytes.len()`.
        unsafe {
            dst.add(written)
                .cast::<[u8; 2]>()
                .write_unaligned(unit.to_le_bytes())
        };
        written += 2;
    };
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b < 0x80 {
            put(u16::from(b));
            i += 1;
            continue;
        }
        let width = wtf8_byte_sequence_length_with_invalid(b);
        if width == 1 {
            put(UNICODE_REPLACEMENT as u16);
            i += 1;
            continue;
        }
        let take = (width as usize).min(bytes.len() - i);
        let mut buf = [0u8; 4];
        buf[..take].copy_from_slice(&bytes[i..i + take]);
        let cp = decode_wtf8_rune_t::<i32>(buf, width, -1);
        if cp < 0 {
            put(UNICODE_REPLACEMENT as u16);
            i += 1;
            continue;
        }
        let cp = cp as u32;
        if cp < 0x10000 {
            put(cp as u16);
        } else {
            let c = cp - 0x10000;
            put(0xD800 + (c >> 10) as u16);
            put(0xDC00 + (c & 0x3FF) as u16);
        }
        i += take;
    }
    written
}

/// `PATTERN_KEY_COMPARE` from the Node.js ESM resolution spec — the comparator
/// behind `NewGlobLengthSorter`. Returns an [`Ordering`] suitable for
/// `slice.sort_by(|a, b| glob_length_compare(a, b))` to sort in **descending
/// order of specificity**.
pub fn glob_length_compare(key_a: &[u8], key_b: &[u8]) -> Ordering {
    let star_a = index_of_char(key_a, b'*');
    let star_b = index_of_char(key_b, b'*');
    let base_length_a = star_a.map_or(key_a.len(), |i| i as usize);
    let base_length_b = star_b.map_or(key_b.len(), |i| i as usize);
    if base_length_a > base_length_b {
        return Ordering::Less;
    }
    if base_length_b > base_length_a {
        return Ordering::Greater;
    }
    if star_a.is_none() {
        return Ordering::Greater;
    }
    if star_b.is_none() {
        return Ordering::Less;
    }
    if key_a.len() > key_b.len() {
        return Ordering::Less;
    }
    if key_b.len() > key_a.len() {
        return Ordering::Greater;
    }
    Ordering::Equal
}

#[cfg(test)]
mod tests {
    // Regression guard for 3e7f1dabc079: `crate::strings` is an alias of
    // *this* module, so wrappers here (e.g. `first_non_ascii`) must call
    // `crate::strings_impl::*`, never `crate::strings::*` (self-recursion).
    // rustc's `unconditional_recursion` lint does NOT fire across `pub use`
    // re-export chains, so assert termination here instead.
    #[test]
    fn strings_reexport_wrappers_terminate() {
        assert_eq!(super::first_non_ascii(b"abc"), None);
        assert_eq!(super::first_non_ascii(b"ab\xC3"), Some(2));
        assert!(super::eql_case_insensitive_ascii(b"A", b"a", true));
        assert!(!super::eql_case_insensitive_ascii(b"Ab", b"a", true));
    }

    #[test]
    fn convert_utf8_to_utf16_in_buffer_fallback_rejects_malformed_sequences() {
        let mut buf = [0u16; 16];
        let out =
            super::convert_utf8_to_utf16_in_buffer(&mut buf, b"\xC0\xAE\xC0\xAF\xC1\x9C\xC0\x80");
        assert_eq!(out, &[0xFFFD; 8][..]);
        let out = super::convert_utf8_to_utf16_in_buffer(&mut buf, b"\xE0\x80\x80");
        assert_eq!(out, &[0xFFFD, 0xFFFD, 0xFFFD][..]);
        let out = super::convert_utf8_to_utf16_in_buffer(&mut buf, b"a\xC2\x41");
        assert_eq!(out, &[b'a' as u16, 0xFFFD, b'A' as u16][..]);
        let out = super::convert_utf8_to_utf16_in_buffer(&mut buf, b"\xED\xA0\x80");
        assert_eq!(out, &[0xD800][..]);
        let out = super::convert_utf8_to_utf16_in_buffer(&mut buf, b"\xC3\xA9\xF0\x9F\x98\x80");
        assert_eq!(out, &[0x00E9, 0xD83D, 0xDE00][..]);
    }
}
