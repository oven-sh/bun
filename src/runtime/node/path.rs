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

use core::ffi::c_void;

use bun_collections::smallvec::SmallVec;

use crate::jsc::{
    self, CallFrame, ErrorCode, JSFunction, JSGlobalObject, JSValue, JsError, JsResult,
};

// ───────────────────────────── code units ──────────────────────────────

/// A string code unit: `u8` is a Latin-1 character (an 8-bit JSString), `u16`
/// a UTF-16 code unit. Both compare against ASCII the same way.
trait Unit: Copy + Eq + Ord + Default + 'static {
    const IS_16: bool;
    fn u(self) -> u32;
    /// Truncating; callers only narrow values known to fit.
    fn from_u32(u: u32) -> Self;
}
impl Unit for u8 {
    const IS_16: bool = false;
    #[inline(always)]
    fn u(self) -> u32 {
        self as u32
    }
    #[inline(always)]
    fn from_u32(u: u32) -> Self {
        debug_assert!(u <= 0xFF);
        u as u8
    }
}
impl Unit for u16 {
    const IS_16: bool = true;
    #[inline(always)]
    fn u(self) -> u32 {
        self as u32
    }
    #[inline(always)]
    fn from_u32(u: u32) -> Self {
        debug_assert!(u <= 0xFFFF);
        u as u16
    }
}

#[inline(always)]
fn ch<C: Unit>(c: u8) -> C {
    C::from_u32(c as u32)
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
        let c = s[i].u();
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
            let d = s[3].u();
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
fn index_of<C: Unit>(s: &[C], c: u8, from: Index) -> Index {
    let from = from.max(0) as usize;
    if from >= s.len() {
        return -1;
    }
    match find_unit(&s[from..], c) {
        Some(i) => (from + i) as Index,
        None => -1,
    }
}

#[inline]
fn find_unit<C: Unit>(s: &[C], c: u8) -> Option<usize> {
    if C::IS_16 {
        // SAFETY: `C == u16` when `IS_16`; identical layout.
        let s16 = unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u16>(), s.len()) };
        bun_core::strings::index_of_scalar(s16, c as u16)
    } else {
        // SAFETY: `C == u8` when `!IS_16`; identical layout.
        let s8 = unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), s.len()) };
        bun_core::strings::index_of_char_usize(s8, c)
    }
}

#[inline]
fn span_equals<A: Unit, B: Unit>(a: &[A], b: &[B]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.u() == y.u())
}

#[inline]
fn all_ascii<C: Unit>(s: &[C]) -> bool {
    s.iter().all(|c| c.u() < 0x80)
}

/// Copies `src` into the front of `dst`, widening or narrowing as needed
/// (callers only narrow values known to fit), and returns the count.
#[inline]
fn copy_units<D: Unit, S: Unit>(dst: &mut [D], src: &[S]) -> usize {
    if D::IS_16 == S::IS_16 {
        // SAFETY: same width ⇒ same type; plain memcpy of `src.len()` elements into `dst`.
        unsafe {
            core::ptr::copy_nonoverlapping(src.as_ptr().cast::<D>(), dst.as_mut_ptr(), src.len());
        }
    } else {
        for (d, s) in dst.iter_mut().zip(src) {
            *d = D::from_u32(s.u());
        }
    }
    src.len()
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
        if C::IS_16 {
            // SAFETY: `C == u16` when `IS_16`.
            Chars::Utf16(unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u16>(), s.len()) })
        } else {
            // SAFETY: `C == u8` when `!IS_16`.
            Chars::Latin1(unsafe { core::slice::from_raw_parts(s.as_ptr().cast::<u8>(), s.len()) })
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
}

/// Mirrors `PathStringView` in Path.cpp.
#[repr(C)]
struct StringView {
    characters: *const c_void,
    length: u32,
    is_16bit: bool,
}

impl StringView {
    const fn empty() -> Self {
        Self {
            characters: core::ptr::null(),
            length: 0,
            is_16bit: false,
        }
    }
    /// # Safety
    /// The view must describe live string storage that outlives `'a`.
    unsafe fn chars<'a>(&self) -> Chars<'a> {
        let len = self.length as usize;
        if len == 0 {
            return Chars::Latin1(&[]);
        }
        // SAFETY: caller contract; C++ filled ptr/len/is_16bit from a live `WTF::String`.
        unsafe {
            if self.is_16bit {
                Chars::Utf16(core::slice::from_raw_parts(
                    self.characters.cast::<u16>(),
                    len,
                ))
            } else {
                Chars::Latin1(core::slice::from_raw_parts(
                    self.characters.cast::<u8>(),
                    len,
                ))
            }
        }
    }
}

// Implemented in src/jsc/bindings/Path.cpp.
unsafe extern "C" {
    fn Bun__Path__viewString(value: JSValue, global: &JSGlobalObject, out: *mut StringView)
    -> bool;
    fn Bun__Path__cwd(global: &JSGlobalObject, out: *mut StringView) -> JSValue;
    safe fn Bun__Path__jsSubstring(
        global: &JSGlobalObject,
        string: JSValue,
        offset: u32,
        length: u32,
    ) -> JSValue;
    fn Bun__Path__jsStringLatin1(
        global: &JSGlobalObject,
        characters: *const u8,
        length: usize,
    ) -> JSValue;
    fn Bun__Path__jsStringUTF16(
        global: &JSGlobalObject,
        characters: *const u16,
        length: usize,
    ) -> JSValue;
    fn Bun__Path__createParsed(
        global: &JSGlobalObject,
        path: JSValue,
        ranges: *const i32,
    ) -> JSValue;
    fn Bun__Path__toLowerCase(characters: *const u16, length: usize, result: *mut bun_core::String);
}

/// Resolves `value` (already known to be a string) to a flat view. The view
/// borrows the JSString's storage, which stays alive for as long as the string
/// is reachable — every string viewed here is either an argument on the JS
/// stack or the process object's cached cwd.
#[inline]
fn view_of<'a>(global: &JSGlobalObject, value: JSValue) -> JsResult<Input<'a>> {
    debug_assert!(value.is_string());
    let mut view = StringView::empty();
    // SAFETY: `value` is a JSString; `view` is a valid out-pointer.
    jsc::call_false_is_throw(global, || unsafe {
        Bun__Path__viewString(value, global, &mut view)
    })?;
    // SAFETY: filled from the live JSString `value`.
    Ok(Input {
        string: value,
        chars: unsafe { view.chars() },
    })
}

