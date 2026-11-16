//! A path that is being built: always NUL-terminated, never a panic over what is in it or how long it is.

use core::fmt;
use core::marker::PhantomData;
use core::ops::{Deref, DerefMut};

use bun_core::ZBox;

use crate::backend::sealed::Storage;
use crate::backend::{
    Backend, Borrowed, Boxed, Heap, NameTooLong, Out, Overflow, Pool, Pooled, Spill, Stack,
};
use crate::path_buffer_pool::PathBufferPoolT;
use crate::path_unit::sealed::Kernels;
use crate::platform::{Auto, Posix, Slash};
use crate::style::{ends_with_sep, last_name, len_without_seps, stem_len};
use crate::tidy::{self, Pushed, Relative, Resolved, Units, Unresolved};
use crate::{OSPathChar, PathChar, PathUnit, Style};

/// The one to use by default: a pooled buffer, and no errors, because the system call reports a path that is too long.
pub type Path = PathIn<Spill>;
/// For what must fit in a `PathBuffer`.
pub type PoolPath = PathIn<Pool>;
/// [`PoolPath`] in the unit of the system's calls.
pub type OsPath = PathIn<Pool<OSPathChar>>;
/// For what is kept, and for more paths at a time than the pool has buffers.
pub type VecPath = PathIn<Heap>;
/// For what is known to be short, and for where nothing may be allocated.
pub type StackPath<const N: usize> = PathIn<Stack<N>>;
/// For a result that outlives the function that builds it in its caller's buffer.
pub type SlicePath<'a> = PathIn<Borrowed<'a>>;
/// [`Path`] with `/` on every system.
pub type SlashPath = PathIn<Spill, Slash>;

type Z<B> = <<B as Storage>::Unit as Kernels>::Z;
type Buffer<B> = <<B as Storage>::Unit as Kernels>::Buffer;

/// Dereferences to `ZStr` or `WStr`. Arguments can be of either unit. An operation that fails changes nothing.
pub struct PathIn<B: Backend, S: Style = Auto> {
    /// `len` units and a NUL are initialized.
    backend: B,
    len: usize,
    style: PhantomData<S>,
}

impl<B: Backend, S: Style> Deref for PathIn<B, S> {
    type Target = Z<B>;

    #[inline(always)]
    fn deref(&self) -> &Z<B> {
        // SAFETY: the invariant of `backend`.
        unsafe { B::Unit::z(self.backend.as_ptr(), self.len) }
    }
}

impl<B: Boxed, S: Style> Default for PathIn<B, S> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

impl<B: Boxed, S: Style> PathIn<B, S> {
    /// Allocates nothing.
    #[inline(always)]
    pub const fn new() -> Self {
        Self::empty(B::EMPTY)
    }

    #[inline(always)]
    fn built(build: impl FnOnce(&mut Self) -> Result<(), B::Error>) -> Out<B, Self> {
        let mut path = Self::new();
        B::Error::out(build(&mut path).map(|()| path))
    }

    /// See [`Self::set`].
    #[inline]
    pub fn from<C: PathUnit>(path: &[C]) -> Out<B, Self> {
        Self::built(|it| it.try_replace_from(0, path))
    }

    /// [`Self::push`] of each part, in one allocation.
    #[inline]
    pub fn from_parts<C: PathUnit>(parts: &[&[C]]) -> Out<B, Self> {
        Self::built(|it| {
            let room = tidy::room_for_parts::<B::Unit, C>(parts);
            it.rewrite(room + tidy::SLACK, |units| {
                for part in parts {
                    Pushed::new::<S, _>(units.as_slice(), part).write::<S, _>(units);
                }
            })
        })
    }

    /// Without a separator at its end, unless it is a root.
    #[inline]
    pub fn top_level_dir() -> Out<B, Self> {
        Self::built(|it| it.try_push(crate::fs::top_level_dir()))
    }

    /// See [`Self::join`].
    #[inline]
    pub fn joined<C: PathUnit>(parts: &[&[C]]) -> Out<B, Self> {
        Self::built(|it| it.try_join(parts))
    }

    /// See [`Self::resolve`].
    #[inline]
    pub fn resolved<C: PathUnit>(parts: &[&[C]]) -> Out<B, Self> {
        Self::built(|it| it.try_resolve(parts, tidy::resolve::<S, _, C>))
    }

