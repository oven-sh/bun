//! One-pass versions for the common case: short 8-bit paths with a plain root. `None` means: use [`posix`] or [`win32`].

use core::mem::MaybeUninit;

use bun_core::strings::CodeUnits;
use bun_core::vec::BorrowedBuf;

use crate::win32::Padded;
use crate::{BACKSLASH, Origin, Output, PathArgs, ResolveStep, SLASH, posix, win32};

const CAPACITY: usize = 512;

/// Aligned so that the cache lines and pages a path spans do not depend on the stack depth.
#[repr(align(64))]
pub struct StackBuffer([MaybeUninit<u8>; CAPACITY]);

impl StackBuffer {
    #[inline(always)]
    pub fn new() -> Self {
        StackBuffer([const { MaybeUninit::uninit() }; CAPACITY])
    }
}

const fn separator<const WIN32: bool>() -> u8 {
    if WIN32 { BACKSLASH } else { SLASH }
}

/// Leaves room for a separator.
#[inline(always)]
fn try_append(to: &mut BorrowedBuf<'_, u8>, path: &[u8]) -> Option<()> {
    let mut to = to.unfilled();
    (path.len() < to.capacity()).then(|| to.append(path))
}

#[inline(always)]
fn latin1(path: CodeUnits<'_>) -> Option<&[u8]> {
    match path {
        CodeUnits::U8(path) => Some(path),
        CodeUnits::U16(_) => None,
    }
}

/// `?` for an `Option` in a function that returns `Result<Option<_>, _>`.
macro_rules! or_bail {
    ($option:expr) => {
        match $option {
            Some(value) => value,
            None => {
                core::hint::cold_path();
                return Ok(None);
            }
        }
    };
}

#[inline(always)]
pub fn join<const WIN32: bool, P: PathArgs>(
    paths: P,
    buffer: &mut StackBuffer,
) -> Result<Option<Output<'_>>, P::Error> {
    let prefix: &[u8] = if WIN32 { &win32::DOT_PREFIX } else { &[] };
    let mut joined = BorrowedBuf::from(&mut buffer.0[..]);
    joined.unfilled().append(prefix);
    let mut first_len = 0;
    for index in 0..paths.len() {
        let path = paths.load(index)?;
        let path = or_bail!(latin1(P::units(&path)));
        if path.is_empty() {
            continue;
        }
        if first_len == 0 {
            first_len = path.len();
        } else {
            joined.unfilled().append(&[separator::<WIN32>()]);
        }
        or_bail!(try_append(&mut joined, path));
    }
    if first_len == 0 {
        return Ok(None);
    }
    let joined_len = joined.len() - prefix.len();
    let normalized = if !WIN32 {
        posix::normalize_in_place(joined.into_filled_mut(), None)
    } else if win32::is_trivially_normalized(&joined.filled()[prefix.len()..]) {
        &joined.into_filled()[prefix.len()..]
    } else {
        let padded = Padded::close(joined).collapse_leading_seps(first_len);
        return Ok(Some(Output::Built(CodeUnits::U8(padded.normalize()))));
    };
    Ok(Some(
        if first_len == joined_len && first_len == normalized.len() {
            Output::Arg(index_of_first_non_empty(paths)?)
        } else {
            Output::Built(CodeUnits::U8(normalized))
        },
    ))
}

#[inline(never)]
fn index_of_first_non_empty<P: PathArgs>(paths: P) -> Result<usize, P::Error> {
    let mut index = 0;
    while P::units(&paths.load(index)?).is_empty() {
        index += 1;
    }
    Ok(index)
}

enum PlainRoot {
    /// `/` or `C:\`.
    FullyQualified,
    Absent,
}

/// `None` for the roots `C:`, `\` and `\\` of win32.
#[inline(always)]
fn plain_root<const WIN32: bool>(path: &[u8]) -> Option<PlainRoot> {
    if !WIN32 {
        Some(if posix::is_absolute(path) {
            PlainRoot::FullyQualified
        } else {
            PlainRoot::Absent
        })
    } else if win32::has_drive(path) {
        win32::is_sep_at(path, win32::DRIVE_LEN).then_some(PlainRoot::FullyQualified)
    } else {
        (!win32::is_sep_at(path, 0)).then_some(PlainRoot::Absent)
    }
}

