//! Per-worker JUnit XML and LCOV coverage fragment merging. Workers write
//! their own fragments to a shared temp dir; the coordinator stitches them
//! into a single document/report after `drive()` completes.

fn attrValue(head: []const u8, comptime name: []const u8) u32 {
    const needle = " " ++ name ++ "=\"";
    const start = (bun.strings.indexOf(head, needle) orelse return 0) + needle.len;
    const end = start + (bun.strings.indexOfChar(head[start..], '"') orelse return 0);
    return std.fmt.parseInt(u32, head[start..end], 10) catch 0;
}

pub fn mergeJUnitFragments(coord: *Coordinator, outfile: []const u8, summary: *const TestRunner.Summary) void {
    var body: std.ArrayListUnmanaged(u8) = .empty;
    defer body.deinit(bun.default_allocator);
    // Crashed workers never reach workerFlushAggregates, so any files they ran
    // (including earlier passing ones) have no fragment. Compute the outer
    // <testsuites> totals from what we actually emit so they always equal the
    // sum of inner <testsuite> elements; CI tools schema-validate this.
    var totals: struct { tests: u32 = 0, failures: u32 = 0, skipped: u32 = 0 } = .{};

    for (coord.junit_fragments.items) |path| {
        const file = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, bun.default_allocator)) {
            .result => |r| r,
            .err => continue,
        };
        defer bun.default_allocator.free(file);
        // Each fragment is a full <testsuites> document; extract its header
        // attributes for the merged totals and its body for the inner suites.
        const open_start = bun.strings.indexOf(file, "<testsuites") orelse continue;
        const head_end = open_start + (bun.strings.indexOfChar(file[open_start..], '>') orelse continue);
        const head = file[open_start..head_end];
        totals.tests += attrValue(head, "tests");
        totals.failures += attrValue(head, "failures");
        totals.skipped += attrValue(head, "skipped");
        const body_start = head_end + 1;
        const body_end = bun.strings.lastIndexOf(file, "</testsuites>") orelse continue;
        if (body_start >= body_end) continue;
        const inner = std.mem.trim(u8, file[body_start..body_end], "\n");
        if (inner.len == 0) continue;
        bun.handleOom(body.appendSlice(bun.default_allocator, inner));
        bun.handleOom(body.append(bun.default_allocator, '\n'));
    }

    for (coord.crashed_files.items) |idx| {
        const rel = coord.relPath(idx);
        const w = body.writer(bun.default_allocator);
        bun.handleOom(w.writeAll("  <testsuite name=\""));
        bun.handleOom(test_command.escapeXml(rel, w));
        bun.handleOom(w.writeAll("\" tests=\"1\" assertions=\"0\" failures=\"1\" skipped=\"0\" time=\"0\">\n    <testcase name=\"(worker crashed)\" classname=\""));
        bun.handleOom(test_command.escapeXml(rel, w));
        bun.handleOom(w.writeAll(
            \\">
            \\      <failure message="worker process crashed before reporting results"></failure>
            \\    </testcase>
            \\  </testsuite>
            \\
        ));
        totals.tests += 1;
        totals.failures += 1;
    }

    var contents: std.ArrayListUnmanaged(u8) = .empty;
    defer contents.deinit(bun.default_allocator);
    const elapsed_time = @as(f64, @floatFromInt(std.time.nanoTimestamp() - bun.start_time)) / std.time.ns_per_s;
    bun.handleOom(contents.writer(bun.default_allocator).print(
        \\<?xml version="1.0" encoding="UTF-8"?>
        \\<testsuites name="bun test" tests="{d}" assertions="{d}" failures="{d}" skipped="{d}" time="{d}">
        \\
    , .{ totals.tests, summary.expectations, totals.failures, totals.skipped, elapsed_time }));
    bun.handleOom(contents.appendSlice(bun.default_allocator, body.items));
    bun.handleOom(contents.appendSlice(bun.default_allocator, "</testsuites>\n"));

    const out_z = bun.handleOom(bun.default_allocator.dupeZ(u8, outfile));
    defer bun.default_allocator.free(out_z);
    switch (bun.sys.File.openat(.cwd(), out_z, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
        .err => |err| Output.err(error.JUnitReportFailed, "Failed to write JUnit report to {s}\n{f}", .{ outfile, err }),
        .result => |fd| {
            defer _ = fd.close();
            switch (bun.sys.File.writeAll(fd, contents.items)) {
                .err => |err| Output.err(error.JUnitReportFailed, "Failed to write JUnit report to {s}\n{f}", .{ outfile, err }),
                .result => {},
            }
        },
    }
}

