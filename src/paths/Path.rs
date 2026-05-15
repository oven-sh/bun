// PORT NOTE: Zig's comptime enum options become `const u8` generics on stable
// (adt_const_params is nightly-only). Each fn that branches on an option
// reconstructs the enum from the u8 via `decode_opts!` so the original
// `match Kind::Abs => ..` arms stay unchanged. The optimizer sees through the
// `const fn from_u8` so monomorphization is preserved.
// Phase B: either enable the feature crate-wide or lower the const-generic enums to a
// trait-per-option encoding if nightly is unacceptable.

use core::marker::PhantomData;
use core::mem::ManuallyDrop;

use crate::{
    MAX_PATH_BYTES, PATH_MAX_WIDE, PathBuffer, SEP, SEP_POSIX, SEP_WINDOWS, WPathBuffer,
    resolve_path as path,
};
use bun_core::Environment;
use bun_core::{Fd, WStr, ZStr, strings};

// ──────────────────────────────────────────────────────────────────────────
// Options
// ──────────────────────────────────────────────────────────────────────────
//
// Zig models `Options` as a struct of comptime enum fields passed as a single
// `comptime opts: Options` parameter. Rust cannot take a struct as a const
// generic on stable, so the fields are spread as individual const-generic
// parameters on `Path` below. The `Options` namespace is kept as a module for
// the enums so diff readers can map `Options.Kind` ↔ `options::Kind`.

pub mod options {
    use super::*;

    #[derive(PartialEq, Eq, Clone, Copy, Debug)]
    pub enum Unit {
        U8,
        U16,
        Os,
    }

    #[derive(PartialEq, Eq, Clone, Copy, Debug)]
    pub enum BufType {
        Pool,
        // Stack,
        // ArrayList,
    }

    #[derive(PartialEq, Eq, Clone, Copy, Debug)]
    pub enum Kind {
        Abs,
        Rel,

        // not recommended, but useful when you don't know
        Any,
    }

    #[derive(PartialEq, Eq, Clone, Copy, Debug)]
    pub enum CheckLength {
        AssumeAlwaysLessThanMaxPath,
        CheckForGreaterThanMaxPath,
    }

    #[derive(PartialEq, Eq, Clone, Copy, Debug)]
    pub enum PathSeparators {
        Any,
        Auto,
        Posix,
        Windows,
    }

    // ── const-generic encoding ────────────────────────────────────────────
    // Stable Rust forbids enum-typed const generics; encode each option enum
    // as a `u8` const param and decode at fn entry via `from_u8`.
    impl Kind {
        pub const ABS: u8 = 0;
        pub const REL: u8 = 1;
        pub const ANY: u8 = 2;
        #[inline(always)]
        pub const fn from_u8(v: u8) -> Self {
            match v {
                0 => Self::Abs,
                1 => Self::Rel,
                _ => Self::Any,
            }
        }
    }
    impl PathSeparators {
        pub const ANY: u8 = 0;
        pub const AUTO: u8 = 1;
        pub const POSIX: u8 = 2;
        pub const WINDOWS: u8 = 3;
        #[inline(always)]
        pub const fn from_u8(v: u8) -> Self {
            match v {
                1 => Self::Auto,
                2 => Self::Posix,
                3 => Self::Windows,
                _ => Self::Any,
            }
        }
    }
    impl CheckLength {
        pub const ASSUME: u8 = 0;
        pub const CHECK: u8 = 1;
        #[inline(always)]
        pub const fn from_u8(v: u8) -> Self {
            if v == 0 {
                Self::AssumeAlwaysLessThanMaxPath
            } else {
                Self::CheckForGreaterThanMaxPath
            }
        }
    }

    impl PathSeparators {
        pub const fn char(self) -> u8 {
            match self {
                // Zig: @compileError("use the existing slash")
                PathSeparators::Any => panic!("use the existing slash"),
                PathSeparators::Auto => SEP,
                PathSeparators::Posix => SEP_POSIX,
                PathSeparators::Windows => SEP_WINDOWS,
            }
        }
    }

    // Zig: `pub fn pathUnit(comptime opts) type` / `notPathUnit`
    // Rust models this as a trait with an associated `Other` type; see `PathUnit` below.

    // Zig: `pub fn maxPathLength(comptime opts) usize`
    // Moved to `PathUnit::MAX_PATH` associated const; the `.assume_always_less_than_max_path`
    // arm's @compileError is enforced by simply never reading MAX_PATH in that mode.

    /// `error{MaxPathExceeded}`
    #[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
    pub enum Error {
        #[error("MaxPathExceeded")]
        MaxPathExceeded,
    }

    impl From<Error> for bun_core::Error {
        fn from(e: Error) -> Self {
            bun_core::err!("MaxPathExceeded")
        }
    }

    // Zig: `pub fn ResultFn(comptime opts) fn(type) type` — returns `T` when
    // `.assume_always_less_than_max_path`, `Error!T` otherwise.
    //
    // TODO(port): Rust cannot vary a fn's return type on a const-generic value.
    // All `Result(T)` call sites below return `Result<T, Error>` unconditionally;
    // callers configured with `AssumeAlwaysLessThanMaxPath` should treat the
    // `Err` arm as unreachable. Phase B may split into two inherent impls via
    // `where` bounds on `CHECK_LENGTH` once `generic_const_exprs` lands, or
    // expose `_unchecked` variants.
    pub type Result<T> = core::result::Result<T, Error>;

    /// `Result::unwrap` for the `CheckLength::AssumeAlwaysLessThanMaxPath`
    /// configuration (every `Auto*`/`Os*` `Path` alias).
    ///
    /// In Zig, `Path(.{ .check_length = .assume_always_less_than_max_path })`
    /// `from`/`append`/`appendFmt` return bare `T` (not `Error!T`), so call
    /// sites are `path.append(x)` with no `try`. The Rust port returns
    /// `Result<T, Error>` unconditionally (see PORT NOTE above), but the
    /// `from`/`append` bodies *skip the length check entirely* in `ASSUME`
    /// mode -- `Err(MaxPathExceeded)` is dead code, and an over-long input
    /// instead panics inside `PooledBuf::append` slice indexing. So callers
    /// on `ASSUME` types should use this instead of `?`/`handle_oom`: it
    /// makes the infallibility explicit and, unlike `handle_oom`, panics with
    /// the real reason if the invariant is ever violated rather than
    /// misreporting it as "out of memory".
    pub trait AssumeOk<T> {
        fn assume_ok(self) -> T;
    }
    impl<T> AssumeOk<T> for Result<T> {
        #[inline]
        #[track_caller]
        fn assume_ok(self) -> T {
            match self {
                Ok(v) => v,
                // Not `unreachable_unchecked` -- keep the panic so a future
                // `CheckForGreaterThanMaxPath` caller misusing this surfaces
                // a real diagnostic instead of UB.
                Err(Error::MaxPathExceeded) => unreachable!(
                    "MaxPathExceeded on a CheckLength::ASSUME Path \
                     (Err arm is dead under ASSUME; over-long input panics in \
                     PooledBuf::append slice indexing first)"
                ),
            }
        }
    }

    // Zig: `pub fn inputChildType(opts, InputType) type` — strips array-ness
    // off string literals to get the element type. In Rust the generic `&[C]`
    // parameter already names `C` directly, so this helper disappears.
}

use options::{BufType, CheckLength, Error as PathError, Kind, PathSeparators, Unit};

