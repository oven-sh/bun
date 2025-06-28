pub const walk = @import("./glob/GlobWalker.zig");
pub const match_impl = @import("./glob/match.zig");
pub const match = match_impl.match;
pub const detectGlobSyntax = match_impl.detectGlobSyntax;

pub const GlobWalker = walk.GlobWalker_;
pub const BunGlobWalker = GlobWalker(null, walk.SyscallAccessor, false);
pub const BunGlobWalkerZ = GlobWalker(null, walk.SyscallAccessor, true);