    /// See [`Self::resolve_portable`].
    #[inline]
    pub fn resolved_portable<C: PathUnit>(parts: &[&[C]]) -> Out<B, Self> {
        Self::built(|it| it.try_resolve(parts, tidy::resolve_portable::<S, _, C>))
    }

    /// See [`Self::set_relative`].
    #[inline]
    pub fn relative(from: &[B::Unit], to: &[B::Unit]) -> Out<B, Self> {
        Self::built(|it| it.try_set_relative::<false>(from, to))
    }

    /// See [`Self::set_relative_portable`].
    #[inline]
    pub fn relative_portable(from: &[B::Unit], to: &[B::Unit]) -> Out<B, Self> {
        Self::built(|it| it.try_set_relative_portable(from, to))
    }
}

impl PathIn<Spill, Posix> {
    /// [`Self::resolved_portable`] of `absolute` and `relative`.
    #[inline]
    pub(crate) fn resolved_portable_below(absolute: &[u8], relative: &[&[u8]]) -> Self {
        Self::built(|it| {
            let room = absolute.len() + tidy::room_for_parts::<u8, u8>(relative) + tidy::SLACK;
            it.edit(room, |units| {
                tidy::join_portable::<Posix, _, _>(units, absolute, relative);
            })
        })
    }
}

impl<B: Pooled, S: Style> PathIn<B, S> {
    /// What `fill` returns, which is not copied if it is at the start of the buffer that `fill` is given.
    #[inline]
    pub fn filled<E>(
        fill: impl for<'b> FnOnce(&'b mut Buffer<B>) -> Result<&'b [B::Unit], E>,
    ) -> Result<Out<B, Self>, E> {
        let mut buffer = PathBufferPoolT::<Buffer<B>>::get();
        let start = buffer.as_ptr();
        let filled = fill(&mut buffer)?;
        let len = filled.len();
        if filled.as_ptr() != start || len >= B::Unit::POOLED_LEN {
            return Ok(Self::from(filled));
        }
        buffer[len] = *B::Unit::NUL;
        let mut path = Self::new();
        // SAFETY: `path` is new. All of `buffer` is initialized, with a NUL at `len`.
        unsafe { path.backend.adopt(buffer.into_box()) };
        path.len = len;
        Ok(B::Error::out(Ok(path)))
    }
}

impl<const N: usize, U: PathUnit, S: Style> PathIn<Stack<N, U>, S> {
    /// The only constructor: all `N` units of a path in a `Result` are copied to get it out.
    #[inline(always)]
    pub const fn new() -> Self {
        Self::empty(Stack::new())
    }
}

impl<'a, U: PathUnit, S: Style> PathIn<Borrowed<'a, U>, S> {
    #[inline]
    pub fn new_in(buffer: &'a mut [U]) -> Self {
        Self::empty(Borrowed::new(buffer))
    }

    #[inline]
    pub fn into_z(self) -> &'a U::Z {
        // SAFETY: the invariant of `backend`, which has borrowed the units for `'a`.
        unsafe { U::z(self.backend.as_ptr(), self.len) }
    }
}

impl<U: PathUnit, S: Style> PathIn<Heap<U>, S> {
    #[inline]
    pub fn from_vec(mut path: Vec<U>) -> Self {
        let len = path.len();
        path.push(*U::NUL);
        Self {
            len,
            ..Self::empty(Heap::from_vec(path))
        }
    }

    /// Without the NUL.
    #[inline]
    pub fn into_vec(self) -> Vec<U> {
        // SAFETY: the invariant of `backend`.
        unsafe { self.backend.into_vec(self.len) }
    }
}

impl<S: Style> PathIn<Heap, S> {
    #[inline]
    pub fn into_zbox(self) -> ZBox {
        ZBox::from_vec(self.into_vec())
    }
}

impl<B: Backend, S: Style> PathIn<B, S> {
    #[inline(always)]
    const fn empty(backend: B) -> Self {
        Self {
            backend,
            len: 0,
            style: PhantomData,
        }
    }

