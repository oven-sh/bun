//! In-place push, join, resolve and relative. Generic over unit and style, not over the backend.

use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ops::Range;

use crate::path_style::{
    Components, PathStyle, Posix, Root, VolumeKind, common_path_prefix_len, eq_ignore_case_and_sep,
    eq_path, len_without_trailing_sep,
};
use crate::path_unit::PathUnit;

/// The most a result can outgrow its inputs: the `./` that `prevent_new_volume` inserts.
pub(crate) const NORMALIZE_OVERHEAD: usize = 2;
pub(crate) const NAMESPACE_OVERHEAD: usize = br"?\UNC\".len() + NORMALIZE_OVERHEAD;

pub(crate) const LONG_PATH_PREFIX: [u8; 4] = *br"\\?\";
pub(crate) const NT_PATH_PREFIX: [u8; 4] = *br"\??\";

/// A path's buffer during one edit. The capacity is already reserved.
pub(crate) struct EditBuf<'a, U, S> {
    /// `data[..len]` is initialized.
    data: &'a mut [MaybeUninit<U>],
    len: usize,
    style: PhantomData<S>,
}

impl<'a, U: PathUnit, S: PathStyle> EditBuf<'a, U, S> {
    /// SAFETY: `data[..len]` is initialized.
    #[inline(always)]
    pub(crate) unsafe fn new(data: &'a mut [MaybeUninit<U>], len: usize) -> Self {
        Self {
            data,
            len,
            style: PhantomData,
        }
    }

    /// Returns the length without the NUL.
    #[inline(always)]
    pub(crate) fn nul_terminate(self) -> usize {
        self.data[self.len].write(*U::NUL);
        self.len
    }

    #[inline(always)]
    fn as_slice(&self) -> &[U] {
        // SAFETY: `data[..len]` is initialized.
        unsafe { self.data.get_unchecked(..self.len).assume_init_ref() }
    }

    #[inline(always)]
    fn as_mut_slice(&mut self) -> &mut [U] {
        // SAFETY: `data[..len]` is initialized.
        unsafe { self.data.get_unchecked_mut(..self.len).assume_init_mut() }
    }

    #[inline(always)]
    pub(crate) fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }

    #[inline(always)]
    fn push_ascii(&mut self, ascii: u8) {
        self.data[self.len].write(U::from_u8(ascii));
        self.len += 1;
    }

    #[inline(always)]
    pub(crate) fn extend_from_slice<C: PathUnit>(&mut self, units: &[C]) {
        self.len += U::copy_or_transcode(units, &mut self.data[self.len..]);
    }

    /// Lets `f` read the path while it appends to the spare capacity.
    #[inline(always)]
    fn append_with<R>(&mut self, f: impl FnOnce(&[U], &mut EditBuf<'_, U, S>) -> R) -> R {
        let (path, spare) = self.data.split_at_mut(self.len);
        // SAFETY: an empty range is initialized.
        let mut appended = unsafe { EditBuf::new(spare, 0) };
        // SAFETY: `data[..len]` is initialized.
        let result = f(unsafe { path.assume_init_ref() }, &mut appended);
        self.len += appended.len;
        result
    }

    #[inline]
    pub(crate) fn splice(&mut self, range: Range<usize>, with: &[U]) {
        assert!(range.start <= range.end && range.end <= self.len);
        let with_end = range.start + with.len();
        self.data.copy_within(range.end..self.len, with_end);
        self.data[range.start..with_end].write_copy_of_slice(with);
        self.len = with_end + (self.len - range.end);
    }

    /// Replaces the first `prefix_len` units with `count` times `../`.
    #[inline]
    fn replace_prefix_with_dotdots(&mut self, prefix_len: usize, count: usize) {
        assert!(prefix_len <= self.len);
        let kept = self.len - prefix_len;
        self.data.copy_within(prefix_len..self.len, 3 * count);
        self.len = 0;
        for _ in 0..count {
            self.push_ascii(b'.');
            self.push_ascii(b'.');
            self.push_ascii(b'/');
        }
        self.len += kept;
    }

    #[inline(always)]
    pub(crate) fn push_trailing_sep(&mut self) {
        if self.len > 0 && !S::has_trailing_sep(self.as_slice()) {
            self.push_ascii(S::SEP);
        }
    }

    #[inline(always)]
    fn convert_seps(&mut self, start: usize) {
        S::to_native_in_place(&mut self.as_mut_slice()[start..]);
    }

    /// Inserts `./` if collapsing exposed a volume: `a\..\C:\b` becomes `.\C:\b`. `\\` gets a third separator.
    #[inline(always)]
    fn prevent_new_volume(&mut self, before: Root) {
        if S::WIN32
            && before.kind == VolumeKind::None
            && Root::parse::<S>(self.as_slice()).kind != VolumeKind::None
        {
            core::hint::cold_path();
            let (dot, sep) = (U::from_u8(b'.'), U::from_u8(S::SEP));
            match self.as_slice() {
                [first, second, ..] if S::is_sep(*first) && S::is_sep(*second) => {
                    self.splice(2..2, &[sep]);
                }
                _ => self.splice(before.len..before.len, &[dot, sep]),
            }
        }
    }
}

