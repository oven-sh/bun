// Portions of this file are derived from works under the MIT License:
//
// Copyright (c) 2023 Devon Govett
// Copyright (c) 2023 Stephen Gregoratto
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

const std = @import("std");
const math = std.math;
const mem = std.mem;
const expect = std.testing.expect;

// These store character indices into the glob and path strings.
path_index: usize = 0,
glob_index: usize = 0,
// When we hit a * or **, we store the state for backtracking.
wildcard: Wildcard = .{},
globstar: Wildcard = .{},

const Wildcard = struct {
    // Using u32 rather than usize for these results in 10% faster performance.
    glob_index: u32 = 0,
    path_index: u32 = 0,
};

const BraceState = enum { Invalid, Comma, EndBrace };

fn skipBraces(self: *State, glob: []const u8, stop_on_comma: bool) BraceState {
    var braces: u32 = 1;
    var in_brackets = false;
    while (self.glob_index < glob.len and braces > 0) : (self.glob_index += 1) {
        switch (glob[self.glob_index]) {
            // Skip nested braces
            '{' => if (!in_brackets) {
                braces += 1;
            },
            '}' => if (!in_brackets) {
                braces -= 1;
            },
            ',' => if (stop_on_comma and braces == 1 and !in_brackets) {
                self.glob_index += 1;
                return .Comma;
            },
            '*', '?', '[' => |c| if (!in_brackets) {
                if (c == '[')
                    in_brackets = true;
            },
            ']' => in_brackets = false,
            '\\' => self.glob_index += 1,
            else => {},
        }
    }

    if (braces != 0)
        return .Invalid;
    return .EndBrace;
}

inline fn backtrack(self: *State) void {
    self.glob_index = self.wildcard.glob_index;
    self.path_index = self.wildcard.path_index;
}

const State = @This();
const BraceStack = struct {
    stack: [10]State = undefined,
    len: u32 = 0,
    longest_brace_match: u32 = 0,

    inline fn push(self: *BraceStack, state: *const State) State {
        self.stack[self.len] = state.*;
        self.len += 1;
        return State{
            .path_index = state.path_index,
            .glob_index = state.glob_index + 1,
        };
    }

    inline fn pop(self: *BraceStack, state: *const State) State {
        self.len -= 1;
        const s = State{
            .glob_index = state.glob_index,
            .path_index = self.longest_brace_match,
            // Restore star state if needed later.
            .wildcard = self.stack[self.len].wildcard,
            .globstar = self.stack[self.len].globstar,
        };
        if (self.len == 0)
            self.longest_brace_match = 0;
        return s;
    }

    inline fn last(self: *const BraceStack) *const State {
        return &self.stack[self.len - 1];
    }
};

const BraceIndex = struct {
    start: u32 = 0,
    end: u32 = 0,
};

pub fn preprocess_glob(glob: []const u8, brace_indices: *[10]BraceIndex, brace_indices_len: *u8, search_count: *u8, i: *u32) ?u32 {
    while (i.* < glob.len) {
        const c = glob[i];
        switch (c) {
            '{' => {
                if (brace_indices_len.* == brace_indices.len) continue;
                const stack_idx = brace_indices_len.*;
                if (i == glob.len - 1) continue;
                const matching_idx = preprocess_glob(glob[i + 1 ..], brace_indices, brace_indices_len, search_count + 1);
                if (matching_idx) |idx| {
                    if (brace_indices_len.* == brace_indices.len) continue;
                    brace_indices[stack_idx].start = @intCast(i);
                    brace_indices[stack_idx].end = @as(u32, @intCast(i)) + idx + 1;
                    brace_indices_len.* += 1;
                }
            },
            '}' => {
                if (search_count > 0) return @intCast(i);
            },
            else => {},
        }
    }
    return null;
}

// pub fn preprocess_glob(glob: []const u8, brace_indices: *[10]BraceIndex, brace_indices_len: *u8, search_count_: u8) ?u32 {
//     if (glob.len == 0) return null;

