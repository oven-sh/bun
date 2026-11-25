//! An owned, always NUL-terminated path buffer. No content or length makes it panic.

use core::fmt;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use crate::path_backend::{HeapBackend, PathBackend, StackBackend};
use crate::path_ops::{
    EditBuf, LONG_PATH_PREFIX, NAMESPACE_OVERHEAD, NORMALIZE_OVERHEAD, NT_PATH_PREFIX, Relative,
    Resolved, TrimmedPart, Unresolved, last_absolute_posix_part, max_joined_len, max_relative_len,
};
use crate::path_style::{Host, PathStyle, Root, last_component, stem_len};
use crate::path_unit::PathUnit;
use crate::{NameTooLong, OSPathChar, PathChar};

/// The default. On the heap. Grows to any length, so the syscall reports `ENAMETOOLONG`.
pub type Path = GenericPath<HeapBackend>;
/// In an inline `[u8; N]`, NUL included. `NameTooLong` if a result does not fit. Can allocate to find that out.
pub type StackPath<const N: usize> = GenericPath<StackBackend<N>>;
/// [`Path`] in the encoding that syscalls take. For names that go from one syscall to the next.
pub type OSPath = GenericPath<HeapBackend<OSPathChar>>;

type ZSlice<B> = <<B as PathBackend>::Unit as PathUnit>::ZSlice;

/// Derefs to `ZStr` or `WStr`. Most arguments can be `&[u8]` or `&[u16]`. On `Err` the path is unchanged.
pub struct GenericPath<B: PathBackend, S: PathStyle = Host> {
    /// `[..len]` is initialized and `[len]` is NUL.
    backend: B,
    len: usize,
    /// Only tests set it, to run the code of each platform on every platform.
    style: PhantomData<S>,
}

// SAFETY: a length of 0, and a NUL after it.
unsafe impl<const N: usize> bun_core::Zeroable for StackPath<N> {}

impl<B: PathBackend, S: PathStyle> Deref for GenericPath<B, S> {
    type Target = ZSlice<B>;

    #[inline(always)]
    fn deref(&self) -> &ZSlice<B> {
        // SAFETY: `[..len]` is initialized and `[len]` is NUL.
        unsafe { B::Unit::zslice_from_raw(self.backend.as_ptr(), self.len) }
    }
}

impl<B: PathBackend, S: PathStyle> Default for GenericPath<B, S> {
    #[inline(always)]
    fn default() -> Self {
        Self {
            backend: B::default(),
            len: 0,
            style: PhantomData,
        }
    }
}

impl<B: PathBackend, S: PathStyle> GenericPath<B, S> {
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

