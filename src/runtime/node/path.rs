use crate::jsc::rare_data::PathBuf as RarePathBuf;
use crate::jsc::{
    JSGlobalObject, JSValue, JsResult, SysErrorJsc as _, bun_string_jsc as BunString, host_fn,
};
use crate::node::validators::{validate_object, validate_string};
use bun_collections::smallvec::SmallVec;
use bun_core::{ZigString, ZigStringSlice, strings};
use bun_paths::{self, MAX_PATH_BYTES, Platform};
use bun_sys;

/// Local shim for `bun.String.createUTF8ForJS` over `[T]` (T = u8 | u16).
///
/// Zig's `createUTF8ForJS` only accepts `[]const u8`, but the `*JS_T` wrappers
/// in path.zig are `comptime T`-generic. In practice every JS entry point
/// converts to UTF-8 first (via `ZigString.toSlice`) and instantiates with
/// `T = u8`, so the `u16` arm is never reached at runtime — but it must still
/// type-check. Dispatch on `T::IS_U16` and route the cold u16 arm through
/// `bun.String.cloneUTF16(...).toJS(...)` so the generic body unifies.
#[inline]
fn create_js_string_t<T: PathCharCwd>(global: &JSGlobalObject, s: &[T]) -> JsResult<JSValue> {
    use crate::jsc::{StringJsc as _, bun_string_jsc};
    if T::IS_U16 {
        // T == u16 when IS_U16; bytemuck statically checks the layout.
        let s16: &[u16] = bytemuck::cast_slice::<T, u16>(s);
        let bs = bun_core::String::clone_utf16(s16);
        let r = bs.to_js(global);
        bs.deref();
        r
    } else {
        // T == u8 when !IS_U16; bytemuck statically checks the layout.
        let s8: &[u8] = bytemuck::cast_slice::<T, u8>(s);
        bun_string_jsc::create_utf8_for_js(global, s8)
    }
}

// ── Local extension shims for upstream types missing methods (cannot edit upstream crates).

/// `ZigString.trunc(n)` — clamp `len` to `n` (ZigString.zig:580).
trait ZigStringTruncExt {
    fn trunc(&self, len: usize) -> ZigString;
}
impl ZigStringTruncExt for ZigString {
    #[inline]
    fn trunc(&self, len: usize) -> ZigString {
        let mut out = *self;
        out.len = out.len.min(len);
        out
    }
}

// Allow on the stack:
// - 8 string slices
// - 3 path buffers
// - extra padding
const STACK_FALLBACK_SIZE_LARGE: usize =
    8 * core::mem::size_of::<&[u8]>() + ((STACK_FALLBACK_SIZE_SMALL * 3) + 64);

/// Pooled path scratch carved from the per-VM [`RarePathBuf`] (mirrors Zig's
/// `RareData.path_buf.get(min_len, fallback)` `StackFallbackAllocator`).
///
/// JS is single-threaded, so re-using the lazily-allocated tier across calls is
/// sound. When the request exceeds the largest tier (32 × `MAX_PATH_BYTES`) —
/// or when `T = u16`, since the pool is byte-typed — we spill to a one-shot
/// zeroed heap slab instead (`T: Pod`, so the zero-fill is the cost of handing
/// out a safe `&mut [T]`; consumers are write-before-read so the zeros are
/// never observed).
enum PathScratch<'a, T: PathCharCwd> {
    Pooled(&'a mut [T]),
    Spill(Box<[T]>),
}

impl<'a, T: PathCharCwd> PathScratch<'a, T> {
    /// Largest pool tier in `RarePathBuf` (`32 * MAX_PATH_BYTES`).
    const POOL_MAX: usize = 32 * MAX_PATH_BYTES;

    #[inline]
    fn new(pool: &'a mut RarePathBuf, len: usize) -> Self {
        if !T::IS_U16 && len <= Self::POOL_MAX {
            // SAFETY-adjacent: `!IS_U16` ⇒ `T == u8`; `cast_slice_mut::<u8, u8>`
            // is the bytemuck identity cast — never panics, no alignment hazard.
            let bytes = &mut pool.get(len)[..len];
            Self::Pooled(bytemuck::cast_slice_mut::<u8, T>(bytes))
        } else {
            // `T: Pod` ⇒ `T: Zeroable + Copy`. Spill is rare (u8 only when
            // >128 KB) or path-sized (u16), so the zero-fill is negligible and
            // buys a safe `&mut [T]` in `slice()`.
            Self::Spill(vec![<T as bytemuck::Zeroable>::zeroed(); len].into_boxed_slice())
        }
    }

    #[inline]
    fn slice(&mut self) -> &mut [T] {
        match self {
            Self::Pooled(s) => s,
            Self::Spill(b) => &mut b[..],
        }
    }
}

const PATH_MIN_WIDE: usize = 4096; // 4 KB
#[cfg(windows)]
// Up to 4 KB, instead of MAX_PATH_BYTES which is 96 KB on Windows, ouch!
const STACK_FALLBACK_SIZE_SMALL: usize = PATH_MIN_WIDE;
#[cfg(not(windows))]
const STACK_FALLBACK_SIZE_SMALL: usize = MAX_PATH_BYTES;

/// Canonical path-unit trait — re-export so external callers that named
/// `crate::node::path::PathChar` keep compiling.
pub use bun_paths::PathChar;

/// Runtime-only extension over [`PathChar`]: adds the `bun_sys`-coupled
/// per-width `get_cwd` plus the `bytemuck::Pod`/`Default` bounds this module
/// needs for `PathScratch`'s `cast_slice` and zero-init. Every generic `_t`
/// fn here bounds on `PathCharCwd` (only `u8`/`u16` ever instantiate it).
pub trait PathCharCwd: PathChar + Default + bytemuck::Pod {
    /// Per-width `get_cwd` — replaces the `IS_U16` runtime dispatch in `get_cwd_t`.
    fn get_cwd(buf: &mut [Self]) -> bun_sys::Result<&mut [Self]>;
}
impl PathCharCwd for u8 {
    #[inline]
    fn get_cwd(buf: &mut [u8]) -> bun_sys::Result<&mut [u8]> {
        get_cwd_u8(buf)
    }
}
impl PathCharCwd for u16 {
    #[inline]
    fn get_cwd(buf: &mut [u16]) -> bun_sys::Result<&mut [u16]> {
        get_cwd_u16(buf)
    }
}

/// `bun.strings.literal(T, "...")` — yields a `&'static [T]` for the ASCII literal.
#[inline]
fn l<T: PathCharCwd>(s: &'static [u8]) -> &'static [T] {
    T::lit(s)
}

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Compares ASCII values case-insensitively, non-ASCII values are compared directly
fn eql_ignore_case_t<T: PathCharCwd>(a: &[T], b: &[T]) -> bool {
    if !T::IS_U16 {
        // T == u8 when !IS_U16; bytemuck statically checks the layout.
        let a8: &[u8] = bytemuck::cast_slice::<T, u8>(a);
        let b8: &[u8] = bytemuck::cast_slice::<T, u8>(b);
        return strings::eql_case_insensitive_ascii(a8, b8, true);
    }
    // Zig's `eqlIgnoreCaseT` body for `T == u16` falls through with no return (UB if reached);
    // in practice the only callers instantiate with `T == u8`. Provide a sound u16 compare so
    // the generic body type-checks and behaves correctly if ever exercised.
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .all(|(x, y)| to_lower_t(*x) == to_lower_t(*y))
}

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Lowers ASCII values, non-ASCII values are returned directly
#[inline]
fn to_lower_t<T: PathCharCwd>(a_c: T) -> T {
    if !T::IS_U16 {
        return T::from_u8(
            u8::try_from(a_c.as_u32())
                .expect("int cast")
                .to_ascii_lowercase(),
        );
    }
    if a_c.as_u32() < 128 {
        T::from_u8(
            u8::try_from(a_c.as_u32())
                .expect("int cast")
                .to_ascii_lowercase(),
        )
    } else {
        a_c
    }
}

// `jsc.Node.Maybe([]T, Syscall.Error)` → bun_sys::Result<&mut [T]>
type MaybeBuf<'a, T> = bun_sys::Result<&'a mut [T]>;
// `jsc.Node.Maybe([:0]const T, Syscall.Error)` → bun_sys::Result<&[T]>
// NUL termination is written into the backing buffer at `buf[len]`; the returned
// slice itself is `&[T]` (Rust has no `[:0]T` sentinel type).
type MaybeSlice<'a, T> = bun_sys::Result<&'a [T]>;

// validatePathT is enforced at compile time by the `PathChar` trait bound.

const CHAR_BACKWARD_SLASH: u8 = b'\\';
const CHAR_COLON: u8 = b':';
const CHAR_DOT: u8 = b'.';
const CHAR_FORWARD_SLASH: u8 = b'/';
const CHAR_QUESTION_MARK: u8 = b'?';

const CHAR_STR_BACKWARD_SLASH: &[u8] = b"\\";
const CHAR_STR_FORWARD_SLASH: &[u8] = b"/";
const CHAR_STR_DOT: &[u8] = b".";

/// Based on Node v21.6.1 path.parse:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L919
/// The structs returned by parse methods.
#[derive(Default)]
pub struct PathParsed<'a, T: PathCharCwd> {
    pub root: &'a [T],
    pub dir: &'a [T],
    pub base: &'a [T],
    pub ext: &'a [T],
    pub name: &'a [T],
}

// path.zig:2750 — `extern "c" fn PathParsedObject__create(*jsc.JSGlobalObject, jsc.JSValue × 5) jsc.JSValue;`
// `&JSGlobalObject` is ABI-identical to a non-null pointer; remaining params are
// by-value `JSValue`, so no caller-side preconditions remain.
unsafe extern "C" {
    safe fn PathParsedObject__create(
        global: &JSGlobalObject,
        root: JSValue,
        dir: JSValue,
        base: JSValue,
        ext: JSValue,
        name: JSValue,
    ) -> JSValue;
}

impl<'a, T: PathCharCwd> PathParsed<'a, T> {
    pub fn to_js_object(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        // PORT NOTE: alias the free-fn module so the Zig-mirrored
        // `BunString::create_utf8_for_js(...)` call shape resolves (same pattern
        // as the per-submodule imports below).
        let root = create_js_string_t::<T>(global_object, self.root)?;
        let dir = create_js_string_t::<T>(global_object, self.dir)?;
        let base = create_js_string_t::<T>(global_object, self.base)?;
        let ext = create_js_string_t::<T>(global_object, self.ext)?;
        let name_val = create_js_string_t::<T>(global_object, self.name)?;
        Ok(PathParsedObject__create(
            global_object,
            root,
            dir,
            base,
            ext,
            name_val,
        ))
    }
}

pub const fn max_path_size<T: PathCharCwd>() -> usize {
    if T::IS_U16 {
        bun_paths::PATH_MAX_WIDE
    } else {
        MAX_PATH_BYTES
    }
}

/// Upper bound of `max_path_size::<T>()` across both `T = u8` and `T = u16` on
/// the current target. Used for sizing stack buffers where the `T`-dependent
/// array length can't be expressed as a const-generic (Zig's `[MAX_PATH_SIZE(T):0]T`).
const MAX_PATH_SIZE_UPPER: usize = if MAX_PATH_BYTES > bun_paths::PATH_MAX_WIDE {
    MAX_PATH_BYTES
} else {
    bun_paths::PATH_MAX_WIDE
};

pub const fn path_size<T: PathCharCwd>() -> usize {
    if T::IS_U16 {
        PATH_MIN_WIDE
    } else {
        MAX_PATH_BYTES
    }
}

pub const SEP_POSIX: u8 = CHAR_FORWARD_SLASH;
pub const SEP_WINDOWS: u8 = CHAR_BACKWARD_SLASH;
pub const SEP_STR_POSIX: &[u8] = CHAR_STR_FORWARD_SLASH;
pub const SEP_STR_WINDOWS: &[u8] = CHAR_STR_BACKWARD_SLASH;

/// Helper: `bun.memmove(dst, src)` — equal-length copy.
/// (Rust's borrow rules forbid `&mut [T]`/`&[T]` overlap, so memmove ⇒ memcpy.)
#[inline]
fn memmove<T: Copy>(dst: &mut [T], src: &[T]) {
    dst.copy_from_slice(src);
}

/// Helper: `bun.copy(T, dst, src)` — `dst.len() >= src.len()`.
/// (Rust's borrow rules forbid `&mut [T]`/`&[T]` overlap, so memmove ⇒ memcpy.)
#[inline]
fn copy_overlapping<T: Copy>(dst: &mut [T], src: &[T]) {
    dst[..src.len()].copy_from_slice(src);
}

