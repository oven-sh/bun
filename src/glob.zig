const std = @import("std");
const builtin = @import("builtin");
const strings = @import("./string_immutable.zig");
const bun = @import("root").bun;
const CodepointIterator = strings.UnsignedCodepointIterator;
const Codepoint = u32;

const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

dirPatterns: ArrayList(Pattern),
allocator: Allocator,
requireDir: bool,
options: MatchOptions,

pub const MatchOptions = struct {
    /// Whether or not patterns should be matched in a case-sensitive manner.
    /// This currently only considers upper/lower case relationships between
    /// ASCII characters, but in future this might be extended to work with
    /// Unicode.
    caseSensitive: bool = true,
    /// Whether or not path-component separator characters (e.g. `/` on
    /// Posix) must be matched by a literal `/`, rather than by `*` or `?` or
    /// `[...]`.
    requireLiteralSeparator: bool = false,
    /// Whether or not paths that contain components that start with a `.`
    /// will require that `.` appears literally in the pattern; `*`, `?`, `**`,
    /// or `[...]` will not match. This is useful because such files are
    /// conventionally considered hidden on Unix systems and it might be
    /// desirable to skip them when listing files.
    requireLiteralLeadingDot: bool = false,
};

pub const MatchResult = enum {
    Match,
    SubPatternDoesntMatch,
    EntirePatternDoesntMatch,
};

