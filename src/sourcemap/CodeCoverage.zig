const LinesHits = bun.collections.BabyList(u32);

/// Our code coverage currently only deals with lines of code, not statements or branches.
/// JSC doesn't expose function names in their coverage data, so we don't include that either :(.
/// Since we only need to store line numbers, our job gets simpler
///
/// We can use two bitsets to store code coverage data for a given file
/// 1. executable_lines
/// 2. lines_which_have_executed
///
/// Not all lines of code are executable. Comments, whitespace, empty lines, etc. are not executable.
/// It's not a problem for anyone if comments, whitespace, empty lines etc are not executed, so those should always be omitted from coverage reports
///
/// We use two bitsets since the typical size will be decently small,
/// bitsets are simple and bitsets are relatively fast to construct and query
///
pub const Report = struct {
    source_url: bun.jsc.ZigString.Slice,
    executable_lines: Bitset,
    lines_which_have_executed: Bitset,
    line_hits: LinesHits = .{},
    functions: std.ArrayListUnmanaged(Block),
    functions_which_have_executed: Bitset,
    stmts_which_have_executed: Bitset,
    stmts: std.ArrayListUnmanaged(Block),
    total_lines: u32 = 0,

    pub fn linesCoverageFraction(this: *const Report) f64 {
        var intersected = bun.handleOom(this.executable_lines.clone(bun.default_allocator));
        defer intersected.deinit(bun.default_allocator);
        intersected.setIntersection(this.lines_which_have_executed);

        const total_count: f64 = @floatFromInt(this.executable_lines.count());
        if (total_count == 0) {
            return 1.0;
        }

        const intersected_count: f64 = @floatFromInt(intersected.count());

        return (intersected_count / total_count);
    }

    pub fn stmtsCoverageFraction(this: *const Report) f64 {
        const total_count: f64 = @floatFromInt(this.stmts.items.len);

        if (total_count == 0) {
            return 1.0;
        }

        return ((@as(f64, @floatFromInt(this.stmts_which_have_executed.count()))) / (total_count));
    }

    pub fn functionCoverageFraction(this: *const Report) f64 {
        const total_count: f64 = @floatFromInt(this.functions.items.len);
        if (total_count == 0) {
            return 1.0;
        }
        return (@as(f64, @floatFromInt(this.functions_which_have_executed.count())) / total_count);
    }

    pub const Text = struct {
        pub fn writeFormatWithValues(
            filename: []const u8,
            max_filename_length: usize,
            vals: Fraction,
            failing: Fraction,
            failed: bool,
            writer: *std.Io.Writer,
            indent_name: bool,
            comptime enable_colors: bool,
        ) !void {
            if (comptime enable_colors) {
                if (failed) {
                    try writer.writeAll(comptime prettyFmt("<r><b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<r><b><green>", true));
                }
            }

            if (indent_name) {
                try writer.writeAll(" ");
            }

            try writer.writeAll(filename);
            try writer.splatByteAll(' ', (max_filename_length - filename.len + @as(usize, @intFromBool(!indent_name))));
            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            if (comptime enable_colors) {
                if (vals.functions < failing.functions) {
                    try writer.writeAll(comptime prettyFmt("<b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<b><green>", true));
                }
            }

            try writer.print("{d: >7.2}", .{vals.functions * 100.0});
            // try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));
            // if (comptime enable_colors) {
            //     // if (vals.stmts < failing.stmts) {
            //     try writer.writeAll(comptime prettyFmt("<d>", true));
            //     // } else {
            //     //     try writer.writeAll(comptime prettyFmt("<d>", true));
            //     // }
            // }
            // try writer.print("{d: >8.2}", .{vals.stmts * 100.0});
            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            if (comptime enable_colors) {
                if (vals.lines < failing.lines) {
                    try writer.writeAll(comptime prettyFmt("<b><red>", true));
                } else {
                    try writer.writeAll(comptime prettyFmt("<b><green>", true));
                }
            }

            try writer.print("{d: >7.2}", .{vals.lines * 100.0});
        }

        pub fn writeFormat(
            report: *const Report,
            max_filename_length: usize,
            fraction: *Fraction,
            base_path: []const u8,
            writer: *std.Io.Writer,
            comptime enable_colors: bool,
        ) !void {
            const failing = fraction.*;
            const fns = report.functionCoverageFraction();
            const lines = report.linesCoverageFraction();
            const stmts = report.stmtsCoverageFraction();
            fraction.functions = fns;
            fraction.lines = lines;
            fraction.stmts = stmts;

            const failed = fns < failing.functions or lines < failing.lines; // or stmts < failing.stmts;
            fraction.failing = failed;

            var filename = report.source_url.slice();
            if (base_path.len > 0) {
                filename = bun.path.relative(base_path, filename);
            }

            try writeFormatWithValues(
                filename,
                max_filename_length,
                fraction.*,
                failing,
                failed,
                writer,
                true,
                enable_colors,
            );

            try writer.writeAll(comptime prettyFmt("<r><d> | <r>", enable_colors));

            var executable_lines_that_havent_been_executed = bun.handleOom(report.lines_which_have_executed.clone(bun.default_allocator));
            defer executable_lines_that_havent_been_executed.deinit(bun.default_allocator);
            executable_lines_that_havent_been_executed.toggleAll();

            // This sets statements in executed scopes
            executable_lines_that_havent_been_executed.setIntersection(report.executable_lines);

            var iter = executable_lines_that_havent_been_executed.iterator(.{});
            var start_of_line_range: usize = 0;
            var prev_line: usize = 0;
            var is_first = true;

            while (iter.next()) |next_line| {
                if (next_line == (prev_line + 1)) {
                    prev_line = next_line;
                    continue;
                } else if (is_first and start_of_line_range == 0 and prev_line == 0) {
                    start_of_line_range = next_line;
                    prev_line = next_line;
                    continue;
                }

                if (is_first) {
                    is_first = false;
                } else {
                    try writer.print(comptime prettyFmt("<r><d>,<r>", enable_colors), .{});
                }

                if (start_of_line_range == prev_line) {
                    try writer.print(comptime prettyFmt("<red>{d}", enable_colors), .{start_of_line_range + 1});
                } else {
                    try writer.print(comptime prettyFmt("<red>{d}-{d}", enable_colors), .{ start_of_line_range + 1, prev_line + 1 });
                }

                prev_line = next_line;
                start_of_line_range = next_line;
            }

            if (prev_line != start_of_line_range) {
                if (is_first) {
                    is_first = false;
                } else {
                    try writer.print(comptime prettyFmt("<r><d>,<r>", enable_colors), .{});
                }

                if (start_of_line_range == prev_line) {
                    try writer.print(comptime prettyFmt("<red>{d}", enable_colors), .{start_of_line_range + 1});
                } else {
                    try writer.print(comptime prettyFmt("<red>{d}-{d}", enable_colors), .{ start_of_line_range + 1, prev_line + 1 });
                }
            }
        }
    };

    pub const Lcov = struct {
        pub fn writeFormat(
            report: *const Report,
            base_path: []const u8,
            writer: *std.Io.Writer,
        ) !void {
            var filename = report.source_url.slice();
            if (base_path.len > 0) {
                filename = bun.path.relative(base_path, filename);
            }

            // TN: test name
            // Empty value appears fine. For example, `TN:`.
            try writer.writeAll("TN:\n");

            // SF: Source File path
            // For example, `SF:path/to/source.ts`
            try writer.print("SF:{s}\n", .{filename});

            // ** Per-function coverage not supported yet, since JSC does not support function names yet. **
            // FN: line number,function name

            // FNF: functions found
            try writer.print("FNF:{d}\n", .{report.functions.items.len});

            // FNH: functions hit
            try writer.print("FNH:{d}\n", .{report.functions_which_have_executed.count()});

            // ** Track all executable lines **
            // Executable lines that were not hit should be marked as 0
            var executable_lines = bun.handleOom(report.executable_lines.clone(bun.default_allocator));
            defer executable_lines.deinit(bun.default_allocator);
            var iter = executable_lines.iterator(.{});

            // ** Branch coverage not supported yet, since JSC does not support those yet. ** //
            // BRDA: line, block, (expressions,count)+
            // BRF: branches found
            // BRH: branches hit
            const line_hits = report.line_hits.slice();
            while (iter.next()) |line| {
                // DA: line number, hit count
                try writer.print("DA:{d},{d}\n", .{ line + 1, line_hits[line] });
            }

            // LF: lines found
            try writer.print("LF:{d}\n", .{report.executable_lines.count()});

            // LH: lines hit
            try writer.print("LH:{d}\n", .{report.lines_which_have_executed.count()});

            try writer.writeAll("end_of_record\n");
        }
    };

    pub fn deinit(this: *Report, allocator: std.mem.Allocator) void {
        this.executable_lines.deinit(allocator);
        this.lines_which_have_executed.deinit(allocator);
        this.line_hits.deinit(allocator);
        this.functions.deinit(allocator);
        this.stmts.deinit(allocator);
        this.functions_which_have_executed.deinit(allocator);
        this.stmts_which_have_executed.deinit(allocator);
    }

    extern fn CodeCoverage__withBlocksAndFunctions(
        *bun.jsc.VM,
        i32,
        *anyopaque,
        bool,
        *const fn (
            *Generator,
            [*]const BasicBlockRange,
            usize,
            usize,
            bool,
        ) callconv(.c) void,
    ) bool;

    const Generator = struct {
        allocator: std.mem.Allocator,
        byte_range_mapping: *ByteRangeMapping,
        result: *?Report,

        pub fn do(
            this: *@This(),
            blocks_ptr: [*]const BasicBlockRange,
            blocks_len: usize,
            function_start_offset: usize,
            ignore_sourcemap: bool,
        ) callconv(.c) void {
            const blocks: []const BasicBlockRange = blocks_ptr[0..function_start_offset];
            var function_blocks: []const BasicBlockRange = blocks_ptr[function_start_offset..blocks_len];
            if (function_blocks.len > 1) {
                function_blocks = function_blocks[1..];
            }

            if (blocks.len == 0) {
                return;
            }

            this.result.* = this.byte_range_mapping.generateReportFromBlocks(
                this.allocator,
                this.byte_range_mapping.source_url,
                blocks,
                function_blocks,
                ignore_sourcemap,
            ) catch null;
        }
    };

    pub fn generate(
        globalThis: *bun.jsc.JSGlobalObject,
        allocator: std.mem.Allocator,
        byte_range_mapping: *ByteRangeMapping,
        ignore_sourcemap_: bool,
    ) ?Report {
        bun.jsc.markBinding(@src());
        const vm = globalThis.vm();

        var result: ?Report = null;

        var generator = Generator{
            .result = &result,
            .allocator = allocator,
            .byte_range_mapping = byte_range_mapping,
        };

        if (!CodeCoverage__withBlocksAndFunctions(
            vm,
            byte_range_mapping.source_id,
            &generator,
            ignore_sourcemap_,
            &Generator.do,
        )) {
            return null;
        }

        return result;
    }
};

