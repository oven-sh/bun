//! Typed paths. A view borrows its units and costs nothing; a [`PathBuf`] writes into storage that
//! its caller picks: the stack or the pool of path buffers.
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
use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut};

use bun_core::PathByte as _;
use bun_simdutf_sys::simdutf;

use crate::SEP;
use crate::path::PathUnit;
use crate::resolve_path::{Platform, PlatformT};

// ── units ────────────────────────────────────────────────────────────────────────────────────────

/// Units of a path that can be written from units of `D`.
///
/// # Safety
/// `transcode` writes no more than `bound(from)` units, and returns how many.
pub unsafe trait FromUnit<D: PathUnit>: PathUnit {
    /// The most units that `from` can become.
    fn bound(from: &[D]) -> usize;
    /// Returns the units written. `None` if `from` has no form in these units.
    ///
    /// # Safety
    /// `to` is valid for writes of `bound(from)` units and does not overlap `from`.
    unsafe fn transcode(from: &[D], to: *mut Self) -> Option<usize>;
}
// SAFETY: a copy.
unsafe impl<C: PathUnit> FromUnit<C> for C {
    #[inline(always)]
    fn bound(from: &[C]) -> usize {
        from.len()
    }
    #[inline(always)]
    unsafe fn transcode(from: &[C], to: *mut C) -> Option<usize> {
        // SAFETY: the caller's.
        unsafe { core::ptr::copy_nonoverlapping(from.as_ptr(), to, from.len()) };
        Some(from.len())
    }
}
macro_rules! transcodes {
    ($from:ty => $to:ty, at most $times:literal, $convert:expr) => {
        // SAFETY: no code point takes more units than that.
        unsafe impl FromUnit<$from> for $to {
            #[inline]
            fn bound(from: &[$from]) -> usize {
                from.len() * $times
            }
            #[inline]
            unsafe fn transcode(from: &[$from], to: *mut $to) -> Option<usize> {
                // SAFETY: the caller's, and zeroed because the converters take initialized slices.
                let to = unsafe {
                    core::ptr::write_bytes(to, 0, Self::bound(from));
                    core::slice::from_raw_parts_mut(to, Self::bound(from))
                };
                let convert: fn(&[$from], &mut [$to]) -> Option<usize> = $convert;
                convert(from, to)
            }
        }
    };
}
transcodes!(u8 => u16, at most 1, |from, to| Some(u16::convert_from_other(to, from)));
transcodes!(u16 => u8, at most 3, |from, to| {
    // Half of a surrogate pair is a name on Windows and is nothing in UTF-8.
    let result = simdutf::convert::utf16::to::utf8::with_errors::le(from, to);
    result.is_successful().then_some(result.count)
});

/// `u8` or `u16`.
pub trait Unit: PathUnit + FromUnit<u8> + FromUnit<u16> + private::Sealed {}
impl Unit for u8 {}
impl Unit for u16 {}
impl private::Sealed for u8 {}
impl private::Sealed for u16 {}

/// Nothing outside this file can name these, so it can neither implement the traits that need them
/// nor call what takes a `Token`.
mod private {
    pub trait Sealed {}
    pub struct Token(pub(super) ());

    /// What `..` does to a path that has no name left to remove.
    #[derive(Copy, Clone, PartialEq, Eq)]
    pub enum AtFence {
        /// A root stays.
        Stay,
        /// A relative path gets a `..`.
        Climb,
        Fail,
        /// Fails, and the path cannot be replaced either: a [`Scope`](super::Scope) is open.
        Scoped,
    }
}
use private::{AtFence, Token};

// ── views ────────────────────────────────────────────────────────────────────────────────────────

/// Any of the views.
pub trait Units: private::Sealed {
    type Unit: Unit;
    fn units(&self) -> &[Self::Unit];
}

/// A view that a [`PathBuf`] can build.
pub trait View: Units {
    #[doc(hidden)]
    const MAY_BE_ABSOLUTE: bool;
    #[doc(hidden)]
    const WHEN_RELATIVE: AtFence;
    #[doc(hidden)]
    fn wrap(units: &[Self::Unit], token: Token) -> &Self;
}
/// A view whose kind says what it holds: every one but [`Tail`]. Only the builder of one can remove
/// or replace what it holds.
pub trait Known: View {}
/// A view that can hold an absolute path.
pub trait HoldsAbs: Known {}
/// A view that can be empty.
pub trait HoldsEmpty: Known {}

macro_rules! view {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[repr(transparent)]
        #[derive(PartialEq, Eq)]
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
        impl<C> private::Sealed for $name<C> {}
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
            fn wrap(units: &[C], _: Token) -> &Self {
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
view!(
    /// A path of a kind that is not known here, which a [`TailBuf`] builds.
    Tail
);
derefs_to!(Component => SubPath);
derefs_to!(SubPath => RelPath);
derefs_to!(RelPath => Path);
derefs_to!(AbsPath => Path);
derefs_to!(Tail => Path);
buildable!(Path, may be absolute: true, when relative: Climb, Known, HoldsAbs, HoldsEmpty);
buildable!(AbsPath, may be absolute: true, when relative: Fail, Known, HoldsAbs);
buildable!(RelPath, may be absolute: false, when relative: Climb, Known, HoldsEmpty);
buildable!(SubPath, may be absolute: false, when relative: Fail, Known, HoldsEmpty);
buildable!(Tail, may be absolute: false, when relative: Fail);

/// A `V` with a terminator after its last unit.
#[repr(transparent)]
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
macro_rules! widens_to {
    ($from:ident => $to:ident) => {
        impl<C: Unit> AsRef<Z<$to<C>>> for Z<$from<C>> {
            #[inline(always)]
            fn as_ref(&self) -> &Z<$to<C>> {
                // SAFETY: the same units, so the same terminator.
                unsafe { Z::wrap(&*self.0) }
            }
        }
    };
}
widens_to!(AbsPath => Path);
widens_to!(RelPath => Path);
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
        whole_root_len(units, is_native_sep)
    }
}

/// [`windows_root_len`] for a view, whose root names a drive or a share and ends in a separator.
#[cfg(any(windows, test))]
#[inline]
fn whole_root_len<C: PathUnit>(units: &[C], is_sep: impl Fn(C) -> bool + Copy) -> usize {
    let root = windows_root_len(units, is_sep);
    if root > 1 && is_sep(units[root - 1]) {
        root
    } else {
        0
    }
}

/// The root of a share as the OS writes it when it is the whole path: without its last separator.
#[cfg(windows)]
#[inline]
fn is_open_root<C: PathUnit>(units: &[C]) -> bool {
    units.len() > 1
        && windows_root_len(units, is_native_sep) == units.len()
        && !is_native_sep(units[units.len() - 1])
}

/// `units` without `dir` in front. The OS writes the letters of one Windows root in either case.
#[inline]
fn strip_dir<'a, C: PathUnit>(units: &'a [C], dir: &[C]) -> Option<&'a [C]> {
    #[cfg(not(windows))]
    {
        units.strip_prefix(dir)
    }
    #[cfg(windows)]
    {
        let (dir_root, dir_below) = dir.split_at(root_len(dir));
        let (root, below) = units.split_at_checked(dir_root.len())?;
        let same = |(a, b): (&C, &C)| {
            a == b
                || (a.to_ascii().zip(b.to_ascii())).is_some_and(|(a, b)| a.eq_ignore_ascii_case(&b))
        };
        if !root.iter().zip(dir_root).all(same) {
            return None;
        }
        below.strip_prefix(dir_below)
    }
}

/// Units of the root `units` starts with by the rules of Windows; 0 without one. The only reader of
/// such a root, for a view and for text, which differ in what separates.
///
/// | root | |
/// |---|---|
/// | `C:\` | the letter is one |
/// | `\\server\share\` | also `\\?\C:\` and `\\.\pipe\`; the last separator may be missing at the end |
/// | `\\?\UNC\server\share\` | |
/// | `\` | of whichever drive or share it is resolved against; also what starts like a share and is not one |
fn windows_root_len<C: PathUnit>(units: &[C], is_sep: impl Fn(C) -> bool) -> usize {
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
        if end == units.len() {
            return if seen == names { end } else { 1 };
        }
        end += 1;
    }
    end
}

#[inline]
fn is_dots<C: PathUnit>(name: &[C]) -> bool {
    matches!(name, [a] if a.eq_ascii(b'.')) || is_dot_dot(name)
}
#[inline]
fn is_dot_dot<C: PathUnit>(name: &[C]) -> bool {
    matches!(name, [a, b] if a.eq_ascii(b'.') && b.eq_ascii(b'.'))
}

/// A unit that no name on this host can hold. On Windows a `:` is only ever part of a root.
#[inline(always)]
fn is_forbidden_in_name<C: PathUnit>(c: C) -> bool {
    c.eq_ascii(0) || c.eq_ascii(b'/') || (cfg!(windows) && (c.eq_ascii(b'\\') || c.eq_ascii(b':')))
}

