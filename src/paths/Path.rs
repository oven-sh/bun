//! Paths as types: borrowed views in one normal form, and [`PathBuf`], which builds one. See "Paths" in `src/CLAUDE.md`.

use core::fmt;
#[cfg(not(windows))]
use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};

use bun_core::{Fd, PathByte as _, WStr, ZStr, strings};
use bun_simdutf_sys::simdutf;

use crate::path_buffer_pool::PoolStorage;
use crate::resolve_path::{Platform, PlatformT};
use crate::{MAX_PATH_BYTES, PATH_MAX_WIDE, PathBuffer, SEP, WPathBuffer};

/// Not nameable outside this file, which seals the traits that need them.
mod private {
    pub trait Sealed {}
    pub struct Token(pub(super) ());

    /// Units that can be written from units of `C`. SAFETY: `transcode` writes at most `max_len(from)` units and returns how many.
    pub unsafe trait TranscodeFrom<C>: Sized {
        fn max_len(from: &[C]) -> usize;
        /// `None` if `from` has no form in these units. SAFETY: `to` is valid for writes of `max_len(from)` units and does not overlap `from`.
        unsafe fn transcode(from: &[C], to: *mut Self) -> Option<usize>;
    }
}
use private::{Token, TranscodeFrom};

/// A path code unit: `u8` (UTF-8/WTF-8 bytes) or `u16` (WTF-16, Windows).
pub trait PathUnit:
    crate::PathChar + TranscodeFrom<u8> + TranscodeFrom<u16> + private::Sealed
{
    /// The fixed-size buffer type (`PathBuffer` / `WPathBuffer`): an array of `MAX_PATH` units.
    type Buffer: PoolStorage;
    const MAX_PATH: usize;
    /// `[:0]const u8` → `ZStr`, `[:0]const u16` → `WStr` (length-carrying NUL-terminated slice).
    type ZSlice: ?Sized;

    /// Construct a borrowed NUL-terminated slice (`ZStr` / `WStr`) from a raw pointer + len.
    ///
    /// # Safety
    /// `ptr[..=len]` must be valid for reads for `'a`, and `ptr[len]` must be `0`.
    unsafe fn zslice_from_raw<'a>(ptr: *const Self, len: usize) -> &'a Self::ZSlice;

    /// `\\?\` in this unit.
    const LONG_PATH_PREFIX: &'static [Self];
}
impl private::Sealed for u8 {}
impl private::Sealed for u16 {}

impl PathUnit for u8 {
    type Buffer = PathBuffer;
    const MAX_PATH: usize = MAX_PATH_BYTES;
    type ZSlice = ZStr;
    const LONG_PATH_PREFIX: &'static [u8] = &crate::windows::LONG_PATH_PREFIX_U8;

    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        // SAFETY: caller of this `unsafe fn` upholds the trait contract that
        // `ptr[..=len]` is valid for reads for `'a` and `ptr[len] == 0`.
        unsafe { ZStr::from_raw(ptr, len) }
    }
}

impl PathUnit for u16 {
    type Buffer = WPathBuffer;
    const MAX_PATH: usize = PATH_MAX_WIDE;
    type ZSlice = WStr;
    const LONG_PATH_PREFIX: &'static [u16] = &crate::windows::LONG_PATH_PREFIX;

    #[inline]
    unsafe fn zslice_from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        // SAFETY: caller of this `unsafe fn` upholds the trait contract that
        // `ptr[..=len]` is valid for reads for `'a` and `ptr[len] == 0`.
        unsafe { WStr::from_raw(ptr, len) }
    }
}

// SAFETY: copies `from.len()` units.
unsafe impl<U: Copy> TranscodeFrom<U> for U {
    #[inline]
    fn max_len(from: &[U]) -> usize {
        from.len()
    }
    #[inline]
    unsafe fn transcode(from: &[U], to: *mut U) -> Option<usize> {
        // SAFETY: `to` is valid for `from.len()` writes and disjoint from `from`, per the contract.
        unsafe { core::ptr::copy_nonoverlapping(from.as_ptr(), to, from.len()) };
        Some(from.len())
    }
}
// SAFETY: no code point takes more UTF-16 units than UTF-8 bytes.
unsafe impl TranscodeFrom<u8> for u16 {
    #[inline]
    fn max_len(from: &[u8]) -> usize {
        from.len()
    }
    #[inline]
    unsafe fn transcode(from: &[u8], to: *mut u16) -> Option<usize> {
        // SAFETY: `to` is valid for `max_len(from)` writes, per the contract, and zeroed because the converter takes an initialized slice.
        let to = unsafe {
            core::ptr::write_bytes(to, 0, from.len());
            core::slice::from_raw_parts_mut(to, from.len())
        };
        Some(strings::convert_utf8_to_utf16_in_buffer(to, from).len())
    }
}
// SAFETY: no UTF-16 unit takes more than three UTF-8 bytes.
unsafe impl TranscodeFrom<u16> for u8 {
    #[inline]
    fn max_len(from: &[u16]) -> usize {
        from.len() * 3
    }
    #[inline]
    unsafe fn transcode(from: &[u16], to: *mut u8) -> Option<usize> {
        // SAFETY: `to` is valid for `max_len(from)` writes, per the contract, and zeroed because the converter takes an initialized slice.
        let to = unsafe {
            core::ptr::write_bytes(to, 0, from.len() * 3);
            core::slice::from_raw_parts_mut(to, from.len() * 3)
        };
        // Half of a surrogate pair is a name on Windows and is nothing in UTF-8.
        let result = simdutf::convert::utf16::to::utf8::with_errors::le(from, to);
        result.is_successful().then_some(result.count)
    }
}

/// Width-generic `bun.Dirname.dirname`.
/// Platform-split: POSIX considers only `/`; Windows adds
/// disk-designator handling.
pub(crate) fn dirname_generic<U: PathUnit>(path: &[U]) -> Option<&[U]> {
    #[cfg(not(windows))]
    return dirname_posix(path);
    #[cfg(windows)]
    return dirname_windows(path);
}

#[cfg(not(windows))]
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

#[cfg(windows)]
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
    // No alphabetic check on path[0].
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
    for this_sep in *b"/\\" {
        if path[0].eq_ascii(this_sep) && path[1].eq_ascii(this_sep) {
            if path[2].eq_ascii(this_sep) {
                return 0;
            }
            // Tokenize on `this_sep`: skip sep runs,
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

/// A native path, absolute or relative.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct Path<U = u8>([U]);

/// A native absolute path. It holds no `..`.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct AbsPath<U = u8>([U]);

/// A native relative path. `..` comes first, if at all. Empty means the base itself.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct RelPath<U = u8>([U]);

/// A native relative path with no `..`, so it stays below what it is appended to. Empty means the base itself.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct SubPath<U = u8>([U]);

/// One name in a directory.
#[repr(transparent)]
#[derive(PartialEq, Eq)]
pub struct FileName<U = u8>([U]);

/// A `V` with a NUL after its last unit, for a syscall.
#[repr(transparent)]
pub struct PathZ<V: ?Sized>(V);

/// A view that a [`PathBuf`] builds: every one but [`FileName`].
pub trait View: private::Sealed {
    type Unit: PathUnit;
    #[doc(hidden)]
    const MAY_BE_ABSOLUTE: bool;
    #[doc(hidden)]
    const MAY_BE_RELATIVE: bool;
    #[doc(hidden)]
    const MAY_START_WITH_DOT_DOT: bool;
    fn slice(&self) -> &[Self::Unit];
    #[doc(hidden)]
    fn from_slice_unchecked(units: &[Self::Unit], token: Token) -> &Self;
}

impl<U: PathUnit> View for Path<U> {
    type Unit = U;
    const MAY_BE_ABSOLUTE: bool = true;
    const MAY_BE_RELATIVE: bool = true;
    const MAY_START_WITH_DOT_DOT: bool = true;
    #[inline]
    fn slice(&self) -> &[U] {
        &self.0
    }
    #[inline]
    fn from_slice_unchecked(units: &[U], _: Token) -> &Self {
        Self::wrap(units)
    }
}

impl<U: PathUnit> View for AbsPath<U> {
    type Unit = U;
    const MAY_BE_ABSOLUTE: bool = true;
    const MAY_BE_RELATIVE: bool = false;
    const MAY_START_WITH_DOT_DOT: bool = false;
    #[inline]
    fn slice(&self) -> &[U] {
        &self.0
    }
    #[inline]
    fn from_slice_unchecked(units: &[U], _: Token) -> &Self {
        Self::wrap(units)
    }
}

impl<U: PathUnit> View for RelPath<U> {
    type Unit = U;
    const MAY_BE_ABSOLUTE: bool = false;
    const MAY_BE_RELATIVE: bool = true;
    const MAY_START_WITH_DOT_DOT: bool = true;
    #[inline]
    fn slice(&self) -> &[U] {
        &self.0
    }
    #[inline]
    fn from_slice_unchecked(units: &[U], _: Token) -> &Self {
        Self::wrap(units)
    }
}

impl<U: PathUnit> View for SubPath<U> {
    type Unit = U;
    const MAY_BE_ABSOLUTE: bool = false;
    const MAY_BE_RELATIVE: bool = true;
    const MAY_START_WITH_DOT_DOT: bool = false;
    #[inline]
    fn slice(&self) -> &[U] {
        &self.0
    }
    #[inline]
    fn from_slice_unchecked(units: &[U], _: Token) -> &Self {
        Self::wrap(units)
    }
}

impl<U> Deref for FileName<U> {
    type Target = SubPath<U>;
    #[inline]
    fn deref(&self) -> &SubPath<U> {
        SubPath::wrap(&self.0)
    }
}
impl<U> Deref for SubPath<U> {
    type Target = RelPath<U>;
    #[inline]
    fn deref(&self) -> &RelPath<U> {
        RelPath::wrap(&self.0)
    }
}
impl<U> Deref for RelPath<U> {
    type Target = Path<U>;
    #[inline]
    fn deref(&self) -> &Path<U> {
        Path::wrap(&self.0)
    }
}
impl<U> Deref for AbsPath<U> {
    type Target = Path<U>;
    #[inline]
    fn deref(&self) -> &Path<U> {
        Path::wrap(&self.0)
    }
}

macro_rules! impl_view {
    ($($name:ident),*) => {$(
        impl<U> private::Sealed for $name<U> {}
        impl<U> $name<U> {
            #[inline]
            const fn wrap(units: &[U]) -> &Self {
                // SAFETY: `repr(transparent)` over `[U]`.
                unsafe { &*(core::ptr::from_ref(units) as *const Self) }
            }
            #[inline]
            pub const fn slice(&self) -> &[U] {
                &self.0
            }
            #[inline]
            pub const fn len(&self) -> usize {
                self.0.len()
            }
            #[inline]
            pub const fn is_empty(&self) -> bool {
                self.0.is_empty()
            }
        }
        impl<U: PathUnit> PathZ<$name<U>> {
            #[inline]
            pub fn slice_z(&self) -> &U::ZSlice {
                // SAFETY: a `PathZ` is only made over units that a readable 0 follows.
                unsafe { U::zslice_from_raw(self.0.0.as_ptr(), self.0.0.len()) }
            }
            #[inline]
            pub fn as_path_z(&self) -> &PathZ<Path<U>> {
                // SAFETY: the same units, so the same NUL.
                unsafe { PathZ::wrap(Path::wrap(&self.0.0)) }
            }
        }
        impl fmt::Debug for $name<u8> {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Debug::fmt(bstr::BStr::new(&self.0), f)
            }
        }
        impl fmt::Display for $name<u8> {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Display::fmt(bstr::BStr::new(&self.0), f)
            }
        }
        impl<U: Copy> From<&$name<U>> for Box<$name<U>> {
            fn from(path: &$name<U>) -> Self {
                let units: Box<[U]> = Box::from(&path.0);
                // SAFETY: `repr(transparent)` over `[U]`.
                unsafe { Box::from_raw(Box::into_raw(units) as *mut $name<U>) }
            }
        }
    )*};
}
impl_view!(Path, AbsPath, RelPath, SubPath, FileName);

