//! A compiled pattern for matching many paths. Cheap prefilters reject most paths before [`crate::match`] runs.

use crate::matcher::{self, Dots, Shape, Token};
use bun_core::strings;
use std::borrow::Cow;
use std::ops::Range;

/// A path that is matched against many patterns. It uses `/` as its separator.
#[derive(Copy, Clone)]
pub struct Candidate<'p> {
    path: &'p [u8],
    /// Index where the last segment starts. A trailing `/` belongs to that segment.
    name_at: usize,
}

impl<'p> Candidate<'p> {
    pub fn new(path: &'p [u8]) -> Candidate<'p> {
        let names = path.strip_suffix(b"/").unwrap_or(path);
        Candidate {
            path,
            name_at: strings::last_index_of_char(names, b'/').map_or(0, |slash| slash + 1),
        }
    }

    /// Builds the candidate for an entry of this directory. `path` is this path (empty or ending in `/`) plus one segment.
    pub fn entry<'e>(&self, path: &'e [u8]) -> Candidate<'e> {
        let name_at = self.path.len();
        debug_assert_eq!(name_at, Candidate::new(path).name_at);
        Candidate { path, name_at }
    }

    /// The whole path.
    pub fn path(&self) -> &'p [u8] {
        self.path
    }

    /// The last segment.
    pub fn name(&self) -> &'p [u8] {
        &self.path[self.name_at..]
    }

    /// The same path without its trailing `/`, if it has one.
    pub fn without_slash(&self) -> Option<Candidate<'p>> {
        let path = self.path.strip_suffix(b"/")?;
        Some(Candidate { path, ..*self })
    }
}

/// A compiled pattern. `Send + Sync`.
pub struct Pattern {
    pattern: Box<[u8]>,
    /// Shapes of the whole pattern and of the part after a leading `**/`.
    shapes: Box<[Shape; 2]>,
    dots: Dots,
    /// The pattern starts with an odd number of `!`.
    is_negated: bool,
    /// Every match starts with one of these, followed by `/` or the end of the path. Empty if unknown.
    heads: Box<[Box<[u8]>]>,
    /// Every match starts with this many bytes of the pattern and ends with this many.
    start_len: u32,
    tail_len: u32,
    /// Every match ends with one of these. Set instead of `tail_len` for a pattern that ends like `.{js,ts}`.
    tails: Box<[Box<[u8]>]>,
    /// The pattern is `**/*` followed by the tail, so a file name that ends with a tail is a match.
    is_star_and_tail: bool,
    /// Every match contains this range of the pattern.
    inner: Range<u32>,
    /// The pattern is `**/name`, so only the last segment of a path matters.
    is_for_name: bool,
    /// The leading segments that each match exactly one path segment.
    names: Box<[Range<u32>]>,
    /// `names` covers the whole pattern.
    is_names_only: bool,
}

/// Returns true for a class of letters and digits like `[jt]` or `[a-z]`, which can't match `/`.
fn is_plain_class(class: &[u8]) -> bool {
    let inside = &class[1..class.len() - 1];
    let is_bound = |at: usize| inside.get(at).is_some_and(u8::is_ascii_alphanumeric);
    (0..inside.len()).all(|at| {
        is_bound(at) || inside[at] == b'-' && at > 0 && is_bound(at - 1) && is_bound(at + 1)
    })
}

/// Returns true if `part` of `pattern` can only match within one path segment. With `is_in_group`, a nested group counts as unknown.
fn stays_in_a_name(pattern: &[u8], part: Range<usize>, shape: &Shape, is_in_group: bool) -> bool {
    let mut at = part.start;
    while at < part.end {
        let (token, end) = matcher::token_at(pattern, at, shape);
        let stays = match token {
            Token::Literal => pattern[at] != b'/',
            Token::Star | Token::Any => true,
            Token::Class => is_plain_class(&pattern[at..end]),
            // `,` and `|` show up as literals here, which doesn't change the answer.
            Token::Group { first } if !is_in_group => {
                stays_in_a_name(pattern, first..end - 1, shape, true)
            }
            _ => false,
        };
        if !stays {
            return false;
        }
        at = end;
    }
    true
}

