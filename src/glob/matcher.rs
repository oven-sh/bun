// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) 2023 Devon Govett
// Copyright (c) 2023 Stephen Gregoratto
// Copyright (c) 2024 shulaoda
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

use bun_collections::smallvec::SmallVec;
use bun_core::{Once, strings};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, Ordering};

/// Result of [`match`](r#match). Two independent bits: whether the path matched
/// (after applying any leading `!` negation), and whether the pattern was negated.
/// Most callers only want [`matches()`](Self::matches); the negation bit is for
/// multi-pattern filter loops where a `!pattern` hit is a hard veto.
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct MatchResult {
    matches: bool,
    negated: bool,
}

impl MatchResult {
    const NO: MatchResult = MatchResult {
        matches: false,
        negated: false,
    };

    /// Overall result: did the path match the pattern? Leading `!`s are already
    /// applied, so `!foo` against `bar` matches and `!foo` against `foo` does not.
    #[inline]
    pub fn matches(self) -> bool {
        self.matches
    }

    /// Was the pattern `!`-prefixed (an odd number of times)? Combine with
    /// `!matches()` to detect an explicit rejection by a negated pattern.
    /// Callers can't derive this from the pattern string because leading `!`s
    /// toggle (`!!foo` is un-negated).
    #[inline]
    pub fn is_negated(self) -> bool {
        self.negated
    }
}

#[derive(Copy, Clone)]
struct State {
    path_index: u32,
    glob_index: u32,

    wildcard: Wildcard,
    globstar: Wildcard,

    seen: Seen,
    /// No `[` at or after this index is closed.
    no_class_from: u32,
    /// What looks like a group at this index isn't one.
    not_group_at: u32,
    /// How the loop has ended.
    outcome: Outcome,
}

impl State {
    #[inline(always)]
    fn at(glob_index: u32, path_index: u32, seen: Seen) -> State {
        State {
            path_index,
            glob_index,
            wildcard: Wildcard::default(),
            globstar: Wildcard::default(),
            seen,
            no_class_from: u32::MAX,
            not_group_at: u32::MAX,
            outcome: Outcome::No,
        }
    }

    /// Goes back to the last `*` or `**`. Returns false if there's none that can take more.
    #[inline(always)]
    fn goes_back(&mut self, path: &[u8]) -> bool {
        let can = self.wildcard.path_index > 0 && self.wildcard.path_index as usize <= path.len();
        if can {
            self.backtrack();
        }
        can
    }

    #[inline(always)]
    fn backtrack(&mut self) {
        self.path_index = self.wildcard.path_index;
        self.glob_index = self.wildcard.glob_index;
    }

    #[inline(always)]
    fn skip_to_separator(&mut self, path: &[u8], is_end_invalid: bool, is_windows: bool) {
        let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
        if self.path_index as usize == path.len() {
            self.wildcard.path_index += 1;
            self.globstar = self.wildcard;
            return;
        }

        let mut path_index = self.path_index;
        while (path_index as usize) < path.len() && !is_separator(path[path_index as usize]) {
            path_index += 1;
        }

        if is_end_invalid || path_index as usize != path.len() {
            path_index += 1;
        }

        self.wildcard.path_index = path_index;
        self.globstar = self.wildcard;
    }
}

#[derive(Copy, Clone, Default)]
struct Wildcard {
    // Using u32 rather than usize for these results in 10% faster performance.
    glob_index: u32,
    path_index: u32,
}

/// This function checks returns a boolean value if the pathname `path` matches
/// the pattern `glob`.
///
/// The supported pattern syntax for `glob` is:
///
/// "?"
///     Matches any single character.
/// "*"
///     Matches zero or more characters, except for path separators ('/' or '\').
/// "**"
///     Matches zero or more characters, including path separators.
///     Must match a complete path segment, i.e. followed by a path separator or
///     at the end of the pattern.
/// "[ab]"
///     Matches one of the characters contained in the brackets.
///     Character ranges (e.g. "[a-z]") are also supported.
///     Use "[!ab]" or "[^ab]" to match any character *except* those contained
///     in the brackets.
/// "{a,b}"
///     Match one of the patterns contained in the braces.
///     Any of the wildcards listed above can be used in the sub patterns.
/// "{1..3}", "{a..e}", "{1..9..2}", "{01..10}"
///     Matches any number or letter in the range. A third value is the step.
///     If either bound has a leading zero, every number is zero-padded to the
///     width of the longer bound.
/// "?(a|b)"
///     Matches zero or one of the patterns.
/// "*(a|b)"
///     Matches zero or more of the patterns.
/// "+(a|b)"
///     Matches one or more of the patterns.
/// "@(a|b)"
///     Matches exactly one of the patterns.
/// "!(a|b)"
///     Matches anything within a path segment except the patterns.
/// "!"
///     Negates the result when at the start of the pattern, unless a "(" follows.
///     Multiple "!" characters negate the pattern multiple times.
/// "\"
///     Used to escape any of the special characters above.
///
/// Parentheses without a "?*+@!" prefix are literal, and so is an unclosed "[",
/// "{" or "(".
///
/// Groups can nest to any depth. Matching takes `O(glob.len() * path.len())` time and
/// a constant amount of stack. See [`Program`].
pub fn r#match(glob: &[u8], path: &[u8]) -> MatchResult {
    match_on::<{ cfg!(windows) }>(glob, path)
}

/// [`match`](r#match) with an explicit platform. With `WINDOWS`, `\` in `path` is also a separator.
/// Use `match_on::<false>` for text that isn't a file path and for paths already normalized to `/`.
#[inline]
pub fn match_on<const WINDOWS: bool>(glob: &[u8], path: &[u8]) -> MatchResult {
    match_from_first_byte(glob, None, path, Mode::new::<WINDOWS>(Dots::Match))
}

/// How wildcards treat path segments that start with `.`.
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub enum Dots {
    /// Like any other segment.
    #[default]
    Match,
    /// Wildcards don't match the segments `.` and `..`. This is `dot: true` in minimatch and picomatch.
    SkipTraversal,
    /// Wildcards also don't match a `.` at the start of a segment. This is `dot: false` in minimatch and picomatch.
    Hide,
}

/// [`match_on`] for a pattern that is matched against many paths. `shape` must be `Shape::of(glob)`.
#[inline]
pub fn match_prepared<const WINDOWS: bool>(
    glob: &[u8],
    shape: &Shape,
    path: &[u8],
    dots: Dots,
) -> MatchResult {
    match_from_first_byte(glob, Some(shape), path, Mode::new::<WINDOWS>(dots))
}

/// This is at the call site. Most paths that a pattern is asked about differ from it in the first byte.
#[inline(always)]
fn match_from_first_byte(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    mode: Mode,
) -> MatchResult {
    let Some(&first) = glob.first() else {
        return MatchResult {
            matches: path.is_empty(),
            negated: false,
        };
    };
    let is_plain = IS_PLAIN[first as usize];
    if is_plain && path.first() != Some(&first) {
        return MatchResult::NO;
    }
    // An escaped character that stands for itself is as good as a literal.
    let differs_at_once = || {
        first == b'\\'
            && glob.get(1).is_some_and(|it| {
                path.first() != Some(it)
                    && !matches!(it, b'b' | b'n' | b'r' | b't' | b'/' | b'\\' | 0x80..)
            })
    };

    if let Some(shape) = shape {
        let uses = shape.uses.load(Ordering::Relaxed);
        // From now on a `Walk` decides.
        if uses == Shape::WALKS {
            return match first {
                b'\\' if differs_at_once() => MatchResult::NO,
                _ => match_warm(glob, shape, path, mode),
            };
        }
        shape.count(glob, uses);
    }
    match first {
        _ if is_plain => match_literal(glob, shape, path, mode),
        b'\\' if differs_at_once() => MatchResult::NO,
        b'*' => match glob.get(1) {
            Some(b'*') if is_globstar_before_text(glob, 0, 0) => {
                match_after_globstar(glob, shape, path, Start::of(mode))
            }
            Some(b'?' | b'[') if is_last_star(glob, 0) => {
                match_last_star(glob, shape, path, Start::of(mode))
            }
            _ => match_more(glob, shape, path, Start::of(mode), None),
        },
        b'!' => match_negated(glob, shape, path, mode),
        b'\\' | b'?' | b'[' | 0x80.. => match_escapes_at_start(glob, shape, path, mode),
        b'{' => match_choices(glob, shape, path, Start::of(mode)),
        _ => match_more(glob, shape, path, Start::of(mode), None),
    }
}

/// Matches a pattern that was written out for one alternative of a group.
#[inline(never)]
fn match_written(pattern: &[u8], text: &[u8], mode: Mode) -> bool {
    match_from_first_byte(pattern, None, text, mode).matches
}

/// How a match is asked for. The platform is a value and not a type parameter, so that a build for Windows has everything once.
/// Elsewhere nothing asks for it, so it isn't there, and asking for it doesn't compile.
#[derive(Copy, Clone)]
struct Mode {
    dots: Dots,
    #[cfg(any(windows, debug_assertions))]
    is_windows: bool,
}

impl Mode {
    #[inline(always)]
    fn new<const WINDOWS: bool>(dots: Dots) -> Mode {
        const { assert!(!WINDOWS || cfg!(any(windows, debug_assertions))) }
        Mode::on(dots, WINDOWS)
    }

    #[inline(always)]
    fn on(dots: Dots, is_windows: bool) -> Mode {
        _ = is_windows;
        Mode {
            dots,
            #[cfg(any(windows, debug_assertions))]
            is_windows,
        }
    }

    #[cfg(any(windows, debug_assertions))]
    #[inline(always)]
    fn is_windows(self) -> bool {
        self.is_windows
    }

    #[cfg(not(any(windows, debug_assertions)))]
    #[inline(always)]
    fn is_windows(self) -> bool {
        false
    }
}

/// Where the loop starts.
#[derive(Copy, Clone)]
struct Start {
    /// Index of the pattern after the leading `!`s.
    glob_start: u32,
    /// Indexes of the pattern and of the path after what has been taken.
    glob_index: u32,
    path_index: u32,
    seen: Seen,
    mode: Mode,
}

impl Start {
    #[inline(always)]
    fn of(mode: Mode) -> Start {
        Start {
            glob_start: 0,
            glob_index: 0,
            path_index: 0,
            seen: Seen::OnlyRegular,
            mode,
        }
    }
}

/// Takes the literal bytes that the pattern starts with. They need nothing of what follows.
#[inline(never)]
fn match_literal(glob: &[u8], shape: Option<&Shape>, path: &[u8], mode: Mode) -> MatchResult {
    let is_windows = mode.is_windows();
    let mut taken = 0;
    while let Some(&wanted) = glob.get(taken) {
        let is_same = match path.get(taken) {
            Some(&found) if IS_PLAIN[wanted as usize] => found == wanted,
            Some(&found) if wanted == b'/' => is_separator(found, is_windows),
            None if IS_PLAIN[wanted as usize] || wanted == b'/' => false,
            _ => break,
        };
        if !is_same {
            return MatchResult::NO;
        }
        taken += 1;
    }
    if taken == glob.len() {
        return MatchResult {
            matches: taken == path.len(),
            negated: false,
        };
    }
    let start = Start {
        glob_index: taken as u32,
        path_index: taken as u32,
        ..Start::of(mode)
    };
    if is_globstar_before_text(glob, 0, taken) {
        return match_after_globstar(glob, shape, path, start);
    }
    if glob[taken] == b'{' {
        return match_choices(glob, shape, path, start);
    }
    if is_last_star(glob, taken) {
        return match_last_star(glob, shape, path, start);
    }
    match matches!(glob[taken], b'\\' | b'?' | b'[' | 0x80..) {
        true => match_escapes(glob, shape, path, start),
        false => match_more(glob, shape, path, start, None),
    }
}

/// There's a `**/` at `index` that is a whole segment, and a literal or a `{` after it.
#[inline(always)]
fn is_globstar_before_text(glob: &[u8], glob_start: usize, index: usize) -> bool {
    matches!(glob[index..], [b'*', b'*', b'/', after, ..] if IS_TEXT[after as usize] || after == b'{')
        && (index == glob_start || glob[index - 1] == b'/')
}

/// How far `tail` goes on with segments that are a literal, or a group like `{a,b}` of literals, and that end with a `/`.
/// Also returns where the literal after them ends, and whether there was a group.
#[inline(always)]
fn plain_segments(tail: &[u8]) -> (usize, usize, bool) {
    let (mut end, mut at, mut has_group) = (0, 0, false);
    loop {
        if tail.get(at) == Some(&b'{') {
            let mut commas = 0;
            loop {
                let first = at + 1;
                at = first;
                while tail.get(at).is_some_and(|it| IS_TEXT[*it as usize]) {
                    at += 1;
                }
                match tail.get(at) {
                    Some(b',') if at > first => commas += 1,
                    Some(b'}') if at > first && commas > 0 => break,
                    _ => return (end, end, has_group),
                }
            }
            at += 1;
            if tail.get(at) != Some(&b'/') {
                return (end, end, has_group);
            }
            has_group = true;
        } else {
            let first = at;
            while tail.get(at).is_some_and(|it| IS_TEXT[*it as usize]) {
                at += 1;
            }
            if at == first || tail.get(at) != Some(&b'/') {
                return (end, at, has_group);
            }
        }
        at += 1;
        end = at;
    }
}

/// Returns how much of `text` the [`plain_segments`] `wanted` take, if it starts with them.
#[inline(always)]
fn take_plain_segments(wanted: &[u8], text: &[u8], is_windows: bool) -> Option<usize> {
    let (mut at, mut taken) = (0, 0);
    while let Some(&ch) = wanted.get(at) {
        if ch != b'{' {
            let found = *text.get(taken)?;
            if found != ch && !(ch == b'/' && is_separator(found, is_windows)) {
                return None;
            }
            at += 1;
            taken += 1;
            continue;
        }
        // The alternative that is the whole segment.
        loop {
            at += 1;
            let mut len = 0;
            while IS_TEXT[wanted[at] as usize] && text.get(taken + len) == Some(&wanted[at]) {
                at += 1;
                len += 1;
            }
            let fits = !IS_TEXT[wanted[at] as usize]
                && text
                    .get(taken + len)
                    .is_some_and(|it| is_separator(*it, is_windows));
            while fits && wanted[at] != b'}' || IS_TEXT[wanted[at] as usize] {
                at += 1;
            }
            if fits {
                taken += len;
                break;
            }
            if wanted[at] == b'}' {
                return None;
            }
        }
        at += 1;
    }
    Some(taken)
}

/// `start` is at a `**/`. As long as [`plain_segments`] and a `**` follow, like in `**/node_modules/**`, the first place in the path
/// where they are is as good as any other. Literals up to the end of the pattern are how the path has to end.
#[inline(never)]
fn match_after_globstar(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    mut start: Start,
) -> MatchResult {
    let is_windows = start.mode.is_windows();
    #[cfg(debug_assertions)]
    let expected = match_more(glob, None, path, start, None);
    let matched = loop {
        let tail = &glob[start.glob_index as usize + 3..];
        let rest = &path[start.path_index as usize..];
        if start.mode.dots != Dots::Match {
            return match_more(glob, shape, path, start, None);
        }
        let (segments, literal, has_group) = plain_segments(tail);
        if literal == tail.len() && literal > segments && !has_group {
            let before = rest.len().checked_sub(literal);
            break before.is_some_and(|before| {
                take_plain_segments(tail, &rest[before..], is_windows).is_some()
                    && (before == 0 || is_separator(rest[before - 1], is_windows))
            });
        }
        if segments == 0 || !matches!(tail[segments..], [b'*', b'*'] | [b'*', b'*', b'/', ..]) {
            return match_more(glob, shape, path, start, None);
        }
        let mut from = 0;
        let taken = loop {
            if let Some(taken) = take_plain_segments(&tail[..segments], &rest[from..], is_windows) {
                break Some(from + taken);
            }
            while let Some(&found) = rest.get(from)
                && !is_separator(found, is_windows)
            {
                from += 1;
            }
            if from == rest.len() {
                break None;
            }
            from += 1;
        };
        let Some(taken) = taken else {
            break false;
        };
        if tail.len() == segments + 2 {
            break true;
        }
        start.glob_index += 3 + segments as u32;
        start.path_index += taken as u32;
        if has_group {
            start.seen = Seen::Choice;
        }
    };
    let negated = start.glob_start % 2 == 1;
    let result = MatchResult {
        matches: matched != negated,
        negated,
    };
    #[cfg(debug_assertions)]
    debug_assert!(result == expected);
    result
}

/// There's a `*` at `index` and no literal after it, which the loop would be fast with. The pattern doesn't end like one that has
/// another `*` or a group.
#[inline(always)]
fn is_last_star(glob: &[u8], index: usize) -> bool {
    match glob[index..] {
        [b'*'] => true,
        [b'*', b'?' | b'[', ..] => !matches!(glob[glob.len() - 1], b'}' | b')' | b'*'),
        _ => false,
    }
}

/// `start` is at a `*`. If every token after it takes one character, they take the end of the path, and the `*` takes what's before.
#[inline(never)]
fn match_last_star(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    mut start: Start,
) -> MatchResult {
    #[cfg(debug_assertions)]
    let expected = match_more(glob, None, path, start, None);
    let mut at = start.glob_index as usize + 1;
    let mut width = 0;
    let mut is_fixed = start.mode.dots == Dots::Match && start.seen == Seen::OnlyRegular;
    while is_fixed && let Some(&ch) = glob.get(at) {
        at = match ch {
            _ if IS_PLAIN[ch as usize] => at + 1,
            b'?' if glob.get(at + 1) != Some(&b'(') => at + 1,
            b'\\' if glob.get(at + 1).is_some_and(|it| *it < 128 && *it != b'/') => at + 2,
            b'[' if let Some((_, close, _)) = ascii_class::<false>(glob, at, 0) => close + 1,
            _ => {
                is_fixed = false;
                at
            }
        };
        width += 1;
    }
    let rest = &path[start.path_index as usize..];
    let before = rest.len().saturating_sub(width);
    if !is_fixed || !rest[before..].is_ascii() {
        return match_more(glob, shape, path, start, None);
    }
    let is_windows = start.mode.is_windows();
    let fits = rest.len() >= width
        && !rest[..before]
            .iter()
            .any(|it| is_separator(*it, is_windows));
    let result = if !fits || width == 0 {
        let negated = start.glob_start % 2 == 1;
        MatchResult {
            matches: fits != negated,
            negated,
        }
    } else {
        start.glob_index += 1;
        start.path_index += before as u32;
        match_escapes(glob, shape, path, start)
    };
    #[cfg(debug_assertions)]
    debug_assert!(result == expected);
    result
}

/// `start` is at a `{`. If all that the pattern has from there on is that group, literals, `*` and `**`, each alternative with
/// what follows the group is a pattern of its own. Returns whether one of them matches the rest of the path.
#[inline(never)]
fn match_branches(glob: &[u8], path: &[u8], start: &Start) -> Option<bool> {
    let open = start.glob_index as usize;
    let starts_segment = open == start.glob_start as usize || glob[open - 1] == b'/';
    // Where the alternatives end.
    let mut ends = [0; 4];
    let (mut count, mut close) = (0, 0);
    let mut ends_with_globstar = false;
    let mut at = open + 1;
    while let Some(&ch) = glob.get(at) {
        if !IS_TEXT[ch as usize] && ch != b'/' {
            let is_inside = close == 0;
            match ch {
                b',' | b'}' if is_inside => {
                    *ends.get_mut(count)? = at;
                    count += 1;
                    if ch == b'}' {
                        close = at;
                    }
                }
                b'*' if glob.get(at + 1) == Some(&b'*') => {
                    // It has to be a whole segment once it's written out.
                    let before = glob[at - 1];
                    let is_first = is_inside && (at - 1 == open || before == b',');
                    if before != b'/' && !(is_first && starts_segment) {
                        return None;
                    }
                    at += 1;
                    match glob.get(at + 1) {
                        None | Some(b'/') => {}
                        Some(b',' | b'}') if is_inside => ends_with_globstar = true,
                        _ => return None,
                    }
                }
                b'*' => {}
                _ => return None,
            }
        }
        at += 1;
    }
    let after = &glob[close + 1..];
    if count < 2
        || close == 0
        || after.first() == Some(&b'*')
        || ends_with_globstar && !matches!(after.first(), None | Some(b'/'))
    {
        return None;
    }
    let rest = &path[start.path_index as usize..];
    let mode = Mode::on(Dots::Match, start.mode.is_windows());
    let mut written = [0; 64];
    let mut from = open + 1;
    let mut matched = false;
    for &to in &ends[..count] {
        let alternative = &glob[from..to];
        from = to + 1;
        // Most alternatives start with a literal that the path doesn't go on with.
        if let Some(first) = alternative.first()
            && IS_PLAIN[*first as usize]
            && rest.first() != Some(first)
        {
            continue;
        }
        let mut pattern = alternative;
        if !after.is_empty() {
            let it = written.get_mut(..alternative.len() + after.len())?;
            for (to, from) in std::iter::zip(&mut *it, alternative.iter().chain(after)) {
                *to = *from;
            }
            pattern = it;
        }
        // That has a rule of its own.
        if pattern.ends_with(b"**/*") {
            return None;
        }
        if match_written(pattern, rest, mode) {
            matched = true;
            break;
        }
    }
    #[cfg(debug_assertions)]
    {
        let mut parsed = Parsed::new();
        parsed.read(glob);
        let (top, is_windows) = (start.glob_start, start.mode.is_windows());
        debug_assert!(
            matched == match_groups(glob, top, path, &parsed, Dots::Match, false, is_windows)
        );
    }
    Some(matched)
}

/// `start` is at a `{`. Takes groups that are for [`take_plain_choice`], and the literals between them.
#[inline(never)]
fn match_choices(glob: &[u8], shape: Option<&Shape>, path: &[u8], mut start: Start) -> MatchResult {
    let is_windows = start.mode.is_windows();
    let negated = start.glob_start % 2 == 1;
    let found = |matched: bool| MatchResult {
        matches: matched != negated,
        negated,
    };
    if start.mode.dots != Dots::Match {
        return match_more(glob, shape, path, start, None);
    }
    loop {
        // One like `{src/**,lib/**}` isn't for that.
        let taken = match glob.ends_with(b"*}") {
            true => None,
            false => take_plain_choice(
                glob,
                start.glob_index,
                path,
                start.path_index,
                is_windows,
                Pending::Nothing,
            ),
        };
        match taken {
            Some(Taken::To(glob_index, path_index)) => {
                (start.glob_index, start.path_index) = (glob_index, path_index);
                start.seen = Seen::Choice;
            }
            Some(Taken::Nothing) => return found(false),
            None => {
                if let Some(matched) = match_branches(glob, path, &start) {
                    return found(matched);
                }
                if start.seen == Seen::OnlyRegular {
                    start.seen = Seen::NoPlainChoice;
                }
                return match_more(glob, shape, path, start, None);
            }
        }
        let (mut index, mut path_index) = (start.glob_index as usize, start.path_index as usize);
        while let Some(&wanted) = glob.get(index) {
            let is_same = match path.get(path_index) {
                Some(&found) if IS_PLAIN[wanted as usize] => found == wanted,
                Some(&found) if wanted == b'/' => is_separator(found, is_windows),
                None if IS_PLAIN[wanted as usize] || wanted == b'/' => false,
                _ => break,
            };
            if !is_same {
                return found(false);
            }
            index += 1;
            path_index += 1;
        }
        if index == glob.len() {
            return found(path_index == path.len());
        }
        (start.glob_index, start.path_index) = (index as u32, path_index as u32);
        if glob[index] != b'{' {
            return match is_globstar_before_text(glob, start.glob_start as usize, index) {
                true => match_after_globstar(glob, shape, path, start),
                false => match_more(glob, shape, path, start, None),
            };
        }
    }
}

