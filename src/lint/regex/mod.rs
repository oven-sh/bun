//! JavaScript's regular expressions, without a JavaScript engine.
//!
//! - [`Regex`] matches. It is for the patterns that users write in the options of rules, and for the
//!   regular expressions that the rules of ESLint and typescript-eslint use themselves:
//!   `static PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::literal("/^_/u"));`
//! - [`parse_pattern`], [`parse_literal`], [`validate_pattern`], .. are `@eslint-community/regexpp`, for
//!   the rules about regular expressions. See [`ast`].
//!
//! # Matching
//!
//! All of ECMAScript 2025 but `\p{RGI_Emoji}` and the other properties of strings: the flags
//! `dgimsuvy`, lookbehind, named groups and duplicates of them, backreferences, modifiers, classes
//! with the `v` flag, Annex B. The order in which alternatives are tried, what groups
//! capture and what ignoring case means are as the specification says.
//!
//! | JavaScript | Here |
//! | --- | --- |
//! | `new RegExp(pattern, flags)` | [`Regex::new`], [`Regex::from_bytes`] |
//! | `/pattern/flags` | [`Regex::literal`] |
//! | `re.test(s)` | [`re.test(s)`](Regex::test) |
//! | `re.exec(s)`, `s.match(re)` without `g` | [`re.exec(s)`](Regex::exec): `m[1]` is `m.get(1)`, `m.groups.name` is `m.name("name")`, `m.index` is `m.start()` |
//! | the same when only `m[0]` and `m.index` are used | [`re.find(s)`](Regex::find) |
//! | `re.lastIndex = i; re.exec(s)` with `g` or `y` | [`re.exec_at(s, i)`](Regex::exec_at), [`re.find_at(s, i)`](Regex::find_at). `lastIndex` is then `m.end()` |
//! | `while ((m = re.exec(s)))` with `g`, `s.matchAll(re)` | [`re.exec_iter(s)`](Regex::exec_iter) |
//! | `s.match(re)` with `g` | [`re.find_iter(s)`](Regex::find_iter) |
//! | `s.search(re)` | [`re.search(s)`](Regex::search), `None` for -1 |
//! | `s.replace(re, "$1")` | [`re.replace(s, b"$1")`](Regex::replace): all matches with `g`, otherwise the first |
//! | `s.replaceAll(re, "$1")` | the same: it requires `g` |
//! | `s.replace(re, (m, p1) => ..)` | [`re.replace_with(s, \|m, out\| ..)`](Regex::replace_with) |
//! | `s.split(re)` | [`re.split(s)`](Regex::split) |
//! | `re.source`, `re.flags`, `re.global`, .. | [`Regex::source`], [`Regex::flags`] |
//!
//! A [`Regex`] has no `lastIndex`: it does not change, and all threads can share it. [`Regex::test`],
//! [`Regex::exec`] and [`Regex::find`] start at 0 whatever the flags.
//!
//! # Text and positions
//!
//! Text is bytes: UTF-8, or WTF-8 if the JavaScript string has lone surrogates. Positions are byte
//! offsets. [`utf16_index`] and [`byte_offset`] convert.
//!
//! With the `u` or `v` flag a character is a code point. Without them JavaScript matches UTF-16 code
//! units, and so does this: a character outside the BMP, four bytes here, counts as two
//! characters, its lead and its trail surrogate. The position between the two is the offset of
//! the character plus 2. So `/^.$/` does not match `"💩"`, `/^..$/` does, and `/./` finds `0..2`, which is not
//! valid UTF-8 on its own, just as `"\ud83d"` is not a valid string in JavaScript. Use the `u` flag, as
//! upstream mostly does, and none of this matters.
//!
//! # Time
//!
//! The machine backtracks, as those of JavaScript engines do, so there are patterns that take
//! exponential time. A search is given up after 2^27 steps, about a second: it then counts as no
//! match. [`Regex::try_exec_at`] tells the difference. Patterns that start with `^`, a literal or a small set
//! of bytes skip to where a match can start with `bun_core::strings`.

pub mod ast;
mod charset;
mod compile;
mod exec;
mod parser;
mod program;
mod unicode;
mod unicode_tables;
mod validator;
mod wtf8;

pub use ast::{Ast, Flags, Node};
pub use exec::LimitExceeded;
pub use parser::{parse_flags, parse_literal, parse_pattern};
pub use validator::{
    Handler, Ignore, Mode, Options, SyntaxError, validate_flags, validate_literal, validate_pattern,
};
pub use wtf8::{byte_offset, utf16_index};

