//! From: https://github.com/The-King-of-Toasters/globlin

const std = @import("std");
const math = std.math;
const mem = std.mem;
const bun = @import("root").bun;
const BunString = @import("./bun.zig").String;
const expect = std.testing.expect;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;
const ArrayListManaged = std.ArrayList;
const CodepointIter = @import("./string_immutable.zig").UnsignedCodepointIterator;
const Codepoint = u32;
const DirIterator = @import("./bun.js/node/dir_iterator.zig");
const Syscall = @import("./bun.js/node/syscall.zig");
const PathLike = @import("./bun.js/node/types.zig").PathLike;
const Maybe = @import("./bun.js/node/types.zig").Maybe;
const Dirent = @import("./bun.js/node/types.zig").Dirent;
const PathString = @import("./string_types.zig").PathString;
const ZigString = @import("./bun.js/bindings/bindings.zig").ZigString;

pub const GlobWalker = struct {
    pub const Result = Maybe(void);

    allocator: Allocator = undefined,

    /// not owned by this struct
    originalPattern: []const u8 = undefined,

    patternComponents: ArrayList(Component) = .{},
    matchedPaths: ArrayList(BunString) = .{},
    i: u32 = 0,

    // Invariant: If the underlying StringImpl is ZigString we assume it is
    // allocated by this struct's allocator and owned by it
    cwd: BunString = undefined,
    pathBuf: [bun.MAX_PATH_BYTES]u8 = undefined,

    /// A component is each part of a glob pattern, separated by directory
    /// separator:
    /// `src/**/*.ts` -> `src`, `**`, `*.ts`
    const Component = struct {
        start: u32,
        len: u32,
    };

    pub fn init(this: *GlobWalker, allocator: Allocator, pattern: []const u8) !Maybe(void) {
        var cwd: BunString = undefined;
        switch (Syscall.getcwd(&this.pathBuf)) {
            .err => |err| {
                return .{ .err = err };
            },
            .result => |result| {
                var copiedCwd = try allocator.alloc(u8, result.len);
                @memcpy(copiedCwd, result);
                cwd = BunString.fromBytes(copiedCwd);
            },
        }
        const globWalker = try this.initWithCwd(allocator, pattern, cwd);
        return .{ .result = globWalker };
    }

    pub fn initWithCwd(this: *GlobWalker, allocator: Allocator, pattern: []const u8, cwd: BunString) !void {
        var patternComponents = ArrayList(Component){};
        errdefer patternComponents.deinit(allocator);
        try GlobWalker.buildPatternComponents(allocator, &patternComponents, pattern);

        this.patternComponents = patternComponents;
        this.originalPattern = pattern;
        this.allocator = allocator;
        this.cwd = cwd;
    }

    pub fn deinit(this: *GlobWalker) void {
        switch (this.cwd.tag) {
            .ZigString => {
                const bytes = this.cwd.value.ZigString.full();
                this.allocator.free(bytes);
            },
            .WTFStringImpl => this.cwd.deref(),
            .Dead, .Empty, .StaticZigString => {},
        }
        this.patternComponents.deinit(this.allocator);
        // TODO: what about freeing the strings inside of here
        this.matchedPaths.deinit(this.allocator);
    }

    pub fn walk(this: *GlobWalker) !Maybe(void) {
        const flags = std.os.O.DIRECTORY | std.os.O.RDONLY;
        const rootPath = this.cwd.toZigString().sliceZBuf(&this.pathBuf) catch unreachable;
        const fd = switch (Syscall.open(rootPath, flags, 0)) {
            .err => |err| return .{
                .err = err.withPath(rootPath),
            },
            .result => |fd_| fd_,
        };
        defer {
            _ = Syscall.close(fd);
        }

        var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
        var iterator = DirIterator.iterate(dir);
        var entry = iterator.next();

        while (switch (entry) {
            .err => |err| return .{ .err = err.withPath(rootPath) },
            .result => |ent| ent,
        }) |_current| : (entry = iterator.next()) {
            const current: DirIterator.IteratorResult = _current;
            std.debug.print("NAME: {s} KIND: {s}\n", .{ current.name.slice(), @tagName(current.kind) });
        }

        return .{ .result = undefined };
    }

    pub fn walkImpl(this: *GlobWalker, allocator: Allocator, out: *ArrayList(bun.String)) !void {
        _ = out;
        _ = allocator;
        while (this.i < this.patternComponents.items.len) {
            const component = this.patternComponents.items[this.i];
            _ = component;
        }
    }

    fn buildPatternComponents(allocator: Allocator, patternComponents: *ArrayList(Component), pattern: []const u8) !void {
        const isWindows = @import("builtin").os.tag == .windows;
        var start: u32 = 0;

        const iter = CodepointIter.init(pattern);
        var cursor = CodepointIter.Cursor{};

        var prevIsBackslash = false;
        while (iter.next(&cursor)) {
            const c = cursor.c;

            switch (c) {
                '\\' => {
                    if (comptime isWindows) {
                        const end = cursor.i;
                        try patternComponents.append(allocator, .{ .start = start, .len = end - start });
                        start = cursor.i + cursor.width;
                        continue;
                    }

                    if (prevIsBackslash) {
                        prevIsBackslash = false;
                        continue;
                    }

                    prevIsBackslash = true;
                },
                '/' => {
                    const end = cursor.i;
                    try patternComponents.append(allocator, .{ .start = start, .len = end - start });
                    start = cursor.i + cursor.width;
                },
                // TODO: Support other escaping glob syntax
                else => {},
            }
        }
    }
};

