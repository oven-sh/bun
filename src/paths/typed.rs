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
//! `Component` derefs to `SubPath`, that to `RelPath`, and that and `AbsPath` to `Path`. [`Z<V>`](Z)
//! is a `V` with a terminator after it, for a syscall, and derefs to `V`.
//!
//! What a `PathBuf` takes says where the units came from. A view is copied. Text out of a file, an
//! argument or a variable goes through [`join`](PathBuf::join), [`join_below`](PathBuf::join_below)
//! or [`push_names`](PathBuf::push_names), which share the only parser.

use core::fmt;
use core::marker::PhantomData;
use core::mem::{ManuallyDrop, MaybeUninit};
use core::ops::{Deref, DerefMut};

use bun_core::PathByte as _;

use crate::SEP;
use crate::path::PathUnit;
use crate::resolve_path::{Platform, PlatformT};

// ── units ────────────────────────────────────────────────────────────────────────────────────────

/// Units of a path that can be written from units of `D`.
pub trait FromUnit<D: PathUnit>: PathUnit {
    /// The most units that `from` can become.
    fn bound(from: &[D]) -> usize;
    /// Returns the units written.
    ///
    /// # Safety
    /// `to` is valid for writes of `bound(from)` units and does not overlap `from`.
    unsafe fn transcode(from: &[D], to: *mut Self) -> usize;
}
impl<C: PathUnit> FromUnit<C> for C {
    #[inline(always)]
    fn bound(from: &[C]) -> usize {
        from.len()
    }
    #[inline(always)]
    unsafe fn transcode(from: &[C], to: *mut C) -> usize {
        // SAFETY: the caller's.
        unsafe { core::ptr::copy_nonoverlapping(from.as_ptr(), to, from.len()) };
        from.len()
    }
}
macro_rules! transcodes {
    ($from:ty => $to:ty, at most $times:literal) => {
        impl FromUnit<$from> for $to {
            #[inline]
            fn bound(from: &[$from]) -> usize {
                from.len() * $times
            }
            #[inline]
            unsafe fn transcode(from: &[$from], to: *mut $to) -> usize {
                // SAFETY: the caller's. Storage of the other width is pooled, so initialized.
                let to = unsafe { core::slice::from_raw_parts_mut(to, Self::bound(from)) };
                <$to as PathUnit>::convert_from_other(to, from)
            }
        }
    };
}
transcodes!(u8 => u16, at most 1);
transcodes!(u16 => u8, at most 3);

/// `u8` or `u16`.
pub trait Unit: PathUnit + FromUnit<u8> + FromUnit<u16> {}
impl Unit for u8 {}
impl Unit for u16 {}

// ── views ────────────────────────────────────────────────────────────────────────────────────────

/// Any of the five views.
pub trait Units {
    type Unit: Unit;
    fn units(&self) -> &[Self::Unit];
}

/// What `..` does to a path that has no name left to remove.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AtFence {
    /// A root stays.
    Stay,
    /// A relative path gets a `..`.
    Climb,
    Fail,
    /// Fails, and the path cannot be replaced either: a [`Scope`] is open.
    Scoped,
}

