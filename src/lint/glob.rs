//! Converts glob patterns written for other tools into Bun's glob syntax.
//!
//! `bun_glob` has a single matcher. ESLint and its plugins use minimatch, and Prettier uses picomatch. Both parse a few
//! constructs differently from Bun. These helpers rewrite those constructs so the pattern keeps its meaning.

use crate::paths;
use bun_core::strings;
use bun_glob::matcher::class_end;
use bun_glob::{Dots, Pattern};
use std::borrow::Cow;

/// Marks the braces of every `{a}` group that has no comma and isn't a sequence like `{1..3}`.
/// Shells, minimatch and picomatch treat those braces as plain characters. Bun treats `{a}` as `a`.
fn literal_braces(pattern: &[u8]) -> Vec<bool> {
    let mut is_literal = vec![false; pattern.len()];
    // Open groups: the index of the `{`, and whether the group has a comma.
    let mut open: Vec<(usize, bool)> = Vec::new();
    let mut at = 0;
    while let Some(&byte) = pattern.get(at) {
        match byte {
            b'\\' => at += 1,
            b'[' => at = class_end(pattern, at).map_or(at, |end| end - 1),
            b'{' => open.push((at, false)),
            b',' => {
                if let Some(group) = open.last_mut() {
                    group.1 = true;
                }
            }
            b'}' => {
                if let Some((start, false)) = open.pop()
                    && !bun_glob::matcher::is_sequence(&pattern[start + 1..at])
                {
                    is_literal[start] = true;
                    is_literal[at] = true;
                }
            }
            _ => {}
        }
        at += 1;
    }
    is_literal
}

/// Rewrites what minimatch and picomatch agree on:
/// - `{a}` keeps its braces.
/// - `\n` is the letter `n`. Bun reads `\n`, `\t`, `\r` and `\b` as control characters.
///
/// With `is_minimatch`:
/// - A `*` that is a whole path segment needs at least one character, so `a/*` doesn't match `a/`.
/// - `a//b` is `a/b`.
fn common(pattern: &[u8], is_minimatch: bool, out: &mut Vec<u8>) {
    let is_literal = literal_braces(pattern);
    let mut at = 0;
    while let Some(&byte) = pattern.get(at) {
        let before = at.checked_sub(1).map(|it| pattern[it]);
        match byte {
            b'\\' => {
                match pattern.get(at + 1) {
                    Some(escaped) if escaped.is_ascii_alphanumeric() => out.push(*escaped),
                    Some(escaped) => out.extend_from_slice(&[b'\\', *escaped]),
                    None => out.push(b'\\'),
                }
                at += 2;
                continue;
            }
            b'[' => {
                if let Some(end) = class_end(pattern, at) {
                    out.extend_from_slice(&pattern[at..end]);
                    at = end;
                    continue;
                }
                out.push(byte);
            }
            b'{' | b'}' if is_literal[at] => out.extend_from_slice(&[b'\\', byte]),
            b'/' if is_minimatch && before == Some(b'/') => {}
            b'*' if is_minimatch
                && matches!(before, None | Some(b'/'))
                && matches!(pattern.get(at + 1), None | Some(b'/')) =>
            {
                out.extend_from_slice(b"?*");
            }
            _ => out.push(byte),
        }
        at += 1;
    }
}

/// Converts a minimatch pattern. [`Minimatch`] handles a leading `!` or `#` and the options.
pub fn from_minimatch(pattern: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pattern.len() + 4);
    common(pattern, true, &mut out);
    out
}

/// Returns the index after each path segment of `pattern` that ends outside of all groups.
fn segment_ends(pattern: &[u8]) -> Vec<usize> {
    let mut ends = Vec::new();
    let (mut at, mut depth) = (0, 0_usize);
    while let Some(&byte) = pattern.get(at) {
        match byte {
            b'\\' => at += 1,
            b'[' => at = class_end(pattern, at).map_or(at, |end| end - 1),
            b'{' | b'(' => depth += 1,
            b'}' | b')' => depth = depth.saturating_sub(1),
            b'/' if depth == 0 => ends.push(at),
            _ => {}
        }
        at += 1;
    }
    ends.push(pattern.len());
    ends
}

