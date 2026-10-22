//! `path.posix` for 8-bit characters, sixteen of them at a time. Each function answers what the one it names in the
//! crate root answers. Only '/' and '.' are looked for, so the characters may be ASCII, Latin-1 or UTF-8.

use core::mem::MaybeUninit;
use core::ops::Range;
use core::simd::prelude::*;

const SLASH: u8 = b'/';
const DOT: u8 = b'.';

/// # Safety
/// The characters `at..at + N` are in `path`.
#[inline(always)]
unsafe fn read<const N: usize>(path: &[u8], at: usize) -> [u8; N] {
    debug_assert!(at + N <= path.len());
    // SAFETY: forwarded.
    unsafe { path.as_ptr().add(at).cast::<[u8; N]>().read_unaligned() }
}

/// Whether the part of `path` that starts at `start` is "." or "..".
#[inline(always)]
fn is_dots_at(path: &[u8], start: usize) -> bool {
    matches!(
        &path[start..],
        [DOT] | [DOT, SLASH, ..] | [DOT, DOT] | [DOT, DOT, SLASH, ..]
    )
}

macro_rules! is_tidy_by {
    ($name:ident, $block:ident, $width:literal) => {
        /// `path` has more than `$width` characters.
        #[inline(always)]
        fn $name(path: &[u8]) -> bool {
            let slash = $block::splat(SLASH);
            let dot = $block::splat(DOT);
            let last = path.len() - $width - 1;
            let mut at = 0;
            loop {
                // SAFETY: at <= last, so the characters at..at + $width + 1 are in `path`.
                let (here, next) = unsafe {
                    (
                        $block::from_array(read(path, at)),
                        $block::from_array(read(path, at + 1)),
                    )
                };
                // One bit for each '/' with a '/' or a '.' after it.
                let mut suspects =
                    (here.simd_eq(slash) & (next.simd_eq(slash) | next.simd_eq(dot))).to_bitmask();
                while suspects != 0 {
                    let after_slash = at + suspects.trailing_zeros() as usize + 1;
                    if path[after_slash] == SLASH || is_dots_at(path, after_slash) {
                        return false;
                    }
                    suspects &= suspects - 1;
                }
                if at == last {
                    return true;
                }
                at = (at + $width).min(last);
            }
        }
    };
}
is_tidy_by!(is_tidy_by_16, u8x16, 16);
is_tidy_by!(is_tidy_by_8, u8x8, 8);

/// Whether no part of `path` between two slashes is empty, "." or "..". [`crate::normalize_posix_t`]
/// answers such a path as it is, whether or not it starts or ends with a slash.
#[inline(always)]
pub fn is_tidy_posix(path: &[u8]) -> bool {
    let len = path.len();
    if len == 0 || (path[0] == DOT && is_dots_at(path, 0)) {
        return false;
    }
    if len > 16 {
        return is_tidy_by_16(path);
    }
    if len > 8 {
        return is_tidy_by_8(path);
    }
    for at in 1..len {
        if path[at - 1] == SLASH && (path[at] == SLASH || is_dots_at(path, at)) {
            return false;
        }
    }
    true
}

macro_rules! first_untidy_slash_by {
    ($name:ident, $block:ident, $width:literal) => {
        /// The first '/' of `path[*at..limit]` in front of a part that is empty, "." or "..". Without one, `*at` is where
        /// fewer than `$width` characters and one more are left.
        #[inline(always)]
        fn $name(path: &[u8], at: &mut usize, limit: usize) -> Option<usize> {
            while *at + $width < limit {
                // SAFETY: the characters *at..*at + $width + 1 are in `path[..limit]`.
                let (here, next) = unsafe {
                    (
                        $block::from_array(read(path, *at)),
                        $block::from_array(read(path, *at + 1)),
                    )
                };
                let slash = $block::splat(SLASH);
                let mut suspects = (here.simd_eq(slash)
                    & (next.simd_eq(slash) | next.simd_eq($block::splat(DOT))))
                .to_bitmask();
                while suspects != 0 {
                    let found = *at + suspects.trailing_zeros() as usize;
                    if path[found + 1] == SLASH || is_dots_at(path, found + 1) {
                        return Some(found);
                    }
                    suspects &= suspects - 1;
                }
                *at += $width;
            }
            None
        }
    };
}
first_untidy_slash_by!(first_untidy_slash_by_16, u8x16, 16);
first_untidy_slash_by!(first_untidy_slash_by_8, u8x8, 8);