    /// `edit` never makes the path longer than `room`, and fails if that is not available.
    #[inline(always)]
    fn edit(
        &mut self,
        room: usize,
        edit: impl FnOnce(&mut Units<'_, B::Unit>),
    ) -> Result<(), B::Error> {
        if room >= self.backend.capacity() {
            core::hint::cold_path();
            // SAFETY: the invariant of `backend`, and the condition above. `finish` writes the NUL.
            unsafe { self.backend.grow(self.len, room + 1) }?;
        }
        // SAFETY: the invariant of `backend`.
        let mut units = unsafe { Units::new(self.backend.all(), self.len) };
        edit(&mut units);
        self.len = units.finish();
        Ok(())
    }

    /// [`Self::edit`] for a result that can be shorter than `room`.
    #[inline(always)]
    fn rewrite(
        &mut self,
        room: usize,
        mut edit: impl FnMut(&mut Units<'_, B::Unit>),
    ) -> Result<(), B::Error> {
        let in_place = self.edit(room, &mut edit);
        if in_place.is_ok() || !B::RETRIES_ON_HEAP {
            return in_place;
        }
        let edited = edit_on_heap(self.as_slice(), room, &mut edit);
        self.try_replace_from(0, &edited)
    }

    /// [`Self::edit`] or [`Self::rewrite`], depending on whether `room_for` is exact.
    #[inline(always)]
    fn write<C: PathUnit>(
        &mut self,
        room: usize,
        edit: impl FnMut(&mut Units<'_, B::Unit>),
    ) -> Result<(), B::Error> {
        if B::Unit::IS_U16 && !C::IS_U16 {
            self.rewrite(room, edit)
        } else {
            self.edit(room, edit)
        }
    }

    #[inline(always)]
    fn try_replace_from<C: PathUnit>(&mut self, start: usize, with: &[C]) -> Result<(), B::Error> {
        self.write::<C>(start + B::Unit::room_for(with), |units| {
            units.truncate(start);
            units.extend(with);
        })
    }

    #[inline(always)]
    fn try_push_at<C: PathUnit>(
        &mut self,
        len: usize,
        pushed: &Pushed<'_, C>,
    ) -> Result<(), B::Error> {
        let room = len + pushed.room::<B::Unit>();
        let edit = |units: &mut Units<'_, B::Unit>| {
            units.truncate(len);
            pushed.write::<S, _>(units);
        };
        if S::LOOSE {
            self.rewrite(room, edit)
        } else {
            self.write::<C>(room, edit)
        }
    }

    #[inline(always)]
    fn try_push<C: PathUnit>(&mut self, part: &[C]) -> Result<(), B::Error> {
        self.try_push_at(self.len, &Pushed::new::<S, _>(self.as_slice(), part))
    }

    #[inline(always)]
    fn try_join<C: PathUnit>(&mut self, parts: &[&[C]]) -> Result<(), B::Error> {
        let room = self.len + tidy::room_for_parts::<B::Unit, C>(parts) + tidy::SLACK;
        self.rewrite(room, |units| tidy::join::<S, _, C>(units, parts))
    }

    #[inline(always)]
    fn try_resolve<C: PathUnit>(
        &mut self,
        parts: &[&[C]],
        resolve: impl Fn(&mut Units<'_, B::Unit>, &[&[C]]),
    ) -> Result<(), B::Error> {
        let (len, parts) = match tidy::last_fully_qualified::<S, C>(parts) {
            Some(index) => (0, &parts[index..]),
            None => (self.len, parts),
        };
        let room = len + tidy::room_for_parts::<B::Unit, C>(parts) + tidy::SLACK;
        self.rewrite(room, |units| {
            units.truncate(len);
            resolve(units, parts);
        })
    }

    #[inline(always)]
    fn try_set_relative<const PORTABLE: bool>(
        &mut self,
        from: &[B::Unit],
        to: &[B::Unit],
    ) -> Result<(), B::Error> {
        if let Some(from) = Resolved::as_is::<S, PORTABLE>(from)
            && let Some(to) = Resolved::as_is::<S, PORTABLE>(to)
        {
            let relative = Relative::new::<S>(from, to);
            return self.rewrite(relative.room::<S>(), |units| relative.write::<S>(units));
        }
        let (from, to) = (Unresolved::new::<S>(from), Unresolved::new::<S>(to));
        let room = tidy::room_for_relative(from, to);
        self.rewrite(room, |units| {
            tidy::relative::<S, _, PORTABLE>(units, from, to)
        })
    }

    #[inline(always)]
    fn try_set_relative_portable(
        &mut self,
        from: &[B::Unit],
        to: &[B::Unit],
    ) -> Result<(), B::Error> {
        match S::LOOSE {
            true => self.try_set_relative::<false>(from, to),
            false => self.try_set_relative::<true>(from, to),
        }
    }

    fn try_write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), B::Error> {
        struct Sink<'a, B: Backend, S: Style>(&'a mut PathIn<B, S>, Result<(), B::Error>);
        impl<B: Backend, S: Style> fmt::Write for Sink<'_, B, S> {
            #[inline]
            fn write_str(&mut self, text: &str) -> fmt::Result {
                if self.1.is_ok() {
                    self.1 = self.0.try_replace_from(self.0.len, text.as_bytes());
                }
                self.1.as_ref().map(|_| ()).map_err(|_| fmt::Error)
            }
        }
        let mut sink = Sink(self, Ok(()));
        let formatted = fmt::write(&mut sink, args);
        sink.1?;
        formatted.expect("a formatting trait implementation returned an error");
        Ok(())
    }

