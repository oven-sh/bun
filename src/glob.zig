const std = @import("std");
const builtin = @import("builtin");
const strings = @import("./string_immutable.zig");
const bun = @import("root").bun;
const CodepointIterator = strings.UnsignedCodepointIterator;

pub fn validate_glob_pat(comptime dir_char: u8, pat: []const u8) bool {
    var iter = std.mem.splitBackwardsScalar(u8, pat, dir_char);
    var last_segment = iter.next() orelse pat;
    _ = last_segment;
    // Check 1, if
}

pub fn globMatchString(pat: []const u8, name: []const u8) bool {
    if (comptime builtin.os.tag == .windows) {
        return globMatchImpl('\\', pat, name);
    }
    return globMatchImpl('/', pat, name);
}

const BraceState = struct {
    /// Stores starting index of the longest match in the string to match on
    longest_match: ?struct { idx: u32, len: u32 } = null,
    current_cp_len: u32 = 0,
    /// Start of the section of string so we can backtrack
    nx_start: CodepointIterator.Cursor = .{},
    px_start: CodepointIterator.Cursor = .{},
    skip_to_next: bool = false,
};

const Wildcard = struct {
    px: CodepointIterator.Cursor = .{},
    nx: CodepointIterator.Cursor = .{},

    fn isActive(self: Wildcard, name: []const u8) bool {
        return 0 < self.nx.i and self.nx.i <= name.len;
    }

    fn deactivate(self: *Wildcard) void {
        self.px = .{};
        self.nx = .{};
    }
};

/// Return cursor pos of next codepoint without modifying the current
fn nextCursor(cursor: *const CodepointIterator.Cursor, iterator: *const CodepointIterator) CodepointIterator.Cursor {
    var cursor_cpy = cursor.*;
    if (!iterator.next(&cursor_cpy)) {
        cursor_cpy.i += cursor_cpy.width;
    }
    return cursor_cpy;
}

fn globMatchImpl(comptime dirChar: u8, pat: []const u8, name: []const u8) bool {
    const pIterator = CodepointIterator{ .bytes = pat[0..], .i = 0 };
    const nIterator = CodepointIterator{ .bytes = name[0..], .i = 0 };

    var px = CodepointIterator.Cursor{};
    var nx = CodepointIterator.Cursor{};
    _ = pIterator.next(&px);
    _ = nIterator.next(&nx);

    var brace_state: ?BraceState = null;
    var star: Wildcard = .{};
    var starstar: Wildcard = .{};

    var ncascii: u8 = 0;
    var pcascii: u8 = 0;

    while (px.i < pat.len or nx.i < name.len) {
        if (px.i < pat.len) {
            const c = px.c;
            if (comptime bun.Environment.isDebug) {
                ncascii = @truncate(nx.c);
                pcascii = @truncate(c);
            }
            switch (c) {
                '*' => {
                    std.debug.assert(brace_state == null);
                    // Match zero or more characters, allowing directories
                    const px1 = nextCursor(&px, &pIterator);
                    if (px.i + px.width < pat.len and px1.c == '*') {
                        starstar.px = px;
                        starstar.nx = nextCursor(&nx, &nIterator);
                        px = nextCursor(&px1, &pIterator);
                        continue;
                    }
                    // Match zero or more characters, excluding directories
                    else {
                        star.px = px;
                        star.nx = nextCursor(&nx, &nIterator);
                        px = px1;
                        continue;
                    }
                },
                ',' => {
                    if (brace_state) |*bs| {
                        // This means we matched
                        if (!bs.skip_to_next) {
                            bs.longest_match = longest_match: {
                                if (bs.longest_match) |longest| {
                                    if (longest.len >= bs.current_cp_len) {
                                        break :longest_match bs.longest_match;
                                    }
                                }
                                break :longest_match .{
                                    .idx = nx.i - bs.current_cp_len,
                                    .len = bs.current_cp_len,
                                };
                            };
                            px = nextCursor(&px, &pIterator);
                            nx = bs.nx_start;
                            bs.current_cp_len = 0;
                            bs.px_start = px;
                            bs.skip_to_next = false;
                        } else {
                            px = nextCursor(&px, &pIterator);
                            nx = bs.nx_start;
                            bs.px_start = px;
                            bs.skip_to_next = false;
                        }
                        continue;
                    }
                },
                '{' => {
                    std.debug.assert(brace_state == null);
                    px = nextCursor(&px, &pIterator);
                    brace_state = .{ .nx_start = nx, .px_start = px };
                    continue;
                },
                '}' => {
                    std.debug.assert(brace_state != null);
                    // If we reach here then we have either successfully matched the
                    // last variant of the brace or failed it
                    var bs = &brace_state.?;
                    bs.longest_match = longest_match: {
                        if (bs.longest_match) |longest| {
                            if (longest.len >= bs.current_cp_len) {
                                break :longest_match bs.longest_match;
                            }
                        }
                        break :longest_match .{
                            .idx = nx.i - bs.current_cp_len,
                            .len = bs.current_cp_len,
                        };
                    };

                    // We need to have matched a variant, and that match should
                    // be at the end of the string because we require braces to
                    // be at the end.
                    if (bs.longest_match != null and bs.longest_match.?.idx + bs.longest_match.?.len == name.len) return true;

                    return false;
                },
                else => {
                    if (brace_state) |*bs| {
                        // Keep moving if we matched, or we want to match on the next variant
                        if (nx.i < name.len and nx.c == c) {
                            bs.current_cp_len += nx.width;
                            px = nextCursor(&px, &pIterator);
                            nx = nextCursor(&nx, &nIterator);
                            continue;
                        } else if (bs.skip_to_next) {
                            px = nextCursor(&px, &pIterator);
                            continue;
                        }
                        // Otherwise this variant failed, move to the next
                        bs.skip_to_next = true;
                        nx = bs.nx_start;
                        continue;
                    }

                    // If encountering a directory char while matching `*` (and
                    // the next char in the pattern after `*` is not `/`) it
                    // should fail.
                    if (c != dirChar and star.isActive(name) and !starstar.isActive(name) and nx.i < name.len and nx.c == dirChar) return false;

                    if (nx.i < name.len and nx.c == c) {
                        star.deactivate();
                        px = nextCursor(&px, &pIterator);
                        nx = nextCursor(&nx, &nIterator);
                        continue;
                    }
                },
            }
        }

        // Mismatch. Maybe restart.
        if (star.isActive(name)) {
            px = star.px;
            nx = star.nx;
            continue;
        }
        if (starstar.isActive(name)) {
            px = starstar.px;
            nx = starstar.nx;
            continue;
        }

        return false;
    }

    return true;
}

