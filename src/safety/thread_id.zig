/// A value that does not alias any other thread ID.
/// See `Thread/Mutex/Recursive.zig` in the Zig standard library.
pub const invalid = std.math.maxInt(std.Thread.Id);

const std = @import("std");