impl Pattern {
    /// Compiles `pattern` for `match(pattern, path)`.
    pub fn new(pattern: &[u8]) -> Pattern {
        let mut read = Pattern {
            pattern: pattern.into(),
            shapes: Box::new([
                Shape::of(pattern),
                Shape::of(pattern.strip_prefix(b"**/").unwrap_or_default()),
            ]),
            dots: Dots::Match,
            is_negated: false,
            heads: Box::default(),
            start_len: 0,
            tail_len: 0,
            tails: Box::default(),
            is_star_and_tail: false,
            inner: 0..0,
            is_for_name: false,
            names: Box::default(),
            is_names_only: false,
        };
        let bangs = matcher::negations(pattern);
        if bangs > 0 {
            read.is_negated = bangs % 2 == 1;
            return read;
        }
        let shape = Shape::of(pattern);
        // Runs of literal bytes, and the start of each segment that is outside of all groups.
        let mut runs: Vec<Range<usize>> = Vec::new();
        let mut starts = vec![0];
        let mut first_group = None;
        let (mut at, mut is_in_run) = (0, false);
        while at < pattern.len() {
            let (token, mut end) = matcher::token_at(pattern, at, &shape);
            match token {
                Token::Literal => {
                    match runs.last_mut().filter(|_| is_in_run) {
                        Some(run) => run.end = end,
                        None => runs.push(at..end),
                    }
                    if pattern[at] == b'/' {
                        starts.push(end);
                    }
                }
                // The `/` after `**` can match nothing.
                Token::Globstar if pattern.get(end) == Some(&b'/') => {
                    end += 1;
                    starts.push(end);
                }
                Token::Group { first } => {
                    first_group.get_or_insert((at, first, end));
                    // So can the `/` after `{**,a}`.
                    if pattern.get(end) == Some(&b'/') {
                        end += 1;
                        starts.push(end);
                    }
                }
                _ => {}
            }
            is_in_run = token == Token::Literal;
            at = end;
        }
        if is_in_run && let Some(run) = runs.last() {
            read.tail_len = run.len() as u32;
        }
        if let Some(run) = runs.first().filter(|it| it.start == 0) {
            read.start_len = run.end as u32;
        }
        let between = (runs.iter()).filter(|it| it.start > 0 && it.end < pattern.len());
        if let Some(run) = between.max_by_key(|it| it.len()) {
            read.inner = run.start as u32..run.end as u32;
        }
        read.heads = heads(pattern, &runs, first_group, &shape);

        let stays = |part: &Range<usize>| {
            pattern.get(part.start) != Some(&b'!')
                && stays_in_a_name(pattern, part.clone(), &shape, false)
        };
        let ends = (starts.iter().skip(1).map(|it| it - 1)).chain([pattern.len()]);
        let parts = starts.iter().zip(ends).map(|(start, end)| *start..end);
        let names = parts.take_while(stays);
        read.names = names.map(|it| it.start as u32..it.end as u32).collect();
        read.is_names_only = read.names.len() == starts.len();
        read.is_for_name = pattern.starts_with(b"**/") && stays(&(3..pattern.len()));
        let (tails, tail_start) = tails(pattern, &shape);
        read.is_star_and_tail = read.is_for_name
            && tail_start == 4
            && pattern.is_ascii()
            && matcher::token_at(pattern, 3, &shape) == (Token::Star, 4);
        if tails.len() > 1 || tails[0].len() != read.tail_len as usize {
            read.tail_len = 0;
            read.tails = tails.into_iter().map(Vec::into_boxed_slice).collect();
        }
        read
    }

