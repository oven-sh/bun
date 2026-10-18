//! Typed paths. A view borrows its units and costs nothing; a [`PathBuf`] writes into storage that
//! its caller picks, and never takes the heap unless the caller hands it a `Vec`.
//!
//! Every view holds a native path in one form: native separators, no empty, `.` or inner `..`
//! component, no trailing separator except in a root, no NUL.
//!
//! | view | is |
//! |---|---|
//! | [`Path`] | absolute or relative, decided at run time |
//! | [`AbsPath`] | starts at a root, holds no `..` |
//! | [`RelPath`] | relative, may start with `..` components |
//! | [`SubPath`] | relative, holds no `..`: joined to a directory it stays below it |
//! | [`Component`] | one name |
//!
//! `Component` derefs to `SubPath`, that to `RelPath`, and that and `AbsPath` to `Path`.
//!
//! What a `PathBuf` takes says where the units came from. A view is copied. Text out of a file, an
//! argument or a variable goes through [`PathBuf::join`] or [`PathBuf::join_below`], the only parser.

use core::fmt;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ops::Deref;

use bun_core::PathByte as _;

use crate::SEP;
use crate::path::PathUnit;
use crate::resolve_path::{Platform, PlatformT};

// ── views ────────────────────────────────────────────────────────────────────────────────────────

