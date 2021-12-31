const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
const _global = @import("../src/global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const Features = @import("../src/analytics/analytics_thread.zig").Features;

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