/// Where the parts from `start` on that are kept as they are end: at a '/' in front of a part that is empty, "." or "..",
/// or at `limit`, which is not behind a slash.
#[inline(always)]
fn end_of_tidy_parts(path: &[u8], start: usize, limit: usize) -> usize {
    let mut at = start;
    if let Some(found) = first_untidy_slash_by_16(path, &mut at, limit) {
        return found;
    }
    if let Some(found) = first_untidy_slash_by_8(path, &mut at, limit) {
        return found;
    }
    while at + 1 < limit {
        if path[at] == SLASH && (path[at + 1] == SLASH || is_dots_at(path, at + 1)) {
            return at;
        }
        at += 1;
    }
    limit
}

/// `normalize_string_t` in the crate root, with '/'. How many characters were written to `to`, which has room for as
/// many as `path` has.
#[inline(always)]
fn normalize_string_posix_latin1(
    path: &[u8],
    allow_above_root: bool,
    to: &mut [MaybeUninit<u8>],
) -> usize {
    assert!(to.len() >= path.len());
    let to = to.as_mut_ptr().cast::<u8>();
    let limit = end_without_slashes(path, 0);
    let mut length = 0;
    let mut at = 0;
    while at < limit {
        if path[at] == SLASH {
            at += 1;
            continue;
        }
        if path[at] == DOT {
            if at + 1 == limit || path[at + 1] == SLASH {
                at += 2;
                continue;
            }
            if path[at + 1] == DOT && (at + 2 == limit || path[at + 2] == SLASH) {
                at += 3;
                // SAFETY: that many are written.
                let written = unsafe { core::slice::from_raw_parts(to, length) };
                if length != 0 && !matches!(written, [DOT, DOT] | [.., SLASH, DOT, DOT]) {
                    length = last_slash(written, length).unwrap_or(0);
                } else if allow_above_root {
                    // SAFETY: what is written is no longer than what was read.
                    unsafe {
                        if length != 0 {
                            to.add(length).write(SLASH);
                            length += 1;
                        }
                        to.add(length).write(DOT);
                        to.add(length + 1).write(DOT);
                    }
                    length += 2;
                }
                continue;
            }
        }
        let end = end_of_tidy_parts(path, at, limit);
        // SAFETY: what is written is no longer than what was read.
        unsafe {
            if length != 0 {
                to.add(length).write(SLASH);
                length += 1;
            }
            to.add(length)
                .copy_from_nonoverlapping(path.as_ptr().add(at), end - at);
        }
        length += end - at;
        at = end + 1;
    }
    length
}

/// [`crate::normalize_posix_t`]. `buffer` has room for two characters more than `path` has.
#[inline]
pub fn normalize_posix_latin1<'b>(path: &[u8], buffer: &'b mut [MaybeUninit<u8>]) -> &'b [u8] {
    if path.is_empty() {
        return b".";
    }
    assert!(buffer.len() >= path.len() + 2);
    let is_absolute = path[0] == SLASH;
    let ends_with_slash = path[path.len() - 1] == SLASH;
    let mut length = normalize_string_posix_latin1(path, !is_absolute, &mut buffer[1..]);
    if length == 0 {
        return match (is_absolute, ends_with_slash) {
            (true, _) => b"/",
            (false, true) => b"./",
            (false, false) => b".",
        };
    }
    buffer[0].write(SLASH);
    if ends_with_slash {
        buffer[1 + length].write(SLASH);
        length += 1;
    }
    let start = usize::from(!is_absolute);
    // SAFETY: the first character and `length` after it are written.
    unsafe { core::slice::from_raw_parts(buffer.as_ptr().cast::<u8>().add(start), 1 + length - start) }
}

/// [`crate::resolve_posix_t`] of one path that is absolute. `buffer` has room for one character more than `path` has.
#[inline]
pub fn resolve_absolute_posix_latin1<'b>(
    path: &[u8],
    buffer: &'b mut [MaybeUninit<u8>],
) -> &'b [u8] {
    debug_assert!(path[0] == SLASH);
    assert!(buffer.len() > path.len());
    let length = normalize_string_posix_latin1(path, false, &mut buffer[1..]);
    buffer[0].write(SLASH);
    // SAFETY: the first character and `length` after it are written.
    unsafe { core::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), 1 + length) }
}