/// Based on Node v21.6.1 private helper formatExt:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L130C10-L130C19
#[inline]
fn format_ext_t<'a, T: PathCharCwd>(ext: &'a [T], buf: &'a mut [T]) -> &'a [T] {
    let len = ext.len();
    if len == 0 {
        return &[];
    }
    if ext[0] == T::from_u8(CHAR_DOT) {
        return ext;
    }
    let buf_size = len + 1;
    buf[0] = T::from_u8(CHAR_DOT);
    memmove(&mut buf[1..buf_size], ext);
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 private helper posixCwd:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1074
pub fn posix_cwd_t<T: PathCharCwd>(buf: &mut [T]) -> MaybeBuf<'_, T> {
    let cwd = match get_cwd_t(buf) {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    let len = cwd.len();
    if len == 0 {
        return Ok(cwd);
    }
    #[cfg(windows)]
    {
        // Converts Windows' backslash path separators to POSIX forward slashes
        // and truncates any drive indicator

        // Translated from the following JS code:
        //   const cwd = StringPrototypeReplace(process.cwd(), regexp, '/');
        // PORT NOTE: reshaped for borrowck — cwd already aliases buf, so mutate in place.
        for i in 0..len {
            if cwd[i] == T::from_u8(CHAR_BACKWARD_SLASH) {
                cwd[i] = T::from_u8(CHAR_FORWARD_SLASH);
            }
        }
        let normalized_cwd = &mut cwd[0..len];

        // Translated from the following JS code:
        //   return StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/'));
        let index = normalized_cwd
            .iter()
            .position(|&b| b == T::from_u8(CHAR_FORWARD_SLASH));
        // Account for the -1 case of String#slice in JS land
        if let Some(_index) = index {
            return Ok(&mut normalized_cwd[_index..len]);
        }
        return Ok(&mut normalized_cwd[len - 1..len]);
    }

    // We're already on POSIX, no need for any transformations
    #[cfg(not(windows))]
    Ok(cwd)
}

#[cfg(windows)]
#[inline]
fn without_trailing_slash(s: &[u8]) -> &[u8] {
    bun_paths::string_paths::without_trailing_slash_windows_path(s)
}
#[cfg(not(windows))]
#[inline]
fn without_trailing_slash(s: &[u8]) -> &[u8] {
    strings::without_trailing_slash(s)
}

pub fn get_cwd_windows_u16(buf: &mut [u16]) -> MaybeBuf<'_, u16> {
    let len = strings::convert_utf8_to_utf16_in_buffer(
        buf,
        without_trailing_slash(bun_paths::fs::FileSystem::instance().top_level_dir()),
    )
    .len();
    if len == 0 {
        // Zig's `MaybeBuf(u16).errnoSys(0, .getcwd)` indirectly captures
        // kernel32.GetLastError() on Windows. In practice top_level_dir is
        // never empty so this arm is unreachable, but preserve the errno
        // source on the platform where it matters.
        #[cfg(windows)]
        return Err(bun_sys::Error::from_code(
            bun_sys::windows::get_last_errno(),
            bun_sys::Tag::getcwd,
        ));
        #[cfg(not(windows))]
        return Err(bun_sys::Error::from_code_int(0, bun_sys::Tag::getcwd));
    }
    Ok(&mut buf[0..len])
}

pub fn get_cwd_u8(buf: &mut [u8]) -> MaybeBuf<'_, u8> {
    let cached_cwd = without_trailing_slash(bun_paths::fs::FileSystem::instance().top_level_dir());
    buf[0..cached_cwd.len()].copy_from_slice(cached_cwd);
    Ok(&mut buf[0..cached_cwd.len()])
}

pub fn get_cwd_u16(buf: &mut [u16]) -> MaybeBuf<'_, u16> {
    let result = strings::convert_utf8_to_utf16_in_buffer(
        buf,
        without_trailing_slash(bun_paths::fs::FileSystem::instance().top_level_dir()),
    );
    Ok(result)
}

#[inline]
pub fn get_cwd_t<T: PathCharCwd>(buf: &mut [T]) -> MaybeBuf<'_, T> {
    T::get_cwd(buf)
}

// Alias for naming consistency.
pub use get_cwd_u8 as get_cwd;

/// Based on Node v21.6.1 path.posix.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1309
pub fn basename_posix_t<'a, T: PathCharCwd>(path: &'a [T], suffix: Option<&[T]>) -> &'a [T] {
    // validateString of `path` is performed in pub fn basename.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    let _suffix: &[T] = suffix.unwrap_or(&[]);
    let _suffix_len = _suffix.len();
    if suffix.is_some() && _suffix_len > 0 && _suffix_len <= len {
        if _suffix == path {
            return &[];
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut ext_idx: Option<usize> = Some(_suffix_len - 1);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut first_non_slash_end: Option<usize> = None;
        let mut i_i64 = i64::try_from(len - 1).expect("int cast");
        while i_i64 >= i64::try_from(start).expect("int cast") {
            let i = usize::try_from(i_i64).expect("int cast");
            let byte = path[i];
            if byte == T::from_u8(CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start = i + 1;
                    break;
                }
            } else {
                if first_non_slash_end.is_none() {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matched_slash = false;
                    first_non_slash_end = Some(i + 1);
                }
                if let Some(_ext_ix) = ext_idx {
                    // Try to match the explicit extension
                    if byte == _suffix[_ext_ix] {
                        if _ext_ix == 0 {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = Some(i);
                            ext_idx = None;
                        } else {
                            ext_idx = Some(_ext_ix - 1);
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        ext_idx = None;
                        end = first_non_slash_end;
                    }
                }
            }
            i_i64 -= 1;
        }

        if let Some(_end) = end {
            if start == _end {
                return &path[start..first_non_slash_end.unwrap()];
            } else {
                return &path[start.._end];
            }
        }
        return &path[start..len];
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 > -1 {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start = i + 1;
                break;
            }
        } else if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // path component
            matched_slash = false;
            end = Some(i + 1);
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        &path[start.._end]
    } else {
        &[]
    }
}

/// Based on Node v21.6.1 path.win32.basename:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L753
pub fn basename_windows_t<'a, T: PathCharCwd>(path: &'a [T], suffix: Option<&[T]>) -> &'a [T] {
    // validateString of `path` is performed in pub fn basename.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded
    if len >= 2 && is_windows_device_root_t(path[0]) && path[1] == T::from_u8(CHAR_COLON) {
        start = 2;
    }

    let _suffix: &[T] = suffix.unwrap_or(&[]);
    let _suffix_len = _suffix.len();
    if suffix.is_some() && _suffix_len > 0 && _suffix_len <= len {
        if _suffix == path {
            return &[];
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut ext_idx: Option<usize> = Some(_suffix_len - 1);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        let mut first_non_slash_end: Option<usize> = None;
        let mut i_i64 = i64::try_from(len - 1).expect("int cast");
        while i_i64 >= i64::try_from(start).expect("int cast") {
            let i = usize::try_from(i_i64).expect("int cast");
            let byte = path[i];
            if is_sep_t(byte) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if !matched_slash {
                    start = i + 1;
                    break;
                }
            } else {
                if first_non_slash_end.is_none() {
                    // We saw the first non-path separator, remember this index in case
                    // we need it if the extension ends up not matching
                    matched_slash = false;
                    first_non_slash_end = Some(i + 1);
                }
                if let Some(_ext_ix) = ext_idx {
                    // Try to match the explicit extension
                    if byte == _suffix[_ext_ix] {
                        if _ext_ix == 0 {
                            // We matched the extension, so mark this as the end of our path
                            // component
                            end = Some(i);
                            ext_idx = None;
                        } else {
                            ext_idx = Some(_ext_ix - 1);
                        }
                    } else {
                        // Extension does not match, so our result is the entire path
                        // component
                        ext_idx = None;
                        end = first_non_slash_end;
                    }
                }
            }
            i_i64 -= 1;
        }

        if let Some(_end) = end {
            if start == _end {
                return &path[start..first_non_slash_end.unwrap()];
            } else {
                return &path[start.._end];
            }
        }
        return &path[start..len];
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if is_sep_t(byte) {
            if !matched_slash {
                start = i + 1;
                break;
            }
        } else if end.is_none() {
            matched_slash = false;
            end = Some(i + 1);
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        &path[start.._end]
    } else {
        &[]
    }
}

pub fn basename_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, basename_posix_t(path, suffix))
}

pub fn basename_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, basename_windows_t(path, suffix))
}

pub fn basename_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
    suffix: Option<&[T]>,
) -> JsResult<JSValue> {
    if is_windows {
        basename_windows_js_t(global_object, path, suffix)
    } else {
        basename_posix_js_t(global_object, path, suffix)
    }
}

pub fn basename(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let suffix_ptr: Option<JSValue> = if args_len > 1 && !args[1].is_undefined() {
        Some(args[1])
    } else {
        None
    };

    if let Some(_suffix_ptr) = suffix_ptr {
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validate_string(global_object, _suffix_ptr, format_args!("ext"))?;
    }

    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_zstr = path_ptr.get_zig_string(global_object)?;
    if path_zstr.len == 0 {
        return Ok(path_ptr);
    }

    // PERF(port): was stack-fallback — profile in Phase B
    let path_zslice = path_zstr.to_slice();

    let mut suffix_zslice: Option<bun_core::ZigStringSlice> = None;
    if let Some(_suffix_ptr) = suffix_ptr {
        let suffix_zstr = _suffix_ptr.get_zig_string(global_object)?;
        if suffix_zstr.len > 0 && suffix_zstr.len <= path_zstr.len {
            suffix_zslice = Some(suffix_zstr.to_slice());
        }
    }
    basename_js_t::<u8>(
        global_object,
        is_windows,
        path_zslice.slice(),
        suffix_zslice.as_ref().map(|s| s.slice()),
    )
}

/// Based on Node v21.6.1 path.posix.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
pub fn dirname_posix_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn dirname.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let has_root = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    let mut i: usize = len - 1;
    while i >= 1 {
        if path[i] == T::from_u8(CHAR_FORWARD_SLASH) {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            // We saw the first non-path separator
            matched_slash = false;
        }
        i -= 1;
    }

    if let Some(_end) = end {
        return if has_root && _end == 1 {
            l::<T>(b"//")
        } else {
            &path[0.._end]
        };
    }
    if has_root {
        l::<T>(CHAR_STR_FORWARD_SLASH)
    } else {
        l::<T>(CHAR_STR_DOT)
    }
}

/// Based on Node v21.6.1 path.win32.dirname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L657
pub fn dirname_windows_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn dirname.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut root_end: Option<usize> = None;
    let mut offset: usize = 0;
    let byte0 = path[0];

    if len == 1 {
        // `path` contains just a path separator, exit early to avoid
        // unnecessary work or a dot.
        return if is_sep_t(byte0) {
            path
        } else {
            l::<T>(CHAR_STR_DOT)
        };
    }

    // Try to match a root
    if is_sep_t(byte0) {
        // Possible UNC root

        root_end = Some(1);
        offset = 1;

        if is_sep_t(path[1]) {
            // Matched double path separator at the beginning
            let mut j: usize = 2;
            let mut last: usize = j;

            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }

            if j < len && j != last {
                // Matched!
                last = j;

                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }

                if j < len && j != last {
                    // Matched!
                    last = j;

                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
                        j += 1;
                    }

                    if j == len {
                        // We matched a UNC root only
                        return path;
                    }

                    if j != last {
                        // We matched a UNC root with leftovers

                        // Offset by 1 to include the separator after the UNC root to
                        // treat it as a "normal root" on top of a (UNC) root
                        offset = j + 1;
                        root_end = Some(offset);
                    }
                }
            }
        }
        // Possible device root
    } else if is_windows_device_root_t(byte0) && path[1] == T::from_u8(CHAR_COLON) {
        offset = if len > 2 && is_sep_t(path[2]) { 3 } else { 2 };
        root_end = Some(offset);
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(offset).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        if is_sep_t(path[i]) {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            // We saw the first non-path separator
            matched_slash = false;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        return &path[0.._end];
    }

    if let Some(_root_end) = root_end {
        &path[0.._root_end]
    } else {
        l::<T>(CHAR_STR_DOT)
    }
}

pub fn dirname_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, dirname_posix_t(path))
}

pub fn dirname_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, dirname_windows_t(path))
}

pub fn dirname_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        dirname_windows_js_t(global_object, path)
    } else {
        dirname_posix_js_t(global_object, path)
    }
}

pub fn dirname(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_zstr = path_ptr.get_zig_string(global_object)?;
    if path_zstr.len == 0 {
        return BunString::create_utf8_for_js(global_object, CHAR_STR_DOT);
    }

    // PERF(port): was stack-fallback — profile in Phase B
    let path_zslice = path_zstr.to_slice();
    dirname_js_t::<u8>(global_object, is_windows, path_zslice.slice())
}

/// Based on Node v21.6.1 path.posix.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1388
pub fn extname_posix_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn extname.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 > -1 {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }

        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }

        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if pre_dot_state.is_some() && pre_dot_state.unwrap() != 1 {
                pre_dot_state = Some(1);
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    let _end = end.unwrap_or(0);
    let _pre_dot_state = pre_dot_state.unwrap_or(0);
    let _start_dot = start_dot.unwrap_or(0);
    if start_dot.is_none()
        || end.is_none()
        // We saw a non-dot character immediately before the dot
        || (pre_dot_state.is_some() && _pre_dot_state == 0)
        // The (right-most) trimmed path component is exactly '..'
        || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
    {
        return &[];
    }

    &path[_start_dot.._end]
}

/// Based on Node v21.6.1 path.win32.extname:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L840
pub fn extname_windows_t<T: PathCharCwd>(path: &[T]) -> &[T] {
    // validateString of `path` is performed in pub fn extname.
    let len = path.len();
    // Exit early for easier number type use.
    if len == 0 {
        return &[];
    }
    let mut start: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash: bool = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded

    if len >= 2 && path[1] == T::from_u8(CHAR_COLON) && is_windows_device_root_t(path[0]) {
        start = 2;
        start_part = start;
    }

    let mut i_i64 = i64::try_from(len - 1).expect("int cast");
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if is_sep_windows_t(byte) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    let _end = end.unwrap_or(0);
    let _pre_dot_state = pre_dot_state.unwrap_or(0);
    let _start_dot = start_dot.unwrap_or(0);
    if start_dot.is_none()
        || end.is_none()
        // We saw a non-dot character immediately before the dot
        || (pre_dot_state.is_some() && _pre_dot_state == 0)
        // The (right-most) trimmed path component is exactly '..'
        || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
    {
        return &[];
    }

    &path[_start_dot.._end]
}