//     var search_count = search_count_;
//     var i: u32 = 0;
//     while (i < glob.len): (i += 1) {
//         const c = glob[i];
//         switch (c) {
//             '{' => {
//                 if (brace_indices_len.* == brace_indices.len) continue;
//                 const stack_idx = brace_indices_len.*;
//                 if (i == glob.len - 1) continue;
//                 const matching_idx = preprocess_glob(glob[i + 1..], brace_indices, brace_indices_len, search_count + 1);
//                 if (matching_idx) |idx| {
//                     if (brace_indices_len.* == brace_indices.len) continue;
//                     brace_indices[stack_idx].start = @intCast(i);
//                     brace_indices[stack_idx].end = @as(u32, @intCast(i)) + idx + 1;
//                     brace_indices_len.* += 1;
//                 }
//             },
//             '}' => {
//                 if (search_count > 0) return @intCast(i);
//             },
//             else => {},
//         }

//     }

//     return null;
// }

pub fn valid_glob_indices(glob: []const u8, indices: std.ArrayList(BraceIndex)) !void {
    _ = indices;
    // {a,b,c}
    for (glob, 0..) |c, i| {
        _ = i;
        _ = c;
    }
}

pub const MatchResult = enum {
    no_match,
    match,

    negate_no_match,
    negate_match,

    pub fn matches(this: MatchResult) bool {
        return this == .match or this == .negate_match;
    }
};

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
pub fn match(glob: []const u8, path: []const u8) MatchResult {
    // This algorithm is based on https://research.swtch.com/glob
    var state = State{};
    // Store the state when we see an opening '{' brace in a stack.
    // Up to 10 nested braces are supported.
    var brace_stack = BraceStack{};

    // First, check if the pattern is negated with a leading '!' character.
    // Multiple negations can occur.
    var negated = false;
    while (state.glob_index < glob.len and glob[state.glob_index] == '!') {
        negated = !negated;
        state.glob_index += 1;
    }

    while (state.glob_index < glob.len or state.path_index < path.len) {
        if (state.glob_index < glob.len) {
            const gc = glob[state.glob_index];
            switch (gc) {
                '*' => {
                    const is_globstar = state.glob_index + 1 < glob.len and
                        glob[state.glob_index + 1] == '*';
                    if (is_globstar) {
                        // Coalesce multiple ** segments into one.
                        var index = state.glob_index + 2;
                        state.glob_index = skipGlobstars(glob, &index) - 2;
                    }

                    state.wildcard.glob_index = @intCast(state.glob_index);
                    state.wildcard.path_index = @intCast(state.path_index + 1);

                    // ** allows path separators, whereas * does not.
                    // However, ** must be a full path component, i.e. a/**/b not a**b.
                    if (is_globstar) {
                        state.glob_index += 2;

                        if (glob.len == state.glob_index) {
                            // A trailing ** segment without a following separator.
                            state.globstar = state.wildcard;
                        } else if (glob[state.glob_index] == '/' and
                            (state.glob_index < 3 or glob[state.glob_index - 3] == '/'))
                        {
                            // Matched a full /**/ segment. If the last character in the path was a separator,
                            // skip the separator in the glob so we search for the next character.
                            // In effect, this makes the whole segment optional so that a/**/b matches a/b.
                            if (state.path_index == 0 or
                                (state.path_index < path.len and
                                isSeparator(path[state.path_index - 1])))
                            {
                                state.glob_index += 1;
                            }

                            // The allows_sep flag allows separator characters in ** matches.
                            // one is a '/', which prevents a/**/b from matching a/bb.
                            state.globstar = state.wildcard;
                        }
                    } else {
                        state.glob_index += 1;
                    }

                    // If we are in a * segment and hit a separator,
                    // either jump back to a previous ** or end the wildcard.
                    if (state.globstar.path_index != state.wildcard.path_index and
                        state.path_index < path.len and
                        isSeparator(path[state.path_index]))
                    {
                        // Special case: don't jump back for a / at the end of the glob.
                        if (state.globstar.path_index > 0 and state.path_index + 1 < path.len) {
                            state.glob_index = state.globstar.glob_index;
                            state.wildcard.glob_index = state.globstar.glob_index;
                        } else {
                            state.wildcard.path_index = 0;
                        }
                    }

                    // If the next char is a special brace separator,
                    // skip to the end of the braces so we don't try to match it.
                    if (brace_stack.len > 0 and
                        state.glob_index < glob.len and
                        (glob[state.glob_index] == ',' or glob[state.glob_index] == '}'))
                    {
                        if (state.skipBraces(glob, false) == .Invalid)
                            return .no_match; // invalid pattern!
                    }

                    continue;
                },
                '?' => if (state.path_index < path.len) {
                    if (!isSeparator(path[state.path_index])) {
                        state.glob_index += 1;
                        state.path_index += 1;
                        continue;
                    }
                },
                '[' => if (state.path_index < path.len) {
                    state.glob_index += 1;
                    const c = path[state.path_index];

                    // Check if the character class is negated.
                    var class_negated = false;
                    if (state.glob_index < glob.len and
                        (glob[state.glob_index] == '^' or glob[state.glob_index] == '!'))
                    {
                        class_negated = true;
                        state.glob_index += 1;
                    }

                    // Try each range.
                    var first = true;
                    var is_match = false;
                    while (state.glob_index < glob.len and (first or glob[state.glob_index] != ']')) {
                        var low = glob[state.glob_index];
                        if (!unescape(&low, glob, &state.glob_index))
                            return .no_match; // Invalid pattern
                        state.glob_index += 1;

                        // If there is a - and the following character is not ],
                        // read the range end character.
                        const high = if (state.glob_index + 1 < glob.len and
                            glob[state.glob_index] == '-' and glob[state.glob_index + 1] != ']')
                        blk: {
                            state.glob_index += 1;
                            var h = glob[state.glob_index];
                            if (!unescape(&h, glob, &state.glob_index))
                                return .no_match; // Invalid pattern!
                            state.glob_index += 1;
                            break :blk h;
                        } else low;

                        if (low <= c and c <= high)
                            is_match = true;
                        first = false;
                    }
                    if (state.glob_index >= glob.len)
                        return .no_match; // Invalid pattern!
                    state.glob_index += 1;
                    if (is_match != class_negated) {
                        state.path_index += 1;
                        continue;
                    }
                },
                '{' => if (state.path_index < path.len) {
                    if (brace_stack.len >= brace_stack.stack.len)
                        return .no_match; // Invalid pattern! Too many nested braces.

                    // Push old state to the stack, and reset current state.
                    state = brace_stack.push(&state);
                    continue;
                },
                '}' => if (brace_stack.len > 0) {
                    // If we hit the end of the braces, we matched the last option.
                    brace_stack.longest_brace_match =
                        @max(brace_stack.longest_brace_match, @as(u32, @intCast(state.path_index)));
                    state.glob_index += 1;
                    state = brace_stack.pop(&state);
                    continue;
                },
                ',' => if (brace_stack.len > 0) {
                    // If we hit a comma, we matched one of the options!
                    // But we still need to check the others in case there is a longer match.
                    brace_stack.longest_brace_match =
                        @max(brace_stack.longest_brace_match, @as(u32, @intCast(state.path_index)));
                    state.path_index = brace_stack.last().path_index;
                    state.glob_index += 1;
                    state.wildcard = Wildcard{};
                    state.globstar = Wildcard{};
                    continue;
                },
                else => |c| if (state.path_index < path.len) {
                    var cc = c;
                    // Match escaped characters as literals.
                    if (!unescape(&cc, glob, &state.glob_index))
                        return .no_match; // Invalid pattern;

                    const is_match = if (cc == '/')
                        isSeparator(path[state.path_index])
                    else
                        path[state.path_index] == cc;

                    if (is_match) {
                        if (brace_stack.len > 0 and
                            state.glob_index > 0 and
                            glob[state.glob_index - 1] == '}')
                        {
                            brace_stack.longest_brace_match = @intCast(state.path_index);
                            state = brace_stack.pop(&state);
                        }
                        state.glob_index += 1;
                        state.path_index += 1;

                        // If this is not a separator, lock in the previous globstar.
                        if (cc != '/')
                            state.globstar.path_index = 0;

                        continue;
                    }
                },
            }
        }
        // If we didn't match, restore state to the previous star pattern.
        if (state.wildcard.path_index > 0 and state.wildcard.path_index <= path.len) {
            state.backtrack();
            continue;
        }

        if (brace_stack.len > 0) {
            // If in braces, find next option and reset path to index where we saw the '{'
            switch (state.skipBraces(glob, true)) {
                .Invalid => return .no_match,
                .Comma => {
                    state.path_index = brace_stack.last().path_index;
                    continue;
                },
                .EndBrace => {},
            }

            // Hit the end. Pop the stack.
            // If we matched a previous option, use that.
            if (brace_stack.longest_brace_match > 0) {
                state = brace_stack.pop(&state);
                continue;
            } else {
                // Didn't match. Restore state, and check if we need to jump back to a star pattern.
                state = brace_stack.last().*;
                brace_stack.len -= 1;
                if (state.wildcard.path_index > 0 and state.wildcard.path_index <= path.len) {
                    state.backtrack();
                    continue;
                }
            }
        }

        return if (negated) .negate_match else .no_match;
    }

    return if (!negated) .match else .negate_no_match;
}