#[inline(always)]
pub(crate) fn max_joined_len<U: PathUnit, C: PathUnit>(parts: &[&[C]]) -> usize {
    let len: usize = parts.iter().map(|part| 1 + U::max_len_for(part)).sum();
    len + NORMALIZE_OVERHEAD
}

// ── push ──

/// A trimmed `push` argument, measured once for reserving and for writing.
pub(crate) struct TrimmedPart<'a, C> {
    text: &'a [C],
    needs_sep: bool,
    root_to_preserve: Option<Root>,
}

impl<'a, C: PathUnit> TrimmedPart<'a, C> {
    #[inline(always)]
    pub(crate) fn new<S: PathStyle>(path: &[impl PathUnit], part: &'a [C]) -> Self {
        let text = &part[trimmed_range::<S>(part, path.is_empty())];
        Self {
            text,
            needs_sep: !text.is_empty() && !path.is_empty() && !S::has_trailing_sep(path),
            root_to_preserve: root_to_preserve::<S>(path, part),
        }
    }

    #[inline(always)]
    pub(crate) fn max_len<U: PathUnit>(&self) -> usize {
        let overhead = self.root_to_preserve.map_or(0, |_| NORMALIZE_OVERHEAD);
        usize::from(self.needs_sep) + U::max_len_for(self.text) + overhead
    }
}

#[inline(always)]
fn trimmed_range<S: PathStyle>(part: &[impl PathUnit], is_first: bool) -> Range<usize> {
    // Fast path: no outer separator and no leading `./`.
    if let [first, second, .., last] = *part
        && !S::is_sep(first)
        && !S::is_sep(second)
        && !S::is_sep(last)
    {
        return 0..part.len();
    }
    trimmed_range_slow::<S>(part, is_first)
}

#[inline(never)]
fn trimmed_range_slow<S: PathStyle>(part: &[impl PathUnit], is_first: bool) -> Range<usize> {
    let root_len = if is_first { S::root(part).len() } else { 0 };
    let end = len_without_trailing_sep::<S>(part, root_len);
    if root_len > 0 {
        return 0..end;
    }
    let rest = skip_leading_seps_and_dots::<S, _>(&part[..end]);
    if is_first && rest.is_empty() {
        return 0..end.min(1);
    }
    end - rest.len()..end
}

#[inline(always)]
fn skip_leading_seps_and_dots<S: PathStyle, C: PathUnit>(mut path: &[C]) -> &[C] {
    loop {
        path = S::without_leading_sep(path);
        match path {
            [dot] if dot.eq_ascii(b'.') => return &[],
            [dot, sep, rest @ ..] if dot.eq_ascii(b'.') && S::is_sep(*sep) => path = rest,
            _ => return path,
        }
    }
}