pub use bun_paths::is_sep_posix_t;
// Node `path.win32.isPathSeparator` accepts BOTH `/` and `\` — semantically
// `is_sep_any_t`, NOT `is_sep_win32_t` (which is `\`-only). Keep the Node name.
pub use bun_paths::is_sep_any_t as is_sep_windows_t;

/// `'A' <= byte <= 'Z' || 'a' <= byte <= 'z'`
#[inline]
pub fn is_windows_device_root_t<T: PathCharCwd>(byte: T) -> bool {
    let c = byte.as_u32();
    (b'A' as u32 <= c && c <= b'Z' as u32) || (b'a' as u32 <= c && c <= b'z' as u32)
}

/// Based on Node v21.6.1 path.posix.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1159
#[inline]
pub fn is_absolute_posix_t<T: PathCharCwd>(path: &[T]) -> bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    !path.is_empty() && path[0] == T::from_u8(CHAR_FORWARD_SLASH)
}

/// Based on Node v21.6.1 path.win32.isAbsolute:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L406
#[inline]
pub fn is_absolute_windows_t<T: PathCharCwd>(path: &[T]) -> bool {
    // validateString of `path` is performed in pub fn isAbsolute.
    let len = path.len();
    if len == 0 {
        return false;
    }
    let byte0 = path[0];
    is_sep_windows_t(byte0)
        || (len > 2
            && is_windows_device_root_t(byte0)
            && path[1] == T::from_u8(CHAR_COLON)
            && is_sep_windows_t(path[2]))
}

pub fn extname_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, extname_posix_t(path))
}

pub fn extname_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, extname_windows_t(path))
}

pub fn extname_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        extname_windows_js_t(global_object, path)
    } else {
        extname_posix_js_t(global_object, path)
    }
}

pub fn extname(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_zstr = path_ptr.get_zig_string(global_object)?;
    if path_zstr.len == 0 {
        return Ok(path_ptr);
    }

    // PERF(port): was stack-fallback — profile in Phase B
    let path_zslice = path_zstr.to_slice();
    extname_js_t::<u8>(global_object, is_windows, path_zslice.slice())
}

/// Based on Node v21.6.1 private helper _format:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L145
fn _format_t<'a, T: PathCharCwd>(
    path_object: &PathParsed<'a, T>,
    sep: T,
    buf: &'a mut [T],
) -> &'a [T] {
    // validateObject of `pathObject` is performed in pub fn format.
    let root = path_object.root;
    let dir = path_object.dir;
    let base = path_object.base;
    let ext = path_object.ext;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _name = path_object.name;

    // Translated from the following JS code:
    //   const dir = pathObject.dir || pathObject.root;
    // PORT NOTE: Zig used `std.mem.eql(u8, dir, root)` (hard-coded u8) which is a latent bug
    // for `T == u16`; compare as `&[T]` here.
    let dir_is_root = dir.is_empty() || dir == root;
    let dir_or_root = if dir_is_root { root } else { dir };
    let dir_len = dir_or_root.len();

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;

    // Translated from the following JS code:
    //   const base = pathObject.base ||
    //     `${pathObject.name || ''}${formatExt(pathObject.ext)}`;
    let mut base_len = base.len();
    // PORT NOTE: reshaped for borrowck — track range into buf instead of slice.
    let base_or_name_ext_range: (usize, usize);
    if base_len > 0 {
        memmove(&mut buf[0..base_len], base);
        base_or_name_ext_range = (0, base_len);
    } else {
        let formatted_ext_len = {
            // PORT NOTE: reshaped for borrowck — inline format_ext_t to avoid overlapping &mut.
            let ext_len = ext.len();
            if ext_len == 0 {
                0
            } else if ext[0] == T::from_u8(CHAR_DOT) {
                memmove(&mut buf[0..ext_len], ext);
                ext_len
            } else {
                buf[0] = T::from_u8(CHAR_DOT);
                memmove(&mut buf[1..ext_len + 1], ext);
                ext_len + 1
            }
        };
        let name_len = _name.len();
        let ext_len = formatted_ext_len;
        buf_offset = name_len;
        buf_size = buf_offset + ext_len;
        if ext_len > 0 {
            // Move all bytes to the right by _name.len.
            // Use copy_within because formattedExt and buf overlap.
            buf.copy_within(0..ext_len, buf_offset);
        }
        if name_len > 0 {
            memmove(&mut buf[0..name_len], _name);
        }
        base_or_name_ext_range = if buf_size > 0 {
            (0, buf_size)
        } else {
            (0, base_len)
        };
    }

    // Translated from the following JS code:
    //   if (!dir) {
    //     return base;
    //   }
    if dir_len == 0 {
        return &buf[base_or_name_ext_range.0..base_or_name_ext_range.1];
    }

    // Translated from the following JS code:
    //   return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
    base_len = base_or_name_ext_range.1 - base_or_name_ext_range.0;
    if base_len > 0 {
        buf_offset = if dir_is_root { dir_len } else { dir_len + 1 };
        buf_size = buf_offset + base_len;
        // Move all bytes to the right by dirLen + (maybe 1 for the separator).
        // Use copy_within because baseOrNameExt and buf overlap.
        buf.copy_within(
            base_or_name_ext_range.0..base_or_name_ext_range.1,
            buf_offset,
        );
    }
    memmove(&mut buf[0..dir_len], dir_or_root);
    buf_size = dir_len + base_len;
    if !dir_is_root {
        buf_size += 1;
        buf[dir_len] = sep;
    }
    &buf[0..buf_size]
}

pub fn format_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path_object: &PathParsed<'_, T>,
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(
        global_object,
        _format_t(path_object, T::from_u8(CHAR_FORWARD_SLASH), buf),
    )
}

pub fn format_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path_object: &PathParsed<'_, T>,
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(
        global_object,
        _format_t(path_object, T::from_u8(CHAR_BACKWARD_SLASH), buf),
    )
}

pub fn format_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path_object: &PathParsed<'_, T>,
) -> JsResult<JSValue> {
    let base_len = path_object.base.len();
    let dir_len = path_object.dir.len();
    // Add one for the possible separator.
    let buf_len: usize =
        (1 + (if dir_len > 0 {
            dir_len
        } else {
            path_object.root.len()
        }) + (if base_len > 0 {
            base_len
        } else {
            path_object.name.len() + path_object.ext.len()
        }))
        .max(path_size::<T>());
    let mut scratch = PathScratch::<T>::new(pool, buf_len);
    let buf = scratch.slice();
    if is_windows {
        format_windows_js_t(global_object, path_object, buf)
    } else {
        format_posix_js_t(global_object, path_object, buf)
    }
}

