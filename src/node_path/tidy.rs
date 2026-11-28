//! `path.posix` for 8-bit characters. What looks at all of them is a kernel of `bun_simd_kernels`.
#![forbid(unsafe_code)]

use bun_simd::mem::Output;
use core::mem::MaybeUninit;
use core::ops::Range;

const SLASH: u8 = b'/';
const DOT: u8 = b'.';

pub use bun_simd_kernels::is_ascii_path as is_ascii;

/// Whether the part of `path` that starts at `start` is "." or "..".
#[inline(always)]
fn is_dots_at(path: &[u8], start: usize) -> bool {
    matches!(
        &path[start..],
        [DOT] | [DOT, SLASH, ..] | [DOT, DOT] | [DOT, DOT, SLASH, ..]
    )
}

/// Whether every character of `path` is ASCII and no part between two slashes is empty, "." or "..".
#[inline(always)]
pub fn is_tidy_ascii_posix(path: &[u8]) -> bool {
    !path.is_empty()
        && !(path[0] == DOT && is_dots_at(path, 0))
        && bun_simd_kernels::index_of_untidy_slash_or_non_ascii(path).is_none()
}

/// Where the parts from `start` on that are kept as they are end: at a '/' in front of a part that is empty, "." or "..", or at `limit`, which is not behind a slash.
#[inline(always)]
fn end_of_tidy_parts(path: &[u8], start: usize, limit: usize) -> usize {
    bun_simd_kernels::index_of_untidy_slash(&path[start..limit])
        .map_or(limit, |found| start + found)
}

/// A '/' and then `normalize_string_t` in the crate root, with '/'. What is written after the first '/' is no longer than what was read.
#[inline(always)]
fn normalize_string_posix_latin1<'b>(
    path: &[u8],
    allow_above_root: bool,
    to: &'b mut [MaybeUninit<u8>],
) -> Output<'b, u8> {
    let mut to = Output::new(to);
    to.push_one(SLASH);
    let limit = end_without_slashes(path, 0);
    let (path, mut at) = (&path[..limit], 0);
    while at < limit {
        if path[at] == SLASH {
            at += 1;
            // The last character is not a slash.
            while path[at] == SLASH {
                at += 1;
            }
        }
        if path[at] == DOT {
            if at + 1 == limit || path[at + 1] == SLASH {
                at += 2;
                continue;
            }
            if path[at + 1] == DOT && (at + 2 == limit || path[at + 2] == SLASH) {
                at += 3;
                let written = to.filled();
                if written.len() > 1 && !matches!(written, [.., SLASH, DOT, DOT]) {
                    let length = last_slash(written, written.len()).unwrap_or(0);
                    to.truncate(length.max(1));
                } else if allow_above_root {
                    if to.len() > 1 {
                        to.push_one(SLASH);
                    }
                    to.push(&[DOT, DOT]);
                }
                continue;
            }
        }
        let end = end_of_tidy_parts(path, at, limit);
        if to.len() > 1 {
            to.push_one(SLASH);
        }
        to.push(&path[at..end]);
        at = end + 1;
    }
    to
}

/// [`crate::normalize_posix_t`]. `buffer` has room for two characters more than `path` has.
#[inline]
pub fn normalize_posix_latin1<'b>(path: &[u8], buffer: &'b mut [MaybeUninit<u8>]) -> &'b [u8] {
    if path.is_empty() {
        return b".";
    }
    let is_absolute = path[0] == SLASH;
    let ends_with_slash = path[path.len() - 1] == SLASH;
    let mut normalized = normalize_string_posix_latin1(path, !is_absolute, buffer);
    if normalized.len() == 1 {
        return match (is_absolute, ends_with_slash) {
            (true, _) => b"/",
            (false, true) => b"./",
            (false, false) => b".",
        };
    }
    if ends_with_slash {
        normalized.push_one(SLASH);
    }
    &normalized.into_filled()[usize::from(!is_absolute)..]
}

/// [`crate::resolve_posix_t`] of one path that is absolute. `buffer` has room for one character more than `path` has.
#[inline]
pub fn resolve_absolute_posix_latin1<'b>(
    path: &[u8],
    buffer: &'b mut [MaybeUninit<u8>],
) -> &'b [u8] {
    debug_assert!(path[0] == SLASH);
    normalize_string_posix_latin1(path, false, buffer).into_filled()
}

#[inline(always)]
fn last_slash(path: &[u8], end: usize) -> Option<usize> {
    bun_simd_kernels::last_index_of_slash(&path[..end])
}

#[inline(always)]
fn last_slash_or_dot(path: &[u8], end: usize) -> Option<usize> {
    bun_simd_kernels::last_index_of_slash_or_dot(&path[..end])
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
    // Node looks for the suffix and for the start of the name at once, from the end.
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
    let Some(dot) = last_slash_or_dot(path, end) else {
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
    let dot = last_slash_or_dot(path, end).filter(|&dot| {
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

/// Whether every character of `path` is ASCII and [`crate::resolve_posix_t`] answers `path` as it is.
#[inline(always)]
pub fn is_resolved_ascii_posix(path: &[u8]) -> bool {
    !path.is_empty()
        && path[0] == SLASH
        && (path[path.len() - 1] != SLASH || path.len() == 1)
        && is_tidy_ascii_posix(path)
}

/// The answer is ".." `ups` times with slashes between them and then `to[rest..]`, which is empty or starts with a slash unless `ups` is 0.
pub struct RelativePosixLatin1 {
    pub ups: usize,
    pub rest: usize,
}

/// [`crate::relative_posix_t`] of two paths that are [`is_resolved_ascii_posix`].
#[inline(always)]
pub fn relative_posix_latin1(from: &[u8], to: &[u8]) -> RelativePosixLatin1 {
    debug_assert!(is_resolved_ascii_posix(from) && is_resolved_ascii_posix(to));
    // Where the names of `from` start that are not in `to`, if there are any, and `rest`.
    let (left_from, rest) = 'found: {
        let common = bun_simd_kernels::common_prefix_length(from, to);
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
            Some(start) => 1 + bun_simd_kernels::count_slashes(&from[start..]),
            None => 0,
        },
        rest,
    }
}