/// A borrowed path type that a [`PathBuf`] can build.
pub trait View {
    type Unit: PathUnit;
    const ABSOLUTE: Absolute;
    #[doc(hidden)]
    fn wrap(units: &[Self::Unit]) -> &Self;
    fn units(&self) -> &[Self::Unit];
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Absolute {
    Always,
    Never,
    Maybe,
}

macro_rules! view {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[repr(transparent)]
        #[derive(PartialEq, Eq, Hash)]
        pub struct $name<C = u8>([C]);

        impl<C> $name<C> {
            #[inline(always)]
            const fn wrap_units(units: &[C]) -> &Self {
                // SAFETY: `repr(transparent)` over `[C]`.
                unsafe { &*(core::ptr::from_ref(units) as *const Self) }
            }
            #[inline(always)]
            pub const fn units(&self) -> &[C] {
                &self.0
            }
            #[inline(always)]
            pub const fn len(&self) -> usize {
                self.0.len()
            }
            #[inline(always)]
            pub const fn is_empty(&self) -> bool {
                self.0.is_empty()
            }
        }
        impl $name<u8> {
            #[inline(always)]
            pub const fn as_bytes(&self) -> &[u8] {
                &self.0
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
    };
}
macro_rules! derefs_to {
    ($from:ident => $to:ident) => {
        impl<C> Deref for $from<C> {
            type Target = $to<C>;
            #[inline(always)]
            fn deref(&self) -> &$to<C> {
                $to::wrap_units(&self.0)
            }
        }
    };
}
macro_rules! buildable {
    ($name:ident, $absolute:ident) => {
        impl<C: PathUnit> View for $name<C> {
            type Unit = C;
            const ABSOLUTE: Absolute = Absolute::$absolute;
            #[inline(always)]
            fn wrap(units: &[C]) -> &Self {
                Self::wrap_units(units)
            }
            #[inline(always)]
            fn units(&self) -> &[C] {
                &self.0
            }
        }
    };
}

view!(
    /// A native path, absolute or relative.
    Path
);
view!(
    /// A native absolute path.
    AbsPath
);
view!(
    /// A native relative path. `..` components come first, if any. Empty means the base itself.
    RelPath
);
view!(
    /// A native relative path with no `..`. Empty means the base itself.
    SubPath
);
view!(
    /// One name in a directory.
    Component
);
derefs_to!(Component => SubPath);
derefs_to!(SubPath => RelPath);
derefs_to!(RelPath => Path);
derefs_to!(AbsPath => Path);
buildable!(Path, Maybe);
buildable!(AbsPath, Always);
buildable!(RelPath, Never);

pub enum Classified<'a, C> {
    Abs(&'a AbsPath<C>),
    Rel(&'a RelPath<C>),
}

#[inline(always)]
fn is_native_sep<C: PathUnit>(c: C) -> bool {
    c.eq_ascii(SEP)
}

#[inline]
fn last_sep<C: PathUnit>(units: &[C]) -> Option<usize> {
    units.iter().rposition(|&c| is_native_sep(c))
}

/// Units of the root `units` starts with; 0 for a relative path.
#[inline]
fn root_len<C: PathUnit>(units: &[C]) -> usize {
    #[cfg(not(windows))]
    {
        usize::from(units.first().is_some_and(|c| c.eq_ascii(b'/')))
    }
    #[cfg(windows)]
    {
        crate::path::root_len(units).unwrap_or(0)
    }
}

#[inline]
fn is_dots<C: PathUnit>(name: &[C]) -> bool {
    matches!(name, [a] if a.eq_ascii(b'.')) || is_dot_dot(name)
}
#[inline]
fn is_dot_dot<C: PathUnit>(name: &[C]) -> bool {
    matches!(name, [a, b] if a.eq_ascii(b'.') && b.eq_ascii(b'.'))
}

/// A unit that no name on this host can hold.
#[inline(always)]
fn is_forbidden_in_name<C: PathUnit>(c: C) -> bool {
    c.eq_ascii(0) || c.eq_ascii(b'/') || (cfg!(windows) && c.eq_ascii(b'\\'))
}

/// Whether `units`, past its root, is in the one form the views hold.
fn is_clean_below_root<C: PathUnit>(units: &[C], leading_dot_dot: bool) -> bool {
    let mut may_climb = leading_dot_dot;
    let mut start = 0;
    while start < units.len() {
        let mut end = start;
        while end < units.len() && !is_native_sep(units[end]) {
            if is_forbidden_in_name(units[end]) {
                return false;
            }
            end += 1;
        }
        let name = &units[start..end];
        may_climb &= is_dot_dot(name);
        // A separator at the very end leaves no name after it.
        if name.is_empty() || (is_dots(name) && !may_climb) || end + 1 == units.len() {
            return false;
        }
        start = end + 1;
    }
    true
}

impl<C: PathUnit> Path<C> {
    #[inline]
    pub fn classify(&self) -> Classified<'_, C> {
        if root_len(&self.0) > 0 {
            Classified::Abs(AbsPath::wrap_units(&self.0))
        } else {
            Classified::Rel(RelPath::wrap_units(&self.0))
        }
    }

    /// The directory that holds this path. `None` for a root, an empty path and one that ends in `..`.
    #[inline]
    pub fn parent(&self) -> Option<&Self> {
        self.basename()?;
        let root = root_len(&self.0);
        let end = last_sep(&self.0[root..]).map_or(root, |i| root + i);
        Some(Self::wrap_units(&self.0[..end]))
    }

    /// The last name. `None` for a root, an empty path and a path that ends in `..`.
    #[inline]
    pub fn basename(&self) -> Option<&Component<C>> {
        let below = &self.0[root_len(&self.0)..];
        let name = match last_sep(below) {
            Some(i) => &below[i + 1..],
            None => below,
        };
        (!name.is_empty() && !is_dot_dot(name)).then(|| Component::wrap_units(name))
    }
}

impl<C: PathUnit> AbsPath<C> {
    /// `None` unless `units` is absolute and already in the form the views hold.
    pub fn new(units: &[C]) -> Option<&Self> {
        let root = root_len(units);
        (root > 0 && is_clean_below_root(&units[root..], false)).then(|| Self::wrap_units(units))
    }

    /// For what the OS returned as an absolute path: `getcwd`, `realpath`, the path of an fd.
    #[inline]
    pub fn from_os(units: &[C]) -> &Self {
        let root = root_len(units);
        let mut end = units.len();
        while end > root && is_native_sep(units[end - 1]) {
            end -= 1;
        }
        Self::wrap_units(&units[..end])
    }

    #[inline]
    pub fn is_root(&self) -> bool {
        self.0.len() == root_len(&self.0)
    }

    /// The directory that holds this path. `None` for a root.
    #[inline]
    pub fn parent(&self) -> Option<&Self> {
        let root = root_len(&self.0);
        if self.0.len() == root {
            return None;
        }
        let end = last_sep(&self.0[root..]).map_or(root, |i| root + i);
        Some(Self::wrap_units(&self.0[..end]))
    }

    /// This path, then each directory above it up to the root. Every one is a prefix of this one.
    #[inline]
    pub fn ancestors(&self) -> impl Iterator<Item = &Self> {
        core::iter::successors(Some(self), |p| p.parent())
    }

    /// What is left of this path below `dir`. `None` if it is not `dir` or below it.
    #[inline]
    pub fn strip_prefix(&self, dir: &Self) -> Option<&SubPath<C>> {
        let rest = self.0.strip_prefix(&dir.0)?;
        match rest {
            [] => Some(SubPath::wrap_units(rest)),
            [first, below @ ..] if is_native_sep(*first) => Some(SubPath::wrap_units(below)),
            _ if dir.is_root() => Some(SubPath::wrap_units(rest)),
            _ => None,
        }
    }
}

impl<C: PathUnit> RelPath<C> {
    pub const EMPTY: &'static Self = Self::wrap_units(&[]);

    /// `None` unless `units` is relative and already in the form the views hold.
    pub fn new(units: &[C]) -> Option<&Self> {
        (root_len(units) == 0 && is_clean_below_root(units, true)).then(|| Self::wrap_units(units))
    }
}

impl<C: PathUnit> SubPath<C> {
    pub const EMPTY: &'static Self = Self::wrap_units(&[]);

    /// `None` unless `units` is relative, holds no `..` and is already in the form the views hold.
    pub fn new(units: &[C]) -> Option<&Self> {
        (root_len(units) == 0 && is_clean_below_root(units, false)).then(|| Self::wrap_units(units))
    }

    /// For names the OS listed, joined with the native separator by the code that listed them.
    #[inline(always)]
    pub fn from_os(units: &[C]) -> &Self {
        Self::wrap_units(units)
    }

    #[inline]
    pub fn components(&self) -> impl Iterator<Item = &Component<C>> {
        self.0
            .split(|&c| is_native_sep(c))
            .filter(|name| !name.is_empty())
            .map(Component::wrap_units)
    }

    #[inline]
    pub fn parent(&self) -> Option<&Self> {
        if self.0.is_empty() {
            return None;
        }
        Some(Self::wrap_units(&self.0[..last_sep(&self.0).unwrap_or(0)]))
    }
}

impl<C: PathUnit> Component<C> {
    /// `None` if `units` is empty, `.`, `..`, or holds a separator or a NUL.
    #[inline]
    pub fn new(units: &[C]) -> Option<&Self> {
        (!units.is_empty() && !is_dots(units) && !units.iter().any(|&c| is_forbidden_in_name(c)))
            .then(|| Self::wrap_units(units))
    }

    /// For a name the OS listed in a directory.
    #[inline(always)]
    pub fn from_os(units: &[C]) -> &Self {
        Self::wrap_units(units)
    }
}

impl SubPath<u8> {
    /// For [`sub_path!`]. Fails to compile on text that is not in the form the views hold.
    #[doc(hidden)]
    pub const fn from_literal(native: &'static [u8]) -> &'static Self {
        let mut start = 0;
        let mut i = 0;
        while i <= native.len() {
            if i == native.len() || native[i] == SEP {
                let len = i - start;
                assert!(len > 0, "empty component");
                assert!(!(len == 1 && native[start] == b'.'), "`.` component");
                assert!(
                    !(len == 2 && native[start] == b'.' && native[start + 1] == b'.'),
                    "`..` component"
                );
                start = i + 1;
            } else {
                assert!(native[i] != 0 && native[i] != b'/' && native[i] != b'\\');
            }
            i += 1;
        }
        Self::wrap_units(native)
    }
}
impl Component<u8> {
    #[doc(hidden)]
    pub const fn from_literal(name: &'static [u8]) -> &'static Self {
        let mut i = 0;
        while i < name.len() {
            assert!(name[i] != SEP, "a component holds no separator");
            i += 1;
        }
        Self::wrap_units(SubPath::from_literal(name).as_bytes())
    }
}

#[doc(hidden)]
pub const fn native_literal<const N: usize>(text: &[u8]) -> [u8; N] {
    let mut out = [0; N];
    let mut i = 0;
    while i < N {
        out[i] = if text[i] == b'/' { SEP } else { text[i] };
        i += 1;
    }
    out
}

/// `&'static SubPath` from a literal written with `/`. Checked, and given native separators, at
/// compile time.
#[macro_export]
macro_rules! sub_path {
    ($text:literal) => {{
        const NATIVE: [u8; $text.len()] = $crate::typed::native_literal($text.as_bytes());
        const PATH: &$crate::typed::SubPath = $crate::typed::SubPath::from_literal(&NATIVE);
        PATH
    }};
}
/// `&'static Component` from a literal, checked at compile time.
#[macro_export]
macro_rules! component {
    ($text:literal) => {{
        const NAME: &$crate::typed::Component =
            $crate::typed::Component::from_literal($text.as_bytes());
        NAME
    }};
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────

/// Where a [`PathBuf`] writes.
///
/// # Safety
/// `ptr` is valid for writes of `capacity` units, and for reads of every unit written through it,
/// until the next `reserve`. After `reserve(used, total)` returns true, `capacity() >= total` and
/// the first `used` units are kept.
pub unsafe trait Storage<C> {
    fn ptr(&self) -> *const C;
    fn ptr_mut(&mut self) -> *mut C;
    fn capacity(&self) -> usize;
    #[inline(always)]
    fn reserve(&mut self, used: usize, total: usize) -> bool {
        let _ = used;
        total <= self.capacity()
    }
}

macro_rules! storage_by_mut {
    ($owner:ty) => {
        // SAFETY: forwards.
        unsafe impl<C: PathUnit> Storage<C> for &mut $owner {
            #[inline(always)]
            fn ptr(&self) -> *const C {
                Storage::ptr(&**self)
            }
            #[inline(always)]
            fn ptr_mut(&mut self) -> *mut C {
                Storage::ptr_mut(&mut **self)
            }
            #[inline(always)]
            fn capacity(&self) -> usize {
                Storage::capacity(&**self)
            }
            #[inline(always)]
            fn reserve(&mut self, used: usize, total: usize) -> bool {
                Storage::reserve(&mut **self, used, total)
            }
        }
    };
}
storage_by_mut!(Pooled<C>);
storage_by_mut!(Vec<C>);

// SAFETY: a slice is valid for its length.
unsafe impl<C> Storage<C> for &mut [C] {
    #[inline(always)]
    fn ptr(&self) -> *const C {
        self.as_ptr()
    }
    #[inline(always)]
    fn ptr_mut(&mut self) -> *mut C {
        self.as_mut_ptr()
    }
    #[inline(always)]
    fn capacity(&self) -> usize {
        self.len()
    }
}

/// One path buffer in place, not initialized. Only `&mut Stack` is storage, so that no move of a
/// `PathBuf` copies the buffer.
pub struct Stack<C: PathUnit = u8>(MaybeUninit<C::Buffer>);
impl<C: PathUnit> Stack<C> {
    #[inline(always)]
    pub const fn new() -> Self {
        Self(MaybeUninit::uninit())
    }
}
// SAFETY: `C::Buffer` is an array of `C`.
unsafe impl<C: PathUnit> Storage<C> for &mut Stack<C> {
    #[inline(always)]
    fn ptr(&self) -> *const C {
        self.0.as_ptr().cast()
    }
    #[inline(always)]
    fn ptr_mut(&mut self) -> *mut C {
        self.0.as_mut_ptr().cast()
    }
    #[inline(always)]
    fn capacity(&self) -> usize {
        size_of::<C::Buffer>() / size_of::<C>()
    }
}

/// One path buffer out of this thread's pool. A move copies a pointer.
pub struct Pooled<C: PathUnit = u8>(ManuallyDrop<Box<C::Buffer>>);
impl<C: PathUnit> Pooled<C> {
    #[inline]
    pub fn new() -> Self {
        Self(ManuallyDrop::new(C::pool_get()))
    }
}
impl<C: PathUnit> Drop for Pooled<C> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: taken once, here.
        C::pool_put(unsafe { ManuallyDrop::take(&mut self.0) });
    }
}
// SAFETY: `C::Buffer` is an array of `C`, and a pooled one is initialized.
unsafe impl<C: PathUnit> Storage<C> for Pooled<C> {
    #[inline(always)]
    fn ptr(&self) -> *const C {
        core::ptr::from_ref::<C::Buffer>(&self.0).cast()
    }
    #[inline(always)]
    fn ptr_mut(&mut self) -> *mut C {
        core::ptr::from_mut::<C::Buffer>(&mut self.0).cast()
    }
    #[inline(always)]
    fn capacity(&self) -> usize {
        size_of::<C::Buffer>() / size_of::<C>()
    }
}

/// The stack where a path buffer fits on it, the pool on Windows.
#[cfg(not(windows))]
pub type Scratch<C = u8> = Stack<C>;
#[cfg(windows)]
pub type Scratch<C = u8> = Pooled<C>;

// SAFETY: the spare capacity of a `Vec` is valid for writes; `reserve` sets the length it must keep.
unsafe impl<C> Storage<C> for Vec<C> {
    #[inline(always)]
    fn ptr(&self) -> *const C {
        self.as_ptr()
    }
    #[inline(always)]
    fn ptr_mut(&mut self) -> *mut C {
        self.as_mut_ptr()
    }
    #[inline(always)]
    fn capacity(&self) -> usize {
        Vec::capacity(self)
    }
    #[inline]
    fn reserve(&mut self, used: usize, total: usize) -> bool {
        if total > Vec::capacity(self) {
            // SAFETY: the `PathBuf` wrote the first `used` units.
            unsafe { self.set_len(used) };
            Vec::reserve(self, total - used);
        }
        true
    }
}

// ── the builder ──────────────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PathError {
    /// It does not fit the storage.
    TooLong,
    /// `..` led above the directory that `join_below` started in.
    Escapes,
    /// Absolute text where only relative text can go.
    Absolute,
    /// A name holds a NUL, or a unit that separates on this host and did not in the text.
    BadName,
}

/// A length to come back to. See [`PathBuf::mark`].
#[derive(Copy, Clone)]
pub struct Mark {
    len: usize,
    err: Option<PathError>,
}

/// Builds a `V` in `S`.
///
/// A step that fails leaves the path as it was and is remembered: [`get`](Self::get) and
/// [`z`](Self::z), the only ways to the path, return the error from then on.
pub struct PathBuf<V: View + ?Sized, S: Storage<V::Unit>> {
    mem: S,
    len: usize,
    err: Option<PathError>,
    view: PhantomData<fn(&V)>,
}
pub type AbsPathBuf<S, C = u8> = PathBuf<AbsPath<C>, S>;
pub type RelPathBuf<S, C = u8> = PathBuf<RelPath<C>, S>;
pub type AnyPathBuf<S, C = u8> = PathBuf<Path<C>, S>;

impl<V: View + ?Sized, S: Storage<V::Unit>> PathBuf<V, S> {
    /// Holds a copy of `path`.
    #[inline]
    pub fn from_in(mem: S, path: &V) -> Self {
        let mut this = Self {
            mem,
            len: 0,
            err: None,
            view: PhantomData,
        };
        this.set(path);
        this
    }

    /// Replaces the whole path, and forgets an earlier failure.
    #[inline]
    pub fn set(&mut self, path: &V) -> &mut Self {
        self.len = 0;
        self.err = None;
        self.write(0, false, path.units());
        self
    }

    #[inline(always)]
    fn written(&self) -> &[V::Unit] {
        // SAFETY: the first `len` units were written.
        unsafe { core::slice::from_raw_parts(self.mem.ptr(), self.len) }
    }

    /// Writes an optional separator and `units` at `at`, then the terminator.
    #[inline(always)]
    fn write(&mut self, at: usize, sep: bool, units: &[V::Unit]) {
        let total = at + usize::from(sep) + units.len();
        if !self.mem.reserve(at, total + 1) {
            self.err = Some(PathError::TooLong);
            return;
        }
        // SAFETY: `reserve` made room for `total + 1` units, and `units` is not in `mem`, which
        // `self` borrows mutably or owns.
        unsafe {
            let to = self.mem.ptr_mut().add(at);
            // Overwritten by `units` or the terminator when there is no separator to write.
            to.write(V::Unit::from_u8(SEP));
            let to = to.add(usize::from(sep));
            core::ptr::copy_nonoverlapping(units.as_ptr(), to, units.len());
            to.add(units.len()).write(V::Unit::from_u8(0));
        }
        self.len = total;
    }

    #[inline(always)]
    fn truncate(&mut self, len: usize) {
        debug_assert!(len <= self.len);
        self.len = len;
        // SAFETY: `len` is at most the old length, below which the storage has room.
        unsafe { self.mem.ptr_mut().add(len).write(V::Unit::from_u8(0)) };
    }

    #[inline(always)]
    fn needs_sep(&self) -> bool {
        self.written().last().is_some_and(|&c| !is_native_sep(c))
    }

    /// The path, or the first failure since it was last set.
    #[inline(always)]
    pub fn get(&self) -> Result<&V, PathError> {
        match self.err {
            None => Ok(V::wrap(self.written())),
            Some(err) => Err(err),
        }
    }

    /// The path with its terminator, for a syscall.
    #[inline(always)]
    pub fn z(&self) -> Result<&<V::Unit as PathUnit>::ZSlice, PathError> {
        match self.err {
            // SAFETY: every write puts a terminator at `len`.
            None => Ok(unsafe { V::Unit::zslice_from_raw(self.mem.ptr(), self.len) }),
            Some(err) => Err(err),
        }
    }

    /// Appends names that are known to be names. One copy.
    #[inline(always)]
    pub fn push(&mut self, below: &SubPath<V::Unit>) -> &mut Self {
        if !below.is_empty() {
            self.write(self.len, self.needs_sep(), below.units());
        }
        self
    }

    /// [`push`](Self::push) for several at once: one length check and one terminator for all.
    #[inline(always)]
    pub fn push_all<const N: usize>(&mut self, parts: [&SubPath<V::Unit>; N]) -> &mut Self {
        let mut sep = self.needs_sep();
        let mut total = self.len;
        for part in parts {
            total += part.len() + usize::from(sep && !part.is_empty());
            sep |= !part.is_empty();
        }
        if !self.mem.reserve(self.len, total + 1) {
            self.err = Some(PathError::TooLong);
            return self;
        }
        let mut sep = self.needs_sep();
        // SAFETY: `reserve` made room for `total + 1` units, which is what the loop writes.
        unsafe {
            let mut to = self.mem.ptr_mut().add(self.len);
            for part in parts {
                to.write(V::Unit::from_u8(SEP));
                to = to.add(usize::from(sep && !part.is_empty()));
                core::ptr::copy_nonoverlapping(part.units().as_ptr(), to, part.len());
                to = to.add(part.len());
                sep |= !part.is_empty();
            }
            to.write(V::Unit::from_u8(0));
        }
        self.len = total;
        self
    }

    /// Appends one name written by `args`, in place.
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> &mut Self
    where
        V: View<Unit = u8>,
    {
        struct Tail<'a, S: Storage<u8>> {
            mem: &'a mut S,
            len: usize,
        }
        impl<S: Storage<u8>> fmt::Write for Tail<'_, S> {
            fn write_str(&mut self, text: &str) -> fmt::Result {
                let total = self.len + text.len();
                if !self.mem.reserve(self.len, total + 1) {
                    return Err(fmt::Error);
                }
                // SAFETY: `reserve` made the room.
                unsafe {
                    let to = self.mem.ptr_mut().add(self.len);
                    core::ptr::copy_nonoverlapping(text.as_ptr(), to, text.len());
                }
                self.len = total;
                Ok(())
            }
        }
        let before = self.len;
        let sep = self.needs_sep();
        self.write(before, sep, &[]);
        if self.err.is_some() {
            return self;
        }
        let start = self.len;
        let mut tail = Tail {
            mem: &mut self.mem,
            len: start,
        };
        let wrote = fmt::Write::write_fmt(&mut tail, args);
        let end = tail.len;
        // SAFETY: `Tail` wrote up to `end`.
        let name = unsafe { core::slice::from_raw_parts(self.mem.ptr().add(start), end - start) };
        let failure = match wrote {
            Err(_) => Some(PathError::TooLong),
            Ok(()) if Component::new(name).is_none() => Some(PathError::BadName),
            Ok(()) => None,
        };
        match failure {
            None => {
                self.len = end;
                self.truncate(end);
            }
            Some(err) => {
                self.truncate(before);
                self.err = Some(err);
            }
        }
        self
    }

