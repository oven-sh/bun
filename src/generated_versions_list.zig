// Dummy file - versions are now handled by CMake-generated header (bun_dependency_versions.h)
// This file exists only to satisfy the import in Global.zig during migration
pub const boringssl = "unused";
pub const libarchive = "unused";
pub const mimalloc = "unused";
pub const picohttpparser = "unused";
pub const webkit = "unused";
pub const zig = @import("std").fmt.comptimePrint("{}", .{@import("builtin").zig_version});
pub const zlib = "unused";
pub const tinycc = "unused";
pub const lolhtml = "unused";
pub const c_ares = "unused";
pub const libdeflate = "unused";
pub const zstd = "unused";
pub const lshpack = "unused";
