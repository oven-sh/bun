//! An owned, always NUL-terminated path buffer. No content or length makes it panic.

use core::fmt;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use bun_core::ZBox;

use crate::path_backend::{
    PathBackend, PoolBackend, PoolOrVecBackend, SliceBackend, StackBackend, VecBackend,
};
use crate::path_ops::{
    EditBuf, NAMESPACE_OVERHEAD, NORMALIZE_OVERHEAD, Relative, Resolved, TrimmedPart, Unresolved,
    last_absolute_posix_part, max_joined_len, max_relative_len,
};
use crate::path_style::{PathStyle, last_component, stem_len};
use crate::path_unit::PathUnit;
use crate::platform::{Auto, ForwardSlash, Posix};
use crate::{OSPathChar, PathChar};

/// The default. Starts in a pooled buffer and moves to the heap, so the syscall reports `ENAMETOOLONG`.
pub type Path = GenericPath<PoolOrVecBackend>;
/// Pooled buffer only. Returns `NameTooLong` instead of outgrowing a `PathBuffer`.
pub type PoolPath = GenericPath<PoolBackend>;
/// [`PoolPath`] of [`OSPathChar`] (`u16` on Windows).
pub type OSPath = GenericPath<PoolBackend<OSPathChar>>;
/// `Vec`-backed. For storing a path, or when more than 4 (the size of the pool) are alive.
pub type VecPath = GenericPath<VecBackend>;
/// Inline `[u8; N]`, NUL included. Never allocates. Moving it copies all `N` bytes.
pub type StackPath<const N: usize> = GenericPath<StackBackend<N>>;
/// Writes into the caller's buffer, for functions that return `&'a ZStr`.
pub type SlicePath<'a> = GenericPath<SliceBackend<'a>>;
/// [`Path`] that writes `/` on every platform.
pub type ForwardSlashPath = GenericPath<PoolOrVecBackend, ForwardSlash>;

type ZSlice<B> = <<B as PathBackend>::Unit as PathUnit>::ZSlice;

/// Derefs to `ZStr` or `WStr`. Most arguments can be `&[u8]` or `&[u16]`. On `Err` the path is unchanged.
pub struct GenericPath<B: PathBackend, S: PathStyle = Auto> {
    /// `[..len]` is initialized and `[len]` is NUL.
    backend: B,
    len: usize,
    style: PhantomData<S>,
}

impl<B: PathBackend, S: PathStyle> Deref for GenericPath<B, S> {
    type Target = ZSlice<B>;

    #[inline(always)]
    fn deref(&self) -> &ZSlice<B> {
        // SAFETY: `[..len]` is initialized and `[len]` is NUL.
        unsafe { B::Unit::zslice_from_raw(self.backend.as_ptr(), self.len) }
    }
}

impl<B: PathBackend + Default, S: PathStyle> Default for GenericPath<B, S> {
    #[inline(always)]
    fn default() -> Self {
        Self {
            backend: B::default(),
            len: 0,
            style: PhantomData,
        }
    }
}

impl<B: PathBackend + Default, S: PathStyle> GenericPath<B, S> {
    /// Takes no buffer until the first write.
    #[inline(always)]
    pub fn new() -> Self {
        Self::default()
    }

    #[inline(always)]
    fn build_with(f: impl FnOnce(&mut Self) -> Result<(), B::Error>) -> B::Output<Self> {
        let mut path = Self::new();
        B::output(f(&mut path).map(|()| path))
    }

    /// Copies `path` as is.
    #[inline]
    pub fn from<C: PathUnit>(path: &[C]) -> B::Output<Self> {
        Self::build_with(|new| new.try_replace_from(0, path))
    }

    /// Like repeated [`Self::push`]: adds separators and keeps `..`.
    #[inline]
    pub fn from_parts<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        let max_len = max_joined_len::<B::Unit, C>(parts);
        Self::build_with(|new| new.edit_or_retry_on_heap(max_len, |buf| buf.push_all(parts)))
    }

    /// Without a trailing separator, unless it is a root.
    #[inline]
    pub fn from_top_level_dir() -> B::Output<Self> {
        Self::build_with(|new| new.try_push(crate::fs::top_level_dir()))
    }

    /// Node's `path.join`.
    #[inline]
    pub fn join<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        Self::build_with(|new| new.try_join(parts))
    }

    /// Node's `path.resolve`, but the result stays relative if no part is absolute.
    #[inline]
    pub fn resolve<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        Self::build_with(|new| new.try_resolve::<false, C>(parts))
    }

    /// For paths from config, lockfiles or flags: `\` separates on POSIX too, except in absolute components that match `$HOME` or a working directory.
    #[inline]
    pub fn resolve_any_sep<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        Self::build_with(|new| new.try_resolve::<true, C>(parts))
    }

    /// Node's `path.relative`, against the top-level directory. Returns `to` if it is on another drive or share.
    #[inline]
    pub fn relative(from: &[B::Unit], to: &[B::Unit]) -> B::Output<Self> {
        Self::build_with(|new| new.try_relative::<false>(from, to))
    }

    /// Reads its arguments like [`Self::resolve_any_sep`] and leaves no `\` in a component of the result.
    #[inline]
    pub fn relative_any_sep(from: &[B::Unit], to: &[B::Unit]) -> B::Output<Self> {
        Self::build_with(|new| new.try_relative::<true>(from, to))
    }
}

