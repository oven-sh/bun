//! `node:path` — a port of Node.js `lib/path.js` that operates directly on the
//! Latin-1 / UTF-16 backing store of each JSString.
//!
//! Reference: <https://github.com/nodejs/node/blob/v26.3.0/lib/path.js>. Every
//! function below is a transliteration of the function of the same name there
//! and keeps its structure (and comments) so the two can be diffed side by side;
//! the places that were restructured for speed say so and describe why the
//! observable behaviour is unchanged.
//!
//! Inputs are never transcoded. Results that are slices of an input are
//! returned as JSC substrings sharing the input's buffer; results that have to
//! be assembled (join, resolve, normalize, relative) are built once in a stack
//! buffer of the inputs' character width; and a result that turns out to be
//! identical to an input is returned as that same string cell.
//!
//! `isAbsolute`, `format`, posix `toNamespacedPath` and `matchesGlob` live in
//! `src/js/node/path.ts`.

use bun_collections::smallvec::SmallVec;
use bun_core::strings;
use bun_paths::PathChar;

use crate::jsc::{
    self, CallFrame, JSFunction, JSGlobalObject, JSString, JSValue, JsError, JsResult,
};

// ───────────────────────────── code units ──────────────────────────────

/// A string code unit: `u8` is a Latin-1 character (an 8-bit JSString) — not
/// UTF-8 — and `u16` a UTF-16 code unit. Only the encoding-agnostic parts of
/// [`PathChar`] are used (`as_u32`, `from_u8`, `IS_U16`).
trait Unit: PathChar + bytemuck::Pod + Default {
    /// Truncating; callers only narrow values known to fit.
    fn from_u32(u: u32) -> Self;
}
impl Unit for u8 {
    #[inline(always)]
    fn from_u32(u: u32) -> Self {
        debug_assert!(u <= 0xFF);
        u as u8
    }
}
impl Unit for u16 {
    #[inline(always)]
    fn from_u32(u: u32) -> Self {
        debug_assert!(u <= 0xFFFF);
        u as u16
    }
}

#[inline(always)]
fn ch<C: Unit>(c: u8) -> C {
    C::from_u8(c)
}

/// JS `-1` sentinels and `StringPrototypeSlice` clamping are kept as-is, so
/// indices are signed.
type Index = isize;

const CHAR_DOT: u8 = b'.';
const CHAR_FORWARD_SLASH: u8 = b'/';
const CHAR_BACKWARD_SLASH: u8 = b'\\';
const CHAR_COLON: u8 = b':';
const CHAR_QUESTION_MARK: u8 = b'?';

#[inline(always)]
const fn separator(is_windows: bool) -> u8 {
    if is_windows {
        CHAR_BACKWARD_SLASH
    } else {
        CHAR_FORWARD_SLASH
    }
}

#[inline(always)]
fn is_path_separator<const WIN: bool>(code: u32) -> bool {
    if WIN {
        code == CHAR_FORWARD_SLASH as u32 || code == CHAR_BACKWARD_SLASH as u32
    } else {
        code == CHAR_FORWARD_SLASH as u32
    }
}

#[inline(always)]
fn is_windows_device_root(code: u32) -> bool {
    ((code | 0x20).wrapping_sub(b'a' as u32)) < 26
}

/// `isWindowsReservedName(path, colonIndex)` with the
/// `StringPrototypeSlice(path, 0, colonIndex)` already applied by the caller.
/// `StringPrototypeToUpperCase` can only produce one of these names from its
/// ASCII case variants — no non-ASCII code point upper-cases to any of
/// `A C L M N O P R T U X 1-9`, and U+00B9/U+00B2/U+00B3 (the superscript
/// digits in `COM¹` etc., lib/path.js `WINDOWS_RESERVED_NAMES`) upper-case to
/// themselves — so an ASCII case-insensitive comparison is exact.
fn is_windows_reserved_name<C: Unit>(s: &[C]) -> bool {
    let up = |i: usize| -> u32 {
        let c = s[i].as_u32();
        if (b'a' as u32..=b'z' as u32).contains(&c) {
            c - 32
        } else {
            c
        }
    };
    let is3 = |a: u8, b: u8, c: u8| up(0) == a as u32 && up(1) == b as u32 && up(2) == c as u32;
    match s.len() {
        3 => {
            is3(b'C', b'O', b'N')
                || is3(b'P', b'R', b'N')
                || is3(b'A', b'U', b'X')
                || is3(b'N', b'U', b'L')
        }
        4 => {
            let d = s[3].as_u32();
            let suffix =
                (b'1' as u32..=b'9' as u32).contains(&d) || d == 0xB9 || d == 0xB2 || d == 0xB3;
            suffix && (is3(b'C', b'O', b'M') || is3(b'L', b'P', b'T'))
        }
        _ => false,
    }
}

/// `StringPrototypeSlice(s, start, end)` index clamping, for the call sites in
/// lib/path.js that can pass negative or out-of-range indices.
#[inline]
fn js_slice<C>(s: &[C], mut start: Index, mut end: Index) -> &[C] {
    let len = s.len() as Index;
    start = if start < 0 {
        (len + start).max(0)
    } else {
        start.min(len)
    };
    end = if end < 0 {
        (len + end).max(0)
    } else {
        end.min(len)
    };
    if end <= start {
        &[]
    } else {
        &s[start as usize..end as usize]
    }
}

#[inline]
fn span_equals<A: Unit, B: Unit>(a: &[A], b: &[B]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.as_u32() == y.as_u32())
}

#[inline]
fn all_ascii<C: Unit>(s: &[C]) -> bool {
    if C::IS_U16 {
        strings::first_non_ascii16(bytemuck::cast_slice(s)).is_none()
    } else {
        strings::first_non_ascii(bytemuck::cast_slice(s)).is_none()
    }
}

/// Copies `src` into the front of `dst`, widening or narrowing as needed
/// (callers only narrow values known to fit), and returns the count.
#[inline]
fn copy_units<D: Unit, S: Unit>(dst: &mut [D], src: &[S]) -> usize {
    if D::IS_U16 == S::IS_U16 {
        dst[..src.len()].copy_from_slice(bytemuck::cast_slice(src));
    } else {
        for (d, s) in dst.iter_mut().zip(src) {
            *d = D::from_u32(s.as_u32());
        }
    }
    src.len()
}

// ────────────────────────────── scanning ────────────────────────────────

/// Index of the first `a` (or, when `TWO`, the first `a` or `b`) in `p[i..]`,
/// or `p.len()`. Scans a machine word at a time; separators and colons are
/// searched per path segment, i.e. mostly over spans shorter than a SIMD
/// register, where an inline word loop beats a library call.
#[inline]
fn find_units<const TWO: bool, C: Unit>(p: &[C], mut i: usize, a: u8, b: u8) -> usize {
    let len = p.len();
    let units_per_word = 8 / core::mem::size_of::<C>();
    let bits: u32 = 8 * core::mem::size_of::<C>() as u32;
    let ones: u64 = if C::IS_U16 {
        0x0001_0001_0001_0001
    } else {
        0x0101_0101_0101_0101
    };
    let highs: u64 = ones << (bits - 1);
    while i + units_per_word <= len {
        // SAFETY: `i + units_per_word <= len`, so 8 bytes starting at `p[i]` are in bounds.
        let w = unsafe { core::ptr::read_unaligned(p.as_ptr().add(i).cast::<u64>()) };
        // The classic has-zero-lane test; exact for the lowest matching lane, which is the only
        // one consulted (little-endian).
        let x = w ^ ones.wrapping_mul(a as u64);
        let mut found = x.wrapping_sub(ones) & !x & highs;
        if TWO {
            let y = w ^ ones.wrapping_mul(b as u64);
            found |= y.wrapping_sub(ones) & !y & highs;
        }
        if found != 0 {
            return i + (found.trailing_zeros() / bits) as usize;
        }
        i += units_per_word;
    }
    while i < len && p[i].as_u32() != a as u32 && !(TWO && p[i].as_u32() == b as u32) {
        i += 1;
    }
    i
}

/// Index of the first path separator in `p[i..]`, or `p.len()`.
#[inline]
fn find_separator<const WIN: bool, C: Unit>(p: &[C], i: usize) -> usize {
    find_units::<WIN, C>(p, i, CHAR_FORWARD_SLASH, CHAR_BACKWARD_SLASH)
}

/// `StringPrototypeIndexOf(s, c, from)`.
#[inline]
fn index_of<C: Unit>(s: &[C], c: u8, from: Index) -> Index {
    let i = find_units::<false, C>(s, from.max(0) as usize, c, c);
    if i >= s.len() { -1 } else { i as Index }
}

/// Length of the common prefix of `a[..n]` and `b[..n]`.
#[inline]
fn common_prefix_length<C: Unit>(a: &[C], b: &[C], n: usize) -> usize {
    let units_per_word = 8 / core::mem::size_of::<C>();
    let bits: u32 = 8 * core::mem::size_of::<C>() as u32;
    let mut i = 0;
    while i + units_per_word <= n {
        // SAFETY: `i + units_per_word <= n <= a.len(), b.len()`.
        let (wa, wb) = unsafe {
            (
                core::ptr::read_unaligned(a.as_ptr().add(i).cast::<u64>()),
                core::ptr::read_unaligned(b.as_ptr().add(i).cast::<u64>()),
            )
        };
        let diff = wa ^ wb;
        if diff != 0 {
            return i + (diff.trailing_zeros() / bits) as usize;
        }
        i += units_per_word;
    }
    while i < n && a[i] == b[i] {
        i += 1;
    }
    i
}

// ───────────────────────────── string views ─────────────────────────────

/// The characters of a resolved JSString (or of the process cwd, or of a
/// scratch buffer standing in for one).
#[derive(Clone, Copy)]
enum Chars<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

impl<'a> Chars<'a> {
    #[inline]
    fn len(&self) -> usize {
        match self {
            Chars::Latin1(s) => s.len(),
            Chars::Utf16(s) => s.len(),
        }
    }
    #[inline]
    fn is_8bit(&self) -> bool {
        matches!(self, Chars::Latin1(_))
    }
    #[inline]
    fn at(&self, i: usize) -> u32 {
        match self {
            Chars::Latin1(s) => s[i] as u32,
            Chars::Utf16(s) => s[i] as u32,
        }
    }
    #[inline]
    fn copy_to<D: Unit>(&self, dst: &mut [D]) -> usize {
        match self {
            Chars::Latin1(s) => copy_units(dst, s),
            Chars::Utf16(s) => copy_units(dst, s),
        }
    }
    #[inline]
    fn slice_from(&self, start: usize) -> Chars<'a> {
        match self {
            Chars::Latin1(s) => Chars::Latin1(&s[start..]),
            Chars::Utf16(s) => Chars::Utf16(&s[start..]),
        }
    }
    fn eq(&self, other: &Chars<'_>) -> bool {
        match (self, other) {
            (Chars::Latin1(a), Chars::Latin1(b)) => a == b,
            (Chars::Utf16(a), Chars::Utf16(b)) => a == b,
            (Chars::Latin1(a), Chars::Utf16(b)) => span_equals(a, b),
            (Chars::Utf16(a), Chars::Latin1(b)) => span_equals(a, b),
        }
    }
    fn of<C: Unit>(s: &'a [C]) -> Chars<'a> {
        if C::IS_U16 {
            Chars::Utf16(bytemuck::cast_slice(s))
        } else {
            Chars::Latin1(bytemuck::cast_slice(s))
        }
    }
}

/// Run `$body` with `$s: &[u8]` or `$s: &[u16]` bound to the characters.
macro_rules! with_chars {
    ($chars:expr, |$s:ident| $body:expr) => {
        match $chars {
            Chars::Latin1($s) => $body,
            Chars::Utf16($s) => $body,
        }
    };
}

/// A string argument (or the cwd) resolved to a flat view. `string` is the
/// JSString cell the view borrows from, or `ZERO` for synthesized strings.
#[derive(Clone, Copy)]
struct Input<'a> {
    string: JSValue,
    chars: Chars<'a>,
}

impl<'a> Input<'a> {
    #[inline]
    fn len(&self) -> usize {
        self.chars.len()
    }
    #[inline]
    fn is_8bit(&self) -> bool {
        self.chars.is_8bit()
    }
    #[inline]
    fn at(&self, i: usize) -> u32 {
        self.chars.at(i)
    }
    /// Keeps the viewed string reachable up to this point (for the cwd, which
    /// unlike an argument is not necessarily referenced from anywhere else).
    #[inline]
    fn keep_alive(&self) {
        self.string.ensure_still_alive();
    }
}