impl<V: ?Sized> PathZ<V> {
    /// SAFETY: the unit after the last one of `view` is readable for as long as `view`, and is 0.
    #[inline]
    const unsafe fn wrap(view: &V) -> &Self {
        // SAFETY: `repr(transparent)` over `V`.
        unsafe { &*(core::ptr::from_ref(view) as *const Self) }
    }
}
impl<V: ?Sized> Deref for PathZ<V> {
    type Target = V;
    #[inline]
    fn deref(&self) -> &V {
        &self.0
    }
}
impl<V: fmt::Debug + ?Sized> fmt::Debug for PathZ<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}
impl<V: fmt::Display + ?Sized> fmt::Display for PathZ<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// Only `SEP`: a view holds no other separator.
#[inline]
fn is_sep_exact<U: PathUnit>(c: U) -> bool {
    c.eq_ascii(SEP)
}

#[inline]
fn last_sep<U: PathUnit>(units: &[U]) -> Option<usize> {
    units.iter().rposition(|&c| is_sep_exact(c))
}

/// Units of the root `units` starts with; 0 for a relative path.
#[inline]
fn root_len<U: PathUnit>(units: &[U]) -> usize {
    #[cfg(not(windows))]
    {
        usize::from(units.first().is_some_and(|c| c.eq_ascii(b'/')))
    }
    #[cfg(windows)]
    {
        fully_qualified_root_len(units, is_sep_exact)
    }
}

/// [`windows_root_len`] of a root that names a drive or a share and ends in a separator, as in a view; else 0.
#[cfg(any(windows, test))]
#[inline]
fn fully_qualified_root_len<U: PathUnit>(units: &[U], is_sep: impl Fn(U) -> bool + Copy) -> usize {
    let root = windows_root_len(units, is_sep);
    if root > 1 && is_sep(units[root - 1]) {
        root
    } else {
        0
    }
}

/// `\\server\share`: how the OS writes the root of a share when it is the whole path.
#[cfg(windows)]
#[inline]
fn is_share_root_missing_sep<U: PathUnit>(units: &[U]) -> bool {
    units.len() > 1
        && windows_root_len(units, is_sep_exact) == units.len()
        && !is_sep_exact(units[units.len() - 1])
}

/// `units` with the prefix `dir` removed. A Windows root compares ASCII case-insensitively.
#[inline]
fn strip_prefix_units<'a, U: PathUnit>(units: &'a [U], dir: &[U]) -> Option<&'a [U]> {
    #[cfg(not(windows))]
    {
        units.strip_prefix(dir)
    }
    #[cfg(windows)]
    {
        let (dir_root, dir_below) = dir.split_at(root_len(dir));
        let (root, below) = units.split_at_checked(dir_root.len())?;
        let same = |(a, b): (&U, &U)| {
            a == b
                || (a.to_ascii().zip(b.to_ascii())).is_some_and(|(a, b)| a.eq_ignore_ascii_case(&b))
        };
        if !root.iter().zip(dir_root).all(same) {
            return None;
        }
        below.strip_prefix(dir_below)
    }
}

/// Units of the Windows root `units` starts with: `C:\`, `\\server\share\` (also `\\?\C:\`, `\\.\pipe\`), `\\?\UNC\server\share\`, or a lone `\`. 0 without one.
fn windows_root_len<U: PathUnit>(units: &[U], is_sep: impl Fn(U) -> bool) -> usize {
    match units {
        [letter, colon, sep, ..]
            if colon.eq_ascii(b':')
                && is_sep(*sep)
                && letter.to_ascii().is_some_and(|c| c.is_ascii_alphabetic()) =>
        {
            return 3;
        }
        [first, second, ..] if is_sep(*first) && is_sep(*second) => {}
        [first, ..] if is_sep(*first) => return 1,
        _ => return 0,
    }
    let mut names = 2;
    let mut end = 2;
    let mut seen = 0;
    while seen < names {
        let start = end;
        while end < units.len() && !is_sep(units[end]) {
            end += 1;
        }
        let name = &units[start..end];
        // What starts like a share and is not one is rooted at a lone separator.
        if name.is_empty() {
            return 1;
        }
        let is = |text: &[u8]| {
            name.len() == text.len()
                && (name.iter().zip(text))
                    .all(|(c, t)| c.to_ascii().is_some_and(|c| c.eq_ignore_ascii_case(t)))
        };
        if seen == 1 && units[2].eq_ascii(b'?') && start == 4 && is(b"UNC") {
            names = 4;
        }
        seen += 1;
        // The last separator of a share may be missing at the very end.
        if end == units.len() {
            return if seen == names { end } else { 1 };
        }
        end += 1;
    }
    end
}

#[cfg(windows)]
fn is_on_drive<U: PathUnit>(path: &[U], drive: u8) -> bool {
    matches!(path, [letter, colon, ..] if colon.eq_ascii(b':') && letter.to_ascii().is_some_and(|c| c.eq_ignore_ascii_case(&drive)))
}

#[inline]
fn is_dots<U: PathUnit>(name: &[U]) -> bool {
    matches!(name, [a] if a.eq_ascii(b'.')) || is_dot_dot(name)
}
#[inline]
fn is_dot_dot<U: PathUnit>(name: &[U]) -> bool {
    matches!(name, [a, b] if a.eq_ascii(b'.') && b.eq_ascii(b'.'))
}

/// A unit that no name on this host can hold. On Windows a `:` is only ever part of a root.
#[inline]
fn is_forbidden_in_name<U: PathUnit>(c: U) -> bool {
    c.eq_ascii(0) || c.eq_ascii(b'/') || (cfg!(windows) && (c.eq_ascii(b'\\') || c.eq_ascii(b':')))
}

/// Whether `units` is names joined by single `SEP`s and nothing else.
fn is_normalized_sub_path<U: PathUnit>(units: &[U]) -> bool {
    let mut start = 0;
    while start < units.len() {
        let mut end = start;
        while end < units.len() && !is_sep_exact(units[end]) {
            if is_forbidden_in_name(units[end]) {
                return false;
            }
            end += 1;
        }
        let name = &units[start..end];
        // A separator at the very end leaves no name after it.
        if name.is_empty() || is_dots(name) || end + 1 == units.len() {
            return false;
        }
        start = end + 1;
    }
    true
}

impl<U: PathUnit> Path<U> {
    #[inline]
    pub fn is_absolute(&self) -> bool {
        root_len(&self.0) > 0
    }

    /// `None` for a root, an empty path and one that ends in `..`.
    #[inline]
    pub fn dirname(&self) -> Option<&Self> {
        self.basename()?;
        let root = root_len(&self.0);
        let end = last_sep(&self.0[root..]).map_or(root, |i| root + i);
        Some(Self::wrap(&self.0[..end]))
    }

    /// `None` for a root, an empty path and one that ends in `..`.
    #[inline]
    pub fn basename(&self) -> Option<&FileName<U>> {
        let below = &self.0[root_len(&self.0)..];
        let name = match last_sep(below) {
            Some(i) => &below[i + 1..],
            None => below,
        };
        (!name.is_empty() && !is_dot_dot(name)).then(|| FileName::wrap(name))
    }
}

impl<U: PathUnit> AbsPath<U> {
    /// `None` unless `units` is absolute and already normalized.
    pub fn new(units: &[U]) -> Option<&Self> {
        let root = root_len(units);
        (root > 0 && is_normalized_sub_path(&units[root..])).then(|| Self::wrap(units))
    }

    /// For a path that is known to be normalized, such as one the OS returned. Only the root is checked: `None` without one.
    #[inline]
    pub fn new_unchecked(units: &[U]) -> Option<&Self> {
        let root = root_len(units);
        if root == 0 {
            return None;
        }
        let mut end = units.len();
        while end > root && is_sep_exact(units[end - 1]) {
            end -= 1;
        }
        debug_assert!(Self::new(&units[..end]).is_some());
        Some(Self::wrap(&units[..end]))
    }

    #[inline]
    pub fn is_root(&self) -> bool {
        self.0.len() == root_len(&self.0)
    }

    /// `None` for a root.
    #[inline]
    pub fn dirname(&self) -> Option<&Self> {
        (**self).dirname().map(|dir| Self::wrap(&dir.0))
    }

    /// What is left of this path below `dir`. `None` if it is neither `dir` nor below it.
    #[inline]
    pub fn strip_prefix(&self, dir: &Self) -> Option<&SubPath<U>> {
        let rest = strip_prefix_units(&self.0, &dir.0)?;
        match rest {
            [] => Some(SubPath::wrap(rest)),
            [first, below @ ..] if is_sep_exact(*first) => Some(SubPath::wrap(below)),
            _ if dir.is_root() => Some(SubPath::wrap(rest)),
            _ => None,
        }
    }

    /// The way from this directory to `to`. Fails as `ExpectedRelative` between two drives.
    pub fn relative(&self, to: &Self) -> PathBuf<RelPath<U>> {
        let mut out = PathBuf::<RelPath<U>>::init();
        let mut common = self;
        let below = loop {
            if let Some(below) = to.strip_prefix(common) {
                break below;
            }
            match common.dirname() {
                Some(dir) => common = dir,
                None => {
                    out.fail(PathError::ExpectedRelative);
                    return out;
                }
            }
            out.dot_dot();
        };
        out.append(below);
        out
    }
}

impl<U: PathUnit> SubPath<U> {
    /// `None` unless `units` is relative, holds no `..` and is already normalized.
    pub fn new(units: &[U]) -> Option<&Self> {
        (root_len(units) == 0 && is_normalized_sub_path(units)).then(|| Self::wrap(units))
    }

