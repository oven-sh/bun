//! OS-level functionality.
//! Designed to be slightly higher level than sys.zig

/// Platform-agnostic utility for fetching and interacting with the current system home directory.
///
/// Implements the following concept:
/// ```
/// fn HomeDirConcept(T type) concept {
///     fn deinit(self: *T) void;
///     /// Deduces the current user's home directory.
///     ///
///     /// Has multiple strategies depending on the platform and environment. Mostly compliant with
///     /// the POSIX standard for POSIX systems.
///     ///
///     /// Tries to be clever on Windows, but no compliance guarantees are made.
///     ///
///     /// There is actually a reasonable desire to be able to query other users' home directories.
///     /// However, we don't have a need to do that at this moment. See
///     /// doi:10.1109/IEEESTD.2018.8277153 2.6.1 for further details.
///     ///
///     /// Very close to how uv_os_homedir works in libuv.
///     fn query(allocator: std.mem.Allocator) bun.sys.Maybe(T);
///     fn slice(self: *const T) []const u8;
/// }
/// ```
pub const HomeDir = bun.Environment.OsTypeSelect(.{
    .posix = posix.HomeDir,
    .win = win32.UserProfile,
});

/// Interact with the current system temporary directory.
///
/// The system temporary directory is a directory equivalent to `/tmp` on POSIX systems. Note that
/// this is not ALWAYS /tmp, as `$TMPDIR` and other mechanisms MAY allow overriding this. Treat
/// this as a black box for maximum compatibility.
///
/// Note: Bun also allows users to explicitly specify the temporary directory bun should use, so
/// this function alone does not tell you which temporary directory you should commonly use.
///
/// Implements the following concept:
/// ```
/// fn SysTempDirConcept(T type) concept {
///     fn deinit(self: *T) void;
///     fn query(allocator: std.mem.Allocator) bun.sys.Maybe(T);
///     fn slice(self: *const T) []const u8;
/// }
/// ```
pub const SysTmpDir = bun.Environment.OsTypeSelect(.{
    .posix = posix.SysTmpDir,
    .win = win32.TempDir,
});

pub const win32 = @import("./os/win32.zig");
pub const posix = @import("./os/posix.zig");

comptime {
    // TODO(markovejnovic): This probably shouldn't exist in src/os, but rather in another spot.
    if (bun.Environment.isPosix) {
        // uvinterop only supports POSIX at the time of writing. No need to pollute the Windows
        // binary with it.
        _ = @import("./os/uvinterop.zig"); // Necessary to link into the binary.
    }
}

const bun = @import("bun");
const std = @import("std");