/// `part` can only form a volume if `path` is empty, or one or two separators.
#[inline(always)]
fn root_to_preserve<S: PathStyle>(path: &[impl PathUnit], part: &[impl PathUnit]) -> Option<Root> {
    if !S::WIN32 {
        return None;
    }
    match path {
        [] => Some(Root::parse::<S>(part)),
        [_] | [_, _] if path.iter().all(|&unit| S::is_sep(unit)) => {
            Some(Root::without_volume(true))
        }
        _ => None,
    }
}

impl<U: PathUnit, S: PathStyle> EditBuf<'_, U, S> {
    #[inline(always)]
    pub(crate) fn push<C: PathUnit>(&mut self, part: &TrimmedPart<'_, C>) {
        if part.needs_sep {
            self.push_ascii(S::SEP);
        }
        let start = self.len;
        self.extend_from_slice(part.text);
        self.convert_seps(start);
        if let Some(root) = part.root_to_preserve {
            self.prevent_new_volume(root);
        }
    }

    #[inline(always)]
    pub(crate) fn push_all<C: PathUnit>(&mut self, parts: &[&[C]]) {
        for part in parts {
            self.push(&TrimmedPart::new::<S>(self.as_slice(), part));
        }
    }

    /// Applies `push` trimming to the text at `start..`. `old_len` is the length before the separator.
    #[inline]
    pub(crate) fn trim_appended_part(&mut self, old_len: usize, start: usize) {
        let (path, part) = self.as_slice().split_at(start);
        let root = root_to_preserve::<S>(&path[..old_len], part);
        let kept = trimmed_range::<S>(part, old_len == 0);
        if kept.is_empty() {
            return self.truncate(old_len);
        }
        self.truncate(start + kept.end);
        if kept.start > 0 {
            self.splice(start..start + kept.start, &[]);
        }
        self.convert_seps(start);
        if let Some(root) = root {
            self.prevent_new_volume(root);
        }
    }
}

// ── normalize, join ──