    /// For names the OS listed, joined with `SEP` by the code that listed them.
    #[inline]
    pub fn new_unchecked(units: &[U]) -> &Self {
        debug_assert!(Self::new(units).is_some());
        Self::wrap(units)
    }
}

impl<U: PathUnit> FileName<U> {
    /// `None` if `units` is empty, `.`, `..`, or holds a separator or a NUL.
    #[inline]
    pub fn new(units: &[U]) -> Option<&Self> {
        (!units.is_empty() && !is_dots(units) && !units.iter().any(|&c| is_forbidden_in_name(c)))
            .then(|| Self::wrap(units))
    }

    /// For a name the OS listed in a directory.
    #[inline]
    pub fn new_unchecked(units: &[U]) -> &Self {
        debug_assert!(Self::new(units).is_some());
        Self::wrap(units)
    }
}

const fn check_literal(native: &[u8]) {
    let mut start = 0;
    let mut i = 0;
    while i <= native.len() {
        if i == native.len() || native[i] == SEP {
            let len = i - start;
            assert!(len > 0, "empty name");
            assert!(!(len == 1 && native[start] == b'.'), "`.`");
            assert!(
                !(len == 2 && native[start] == b'.' && native[start + 1] == b'.'),
                "`..`"
            );
            start = i + 1;
        } else {
            assert!(native[i] != 0 && native[i] != b'/' && native[i] != b'\\' && native[i] != b':');
        }
        i += 1;
    }
}
impl SubPath {
    #[doc(hidden)]
    pub const fn from_literal(native: &'static ZStr) -> &'static PathZ<Self> {
        check_literal(native.as_bytes());
        // SAFETY: a NUL follows the bytes of a `ZStr`.
        unsafe { PathZ::wrap(Self::wrap(native.as_bytes())) }
    }
}
/// `&'static PathZ<SubPath>` from constant text written with `/`, checked at compile time.
#[macro_export]
macro_rules! sub_path {
    ($text:expr) => {{
        const PATH: &$crate::path::PathZ<$crate::path::SubPath> =
            $crate::path::SubPath::from_literal($crate::path_literal!($text));
        PATH
    }};
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum PathError {
    /// It does not fit a path buffer.
    #[error("MaxPathExceeded")]
    MaxPathExceeded,
    /// `..` led out of a `join_below`, a [`ResetScope`] or a `SubPath`, or the path was to be replaced inside a `ResetScope`.
    #[error("Escapes")]
    Escapes,
    /// Absolute, or on another drive, where only a relative path can go.
    #[error("ExpectedRelative")]
    ExpectedRelative,
    #[error("ExpectedAbsolute")]
    ExpectedAbsolute,
    /// Empty, `.` or `..` where names are wanted, or it holds a unit that no name on this host can.
    #[error("InvalidName")]
    InvalidName,
    /// An absolute path was never set.
    #[error("Unset")]
    Unset,
}

impl From<PathError> for bun_errno::SystemErrno {
    fn from(err: PathError) -> Self {
        match err {
            PathError::MaxPathExceeded => Self::ENAMETOOLONG,
            PathError::Escapes
            | PathError::ExpectedRelative
            | PathError::ExpectedAbsolute
            | PathError::InvalidName
            | PathError::Unset => Self::EINVAL,
        }
    }
}

/// What `..` does to a path that is no longer than its `base_len`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum DotDotAtBase {
    /// A root stays.
    Ignore,
    /// A relative path gets a `..`.
    Append,
    Fail,
}

/// What the parser does with `.`, `..` and an empty name.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Dots {
    Resolve,
    Reject,
}

/// On the stack and not initialized, except on Windows, where a path buffer is too large for the stack.
#[cfg(not(windows))]
type Buffer<U> = MaybeUninit<<U as PathUnit>::Buffer>;
#[cfg(windows)]
type Buffer<U> = crate::path_buffer_pool::PoolGuard<<U as PathUnit>::Buffer>;

/// Builds a `V` in a path buffer of its own. The first step that fails is kept, and `as_path`, the only way to the path, returns it.
pub struct PathBuf<V: View + ?Sized> {
    /// Less than `MAX_PATH`. While `err` is `None` the unit there is the NUL.
    len: usize,
    /// `..` removes nothing below this length, which is never more than `len`.
    base_len: usize,
    at_base: DotDotAtBase,
    /// A [`ResetScope`] is open, so the path cannot be replaced.
    in_scope: bool,
    err: Option<PathError>,
    buf: Buffer<V::Unit>,
}
pub type AbsPathBuf = PathBuf<AbsPath>;
pub type RelPathBuf = PathBuf<RelPath>;
pub type SubPathBuf = PathBuf<SubPath>;

impl<V: View + ?Sized> PathBuf<V> {
    /// Empty, which for an absolute `V` fails as `Unset` until a path is set.
    #[inline]
    pub fn init() -> Self {
        let mut this = Self {
            len: 0,
            base_len: 0,
            at_base: DotDotAtBase::Fail,
            in_scope: false,
            err: if V::MAY_BE_RELATIVE {
                None
            } else {
                Some(PathError::Unset)
            },
            #[cfg(not(windows))]
            buf: MaybeUninit::uninit(),
            #[cfg(windows)]
            buf: crate::path_buffer_pool::PathBufferPoolT::get(),
        };
        this.truncate(0);
        this.set_base_to_root();
        this
    }

    #[inline]
    pub fn from(path: &V) -> Self {
        let mut this = Self::init();
        this.set(path);
        this
    }

    /// [`from`](Self::from) an absolute path of either unit.
    #[inline]
    pub fn from_abs<C: PathUnit>(path: &AbsPath<C>) -> Self
    where
        V::Unit: TranscodeFrom<C>,
    {
        let mut this = Self::init();
        this.set_abs(path);
        this
    }

    /// Holds the absolute path that `fill`, a call to the OS, writes. It gets the whole buffer and returns the units written, without a NUL.
    pub fn from_fn<E>(fill: impl FnOnce(&mut [V::Unit]) -> Result<usize, E>) -> Result<Self, E> {
        let mut this = Self::init();
        #[cfg(not(windows))]
        {
            this.buf = MaybeUninit::zeroed();
        }
        // SAFETY: every unit of the buffer is initialized: just above, or by the pool.
        let len =
            fill(unsafe { core::slice::from_raw_parts_mut(this.ptr_mut(), V::Unit::MAX_PATH) })?;
        // No room left for the NUL also means the OS may have cut the path short.
        if len >= V::Unit::MAX_PATH {
            this.err = Some(PathError::MaxPathExceeded);
            return Ok(this);
        }
        this.len = len;
        this.err = None;
        this.finish_unchecked();
        Ok(this)
    }

    /// Replaces the whole path, and forgets an earlier failure.
    #[inline]
    pub fn set(&mut self, path: &V) -> &mut Self {
        self.replace(path.slice())
    }

    /// [`set`](Self::set) to an absolute path of either unit.
    #[inline]
    pub fn set_abs<C: PathUnit>(&mut self, path: &AbsPath<C>) -> &mut Self
    where
        V::Unit: TranscodeFrom<C>,
    {
        if !V::MAY_BE_ABSOLUTE {
            self.fail(PathError::ExpectedRelative);
            return self;
        }
        self.replace(path.slice())
    }

    /// [`set_abs`](Self::set_abs) to units as [`AbsPath::new_unchecked`] takes them. Fails as `ExpectedAbsolute` without a root.
    #[inline]
    pub fn set_unchecked<C: PathUnit>(&mut self, units: &[C]) -> &mut Self
    where
        V::Unit: TranscodeFrom<C>,
    {
        if !self.fail_if_in_scope() {
            self.replace(units).finish_unchecked();
        }
        self
    }

    /// Takes what is written, which came from the OS, as an absolute path: only its root and its end are looked at.
    fn finish_unchecked(&mut self) {
        #[cfg(windows)]
        if is_share_root_missing_sep(self.written()) {
            self.write_sep();
        }
        let root = root_len(self.written());
        let mut end = self.len;
        while end > root && is_sep_exact(self.written()[end - 1]) {
            end -= 1;
        }
        self.truncate(end);
        self.set_base_to_root();
        if root == 0 || !V::MAY_BE_ABSOLUTE {
            self.truncate(0);
            self.fail(if root == 0 {
                PathError::ExpectedAbsolute
            } else {
                PathError::ExpectedRelative
            });
        }
        debug_assert!(self.err.is_some() || AbsPath::new(self.written()).is_some());
    }

    #[inline]
    fn replace<C: PathUnit>(&mut self, normalized: &[C]) -> &mut Self
    where
        V::Unit: TranscodeFrom<C>,
    {
        if self.fail_if_in_scope() {
            return self;
        }
        self.err = None;
        self.len = 0;
        self.write(false, normalized);
        self.set_base_to_root();
        self
    }

    /// For what replaces the path.
    #[inline]
    fn fail_if_in_scope(&mut self) -> bool {
        if self.in_scope {
            self.fail(PathError::Escapes);
        }
        self.in_scope
    }

    #[inline]
    fn set_base_to_root(&mut self) {
        self.base_len = if V::MAY_BE_ABSOLUTE {
            root_len(self.written())
        } else {
            0
        };
        self.at_base = if self.base_len > 0 {
            DotDotAtBase::Ignore
        } else if V::MAY_START_WITH_DOT_DOT {
            DotDotAtBase::Append
        } else {
            DotDotAtBase::Fail
        };
    }

    /// Keeps `..` from what is written now, until what this returns is put back.
    #[inline]
    fn set_base_to_len(&mut self) -> SavedState {
        let saved = SavedState {
            len: self.len,
            base_len: self.base_len,
            at_base: self.at_base,
            in_scope: self.in_scope,
            err: self.err,
        };
        self.base_len = self.len;
        self.at_base = DotDotAtBase::Fail;
        saved
    }

    #[inline]
    fn ptr(&self) -> *const V::Unit {
        #[cfg(not(windows))]
        return self.buf.as_ptr().cast();
        #[cfg(windows)]
        return (&raw const *self.buf).cast();
    }

    #[inline]
    fn ptr_mut(&mut self) -> *mut V::Unit {
        #[cfg(not(windows))]
        return self.buf.as_mut_ptr().cast();
        #[cfg(windows)]
        return (&raw mut *self.buf).cast();
    }

    #[inline]
    fn written(&self) -> &[V::Unit] {
        // SAFETY: the first `len` units were written.
        unsafe { core::slice::from_raw_parts(self.ptr(), self.len) }
    }

    #[inline]
    fn fail(&mut self, err: PathError) {
        if self.err.is_none() {
            self.err = Some(err);
        }
    }