unsafe extern "C" {
    /// `process.cwd()` as lib/path.js calls it (src/jsc/bindings/BunProcess.cpp): the cached
    /// JSString or, once user code has replaced `process.cwd`, its result as a JSString, except
    /// that undefined and null come back as they are.
    safe fn Bun__Process__getCachedCwd(global: &JSGlobalObject) -> JSValue;
    /// The parse() result object with its cached structure (src/jsc/bindings/ZigGlobalObject.cpp).
    fn PathParsedObject__create(
        global: &JSGlobalObject,
        path: JSValue,
        ranges: *const Parsed,
    ) -> JSValue;
}

/// Resolves `value` (already known to be a primitive string) to a flat view.
/// The view borrows the JSString's storage, which stays alive for as long as
/// the string is reachable: arguments are on the JS stack for the whole call,
/// and each entry point keeps a cwd string alive on the native stack until its
/// result has been built ([`Input::keep_alive`]).
#[inline]
fn view_of<'a>(global: &JSGlobalObject, value: JSValue) -> JsResult<Input<'a>> {
    debug_assert!(value.is_string_literal());
    let string: &JSString = value.as_string();
    let view = string.view(global)?;
    // SAFETY: the view describes the live JSString's storage (see the doc comment); detach it
    // from the local `JSStringView` guard's lifetime.
    let chars = unsafe {
        if view.is_utf16() {
            let s = view.utf16();
            Chars::Utf16(core::slice::from_raw_parts(s.as_ptr(), s.len()))
        } else {
            let s = view.latin1();
            Chars::Latin1(core::slice::from_raw_parts(s.as_ptr(), s.len()))
        }
    };
    Ok(Input {
        string: value,
        chars,
    })
}

/// `process.cwd()`, with `None` for the undefined a replaced `process.cwd` may
/// return. lib/path.js indexes into the cwd, which throws for undefined and
/// null alike, except in the drive-relative branch of win32.resolve()
/// ([`win32::drive_cwd`]), which substitutes the drive's root for undefined
/// (but still throws for null, as this does).
#[inline]
fn get_cwd_or_undefined<'a>(global: &JSGlobalObject) -> JsResult<Option<Input<'a>>> {
    let value = jsc::call_zero_is_throw(global, || Bun__Process__getCachedCwd(global))?;
    if value.is_undefined_or_null() {
        if value.is_undefined() {
            return Ok(None);
        }
        return Err(throw_nullish_cwd(global, "null"));
    }
    view_of(global, value).map(Some)
}

/// `process.cwd()` everywhere lib/path.js goes on to index into it.
#[inline]
fn get_cwd<'a>(global: &JSGlobalObject) -> JsResult<Input<'a>> {
    match get_cwd_or_undefined(global)? {
        Some(cwd) => Ok(cwd),
        None => Err(throw_nullish_cwd(global, "undefined")),
    }
}

#[cold]
fn throw_nullish_cwd(global: &JSGlobalObject, which: &str) -> JsError {
    global.throw_type_error(format_args!("process.cwd() returned {which}"))
}

/// `validateString(value, name)`.
#[inline]
fn validate_string(global: &JSGlobalObject, value: JSValue, name: &str) -> JsResult<()> {
    if value.is_string_literal() {
        return Ok(());
    }
    Err(global.throw_invalid_argument_type_value(name, "string", value))
}

// ─────────────────────────────── results ────────────────────────────────

/// `StringPrototypeSlice(input, start, end)` as a JSString sharing `input`'s buffer.
#[inline]
fn substring(global: &JSGlobalObject, input: &Input<'_>, start: Index, end: Index) -> JSValue {
    debug_assert!(input.string.is_string_literal());
    debug_assert!(start >= 0 && end >= start && end as usize <= input.len());
    let string: &JSString = input.string.as_string();
    string.substring(global, start as u32, (end - start) as u32)
}

/// A result exceeded the maximum JS string length.
struct TooLong;

/// Guards a total computed from several argument lengths before it is used to
/// size a buffer; anything past the JS string limit could never be returned.
#[inline]
fn check_length(len: usize) -> Result<usize, TooLong> {
    if len > bun_core::String::max_length() {
        Err(TooLong)
    } else {
        Ok(len)
    }
}

/// A new JSString with the given characters (`ERR_STRING_TOO_LONG` past the
/// string limit).
fn to_js<C: Unit>(global: &JSGlobalObject, chars: &[C]) -> JsResult<JSValue> {
    if C::IS_U16 {
        JSValue::from_utf16(global, bytemuck::cast_slice(chars))
    } else {
        JSValue::from_latin1(global, bytemuck::cast_slice(chars))
    }
}

/// When the result turns out to be identical to an input, hand back that cell
/// instead of allocating a copy.
fn to_js_reusing<C: Unit>(
    global: &JSGlobalObject,
    chars: &[C],
    input: &Input<'_>,
) -> JsResult<JSValue> {
    if !input.string.is_empty() && input.len() == chars.len() && Chars::of(chars).eq(&input.chars) {
        return Ok(input.string);
    }
    to_js(global, chars)
}

#[inline]
fn dot_string(global: &JSGlobalObject) -> JSValue {
    JSValue::js_single_character_string(global, CHAR_DOT)
}

#[inline]
fn empty_string(global: &JSGlobalObject) -> JSValue {
    JSValue::js_empty_string(global)
}

// ────────────────────────────── buffers ─────────────────────────────────

/// Scratch space for assembled results; spills to the heap past `INLINE` units.
type Buf<C> = SmallVec<[C; INLINE]>;
const INLINE: usize = 1024;

/// A buffer of the same unit type as `like` (for use under `with_chars!`).
#[inline(always)]
fn buf_like<C: Unit>(_like: &[C]) -> Buf<C> {
    Buf::new()
}

/// Sizes `buf` to exactly `len` (zero-filled) and returns it as a slice.
#[inline]
fn reserve<C: Unit>(buf: &mut Buf<C>, len: usize) -> &mut [C] {
    buf.clear();
    buf.reserve_exact(len);
    // SAFETY: capacity >= len after reserve_exact; the first `len` units are zeroed before
    // the length is published, and an all-zero bit pattern is a valid `u8`/`u16`.
    unsafe {
        core::ptr::write_bytes(buf.as_mut_ptr(), 0, len);
        buf.set_len(len);
    }
    &mut buf[..]
}

// ─────────────────────────── normalizeString ────────────────────────────

/// Resolves `.` and `..` elements in a path with directory names.
///
/// This is `normalizeString()` from lib/path.js restructured to consume a
/// segment at a time instead of a code unit at a time: Node's `dots` counter is
/// exactly "the current segment is `''`, `'.'` or `'..'`", and its
/// `i === path.length` iteration only skips an empty trailing segment, which is
/// a no-op here too. `res` must have room for `path.len()` units (every emitted
/// segment or `..` consumes at least as many input units); returns the length
/// written.
fn normalize_string<const WIN: bool, C: Unit>(
    path: &[C],
    allow_above_root: bool,
    res: &mut [C],
) -> usize {
    let sep: C = ch(separator(WIN));
    let len = path.len();
    let mut res_len = 0usize;
    let mut last_segment_length = 0usize;
    let mut i = 0usize;
    while i <= len {
        let segment = i;
        i = find_separator::<WIN, C>(path, i);
        let segment_length = i - segment;
        // `i` is now at a separator or at `len`; step over it for the next iteration.
        i += 1;

        if segment_length == 0 || (segment_length == 1 && path[segment].as_u32() == CHAR_DOT as u32)
        {
            // NOOP
        } else if segment_length == 2
            && path[segment].as_u32() == CHAR_DOT as u32
            && path[segment + 1].as_u32() == CHAR_DOT as u32
        {
            if res_len < 2
                || last_segment_length != 2
                || res[res_len - 1].as_u32() != CHAR_DOT as u32
                || res[res_len - 2].as_u32() != CHAR_DOT as u32
            {
                if res_len > 2 {
                    // const lastSlashIndex = res.length - lastSegmentLength - 1;
                    if res_len == last_segment_length {
                        // lastSlashIndex === -1
                        res_len = 0;
                        last_segment_length = 0;
                    } else {
                        res_len = res_len - last_segment_length - 1;
                        // lastSegmentLength = res.length - 1 - StringPrototypeLastIndexOf(res, separator);
                        let mut k = res_len;
                        while k > 0 && res[k - 1] != sep {
                            k -= 1;
                        }
                        last_segment_length = res_len - k;
                    }
                    continue;
                } else if res_len != 0 {
                    res_len = 0;
                    last_segment_length = 0;
                    continue;
                }
            }
            if allow_above_root {
                if res_len > 0 {
                    res[res_len] = sep;
                    res_len += 1;
                }
                res[res_len] = ch(CHAR_DOT);
                res[res_len + 1] = ch(CHAR_DOT);
                res_len += 2;
                last_segment_length = 2;
            }
        } else {
            if res_len > 0 {
                res[res_len] = sep;
                res_len += 1;
            }
            res[res_len..res_len + segment_length]
                .copy_from_slice(&path[segment..segment + segment_length]);
            res_len += segment_length;
            last_segment_length = segment_length;
        }
    }
    res_len
}

// ─────────────────── shared by posix and win32 verbatim ────────────────────
//
// `basename` and `extname` differ between the two objects in lib/path.js only
// in the separator predicate and in win32's drive-letter prologue, so each is
// written once against the win32 text (posix's is the same with `start = 0`).

fn basename_impl<const WIN: bool>(
    global: &JSGlobalObject,
    path: &Input<'_>,
    suffix: Option<&Input<'_>>,
) -> JSValue {
    with_chars!(path.chars, |p| {
        let mut start: Index = 0;
        let mut end: Index = -1;
        let mut matched_slash = true;
        let path_length = p.len() as Index;

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded
        if WIN
            && path_length >= 2
            && is_windows_device_root(p[0].as_u32())
            && p[1].as_u32() == CHAR_COLON as u32
        {
            start = 2;
        }

        if let Some(suffix) = suffix.filter(|s| s.len() > 0 && s.len() as Index <= path_length) {
            return with_chars!(suffix.chars, |s| {
                if span_equals(s, p) {
                    return empty_string(global);
                }
                let mut ext_idx: Index = s.len() as Index - 1;
                let mut first_non_slash_end: Index = -1;
                let mut i: Index = path_length - 1;
                while i >= start {
                    let code = p[i as usize].as_u32();
                    if is_path_separator::<WIN>(code) {
                        // If we reached a path separator that was not part of a set of path
                        // separators at the end of the string, stop now
                        if !matched_slash {
                            start = i + 1;
                            break;
                        }
                    } else {
                        if first_non_slash_end == -1 {
                            // We saw the first non-path separator, remember this index in case
                            // we need it if the extension ends up not matching
                            matched_slash = false;
                            first_non_slash_end = i + 1;
                        }
                        if ext_idx >= 0 {
                            // Try to match the explicit extension
                            if code == s[ext_idx as usize].as_u32() {
                                ext_idx -= 1;
                                if ext_idx == -1 {
                                    // We matched the extension, so mark this as the end of our path
                                    // component
                                    end = i;
                                }
                            } else {
                                // Extension does not match, so our result is the entire path
                                // component
                                ext_idx = -1;
                                end = first_non_slash_end;
                            }
                        }
                    }
                    i -= 1;
                }

                if start == end {
                    end = first_non_slash_end;
                } else if end == -1 {
                    end = path_length;
                }
                substring(global, path, start, end)
            });
        }
        let mut i: Index = path_length - 1;
        while i >= start {
            if is_path_separator::<WIN>(p[i as usize].as_u32()) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start = i + 1;
                    break;
                }
            } else if end == -1 {
                // We saw the first non-path separator, mark this as the end of our
                // path component
                matched_slash = false;
                end = i + 1;
            }
            i -= 1;
        }

        if end == -1 {
            return empty_string(global);
        }
        substring(global, path, start, end)
    })
}

fn extname_impl<const WIN: bool>(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
    with_chars!(path.chars, |p| {
        let mut start: Index = 0;
        let mut start_dot: Index = -1;
        let mut start_part: Index = 0;
        let mut end: Index = -1;
        let mut matched_slash = true;
        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find
        let mut pre_dot_state: Index = 0;
        let path_length = p.len() as Index;

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded

        if WIN
            && path_length >= 2
            && p[1].as_u32() == CHAR_COLON as u32
            && is_windows_device_root(p[0].as_u32())
        {
            start = 2;
            start_part = 2;
        }

        let mut i: Index = path_length - 1;
        while i >= start {
            let code = p[i as usize].as_u32();
            if is_path_separator::<WIN>(code) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start_part = i + 1;
                    break;
                }
                i -= 1;
                continue;
            }
            if end == -1 {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matched_slash = false;
                end = i + 1;
            }
            if code == CHAR_DOT as u32 {
                // If this is our first dot, mark it as the start of our extension
                if start_dot == -1 {
                    start_dot = i;
                } else if pre_dot_state != 1 {
                    pre_dot_state = 1;
                }
            } else if start_dot != -1 {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                pre_dot_state = -1;
            }
            i -= 1;
        }

        if start_dot == -1
            || end == -1
            // We saw a non-dot character immediately before the dot
            || pre_dot_state == 0
            // The (right-most) trimmed path component is exactly '..'
            || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)
        {
            return empty_string(global);
        }
        substring(global, path, start_dot, end)
    })
}

