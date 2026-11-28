//! `path.posix`. Only ASCII units are significant, so `u8` may be UTF-8 as well.

use core::ops::Range;

use bun_core::strings::{self, CodeUnits, PathByte};

use crate::normalize_string::normalize_string;
use crate::{
    BACKSLASH, CodeUnit, DOT, JoinedSize, Origin, Output, ParsedRanges, PathArgs, Relative,
    ResolveStep, Result, SLASH, Scratch, append_joined, byte_at, dot_segment_len,
    last_index_of_sep_in, len_without_trailing_sep, scan, without_suffix,
};

const WIN32: bool = false;
const ROOT_LEN: usize = 1;

#[inline(always)]
pub fn is_absolute<U: CodeUnit>(path: &[U]) -> bool {
    byte_at(path, 0) == SLASH
}

#[inline(always)]
fn root_end<U: CodeUnit>(path: &[U]) -> usize {
    usize::from(is_absolute(path))
}

#[inline(always)]
pub fn basename<U: CodeUnit>(path: &[U]) -> Range<usize> {
    crate::basename::<U, WIN32>(path, 0)
}

#[inline(always)]
pub fn basename_without_suffix<U: CodeUnit, S: CodeUnit>(path: &[U], suffix: &[S]) -> Range<usize> {
    without_suffix(path, basename(path), suffix)
}

/// The length of the prefix of `path` to return. `None` means ".".
#[inline(always)]
pub fn dirname<U: CodeUnit>(path: &[U]) -> Option<usize> {
    let end = len_without_trailing_sep::<U, WIN32>(path, path.len().min(ROOT_LEN));
    match last_index_of_sep_in::<U, WIN32>(path, 0..end)? {
        0 => Some(ROOT_LEN),
        // dirname("//a") is "//": https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1459-L1460
        1 if is_absolute(path) => Some("//".len()),
        end => Some(end),
    }
}

#[inline(always)]
pub fn extname<U: CodeUnit>(path: &[U]) -> Range<usize> {
    crate::extname::<U, WIN32>(path, 0)
}

#[inline(always)]
pub fn parse<U: CodeUnit>(path: &[U]) -> ParsedRanges {
    // parse("/..").ext is ".": https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1628
    crate::parse::<U, WIN32>(path, root_end(path), 0)
}

/// `true` implies `normalize(path) == path`.
#[inline(always)]
pub fn is_trivially_normalized<U: CodeUnit>(path: &[U]) -> bool {
    !path.is_empty()
        && dot_segment_len::<U, SLASH>(path) == 0
        && scan::index_of_untidy_sep::<U, SLASH>(path).is_none()
}

/// `true` implies `resolve(path) == path`.
#[inline(always)]
pub(crate) fn is_trivially_resolved<U: CodeUnit>(path: &[U]) -> bool {
    is_absolute(path)
        && (path.len() == ROOT_LEN || !path[path.len() - 1].eq_ascii(SLASH))
        && is_trivially_normalized(path)
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1292-L1313>
#[inline(always)]
pub fn normalize<'s, U: CodeUnit>(path: &[U], scratch: &'s mut Scratch) -> Result<Output<'s>> {
    if path.is_empty() {
        return Ok(Output::DOT);
    }
    if let [dot, slash, rest @ ..] = path
        && dot.eq_ascii(DOT)
        && slash.eq_ascii(SLASH)
        && !is_absolute(rest)
        && is_trivially_normalized(rest)
    {
        return Ok(Output::ArgSlice(0, "./".len()..path.len()));
    }
    let normalized = normalize_in_place(scratch.copy_of(path)?, Some(path));
    // Normalizing only removes units.
    Ok(if normalized.len() == path.len() {
        Output::Arg(0)
    } else {
        Output::Built(U::units(normalized))
    })
}

/// `original` is as for [`normalize_string`].
#[inline(always)]
pub(crate) fn normalize_in_place<'s, U: CodeUnit>(
    path: &'s mut [U],
    original: Option<&[U]>,
) -> &'s [U] {
    let root_end = root_end(path);
    let has_trailing_slash = path[path.len() - 1].eq_ascii(SLASH);
    let mut end = resolve_in_place(path, original, root_end).len();
    if has_trailing_slash && end != root_end {
        path[end] = U::from_u8(SLASH);
        end += 1;
    }
    &path[..end]
}

