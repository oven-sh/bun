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
use bun_collections::{BoundedArray, HashMap};
use bun_core::{StackCheck, strings};

/// used in matchBrace to determine the size of the stack buffer used in the stack fallback allocator
/// that is created for handling braces
/// One such stack buffer is created recursively for each pair of braces
/// therefore this value should be tuned to use a sane amount of memory even at the highest allowed brace depth
/// and for arbitrarily many non-nested braces (i.e. `{a,b}{c,d}`) while reducing the number of allocations.
#[derive(Copy, Clone)]
struct Brace {
    open_brace_idx: u32,
    branch_idx: u32,
    /// Index of the matching `}`, or `glob.len()` if the group is unterminated.
    close_brace_idx: u32,
}
type BraceStack = BoundedArray<Brace, 10>;

/// Upper bound on brace-branch alternatives explored per `match` call. Sequential
/// brace groups multiply (`{a,b}{c,d}` = 4 alternatives), so without a cap an
/// adversarial pattern of ten sequential 10-way groups would explore 10^10
/// alternatives. Patterns that exceed this budget fail to match.
const BRACE_BRANCH_BUDGET: u32 = 10_000;

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

    brace_depth: u8,
}

impl State {
    #[inline(always)]
    fn backtrack(&mut self) {
        self.path_index = self.wildcard.path_index;
        self.glob_index = self.wildcard.glob_index;
        self.brace_depth = self.wildcard.brace_depth;
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
    brace_depth: u8,
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
///     Braces may be nested up to 10 levels deep.
/// "!"
///     Negates the result when at the start of the pattern.
///     Multiple "!" characters negate the pattern multiple times.
/// "\"
///     Used to escape any of the special characters above.
// TODO: consider just taking arena and resetting to initial state,
// all usages of this function pass in Arena.arena()
pub fn r#match(glob: &[u8], path: &[u8]) -> MatchResult {
    match_on::<{ cfg!(windows) }>(glob, path)
}

/// [`match`](r#match) for a path of the system that is named, whichever system this is. `WINDOWS`: `\` separates the segments of
/// `path` too. Without it only `/` does: for what is no path of a file, and for a path that has been written with `/`.
pub fn match_on<const WINDOWS: bool>(glob: &[u8], path: &[u8]) -> MatchResult {
    match_as::<false, WINDOWS>(glob, path, false)
}

/// [`match`](r#match), and with `EXTGLOB` these too:
///
/// "?(a|b)"
///     Matches one of the patterns between the parentheses, or nothing.
/// "*(a|b)"
///     Matches any number of them, one after the other.
/// "+(a|b)"
///     Matches one or more of them.
/// "@(a|b)"
///     Matches one of them.
/// "!(a|b)"
///     Matches zero or more characters, except for path separators, unless one
///     of the patterns and what follows the group match from the same place.
///     At the start of the pattern it is this, and does not negate the result.
/// "{1..3}", "{a..e}", "{1..9..2}", "{01..10}"
///     Matches one of the numbers, or of the letters, from the first to the
///     second, or every second of them. If one of the two numbers is written
///     with a zero in front, all are as long as the longer of the two.
/// "{a}"
///     Braces around one pattern are characters, as for a shell.
///
/// Any syntax can be used between the parentheses. Groups, braces among them,
/// can be nested to any depth and there can be any number of them.
///
/// Where an alternative starts and where a group has ended, the rest of the
/// pattern is matched once for a position in the path. With `k` of `(`, `|`,
/// `)`, `{`, `,`, `}` that takes `O(k * glob.len() * path.len()^2)` time.
///
/// Only `/` separates the segments of `path`, on every system.
pub fn match_with<const EXTGLOB: bool>(glob: &[u8], path: &[u8]) -> MatchResult {
    match_as::<EXTGLOB, false>(glob, path, false)
}

/// [`match_with`] with `EXTGLOB`, where only a `.` in the pattern matches the `.`
/// that a name of the path starts with: not "*", "?", "[.]", "**" or "!(a)".
pub fn match_without_dot(glob: &[u8], path: &[u8]) -> MatchResult {
    match_as::<true, false>(glob, path, true)
}

fn match_as<const EXTGLOB: bool, const WINDOWS: bool>(
    glob: &[u8],
    path: &[u8],
    hides_dots: bool,
) -> MatchResult {
    let mut state = State {
        glob_index: negations(glob, EXTGLOB) as u32,
        ..State::default()
    };
    let negated = state.glob_index % 2 == 1;

    let mut brace_stack = BraceStack::default();
    let mut brace_budget = BRACE_BRANCH_BUDGET;
    let mut groups = Groups {
        hides_dots,
        ..Groups::default()
    };
    // glob_start must point past the consumed `!` prefix so that a pattern-initial
    // `**` is still recognized as being at the start of a path segment.
    let glob_start = state.glob_index;
    let matched = glob_match_impl::<EXTGLOB, WINDOWS>(
        &mut state,
        glob,
        glob_start,
        path,
        &mut brace_stack,
        &mut brace_budget,
        &mut groups,
        Inside::NO_GROUP,
    ) && !groups.is_too_deep;

    MatchResult {
        matches: matched != negated,
        negated,
    }
}

// `glob_start` is the index where the glob pattern starts
#[inline(always)]
// PERF: `inline(always)` on a fn that recurses through match_brace_branch — profile if hot.
fn glob_match_impl<const EXTGLOB: bool, const WINDOWS: bool>(
    state: &mut State,
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    brace_stack: &mut BraceStack,
    brace_budget: &mut u32,
    groups: &mut Groups,
    inside: Inside<'_>,
) -> bool {
    let entered_at = state.path_index;
    let hides_dots = EXTGLOB && groups.hides_dots;
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                if EXTGLOB {
                    let is_idle = inside.is_idle && state.path_index == entered_at;
                    if state.glob_index == inside.end
                        && let Some(group) = inside.group
                    {
                        if group.leave(glob, path, state.path_index, is_idle, groups) {
                            return true;
                        }
                        break 'fallthrough;
                    }
                    if let Some(group) = Group::at(glob, state.glob_index, inside, groups) {
                        if group.matches(glob, path, state.path_index, is_idle, groups) {
                            return true;
                        }
                        break 'fallthrough;
                    }
                    // A `**` can still be nothing.
                    if matches!(ch, b'*' | b'?' | b'[')
                        && hides_dots
                        && is_hidden_name_at(path, state.path_index)
                        && !glob[state.glob_index as usize..].starts_with(b"**")
                    {
                        break 'fallthrough;
                    }
                }
                'to_else: {
                    match ch {
                        b'*' => {
                            // `**(a)` is `*` and `*(a)`.
                            let is_globstar = (state.glob_index as usize) + 1 < glob.len()
                                && glob[state.glob_index as usize + 1] == b'*'
                                && !(EXTGLOB
                                    && glob.get(state.glob_index as usize + 2) == Some(&b'('));
                            if is_globstar {
                                skip_globstars(glob, &mut state.glob_index);
                            }
                            let is_hidden = hides_dots && is_hidden_name_at(path, state.path_index);
                            let before = state.wildcard;

                            // `{**,a}/b`
                            if EXTGLOB
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
                                        enter(glob, next, path, at, inside, groups)
                                    }) {
                                        return true;
                                    }
                                    if hides_dots && is_hidden_name_at(path, at) {
                                        break 'fallthrough;
                                    }
                                    let rest = path.get(at as usize..).unwrap_or_default();
                                    match rest.iter().position(|it| is_separator::<WINDOWS>(*it)) {
                                        Some(separator) => at += separator as u32 + 1,
                                        None => break 'fallthrough,
                                    }
                                }
                            }

                            state.wildcard.glob_index = state.glob_index;
                            state.wildcard.path_index = state.path_index
                                + if (state.path_index as usize) < path.len() {
                                    u32::from(rune_len_at(path, state.path_index as usize))
                                } else {
                                    1
                                };
                            state.wildcard.brace_depth = state.brace_depth;

                            let mut in_globstar = false;
                            if is_globstar {
                                state.glob_index += 2;

                                // `{a,b/**}`
                                let is_end_invalid = (state.glob_index as usize) < glob.len()
                                    && !(EXTGLOB
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

                                    // skip to separator
                                    state.skip_to_separator::<WINDOWS>(path, is_end_invalid);
                                    in_globstar = true;
                                    if is_hidden {
                                        state.wildcard.path_index = 0;
                                        state.globstar = state.wildcard;
                                    }
                                }
                            } else {
                                state.glob_index += 1;
                            }

                            if is_hidden && !in_globstar {
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
                        b'[' => {
                            if (state.path_index as usize) < path.len() {
                                state.glob_index += 1;

                                let mut negated = false;
                                if (state.glob_index as usize) < glob.len()
                                    && (glob[state.glob_index as usize] == b'^'
                                        || glob[state.glob_index as usize] == b'!')
                                {
                                    negated = true;
                                    state.glob_index += 1;
                                }

                                let mut first = true;
                                let mut is_match = false;

                                // source unicode char to match against the target + its byte length in `path`
                                let (c, len) = decode_rune_at(path, state.path_index as usize);

                                while (state.glob_index as usize) < glob.len()
                                    && (first || glob[state.glob_index as usize] != b']')
                                {
                                    // Get low ( ͡° ͜ʖ ͡°), and unescape it
                                    let mut low: u32 = glob[state.glob_index as usize] as u32;
                                    let mut low_len: u8 = 1;
                                    if !get_unicode(
                                        &mut low,
                                        &mut low_len,
                                        glob,
                                        &mut state.glob_index,
                                    ) {
                                        return false; // Invalid pattern!
                                    }

                                    // skip past the target char
                                    state.glob_index += u32::from(low_len);

                                    let high = if (state.glob_index as usize) + 1 < glob.len()
                                        && glob[state.glob_index as usize] == b'-'
                                        && glob[state.glob_index as usize + 1] != b']'
                                    {
                                        'blk: {
                                            state.glob_index += 1;

                                            let mut high: u32 =
                                                glob[state.glob_index as usize] as u32;
                                            let mut high_len: u8 = 1;
                                            if !get_unicode(
                                                &mut high,
                                                &mut high_len,
                                                glob,
                                                &mut state.glob_index,
                                            ) {
                                                return false; // Invalid pattern!
                                            }

                                            state.glob_index += u32::from(high_len);
                                            break 'blk high;
                                        }
                                    } else {
                                        low
                                    };

                                    if low <= c && c <= high {
                                        is_match = true;
                                    }

                                    first = false;
                                }

                                if state.glob_index as usize >= glob.len() {
                                    return false; // Invalid pattern!
                                }

                                state.glob_index += 1;
                                if is_match != negated {
                                    state.path_index += u32::from(len);
                                    continue 'main_loop;
                                }
                                break 'fallthrough;
                            } else {
                                break 'to_else;
                            }
                        }
                        b'{' if !EXTGLOB => {
                            for brace in brace_stack.as_slice() {
                                if brace.open_brace_idx == state.glob_index {
                                    state.glob_index = brace.branch_idx;
                                    state.brace_depth += 1;
                                    continue 'main_loop;
                                }
                            }
                            return match_brace::<WINDOWS>(
                                state,
                                glob,
                                path,
                                brace_stack,
                                brace_budget,
                            );
                        }
                        b',' | b'}' if !EXTGLOB => {
                            if state.brace_depth > 0 && skip_branch(state, glob, brace_stack) {
                                continue 'main_loop;
                            } else {
                                break 'to_else;
                            }
                        }
                        _ => break 'to_else,
                    }
                }
                if (state.path_index as usize) < path.len() {
                    let mut cc: u8 = ch;
                    if !unescape(&mut cc, glob, &mut state.glob_index) {
                        return false; // Invalid pattern!
                    }
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

fn match_brace<const WINDOWS: bool>(
    state: &mut State,
    glob: &[u8],
    path: &[u8],
    brace_stack: &mut BraceStack,
    brace_budget: &mut u32,
) -> bool {
    let mut brace_depth: i32 = 0;
    let mut in_brackets = false;

    let open_brace_index = state.glob_index;
    let close_brace_index = find_brace_end(glob, open_brace_index);

    let mut branch_index: u32 = 0;

    while (state.glob_index as usize) < glob.len() {
        match glob[state.glob_index as usize] {
            b'{' => {
                if !in_brackets {
                    brace_depth += 1;
                    if brace_depth == 1 {
                        branch_index = state.glob_index + 1;
                    }
                }
            }
            b'}' => {
                if !in_brackets {
                    brace_depth -= 1;
                    if brace_depth == 0 {
                        if match_brace_branch::<WINDOWS>(
                            state,
                            glob,
                            path,
                            open_brace_index,
                            branch_index,
                            close_brace_index,
                            brace_stack,
                            brace_budget,
                        ) {
                            return true;
                        }
                        break;
                    }
                }
            }
            b',' => {
                // A comma inside a `[...]` character class is a class member,
                // not a branch separator — same `!in_brackets` guard as the
                // `{`/`}` arms above.
                if brace_depth == 1 && !in_brackets {
                    if match_brace_branch::<WINDOWS>(
                        state,
                        glob,
                        path,
                        open_brace_index,
                        branch_index,
                        close_brace_index,
                        brace_stack,
                        brace_budget,
                    ) {
                        return true;
                    }
                    branch_index = state.glob_index + 1;
                }
            }
            b'[' => {
                if !in_brackets {
                    in_brackets = true;
                }
            }
            b']' => in_brackets = false,
            b'\\' => state.glob_index += 1,
            _ => {}
        }
        state.glob_index += 1;
    }

    false
}

fn match_brace_branch<const WINDOWS: bool>(
    state: &mut State,
    glob: &[u8],
    path: &[u8],
    open_brace_index: u32,
    branch_index: u32,
    close_brace_index: u32,
    brace_stack: &mut BraceStack,
    brace_budget: &mut u32,
) -> bool {
    if *brace_budget == 0 {
        return false;
    }
    *brace_budget -= 1;

    // exceeded brace depth
    let Ok(()) = brace_stack.push(Brace {
        open_brace_idx: open_brace_index,
        branch_idx: branch_index,
        close_brace_idx: close_brace_index,
    }) else {
        return false;
    };

    // Clone state
    let mut branch_state = *state;
    branch_state.glob_index = branch_index;
    branch_state.brace_depth = u8::try_from(brace_stack.len()).expect("int cast");

    let matched = glob_match_impl::<false, WINDOWS>(
        &mut branch_state,
        glob,
        branch_index,
        path,
        brace_stack,
        brace_budget,
        &mut Groups::default(),
        Inside::NO_GROUP,
    );

    let _ = brace_stack.pop();

    matched
}

/// Jumps `glob_index` past the `}` of the innermost stacked group that encloses
/// it; returns `false` if none does (the `,`/`}` is then a literal).
///
/// `brace_stack[brace_depth - 1]` is not that group: the stack also holds
/// already-exited sequential groups, so look up by range. Reverse iteration
/// visits inner→outer, so the first enclosing frame is the innermost.
fn skip_branch(state: &mut State, glob: &[u8], brace_stack: &BraceStack) -> bool {
    let gi = state.glob_index;
    for frame in brace_stack.as_slice().iter().rev() {
        if frame.open_brace_idx < gi && gi <= frame.close_brace_idx {
            let close = frame.close_brace_idx;
            if (close as usize) < glob.len() {
                debug_assert_eq!(glob[close as usize], b'}');
                state.glob_index = close + 1;
                state.brace_depth -= 1;
            } else {
                state.glob_index = close;
            }
            return true;
        }
    }
    false
}

/// Index of the `}` matching the `{` at `open_idx`, or `glob.len()` if unterminated.
fn find_brace_end(glob: &[u8], open_idx: u32) -> u32 {
    let mut i = open_idx as usize;
    debug_assert!(i < glob.len() && glob[i] == b'{');
    let mut depth: u32 = 0;
    let mut in_brackets = false;
    while i < glob.len() {
        match glob[i] {
            b'{' if !in_brackets => depth += 1,
            b'}' if !in_brackets => {
                depth -= 1;
                if depth == 0 {
                    return i as u32;
                }
            }
            b'[' if !in_brackets => in_brackets = true,
            b']' => in_brackets = false,
            b'\\' => i += 1,
            _ => {}
        }
        i += 1;
    }
    glob.len() as u32
}

/// How many `!` at the start of `glob` negate the result.
#[inline(always)]
pub(crate) fn negations(glob: &[u8], has_extglob: bool) -> usize {
    let bangs = glob.iter().take_while(|it| **it == b'!').count();
    // `!(a)`
    bangs - usize::from(has_extglob && bangs > 0 && glob.get(bangs) == Some(&b'('))
}

/// A piece of a pattern.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Token {
    /// One byte, which stands for itself.
    Literal,
    /// `\` and what it escapes.
    Escape,
    /// `?`
    Any,
    /// `*`
    Star,
    /// `**`, wherever it is.
    Globstar,
    /// `[ab]`
    Class,
    /// `{a,b}`, `@(a|b)`. `first`: where its first alternative starts.
    Group { first: usize },
    /// What is not closed, to the end of the pattern.
    Unknown,
}