inline fn isSeparator(c: u8) bool {
    if (comptime @import("builtin").os.tag == .windows) return c == '/' or c == '\\';
    return c == '/';
}

inline fn unescape(c: *u8, glob: []const u8, glob_index: *usize) bool {
    if (c.* == '\\') {
        glob_index.* += 1;
        if (glob_index.* >= glob.len)
            return false; // Invalid pattern!

        c.* = switch (glob[glob_index.*]) {
            'a' => '\x61',
            'b' => '\x08',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            else => |cc| cc,
        };
    }

    return true;
}

inline fn skipGlobstars(glob: []const u8, glob_index: *usize) usize {
    // Coalesce multiple ** segments into one.
    while (glob_index.* + 3 <= glob.len and
        std.mem.eql(u8, glob[glob_index.*..][0..3], "/**"))
    {
        glob_index.* += 3;
    }

    return glob_index.*;
}

/// Returns true if the given string contains glob syntax,
/// excluding those escaped with backslashes
/// TODO: this doesn't play nicely with Windows directory separator and
/// backslashing, should we just require the user to supply posix filepaths?
pub fn detectGlobSyntax(potential_pattern: []const u8) bool {
    // Negation only allowed in the beginning of the pattern
    if (potential_pattern.len > 0 and potential_pattern[0] == '!') return true;

    // In descending order of how popular the token is
    const SPECIAL_SYNTAX: [4]u8 = comptime [_]u8{ '*', '{', '[', '?' };

    inline for (SPECIAL_SYNTAX) |token| {
        var slice = potential_pattern[0..];
        while (slice.len > 0) {
            if (std.mem.indexOfScalar(u8, slice, token)) |idx| {
                // Check for even number of backslashes preceding the
                // token to know that it's not escaped
                var i = idx;
                var backslash_count: u16 = 0;

                while (i > 0 and potential_pattern[i - 1] == '\\') : (i -= 1) {
                    backslash_count += 1;
                }

                if (backslash_count % 2 == 0) return true;
                slice = slice[idx + 1 ..];
            } else break;
        }
    }

    return false;
}