/// [`match_literal`] for a pattern that starts with `!`.
#[inline(never)]
fn match_negated(glob: &[u8], shape: Option<&Shape>, path: &[u8], mode: Mode) -> MatchResult {
    let is_windows = mode.is_windows();
    let glob_start = negations(glob);
    let negated = glob_start % 2 == 1;
    let mut taken = 0;
    while let Some(&wanted) = glob.get(glob_start + taken) {
        let is_same = match path.get(taken) {
            Some(&found) if IS_PLAIN[wanted as usize] => found == wanted,
            Some(&found) if wanted == b'/' => is_separator(found, is_windows),
            None if IS_PLAIN[wanted as usize] || wanted == b'/' => false,
            _ => break,
        };
        if !is_same {
            return MatchResult {
                matches: negated,
                negated,
            };
        }
        taken += 1;
    }
    let Some(next) = glob.get(glob_start + taken) else {
        return MatchResult {
            matches: (taken == path.len()) != negated,
            negated,
        };
    };
    let start = Start {
        glob_start: glob_start as u32,
        glob_index: (glob_start + taken) as u32,
        path_index: taken as u32,
        ..Start::of(mode)
    };
    if is_globstar_before_text(glob, glob_start, glob_start + taken) {
        return match_after_globstar(glob, shape, path, start);
    }
    if *next == b'{' {
        return match_choices(glob, shape, path, start);
    }
    if is_last_star(glob, glob_start + taken) {
        return match_last_star(glob, shape, path, start);
    }
    match matches!(next, b'\\' | b'?' | b'[' | 0x80..) {
        true => match_escapes(glob, shape, path, start),
        false => match_more(glob, shape, path, start, None),
    }
}

/// The same for a pattern that starts with `!`, or has other tokens among those bytes that take one character whatever follows:
/// escapes, `?` and classes.
#[inline(never)]
fn match_escapes(glob: &[u8], shape: Option<&Shape>, path: &[u8], start: Start) -> MatchResult {
    match_escapes_from::<false>(glob, shape, path, start)
}

/// The same from the start of the pattern, which saves a little.
#[inline(never)]
fn match_escapes_at_start(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    mode: Mode,
) -> MatchResult {
    match_escapes_from::<true>(glob, shape, path, Start::of(mode))
}

#[inline(always)]
fn match_escapes_from<const IS_AT_START: bool>(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    start: Start,
) -> MatchResult {
    let (dots, is_windows) = (start.mode.dots, start.mode.is_windows());
    let glob_start = match glob[0] {
        b'!' if !IS_AT_START => negations(glob),
        _ => 0,
    };
    let negated = glob_start % 2 == 1;
    let (mut index, mut path_index) = (
        glob_start.max(start.glob_index as usize),
        start.path_index as usize,
    );
    let mut seen = Seen::OnlyRegular;
    let mut first_class = usize::MAX;
    while let Some(&wanted) = glob.get(index) {
        let found = path.get(path_index).copied();
        let is_same = if IS_PLAIN[wanted as usize] {
            found == Some(wanted)
        } else if wanted == b'/' {
            found.is_some_and(|it| is_separator(it, is_windows))
        } else if wanted >= 128 {
            // The loop compares as many bytes as the first one announces. That's the same unless they go on into something else.
            let len = usize::from(strings::wtf8_byte_sequence_length(wanted));
            let Some(bytes) = glob
                .get(index..index + len)
                .filter(|it| !it.iter().any(u8::is_ascii))
            else {
                break;
            };
            index += len - 1;
            path_index += len - 1;
            path.get(path_index + 1 - len..=path_index) == Some(bytes)
        } else if wanted == b'\\'
            && glob
                .get(index + 1)
                .is_some_and(|it| *it < 128 && *it != b'/')
        {
            let (mut escaped, mut at) = (wanted, index as u32);
            unescape(&mut escaped, glob, &mut at);
            index += 1;
            if glob[index] == b'\\' {
                seen = Seen::Odd;
            }
            found == Some(escaped)
        } else if dots != Dots::Match || found.is_some_and(|it| it >= 128) {
            break;
        } else if wanted == b'?' && glob.get(index + 1) != Some(&b'(') {
            found.is_some_and(|it| !is_separator(it, is_windows))
        } else if wanted == b'['
            && let Some((has, close, _)) = ascii_class::<false>(glob, index, found.unwrap_or(0))
        {
            first_class = first_class.min(index);
            index = close;
            has && found.is_some()
        } else {
            break;
        };
        if !is_same {
            return MatchResult {
                matches: negated,
                negated,
            };
        }
        index += 1;
        path_index += 1;
    }
    if index == glob.len() {
        return MatchResult {
            matches: (path_index == path.len()) != negated,
            negated,
        };
    }
    if first_class != usize::MAX && !has_regular_classes(&glob[first_class..index]) {
        seen = Seen::Odd;
    }
    let start = Start {
        glob_start: glob_start as u32,
        glob_index: index as u32,
        path_index: path_index as u32,
        seen,
        mode: start.mode,
    };
    match is_last_star(glob, index) {
        true => match_last_star(glob, shape, path, start),
        false => match_more(glob, shape, path, start, None),
    }
}

/// [`match_class`] for an ASCII character and a class that has neither escapes nor characters that aren't ASCII.
/// Returns the result, the index of the `]`, and whether a regular pattern may have the class. Returns `None` for any other class.
#[inline(always)]
fn ascii_class<const ASKS_IF_REGULAR: bool>(
    glob: &[u8],
    open: usize,
    c: u8,
) -> Option<(bool, usize, bool)> {
    let mut at = open + 1;
    let negated = matches!(glob.get(at), Some(b'^' | b'!'));
    at += usize::from(negated);
    let first = at;
    let mut has = false;
    let mut is_regular = !negated && glob.get(at) != Some(&b'(');
    loop {
        let low = *glob.get(at)?;
        if low == b']' && at > first {
            return Some((has != negated, at, is_regular));
        }
        if low == b'\\' || low >= 128 {
            return None;
        }
        if glob.get(at + 1) == Some(&b'-')
            && let Some(&high) = glob.get(at + 2)
            && high != b']'
        {
            if high == b'\\' || high >= 128 {
                return None;
            }
            has |= low <= c && c <= high;
            if ASKS_IF_REGULAR {
                is_regular &= !(low <= b'/' && b'/' <= high) && !(low <= b'\\' && b'\\' <= high);
            }
            at += 3;
        } else {
            has |= low == c;
            if ASKS_IF_REGULAR {
                is_regular &= low != b'/';
            }
            at += 1;
        }
    }
}

/// `tokens` are tokens that [`match_escapes`] has taken. Returns whether a regular pattern may have the classes among them.
#[inline(never)]
fn has_regular_classes(tokens: &[u8]) -> bool {
    let mut at = 0;
    while let Some(&ch) = tokens.get(at) {
        at = match ch {
            b'\\' => at + 2,
            b'[' => match ascii_class::<true>(tokens, at, 0) {
                Some((_, close, true)) => close + 1,
                _ => return false,
            },
            _ => at + 1,
        };
    }
    true
}

/// Result of [`Cache::answer`].
enum Answer {
    Yes,
    No,
    /// A step is missing.
    Unknown,
    /// The cache has no steps for bytes that aren't ASCII.
    NotAscii,
}

/// Matches a pattern that has been matched often. This is where such a pattern spends its time.
#[inline(never)]
fn match_warm(glob: &[u8], shape: &Shape, path: &[u8], mode: Mode) -> MatchResult {
    let (dots, is_windows) = (mode.dots, mode.is_windows());
    let parsed = shape.parsed(glob);
    let negated = parsed.top % 2 == 1;
    let found = |matched: bool| MatchResult {
        matches: matched != negated,
        negated,
    };
    if let Some(text) = &parsed.text {
        let is_same = match is_windows {
            true => {
                text.len() == path.len()
                    && std::iter::zip(&**text, path).all(|(wanted, found)| {
                        wanted == found || *wanted == b'/' && *found == b'\\'
                    })
            }
            false => **text == *path,
        };
        return found(is_same);
    }
    let mut is_ascii = true;
    let Some(first) = parsed.take_front(glob, parsed.top, path, is_windows) else {
        return found(false);
    };
    if let Some(cache) = parsed
        .program
        .get()
        .and_then(|it| it.warm_cache(is_windows))
    {
        let answer = match dots {
            Dots::Match => cache.answer(&path[first as usize..]),
            _ => cache.answer_without_dots(path, first as usize),
        };
        match answer {
            Answer::Yes => return found(true),
            Answer::No => return found(false),
            Answer::Unknown => {}
            Answer::NotAscii => is_ascii = false,
        }
    }
    let walked = match is_ascii || path.len() >= Program::IS_LONG {
        true => match_at_once(glob, parsed.top, Some(shape), path, dots, is_windows),
        false => None,
    };
    match walked {
        Some(matched) => found(matched),
        // On those bytes the loop is faster.
        None => {
            let start = Start {
                glob_start: parsed.top,
                glob_index: parsed.top,
                ..Start::of(mode)
            };
            match_more(glob, Some(shape), path, start, None)
        }
    }
}

/// With `resumed`, only runs the loop from that state on, and leaves the state and the outcome there. See [`match_slowly`].
#[inline(never)]
fn match_more(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    start: Start,
    resumed: Option<&mut State>,
) -> MatchResult {
    let glob_start = start.glob_start;
    let (dots, is_windows) = (start.mode.dots, start.mode.is_windows());
    let negated = glob_start % 2 == 1;
    let found = |matched: bool| MatchResult {
        matches: matched != negated,
        negated,
    };
    let mut state = State::at(start.glob_index, start.path_index, start.seen);
    match &resumed {
        Some(it) => state = **it,
        None => {
            if path.len() >= Program::IS_LONG
                && let Some(matched) =
                    match_at_once(glob, glob_start, shape, path, dots, is_windows)
            {
                return found(matched);
            }
        }
    }
    let outcome = run::<false>(glob, glob_start, path, dots, &mut state, is_windows);
    if let Some(it) = resumed {
        state.outcome = outcome;
        *it = state;
        return MatchResult::NO;
    }
    let matched = match outcome {
        Outcome::No => false,
        Outcome::Yes if dots == Dots::Match => true,
        _ => {
            state.outcome = outcome;
            // A first match keeps nothing.
            let keeps = |it: &&Shape| {
                it.uses.load(Ordering::Relaxed) > 1
                    || path.len() >= Program::IS_LONG
                    || it.known.get().is_some()
            };
            match_slowly(
                glob,
                glob_start,
                shape.filter(keeps),
                path,
                start.mode,
                state,
            )
        }
    };
    // The loop and a walk have to agree wherever the loop finds every match.
    #[cfg(debug_assertions)]
    if path.len() < Program::IS_LONG && std::str::from_utf8(glob).is_ok() {
        let mut parsed = Parsed::new();
        parsed.read(glob);
        debug_assert!(
            !(parsed.is_regular || parsed.is_fixed && dots == Dots::Match)
                || matched
                    == match_groups(glob, glob_start, path, &parsed, dots, false, is_windows),
            "the loop and the walk differ"
        );
    }
    found(matched)
}

/// Matches with a [`Walk`] if that's the faster way: the pattern has been matched often, or the path is long, so that a cache pays
/// off at once.
#[inline(never)]
fn match_at_once(
    glob: &[u8],
    glob_start: u32,
    shape: Option<&Shape>,
    path: &[u8],
    dots: Dots,
    is_windows: bool,
) -> Option<bool> {
    let mut groups = Groups::new(shape);
    let parsed = groups.parsed(glob);
    let walks = parsed.may_walk(dots);
    walks.then(|| {
        match_groups(
            glob,
            glob_start,
            path,
            parsed,
            dots,
            shape.is_some(),
            is_windows,
        )
    })
}

/// Goes on where the loop has stopped. What's found out about the pattern is kept in `shape`.
#[cold]
#[inline(never)]
fn match_slowly(
    glob: &[u8],
    glob_start: u32,
    shape: Option<&Shape>,
    path: &[u8],
    mode: Mode,
    mut state: State,
) -> bool {
    let (dots, is_windows) = (mode.dots, mode.is_windows());
    let mut groups = Groups::new(shape);
    let mut is_strict = false;
    let start = Start {
        glob_start,
        ..Start::of(mode)
    };
    loop {
        let goes_on = match state.outcome {
            Outcome::No => return false,
            // The loop ignores the rules for dot segments. Rerun with them only if the path has such a segment.
            Outcome::Yes => {
                if is_strict
                    || dots == Dots::Match
                    || !has_closed_segment_on(path, dots, is_windows)
                {
                    return true;
                }
                is_strict = true;
                state = State::at(glob_start, 0, state.seen);
                true
            }
            Outcome::Odd => {
                if !groups.parsed(glob).is_regular {
                    break;
                }
                state.seen = Seen::Odd;
                true
            }
            Outcome::Unclosed => {
                state.no_class_from = state.glob_index;
                true
            }
            Outcome::Group => {
                let at = At {
                    is_strict,
                    seen: state.seen,
                };
                let (index, path_index) = (state.glob_index, state.path_index);
                let tried = try_group(glob, index, path, path_index, at, &mut groups, is_windows);
                // Once the pattern has been read, the loop doesn't take anything for a `Choice` by itself.
                if groups.is_parsed() {
                    state.seen = Seen::Odd;
                }
                match tried {
                    None => {
                        state.not_group_at = state.glob_index;
                        true
                    }
                    Some(Tried::IsGroup) => break,
                    Some(Tried::Failed) => state.goes_back(path),
                    Some(Tried::Took(glob_index, path_index)) => {
                        (state.glob_index, state.path_index) = (glob_index, path_index);
                        true
                    }
                    // A `*` before the group was part of the segment.
                    Some(Tried::TookSegment(glob_index, path_index)) => {
                        (state.glob_index, state.path_index) = (glob_index, path_index);
                        (state.wildcard, state.seen) = (state.globstar, Seen::Choice);
                        true
                    }
                    Some(Tried::FailedSegment) => {
                        (state.wildcard, state.seen) = (state.globstar, Seen::Choice);
                        state.goes_back(path)
                    }
                }
            }
        };
        if !goes_on {
            return false;
        }
        match is_strict {
            true => {
                state.outcome = run_strictly(glob, glob_start, path, dots, &mut state, is_windows)
            }
            false => _ = match_more(glob, None, path, start, Some(&mut state)),
        }
    }
    let is_kept = groups.prepared.is_some();
    match_groups(
        glob,
        glob_start,
        path,
        groups.parsed(glob),
        dots,
        is_kept,
        is_windows,
    )
}

/// Matches with a [`Walk`] instead of the loop. With `is_kept`, what's found out about the pattern stays with `parsed`.
#[inline(never)]
fn match_groups(
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    parsed: &Parsed,
    dots: Dots,
    is_kept: bool,
    is_windows: bool,
) -> bool {
    // Most paths that don't match differ in their first bytes, which a walk from the end would see last.
    let Some(after_front) = parsed.take_front(glob, glob_start, path, is_windows) else {
        return false;
    };
    if parsed.first_group != u32::MAX
        && !parsed.may_start_at(parsed.first_group, glob, path, after_front)
    {
        return false;
    }
    // Before a long walk, it's worth looking a little further.
    if path.len() >= Program::IS_LONG && !parsed.may_pass_first_group(glob, path, after_front) {
        return false;
    }
    let mut unkept = None;
    let program = match is_kept {
        true => &**parsed.program.get_or_init(|| {
            let mut program = Box::new(Program::new());
            program.read(glob, parsed, parsed.front_end as usize);
            if !parsed.has_group || parsed.is_matched_often {
                program.walks = AtomicU8::new(Program::CACHES_AFTER);
            }
            program
        }),
        false => {
            let program = unkept.insert(Program::new());
            program.read(glob, parsed, parsed.front_end as usize);
            program
        }
    };
    let dots = match dots != Dots::Match && has_closed_segment_on(path, dots, is_windows) {
        true => dots,
        false => Dots::Match,
    };
    match program.cache(glob, is_windows, path.len()) {
        Some(cache) => cache.matches(program, glob, path, after_front as usize, dots),
        None => program
            .on(glob, path, after_front as usize, is_windows, dots)
            .walk(),
    }
}

/// Returns true if `path` has a `.` or `..` segment or, with [`Dots::Hide`], a segment that starts with `.`.
#[inline]
pub(crate) fn has_closed_segment<const WINDOWS: bool>(path: &[u8], dots: Dots) -> bool {
    has_closed_segment_on(path, dots, WINDOWS)
}

#[inline(never)]
fn has_closed_segment_on(path: &[u8], dots: Dots, is_windows: bool) -> bool {
    let mut from = 0;
    while let Some(dot) = strings::index_of_char_pos(path, b'.', from) {
        if is_closed_segment_at(path, dot as u32, dots, is_windows) {
            return true;
        }
        from = dot + 1;
    }
    false
}

/// Returns true if no wildcard may match at `index`. That's the case inside or right after a `.` or `..` segment and,
/// with [`Dots::Hide`], at the start of a segment that starts with `.`.
fn is_closed_segment_at(path: &[u8], index: u32, dots: Dots, is_windows: bool) -> bool {
    let index = index as usize;
    let is_separator = |c: u8| c == b'/' || is_windows && c == b'\\';
    let is_start = |at: usize| at == 0 || is_separator(path[at - 1]);
    if dots == Dots::Hide && path.get(index) == Some(&b'.') && is_start(index) {
        return true;
    }
    let dots_before = path[..index]
        .iter()
        .rev()
        .take(2)
        .take_while(|it| **it == b'.');
    let start = index - dots_before.count();
    let dots = path[start..]
        .iter()
        .take(3)
        .take_while(|it| **it == b'.')
        .count();
    is_start(start)
        && matches!(dots, 1 | 2)
        && path.get(start + dots).is_none_or(|it| is_separator(*it))
}

/// Bytes that are always literal in a pattern.
static IS_PLAIN: [bool; 256] = {
    let mut table = [false; 256];
    let mut byte = 0;
    while byte < 128 {
        table[byte] = !matches!(
            byte as u8,
            b'*' | b'?' | b'[' | b'{' | b'\\' | b'/' | b'!' | b'+' | b'@'
        );
        byte += 1;
    }
    table
};

#[cold]
#[inline(never)]
fn run_strictly(
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    dots: Dots,
    state: &mut State,
    is_windows: bool,
) -> Outcome {
    run::<true>(glob, glob_start, path, dots, state, is_windows)
}

/// After the last `**/` of a pattern, `tail` is what's left of the pattern and `rest` what's left of the path. If `tail` matches as
/// many segments as it has itself, returns where in `rest` it has to start, or `None` if `rest` has fewer segments.
/// Returns `Err` if it can't tell.
#[inline(never)]
fn last_segments(tail: &[u8], rest: &[u8], is_windows: bool) -> Result<Option<usize>, ()> {
    // `**/*` has a rule of its own.
    if tail == b"*" {
        return Err(());
    }
    let mut slashes = 0;
    // How many `{` and `(` are open.
    let (mut braces, mut parentheses) = (0_u32, 0_u32);
    let mut at = 0;
    while let Some(&ch) = tail.get(at) {
        at += 1;
        match ch {
            _ if IS_TEXT[ch as usize] => {}
            b'/' if braces + parentheses > 0 => return Err(()),
            b'/' => slashes += 1,
            b'{' => braces += 1,
            b'(' => parentheses += 1,
            b'}' => braces = braces.saturating_sub(1),
            b')' => parentheses = parentheses.saturating_sub(1),
            b'*' if tail.get(at) == Some(&b'*') => return Err(()),
            b'[' => match AsciiClass::read(tail, at - 1) {
                Some(class) if class.is_regular(tail, at - 1) => at = class.end as usize,
                _ => return Err(()),
            },
            b'\\' => match tail.get(at) {
                Some(b'/' | b'\\' | 0x80..) | None => return Err(()),
                Some(_) => at += 1,
            },
            0x80.. => return Err(()),
            _ => {}
        }
    }
    for (index, &found) in rest.iter().enumerate().rev() {
        if found == b'/' || is_windows && found == b'\\' {
            if slashes == 0 {
                return Ok(Some(index + 1));
            }
            slashes -= 1;
        }
    }
    Ok((slashes == 0).then_some(0))
}

/// How [`run`] ends.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Outcome {
    No,
    Yes,
    /// It's at a group that isn't a [`Choice`].
    Group,
    /// It has taken a [`Choice`], and is at a token that a regular pattern may not have.
    Odd,
    /// It's at a `[` that isn't closed.
    Unclosed,
}

