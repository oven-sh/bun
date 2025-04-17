const std = @import("std");
const bun = @import("bun");
const t = std.testing;

test {
    _ = @import("shell/braces.zig");
    _ = @import("bun.js/node/assert/myers_diff.zig");
}

test "basic string usage" {
    var s = bun.String.createUTF8("hi");
    defer s.deref();
    try t.expect(s.tag != .Dead and s.tag != .Empty);
    try t.expectEqual(s.length(), 2);
    try t.expectEqualStrings(s.asUTF8().?, "hi");
}
