//! `pattern-matcher.mjs`

use crate::regex::{Captures, Match, Regex, SyntaxError};

/// Upstream's `isEscaped`: whether an odd number of backslashes precede `index`.
fn is_escaped(text: &[u8], index: usize) -> bool {
    let before = text.get(..index).unwrap_or_default();
    before
        .iter()
        .rev()
        .take_while(|&&byte| byte == b'\\')
        .count()
        % 2
        == 1
}

/// eslint-utils' `PatternMatcher`: finds a pattern in text in which a backslash escapes what
/// follows it. A match that is preceded by an odd number of backslashes is skipped.
#[derive(Debug)]
pub struct PatternMatcher {
    pattern: Regex,
    /// The option `escaped`: escaped matches are found as well.
    escaped: bool,
}

impl PatternMatcher {
    /// `new PatternMatcher(new RegExp(pattern, flags), { escaped })`. The `g` flag, which upstream
    /// requires, is implied.
    pub fn new(pattern: &str, flags: &str, escaped: bool) -> Result<PatternMatcher, SyntaxError> {
        Ok(PatternMatcher::of(Regex::new(pattern, flags)?, escaped))
    }

    /// `new PatternMatcher(pattern, { escaped })`
    pub fn of(pattern: Regex, escaped: bool) -> PatternMatcher {
        PatternMatcher { pattern, escaped }
    }

    /// eslint-utils' `execAll`. After an empty match, with which upstream never ends, the search
    /// goes on one character further.
    pub fn exec_all<'r, 't>(&'r self, text: &'t [u8]) -> impl Iterator<Item = Captures<'r, 't>> {
        let all = self.pattern.exec_iter(text);
        all.filter(move |found| self.escaped || !is_escaped(text, found.start()))
    }

    /// eslint-utils' `test`.
    pub fn test(&self, text: &[u8]) -> bool {
        self.exec_all(text).next().is_some()
    }

    /// eslint-utils' `[Symbol.replace]` with a function: `text.replace(matcher, replacer)`.
    /// `replacer` appends what replaces the match.
    pub fn replace_with<'t>(
        &self,
        text: &'t [u8],
        mut replacer: impl FnMut(&Captures<'_, 't>, &mut Vec<u8>),
    ) -> Vec<u8> {
        let mut replaced = Vec::with_capacity(text.len());
        let mut at = 0;
        for found in self.exec_all(text) {
            replaced.extend_from_slice(text.get(at..found.start()).unwrap_or_default());
            replacer(&found, &mut replaced);
            at = found.end();
        }
        replaced.extend_from_slice(text.get(at..).unwrap_or_default());
        replaced
    }

    /// eslint-utils' `[Symbol.replace]` with a string: `text.replace(matcher, replacement)`, in
    /// which `$$`, `$&`, `` $` ``, `$'` and `$1` to `$99` stand for what they do in JavaScript, but
    /// for two things: `$12` is never the group 1 and a `2`, and a group that took no part is
    /// `undefined`.
    pub fn replace(&self, text: &[u8], replacement: &[u8]) -> Vec<u8> {
        self.replace_with(text, |found, replaced| {
            let mut rest = replacement;
            while let [byte, after @ ..] = rest {
                rest = after;
                if *byte != b'$' {
                    replaced.push(*byte);
                    continue;
                }
                let digits = match after {
                    [b'1'..=b'9', b'0'..=b'9', ..] => 2,
                    [b'1'..=b'9', ..] => 1,
                    _ => 0,
                };
                let group = after[..digits]
                    .iter()
                    .fold(0, |group, digit| group * 10 + usize::from(digit - b'0'));
                let (placeholder, len): (&[u8], usize) = match after {
                    [b'$', ..] => (b"$", 1),
                    [b'&', ..] => (found.as_bytes(), 1),
                    [b'`', ..] => (text.get(..found.start()).unwrap_or_default(), 1),
                    [b'\'', ..] => (text.get(found.end()..).unwrap_or_default(), 1),
                    _ if digits > 0 && group < found.len() => (
                        found.get(group).map_or(b"undefined", Match::as_bytes),
                        digits,
                    ),
                    // It stays as it is written.
                    _ => (b"$", 0),
                };
                replaced.extend_from_slice(placeholder);
                rest = &after[len..];
            }
        })
    }
}