/// The loop for patterns without groups, and for groups that are a [`Choice`]. It keeps one `*` and one `**` to go back to.
/// `glob_start` is the index where the pattern starts. `STRICT` applies the rules for dot segments (see `match_slowly`).
#[inline(always)]
fn run<const STRICT: bool>(
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    dots: Dots,
    state: &mut State,
    is_windows: bool,
) -> Outcome {
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    let (no_class_from, not_group_at) = (state.no_class_from, state.not_group_at);
    let mut kept = Kept::NOTHING;
    // Stops at the current token.
    macro_rules! stop {
        ($outcome:expr) => {
            return $outcome
        };
    }
    // The loop is at a token that a regular pattern may not have.
    macro_rules! see_odd_token {
        () => {{
            if state.seen == Seen::Choice {
                stop!(Outcome::Odd);
            }
            state.seen = Seen::Odd;
        }};
    }
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                if IS_PLAIN[ch as usize] {
                    // All the literal bytes that follow, in a loop of their own.
                    let (mut index, mut path_index) =
                        (state.glob_index as usize, state.path_index as usize);
                    while let Some(&wanted) = glob.get(index)
                        && IS_PLAIN[wanted as usize]
                    {
                        if path.get(path_index) != Some(&wanted) {
                            break 'fallthrough;
                        }
                        index += 1;
                        path_index += 1;
                    }
                    state.glob_index = index as u32;
                    state.path_index = path_index as u32;
                    continue 'main_loop;
                }
                // A `*` before a literal goes to the next place in this segment where that occurs, and takes it.
                if !STRICT
                    && ch == b'*'
                    && let Some(&wanted) = glob.get(state.glob_index as usize + 1)
                    && IS_TEXT[wanted as usize]
                {
                    let mut index = state.path_index as usize;
                    while let Some(&found) = path.get(index)
                        && found != wanted
                        && !is_separator(found)
                    {
                        index += 1;
                    }
                    match path.get(index) {
                        Some(&found) if found == wanted => {
                            state.wildcard.glob_index = state.glob_index;
                            state.wildcard.path_index = index as u32 + 1;
                            state.glob_index += 2;
                            state.path_index = index as u32 + 1;
                            continue 'main_loop;
                        }
                        Some(_) => {
                            state.wildcard = state.globstar;
                            break 'fallthrough;
                        }
                        None => return Outcome::No,
                    }
                }
                // A `*` before a `/` or at the end of the pattern takes the rest of the segment.
                if !STRICT
                    && ch == b'*'
                    && glob
                        .get(state.glob_index as usize + 1)
                        .is_none_or(|it| *it == b'/')
                {
                    let mut index = state.path_index as usize;
                    while let Some(&found) = path.get(index)
                        && !is_separator(found)
                    {
                        index += 1;
                    }
                    let is_last = state.glob_index as usize + 1 == glob.len();
                    if index == path.len() {
                        return match is_last {
                            true => Outcome::Yes,
                            false => Outcome::No,
                        };
                    }
                    state.wildcard = state.globstar;
                    if is_last {
                        break 'fallthrough;
                    }
                    state.glob_index += 2;
                    state.path_index = index as u32 + 1;
                    continue 'main_loop;
                }
                // Back at a `**/`: on to the next segment, or to the next one that starts with the literal after it.
                if !STRICT
                    && ch == b'*'
                    && state.globstar.glob_index == state.glob_index
                    && state.globstar.path_index == state.path_index
                    && state.path_index > 0
                    && (state.path_index as usize) < path.len()
                    && let Some(&wanted) = glob.get(state.glob_index as usize + 3)
                {
                    let is_literal = IS_PLAIN[wanted as usize] || wanted >= 128;
                    let mut start = state.path_index as usize;
                    let next = loop {
                        let mut end = start;
                        while let Some(&found) = path.get(end)
                            && !is_separator(found)
                        {
                            end += 1;
                        }
                        if !is_literal || end >= path.len() || path[start] == wanted {
                            break end + 1;
                        }
                        start = end + 1;
                    };
                    state.glob_index += 3;
                    state.path_index = start as u32;
                    state.globstar.path_index = next as u32;
                    state.wildcard = state.globstar;
                    continue 'main_loop;
                }
                // `**` can still match nothing, so it's handled below.
                if STRICT
                    && matches!(ch, b'*' | b'?' | b'[')
                    && is_closed_segment_at(path, state.path_index, dots, is_windows)
                    && !glob[state.glob_index as usize..].starts_with(b"**")
                    && glob.get(state.glob_index as usize + 1) != Some(&b'(')
                {
                    break 'fallthrough;
                }
                'to_else: {
                    match ch {
                        b'*' | b'?' | b'+' | b'@' | b'!' | b'{'
                            if (ch == b'{'
                                || glob.get(state.glob_index as usize + 1) == Some(&b'('))
                                && state.glob_index != not_group_at =>
                        {
                            if !STRICT
                                && !matches!(state.seen, Seen::Odd | Seen::NoPlainChoice)
                                && !(kept.layout.open == state.glob_index && kept.layout.has_star)
                                && let Some(taken) = take_plain_choice(
                                    glob,
                                    state.glob_index,
                                    path,
                                    state.path_index,
                                    is_windows,
                                    if state.wildcard.path_index == 0 {
                                        Pending::Nothing
                                    } else if state.wildcard.path_index == state.globstar.path_index
                                    {
                                        Pending::Globstar
                                    } else if state.wildcard.glob_index + 1 == state.glob_index {
                                        Pending::StarBefore
                                    } else {
                                        Pending::Star
                                    },
                                )
                            {
                                state.seen = Seen::Choice;
                                match taken {
                                    Taken::To(glob_index, path_index) => {
                                        state.glob_index = glob_index;
                                        state.path_index = path_index;
                                        continue 'main_loop;
                                    }
                                    Taken::Nothing => break 'fallthrough,
                                }
                            }
                            if state.seen == Seen::NoPlainChoice {
                                state.seen = Seen::OnlyRegular;
                            }
                            if !STRICT
                                && state.seen != Seen::Odd
                                && let Some(written) = match_written_out(
                                    glob,
                                    state.glob_index as usize,
                                    &Text {
                                        path,
                                        path_index: state.path_index as usize,
                                        is_committed: state.wildcard.path_index == 0,
                                        is_windows,
                                    },
                                    &mut kept.layout,
                                )
                            {
                                #[cfg(debug_assertions)]
                                written.check(glob, state.glob_index as usize, path, is_windows);
                                state.seen = Seen::Choice;
                                // A `*` before the group was part of the segment.
                                state.wildcard = state.globstar;
                                if !written.is_match {
                                    break 'fallthrough;
                                }
                                state.glob_index = written.glob_index;
                                state.path_index = written.path_index;
                                continue 'main_loop;
                            }
                            stop!(Outcome::Group);
                        }
                        b'*' => {
                            // `**(a)` is `*` followed by `*(a)`.
                            let is_globstar = (state.glob_index as usize) + 1 < glob.len()
                                && glob[state.glob_index as usize + 1] == b'*'
                                && glob.get(state.glob_index as usize + 2) != Some(&b'(');
                            // It's a whole segment of the pattern.
                            let mut is_whole = false;
                            if is_globstar {
                                let at = state.glob_index as usize;
                                is_whole = (at <= glob_start as usize || glob[at - 1] == b'/')
                                    && matches!(glob.get(at + 2), None | Some(b'/'));
                                if !is_whole {
                                    see_odd_token!();
                                }
                                // After this it's the last `**` of `**/**`, which is a whole segment as well.
                                if glob.get(at + 3) == Some(&b'*') {
                                    skip_globstars(glob, &mut state.glob_index);
                                }
                                // When the loop gets here for the first time. After an odd token it may have missed a way to get
                                // here, and has to go on to the next group as it always did, where a walk takes over.
                                if !STRICT
                                    && is_whole
                                    && state.seen != Seen::Odd
                                    && (state.globstar.path_index == 0
                                        || state.globstar.glob_index != state.glob_index)
                                    && !glob.ends_with(b"**")
                                    && let Some(tail) = glob.get(state.glob_index as usize + 3..)
                                    && let Ok(start) = last_segments(
                                        tail,
                                        &path[state.path_index as usize..],
                                        is_windows,
                                    )
                                {
                                    let Some(start) = start else {
                                        return Outcome::No;
                                    };
                                    state.glob_index += 3;
                                    state.path_index += start as u32;
                                    state.wildcard = Wildcard::default();
                                    state.globstar = Wildcard::default();
                                    continue 'main_loop;
                                }
                            }
                            let is_closed = STRICT
                                && is_closed_segment_at(path, state.path_index, dots, is_windows);
                            let before = state.wildcard;

                            // False if the group after the wildcard can't start where the wildcard stops.
                            let mut can_start = true;

                            // Skip ahead to the next place in this segment where the literal after the `*` occurs.
                            // A `**` that isn't a whole segment is like a `*`.
                            if (!is_globstar || !is_whole)
                                && let Some(&wanted) = glob
                                    .get(state.glob_index as usize + 1 + usize::from(is_globstar))
                                && IS_PLAIN[wanted as usize]
                            {
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && found != wanted
                                    && !is_separator(found)
                                {
                                    state.path_index += 1;
                                }
                            } else if !is_globstar
                                && glob
                                    .get(state.glob_index as usize + 1)
                                    .is_none_or(|next| *next == b'/' && dots == Dots::Match)
                            {
                                // A `*` at the end of the pattern or before a `/` takes the rest of the segment.
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && !is_separator(found)
                                {
                                    state.path_index += 1;
                                }
                            } else if !is_globstar {
                                let skipped = skip_ahead(
                                    glob,
                                    state.glob_index + 1,
                                    path,
                                    state.path_index,
                                    dots == Dots::Match,
                                    before.path_index == 0 || before.glob_index != state.glob_index,
                                    state.seen == Seen::Odd,
                                    &mut kept,
                                    is_windows,
                                );
                                state.path_index = skipped.path_index;
                                can_start = skipped.can_start;
                            }

                            state.wildcard.glob_index = state.glob_index;
                            state.wildcard.path_index = state.path_index
                                + if (state.path_index as usize) < path.len() {
                                    u32::from(rune_len_at(path, state.path_index as usize))
                                } else {
                                    1
                                };

                            let mut in_globstar = false;
                            if is_globstar {
                                state.glob_index += 2;

                                let is_end_invalid = (state.glob_index as usize) < glob.len();

                                // FIXME: explain this bug fix
                                if is_end_invalid
                                    && state.path_index as usize == path.len()
                                    && glob.len() - state.glob_index as usize == 2
                                    && is_separator(glob[state.glob_index as usize])
                                    && glob[state.glob_index as usize + 1] == b'*'
                                {
                                    continue 'main_loop;
                                }

                                if is_whole
                                    || (state.glob_index.saturating_sub(glob_start) < 3
                                        || glob[state.glob_index as usize - 3] == b'/')
                                        && (!is_end_invalid
                                            || glob[state.glob_index as usize] == b'/')
                                {
                                    if is_end_invalid {
                                        state.glob_index += 1;
                                    }

                                    // A trailing `**` matches the rest of the path.
                                    if !STRICT && !is_end_invalid {
                                        return Outcome::Yes;
                                    }

                                    // skip to separator
                                    state.skip_to_separator(path, is_end_invalid, is_windows);
                                    in_globstar = true;

                                    // Skip segments that don't start with the literal after `**/`.
                                    if !STRICT
                                        && let Some(&wanted) = glob.get(state.glob_index as usize)
                                        && (IS_PLAIN[wanted as usize] || wanted >= 128)
                                    {
                                        while let Some(&found) = path.get(state.path_index as usize)
                                            && found != wanted
                                            && state.wildcard.path_index as usize <= path.len()
                                        {
                                            state.path_index = state.wildcard.path_index;
                                            state.wildcard.path_index += 1;
                                            state.skip_to_separator(
                                                path,
                                                is_end_invalid,
                                                is_windows,
                                            );
                                        }
                                    }
                                    if is_closed {
                                        state.wildcard.path_index = 0;
                                        state.globstar = state.wildcard;
                                    }
                                }
                            } else {
                                state.glob_index += 1;
                            }

                            if is_closed && !in_globstar {
                                state.wildcard = before;
                                break 'fallthrough;
                            }

                            if !in_globstar
                                && (state.path_index as usize) < path.len()
                                && is_separator(path[state.path_index as usize])
                            {
                                state.wildcard = state.globstar;
                            }

                            if !can_start {
                                break 'fallthrough;
                            }
                            continue 'main_loop;
                        }
                        b'?' => {
                            if (state.path_index as usize) < path.len() {
                                if !is_separator(path[state.path_index as usize]) {
                                    state.glob_index += 1;
                                    state.path_index +=
                                        u32::from(rune_len_at(path, state.path_index as usize));
                                    continue 'main_loop;
                                }
                                break 'fallthrough;
                            } else {
                                break 'to_else;
                            }
                        }
                        b'[' if state.glob_index < no_class_from => {
                            if (state.path_index as usize) < path.len() {
                                // source unicode char to match against the target + its byte length in `path`
                                let (c, len) = decode_rune_at(path, state.path_index as usize);
                                // The first time, it isn't worth it to keep anything.
                                let (class, is_regular) = if kept.class_seen_at != state.glob_index
                                    && c < 128
                                    && let Some((has, close, is_regular)) = ascii_class::<true>(
                                        glob,
                                        state.glob_index as usize,
                                        c as u8,
                                    ) {
                                    kept.class_seen_at = state.glob_index;
                                    (Some((has, close as u32 + 1)), is_regular)
                                } else {
                                    let class = match kept.class_at(glob, state.glob_index) {
                                        Some(class) => Some((class.has(c), class.end)),
                                        None => class_has_at(glob, state.glob_index, c),
                                    };
                                    let is_kept = kept.class_index == state.glob_index;
                                    (class, is_kept && kept.is_regular_class)
                                };
                                let Some((has, end)) = class else {
                                    // An unclosed `[` is literal.
                                    see_odd_token!();
                                    stop!(Outcome::Unclosed);
                                };
                                if !is_regular {
                                    see_odd_token!();
                                }
                                if !has {
                                    break 'fallthrough;
                                }
                                state.glob_index = end;
                                state.path_index += u32::from(len);
                                continue 'main_loop;
                            } else {
                                see_odd_token!();
                                break 'to_else;
                            }
                        }
                        _ => break 'to_else,
                    }
                }
                if (state.path_index as usize) < path.len() {
                    if ch == b'\\'
                        && glob
                            .get(state.glob_index as usize + 1)
                            .is_none_or(|it| *it == b'\\')
                    {
                        see_odd_token!();
                    }
                    let mut cc: u8 = ch;
                    unescape(&mut cc, glob, &mut state.glob_index);
                    let cc_len = strings::wtf8_byte_sequence_length(cc);

                    let is_match = if cc == b'/' {
                        is_separator(path[state.path_index as usize])
                    } else if cc_len > 1 {
                        let pi = state.path_index as usize;
                        let gi = state.glob_index as usize;
                        let n = cc_len as usize;
                        pi + n <= path.len()
                            && gi + n <= glob.len()
                            && path[pi..pi + n] == glob[gi..gi + n]
                    } else {
                        path[state.path_index as usize] == cc
                    };

                    if is_match {
                        state.glob_index += u32::from(cc_len);
                        state.path_index += u32::from(cc_len);

                        if cc == b'/' {
                            state.wildcard = state.globstar;
                        }

                        continue 'main_loop;
                    }
                }
            }
        }

        if state.goes_back(path) {
            continue;
        }

        return Outcome::No;
    }

    Outcome::Yes
}

/// Matches `c` against the class that starts at `open`. Returns the result and the index after the `]`,
/// or `None` if the class isn't closed.
#[inline(always)]
fn match_class(glob: &[u8], open: u32, c: u32) -> Option<(bool, u32)> {
    let mut glob_index = open + 1;

    let mut negated = false;
    if (glob_index as usize) < glob.len()
        && (glob[glob_index as usize] == b'^' || glob[glob_index as usize] == b'!')
    {
        negated = true;
        glob_index += 1;
    }

    let mut first = true;
    let mut is_match = false;

    while (glob_index as usize) < glob.len() && (first || glob[glob_index as usize] != b']') {
        // Get low ( ͡° ͜ʖ ͡°), and unescape it
        let mut low: u32 = glob[glob_index as usize] as u32;
        let mut low_len: u8 = 1;
        if !get_unicode(&mut low, &mut low_len, glob, &mut glob_index) {
            return None;
        }

        // skip past the target char
        glob_index += u32::from(low_len);

        let high = if (glob_index as usize) + 1 < glob.len()
            && glob[glob_index as usize] == b'-'
            && glob[glob_index as usize + 1] != b']'
        {
            glob_index += 1;

            let mut high: u32 = glob[glob_index as usize] as u32;
            let mut high_len: u8 = 1;
            if !get_unicode(&mut high, &mut high_len, glob, &mut glob_index) {
                return None;
            }

            glob_index += u32::from(high_len);
            high
        } else {
            low
        };

        if low <= c && c <= high {
            is_match = true;
        }

        first = false;
    }

    if glob_index as usize >= glob.len() {
        return None;
    }

    Some((is_match != negated, glob_index + 1))
}

/// Returns the index after the `]` of the class that starts at `open`, and whether the class can match `/` or `\`.
/// Returns `None` if it isn't closed.
#[inline(always)]
fn class_shape(glob: &[u8], open: usize) -> Option<(usize, bool)> {
    // Most classes are a few letters.
    let mut at = open + 1;
    while let Some(&ch) = glob.get(at)
        && !matches!(ch, b'^' | b'!' | b'\\' | b'-' | b'/' | 0x80..)
    {
        if ch == b']' && at > open + 1 {
            return Some((at + 1, false));
        }
        at += 1;
    }
    class_shape_slowly(glob, open)
}

#[cold]
#[inline(never)]
fn class_shape_slowly(glob: &[u8], open: usize) -> Option<(usize, bool)> {
    let has = |it: u8| class_has(glob, open as u32, u32::from(it)) == Some(true);
    Some((class_end(glob, open)?, has(b'/') || has(b'\\')))
}

#[inline(never)]
fn class_has_at(glob: &[u8], open: u32, c: u32) -> Option<(bool, u32)> {
    match_class(glob, open, c)
}

/// [`match_class`] for callers outside the loop.
#[inline]
fn class_has(glob: &[u8], open: u32, c: u32) -> Option<bool> {
    class_has_at(glob, open, c).map(|it| it.0)
}

/// Counts the leading `!`s that negate the result.
#[inline(always)]
pub(crate) fn negations(glob: &[u8]) -> usize {
    let bangs = glob.iter().take_while(|it| **it == b'!').count();
    // The `!` of `!(a)` starts a group.
    bangs - usize::from(bangs > 0 && glob.get(bangs) == Some(&b'('))
}

/// One token of a pattern.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Token {
    /// A literal byte.
    Literal,
    /// `\` and the escaped byte.
    Escape,
    /// `?`
    Any,
    /// `*`
    Star,
    /// `**`, even where it isn't a whole segment.
    Globstar,
    /// `[ab]`
    Class,
    /// `{a,b}` or `@(a|b)`. `first` is the index where its first alternative starts.
    Group { first: usize },
}

/// Returns the token that starts at `at` and the index after it. `shape` must be `Shape::of(glob)`.
pub(crate) fn token_at(glob: &[u8], at: usize, shape: &Shape) -> (Token, usize) {
    let next = glob.get(at + 1).copied();
    let group = |first: usize| {
        let shape = shape.parsed(glob);
        let close = shape.alternatives[shape.group_at(first as u32)? as usize].close;
        Some((Token::Group { first }, close as usize + 1))
    };
    match glob[at] {
        b'?' | b'*' | b'+' | b'@' | b'!' if next == Some(b'(') => {
            if let Some(group) = group(at + 2) {
                return group;
            }
        }
        _ => {}
    }
    match glob[at] {
        b'\\' if at + 1 < glob.len() => (Token::Escape, at + 2),
        b'?' => (Token::Any, at + 1),
        b'*' if next == Some(b'*') && glob.get(at + 2) != Some(&b'(') => (Token::Globstar, at + 2),
        b'*' => (Token::Star, at + 1),
        b'[' => match class_end(glob, at) {
            Some(end) => (Token::Class, end),
            None => (Token::Literal, at + 1),
        },
        b'{' => group(at + 1).unwrap_or((Token::Literal, at + 1)),
        _ => (Token::Literal, at + 1),
    }
}

/// Returns the index after the `]` of the class that starts at `open`, or `None` if it isn't closed.
pub fn class_end(glob: &[u8], open: usize) -> Option<usize> {
    let mut at = open + 1;
    at += usize::from(matches!(glob.get(at), Some(b'^' | b'!')));
    let character = |at: usize| {
        let at = at + usize::from(glob.get(at) == Some(&b'\\'));
        glob.get(at)?;
        Some(at + usize::from(rune_len_at(glob, at)))
    };
    let mut is_first = true;
    while is_first || *glob.get(at)? != b']' {
        glob.get(at)?;
        at = character(at)?;
        if glob.get(at) == Some(&b'-') && glob.get(at + 1).is_some_and(|it| *it != b']') {
            at = character(at + 1)?;
        }
        is_first = false;
    }
    Some(at + 1)
}

/// What the loop has seen of a pattern whose groups it hasn't read. See [`Groups::parsed`].
#[derive(Copy, Clone, PartialEq, Eq)]
enum Seen {
    /// Only tokens that a regular pattern has. See [`Parsed::is_regular`].
    OnlyRegular,
    /// A class, an escape, or a `**` that isn't a whole segment: the pattern may not be regular.
    Odd,
    /// Only regular tokens, and a group that it took for a [`Choice`]. That's right if the pattern is regular. It's also right
    /// if the loop fails or ends before it sees anything odd: what it hasn't seen doesn't matter then.
    Choice,
    /// Only regular tokens, and [`take_plain_choice`] has already said that the group where the loop starts isn't for it.
    NoPlainChoice,
}

/// What a match has found out about the groups of its pattern.
struct Groups<'s> {
    /// What's found out about the pattern is kept here, if the caller passed a shape in and this isn't its first match.
    prepared: Option<&'s Shape>,
    unprepared: Option<Parsed>,
    unprepared_segment: Option<Option<Box<Segment>>>,
}

impl<'s> Groups<'s> {
    #[inline(always)]
    fn new(prepared: Option<&'s Shape>) -> Groups<'s> {
        Groups {
            prepared,
            unprepared: None,
            unprepared_segment: None,
        }
    }

    fn is_parsed(&self) -> bool {
        self.unprepared.is_some() || self.prepared.is_some_and(|it| it.parsed_so_far().is_some())
    }

    /// Returns the segment of the pattern that `index` is in, read by itself, if it's a [`Segment`] as far as that shows without
    /// reading the whole pattern. All the loop has seen before `index` are regular tokens and [`Choice`]s.
    /// Only one such segment is kept per pattern.
    fn segment_at(&mut self, glob: &[u8], index: u32) -> Option<&Segment> {
        let read = || Segment::of(glob, index as usize);
        let it = match self.prepared {
            Some(shape) => shape.known().segment.get_or_init(read),
            None => self.unprepared_segment.get_or_insert_with(read),
        };
        it.as_deref()
            .filter(|it| it.start <= index && index < it.end)
    }

    /// The pattern's groups. They are read when the loop gets to something that it can't judge by itself.
    #[inline(always)]
    fn parsed(&mut self, glob: &[u8]) -> &Parsed {
        match (self.prepared, &mut self.unprepared) {
            (Some(shape), _) => shape.parsed(glob),
            (None, Some(parsed)) => parsed,
            (None, unprepared) => {
                let parsed = unprepared.insert(Parsed::new());
                parsed.read(glob);
                parsed
            }
        }
    }
}

/// Result of [`try_group`].
enum Tried {
    /// It's a group that the loop can't handle.
    IsGroup,
    Failed,
    /// The group is a [`Choice`] and matched. Go on at this pattern index and this path index.
    Took(u32, u32),
    /// The same for the whole segment of the pattern that the group is in. See [`Segment`].
    TookSegment(u32, u32),
    FailedSegment,
}

/// Whether the loop can match a group like a literal. It can if the group is `{a,b}` or `@(a|b)`, has two or more alternatives,
/// all of them plain literals, and at any place in the path either fails or takes a number of bytes that is known beforehand.
/// `?(a)` counts as `@(a|)`.
/// The pattern has to be regular, see [`Parsed::is_regular`]. The loop for dot segments doesn't do this: `{.,a}` can start a
/// segment that a later `**` may not cross.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Choice {
    No,
    /// All alternatives have the same length, which isn't 0.
    OneLength,
    /// A `/` follows the group, so it takes the rest of the segment.
    RestOfSegment,
    /// The pattern ends with the group, so it takes the rest of the path.
    RestOfPath,
}

