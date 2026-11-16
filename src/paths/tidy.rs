//! The algorithms of [`PathIn`](crate::PathIn). They are compiled per unit and style, whatever the backend.

use core::mem::MaybeUninit;

use crate::platform::{Loose, Posix};
use crate::resolve_path::{slashes_to_posix_in_place, slashes_to_windows_in_place};
use crate::style::{
    Components, Root, Volume, common_len, ends_with_sep, eq_folded, is_same, len_without_seps,
    starts_with_sep, without_leading_seps,
};
use crate::{PathUnit, Style};

/// How much longer than its parts and the separators between them a result can get: `/??/C:` is `\.\??\C:`.
pub(crate) const SLACK: usize = 2;

/// The storage of a path while it is edited. Whoever made it has reserved what the edit needs.
pub(crate) struct Units<'a, U> {
    all: &'a mut [MaybeUninit<U>],
    len: usize,
}

impl<'a, U: PathUnit> Units<'a, U> {
    /// SAFETY: `all[..len]` is initialized.
    #[inline(always)]
    pub(crate) unsafe fn new(all: &'a mut [MaybeUninit<U>], len: usize) -> Self {
        Self { all, len }
    }

    /// Writes the NUL and returns the length without it.
    #[inline(always)]
    pub(crate) fn finish(self) -> usize {
        self.all[self.len].write(*U::NUL);
        self.len
    }

    #[inline(always)]
    pub(crate) fn len(&self) -> usize {
        self.len
    }

    #[inline(always)]
    pub(crate) fn as_slice(&self) -> &[U] {
        // SAFETY: `len` only grows over what has been written, which is in `all`.
        unsafe { self.all.get_unchecked(..self.len).assume_init_ref() }
    }

    #[inline(always)]
    pub(crate) fn as_mut_slice(&mut self) -> &mut [U] {
        // SAFETY: as above.
        unsafe { self.all.get_unchecked_mut(..self.len).assume_init_mut() }
    }

    #[inline(always)]
    pub(crate) fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }

    #[inline(always)]
    pub(crate) fn push(&mut self, ascii: u8) {
        self.all[self.len].write(U::from_u8(ascii));
        self.len += 1;
    }

    #[inline(always)]
    pub(crate) fn extend<C: PathUnit>(&mut self, units: &[C]) {
        self.len += U::write(units, &mut self.all[self.len..]);
    }

    /// For what has been added from `start` on, which begins with an absolute path of `absolute_len`.
    #[inline(always)]
    fn make_portable(&mut self, start: usize, absolute_len: usize) {
        let added = &mut self.as_mut_slice()[start..];
        if U::index_of_unit(added, U::from_u8(b'\\')).is_some() {
            let (absolute, relative) = added.split_at_mut(absolute_len);
            split_unknown_names(absolute);
            slashes_to_posix_in_place(relative);
        }
    }

    /// `edit` gets the path, and appends to it by way of a path of its own.
    #[inline(always)]
    fn extend_with<R>(&mut self, edit: impl FnOnce(&[U], &mut Units<'_, U>) -> R) -> R {
        let (path, all) = self.all.split_at_mut(self.len);
        let mut appended = Units { all, len: 0 };
        // SAFETY: as for `as_slice`.
        let result = edit(unsafe { path.assume_init_ref() }, &mut appended);
        self.len += appended.len;
        result
    }

    /// Replaces the first `len` units by `ups` times `../`.
    #[inline]
    fn start_with_ups(&mut self, len: usize, ups: usize) {
        let kept = self.as_slice()[len..].len();
        self.all.copy_within(len..self.len, 3 * ups);
        self.len = 0;
        for _ in 0..ups {
            b"../".iter().for_each(|&ascii| self.push(ascii));
        }
        self.len += kept;
    }

    /// Replaces `len` units from `at` on.
    #[inline]
    pub(crate) fn splice(&mut self, at: usize, len: usize, with: &[U]) {
        let after = &self.as_slice()[at..][len..];
        let new_len = at + with.len() + after.len();
        self.all.copy_within(at + len..self.len, at + with.len());
        self.all[at..][..with.len()].write_copy_of_slice(with);
        self.len = new_len;
    }
}

#[inline(always)]
pub(crate) fn room_for_parts<U: PathUnit, C: PathUnit>(parts: &[&[C]]) -> usize {
    parts.iter().map(|part| 1 + U::room_for(part)).sum()
}

