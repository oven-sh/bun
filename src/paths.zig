pub const Path = paths.Path;
pub const AbsPath = paths.AbsPath;
pub const AutoAbsPath = paths.AutoAbsPath;
pub const RelPath = paths.RelPath;
pub const AutoRelPath = paths.AutoRelPath;

pub const EnvPath = @import("./paths/EnvPath.zig").EnvPath;

pub const path_buffer_pool = pools.path_buffer_pool;
pub const w_path_buffer_pool = pools.w_path_buffer_pool;
pub const os_path_buffer_pool = pools.os_path_buffer_pool;

pub const MAX_PATH_BYTES: usize = if (Environment.isWasm) 1024 else std.fs.max_path_bytes;
pub const PathBuffer = [MAX_PATH_BYTES]u8;
pub const PATH_MAX_WIDE = std.os.windows.PATH_MAX_WIDE;
pub const WPathBuffer = [PATH_MAX_WIDE]u16;
pub const OSPathChar = if (Environment.isWindows) u16 else u8;
pub const OSPathSliceZ = [:0]const OSPathChar;
pub const OSPathSlice = []const OSPathChar;
pub const OSPathBuffer = if (Environment.isWindows) WPathBuffer else PathBuffer;

const paths = @import("./paths/Path.zig");
const pools = @import("./paths/path_buffer_pool.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
