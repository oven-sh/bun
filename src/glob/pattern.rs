//! A pattern that many paths are matched with: [`crate::match`], behind what tells most paths apart without it.

use crate::matcher::{self, Shape, Token};
use bun_core::strings;
use std::ops::Range;

/// A path that many patterns are matched with. Separated by `/`.
#[derive(Copy, Clone)]
pub struct Candidate<'p> {
    path: &'p [u8],
    /// Where the last name starts. A `/` at the end of the path belongs to it.
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

    /// The same for `path`: this one, which is empty or ends with a `/`, then a name, and a `/` or not.
    pub fn entry<'e>(&self, path: &'e [u8]) -> Candidate<'e> {
        let name_at = self.path.len();
        debug_assert_eq!(name_at, Candidate::new(path).name_at);
        Candidate { path, name_at }
    }

    /// The path as it is.
    pub fn path(&self) -> &'p [u8] {
        self.path
    }

    /// Its last name.
    pub fn name(&self) -> &'p [u8] {
        &self.path[self.name_at..]
    }

    /// Without the `/` at its end, if it has one.
    pub fn without_slash(&self) -> Option<Candidate<'p>> {
        let path = self.path.strip_suffix(b"/")?;
        Some(Candidate { path, ..*self })
    }
}

/// A pattern that has been read. `Send + Sync`.
pub struct Pattern {
    pattern: Box<[u8]>,
    has_extglob: bool,
    /// [`matcher::match_without_dot`]
    hides_dots: bool,
    /// An odd number of `!` at its start.
    is_negated: bool,
    /// What matches starts with one of these, up to a `/` or to its end. Empty: it is not known.
    heads: Box<[Box<[u8]>]>,
    /// What matches starts with this much of the pattern, and ends with this much of it.
    start_len: u32,
    tail_len: u32,
    /// This of the pattern is somewhere in what matches.
    inner: Range<u32>,
    /// `**/name`: only the last name of a path counts.
    is_for_name: bool,
    /// The names at the start, each of which takes one name of a path.
    names: Box<[Range<u32>]>,
    /// `names` are all of it.
    is_names_only: bool,
}

/// `[jt]`, `[a-z]`: letters and digits, so no `/`.
fn is_plain_class(class: &[u8]) -> bool {
    let inside = &class[1..class.len() - 1];
    let is_bound = |at: usize| inside.get(at).is_some_and(u8::is_ascii_alphanumeric);
    (0..inside.len()).all(|at| {
        is_bound(at) || inside[at] == b'-' && at > 0 && is_bound(at - 1) && is_bound(at + 1)
    })
}

