const Lockfile = @import("../lockfile.zig");

pub fn jsonStringify(this: *const Lockfile, w: anytype) !void {
    _ = this;
    try w.write("{}");
}