/// Whether `units`, past its root, is in the one form the views hold, with no `..`.
fn is_clean_below_root<C: PathUnit>(units: &[C]) -> bool {
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
        // A separator at the very end leaves no name after it.
        if name.is_empty() || is_dots(name) || end + 1 == units.len() {
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
        (root > 0 && is_clean_below_root(&units[root..])).then(|| Self::wrap_units(units))
    }

    /// For what the OS returned as an absolute path: `getcwd`, `realpath`, the path of an fd. Only
    /// the root is looked at: `None` without one.
    #[inline]
    pub fn from_os(units: &[C]) -> Option<&Self> {
        let root = root_len(units);
        if root == 0 {
            return None;
        }
        let mut end = units.len();
        while end > root && is_native_sep(units[end - 1]) {
            end -= 1;
        }
        debug_assert!(Self::new(&units[..end]).is_some());
        Some(Self::wrap_units(&units[..end]))
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

    /// What is left of this path below `dir`. `None` if it is not `dir` or below it.
    #[inline]
    pub fn strip_prefix(&self, dir: &Self) -> Option<&SubPath<C>> {
        let rest = strip_dir(&self.0, &dir.0)?;
        match rest {
            [] => Some(SubPath::wrap_units(rest)),
            [first, below @ ..] if is_native_sep(*first) => Some(SubPath::wrap_units(below)),
            _ if dir.is_root() => Some(SubPath::wrap_units(rest)),
            _ => None,
        }
    }
}

impl<C: PathUnit> SubPath<C> {
    /// `None` unless `units` is relative, holds no `..` and is already in the form the views hold.
    pub fn new(units: &[C]) -> Option<&Self> {
        (root_len(units) == 0 && is_clean_below_root(units)).then(|| Self::wrap_units(units))
    }

    /// For names the OS listed, joined with the native separator by the code that listed them.
    #[inline(always)]
    pub fn from_os(units: &[C]) -> &Self {
        debug_assert!(Self::new(units).is_some());
        Self::wrap_units(units)
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
        debug_assert!(Self::new(units).is_some());
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
    let (native, terminator) = terminated.split_at(terminated.len() - 1);
    assert!(terminator[0] == 0);
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
            assert!(native[i] != 0 && native[i] != b'/' && native[i] != b'\\' && native[i] != b':');
        }
        i += 1;
    }
    native
}
impl SubPath<u8> {
    #[doc(hidden)]
    pub const fn from_literal(terminated: &'static [u8]) -> &'static Z<Self> {
        // SAFETY: `check_literal` cuts off the last unit, which it checked is 0.
        unsafe { Z::wrap(Self::wrap_units(check_literal(terminated, false))) }
    }
}
impl Component<u8> {
    #[doc(hidden)]
    pub const fn from_literal(terminated: &'static [u8]) -> &'static Z<Self> {
        // SAFETY: `check_literal` cuts off the last unit, which it checked is 0.
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

/// What a [`PathBuf`] is given to write in: one path buffer.
///
/// # Safety
/// What `lend` returns is at least one unit, and valid for writes of that many units and for reads
/// of every unit written there until the drop of the `Held`, wherever that is moved to.
pub unsafe trait Storage<C> {
    type Held: Held;
    fn lend(self) -> (*mut C, usize, Self::Held);
}
/// What a [`PathBuf`] keeps of its [`Storage`]. It holds no reference and no `Box` to the memory: a
/// move of one claims the memory anew, which ends the pointer the builder writes through.
pub trait Held {}

/// The borrow of storage that its owner keeps.
pub struct Lent<'a>(PhantomData<&'a mut ()>);
impl Held for Lent<'_> {}

/// One path buffer in place, not initialized. Only `&mut Stack` is storage: the memory must stay
/// where it is when the `PathBuf` moves.
pub struct Stack<C: PathUnit = u8>(MaybeUninit<C::Buffer>);
impl<C: PathUnit> Stack<C> {
    #[inline(always)]
    pub const fn new() -> Self {
        Self(MaybeUninit::uninit())
    }
}
// SAFETY: `C::Buffer` is an array of `C`, borrowed for as long as the `Lent` lives.
unsafe impl<'a, C: PathUnit> Storage<C> for &'a mut Stack<C> {
    type Held = Lent<'a>;
    #[inline(always)]
    fn lend(self) -> (*mut C, usize, Lent<'a>) {
        (
            self.0.as_mut_ptr().cast(),
            size_of::<C::Buffer>() / size_of::<C>(),
            Lent(PhantomData),
        )
    }
}

/// One path buffer out of this thread's pool.
pub struct Pooled<C: PathUnit = u8>(*mut C::Buffer);
impl<C: PathUnit> Pooled<C> {
    #[inline]
    pub fn new() -> Self {
        Self(bun_core::heap::into_raw(C::pool_get()))
    }
}
impl<C: PathUnit> Drop for Pooled<C> {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: out of `into_raw`, taken once, here.
        C::pool_put(unsafe { bun_core::heap::take(self.0) });
    }
}
impl<C: PathUnit> Held for Pooled<C> {}
// SAFETY: `C::Buffer` is an array of `C` on the heap, freed by the drop of the `Pooled`.
unsafe impl<C: PathUnit> Storage<C> for Pooled<C> {
    type Held = Self;
    #[inline(always)]
    fn lend(self) -> (*mut C, usize, Self) {
        (self.0.cast(), size_of::<C::Buffer>() / size_of::<C>(), self)
    }
}
// SAFETY: as above, and borrowed for as long as the `Lent` lives.
unsafe impl<'a, C: PathUnit> Storage<C> for &'a mut Pooled<C> {
    type Held = Lent<'a>;
    #[inline(always)]
    fn lend(self) -> (*mut C, usize, Lent<'a>) {
        (
            self.0.cast(),
            size_of::<C::Buffer>() / size_of::<C>(),
            Lent(PhantomData),
        )
    }
}

/// The stack where a path buffer fits on it, the pool on Windows.
#[cfg(not(windows))]
pub type Scratch<C = u8> = Stack<C>;
#[cfg(windows)]
pub type Scratch<C = u8> = Pooled<C>;

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

/// Builds a `V` in the storage that `H` holds.
///
/// The first step that fails is remembered, and [`get`](Self::get), the only way to the path,
/// returns it from then on.
#[repr(C)]
pub struct PathBuf<V: View + ?Sized, H: Held + ?Sized> {
    /// What the storage lent.
    ptr: *mut V::Unit,
    cap: usize,
    /// Less than `cap`. While `err` is `None` the unit there is the terminator.
    len: usize,
    /// `..` removes nothing below this length, which is never more than `len`.
    fence: usize,
    at_fence: AtFence,
    err: Option<PathError>,
    view: PhantomData<fn(&V)>,
    /// Last, so that `&mut PathBuf<V, H>` coerces to `&mut DynPathBuf<V>`.
    held: H,
}
/// A builder in any storage, for a parameter, a field or a closure.
pub type DynPathBuf<'m, V> = PathBuf<V, dyn Held + 'm>;
/// What a function that only appends takes: the `tail()` of any builder.
pub type TailBuf<'m, C = u8> = DynPathBuf<'m, Tail<C>>;
pub type AbsPathBuf<H> = PathBuf<AbsPath, H>;
pub type RelPathBuf<H> = PathBuf<RelPath, H>;
pub type SubPathBuf<H> = PathBuf<SubPath, H>;
pub type AnyPathBuf<H> = PathBuf<Path, H>;

impl<V: View + ?Sized, H: Held + ?Sized> PathBuf<V, H> {
    /// Holds no path yet: [`get`](Self::get) fails as `Relative` until one is set.
    #[inline(always)]
    pub fn unset_in(mem: impl Storage<V::Unit, Held = H>) -> Self
    where
        H: Sized,
    {
        let (ptr, cap, held) = mem.lend();
        Self {
            ptr,
            cap,
            len: 0,
            fence: 0,
            at_fence: V::WHEN_RELATIVE,
            err: Some(PathError::Relative),
            view: PhantomData,
            held,
        }
    }

    /// Holds a copy of `path`.
    #[inline]
    pub fn from_in(mem: impl Storage<V::Unit, Held = H>, path: &V) -> Self
    where
        H: Sized,
        V: Known,
    {
        let mut this = Self::unset_in(mem);
        this.set(path);
        this
    }

    /// Holds a copy of the absolute `path`, of either unit.
    #[inline]
    pub fn from_abs_in<D: PathUnit>(mem: impl Storage<V::Unit, Held = H>, path: &AbsPath<D>) -> Self
    where
        H: Sized,
        V: HoldsAbs,
        V::Unit: FromUnit<D>,
    {
        let mut this = Self::unset_in(mem);
        this.set_abs(path);
        this
    }

