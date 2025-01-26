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
    inline_snapshots_to_write: *std.AutoArrayHashMap(TestRunner.File.ID, std.ArrayList(InlineSnapshotToWrite)),

    pub const InlineSnapshotToWrite = struct {
        line: c_ulong,
        col: c_ulong,
        value: []const u8, // owned by Snapshots.allocator
        has_matchers: bool,
        is_added: bool,
        kind: []const u8, // static lifetime
        start_indent: ?[]const u8, // owned by Snapshots.allocator
        end_indent: ?[]const u8, // owned by Snapshots.allocator

        fn lessThanFn(_: void, a: InlineSnapshotToWrite, b: InlineSnapshotToWrite) bool {
            if (a.line < b.line) return true;
            if (a.line > b.line) return false;
            if (a.col < b.col) return true;
            return false;
        }
    };

    const File = struct {
        id: TestRunner.File.ID,
        file: std.fs.File,
    };

    pub fn addCount(this: *Snapshots, expect: *Expect, hint: []const u8) !struct { []const u8, usize } {
        this.total += 1;
        const snapshot_name = try expect.getSnapshotName(this.allocator, hint);
        const count_entry = try this.counts.getOrPut(snapshot_name);
        if (count_entry.found_existing) {
            this.allocator.free(snapshot_name);
            count_entry.value_ptr.* += 1;
            return .{ count_entry.key_ptr.*, count_entry.value_ptr.* };
        }
        count_entry.value_ptr.* = 1;
        return .{ count_entry.key_ptr.*, count_entry.value_ptr.* };
    }
    pub fn getOrPut(this: *Snapshots, expect: *Expect, target_value: []const u8, hint: string) !?string {
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

        const name, const counter = try this.addCount(expect, hint);

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
        const estimated_length = "\nexports[`".len + name_with_counter.len + "`] = `".len + target_value.len + "`;\n".len;
        try this.file_buf.ensureUnusedCapacity(estimated_length + 10);
        try this.file_buf.writer().print(
            "\nexports[`{}`] = `{}`;\n",
            .{
                strings.formatEscapes(name_with_counter, .{ .quote_char = '`' }),
                strings.formatEscapes(target_value, .{ .quote_char = '`' }),
            },
        );

        this.added += 1;
        try this.values.put(name_hash, try this.allocator.dupe(u8, target_value));
        return null;
    }

    pub fn parseFile(this: *Snapshots, file: File) !void {
        if (this.file_buf.items.len == 0) return;

        const vm = VirtualMachine.get();
        const opts = js_parser.Parser.Options.init(vm.transpiler.options.jsx, .js);
        var temp_log = logger.Log.init(this.allocator);

        const test_file = Jest.runner.?.files.get(file.id);
        const test_filename = test_file.source.path.name.filename;
        const dir_path = test_file.source.path.name.dirWithTrailingSlash();

        var snapshot_file_path_buf: bun.PathBuffer = undefined;
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
            vm.transpiler.options.define,
            this.allocator,
        );

        const parse_result = try parser.parse();
        var ast = if (parse_result == .ast) parse_result.ast else return error.ParseError;
        defer ast.deinit();

        if (ast.exports_ref.isNull()) return;
        const exports_ref = ast.exports_ref;

        // TODO: when common js transform changes, keep this updated or add flag to support this version

        for (ast.parts.slice()) |part| {
            for (part.stmts) |stmt| {
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

    pub fn addInlineSnapshotToWrite(self: *Snapshots, file_id: TestRunner.File.ID, value: InlineSnapshotToWrite) !void {
        const gpres = try self.inline_snapshots_to_write.getOrPut(file_id);
        if (!gpres.found_existing) {
            gpres.value_ptr.* = std.ArrayList(InlineSnapshotToWrite).init(self.allocator);
        }
        try gpres.value_ptr.append(value);
    }

    const inline_snapshot_dbg = bun.Output.scoped(.inline_snapshot, false);
    pub fn writeInlineSnapshots(this: *Snapshots) !bool {
        var arena_backing = bun.ArenaAllocator.init(this.allocator);
        defer arena_backing.deinit();
        const arena = arena_backing.allocator();

        var success = true;
        const vm = VirtualMachine.get();
        const opts = js_parser.Parser.Options.init(vm.transpiler.options.jsx, .js);

        for (this.inline_snapshots_to_write.keys(), this.inline_snapshots_to_write.values()) |file_id, *ils_info| {
            _ = arena_backing.reset(.retain_capacity);

            var log = bun.logger.Log.init(arena);
            defer if (log.errors > 0) {
                log.print(bun.Output.errorWriter()) catch {};
                success = false;
            };

            // 1. sort ils_info by row, col
            std.mem.sort(InlineSnapshotToWrite, ils_info.items, {}, InlineSnapshotToWrite.lessThanFn);

            // 2. load file text
            const test_file = Jest.runner.?.files.get(file_id);
            const test_filename = try arena.dupeZ(u8, test_file.source.path.text);

            const fd = switch (bun.sys.open(test_filename, bun.O.RDWR, 0o644)) {
                .result => |r| r,
                .err => |e| {
                    try log.addErrorFmt(&bun.logger.Source.initEmptyFile(test_filename), .{ .start = 0 }, arena, "Failed to update inline snapshot: Failed to open file: {s}", .{e.name()});
                    continue;
                },
            };
            var file: File = .{
                .id = file_id,
                .file = fd.asFile(),
            };
            errdefer file.file.close();

            const file_text = try file.file.readToEndAlloc(arena, std.math.maxInt(usize));

            var source = bun.logger.Source.initPathString(test_filename, file_text);

            var result_text = std.ArrayList(u8).init(arena);

            // 3. start looping, finding bytes from line/col

            var uncommitted_segment_end: usize = 0;
            var last_byte: usize = 0;
            var last_line: c_ulong = 1;
            var last_col: c_ulong = 1;
            for (ils_info.items) |ils| {
                if (ils.line == last_line and ils.col == last_col) {
                    try log.addErrorFmt(&source, .{ .start = @intCast(uncommitted_segment_end) }, arena, "Failed to update inline snapshot: Multiple inline snapshots for the same call are not supported", .{});
                    continue;
                }

                inline_snapshot_dbg("Finding byte for {}/{}", .{ ils.line, ils.col });
                const byte_offset_add = logger.Source.lineColToByteOffset(file_text[last_byte..], last_line, last_col, ils.line, ils.col) orelse {
                    inline_snapshot_dbg("-> Could not find byte", .{});
                    try log.addErrorFmt(&source, .{ .start = @intCast(uncommitted_segment_end) }, arena, "Failed to update inline snapshot: Ln {d}, Col {d} not found", .{ ils.line, ils.col });
                    continue;
                };

                // found
                last_byte += byte_offset_add;
                last_line = ils.line;
                last_col = ils.col;

                var next_start = last_byte;
                inline_snapshot_dbg("-> Found byte {}", .{next_start});

                const final_start: i32, const final_end: i32, const needs_pre_comma: bool = blk: {
                    if (file_text[next_start..].len > 0) switch (file_text[next_start]) {
                        ' ', '.' => {
                            // work around off-by-1 error in `expect("§").toMatchInlineSnapshot()`
                            next_start += 1;
                        },
                        else => {},
                    };
                    const fn_name = ils.kind;
                    if (!bun.strings.startsWith(file_text[next_start..], fn_name)) {
                        try log.addErrorFmt(&source, .{ .start = @intCast(next_start) }, arena, "Failed to update inline snapshot: Could not find '{s}' here", .{fn_name});
                        continue;
                    }
                    next_start += fn_name.len;

                    var lexer = bun.js_lexer.Lexer.initWithoutReading(&log, source, arena);
                    if (next_start > 0) {
                        // equivalent to lexer.consumeRemainderBytes(next_start)
                        lexer.current += next_start - (lexer.current - lexer.end);
                        lexer.step();
                    }
                    try lexer.next();
                    var parser: bun.js_parser.TSXParser = undefined;
                    try bun.js_parser.TSXParser.init(arena, &log, &source, vm.transpiler.options.define, lexer, opts, &parser);

                    try parser.lexer.expect(.t_open_paren);
                    const after_open_paren_loc = parser.lexer.loc().start;
                    if (parser.lexer.token == .t_close_paren) {
                        // zero args
                        if (ils.has_matchers) {
                            try log.addErrorFmt(&source, parser.lexer.loc(), arena, "Failed to update inline snapshot: Snapshot has matchers and yet has no arguments", .{});
                            continue;
                        }
                        const close_paren_loc = parser.lexer.loc().start;
                        try parser.lexer.expect(.t_close_paren);
                        break :blk .{ after_open_paren_loc, close_paren_loc, false };
                    }
                    if (parser.lexer.token == .t_dot_dot_dot) {
                        try log.addErrorFmt(&source, parser.lexer.loc(), arena, "Failed to update inline snapshot: Spread is not allowed", .{});
                        continue;
                    }

                    const before_expr_loc = parser.lexer.loc().start;
                    const expr_1 = try parser.parseExpr(.comma);
                    const after_expr_loc = parser.lexer.loc().start;

                    var is_one_arg = false;
                    if (parser.lexer.token == .t_comma) {
                        try parser.lexer.expect(.t_comma);
                        if (parser.lexer.token == .t_close_paren) is_one_arg = true;
                    } else is_one_arg = true;
                    const after_comma_loc = parser.lexer.loc().start;

                    if (is_one_arg) {
                        try parser.lexer.expect(.t_close_paren);
                        if (ils.has_matchers) {
                            break :blk .{ after_expr_loc, after_comma_loc, true };
                        } else {
                            if (expr_1.data != .e_string) {
                                try log.addErrorFmt(&source, expr_1.loc, arena, "Failed to update inline snapshot: Argument must be a string literal", .{});
                                continue;
                            }
                            break :blk .{ before_expr_loc, after_expr_loc, false };
                        }
                    }

                    if (parser.lexer.token == .t_dot_dot_dot) {
                        try log.addErrorFmt(&source, parser.lexer.loc(), arena, "Failed to update inline snapshot: Spread is not allowed", .{});
                        continue;
                    }

                    const before_expr_2_loc = parser.lexer.loc().start;
                    const expr_2 = try parser.parseExpr(.comma);
                    const after_expr_2_loc = parser.lexer.loc().start;

                    if (!ils.has_matchers) {
                        try log.addErrorFmt(&source, parser.lexer.loc(), arena, "Failed to update inline snapshot: Snapshot does not have matchers and yet has two arguments", .{});
                        continue;
                    }
                    if (expr_2.data != .e_string) {
                        try log.addErrorFmt(&source, expr_2.loc, arena, "Failed to update inline snapshot: Argument must be a string literal", .{});
                        continue;
                    }

                    if (parser.lexer.token == .t_comma) {
                        try parser.lexer.expect(.t_comma);
                    }
                    if (parser.lexer.token != .t_close_paren) {
                        try log.addErrorFmt(&source, parser.lexer.loc(), arena, "Failed to update inline snapshot: Snapshot expects at most two arguments", .{});
                        continue;
                    }
                    try parser.lexer.expect(.t_close_paren);

                    break :blk .{ before_expr_2_loc, after_expr_2_loc, false };
                };
                const final_start_usize = std.math.cast(usize, final_start) orelse 0;
                const final_end_usize = std.math.cast(usize, final_end) orelse 0;
                inline_snapshot_dbg("  -> Found update range {}-{}", .{ final_start_usize, final_end_usize });

                if (final_end_usize < final_start_usize or final_start_usize < uncommitted_segment_end) {
                    try log.addErrorFmt(&source, .{ .start = final_start }, arena, "Failed to update inline snapshot: Did not advance.", .{});
                    continue;
                }

                try result_text.appendSlice(file_text[uncommitted_segment_end..final_start_usize]);
                uncommitted_segment_end = final_end_usize;

                // preserve existing indentation level, otherwise indent the same as the start position plus two spaces
                var needs_more_spaces = false;
                const start_indent = ils.start_indent orelse D: {
                    const source_until_final_start = source.contents[0..final_start_usize];
                    const line_start = if (std.mem.lastIndexOfScalar(u8, source_until_final_start, '\n')) |newline_loc| newline_loc + 1 else 0;
                    const indent_count = for (source_until_final_start[line_start..], 0..) |char, j| {
                        if (char != ' ' and char != '\t') break j;
                    } else source_until_final_start[line_start..].len;
                    needs_more_spaces = true;
                    break :D source_until_final_start[line_start..][0..indent_count];
                };

                var re_indented_string = std.ArrayList(u8).init(arena);
                defer re_indented_string.deinit();
                const re_indented = if (ils.value.len > 0 and ils.value[0] == '\n') blk: {
                    // append starting newline
                    try re_indented_string.appendSlice("\n");
                    var re_indented_source = ils.value[1..];
                    while (re_indented_source.len > 0) {
                        const next_newline = if (std.mem.indexOfScalar(u8, re_indented_source, '\n')) |a| a + 1 else re_indented_source.len;
                        const segment = re_indented_source[0..next_newline];
                        if (segment.len == 0) {
                            // last line; loop already exited
                            unreachable;
                        } else if (bun.strings.eqlComptime(segment, "\n")) {
                            // zero length line. no indent.
                        } else {
                            // regular line. indent.
                            try re_indented_string.appendSlice(start_indent);
                            if (needs_more_spaces) try re_indented_string.appendSlice("  ");
                        }
                        try re_indented_string.appendSlice(segment);
                        re_indented_source = re_indented_source[next_newline..];
                    }
                    // indent before backtick
                    try re_indented_string.appendSlice(ils.end_indent orelse start_indent);
                    break :blk re_indented_string.items;
                } else ils.value;

                if (needs_pre_comma) try result_text.appendSlice(", ");
                const result_text_writer = result_text.writer();
                try result_text.appendSlice("`");
                try bun.js_printer.writePreQuotedString(re_indented, @TypeOf(result_text_writer), result_text_writer, '`', false, false, .utf8);
                try result_text.appendSlice("`");

                if (ils.is_added) Jest.runner.?.snapshots.added += 1;
            }

            // commit the last segment
            try result_text.appendSlice(file_text[uncommitted_segment_end..]);

            if (log.errors > 0) {
                // skip writing the file if there were errors
                continue;
            }

            // 4. write out result_text to the file
            file.file.seekTo(0) catch |e| {
                try log.addErrorFmt(&source, .{ .start = 0 }, arena, "Failed to update inline snapshot: Seek file error: {s}", .{@errorName(e)});
                continue;
            };

            file.file.writeAll(result_text.items) catch |e| {
                try log.addErrorFmt(&source, .{ .start = 0 }, arena, "Failed to update inline snapshot: Write file error: {s}", .{@errorName(e)});
                continue;
            };
            if (result_text.items.len < file_text.len) {
                file.file.setEndPos(result_text.items.len) catch {
                    @panic("Failed to update inline snapshot: File was left in an invalid state");
                };
            }
        }
        return success;
    }

    fn getSnapshotFile(this: *Snapshots, file_id: TestRunner.File.ID) !JSC.Maybe(void) {
        if (this._current_file == null or this._current_file.?.id != file_id) {
            try this.writeSnapshotFile();

            const test_file = Jest.runner.?.files.get(file_id);
            const test_filename = test_file.source.path.name.filename;
            const dir_path = test_file.source.path.name.dirWithTrailingSlash();

            var snapshot_file_path_buf: bun.PathBuffer = undefined;
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

            var flags: bun.Mode = bun.O.CREAT | bun.O.RDWR;
            if (this.update_snapshots) flags |= bun.O.TRUNC;
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
            errdefer file.file.close();

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

            try this.parseFile(file);
            this._current_file = file;
        }

        return JSC.Maybe(void).success;
    }
};
