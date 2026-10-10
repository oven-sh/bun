//! JavaScript's regular expressions.
//!
//! - [`Regex`] matches: it is the `RegExp` of JavaScriptCore, without a VM (`bun_yarr`). It is for the
//!   patterns that users write in the options of rules, and for the regular expressions that the
//!   rules of ESLint and typescript-eslint use themselves:
//!   `static PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::literal("/^_/u"));`
//! - [`parse_pattern`], [`parse_literal`], [`validate_pattern`], .. are `@eslint-community/regexpp`, for
//!   the rules about regular expressions. See [`ast`].
//!
//! # Matching
//!
//! All of ECMAScript 2025: the flags `dgimsuvy`, lookbehind, named groups and duplicates of them,
//! backreferences, modifiers, `\p{..}`, classes with the `v` flag, Annex B. A pattern is validated
//! here first, so what is wrong with it is said in the words of regexpp and V8.
//!
//! | JavaScript | Here |
//! | --- | --- |
//! | `new RegExp(pattern, flags)` | [`Regex::new`], [`Regex::from_bytes`] |
//! | `/pattern/flags` | [`Regex::literal`] |
//! | `re.test(s)` | [`re.test(s)`](Regex::test) |
//! | `re.exec(s)`, `s.match(re)` without `g` | [`re.exec_at(s, 0)`](Regex::exec_at): `m[1]` is `m.get(1)`, `m.groups.name` is `m.name("name")`, `m.index` is `m.start()` |
//! | the same when only `m[0]` and `m.index` are used | [`re.find(s)`](Regex::find) |
//! | `re.lastIndex = i; re.exec(s)` with `g` or `y` | [`re.exec_at(s, i)`](Regex::exec_at), [`re.find_at(s, i)`](Regex::find_at). `lastIndex` is then `m.end()` |
//! | `while ((m = re.exec(s)))` with `g`, `s.matchAll(re)` | [`re.exec_iter(s)`](Regex::exec_iter) |
//! | `s.match(re)` with `g` | [`re.find_iter(s)`](Regex::find_iter) |
//! | `s.search(re)` | [`re.search(s)`](Regex::search), `None` for -1 |
//! | `s.replace(re, "$1")` | [`re.replace(s, b"$1")`](Regex::replace): all matches with `g`, otherwise the first |
//! | `s.replaceAll(re, "$1")` | the same: it requires `g` |
//! | `s.replace(re, (m, p1) => ..)` | [`re.replace_with(s, \|m, out\| ..)`](Regex::replace_with) |
//! | `s.split(re)` | [`re.split(s)`](Regex::split) |
//! | `re.source`, `re.flags`, `re.global`, .. | [`Regex::source`], [`Regex::flags`]: `re.flags().global`, `re.flags().to_string()` |
//! | `String(re)`, `` `${re}` `` | `re.to_string()`, `format!("{re}")` |
//! | `escapeRegExp(s)` of `escape-string-regexp` | [`bun_core::strings::escape_reg_exp`] |
//!
//! A [`Regex`] has no `lastIndex`: it does not change, and all threads can share it. [`Regex::test`]
//! and [`Regex::find`] start at 0 whatever the flags.
//!
//! # Text and positions
//!
//! Text is bytes: UTF-8, or WTF-8 if the JavaScript string has lone surrogates. Positions are byte
//! offsets. [`utf16_index`] and [`byte_offset`] convert. ASCII is searched as it is, of other text a
//! copy in UTF-16: one for each call, so [`Regex::exec_iter`] and not [`Regex::exec_at`] in a loop.
//!
//! With the `u` or `v` flag a character is a code point. Without them JavaScript matches UTF-16 code
//! units, and so does this: a character outside the BMP, four bytes here, counts as two
//! characters, its lead and its trail surrogate. The position between the two is the offset of
//! the character plus 2. So `/^.$/` does not match `"💩"`, `/^..$/` does, and `/./` finds `0..2`, which is not
//! valid UTF-8 on its own, just as `"\ud83d"` is not a valid string in JavaScript. Use the `u` flag, as
//! upstream mostly does, and none of this matters.
//!
//! # Limits
//!
//! The engine backtracks, so there are patterns that take exponential time, and nothing stops a
//! search after some time: `/.*.*.*.*x/` on 3,000 characters takes hours at least, here as in ESLint.
//! A pattern is a part of the configuration, which is trusted.
//!
//! JavaScriptCore gives a search up after 10^8 attempts at quantified groups, which take seconds,
//! or when it has 192 MB to go back to. That counts as no match, and cannot be told from it.
//!
//! It refuses a pattern of more than 2^20 characters or 2^15 groups, and `\p{Script=Hrkt}`. Its
//! strings have less than 2^31 characters: in a longer text nothing is found.
//!
//! Groups and classes nest at most 250 deep: beyond that a pattern is a [`SyntaxError`], for the
//! parser as well.
//!
//! The scripts in test/cli/lint/oracle/regex compare all of this with regexpp, JavaScriptCore and V8.