/// `process.cwd()` — the cached string that function returns, not a call
/// through the (possibly monkey-patched) `process.cwd` property, so stubbing
/// `process.cwd` in JS does not affect path.resolve() the way it does in Node.
#[inline]
fn get_cwd<'a>(global: &JSGlobalObject) -> JsResult<Input<'a>> {
    let mut view = StringView::empty();
    // SAFETY: `view` is a valid out-pointer.
    let string = jsc::call_zero_is_throw(global, || unsafe { Bun__Path__cwd(global, &mut view) })?;
    // SAFETY: filled from the process object's cached cwd JSString.
    Ok(Input {
        string,
        chars: unsafe { view.chars() },
    })
}

#[inline]
fn validate_string(global: &JSGlobalObject, value: JSValue, name: &str) -> JsResult<()> {
    if value.is_string() {
        return Ok(());
    }
    Err(global.throw_invalid_argument_type_value(name, "string", value))
}

// ─────────────────────────────── results ────────────────────────────────

/// `StringPrototypeSlice(input, start, end)` as a JSString sharing `input`'s buffer.
#[inline]
fn substring(global: &JSGlobalObject, input: &Input<'_>, start: Index, end: Index) -> JSValue {
    debug_assert!(!input.string.is_empty_or_undefined_or_null());
    debug_assert!(start >= 0 && end >= start && end as usize <= input.len());
    Bun__Path__jsSubstring(global, input.string, start as u32, (end - start) as u32)
}

#[cold]
fn throw_too_long(global: &JSGlobalObject) -> JsError {
    global
        .err(
            ErrorCode::STRING_TOO_LONG,
            format_args!(
                "Cannot create a string longer than {} characters",
                bun_core::String::max_length()
            ),
        )
        .throw()
}

/// A new JSString with the given characters.
fn to_js<C: Unit>(global: &JSGlobalObject, chars: &[C]) -> JsResult<JSValue> {
    if chars.len() > bun_core::String::max_length() {
        return Err(throw_too_long(global));
    }
    // SAFETY: ptr/len describe `chars`; the callee copies before returning.
    Ok(unsafe {
        if C::IS_16 {
            Bun__Path__jsStringUTF16(global, chars.as_ptr().cast(), chars.len())
        } else {
            Bun__Path__jsStringLatin1(global, chars.as_ptr().cast(), chars.len())
        }
    })
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
    // SAFETY: static one-byte literal; the callee returns the VM's cached single-character string.
    unsafe { Bun__Path__jsStringLatin1(global, b".".as_ptr(), 1) }
}
#[inline]
fn empty_string(global: &JSGlobalObject) -> JSValue {
    // SAFETY: zero-length; the callee returns the VM's empty string.
    unsafe { Bun__Path__jsStringLatin1(global, b"".as_ptr(), 0) }
}

// ────────────────────────────── buffers ─────────────────────────────────

/// Scratch space for assembled results; spills to the heap past `INLINE` units.
type Buf<C> = SmallVec<[C; INLINE]>;
const INLINE: usize = 1024;

/// A buffer of the same unit type as `like` (for use under `with_chars!`).
#[inline]
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

/// Guards a total computed from several argument lengths before it is used to
/// size a buffer; anything past the JS string limit could never be returned.
#[inline]
fn check_length(global: &JSGlobalObject, len: usize) -> JsResult<usize> {
    if len > bun_core::String::max_length() {
        return Err(throw_too_long(global));
    }
    Ok(len)
}

// ────────────────────────────── scanning ────────────────────────────────