/// State for matching a glob against a string
pub const GlobState = struct {
    // These store character indices into the glob and path strings.
    path_index: usize = 0,
    glob_index: usize = 0,
    // When we hit a * or **, we store the state for backtracking.
    wildcard: Wildcard = .{},
    globstar: Wildcard = .{},

    fn skipBraces(self: *GlobState, glob: []const u8, stop_on_comma: bool) BraceState {
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
};

const Wildcard = struct {
    // Using u32 rather than usize for these results in 10% faster performance.
    glob_index: u32 = 0,
    path_index: u32 = 0,
};

const BraceState = enum { Invalid, Comma, EndBrace };

inline fn backtrack(self: *GlobState) void {
    self.glob_index = self.wildcard.glob_index;
    self.path_index = self.wildcard.path_index;
}

const BraceStack = struct {
    stack: [10]GlobState = undefined,
    len: u32 = 0,
    longest_brace_match: u32 = 0,

    inline fn push(self: *BraceStack, state: *const GlobState) GlobState {
        self.stack[self.len] = state.*;
        self.len += 1;
        return GlobState{
            .path_index = state.path_index,
            .glob_index = state.glob_index + 1,
        };
    }

    inline fn pop(self: *BraceStack, state: *const GlobState) GlobState {
        self.len -= 1;
        const s = GlobState{
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

    inline fn last(self: *const BraceStack) *const GlobState {
        return &self.stack[self.len - 1];
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
pub fn match(glob: []const u8, path: []const u8) bool {
    // This algorithm is based on https://research.swtch.com/glob
    var state = GlobState{};
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
            switch (glob[state.glob_index]) {
                '*' => {
                    const is_globstar = state.glob_index + 1 < glob.len and
                        glob[state.glob_index + 1] == '*';
                    if (is_globstar) {
                        // Coalesce multiple ** segments into one.
                        var index = state.glob_index + 2;
                        state.glob_index = skipGlobstars(glob, &index) - 2;
                    }

                    state.wildcard.glob_index = @as(u32, @intCast(state.glob_index));
                    state.wildcard.path_index = @as(u32, @intCast(state.path_index + 1));

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
                            return false; // invalid pattern!
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
                            return false; // Invalid pattern
                        state.glob_index += 1;

                        // If there is a - and the following character is not ],
                        // read the range end character.
                        const high = if (state.glob_index + 1 < glob.len and
                            glob[state.glob_index] == '-' and glob[state.glob_index + 1] != ']')
                        blk: {
                            state.glob_index += 1;
                            var h = glob[state.glob_index];
                            if (!unescape(&h, glob, &state.glob_index))
                                return false; // Invalid pattern!
                            state.glob_index += 1;
                            break :blk h;
                        } else low;

                        if (low <= c and c <= high)
                            is_match = true;
                        first = false;
                    }
                    if (state.glob_index >= glob.len)
                        return false; // Invalid pattern!
                    state.glob_index += 1;
                    if (is_match != class_negated) {
                        state.path_index += 1;
                        continue;
                    }
                },
                '{' => if (state.path_index < path.len) {
                    if (brace_stack.len >= brace_stack.stack.len)
                        return false; // Invalid pattern! Too many nested braces.

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
                        return false; // Invalid pattern;

                    const is_match = if (cc == '/')
                        isSeparator(path[state.path_index])
                    else
                        path[state.path_index] == cc;

                    if (is_match) {
                        if (brace_stack.len > 0 and
                            state.glob_index > 0 and
                            glob[state.glob_index - 1] == '}')
                        {
                            brace_stack.longest_brace_match = @as(u32, @intCast(state.path_index));
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
                .Invalid => return false,
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

        return negated;
    }

    return !negated;
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

test "basic" {
    try expect(match("abc", "abc"));
    try expect(match("*", "abc"));
    try expect(match("*", ""));
    try expect(match("**", ""));
    try expect(match("*c", "abc"));
    try expect(!match("*b", "abc"));
    try expect(match("a*", "abc"));
    try expect(!match("b*", "abc"));
    try expect(match("a*", "a"));
    try expect(match("*a", "a"));
    try expect(match("a*b*c*d*e*", "axbxcxdxe"));
    try expect(match("a*b*c*d*e*", "axbxcxdxexxx"));
    try expect(match("a*b?c*x", "abxbbxdbxebxczzx"));
    try expect(!match("a*b?c*x", "abxbbxdbxebxczzy"));

    try expect(match("a/*/test", "a/foo/test"));
    try expect(!match("a/*/test", "a/foo/bar/test"));
    try expect(match("a/**/test", "a/foo/test"));
    try expect(match("a/**/test", "a/foo/bar/test"));
    try expect(match("a/**/b/c", "a/foo/bar/b/c"));
    try expect(match("a\\*b", "a*b"));
    try expect(!match("a\\*b", "axb"));

    try expect(match("[abc]", "a"));
    try expect(match("[abc]", "b"));
    try expect(match("[abc]", "c"));
    try expect(!match("[abc]", "d"));
    try expect(match("x[abc]x", "xax"));
    try expect(match("x[abc]x", "xbx"));
    try expect(match("x[abc]x", "xcx"));
    try expect(!match("x[abc]x", "xdx"));
    try expect(!match("x[abc]x", "xay"));
    try expect(match("[?]", "?"));
    try expect(!match("[?]", "a"));
    try expect(match("[*]", "*"));
    try expect(!match("[*]", "a"));

    try expect(match("[a-cx]", "a"));
    try expect(match("[a-cx]", "b"));
    try expect(match("[a-cx]", "c"));
    try expect(!match("[a-cx]", "d"));
    try expect(match("[a-cx]", "x"));

    try expect(!match("[^abc]", "a"));
    try expect(!match("[^abc]", "b"));
    try expect(!match("[^abc]", "c"));
    try expect(match("[^abc]", "d"));
    try expect(!match("[!abc]", "a"));
    try expect(!match("[!abc]", "b"));
    try expect(!match("[!abc]", "c"));
    try expect(match("[!abc]", "d"));
    try expect(match("[\\!]", "!"));

    try expect(match("a*b*[cy]*d*e*", "axbxcxdxexxx"));
    try expect(match("a*b*[cy]*d*e*", "axbxyxdxexxx"));
    try expect(match("a*b*[cy]*d*e*", "axbxxxyxdxexxx"));

    try expect(match("test.{jpg,png}", "test.jpg"));
    try expect(match("test.{jpg,png}", "test.png"));
    try expect(match("test.{j*g,p*g}", "test.jpg"));
    try expect(match("test.{j*g,p*g}", "test.jpxxxg"));
    try expect(match("test.{j*g,p*g}", "test.jxg"));
    try expect(!match("test.{j*g,p*g}", "test.jnt"));
    try expect(match("test.{j*g,j*c}", "test.jnc"));
    try expect(match("test.{jpg,p*g}", "test.png"));
    try expect(match("test.{jpg,p*g}", "test.pxg"));
    try expect(!match("test.{jpg,p*g}", "test.pnt"));
    try expect(match("test.{jpeg,png}", "test.jpeg"));
    try expect(!match("test.{jpeg,png}", "test.jpg"));
    try expect(match("test.{jpeg,png}", "test.png"));
    try expect(match("test.{jp\\,g,png}", "test.jp,g"));
    try expect(!match("test.{jp\\,g,png}", "test.jxg"));
    try expect(match("test/{foo,bar}/baz", "test/foo/baz"));
    try expect(match("test/{foo,bar}/baz", "test/bar/baz"));
    try expect(!match("test/{foo,bar}/baz", "test/baz/baz"));
    try expect(match("test/{foo*,bar*}/baz", "test/foooooo/baz"));
    try expect(match("test/{foo*,bar*}/baz", "test/barrrrr/baz"));
    try expect(match("test/{*foo,*bar}/baz", "test/xxxxfoo/baz"));
    try expect(match("test/{*foo,*bar}/baz", "test/xxxxbar/baz"));
    try expect(match("test/{foo/**,bar}/baz", "test/bar/baz"));
    try expect(!match("test/{foo/**,bar}/baz", "test/bar/test/baz"));

    try expect(!match("*.txt", "some/big/path/to/the/needle.txt"));
    try expect(match(
        "some/**/needle.{js,tsx,mdx,ts,jsx,txt}",
        "some/a/bigger/path/to/the/crazy/needle.txt",
    ));
    try expect(match(
        "some/**/{a,b,c}/**/needle.txt",
        "some/foo/a/bigger/path/to/the/crazy/needle.txt",
    ));
    try expect(!match(
        "some/**/{a,b,c}/**/needle.txt",
        "some/foo/d/bigger/path/to/the/crazy/needle.txt",
    ));
    try expect(match("a/{a{a,b},b}", "a/aa"));
    try expect(match("a/{a{a,b},b}", "a/ab"));
    try expect(!match("a/{a{a,b},b}", "a/ac"));
    try expect(match("a/{a{a,b},b}", "a/b"));
    try expect(!match("a/{a{a,b},b}", "a/c"));
    try expect(match("a/{b,c[}]*}", "a/b"));
    try expect(match("a/{b,c[}]*}", "a/c}xx"));
}

// The below tests are based on Bash and micromatch.
// https://github.com/micromatch/picomatch/blob/master/test/bash.js
test "bash" {
    try expect(!match("a*", "*"));
    try expect(!match("a*", "**"));
    try expect(!match("a*", "\\*"));
    try expect(!match("a*", "a/*"));
    try expect(!match("a*", "b"));
    try expect(!match("a*", "bc"));
    try expect(!match("a*", "bcd"));
    try expect(!match("a*", "bdir/"));
    try expect(!match("a*", "Beware"));
    try expect(match("a*", "a"));
    try expect(match("a*", "ab"));
    try expect(match("a*", "abc"));

    try expect(!match("\\a*", "*"));
    try expect(!match("\\a*", "**"));
    try expect(!match("\\a*", "\\*"));

    try expect(match("\\a*", "a"));
    try expect(!match("\\a*", "a/*"));
    try expect(match("\\a*", "abc"));
    try expect(match("\\a*", "abd"));
    try expect(match("\\a*", "abe"));
    try expect(!match("\\a*", "b"));
    try expect(!match("\\a*", "bb"));
    try expect(!match("\\a*", "bcd"));
    try expect(!match("\\a*", "bdir/"));
    try expect(!match("\\a*", "Beware"));
    try expect(!match("\\a*", "c"));
    try expect(!match("\\a*", "ca"));
    try expect(!match("\\a*", "cb"));
    try expect(!match("\\a*", "d"));
    try expect(!match("\\a*", "dd"));
    try expect(!match("\\a*", "de"));
}

test "bash directories" {
    try expect(!match("b*/", "*"));
    try expect(!match("b*/", "**"));
    try expect(!match("b*/", "\\*"));
    try expect(!match("b*/", "a"));
    try expect(!match("b*/", "a/*"));
    try expect(!match("b*/", "abc"));
    try expect(!match("b*/", "abd"));
    try expect(!match("b*/", "abe"));
    try expect(!match("b*/", "b"));
    try expect(!match("b*/", "bb"));
    try expect(!match("b*/", "bcd"));
    try expect(match("b*/", "bdir/"));
    try expect(!match("b*/", "Beware"));
    try expect(!match("b*/", "c"));
    try expect(!match("b*/", "ca"));
    try expect(!match("b*/", "cb"));
    try expect(!match("b*/", "d"));
    try expect(!match("b*/", "dd"));
    try expect(!match("b*/", "de"));
}

test "bash escaping" {
    try expect(!match("\\^", "*"));
    try expect(!match("\\^", "**"));
    try expect(!match("\\^", "\\*"));
    try expect(!match("\\^", "a"));
    try expect(!match("\\^", "a/*"));
    try expect(!match("\\^", "abc"));
    try expect(!match("\\^", "abd"));
    try expect(!match("\\^", "abe"));
    try expect(!match("\\^", "b"));
    try expect(!match("\\^", "bb"));
    try expect(!match("\\^", "bcd"));
    try expect(!match("\\^", "bdir/"));
    try expect(!match("\\^", "Beware"));
    try expect(!match("\\^", "c"));
    try expect(!match("\\^", "ca"));
    try expect(!match("\\^", "cb"));
    try expect(!match("\\^", "d"));
    try expect(!match("\\^", "dd"));
    try expect(!match("\\^", "de"));

    try expect(match("\\*", "*"));
    // try expect(match("\\*", "\\*"));
    try expect(!match("\\*", "**"));
    try expect(!match("\\*", "a"));
    try expect(!match("\\*", "a/*"));
    try expect(!match("\\*", "abc"));
    try expect(!match("\\*", "abd"));
    try expect(!match("\\*", "abe"));
    try expect(!match("\\*", "b"));
    try expect(!match("\\*", "bb"));
    try expect(!match("\\*", "bcd"));
    try expect(!match("\\*", "bdir/"));
    try expect(!match("\\*", "Beware"));
    try expect(!match("\\*", "c"));
    try expect(!match("\\*", "ca"));
    try expect(!match("\\*", "cb"));
    try expect(!match("\\*", "d"));
    try expect(!match("\\*", "dd"));
    try expect(!match("\\*", "de"));

    try expect(!match("a\\*", "*"));
    try expect(!match("a\\*", "**"));
    try expect(!match("a\\*", "\\*"));
    try expect(!match("a\\*", "a"));
    try expect(!match("a\\*", "a/*"));
    try expect(!match("a\\*", "abc"));
    try expect(!match("a\\*", "abd"));
    try expect(!match("a\\*", "abe"));
    try expect(!match("a\\*", "b"));
    try expect(!match("a\\*", "bb"));
    try expect(!match("a\\*", "bcd"));
    try expect(!match("a\\*", "bdir/"));
    try expect(!match("a\\*", "Beware"));
    try expect(!match("a\\*", "c"));
    try expect(!match("a\\*", "ca"));
    try expect(!match("a\\*", "cb"));
    try expect(!match("a\\*", "d"));
    try expect(!match("a\\*", "dd"));
    try expect(!match("a\\*", "de"));

    try expect(match("*q*", "aqa"));
    try expect(match("*q*", "aaqaa"));
    try expect(!match("*q*", "*"));
    try expect(!match("*q*", "**"));
    try expect(!match("*q*", "\\*"));
    try expect(!match("*q*", "a"));
    try expect(!match("*q*", "a/*"));
    try expect(!match("*q*", "abc"));
    try expect(!match("*q*", "abd"));
    try expect(!match("*q*", "abe"));
    try expect(!match("*q*", "b"));
    try expect(!match("*q*", "bb"));
    try expect(!match("*q*", "bcd"));
    try expect(!match("*q*", "bdir/"));
    try expect(!match("*q*", "Beware"));
    try expect(!match("*q*", "c"));
    try expect(!match("*q*", "ca"));
    try expect(!match("*q*", "cb"));
    try expect(!match("*q*", "d"));
    try expect(!match("*q*", "dd"));
    try expect(!match("*q*", "de"));

    try expect(match("\\**", "*"));
    try expect(match("\\**", "**"));
    try expect(!match("\\**", "\\*"));
    try expect(!match("\\**", "a"));
    try expect(!match("\\**", "a/*"));
    try expect(!match("\\**", "abc"));
    try expect(!match("\\**", "abd"));
    try expect(!match("\\**", "abe"));
    try expect(!match("\\**", "b"));
    try expect(!match("\\**", "bb"));
    try expect(!match("\\**", "bcd"));
    try expect(!match("\\**", "bdir/"));
    try expect(!match("\\**", "Beware"));
    try expect(!match("\\**", "c"));
    try expect(!match("\\**", "ca"));
    try expect(!match("\\**", "cb"));
    try expect(!match("\\**", "d"));
    try expect(!match("\\**", "dd"));
    try expect(!match("\\**", "de"));
}

test "bash classes" {
    try expect(!match("a*[^c]", "*"));
    try expect(!match("a*[^c]", "**"));
    try expect(!match("a*[^c]", "\\*"));
    try expect(!match("a*[^c]", "a"));
    try expect(!match("a*[^c]", "a/*"));
    try expect(!match("a*[^c]", "abc"));
    try expect(match("a*[^c]", "abd"));
    try expect(match("a*[^c]", "abe"));
    try expect(!match("a*[^c]", "b"));
    try expect(!match("a*[^c]", "bb"));
    try expect(!match("a*[^c]", "bcd"));
    try expect(!match("a*[^c]", "bdir/"));
    try expect(!match("a*[^c]", "Beware"));
    try expect(!match("a*[^c]", "c"));
    try expect(!match("a*[^c]", "ca"));
    try expect(!match("a*[^c]", "cb"));
    try expect(!match("a*[^c]", "d"));
    try expect(!match("a*[^c]", "dd"));
    try expect(!match("a*[^c]", "de"));
    try expect(!match("a*[^c]", "baz"));
    try expect(!match("a*[^c]", "bzz"));
    try expect(!match("a*[^c]", "BZZ"));
    try expect(!match("a*[^c]", "beware"));
    try expect(!match("a*[^c]", "BewAre"));

    try expect(match("a[X-]b", "a-b"));
    try expect(match("a[X-]b", "aXb"));

    try expect(!match("[a-y]*[^c]", "*"));
    try expect(match("[a-y]*[^c]", "a*"));
    try expect(!match("[a-y]*[^c]", "**"));
    try expect(!match("[a-y]*[^c]", "\\*"));
    try expect(!match("[a-y]*[^c]", "a"));
    try expect(match("[a-y]*[^c]", "a123b"));
    try expect(!match("[a-y]*[^c]", "a123c"));
    try expect(match("[a-y]*[^c]", "ab"));
    try expect(!match("[a-y]*[^c]", "a/*"));
    try expect(!match("[a-y]*[^c]", "abc"));
    try expect(match("[a-y]*[^c]", "abd"));
    try expect(match("[a-y]*[^c]", "abe"));
    try expect(!match("[a-y]*[^c]", "b"));
    try expect(match("[a-y]*[^c]", "bd"));
    try expect(match("[a-y]*[^c]", "bb"));
    try expect(match("[a-y]*[^c]", "bcd"));
    try expect(match("[a-y]*[^c]", "bdir/"));
    try expect(!match("[a-y]*[^c]", "Beware"));
    try expect(!match("[a-y]*[^c]", "c"));
    try expect(match("[a-y]*[^c]", "ca"));
    try expect(match("[a-y]*[^c]", "cb"));
    try expect(!match("[a-y]*[^c]", "d"));
    try expect(match("[a-y]*[^c]", "dd"));
    try expect(match("[a-y]*[^c]", "dd"));
    try expect(match("[a-y]*[^c]", "dd"));
    try expect(match("[a-y]*[^c]", "de"));
    try expect(match("[a-y]*[^c]", "baz"));
    try expect(match("[a-y]*[^c]", "bzz"));
    try expect(match("[a-y]*[^c]", "bzz"));
    // assert(!isMatch('bzz', '[a-y]*[^c]', { regex: true }));
    try expect(!match("[a-y]*[^c]", "BZZ"));
    try expect(match("[a-y]*[^c]", "beware"));
    try expect(!match("[a-y]*[^c]", "BewAre"));

    try expect(match("a\\*b/*", "a*b/ooo"));
    try expect(match("a\\*?/*", "a*b/ooo"));

    try expect(!match("a[b]c", "*"));
    try expect(!match("a[b]c", "**"));
    try expect(!match("a[b]c", "\\*"));
    try expect(!match("a[b]c", "a"));
    try expect(!match("a[b]c", "a/*"));
    try expect(match("a[b]c", "abc"));
    try expect(!match("a[b]c", "abd"));
    try expect(!match("a[b]c", "abe"));
    try expect(!match("a[b]c", "b"));
    try expect(!match("a[b]c", "bb"));
    try expect(!match("a[b]c", "bcd"));
    try expect(!match("a[b]c", "bdir/"));
    try expect(!match("a[b]c", "Beware"));
    try expect(!match("a[b]c", "c"));
    try expect(!match("a[b]c", "ca"));
    try expect(!match("a[b]c", "cb"));
    try expect(!match("a[b]c", "d"));
    try expect(!match("a[b]c", "dd"));
    try expect(!match("a[b]c", "de"));
    try expect(!match("a[b]c", "baz"));
    try expect(!match("a[b]c", "bzz"));
    try expect(!match("a[b]c", "BZZ"));
    try expect(!match("a[b]c", "beware"));
    try expect(!match("a[b]c", "BewAre"));

    try expect(!match("a[\"b\"]c", "*"));
    try expect(!match("a[\"b\"]c", "**"));
    try expect(!match("a[\"b\"]c", "\\*"));
    try expect(!match("a[\"b\"]c", "a"));
    try expect(!match("a[\"b\"]c", "a/*"));
    try expect(match("a[\"b\"]c", "abc"));
    try expect(!match("a[\"b\"]c", "abd"));
    try expect(!match("a[\"b\"]c", "abe"));
    try expect(!match("a[\"b\"]c", "b"));
    try expect(!match("a[\"b\"]c", "bb"));
    try expect(!match("a[\"b\"]c", "bcd"));
    try expect(!match("a[\"b\"]c", "bdir/"));
    try expect(!match("a[\"b\"]c", "Beware"));
    try expect(!match("a[\"b\"]c", "c"));
    try expect(!match("a[\"b\"]c", "ca"));
    try expect(!match("a[\"b\"]c", "cb"));
    try expect(!match("a[\"b\"]c", "d"));
    try expect(!match("a[\"b\"]c", "dd"));
    try expect(!match("a[\"b\"]c", "de"));
    try expect(!match("a[\"b\"]c", "baz"));
    try expect(!match("a[\"b\"]c", "bzz"));
    try expect(!match("a[\"b\"]c", "BZZ"));
    try expect(!match("a[\"b\"]c", "beware"));
    try expect(!match("a[\"b\"]c", "BewAre"));

    try expect(!match("a[\\\\b]c", "*"));
    try expect(!match("a[\\\\b]c", "**"));
    try expect(!match("a[\\\\b]c", "\\*"));
    try expect(!match("a[\\\\b]c", "a"));
    try expect(!match("a[\\\\b]c", "a/*"));
    try expect(match("a[\\\\b]c", "abc"));
    try expect(!match("a[\\\\b]c", "abd"));
    try expect(!match("a[\\\\b]c", "abe"));
    try expect(!match("a[\\\\b]c", "b"));
    try expect(!match("a[\\\\b]c", "bb"));
    try expect(!match("a[\\\\b]c", "bcd"));
    try expect(!match("a[\\\\b]c", "bdir/"));
    try expect(!match("a[\\\\b]c", "Beware"));
    try expect(!match("a[\\\\b]c", "c"));
    try expect(!match("a[\\\\b]c", "ca"));
    try expect(!match("a[\\\\b]c", "cb"));
    try expect(!match("a[\\\\b]c", "d"));
    try expect(!match("a[\\\\b]c", "dd"));
    try expect(!match("a[\\\\b]c", "de"));
    try expect(!match("a[\\\\b]c", "baz"));
    try expect(!match("a[\\\\b]c", "bzz"));
    try expect(!match("a[\\\\b]c", "BZZ"));
    try expect(!match("a[\\\\b]c", "beware"));
    try expect(!match("a[\\\\b]c", "BewAre"));

    try expect(!match("a[\\b]c", "*"));
    try expect(!match("a[\\b]c", "**"));
    try expect(!match("a[\\b]c", "\\*"));
    try expect(!match("a[\\b]c", "a"));
    try expect(!match("a[\\b]c", "a/*"));
    try expect(!match("a[\\b]c", "abc"));
    try expect(!match("a[\\b]c", "abd"));
    try expect(!match("a[\\b]c", "abe"));
    try expect(!match("a[\\b]c", "b"));
    try expect(!match("a[\\b]c", "bb"));
    try expect(!match("a[\\b]c", "bcd"));
    try expect(!match("a[\\b]c", "bdir/"));
    try expect(!match("a[\\b]c", "Beware"));
    try expect(!match("a[\\b]c", "c"));
    try expect(!match("a[\\b]c", "ca"));
    try expect(!match("a[\\b]c", "cb"));
    try expect(!match("a[\\b]c", "d"));
    try expect(!match("a[\\b]c", "dd"));
    try expect(!match("a[\\b]c", "de"));
    try expect(!match("a[\\b]c", "baz"));
    try expect(!match("a[\\b]c", "bzz"));
    try expect(!match("a[\\b]c", "BZZ"));
    try expect(!match("a[\\b]c", "beware"));
    try expect(!match("a[\\b]c", "BewAre"));

    try expect(!match("a[b-d]c", "*"));
    try expect(!match("a[b-d]c", "**"));
    try expect(!match("a[b-d]c", "\\*"));
    try expect(!match("a[b-d]c", "a"));
    try expect(!match("a[b-d]c", "a/*"));
    try expect(match("a[b-d]c", "abc"));
    try expect(!match("a[b-d]c", "abd"));
    try expect(!match("a[b-d]c", "abe"));
    try expect(!match("a[b-d]c", "b"));
    try expect(!match("a[b-d]c", "bb"));
    try expect(!match("a[b-d]c", "bcd"));
    try expect(!match("a[b-d]c", "bdir/"));
    try expect(!match("a[b-d]c", "Beware"));
    try expect(!match("a[b-d]c", "c"));
    try expect(!match("a[b-d]c", "ca"));
    try expect(!match("a[b-d]c", "cb"));
    try expect(!match("a[b-d]c", "d"));
    try expect(!match("a[b-d]c", "dd"));
    try expect(!match("a[b-d]c", "de"));
    try expect(!match("a[b-d]c", "baz"));
    try expect(!match("a[b-d]c", "bzz"));
    try expect(!match("a[b-d]c", "BZZ"));
    try expect(!match("a[b-d]c", "beware"));
    try expect(!match("a[b-d]c", "BewAre"));

    try expect(!match("a?c", "*"));
    try expect(!match("a?c", "**"));
    try expect(!match("a?c", "\\*"));
    try expect(!match("a?c", "a"));
    try expect(!match("a?c", "a/*"));
    try expect(match("a?c", "abc"));
    try expect(!match("a?c", "abd"));
    try expect(!match("a?c", "abe"));
    try expect(!match("a?c", "b"));
    try expect(!match("a?c", "bb"));
    try expect(!match("a?c", "bcd"));
    try expect(!match("a?c", "bdir/"));
    try expect(!match("a?c", "Beware"));
    try expect(!match("a?c", "c"));
    try expect(!match("a?c", "ca"));
    try expect(!match("a?c", "cb"));
    try expect(!match("a?c", "d"));
    try expect(!match("a?c", "dd"));
    try expect(!match("a?c", "de"));
    try expect(!match("a?c", "baz"));
    try expect(!match("a?c", "bzz"));
    try expect(!match("a?c", "BZZ"));
    try expect(!match("a?c", "beware"));
    try expect(!match("a?c", "BewAre"));

    try expect(match("*/man*/bash.*", "man/man1/bash.1"));

    try expect(match("[^a-c]*", "*"));
    try expect(match("[^a-c]*", "**"));
    try expect(!match("[^a-c]*", "a"));
    try expect(!match("[^a-c]*", "a/*"));
    try expect(!match("[^a-c]*", "abc"));
    try expect(!match("[^a-c]*", "abd"));
    try expect(!match("[^a-c]*", "abe"));
    try expect(!match("[^a-c]*", "b"));
    try expect(!match("[^a-c]*", "bb"));
    try expect(!match("[^a-c]*", "bcd"));
    try expect(!match("[^a-c]*", "bdir/"));
    try expect(match("[^a-c]*", "Beware"));
    try expect(match("[^a-c]*", "Beware"));
    try expect(!match("[^a-c]*", "c"));
    try expect(!match("[^a-c]*", "ca"));
    try expect(!match("[^a-c]*", "cb"));
    try expect(match("[^a-c]*", "d"));
    try expect(match("[^a-c]*", "dd"));
    try expect(match("[^a-c]*", "de"));
    try expect(!match("[^a-c]*", "baz"));
    try expect(!match("[^a-c]*", "bzz"));
    try expect(match("[^a-c]*", "BZZ"));
    try expect(!match("[^a-c]*", "beware"));
    try expect(match("[^a-c]*", "BewAre"));
}

test "bash wildmatch" {
    try expect(!match("a[]-]b", "aab"));
    try expect(!match("[ten]", "ten"));
    try expect(match("]", "]"));
    try expect(match("a[]-]b", "a-b"));
    try expect(match("a[]-]b", "a]b"));
    try expect(match("a[]]b", "a]b"));
    try expect(match("a[\\]a\\-]b", "aab"));
    try expect(match("t[a-g]n", "ten"));
    try expect(match("t[^a-g]n", "ton"));
}

test "bash slashmatch" {
    // try expect(!match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo/bar"));
    try expect(match("foo[/]bar", "foo/bar"));
    try expect(match("f[^eiu][^eiu][^eiu][^eiu][^eiu]r", "foo-bar"));
}

test "bash extra_stars" {
    try expect(!match("a**c", "bbc"));
    try expect(match("a**c", "abc"));
    try expect(!match("a**c", "bbd"));

    try expect(!match("a***c", "bbc"));
    try expect(match("a***c", "abc"));
    try expect(!match("a***c", "bbd"));

    try expect(!match("a*****?c", "bbc"));
    try expect(match("a*****?c", "abc"));
    try expect(!match("a*****?c", "bbc"));

    try expect(match("?*****??", "bbc"));
    try expect(match("?*****??", "abc"));

    try expect(match("*****??", "bbc"));
    try expect(match("*****??", "abc"));

    try expect(match("?*****?c", "bbc"));
    try expect(match("?*****?c", "abc"));

    try expect(match("?***?****c", "bbc"));
    try expect(match("?***?****c", "abc"));
    try expect(!match("?***?****c", "bbd"));

    try expect(match("?***?****?", "bbc"));
    try expect(match("?***?****?", "abc"));

    try expect(match("?***?****", "bbc"));
    try expect(match("?***?****", "abc"));

    try expect(match("*******c", "bbc"));
    try expect(match("*******c", "abc"));

    try expect(match("*******?", "bbc"));
    try expect(match("*******?", "abc"));

    try expect(match("a*cd**?**??k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??k***", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??***k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??***k**", "abcdecdhjk"));
    try expect(match("a****c**?**??*****", "abcdecdhjk"));
}

test "stars" {
    try expect(!match("*.js", "a/b/c/z.js"));
    try expect(!match("*.js", "a/b/z.js"));
    try expect(!match("*.js", "a/z.js"));
    try expect(match("*.js", "z.js"));

    // try expect(!match("*/*", "a/.ab"));
    // try expect(!match("*", ".ab"));

    try expect(match("z*.js", "z.js"));
    try expect(match("*/*", "a/z"));
    try expect(match("*/z*.js", "a/z.js"));
    try expect(match("a/z*.js", "a/z.js"));

    try expect(match("*", "ab"));
    try expect(match("*", "abc"));

    try expect(!match("f*", "bar"));
    try expect(!match("*r", "foo"));
    try expect(!match("b*", "foo"));
    try expect(!match("*", "foo/bar"));
    try expect(match("*c", "abc"));
    try expect(match("a*", "abc"));
    try expect(match("a*c", "abc"));
    try expect(match("*r", "bar"));
    try expect(match("b*", "bar"));
    try expect(match("f*", "foo"));

    try expect(match("*abc*", "one abc two"));
    try expect(match("a*b", "a         b"));

    try expect(!match("*a*", "foo"));
    try expect(match("*a*", "bar"));
    try expect(match("*abc*", "oneabctwo"));
    try expect(!match("*-bc-*", "a-b.c-d"));
    try expect(match("*-*.*-*", "a-b.c-d"));
    try expect(match("*-b*c-*", "a-b.c-d"));
    try expect(match("*-b.c-*", "a-b.c-d"));
    try expect(match("*.*", "a-b.c-d"));
    try expect(match("*.*-*", "a-b.c-d"));
    try expect(match("*.*-d", "a-b.c-d"));
    try expect(match("*.c-*", "a-b.c-d"));
    try expect(match("*b.*d", "a-b.c-d"));
    try expect(match("a*.c*", "a-b.c-d"));
    try expect(match("a-*.*-d", "a-b.c-d"));
    try expect(match("*.*", "a.b"));
    try expect(match("*.b", "a.b"));
    try expect(match("a.*", "a.b"));
    try expect(match("a.b", "a.b"));

    try expect(!match("**-bc-**", "a-b.c-d"));
    try expect(match("**-**.**-**", "a-b.c-d"));
    try expect(match("**-b**c-**", "a-b.c-d"));
    try expect(match("**-b.c-**", "a-b.c-d"));
    try expect(match("**.**", "a-b.c-d"));
    try expect(match("**.**-**", "a-b.c-d"));
    try expect(match("**.**-d", "a-b.c-d"));
    try expect(match("**.c-**", "a-b.c-d"));
    try expect(match("**b.**d", "a-b.c-d"));
    try expect(match("a**.c**", "a-b.c-d"));
    try expect(match("a-**.**-d", "a-b.c-d"));
    try expect(match("**.**", "a.b"));
    try expect(match("**.b", "a.b"));
    try expect(match("a.**", "a.b"));
    try expect(match("a.b", "a.b"));

    try expect(match("*/*", "/ab"));
    try expect(match(".", "."));
    try expect(!match("a/", "a/.b"));
    try expect(match("/*", "/ab"));
    try expect(match("/??", "/ab"));
    try expect(match("/?b", "/ab"));
    try expect(match("/*", "/cd"));
    try expect(match("a", "a"));
    try expect(match("a/.*", "a/.b"));
    try expect(match("?/?", "a/b"));
    try expect(match("a/**/j/**/z/*.md", "a/b/c/d/e/j/n/p/o/z/c.md"));
    try expect(match("a/**/z/*.md", "a/b/c/d/e/z/c.md"));
    try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
    try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
    try expect(match("a/*/z/.a", "a/b/z/.a"));
    try expect(!match("bz", "a/b/z/.a"));
    try expect(match("a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md"));
    try expect(match("a/**/c/*.md", "a/bb.bb/aa/bb/aa/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bb.bb/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bb/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bbbb/c/xyz.md"));
    try expect(match("*", "aaa"));
    try expect(match("*", "ab"));
    try expect(match("ab", "ab"));

    try expect(!match("*/*/*", "aaa"));
    try expect(!match("*/*/*", "aaa/bb/aa/rr"));
    try expect(!match("aaa*", "aaa/bba/ccc"));
    // try expect(!match("aaa**", "aaa/bba/ccc"));
    try expect(!match("aaa/*", "aaa/bba/ccc"));
    try expect(!match("aaa/*ccc", "aaa/bba/ccc"));
    try expect(!match("aaa/*z", "aaa/bba/ccc"));
    try expect(!match("*/*/*", "aaa/bbb"));
    try expect(!match("*/*jk*/*i", "ab/zzz/ejkl/hi"));
    try expect(match("*/*/*", "aaa/bba/ccc"));
    try expect(match("aaa/**", "aaa/bba/ccc"));
    try expect(match("aaa/*", "aaa/bbb"));
    try expect(match("*/*z*/*/*i", "ab/zzz/ejkl/hi"));
    try expect(match("*j*i", "abzzzejklhi"));

    try expect(match("*", "a"));
    try expect(match("*", "b"));
    try expect(!match("*", "a/a"));
    try expect(!match("*", "a/a/a"));
    try expect(!match("*", "a/a/b"));
    try expect(!match("*", "a/a/a/a"));
    try expect(!match("*", "a/a/a/a/a"));

    try expect(!match("*/*", "a"));
    try expect(match("*/*", "a/a"));
    try expect(!match("*/*", "a/a/a"));

    try expect(!match("*/*/*", "a"));
    try expect(!match("*/*/*", "a/a"));
    try expect(match("*/*/*", "a/a/a"));
    try expect(!match("*/*/*", "a/a/a/a"));

    try expect(!match("*/*/*/*", "a"));
    try expect(!match("*/*/*/*", "a/a"));
    try expect(!match("*/*/*/*", "a/a/a"));
    try expect(match("*/*/*/*", "a/a/a/a"));
    try expect(!match("*/*/*/*", "a/a/a/a/a"));

    try expect(!match("*/*/*/*/*", "a"));
    try expect(!match("*/*/*/*/*", "a/a"));
    try expect(!match("*/*/*/*/*", "a/a/a"));
    try expect(!match("*/*/*/*/*", "a/a/b"));
    try expect(!match("*/*/*/*/*", "a/a/a/a"));
    try expect(match("*/*/*/*/*", "a/a/a/a/a"));
    try expect(!match("*/*/*/*/*", "a/a/a/a/a/a"));

    try expect(!match("a/*", "a"));
    try expect(match("a/*", "a/a"));
    try expect(!match("a/*", "a/a/a"));
    try expect(!match("a/*", "a/a/a/a"));
    try expect(!match("a/*", "a/a/a/a/a"));

    try expect(!match("a/*/*", "a"));
    try expect(!match("a/*/*", "a/a"));
    try expect(match("a/*/*", "a/a/a"));
    try expect(!match("a/*/*", "b/a/a"));
    try expect(!match("a/*/*", "a/a/a/a"));
    try expect(!match("a/*/*", "a/a/a/a/a"));

    try expect(!match("a/*/*/*", "a"));
    try expect(!match("a/*/*/*", "a/a"));
    try expect(!match("a/*/*/*", "a/a/a"));
    try expect(match("a/*/*/*", "a/a/a/a"));
    try expect(!match("a/*/*/*", "a/a/a/a/a"));

    try expect(!match("a/*/*/*/*", "a"));
    try expect(!match("a/*/*/*/*", "a/a"));
    try expect(!match("a/*/*/*/*", "a/a/a"));
    try expect(!match("a/*/*/*/*", "a/a/b"));
    try expect(!match("a/*/*/*/*", "a/a/a/a"));
    try expect(match("a/*/*/*/*", "a/a/a/a/a"));

    try expect(!match("a/*/a", "a"));
    try expect(!match("a/*/a", "a/a"));
    try expect(match("a/*/a", "a/a/a"));
    try expect(!match("a/*/a", "a/a/b"));
    try expect(!match("a/*/a", "a/a/a/a"));
    try expect(!match("a/*/a", "a/a/a/a/a"));

    try expect(!match("a/*/b", "a"));
    try expect(!match("a/*/b", "a/a"));
    try expect(!match("a/*/b", "a/a/a"));
    try expect(match("a/*/b", "a/a/b"));
    try expect(!match("a/*/b", "a/a/a/a"));
    try expect(!match("a/*/b", "a/a/a/a/a"));

    try expect(!match("*/**/a", "a"));
    try expect(!match("*/**/a", "a/a/b"));
    try expect(match("*/**/a", "a/a"));
    try expect(match("*/**/a", "a/a/a"));
    try expect(match("*/**/a", "a/a/a/a"));
    try expect(match("*/**/a", "a/a/a/a/a"));

    try expect(!match("*/", "a"));
    try expect(!match("*/*", "a"));
    try expect(!match("a/*", "a"));
    // try expect(!match("*/*", "a/"));
    // try expect(!match("a/*", "a/"));
    try expect(!match("*", "a/a"));
    try expect(!match("*/", "a/a"));
    try expect(!match("*/", "a/x/y"));
    try expect(!match("*/*", "a/x/y"));
    try expect(!match("a/*", "a/x/y"));
    // try expect(match("*", "a/"));
    try expect(match("*", "a"));
    try expect(match("*/", "a/"));
    try expect(match("*{,/}", "a/"));
    try expect(match("*/*", "a/a"));
    try expect(match("a/*", "a/a"));

    try expect(!match("a/**/*.txt", "a.txt"));
    try expect(match("a/**/*.txt", "a/x/y.txt"));
    try expect(!match("a/**/*.txt", "a/x/y/z"));

    try expect(!match("a/*.txt", "a.txt"));
    try expect(match("a/*.txt", "a/b.txt"));
    try expect(!match("a/*.txt", "a/x/y.txt"));
    try expect(!match("a/*.txt", "a/x/y/z"));

    try expect(match("a*.txt", "a.txt"));
    try expect(!match("a*.txt", "a/b.txt"));
    try expect(!match("a*.txt", "a/x/y.txt"));
    try expect(!match("a*.txt", "a/x/y/z"));

    try expect(match("*.txt", "a.txt"));
    try expect(!match("*.txt", "a/b.txt"));
    try expect(!match("*.txt", "a/x/y.txt"));
    try expect(!match("*.txt", "a/x/y/z"));

    try expect(!match("a*", "a/b"));
    try expect(!match("a/**/b", "a/a/bb"));
    try expect(!match("a/**/b", "a/bb"));

    try expect(!match("*/**", "foo"));
    try expect(!match("**/", "foo/bar"));
    try expect(!match("**/*/", "foo/bar"));
    try expect(!match("*/*/", "foo/bar"));

    try expect(match("**/..", "/home/foo/.."));
    try expect(match("**/a", "a"));
    try expect(match("**", "a/a"));
    try expect(match("a/**", "a/a"));
    try expect(match("a/**", "a/"));
    // try expect(match("a/**", "a"));
    try expect(!match("**/", "a/a"));
    // try expect(match("**/a/**", "a"));
    // try expect(match("a/**", "a"));
    try expect(!match("**/", "a/a"));
    try expect(match("*/**/a", "a/a"));
    // try expect(match("a/**", "a"));
    try expect(match("*/**", "foo/"));
    try expect(match("**/*", "foo/bar"));
    try expect(match("*/*", "foo/bar"));
    try expect(match("*/**", "foo/bar"));
    try expect(match("**/", "foo/bar/"));
    // try expect(match("**/*", "foo/bar/"));
    try expect(match("**/*/", "foo/bar/"));
    try expect(match("*/**", "foo/bar/"));
    try expect(match("*/*/", "foo/bar/"));

    try expect(!match("*/foo", "bar/baz/foo"));
    try expect(!match("**/bar/*", "deep/foo/bar"));
    try expect(!match("*/bar/**", "deep/foo/bar/baz/x"));
    try expect(!match("/*", "ef"));
    try expect(!match("foo?bar", "foo/bar"));
    try expect(!match("**/bar*", "foo/bar/baz"));
    // try expect(!match("**/bar**", "foo/bar/baz"));
    try expect(!match("foo**bar", "foo/baz/bar"));
    try expect(!match("foo*bar", "foo/baz/bar"));
    // try expect(match("foo/**", "foo"));
    try expect(match("/*", "/ab"));
    try expect(match("/*", "/cd"));
    try expect(match("/*", "/ef"));
    try expect(match("a/**/j/**/z/*.md", "a/b/j/c/z/x.md"));
    try expect(match("a/**/j/**/z/*.md", "a/j/z/x.md"));

    try expect(match("**/foo", "bar/baz/foo"));
    try expect(match("**/bar/*", "deep/foo/bar/baz"));
    try expect(match("**/bar/**", "deep/foo/bar/baz/"));
    try expect(match("**/bar/*/*", "deep/foo/bar/baz/x"));
    try expect(match("foo/**/**/bar", "foo/b/a/z/bar"));
    try expect(match("foo/**/bar", "foo/b/a/z/bar"));
    try expect(match("foo/**/**/bar", "foo/bar"));
    try expect(match("foo/**/bar", "foo/bar"));
    try expect(match("*/bar/**", "foo/bar/baz/x"));
    try expect(match("foo/**/**/bar", "foo/baz/bar"));
    try expect(match("foo/**/bar", "foo/baz/bar"));
    try expect(match("**/foo", "XXX/foo"));
}

test "globstars" {
    try expect(match("**/*.js", "a/b/c/d.js"));
    try expect(match("**/*.js", "a/b/c.js"));
    try expect(match("**/*.js", "a/b.js"));
    try expect(match("a/b/**/*.js", "a/b/c/d/e/f.js"));
    try expect(match("a/b/**/*.js", "a/b/c/d/e.js"));
    try expect(match("a/b/c/**/*.js", "a/b/c/d.js"));
    try expect(match("a/b/**/*.js", "a/b/c/d.js"));
    try expect(match("a/b/**/*.js", "a/b/d.js"));
    try expect(!match("a/b/**/*.js", "a/d.js"));
    try expect(!match("a/b/**/*.js", "d.js"));

    try expect(!match("**c", "a/b/c"));
    try expect(!match("a/**c", "a/b/c"));
    try expect(!match("a/**z", "a/b/c"));
    try expect(!match("a/**b**/c", "a/b/c/b/c"));
    try expect(!match("a/b/c**/*.js", "a/b/c/d/e.js"));
    try expect(match("a/**/b/**/c", "a/b/c/b/c"));
    try expect(match("a/**b**/c", "a/aba/c"));
    try expect(match("a/**b**/c", "a/b/c"));
    try expect(match("a/b/c**/*.js", "a/b/c/d.js"));

    try expect(!match("a/**/*", "a"));
    try expect(!match("a/**/**/*", "a"));
    try expect(!match("a/**/**/**/*", "a"));
    try expect(!match("**/a", "a/"));
    try expect(!match("a/**/*", "a/"));
    try expect(!match("a/**/**/*", "a/"));
    try expect(!match("a/**/**/**/*", "a/"));
    try expect(!match("**/a", "a/b"));
    try expect(!match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
    try expect(!match("a/**/b", "a/bb"));
    try expect(!match("**/a", "a/c"));
    try expect(!match("**/a", "a/b"));
    try expect(!match("**/a", "a/x/y"));
    try expect(!match("**/a", "a/b/c/d"));
    try expect(match("**", "a"));
    try expect(match("**/a", "a"));
    // try expect(match("a/**", "a"));
    try expect(match("**", "a/"));
    try expect(match("**/a/**", "a/"));
    try expect(match("a/**", "a/"));
    try expect(match("a/**/**", "a/"));
    try expect(match("**/a", "a/a"));
    try expect(match("**", "a/b"));
    try expect(match("*/*", "a/b"));
    try expect(match("a/**", "a/b"));
    try expect(match("a/**/*", "a/b"));
    try expect(match("a/**/**/*", "a/b"));
    try expect(match("a/**/**/**/*", "a/b"));
    try expect(match("a/**/b", "a/b"));
    try expect(match("**", "a/b/c"));
    try expect(match("**/*", "a/b/c"));
    try expect(match("**/**", "a/b/c"));
    try expect(match("*/**", "a/b/c"));
    try expect(match("a/**", "a/b/c"));
    try expect(match("a/**/*", "a/b/c"));
    try expect(match("a/**/**/*", "a/b/c"));
    try expect(match("a/**/**/**/*", "a/b/c"));
    try expect(match("**", "a/b/c/d"));
    try expect(match("a/**", "a/b/c/d"));
    try expect(match("a/**/*", "a/b/c/d"));
    try expect(match("a/**/**/*", "a/b/c/d"));
    try expect(match("a/**/**/**/*", "a/b/c/d"));
    try expect(match("a/b/**/c/**/*.*", "a/b/c/d.e"));
    try expect(match("a/**/f/*.md", "a/b/c/d/e/f/g.md"));
    try expect(match("a/**/f/**/k/*.md", "a/b/c/d/e/f/g/h/i/j/k/l.md"));
    try expect(match("a/b/c/*.md", "a/b/c/def.md"));
    try expect(match("a/*/c/*.md", "a/bb.bb/c/ddd.md"));
    try expect(match("a/**/f/*.md", "a/bb.bb/cc/d.d/ee/f/ggg.md"));
    try expect(match("a/**/f/*.md", "a/bb.bb/cc/dd/ee/f/ggg.md"));
    try expect(match("a/*/c/*.md", "a/bb/c/ddd.md"));
    try expect(match("a/*/c/*.md", "a/bbbb/c/ddd.md"));

    try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/image.png"));
    try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/two/image.png"));
    try expect(match("foo/bar/**/one/**/*.*", "foo/bar/baz/one/two/three/image.png"));
    try expect(!match("a/b/**/f", "a/b/c/d/"));
    // try expect(match("a/**", "a"));
    try expect(match("**", "a"));
    // try expect(match("a{,/**}", "a"));
    try expect(match("**", "a/"));
    try expect(match("a/**", "a/"));
    try expect(match("**", "a/b/c/d"));
    try expect(match("**", "a/b/c/d/"));
    try expect(match("**/**", "a/b/c/d/"));
    try expect(match("**/b/**", "a/b/c/d/"));
    try expect(match("a/b/**", "a/b/c/d/"));
    try expect(match("a/b/**/", "a/b/c/d/"));
    try expect(match("a/b/**/c/**/", "a/b/c/d/"));
    try expect(match("a/b/**/c/**/d/", "a/b/c/d/"));
    try expect(match("a/b/**/**/*.*", "a/b/c/d/e.f"));
    try expect(match("a/b/**/*.*", "a/b/c/d/e.f"));
    try expect(match("a/b/**/c/**/d/*.*", "a/b/c/d/e.f"));
    try expect(match("a/b/**/d/**/*.*", "a/b/c/d/e.f"));
    try expect(match("a/b/**/d/**/*.*", "a/b/c/d/g/e.f"));
    try expect(match("a/b/**/d/**/*.*", "a/b/c/d/g/g/e.f"));
    try expect(match("a/b-*/**/z.js", "a/b-c/z.js"));
    try expect(match("a/b-*/**/z.js", "a/b-c/d/e/z.js"));

    try expect(match("*/*", "a/b"));
    try expect(match("a/b/c/*.md", "a/b/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bb.bb/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bb/c/xyz.md"));
    try expect(match("a/*/c/*.md", "a/bbbb/c/xyz.md"));

    try expect(match("**/*", "a/b/c"));
    try expect(match("**/**", "a/b/c"));
    try expect(match("*/**", "a/b/c"));
    try expect(match("a/**/j/**/z/*.md", "a/b/c/d/e/j/n/p/o/z/c.md"));
    try expect(match("a/**/z/*.md", "a/b/c/d/e/z/c.md"));
    try expect(match("a/**/c/*.md", "a/bb.bb/aa/b.b/aa/c/xyz.md"));
    try expect(match("a/**/c/*.md", "a/bb.bb/aa/bb/aa/c/xyz.md"));
    try expect(!match("a/**/j/**/z/*.md", "a/b/c/j/e/z/c.txt"));
    try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
    try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
    try expect(!match("a/**/", "a/b"));
    // try expect(!match("**/*", "a/b/.js/c.txt"));
    try expect(!match("a/**/", "a/b/c/d"));
    try expect(!match("a/**/", "a/bb"));
    try expect(!match("a/**/", "a/cb"));
    try expect(match("/**", "/a/b"));
    try expect(match("**/*", "a.b"));
    try expect(match("**/*", "a.js"));
    try expect(match("**/*.js", "a.js"));
    // try expect(match("a/**/", "a/"));
    try expect(match("**/*.js", "a/a.js"));
    try expect(match("**/*.js", "a/a/b.js"));
    try expect(match("a/**/b", "a/b"));
    try expect(match("a/**b", "a/b"));
    try expect(match("**/*.md", "a/b.md"));
    try expect(match("**/*", "a/b/c.js"));
    try expect(match("**/*", "a/b/c.txt"));
    try expect(match("a/**/", "a/b/c/d/"));
    try expect(match("**/*", "a/b/c/d/a.js"));
    try expect(match("a/b/**/*.js", "a/b/c/z.js"));
    try expect(match("a/b/**/*.js", "a/b/z.js"));
    try expect(match("**/*", "ab"));
    try expect(match("**/*", "ab/c"));
    try expect(match("**/*", "ab/c/d"));
    try expect(match("**/*", "abc.js"));

    try expect(!match("**/", "a"));
    try expect(!match("**/a/*", "a"));
    try expect(!match("**/a/*/*", "a"));
    try expect(!match("*/a/**", "a"));
    try expect(!match("a/**/*", "a"));
    try expect(!match("a/**/**/*", "a"));
    try expect(!match("**/", "a/b"));
    try expect(!match("**/b/*", "a/b"));
    try expect(!match("**/b/*/*", "a/b"));
    try expect(!match("b/**", "a/b"));
    try expect(!match("**/", "a/b/c"));
    try expect(!match("**/**/b", "a/b/c"));
    try expect(!match("**/b", "a/b/c"));
    try expect(!match("**/b/*/*", "a/b/c"));
    try expect(!match("b/**", "a/b/c"));
    try expect(!match("**/", "a/b/c/d"));
    try expect(!match("**/d/*", "a/b/c/d"));
    try expect(!match("b/**", "a/b/c/d"));
    try expect(match("**", "a"));
    try expect(match("**/**", "a"));
    try expect(match("**/**/*", "a"));
    try expect(match("**/**/a", "a"));
    try expect(match("**/a", "a"));
    // try expect(match("**/a/**", "a"));
    // try expect(match("a/**", "a"));
    try expect(match("**", "a/b"));
    try expect(match("**/**", "a/b"));
    try expect(match("**/**/*", "a/b"));
    try expect(match("**/**/b", "a/b"));
    try expect(match("**/b", "a/b"));
    // try expect(match("**/b/**", "a/b"));
    // try expect(match("*/b/**", "a/b"));
    try expect(match("a/**", "a/b"));
    try expect(match("a/**/*", "a/b"));
    try expect(match("a/**/**/*", "a/b"));
    try expect(match("**", "a/b/c"));
    try expect(match("**/**", "a/b/c"));
    try expect(match("**/**/*", "a/b/c"));
    try expect(match("**/b/*", "a/b/c"));
    try expect(match("**/b/**", "a/b/c"));
    try expect(match("*/b/**", "a/b/c"));
    try expect(match("a/**", "a/b/c"));
    try expect(match("a/**/*", "a/b/c"));
    try expect(match("a/**/**/*", "a/b/c"));
    try expect(match("**", "a/b/c/d"));
    try expect(match("**/**", "a/b/c/d"));
    try expect(match("**/**/*", "a/b/c/d"));
    try expect(match("**/**/d", "a/b/c/d"));
    try expect(match("**/b/**", "a/b/c/d"));
    try expect(match("**/b/*/*", "a/b/c/d"));
    try expect(match("**/d", "a/b/c/d"));
    try expect(match("*/b/**", "a/b/c/d"));
    try expect(match("a/**", "a/b/c/d"));
    try expect(match("a/**/*", "a/b/c/d"));
    try expect(match("a/**/**/*", "a/b/c/d"));
}

test "utf8" {
    try expect(match("フ*/**/*", "フォルダ/aaa.js"));
    try expect(match("フォ*/**/*", "フォルダ/aaa.js"));
    try expect(match("フォル*/**/*", "フォルダ/aaa.js"));
    try expect(match("フ*ル*/**/*", "フォルダ/aaa.js"));
    try expect(match("フォルダ/**/*", "フォルダ/aaa.js"));
}

test "negation" {
    try expect(!match("!*", "abc"));
    try expect(!match("!abc", "abc"));
    try expect(!match("*!.md", "bar.md"));
    try expect(!match("foo!.md", "bar.md"));
    try expect(!match("\\!*!*.md", "foo!.md"));
    try expect(!match("\\!*!*.md", "foo!bar.md"));
    try expect(match("*!*.md", "!foo!.md"));
    try expect(match("\\!*!*.md", "!foo!.md"));
    try expect(match("!*foo", "abc"));
    try expect(match("!foo*", "abc"));
    try expect(match("!xyz", "abc"));
    try expect(match("*!*.*", "ba!r.js"));
    try expect(match("*.md", "bar.md"));
    try expect(match("*!*.*", "foo!.md"));
    try expect(match("*!*.md", "foo!.md"));
    try expect(match("*!.md", "foo!.md"));
    try expect(match("*.md", "foo!.md"));
    try expect(match("foo!.md", "foo!.md"));
    try expect(match("*!*.md", "foo!bar.md"));
    try expect(match("*b*.md", "foobar.md"));

    try expect(!match("a!!b", "a"));
    try expect(!match("a!!b", "aa"));
    try expect(!match("a!!b", "a/b"));
    try expect(!match("a!!b", "a!b"));
    try expect(match("a!!b", "a!!b"));
    try expect(!match("a!!b", "a/!!/b"));

    try expect(!match("!a/b", "a/b"));
    try expect(match("!a/b", "a"));
    try expect(match("!a/b", "a.b"));
    try expect(match("!a/b", "a/a"));
    try expect(match("!a/b", "a/c"));
    try expect(match("!a/b", "b/a"));
    try expect(match("!a/b", "b/b"));
    try expect(match("!a/b", "b/c"));

    try expect(!match("!abc", "abc"));
    try expect(match("!!abc", "abc"));
    try expect(!match("!!!abc", "abc"));
    try expect(match("!!!!abc", "abc"));
    try expect(!match("!!!!!abc", "abc"));
    try expect(match("!!!!!!abc", "abc"));
    try expect(!match("!!!!!!!abc", "abc"));
    try expect(match("!!!!!!!!abc", "abc"));

    // try expect(!match("!(*/*)", "a/a"));
    // try expect(!match("!(*/*)", "a/b"));
    // try expect(!match("!(*/*)", "a/c"));
    // try expect(!match("!(*/*)", "b/a"));
    // try expect(!match("!(*/*)", "b/b"));
    // try expect(!match("!(*/*)", "b/c"));
    // try expect(!match("!(*/b)", "a/b"));
    // try expect(!match("!(*/b)", "b/b"));
    // try expect(!match("!(a/b)", "a/b"));
    try expect(!match("!*", "a"));
    try expect(!match("!*", "a.b"));
    try expect(!match("!*/*", "a/a"));
    try expect(!match("!*/*", "a/b"));
    try expect(!match("!*/*", "a/c"));
    try expect(!match("!*/*", "b/a"));
    try expect(!match("!*/*", "b/b"));
    try expect(!match("!*/*", "b/c"));
    try expect(!match("!*/b", "a/b"));
    try expect(!match("!*/b", "b/b"));
    try expect(!match("!*/c", "a/c"));
    try expect(!match("!*/c", "a/c"));
    try expect(!match("!*/c", "b/c"));
    try expect(!match("!*/c", "b/c"));
    try expect(!match("!*a*", "bar"));
    try expect(!match("!*a*", "fab"));
    // try expect(!match("!a/(*)", "a/a"));
    // try expect(!match("!a/(*)", "a/b"));
    // try expect(!match("!a/(*)", "a/c"));
    // try expect(!match("!a/(b)", "a/b"));
    try expect(!match("!a/*", "a/a"));
    try expect(!match("!a/*", "a/b"));
    try expect(!match("!a/*", "a/c"));
    try expect(!match("!f*b", "fab"));
    // try expect(match("!(*/*)", "a"));
    // try expect(match("!(*/*)", "a.b"));
    // try expect(match("!(*/b)", "a"));
    // try expect(match("!(*/b)", "a.b"));
    // try expect(match("!(*/b)", "a/a"));
    // try expect(match("!(*/b)", "a/c"));
    // try expect(match("!(*/b)", "b/a"));
    // try expect(match("!(*/b)", "b/c"));
    // try expect(match("!(a/b)", "a"));
    // try expect(match("!(a/b)", "a.b"));
    // try expect(match("!(a/b)", "a/a"));
    // try expect(match("!(a/b)", "a/c"));
    // try expect(match("!(a/b)", "b/a"));
    // try expect(match("!(a/b)", "b/b"));
    // try expect(match("!(a/b)", "b/c"));
    try expect(match("!*", "a/a"));
    try expect(match("!*", "a/b"));
    try expect(match("!*", "a/c"));
    try expect(match("!*", "b/a"));
    try expect(match("!*", "b/b"));
    try expect(match("!*", "b/c"));
    try expect(match("!*/*", "a"));
    try expect(match("!*/*", "a.b"));
    try expect(match("!*/b", "a"));
    try expect(match("!*/b", "a.b"));
    try expect(match("!*/b", "a/a"));
    try expect(match("!*/b", "a/c"));
    try expect(match("!*/b", "b/a"));
    try expect(match("!*/b", "b/c"));
    try expect(match("!*/c", "a"));
    try expect(match("!*/c", "a.b"));
    try expect(match("!*/c", "a/a"));
    try expect(match("!*/c", "a/b"));
    try expect(match("!*/c", "b/a"));
    try expect(match("!*/c", "b/b"));
    try expect(match("!*a*", "foo"));
    // try expect(match("!a/(*)", "a"));
    // try expect(match("!a/(*)", "a.b"));
    // try expect(match("!a/(*)", "b/a"));
    // try expect(match("!a/(*)", "b/b"));
    // try expect(match("!a/(*)", "b/c"));
    // try expect(match("!a/(b)", "a"));
    // try expect(match("!a/(b)", "a.b"));
    // try expect(match("!a/(b)", "a/a"));
    // try expect(match("!a/(b)", "a/c"));
    // try expect(match("!a/(b)", "b/a"));
    // try expect(match("!a/(b)", "b/b"));
    // try expect(match("!a/(b)", "b/c"));
    try expect(match("!a/*", "a"));
    try expect(match("!a/*", "a.b"));
    try expect(match("!a/*", "b/a"));
    try expect(match("!a/*", "b/b"));
    try expect(match("!a/*", "b/c"));
    try expect(match("!f*b", "bar"));
    try expect(match("!f*b", "foo"));

    try expect(!match("!.md", ".md"));
    try expect(match("!**/*.md", "a.js"));
    // try expect(!match("!**/*.md", "b.md"));
    try expect(match("!**/*.md", "c.txt"));
    try expect(match("!*.md", "a.js"));
    try expect(!match("!*.md", "b.md"));
    try expect(match("!*.md", "c.txt"));
    try expect(!match("!*.md", "abc.md"));
    try expect(match("!*.md", "abc.txt"));
    try expect(!match("!*.md", "foo.md"));
    try expect(match("!.md", "foo.md"));

    try expect(match("!*.md", "a.js"));
    try expect(match("!*.md", "b.txt"));
    try expect(!match("!*.md", "c.md"));
    try expect(!match("!a/*/a.js", "a/a/a.js"));
    try expect(!match("!a/*/a.js", "a/b/a.js"));
    try expect(!match("!a/*/a.js", "a/c/a.js"));
    try expect(!match("!a/*/*/a.js", "a/a/a/a.js"));
    try expect(match("!a/*/*/a.js", "b/a/b/a.js"));
    try expect(match("!a/*/*/a.js", "c/a/c/a.js"));
    try expect(!match("!a/a*.txt", "a/a.txt"));
    try expect(match("!a/a*.txt", "a/b.txt"));
    try expect(match("!a/a*.txt", "a/c.txt"));
    try expect(!match("!a.a*.txt", "a.a.txt"));
    try expect(match("!a.a*.txt", "a.b.txt"));
    try expect(match("!a.a*.txt", "a.c.txt"));
    try expect(!match("!a/*.txt", "a/a.txt"));
    try expect(!match("!a/*.txt", "a/b.txt"));
    try expect(!match("!a/*.txt", "a/c.txt"));

    try expect(match("!*.md", "a.js"));
    try expect(match("!*.md", "b.txt"));
    try expect(!match("!*.md", "c.md"));
    // try expect(!match("!**/a.js", "a/a/a.js"));
    // try expect(!match("!**/a.js", "a/b/a.js"));
    // try expect(!match("!**/a.js", "a/c/a.js"));
    try expect(match("!**/a.js", "a/a/b.js"));
    try expect(!match("!a/**/a.js", "a/a/a/a.js"));
    try expect(match("!a/**/a.js", "b/a/b/a.js"));
    try expect(match("!a/**/a.js", "c/a/c/a.js"));
    try expect(match("!**/*.md", "a/b.js"));
    try expect(match("!**/*.md", "a.js"));
    try expect(!match("!**/*.md", "a/b.md"));
    // try expect(!match("!**/*.md", "a.md"));
    try expect(!match("**/*.md", "a/b.js"));
    try expect(!match("**/*.md", "a.js"));
    try expect(match("**/*.md", "a/b.md"));
    try expect(match("**/*.md", "a.md"));
    try expect(match("!**/*.md", "a/b.js"));
    try expect(match("!**/*.md", "a.js"));
    try expect(!match("!**/*.md", "a/b.md"));
    // try expect(!match("!**/*.md", "a.md"));
    try expect(match("!*.md", "a/b.js"));
    try expect(match("!*.md", "a.js"));
    try expect(match("!*.md", "a/b.md"));
    try expect(!match("!*.md", "a.md"));
    try expect(match("!**/*.md", "a.js"));
    // try expect(!match("!**/*.md", "b.md"));
    try expect(match("!**/*.md", "c.txt"));
}

test "question_mark" {
    try expect(match("?", "a"));
    try expect(!match("?", "aa"));
    try expect(!match("?", "ab"));
    try expect(!match("?", "aaa"));
    try expect(!match("?", "abcdefg"));

    try expect(!match("??", "a"));
    try expect(match("??", "aa"));
    try expect(match("??", "ab"));
    try expect(!match("??", "aaa"));
    try expect(!match("??", "abcdefg"));

    try expect(!match("???", "a"));
    try expect(!match("???", "aa"));
    try expect(!match("???", "ab"));
    try expect(match("???", "aaa"));
    try expect(!match("???", "abcdefg"));

    try expect(!match("a?c", "aaa"));
    try expect(match("a?c", "aac"));
    try expect(match("a?c", "abc"));
    try expect(!match("ab?", "a"));
    try expect(!match("ab?", "aa"));
    try expect(!match("ab?", "ab"));
    try expect(!match("ab?", "ac"));
    try expect(!match("ab?", "abcd"));
    try expect(!match("ab?", "abbb"));
    try expect(match("a?b", "acb"));

    try expect(!match("a/?/c/?/e.md", "a/bb/c/dd/e.md"));
    try expect(match("a/??/c/??/e.md", "a/bb/c/dd/e.md"));
    try expect(!match("a/??/c.md", "a/bbb/c.md"));
    try expect(match("a/?/c.md", "a/b/c.md"));
    try expect(match("a/?/c/?/e.md", "a/b/c/d/e.md"));
    try expect(!match("a/?/c/???/e.md", "a/b/c/d/e.md"));
    try expect(match("a/?/c/???/e.md", "a/b/c/zzz/e.md"));
    try expect(!match("a/?/c.md", "a/bb/c.md"));
    try expect(match("a/??/c.md", "a/bb/c.md"));
    try expect(match("a/???/c.md", "a/bbb/c.md"));
    try expect(match("a/????/c.md", "a/bbbb/c.md"));
}

test "braces" {
    try expect(match("{a,b,c}", "a"));
    try expect(match("{a,b,c}", "b"));
    try expect(match("{a,b,c}", "c"));
    try expect(!match("{a,b,c}", "aa"));
    try expect(!match("{a,b,c}", "bb"));
    try expect(!match("{a,b,c}", "cc"));

    try expect(match("a/{a,b}", "a/a"));
    try expect(match("a/{a,b}", "a/b"));
    try expect(!match("a/{a,b}", "a/c"));
    try expect(!match("a/{a,b}", "b/b"));
    try expect(!match("a/{a,b,c}", "b/b"));
    try expect(match("a/{a,b,c}", "a/c"));
    try expect(match("a{b,bc}.txt", "abc.txt"));

    try expect(match("foo[{a,b}]baz", "foo{baz"));

    try expect(!match("a{,b}.txt", "abc.txt"));
    try expect(!match("a{a,b,}.txt", "abc.txt"));
    try expect(!match("a{b,}.txt", "abc.txt"));
    try expect(match("a{,b}.txt", "a.txt"));
    try expect(match("a{b,}.txt", "a.txt"));
    try expect(match("a{a,b,}.txt", "aa.txt"));
    try expect(match("a{a,b,}.txt", "aa.txt"));
    try expect(match("a{,b}.txt", "ab.txt"));
    try expect(match("a{b,}.txt", "ab.txt"));

    // try expect(match("{a/,}a/**", "a"));
    try expect(match("a{a,b/}*.txt", "aa.txt"));
    try expect(match("a{a,b/}*.txt", "ab/.txt"));
    try expect(match("a{a,b/}*.txt", "ab/a.txt"));
    // try expect(match("{a/,}a/**", "a/"));
    try expect(match("{a/,}a/**", "a/a/"));
    // try expect(match("{a/,}a/**", "a/a"));
    try expect(match("{a/,}a/**", "a/a/a"));
    try expect(match("{a/,}a/**", "a/a/"));
    try expect(match("{a/,}a/**", "a/a/a/"));
    try expect(match("{a/,}b/**", "a/b/a/"));
    try expect(match("{a/,}b/**", "b/a/"));
    try expect(match("a{,/}*.txt", "a.txt"));
    try expect(match("a{,/}*.txt", "ab.txt"));
    try expect(match("a{,/}*.txt", "a/b.txt"));
    try expect(match("a{,/}*.txt", "a/ab.txt"));

    try expect(match("a{,.*{foo,db},\\(bar\\)}.txt", "a.txt"));
    try expect(!match("a{,.*{foo,db},\\(bar\\)}.txt", "adb.txt"));
    try expect(match("a{,.*{foo,db},\\(bar\\)}.txt", "a.db.txt"));

    try expect(match("a{,*.{foo,db},\\(bar\\)}.txt", "a.txt"));
    try expect(!match("a{,*.{foo,db},\\(bar\\)}.txt", "adb.txt"));
    try expect(match("a{,*.{foo,db},\\(bar\\)}.txt", "a.db.txt"));

    // try expect(match("a{,.*{foo,db},\\(bar\\)}", "a"));
    try expect(!match("a{,.*{foo,db},\\(bar\\)}", "adb"));
    try expect(match("a{,.*{foo,db},\\(bar\\)}", "a.db"));

    // try expect(match("a{,*.{foo,db},\\(bar\\)}", "a"));
    try expect(!match("a{,*.{foo,db},\\(bar\\)}", "adb"));
    try expect(match("a{,*.{foo,db},\\(bar\\)}", "a.db"));

    try expect(!match("{,.*{foo,db},\\(bar\\)}", "a"));
    try expect(!match("{,.*{foo,db},\\(bar\\)}", "adb"));
    try expect(!match("{,.*{foo,db},\\(bar\\)}", "a.db"));
    try expect(match("{,.*{foo,db},\\(bar\\)}", ".db"));

    try expect(!match("{,*.{foo,db},\\(bar\\)}", "a"));
    try expect(match("{*,*.{foo,db},\\(bar\\)}", "a"));
    try expect(!match("{,*.{foo,db},\\(bar\\)}", "adb"));
    try expect(match("{,*.{foo,db},\\(bar\\)}", "a.db"));

    try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/c/xyz.md"));
    try expect(!match("a/b/**/c{d,e}/**/xyz.md", "a/b/d/xyz.md"));
    try expect(match("a/b/**/c{d,e}/**/xyz.md", "a/b/cd/xyz.md"));
    try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/c/xyz.md"));
    try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/d/xyz.md"));
    try expect(match("a/b/**/{c,d,e}/**/xyz.md", "a/b/e/xyz.md"));

    try expect(match("*{a,b}*", "xax"));
    try expect(match("*{a,b}*", "xxax"));
    try expect(match("*{a,b}*", "xbx"));

    try expect(match("*{*a,b}", "xba"));
    try expect(match("*{*a,b}", "xb"));

    try expect(!match("*??", "a"));
    try expect(!match("*???", "aa"));
    try expect(match("*???", "aaa"));
    try expect(!match("*****??", "a"));
    try expect(!match("*****???", "aa"));
    try expect(match("*****???", "aaa"));

    try expect(!match("a*?c", "aaa"));
    try expect(match("a*?c", "aac"));
    try expect(match("a*?c", "abc"));

    try expect(match("a**?c", "abc"));
    try expect(!match("a**?c", "abb"));
    try expect(match("a**?c", "acc"));
    try expect(match("a*****?c", "abc"));

    try expect(match("*****?", "a"));
    try expect(match("*****?", "aa"));
    try expect(match("*****?", "abc"));
    try expect(match("*****?", "zzz"));
    try expect(match("*****?", "bbb"));
    try expect(match("*****?", "aaaa"));

    try expect(!match("*****??", "a"));
    try expect(match("*****??", "aa"));
    try expect(match("*****??", "abc"));
    try expect(match("*****??", "zzz"));
    try expect(match("*****??", "bbb"));
    try expect(match("*****??", "aaaa"));

    try expect(!match("?*****??", "a"));
    try expect(!match("?*****??", "aa"));
    try expect(match("?*****??", "abc"));
    try expect(match("?*****??", "zzz"));
    try expect(match("?*****??", "bbb"));
    try expect(match("?*****??", "aaaa"));

    try expect(match("?*****?c", "abc"));
    try expect(!match("?*****?c", "abb"));
    try expect(!match("?*****?c", "zzz"));

    try expect(match("?***?****c", "abc"));
    try expect(!match("?***?****c", "bbb"));
    try expect(!match("?***?****c", "zzz"));

    try expect(match("?***?****?", "abc"));
    try expect(match("?***?****?", "bbb"));
    try expect(match("?***?****?", "zzz"));

    try expect(match("?***?****", "abc"));
    try expect(match("*******c", "abc"));
    try expect(match("*******?", "abc"));
    try expect(match("a*cd**?**??k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??k***", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??***k", "abcdecdhjk"));
    try expect(match("a**?**cd**?**??***k**", "abcdecdhjk"));
    try expect(match("a****c**?**??*****", "abcdecdhjk"));

    try expect(!match("a/?/c/?/*/e.md", "a/b/c/d/e.md"));
    try expect(match("a/?/c/?/*/e.md", "a/b/c/d/e/e.md"));
    try expect(match("a/?/c/?/*/e.md", "a/b/c/d/efghijk/e.md"));
    try expect(match("a/?/**/e.md", "a/b/c/d/efghijk/e.md"));
    try expect(!match("a/?/e.md", "a/bb/e.md"));
    try expect(match("a/??/e.md", "a/bb/e.md"));
    try expect(!match("a/?/**/e.md", "a/bb/e.md"));
    try expect(match("a/?/**/e.md", "a/b/ccc/e.md"));
    try expect(match("a/*/?/**/e.md", "a/b/c/d/efghijk/e.md"));
    try expect(match("a/*/?/**/e.md", "a/b/c/d/efgh.ijk/e.md"));
    try expect(match("a/*/?/**/e.md", "a/b.bb/c/d/efgh.ijk/e.md"));
    try expect(match("a/*/?/**/e.md", "a/bbb/c/d/efgh.ijk/e.md"));

    try expect(match("a/*/ab??.md", "a/bbb/abcd.md"));
    try expect(match("a/bbb/ab??.md", "a/bbb/abcd.md"));
    try expect(match("a/bbb/ab???md", "a/bbb/abcd.md"));
}

fn matchSame(str: []const u8) bool {
    return match(str, str);
}
test "fuzz_tests" {
    // https://github.com/devongovett/glob-match/issues/1
    try expect(!matchSame(
        "{*{??*{??**,Uz*zz}w**{*{**a,z***b*[!}w??*azzzzzzzz*!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!z[za,z&zz}w**z*z*}",
    ));
    try expect(!matchSame(
        "**** *{*{??*{??***\x05 *{*{??*{??***0x5,\x00U\x00}]*****0x1,\x00***\x00,\x00\x00}w****,\x00U\x00}]*****0x1,\x00***\x00,\x00\x00}w*****0x1***{}*.*\x00\x00*\x00",
    ));
}
