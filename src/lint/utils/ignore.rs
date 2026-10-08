//! The npm package `ignore`: the patterns of a `.gitignore` file. `no-restricted-imports` and
//! `no-restricted-modules` match module specifiers with it.

use super::text;
use crate::regex::Regex;
use bun_core::strings;

/// Which major version of the npm package `ignore` to behave as. ESLint depends on 5,
/// typescript-eslint on 7.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum IgnoreVersion {
    V5,
    V7,
}

/// `ignore({ allowRelativePaths: true, ignoreCase }).add(patterns)` of the npm package `ignore`:
/// the patterns of a `.gitignore` file.
pub struct Ignore {
    rules: Vec<IgnoreRule>,
    version: IgnoreVersion,
}

struct IgnoreRule {
    is_negative: bool,
    regex: Regex,
}

impl Ignore {
    pub fn new(patterns: &[&str], ignores_case: bool, version: IgnoreVersion) -> Ignore {
        let mut rules = Vec::with_capacity(patterns.len());
        for &pattern in patterns {
            let bytes = pattern.as_bytes();
            let has_trailing_backslash = bytes.ends_with(b"\\") && !bytes.ends_with(b"\\\\");
            if text::is_blank(bytes) || has_trailing_backslash || bytes.starts_with(b"#") {
                continue;
            }
            let (is_negative, body) = match pattern.strip_prefix('!') {
                Some(rest) => (true, rest),
                None => (false, pattern),
            };
            let body = match body.strip_prefix('\\') {
                Some(rest) if rest.starts_with(['!', '#']) => rest,
                _ => body,
            };
            let flags = if ignores_case { "i" } else { "" };
            if let Ok(regex) = Regex::new(&ignore_regex_source(body, version), flags) {
                rules.push(IgnoreRule { is_negative, regex });
            }
        }
        Ignore { rules, version }
    }

    /// `_testOne(path, false).ignored`
    fn test_one(&self, path: &[u8]) -> bool {
        let mut is_ignored = false;
        for rule in &self.rules {
            if rule.is_negative == is_ignored && rule.regex.test(path) {
                is_ignored = !rule.is_negative;
            }
        }
        is_ignored
    }

    /// `ignores(path)`: whether a pattern matches `path` or a directory that it is in.
    pub fn ignores(&self, path: &[u8]) -> bool {
        match self.version {
            IgnoreVersion::V5 => {
                let mut at = 0;
                while let Some(slash) = strings::index_of_char_usize(&path[at..], b'/') {
                    at += slash + 1;
                    if self.test_one(&path[..at]) {
                        return true;
                    }
                }
            }
            // Empty segments are left out of the directories.
            IgnoreVersion::V7 => {
                let mut segments = strings::split(path, b"/")
                    .filter(|it| !it.is_empty())
                    .peekable();
                let mut parent = Vec::with_capacity(path.len());
                while let Some(segment) = segments.next() {
                    if segments.peek().is_none() {
                        break;
                    }
                    parent.extend_from_slice(segment);
                    parent.push(b'/');
                    if self.test_one(&parent) {
                        return true;
                    }
                }
            }
        }
        self.test_one(path)
    }
}

fn has_at(s: &[char], at: usize, literal: &str) -> bool {
    let mut rest = s.get(at..).unwrap_or_default().iter();
    literal.chars().all(|c| rest.next() == Some(&c))
}

fn is_space(c: char) -> bool {
    text::is_js_whitespace(c as u32)
}

/// The number of `\` that `s` starts with.
fn leading_backslashes(s: &[char]) -> usize {
    s.iter().take_while(|c| **c == '\\').count()
}

/// The number of `\` that `s` ends with.
fn trailing_backslashes(s: &[char]) -> usize {
    s.iter().rev().take_while(|c| **c == '\\').count()
}

/// `sanitizeRange`: without the `b-a` that a regular expression rejects.
fn sanitize_range(range: &[char]) -> Vec<char> {
    let is_bound = |c: Option<&char>| c.is_some_and(|c| ('0'..='z').contains(c));
    let mut out = Vec::with_capacity(range.len());
    let mut i = 0;
    while i < range.len() {
        if is_bound(range.get(i)) && range.get(i + 1) == Some(&'-') && is_bound(range.get(i + 2)) {
            if range[i] <= range[i + 2] {
                out.extend_from_slice(&range[i..i + 3]);
            }
            i += 3;
        } else {
            out.push(range[i]);
            i += 1;
        }
    }
    out
}