/// `path.parse()` result as `[start, end)` slices of the input; `[-1, -1]` is `''`.
/// Mirrors the layout `PathParsedObject__create` reads (five int32 pairs).
#[repr(C)]
struct Parsed {
    root: [i32; 2],
    dir: [i32; 2],
    base: [i32; 2],
    ext: [i32; 2],
    name: [i32; 2],
}

impl Parsed {
    const EMPTY: [i32; 2] = [-1, -1];
    fn new() -> Self {
        Self {
            root: Self::EMPTY,
            dir: Self::EMPTY,
            base: Self::EMPTY,
            ext: Self::EMPTY,
            name: Self::EMPTY,
        }
    }
    #[inline]
    fn range(start: Index, end: Index) -> [i32; 2] {
        // JSString lengths are < 2^31.
        [start as i32, end as i32]
    }
    fn to_js(&self, global: &JSGlobalObject, path: JSValue) -> JSValue {
        // SAFETY: `path` is a resolved JSString (via view_of); `self` is `#[repr(C)]` five int32 pairs.
        unsafe { PathParsedObject__create(global, path, self) }
    }
}

// ──────────────────────────────── posix ─────────────────────────────────

mod posix {
    use super::*;

    /// `posixCwd()`: on Windows hosts, converts separators and strips the drive.
    pub(super) fn cwd<'a>(
        global: &JSGlobalObject,
        storage: &'a mut Buf<u16>,
    ) -> JsResult<Input<'a>> {
        let out = get_cwd(global)?;
        #[cfg(windows)]
        {
            let len = out.len();
            let mut first_slash: Index = -1;
            {
                let p = reserve(storage, len);
                out.chars.copy_to(p);
                for (i, c) in p.iter_mut().enumerate() {
                    if *c == CHAR_BACKWARD_SLASH as u16 {
                        *c = CHAR_FORWARD_SLASH as u16;
                    }
                    if first_slash == -1 && *c == CHAR_FORWARD_SLASH as u16 {
                        first_slash = i as Index;
                    }
                }
            }
            let storage: &'a Buf<u16> = storage;
            // StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/')) — slice(-1) when there is none.
            return Ok(Input {
                string: JSValue::ZERO,
                chars: Chars::Utf16(js_slice(&storage[..len], first_slash, len as Index)),
            });
        }
        #[cfg(not(windows))]
        {
            let _ = storage;
            Ok(out)
        }
    }

    /// The predicate of `posix.resolve()`'s "current directory" fast path
    /// (`args.length === 1 && (args[0] === '' || args[0] === '.')`).
    #[inline]
    pub(super) fn is_trivial_arg(arg: &Chars<'_>) -> bool {
        arg.len() == 0 || (arg.len() == 1 && arg.at(0) == CHAR_DOT as u32)
    }

    #[inline]
    fn needs_cwd(path: &Chars<'_>) -> bool {
        path.len() == 0 || path.at(0) != CHAR_FORWARD_SLASH as u32
    }

    /// How `posix.resolve(operand)` ended up using `process.cwd()`.
    pub(super) enum OperandCwd<'a> {
        /// An absolute operand: not read.
        NotRead,
        /// `resolve('')` / `resolve('.')` with an absolute cwd: the result, as read.
        Returned(Input<'a>),
        /// What the operand is resolved against.
        Against(Input<'a>),
    }

    impl<'a> OperandCwd<'a> {
        pub(super) fn input(&self) -> Option<&Input<'a>> {
            match self {
                OperandCwd::NotRead => None,
                OperandCwd::Returned(cwd) | OperandCwd::Against(cwd) => Some(cwd),
            }
        }
    }

    /// Reads `process.cwd()` as often, and at the same points, as `posix.resolve(operand)`
    /// does in lib/path.js: not at all for an absolute operand, once for a relative one, and
    /// for `''` / `'.'` once in the fast path, which returns the reading if it is absolute,
    /// plus once more in the fallback if it is not. (Observable when `process.cwd` has been
    /// replaced by something stateful.)
    pub(super) fn operand_cwd<'a>(
        global: &JSGlobalObject,
        operand: &Chars<'_>,
        storage: &'a mut Buf<u16>,
        fallback_storage: &'a mut Buf<u16>,
    ) -> JsResult<OperandCwd<'a>> {
        if !needs_cwd(operand) {
            return Ok(OperandCwd::NotRead);
        }
        let first = cwd(global, storage)?;
        if !is_trivial_arg(operand) {
            return Ok(OperandCwd::Against(first));
        }
        if first.len() > 0 && first.at(0) == CHAR_FORWARD_SLASH as u32 {
            return Ok(OperandCwd::Returned(first));
        }
        first.keep_alive();
        Ok(OperandCwd::Against(cwd(global, fallback_storage)?))
    }

    /// `resolve()` once the arguments have been reduced to the strings that
    /// participate, in call order (cwd first when it was consulted).
    pub(super) fn resolve<'o, C: Unit>(
        parts: &[Chars<'_>],
        out: &'o mut Buf<C>,
    ) -> Result<&'o [C], TooLong> {
        let mut joined_len = 0usize;
        for part in parts {
            joined_len += part.len() + 1;
        }
        let joined_len = check_length(joined_len)?;

        let mut joined: Buf<C> = Buf::new();
        let j = reserve(&mut joined, joined_len);
        let mut p = 0;
        for part in parts {
            p += part.copy_to(&mut j[p..]);
            j[p] = ch(CHAR_FORWARD_SLASH);
            p += 1;
        }

        let resolved_absolute =
            !parts.is_empty() && parts[0].len() > 0 && parts[0].at(0) == CHAR_FORWARD_SLASH as u32;

        // Normalize the path
        let res = reserve(out, joined_len + 1);
        res[0] = ch(CHAR_FORWARD_SLASH);
        let len = normalize_string::<false, C>(&joined, !resolved_absolute, &mut res[1..]);

        if resolved_absolute {
            return Ok(&out[..len + 1]);
        }
        if len > 0 {
            return Ok(&out[1..len + 1]);
        }
        out[0] = ch(CHAR_DOT);
        Ok(&out[..1])
    }

    /// `posix.resolve(path)` for a single already-validated string and its
    /// [`operand_cwd`].
    pub(super) fn resolve1<'o, C: Unit>(
        path: Chars<'_>,
        cwd: &OperandCwd<'_>,
        out: &'o mut Buf<C>,
    ) -> Result<&'o [C], TooLong> {
        let mut parts: [Chars<'_>; 2] = [Chars::Latin1(&[]), Chars::Latin1(&[])];
        let mut n = 0;
        match cwd {
            OperandCwd::Returned(cwd) => {
                // Fast path for current directory: lib/path.js returns `posixCwd()` un-normalized.
                let o = reserve(out, cwd.len());
                cwd.chars.copy_to(o);
                return Ok(&out[..]);
            }
            OperandCwd::Against(cwd) => {
                parts[n] = cwd.chars;
                n += 1;
            }
            OperandCwd::NotRead => {}
        }
        if path.len() > 0 {
            parts[n] = path;
            n += 1;
        }
        resolve::<C>(&parts[..n], out)
    }

    pub(super) fn normalize<'o, C: Unit>(path: &[C], out: &'o mut Buf<C>) -> &'o [C] {
        // Caller handles path.length === 0.
        let is_absolute = path[0].as_u32() == CHAR_FORWARD_SLASH as u32;
        let trailing_separator = path[path.len() - 1].as_u32() == CHAR_FORWARD_SLASH as u32;

        // Normalize the path
        let res = reserve(out, path.len() + 2);
        res[0] = ch(CHAR_FORWARD_SLASH);
        let mut len = normalize_string::<false, C>(path, !is_absolute, &mut res[1..]);

        if len == 0 {
            if is_absolute {
                return &out[..1];
            }
            out[0] = ch(CHAR_DOT);
            out[1] = ch(CHAR_FORWARD_SLASH);
            return &out[..if trailing_separator { 2 } else { 1 }];
        }
        if trailing_separator {
            out[1 + len] = ch(CHAR_FORWARD_SLASH);
            len += 1;
        }

        if is_absolute {
            &out[..len + 1]
        } else {
            &out[1..len + 1]
        }
    }

    pub(super) fn join<'o, C: Unit>(
        paths: &[Chars<'_>],
        joined: &mut Buf<C>,
        out: &'o mut Buf<C>,
    ) -> Result<&'o [C], TooLong> {
        // Caller has removed empty arguments and handled the none-left case.
        let mut joined_len = paths.len() - 1;
        for path in paths {
            joined_len += path.len();
        }
        let joined_len = check_length(joined_len)?;
        let j = reserve(joined, joined_len);
        let mut p = 0;
        for (i, path) in paths.iter().enumerate() {
            if i != 0 {
                j[p] = ch(CHAR_FORWARD_SLASH);
                p += 1;
            }
            p += path.copy_to(&mut j[p..]);
        }
        Ok(normalize::<C>(joined, out))
    }

    /// `from_cwd` / `to_cwd` are the [`operand_cwd`]s of the two `resolve()` calls
    /// lib/path.js makes.
    pub(super) fn relative<C: Unit>(
        global: &JSGlobalObject,
        from_in: Chars<'_>,
        to_in: Chars<'_>,
        from_cwd: &OperandCwd<'_>,
        to_cwd: &OperandCwd<'_>,
    ) -> JsResult<JSValue> {
        // Trim leading forward slashes.
        let mut from_buf: Buf<C> = Buf::new();
        let mut to_buf: Buf<C> = Buf::new();
        let from = resolve1::<C>(from_in, from_cwd, &mut from_buf)
            .map_err(|_| global.throw_string_too_long())?;
        let to = resolve1::<C>(to_in, to_cwd, &mut to_buf)
            .map_err(|_| global.throw_string_too_long())?;

        if from == to {
            return Ok(empty_string(global));
        }

        let from_start: Index = 1;
        let from_end: Index = from.len() as Index;
        let from_len: Index = from_end - from_start;
        let to_start: Index = 1;
        let to_len: Index = to.len() as Index - to_start;

        // Compare paths to find the longest common path from root
        let length: Index = if from_len < to_len { from_len } else { to_len };
        // Node's loop breaks at the first mismatch and remembers the last '/' before it.
        let mut i: Index = if length > 0 {
            common_prefix_length(
                &from[from_start as usize..],
                &to[to_start as usize..],
                length as usize,
            ) as Index
        } else {
            0
        };
        let mut last_common_sep: Index = i - 1;
        while last_common_sep >= 0
            && from[(from_start + last_common_sep) as usize].as_u32() != CHAR_FORWARD_SLASH as u32
        {
            last_common_sep -= 1;
        }
        if i == length {
            if to_len > length {
                if to[(to_start + i) as usize].as_u32() == CHAR_FORWARD_SLASH as u32 {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='/foo/bar'; to='/foo/bar/baz'
                    return to_js(global, &to[(to_start + i + 1) as usize..]);
                }
                if i == 0 {
                    // We get here if `from` is the root
                    // For example: from='/'; to='/foo'
                    return to_js(global, &to[(to_start + i) as usize..]);
                }
            } else if from_len > length {
                if from[(from_start + i) as usize].as_u32() == CHAR_FORWARD_SLASH as u32 {
                    // We get here if `to` is the exact base path for `from`.
                    // For example: from='/foo/bar/baz'; to='/foo/bar'
                    last_common_sep = i;
                } else if i == 0 {
                    // We get here if `to` is the root.
                    // For example: from='/foo/bar'; to='/'
                    last_common_sep = 0;
                }
            }
        }

        // Generate the relative path based on the path difference between `to`
        // and `from`.
        let mut up = 0usize;
        i = from_start + last_common_sep + 1;
        while i <= from_end {
            if i == from_end || from[i as usize].as_u32() == CHAR_FORWARD_SLASH as u32 {
                up += 1;
            }
            i += 1;
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts.
        let rest = &to[(to_start + last_common_sep) as usize..];
        let mut out: Buf<C> = Buf::new();
        let o = reserve(&mut out, up * 3 + rest.len());
        let mut p = 0;
        for k in 0..up {
            if k != 0 {
                o[p] = ch(CHAR_FORWARD_SLASH);
                p += 1;
            }
            o[p] = ch(CHAR_DOT);
            o[p + 1] = ch(CHAR_DOT);
            p += 2;
        }
        p += copy_units(&mut o[p..], rest);
        to_js(global, &out[..p])
    }

    pub(super) fn dirname(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
        // Caller handles path.length === 0.
        with_chars!(path.chars, |p| {
            let len = p.len() as Index;
            let has_root = p[0].as_u32() == CHAR_FORWARD_SLASH as u32;
            let mut end: Index = -1;
            let mut matched_slash = true;
            let mut i: Index = len - 1;
            while i >= 1 {
                if p[i as usize].as_u32() == CHAR_FORWARD_SLASH as u32 {
                    if !matched_slash {
                        end = i;
                        break;
                    }
                } else {
                    // We saw the first non-path separator
                    matched_slash = false;
                }
                i -= 1;
            }

            if end == -1 {
                return if has_root {
                    substring(global, path, 0, 1)
                } else {
                    dot_string(global)
                };
            }
            if has_root && end == 1 {
                // '//': path[0] is '/', and end === 1 was reached at a separator, so path[1] is too.
                return substring(global, path, 0, 2);
            }
            substring(global, path, 0, end)
        })
    }

    pub(super) fn parse(path: &Input<'_>, ret: &mut Parsed) {
        // Caller handles path.length === 0 and pre-fills every field with ''.
        with_chars!(path.chars, |p| {
            let is_absolute = p[0].as_u32() == CHAR_FORWARD_SLASH as u32;
            let start: Index = if is_absolute { 1 } else { 0 };
            if is_absolute {
                ret.root = Parsed::range(0, 1);
            }
            let mut start_dot: Index = -1;
            let mut start_part: Index = 0;
            let mut end: Index = -1;
            let mut matched_slash = true;
            let mut i: Index = p.len() as Index - 1;

            // Track the state of characters (if any) we see before our first dot and
            // after any path separator we find
            let mut pre_dot_state: Index = 0;

            // Get non-dir info
            while i >= start {
                let code = p[i as usize].as_u32();
                if code == CHAR_FORWARD_SLASH as u32 {
                    // If we reached a path separator that was not part of a set of path
                    // separators at the end of the string, stop now
                    if !matched_slash {
                        start_part = i + 1;
                        break;
                    }
                    i -= 1;
                    continue;
                }
                if end == -1 {
                    // We saw the first non-path separator, mark this as the end of our
                    // extension
                    matched_slash = false;
                    end = i + 1;
                }
                if code == CHAR_DOT as u32 {
                    // If this is our first dot, mark it as the start of our extension
                    if start_dot == -1 {
                        start_dot = i;
                    } else if pre_dot_state != 1 {
                        pre_dot_state = 1;
                    }
                } else if start_dot != -1 {
                    // We saw a non-dot and non-path separator before our dot, so we should
                    // have a good chance at having a non-empty extension
                    pre_dot_state = -1;
                }
                i -= 1;
            }

            if end != -1 {
                let start = if start_part == 0 && is_absolute {
                    1
                } else {
                    start_part
                };
                if start_dot == -1
                    // We saw a non-dot character immediately before the dot
                    || pre_dot_state == 0
                    // The (right-most) trimmed path component is exactly '..'
                    || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)
                {
                    ret.base = Parsed::range(start, end);
                    ret.name = Parsed::range(start, end);
                } else {
                    ret.name = Parsed::range(start, start_dot);
                    ret.base = Parsed::range(start, end);
                    ret.ext = Parsed::range(start_dot, end);
                }
            }

            if start_part > 0 {
                ret.dir = Parsed::range(0, start_part - 1);
            } else if is_absolute {
                ret.dir = ret.root;
            }
        })
    }
}