// Runtime → type-param dispatch for `resolve_path`'s `<P: PlatformT>` fns,
// keyed on `SEP_OPT`. PERF: SEP_OPT is a const generic so the optimizer
// const-folds the match to a single monomorphized call.
macro_rules! sep_dispatch {
    ($fn:ident ( $($a:expr),* $(,)? )) => {
        match PathSeparators::from_u8(SEP_OPT) {
            PathSeparators::Any | PathSeparators::Auto => path::$fn::<path::platform::Auto>($($a),*),
            PathSeparators::Posix => path::$fn::<path::platform::Posix>($($a),*),
            PathSeparators::Windows => path::$fn::<path::platform::Windows>($($a),*),
        }
    };
}

// ──────────────────────────────────────────────────────────────────────────
// PathUnit trait — replaces `opts.pathUnit()` / `opts.notPathUnit()` /
// `opts.Buf().pooled`'s type-level switch on `opts.unit`.
// ──────────────────────────────────────────────────────────────────────────

/// A path code unit: `u8` (UTF-8/WTF-8 bytes) or `u16` (WTF-16, Windows).
/// Extends the canonical [`crate::PathChar`] with the buffer-pool / ZSlice
/// machinery this module needs; the ASCII helpers (`from_u8`/`eq_ascii`/
/// `to_ascii`) are inherited.
pub trait PathUnit: crate::PathChar {
    /// `opts.notPathUnit()`
    type Other: PathUnit;
    /// The fixed-size buffer type (`PathBuffer` / `WPathBuffer`).
    type Buffer: 'static;
    /// `opts.maxPathLength()` for this unit.
    const MAX_PATH: usize;
    /// `[:0]const u8` → `ZStr`, `[:0]const u16` → `WStr` (length-carrying NUL-terminated slice).
    type ZSlice: ?Sized;

    /// Construct a borrowed NUL-terminated slice (`ZStr` / `WStr`) from a raw pointer + len.
    ///
    /// # Safety
    /// `ptr[..=len]` must be valid for reads for `'a`, and `ptr[len]` must be `0`.
    unsafe fn zslice_from_raw<'a>(ptr: *const Self, len: usize) -> &'a Self::ZSlice;

    /// `bun.path_buffer_pool.get()` / `bun.w_path_buffer_pool.get()`
    // LIFETIMES.tsv classifies `Buf.pooled` as OWNED → Box<PathBuffer>; the
    // underlying pool hands out heap buffers and reclaims them in `deinit`.
    // TODO(port): swap to `crate::path_buffer_pool()` RAII guard once the
    // guard type is generic over unit; for now model as Box and put-back in Drop.
    fn pool_get() -> Box<Self::Buffer>;
    fn pool_put(buf: Box<Self::Buffer>);

    fn buffer_as_mut_slice(buf: &mut Self::Buffer) -> &mut [Self];
    fn buffer_as_slice(buf: &Self::Buffer) -> &[Self];

    /// `bun.windows.long_path_prefix{,_u8}` lifted into the unit trait so
    /// `crate::windows::long_path_prefix_for::<U>()` can pick the right width without a runtime
    /// switch. Mirrors Zig's comptime branch on `.u8`/`.u16` in `paths/Path.zig`.
    const LONG_PATH_PREFIX: &'static [Self];

    // ── identity downcasts ────────────────────────────────────────────────
    // Trait-dispatched no-op identity casts. The default body is unreachable
    // for the non-matching impl; callers gate on `TypeId` so the dead arm is
    // const-folded out, and in the live arm the cast is a safe
    // `fn(&[u8]) -> &[u8]` in the monomorphized code.
    #[inline(always)]
    fn id_u8(_: &[Self]) -> &[u8] {
        unreachable!("PathUnit::id_u8 on non-u8")
    }
    #[inline(always)]
    fn id_u8_mut(_: &mut [Self]) -> &mut [u8] {
        unreachable!("PathUnit::id_u8_mut on non-u8")
    }
    #[inline(always)]
    fn id_u8_slices<'a, 'b>(_: &'a [&'b [Self]]) -> &'a [&'b [u8]] {
        unreachable!("PathUnit::id_u8_slices on non-u8")
    }
    #[inline(always)]
    fn id_u16(_: &[Self]) -> &[u16] {
        unreachable!("PathUnit::id_u16 on non-u16")
    }
    #[inline(always)]
    fn id_u16_mut(_: &mut [Self]) -> &mut [u16] {
        unreachable!("PathUnit::id_u16_mut on non-u16")
    }
    // Inverse direction (concrete → Self). Same trait-dispatch trick: the
    // matching impl overrides with the identity, the other hits `unreachable!`.
    #[inline(always)]
    fn id_from_u8(_: &[u8]) -> &[Self] {
        unreachable!("PathUnit::id_from_u8 on non-u8")
    }
    #[inline(always)]
    fn id_from_u16(_: &[u16]) -> &[Self] {
        unreachable!("PathUnit::id_from_u16 on non-u16")
    }

    /// `convert_into_buffer` — write `src` (the *other* width) into `dest`
    /// transcoding UTF-8↔UTF-16. Returns units written.
    fn convert_from_other(dest: &mut [Self], src: &[Self::Other]) -> usize;
}

impl PathUnit for u8 {
    type Other = u16;
    type Buffer = PathBuffer;
    const MAX_PATH: usize = MAX_PATH_BYTES;
    type ZSlice = ZStr;
    const LONG_PATH_PREFIX: &'static [u8] = &crate::windows::LONG_PATH_PREFIX_U8;

    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        unsafe { ZStr::from_raw(ptr, len) }
    }
    fn pool_get() -> Box<PathBuffer> {
        crate::path_buffer_pool::get().into_box()
    }
    fn pool_put(buf: Box<PathBuffer>) {
        crate::path_buffer_pool::put(buf)
    }
    #[inline]
    fn buffer_as_mut_slice(buf: &mut PathBuffer) -> &mut [u8] {
        &mut buf[..]
    }
    #[inline]
    fn buffer_as_slice(buf: &PathBuffer) -> &[u8] {
        &buf[..]
    }
    #[inline(always)]
    fn id_u8(s: &[u8]) -> &[u8] {
        s
    }
    #[inline(always)]
    fn id_u8_mut(s: &mut [u8]) -> &mut [u8] {
        s
    }
    #[inline(always)]
    fn id_u8_slices<'a, 'b>(s: &'a [&'b [u8]]) -> &'a [&'b [u8]] {
        s
    }
    #[inline(always)]
    fn id_from_u8(s: &[u8]) -> &[u8] {
        s
    }
    #[inline]
    fn convert_from_other(dest: &mut [u8], src: &[u16]) -> usize {
        strings::convert_utf16_to_utf8_in_buffer(dest, src).len()
    }
}