/// A view that a [`PathBuf`] can build.
pub trait View: Units {
    #[doc(hidden)]
    const MAY_BE_ABSOLUTE: bool;
    #[doc(hidden)]
    const WHEN_RELATIVE: AtFence;
    #[doc(hidden)]
    fn wrap(units: &[Self::Unit]) -> &Self;
}
/// A view that can hold an absolute path.
pub trait HoldsAbs: View {}
/// A view that can be empty.
pub trait HoldsEmpty: View {}

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
        impl<C: Unit> Units for $name<C> {
            type Unit = C;
            #[inline(always)]
            fn units(&self) -> &[C] {
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
    ($name:ident, may be absolute: $abs:literal, when relative: $at:ident $(, $marker:ident)*) => {
        impl<C: Unit> View for $name<C> {
            const MAY_BE_ABSOLUTE: bool = $abs;
            const WHEN_RELATIVE: AtFence = AtFence::$at;
            #[inline(always)]
            fn wrap(units: &[C]) -> &Self {
                Self::wrap_units(units)
            }
        }
        $(impl<C: Unit> $marker for $name<C> {})*
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
buildable!(Path, may be absolute: true, when relative: Climb, HoldsAbs, HoldsEmpty);
buildable!(AbsPath, may be absolute: true, when relative: Fail, HoldsAbs);
buildable!(RelPath, may be absolute: false, when relative: Climb, HoldsEmpty);
buildable!(SubPath, may be absolute: false, when relative: Fail, HoldsEmpty);

/// A `V` with a terminator after its last unit.
#[repr(transparent)]
#[derive(PartialEq, Eq, Hash)]
pub struct Z<V: ?Sized>(V);
impl<V: Units + ?Sized> Z<V> {
    /// # Safety
    /// The unit after the last one of `view` is readable for as long as `view`, and is 0.
    #[inline(always)]
    const unsafe fn wrap(view: &V) -> &Self {
        // SAFETY: `repr(transparent)` over `V`.
        unsafe { &*(core::ptr::from_ref(view) as *const Self) }
    }
    /// For a syscall.
    #[inline(always)]
    pub fn z(&self) -> &<V::Unit as PathUnit>::ZSlice {
        let units = self.0.units();
        // SAFETY: `wrap`'s.
        unsafe { V::Unit::zslice_from_raw(units.as_ptr(), units.len()) }
    }
}
impl<V: ?Sized> Deref for Z<V> {
    type Target = V;
    #[inline(always)]
    fn deref(&self) -> &V {
        &self.0
    }
}
impl<V: fmt::Debug + ?Sized> fmt::Debug for Z<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}
impl<V: fmt::Display + ?Sized> fmt::Display for Z<V> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

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
        assert!(root > 0);
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

/// For [`sub_path!`] and [`component!`]: `text` with native separators and a terminator.
#[doc(hidden)]
pub const fn native_literal<const N: usize>(text: &[u8]) -> [u8; N] {
    assert!(N == text.len() + 1);
    let mut out = [0; N];
    let mut i = 0;
    while i < text.len() {
        out[i] = if text[i] == b'/' { SEP } else { text[i] };
        i += 1;
    }
    out
}
const fn check_literal(terminated: &'static [u8], one_name: bool) -> &'static [u8] {
    let native = terminated.split_at(terminated.len() - 1).0;
    let mut start = 0;
    let mut i = 0;
    while i <= native.len() {
        if i == native.len() || native[i] == SEP {
            let len = i - start;
            assert!(
                i == native.len() || !one_name,
                "a component holds no separator"
            );
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
    native
}
impl SubPath<u8> {
    #[doc(hidden)]
    pub const fn from_literal(terminated: &'static [u8]) -> &'static Z<Self> {
        // SAFETY: `check_literal` cuts the terminator off.
        unsafe { Z::wrap(Self::wrap_units(check_literal(terminated, false))) }
    }
}
impl Component<u8> {
    #[doc(hidden)]
    pub const fn from_literal(terminated: &'static [u8]) -> &'static Z<Self> {
        // SAFETY: `check_literal` cuts the terminator off.
        unsafe { Z::wrap(Self::wrap_units(check_literal(terminated, true))) }
    }
}

/// `&'static Z<SubPath>` from constant text written with `/`. Checked, and given native separators,
/// at compile time.
#[macro_export]
macro_rules! sub_path {
    ($text:expr) => {{
        const NATIVE: [u8; $text.len() + 1] = $crate::typed::native_literal($text.as_bytes());
        const PATH: &$crate::typed::Z<$crate::typed::SubPath> =
            $crate::typed::SubPath::from_literal(&NATIVE);
        PATH
    }};
}
/// `&'static Z<Component>` from constant text, checked at compile time.
#[macro_export]
macro_rules! component {
    ($text:expr) => {{
        const NATIVE: [u8; $text.len() + 1] = $crate::typed::native_literal($text.as_bytes());
        const NAME: &$crate::typed::Z<$crate::typed::Component> =
            $crate::typed::Component::from_literal(&NATIVE);
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

/// Lets the OS write text into `mem`: the target of a link, say. `fill` returns the units it wrote.
/// What comes back is text, which only `join` and its kin take.
#[inline]
pub fn text_from_os<C: PathUnit, S: Storage<C>, E>(
    mem: &mut S,
    fill: impl FnOnce(&mut [MaybeUninit<C>]) -> Result<usize, E>,
) -> Result<&[C], E> {
    let capacity = mem.capacity();
    // SAFETY: `Storage`'s.
    let room = unsafe { core::slice::from_raw_parts_mut(mem.ptr_mut().cast(), capacity) };
    let len = fill(room)?;
    assert!(len <= capacity);
    // SAFETY: `fill` wrote `len` units.
    Ok(unsafe { core::slice::from_raw_parts(mem.ptr(), len) })
}

// ── the builder ──────────────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum PathError {
    /// It does not fit the storage.
    TooLong,
    /// `..` led above the root of a `join_below`, out of a [`Scope`] or out of a `SubPath`, or the
    /// path was to be replaced inside a `Scope`.
    Escapes,
    /// Absolute where only a relative path can go.
    Absolute,
    /// Relative where only an absolute path can go.
    Relative,
    /// Not a name: empty, `.` or `..` where names are wanted, or it holds a NUL or a unit that
    /// separates on this host and did not in the text.
    BadName,
}

#[derive(Copy, Clone)]
struct Saved {
    len: usize,
    err: Option<PathError>,
    fence: usize,
    at_fence: AtFence,
}

/// Builds a `V` in `S`.
///
/// The first step that fails is remembered, and [`get`](Self::get), the only way to the path,
/// returns it from then on.
pub struct PathBuf<V: View + ?Sized, S: Storage<V::Unit>> {
    mem: S,
    len: usize,
    /// `..` removes nothing below this length.
    fence: usize,
    at_fence: AtFence,
    err: Option<PathError>,
    view: PhantomData<fn(&V)>,
}
pub type AbsPathBuf<S, C = u8> = PathBuf<AbsPath<C>, S>;
pub type RelPathBuf<S, C = u8> = PathBuf<RelPath<C>, S>;
pub type SubPathBuf<S, C = u8> = PathBuf<SubPath<C>, S>;
pub type AnyPathBuf<S, C = u8> = PathBuf<Path<C>, S>;

impl<V: View + ?Sized, S: Storage<V::Unit>> PathBuf<V, S> {
    #[inline(always)]
    fn blank(mem: S) -> Self {
        Self {
            mem,
            len: 0,
            fence: 0,
            at_fence: V::WHEN_RELATIVE,
            err: None,
            view: PhantomData,
        }
    }

    /// Holds a copy of `path`.
    #[inline]
    pub fn from_in(mem: S, path: &V) -> Self {
        let mut this = Self::blank(mem);
        this.set(path);
        this
    }

    /// Empty: the base itself.
    #[inline(always)]
    pub fn new_in(mem: S) -> Self
    where
        V: HoldsEmpty,
    {
        let mut this = Self::blank(mem);
        this.write::<V::Unit>(0, false, &[]);
        this
    }

    /// Replaces the whole path, and forgets an earlier failure.
    #[inline]
    pub fn set(&mut self, path: &V) -> &mut Self {
        self.replace(path.units())
    }

    /// [`set`](Self::set) to an absolute path.
    #[inline]
    pub fn set_abs(&mut self, path: &AbsPath<V::Unit>) -> &mut Self
    where
        V: HoldsAbs,
    {
        self.replace(path.units())
    }

    #[inline(always)]
    fn replace(&mut self, clean: &[V::Unit]) -> &mut Self {
        if self.is_scoped() {
            return self;
        }
        self.err = None;
        self.len = 0;
        self.write(0, false, clean);
        self.fence_at_root();
        self
    }

    /// Whether a [`Scope`] is open, which what replaces the path fails in.
    #[inline(always)]
    fn is_scoped(&mut self) -> bool {
        let scoped = self.at_fence == AtFence::Scoped;
        if scoped {
            self.poison(PathError::Escapes);
        }
        scoped
    }

    #[inline(always)]
    fn fence_at_root(&mut self) {
        self.fence = if V::MAY_BE_ABSOLUTE {
            root_len(self.written())
        } else {
            0
        };
        self.at_fence = if self.fence > 0 {
            AtFence::Stay
        } else {
            V::WHEN_RELATIVE
        };
    }

    /// Replaces the whole path with an absolute one that the OS writes: `getcwd`, `realpath`, the
    /// path of an fd. `fill` gets all of the storage and returns the units it wrote, without a
    /// terminator.
    pub fn set_from_os<E>(
        &mut self,
        fill: impl FnOnce(&mut [MaybeUninit<V::Unit>]) -> Result<usize, E>,
    ) -> Result<&mut Self, E>
    where
        V: HoldsAbs,
    {
        if self.is_scoped() {
            return Ok(self);
        }
        self.err = None;
        self.len = 0;
        // Storage that cannot grow lends what it has, and the OS says whether that is enough.
        self.mem.reserve(0, V::Unit::MAX_PATH);
        let capacity = self.mem.capacity();
        // SAFETY: `Storage`'s.
        let room = unsafe { core::slice::from_raw_parts_mut(self.mem.ptr_mut().cast(), capacity) };
        let len = fill(room)?;
        // No room left for the terminator also means the OS may have cut the path short.
        if len >= capacity {
            self.poison(PathError::TooLong);
            return Ok(self);
        }
        self.len = len;
        let root = root_len(self.written());
        if root == 0 {
            self.len = 0;
            self.poison(PathError::Relative);
            return Ok(self);
        }
        let mut end = len;
        while end > root && is_native_sep(self.written()[end - 1]) {
            end -= 1;
        }
        self.truncate(end);
        self.fence_at_root();
        Ok(self)
    }

    #[inline(always)]
    fn written(&self) -> &[V::Unit] {
        // SAFETY: the first `len` units were written.
        unsafe { core::slice::from_raw_parts(self.mem.ptr(), self.len) }
    }

    #[inline(always)]
    fn poison(&mut self, err: PathError) {
        if self.err.is_none() {
            self.err = Some(err);
        }
    }

    /// Writes an optional separator and `units` at `at`, then the terminator.
    #[inline(always)]
    fn write<D: PathUnit>(&mut self, at: usize, sep: bool, units: &[D])
    where
        V::Unit: FromUnit<D>,
    {
        let start = at + usize::from(sep);
        if !self.mem.reserve(at, start + V::Unit::bound(units) + 1) {
            self.poison(PathError::TooLong);
            return;
        }
        // SAFETY: `reserve` made the room, and `units` is not in `mem`, which `self` borrows
        // mutably or owns.
        unsafe {
            let base = self.mem.ptr_mut();
            // Overwritten by `units` or the terminator when there is no separator to write.
            base.add(at).write(V::Unit::from_u8(SEP));
            self.len = start + V::Unit::transcode(units, base.add(start));
            base.add(self.len).write(V::Unit::from_u8(0));
        }
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
    pub fn get(&self) -> Result<&Z<V>, PathError> {
        match self.err {
            // SAFETY: every write puts a terminator at `len`.
            None => Ok(unsafe { Z::wrap(V::wrap(self.written())) }),
            Some(err) => Err(err),
        }
    }

    /// The first failure since the path was last set.
    #[inline(always)]
    pub fn error(&self) -> Option<PathError> {
        self.err
    }

    /// What is written, failed or not. For a message.
    #[inline(always)]
    pub fn shown(&self) -> &[V::Unit] {
        self.written()
    }

    #[inline(always)]
    pub fn len(&self) -> usize {
        self.len
    }

    /// Appends names that are known to be names. One copy.
    #[inline(always)]
    pub fn push<D: PathUnit>(&mut self, below: &SubPath<D>) -> &mut Self
    where
        V::Unit: FromUnit<D>,
    {
        if !below.is_empty() {
            self.write(self.len, self.needs_sep(), below.units());
        }
        self
    }

    /// Appends one name written by `args`, in place.
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> &mut Self {
        struct Tail<'a, C, S> {
            mem: &'a mut S,
            len: usize,
            unit: PhantomData<C>,
        }
        impl<C: Unit, S: Storage<C>> fmt::Write for Tail<'_, C, S> {
            fn write_str(&mut self, text: &str) -> fmt::Result {
                let text = text.as_bytes();
                if !self
                    .mem
                    .reserve(self.len, self.len + <C as FromUnit<u8>>::bound(text) + 1)
                {
                    return Err(fmt::Error);
                }
                // SAFETY: `reserve` made the room.
                self.len += unsafe { C::transcode(text, self.mem.ptr_mut().add(self.len)) };
                Ok(())
            }
        }
        let before = self.len;
        self.write::<V::Unit>(before, self.needs_sep(), &[]);
        if self.err.is_some() {
            return self;
        }
        let start = self.len;
        let mut tail = Tail {
            mem: &mut self.mem,
            len: start,
            unit: PhantomData,
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
        self.len = end;
        match failure {
            None => self.truncate(end),
            Some(err) => {
                self.truncate(before);
                self.poison(err);
            }
        }
        self
    }

    /// Removes the last name, as `..` does. With no name left above the fence: a root stays, a
    /// relative path gets a `..`, and a `SubPath`, or a path in a [`Scope`], fails.
    #[inline]
    pub fn up(&mut self) -> &mut Self {
        let below = &self.written()[self.fence..];
        let last = last_sep(below).map_or(0, |i| i + 1);
        if !below.is_empty() && !is_dot_dot(&below[last..]) {
            self.truncate(self.fence + last.saturating_sub(1));
            return self;
        }
        match self.at_fence {
            AtFence::Stay => {}
            AtFence::Climb => {
                let dots = [V::Unit::from_u8(b'.'); 2];
                self.write(self.len, self.needs_sep(), &dots);
            }
            AtFence::Fail | AtFence::Scoped => self.poison(PathError::Escapes),
        }
        self
    }

    #[inline(always)]
    fn raise_fence(&mut self, at_fence: AtFence) -> Saved {
        let saved = Saved {
            len: self.len,
            err: self.err,
            fence: self.fence,
            at_fence: self.at_fence,
        };
        self.fence = self.len;
        self.at_fence = at_fence;
        saved
    }

    /// Lends the path for changes that end with the [`Scope`].
    #[inline(always)]
    pub fn scope(&mut self) -> Scope<'_, V, S> {
        let saved = self.raise_fence(AtFence::Scoped);
        Scope { buf: self, saved }
    }

    /// Hands `f` the first `len` units of the path with a terminator after them, with no copy: the
    /// unit there is put back afterwards. `len` is the length of an ancestor.
    #[inline]
    pub fn with_ancestor<R>(
        &mut self,
        len: usize,
        f: impl FnOnce(&Z<V>) -> R,
    ) -> Result<R, PathError> {
        if let Some(err) = self.err {
            return Err(err);
        }
        let units = self.written();
        let is_boundary = len == units.len()
            || (len < units.len()
                && (is_native_sep(units[len]) || (len > 0 && len == root_len(units))));
        if !is_boundary {
            return Err(PathError::BadName);
        }
        // SAFETY: `len` is at most the written length, where a unit or the terminator is.
        unsafe {
            let at = self.mem.ptr_mut().add(len);
            let saved = at.read();
            at.write(V::Unit::from_u8(0));
            let result = f(Z::wrap(V::wrap(core::slice::from_raw_parts(
                self.mem.ptr(),
                len,
            ))));
            self.mem.ptr_mut().add(len).write(saved);
            Ok(result)
        }
    }

    /// Hands `f` the path with `count` times `..` after it, for the OS to resolve once it has
    /// followed the links in the path. No view holds that, so it is text for a syscall.
    pub fn with_os_parents<R>(
        &mut self,
        count: usize,
        f: impl FnOnce(&<V::Unit as PathUnit>::ZSlice) -> R,
    ) -> Result<R, PathError> {
        let mut scope = self.scope();
        let dots = [V::Unit::from_u8(b'.'); 2];
        for _ in 0..count {
            let (len, sep) = (scope.len, scope.needs_sep());
            scope.write(len, sep, &dots);
        }
        if let Some(err) = scope.err {
            return Err(err);
        }
        // SAFETY: every write puts a terminator at `len`.
        Ok(f(unsafe {
            V::Unit::zslice_from_raw(scope.mem.ptr(), scope.len)
        }))
    }

    /// Resolves `text`, read by the rules of `P`, against the path. `..` removes names down to the
    /// root. Absolute text replaces the path where the view can hold it, outside a [`Scope`].
    pub fn join<P: PlatformT>(&mut self, text: &[u8]) -> &mut Self {
        if self.err.is_some() {
            return self;
        }
        let root = text_root_len::<P>(text);
        if root > 0 {
            if !V::MAY_BE_ABSOLUTE || self.at_fence == AtFence::Scoped {
                self.poison(PathError::Absolute);
                return self;
            }
            self.write_text_root(&text[..root]);
            self.fence_at_root();
        }
        self.parse::<P, false>(&text[root..]);
        self
    }

    /// Resolves `text`, read by the rules of `P`, against the path, and fails if that would lead
    /// out of the directory the path names now. The check is the join.
    pub fn join_below<P: PlatformT>(&mut self, text: &[u8]) -> &mut Self {
        self.below::<P, false>(text)
    }

    /// Appends `text`, read by the rules of `P`, which has to be one name or more and nothing else:
    /// no `.`, no `..`, no empty component.
    pub fn push_names<P: PlatformT>(&mut self, text: &[u8]) -> &mut Self {
        if text.is_empty() {
            self.poison(PathError::BadName);
        }
        self.below::<P, true>(text)
    }

    #[inline]
    fn below<P: PlatformT, const NAMES_ONLY: bool>(&mut self, text: &[u8]) -> &mut Self {
        if self.err.is_some() {
            return self;
        }
        if text_root_len::<P>(text) > 0 || has_drive::<P>(text) {
            self.poison(PathError::Absolute);
            return self;
        }
        let saved = self.raise_fence(AtFence::Fail);
        self.parse::<P, NAMES_ONLY>(text);
        if self.err.is_some() {
            self.truncate(saved.len);
        }
        self.fence = saved.fence;
        self.at_fence = saved.at_fence;
        self
    }

    /// The only parser. Stops at the first failure.
    fn parse<P: PlatformT, const NAMES_ONLY: bool>(&mut self, text: &[u8]) {
        let mut rest = text;
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
                b"" | b"." | b".." if NAMES_ONLY => self.poison(PathError::BadName),
                _ if NAMES_ONLY && ends_in_sep => self.poison(PathError::BadName),
                b"" | b"." => {}
                b".." => {
                    self.up();
                }
                _ if forbidden => self.poison(PathError::BadName),
                _ => self.write(self.len, self.needs_sep(), name),
            }
        }
    }

    fn write_text_root(&mut self, root: &[u8]) {
        self.len = 0;
        #[cfg(not(windows))]
        {
            // A drive has no meaning here.
            if root.len() > 1 {
                self.poison(PathError::BadName);
            }
            self.write(0, false, b"/".as_slice());
        }
        #[cfg(windows)]
        {
            self.write(0, false, root);
            // SAFETY: `write` wrote `len` units.
            let written = unsafe { core::slice::from_raw_parts_mut(self.mem.ptr_mut(), self.len) };
            for unit in written {
                if is_forbidden_in_name(*unit) {
                    *unit = V::Unit::from_u8(SEP);
                }
            }
        }
    }

    /// Gives the storage back.
    #[inline]
    pub fn into_storage(self) -> S {
        self.mem
    }
}

impl<C: Unit, S: Storage<C>> PathBuf<AbsPath<C>, S> {
    /// Moves the path from `from`, or below it, to the same place below `to`, in place. False,
    /// and no change, if it is neither `from` nor below it.
    pub fn rebase(&mut self, from: &AbsPath<C>, to: &AbsPath<C>) -> bool {
        if self.is_scoped() {
            return true;
        }
        let Some(below) = AbsPath::wrap_units(self.written()).strip_prefix(from) else {
            return false;
        };
        let below = below.len();
        let start = to.len() + usize::from(below > 0 && !to.is_root());
        if !self.mem.reserve(self.len, start + below + 1) {
            self.poison(PathError::TooLong);
            return true;
        }
        // SAFETY: `reserve` made room for `start + below + 1` units, the last `below` written units
        // may overlap where they go, and `to` is not in `mem`, which `self` borrows mutably or owns.
        unsafe {
            let base = self.mem.ptr_mut();
            core::ptr::copy(base.add(self.len - below), base.add(start), below);
            base.add(start + below).write(C::from_u8(0));
            // Overwritten by `to` when there is no separator to write.
            base.add(start - 1).write(C::from_u8(SEP));
            core::ptr::copy_nonoverlapping(to.units().as_ptr(), base, to.len());
        }
        self.len = start + below;
        self.fence_at_root();
        true
    }
}

/// A [`PathBuf`] that goes back to what it was, failures included, when this is dropped. Until then
/// nothing removes or replaces what was there.
pub struct Scope<'a, V: View + ?Sized, S: Storage<V::Unit>> {
    buf: &'a mut PathBuf<V, S>,
    saved: Saved,
}
impl<V: View + ?Sized, S: Storage<V::Unit>> Scope<'_, V, S> {
    /// The path as it was when the scope began, which it still starts with.
    #[inline]
    pub fn base(&self) -> Result<&V, PathError> {
        match self.saved.err {
            None => Ok(V::wrap(&self.buf.written()[..self.saved.len])),
            Some(err) => Err(err),
        }
    }
}
impl<V: View + ?Sized, S: Storage<V::Unit>> Deref for Scope<'_, V, S> {
    type Target = PathBuf<V, S>;
    #[inline(always)]
    fn deref(&self) -> &PathBuf<V, S> {
        self.buf
    }
}
impl<V: View + ?Sized, S: Storage<V::Unit>> DerefMut for Scope<'_, V, S> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut PathBuf<V, S> {
        self.buf
    }
}
impl<V: View + ?Sized, S: Storage<V::Unit>> Drop for Scope<'_, V, S> {
    #[inline(always)]
    fn drop(&mut self) {
        self.buf.truncate(self.saved.len);
        self.buf.err = self.saved.err;
        self.buf.fence = self.saved.fence;
        self.buf.at_fence = self.saved.at_fence;
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

/// `C:name`: relative to the current directory of a drive, so not below anything. Elsewhere than on
/// Windows a `:` is part of a name.
#[inline]
fn has_drive<P: PlatformT>(text: &[u8]) -> bool {
    (cfg!(windows) || matches!(P::P, Platform::Windows))
        && text
            .split(|&c| P::P.is_separator(c))
            .next()
            .is_some_and(|first| first.contains(&b':'))
}

/// The way from the directory `from` to `to`.
pub fn relative_in<C: Unit, S: Storage<C>>(
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
            // Two drives.
            None => {
                out.poison(PathError::Absolute);
                return out;
            }
        }
        out.up();
    };
    out.push(below);
    out
}

/// The project's directory.
#[inline]
pub fn top_level_dir() -> &'static AbsPath {
    AbsPath::from_os(crate::fs::FileSystem::instance().top_level_dir())
}