// ──────────────────────────────── win32 ─────────────────────────────────

mod win32 {
    use super::*;

    pub(super) const W: bool = true;

    /// The `device` string computed while matching a root in resolve()/normalize().
    /// It is always one of a handful of shapes assembled from slices of `path`
    /// (UNC ones of arbitrary length), so record the shape and materialize on
    /// demand — normalize() needs its length before its content.
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(super) enum DeviceKind {
        /// `''` in resolve(), `undefined` in normalize()
        None,
        /// `path.slice(0, 2)`, e.g. `C:`
        Drive,
        /// `\\${firstPart}` where firstPart is `.` or `?`, e.g. `\\.`
        Namespace,
        /// `\\${firstPart}\${path.slice(last, j)}`, e.g. `\\server\share`
        Unc,
        /// `path.slice(a0, a1)`, e.g. `CON:`
        Reserved,
        /// `\\?\${path.slice(a0, a1)}`, e.g. `\\?\COM1:`
        ReservedNamespace,
    }

    #[derive(Clone, Copy)]
    pub(super) struct Device<'p, C: Unit> {
        pub(super) kind: DeviceKind,
        pub(super) a0: usize,
        pub(super) a1: usize,
        pub(super) b0: usize,
        pub(super) b1: usize,
        pub(super) path: &'p [C],
    }

    impl<'p, C: Unit> Device<'p, C> {
        pub(super) fn none(path: &'p [C]) -> Self {
            Self {
                kind: DeviceKind::None,
                a0: 0,
                a1: 0,
                b0: 0,
                b1: 0,
                path,
            }
        }
        pub(super) fn is_none(&self) -> bool {
            self.kind == DeviceKind::None
        }
        pub(super) fn len(&self) -> usize {
            match self.kind {
                DeviceKind::None => 0,
                DeviceKind::Drive => 2,
                DeviceKind::Namespace => 3,
                DeviceKind::Unc => 2 + (self.a1 - self.a0) + 1 + (self.b1 - self.b0),
                DeviceKind::Reserved => self.a1 - self.a0,
                DeviceKind::ReservedNamespace => 4 + (self.a1 - self.a0),
            }
        }
        /// Writes the device into `out[..self.len()]`.
        pub(super) fn write_to<D: Unit>(&self, out: &mut [D]) -> usize {
            let bs: D = ch(CHAR_BACKWARD_SLASH);
            match self.kind {
                DeviceKind::None => 0,
                DeviceKind::Drive => copy_units(out, &self.path[..2]),
                DeviceKind::Namespace => {
                    out[0] = bs;
                    out[1] = bs;
                    out[2] = D::from_u32(self.path[2].as_u32());
                    3
                }
                DeviceKind::Unc => {
                    out[0] = bs;
                    out[1] = bs;
                    let mut n = 2 + copy_units(&mut out[2..], &self.path[self.a0..self.a1]);
                    out[n] = bs;
                    n += 1;
                    n + copy_units(&mut out[n..], &self.path[self.b0..self.b1])
                }
                DeviceKind::ReservedNamespace => {
                    out[0] = bs;
                    out[1] = bs;
                    out[2] = ch(CHAR_QUESTION_MARK);
                    out[3] = bs;
                    4 + copy_units(&mut out[4..], &self.path[self.a0..self.a1])
                }
                DeviceKind::Reserved => copy_units(out, &self.path[self.a0..self.a1]),
            }
        }
    }

    /// Storage for [`to_lower_case`]; owns the ICU result when one was needed.
    pub(super) struct Lowered<C: Unit> {
        storage: Buf<C>,
        wtf: bun_core::String,
    }

    impl<C: Unit> Lowered<C> {
        #[inline(always)]
        pub(super) fn new() -> Self {
            Self {
                storage: Buf::new(),
                wtf: bun_core::String::EMPTY,
            }
        }
    }

    /// `StringPrototypeToLowerCase(s)`, materialized in `into`.
    pub(super) fn to_lower_case<'s, C: Unit>(s: &[C], into: &'s mut Lowered<C>) -> &'s [C] {
        if C::IS_U16 && !all_ascii(s) {
            return to_lower_case_full(s, into);
        }
        let p = reserve(&mut into.storage, s.len());
        for (d, c) in p.iter_mut().zip(s) {
            let u = c.as_u32();
            // toLowerCase() restricted to Latin-1 input is 1:1 and stays within Latin-1
            // (U+0130 is the only BMP code point that lower-cases to a different length).
            let l = if (b'A' as u32..=b'Z' as u32).contains(&u)
                || ((0xC0..=0xDE).contains(&u) && u != 0xD7)
            {
                u + 0x20
            } else {
                u
            };
            *d = C::from_u32(l);
        }
        &into.storage[..]
    }

    /// The full Unicode case mapping, for UTF-16 input containing non-ASCII units.
    #[cold]
    #[inline(never)]
    fn to_lower_case_full<'s, C: Unit>(s: &[C], into: &'s mut Lowered<C>) -> &'s [C] {
        debug_assert!(C::IS_U16);
        into.wtf = bun_core::String::borrow_utf16(bytemuck::cast_slice(s)).to_lower_case();
        if into.wtf.is_utf16() {
            return bytemuck::cast_slice(into.wtf.utf16());
        }
        let n = into.wtf.length();
        let p = reserve(&mut into.storage, n);
        copy_units(p, into.wtf.latin1());
        &into.storage[..]
    }

    /// `StringPrototypeToLowerCase(a) === StringPrototypeToLowerCase(b)`
    pub(super) fn equals_case_folded<A: Unit, B: Unit>(a: &[A], b: &[B]) -> bool {
        if all_ascii(a) && all_ascii(b) {
            return a.len() == b.len()
                && a.iter().zip(b).all(|(x, y)| {
                    let (x, y) = (x.as_u32(), y.as_u32());
                    let lx = if (b'A' as u32..=b'Z' as u32).contains(&x) {
                        x | 0x20
                    } else {
                        x
                    };
                    let ly = if (b'A' as u32..=b'Z' as u32).contains(&y) {
                        y | 0x20
                    } else {
                        y
                    };
                    lx == ly
                });
        }
        equals_case_folded_full(a, b)
    }

    #[cold]
    #[inline(never)]
    fn equals_case_folded_full<A: Unit, B: Unit>(a: &[A], b: &[B]) -> bool {
        let mut la = Lowered::<A>::new();
        let mut lb = Lowered::<B>::new();
        span_equals(to_lower_case(a, &mut la), to_lower_case(b, &mut lb))
    }

    /// The "Try to match a root" prologue shared by resolve() and normalize().
    pub(super) struct Root<'p, C: Unit> {
        pub(super) root_end: usize,
        pub(super) is_absolute: bool,
        pub(super) device: Device<'p, C>,
    }

    /// win32.resolve()'s prologue verbatim; win32.normalize()'s differs only in
    /// returning early for a bare UNC root (`j === len`), which it detects
    /// afterwards as `device.kind == Unc && root_end == len`.
    #[inline]
    pub(super) fn match_root<C: Unit>(path: &[C]) -> Root<'_, C> {
        let mut r = Root {
            root_end: 0,
            is_absolute: false,
            device: Device::none(path),
        };
        let len = path.len();
        let code = path[0].as_u32();

        // Try to match a root
        if len == 1 {
            if is_path_separator::<W>(code) {
                // `path` contains just a path separator
                r.root_end = 1;
                r.is_absolute = true;
            }
            return r;
        }
        if is_path_separator::<W>(code) {
            // Possible UNC root

            // If we started with a separator, we know we at least have an
            // absolute path of some kind (UNC or otherwise)
            r.is_absolute = true;

            if is_path_separator::<W>(path[1].as_u32()) {
                // Matched double path separator at beginning
                let mut j = 2;
                let mut last = j;
                // Match 1 or more non-path separators
                while j < len && !is_path_separator::<W>(path[j].as_u32()) {
                    j += 1;
                }
                if j < len && j != last {
                    let (first_part_start, first_part_end) = (last, j);
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while j < len && is_path_separator::<W>(path[j].as_u32()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while j < len && !is_path_separator::<W>(path[j].as_u32()) {
                            j += 1;
                        }
                        if j == len || j != last {
                            let first_part = &path[first_part_start..first_part_end];
                            if !(first_part.len() == 1
                                && (first_part[0].as_u32() == CHAR_DOT as u32
                                    || first_part[0].as_u32() == CHAR_QUESTION_MARK as u32))
                            {
                                // We matched a UNC root
                                r.device = Device {
                                    kind: DeviceKind::Unc,
                                    a0: first_part_start,
                                    a1: first_part_end,
                                    b0: last,
                                    b1: j,
                                    path,
                                };
                                r.root_end = j;
                            } else {
                                // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
                                r.device.kind = DeviceKind::Namespace;
                                r.root_end = 4;
                            }
                        }
                    }
                }
            } else {
                r.root_end = 1;
            }
        } else if is_windows_device_root(code) && path[1].as_u32() == CHAR_COLON as u32 {
            // Possible device root
            r.device.kind = DeviceKind::Drive;
            r.root_end = 2;
            if len > 2 && is_path_separator::<W>(path[2].as_u32()) {
                // Treat separator following drive name as an absolute path
                // indicator
                r.is_absolute = true;
                r.root_end = 3;
            }
        }
        r
    }

    #[derive(Clone, Copy)]
    pub(super) struct ResolvePart<'a> {
        pub(super) chars: Chars<'a>,
        pub(super) root_end: usize,
    }

    pub(super) struct ResolveState<'a> {
        /// in visit (reverse) order
        pub(super) parts: SmallVec<[ResolvePart<'a>; 16]>,
        pub(super) device: SmallVec<[u16; 32]>,
        pub(super) resolved_absolute: bool,
        pub(super) all_8bit: bool,
        /// "Fast path for current directory": the cwd string to return as-is.
        pub(super) return_cwd: Option<Input<'a>>,
    }

    impl<'a> ResolveState<'a> {
        #[inline(always)]
        pub(super) fn new() -> Self {
            Self {
                parts: SmallVec::new(),
                device: SmallVec::new(),
                resolved_absolute: false,
                all_8bit: true,
                return_cwd: None,
            }
        }
    }

    fn append_device<C: Unit>(out: &mut SmallVec<[u16; 32]>, device: &Device<'_, C>) {
        let start = out.len();
        out.resize(start + device.len(), 0);
        device.write_to(&mut out[start..]);
    }

    /// `path = process.env[`=${resolvedDevice}`] || process.cwd()`, and the drive check that follows.
    pub(super) fn drive_cwd<'a>(
        global: &JSGlobalObject,
        resolved_device: &[u16],
        cwd: &mut Option<Input<'a>>,
        storage: &'a mut Buf<u16>,
    ) -> JsResult<Input<'a>> {
        // Windows has the concept of drive-specific current working directories, which
        // cmd.exe publishes as hidden `=C:` environment variables. They can only exist on
        // Windows (POSIX environments reject names containing '='), so only look there.
        #[cfg(windows)]
        {
            let mut key: SmallVec<[u16; 40]> = SmallVec::new();
            key.push(b'=' as u16);
            key.extend_from_slice(resolved_device);
            key.push(0);
            if let Some(value) = bun_sys::windows::getenv_w(&key).filter(|v| !v.is_empty()) {
                // Verify that it actually points to our drive. If not, default to the
                // drive's root.
                let other_drive = value.len() > 2
                    && value[2] == CHAR_BACKWARD_SLASH as u16
                    && !equals_case_folded(&value[..2], resolved_device);
                if other_drive {
                    return Ok(drive_root(resolved_device, storage));
                }
                reserve(storage, value.len()).copy_from_slice(&value);
                let storage: &'a Buf<u16> = storage;
                return Ok(Input {
                    string: JSValue::ZERO,
                    chars: Chars::Utf16(&storage[..]),
                });
            }
        }

        // Verify that a cwd was found and that it actually points
        // to our drive. If not, default to the drive's root.
        let Some(out) = get_cwd_or_undefined(global)? else {
            return Ok(drive_root(resolved_device, storage));
        };
        *cwd = Some(out);
        let other_drive = with_chars!(out.chars, |p| {
            p.len() > 2
                && p[2].as_u32() == CHAR_BACKWARD_SLASH as u32
                && !equals_case_folded(js_slice(p, 0, 2), resolved_device)
        });
        if other_drive {
            return Ok(drive_root(resolved_device, storage));
        }
        Ok(out)
    }

    /// `${resolvedDevice}\`, built in `storage`.
    fn drive_root<'a>(resolved_device: &[u16], storage: &'a mut Buf<u16>) -> Input<'a> {
        let p = reserve(storage, resolved_device.len() + 1);
        p[..resolved_device.len()].copy_from_slice(resolved_device);
        p[resolved_device.len()] = CHAR_BACKWARD_SLASH as u16;
        let storage: &'a Buf<u16> = storage;
        Input {
            string: JSValue::ZERO,
            chars: Chars::Utf16(&storage[..]),
        }
    }

    /// The argument-scanning half of `win32.resolve()`. `get_arg(i)` produces
    /// argument `i` (running validateString for the JS entry point). The
    /// `process.cwd()` string, if one was read, is recorded in `cwd` so the
    /// caller can keep it alive until the result has been built.
    pub(super) fn resolve_scan<'a>(
        global: &JSGlobalObject,
        arg_count: Index,
        mut get_arg: impl FnMut(Index) -> JsResult<Input<'a>>,
        st: &mut ResolveState<'a>,
        cwd: &mut Option<Input<'a>>,
        cwd_storage: &'a mut Buf<u16>,
    ) -> JsResult<()> {
        let mut cwd_storage = Some(cwd_storage);
        // Argument 0 once seen, so the fast-path check need not fetch it again.
        let mut first_arg: Option<Input<'a>> = None;
        for i in (-1..arg_count).rev() {
            let path: Input<'a>;
            if i >= 0 {
                path = get_arg(i)?;
                if i == 0 {
                    first_arg = Some(path);
                }

                // Skip empty entries
                if path.len() == 0 {
                    continue;
                }
            } else if st.device.is_empty() {
                path = get_cwd(global)?;
                *cwd = Some(path);
                // Fast path for current directory
                if arg_count == 0
                    || (arg_count == 1 && path.len() > 0 && is_path_separator::<W>(path.at(0)))
                {
                    let trivial = match first_arg {
                        None => true, // arg_count == 0
                        Some(arg) => posix::is_trivial_arg(&arg.chars),
                    };
                    if trivial {
                        st.return_cwd = Some(path);
                        return Ok(());
                    }
                }
            } else {
                // Windows has the concept of drive-specific current working
                // directories. If we've resolved a drive letter but not yet an
                // absolute path, get cwd for that drive, or the process cwd if
                // the drive cwd is not available. We're sure the device is not
                // a UNC path at this points, because UNC paths are always absolute.
                let device: SmallVec<[u16; 32]> = st.device.clone();
                path = drive_cwd(
                    global,
                    &device,
                    cwd,
                    cwd_storage.take().expect("i == -1 is visited once"),
                )?;
            }

            if path.len() == 0 {
                // An empty process.cwd(): no root, no device, contributes only a separator.
                if !st.resolved_absolute {
                    st.parts.push(ResolvePart {
                        chars: path.chars,
                        root_end: 0,
                    });
                    st.all_8bit &= path.is_8bit();
                }
                continue;
            }

            let stop = with_chars!(path.chars, |p| {
                let root = match_root(p);

                if !root.device.is_none() {
                    if !st.device.is_empty() {
                        let mut device: SmallVec<[u16; 32]> = SmallVec::new();
                        append_device(&mut device, &root.device);
                        if !equals_case_folded(&device[..], &st.device[..]) {
                            // This path points to another device so it is not applicable
                            continue;
                        }
                    } else {
                        append_device(&mut st.device, &root.device);
                        st.all_8bit &= path.is_8bit() || all_ascii(&st.device[..]);
                    }
                }

                if st.resolved_absolute {
                    !st.device.is_empty()
                } else {
                    st.parts.push(ResolvePart {
                        chars: path.chars,
                        root_end: root.root_end,
                    });
                    st.all_8bit &= path.is_8bit();
                    st.resolved_absolute = root.is_absolute;
                    root.is_absolute && !st.device.is_empty()
                }
            });
            if stop {
                break;
            }
        }
        Ok(())
    }

    /// The string-building half of `win32.resolve()`.
    pub(super) fn resolve_build<'o, C: Unit>(
        st: &ResolveState<'_>,
        out: &'o mut Buf<C>,
    ) -> Result<&'o [C], TooLong> {
        let mut tail_len = 0usize;
        for part in &st.parts {
            tail_len += part.chars.len() - part.root_end + 1;
        }
        let device_len = st.device.len();
        check_length(device_len + 1 + tail_len)?;

        let mut tail: Buf<C> = Buf::new();
        let t = reserve(&mut tail, tail_len);
        let mut p = 0;
        for part in st.parts.iter().rev() {
            p += part.chars.slice_from(part.root_end).copy_to(&mut t[p..]);
            t[p] = ch(CHAR_BACKWARD_SLASH);
            p += 1;
        }

        // At this point the path should be resolved to a full absolute path,
        // but handle relative paths to be safe (might happen when process.cwd()
        // fails)

        let res = reserve(out, device_len + 1 + tail_len + 1);
        let mut q = copy_units(res, &st.device[..]);
        if st.resolved_absolute {
            res[q] = ch(CHAR_BACKWARD_SLASH);
            q += 1;
        }

        // Normalize the tail path
        let len = normalize_string::<W, C>(&tail, !st.resolved_absolute, &mut res[q..]);

        let mut total = q + len;
        if total == 0 {
            res[0] = ch(CHAR_DOT);
            total = 1;
        }
        Ok(&out[..total])
    }

    /// The resolve() fast path's return value as an owned copy: `path` itself on
    /// Windows, `StringPrototypeReplace(path, /\//g, '\\')` elsewhere.
    pub(super) fn returned_cwd<'o, C: Unit, S: Unit>(cwd: &[S], out: &'o mut Buf<C>) -> &'o [C] {
        let o = reserve(out, cwd.len());
        for (d, c) in o.iter_mut().zip(cwd) {
            let u = c.as_u32();
            *d = if !cfg!(windows) && u == CHAR_FORWARD_SLASH as u32 {
                ch(CHAR_BACKWARD_SLASH)
            } else {
                C::from_u32(u)
            };
        }
        &out[..]
    }

    /// `win32.resolve(path)` for internal callers with an already-validated
    /// string: scans, then builds into whichever of `out8`/`out16` matches. The
    /// result is always an owned copy, never a view of the cwd string.
    pub(super) fn resolve<'o>(
        global: &JSGlobalObject,
        path: Chars<'o>,
        cwd: &mut Option<Input<'o>>,
        out8: &'o mut Buf<u8>,
        out16: &'o mut Buf<u16>,
        cwd_storage: &'o mut Buf<u16>,
    ) -> JsResult<Chars<'o>> {
        let mut st = ResolveState::new();
        resolve_scan(
            global,
            1,
            |_| {
                Ok(Input {
                    string: JSValue::ZERO,
                    chars: path,
                })
            },
            &mut st,
            cwd,
            cwd_storage,
        )?;
        if let Some(cwd) = st.return_cwd {
            return Ok(match cwd.chars {
                Chars::Latin1(s) => Chars::Latin1(returned_cwd(s, out8)),
                Chars::Utf16(s) => Chars::Utf16(returned_cwd(s, out16)),
            });
        }
        let too_long = |_| global.throw_string_too_long();
        Ok(if st.all_8bit {
            Chars::Latin1(resolve_build::<u8>(&st, out8).map_err(too_long)?)
        } else {
            Chars::Utf16(resolve_build::<u16>(&st, out16).map_err(too_long)?)
        })
    }

    /// `colon_index` is `StringPrototypeIndexOf(path, ':')` when the caller
    /// already knows it (join()); lib/path.js recomputes it at each use.
    pub(super) fn normalize<'o, C: Unit>(
        path: &'o [C],
        out: &'o mut Buf<C>,
        colon_index: Option<Index>,
    ) -> &'o [C] {
        let len = path.len();
        // Caller handles len === 0.
        let code = path[0].as_u32();

        // Try to match a root
        if len == 1 {
            // `path` contains just a single char, exit early to avoid
            // unnecessary work
            if code == CHAR_FORWARD_SLASH as u32 {
                let o = reserve(out, 1);
                o[0] = ch(CHAR_BACKWARD_SLASH);
                return &out[..];
            }
            return path;
        }

        let root = match_root(path);
        let mut device = root.device;
        let mut root_end = root.root_end;
        let is_absolute = root.is_absolute;
        let colon_index = colon_index.unwrap_or_else(|| index_of(path, CHAR_COLON, 0));

        if device.kind == DeviceKind::Namespace {
            // Special case: handle \\?\COM1: or similar reserved device paths
            let possible_device = js_slice(path, 4, colon_index + 1);
            if is_windows_reserved_name(js_slice(
                possible_device,
                0,
                possible_device.len() as Index - 1,
            )) {
                device.kind = DeviceKind::ReservedNamespace;
                device.a0 = 4;
                device.a1 = 4 + possible_device.len();
                root_end = 4 + possible_device.len();
            }
        } else if device.kind == DeviceKind::Unc && root_end == len {
            // We matched a UNC root only
            // Return the normalized version of the UNC root since there
            // is nothing left to process
            let o = reserve(out, device.len() + 1);
            let n = device.write_to(o);
            o[n] = ch(CHAR_BACKWARD_SLASH);
            return &out[..n + 1];
        } else if !is_path_separator::<W>(code) {
            if colon_index > 0 {
                if device.kind == DeviceKind::Drive {
                    // isWindowsDeviceRoot(code) && colonIndex === 1, handled by match_root()
                } else if is_windows_reserved_name(&path[..colon_index as usize]) {
                    device.kind = DeviceKind::Reserved;
                    device.a0 = 0;
                    device.a1 = colon_index as usize + 1;
                    root_end = colon_index as usize + 1;
                }
            }
        }

        // Output layout: [.\][device][\][tail][\] — the tail is written first at a fixed
        // offset and whichever prefix applies is then written immediately before it.
        let device_len = device.len();
        let tail_start = 2 + device_len + 1;
        let buf = reserve(out, tail_start + (len - root_end) + 2);
        let mut tail_len = if root_end < len {
            let (_, tail) = buf.split_at_mut(tail_start);
            normalize_string::<W, C>(&path[root_end..], !is_absolute, tail)
        } else {
            0
        };
        if tail_len == 0 && !is_absolute {
            buf[tail_start] = ch(CHAR_DOT);
            tail_len = 1;
        }
        if tail_len > 0 && is_path_separator::<W>(path[len - 1].as_u32()) {
            buf[tail_start + tail_len] = ch(CHAR_BACKWARD_SLASH);
            tail_len += 1;
        }
        let tail_end = tail_start + tail_len;

        let mut head = tail_start;
        macro_rules! prepend_dot_slash {
            () => {{
                head -= 2;
                buf[head] = ch(CHAR_DOT);
                buf[head + 1] = ch(CHAR_BACKWARD_SLASH);
            }};
        }
        macro_rules! prepend_device {
            () => {{
                head -= device_len;
                device.write_to(&mut buf[head..]);
            }};
        }

        if !is_absolute && device.is_none() && colon_index != -1 {
            // If the original path was not absolute and if we have not been able to
            // resolve it relative to a particular device, we need to ensure that the
            // `tail` has not become something that Windows might interpret as an
            // absolute path. See CVE-2024-36139.
            if tail_len >= 2
                && is_windows_device_root(buf[tail_start].as_u32())
                && buf[tail_start + 1].as_u32() == CHAR_COLON as u32
            {
                prepend_dot_slash!();
                return &out[head..tail_end];
            }
            let mut index = colon_index;

            loop {
                if index == len as Index - 1
                    || is_path_separator::<W>(path[index as usize + 1].as_u32())
                {
                    prepend_dot_slash!();
                    return &out[head..tail_end];
                }
                index = index_of(path, CHAR_COLON, index + 1);
                if index == -1 {
                    break;
                }
            }
        }
        if is_windows_reserved_name(js_slice(path, 0, colon_index)) {
            prepend_device!();
            prepend_dot_slash!();
            return &out[head..tail_end];
        }
        if device.is_none() {
            if is_absolute {
                head -= 1;
                buf[head] = ch(CHAR_BACKWARD_SLASH);
            }
            return &out[head..tail_end];
        }
        if is_absolute {
            head -= 1;
            buf[head] = ch(CHAR_BACKWARD_SLASH);
        }
        prepend_device!();
        &out[head..tail_end]
    }

    pub(super) fn join<'o, C: Unit>(
        paths: &[Chars<'_>],
        joined_buf: &'o mut Buf<C>,
        out: &'o mut Buf<C>,
    ) -> Result<&'o [C], TooLong> {
        // Caller has removed empty arguments and handled the none-left case.
        let mut joined_len = paths.len() - 1;
        for path in paths {
            joined_len += path.len();
        }
        let joined_len = check_length(joined_len)?;
        let base = reserve(joined_buf, joined_len);
        {
            let mut p = 0;
            for (i, path) in paths.iter().enumerate() {
                if i != 0 {
                    base[p] = ch(CHAR_BACKWARD_SLASH);
                    p += 1;
                }
                p += path.copy_to(&mut base[p..]);
            }
        }
        let mut joined_start = 0usize;
        let first_part = paths[0];

        // Make sure that the joined path doesn't start with two slashes, because
        // normalize() will mistake it for a UNC path then.
        //
        // This step is skipped when it is very clear that the user actually
        // intended to point at a UNC path. This is assumed when the first
        // non-empty string arguments starts with exactly two slashes followed by
        // at least one more non-slash character.
        //
        // Note that for normalize() to treat a path as a UNC path it needs to
        // have at least 2 components, so we don't filter for that here.
        // This means that the user can use join to construct UNC paths from
        // a server name and a share name; for example:
        //   path.join('//server', 'share') -> '\\\\server\\share\\')
        let mut needs_replace = true;
        let mut slash_count = 0usize;
        if is_path_separator::<W>(first_part.at(0)) {
            slash_count += 1;
            let first_len = first_part.len();
            if first_len > 1 && is_path_separator::<W>(first_part.at(1)) {
                slash_count += 1;
                if first_len > 2 {
                    if is_path_separator::<W>(first_part.at(2)) {
                        slash_count += 1;
                    } else {
                        // We matched a UNC path in the first part
                        needs_replace = false;
                    }
                }
            }
        }
        if needs_replace {
            // Find any more consecutive slashes we need to replace
            while slash_count < joined_len && is_path_separator::<W>(base[slash_count].as_u32()) {
                slash_count += 1;
            }

            // Replace the slashes if needed
            if slash_count >= 2 {
                // joined = `\\${StringPrototypeSlice(joined, slashCount)}`
                base[slash_count - 1] = ch(CHAR_BACKWARD_SLASH);
                joined_start = slash_count - 1;
            }
        }
        let joined = &mut base[joined_start..];

        // Skip normalization when reserved device names are present.
        // lib/path.js splits `joined` on backslashes and tests each part up to its first colon;
        // visiting each colon and looking back for the start of its part is equivalent.
        let first_colon = index_of(joined, CHAR_COLON, 0);
        let mut colon = first_colon;
        while colon != -1 {
            // Reserved names are at most 4 characters, so looking back 5 is enough to decide.
            let mut part_start = colon as usize;
            let limit = (colon - 5).max(0) as usize;
            while part_start > limit
                && joined[part_start - 1].as_u32() != CHAR_BACKWARD_SLASH as u32
                && joined[part_start - 1].as_u32() != CHAR_COLON as u32
            {
                part_start -= 1;
            }
            // Otherwise: an earlier colon in this part, or a part longer than any reserved name.
            if part_start == 0 || joined[part_start - 1].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                if is_windows_reserved_name(&joined[part_start..colon as usize]) {
                    // Replace forward slashes with backslashes
                    for c in joined.iter_mut() {
                        if c.as_u32() == CHAR_FORWARD_SLASH as u32 {
                            *c = ch(CHAR_BACKWARD_SLASH);
                        }
                    }
                    return Ok(&joined_buf[joined_start..joined_len]);
                }
            }
            colon = index_of(joined, CHAR_COLON, colon + 1);
        }

        Ok(normalize::<C>(
            &joined_buf[joined_start..joined_len],
            out,
            Some(first_colon),
        ))
    }

    pub(super) fn relative<C: Unit>(
        global: &JSGlobalObject,
        from_orig: &[C],
        to_orig: &[C],
    ) -> JsResult<JSValue> {
        if from_orig == to_orig {
            return Ok(empty_string(global));
        }

        let mut from_lower = Lowered::<C>::new();
        let mut to_lower = Lowered::<C>::new();
        let from = to_lower_case(from_orig, &mut from_lower);
        let to = to_lower_case(to_orig, &mut to_lower);

        if from == to {
            return Ok(empty_string(global));
        }

        if from_orig.len() != from.len() || to_orig.len() != to.len() {
            return relative_case_mapped_lengths_differ(global, from_orig, to_orig);
        }

        // Trim any leading backslashes
        let mut from_start: Index = 0;
        while from_start < from.len() as Index
            && from[from_start as usize].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            from_start += 1;
        }
        // Trim trailing backslashes (applicable to UNC paths only)
        let mut from_end: Index = from.len() as Index;
        while from_end - 1 > from_start
            && from[(from_end - 1) as usize].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            from_end -= 1;
        }
        let from_len: Index = from_end - from_start;

        // Trim any leading backslashes
        let mut to_start: Index = 0;
        while to_start < to.len() as Index
            && to[to_start as usize].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            to_start += 1;
        }
        // Trim trailing backslashes (applicable to UNC paths only)
        let mut to_end: Index = to.len() as Index;
        while to_end - 1 > to_start
            && to[(to_end - 1) as usize].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            to_end -= 1;
        }
        let to_len: Index = to_end - to_start;

        // Compare paths to find the longest common path from root
        let length: Index = if from_len < to_len { from_len } else { to_len };
        // Node's loop breaks at the first mismatch and remembers the last '\\' before it.
        let mut i: Index = if length > 0 {
            common_prefix_length(
                &from[from_start as usize..],
                &to[to_start as usize..],
                length as usize,
            ) as Index
        } else {
            0
        };
        let mut last_common_sep: Index = i - 1;
        while last_common_sep >= 0
            && from[(from_start + last_common_sep) as usize].as_u32() != CHAR_BACKWARD_SLASH as u32
        {
            last_common_sep -= 1;
        }

        // We found a mismatch before the first common path separator was seen, so
        // return the original `to`.
        if i != length {
            if last_common_sep == -1 {
                return to_js(global, to_orig);
            }
        } else {
            if to_len > length {
                if to[(to_start + i) as usize].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='C:\\foo\\bar'; to='C:\\foo\\bar\\baz'
                    return to_js(global, &to_orig[(to_start + i + 1) as usize..]);
                }
                if i == 2 {
                    // We get here if `from` is the device root.
                    // For example: from='C:\\'; to='C:\\foo'
                    return to_js(global, &to_orig[(to_start + i) as usize..]);
                }
            }
            if from_len > length {
                if from[(from_start + i) as usize].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                    // We get here if `to` is the exact base path for `from`.
                    // For example: from='C:\\foo\\bar'; to='C:\\foo'
                    last_common_sep = i;
                } else if i == 2 {
                    // We get here if `to` is the device root.
                    // For example: from='C:\\foo\\bar'; to='C:\\'
                    last_common_sep = 3;
                }
            }
            if last_common_sep == -1 {
                last_common_sep = 0;
            }
        }

        // Generate the relative path based on the path difference between `to` and
        // `from`
        let mut up = 0usize;
        i = from_start + last_common_sep + 1;
        while i <= from_end {
            if i == from_end || from[i as usize].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                up += 1;
            }
            i += 1;
        }

        to_start += last_common_sep;

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts
        if up > 0 {
            let rest = js_slice(to_orig, to_start, to_end);
            let mut out: Buf<C> = Buf::new();
            let o = reserve(&mut out, up * 3 + rest.len());
            let mut p = 0;
            for k in 0..up {
                if k != 0 {
                    o[p] = ch(CHAR_BACKWARD_SLASH);
                    p += 1;
                }
                o[p] = ch(CHAR_DOT);
                o[p + 1] = ch(CHAR_DOT);
                p += 2;
            }
            p += copy_units(&mut o[p..], rest);
            return to_js(global, &out[..p]);
        }

        if to_start < to_orig.len() as Index
            && to_orig[to_start as usize].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            to_start += 1;
        }
        to_js(global, js_slice(to_orig, to_start, to_end))
    }

    /// The `fromOrig.length !== from.length || toOrig.length !== to.length`
    /// branch of win32.relative(): only reachable when case mapping changed a
    /// length (U+0130), so it compares split segments case-insensitively.
    #[cold]
    #[inline(never)]
    fn relative_case_mapped_lengths_differ<C: Unit>(
        global: &JSGlobalObject,
        from_orig: &[C],
        to_orig: &[C],
    ) -> JsResult<JSValue> {
        let split = |s: &[C]| -> SmallVec<[(usize, usize); 32]> {
            let mut parts: SmallVec<[(usize, usize); 32]> = SmallVec::new();
            let mut start = 0;
            for i in 0..=s.len() {
                if i == s.len() || s[i].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                    parts.push((start, i));
                    start = i + 1;
                }
            }
            if let Some(&(a, b)) = parts.last() {
                if a == b {
                    parts.pop();
                }
            }
            parts
        };
        let from_split = split(from_orig);
        let to_split = split(to_orig);

        let from_len = from_split.len() as Index;
        let to_len = to_split.len() as Index;
        let length = if from_len < to_len { from_len } else { to_len };

        let mut i: Index = 0;
        while i < length {
            let (fa, fb) = from_split[i as usize];
            let (ta, tb) = to_split[i as usize];
            if !equals_case_folded(&from_orig[fa..fb], &to_orig[ta..tb]) {
                break;
            }
            i += 1;
        }

        let mut out: Buf<C> = Buf::new();
        // ArrayPrototypeJoin(ArrayPrototypeSlice(toSplit, k), '\\')
        let join_to_split_from = |o: &mut [C], mut p: usize, k: Index| -> usize {
            for m in k..to_len {
                if m != k {
                    o[p] = ch(CHAR_BACKWARD_SLASH);
                    p += 1;
                }
                let (ta, tb) = to_split[m as usize];
                p += copy_units(&mut o[p..], &to_orig[ta..tb]);
            }
            p
        };
        if i == 0 {
            return to_js(global, to_orig);
        } else if i == length {
            if to_len > length {
                let o = reserve(&mut out, to_orig.len());
                let p = join_to_split_from(o, 0, i);
                return to_js(global, &out[..p]);
            }
            if from_len > length {
                let ups = (from_len - 1 - i) as usize;
                let o = reserve(&mut out, ups * 3 + 2);
                let mut p = 0;
                for _ in 0..ups {
                    o[p] = ch(CHAR_DOT);
                    o[p + 1] = ch(CHAR_DOT);
                    o[p + 2] = ch(CHAR_BACKWARD_SLASH);
                    p += 3;
                }
                o[p] = ch(CHAR_DOT);
                o[p + 1] = ch(CHAR_DOT);
                return to_js(global, &out[..p + 2]);
            }
            return Ok(empty_string(global));
        }

        let ups = (from_len - i) as usize;
        let o = reserve(&mut out, ups * 3 + to_orig.len());
        let mut p = 0;
        for _ in 0..ups {
            o[p] = ch(CHAR_DOT);
            o[p + 1] = ch(CHAR_DOT);
            o[p + 2] = ch(CHAR_BACKWARD_SLASH);
            p += 3;
        }
        let p = join_to_split_from(o, p, i);
        to_js(global, &out[..p])
    }

    pub(super) fn dirname(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
        // Caller handles len === 0.
        with_chars!(path.chars, |p| {
            let len = p.len() as Index;
            let mut root_end: Index = -1;
            let mut offset: Index = 0;
            let code = p[0].as_u32();

            if len == 1 {
                // `path` contains just a path separator, exit early to avoid
                // unnecessary work or a dot.
                return if is_path_separator::<W>(code) {
                    path.string
                } else {
                    dot_string(global)
                };
            }

            // Try to match a root
            if is_path_separator::<W>(code) {
                // Possible UNC root

                root_end = 1;
                offset = 1;

                if is_path_separator::<W>(p[1].as_u32()) {
                    // Matched double path separator at beginning
                    let mut j: Index = 2;
                    let mut last: Index = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_path_separator::<W>(p[j as usize].as_u32()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more path separators
                        while j < len && is_path_separator::<W>(p[j as usize].as_u32()) {
                            j += 1;
                        }
                        if j < len && j != last {
                            // Matched!
                            last = j;
                            // Match 1 or more non-path separators
                            while j < len && !is_path_separator::<W>(p[j as usize].as_u32()) {
                                j += 1;
                            }
                            if j == len {
                                // We matched a UNC root only
                                return path.string;
                            }
                            if j != last {
                                // We matched a UNC root with leftovers

                                // Offset by 1 to include the separator after the UNC root to
                                // treat it as a "normal root" on top of a (UNC) root
                                root_end = j + 1;
                                offset = j + 1;
                            }
                        }
                    }
                }
                // Possible device root
            } else if is_windows_device_root(code) && p[1].as_u32() == CHAR_COLON as u32 {
                root_end = if len > 2 && is_path_separator::<W>(p[2].as_u32()) {
                    3
                } else {
                    2
                };
                offset = root_end;
            }

            let mut end: Index = -1;
            let mut matched_slash = true;
            let mut i: Index = len - 1;
            while i >= offset {
                if is_path_separator::<W>(p[i as usize].as_u32()) {
                    if !matched_slash {
                        end = i;
                        break;
                    }
                } else {
                    // We saw the first non-path separator
                    matched_slash = false;
                }
                i -= 1;
            }

            if end == -1 {
                if root_end == -1 {
                    return dot_string(global);
                }

                end = root_end;
            }
            substring(global, path, 0, end)
        })
    }

    pub(super) fn parse(path: &Input<'_>, ret: &mut Parsed) {
        // Caller handles path.length === 0 and pre-fills every field with ''.
        with_chars!(path.chars, |p| {
            let len = p.len() as Index;
            let mut root_end: Index = 0;
            let mut code = p[0].as_u32();

            if len == 1 {
                if is_path_separator::<W>(code) {
                    // `path` contains just a path separator, exit early to avoid
                    // unnecessary work
                    ret.root = Parsed::range(0, 1);
                    ret.dir = Parsed::range(0, 1);
                    return;
                }
                ret.base = Parsed::range(0, 1);
                ret.name = Parsed::range(0, 1);
                return;
            }
            // Try to match a root
            if is_path_separator::<W>(code) {
                // Possible UNC root

                root_end = 1;
                if is_path_separator::<W>(p[1].as_u32()) {
                    // Matched double path separator at beginning
                    let mut j: Index = 2;
                    let mut last: Index = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_path_separator::<W>(p[j as usize].as_u32()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more path separators
                        while j < len && is_path_separator::<W>(p[j as usize].as_u32()) {
                            j += 1;
                        }
                        if j < len && j != last {
                            // Matched!
                            last = j;
                            // Match 1 or more non-path separators
                            while j < len && !is_path_separator::<W>(p[j as usize].as_u32()) {
                                j += 1;
                            }
                            if j == len {
                                // We matched a UNC root only
                                root_end = j;
                            } else if j != last {
                                // We matched a UNC root with leftovers
                                root_end = j + 1;
                            }
                        }
                    }
                }
            } else if is_windows_device_root(code) && p[1].as_u32() == CHAR_COLON as u32 {
                // Possible device root
                if len <= 2 {
                    // `path` contains just a drive root, exit early to avoid
                    // unnecessary work
                    ret.root = Parsed::range(0, len);
                    ret.dir = Parsed::range(0, len);
                    return;
                }
                root_end = 2;
                if is_path_separator::<W>(p[2].as_u32()) {
                    if len == 3 {
                        // `path` contains just a drive root, exit early to avoid
                        // unnecessary work
                        ret.root = Parsed::range(0, len);
                        ret.dir = Parsed::range(0, len);
                        return;
                    }
                    root_end = 3;
                }
            }
            if root_end > 0 {
                ret.root = Parsed::range(0, root_end);
            }

            let mut start_dot: Index = -1;
            let mut start_part: Index = root_end;
            let mut end: Index = -1;
            let mut matched_slash = true;
            let mut i: Index = len - 1;

            // Track the state of characters (if any) we see before our first dot and
            // after any path separator we find
            let mut pre_dot_state: Index = 0;

            // Get non-dir info
            while i >= root_end {
                code = p[i as usize].as_u32();
                if is_path_separator::<W>(code) {
                    // If we reached a path separator that was not part of a set of path
                    // separators at the end of the string, stop now
                    if !matched_slash {
                        start_part = i + 1;
                        break;
                    }
                    i -= 1;
                    continue;
                }
                if end == -1 {
                    // We saw the first non-path separator, mark this as the end of our
                    // extension
                    matched_slash = false;
                    end = i + 1;
                }
                if code == CHAR_DOT as u32 {
                    // If this is our first dot, mark it as the start of our extension
                    if start_dot == -1 {
                        start_dot = i;
                    } else if pre_dot_state != 1 {
                        pre_dot_state = 1;
                    }
                } else if start_dot != -1 {
                    // We saw a non-dot and non-path separator before our dot, so we should
                    // have a good chance at having a non-empty extension
                    pre_dot_state = -1;
                }
                i -= 1;
            }

            if end != -1 {
                if start_dot == -1
                    // We saw a non-dot character immediately before the dot
                    || pre_dot_state == 0
                    // The (right-most) trimmed path component is exactly '..'
                    || (pre_dot_state == 1 && start_dot == end - 1 && start_dot == start_part + 1)
                {
                    ret.base = Parsed::range(start_part, end);
                    ret.name = Parsed::range(start_part, end);
                } else {
                    ret.name = Parsed::range(start_part, start_dot);
                    ret.base = Parsed::range(start_part, end);
                    ret.ext = Parsed::range(start_dot, end);
                }
            }

            // If the directory is the root, use the entire root as the `dir` including
            // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
            // trailing slash (`C:\abc\def` -> `C:\abc`).
            if start_part > 0 && start_part != root_end {
                ret.dir = Parsed::range(0, start_part - 1);
            } else {
                ret.dir = ret.root;
            }
        })
    }
}

