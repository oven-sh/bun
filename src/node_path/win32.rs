//! `path.win32`.

use core::ops::Range;

use bun_core::vec::BorrowedCursor;

use crate::{
    Answer, BACKSLASH, COLON, CodeUnits, DOT, Extent, Failure, Parsed, Paths, Relative, Resolved,
    SLACK, SLASH, Scratch, Unit, append_joined, byte_at, end_of_names, extension, last_name,
    last_separator, leading_dots, length_of, replace, scan, segments, unicode, widened,
    without_suffix,
};

const QUESTION_MARK: u8 = b'?';

#[inline(always)]
fn is_separator<U: Unit>(unit: U) -> bool {
    crate::is_separator::<U, true>(unit)
}

#[inline(always)]
pub(crate) fn is_separator_at<U: Unit>(path: &[U], index: usize) -> bool {
    matches!(byte_at(path, index), SLASH | BACKSLASH)
}

#[inline(always)]
pub(crate) fn has_drive<U: Unit>(path: &[U]) -> bool {
    byte_at(path, 1) == COLON && path[0].byte().is_ascii_alphabetic()
}

#[inline(always)]
fn drive_length<U: Unit>(path: &[U]) -> usize {
    if has_drive(path) { 2 } else { 0 }
}

/// What a path starts with.
enum Root {
    None,
    /// One separator and no more.
    Separator,
    /// Two separators, without two names behind them.
    Separators,
    /// `C:` or `C:\`.
    Drive {
        is_absolute: bool,
    },
    /// `\\server\share`, `\\.\name` or `\\?\name`.
    Names(Range<usize>, Range<usize>),
}

impl Root {
    #[inline(always)]
    fn of<U: Unit>(path: &[U]) -> Root {
        if has_drive(path) {
            Root::Drive {
                is_absolute: is_separator_at(path, 2),
            }
        } else if !is_separator_at(path, 0) {
            Root::None
        } else if !is_separator_at(path, 1) {
            Root::Separator
        } else {
            Root::behind_two_separators(path)
        }
    }

    #[inline(never)]
    fn behind_two_separators<U: Unit>(path: &[U]) -> Root {
        let name_at = |start: usize| {
            let end = scan::first_slash_or_backslash(&path[start..]);
            start..end.map_or(path.len(), |at| start + at)
        };
        let first = name_at(2);
        match path[first.end..]
            .iter()
            .position(|&unit| !is_separator(unit))
        {
            Some(separators) if !first.is_empty() => {
                let second = name_at(first.end + separators);
                Root::Names(first, second)
            }
            _ => Root::Separators,
        }
    }
}

/// Whether `name` is the "." of `\\.\` or the "?" of `\\?\`.
#[inline(always)]
fn is_namespace<U: Unit>(name: &[U]) -> bool {
    name.len() == 1 && matches!(name[0].byte(), DOT | QUESTION_MARK)
}

/// Where what follows `\\.\` or `\\?\` starts.
const NAMESPACE_LENGTH: usize = 4;

/// No character outside ASCII has one of these letters for its upper case.
fn is_reserved_name<U: Unit>(name: &[U]) -> bool {
    let letters = |at: usize| byte_at(name, at).to_ascii_uppercase();
    match (name.len(), &[letters(0), letters(1), letters(2)]) {
        (3, b"CON" | b"PRN" | b"AUX" | b"NUL") => true,
        (4, b"COM" | b"LPT") => matches!(name[3].byte(), b'1'..=b'9' | 0xB9 | 0xB2 | 0xB3),
        _ => false,
    }
}

#[inline(always)]
pub fn is_absolute<U: Unit>(path: &[U]) -> bool {
    is_separator_at(path, 0) || (has_drive(path) && is_separator_at(path, 2))
}

#[inline(always)]
pub fn basename<U: Unit>(path: &[U]) -> Range<usize> {
    last_name::<U, true>(path, drive_length(path))
}

