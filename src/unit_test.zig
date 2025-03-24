const std = @import("std");
const bun = @import("root").bun;
const t = std.testing;

test {
    _ = @import("shell/braces.zig");
}

test "basic string usage" {
    var s = bun.String.createUTF8("hi"); // it can create `WTF::String`s too
    defer s.deref();
    try t.expect(s.tag != .Dead and s.tag != .Empty);
    try t.expectEqual(s.length(), 2);
    try t.expectEqualStrings(s.asUTF8().?, "hi");
}