#[inline(always)]
fn resolve_in_place<'s, U: CodeUnit>(
    path: &'s mut [U],
    original: Option<&[U]>,
    root_end: usize,
) -> &'s [U] {
    debug_assert!(!path.is_empty() && root_end <= self::root_end(path));
    let original = original.map(|original| &original[root_end..]);
    let tail_len = normalize_string::<U, SLASH>(&mut path[root_end..], original, root_end == 0);
    let mut end = root_end + tail_len;
    if end == 0 {
        path[0] = U::from_u8(DOT);
        end = 1;
    }
    &path[..end]
}

/// `original` is as for [`normalize_string`].
#[inline(always)]
pub(crate) fn resolve_absolute_in_place<'s, U: CodeUnit>(
    path: &'s mut [U],
    original: Option<&[U]>,
) -> &'s [U] {
    resolve_in_place(path, original, ROOT_LEN)
}

/// `None` if every path is empty: the result is ".", and `normalize` is not called.
pub fn join<'s, P: PathArgs>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Option<Output<'s>>, P::Error> {
    let size = JoinedSize::of_non_empty(paths)?;
    Ok(if size.len == 0 {
        None
    } else if size.is_16bit {
        let joined = normalize_in_place(concat_args(paths, size, scratch)?, None);
        Some(Output::Built(CodeUnits::U16(joined)))
    } else {
        let joined = normalize_in_place(concat_args(paths, size, scratch)?, None);
        Some(Output::Built(CodeUnits::U8(joined)))
    })
}

/// `join` up to its call of `normalize`: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1329-L1346>
pub fn join_unnormalized<'s, P: PathArgs>(
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<Output<'s>, P::Error> {
    let size = JoinedSize::of_non_empty(paths)?;
    Ok(if size.len == 0 {
        Output::DOT
    } else if size.is_16bit {
        Output::Built(CodeUnits::U16(concat_args(paths, size, scratch)?))
    } else {
        Output::Built(CodeUnits::U8(concat_args(paths, size, scratch)?))
    })
}

fn concat_args<'s, U: CodeUnit, P: PathArgs>(
    paths: P,
    size: JoinedSize,
    scratch: &'s mut Scratch,
) -> Result<&'s mut [U], P::Error> {
    let mut joined = scratch.buffer(size.len)?;
    append_joined(&mut joined.unfilled(), paths, 0, SLASH)?;
    Ok(joined.into_filled_mut())
}

/// `posixCwd()` on Windows: <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1224-L1233>
pub fn cwd_from_win32<'s, U: CodeUnit>(cwd: &[U], scratch: &'s mut Scratch) -> Result<&'s [U]> {
    let cwd = scratch.copy_of(cwd)?;
    strings::replace_char_in_place(cwd, BACKSLASH, SLASH);
    // Without a slash Node evaluates `slice(-1)`.
    let start = scan::index_of(cwd, SLASH).unwrap_or_else(|| cwd.len().saturating_sub(1));
    Ok(&cwd[start..])
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1252-L1285>
#[inline(never)]
pub fn resolve<'s, P: PathArgs>(
    cwd: Option<CodeUnits<'_>>,
    paths: P,
    scratch: &'s mut Scratch,
) -> Result<ResolveStep<Output<'s>>, P::Error> {
    let mut state = ResolveState {
        size: JoinedSize::default(),
        cwd: None,
        first_arg: paths.len(),
        is_absolute: false,
    };
    while state.first_arg > 0 && !state.is_absolute {
        state.first_arg -= 1;
        let path = paths.load(state.first_arg)?;
        let path = P::units(&path);
        if path.is_empty() {
            continue;
        }
        state.is_absolute = match_code_units!(path, |path| is_absolute(path));
        if state.size.len == 0 && match_code_units!(path, |path| is_trivially_resolved(path)) {
            return Ok(ResolveStep::Done(Output::Arg(state.first_arg)));
        }
        state.size.add(path);
    }
    if !state.is_absolute {
        let Some(cwd) = cwd else {
            return Ok(ResolveStep::NeedsCwd);
        };
        state.size.add(cwd);
        state.cwd = Some(cwd);
        state.is_absolute = match_code_units!(cwd, |cwd| is_absolute(cwd));
    }
    Ok(ResolveStep::Done(Output::Built(if state.size.is_16bit {
        CodeUnits::U16(state.build(paths, scratch)?)
    } else {
        CodeUnits::U8(state.build(paths, scratch)?)
    })))
}