const FileCoverage = struct {
    path: []const u8,
    fnf: u32 = 0,
    fnh: u32 = 0,
    /// 1-based line number → summed hit count.
    da: std.AutoArrayHashMapUnmanaged(u32, u32) = .empty,

    fn lh(self: *const FileCoverage) u32 {
        var n: u32 = 0;
        for (self.da.values()) |c| n += @intFromBool(c > 0);
        return n;
    }
};

/// Merge per-worker LCOV fragments into a single report. Line-level (DA) merge
/// is precise. FNF/FNH take the per-worker max since Bun's LCOV writer doesn't
/// emit per-function FN/FNDA records yet, so disjoint per-worker function hits
/// can't be unioned; this under-reports % Funcs when workers cover different
/// functions of the same file. The non-parallel path has the same FN/FNDA gap.
pub fn mergeCoverageFragments(paths: []const []const u8, opts: *TestCommand.CodeCoverageOptions, comptime enable_colors: bool) void {
    var arena_state = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    var by_file: bun.StringArrayHashMapUnmanaged(FileCoverage) = .empty;

    for (paths) |path| {
        const data = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, arena)) {
            .result => |r| r,
            .err => continue,
        };
        var cur: ?*FileCoverage = null;
        var lines = std.mem.splitScalar(u8, data, '\n');
        while (lines.next()) |raw| {
            const line = std.mem.trimEnd(u8, raw, "\r");
            if (bun.strings.hasPrefixComptime(line, "SF:")) {
                const name = line[3..];
                const gop = bun.handleOom(by_file.getOrPut(arena, name));
                if (!gop.found_existing) {
                    gop.key_ptr.* = bun.handleOom(arena.dupe(u8, name));
                    gop.value_ptr.* = .{ .path = gop.key_ptr.* };
                }
                cur = gop.value_ptr;
            } else if (bun.strings.eqlComptime(line, "end_of_record")) {
                cur = null;
            } else if (cur) |fc| {
                if (bun.strings.hasPrefixComptime(line, "DA:")) {
                    var parts = std.mem.splitScalar(u8, line[3..], ',');
                    const ln = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const cnt = std.fmt.parseInt(u32, parts.next() orelse continue, 10) catch continue;
                    const gop = bun.handleOom(fc.da.getOrPut(arena, ln));
                    gop.value_ptr.* = if (gop.found_existing) gop.value_ptr.* +| cnt else cnt;
                } else if (bun.strings.hasPrefixComptime(line, "FNF:")) {
                    fc.fnf = @max(fc.fnf, std.fmt.parseInt(u32, line[4..], 10) catch 0);
                } else if (bun.strings.hasPrefixComptime(line, "FNH:")) {
                    fc.fnh = @max(fc.fnh, std.fmt.parseInt(u32, line[4..], 10) catch 0);
                }
            }
        }
    }

    if (by_file.count() == 0) return;

    // Stable output order.
    const Ctx = struct {
        keys: []const []const u8,
        pub fn lessThan(ctx: @This(), a: usize, b: usize) bool {
            return std.mem.lessThan(u8, ctx.keys[a], ctx.keys[b]);
        }
    };
    by_file.sort(Ctx{ .keys = by_file.keys() });

    if (opts.reporters.lcov) {
        var fs = bun.jsc.Node.fs.NodeFS{};
        _ = fs.mkdirRecursive(.{
            .path = .{ .encoded_slice = jsc.ZigString.Slice.fromUTF8NeverFree(opts.reports_directory) },
            .always_return_none = true,
        });
        var path_buf: bun.PathBuffer = undefined;
        const out_path = bun.path.joinAbsStringBufZ(bun.fs.FileSystem.instance.top_level_dir, &path_buf, &.{ opts.reports_directory, "lcov.info" }, .auto);
        switch (bun.sys.File.openat(.cwd(), out_path, bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC | bun.O.CLOEXEC, 0o644)) {
            .err => |e| Output.err(.lcovCoverageError, "Failed to write merged lcov.info\n{f}", .{e}),
            .result => |f| {
                defer f.close();
                const buf = bun.handleOom(arena.alloc(u8, 64 * 1024));
                var bw = f.writer().adaptToNewApi(buf);
                const w = &bw.new_interface;
                for (by_file.values()) |*fc| {
                    const sorted = bun.handleOom(arena.dupe(u32, fc.da.keys()));
                    std.sort.pdq(u32, sorted, {}, std.sort.asc(u32));
                    w.print("TN:\nSF:{s}\nFNF:{d}\nFNH:{d}\n", .{ fc.path, fc.fnf, fc.fnh }) catch {};
                    for (sorted) |ln| w.print("DA:{d},{d}\n", .{ ln, fc.da.get(ln).? }) catch {};
                    w.print("LF:{d}\nLH:{d}\nend_of_record\n", .{ fc.da.count(), fc.lh() }) catch {};
                }
                w.flush() catch {};
            },
        }
    }

    const base = opts.fractions;
    var failing = false;
    var avg = CoverageFraction{ .functions = 0, .lines = 0, .stmts = 0 };
    var avg_n: f64 = 0;
    const fracs = bun.handleOom(arena.alloc(CoverageFraction, by_file.count()));
    for (by_file.values(), fracs) |*fc, *frac| {
        const lf: f64 = @floatFromInt(fc.da.count());
        const lh_: f64 = @floatFromInt(fc.lh());
        frac.* = .{
            .functions = if (fc.fnf > 0) @as(f64, @floatFromInt(fc.fnh)) / @as(f64, @floatFromInt(fc.fnf)) else 1.0,
            .lines = if (lf > 0) lh_ / lf else 1.0,
            .stmts = if (lf > 0) lh_ / lf else 1.0,
        };
        frac.failing = frac.functions < base.functions or frac.lines < base.lines;
        if (frac.failing) failing = true;
        avg.functions += frac.functions;
        avg.lines += frac.lines;
        avg.stmts += frac.stmts;
        avg_n += 1;
    }
    opts.fractions.failing = failing;

    if (opts.reporters.text) {
        var max_len: usize = "All files".len;
        for (by_file.keys()) |k| max_len = @max(max_len, k.len);

        var console = Output.errorWriter();
        const sep = struct {
            fn write(c: anytype, n: usize, comptime colors: bool) void {
                c.writeAll(Output.prettyFmt("<r><d>", colors)) catch {};
                c.splatByteAll('-', n + 2) catch {};
                c.writeAll(Output.prettyFmt("|---------|---------|-------------------<r>\n", colors)) catch {};
            }
        }.write;
        sep(console, max_len, enable_colors);
        console.writeAll("File") catch {};
        console.splatByteAll(' ', max_len - "File".len + 1) catch {};
        console.writeAll(Output.prettyFmt(" <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_colors)) catch {};
        sep(console, max_len, enable_colors);

        var body = std.Io.Writer.Allocating.init(arena);
        for (by_file.values(), fracs) |*fc, frac| {
            CoverageReportText.writeFormatWithValues(fc.path, max_len, frac, base, frac.failing, &body.writer, true, enable_colors) catch {};
            body.writer.writeAll(Output.prettyFmt("<r><d> | <r>", enable_colors)) catch {};

            const sorted = bun.handleOom(arena.dupe(u32, fc.da.keys()));
            std.sort.pdq(u32, sorted, {}, std.sort.asc(u32));
            var first = true;
            var range_start: u32 = 0;
            var range_end: u32 = 0;
            for (sorted) |ln| {
                if (fc.da.get(ln).? != 0) continue;
                if (range_start == 0) {
                    range_start = ln;
                    range_end = ln;
                } else if (ln == range_end + 1) {
                    range_end = ln;
                } else {
                    writeRange(&body.writer, &first, range_start, range_end, enable_colors);
                    range_start = ln;
                    range_end = ln;
                }
            }
            if (range_start != 0) writeRange(&body.writer, &first, range_start, range_end, enable_colors);
            body.writer.writeAll("\n") catch {};
        }

        if (avg_n > 0) {
            avg.functions /= avg_n;
            avg.lines /= avg_n;
            avg.stmts /= avg_n;
        }
        body.writer.flush() catch {};
        console.writeAll(body.written()) catch {};
        CoverageReportText.writeFormatWithValues("All files", max_len, avg, base, failing, console, false, enable_colors) catch {};
        console.writeAll(Output.prettyFmt("<r><d> |<r>\n", enable_colors)) catch {};
        sep(console, max_len, enable_colors);

        Output.flush();
    }
}

fn writeRange(w: *std.Io.Writer, first: *bool, a: u32, b: u32, comptime colors: bool) void {
    if (first.*) first.* = false else w.writeAll(Output.prettyFmt("<r><d>,<r>", colors)) catch {};
    if (a == b) {
        w.print(Output.prettyFmt("<red>{d}", colors), .{a}) catch {};
    } else {
        w.print(Output.prettyFmt("<red>{d}-{d}", colors), .{ a, b }) catch {};
    }
}

const std = @import("std");
const Coordinator = @import("./Coordinator.zig").Coordinator;

const test_command = @import("../../test_command.zig");
const TestCommand = test_command.TestCommand;

const bun = @import("bun");
const Output = bun.Output;
const jsc = bun.jsc;
const CoverageFraction = bun.SourceMap.coverage.Fraction;
const TestRunner = jsc.Jest.TestRunner;
const CoverageReportText = bun.SourceMap.coverage.Report.Text;