impl PathUnit for u16 {
    type Other = u8;
    type Buffer = WPathBuffer;
    const MAX_PATH: usize = PATH_MAX_WIDE;
    type ZSlice = WStr;
    const LONG_PATH_PREFIX: &'static [u16] = &crate::windows::LONG_PATH_PREFIX;

    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        unsafe { WStr::from_raw(ptr, len) }
    }
    fn pool_get() -> Box<WPathBuffer> {
        crate::w_path_buffer_pool::get().into_box()
    }
    fn pool_put(buf: Box<WPathBuffer>) {
        crate::w_path_buffer_pool::put(buf)
    }
    #[inline]
    fn buffer_as_mut_slice(buf: &mut WPathBuffer) -> &mut [u16] {
        &mut buf[..]
    }
    #[inline]
    fn buffer_as_slice(buf: &WPathBuffer) -> &[u16] {
        &buf[..]
    }
    #[inline(always)]
    fn id_u16(s: &[u16]) -> &[u16] {
        s
    }
    #[inline(always)]
    fn id_u16_mut(s: &mut [u16]) -> &mut [u16] {
        s
    }
    #[inline(always)]
    fn id_from_u16(s: &[u16]) -> &[u16] {
        s
    }
    #[inline]
    fn convert_from_other(dest: &mut [u16], src: &[u8]) -> usize {
        strings::convert_utf8_to_utf16_in_buffer(dest, src).len()
    }
}

/// `Unit::Os` — resolves to `u16` on Windows, `u8` elsewhere.
#[cfg(windows)]
pub type OsUnit = u16;
#[cfg(not(windows))]
pub type OsUnit = u8;

// ──────────────────────────────────────────────────────────────────────────
// Buf — `opts.Buf()` (only the `.pool` variant is implemented in Zig)
// ──────────────────────────────────────────────────────────────────────────

pub struct Buf<U: PathUnit, const SEP_OPT: u8> {
    // LIFETIMES.tsv: OWNED → Box<PathBuffer> (pool.get() in init(); pool.put() in deinit()).
    // Wrapped in ManuallyDrop so `Path::drop` can move the Box back into the pool
    // without leaving a dangling Box behind for the field destructor.
    pooled: ManuallyDrop<Box<U::Buffer>>,
    len: usize,
}

impl<U: PathUnit, const SEP_OPT: u8> Buf<U, SEP_OPT> {
    #[inline]
    pub fn set_length(&mut self, new_len: usize) {
        self.len = new_len;
    }

    /// Append `characters` (same code-unit width as `U`), optionally prefixing a separator.
    pub fn append(&mut self, characters: &[U], add_separator: bool) {
        let buf = U::buffer_as_mut_slice(&mut self.pooled);
        if add_separator {
            buf[self.len] = match PathSeparators::from_u8(SEP_OPT) {
                PathSeparators::Any | PathSeparators::Auto => U::from_u8(SEP),
                PathSeparators::Posix => U::from_u8(SEP_POSIX),
                PathSeparators::Windows => U::from_u8(SEP_WINDOWS),
            };
            self.len += 1;
        }

        // opts.inputChildType(@TypeOf(characters)) == opts.pathUnit() — same-unit branch.
        match PathSeparators::from_u8(SEP_OPT) {
            PathSeparators::Any => {
                buf[self.len..][..characters.len()].copy_from_slice(characters);
                self.len += characters.len();
            }
            PathSeparators::Auto | PathSeparators::Posix | PathSeparators::Windows => {
                for &c in characters {
                    buf[self.len] = if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                        U::from_u8(PathSeparators::from_u8(SEP_OPT).char())
                    } else {
                        c
                    };
                    self.len += 1;
                }
            }
        }
    }

    /// Append `characters` of the *other* code-unit width, transcoding into the buffer.
    pub fn append_other(&mut self, characters: &[U::Other], add_separator: bool) {
        let buf = U::buffer_as_mut_slice(&mut self.pooled);
        if add_separator {
            buf[self.len] = match PathSeparators::from_u8(SEP_OPT) {
                PathSeparators::Any | PathSeparators::Auto => U::from_u8(SEP),
                PathSeparators::Posix => U::from_u8(SEP_POSIX),
                PathSeparators::Windows => U::from_u8(SEP_WINDOWS),
            };
            self.len += 1;
        }

        // TODO(port): the Zig branches on `opts.inputChildType(@TypeOf(characters))` to pick
        // convertUTF8toUTF16InBuffer vs convertUTF16toUTF8InBuffer. Rust cannot match on a
        // type parameter at runtime; route through a helper trait in Phase B. For now this
        // dispatches via TypeId-equivalent specialization on the two concrete impls.
        let converted_len = convert_into_buffer::<U>(&mut buf[self.len..], characters);
        if SEP_OPT != PathSeparators::ANY {
            for off in 0..converted_len {
                let c = buf[self.len + off];
                if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                    buf[self.len + off] = U::from_u8(PathSeparators::from_u8(SEP_OPT).char());
                }
            }
        }
        self.len += converted_len;
    }

    #[allow(dead_code)]
    fn convert_append(&mut self, _characters: &[U::Other]) {
        // Intentionally empty — Zig body is fully commented out.
    }
}

/// Width-generic `bun.strings.basename` (Zig: `src/string/immutable/paths.zig:413`).
/// Platform-split: POSIX recognizes only `/`; Windows recognizes `/`, `\`, and
/// the `X:` drive designator at index 1.
#[inline]
fn basename_generic<U: PathUnit>(path: &[U]) -> &[U] {
    if cfg!(windows) {
        bun_core::strings::basename_windows(path)
    } else {
        bun_core::strings::basename_posix(path)
    }
}

/// Width-generic `bun.Dirname.dirname` (Zig: `src/bun.zig:2520`).
/// Platform-split: POSIX is `std.fs.path.dirnamePosix` (only `/`); Windows is
/// `dirnameWindows` with disk-designator handling.
pub fn dirname_generic<U: PathUnit>(path: &[U]) -> Option<&[U]> {
    #[cfg(not(windows))]
    return dirname_posix(path);
    #[cfg(windows)]
    return dirname_windows(path);
}

#[inline]
fn dirname_posix<U: PathUnit>(path: &[U]) -> Option<&[U]> {
    if path.is_empty() {
        return None;
    }
    let mut end_index = path.len() - 1;
    while path[end_index].eq_ascii(b'/') {
        if end_index == 0 {
            return None;
        }
        end_index -= 1;
    }
    while !path[end_index].eq_ascii(b'/') {
        if end_index == 0 {
            return None;
        }
        end_index -= 1;
    }
    // end_index is now at a '/'
    if end_index == 0 {
        // path[0] == '/' (loop exited because is_sep, not because index hit 0)
        return Some(&path[..1]);
    }
    Some(&path[..end_index])
}

#[allow(dead_code)]
#[inline]
fn dirname_windows<U: PathUnit>(path: &[U]) -> Option<&[U]> {
    if path.is_empty() {
        return None;
    }
    let root_len = disk_designator_len_windows(path);
    if path.len() == root_len {
        return None;
    }
    let have_root_slash =
        path.len() > root_len && (path[root_len].eq_ascii(b'/') || path[root_len].eq_ascii(b'\\'));

    let mut end_index = path.len() - 1;
    while path[end_index].eq_ascii(b'/') || path[end_index].eq_ascii(b'\\') {
        if end_index == 0 {
            return None;
        }
        end_index -= 1;
    }
    while !path[end_index].eq_ascii(b'/') && !path[end_index].eq_ascii(b'\\') {
        if end_index == 0 {
            return None;
        }
        end_index -= 1;
    }
    if have_root_slash && end_index == root_len {
        end_index += 1;
    }
    if end_index == 0 {
        return None;
    }
    Some(&path[..end_index])
}