#[inline(always)]
pub fn basename_without<U: Unit, S: Unit>(path: &[U], suffix: &[S]) -> Range<usize> {
    without_suffix(path, basename(path), suffix)
}

/// How long the root is that `dirname` and `parse` see.
#[inline(always)]
fn root_length<U: Unit>(path: &[U]) -> usize {
    match Root::of(path) {
        Root::None => 0,
        Root::Separator | Root::Separators => 1,
        Root::Drive { is_absolute } => 2 + usize::from(is_absolute),
        Root::Names(_, second) => path.len().min(second.end + 1),
    }
}

/// That many units from the start. `None` is ".".
#[inline(always)]
pub fn dirname<U: Unit>(path: &[U]) -> Option<usize> {
    let root = root_length(path);
    let end = end_of_names::<U, true>(path, root);
    last_separator::<U, true>(path, root..end).or_else(|| (root != 0).then_some(root))
}

#[inline(always)]
pub fn extname<U: Unit>(path: &[U]) -> Range<usize> {
    extension::<U, true>(path, drive_length(path))
}

#[inline(always)]
pub fn parse<U: Unit>(path: &[U]) -> Parsed {
    let root = root_length(path);
    crate::parse::<U, true>(path, root, root)
}

#[inline(always)]
fn is_tidy<U: Unit>(names: &[U]) -> bool {
    leading_dots::<U, BACKSLASH>(names) == 0 && !scan::has_untidy_backslash_or_slash_or_colon(names)
}

/// Whether `normalize(path)` is known to be `path`. It has no reserved name with a colon then.
#[inline(always)]
pub fn is_normalized<U: Unit>(path: &[U]) -> bool {
    let is_on_drive = has_drive(path) && byte_at(path, 2) == BACKSLASH;
    // A reserved name and any unit are as long as that.
    (is_on_drive || !matches!(path.len(), 0 | 4 | 5))
        && is_tidy(&path[if is_on_drive { 2 } else { 0 }..])
}

/// Whether `resolve(path)` is known to be `path`.
#[inline(always)]
pub(crate) fn is_resolved<U: Unit>(path: &[U]) -> bool {
    has_drive(path)
        && byte_at(path, 2) == BACKSLASH
        && (path.len() == 3 || !path[path.len() - 1].is(BACKSLASH))
        && is_tidy(&path[2..])
}

#[inline(always)]
pub fn normalize<'s, U: Unit>(path: &[U], scratch: &'s mut Scratch) -> Result<Answer<'s>, Failure> {
    if path.is_empty() {
        return Ok(Answer::HERE);
    }
    let mut padded = scratch.room(path.len() + SLACK)?;
    padded.unfilled().append(&HERE.map(U::from_u8));
    padded.unfilled().append(path);
    padded.unfilled().append(&[U::from_u8(BACKSLASH)]);
    let normalized = normalize_in_place(padded.into_filled_mut());
    Ok(if normalized == path {
        Answer::Operand(0)
    } else {
        Answer::Text(U::units(normalized))
    })
}

/// What goes in front of a path that would else be taken for a device or a drive.
pub(crate) const HERE: [u8; 2] = [DOT, BACKSLASH];

