const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const bun = @import("bun");
const string = []const u8;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = [:0]const u8;
const default_allocator = bun.default_allocator;
const Features = bun.analytics.Features;

// zig run --main-pkg-path ../ ./features.zig
pub fn main() anyerror!void {
    var stdout_ = std.io.getStdOut();
    var stderr_ = std.io.getStdErr();
    var output_source = Output.Source.init(stdout_, stderr_);
    Output.Source.set(&output_source);
    defer Output.flush();

    var writer = Output.writer();
    try Features.Serializer.writeAll(@TypeOf(writer), writer);
}