/// Where the loop is when it asks [`try_group`].
#[derive(Copy, Clone)]
struct At {
    /// It applies the rules for dot segments.
    is_strict: bool,
    seen: Seen,
}

/// Looks at the group that starts at `index`, which the loop hasn't taken for a [`Choice`].
/// Returns `None` if no group starts there.
#[cold]
#[inline(never)]
fn try_group(
    glob: &[u8],
    index: u32,
    path: &[u8],
    path_index: u32,
    at: At,
    groups: &mut Groups<'_>,
    is_windows: bool,
) -> Option<Tried> {
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    // As long as the pattern looks regular, the loop goes on without reading all of it.
    if !at.is_strict && at.seen != Seen::Odd && !groups.is_parsed() {
        // The segment of the path that the loop is in.
        let is_inside = |it: &&u8| !is_separator(**it);
        let (before, after) = path.split_at(path_index as usize);
        let from = before.len() - before.iter().rev().take_while(is_inside).count();
        let to = before.len() + after.iter().take_while(is_inside).count();
        let walks = |it: &Segment| {
            let pattern = &glob[it.start as usize..it.end as usize];
            let on = (it.program).on(pattern, &path[..to], from, is_windows, Dots::Match);
            may_end_with(pattern, &path[from..to]) && on.walk()
        };
        let found = groups.segment_at(glob, index).map(|it| (walks(it), it.end));
        if let Some((is_match, end)) = found {
            return Some(match is_match {
                true => Tried::TookSegment(end, to as u32),
                false => Tried::FailedSegment,
            });
        }
    }
    let start = index + if glob[index as usize] == b'{' { 1 } else { 2 };
    let shape = groups.parsed(glob);
    if at.seen == Seen::Choice && !shape.is_regular {
        return Some(Tried::IsGroup);
    }
    let first = shape.group_at(start)?;
    if at.is_strict || shape.has_group {
        return Some(match shape.may_start_at(first, glob, path, path_index) {
            true => Tried::IsGroup,
            false => Tried::Failed,
        });
    }
    Some(
        match take_choice(
            &shape.alternatives,
            first,
            glob,
            path,
            path_index,
            is_windows,
        ) {
            Some((glob_index, path_index)) => Tried::Took(glob_index, path_index),
            None => Tried::Failed,
        },
    )
}

/// What [`match_written_out`] matches on.
struct Text<'a> {
    path: &'a [u8],
    /// Where the loop is.
    path_index: usize,
    /// The loop has no `*` or `**` to go back to.
    is_committed: bool,
    is_windows: bool,
}

/// Result of [`match_written_out`]: whether the segment of the pattern that the group is in matches the segment of the path that
/// the loop is in, and the indexes where the two end.
#[derive(Copy, Clone)]
struct Written {
    is_match: bool,
    glob_index: u32,
    path_index: u32,
}

#[cfg(debug_assertions)]
impl Written {
    /// A walk has to come to the same.
    fn check(self, glob: &[u8], open: usize, path: &[u8], is_windows: bool) {
        let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
        // A segment that starts with `!` can't be read on its own.
        let Some(it) = Segment::of(glob, open) else {
            return;
        };
        let pattern = &glob[it.start as usize..it.end as usize];
        let to = self.path_index as usize;
        let inside = path[..to].iter().rev();
        let from = to - inside.take_while(|it| !is_separator(**it)).count();
        let on = (it.program).on(pattern, &path[..to], from, is_windows, Dots::Match);
        let walked = may_end_with(pattern, &path[from..to]) && on.walk();
        debug_assert!((self.is_match, self.glob_index) == (walked, it.end));
    }
}

/// What [`match_written_out`] has to know about the pattern. The loop keeps this for the last group that it has asked about.
#[derive(Copy, Clone)]
struct Layout {
    /// Index of the group.
    open: u32,
    /// Index of its `}`, or 0 if it can't be written out.
    close: u32,
    /// Where its alternatives end, and how many there are besides the last one.
    commas: [u32; 4],
    count: u8,
    /// Index where what's written out ends.
    end: u32,
    /// The group has a `*`, so it's no [`Choice`].
    has_star: bool,
}

impl Layout {
    const NONE: Layout = Layout {
        open: u32::MAX,
        close: 0,
        commas: [0; 4],
        count: 0,
        end: 0,
        has_star: false,
    };

    #[inline(always)]
    fn read(glob: &[u8], open: usize) -> Option<Layout> {
        if glob[open] != b'{' {
            return None;
        }
        let mut commas = [0; 4];
        let (mut count, mut close) = (0, 0);
        // How many groups are open, which of those have had a `,`, and how many groups there have been.
        let (mut depth, mut has_comma, mut groups) = (1, 0_u32, 1);
        let mut has_star = false;
        let mut end = open + 1;
        while let Some(&ch) = glob.get(end) {
            match ch {
                _ if IS_TEXT[ch as usize] => {}
                // The loop compares as many bytes as the first one announces. They must not go on into something else.
                0x80.. => {
                    let len = usize::from(strings::wtf8_byte_sequence_length(ch));
                    if glob.get(end..end + len)?.iter().any(u8::is_ascii) {
                        return None;
                    }
                    end += len - 1;
                }
                b'/' if depth == 0 => break,
                b'/' => return None,
                b',' if depth > 0 => {
                    has_comma |= 1 << depth;
                    if close == 0 && depth == 1 {
                        *commas[..3].get_mut(count)? = end as u32;
                        count += 1;
                    }
                }
                b'{' if groups < 3 => {
                    groups += 1;
                    depth += 1;
                    has_comma &= !(1 << depth);
                }
                // With one alternative it may be a sequence like `{1..3}`.
                b'}' if has_comma & 1 << depth != 0 => {
                    depth -= 1;
                    if close == 0 && depth == 0 {
                        close = end;
                    }
                }
                b'*' => {
                    has_star |= close == 0;
                    if glob.get(end + 1) == Some(&b'*') {
                        return None;
                    }
                }
                b'?' => {}
                b'[' => {
                    let (after, may_be_separator) = class_shape(glob, end)?;
                    if may_be_separator || glob[end + 1] == b'(' {
                        return None;
                    }
                    end = after - 1;
                }
                _ => return None,
            }
            end += 1;
        }
        if depth > 0 {
            return None;
        }
        commas[count] = close as u32;
        Some(Layout {
            open: open as u32,
            close: close as u32,
            commas,
            count: count as u8,
            end: end as u32,
            has_star,
        })
    }
}

/// Matches without a [`Program`]: writes the pattern out once for each alternative of the group at `open`, and matches that.
/// It writes out the segment that the group is in, which has to be a [`Segment`]. Returns `None` unless that is short and has few
/// groups and alternatives, which makes this the cheaper way.
#[inline(never)]
fn match_written_out(
    glob: &[u8],
    open: usize,
    text: &Text<'_>,
    layout: &mut Layout,
) -> Option<Written> {
    if layout.open != open as u32 {
        *layout = Layout::read(glob, open).unwrap_or(Layout {
            open: open as u32,
            ..Layout::NONE
        });
    }
    let Layout { commas, count, .. } = *layout;
    let (close, end) = (layout.close as usize, layout.end as usize);
    if close == 0 {
        return None;
    }
    // The segment of the path that the loop is in.
    let is_inside = |it: &&u8| **it != b'/' && !(text.is_windows && **it == b'\\');
    let (left, right) = text.path.split_at(text.path_index);
    // What the loop has taken for good doesn't have to be matched again.
    let (start, path_start) = match text.is_committed {
        true => (open, left.len()),
        false => {
            let before = glob[negations(glob)..open].iter().rev();
            (
                open - before.take_while(|it| **it != b'/').count(),
                left.len() - left.iter().rev().take_while(is_inside).count(),
            )
        }
    };
    let path_end = left.len() + right.iter().take_while(is_inside).count();
    let path = &text.path[path_start..path_end];
    let found = |is_match: bool| Written {
        is_match,
        glob_index: end as u32,
        path_index: path_end as u32,
    };
    let (before, after) = (&glob[start..open], &glob[close + 1..end]);
    // An alternative with nothing around it is a pattern as it stands.
    let is_written = end - start > close + 1 - open;
    let mut written = [0; 64];
    if is_written && end - start > written.len() {
        return None;
    }
    if !after.is_empty() && !may_end_with(after, path) {
        return Some(found(false));
    }
    // What's after the group stays at the end of the buffer. The rest is written to the left of it.
    let seam = written.len() - after.len();
    if is_written {
        written[seam..].copy_from_slice(after);
    }
    let mut from = open + 1;
    for &to in &commas[..=usize::from(count)] {
        let alternative = &glob[from..to as usize];
        from = to as usize + 1;
        // Most alternatives start with a literal that the path doesn't go on with.
        if before.is_empty()
            && let Some(first) = alternative.first()
            && IS_PLAIN[*first as usize]
            && path.first() != Some(first)
        {
            continue;
        }
        // Or end with one that the path doesn't end with.
        if after.is_empty()
            && let Some(last) = alternative.last()
            && IS_TEXT[*last as usize]
            && *last != b']'
            && path.last() != Some(last)
        {
            continue;
        }
        let mut pattern = alternative;
        if is_written {
            let other_seam = seam - alternative.len();
            written[other_seam..seam].copy_from_slice(alternative);
            let start = other_seam - before.len();
            written[start..other_seam].copy_from_slice(before);
            // Two `*` that come to stand side by side would be a `**`.
            let is_globstar =
                |at: usize| at > start && written[at - 1] == b'*' && written.get(at) == Some(&b'*');
            if is_globstar(seam) || is_globstar(other_seam) {
                return None;
            }
            pattern = &written[start..];
        }
        // A leading `!` would mean something else in a pattern of its own.
        if pattern.first() == Some(&b'!') {
            return None;
        }
        let mode = Mode::on(Dots::Match, text.is_windows);
        if match_written(pattern, path, mode) {
            return Some(found(true));
        }
    }
    Some(found(false))
}

/// Returns false if `pattern` ends with literal bytes that `text` doesn't end with.
fn may_end_with(pattern: &[u8], text: &[u8]) -> bool {
    let literal = pattern.iter().rev();
    let len = literal
        .take_while(|it| IS_TEXT[**it as usize] && **it != b']')
        .count();
    let (before, mut literal) = pattern.split_at(pattern.len() - len);
    // After a `\` the first one stands for something else.
    if before.last() == Some(&b'\\') && !literal.is_empty() {
        literal = &literal[1..];
    }
    // A byte that isn't ASCII may stand for a character together with the bytes that follow it.
    text.ends_with(literal) || before.iter().rev().take(3).any(|it| *it >= 128)
}

/// What tells where a group of literals can start. The loop keeps this for the last group that it has asked about.
struct Firsts {
    /// Index of the group.
    index: u32,
    /// The first byte of each alternative, and how many there are. 0 if there are too many, or if one is empty.
    count: u8,
    bytes: [u8; 8],
    /// The length of the longest alternative, if the group ends a segment of the pattern.
    longest_at_end: Option<u32>,
}

impl Firsts {
    const NONE: Firsts = Firsts {
        index: u32::MAX,
        count: 0,
        bytes: [0; 8],
        longest_at_end: None,
    };

    #[inline]
    fn read(&mut self, glob: &[u8], index: u32) {
        *self = Firsts {
            index,
            ..Firsts::NONE
        };
        // A `{` or `@(` that's followed by plain literals and its closing bracket is a group, whatever the rest of the pattern is.
        let Some(Brackets {
            first,
            separator,
            closer,
        }) = brackets_at(glob, index as usize)
        else {
            return;
        };
        if glob[index as usize] == b'?' {
            return;
        }
        let (mut count, mut has_firsts) = (0, true);
        let (mut start, mut longest) = (first, 0);
        let mut at = first;
        loop {
            let Some(&ch) = glob.get(at) else {
                return;
            };
            if ch == separator || ch == closer {
                has_firsts &= at > start;
                longest = longest.max(at - start);
                if ch == closer {
                    break;
                }
                start = at + 1;
            } else if !IS_PLAIN[ch as usize] {
                return;
            } else if at == start {
                match self.bytes.get_mut(count) {
                    Some(it) if IS_TEXT[ch as usize] => *it = ch,
                    _ => has_firsts = false,
                }
                count += 1;
            }
            at += 1;
        }
        // With one alternative it may be a sequence like `{1..3}`.
        if start == first {
            return;
        }
        if has_firsts {
            self.count = count as u8;
        }
        if matches!(glob.get(at + 1), None | Some(b'/')) {
            self.longest_at_end = Some(longest as u32);
        }
    }
}

/// After a `*`: returns the first index at or after `path_index` where the token at `index` could match, or the end of the segment.
#[inline(never)]
fn skip_ahead(
    glob: &[u8],
    index: u32,
    path: &[u8],
    path_index: u32,
    ignores_dots: bool,
    is_first_time: bool,
    has_seen_odd_token: bool,
    kept: &mut Kept,
    is_windows: bool,
) -> Skipped {
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    let next = glob[index as usize];
    if matches!(next, b'{' | b'@' | b'+') {
        // The loop may have missed a way to get here. It has to get to the group, where a walk takes over.
        if has_seen_odd_token {
            return Skipped {
                path_index,
                can_start: true,
            };
        }
        return skip_to_start(glob, index, path, path_index, &mut kept.firsts, is_windows);
    }
    let mut at = path_index as usize;
    if !ignores_dots {
    } else if is_first_time
        && let Some((width, may_take_separator)) = fixed_width(&glob[index as usize..])
    {
        // The `*` takes all but that much of the segment.
        let rest = &path[at..];
        let len = rest
            .iter()
            .position(|it| is_separator(*it))
            .unwrap_or(rest.len());
        if rest[..len].is_ascii() && (!may_take_separator || len == rest.len()) {
            at += len - width.min(len);
        }
    } else if next >= 128 {
        while let Some(&found) = path.get(at)
            && found != next
            && !is_separator(found)
        {
            at += usize::from(rune_len_at(path, at));
        }
    } else if next == b'[' {
        let class = kept.class_at(glob, index);
        while let Some(&found) = path.get(at)
            && !is_separator(found)
        {
            let (c, len) = decode_rune_at(path, at);
            let has = match &class {
                Some(class) => Some(class.has(c)),
                None => class_has(glob, index, c),
            };
            if has != Some(false) {
                break;
            }
            at += usize::from(len);
        }
    } else if next == b'?' {
        // The `?`s take as many characters. What's after them says where they can be.
        let rest = &glob[index as usize..];
        let mut count = rest.iter().take_while(|it| **it == b'?').count();
        count -= usize::from(rest.get(count) == Some(&b'('));
        let wanted = rest.get(count).copied();
        if wanted.is_none_or(|it| it == b'/' || IS_PLAIN[it as usize]) {
            while let Some(window) = path.get(at..at + count)
                && window.is_ascii()
                && !is_separator(path[at])
            {
                let found = path.get(at + count).copied();
                let fits = match wanted {
                    Some(b'/') | None => found.is_none_or(is_separator),
                    Some(_) => found == wanted,
                };
                if fits || found.is_some_and(|it| it >= 128) {
                    break;
                }
                at += 1;
            }
        }
    }
    Skipped {
        path_index: at as u32,
        can_start: true,
    }
}

/// If `tokens` has only tokens that take one character up to the end of the segment, returns how many there are, and whether one of
/// them can take a separator.
#[inline(always)]
fn fixed_width(tokens: &[u8]) -> Option<(usize, bool)> {
    // Most of the time another `*` or a group follows.
    let mut is_escaped = false;
    for &ch in tokens {
        if ch == b'/' {
            break;
        }
        if matches!(ch, b'*' | b'{' | 0x80..) && !is_escaped {
            return None;
        }
        is_escaped = ch == b'\\' && !is_escaped;
    }
    let (mut at, mut width) = (0, 0);
    let mut may_take_separator = false;
    while let Some(&ch) = tokens.get(at)
        && ch != b'/'
    {
        at = match ch {
            b'?' | b'+' | b'@' | b'!' if tokens.get(at + 1) == Some(&b'(') => return None,
            b'*' | b'{' | 0x80.. => return None,
            b'[' => {
                let class = AsciiClass::read(tokens, at)?;
                may_take_separator |= !class.is_regular(tokens, at);
                class.end as usize
            }
            b'\\' => match tokens.get(at + 1) {
                Some(b'/' | b'\\' | 0x80..) | None => return None,
                Some(_) => at + 2,
            },
            _ => at + 1,
        };
        width += 1;
    }
    (!may_take_separator || at == tokens.len()).then_some((width, may_take_separator))
}

/// A class that has neither escapes nor characters that aren't ASCII.
struct AsciiClass {
    /// One bit for each ASCII character that it matches.
    members: u128,
    /// It starts with `!` or `^`, so it matches every character that isn't ASCII.
    negated: bool,
    /// Index after the `]`.
    end: u32,
}

impl AsciiClass {
    /// Returns `None` for any other class, and for one that isn't closed.
    #[inline(always)]
    fn read(glob: &[u8], open: usize) -> Option<AsciiClass> {
        let mut at = open + 1;
        let negated = matches!(glob.get(at), Some(b'^' | b'!'));
        at += usize::from(negated);
        let first = at;
        let mut members = 0_u128;
        loop {
            let low = *glob.get(at)?;
            if low == b']' && at > first {
                break;
            }
            if low == b'\\' || low >= 128 {
                return None;
            }
            if glob.get(at + 1) == Some(&b'-')
                && let Some(&high) = glob.get(at + 2)
                && high != b']'
            {
                if high == b'\\' || high >= 128 {
                    return None;
                }
                if low <= high {
                    members |= (u128::MAX >> (127 - (high - low))) << low;
                }
                at += 3;
            } else {
                members |= 1 << low;
                at += 1;
            }
        }
        Some(AsciiClass {
            members: if negated { !members } else { members },
            negated,
            end: at as u32 + 1,
        })
    }

    #[inline(always)]
    fn has(&self, c: u32) -> bool {
        match c < 128 {
            true => self.members >> c & 1 == 1,
            false => self.negated,
        }
    }

    /// See [`Parsed::is_regular`].
    #[inline(always)]
    fn is_regular(&self, glob: &[u8], open: usize) -> bool {
        self.members & (1 << b'/' | 1 << b'\\') == 0 && glob[open + 1] != b'('
    }
}

/// What the loop keeps about the tokens that it has looked at last, because it often comes back to them.
struct Kept {
    firsts: Firsts,
    layout: Layout,
    /// Index of the last class that the loop has been at.
    class_seen_at: u32,
    /// Index of `class`.
    class_index: u32,
    class: AsciiClass,
    /// See [`AsciiClass::is_regular`].
    is_regular_class: bool,
}

impl Kept {
    const NOTHING: Kept = Kept {
        firsts: Firsts::NONE,
        layout: Layout::NONE,
        class_seen_at: u32::MAX,
        class_index: u32::MAX,
        class: AsciiClass {
            members: 0,
            negated: false,
            end: 0,
        },
        is_regular_class: false,
    };

    /// Returns the class at `open`, if it's an [`AsciiClass`].
    #[inline(always)]
    fn class_at(&mut self, glob: &[u8], open: u32) -> Option<&AsciiClass> {
        if self.class_index != open {
            self.read_class(glob, open)?;
        }
        Some(&self.class)
    }

    #[inline(never)]
    fn read_class(&mut self, glob: &[u8], open: u32) -> Option<()> {
        self.class = AsciiClass::read(glob, open as usize)?;
        self.is_regular_class = self.class.is_regular(glob, open as usize);
        self.class_index = open;
        Some(())
    }
}

/// Result of [`skip_to_start`].
struct Skipped {
    path_index: u32,
    /// False if no alternative can start at `path_index`.
    can_start: bool,
}

/// Returns the first index at or after `path_index` where an alternative of the group at `index` could start,
/// or the end of the segment.
#[inline(never)]
fn skip_to_start(
    glob: &[u8],
    index: u32,
    path: &[u8],
    mut path_index: u32,
    firsts: &mut Firsts,
    is_windows: bool,
) -> Skipped {
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    if firsts.index != index {
        firsts.read(glob, index);
    }
    // A group that ends a segment of the pattern ends one of the path.
    if let Some(longest) = firsts.longest_at_end {
        let rest = &path[path_index as usize..];
        let len = rest
            .iter()
            .position(|it| is_separator(*it))
            .unwrap_or(rest.len());
        path_index += (len as u32).saturating_sub(longest);
    }
    if firsts.count == 0 {
        return Skipped {
            path_index,
            can_start: true,
        };
    }
    let firsts = &firsts.bytes[..usize::from(firsts.count)];
    while let Some(found) = path.get(path_index as usize)
        && !is_separator(*found)
        && !firsts.contains(found)
    {
        path_index += u32::from(rune_len_at(path, path_index as usize));
    }
    let can_start = path
        .get(path_index as usize)
        .is_some_and(|it| firsts.contains(it));
    Skipped {
        path_index,
        can_start,
    }
}

/// One alternative of a group.
#[derive(Copy, Clone)]
struct Alternative {
    start: u32,
    /// Index of the `,`, `|`, `}` or `)` after it.
    end: u32,
    /// Index in [`Parsed::alternatives`] of the group's next alternative. Out of range for the last one.
    next: u32,
    /// On a group's first alternative, the index of the closing `}` or `)`. 0 means the group is unclosed and therefore literal.
    close: u32,
    /// On a group's first alternative.
    choice: Choice,
}

impl Alternative {
    /// Cheap check on the first character. Most alternatives start with a literal that the path doesn't continue with.
    #[inline(always)]
    fn may_start_at(&self, glob: &[u8], path: &[u8], path_index: u32) -> bool {
        let first = glob[self.start as usize];
        if self.start == self.end {
            return true;
        }
        match path.get(path_index as usize) {
            Some(found) if IS_PLAIN[first as usize] => *found == first,
            Some(_) if first == b'[' => {
                let c = decode_rune_at(path, path_index as usize).0;
                class_has(glob, self.start, c) != Some(false)
            }
            Some(_) => true,
            None => !IS_PLAIN[first as usize],
        }
    }

    /// The same check on the literal bytes that the alternative starts with.
    #[inline(always)]
    fn may_go_on_at(&self, glob: &[u8], path: &[u8], path_index: u32) -> bool {
        let text = &glob[self.start as usize..self.end as usize];
        let literal = text.iter().take_while(|it| IS_PLAIN[**it as usize]).count();
        path[path_index as usize..].starts_with(&text[..literal])
    }

