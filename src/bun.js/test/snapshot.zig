const bun = @import("bun");
const strings = bun.strings;
const fs = @import("../../fs.zig");
const default_allocator = bun.default_allocator;


const std = @import("std");
const testing = std.testing;

const SNAPSHOTS_DIR = "__snapshots__/";
const EXTENSION = ".snap";

pub fn resolveSnapshotPath(test_path: fs.Path) fs.Path {
    const dir_path = test_path.sourceDir();
    const file_name = test_path.name.base;
    // A test's name could be `feature.test.ts` and the base is `feature.test`
    // `test` should be stripped if it exists
    const file_name_stripped = std.mem.trimRight(u8, file_name, ".test");

    var string_list = &[_][]const u8{dir_path, SNAPSHOTS_DIR, file_name_stripped, EXTENSION };
    const snapshot_file_path = strings.join(string_list, "", std.heap.page_allocator) catch unreachable;

    std.debug.print("snapshot_file_path {s}", .{snapshot_file_path});
    var snapshot_fs = fs.Path.init(snapshot_file_path);
    return snapshot_fs;
}

pub fn resolveTestPath(snapshot_path: fs.Path) fs.Path {
    // @TODO add resolution for non `ts` tests
    const basepath = &[_][] const u8{snapshot_path.sourceDir(), "..", snapshot_path.name.base, ".test.ts"};
    const path_string = std.fs.path.resolve(default_allocator, &.{basepath});
    const path = fs.Path.init(path_string);
    return path;
}

// @TODO add struct to handle different matching criteria
// pub const SnapshotMatcher = struct {
//     pub const OnUpdateCount = *const fn (this: *Callback, delta: u32, total: u32) void;
//     resolveSnapshotPath: OnUpdateCount,
// };

test "resolveSnapshotPath test" {
    const test_path = fs.Path.init("project/test/feature.test.ts");
    const snapshot_path = resolveSnapshotPath(test_path);
    try testing.expectEqualSlices(u8, snapshot_path.text, "project/test/__snapshots__/feature.snap");
}

test "resolveTestPath test" {
    const test_path = fs.Path.init("project/test/__snapshots__/feature.snap");
    const snapshot_path = resolveTestPath(test_path);
    try testing.expectEqualSlices(u8, snapshot_path.text, "project/test/feature.test.ts");
}
