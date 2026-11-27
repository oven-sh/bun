//! <https://github.com/nodejs/node/blob/v26.12.1/lib/path.js#L91-L154>, for a path with one kind of separator.

use crate::{CodeUnit, byte_at, dot_segment_len, scan};

/// Works in place and returns the new length. If `path` is a copy of `original`, reading that avoids store-forwarding stalls.
#[inline(always)]
pub(crate) fn normalize_string<U: CodeUnit, const SEPARATOR: u8>(
    path: &mut [U],
    original: Option<&[U]>,
    allow_above_root: bool,
) -> usize {
    let source = original.unwrap_or(path);
    let mut end = source.len();
    while end > 0 && source[end - 1].eq_ascii(SEPARATOR) {
        end -= 1;
    }
    let source = &source[..end];
    let starts_untidy =
        byte_at(source, 0) == SEPARATOR || dot_segment_len::<U, SEPARATOR>(source) != 0;
    let tidy_len = if starts_untidy {
        0
    } else {
        match scan::index_of_untidy_sep::<U, SEPARATOR>(source) {
            Some(tidy_len) => tidy_len,
            None => return end,
        }
    };
    let path = &mut path[..end];
    match original {
        None => reading_self::<U, SEPARATOR>(path, tidy_len, allow_above_root),
        Some(original) => {
            reading_original::<U, SEPARATOR>(path, &original[..end], tidy_len, allow_above_root)
        }
    }
}

#[inline(never)]
fn reading_self<U: CodeUnit, const SEPARATOR: u8>(
    path: &mut [U],
    tidy_len: usize,
    allow_above_root: bool,
) -> usize {
    normalize_from::<U, SEPARATOR>(path, None, tidy_len, allow_above_root)
}

#[inline(never)]
fn reading_original<U: CodeUnit, const SEPARATOR: u8>(
    path: &mut [U],
    original: &[U],
    tidy_len: usize,
    allow_above_root: bool,
) -> usize {
    normalize_from::<U, SEPARATOR>(path, Some(original), tidy_len, allow_above_root)
}

#[inline(always)]
fn normalize_from<U: CodeUnit, const SEPARATOR: u8>(
    path: &mut [U],
    original: Option<&[U]>,
    tidy_len: usize,
    allow_above_root: bool,
) -> usize {
    debug_assert!(!path.last().is_some_and(|last| last.eq_ascii(SEPARATOR)));
    let end = path.len();
    let (mut read, mut written) = (tidy_len, tidy_len);
    // `path[..floor]` holds the leading ".." segments, which a later ".." cannot cancel.
    let mut floor = 0;
    while read < end {
        debug_assert!(written <= read);
        let rest = &original.unwrap_or(path)[read..];
        if rest[0].eq_ascii(SEPARATOR) {
            read += 1;
            continue;
        }
        let len = match dot_segment_len::<U, SEPARATOR>(rest) {
            1 => {
                read += "./".len();
                continue;
            }
            2 if written > floor => {
                let parent_len = scan::last_index_of_sep::<U, SEPARATOR>(&path[floor..written]);
                written = floor + parent_len.unwrap_or(0);
                read += "../".len();
                continue;
            }
            2 if !allow_above_root => {
                read += "../".len();
                continue;
            }
            2 => {
                floor = written + usize::from(written != 0) + "..".len();
                "..".len()
            }
            _ => scan::index_of_untidy_sep::<U, SEPARATOR>(rest).unwrap_or(rest.len()),
        };
        if written != 0 {
            path[written] = U::from_u8(SEPARATOR);
            written += 1;
        }
        if written != read {
            match original {
                None => path.copy_within(read..read + len, written),
                Some(original) => path[written..][..len].copy_from_slice(&original[read..][..len]),
            }
        }
        written += len;
        read += len + 1;
    }
    written
}
