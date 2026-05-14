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

use bun_collections::BoundedArray;
use bun_core::strings;

/// used in matchBrace to determine the size of the stack buffer used in the stack fallback allocator
/// that is created for handling braces
/// One such stack buffer is created recursively for each pair of braces
/// therefore this value should be tuned to use a sane amount of memory even at the highest allowed brace depth
/// and for arbitrarily many non-nested braces (i.e. `{a,b}{c,d}`) while reducing the number of allocations.
#[derive(Copy, Clone)]
struct Brace {
    open_brace_idx: u32,
    branch_idx: u32,
}
type BraceStack = BoundedArray<Brace, 10>;

// PORT NOTE: made `pub` — Zig leaks this private type through `pub fn match`; Rust forbids private-in-public.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum MatchResult {
    NoMatch,
    Match,

    NegateNoMatch,
    NegateMatch,
}

impl MatchResult {
    pub fn matches(self) -> bool {
        self == MatchResult::Match || self == MatchResult::NegateMatch
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
    let mut state = State::default();

    let mut negated = false;
    while (state.glob_index as usize) < glob.len() && glob[state.glob_index as usize] == b'!' {
        negated = !negated;
        state.glob_index += 1;
    }

    // PORT NOTE: `BraceStack.init(0) catch unreachable` — zero-length init cannot fail.
    let mut brace_stack = BraceStack::default();
    let matched = glob_match_impl(&mut state, glob, 0, path, &mut brace_stack);

    // TODO: consider just returning a bool
    // return matched != negated;
    if negated {
        // FIXME(@DonIsaac): This looks backwards to me
        if matched {
            MatchResult::NegateNoMatch
        } else {
            MatchResult::NegateMatch
        }
    } else {
        if matched {
            MatchResult::Match
        } else {
            MatchResult::NoMatch
        }
    }
}

// `glob_start` is the index where the glob pattern starts
#[inline(always)]
// PERF(port): Zig `inline fn` on a fn that recurses through match_brace_branch — profile in Phase B
fn glob_match_impl(
    state: &mut State,
    glob: &[u8],
    glob_start: u32,
    path: &[u8],
    brace_stack: &mut BraceStack,
) -> bool {
    'main_loop: while (state.glob_index as usize) < glob.len()
        || (state.path_index as usize) < path.len()
    {
        if (state.glob_index as usize) < glob.len() {
            'fallthrough: {
                let ch = glob[state.glob_index as usize];
                'to_else: {
                    match ch {
                        b'*' => {
                            let is_globstar = (state.glob_index as usize) + 1 < glob.len()
                                && glob[state.glob_index as usize + 1] == b'*';
                            if is_globstar {
                                skip_globstars(glob, &mut state.glob_index);
                            }

                            state.wildcard.glob_index = state.glob_index;
                            state.wildcard.path_index = state.path_index
                                + if (state.path_index as usize) < path.len() {
                                    u32::from(strings::wtf8_byte_sequence_length(
                                        path[state.path_index as usize],
                                    ))
                                } else {
                                    1
                                };
                            state.wildcard.brace_depth = state.brace_depth;

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
                                        u32::from(strings::wtf8_byte_sequence_length(
                                            path[state.path_index as usize],
                                        ));
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
                                let (c, len) = decode_wtf8_rune_at(path, state.path_index as usize);

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
                        b'{' => {
                            for brace in brace_stack.as_slice() {
                                if brace.open_brace_idx == state.glob_index {
                                    state.glob_index = brace.branch_idx;
                                    state.brace_depth += 1;
                                    continue 'main_loop;
                                }
                            }
                            return match_brace(state, glob, path, brace_stack);
                        }
                        b',' => {
                            if state.brace_depth > 0 {
                                skip_branch(state, glob);
                                continue 'main_loop;
                            } else {
                                break 'to_else;
                            }
                        }
                        b'}' => {
                            if state.brace_depth > 0 {
                                skip_branch(state, glob);
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
                        pi + n <= path.len() && path[pi..pi + n] == glob[gi..gi + n]
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

fn match_brace(state: &mut State, glob: &[u8], path: &[u8], brace_stack: &mut BraceStack) -> bool {
    let mut brace_depth: i16 = 0;
    let mut in_brackets = false;

    let open_brace_index = state.glob_index;

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
                            brace_stack,
                        ) {
                            return true;
                        }
                        break;
                    }
                }
            }
            b',' => {
                if brace_depth == 1 {
                    if match_brace_branch(
                        state,
                        glob,
                        path,
                        open_brace_index,
                        branch_index,
                        brace_stack,
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
    brace_stack: &mut BraceStack,
) -> bool {
    // exceeded brace depth
    let Ok(()) = brace_stack.push(Brace {
        open_brace_idx: open_brace_index,
        branch_idx: branch_index,
    }) else {
        return false;
    };

    // Clone state
    let mut branch_state = *state;
    branch_state.glob_index = branch_index;
    branch_state.brace_depth = u8::try_from(brace_stack.len()).expect("int cast");

    let matched = glob_match_impl(&mut branch_state, glob, branch_index, path, brace_stack);

    let _ = brace_stack.pop();

    matched
}

fn skip_branch(state: &mut State, glob: &[u8]) {
    let mut in_brackets = false;
    let end_brace_depth = state.brace_depth - 1;
    while (state.glob_index as usize) < glob.len() {
        match glob[state.glob_index as usize] {
            b'{' => {
                if !in_brackets {
                    state.brace_depth += 1;
                }
            }
            b'}' => {
                if !in_brackets {
                    state.brace_depth -= 1;
                    if state.brace_depth == end_brace_depth {
                        state.glob_index += 1;
                        return;
                    }
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

/// Decodes the WTF-8 codepoint at `bytes[idx]`, returning `(codepoint, byte_len)`.
///
/// Mirrors the open-coded triple in matcher.zig (`wtf8ByteSequenceLength` + `decodeWTF8RuneT`).
#[inline(always)]
fn decode_wtf8_rune_at(bytes: &[u8], idx: usize) -> (u32, u8) {
    let len = strings::wtf8_byte_sequence_length(bytes[idx]);
    let mut buf = [0u8; 4];
    let n = (bytes.len() - idx).min(4);
    buf[..n].copy_from_slice(&bytes[idx..idx + n]);
    let cp = strings::decode_wtf8_rune_t::<u32>(&buf, len, 0xFFFD);
    (cp, len)
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
        // ascii range excluding backslash
        // PORT NOTE: Zig `0x0...('\\'-1), '\\'+1...0x7F` — 0x5C is '\\'
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
                    let (cp, len) = decode_wtf8_rune_at(glob, *glob_index as usize);
                    *clen = len;
                    break 'brk cp;
                }
            };
        }
        // multi-byte sequences
        _ => {
            let (cp, len) = decode_wtf8_rune_at(glob, *glob_index as usize);
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

#[derive(Copy, Clone, Default)]
struct BraceIndex {
    start: u32,
    end: u32,
}

// ported from: src/glob/matcher.zig