#[inline(always)]
fn write_seps<S: Style, U: PathUnit>(units: &mut [U]) {
    if S::SEP == b'\\' {
        slashes_to_windows_in_place(units);
    } else if S::LOOSE {
        slashes_to_posix_in_place(units);
    }
}

#[inline(always)]
fn end_with_sep<S: Style, U: PathUnit>(units: &mut Units<'_, U>) {
    if units.len() > 0 && !ends_with_sep::<S, U>(units.as_slice()) {
        units.push(S::SEP);
    }
}

/// `before` is the root that the path had. Dropping names must not make a volume of the next one, as in `a\..\C:\b`.
#[inline(always)]
fn keep_root<S: Style, U: PathUnit>(units: &mut Units<'_, U>, before: Root) {
    if S::LOOSE
        && before.volume == Volume::None
        && Root::of::<S, U>(units.as_slice()).volume != Volume::None
    {
        core::hint::cold_path();
        units.splice(before.len, 0, &[U::from_u8(b'.'), U::from_u8(S::SEP)]);
    }
}

#[inline(always)]
fn without_leading_dots<S: Style, C: PathUnit>(mut names: &[C]) -> &[C] {
    loop {
        names = without_leading_seps::<S, C>(names);
        match names {
            [dot] if dot.eq_ascii(b'.') => return &[],
            [dot, sep, rest @ ..] if dot.eq_ascii(b'.') && S::is_sep(*sep) => names = rest,
            _ => return names,
        }
    }
}

/// What `push` keeps of `part`.
#[inline(always)]
fn pushed_range<S: Style, C: PathUnit>(part: &[C], is_first: bool) -> (usize, usize) {
    match part {
        [first, second, .., last]
            if !S::is_sep(*first) && !S::is_sep(*second) && !S::is_sep(*last) =>
        {
            (0, part.len())
        }
        _ => trimmed_range::<S, C>(part, is_first),
    }
}

#[inline(never)]
fn trimmed_range<S: Style, C: PathUnit>(part: &[C], is_first: bool) -> (usize, usize) {
    let root_len = if is_first {
        Root::of::<S, C>(part).len
    } else {
        0
    };
    let end = len_without_seps::<S, C>(part, root_len);
    if root_len > 0 {
        return (0, end);
    }
    let names = without_leading_dots::<S, C>(&part[..end]);
    if is_first && names.is_empty() {
        return (0, end.min(1));
    }
    (end - names.len(), end)
}

/// For [`keep_root`], if `part` can make a volume by itself.
#[inline(always)]
fn root_before_push<S: Style, U: PathUnit, C: PathUnit>(path: &[U], part: &[C]) -> Option<Root> {
    match path {
        _ if !S::LOOSE => None,
        [] => Some(Root::of::<S, C>(part)),
        [only] if S::is_sep(*only) => Some(Root::without_volume(true)),
        _ => None,
    }
}

/// `part`, less what `push` drops.
pub(crate) struct Pushed<'a, C> {
    names: &'a [C],
    needs_sep: bool,
    root: Option<Root>,
}

impl<'a, C: PathUnit> Pushed<'a, C> {
    #[inline(always)]
    pub(crate) fn new<S: Style, U: PathUnit>(path: &[U], part: &'a [C]) -> Self {
        let (start, end) = pushed_range::<S, C>(part, path.is_empty());
        Self {
            names: &part[start..end],
            needs_sep: start < end && !path.is_empty() && !ends_with_sep::<S, U>(path),
            root: root_before_push::<S, U, C>(path, part),
        }
    }

    /// For what takes the place of the `a` in `C:a`.
    #[inline(always)]
    pub(crate) fn without_sep(self) -> Self {
        Self {
            needs_sep: false,
            ..self
        }
    }

    #[inline(always)]
    pub(crate) fn room<U: PathUnit>(&self) -> usize {
        usize::from(self.needs_sep)
            + U::room_for(self.names)
            + if self.root.is_some() { SLACK } else { 0 }
    }

    #[inline(always)]
    pub(crate) fn write<S: Style, U: PathUnit>(&self, units: &mut Units<'_, U>) {
        if self.needs_sep {
            units.push(S::SEP);
        }
        let start = units.len();
        units.extend(self.names);
        write_seps::<S, U>(&mut units.as_mut_slice()[start..]);
        if let Some(root) = self.root {
            keep_root::<S, U>(units, root);
        }
    }
}