    /// Holds an absolute path that the OS writes: `getcwd`, `realpath`, the path of an fd. `fill` gets
    /// all of the storage and returns the units it wrote, without a terminator.
    ///
    /// # Safety
    /// `fill` initializes as many units, from the first, as it returns, unless that is all it was
    /// given or more.
    pub unsafe fn from_os_in<E>(
        mem: impl Storage<V::Unit, Held = H>,
        fill: impl FnOnce(&mut [MaybeUninit<V::Unit>]) -> Result<usize, E>,
    ) -> Result<Self, E>
    where
        H: Sized,
        V: HoldsAbs,
    {
        let mut this = Self::unset_in(mem);
        // SAFETY: `Storage`'s.
        let len = fill(unsafe { core::slice::from_raw_parts_mut(this.ptr.cast(), this.cap) })?;
        // No room left for the terminator also means the OS may have cut the path short.
        if len >= this.cap {
            this.err = Some(PathError::TooLong);
            return Ok(this);
        }
        this.len = len;
        #[cfg(windows)]
        if is_open_root(this.written()) {
            this.write::<V::Unit>(true, &[]);
        }
        let root = root_len(this.written());
        if root == 0 {
            this.len = 0;
            return Ok(this);
        }
        this.err = None;
        let mut end = this.len;
        while end > root && is_native_sep(this.written()[end - 1]) {
            end -= 1;
        }
        this.truncate(end);
        this.fence_at_root();
        Ok(this)
    }

    /// Empty: the base itself.
    #[inline(always)]
    pub fn new_in(mem: impl Storage<V::Unit, Held = H>) -> Self
    where
        H: Sized,
        V: HoldsEmpty,
    {
        let mut this = Self::unset_in(mem);
        this.err = None;
        this.write::<V::Unit>(false, &[]);
        this
    }

    /// Replaces the whole path, and forgets an earlier failure.
    #[inline]
    pub fn set(&mut self, path: &V) -> &mut Self
    where
        V: Known,
    {
        self.replace(path.units())
    }

    /// [`set`](Self::set) to an absolute path, of either unit.
    #[inline]
    pub fn set_abs<D: PathUnit>(&mut self, path: &AbsPath<D>) -> &mut Self
    where
        V: HoldsAbs,
        V::Unit: FromUnit<D>,
    {
        self.replace(path.units())
    }

    /// [`set_abs`](Self::set_abs) to what the OS returned as an absolute path, which fails as
    /// `Relative` if it has no root.
    #[inline]
    pub fn set_os<D: PathUnit>(&mut self, units: &[D]) -> &mut Self
    where
        V: HoldsAbs,
        V::Unit: FromUnit<D>,
    {
        match AbsPath::from_os(units) {
            Some(path) => self.set_abs(path),
            #[cfg(windows)]
            None if is_open_root(units) && !self.is_scoped() => {
                self.replace(units);
                self.write::<V::Unit>(true, &[]);
                self.fence_at_root();
                self
            }
            None => {
                self.poison(PathError::Relative);
                self
            }
        }
    }

    #[inline(always)]
    fn replace<D: PathUnit>(&mut self, clean: &[D]) -> &mut Self
    where
        V::Unit: FromUnit<D>,
    {
        if self.is_scoped() {
            return self;
        }
        self.err = None;
        self.len = 0;
        self.write(false, clean);
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

    #[inline(always)]
    fn written(&self) -> &[V::Unit] {
        // SAFETY: the first `len` units were written.
        unsafe { core::slice::from_raw_parts(self.ptr.cast_const(), self.len) }
    }

    #[inline(always)]
    fn poison(&mut self, err: PathError) {
        if self.err.is_none() {
            self.err = Some(err);
        }
    }

    /// Appends an optional separator and `units`, then the terminator.
    #[inline(always)]
    fn write<D: PathUnit>(&mut self, sep: bool, units: &[D])
    where
        V::Unit: FromUnit<D>,
    {
        let at = self.len;
        let start = at + usize::from(sep);
        if start + V::Unit::bound(units) + 1 > self.cap {
            self.poison(PathError::TooLong);
            return;
        }
        // SAFETY: there is the room, and `units` is not in the storage, which `self` holds.
        unsafe {
            let base = self.ptr;
            // Overwritten by `units` or the terminator when there is no separator to write.
            base.add(at).write(V::Unit::from_u8(SEP));
            match V::Unit::transcode(units, base.add(start)) {
                Some(written) => self.len = start + written,
                None => self.poison(PathError::BadName),
            }
            base.add(self.len).write(V::Unit::from_u8(0));
        }
    }

    #[inline(always)]
    fn truncate(&mut self, len: usize) {
        debug_assert!(len <= self.len);
        self.len = len;
        // SAFETY: no more than `len`, which is less than `cap`.
        unsafe { self.ptr.add(len).write(V::Unit::from_u8(0)) };
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
            None => Ok(unsafe { Z::wrap(V::wrap(self.written(), Token(()))) }),
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
            self.write(self.needs_sep(), below.units());
        }
        self
    }

    /// Appends one name written by `args`, in place.
    pub fn push_fmt(&mut self, args: fmt::Arguments<'_>) -> &mut Self {
        struct Name<'a, V: View + ?Sized, H: Held + ?Sized> {
            buf: &'a mut PathBuf<V, H>,
            len: usize,
            failure: Option<PathError>,
        }
        impl<V: View + ?Sized, H: Held + ?Sized> fmt::Write for Name<'_, V, H> {
            fn write_str(&mut self, text: &str) -> fmt::Result {
                let text = text.as_bytes();
                let bound = <V::Unit as FromUnit<u8>>::bound(text);
                if self.failure.is_none() && self.len + bound + 1 > self.buf.cap {
                    self.failure = Some(PathError::TooLong);
                }
                if self.failure.is_some() {
                    return Err(fmt::Error);
                }
                // SAFETY: there is the room.
                match unsafe { V::Unit::transcode(text, self.buf.ptr.add(self.len)) } {
                    Some(written) => self.len += written,
                    None => self.failure = Some(PathError::BadName),
                }
                Ok(())
            }
        }
        if self.err.is_some() {
            return self;
        }
        let before = self.len;
        self.write::<V::Unit>(self.needs_sep(), &[]);
        if self.err.is_some() {
            return self;
        }
        let start = self.len;
        // `args` runs code of the caller's, which may unwind: there is no path until the name is whole.
        self.err = Some(PathError::BadName);
        let mut name = Name {
            buf: self,
            len: start,
            failure: None,
        };
        let wrote = fmt::Write::write_fmt(&mut name, args);
        let (end, failure) = (name.len, name.failure);
        // SAFETY: `Name` wrote up to `end`.
        let name =
            unsafe { core::slice::from_raw_parts(self.ptr.cast_const().add(start), end - start) };
        if failure.is_none() && wrote.is_ok() && Component::new(name).is_some() {
            self.len = end;
            self.truncate(end);
            self.err = None;
        } else {
            self.truncate(before);
            self.err = failure.or(self.err);
        }
        self
    }

    /// Removes the last name, as `..` does. With no name left above the fence: a root stays, a
    /// relative path gets a `..`, and a `SubPath`, or a path in a [`Scope`], fails.
    #[inline]
    pub fn up(&mut self) -> &mut Self
    where
        V: Known,
    {
        self.dot_dot();
        self
    }

    #[inline]
    fn dot_dot(&mut self) {
        let below = &self.written()[self.fence..];
        let last = last_sep(below).map_or(0, |i| i + 1);
        if !below.is_empty() && !is_dot_dot(&below[last..]) {
            self.truncate(self.fence + last.saturating_sub(1));
            return;
        }
        match self.at_fence {
            AtFence::Stay => {}
            AtFence::Climb => {
                let dots = [V::Unit::from_u8(b'.'); 2];
                self.write(self.needs_sep(), &dots);
            }
            AtFence::Fail | AtFence::Scoped => self.poison(PathError::Escapes),
        }
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

    #[inline(always)]
    fn restoring(&mut self) -> Restore<'_, V, H> {
        let saved = self.raise_fence(AtFence::Scoped);
        Restore { buf: self, saved }
    }

    /// Hands `f` the path with `count` times `..` after it, for the OS to resolve once it has
    /// followed the links in the path. No view holds that, so it is text for a syscall.
    pub fn with_os_parents<R>(
        &mut self,
        count: usize,
        f: impl FnOnce(&<V::Unit as PathUnit>::ZSlice) -> R,
    ) -> Result<R, PathError> {
        let Restore { buf, .. } = &mut self.restoring();
        let dots = [V::Unit::from_u8(b'.'); 2];
        for _ in 0..count {
            buf.write(buf.needs_sep(), &dots);
            if let Some(err) = buf.err {
                return Err(err);
            }
        }
        if let Some(err) = buf.err {
            return Err(err);
        }
        // SAFETY: every write puts a terminator at `len`.
        Ok(f(unsafe {
            V::Unit::zslice_from_raw(buf.ptr.cast_const(), buf.len)
        }))
    }