/// Node's `normalizeString` in place: compacts `path[read..]` to `start` and returns the new length.
#[inline(never)]
fn normalize_components<U: PathUnit>(
    path: &mut [U],
    mut read: usize,
    start: usize,
    allow_above_root: bool,
) -> usize {
    let (slash, dot) = (U::from_u8(b'/'), U::from_u8(b'.'));
    let end = len_without_trailing_sep::<Posix>(path, read);
    let path = &mut path[..end];
    let mut write = start;
    // End of the leading run of `..`, which a later `..` must not pop.
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
                } else if allow_above_root {
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
        let rest = &path[read..];
        let len = U::index_of_untidy_slash(rest).unwrap_or(rest.len());
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

#[cold]
fn collapse_volume_seps<U: PathUnit>(path: &mut [U], root: Root) -> Root {
    // The first three units (`\\s`, `\\?`, `\??`) are never collapsed.
    const START: usize = 3;
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

impl<U: PathUnit, S: PathStyle> EditBuf<'_, U, S> {
    /// First step of normalizing. Leaves `/` as the separator, none at the end, and returns the new root.
    #[inline(always)]
    fn normalize_to_slashes(&mut self, mut root: Root) -> Root {
        let path = self.as_mut_slice();
        let components_start = root.len;
        if S::WIN32 {
            S::to_portable_in_place(path);
            match root.kind {
                VolumeKind::None => {}
                VolumeKind::Drive => path[0] = path[0].to_ascii_upper(),
                VolumeKind::Unc | VolumeKind::Device => root = collapse_volume_seps(path, root),
            }
        }
        let len = normalize_components(path, components_start, root.len, !root.is_absolute());
        self.truncate(len);
        root
    }

    #[inline(always)]
    fn finish_normalize(&mut self, root: Root, trailing_sep: bool) {
        if self.len == root.len && !root.is_absolute() {
            self.push_ascii(b'.');
        }
        let needs_sep = if self.len > root.len {
            trailing_sep
        } else {
            root.kind == VolumeKind::Unc && root.len == root.volume_len
        };
        if needs_sep {
            self.push_ascii(b'/');
        }
        self.convert_seps(0);
        self.prevent_new_volume(root);
    }

    /// Skips a leading `./`, except after a UNC or device prefix, where `.` can be the share.
    #[inline(always)]
    fn append_part<C: PathUnit>(&mut self, mut part: &[C], kind: VolumeKind) {
        self.push_trailing_sep();
        if let [dot, sep, rest @ ..] = part
            && dot.eq_ascii(b'.')
            && S::is_sep(*sep)
            && matches!(kind, VolumeKind::None | VolumeKind::Drive)
        {
            part = rest;
        }
        self.extend_from_slice(part);
    }

    /// Returns the root. Later parts can complete a volume but not start one.
    #[inline(always)]
    fn concat_parts<C: PathUnit>(&mut self, parts: &[&[C]]) -> Root {
        let mut parts = parts.iter().filter(|part| !part.is_empty());
        if self.len == 0
            && let Some(first) = parts.next()
        {
            self.extend_from_slice(first);
        }
        let root = Root::parse::<S>(self.as_slice());
        for part in parts {
            self.append_part(part, root.kind);
        }
        match root.kind {
            VolumeKind::None => root,
            _ => Root::parse::<S>(self.as_slice()),
        }
    }

    #[inline(never)]
    pub(crate) fn join<C: PathUnit>(&mut self, parts: &[&[C]]) {
        let root = self.concat_parts(parts);
        let trailing_sep = self.len > root.len && S::has_trailing_sep(self.as_slice());
        let root = self.normalize_to_slashes(root);
        self.finish_normalize(root, trailing_sep);
    }

    #[inline(never)]
    pub(crate) fn push_inside<C: PathUnit>(&mut self, part: &[C]) {
        let old_len = self.len;
        let root = root_to_preserve::<S>(self.as_slice(), &part[..0]);
        self.push_trailing_sep();
        let start = self.len;
        self.extend_from_slice(part);
        let added = &mut self.as_mut_slice()[start..];
        S::to_portable_in_place(added);
        let added_len = normalize_components(added, 0, 0, false);
        if added_len == 0 {
            return self.truncate(old_len);
        }
        self.truncate(start + added_len);
        self.convert_seps(start);
        if let Some(root) = root {
            self.prevent_new_volume(root);
        }
    }
}

// ── resolve ──

/// POSIX only: the parts before it need not be copied or reserved.
#[inline(always)]
pub(crate) fn last_absolute_posix_part<S: PathStyle>(parts: &[&[impl PathUnit]]) -> Option<usize> {
    if S::WIN32 {
        return None;
    }
    parts.iter().rposition(|part| S::is_absolute(part))
}

/// A bare `C:` counts as `C:\`: it is usually a trimmed root, not a drive-relative path.
#[inline(always)]
fn is_bare_drive<C>(root: Root, path: &[C]) -> bool {
    root.kind == VolumeKind::Drive && root.volume_len == path.len()
}

/// What `path.win32.resolve` finds when it scans the parts from last to first.
struct ResolveBase<'a, C> {
    /// The last volume. Empty if no part has one.
    volume: &'a [C],
    kind: VolumeKind,
    /// The last absolute part that is not on another volume.
    start: Option<usize>,
    is_absolute: bool,
}

