//! `path.posix`. No unit outside ASCII means anything here, so `u8` may be UTF-8 as well.

use core::ops::Range;

use bun_core::strings::PathByte;

use crate::{
    Answer, CodeUnits, DOT, Extent, Failure, Parsed, Paths, Relative, Resolved, SLASH, Scratch,
    Unit, append_joined, byte_at, end_of_names, extension, last_name, last_separator, leading_dots,
    length_of, scan, segments, widened, without_suffix,
};

#[inline(always)]
pub fn is_absolute<U: Unit>(path: &[U]) -> bool {
    byte_at(path, 0) == SLASH
}

#[inline(always)]
pub fn basename<U: Unit>(path: &[U]) -> Range<usize> {
    last_name::<U, false>(path, 0)
}

#[inline(always)]
pub fn basename_without<U: Unit, S: Unit>(path: &[U], suffix: &[S]) -> Range<usize> {
    without_suffix(path, basename(path), suffix)
}

/// That many units from the start. `None` is ".".
#[inline(always)]
pub fn dirname<U: Unit>(path: &[U]) -> Option<usize> {
    let end = end_of_names::<U, false>(path, path.len().min(1));
    match last_separator::<U, false>(path, 0..end)? {
        0 => Some(1),
        1 if is_absolute(path) => Some(2),
        end => Some(end),
    }
}

#[inline(always)]
pub fn extname<U: Unit>(path: &[U]) -> Range<usize> {
    extension::<U, false>(path, 0)
}

/// "/.." has the extension ".".
#[inline(always)]
pub fn parse<U: Unit>(path: &[U]) -> Parsed {
    crate::parse::<U, false>(path, usize::from(is_absolute(path)), 0)
}

/// Whether `normalize(path)` is known to be `path`.
#[inline(always)]
pub fn is_normalized<U: Unit>(path: &[U]) -> bool {
    !path.is_empty()
        && leading_dots::<U, SLASH>(path) == 0
        && scan::first_untidy::<U, SLASH>(path).is_none()
}

/// Whether `resolve(path)` is `path`.
#[inline(always)]
pub(crate) fn is_resolved<U: Unit>(path: &[U]) -> bool {
    is_absolute(path) && (path.len() == 1 || !path[path.len() - 1].is(SLASH)) && is_normalized(path)
}

#[inline(always)]
pub fn normalize<'s, U: Unit>(path: &[U], scratch: &'s mut Scratch) -> Result<Answer<'s>, Failure> {
    if path.is_empty() {
        return Ok(Answer::HERE);
    }
    if path.len() > 2 && path[0].is(DOT) && path[1].is(SLASH) {
        let rest = &path[2..];
        if !is_absolute(rest) && is_normalized(rest) {
            return Ok(Answer::Part(0, 2..path.len()));
        }
    }
    let normalized = normalize_in_place(scratch.copy_of(path)?, Some(path));
    // Units are only ever taken away.
    Ok(if normalized.len() == path.len() {
        Answer::Operand(0)
    } else {
        Answer::Text(U::units(normalized))
    })
}

/// `path` is not empty. `original` is what it is a copy of.
#[inline(always)]
pub(crate) fn normalize_in_place<'s, U: Unit>(
    path: &'s mut [U],
    original: Option<&[U]>,
) -> &'s [U] {
    let root = usize::from(is_absolute(path));
    let ends_with_slash = path[path.len() - 1].is(SLASH);
    let original = original.map(|original| &original[root..]);
    let mut end = root + segments::normalize::<U, SLASH>(&mut path[root..], original, root == 0);
    if end == 0 {
        path[0] = U::from_u8(DOT);
        end = 1;
    }
    if ends_with_slash && end != root {
        path[end] = U::from_u8(SLASH);
        end += 1;
    }
    &path[..end]
}

/// As [`normalize_in_place`] takes them. `path` starts with a slash if it `is_absolute`.
#[inline(always)]
pub(crate) fn resolve_in_place<'s, U: Unit>(
    path: &'s mut [U],
    original: Option<&[U]>,
    is_absolute: bool,
) -> &'s [U] {
    let root = usize::from(is_absolute);
    let original = original.map(|original| &original[root..]);
    let mut end = root + segments::normalize::<U, SLASH>(&mut path[root..], original, root == 0);
    if end == 0 {
        path[0] = U::from_u8(DOT);
        end = 1;
    }
    &path[..end]
}

/// `None` if all of `paths` are empty, where Node answers "." and does not call `normalize`.
pub fn join<'p, 's, P: Paths<'p>>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Option<Answer<'s>>, P::Error> {
    let extent = Extent::of(paths)?;
    Ok(if extent.length == 0 {
        None
    } else if extent.is_wide {
        let joined = normalize_in_place(joined(paths, extent, scratch)?, None);
        Some(Answer::Text(CodeUnits::U16(joined)))
    } else {
        let joined = normalize_in_place(joined(paths, extent, scratch)?, None);
        Some(Answer::Text(CodeUnits::U8(joined)))
    })
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
    Ok(Answer::Text(CodeUnits::U16(joined(
        paths, extent, scratch,
    )?)))
}