    /// Like Node's `path.join`. On Windows all three read roots as Win32 does, and write `C:` for a leading `c:`.
    #[inline]
    pub fn join<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        Self::build_with(|new| new.try_join(parts))
    }

    /// Like Node's `path.resolve`, but the result stays relative if no part is absolute.
    #[inline]
    pub fn resolve<C: PathUnit>(parts: &[&[C]]) -> B::Output<Self> {
        Self::build_with(|new| new.try_resolve(parts))
    }

    /// Like Node's `path.relative`, against the top-level directory. Returns `to` if it is on another drive or share.
    #[inline]
    pub fn relative(from: &[B::Unit], to: &[B::Unit]) -> B::Output<Self> {
        Self::build_with(|new| new.try_relative(from, to))
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

    /// See [`crate::dirname`].
    #[inline]
    pub fn dirname(&self) -> Option<&[B::Unit]> {
        S::dirname(self.as_slice())
    }

    /// See [`crate::basename`].
    #[inline]
    pub fn basename(&self) -> &[B::Unit] {
        S::basename(self.as_slice())
    }

    /// `Err` if the path does not fit a `PathBuffer`, or a `WPathBuffer`. For where no syscall is there to refuse it.
    #[inline]
    pub fn check_len(self) -> Result<Self, NameTooLong> {
        match self.len < B::Unit::PATH_MAX {
            true => Ok(self),
            false => Err(NameTooLong),
        }
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

    /// [`Self::push`] of the formatted text.
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> B::Output<()> {
        let len = self.len;
        let mut result = self.try_push_fmt_in_place(args);
        if result.is_err() {
            self.truncate(len);
            result = self.try_push(&format_on_heap(args));
        }
        B::output(result)
    }

    /// [`Self::push`], but `.` and `..` are resolved, and `..` stops where `part` starts.
    #[inline]
    pub fn push_inside<C: PathUnit>(&mut self, part: &[C]) -> B::Output<()> {
        let max_len = self.len + max_joined_len::<B::Unit, C>(&[part]);
        B::output(self.edit_or_retry_on_heap(max_len, |buf| buf.push_inside(part)))
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
        B::output(self.try_resolve(parts))
    }

    /// Normalizes, drops a trailing separator, and lifts `MAX_PATH` with `\\?\` for `C:\a` or a share. Keeps `\\?\a` and `\\.\a`. No-op on POSIX.
    #[inline]
    pub fn make_long_path(&mut self) -> B::Output<()> {
        self.add_namespace_prefix(LONG_PATH_PREFIX)
    }

    /// Normalizes for `ntdll`, which takes `\??\C:\a` or `\??\UNC\server\share\a`. A relative path gets no prefix. No-op on POSIX.
    #[inline]
    pub fn make_nt_path(&mut self) -> B::Output<()> {
        self.add_namespace_prefix(NT_PATH_PREFIX)
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

impl<B: PathBackend<Unit = u8>> GenericPath<B> {
    /// See [`crate::to_portable`]. Later edits write this platform's separator again.
    #[inline(always)]
    pub fn into_portable(mut self) -> Self {
        if cfg!(windows) {
            crate::to_portable_in_place(self.as_mut_slice());
        }
        self
    }

    /// On Windows `\a` becomes `C:\a`, with the drive or share of the process's working directory.
    #[inline]
    pub fn add_current_drive(&mut self) -> B::Output<()> {
        if cfg!(windows) && Root::parse::<Host>(self.as_slice()) == Root::without_volume(true) {
            let mut buf = crate::path_buffer_pool::get();
            if let Ok(cwd) = bun_core::getcwd(&mut buf) {
                let volume = Host::volume(cwd.as_bytes());
                return B::output(self.edit(self.len + volume.len(), |buf| {
                    buf.splice(0..1, &[Host::SEP]);
                    buf.splice(0..0, volume);
                }));
            }
        }
        B::output(Ok(()))
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
        if result.is_ok() {
            return result;
        }
        let edited = edit_on_heap(self.as_slice(), max_len, &mut f);
        self.try_replace_from(0, edited.as_slice())
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
        if is_max_len_exact::<B::Unit, C>() && !S::WIN32 {
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
        if S::WIN32 {
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
    fn try_resolve<C: PathUnit>(&mut self, parts: &[&[C]]) -> Result<(), B::Error> {
        let (kept_len, parts) = match last_absolute_posix_part::<S>(parts) {
            Some(index) => (0, &parts[index..]),
            None => (self.len, parts),
        };
        let max_len = kept_len + max_joined_len::<B::Unit, C>(parts);
        self.edit_or_retry_on_heap(max_len, |buf| {
            buf.truncate(kept_len);
            buf.resolve(parts);
        })
    }

    /// `self` is empty.
    #[inline(always)]
    pub(crate) fn try_relative(
        &mut self,
        from: &[B::Unit],
        to: &[B::Unit],
    ) -> Result<(), B::Error> {
        if let Some(from) = Resolved::try_borrow::<S>(from)
            && let Some(to) = Resolved::try_borrow::<S>(to)
        {
            let relative = Relative::new::<S>(from, to);
            let max_len = relative.max_len::<S>();
            return self.edit_or_retry_on_heap(max_len, |buf| buf.write_relative(&relative));
        }
        let [from, to] = Unresolved::pair::<S>(from, to);
        self.edit_or_retry_on_heap(max_relative_len(from, to), |buf| {
            buf.resolve_and_write_relative(from, to);
        })
    }

    #[inline(always)]
    fn add_namespace_prefix(&mut self, prefix: [u8; 4]) -> B::Output<()> {
        if !S::WIN32 || self.len == 0 {
            return B::output(Ok(()));
        }
        let max_len = self.len + NAMESPACE_OVERHEAD;
        B::output(self.edit_or_retry_on_heap(max_len, |buf| buf.add_namespace_prefix(prefix)))
    }
}

/// See [`PathUnit::max_len_for`].
#[inline(always)]
const fn is_max_len_exact<To: PathChar, From: PathChar>() -> bool {
    To::IS_U16 == From::IS_U16
}

#[cold]
#[inline(never)]
fn edit_on_heap<U: PathUnit, S: PathStyle>(
    path: &[U],
    max_len: usize,
    f: &mut dyn FnMut(&mut EditBuf<'_, U, S>),
) -> GenericPath<HeapBackend<U>, S> {
    let mut copy = GenericPath::<HeapBackend<U>, S>::from(path);
    let Ok(()) = copy.edit(max_len, f);
    copy
}

#[cold]
#[inline(never)]
fn format_on_heap(args: fmt::Arguments<'_>) -> Path {
    let mut text = Path::new();
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