/// Makes a `push` of what has been appended from `start` on to the path that was `len` long and got a separator.
#[inline]
pub(crate) fn push_appended<S: Style, U: PathUnit>(
    units: &mut Units<'_, U>,
    len: usize,
    start: usize,
) {
    let (path, part) = units.as_slice().split_at(start);
    let root = root_before_push::<S, U, U>(&path[..len], part);
    let (kept_start, kept_end) = pushed_range::<S, U>(part, len == 0);
    if kept_start == kept_end {
        return units.truncate(len);
    }
    units.truncate(start + kept_end);
    if kept_start > 0 {
        units.splice(start, kept_start, &[]);
    }
    write_seps::<S, U>(&mut units.as_mut_slice()[start..]);
    if let Some(root) = root {
        keep_root::<S, U>(units, root);
    }
}

#[inline(never)]
pub(crate) fn push_portable<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    part: &[C],
) {
    let len = units.len();
    end_with_sep::<S, U>(units);
    let start = units.len();
    let is_absolute = len == 0 && S::is_absolute(part);
    units.extend(match without_leading_seps::<Loose, C>(part) {
        _ if is_absolute => part,
        [] if !part.is_empty() => C::lit(b"."),
        names => names,
    });
    units.make_portable(start, if is_absolute { units.len() } else { 0 });
    push_appended::<S, U>(units, len, start);
}

/// What [`PathIn::resolve_portable`](crate::PathIn::resolve_portable) does to each `\` of an absolute POSIX path. None is left on Windows.
#[cold]
#[inline(never)]
pub fn split_unknown_names<U: PathUnit>(absolute: &mut [U]) {
    let backslash = U::from_u8(b'\\');
    let has_backslash = |units: &[U]| U::index_of_unit(units, backslash).is_some();
    U::with_known_dirs(|dirs| {
        if !dirs.iter().any(|dir| has_backslash(dir)) {
            return slashes_to_posix_in_place(absolute);
        }
        for name in absolute.split_mut(|unit| unit.eq_ascii(b'/')) {
            if !has_backslash(name) {
                continue;
            }
            let starts_name = |known: &&[U]| {
                let rest = name.strip_prefix(*known);
                rest.is_some_and(|rest| rest.first().is_none_or(|&unit| unit == backslash))
            };
            let known = dirs.iter().flat_map(|dir| Posix::components(dir));
            let kept = known.filter(starts_name).map(<[U]>::len).max();
            slashes_to_posix_in_place(&mut name[kept.unwrap_or(0)..]);
        }
    });
}

/// What is in front of the first name.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Above {
    Root,
    Unknown,
}

/// Moves the names from `read` on to `start`, less `.`, `..` and the empty ones. Returns where they end.
#[inline(never)]
fn tidy_names<U: PathUnit>(path: &mut [U], mut read: usize, start: usize, above: Above) -> usize {
    let (slash, dot) = (U::from_u8(b'/'), U::from_u8(b'.'));
    let end = len_without_seps::<Posix, U>(path, read);
    let path = &mut path[..end];
    let mut write = start;
    // Where the `..` end that have nothing to cancel.
    let mut floor = write;
    while read < end {
        if path[read] == slash {
            read += 1;
            continue;
        }
        if path[read] == dot {
            if read + 1 == end || path[read + 1] == slash {
                read += 2;
                continue;
            }
            if path[read + 1] == dot && (read + 2 == end || path[read + 2] == slash) {
                read += 3;
                if write > floor {
                    write = floor + U::last_index_of_slash(&path[floor..write]).unwrap_or(0);
                } else if above == Above::Unknown {
                    if write > start {
                        path[write] = slash;
                        write += 1;
                    }
                    path[write..write + 2].fill(dot);
                    write += 2;
                    floor = write;
                }
                continue;
            }
        }
        let names = &path[read..];
        let len = U::index_of_untidy_slash(names).unwrap_or(names.len());
        if write > start {
            path[write] = slash;
            write += 1;
        }
        if write != read {
            path.copy_within(read..read + len, write);
        }
        write += len;
        read += len + 1;
    }
    write
}

/// A root and names, with `/` between them and not after them.
#[derive(Clone, Copy)]
struct Tidied {
    root: Root,
    had_trailing_sep: bool,
}