/// `makeRegex(pattern).source`: each block is one or several of the `REPLACERS`, in their order.
fn ignore_regex_source(pattern: &str, version: IgnoreVersion) -> String {
    let pattern: Vec<char> = pattern.chars().collect();
    let mut s = pattern.clone();

    if s.first() == Some(&'\u{FEFF}') {
        s.remove(0);
    }

    // Trailing spaces are ignored unless they are quoted with a backslash.
    let end = s.len() - s.iter().rev().take_while(|c| is_space(**c)).count();
    if end < s.len() {
        s.truncate(end);
        if trailing_backslashes(&s) % 2 == 1 {
            s.pop();
            s.push(' ');
        }
    }

    // `\ ` is a space.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        let backslashes = leading_backslashes(&s[i..]);
        if backslashes == 0 {
            out.push(s[i]);
            i += 1;
            continue;
        }
        i += backslashes;
        let is_before_space = s.get(i).is_some_and(|c| is_space(*c));
        let kept = if is_before_space {
            backslashes - backslashes % 2
        } else {
            backslashes
        };
        out.extend(std::iter::repeat_n('\\', kept));
        if is_before_space {
            out.push(' ');
            i += 1;
        }
    }
    s = out;

    // Metacharacters are escaped, `?` is any character of a name, a leading `/` is the start.
    let mut out = Vec::with_capacity(s.len() * 2);
    for (i, &c) in s.iter().enumerate() {
        match c {
            '\\' | '$' | '.' | '|' | '*' | '+' | '(' | ')' | '{' | '^' => out.extend(['\\', c]),
            '?' => out.extend("[^\\/]".chars()),
            '/' if i == 0 => out.push('^'),
            '/' => out.extend(['\\', '/']),
            _ => out.push(c),
        }
    }
    s = out;

    // A leading `**/` is any directory.
    let carets = s.iter().take_while(|c| **c == '^').count();
    let mut end = carets;
    while has_at(&s, end, "\\*\\*\\/") {
        end += 6;
        if version == IgnoreVersion::V5 {
            break;
        }
    }
    if end > carets {
        s = "^(?:.*\\/)?"
            .chars()
            .chain(s[end..].iter().copied())
            .collect();
    }

    // A pattern with a `/` that is not its last character is relative to the root.
    if s.first().is_some_and(|c| *c != '^') {
        let has_inner_slash = pattern.iter().rev().skip(1).any(|c| *c == '/');
        let start = if has_inner_slash { "^" } else { "(?:^|\\/)" };
        s = start.chars().chain(s.iter().copied()).collect();
    }

    // `/**/` is any number of directories, a trailing `/**` everything inside.
    let mut out = Vec::with_capacity(s.len() * 2);
    let mut i = 0;
    while i < s.len() {
        if has_at(&s, i, "\\/\\*\\*") && (i + 6 == s.len() || has_at(&s, i + 6, "\\/")) {
            out.extend(
                if i + 6 < s.len() {
                    "(?:\\/[^\\/]+)*"
                } else {
                    "\\/.+"
                }
                .chars(),
            );
            i += 6;
        } else {
            out.push(s[i]);
            i += 1;
        }
    }
    s = out;

    // Other `*` that are neither escaped nor the last character: anything but a `/`.
    let end_of_stars = |at: usize| {
        let mut count = 0;
        while has_at(&s, at + 2 * count, "\\*") {
            count += 1;
        }
        let mut ends = (1..=count).rev().map(|n| at + 2 * n);
        ends.find(|&end| {
            s.get(end)
                .is_some_and(|c| !text::is_line_terminator(*c as u32))
        })
    };
    let mut out = Vec::with_capacity(s.len() * 2);
    let (mut copied, mut i) = (0, 0);
    while i < s.len() {
        let mut stars = i;
        let mut end = if i == 0 { end_of_stars(0) } else { None };
        if end.is_none() {
            stars += s[i..].iter().take_while(|c| **c != '\\').count();
            if stars > i {
                end = end_of_stars(stars);
            }
        }
        match end {
            Some(end) => {
                out.extend_from_slice(&s[copied..stars]);
                out.extend("[^\\/]*".chars());
                copied = end;
                i = end;
            }
            None => i = stars.max(i + 1),
        }
    }
    out.extend_from_slice(&s[copied..]);
    s = out;

    // What the pattern itself escapes was escaped twice.
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let is_escaped_twice = has_at(&s, i, "\\\\\\")
            && matches!(
                s.get(i + 3),
                Some('$' | '.' | '|' | '*' | '+' | '(' | ')' | '{' | '^')
            );
        out.push(s[i]);
        i += if is_escaped_twice { 3 } else { 1 };
    }
    s = out;
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        out.push(s[i]);
        i += if has_at(&s, i, "\\\\") { 2 } else { 1 };
    }
    s = out;

    // `[a-z]`
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let is_escaped = s[i] == '\\' && s.get(i + 1) == Some(&'[');
        let inside = i + usize::from(is_escaped) + 1;
        let close = inside
            + (s.get(inside..).unwrap_or_default().iter())
                .take_while(|c| !matches!(**c, ']' | '/'))
                .count();
        if s.get(inside - 1) != Some(&'[') || s.get(close) == Some(&'/') {
            out.push(s[i]);
            i += 1;
            continue;
        }
        let escapes = trailing_backslashes(&s[inside..close]);
        let range = &s[inside..close - escapes];
        let is_closed = close < s.len();
        if is_escaped {
            out.extend(['\\', '[']);
            out.extend_from_slice(range);
            out.extend(std::iter::repeat_n('\\', escapes - escapes % 2));
            if is_closed {
                out.push(']');
            }
        } else if is_closed && escapes % 2 == 0 {
            let mut range = sanitize_range(range);
            if version == IgnoreVersion::V7 {
                if range.first() == Some(&'!') {
                    range[0] = '^';
                } else if range.starts_with(&['\\', '^']) {
                    range.remove(0);
                }
            }
            out.push('[');
            out.extend(range);
            out.extend(std::iter::repeat_n('\\', escapes));
            out.push(']');
        } else {
            out.extend(['[', ']']);
        }
        i = close + usize::from(is_closed);
    }
    s = out;

    // `a` matches `a` and `a/`, `a/` only the latter.
    match s.last().copied() {
        None | Some('*') => {}
        Some('/') => s.push('$'),
        Some(_) => s.extend("(?=$|\\/$)".chars()),
    }

    // A trailing `*`
    if s.ends_with(&['\\', '*']) {
        s.truncate(s.len() - 2);
        let is_whole_name =
            s.ends_with(&['\\', '/']) || version == IgnoreVersion::V5 && s.last() == Some(&'^');
        s.extend(if is_whole_name { "[^/]+" } else { "[^/]*" }.chars());
        s.extend("(?=$|\\/$)".chars());
    }

    s.into_iter().collect()
}