#[inline(always)]
fn is_fully_qualified<const WIN32: bool>(path: &[u8]) -> bool {
    matches!(plain_root::<WIN32>(path), Some(PlainRoot::FullyQualified))
}

#[inline(always)]
fn is_trivially_resolved<const WIN32: bool>(path: &[u8]) -> bool {
    if WIN32 {
        win32::is_trivially_resolved(path)
    } else {
        posix::is_trivially_resolved(path)
    }
}

/// `cwd` is only called if no argument is fully qualified.
#[inline(always)]
pub fn resolve<const WIN32: bool, P: PathArgs>(
    cwd: impl Fn() -> Result<Option<P::Guard>, P::Error>,
    paths: P,
    buffer: &mut StackBuffer,
) -> Result<Option<ResolveStep<Output<'_>>>, P::Error> {
    let (mut first_relative, mut relative_len) = (paths.len(), 0);
    let base = loop {
        if first_relative == 0 {
            let Some(cwd) = cwd()? else {
                return Ok(Some(ResolveStep::NeedsCwd));
            };
            if !is_fully_qualified::<WIN32>(or_bail!(latin1(P::units(&cwd)))) {
                return Ok(None);
            }
            break cwd;
        }
        let guard = paths.load(first_relative - 1)?;
        let path = or_bail!(latin1(P::units(&guard)));
        if let PlainRoot::FullyQualified = or_bail!(plain_root::<WIN32>(path)) {
            if relative_len == 0 && is_trivially_resolved::<WIN32>(path) {
                return Ok(Some(ResolveStep::Done(Output::Arg(first_relative - 1))));
            }
            break guard;
        }
        relative_len += path.len();
        first_relative -= 1;
    };
    let mut joined = BorrowedBuf::from(&mut buffer.0[..]);
    or_bail!(try_append(&mut joined, or_bail!(latin1(P::units(&base)))));
    drop(base);
    for index in first_relative..paths.len() {
        let path = paths.load(index)?;
        let path = or_bail!(latin1(P::units(&path)));
        if !path.is_empty() {
            joined.unfilled().append(&[separator::<WIN32>()]);
            or_bail!(try_append(&mut joined, path));
        }
    }
    let resolved = resolve_in_place::<WIN32>(joined.into_filled_mut(), None);
    Ok(Some(ResolveStep::Done(Output::Built(CodeUnits::U8(
        resolved,
    )))))
}

/// If `path` is a copy of `original`, that is known not to be trivially resolved.
#[inline(always)]
fn resolve_in_place<'s, const WIN32: bool>(
    path: &'s mut [u8],
    original: Option<&[u8]>,
) -> &'s [u8] {
    debug_assert!(is_fully_qualified::<WIN32>(path));
    if !WIN32 {
        posix::resolve_absolute_in_place(path, original)
    } else if original.is_none() && win32::is_trivially_resolved(path) {
        path
    } else {
        win32::resolve_drive_absolute_in_place(path)
    }
}

#[inline(never)]
fn resolve_copy<'s, const WIN32: bool>(
    path: &[u8],
    buffer: &'s mut StackBuffer,
) -> Option<&'s [u8]> {
    if !is_fully_qualified::<WIN32>(path) {
        return None;
    }
    let mut copy = BorrowedBuf::from(&mut buffer.0[..]);
    try_append(&mut copy, path)?;
    Some(resolve_in_place::<WIN32>(
        copy.into_filled_mut(),
        Some(path),
    ))
}

#[inline(always)]
pub fn relative<'s, const WIN32: bool>(
    from: CodeUnits<'s>,
    to: CodeUnits<'s>,
    [from_buffer, to_buffer]: &'s mut [StackBuffer; 2],
) -> Option<Output<'s>> {
    let (mut from, mut to) = (latin1(from)?, latin1(to)?);
    if !is_trivially_resolved::<WIN32>(from) {
        from = resolve_copy::<WIN32>(from, from_buffer)?;
    }
    let mut origin = Origin::Arg;
    if !is_trivially_resolved::<WIN32>(to) {
        to = resolve_copy::<WIN32>(to, to_buffer)?;
        origin = Origin::Scratch;
    }
    let relative = if WIN32 {
        win32::relative_latin1(from, to)
    } else {
        posix::relative_units(from, to)
    };
    Some(relative.into_output(separator::<WIN32>(), CodeUnits::U8(to), origin))
}