impl<'a, C: PathUnit> ResolveBase<'a, C> {
    #[inline(always)]
    fn find<S: PathStyle>(parts: &[&'a [C]], first: Option<usize>) -> Self {
        let mut base = Self {
            volume: &[],
            kind: VolumeKind::None,
            start: None,
            is_absolute: false,
        };
        for (index, part) in parts.iter().enumerate().rev() {
            let root = Root::parse::<S>(part);
            let is_absolute =
                root.is_absolute() || (first == Some(index) && is_bare_drive(root, part));
            base.is_absolute |= is_absolute;
            if root.kind != VolumeKind::None {
                if base.volume.is_empty() {
                    base.volume = &part[..root.volume_len];
                    base.kind = root.kind;
                } else if !eq_ignore_case_and_sep(base.volume, &part[..root.volume_len]) {
                    continue;
                }
            }
            if is_absolute && base.start.is_none() {
                base.start = Some(index);
            }
            if base.start.is_some() && !base.volume.is_empty() {
                break;
            }
        }
        base
    }
}

impl<U: PathUnit, S: PathStyle> EditBuf<'_, U, S> {
    /// Drops the path if it is on another volume. Returns the length of `volume` in `U`s.
    #[inline(always)]
    fn set_volume<C: PathUnit>(&mut self, current_volume_len: usize, volume: &[C]) -> usize {
        let old_len = self.len;
        self.extend_from_slice(volume);
        let path = self.as_mut_slice();
        let volume_len = path.len() - old_len;
        if old_len == 0 || current_volume_len == 0 {
            path.rotate_left(old_len);
        } else if eq_ignore_case_and_sep(&path[..current_volume_len], &path[old_len..]) {
            self.truncate(old_len);
        } else {
            path.copy_within(old_len.., 0);
            self.truncate(volume_len);
        }
        volume_len
    }

    /// On POSIX, the caller has already skipped to [`last_absolute_posix_part`].
    #[inline(always)]
    fn concat_for_resolve<C: PathUnit>(&mut self, parts: &[&[C]]) -> Root {
        if !S::WIN32 {
            return self.concat_parts(parts);
        }
        // Fast paths: only relative parts follow the one to start at.
        let roots = parts.iter().map(|part| Root::parse::<S>(part));
        let last_rooted = roots.enumerate().rfind(|(_, root)| root.len > 0);
        if let Some((last, root)) = last_rooted
            && root.is_fully_qualified::<S>()
        {
            self.truncate(0);
            return self.concat_parts(&parts[last..]);
        }
        let current = Root::parse::<S>(self.as_slice());
        if last_rooted.is_none() && !is_bare_drive(current, self.as_slice()) {
            return self.concat_parts(parts);
        }
        let first = match self.len {
            0 => parts.iter().position(|part| !part.is_empty()),
            _ => None,
        };
        let base = ResolveBase::find::<S>(parts, first);
        let is_absolute =
            base.is_absolute || current.is_absolute() || is_bare_drive(current, self.as_slice());

        let (kind, volume_len) = if base.volume.is_empty() {
            if base.start.is_some() {
                self.truncate(current.volume_len);
            }
            (current.kind, current.volume_len)
        } else {
            if base.start.is_some() {
                self.truncate(0);
            }
            (base.kind, self.set_volume(current.volume_len, base.volume))
        };
        if kind == VolumeKind::Drive
            && is_absolute
            && !S::has_leading_sep(&self.as_slice()[volume_len..])
        {
            self.splice(volume_len..volume_len, &[U::from_u8(S::SEP)]);
        }

        for part in &parts[base.start.unwrap_or(0)..] {
            let (part_volume, rest) = part.split_at(Root::parse::<S>(part).volume_len);
            let is_on_other_volume =
                !part_volume.is_empty() && !eq_ignore_case_and_sep(base.volume, part_volume);
            if rest.is_empty() || is_on_other_volume {
                continue;
            }
            if self.len == 0 || (kind == VolumeKind::Drive && self.len == volume_len) {
                self.extend_from_slice(rest);
            } else {
                self.append_part(rest, kind);
            }
        }
        match kind {
            VolumeKind::None => Root::without_volume(is_absolute),
            _ => Root::parse::<S>(self.as_slice()),
        }
    }

    #[inline(never)]
    pub(crate) fn resolve<C: PathUnit>(&mut self, parts: &[&[C]]) {
        let root = self.concat_for_resolve(parts);
        let root = self.normalize_to_slashes(root);
        self.finish_normalize(root, false);
    }
}