    /// On a group's first alternative: whether the group is a `?(a)`.
    #[inline(always)]
    fn is_optional(&self, glob: &[u8]) -> bool {
        glob[self.start as usize - 1] == b'(' && glob[self.start as usize - 2] == b'?'
    }

    /// Value of `next` that marks the inside of a sequence like `{1..3}`.
    const IS_SEQUENCE: u32 = u32::MAX - 1;
}

/// The inside of a brace sequence as in bash: `1..3`, `01..10`, `9..1..2`, `a..e`.
struct Sequence {
    from: i64,
    to: i64,
    /// At least 1.
    step: i64,
    of: SequenceOf,
}

enum SequenceOf {
    Letters,
    /// `width` is the zero-padded length if either bound has a leading zero, otherwise 0.
    /// `longest` is the length of the longer bound as written.
    Numbers {
        width: usize,
        longest: u32,
    },
}

/// Whether `written` is the inside of a sequence like `{1..3}`.
pub fn is_sequence(written: &[u8]) -> bool {
    Sequence::read(written).is_some()
}

impl Sequence {
    /// No number or letter of the sequence is written with more bytes.
    fn longest(&self) -> u32 {
        match self.of {
            SequenceOf::Letters => 1,
            SequenceOf::Numbers { longest, .. } => longest,
        }
    }

    fn read(written: &[u8]) -> Option<Sequence> {
        let mut parts = strings::split(written, b"..");
        let (from, to, step) = (parts.next()?, parts.next()?, parts.next());
        if parts.next().is_some() {
            return None;
        }
        let number = |text: &[u8]| -> Option<i64> {
            let digits = text.strip_prefix(b"-").unwrap_or(text);
            let is_number = !digits.is_empty() && digits.iter().all(u8::is_ascii_digit);
            std::str::from_utf8(text)
                .ok()
                .filter(|_| is_number)?
                .parse()
                .ok()
        };
        let is_padded = |text: &[u8]| matches!(text.strip_prefix(b"-").unwrap_or(text), [b'0', next, ..] if next.is_ascii_digit());
        let step = match step {
            Some(step) => number(step)?.checked_abs()?.max(1),
            None => 1,
        };
        match (from, to) {
            ([from], [to]) if from.is_ascii_alphabetic() && to.is_ascii_alphabetic() => {
                Some(Sequence {
                    from: i64::from(*from),
                    to: i64::from(*to),
                    step,
                    of: SequenceOf::Letters,
                })
            }
            _ => Some(Sequence {
                from: number(from)?,
                to: number(to)?,
                step,
                of: SequenceOf::Numbers {
                    width: match is_padded(from) || is_padded(to) {
                        true => from.len().max(to.len()),
                        false => 0,
                    },
                    longest: from.len().max(to.len()) as u32,
                },
            }),
        }
    }

    fn has_value(&self, value: i64) -> bool {
        (self.from.min(self.to)..=self.from.max(self.to)).contains(&value)
            && i128::from(value).abs_diff(i128::from(self.from)) % self.step as u128 == 0
    }

    /// bash expands the `\` in a range like `{A..z}` to nothing.
    fn has_nothing(&self) -> bool {
        matches!(self.of, SequenceOf::Letters) && self.has_value(i64::from(b'\\'))
    }

    /// Returns true if `text` is spelled exactly like one of the sequence's values.
    fn has(&self, text: &[u8]) -> bool {
        let SequenceOf::Numbers { width, .. } = self.of else {
            return text[0] != b'\\' && self.has_value(i64::from(text[0]));
        };
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        // The second check only saves time: what follows would come to the same.
        if digits.is_empty() || digits[0] == b'0' && digits.len() > 1 && text.len() != width {
            return false;
        }
        let zeros = (digits.iter().take_while(|it| **it == b'0').count()).min(digits.len() - 1);
        let Some(value) = std::str::from_utf8(text)
            .ok()
            .and_then(|it| it.parse::<i64>().ok())
        else {
            return false;
        };
        self.has_value(value)
            && !(value == 0 && digits.len() < text.len())
            && match zeros {
                0 => text.len() >= width,
                _ => text.len() == width,
            }
    }
}

/// What [`match_prepared`] knows about a pattern. It's found out when a match first needs it, and kept.
pub struct Shape {
    /// Empty until a match needs it, so that a shape costs next to nothing to make and to drop.
    known: Once<Arc<Known>>,
    /// How many matches the loop has decided, or one of the two constants.
    uses: AtomicU8,
}

struct Known {
    parsed: Once<Parsed>,
    /// See [`Groups::segment_at`].
    segment: Once<Option<Box<Segment>>>,
}

impl Shape {
    /// From now on a [`Walk`] decides. That's the case if the loop can't, or if the pattern is regular, so that both give the same
    /// answers, and has been matched often enough to make up for the cost of a [`Program`] and a [`Cache`].
    const WALKS: u8 = u8::MAX;
    /// The pattern isn't regular, or it's so plain that the loop is as fast.
    const NEVER_WALKS: u8 = u8::MAX - 1;
    const WALKS_AFTER: u8 = 32;

    /// `glob` is the pattern that the shape will be used with.
    #[inline]
    pub fn of(_glob: &[u8]) -> Shape {
        Shape {
            known: Once::new(),
            uses: AtomicU8::new(0),
        }
    }

    fn known(&self) -> &Known {
        self.known.get_or_init(|| {
            Arc::new(Known {
                parsed: Once::new(),
                segment: Once::new(),
            })
        })
    }

    /// The pattern's groups, if they have been read.
    #[inline(always)]
    fn parsed_so_far(&self) -> Option<&Parsed> {
        self.known.get()?.parsed.get()
    }

    /// Counts a match that is left to the loop. `uses` is the count so far.
    #[inline(always)]
    fn count(&self, glob: &[u8], uses: u8) {
        if uses < Shape::WALKS_AFTER {
            self.uses.store(uses + 1, Ordering::Relaxed);
        } else if uses == Shape::WALKS_AFTER {
            self.parse(glob);
        }
    }

    #[inline(always)]
    fn parsed(&self, glob: &[u8]) -> &Parsed {
        match self.parsed_so_far() {
            Some(parsed) => parsed,
            None => self.parse(glob),
        }
    }

    #[cold]
    #[inline(never)]
    fn parse(&self, glob: &[u8]) -> &Parsed {
        let uses = self.uses.load(Ordering::Relaxed);
        let parsed = self.known().parsed.get_or_init(|| {
            let mut parsed = Parsed::new();
            parsed.read(glob);
            parsed.is_matched_often = uses == Shape::WALKS_AFTER;
            parsed.text = parsed.text_of(glob);
            parsed
        });
        if !parsed.may_walk(Dots::Match) {
            self.uses.store(Shape::NEVER_WALKS, Ordering::Relaxed);
        } else if parsed.has_group || uses == Shape::WALKS_AFTER {
            self.uses.store(Shape::WALKS, Ordering::Relaxed);
        }
        parsed
    }

    /// Returns true if the group whose first alternative starts at `start` is a sequence like `{1..3}`.
    /// [`token_at`] must have found the group.
    pub(crate) fn is_sequence_at(&self, start: usize) -> bool {
        self.parsed_so_far().is_some_and(|parsed| {
            let first = parsed.group_at(start as u32);
            first
                .is_some_and(|it| parsed.alternatives[it as usize].next == Alternative::IS_SEQUENCE)
        })
    }

    /// Returns the range of each alternative of the group whose first alternative starts at `start`.
    /// [`token_at`] must have found the group.
    pub(crate) fn alternatives_at(
        &self,
        start: usize,
    ) -> impl Iterator<Item = std::ops::Range<usize>> {
        let parsed = self.parsed_so_far();
        let mut next = parsed.and_then(|it| it.group_at(start as u32).map(|it| it as usize));
        std::iter::from_fn(move || {
            let it = parsed?.alternatives.get(next?)?;
            next = Some(it.next as usize);
            Some(it.start as usize..it.end as usize)
        })
    }
}

/// Where the first alternative of a group starts, what separates its alternatives, and what closes it.
struct Brackets {
    first: usize,
    separator: u8,
    closer: u8,
}

/// For a `{`, `@(` or `?(` at `open`.
#[inline(always)]
fn brackets_at(glob: &[u8], open: usize) -> Option<Brackets> {
    match glob[open] {
        b'{' => Some(Brackets {
            first: open + 1,
            separator: b',',
            closer: b'}',
        }),
        b'@' | b'?' if glob.get(open + 1) == Some(&b'(') => Some(Brackets {
            first: open + 2,
            separator: b'|',
            closer: b')',
        }),
        _ => None,
    }
}

/// What the loop can go back to when it gets to a group.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Pending {
    Nothing,
    /// Only a `**`, so in this segment the group can only start where the loop is.
    Globstar,
    /// A `*` right before the group.
    StarBefore,
    /// A `*` further to the left in this segment.
    Star,
}

/// Result of [`take_plain_choice`].
#[derive(Copy, Clone)]
enum Taken {
    /// The pattern index and the path index after the group.
    To(u32, u32),
    /// It doesn't match here.
    Nothing,
}

/// Matches the group that starts at `open` if it's a [`Choice`] of a regular pattern, as far as that shows without reading the whole
/// pattern. Other groups of literals will do as well if the group can only start here, and what follows it in the pattern leaves
/// only one alternative.
#[inline(never)]
fn take_plain_choice(
    glob: &[u8],
    open: u32,
    path: &[u8],
    path_index: u32,
    is_windows: bool,
    pending: Pending,
) -> Option<Taken> {
    let Brackets {
        first,
        separator,
        closer,
    } = brackets_at(glob, open as usize)?;
    let is_optional = glob[open as usize] == b'?';
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    let rest = &path[path_index as usize..];
    // The lengths of the alternatives that `rest` starts with, one bit for each. `?(a)` has an empty one.
    let mut lens = u64::from(is_optional);
    let mut has_slash = false;
    let (mut shortest, mut longest) = (if is_optional { 0 } else { usize::MAX }, 0);
    // Where the alternative being read starts.
    let mut start = first;
    let mut at = first;
    'group: loop {
        // As far as `rest` goes along.
        while let Some(&ch) = glob.get(at)
            && IS_TEXT[ch as usize]
            && rest.get(at - start) == Some(&ch)
        {
            at += 1;
        }
        let mut is_start = true;
        loop {
            let ch = *glob.get(at)?;
            if ch == separator || ch == closer {
                shortest = shortest.min(at - start);
                longest = longest.max(at - start);
                if is_start {
                    lens |= 1_u64.checked_shl((at - start) as u32)?;
                }
                at += 1;
                if ch == closer {
                    break 'group;
                }
                start = at;
                continue 'group;
            }
            if IS_PLAIN[ch as usize] {
                is_start = is_start && rest.get(at - start) == Some(&ch);
            } else if ch == b'/' && pending == Pending::Nothing {
                has_slash = true;
                is_start = is_start && rest.get(at - start).is_some_and(|it| is_separator(*it));
            } else if matches!(ch, b'?' | b'[' | b'{')
                && matches!(pending, Pending::Nothing | Pending::Globstar)
            {
                let is_committed = pending == Pending::Nothing;
                return take_fixed_choice(glob, open, path, path_index, is_windows, is_committed);
            } else {
                return None;
            }
            at += 1;
            // The rest of an alternative that differs.
            while !is_start
                && let Some(&ch) = glob.get(at)
                && IS_TEXT[ch as usize]
            {
                at += 1;
            }
        }
    }
    // With one alternative it may be a sequence like `{1..3}`.
    if !is_optional && start == first {
        return None;
    }
    let after = at;
    let mut taken = None;
    match glob.get(after) {
        None => {
            if rest.len() < 64 && lens >> rest.len() & 1 == 1 {
                taken = Some(rest.len());
            }
        }
        Some(b'/') => {
            while lens != 0 {
                let len = lens.trailing_zeros() as usize;
                lens &= lens - 1;
                if rest.get(len).is_none_or(|it| is_separator(*it)) {
                    if taken.is_some() {
                        return None;
                    }
                    taken = Some(len);
                }
            }
        }
        // What looks for the start of a segment of the pattern later on must not find that `/`.
        Some(_) if has_slash => return None,
        Some(_) if shortest == longest && shortest > 0 => taken = (lens != 0).then_some(shortest),
        Some(_) if pending == Pending::Star => return None,
        Some(b'*') if !matches!(glob.get(after + 1), Some(b'*' | b'(')) => {
            // The `*` makes up for what a shorter alternative leaves.
            taken = (lens != 0).then(|| lens.trailing_zeros() as usize);
            // After a `*`, an alternative that starts further to the right may end further to the left.
            if pending == Pending::StarBefore
                && let Some(len) = taken
                && len > shortest + 1
            {
                return None;
            }
        }
        Some(_) if pending == Pending::StarBefore => return None,
        Some(_) => {
            while lens != 0 {
                let len = lens.trailing_zeros() as usize;
                lens &= lens - 1;
                let mut index = 0;
                let fits = loop {
                    match glob.get(after + index) {
                        Some(wanted) if IS_PLAIN[*wanted as usize] || *wanted >= 128 => {
                            if rest.get(len + index) != Some(wanted) {
                                break false;
                            }
                            index += 1;
                        }
                        _ => break true,
                    }
                };
                if fits {
                    if taken.is_some() {
                        return None;
                    }
                    taken = Some(len);
                }
            }
        }
    }
    Some(match taken {
        Some(len) => Taken::To(after as u32, path_index + len as u32),
        None => Taken::Nothing,
    })
}

/// A group that [`take_fixed_choice`] is in.
#[derive(Copy, Clone, Default)]
struct Level {
    /// Where its alternatives can start, and where the ones that have been read can end: one bit for each number of bytes.
    starts: u64,
    ends: u64,
    /// The least and the most that its alternative of the group around it takes before it.
    before: (u32, u32),
    /// The least and the most that the alternatives which have been read take.
    widths: (u32, u32),
    has_separator: bool,
}

/// [`take_plain_choice`] for a group whose alternatives have other tokens that take one character, or groups of such alternatives.
/// The group can only start here.
#[inline(never)]
fn take_fixed_choice(
    glob: &[u8],
    open: u32,
    path: &[u8],
    path_index: u32,
    is_windows: bool,
    is_committed: bool,
) -> Option<Taken> {
    let Brackets {
        first,
        separator,
        closer,
    } = brackets_at(glob, open as usize)?;
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    let rest = &path[path_index as usize..];
    let mut levels = [Level::default(); 4];
    let mut depth = 0;
    levels[0] = Level {
        starts: 1,
        widths: (u32::MAX, 0),
        ..Level::default()
    };
    // `?(a)` has an empty alternative.
    if glob[open as usize] == b'?' {
        levels[0].ends = 1;
        levels[0].widths = (0, 0);
        levels[0].has_separator = true;
    }
    // Where what has been read of the alternative can end, and the least and the most that it takes.
    let mut ends = 1_u64;
    let mut widths = (0, 0);
    let mut has_slash = false;
    let mut at = first;
    loop {
        let ch = *glob.get(at)?;
        at += 1;
        if IS_TEXT[ch as usize] || ch == b'/' || ch == b'?' || ch == b'[' {
            let mut class_end = 0;
            match ch {
                b'/' if !is_committed || depth > 0 => return None,
                b'/' => has_slash = true,
                b'?' if glob.get(at) == Some(&b'(') => return None,
                b'[' => {
                    let (_, close, is_regular) = ascii_class::<true>(glob, at - 1, 0)?;
                    if !is_regular {
                        return None;
                    }
                    class_end = close + 1;
                }
                _ => {}
            }
            let (mut from, mut to) = (ends, 0);
            while from != 0 {
                let len = from.trailing_zeros() as usize;
                from &= from - 1;
                let Some(&found) = rest.get(len) else {
                    continue;
                };
                let is_same = match ch {
                    b'/' => is_separator(found),
                    b'?' | b'[' if found >= 128 => return None,
                    b'?' => !is_separator(found),
                    b'[' => ascii_class::<false>(glob, at - 1, found)?.0,
                    _ => found == ch,
                };
                if is_same {
                    to |= 2_u64.checked_shl(len as u32)?;
                }
            }
            ends = to;
            widths = (widths.0 + 1, widths.1 + 1);
            if ch == b'[' {
                at = class_end;
            }
            continue;
        }
        let level = &mut levels[depth];
        let (separator, closer) = match depth {
            0 => (separator, closer),
            _ => (b',', b'}'),
        };
        if ch == separator || ch == closer {
            level.ends |= ends;
            level.widths = (level.widths.0.min(widths.0), level.widths.1.max(widths.1));
            if ch == separator {
                level.has_separator = true;
                ends = level.starts;
                widths = (0, 0);
                continue;
            }
            // With one alternative it may be a sequence like `{1..3}`.
            if !level.has_separator {
                return None;
            }
            ends = level.ends;
            widths = (
                level.before.0 + level.widths.0,
                level.before.1 + level.widths.1,
            );
            if depth == 0 {
                break;
            }
            depth -= 1;
        } else if ch == b'{' && closer == b'}' {
            depth += 1;
            *levels.get_mut(depth)? = Level {
                starts: ends,
                before: widths,
                widths: (u32::MAX, 0),
                ..Level::default()
            };
            widths = (0, 0);
        } else {
            return None;
        }
    }
    let after = at;
    let shortest = widths.0 as usize;
    let mut taken = None;
    let mut lens = ends;
    match glob.get(after) {
        None => {
            if rest.len() < 64 && ends >> rest.len() & 1 == 1 {
                taken = Some(rest.len());
            }
        }
        Some(b'/') => {
            while lens != 0 {
                let len = lens.trailing_zeros() as usize;
                lens &= lens - 1;
                if rest.get(len).is_none_or(|it| is_separator(*it)) {
                    if taken.is_some() {
                        return None;
                    }
                    taken = Some(len);
                }
            }
        }
        // What looks for the start of a segment of the pattern later on must not find that `/`.
        Some(_) if has_slash => return None,
        Some(_) if widths.0 == widths.1 && widths.0 > 0 => {
            taken = (ends != 0).then_some(shortest);
        }
        Some(b'*') if !matches!(glob.get(after + 1), Some(b'*' | b'(')) => {
            // The `*` makes up for what a shorter alternative leaves.
            taken = (ends != 0).then(|| ends.trailing_zeros() as usize);
        }
        Some(_) => {
            while lens != 0 {
                let len = lens.trailing_zeros() as usize;
                lens &= lens - 1;
                let mut index = 0;
                let fits = loop {
                    match glob.get(after + index) {
                        Some(wanted) if IS_PLAIN[*wanted as usize] || *wanted >= 128 => {
                            if rest.get(len + index) != Some(wanted) {
                                break false;
                            }
                            index += 1;
                        }
                        _ => break true,
                    }
                };
                if fits {
                    if taken.is_some() {
                        return None;
                    }
                    taken = Some(len);
                }
            }
        }
    }
    Some(match taken {
        Some(len) => Taken::To(after as u32, path_index + len as u32),
        None => Taken::Nothing,
    })
}

/// A segment of a regular pattern that has a group which isn't a [`Choice`], and that can only match one whole segment of a path: it
/// has no `/` and no `**`, and no `!(a)`, whose meaning depends on what follows the segment. For the loop it's like a `Choice`
/// that takes the rest of a segment: it has a [`Program`] of its own, which says whether it matches the segment of the path.
/// It's read as a pattern of its own, which costs less than reading a long pattern.
struct Segment {
    /// Indexes of the pattern where it starts and ends.
    start: u32,
    end: u32,
    program: Program,
}

impl Segment {
    #[cold]
    #[inline(never)]
    fn of(glob: &[u8], index: usize) -> Option<Box<Segment>> {
        let before = glob[negations(glob)..index].iter().rev();
        let start = index - before.take_while(|it| **it != b'/').count();
        let end = index + glob[index..].iter().take_while(|it| **it != b'/').count();
        let pattern = &glob[start..end];
        // A leading `!` would mean something else in a pattern of its own.
        if pattern[0] == b'!' || glob[index] == b'!' {
            return None;
        }
        let mut parsed = Parsed::new();
        parsed.read(pattern);
        if !parsed.is_regular || !parsed.is_one_segment {
            return None;
        }
        let mut it = Box::new(Segment {
            start: start as u32,
            end: end as u32,
            program: Program::new(),
        });
        it.program.read(pattern, &parsed, 0);
        Some(it)
    }
}

/// The groups of a pattern.
struct Parsed {
    /// The alternatives of every group, sorted by start index.
    alternatives: SmallVec<[Alternative; 8]>,
    /// The loop finds every match of each stretch of the pattern that has no groups. It doesn't if a class or an escape can match
    /// a separator, if a class starts with `(`, if a `**` isn't a whole segment, or if a bracket isn't closed.
    is_regular: bool,
    /// All that keeps it from being regular are classes that can match a separator. It has neither `*` nor groups, so there's only
    /// one way to match it, and the loop finds that.
    is_fixed: bool,
    /// It has only literal bytes that need no second look, which nothing compares faster than the loop.
    is_plain_text: bool,
    /// If all of it is literal, the one text that it matches.
    text: Option<Box<[u8]>>,
    /// The pattern has a group that isn't a [`Choice`].
    has_group: bool,
    has_choice: bool,
    /// See [`Segment`].
    is_one_segment: bool,
    /// The loop has matched the pattern often enough to make up for the cost of a [`Cache`].
    is_matched_often: bool,
    /// Number of `*`, `**`, `?` and classes, up to 2.
    wildcards: u8,
    /// All it has besides literal bytes is a `*` or `**` at the end, which the loop doesn't have to look at the path for.
    is_decided_at_once: bool,
    /// Index after the leading `!`s.
    top: u32,
    /// Index where the front of the pattern ends: the literal bytes and, in a regular pattern, the [`Choice`]s that it starts with.
    /// What the front takes of a path doesn't depend on the rest of the pattern.
    front_end: u32,
    /// Index in `alternatives` of the group that starts there, if one does.
    first_group: u32,
    /// Made when it's first needed.
    program: Once<Box<Program>>,
}

/// A group that [`Parsed::read`] hasn't seen the end of.
struct Open {
    is_brace: bool,
    /// All it has had so far are plain literals, and they have one length.
    is_plain: bool,
    has_one_length: bool,
    /// Indexes in `alternatives` of its first and latest alternative.
    first: u32,
    last: u32,
    /// Length of the first one, and where the latest one starts.
    first_len: u32,
    last_start: u32,
    /// A path segment of the pattern starts with the group.
    starts_segment: bool,
}

/// Bytes that are always literal in a pattern and never end anything.
static IS_TEXT: [bool; 256] = {
    let mut table = IS_PLAIN;
    let mut others = b"(),|}".as_slice();
    while let [first, rest @ ..] = others {
        table[*first as usize] = false;
        others = rest;
    }
    table
};

