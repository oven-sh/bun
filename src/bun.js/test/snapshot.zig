const bun = @import("bun");

const strings = bun.strings;
const JSC = @import("bun").JSC;
const js = JSC.C;
const ZigString = JSC.ZigString;
const Output = bun.Output;

const fs = @import("../../fs.zig");
const default_allocator = bun.default_allocator;
const std = @import("std");
const testing = std.testing;

const IdentityContext = @import("../../identity_context.zig").IdentityContext;

const DescribeScope = @import("jest.zig").DescribeScope;

const SNAPSHOTS_DIR = "__snapshots__/";
const EXTENSION = ".snap";

pub fn resolveSnapshotPath(test_path: fs.Path, allocator: std.mem.Allocator) fs.Path {
    const dir_path = test_path.sourceDir();
    const file_name = test_path.name.filename;
    var string_list = &[_][]const u8{ dir_path, SNAPSHOTS_DIR, file_name, EXTENSION };
    // maybe use resolve_path.joinAbsString
    const snapshot_file_path = strings.join(string_list, "", allocator) catch unreachable;

    return fs.Path.init(snapshot_file_path);
}

pub fn createSnapshotName(testName: bun.string, describeScope: *DescribeScope, allocator: std.mem.Allocator) bun.string {
    var arr = std.ArrayList(bun.string).init(allocator);
    var parent: ?*DescribeScope = describeScope;
    while (parent) |scope| {
        // can optimize so that each insert is done in O(1)
        if (!std.mem.eql(u8, scope.label, "")) arr.insert(0, scope.label) catch unreachable;
        parent = scope.parent;
    }
    arr.append(testName) catch unreachable;
    const snapshot_name = strings.join(arr.items, " ", allocator) catch unreachable;
    return snapshot_name;
}