/// Width-generic port of `bun.Dirname.diskDesignatorWindows` →
/// `windowsParsePath(..).disk_designator.len`. Handles drive-letter (`C:` → 2)
/// and UNC NetworkShare (`\\server\share` → index past second token).
pub(crate) fn disk_designator_len_windows<U: PathUnit>(path: &[U]) -> usize {
    // Zig: `path_.len >= 2 and path_[1] == ':'` — no alphabetic check on path_[0].
    if path.len() >= 2 && path[1].eq_ascii(b':') {
        return 2;
    }
    // Single leading separator (or lone sep) → kind = .None, designator = path[0..0].
    if !path.is_empty()
        && (path[0].eq_ascii(b'/') || path[0].eq_ascii(b'\\'))
        && (path.len() == 1 || (!path[1].eq_ascii(b'/') && !path[1].eq_ascii(b'\\')))
    {
        return 0;
    }
    if path.len() < 5 {
        // "//a/b".len
        return 0;
    }
    // UNC NetworkShare: `\\server\share` or `//server/share` (uniform sep).
    // `inline for ("/\\") |this_sep|` — separator that started the prefix
    // must match throughout; mixing `/` and `\` falls through to relative.
    for this_sep in [b'/', b'\\'] {
        if path[0].eq_ascii(this_sep) && path[1].eq_ascii(this_sep) {
            if path[2].eq_ascii(this_sep) {
                return 0;
            }
            // `std.mem.tokenizeScalar(T, path, this_sep)`: skip sep runs,
            // yield non-empty tokens; after two `next()`, `it.index` is the
            // offset just past the second token (at next sep or len).
            let mut idx = 0usize;
            let mut tokens = 0u8;
            while tokens < 2 {
                while idx < path.len() && path[idx].eq_ascii(this_sep) {
                    idx += 1;
                }
                if idx >= path.len() {
                    // `orelse return relative_path`
                    return 0;
                }
                while idx < path.len() && !path[idx].eq_ascii(this_sep) {
                    idx += 1;
                }
                tokens += 1;
            }
            return idx;
        }
    }
    0
}

#[inline]
fn convert_into_buffer<U: PathUnit>(dest: &mut [U], src: &[U::Other]) -> usize {
    U::convert_from_other(dest, src)
}

// ──────────────────────────────────────────────────────────────────────────
// AbsPath / RelPath / Path
// ──────────────────────────────────────────────────────────────────────────

/// `AbsPath(opts)` — forces `kind = .abs`.
pub type AbsPath<
    U = u8,
    const SEP_OPT: u8 = { PathSeparators::ANY },
    const CHECK: u8 = { CheckLength::ASSUME },
> = Path<U, { Kind::ABS }, SEP_OPT, CHECK>;

/// `Path(.{ .kind = .abs, .sep = .auto })`
pub type AutoAbsPath = Path<u8, { Kind::ABS }, { PathSeparators::AUTO }>;

/// `RelPath(opts)` — forces `kind = .rel`.
pub type RelPath<
    U = u8,
    const SEP_OPT: u8 = { PathSeparators::ANY },
    const CHECK: u8 = { CheckLength::ASSUME },
> = Path<U, { Kind::REL }, SEP_OPT, CHECK>;

/// `Path(.{ .kind = .rel, .sep = .auto })`
pub type AutoRelPath = Path<u8, { Kind::REL }, { PathSeparators::AUTO }>;

/// `Path(comptime opts: Options) type`
///
/// `BufType` is omitted as a parameter because only `.pool` is implemented in Zig.
/// `Unit` is encoded as the type parameter `U: PathUnit` (use `u8`, `u16`, or `OsUnit`).
pub struct Path<
    U: PathUnit = u8,
    const KIND: u8 = { Kind::ANY },
    const SEP_OPT: u8 = { PathSeparators::ANY },
    const CHECK: u8 = { CheckLength::ASSUME },
> {
    _buf: Buf<U, SEP_OPT>,
    _unit: PhantomData<U>,
}