/// The last of `path[..end]` that is `a` or `b`.
#[inline(always)]
fn last_index_of_either(path: &[u8], mut end: usize, a: u8, b: u8) -> Option<usize> {
    debug_assert!(end <= path.len());
    while end >= 16 {
        // SAFETY: 16 <= end <= path.len().
        let block = u8x16::from_array(unsafe { read(path, end - 16) });
        let found = (block.simd_eq(u8x16::splat(a)) | block.simd_eq(u8x16::splat(b))).to_bitmask();
        if found != 0 {
            return Some(end - 16 + found.ilog2() as usize);
        }
        end -= 16;
    }
    if end >= 8 {
        // SAFETY: 8 <= end <= path.len().
        let block = u8x8::from_array(unsafe { read(path, end - 8) });
        let found = (block.simd_eq(u8x8::splat(a)) | block.simd_eq(u8x8::splat(b))).to_bitmask();
        if found != 0 {
            return Some(end - 8 + found.ilog2() as usize);
        }
        end -= 8;
    }
    while end > 0 {
        end -= 1;
        if path[end] == a || path[end] == b {
            return Some(end);
        }
    }
    None
}

#[inline(always)]
fn last_slash(path: &[u8], end: usize) -> Option<usize> {
    last_index_of_either(path, end, SLASH, SLASH)
}

/// `path.len()` less the slashes at its end, but at least `least`.
#[inline(always)]
fn end_without_slashes(path: &[u8], least: usize) -> usize {
    let mut end = path.len();
    while end > least && path[end - 1] == SLASH {
        end -= 1;
    }
    end
}

/// [`crate::basename_posix_t`] without a suffix.
#[inline(always)]
pub fn basename_posix_latin1(path: &[u8]) -> Range<usize> {
    let end = end_without_slashes(path, 0);
    last_slash(path, end).map_or(0, |slash| slash + 1)..end
}

/// [`crate::basename_posix_t`] with a suffix that is not empty and no longer than `path`.
#[inline(always)]
pub fn basename_without_suffix_posix_latin1(path: &[u8], suffix: &[u8]) -> Range<usize> {
    debug_assert!(!suffix.is_empty() && suffix.len() <= path.len());
    if suffix == path {
        return 0..0;
    }
    let name = basename_posix_latin1(path);
    // Node looks for the suffix and for the start of the name at once, from the end. Where the name runs out first and
    // was the end of the suffix so far, or there is no name, it has not noted where the name ends.
    if name.len() < suffix.len() {
        return if suffix.ends_with(&path[name.clone()]) {
            name.start..path.len()
        } else {
            name
        };
    }
    if name.len() > suffix.len() && path[..name.end].ends_with(suffix) {
        return name.start..name.end - suffix.len();
    }
    name
}

/// [`crate::dirname_posix_t`]: that many of the first characters, or a literal.
#[inline(always)]
pub fn dirname_posix_latin1(path: &[u8]) -> Result<usize, &'static [u8]> {
    if path.is_empty() {
        return Err(b".");
    }
    match last_slash(path, end_without_slashes(path, 1)) {
        None => Err(b"."),
        Some(0) => Err(b"/"),
        Some(1) if path[0] == SLASH => Err(b"//"),
        Some(end) => Ok(end),
    }
}

/// [`crate::extname_posix_t`]: from the last dot of the name, unless the name starts with it or is "..".
#[inline(always)]
pub fn extname_posix_latin1(path: &[u8]) -> Range<usize> {
    let end = end_without_slashes(path, 0);
    let Some(dot) = last_index_of_either(path, end, SLASH, DOT) else {
        return 0..0;
    };
    if path[dot] == SLASH || dot == 0 || path[dot - 1] == SLASH {
        return 0..0;
    }
    if dot + 1 == end && path[dot - 1] == DOT && (dot == 1 || path[dot - 2] == SLASH) {
        return 0..0;
    }
    dot..end
}