/// The piece of `glob` that starts at `at`, and where it ends. `shape`: of `glob`.
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
        b'\\' => (Token::Escape, glob.len().min(at + 2)),
        b'?' => (Token::Any, at + 1),
        b'*' if next == Some(b'*') && !(shape.1 && glob.get(at + 2) == Some(&b'(')) => {
            (Token::Globstar, at + 2)
        }
        b'*' => (Token::Star, at + 1),
        b'[' => match class_end(glob, at) {
            Some(end) => (Token::Class, end),
            None => (Token::Unknown, glob.len()),
        },
        b'{' => group(at + 1).unwrap_or(match shape.1 {
            true => (Token::Literal, at + 1),
            false => (Token::Unknown, glob.len()),
        }),
        _ => (Token::Literal, at + 1),
    }
}

/// Where the class that starts at `open` ends.
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

/// `{a,b}`, `{1..3}` or `@(a|b)`, with `EXTGLOB`.
struct Group<'g> {
    /// `{`, `.` for `{1..3}`, or what is before the `(`.
    kind: u8,
    /// Where in [`Shape`] its first alternative is.
    first: u32,
    /// Where the `}` or the `)` is.
    close: u32,
    /// Where it is itself.
    outer: Inside<'g>,
}

/// Where in the groups a part of the pattern is matched.
#[derive(Copy, Clone)]
struct Inside<'g> {
    group: Option<&'g Group<'g>>,
    /// Where the alternative of `group` ends.
    end: u32,
    /// Nothing of the path has been taken since a group was repeated. It is not repeated again then.
    is_idle: bool,
}

