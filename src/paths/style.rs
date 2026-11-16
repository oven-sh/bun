//! The grammar of a path: what a separator is, what a root is, and what can be read off a slice with that.

use bun_core::strings;

use crate::platform::{Loose, Posix, Windows};
use crate::{PathChar, PathUnit};

pub(crate) mod sealed {
    pub trait Grammar {
        /// The separator that is written.
        const SEP: u8;
        /// `\` is a separator too, and `X:/` is a root.
        const LOOSE: bool;
        /// `X:a`, `\\server\share`, `\\.\`, `\\?\` and `\??\` mean what they do to Win32, and ASCII has no case.
        const WIN32: bool;
    }
}

impl sealed::Grammar for Posix {
    const SEP: u8 = b'/';
    const LOOSE: bool = false;
    const WIN32: bool = false;
}

impl sealed::Grammar for Windows {
    const SEP: u8 = b'\\';
    const LOOSE: bool = true;
    const WIN32: bool = true;
}

impl sealed::Grammar for Loose {
    const SEP: u8 = b'/';
    const LOOSE: bool = true;
    const WIN32: bool = cfg!(windows);
}

impl<S: sealed::Grammar> Style for S {}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Volume {
    None,
    /// `C:`
    Drive,
    /// `\\server\share`
    Share,
    /// `\\?\C:`, `\\.\pipe`, `\??\UNC\server\share`
    Device,
}

/// What `..` does not leave.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Root {
    pub(crate) volume: Volume,
    pub(crate) volume_len: usize,
    /// `volume_len`, and the separator after it if there is one.
    pub(crate) len: usize,
}

impl Root {
    #[inline(always)]
    pub(crate) fn of<S: Style, C: PathUnit>(path: &[C]) -> Root {
        if S::LOOSE {
            return Root::of_loose::<S, C>(path);
        }
        Root::without_volume(starts_with_sep::<S, C>(path))
    }

    #[inline(always)]
    pub(crate) fn without_volume(is_absolute: bool) -> Root {
        Root {
            volume: Volume::None,
            volume_len: 0,
            len: usize::from(is_absolute),
        }
    }

    #[inline]
    fn of_loose<S: Style, C: PathUnit>(path: &[C]) -> Root {
        let is_sep = |at: usize| path.get(at).is_some_and(|&unit| S::is_sep(unit));
        let is = |at: usize, ascii: u8| path.get(at).is_some_and(|unit| unit.eq_ascii(ascii));

        if !is_sep(0) {
            let volume_len = C::drive_len(path);
            let has_sep = is_sep(volume_len);
            if volume_len == 0 || !(S::WIN32 || has_sep) {
                return Root::without_volume(false);
            }
            return Root {
                volume: Volume::Drive,
                volume_len,
                len: volume_len + usize::from(has_sep),
            };
        }
        if S::WIN32 && is_sep(1) && path.len() > 2 && !is_sep(2) {
            if (is(2, b'.') || is(2, b'?')) && (path.len() == 3 || is_sep(3)) {
                return Root::of_names::<S, C>(path, Volume::Device, 3);
            }
            return Root::of_names::<S, C>(path, Volume::Share, 2);
        }
        // Win32 only knows this one with backslashes.
        if S::SEP == b'\\'
            && is(0, b'\\')
            && is(1, b'?')
            && is(2, b'?')
            && (path.len() == 3 || is(3, b'\\'))
        {
            return Root::of_names::<S, C>(path, Volume::Device, 3);
        }
        Root::without_volume(true)
    }

    #[cold]
    fn of_names<S: Style, C: PathUnit>(path: &[C], volume: Volume, prefix_len: usize) -> Root {
        let mut names = Components::<S, C>::of(&path[prefix_len..]);
        let mut volume_len = prefix_len;
        let mut take = || {
            let name = names.next()?;
            volume_len = path.len() - names.rest.len();
            Some(name)
        };
        let first = take();
        if volume == Volume::Share {
            take();
        } else if first.is_some_and(|name| eq_folded(name, C::lit(b"UNC"))) {
            take();
            take();
        }
        Root {
            volume,
            volume_len,
            len: volume_len + usize::from(volume_len < path.len()),
        }
    }

    #[inline(always)]
    pub(crate) fn is_absolute(self) -> bool {
        self.len > self.volume_len || matches!(self.volume, Volume::Share | Volume::Device)
    }

