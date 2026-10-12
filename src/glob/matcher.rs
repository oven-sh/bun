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
    fn skip_to_separator(&mut self, path: &[u8], is_end_invalid: bool) {
        if self.path_index as usize == path.len() {
            self.wildcard.path_index += 1;
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
    match_with::<false>(glob, path)
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
///
/// Any syntax can be used between the parentheses. Groups, braces among them,
/// can be nested to any depth and there can be any number of them.
///
/// Where an alternative starts and where a group has ended, the rest of the
/// pattern is matched once for a position in the path. With `k` of `(`, `|`,
/// `)`, `{`, `,`, `}` that takes `O(k * glob.len() * path.len()^2)` time.
pub fn match_with<const EXTGLOB: bool>(glob: &[u8], path: &[u8]) -> MatchResult {
    let mut state = State {
        glob_index: negations(glob, EXTGLOB) as u32,
        ..State::default()
    };
    let negated = state.glob_index % 2 == 1;

    let mut brace_stack = BraceStack::default();
    let mut brace_budget = BRACE_BRANCH_BUDGET;
    let mut groups = Groups::default();
    // glob_start must point past the consumed `!` prefix so that a pattern-initial
    // `**` is still recognized as being at the start of a path segment.
    let glob_start = state.glob_index;
    let matched = glob_match_impl::<EXTGLOB>(
        &mut state,
        glob,
        glob_start,
        path,
        &mut brace_stack,
        &mut brace_budget,
        &mut groups,
        Inside::default(),
    ) && !groups.is_too_deep;

    MatchResult {
        matches: matched != negated,
        negated,
    }
}

// `glob_start` is the index where the glob pattern starts
#[inline(always)]
// PERF: `inline(always)` on a fn that recurses through match_brace_branch — profile if hot.
fn glob_match_impl<const EXTGLOB: bool>(
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
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                if EXTGLOB {
                    let is_idle = inside.is_idle && state.path_index == entered_at;
                    if let Some(group) = inside.group
                        && group.is_end_of_alternative(ch)
                    {
                        if group.leave(glob, path, state.path_index, is_idle, groups) {
                            return true;
                        }
                        break 'fallthrough;
                    }
                    if let Some(group) = Group::at(glob, state.glob_index, inside.group) {
                        if group.matches(glob, path, state.path_index, is_idle, groups) {
                            return true;
                        }
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

                                let is_end_invalid = (state.glob_index as usize) < glob.len()
                                    && !(EXTGLOB
                                        && inside.group.is_some_and(|it| {
                                            it.is_at_end_of_pattern(glob, state.glob_index)
                                        }));

                                // FIXME: explain this bug fix
                                if is_end_invalid
                                    && state.path_index as usize == path.len()
                                    && glob.len() - state.glob_index as usize == 2
                                    && is_separator(glob[state.glob_index as usize])
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
                                    state.skip_to_separator(path, is_end_invalid);
                                    in_globstar = true;
                                }
                            } else {
                                state.glob_index += 1;
                            }

                            if !in_globstar
                                && (state.path_index as usize) < path.len()
                                && is_separator(path[state.path_index as usize])
                            {
                                state.wildcard = state.globstar;
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
                            return match_brace(state, glob, path, brace_stack, brace_budget);
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

        if state.wildcard.path_index > 0 && state.wildcard.path_index as usize <= path.len() {
            state.backtrack();
            continue;
        }

        return false;
    }

    true
}

fn match_brace(
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
                        if match_brace_branch(
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
                    if match_brace_branch(
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

fn match_brace_branch(
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

    let matched = glob_match_impl::<false>(
        &mut branch_state,
        glob,
        branch_index,
        path,
        brace_stack,
        brace_budget,
        &mut Groups::default(),
        Inside::default(),
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

/// The piece of `glob` that starts at `at`, outside of a group, and where it ends.
pub(crate) fn token_at(glob: &[u8], at: usize, has_extglob: bool) -> (Token, usize) {
    let next = glob.get(at + 1).copied();
    let group = |first: usize, is_brace: bool| {
        let close = scan_group(glob, first as u32, glob.len() as u32, is_brace, false)?;
        Some((Token::Group { first }, close as usize + 1))
    };
    match glob[at] {
        b'?' | b'*' | b'+' | b'@' | b'!' if has_extglob && next == Some(b'(') => {
            if let Some(group) = group(at + 2, false) {
                return group;
            }
        }
        _ => {}
    }
    match glob[at] {
        b'\\' => (Token::Escape, glob.len().min(at + 2)),
        b'?' => (Token::Any, at + 1),
        b'*' if next == Some(b'*') && !(has_extglob && glob.get(at + 2) == Some(&b'(')) => {
            (Token::Globstar, at + 2)
        }
        b'*' => (Token::Star, at + 1),
        b'[' => match class_end(glob, at) {
            Some(end) => (Token::Class, end),
            None => (Token::Unknown, glob.len()),
        },
        b'{' if has_extglob => group(at + 1, true).unwrap_or((Token::Literal, at + 1)),
        b'{' => match find_brace_end(glob, at as u32) as usize {
            close if close < glob.len() => (Token::Group { first: at + 1 }, close + 1),
            _ => (Token::Unknown, glob.len()),
        },
        _ => (Token::Literal, at + 1),
    }
}

/// Where the class that starts at `open` ends.
fn class_end(glob: &[u8], open: usize) -> Option<usize> {
    let mut at = open + 1;
    at += usize::from(matches!(glob.get(at), Some(b'^' | b'!')));
    let character = |at: usize| {
        let at = at + usize::from(glob.get(at) == Some(&b'\\'));
        Some(at + usize::from(rune_len_at(glob.get(at..)?, 0)))
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

/// `{a,b}` or `@(a|b)`, with `EXTGLOB`.
struct Group<'g> {
    /// `{`, or what is before the `(`.
    kind: u8,
    /// Where the first alternative starts.
    first: u32,
    /// Where the `}` or the `)` is.
    close: u32,
    parent: Option<&'g Group<'g>>,
}

/// Where in the groups a part of the pattern is matched.
#[derive(Copy, Clone, Default)]
struct Inside<'g> {
    group: Option<&'g Group<'g>>,
    /// Nothing of the path has been taken since a group was repeated. It is not repeated again then.
    is_idle: bool,
}

/// What one match with `EXTGLOB` keeps.
#[derive(Default)]
struct Groups {
    stack: Option<StackCheck>,
    /// How often `enter` has run.
    entered: u32,
    /// What `enter` returned, by what it was asked.
    known: HashMap<u64, bool>,
    /// The stack has run out: nothing matches.
    is_too_deep: bool,
}

impl Groups {
    /// Most patterns are through before anything is asked twice.
    const REMEMBERS_AFTER: u32 = 32;
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
    let key = u64::from(glob_index) << 33 | u64::from(path_index) << 1 | u64::from(inside.is_idle);
    groups.entered = groups.entered.saturating_add(1);
    let remembers = groups.entered > Groups::REMEMBERS_AFTER;
    if remembers && let Some(known) = groups.known.get(&key) {
        return *known;
    }
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
    let matched = glob_match_impl::<true>(
        &mut state,
        glob,
        glob_start,
        path,
        &mut BraceStack::default(),
        &mut 0,
        groups,
        inside,
    );
    if remembers {
        groups.known.insert(key, matched);
    }
    matched
}

impl<'g> Group<'g> {
    /// The group that starts at `index`. One that is not closed inside of `parent` is none.
    #[inline(always)]
    fn at(glob: &[u8], index: u32, parent: Option<&'g Group<'g>>) -> Option<Group<'g>> {
        let (kind, first) = match glob[index as usize] {
            b'{' => (b'{', index + 1),
            kind @ (b'?' | b'*' | b'+' | b'@' | b'!')
                if glob.get(index as usize + 1) == Some(&b'(') =>
            {
                (kind, index + 2)
            }
            _ => return None,
        };
        let limit = parent.map_or(glob.len() as u32, |it| it.close);
        Some(Group {
            kind,
            first,
            close: scan_group(glob, first, limit, kind == b'{', false)?,
            parent,
        })
    }

    #[inline(always)]
    fn is_end_of_alternative(&self, ch: u8) -> bool {
        match self.kind {
            b'{' => matches!(ch, b',' | b'}'),
            _ => matches!(ch, b'|' | b')'),
        }
    }

    /// Whether an alternative ends at `index`, and the pattern with it: `**` in `{a,b/**}`.
    fn is_at_end_of_pattern(&self, glob: &[u8], mut index: u32) -> bool {
        let mut group = Some(self);
        while let Some(&ch) = glob.get(index as usize) {
            match group {
                Some(it) if it.is_end_of_alternative(ch) => {
                    index = it.close + 1;
                    group = it.parent;
                }
                _ => return false,
            }
        }
        true
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
            group: self.parent,
            is_idle,
        };
        // A `**` there is not at the start of a path segment.
        let at = (self.close + 1, self.close);
        enter(glob, at, path, path_index, inside, groups)
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
        let inside = Inside {
            group: Some(self),
            is_idle,
        };
        let mut start = self.first;
        loop {
            if enter(glob, (start, start), path, path_index, inside, groups) {
                return true;
            }
            match scan_group(glob, start, self.close, self.kind == b'{', true) {
                Some(separator) => start = separator + 1,
                None => return false,
            }
        }
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
        if matches!(self.kind, b'?' | b'*') && self.rest(glob, path, path_index, is_idle, groups) {
            return true;
        }
        let is_one = self.alternatives(glob, path, path_index, is_idle, groups);
        if self.kind != b'!' || is_one {
            return self.kind != b'!' && is_one;
        }
        let mut end = path_index;
        loop {
            if self.rest(glob, path, end, is_idle && end == path_index, groups) {
                return true;
            }
            if end as usize >= path.len() || is_separator(path[end as usize]) {
                return false;
            }
            end += u32::from(rune_len_at(path, end as usize));
        }
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

/// Where the group that `from` is in closes, or with `to_separator` where the alternative ends, if that is before `limit`.
fn scan_group(
    glob: &[u8],
    from: u32,
    limit: u32,
    is_brace: bool,
    to_separator: bool,
) -> Option<u32> {
    // The groups in it that are open: whether each is of braces. And how many are of parentheses, of braces.
    let mut open: SmallVec<[bool; 16]> = SmallVec::new();
    let mut count = [0_usize; 2];
    let mut in_brackets = false;
    let mut escaped = usize::MAX;
    let mut i = from as usize;
    while i < limit as usize {
        let ch = glob[i];
        match ch {
            b'\\' => {
                i += 1;
                escaped = i;
            }
            b']' => in_brackets = false,
            _ if in_brackets => {}
            b'[' => in_brackets = true,
            b'{' => {
                open.push(true);
                count[1] += 1;
            }
            b'(' if escaped != i - 1 && matches!(glob[i - 1], b'?' | b'*' | b'+' | b'@' | b'!') => {
                open.push(false);
                count[0] += 1;
            }
            b'}' | b')' => {
                let closes_brace = ch == b'}';
                if count[usize::from(closes_brace)] > 0 {
                    // What is open in it and of the other kind is not closed, so it is no group.
                    while let Some(kind) = open.pop() {
                        count[usize::from(kind)] -= 1;
                        if kind == closes_brace {
                            break;
                        }
                    }
                } else if closes_brace == is_brace {
                    return Some(i as u32);
                }
            }
            b',' | b'|' if to_separator && open.is_empty() && (ch == b',') == is_brace => {
                return Some(i as u32);
            }
            _ => {}
        }
        i += 1;
    }
    None
}

use bun_paths::is_sep_native as is_separator;

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
