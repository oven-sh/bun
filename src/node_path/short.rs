//! What most calls are about: 8-bit paths that are short and have a plain root, in one pass. `None` leaves the call to [`posix`] or [`win32`].

use core::mem::MaybeUninit;

use bun_core::vec::BorrowedBuf;

use crate::{Answer, BACKSLASH, CodeUnits, Resolved, SLACK, SLASH, posix, win32};

/// Aligned, so that it does not depend on the depth of the stack how many cache lines and pages a path takes.
#[repr(align(64))]
pub struct Buffer([MaybeUninit<u8>; 512]);

impl Buffer {
    #[inline(always)]
    pub fn new() -> Self {
        Buffer([const { MaybeUninit::uninit() }; 512])
    }
}

const fn separator<const WIN32: bool>() -> u8 {
    if WIN32 { BACKSLASH } else { SLASH }
}

/// Appends `path`, with [`SLACK`] to spare.
#[inline(always)]
fn append(to: &mut BorrowedBuf<'_, u8>, path: &[u8]) -> Option<()> {
    let mut to = to.unfilled();
    (path.len() + SLACK <= to.capacity()).then(|| to.append(path))
}

#[inline(always)]
pub fn join<'p, 's, const WIN32: bool>(
    paths: impl Iterator<Item = Option<&'p [u8]>>,
    buffer: &'s mut Buffer,
) -> Option<&'s [u8]> {
    let mut joined = BorrowedBuf::from(&mut buffer.0[..]);
    if WIN32 {
        joined.unfilled().append(&win32::HERE);
    }
    let mut first = 0;
    for path in paths {
        let path = path?;
        if path.is_empty() {
            continue;
        }
        if first == 0 {
            first = path.len();
        } else {
            joined.unfilled().append(&[separator::<WIN32>()]);
        }
        append(&mut joined, path)?;
    }
    if first == 0 {
        return None;
    }
    if !WIN32 {
        return Some(posix::normalize_in_place(joined.into_filled_mut(), None));
    }
    if win32::is_normalized(&joined.filled()[win32::HERE.len()..]) {
        return Some(&joined.into_filled()[win32::HERE.len()..]);
    }
    joined.unfilled().append(&[BACKSLASH]);
    let padded = win32::without_extra_separators(joined.into_filled_mut(), first);
    win32::normalize_joined(padded)
}

/// Whether nothing in front of `path` counts, or `None` if only a part of it does.
#[inline(always)]
fn is_complete<const WIN32: bool>(path: &[u8]) -> Option<bool> {
    if !WIN32 {
        Some(posix::is_absolute(path))
    } else if win32::has_drive(path) {
        win32::is_separator_at(path, 2).then_some(true)
    } else {
        (!win32::is_separator_at(path, 0)).then_some(false)
    }
}

#[inline(always)]
fn is_resolved<const WIN32: bool>(path: &[u8]) -> bool {
    if WIN32 {
        win32::is_resolved(path)
    } else {
        posix::is_resolved(path)
    }
}

/// `directory` is what an earlier call said it needs.
#[inline(always)]
pub fn resolve<'p, 's, const WIN32: bool>(
    directory: Option<&'p [u8]>,
    count: usize,
    paths: impl Fn(usize) -> Option<&'p [u8]>,
    buffer: &'s mut Buffer,
) -> Option<Resolved<'s>> {
    let mut rest = count;
    let complete = loop {
        if rest == 0 {
            match directory {
                None => return Some(Resolved::Needs(None)),
                Some(directory) if is_complete::<WIN32>(directory)? => break directory,
                Some(_) => return None,
            }
        }
        let path = paths(rest - 1)?;
        if is_complete::<WIN32>(path)? {
            if rest == count && is_resolved::<WIN32>(path) {
                return Some(Resolved::Answer(Answer::Operand(count - 1)));
            }
            break path;
        }
        rest -= 1;
    };
    let mut joined = BorrowedBuf::from(&mut buffer.0[..]);
    append(&mut joined, complete)?;
    for index in rest..count {
        let path = paths(index)?;
        if !path.is_empty() {
            joined.unfilled().append(&[separator::<WIN32>()]);
            append(&mut joined, path)?;
        }
    }
    let resolved = resolve_in_place::<WIN32>(joined.into_filled_mut(), None);
    Some(Resolved::Answer(Answer::Text(CodeUnits::U8(resolved))))
}

/// `path` [`is_complete`]. `original` is what it is a copy of.
#[inline(always)]
fn resolve_in_place<'s, const WIN32: bool>(
    path: &'s mut [u8],
    original: Option<&[u8]>,
) -> &'s [u8] {
    if !WIN32 {
        posix::resolve_in_place(path, original, true)
    } else if original.is_none() && win32::is_resolved(path) {
        path
    } else {
        path[2] = BACKSLASH;
        win32::resolve_in_place(path, 3, true)
    }
}

#[inline(never)]
fn resolve_copy<'s, const WIN32: bool>(path: &[u8], buffer: &'s mut Buffer) -> Option<&'s [u8]> {
    if !is_complete::<WIN32>(path)? {
        return None;
    }
    let mut copy = BorrowedBuf::from(&mut buffer.0[..]);
    append(&mut copy, path)?;
    Some(resolve_in_place::<WIN32>(
        copy.into_filled_mut(),
        Some(path),
    ))
}

#[inline(always)]
pub fn relative<'s, const WIN32: bool>(
    mut from: &'s [u8],
    mut to: &'s [u8],
    [from_buffer, to_buffer]: &'s mut [Buffer; 2],
) -> Option<Answer<'s>> {
    if !is_resolved::<WIN32>(from) {
        from = resolve_copy::<WIN32>(from, from_buffer)?;
    }
    let is_operand = is_resolved::<WIN32>(to);
    if !is_operand {
        to = resolve_copy::<WIN32>(to, to_buffer)?;
    }
    let relative = if WIN32 {
        win32::between_latin1(from, to)
    } else {
        posix::between(from, to)
    };
    Some(relative.answer(separator::<WIN32>(), CodeUnits::U8(to), is_operand))
}