/// `padded` is two units to overwrite, a path that is not empty, and one more.
#[inline(never)]
fn normalize_in_place<U: Unit>(padded: &mut [U]) -> &[U] {
    const START: usize = HERE.len();
    let end = padded.len() - 1;
    let path = &mut padded[START..end];
    replace(path, SLASH, BACKSLASH);
    let length = path.len();
    if length == 1 {
        return path;
    }
    let ends_with_separator = path[length - 1].is(BACKSLASH);
    let backslash = U::from_u8(BACKSLASH);

    // The answer is `start..tail` of `padded`, and then what becomes of the rest.
    let (mut start, mut tail, mut is_absolute) = (START, START, true);
    let mut may_look_like_device = false;
    match Root::of(path) {
        Root::Separator | Root::Separators => tail += 1,
        Root::Drive { is_absolute: known } => {
            is_absolute = known;
            tail += 2 + usize::from(known);
        }
        Root::Names(first, _) if is_namespace(&path[first.clone()]) => {
            tail += NAMESPACE_LENGTH;
            let colon = scan::first(path, COLON);
            if let Some(colon) = colon.filter(|&at| is_reserved_name(&path[NAMESPACE_LENGTH..at])) {
                path[2] = U::from_u8(QUESTION_MARK);
                start -= 1;
                tail = START + colon + 1;
                padded.copy_within(START..tail, start);
                padded[tail - 1] = backslash;
            }
        }
        Root::Names(first, second) => {
            let skipped = second.start - first.end - 1;
            path.copy_within(..first.end, skipped);
            start += skipped;
            tail += second.end;
            // If nothing follows the share, this is the unit of padding.
            padded[tail] = backslash;
            tail += 1;
        }
        Root::None => {
            is_absolute = false;
            may_look_like_device = true;
        }
    }
    let mut needs_here = false;
    let mut may_look_like_drive = false;
    if may_look_like_device {
        let path = &padded[START..end];
        match scan::first(path, COLON) {
            // `slice(0, -1)`
            None => needs_here = is_reserved_name(&path[..length - 1]),
            Some(colon) if is_reserved_name(&path[..colon]) => {
                needs_here = true;
                tail += colon + 1;
            }
            Some(colon) => {
                may_look_like_drive = true;
                needs_here = has_colon_at_end_of_name(&path[colon..]);
            }
        }
    }

    let rest = tail.min(end)..end;
    let names = segments::normalize::<U, BACKSLASH>(&mut padded[rest], None, !is_absolute);
    let mut written = tail + names;
    if written == tail && !is_absolute {
        padded[written] = U::from_u8(DOT);
        written += 1;
    }
    if written != tail && ends_with_separator {
        padded[written] = backslash;
        written += 1;
    }
    if needs_here || (may_look_like_drive && has_drive(&padded[tail..written])) {
        start = 0;
        padded[..START].copy_from_slice(&HERE.map(U::from_u8));
    }
    &padded[start..written]
}

fn has_colon_at_end_of_name<U: Unit>(path: &[U]) -> bool {
    scan::each(path, COLON).any(|at| at + 1 == path.len() || path[at + 1].is(BACKSLASH))
}

/// `None` where Node does not call `normalize`, and answers what [`concatenate`] does.
pub fn join<'p, 's, P: Paths<'p>>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Option<Answer<'s>>, P::Error> {
    let extent = Extent::of(paths)?;
    let joined = if extent.length == 0 {
        None
    } else if extent.is_wide {
        normalize_joined(joined(paths, extent, scratch)?).map(CodeUnits::U16)
    } else {
        normalize_joined(joined(paths, extent, scratch)?).map(CodeUnits::U8)
    };
    Ok(joined.map(Answer::Text))
}

/// `padded` is what [`without_extra_separators`] answered.
#[inline(never)]
pub(crate) fn normalize_joined<U: Unit>(padded: &mut [U]) -> Option<&[U]> {
    if has_reserved_name(&padded[HERE.len()..padded.len() - 1]) {
        return None;
    }
    Some(normalize_in_place(padded))
}

/// What `join` passes to `normalize`, or answers without it.
pub fn concatenate<'p, 's, P: Paths<'p>>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Answer<'s>, P::Error> {
    let extent = Extent::of(paths)?;
    if extent.length == 0 {
        return Ok(Answer::HERE);
    }
    let padded = joined(paths, extent, scratch)?;
    let end = padded.len() - 1;
    let joined = &mut padded[HERE.len()..end];
    if has_reserved_name(joined) {
        replace(joined, SLASH, BACKSLASH);
    }
    Ok(Answer::Text(CodeUnits::U16(joined)))
}