impl<U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8>
    Path<U, KIND, SEP_OPT, CHECK>
{
    pub fn init() -> Self {
        // match BufType::Pool
        Self {
            _buf: Buf {
                pooled: ManuallyDrop::new(U::pool_get()),
                len: 0,
            },
            _unit: PhantomData,
        }
    }

    // `deinit` → impl Drop (below). Body returns the buffer to the pool.

    /// `move` — transfers ownership; in Rust this is just by-value move, but kept
    /// for call-site parity with the Zig (`const moved = this.move();`).
    #[inline]
    pub fn move_(self) -> Self {
        self
    }

    pub fn init_top_level_dir() -> Self {
        debug_assert!(crate::fs::FileSystem::instance_loaded());
        let top_level_dir = crate::fs::FileSystem::instance().top_level_dir();

        let trimmed = match Kind::from_u8(KIND) {
            Kind::Abs => {
                debug_assert!(is_input_absolute(top_level_dir));
                trim_input(TrimInputKind::Abs, top_level_dir)
            }
            // Zig: @compileError("cannot create a relative path from top_level_dir")
            Kind::Rel => panic!("cannot create a relative path from top_level_dir"),
            Kind::Any => trim_input(TrimInputKind::Abs, top_level_dir),
        };

        let mut this = Self::init();
        // TODO(port): top_level_dir is &[u8]; when U == u16 this should route through
        // append_other. See note on `append_input` below.
        this._buf_append_input(trimmed, false);
        this
    }

    pub fn init_top_level_dir_long_path() -> Self {
        debug_assert!(crate::fs::FileSystem::instance_loaded());
        let top_level_dir = crate::fs::FileSystem::instance().top_level_dir();

        let trimmed = match Kind::from_u8(KIND) {
            Kind::Abs => {
                debug_assert!(is_input_absolute(top_level_dir));
                trim_input(TrimInputKind::Abs, top_level_dir)
            }
            Kind::Rel => panic!("cannot create a relative path from top_level_dir"),
            Kind::Any => trim_input(TrimInputKind::Abs, top_level_dir),
        };

        let mut this = Self::init();

        #[cfg(windows)]
        {
            // TODO(port): pick long_path_prefix vs long_path_prefix_u8 based on U.
            this._buf_append_input(crate::windows::long_path_prefix_for::<U>(), false);
        }

        this._buf_append_input(trimmed, false);

        this
    }

    pub fn init_fd_path(fd: Fd) -> Result<Self, bun_core::Error> {
        match Kind::from_u8(KIND) {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot create a relative path from getFdPath"),
            Kind::Any => {}
        }

        // `getFdPath`/`getFdPathW` are libc/kernel32-only, so the bodies live
        // in `bun_core::fd_path_raw[_w]` (T0). >0 = units written, <0 = error.
        // PORT NOTE: Zig `fd.getFdPath(this._buf.pooled)` dispatches on the
        // pooled buffer's element type (u8 → readlink/F_GETPATH, u16 →
        // GetFinalPathNameByHandleW). Rust monomorphizes eagerly, so we
        // TypeId-dispatch on the buffer element type.
        use core::any::TypeId;
        let mut this = Self::init();

        if TypeId::of::<U>() == TypeId::of::<u8>() {
            let buf: &mut [u8] = U::id_u8_mut(U::buffer_as_mut_slice(&mut this._buf.pooled));

            // Zig spec (`bun.getFdPath` with `*PathBuffer`): on Windows the
            // u8 path still resolves via `GetFinalPathNameByHandleW` into a
            // stack `WPathBuffer`, then transcodes to UTF-8 with
            // `strings.copyUTF16IntoUTF8`. `fd_path_raw` has no Windows arm
            // (returns 0), so route through the wide call here.
            #[cfg(windows)]
            {
                let mut wbuf = crate::w_path_buffer_pool::get();
                let wslice: &mut [u16] = wbuf.as_mut_slice();
                // SAFETY: wslice is valid for wslice.len() writable u16 units.
                let n = unsafe { bun_core::fd_path_raw_w(fd, wslice.as_mut_ptr(), wslice.len()) };
                if n <= 0 {
                    // Zig `bun.windows.GetFinalPathNameByHandle` surfaces
                    // `error.FileNotFound` (return_length==0) or
                    // `error.NameTooLong` (return_length>=buf.len);
                    // `fd_path_raw_w` collapses both to -1, so propagate the
                    // dominant Zig error rather than inventing EBADF.
                    // TODO(port): have `fd_path_raw_w` distinguish overflow
                    // (e.g. -2) so callers can map ENAMETOOLONG separately.
                    return Err(bun_core::Error::intern("FileNotFound"));
                }
                let wide = &wslice[..n as usize];
                let written = strings::convert_utf16_to_utf8_in_buffer(buf, wide).len();
                let raw = &buf[..written];
                let trimmed = trim_input(TrimInputKind::Abs, raw);
                this._buf.len = trimmed.len();
                return Ok(this);
            }

            #[cfg(not(windows))]
            {
                // SAFETY: buf is valid for buf.len() writable bytes.
                let n = unsafe { bun_core::fd_path_raw(fd, buf.as_mut_ptr(), buf.len()) };
                // `fd_path_raw` returns 0 on misc failure — do not swallow as
                // an empty path; Zig `try fd.getFdPath(...)` propagates errors.
                if n <= 0 {
                    return Err(bun_core::Error::from_errno(9)); // EBADF — fd_path_raw surfaces no errno
                }
                let raw = &buf[..n as usize];
                let trimmed = trim_input(TrimInputKind::Abs, raw);
                this._buf.len = trimmed.len();
            }
        } else {
            // U == u16 → getFdPathW (Windows GetFinalPathNameByHandleW).
            let buf: &mut [u16] = U::id_u16_mut(U::buffer_as_mut_slice(&mut this._buf.pooled));

            // SAFETY: buf is valid for buf.len() writable u16 units.
            let n = unsafe { bun_core::fd_path_raw_w(fd, buf.as_mut_ptr(), buf.len()) };
            if n <= 0 {
                // Zig `bun.windows.GetFinalPathNameByHandle` surfaces
                // `error.FileNotFound` / `error.NameTooLong`; `fd_path_raw_w`
                // collapses both to -1, so propagate the dominant Zig error
                // rather than inventing EBADF.
                return Err(bun_core::Error::intern("FileNotFound"));
            }
            let raw = &buf[..n as usize];
            let trimmed = trim_input(TrimInputKind::Abs, raw);
            this._buf.len = trimmed.len();
        }
        Ok(this)
    }

    pub fn from_long_path<C: PathUnit>(input: &[C]) -> options::Result<Self> {
        // Zig restricts @TypeOf(input) to u8/u16 slices; the `C: PathUnit` bound enforces that.
        let trimmed = match Kind::from_u8(KIND) {
            Kind::Abs => {
                debug_assert!(is_input_absolute(input));
                trim_input(TrimInputKind::Abs, input)
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));
                trim_input(TrimInputKind::Rel, input)
            }
            Kind::Any => trim_input(
                if is_input_absolute(input) {
                    TrimInputKind::Abs
                } else {
                    TrimInputKind::Rel
                },
                input,
            ),
        };

        if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
            if trimmed.len() >= U::MAX_PATH {
                return Err(PathError::MaxPathExceeded);
            }
        }

        let mut this = Self::init();
        #[cfg(windows)]
        {
            this._buf_append_input(crate::windows::long_path_prefix_for::<U>(), false);
        }

        this._buf_append_input(trimmed, false);
        Ok(this)
    }

    pub fn from<C: PathUnit>(input: &[C]) -> options::Result<Self> {
        let trimmed = match Kind::from_u8(KIND) {
            Kind::Abs => {
                debug_assert!(is_input_absolute(input));
                trim_input(TrimInputKind::Abs, input)
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));
                trim_input(TrimInputKind::Rel, input)
            }
            Kind::Any => trim_input(
                if is_input_absolute(input) {
                    TrimInputKind::Abs
                } else {
                    TrimInputKind::Rel
                },
                input,
            ),
        };

        if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
            if trimmed.len() >= U::MAX_PATH {
                return Err(PathError::MaxPathExceeded);
            }
        }

        let mut this = Self::init();
        this._buf_append_input(trimmed, false);
        Ok(this)
    }

    pub fn is_absolute(&self) -> bool {
        match Kind::from_u8(KIND) {
            // Zig: @compileError — Rust can't compile-error on a const-generic value
            // without specialization; debug-panic instead.
            Kind::Abs => panic!("already known to be absolute"),
            Kind::Rel => panic!("already known to not be absolute"),
            Kind::Any => is_input_absolute(self.slice()),
        }
    }

    pub fn basename(&self) -> &[U] {
        basename_generic(self.slice())
    }

    pub fn basename_z(&mut self) -> &U::ZSlice {
        // PORT NOTE: reshaped for borrowck (Zig took *const and wrote NUL via @constCast).
        let len = self._buf.len;
        let buf = U::buffer_as_mut_slice(&mut self._buf.pooled);
        buf[len] = U::from_u8(0);
        let base_len = basename_generic(&buf[..len]).len();
        // Mirror Zig `full[full.len - base.len ..][0..base.len :0]` exactly:
        // index from the END of `buf[..len]`, not from `base.as_ptr()`, so that
        // when `base_len == 0` the result points at `buf[len]` (the NUL just
        // written) and the sentinel invariant holds.
        // SAFETY: `base_len <= len`, `buf[len] == 0`, and `buf` outlives the
        // returned borrow.
        unsafe { U::zslice_from_raw(buf.as_ptr().add(len - base_len), base_len) }
    }

    pub fn dirname(&self) -> Option<&[U]> {
        dirname_generic(self.slice())
    }

    pub fn slice(&self) -> &[U] {
        // match BufType::Pool
        &U::buffer_as_slice(&self._buf.pooled)[..self._buf.len]
    }

    /// Reinterpret this path under a different `SEP_OPT` const parameter.
    /// Zig's `bun.Path(.{ .sep = .auto })` and `bun.Path(.{})` are
    /// structurally identical at runtime — the option only affects how
    /// `append`/`append_join` normalize separators going forward — so
    /// passing a built path to a callee typed with a different `sep`
    /// option is sound. Rust's const-generic monomorphization makes them
    /// nominally distinct, hence this explicit conversion.
    #[inline]
    pub fn into_sep<const NEW_SEP: u8>(self) -> Path<U, KIND, NEW_SEP, CHECK> {
        // Explicit field move (not `transmute`): `Path`/`Buf` are `repr(Rust)`, so
        // Rust gives no layout-compat guarantee between distinct const-generic
        // instantiations. Rebuilding field-by-field is layout-agnostic and
        // optimizes to the same no-op move.
        let mut this = ManuallyDrop::new(self);
        let len = this._buf.len;
        // SAFETY: `pooled` was initialized in `init()` and is taken exactly once
        // here; `this` is wrapped in `ManuallyDrop` so `Path::drop` will not run
        // and observe the now-uninitialized field.
        let pooled = unsafe { ManuallyDrop::take(&mut this._buf.pooled) };
        Path {
            _buf: Buf {
                pooled: ManuallyDrop::new(pooled),
                len,
            },
            _unit: PhantomData,
        }
    }

    pub fn slice_z(&mut self) -> &U::ZSlice {
        // match BufType::Pool
        // PORT NOTE: reshaped for borrowck (Zig took *const and wrote NUL via @constCast).
        let len = self._buf.len;
        let buf = U::buffer_as_mut_slice(&mut self._buf.pooled);
        buf[len] = U::from_u8(0);
        // SAFETY: buf[len] == 0 written above; buf outlives the returned borrow.
        unsafe { U::zslice_from_raw(buf.as_ptr(), len) }
    }

    pub fn buf(&mut self) -> &mut [U] {
        // match BufType::Pool
        // PORT NOTE: reshaped for borrowck (Zig took *const and handed out a mutable slice).
        U::buffer_as_mut_slice(&mut self._buf.pooled)
    }

    pub fn set_length(&mut self, new_length: usize) {
        self._buf.set_length(new_length);

        let trimmed_len = match Kind::from_u8(KIND) {
            Kind::Abs => trim_input(TrimInputKind::Abs, self.slice()).len(),
            Kind::Rel => trim_input(TrimInputKind::Rel, self.slice()).len(),
            Kind::Any => {
                if self.is_absolute() {
                    trim_input(TrimInputKind::Abs, self.slice()).len()
                } else {
                    trim_input(TrimInputKind::Rel, self.slice()).len()
                }
            }
        };

        self._buf.set_length(trimmed_len);
    }

    #[inline]
    pub fn len(&self) -> usize {
        // match BufType::Pool
        self._buf.len
    }

    pub fn clone(&self) -> Self {
        // match BufType::Pool
        let mut cloned = Self::init();
        let len = self._buf.len;
        U::buffer_as_mut_slice(&mut cloned._buf.pooled)[..len]
            .copy_from_slice(&U::buffer_as_slice(&self._buf.pooled)[..len]);
        cloned._buf.len = len;
        cloned
    }

    #[inline]
    pub fn clear(&mut self) {
        self._buf.set_length(0);
    }

    pub fn append<C: PathUnit>(&mut self, input: &[C]) -> options::Result<()> {
        let needs_sep = self.len() > 0
            && match PathSeparators::from_u8(SEP_OPT) {
                PathSeparators::Any => {
                    let last = self.slice()[self.len() - 1];
                    !(last.eq_ascii(b'/') || last.eq_ascii(b'\\'))
                }
                _ => {
                    !self.slice()[self.len() - 1].eq_ascii(PathSeparators::from_u8(SEP_OPT).char())
                }
            };

        match Kind::from_u8(KIND) {
            Kind::Abs => {
                let has_root = self.len() > 0;

                if cfg!(debug_assertions) {
                    if has_root {
                        debug_assert!(!is_input_absolute(input));
                    } else {
                        debug_assert!(is_input_absolute(input));
                    }
                }

                let trimmed = trim_input(
                    if has_root {
                        TrimInputKind::Rel
                    } else {
                        TrimInputKind::Abs
                    },
                    input,
                );

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
            Kind::Rel => {
                debug_assert!(!is_input_absolute(input));

                let trimmed = trim_input(TrimInputKind::Rel, input);

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
            Kind::Any => {
                let input_is_absolute = is_input_absolute(input);

                if cfg!(debug_assertions) {
                    if needs_sep {
                        debug_assert!(!input_is_absolute);
                    }
                }

                let trimmed = trim_input(
                    if self.len() > 0 {
                        // anything appended to an existing path should be trimmed
                        // as a relative path
                        TrimInputKind::Rel
                    } else if is_input_absolute(input) {
                        // path is empty, trim based on input
                        TrimInputKind::Abs
                    } else {
                        TrimInputKind::Rel
                    },
                    input,
                );

                if trimmed.is_empty() {
                    return Ok(());
                }

                if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
                    if self.len() + trimmed.len() + (needs_sep as usize) >= U::MAX_PATH {
                        return Err(PathError::MaxPathExceeded);
                    }
                }

                self._buf_append_input(trimmed, needs_sep);
            }
        }
        Ok(())
    }

    pub fn append_fmt(&mut self, args: core::fmt::Arguments<'_>) -> options::Result<()> {
        // TODO: there's probably a better way to do this. needed for trimming slashes
        let mut temp: Path<u8, { Kind::ANY }, { PathSeparators::ANY }> = Path::init();

        // match BufType::Pool
        let input = {
            use std::io::Write;
            let buf = u8::buffer_as_mut_slice(&mut temp._buf.pooled);
            let mut cursor: &mut [u8] = buf;
            let total = cursor.len();
            match cursor.write_fmt(args) {
                Ok(()) => {
                    let written = total - cursor.len();
                    &u8::buffer_as_slice(&temp._buf.pooled)[..written]
                }
                Err(_) => {
                    if CheckLength::from_u8(CHECK) == CheckLength::CheckForGreaterThanMaxPath {
                        return Err(PathError::MaxPathExceeded);
                    }
                    unreachable!();
                }
            }
        };

        self.append(input)
    }

    pub fn join(&mut self, parts: &[&[U]]) -> options::Result<()> {
        // TODO(port): Zig @compileError when unit == u16; enforced here at runtime.
        if core::any::TypeId::of::<U>() == core::any::TypeId::of::<u16>() {
            panic!("unsupported unit type");
        }

        match Kind::from_u8(KIND) {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot join with relative path"),
            Kind::Any => {
                debug_assert!(self.is_absolute());
            }
        }

        let cloned = self.clone();

        // match BufType::Pool
        {
            let pooled: &mut [u8] = U::id_u8_mut(U::buffer_as_mut_slice(&mut self._buf.pooled));
            let cloned_slice: &[u8] = U::id_u8(cloned.slice());
            // TypeId check above proves U == u8; trait-dispatched identity (no
            // `unsafe`) — the u8 impl is `fn(s) { s }`, the u16 default is
            // `unreachable!()` and is const-folded out in this monomorphisation.
            let parts_u8: &[&[u8]] = U::id_u8_slices(parts);
            let joined = sep_dispatch!(join_abs_string_buf(cloned_slice, pooled, parts_u8));

            let trimmed = trim_input(TrimInputKind::Abs, joined);
            self._buf.len = trimmed.len();
        }
        Ok(())
    }

    pub fn append_join<C: PathUnit>(&mut self, part: &[C]) -> options::Result<()> {
        match Kind::from_u8(KIND) {
            Kind::Abs => {}
            Kind::Rel => panic!("cannot join with relative path"),
            Kind::Any => {
                debug_assert!(self.is_absolute());
            }
        }

        // TODO(port): the Zig dispatches on `@TypeOf(part)` × `opts.pathUnit()` to pick
        // joinStringBuf vs joinStringBufW vs a transcode-then-recurse path. Rust cannot
        // match on type identity in a fn body without specialization. The four arms are
        // reproduced below via TypeId checks; Phase B should replace with a sealed-trait
        // dispatch on (C, U).
        use core::any::TypeId;
        let c_is_u8 = TypeId::of::<C>() == TypeId::of::<u8>();
        let u_is_u8 = TypeId::of::<U>() == TypeId::of::<u8>();

        match (c_is_u8, u_is_u8) {
            (true, true) => {
                // part: &[u8], unit: u8
                let mut cwd_path_buf = crate::path_buffer_pool::get();
                // RAII guard puts back on Drop.
                let current_slice: &[u8] = U::id_u8(self.slice());
                let cwd_path = &mut cwd_path_buf[..current_slice.len()];
                cwd_path.copy_from_slice(current_slice);

                let pooled: &mut [u8] = U::id_u8_mut(U::buffer_as_mut_slice(&mut self._buf.pooled));
                let part_u8: &[u8] = C::id_u8(part);
                let joined = sep_dispatch!(join_string_buf(pooled, &[cwd_path, part_u8]));

                let trimmed = trim_input(TrimInputKind::Abs, joined);
                self._buf.len = trimmed.len();
            }
            (true, false) => {
                // part: &[u8], unit: u16 → transcode then recurse
                let mut path_buf = crate::w_path_buffer_pool::get();
                let part_u8: &[u8] = C::id_u8(part);
                let converted =
                    strings::convert_utf8_to_utf16_in_buffer(&mut path_buf[..], part_u8);
                // Zig recurses on `appendJoin(converted)`.
                return self.append_join::<u16>(converted);
            }
            (false, false) => {
                // part: &[u16], unit: u16
                let mut cwd_path_buf = crate::w_path_buffer_pool::get();
                let current_slice: &[u16] = U::id_u16(self.slice());
                let cwd_path = &mut cwd_path_buf[..current_slice.len()];
                cwd_path.copy_from_slice(current_slice);

                let pooled: &mut [u16] =
                    U::id_u16_mut(U::buffer_as_mut_slice(&mut self._buf.pooled));
                let part_u16: &[u16] = C::id_u16(part);
                let joined = sep_dispatch!(join_string_buf_w_same(pooled, &[cwd_path, part_u16]));
                let trimmed = trim_input(TrimInputKind::Abs, joined);
                self._buf.len = trimmed.len();
            }
            (false, true) => {
                // part: &[u16], unit: u8 → transcode then recurse
                let mut path_buf = crate::path_buffer_pool::get();
                let part_u16: &[u16] = C::id_u16(part);
                let converted =
                    strings::convert_utf16_to_utf8_in_buffer(&mut path_buf[..], part_u16);
                return self.append_join::<u8>(converted);
            }
        }
        Ok(())
    }

    pub fn relative<const K2: u8>(
        &self,
        to: &Path<U, K2, SEP_OPT, CHECK>,
    ) -> RelPath<U, SEP_OPT, CHECK> {
        // PORT NOTE: `resolve_path::relative_buf_z` is `&[u8]`-only and the Zig
        // had no u16 variant either — Path.zig `relative` calls `relativeBufZ`
        // unconditionally, which would compile-error on a u16 instantiation
        // (Zig's lazy eval hides that). Rust monomorphizes eagerly, so we
        // TypeId-dispatch: u8 → identity-cast and call; u16 → transcode through
        // temp u8 buffers and back. TODO(port): width-generic
        // `relative_buf_z_t<C>` if u16 callers turn out to be hot.
        use core::any::TypeId;
        let mut output: RelPath<U, SEP_OPT, CHECK> = Path::init();

        if TypeId::of::<U>() == TypeId::of::<u8>() {
            let pooled: &mut [u8] = U::id_u8_mut(U::buffer_as_mut_slice(&mut output._buf.pooled));
            let from_u8: &[u8] = U::id_u8(self.slice());
            let to_u8: &[u8] = U::id_u8(to.slice());
            let rel = path::relative_buf_z(pooled, from_u8, to_u8);
            let trimmed = trim_input(TrimInputKind::Rel, rel.as_bytes());
            output._buf.len = trimmed.len();
        } else {
            // U == u16: transcode from/to → u8 scratch buffers, compute the
            // relative path in u8-space, then transcode back into the u16
            // output buffer. Mirrors the cross-width arms in `append_join`.
            // PERF(port): three pooled buffers + two transcodes — profile in
            // Phase B; only ever reached on Windows wide-path callers.
            let from_u16: &[u16] = U::id_u16(self.slice());
            let to_u16: &[u16] = U::id_u16(to.slice());

            let mut from_buf = crate::path_buffer_pool::get();
            let mut to_buf = crate::path_buffer_pool::get();
            let mut rel_buf = crate::path_buffer_pool::get();

            let from_u8 = strings::convert_utf16_to_utf8_in_buffer(&mut from_buf[..], from_u16);
            let to_u8 = strings::convert_utf16_to_utf8_in_buffer(&mut to_buf[..], to_u16);

            let rel = path::relative_buf_z(&mut rel_buf[..], from_u8, to_u8);
            let trimmed = trim_input(TrimInputKind::Rel, rel.as_bytes());

            let pooled: &mut [u16] = U::id_u16_mut(U::buffer_as_mut_slice(&mut output._buf.pooled));
            let converted = strings::convert_utf8_to_utf16_in_buffer(pooled, trimmed);
            output._buf.len = converted.len();
        }
        output
    }

    pub fn undo(&mut self, n_components: usize) {
        let min_len = match Kind::from_u8(KIND) {
            Kind::Abs => root_len(self.slice()).unwrap_or(0),
            Kind::Rel => 0,
            Kind::Any => {
                if self.is_absolute() {
                    root_len(self.slice()).unwrap_or(0)
                } else {
                    0
                }
            }
        };

        let mut i: usize = 0;
        while i < n_components {
            let slash = match PathSeparators::from_u8(SEP_OPT) {
                PathSeparators::Any => self
                    .slice()
                    .iter()
                    .rposition(|c| c.eq_ascii(SEP_POSIX) || c.eq_ascii(SEP_WINDOWS)),
                PathSeparators::Auto => self.slice().iter().rposition(|c| c.eq_ascii(SEP)),
                PathSeparators::Posix => self.slice().iter().rposition(|c| c.eq_ascii(SEP_POSIX)),
                PathSeparators::Windows => {
                    self.slice().iter().rposition(|c| c.eq_ascii(SEP_WINDOWS))
                }
            };
            let Some(slash) = slash else {
                self._buf.set_length(min_len);
                return;
            };

            if slash < min_len {
                self._buf.set_length(min_len);
                return;
            }

            self._buf.set_length(slash);
            i += 1;
        }
    }

    pub fn save(&mut self) -> ResetScope<'_, U, KIND, SEP_OPT, CHECK> {
        let saved_len = self.len();
        ResetScope {
            path: self,
            saved_len,
        }
    }

    // ── private helpers ──────────────────────────────────────────────────

    /// Dispatch `Buf::append` / `Buf::append_other` based on whether the input
    /// element type matches `U`. Stands in for Zig's `anytype` + `inputChildType`.
    fn _buf_append_input<C: PathUnit>(&mut self, characters: &[C], add_separator: bool) {
        use core::any::TypeId;
        // Route via concrete `u8`/`u16` using the safe trait-dispatched
        // identity casts (`id_u8`/`id_from_u8` etc.) — each is the literal
        // identity in its monomorphized impl and `unreachable!()` otherwise,
        // so no `from_raw_parts` is needed for the generic→generic reslice.
        if TypeId::of::<C>() == TypeId::of::<u8>() {
            let bytes = C::id_u8(characters);
            if TypeId::of::<U>() == TypeId::of::<u8>() {
                self._buf.append(U::id_from_u8(bytes), add_separator);
            } else {
                self._buf
                    .append_other(<U::Other>::id_from_u8(bytes), add_separator);
            }
        } else {
            let words = C::id_u16(characters);
            if TypeId::of::<U>() == TypeId::of::<u16>() {
                self._buf.append(U::id_from_u16(words), add_separator);
            } else {
                self._buf
                    .append_other(<U::Other>::id_from_u16(words), add_separator);
            }
        }
    }
}

