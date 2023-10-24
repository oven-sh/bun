const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
// const strings = @import("./string_immutable.zig");

const Syscall = bun.sys;

pub fn validate_glob_pat(comptime dir_char: u8, pat: []const u8) bool {
    var iter = std.mem.splitBackwardsScalar(u8, pat, dir_char);
    var last_segment = iter.next() orelse pat;
    _ = last_segment;
    // Check 1, if
}

pub fn glob_match_string(pat: []const u8, name: []const u8) bool {
    if (comptime builtin.os.tag == .windows) {
        return glob_match_impl('\\', pat, name);
    }
    return glob_match_impl('/', pat, name);
}

const GlobState = struct {
    px: u32 = 0,
    nx: u32 = 0,
};

const BraceState = struct {
    /// Stores starting index of the longest match in the string to match on
    longest_match: ?u32 = null,
    /// Start of the section of string so we can backtrack
    nx_start: u32 = 0,
    px_start: u32 = 0,
    skip_to_next: bool = false,
};

const Wildcard = struct {
    px: u32 = 0,
    nx: u32 = 0,

    fn is_active(self: Wildcard, name: []const u8) bool {
        return 0 < self.nx and self.nx <= name.len;
    }

    fn deactivate(self: *Wildcard) void {
        self.px = 0;
        self.nx = 0;
    }
};

/// Some invariants:
/// - braces (ex: {.js,.jsx}) can only be present at the very end of the pattern
///
/// Use validate_glob_pat function to verify these invariants are upheld.
fn glob_match_impl(comptime dir_char: u8, pat: []const u8, name: []const u8) bool {
    var px: u32 = 0;
    var nx: u32 = 0;
    var brace_state: ?BraceState = null;
    var star: Wildcard = .{};
    var starstar: Wildcard = .{};

    while (px < pat.len or nx < name.len) {
        if (px < pat.len) {
            const c = pat[px];
            const nc = if (nx < name.len) name[nx] else 0;
            _ = nc;
            switch (c) {
                '*' => {
                    std.debug.assert(brace_state == null);
                    // Match zero or more characters, allowing directories
                    if (px + 1 < pat.len and pat[px + 1] == '*') {
                        starstar.px = px;
                        starstar.nx = nx + 1;
                        px += 2;
                        continue;
                    }
                    // Match zero or more characters, excluding directories
                    else {
                        star.px = px;
                        star.nx = nx + 1;
                        px += 1;
                        continue;
                    }
                },
                ',' => {
                    if (brace_state) |*bs| {
                        // This means we matched
                        if (!bs.skip_to_next) {
                            bs.longest_match = if (bs.longest_match) |longest| @max(longest, nx - bs.nx_start) else nx - bs.nx_start;
                            px += 1;
                            nx = bs.nx_start;
                            bs.px_start = px;
                            bs.skip_to_next = false;
                        } else {
                            px += 1;
                            nx = bs.nx_start;
                            bs.px_start = px;
                            bs.skip_to_next = false;
                        }
                        continue;
                    }
                },
                '{' => {
                    std.debug.assert(brace_state == null);
                    px += 1;
                    brace_state = .{ .nx_start = nx, .px_start = px };
                    continue;
                },
                '}' => {
                    std.debug.assert(brace_state != null);
                    // If we reach here then we have either successfully matched the
                    // last variant of the brace or failed it
                    var bs = &brace_state.?;
                    bs.longest_match = if (bs.longest_match) |longest| @max(longest, nx - bs.nx_start) else nx - bs.nx_start;
                    // We need to have matched a variant, and that match should be at the end of the string.
                    if (bs.longest_match != null and bs.longest_match.? + bs.nx_start == name.len) return true;

                    return false;
                },
                else => {
                    if (brace_state) |*bs| {
                        // Keep moving if we matched, or we want to match on the next variant
                        if (nx < name.len and name[nx] == c) {
                            px += 1;
                            nx += 1;
                            continue;
                        } else if (bs.skip_to_next) {
                            px += 1;
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
                    if (c != dir_char and star.is_active(name) and !starstar.is_active(name) and nx < name.len and name[nx] == dir_char) return false;

                    if (nx < name.len and name[nx] == c) {
                        star.deactivate();
                        px += 1;
                        nx += 1;
                        continue;
                    }
                },
            }
        }

        // Mismatch. Maybe restart.
        if (star.is_active(name)) {
            px = star.px;
            nx = star.nx;
            continue;
        }
        if (starstar.is_active(name)) {
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
    const glob_match = glob_match_string;

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
