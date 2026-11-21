//! The syntax of each platform. Not exported: other crates get that of the platform they run on.

use core::marker::PhantomData;
use core::ops::Range;

use bun_core::strings;

use crate::PathChar;
use crate::path_unit::PathUnit;

pub struct Style<const WIN32: bool>;
pub(crate) type Posix = Style<false>;
pub(crate) type Windows = Style<true>;
pub(crate) type Host = Style<{ cfg!(windows) }>;

/// The functions of the same names at the root of the crate say what these do.
pub trait PathStyle: Sized {
    /// `\` is a separator too, there are drives, shares and device prefixes, and ASCII case is ignored.
    const WIN32: bool;
    /// The separator to write.
    const SEP: u8 = if Self::WIN32 { b'\\' } else { b'/' };

    #[inline(always)]
    fn is_sep<C: PathChar>(unit: C) -> bool {
        unit.eq_ascii(b'/') || (Self::WIN32 && unit.eq_ascii(b'\\'))
    }

    #[inline(always)]
    fn to_portable_in_place<C: PathChar>(path: &mut [C]) {
        if Self::WIN32 {
            strings::replace_char_in_place(path, b'\\', b'/');
        }
    }

    #[inline(always)]
    fn to_native_in_place<C: PathChar>(path: &mut [C]) {
        if Self::WIN32 {
            strings::replace_char_in_place(path, b'/', b'\\');
        }
    }

    #[inline(always)]
    fn has_leading_sep<C: PathChar>(path: &[C]) -> bool {
        path.first().is_some_and(|&unit| Self::is_sep(unit))
    }

    #[inline(always)]
    fn has_trailing_sep<C: PathChar>(path: &[C]) -> bool {
        path.last().is_some_and(|&unit| Self::is_sep(unit))
    }

    #[inline(always)]
    fn without_leading_sep<C: PathChar>(mut path: &[C]) -> &[C] {
        while Self::has_leading_sep(path) {
            path = &path[1..];
        }
        path
    }

    #[inline(always)]
    fn without_leading_dot_slash<C: PathChar>(path: &[C]) -> &[C] {
        match path {
            [dot, sep, rest @ ..] if dot.eq_ascii(b'.') && Self::is_sep(*sep) => rest,
            _ => path,
        }
    }

    #[inline]
    fn without_trailing_sep<C: PathUnit>(path: &[C]) -> &[C] {
        if !Self::has_trailing_sep(path) {
            return path;
        }
        let root = Root::parse::<Self>(path);
        let min_len = match root.kind {
            VolumeKind::Unc => root.volume_len,
            _ => root.len,
        };
        &path[..len_without_trailing_sep::<Self>(path, min_len)]
    }

    #[inline]
    fn root<C: PathUnit>(path: &[C]) -> &[C] {
        &path[..Root::parse::<Self>(path).len]
    }

    #[inline]
    fn volume<C: PathUnit>(path: &[C]) -> &[C] {
        &path[..Root::parse::<Self>(path).volume_len]
    }

    #[inline]
    fn is_absolute<C: PathUnit>(path: &[C]) -> bool {
        Self::has_leading_sep(path) || (Self::WIN32 && Root::parse::<Self>(path).is_absolute())
    }

    #[inline]
    fn is_fully_qualified<C: PathUnit>(path: &[C]) -> bool {
        Root::parse::<Self>(path).is_fully_qualified::<Self>()
    }

    #[inline]
    fn without_nt_prefix<C: PathUnit>(path: &[C]) -> &[C] {
        if !Self::WIN32 || !Root::parse::<Self>(path).has_nt_prefix(path) {
            return path;
        }
        let inner = Self::without_leading_sep(&path[3..]);
        if Self::is_absolute(inner) {
            inner
        } else {
            path
        }
    }

    #[inline]
    fn dirname<C: PathUnit>(path: &[C]) -> Option<&[C]> {
        let (root, last) = last_component::<Self>(path);
        if last.start > root.len {
            Some(&path[..last.start - 1])
        } else if !last.is_empty() && root.is_absolute() {
            Some(&path[..root.len])
        } else {
            None
        }
    }

    #[inline]
    fn dirname_or_root<C: PathUnit>(path: &[C]) -> &[C] {
        Self::dirname(path).unwrap_or_else(|| Self::root(path))
    }

    #[inline]
    fn basename<C: PathUnit>(path: &[C]) -> &[C] {
        let root = Root::parse::<Self>(path);
        let path = match root.kind {
            VolumeKind::Drive => &path[root.volume_len..],
            _ => path,
        };
        Components::<Self, C>::new(path).next_back().unwrap_or(&[])
    }

    #[inline]
    fn extension<C: PathUnit>(path: &[C]) -> &[C] {
        let basename = Self::basename(path);
        &basename[stem_len(basename)..]
    }

    #[inline]
    fn stem<C: PathUnit>(path: &[C]) -> &[C] {
        let basename = Self::basename(path);
        &basename[..stem_len(basename)]
    }