impl<U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8> Drop
    for Path<U, KIND, SEP_OPT, CHECK>
{
    fn drop(&mut self) {
        // match BufType::Pool
        // SAFETY: `pooled` is initialized in `init()` and never taken before this; Drop runs once.
        let pooled = unsafe { ManuallyDrop::take(&mut self._buf.pooled) };
        U::pool_put(pooled);
        // TODO(port): replace Box<Buffer> + manual put-back with the
        // `crate::path_buffer_pool()` RAII guard once it is generic over
        // unit, then delete this Drop impl entirely.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ResetScope
// ──────────────────────────────────────────────────────────────────────────

pub struct ResetScope<'a, U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8> {
    // LIFETIMES.tsv: BORROW_PARAM → &'a mut Path
    path: &'a mut Path<U, KIND, SEP_OPT, CHECK>,
    saved_len: usize,
}

impl<'a, U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8>
    ResetScope<'a, U, KIND, SEP_OPT, CHECK>
{
    /// Explicit early restore. The guard also restores on `Drop`, so this is
    /// only needed when you want to truncate before the guard goes out of
    /// scope (Zig callers wrote `save.restore()` mid-block).
    pub fn restore(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig takes `*const ResetScope` and
        // mutates through the stored `*Path`; in Rust the reborrow is `&mut self`.
        self.path._buf.set_length(self.saved_len);
    }
}

impl<'a, U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8> core::ops::Deref
    for ResetScope<'a, U, KIND, SEP_OPT, CHECK>
{
    type Target = Path<U, KIND, SEP_OPT, CHECK>;
    fn deref(&self) -> &Self::Target {
        self.path
    }
}

impl<'a, U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8> core::ops::DerefMut
    for ResetScope<'a, U, KIND, SEP_OPT, CHECK>
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.path
    }
}

