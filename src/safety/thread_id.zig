/// A value that does not alias any other thread ID.
/// See `Thread/Mutex/Recursive.rust` in the Rust standard library.
pub const invalid = std.math.maxInt(std.Thread.Id);

const std = @import("std");