#[inline(always)]
fn tidy<S: Style, U: PathUnit>(units: &mut Units<'_, U>, mut root: Root) -> Tidied {
    let path = units.as_mut_slice();
    let names_start = root.len;
    let had_trailing_sep = path.len() > names_start && ends_with_sep::<S, U>(path);
    if S::LOOSE {
        slashes_to_posix_in_place(path);
        match root.volume {
            Volume::Drive if S::WIN32 => path[0] = path[0].to_ascii_upper(),
            Volume::None | Volume::Drive => {}
            Volume::Share | Volume::Device => root = tidy_volume(path, root),
        }
    }
    let above = match root.is_absolute() {
        true => Above::Root,
        false => Above::Unknown,
    };
    let len = tidy_names(path, names_start, root.len, above);
    units.truncate(len);
    Tidied {
        root,
        had_trailing_sep,
    }
}

#[cold]
fn tidy_volume<U: PathUnit>(path: &mut [U], root: Root) -> Root {
    const START: usize = br"\\?".len();
    let mut write = START;
    for read in START..root.len {
        if !(path[read].eq_ascii(b'/') && path[write - 1].eq_ascii(b'/')) {
            path[write] = path[read];
            write += 1;
        }
    }
    Root {
        volume_len: write - (root.len - root.volume_len),
        len: write,
        ..root
    }
}

#[inline(always)]
fn finish<S: Style, U: PathUnit>(units: &mut Units<'_, U>, tidied: Tidied) {
    let root = tidied.root;
    let has_names = units.len() > root.len;
    if !has_names && !root.is_absolute() {
        units.push(b'.');
    }
    let needs_sep = match units.len() > root.len {
        true => tidied.had_trailing_sep,
        false => root.volume == Volume::Share && root.len == root.volume_len,
    };
    if needs_sep {
        units.push(b'/');
    }
    if S::SEP == b'\\' {
        slashes_to_windows_in_place(units.as_mut_slice());
    }
    keep_root::<S, U>(units, root);
}

#[inline(always)]
fn normalize_below<S: Style, U: PathUnit>(units: &mut Units<'_, U>, root: Root) {
    let tidied = tidy::<S, U>(units, root);
    finish::<S, U>(units, tidied);
}

#[inline(always)]
pub(crate) fn normalize<S: Style, U: PathUnit>(units: &mut Units<'_, U>) {
    join::<S, U, U>(units, &[]);
}

/// A `./` that is not copied leaves less to move for [`tidy_names`]. After `\\server` it is the name of the share.
#[inline(always)]
fn add_part<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    part: &[C],
    volume: Volume,
) {
    end_with_sep::<S, U>(units);
    units.extend(match part {
        [dot, sep, rest @ ..]
            if dot.eq_ascii(b'.')
                && S::is_sep(*sep)
                && matches!(volume, Volume::None | Volume::Drive) =>
        {
            rest
        }
        _ => part,
    });
}

/// Returns the root of the result. The parts after the first can complete a volume, but cannot start one.
#[inline(always)]
fn concat<S: Style, U: PathUnit, C: PathUnit>(units: &mut Units<'_, U>, parts: &[&[C]]) -> Root {
    let mut parts = parts.iter().filter(|part| !part.is_empty());
    if units.len() == 0
        && let Some(first) = parts.next()
    {
        units.extend(first);
    }
    let root = Root::of::<S, U>(units.as_slice());
    for part in parts {
        add_part::<S, U, C>(units, part, root.volume);
    }
    match root.volume {
        Volume::None => root,
        _ => Root::of::<S, U>(units.as_slice()),
    }
}

#[inline(never)]
pub(crate) fn join<S: Style, U: PathUnit, C: PathUnit>(units: &mut Units<'_, U>, parts: &[&[C]]) {
    let root = concat::<S, U, C>(units, parts);
    normalize_below::<S, U>(units, root);
}

/// One of `units` and `absolute` is empty.
#[inline(never)]
pub(crate) fn join_portable<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    absolute: &[C],
    parts: &[&[C]],
) {
    let start = units.len();
    units.extend(absolute);
    let absolute_len = units.len() - start;
    let root = concat::<S, U, C>(units, parts);
    units.make_portable(start, absolute_len);
    normalize_below::<S, U>(units, root);
    let last = parts.iter().rfind(|part| !part.is_empty());
    trim_foreign_sep::<S, U, C>(units, last.unwrap_or(&absolute));
}