// ─────────────────────────────── bindings ───────────────────────────────

fn resolve<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let arg_count = args.len() as Index;
    let paths_i_error = |i: Index, value: JSValue| {
        global.throw_invalid_argument_type_value(format!("paths[{i}]"), "string", value)
    };

    if !WIN {
        let mut fast_cwd_storage: Buf<u16> = Buf::new();
        // The last argument once viewed, so the fast-path check need not view it again.
        let mut last_arg: Option<Input<'_>> = None;
        if arg_count <= 1 {
            let mut trivial = arg_count == 0;
            if !trivial && args[0].is_string_literal() {
                let arg = view_of(global, args[0])?;
                trivial = posix::is_trivial_arg(&arg.chars);
                last_arg = Some(arg);
            }
            if trivial {
                let cwd = posix::cwd(global, &mut fast_cwd_storage)?;
                if cwd.len() > 0 && cwd.at(0) == CHAR_FORWARD_SLASH as u32 {
                    if !cwd.string.is_empty() {
                        return Ok(cwd.string);
                    }
                    let result = with_chars!(cwd.chars, |s| to_js(global, s));
                    cwd.keep_alive();
                    return result;
                }
            }
        }
        let mut cwd_storage: Buf<u16> = Buf::new();
        let mut cwd: Option<Input<'_>> = None;

        // in visit (reverse) order
        let mut stack: SmallVec<[Input<'_>; 16]> = SmallVec::new();
        let mut all_8bit = true;
        let mut resolved_absolute = false;
        let mut i = arg_count - 1;
        while i >= 0 && !resolved_absolute {
            let path = match last_arg.take() {
                Some(arg) => arg,
                None => {
                    let value = args[i as usize];
                    if !value.is_string_literal() {
                        return Err(paths_i_error(i, value));
                    }
                    view_of(global, value)?
                }
            };
            i -= 1;

            // Skip empty entries
            if path.len() == 0 {
                continue;
            }

            stack.push(path);
            all_8bit &= path.is_8bit();
            resolved_absolute = path.at(0) == CHAR_FORWARD_SLASH as u32;
        }

        if !resolved_absolute {
            let c = posix::cwd(global, &mut cwd_storage)?;
            stack.push(c);
            all_8bit &= c.is_8bit();
            cwd = Some(c);
        }

        let mut parts: SmallVec<[Chars<'_>; 16]> = SmallVec::with_capacity(stack.len());
        for input in stack.iter().rev() {
            parts.push(input.chars);
        }

        macro_rules! finish {
            ($C:ty) => {{
                let mut out: Buf<$C> = Buf::new();
                match posix::resolve::<$C>(&parts, &mut out) {
                    Err(TooLong) => Err(global.throw_string_too_long()),
                    Ok(result) if stack.len() == 1 => to_js_reusing(global, result, &stack[0]),
                    Ok(result) => to_js(global, result),
                }
            }};
        }
        let result = if all_8bit { finish!(u8) } else { finish!(u16) };
        if let Some(cwd) = cwd {
            cwd.keep_alive();
        }
        result
    } else {
        let mut cwd_storage: Buf<u16> = Buf::new();
        let mut cwd: Option<Input<'_>> = None;
        let mut st = win32::ResolveState::new();
        let get_arg = |i: Index| -> JsResult<Input<'_>> {
            let value = args[i as usize];
            if !value.is_string_literal() {
                return Err(paths_i_error(i, value));
            }
            view_of(global, value)
        };
        win32::resolve_scan(
            global,
            arg_count,
            get_arg,
            &mut st,
            &mut cwd,
            &mut cwd_storage,
        )?;
        let too_long = |_| global.throw_string_too_long();
        let result = if let Some(returned) = st.return_cwd {
            with_chars!(returned.chars, |s| {
                if cfg!(windows) || index_of(s, CHAR_FORWARD_SLASH, 0) == -1 {
                    Ok(returned.string)
                } else {
                    let mut out = buf_like(s);
                    to_js(global, win32::returned_cwd(s, &mut out))
                }
            })
        } else if st.all_8bit {
            let mut out: Buf<u8> = Buf::new();
            win32::resolve_build::<u8>(&st, &mut out)
                .map_err(too_long)
                .and_then(|r| to_js(global, r))
        } else {
            let mut out: Buf<u16> = Buf::new();
            win32::resolve_build::<u16>(&st, &mut out)
                .map_err(too_long)
                .and_then(|r| to_js(global, r))
        };
        if let Some(cwd) = cwd {
            cwd.keep_alive();
        }
        result
    }
}