/// One of `paths` is not empty.
fn joined<'p, 's, U: Unit, P: Paths<'p>>(
    paths: P,
    extent: Extent,
    scratch: &'s mut Scratch,
) -> Result<&'s mut [U], P::Error> {
    let mut padded = scratch.room(extent.length + SLACK)?;
    padded.unfilled().append(&HERE.map(U::from_u8));
    append_joined(&mut padded.unfilled(), paths, 0, BACKSLASH)?;
    padded.unfilled().append(&[U::from_u8(BACKSLASH)]);
    let mut first = 0;
    while length_of(paths.get(first)?) == 0 {
        first += 1;
    }
    let first = length_of(paths.get(first)?);
    Ok(without_extra_separators(padded.into_filled_mut(), first))
}

/// `padded` is as [`normalize_in_place`] takes it: paths with a backslash between them, the first of which is `first` long.
#[inline(always)]
pub(crate) fn without_extra_separators<U: Unit>(padded: &mut [U], first: usize) -> &mut [U] {
    let path = &padded[HERE.len()..padded.len() - 1];
    let mut separators = 0;
    while is_separator_at(path, separators) {
        separators += 1;
    }
    // Two separators and a name are the start of a share, if they are all in the first path.
    if separators < 2 || (separators == 2 && first > 2) {
        return padded;
    }
    let padded = &mut padded[separators - 1..];
    padded[HERE.len()] = U::from_u8(BACKSLASH);
    padded
}

/// Whether a reserved name and a colon follow a backslash, or start `path`.
#[inline(always)]
fn has_reserved_name<U: Unit>(path: &[U]) -> bool {
    let ends_name = |colon: usize, length: usize| {
        colon.checked_sub(length).is_some_and(|start| {
            (start == 0 || path[start - 1].is(BACKSLASH)) && is_reserved_name(&path[start..colon])
        })
    };
    scan::each(path, COLON).any(|colon| ends_name(colon, 3) || ends_name(colon, 4))
}

#[derive(Clone, Copy)]
enum Device<'p> {
    None,
    /// The letter.
    Drive(u8),
    /// The "." or "?".
    Namespace(u8),
    Share(CodeUnits<'p>, CodeUnits<'p>),
}

impl Device<'_> {
    /// Node goes on looking after it has a device only if that is a drive.
    #[inline(always)]
    fn is_other_than(self, found: Device<'_>) -> bool {
        match (self, found) {
            (Device::None, _) | (_, Device::None) => false,
            (Device::Drive(a), Device::Drive(b)) => !a.eq_ignore_ascii_case(&b),
            _ => true,
        }
    }

    #[inline(always)]
    fn append_to<U: Unit>(self, to: &mut BorrowedCursor<'_, U>) {
        match self {
            Device::None => {}
            Device::Drive(letter) => to.append(&[letter, COLON].map(U::from_u8)),
            Device::Namespace(name) => to.append(&[BACKSLASH, BACKSLASH, name].map(U::from_u8)),
            Device::Share(server, share) => {
                to.append(&[BACKSLASH, BACKSLASH].map(U::from_u8));
                U::append(to, server);
                to.append(&[U::from_u8(BACKSLASH)]);
                U::append(to, share);
            }
        }
    }
}

/// A path as `resolve` takes it apart.
struct Split<'p> {
    device: Device<'p>,
    is_absolute: bool,
    root: CodeUnits<'p>,
    tail: CodeUnits<'p>,
}

impl<'p> Split<'p> {
    #[inline(always)]
    fn of(path: CodeUnits<'p>) -> Self {
        of_either_width!(path, |path| Split::of_units(path))
    }