    pub fn with_dots(pattern: &[u8], dots: Dots) -> Pattern {
        Pattern {
            dots,
            ..Pattern::new(pattern)
        }
    }

    /// One element of oxc's `GlobSet::new`. A leading `./` is dropped, and a pattern without `/` matches in any directory.
    /// oxc puts the `**/` in front of a leading `!` too, which makes the `!` a literal, so `!a.js` matches no `a.js` there.
    pub fn of_oxc_glob_set(written: &[u8]) -> Pattern {
        Pattern::new(&in_any_directory(&of_fast_glob(written)))
    }

    /// A pattern from `overrides` in bunfig.toml. It has all of `Bun.Glob`'s syntax. A leading `./` is dropped, and a pattern
    /// without `/` matches in any directory.
    pub fn of_bunfig(written: &[u8]) -> Pattern {
        // Leading `!`s negate the whole pattern, so they stay in front.
        let (bangs, rest) = written.split_at(matcher::negations(written));
        Pattern::new(&[bangs, &in_any_directory(rest)].concat())
    }

    #[inline]
    fn asks(&self, pattern: &[u8], path: &[u8]) -> matcher::MatchResult {
        let of_part;
        let shape = match self.pattern.len() - pattern.len() {
            0 => &self.shapes[0],
            3 if self.is_for_name => &self.shapes[1],
            _ => {
                of_part = Shape::of(pattern);
                &of_part
            }
        };
        matcher::match_prepared::<false>(pattern, shape, path, self.dots)
    }

    /// `path` uses `/` as its separator.
    pub fn matches(&self, path: &[u8]) -> bool {
        match self.is_for_name {
            true => self.matches_candidate(&Candidate::new(path)),
            false => self.matches_candidate(&Candidate { path, name_at: 0 }),
        }
    }

    #[inline]
    pub fn matches_candidate(&self, candidate: &Candidate<'_>) -> bool {
        let path = candidate.path;
        // Most tails are a few bytes. Compare them inline.
        let tail = self.pattern.iter().rev().take(self.tail_len as usize);
        let ends_with_tail = path.len() >= self.tail_len as usize
            && path.iter().rev().zip(tail).all(|(a, b)| a == b)
            && (self.tails.is_empty() || self.tails.iter().any(|it| path.ends_with(it)));
        ends_with_tail && self.matches_whole(candidate)
    }

    fn matches_whole(&self, candidate: &Candidate<'_>) -> bool {
        let path = candidate.path;
        let inner = &self.pattern[self.inner.start as usize..self.inner.end as usize];
        if !path.starts_with(&self.pattern[..self.start_len as usize])
            || !(inner.is_empty() || strings::contains(path, inner))
        {
            return false;
        }
        match path.last() {
            // `**` can't cross some dot segments. Ask the full pattern if the directory has one.
            Some(last) if self.is_for_name && *last != b'/' => {
                let (before, name) = path.split_at(candidate.name_at);
                let is_name_match = match self.is_star_and_tail {
                    true => match self.dots {
                        Dots::Match => true,
                        Dots::SkipTraversal => !matches!(name, b"." | b".."),
                        Dots::Hide => !name.starts_with(b"."),
                    },
                    false => self.asks(&self.pattern[3..], name).matches(),
                };
                is_name_match
                    && (self.dots == Dots::Match
                        || !matcher::has_closed_segment::<false>(before, self.dots)
                        || self.asks(&self.pattern, path).matches())
            }
            _ => self.asks(&self.pattern, path).matches(),
        }
    }

    /// Returns false only if nothing inside `directory` can match.
    pub fn may_match_inside(&self, directory: &[u8]) -> bool {
        if self.is_negated || directory.is_empty() {
            return true;
        }
        let mut names = self.names.iter();
        for name in strings::split(directory, b"/") {
            match names.next() {
                Some(it) => {
                    let part = &self.pattern[it.start as usize..it.end as usize];
                    if !self.asks(part, name).matches() {
                        return false;
                    }
                }
                None => return !self.is_names_only,
            }
        }
        // Anything inside has at least one more segment.
        !self.is_names_only || names.next().is_some()
    }