impl Parsed {
    #[inline(always)]
    fn new() -> Parsed {
        Parsed {
            alternatives: SmallVec::new(),
            is_regular: false,
            is_fixed: false,
            is_plain_text: false,
            text: None,
            has_group: false,
            has_choice: false,
            is_one_segment: false,
            is_matched_often: false,
            wildcards: 0,
            is_decided_at_once: false,
            top: 0,
            front_end: 0,
            first_group: u32::MAX,
            program: Once::new(),
        }
    }

    fn text_of(&self, glob: &[u8]) -> Option<Box<[u8]>> {
        let is_literal = self.is_regular && self.wildcards == 0 && self.alternatives.is_empty();
        if !is_literal || self.is_plain_text || std::str::from_utf8(glob).is_err() {
            return None;
        }
        let mut text = Vec::with_capacity(glob.len());
        let mut at = self.top;
        while let Some(&ch) = glob.get(at as usize) {
            let mut ch = ch;
            unescape(&mut ch, glob, &mut at);
            text.push(ch);
            at += 1;
        }
        Some(text.into_boxed_slice())
    }

    /// Returns true if a [`Walk`] gives the same answers as the loop, and is faster once it has a [`Cache`].
    fn may_walk(&self, dots: Dots) -> bool {
        (self.is_regular || self.is_fixed && dots == Dots::Match)
            && !self.is_decided_at_once
            && !self.is_plain_text
    }

    /// Finds all groups in one pass over `glob`.
    #[inline(never)]
    fn read(&mut self, glob: &[u8]) {
        let found = &mut self.alternatives;
        // The innermost open group, if `depth` isn't 0, and the ones around it.
        let mut group = Open {
            is_brace: false,
            is_plain: false,
            has_one_length: false,
            first: 0,
            last: 0,
            first_len: 0,
            last_start: 0,
            starts_segment: false,
        };
        let mut depth = 0_usize;
        let mut outer: SmallVec<[Open; 4]> = SmallVec::new();
        let top = negations(glob);
        let mut is_regular = true;
        let (mut has_group, mut has_choice, mut wildcards) = (false, false, 0_u32);
        // Number of open parenthesis groups and open brace groups.
        let mut count = [0_usize; 2];
        // No `[` at or after this index is closed.
        let mut no_class_from = usize::MAX;
        let mut escaped = usize::MAX;
        let mut i = top;
        while let Some(&ch) = glob.get(i)
            && (IS_PLAIN[ch as usize] || ch == b'/')
        {
            i += 1;
        }
        let mut front_end = i;
        self.is_plain_text = i == glob.len();
        let (mut has_star, mut has_separator_class) = (false, false);
        let mut is_one_segment = !strings::contains_char(&glob[top..i], b'/');
        while let Some(&ch) = glob.get(i) {
            if IS_TEXT[ch as usize] {
                i += 1;
                continue;
            }
            // At the start of the pattern, after a `/`, or at the start of an alternative of a group that starts a segment.
            let starts_segment = |at: usize, group: &Open| {
                at <= top
                    || glob[at - 1] == b'/' && escaped != at - 1
                    || depth > 0 && group.starts_segment && group.last_start as usize == at
            };
            let alternative = || Alternative {
                start: i as u32 + 1,
                end: 0,
                next: u32::MAX,
                close: 0,
                choice: Choice::No,
            };
            group.is_plain &= IS_PLAIN[ch as usize];
            wildcards += u32::from(matches!(ch, b'*' | b'?' | b'['));
            has_star |= ch == b'*';
            match ch {
                b'/' => is_one_segment = false,
                b'?' | b'!' | b'+' | b'@' => {}
                b',' | b'|' => {
                    if depth > 0 && group.is_brace == (ch == b',') {
                        let next = found.len() as u32;
                        let ended = &mut found[group.last as usize];
                        (ended.end, ended.next) = (i as u32, next);
                        let len = i as u32 - group.last_start;
                        match group.first == group.last {
                            true => group.first_len = len,
                            false => group.has_one_length &= len == group.first_len,
                        }
                        (group.last, group.last_start) = (next, i as u32 + 1);
                        found.push(alternative());
                    }
                }
                b'{' | b'('
                    if ch == b'{'
                        || i > 0
                            && escaped != i - 1
                            && matches!(glob[i - 1], b'?' | b'*' | b'+' | b'@' | b'!') =>
                {
                    let at = if ch == b'(' { i - 1 } else { i };
                    is_one_segment &= glob[at] != b'!';
                    let inner = Open {
                        is_brace: ch == b'{',
                        is_plain: ch == b'{' || matches!(glob[i - 1], b'@' | b'?'),
                        has_one_length: true,
                        first: found.len() as u32,
                        last: found.len() as u32,
                        first_len: 0,
                        last_start: i as u32 + 1,
                        starts_segment: starts_segment(at, &group),
                    };
                    if depth > 0 {
                        outer.push(std::mem::replace(&mut group, inner));
                    } else {
                        group = inner;
                    }
                    depth += 1;
                    count[usize::from(ch == b'{')] += 1;
                    found.push(alternative());
                }
                b'}' | b')' if count[usize::from(ch == b'}')] > 0 => {
                    // Groups of the other kind that are still open inside it stay unclosed.
                    while group.is_brace != (ch == b'}') {
                        count[usize::from(group.is_brace)] -= 1;
                        is_regular = false;
                        depth -= 1;
                        if let Some(it) = outer.pop() {
                            group = it;
                        }
                    }
                    count[usize::from(group.is_brace)] -= 1;
                    depth -= 1;
                    found[group.last as usize].end = i as u32;
                    let is_innermost = group.first as usize + 1 == found.len();
                    let it = &mut found[group.first as usize];
                    it.close = i as u32;
                    let is_optional = it.is_optional(glob);
                    if group.is_plain && (group.first != group.last || is_optional) {
                        it.choice = match glob.get(i + 1) {
                            _ if depth > 0 => Choice::No,
                            None => Choice::RestOfPath,
                            Some(b'/') => Choice::RestOfSegment,
                            Some(_)
                                if !is_optional
                                    && group.has_one_length
                                    && group.first_len > 0
                                    && group.first_len == i as u32 - group.last_start =>
                            {
                                Choice::OneLength
                            }
                            Some(_) => Choice::No,
                        };
                    }
                    has_group |= it.choice == Choice::No;
                    has_choice |= it.choice != Choice::No;
                    // A group inside it rules out a sequence. Not reading those keeps this pass linear.
                    if group.is_brace
                        && is_innermost
                        && Sequence::read(&glob[it.start as usize..i]).is_some()
                    {
                        it.next = Alternative::IS_SEQUENCE;
                    }
                    if let Some(it) = outer.pop() {
                        group = it;
                        group.is_plain = false;
                    }
                }
                b'*' if glob.get(i + 1) == Some(&b'*') => {
                    // Only a `**` that is a whole segment of the pattern.
                    is_regular &=
                        matches!(glob.get(i + 2), None | Some(b'/')) && starts_segment(i, &group);
                    is_one_segment = false;
                    i += 1;
                }
                b'\\' => {
                    i += 1;
                    escaped = i;
                    // On Windows an escaped `\` matches a separator. At the end of the pattern it escapes nothing.
                    is_regular &= glob.get(i).is_some_and(|it| *it != b'\\');
                    is_one_segment &= glob.get(i) != Some(&b'/');
                    if let Some(it) = glob.get(i) {
                        i += usize::from(strings::wtf8_byte_sequence_length(*it)) - 1;
                    }
                }
                // The matcher compares as many bytes as the first one announces, whatever they are.
                0x80.. => i += usize::from(strings::wtf8_byte_sequence_length(ch)) - 1,
                b'[' if i < no_class_from => match class_shape(glob, i) {
                    Some((end, may_be_separator)) => {
                        // The rules for dot segments overlook `[(`, so it can match where a `**` can't go on.
                        is_regular &= glob[i + 1] != b'(';
                        has_separator_class |= may_be_separator;
                        i = end - 1;
                    }
                    None => {
                        no_class_from = i;
                        is_regular = false;
                    }
                },
                _ => {}
            }
            i += 1;
        }
        self.is_fixed = is_regular && depth == 0 && !has_star && found.is_empty();
        self.is_regular = is_regular && depth == 0 && !has_separator_class;
        self.has_group = has_group || has_choice && !self.is_regular;
        self.is_one_segment = is_one_segment;
        self.has_choice = has_choice;
        self.wildcards = wildcards.min(2) as u8;
        let first = strings::index_of_any(glob, b"*?[");
        self.is_decided_at_once = !has_group
            && !has_choice
            && first.is_some_and(|it| matches!(&glob[it..], b"*" | b"**"));
        let mut group = 0;
        while let Some(it) = found.get(group)
            && it.close > 0
            && it.start as usize
                - if glob[it.start as usize - 1] == b'{' {
                    1
                } else {
                    2
                }
                == front_end
        {
            if it.choice == Choice::No || !self.is_regular {
                self.first_group = group as u32;
                break;
            }
            front_end = it.close as usize + 1;
            while let Some(&ch) = glob.get(front_end)
                && (IS_PLAIN[ch as usize] || ch == b'/')
            {
                front_end += 1;
            }
            while found
                .get(group)
                .is_some_and(|it| (it.start as usize) < front_end)
            {
                group += 1;
            }
        }
        self.front_end = front_end as u32;
        self.top = top as u32;
    }

    /// Returns the index of the path after what the front of the pattern takes.
    #[inline(always)]
    fn take_front(
        &self,
        glob: &[u8],
        glob_start: u32,
        path: &[u8],
        is_windows: bool,
    ) -> Option<u32> {
        let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
        let (mut i, mut path_index) = (glob_start, 0);
        while i < self.front_end {
            let wanted = glob[i as usize];
            if !IS_PLAIN[wanted as usize] && wanted != b'/' {
                let start = i + if wanted == b'{' { 1 } else { 2 };
                let first = self.group_at(start)?;
                (i, path_index) = take_choice(
                    &self.alternatives,
                    first,
                    glob,
                    path,
                    path_index,
                    is_windows,
                )?;
                continue;
            }
            let found = *path.get(path_index as usize)?;
            if wanted != found && !(wanted == b'/' && is_separator(found)) {
                return None;
            }
            i += 1;
            path_index += 1;
        }
        Some(path_index)
    }

    /// Returns false if the next bytes of the path rule out every alternative of the group whose first alternative is number
    /// `first`, and the group has to take one.
    fn may_start_at(&self, first: u32, glob: &[u8], path: &[u8], path_index: u32) -> bool {
        let Some(it) = self.alternatives.get(first as usize) else {
            return true;
        };
        if it.next == Alternative::IS_SEQUENCE
            || glob[it.start as usize - 1] == b'('
                && !matches!(glob[it.start as usize - 2], b'@' | b'+')
        {
            return true;
        }
        let mut next = first as usize;
        while let Some(it) = self.alternatives.get(next) {
            if it.may_start_at(glob, path, path_index) && it.may_go_on_at(glob, path, path_index) {
                return true;
            }
            next = it.next as usize;
        }
        false
    }

    /// Returns false if the group after the front has to take one alternative, and the path goes on with none of them. An alternative
    /// without wildcards has to be followed by the literal bytes after the group.
    #[cold]
    #[inline(never)]
    fn may_pass_first_group(&self, glob: &[u8], path: &[u8], path_index: u32) -> bool {
        let Some(group) = self.alternatives.get(self.first_group as usize) else {
            return true;
        };
        if group.next == Alternative::IS_SEQUENCE
            || glob[group.start as usize - 1] == b'(' && glob[group.start as usize - 2] != b'@'
        {
            return true;
        }
        let literal_at = |text: &[u8]| text.iter().take_while(|it| IS_PLAIN[**it as usize]).count();
        let after = &glob[group.close as usize + 1..];
        let after = &after[..literal_at(after)];
        let mut next = self.first_group as usize;
        while let Some(it) = self.alternatives.get(next) {
            let text = &glob[it.start as usize..it.end as usize];
            let literal = literal_at(text);
            if path[path_index as usize..]
                .strip_prefix(&text[..literal])
                .is_some_and(|rest| literal < text.len() || rest.starts_with(after))
            {
                return true;
            }
            next = it.next as usize;
        }
        false
    }

    /// Returns the index in `self` of the group whose first alternative starts at `start`.
    #[inline]
    fn group_at(&self, start: u32) -> Option<u32> {
        let at = self
            .alternatives
            .binary_search_by_key(&start, |it| it.start)
            .ok()?;
        (self.alternatives[at].close > 0).then_some(at as u32)
    }
}

/// Matches the [`Choice`] whose first alternative is number `first`. Returns the pattern index and the path index after it.
#[inline(never)]
fn take_choice(
    alternatives: &[Alternative],
    first: u32,
    glob: &[u8],
    path: &[u8],
    path_index: u32,
    is_windows: bool,
) -> Option<(u32, u32)> {
    let is_separator = |it: u8| it == b'/' || is_windows && it == b'\\';
    let group = alternatives[first as usize];
    let rest = &path[path_index as usize..];
    let taken = match group.choice {
        Choice::RestOfSegment => {
            let len = rest.iter().take_while(|it| !is_separator(**it));
            &rest[..len.count()]
        }
        Choice::RestOfPath => rest,
        _ => rest.get(..(group.end - group.start) as usize)?,
    };
    let mut next = first as usize;
    while let Some(it) = alternatives.get(next) {
        if *taken == glob[it.start as usize..it.end as usize] {
            return Some((group.close + 1, path_index + taken.len() as u32));
        }
        next = it.next as usize;
    }
    (taken.is_empty() && group.is_optional(glob)).then_some((group.close + 1, path_index))
}

/// Returns true if `c` is a path separator.
#[inline(always)]
fn is_separator(c: u8, is_windows: bool) -> bool {
    c == b'/' || is_windows && c == b'\\'
}

#[inline(always)]
fn unescape(c: &mut u8, glob: &[u8], glob_index: &mut u32) {
    // A trailing `\` is literal.
    if *c == b'\\' && *glob_index as usize + 1 < glob.len() {
        *glob_index += 1;

        *c = match glob[*glob_index as usize] {
            b'a' => b'\x61',
            b'b' => b'\x08',
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            cc => cc,
        };
    }
}

/// Byte length of the codepoint at `bytes[idx]`; see [`decode_rune_at`].
#[inline(always)]
fn rune_len_at(bytes: &[u8], idx: usize) -> u8 {
    decode_rune_at(bytes, idx).1
}

/// `(codepoint, byte_len)` at `bytes[idx]`, which need not be valid UTF-8 (a directory entry).
#[inline(always)]
fn decode_rune_at(bytes: &[u8], idx: usize) -> (u32, u8) {
    // Runs per path character: ASCII must not pay for the out-of-line decoder.
    let lead = bytes[idx];
    if lead < 0x80 {
        return (u32::from(lead), 1);
    }
    let r = strings::utf8_codepoint_with_fffd(&bytes[idx..]);
    (r.code_point, r.len)
}

/// Unescapes the character if needed
///
/// Then decodes and returns the character
///
/// `c` must point to a u32 initialized to `glob[glob_index]`
/// `clen` must point to a u8 initialized to 1
#[inline(always)]
fn get_unicode(c: &mut u32, clen: &mut u8, glob: &[u8], glob_index: &mut u32) -> bool {
    debug_assert!(*clen == 1);
    const BACKSLASH: u32 = b'\\' as u32;
    match *c {
        // ascii range excluding backslash (0x5C)
        0x00..=0x5B | 0x5D..=0x7F => {
            return true;
        }
        BACKSLASH => {
            *glob_index += 1;
            if *glob_index as usize >= glob.len() {
                return false; // Invalid pattern!
            }

            *c = match glob[*glob_index as usize] {
                b'a' => b'\x61' as u32,
                b'b' => b'\x08' as u32,
                b'n' => b'\n' as u32,
                b'r' => b'\r' as u32,
                b't' => b'\t' as u32,
                _ => 'brk: {
                    let (cp, len) = decode_rune_at(glob, *glob_index as usize);
                    *clen = len;
                    break 'brk cp;
                }
            };
        }
        // multi-byte sequences
        _ => {
            let (cp, len) = decode_rune_at(glob, *glob_index as usize);
            *clen = len;
            *c = cp;
        }
    }

    true
}

#[inline(always)]
fn skip_globstars(glob: &[u8], glob_index: &mut u32) {
    *glob_index += 2;

    while *glob_index as usize + 4 <= glob.len()
        && &glob[*glob_index as usize..*glob_index as usize + 4] == b"/**/"
    {
        *glob_index += 3;
    }

    if *glob_index as usize + 3 == glob.len()
        && &glob[*glob_index as usize..*glob_index as usize + 3] == b"/**"
    {
        *glob_index += 3;
    }

    *glob_index -= 2;
}

/// Sets of nodes of a [`Program`], for 64 nodes each. "Goes on" means: the rest of the pattern, from that node, has to match the
/// rest of the path. A node that takes something goes on with the next node.
#[derive(Copy, Clone, Default)]
struct Masks {
    /// Takes the byte of the pattern that it stands for.
    bytes: u64,
    /// `\`: takes the byte that the next byte of the pattern stands for.
    escapes: u64,
    /// Takes a separator.
    separators: u64,
    /// Takes one byte of a number or letter of a sequence like `{1..3}`.
    digits: u64,
    /// `?`: takes a character that isn't a separator.
    anys: u64,
    /// `[`: takes a character of the class.
    classes: u64,
    /// `*`, and the `(` of `!(a)`, which stands for the `*` that is part of its meaning: takes a character that isn't a separator
    /// and goes on with itself.
    loops: u64,
    /// The second `*` of a globstar: takes a byte. Goes on with itself, or after a separator with the globstar.
    skips: u64,
    /// The skip of a globstar that ends the pattern. It also takes a last segment without a separator.
    trailing_skips: u64,
    /// The globstar of a pattern that ends with `**/*`. It doesn't match at the end of the path.
    not_at_end: u64,
    /// Nodes that can't match in a closed segment. See `is_closed_segment_at`.
    wildcards: u64,
    /// Nodes that other nodes follow from, or that have a condition. See `Program::implied`.
    unsettled: u64,
    /// The `!` of `!(a)`: matches if the `(` does and none of the alternatives do.
    nots: u64,
    /// The `{` of `{1..3}`.
    sequences: u64,
    /// Where the alternatives of `*(a)` and `+(a)` start.
    repeats: u64,
    /// Nodes with a list in `Program::lists`.
    listed: u64,
    /// How many there are of each of the last four before these 64 nodes.
    nots_before: u32,
    sequences_before: u32,
    repeats_before: u32,
    listed_before: u32,
}

/// Some nodes among the 64 nodes number `word`.
#[derive(Copy, Clone)]
struct Nodes {
    /// With `IS_LAST` if a list ends here.
    word: u32,
    mask: u64,
}

impl Nodes {
    const IS_LAST: u32 = 1 << 31;

    #[inline(always)]
    fn word(self) -> usize {
        (self.word & !Nodes::IS_LAST) as usize
    }
}

/// A pattern, prepared for a [`Walk`].
///
/// There's a node for each byte of the pattern from `start` on, then one for the end of the pattern, then one for each `!(a)`
/// group ("one of its alternatives matches"). A token of several bytes uses the nodes it needs. What a node does is in [`Masks`].
///
/// A walk goes over the path from its end to its start. At each index it computes the set of nodes from which the rest of the
/// pattern matches the rest of the path. A node that takes a byte or a character looks at the set of a later index.
/// Any other node looks at nodes of the same index that come later in the pattern, so one pass from the last node to the first
/// settles them. That includes `!(a)`: whether its alternatives, followed by the rest of the pattern, match the rest of the
/// path is a bit of the same set.
///
/// The one step back in the pattern is from the end of an alternative of `*(a)` or `+(a)` to its start. It goes to a second
/// set, "idle", for which no group repeats until a byte is taken. That set is settled first.
///
/// So the time is `O(glob.len() * path.len())`, the memory is six sets, and nothing recurses.
struct Program {
    masks: SmallVec<[Masks; 1]>,
    /// For each node, the nodes among the same 64 that match wherever it does.
    implied: SmallVec<[u64; 64]>,
    /// The same for nodes among other 64s: for each listed node, where its list starts in `far`.
    lists: SmallVec<[u32; 2]>,
    far: SmallVec<[Nodes; 2]>,
    /// For each group that repeats, where the list of the ends of its alternatives starts in `ends`.
    repeats: SmallVec<[u32; 2]>,
    ends: SmallVec<[Nodes; 2]>,
    sequences: Vec<Sequence>,
    /// Index of the pattern that the first node stands for. See [`Parsed::front_end`].
    start: u32,
    /// How many walks it has been through without a cache.
    walks: AtomicU8,
    /// A small cache, and a large one for when that is full.
    caches: [Once<Option<Box<Cache>>>; 2],
}

/// A group that [`Program::read`] hasn't seen the end of.
struct Unfinished {
    /// `{`, or the character before the `(`.
    kind: u8,
    /// A path segment of the pattern starts with the group. It doesn't in `a{b,c}`.
    starts_segment: bool,
    has_empty_alternative: bool,
    /// Its first node.
    node: u32,
    /// The node that matches if an alternative does.
    any: u32,
    /// Its index in `Program::repeats`.
    repeat: u32,
    /// The ends of its alternatives: the latest ones, and where the ones before those start in the list of them.
    ends: Nodes,
    earlier_ends: u32,
    /// Index in [`Parsed`] of the alternative being read.
    alternative: u32,
    /// Index of the closing `}` or `)`.
    close: u32,
    /// Index after it and after every group that ends right there as well.
    outside: u32,
}

/// What [`Program::read`] has in its hands.
struct Reader<'p> {
    program: &'p mut Program,
    /// For the 64 nodes being read. `bytes` has the nodes that are NOT bytes until they are stored.
    masks: Masks,
    /// Which 64 nodes those are.
    word: usize,
    /// The nodes that match wherever the next node does. More of them are in `far` from `listed` on.
    next_implies: Nodes,
    listed: usize,
}