    /// Not `\a`, which is on the drive of the working directory.
    #[inline(always)]
    pub(crate) fn is_fully_qualified<S: Style>(self) -> bool {
        self.is_absolute() && (!S::WIN32 || self.volume != Volume::None)
    }
}

#[inline(always)]
pub(crate) fn starts_with_sep<S: Style, C: PathChar>(path: &[C]) -> bool {
    path.first().is_some_and(|&unit| S::is_sep(unit))
}

#[inline(always)]
pub(crate) fn ends_with_sep<S: Style, C: PathChar>(path: &[C]) -> bool {
    path.last().is_some_and(|&unit| S::is_sep(unit))
}

#[inline(always)]
pub(crate) fn without_leading_seps<S: Style, C: PathChar>(mut path: &[C]) -> &[C] {
    while starts_with_sep::<S, C>(path) {
        path = &path[1..];
    }
    path
}

/// The length of `path` without the separators at its end, but no less than `least`.
#[inline(always)]
pub(crate) fn len_without_seps<S: Style, C: PathChar>(path: &[C], least: usize) -> usize {
    let mut len = path.len();
    while len > least && S::is_sep(path[len - 1]) {
        len -= 1;
    }
    len
}

#[inline(always)]
fn last_index_of_sep<S: Style, C: PathUnit>(path: &[C]) -> Option<usize> {
    if S::LOOSE {
        path.iter().rposition(|&unit| S::is_sep(unit))
    } else {
        C::last_index_of_slash(path)
    }
}

#[inline(always)]
fn folded<C: PathChar>(unit: C) -> C {
    if unit.eq_ascii(b'\\') {
        C::from_u8(b'/')
    } else {
        unit.to_ascii_upper()
    }
}

/// Equal to Win32.
pub(crate) fn eq_folded<C: PathChar>(a: &[C], b: &[C]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(&a, &b)| folded(a) == folded(b))
}

/// How many units `a` and `b` start with in common.
#[inline]
pub(crate) fn common_len<S: Style, C: PathUnit>(a: &[C], b: &[C]) -> usize {
    let same = C::common_prefix_length(a, b);
    if !S::LOOSE {
        return same;
    }
    let is_same = |a: C, b: C| match S::WIN32 {
        true => folded(a) == folded(b),
        false => a == b || (S::is_sep(a) && S::is_sep(b)),
    };
    let rest = a[same..].iter().zip(&b[same..]);
    same + rest.take_while(|&(&a, &b)| is_same(a, b)).count()
}

#[inline]
pub(crate) fn is_same<S: Style, C: PathUnit>(a: &[C], b: &[C]) -> bool {
    a == b || (S::LOOSE && a.len() == b.len() && common_len::<S, C>(a, b) == a.len())
}

/// The root of `path`, and where its last name starts and ends.
#[inline(always)]
pub(crate) fn last_name<S: Style, C: PathUnit>(path: &[C]) -> (Root, usize, usize) {
    let root = Root::of::<S, C>(path);
    let end = len_without_seps::<S, C>(path, root.len);
    let sep = last_index_of_sep::<S, C>(&path[root.len..end]);
    (root, sep.map_or(root.len, |sep| root.len + sep + 1), end)
}

/// Implemented by the types of [`platform`](crate::platform). Nothing here looks at the file system or resolves a `..`.
pub trait Style: sealed::Grammar + Sized {
    #[inline(always)]
    fn is_sep<C: PathChar>(unit: C) -> bool {
        unit.eq_ascii(b'/') || (Self::LOOSE && unit.eq_ascii(b'\\'))
    }

    /// `/`, `C:\`, `C:`, `\\server\share\`, `\\?\C:\`, or nothing.
    #[inline]
    fn root<C: PathUnit>(path: &[C]) -> &[C] {
        &path[..Root::of::<Self, C>(path).len]
    }

    #[inline]
    fn is_absolute<C: PathUnit>(path: &[C]) -> bool {
        Root::of::<Self, C>(path).is_absolute()
    }

    /// `None` for a root and for a single name.
    #[inline]
    fn dirname<C: PathUnit>(path: &[C]) -> Option<&[C]> {
        let (root, start, end) = last_name::<Self, C>(path);
        if start > root.len {
            Some(&path[..start - 1])
        } else {
            (end > start && root.is_absolute()).then(|| &path[..root.len])
        }
    }

