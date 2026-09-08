//! The getter half of npm's `lib/utils/queryable.js`, over `bun_ast::Expr`.
//! This is the property-path grammar of `npm view` and `npm pkg get`:
//!
//! - `a.b.c` steps into objects, `a.0` / `a[0]` into arrays (or an object key `0`)
//! - text inside `[...]` is one key taken literally, so it may contain dots:
//!   `exports[./package.json]`, `time[1.2.3]`
//! - a property after an array reads that property from every element:
//!   `maintainers.name` yields `maintainers[0].name`, `maintainers[1].name`, ...
//! - `a[]` is append syntax for the setter and an error for a getter

use std::io::Write as _;

use bun_alloc::Arena as Bump;
use bun_ast::Expr;
use bun_core::fmt as bun_fmt;
use bun_core::strings;

pub(crate) struct FieldResult<'a> {
    /// The path as typed, or `a[0].b` style when an array was expanded.
    pub label: &'a [u8],
    pub value: Expr,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FieldPathError {
    /// `a[]`: "Empty brackets are not valid syntax for retrieving values."
    EmptyBrackets,
}

/// Split `path` into keys. Text inside `[...]` is one key; everything else
/// splits on `.`.
pub(crate) fn parse(path: &[u8]) -> Result<Vec<&[u8]>, FieldPathError> {
    let mut keys: Vec<&[u8]> = Vec::new();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < path.len() {
        match path[i] {
            b'.' => {
                keys.push(&path[start..i]);
                i += 1;
                start = i;
            }
            b'[' => {
                let Some(close) = strings::index_of_char_usize(&path[i + 1..], b']') else {
                    i += 1;
                    continue;
                };
                let close = i + 1 + close;
                if close == i + 1 {
                    return Err(FieldPathError::EmptyBrackets);
                }
                if i > start {
                    keys.push(&path[start..i]);
                }
                keys.push(&path[i + 1..close]);
                i = close + 1;
                if i < path.len() && path[i] == b'.' {
                    i += 1;
                }
                start = i;
            }
            _ => i += 1,
        }
    }
    if start < path.len() {
        keys.push(&path[start..]);
    }
    Ok(keys)
}

/// Resolve `path` against `root` and append what it names to `out`: nothing
/// when the path does not exist, one result, or one per array element.
/// A result whose label is already in `out` replaces the earlier value.
/// Expanded labels are allocated in `bump`; other labels borrow `path`.
pub(crate) fn query<'a>(
    bump: &'a Bump,
    root: Expr,
    path: &'a [u8],
    out: &mut Vec<FieldResult<'a>>,
) -> Result<(), FieldPathError> {
    let keys = parse(path)?;
    if keys.is_empty() {
        return Ok(());
    }
    let mut label: Vec<u8> = Vec::new();
    walk(bump, root, &keys, &mut label, false, path, out);
    Ok(())
}

fn walk<'a>(
    bump: &'a Bump,
    mut value: Expr,
    keys: &[&[u8]],
    label: &mut Vec<u8>,
    expanded: bool,
    path: &'a [u8],
    out: &mut Vec<FieldResult<'a>>,
) {
    for (i, key) in keys.iter().enumerate() {
        let index = array_index(key);
        if value.is_array() && index.is_none() {
            let label_len = label.len();
            let mut items = value.as_array();
            let mut n = 0usize;
            while let Some(item) = items.as_mut().and_then(|it| it.next()) {
                label.truncate(label_len);
                let _ = write!(label, "[{n}]");
                walk(bump, item, &keys[i..], label, true, path, out);
                n += 1;
            }
            label.truncate(label_len);
            return;
        }
        let next = match index {
            Some(index) if value.is_array() => nth(value, index),
            _ if value.is_object() => value.get(key),
            _ => None,
        };
        let Some(next) = next else {
            return;
        };
        append_key(label, key, index.is_some() && value.is_array());
        value = next;
    }
    let label: &'a [u8] = if expanded {
        bump.alloc_slice_copy(label)
    } else {
        path
    };
    for existing in out.iter_mut() {
        if existing.label == label {
            existing.value = value;
            return;
        }
    }
    out.push(FieldResult { label, value });
}

fn array_index(key: &[u8]) -> Option<usize> {
    if key.is_empty() || !key.iter().all(u8::is_ascii_digit) {
        return None;
    }
    bun_fmt::parse_decimal::<usize>(key)
}

fn nth(array: Expr, index: usize) -> Option<Expr> {
    let mut iter = array.as_array()?;
    let mut i = 0usize;
    while let Some(item) = iter.next() {
        if i == index {
            return Some(item);
        }
        i += 1;
    }
    None
}

fn append_key(label: &mut Vec<u8>, key: &[u8], is_index: bool) {
    if is_index || strings::index_of_any(key, b".[]").is_some() || key.is_empty() {
        label.push(b'[');
        label.extend_from_slice(key);
        label.push(b']');
    } else {
        if !label.is_empty() {
            label.push(b'.');
        }
        label.extend_from_slice(key);
    }
}