    #[inline]
    fn strip_prefix<'a, C: PathUnit>(path: &'a [C], dir: &[C]) -> Option<&'a [C]> {
        let root = Root::parse::<Self>(path);
        if dir.is_empty() {
            return (root.len == 0).then_some(path);
        }
        let dir = &dir[..len_without_trailing_sep::<Self>(dir, 0)];
        let (start, rest) = path.split_at_checked(dir.len())?;
        let is_boundary = Self::has_leading_sep(rest) || (rest.is_empty() && !dir.is_empty());
        if is_boundary && dir.len() >= root.volume_len && eq_path::<Self, C>(start, dir) {
            Some(Self::without_leading_sep(rest))
        } else {
            None
        }
    }

    #[inline]
    fn components<C: PathUnit>(path: &[C]) -> Components<'_, Self, C> {
        Components::new(&path[Root::parse::<Self>(path).len..])
    }

    #[inline]
    fn ancestors<C: PathUnit>(path: &[C]) -> impl Iterator<Item = &[C]> {
        let root = Root::parse::<Self>(path);
        let up_to = move |len| &path[..len_without_trailing_sep::<Self>(&path[..len], root.len)];
        let first = (!path.is_empty()).then(|| up_to(path.len()));
        core::iter::successors(first, move |last| {
            match last_index_of_sep::<Self>(&last[root.len..]) {
                Some(sep) => Some(up_to(root.len + sep)),
                None => (last.len() > root.len && root.is_absolute()).then(|| up_to(root.len)),
            }
        })
    }

    fn climbs_out<C: PathUnit>(path: &[C]) -> bool {
        let step = |depth: usize, component: &[C]| match component {
            [dot] if dot.eq_ascii(b'.') => Some(depth),
            _ if component == C::lit(b"..") => depth.checked_sub(1),
            _ => Some(depth + 1),
        };
        !Self::root(path).is_empty() || Self::components(path).try_fold(0, step).is_none()
    }

    fn common_ancestor<'a, C: PathUnit>(
        mut paths: impl Iterator<Item = &'a [C]>,
    ) -> Option<&'a [C]> {
        let first = paths.next()?;
        paths.try_fold(first, |common, path| {
            Self::ancestors(common).find(|dir| Self::strip_prefix(path, dir).is_some())
        })
    }
}

impl<const WIN32: bool> PathStyle for Style<WIN32> {
    const WIN32: bool = WIN32;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum VolumeKind {
    None,
    /// `C:`
    Drive,
    /// `\\server\share`
    Unc,
    /// `\\?\C:`, `\\.\pipe`, `\??\UNC\server\share`
    Device,
}

/// The leading part that `..` cannot climb out of.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Root {
    pub(crate) kind: VolumeKind,
    pub(crate) volume_len: usize,
    /// `volume_len` plus the separator after it, if any.
    pub(crate) len: usize,
}

impl Root {
    #[inline(always)]
    pub(crate) fn parse<S: PathStyle>(path: &[impl PathUnit]) -> Root {
        if S::WIN32 {
            return Root::parse_windows::<S, _>(path);
        }
        Root::without_volume(S::has_leading_sep(path))
    }

    #[inline(always)]
    pub(crate) fn without_volume(is_absolute: bool) -> Root {
        Root {
            kind: VolumeKind::None,
            volume_len: 0,
            len: usize::from(is_absolute),
        }
    }

    #[inline]
    fn parse_windows<S: PathStyle, C: PathUnit>(path: &[C]) -> Root {
        let is_sep = |at: usize| path.get(at).is_some_and(|&unit| S::is_sep(unit));
        let is = |at: usize, ascii: u8| path.get(at).is_some_and(|unit| unit.eq_ascii(ascii));

        if !is_sep(0) {
            let volume_len = C::drive_len(path);
            if volume_len == 0 {
                return Root::without_volume(false);
            }
            return Root {
                kind: VolumeKind::Drive,
                volume_len,
                len: volume_len + usize::from(is_sep(volume_len)),
            };
        }
        if is_sep(1) && path.len() > 2 && !is_sep(2) {
            if (is(2, b'.') || is(2, b'?')) && (path.len() == 3 || is_sep(3)) {
                return Root::parse_unc_or_device::<S, C>(path, VolumeKind::Device, 3);
            }
            return Root::parse_unc_or_device::<S, C>(path, VolumeKind::Unc, 2);
        }
        // `\??\` is only recognized with backslashes.
        if is(0, b'\\') && is(1, b'?') && is(2, b'?') && (path.len() == 3 || is(3, b'\\')) {
            return Root::parse_unc_or_device::<S, C>(path, VolumeKind::Device, 3);
        }
        Root::without_volume(true)
    }

    #[cold]
    fn parse_unc_or_device<S: PathStyle, C: PathUnit>(
        path: &[C],
        kind: VolumeKind,
        prefix_len: usize,
    ) -> Root {
        let mut components = Components::<S, C>::new(&path[prefix_len..]);
        let mut volume_len = prefix_len;
        let mut take_component = || {
            let component = components.next()?;
            volume_len = path.len() - components.rest.len();
            Some(component)
        };
        let first = take_component();
        if kind == VolumeKind::Unc {
            take_component();
        } else if first.is_some_and(|first| eq_ignore_case_and_sep(first, C::lit(b"UNC"))) {
            take_component();
            take_component();
        }
        Root {
            kind,
            volume_len,
            len: volume_len + usize::from(volume_len < path.len()),
        }
    }