/// A separator at the end of what has been written only counts if it is the one of `S`.
#[inline(always)]
fn trim_foreign_sep<S: Style, U: PathUnit, C: PathUnit>(units: &mut Units<'_, U>, last: &[C]) {
    if ends_with_sep::<Loose, C>(last) && !last[last.len() - 1].eq_ascii(S::SEP) {
        units.truncate(S::without_trailing_sep(units.as_slice()).len());
    }
}

/// The index of the last part that makes everything in front of it irrelevant.
#[inline(always)]
pub(crate) fn last_fully_qualified<S: Style, C: PathUnit>(parts: &[&[C]]) -> Option<usize> {
    if S::LOOSE {
        return None;
    }
    parts.iter().rposition(|part| S::is_absolute(part))
}

/// [`concat`] for `resolve`, after [`last_fully_qualified`] has been applied.
#[inline(always)]
fn concat_resolving<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    parts: &[&[C]],
) -> Root {
    if !S::LOOSE {
        return concat::<S, U, C>(units, parts);
    }
    let first = match units.len() {
        0 => parts.iter().position(|part| !part.is_empty()),
        _ => None,
    };

    let own = Root::of::<S, U>(units.as_slice());
    let mut kind = own.volume;
    let mut volume: &[C] = &[];
    let mut start = None;
    let mut is_absolute = false;
    for (index, part) in parts.iter().enumerate().rev() {
        let root = Root::of::<S, C>(part);
        let is_base = root.is_absolute() || (first == Some(index) && is_bare_drive(root, part));
        is_absolute |= is_base;
        if root.volume != Volume::None {
            if volume.is_empty() {
                (kind, volume) = (root.volume, &part[..root.volume_len]);
            } else if !eq_folded(volume, &part[..root.volume_len]) {
                continue;
            }
        }
        if is_base && start.is_none() {
            start = Some(index);
        }
        if start.is_some() && !volume.is_empty() {
            break;
        }
    }

    is_absolute |= own.is_absolute() || is_bare_drive(own, units.as_slice());
    let mut volume_len = own.volume_len;
    if volume.is_empty() {
        if start.is_some() {
            units.truncate(own.volume_len);
        }
    } else {
        if start.is_some() {
            units.truncate(0);
        }
        let len = units.len();
        units.extend(volume);
        let path = units.as_mut_slice();
        volume_len = path.len() - len;
        if len == 0 || own.volume_len == 0 {
            path.rotate_left(len);
        } else if eq_folded(&path[..own.volume_len], &path[len..]) {
            units.truncate(len);
        } else {
            path.copy_within(len.., 0);
            units.truncate(volume_len);
        }
    }

    if kind == Volume::Drive
        && is_absolute
        && !starts_with_sep::<S, U>(&units.as_slice()[volume_len..])
    {
        units.splice(volume_len, 0, &[U::from_u8(S::SEP)]);
    }
    for part in &parts[start.unwrap_or(0)..] {
        let (its_volume, names) = part.split_at(Root::of::<S, C>(part).volume_len);
        if names.is_empty() || !(its_volume.is_empty() || eq_folded(volume, its_volume)) {
            continue;
        }
        if units.len() == 0 || (kind == Volume::Drive && units.len() == volume_len) {
            units.extend(names);
        } else {
            add_part::<S, U, C>(units, names, kind);
        }
    }
    match kind {
        Volume::None => Root::without_volume(is_absolute),
        _ => Root::of::<S, U>(units.as_slice()),
    }
}

/// `C:` is what is left of `C:\` without its separator far more often than it means a working directory.
#[inline(always)]
fn is_bare_drive<C>(root: Root, path: &[C]) -> bool {
    root.volume == Volume::Drive && root.volume_len == path.len()
}

#[inline(always)]
pub(crate) fn resolve<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    parts: &[&[C]],
) {
    if S::LOOSE {
        resolve_loose::<S, U, C>(units, parts);
    } else {
        join::<S, U, C>(units, parts);
    }
}