    /// Every match starts with one of these, followed by `/` or the end of the path. `None` if unknown.
    pub fn heads(&self) -> Option<Vec<&[u8]>> {
        (!self.heads.is_empty()).then(|| self.heads.iter().map(|it| &it[..]).collect())
    }
}

/// Drops a leading `./`, or else puts `**/` in front of a pattern without `/` so that it matches in any directory.
fn in_any_directory(pattern: &[u8]) -> Cow<'_, [u8]> {
    match pattern.strip_prefix(b"./") {
        Some(rest) => Cow::Borrowed(rest),
        None if strings::contains_char(pattern, b'/') => Cow::Borrowed(pattern),
        None => Cow::Owned([b"**/", pattern].concat()),
    }
}

/// `glob_match` of the `fast-glob` crate. A pattern with an unclosed `[` or `{` or a trailing `\` never matches there.
pub fn fast_glob_match(pattern: &[u8], text: &[u8]) -> bool {
    unclosed(pattern).is_none()
        && matcher::match_on::<false>(&of_fast_glob(pattern), text).matches()
}

/// Converts a pattern for the `fast-glob` crate, which oxlint and oxfmt use. It has no `@(a|b)` groups and no `{1..3}` sequences.
pub fn of_fast_glob(written: &[u8]) -> Cow<'_, [u8]> {
    if strings::index_of_char_usize(written, b'(').is_none() && !strings::contains(written, b"..") {
        return Cow::Borrowed(written);
    }
    let mut pattern = Vec::with_capacity(written.len() + 2);
    let mut at = 0;
    while let Some(&byte) = written.get(at) {
        let len = match byte {
            b'\\' => 2,
            b'[' => matcher::class_end(written, at).map_or(1, |end| end - at),
            _ => 1,
        };
        // An escaped `.` still matches `.`, and `{1\..3}` no longer parses as a sequence.
        if byte == b'(' || byte == b'.' && written.get(at + 1) == Some(&b'.') {
            pattern.push(b'\\');
        }
        pattern.extend_from_slice(&written[at..(at + len).min(written.len())]);
        at += len;
    }
    Cow::Owned(pattern)
}

/// Expands the literals and groups of literals at the end of the pattern, like `.d.{ts,mts}`. Every match ends with one of
/// the returned strings. Also returns the index where that part of the pattern starts.
fn tails(pattern: &[u8], shape: &Shape) -> (Vec<Vec<u8>>, usize) {
    // More tails than this cost more to compare than they save.
    const MOST: usize = 16;
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < pattern.len() {
        let (token, end) = matcher::token_at(pattern, at, shape);
        tokens.push((token, at, end));
        at = end;
    }
    // Built back to front.
    let mut reversed = vec![Vec::new()];
    let mut start = pattern.len();
    for (index, &(token, at, end)) in tokens.iter().enumerate().rev() {
        match token {
            Token::Literal => {
                // The `/` after `**` or after a group like `{**,a}` can match nothing.
                let before = index.checked_sub(1).map(|it| tokens[it].0);
                if pattern[at] == b'/'
                    && matches!(before, Some(Token::Globstar | Token::Group { .. }))
                {
                    break;
                }
                for tail in &mut reversed {
                    tail.push(pattern[at]);
                }
            }
            Token::Group { first } if matches!(pattern[at], b'{' | b'@') => {
                let mut inside = (first..end - 1).map(|it| matcher::token_at(pattern, it, shape).0);
                if shape.is_sequence_at(first) || !inside.all(|it| it == Token::Literal) {
                    break;
                }
                let alternatives = || shape.alternatives_at(first).map(|it| &pattern[it]);
                if alternatives().count() * reversed.len() > MOST {
                    break;
                }
                let longer = |tail: &Vec<u8>| {
                    alternatives()
                        .map(|it| tail.iter().chain(it.iter().rev()).copied().collect())
                        .collect::<Vec<Vec<u8>>>()
                };
                reversed = reversed.iter().flat_map(longer).collect();
            }
            _ => break,
        }
        start = at;
    }
    for tail in &mut reversed {
        tail.reverse();
    }
    (reversed, start)
}

