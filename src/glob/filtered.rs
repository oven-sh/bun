//! [`crate::match`], behind what tells most paths apart without it.

use crate::matcher::{self, Token};
use bun_core::strings;
use std::ops::Range;

/// Where the last name of `path` starts. A `/` at the end of the path belongs to it.
pub(crate) fn last_name_at(path: &[u8]) -> usize {
    let names = path.strip_suffix(b"/").unwrap_or(path);
    strings::last_index_of_char(names, b'/').map_or(0, |slash| slash + 1)
}

/// A pattern of Bun that has been read.
pub(crate) struct Filtered {
    pattern: Box<[u8]>,
    has_extglob: bool,
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

/// Whether what `part` matches is in one name. `is_in_group`: a group in it is not looked into.
fn stays_in_a_name(part: &[u8], has_extglob: bool, is_in_group: bool) -> bool {
    let mut at = 0;
    while at < part.len() {
        let (token, end) = matcher::token_at(part, at, has_extglob);
        let stays = match token {
            Token::Literal => part[at] != b'/',
            Token::Star | Token::Any => true,
            Token::Class => is_plain_class(&part[at..end]),
            // A `,` or a `|` is a character there, which changes nothing.
            Token::Group { first } if !is_in_group => {
                stays_in_a_name(&part[first..end - 1], has_extglob, true)
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

impl Filtered {
    /// `has_extglob`: `match_with::<true>`.
    pub(crate) fn read(pattern: &[u8], has_extglob: bool) -> Filtered {
        let mut read = Filtered {
            pattern: pattern.into(),
            has_extglob,
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
        // The runs of characters without magic, and where the names start that are outside of all groups.
        let mut runs: Vec<Range<usize>> = Vec::new();
        let mut starts = vec![0];
        let mut first_group = None;
        let (mut at, mut is_in_run, mut is_known) = (0, false, true);
        while at < pattern.len() {
            let (token, mut end) = matcher::token_at(pattern, at, has_extglob);
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
        read.heads = heads(pattern, &runs, first_group, has_extglob);

        let stays =
            |part: &[u8]| !part.starts_with(b"!") && stays_in_a_name(part, has_extglob, false);
        let ends = (starts.iter().skip(1).map(|it| it - 1)).chain([pattern.len()]);
        let parts = starts.iter().zip(ends).map(|(start, end)| *start..end);
        let names = parts.take_while(|it| stays(&pattern[it.clone()]));
        read.names = names.map(|it| it.start as u32..it.end as u32).collect();
        read.is_names_only = read.names.len() == starts.len();
        read.is_for_name = pattern.strip_prefix(b"**/").is_some_and(stays);
        read
    }

    #[inline]
    fn asks(&self, pattern: &[u8], path: &[u8]) -> matcher::MatchResult {
        match self.has_extglob {
            true => matcher::match_with::<true>(pattern, path),
            false => matcher::r#match(pattern, path),
        }
    }

    /// An odd number of `!` at its start.
    pub(crate) fn is_negated(&self) -> bool {
        self.is_negated
    }

    /// `name_at`: where the last name of `path` starts, to which a `/` at the end belongs.
    #[inline]
    pub(crate) fn matches(&self, path: &[u8], name_at: impl FnOnce() -> usize) -> bool {
        // Most tails are a few bytes, which are compared without a call.
        let tail = self.pattern.iter().rev().take(self.tail_len as usize);
        let ends_with_tail = path.len() >= self.tail_len as usize
            && path.iter().rev().zip(tail).all(|(a, b)| a == b);
        ends_with_tail && self.matches_whole(path, name_at)
    }

    fn matches_whole(&self, path: &[u8], name_at: impl FnOnce() -> usize) -> bool {
        let inner = &self.pattern[self.inner.start as usize..self.inner.end as usize];
        if !path.starts_with(&self.pattern[..self.start_len as usize])
            || !(inner.is_empty() || strings::contains(path, inner))
        {
            return false;
        }
        match self.is_for_name {
            true if !path.ends_with(b"/") => {
                (self.asks(&self.pattern[3..], &path[name_at()..])).matches()
            }
            _ => self.asks(&self.pattern, path).matches(),
        }
    }

    /// Whether something in `directory` can match. Never `false` if something can.
    pub(crate) fn may_match_inside(&self, directory: &[u8]) -> bool {
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
    pub(crate) fn heads(&self) -> Option<Vec<&[u8]>> {
        (!self.heads.is_empty()).then(|| self.heads.iter().map(|it| &it[..]).collect())
    }
}

/// [`Filtered::heads`]. `runs`: the characters without magic. `group`: where the first group starts, its first alternative, where it ends.
fn heads(
    pattern: &[u8],
    runs: &[Range<usize>],
    group: Option<(usize, usize, usize)>,
    has_extglob: bool,
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
            let mut tokens =
                (0..inside.len()).map(|it| matcher::token_at(inside, it, has_extglob).0);
            if !tokens.all(|it| it == Token::Literal) {
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