    #[inline(always)]
    pub fn as_slice(&self) -> &[B::Unit] {
        self
    }

    /// For changes that keep the length.
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [B::Unit] {
        // SAFETY: the invariant of `backend`.
        unsafe { self.backend.all()[..self.len].assume_init_mut() }
    }

    /// What follows the first `start` units.
    #[inline]
    pub fn tail(&self, start: usize) -> &Z<B> {
        let start = start.min(self.len);
        // SAFETY: the invariant of `backend`.
        unsafe { B::Unit::z(self.backend.as_ptr().add(start), self.len - start) }
    }

    /// See [`Style::dirname`].
    #[inline]
    pub fn dirname(&self) -> Option<&[B::Unit]> {
        S::dirname(self.as_slice())
    }

    /// See [`Style::basename`].
    #[inline]
    pub fn basename(&self) -> &[B::Unit] {
        S::basename(self.as_slice())
    }

    /// Does nothing if the path is not longer.
    #[inline]
    pub fn truncate(&mut self, len: usize) {
        if len < self.len {
            self.backend.all()[len].write(*B::Unit::NUL);
            self.len = len;
        }
    }

    #[inline]
    pub fn clear(&mut self) {
        self.truncate(0);
    }

    /// Copies `path` as it is.
    #[inline]
    pub fn set<C: PathUnit>(&mut self, path: &[C]) -> Out<B, ()> {
        B::Error::out(self.try_replace_from(0, path))
    }

    /// Adds `text` as it is, without a separator.
    #[inline]
    pub fn append<C: PathUnit>(&mut self, text: &[C]) -> Out<B, ()> {
        B::Error::out(self.try_replace_from(self.len, text))
    }

    /// [`Self::append`] for `write!`. Like `format!`, it panics if a `Display` fails for a reason of its own.
    #[inline]
    pub fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Out<B, ()> {
        let len = self.len;
        B::Error::out(self.try_write_fmt(args).inspect_err(|_| self.truncate(len)))
    }

    /// Adds a separator and `part`, less the separators around it and any `./` at its start. `..` stays, and a root only counts in an empty path.
    #[inline]
    pub fn push<C: PathUnit>(&mut self, part: &[C]) -> Out<B, ()> {
        B::Error::out(self.try_push(part))
    }

    /// [`Self::push`] for what may have been written on Windows. See [`Self::resolve_portable`].
    #[inline]
    pub fn push_portable<C: PathUnit>(&mut self, part: &[C]) -> Out<B, ()> {
        if S::LOOSE {
            return self.push(part);
        }
        let room = self.len + 1 + B::Unit::room_for(part);
        B::Error::out(self.rewrite(room, |units| tidy::push_portable::<S, _, C>(units, part)))
    }

    /// [`Self::push`] of what `args` print. See [`Self::write_fmt`].
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> Out<B, ()> {
        let len = self.len;
        let mut push_in_place = || {
            self.try_end_with_sep()?;
            let start = self.len;
            self.try_write_fmt(args)?;
            let room = self.len + if S::LOOSE { tidy::SLACK } else { 0 };
            self.rewrite(room, |units| tidy::push_appended::<S, _>(units, len, start))
        };
        B::Error::out(push_in_place().or_else(|too_long| {
            self.truncate(len);
            match B::RETRIES_ON_HEAP {
                true => self.try_push(&format_on_heap(args)),
                false => Err(too_long),
            }
        }))
    }

    /// Removes the last name. False if there is none.
    #[inline]
    pub fn pop(&mut self) -> bool {
        let (root, start, end) = last_name::<S, _>(self.as_slice());
        if start < end {
            self.truncate(len_without_seps::<S, _>(
                &self.as_slice()[..start],
                root.len,
            ));
        }
        start < end
    }