/// The minimatch options that the supported plugins can pass.
#[derive(Copy, Clone, Default)]
pub struct MinimatchOptions {
    pub dot: bool,
    pub nocomment: bool,
    pub nonegate: bool,
    pub flip_negate: bool,
    pub match_base: bool,
    pub nocase: bool,
    pub noext: bool,
    /// minimatch 3 trims the pattern, and on Windows it reads `\` in a pattern as a separator. Later versions do neither.
    pub is_version_3: bool,
}

/// `new Minimatch(pattern, options)`
pub struct Minimatch {
    /// The pattern without its leading `!`s. `None` for a `#` comment, which matches nothing.
    pattern: Option<Pattern>,
    is_negated: bool,
    /// For a negated pattern `a/b/c`: `a`, `a/b` and `a/b/c`. See [`Minimatch::may_match_inside`].
    prefixes: Vec<Pattern>,
    /// `matchBase` is set and the pattern has no `/`, so it only looks at the file name.
    matches_file_name: bool,
    /// `nocase` is set. The pattern is already lower case.
    folds_case: bool,
}

/// Escapes every `(` that isn't escaped yet, so that none of `?(` `*(` `+(` `@(` `!(` starts a group.
fn without_groups(pattern: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pattern.len() + 2);
    let mut rest = pattern.iter();
    while let Some(&byte) = rest.next() {
        match byte {
            b'\\' => {
                out.push(byte);
                out.extend(rest.next());
            }
            b'(' => out.extend_from_slice(b"\\("),
            _ => out.push(byte),
        }
    }
    out
}

impl Minimatch {
    pub fn with(written: &[u8], options: MinimatchOptions) -> Minimatch {
        let mut written = match options.is_version_3 {
            true => paths::from_native(strings::trim_js_whitespace(written)),
            false => written.to_vec(),
        };
        if options.nocase {
            written.make_ascii_lowercase();
        }
        let bangs = match options.nonegate {
            true => 0,
            false => written.iter().take_while(|it| **it == b'!').count(),
        };
        let mut text = from_minimatch(&written[bangs..]);
        if options.noext {
            text = without_groups(&text);
        }
        // Only `nonegate` leaves a `!` here. It's a plain character then.
        if text.starts_with(b"!") {
            text.insert(0, b'\\');
        }
        let parse = |text: &[u8]| match options.dot {
            true => Pattern::with_dots(text, Dots::SkipTraversal),
            false => Pattern::with_dots(text, Dots::Hide),
        };
        let is_negated = bangs % 2 == 1 && !options.flip_negate;
        let ends = segment_ends(&text).into_iter().filter(|_| is_negated);
        Minimatch {
            pattern: (options.nocomment || !written.starts_with(b"#")).then(|| parse(&text)),
            is_negated,
            prefixes: ends.map(|end| parse(&text[..end])).collect(),
            matches_file_name: options.match_base && !strings::contains_char(&written, b'/'),
            folds_case: options.nocase,
        }
    }

    /// `minimatch(path, pattern)` with minimatch 3, which eslint-plugin-import and eslint-plugin-react use.
    pub fn new(pattern: &[u8]) -> Minimatch {
        let is_version_3 = true;
        Minimatch::with(
            pattern,
            MinimatchOptions {
                is_version_3,
                ..MinimatchOptions::default()
            },
        )
    }

    /// `path` uses `/` as its separator.
    pub fn matches(&self, path: &[u8]) -> bool {
        let Some(pattern) = &self.pattern else {
            return false;
        };
        let path = match self.folds_case {
            true => Cow::Owned(path.to_ascii_lowercase()),
            false => Cow::Borrowed(path),
        };
        // `a` also matches `a/`.
        let without_slash = path.strip_suffix(b"/");
        let hit = match self.matches_file_name {
            true => pattern.matches(paths::file_name(&path)),
            false => pattern.matches(&path) || without_slash.is_some_and(|it| pattern.matches(it)),
        };
        hit != self.is_negated
    }