fn normalize<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    validate_string(global, value, "path")?;
    let path = view_of(global, value)?;

    if path.len() == 0 {
        return Ok(dot_string(global));
    }

    with_chars!(path.chars, |p| {
        let mut out = buf_like(p);
        let result = if WIN {
            win32::normalize(p, &mut out, None)
        } else {
            posix::normalize(p, &mut out)
        };
        to_js_reusing(global, result, &path)
    })
}

fn join<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    if args.is_empty() {
        return Ok(dot_string(global));
    }

    let mut paths: SmallVec<[Chars<'_>; 16]> = SmallVec::new();
    let mut single: Option<Input<'_>> = None;
    let mut all_8bit = true;
    for &arg in args {
        validate_string(global, arg, "path")?;
        let input = view_of(global, arg)?;
        if input.len() > 0 {
            paths.push(input.chars);
            all_8bit &= input.is_8bit();
            single = Some(input);
        }
    }

    let single = match single {
        Some(single) => single,
        None => return Ok(dot_string(global)),
    };

    macro_rules! finish {
        ($C:ty) => {{
            let mut joined: Buf<$C> = Buf::new();
            let mut out: Buf<$C> = Buf::new();
            let result = if WIN {
                win32::join::<$C>(&paths, &mut joined, &mut out)
            } else {
                posix::join::<$C>(&paths, &mut joined, &mut out)
            };
            let result = result.map_err(|_| global.throw_string_too_long())?;
            if paths.len() == 1 {
                return to_js_reusing(global, result, &single);
            }
            return to_js(global, result);
        }};
    }
    if all_8bit { finish!(u8) } else { finish!(u16) }
}