    /// Length of the part that `..` cannot remove.
    #[inline(always)]
    fn root(&self) -> usize {
        match V::ABSOLUTE {
            Absolute::Never => 0,
            _ => root_len(self.written()),
        }
    }

    /// Removes the last name, as `..` does: a root stays, and a relative path with nothing left to
    /// remove gets a `..`.
    #[inline]
    pub fn up(&mut self) -> &mut Self {
        self.up_to(self.root());
        self
    }

    #[inline]
    fn up_to(&mut self, floor: usize) {
        let below = &self.written()[floor..];
        let last = last_sep(below).map_or(0, |i| i + 1);
        if !below.is_empty() && !is_dot_dot(&below[last..]) {
            self.truncate(floor + last.saturating_sub(1));
        } else if floor == 0 {
            let dots = [V::Unit::from_u8(b'.'); 2];
            self.write(self.len, self.needs_sep(), &dots);
        }
    }

    /// Remembers the path as it is now, for [`back_to`](Self::back_to).
    #[inline(always)]
    pub fn mark(&self) -> Mark {
        Mark {
            len: self.len,
            err: self.err,
        }
    }

    /// Cuts the path back to a mark taken when it was a prefix of what it is now.
    #[inline(always)]
    pub fn back_to(&mut self, mark: Mark) -> &mut Self {
        assert!(mark.len <= self.len);
        self.truncate(mark.len);
        self.err = mark.err;
        self
    }