    #[inline(always)]
    pub(crate) fn is_absolute(self) -> bool {
        self.len > self.volume_len || matches!(self.kind, VolumeKind::Unc | VolumeKind::Device)
    }

    #[inline(always)]
    pub(crate) fn is_fully_qualified<S: PathStyle>(self) -> bool {
        self.is_absolute() && (!S::WIN32 || self.kind != VolumeKind::None)
    }

    /// `\\?\` or `\??\`, but not `\\.\`.
    #[inline(always)]
    pub(crate) fn has_nt_prefix(self, path: &[impl PathUnit]) -> bool {
        self.kind == VolumeKind::Device && path[2].eq_ascii(b'?')
    }
}

#[inline(always)]
pub(crate) fn len_without_trailing_sep<S: PathStyle>(
    path: &[impl PathChar],
    min_len: usize,
) -> usize {
    let mut len = path.len();
    while len > min_len && S::is_sep(path[len - 1]) {
        len -= 1;
    }
    len
}

#[inline(always)]
pub(crate) fn last_index_of_sep<S: PathStyle>(path: &[impl PathUnit]) -> Option<usize> {
    if S::WIN32 {
        path.iter().rposition(|&unit| S::is_sep(unit))
    } else {
        PathUnit::last_index_of_slash(path)
    }
}

/// The range is empty if `path` has no component after its root.
#[inline(always)]
pub(crate) fn last_component<S: PathStyle>(path: &[impl PathUnit]) -> (Root, Range<usize>) {
    let root = Root::parse::<S>(path);
    let end = len_without_trailing_sep::<S>(path, root.len);
    let sep = last_index_of_sep::<S>(&path[root.len..end]);
    (root, sep.map_or(root.len, |sep| root.len + sep + 1)..end)
}

#[inline]
pub(crate) fn stem_len<C: PathUnit>(basename: &[C]) -> usize {
    match strings::last_index_of_char_t(basename, C::from_u8(b'.')) {
        Some(dot) if dot > 0 && basename != C::lit(b"..") => dot,
        _ => basename.len(),
    }
}

#[inline(always)]
fn fold_case_and_sep<C: PathChar>(unit: C) -> C {
    if unit.eq_ascii(b'\\') {
        C::from_u8(b'/')
    } else {
        unit.to_ascii_upper()
    }
}

pub(crate) fn eq_ignore_case_and_sep<C: PathChar>(a: &[C], b: &[C]) -> bool {
    let eq = |(&a, &b): (&C, &C)| fold_case_and_sep(a) == fold_case_and_sep(b);
    a.len() == b.len() && a.iter().zip(b).all(eq)
}

/// In units, under the style's rules for case and separators.
#[inline]
pub(crate) fn common_path_prefix_len<S: PathStyle, C: PathUnit>(a: &[C], b: &[C]) -> usize {
    let identical = C::common_prefix_length(a, b);
    if !S::WIN32 {
        return identical;
    }
    let eq = |&(&a, &b): &(&C, &C)| fold_case_and_sep(a) == fold_case_and_sep(b);
    let rest = a[identical..].iter().zip(&b[identical..]);
    identical + rest.take_while(eq).count()
}

#[inline]
pub(crate) fn eq_path<S: PathStyle, C: PathUnit>(a: &[C], b: &[C]) -> bool {
    a == b || (S::WIN32 && eq_ignore_case_and_sep(a, b))
}

/// See [`crate::components`].
pub struct Components<'a, S, C> {
    rest: &'a [C],
    style: PhantomData<S>,
}

impl<'a, S, C> Components<'a, S, C> {
    #[inline]
    pub(crate) fn new(path_after_root: &'a [C]) -> Self {
        Self {
            rest: path_after_root,
            style: PhantomData,
        }
    }
}

impl<'a, S: PathStyle, C: PathUnit> Iterator for Components<'a, S, C> {
    type Item = &'a [C];

    #[inline]
    fn next(&mut self) -> Option<&'a [C]> {
        let rest = S::without_leading_sep(self.rest);
        if rest.is_empty() {
            return None;
        }
        let len = rest.iter().position(|&unit| S::is_sep(unit));
        let (component, rest) = rest.split_at(len.unwrap_or(rest.len()));
        self.rest = rest;
        Some(component)
    }
}

impl<'a, S: PathStyle, C: PathUnit> DoubleEndedIterator for Components<'a, S, C> {
    #[inline]
    fn next_back(&mut self) -> Option<&'a [C]> {
        let rest = &self.rest[..len_without_trailing_sep::<S>(self.rest, 0)];
        if rest.is_empty() {
            return None;
        }
        let sep = last_index_of_sep::<S>(rest);
        let (rest, component) = rest.split_at(sep.map_or(0, |sep| sep + 1));
        self.rest = rest;
        Some(component)
    }
}
