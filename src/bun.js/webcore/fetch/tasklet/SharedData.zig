const SharedData = @This();
mutex: bun.Mutex,

ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

/// buffer being used by AsyncHTTP
response_buffer: bun.MutableString = undefined,

const std = @import("std");
const bun = @import("bun");
