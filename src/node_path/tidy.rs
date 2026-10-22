//! `path.posix` for 8-bit characters, eight of them at a time. Each function answers what the one it names in the
//! crate root answers. Only '/' and '.' are looked for, so the characters may be ASCII, Latin-1 or UTF-8.

use core::mem::MaybeUninit;
use core::ops::Range;

const SLASH: u8 = b'/';
const DOT: u8 = b'.';

/// Eight characters in a word, the first of them in its lowest byte.
#[derive(Clone, Copy)]
struct Block(u64);

/// The highest bit of the byte of each character that was looked for.
type Found = u64;

const WIDTH: usize = 8;
const LOWEST_BITS: u64 = 0x0101_0101_0101_0101;
const ALL_BUT_HIGHEST_BITS: u64 = 0x7f7f_7f7f_7f7f_7f7f;

impl Block {
    /// # Safety
    /// The characters `at..at + WIDTH` are in `path`.
    #[inline(always)]
    unsafe fn read(path: &[u8], at: usize) -> Block {
        debug_assert!(at + WIDTH <= path.len());
        // SAFETY: forwarded.
        let bytes = unsafe { path.as_ptr().add(at).cast::<[u8; WIDTH]>().read_unaligned() };
        Block(u64::from_le_bytes(bytes))
    }

    #[inline(always)]
    fn find(self, character: u8) -> Found {
        let difference = self.0 ^ (LOWEST_BITS * u64::from(character));
        // No sum carries into the next byte. It has the highest bit of a byte whose other bits are not all 0.
        let has_lower_bits = (difference & ALL_BUT_HIGHEST_BITS) + ALL_BUT_HIGHEST_BITS;
        !(has_lower_bits | difference | ALL_BUT_HIGHEST_BITS)
    }

    /// '.' is '/' without its lowest bit.
    #[inline(always)]
    fn find_slash_or_dot(self) -> Found {
        const { assert!(DOT | 1 == SLASH) };
        Block(self.0 | LOWEST_BITS).find(SLASH)
    }
}

#[inline(always)]
fn first_of(found: Found) -> usize {
    found.trailing_zeros() as usize / 8
}

#[inline(always)]
fn last_of(found: Found) -> usize {
    found.ilog2() as usize / 8
}

/// Whether the part of `path` that starts at `start` is "." or "..".
#[inline(always)]
fn is_dots_at(path: &[u8], start: usize) -> bool {
    matches!(
        &path[start..],
        [DOT] | [DOT, SLASH, ..] | [DOT, DOT] | [DOT, DOT, SLASH, ..]
    )
}

/// `path` has more than `WIDTH` characters.
#[inline(always)]
fn is_tidy_by_blocks(path: &[u8]) -> bool {
    let last = path.len() - WIDTH - 1;
    let mut at = 0;
    loop {
        // SAFETY: at <= last, so the characters at..at + WIDTH + 1 are in `path`.
        let (here, next) = unsafe { (Block::read(path, at), Block::read(path, at + 1)) };
        // One bit for each '/' with a '/' or a '.' after it.
        let mut suspects = here.find(SLASH) & next.find_slash_or_dot();
        while suspects != 0 {
            let after_slash = at + first_of(suspects) + 1;
            if path[after_slash] == SLASH || is_dots_at(path, after_slash) {
                return false;
            }
            suspects &= suspects - 1;
        }
        if at == last {
            return true;
        }
        at = (at + WIDTH).min(last);
    }
}

/// Whether no part of `path` between two slashes is empty, "." or "..". [`crate::normalize_posix_t`]
/// answers such a path as it is, whether or not it starts or ends with a slash.
#[inline(always)]
pub fn is_tidy_posix(path: &[u8]) -> bool {
    let len = path.len();
    if len == 0 || (path[0] == DOT && is_dots_at(path, 0)) {
        return false;
    }
    if len > WIDTH {
        return is_tidy_by_blocks(path);
    }
    for at in 1..len {
        if path[at - 1] == SLASH && (path[at] == SLASH || is_dots_at(path, at)) {
            return false;
        }
    }
    true
}

/// The first '/' of `path[*at..limit]` in front of a part that is empty, "." or "..". Without one, `*at` is where
/// fewer than `WIDTH` characters and one more are left.
#[inline(always)]
fn first_untidy_slash_by_blocks(path: &[u8], at: &mut usize, limit: usize) -> Option<usize> {
    while *at + WIDTH < limit {
        // SAFETY: the characters *at..*at + WIDTH + 1 are in `path[..limit]`.
        let (here, next) = unsafe { (Block::read(path, *at), Block::read(path, *at + 1)) };
        let mut suspects = here.find(SLASH) & next.find_slash_or_dot();
        while suspects != 0 {
            let found = *at + first_of(suspects);
            if path[found + 1] == SLASH || is_dots_at(path, found + 1) {
                return Some(found);
            }
            suspects &= suspects - 1;
        }
        *at += WIDTH;
    }
    None
}

/// Where the parts from `start` on that are kept as they are end: at a '/' in front of a part that is empty, "." or "..",
/// or at `limit`, which is not behind a slash.
#[inline(always)]
fn end_of_tidy_parts(path: &[u8], start: usize, limit: usize) -> usize {
    let mut at = start;
    if let Some(found) = first_untidy_slash_by_blocks(path, &mut at, limit) {
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
    unsafe {
        core::slice::from_raw_parts(buffer.as_ptr().cast::<u8>().add(start), 1 + length - start)
    }
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

/// The last of `path[..end]` that `find` finds in a block and `is_found` says it is.
#[inline(always)]
fn last_index_of(
    path: &[u8],
    mut end: usize,
    find: impl Fn(Block) -> Found,
    is_found: impl Fn(u8) -> bool,
) -> Option<usize> {
    debug_assert!(end <= path.len());
    while end >= WIDTH {
        // SAFETY: WIDTH <= end <= path.len().
        let found = find(unsafe { Block::read(path, end - WIDTH) });
        if found != 0 {
            return Some(end - WIDTH + last_of(found));
        }
        end -= WIDTH;
    }
    while end > 0 {
        end -= 1;
        if is_found(path[end]) {
            return Some(end);
        }
    }
    None
}

#[inline(always)]
fn last_slash(path: &[u8], end: usize) -> Option<usize> {
    last_index_of(
        path,
        end,
        |block| block.find(SLASH),
        |character| character == SLASH,
    )
}

#[inline(always)]
fn last_slash_or_dot(path: &[u8], end: usize) -> Option<usize> {
    last_index_of(path, end, Block::find_slash_or_dot, |character| {
        character == SLASH || character == DOT
    })
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

/// How many characters `a` and `b` start with in common.
#[inline(always)]
fn common_prefix(a: &[u8], b: &[u8]) -> usize {
    let shorter = a.len().min(b.len());
    let mut at = 0;
    while at + WIDTH <= shorter {
        // SAFETY: at + WIDTH <= both lengths.
        let (x, y) = unsafe { (Block::read(a, at), Block::read(b, at)) };
        let difference = x.0 ^ y.0;
        if difference != 0 {
            return at + first_of(difference);
        }
        at += WIDTH;
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
    while at + WIDTH <= path.len() {
        // SAFETY: at + WIDTH <= path.len().
        let block = unsafe { Block::read(path, at) };
        count += block.find(SLASH).count_ones() as usize;
        at += WIDTH;
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