test "glob" {
    const expect = @import("std").testing.expect;
    const glob_match = globMatchString;

    var pat: []const u8 = "src/index.{ts,tsx,js,jsx}";

    try expect(glob_match(pat, "src/index.ts"));
    try expect(glob_match(pat, "src/index.tsx"));
    try expect(glob_match(pat, "src/index.js"));
    try expect(glob_match(pat, "src/index.jsx"));
    try expect(!glob_match(pat, "src/index.zig"));
    try expect(!glob_match(pat, "src/index.jsxxxxx"));

    pat = "src/*.{ts,tsx,js,jsx}";
    try expect(glob_match(pat, "src/index.ts"));
    try expect(glob_match(pat, "src/foo.tsx"));
    try expect(glob_match(pat, "src/lmao.js"));
    try expect(!glob_match(pat, "src/foo/bar/lmao.js"));

    pat = "src/**/index.{ts,tsx,js,jsx}";
    try expect(glob_match(pat, "src/foo/bar/baz/index.ts"));
    try expect(!glob_match(pat, "src/index.tsx"));
    try expect(!glob_match(pat, "src/index.js"));
    try expect(glob_match(pat, "src/index/index/index.ts"));

    pat = "src/**index.{ts,tsx,js,jsx}";
    try expect(glob_match(pat, "src/foo/bar/baz/index.ts"));
    try expect(glob_match(pat, "src/index.tsx"));
    try expect(glob_match(pat, "src/index.js"));

    pat = "src/*/index.{ts,tsx,js,jsx}";
    try expect(glob_match(pat, "src/foo/index.ts"));
    try expect(!glob_match(pat, "src/foo/bar/index.ts"));

    pat = "src/**/lmao/**/index.{ts,tsx,js,jsx}";
    try expect(!glob_match(pat, "src/foo/index.ts"));
    try expect(!glob_match(pat, "src/foo/bar/index.ts"));
    try expect(glob_match(pat, "src/foo/bar/lmao/baz/index.ts"));

    pat = "src/**/lmao/**/*hi*/index.{ts,tsx,js,jsx}";
    try expect(!glob_match(pat, "src/foo/index.ts"));
    try expect(!glob_match(pat, "src/foo/bar/index.ts"));
    try expect(glob_match(pat, "src/foo/bar/lmao/baz/greathigreat/index.ts"));
    try expect(!glob_match(pat, "src/foo/bar/lmao/baz/ohno/index.ts"));
}