    /// Resolves `text`, read by the rules of `P`, against the path. `..` removes names down to the
    /// root. Absolute text replaces the path where the view can hold it, outside a [`Scope`]; on
    /// Windows `\name` replaces what is below the root.
    pub fn join<P: PlatformT>(&mut self, text: &[u8]) -> &mut Self
    where
        V: Known,
    {
        if self.err.is_some() {
            return self;
        }
        let root = text_root_len::<P>(text);
        if root > 0 {
            if !V::MAY_BE_ABSOLUTE {
                self.poison(PathError::Absolute);
                return self;
            }
            if self.is_scoped() {
                return self;
            }
            self.write_text_root(&text[..root]);
            self.fence_at_root();
        } else if has_drive::<P>(text) {
            self.poison(PathError::Absolute);
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
                b".." => self.dot_dot(),
                _ if forbidden => self.poison(PathError::BadName),
                _ => self.write(self.needs_sep(), name),
            }
        }
    }

    fn write_text_root(&mut self, root: &[u8]) {
        #[cfg(windows)]
        if root.len() == 1 {
            match root_len(self.written()) {
                0 => self.poison(PathError::Relative),
                kept => self.truncate(kept),
            }
            return;
        }
        self.len = 0;
        #[cfg(not(windows))]
        {
            // A drive or a share has no meaning here.
            if root.len() > 1 {
                self.poison(PathError::BadName);
            }
            self.write(false, b"/".as_slice());
        }
        #[cfg(windows)]
        {
            self.write(false, root);
            // SAFETY: `write` wrote `len` units.
            let written = unsafe { core::slice::from_raw_parts_mut(self.ptr, self.len) };
            for unit in written {
                if *unit == V::Unit::from_u8(b'/') {
                    *unit = V::Unit::from_u8(SEP);
                }
            }
            // A share at the very end of the text.
            if self.needs_sep() {
                self.write::<V::Unit>(true, &[]);
            }
        }
    }
}

impl<C: Unit, H: Held + ?Sized> PathBuf<AbsPath<C>, H> {
    /// [`from_abs_in`](Self::from_abs_in). On Windows a path on a drive or a share gets the `\\?\`
    /// prefix, with which the OS takes the path as it is written, however long.
    pub fn long_in<D: PathUnit>(mem: impl Storage<C, Held = H>, path: &AbsPath<D>) -> Self
    where
        H: Sized,
        C: FromUnit<D>,
    {
        let mut this = Self::unset_in(mem);
        this.err = None;
        let rest = path.units();
        #[cfg(windows)]
        let rest = match rest {
            [_, colon, ..] if colon.eq_ascii(b':') => {
                this.write(false, C::LONG_PATH_PREFIX);
                rest
            }
            [_, second, third, ..]
                if is_native_sep(*second) && !third.eq_ascii(b'?') && !third.eq_ascii(b'.') =>
            {
                this.write(false, C::LONG_PATH_PREFIX);
                this.write(false, b"UNC".as_slice());
                &rest[1..]
            }
            _ => rest,
        };
        this.write(false, rest);
        this.fence_at_root();
        this
    }

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
        if start + below + 1 > self.cap {
            self.poison(PathError::TooLong);
            return true;
        }
        // SAFETY: there is room for `start + below + 1` units, and `to` is not in the storage, which `self` holds.
        unsafe {
            let base = self.ptr;
            core::ptr::copy(base.add(self.len - below), base.add(start), below);
            base.add(start + below).write(C::from_u8(0));
            if start > to.len() {
                base.add(to.len()).write(C::from_u8(SEP));
            }
            core::ptr::copy_nonoverlapping(to.units().as_ptr(), base, to.len());
        }
        self.len = start + below;
        self.fence_at_root();
        true
    }
}

macro_rules! erased {
    () => {
        /// The same builder for a function that only appends and need not know the kind of path.
        /// Nothing that reads what `V` says of its kind takes a [`Tail`], which is not [`Known`], and
        /// being unsized it cannot be swapped with the tail of a path of another kind.
        #[inline(always)]
        pub fn tail(&mut self) -> &mut TailBuf<'_, V::Unit> {
            let this: &mut DynPathBuf<'_, V> = self;
            // SAFETY: `repr(C)`, and `V` is only in a `PhantomData` and, as the same unit, in the type of `ptr`.
            unsafe { &mut *(core::ptr::from_mut(this) as *mut TailBuf<'_, V::Unit>) }
        }

        /// Lends the path for changes that end with the [`Scope`].
        #[inline(always)]
        pub fn scope(&mut self) -> Scope<'_, V> {
            let this: &mut DynPathBuf<'_, V> = self;
            Scope(this.restoring())
        }
    };
}
impl<V: View + ?Sized, H: Held> PathBuf<V, H> {
    erased!();
}
impl<V: View + ?Sized> DynPathBuf<'_, V> {
    erased!();
}

struct Restore<'a, V: View + ?Sized, H: Held + ?Sized> {
    buf: &'a mut PathBuf<V, H>,
    saved: Saved,
}
impl<V: View + ?Sized, H: Held + ?Sized> Drop for Restore<'_, V, H> {
    #[inline(always)]
    fn drop(&mut self) {
        self.buf.truncate(self.saved.len);
        self.buf.err = self.saved.err;
        self.buf.fence = self.saved.fence;
        self.buf.at_fence = self.saved.at_fence;
    }
}

/// A [`PathBuf`] that goes back to what it was, failures included, when this is dropped. Until then
/// nothing removes or replaces what was there: what this lends is unsized, so no other builder can
/// be moved into its place.
pub struct Scope<'a, V: View + ?Sized>(Restore<'a, V, dyn Held + 'a>);
impl<V: View + ?Sized> Scope<'_, V> {
    /// The path as it was when the scope began, which it still starts with.
    #[inline]
    pub fn base(&self) -> Result<&V, PathError> {
        match self.0.saved.err {
            None => Ok(V::wrap(
                &self.0.buf.written()[..self.0.saved.len],
                Token(()),
            )),
            Some(err) => Err(err),
        }
    }
}
impl<'a, V: View + ?Sized> Deref for Scope<'a, V> {
    type Target = DynPathBuf<'a, V>;
    #[inline(always)]
    fn deref(&self) -> &DynPathBuf<'a, V> {
        self.0.buf
    }
}
impl<'a, V: View + ?Sized> DerefMut for Scope<'a, V> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut DynPathBuf<'a, V> {
        self.0.buf
    }
}

