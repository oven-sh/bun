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

use bun_collections::HashMap;
use bun_collections::smallvec::SmallVec;
use bun_core::{StackCheck, strings};

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

    /// A wildcard was evaluated next to a `.` in the path, so `match_as` has to check for `.` and `..` segments.
    is_beside_dot: bool,
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
/// Groups can nest to any depth. The matcher caches the result for each
/// (pattern position, path position) pair at group boundaries, so a pattern with
/// `k` groups takes `O(k * glob.len() * path.len()^2)` time.
pub fn r#match(glob: &[u8], path: &[u8]) -> MatchResult {
    match_on::<{ cfg!(windows) }>(glob, path)
}

/// [`match`](r#match) with an explicit platform. With `WINDOWS`, `\` in `path` is also a separator.
/// Use `match_on::<false>` for text that isn't a file path and for paths already normalized to `/`.
pub fn match_on<const WINDOWS: bool>(glob: &[u8], path: &[u8]) -> MatchResult {
    match_as::<WINDOWS>(glob, None, path, Dots::Match)
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
pub fn match_prepared<const WINDOWS: bool>(
    glob: &[u8],
    shape: &Shape,
    path: &[u8],
    dots: Dots,
) -> MatchResult {
    match_as::<WINDOWS>(glob, Some(shape), path, dots)
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
    let mut state = State {
        glob_index: glob_start,
        ..State::default()
    };
    let mut groups = Groups::new(shape);
    // glob_start must point past the consumed `!` prefix so that a pattern-initial
    // `**` is still recognized as being at the start of a path segment.
    let mut matched = glob_match_impl::<WINDOWS, false, false>(
        &mut state,
        glob,
        glob_start,
        path,
        &mut groups,
        Inside::NO_GROUP,
    );
    // The fast loop ignores the rules for dot segments. Rerun with them only if the path has such a segment.
    if dots != Dots::Match
        && (matched && (state.is_beside_dot || groups.is_beside_dot) || groups.has_negation)
        && has_closed_segment::<WINDOWS>(path, dots)
    {
        matched = match_strictly::<WINDOWS>(glob, shape, glob_start, path, dots);
    } else {
        matched &= !groups.is_too_deep;
    }

    MatchResult {
        matches: matched != negated,
        negated,
    }
}

#[inline(never)]
fn match_strictly<const WINDOWS: bool>(
    glob: &[u8],
    shape: Option<&Shape>,
    glob_start: u32,
    path: &[u8],
    dots: Dots,
) -> bool {
    let mut groups = Groups {
        is_strict: true,
        dots,
        ..Groups::new(shape)
    };
    let at = (glob_start, glob_start);
    enter::<WINDOWS>(glob, at, path, 0, Inside::NO_GROUP, &mut groups) && !groups.is_too_deep
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

// `glob_start` is the index where the glob pattern starts
#[inline(always)]
// PERF: `inline(always)` on a fn that recurses through enter — profile if hot.
// `STRICT` applies the rules for dot segments (see `match_as`). `IN_GROUP` means `inside` has a group.
fn glob_match_impl<const WINDOWS: bool, const STRICT: bool, const IN_GROUP: bool>(
    state: &mut State,
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    groups: &mut Groups<'_>,
    inside: Inside<'_>,
) -> bool {
    let entered_at = state.path_index;
    let dots = groups.dots;
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                if IN_GROUP
                    && state.glob_index == inside.end
                    && let Some(group) = inside.group
                {
                    let is_idle = inside.is_idle && state.path_index == entered_at;
                    if group.leave::<WINDOWS>(glob, path, state.path_index, is_idle, groups) {
                        return true;
                    }
                    break 'fallthrough;
                }
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
                                && let Some(matched) = Group::try_at::<WINDOWS>(
                                    glob,
                                    state.glob_index,
                                    path,
                                    state.path_index,
                                    Inside {
                                        is_idle: inside.is_idle && state.path_index == entered_at,
                                        ..inside
                                    },
                                    groups,
                                ) =>
                        {
                            if matched {
                                return true;
                            }
                            break 'fallthrough;
                        }
                        b'*' => {
                            state.is_beside_dot |= is_beside_dot(path, state.path_index);
                            // `**(a)` is `*` followed by `*(a)`.
                            let is_globstar = (state.glob_index as usize) + 1 < glob.len()
                                && glob[state.glob_index as usize + 1] == b'*'
                                && glob.get(state.glob_index as usize + 2) != Some(&b'(');
                            if is_globstar {
                                skip_globstars(glob, &mut state.glob_index);
                            }
                            let is_closed = STRICT
                                && is_closed_segment_at(path, state.path_index, dots, WINDOWS);
                            let before = state.wildcard;

                            // `{**,a}/b`: the `/` that makes this a globstar comes after the group.
                            if IN_GROUP
                                && is_globstar
                                && is_name_start(glob, glob_start, state.glob_index)
                                && let (slash, outer) = inside.outside(state.glob_index + 2)
                                && slash > state.glob_index + 2
                                && glob.get(slash as usize) == Some(&b'/')
                            {
                                let is_idle = inside.is_idle && state.path_index == entered_at;
                                let mut at = state.path_index;
                                loop {
                                    let inside = Inside {
                                        is_idle: is_idle && at == state.path_index,
                                        ..outer
                                    };
                                    let next = (slash + 1, slash + 1);
                                    if once((next.0, at, inside.is_idle), groups, |groups| {
                                        enter::<WINDOWS>(glob, next, path, at, inside, groups)
                                    }) {
                                        return true;
                                    }
                                    if STRICT && is_closed_segment_at(path, at, dots, WINDOWS) {
                                        break 'fallthrough;
                                    }
                                    let rest = path.get(at as usize..).unwrap_or_default();
                                    match rest.iter().position(|it| is_separator::<WINDOWS>(*it)) {
                                        Some(separator) => at += separator as u32 + 1,
                                        None => break 'fallthrough,
                                    }
                                }
                            }

                            // Skip ahead to the next place in this segment where the literal after the `*` occurs.
                            if !is_globstar
                                && let Some(&wanted) = glob.get(state.glob_index as usize + 1)
                                && IS_PLAIN[wanted as usize]
                                && !(IN_GROUP && state.glob_index + 1 == inside.end)
                            {
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && found != wanted
                                    && !is_separator::<WINDOWS>(found)
                                {
                                    state.path_index += 1;
                                }
                            } else if !is_globstar && state.glob_index as usize + 1 == glob.len() {
                                // A trailing `*` takes the rest of the segment.
                                while let Some(&found) = path.get(state.path_index as usize)
                                    && !is_separator::<WINDOWS>(found)
                                {
                                    state.path_index += 1;
                                }
                            } else if !is_globstar
                                && matches!(
                                    glob.get(state.glob_index as usize + 1),
                                    Some(b'{' | b'@' | b'+')
                                )
                            {
                                state.path_index = Group::skip_to_start::<WINDOWS>(
                                    glob,
                                    state.glob_index + 1,
                                    path,
                                    state.path_index,
                                    false,
                                    groups,
                                );
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

                                // `{a,b/**}`: the pattern ends right after the group.
                                let is_end_invalid = (state.glob_index as usize) < glob.len()
                                    && !(IN_GROUP
                                        && inside.outside(state.glob_index).0 as usize
                                            == glob.len());

                                // FIXME: explain this bug fix
                                if is_end_invalid
                                    && state.path_index as usize == path.len()
                                    && glob.len() - state.glob_index as usize == 2
                                    && is_separator::<WINDOWS>(glob[state.glob_index as usize])
                                    && glob[state.glob_index as usize + 1] == b'*'
                                {
                                    continue 'main_loop;
                                }

                                // subtract glob_start from glob index before checking if length is less than 3. Given the pattern:
                                // {**/a,**/b}
                                // if we start at index 6 (start of **/b pattern), we don't want to index into the pattern before it
                                if (state.glob_index.saturating_sub(glob_start) < 3
                                    || glob[state.glob_index as usize - 3] == b'/')
                                    && (!is_end_invalid || glob[state.glob_index as usize] == b'/')
                                {
                                    if is_end_invalid {
                                        state.glob_index += 1;
                                    }

                                    // A trailing `**` matches the rest of the path.
                                    if !STRICT
                                        && !is_end_invalid
                                        && state.glob_index as usize == glob.len()
                                    {
                                        state.is_beside_dot = true;
                                        return true;
                                    }

                                    // skip to separator
                                    state.skip_to_separator::<WINDOWS>(path, is_end_invalid);
                                    in_globstar = true;

                                    // Skip segments that don't start with the literal after `**/`.
                                    if !STRICT
                                        && let Some(&wanted) = glob.get(state.glob_index as usize)
                                        && IS_PLAIN[wanted as usize]
                                        && !(IN_GROUP && state.glob_index == inside.end)
                                    {
                                        while let Some(&found) = path.get(state.path_index as usize)
                                            && found != wanted
                                            && state.wildcard.path_index as usize <= path.len()
                                        {
                                            state.is_beside_dot |= found == b'.';
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
                                        let start = Group::skip_to_start::<WINDOWS>(
                                            glob,
                                            state.glob_index,
                                            path,
                                            state.path_index,
                                            true,
                                            groups,
                                        );
                                        if start != state.path_index {
                                            state.is_beside_dot = true;
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

                            continue 'main_loop;
                        }
                        b'?' => {
                            state.is_beside_dot |= is_beside_dot(path, state.path_index);
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
                            state.is_beside_dot |= is_beside_dot(path, state.path_index);
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
        let close = shape.0[shape.group_at(first as u32)? as usize].close;
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

/// `{a,b}`, `{1..3}` or `@(a|b)`.
struct Group<'g> {
    /// `{`, `.` for a sequence like `{1..3}`, or the character before the `(`.
    kind: u8,
    /// Index of its first alternative in [`Shape`].
    first: u32,
    /// Index of the closing `}` or `)`.
    close: u32,
    /// The group that contains this one.
    outer: Inside<'g>,
}

/// The group context of the part of the pattern being matched.
#[derive(Copy, Clone)]
struct Inside<'g> {
    group: Option<&'g Group<'g>>,
    /// Index where the current alternative of `group` ends.
    end: u32,
    /// Nothing was consumed since a group last repeated. Repeating it again would loop forever.
    is_idle: bool,
}

impl<'g> Inside<'g> {
    const NO_GROUP: Inside<'static> = Inside {
        group: None,
        end: u32::MAX,
        is_idle: false,
    };

    /// Leaves every group whose current alternative ends at `index`. Returns the index after them and the outer context.
    fn outside(mut self, mut index: u32) -> (u32, Inside<'g>) {
        while index == self.end
            && let Some(group) = self.group
        {
            index = group.close + 1;
            self = group.outer;
        }
        (index, self)
    }
}

/// Per-match state for groups.
struct Groups<'s> {
    /// The pattern's shape, either passed in by the caller or computed at the first group.
    prepared: Option<&'s Shape>,
    shape: Option<Shape>,
    stack: Option<StackCheck>,
    /// Number of calls to `once`.
    asked: u32,
    /// Cached results of `once`.
    known: Option<HashMap<u64, bool>>,
    /// Ran out of stack. The match fails.
    is_too_deep: bool,
    /// No `[` at or after this index is closed.
    no_class_from: u32,
    /// [`State::is_beside_dot`] of the finished nested runs.
    is_beside_dot: bool,
    /// A `!(a)` group was evaluated. A failed fast match doesn't imply a failed strict match then.
    has_negation: bool,
    /// Apply the rules for dot segments. See `match_as`.
    is_strict: bool,
    dots: Dots,
}

/// Returns true if a path segment of the pattern starts at `index`. `glob_start` is where the current part of the pattern starts.
#[inline(always)]
fn is_name_start(glob: &[u8], glob_start: u32, index: u32) -> bool {
    index <= glob_start || glob[index as usize - 1] == b'/'
}

impl<'s> Groups<'s> {
    #[inline(always)]
    fn new(prepared: Option<&'s Shape>) -> Groups<'s> {
        Groups {
            prepared,
            shape: None,
            stack: None,
            asked: 0,
            known: None,
            is_too_deep: false,
            no_class_from: u32::MAX,
            is_beside_dot: false,
            has_negation: false,
            is_strict: false,
            dots: Dots::Match,
        }
    }

    fn shape(&mut self, glob: &[u8]) -> &Shape {
        match self.prepared {
            Some(shape) => shape,
            None => self.shape.get_or_insert_with(|| Shape::of(glob)),
        }
    }
}

impl Groups<'_> {
    /// Most matches finish long before caching pays off.
    const REMEMBERS_AFTER: u32 = 256;
}

/// Runs `ask` at most once per (pattern index, path index, `is_idle`) and caches the result.
#[inline(always)]
fn once(
    (glob_index, path_index, is_idle): (u32, u32, bool),
    groups: &mut Groups<'_>,
    ask: impl FnOnce(&mut Groups<'_>) -> bool,
) -> bool {
    let key = u64::from(glob_index) << 33 | u64::from(path_index) << 1 | u64::from(is_idle);
    groups.asked = groups.asked.saturating_add(1);
    let remembers = groups.asked > Groups::REMEMBERS_AFTER;
    if let Some(known) = groups.known.as_ref().and_then(|it| it.get(&key)) {
        return *known;
    }
    let answer = ask(groups);
    if remembers {
        groups.known.get_or_insert_default().insert(key, answer);
    }
    answer
}

/// Matches the pattern from `glob_index` against the path from `path_index`.
#[inline(never)]
fn enter<const WINDOWS: bool>(
    glob: &[u8],
    (glob_index, glob_start): (u32, u32),
    path: &[u8],
    path_index: u32,
    inside: Inside<'_>,
    groups: &mut Groups<'_>,
) -> bool {
    if groups.is_too_deep
        || !(groups.stack.get_or_insert_with(StackCheck::init)).is_safe_to_recurse()
    {
        groups.is_too_deep = true;
        return false;
    }
    let mut state = State {
        glob_index,
        path_index,
        ..State::default()
    };
    let state = &mut state;
    let matched = match (groups.is_strict, inside.group.is_some()) {
        (false, false) => {
            glob_match_impl::<WINDOWS, false, false>(state, glob, glob_start, path, groups, inside)
        }
        (false, true) => {
            glob_match_impl::<WINDOWS, false, true>(state, glob, glob_start, path, groups, inside)
        }
        (true, _) => {
            glob_match_impl::<WINDOWS, true, true>(state, glob, glob_start, path, groups, inside)
        }
    };
    groups.is_beside_dot |= state.is_beside_dot;
    matched
}

impl<'g> Group<'g> {
    /// Matches the group that starts at `index` and the rest of the pattern. Returns `None` if no group starts there.
    #[cold]
    #[inline(never)]
    fn try_at<const WINDOWS: bool>(
        glob: &[u8],
        index: u32,
        path: &[u8],
        path_index: u32,
        outer: Inside<'g>,
        groups: &mut Groups<'_>,
    ) -> Option<bool> {
        let group = Group::at(glob, index, outer, groups)?;
        Some(group.matches::<WINDOWS>(glob, path, path_index, outer.is_idle, groups))
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
    ) -> u32 {
        let Some(group) = Group::at(glob, index, Inside::NO_GROUP, groups) else {
            return path_index;
        };
        if !matches!(group.kind, b'{' | b'@' | b'+') {
            return path_index;
        }
        let shape = groups.shape(glob);
        while let Some(&found) = path.get(path_index as usize)
            && (by_segment || !is_separator::<WINDOWS>(found))
        {
            let mut next = group.first as usize;
            while let Some(it) = shape.0.get(next) {
                if it.may_start_at(glob, path, path_index) {
                    return path_index;
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
        path_index
    }

    /// Returns the group that starts at `index`.
    fn at(
        glob: &[u8],
        index: u32,
        outer: Inside<'g>,
        groups: &mut Groups<'_>,
    ) -> Option<Group<'g>> {
        let (kind, start) = match glob[index as usize] {
            b'{' => (b'{', index + 1),
            kind @ (b'?' | b'*' | b'+' | b'@' | b'!')
                if glob.get(index as usize + 1) == Some(&b'(') =>
            {
                (kind, index + 2)
            }
            _ => return None,
        };
        let shape = groups.shape(glob);
        let first = shape.group_at(start)?;
        let it = shape.0[first as usize];
        Some(Group {
            kind: if it.next == Alternative::IS_SEQUENCE {
                b'.'
            } else {
                kind
            },
            first,
            close: it.close,
            outer,
        })
    }

    /// Matches the rest of the pattern after the group.
    fn rest<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups<'_>,
    ) -> bool {
        let inside = Inside {
            is_idle,
            ..self.outer
        };
        // `**` right after a group isn't at the start of a segment.
        let at = (self.close + 1, self.close);
        once((at.0, path_index, is_idle), groups, |groups| {
            enter::<WINDOWS>(glob, at, path, path_index, inside, groups)
        })
    }

    /// Tries each alternative, followed by the rest of the pattern.
    fn alternatives<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups<'_>,
    ) -> bool {
        let start = groups.shape(glob).0[self.first as usize].start;
        once((start, path_index, is_idle), groups, |groups| {
            let mut next = self.first as usize;
            let mut has_tried_nothing = false;
            while let Some(&it) = groups.shape(glob).0.get(next) {
                next = it.next as usize;
                // Try an empty alternative only once.
                let is_empty = it.start == it.end;
                if !it.may_start_at(glob, path, path_index)
                    || is_empty && std::mem::replace(&mut has_tried_nothing, true)
                {
                    continue;
                }
                // A literal alternative doesn't need a nested run. Repeating groups keep it for its stack check.
                let text = &glob[it.start as usize..it.end as usize];
                if !is_empty
                    && !matches!(self.kind, b'*' | b'+')
                    && text.iter().all(|byte| IS_PLAIN[*byte as usize])
                {
                    let end = path_index + text.len() as u32;
                    if path[path_index as usize..].starts_with(text)
                        && self.leave::<WINDOWS>(glob, path, end, false, groups)
                    {
                        return true;
                    }
                    continue;
                }
                let inside = Inside {
                    group: Some(self),
                    end: it.end,
                    is_idle,
                };
                if enter::<WINDOWS>(glob, (it.start, it.start), path, path_index, inside, groups) {
                    return true;
                }
            }
            false
        })
    }

    /// Matches the group from its start.
    #[inline(never)]
    fn matches<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups<'_>,
    ) -> bool {
        if self.kind == b'.' {
            return self.sequence::<WINDOWS>(glob, path, path_index, is_idle, groups);
        }
        if matches!(self.kind, b'?' | b'*')
            && self.rest::<WINDOWS>(glob, path, path_index, is_idle, groups)
        {
            return true;
        }
        let is_one = self.alternatives::<WINDOWS>(glob, path, path_index, is_idle, groups);
        if self.kind != b'!' {
            return is_one;
        }
        groups.has_negation = true;
        if is_one
            || groups.is_strict && is_closed_segment_at(path, path_index, groups.dots, WINDOWS)
        {
            return false;
        }
        let mut end = path_index;
        loop {
            if self.rest::<WINDOWS>(glob, path, end, is_idle && end == path_index, groups) {
                return true;
            }
            if end as usize >= path.len() || is_separator::<WINDOWS>(path[end as usize]) {
                return false;
            }
            end += u32::from(rune_len_at(path, end as usize));
        }
    }

    /// Matches a sequence like `{1..3}` from its start.
    fn sequence<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups<'_>,
    ) -> bool {
        let it = groups.shape(glob).0[self.first as usize];
        let Some(sequence) = Sequence::read(&glob[it.start as usize..it.end as usize]) else {
            return false;
        };
        let rest = &path[path_index as usize..];
        if sequence.has_nothing() && self.rest::<WINDOWS>(glob, path, path_index, is_idle, groups) {
            return true;
        }
        // Longest first, so `{1..20}` tries `12` before `1`.
        let longest = match sequence.of {
            SequenceOf::Letters => rest.len().min(1),
            SequenceOf::Numbers { .. } => {
                let sign = usize::from(rest.first() == Some(&b'-'));
                sign + rest[sign..]
                    .iter()
                    .take_while(|it| it.is_ascii_digit())
                    .count()
            }
        };
        (1..=longest).rev().any(|len| {
            sequence.has(&rest[..len])
                && self.rest::<WINDOWS>(glob, path, path_index + len as u32, false, groups)
        })
    }

    /// Continues after an alternative has matched.
    #[inline(never)]
    fn leave<const WINDOWS: bool>(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups<'_>,
    ) -> bool {
        self.rest::<WINDOWS>(glob, path, path_index, is_idle, groups)
            || matches!(self.kind, b'*' | b'+')
                && !is_idle
                && self.alternatives::<WINDOWS>(glob, path, path_index, true, groups)
    }
}

/// One alternative of a group.
#[derive(Copy, Clone)]
struct Alternative {
    start: u32,
    /// Index of the `,`, `|`, `}` or `)` after it.
    end: u32,
    /// Index in [`Shape`] of the group's next alternative. Out of range for the last one.
    next: u32,
    /// On a group's first alternative, the index of the closing `}` or `)`. 0 means the group is unclosed and therefore literal.
    close: u32,
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
            Some(found) if first.is_ascii_alphanumeric() || first == b'.' => *found == first,
            Some(_) if first == b'[' => {
                let c = decode_rune_at(path, path_index as usize).0;
                !matches!(match_class(glob, self.start, c), Some((false, _)))
            }
            Some(_) => true,
            None => !(first.is_ascii_alphanumeric() || first == b'.'),
        }
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
    Numbers {
        width: usize,
    },
}

/// Whether `written` is the inside of a sequence like `{1..3}`.
pub fn is_sequence(written: &[u8]) -> bool {
    Sequence::read(written).is_some()
}

impl Sequence {
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
        let SequenceOf::Numbers { width } = self.of else {
            return text[0] != b'\\' && self.has_value(i64::from(text[0]));
        };
        let digits = text.strip_prefix(b"-").unwrap_or(text);
        if digits.is_empty() {
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

/// The alternatives of every group in a pattern, sorted by start index.
pub struct Shape(SmallVec<[Alternative; 8]>);

impl Shape {
    /// Finds all groups in one pass over `glob`.
    pub fn of(glob: &[u8]) -> Shape {
        let mut found: SmallVec<[Alternative; 8]> = SmallVec::new();
        // Open groups: is it a brace group, and the indexes in `found` of its first and latest alternative.
        let mut open: SmallVec<[(bool, u32, u32); 8]> = SmallVec::new();
        // Number of open parenthesis groups and open brace groups.
        let mut count = [0_usize; 2];
        // No `[` at or after this index is closed.
        let mut no_class_from = usize::MAX;
        let mut escaped = usize::MAX;
        let mut i = 0;
        while i < glob.len() {
            let ch = glob[i];
            let alternative = Alternative {
                start: i as u32 + 1,
                end: 0,
                next: u32::MAX,
                close: 0,
            };
            match ch {
                b'\\' => {
                    i += 1;
                    escaped = i;
                }
                b'[' if i < no_class_from => match class_end(glob, i) {
                    Some(end) => i = end - 1,
                    None => no_class_from = i,
                },
                b'{' | b'('
                    if ch == b'{'
                        || i > 0
                            && escaped != i - 1
                            && matches!(glob[i - 1], b'?' | b'*' | b'+' | b'@' | b'!') =>
                {
                    open.push((ch == b'{', found.len() as u32, found.len() as u32));
                    count[usize::from(ch == b'{')] += 1;
                    found.push(alternative);
                }
                b',' | b'|' => {
                    if let Some(group) = open.last_mut().filter(|it| it.0 == (ch == b',')) {
                        found[group.2 as usize].end = i as u32;
                        found[group.2 as usize].next = found.len() as u32;
                        group.2 = found.len() as u32;
                        found.push(alternative);
                    }
                }
                b'}' | b')' if count[usize::from(ch == b'}')] > 0 => {
                    // Groups of the other kind that are still open inside it stay unclosed.
                    while let Some((is_brace, first, last)) = open.pop() {
                        count[usize::from(is_brace)] -= 1;
                        if is_brace != (ch == b'}') {
                            continue;
                        }
                        found[last as usize].end = i as u32;
                        let it = &mut found[first as usize];
                        it.close = i as u32;
                        if is_brace
                            && first == last
                            && Sequence::read(&glob[it.start as usize..i]).is_some()
                        {
                            it.next = Alternative::IS_SEQUENCE;
                        }
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        Shape(found)
    }

    /// Returns true if the group whose first alternative starts at `start` is a sequence like `{1..3}`.
    pub(crate) fn is_sequence_at(&self, start: usize) -> bool {
        let first = self.group_at(start as u32);
        first.is_some_and(|it| self.0[it as usize].next == Alternative::IS_SEQUENCE)
    }

    /// Returns the range of each alternative of the group whose first alternative starts at `start`.
    pub(crate) fn alternatives_at(
        &self,
        start: usize,
    ) -> impl Iterator<Item = std::ops::Range<usize>> {
        let mut next = self.group_at(start as u32).map(|it| it as usize);
        std::iter::from_fn(move || {
            let it = self.0.get(next?)?;
            next = Some(it.next as usize);
            Some(it.start as usize..it.end as usize)
        })
    }

    /// Returns the index in `self` of the group whose first alternative starts at `start`.
    #[inline]
    fn group_at(&self, start: u32) -> Option<u32> {
        let at = self.0.binary_search_by_key(&start, |it| it.start).ok()?;
        (self.0[at].close > 0).then_some(at as u32)
    }
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