// ── relative ──

/// An absolute, normalized operand of `relative`.
#[derive(Clone, Copy)]
pub(crate) struct Resolved<'a, U> {
    path: &'a [U],
    root: Root,
}

impl<'a, U: PathUnit> Resolved<'a, U> {
    /// `Some` if `path` is already absolute and normalized.
    #[inline(always)]
    pub(crate) fn try_borrow<S: PathStyle>(path: &'a [U]) -> Option<Self> {
        let is_normalized =
            !S::WIN32 && path.first()?.eq_ascii(b'/') && U::index_of_untidy_slash(path).is_none();
        is_normalized.then(|| Self {
            path: S::without_trailing_sep(path),
            root: Root::without_volume(true),
        })
    }

    #[inline(always)]
    fn volume(&self) -> &[U] {
        &self.path[..self.root.volume_len]
    }
}

/// An operand of `relative` that must first be resolved against `base`.
#[derive(Clone, Copy)]
pub(crate) struct Unresolved<'a, U> {
    base: &'static [u8],
    path: &'a [U],
}

impl<'a, U: PathUnit> Unresolved<'a, U> {
    /// Reads the top-level directory once, because `process.chdir()` on another thread changes it.
    #[inline(always)]
    pub(crate) fn pair<S: PathStyle>(from: &'a [U], to: &'a [U]) -> [Self; 2] {
        let mut top_level_dir = None;
        [from, to].map(|path| Self {
            base: match S::is_fully_qualified(path) {
                true => b"",
                false => top_level_dir.get_or_insert_with(crate::fs::top_level_dir),
            },
            path,
        })
    }

    #[inline(always)]
    fn max_len(self) -> usize {
        U::max_len_for(self.base) + 1 + self.path.len() + NORMALIZE_OVERHEAD
    }
}

/// Worst case: every `/a` in `from` becomes `../`.
#[inline(always)]
pub(crate) fn max_relative_len<U: PathUnit>(
    from: Unresolved<'_, U>,
    to: Unresolved<'_, U>,
) -> usize {
    3 * from.max_len().div_ceil(2) + to.max_len() + NORMALIZE_OVERHEAD
}

/// `dotdots` times `..`, then `rest`.
pub(crate) struct Relative<'a, U> {
    dotdots: usize,
    rest: &'a [U],
    root: Root,
}

impl<'a, U: PathUnit> Relative<'a, U> {
    #[inline]
    pub(crate) fn new<S: PathStyle>(from: Resolved<'_, U>, to: Resolved<'a, U>) -> Self {
        if from.root.is_absolute() != to.root.is_absolute()
            || (S::WIN32 && !eq_path::<S, U>(from.volume(), to.volume()))
        {
            return Self {
                dotdots: 0,
                rest: to.path,
                root: to.root,
            };
        }
        let (from, to) = (&from.path[from.root.len..], &to.path[to.root.len..]);
        let is_boundary = |path: &[U], at: usize| path.get(at).is_none_or(|c| c.eq_ascii(b'/'));
        let mut common = common_path_prefix_len::<S, U>(from, to);
        if !(is_boundary(from, common) && is_boundary(to, common)) {
            common = U::last_index_of_slash(&from[..common]).unwrap_or(0);
        }
        let from_rest = S::without_leading_sep(&from[common..]);
        Self {
            dotdots: match from_rest {
                [] => 0,
                _ => 1 + U::count_slashes(from_rest),
            },
            rest: S::without_leading_sep(&to[common..]),
            root: Root::without_volume(false),
        }
    }

    #[inline(always)]
    pub(crate) fn max_len<S: PathStyle>(&self) -> usize {
        let overhead = if S::WIN32 { NORMALIZE_OVERHEAD } else { 0 };
        3 * self.dotdots + self.rest.len() + overhead
    }
}