    /// Gives the storage back.
    #[inline]
    pub fn into_storage(self) -> S {
        self.mem
    }
}

impl<V: View + ?Sized, S: Storage<V::Unit>> PathBuf<V, S> {
    /// Empty: the base itself. Not for `AbsPath`, which has no empty value.
    #[inline(always)]
    pub fn new_in(mem: S) -> Self {
        const { assert!(!matches!(V::ABSOLUTE, Absolute::Always)) };
        let mut this = Self {
            mem,
            len: 0,
            err: None,
            view: PhantomData,
        };
        this.write(0, false, &[]);
        this
    }
}

impl<V: View<Unit = u8> + ?Sized, S: Storage<u8>> PathBuf<V, S> {
    /// Resolves `text`, read by the rules of `P`, against the path. `..` removes names down to the
    /// root. Absolute text replaces the path, or fails on a `RelPath`.
    pub fn join<P: PlatformT>(&mut self, text: &[u8]) -> Result<(), PathError> {
        let text = match text_root_len::<P>(text) {
            0 => text,
            root => {
                if matches!(V::ABSOLUTE, Absolute::Never) {
                    return self.fail(self.len, PathError::Absolute);
                }
                self.len = 0;
                self.write_text_root::<P>(&text[..root]);
                &text[root..]
            }
        };
        let floor = self.root();
        self.join_names::<P, false>(text, floor)
    }