/// [`crate::parse_posix_t`].
pub struct ParsedPosixLatin1 {
    pub root: Range<usize>,
    pub dir: Range<usize>,
    pub base: Range<usize>,
    pub ext: Range<usize>,
    pub name: Range<usize>,
}

#[inline(always)]
pub fn parse_posix_latin1(path: &[u8]) -> ParsedPosixLatin1 {
    let root = usize::from(!path.is_empty() && path[0] == SLASH);
    let end = end_without_slashes(path, root);
    // The slash that is the root ends no folder.
    let slash = last_slash(path, end).filter(|&slash| slash >= root);
    let start = slash.map_or(root, |slash| slash + 1);
    // Node's `startPart`, which stays 0 for a name right behind the root: "/.." has the extension ".".
    let start_part = slash.map_or(0, |slash| slash + 1);
    let dot = last_index_of_either(path, end, SLASH, DOT).filter(|&dot| {
        dot > start
            && path[dot] == DOT
            && !(dot + 1 == end && dot == start_part + 1 && path[start_part] == DOT)
    });
    ParsedPosixLatin1 {
        root: 0..root,
        dir: 0..slash.unwrap_or(root),
        base: start..end,
        ext: dot.map_or(0..0, |dot| dot..end),
        name: start..dot.unwrap_or(end),
    }
}

/// How many characters `a` and `b` start with in common.
#[inline(always)]
fn common_prefix(a: &[u8], b: &[u8]) -> usize {
    let shorter = a.len().min(b.len());
    let mut at = 0;
    while at + 16 <= shorter {
        // SAFETY: at + 16 <= both lengths.
        let (x, y) = unsafe { (u8x16::from_array(read(a, at)), u8x16::from_array(read(b, at))) };
        let differs = x.simd_ne(y).to_bitmask();
        if differs != 0 {
            return at + differs.trailing_zeros() as usize;
        }
        at += 16;
    }
    while at < shorter && a[at] == b[at] {
        at += 1;
    }
    at
}

#[inline(always)]
fn count_slashes(path: &[u8]) -> usize {
    let mut count = 0;
    let mut at = 0;
    while at + 16 <= path.len() {
        // SAFETY: at + 16 <= path.len().
        let block = u8x16::from_array(unsafe { read(path, at) });
        count += block.simd_eq(u8x16::splat(SLASH)).to_bitmask().count_ones() as usize;
        at += 16;
    }
    while at < path.len() {
        count += usize::from(path[at] == SLASH);
        at += 1;
    }
    count
}

/// Whether [`crate::resolve_posix_t`] answers `path` as it is.
#[inline(always)]
pub fn is_resolved_posix(path: &[u8]) -> bool {
    !path.is_empty()
        && path[0] == SLASH
        && (path[path.len() - 1] != SLASH || path.len() == 1)
        && is_tidy_posix(path)
}

/// The answer is ".." `ups` times with slashes between them and then `to[rest..]`, which is empty or starts with a
/// slash unless `ups` is 0.
pub struct RelativePosixLatin1 {
    pub ups: usize,
    pub rest: usize,
}

/// [`crate::relative_posix_t`] of two paths that are [`is_resolved_posix`].
#[inline(always)]
pub fn relative_posix_latin1(from: &[u8], to: &[u8]) -> RelativePosixLatin1 {
    debug_assert!(is_resolved_posix(from) && is_resolved_posix(to));
    // Where the names of `from` start that are not in `to`, if there are any, and `rest`.
    let (left_from, rest) = 'found: {
        let common = common_prefix(from, to);
        if common == from.len() {
            if common == to.len() {
                break 'found (None, common);
            }
            // `to` is in the folder `from`.
            if to[common] == SLASH {
                break 'found (None, common + 1);
            }
            if common == 1 {
                break 'found (None, 1);
            }
        } else if common == to.len() {
            // `from` is in the folder `to`.
            if from[common] == SLASH {
                break 'found (Some(common + 1), common);
            }
            if common == 1 {
                break 'found (Some(1), 1);
            }
        }
        // In front of the first name that is not in both. At the least it is the root.
        let slash = last_slash(from, common).unwrap_or(0);
        (Some(slash + 1), slash)
    };
    RelativePosixLatin1 {
        ups: match left_from {
            Some(start) => 1 + count_slashes(&from[start..]),
            None => 0,
        },
        rest,
    }
}