    /// Appends an optional separator and `units`, then the NUL.
    #[inline]
    fn write<C: PathUnit>(&mut self, sep: bool, units: &[C])
    where
        V::Unit: TranscodeFrom<C>,
    {
        let at = self.len;
        let start = at + usize::from(sep);
        if start + V::Unit::max_len(units) + 1 > V::Unit::MAX_PATH {
            self.fail(PathError::MaxPathExceeded);
            return;
        }
        // SAFETY: `start + max_len(units) + 1` units fit the buffer, which `units` is not in, as `self` is borrowed mutably.
        let written = unsafe {
            let base = self.ptr_mut();
            // Overwritten by `units` or the NUL when there is no separator to write.
            base.add(at).write(V::Unit::from_u8(SEP));
            let written = V::Unit::transcode(units, base.add(start));
            base.add(written.map_or(at, |written| start + written))
                .write(V::Unit::from_u8(0));
            written
        };
        match written {
            Some(written) => self.len = start + written,
            None => self.fail(PathError::InvalidName),
        }
    }

    #[inline]
    fn write_sep(&mut self) {
        self.write::<V::Unit>(true, &[]);
    }

    #[inline]
    fn truncate(&mut self, len: usize) {
        debug_assert!(len <= self.len);
        self.len = len;
        // SAFETY: `len` is no more than it was, which is less than `MAX_PATH`.
        unsafe { self.ptr_mut().add(len).write(V::Unit::from_u8(0)) };
    }

    #[inline]
    fn needs_sep(&self) -> bool {
        self.written().last().is_some_and(|&c| !is_sep_exact(c))
    }

    /// The path, or the first failure since it was last set.
    #[inline]
    pub fn as_path(&self) -> Result<&PathZ<V>, PathError> {
        match self.err {
            // SAFETY: whatever leaves `err` as `None` has put a NUL at `len`.
            None => Ok(unsafe { PathZ::wrap(V::from_slice_unchecked(self.written(), Token(()))) }),
            Some(err) => Err(err),
        }
    }

    /// The first failure since the path was last set.
    #[inline]
    pub fn error(&self) -> Option<PathError> {
        self.err
    }

    /// One copy, no parsing.
    #[inline]
    pub fn append<C: PathUnit>(&mut self, below: &SubPath<C>) -> &mut Self
    where
        V::Unit: TranscodeFrom<C>,
    {
        if !below.is_empty() {
            self.write(self.needs_sep(), below.slice());
        }
        self
    }

    /// Appends one name written by `args`, in place.
    pub fn append_fmt(&mut self, args: fmt::Arguments<'_>) -> &mut Self {
        struct NameWriter<'a, V: View + ?Sized>(&'a mut PathBuf<V>);
        impl<V: View + ?Sized> fmt::Write for NameWriter<'_, V> {
            fn write_str(&mut self, text: &str) -> fmt::Result {
                self.0.write(false, text.as_bytes());
                self.0.err.map_or(Ok(()), |_| Err(fmt::Error))
            }
        }
        if self.err.is_some() {
            return self;
        }
        let before = self.len;
        if self.needs_sep() {
            self.write_sep();
        }
        let start = self.len;
        if fmt::write(&mut NameWriter(self), args).is_err()
            || FileName::new(&self.written()[start..]).is_none()
        {
            self.fail(PathError::InvalidName);
            self.truncate(before);
        }
        self
    }

    /// Removes the last name. With none left a root stays, a relative path gets a `..`, and a `SubPath` or a path in a [`ResetScope`] fails.
    #[inline]
    pub fn dot_dot(&mut self) -> &mut Self {
        let below = &self.written()[self.base_len..];
        let last = last_sep(below).map_or(0, |i| i + 1);
        if !below.is_empty() && !is_dot_dot(&below[last..]) {
            self.truncate(self.base_len + last.saturating_sub(1));
            return self;
        }
        match self.at_base {
            DotDotAtBase::Ignore => {}
            DotDotAtBase::Append => {
                let dots = [V::Unit::from_u8(b'.'); 2];
                self.write(self.needs_sep(), &dots);
            }
            DotDotAtBase::Fail => self.fail(PathError::Escapes),
        }
        self
    }

    /// Lends the path for changes that end with the [`ResetScope`].
    #[inline]
    pub fn save(&mut self) -> ResetScope<'_, V> {
        let saved = self.set_base_to_len();
        self.in_scope = true;
        ResetScope { path: self, saved }
    }

    /// Hands `f` the path with `count` times `..` after it, for the OS to resolve once it has followed the links in the path.
    pub fn with_unresolved_dot_dots<R>(
        &mut self,
        count: usize,
        f: impl FnOnce(&<V::Unit as PathUnit>::ZSlice) -> R,
    ) -> Result<R, PathError> {
        let mut path = self.save();
        let dots = [V::Unit::from_u8(b'.'); 2];
        for _ in 0..count {
            let sep = path.needs_sep();
            path.write(sep, &dots);
        }
        if let Some(err) = path.err {
            return Err(err);
        }
        // SAFETY: `write` put a NUL at `len`.
        Ok(f(unsafe { V::Unit::zslice_from_raw(path.ptr(), path.len) }))
    }

    /// Resolves `input`, read by the rules of `P`, against the path, as `path.resolve` does. Absolute input replaces it, as `set` does.
    pub fn join<P: PlatformT>(&mut self, input: &[u8]) -> &mut Self {
        let root = input_root_len::<P>(input);
        #[cfg(windows)]
        if let (0, [drive, b':', below @ ..]) = (root, input)
            && drive.is_ascii_alphabetic()
            && !matches!(P::P, Platform::Posix)
        {
            // `C:name` is `name` for a path on that drive and `C:\name` for any other.
            if self.err.is_none() && !is_on_drive(self.written(), *drive) {
                self.join::<P>(&[*drive, b':', SEP]);
            }
            self.parse::<P>(below, Dots::Resolve);
            return self;
        }
        if root > 0 {
            if !V::MAY_BE_ABSOLUTE {
                self.fail(PathError::ExpectedRelative);
                return self;
            }
            if self.fail_if_in_scope() {
                return self;
            }
            self.set_input_root(&input[..root]);
            self.set_base_to_root();
        }
        self.parse::<P>(&input[root..], Dots::Resolve);
        self
    }

    /// [`join`](Self::join) that fails if `input` leads out of the directory the path names now.
    pub fn join_below<P: PlatformT>(&mut self, input: &[u8]) -> &mut Self {
        self.parse_below::<P>(input, Dots::Resolve)
    }

    /// Appends `input`, read by the rules of `P`, which has to be one name or more and nothing else.
    pub fn append_names<P: PlatformT>(&mut self, input: &[u8]) -> &mut Self {
        if input.is_empty() {
            self.fail(PathError::InvalidName);
        }
        self.parse_below::<P>(input, Dots::Reject)
    }

    #[inline]
    fn parse_below<P: PlatformT>(&mut self, input: &[u8], dots: Dots) -> &mut Self {
        if self.err.is_some() {
            return self;
        }
        if input_root_len::<P>(input) > 0 {
            self.fail(PathError::ExpectedRelative);
            return self;
        }
        let saved = self.set_base_to_len();
        self.parse::<P>(input, dots);
        if self.err.is_some() {
            self.truncate(saved.len);
        }
        self.base_len = saved.base_len;
        self.at_base = saved.at_base;
        self
    }

    /// The only parser. Stops at the first failure.
    #[inline]
    fn parse<P: PlatformT>(&mut self, input: &[u8], dots: Dots) {
        let mut rest = input;
        while !rest.is_empty() && self.err.is_none() {
            let mut end = 0;
            let mut forbidden = false;
            while end < rest.len() && !P::P.is_separator(rest[end]) {
                forbidden |= is_forbidden_in_name(rest[end]);
                end += 1;
            }
            let name = &rest[..end];
            let ends_in_sep = end + 1 == rest.len();
            rest = rest.get(end + 1..).unwrap_or_default();
            match name {
                b"" | b"." | b".." if dots == Dots::Reject => self.fail(PathError::InvalidName),
                _ if dots == Dots::Reject && ends_in_sep => self.fail(PathError::InvalidName),
                b"" | b"." => {}
                b".." => _ = self.dot_dot(),
                _ if forbidden => self.fail(PathError::InvalidName),
                _ => self.write(self.needs_sep(), name),
            }
        }
    }

    /// Replaces the path with `root`, the root that absolute input starts with.
    fn set_input_root(&mut self, root: &[u8]) {
        #[cfg(windows)]
        if root.len() == 1 {
            match root_len(self.written()) {
                _ if self.err.is_some() => {}
                0 => self.fail(PathError::ExpectedAbsolute),
                kept => self.truncate(kept),
            }
            return;
        }
        self.err = None;
        self.len = 0;
        #[cfg(not(windows))]
        {
            // A drive or a share has no meaning here.
            if root.len() > 1 {
                self.fail(PathError::InvalidName);
            }
            self.write(false, b"/".as_slice());
        }
        #[cfg(windows)]
        {
            self.write(false, root);
            // SAFETY: the first `len` units were written.
            let written = unsafe { core::slice::from_raw_parts_mut(self.ptr_mut(), self.len) };
            for unit in written {
                if *unit == V::Unit::from_u8(b'/') {
                    *unit = V::Unit::from_u8(SEP);
                }
            }
            // A share at the very end of the input.
            if self.needs_sep() {
                self.write_sep();
            }
        }
    }
}

impl<U: PathUnit> PathBuf<AbsPath<U>> {
    /// [`from_abs`](Self::from_abs). On Windows a drive or a share gets the `\\?\` prefix, with which the OS takes a path of any length as written.
    pub fn from_long_path<C: PathUnit>(path: &AbsPath<C>) -> Self
    where
        U: TranscodeFrom<C>,
    {
        let mut this = Self::init();
        this.err = None;
        let rest = path.slice();
        #[cfg(windows)]
        let rest = match rest {
            [_, colon, ..] if colon.eq_ascii(b':') => {
                this.write(false, U::LONG_PATH_PREFIX);
                rest
            }
            [_, second, third, ..]
                if is_sep_exact(*second) && !third.eq_ascii(b'?') && !third.eq_ascii(b'.') =>
            {
                this.write(false, U::LONG_PATH_PREFIX);
                this.write(false, b"UNC".as_slice());
                &rest[1..]
            }
            _ => rest,
        };
        this.write(false, rest);
        this.set_base_to_root();
        this
    }
}

impl AbsPathBuf {
    #[inline]
    pub fn init_top_level_dir() -> Self {
        let mut this = Self::init();
        this.set_unchecked(crate::fs::FileSystem::instance().top_level_dir());
        this
    }