impl Reader<'_> {
    /// Returns the bit of `node` in `self.masks`. Every `imply` since the last call was about it.
    /// Nodes have to come in ascending order.
    #[inline(always)]
    fn at(&mut self, node: usize) -> u64 {
        if node / 64 != self.word {
            self.store(node / 64, false);
        }
        let bit = 1 << (node % 64);
        if self.next_implies.mask != 0 {
            self.masks.unsettled |= bit;
            if self.next_implies.word as usize == self.word && self.listed == self.program.far.len()
            {
                self.program.implied[node] = self.next_implies.mask;
            } else {
                self.list(bit);
            }
            self.next_implies.mask = 0;
        }
        bit
    }

    /// [`Reader::at`] for a node that isn't a byte.
    #[inline(never)]
    fn not_byte_at(&mut self, node: usize) -> u64 {
        let bit = self.at(node);
        self.masks.bytes |= bit;
        bit
    }

    /// Some of what follows from the node of `bit` isn't among the same 64 nodes.
    #[cold]
    #[inline(never)]
    fn list(&mut self, bit: u64) {
        self.masks.listed |= bit;
        self.program.far.push(Nodes {
            word: self.next_implies.word | Nodes::IS_LAST,
            mask: self.next_implies.mask,
        });
        self.program.lists.push(self.listed as u32);
        self.listed = self.program.far.len();
    }

    /// Stores what has been read, and goes on to the 64 nodes number `word`.
    #[cold]
    #[inline(never)]
    fn store(&mut self, word: usize, is_last: bool) {
        while self.word < word {
            let it = self.masks;
            self.program.masks.push(Masks {
                bytes: !it.bytes,
                ..it
            });
            if is_last && self.word + 1 == word {
                return;
            }
            self.program.implied.extend_from_slice(&[0; 64]);
            self.masks = Masks {
                nots_before: it.nots_before + it.nots.count_ones(),
                sequences_before: it.sequences_before + it.sequences.count_ones(),
                repeats_before: it.repeats_before + it.repeats.count_ones(),
                listed_before: it.listed_before + it.listed.count_ones(),
                ..Masks::default()
            };
            self.word += 1;
        }
    }

    /// `nodes` match wherever the next node that `at` is asked for does.
    #[inline(always)]
    fn imply(&mut self, nodes: Nodes) {
        if self.next_implies.mask == 0 {
            self.next_implies = nodes;
        } else if self.next_implies.word == nodes.word {
            self.next_implies.mask |= nodes.mask;
        } else {
            self.program.far.push(nodes);
        }
    }

    #[inline(never)]
    fn imply_node(&mut self, node: u32) {
        self.imply(Nodes {
            word: node / 64,
            mask: 1 << (node % 64),
        });
    }

    /// The nodes in `from..to` take nothing.
    #[inline(never)]
    fn leave_out(&mut self, from: usize, to: usize) {
        if to - from == 1 && from / 64 == self.word {
            self.masks.bytes |= 1 << (from % 64);
        } else {
            self.leave_out_many(from, to);
        }
    }

    #[cold]
    #[inline(never)]
    fn leave_out_many(&mut self, mut from: usize, to: usize) {
        while from < to {
            self.store(from / 64, false);
            let end = to.min((from / 64 + 1) * 64);
            self.masks.bytes |= (!0 >> (64 - (end - from))) << (from % 64);
            from = end;
        }
    }

    /// Reads a sequence like `{1..3}`. `bit` is for its `{`, and `after` is the node after its `}`.
    #[cold]
    #[inline(never)]
    fn sequence(&mut self, bit: u64, written: &[u8], after: usize) {
        self.masks.bytes |= bit;
        let first = after - written.len() - 2;
        let Some(sequence) = Sequence::read(written) else {
            return self.leave_out_many(first, after);
        };
        self.masks.sequences |= bit;
        self.masks.unsettled |= bit;
        // Its digits are the last nodes, so that the last digit goes on after the sequence.
        let digits = after - sequence.longest() as usize;
        self.program.sequences.push(sequence);
        self.leave_out_many(first + 1, digits);
        for digit in digits..after {
            self.imply_node(first as u32);
            let bit = self.at(digit);
            self.masks.bytes |= bit;
            self.masks.digits |= bit;
        }
        self.imply_node(first as u32);
    }
}

impl Program {
    #[inline(always)]
    fn new() -> Program {
        Program {
            masks: SmallVec::new(),
            implied: SmallVec::new(),
            lists: SmallVec::new(),
            far: SmallVec::new(),
            repeats: SmallVec::new(),
            ends: SmallVec::new(),
            sequences: Vec::new(),
            start: 0,
            walks: AtomicU8::new(0),
            caches: [Once::new(), Once::new()],
        }
    }

    /// Fills a new program.
    #[inline(never)]
    fn read(&mut self, glob: &[u8], parsed: &Parsed, start: usize) {
        let alternatives = &*parsed.alternatives;
        // Where the loop would have started its current run: after the leading `!`s, at the start of an alternative, or at
        // the end of a group.
        let mut part_start = match start.checked_sub(1).map(|it| glob[it]) {
            Some(b'}' | b')') if parsed.is_regular => start - 1,
            _ => negations(glob),
        };
        self.start = start as u32;
        let mut i = start;
        self.implied.extend_from_slice(&[0; 64]);
        let mut to = Reader {
            program: self,
            masks: Masks::default(),
            word: 0,
            next_implies: Nodes { word: 0, mask: 0 },
            listed: 0,
        };
        let mut open: SmallVec<[Unfinished; 4]> = SmallVec::new();
        // Where the alternative being read ends.
        let mut alternative_end = usize::MAX;
        // Ends of alternatives of the open groups that aren't among the same 64 nodes as the latest ones.
        let mut earlier_ends: SmallVec<[Nodes; 2]> = SmallVec::new();
        // `{**,a}/` globstars whose `/` hasn't been reached: the index of the `/`, and the node.
        let mut waiting: SmallVec<[(u32, u32); 2]> = SmallVec::new();
        let mut no_class_from = usize::MAX;
        // Every group before this index in `alternatives` starts before `i`.
        let mut next_group = 0;
        // The node after the one for the end of the pattern, and after those for the `!(a)` groups so far.
        let mut next_extra = (glob.len() - start + 1) as u32;

        // Says what the node for index `$at` of the pattern is, other than a byte.
        macro_rules! node {
            ($at:expr $(, $mask:ident)*) => {{
                let node = $at - start;
                let _bit = to.not_byte_at(node);
                $(to.masks.$mask |= _bit;)*
                node as u32
            }};
        }

        loop {
            if i == alternative_end
                && let Some(group) = open.last_mut()
            {
                let it = alternatives[group.alternative as usize];
                // One empty alternative is enough.
                let is_empty = it.start == it.end;
                if is_empty && std::mem::replace(&mut group.has_empty_alternative, true) {
                    to.leave_out(i - start, i - start + 1);
                } else {
                    let end = node!(i);
                    if group.ends.word != end / 64 {
                        if group.ends.mask != 0 {
                            earlier_ends.push(group.ends);
                        }
                        group.ends = Nodes {
                            word: end / 64,
                            mask: 0,
                        };
                    }
                    group.ends.mask |= 1 << (end % 64);
                }
                if i as u32 != group.close {
                    to.imply_node(group.any);
                    group.alternative = it.next;
                    alternative_end = alternatives[it.next as usize].end as usize;
                    i += 1;
                    part_start = i;
                    continue;
                }
                let earlier = &earlier_ends[group.earlier_ends as usize..];
                if matches!(group.kind, b'*' | b'+') {
                    to.program.repeats[group.repeat as usize] = to.program.ends.len() as u32;
                    to.program.ends.extend_from_slice(earlier);
                    to.program.ends.push(Nodes {
                        word: group.ends.word | Nodes::IS_LAST,
                        mask: group.ends.mask,
                    });
                }
                to.imply(group.ends);
                earlier.iter().for_each(|it| to.imply(*it));
                earlier_ends.truncate(group.earlier_ends as usize);
                match group.kind {
                    b'?' | b'*' => to.imply_node(group.node),
                    b'!' => to.imply_node(group.node + 1),
                    _ => {}
                }
                open.pop();
                alternative_end = open.last().map_or(usize::MAX, |it| {
                    alternatives[it.alternative as usize].end as usize
                });
                part_start = i;
                i += 1;
                continue;
            }
            let Some(&ch) = glob.get(i) else { break };
            if IS_PLAIN[ch as usize] {
                to.at(i - start);
                let end = alternative_end.min(glob.len());
                i += 1;
                while i < end && IS_PLAIN[glob[i] as usize] {
                    i += 1;
                }
                continue;
            }
            // The start of an alternative only counts if the group itself starts a segment.
            let starts_segment_at = |index: usize| match open.last() {
                Some(group) if index == part_start => group.starts_segment,
                _ => index <= part_start || glob[index - 1] == b'/',
            };
            let next = glob.get(i + 1).copied();
            if ch == b'{' || next == Some(b'(') && matches!(ch, b'*' | b'?' | b'+' | b'@' | b'!') {
                let first = i + if ch == b'{' { 1 } else { 2 };
                while alternatives
                    .get(next_group)
                    .is_some_and(|it| (it.start as usize) < first)
                {
                    next_group += 1;
                }
                if let Some(&it) = alternatives.get(next_group)
                    && it.start as usize == first
                    && it.close > 0
                {
                    if it.next == Alternative::IS_SEQUENCE {
                        let bit = to.at(i - start);
                        part_start = it.close as usize;
                        i = part_start + 1;
                        to.sequence(bit, &glob[first..part_start], i - start);
                        continue;
                    }
                    let starts_segment = starts_segment_at(i);
                    let node = node!(i);
                    let mut any = node;
                    match ch {
                        b'{' => {}
                        b'*' => {
                            to.imply_node(node);
                            any = node!(i + 1, repeats);
                        }
                        b'!' => {
                            let bit = 1 << (node % 64);
                            to.masks.unsettled |= bit;
                            to.masks.nots |= bit;
                            to.masks.wildcards |= bit;
                            to.imply_node(node);
                            node!(i + 1, loops);
                            any = next_extra;
                            next_extra += 1;
                        }
                        _ => {
                            if ch == b'+' {
                                to.masks.repeats |= 1 << (node % 64);
                            }
                            to.leave_out(i + 1 - start, i + 2 - start);
                        }
                    }
                    if matches!(ch, b'*' | b'+') {
                        to.program.repeats.push(0);
                    }
                    to.imply_node(any);
                    let outside = match open.last() {
                        Some(outer) if alternative_end as u32 == it.close + 1 => outer.outside,
                        _ => it.close + 1,
                    };
                    open.push(Unfinished {
                        kind: ch,
                        starts_segment,
                        has_empty_alternative: false,
                        node,
                        any,
                        repeat: (to.program.repeats.len() as u32).wrapping_sub(1),
                        ends: Nodes { word: 0, mask: 0 },
                        earlier_ends: earlier_ends.len() as u32,
                        alternative: next_group as u32,
                        close: it.close,
                        outside,
                    });
                    alternative_end = it.end as usize;
                    i = first;
                    part_start = first;
                    continue;
                }
            }
            match ch {
                // `**(a)` is `*` followed by `*(a)`.
                b'*' if next == Some(b'*') && glob.get(i + 2) != Some(&b'(') => {
                    let mut at = i as u32;
                    skip_globstars(glob, &mut at);
                    let at = at as usize;
                    let after = at + 2;
                    let starts_segment = !open.is_empty() && starts_segment_at(at);
                    let outside = match open.last() {
                        Some(group) if alternative_end == after => group.outside as usize,
                        _ => after,
                    };
                    // `**/**` is the last `**`.
                    if at > i {
                        let first = node!(i);
                        to.leave_out(i + 1 - start, at - start);
                        to.imply_node(first);
                    }
                    i = after;
                    // `{**,a}/b`: the `/` that makes this a globstar comes after the group.
                    if starts_segment && outside > after && glob.get(outside) == Some(&b'/') {
                        let node = node!(at);
                        waiting.push((outside as u32, node));
                        to.imply_node(node);
                        node!(at + 1, skips, wildcards);
                        continue;
                    }
                    // `{a,b/**}`: the pattern ends right after the group.
                    let is_last = after == glob.len() || starts_segment && outside == glob.len();
                    if (after.saturating_sub(part_start) < 3 || glob[after - 3] == b'/')
                        && (is_last || glob[after] == b'/')
                    {
                        let node = match !is_last && &glob[after..] == b"/*" {
                            true => node!(at, not_at_end),
                            false => node!(at),
                        };
                        to.imply_node(node);
                        match is_last {
                            true => node!(at + 1, skips, wildcards, trailing_skips),
                            false => {
                                i += 1;
                                node!(at + 1, skips, wildcards);
                                node!(at + 2)
                            }
                        };
                        to.imply_node(node);
                    } else {
                        let node = node!(at, loops, wildcards);
                        to.leave_out(at + 1 - start, at + 2 - start);
                        to.imply_node(node);
                    }
                }
                b'*' => {
                    let node = node!(i, loops, wildcards);
                    to.imply_node(node);
                    i += 1;
                }
                // The rules for dot segments overlook `?(` and `[(`.
                b'?' => {
                    match next == Some(b'(') {
                        true => node!(i, anys),
                        false => node!(i, anys, wildcards),
                    };
                    i += 1;
                }
                b'[' if i < no_class_from
                    && let Some((end, _)) = class_shape(glob, i) =>
                {
                    match next == Some(b'(') {
                        true => node!(i, classes),
                        false => node!(i, classes, wildcards),
                    };
                    // The node after it matches wherever the node after the class does.
                    to.leave_out(i + 1 - start, end - start);
                    to.imply_node((i + 1 - start) as u32);
                    i = end;
                }
                b'/' => {
                    node!(i, separators);
                    while let Some(it) = waiting.last().filter(|it| it.0 as usize == i) {
                        to.imply_node(it.1);
                        waiting.pop();
                    }
                    i += 1;
                }
                b'\\' if i + 1 < glob.len() => {
                    let len = usize::from(strings::wtf8_byte_sequence_length(glob[i + 1]));
                    if i + 1 + len > glob.len() {
                        to.at(i - start);
                        to.leave_out(i - start, glob.len() - start);
                    } else {
                        match glob[i + 1] == b'/' {
                            true => node!(i, separators),
                            false => node!(i, escapes),
                        };
                        // The node after it matches wherever the node after the escaped byte does.
                        to.leave_out(i + 1 - start, i + 2 - start);
                        to.imply_node((i + 1 - start) as u32);
                        if len > 1 {
                            to.at(i + 2 - start);
                        }
                    }
                    i += 1 + len;
                }
                _ => {
                    if ch == b'[' {
                        no_class_from = no_class_from.min(i);
                    }
                    // The matcher compares as many bytes as the first one announces, whatever they are.
                    to.at(i - start);
                    let end = i + usize::from(strings::wtf8_byte_sequence_length(ch));
                    if end > glob.len() {
                        to.leave_out(i - start, glob.len() - start);
                    }
                    i = end;
                }
            }
        }
        debug_assert!(open.is_empty() && waiting.is_empty());
        let end = glob.len() - start;
        to.at(end);
        let nodes = next_extra as usize;
        to.leave_out_many(end, nodes.next_multiple_of(64));
        to.store(nodes.div_ceil(64), true);
    }

    /// `dots` is `Dots::Match` unless the path has a closed segment.
    #[inline(always)]
    fn on<'a>(
        &'a self,
        glob: &'a [u8],
        path: &'a [u8],
        first: usize,
        is_windows: bool,
        dots: Dots,
    ) -> On<'a> {
        On {
            program: self,
            masks: &self.masks,
            implied: &self.implied,
            pattern: &glob[self.start as usize..],
            path,
            first,
            is_windows,
            dots,
        }
    }

    /// Filling a cache costs about as much as this many walks over ordinary paths.
    const CACHES_AFTER: u8 = 16;
    /// A path of this length makes up for it by itself.
    const IS_LONG: usize = 512;

    /// Returns the cache in use, if there's one.
    #[inline(always)]
    fn warm_cache(&self, is_windows: bool) -> Option<&Cache> {
        let cache = match (self.caches[0].get(), self.caches[1].get()) {
            (_, Some(large)) => large.as_deref(),
            (Some(small), None) => small
                .as_deref()
                .filter(|it| !it.is_full.load(Ordering::Relaxed)),
            (None, None) => None,
        };
        cache.filter(|it| it.is_windows == is_windows)
    }

    /// A pattern gets a cache when it has been matched often enough to make up for the cost, or on a long path.
    #[inline(always)]
    fn cache(&self, glob: &[u8], is_windows: bool, path_len: usize) -> Option<&Cache> {
        let cache = match (self.caches[0].get(), self.caches[1].get()) {
            (_, Some(large)) => large,
            (Some(Some(small)), None) if !small.is_full.load(Ordering::Relaxed) => {
                return Some(&**small).filter(|it| it.is_windows == is_windows);
            }
            (small, None) => self.add_cache(glob, is_windows, path_len, small.is_some())?,
        };
        cache.as_deref().filter(|it| it.is_windows == is_windows)
    }

    #[cold]
    #[inline(never)]
    fn add_cache(
        &self,
        glob: &[u8],
        is_windows: bool,
        path_len: usize,
        is_large: bool,
    ) -> Option<&Option<Box<Cache>>> {
        let walks = self.walks.load(Ordering::Relaxed);
        if walks < Program::CACHES_AFTER && path_len < Program::IS_LONG {
            self.walks.store(walks + 1, Ordering::Relaxed);
            return None;
        }
        // Few patterns get to more than 40 states on the paths of a real tree. A small cache is about 4 KB, a large one 35.
        let states = if is_large { 320 } else { 40 };
        Some(
            self.caches[usize::from(is_large)]
                .get_or_init(|| Cache::of(self, glob, is_windows, states)),
        )
    }
}

/// What rules nodes out at an index of the path. See [`Masks::wildcards`] and [`Masks::not_at_end`].
#[derive(Copy, Clone)]
struct Place {
    is_closed: bool,
    is_at_end: bool,
}

/// What a [`Program`] is matched on.
struct On<'a> {
    program: &'a Program,
    masks: &'a [Masks],
    implied: &'a [u64],
    /// The pattern from the byte that the first node stands for.
    pattern: &'a [u8],
    path: &'a [u8],
    /// The index of the path where the first node has to match.
    first: usize,
    is_windows: bool,
    /// `Dots::Match` unless the path has a closed segment.
    dots: Dots,
}

impl On<'_> {
    #[inline(always)]
    fn is_closed_at(&self, index: usize) -> bool {
        self.dots != Dots::Match
            && is_closed_segment_at(self.path, index as u32, self.dots, self.is_windows)
    }

    /// Matches without a [`Cache`].
    #[inline(always)]
    fn walk(&self) -> bool {
        self.go(None, None).is_err_and(|it| it)
    }

    /// See [`Walk::go`].
    #[inline(always)]
    fn go(
        &self,
        from: Option<(usize, &[u64])>,
        cache: Option<&Cache>,
    ) -> Result<(u32, usize), bool> {
        match self.masks.len() {
            1 => Walk::<[u64; 1]>::go(self, from, cache),
            _ => Walk::<SmallVec<[u64; 4]>>::go(self, from, cache),
        }
    }

    /// Returns true if `node`, an escape, a class or a digit, takes `byte` or `character`.
    #[cold]
    #[inline(never)]
    fn takes(&self, node: usize, byte: u8, character: u32) -> bool {
        match self.pattern[node] {
            b'\\' => {
                let (mut wanted, mut at) = (b'\\', node as u32);
                unescape(&mut wanted, self.pattern, &mut at);
                wanted == byte
            }
            b'[' => class_has(self.pattern, node as u32, character) == Some(true),
            // Only to rule out most bytes. `Sequence::has` decides.
            _ => matches!(byte, b'0'..=b'9' | b'-' | b'A'..=b'z'),
        }
    }

    /// Decides the sequence number `number` at `node`, which a later node has put into `set`.
    #[cold]
    #[inline(never)]
    fn has_sequence(&self, index: usize, set: &[u64], node: usize, number: u32) -> bool {
        let has = |node: usize| set[node / 64] & 1 << (node % 64) != 0;
        let sequence = &self.program.sequences[number as usize];
        let close = strings::index_of_char_pos(self.pattern, b'}', node).unwrap_or(node);
        let rest = &self.path[index..];
        sequence.has_nothing() && has(close + 1)
            || (1..=rest.len().min(sequence.longest() as usize))
                .any(|len| has(close + 1 - len) && sequence.has(&rest[..len]))
    }

    /// Adds the nodes of the list that `list` starts with to `set`, except those that `place` rules out.
    #[cold]
    #[inline(never)]
    fn add(&self, list: &[Nodes], place: Place, set: &mut [u64]) {
        for it in list {
            let masks = &self.masks[it.word()];
            let mut mask = it.mask;
            if place.is_closed {
                mask &= !masks.wildcards;
            }
            if place.is_at_end {
                mask &= !masks.not_at_end;
            }
            set[it.word()] |= mask;
            if it.word & Nodes::IS_LAST != 0 {
                break;
            }
        }
    }
}

/// A set of nodes. For most patterns its size is known at compile time.
trait Set {
    fn empty(words: usize) -> Self;
    fn words(&self) -> &[u64];
    fn words_mut(&mut self) -> &mut [u64];
    /// The masks for as many words as a set has.
    fn masks<'a>(on: &On<'a>) -> &'a [Masks];
    /// Takes the steps before `index` that are simple enough for it. See [`take_simple_steps`].
    #[inline(always)]
    fn take_simple_steps(&mut self, _on: &On<'_>, _index: &mut usize) -> bool {
        true
    }
}

/// The steps of a [`Walk`] that most paths consist of, for a pattern of up to 64 nodes: an ASCII byte, and only literals, `?`, `*`,
/// `**/` and plain groups at work. It stops before any other step. Returns false if it arrives at an empty set.
#[inline(always)]
fn take_simple_steps(on: &On<'_>, set: &mut u64, index: &mut usize) -> bool {
    let (masks, Ok(implied)) = (&on.masks[0], <&[u64; 64]>::try_from(on.implied)) else {
        return true;
    };
    let mut pattern = [0; 64];
    let len = on.pattern.len().min(64);
    pattern[..len].copy_from_slice(&on.pattern[..len]);
    let not_simple = masks.escapes | masks.digits | masks.classes;
    let not_simply_settled = masks.nots | masks.sequences | masks.listed;
    'steps: while *index > on.first {
        let byte = on.path[*index - 1];
        let before = *set >> 1;
        if byte >= 128 || before & not_simple != 0 {
            break;
        }
        let mut now = match byte == b'/' || on.is_windows && byte == b'\\' {
            true => before & masks.separators | (*set << 1) & masks.skips,
            false => before & masks.anys | *set & (masks.skips | masks.loops),
        };
        let mut bytes = before & masks.bytes;
        while bytes != 0 {
            let node = bytes.trailing_zeros();
            if pattern[node as usize % 64] == byte {
                now |= 1 << node;
            }
            bytes &= bytes - 1;
        }
        let mut todo = now & masks.unsettled;
        while todo != 0 {
            let node = 63 - todo.leading_zeros();
            if not_simply_settled & 1 << node != 0 {
                break 'steps;
            }
            todo ^= 1 << node;
            now |= implied[node as usize % 64];
            todo |= implied[node as usize % 64] & masks.unsettled;
        }
        *set = now;
        *index -= 1;
        if now == 0 {
            return false;
        }
    }
    true
}

impl Set for [u64; 1] {
    #[inline(always)]
    fn empty(_: usize) -> Self {
        [0]
    }
    #[inline(always)]
    fn words(&self) -> &[u64] {
        self
    }
    #[inline(always)]
    fn words_mut(&mut self) -> &mut [u64] {
        self
    }
    #[inline(always)]
    fn masks<'a>(on: &On<'a>) -> &'a [Masks] {
        &on.masks[..1]
    }
    #[inline(always)]
    fn take_simple_steps(&mut self, on: &On<'_>, index: &mut usize) -> bool {
        take_simple_steps(on, &mut self[0], index)
    }
}