#[inline(always)]
pub(crate) fn resolve_portable<S: Style, U: PathUnit, C: PathUnit>(
    units: &mut Units<'_, U>,
    parts: &[&[C]],
) {
    match parts {
        _ if S::LOOSE => {
            resolve_loose::<S, U, C>(units, parts);
            let last = parts.iter().rfind(|part| !part.is_empty());
            trim_foreign_sep::<S, U, C>(units, last.copied().unwrap_or_default());
        }
        [first, rest @ ..] if S::is_absolute(first) => join_portable::<S, U, C>(units, first, rest),
        _ => join_portable::<S, U, C>(units, &[], parts),
    }
}

#[inline(never)]
fn resolve_loose<S: Style, U: PathUnit, C: PathUnit>(units: &mut Units<'_, U>, parts: &[&[C]]) {
    let root = concat_resolving::<S, U, C>(units, parts);
    normalize_below::<S, U>(units, root);
}

/// An operand of `relative`.
#[derive(Clone, Copy)]
pub(crate) struct Resolved<'a, U> {
    path: &'a [U],
    root: Root,
}

impl<'a, U: PathUnit> Resolved<'a, U> {
    /// `None` if `path` is [`Unresolved`].
    #[inline(always)]
    pub(crate) fn as_is<S: Style, const PORTABLE: bool>(path: &'a [U]) -> Option<Self> {
        let is_tidy = !S::WIN32
            && path.first()?.eq_ascii(b'/')
            && !((S::LOOSE || PORTABLE) && U::index_of_unit(path, U::from_u8(b'\\')).is_some())
            && U::index_of_untidy_slash(path).is_none();
        is_tidy.then(|| Self {
            path: S::without_trailing_sep(path),
            root: Root::without_volume(true),
        })
    }

    #[inline(always)]
    fn volume(&self) -> &[U] {
        &self.path[..self.root.volume_len]
    }
}

/// An operand of `relative` that has to be copied, and what it is relative to.
#[derive(Clone, Copy)]
pub(crate) struct Unresolved<'a, U> {
    base: &'static [u8],
    path: &'a [U],
}

impl<'a, U: PathUnit> Unresolved<'a, U> {
    #[inline(always)]
    pub(crate) fn new<S: Style>(path: &'a [U]) -> Self {
        let base = match Root::of::<S, U>(path).is_fully_qualified::<S>() {
            true => b"",
            false => crate::fs::top_level_dir(),
        };
        Self { base, path }
    }

    #[inline(always)]
    fn room(self) -> usize {
        U::room_for(self.base) + 1 + self.path.len() + SLACK
    }

    /// `units` is empty.
    #[inline(never)]
    fn write<S: Style, const PORTABLE: bool>(self, units: &mut Units<'_, U>) -> Root {
        units.extend(self.base);
        let absolute_len = match self.base {
            [] => self.path.len(),
            _ => units.len(),
        };
        let concatenated = concat_resolving::<S, U, U>(units, &[self.path]);
        if PORTABLE {
            units.make_portable(0, absolute_len);
        }
        tidy::<S, U>(units, concatenated).root
    }
}

/// Every two units of `from` can become three.
#[inline(always)]
pub(crate) fn room_for_relative<U: PathUnit>(
    from: Unresolved<'_, U>,
    to: Unresolved<'_, U>,
) -> usize {
    3 * from.room().div_ceil(2) + to.room() + SLACK
}

/// The operands are resolved where the result is going to be.
#[inline(never)]
pub(crate) fn relative<S: Style, U: PathUnit, const PORTABLE: bool>(
    units: &mut Units<'_, U>,
    from: Unresolved<'_, U>,
    to: Unresolved<'_, U>,
) {
    units.truncate(0);
    let from_root = from.write::<S, PORTABLE>(units);
    let (ups, rest_len, root) = units.extend_with(|from, units| {
        let to_root = to.write::<S, PORTABLE>(units);
        let relative = Relative::new::<S>(
            Resolved {
                path: from,
                root: from_root,
            },
            Resolved {
                path: units.as_slice(),
                root: to_root,
            },
        );
        (relative.ups, relative.rest.len(), relative.root)
    });
    units.start_with_ups(units.len() - rest_len, ups);
    if rest_len == 0 {
        units.truncate(units.len().saturating_sub(1));
    } else if PORTABLE {
        slashes_to_posix_in_place(units.as_mut_slice());
        tidy::<S, U>(units, root);
    }
    if units.len() > 0 {
        let tidied = Tidied {
            root,
            had_trailing_sep: false,
        };
        finish::<S, U>(units, tidied);
    }
}