fn relative<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let from_value = frame.argument(0);
    let to_value = frame.argument(1);
    validate_string(global, from_value, "from")?;
    validate_string(global, to_value, "to")?;
    let from = view_of(global, from_value)?;
    let to = view_of(global, to_value)?;

    if from.string == to.string || from.chars.eq(&to.chars) {
        return Ok(empty_string(global));
    }

    // lib/path.js resolves the two operands with two independent resolve() calls, each
    // reading process.cwd() for itself; the reads are hoisted here only to pick the width.
    let mut from_cwd_storage: Buf<u16> = Buf::new();
    let mut to_cwd_storage: Buf<u16> = Buf::new();
    if !WIN {
        let mut from_fallback_storage: Buf<u16> = Buf::new();
        let mut to_fallback_storage: Buf<u16> = Buf::new();
        let from_cwd = posix::operand_cwd(
            global,
            &from.chars,
            &mut from_cwd_storage,
            &mut from_fallback_storage,
        )?;
        let to_cwd = posix::operand_cwd(
            global,
            &to.chars,
            &mut to_cwd_storage,
            &mut to_fallback_storage,
        )?;
        let all_8bit = from.is_8bit()
            && to.is_8bit()
            && [&from_cwd, &to_cwd]
                .into_iter()
                .filter_map(posix::OperandCwd::input)
                .all(Input::is_8bit);
        let result = if all_8bit {
            posix::relative::<u8>(global, from.chars, to.chars, &from_cwd, &to_cwd)
        } else {
            posix::relative::<u16>(global, from.chars, to.chars, &from_cwd, &to_cwd)
        };
        for cwd in [&from_cwd, &to_cwd]
            .into_iter()
            .filter_map(posix::OperandCwd::input)
        {
            cwd.keep_alive();
        }
        result
    } else {
        // Scan both operands first so both can be built at one width.
        let mut from_cwd: Option<Input<'_>> = None;
        let mut to_cwd: Option<Input<'_>> = None;
        let mut from_st = win32::ResolveState::new();
        let mut to_st = win32::ResolveState::new();
        win32::resolve_scan(
            global,
            1,
            |_| Ok(from),
            &mut from_st,
            &mut from_cwd,
            &mut from_cwd_storage,
        )?;
        win32::resolve_scan(
            global,
            1,
            |_| Ok(to),
            &mut to_st,
            &mut to_cwd,
            &mut to_cwd_storage,
        )?;
        let is_8bit = |st: &win32::ResolveState<'_>| match st.return_cwd {
            Some(cwd) => cwd.is_8bit(),
            None => st.all_8bit,
        };
        let too_long = |_| global.throw_string_too_long();
        macro_rules! finish {
            ($C:ty) => {{
                let mut from_out: Buf<$C> = Buf::new();
                let mut to_out: Buf<$C> = Buf::new();
                let build = |st: &win32::ResolveState<'_>, out| -> JsResult<&[$C]> {
                    match st.return_cwd {
                        Some(cwd) => Ok(with_chars!(cwd.chars, |s| win32::returned_cwd(s, out))),
                        None => win32::resolve_build::<$C>(st, out).map_err(too_long),
                    }
                };
                build(&from_st, &mut from_out)
                    .and_then(|from_orig| Ok((from_orig, build(&to_st, &mut to_out)?)))
                    .and_then(|(from_orig, to_orig)| {
                        win32::relative::<$C>(global, from_orig, to_orig)
                    })
            }};
        }
        let result = if is_8bit(&from_st) && is_8bit(&to_st) {
            finish!(u8)
        } else {
            finish!(u16)
        };
        for cwd in [from_cwd, to_cwd].into_iter().flatten() {
            cwd.keep_alive();
        }
        result
    }
}

