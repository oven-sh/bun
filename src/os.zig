//! OS-level functionality.
//! Designed to be slightly higher level than sys.zig

/// Platform-agnostic utility for fetching and interacting with the current system home directory.
pub fn queryHomeDir() bun.sys.Maybe([]const u8) {
    if (comptime bun.Environment.isWindows) {
        return win32.queryUserProfile();
    }

    return posix.queryHomeDir();
}

/// Interact with the current system temporary directory.
///
/// The system temporary directory is a directory equivalent to `/tmp` on POSIX systems. Note that
/// this is not ALWAYS /tmp, as `$TMPDIR` and other mechanisms MAY allow overriding this. Treat
/// this as a black box for maximum compatibility.
///
/// Note: Bun also allows users to explicitly specify the temporary directory bun should use, so
/// this function alone does not tell you which temporary directory you should commonly use.
pub fn querySysTmpDir() bun.sys.Maybe([]const u8) {
    if (comptime bun.Environment.isWindows) {
        return win32.querySysTmpDir();
    }

    return .initResult(posix.getSysTmpDir());
}

pub const win32 = if (bun.Environment.isWindows) @import("./os/win32.zig") else struct {};
pub const posix = if (bun.Environment.isPosix) @import("./os/posix.zig") else struct {};

comptime {
    // TODO(markovejnovic): This probably shouldn't exist in src/os, but rather in another spot.
    if (bun.Environment.isPosix) {
        // uvinterop only supports POSIX at the time of writing. No need to pollute the Windows
        // binary with it.
        _ = @import("./os/uvinterop.zig"); // Necessary to link into the binary.
    }
}

const bun = @import("bun");