    #[inline(always)]
    fn of_units<U: Unit>(path: &'p [U]) -> Self {
        let (device, is_absolute, root) = match Root::of(path) {
            Root::None => (Device::None, false, 0),
            Root::Separator | Root::Separators => (Device::None, true, 1),
            Root::Drive { is_absolute } => (Device::Drive(path[0].byte()), is_absolute, 2),
            Root::Names(first, _) if is_namespace(&path[first.clone()]) => {
                (Device::Namespace(path[2].byte()), true, NAMESPACE_LENGTH)
            }
            Root::Names(first, second) => {
                let end = second.end;
                let share = Device::Share(U::units(&path[first]), U::units(&path[second]));
                (share, true, end)
            }
        };
        let (root, tail) = path.split_at(root);
        Split {
            device,
            is_absolute,
            root: U::units(root),
            tail: U::units(tail),
        }
    }
}

/// What `resolve` has seen, from the last path on.
struct Found<'p> {
    extent: Extent,
    device: Device<'p>,
    is_absolute: bool,
    /// The index of the path that `device` is of.
    device_at: usize,
    /// The index of the first path whose tail counts.
    start: usize,
    /// The tail of the working directory, if it counts.
    directory: Option<CodeUnits<'p>>,
}

impl<'p> Found<'p> {
    /// The tail of `path`, if it counts.
    #[inline(always)]
    fn look_at(&mut self, path: CodeUnits<'p>, index: usize) -> Option<CodeUnits<'p>> {
        let split = Split::of(path);
        if split.device.is_other_than(self.device) {
            return None;
        }
        if let Device::None = self.device {
            self.device = split.device;
            self.device_at = index;
        }
        if self.is_absolute {
            self.extent.add(split.root);
            return None;
        }
        self.extent.add(path);
        self.is_absolute = split.is_absolute;
        Some(split.tail)
    }

    #[inline(always)]
    fn is_complete(&self) -> bool {
        self.is_absolute && !matches!(self.device, Device::None)
    }
}

/// `directory` is what an earlier call said it needs.
#[inline(never)]
pub fn resolve<'p, 's, P: Paths<'p>>(
    directory: Option<CodeUnits<'p>>,
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Resolved<'s>, P::Error> {
    let mut found = Found {
        extent: Extent::default(),
        device: Device::None,
        is_absolute: false,
        device_at: 0,
        start: paths.count(),
        directory: None,
    };
    for index in (0..paths.count()).rev() {
        let path = paths.get(index)?;
        if length_of(path) == 0 {
            continue;
        }
        if found.extent.length == 0 && of_either_width!(path, |path| is_resolved(path)) {
            return Ok(Resolved::Answer(Answer::Operand(index)));
        }
        if found.look_at(path, index).is_some() {
            found.start = index;
        }
        if found.is_complete() {
            break;
        }
    }
    if !found.is_complete() {
        let drive = match found.device {
            Device::Drive(letter) => Some(letter),
            _ => None,
        };
        let Some(directory) = directory else {
            return Ok(Resolved::Needs(drive));
        };
        match drive {
            Some(letter) if of_either_width!(directory, |it| is_on_other_drive(it, letter)) => {
                found.is_absolute = true;
            }
            _ => found.directory = found.look_at(directory, usize::MAX),
        }
    }
    Ok(Resolved::Answer(Answer::Text(if found.extent.is_wide {
        CodeUnits::U16(put_together(&found, paths, scratch)?)
    } else {
        CodeUnits::U8(put_together(&found, paths, scratch)?)
    })))
}

fn is_on_other_drive<U: Unit>(directory: &[U], letter: u8) -> bool {
    const KELVIN_SIGN: u16 = 0x212A;
    if byte_at(directory, 2) != BACKSLASH {
        return false;
    }
    let first = match directory[0].into() {
        KELVIN_SIGN => b'k',
        _ => directory[0].byte(),
    };
    !directory[1].is(COLON) || !first.eq_ignore_ascii_case(&letter)
}