impl GenericPath<PoolOrVecBackend, Posix> {
    /// The body of `resolve_path::join_abs*`, which keep a trailing `/`.
    #[inline]
    pub(crate) fn join_abs_any_sep(cwd: &[u8], relative: &[&[u8]]) -> Self {
        let max_len = cwd.len() + max_joined_len::<u8, u8>(relative);
        let last = relative.iter().rfind(|part| !part.is_empty());
        let trailing_sep = last.unwrap_or(&cwd).ends_with(b"/");
        Self::build_with(|new| {
            new.edit(max_len, |buf| {
                buf.resolve_posix_any_sep(cwd, relative);
                if trailing_sep {
                    buf.push_trailing_sep();
                }
            })
        })
    }
}

impl<'a, U: PathUnit, S: PathStyle> GenericPath<SliceBackend<'a, U>, S> {
    /// An empty path. The contents of `buffer` are discarded.
    #[inline]
    pub fn new(buffer: &'a mut [U]) -> Self {
        Self {
            backend: SliceBackend::new(buffer),
            len: 0,
            style: PhantomData,
        }
    }

    #[inline]
    pub fn into_zstr(self) -> &'a U::ZSlice {
        // SAFETY: `[..len]` is initialized, `[len]` is NUL, and the buffer is borrowed for `'a`.
        unsafe { U::zslice_from_raw(self.backend.as_ptr(), self.len) }
    }
}

impl<U: PathUnit, S: PathStyle> GenericPath<VecBackend<U>, S> {
    #[inline]
    pub fn into_vec(self) -> Vec<U> {
        // SAFETY: `[..len]` is initialized.
        unsafe { self.backend.into_vec(self.len) }
    }
}

impl<S: PathStyle> GenericPath<VecBackend, S> {
    #[inline]
    pub fn into_zbox(self) -> ZBox {
        ZBox::from_vec(self.into_vec())
    }
}

impl<B: PathBackend, S: PathStyle> GenericPath<B, S> {
    #[inline(always)]
    pub(crate) fn as_slice(&self) -> &[B::Unit] {
        self
    }

    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [B::Unit] {
        // SAFETY: `[..len]` is initialized.
        unsafe { self.backend.as_uninit_slice_mut()[..self.len].assume_init_mut() }
    }

    /// See [`PathStyle::dirname`].
    #[inline]
    pub fn dirname(&self) -> Option<&[B::Unit]> {
        S::dirname(self.as_slice())
    }

    /// See [`PathStyle::basename`].
    #[inline]
    pub fn basename(&self) -> &[B::Unit] {
        S::basename(self.as_slice())
    }

    #[inline]
    pub fn truncate(&mut self, len: usize) {
        if len < self.len {
            self.backend.as_uninit_slice_mut()[len].write(*B::Unit::NUL);
            self.len = len;
        }
    }

    #[inline]
    pub fn clear(&mut self) {
        self.truncate(0);
    }

    /// Replaces the path with a copy of `path`.
    #[inline]
    pub fn set<C: PathUnit>(&mut self, path: &[C]) -> B::Output<()> {
        B::output(self.try_replace_from(0, path))
    }

    /// Appends `text` as is, without a separator.
    #[inline]
    pub fn extend_from_slice<C: PathUnit>(&mut self, text: &[C]) -> B::Output<()> {
        B::output(self.try_replace_from(self.len, text))
    }

    /// Inserts `text` as is, without a separator.
    #[inline]
    pub fn prepend(&mut self, text: &[B::Unit]) -> B::Output<()> {
        B::output(self.edit(self.len + text.len(), |buf| buf.splice(0..0, text)))
    }

    /// Backs `write!(path, ..)`. Adds no separator. Like `format!`, panics if a `Display` impl errors.
    #[inline]
    pub fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> B::Output<()> {
        let len = self.len;
        B::output(self.try_write_fmt(args).inspect_err(|_| self.truncate(len)))
    }