    /// `match(directory, true)`, minimatch's partial match. ESLint only enters a directory if this returns true.
    pub fn may_match_inside(&self, directory: &[u8]) -> bool {
        // A partial match means the directory matches the first segments of the pattern. `Pattern::may_match_inside` may say
        // yes too often, which is fine unless the answer is negated.
        self.pattern
            .as_ref()
            .is_some_and(|it| match self.is_negated {
                true => !self.prefixes.iter().any(|prefix| prefix.matches(directory)),
                false => it.matches(directory) || it.may_match_inside(directory),
            })
    }
}

/// Converts `1..3` from inside braces the way picomatch does. It builds the regex class `[1-3]` from the sorted parts.
/// If that class is invalid, the text matches literally, without the braces.
/// Returns `None` unless the parts are letters, digits and `-`.
fn picomatch_range(written: &[u8]) -> Option<Vec<u8>> {
    let mut parts: Vec<&[u8]> = strings::split(written, b"..").collect();
    let is_part = |it: &&[u8]| {
        !it.is_empty() && (it.iter()).all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
    };
    if parts.len() < 2 || !parts.iter().all(is_part) {
        return None;
    }
    let as_written = parts.join(&b".."[..]);
    bun_collections::index_sort::sort_slice(&mut parts[..]);
    let class = parts.join(&b'-');
    // `b-a` is a syntax error in a regex class.
    let mut at = 0;
    while at < class.len() {
        match class.get(at + 1..at + 3) {
            Some([b'-', to]) if class[at] > *to => return Some(as_written),
            Some([b'-', _]) => at += 3,
            _ => at += 1,
        }
    }
    Some([b"[", &class[..], b"]"].concat())
}

/// How Prettier hands a pattern to its matcher.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Picomatch {
    /// `micromatch.isMatch`, used for `overrides`. `{1..3}` becomes the class `[1-3]`.
    Micromatch,
    /// fast-glob, used for command line arguments. It expands braces first, so `{1..3}` is 1, 2 and 3.
    FastGlob,
}

/// Converts a picomatch pattern:
/// - A leading `./` is dropped.
/// - `(a|b)` is a group even without a prefix, so it becomes `@(a|b)`.
/// - `[id]` matches one of its characters or the literal text `[id]`, unless it contains a regex special character.
/// - `[!a]` is only a negated class for fast-glob. micromatch reads it as the characters `!` and `a`.
/// - `a/**` also matches `a` itself.
pub fn from_picomatch(pattern: &[u8], how: Picomatch) -> Vec<u8> {
    let pattern = pattern.strip_prefix(b"./").unwrap_or(pattern);
    let (written, is_deep) = match pattern.strip_suffix(b"/**") {
        Some(before) if !before.is_empty() && before != b"*" => (before, true),
        _ => (pattern, false),
    };
    let mut grouped = Vec::with_capacity(pattern.len() + 8);
    let mut at = 0;
    while let Some(&byte) = written.get(at) {
        let len = match byte {
            b'\\' => 2,
            b'[' => class_end(written, at).map_or(1, |end| end - at),
            _ => 1,
        };
        if byte == b'{'
            && how == Picomatch::Micromatch
            && let Some(close) = strings::index_of_any(&written[at + 1..], b"{},")
            && written[at + 1 + close] == b'}'
            && let Some(range) = picomatch_range(&written[at + 1..at + 1 + close])
        {
            grouped.extend_from_slice(&range);
            at += close + 2;
            continue;
        }
        if byte == b'['
            && len > 2
            && let inside = &written[at + 1..at + len - 1]
            && !(how == Picomatch::FastGlob && inside.starts_with(b"!"))
        {
            let is_also_literal = strings::index_of_any(inside, b"-*+?.^${}(|)[]\\/").is_none();
            if is_also_literal {
                grouped.extend_from_slice(b"@(\\[");
                for &it in inside {
                    if it.is_ascii_punctuation() {
                        grouped.push(b'\\');
                    }
                    grouped.push(it);
                }
                grouped.extend_from_slice(b"\\]|");
            }
            // Move a leading `!` to the end, where it's a plain member of the class.
            let bangs = inside.iter().take_while(|it| **it == b'!').count();
            match bangs == inside.len() {
                true => grouped.extend_from_slice(b"\\!"),
                false => {
                    grouped.extend_from_slice(
                        &[b"[", &inside[bangs..], &inside[..bangs], b"]"].concat(),
                    );
                }
            }
            if is_also_literal {
                grouped.push(b')');
            }
            at += len;
            continue;
        }
        if byte == b'('
            && !matches!(grouped.last(), Some(b'?' | b'*' | b'+' | b'@' | b'!'))
            && strings::contains_char(&written[at..], b')')
        {
            grouped.push(b'@');
        }
        grouped.extend_from_slice(&written[at..(at + len).min(written.len())]);
        at += len;
    }
    let mut out = Vec::with_capacity(grouped.len() + 8);
    common(&grouped, false, &mut out);
    if is_deep {
        out.extend_from_slice(b"{,/**}");
    }
    out
}