/// Units of the root that `text` starts with by the rules of `P`; 0 for relative text.
#[inline]
fn text_root_len<P: PlatformT>(text: &[u8]) -> usize {
    match P::P {
        Platform::Posix => usize::from(text.first() == Some(&b'/')),
        // Elsewhere than on Windows this is a POSIX path that may be written with `\`.
        Platform::Loose if !cfg!(windows) => usize::from(matches!(text, [b'/' | b'\\', ..])),
        _ => windows_root_len(text, |c| P::P.is_separator(c)),
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
            .is_some_and(|first| bun_core::strings::contains_char(first, b':'))
}

/// The way from the directory `from` to `to`.
pub fn relative_in<C: Unit, S: Storage<C>>(
    mem: S,
    from: &AbsPath<C>,
    to: &AbsPath<C>,
) -> PathBuf<RelPath<C>, S::Held> {
    let mut out = PathBuf::<RelPath<C>, S::Held>::new_in(mem);
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
        .expect("the project's directory is absolute")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resolve_path::platform::{Loose, Posix, Windows};

    /// simdutf is C++, which neither `cargo test` links nor Miri runs. The other direction is in
    /// `string_paths`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(
        from: *const u16,
        len: usize,
        to: *mut u8,
    ) -> simdutf::SIMDUTFResult {
        // SAFETY: the caller's, with room for three units for each one.
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

    /// Storage small enough to fill.
    struct Small<C = u8>([MaybeUninit<C>; SMALL]);
    const SMALL: usize = 24;
    impl<C: Copy> Small<C> {
        fn new() -> Self {
            Self([MaybeUninit::uninit(); SMALL])
        }
    }
    // SAFETY: an array of `C`, borrowed for as long as the `Lent` lives.
    unsafe impl<'a, C> Storage<C> for &'a mut Small<C> {
        type Held = Lent<'a>;
        fn lend(self) -> (*mut C, usize, Lent<'a>) {
            (self.0.as_mut_ptr().cast(), SMALL, Lent(PhantomData))
        }
    }
    fn small<'a>(mem: &'a mut Small, path: &str) -> AbsPathBuf<Lent<'a>> {
        AbsPathBuf::from_in(mem, AbsPath::new(&native(path)).unwrap())
    }
    /// A name that with [`ROOT`] before it takes `len` units.
    fn name_up_to(len: usize) -> Vec<u8> {
        vec![b'x'; len - ROOT.len()]
    }

    /// A path of this host from one written with `/`, where a leading `/` stands for [`ROOT`].
    fn native(portable: &str) -> Vec<u8> {
        let (root, below) = match portable.strip_prefix('/') {
            Some(below) => (ROOT, below),
            None => ("", portable),
        };
        format!("{root}{}", below.replace('/', &char::from(SEP).to_string())).into_bytes()
    }
    /// The reverse of [`native`].
    fn portable(native: &[u8]) -> String {
        let native = core::str::from_utf8(native).unwrap();
        match native.strip_prefix(ROOT) {
            Some(below) => format!("/{}", below.replace(char::from(SEP), "/")),
            None => native.replace(char::from(SEP), "/"),
        }
    }
    /// The path as it is written on this host, or the name of the failure. Reads the terminator.
    fn raw<V: Units<Unit = u8> + ?Sized>(path: Result<&Z<V>, PathError>) -> String {
        match path {
            Ok(path) => {
                let z = path.z();
                // SAFETY: what a `Z` promises.
                assert_eq!(unsafe { *z.as_ptr().add(z.len()) }, 0);
                assert_eq!(z.as_bytes(), path.units());
                String::from_utf8(path.units().to_vec()).unwrap()
            }
            Err(err) => format!("{err:?}"),
        }
    }
    fn show<V: Units<Unit = u8> + ?Sized>(path: Result<&Z<V>, PathError>) -> String {
        match path {
            Ok(_) => portable(raw(path).as_bytes()),
            Err(err) => format!("{err:?}"),
        }
    }
    fn show_wide<V: Units<Unit = u16> + ?Sized>(path: Result<&Z<V>, PathError>) -> String {
        match path {
            Ok(path) => {
                let z = path.z();
                // SAFETY: what a `Z` promises.
                assert_eq!(unsafe { *z.as_ptr().add(z.len()) }, 0);
                portable(String::from_utf16(path.units()).unwrap().as_bytes())
            }
            Err(err) => format!("{err:?}"),
        }
    }
    fn at<'a>(mem: &'a mut Stack, path: &str) -> AbsPathBuf<Lent<'a>> {
        AbsPathBuf::from_in(mem, AbsPath::new(&native(path)).unwrap())
    }
    /// What an OS call that writes `text` does with the room it is given.
    fn writes<C: Copy>(text: &[C]) -> impl FnOnce(&mut [MaybeUninit<C>]) -> Result<usize, ()> {
        move |room| {
            for (unit, from) in room.iter_mut().zip(text) {
                unit.write(*from);
            }
            Ok(text.len())
        }
    }

    #[test]
    fn a_view_takes_one_form() {
        for (text, kinds) in [
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
            let units = native(text);
            let mut taken = String::new();
            taken.extend(AbsPath::new(&units).map(|_| 'a'));
            taken.extend(SubPath::new(&units).map(|_| 's'));
            taken.extend(Component::new(&units).map(|_| 'n'));
            assert_eq!(taken, kinds, "{text:?}");
        }
    }

    #[test]
    fn parents_names_and_what_is_below() {
        let path = native("/a/b/cd");
        let path = AbsPath::new(&path).unwrap();
        let up = core::iter::successors(Some(path), |path| path.parent());
        let up: Vec<String> = up.map(|path| portable(path.as_bytes())).collect();
        assert_eq!(up, ["/a/b/cd", "/a/b", "/a", "/"]);
        assert_eq!(path.basename().unwrap().as_bytes(), b"cd");
        let root = AbsPath::new(ROOT.as_bytes()).unwrap();
        assert!(root.is_root() && root.parent().is_none() && root.basename().is_none());

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
            let dir = native(dir);
            let got = path.strip_prefix(AbsPath::new(&dir).unwrap());
            assert_eq!(
                got.map(|p| portable(p.as_bytes())).as_deref(),
                below,
                "{dir:?}"
            );
        }
    }

    #[test]
    fn literals() {
        assert_eq!(raw(Ok(component!("node_modules"))), "node_modules");
        assert_eq!(
            show(Ok(sub_path!("node_modules/.bun"))),
            "node_modules/.bun"
        );
    }

    #[test]
    fn join() {
        for (text, joined) in [
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
            ("a\0b", "BadName"),
        ] {
            let mut mem = Stack::new();
            assert_eq!(
                show(at(&mut mem, "/a/b").join::<Posix>(text.as_bytes()).get()),
                joined,
                "{text:?}"
            );
            assert_eq!(
                show(at(&mut mem, "/a/b").join::<Loose>(text.as_bytes()).get()),
                joined,
                "{text:?}"
            );
        }
        let mut mem = Stack::new();
        assert_eq!(
            show(
                at(&mut mem, "/a/b")
                    .join::<Loose>(b"c\\d\\..\\..\\..\\x")
                    .get()
            ),
            "/a/x"
        );
        assert_eq!(
            show(at(&mut mem, "/a/b").join::<Windows>(b"c\\d/e").get()),
            "/a/b/c/d/e"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn a_backslash_and_a_colon_are_part_of_a_name_here() {
        let mut mem = Stack::new();
        assert_eq!(
            show(at(&mut mem, "/a").join::<Posix>(b"c\\..\\d").get()),
            "/a/c\\..\\d"
        );
        assert_eq!(
            show(at(&mut mem, "/a").push_names::<Posix>(b"c\\d").get()),
            "/a/c\\d"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join_below::<Loose>(b"pkgs:a/x").get()),
            "/a/pkgs:a/x"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join::<Loose>(b"C:x").get()),
            "/a/C:x"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join::<Loose>(b"C:\\x").get()),
            "/a/C:/x"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join_below::<Loose>(b"C:/x").get()),
            "/a/C:/x"
        );
        // Text that is a Windows path: a drive or a share has no meaning here.
        assert_eq!(
            show(at(&mut mem, "/a").join::<Windows>(b"C:\\x").get()),
            "BadName"
        );
        assert_eq!(
            show(
                at(&mut mem, "/a")
                    .join::<Windows>(b"\\\\srv\\share\\x")
                    .get()
            ),
            "BadName"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join_below::<Windows>(b"C:/x").get()),
            "Absolute"
        );
        assert_eq!(
            show(at(&mut mem, "/a").join::<Windows>(b"C:x").get()),
            "Absolute"
        );
    }

    #[test]
    fn join_below_stays_below() {
        for (text, joined) in [
            ("", "/a/b"),
            ("x", "/a/b/x"),
            ("x/../y", "/a/b/y"),
            ("x/..", "/a/b"),
            ("..", "Escapes"),
            ("x/../..", "Escapes"),
            ("x/../../b/y", "Escapes"),
            ("/etc", "Absolute"),
            ("/a/b/x", "Absolute"),
        ] {
            let mut mem = Stack::new();
            assert_eq!(
                show(
                    at(&mut mem, "/a/b")
                        .join_below::<Posix>(text.as_bytes())
                        .get()
                ),
                joined,
                "{text:?}"
            );
        }
        let mut mem = Stack::new();
        assert_eq!(
            show(
                at(&mut mem, "/a/b")
                    .join_below::<Loose>(b"x\\..\\..\\..\\etc")
                    .get()
            ),
            "Escapes"
        );
        assert_eq!(
            show(
                at(&mut mem, "/a/b")
                    .join_below::<Loose>(b"x\\y/../..\\z")
                    .get()
            ),
            "/a/b/z"
        );

        let mut rel = RelPathBuf::new_in(&mut mem);
        assert_eq!(show(rel.join_below::<Posix>(b"..").get()), "Escapes");
    }

    #[test]
    fn push_names_takes_names_only() {
        for (text, pushed) in [
            ("react", "/nm/react"),
            ("@scope/pkg", "/nm/@scope/pkg"),
            ("...", "/nm/..."),
            ("", "BadName"),
            (".", "BadName"),
            ("..", "BadName"),
            ("a/..", "BadName"),
            ("a/./b", "BadName"),
            ("a//b", "BadName"),
            ("a/", "BadName"),
            ("a\0b", "BadName"),
            ("/a", "Absolute"),
        ] {
            let mut mem = Stack::new();
            assert_eq!(
                show(
                    at(&mut mem, "/nm")
                        .push_names::<Posix>(text.as_bytes())
                        .get()
                ),
                pushed,
                "{text:?}"
            );
        }
    }

    #[test]
    fn what_dot_dot_does_with_no_name_left() {
        let mut mem = Stack::new();
        assert_eq!(show(at(&mut mem, "/a").up().up().up().get()), "/");

        let mut rel = RelPathBuf::new_in(&mut mem);
        assert_eq!(
            show(rel.up().up().push(component!("x")).up().up().get()),
            "../../.."
        );
        assert_eq!(show(rel.join::<Posix>(b"a/../../b").get()), "../../../../b");

        let mut sub = SubPathBuf::new_in(&mut mem);
        assert_eq!(show(sub.push(component!("a")).up().get()), "");
        assert_eq!(show(sub.up().get()), "Escapes");

        let mut any = AnyPathBuf::new_in(&mut mem);
        assert_eq!(show(any.join::<Posix>(b"a/../..").get()), "..");
        assert!(matches!(any.get().unwrap().classify(), Classified::Rel(_)));
    }

    #[test]
    fn the_first_failure_stays_until_the_path_is_set() {
        let mut mem = Small::new();
        let mut path = small(&mut mem, "/a/b");
        path.join_below::<Posix>(b"../x")
            .push(component!("more"))
            .join::<Posix>(b"/y");
        path.push(SubPath::new(&name_up_to(SMALL)).unwrap());
        assert_eq!(path.error(), Some(PathError::Escapes));
        assert_eq!(show(path.get()), "Escapes");
        assert_eq!(
            show(path.set(AbsPath::new(&native("/z")).unwrap()).get()),
            "/z"
        );

        let mut unset = AbsPathBuf::unset_in(&mut mem);
        assert_eq!(show(unset.get()), "Relative");
        assert_eq!(show(unset.push(component!("x")).up().get()), "Relative");
        assert_eq!(unset.shown(), b"");
    }

    #[test]
    fn a_path_fills_its_storage_and_no_more() {
        let (fits, too_long) = (name_up_to(SMALL - 1), name_up_to(SMALL));
        let mut mem = Small::new();
        let mut path = small(&mut mem, "/");
        path.push(SubPath::new(&fits).unwrap());
        assert_eq!(raw(path.get()).len(), SMALL - 1);
        assert_eq!(show(path.push(component!("y")).get()), "TooLong");

        type Step = fn(&mut DynPathBuf<'_, AbsPath>, &[u8]);
        let steps: [Step; 5] = [
            |path, name| _ = path.push(SubPath::new(name).unwrap()),
            |path, name| _ = path.push_names::<Posix>(name),
            |path, name| _ = path.join::<Posix>(name),
            |path, name| _ = path.join_below::<Posix>(name),
            |path, name| _ = path.push_fmt(format_args!("{}", name.escape_ascii())),
        ];
        for step in steps {
            let mut path = small(&mut mem, "/");
            step(&mut path, &fits);
            assert_eq!(raw(path.get()).len(), SMALL - 1);
            assert_eq!(show(path.up().get()), "/");
            step(&mut path, &too_long);
            assert_eq!(show(path.get()), "TooLong");
        }

        let whole = [native("/").as_slice(), &too_long].concat();
        let whole = AbsPath::new(&whole).unwrap();
        assert_eq!(show(AbsPathBuf::from_in(&mut mem, whole).get()), "TooLong");
        assert_eq!(
            show(small(&mut mem, "/").set_os(whole.as_bytes()).get()),
            "TooLong"
        );
    }

    #[test]
    fn the_stack_and_the_pool_lend_one_path_buffer() {
        fn ends<C: PathUnit>(mem: impl Storage<C>) {
            let (ptr, cap, _held) = mem.lend();
            assert_eq!(cap, size_of::<C::Buffer>() / size_of::<C>());
            // SAFETY: what `Storage` promises.
            unsafe { ptr.add(cap - 1).write(C::from_u8(0)) };
        }
        ends::<u8>(&mut Stack::new());
        ends::<u16>(&mut Stack::new());
        ends::<u8>(&mut Pooled::new());
        ends::<u16>(Pooled::new());
    }

    #[test]
    fn push_fmt_writes_one_name() {
        let mut mem = Stack::new();
        assert_eq!(
            show(
                at(&mut mem, "/a")
                    .push_fmt(format_args!("{}@{}", "react", 18))
                    .get()
            ),
            "/a/react@18"
        );
        assert_eq!(
            show(at(&mut mem, "/").push_fmt(format_args!("x")).get()),
            "/x"
        );
        for name in ["", ".", "..", "a\0b", "a/b"] {
            let name = String::from_utf8(native(name)).unwrap();
            assert_eq!(
                show(at(&mut mem, "/a").push_fmt(format_args!("{name}")).get()),
                "BadName",
                "{name:?}"
            );
        }

        struct Fails;
        impl fmt::Display for Fails {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("half")?;
                Err(fmt::Error)
            }
        }
        let mut path = at(&mut mem, "/a");
        assert_eq!(
            show(path.push_fmt(format_args!("{Fails}")).get()),
            "BadName"
        );
        assert_eq!(portable(path.shown()), "/a");

        struct Panics;
        impl fmt::Display for Panics {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("half")?;
                panic!("in the middle of a name")
            }
        }
        let mut path = at(&mut mem, "/a");
        let unwound = std::panic::catch_unwind(core::panic::AssertUnwindSafe(|| {
            path.push_fmt(format_args!("{Panics}"));
        }));
        assert!(unwound.is_err());
        assert_eq!(show(path.get()), "BadName");
    }

    #[test]
    fn a_scope_puts_the_path_back() {
        let mut mem = Small::new();
        let mut path = small(&mut mem, "/a/b");
        {
            let mut outer = path.scope();
            outer.push(component!("c"));
            {
                let mut inner = outer.scope();
                assert_eq!(portable(inner.base().unwrap().as_bytes()), "/a/b/c");
                assert_eq!(show(inner.push(component!("d")).get()), "/a/b/c/d");
            }
            assert_eq!(portable(outer.base().unwrap().as_bytes()), "/a/b");
            assert_eq!(show(outer.get()), "/a/b/c");
            assert_eq!(show(outer.up().get()), "/a/b");
            assert_eq!(show(outer.up().get()), "Escapes");
        }
        assert_eq!(show(path.get()), "/a/b");

        let elsewhere = native("/x");
        let elsewhere = AbsPath::new(&elsewhere).unwrap();
        let steps: [fn(&mut DynPathBuf<'_, AbsPath>, &AbsPath); 6] = [
            |path, _| _ = path.join::<Posix>(b"../../.."),
            |path, _| _ = path.join::<Posix>(b"/etc"),
            |path, elsewhere| _ = path.set(elsewhere),
            |path, elsewhere| _ = path.set_abs(elsewhere),
            |path, elsewhere| _ = path.set_os(elsewhere.as_bytes()),
            |path, elsewhere| _ = path.rebase(AbsPath::new(&native("/a")).unwrap(), elsewhere),
        ];
        for step in steps {
            let mut scope = path.scope();
            step(&mut scope, elsewhere);
            assert_eq!(show(scope.get()), "Escapes");
            drop(scope);
            assert_eq!(show(path.get()), "/a/b");
        }

        path.scope().push(SubPath::new(&name_up_to(SMALL)).unwrap());
        assert_eq!(show(path.push(component!("ok")).get()), "/a/b/ok");

        fn leaves_early(path: &mut DynPathBuf<'_, AbsPath>) -> Result<(), PathError> {
            let mut scope = path.scope();
            scope
                .push(component!("deep"))
                .join_below::<Posix>(b"..")
                .get()?;
            scope.join_below::<Posix>(b"../..").get()?;
            unreachable!()
        }
        assert_eq!(leaves_early(&mut path), Err(PathError::Escapes));
        assert_eq!(show(path.get()), "/a/b/ok");

        path.join_below::<Posix>(b"..");
        path.scope().push(component!("x"));
        assert_eq!(show(path.get()), "Escapes");
    }

    #[test]
    fn a_forgotten_scope_leaves_a_path_that_cannot_be_led_out() {
        let mut mem = Stack::new();
        let mut path = at(&mut mem, "/a/b");
        let mut scope = path.scope();
        scope.push(component!("c"));
        core::mem::forget(scope);
        assert_eq!(show(path.get()), "/a/b/c");
        assert_eq!(show(path.up().up().get()), "Escapes");
    }

    #[test]
    fn a_tail_only_appends() {
        fn helper<C: Unit>(tail: &mut TailBuf<'_, C>, name: &[u8]) {
            tail.push(component!("node_modules"))
                .push_names::<Posix>(name);
        }
        let mut mem = Stack::new();
        let mut abs = at(&mut mem, "/w");
        helper(abs.tail(), b"react");
        assert_eq!(show(abs.tail().get()), "/w/node_modules/react");
        assert_eq!(show(abs.get()), "/w/node_modules/react");
        assert_eq!(
            show(abs.tail().join_below::<Posix>(b"x/../..").get()),
            "Escapes"
        );

        let mut rel = RelPathBuf::new_in(Pooled::new());
        helper(rel.tail(), b"@s/p");
        assert_eq!(show(rel.get()), "node_modules/@s/p");
        assert_eq!(
            show(rel.tail().join_below::<Posix>(b"/etc").get()),
            "Absolute"
        );

        let mut abs = at(&mut mem, "/w");
        let mut scope = abs.scope();
        helper(scope.tail(), b"x");
        assert_eq!(
            show(scope.tail().scope().push(component!("y")).get()),
            "/w/node_modules/x/y"
        );
        assert_eq!(show(scope.get()), "/w/node_modules/x");
        drop(scope);
        assert_eq!(show(abs.get()), "/w");
    }

    #[test]
    fn a_builder_moves_and_its_memory_is_lent_again() {
        fn made(mem: &mut Stack) -> AbsPathBuf<Lent<'_>> {
            let mut path = at(mem, "/a");
            path.push(component!("b"));
            path
        }
        let mut mem = Stack::new();
        let mut path = made(&mut mem);
        path.push(component!("c"));
        let mut boxed = Box::new(path);
        boxed.push(component!("d"));
        assert_eq!(show(boxed.get()), "/a/b/c/d");
        assert_eq!(show(at(&mut mem, "/again").get()), "/again");

        let mut pool = Pooled::new();
        let mut lent = AbsPathBuf::from_in(&mut pool, AbsPath::new(&native("/p")).unwrap());
        lent.push(component!("q"));
        let mut moved = [lent];
        assert_eq!(show(moved[0].push(component!("r")).get()), "/p/q/r");
        assert_eq!(
            show(RelPathBuf::new_in(&mut pool).push(component!("s")).get()),
            "s"
        );

        let mut owned = AbsPathBuf::from_in(pool, AbsPath::new(&native("/o")).unwrap());
        owned.push(component!("p"));
        let mut kept = vec![owned];
        kept.reserve(64);
        assert_eq!(show(kept[0].push(component!("q")).get()), "/o/p/q");
    }

    #[test]
    fn rebase() {
        for (path, from, to, moved) in [
            ("/old/root/x/y", "/old/root", "/new", Some("/new/x/y")),
            (
                "/old/root/x/y",
                "/old/root",
                "/a/longer/base/than/that",
                Some("/a/longer/base/than/that/x/y"),
            ),
            ("/old/root", "/old/root", "/new", Some("/new")),
            ("/old/root/x", "/old/root", "/", Some("/x")),
            ("/old/root", "/old/root", "/", Some("/")),
            ("/x/y", "/", "/new", Some("/new/x/y")),
            ("/", "/", "/new", Some("/new")),
            ("/old/rooted", "/old/root", "/new", None),
            ("/old", "/old/root", "/new", None),
        ] {
            let (from, to) = (native(from), native(to));
            let mut mem = Stack::new();
            let mut built = at(&mut mem, path);
            let did = built.rebase(AbsPath::new(&from).unwrap(), AbsPath::new(&to).unwrap());
            assert_eq!(did, moved.is_some(), "{path}");
            assert_eq!(show(built.get()), moved.unwrap_or(path));
            assert_eq!(show(built.up().up().up().up().up().up().up().get()), "/");
        }
        for (len, moved) in [(SMALL - 1, true), (SMALL, false)] {
            let from = native("/a");
            let to = [native("/"), name_up_to(len - "/0123456789".len())].concat();
            let mut mem = Small::new();
            let mut built = small(&mut mem, "/a/0123456789");
            assert!(built.rebase(AbsPath::new(&from).unwrap(), AbsPath::new(&to).unwrap()));
            assert_eq!(
                built.get().map(|path| path.len()).ok(),
                moved.then_some(len)
            );
            assert_eq!(built.error(), (!moved).then_some(PathError::TooLong));
        }
    }

    #[test]
    fn the_way_from_one_directory_to_another() {
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
            let (from, to) = (native(from), native(to));
            let mut mem = Stack::new();
            let built = relative_in(
                &mut mem,
                AbsPath::new(&from).unwrap(),
                AbsPath::new(&to).unwrap(),
            );
            assert_eq!(show(built.get()), way);
        }
    }

    #[test]
    fn what_the_os_wrote() {
        assert!(AbsPath::<u8>::from_os(b"").is_none());
        assert!(AbsPath::<u8>::from_os(b"rel").is_none());
        for (wrote, path) in [
            ("/a/b", "/a/b"),
            ("/a/b///", "/a/b"),
            ("/", "/"),
            ("rel", "Relative"),
            ("", "Relative"),
        ] {
            let wrote = native(wrote);
            let mut mem = Stack::new();
            assert_eq!(
                show(AbsPathBuf::unset_in(&mut mem).set_os(&wrote).get()),
                path
            );
            // SAFETY: `writes` initializes what it returns, or all it was given.
            let mut built = unsafe { AbsPathBuf::from_os_in(&mut mem, writes(&wrote)) }.unwrap();
            assert_eq!(show(built.get()), path);
            if built.error().is_none() {
                assert_eq!(
                    show(built.push(component!("x")).up().up().up().up().get()),
                    "/"
                );
            }
        }

        let mut mem = Small::new();
        // SAFETY: it returns no length.
        let failed = unsafe { AbsPathBuf::from_os_in(&mut mem, |_| Err("the call failed")) };
        assert_eq!(failed.err(), Some("the call failed"));

        // With no room left for the terminator the OS may have cut the path short.
        let filled = [native("/"), name_up_to(SMALL + 1)].concat();
        for len in [SMALL, SMALL + 1] {
            // SAFETY: as above.
            let path = unsafe { AbsPathBuf::from_os_in(&mut mem, writes(&filled[..len])) }.unwrap();
            assert_eq!(show(path.get()), "TooLong");
        }
        let fits = writes(&filled[..SMALL - 1]);
        // SAFETY: as above.
        let mut path = unsafe { AbsPathBuf::from_os_in(&mut mem, fits) }.unwrap();
        assert_eq!(raw(path.get()).len(), SMALL - 1);
        assert_eq!(show(path.up().get()), "/");
    }

    #[test]
    fn dot_dot_for_the_os_to_resolve() {
        let mut mem = Small::new();
        let mut path = small(&mut mem, "/a/b");
        let seen = path.with_os_parents(2, |text| portable(text.as_bytes()));
        assert_eq!(seen.as_deref(), Ok("/a/b/../.."));
        let seen = path.with_os_parents(0, |text| portable(text.as_bytes()));
        assert_eq!(seen.as_deref(), Ok("/a/b"));

        path.up()
            .up()
            .push(SubPath::new(&name_up_to(SMALL - 1 - 2 * "/..".len())).unwrap());
        assert_eq!(path.with_os_parents(2, |text| text.len()), Ok(SMALL - 1));
        assert_eq!(path.with_os_parents(3, |_| ()), Err(PathError::TooLong));
        assert_eq!(raw(path.get()).len(), SMALL - 1 - 2 * "/..".len());

        let shown = path.join_below::<Posix>(b"..").shown().to_vec();
        assert_eq!(path.with_os_parents(1, |_| ()), Err(PathError::Escapes));
        assert_eq!(path.shown(), shown);
    }

    #[test]
    fn both_units() {
        let base = native("/w");
        let base = AbsPath::new(&base).unwrap();
        let mut mem = Stack::<u16>::new();
        let mut wide = PathBuf::<AbsPath<u16>, _>::from_abs_in(&mut mem, base);
        wide.push(component!("node_modules"))
            .join_below::<Posix>("a/\u{e9}/../b".as_bytes());
        wide.push_fmt(format_args!("{}@{}", "r\u{e9}act", 18));
        assert_eq!(show_wide(wide.get()), "/w/node_modules/a/b/r\u{e9}act@18");

        let wide_base: Vec<u16> = base.as_bytes().iter().map(|&c| u16::from(c)).collect();
        let below = wide
            .get()
            .unwrap()
            .strip_prefix(AbsPath::new(&wide_base).unwrap())
            .unwrap();
        let mut narrow_mem = Stack::new();
        let mut narrow = at(&mut narrow_mem, "/back");
        assert_eq!(
            show(narrow.push(below).get()),
            "/back/node_modules/a/b/r\u{e9}act@18"
        );
        assert_eq!(
            show(narrow.set_abs(&**wide.get().unwrap()).get()),
            "/w/node_modules/a/b/r\u{e9}act@18"
        );

        // Half of a surrogate pair is a name on Windows and is nothing in UTF-8.
        assert_eq!(
            show(narrow.push(Component::<u16>::new(&[0xD800]).unwrap()).get()),
            "BadName"
        );

        // One unit of UTF-16 can take three of UTF-8, and the room is asked for before they are read.
        let most = (SMALL - 1 - ROOT.len()) / 3;
        let name = [u16::from(b'x'); SMALL];
        let mut mem = Small::new();
        let mut path = small(&mut mem, "/");
        path.push(SubPath::new(&name[..most]).unwrap());
        assert_eq!(raw(path.get()).len(), ROOT.len() + most);
        path.up().push(SubPath::new(&name[..most + 1]).unwrap());
        assert_eq!(show(path.get()), "TooLong");

        let mut mem = Small::<u16>::new();
        for (len, fits) in [(SMALL - 1, true), (SMALL, false)] {
            let mut path =
                PathBuf::<AbsPath<u16>, _>::from_abs_in(&mut mem, base.parent().unwrap());
            path.push(SubPath::new(&name_up_to(len)).unwrap());
            assert_eq!(path.get().map(|path| path.len()).ok(), fits.then_some(len));
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn the_long_form_is_the_path_itself_here() {
        let path = native("/a/b");
        let mut mem = Stack::new();
        assert_eq!(
            show(AbsPathBuf::long_in(&mut mem, AbsPath::new(&path).unwrap()).get()),
            "/a/b"
        );
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
            let whole = if root.len() > 1 && root.ends_with('\\') {
                root
            } else {
                ""
            };
            assert_eq!(
                &text[..whole_root_len(text.as_bytes(), |c| c == b'\\')],
                whole,
                "{text}"
            );
        }
        assert_eq!(either("C:/x"), 3);
        assert_eq!(either("\\/srv/share\\x"), 12);
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use crate::resolve_path::platform::Windows;

    fn raw<V: Units<Unit = u8> + ?Sized>(path: Result<&Z<V>, PathError>) -> String {
        match path {
            Ok(path) => String::from_utf8(path.units().to_vec()).unwrap(),
            Err(err) => format!("{err:?}"),
        }
    }
    fn at<'a>(mem: &'a mut Stack, path: &str) -> AbsPathBuf<Lent<'a>> {
        AbsPathBuf::from_in(mem, AbsPath::new(path.as_bytes()).unwrap())
    }

    const BASES: [&str; 3] = ["C:\\a\\b", "\\\\srv\\share\\d", "\\\\?\\C:\\a"];
    #[rustfmt::skip]
    const JOIN: &[(&str, [&str; 3])] = &[
        ("", ["C:\\a\\b", "\\\\srv\\share\\d", "\\\\?\\C:\\a"]),
        ("..\\..\\..", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"]),
        ("x/y", ["C:\\a\\b\\x\\y", "\\\\srv\\share\\d\\x\\y", "\\\\?\\C:\\a\\x\\y"]),
        ("x\\..\\y", ["C:\\a\\b\\y", "\\\\srv\\share\\d\\y", "\\\\?\\C:\\a\\y"]),
        ("C:\\", ["C:\\", "C:\\", "C:\\"]),
        ("c:/x/y", ["c:\\x\\y", "c:\\x\\y", "c:\\x\\y"]),
        ("D:\\x", ["D:\\x", "D:\\x", "D:\\x"]),
        ("C:", ["Absolute", "Absolute", "Absolute"]),
        ("C:x", ["Absolute", "Absolute", "Absolute"]),
        ("1:\\x", ["Absolute", "Absolute", "Absolute"]),
        ("\\", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"]),
        ("\\x", ["C:\\x", "\\\\srv\\share\\x", "\\\\?\\C:\\x"]),
        ("/x", ["C:\\x", "\\\\srv\\share\\x", "\\\\?\\C:\\x"]),
        ("\\\\srv\\share", ["\\\\srv\\share\\", "\\\\srv\\share\\", "\\\\srv\\share\\"]),
        ("\\\\srv\\share\\x\\..\\..", ["\\\\srv\\share\\", "\\\\srv\\share\\", "\\\\srv\\share\\"]),
        ("//srv/share/x", ["\\\\srv\\share\\x", "\\\\srv\\share\\x", "\\\\srv\\share\\x"]),
        ("\\\\srv", ["C:\\srv", "\\\\srv\\share\\srv", "\\\\?\\C:\\srv"]),
        ("\\\\", ["C:\\", "\\\\srv\\share\\", "\\\\?\\C:\\"]),
        ("\\\\?\\C:\\x\\..\\..", ["\\\\?\\C:\\", "\\\\?\\C:\\", "\\\\?\\C:\\"]),
        ("\\\\?\\UNC\\srv\\share\\x\\..\\..", ["\\\\?\\UNC\\srv\\share\\", "\\\\?\\UNC\\srv\\share\\", "\\\\?\\UNC\\srv\\share\\"]),
        ("\\\\.\\pipe\\x", ["\\\\.\\pipe\\x", "\\\\.\\pipe\\x", "\\\\.\\pipe\\x"]),
        ("x:y", ["Absolute", "Absolute", "Absolute"]),
        ("x\\C:\\y", ["BadName", "BadName", "BadName"]),
        (".\\C:\\y", ["BadName", "BadName", "BadName"]),
        ("a\0b", ["BadName", "BadName", "BadName"]),
    ];
    #[rustfmt::skip]
    const JOIN_BELOW: &[(&str, [&str; 3])] = &[
        ("", ["C:\\a\\b", "\\\\srv\\share\\d", "\\\\?\\C:\\a"]),
        ("..\\..\\..", ["Escapes", "Escapes", "Escapes"]),
        ("x/y", ["C:\\a\\b\\x\\y", "\\\\srv\\share\\d\\x\\y", "\\\\?\\C:\\a\\x\\y"]),
        ("x\\..\\y", ["C:\\a\\b\\y", "\\\\srv\\share\\d\\y", "\\\\?\\C:\\a\\y"]),
        ("C:\\", ["Absolute", "Absolute", "Absolute"]),
        ("c:/x/y", ["Absolute", "Absolute", "Absolute"]),
        ("D:\\x", ["Absolute", "Absolute", "Absolute"]),
        ("C:", ["Absolute", "Absolute", "Absolute"]),
        ("C:x", ["Absolute", "Absolute", "Absolute"]),
        ("1:\\x", ["Absolute", "Absolute", "Absolute"]),
        ("\\", ["Absolute", "Absolute", "Absolute"]),
        ("\\x", ["Absolute", "Absolute", "Absolute"]),
        ("/x", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\srv\\share", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\srv\\share\\x\\..\\..", ["Absolute", "Absolute", "Absolute"]),
        ("//srv/share/x", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\srv", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\?\\C:\\x\\..\\..", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\?\\UNC\\srv\\share\\x\\..\\..", ["Absolute", "Absolute", "Absolute"]),
        ("\\\\.\\pipe\\x", ["Absolute", "Absolute", "Absolute"]),
        ("x:y", ["Absolute", "Absolute", "Absolute"]),
        ("x\\C:\\y", ["BadName", "BadName", "BadName"]),
        (".\\C:\\y", ["BadName", "BadName", "BadName"]),
        ("a\0b", ["BadName", "BadName", "BadName"]),
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
        ("C:\\a", "\\\\srv\\share\\a", "Absolute"),
        ("\\\\srv\\share\\a\\b", "\\\\srv\\share\\", "..\\.."),
        ("\\\\srv\\share\\", "\\\\srv\\share\\a\\b", "a\\b"),
        ("\\\\?\\C:\\a", "\\\\?\\C:\\", ".."),
        ("\\\\?\\C:\\a", "C:\\a", "Absolute"),
        ("\\\\?\\UNC\\srv\\share\\a", "\\\\srv\\share\\a", "Absolute"),
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
        ("a", "Relative"),
        ("C:", "Relative"),
        ("\\\\localhost\\C$", "\\\\localhost\\C$\\"),
        ("\\\\?\\UNC\\localhost\\C$", "\\\\?\\UNC\\localhost\\C$\\"),
        ("\\\\?\\C:", "\\\\?\\C:\\"),
    ];

    #[test]
    fn join() {
        for (text, joined) in JOIN {
            for (base, joined) in BASES.iter().zip(joined) {
                let mut mem = Stack::new();
                assert_eq!(
                    raw(at(&mut mem, base).join::<Windows>(text.as_bytes()).get()),
                    *joined,
                    "{base:?} {text:?}"
                );
            }
        }
    }

    #[test]
    fn join_below() {
        for (text, joined) in JOIN_BELOW {
            for (base, joined) in BASES.iter().zip(joined) {
                let mut mem = Stack::new();
                assert_eq!(
                    raw(at(&mut mem, base)
                        .join_below::<Windows>(text.as_bytes())
                        .get()),
                    *joined,
                    "{base:?} {text:?}"
                );
            }
        }
    }

    #[test]
    fn a_view_takes_one_form() {
        for (text, kinds) in VIEWS {
            let units = text.as_bytes();
            let mut taken = String::new();
            taken.extend(AbsPath::new(units).map(|_| 'a'));
            taken.extend(SubPath::new(units).map(|_| 's'));
            taken.extend(Component::new(units).map(|_| 'n'));
            assert_eq!(taken, *kinds, "{text:?}");
        }
    }

    #[test]
    fn the_way_from_one_directory_to_another() {
        for (from, to, way) in RELATIVE {
            let mut mem = Stack::new();
            let (from, to) = (
                AbsPath::new(from.as_bytes()).unwrap(),
                AbsPath::new(to.as_bytes()).unwrap(),
            );
            assert_eq!(
                raw(relative_in(&mut mem, from, to).get()),
                *way,
                "{from:?} {to:?}"
            );
        }
    }

    #[test]
    fn the_long_form() {
        for (path, long) in LONG {
            let mut mem = Stack::new();
            assert_eq!(
                raw(AbsPathBuf::long_in(&mut mem, AbsPath::new(path.as_bytes()).unwrap()).get()),
                *long,
                "{path:?}"
            );
        }
    }

    #[test]
    fn what_the_os_wrote() {
        for (wrote, path) in FROM_THE_OS {
            let mut mem = Stack::new();
            assert_eq!(
                raw(AbsPathBuf::unset_in(&mut mem)
                    .set_os(wrote.as_bytes())
                    .get()),
                *path,
                "{wrote:?}"
            );
            // SAFETY: it initializes what it returns, or all it was given.
            let mut built = unsafe {
                AbsPathBuf::from_os_in(&mut mem, |room: &mut [MaybeUninit<u8>]| {
                    for (unit, from) in room.iter_mut().zip(wrote.as_bytes()) {
                        unit.write(*from);
                    }
                    Ok::<usize, ()>(wrote.len())
                })
            }
            .unwrap();
            assert_eq!(raw(built.get()), *path, "{wrote:?}");
            if built.error().is_none() {
                built
                    .push(component!("x"))
                    .join::<Windows>(b"..\\..\\..\\..\\..");
                assert!(built.get().unwrap().is_root(), "{wrote:?}");
            }
        }
    }

    #[test]
    fn the_letters_of_a_root_match_in_either_case() {
        let path = AbsPath::new(b"c:\\Users\\x").unwrap();
        assert_eq!(
            path.strip_prefix(AbsPath::new(b"C:\\Users").unwrap())
                .unwrap()
                .as_bytes(),
            b"x"
        );
        assert!(
            path.strip_prefix(AbsPath::new(b"C:\\users").unwrap())
                .is_none()
        );
        let share = AbsPath::new(b"\\\\SRV\\Share\\x").unwrap();
        assert_eq!(
            share
                .strip_prefix(AbsPath::new(b"\\\\srv\\share\\").unwrap())
                .unwrap()
                .as_bytes(),
            b"x"
        );
    }
}
