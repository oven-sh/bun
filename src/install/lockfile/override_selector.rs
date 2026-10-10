use bun_core::strings;

use crate::dependency::{Dependency, DependencyExt as _};

#[derive(Clone, Copy)]
pub(crate) struct PackageSelector<'a> {
    pub name: &'a [u8],
    /// Empty when the rule applies to every version of `name`.
    pub range: &'a [u8],
}

pub(crate) struct Selector<'a> {
    pub parent: Option<PackageSelector<'a>>,
    pub target: PackageSelector<'a>,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum SelectorError {
    EmptyName,
    InvalidName,
    TooDeep,
    EmptyRange,
}

fn is_bare_scope(name: &[u8]) -> bool {
    name.starts_with(b"@") && !strings::contains_char(name, b'/')
}

pub(crate) fn parse_package_segment(segment: &[u8]) -> Result<PackageSelector<'_>, SelectorError> {
    if segment.is_empty() {
        return Err(SelectorError::EmptyName);
    }
    let (name, range) = Dependency::split_name_and_maybe_version(segment);
    if name.is_empty() {
        return Err(SelectorError::EmptyName);
    }
    if is_bare_scope(name) {
        return Err(SelectorError::InvalidName);
    }
    let range = strings::without_prefix(range.unwrap_or(b""), b"npm:");
    if range.is_empty() && segment.len() > name.len() {
        return Err(SelectorError::EmptyRange);
    }
    Ok(PackageSelector { name, range })
}

pub(crate) fn parse_selector(key: &[u8]) -> Result<Selector<'_>, SelectorError> {
    if key.starts_with(b"//") {
        return Ok(Selector {
            parent: None,
            target: PackageSelector {
                name: key,
                range: b"",
            },
        });
    }
    if let Some(delimiter) = pnpm_delimiter(key) {
        return parse_pnpm(key, delimiter);
    }
    parse_yarn_path(key)
}

/// pnpm's `parent>child` delimiter (`/[^ |@]>/`): the first `>` not preceded by a space, `|` or `@`.
fn pnpm_delimiter(key: &[u8]) -> Option<usize> {
    let mut from = 1;
    while from < key.len() {
        let i = from + strings::index_of_char_usize(&key[from..], b'>')?;
        match key[i - 1] {
            b' ' | b'|' | b'@' => from = i + 1,
            _ => return Some(i),
        }
    }
    None
}

fn parse_pnpm(key: &[u8], delimiter: usize) -> Result<Selector<'_>, SelectorError> {
    let parent = key[..delimiter].trim_ascii();
    let name = key[delimiter + 1..].trim_ascii();
    if name.is_empty() {
        return Err(SelectorError::EmptyName);
    }
    if pnpm_delimiter(name).is_some() {
        return Err(SelectorError::TooDeep);
    }
    let parent = parse_package_segment(parent)?;
    Ok(Selector {
        parent: Some(parent),
        target: parse_package_segment(name)?,
    })
}

/// Next `/`-delimited token of `key` starting at `pos`, and the position after its delimiter.
fn next_token(key: &[u8], pos: usize) -> (&[u8], Option<usize>) {
    match strings::index_of_char_usize(&key[pos..], b'/') {
        Some(i) => (&key[pos..pos + i], Some(pos + i + 1)),
        None => (&key[pos..], None),
    }
}

fn parse_yarn_path(key: &[u8]) -> Result<Selector<'_>, SelectorError> {
    let mut segments: [&[u8]; 2] = [b"", b""];
    let mut count = 0usize;
    let mut cursor = Some(0usize);
    while let Some(start) = cursor {
        let (token, next) = next_token(key, start);
        cursor = next;
        if token.is_empty() {
            return Err(SelectorError::EmptyName);
        }
        if token == b"**" {
            if next.is_none() {
                return Err(SelectorError::EmptyName);
            }
            continue;
        }
        let mut end = start + token.len();
        if token.starts_with(b"@") {
            let Some(name_start) = next else {
                return Err(SelectorError::InvalidName);
            };
            let (name, after) = next_token(key, name_start);
            cursor = after;
            if name.is_empty() {
                return Err(SelectorError::EmptyName);
            }
            end = name_start + name.len();
        }
        if count == segments.len() {
            return Err(SelectorError::TooDeep);
        }
        segments[count] = &key[start..end];
        count += 1;
    }

    match count {
        0 => Err(SelectorError::EmptyName),
        1 => Ok(Selector {
            parent: None,
            target: parse_package_segment(segments[0])?,
        }),
        _ => {
            let parent = parse_package_segment(segments[0])?;
            Ok(Selector {
                parent: Some(parent),
                target: parse_package_segment(segments[1])?,
            })
        }
    }
}
