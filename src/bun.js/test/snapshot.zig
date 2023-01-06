const bun = @import("bun");

const strings = bun.strings;
const JSC = @import("bun").JSC;
const js = JSC.C;
const ZigString = JSC.ZigString;

const fs = @import("../../fs.zig");
const default_allocator = bun.default_allocator;
const std = @import("std");
const testing = std.testing;

const ArrayIdentityContext = @import("../../identity_context.zig").ArrayIdentityContext;

const SNAPSHOTS_DIR = "__snapshots__/";
const EXTENSION = "snap";

pub fn resolveSnapshotPath(test_path: fs.Path, allocator: std.mem.Allocator) fs.Path {
    const dir_path = test_path.sourceDir();
    const file_name = test_path.name.base;
    // A test's name could be `feature.test.ts` and the base is `feature.test`
    // `test` should be stripped if it exists. This is the default patter of the
    // test runner.
    const file_name_stripped = std.mem.trimRight(u8, file_name, "test");
    var string_list = &[_][]const u8{ dir_path, SNAPSHOTS_DIR, file_name_stripped, EXTENSION };
    // maybe use resolve_path.joinAbsString
    const snapshot_file_path = strings.join(string_list, "", allocator) catch unreachable;

    return fs.Path.init(snapshot_file_path);
}

const IdentityContext = struct {
    pub fn eql(_: @This(), a: u64, b: u64) bool {
        return a == b;
    }

    pub fn hash(_: @This(), a: u64) u64 {
        return a;
    }
};

pub const SnapshotFile = struct {
    path: fs.Path,
    globalObject: *JSC.JSGlobalObject,
    file_system: *fs.FileSystem,
    allocator: std.mem.Allocator,
    snapshotData: JSC.JSValue,
    counters: CountersMap,

    pub const SnapshotError = error{SnapshotNotFound};

    pub const CountersMap = std.HashMap(u64, u32, IdentityContext, 80);

    // pub fn init(globalObject: *JSC.JSGlobalObject, path: fs.Path) !SnapshotFile {
    //     var _file_system = try fs.FileSystem.init1(globalObject.bunVM().allocator, null);
    //     var snapshot = SnapshotFile{ .globalObject = globalObject, .path = path, .file_system = _file_system, .allocator = globalObject.bunVM().allocator, .snapshotData = null };
    //     snapshot.readAndParseSnapshot(globalObject) catch unreachable;
    //     return snapshot;
    // }

    pub fn readAndParseSnapshot(this: *SnapshotFile) void {
        var snapshot_contents = this.readSnapshot() catch return;
        const contents_string = ZigString.init(snapshot_contents);
        this.parseSnapshot(&contents_string, this.globalObject) catch unreachable;
    }

    pub fn readSnapshot(this: *SnapshotFile) !bun.string {
        // @TODO add check to throw error if the snapshot file does not exist.
        var file: std.fs.File = std.fs.cwd().openFile(this.path.text, .{ .mode = .read_write }) catch {
            this.snapshotData = JSC.JSValue.jsUndefined();
            return SnapshotError.SnapshotNotFound;
        };
        const file_size = try file.getEndPos();
        var snapshot_contents = try this.allocator.alloc(u8, file_size);
        _ = try file.read(snapshot_contents);
        file.close();
        return snapshot_contents;
    }

    pub fn setSnapshotContents(this: *SnapshotFile, snapshot: js.JSValueRef) void {
        this.snapshotData = snapshot;
    }

    // Parses an existing by passing the snapshot file's contents into the javascript equivalent code:
    //      f = new Function("exports", snapshotContents);
    //      const param = {};
    //      f(param);
    // if the test snapshot file looks like: exports[`test name 1`] = `5`
    // the value of param will be set to: { test name 1: '5' }
    pub fn parseSnapshot(this: *SnapshotFile, snapshotContents: *const ZigString, _: *JSC.JSGlobalObject) !void {
        // Arguments to create function
        var function_name = JSC.C.JSStringCreateStatic("anonymous", "anonymous".len);
        var param_name = JSC.C.JSStringCreateStatic("exports", "exports".len);
        var functionBody = JSC.C.JSStringCreateStatic(snapshotContents.ptr, snapshotContents.len);
        var func_url = JSC.C.JSStringCreateStatic("file:///snapshot.zig", "file:///snapshot.zig".len);
        var exception_ptr: ?[*]JSC.JSValueRef = null;

        const function: js.JSObjectRef = JSC.C.JSObjectMakeFunction(this.globalObject, function_name, 1, &[_]JSC.C.JSStringRef{param_name}, functionBody, func_url, 1, exception_ptr);

        var expect_arg: js.JSValueRef = JSC.JSValue.createEmptyObject(this.globalObject, 0).asRef();
        const arguments = [1]js.JSValueRef{expect_arg};

        // Call the function
        _ = JSC.C.JSObjectCallAsFunction(this.globalObject, function, null, 1, &arguments, exception_ptr) orelse unreachable;
        // Save the value of the parameter since it has the parsed snapshot value
        this.snapshotData = JSC.JSValue.fromRef(expect_arg);
    }

    fn incrementCounter(this: *SnapshotFile, testName: bun.string) !u32 {
        var count: u32 = 0;
        const hash = std.hash.Wyhash.hash(0, testName);
        if (this.counters.get(hash)) |val| {
            count = val;
        }
        count += 1;
        try this.counters.put(hash, count);
        return count;
    }

    // @TODO add support for hints later
    pub fn getSnapshotValue(this: *SnapshotFile, snapshotName: bun.string) !JSC.JSValue {
        var count = try this.incrementCounter(snapshotName);
        const snapshot_key = std.fmt.allocPrint(this.allocator, "{s} {}", .{ snapshotName, count }) catch unreachable;

        const test_name_string = ZigString.init(snapshot_key);
        // @TODO get this to not segfault if the snapshot for the key doesn't exist
        if (this.snapshotData.isEmptyOrUndefinedOrNull()) {
            this.globalObject.throw("The corresponding snapshot file did not exist: {s}", .{this.path.text});
            return .zero;
        }
        const value = this.snapshotData.getIfPropertyExistsImpl(this.globalObject, test_name_string.ptr, @truncate(u32, test_name_string.len));
        if (value.isEmptyOrUndefinedOrNull()) {
            this.globalObject.throw("The snapshot `{s}` was not found in {s}", .{ snapshot_key, this.path.text });
            return .zero;
        }
        return value;
    }

    pub fn exists(this: *SnapshotFile) bool {
        return (fs.FileSystem.FilenameStore.instance.exists(this.path.text) or
            fs.FileSystem.DirnameStore.instance.exists(this.path.text)) and
            (fs.FileSystem.FilenameStore.instance.exists(this.path.pretty) or
            fs.FileSystem.DirnameStore.instance.exists(this.path.pretty));
    }
};

test "resolveSnapshotPath test" {
    const test_path = fs.Path.init("project/test/feature.test.ts");
    const snapshot_path = resolveSnapshotPath(test_path);
    try testing.expectEqualSlices(u8, snapshot_path.text, "project/test/__snapshots__/feature.snap");
}