    /// [`Self::pop`], then [`Self::push`].
    #[inline]
    pub fn set_basename<C: PathUnit>(&mut self, name: &[C]) -> Out<B, ()> {
        let (root, start, end) = last_name::<S, _>(self.as_slice());
        let len = len_without_seps::<S, _>(&self.as_slice()[..start], root.len);
        let mut pushed = Pushed::new::<S, _>(&self.as_slice()[..len], name);
        if len == start && start < end {
            pushed = pushed.without_sep();
        }
        B::Error::out(self.try_push_at(len, &pushed))
    }

    /// Replaces [`Style::extension`] and the separators after it. Does nothing to a root, `.` or `..`.
    #[inline]
    pub fn set_extension<C: PathUnit>(&mut self, extension: &[C]) -> Out<B, ()> {
        let (_, start, end) = last_name::<S, _>(self.as_slice());
        let name = &self.as_slice()[start..end];
        if B::Unit::lit(b"..").starts_with(name) {
            return B::Error::out(Ok(()));
        }
        B::Error::out(self.try_replace_from(start + stem_len(name), extension))
    }

    /// Replaces the first `len` units.
    #[inline]
    pub fn replace_prefix(&mut self, len: usize, with: &[B::Unit]) -> Out<B, ()> {
        let len = len.min(self.len);
        let room = self.len - len + with.len();
        B::Error::out(self.edit(room, |units| units.splice(0, len, with)))
    }

    #[inline(always)]
    fn try_end_with_sep(&mut self) -> Result<(), B::Error> {
        if self.len == 0 || ends_with_sep::<S, _>(self.as_slice()) {
            return Ok(());
        }
        self.edit(self.len + 1, |units| units.push(S::SEP))
    }

    /// An empty path stays empty.
    #[inline]
    pub fn end_with_sep(&mut self) -> Out<B, ()> {
        B::Error::out(self.try_end_with_sep())
    }

    /// See [`Style::without_trailing_sep`].
    #[inline]
    pub fn trim_trailing_sep(&mut self) {
        self.truncate(S::without_trailing_sep(self.as_slice()).len());
    }

    /// Node's `path.normalize`.
    #[inline]
    pub fn normalize(&mut self) -> Out<B, ()> {
        B::Error::out(self.rewrite(self.len + tidy::SLACK, tidy::normalize::<S, _>))
    }

    /// Node's `path.join(self, ...parts)`.
    #[inline]
    pub fn join<C: PathUnit>(&mut self, parts: &[&[C]]) -> Out<B, ()> {
        B::Error::out(self.try_join(parts))
    }

    /// Node's `path.resolve(self, ...parts)`, but it keeps a separator at the end and does not fall back on the working directory.
    #[inline]
    pub fn resolve<C: PathUnit>(&mut self, parts: &[&[C]]) -> Out<B, ()> {
        B::Error::out(self.try_resolve(parts, tidy::resolve::<S, _, C>))
    }

    /// [`Self::resolve`] for what somebody has written, maybe on Windows. A `\` is a separator, unless it is in an absolute part, in a name that a working directory or the home has too. At the end, only the separator of the style is kept.
    #[inline]
    pub fn resolve_portable<C: PathUnit>(&mut self, parts: &[&[C]]) -> Out<B, ()> {
        B::Error::out(self.try_resolve(parts, tidy::resolve_portable::<S, _, C>))
    }

    /// Node's `path.relative`, with [`top_level_dir`](bun_core::top_level_dir) for the working directory. `to` if it is on another volume.
    #[inline]
    pub fn set_relative(&mut self, from: &[B::Unit], to: &[B::Unit]) -> Out<B, ()> {
        B::Error::out(self.try_set_relative::<false>(from, to))
    }

    /// [`Self::set_relative`] for what is printed or saved. The operands are read as by [`Self::resolve_portable`], and no `\` is left in a name.
    #[inline]
    pub fn set_relative_portable(&mut self, from: &[B::Unit], to: &[B::Unit]) -> Out<B, ()> {
        B::Error::out(self.try_set_relative_portable(from, to))
    }

    #[inline(always)]
    fn add_namespace(&mut self, prefix: [u8; 4]) -> Out<B, ()> {
        if S::SEP != b'\\' {
            return B::Error::out(Ok(()));
        }
        let room = self.len + tidy::ROOM_FOR_NAMESPACE;
        B::Error::out(self.rewrite(room, |units| tidy::add_namespace::<S, _>(units, prefix)))
    }