pub const Pattern = struct {
    // Expected to be UTF-8/WTF-8
    original: []const u8,
    tokens: ArrayList(PatternToken),
    isRecursive: bool,

    fn deinitTokens(alloc: Allocator, tokens: *ArrayList(PatternToken)) void {
        for (tokens.items) |*tok| {
            tok.deinit(alloc);
        }
    }

    pub fn deinit(this: *Pattern, alloc: Allocator) void {
        alloc.free(this.original);
        Pattern.deinitTokens(alloc, &this.tokens);
    }

    pub fn new(alloc: Allocator, pattern: []const u8, err_pos: *u32) !Pattern {
        // var codepoints = codepoints: {
        //     var cps = std.ArrayList(Codepoint).init(alloc);
        //     _ = cps;
        //     const iter = CodepointIterator{ .bytes = pattern[0..], .i = 0 };
        //     _ = iter;
        // };
        // _ = codepoints;
        var tokens = ArrayList(PatternToken){};
        errdefer {
            Pattern.deinitTokens(alloc, &tokens);
        }
        var isRecursive = false;

        const iter = CodepointIterator{ .bytes = pattern[0..], .i = 0 };
        var cs = CursorState.init(&iter);

        while (cs.cursor.i < pattern.len) {
            switch (cs.cursor.c) {
                '?' => {
                    try tokens.append(alloc, .anyChar);
                },
                '*' => {
                    const old = cs;
                    while (cs.cursor.i < pattern.len and cs.cursor.c == '*') {
                        cs.nextCursor(&iter);
                    }

                    const count = cs.cp_idx - old.cp_idx;

                    if (count > 2) {
                        err_pos.* = old.cursor.i;
                        return PatternError.Wildcards;
                    }

                    if (count == 2) {
                        const isValid = isValid: {
                            // ** can only be an entire path component
                            // i.e. a/**/b is valid, but a**/b or a/**b is not
                            // invalid matches are treated literally
                            if (cs.cp_idx == 2 or is_separator(cs.cursor.c)) {
                                // it ends in a '/'
                                if (cs.cursor.i < pattern.len and is_separator(cs.cursor.c)) {
                                    cs.nextCursor(&iter);
                                    break :isValid true;
                                }
                                // or the pattern ends here
                                // this enables the existing globbing mechanism
                                else if (cs.cursor.i == pattern.len) {
                                    break :isValid true;
                                }
                                // `**` ends in non-separator
                                else {
                                    err_pos.* = cs.cursor.i;
                                    return PatternError.RecursiveWildcards;
                                }
                            }
                            // `**` begins with non-separator
                            else {
                                err_pos.* = old.cursor.i - old.cursor.width;
                                return PatternError.RecursiveWildcards;
                            }
                        };

                        if (isValid) {
                            // collapse consecutive AnyRecursiveSequence to a
                            // single one

                            const tokensLen = tokens.items.len;

                            if (!(tokensLen > 1 and tokens.items[tokensLen - 1] == .anyRecursiveSequence)) {
                                isRecursive = true;
                                try tokens.append(alloc, .anyRecursiveSequence);
                            }
                        }
                    } else {
                        try tokens.append(alloc, .anySequence);
                    }
                },
                '[' => {
                    const peek1 = cs.peek(&iter);
                    const peek2 = peek1.peek(&iter);
                    const peek3 = peek2.peek(&iter);
                    const peek4 = peek3.peek(&iter);

                    // Try [!...]
                    if (peek4.cursor.i <= pattern.len and peek1.cursor.c == '!') {
                        const maybeClosingBrace = closingBrace: {
                            var innerIter = peek3;
                            while (innerIter.cursor.i < pattern.len) {
                                if (innerIter.cursor.c == ']') break :closingBrace innerIter;
                                innerIter.nextCursor(&iter);
                            }
                            break :closingBrace null;
                        };

                        if (maybeClosingBrace) |closingBrace| {
                            const substr = pattern[peek2.cursor.i .. closingBrace.cursor.i + closingBrace.cursor.width];
                            const charSpecifiers = try parseCharSpecifiers(alloc, substr);
                            try tokens.append(alloc, .{ .anyExcept = charSpecifiers });
                            cs = peek4;
                            continue;
                        }
                    }
                    // Try [...]
                    else if (peek3.cursor.i <= pattern.len and peek1.cursor.c != '!') {
                        const maybeClosingBrace = closingBrace: {
                            var innerIter = peek2;
                            while (innerIter.cursor.i < pattern.len) {
                                if (innerIter.cursor.c == ']') break :closingBrace innerIter;
                                innerIter.nextCursor(&iter);
                            }
                            break :closingBrace null;
                        };

                        if (maybeClosingBrace) |closingBrace| {
                            const substr = pattern[peek1.cursor.i .. closingBrace.cursor.i + closingBrace.cursor.width];
                            const charSpecifiers = try parseCharSpecifiers(alloc, substr);
                            try tokens.append(alloc, .{ .anyWithin = charSpecifiers });
                            cs = peek3;
                            continue;
                        }
                    }

                    err_pos.* = cs.cursor.i;
                    return PatternError.InvalidRange;
                },
                else => {
                    try tokens.append(alloc, .{ .char = cs.cursor.c });
                    cs.nextCursor(&iter);
                },
            }
        }

        return .{
            .tokens = tokens,
            .original = pattern,
            .isRecursive = isRecursive,
        };
    }

    pub fn matchWith(this: *const Pattern, path: []const u8, opts: MatchOptions) bool {
        const iter = CodepointIterator.init(path);
        const cs = CodepointIterator.Cursor{};
        return this.matchesFrom(true, cs, &iter, 0, opts) == .Match;
    }

    fn matchesFrom(this: *const Pattern, followsSeparator_: bool, cursor_: CodepointIterator.Cursor, iter: *const CodepointIterator, i: u32, opts: MatchOptions) MatchResult {
        var followsSeparator = followsSeparator_;
        var cursor = cursor_;
        for (this.tokens.items[i..this.tokens.items.len], 0..) |tok, ti_| {
            const ti: u32 = @intCast(ti_);
            switch (tok) {
                .anySequence, .anyRecursiveSequence => {
                    // ** must be at the start.
                    std.debug.assert(switch (tok) {
                        .anyRecursiveSequence => followsSeparator,
                        else => true,
                    });

                    // Empty match
                    switch (this.matchesFrom(followsSeparator, cursor, iter, i + ti + 1, opts)) {
                        .SubPatternDoesntMatch => {}, // keep trying
                        else => |m| return m,
                    }

                    while (iter.next(&cursor)) {
                        const c = cursor.c;
                        if (followsSeparator and opts.requireLiteralLeadingDot and c == '.') {
                            return .SubPatternDoesntMatch;
                        }

                        followsSeparator = is_separator(c);
                        switch (tok) {
                            .anyRecursiveSequence => if (!followsSeparator) continue,
                            .anySequence => if (opts.requireLiteralSeparator and followsSeparator) return .SubPatternDoesntMatch,
                            else => {},
                        }

                        switch (this.matchesFrom(followsSeparator, cursor, iter, i + ti + 1, opts)) {
                            .SubPatternDoesntMatch => {}, // keep trying
                            else => |m| return m,
                        }
                    }
                },
                else => {
                    const c = c: {
                        if (iter.next(&cursor)) {
                            break :c cursor.c;
                        }
                        return .EntirePatternDoesntMatch;
                    };

                    const isSep = is_separator(c);

                    const matches = matches: {
                        switch (tok) {
                            .anyChar, .anyWithin, .anyExcept => if ((opts.requireLiteralSeparator and isSep) or
                                (followsSeparator and opts.requireLiteralLeadingDot and c == '.'))
                                break :matches false,
                            else => {},
                        }

                        switch (tok) {
                            .anyChar => break :matches true,
                            .anyWithin => |specifiers| break :matches inCharSpecifiers(&specifiers, c, opts),
                            .anyExcept => |specifiers| break :matches !inCharSpecifiers(&specifiers, c, opts),
                            .char => |c2| break :matches charsEq(c, c2, opts.caseSensitive),
                            .anySequence, .anyRecursiveSequence => unreachable,
                        }
                    };

                    if (!matches) return .SubPatternDoesntMatch;

                    followsSeparator = isSep;
                },
            }
        }

        if (!iter.next(&cursor)) return .Match;
        return .SubPatternDoesntMatch;
    }
};

fn charsEq(a: Codepoint, b: Codepoint, caseSensitive: bool) bool {
    if (builtin.os.tag == .windows and is_separator(a) and is_separator(b)) {
        return true;
    } else if (!caseSensitive and isAscii(a) and isAscii(b)) {
        // FIXME: work with non-ascii chars properly (issue #9084)
        return std.ascii.toLower(@truncate(a)) == std.ascii.toLower(@truncate(b));
    } else {
        return a == b;
    }
}