    /// Appends a separator and `part`, trimming its outer separators and leading `./`. Keeps `..`, and an absolute `part` does not replace the path.
    #[inline]
    pub fn push<C: PathUnit>(&mut self, part: &[C]) -> B::Output<()> {
        B::output(self.try_push(part))
    }

    /// [`Self::push`], reading `\` like [`Self::resolve_any_sep`].
    #[inline]
    pub fn push_any_sep<C: PathUnit>(&mut self, part: &[C]) -> B::Output<()> {
        if S::BACKSLASH_IS_SEP {
            return self.push(part);
        }
        let max_len = self.len + 1 + B::Unit::max_len_for(part);
        B::output(self.edit_or_retry_on_heap(max_len, |buf| buf.push_any_sep(part)))
    }

    /// [`Self::push`] of the formatted text.
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> B::Output<()> {
        let len = self.len;
        let mut result = self.try_push_fmt_in_place(args);
        if result.is_err() {
            self.truncate(len);
            if B::RETRY_ON_HEAP {
                result = self.try_push(&format_on_heap(args));
            }
        }
        B::output(result)
    }

    /// [`Self::push`], undone when the guard drops.
    #[inline]
    pub fn push_scoped<C: PathUnit>(&mut self, part: &[C]) -> B::Output<ResetScope<'_, B, S>> {
        let mut scope = self.save();
        B::output(scope.try_push(part).map(|()| scope))
    }

    /// Truncates back to the current length when the guard drops. Only append through the guard.
    #[inline]
    pub fn save(&mut self) -> ResetScope<'_, B, S> {
        ResetScope {
            len: self.len,
            #[cfg(debug_assertions)]
            checksum: checksum(self.as_slice()),
            path: self,
        }
    }

    /// Replaces the last component with a copy of `name`, or pushes `name` if there is none.
    #[inline]
    pub fn set_basename<C: PathUnit>(&mut self, name: &[C]) -> B::Output<()> {
        let (_, last) = last_component::<S>(self.as_slice());
        if last.is_empty() {
            return self.push(name);
        }
        B::output(self.try_replace_from(last.start, name))
    }

    /// `extension` includes the dot. No-op for a root, `.` or `..`.
    #[inline]
    pub fn set_extension<C: PathUnit>(&mut self, extension: &[C]) -> B::Output<()> {
        let (_, last) = last_component::<S>(self.as_slice());
        let name = &self.as_slice()[last.clone()];
        if B::Unit::lit(b"..").starts_with(name) {
            return B::output(Ok(()));
        }
        B::output(self.try_replace_from(last.start + stem_len(name), extension))
    }

    /// No-op if the path is empty or already ends with a separator.
    #[inline]
    pub fn push_trailing_sep(&mut self) -> B::Output<()> {
        B::output(self.try_push_trailing_sep())
    }

    /// Adds a trailing separator if `original` has one. For where `x/` must not mean the file `x` after `resolve`.
    #[inline]
    pub fn copy_trailing_sep_from<C: PathUnit>(&mut self, original: &[C]) -> B::Output<()> {
        if !S::has_trailing_sep(original) {
            return B::output(Ok(()));
        }
        self.push_trailing_sep()
    }

    /// [`Self::resolve`] with `self` as the first part.
    #[inline]
    pub fn resolve_in_place<C: PathUnit>(&mut self, parts: &[&[C]]) -> B::Output<()> {
        B::output(self.try_resolve::<false, C>(parts))
    }

    /// [`Self::resolve_any_sep`] with `self` as the first part. A `\` already in `self` is left alone.
    #[inline]
    pub fn resolve_any_sep_in_place<C: PathUnit>(&mut self, parts: &[&[C]]) -> B::Output<()> {
        B::output(self.try_resolve::<true, C>(parts))
    }

    /// Normalizes to `\\?\C:\a` or `\\?\UNC\server\share\a`, which lifts `MAX_PATH`. No-op unless the style is `Windows`.
    #[inline]
    pub fn make_long_path(&mut self) -> B::Output<()> {
        self.add_namespace_prefix(crate::windows::LONG_PATH_PREFIX_U8)
    }

    /// Normalizes to `\??\C:\a` or `\??\UNC\server\share\a`, for `ntdll`. No-op unless the style is `Windows`.
    #[inline]
    pub fn make_nt_path(&mut self) -> B::Output<()> {
        self.add_namespace_prefix(crate::windows::NT_OBJECT_PREFIX_U8)
    }

    /// Strips `\\?\` or `\??\` if a drive or UNC spelling exists. Leaves `\\?\Volume{..}` alone.
    #[inline]
    pub fn strip_nt_prefix(&mut self) {
        if S::WIN32 && self.len > 0 {
            let result = self.edit(self.len, |buf| buf.strip_nt_prefix());
            debug_assert!(result.is_ok());
        }
    }
}