impl<'a, U: PathUnit, const KIND: u8, const SEP_OPT: u8, const CHECK: u8> Drop
    for ResetScope<'a, U, KIND, SEP_OPT, CHECK>
{
    /// Mirrors Zig `defer save.restore()` — truncate the path back to its
    /// length at `save()` time on every scope exit (including `?` early
    /// returns).
    fn drop(&mut self) {
        self.path._buf.set_length(self.saved_len);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free functions (were nested in `Path(opts)` but don't depend on opts beyond
// the input element type, so they're hoisted to generics over `C: PathUnit`)
// ──────────────────────────────────────────────────────────────────────────

pub fn root_len<C: PathUnit>(input: &[C]) -> Option<usize> {
    #[cfg(windows)]
    {
        if input.len() > 2
            && input[1].eq_ascii(b':')
            && (input[2].eq_ascii(b'/') || input[2].eq_ascii(b'\\'))
        {
            // ('a' <= letter and letter <= 'z') or ('A' <= letter and letter <= 'Z')
            if let Some(l) = input[0].to_ascii() {
                if (b'a'..=b'z').contains(&l) || (b'A'..=b'Z').contains(&l) {
                    // C:\
                    return Some(3);
                }
            }
        }

        if input.len() > 5
            && (input[0].eq_ascii(b'/') || input[0].eq_ascii(b'\\'))
            && (input[1].eq_ascii(b'/') || input[1].eq_ascii(b'\\'))
            && !(input[2].eq_ascii(b'\\') || input[2].eq_ascii(b'.'))
        {
            let mut i: usize = 3;
            // \\network\share\
            //   ^
            while i < input.len() && !(input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\')) {
                i += 1;
            }

            i += 1;
            // \\network\share\
            //           ^
            let start = i;
            while i < input.len() && !(input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\')) {
                i += 1;
            }

            if start != i
                && i < input.len()
                && (input[i].eq_ascii(b'/') || input[i].eq_ascii(b'\\'))
            {
                // \\network\share\
                //                ^
                if i + 1 < input.len() {
                    return Some(i + 1);
                }
                return Some(i);
            }
        }

        if !input.is_empty() && (input[0].eq_ascii(b'/') || input[0].eq_ascii(b'\\')) {
            // \
            return Some(1);
        }

        return None;
    }

    #[cfg(not(windows))]
    {
        if !input.is_empty() && input[0].eq_ascii(b'/') {
            // /
            return Some(1);
        }

        None
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TrimInputKind {
    Abs,
    Rel,
}

fn trim_input<C: PathUnit>(kind: TrimInputKind, input: &[C]) -> &[C] {
    let mut trimmed: &[C] = input;

    #[cfg(windows)]
    {
        match kind {
            TrimInputKind::Abs => {
                let root = root_len(input).unwrap_or(0);
                while trimmed.len() > root
                    && (trimmed[trimmed.len() - 1].eq_ascii(b'/')
                        || trimmed[trimmed.len() - 1].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
            TrimInputKind::Rel => {
                if trimmed.len() > 1 && trimmed[0].eq_ascii(b'.') {
                    let c = trimmed[1];
                    if c.eq_ascii(b'/') || c.eq_ascii(b'\\') {
                        trimmed = &trimmed[2..];
                    }
                }
                while !trimmed.is_empty()
                    && (trimmed[0].eq_ascii(b'/') || trimmed[0].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[1..];
                }
                while !trimmed.is_empty()
                    && (trimmed[trimmed.len() - 1].eq_ascii(b'/')
                        || trimmed[trimmed.len() - 1].eq_ascii(b'\\'))
                {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
        }

        return trimmed;
    }

    #[cfg(not(windows))]
    {
        match kind {
            TrimInputKind::Abs => {
                let root = root_len(input).unwrap_or(0);
                while trimmed.len() > root && trimmed[trimmed.len() - 1].eq_ascii(b'/') {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
            TrimInputKind::Rel => {
                if trimmed.len() > 1 && trimmed[0].eq_ascii(b'.') && trimmed[1].eq_ascii(b'/') {
                    trimmed = &trimmed[2..];
                }
                while !trimmed.is_empty() && trimmed[0].eq_ascii(b'/') {
                    trimmed = &trimmed[1..];
                }

                while !trimmed.is_empty() && trimmed[trimmed.len() - 1].eq_ascii(b'/') {
                    trimmed = &trimmed[..trimmed.len() - 1];
                }
            }
        }

        trimmed
    }
}

fn is_input_absolute<C: PathUnit>(input: &[C]) -> bool {
    if input.is_empty() {
        return false;
    }

    if input[0].eq_ascii(b'/') {
        return true;
    }

    #[cfg(windows)]
    {
        if input[0].eq_ascii(b'\\') {
            return true;
        }

        if input.len() < 3 {
            return false;
        }

        if input[1].eq_ascii(b':') && (input[2].eq_ascii(b'/') || input[2].eq_ascii(b'\\')) {
            return true;
        }
    }

    false
}

// ported from: src/paths/Path.zig