pub fn format(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_object_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_object(
        global_object,
        path_object_ptr,
        format_args!("pathObject"),
        Default::default(),
    )?;

    // PERF(port): was stack-fallback — profile in Phase B

    let mut root: &[u8] = b"";
    let root_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "root")? {
        Some(js_value.to_slice(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = root_slice {
        root = slice.slice();
    }

    let mut dir: &[u8] = b"";
    let dir_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "dir")? {
        Some(js_value.to_slice(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = dir_slice {
        dir = slice.slice();
    }

    let mut base: &[u8] = b"";
    let base_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "base")? {
        Some(js_value.to_slice(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = base_slice {
        base = slice.slice();
    }

    let mut _name: &[u8] = b"";
    let _name_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "name")? {
        Some(js_value.to_slice(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = _name_slice {
        _name = slice.slice();
    }

    let mut ext: &[u8] = b"";
    let ext_slice = if let Some(js_value) = path_object_ptr.get_truthy(global_object, "ext")? {
        Some(js_value.to_slice(global_object)?)
    } else {
        None
    };
    if let Some(ref slice) = ext_slice {
        ext = slice.slice();
    }

    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    format_js_t::<u8>(
        global_object,
        pool,
        is_windows,
        &PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        },
    )
}

pub fn is_absolute_posix_zig_string(path_zstr: &ZigString) -> bool {
    let path_zstr_trunc = path_zstr.trunc(1);
    if path_zstr_trunc.len > 0 && path_zstr_trunc.is_16bit() {
        is_absolute_posix_t::<u16>(path_zstr_trunc.utf16_slice_aligned())
    } else {
        is_absolute_posix_t::<u8>(path_zstr_trunc.slice())
    }
}

pub fn is_absolute_windows_zig_string(path_zstr: &ZigString) -> bool {
    if path_zstr.len > 0 && path_zstr.is_16bit() {
        is_absolute_windows_t::<u16>(path_zstr.utf16_slice_aligned())
    } else {
        is_absolute_windows_t::<u8>(path_zstr.slice())
    }
}

pub fn is_absolute(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_zstr = path_ptr.get_zig_string(global_object)?;
    if path_zstr.len == 0 {
        return Ok(JSValue::FALSE);
    }
    if is_windows {
        return Ok(JSValue::from(is_absolute_windows_zig_string(&path_zstr)));
    }
    Ok(JSValue::from(is_absolute_posix_zig_string(&path_zstr)))
}

/// Based on Node v21.6.1 path.posix.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1169
pub fn join_posix_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &'a mut [T],
) -> &'a [T] {
    if paths.is_empty() {
        return l::<T>(CHAR_STR_DOT);
    }

    let mut buf_size: usize = 0;
    let mut buf_offset: usize = 0;

    // Back joined by expandable buf2 in case it is long.
    // PORT NOTE: reshaped for borrowck — track length instead of slice into buf2.
    let mut joined_len: usize = 0;

    for path in paths {
        // validateString of `path is performed in pub fn join.
        // Back our virtual "joined" string by expandable buf2 in
        // case it is long.
        let len = path.len();
        if len > 0 {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = arg;
            //   else
            //     joined += `/${arg}`;
            if buf_size != 0 {
                buf_offset = buf_size;
                buf_size += 1;
                buf2[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
            }
            buf_offset = buf_size;
            buf_size += len;
            memmove(&mut buf2[buf_offset..buf_size], path);

            joined_len = buf_size;
        }
    }
    if buf_size == 0 {
        return l::<T>(CHAR_STR_DOT);
    }
    normalize_posix_t(&buf2[0..joined_len], buf)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Node__Path_joinWTF(
    lhs: *mut bun_core::String,
    rhs_ptr: *const u8,
    rhs_len: usize,
    result: *mut bun_core::String,
) {
    // SAFETY: caller passes valid pointers from C++.
    let rhs = unsafe { bun_core::ffi::slice(rhs_ptr, rhs_len) };
    let mut buf = [0u8; path_size::<u8>()];
    let mut buf2 = [0u8; path_size::<u8>()];
    // SAFETY: lhs is a valid BunString pointer.
    let slice = unsafe { &*lhs }.to_utf8();
    #[cfg(windows)]
    {
        let win = join_windows_t::<u8>(&[slice.slice(), rhs], &mut buf, &mut buf2);
        // SAFETY: result is a valid out-pointer.
        unsafe { *result = bun_core::String::clone_utf8(win) };
    }
    #[cfg(not(windows))]
    {
        let posix = join_posix_t::<u8>(&[slice.slice(), rhs], &mut buf, &mut buf2);
        // SAFETY: result is a valid out-pointer.
        unsafe { *result = bun_core::String::clone_utf8(posix) };
    }
}

/// Based on Node v21.6.1 path.win32.join:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L425
pub fn join_windows_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &'a mut [T],
) -> &'a [T] {
    if paths.is_empty() {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut buf_size: usize = 0;
    let mut buf_offset: usize = 0;

    // Backed by expandable buf2 in case it is long.
    // PORT NOTE: reshaped for borrowck — track ranges instead of slices into buf2.
    let mut joined_len: usize = 0;
    let mut first_part_len: usize = 0;

    for path in paths {
        // validateString of `path` is performed in pub fn join.
        let len = path.len();
        if len > 0 {
            // Translated from the following JS code:
            //   if (joined === undefined)
            //     joined = firstPart = arg;
            //   else
            //     joined += `\\${arg}`;
            buf_offset = buf_size;
            if buf_size == 0 {
                buf_size = len;
                memmove(&mut buf2[0..buf_size], path);

                joined_len = buf_size;
                first_part_len = joined_len;
            } else {
                buf_offset = buf_size;
                buf_size += 1;
                buf2[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf_offset = buf_size;
                buf_size += len;
                memmove(&mut buf2[buf_offset..buf_size], path);

                joined_len = buf_size;
            }
        }
    }
    if buf_size == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

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
    let mut needs_replace: bool = true;
    let mut slash_count: usize = 0;
    if is_sep_t(buf2[0]) {
        slash_count += 1;
        let first_len = first_part_len;
        if first_len > 1 && is_sep_t(buf2[1]) {
            slash_count += 1;
            if first_len > 2 {
                if is_sep_t(buf2[2]) {
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
        while slash_count < buf_size && is_sep_t(buf2[slash_count]) {
            slash_count += 1;
        }
        // Replace the slashes if needed
        if slash_count >= 2 {
            // Translated from the following JS code:
            //   joined = `\\${StringPrototypeSlice(joined, slashCount)}`;
            buf_offset = 1;
            buf_size = buf_offset + (buf_size - slash_count);
            // Move all bytes to the right by slashCount - 1.
            // Use copy_within because joined and buf2 overlap.
            buf2.copy_within(slash_count..joined_len, buf_offset);
            // Prepend the separator.
            buf2[0] = T::from_u8(CHAR_BACKWARD_SLASH);

            joined_len = buf_size;
        }
    }
    normalize_windows_t(&buf2[0..joined_len], buf)
}

pub fn join_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, join_posix_t(paths, buf, buf2))
}

pub fn join_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, join_windows_t(paths, buf, buf2))
}

pub fn join_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    paths: &[&[T]],
) -> JsResult<JSValue> {
    // Adding 8 bytes when Windows for the possible UNC root.
    let mut buf_len: usize = if is_windows { 8 } else { 0 };
    for path in paths {
        buf_len += if !path.is_empty() {
            path.len() + 1
        } else {
            path.len()
        };
    }
    buf_len = buf_len.max(path_size::<T>());
    let mut scratch = PathScratch::<T>::new(pool, buf_len * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len);
    if is_windows {
        join_windows_js_t(global_object, paths, buf, buf2)
    } else {
        join_posix_js_t(global_object, paths, buf, buf2)
    }
}

pub fn join(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    if args_len == 0 {
        return BunString::create_utf8_for_js(global_object, CHAR_STR_DOT);
    }

    // Zig leaks each per-arg `toSlice()` into the arena and bulk-frees at the end;
    // here the `ZigStringSlice` RAII guards live inline in `owned` for the same
    // effect. ASCII-only inputs (the common case) borrow the WTF backing without
    // allocating; only non-ASCII triggers a transcode allocation.
    let mut owned: SmallVec<[ZigStringSlice; 8]> = SmallVec::with_capacity(args_len);

    for (i, &path_ptr) in args.iter().enumerate() {
        // Inline the `is_string` fast path; only build `format_args!("paths[{i}]")`
        // on the cold error branch (it materialises a 48-byte `fmt::Arguments`
        // every iteration otherwise).
        if !path_ptr.is_string() {
            #[cold]
            #[inline(never)]
            fn not_a_string(g: &JSGlobalObject, v: JSValue, i: usize) -> crate::jsc::JsError {
                validate_string(g, v, format_args!("paths[{}]", i)).unwrap_err()
            }
            return Err(not_a_string(global_object, path_ptr, i));
        }
        let path_zstr = path_ptr.get_zig_string(global_object)?;
        if path_zstr.len == 0 {
            continue;
        }
        owned.push(path_zstr.to_slice());
    }
    // Derive the `&[u8]` views in a second pass once `owned` is fully built —
    // borrowck then sees `paths` as a plain reborrow of `owned` with no
    // intervening mutation, so no raw-pointer detach is needed. Empty entries
    // are skipped both here and inside `join_*_t`, matching Zig.
    let paths: SmallVec<[&[u8]; 8]> = owned.iter().map(ZigStringSlice::slice).collect();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    join_js_t::<u8>(global_object, pool, is_windows, &paths)
}

/// Based on Node v21.6.1 private helper normalizeString:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L65C1-L66C77
///
/// Resolves . and .. elements in a path with directory names
fn normalize_string_t<T: PathCharCwd, const PLATFORM: Platform>(
    path: &[T],
    allow_above_root: bool,
    separator: T,
    buf: &mut [T],
) -> usize {
    // PORT NOTE: returns length into buf (NUL-terminated at buf[len]) instead of `[:0]T` slice,
    // reshaped for borrowck so callers can re-borrow buf.
    let len = path.len();
    let is_sep_t: fn(T) -> bool = if matches!(PLATFORM, Platform::Posix) {
        is_sep_posix_t::<T>
    } else {
        is_sep_windows_t::<T>
    };

    let mut buf_offset: usize;
    let mut buf_size: usize = 0;

    let mut last_segment_length: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_slash: Option<usize> = None;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut dots: Option<usize> = Some(0);
    let mut byte: T = T::default();

    for i in 0..=len {
        if i < len {
            byte = path[i];
        } else if is_sep_t(byte) {
            break;
        } else {
            byte = T::from_u8(CHAR_FORWARD_SLASH);
        }

        if is_sep_t(byte) {
            // Translated from the following JS code:
            //   if (lastSlash === i - 1 || dots === 1) {
            if last_slash == i.checked_sub(1) || dots == Some(1) {
                // NOOP
            } else if dots == Some(2) {
                if buf_size < 2
                    || last_segment_length != 2
                    || buf[buf_size - 1] != T::from_u8(CHAR_DOT)
                    || buf[buf_size - 2] != T::from_u8(CHAR_DOT)
                {
                    if buf_size > 2 {
                        match buf[0..buf_size].iter().rposition(|&b| b == separator) {
                            None => {
                                buf_size = 0;
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                buf_size = idx;
                                // Translated from the following JS code:
                                //   lastSegmentLength =
                                //     res.length - 1 - StringPrototypeLastIndexOf(res, separator);
                                last_segment_length =
                                    match buf[0..buf_size].iter().rposition(|&b| b == separator) {
                                        // Yes (>ლ), Node relies on the -1 result of
                                        // StringPrototypeLastIndexOf(res, separator).
                                        // A - -1 is a positive 1.
                                        // So the code becomes
                                        //   lastSegmentLength = res.length - 1 + 1;
                                        // or
                                        //   lastSegmentLength = res.length;
                                        None => buf_size,
                                        Some(sep) => buf_size - 1 - sep,
                                    };
                            }
                        }
                        last_slash = Some(i);
                        dots = Some(0);
                        continue;
                    } else if buf_size != 0 {
                        buf_size = 0;
                        last_segment_length = 0;
                        last_slash = Some(i);
                        dots = Some(0);
                        continue;
                    }
                }
                if allow_above_root {
                    // Translated from the following JS code:
                    //   res += res.length > 0 ? `${separator}..` : '..';
                    if buf_size > 0 {
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = separator;
                        buf_offset = buf_size;
                        buf_size += 2;
                        buf[buf_offset] = T::from_u8(CHAR_DOT);
                        buf[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    } else {
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_DOT);
                        buf[1] = T::from_u8(CHAR_DOT);
                    }

                    last_segment_length = 2;
                }
            } else {
                // Translated from the following JS code:
                //   if (res.length > 0)
                //     res += `${separator}${StringPrototypeSlice(path, lastSlash + 1, i)}`;
                //   else
                //     res = StringPrototypeSlice(path, lastSlash + 1, i);
                if buf_size > 0 {
                    buf_offset = buf_size;
                    buf_size += 1;
                    buf[buf_offset] = separator;
                }
                let slice_start = last_slash.map_or(0, |ls| ls + 1);
                let slice = &path[slice_start..i];

                buf_offset = buf_size;
                buf_size += slice.len();
                memmove(&mut buf[buf_offset..buf_size], slice);

                // Translated from the following JS code:
                //   lastSegmentLength = i - lastSlash - 1;
                let subtract = last_slash.map_or(2, |ls| ls + 1);
                last_segment_length = i.saturating_sub(subtract);
            }
            last_slash = Some(i);
            dots = Some(0);
        } else if byte == T::from_u8(CHAR_DOT) && dots.is_some() {
            dots = dots.map(|d| d + 1);
        } else {
            dots = None;
        }
    }

    buf[buf_size] = T::default();
    buf_size
}

/// Based on Node v21.6.1 path.posix.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1130
pub fn normalize_posix_t<'a, T: PathCharCwd>(path: &[T], buf: &'a mut [T]) -> &'a [T] {
    // validateString of `path` is performed in pub fn normalize.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _is_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    let trailing_separator = path[len - 1] == T::from_u8(CHAR_FORWARD_SLASH);

    // Normalize the path
    let mut buf_size = normalize_string_t::<T, { Platform::Posix }>(
        path,
        !_is_absolute,
        T::from_u8(CHAR_FORWARD_SLASH),
        buf,
    );

    if buf_size == 0 {
        if _is_absolute {
            return l::<T>(CHAR_STR_FORWARD_SLASH);
        }
        return if trailing_separator {
            l::<T>(b"./")
        } else {
            l::<T>(CHAR_STR_DOT)
        };
    }

    let mut buf_offset: usize;

    // Translated from the following JS code:
    //   if (trailingSeparator)
    //     path += '/';
    if trailing_separator {
        buf_offset = buf_size;
        buf_size += 1;
        buf[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
    }

    // Translated from the following JS code:
    //   return isAbsolute ? `/${path}` : path;
    if _is_absolute {
        buf_offset = 1;
        let old_size = buf_size;
        buf_size += 1;
        // Move all bytes to the right by 1 for the separator.
        // Use copy_within because normalizedPath and buf overlap.
        buf.copy_within(0..old_size, buf_offset);
        // Prepend the separator.
        buf[0] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
    }
    &buf[0..buf_size]
}

/// Based on Node v21.6.1 path.win32.normalize
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L308
pub fn normalize_windows_t<'a, T: PathCharCwd>(path: &[T], buf: &'a mut [T]) -> &'a [T] {
    // validateString of `path` is performed in pub fn normalize.
    let len = path.len();
    if len == 0 {
        return l::<T>(CHAR_STR_DOT);
    }

    let is_sep_t = is_sep_windows_t::<T>;

    // Moved `rootEnd`, `device`, and `_isAbsolute` initialization after
    // the `if (len == 1)` check.
    let byte0: T = path[0];

    // Try to match a root
    if len == 1 {
        // `path` contains just a single char, exit early to avoid
        // unnecessary work
        return if is_sep_t(byte0) {
            l::<T>(CHAR_STR_BACKWARD_SLASH)
        } else {
            // PORT NOTE: reshaped for borrowck — copy single char into buf since path may not outlive buf.
            buf[0] = byte0;
            &buf[0..1]
        };
    }

    let mut root_end: usize = 0;
    // Backed by buf.
    // PORT NOTE: reshaped for borrowck — track device length instead of slice into buf.
    let mut device_len: Option<usize> = None;
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _is_absolute: bool = false;

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;

    if is_sep_t(byte0) {
        // Possible UNC root

        // If we started with a separator, we know we at least have an absolute
        // path of some kind (UNC or otherwise)
        _is_absolute = true;

        if is_sep_t(path[1]) {
            // Matched double path separator at beginning
            let mut j: usize = 2;
            let mut last: usize = j;
            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }
            if j < len && j != last {
                let first_part = &path[last..j];
                // Matched!
                last = j;
                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
                        j += 1;
                    }
                    if j == len {
                        // We matched a UNC root only
                        // Return the normalized version of the UNC root since there
                        // is nothing left to process

                        // Translated from the following JS code:
                        //   return `\\\\${firstPart}\\${StringPrototypeSlice(path, last)}\\`;
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += first_part.len();
                        memmove(&mut buf[buf_offset..buf_size], first_part);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += len - last;
                        memmove(&mut buf[buf_offset..buf_size], &path[last..len]);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        return &buf[0..buf_size];
                    }
                    if j != last {
                        // We matched a UNC root with leftovers

                        // Translated from the following JS code:
                        //   device =
                        //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                        //   rootEnd = j;
                        buf_size = 2;
                        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += first_part.len();
                        memmove(&mut buf[buf_offset..buf_size], first_part);
                        buf_offset = buf_size;
                        buf_size += 1;
                        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                        buf_offset = buf_size;
                        buf_size += j - last;
                        memmove(&mut buf[buf_offset..buf_size], &path[last..j]);

                        device_len = Some(buf_size);
                        root_end = j;
                    }
                }
            }
        } else {
            root_end = 1;
        }
    } else if is_windows_device_root_t(byte0) && path[1] == T::from_u8(CHAR_COLON) {
        // Possible device root
        buf[0] = byte0;
        buf[1] = T::from_u8(CHAR_COLON);
        device_len = Some(2);
        root_end = 2;
        if len > 2 && is_sep_t(path[2]) {
            // Treat separator following drive name as an absolute path
            // indicator
            _is_absolute = true;
            root_end = 3;
        }
    }

    buf_offset = device_len.unwrap_or(0) + (_is_absolute as usize);
    // Backed by buf at an offset of  device.len + 1 if _isAbsolute is true.
    let mut tail_len = if root_end < len {
        normalize_string_t::<T, { Platform::Windows }>(
            &path[root_end..len],
            !_is_absolute,
            T::from_u8(CHAR_BACKWARD_SLASH),
            &mut buf[buf_offset..],
        )
    } else {
        0
    };
    if tail_len == 0 && !_is_absolute {
        buf[buf_offset] = T::from_u8(CHAR_DOT);
        tail_len = 1;
    }

    if tail_len > 0 && is_sep_t(path[len - 1]) {
        // Translated from the following JS code:
        //   tail += '\\';
        buf[buf_offset + tail_len] = T::from_u8(CHAR_BACKWARD_SLASH);
        tail_len += 1;
    }

    buf_size = buf_offset + tail_len;
    // Translated from the following JS code:
    //   if (device === undefined) {
    //     return isAbsolute ? `\\${tail}` : tail;
    //   }
    //   return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
    if _is_absolute {
        buf_offset -= 1;
        // Prepend the separator.
        buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
    }
    &buf[0..buf_size]
}