pub mod ast;
mod parser;
mod subject;
pub mod unicode;
mod unicode_tables;
mod validator;
mod wtf8;

pub use ast::{Ast, Flags, Node};
pub use parser::{parse_flags, parse_literal, parse_pattern};
pub use validator::{
    Handler, Ignore, Mode, Options, SyntaxError, validate_flags, validate_literal, validate_pattern,
};
pub use wtf8::{byte_offset, utf16_index};

use bun_core::strings;
use bun_yarr::{Compiled, NO_MATCH as NONE};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::sync::OnceLock;
use subject::Subject;

/// The start and the end of the match and of each group.
type Slots = SmallVec<[u32; 16]>;

/// `EscapeRegExpPattern`, as V8 does it: what `regex.source` is for the pattern `text`.
pub(crate) fn escape_source(text: Cow<'_, [u8]>) -> Cow<'_, [u8]> {
    if text.is_empty() {
        return Cow::Borrowed(b"(?:)");
    }
    if strings::index_of_any(&text, b"/\n\r\xE2").is_none() {
        return text;
    }
    let mut source = Vec::with_capacity(text.len() + 4);
    let (mut is_escaped, mut is_in_class) = (false, false);
    let mut rest = &text[..];
    while let [byte, after @ ..] = rest {
        let line_terminator: Option<(&[u8], usize)> = match rest {
            [b'\n', ..] => Some((b"n", 1)),
            [b'\r', ..] => Some((b"r", 1)),
            [0xE2, 0x80, 0xA8, ..] => Some((b"u2028", 3)),
            [0xE2, 0x80, 0xA9, ..] => Some((b"u2029", 3)),
            _ => None,
        };
        if let Some((escape, len)) = line_terminator {
            if !is_escaped {
                source.push(b'\\');
            }
            source.extend_from_slice(escape);
            is_escaped = false;
            rest = &rest[len..];
            continue;
        }
        if !is_escaped {
            match byte {
                b'/' if !is_in_class => source.push(b'\\'),
                b'[' => is_in_class = true,
                b']' => is_in_class = false,
                _ => {}
            }
        }
        is_escaped = !is_escaped && *byte == b'\\';
        source.push(*byte);
        rest = after;
    }
    Cow::Owned(source)
}

/// The names of the groups with the groups of each, in the order in which the names first appear.
fn group_names(ast: &Ast<'_>) -> Vec<(Box<[u8]>, Vec<u32>)> {
    let mut names: Vec<(Box<[u8]>, Vec<u32>)> = Vec::new();
    for (index, group) in ast.capturing_groups().enumerate() {
        let ast::Kind::CapturingGroup {
            name: Some(name), ..
        } = group.kind()
        else {
            continue;
        };
        let index = index as u32 + 1;
        match names.iter_mut().find(|known| *known.0 == *name) {
            Some(known) => known.1.push(index),
            None => names.push((name.into(), vec![index])),
        }
    }
    names
}

/// `pattern` is valid.
fn compile(pattern: &[u8], flags: Flags) -> Result<Compiled, SyntaxError> {
    use bun_yarr::flags as bit;
    let bits = [
        (flags.has_indices, bit::HAS_INDICES),
        (flags.global, bit::GLOBAL),
        (flags.ignore_case, bit::IGNORE_CASE),
        (flags.multiline, bit::MULTILINE),
        (flags.dot_all, bit::DOT_ALL),
        (flags.unicode, bit::UNICODE),
        (flags.unicode_sets, bit::UNICODE_SETS),
        (flags.sticky, bit::STICKY),
    ];
    let bits = bits
        .iter()
        .filter(|it| it.0)
        .fold(0u16, |all, it| all | it.1);
    Compiled::new(Subject::new(pattern, false).text(), bits).map_err(|error| {
        SyntaxError::unsupported(match error {
            bun_yarr::Error::TooLarge => "Regular expression too large",
            bun_yarr::Error::UnknownProperty => "Invalid property name",
            bun_yarr::Error::Syntax => "JavaScriptCore does not accept it",
        })
    })
}

/// `String(regex)`: `/source/flags`
impl std::fmt::Display for Regex {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "/{}/{}", bstr::BStr::new(&self.source), self.flags)
    }
}