impl<'g> Inside<'g> {
    const NO_GROUP: Inside<'static> = Inside {
        group: None,
        end: u32::MAX,
        is_idle: false,
    };

    /// From `index`: behind all the groups of which an alternative ends there, and where that is.
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

/// What one match with `EXTGLOB` keeps.
#[derive(Default)]
struct Groups {
    shape: Option<Shape>,
    stack: Option<StackCheck>,
    /// How often `once` has been asked.
    asked: u32,
    /// What `once` has answered, by what it was asked.
    known: Option<HashMap<u64, bool>>,
    /// The stack has run out: nothing matches.
    is_too_deep: bool,
    /// [`match_without_dot`]
    hides_dots: bool,
}

/// Whether a name of `path` starts at `index`, with a `.`.
#[inline(always)]
fn is_hidden_name_at(path: &[u8], index: u32) -> bool {
    let index = index as usize;
    path.get(index) == Some(&b'.') && (index == 0 || is_separator::<false>(path[index - 1]))
}

/// Whether a name of `glob`, or the part of it that starts at `glob_start`, starts at `index`.
#[inline(always)]
fn is_name_start(glob: &[u8], glob_start: u32, index: u32) -> bool {
    index <= glob_start || glob[index as usize - 1] == b'/'
}

impl Groups {
    /// Most patterns are through before anything is asked twice.
    const REMEMBERS_AFTER: u32 = 32;
}