/// Appends `c` to a class, escaped if it means something there.
fn push_class_member(pattern: &mut Vec<u8>, c: &[u8]) {
    if matches!(c, b"\\" | b"]" | b"[" | b"-" | b"^" | b"!") {
        pattern.push(b'\\');
    }
    pattern.extend_from_slice(c);
}

/// globset's `parse_class` for the class that starts at `open`. It has no escapes, and a `]` or `-` right after the `[` is a member.
/// Appends the class to `pattern` and returns the index after the `]`. `Ok(None)` means the class isn't closed, `Err` means
/// it has a reversed range like `z-a`.
pub fn from_globset_class(
    written: &[u8],
    open: usize,
    has_literal_separator: bool,
    pattern: &mut Vec<u8>,
) -> Result<Option<usize>, ()> {
    let mut class = vec![b'['];
    let mut at = open + 1;
    if matches!(written.get(at), Some(b'!' | b'^')) {
        class.push(b'!');
        // With `literal_separator`, a class never matches `/`.
        if has_literal_separator {
            class.push(b'/');
        }
        at += 1;
    }
    let (mut is_first, mut is_in_range) = (true, false);
    let mut last: &[u8] = b"";
    loop {
        let Some(&byte) = written.get(at) else {
            return Ok(None);
        };
        let len = usize::from(strings::wtf8_byte_sequence_length(byte)).min(written.len() - at);
        let c = &written[at..at + len];
        at += len;
        match c {
            b"]" if !is_first => break,
            b"-" if !is_first && !is_in_range => is_in_range = true,
            _ if is_in_range => {
                if c < last {
                    return Err(());
                }
                class.push(b'-');
                push_class_member(&mut class, c);
                is_in_range = false;
            }
            _ => {
                push_class_member(&mut class, c);
                last = c;
            }
        }
        is_first = false;
    }
    if is_in_range {
        class.extend_from_slice(b"\\-");
    }
    class.push(b']');
    pattern.extend_from_slice(&class);
    Ok(Some(at))
}

/// globset drops empty alternatives, so `{a,}` is `a`. Removes them from a converted pattern.
pub fn without_empty_alternatives(pattern: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pattern.len());
    let (mut at, mut depth) = (0, 0_usize);
    // Length of `out` right after the latest `{` or `,` of a group.
    let mut alternative_start = usize::MAX;
    while let Some(&byte) = pattern.get(at) {
        let len = match byte {
            b'\\' => 2,
            b'[' => class_end(pattern, at).map_or(1, |end| end - at),
            _ => 1,
        };
        match byte {
            b'{' => {
                depth += 1;
                out.push(byte);
                alternative_start = out.len();
            }
            b',' if depth > 0 => {
                if alternative_start != out.len() {
                    out.push(byte);
                }
                alternative_start = out.len();
            }
            b'}' if depth > 0 => {
                depth -= 1;
                if alternative_start == out.len() && out.ends_with(b",") {
                    out.pop();
                }
                out.push(byte);
            }
            _ => out.extend_from_slice(&pattern[at..(at + len).min(pattern.len())]),
        }
        at += len;
    }
    out
}