use bun_core::strings;
use exec::{Machine, Slots};
use program::{NONE, Program};
use std::borrow::Cow;

/// The version of Unicode of `\p{..}` and of the `i` flag.
pub const UNICODE_VERSION: &str = unicode_tables::UNICODE_VERSION;

/// `new RegExp(pattern, flags)`
#[derive(Debug)]
pub struct Regex {
    program: Program,
    flags: Flags,
    source: Box<[u8]>,
    /// The names of groups, and the groups that have each.
    names: Vec<(Box<[u8]>, Vec<u32>)>,
}

impl Regex {
    /// `new RegExp(pattern, flags)`
    pub fn new(pattern: &str, flags: &str) -> Result<Regex, SyntaxError> {
        Regex::from_bytes(pattern.as_bytes(), flags.as_bytes())
    }

    /// `new RegExp(pattern, flags)`
    pub fn from_bytes(pattern: &[u8], flags: &[u8]) -> Result<Regex, SyntaxError> {
        let flags = parse_flags(flags, Options::default())?;
        let mode = Mode { unicode: flags.unicode, unicode_sets: flags.unicode_sets };
        let ast = parse_pattern(pattern, mode, Options::default())?;
        Ok(Regex {
            program: compile::compile(&ast, flags)?,
            flags,
            source: pattern.into(),
            names: compile::group_names(&ast),
        })
    }

    /// `/pattern/flags`, for a regular expression in the source of a rule.
    ///
    /// # Panics
    /// If it is invalid.
    pub fn literal(literal: &str) -> Regex {
        let bytes = literal.as_bytes();
        let end = strings::last_index_of_char(bytes, b'/').unwrap_or(0);
        let pattern = bytes.get(1..end).unwrap_or_default();
        match Regex::from_bytes(pattern, bytes.get(end + 1..).unwrap_or_default()) {
            Ok(regex) if bytes.first() == Some(&b'/') => regex,
            Ok(_) => panic!("{literal}: not a regular expression literal"),
            Err(error) => panic!("{error}"),
        }
    }

    /// `regex.source`, but as it was given: `/` is not escaped and the empty pattern is not `(?:)`.
    #[inline]
    pub fn source(&self) -> &[u8] {
        &self.source
    }

    #[inline]
    pub fn flags(&self) -> Flags {
        self.flags
    }

    /// The number of capturing groups.
    #[inline]
    pub fn group_count(&self) -> usize {
        self.program.group_count as usize - 1
    }

    /// The names of the groups, in the order in which they first appear.
    pub fn group_names(&self) -> impl Iterator<Item = &[u8]> {
        self.names.iter().map(|(name, _)| &**name)
    }

    fn run(
        &self,
        text: &[u8],
        start: usize,
        captures: bool,
    ) -> Result<Option<Slots>, LimitExceeded> {
        let Ok(start) = u32::try_from(start) else { return Ok(None) };
        let mut machine = Machine::new(&self.program, text, captures);
        Ok(machine.search(start, self.flags.sticky)?.then_some(machine.slots))
    }

    /// `regex.test(text)`, from the start of the text.
    #[inline]
    pub fn test(&self, text: &[u8]) -> bool {
        matches!(self.run(text, 0, false), Ok(Some(_)))
    }

