//! Node's `normalizeString`, for a path that has only one kind of separator.

use crate::{Unit, byte_at, leading_dots, scan};

/// In place. The answer is that many units from the start, and neither starts nor ends with a separator. `original` is what `path` is a copy of: to read what has just been written takes longer.
#[inline(always)]
pub(crate) fn normalize<U: Unit, const SEPARATOR: u8>(
    path: &mut [U],
    original: Option<&[U]>,
    allow_above_root: bool,
) -> usize {
    let names = original.unwrap_or(path);
    let mut limit = names.len();
    while limit > 0 && names[limit - 1].is(SEPARATOR) {
        limit -= 1;
    }
    let names = &names[..limit];
    let kept = if byte_at(names, 0) == SEPARATOR || leading_dots::<U, SEPARATOR>(names) != 0 {
        0
    } else {
        match scan::first_untidy::<U, SEPARATOR>(names) {
            Some(kept) => kept,
            None => return limit,
        }
    };
    let path = &mut path[..limit];
    match original {
        None => in_place::<U, SEPARATOR>(path, kept, allow_above_root),
        Some(original) => copy::<U, SEPARATOR>(path, &original[..limit], kept, allow_above_root),
    }
}

#[inline(never)]
fn in_place<U: Unit, const SEPARATOR: u8>(
    path: &mut [U],
    kept: usize,
    allow_above_root: bool,
) -> usize {
    normalize_behind::<U, SEPARATOR>(path, None, kept, allow_above_root)
}

#[inline(never)]
fn copy<U: Unit, const SEPARATOR: u8>(
    path: &mut [U],
    original: &[U],
    kept: usize,
    allow_above_root: bool,
) -> usize {
    normalize_behind::<U, SEPARATOR>(path, Some(original), kept, allow_above_root)
}

/// The first `kept` units are names that are in order, and `path` does not end with a separator.
#[inline(always)]
fn normalize_behind<U: Unit, const SEPARATOR: u8>(
    path: &mut [U],
    original: Option<&[U]>,
    kept: usize,
    allow_above_root: bool,
) -> usize {
    let limit = path.len();
    // `..floor` is the ".." that stay. What is written never overtakes what is read.
    let (mut read, mut written, mut floor) = (kept, kept, 0);
    while read < limit {
        let rest = &original.unwrap_or(path)[read..];
        if rest[0].is(SEPARATOR) {
            read += 1;
            continue;
        }
        let length = match leading_dots::<U, SEPARATOR>(rest) {
            1 => {
                read += 2;
                continue;
            }
            2 if written > floor => {
                let kept = scan::last::<U, SEPARATOR>(&path[floor..written]);
                written = floor + kept.unwrap_or(0);
                read += 3;
                continue;
            }
            2 if !allow_above_root => {
                read += 3;
                continue;
            }
            2 => {
                floor = written + usize::from(written != 0) + 2;
                2
            }
            _ => scan::first_untidy::<U, SEPARATOR>(rest).unwrap_or(rest.len()),
        };
        if written != 0 {
            path[written] = U::from_u8(SEPARATOR);
            written += 1;
        }
        if written != read {
            match original {
                None => path.copy_within(read..read + length, written),
                Some(original) => {
                    path[written..][..length].copy_from_slice(&original[read..][..length]);
                }
            }
        }
        written += length;
        read += length + 1;
    }
    written
}