impl<U: PathUnit, S: PathStyle> EditBuf<'_, U, S> {
    #[inline]
    pub(crate) fn write_relative(&mut self, relative: &Relative<'_, U>) {
        debug_assert!(self.len == 0);
        for _ in 0..relative.dotdots {
            self.push_trailing_sep();
            self.push_ascii(b'.');
            self.push_ascii(b'.');
        }
        if relative.rest.is_empty() {
            return;
        }
        self.push_trailing_sep();
        self.extend_from_slice(relative.rest);
        self.finish_normalize(relative.root, false);
    }

    #[inline(never)]
    fn write_resolved(&mut self, operand: Unresolved<'_, U>) -> Root {
        debug_assert!(self.len == 0);
        self.extend_from_slice(operand.base);
        let root = self.concat_for_resolve(&[operand.path]);
        self.normalize_to_slashes(root)
    }

    /// Slow path: resolves both operands into the buffer, then compacts the result over them.
    #[inline(never)]
    pub(crate) fn resolve_and_write_relative(
        &mut self,
        from: Unresolved<'_, U>,
        to: Unresolved<'_, U>,
    ) {
        let from_root = self.write_resolved(from);
        let (dotdots, rest_len, root) = self.append_with(|from, spare| {
            let to_root = spare.write_resolved(to);
            let relative = Relative::new::<S>(
                Resolved {
                    path: from,
                    root: from_root,
                },
                Resolved {
                    path: spare.as_slice(),
                    root: to_root,
                },
            );
            (relative.dotdots, relative.rest.len(), relative.root)
        });
        self.replace_prefix_with_dotdots(self.len - rest_len, dotdots);
        if rest_len == 0 {
            self.truncate(self.len.saturating_sub(1));
        }
        if self.len > 0 {
            self.finish_normalize(root, false);
        }
    }
}

// ── `\\?\` and `\??\` ──

impl<U: PathUnit, S: PathStyle> EditBuf<'_, U, S> {
    /// Normalizes what gets `prefix`, because Win32 does not normalize what follows it.
    pub(crate) fn add_namespace_prefix(&mut self, prefix: [u8; 4]) {
        let root = Root::parse::<S>(self.as_slice());
        let is_nt = prefix == NT_PATH_PREFIX;
        if !is_nt && root.kind == VolumeKind::Device && S::is_sep(self.as_slice()[1]) {
            return self.convert_seps(0);
        }
        let root = self.normalize_to_slashes(root);
        self.finish_normalize(root, false);
        let prefix = prefix.map(U::from_u8);
        match root.kind {
            VolumeKind::Drive if root.is_absolute() => self.splice(0..0, &prefix),
            VolumeKind::Unc => {
                self.splice(0..1, U::lit(b"UNC"));
                self.splice(0..0, &prefix);
            }
            VolumeKind::Device => {
                let path = self.as_mut_slice();
                path[..3].copy_from_slice(&prefix[..3]);
                if let [_, _, _, _, drive, colon, ..] = path
                    && colon.eq_ascii(b':')
                {
                    *drive = drive.to_ascii_upper();
                }
            }
            // Prefix `\a` too, so that NT fails the lookup instead of opening `\Device\..`.
            VolumeKind::None if is_nt && root.is_absolute() => self.splice(0..0, &prefix),
            VolumeKind::Drive | VolumeKind::None => {}
        }
    }

    pub(crate) fn strip_nt_prefix(&mut self) {
        let path = self.as_slice();
        if !Root::parse::<S>(path).has_nt_prefix(path) {
            return;
        }
        let inner = S::without_leading_sep(&path[3..]);
        if S::is_absolute(inner) {
            self.splice(0..path.len() - inner.len(), &[]);
        } else if let Some(share) = S::strip_prefix(inner, U::lit(b"UNC"))
            && let Some(server) = Components::<S, U>::new(share).next()
            && !matches!(server, [c] if c.eq_ascii(b'.') || c.eq_ascii(b'?'))
        {
            self.splice(0..path.len() - share.len(), &[U::from_u8(S::SEP); 2]);
        }
    }
}