fn put_together<'p, 's, U: Unit, P: Paths<'p>>(
    found: &Found<'p>,
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<&'s [U], P::Error> {
    let backslash = [U::from_u8(BACKSLASH)];
    let mut resolved = scratch.room(found.extent.length + SLACK)?;
    let mut to = resolved.unfilled();
    found.device.append_to(&mut to);
    if found.is_absolute {
        to.append(&backslash);
    }
    let root = to.written();
    if let Some(directory) = found.directory {
        U::append(&mut to, directory);
        to.append(&backslash);
    }
    for index in found.start..paths.count() {
        let split = Split::of(paths.get(index)?);
        let counts = index == found.device_at || !split.device.is_other_than(found.device);
        if counts && length_of(split.tail) != 0 {
            U::append(&mut to, split.tail);
            to.append(&backslash);
        }
    }
    let resolved = resolved.into_filled_mut();
    Ok(resolve_in_place(resolved, root, found.is_absolute))
}

/// `path` is not empty, and its first `root` units are as they should be.
#[inline(never)]
pub(crate) fn resolve_in_place<U: Unit>(path: &mut [U], root: usize, is_absolute: bool) -> &[U] {
    let tail = &mut path[root..];
    replace(tail, SLASH, BACKSLASH);
    let mut end = root + segments::normalize::<U, BACKSLASH>(tail, None, !is_absolute);
    if end == 0 {
        path[0] = U::from_u8(DOT);
        end = 1;
    }
    &path[..end]
}

/// `None` if one of them takes a working directory.
pub fn relative<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<Option<Answer<'s>>, Failure> {
    fn text_of<'s>(resolved: &Resolved<'s>, path: CodeUnits<'s>) -> Option<(CodeUnits<'s>, bool)> {
        match *resolved {
            Resolved::Answer(Answer::Text(text)) => Some((text, false)),
            Resolved::Answer(_) => Some((path, true)),
            Resolved::Needs(_) => None,
        }
    }
    let mut from_scratch = Scratch::new();
    let Some((from, _)) = text_of(&resolve(None, &[from][..], &mut from_scratch)?, from) else {
        return Ok(None);
    };
    let Some((to, is_operand)) = text_of(&resolve(None, &[to][..], scratch)?, to) else {
        return Ok(None);
    };
    let relative = between_any(from, to)?;
    Ok(Some(relative.answer(BACKSLASH, to, is_operand)))
}

/// The rest of `relative`, once it has what `resolve` answered. That can be any text: a script can replace `resolve`.
pub fn relative_of_resolved<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
) -> Result<Answer<'s>, Failure> {
    Ok(between_any(from, to)?.answer(BACKSLASH, to, true))
}

fn between_any(from: CodeUnits<'_>, to: CodeUnits<'_>) -> Result<Relative, Failure> {
    if let (CodeUnits::U8(from), CodeUnits::U8(to)) = (from, to) {
        return Ok(between_latin1(from, to));
    }
    let (mut wide_from, mut wide_to) = (Scratch::new(), Scratch::new());
    between_utf16(widened(from, &mut wide_from)?, widened(to, &mut wide_to)?)
}

#[inline(never)]
pub(crate) fn between_latin1(from: &[u8], to: &[u8]) -> Relative {
    between(from, to, |from, to| {
        let mut common = 0;
        loop {
            common += scan::common_prefix(&from[common..], &to[common..]);
            let pairs = from[common..].iter().zip(&to[common..]);
            let in_other_case = pairs.take_while(|&(&a, &b)| {
                a != b && unicode::lower_latin1(a) == unicode::lower_latin1(b)
            });
            match in_other_case.count() {
                0 => return common,
                count => common += count,
            }
        }
    })
}

fn between_utf16(from: &[u16], to: &[u16]) -> Result<Relative, Failure> {
    let (mut from_scratch, mut to_scratch) = (Scratch::new(), Scratch::new());
    let lower_from = unicode::lowered(from, &mut from_scratch)?;
    let lower_to = unicode::lowered(to, &mut to_scratch)?;
    if lower_from.len() == from.len() && lower_to.len() == to.len() {
        return Ok(between(lower_from, lower_to, scan::common_prefix));
    }
    Ok(between_by_names(lower_from, lower_to, to))
}