const BasicBlockRange = extern struct {
    startOffset: c_int = 0,
    endOffset: c_int = 0,
    hasExecuted: bool = false,
    executionCount: usize = 0,
};

pub const ByteRangeMapping = struct {
    line_offset_table: LineOffsetTable.List = .{},
    source_id: i32,
    source_url: bun.jsc.ZigString.Slice,

    pub fn isLessThan(_: void, a: ByteRangeMapping, b: ByteRangeMapping) bool {
        return bun.strings.order(a.source_url.slice(), b.source_url.slice()) == .lt;
    }

    pub const HashMap = std.HashMap(u64, ByteRangeMapping, bun.IdentityContext(u64), std.hash_map.default_max_load_percentage);

    pub fn deinit(this: *ByteRangeMapping) void {
        this.line_offset_table.deinit(bun.default_allocator);
    }

    pub threadlocal var map: ?*HashMap = null;
    pub fn generate(str: bun.String, source_contents_str: bun.String, source_id: i32) callconv(.c) void {
        var _map = map orelse brk: {
            map = bun.handleOom(bun.jsc.VirtualMachine.get().allocator.create(HashMap));
            map.?.* = HashMap.init(bun.jsc.VirtualMachine.get().allocator);
            break :brk map.?;
        };
        var slice = str.toUTF8(bun.default_allocator);
        const hash = bun.hash(slice.slice());
        var entry = bun.handleOom(_map.getOrPut(hash));
        if (entry.found_existing) {
            entry.value_ptr.deinit();
        }

        var source_contents = source_contents_str.toUTF8(bun.default_allocator);
        defer source_contents.deinit();

        entry.value_ptr.* = compute(source_contents.slice(), source_id, slice);
    }

    pub fn getSourceID(this: *ByteRangeMapping) callconv(.c) i32 {
        return this.source_id;
    }

    pub fn find(path: bun.String) callconv(.c) ?*ByteRangeMapping {
        var slice = path.toUTF8(bun.default_allocator);
        defer slice.deinit();

        var map_ = map orelse return null;
        const hash = bun.hash(slice.slice());
        const entry = map_.getPtr(hash) orelse return null;
        return entry;
    }

    pub fn generateReportFromBlocks(
        this: *ByteRangeMapping,
        allocator: std.mem.Allocator,
        source_url: bun.jsc.ZigString.Slice,
        blocks: []const BasicBlockRange,
        function_blocks: []const BasicBlockRange,
        ignore_sourcemap: bool,
    ) !Report {
        const line_starts = this.line_offset_table.items(.byte_offset_to_start_of_line);

        var executable_lines: Bitset = Bitset{};
        var lines_which_have_executed: Bitset = Bitset{};
        const parsed_mappings_ = bun.jsc.VirtualMachine.get().source_mappings.get(source_url.slice());
        defer if (parsed_mappings_) |parsed_mapping| parsed_mapping.deref();
        var line_hits = LinesHits{};

        var functions = std.ArrayListUnmanaged(Block){};
        try functions.ensureTotalCapacityPrecise(allocator, function_blocks.len);
        errdefer functions.deinit(allocator);
        var functions_which_have_executed: Bitset = try Bitset.initEmpty(allocator, function_blocks.len);
        errdefer functions_which_have_executed.deinit(allocator);
        var stmts_which_have_executed: Bitset = try Bitset.initEmpty(allocator, blocks.len);
        errdefer stmts_which_have_executed.deinit(allocator);

        var stmts = std.ArrayListUnmanaged(Block){};
        try stmts.ensureTotalCapacityPrecise(allocator, function_blocks.len);
        errdefer stmts.deinit(allocator);

        errdefer executable_lines.deinit(allocator);
        errdefer lines_which_have_executed.deinit(allocator);
        var line_count: u32 = 0;

        if (ignore_sourcemap or parsed_mappings_ == null) {
            line_count = @truncate(line_starts.len);
            executable_lines = try Bitset.initEmpty(allocator, line_count);
            lines_which_have_executed = try Bitset.initEmpty(allocator, line_count);
            line_hits = try LinesHits.initCapacity(allocator, line_count);
            line_hits.len = line_count;
            const line_hits_slice = line_hits.slice();
            @memset(line_hits_slice, 0);

            errdefer line_hits.deinit(allocator);

            for (blocks, 0..) |block, i| {
                if (block.endOffset < 0 or block.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(block.startOffset, block.endOffset));
                const max: usize = @intCast(@max(block.startOffset, block.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                const has_executed = block.hasExecuted or block.executionCount > 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const line: u32 = @intCast(new_line_index);
                    min_line = @min(min_line, line);
                    max_line = @max(max_line, line);

                    executable_lines.set(line);
                    if (has_executed) {
                        lines_which_have_executed.set(line);
                        line_hits_slice[line] += 1;
                    }
                }

                if (min_line != std.math.maxInt(u32)) {
                    if (has_executed)
                        stmts_which_have_executed.set(i);

                    try stmts.append(allocator, .{
                        .start_line = min_line,
                        .end_line = max_line,
                    });
                }
            }

            for (function_blocks, 0..) |function, i| {
                if (function.endOffset < 0 or function.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(function.startOffset, function.endOffset));
                const max: usize = @intCast(@max(function.startOffset, function.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const line: u32 = @intCast(new_line_index);
                    min_line = @min(min_line, line);
                    max_line = @max(max_line, line);
                }

                const did_fn_execute = function.executionCount > 0 or function.hasExecuted;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if (!did_fn_execute) {
                    const end = @min(max_line, line_count);
                    @memset(line_hits_slice[min_line..end], 0);
                    for (min_line..end) |line| {
                        executable_lines.set(line);
                        lines_which_have_executed.unset(line);
                    }
                }

                try functions.append(allocator, .{
                    .start_line = min_line,
                    .end_line = max_line,
                });

                if (did_fn_execute)
                    functions_which_have_executed.set(i);
            }
        } else if (parsed_mappings_) |parsed_mapping| {
            line_count = @as(u32, @truncate(parsed_mapping.input_line_count)) + 1;
            executable_lines = try Bitset.initEmpty(allocator, line_count);
            lines_which_have_executed = try Bitset.initEmpty(allocator, line_count);
            line_hits = try LinesHits.initCapacity(allocator, line_count);
            line_hits.len = line_count;
            const line_hits_slice = line_hits.slice();
            @memset(line_hits_slice, 0);
            errdefer line_hits.deinit(allocator);

            for (blocks, 0..) |block, i| {
                if (block.endOffset < 0 or block.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(block.startOffset, block.endOffset));
                const max: usize = @intCast(@max(block.startOffset, block.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;
                const has_executed = block.hasExecuted or block.executionCount > 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }
                    const column_position = byte_offset -| line_start_byte_offset;

                    if (parsed_mapping.mappings.find(.fromZeroBased(@intCast(new_line_index)), .fromZeroBased(@intCast(column_position)))) |*point| {
                        if (point.original.lines.zeroBased() < 0) continue;

                        const line: u32 = @as(u32, @intCast(point.original.lines.zeroBased()));

                        executable_lines.set(line);
                        if (has_executed) {
                            lines_which_have_executed.set(line);
                            line_hits_slice[line] += 1;
                        }

                        min_line = @min(min_line, line);
                        max_line = @max(max_line, line);
                    }
                }

                if (min_line != std.math.maxInt(u32)) {
                    try stmts.append(allocator, .{
                        .start_line = min_line,
                        .end_line = max_line,
                    });

                    if (has_executed)
                        stmts_which_have_executed.set(i);
                }
            }

            for (function_blocks, 0..) |function, i| {
                if (function.endOffset < 0 or function.startOffset < 0) continue; // does not map to anything

                const min: usize = @intCast(@min(function.startOffset, function.endOffset));
                const max: usize = @intCast(@max(function.startOffset, function.endOffset));
                var min_line: u32 = std.math.maxInt(u32);
                var max_line: u32 = 0;

                for (min..max) |byte_offset| {
                    const new_line_index = LineOffsetTable.findIndex(line_starts, .{ .start = @intCast(byte_offset) }) orelse continue;
                    const line_start_byte_offset = line_starts[new_line_index];
                    if (line_start_byte_offset >= byte_offset) {
                        continue;
                    }

                    const column_position = byte_offset -| line_start_byte_offset;

                    if (parsed_mapping.mappings.find(.fromZeroBased(@intCast(new_line_index)), .fromZeroBased(@intCast(column_position)))) |point| {
                        if (point.original.lines.zeroBased() < 0) continue;

                        const line: u32 = @as(u32, @intCast(point.original.lines.zeroBased()));
                        min_line = @min(min_line, line);
                        max_line = @max(max_line, line);
                    }
                }

                // no sourcemaps? ignore it
                if (min_line == std.math.maxInt(u32) and max_line == 0) {
                    continue;
                }

                const did_fn_execute = function.executionCount > 0 or function.hasExecuted;

                // only mark the lines as executable if the function has not executed
                // functions that have executed have non-executable lines in them and thats fine.
                if (!did_fn_execute) {
                    const end = @min(max_line, line_count);
                    for (min_line..end) |line| {
                        executable_lines.set(line);
                        lines_which_have_executed.unset(line);
                        line_hits_slice[line] = 0;
                    }
                }

                try functions.append(allocator, .{
                    .start_line = min_line,
                    .end_line = max_line,
                });
                if (did_fn_execute)
                    functions_which_have_executed.set(i);
            }
        } else {
            unreachable;
        }

        return .{
            .source_url = source_url,
            .functions = functions,
            .executable_lines = executable_lines,
            .lines_which_have_executed = lines_which_have_executed,
            .line_hits = line_hits,
            .total_lines = line_count,
            .stmts = stmts,
            .functions_which_have_executed = functions_which_have_executed,
            .stmts_which_have_executed = stmts_which_have_executed,
        };
    }

    pub fn findExecutedLines(
        globalThis: *bun.jsc.JSGlobalObject,
        source_url: bun.String,
        blocks_ptr: [*]const BasicBlockRange,
        blocks_len: usize,
        function_start_offset: usize,
        ignore_sourcemap: bool,
    ) callconv(.c) bun.jsc.JSValue {
        var this = ByteRangeMapping.find(source_url) orelse return bun.jsc.JSValue.null;

        const blocks: []const BasicBlockRange = blocks_ptr[0..function_start_offset];
        var function_blocks: []const BasicBlockRange = blocks_ptr[function_start_offset..blocks_len];
        if (function_blocks.len > 1) {
            function_blocks = function_blocks[1..];
        }
        var url_slice = source_url.toUTF8(bun.default_allocator);
        defer url_slice.deinit();
        var report = this.generateReportFromBlocks(bun.default_allocator, url_slice, blocks, function_blocks, ignore_sourcemap) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        defer report.deinit(bun.default_allocator);

        var coverage_fraction = Fraction{};

        var allocating_writer = std.Io.Writer.Allocating.init(bun.default_allocator);
        defer allocating_writer.deinit();
        const buffered_writer = &allocating_writer.writer;

        Report.Text.writeFormat(&report, source_url.utf8ByteLength(), &coverage_fraction, "", buffered_writer, false) catch {
            return globalThis.throwOutOfMemoryValue();
        };

        buffered_writer.flush() catch {
            return globalThis.throwOutOfMemoryValue();
        };

        return bun.String.createUTF8ForJS(globalThis, allocating_writer.written()) catch return .zero;
    }

    pub fn compute(source_contents: []const u8, source_id: i32, source_url: bun.jsc.ZigString.Slice) ByteRangeMapping {
        return ByteRangeMapping{
            .line_offset_table = LineOffsetTable.generate(bun.jsc.VirtualMachine.get().allocator, source_contents, 0),
            .source_id = source_id,
            .source_url = source_url,
        };
    }
};

comptime {
    if (bun.Environment.isNative) {
        @export(&ByteRangeMapping.generate, .{ .name = "ByteRangeMapping__generate" });
        @export(&ByteRangeMapping.findExecutedLines, .{ .name = "ByteRangeMapping__findExecutedLines" });
        @export(&ByteRangeMapping.find, .{ .name = "ByteRangeMapping__find" });
        @export(&ByteRangeMapping.getSourceID, .{ .name = "ByteRangeMapping__getSourceID" });
    }
}

pub const Fraction = struct {
    functions: f64 = 0.9,
    lines: f64 = 0.9,

    // This metric is less accurate right now
    stmts: f64 = 0.75,

    failing: bool = false,
};

pub const Block = struct {
    start_line: u32 = 0,
    end_line: u32 = 0,
};

/// Result from computing coverage changes report
pub const ChangesResult = struct {
    /// Total changed lines that are executable
    total_changed_executable_lines: u32 = 0,
    /// Changed lines that were executed/covered
    covered_changed_lines: u32 = 0,
    /// List of uncovered changed line ranges per file
    uncovered_files: std.ArrayListUnmanaged(UncoveredFile) = .{},

    pub const UncoveredFile = struct {
        filename: []const u8,
        uncovered_ranges: std.ArrayListUnmanaged(LineRange),
        uncovered_functions: std.ArrayListUnmanaged(UncoveredFunction),
    };

    pub const LineRange = struct {
        start: u32,
        end: u32,
    };

    /// An uncovered function (entire function body is in changed lines and not executed)
    /// Line numbers are stored as 1-indexed Ordinals for unambiguous display
    pub const UncoveredFunction = struct {
        start_line: bun.Ordinal,
        end_line: bun.Ordinal,
    };

    pub fn coverageFraction(self: *const ChangesResult) f64 {
        if (self.total_changed_executable_lines == 0) return 1.0;
        return @as(f64, @floatFromInt(self.covered_changed_lines)) / @as(f64, @floatFromInt(self.total_changed_executable_lines));
    }

    pub fn deinit(self: *ChangesResult, allocator: std.mem.Allocator) void {
        for (self.uncovered_files.items) |*file| {
            file.uncovered_ranges.deinit(allocator);
            file.uncovered_functions.deinit(allocator);
        }
        self.uncovered_files.deinit(allocator);
    }
};

pub const ChangesReport = struct {
    /// Compute coverage for changed lines only
    /// Returns statistics about coverage for lines that were changed in the diff
    pub fn computeForReport(
        report: *const Report,
        changed_file: *const GitDiff.ChangedFile,
        allocator: std.mem.Allocator,
    ) !struct {
        total_changed_executable: u32,
        covered_changed: u32,
        uncovered_ranges: std.ArrayListUnmanaged(ChangesResult.LineRange),
        uncovered_functions: std.ArrayListUnmanaged(ChangesResult.UncoveredFunction),
    } {
        var total_changed_executable: u32 = 0;
        var covered_changed: u32 = 0;
        var uncovered_ranges = std.ArrayListUnmanaged(ChangesResult.LineRange){};
        errdefer uncovered_ranges.deinit(allocator);
        var uncovered_functions = std.ArrayListUnmanaged(ChangesResult.UncoveredFunction){};
        errdefer uncovered_functions.deinit(allocator);

        // Iterate through executable lines and check if they're changed
        var iter = report.executable_lines.iterator(.{});
        var range_start: ?u32 = null;
        var range_end: u32 = 0;

        while (iter.next()) |line_idx| {
            const line: u32 = @intCast(line_idx + 1); // Convert to 1-indexed

            // Check if this line is in the changed set
            if (!changed_file.isLineChanged(line)) continue;

            total_changed_executable += 1;

            const is_covered = report.lines_which_have_executed.isSet(line_idx);

            if (is_covered) {
                covered_changed += 1;
                // Close any open uncovered range
                if (range_start) |start| {
                    try uncovered_ranges.append(allocator, .{ .start = start, .end = range_end });
                    range_start = null;
                }
            } else {
                // Uncovered line - start or extend range
                if (range_start == null) {
                    range_start = line;
                }
                range_end = line;
            }
        }

        // Close final uncovered range
        if (range_start) |start| {
            try uncovered_ranges.append(allocator, .{ .start = start, .end = range_end });
        }

        // Find uncovered functions that are entirely within changed lines
        // Note: func.start_line and func.end_line from coverage report are 0-indexed
        // isLineChanged expects 1-indexed line numbers
        for (report.functions.items, 0..) |func, func_idx| {
            // Check if this function was NOT executed
            if (report.functions_which_have_executed.isSet(func_idx)) continue;

            // Convert from 0-indexed to 1-indexed using Ordinal for clarity
            const start_ordinal = bun.Ordinal.fromZeroBased(@intCast(func.start_line));
            const end_ordinal = bun.Ordinal.fromZeroBased(@intCast(func.end_line));

            // Check if the function's lines are all in changed lines
            var all_lines_changed = true;
            var line: u32 = @intCast(start_ordinal.oneBased());
            while (line <= end_ordinal.oneBased()) : (line += 1) {
                if (!changed_file.isLineChanged(line)) {
                    all_lines_changed = false;
                    break;
                }
            }

            if (all_lines_changed and start_ordinal.isValid()) {
                try uncovered_functions.append(allocator, .{
                    // Store as Ordinals (already converted from 0-indexed)
                    .start_line = start_ordinal,
                    .end_line = end_ordinal,
                });
            }
        }

        return .{
            .total_changed_executable = total_changed_executable,
            .covered_changed = covered_changed,
            .uncovered_ranges = uncovered_ranges,
            .uncovered_functions = uncovered_functions,
        };
    }

    pub fn writeHeader(
        writer: *std.Io.Writer,
        max_filename_length: usize,
        comptime enable_colors: bool,
    ) !void {
        try writer.writeAll(prettyFmt("<r>\n<b>Coverage for Changed Lines:<r>\n", enable_colors));
        try writer.writeAll(prettyFmt("<d>", enable_colors));
        try writer.splatByteAll('-', max_filename_length + 2);
        try writer.writeAll(prettyFmt("|---------|-------------------<r>\n", enable_colors));
        try writer.writeAll("File");
        try writer.splatByteAll(' ', max_filename_length - "File".len + 1);
        try writer.writeAll(prettyFmt(" <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_colors));
        try writer.writeAll(prettyFmt("<d>", enable_colors));
        try writer.splatByteAll('-', max_filename_length + 2);
        try writer.writeAll(prettyFmt("|---------|-------------------<r>\n", enable_colors));
    }

    pub fn writeFileRow(
        filename: []const u8,
        max_filename_length: usize,
        coverage_pct: f64,
        threshold: f64,
        uncovered_ranges: []const ChangesResult.LineRange,
        writer: *std.Io.Writer,
        comptime enable_colors: bool,
    ) !void {
        const failed = coverage_pct < threshold;

        if (comptime enable_colors) {
            if (failed) {
                try writer.writeAll(prettyFmt("<r><b><red>", true));
            } else {
                try writer.writeAll(prettyFmt("<r><b><green>", true));
            }
        }

        try writer.writeAll(" ");
        try writer.writeAll(filename);
        try writer.splatByteAll(' ', max_filename_length - filename.len);
        try writer.writeAll(prettyFmt("<r><d> | <r>", enable_colors));

        if (comptime enable_colors) {
            if (failed) {
                try writer.writeAll(prettyFmt("<b><red>", true));
            } else {
                try writer.writeAll(prettyFmt("<b><green>", true));
            }
        }

        try writer.print("{d: >7.2}", .{coverage_pct * 100.0});
        try writer.writeAll(prettyFmt("<r><d> | <r>", enable_colors));

        // Write uncovered line ranges
        var is_first = true;
        for (uncovered_ranges) |range| {
            if (!is_first) {
                try writer.writeAll(prettyFmt("<r><d>,<r>", enable_colors));
            }
            is_first = false;

            if (range.start == range.end) {
                try writer.print(prettyFmt("<red>{d}", enable_colors), .{range.start});
            } else {
                try writer.print(prettyFmt("<red>{d}-{d}", enable_colors), .{ range.start, range.end });
            }
        }

        try writer.writeAll("\n");
    }

    pub fn writeSummary(
        writer: *std.Io.Writer,
        max_filename_length: usize,
        total_pct: f64,
        threshold: f64,
        comptime enable_colors: bool,
    ) !void {
        const failed = total_pct < threshold;

        try writer.writeAll(prettyFmt("<d>", enable_colors));
        try writer.splatByteAll('-', max_filename_length + 2);
        try writer.writeAll(prettyFmt("|---------|-------------------<r>\n", enable_colors));

        if (comptime enable_colors) {
            if (failed) {
                try writer.writeAll(prettyFmt("<r><b><red>", true));
            } else {
                try writer.writeAll(prettyFmt("<r><b><green>", true));
            }
        }

        try writer.writeAll("All changed");
        try writer.splatByteAll(' ', max_filename_length - "All changed".len + 1);
        try writer.writeAll(prettyFmt("<r><d> | <r>", enable_colors));

        if (comptime enable_colors) {
            if (failed) {
                try writer.writeAll(prettyFmt("<b><red>", true));
            } else {
                try writer.writeAll(prettyFmt("<b><green>", true));
            }
        }

        try writer.print("{d: >7.2}", .{total_pct * 100.0});
        try writer.writeAll(prettyFmt("<r><d> |<r>\n", enable_colors));

        try writer.writeAll(prettyFmt("<d>", enable_colors));
        try writer.splatByteAll('-', max_filename_length + 2);
        try writer.writeAll(prettyFmt("|---------|-------------------<r>\n", enable_colors));

        if (failed) {
            try writer.print(prettyFmt("\n<red><b>Coverage for changed lines ({d:.2}%) is below threshold ({d:.2}%)<r>\n", enable_colors), .{ total_pct * 100.0, threshold * 100.0 });
        }
    }
};

const GitDiff = @import("./GitDiff.zig");
const std = @import("std");

const bun = @import("bun");
const Bitset = bun.bit_set.DynamicBitSetUnmanaged;
const LineOffsetTable = bun.SourceMap.LineOffsetTable;

const Output = bun.Output;
const prettyFmt = Output.prettyFmt;