/// `win32.toNamespacedPath()`; the posix one is the identity and lives in path.ts.
fn to_namespaced_path(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    // Note: this will *probably* throw somewhere.
    if !value.is_string_literal() {
        return Ok(value);
    }
    let path = view_of(global, value)?;
    if path.len() == 0 {
        return Ok(value);
    }

    let mut out8: Buf<u8> = Buf::new();
    let mut out16: Buf<u16> = Buf::new();
    let mut cwd_storage: Buf<u16> = Buf::new();
    let mut cwd: Option<Input<'_>> = None;
    let resolved_path = win32::resolve(
        global,
        path.chars,
        &mut cwd,
        &mut out8,
        &mut out16,
        &mut cwd_storage,
    )?;
    // `resolved_path` is an owned copy; the cwd string is no longer needed.
    if let Some(cwd) = cwd {
        cwd.keep_alive();
    }

    with_chars!(resolved_path, |r| {
        if r.len() <= 2 {
            return Ok(value);
        }

        if r[0].as_u32() == CHAR_BACKWARD_SLASH as u32 {
            // Possible UNC root
            if r[1].as_u32() == CHAR_BACKWARD_SLASH as u32 {
                let code = r[2].as_u32();
                if code != CHAR_QUESTION_MARK as u32 && code != CHAR_DOT as u32 {
                    // Matched non-long UNC root, convert the path to a long UNC path
                    let mut out = buf_like(r);
                    let o = reserve(&mut out, 8 + r.len() - 2);
                    let p = copy_units(o, b"\\\\?\\UNC\\");
                    copy_units(&mut o[p..], &r[2..]);
                    return to_js(global, &out[..]);
                }
            }
        } else if is_windows_device_root(r[0].as_u32())
            && r[1].as_u32() == CHAR_COLON as u32
            && r[2].as_u32() == CHAR_BACKWARD_SLASH as u32
        {
            // Matched device root, convert the path to a long UNC path
            let mut out = buf_like(r);
            let o = reserve(&mut out, 4 + r.len());
            let p = copy_units(o, b"\\\\?\\");
            copy_units(&mut o[p..], r);
            return to_js(global, &out[..]);
        }

        to_js_reusing(global, r, &path)
    })
}

fn dirname<const WIN: bool>(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
    validate_string(global, value, "path")?;
    let path = view_of(global, value)?;
    if path.len() == 0 {
        return Ok(dot_string(global));
    }
    Ok(if WIN {
        win32::dirname(global, &path)
    } else {
        posix::dirname(global, &path)
    })
}

fn dirname_host<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    dirname::<WIN>(global, frame.argument(0))
}

fn basename<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let path_value = frame.argument(0);
    let suffix_value = frame.argument(1);
    let has_suffix = !suffix_value.is_undefined();
    if has_suffix {
        validate_string(global, suffix_value, "suffix")?;
    }
    validate_string(global, path_value, "path")?;
    let path = view_of(global, path_value)?;
    let suffix = if has_suffix {
        Some(view_of(global, suffix_value)?)
    } else {
        None
    };
    Ok(basename_impl::<WIN>(global, &path, suffix.as_ref()))
}

fn extname<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    validate_string(global, value, "path")?;
    let path = view_of(global, value)?;
    Ok(extname_impl::<WIN>(global, &path))
}

fn parse<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    validate_string(global, value, "path")?;
    let path = view_of(global, value)?;

    let mut ret = Parsed::new();
    if path.len() != 0 {
        if WIN {
            win32::parse(&path, &mut ret);
        } else {
            posix::parse(&path, &mut ret);
        }
    }
    Ok(ret.to_js(global, value))
}

/// Declares the `#[bun_jsc::host_fn]` entry points for one platform.
macro_rules! host_fns {
    ($win:literal: $($name:ident => $imp:ident),* $(,)?) => {
        $(
            #[bun_jsc::host_fn]
            pub fn $name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
                $imp::<$win>(global, frame)
            }
        )*
    };
}

host_fns!(false:
    posix_resolve => resolve, posix_normalize => normalize, posix_join => join,
    posix_relative => relative, posix_dirname => dirname_host, posix_basename => basename,
    posix_extname => extname, posix_parse => parse,
);
host_fns!(true:
    win32_resolve => resolve, win32_normalize => normalize, win32_join => join,
    win32_relative => relative, win32_dirname => dirname_host, win32_basename => basename,
    win32_extname => extname, win32_parse => parse,
);

#[bun_jsc::host_fn]
pub fn win32_to_namespaced_path(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    to_namespaced_path(global, frame)
}

/// `$rust("path.rs", "createNodePathBinding")`: `[posixFns, win32Fns]`, each an
/// object of the native functions; path.ts assembles the module objects.
pub fn create_node_path_binding(global: &JSGlobalObject) -> JsResult<JSValue> {
    type Entry = (&'static str, jsc::JSHostFn, u32);
    #[rustfmt::skip]
    let tables: [&[Entry]; 2] = [
        &[
            ("resolve", __jsc_host_posix_resolve, 0),
            ("normalize", __jsc_host_posix_normalize, 1),
            ("join", __jsc_host_posix_join, 0),
            ("relative", __jsc_host_posix_relative, 2),
            ("dirname", __jsc_host_posix_dirname, 1),
            ("basename", __jsc_host_posix_basename, 2),
            ("extname", __jsc_host_posix_extname, 1),
            ("parse", __jsc_host_posix_parse, 1),
        ],
        &[
            ("resolve", __jsc_host_win32_resolve, 0),
            ("normalize", __jsc_host_win32_normalize, 1),
            ("join", __jsc_host_win32_join, 0),
            ("relative", __jsc_host_win32_relative, 2),
            ("toNamespacedPath", __jsc_host_win32_to_namespaced_path, 1),
            ("dirname", __jsc_host_win32_dirname, 1),
            ("basename", __jsc_host_win32_basename, 2),
            ("extname", __jsc_host_win32_extname, 1),
            ("parse", __jsc_host_win32_parse, 1),
        ],
    ];
    let result = JSValue::create_empty_array(global, 2)?;
    for (i, table) in tables.iter().enumerate() {
        let object = JSValue::create_empty_object(global, table.len());
        for &(name, function, length) in table.iter() {
            let f = JSFunction::create(global, name, function, length, Default::default());
            object.put(global, name, f);
        }
        result.put_index(global, i as u32, object)?;
    }
    Ok(result)
}

// ─────────────────────────── C++ entry points ────────────────────────────

/// `path.dirname(path)` for `__dirname` and `Module._resolveLookupPaths`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Path__dirname(
    global: &JSGlobalObject,
    is_windows: bool,
    path: JSValue,
) -> JSValue {
    jsc::host_fn::to_js_host_call(global, || {
        if is_windows {
            dirname::<true>(global, path)
        } else {
            dirname::<false>(global, path)
        }
    })
}

/// `path.join(lhs, rhs)` for `Module.createRequire`; writes a new +1 string to
/// `result` (or a dead string if the result would exceed the string limit).
///
/// # Safety
/// `result` must be valid for a write of `bun_core::String` (it may be uninitialized).
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__Path__joinString(
    is_windows: bool,
    lhs: &bun_core::String,
    rhs: &bun_core::String,
    result: *mut bun_core::String,
) {
    fn chars_of(s: &bun_core::String) -> Chars<'_> {
        if s.is_empty() {
            Chars::Latin1(&[])
        } else if s.is_utf16() {
            Chars::Utf16(s.utf16())
        } else {
            Chars::Latin1(s.latin1())
        }
    }
    let mut paths: SmallVec<[Chars<'_>; 2]> = SmallVec::new();
    let mut all_8bit = true;
    for c in [chars_of(lhs), chars_of(rhs)] {
        if c.len() > 0 {
            all_8bit &= c.is_8bit();
            paths.push(c);
        }
    }
    let joined = if paths.is_empty() {
        bun_core::String::static_(b".")
    } else {
        macro_rules! finish {
            ($C:ty, $make:ident) => {{
                let mut joined: Buf<$C> = Buf::new();
                let mut out: Buf<$C> = Buf::new();
                let result = if is_windows {
                    win32::join::<$C>(&paths, &mut joined, &mut out)
                } else {
                    posix::join::<$C>(&paths, &mut joined, &mut out)
                };
                match result {
                    Ok(chars) => bun_core::String::$make(chars),
                    Err(TooLong) => bun_core::String::DEAD,
                }
            }};
        }
        if all_8bit {
            finish!(u8, clone_latin1)
        } else {
            finish!(u16, clone_utf16)
        }
    };
    // SAFETY: caller contract.
    unsafe { result.write(joined) };
}
