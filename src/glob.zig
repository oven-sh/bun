pub const match = @import("./glob/match.zig").match;
pub const walk = @import("./glob/GlobWalker.zig");
pub const GlobWalker = walk.GlobWalker_;
pub const BunGlobWalker = GlobWalker(null, walk.SyscallAccessor, false);
pub const BunGlobWalkerZ = GlobWalker(null, walk.SyscallAccessor, true);

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

const std = @import("std");