pub fn normalize_t<'a, T: PathCharCwd>(path: &[T], buf: &'a mut [T]) -> &'a [T] {
    #[cfg(windows)]
    {
        normalize_windows_t(path, buf)
    }
    #[cfg(not(windows))]
    {
        normalize_posix_t(path, buf)
    }
}

pub fn normalize_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, normalize_posix_t(path, buf))
}

pub fn normalize_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
) -> JsResult<JSValue> {
    create_js_string_t::<T>(global_object, normalize_windows_t(path, buf))
}

pub fn normalize_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    let buf_len = path.len().max(path_size::<T>());
    // +1 for null terminator
    let mut scratch = PathScratch::<T>::new(pool, buf_len + 1);
    let buf = scratch.slice();
    if is_windows {
        normalize_windows_js_t(global_object, path, buf)
    } else {
        normalize_posix_js_t(global_object, path, buf)
    }
}

pub fn normalize(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    validate_string(global_object, path_ptr, format_args!("path"))?;
    let path_zstr = path_ptr.get_zig_string(global_object)?;
    let len = path_zstr.len;
    if len == 0 {
        return BunString::create_utf8_for_js(global_object, CHAR_STR_DOT);
    }

    let path_zslice = path_zstr.to_slice();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    normalize_js_t::<u8>(global_object, pool, is_windows, path_zslice.slice())
}

// Based on Node v21.6.1 path.posix.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1452
pub fn parse_posix_t<T: PathCharCwd>(path: &[T]) -> PathParsed<'_, T> {
    // validateString of `path` is performed in pub fn parse.
    let len = path.len();
    if len == 0 {
        return PathParsed::default();
    }

    let mut root: &[T] = &[];
    let mut dir: &[T] = &[];
    let mut base: &[T] = &[];
    let mut ext: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _name: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let _is_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);
    let mut start: usize = 0;
    if _is_absolute {
        root = l::<T>(CHAR_STR_FORWARD_SLASH);
        start = 1;
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part: usize = 0;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    let mut i_i64 = i64::try_from(len - 1).expect("int cast");

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Get non-dir info
    while i_i64 >= i64::try_from(start).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        let byte = path[i];
        if byte == T::from_u8(CHAR_FORWARD_SLASH) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        let _pre_dot_state = pre_dot_state.unwrap_or(0);
        let _start_dot = start_dot.unwrap_or(0);
        start = if start_part == 0 && _is_absolute {
            1
        } else {
            start_part
        };
        if start_dot.is_none()
            // We saw a non-dot character immediately before the dot
            || (pre_dot_state.is_some() && _pre_dot_state == 0)
            // The (right-most) trimmed path component is exactly '..'
            || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
        {
            _name = &path[start.._end];
            base = _name;
        } else {
            _name = &path[start.._start_dot];
            base = &path[start.._end];
            ext = &path[_start_dot.._end];
        }
    }

    if start_part > 0 {
        dir = &path[0..(start_part - 1)];
    } else if _is_absolute {
        dir = l::<T>(CHAR_STR_FORWARD_SLASH);
    }

    PathParsed {
        root,
        dir,
        base,
        ext,
        name: _name,
    }
}

// Based on Node v21.6.1 path.win32.parse
// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L916
pub fn parse_windows_t<T: PathCharCwd>(path: &[T]) -> PathParsed<'_, T> {
    // validateString of `path` is performed in pub fn parse.
    let mut root: &[T] = &[];
    let mut dir: &[T] = &[];
    let mut base: &[T] = &[];
    let mut ext: &[T] = &[];
    // Prefix with _ to avoid shadowing the identifier in the outer scope.
    let mut _name: &[T] = &[];

    let len = path.len();
    if len == 0 {
        return PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        };
    }

    let is_sep_t = is_sep_windows_t::<T>;

    let mut root_end: usize = 0;
    let mut byte = path[0];

    if len == 1 {
        if is_sep_t(byte) {
            // `path` contains just a path separator, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
        } else {
            base = path;
            _name = path;
        }
        return PathParsed {
            root,
            dir,
            base,
            ext,
            name: _name,
        };
    }

    // Try to match a root
    if is_sep_t(byte) {
        // Possible UNC root

        root_end = 1;
        if is_sep_t(path[1]) {
            // Matched double path separator at the beginning
            let mut j: usize = 2;
            let mut last: usize = j;
            // Match 1 or more non-path separators
            while j < len && !is_sep_t(path[j]) {
                j += 1;
            }
            if j < len && j != last {
                // Matched!
                last = j;
                // Match 1 or more path separators
                while j < len && is_sep_t(path[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while j < len && !is_sep_t(path[j]) {
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
    } else if is_windows_device_root_t(byte) && path[1] == T::from_u8(CHAR_COLON) {
        // Possible device root
        if len <= 2 {
            // `path` contains just a drive root, exit early to avoid
            // unnecessary work
            root = path;
            dir = path;
            return PathParsed {
                root,
                dir,
                base,
                ext,
                name: _name,
            };
        }
        root_end = 2;
        if is_sep_t(path[2]) {
            if len == 3 {
                // `path` contains just a drive root, exit early to avoid
                // unnecessary work
                root = path;
                dir = path;
                return PathParsed {
                    root,
                    dir,
                    base,
                    ext,
                    name: _name,
                };
            }
            root_end = 3;
        }
    }
    if root_end > 0 {
        root = &path[0..root_end];
    }

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut start_dot: Option<usize> = None;
    let mut start_part = root_end;
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    let mut i_i64 = i64::try_from(len - 1).expect("int cast");

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find

    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut pre_dot_state: Option<usize> = Some(0);

    // Get non-dir info
    while i_i64 >= i64::try_from(root_end).expect("int cast") {
        let i = usize::try_from(i_i64).expect("int cast");
        byte = path[i];
        if is_sep_t(byte) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if !matched_slash {
                start_part = i + 1;
                break;
            }
            i_i64 -= 1;
            continue;
        }
        if end.is_none() {
            // We saw the first non-path separator, mark this as the end of our
            // extension
            matched_slash = false;
            end = Some(i + 1);
        }
        if byte == T::from_u8(CHAR_DOT) {
            // If this is our first dot, mark it as the start of our extension
            if start_dot.is_none() {
                start_dot = Some(i);
            } else if let Some(_pre_dot_state) = pre_dot_state {
                if _pre_dot_state != 1 {
                    pre_dot_state = Some(1);
                }
            }
        } else if start_dot.is_some() {
            // We saw a non-dot and non-path separator before our dot, so we should
            // have a good chance at having a non-empty extension
            pre_dot_state = None;
        }
        i_i64 -= 1;
    }

    if let Some(_end) = end {
        let _pre_dot_state = pre_dot_state.unwrap_or(0);
        let _start_dot = start_dot.unwrap_or(0);
        if start_dot.is_none()
            // We saw a non-dot character immediately before the dot
            || (pre_dot_state.is_some() && _pre_dot_state == 0)
            // The (right-most) trimmed path component is exactly '..'
            || (_pre_dot_state == 1 && _start_dot == _end - 1 && _start_dot == start_part + 1)
        {
            // Prefix with _ to avoid shadowing the identifier in the outer scope.
            _name = &path[start_part.._end];
            base = _name;
        } else {
            _name = &path[start_part.._start_dot];
            base = &path[start_part.._end];
            ext = &path[_start_dot.._end];
        }
    }

    // If the directory is the root, use the entire root as the `dir` including
    // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
    // trailing slash (`C:\abc\def` -> `C:\abc`).
    if start_part > 0 && start_part != root_end {
        dir = &path[0..(start_part - 1)];
    } else {
        dir = root;
    }

    PathParsed {
        root,
        dir,
        base,
        ext,
        name: _name,
    }
}

pub fn parse_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    parse_posix_t(path).to_js_object(global_object)
}

pub fn parse_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
) -> JsResult<JSValue> {
    parse_windows_t(path).to_js_object(global_object)
}

pub fn parse_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if is_windows {
        parse_windows_js_t(global_object, path)
    } else {
        parse_posix_js_t(global_object, path)
    }
}

pub fn parse(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let path_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
    crate::node::validators_impl::validate_string(global_object, path_ptr, format_args!("path"))?;

    let path_zstr = path_ptr.get_zig_string(global_object)?;
    if path_zstr.len == 0 {
        return PathParsed::<u8>::default().to_js_object(global_object);
    }

    // PERF(port): was stack-fallback — profile in Phase B
    let path_zslice = path_zstr.to_slice();
    parse_js_t::<u8>(global_object, is_windows, path_zslice.slice())
}