    /// Resolves `text`, read by the rules of `P`, against the path, and fails if that would lead
    /// out of the directory the path names now. The check is the join.
    pub fn join_below<P: PlatformT>(&mut self, text: &[u8]) -> Result<(), PathError> {
        if text_root_len::<P>(text) > 0 || has_drive::<P>(text) {
            return self.fail(self.len, PathError::Absolute);
        }
        self.join_names::<P, true>(text, self.len)
    }

    #[cold]
    fn fail(&mut self, back_to: usize, err: PathError) -> Result<(), PathError> {
        self.truncate(back_to);
        self.err = Some(err);
        Err(err)
    }

    fn join_names<P: PlatformT, const BELOW: bool>(
        &mut self,
        text: &[u8],
        floor: usize,
    ) -> Result<(), PathError> {
        let start = self.len;
        let mut rest = text;
        while !rest.is_empty() {
            let mut end = 0;
            let mut forbidden = false;
            while end < rest.len() && !P::P.is_separator(rest[end]) {
                forbidden |= is_forbidden_in_name(rest[end]);
                end += 1;
            }
            let name = &rest[..end];
            rest = rest.get(end + 1..).unwrap_or_default();
            match name {
                b"" | b"." => {}
                b".." => {
                    if BELOW && self.len == floor {
                        return self.fail(start, PathError::Escapes);
                    }
                    self.up_to(floor);
                }
                _ => {
                    if forbidden {
                        return self.fail(start.min(self.len), PathError::BadName);
                    }
                    self.write(self.len, self.needs_sep(), name);
                }
            }
            if let Some(err) = self.err {
                return self.fail(start.min(self.len), err);
            }
        }
        Ok(())
    }

