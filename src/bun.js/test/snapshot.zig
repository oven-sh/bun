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
    const snapshots_dir_name = "__snapshots__" ++ [_]u8{std.fs.path.sep};
    pub const ValuesHashMap = std.HashMap(usize, string, bun.IdentityContext(usize), std.hash_map.default_max_load_percentage);

    allocator: std.mem.Allocator,
    update_snapshots: bool,
    total: usize = 0,
    added: usize = 0,
    passed: usize = 0,
    failed: usize = 0,

    file_buf: *std.ArrayList(u8),
    values: *ValuesHashMap,
    counts: *bun.StringHashMap(usize),
    _current_file: ?File = null,
    snapshot_dir_path: ?string = null,

    const File = struct {
        id: TestRunner.File.ID,
        file: std.fs.File,
    };

    pub fn getOrPut(this: *Snapshots, expect: *Expect, value: JSValue, hint: string, globalObject: *JSC.JSGlobalObject) !?string {
        switch (try this.getSnapshotFile(expect.testScope().?.describe.file_id)) {
            .result => {},
            .err => |err| {
                return switch (err.syscall) {
                    .mkdir => error.FailedToMakeSnapshotDirectory,
                    .open => error.FailedToOpenSnapshotFile,
                    else => error.SnapshotFailed,
                };
            },
        }

        const snapshot_name = try expect.getSnapshotName(this.allocator, hint);
        this.total += 1;

        const count_entry = try this.counts.getOrPut(snapshot_name);
        const counter = brk: {
            if (count_entry.found_existing) {
                this.allocator.free(snapshot_name);
                count_entry.value_ptr.* += 1;
                break :brk count_entry.value_ptr.*;
            }
            count_entry.value_ptr.* = 1;
            break :brk count_entry.value_ptr.*;
        };

        const name = count_entry.key_ptr.*;

        var counter_string_buf = [_]u8{0} ** 32;
        const counter_string = try std.fmt.bufPrint(&counter_string_buf, "{d}", .{counter});

        var name_with_counter = try this.allocator.alloc(u8, name.len + 1 + counter_string.len);
        defer this.allocator.free(name_with_counter);
        bun.copy(u8, name_with_counter[0..name.len], name);
        name_with_counter[name.len] = ' ';
        bun.copy(u8, name_with_counter[name.len + 1 ..], counter_string);

        const name_hash = bun.hash(name_with_counter);
        if (this.values.get(name_hash)) |expected| {
            return expected;
        }

        // doesn't exist. append to file bytes and add to hashmap.
        var pretty_value = try MutableString.init(this.allocator, 0);
        try value.jestSnapshotPrettyFormat(&pretty_value, globalObject);

        const serialized_length = "\nexports[`".len + name_with_counter.len + "`] = `".len + pretty_value.list.items.len + "`;\n".len;
        try this.file_buf.ensureUnusedCapacity(serialized_length);
        this.file_buf.appendSliceAssumeCapacity("\nexports[`");
        this.file_buf.appendSliceAssumeCapacity(name_with_counter);
        this.file_buf.appendSliceAssumeCapacity("`] = `");
        this.file_buf.appendSliceAssumeCapacity(pretty_value.list.items);
        this.file_buf.appendSliceAssumeCapacity("`;\n");

        this.added += 1;
        try this.values.put(name_hash, pretty_value.toOwnedSlice());
        return null;
    }

    pub fn parseFile(this: *Snapshots) !void {
        if (this.file_buf.items.len == 0) return;

        const vm = VirtualMachine.get();
        const opts = js_parser.Parser.Options.init(vm.bundler.options.jsx, .js);
        var temp_log = logger.Log.init(this.allocator);

        const test_file = Jest.runner.?.files.get(this._current_file.?.id);
        const test_filename = test_file.source.path.name.filename;
        const dir_path = test_file.source.path.name.dirWithTrailingSlash();

        var snapshot_file_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var remain: []u8 = snapshot_file_path_buf[0..bun.MAX_PATH_BYTES];
        bun.copy(u8, remain, dir_path);
        remain = remain[dir_path.len..];
        bun.copy(u8, remain, snapshots_dir_name);
        remain = remain[snapshots_dir_name.len..];
        bun.copy(u8, remain, test_filename);
        remain = remain[test_filename.len..];
        bun.copy(u8, remain, ".snap");
        remain = remain[".snap".len..];
        remain[0] = 0;
        const snapshot_file_path = snapshot_file_path_buf[0 .. snapshot_file_path_buf.len - remain.len :0];

        const source = logger.Source.initPathString(snapshot_file_path, this.file_buf.items);

        var parser = try js_parser.Parser.init(
            opts,
            &temp_log,
            &source,
            vm.bundler.options.define,
            this.allocator,
        );

        const parse_result = try parser.parse();
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
                                    if (target.ref.eql(exports_ref) and expr.value.data.e_binary.right.data == .e_string) {
                                        const key = index.slice(this.allocator);
                                        var value_string = expr.value.data.e_binary.right.data.e_string;
                                        const value = value_string.slice(this.allocator);
                                        defer {
                                            if (!index.isUTF8()) this.allocator.free(key);
                                            if (!value_string.isUTF8()) this.allocator.free(value);
                                        }
                                        const value_clone = try this.allocator.alloc(u8, value.len);
                                        bun.copy(u8, value_clone, value);
                                        const name_hash = bun.hash(key);
                                        try this.values.put(name_hash, value_clone);
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
            this.file_buf.clearAndFree();

            var value_itr = this.values.valueIterator();
            while (value_itr.next()) |value| {
                this.allocator.free(value.*);
            }
            this.values.clearAndFree();

            var count_key_itr = this.counts.keyIterator();
            while (count_key_itr.next()) |key| {
                this.allocator.free(key.*);
            }
            this.counts.clearAndFree();
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
            bun.copy(u8, remain, snapshots_dir_name);
            remain = remain[snapshots_dir_name.len..];

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
                .file = fd.asFile(),
            };

            if (this.update_snapshots) {
                try this.file_buf.appendSlice(file_header);
            } else {
                const length = try file.file.getEndPos();
                if (length == 0) {
                    try this.file_buf.appendSlice(file_header);
                } else {
                    const buf = try this.allocator.alloc(u8, length);
                    _ = try file.file.preadAll(buf, 0);
                    if (comptime bun.Environment.isWindows) {
                        try file.file.seekTo(0);
                    }
                    try this.file_buf.appendSlice(buf);
                    this.allocator.free(buf);
                }
            }

            this._current_file = file;
            try this.parseFile();
        }

        return JSC.Maybe(void).success;
    }
};