    /// `\\?\C:\a` or `\\?\UNC\server\share\a`, which lifts `MAX_PATH`. Normalizes. Only does something to Windows paths.
    #[inline]
    pub fn add_long_prefix(&mut self) -> Out<B, ()> {
        self.add_namespace(crate::windows::LONG_PATH_PREFIX_U8)
    }

    /// `\??\C:\a` or `\??\UNC\server\share\a`, for `ntdll`. Normalizes. Only does something to Windows paths.
    #[inline]
    pub fn add_nt_prefix(&mut self) -> Out<B, ()> {
        self.add_namespace(crate::windows::NT_OBJECT_PREFIX_U8)
    }

    /// Undoes either of the above. `\\?\Volume{..}\a` has no other name and stays.
    #[inline]
    pub fn remove_win32_prefix(&mut self) {
        if S::WIN32 && self.len > 0 {
            let edited = self.edit(self.len, tidy::remove_namespace::<S, _>);
            debug_assert!(edited.is_ok());
        }
    }

    /// Cuts the path back to its length when dropped. What it has now must not be changed in the meantime.
    #[inline]
    pub fn scope(&mut self) -> Scope<'_, B, S> {
        Scope {
            len: self.len,
            #[cfg(debug_assertions)]
            checksum: checksum(self.as_slice()),
            path: self,
        }
    }

    /// [`Self::scope`], then [`Self::push`].
    #[inline]
    pub fn child<C: PathUnit>(&mut self, part: &[C]) -> Out<B, Scope<'_, B, S>> {
        let mut scope = self.scope();
        B::Error::out(scope.try_push(part).map(|()| scope))
    }

    /// The first `len` units, NUL-terminated in place until the result is dropped.
    #[inline]
    pub fn prefix(&mut self, len: usize) -> Prefix<'_, B, S> {
        let full_len = self.len;
        let replaced = self.as_slice().get(len).copied();
        self.truncate(len);
        Prefix {
            path: self,
            full_len,
            replaced,
        }
    }
}

#[cold]
#[inline(never)]
fn edit_on_heap<U: PathUnit>(
    path: &[U],
    room: usize,
    edit: &mut dyn FnMut(&mut Units<'_, U>),
) -> Vec<U> {
    let mut copy = PathIn::<Heap<U>>::from(path);
    let Ok(()) = copy.edit(room, edit);
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
    (units.iter()).fold(0, |sum, unit| {
        sum.wrapping_mul(31).wrapping_add(unit.as_u32())
    })
}

/// See [`PathIn::scope`].
#[must_use]
pub struct Scope<'a, B: Backend, S: Style> {
    path: &'a mut PathIn<B, S>,
    len: usize,
    #[cfg(debug_assertions)]
    checksum: u32,
}

impl<B: Backend, S: Style> Deref for Scope<'_, B, S> {
    type Target = PathIn<B, S>;
    #[inline(always)]
    fn deref(&self) -> &PathIn<B, S> {
        self.path
    }
}

impl<B: Backend, S: Style> DerefMut for Scope<'_, B, S> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut PathIn<B, S> {
        self.path
    }
}

impl<B: Backend, S: Style> Drop for Scope<'_, B, S> {
    #[inline]
    fn drop(&mut self) {
        self.path.truncate(self.len);
        #[cfg(debug_assertions)]
        assert_eq!(checksum(self.path.as_slice()), self.checksum);
    }
}

/// See [`PathIn::prefix`].
#[must_use]
pub struct Prefix<'a, B: Backend, S: Style> {
    path: &'a mut PathIn<B, S>,
    full_len: usize,
    replaced: Option<B::Unit>,
}

impl<B: Backend, S: Style> Deref for Prefix<'_, B, S> {
    type Target = PathIn<B, S>;
    #[inline(always)]
    fn deref(&self) -> &PathIn<B, S> {
        self.path
    }
}

impl<B: Backend, S: Style> Drop for Prefix<'_, B, S> {
    #[inline]
    fn drop(&mut self) {
        if let Some(replaced) = self.replaced {
            let len = self.path.len;
            self.path.backend.all()[len].write(replaced);
            self.path.len = self.full_len;
        }
    }
}

impl From<NameTooLong> for crate::Error {
    #[inline]
    fn from(error: NameTooLong) -> Self {
        Self::Sys(error.into())
    }
}
