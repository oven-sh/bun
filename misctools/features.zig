const std = @import("std");

const path_handler = @import("../src/resolver/resolve_path.zig");
usingnamespace @import("../src/global.zig");
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