    /// Empty for `/` and `C:\`. As in Node, that of `\\server\share` is `share`.
    #[inline]
    fn basename<C: PathUnit>(path: &[C]) -> &[C] {
        let root = Root::of::<Self, C>(path);
        let path = match root.volume {
            Volume::Drive => &path[root.volume_len..],
            _ => path,
        };
        Components::<Self, C>::of(path).next_back().unwrap_or(&[])
    }

    /// With the dot. `.gitignore` and `..` have none.
    #[inline]
    fn extension<C: PathUnit>(path: &[C]) -> &[C] {
        let name = Self::basename(path);
        &name[stem_len(name)..]
    }

    /// The basename without the extension.
    #[inline]
    fn stem<C: PathUnit>(path: &[C]) -> &[C] {
        let name = Self::basename(path);
        &name[..stem_len(name)]
    }

    /// A root keeps its separator.
    #[inline]
    fn without_trailing_sep<C: PathUnit>(path: &[C]) -> &[C] {
        if !ends_with_sep::<Self, C>(path) {
            return path;
        }
        &path[..len_without_seps::<Self, C>(path, Root::of::<Self, C>(path).len)]
    }

    /// What follows `dir` and the separator after it: empty if `path` is `dir`, `None` if it is not below it.
    #[inline]
    fn strip_dir<'a, C: PathUnit>(path: &'a [C], dir: &[C]) -> Option<&'a [C]> {
        let root = Root::of::<Self, C>(path);
        if dir.is_empty() {
            return (root.len == 0).then_some(path);
        }
        let dir = &dir[..len_without_seps::<Self, C>(dir, 0)];
        let (start, rest) = path.split_at_checked(dir.len())?;
        let is_boundary = starts_with_sep::<Self, C>(rest) || (rest.is_empty() && !dir.is_empty());
        (is_boundary && dir.len() >= root.volume_len && is_same::<Self, C>(start, dir))
            .then(|| without_leading_seps::<Self, C>(rest))
    }

    /// The names after the root, `.` and `..` among them.
    #[inline]
    fn components<C: PathUnit>(path: &[C]) -> Components<'_, Self, C> {
        Components::of(&path[Root::of::<Self, C>(path).len..])
    }

    /// `path`, its parent and so on, up to the root or the first name. Only the root ends with a separator.
    #[inline]
    fn ancestors<C: PathUnit>(path: &[C]) -> impl Iterator<Item = &[C]> {
        let root = Root::of::<Self, C>(path);
        let up_to = move |len| &path[..len_without_seps::<Self, C>(&path[..len], root.len)];
        let first = (!path.is_empty()).then(|| up_to(path.len()));
        core::iter::successors(first, move |last| {
            match last_index_of_sep::<Self, C>(&last[root.len..]) {
                Some(sep) => Some(up_to(root.len + sep)),
                None => (last.len() > root.len && root.is_absolute()).then(|| up_to(root.len)),
            }
        })
    }
}

#[inline]
pub(crate) fn stem_len<C: PathUnit>(name: &[C]) -> usize {
    match strings::last_index_of_char_t(name, C::from_u8(b'.')) {
        Some(dot) if dot > 0 && name != C::lit(b"..") => dot,
        _ => name.len(),
    }
}

/// See [`Style::components`].
pub struct Components<'a, S, C> {
    rest: &'a [C],
    style: core::marker::PhantomData<S>,
}

impl<'a, S, C> Components<'a, S, C> {
    #[inline]
    pub(crate) fn of(names: &'a [C]) -> Self {
        Self {
            rest: names,
            style: core::marker::PhantomData,
        }
    }
}

impl<'a, S: Style, C: PathUnit> Iterator for Components<'a, S, C> {
    type Item = &'a [C];

    #[inline]
    fn next(&mut self) -> Option<&'a [C]> {
        let rest = without_leading_seps::<S, C>(self.rest);
        if rest.is_empty() {
            return None;
        }
        let len = rest.iter().position(|&unit| S::is_sep(unit));
        let (name, rest) = rest.split_at(len.unwrap_or(rest.len()));
        self.rest = rest;
        Some(name)
    }
}

impl<'a, S: Style, C: PathUnit> DoubleEndedIterator for Components<'a, S, C> {
    #[inline]
    fn next_back(&mut self) -> Option<&'a [C]> {
        let rest = &self.rest[..len_without_seps::<S, C>(self.rest, 0)];
        if rest.is_empty() {
            return None;
        }
        let sep = last_index_of_sep::<S, C>(rest);
        let (rest, name) = rest.split_at(sep.map_or(0, |sep| sep + 1));
        self.rest = rest;
        Some(name)
    }
}
