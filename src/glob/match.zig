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

const std = @import("std");
const bun = @import("bun");

const Allocator = std.mem.Allocator;

/// used in matchBrace to determine the size of the stack buffer used in the stack fallback allocator
/// that is created for handling braces
/// One such stack buffer is created recursively for each pair of braces
/// therefore this value should be tuned to use a sane amount of memory even at the highest allowed brace depth
/// and for arbitrarily many non-nested braces (i.e. `{a,b}{c,d}`) while reducing the number of allocations.
const Brace = struct {
    open_brace_idx: u32,
    branch_idx: u32,
};
const BraceStack = std.BoundedArray(Brace, 10);

pub const MatchResult = enum {
    no_match,
    match,

    negate_no_match,
    negate_match,

    pub fn matches(this: MatchResult) bool {
        return this == .match or this == .negate_match;
    }
};

const State = struct {
    path_index: u32 = 0,
    glob_index: u32 = 0,

    wildcard: Wildcard = .{},
    globstar: Wildcard = .{},

    brace_depth: u8 = 0,

    inline fn backtrack(self: *State) void {
        self.path_index = self.wildcard.path_index;
        self.glob_index = self.wildcard.glob_index;
        self.brace_depth = self.wildcard.brace_depth;
    }

    inline fn skipToSeparator(self: *State, path: []const u8, is_end_invalid: bool) void {
        if (self.path_index == path.len) {
            self.wildcard.path_index += 1;
            return;
        }

        var path_index = self.path_index;
        while (path_index < path.len and !isSeparator(path[path_index])) {
            path_index += 1;
        }

        if (is_end_invalid or path_index != path.len) {
            path_index += 1;
        }

        self.wildcard.path_index = path_index;
        self.globstar = self.wildcard;
    }
};