    /// `regex.exec(text)`, from the start of the text, when the groups are not needed.
    #[inline]
    pub fn find<'t>(&self, text: &'t [u8]) -> Option<Match<'t>> {
        self.find_at(text, 0)
    }

    /// The first match that starts at `start` or after it. With the `y` flag, only at `start`.
    pub fn find_at<'t>(&self, text: &'t [u8], start: usize) -> Option<Match<'t>> {
        let slots = self.run(text, start, false).ok()??;
        Some(Match { text, start: *slots.first()?, end: *slots.get(1)? })
    }

    /// `regex.exec(text)`, from the start of the text.
    #[inline]
    pub fn exec<'t>(&self, text: &'t [u8]) -> Option<Captures<'_, 't>> {
        self.exec_at(text, 0)
    }

    /// `regex.lastIndex = start; regex.exec(text)` for a regular expression with the `g` or `y` flag.
    pub fn exec_at<'t>(&self, text: &'t [u8], start: usize) -> Option<Captures<'_, 't>> {
        self.try_exec_at(text, start).ok()?
    }

    /// [`Regex::exec_at`], or an error if the search takes too long.
    pub fn try_exec_at<'t>(
        &self,
        text: &'t [u8],
        start: usize,
    ) -> Result<Option<Captures<'_, 't>>, LimitExceeded> {
        Ok(self.run(text, start, true)?.map(|slots| Captures { regex: self, text, slots }))
    }

    /// `text.search(regex)`
    pub fn search(&self, text: &[u8]) -> Option<usize> {
        self.find(text).map(Match::start)
    }

    /// The specification's `AdvanceStringIndex`.
    fn advance(&self, text: &[u8], index: usize) -> usize {
        if index >= text.len() {
            return index + 1;
        }
        index
            + if self.program.unicode {
                wtf8::code_point_at(text, index).1
            } else {
                wtf8::unit_at(text, index).1
            }
    }

    /// `text.match(regex)` with the `g` flag: all matches, whether it has the flag or not.
    pub fn find_iter<'r, 't>(&'r self, text: &'t [u8]) -> impl Iterator<Item = Match<'t>> {
        let mut next = Some(0);
        std::iter::from_fn(move || {
            let found = self.find_at(text, next?);
            next = found.map(|m| if m.is_empty() { self.advance(text, m.end()) } else { m.end() });
            found
        })
    }

    /// `text.matchAll(regex)`: all matches, whether it has the `g` flag or not.
    pub fn exec_iter<'r, 't>(
        &'r self,
        text: &'t [u8],
    ) -> impl Iterator<Item = Captures<'r, 't>> {
        let mut next = Some(0);
        std::iter::from_fn(move || {
            let found = self.exec_at(text, next?);
            next = found.as_ref().map(|m| {
                if m.start() == m.end() { self.advance(text, m.end()) } else { m.end() }
            });
            found
        })
    }

    /// `text.replace(regex, replacement)`. `$1`, `$&`, `$<name>`, .. in `replacement` are what they are
    /// in JavaScript.
    pub fn replace<'t>(&self, text: &'t [u8], replacement: &[u8]) -> Cow<'t, [u8]> {
        if !strings::contains_char(replacement, b'$') {
            return self.replace_with(text, |_, out| out.extend_from_slice(replacement));
        }
        self.replace_with(text, |captures, out| captures.expand(replacement, out))
    }

    /// `text.replace(regex, (...) => ..)`. `replacer` appends what replaces the match.
    pub fn replace_with<'t>(
        &self,
        text: &'t [u8],
        mut replacer: impl FnMut(&Captures<'_, 't>, &mut Vec<u8>),
    ) -> Cow<'t, [u8]> {
        let mut out = Vec::new();
        let mut copied = 0;
        for captures in self.exec_iter(text).take(if self.flags.global { usize::MAX } else { 1 }) {
            out.extend_from_slice(text.get(copied..captures.start()).unwrap_or_default());
            replacer(&captures, &mut out);
            copied = captures.end();
        }
        if copied == 0 && out.is_empty() {
            return Cow::Borrowed(text);
        }
        out.extend_from_slice(text.get(copied..).unwrap_or_default());
        Cow::Owned(out)
    }

    /// `text.split(regex)`. What the groups captured is in the result as well, as in JavaScript, but
    /// a group that did not take part gives an empty slice, not `undefined`.
    pub fn split<'t>(&self, text: &'t [u8]) -> Vec<&'t [u8]> {
        let mut parts = Vec::new();
        if text.is_empty() {
            if !self.matches_at(text, 0) {
                parts.push(text);
            }
            return parts;
        }
        let mut from = 0;
        let mut at = 0;
        while at < text.len() {
            let Ok(Some(slots)) = self.run_unanchored(text, at) else { break };
            let captures = Captures { regex: self, text, slots };
            let end = captures.end().min(text.len());
            if captures.start() >= text.len() {
                break;
            }
            if end == from {
                at = self.advance(text, captures.start().max(at));
                continue;
            }
            parts.push(text.get(from..captures.start()).unwrap_or_default());
            parts.extend((1..captures.len()).map(|i| captures.get(i).map_or(&[][..], Match::as_bytes)));
            from = end;
            at = end;
        }
        parts.push(text.get(from..).unwrap_or_default());
        parts
    }

    fn matches_at(&self, text: &[u8], start: u32) -> bool {
        matches!(Machine::new(&self.program, text, false).search(start, true), Ok(true))
    }

    /// `split` ignores the `y` flag.
    fn run_unanchored(&self, text: &[u8], start: usize) -> Result<Option<Slots>, LimitExceeded> {
        let mut machine = Machine::new(&self.program, text, true);
        Ok(machine.search(start as u32, false)?.then_some(machine.slots))
    }
}

/// Where a regular expression, or a group of it, matched.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Match<'t> {
    text: &'t [u8],
    start: u32,
    end: u32,
}