    pub fn init_fd_path(fd: Fd) -> crate::Result<Self> {
        use bun_errno::SystemErrno;
        #[cfg(not(windows))]
        // SAFETY: `room` is writable for its length.
        let fill = |room: &mut [u8]| match unsafe {
            bun_core::fd_path_raw(fd, room.as_mut_ptr(), room.len())
        } {
            len if len > 0 => Ok(len as usize),
            _ => Err(SystemErrno::EBADF),
        };
        #[cfg(windows)]
        // SAFETY: `room` is writable for its length.
        let fill = |room: &mut [u16]| match unsafe {
            bun_core::fd_path_raw_w(fd, room.as_mut_ptr(), room.len())
        } {
            len if len > 0 => Ok(len as usize),
            -2 => Err(SystemErrno::ENAMETOOLONG),
            _ => Err(SystemErrno::ENOENT),
        };
        let path = PathBuf::<AbsPath<_>>::from_fn(fill)?;
        #[cfg(windows)]
        let path = Self::from_abs(path.as_path().map_err(SystemErrno::from)?);
        Ok(path)
    }
}

#[derive(Copy, Clone)]
struct SavedState {
    len: usize,
    base_len: usize,
    at_base: DotDotAtBase,
    in_scope: bool,
    err: Option<PathError>,
}

/// A [`PathBuf`] that goes back to what it was, failures included, on drop. Until then nothing removes or replaces what was there.
pub struct ResetScope<'a, V: View + ?Sized> {
    path: &'a mut PathBuf<V>,
    saved: SavedState,
}
impl<V: View + ?Sized> Drop for ResetScope<'_, V> {
    #[inline]
    fn drop(&mut self) {
        // `mem::swap` can have put another `PathBuf` here, which may hold less than was saved.
        if !self.path.in_scope || self.path.base_len != self.saved.len {
            self.path.fail(PathError::Escapes);
            return;
        }
        self.path.truncate(self.saved.len);
        self.path.base_len = self.saved.base_len;
        self.path.at_base = self.saved.at_base;
        self.path.in_scope = self.saved.in_scope;
        self.path.err = self.saved.err;
    }
}
impl<V: View + ?Sized> Deref for ResetScope<'_, V> {
    type Target = PathBuf<V>;
    #[inline]
    fn deref(&self) -> &PathBuf<V> {
        self.path
    }
}
impl<V: View + ?Sized> DerefMut for ResetScope<'_, V> {
    #[inline]
    fn deref_mut(&mut self) -> &mut PathBuf<V> {
        self.path
    }
}