/// Without the backslashes at either end.
#[inline(always)]
fn trimmed<U: Unit>(path: &[U]) -> Range<usize> {
    let start = path.iter().take_while(|unit| unit.is(BACKSLASH)).count();
    let mut end = path.len();
    while end > start + 1 && path[end - 1].is(BACKSLASH) {
        end -= 1;
    }
    start..end
}

/// `common_prefix` ignores case.
#[inline(always)]
fn between<U: Unit>(
    from: &[U],
    to: &[U],
    common_prefix: impl FnOnce(&[U], &[U]) -> usize,
) -> Relative {
    const DRIVE: usize = 2;
    let (from_names, to_names) = (trimmed(from), trimmed(to));
    let is_trimmed_alike = from_names == to_names && from.len() == to.len();
    let (start, end) = (to_names.start, to_names.end);
    let (from, to, whole) = (&from[from_names], &to[to_names], to);
    let common = common_prefix(from, to);
    let last_shared = || scan::last::<U, BACKSLASH>(&from[..common]);

    // Node's `lastCommonSep`.
    let shared = if common == from.len() && common < to.len() {
        if to[common].is(BACKSLASH) {
            return Relative::down(start + common + 1..whole.len());
        }
        if common == DRIVE {
            return Relative::down(start + common..whole.len());
        }
        last_shared().unwrap_or(0)
    } else if common == to.len() && common < from.len() {
        if from[common].is(BACKSLASH) {
            common
        } else if common == DRIVE {
            DRIVE + 1
        } else {
            last_shared().unwrap_or(0)
        }
    } else if common == to.len() {
        if is_trimmed_alike {
            return Relative::SAME;
        }
        last_shared().unwrap_or(0)
    } else {
        let Some(shared) = last_shared() else {
            return Relative::down(0..whole.len());
        };
        shared
    };

    let rest = start + shared;
    match from.get(shared + 1..) {
        Some(left) => Relative {
            upwards: 1 + scan::count::<U, BACKSLASH>(left),
            rest: rest.min(end)..end,
        },
        None => {
            let rest = rest + usize::from(byte_at(whole, rest) == BACKSLASH);
            Relative::down(rest.min(end)..end)
        }
    }
}

/// For when one of them is longer in lower case.
#[cold]
fn between_by_names(lower_from: &[u16], lower_to: &[u16], to: &[u16]) -> Relative {
    fn names(path: &[u16]) -> impl Iterator<Item = &[u16]> + Clone {
        let (path, count) = match path.split_last() {
            None => (path, 0),
            Some((last, before)) if last.is(BACKSLASH) => (before, usize::MAX),
            Some(_) => (path, usize::MAX),
        };
        path.split(|unit| unit.is(BACKSLASH)).take(count)
    }
    if lower_from == lower_to {
        return Relative::SAME;
    }
    let pairs = names(lower_from).zip(names(lower_to));
    let common = pairs.take_while(|(from, to)| from == to).count();
    if common == 0 {
        return Relative::down(0..to.len());
    }
    let upwards = names(lower_from).count() - common;
    let end = to.len() - usize::from(to[to.len() - 1].is(BACKSLASH));
    let separator = names(to)
        .take(common)
        .map(|name| name.len() + 1)
        .sum::<usize>()
        - 1;
    Relative {
        upwards,
        rest: if upwards == 0 {
            end.min(separator + 1)..end
        } else {
            separator..end
        },
    }
}

/// The variable `=C:`, which Windows does not list with the others.
#[cfg(windows)]
pub fn working_directory_of_drive(letter: u8) -> Option<Vec<u16>> {
    let name = [b'=', letter, COLON, 0].map(u16::from);
    bun_sys::windows::getenv_w(bun_core::WStr::from_slice_with_nul(&name))
}

#[cfg(not(windows))]
pub fn working_directory_of_drive(_: u8) -> Option<Vec<u16>> {
    None
}