/// Whether what `part` of `pattern` matches is in one name. `is_in_group`: a group in it is not looked into.
fn stays_in_a_name(pattern: &[u8], part: Range<usize>, shape: &Shape, is_in_group: bool) -> bool {
    let mut at = part.start;
    while at < part.end {
        let (token, end) = matcher::token_at(pattern, at, shape);
        let stays = match token {
            Token::Literal => pattern[at] != b'/',
            Token::Star | Token::Any => true,
            Token::Class => is_plain_class(&pattern[at..end]),
            // A `,` or a `|` is a character there, which changes nothing.
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
    /// `match(pattern, path)`.
    pub fn new(pattern: &[u8]) -> Pattern {
        Pattern::read(pattern, false)
    }

    /// `match_with::<true>(pattern, path)`.
    pub fn with_extglob(pattern: &[u8]) -> Pattern {
        Pattern::read(pattern, true)
    }

    /// `GlobSet::new` of oxc for one element: `./` is dropped, a pattern without `/` is for a name in any directory.
    pub fn of_oxc_glob_set(written: &[u8]) -> Pattern {
        match written.strip_prefix(b"./") {
            Some(rest) => Pattern::new(rest),
            None if strings::contains_char(written, b'/') => Pattern::new(written),
            None => Pattern::new(&[b"**/", written].concat()),
        }
    }

    /// `match_without_dot(pattern, path)`: `dot: false` of minimatch and of picomatch.
    pub fn without_dot(pattern: &[u8]) -> Pattern {
        Pattern {
            hides_dots: true,
            // A `**` does not get to every name.
            is_for_name: false,
            ..Pattern::read(pattern, true)
        }
    }

    fn read(pattern: &[u8], has_extglob: bool) -> Pattern {
        // Without a group it is the same.
        let has_extglob = has_extglob && strings::index_of_any(pattern, b"{(").is_some();
        let mut read = Pattern {
            pattern: pattern.into(),
            has_extglob,
            hides_dots: false,
            is_negated: false,
            heads: Box::default(),
            start_len: 0,
            tail_len: 0,
            inner: 0..0,
            is_for_name: false,
            names: Box::default(),
            is_names_only: false,
        };
        let bangs = matcher::negations(pattern, has_extglob);
        if bangs > 0 {
            read.is_negated = bangs % 2 == 1;
            return read;
        }
        let shape = Shape::of(pattern, has_extglob);
        // The runs of characters without magic, and where the names start that are outside of all groups.
        let mut runs: Vec<Range<usize>> = Vec::new();
        let mut starts = vec![0];
        let mut first_group = None;
        let (mut at, mut is_in_run, mut is_known) = (0, false, true);
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
                // The `/` behind it can be nothing.
                Token::Globstar if pattern.get(end) == Some(&b'/') => {
                    end += 1;
                    starts.push(end);
                }
                Token::Group { first } if first_group.is_none() => {
                    first_group = Some((at, first, end));
                }
                Token::Unknown => is_known = false,
                _ => {}
            }
            is_in_run = token == Token::Literal;
            at = end;
        }
        if !is_known {
            return read;
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
        read
    }

    #[inline]
    fn asks(&self, pattern: &[u8], path: &[u8]) -> matcher::MatchResult {
        match (self.has_extglob, self.hides_dots) {
            (_, true) => matcher::match_without_dot(pattern, path),
            (true, false) => matcher::match_with::<true>(pattern, path),
            (false, false) => matcher::match_on::<false>(pattern, path),
        }
    }

    /// `path` is separated by `/`.
    pub fn matches(&self, path: &[u8]) -> bool {
        match self.is_for_name {
            true => self.matches_candidate(&Candidate::new(path)),
            false => self.matches_candidate(&Candidate { path, name_at: 0 }),
        }
    }

    #[inline]
    pub fn matches_candidate(&self, candidate: &Candidate<'_>) -> bool {
        let path = candidate.path;
        // Most tails are a few bytes, which are compared without a call.
        let tail = self.pattern.iter().rev().take(self.tail_len as usize);
        let ends_with_tail = path.len() >= self.tail_len as usize
            && path.iter().rev().zip(tail).all(|(a, b)| a == b);
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
            Some(last) if self.is_for_name && *last != b'/' => {
                (self.asks(&self.pattern[3..], &path[candidate.name_at..])).matches()
            }
            _ => self.asks(&self.pattern, path).matches(),
        }
    }

    /// Whether something in `directory` can match. Never `false` if something can.
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
        // What is in it has one name more.
        !self.is_names_only || names.next().is_some()
    }

    /// What a path that matches starts with, up to a `/` or to its end: one of these. `None`: the pattern does not say.
    pub fn heads(&self) -> Option<Vec<&[u8]>> {
        (!self.heads.is_empty()).then(|| self.heads.iter().map(|it| &it[..]).collect())
    }
}

/// [`Pattern::heads`]. `runs`: the characters without magic. `group`: where the first group starts, its first alternative, where it ends.
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
    // All of a name, and so up to the last `/`, unless the pattern ends there.
    let whole_names = |text: Vec<u8>, is_all: bool| match is_all {
        true => text,
        false => text[..strings::last_index_of_char(&text, b'/').unwrap_or(0)].to_vec(),
    };
    let mut found = Vec::new();
    match group {
        // `{a,b}/..`, `@(a|b)/..`
        Some((at, first, end)) if at == start.end && matches!(pattern[at], b'{' | b'@') => {
            let after = run_from(end);
            let separator: &[u8] = if pattern[at] == b'{' { b"," } else { b"|" };
            let inside = &pattern[first..end - 1];
            let mut tokens = (first..end - 1).map(|it| matcher::token_at(pattern, it, shape).0);
            if shape.is_sequence_at(first) || !tokens.all(|it| it == Token::Literal) {
                return Box::default();
            }
            for alternative in strings::split(inside, separator) {
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
    /// A `\` as the last byte.
    Escape,
}

/// What starts at byte `at` is not closed.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Unclosed {
    pub kind: UnclosedKind,
    pub at: usize,
}

/// `validate` of the crate `fast-glob` 1.1.1, with which oxlint and oxfmt refuse a pattern.
pub fn unclosed(pattern: &[u8]) -> Option<Unclosed> {
    // How many groups are open, and where the outermost of them starts.
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
                // Here it is a character of the class.
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