/// Units of the root that `input` starts with by the rules of `P`; 0 for relative input.
#[inline]
fn input_root_len<P: PlatformT>(input: &[u8]) -> usize {
    match P::P {
        Platform::Posix => usize::from(input.first() == Some(&b'/')),
        // Elsewhere than on Windows this is a POSIX path that may be written with `\`.
        Platform::Loose if !cfg!(windows) => usize::from(matches!(input, [b'/' | b'\\', ..])),
        _ => windows_root_len(input, |c| P::P.is_separator(c)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve_path::platform::{Auto, Loose, Posix, Windows};

    /// simdutf is C++, which neither `cargo test` links nor Miri runs. The other direction is in `string_paths`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
        from: *const u16,
        len: usize,
        to: *mut u8,
    ) -> simdutf::SIMDUTFResult {
        // SAFETY: `from` is readable for `len` units and `to` writable for three times as many.
        let (status, count) = unsafe {
            match String::from_utf16(core::slice::from_raw_parts(from, len)) {
                Ok(text) => {
                    core::ptr::copy_nonoverlapping(text.as_ptr(), to, text.len());
                    (simdutf::Status::SUCCESS, text.len())
                }
                Err(_) => (simdutf::Status::SURROGATE, 0),
            }
        };
        simdutf::SIMDUTFResult { status, count }
    }

    #[cfg(not(windows))]
    const ROOT: &str = "/";
    #[cfg(windows)]
    const ROOT: &str = "C:\\";

    /// A path of this host from one written with `/`, where a leading `/` stands for [`ROOT`].
    pub(super) fn native(portable: &str) -> Vec<u8> {
        let (root, below) = match portable.strip_prefix('/') {
            Some(below) => (ROOT, below),
            None => ("", portable),
        };
        format!("{root}{}", below.replace('/', &char::from(SEP).to_string())).into_bytes()
    }
    /// The reverse of [`native`].
    fn portable(native: &str) -> String {
        match native.strip_prefix(ROOT) {
            Some(below) => format!("/{}", below.replace(char::from(SEP), "/")),
            None => native.replace(char::from(SEP), "/"),
        }
    }
    /// The path as it is written on this host, or the name of the failure. Reads the NUL.
    pub(super) fn native_or_err<V: View + ?Sized>(path: Result<&PathZ<V>, PathError>) -> String
    where
        V::Unit: Into<u32>,
    {
        let path = match path {
            Ok(path) => path.slice(),
            Err(err) => return format!("{err:?}"),
        };
        // SAFETY: a NUL follows the units of a `PathZ`.
        assert!(unsafe { *path.as_ptr().add(path.len()) } == V::Unit::from_u8(0));
        let units = path.iter().map(|&c| c.into());
        if size_of::<V::Unit>() == 1 {
            String::from_utf8(units.map(|c| c as u8).collect()).unwrap()
        } else {
            String::from_utf16(&units.map(|c| c as u16).collect::<Vec<_>>()).unwrap()
        }
    }
    fn portable_or_err<V: View + ?Sized>(path: Result<&PathZ<V>, PathError>) -> String
    where
        V::Unit: Into<u32>,
    {
        match path {
            Ok(_) => portable(&native_or_err(path)),
            Err(err) => format!("{err:?}"),
        }
    }
    pub(super) fn abs(path: &str) -> AbsPathBuf {
        AbsPathBuf::from(AbsPath::new(&native(path)).unwrap())
    }
    /// `a`, `s` and `n` for each of `AbsPath`, `SubPath` and `FileName` that takes `units`.
    pub(super) fn views_of(units: &[u8]) -> String {
        let mut taken = String::new();
        taken.extend(AbsPath::new(units).map(|_| 'a'));
        taken.extend(SubPath::new(units).map(|_| 's'));
        taken.extend(FileName::new(units).map(|_| 'n'));
        taken
    }
    /// What an OS call that writes `text` does with the room it is given.
    pub(super) fn fill_with<U: Copy>(text: &[U]) -> impl FnOnce(&mut [U]) -> Result<usize, ()> {
        move |room| {
            let len = text.len().min(room.len());
            room[..len].copy_from_slice(&text[..len]);
            Ok(text.len())
        }
    }
    /// A path that a separator and `room` more units fill. Written in one copy, so that Miri is not slow.
    fn nearly_full<U: PathUnit>(room: usize) -> PathBuf<AbsPath<U>> {
        let name = vec![b'x'; U::MAX_PATH - 1 - ROOT.len() - 1 - room];
        let mut path = PathBuf::<AbsPath<U>>::from_abs(AbsPath::new(ROOT.as_bytes()).unwrap());
        path.append(SubPath::new_unchecked(&name));
        assert_eq!(path.len, U::MAX_PATH - 2 - room);
        path
    }
    fn len_of<V: View + ?Sized>(path: &PathBuf<V>) -> Result<usize, PathError> {
        path.as_path().map(|path| path.slice().len())
    }

    #[test]
    fn new_accepts_only_normalized_input() {
        for (text, views) in [
            ("", "s"),
            ("a", "sn"),
            ("a/b", "s"),
            ("..", ""),
            ("../..", ""),
            ("../a", ""),
            ("a/..", ""),
            ("a/../b", ""),
            (".", ""),
            ("a/./b", ""),
            ("a/", ""),
            ("a//b", ""),
            ("a\0b", ""),
            ("/", "a"),
            ("/a", "a"),
            ("/a/b", "a"),
            ("/a/", ""),
            ("/a//b", ""),
            ("/..", ""),
            ("/a/../b", ""),
            ("/./a", ""),
        ] {
            assert_eq!(views_of(&native(text)), views, "{text:?}");
        }
    }

    #[test]
    fn dirname_basename_strip_prefix() {
        let path = abs("/a/b/cd");
        let path: &AbsPath = path.as_path().unwrap();
        let up = core::iter::successors(Some(path), |path| path.dirname());
        let up: Vec<String> = up.map(|path| portable(&path.to_string())).collect();
        assert_eq!(up, ["/a/b/cd", "/a/b", "/a", "/"]);
        assert_eq!(path.basename().unwrap().slice(), b"cd");
        let root = AbsPath::new(ROOT.as_bytes()).unwrap();
        assert!(root.is_root() && root.dirname().is_none() && root.basename().is_none());
        assert!(path.is_absolute() && !sub_path!("a/b").is_absolute());

        for (dir, below) in [
            ("/a/b/cd", Some("")),
            ("/a/b", Some("cd")),
            ("/a", Some("b/cd")),
            ("/", Some("a/b/cd")),
            ("/a/b/cd/e", None),
            ("/a/b/c", None),
            ("/a/bb", None),
            ("/x", None),
        ] {
            let got = path.strip_prefix(abs(dir).as_path().unwrap());
            let got = got.map(|below| portable(&below.to_string()));
            assert_eq!(got.as_deref(), below, "{dir:?}");
        }
    }

    #[test]
    fn sub_path_literal_is_native() {
        let path = sub_path!("node_modules/.bun");
        assert_eq!(path.slice(), native("node_modules/.bun"));
        assert_eq!(path.slice_z().as_bytes(), path.slice());
    }

    #[test]
    fn join_resolves_against_the_path() {
        for (input, joined) in [
            ("", "/a/b"),
            (".", "/a/b"),
            ("c", "/a/b/c"),
            ("c/d", "/a/b/c/d"),
            ("c//d/./e/", "/a/b/c/d/e"),
            ("..", "/a"),
            ("../..", "/"),
            ("../../../..", "/"),
            ("c/../d", "/a/b/d"),
            ("../../../x", "/x"),
            ("/x/y", "/x/y"),
            ("/x/../..", "/"),
            ("a\0b", "InvalidName"),
        ] {
            let input = input.as_bytes();
            let posix = portable_or_err(abs("/a/b").join::<Posix>(input).as_path());
            let loose = portable_or_err(abs("/a/b").join::<Loose>(input).as_path());
            assert_eq!((&*posix, &*loose), (joined, joined), "{input:?}");
        }
        let mut path = abs("/a/b");
        path.join::<Loose>(b"c\\d\\..\\..\\..\\x");
        assert_eq!(portable_or_err(path.as_path()), "/a/x");
        path.join::<Windows>(b"c\\d/e");
        assert_eq!(portable_or_err(path.as_path()), "/a/x/c/d/e");
    }

    #[cfg(not(windows))]
    #[test]
    fn posix_keeps_backslash_and_colon_in_names() {
        type Step = fn(&mut AbsPathBuf, &[u8]);
        let rows: [(Step, &[u8], &str); 10] = [
            (
                |path, input| _ = path.join::<Posix>(input),
                b"c\\..\\d",
                "/a/c\\..\\d",
            ),
            (
                |path, input| _ = path.append_names::<Posix>(input),
                b"c\\d",
                "/a/c\\d",
            ),
            (
                |path, input| _ = path.join_below::<Loose>(input),
                b"pkgs:a/x",
                "/a/pkgs:a/x",
            ),
            (
                |path, input| _ = path.join::<Loose>(input),
                b"C:x",
                "/a/C:x",
            ),
            (
                |path, input| _ = path.join::<Loose>(input),
                b"C:\\x",
                "/a/C:/x",
            ),
            (
                |path, input| _ = path.join_below::<Loose>(input),
                b"C:/x",
                "/a/C:/x",
            ),
            (
                |path, input| _ = path.join::<Windows>(input),
                b"C:x",
                "/a/C:x",
            ),
            // A drive or a share has no meaning here.
            (
                |path, input| _ = path.join::<Windows>(input),
                b"C:\\x",
                "InvalidName",
            ),
            (
                |path, input| _ = path.join::<Windows>(input),
                b"\\\\srv\\share\\x",
                "InvalidName",
            ),
            (
                |path, input| _ = path.join_below::<Windows>(input),
                b"C:/x",
                "ExpectedRelative",
            ),
        ];
        for (step, input, joined) in rows {
            let mut path = abs("/a");
            step(&mut path, input);
            assert_eq!(native_or_err(path.as_path()), joined, "{input:?}");
        }
    }

    #[test]
    fn join_below_stays_below() {
        for (input, joined) in [
            ("", "/a/b"),
            ("x", "/a/b/x"),
            ("x/../y", "/a/b/y"),
            ("x/..", "/a/b"),
            ("..", "Escapes"),
            ("x/../..", "Escapes"),
            ("x/../../b/y", "Escapes"),
            ("/etc", "ExpectedRelative"),
            ("/a/b/x", "ExpectedRelative"),
        ] {
            let mut path = abs("/a/b");
            path.join_below::<Posix>(input.as_bytes());
            assert_eq!(portable_or_err(path.as_path()), joined, "{input:?}");
        }
        for (input, joined) in [
            (&b"x\\..\\..\\..\\etc"[..], "Escapes"),
            (b"x\\y/../..\\z", "/a/b/z"),
        ] {
            let mut path = abs("/a/b");
            path.join_below::<Loose>(input);
            assert_eq!(portable_or_err(path.as_path()), joined);
        }
        let mut rel = RelPathBuf::init();
        assert_eq!(
            rel.join_below::<Posix>(b"..").error(),
            Some(PathError::Escapes)
        );
    }

    #[test]
    fn append_names_takes_names_only() {
        for (input, appended) in [
            ("react", "/nm/react"),
            ("@scope/pkg", "/nm/@scope/pkg"),
            ("...", "/nm/..."),
            ("", "InvalidName"),
            (".", "InvalidName"),
            ("..", "InvalidName"),
            ("a/..", "InvalidName"),
            ("a/./b", "InvalidName"),
            ("a//b", "InvalidName"),
            ("a/", "InvalidName"),
            ("a\0b", "InvalidName"),
            ("/a", "ExpectedRelative"),
        ] {
            let mut path = abs("/nm");
            path.append_names::<Posix>(input.as_bytes());
            assert_eq!(portable_or_err(path.as_path()), appended, "{input:?}");
        }
    }

    #[test]
    fn dot_dot_at_base_per_view() {
        assert_eq!(
            portable_or_err(abs("/a").dot_dot().dot_dot().as_path()),
            "/"
        );

        let mut rel = RelPathBuf::init();
        rel.dot_dot()
            .dot_dot()
            .append(sub_path!("x"))
            .dot_dot()
            .dot_dot();
        assert_eq!(portable_or_err(rel.as_path()), "../../..");
        rel.join::<Posix>(b"a/../../b");
        assert_eq!(portable_or_err(rel.as_path()), "../../../../b");

        let mut sub = SubPathBuf::init();
        assert_eq!(
            portable_or_err(sub.append(sub_path!("a")).dot_dot().as_path()),
            ""
        );
        assert_eq!(sub.dot_dot().error(), Some(PathError::Escapes));

        let mut any = PathBuf::<Path>::init();
        assert_eq!(
            portable_or_err(any.join::<Posix>(b"a/../..").as_path()),
            ".."
        );
        assert_eq!(
            portable_or_err(any.join::<Auto>(&native("/a/../..")).as_path()),
            "/"
        );
    }

    #[test]
    fn first_error_is_sticky_until_the_path_is_replaced() {
        let mut path = abs("/a/b");
        path.join_below::<Posix>(b"../x")
            .append(sub_path!("more"))
            .append_names::<Posix>(b"")
            .join::<Posix>(b"y")
            .dot_dot();
        assert_eq!(path.error(), Some(PathError::Escapes));
        assert_eq!(portable_or_err(path.as_path()), "Escapes");
        assert_eq!(
            portable_or_err(path.set(abs("/z").as_path().unwrap()).as_path()),
            "/z"
        );
        path.join_below::<Posix>(b"..");
        assert_eq!(
            portable_or_err(path.join::<Auto>(&native("/y/z")).as_path()),
            "/y/z"
        );

        let mut unset = AbsPathBuf::init();
        unset.append(sub_path!("x")).join::<Posix>(b"y").dot_dot();
        assert_eq!(unset.error(), Some(PathError::Unset));
        assert_eq!(
            portable_or_err(unset.join::<Auto>(&native("/x")).as_path()),
            "/x"
        );

        let mut sub = SubPathBuf::init();
        let root = abs("/");
        sub.set_abs::<u8>(root.as_path().unwrap());
        assert_eq!(sub.error(), Some(PathError::ExpectedRelative));
        assert_eq!(
            SubPathBuf::init().set_unchecked(ROOT.as_bytes()).error(),
            Some(PathError::ExpectedRelative)
        );
    }

    #[test]
    fn every_write_stops_at_capacity() {
        const MAX: usize = <u8 as PathUnit>::MAX_PATH;
        type Step = fn(&mut AbsPathBuf, &[u8]);
        let steps: [Step; 5] = [
            |path, name| _ = path.append(SubPath::new(name).unwrap()),
            |path, name| _ = path.append_names::<Posix>(name),
            |path, name| _ = path.join::<Posix>(name),
            |path, name| _ = path.join_below::<Posix>(name),
            |path, name| _ = path.append_fmt(format_args!("{}", name.escape_ascii())),
        ];
        let mut path = nearly_full::<u8>(4);
        for step in steps {
            let mut path = path.save();
            step(&mut path, b"1234");
            assert_eq!(len_of(&path), Ok(MAX - 1));
            path.dot_dot();
            step(&mut path, b"12345");
            assert_eq!(len_of(&path), Err(PathError::MaxPathExceeded));
        }
        assert_eq!(len_of(&path), Ok(MAX - 6));

        let full = path.append(sub_path!("1234")).as_path().unwrap();
        assert_eq!(len_of(&AbsPathBuf::from(full)), Ok(MAX - 1));
        assert_eq!(
            len_of(AbsPathBuf::init().set_unchecked(full.slice())),
            Ok(MAX - 1)
        );
        let too_long = [full.slice(), b"5"].concat();
        let too_long = AbsPath::new_unchecked(&too_long).unwrap();
        assert_eq!(
            AbsPathBuf::from(too_long).error(),
            Some(PathError::MaxPathExceeded)
        );
        assert_eq!(
            AbsPathBuf::init().set_unchecked(too_long.slice()).error(),
            Some(PathError::MaxPathExceeded)
        );
    }

    #[test]
    fn append_fmt_writes_one_name() {
        let mut path = abs("/a");
        path.append_fmt(format_args!("{}@{}", "react", 18));
        assert_eq!(portable_or_err(path.as_path()), "/a/react@18");
        assert_eq!(
            portable_or_err(abs("/").append_fmt(format_args!("x")).as_path()),
            "/x"
        );
        for name in ["", ".", "..", "a\0b", "a/b"] {
            let name = String::from_utf8(native(name)).unwrap();
            let mut path = abs("/a");
            path.append_fmt(format_args!("{name}"));
            assert_eq!(path.error(), Some(PathError::InvalidName), "{name:?}");
        }

        struct Fails;
        impl fmt::Display for Fails {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("half")?;
                Err(fmt::Error)
            }
        }
        let mut path = abs("/a");
        {
            let mut path = path.save();
            assert_eq!(
                path.append_fmt(format_args!("{Fails}")).error(),
                Some(PathError::InvalidName)
            );
        }
        assert_eq!(portable_or_err(path.as_path()), "/a");
    }

    #[test]
    fn save_restores_on_drop() {
        let mut path = abs("/a/b");
        {
            let mut outer = path.save();
            outer.append(sub_path!("c"));
            assert_eq!(
                portable_or_err(outer.save().append(sub_path!("d")).as_path()),
                "/a/b/c/d"
            );
            assert_eq!(portable_or_err(outer.as_path()), "/a/b/c");
            assert_eq!(portable_or_err(outer.dot_dot().as_path()), "/a/b");
            assert_eq!(outer.dot_dot().error(), Some(PathError::Escapes));
        }
        assert_eq!(portable_or_err(path.as_path()), "/a/b");

        let elsewhere = abs("/x");
        let elsewhere: &AbsPath = elsewhere.as_path().unwrap();
        let steps: [fn(&mut AbsPathBuf, &AbsPath); 5] = [
            |path, _| _ = path.join::<Posix>(b"../../.."),
            |path, _| _ = path.join::<Posix>(b"/etc"),
            |path, elsewhere| _ = path.set(elsewhere),
            |path, elsewhere| _ = path.set_abs(elsewhere),
            |path, elsewhere| _ = path.set_unchecked(elsewhere.slice()),
        ];
        for step in steps {
            let mut scope = path.save();
            step(&mut scope, elsewhere);
            assert_eq!(scope.error(), Some(PathError::Escapes));
            drop(scope);
            assert_eq!(portable_or_err(path.as_path()), "/a/b");
        }

        fn leaves_early(path: &mut AbsPathBuf) -> Result<(), PathError> {
            let mut scope = path.save();
            scope
                .append(sub_path!("deep"))
                .join_below::<Posix>(b"..")
                .as_path()?;
            scope.join_below::<Posix>(b"../..").as_path()?;
            unreachable!()
        }
        assert_eq!(leaves_early(&mut path), Err(PathError::Escapes));
        assert_eq!(portable_or_err(path.as_path()), "/a/b");

        path.join_below::<Posix>(b"..");
        path.save().append(sub_path!("x"));
        assert_eq!(path.error(), Some(PathError::Escapes));
    }

    #[test]
    fn forgotten_reset_scope_stays_locked() {
        let mut path = abs("/a/b");
        let mut scope = path.save();
        scope.append(sub_path!("c"));
        core::mem::forget(scope);
        assert_eq!(portable_or_err(path.as_path()), "/a/b/c");
        assert_eq!(path.dot_dot().dot_dot().error(), Some(PathError::Escapes));
        assert_eq!(path.join::<Posix>(b"/x").error(), Some(PathError::Escapes));
    }

    #[test]
    fn reset_scope_survives_a_swapped_path() {
        let (mut long, mut short) = (abs("/a/b/c/d"), abs("/x"));
        {
            let mut scope = long.save();
            scope.append(sub_path!("e"));
            core::mem::swap(&mut *scope, &mut short);
        }
        assert_eq!(long.error(), Some(PathError::Escapes));
        assert_eq!(portable_or_err(short.as_path()), "/a/b/c/d/e");

        let (mut one, mut other) = (abs("/a/b"), abs("/c/d"));
        {
            let (mut one, mut other) = (one.save(), other.save());
            one.append(sub_path!("x"));
            core::mem::swap(&mut *one, &mut *other);
        }
        assert_eq!(portable_or_err(one.as_path()), "/c/d");
        assert_eq!(portable_or_err(other.as_path()), "/a/b");
    }

    #[test]
    fn path_buf_survives_moves() {
        fn built_in_callee() -> AbsPathBuf {
            let mut path = abs("/a");
            path.append(sub_path!("b"));
            path
        }
        let mut path = built_in_callee();
        path.append(sub_path!("c"));
        let mut boxed = Box::new(path);
        boxed.append(sub_path!("d"));
        let mut kept = vec![*boxed];
        kept.reserve(4);
        assert_eq!(
            portable_or_err(kept[0].append(sub_path!("e")).as_path()),
            "/a/b/c/d/e"
        );
    }

    #[test]
    fn relative_from_one_directory_to_another() {
        for (from, to, way) in [
            ("/a/b", "/a/b", ""),
            ("/a/b", "/a/b/c/d", "c/d"),
            ("/a/b", "/a", ".."),
            ("/a/b", "/", "../.."),
            ("/a/b", "/a/c", "../c"),
            ("/a/b", "/a/bb", "../bb"),
            ("/a/b", "/x/y", "../../x/y"),
            ("/", "/x", "x"),
            ("/", "/", ""),
        ] {
            let (from, to) = (abs(from), abs(to));
            let built = from.as_path().unwrap().relative(to.as_path().unwrap());
            assert_eq!(portable_or_err(built.as_path()), way);
        }
    }

    #[test]
    fn set_unchecked_and_from_fn_take_what_the_os_wrote() {
        const MAX: usize = <u8 as PathUnit>::MAX_PATH;
        assert!(AbsPath::<u8>::new_unchecked(b"").is_none());
        assert!(AbsPath::<u8>::new_unchecked(b"rel").is_none());
        for (wrote, path) in [
            ("/a/b", "/a/b"),
            ("/a/b///", "/a/b"),
            ("/", "/"),
            ("rel", "ExpectedAbsolute"),
            ("", "ExpectedAbsolute"),
        ] {
            let wrote = native(wrote);
            assert_eq!(
                portable_or_err(AbsPathBuf::init().set_unchecked(&wrote).as_path()),
                path
            );
            let mut built = AbsPathBuf::from_fn(fill_with(&wrote)).unwrap();
            assert_eq!(portable_or_err(built.as_path()), path);
            if built.error().is_none() {
                built.append(sub_path!("x")).join::<Posix>(b"../../../..");
                assert_eq!(portable_or_err(built.as_path()), "/");
            }
        }
        assert_eq!(AbsPathBuf::from_fn(|_| Err("failed")).err(), Some("failed"));

        let filled = [ROOT.as_bytes(), &vec![b'x'; MAX]].concat();
        for len in [MAX, MAX + 1] {
            let path = AbsPathBuf::from_fn(fill_with(&filled[..len])).unwrap();
            assert_eq!(path.error(), Some(PathError::MaxPathExceeded));
        }
        let mut path = AbsPathBuf::from_fn(fill_with(&filled[..MAX - 1])).unwrap();
        assert_eq!(len_of(&path), Ok(MAX - 1));
        assert_eq!(portable_or_err(path.dot_dot().as_path()), "/");
    }

    #[test]
    fn with_unresolved_dot_dots_leaves_the_path_as_it_was() {
        const MAX: usize = <u8 as PathUnit>::MAX_PATH;
        let as_text = |text: &ZStr| portable(core::str::from_utf8(text.as_bytes()).unwrap());
        let mut path = abs("/a/b");
        assert_eq!(
            path.with_unresolved_dot_dots(2, as_text).as_deref(),
            Ok("/a/b/../..")
        );
        assert_eq!(
            path.with_unresolved_dot_dots(0, as_text).as_deref(),
            Ok("/a/b")
        );
        path.join_below::<Posix>(b"..");
        assert_eq!(
            path.with_unresolved_dot_dots(1, |_| ()),
            Err(PathError::Escapes)
        );

        let mut path = nearly_full::<u8>("../..".len());
        assert_eq!(
            path.with_unresolved_dot_dots(2, |text| text.len()),
            Ok(MAX - 1)
        );
        assert_eq!(
            path.with_unresolved_dot_dots(3, |_| ()),
            Err(PathError::MaxPathExceeded)
        );
        assert_eq!(len_of(&path), Ok(MAX - 2 - "../..".len()));
    }

    #[test]
    fn both_units() {
        let base = abs("/w");
        let base: &AbsPath = base.as_path().unwrap();
        let mut wide = PathBuf::<AbsPath<u16>>::from_abs(base);
        wide.append(sub_path!("node_modules"))
            .join_below::<Posix>("a/\u{e9}/../b".as_bytes())
            .append_fmt(format_args!("{}@{}", "r\u{e9}act", 18));
        let wide = wide.as_path();
        assert_eq!(portable_or_err(wide), "/w/node_modules/a/b/r\u{e9}act@18");
        let wide: &AbsPath<u16> = wide.unwrap();

        let wide_base = PathBuf::<AbsPath<u16>>::from_abs(base);
        let below = wide.strip_prefix(wide_base.as_path().unwrap()).unwrap();
        let mut narrow = abs("/back");
        assert_eq!(
            portable_or_err(narrow.append(below).as_path()),
            "/back/node_modules/a/b/r\u{e9}act@18"
        );
        assert_eq!(
            portable_or_err(narrow.set_abs(wide).as_path()),
            "/w/node_modules/a/b/r\u{e9}act@18"
        );
        // Half of a surrogate pair is a name on Windows and is nothing in UTF-8.
        narrow.append(FileName::<u16>::new(&[0xD800]).unwrap());
        assert_eq!(narrow.error(), Some(PathError::InvalidName));

        // One unit of UTF-16 can take three of UTF-8, and the room is asked for before they are read.
        let name = [u16::from(b'x'); 3];
        let mut path = nearly_full::<u8>(6);
        assert_eq!(
            len_of(path.save().append(SubPath::new(&name[..2]).unwrap())),
            Ok(<u8 as PathUnit>::MAX_PATH - 5)
        );
        assert_eq!(
            path.append(SubPath::new(&name).unwrap()).error(),
            Some(PathError::MaxPathExceeded)
        );

        let mut path = nearly_full::<u16>(2);
        assert_eq!(
            len_of(path.save().append(sub_path!("12"))),
            Ok(<u16 as PathUnit>::MAX_PATH - 1)
        );
        assert_eq!(
            path.append(sub_path!("123")).error(),
            Some(PathError::MaxPathExceeded)
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn from_long_path_is_the_path_itself_on_posix() {
        let long = AbsPathBuf::from_long_path::<u8>(abs("/a/b").as_path().unwrap());
        assert_eq!(portable_or_err(long.as_path()), "/a/b");
    }

    #[test]
    fn windows_roots() {
        let native = |text: &str| windows_root_len(text.as_bytes(), |c| c == b'\\');
        let either = |text: &str| windows_root_len(text.as_bytes(), |c| c == b'\\' || c == b'/');
        for (text, root) in [
            ("", ""),
            ("a", ""),
            ("a\\b", ""),
            ("C:", ""),
            ("C:x", ""),
            ("C:\\", "C:\\"),
            ("c:\\x\\y", "c:\\"),
            ("1:\\x", ""),
            ("\u{e9}:\\x", ""),
            ("\\", "\\"),
            ("\\x", "\\"),
            ("\\\\", "\\"),
            ("\\\\srv", "\\"),
            ("\\\\srv\\", "\\"),
            ("\\\\\\srv\\share", "\\"),
            ("\\\\srv\\\\share", "\\"),
            ("\\\\srv\\share", "\\\\srv\\share"),
            ("\\\\srv\\share\\", "\\\\srv\\share\\"),
            ("\\\\srv\\share\\x\\y", "\\\\srv\\share\\"),
            ("\\\\?\\C:", "\\\\?\\C:"),
            ("\\\\?\\C:\\", "\\\\?\\C:\\"),
            ("\\\\?\\C:\\x", "\\\\?\\C:\\"),
            ("\\\\.\\pipe\\x", "\\\\.\\pipe\\"),
            ("\\\\?\\UNC", "\\"),
            ("\\\\?\\UNC\\srv", "\\"),
            ("\\\\?\\UNC\\srv\\share", "\\\\?\\UNC\\srv\\share"),
            ("\\\\?\\unc\\srv\\share\\x", "\\\\?\\unc\\srv\\share\\"),
            ("\\\\srv\\UNC\\x\\y", "\\\\srv\\UNC\\"),
            ("\\\\??\\UNC\\x\\y", "\\\\??\\UNC\\"),
        ] {
            assert_eq!(&text[..native(text)], root, "{text}");
            assert_eq!(&text[..either(text)], root, "{text}");
            let slashes = text.replace('\\', "/");
            assert_eq!(either(&slashes), root.len(), "{slashes}");
            // In a view only `\` separates.
            assert_eq!(native(&slashes), 0, "{slashes}");
            let fully_qualified = if root.len() > 1 && root.ends_with('\\') {
                root
            } else {
                ""
            };
            assert_eq!(
                &text[..fully_qualified_root_len(text.as_bytes(), |c| c == b'\\')],
                fully_qualified,
                "{text}"
            );
        }
        assert_eq!(either("C:/x"), 3);
        assert_eq!(either("\\/srv/share\\x"), 12);
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::tests::{abs, fill_with, native_or_err, views_of};
    use super::*;
    use crate::resolve_path::platform::Windows;

    const BASES: [&str; 3] = ["C:\\a\\b", "\\\\srv\\share\\d", "\\\\?\\C:\\a"];
    /// Input, what `join` makes of it on each of `BASES`, and how `join_below` fails; `""` if it gives what `join` does.
    #[rustfmt::skip]
    const JOIN: &[(&str, [&str; 3], &str)] = &[
        ("", ["C:\\a\\b", "\\\\srv\\share\\d", "\\\\?\\C:\\a"], ""),
        ("..\\..\\..", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"], "Escapes"),
        ("x/y", ["C:\\a\\b\\x\\y", "\\\\srv\\share\\d\\x\\y", "\\\\?\\C:\\a\\x\\y"], ""),
        ("x\\..\\y", ["C:\\a\\b\\y", "\\\\srv\\share\\d\\y", "\\\\?\\C:\\a\\y"], ""),
        ("C:\\", ["C:\\"; 3], "ExpectedRelative"),
        ("c:/x/y", ["c:\\x\\y"; 3], "ExpectedRelative"),
        ("D:\\x", ["D:\\x"; 3], "ExpectedRelative"),
        ("C:", ["C:\\a\\b", "C:\\", "C:\\"], "InvalidName"),
        ("c:x\\..\\y", ["C:\\a\\b\\y", "c:\\y", "c:\\y"], "InvalidName"),
        ("D:x", ["D:\\x"; 3], "InvalidName"),
        ("C:D:x", ["InvalidName"; 3], ""),
        ("1:\\x", ["InvalidName"; 3], ""),
        ("\\", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"], "ExpectedRelative"),
        ("\\x", ["C:\\x", "\\\\srv\\share\\x", "\\\\?\\C:\\x"], "ExpectedRelative"),
        ("/x", ["C:\\x", "\\\\srv\\share\\x", "\\\\?\\C:\\x"], "ExpectedRelative"),
        ("\\\\srv\\share", ["\\\\srv\\share\\"; 3], "ExpectedRelative"),
        ("\\\\srv\\share\\x\\..\\..", ["\\\\srv\\share\\"; 3], "ExpectedRelative"),
        ("//srv/share/x", ["\\\\srv\\share\\x"; 3], "ExpectedRelative"),
        ("\\\\srv", ["C:\\srv", "\\\\srv\\share\\srv", "\\\\?\\C:\\srv"], "ExpectedRelative"),
        ("\\\\", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"], "ExpectedRelative"),
        ("\\\\?\\C:\\x\\..\\..", ["\\\\?\\C:\\"; 3], "ExpectedRelative"),
        ("\\\\?\\UNC\\srv\\share\\x\\..\\..", ["\\\\?\\UNC\\srv\\share\\"; 3], "ExpectedRelative"),
        ("\\\\.\\pipe\\x", ["\\\\.\\pipe\\x"; 3], "ExpectedRelative"),
        ("xy:z", ["InvalidName"; 3], ""),
        ("x\\C:\\y", ["InvalidName"; 3], ""),
        (".\\C:\\y", ["InvalidName"; 3], ""),
        ("a\0b", ["InvalidName"; 3], ""),
    ];
    #[rustfmt::skip]
    const VIEWS: &[(&str, &str)] = &[
        ("", "s"),
        ("a", "sn"),
        ("a\\b", "s"),
        ("a/b", ""),
        ("a\\", ""),
        ("a\\\\b", ""),
        ("a\\.\\b", ""),
        ("a\\..\\b", ""),
        ("..", ""),
        ("..\\a", ""),
        ("a\\..", ""),
        (".", ""),
        ("C:", ""),
        ("C:a", ""),
        ("C:\\", "a"),
        ("C:\\a", "a"),
        ("C:\\a\\", ""),
        ("C:/a", ""),
        ("c:\\a", "a"),
        ("1:\\a", ""),
        ("\\", ""),
        ("\\a", ""),
        ("/a", ""),
        ("\\\\srv\\share", ""),
        ("\\\\srv\\share\\", "a"),
        ("\\\\srv\\share\\a", "a"),
        ("\\\\srv\\share\\a\\b", "a"),
        ("//srv/share/a", ""),
        ("\\\\srv", ""),
        ("\\\\srv\\", ""),
        ("\\\\?\\C:\\", "a"),
        ("\\\\?\\C:\\a", "a"),
        ("\\\\?\\C:", ""),
        ("\\\\?\\UNC\\srv\\share\\", "a"),
        ("\\\\?\\UNC\\srv\\share\\a", "a"),
        ("\\\\.\\pipe\\a", "a"),
        ("\\??\\C:\\a", ""),
        ("a:b", ""),
        ("a\\b:c", ""),
    ];
    #[rustfmt::skip]
    const RELATIVE: &[(&str, &str, &str)] = &[
        ("C:\\", "c:\\a", "a"),
        ("c:\\a", "C:\\", ".."),
        ("C:\\a", "c:\\a", ""),
        ("C:\\a", "D:\\a", "ExpectedRelative"),
        ("C:\\a", "\\\\srv\\share\\a", "ExpectedRelative"),
        ("\\\\srv\\share\\a\\b", "\\\\srv\\share\\", "..\\.."),
        ("\\\\srv\\share\\", "\\\\srv\\share\\a\\b", "a\\b"),
        ("\\\\?\\C:\\a", "\\\\?\\C:\\", ".."),
        ("\\\\?\\C:\\a", "C:\\a", "ExpectedRelative"),
        ("\\\\?\\UNC\\srv\\share\\a", "\\\\srv\\share\\a", "ExpectedRelative"),
    ];
    #[rustfmt::skip]
    const LONG: &[(&str, &str)] = &[
        ("C:\\", "\\\\?\\C:\\"),
        ("C:\\a", "\\\\?\\C:\\a"),
        ("c:\\a", "\\\\?\\c:\\a"),
        ("\\\\srv\\share\\", "\\\\?\\UNC\\srv\\share\\"),
        ("\\\\srv\\share\\a", "\\\\?\\UNC\\srv\\share\\a"),
        ("\\\\srv\\share\\a\\b", "\\\\?\\UNC\\srv\\share\\a\\b"),
        ("\\\\?\\C:\\", "\\\\?\\C:\\"),
        ("\\\\?\\C:\\a", "\\\\?\\C:\\a"),
        ("\\\\?\\UNC\\srv\\share\\", "\\\\?\\UNC\\srv\\share\\"),
        ("\\\\?\\UNC\\srv\\share\\a", "\\\\?\\UNC\\srv\\share\\a"),
        ("\\\\.\\pipe\\a", "\\\\.\\pipe\\a"),
    ];
    #[rustfmt::skip]
    const FROM_THE_OS: &[(&str, &str)] = &[
        ("C:\\", "C:\\"),
        ("C:\\a\\", "C:\\a"),
        ("C:\\a\\\\", "C:\\a"),
        ("\\\\srv\\share", "\\\\srv\\share\\"),
        ("\\\\srv\\share\\", "\\\\srv\\share\\"),
        ("\\\\srv\\share\\a\\", "\\\\srv\\share\\a"),
        ("\\\\?\\C:\\", "\\\\?\\C:\\"),
        ("\\\\?\\C:\\a\\", "\\\\?\\C:\\a"),
        ("a", "ExpectedAbsolute"),
        ("C:", "ExpectedAbsolute"),
        ("\\\\localhost\\C$", "\\\\localhost\\C$\\"),
        ("\\\\?\\UNC\\localhost\\C$", "\\\\?\\UNC\\localhost\\C$\\"),
        ("\\\\?\\C:", "\\\\?\\C:\\"),
    ];

    #[test]
    fn join_and_join_below() {
        for (input, joined, below) in JOIN {
            for (base, joined) in BASES.iter().zip(joined) {
                let input = input.as_bytes();
                assert_eq!(
                    native_or_err(abs(base).join::<Windows>(input).as_path()),
                    *joined,
                    "{base:?} {input:?}"
                );
                assert_eq!(
                    native_or_err(abs(base).join_below::<Windows>(input).as_path()),
                    *if below.is_empty() { joined } else { below },
                    "{base:?} {input:?}"
                );
            }
        }
        let mut failed = abs("C:\\a");
        failed
            .join_below::<Windows>(b"..")
            .join::<Windows>(b"\\x")
            .join::<Windows>(b"D:x");
        assert_eq!(failed.error(), Some(PathError::Escapes));
        assert_eq!(
            abs("C:\\a").save().join::<Windows>(b"D:x").error(),
            Some(PathError::Escapes)
        );
        assert_eq!(
            RelPathBuf::init().join::<Windows>(b"C:x").error(),
            Some(PathError::ExpectedRelative)
        );
        assert_eq!(
            native_or_err(failed.join::<Windows>(b"D:\\x").as_path()),
            "D:\\x"
        );
    }

    #[test]
    fn new_accepts_only_normalized_input() {
        for (text, views) in VIEWS {
            assert_eq!(views_of(text.as_bytes()), *views, "{text:?}");
        }
    }

    #[test]
    fn relative_from_one_directory_to_another() {
        for (from, to, way) in RELATIVE {
            let built = (abs(from).as_path().unwrap()).relative(abs(to).as_path().unwrap());
            assert_eq!(native_or_err(built.as_path()), *way, "{from:?} {to:?}");
        }
    }

    #[test]
    fn from_long_path_adds_the_prefix() {
        for (path, long) in LONG {
            let built = AbsPathBuf::from_long_path::<u8>(abs(path).as_path().unwrap());
            assert_eq!(native_or_err(built.as_path()), *long, "{path:?}");
        }
    }

    #[test]
    fn set_unchecked_and_from_fn_take_what_the_os_wrote() {
        for (wrote, path) in FROM_THE_OS {
            let wrote = wrote.as_bytes();
            assert_eq!(
                native_or_err(AbsPathBuf::init().set_unchecked(wrote).as_path()),
                *path,
                "{wrote:?}"
            );
            let mut built = AbsPathBuf::from_fn(fill_with(wrote)).unwrap();
            assert_eq!(native_or_err(built.as_path()), *path, "{wrote:?}");
            if built.error().is_none() {
                built
                    .append(sub_path!("x"))
                    .join::<Windows>(b"..\\..\\..\\..\\..");
                assert!(built.as_path().unwrap().is_root(), "{wrote:?}");
            }
        }
    }

    #[test]
    fn strip_prefix_ignores_the_case_of_a_root() {
        for (path, dir, below) in [
            ("c:\\Users\\x", "C:\\Users", Some("x")),
            ("c:\\Users\\x", "C:\\users", None),
            ("\\\\SRV\\Share\\x", "\\\\srv\\share\\", Some("x")),
        ] {
            let path = abs(path);
            let got = path
                .as_path()
                .unwrap()
                .strip_prefix(abs(dir).as_path().unwrap());
            assert_eq!(got.map(|below| below.to_string()).as_deref(), below);
        }
    }
}
