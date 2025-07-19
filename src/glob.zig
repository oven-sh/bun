pub const BunGlobWalker = GlobWalker(null, walk.SyscallAccessor, false);
pub const BunGlobWalkerZ = GlobWalker(null, walk.SyscallAccessor, true);

pub const walk = @import("./glob/GlobWalker.zig");
pub const GlobWalker = walk.GlobWalker_;

pub const match_impl = @import("./glob/match.zig");
pub const detectGlobSyntax = match_impl.detectGlobSyntax;
pub const match = match_impl.match;
