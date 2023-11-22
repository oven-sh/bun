const std = @import("std");
const bun = @import("root").bun;
const default_allocator = bun.default_allocator;
const string = bun.string;
const MutableString = bun.MutableString;
const strings = bun.strings;
const logger = bun.logger;
const jest = @import("./jest.zig");
const Jest = jest.Jest;
const TestRunner = jest.TestRunner;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const VirtualMachine = JSC.VirtualMachine;
const Expect = @import("./expect.zig").Expect;

pub const Snapshots = struct {
    const file_header = "// Bun Snapshot v1, https://goo.gl/fbAQLP\n";
    pub const ValuesHashMap = bun.StringHashMap(Entry);

    allocator: std.mem.Allocator,
    update_snapshots: bool,
    total: usize = 0,
    added: usize = 0,
    passed: usize = 0,
    failed: usize = 0,

    file_buf: *std.ArrayList(u8),
    values: *ValuesHashMap,
    _current_file: ?File = null,
    snapshot_dir_path: ?string = null,

    seen: SeenSnapshotsMap = SeenSnapshotsMap.init(bun.default_allocator),

    const SeenSnapshotsMap = std.HashMap(u64, void, bun.IdentityContext(u64), 80);

    pub const Entry = struct {
        text: []const u8 = "",
        counter: u32 = 0,

        pub fn eql(this: *const Entry, other: *const Entry) bool {
            return strings.eqlLong(this.text, other.text, true) and this.counter == other.counter;
        }
    };

    const File = struct {
        id: TestRunner.File.ID,
        file: std.fs.File,
    };

    fn hashWithCount(name: []const u8, count: u32) u64 {
        var wy = std.hash.Wyhash.init(0);
        wy.update(name);
        var buf: [60]u8 = undefined;
        wy.update(std.fmt.bufPrint(&buf, " {d}", .{count}) catch unreachable);
        return wy.final();
    }

    pub fn getOrPut(this: *Snapshots, expect: *Expect, value: JSValue, hint: string, globalObject: *JSC.JSGlobalObject) !?string {
        switch (try this.getSnapshotFile(expect.scope.file_id)) {
            .result => {},
            .err => |err| {
                return switch (err.syscall) {
                    .mkdir => error.FailedToMakeSnapshotDirectory,
                    .open => error.FailedToOpenSnapshotFile,
                    else => error.SnapshotFailed,
                };
            },
        }

        var snapshot_name = try expect.getSnapshotName(this.allocator, hint);
        this.total += 1;

        var entry = try this.values.getOrPut(snapshot_name);

        if (entry.found_existing) {
            this.allocator.free(snapshot_name);
            snapshot_name = entry.key_ptr.*;

            entry.value_ptr.counter += 1;
        } else {
            entry.value_ptr.counter = 1;
        }

        var counter: u32 = entry.value_ptr.counter;

        {
            if (!this.update_snapshots) {
                const hash = hashWithCount(snapshot_name, counter);
                var seen = try this.seen.getOrPut(hash);

                if (seen.found_existing) {
                    var stack_fallback = std.heap.stackFallback(2048, this.allocator);
                    var stack_fallback_allocator = stack_fallback.get();
                    const temp_buf = try std.fmt.allocPrint(stack_fallback_allocator, "{s} {d}", .{ snapshot_name, entry.value_ptr.counter });
                    defer stack_fallback_allocator.free(temp_buf);
                    if (this.values.getPtr(temp_buf)) |existing| {
                        return existing.text;
                    }
                }
            }
        }

        // doesn't exist. append to file bytes and add to hashmap.
        var pretty_value = try MutableString.init(this.allocator, 0);
        defer pretty_value.deinit();

        try value.jestSnapshotPrettyFormat(&pretty_value, globalObject);

        const snapshot_name_len = std.fmt.count("{any} {d}", .{ strings.JavaScriptStringFormatter{ .str = snapshot_name }, counter });
        const value_len = std.fmt.count("{any}", .{strings.JavaScriptStringFormatter{ .str = pretty_value.list.items }});

        const serialized_length = "\nexports[`".len + snapshot_name_len + "`] = `".len + value_len + "`;\n".len;
        try this.file_buf.ensureUnusedCapacity(serialized_length);
        this.file_buf.appendSliceAssumeCapacity("\nexports[`");

        try this.file_buf.writer().print("{} {d}", .{ strings.JavaScriptStringFormatter{ .str = snapshot_name }, counter });

        this.file_buf.appendSliceAssumeCapacity("`] = `");

        var escaped_value_i: usize = this.file_buf.items.len;
        try this.file_buf.writer().print("{}", .{strings.JavaScriptStringFormatter{ .str = pretty_value.list.items }});
        const escaped_value_len = this.file_buf.items.len - escaped_value_i;
        this.file_buf.appendSliceAssumeCapacity("`;\n");

        this.added += 1;

        if (entry.found_existing) {
            this.allocator.free(entry.value_ptr.text);
        }
        entry.value_ptr.text = try this.allocator.dupe(u8, this.file_buf.items[escaped_value_i .. escaped_value_i + escaped_value_len]);
        return null;
    }

    pub fn parseFile(this: *Snapshots) !void {
        if (this.file_buf.items.len == 0) return;

        const vm = VirtualMachine.get();
        var opts = js_parser.Parser.Options.init(vm.bundler.options.jsx, .js);
        var temp_log = logger.Log.init(this.allocator);

        const test_file = Jest.runner.?.files.get(this._current_file.?.id);
        const test_filename = test_file.source.path.name.filename;
        const dir_path = test_file.source.path.name.dirWithTrailingSlash();

        var snapshot_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var remain: []u8 = snapshot_file_path_buf[0..bun.MAX_PATH_BYTES];
        bun.copy(u8, remain, dir_path);
        remain = remain[dir_path.len..];
        bun.copy(u8, remain, "__snapshots__/");
        remain = remain["__snapshots__/".len..];
        bun.copy(u8, remain, test_filename);
        remain = remain[test_filename.len..];
        bun.copy(u8, remain, ".snap");
        remain = remain[".snap".len..];
        remain[0] = 0;
        const snapshot_file_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];

        const source = logger.Source.initPathString(snapshot_file_path, this.file_buf.items);
        vm.bundler.resetStore();

        var parser = try js_parser.Parser.init(
            opts,
            &temp_log,
            &source,
            vm.bundler.options.define,
            this.allocator,
        );

        var parse_result = try parser.parse();
        var ast = if (parse_result == .ast) parse_result.ast else return error.ParseError;
        defer ast.deinit();

        if (ast.exports_ref.isNull()) return;
        const exports_ref = ast.exports_ref;

        // TODO: when common js transform changes, keep this updated or add flag to support this version

        const export_default = brk: {
            for (ast.parts.slice()) |part| {
                for (part.stmts) |stmt| {
                    if (stmt.data == .s_export_default and stmt.data.s_export_default.value == .expr) {
                        break :brk stmt.data.s_export_default.value.expr;
                    }
                }
            }

            return;
        };

        if (export_default.data == .e_call) {
            const function_call = export_default.data.e_call;
            if (function_call.args.len == 2 and function_call.args.ptr[0].data == .e_function) {
                const arg_function_stmts = function_call.args.ptr[0].data.e_function.func.body.stmts;
                for (arg_function_stmts) |stmt| {
                    switch (stmt.data) {
                        .s_expr => |expr| {
                            if (expr.value.data == .e_binary and expr.value.data.e_binary.op == .bin_assign) {
                                const left = expr.value.data.e_binary.left;
                                if (left.data == .e_index and left.data.e_index.index.data == .e_string and left.data.e_index.target.data == .e_identifier) {
                                    const target: js_ast.E.Identifier = left.data.e_index.target.data.e_identifier;
                                    var index: *js_ast.E.String = left.data.e_index.index.data.e_string;
                                    var right = &expr.value.data.e_binary.right;
                                    if (right.data == .e_template) {
                                        right.* = try right.data.e_template.toString(this.allocator, right.loc);
                                    }

                                    if (right.data == .e_string) {
                                        if (target.ref.eql(exports_ref)) {
                                            const key = index.slice(this.allocator);
                                            var value_string = right.data.e_string;
                                            const value = value_string.slice(this.allocator);
                                            defer {
                                                if (!index.isUTF8()) this.allocator.free(key);
                                                if (!value_string.isUTF8()) this.allocator.free(value);
                                            }

                                            var entry = try this.values.getOrPut(key);
                                            var value_to_use: []const u8 = "";
                                            if (entry.found_existing) {
                                                if (entry.value_ptr.text.len >= value.len) {
                                                    bun.copy(u8, @constCast(entry.value_ptr.text)[0..value.len], value);
                                                    if (comptime bun.Environment.allow_assert)
                                                        if (entry.value_ptr.text.len > value.len)
                                                            @memset(@constCast(entry.value_ptr.text)[value.len..], undefined);

                                                    value_to_use = entry.value_ptr.text[0..value.len];
                                                } else {
                                                    this.allocator.free(entry.value_ptr.text);
                                                    value_to_use = try this.allocator.dupe(u8, value);
                                                }
                                            } else {
                                                entry.key_ptr.* = try this.allocator.dupe(u8, key);
                                                value_to_use = try this.allocator.dupe(u8, value);
                                            }

                                            entry.value_ptr.* = .{
                                                .text = value_to_use,
                                            };
                                            _ = try this.seen.getOrPut(std.hash.Wyhash.hash(0, key));
                                        }
                                    }
                                }
                            }
                        },
                        else => {},
                    }
                }
            }
        }
    }

    pub fn writeSnapshotFile(this: *Snapshots) !void {
        if (this._current_file) |_file| {
            var file = _file;
            file.file.writeAll(this.file_buf.items) catch {
                return error.FailedToWriteSnapshotFile;
            };
            file.file.close();
            this.file_buf.clearRetainingCapacity();

            var value_itr = this.values.valueIterator();
            while (value_itr.next()) |value| {
                this.allocator.free(value.text);
            }

            var key_itr = this.values.keyIterator();
            while (key_itr.next()) |key| {
                this.allocator.free(key.*);
            }
            this.values.clearAndFree();
            this.seen.clearRetainingCapacity();
        }
    }

    fn getSnapshotFile(this: *Snapshots, file_id: TestRunner.File.ID) !JSC.Maybe(void) {
        if (this._current_file == null or this._current_file.?.id != file_id) {
            try this.writeSnapshotFile();

            const test_file = Jest.runner.?.files.get(file_id);
            const test_filename = test_file.source.path.name.filename;
            const dir_path = test_file.source.path.name.dirWithTrailingSlash();

            var snapshot_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var remain: []u8 = snapshot_file_path_buf[0..bun.MAX_PATH_BYTES];
            bun.copy(u8, remain, dir_path);
            remain = remain[dir_path.len..];
            bun.copy(u8, remain, "__snapshots__/");
            remain = remain["__snapshots__/".len..];

            if (this.snapshot_dir_path == null or !strings.eqlLong(dir_path, this.snapshot_dir_path.?, true)) {
                remain[0] = 0;
                const snapshot_dir_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];
                switch (bun.sys.mkdir(snapshot_dir_path, 0o777)) {
                    .result => this.snapshot_dir_path = dir_path,
                    .err => |err| {
                        switch (err.getErrno()) {
                            .EXIST => this.snapshot_dir_path = dir_path,
                            else => return JSC.Maybe(void){
                                .err = err,
                            },
                        }
                    },
                }
            }

            bun.copy(u8, remain, test_filename);
            remain = remain[test_filename.len..];
            bun.copy(u8, remain, ".snap");
            remain = remain[".snap".len..];
            remain[0] = 0;
            const snapshot_file_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];

            var flags: bun.Mode = std.os.O.CREAT | std.os.O.RDWR;
            if (this.update_snapshots) flags |= std.os.O.TRUNC;
            const fd = switch (bun.sys.open(snapshot_file_path, flags, 0o644)) {
                .result => |_fd| _fd,
                .err => |err| return JSC.Maybe(void){
                    .err = err,
                },
            };

            var file: File = .{
                .id = file_id,
                .file = .{ .handle = bun.fdcast(fd) },
            };

            if (this.update_snapshots) {
                try this.file_buf.appendSlice(file_header);
            } else {
                const length = try file.file.getEndPos();
                if (length == 0) {
                    try this.file_buf.appendSlice(file_header);
                } else {
                    try this.file_buf.ensureUnusedCapacity(length);
                    var writable = this.file_buf.items.ptr[this.file_buf.items.len..this.file_buf.capacity];
                    const wrote = try file.file.preadAll(writable, 0);
                    this.file_buf.items.len += wrote;
                }
            }

            this._current_file = file;
            try this.parseFile();
        }

        return JSC.Maybe(void).success;
    }
};