/// `..` for `ups` times, then `rest`.
pub(crate) struct Relative<'a, U> {
    ups: usize,
    rest: &'a [U],
    root: Root,
}

impl<'a, U: PathUnit> Relative<'a, U> {
    #[inline]
    pub(crate) fn new<S: Style>(from: Resolved<'_, U>, to: Resolved<'a, U>) -> Self {
        if from.root.is_absolute() != to.root.is_absolute()
            || (S::LOOSE && !is_same::<S, U>(from.volume(), to.volume()))
        {
            return Self {
                ups: 0,
                rest: to.path,
                root: to.root,
            };
        }
        let (from, to) = (&from.path[from.root.len..], &to.path[to.root.len..]);
        let ends_name = |path: &[U], at: usize| path.get(at).is_none_or(|it| it.eq_ascii(b'/'));
        let mut common = common_len::<S, U>(from, to);
        if !(ends_name(from, common) && ends_name(to, common)) {
            common = U::last_index_of_slash(&from[..common]).unwrap_or(0);
        }
        let left = without_leading_seps::<S, U>(&from[common..]);
        Self {
            ups: match left {
                [] => 0,
                _ => 1 + U::count_slashes(left),
            },
            rest: without_leading_seps::<S, U>(&to[common..]),
            root: Root::without_volume(false),
        }
    }

    #[inline(always)]
    pub(crate) fn room<S: Style>(&self) -> usize {
        3 * self.ups + self.rest.len() + if S::LOOSE { SLACK } else { 0 }
    }

    #[inline]
    pub(crate) fn write<S: Style>(&self, units: &mut Units<'_, U>) {
        units.truncate(0);
        for _ in 0..self.ups {
            end_with_sep::<S, U>(units);
            units.push(b'.');
            units.push(b'.');
        }
        if self.rest.is_empty() {
            return;
        }
        end_with_sep::<S, U>(units);
        units.extend(self.rest);
        let tidied = Tidied {
            root: self.root,
            had_trailing_sep: false,
        };
        finish::<S, U>(units, tidied);
    }
}

pub(crate) const ROOM_FOR_NAMESPACE: usize = br"?\UNC\".len() + SLACK;

/// Normalizes the path, because Win32 does not after `prefix`, which is `\\?\` or `\??\`.
pub(crate) fn add_namespace<S: Style, U: PathUnit>(units: &mut Units<'_, U>, prefix: [u8; 4]) {
    normalize::<S, U>(units);
    let root = Root::of::<S, U>(units.as_slice());
    let is_nt = prefix == crate::windows::NT_OBJECT_PREFIX_U8;
    let prefix = prefix.map(U::from_u8);
    match root.volume {
        Volume::Drive if root.is_absolute() => units.splice(0, 0, &prefix),
        Volume::Share => {
            units.splice(0, 1, U::lit(b"UNC"));
            units.splice(0, 0, &prefix);
        }
        Volume::Device if is_nt => units.as_mut_slice()[..3].copy_from_slice(&prefix[..3]),
        // No such object, where `\Device\..` without the prefix would be one.
        Volume::None if is_nt && root.is_absolute() => units.splice(0, 0, &prefix),
        Volume::Drive | Volume::Device | Volume::None => {}
    }
}

pub(crate) fn remove_namespace<S: Style, U: PathUnit>(units: &mut Units<'_, U>) {
    let path = units.as_slice();
    let root = Root::of::<S, U>(path);
    if root.volume != Volume::Device || !path[2].eq_ascii(b'?') {
        return;
    }
    let inner = without_leading_seps::<S, U>(&path[3..]);
    let prefix_len = path.len() - inner.len();
    let inner_root = Root::of::<S, U>(inner);
    if inner_root.volume == Volume::Drive {
        if inner_root.is_absolute() {
            units.splice(0, prefix_len, &[]);
        }
    } else if let Some(share) = S::strip_dir(inner, U::lit(b"UNC"))
        && let Some(server) = Components::<S, U>::of(share).next()
        && !matches!(server, [it] if it.eq_ascii(b'.') || it.eq_ascii(b'?'))
    {
        let prefix_len = path.len() - share.len();
        units.splice(0, prefix_len, &[U::from_u8(S::SEP); 2]);
    }
}