/// The result of `resolve` is made of `cwd` and `paths[first_arg..]`.
struct ResolveState<'p> {
    size: JoinedSize,
    cwd: Option<CodeUnits<'p>>,
    first_arg: usize,
    is_absolute: bool,
}

impl ResolveState<'_> {
    fn build<'s, U: CodeUnit, P: PathArgs>(
        &self,
        paths: P,
        scratch: &'s mut Scratch,
    ) -> Result<&'s [U], P::Error> {
        let mut joined = scratch.buffer(self.size.len)?;
        let mut to = joined.unfilled();
        if let Some(cwd) = self.cwd {
            U::append(&mut to, cwd);
            to.append(&[U::from_u8(SLASH)]);
        }
        append_joined(&mut to, paths, self.first_arg, SLASH)?;
        let root_end = usize::from(self.is_absolute);
        Ok(resolve_in_place(joined.into_filled_mut(), None, root_end))
    }
}

/// `None` unless both are absolute.
pub fn relative<'s>(
    from: CodeUnits<'_>,
    to: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<Option<Output<'s>>> {
    let is_absolute = |path| match_code_units!(path, |path| is_absolute(path));
    if !is_absolute(from) || !is_absolute(to) {
        return Ok(None);
    }
    let mut from_scratch = Scratch::new();
    let (from, _) = resolve_absolute(from, &mut from_scratch)?;
    let (to, origin) = resolve_absolute(to, scratch)?;
    let relative = relative_code_units(from, to);
    Ok(Some(relative.into_output(SLASH, to, origin)))
}

fn resolve_absolute<'s>(
    path: CodeUnits<'s>,
    scratch: &'s mut Scratch,
) -> Result<(CodeUnits<'s>, Origin)> {
    let resolved = match_code_units!(path, |path| PathByte::units(resolve_absolute_in_place(
        scratch.copy_of(path)?,
        Some(path)
    )));
    Ok(if resolved.len() == path.len() {
        (path, Origin::Arg)
    } else {
        (resolved, Origin::Scratch)
    })
}

/// `relative` after its calls of `resolve`. A script can replace `resolve`, so the arguments can be any text.
pub fn relative_of_resolved<'s>(from: CodeUnits<'_>, to: CodeUnits<'s>) -> Output<'s> {
    relative_code_units(from, to).into_output(SLASH, to, Origin::Arg)
}

fn relative_code_units(from: CodeUnits<'_>, to: CodeUnits<'_>) -> Relative {
    match_code_units!(from, |from| match_code_units!(to, |to| relative_units(
        from, to
    )))
}

/// <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L1364-L1422>
#[inline(always)]
pub(crate) fn relative_units<A: CodeUnit, B: CodeUnit>(from: &[A], to: &[B]) -> Relative {
    let dotdots_from = |start: usize| match from.get(start..) {
        Some(remaining) => 1 + scan::count_seps::<A, SLASH>(remaining),
        None => 0,
    };
    // Node skips the first unit of each without looking at it.
    let (Some((&from_root, from_tail)), Some((&to_root, to_tail))) =
        (from.split_first(), to.split_first())
    else {
        return Relative {
            dotdots: dotdots_from(ROOT_LEN),
            rest: 0..to.len(),
        };
    };
    let common = scan::common_prefix_length(from_tail, to_tail);
    if common == from_tail.len() {
        match to_tail.get(common) {
            None if from_root.into() == to_root.into() => return Relative::EMPTY,
            Some(unit) if unit.eq_ascii(SLASH) => {
                return Relative::slice_of_to(ROOT_LEN + common + 1..to.len());
            }
            Some(_) if common == 0 => return Relative::slice_of_to(ROOT_LEN..to.len()),
            _ => {}
        }
    }
    let to_is_base_of_from = common == to_tail.len()
        && common < from_tail.len()
        && (common == 0 || from_tail[common].eq_ascii(SLASH));
    // An index into `from` and `to`, where Node's `lastCommonSep` does not count the root.
    let last_common_sep = if to_is_base_of_from {
        ROOT_LEN + common
    } else {
        scan::last_index_of_sep::<A, SLASH>(&from_tail[..common]).map_or(0, |at| ROOT_LEN + at)
    };
    Relative {
        dotdots: dotdots_from(last_common_sep + 1),
        rest: last_common_sep..to.len(),
    }
}
