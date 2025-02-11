pub const walk = @import("./glob/GlobWalker.zig");
pub const Ascii = @import("./glob/ascii.zig");

pub const GlobWalker = walk.GlobWalker_;
pub const BunGlobWalker = GlobWalker(null, walk.SyscallAccessor, false);
pub const BunGlobWalkerZ = GlobWalker(null, walk.SyscallAccessor, true);