/// Based on Node v21.6.1 path.posix.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1193
pub fn relative_posix_t<'a, T: PathCharCwd>(
    from: &[T],
    to: &[T],
    buf: &'a mut [T],
    buf2: &mut [T],
    buf3: &mut [T],
) -> MaybeSlice<'a, T> {
    // validateString of `from` and `to` are performed in pub fn relative.
    if from == to {
        return Ok(&[]);
    }

    // Trim leading forward slashes.
    // Backed by expandable buf2 because fromOrig may be long.
    let from_orig = match resolve_posix_t(&[from], buf2, buf3) {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    let from_orig_len = from_orig.len();
    // Backed by buf.
    // PORT NOTE: reshaped for borrowck — resolve into buf, then operate via raw indices.
    // resolve_*_t may return a 'static literal (".") instead of a sub-slice of
    // buf; copy it in so indexing `buf[..to_orig_len]` below observes the
    // resolved value (matches Zig, which captures the returned slice itself).
    let to_orig_len = {
        let (ptr, len) = match resolve_posix_t(&[to], buf, buf3) {
            Ok(r) => (r.as_ptr(), r.len()),
            Err(e) => return Err(e),
        };
        if ptr != buf.as_ptr() {
            // SAFETY: ptr is a 'static disjoint from buf, len <= buf.len().
            unsafe { core::ptr::copy_nonoverlapping(ptr, buf.as_mut_ptr(), len) };
        }
        len
    };
    let to_orig = &buf[0..to_orig_len];

    if from_orig == to_orig {
        return Ok(&[]);
    }

    let from_start = 1usize;
    let from_end = from_orig_len;
    let from_len = from_end - from_start;
    let mut to_start: usize = 1;
    let to_len = to_orig_len - to_start;

    // Compare paths to find the longest common path from root
    let smallest_length = from_len.min(to_len);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_common_sep: Option<usize> = None;

    let mut matches_all_of_smallest = false;
    // Add a block to isolate `i`.
    {
        let mut i: usize = 0;
        while i < smallest_length {
            let from_byte = from_orig[from_start + i];
            if from_byte != to_orig[to_start + i] {
                break;
            } else if from_byte == T::from_u8(CHAR_FORWARD_SLASH) {
                last_common_sep = Some(i);
            }
            i += 1;
        }
        matches_all_of_smallest = i == smallest_length;
    }
    if matches_all_of_smallest {
        if to_len > smallest_length {
            if to_orig[to_start + smallest_length] == T::from_u8(CHAR_FORWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='/foo/bar'; to='/foo/bar/baz'
                return Ok(&buf[to_start + smallest_length + 1..to_orig_len]);
            }
            if smallest_length == 0 {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                return Ok(&buf[to_start + smallest_length..to_orig_len]);
            }
        } else if from_len > smallest_length {
            if from_orig[from_start + smallest_length] == T::from_u8(CHAR_FORWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='/foo/bar/baz'; to='/foo/bar'
                last_common_sep = Some(smallest_length);
            } else if smallest_length == 0 {
                // We get here if `to` is the root.
                // For example: from='/foo/bar'; to='/'
                last_common_sep = Some(0);
            }
        }
    }

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;

    // Backed by buf3.
    let mut out_len: usize = 0;
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.

        // Translated from the following JS code:
        //  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        let mut i: usize = from_start + last_common_sep.map_or(0, |v| v + 1);
        while i <= from_end {
            if i == from_end || from_orig[i] == T::from_u8(CHAR_FORWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '/..';
                if out_len > 0 {
                    buf_offset = buf_size;
                    buf_size += 3;
                    buf3[buf_offset] = T::from_u8(CHAR_FORWARD_SLASH);
                    buf3[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    buf3[buf_offset + 2] = T::from_u8(CHAR_DOT);
                } else {
                    buf_size = 2;
                    buf3[0] = T::from_u8(CHAR_DOT);
                    buf3[1] = T::from_u8(CHAR_DOT);
                }
                out_len = buf_size;
            }
            i += 1;
        }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts.

    // Translated from the following JS code:
    //   return `${out}${StringPrototypeSlice(to, toStart + lastCommonSep)}`;
    to_start = last_common_sep.map_or(0, |v| to_start + v);
    let slice_size = to_orig_len - to_start;
    buf_size = out_len;
    if slice_size > 0 {
        buf_offset = buf_size;
        buf_size += slice_size;
        // Use copy_within because toOrig and buf overlap.
        buf.copy_within(to_start..to_start + slice_size, buf_offset);
    }
    if out_len > 0 {
        memmove(&mut buf[0..out_len], &buf3[0..out_len]);
    }
    buf[buf_size] = T::default();
    Ok(&buf[0..buf_size])
}

/// Based on Node v21.6.1 path.win32.relative:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L500
pub fn relative_windows_t<'a, T: PathCharCwd>(
    from: &[T],
    to: &[T],
    buf: &'a mut [T],
    buf2: &mut [T],
    buf3: &mut [T],
) -> MaybeSlice<'a, T> {
    // validateString of `from` and `to` are performed in pub fn relative.
    if from == to {
        return Ok(&[]);
    }

    // Backed by expandable buf2 because fromOrig may be long.
    let from_orig = match resolve_windows_t(&[from], buf2, buf3) {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    let from_orig_len = from_orig.len();
    // Backed by buf.
    // PORT NOTE: reshaped for borrowck — resolve into buf, then operate via raw indices.
    // resolve_*_t may return a 'static literal (".") instead of a sub-slice of
    // buf; copy it in so indexing `buf[..to_orig_len]` below observes the
    // resolved value (matches Zig, which captures the returned slice itself).
    let to_orig_len = {
        let (ptr, len) = match resolve_windows_t(&[to], buf, buf3) {
            Ok(r) => (r.as_ptr(), r.len()),
            Err(e) => return Err(e),
        };
        if ptr != buf.as_ptr() {
            // SAFETY: ptr is a 'static disjoint from buf, len <= buf.len().
            unsafe { core::ptr::copy_nonoverlapping(ptr, buf.as_mut_ptr(), len) };
        }
        len
    };

    if from_orig == &buf[0..to_orig_len] || eql_ignore_case_t(from_orig, &buf[0..to_orig_len]) {
        return Ok(&[]);
    }

    // Trim leading backslashes
    let mut from_start: usize = 0;
    while from_start < from_orig_len && from_orig[from_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        from_start += 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    let mut from_end = from_orig_len;
    while from_end - 1 > from_start && from_orig[from_end - 1] == T::from_u8(CHAR_BACKWARD_SLASH) {
        from_end -= 1;
    }

    let from_len = from_end - from_start;

    // Trim leading backslashes
    let mut to_start: usize = 0;
    while to_start < to_orig_len && buf[to_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_start += 1;
    }

    // Trim trailing backslashes (applicable to UNC paths only)
    let mut to_end = to_orig_len;
    while to_end - 1 > to_start && buf[to_end - 1] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_end -= 1;
    }

    let to_len = to_end - to_start;

    // Compare paths to find the longest common path from root
    let smallest_length = from_len.min(to_len);
    // We use an optional value instead of -1, as in Node code, for easier number type use.
    let mut last_common_sep: Option<usize> = None;

    let mut matches_all_of_smallest = false;
    // Add a block to isolate `i`.
    {
        let mut i: usize = 0;
        while i < smallest_length {
            let from_byte = from_orig[from_start + i];
            if to_lower_t(from_byte) != to_lower_t(buf[to_start + i]) {
                break;
            } else if from_byte == T::from_u8(CHAR_BACKWARD_SLASH) {
                last_common_sep = Some(i);
            }
            i += 1;
        }
        matches_all_of_smallest = i == smallest_length;
    }

    // We found a mismatch before the first common path separator was seen, so
    // return the original `to`.
    if !matches_all_of_smallest {
        if last_common_sep.is_none() {
            return Ok(&buf[0..to_orig_len]);
        }
    } else {
        if to_len > smallest_length {
            if buf[to_start + smallest_length] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='C:\foo\bar'; to='C:\foo\bar\baz'
                return Ok(&buf[to_start + smallest_length + 1..to_orig_len]);
            }
            if smallest_length == 2 {
                // We get here if `from` is the device root.
                // For example: from='C:\'; to='C:\foo'
                return Ok(&buf[to_start + smallest_length..to_orig_len]);
            }
        }
        if from_len > smallest_length {
            if from_orig[from_start + smallest_length] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='C:\foo\bar'; to='C:\foo'
                last_common_sep = Some(smallest_length);
            } else if smallest_length == 2 {
                // We get here if `to` is the device root.
                // For example: from='C:\foo\bar'; to='C:\'
                last_common_sep = Some(3);
            }
        }
        if last_common_sep.is_none() {
            last_common_sep = Some(0);
        }
    }

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;

    // Backed by buf3.
    let mut out_len: usize = 0;
    // Add a block to isolate `i`.
    {
        // Generate the relative path based on the path difference between `to`
        // and `from`.
        let mut i: usize = from_start + last_common_sep.map_or(0, |v| v + 1);
        while i <= from_end {
            if i == from_end || from_orig[i] == T::from_u8(CHAR_BACKWARD_SLASH) {
                // Translated from the following JS code:
                //   out += out.length === 0 ? '..' : '\\..';
                if out_len > 0 {
                    buf_offset = buf_size;
                    buf_size += 3;
                    buf3[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                    buf3[buf_offset + 1] = T::from_u8(CHAR_DOT);
                    buf3[buf_offset + 2] = T::from_u8(CHAR_DOT);
                } else {
                    buf_size = 2;
                    buf3[0] = T::from_u8(CHAR_DOT);
                    buf3[1] = T::from_u8(CHAR_DOT);
                }
                out_len = buf_size;
            }
            i += 1;
        }
    }

    // Translated from the following JS code:
    //   toStart += lastCommonSep;
    if last_common_sep.is_none() {
        // If toStart would go negative make it toOrigLen - 1 to
        // mimic String#slice with a negative start.
        to_start = if to_start > 0 {
            to_start - 1
        } else {
            to_orig_len - 1
        };
    } else {
        to_start += last_common_sep.unwrap();
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if out_len > 0 {
        let slice_size = to_end - to_start;
        buf_size = out_len;
        if slice_size > 0 {
            buf_offset = buf_size;
            buf_size += slice_size;
            // Use copy_within because toOrig and buf overlap.
            buf.copy_within(to_start..to_start + slice_size, buf_offset);
        }
        memmove(&mut buf[0..out_len], &buf3[0..out_len]);
        buf[buf_size] = T::default();
        return Ok(&buf[0..buf_size]);
    }

    if buf[to_start] == T::from_u8(CHAR_BACKWARD_SLASH) {
        to_start += 1;
    }
    Ok(&buf[to_start..to_end])
}

pub fn relative_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    from: &[T],
    to: &[T],
    buf: &mut [T],
    buf2: &mut [T],
    buf3: &mut [T],
) -> JsResult<JSValue> {
    match relative_posix_t(from, to, buf, buf2, buf3) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

pub fn relative_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    from: &[T],
    to: &[T],
    buf: &mut [T],
    buf2: &mut [T],
    buf3: &mut [T],
) -> JsResult<JSValue> {
    match relative_windows_t(from, to, buf, buf2, buf3) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

pub fn relative_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    from: &[T],
    to: &[T],
) -> JsResult<JSValue> {
    // Account for CWD (up to MAX_PATH_SIZE) that resolve may prepend, and for
    // worst-case ".." expansion: each 2-byte path component (e.g. "a/") generates
    // 3 bytes of output ("/..", ~1.5x). Use 2x as a safe upper bound.
    let buf_len =
        ((from.len() + max_path_size::<T>() + 1) * 2 + to.len() + max_path_size::<T>() + 1)
            .max(path_size::<T>());
    // +1 for null terminator; ×3 for buf/buf2/buf3 carved from one slab.
    let mut scratch = PathScratch::<T>::new(pool, (buf_len + 1) * 3);
    let (buf, rest) = scratch.slice().split_at_mut(buf_len + 1);
    let (buf2, buf3) = rest.split_at_mut(buf_len + 1);
    if is_windows {
        relative_windows_js_t(global_object, from, to, buf, buf2, buf3)
    } else {
        relative_posix_js_t(global_object, from, to, buf, buf2, buf3)
    }
}

pub fn relative(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    let from_ptr: JSValue = if args_len > 0 {
        args[0]
    } else {
        JSValue::UNDEFINED
    };
    crate::node::validators_impl::validate_string(global_object, from_ptr, format_args!("from"))?;
    let to_ptr: JSValue = if args_len > 1 {
        args[1]
    } else {
        JSValue::UNDEFINED
    };
    crate::node::validators_impl::validate_string(global_object, to_ptr, format_args!("to"))?;

    let from_zig_str = from_ptr.get_zig_string(global_object)?;
    let to_zig_str = to_ptr.get_zig_string(global_object)?;
    if (from_zig_str.len + to_zig_str.len) == 0 {
        return Ok(from_ptr);
    }

    let from_zig_slice = from_zig_str.to_slice();
    let to_zig_slice = to_zig_str.to_slice();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    relative_js_t::<u8>(
        global_object,
        pool,
        is_windows,
        from_zig_slice.slice(),
        to_zig_slice.slice(),
    )
}

/// Based on Node v21.6.1 path.posix.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1095
pub fn resolve_posix_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> MaybeSlice<'a, T> {
    // Backed by expandable buf2 because resolvedPath may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    let mut resolved_path_len: usize = 0;
    let mut resolved_absolute: bool = false;

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;

    let mut i_i64: i64 = if paths.is_empty() {
        -1
    } else {
        i64::try_from(paths.len() - 1).expect("int cast")
    };
    while i_i64 > -2 && !resolved_absolute {
        // PORT NOTE: reshaped for borrowck — `path` may borrow from tmp_buf which lives
        // in this scope; copy into buf2 before reusing.
        // Zig: `[MAX_PATH_SIZE(T):0]T` — sized to the larger of the two T variants.
        let mut tmp_buf: [T; MAX_PATH_SIZE_UPPER];
        let path: &[T] = if i_i64 >= 0 {
            paths[usize::try_from(i_i64).expect("int cast")]
        } else {
            // cwd is limited to MAX_PATH_BYTES.
            tmp_buf = [T::default(); MAX_PATH_SIZE_UPPER];
            match posix_cwd_t(&mut tmp_buf) {
                Ok(r) => &*r,
                Err(e) => return Err(e),
            }
        };
        // validateString of `path` is performed in pub fn resolve.
        let len = path.len();

        // Skip empty paths.
        if len == 0 {
            i_i64 -= 1;
            continue;
        }

        // Translated from the following JS code:
        //   resolvedPath = `${path}/${resolvedPath}`;
        if resolved_path_len > 0 {
            buf_offset = len + 1;
            buf_size = buf_offset + resolved_path_len;
            // Move all bytes to the right by path.len + 1 for the separator.
            // Use copy_within because resolvedPath and buf2 overlap.
            buf2.copy_within(0..resolved_path_len, buf_offset);
        }
        buf_size = len;
        memmove(&mut buf2[0..buf_size], path);
        buf_size += 1;
        buf2[len] = T::from_u8(CHAR_FORWARD_SLASH);
        buf_size += resolved_path_len;

        buf2[buf_size] = T::default();
        resolved_path_len = buf_size;
        resolved_absolute = path[0] == T::from_u8(CHAR_FORWARD_SLASH);

        i_i64 -= 1;
    }

    // Exit early for empty path.
    if resolved_path_len == 0 {
        return Ok(l::<T>(CHAR_STR_DOT));
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    let normalized_len = normalize_string_t::<T, { Platform::Posix }>(
        &buf2[0..resolved_path_len],
        !resolved_absolute,
        T::from_u8(CHAR_FORWARD_SLASH),
        buf,
    );
    // resolvedPath is now backed by buf.
    resolved_path_len = normalized_len;

    // Translated from the following JS code:
    //   if (resolvedAbsolute) {
    //     return `/${resolvedPath}`;
    //   }
    if resolved_absolute {
        buf_size = resolved_path_len + 1;
        // Use copy_within because resolvedPath and buf overlap.
        buf.copy_within(0..resolved_path_len, 1);
        buf[0] = T::from_u8(CHAR_FORWARD_SLASH);
        buf[buf_size] = T::default();
        return Ok(&buf[0..buf_size]);
    }
    // Translated from the following JS code:
    //   return resolvedPath.length > 0 ? resolvedPath : '.';
    Ok(if resolved_path_len > 0 {
        &buf[0..resolved_path_len]
    } else {
        l::<T>(CHAR_STR_DOT)
    })
}