fn joined<'p, 's, U: Unit, P: Paths<'p>>(
    paths: P,
    extent: Extent,
    scratch: &'s mut Scratch,
) -> Result<&'s mut [U], P::Error> {
    let mut joined = scratch.room(extent.length)?;
    append_joined(&mut joined.unfilled(), paths, 0, SLASH)?;
    Ok(joined.into_filled_mut())
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
        directory: None,
        start: paths.count(),
        is_absolute: false,
    };
    while found.start > 0 && !found.is_absolute {
        found.start -= 1;
        let path = paths.get(found.start)?;
        if length_of(path) == 0 {
            continue;
        }
        found.is_absolute = of_either_width!(path, |path| is_absolute(path));
        if found.extent.length == 0 && of_either_width!(path, |path| is_resolved(path)) {
            return Ok(Resolved::Answer(Answer::Operand(found.start)));
        }
        found.extent.add(path);
    }
    if !found.is_absolute {
        let Some(directory) = directory else {
            return Ok(Resolved::Needs(None));
        };
        found.extent.add(directory);
        found.directory = Some(directory);
        found.is_absolute = of_either_width!(directory, |directory| is_absolute(directory));
    }
    Ok(Resolved::Answer(Answer::Text(if found.extent.is_wide {
        CodeUnits::U16(found.put_together(paths, scratch)?)
    } else {
        CodeUnits::U8(found.put_together(paths, scratch)?)
    })))
}

/// What `resolve` puts together: `directory`, and the paths from `start` on.
struct Found<'p> {
    extent: Extent,
    directory: Option<CodeUnits<'p>>,
    start: usize,
    is_absolute: bool,
}

impl<'p> Found<'p> {
    fn put_together<'s, U: Unit, P: Paths<'p>>(
        &self,
        paths: P,
        scratch: &'s mut Scratch,
    ) -> Result<&'s [U], P::Error> {
        let mut joined = scratch.room(self.extent.length)?;
        let mut to = joined.unfilled();
        if let Some(directory) = self.directory {
            U::append(&mut to, directory);
            to.append(&[U::from_u8(SLASH)]);
        }
        append_joined(&mut to, paths, self.start, SLASH)?;
        let joined = joined.into_filled_mut();
        Ok(resolve_in_place(joined, None, self.is_absolute))
    }
}

/// `None` unless both are absolute.
pub fn relative<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<Option<Answer<'s>>, Failure> {
    let is_absolute = |path| of_either_width!(path, |path| is_absolute(path));
    if !is_absolute(from) || !is_absolute(to) {
        return Ok(None);
    }
    let mut from_scratch = Scratch::new();
    let from = resolved(from, &mut from_scratch)?.unwrap_or(from);
    let resolved_to = resolved(to, scratch)?;
    let to = resolved_to.unwrap_or(to);
    let relative = between_any(from, to)?;
    Ok(Some(relative.answer(SLASH, to, resolved_to.is_none())))
}

/// `path` is absolute. `None` if it is resolved.
fn resolved<'s>(
    path: CodeUnits<'_>,
    scratch: &'s mut Scratch,
) -> Result<Option<CodeUnits<'s>>, Failure> {
    of_either_width!(path, |path| {
        let resolved = resolve_in_place(scratch.copy_of(path)?, Some(path), true);
        Ok((resolved.len() != path.len()).then(|| PathByte::units(resolved)))
    })
}

/// The rest of `relative`, once it has what `resolve` answered. That can be any text: a script can replace `resolve`.
pub fn relative_of_resolved<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
) -> Result<Answer<'s>, Failure> {
    Ok(between_any(from, to)?.answer(SLASH, to, true))
}

fn between_any(from: CodeUnits<'_>, to: CodeUnits<'_>) -> Result<Relative, Failure> {
    if let (CodeUnits::U8(from), CodeUnits::U8(to)) = (from, to) {
        return Ok(between(from, to));
    }
    let (mut wide_from, mut wide_to) = (Scratch::new(), Scratch::new());
    let (from, to) = (widened(from, &mut wide_from)?, widened(to, &mut wide_to)?);
    Ok(between(from, to))
}

/// The first unit of each is taken for the root, whatever it is.
#[inline(always)]
pub(crate) fn between<U: Unit>(from: &[U], to: &[U]) -> Relative {
    let upwards_from = |start: usize| match from.get(start..) {
        Some(left) => 1 + scan::count::<U, SLASH>(left),
        None => 0,
    };
    let (Some((from_root, from_names)), Some((to_root, to_names))) =
        (from.split_first(), to.split_first())
    else {
        return Relative {
            upwards: upwards_from(1),
            rest: 0..to.len(),
        };
    };
    let common = scan::common_prefix(from_names, to_names);
    if common == from_names.len() {
        match to_names.get(common) {
            None if from_root == to_root => return Relative::SAME,
            Some(unit) if unit.is(SLASH) => return Relative::down(common + 2..to.len()),
            Some(_) if common == 0 => return Relative::down(1..to.len()),
            _ => {}
        }
    }
    let is_inside_to = common == to_names.len()
        && common < from_names.len()
        && (common == 0 || from_names[common].is(SLASH));
    // Where the last slash is that both have.
    let shared = if is_inside_to {
        common + 1
    } else {
        scan::last::<U, SLASH>(&from_names[..common]).map_or(0, |at| at + 1)
    };
    Relative {
        upwards: upwards_from(shared + 1),
        rest: shared..to.len(),
    }
}