// `inline(always)` keeps the path in registers: only the `EditBuf` is passed to out-of-line code.
impl<B: PathBackend, S: PathStyle> GenericPath<B, S> {
    /// Reserves `max_len` plus the NUL, then runs `f`, which must stay within it.
    #[inline(always)]
    fn edit(
        &mut self,
        max_len: usize,
        f: impl FnOnce(&mut EditBuf<'_, B::Unit, S>),
    ) -> Result<(), B::Error> {
        if max_len >= self.backend.as_uninit_slice_mut().len() {
            core::hint::cold_path();
            // SAFETY: `[..len]` is initialized and `max_len + 1` exceeds the capacity. The NUL is rewritten below.
            unsafe { self.backend.grow(self.len, max_len + 1) }?;
        }
        // SAFETY: `[..len]` is initialized.
        let mut buf = unsafe { EditBuf::new(self.backend.as_uninit_slice_mut(), self.len) };
        f(&mut buf);
        self.len = buf.nul_terminate();
        Ok(())
    }

    /// For an overestimated `max_len`: if it does not fit, edits a heap copy and keeps the result if that fits.
    #[inline(always)]
    fn edit_or_retry_on_heap(
        &mut self,
        max_len: usize,
        mut f: impl FnMut(&mut EditBuf<'_, B::Unit, S>),
    ) -> Result<(), B::Error> {
        let result = self.edit(max_len, &mut f);
        if result.is_ok() || !B::RETRY_ON_HEAP {
            return result;
        }
        let edited = edit_on_heap(self.as_slice(), max_len, &mut f);
        self.try_replace_from(0, &edited)
    }

    #[inline(always)]
    fn try_replace_from<C: PathUnit>(&mut self, start: usize, text: &[C]) -> Result<(), B::Error> {
        let max_len = start + B::Unit::max_len_for(text);
        let replace = |buf: &mut EditBuf<'_, B::Unit, S>| {
            buf.truncate(start);
            buf.extend_from_slice(text);
        };
        if is_max_len_exact::<B::Unit, C>() {
            self.edit(max_len, replace)
        } else {
            self.edit_or_retry_on_heap(max_len, replace)
        }
    }

    #[inline(always)]
    fn try_push<C: PathUnit>(&mut self, part: &[C]) -> Result<(), B::Error> {
        let part = TrimmedPart::new::<S>(self.as_slice(), part);
        let max_len = self.len + part.max_len::<B::Unit>();
        if is_max_len_exact::<B::Unit, C>() && !S::BACKSLASH_IS_SEP {
            self.edit(max_len, |buf| buf.push(&part))
        } else {
            self.edit_or_retry_on_heap(max_len, |buf| buf.push(&part))
        }
    }

    #[inline(always)]
    fn try_push_trailing_sep(&mut self) -> Result<(), B::Error> {
        if self.len == 0 || S::has_trailing_sep(self.as_slice()) {
            return Ok(());
        }
        self.edit(self.len + 1, |buf| buf.push_trailing_sep())
    }

    #[inline(always)]
    fn try_push_fmt_in_place(&mut self, args: fmt::Arguments<'_>) -> Result<(), B::Error> {
        let old_len = self.len;
        self.try_push_trailing_sep()?;
        let start = self.len;
        self.try_write_fmt(args)?;
        let mut max_len = self.len;
        if S::BACKSLASH_IS_SEP {
            max_len += NORMALIZE_OVERHEAD;
        }
        self.edit_or_retry_on_heap(max_len, |buf| buf.trim_appended_part(old_len, start))
    }

    fn try_write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), B::Error> {
        struct Writer<'a, B: PathBackend, S: PathStyle> {
            path: &'a mut GenericPath<B, S>,
            result: Result<(), B::Error>,
        }
        impl<B: PathBackend, S: PathStyle> fmt::Write for Writer<'_, B, S> {
            #[inline]
            fn write_str(&mut self, text: &str) -> fmt::Result {
                if self.result.is_ok() {
                    self.result = self.path.try_replace_from(self.path.len, text.as_bytes());
                }
                self.result.as_ref().map(|_| ()).map_err(|_| fmt::Error)
            }
        }
        let mut writer = Writer {
            path: self,
            result: Ok(()),
        };
        let formatted = fmt::write(&mut writer, args);
        writer.result?;
        formatted.expect("a formatting trait implementation returned an error");
        Ok(())
    }

    #[inline(always)]
    pub(crate) fn try_join<C: PathUnit>(&mut self, parts: &[&[C]]) -> Result<(), B::Error> {
        let max_len = self.len + max_joined_len::<B::Unit, C>(parts);
        self.edit_or_retry_on_heap(max_len, |buf| buf.join(parts))
    }

    #[inline(always)]
    fn try_resolve<const ANY_SEP: bool, C: PathUnit>(
        &mut self,
        parts: &[&[C]],
    ) -> Result<(), B::Error> {
        let (kept_len, parts) = match last_absolute_posix_part::<S>(parts) {
            Some(index) => (0, &parts[index..]),
            None => (self.len, parts),
        };
        let max_len = kept_len + max_joined_len::<B::Unit, C>(parts);
        self.edit_or_retry_on_heap(max_len, |buf| {
            buf.truncate(kept_len);
            if ANY_SEP {
                buf.resolve_any_sep(parts);
            } else {
                buf.resolve(parts);
            }
        })
    }

    /// `self` is empty.
    #[inline(always)]
    pub(crate) fn try_relative<const ANY_SEP: bool>(
        &mut self,
        from: &[B::Unit],
        to: &[B::Unit],
    ) -> Result<(), B::Error> {
        if let Some(from) = Resolved::try_borrow::<S, ANY_SEP>(from)
            && let Some(to) = Resolved::try_borrow::<S, ANY_SEP>(to)
        {
            let relative = Relative::new::<S>(from, to);
            let max_len = relative.max_len::<S>();
            return self.edit_or_retry_on_heap(max_len, |buf| buf.write_relative(&relative));
        }
        let (from, to) = (Unresolved::new::<S>(from), Unresolved::new::<S>(to));
        self.edit_or_retry_on_heap(max_relative_len(from, to), |buf| {
            if ANY_SEP && !S::BACKSLASH_IS_SEP {
                buf.resolve_and_write_relative::<true>(from, to);
            } else {
                buf.resolve_and_write_relative::<false>(from, to);
            }
        })
    }

    #[inline(always)]
    fn add_namespace_prefix(&mut self, prefix: [u8; 4]) -> B::Output<()> {
        if S::SEP != b'\\' {
            return B::output(Ok(()));
        }
        let max_len = self.len + NAMESPACE_OVERHEAD;
        B::output(self.edit_or_retry_on_heap(max_len, |buf| buf.add_namespace_prefix(prefix)))
    }
}