impl<'t> Match<'t> {
    /// `match.index`, in bytes.
    #[inline]
    pub fn start(self) -> usize {
        self.start as usize
    }

    #[inline]
    pub fn end(self) -> usize {
        self.end as usize
    }

    #[inline]
    pub fn range(self) -> std::ops::Range<usize> {
        self.start()..self.end()
    }

    #[inline]
    pub fn len(self) -> usize {
        self.end() - self.start()
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.start == self.end
    }

    /// `match[0]`
    #[inline]
    pub fn as_bytes(self) -> &'t [u8] {
        self.text.get(self.range()).unwrap_or_default()
    }
}

/// The result of `regex.exec(text)`.
#[derive(Debug)]
pub struct Captures<'r, 't> {
    regex: &'r Regex,
    text: &'t [u8],
    slots: Slots,
}

impl<'t> Captures<'_, 't> {
    /// `match[index]`. `None` is `undefined`: there is no such group, or it did not take part.
    pub fn get(&self, index: usize) -> Option<Match<'t>> {
        if index >= self.len() {
            return None;
        }
        let (start, end) = (*self.slots.get(index * 2)?, *self.slots.get(index * 2 + 1)?);
        (start != NONE && end != NONE).then_some(Match { text: self.text, start, end })
    }

    /// `match.groups[name]`
    pub fn name(&self, name: impl AsRef<[u8]>) -> Option<Match<'t>> {
        let (_, groups) = self.regex.names.iter().find(|(known, _)| **known == *name.as_ref())?;
        groups.iter().find_map(|group| self.get(*group as usize))
    }

    /// `match.length`: one more than there are groups.
    #[inline]
    pub fn len(&self) -> usize {
        self.regex.program.group_count as usize
    }

    /// `match.index`, in bytes.
    #[inline]
    pub fn start(&self) -> usize {
        self.slots.first().copied().unwrap_or(0) as usize
    }

    /// Where the match ends: `regex.lastIndex` afterwards, with the `g` or `y` flag.
    #[inline]
    pub fn end(&self) -> usize {
        self.slots.get(1).copied().unwrap_or(0) as usize
    }

    /// `match[0]`
    #[inline]
    pub fn as_bytes(&self) -> &'t [u8] {
        self.text.get(self.start()..self.end()).unwrap_or_default()
    }

    /// `match[index] ?? ""`
    pub fn bytes(&self, index: usize) -> &'t [u8] {
        self.get(index).map_or(&[][..], Match::as_bytes)
    }

    /// The specification's `GetSubstitution`: appends `template` with `$1`, `$&`, .. replaced.
    pub fn expand(&self, template: &[u8], out: &mut Vec<u8>) {
        let mut rest = template;
        while let Some(dollar) = strings::index_of_char_usize(rest, b'$') {
            out.extend_from_slice(rest.get(..dollar).unwrap_or_default());
            rest = rest.get(dollar..).unwrap_or_default();
            let digit = |i: usize| rest.get(i).filter(|b| b.is_ascii_digit()).map(|b| usize::from(b - b'0'));
            let mut used = 2;
            match rest.get(1) {
                Some(b'$') => out.push(b'$'),
                Some(b'&') => out.extend_from_slice(self.as_bytes()),
                Some(b'`') => out.extend_from_slice(self.text.get(..self.start()).unwrap_or_default()),
                Some(b'\'') => out.extend_from_slice(self.text.get(self.end()..).unwrap_or_default()),
                Some(b'0'..=b'9') => {
                    let one = digit(1).unwrap_or(0);
                    let two = digit(2).map(|second| one * 10 + second);
                    if let Some(index) = two.filter(|index| (1..self.len()).contains(index)) {
                        used = 3;
                        out.extend_from_slice(self.bytes(index));
                    } else if (1..self.len()).contains(&one) {
                        out.extend_from_slice(self.bytes(one));
                    } else {
                        used = 1;
                        out.push(b'$');
                    }
                }
                Some(b'<') if !self.regex.names.is_empty() => {
                    match strings::index_of_char_usize(rest, b'>') {
                        Some(close) => {
                            let name = rest.get(2..close).unwrap_or_default();
                            out.extend_from_slice(self.name(name).map_or(&[][..], Match::as_bytes));
                            used = close + 1;
                        }
                        None => out.extend_from_slice(b"$<"),
                    }
                }
                _ => {
                    used = 1;
                    out.push(b'$');
                }
            }
            rest = rest.get(used..).unwrap_or_default();
        }
        out.extend_from_slice(rest);
    }
}