/// Index of the first path separator in `p[i..]`, or `p.len()`. Scans a
/// machine word at a time.
#[inline]
fn find_separator<const WIN: bool, C: Unit>(p: &[C], mut i: usize) -> usize {
    let len = p.len();
    let units_per_word = 8 / core::mem::size_of::<C>();
    let bits: u32 = 8 * core::mem::size_of::<C>() as u32;
    let ones: u64 = if C::IS_16 {
        0x0001_0001_0001_0001
    } else {
        0x0101_0101_0101_0101
    };
    let highs: u64 = ones << (bits - 1);
    while i + units_per_word <= len {
        // SAFETY: `i + units_per_word <= len`, so 8 bytes starting at `p[i]` are in bounds.
        let w = unsafe { core::ptr::read_unaligned(p.as_ptr().add(i).cast::<u64>()) };
        // Exact for the lowest matching lane, which is the only one consulted (little-endian).
        let x = w ^ ones.wrapping_mul(CHAR_FORWARD_SLASH as u64);
        let mut found = x.wrapping_sub(ones) & !x & highs;
        if WIN {
            let y = w ^ ones.wrapping_mul(CHAR_BACKWARD_SLASH as u64);
            found |= y.wrapping_sub(ones) & !y & highs;
        }
        if found != 0 {
            return i + (found.trailing_zeros() / bits) as usize;
        }
        i += units_per_word;
    }
    while i < len && !is_path_separator::<WIN>(p[i].u()) {
        i += 1;
    }
    i
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

        if segment_length == 0 || (segment_length == 1 && path[segment].u() == CHAR_DOT as u32) {
            // NOOP
        } else if segment_length == 2
            && path[segment].u() == CHAR_DOT as u32
            && path[segment + 1].u() == CHAR_DOT as u32
        {
            if res_len < 2
                || last_segment_length != 2
                || res[res_len - 1].u() != CHAR_DOT as u32
                || res[res_len - 2].u() != CHAR_DOT as u32
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

    #[inline]
    pub(super) fn needs_cwd(path: &Chars<'_>) -> bool {
        path.len() == 0 || path.at(0) != CHAR_FORWARD_SLASH as u32
    }

    /// `resolve()` once the arguments have been reduced to the strings that
    /// participate, in call order (cwd first when it was consulted).
    pub(super) fn resolve<'o, C: Unit>(
        global: &JSGlobalObject,
        parts: &[Chars<'_>],
        out: &'o mut Buf<C>,
    ) -> JsResult<&'o [C]> {
        let mut joined_len = 0usize;
        for part in parts {
            joined_len += part.len() + 1;
        }
        let joined_len = check_length(global, joined_len)?;

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

    /// `posix.resolve(path)` for a single already-validated string; `cwd` must
    /// be provided when [`needs_cwd`].
    pub(super) fn resolve1<'o, C: Unit>(
        global: &JSGlobalObject,
        path: Chars<'_>,
        cwd: Option<&Input<'_>>,
        out: &'o mut Buf<C>,
    ) -> JsResult<&'o [C]> {
        // The `args.length === 1 && (args[0] === '' || args[0] === '.')` fast path in lib/path.js
        // returns `posixCwd()` un-normalized when it starts with a slash.
        if let Some(cwd) = cwd {
            if (path.len() == 0 || (path.len() == 1 && path.at(0) == CHAR_DOT as u32))
                && cwd.len() > 0
                && cwd.at(0) == CHAR_FORWARD_SLASH as u32
            {
                let o = reserve(out, cwd.len());
                cwd.chars.copy_to(o);
                return Ok(&out[..]);
            }
        }
        let mut parts: [Chars<'_>; 2] = [Chars::Latin1(&[]), Chars::Latin1(&[])];
        let mut n = 0;
        if needs_cwd(&path) {
            parts[n] = cwd.expect("cwd required for a relative path").chars;
            n += 1;
        }
        if path.len() > 0 {
            parts[n] = path;
            n += 1;
        }
        resolve::<C>(global, &parts[..n], out)
    }

    pub(super) fn normalize<'o, C: Unit>(path: &[C], out: &'o mut Buf<C>) -> &'o [C] {
        // Caller handles path.length === 0.
        let is_absolute = path[0].u() == CHAR_FORWARD_SLASH as u32;
        let trailing_separator = path[path.len() - 1].u() == CHAR_FORWARD_SLASH as u32;

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
        global: &JSGlobalObject,
        paths: &[Chars<'_>],
        joined: &mut Buf<C>,
        out: &'o mut Buf<C>,
    ) -> JsResult<&'o [C]> {
        // Caller has removed empty arguments and handled the none-left case.
        let mut joined_len = paths.len() - 1;
        for path in paths {
            joined_len += path.len();
        }
        let joined_len = check_length(global, joined_len)?;
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

    pub(super) fn relative<C: Unit>(
        global: &JSGlobalObject,
        from_in: Chars<'_>,
        to_in: Chars<'_>,
        cwd: Option<&Input<'_>>,
    ) -> JsResult<JSValue> {
        // Trim leading forward slashes.
        let mut from_buf: Buf<C> = Buf::new();
        let mut to_buf: Buf<C> = Buf::new();
        let from = resolve1::<C>(global, from_in, cwd, &mut from_buf)?;
        let to = resolve1::<C>(global, to_in, cwd, &mut to_buf)?;

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
            && from[(from_start + last_common_sep) as usize].u() != CHAR_FORWARD_SLASH as u32
        {
            last_common_sep -= 1;
        }
        if i == length {
            if to_len > length {
                if to[(to_start + i) as usize].u() == CHAR_FORWARD_SLASH as u32 {
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
                if from[(from_start + i) as usize].u() == CHAR_FORWARD_SLASH as u32 {
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
            if i == from_end || from[i as usize].u() == CHAR_FORWARD_SLASH as u32 {
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
            let has_root = p[0].u() == CHAR_FORWARD_SLASH as u32;
            let mut end: Index = -1;
            let mut matched_slash = true;
            let mut i: Index = len - 1;
            while i >= 1 {
                if p[i as usize].u() == CHAR_FORWARD_SLASH as u32 {
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
                // '//' — path[0] is '/' and, since end === 1 was a separator, so is path[1].
                return substring(global, path, 0, 2);
            }
            substring(global, path, 0, end)
        })
    }

    pub(super) fn basename(
        global: &JSGlobalObject,
        path: &Input<'_>,
        suffix: Option<&Input<'_>>,
    ) -> JSValue {
        with_chars!(path.chars, |p| {
            let mut start: Index = 0;
            let mut end: Index = -1;
            let mut matched_slash = true;
            let path_length = p.len() as Index;

            if let Some(suffix) = suffix.filter(|s| s.len() > 0 && s.len() as Index <= path_length)
            {
                return with_chars!(suffix.chars, |s| {
                    if span_equals(s, p) {
                        return empty_string(global);
                    }
                    let mut ext_idx: Index = s.len() as Index - 1;
                    let mut first_non_slash_end: Index = -1;
                    let mut i: Index = path_length - 1;
                    while i >= 0 {
                        let code = p[i as usize].u();
                        if code == CHAR_FORWARD_SLASH as u32 {
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
                                if code == s[ext_idx as usize].u() {
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
            while i >= 0 {
                if p[i as usize].u() == CHAR_FORWARD_SLASH as u32 {
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

    pub(super) fn extname(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
        with_chars!(path.chars, |p| {
            let mut start_dot: Index = -1;
            let mut start_part: Index = 0;
            let mut end: Index = -1;
            let mut matched_slash = true;
            // Track the state of characters (if any) we see before our first dot and
            // after any path separator we find
            let mut pre_dot_state: Index = 0;
            let mut i: Index = p.len() as Index - 1;
            while i >= 0 {
                let code = p[i as usize].u();
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

    pub(super) fn parse(path: &Input<'_>, ret: &mut Parsed) {
        // Caller handles path.length === 0 and pre-fills every field with ''.
        with_chars!(path.chars, |p| {
            let is_absolute = p[0].u() == CHAR_FORWARD_SLASH as u32;
            let start: Index;
            if is_absolute {
                ret.root = (0, 1);
                start = 1;
            } else {
                start = 0;
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
                let code = p[i as usize].u();
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
                    ret.base = (start, end);
                    ret.name = (start, end);
                } else {
                    ret.name = (start, start_dot);
                    ret.base = (start, end);
                    ret.ext = (start_dot, end);
                }
            }

            if start_part > 0 {
                ret.dir = (0, start_part - 1);
            } else if is_absolute {
                ret.dir = ret.root;
            }
        })
    }
}

/// `path.parse()` result as `[start, end)` slices of the input; `(-1, -1)` is `''`.
#[derive(Clone, Copy)]
struct Parsed {
    root: (Index, Index),
    dir: (Index, Index),
    base: (Index, Index),
    ext: (Index, Index),
    name: (Index, Index),
}

impl Parsed {
    const EMPTY: (Index, Index) = (-1, -1);
    fn new() -> Self {
        Self {
            root: Self::EMPTY,
            dir: Self::EMPTY,
            base: Self::EMPTY,
            ext: Self::EMPTY,
            name: Self::EMPTY,
        }
    }
    fn to_js(&self, global: &JSGlobalObject, path: JSValue) -> JSValue {
        let ranges: [i32; 10] = [
            self.root.0 as i32,
            self.root.1 as i32,
            self.dir.0 as i32,
            self.dir.1 as i32,
            self.base.0 as i32,
            self.base.1 as i32,
            self.ext.0 as i32,
            self.ext.1 as i32,
            self.name.0 as i32,
            self.name.1 as i32,
        ];
        // SAFETY: `path` is a resolved JSString (via view_of); `ranges` has 10 entries.
        unsafe { Bun__Path__createParsed(global, path, ranges.as_ptr()) }
    }
}

// ──────────────────────────────── win32 ─────────────────────────────────

mod win32 {
    use super::*;

    pub(super) const W: bool = true;

    /// The `device` string computed while matching a root in resolve()/normalize().
    /// It is always one of a handful of shapes assembled from slices of `path`,
    /// so record the shape and materialize on demand.
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
                    out[2] = D::from_u32(self.path[2].u());
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

    impl<C: Unit> Drop for Lowered<C> {
        fn drop(&mut self) {
            self.wtf.deref();
        }
    }

    /// `StringPrototypeToLowerCase(s)`, materialized in `into`.
    pub(super) fn to_lower_case<'s, C: Unit>(s: &[C], into: &'s mut Lowered<C>) -> &'s [C] {
        if !C::IS_16 || all_ascii(s) {
            let p = reserve(&mut into.storage, s.len());
            for (d, c) in p.iter_mut().zip(s) {
                let u = c.u();
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
            return &into.storage[..];
        }
        // SAFETY: `C == u16` here; ptr/len describe `s`; the callee copies before returning.
        unsafe { Bun__Path__toLowerCase(s.as_ptr().cast(), s.len(), &mut into.wtf) };
        if into.wtf.is_utf16() {
            let w = into.wtf.utf16();
            // SAFETY: `C == u16`; identical layout. `w` lives as long as `into.wtf`.
            return unsafe { core::slice::from_raw_parts(w.as_ptr().cast::<C>(), w.len()) };
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
                    let (x, y) = (x.u(), y.u());
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
        let mut wa: Buf<u16> = Buf::new();
        let mut wb: Buf<u16> = Buf::new();
        copy_units(reserve(&mut wa, a.len()), a);
        copy_units(reserve(&mut wb, b.len()), b);
        let mut la = Lowered::<u16>::new();
        let mut lb = Lowered::<u16>::new();
        to_lower_case(&wa, &mut la) == to_lower_case(&wb, &mut lb)
    }

    /// The "Try to match a root" prologue shared by resolve() and normalize().
    pub(super) struct Root<'p, C: Unit> {
        pub(super) root_end: usize,
        pub(super) is_absolute: bool,
        pub(super) device: Device<'p, C>,
        /// normalize()'s "We matched a UNC root only" early return.
        pub(super) unc_root_only: bool,
        pub(super) first_part_start: usize,
        pub(super) first_part_end: usize,
        pub(super) last: usize,
    }

    #[derive(PartialEq, Eq)]
    pub(super) enum RootMode {
        Resolve,
        Normalize,
    }

    #[inline]
    pub(super) fn match_root<C: Unit>(mode: RootMode, path: &[C]) -> Root<'_, C> {
        let mut r = Root {
            root_end: 0,
            is_absolute: false,
            device: Device::none(path),
            unc_root_only: false,
            first_part_start: 0,
            first_part_end: 0,
            last: 0,
        };
        let len = path.len();
        let code = path[0].u();

        // Caller handles len <= 1 for normalize.
        if mode == RootMode::Resolve && len == 1 {
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

            if is_path_separator::<W>(path[1].u()) {
                // Matched double path separator at beginning
                let mut j = 2;
                let mut last = j;
                // Match 1 or more non-path separators
                while j < len && !is_path_separator::<W>(path[j].u()) {
                    j += 1;
                }
                if j < len && j != last {
                    r.first_part_start = last;
                    r.first_part_end = j;
                    let first_part_is_namespace = (j - last == 1)
                        && (path[last].u() == CHAR_DOT as u32
                            || path[last].u() == CHAR_QUESTION_MARK as u32);
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while j < len && is_path_separator::<W>(path[j].u()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while j < len && !is_path_separator::<W>(path[j].u()) {
                            j += 1;
                        }
                        if j == len || j != last {
                            if first_part_is_namespace {
                                // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
                                r.device.kind = DeviceKind::Namespace;
                                r.root_end = 4;
                            } else if mode == RootMode::Normalize && j == len {
                                // We matched a UNC root only
                                r.unc_root_only = true;
                                r.last = last;
                            } else {
                                // We matched a UNC root
                                r.device.kind = DeviceKind::Unc;
                                r.device.a0 = r.first_part_start;
                                r.device.a1 = r.first_part_end;
                                r.device.b0 = last;
                                r.device.b1 = j;
                                r.root_end = j;
                            }
                        }
                    }
                }
            } else {
                r.root_end = 1;
            }
        } else if is_windows_device_root(code) && path[1].u() == CHAR_COLON as u32 {
            // Possible device root
            r.device.kind = DeviceKind::Drive;
            r.root_end = 2;
            if len > 2 && is_path_separator::<W>(path[2].u()) {
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
        storage: &'a mut Buf<u16>,
    ) -> JsResult<Input<'a>> {
        // Windows has the concept of drive-specific current working directories, which
        // cmd.exe publishes as hidden `=C:` environment variables. They can only exist on
        // Windows (POSIX environments reject names containing '='), so only look there.
        #[cfg(windows)]
        let env: Option<Input<'a>> = {
            let mut key: SmallVec<[u16; 40]> = SmallVec::new();
            key.push(b'=' as u16);
            key.extend_from_slice(resolved_device);
            key.push(0);
            match bun_sys::windows::getenv_w(&key) {
                Some(value) if !value.is_empty() => {
                    let p = reserve(storage, value.len());
                    p.copy_from_slice(&value);
                    // SAFETY: `p` borrows `storage`, which lives for `'a`; `storage` is only
                    // written again below on a path that discards this view first.
                    let p: &'a [u16] = unsafe { core::slice::from_raw_parts(p.as_ptr(), p.len()) };
                    Some(Input {
                        string: JSValue::ZERO,
                        chars: Chars::Utf16(p),
                    })
                }
                _ => None,
            }
        };
        #[cfg(not(windows))]
        let env: Option<Input<'a>> = None;
        let out = match env {
            Some(out) => out,
            None => get_cwd(global)?,
        };

        // Verify that a cwd was found and that it actually points
        // to our drive. If not, default to the drive's root.
        let other_drive = with_chars!(out.chars, |p| {
            p.len() > 2
                && p[2].u() == CHAR_BACKWARD_SLASH as u32
                && !equals_case_folded(js_slice(p, 0, 2), resolved_device)
        });
        if other_drive {
            {
                let p = reserve(storage, resolved_device.len() + 1);
                p[..resolved_device.len()].copy_from_slice(resolved_device);
                p[resolved_device.len()] = CHAR_BACKWARD_SLASH as u16;
            }
            let storage: &'a Buf<u16> = storage;
            return Ok(Input {
                string: JSValue::ZERO,
                chars: Chars::Utf16(&storage[..]),
            });
        }
        let _ = storage;
        Ok(out)
    }

    /// The argument-scanning half of `win32.resolve()`. `get_arg(i)` produces
    /// argument `i` (running validateString for the JS entry point).
    pub(super) fn resolve_scan<'a>(
        global: &JSGlobalObject,
        arg_count: Index,
        mut get_arg: impl FnMut(Index) -> JsResult<Input<'a>>,
        st: &mut ResolveState<'a>,
        cwd_storage: &'a mut Buf<u16>,
    ) -> JsResult<()> {
        let mut cwd_storage = Some(cwd_storage);
        let mut i: Index = arg_count - 1;
        while i >= -1 {
            let path: Input<'a>;
            if i >= 0 {
                path = get_arg(i)?;

                // Skip empty entries
                if path.len() == 0 {
                    i -= 1;
                    continue;
                }
            } else if st.device.is_empty() {
                path = get_cwd(global)?;
                // Fast path for current directory
                if arg_count == 0
                    || (arg_count == 1 && path.len() > 0 && is_path_separator::<W>(path.at(0)))
                {
                    let mut trivial = arg_count == 0;
                    if !trivial {
                        let arg = get_arg(0)?;
                        trivial =
                            arg.len() == 0 || (arg.len() == 1 && arg.at(0) == CHAR_DOT as u32);
                    }
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
                i -= 1;
                continue;
            }

            let stop = with_chars!(path.chars, |p| {
                let root = match_root(RootMode::Resolve, p);

                if !root.device.is_none() {
                    if !st.device.is_empty() {
                        let mut device: SmallVec<[u16; 32]> = SmallVec::new();
                        append_device(&mut device, &root.device);
                        if !equals_case_folded(&device[..], &st.device[..]) {
                            // This path points to another device so it is not applicable
                            i -= 1;
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
            i -= 1;
        }
        Ok(())
    }

    /// The string-building half of `win32.resolve()`.
    pub(super) fn resolve_build<'o, C: Unit>(
        global: &JSGlobalObject,
        st: &ResolveState<'_>,
        out: &'o mut Buf<C>,
    ) -> JsResult<&'o [C]> {
        let mut tail_len = 0usize;
        for part in &st.parts {
            tail_len += part.chars.len() - part.root_end + 1;
        }
        let device_len = st.device.len();
        check_length(global, device_len + 1 + tail_len)?;

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

    #[cfg(not(windows))]
    pub(super) fn replace_forward_slashes<'o, C: Unit>(
        input: &[C],
        out: &'o mut Buf<C>,
    ) -> &'o [C] {
        let o = reserve(out, input.len());
        for (d, c) in o.iter_mut().zip(input) {
            *d = if c.u() == CHAR_FORWARD_SLASH as u32 {
                ch(CHAR_BACKWARD_SLASH)
            } else {
                *c
            };
        }
        &out[..]
    }

    /// The result of an internal `win32.resolve()`: characters in one of the two
    /// output buffers, or (fast path) the cwd itself.
    pub(super) enum Resolved<'a> {
        Latin1(&'a [u8]),
        Utf16(&'a [u16]),
    }

    impl<'a> Resolved<'a> {
        pub(super) fn chars(&self) -> Chars<'a> {
            match self {
                Resolved::Latin1(s) => Chars::Latin1(s),
                Resolved::Utf16(s) => Chars::Utf16(s),
            }
        }
    }

    /// `win32.resolve(...paths)` for internal callers with already-validated strings.
    pub(super) fn resolve<'o>(
        global: &JSGlobalObject,
        paths: &[Chars<'o>],
        out8: &'o mut Buf<u8>,
        out16: &'o mut Buf<u16>,
        cwd_storage: &'o mut Buf<u16>,
    ) -> JsResult<Resolved<'o>> {
        let mut st = ResolveState::new();
        resolve_scan(
            global,
            paths.len() as Index,
            |i| {
                Ok(Input {
                    string: JSValue::ZERO,
                    chars: paths[i as usize],
                })
            },
            &mut st,
            cwd_storage,
        )?;
        if let Some(cwd) = st.return_cwd {
            #[cfg(windows)]
            {
                let _ = (out8, out16);
                return Ok(match cwd.chars {
                    Chars::Latin1(s) => Resolved::Latin1(s),
                    Chars::Utf16(s) => Resolved::Utf16(s),
                });
            }
            #[cfg(not(windows))]
            {
                // path = StringPrototypeReplace(path, /\//g, '\\');
                return Ok(match cwd.chars {
                    Chars::Latin1(s) => Resolved::Latin1(replace_forward_slashes(s, out8)),
                    Chars::Utf16(s) => Resolved::Utf16(replace_forward_slashes(s, out16)),
                });
            }
        }
        Ok(if st.all_8bit {
            Resolved::Latin1(resolve_build::<u8>(global, &st, out8)?)
        } else {
            Resolved::Utf16(resolve_build::<u16>(global, &st, out16)?)
        })
    }

    pub(super) fn normalize<'o, C: Unit>(path: &'o [C], out: &'o mut Buf<C>) -> &'o [C] {
        let len = path.len();
        // Caller handles len === 0.
        let code = path[0].u();

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

        let root = match_root(RootMode::Normalize, path);
        let mut device = root.device;
        let mut root_end = root.root_end;
        let is_absolute = root.is_absolute;
        // lib/path.js recomputes StringPrototypeIndexOf(path, ':') at each use; it never changes.
        let colon_index = index_of(path, CHAR_COLON, 0);

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
        } else if root.unc_root_only {
            // We matched a UNC root only
            // Return the normalized version of the UNC root since there
            // is nothing left to process
            let first_part = &path[root.first_part_start..root.first_part_end];
            let rest = &path[root.last..];
            let o = reserve(out, 2 + first_part.len() + 1 + rest.len() + 1);
            o[0] = ch(CHAR_BACKWARD_SLASH);
            o[1] = ch(CHAR_BACKWARD_SLASH);
            let mut p = 2 + copy_units(&mut o[2..], first_part);
            o[p] = ch(CHAR_BACKWARD_SLASH);
            p += 1;
            p += copy_units(&mut o[p..], rest);
            o[p] = ch(CHAR_BACKWARD_SLASH);
            return &out[..p + 1];
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
        if tail_len > 0 && is_path_separator::<W>(path[len - 1].u()) {
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
                && is_windows_device_root(buf[tail_start].u())
                && buf[tail_start + 1].u() == CHAR_COLON as u32
            {
                prepend_dot_slash!();
                return &out[head..tail_end];
            }
            let mut index = colon_index;

            loop {
                if index == len as Index - 1 || is_path_separator::<W>(path[index as usize + 1].u())
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
        global: &JSGlobalObject,
        paths: &[Chars<'_>],
        joined_buf: &'o mut Buf<C>,
        out: &'o mut Buf<C>,
    ) -> JsResult<&'o [C]> {
        // Caller has removed empty arguments and handled the none-left case.
        let mut joined_len = paths.len() - 1;
        for path in paths {
            joined_len += path.len();
        }
        let joined_len = check_length(global, joined_len)?;
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
            while slash_count < joined_len && is_path_separator::<W>(base[slash_count].u()) {
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
        let mut colon = index_of(joined, CHAR_COLON, 0);
        while colon != -1 {
            // Reserved names are at most 4 characters, so looking back 5 is enough to decide.
            let mut part_start = colon as usize;
            let limit = (colon - 5).max(0) as usize;
            while part_start > limit
                && joined[part_start - 1].u() != CHAR_BACKWARD_SLASH as u32
                && joined[part_start - 1].u() != CHAR_COLON as u32
            {
                part_start -= 1;
            }
            // Otherwise: an earlier colon in this part, or a part longer than any reserved name.
            if part_start == 0 || joined[part_start - 1].u() == CHAR_BACKWARD_SLASH as u32 {
                if is_windows_reserved_name(&joined[part_start..colon as usize]) {
                    // Replace forward slashes with backslashes
                    for c in joined.iter_mut() {
                        if c.u() == CHAR_FORWARD_SLASH as u32 {
                            *c = ch(CHAR_BACKWARD_SLASH);
                        }
                    }
                    return Ok(&joined_buf[joined_start..joined_len]);
                }
            }
            colon = index_of(joined, CHAR_COLON, colon + 1);
        }

        Ok(normalize::<C>(&joined_buf[joined_start..joined_len], out))
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
            let split = |s: &[C]| -> SmallVec<[(usize, usize); 32]> {
                let mut parts: SmallVec<[(usize, usize); 32]> = SmallVec::new();
                let mut start = 0;
                for i in 0..=s.len() {
                    if i == s.len() || s[i].u() == CHAR_BACKWARD_SLASH as u32 {
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
            return to_js(global, &out[..p]);
        }

        // Trim any leading backslashes
        let mut from_start: Index = 0;
        while from_start < from.len() as Index
            && from[from_start as usize].u() == CHAR_BACKWARD_SLASH as u32
        {
            from_start += 1;
        }
        // Trim trailing backslashes (applicable to UNC paths only)
        let mut from_end: Index = from.len() as Index;
        while from_end - 1 > from_start
            && from[(from_end - 1) as usize].u() == CHAR_BACKWARD_SLASH as u32
        {
            from_end -= 1;
        }
        let from_len: Index = from_end - from_start;

        // Trim any leading backslashes
        let mut to_start: Index = 0;
        while to_start < to.len() as Index
            && to[to_start as usize].u() == CHAR_BACKWARD_SLASH as u32
        {
            to_start += 1;
        }
        // Trim trailing backslashes (applicable to UNC paths only)
        let mut to_end: Index = to.len() as Index;
        while to_end - 1 > to_start && to[(to_end - 1) as usize].u() == CHAR_BACKWARD_SLASH as u32 {
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
            && from[(from_start + last_common_sep) as usize].u() != CHAR_BACKWARD_SLASH as u32
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
                if to[(to_start + i) as usize].u() == CHAR_BACKWARD_SLASH as u32 {
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
                if from[(from_start + i) as usize].u() == CHAR_BACKWARD_SLASH as u32 {
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
            if i == from_end || from[i as usize].u() == CHAR_BACKWARD_SLASH as u32 {
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
            && to_orig[to_start as usize].u() == CHAR_BACKWARD_SLASH as u32
        {
            to_start += 1;
        }
        to_js(global, js_slice(to_orig, to_start, to_end))
    }

    pub(super) fn dirname(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
        // Caller handles len === 0.
        with_chars!(path.chars, |p| {
            let len = p.len() as Index;
            let mut root_end: Index = -1;
            let mut offset: Index = 0;
            let code = p[0].u();

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

                if is_path_separator::<W>(p[1].u()) {
                    // Matched double path separator at beginning
                    let mut j: Index = 2;
                    let mut last: Index = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_path_separator::<W>(p[j as usize].u()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more path separators
                        while j < len && is_path_separator::<W>(p[j as usize].u()) {
                            j += 1;
                        }
                        if j < len && j != last {
                            // Matched!
                            last = j;
                            // Match 1 or more non-path separators
                            while j < len && !is_path_separator::<W>(p[j as usize].u()) {
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
            } else if is_windows_device_root(code) && p[1].u() == CHAR_COLON as u32 {
                root_end = if len > 2 && is_path_separator::<W>(p[2].u()) {
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
                if is_path_separator::<W>(p[i as usize].u()) {
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

    pub(super) fn basename(
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
            if path_length >= 2 && is_windows_device_root(p[0].u()) && p[1].u() == CHAR_COLON as u32
            {
                start = 2;
            }

            if let Some(suffix) = suffix.filter(|s| s.len() > 0 && s.len() as Index <= path_length)
            {
                return with_chars!(suffix.chars, |s| {
                    if span_equals(s, p) {
                        return empty_string(global);
                    }
                    let mut ext_idx: Index = s.len() as Index - 1;
                    let mut first_non_slash_end: Index = -1;
                    let mut i: Index = path_length - 1;
                    while i >= start {
                        let code = p[i as usize].u();
                        if is_path_separator::<W>(code) {
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
                                if code == s[ext_idx as usize].u() {
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
                if is_path_separator::<W>(p[i as usize].u()) {
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

    pub(super) fn extname(global: &JSGlobalObject, path: &Input<'_>) -> JSValue {
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

            if path_length >= 2 && p[1].u() == CHAR_COLON as u32 && is_windows_device_root(p[0].u())
            {
                start = 2;
                start_part = 2;
            }

            let mut i: Index = path_length - 1;
            while i >= start {
                let code = p[i as usize].u();
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

    pub(super) fn parse(path: &Input<'_>, ret: &mut Parsed) {
        // Caller handles path.length === 0 and pre-fills every field with ''.
        with_chars!(path.chars, |p| {
            let len = p.len() as Index;
            let mut root_end: Index = 0;
            let mut code = p[0].u();

            if len == 1 {
                if is_path_separator::<W>(code) {
                    // `path` contains just a path separator, exit early to avoid
                    // unnecessary work
                    ret.root = (0, 1);
                    ret.dir = (0, 1);
                    return;
                }
                ret.base = (0, 1);
                ret.name = (0, 1);
                return;
            }
            // Try to match a root
            if is_path_separator::<W>(code) {
                // Possible UNC root

                root_end = 1;
                if is_path_separator::<W>(p[1].u()) {
                    // Matched double path separator at beginning
                    let mut j: Index = 2;
                    let mut last: Index = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_path_separator::<W>(p[j as usize].u()) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more path separators
                        while j < len && is_path_separator::<W>(p[j as usize].u()) {
                            j += 1;
                        }
                        if j < len && j != last {
                            // Matched!
                            last = j;
                            // Match 1 or more non-path separators
                            while j < len && !is_path_separator::<W>(p[j as usize].u()) {
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
            } else if is_windows_device_root(code) && p[1].u() == CHAR_COLON as u32 {
                // Possible device root
                if len <= 2 {
                    // `path` contains just a drive root, exit early to avoid
                    // unnecessary work
                    ret.root = (0, len);
                    ret.dir = (0, len);
                    return;
                }
                root_end = 2;
                if is_path_separator::<W>(p[2].u()) {
                    if len == 3 {
                        // `path` contains just a drive root, exit early to avoid
                        // unnecessary work
                        ret.root = (0, len);
                        ret.dir = (0, len);
                        return;
                    }
                    root_end = 3;
                }
            }
            if root_end > 0 {
                ret.root = (0, root_end);
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
                code = p[i as usize].u();
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
                    ret.base = (start_part, end);
                    ret.name = (start_part, end);
                } else {
                    ret.name = (start_part, start_dot);
                    ret.base = (start_part, end);
                    ret.ext = (start_dot, end);
                }
            }

            // If the directory is the root, use the entire root as the `dir` including
            // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
            // trailing slash (`C:\abc\def` -> `C:\abc`).
            if start_part > 0 && start_part != root_end {
                ret.dir = (0, start_part - 1);
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

    if !WIN {
        let mut fast_cwd_storage: Buf<u16> = Buf::new();
        if arg_count <= 1 {
            let mut trivial = arg_count == 0;
            if !trivial {
                let value = args[0];
                if value.is_string() {
                    let arg = view_of(global, value)?;
                    trivial = arg.len() == 0 || (arg.len() == 1 && arg.at(0) == CHAR_DOT as u32);
                }
            }
            if trivial {
                let cwd = posix::cwd(global, &mut fast_cwd_storage)?;
                if cwd.len() > 0 && cwd.at(0) == CHAR_FORWARD_SLASH as u32 {
                    if !cwd.string.is_empty() {
                        return Ok(cwd.string);
                    }
                    return with_chars!(cwd.chars, |s| to_js(global, s));
                }
            }
        }
        let mut cwd_storage: Buf<u16> = Buf::new();

        // in visit (reverse) order
        let mut stack: SmallVec<[Input<'_>; 16]> = SmallVec::new();
        let mut all_8bit = true;
        let mut resolved_absolute = false;
        let mut i = arg_count - 1;
        while i >= 0 && !resolved_absolute {
            let value = args[i as usize];
            if !value.is_string() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("paths[{i}]"),
                    "string",
                    value,
                ));
            }
            let path = view_of(global, value)?;
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
            let cwd = posix::cwd(global, &mut cwd_storage)?;
            stack.push(cwd);
            all_8bit &= cwd.is_8bit();
        }

        let mut parts: SmallVec<[Chars<'_>; 16]> = SmallVec::with_capacity(stack.len());
        for input in stack.iter().rev() {
            parts.push(input.chars);
        }

        macro_rules! finish {
            ($C:ty) => {{
                let mut out: Buf<$C> = Buf::new();
                let result = posix::resolve::<$C>(global, &parts, &mut out)?;
                if stack.len() == 1 {
                    return to_js_reusing(global, result, &stack[0]);
                }
                return to_js(global, result);
            }};
        }
        if all_8bit { finish!(u8) } else { finish!(u16) }
    } else {
        let mut cwd_storage: Buf<u16> = Buf::new();
        let mut st = win32::ResolveState::new();
        let get_arg = |i: Index| -> JsResult<Input<'_>> {
            let value = args[i as usize];
            if !value.is_string() {
                return Err(global.throw_invalid_argument_type_value(
                    format!("paths[{i}]"),
                    "string",
                    value,
                ));
            }
            view_of(global, value)
        };
        win32::resolve_scan(global, arg_count, get_arg, &mut st, &mut cwd_storage)?;
        if let Some(cwd) = st.return_cwd {
            #[cfg(windows)]
            {
                return Ok(cwd.string);
            }
            #[cfg(not(windows))]
            {
                return with_chars!(cwd.chars, |s| {
                    if index_of(s, CHAR_FORWARD_SLASH, 0) == -1 {
                        return Ok(cwd.string);
                    }
                    let mut out = Buf::new();
                    to_js(global, win32::replace_forward_slashes(s, &mut out))
                });
            }
        }
        if st.all_8bit {
            let mut out: Buf<u8> = Buf::new();
            return to_js(global, win32::resolve_build::<u8>(global, &st, &mut out)?);
        }
        let mut out: Buf<u16> = Buf::new();
        to_js(global, win32::resolve_build::<u16>(global, &st, &mut out)?)
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
        let mut out = Buf::new();
        let result = if WIN {
            win32::normalize(p, &mut out)
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

    if paths.is_empty() {
        return Ok(dot_string(global));
    }

    macro_rules! finish {
        ($C:ty) => {{
            let mut joined: Buf<$C> = Buf::new();
            let mut out: Buf<$C> = Buf::new();
            let result = if WIN {
                win32::join::<$C>(global, &paths, &mut joined, &mut out)?
            } else {
                posix::join::<$C>(global, &paths, &mut joined, &mut out)?
            };
            if paths.len() == 1 {
                return to_js_reusing(global, result, &single.unwrap());
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

    if !WIN {
        let mut cwd_storage: Buf<u16> = Buf::new();
        let mut all_8bit = from.is_8bit() && to.is_8bit();
        let mut cwd: Option<Input<'_>> = None;
        if posix::needs_cwd(&from.chars) || posix::needs_cwd(&to.chars) {
            let c = posix::cwd(global, &mut cwd_storage)?;
            all_8bit &= c.is_8bit();
            cwd = Some(c);
        }
        if all_8bit {
            return posix::relative::<u8>(global, from.chars, to.chars, cwd.as_ref());
        }
        posix::relative::<u16>(global, from.chars, to.chars, cwd.as_ref())
    } else {
        let mut from8: Buf<u8> = Buf::new();
        let mut to8: Buf<u8> = Buf::new();
        let mut from16: Buf<u16> = Buf::new();
        let mut to16: Buf<u16> = Buf::new();
        let mut cwd_a: Buf<u16> = Buf::new();
        let mut cwd_b: Buf<u16> = Buf::new();
        let (from_paths, to_paths) = ([from.chars], [to.chars]);
        let from_orig = win32::resolve(global, &from_paths, &mut from8, &mut from16, &mut cwd_a)?;
        let to_orig = win32::resolve(global, &to_paths, &mut to8, &mut to16, &mut cwd_b)?;
        match (from_orig, to_orig) {
            (win32::Resolved::Latin1(f), win32::Resolved::Latin1(t)) => {
                win32::relative::<u8>(global, f, t)
            }
            (f, t) => {
                let (f, t) = (f.chars(), t.chars());
                let mut wf: Buf<u16> = Buf::new();
                let mut wt: Buf<u16> = Buf::new();
                f.copy_to(reserve(&mut wf, f.len()));
                t.copy_to(reserve(&mut wt, t.len()));
                win32::relative::<u16>(global, &wf, &wt)
            }
        }
    }
}

/// `win32.toNamespacedPath()`; the posix one is the identity and lives in path.ts.
fn to_namespaced_path(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    // Note: this will *probably* throw somewhere.
    if !value.is_string() {
        return Ok(value);
    }
    let path = view_of(global, value)?;
    if path.len() == 0 {
        return Ok(value);
    }

    let mut out8: Buf<u8> = Buf::new();
    let mut out16: Buf<u16> = Buf::new();
    let mut cwd_storage: Buf<u16> = Buf::new();
    let paths = [path.chars];
    let resolved_path = win32::resolve(global, &paths, &mut out8, &mut out16, &mut cwd_storage)?;

    with_chars!(resolved_path.chars(), |r| {
        if r.len() <= 2 {
            return Ok(value);
        }

        if r[0].u() == CHAR_BACKWARD_SLASH as u32 {
            // Possible UNC root
            if r[1].u() == CHAR_BACKWARD_SLASH as u32 {
                let code = r[2].u();
                if code != CHAR_QUESTION_MARK as u32 && code != CHAR_DOT as u32 {
                    // Matched non-long UNC root, convert the path to a long UNC path
                    let mut out = buf_like(r);
                    let o = reserve(&mut out, 8 + r.len() - 2);
                    let p = copy_units(o, b"\\\\?\\UNC\\");
                    copy_units(&mut o[p..], &r[2..]);
                    return to_js(global, &out[..]);
                }
            }
        } else if is_windows_device_root(r[0].u())
            && r[1].u() == CHAR_COLON as u32
            && r[2].u() == CHAR_BACKWARD_SLASH as u32
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
    Ok(if WIN {
        win32::basename(global, &path, suffix.as_ref())
    } else {
        posix::basename(global, &path, suffix.as_ref())
    })
}

fn extname<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let value = frame.argument(0);
    validate_string(global, value, "path")?;
    let path = view_of(global, value)?;
    Ok(if WIN {
        win32::extname(global, &path)
    } else {
        posix::extname(global, &path)
    })
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

fn dirname_host<const WIN: bool>(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    dirname::<WIN>(global, frame.argument(0))
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

/// `path.join(lhs, rhs)` for `Module.createRequire`; writes a new +1 string to `result`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Path__joinString(
    is_windows: bool,
    lhs: &bun_core::String,
    rhs: &bun_core::String,
    result: &mut bun_core::String,
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
    let inputs = [chars_of(lhs), chars_of(rhs)];
    let mut paths: SmallVec<[Chars<'_>; 2]> = SmallVec::new();
    let mut all_8bit = true;
    for c in inputs {
        if c.len() > 0 {
            all_8bit &= c.is_8bit();
            paths.push(c);
        }
    }
    if paths.is_empty() {
        *result = bun_core::String::static_(b".");
        return;
    }
    // The inputs are existing strings, so the joined length cannot exceed the string limit
    // by more than one and no JS exception can be raised; `check_length` needs a global only
    // for that throw, so run the join without one.
    macro_rules! finish {
        ($C:ty, $make:ident) => {{
            let mut joined: Buf<$C> = Buf::new();
            let mut out: Buf<$C> = Buf::new();
            let joined_len = paths.iter().map(|p| p.len()).sum::<usize>() + paths.len() - 1;
            let j = reserve(&mut joined, joined_len);
            let mut p = 0;
            for (i, path) in paths.iter().enumerate() {
                if i != 0 {
                    j[p] = ch(separator(is_windows));
                    p += 1;
                }
                p += path.copy_to(&mut j[p..]);
            }
            let normalized: &[$C] = if is_windows {
                // win32.join()'s reserved-name and leading-slash handling never applies to
                // `createRequire(<absolute path ending in a separator>)` + 'noop.js'.
                win32::normalize(&joined[..], &mut out)
            } else {
                posix::normalize(&joined[..], &mut out)
            };
            *result = bun_core::String::$make(normalized);
        }};
    }
    if all_8bit {
        finish!(u8, clone_latin1)
    } else {
        finish!(u16, clone_utf16)
    }
}
