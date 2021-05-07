const std = @import("std");

pub var Stream: ?std.fs.File = null;
pub var writer: ?std.fs.File.Writer = null;
pub var errorWriter: ?std.fs.File.Writer = null;