const Wildcard = struct {
    // Using u32 rather than usize for these results in 10% faster performance.
    glob_index: u32 = 0,
    path_index: u32 = 0,
    brace_depth: u8 = 0,
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
// TODO: consider just taking arena and resetting to initial state,
// all usages of this function pass in Arena.allocator()
pub fn match(_: Allocator, glob: []const u8, path: []const u8) MatchResult {
    var state = State{};

    var negated = false;
    while (state.glob_index < glob.len and glob[state.glob_index] == '!') {
        negated = !negated;
        state.glob_index += 1;
    }

    var brace_stack = BraceStack.init(0) catch unreachable;
    const matched = globMatchImpl(&state, glob, 0, path, &brace_stack);

    // TODO: consider just returning a bool
    // return matched != negated;
    if (negated) {
        // FIXME(@DonIsaac): This looks backwards to me
        return if (matched) .negate_no_match else .negate_match;
    } else {
        return if (matched) .match else .no_match;
    }
}

// `glob_start` is the index where the glob pattern starts
inline fn globMatchImpl(state: *State, glob: []const u8, glob_start: u32, path: []const u8, brace_stack: *BraceStack) bool {
    main_loop: while (state.glob_index < glob.len or state.path_index < path.len) {
        if (state.glob_index < glob.len) fallthrough: {
            const char = glob[state.glob_index];
            to_else: {
                switch (char) {
                    '*' => {
                        const is_globstar =
                            state.glob_index + 1 < glob.len and glob[state.glob_index + 1] == '*';
                        if (is_globstar) {
                            skipGlobstars(glob, &state.glob_index);
                        }

                        state.wildcard.glob_index = state.glob_index;
                        state.wildcard.path_index = state.path_index + if (state.path_index < path.len) bun.strings.wtf8ByteSequenceLength(path[state.path_index]) else 1;
                        state.wildcard.brace_depth = state.brace_depth;

                        var in_globstar = false;
                        if (is_globstar) {
                            state.glob_index += 2;

                            const is_end_invalid = state.glob_index < glob.len;

                            // FIXME: explain this bug fix
                            if (is_end_invalid and state.path_index == path.len and glob.len - state.glob_index == 2 and isSeparator(glob[state.glob_index]) and glob[state.glob_index + 1] == '*') {
                                continue;
                            }

                            // subtract glob_start from glob index before checking if length is less than 3. Given the pattern:
                            // {**/a,**/b}
                            // if we start at index 6 (start of **/b pattern), we don't want to index into the pattern before it
                            if ((state.glob_index -| glob_start < 3 or glob[state.glob_index - 3] == '/') and (!is_end_invalid or glob[state.glob_index] == '/')) {
                                if (is_end_invalid) {
                                    state.glob_index += 1;
                                }

                                // skip to separator
                                state.skipToSeparator(path, is_end_invalid);
                                in_globstar = true;
                            }
                        } else {
                            state.glob_index += 1;
                        }

                        if (!in_globstar and state.path_index < path.len and isSeparator(path[state.path_index])) {
                            state.wildcard = state.globstar;
                        }

                        continue;
                    },
                    '?' => if (state.path_index < path.len) {
                        if (!isSeparator(path[state.path_index])) {
                            state.glob_index += 1;
                            state.path_index += bun.strings.wtf8ByteSequenceLength(path[state.path_index]);
                            continue;
                        }
                        break :fallthrough;
                    } else break :to_else,
                    '[' => if (state.path_index < path.len) {
                        state.glob_index += 1;

                        var negated = false;
                        if (state.glob_index < glob.len and (glob[state.glob_index] == '^' or glob[state.glob_index] == '!')) {
                            negated = true;
                            state.glob_index += 1;
                        }

                        var first = true;
                        var is_match = false;

                        // length of the unicode char in the path
                        const len = bun.strings.wtf8ByteSequenceLength(path[state.path_index]);
                        // source unicode char to match against the target
                        const c = bun.strings.decodeWTF8RuneT(path[state.path_index..].ptr[0..4], len, u32, 0xFFFD);

                        while (state.glob_index < glob.len and (first or glob[state.glob_index] != ']')) {
                            // Get low ( ͡° ͜ʖ ͡°), and unescape it
                            var low: u32 = glob[state.glob_index];
                            var low_len: u8 = 1;
                            if (!getUnicode(&low, &low_len, glob, &state.glob_index)) {
                                return false; // Invalid pattern!
                            }

                            // skip past the target char
                            state.glob_index += low_len;

                            const high = if (state.glob_index + 1 < glob.len and glob[state.glob_index] == '-' and glob[state.glob_index + 1] != ']') blk: {
                                state.glob_index += 1;

                                var high: u32 = glob[state.glob_index];
                                var high_len: u8 = 1;
                                if (!getUnicode(&high, &high_len, glob, &state.glob_index)) {
                                    return false; // Invalid pattern!
                                }

                                state.glob_index += high_len;
                                break :blk high;
                            } else low;

                            if (low <= c and c <= high) {
                                is_match = true;
                            }

                            first = false;
                        }

                        if (state.glob_index >= glob.len) {
                            return false; // Invalid pattern!
                        }

                        state.glob_index += 1;
                        if (is_match != negated) {
                            state.path_index += len;
                            continue;
                        }
                        break :fallthrough;
                    } else break :to_else,
                    '{' => {
                        for (brace_stack.slice()) |brace| {
                            if (brace.open_brace_idx == state.glob_index) {
                                state.glob_index = brace.branch_idx;
                                state.brace_depth += 1;
                                continue :main_loop;
                            }
                        }
                        return matchBrace(state, glob, path, brace_stack);
                    },
                    ',' => if (state.brace_depth > 0) {
                        skipBranch(state, glob);
                        continue;
                    } else break :to_else,
                    '}' => if (state.brace_depth > 0) {
                        skipBranch(state, glob);
                        continue;
                    } else break :to_else,
                    else => break :to_else,
                }
            }
            if (state.path_index < path.len) {
                var cc: u8 = char;
                if (!unescape(&cc, glob, &state.glob_index)) {
                    return false; // Invalid pattern!
                }
                const cc_len = bun.strings.wtf8ByteSequenceLength(cc);

                const is_match = if (cc == '/')
                    isSeparator(path[state.path_index])
                else if (cc_len > 1)
                    state.path_index + cc_len <= path.len and std.mem.eql(u8, path[state.path_index..][0..cc_len], glob[state.glob_index..][0..cc_len])
                else
                    path[state.path_index] == cc;

                if (is_match) {
                    state.glob_index += cc_len;
                    state.path_index += cc_len;

                    if (cc == '/') {
                        state.wildcard = state.globstar;
                    }

                    continue;
                }
            }
        }

        if (state.wildcard.path_index > 0 and state.wildcard.path_index <= path.len) {
            state.backtrack();
            continue;
        }

        return false;
    }

    return true;
}

fn matchBrace(state: *State, glob: []const u8, path: []const u8, brace_stack: *BraceStack) bool {
    var brace_depth: i16 = 0;
    var in_brackets = false;

    const open_brace_index = state.glob_index;

    var branch_index: u32 = 0;

    while (state.glob_index < glob.len) {
        switch (glob[state.glob_index]) {
            '{' => if (!in_brackets) {
                brace_depth += 1;
                if (brace_depth == 1) {
                    branch_index = state.glob_index + 1;
                }
            },
            '}' => if (!in_brackets) {
                brace_depth -= 1;
                if (brace_depth == 0) {
                    if (matchBraceBranch(state, glob, path, open_brace_index, branch_index, brace_stack)) {
                        return true;
                    }
                    break;
                }
            },
            ',' => if (brace_depth == 1) {
                if (matchBraceBranch(state, glob, path, open_brace_index, branch_index, brace_stack)) {
                    return true;
                }
                branch_index = state.glob_index + 1;
            },
            '[' => if (!in_brackets) {
                in_brackets = true;
            },
            ']' => in_brackets = false,
            '\\' => state.glob_index += 1,
            else => {},
        }
        state.glob_index += 1;
    }

    return false;
}

fn matchBraceBranch(state: *State, glob: []const u8, path: []const u8, open_brace_index: u32, branch_index: u32, brace_stack: *BraceStack) bool {
    brace_stack.append(Brace{ .open_brace_idx = open_brace_index, .branch_idx = branch_index }) catch
        return false; // exceeded brace depth

    // Clone state
    var branch_state = state.*;
    branch_state.glob_index = branch_index;
    branch_state.brace_depth = @intCast(brace_stack.len);

    const matched = globMatchImpl(&branch_state, glob, branch_index, path, brace_stack);

    _ = brace_stack.pop();

    return matched;
}

fn skipBranch(state: *State, glob: []const u8) void {
    var in_brackets = false;
    const end_brace_depth = state.brace_depth - 1;
    while (state.glob_index < glob.len) {
        switch (glob[state.glob_index]) {
            '{' => if (!in_brackets) {
                state.brace_depth += 1;
            },
            '}' => if (!in_brackets) {
                state.brace_depth -= 1;
                if (state.brace_depth == end_brace_depth) {
                    state.glob_index += 1;
                    return;
                }
            },
            '[' => if (!in_brackets) {
                in_brackets = true;
            },
            ']' => in_brackets = false,
            '\\' => state.glob_index += 1,
            else => {},
        }
        state.glob_index += 1;
    }
}

inline fn isSeparator(c: u8) bool {
    if (comptime @import("builtin").os.tag == .windows) return c == '/' or c == '\\';
    return c == '/';
}

inline fn unescape(c: *u8, glob: []const u8, glob_index: *u32) bool {
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

/// Unescapes the character if needed
///
/// Then decodes and returns the character
///
/// `c` must point to a u32 initialized to `glob[glob_index]`
/// `clen` must point to a u8 initialized to 1
inline fn getUnicode(c: *u32, clen: *u8, glob: []const u8, glob_index: *u32) bool {
    bun.debugAssert(clen.* == 1);
    switch (c.*) {
        // ascii range excluding backslash
        0x0...('\\' - 1), '\\' + 1...0x7F => {
            return true;
        },
        '\\' => {
            glob_index.* += 1;
            if (glob_index.* >= glob.len)
                return false; // Invalid pattern!

            c.* = switch (glob[glob_index.*]) {
                'a' => '\x61',
                'b' => '\x08',
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                else => |cc| brk: {
                    const len = bun.strings.wtf8ByteSequenceLength(cc);
                    clen.* = len;
                    if (len == 1) {
                        break :brk cc;
                    }

                    break :brk bun.strings.decodeWTF8RuneT(glob[glob_index.*..].ptr[0..4], len, u32, 0xFFFD);
                },
            };
        },
        // multi-byte sequences
        else => {
            const len = bun.strings.wtf8ByteSequenceLength(@truncate(c.*));
            clen.* = len;

            c.* = bun.strings.decodeWTF8RuneT(glob[glob_index.*..].ptr[0..4], len, u32, 0xFFFD);
        },
    }

    return true;
}

inline fn skipGlobstars(glob: []const u8, glob_index: *u32) void {
    glob_index.* += 2;

    while (glob_index.* + 4 <= glob.len and std.mem.eql(u8, glob[glob_index.*..][0..4], "/**/")) {
        glob_index.* += 3;
    }

    if (glob_index.* + 3 == glob.len and std.mem.eql(u8, glob[glob_index.*..][0..3], "/**")) {
        glob_index.* += 3;
    }

    glob_index.* -= 2;
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

const BraceIndex = struct {
    start: u32 = 0,
    end: u32 = 0,
};