const _: fn() = || {
    fn shared_by_threads<T: Send + Sync>() {}
    shared_by_threads::<Regex>();
};

/// `new RegExp(pattern, flags)`
#[derive(Debug)]
pub struct Regex {
    compiled: Compiled,
    /// The same without the `y` flag, if it has it. Made when it is first asked for.
    unsticky: OnceLock<Option<Compiled>>,
    flags: Flags,
    source: Box<[u8]>,
    /// Groups, with the whole match as the first.
    group_count: u32,
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
        let mode = Mode {
            unicode: flags.unicode,
            unicode_sets: flags.unicode_sets,
        };
        let ast = parse_pattern(pattern, mode, Options::default())?;
        Ok(Regex {
            compiled: compile(pattern, flags)?,
            unsticky: OnceLock::new(),
            flags,
            source: escape_source(Cow::Borrowed(pattern)).into_owned().into(),
            group_count: ast.capturing_groups().count() as u32 + 1,
            names: group_names(&ast),
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

    /// `regex.source`: the pattern with `/` and line terminators escaped, as V8 does it. `(?:)` if it
    /// is empty.
    #[inline]
    pub fn source(&self) -> &[u8] {
        &self.source
    }

    #[inline]
    pub fn flags(&self) -> Flags {
        self.flags
    }

    /// The names of the groups, in the order in which they first appear.
    pub fn group_names(&self) -> impl Iterator<Item = &[u8]> {
        self.names.iter().map(|(name, _)| &**name)
    }

    /// Whether a character is a code point: the `u` or the `v` flag.
    #[inline]
    fn is_unicode(&self) -> bool {
        self.flags.unicode || self.flags.unicode_sets
    }

    /// Whether `compiled` matches from the byte offset `start` on. If so `slots` has indices in `subject.text()`.
    fn matches(
        &self,
        compiled: &Compiled,
        subject: &Subject<'_>,
        start: usize,
        slots: &mut Slots,
    ) -> bool {
        if subject.is_too_long() || start > subject.bytes().len() {
            return false;
        }
        slots.resize(compiled.offsets_len(), NONE);
        if !self.is_unicode() {
            return compiled.exec(subject.text(), subject.index_of(start), slots);
        }
        // JavaScriptCore's `RegExp::matchInlineAtCodePointBoundaries`: Yarr also tries between the halves of a surrogate pair.
        let mut from = subject.index_of(subject.code_point_start(start));
        while compiled.exec(subject.text(), from, slots) {
            match slots.first() {
                Some(&found) if found > from && subject.splits_pair(found) => from = found + 1,
                _ => return true,
            }
        }
        false
    }

    /// The byte offsets of the first match of `compiled` from `start` on.
    fn run(&self, compiled: &Compiled, subject: &Subject<'_>, start: usize) -> Option<Slots> {
        let mut slots = Slots::new();
        if !self.matches(compiled, subject, start, &mut slots) {
            return None;
        }
        slots.truncate(self.group_count as usize * 2);
        subject.to_offsets(&mut slots);
        Some(slots)
    }

    fn find_in<'t>(&self, subject: &Subject<'t>, start: usize) -> Option<Match<'t>> {
        let slots = self.run(&self.compiled, subject, start)?;
        Some(Match {
            text: subject.bytes(),
            start: *slots.first()?,
            end: *slots.get(1)?,
        })
    }

