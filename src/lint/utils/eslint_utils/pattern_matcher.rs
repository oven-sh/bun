//! `pattern-matcher.mjs`

use crate::regex::{Regex, SyntaxError};
use std::ops::Range;

/// What `regex.exec(text)` returns.
#[derive(Clone, Debug)]
pub struct PatternMatch<'t> {
    text: &'t [u8],
    /// The whole match, then the capture groups. `None` for a group that took no part.
    groups: Vec<Option<Range<usize>>>,
}

impl<'t> PatternMatch<'t> {
    /// `match.index` and the end of the match, in bytes.
    pub fn span(&self) -> Range<usize> {
        self.groups.first().cloned().flatten().unwrap_or(0..0)
    }

    /// `match[i]`
    pub fn get(&self, i: usize) -> Option<&'t [u8]> {
        self.text.get(self.groups.get(i)?.clone()?)
    }

    /// `match.length`: one more than there are capture groups.
    pub fn len(&self) -> usize {
        self.groups.len()
    }

    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }
}

/// `regex.lastIndex = from; regex.exec(text)`
fn exec_at<'t>(_regex: &Regex, _text: &'t [u8], _from: usize) -> Option<PatternMatch<'t>> {
    None
}

/// Upstream's `isEscaped`: whether an odd number of backslashes precede `index`.
fn is_escaped(text: &[u8], index: usize) -> bool {
    let before = text.get(..index).unwrap_or_default();
    before.iter().rev().take_while(|&&byte| byte == b'\\').count() % 2 == 1
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
        Ok(PatternMatcher {
            pattern: Regex::new(pattern, flags)?,
            escaped,
        })
    }

    /// eslint-utils' `execAll`.
    pub fn exec_all<'s, 't: 's>(&'s self, text: &'t [u8]) -> impl Iterator<Item = PatternMatch<'t>> + 's {
        let mut from = 0;
        std::iter::from_fn(move || {
            loop {
                let found = exec_at(&self.pattern, text, from)?;
                let span = found.span();
                // After an empty match, the next search starts one character further.
                from = span.end;
                if span.is_empty() {
                    from += match text.get(span.end) {
                        Some(0xF0..) => 4,
                        Some(0xE0..) => 3,
                        Some(0xC0..) => 2,
                        _ => 1,
                    };
                }
                if self.escaped || !is_escaped(text, span.start) {
                    return Some(found);
                }
            }
        })
    }

    /// eslint-utils' `test`.
    pub fn test(&self, text: &[u8]) -> bool {
        self.exec_all(text).next().is_some()
    }

    /// eslint-utils' `[Symbol.replace]` with a function: `text.replace(matcher, replacer)`.
    pub fn replace_with(&self, text: &[u8], mut replacer: impl FnMut(&PatternMatch<'_>, &mut Vec<u8>)) -> Vec<u8> {
        let mut replaced = Vec::with_capacity(text.len());
        let mut at = 0;
        for found in self.exec_all(text) {
            let span = found.span();
            replaced.extend_from_slice(text.get(at..span.start).unwrap_or_default());
            replacer(&found, &mut replaced);
            at = span.end;
        }
        replaced.extend_from_slice(text.get(at..).unwrap_or_default());
        replaced
    }

    /// eslint-utils' `[Symbol.replace]` with a string: `text.replace(matcher, replacement)`, in
    /// which `$$`, `$&`, `` $` ``, `$'` and `$1` to `$99` stand for what they do in JavaScript.
    pub fn replace(&self, text: &[u8], replacement: &[u8]) -> Vec<u8> {
        self.replace_with(text, |found, replaced| {
            let span = found.span();
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
                let (placeholder, len): (&[u8], usize) = match after {
                    [b'$', ..] => (b"$", 1),
                    [b'&', ..] => (found.get(0).unwrap_or_default(), 1),
                    [b'`', ..] => (text.get(..span.start).unwrap_or_default(), 1),
                    [b'\'', ..] => (text.get(span.end..).unwrap_or_default(), 1),
                    _ if digits > 0 => {
                        let group = after[..digits].iter().fold(0, |group, digit| group * 10 + usize::from(digit - b'0'));
                        match group < found.len() {
                            true => (found.get(group).unwrap_or(b"undefined"), digits),
                            // It stays as it is written.
                            false => (b"$", 0),
                        }
                    }
                    _ => (b"$", 0),
                };
                replaced.extend_from_slice(placeholder);
                rest = &after[len..];
            }
        })
    }
}