/// See [`PathUnit::max_len_for`].
#[inline(always)]
const fn is_max_len_exact<To: PathChar, From: PathChar>() -> bool {
    !To::IS_U16 || From::IS_U16
}

#[cold]
#[inline(never)]
fn edit_on_heap<U: PathUnit, S: PathStyle>(
    path: &[U],
    max_len: usize,
    f: &mut dyn FnMut(&mut EditBuf<'_, U, S>),
) -> Vec<U> {
    let mut copy = GenericPath::<VecBackend<U>, S>::from(path);
    let Ok(()) = copy.edit(max_len, f);
    copy.into_vec()
}

#[cold]
#[inline(never)]
fn format_on_heap(args: fmt::Arguments<'_>) -> VecPath {
    let mut text = VecPath::new();
    text.write_fmt(args);
    text
}

#[cfg(debug_assertions)]
fn checksum<U: PathUnit>(units: &[U]) -> u32 {
    let step = |sum: u32, unit: &U| sum.wrapping_mul(31).wrapping_add(unit.as_u32());
    units.iter().fold(0, step)
}

/// See [`GenericPath::save`].
#[must_use]
pub struct ResetScope<'a, B: PathBackend, S: PathStyle> {
    path: &'a mut GenericPath<B, S>,
    len: usize,
    #[cfg(debug_assertions)]
    checksum: u32,
}

impl<B: PathBackend, S: PathStyle> Deref for ResetScope<'_, B, S> {
    type Target = GenericPath<B, S>;

    #[inline(always)]
    fn deref(&self) -> &GenericPath<B, S> {
        self.path
    }
}

impl<B: PathBackend, S: PathStyle> DerefMut for ResetScope<'_, B, S> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut GenericPath<B, S> {
        self.path
    }
}

impl<B: PathBackend, S: PathStyle> Drop for ResetScope<'_, B, S> {
    #[inline]
    fn drop(&mut self) {
        self.path.truncate(self.len);
        #[cfg(debug_assertions)]
        assert_eq!(checksum(self.path.as_slice()), self.checksum);
    }
}