/// Based on Node v21.6.1 path.win32.resolve:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L162
pub fn resolve_windows_t<'a, T: PathCharCwd>(
    paths: &[&[T]],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> MaybeSlice<'a, T> {
    let is_sep_t = is_sep_windows_t::<T>;
    // Zig: `[MAX_PATH_SIZE(T):0]T` — sized to the larger of the two T variants.
    let mut tmp_buf = [T::default(); MAX_PATH_SIZE_UPPER + 1];

    // Backed by tmpBuf.
    // PORT NOTE: reshaped for borrowck — track resolved_device length into tmp_buf.
    let mut resolved_device_len: usize = 0;
    // Backed by expandable buf2 because resolvedTail may be long.
    // We use buf2 here because resolvePosixT is called by other methods and using
    // buf2 here avoids stepping on others' toes.
    let mut resolved_tail_len: usize = 0;
    let mut resolved_absolute: bool = false;

    let mut buf_offset: usize = 0;
    let mut buf_size: usize = 0;
    let mut env_path_len: Option<usize> = None;

    let mut i_i64: i64 = if paths.is_empty() {
        -1
    } else {
        i64::try_from(paths.len() - 1).expect("int cast")
    };
    while i_i64 > -2 {
        // Backed by expandable buf2, to not conflict with buf2 backed resolvedTail,
        // because path may be long.
        // PORT NOTE: reshaped for borrowck — `path` may alias paths[], tmp_buf, or buf2,
        // and the loop body subsequently mutates tmp_buf/buf2 while still indexing
        // `path`. Store as raw (ptr, len) and materialize short-lived slices at use
        // sites; all overlapping moves go through `ptr::copy` (memmove semantics),
        // matching the Zig original.
        let mut path_ptr: *const T;
        let mut path_len: usize;
        macro_rules! path { () => {
            // SAFETY: (path_ptr, path_len) describes a live region inside paths[]/tmp_buf/buf2;
            // borrows are short-lived (read-only) and never held across mutation of the same range.
            unsafe { core::slice::from_raw_parts(path_ptr, path_len) }
        }; }
        // Locals that must outlive `path` borrow:
        let cwd_len: usize;
        if i_i64 >= 0 {
            let p = paths[usize::try_from(i_i64).expect("int cast")];
            // validateString of `path` is performed in pub fn resolve.

            // Skip empty paths.
            if p.is_empty() {
                i_i64 -= 1;
                continue;
            }
            path_ptr = p.as_ptr();
            path_len = p.len();
        } else if resolved_device_len == 0 {
            // cwd is limited to MAX_PATH_BYTES.
            cwd_len = match get_cwd_t(&mut tmp_buf[..]) {
                Ok(r) => r.len(),
                Err(e) => return Err(e),
            };
            path_ptr = tmp_buf.as_ptr();
            path_len = cwd_len;
        } else {
            // Translated from the following JS code:
            //   path = process.env[`=${resolvedDevice}`] || process.cwd();
            #[cfg(windows)]
            {
                let mut u16_buf = bun_paths::WPathBuffer::uninit();
                // Storage for the `=X:` fast-path key. Declared here (not inside the
                // `'brk:` block) so the slice it backs stays live across `getenv_w`.
                // 4 elements (not 3) so the wchar immediately following the 3-char
                // key is a guaranteed NUL — `getenv_w` forwards `name.as_ptr()` to
                // `GetEnvironmentVariableW`, which reads an LPCWSTR until NUL. The
                // Zig spec uses `&[3:0]u16{...}` (sentinel-terminated) for the same
                // reason.
                let mut fast_key: [u16; 4];
                // Windows has the concept of drive-specific current working
                // directories. If we've resolved a drive letter but not yet an
                // absolute path, get cwd for that drive, or the process cwd if
                // the drive cwd is not available. We're sure the device is not
                // a UNC path at this points, because UNC paths are always absolute.

                // Translated from the following JS code:
                //   process.env[`=${resolvedDevice}`]
                let key_w: &[u16] = 'brk: {
                    if resolved_device_len == 2 && tmp_buf[1] == T::from_u8(CHAR_COLON) {
                        // Fast path for device roots
                        fast_key = [
                            b'=' as u16,
                            u16::try_from(tmp_buf[0].as_u32()).expect("int cast"),
                            CHAR_COLON as u16,
                            0,
                        ];
                        // Slice the WHOLE 4-element array (not `..3`): `getenv_w`
                        // forwards `.as_ptr()` to `GetEnvironmentVariableW`, which
                        // reads index 3 (the NUL). A `..3` slice would not carry
                        // provenance over that byte under Stacked/Tree Borrows.
                        break 'brk &fast_key[..];
                    }
                    buf_size = 1;
                    // Reuse buf2 for the env key because it's used to get the path.
                    buf2[0] = T::from_u8(b'=');
                    buf_offset = buf_size;
                    buf_size += resolved_device_len;
                    memmove(
                        &mut buf2[buf_offset..buf_size],
                        &tmp_buf[0..resolved_device_len],
                    );
                    if T::IS_U16 {
                        // `getenv_w` requires the NUL be addressable via the slice's
                        // pointer (it forwards `.as_ptr()` as LPCWSTR). `buf2` is a
                        // reused arena buffer with arbitrary prior contents past
                        // `buf_size`, so write the terminator explicitly. Zig spec:
                        // path.zig declares `key_w: [*:0]const u16` and the sentinel
                        // is part of the object.
                        buf2[buf_size] = T::from_u8(0);
                        // T == u16 when IS_U16; bytemuck statically checks the layout.
                        break 'brk bytemuck::cast_slice::<T, u16>(&buf2[..=buf_size]);
                    }
                    // T == u8 when !IS_U16; bytemuck statically checks the layout.
                    let key8: &[u8] = bytemuck::cast_slice::<T, u8>(&buf2[..buf_size]);
                    // Zig spec (path.zig:2480-2482) writes `u16Buf[bufSize] = 0;`
                    // after widening so the LPCWSTR is properly terminated regardless
                    // of `WPathBuffer::uninit()`'s init state. Do the same here —
                    // don't rely on `uninit()` happening to zero-fill today.
                    let n = strings::convert_utf8_to_utf16_in_buffer(&mut u16_buf[..], key8).len();
                    u16_buf[n] = 0;
                    &u16_buf[..=n]
                };
                // Zig's std.posix.getenvW has logic to support keys like `=${resolvedDevice}`:
                // https://github.com/ziglang/zig/blob/7bd8b35a3dfe61e59ffea39d464e84fbcdead29a/lib/std/os.zig#L2126-L2130
                //
                // TODO: Enable test once spawnResult.stdout works on Windows.
                // test/js/node/path/resolve.test.js
                if let Some(r) = bun_sys::windows::getenv_w(key_w) {
                    if T::IS_U16 {
                        buf_size = r.len();
                        // T == u16 when IS_U16; bytemuck checks the layout at runtime.
                        let dst: &mut [u16] =
                            bytemuck::cast_slice_mut::<T, u16>(&mut buf2[..buf_size]);
                        memmove(dst, &r);
                    } else {
                        // Reuse buf2 because it's used for path.
                        // T == u8 when !IS_U16; bytemuck statically checks the layout.
                        let dst: &mut [u8] = bytemuck::cast_slice_mut::<T, u8>(&mut buf2[..]);
                        buf_size = strings::convert_utf16_to_utf8_in_buffer(dst, &r).len();
                    }
                    env_path_len = Some(buf_size);
                }
            }
            if let Some(ep_len) = env_path_len {
                path_ptr = buf2.as_ptr();
                path_len = ep_len;
            } else {
                // cwd is limited to MAX_PATH_BYTES.
                cwd_len = match get_cwd_t(&mut tmp_buf[..]) {
                    Ok(r) => r.len(),
                    Err(e) => return Err(e),
                };
                path_ptr = tmp_buf.as_ptr();
                path_len = cwd_len;
                // We must set envPath here so that it doesn't hit the null check just below.
                env_path_len = Some(cwd_len);
            }

            // Verify that a cwd was found and that it actually points
            // to our drive. If not, default to the drive's root.

            // Translated from the following JS code:
            //   if (path === undefined ||
            //     (StringPrototypeToLowerCase(StringPrototypeSlice(path, 0, 2)) !==
            //     StringPrototypeToLowerCase(resolvedDevice) &&
            //     StringPrototypeCharCodeAt(path, 2) === CHAR_BACKWARD_SLASH)) {
            if env_path_len.is_none()
                || (path!()[2] == T::from_u8(CHAR_BACKWARD_SLASH)
                    && !eql_ignore_case_t(&path!()[0..2], &tmp_buf[0..resolved_device_len]))
            {
                // Translated from the following JS code:
                //   path = `${resolvedDevice}\\`;
                buf_size = resolved_device_len;
                memmove(&mut buf2[0..buf_size], &tmp_buf[0..resolved_device_len]);
                buf_offset = buf_size;
                buf_size += 1;
                buf2[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                path_ptr = buf2.as_ptr();
                path_len = buf_size;
            }
        }

        let len = path_len;
        let mut root_end: usize = 0;
        // Backed by tmpBuf or an anonymous buffer.
        let mut device_buf: [T; 2] = [T::default(); 2];
        // PORT NOTE: same raw-ptr trick as `path` — `device` may alias tmp_buf.
        let mut device_ptr: *const T = core::ptr::NonNull::<T>::dangling().as_ptr().cast_const();
        let mut device_len: usize = 0;
        let mut device_in_tmp = false;
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        let mut _is_absolute: bool = false;
        let byte0 = if len > 0 { path!()[0] } else { T::default() };

        // Try to match a root
        if len == 1 {
            if is_sep_t(byte0) {
                // `path` contains just a path separator
                root_end = 1;
                _is_absolute = true;
            }
        } else if is_sep_t(byte0) {
            // Possible UNC root

            // If we started with a separator, we know we at least have an
            // absolute path of some kind (UNC or otherwise)
            _is_absolute = true;

            if is_sep_t(path!()[1]) {
                // Matched double path separator at the beginning
                let mut j: usize = 2;
                let mut last: usize = j;
                // Match 1 or more non-path separators
                while j < len && !is_sep_t(path!()[j]) {
                    j += 1;
                }
                if j < len && j != last {
                    let first_part_start = last;
                    let first_part_end = j;
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while j < len && is_sep_t(path!()[j]) {
                        j += 1;
                    }
                    if j < len && j != last {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while j < len && !is_sep_t(path!()[j]) {
                            j += 1;
                        }
                        if j == len || j != last {
                            // We matched a UNC root

                            if resolved_device_len > 0 {
                                // resolvedDevice is already set to a drive
                                // letter (`X:`). A UNC device can never match
                                // it, and building the UNC string below would
                                // overwrite tmpBuf which backs resolvedDevice.
                                i_i64 -= 1;
                                continue;
                            }

                            // Translated from the following JS code:
                            //   device =
                            //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                            //   rootEnd = j;
                            // PORT NOTE: path may alias tmp_buf (cwd branch). The Zig original
                            // relies on memmove + non-overlapping ranges; use ptr::copy here.
                            buf_size = 2;
                            tmp_buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                            tmp_buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                            buf_offset = buf_size;
                            let first_part_len = first_part_end - first_part_start;
                            buf_size += first_part_len;
                            // SAFETY: src/dst within live buffers; ptr::copy handles overlap.
                            unsafe {
                                core::ptr::copy(
                                    path_ptr.add(first_part_start),
                                    tmp_buf.as_mut_ptr().add(buf_offset),
                                    first_part_len,
                                );
                            }
                            buf_offset = buf_size;
                            buf_size += 1;
                            tmp_buf[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
                            let slice_len = j - last;
                            buf_offset = buf_size;
                            buf_size += slice_len;
                            // SAFETY: src/dst within live buffers; ptr::copy handles overlap.
                            unsafe {
                                core::ptr::copy(
                                    path_ptr.add(last),
                                    tmp_buf.as_mut_ptr().add(buf_offset),
                                    slice_len,
                                );
                            }

                            device_ptr = tmp_buf.as_ptr();
                            device_len = buf_size;
                            device_in_tmp = true;
                            root_end = j;
                        }
                    }
                }
            } else {
                root_end = 1;
            }
        } else if is_windows_device_root_t(byte0) && path!()[1] == T::from_u8(CHAR_COLON) {
            // Possible device root
            device_buf = [byte0, T::from_u8(CHAR_COLON)];
            device_ptr = device_buf.as_ptr();
            device_len = 2;
            root_end = 2;
            if len > 2 && is_sep_t(path!()[2]) {
                // Treat separator following the drive name as an absolute path
                // indicator
                _is_absolute = true;
                root_end = 3;
            }
        }

        if device_len > 0 {
            // SAFETY: (device_ptr, device_len) describes a live region in tmp_buf or device_buf.
            let device = unsafe { bun_core::ffi::slice(device_ptr, device_len) };
            if resolved_device_len > 0 {
                // Translated from the following JS code:
                //   if (StringPrototypeToLowerCase(device) !==
                //     StringPrototypeToLowerCase(resolvedDevice))
                if !eql_ignore_case_t(device, &tmp_buf[0..resolved_device_len]) {
                    // This path points to another device, so it is not applicable
                    i_i64 -= 1;
                    continue;
                }
            } else {
                // Translated from the following JS code:
                //   resolvedDevice = device;
                buf_size = device_len;
                // Copy device over if it's backed by an anonymous buffer.
                if !device_in_tmp {
                    memmove(&mut tmp_buf[0..buf_size], device);
                }
                resolved_device_len = buf_size;
            }
        }

        if resolved_absolute {
            if resolved_device_len > 0 {
                break;
            }
        } else {
            // Translated from the following JS code:
            //   resolvedTail = `${StringPrototypeSlice(path, rootEnd)}\\${resolvedTail}`;
            let slice_len = len - root_end;
            if resolved_tail_len > 0 {
                buf_offset = slice_len + 1;
                buf_size = buf_offset + resolved_tail_len;
                // Move all bytes to the right by path slice.len + 1 for the separator
                // Use copy_within because resolvedTail and buf2 overlap.
                buf2.copy_within(0..resolved_tail_len, buf_offset);
            }
            buf_size = slice_len;
            if slice_len > 0 {
                // PORT NOTE: path may alias buf2 (env path branch); use ptr::copy.
                // SAFETY: handles overlap.
                unsafe {
                    core::ptr::copy(path_ptr.add(root_end), buf2.as_mut_ptr(), slice_len);
                }
            }
            buf_offset = buf_size;
            buf_size += 1;
            buf2[buf_offset] = T::from_u8(CHAR_BACKWARD_SLASH);
            buf_size += resolved_tail_len;

            resolved_tail_len = buf_size;
            resolved_absolute = _is_absolute;

            if _is_absolute && resolved_device_len > 0 {
                break;
            }
        }
        i_i64 -= 1;
    }

    // Exit early for empty path.
    if resolved_tail_len == 0 {
        return Ok(l::<T>(CHAR_STR_DOT));
    }

    // At this point, the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (might happen when std.process.cwdAlloc()
    // fails)

    // Normalize the tail path
    let normalized_len = normalize_string_t::<T, { Platform::Windows }>(
        &buf2[0..resolved_tail_len],
        !resolved_absolute,
        T::from_u8(CHAR_BACKWARD_SLASH),
        buf,
    );
    // resolvedTail is now backed by buf.
    resolved_tail_len = normalized_len;

    // Translated from the following JS code:
    //   resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}`
    if resolved_absolute {
        buf_offset = resolved_device_len + 1;
        buf_size = buf_offset + resolved_tail_len;
        // Use copy_within because resolvedTail and buf overlap.
        buf.copy_within(0..resolved_tail_len, buf_offset);
        buf[resolved_device_len] = T::from_u8(CHAR_BACKWARD_SLASH);
        memmove(
            &mut buf[0..resolved_device_len],
            &tmp_buf[0..resolved_device_len],
        );
        buf[buf_size] = T::default();
        return Ok(&buf[0..buf_size]);
    }
    // Translated from the following JS code:
    //   : `${resolvedDevice}${resolvedTail}` || '.'
    if (resolved_device_len + resolved_tail_len) > 0 {
        buf_offset = resolved_device_len;
        buf_size = buf_offset + resolved_tail_len;
        // Use copy_within because resolvedTail and buf overlap.
        buf.copy_within(0..resolved_tail_len, buf_offset);
        memmove(
            &mut buf[0..resolved_device_len],
            &tmp_buf[0..resolved_device_len],
        );
        buf[buf_size] = T::default();
        return Ok(&buf[0..buf_size]);
    }
    Ok(l::<T>(CHAR_STR_DOT))
}