    fn write_text_root<P: PlatformT>(&mut self, root: &[u8]) {
        #[cfg(not(windows))]
        {
            let _ = root;
            self.write(0, false, b"/");
        }
        #[cfg(windows)]
        {
            self.write(0, false, root);
            // SAFETY: `write` wrote `len` units.
            let written = unsafe { core::slice::from_raw_parts_mut(self.mem.ptr_mut(), self.len) };
            crate::resolve_path::slashes_to_windows_in_place(written);
        }
    }
}

/// Units of the root that `text` starts with by the rules of `P`; 0 for relative text.
#[inline]
fn text_root_len<P: PlatformT>(text: &[u8]) -> usize {
    if !P::P.is_absolute(text) {
        return 0;
    }
    match P::P {
        Platform::Posix => 1,
        _ if text.len() >= 3 && text[1] == b':' => 3,
        _ => 1,
    }
}

/// `C:name`: relative to the current directory of a drive, so not below anything.
#[inline]
fn has_drive<P: PlatformT>(text: &[u8]) -> bool {
    !matches!(P::P, Platform::Posix)
        && text
            .split(|&c| P::P.is_separator(c))
            .next()
            .is_some_and(|first| first.contains(&b':'))
}

/// The way from the directory `from` to `to`.
pub fn relative_in<C: PathUnit, S: Storage<C>>(
    mem: S,
    from: &AbsPath<C>,
    to: &AbsPath<C>,
) -> PathBuf<RelPath<C>, S> {
    let mut out = PathBuf::<RelPath<C>, S>::new_in(mem);
    let mut common = from;
    let below = loop {
        if let Some(below) = to.strip_prefix(common) {
            break below;
        }
        match common.parent() {
            Some(parent) => common = parent,
            None => {
                out.err = Some(PathError::Absolute);
                return out;
            }
        }
        out.up();
    };
    out.push(below);
    out
}

macro_rules! boxed {
    ($name:ident) => {
        impl<C: Copy> From<&$name<C>> for Box<$name<C>> {
            /// For a path that outlives the buffer it was built in.
            fn from(path: &$name<C>) -> Self {
                let units: Box<[C]> = Box::from(&path.0);
                // SAFETY: `repr(transparent)` over `[C]`.
                unsafe { Box::from_raw(Box::into_raw(units) as *mut $name<C>) }
            }
        }
    };
}
boxed!(Path);
boxed!(AbsPath);
boxed!(RelPath);
boxed!(SubPath);
boxed!(Component);

/// The project's directory.
#[inline]
pub fn top_level_dir() -> &'static AbsPath {
    AbsPath::from_os(crate::fs::FileSystem::instance().top_level_dir())
}