fn inCharSpecifiers(specifiers: *const ArrayList(CharSpecifier), c: Codepoint, opts: MatchOptions) bool {
    for (specifiers.items) |specifier| {
        switch (specifier) {
            .singleChar => |sc| {
                if (charsEq(sc, c, opts.caseSensitive)) return true;
            },
            .charRange => |range| {
                // FIXME: work with non-ascii chars properly (issue #1347)
                if (!opts.caseSensitive and isAscii(c) and isAscii(range.start) and isAscii(range.end)) {
                    const start = std.ascii.toLower(@truncate(range.start));
                    const end = std.ascii.toLower(@truncate(range.end));

                    const startUp = std.ascii.toUpper(start);
                    const endUp = std.ascii.toUpper(end);

                    if (start != startUp and end != endUp) {
                        const cLower = std.ascii.toLower(@truncate(c));
                        if (cLower >= start and cLower <= end) return true;
                    }
                }

                if (c >= range.start and c <= range.end) return true;
            },
        }
    }

    return false;
}

fn parseCharSpecifiers(allocator: Allocator, substr: []const u8) !ArrayList(CharSpecifier) {
    const iter = CodepointIterator.init(substr);
    var specifiers = ArrayList(CharSpecifier){};
    errdefer {
        specifiers.deinit(allocator);
    }

    var cursorState = CursorState.init(&iter);

    while (cursorState.cursor.i < substr.len) {
        const peek1 = cursorState.peek(&iter); // i + 1
        const peek2 = peek1.peek(&iter);
        const peek3 = peek2.peek(&iter);

        if (peek3.cursor.i <= substr.len and peek1.cursor.c == '-') {
            try specifiers.append(allocator, .{ .charRange = .{ .start = cursorState.cursor.c, .end = peek2.cursor.c } });
            cursorState = peek3;
        } else {
            try specifiers.append(allocator, .{ .singleChar = cursorState.cursor.c });
            cursorState = peek1;
        }
    }

    return specifiers;
}

fn isAscii(cp: Codepoint) bool {
    return cp <= 0x7F;
}

fn is_separator(cp: Codepoint) bool {
    return isAscii(cp) and is_sep_byte(@truncate(cp));
}

fn is_sep_byte(c: u8) bool {
    if (comptime builtin.os.tag == .windows) return c == '/' or c == '\\';
    return c == '/';
}

pub const PatternError = error{
    Wildcards,
    RecursiveWildcards,
    InvalidRange,
};

pub fn patternErrorString(p: PatternError) []const u8 {
    switch (p) {
        PatternError.Wildcards => return ERROR_WILDCARDS,
        PatternError.RecursiveWildcards => return ERROR_RECURSIVE_WILDCARDS,
        PatternError.InvalidRange => return ERROR_INVALID_RANGE,
    }
}
const ERROR_WILDCARDS: []const u8 = "wildcards are either regular `*` or recursive `**`";
const ERROR_RECURSIVE_WILDCARDS: []const u8 = "recursive wildcards must form a single path component";
const ERROR_INVALID_RANGE: []const u8 = "invalid range pattern";

pub const PatternToken = union(enum) {
    char: Codepoint,
    anyChar,
    anySequence,
    anyRecursiveSequence,
    anyWithin: ArrayList(CharSpecifier),
    anyExcept: ArrayList(CharSpecifier),

    fn deinit(this: *PatternToken, alloc: Allocator) void {
        switch (this.*) {
            .anyWithin => |*list| {
                list.deinit(alloc);
            },
            .anyExcept => |*list| {
                list.deinit(alloc);
            },
            else => {},
        }
    }
};

pub const CharSpecifier = union(enum) {
    singleChar: Codepoint,
    charRange: struct { start: Codepoint, end: Codepoint },
};

const CursorState = struct {
    cursor: CodepointIterator.Cursor,
    /// The index in terms of codepoints
    cp_idx: usize,

    fn init(iterator: *const CodepointIterator) CursorState {
        var this_cursor: CodepointIterator.Cursor = .{};
        _ = iterator.next(&this_cursor);
        return .{
            .cp_idx = 0,
            .cursor = this_cursor,
        };
    }

    /// Return cursor pos of next codepoint without modifying the current, you should always check that there is room for one more
    fn peek(this: *const CursorState, iterator: *const CodepointIterator) CursorState {
        var cpy = this.*;
        // If outside of bounds
        if (!iterator.next(&cpy.cursor)) {
            // This will make `i >= sourceBytes.len`
            cpy.cursor.i += cpy.cursor.width;
            cpy.cursor.width = 0;
        }
        cpy.cp_idx += 1;
        return cpy;
    }

    fn nextCursor(this: *CursorState, iterator: *const CodepointIterator) void {
        if (!iterator.next(&this.cursor)) {
            this.cursor.i += this.cursor.width;
            this.cursor.width = 0;
        }
        this.cp_idx += 1;
    }
};