// path.zig:2749 — `extern "c" fn Process__getCachedCwd(*jsc.JSGlobalObject) jsc.JSValue;`
unsafe extern "C" {
    safe fn Process__getCachedCwd(global: &JSGlobalObject) -> JSValue;
}

pub fn resolve_posix_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match resolve_posix_t(paths, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

pub fn resolve_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    paths: &[&[T]],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match resolve_windows_t(paths, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

pub fn resolve_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    paths: &[&[T]],
) -> JsResult<JSValue> {
    // Adding 8 bytes when Windows for the possible UNC root.
    let mut buf_len: usize = if is_windows { 8 } else { 0 };
    for path in paths {
        buf_len += if buf_len > 0 && !path.is_empty() {
            path.len() + 1
        } else {
            path.len()
        };
    }
    // When no path is absolute, the CWD (up to MAX_PATH_SIZE bytes) is prepended
    // with a separator. Account for this to prevent buffer overflow.
    buf_len += max_path_size::<T>() + 1;
    buf_len = buf_len.max(path_size::<T>());
    // +2 to account for separator and null terminator during path resolution.
    // Carve buf/buf2 from one pooled slab (mirrors Zig's RareData path_buf).
    let mut scratch = PathScratch::<T>::new(pool, (buf_len + 2) * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len + 2);
    if is_windows {
        resolve_windows_js_t(global_object, paths, buf, buf2)
    } else {
        resolve_posix_js_t(global_object, paths, buf, buf2)
    }
}

pub fn resolve(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    // Lazily-allocated RareData buffer replaces the old stack_fallback_size_large
    // on the stack; `PathScratch` spills to the heap for very long paths.

    // Borrow each argument's WTF backing as a `ZigStringSlice` (no per-arg
    // `to_owned_slice()` heap copy — ASCII inputs borrow in place, only
    // non-ASCII transcodes). Inline-8 keeps the typical call alloc-free.
    // Walk back-to-front to preserve Zig's early-out on the first absolute
    // POSIX path; reverse the borrowed views before handing to `resolve_*_t`.
    let mut owned: SmallVec<[ZigStringSlice; 8]> = SmallVec::new();
    let mut resolved_root = false;

    let mut i = args_len;
    while i > 0 {
        i -= 1;

        if resolved_root {
            break;
        }

        let path = args[i as usize];
        validate_string(global_object, path, format_args!("paths[{}]", i))?;
        let path_zstr = path.get_zig_string(global_object)?;

        if path_zstr.len == 0 {
            continue;
        }

        owned.push(path_zstr.to_slice());

        if !is_windows {
            // `'/'` is ASCII, so byte-level check on the UTF-8 view matches `charAt(0)`.
            if owned.last().unwrap().slice().first() == Some(&CHAR_FORWARD_SLASH) {
                resolved_root = true;
            }
        }
    }

    let mut paths: SmallVec<[&[u8]; 8]> = SmallVec::with_capacity(owned.len());
    for s in owned.iter().rev() {
        paths.push(s.slice());
    }

    #[cfg(unix)]
    {
        if !is_windows {
            // Micro-optimization #1: avoid creating a new string when passing no arguments or only empty strings.
            if paths.is_empty() {
                return Ok(Process__getCachedCwd(global_object));
            }
            // Micro-optimization #2: path.resolve(".") and path.resolve("./") === process.cwd()
            else if paths.len() == 1 && (paths[0] == b"." || paths[0] == b"./") {
                return Ok(Process__getCachedCwd(global_object));
            }
        }
    }

    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    resolve_js_t::<u8>(global_object, pool, is_windows, &paths)
}

/// Based on Node v21.6.1 path.win32.toNamespacedPath:
/// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L622
pub fn to_namespaced_path_windows_t<'a, T: PathCharCwd>(
    path: &[T],
    buf: &'a mut [T],
    buf2: &mut [T],
) -> MaybeSlice<'a, T> {
    // validateString of `path` is performed in pub fn toNamespacedPath.
    // Backed by buf.
    // PORT NOTE: reshaped for borrowck — capture length, then re-borrow buf.
    let resolved_len = match resolve_windows_t(&[path], buf, buf2) {
        Ok(r) => r.len(),
        Err(e) => return Err(e),
    };

    let len = resolved_len;
    if len <= 2 {
        buf[0..path.len()].copy_from_slice(path);
        buf[path.len()] = T::default();
        return Ok(&buf[0..path.len()]);
    }

    let mut buf_offset: usize;
    let mut buf_size: usize;

    let byte0 = buf[0];
    if byte0 == T::from_u8(CHAR_BACKWARD_SLASH) {
        // Possible UNC root
        if buf[1] == T::from_u8(CHAR_BACKWARD_SLASH) {
            let byte2 = buf[2];
            if byte2 != T::from_u8(CHAR_QUESTION_MARK) && byte2 != T::from_u8(CHAR_DOT) {
                // Matched non-long UNC root, convert the path to a long UNC path

                // Translated from the following JS code:
                //   return `\\\\?\\UNC\\${StringPrototypeSlice(resolvedPath, 2)}`;
                buf_offset = 6;
                buf_size = len + 6;
                // Move all bytes to the right by 6 so that the first two bytes are
                // overwritten by "\\\\?\\UNC\\" which is 8 bytes long.
                // Use copy_within because resolvedPath and buf overlap.
                buf.copy_within(0..len, buf_offset);
                // Equiv to std.os.windows.NamespacePrefix.verbatim
                // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
                buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[2] = T::from_u8(CHAR_QUESTION_MARK);
                buf[3] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[4] = T::from_u8(b'U');
                buf[5] = T::from_u8(b'N');
                buf[6] = T::from_u8(b'C');
                buf[7] = T::from_u8(CHAR_BACKWARD_SLASH);
                buf[buf_size] = T::default();
                return Ok(&buf[0..buf_size]);
            }
        }
    } else if is_windows_device_root_t(byte0)
        && buf[1] == T::from_u8(CHAR_COLON)
        && buf[2] == T::from_u8(CHAR_BACKWARD_SLASH)
    {
        // Matched device root, convert the path to a long UNC path

        // Translated from the following JS code:
        //   return `\\\\?\\${resolvedPath}`
        buf_offset = 4;
        buf_size = len + 4;
        // Move all bytes to the right by 4
        // Use copy_within because resolvedPath and buf overlap.
        buf.copy_within(0..len, buf_offset);
        // Equiv to std.os.windows.NamespacePrefix.verbatim
        // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
        buf[0] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[1] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[2] = T::from_u8(CHAR_QUESTION_MARK);
        buf[3] = T::from_u8(CHAR_BACKWARD_SLASH);
        buf[buf_size] = T::default();
        return Ok(&buf[0..buf_size]);
    }
    Ok(&buf[0..resolved_len])
}

pub fn to_namespaced_path_windows_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    path: &[T],
    buf: &mut [T],
    buf2: &mut [T],
) -> JsResult<JSValue> {
    match to_namespaced_path_windows_t(path, buf, buf2) {
        Ok(r) => create_js_string_t::<T>(global_object, r),
        Err(e) => Ok(e.to_js(global_object)),
    }
}

pub fn to_namespaced_path_js_t<T: PathCharCwd>(
    global_object: &JSGlobalObject,
    pool: &mut RarePathBuf,
    is_windows: bool,
    path: &[T],
) -> JsResult<JSValue> {
    if !is_windows || path.is_empty() {
        return create_js_string_t::<T>(global_object, path);
    }
    // Account for CWD (up to MAX_PATH_SIZE) that resolve may prepend to relative paths.
    let buf_len = (path.len() + max_path_size::<T>() + 1).max(path_size::<T>());
    // +8 for possible UNC prefix, +1 for null terminator; ×2 for buf/buf2.
    let mut scratch = PathScratch::<T>::new(pool, (buf_len + 8 + 1) * 2);
    let (buf, buf2) = scratch.slice().split_at_mut(buf_len + 8 + 1);
    to_namespaced_path_windows_js_t(global_object, path, buf, buf2)
}

pub fn to_namespaced_path(
    global_object: &JSGlobalObject,
    is_windows: bool,
    args: &[JSValue],
) -> JsResult<JSValue> {
    let args_len = args.len();
    if args_len == 0 {
        return Ok(JSValue::UNDEFINED);
    }
    let path_ptr = args[0];

    // Based on Node v21.6.1 path.win32.toNamespacedPath and path.posix.toNamespacedPath:
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L624
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1269
    //
    // Act as an identity function for non-string values and non-Windows platforms.
    if !is_windows || !path_ptr.is_string() {
        return Ok(path_ptr);
    }
    let path_zstr = path_ptr.get_zig_string(global_object)?;
    let len = path_zstr.len;
    if len == 0 {
        return Ok(path_ptr);
    }

    let path_zslice = path_zstr.to_slice();
    let pool = &mut global_object.bun_vm().as_mut().rare_data().path_buf;
    to_namespaced_path_js_t::<u8>(global_object, pool, is_windows, path_zslice.slice())
}

// Zig used `bun.jsc.host_fn.wrap4v(...)` to generate the C-ABI shims. The Rust
// proc-macro for `wrap4v` is not yet wired, so emit the SYSV-ABI thunks locally.
// Each wrapper forwards `(global, is_windows, args_ptr, args_len)` and routes the
// `JsResult<JSValue>` through `host_fn::to_js_host_call` (== Zig `toJSHostCall`).
//
// ABI: `jsc.conv` (src/jsc/jsc.zig) is `.x86_64_sysv` on Windows-x64 and `.c`
// everywhere else. The C++ side (src/jsc/bindings/Path.cpp) declares these as
// `SYSV_ABI`, so on Windows-x64 the wrapper MUST be `extern "sysv64"` — using
// `extern "C"` there would be the Win64 ABI (RCX/RDX/R8/R9 + shadow space) and
// would mis-read every argument.
macro_rules! export_path_host_fn {
    ($( $export:literal => $target:path ),* $(,)?) => {$(
        const _: () = {
            #[cfg(all(windows, target_arch = "x86_64"))]
            #[unsafe(export_name = $export)]
            extern "sysv64" fn __wrapped(
                global: &JSGlobalObject,
                is_windows: bool,
                args_ptr: *const JSValue,
                args_len: u16,
            ) -> JSValue {
                // SAFETY: `args_ptr` points to `args_len` JSValues from the C++
                // CallFrame (NodePath.cpp). Borrowed for the synchronous call.
                // (Body kept in sync with the non-Windows arm below — bughunt
                // changed the target signature to take a slice but only updated
                // one cfg arm.)
                let args = unsafe { bun_core::ffi::slice(args_ptr, args_len as usize) };
                crate::jsc::host_fn::to_js_host_call(
                    global,
                    || $target(global, is_windows, args),
                )
            }
            #[cfg(not(all(windows, target_arch = "x86_64")))]
            #[unsafe(export_name = $export)]
            extern "C" fn __wrapped(
                global: &JSGlobalObject,
                is_windows: bool,
                args_ptr: *const JSValue,
                args_len: u16,
            ) -> JSValue {
                // SAFETY: `args_ptr` points to `args_len` JSValues from the C++
                // CallFrame (the caller is `Bun__Path__*` in NodePath.cpp). The
                // slice is borrowed for the synchronous host-call only.
                let args = unsafe { bun_core::ffi::slice(args_ptr, args_len as usize) };
                crate::jsc::host_fn::to_js_host_call(
                    global,
                    || $target(global, is_windows, args),
                )
            }
        };
    )*};
}
export_path_host_fn! {
    "Bun__Path__basename" => basename,
    "Bun__Path__dirname" => dirname,
    "Bun__Path__extname" => extname,
    "Bun__Path__format" => format,
    "Bun__Path__isAbsolute" => is_absolute,
    "Bun__Path__join" => join,
    "Bun__Path__normalize" => normalize,
    "Bun__Path__parse" => parse,
    "Bun__Path__relative" => relative,
    "Bun__Path__resolve" => resolve,
    "Bun__Path__toNamespacedPath" => to_namespaced_path,
}

// ported from: src/runtime/node/path.zig