/// What `ask` answers, which is asked once for a place in the pattern, a place in the path and `is_idle`.
#[inline(always)]
fn once(
    (glob_index, path_index, is_idle): (u32, u32, bool),
    groups: &mut Groups,
    ask: impl FnOnce(&mut Groups) -> bool,
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

/// Whether the pattern from `glob_index` matches the path from `path_index`.
#[inline(never)]
fn enter(
    glob: &[u8],
    (glob_index, glob_start): (u32, u32),
    path: &[u8],
    path_index: u32,
    inside: Inside<'_>,
    groups: &mut Groups,
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
    glob_match_impl::<true, false>(
        &mut state,
        glob,
        glob_start,
        path,
        &mut BraceStack::default(),
        &mut 0,
        groups,
        inside,
    )
}

impl<'g> Group<'g> {
    /// The group that starts at `index`.
    #[inline(always)]
    fn at(glob: &[u8], index: u32, outer: Inside<'g>, groups: &mut Groups) -> Option<Group<'g>> {
        let (kind, start) = match glob[index as usize] {
            b'{' => (b'{', index + 1),
            kind @ (b'?' | b'*' | b'+' | b'@' | b'!')
                if glob.get(index as usize + 1) == Some(&b'(') =>
            {
                (kind, index + 2)
            }
            _ => return None,
        };
        let shape = groups.shape.get_or_insert_with(|| Shape::of(glob, true));
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

    /// Whether what follows the group matches.
    fn rest(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups,
    ) -> bool {
        let inside = Inside {
            is_idle,
            ..self.outer
        };
        // A `**` there is not at the start of a path segment.
        let at = (self.close + 1, self.close);
        once((at.0, path_index, is_idle), groups, |groups| {
            enter(glob, at, path, path_index, inside, groups)
        })
    }

    /// Whether one of the alternatives matches, with what follows it.
    fn alternatives(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups,
    ) -> bool {
        let shape = groups.shape.as_ref();
        let start = shape
            .and_then(|it| it.0.get(self.first as usize))
            .map_or(0, |it| it.start);
        once((start, path_index, is_idle), groups, |groups| {
            let mut next = self.first as usize;
            let mut has_tried_nothing = false;
            while let Some(&it) = groups.shape.as_ref().and_then(|shape| shape.0.get(next)) {
                next = it.next as usize;
                // Most start with a character that the path does not go on with. All that are empty are one.
                let first = glob[it.start as usize];
                let is_empty = it.start == it.end;
                if (first.is_ascii_alphanumeric() || first == b'.')
                    && path.get(path_index as usize) != Some(&first)
                    || is_empty && std::mem::replace(&mut has_tried_nothing, true)
                {
                    continue;
                }
                let inside = Inside {
                    group: Some(self),
                    end: it.end,
                    is_idle,
                };
                if enter(glob, (it.start, it.start), path, path_index, inside, groups) {
                    return true;
                }
            }
            false
        })
    }

    /// At its start.
    #[inline(never)]
    fn matches(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups,
    ) -> bool {
        if self.kind == b'.' {
            return self.sequence(glob, path, path_index, is_idle, groups);
        }
        if matches!(self.kind, b'?' | b'*') && self.rest(glob, path, path_index, is_idle, groups) {
            return true;
        }
        let is_one = self.alternatives(glob, path, path_index, is_idle, groups);
        if self.kind != b'!' || is_one || groups.hides_dots && is_hidden_name_at(path, path_index) {
            return self.kind != b'!' && is_one;
        }
        let mut end = path_index;
        loop {
            if self.rest(glob, path, end, is_idle && end == path_index, groups) {
                return true;
            }
            if end as usize >= path.len() || is_separator::<false>(path[end as usize]) {
                return false;
            }
            end += u32::from(rune_len_at(path, end as usize));
        }
    }

    /// `{1..3}`, at its start.
    fn sequence(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups,
    ) -> bool {
        let shape = groups.shape.as_ref();
        let Some(sequence) = shape
            .and_then(|it| it.0.get(self.first as usize))
            .and_then(|it| Sequence::read(&glob[it.start as usize..it.end as usize]))
        else {
            return false;
        };
        let rest = &path[path_index as usize..];
        if sequence.has_nothing() && self.rest(glob, path, path_index, is_idle, groups) {
            return true;
        }
        // The longest first: `12` of `{1..20}` before `1`.
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
                && self.rest(glob, path, path_index + len as u32, false, groups)
        })
    }

    /// At the end of an alternative.
    #[inline(never)]
    fn leave(
        &self,
        glob: &[u8],
        path: &[u8],
        path_index: u32,
        is_idle: bool,
        groups: &mut Groups,
    ) -> bool {
        self.rest(glob, path, path_index, is_idle, groups)
            || matches!(self.kind, b'*' | b'+')
                && !is_idle
                && self.alternatives(glob, path, path_index, true, groups)
    }
}

/// An alternative of a group.
#[derive(Copy, Clone)]
struct Alternative {
    start: u32,
    /// Where the `,`, the `|`, the `}` or the `)` behind it is.
    end: u32,
    /// Where in [`Shape`] the next one of the group is. Behind the end: it is the last.
    next: u32,
    /// Of the first of a group: where the `}` or the `)` is. 0: the group is not closed, so it is none.
    close: u32,
}

impl Alternative {
    /// For `next`: it is `1..3` of `{1..3}`.
    const IS_SEQUENCE: u32 = u32::MAX - 1;
}

/// `1..3`, `01..10`, `9..1..2`, `a..e`: what bash makes of it between braces, one after the other.
struct Sequence {
    from: i64,
    to: i64,
    /// At least 1.
    step: i64,
    of: SequenceOf,
}

enum SequenceOf {
    Letters,
    /// `width`: how long each is at least, with zeros in front, if one of the two ends is written with a zero in front. Else 0.
    Numbers {
        width: usize,
    },
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

    /// In place of a `\\` there is nothing.
    fn has_nothing(&self) -> bool {
        matches!(self.of, SequenceOf::Letters) && self.has_value(i64::from(b'\\'))
    }

    /// Whether `text`, a letter or a number, is one of them, written as it is written then.
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

/// The alternatives of all groups of a pattern, by where they start, and whether `@(a|b)` is a group.
pub(crate) struct Shape(SmallVec<[Alternative; 8]>, bool);

impl Shape {
    /// In one pass over `glob`.
    pub(crate) fn of(glob: &[u8], has_extglob: bool) -> Shape {
        let mut found: SmallVec<[Alternative; 8]> = SmallVec::new();
        // The groups that are open: whether each is of braces, and where in `found` its first alternative is and its last so far.
        let mut open: SmallVec<[(bool, u32, u32); 8]> = SmallVec::new();
        // How many of them are of parentheses, of braces.
        let mut count = [0_usize; 2];
        let mut in_brackets = false;
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
                b']' => in_brackets = false,
                _ if in_brackets => {}
                b'[' => in_brackets = true,
                b'{' | b'('
                    if ch == b'{'
                        || has_extglob
                            && i > 0
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
                    // What is open in it and of the other kind is not closed.
                    while let Some((is_brace, first, last)) = open.pop() {
                        count[usize::from(is_brace)] -= 1;
                        if is_brace != (ch == b'}') {
                            continue;
                        }
                        found[last as usize].end = i as u32;
                        let it = &mut found[first as usize];
                        // With `EXTGLOB`, as for bash: braces around one thing are characters, unless that is `1..3`.
                        let is_one = has_extglob && is_brace && first == last;
                        if is_one && Sequence::read(&glob[it.start as usize..i]).is_some() {
                            it.next = Alternative::IS_SEQUENCE;
                        }
                        if !is_one || it.next == Alternative::IS_SEQUENCE {
                            it.close = i as u32;
                        }
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        Shape(found, has_extglob)
    }

    /// Whether the group whose first alternative starts at `start` is `{1..3}`.
    pub(crate) fn is_sequence_at(&self, start: usize) -> bool {
        let first = self.group_at(start as u32);
        first.is_some_and(|it| self.0[it as usize].next == Alternative::IS_SEQUENCE)
    }

    /// Where the first alternative is of the group whose first alternative starts at `start`.
    #[inline]
    fn group_at(&self, start: u32) -> Option<u32> {
        let at = self.0.binary_search_by_key(&start, |it| it.start).ok()?;
        (self.0[at].close > 0).then_some(at as u32)
    }
}

/// Whether `c` separates the segments of a path.
#[inline(always)]
fn is_separator<const WINDOWS: bool>(c: u8) -> bool {
    c == b'/' || WINDOWS && c == b'\\'
}

#[inline(always)]
fn unescape(c: &mut u8, glob: &[u8], glob_index: &mut u32) -> bool {
    if *c == b'\\' {
        *glob_index += 1;
        if *glob_index as usize >= glob.len() {
            return false; // Invalid pattern!
        }

        *c = match glob[*glob_index as usize] {
            b'a' => b'\x61',
            b'b' => b'\x08',
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            cc => cc,
        };
    }

    true
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