impl Set for SmallVec<[u64; 4]> {
    fn empty(words: usize) -> Self {
        SmallVec::from_elem(0, words)
    }
    #[inline(always)]
    fn words(&self) -> &[u64] {
        self
    }
    #[inline(always)]
    fn words_mut(&mut self) -> &mut [u64] {
        self
    }
    #[inline(always)]
    fn masks<'a>(on: &On<'a>) -> &'a [Masks] {
        on.masks
    }
}

/// A walk over the path, from its end to its start.
struct Walk<S: Set> {
    /// `sets[0]` is for `index`. While the bytes from `index` on aren't ASCII, `sets[n]` is for `index + n`: a character has up to
    /// four bytes.
    sets: [S; 5],
    /// See [`Program`].
    idle: S,
    /// One more than the length of the path before the first step.
    index: usize,
}

impl<S: Set> Walk<S> {
    /// Turns `set`, which is for the index after an ASCII `byte`, into the nodes that take the byte.
    #[inline(always)]
    fn take_byte(on: &On<'_>, byte: u8, is_closed: bool, set: &mut [u64]) {
        let is_separator = byte == b'/' || on.is_windows && byte == b'\\';
        let mut below = 0;
        for (word, masks) in S::masks(on).iter().enumerate() {
            let after = set[word];
            let before = after >> 1 | set.get(word + 1).map_or(0, |it| it << 63);
            // In a long pattern, few nodes are at work at a time.
            if before | after | below == 0 {
                continue;
            }
            let mut found = match is_separator {
                true => before & masks.separators | (after << 1 | below) & masks.skips,
                false => before & masks.anys | after & (masks.skips | masks.loops),
            };
            below = after >> 63;
            let mut bytes = before & masks.bytes;
            while bytes != 0 {
                let node = bytes.trailing_zeros() as usize;
                if on.pattern[word * 64 + node] == byte {
                    found |= 1 << node;
                }
                bytes &= bytes - 1;
            }
            let mut others = before & (masks.escapes | masks.digits | masks.classes);
            while others != 0 {
                let node = others.trailing_zeros() as usize;
                if on.takes(word * 64 + node, byte, u32::from(byte)) {
                    found |= 1 << node;
                }
                others &= others - 1;
            }
            if is_closed {
                found &= !masks.wildcards;
            }
            set[word] = found;
        }
    }

    /// Makes `sets[0]` the nodes that take the byte at `index`, which isn't ASCII, or the character there.
    #[cold]
    #[inline(never)]
    fn take_character(&mut self, on: &On<'_>, is_closed: bool) {
        self.sets.rotate_right(1);
        let byte = on.path[self.index];
        let (character, len) = decode_rune_at(on.path, self.index);
        let [now, later @ ..] = &mut self.sets;
        let (after_byte, after_character) = (later[0].words(), later[len as usize - 1].words());
        for (word, masks) in S::masks(on).iter().enumerate() {
            let before = |set: &[u64]| set[word] >> 1 | set.get(word + 1).map_or(0, |it| it << 63);
            let mut found = before(after_character) & masks.anys
                | after_byte[word] & masks.skips
                | after_character[word] & masks.loops;
            let mut others = before(after_byte) & (masks.bytes | masks.escapes)
                | before(after_character) & masks.classes;
            while others != 0 {
                let node = others.trailing_zeros() as usize;
                if match masks.bytes & 1 << node != 0 {
                    true => on.pattern[word * 64 + node] == byte,
                    false => on.takes(word * 64 + node, byte, character),
                } {
                    found |= 1 << node;
                }
                others &= others - 1;
            }
            if is_closed {
                found &= !masks.wildcards;
            }
            now.words_mut()[word] = found;
        }
    }

    /// Adds to `set` the nodes that match at `index` because another node of `set` does.
    #[inline(always)]
    fn settle(on: &On<'_>, index: usize, is_closed: bool, set: &mut [u64]) {
        let is_at_end = index == on.path.len();
        for (word, masks) in S::masks(on).iter().enumerate().rev() {
            if set[word] == 0 {
                continue;
            }
            let mut allowed = !0;
            if is_closed {
                allowed = !masks.wildcards;
            }
            if is_at_end {
                allowed &= !masks.not_at_end;
            }
            let mut now = set[word];
            let mut todo = now & masks.unsettled;
            while todo != 0 {
                let at = 63 - todo.leading_zeros() as usize;
                let bit = 1 << at;
                todo ^= bit;
                if (masks.nots | masks.sequences | masks.listed) & bit != 0 {
                    set[word] = now;
                    let before = |mask: u64| (mask & (bit - 1)).count_ones();
                    if masks.nots & bit != 0 {
                        let any = on.pattern.len()
                            + 1
                            + (masks.nots_before + before(masks.nots)) as usize;
                        if set[any / 64] & 1 << (any % 64) != 0 {
                            now ^= bit;
                            continue;
                        }
                    } else if masks.sequences & bit != 0 {
                        let number = masks.sequences_before + before(masks.sequences);
                        if !on.has_sequence(index, set, word * 64 + at, number) {
                            now ^= bit;
                            continue;
                        }
                    }
                    if masks.listed & bit != 0 {
                        let list = (masks.listed_before + before(masks.listed)) as usize;
                        let list = &on.program.far[on.program.lists[list] as usize..];
                        let place = Place {
                            is_closed,
                            is_at_end,
                        };
                        on.add(list, place, set);
                        now = set[word];
                        todo |= now & masks.unsettled & (bit - 1);
                    }
                }
                let implied = on.implied[word * 64 + at] & allowed;
                now |= implied;
                todo |= implied & masks.unsettled;
            }
            set[word] = now;
        }
    }

    /// Settles the idle set, and adds what follows from it to the set for `index`.
    #[inline(never)]
    fn settle_idle(&mut self, on: &On<'_>, is_closed: bool) {
        self.idle.words_mut().copy_from_slice(self.sets[0].words());
        Self::settle(on, self.index, is_closed, self.idle.words_mut());
        for (word, masks) in S::masks(on).iter().enumerate() {
            let mut repeated = self.idle.words()[word] & masks.repeats;
            while repeated != 0 {
                let bit = repeated.isolate_lowest_one();
                repeated ^= bit;
                let number = masks.repeats_before + (masks.repeats & (bit - 1)).count_ones();
                let list = &on.program.ends[on.program.repeats[number as usize] as usize..];
                let anywhere = Place {
                    is_closed: false,
                    is_at_end: false,
                };
                on.add(list, anywhere, self.sets[0].words_mut());
            }
        }
    }

    /// Walks from the end of the path or, with `from`, from the index for which that is the set.
    ///
    /// Walks to the start of the path and returns the answer as an error. With a cache, takes at least one step, and stops when
    /// the next step may be in the cache. Then it returns the state and the index.
    ///
    /// How a step settles its set: a value is (node, idle or not, index). In the idle set, every value depends only on later
    /// nodes of the idle set, since it has no steps back. In the other set, every value depends on later nodes of that set or
    /// on the idle set. So "the idle set from the last node to the first, then the other one from the last node to the
    /// first" visits every value after the ones it depends on, and a `!(` only reads values that are final.
    #[inline(never)]
    fn go(
        on: &On<'_>,
        from: Option<(usize, &[u64])>,
        mut cache: Option<&Cache>,
    ) -> Result<(u32, usize), bool> {
        let mut walk = Walk::<S> {
            sets: std::array::from_fn(|_| S::empty(on.masks.len())),
            idle: S::empty(on.masks.len()),
            index: on.path.len() + 1,
        };
        if let Some((index, set)) = from {
            walk.sets[0].words_mut().copy_from_slice(set);
            walk.index = index;
        }
        let has_repeats = !on.program.repeats.is_empty();
        let is_simple = !has_repeats && cache.is_none() && on.dots == Dots::Match;
        while walk.index > on.first {
            if is_simple && walk.index <= on.path.len() {
                if !walk.sets[0].take_simple_steps(on, &mut walk.index) {
                    return Err(false);
                }
                if walk.index == on.first {
                    break;
                }
            }
            walk.index -= 1;
            let is_closed = on.is_closed_at(walk.index);
            let byte = on.path.get(walk.index).copied();
            match byte {
                Some(byte @ ..128) => {
                    Self::take_byte(on, byte, is_closed, walk.sets[0].words_mut());
                }
                Some(_) => walk.take_character(on, is_closed),
                None => {
                    let end = on.pattern.len();
                    walk.sets[0].words_mut()[end / 64] |= 1 << (end % 64);
                }
            }
            if has_repeats {
                walk.settle_idle(on, is_closed);
            }
            Self::settle(on, walk.index, is_closed, walk.sets[0].words_mut());
            if byte.is_none() {
                let mut carry = 0;
                for (set, masks) in walk.sets[0].words_mut().iter_mut().zip(S::masks(on)) {
                    let globstars = *set << 1 | carry;
                    carry = *set >> 63;
                    *set |= globstars & masks.trailing_skips;
                }
            }
            // No character goes on over a byte that starts one. Inside one, a character that starts further ahead may still go on
            // with an earlier set.
            let starts_character = !matches!(byte, Some(0x80..=0xBF));
            let sets = if starts_character { 1 } else { 4 };
            if walk.sets[..sets]
                .iter()
                .all(|it| it.words().iter().all(|it| *it == 0))
            {
                return match cache {
                    Some(_) if sets == 1 => Ok((Cache::NOTHING, walk.index)),
                    _ => Err(false),
                };
            }
            if let Some(it) = cache
                && (walk.index == on.first
                    || (on.path[walk.index - 1] < 128 || it.has_characters && starts_character)
                        && !on.is_closed_at(walk.index - 1))
            {
                match it.state_of(walk.sets[0].words()) {
                    Some(state) => return Ok((state, walk.index)),
                    None => cache = None,
                }
            }
        }
        Err(walk.sets[0].words()[0] & 1 != 0)
    }
}

/// Remembers the steps of [`Walk`]s over earlier paths. A state is a set of nodes. For an ASCII byte outside closed segments, the
/// set for an index follows from that byte and the set for the next index, so each such step is worked out once per pattern.
/// After that it's one lookup.
///
/// The same holds for a well-formed character of several bytes and the set for the index after it. Its last bytes lead through
/// states that stand for no set, only for the state and the bytes that they come from.
///
/// Threads share it without a lock. Each entry of `steps` is complete in itself, and a state is never changed or removed.
/// Two threads may add the same set as two states, which does no harm. When `states` is full, new steps are worked out each time.
struct Cache {
    is_windows: bool,
    /// It has steps for characters that aren't ASCII.
    has_characters: bool,
    /// For each byte, where its entry is in the part of `steps` that belongs to a state.
    columns: [u8; 256],
    /// For each state: whether the pattern matches if the path starts here (`NO`, `YES`), then one entry per column:
    /// the state before that byte. A state is written as the index of its first column. 0 means not known yet.
    /// For a state inside a character, the first entry is `INSIDE` plus 4 times the state after the character plus the number of
    /// bytes between the two.
    steps: Box<[AtomicU32]>,
    states: Box<[Once<SmallVec<[u64; 2]>>]>,
    /// Number of states that are taken.
    taken: AtomicU32,
    is_full: AtomicBool,
    /// Number of entries per state.
    stride: u32,
    /// The state for the end of the path.
    end: u32,
}

impl Cache {
    const UNKNOWN: u32 = 0;
    const NO: u32 = 1;
    const YES: u32 = 2;
    const INSIDE: u32 = 3;
    /// The state of the empty set, which is added first.
    const NOTHING: u32 = 1;
    /// Column of the bytes that always need a `Walk`. Its entries stay `UNKNOWN`.
    const NOT_ASCII: u8 = 0;

    #[cold]
    #[inline(never)]
    fn of(program: &Program, glob: &[u8], is_windows: bool, states: u32) -> Option<Box<Cache>> {
        if !program.sequences.is_empty() || program.masks.len() > 4 {
            return None;
        }
        let on = program.on(glob, b"", 0, is_windows, Dots::Match);
        // All characters that aren't ASCII are alike to a class or an escape that has none of them.
        let has_characters = on.pattern.iter().enumerate().all(|(node, _)| {
            let (masks, bit) = (&program.masks[node / 64], 1 << (node % 64));
            let end = match () {
                _ if masks.classes & bit != 0 => class_end(on.pattern, node).unwrap_or(node),
                _ if masks.escapes & bit != 0 => (node + 2).min(on.pattern.len()),
                _ => node,
            };
            on.pattern[node..end].is_ascii()
        });
        // Bytes that no node tells apart share a column.
        let mut columns = [Cache::NOT_ASCII; 256];
        columns[..128].fill(1);
        let mut count = 2_u8;
        // These ranges are all that it takes to tell whether a sequence of bytes is well-formed.
        for range in [
            0x80..=0x8F,
            0x90..=0x9F,
            0xA0..=0xBF,
            0xC2..=0xDF,
            0xE0..=0xE0,
            0xE1..=0xEC,
            0xED..=0xED,
            0xEE..=0xEF,
            0xF0..=0xF0,
            0xF1..=0xF3,
            0xF4..=0xF4,
        ] {
            if has_characters {
                columns[range].fill(count);
                count += 1;
            }
        }
        let mut split = |is_member: &dyn Fn(u8) -> bool| {
            // For each column, the new column of its members.
            let mut moved = [0_u8; 256];
            let mut has_others = [false; 256];
            for byte in 0..=255_u8 {
                has_others[columns[byte as usize] as usize] |= !is_member(byte);
            }
            for byte in 0..=255_u8 {
                let column = columns[byte as usize] as usize;
                if column != usize::from(Cache::NOT_ASCII) && has_others[column] && is_member(byte)
                {
                    if moved[column] == 0 {
                        moved[column] = count;
                        count = count.checked_add(1)?;
                    }
                    columns[byte as usize] = moved[column];
                }
            }
            Some(())
        };
        split(&|byte| byte == b'/' || is_windows && byte == b'\\')?;
        let mut seen = [false; 256];
        for (node, &wanted) in on.pattern.iter().enumerate() {
            let (masks, bit) = (&program.masks[node / 64], 1 << (node % 64));
            if (masks.classes | masks.escapes) & bit != 0 {
                split(&|byte| byte < 128 && on.takes(node, byte, u32::from(byte)))?;
            } else if masks.bytes & bit != 0 && !std::mem::replace(&mut seen[wanted as usize], true)
            {
                split(&|byte| byte == wanted)?;
            }
        }
        let stride = u32::from(count) + 1;
        let mut cache = Box::new(Cache {
            is_windows,
            has_characters,
            columns,
            steps: (0..states * stride).map(|_| AtomicU32::new(0)).collect(),
            states: (0..states).map(|_| Once::new()).collect(),
            taken: AtomicU32::new(0),
            is_full: AtomicBool::new(false),
            stride,
            end: 0,
        });
        cache.state_of(&[0; 4][..program.masks.len()])?;
        cache.end = cache.leave(&on, None, 0).ok()?.0;
        Some(cache)
    }

    /// Returns the state for `set`. Adds it if there's room.
    fn state_of(&self, set: &[u64]) -> Option<u32> {
        let name = |index: usize| index as u32 * self.stride + 1;
        let taken = (self.states.len()).min(self.taken.load(Ordering::Relaxed) as usize);
        let is_set = |it: &Once<SmallVec<[u64; 2]>>| it.get().is_some_and(|it| **it == *set);
        if let Some(index) = self.states[..taken].iter().position(is_set) {
            return Some(name(index));
        }
        if taken == self.states.len() {
            self.is_full.store(true, Ordering::Relaxed);
            return None;
        }
        let index = self.taken.fetch_add(1, Ordering::Relaxed) as usize;
        self.states
            .get(index)?
            .get_or_init(|| SmallVec::from_slice(set));
        let answer = if set[0] & 1 != 0 {
            Cache::YES
        } else {
            Cache::NO
        };
        self.steps[name(index) as usize - 1].store(answer, Ordering::Relaxed);
        Some(name(index))
    }

    /// Returns whether the first node matches at the start of `text`, if every step for that is known.
    #[inline(always)]
    fn answer(&self, text: &[u8]) -> Answer {
        let mut state = self.end;
        let (steps, columns) = (&*self.steps, &self.columns);
        for byte in text.iter().rev() {
            state =
                steps[state as usize + columns[*byte as usize] as usize].load(Ordering::Relaxed);
            if state <= Cache::NOTHING {
                return match state {
                    Cache::NOTHING => Answer::No,
                    _ if *byte >= 128 && !self.has_characters => Answer::NotAscii,
                    _ => Answer::Unknown,
                };
            }
        }
        match steps[state as usize - 1].load(Ordering::Relaxed) {
            Cache::YES => Answer::Yes,
            Cache::NO => Answer::No,
            _ => Answer::Unknown,
        }
    }

    /// [`Cache::answer`] for the other [`Dots`], which come to the same unless a segment from `first` on starts with a `.`.
    #[inline(never)]
    fn answer_without_dots(&self, path: &[u8], first: usize) -> Answer {
        if first > 0 && path[first - 1] == b'.' {
            return Answer::Unknown;
        }
        let mut state = self.end;
        for index in (first..path.len()).rev() {
            let byte = path[index];
            if byte == b'.' && (index == 0 || is_separator(path[index - 1], self.is_windows)) {
                return Answer::Unknown;
            }
            state = self.steps[state as usize + self.columns[byte as usize] as usize]
                .load(Ordering::Relaxed);
            if state <= Cache::NOTHING {
                return match state {
                    Cache::NOTHING => Answer::No,
                    _ => Answer::Unknown,
                };
            }
        }
        match self.steps[state as usize - 1].load(Ordering::Relaxed) {
            Cache::YES => Answer::Yes,
            Cache::NO => Answer::No,
            _ => Answer::Unknown,
        }
    }

    /// `first` is the index of the path where the first node has to match. `dots` is `Dots::Match` unless the path has a closed
    /// segment.
    #[inline(always)]
    fn matches(
        &self,
        program: &Program,
        glob: &[u8],
        path: &[u8],
        first: usize,
        dots: Dots,
    ) -> bool {
        let mut index = path.len();
        let mut state = self.end;
        if dots == Dots::Match {
            // This is where a pattern that's matched often spends its time.
            let (steps, columns) = (&*self.steps, &self.columns);
            for byte in path[first..].iter().rev() {
                let entry = state as usize + columns[*byte as usize] as usize;
                let next = steps[entry].load(Ordering::Relaxed);
                if next <= Cache::NOTHING {
                    if next == Cache::NOTHING {
                        return false;
                    }
                    break;
                }
                state = next;
                index -= 1;
            }
            let answer = self.steps[state as usize - 1].load(Ordering::Relaxed);
            if index == first && matches!(answer, Cache::NO | Cache::YES) {
                return answer == Cache::YES;
            }
        }
        self.go_on(
            &program.on(glob, path, first, self.is_windows, dots),
            state,
            index,
        )
    }

    /// Goes on from `state` at `index`, also with steps that aren't in `steps`.
    #[cold]
    #[inline(never)]
    fn go_on(&self, on: &On<'_>, mut state: u32, mut index: usize) -> bool {
        let path = on.path;
        if index == path.len() && on.is_closed_at(index) {
            match self.leave(on, None, index) {
                Ok(found) => (state, index) = found,
                Err(answer) => return answer,
            }
        }
        while index > on.first {
            let byte = path[index - 1];
            let entry = state as usize + self.columns[byte as usize] as usize;
            let next = self.steps[entry].load(Ordering::Relaxed);
            // Only an index beside a `.` can be closed.
            if next == Cache::UNKNOWN
                || on.dots != Dots::Match
                    && (byte == b'.' || index > 1 && path[index - 2] == b'.')
                    && on.is_closed_at(index - 1)
            {
                (state, index) = self.after_character(state, index);
                match self.leave(on, Some(state), index) {
                    Ok(found) => (state, index) = found,
                    Err(answer) => return answer,
                }
                continue;
            }
            if next == Cache::NOTHING {
                return false;
            }
            state = next;
            index -= 1;
        }
        match self.steps[state as usize - 1].load(Ordering::Relaxed) {
            Cache::YES => true,
            Cache::NO => false,
            _ => on.walk(),
        }
    }

    /// For a state inside a character, returns the state and the index after the character.
    fn after_character(&self, state: u32, index: usize) -> (u32, usize) {
        match self.steps[state as usize - 1].load(Ordering::Relaxed) {
            ..Cache::INSIDE => (state, index),
            it => (
                (it - Cache::INSIDE) / 4,
                index + ((it - Cache::INSIDE) % 4) as usize,
            ),
        }
    }

    /// Remembers that `character` leads from the state `after` to the state `before`.
    fn add_character(&self, after: u32, character: &[u8], before: u32) -> Option<()> {
        let (first, others) = character.split_first()?;
        let mut state = after;
        for (count, byte) in others.iter().rev().enumerate() {
            let step = &self.steps[state as usize + self.columns[*byte as usize] as usize];
            state = match step.load(Ordering::Relaxed) {
                Cache::UNKNOWN => {
                    let index = self.taken.fetch_add(1, Ordering::Relaxed);
                    if index as usize >= self.states.len() {
                        self.is_full.store(true, Ordering::Relaxed);
                        return None;
                    }
                    let inside = index * self.stride + 1;
                    self.steps[inside as usize - 1].store(
                        Cache::INSIDE + after * 4 + count as u32 + 1,
                        Ordering::Relaxed,
                    );
                    step.store(inside, Ordering::Relaxed);
                    inside
                }
                inside => inside,
            };
        }
        self.steps[state as usize + self.columns[*first as usize] as usize]
            .store(before, Ordering::Relaxed);
        Some(())
    }

    /// Takes a step that isn't in `steps` from `state` at `index`, or from the end of the path.
    #[cold]
    #[inline(never)]
    fn leave(&self, on: &On<'_>, state: Option<u32>, index: usize) -> Result<(u32, usize), bool> {
        let Some(state) = state else {
            return on.go(None, Some(self));
        };
        // Another thread may have told us the state's name before its set has arrived here.
        let Some(set) = self.states[(state / self.stride) as usize].get() else {
            return Err(on.walk());
        };
        let found = on.go(Some((index, set)), Some(self))?;
        let byte = on.path[index - 1];
        if found.1 == index - 1 && byte < 128 && !on.is_closed_at(index - 1) {
            self.steps[state as usize + self.columns[byte as usize] as usize]
                .store(found.0, Ordering::Relaxed);
        }
        let character = &on.path[found.1..index];
        if byte >= 128
            && self.has_characters
            && on.dots == Dots::Match
            && std::str::from_utf8(character).is_ok_and(|it| it.chars().count() == 1)
        {
            self.add_character(state, character, found.0);
        }
        Ok(found)
    }
}