    fn exec_in<'t>(
        &self,
        compiled: &Compiled,
        subject: &Subject<'t>,
        start: usize,
    ) -> Option<Captures<'_, 't>> {
        Some(Captures {
            regex: self,
            text: subject.bytes(),
            slots: self.run(compiled, subject, start)?,
        })
    }

    /// `regex.test(text)`, from the start of the text.
    #[inline]
    pub fn test(&self, text: &[u8]) -> bool {
        let subject = Subject::new(text, false);
        self.matches(&self.compiled, &subject, 0, &mut Slots::new())
    }

    /// `regex.exec(text)`, from the start of the text, when the groups are not needed.
    #[inline]
    pub fn find<'t>(&self, text: &'t [u8]) -> Option<Match<'t>> {
        self.find_at(text, 0)
    }

    /// The first match that starts at `start` or after it. With the `y` flag, only at `start`.
    pub fn find_at<'t>(&self, text: &'t [u8], start: usize) -> Option<Match<'t>> {
        self.find_in(&Subject::new(text, true), start)
    }

    /// `regex.lastIndex = start; regex.exec(text)` for a regular expression with the `g` or `y` flag.
    /// Without them JavaScript starts at 0.
    pub fn exec_at<'t>(&self, text: &'t [u8], start: usize) -> Option<Captures<'_, 't>> {
        self.exec_in(&self.compiled, &Subject::new(text, true), start)
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
            + if self.is_unicode() {
                wtf8::code_point_at(text, index).1
            } else {
                wtf8::unit_at(text, index).1
            }
    }

    /// `text.match(regex)` with the `g` flag: all matches, whether it has the flag or not.
    pub fn find_iter<'r, 't>(&'r self, text: &'t [u8]) -> impl Iterator<Item = Match<'t>> {
        let subject = Subject::new(text, true);
        let mut next = Some(0);
        std::iter::from_fn(move || {
            let found = self.find_in(&subject, next?);
            next = found.map(|m| {
                if m.is_empty() {
                    self.advance(text, m.end())
                } else {
                    m.end()
                }
            });
            found
        })
    }

    /// `text.matchAll(regex)`: all matches, whether it has the `g` flag or not.
    pub fn exec_iter<'r, 't>(&'r self, text: &'t [u8]) -> impl Iterator<Item = Captures<'r, 't>> {
        let subject = Subject::new(text, true);
        let mut next = Some(0);
        std::iter::from_fn(move || {
            let found = self.exec_in(&self.compiled, &subject, next?);
            next = found.as_ref().map(|m| {
                if m.start() == m.end() {
                    self.advance(text, m.end())
                } else {
                    m.end()
                }
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
        for captures in self
            .exec_iter(text)
            .take(if self.flags.global { usize::MAX } else { 1 })
        {
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
            if !self.test(text) {
                parts.push(text);
            }
            return parts;
        }
        let compiled = self.unsticky();
        let subject = Subject::new(text, true);
        let mut from = 0;
        let mut at = 0;
        while at < text.len() {
            let Some(captures) = self.exec_in(compiled, &subject, at) else {
                break;
            };
            let end = captures.end().min(text.len());
            if captures.start() >= text.len() {
                break;
            }
            if end == from {
                at = self.advance(text, captures.start().max(at));
                continue;
            }
            parts.push(text.get(from..captures.start()).unwrap_or_default());
            parts.extend(
                (1..captures.len()).map(|i| captures.get(i).map_or(&[][..], Match::as_bytes)),
            );
            from = end;
            at = end;
        }
        parts.push(text.get(from..).unwrap_or_default());
        parts
    }

    /// `split` ignores the `y` flag.
    fn unsticky(&self) -> &Compiled {
        if !self.flags.sticky {
            return &self.compiled;
        }
        let flags = Flags {
            sticky: false,
            ..self.flags
        };
        let made = self
            .unsticky
            .get_or_init(|| compile(&self.source, flags).ok());
        made.as_ref().unwrap_or(&self.compiled)
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
        (start != NONE && end != NONE).then_some(Match {
            text: self.text,
            start,
            end,
        })
    }

    /// `match.groups[name]`
    pub fn name(&self, name: impl AsRef<[u8]>) -> Option<Match<'t>> {
        let (_, groups) = self
            .regex
            .names
            .iter()
            .find(|(known, _)| **known == *name.as_ref())?;
        groups.iter().find_map(|group| self.get(*group as usize))
    }

    /// `match.length`: one more than there are groups.
    #[inline]
    pub fn len(&self) -> usize {
        self.regex.group_count as usize
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
            let digit = |i: usize| {
                rest.get(i)
                    .filter(|b| b.is_ascii_digit())
                    .map(|b| usize::from(b - b'0'))
            };
            let mut used = 2;
            match rest.get(1) {
                Some(b'$') => out.push(b'$'),
                Some(b'&') => out.extend_from_slice(self.as_bytes()),
                Some(b'`') => {
                    out.extend_from_slice(self.text.get(..self.start()).unwrap_or_default())
                }
                Some(b'\'') => {
                    out.extend_from_slice(self.text.get(self.end()..).unwrap_or_default())
                }
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