/// Computes [`Pattern::heads`]. `runs` are the literal runs. `group` is the first group's start, first alternative and end.
fn heads(
    pattern: &[u8],
    runs: &[Range<usize>],
    group: Option<(usize, usize, usize)>,
    shape: &Shape,
) -> Box<[Box<[u8]>]> {
    let run_from = |at: usize| {
        runs.iter()
            .find(|it| it.start == at)
            .map_or(at..at, Range::clone)
    };
    let start = run_from(0);
    // A head is made of whole segments, so cut at the last `/` unless the pattern ends here.
    let whole_names = |text: Vec<u8>, is_all: bool| match is_all {
        true => text,
        false => text[..strings::last_index_of_char(&text, b'/').unwrap_or(0)].to_vec(),
    };
    let mut found = Vec::new();
    match group {
        // `{a,b}/..`, `@(a|b)/..`
        Some((at, first, end)) if at == start.end && matches!(pattern[at], b'{' | b'@') => {
            let after = run_from(end);
            let mut tokens = (first..end - 1).map(|it| matcher::token_at(pattern, it, shape).0);
            if shape.is_sequence_at(first) || !tokens.all(|it| it == Token::Literal) {
                return Box::default();
            }
            for alternative in shape.alternatives_at(first).map(|it| &pattern[it]) {
                let text = [
                    &pattern[start.clone()],
                    alternative,
                    &pattern[after.clone()],
                ]
                .concat();
                found.push(whole_names(text, after.end == pattern.len()));
            }
        }
        _ => found.push(whole_names(
            pattern[start.clone()].to_vec(),
            start.end == pattern.len(),
        )),
    }
    match found.iter().all(|it| !it.is_empty()) {
        true => found.into_iter().map(Vec::into_boxed_slice).collect(),
        false => Box::default(),
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UnclosedKind {
    Class,
    Braces,
    /// A trailing `\`.
    Escape,
}

/// The construct that starts at byte `at` isn't closed.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Unclosed {
    pub kind: UnclosedKind,
    pub at: usize,
}

/// Port of `validate` from the `fast-glob` crate 1.1.1. oxlint and oxfmt reject a pattern that fails it.
pub fn unclosed(pattern: &[u8]) -> Option<Unclosed> {
    // Number of open groups, and the start of the outermost one.
    let (mut depth, mut outermost) = (0_usize, 0);
    let mut at = 0;
    while let Some(&byte) = pattern.get(at) {
        match byte {
            b'\\' if at + 1 == pattern.len() => {
                let kind = UnclosedKind::Escape;
                return Some(Unclosed { kind, at });
            }
            b'\\' => at += 1,
            b'[' => {
                let mut end = at + 1;
                end += usize::from(matches!(pattern.get(end), Some(b'!' | b'^')));
                // A `]` here is a member of the class.
                end += usize::from(pattern.get(end) == Some(&b']'));
                loop {
                    match pattern.get(end) {
                        None => {
                            let kind = UnclosedKind::Class;
                            return Some(Unclosed { kind, at });
                        }
                        Some(b']') => break,
                        Some(b'\\') => end += 2,
                        Some(_) => end += 1,
                    }
                }
                at = end;
            }
            b'{' => {
                if depth == 0 {
                    outermost = at;
                }
                depth += 1;
            }
            b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
        at += 1;
    }
    (depth > 0).then_some(Unclosed {
        kind: UnclosedKind::Braces,
        at: outermost,
    })
}