pub const SnapshotFile = struct {
    path: fs.Path,
    globalObject: ?*JSC.JSGlobalObject,
    allocator: std.mem.Allocator,
    // This is the data that is read from the snapshot file
    // data is represented like:
    // { 'test constructor works': 4 }
    snapshotData: SnapshotError!JSC.JSValue,
    // This is the actual values that the user calls
    // used to update the snapshot file
    tests: std.ArrayListUnmanaged(TestData) = .{},
    counters: CountersMap,
    updateSnapshot: bool = false,

    pub var updateAllSnapshots: bool = false;

    pub const TestData = struct {
        k: ZigString,
        v: JSC.JSValue,
        count: u32,

        pub const List = std.ArrayListUnmanaged(TestData);

        fn lessThan(_: void, a: TestData, b: TestData) bool {
            return ZigString.cmpDesc(void{}, a.k, b.k);
        }
    };

    pub const SnapshotError = error{ SnapshotNotFound, CaseNotFound };

    pub const CountersMap = std.HashMap(u64, u32, IdentityContext(u64), 80);

    // pub fn init(globalObject: *JSC.JSGlobalObject, path: fs.Path) !SnapshotFile {
    //     var _file_system = try fs.FileSystem.init1(globalObject.bunVM().allocator, null);
    //     var snapshot = SnapshotFile{ .globalObject = globalObject, .path = path, .file_system = _file_system, .allocator = globalObject.bunVM().allocator, .snapshotData = null };
    //     snapshot.readAndParseSnapshot(globalObject) catch unreachable;
    //     return snapshot;
    // }

    pub fn readAndParseSnapshot(this: *SnapshotFile, globalObject: *JSC.JSGlobalObject) void {
        var snapshot_contents = this.readSnapshot() catch return;
        const contents_string = ZigString.init(snapshot_contents);
        this.parseSnapshot(&contents_string, globalObject) catch unreachable;
    }

    pub fn readSnapshot(this: *SnapshotFile) !bun.string {
        // @TODO add check to throw error if the snapshot file does not exist.
        var file: std.fs.File = std.fs.cwd().openFile(this.path.text, .{ .mode = .read_write }) catch {
            this.snapshotData = SnapshotError.SnapshotNotFound;
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
    pub fn parseSnapshot(this: *SnapshotFile, snapshotContents: *const ZigString, globalObject: *JSC.JSGlobalObject) !void {
        // Arguments to create function
        var function_name = JSC.C.JSStringCreateStatic("anonymous", "anonymous".len);
        var param_name = JSC.C.JSStringCreateStatic("exports", "exports".len);
        var functionBody = JSC.C.JSStringCreateStatic(snapshotContents.ptr, snapshotContents.len);
        var func_url = JSC.C.JSStringCreateStatic("file:///snapshot.zig", "file:///snapshot.zig".len);
        var exception_ptr: ?[*]JSC.JSValueRef = null;

        const function: js.JSObjectRef = JSC.C.JSObjectMakeFunction(globalObject, function_name, 1, &[_]JSC.C.JSStringRef{param_name}, functionBody, func_url, 1, exception_ptr);

        var expect_arg: js.JSValueRef = JSC.JSValue.createEmptyObject(globalObject, 0).asRef();
        const arguments = [1]js.JSValueRef{expect_arg};

        // Call the function
        _ = JSC.C.JSObjectCallAsFunction(globalObject, function, null, 1, &arguments, exception_ptr) orelse unreachable;
        // Save the value of the parameter since it has the parsed snapshot value
        // @TODO need to do error checking here to see if the file / function failed
        // if (exception_ptr[0] != null) {
        //     std.debug.print("exception_ptr\n", .{});
        // }
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
    pub fn getSnapshotValue(this: *SnapshotFile, snapshotName: bun.string, count: u32, globalObject: *JSC.JSGlobalObject) !JSC.JSValue {
        const snapshot_key = std.fmt.allocPrint(this.allocator, "{s} {}", .{ snapshotName, count }) catch unreachable;

        const test_name_string = ZigString.init(snapshot_key);
        // @TODO get this to not segfault if the snapshot for the key doesn't exist
        const snapshotData = this.snapshotData catch {
            this.updateSnapshot = true;
            return SnapshotError.SnapshotNotFound;
        };
        const value = snapshotData.getIfPropertyExistsImpl(globalObject, test_name_string.ptr, @truncate(u32, test_name_string.len));
        if (@enumToInt(value) == 0) {
            return SnapshotError.CaseNotFound;
        }
        return value;
    }

    pub fn exists(this: *SnapshotFile) bool {
        return (fs.FileSystem.FilenameStore.instance.exists(this.path.text) or
            fs.FileSystem.DirnameStore.instance.exists(this.path.text)) and
            (fs.FileSystem.FilenameStore.instance.exists(this.path.pretty) or
            fs.FileSystem.DirnameStore.instance.exists(this.path.pretty));
    }

    fn compare(this: *SnapshotFile, actual: JSC.JSValue, expected: JSC.JSValue) bool {
        const globalObject = this.globalObject orelse unreachable;

        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };

        const actual_formatted = std.fmt.allocPrint(this.allocator, "{any}", .{actual.toFmt(globalObject, &fmt)}) catch unreachable;
        const expected_formatted = std.fmt.allocPrint(this.allocator, "{any}", .{expected.toFmt(globalObject, &fmt)}) catch unreachable;

        return std.mem.eql(u8, actual_formatted, expected_formatted);
    }

    // @TODO if the snapshot file is not found, then we set update = true
    // and save the contents of the test after the run
    pub fn match(this: *SnapshotFile, snapshotName: bun.string, actual: JSC.JSValue, not: bool, globalObject: *JSC.JSGlobalObject) !bool {
        this.globalObject = globalObject;
        var count: u32 = this.incrementCounter(snapshotName) catch 1;

        try this.tests.append(this.allocator, TestData{ .k = ZigString.init(snapshotName), .v = actual, .count = count });

        const expected = this.getSnapshotValue(snapshotName, count, globalObject) catch |err| {
            if (err == SnapshotError.SnapshotNotFound) {
                std.debug.print("SnapshotNotFound\n", .{});
                // If the snapshot file does not exist, then we return true
                // and update the snapshot file
                this.updateSnapshot = true;
                return true;
            }
            if (this.updateSnapshot or SnapshotFile.updateAllSnapshots) {
                Output.prettyln("    <green>Updating Snapshot<r>\n", .{});
                Output.flush();
                return true;
            }
            globalObject.throw("The snapshot `{s}` was not found in {s}", .{ snapshotName, this.path.text });
            return false;
        };

        var pass = this.compare(actual, expected);

        if (not) pass = !pass;
        if (pass) return true;

        var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
        if (not) {
            globalObject.throw("Expected values to not be equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), actual.toFmt(globalObject, &fmt) });
        } else {
            globalObject.throw("Expected values to be equal:\n\tExpected: {any}\n\tReceived: {any}", .{ expected.toFmt(globalObject, &fmt), actual.toFmt(globalObject, &fmt) });
        }
        return false;
    }

    pub fn openAndClearFile(this: *SnapshotFile) !std.fs.File {
        try std.fs.cwd().deleteFile(this.path.pretty);
        return try std.fs.cwd().openFile(this.path.pretty, .{ .mode = .write_only });
    }

    // This function clears an existing snapshot file or opens a new one
    pub fn fetchFile(this: *SnapshotFile) !std.fs.File {
        return this.openAndClearFile() catch {
            // If the file has a problem opening, we create a new one
            try std.fs.cwd().makePath(this.path.name.dir);
            return try std.fs.cwd().createFile(this.path.pretty, .{ .truncate = true });
        };
    }

    pub fn writeToFile(this: *SnapshotFile) void {
        if (!this.updateSnapshot and !SnapshotFile.updateAllSnapshots) return;
        const globalObject = this.globalObject orelse {
            return;
        };

        const snapshot_file = this.fetchFile() catch std.debug.panic("Failed to create snapshot file", .{});
        defer snapshot_file.close();

        // sort the order that tests are written to the file
        std.sort.sort(TestData, this.tests.items, {}, TestData.lessThan);

        if (this.tests.items.len > 0) {
            snapshot_file.writer().print("// Jest Snapshot v1, https://goo.gl/fbAQLP\n", .{}) catch unreachable;
        }

        var i: usize = 0;
        while (i < this.tests.items.len) {
            const test_data = this.tests.items[i];
            const key: ZigString = test_data.k;

            var fmt = JSC.ZigConsoleClient.Formatter{ .globalThis = globalObject };
            var value_stringified = test_data.v.toFmt(globalObject, &fmt);
            const count = test_data.count;
            snapshot_file.writer().print("\nexports[`{s} {}`] = `{s}`;\n", .{ key, count, value_stringified }) catch unreachable;
            i += 1;
        }
    }
};

test "resolveSnapshotPath test" {
    const test_path = fs.Path.init("project/test/feature.test.ts");
    const snapshot_path = resolveSnapshotPath(test_path);
    try testing.expectEqualSlices(u8, snapshot_path.text, "project/test/__snapshots__/feature.snap");
}
