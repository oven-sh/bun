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
use bun_core::strings;
use std::sync::OnceLock;
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

#[derive(Copy, Clone, Default)]
struct State {
    path_index: u32,
    glob_index: u32,

    wildcard: Wildcard,
    globstar: Wildcard,
}

impl State {
    #[inline(always)]
    fn backtrack(&mut self) {
        self.path_index = self.wildcard.path_index;
        self.glob_index = self.wildcard.glob_index;
    }

    #[inline(always)]
    fn skip_to_separator<const WINDOWS: bool>(&mut self, path: &[u8], is_end_invalid: bool) {
        if self.path_index as usize == path.len() {
            self.wildcard.path_index += 1;
            self.globstar = self.wildcard;
            return;
        }

        let mut path_index = self.path_index;
        while (path_index as usize) < path.len()
            && !is_separator::<WINDOWS>(path[path_index as usize])
        {
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
    if differs_at_once(glob, path) {
        return MatchResult::NO;
    }
    match WINDOWS {
        true => match_for_windows(glob, None, path, Dots::Match),
        false => match_for_posix(glob, None, path, Dots::Match),
    }
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
    if differs_at_once(glob, path) {
        return MatchResult::NO;
    }
    match WINDOWS {
        true => match_for_windows(glob, Some(shape), path, dots),
        false => match_for_posix(glob, Some(shape), path, dots),
    }
}

/// Most paths that a pattern is asked about differ from it in the first byte. This is checked at the call site.
#[inline(always)]
fn differs_at_once(glob: &[u8], path: &[u8]) -> bool {
    glob.first()
        .is_some_and(|first| IS_PLAIN[*first as usize] && path.first() != Some(first))
}

// Not generic, so that the binary has the loop once per platform and not once per crate that calls it.
#[inline(never)]
fn match_for_posix(glob: &[u8], shape: Option<&Shape>, path: &[u8], dots: Dots) -> MatchResult {
    match_as::<false>(glob, shape, path, dots)
}

#[inline(never)]
fn match_for_windows(glob: &[u8], shape: Option<&Shape>, path: &[u8], dots: Dots) -> MatchResult {
    match_as::<true>(glob, shape, path, dots)
}

#[inline(always)]
fn match_as<const WINDOWS: bool>(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    dots: Dots,
) -> MatchResult {
    let glob_start = negations(glob) as u32;
    let negated = glob_start % 2 == 1;
    let mut front = Front {
        glob_start,
        glob_index: glob_start,
        path_index: 0,
        seen: Seen::OnlyRegular,
        uses: shape.map_or(0, |it| it.uses.load(Ordering::Relaxed)),
    };
    let decided = match front.uses == Shape::WALKS {
        true => None,
        false => front.take::<WINDOWS>(glob, path, dots),
    };
    #[cfg(debug_assertions)]
    if let Some(matched) = decided
        && path.len() < Program::IS_LONG
    {
        let mut parsed = Parsed::new();
        parsed.read(glob);
        debug_assert!(
            !parsed.is_regular
                || matched == match_groups::<WINDOWS>(glob, glob_start, path, &parsed, dots, false),
            "the front and the walk differ"
        );
    }
    let matched = match decided {
        Some(matched) => matched,
        None => match_rest::<WINDOWS>(glob, shape, path, dots, front),
    };
    MatchResult {
        matches: matched != negated,
        negated,
    }
}

/// What the start of a pattern has taken of a path.
#[derive(Copy, Clone)]
struct Front {
    /// Index of the pattern after the leading `!`s.
    glob_start: u32,
    /// Indexes of the pattern and of the path after what has been taken.
    glob_index: u32,
    path_index: u32,
    seen: Seen,
    /// See [`Shape::uses`].
    uses: u8,
}

impl Front {
    /// Takes the tokens at the start of the pattern that take one character of the path whatever follows: literal and escaped
    /// bytes, `/`, `?` and classes. Returns the answer if that decides the match, or if [`match_tail`] does.
    #[inline(always)]
    fn take<const WINDOWS: bool>(&mut self, glob: &[u8], path: &[u8], dots: Dots) -> Option<bool> {
        let (mut at, mut taken) = (self.glob_index as usize, 0);
        while let Some(&wanted) = glob.get(at) {
            let found = path.get(taken).copied();
            let takes = if IS_PLAIN[wanted as usize] {
                found == Some(wanted)
            } else {
                match wanted {
                    b'/' => found.is_some_and(is_separator::<WINDOWS>),
                    b'?' | b'[' if dots != Dots::Match || found.is_some_and(|it| it >= 128) => {
                        break;
                    }
                    b'?' if glob.get(at + 1) == Some(&b'(') => break,
                    b'?' => found.is_some_and(|it| !is_separator::<WINDOWS>(it)),
                    b'[' => {
                        let Some((has, close)) = ascii_class(glob, at, found.unwrap_or(0)) else {
                            break;
                        };
                        (at, self.seen) = (close, Seen::Odd);
                        has && found.is_some()
                    }
                    b'\\' if glob.get(at + 1).is_some_and(|it| *it < 128 && *it != b'/') => {
                        let (mut escaped, mut index) = (wanted, at as u32);
                        unescape(&mut escaped, glob, &mut index);
                        (at, self.seen) = (at + 1, Seen::Odd);
                        found == Some(escaped)
                    }
                    // The loop compares as many bytes as the first one announces, whatever they are.
                    0x80.. => {
                        let len = usize::from(strings::wtf8_byte_sequence_length(wanted));
                        let takes = (0..len).all(|i| {
                            let wanted = glob.get(at + i);
                            wanted.is_some() && wanted == path.get(taken + i)
                        });
                        (at, taken) = (at + len - 1, taken + len - 1);
                        takes
                    }
                    _ => break,
                }
            };
            if !takes {
                return Some(false);
            }
            at += 1;
            taken += 1;
        }
        (self.glob_index, self.path_index) = (at as u32, taken as u32);
        if at == glob.len() {
            return Some(taken == path.len());
        }
        if dots != Dots::Match {
            return None;
        }
        let starts_segment = at == self.glob_start as usize || glob[at - 1] == b'/';
        match_tail::<WINDOWS>(&glob[at..], starts_segment, &path[taken..])
    }
}

/// Decides whether `tail`, the end of a pattern, matches `rest`, the end of a path, if `tail` is `**`, or if it's `**/`, `*` or
/// `**/*` followed only by tokens that take one character: literal bytes, `?`, classes and, without the `*`, `/`.
/// Then those tokens have to match the end of `rest`, and only what's before that is left to look at.
#[inline(always)]
fn match_tail<const WINDOWS: bool>(
    mut tail: &[u8],
    starts_segment: bool,
    rest: &[u8],
) -> Option<bool> {
    let mut any_depth = false;
    while starts_segment && let Some(after) = tail.strip_prefix(b"**") {
        match after {
            [] => return Some(true),
            [b'/', after @ ..] => (tail, any_depth) = (after, true),
            _ => return None,
        }
    }
    let any_start = tail.first() == Some(&b'*');
    if any_start {
        tail = &tail[1..];
    }
    // `**/*` has a rule of its own.
    if !any_depth && !any_start
        || any_depth && tail.is_empty()
        || any_start && tail.first() == Some(&b'(')
    {
        return None;
    }
    let (width, is_literal) = width_of(tail, !any_start)?;
    let Some(before) = rest.len().checked_sub(width) else {
        return Some(false);
    };
    // Each of the last `width` bytes has to be a character.
    if !is_literal && !rest.is_ascii() {
        return None;
    }
    let (before, end) = rest.split_at(before);
    let mut at = 0;
    for &found in end {
        let wanted = tail[at];
        let takes = match wanted {
            b'/' => is_separator::<WINDOWS>(found),
            b'?' => !is_separator::<WINDOWS>(found),
            b'[' => {
                let (has, close) = ascii_class(tail, at, found)?;
                at = close;
                has
            }
            _ => found == wanted,
        };
        if !takes {
            return Some(false);
        }
        at += 1;
    }
    Some(match (any_depth, any_start) {
        (true, true) => true,
        (true, false) => before.last().is_none_or(|it| is_separator::<WINDOWS>(*it)),
        (false, _) => !before.iter().any(|it| is_separator::<WINDOWS>(*it)),
    })
}

/// Returns how many characters `tokens` takes, and whether it's all literal, if it has only tokens that take one character.
#[inline(always)]
fn width_of(tokens: &[u8], may_have_slash: bool) -> Option<(usize, bool)> {
    let (mut width, mut is_literal) = (0, true);
    let mut at = 0;
    while let Some(&ch) = tokens.get(at) {
        if !IS_PLAIN[ch as usize] {
            match ch {
                b'/' if may_have_slash => {}
                b'?' if tokens.get(at + 1) != Some(&b'(') => is_literal = false,
                // With a class that can match a separator, the loop doesn't find every match.
                b'[' => {
                    let (has_slash, close) = ascii_class(tokens, at, b'/')?;
                    if has_slash || ascii_class(tokens, at, b'\\')?.0 {
                        return None;
                    }
                    (at, is_literal) = (close, false);
                }
                _ => return None,
            }
        }
        at += 1;
        width += 1;
    }
    Some((width, is_literal))
}

/// [`match_class`] for an ASCII character and a class that has neither escapes nor characters that aren't ASCII.
/// Returns the result and the index of the `]`, or `None` for any other class.
#[inline(always)]
fn ascii_class(glob: &[u8], open: usize, c: u8) -> Option<(bool, usize)> {
    let mut at = open + 1;
    let negated = matches!(glob.get(at), Some(b'^' | b'!'));
    at += usize::from(negated);
    let (mut is_first, mut has) = (true, false);
    loop {
        let low = *glob.get(at)?;
        if low == b']' && !is_first {
            return Some((has != negated, at));
        }
        let mut high = low;
        if glob.get(at + 1) == Some(&b'-')
            && let Some(&it) = glob.get(at + 2)
            && it != b']'
        {
            high = it;
            at += 2;
        }
        if low == b'\\' || high == b'\\' || low >= 128 || high >= 128 {
            return None;
        }
        has |= low <= c && c <= high;
        is_first = false;
        at += 1;
    }
}

/// Matches what [`Front::take`] has left.
#[inline(never)]
fn match_rest<const WINDOWS: bool>(
    glob: &[u8],
    shape: Option<&Shape>,
    path: &[u8],
    dots: Dots,
    front: Front,
) -> bool {
    let (glob_start, uses) = (front.glob_start, front.uses);
    // Many patterns are matched once. Keeping what a match finds out costs more than finding it out a second time.
    let keeps =
        |it: &&Shape| uses > 0 || path.len() >= Program::IS_LONG || it.known.get().is_some();
    let mut groups = Groups::new(shape.filter(keeps), dots);
    groups.seen = front.seen;
    // glob_start must point past the consumed `!` prefix so that a pattern-initial
    // `**` is still recognized as being at the start of a path segment.
    let matched = match shape {
        // A `Cache` has no steps for bytes that aren't ASCII. On those the loop is faster, if it can decide.
        Some(shape)
            if uses == Shape::WALKS && (shape.parsed(glob).has_group || path.is_ascii()) =>
        {
            match_groups::<WINDOWS>(glob, glob_start, path, shape.parsed(glob), dots, true)
        }
        // On a long path a cache pays off at once.
        _ if path.len() >= Program::IS_LONG && groups.parsed(glob).may_walk() => {
            let is_kept = shape.is_some();
            match_groups::<WINDOWS>(glob, glob_start, path, groups.parsed(glob), dots, is_kept)
        }
        _ => {
            let taken = (front.glob_index, front.path_index);
            let matched =
                glob_match_impl::<WINDOWS, false>(glob, glob_start, taken, path, &mut groups);
            if let Some(shape) = shape {
                shape.count(glob, uses);
            }
            match groups.has_group || matched && groups.is_beside_dot && dots != Dots::Match {
                true => match_fully::<WINDOWS>(glob, glob_start, path, &mut groups),
                false => matched,
            }
        }
    };
    // The loop and a walk have to agree wherever the loop finds every match.
    #[cfg(debug_assertions)]
    if !groups.has_group && path.len() < Program::IS_LONG {
        let mut parsed = Parsed::new();
        parsed.read(glob);
        debug_assert!(
            !parsed.is_regular
                || parsed.has_group
                || matched == match_groups::<WINDOWS>(glob, glob_start, path, &parsed, dots, false),
            "the loop and the walk differ"
        );
    }
    matched
}

/// Finishes a match that the fast loop can't decide.
#[cold]
#[inline(never)]
fn match_fully<const WINDOWS: bool>(
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    groups: &mut Groups<'_>,
) -> bool {
    // The fast loop ignores the rules for dot segments. Rerun with them only if the path has such a segment.
    if !groups.has_group {
        if !has_closed_segment::<WINDOWS>(path, groups.dots)
            || glob_match_impl::<WINDOWS, true>(glob, glob_start, (glob_start, 0), path, groups)
        {
            return true;
        }
    }
    let (dots, is_kept) = (groups.dots, groups.prepared.is_some());
    groups.has_group
        && match_groups::<WINDOWS>(glob, glob_start, path, groups.parsed(glob), dots, is_kept)
}

/// Matches with a [`Walk`] instead of the loop. With `is_kept`, what's found out about the pattern stays with `parsed`.
#[inline(never)]
fn match_groups<const WINDOWS: bool>(
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    parsed: &Parsed,
    dots: Dots,
    is_kept: bool,
) -> bool {
    // Most paths that don't match differ in their first bytes, which a walk from the end would see last.
    let Some(after_front) = parsed.take_front::<WINDOWS>(glob, glob_start, path) else {
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
    let dots = match dots != Dots::Match && has_closed_segment::<WINDOWS>(path, dots) {
        true => dots,
        false => Dots::Match,
    };
    match program.cache(glob, WINDOWS, path.len()) {
        Some(cache) => cache.matches(program, glob, path, after_front as usize, dots),
        None => program
            .on(glob, path, after_front as usize, WINDOWS, dots)
            .walk(),
    }
}

/// Returns true if `path` has a `.` at `index` or right before it.
#[inline(always)]
fn is_beside_dot(path: &[u8], index: u32) -> bool {
    let index = index as usize;
    path.get(index) == Some(&b'.') || index > 0 && path[index - 1] == b'.'
}

/// Returns true if `path` has a `.` or `..` segment or, with [`Dots::Hide`], a segment that starts with `.`.
#[inline(never)]
pub(crate) fn has_closed_segment<const WINDOWS: bool>(path: &[u8], dots: Dots) -> bool {
    let mut from = 0;
    while let Some(dot) = strings::index_of_char_pos(path, b'.', from) {
        if is_closed_segment_at(path, dot as u32, dots, WINDOWS) {
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

/// The loop for patterns without groups, and for groups that are a [`Choice`]. It keeps one `*` and one `**` to go back to.
/// At any other group it sets `groups.has_group` and returns false: see [`Program`].
/// `glob_start` is the index where the pattern starts. `STRICT` applies the rules for dot segments (see `match_fully`).
/// The caller has matched the pattern up to index `taken.0` with the first `taken.1` bytes of the path (see [`Front`]).
#[inline(always)]
fn glob_match_impl<const WINDOWS: bool, const STRICT: bool>(
    glob: &[u8],
    glob_start: u32,
    taken: (u32, u32),
    path: &[u8],
    groups: &mut Groups<'_>,
) -> bool {
    let mut state = State {
        glob_index: taken.0,
        path_index: taken.1,
        ..State::default()
    };
    let state = &mut state;
    let dots = groups.dots;
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                if IS_PLAIN[ch as usize] {
                    if path.get(state.path_index as usize) == Some(&ch) {
                        state.glob_index += 1;
                        state.path_index += 1;
                        continue 'main_loop;
                    }
                    break 'fallthrough;
                }
                // `**` can still match nothing, so it's handled below.
                if STRICT
                    && matches!(ch, b'*' | b'?' | b'[')
                    && is_closed_segment_at(path, state.path_index, dots, WINDOWS)
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
                                && let Some(tried) = try_group::<WINDOWS, STRICT>(
                                    glob,
                                    state.glob_index,
                                    path,
                                    state.path_index,
                                    state.wildcard.path_index == 0,
                                    groups,
                                ) =>
                        {
                            match tried {
                                Tried::IsGroup => {
                                    groups.has_group = true;
                                    return false;
                                }
                                Tried::Decided(is_match) => return is_match,
                                Tried::Failed => break 'fallthrough,
                                Tried::Took(glob_index, path_index) => {
                                    state.glob_index = glob_index;
                                    state.path_index = path_index;
                                    continue 'main_loop;
                                }
                                // A `*` before the group was part of the segment.
                                Tried::TookSegment(glob_index, path_index) => {
                                    state.glob_index = glob_index;
                                    state.path_index = path_index;
                                    state.wildcard = state.globstar;
                                    continue 'main_loop;
                                }
                                Tried::FailedSegment => {
                                    state.wildcard = state.globstar;
                                    break 'fallthrough;
                                }
                            }
                        }
                        b'*' => {
                            if dots != Dots::Match {
                                groups.is_beside_dot |= is_beside_dot(path, state.path_index);
                            }
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
                                if !is_whole && !groups.sees_odd_token(glob) {
                                    return false;
                                }
                                // After this it's the last `**` of `**/**`, which is a whole segment as well.
                                if glob.get(at + 3) == Some(&b'*') {
                                    skip_globstars(glob, &mut state.glob_index);
                                }
                            }
                            let is_closed = STRICT
                                && is_closed_segment_at(path, state.path_index, dots, WINDOWS);
                            let before = state.wildcard;

                            // False if the group after the wildcard can't start where the wildcard stops.
                            let mut can_start = true;

                            // Skip ahead to the next place in this segment where the literal after the `*` occurs.
                            if !is_globstar
                                && let Some(&wanted) = glob.get(state.glob_index as usize + 1)
                                && IS_PLAIN[wanted as usize]
                            {
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && found != wanted
                                    && !is_separator::<WINDOWS>(found)
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
                                    && !is_separator::<WINDOWS>(found)
                                {
                                    state.path_index += 1;
                                }
                            } else if !is_globstar
                                && dots == Dots::Match
                                && let Some(&wanted) = glob.get(state.glob_index as usize + 1)
                                && wanted >= 128
                            {
                                // The same for a literal that isn't ASCII.
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && found != wanted
                                    && !is_separator::<WINDOWS>(found)
                                {
                                    state.path_index +=
                                        u32::from(rune_len_at(path, state.path_index as usize));
                                }
                            } else if !is_globstar
                                && dots == Dots::Match
                                && glob.get(state.glob_index as usize + 1) == Some(&b'[')
                            {
                                // Skip ahead to the next character of the class after the `*`.
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && !is_separator::<WINDOWS>(found)
                                {
                                    let (c, len) = decode_rune_at(path, state.path_index as usize);
                                    if class_has(glob, state.glob_index + 1, c) != Some(false) {
                                        break;
                                    }
                                    state.path_index += u32::from(len);
                                }
                            } else if !is_globstar
                                && matches!(
                                    glob.get(state.glob_index as usize + 1),
                                    Some(b'{' | b'@' | b'+')
                                )
                            {
                                let skipped = skip_to_start::<WINDOWS>(
                                    glob,
                                    state.glob_index + 1,
                                    path,
                                    state.path_index,
                                    false,
                                    groups,
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
                                    && is_separator::<WINDOWS>(glob[state.glob_index as usize])
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
                                        groups.is_beside_dot = true;
                                        return true;
                                    }

                                    // skip to separator
                                    state.skip_to_separator::<WINDOWS>(path, is_end_invalid);
                                    in_globstar = true;

                                    // Skip segments that don't start with the literal after `**/`.
                                    if !STRICT
                                        && let Some(&wanted) = glob.get(state.glob_index as usize)
                                        && (IS_PLAIN[wanted as usize] || wanted >= 128)
                                    {
                                        // It stops at segments that start with a `.`, and may go past them later.
                                        groups.is_beside_dot |= wanted == b'.';
                                        while let Some(&found) = path.get(state.path_index as usize)
                                            && found != wanted
                                            && state.wildcard.path_index as usize <= path.len()
                                        {
                                            groups.is_beside_dot |= found == b'.';
                                            state.path_index = state.wildcard.path_index;
                                            state.wildcard.path_index += 1;
                                            state
                                                .skip_to_separator::<WINDOWS>(path, is_end_invalid);
                                        }
                                    } else if !STRICT
                                        && matches!(
                                            glob.get(state.glob_index as usize),
                                            Some(b'{' | b'@' | b'+')
                                        )
                                    {
                                        // Same for a group after `**/`.
                                        let skipped = skip_to_start::<WINDOWS>(
                                            glob,
                                            state.glob_index,
                                            path,
                                            state.path_index,
                                            true,
                                            groups,
                                        );
                                        can_start = skipped.can_start;
                                        let start = skipped.path_index;
                                        if start != state.path_index {
                                            groups.is_beside_dot = true;
                                            state.path_index = start;
                                            state.wildcard.path_index = start + 1;
                                            state
                                                .skip_to_separator::<WINDOWS>(path, is_end_invalid);
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
                                && is_separator::<WINDOWS>(path[state.path_index as usize])
                            {
                                state.wildcard = state.globstar;
                            }

                            if !can_start {
                                break 'fallthrough;
                            }
                            continue 'main_loop;
                        }
                        b'?' => {
                            if dots != Dots::Match {
                                groups.is_beside_dot |= is_beside_dot(path, state.path_index);
                            }
                            if (state.path_index as usize) < path.len() {
                                if !is_separator::<WINDOWS>(path[state.path_index as usize]) {
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
                        b'[' if state.glob_index < groups.no_class_from => {
                            if !groups.sees_odd_token(glob) {
                                return false;
                            }
                            if dots != Dots::Match {
                                groups.is_beside_dot |= is_beside_dot(path, state.path_index);
                            }
                            if (state.path_index as usize) < path.len() {
                                // source unicode char to match against the target + its byte length in `path`
                                let (c, len) = decode_rune_at(path, state.path_index as usize);
                                match match_class(glob, state.glob_index, c) {
                                    Some((true, end)) => {
                                        state.glob_index = end;
                                        state.path_index += u32::from(len);
                                        continue 'main_loop;
                                    }
                                    Some((false, _)) => break 'fallthrough,
                                    // An unclosed `[` is literal.
                                    None => {
                                        groups.no_class_from = state.glob_index;
                                        continue 'main_loop;
                                    }
                                }
                            } else {
                                break 'to_else;
                            }
                        }
                        _ => break 'to_else,
                    }
                }
                if (state.path_index as usize) < path.len() {
                    if ch == b'\\' && !groups.sees_odd_token(glob) {
                        return false;
                    }
                    let mut cc: u8 = ch;
                    unescape(&mut cc, glob, &mut state.glob_index);
                    let cc_len = strings::wtf8_byte_sequence_length(cc);

                    let is_match = if cc == b'/' {
                        is_separator::<WINDOWS>(path[state.path_index as usize])
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

        if state.wildcard.path_index > 0 && state.wildcard.path_index as usize <= path.len() {
            state.backtrack();
            continue;
        }

        return false;
    }

    true
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

/// [`match_class`] for callers outside the loop.
#[inline(never)]
fn class_has(glob: &[u8], open: u32, c: u32) -> Option<bool> {
    match_class(glob, open, c).map(|it| it.0)
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
}

/// Per-match state of the loop.
struct Groups<'s> {
    /// What's found out about the pattern is kept here, if the caller passed a shape in and this isn't its first match.
    prepared: Option<&'s Shape>,
    unprepared: Option<Parsed>,
    unprepared_segment: Option<Option<Box<Segment>>>,
    /// The alternatives of the group that [`Groups::plain_at`] has read last.
    plain: SmallVec<[Alternative; 8]>,
    seen: Seen,
    /// The loop reached a group that it can't handle.
    has_group: bool,
    /// No `[` at or after this index is closed.
    no_class_from: u32,
    /// A wildcard was evaluated next to a `.` in the path, so `match_as` has to check for `.` and `..` segments.
    is_beside_dot: bool,
    dots: Dots,
}

impl<'s> Groups<'s> {
    #[inline(always)]
    fn new(prepared: Option<&'s Shape>, dots: Dots) -> Groups<'s> {
        Groups {
            prepared,
            unprepared: None,
            unprepared_segment: None,
            plain: SmallVec::new(),
            seen: Seen::OnlyRegular,
            has_group: false,
            no_class_from: u32::MAX,
            is_beside_dot: false,
            dots,
        }
    }

    fn is_parsed(&self) -> bool {
        self.unprepared.is_some() || self.prepared.is_some_and(|it| it.parsed_so_far().is_some())
    }

    /// Returns the alternatives of the group at `open` if it's a `{a,b}`, `@(a|b)` or `?(a)` of plain literals. Such a group is one
    /// whatever the rest of the pattern is. `choice` is right if the pattern is regular.
    #[inline(never)]
    fn plain_at(&mut self, glob: &[u8], open: u32) -> Option<&[Alternative]> {
        let (first, separator, closer) = brackets_at(glob, open as usize)?;
        if self
            .plain
            .first()
            .is_some_and(|it| it.start as usize == first)
        {
            return Some(&self.plain[..]);
        }
        let alternative = |start: usize| Alternative {
            start: start as u32,
            end: 0,
            next: u32::MAX,
            close: 0,
            choice: Choice::No,
        };
        self.plain.clear();
        self.plain.push(alternative(first));
        let mut close = first;
        loop {
            let ch = glob.get(close).copied().filter(|it| IS_PLAIN[*it as usize]);
            if ch == Some(separator) || ch == Some(closer) {
                let count = self.plain.len();
                self.plain[count - 1].end = close as u32;
                if ch == Some(closer) {
                    break;
                }
                self.plain[count - 1].next = count as u32;
                self.plain.push(alternative(close + 1));
            } else if ch.is_none() {
                self.plain.clear();
                return None;
            }
            close += 1;
        }
        let is_optional = glob[open as usize] == b'?';
        // With one alternative it may be a sequence like `{1..3}`.
        if self.plain.len() == 1 && !is_optional {
            self.plain.clear();
            return None;
        }
        let len = self.plain[0].end - self.plain[0].start;
        let has_one_length = self.plain.iter().all(|it| it.end - it.start == len);
        self.plain[0].close = close as u32;
        self.plain[0].choice = match glob.get(close + 1) {
            None => Choice::RestOfPath,
            Some(b'/') => Choice::RestOfSegment,
            Some(_) if !is_optional && len > 0 && has_one_length => Choice::OneLength,
            Some(_) => Choice::No,
        };
        Some(&self.plain[..])
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

    /// The loop is at a token that a regular pattern may not have. Returns false if it can't go on.
    #[inline(always)]
    fn sees_odd_token(&mut self, glob: &[u8]) -> bool {
        match std::mem::replace(&mut self.seen, Seen::Odd) {
            Seen::Choice => self.is_regular(glob),
            _ => true,
        }
    }

    #[cold]
    #[inline(never)]
    fn is_regular(&mut self, glob: &[u8]) -> bool {
        self.has_group = !self.parsed(glob).is_regular;
        !self.has_group
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
    /// This is the answer for the whole pattern.
    Decided(bool),
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

/// Looks at the group that starts at `index`. Returns `None` if no group starts there.
/// With `is_committed`, the loop has no `*` or `**` to go back to.
#[cold]
#[inline(never)]
fn try_group<const WINDOWS: bool, const STRICT: bool>(
    glob: &[u8],
    index: u32,
    path: &[u8],
    path_index: u32,
    is_committed: bool,
    groups: &mut Groups<'_>,
) -> Option<Tried> {
    // As long as the pattern looks regular, the loop goes on without reading all of it.
    if !STRICT && groups.seen != Seen::Odd && !groups.is_parsed() {
        let plain = groups.plain_at(glob, index);
        if let Some(alternatives) = plain
            && alternatives[0].choice != Choice::No
        {
            let taken = take_choice::<WINDOWS>(alternatives, 0, glob, path, path_index);
            groups.seen = Seen::Choice;
            #[cfg(debug_assertions)]
            {
                let mut parsed = Parsed::new();
                parsed.read(glob);
                let first = brackets_at(glob, index as usize);
                let first = first.and_then(|it| parsed.group_at(it.0 as u32));
                let choice = first.and_then(|it| {
                    take_choice::<WINDOWS>(&parsed.alternatives, it, glob, path, path_index)
                });
                debug_assert!(!parsed.is_regular || taken == choice);
            }
            return Some(match taken {
                Some((glob_index, path_index)) => Tried::Took(glob_index, path_index),
                None => Tried::Failed,
            });
        }
        // The segment of the path that the loop is in.
        let is_inside = |it: &&u8| !is_separator::<WINDOWS>(**it);
        let (before, after) = path.split_at(path_index as usize);
        let from = before.len() - before.iter().rev().take_while(is_inside).count();
        let to = before.len() + after.iter().take_while(is_inside).count();
        let walks = |it: &Segment| {
            let pattern = &glob[it.start as usize..it.end as usize];
            let on = (it.program).on(pattern, &path[..to], from, WINDOWS, Dots::Match);
            may_end_with(pattern, &path[from..to]) && on.walk()
        };
        let text = Text {
            rest: &path[from..],
            segment_len: to - from,
            is_committed,
            matches: |pattern, text| match_on::<WINDOWS>(pattern, text).matches(),
        };
        let written = match_written_out(glob, index as usize, plain, &text);
        #[cfg(debug_assertions)]
        match written {
            Some(Written::Segment(is_match, end)) => {
                let it = Segment::of(glob, index as usize);
                let it = it.as_deref();
                debug_assert!(it.is_some_and(|it| (is_match, end) == (walks(it), it.end)));
            }
            Some(Written::Rest(is_match)) => {
                let (mut parsed, start) = (Parsed::new(), negations(glob) as u32);
                parsed.read(glob);
                let walked =
                    match_groups::<WINDOWS>(glob, start, path, &parsed, Dots::Match, false);
                debug_assert!(is_match == walked);
            }
            None => {}
        }
        let found = match written {
            Some(Written::Rest(is_match)) => {
                groups.is_beside_dot = true;
                return Some(Tried::Decided(is_match));
            }
            Some(Written::Segment(is_match, end)) => Some((is_match, end)),
            None => groups.segment_at(glob, index).map(|it| (walks(it), it.end)),
        };
        if let Some((is_match, end)) = found {
            // It may have wildcards.
            (groups.seen, groups.is_beside_dot) = (Seen::Choice, true);
            return Some(match is_match {
                true => Tried::TookSegment(end, to as u32),
                false => Tried::FailedSegment,
            });
        }
    }
    let start = index + if glob[index as usize] == b'{' { 1 } else { 2 };
    let seen = groups.seen;
    let shape = groups.parsed(glob);
    if seen == Seen::Choice && !shape.is_regular {
        return Some(Tried::IsGroup);
    }
    let first = shape.group_at(start)?;
    if STRICT || shape.has_group {
        return Some(match shape.may_start_at(first, glob, path, path_index) {
            true => Tried::IsGroup,
            false => Tried::Failed,
        });
    }
    Some(
        match take_choice::<WINDOWS>(&shape.alternatives, first, glob, path, path_index) {
            Some((glob_index, path_index)) => Tried::Took(glob_index, path_index),
            None => Tried::Failed,
        },
    )
}

/// What [`match_written_out`] matches on.
struct Text<'a> {
    /// The path from the start of the segment that the loop is in.
    rest: &'a [u8],
    /// The length of that segment.
    segment_len: usize,
    /// See [`try_group`].
    is_committed: bool,
    /// [`match_on`] for the platform.
    matches: fn(&[u8], &[u8]) -> bool,
}

/// Result of [`match_written_out`].
#[derive(Copy, Clone)]
enum Written {
    /// Whether the segment of the pattern that the group is in matches the segment of the path, and the index where it ends.
    Segment(bool, u32),
    /// Whether the pattern, from that segment on, matches the rest of the path.
    Rest(bool),
}

/// Matches without a [`Program`]: writes the pattern out once for each alternative of the group at `open`, and matches that.
/// It writes out the segment that the group is in, which has to be a [`Segment`]. If the group has a `/` or a `**`, it's the rest of
/// the pattern. Returns `None` unless that is short and has few groups and alternatives, which makes this the cheaper way.
/// `plain` is what [`Groups::plain_at`] says about the group.
#[inline(never)]
fn match_written_out(
    glob: &[u8],
    open: usize,
    plain: Option<&[Alternative]>,
    text: &Text<'_>,
) -> Option<Written> {
    if glob[open] != b'{' {
        return None;
    }
    // Where the alternatives but the last one end, and where that one does.
    let mut commas = [0; 3];
    let (mut count, mut close) = (0, 0);
    // How many groups are open, which of those have had a `,`, and how many groups there have been.
    let (mut depth, mut has_comma, mut groups) = (1, 0_u32, 1);
    let (mut is_rest, mut has_globstar) = (false, false);
    let mut end = open + 1;
    if let Some([first, others @ ..]) = plain {
        count = others.len();
        for (comma, it) in commas.get_mut(..count)?.iter_mut().zip(others) {
            *comma = it.start as usize - 1;
        }
        close = first.close as usize;
        (depth, end) = (0, close + 1);
    }
    while let Some(&ch) = glob.get(end) {
        match ch {
            b'/' if depth == 0 && !is_rest => break,
            b'/' => is_rest = true,
            b',' if depth > 0 => {
                has_comma |= 1 << depth;
                if close == 0 && depth == 1 {
                    *commas.get_mut(count)? = end;
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
            b'*' if glob.get(end + 1) == Some(&b'*') => {
                (is_rest, has_globstar) = (true, true);
                end += 1;
            }
            b'*' | b'?' => {}
            b'[' => {
                let (after, may_be_separator) = class_shape(glob, end)?;
                if may_be_separator || glob[end + 1] == b'(' {
                    return None;
                }
                end = after - 1;
            }
            _ if IS_TEXT[ch as usize] => {}
            _ => return None,
        }
        end += 1;
    }
    let before = glob[negations(glob)..open].iter().rev();
    let start = open - before.take_while(|it| **it != b'/').count();
    let mut written = [0; 64];
    // A leading `!` would mean something else in a pattern of its own. A `**` right after the group is never a whole segment.
    if depth > 0
        || end - start > written.len()
        || glob[start] == b'!'
        || is_rest && !text.is_committed
        || glob[close + 1..].starts_with(b"**")
    {
        return None;
    }
    let path = match is_rest {
        true => text.rest,
        false => &text.rest[..text.segment_len],
    };
    let found = |is_match: bool| match is_rest {
        true => Written::Rest(is_match),
        false => Written::Segment(is_match, end as u32),
    };
    if !may_end_with(&glob[start..end], path) {
        return Some(found(false));
    }
    let (before, after) = (&glob[start..open], &glob[close + 1..end]);
    written[..before.len()].copy_from_slice(before);
    let mut from = open + 1;
    for to in commas[..count].iter().copied().chain([close]) {
        let (alternative, rest) = written[before.len()..].split_at_mut(to - from);
        alternative.copy_from_slice(&glob[from..to]);
        rest[..after.len()].copy_from_slice(after);
        let seams = [before.len(), before.len() + to - from];
        let pattern = &written[..seams[1] + after.len()];
        // Two `*` that come to stand side by side would be a `**`.
        if seams
            .iter()
            .any(|it| *it > 0 && pattern[*it - 1] == b'*' && pattern.get(*it) == Some(&b'*'))
            || has_globstar && !has_plain_globstars(pattern)
        {
            return None;
        }
        if (text.matches)(pattern, path) {
            return Some(found(true));
        }
        from = to + 1;
    }
    Some(found(false))
}

/// Returns true if every `**` in `pattern` is a whole segment of it, and it doesn't end with `**/*`, which has a rule of its own.
fn has_plain_globstars(pattern: &[u8]) -> bool {
    let mut from = 0;
    while let Some(at) = strings::index_of(&pattern[from..], b"**").map(|it| it + from) {
        let starts_segment = at == 0 || pattern[at - 1] == b'/';
        if !starts_segment || !matches!(pattern.get(at + 2), None | Some(b'/')) {
            return false;
        }
        from = at + 2;
    }
    !pattern.ends_with(b"**/*")
}

/// Returns false if `pattern` ends with literal bytes that `text` doesn't end with.
fn may_end_with(pattern: &[u8], text: &[u8]) -> bool {
    let literal = pattern.iter().rev();
    let len = literal
        .take_while(|it| IS_TEXT[**it as usize] && **it != b']')
        .count();
    let (before, literal) = pattern.split_at(pattern.len() - len);
    // A byte that isn't ASCII may stand for a character together with the bytes that follow it.
    text.ends_with(literal) || before.iter().rev().take(3).any(|it| *it >= 128)
}

/// How the alternatives of a group start.
enum Starts<'p> {
    /// There are only a few, and all start with a literal. These are the first `count` bytes of `firsts`.
    Firsts { firsts: [u8; 8], count: usize },
    /// Each alternative has to be asked. `group` is the index of the first one in `alternatives`.
    Alternatives {
        alternatives: &'p [Alternative],
        group: u32,
    },
}

impl<'p> Starts<'p> {
    /// For the group at `index`. Returns `None` if there's no group, or if how it starts says nothing.
    #[inline]
    fn of(glob: &[u8], index: u32, groups: &'p mut Groups<'_>) -> Option<Starts<'p>> {
        let (alternatives, group) = match groups.is_parsed() {
            false => (groups.plain_at(glob, index)?, 0),
            true => {
                let start = match glob[index as usize] {
                    b'{' => index + 1,
                    _ if glob.get(index as usize + 1) == Some(&b'(') => index + 2,
                    _ => return None,
                };
                let parsed = groups.parsed(glob);
                (&parsed.alternatives[..], parsed.group_at(start)?)
            }
        };
        if alternatives[group as usize].next == Alternative::IS_SEQUENCE {
            return None;
        }
        let mut firsts = [0_u8; 8];
        let mut count = 0;
        let mut next = group as usize;
        while let Some(it) = alternatives.get(next)
            && count < firsts.len()
            && it.start < it.end
            && IS_PLAIN[glob[it.start as usize] as usize]
        {
            firsts[count] = glob[it.start as usize];
            count += 1;
            next = it.next as usize;
        }
        Some(match alternatives.get(next) {
            None => Starts::Firsts { firsts, count },
            Some(_) => Starts::Alternatives {
                alternatives,
                group,
            },
        })
    }
}

/// Result of [`skip_to_start`].
struct Skipped {
    path_index: u32,
    /// False if no alternative can start at `path_index`.
    can_start: bool,
}

/// Returns the first index at or after `path_index` where an alternative of the group at `index` could start,
/// or the end of the segment. With `by_segment`, only looks at the start of each segment and returns the last one
/// if none fits.
#[inline(never)]
fn skip_to_start<const WINDOWS: bool>(
    glob: &[u8],
    index: u32,
    path: &[u8],
    mut path_index: u32,
    by_segment: bool,
    groups: &mut Groups<'_>,
) -> Skipped {
    let unknown = |path_index| Skipped {
        path_index,
        can_start: true,
    };
    let Some(starts) = Starts::of(glob, index, groups) else {
        return unknown(path_index);
    };
    let (alternatives, group) = match starts {
        Starts::Alternatives {
            alternatives,
            group,
        } => (alternatives, group),
        Starts::Firsts { firsts, count } => {
            let firsts = &firsts[..count];
            while let Some(found) = path.get(path_index as usize)
                && (by_segment || !is_separator::<WINDOWS>(*found))
                && !firsts.contains(found)
            {
                if !by_segment {
                    path_index += u32::from(rune_len_at(path, path_index as usize));
                    continue;
                }
                let rest = &path[path_index as usize..];
                match rest.iter().position(|it| is_separator::<WINDOWS>(*it)) {
                    Some(separator) => path_index += separator as u32 + 1,
                    None => break,
                }
            }
            let can_start = path
                .get(path_index as usize)
                .is_some_and(|it| firsts.contains(it));
            return Skipped {
                path_index,
                can_start,
            };
        }
    };
    while let Some(&found) = path.get(path_index as usize)
        && (by_segment || !is_separator::<WINDOWS>(found))
    {
        let mut next = group as usize;
        while let Some(it) = alternatives.get(next) {
            if it.may_start_at(glob, path, path_index) {
                return unknown(path_index);
            }
            next = it.next as usize;
        }
        if !by_segment {
            path_index += u32::from(rune_len_at(path, path_index as usize));
            continue;
        }
        let rest = &path[path_index as usize..];
        match rest.iter().position(|it| is_separator::<WINDOWS>(*it)) {
            Some(separator) => path_index += separator as u32 + 1,
            None => break,
        }
    }
    unknown(path_index)
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
    known: OnceLock<Box<Known>>,
    /// How many matches the loop has decided, or one of the two constants.
    uses: AtomicU8,
}

struct Known {
    parsed: OnceLock<Parsed>,
    /// See [`Groups::segment_at`].
    segment: OnceLock<Option<Box<Segment>>>,
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
            known: OnceLock::new(),
            uses: AtomicU8::new(0),
        }
    }

    fn known(&self) -> &Known {
        self.known.get_or_init(|| {
            Box::new(Known {
                parsed: OnceLock::new(),
                segment: OnceLock::new(),
            })
        })
    }

    /// The pattern's groups, if they have been read.
    #[inline(always)]
    fn parsed_so_far(&self) -> Option<&Parsed> {
        self.known.get()?.parsed.get()
    }

    /// Counts a match that the loop has decided. `uses` is the count so far.
    #[inline(always)]
    fn count(&self, glob: &[u8], uses: u8) {
        if uses < Shape::WALKS_AFTER {
            // Unless the match has read the pattern, which settles it.
            if self.uses.load(Ordering::Relaxed) == uses {
                self.uses.store(uses + 1, Ordering::Relaxed);
            }
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
            parsed
        });
        if !parsed.may_walk() {
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

/// For a `{`, `@(` or `?(` at `open`: where the first alternative starts, what separates alternatives, and what closes the group.
#[inline(always)]
fn brackets_at(glob: &[u8], open: usize) -> Option<(usize, u8, u8)> {
    match glob[open] {
        b'{' => Some((open + 1, b',', b'}')),
        b'@' | b'?' if glob.get(open + 1) == Some(&b'(') => Some((open + 2, b'|', b')')),
        _ => None,
    }
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
    /// The pattern has a group that isn't a [`Choice`].
    has_group: bool,
    has_choice: bool,
    /// See [`Segment`].
    is_one_segment: bool,
    /// The loop has matched the pattern often enough to make up for the cost of a [`Cache`].
    is_matched_often: bool,
    /// Number of `*`, `**`, `?` and classes, up to 2.
    wildcards: u8,
    /// Index where the front of the pattern ends: the literal bytes and, in a regular pattern, the [`Choice`]s that it starts with.
    /// What the front takes of a path doesn't depend on the rest of the pattern.
    front_end: u32,
    /// Index in `alternatives` of the group that starts there, if one does.
    first_group: u32,
    /// Made when it's first needed.
    program: OnceLock<Box<Program>>,
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
            has_group: false,
            has_choice: false,
            is_one_segment: false,
            is_matched_often: false,
            wildcards: 0,
            front_end: 0,
            first_group: u32::MAX,
            program: OnceLock::new(),
        }
    }

    /// Returns true if a [`Walk`] gives the same answers as the loop, and is faster once it has a [`Cache`].
    fn may_walk(&self) -> bool {
        self.is_regular && (self.has_group || self.has_choice || self.wildcards >= 2)
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
                        is_regular &= !may_be_separator && glob[i + 1] != b'(';
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
        self.is_regular = is_regular && depth == 0;
        self.has_group = has_group || has_choice && !self.is_regular;
        self.is_one_segment = is_one_segment;
        self.has_choice = has_choice;
        self.wildcards = wildcards.min(2) as u8;
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
    }

    /// Returns the index of the path after what the front of the pattern takes.
    #[inline(always)]
    fn take_front<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        glob_start: u32,
        path: &[u8],
    ) -> Option<u32> {
        let (mut i, mut path_index) = (glob_start, 0);
        while i < self.front_end {
            let wanted = glob[i as usize];
            if !IS_PLAIN[wanted as usize] && wanted != b'/' {
                let start = i + if wanted == b'{' { 1 } else { 2 };
                let first = self.group_at(start)?;
                (i, path_index) =
                    take_choice::<WINDOWS>(&self.alternatives, first, glob, path, path_index)?;
                continue;
            }
            let found = *path.get(path_index as usize)?;
            if wanted != found && !(wanted == b'/' && is_separator::<WINDOWS>(found)) {
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
fn take_choice<const WINDOWS: bool>(
    alternatives: &[Alternative],
    first: u32,
    glob: &[u8],
    path: &[u8],
    path_index: u32,
) -> Option<(u32, u32)> {
    let group = alternatives[first as usize];
    let rest = &path[path_index as usize..];
    let taken = match group.choice {
        Choice::RestOfSegment => {
            let len = rest.iter().take_while(|it| !is_separator::<WINDOWS>(**it));
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
fn is_separator<const WINDOWS: bool>(c: u8) -> bool {
    c == b'/' || WINDOWS && c == b'\\'
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
    caches: [OnceLock<Option<Box<Cache>>>; 2],
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
            caches: [OnceLock::new(), OnceLock::new()],
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
        // Few patterns get to more than 40 states on the paths of a real tree. A small cache is about 3 KB, a large one 30.
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
            // After a byte that isn't ASCII, a character that starts further ahead may still go on with an earlier set.
            let sets = if byte.is_some_and(|it| it >= 128) {
                4
            } else {
                1
            };
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
                    || on.path[walk.index - 1] < 128 && !on.is_closed_at(walk.index - 1))
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
/// Threads share it without a lock. Each entry of `steps` is complete in itself, and a state is never changed or removed.
/// Two threads may add the same set as two states, which does no harm. When `states` is full, new steps are worked out each time.
struct Cache {
    is_windows: bool,
    /// For each byte, where its entry is in the part of `steps` that belongs to a state.
    columns: [u8; 256],
    /// For each state: whether the pattern matches if the path starts here (`NO`, `YES`), then one entry per column:
    /// the state before that byte. A state is written as the index of its first column. 0 means not known yet.
    steps: Box<[AtomicU32]>,
    states: Box<[OnceLock<SmallVec<[u64; 2]>>]>,
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
        // Bytes that no node tells apart share a column.
        let mut columns = [Cache::NOT_ASCII; 256];
        columns[..128].fill(1);
        let mut count = 2_u8;
        let mut split = |is_member: &dyn Fn(u8) -> bool| {
            // For each column, the new column of its members.
            let mut moved = [0_u8; 130];
            let mut has_others = [false; 130];
            for byte in 0..128_u8 {
                has_others[columns[byte as usize] as usize] |= !is_member(byte);
            }
            for byte in (0..128_u8).filter(|it| is_member(*it)) {
                let column = columns[byte as usize] as usize;
                if has_others[column] {
                    if moved[column] == 0 {
                        moved[column] = count;
                        count += 1;
                    }
                    columns[byte as usize] = moved[column];
                }
            }
        };
        split(&|byte| byte == b'/' || is_windows && byte == b'\\');
        let mut seen = [false; 128];
        let on = program.on(glob, b"", 0, is_windows, Dots::Match);
        for (node, &wanted) in on.pattern.iter().enumerate() {
            let (masks, bit) = (&program.masks[node / 64], 1 << (node % 64));
            if (masks.classes | masks.escapes) & bit != 0 {
                split(&|byte| on.takes(node, byte, u32::from(byte)));
            } else if masks.bytes & bit != 0
                && wanted < 128
                && !std::mem::replace(&mut seen[wanted as usize], true)
            {
                split(&|byte| byte == wanted);
            }
        }
        let stride = u32::from(count) + 1;
        let mut cache = Box::new(Cache {
            is_windows,
            columns,
            steps: (0..states * stride).map(|_| AtomicU32::new(0)).collect(),
            states: (0..states).map(|_| OnceLock::new()).collect(),
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
        let is_set = |it: &OnceLock<SmallVec<[u64; 2]>>| it.get().is_some_and(|it| **it == *set);
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
            .set(SmallVec::from_slice(set))
            .ok()?;
        let answer = if set[0] & 1 != 0 {
            Cache::YES
        } else {
            Cache::NO
        };
        self.steps[name(index) as usize - 1].store(answer, Ordering::Relaxed);
        Some(name(index))
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
            if index == first && answer != Cache::UNKNOWN {
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
            Cache::UNKNOWN => on.walk(),
            answer => answer == Cache::YES,
        }
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
        Ok(found)
    }
}
