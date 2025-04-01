const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const OOM = bun.OOM;

const lex = bun.js_lexer;
const logger = bun.logger;

const FileSystem = @import("../fs.zig").FileSystem;
const PathName = @import("../fs.zig").PathName;
const options = @import("../options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;

const DotEnv = @import("../env_loader.zig");
const which = @import("../which.zig").which;
const Run = @import("../bun_js.zig").Run;
var path_buf: bun.PathBuffer = undefined;
var path_buf2: bun.PathBuffer = undefined;
const PathString = bun.PathString;
const HTTPThread = bun.http.HTTPThread;

const JSC = bun.JSC;
const jest = JSC.Jest;
const TestRunner = JSC.Jest.TestRunner;
const Snapshots = JSC.Snapshot.Snapshots;
const Test = TestRunner.Test;
const coverage = bun.sourcemap.coverage;
const CodeCoverageReport = coverage.Report;
const uws = bun.uws;

fn escapeXml(str: string, writer: anytype) !void {
    var last: usize = 0;
    var i: usize = 0;
    const len = str.len;
    while (i < len) : (i += 1) {
        const c = str[i];
        switch (c) {
            '&',
            '<',
            '>',
            '"',
            '\'',
            => {
                if (i > last) {
                    try writer.writeAll(str[last..i]);
                }
                const escaped = switch (c) {
                    '&' => "&amp;",
                    '<' => "&lt;",
                    '>' => "&gt;",
                    '"' => "&quot;",
                    '\'' => "&apos;",
                    else => unreachable,
                };
                try writer.writeAll(escaped);
                last = i + 1;
            },
            0...0x1f => {
                // Escape all control characters
                try writer.print("&#{d};", .{c});
            },
            else => {},
        }
    }
    if (len > last) {
        try writer.writeAll(str[last..]);
    }
}
fn fmtStatusTextLine(comptime status: @Type(.enum_literal), comptime emoji_or_color: bool) []const u8 {
    comptime {
        // emoji and color might be split into two different options in the future
        // some terminals support color, but not emoji.
        // For now, they are the same.
        return switch (emoji_or_color) {
            true => switch (status) {
                .pass => Output.prettyFmt("<r><green>✓<r>", emoji_or_color),
                .fail => Output.prettyFmt("<r><red>✗<r>", emoji_or_color),
                .skip => Output.prettyFmt("<r><yellow>»<d>", emoji_or_color),
                .todo => Output.prettyFmt("<r><magenta>✎<r>", emoji_or_color),
                else => @compileError("Invalid status " ++ @tagName(status)),
            },
            else => switch (status) {
                .pass => Output.prettyFmt("<r><green>(pass)<r>", emoji_or_color),
                .fail => Output.prettyFmt("<r><red>(fail)<r>", emoji_or_color),
                .skip => Output.prettyFmt("<r><yellow>(skip)<d>", emoji_or_color),
                .todo => Output.prettyFmt("<r><magenta>(todo)<r>", emoji_or_color),
                else => @compileError("Invalid status " ++ @tagName(status)),
            },
        };
    }
}

fn writeTestStatusLine(comptime status: @Type(.enum_literal), writer: anytype) void {
    if (Output.enable_ansi_colors_stderr)
        writer.print(fmtStatusTextLine(status, true), .{}) catch unreachable
    else
        writer.print(fmtStatusTextLine(status, false), .{}) catch unreachable;
}

// Remaining TODOs:
// - Add stdout/stderr to the JUnit report
// - Add timestamp field to the JUnit report
pub const JunitReporter = struct {
    contents: std.ArrayListUnmanaged(u8) = .{},
    total_metrics: Metrics = .{},
    testcases_metrics: Metrics = .{},
    offset_of_testsuites_value: usize = 0,
    offset_of_testsuite_value: usize = 0,
    current_file: string = "",
    properties_list_to_repeat_in_every_test_suite: ?[]const u8 = null,

    hostname_value: ?string = null,

    pub fn getHostname(this: *JunitReporter) ?string {
        if (this.hostname_value == null) {
            if (Environment.isWindows) {
                return null;
            }

            var name_buffer: [bun.HOST_NAME_MAX]u8 = undefined;
            const hostname = std.posix.gethostname(&name_buffer) catch {
                this.hostname_value = "";
                return null;
            };

            var arraylist_writer = std.ArrayList(u8).init(bun.default_allocator);
            escapeXml(hostname, arraylist_writer.writer()) catch {
                this.hostname_value = "";
                return null;
            };
            this.hostname_value = arraylist_writer.items;
        }

        if (this.hostname_value) |hostname| {
            if (hostname.len > 0) {
                return hostname;
            }
        }
        return null;
    }

    const Metrics = struct {
        test_cases: u32 = 0,
        assertions: u32 = 0,
        failures: u32 = 0,
        skipped: u32 = 0,
        elapsed_time: u64 = 0,

        pub fn add(this: *Metrics, other: *const Metrics) void {
            this.test_cases += other.test_cases;
            this.assertions += other.assertions;
            this.failures += other.failures;
            this.skipped += other.skipped;
        }
    };
    pub fn init() *JunitReporter {
        return JunitReporter.new(
            .{ .contents = .{}, .total_metrics = .{} },
        );
    }

    pub usingnamespace bun.New(JunitReporter);

    fn generatePropertiesList(this: *JunitReporter) !void {
        const PropertiesList = struct {
            ci: string,
            commit: string,
        };
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack = std.heap.stackFallback(1024, arena.allocator());
        const allocator = stack.get();

        const properties: PropertiesList = .{
            .ci = brk: {
                if (bun.getenvZ("GITHUB_RUN_ID")) |github_run_id| {
                    if (bun.getenvZ("GITHUB_SERVER_URL")) |github_server_url| {
                        if (bun.getenvZ("GITHUB_REPOSITORY")) |github_repository| {
                            if (github_run_id.len > 0 and github_server_url.len > 0 and github_repository.len > 0) {
                                break :brk try std.fmt.allocPrint(allocator, "{s}/{s}/actions/runs/{s}", .{ github_server_url, github_repository, github_run_id });
                            }
                        }
                    }
                }

                if (bun.getenvZ("CI_JOB_URL")) |ci_job_url| {
                    if (ci_job_url.len > 0) {
                        break :brk ci_job_url;
                    }
                }

                break :brk "";
            },
            .commit = brk: {
                if (bun.getenvZ("GITHUB_SHA")) |github_sha| {
                    if (github_sha.len > 0) {
                        break :brk github_sha;
                    }
                }

                if (bun.getenvZ("CI_COMMIT_SHA")) |sha| {
                    if (sha.len > 0) {
                        break :brk sha;
                    }
                }

                if (bun.getenvZ("GIT_SHA")) |git_sha| {
                    if (git_sha.len > 0) {
                        break :brk git_sha;
                    }
                }

                break :brk "";
            },
        };

        if (properties.ci.len == 0 and properties.commit.len == 0) {
            this.properties_list_to_repeat_in_every_test_suite = "";
            return;
        }

        var buffer = std.ArrayList(u8).init(bun.default_allocator);
        var writer = buffer.writer();

        try writer.writeAll(
            \\    <properties>
            \\
        );

        if (properties.ci.len > 0) {
            try writer.writeAll(
                \\      <property name="ci" value="
            );
            try escapeXml(properties.ci, writer);
            try writer.writeAll("\" />\n");
        }
        if (properties.commit.len > 0) {
            try writer.writeAll(
                \\      <property name="commit" value="
            );
            try escapeXml(properties.commit, writer);
            try writer.writeAll("\" />\n");
        }

        try writer.writeAll("    </properties>\n");

        this.properties_list_to_repeat_in_every_test_suite = buffer.items;
    }

    pub fn beginTestSuite(this: *JunitReporter, name: string) !void {
        if (this.contents.items.len == 0) {
            try this.contents.appendSlice(bun.default_allocator,
                \\<?xml version="1.0" encoding="UTF-8"?>
                \\
            );

            try this.contents.appendSlice(bun.default_allocator, "<testsuites name=\"bun test\" ");
            this.offset_of_testsuites_value = this.contents.items.len;
            try this.contents.appendSlice(bun.default_allocator, ">\n");
        }

        try this.contents.appendSlice(bun.default_allocator,
            \\  <testsuite name="
        );

        try escapeXml(name, this.contents.writer(bun.default_allocator));

        try this.contents.appendSlice(bun.default_allocator, "\" ");
        this.offset_of_testsuite_value = this.contents.items.len;
        try this.contents.appendSlice(bun.default_allocator, ">\n");

        if (this.properties_list_to_repeat_in_every_test_suite == null) {
            try this.generatePropertiesList();
        }

        if (this.properties_list_to_repeat_in_every_test_suite) |properties_list| {
            if (properties_list.len > 0) {
                try this.contents.appendSlice(bun.default_allocator, properties_list);
            }
        }

        this.current_file = name;
    }

    pub fn endTestSuite(this: *JunitReporter) !void {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack_fallback_allocator = std.heap.stackFallback(4096, arena.allocator());
        const allocator = stack_fallback_allocator.get();

        const metrics = &this.testcases_metrics;
        this.total_metrics.add(metrics);

        const elapsed_time_ms = metrics.elapsed_time;
        const elapsed_time_ms_f64: f64 = @floatFromInt(elapsed_time_ms);
        const elapsed_time_seconds = elapsed_time_ms_f64 / std.time.ms_per_s;

        // Insert the summary attributes
        const summary = try std.fmt.allocPrint(allocator,
            \\tests="{d}" assertions="{d}" failures="{d}" skipped="{d}" time="{d}" hostname="{s}"
        , .{
            metrics.test_cases,
            metrics.assertions,
            metrics.failures,
            metrics.skipped,
            elapsed_time_seconds,
            this.getHostname() orelse "",
        });
        this.testcases_metrics = .{};
        this.contents.insertSlice(bun.default_allocator, this.offset_of_testsuite_value, summary) catch bun.outOfMemory();

        try this.contents.appendSlice(bun.default_allocator, "  </testsuite>\n");
    }

    pub fn writeTestCase(
        this: *JunitReporter,
        status: TestRunner.Test.Status,
        file: string,
        name: string,
        class_name: string,
        assertions: u32,
        elapsed_ns: u64,
    ) !void {
        const elapsed_ns_f64: f64 = @floatFromInt(elapsed_ns);
        const elapsed_ms = elapsed_ns_f64 / std.time.ns_per_ms;
        this.testcases_metrics.elapsed_time +|= @as(u64, @intFromFloat(elapsed_ms));
        this.testcases_metrics.test_cases += 1;

        try this.contents.appendSlice(bun.default_allocator, "    <testcase");
        try this.contents.appendSlice(bun.default_allocator, " name=\"");
        try escapeXml(name, this.contents.writer(bun.default_allocator));
        try this.contents.appendSlice(bun.default_allocator, "\" classname=\"");
        try escapeXml(class_name, this.contents.writer(bun.default_allocator));
        try this.contents.appendSlice(bun.default_allocator, "\"");

        const elapsed_seconds = elapsed_ms / std.time.ms_per_s;
        var time_buf: [32]u8 = undefined;
        const time_str = try std.fmt.bufPrint(&time_buf, " time=\"{d}\"", .{elapsed_seconds});
        try this.contents.appendSlice(bun.default_allocator, time_str);

        try this.contents.appendSlice(bun.default_allocator, " file=\"");
        try escapeXml(file, this.contents.writer(bun.default_allocator));
        try this.contents.appendSlice(bun.default_allocator, "\"");

        try this.contents.writer(bun.default_allocator).print(" assertions=\"{d}\"", .{assertions});

        this.testcases_metrics.assertions += assertions;

        switch (status) {
            .pass => {
                try this.contents.appendSlice(bun.default_allocator, " />\n");
            },
            .fail => {
                this.testcases_metrics.failures += 1;
                try this.contents.appendSlice(bun.default_allocator, ">\n      <failure type=\"AssertionError\" />\n    </testcase>\n");
                // TODO: add the failure message
                // if (failure_message) |msg| {
                //     try this.contents.appendSlice(bun.default_allocator, " message=\"");
                //     try escapeXml(msg, this.contents.writer(bun.default_allocator));
                //     try this.contents.appendSlice(bun.default_allocator, "\"");
                // }
            },
            .fail_because_failing_test_passed => {
                this.testcases_metrics.failures += 1;
                try this.contents.writer(bun.default_allocator).print(
                    \\>
                    \\      <failure message="test marked with .failing() did not throw" type="AssertionError"/>
                    \\    </testcase>
                , .{});
            },
            .fail_because_expected_assertion_count => {
                this.testcases_metrics.failures += 1;
                // TODO: add the failure message
                try this.contents.writer(bun.default_allocator).print(
                    \\>
                    \\      <failure message="Expected more assertions, but only received {d}" type="AssertionError"/>
                    \\    </testcase>
                , .{assertions});
            },
            .fail_because_todo_passed => {
                this.testcases_metrics.failures += 1;
                // TODO: add the failure message
                try this.contents.writer(bun.default_allocator).print(
                    \\>
                    \\      <failure message="TODO passed" type="AssertionError"/>
                    \\    </testcase>
                , .{});
            },
            .fail_because_expected_has_assertions => {
                this.testcases_metrics.failures += 1;
                try this.contents.writer(bun.default_allocator).print(
                    \\>
                    \\      <failure message="Expected to have assertions, but none were run" type="AssertionError"/>
                    \\    </testcase>
                , .{});
            },
            .skip => {
                this.testcases_metrics.skipped += 1;
                try this.contents.appendSlice(bun.default_allocator, ">\n      <skipped />\n    </testcase>\n");
            },
            .todo => {
                this.testcases_metrics.skipped += 1;
                try this.contents.appendSlice(bun.default_allocator, ">\n      <skipped message=\"TODO\" />\n    </testcase>\n");
            },
            .pending => unreachable,
        }
    }

    pub fn writeToFile(this: *JunitReporter, path: string) !void {
        if (this.contents.items.len == 0) return;
        {
            var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
            defer arena.deinit();
            var stack_fallback_allocator = std.heap.stackFallback(4096, arena.allocator());
            const allocator = stack_fallback_allocator.get();
            const metrics = this.total_metrics;
            const elapsed_time = @as(f64, @floatFromInt(std.time.nanoTimestamp() - bun.start_time)) / std.time.ns_per_s;
            const summary = try std.fmt.allocPrint(allocator,
                \\tests="{d}" assertions="{d}" failures="{d}" skipped="{d}" time="{d}"
            , .{
                metrics.test_cases,
                metrics.assertions,
                metrics.failures,
                metrics.skipped,
                elapsed_time,
            });
            this.contents.insertSlice(bun.default_allocator, this.offset_of_testsuites_value, summary) catch bun.outOfMemory();
            this.contents.appendSlice(bun.default_allocator, "</testsuites>\n") catch bun.outOfMemory();
        }

        var junit_path_buf: bun.PathBuffer = undefined;

        @memcpy(junit_path_buf[0..path.len], path);
        junit_path_buf[path.len] = 0;

        switch (bun.sys.File.openat(std.fs.cwd(), junit_path_buf[0..path.len :0], bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
            .err => |err| {
                Output.err(error.JUnitReportFailed, "Failed to write JUnit report to {s}\n{}", .{ path, err });
            },
            .result => |fd| {
                defer _ = fd.close();
                switch (bun.sys.File.writeAll(fd, this.contents.items)) {
                    .result => {},
                    .err => |err| {
                        Output.err(error.JUnitReportFailed, "Failed to write JUnit report to {s}\n{}", .{ path, err });
                    },
                }
            },
        }
    }

    pub fn deinit(this: *JunitReporter) void {
        this.contents.deinit(bun.default_allocator);
    }
};

pub const CommandLineReporter = struct {
    jest: TestRunner,
    callback: TestRunner.Callback,
    last_dot: u32 = 0,
    summary: Summary = Summary{},
    prev_file: u64 = 0,
    repeat_count: u32 = 1,

    failures_to_repeat_buf: std.ArrayListUnmanaged(u8) = .{},
    skips_to_repeat_buf: std.ArrayListUnmanaged(u8) = .{},
    todos_to_repeat_buf: std.ArrayListUnmanaged(u8) = .{},

    file_reporter: ?FileReporter = null,

    pub const FileReporter = union(enum) {
        junit: *JunitReporter,
    };

    pub const Summary = struct {
        pass: u32 = 0,
        expectations: u32 = 0,
        skip: u32 = 0,
        todo: u32 = 0,
        fail: u32 = 0,
        files: u32 = 0,
    };

    const DotColorMap = std.EnumMap(TestRunner.Test.Status, string);
    const dots: DotColorMap = brk: {
        var map: DotColorMap = DotColorMap.init(.{});
        map.put(TestRunner.Test.Status.pending, Output.RESET ++ Output.ED ++ Output.color_map.get("yellow").? ++ "." ++ Output.RESET);
        map.put(TestRunner.Test.Status.pass, Output.RESET ++ Output.ED ++ Output.color_map.get("green").? ++ "." ++ Output.RESET);
        map.put(TestRunner.Test.Status.fail, Output.RESET ++ Output.ED ++ Output.color_map.get("red").? ++ "." ++ Output.RESET);
        break :brk map;
    };

    pub fn handleUpdateCount(_: *TestRunner.Callback, _: u32, _: u32) void {}

    pub fn handleTestStart(_: *TestRunner.Callback, _: Test.ID) void {}

    fn printTestLine(
        status: TestRunner.Test.Status,
        label: string,
        elapsed_ns: u64,
        parent: ?*jest.DescribeScope,
        assertions: u32,
        comptime skip: bool,
        writer: anytype,
        file: string,
        file_reporter: ?FileReporter,
    ) void {
        var scopes_stack = std.BoundedArray(*jest.DescribeScope, 64).init(0) catch unreachable;
        var parent_ = parent;

        while (parent_) |scope| {
            scopes_stack.append(scope) catch break;
            parent_ = scope.parent;
        }

        const scopes: []*jest.DescribeScope = scopes_stack.slice();

        const display_label = if (label.len > 0) label else "test";

        const color_code = comptime if (skip) "<d>" else "";

        if (Output.enable_ansi_colors_stderr) {
            for (scopes, 0..) |_, i| {
                const index = (scopes.len - 1) - i;
                const scope = scopes[index];
                if (scope.label.len == 0) continue;
                writer.writeAll(" ") catch unreachable;

                writer.print(comptime Output.prettyFmt("<r>" ++ color_code, true), .{}) catch unreachable;
                writer.writeAll(scope.label) catch unreachable;
                writer.print(comptime Output.prettyFmt("<d>", true), .{}) catch unreachable;
                writer.writeAll(" >") catch unreachable;
            }
        } else {
            for (scopes, 0..) |_, i| {
                const index = (scopes.len - 1) - i;
                const scope = scopes[index];
                if (scope.label.len == 0) continue;
                writer.writeAll(" ") catch unreachable;
                writer.writeAll(scope.label) catch unreachable;
                writer.writeAll(" >") catch unreachable;
            }
        }

        const line_color_code = if (comptime skip) "<r><d>" else "<r><b>";

        if (Output.enable_ansi_colors_stderr)
            writer.print(comptime Output.prettyFmt(line_color_code ++ " {s}<r>", true), .{display_label}) catch unreachable
        else
            writer.print(comptime Output.prettyFmt(" {s}", false), .{display_label}) catch unreachable;

        if (elapsed_ns > (std.time.ns_per_us * 10)) {
            writer.print(" {any}", .{
                Output.ElapsedFormatter{
                    .colors = Output.enable_ansi_colors_stderr,
                    .duration_ns = elapsed_ns,
                },
            }) catch unreachable;
        }

        writer.writeAll("\n") catch unreachable;

        if (file_reporter) |reporter| {
            switch (reporter) {
                .junit => |junit| {
                    const filename = brk: {
                        if (strings.hasPrefix(file, bun.fs.FileSystem.instance.top_level_dir)) {
                            break :brk strings.withoutLeadingPathSeparator(file[bun.fs.FileSystem.instance.top_level_dir.len..]);
                        } else {
                            break :brk file;
                        }
                    };
                    if (!strings.eql(junit.current_file, filename)) {
                        if (junit.current_file.len > 0) {
                            junit.endTestSuite() catch bun.outOfMemory();
                        }

                        junit.beginTestSuite(filename) catch bun.outOfMemory();
                    }

                    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
                    defer arena.deinit();
                    var stack_fallback = std.heap.stackFallback(4096, arena.allocator());
                    const allocator = stack_fallback.get();
                    var concatenated_describe_scopes = std.ArrayList(u8).init(allocator);

                    {
                        const initial_length = concatenated_describe_scopes.items.len;
                        for (scopes) |scope| {
                            if (scope.label.len > 0) {
                                if (initial_length != concatenated_describe_scopes.items.len) {
                                    concatenated_describe_scopes.appendSlice(" &gt; ") catch bun.outOfMemory();
                                }

                                escapeXml(scope.label, concatenated_describe_scopes.writer()) catch bun.outOfMemory();
                            }
                        }
                    }

                    junit.writeTestCase(status, filename, display_label, concatenated_describe_scopes.items, assertions, elapsed_ns) catch bun.outOfMemory();
                },
            }
        }
    }

    pub fn handleTestPass(cb: *TestRunner.Callback, id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*jest.DescribeScope) void {
        const writer_ = Output.errorWriter();
        var buffered_writer = std.io.bufferedWriter(writer_);
        var writer = buffered_writer.writer();
        defer buffered_writer.flush() catch unreachable;

        var this: *CommandLineReporter = @fieldParentPtr("callback", cb);

        writeTestStatusLine(.pass, &writer);

        printTestLine(.pass, label, elapsed_ns, parent, expectations, false, writer, file, this.file_reporter);

        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.pass;
        this.summary.pass += 1;
        this.summary.expectations += expectations;
    }

    pub fn handleTestFail(cb: *TestRunner.Callback, id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*jest.DescribeScope) void {
        var writer_ = Output.errorWriter();
        var this: *CommandLineReporter = @fieldParentPtr("callback", cb);

        // when the tests fail, we want to repeat the failures at the end
        // so that you can see them better when there are lots of tests that ran
        const initial_length = this.failures_to_repeat_buf.items.len;
        var writer = this.failures_to_repeat_buf.writer(bun.default_allocator);

        writeTestStatusLine(.fail, &writer);
        printTestLine(.fail, label, elapsed_ns, parent, expectations, false, writer, file, this.file_reporter);

        // We must always reset the colors because (skip) will have set them to <d>
        if (Output.enable_ansi_colors_stderr) {
            writer.writeAll(Output.prettyFmt("<r>", true)) catch unreachable;
        }

        writer_.writeAll(this.failures_to_repeat_buf.items[initial_length..]) catch unreachable;

        Output.flush();

        // this.updateDots();
        this.summary.fail += 1;
        this.summary.expectations += expectations;
        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.fail;

        if (this.jest.bail == this.summary.fail) {
            this.printSummary();
            Output.prettyError("\nBailed out after {d} failure{s}<r>\n", .{ this.jest.bail, if (this.jest.bail == 1) "" else "s" });
            Global.exit(1);
        }
    }

    pub fn handleTestSkip(cb: *TestRunner.Callback, id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*jest.DescribeScope) void {
        var writer_ = Output.errorWriter();
        var this: *CommandLineReporter = @fieldParentPtr("callback", cb);

        // If you do it.only, don't report the skipped tests because its pretty noisy
        if (jest.Jest.runner != null and !jest.Jest.runner.?.only) {
            // when the tests skip, we want to repeat the failures at the end
            // so that you can see them better when there are lots of tests that ran
            const initial_length = this.skips_to_repeat_buf.items.len;
            var writer = this.skips_to_repeat_buf.writer(bun.default_allocator);

            writeTestStatusLine(.skip, &writer);
            printTestLine(.skip, label, elapsed_ns, parent, expectations, true, writer, file, this.file_reporter);

            writer_.writeAll(this.skips_to_repeat_buf.items[initial_length..]) catch unreachable;
            Output.flush();
        }

        // this.updateDots();
        this.summary.skip += 1;
        this.summary.expectations += expectations;
        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.skip;
    }

    pub fn handleTestTodo(cb: *TestRunner.Callback, id: Test.ID, file: string, label: string, expectations: u32, elapsed_ns: u64, parent: ?*jest.DescribeScope) void {
        var writer_ = Output.errorWriter();

        var this: *CommandLineReporter = @fieldParentPtr("callback", cb);

        // when the tests skip, we want to repeat the failures at the end
        // so that you can see them better when there are lots of tests that ran
        const initial_length = this.todos_to_repeat_buf.items.len;
        var writer = this.todos_to_repeat_buf.writer(bun.default_allocator);

        writeTestStatusLine(.todo, &writer);
        printTestLine(.todo, label, elapsed_ns, parent, expectations, true, writer, file, this.file_reporter);

        writer_.writeAll(this.todos_to_repeat_buf.items[initial_length..]) catch unreachable;
        Output.flush();

        // this.updateDots();
        this.summary.todo += 1;
        this.summary.expectations += expectations;
        this.jest.tests.items(.status)[id] = TestRunner.Test.Status.todo;
    }

    pub fn printSummary(this: *CommandLineReporter) void {
        const tests = this.summary.fail + this.summary.pass + this.summary.skip + this.summary.todo;
        const files = this.summary.files;

        Output.prettyError("Ran {d} tests across {d} files. ", .{ tests, files });
        Output.printStartEnd(bun.start_time, std.time.nanoTimestamp());
    }

    pub fn generateCodeCoverage(this: *CommandLineReporter, vm: *JSC.VirtualMachine, opts: *TestCommand.CodeCoverageOptions, comptime reporters: TestCommand.Reporters, comptime enable_ansi_colors: bool) !void {
        if (comptime !reporters.text and !reporters.lcov) {
            return;
        }

        var map = coverage.ByteRangeMapping.map orelse return;
        var iter = map.valueIterator();
        var byte_ranges = try std.ArrayList(bun.sourcemap.coverage.ByteRangeMapping).initCapacity(bun.default_allocator, map.count());

        while (iter.next()) |entry| {
            byte_ranges.appendAssumeCapacity(entry.*);
        }

        if (byte_ranges.items.len == 0) {
            return;
        }

        std.sort.pdq(
            bun.sourcemap.coverage.ByteRangeMapping,
            byte_ranges.items,
            {},
            bun.sourcemap.coverage.ByteRangeMapping.isLessThan,
        );

        try this.printCodeCoverage(vm, opts, byte_ranges.items, reporters, enable_ansi_colors);
    }

    pub fn printCodeCoverage(
        _: *CommandLineReporter,
        vm: *JSC.VirtualMachine,
        opts: *TestCommand.CodeCoverageOptions,
        byte_ranges: []bun.sourcemap.coverage.ByteRangeMapping,
        comptime reporters: TestCommand.Reporters,
        comptime enable_ansi_colors: bool,
    ) !void {
        const trace = if (reporters.text and reporters.lcov)
            bun.perf.trace("TestCommand.printCodeCoverageLCovAndText")
        else if (reporters.text)
            bun.perf.trace("TestCommand.printCodeCoverageText")
        else if (reporters.lcov)
            bun.perf.trace("TestCommand.printCodeCoverageLCov")
        else
            @compileError("No reporters enabled");

        defer trace.end();

        if (comptime !reporters.text and !reporters.lcov) {
            @compileError("No reporters enabled");
        }

        const relative_dir = vm.transpiler.fs.top_level_dir;

        // --- Text ---
        const max_filepath_length: usize = if (reporters.text) brk: {
            var len = "All files".len;
            for (byte_ranges) |*entry| {
                const utf8 = entry.source_url.slice();
                len = @max(bun.path.relative(relative_dir, utf8).len, len);
            }

            break :brk len;
        } else 0;

        var console = Output.errorWriter();
        const base_fraction = opts.fractions;
        var failing = false;

        if (comptime reporters.text) {
            console.writeAll(Output.prettyFmt("<r><d>", enable_ansi_colors)) catch return;
            console.writeByteNTimes('-', max_filepath_length + 2) catch return;
            console.writeAll(Output.prettyFmt("|---------|---------|-------------------<r>\n", enable_ansi_colors)) catch return;
            console.writeAll("File") catch return;
            console.writeByteNTimes(' ', max_filepath_length - "File".len + 1) catch return;
            // writer.writeAll(Output.prettyFmt(" <d>|<r> % Funcs <d>|<r> % Blocks <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_ansi_colors)) catch return;
            console.writeAll(Output.prettyFmt(" <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> Uncovered Line #s\n", enable_ansi_colors)) catch return;
            console.writeAll(Output.prettyFmt("<d>", enable_ansi_colors)) catch return;
            console.writeByteNTimes('-', max_filepath_length + 2) catch return;
            console.writeAll(Output.prettyFmt("|---------|---------|-------------------<r>\n", enable_ansi_colors)) catch return;
        }

        var console_buffer = bun.MutableString.initEmpty(bun.default_allocator);
        var console_buffer_buffer = console_buffer.bufferedWriter();
        var console_writer = console_buffer_buffer.writer();

        var avg = bun.sourcemap.coverage.Fraction{
            .functions = 0.0,
            .lines = 0.0,
            .stmts = 0.0,
        };
        var avg_count: f64 = 0;
        // --- Text ---

        // --- LCOV ---
        var lcov_name_buf: bun.PathBuffer = undefined;
        const lcov_file, const lcov_name, const lcov_buffered_writer, const lcov_writer = brk: {
            if (comptime !reporters.lcov) break :brk .{ {}, {}, {}, {} };

            // Ensure the directory exists
            var fs = bun.JSC.Node.NodeFS{};
            _ = fs.mkdirRecursive(
                .{
                    .path = bun.JSC.Node.PathLike{
                        .encoded_slice = JSC.ZigString.Slice.fromUTF8NeverFree(opts.reports_directory),
                    },
                    .always_return_none = true,
                },
            );

            // Write the lcov.info file to a temporary file we atomically rename to the final name after it succeeds
            var base64_bytes: [8]u8 = undefined;
            var shortname_buf: [512]u8 = undefined;
            bun.csprng(&base64_bytes);
            const tmpname = std.fmt.bufPrintZ(&shortname_buf, ".lcov.info.{s}.tmp", .{std.fmt.fmtSliceHexLower(&base64_bytes)}) catch unreachable;
            const path = bun.path.joinAbsStringBufZ(relative_dir, &lcov_name_buf, &.{ opts.reports_directory, tmpname }, .auto);
            const file = bun.sys.File.openat(
                std.fs.cwd(),
                path,
                bun.O.CREAT | bun.O.WRONLY | bun.O.TRUNC | bun.O.CLOEXEC,
                0o644,
            );

            switch (file) {
                .err => |err| {
                    Output.err(.lcovCoverageError, "Failed to create lcov file", .{});
                    Output.printError("\n{s}", .{err});
                    Global.exit(1);
                },
                .result => |f| {
                    const buffered = buffered_writer: {
                        const writer = f.writer();
                        // Heap-allocate the buffered writer because we want a stable memory address + 64 KB is kind of a lot.
                        const ptr = try bun.default_allocator.create(std.io.BufferedWriter(64 * 1024, bun.sys.File.Writer));
                        ptr.* = .{
                            .end = 0,
                            .unbuffered_writer = writer,
                        };
                        break :buffered_writer ptr;
                    };

                    break :brk .{
                        f,
                        path,
                        buffered,
                        buffered.writer(),
                    };
                },
            }
        };
        errdefer {
            if (comptime reporters.lcov) {
                lcov_file.close();
                _ = bun.sys.unlink(
                    lcov_name,
                );
            }
        }
        // --- LCOV ---

        for (byte_ranges) |*entry| {
            var report = CodeCoverageReport.generate(vm.global, bun.default_allocator, entry, opts.ignore_sourcemap) orelse continue;
            defer report.deinit(bun.default_allocator);

            if (comptime reporters.text) {
                var fraction = base_fraction;
                CodeCoverageReport.Text.writeFormat(&report, max_filepath_length, &fraction, relative_dir, console_writer, enable_ansi_colors) catch continue;
                avg.functions += fraction.functions;
                avg.lines += fraction.lines;
                avg.stmts += fraction.stmts;
                avg_count += 1.0;
                if (fraction.failing) {
                    failing = true;
                }

                console_writer.writeAll("\n") catch continue;
            }

            if (comptime reporters.lcov) {
                CodeCoverageReport.Lcov.writeFormat(
                    &report,
                    relative_dir,
                    lcov_writer,
                ) catch continue;
            }
        }

        if (comptime reporters.text) {
            {
                avg.functions /= avg_count;
                avg.lines /= avg_count;
                avg.stmts /= avg_count;

                try CodeCoverageReport.Text.writeFormatWithValues(
                    "All files",
                    max_filepath_length,
                    avg,
                    base_fraction,
                    failing,
                    console,
                    false,
                    enable_ansi_colors,
                );

                try console.writeAll(Output.prettyFmt("<r><d> |<r>\n", enable_ansi_colors));
            }

            console_buffer_buffer.flush() catch return;
            try console.writeAll(console_buffer.list.items);
            try console.writeAll(Output.prettyFmt("<r><d>", enable_ansi_colors));
            console.writeByteNTimes('-', max_filepath_length + 2) catch return;
            console.writeAll(Output.prettyFmt("|---------|---------|-------------------<r>\n", enable_ansi_colors)) catch return;

            opts.fractions.failing = failing;
            Output.flush();
        }

        if (comptime reporters.lcov) {
            try lcov_buffered_writer.flush();
            lcov_file.close();
            bun.C.moveFileZ(
                bun.toFD(std.fs.cwd()),
                lcov_name,
                bun.toFD(std.fs.cwd()),
                bun.path.joinAbsStringZ(
                    relative_dir,
                    &.{ opts.reports_directory, "lcov.info" },
                    .auto,
                ),
            ) catch |err| {
                Output.err(err, "Failed to save lcov.info file", .{});
                Global.exit(1);
            };
        }
    }
};

const Scanner = struct {
    const Fifo = std.fifo.LinearFifo(ScanEntry, .Dynamic);
    exclusion_names: []const []const u8 = &.{},
    filter_names: []const []const u8 = &.{},
    dirs_to_scan: Fifo,
    results: *std.ArrayList(bun.PathString),
    fs: *FileSystem,
    open_dir_buf: bun.PathBuffer = undefined,
    scan_dir_buf: bun.PathBuffer = undefined,
    options: *options.BundleOptions,
    has_iterated: bool = false,
    search_count: usize = 0,

    const ScanEntry = struct {
        relative_dir: bun.StoredFileDescriptorType,
        dir_path: string,
        name: strings.StringOrTinyString,
    };

    fn readDirWithName(this: *Scanner, name: string, handle: ?std.fs.Dir) !*FileSystem.RealFS.EntriesOption {
        return try this.fs.fs.readDirectoryWithIterator(name, handle, 0, true, *Scanner, this);
    }

    pub fn scan(this: *Scanner, path_literal: string) void {
        const parts = &[_]string{ this.fs.top_level_dir, path_literal };
        const path = this.fs.absBuf(parts, &this.scan_dir_buf);

        var root = this.readDirWithName(path, null) catch |err| {
            if (err == error.NotDir) {
                if (this.isTestFile(path)) {
                    this.results.append(bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch bun.outOfMemory())) catch bun.outOfMemory();
                }
            }

            return;
        };

        // you typed "." and we already scanned it
        if (!this.has_iterated) {
            if (@as(FileSystem.RealFS.EntriesOption.Tag, root.*) == .entries) {
                var iter = root.entries.data.iterator();
                const fd = root.entries.fd;
                bun.assert(fd != bun.invalid_fd);
                while (iter.next()) |entry| {
                    this.next(entry.value_ptr.*, fd);
                }
            }
        }

        while (this.dirs_to_scan.readItem()) |entry| {
            if (!Environment.isWindows) {
                const dir = entry.relative_dir.asDir();
                bun.assert(bun.toFD(dir.fd) != bun.invalid_fd);

                const parts2 = &[_]string{ entry.dir_path, entry.name.slice() };
                var path2 = this.fs.absBuf(parts2, &this.open_dir_buf);
                this.open_dir_buf[path2.len] = 0;
                const pathZ = this.open_dir_buf[path2.len - entry.name.slice().len .. path2.len :0];
                const child_dir = bun.openDir(dir, pathZ) catch continue;
                path2 = this.fs.dirname_store.append(string, path2) catch bun.outOfMemory();
                FileSystem.setMaxFd(child_dir.fd);
                _ = this.readDirWithName(path2, child_dir) catch continue;
            } else {
                const dir = entry.relative_dir.asDir();
                bun.assert(bun.toFD(dir.fd) != bun.invalid_fd);

                const parts2 = &[_]string{ entry.dir_path, entry.name.slice() };
                const path2 = this.fs.absBufZ(parts2, &this.open_dir_buf);
                const child_dir = bun.openDirNoRenamingOrDeletingWindows(bun.invalid_fd, path2) catch continue;
                _ = this.readDirWithName(
                    this.fs.dirname_store.append(string, path2) catch bun.outOfMemory(),
                    child_dir,
                ) catch bun.outOfMemory();
            }
        }
    }

    const test_name_suffixes = [_]string{
        ".test",
        "_test",
        ".spec",
        "_spec",
    };

    export fn BunTest__shouldGenerateCodeCoverage(test_name_str: bun.String) callconv(.C) bool {
        var zig_slice: bun.JSC.ZigString.Slice = .{};
        defer zig_slice.deinit();

        // In this particular case, we don't actually care about non-ascii latin1 characters.
        // so we skip the ascii check
        const slice = brk: {
            zig_slice = test_name_str.toUTF8(bun.default_allocator);
            break :brk zig_slice.slice();
        };

        // always ignore node_modules.
        if (strings.contains(slice, "/node_modules/") or strings.contains(slice, "\\node_modules\\")) {
            return false;
        }

        const ext = std.fs.path.extension(slice);
        const loader_by_ext = JSC.VirtualMachine.get().transpiler.options.loader(ext);

        // allow file loader just incase they use a custom loader with a non-standard extension
        if (!(loader_by_ext.isJavaScriptLike() or loader_by_ext == .file)) {
            return false;
        }

        if (jest.Jest.runner) |runner| {
            if (runner.test_options.coverage.skip_test_files) {
                const name_without_extension = slice[0 .. slice.len - ext.len];
                inline for (test_name_suffixes) |suffix| {
                    if (strings.endsWithComptime(name_without_extension, suffix)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    pub fn couldBeTestFile(this: *Scanner, name: string) bool {
        const extname = std.fs.path.extension(name);
        if (!this.options.loader(extname).isJavaScriptLike()) return false;
        const name_without_extension = name[0 .. name.len - extname.len];
        inline for (test_name_suffixes) |suffix| {
            if (strings.endsWithComptime(name_without_extension, suffix)) return true;
        }

        return false;
    }

    pub fn doesAbsolutePathMatchFilter(this: *Scanner, name: string) bool {
        if (this.filter_names.len == 0) return true;

        for (this.filter_names) |filter_name| {
            if (strings.startsWith(name, filter_name)) return true;
        }

        return false;
    }

    pub fn doesPathMatchFilter(this: *Scanner, name: string) bool {
        if (this.filter_names.len == 0) return true;

        for (this.filter_names) |filter_name| {
            if (strings.contains(name, filter_name)) return true;
        }

        return false;
    }

    pub fn isTestFile(this: *Scanner, name: string) bool {
        return this.couldBeTestFile(name) and this.doesPathMatchFilter(name);
    }

    pub fn next(this: *Scanner, entry: *FileSystem.Entry, fd: bun.StoredFileDescriptorType) void {
        const name = entry.base_lowercase();
        this.has_iterated = true;
        switch (entry.kind(&this.fs.fs, true)) {
            .dir => {
                if ((name.len > 0 and name[0] == '.') or strings.eqlComptime(name, "node_modules")) {
                    return;
                }

                if (comptime Environment.allow_assert)
                    bun.assert(!strings.contains(name, std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str));

                for (this.exclusion_names) |exclude_name| {
                    if (strings.eql(exclude_name, name)) return;
                }

                this.search_count += 1;

                this.dirs_to_scan.writeItem(.{
                    .relative_dir = fd,
                    .name = entry.base_,
                    .dir_path = entry.dir,
                }) catch unreachable;
            },
            .file => {
                // already seen it!
                if (!entry.abs_path.isEmpty()) return;

                this.search_count += 1;
                if (!this.couldBeTestFile(name)) return;

                const parts = &[_]string{ entry.dir, entry.base() };
                const path = this.fs.absBuf(parts, &this.open_dir_buf);

                if (!this.doesAbsolutePathMatchFilter(path)) {
                    const rel_path = bun.path.relative(this.fs.top_level_dir, path);
                    if (!this.doesPathMatchFilter(rel_path)) return;
                }

                entry.abs_path = bun.PathString.init(this.fs.filename_store.append(@TypeOf(path), path) catch unreachable);
                this.results.append(entry.abs_path) catch unreachable;
            },
        }
    }
};

pub const TestCommand = struct {
    pub const name = "test";
    pub const CodeCoverageOptions = struct {
        skip_test_files: bool = !Environment.allow_assert,
        reporters: Reporters = .{ .text = true, .lcov = false },
        reports_directory: string = "coverage",
        fractions: bun.sourcemap.coverage.Fraction = .{},
        ignore_sourcemap: bool = false,
        enabled: bool = false,
        fail_on_low_coverage: bool = false,
    };
    pub const Reporter = enum {
        text,
        lcov,
    };
    const Reporters = struct {
        text: bool,
        lcov: bool,
    };

    pub const FileReporter = enum {
        junit,
    };

    pub fn exec(ctx: Command.Context) !void {
        Output.is_github_action = Output.isGithubAction();

        // print the version so you know its doing stuff if it takes a sec
        Output.prettyln("<r><b>bun test <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
        Output.flush();

        var env_loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            const loader = try ctx.allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, ctx.allocator);
            break :brk loader;
        };
        bun.JSC.initialize(false);
        HTTPThread.init(&.{});

        var snapshot_file_buf = std.ArrayList(u8).init(ctx.allocator);
        var snapshot_values = Snapshots.ValuesHashMap.init(ctx.allocator);
        var snapshot_counts = bun.StringHashMap(usize).init(ctx.allocator);
        var inline_snapshots_to_write = std.AutoArrayHashMap(TestRunner.File.ID, std.ArrayList(Snapshots.InlineSnapshotToWrite)).init(ctx.allocator);
        JSC.isBunTest = true;

        var reporter = try ctx.allocator.create(CommandLineReporter);
        reporter.* = CommandLineReporter{
            .jest = TestRunner{
                .allocator = ctx.allocator,
                .log = ctx.log,
                .callback = undefined,
                .default_timeout_ms = ctx.test_options.default_timeout_ms,
                .run_todo = ctx.test_options.run_todo,
                .only = ctx.test_options.only,
                .bail = ctx.test_options.bail,
                .filter_regex = ctx.test_options.test_filter_regex,
                .filter_buffer = bun.MutableString.init(ctx.allocator, 0) catch unreachable,
                .snapshots = Snapshots{
                    .allocator = ctx.allocator,
                    .update_snapshots = ctx.test_options.update_snapshots,
                    .file_buf = &snapshot_file_buf,
                    .values = &snapshot_values,
                    .counts = &snapshot_counts,
                    .inline_snapshots_to_write = &inline_snapshots_to_write,
                },
            },
            .callback = undefined,
        };
        reporter.callback = TestRunner.Callback{
            .onUpdateCount = CommandLineReporter.handleUpdateCount,
            .onTestStart = CommandLineReporter.handleTestStart,
            .onTestPass = CommandLineReporter.handleTestPass,
            .onTestFail = CommandLineReporter.handleTestFail,
            .onTestSkip = CommandLineReporter.handleTestSkip,
            .onTestTodo = CommandLineReporter.handleTestTodo,
        };
        reporter.repeat_count = @max(ctx.test_options.repeat_count, 1);
        reporter.jest.callback = &reporter.callback;
        jest.Jest.runner = &reporter.jest;
        reporter.jest.test_options = &ctx.test_options;

        if (ctx.test_options.file_reporter) |file_reporter| {
            reporter.file_reporter = switch (file_reporter) {
                .junit => .{ .junit = JunitReporter.init() },
            };
        }

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();
        var vm = try JSC.VirtualMachine.init(
            .{
                .allocator = ctx.allocator,
                .args = ctx.args,
                .log = ctx.log,
                .env_loader = env_loader,
                // we must store file descriptors because we reuse them for
                // iterating through the directory tree recursively
                //
                // in the future we should investigate if refactoring this to not
                // rely on the dir fd yields a performance improvement
                .store_fd = true,
                .smol = ctx.runtime_options.smol,
                .debugger = ctx.runtime_options.debugger,
                .is_main_thread = true,
            },
        );
        vm.argv = ctx.passthrough;
        vm.preload = ctx.preloads;
        vm.transpiler.options.rewrite_jest_for_tests = true;
        vm.transpiler.options.env.behavior = .load_all_without_inlining;

        const node_env_entry = try env_loader.map.getOrPutWithoutValue("NODE_ENV");
        if (!node_env_entry.found_existing) {
            node_env_entry.key_ptr.* = try env_loader.allocator.dupe(u8, node_env_entry.key_ptr.*);
            node_env_entry.value_ptr.* = .{
                .value = try env_loader.allocator.dupe(u8, "test"),
                .conditional = false,
            };
        }

        try vm.transpiler.configureDefines();

        vm.loadExtraEnvAndSourceCodePrinter();
        vm.is_main_thread = true;
        JSC.VirtualMachine.is_main_thread_vm = true;

        if (ctx.test_options.coverage.enabled) {
            vm.transpiler.options.code_coverage = true;
            vm.transpiler.options.minify_syntax = false;
            vm.transpiler.options.minify_identifiers = false;
            vm.transpiler.options.minify_whitespace = false;
            vm.transpiler.options.dead_code_elimination = false;
            vm.global.vm().setControlFlowProfiler(true);
        }

        // For tests, we default to UTC time zone
        // unless the user inputs TZ="", in which case we use local time zone
        var TZ_NAME: string =
            // We use the string "Etc/UTC" instead of "UTC" so there is no normalization difference.
            "Etc/UTC";

        if (vm.transpiler.env.get("TZ")) |tz| {
            TZ_NAME = tz;
        }

        if (TZ_NAME.len > 0) {
            _ = vm.global.setTimeZone(&JSC.ZigString.init(TZ_NAME));
        }

        var results = try std.ArrayList(PathString).initCapacity(ctx.allocator, ctx.positionals.len);
        defer results.deinit();

        // Start the debugger before we scan for files
        // But, don't block the main thread waiting if they used --inspect-wait.
        //
        try vm.ensureDebugger(false);

        const test_files, const search_count = scan: {
            if (for (ctx.positionals) |arg| {
                if (std.fs.path.isAbsolute(arg) or
                    strings.startsWith(arg, "./") or
                    strings.startsWith(arg, "../") or
                    (Environment.isWindows and (strings.startsWith(arg, ".\\") or
                        strings.startsWith(arg, "..\\")))) break true;
            } else false) {
                // One of the files is a filepath. Instead of treating the arguments as filters, treat them as filepaths
                for (ctx.positionals[1..]) |arg| {
                    results.appendAssumeCapacity(PathString.init(arg));
                }
                break :scan .{ results.items, 0 };
            }

            // Treat arguments as filters and scan the codebase
            const filter_names = if (ctx.positionals.len == 0) &[0][]const u8{} else ctx.positionals[1..];

            const filter_names_normalized = if (!Environment.isWindows)
                filter_names
            else brk: {
                const normalized = try ctx.allocator.alloc([]const u8, filter_names.len);
                for (filter_names, normalized) |in, *out| {
                    const to_normalize = try ctx.allocator.dupe(u8, in);
                    bun.path.posixToPlatformInPlace(u8, to_normalize);
                    out.* = to_normalize;
                }
                break :brk normalized;
            };
            defer if (Environment.isWindows) {
                for (filter_names_normalized) |i|
                    ctx.allocator.free(i);
                ctx.allocator.free(filter_names_normalized);
            };

            var scanner = Scanner{
                .dirs_to_scan = Scanner.Fifo.init(ctx.allocator),
                .options = &vm.transpiler.options,
                .fs = vm.transpiler.fs,
                .filter_names = filter_names_normalized,
                .results = &results,
            };
            const dir_to_scan = brk: {
                if (ctx.debug.test_directory.len > 0) {
                    break :brk try vm.allocator.dupe(u8, resolve_path.joinAbs(scanner.fs.top_level_dir, .auto, ctx.debug.test_directory));
                }

                break :brk scanner.fs.top_level_dir;
            };

            scanner.scan(dir_to_scan);
            scanner.dirs_to_scan.deinit();

            break :scan .{ scanner.results.items, scanner.search_count };
        };

        if (test_files.len > 0) {
            vm.hot_reload = ctx.debug.hot_reload;

            switch (vm.hot_reload) {
                .hot => JSC.HotReloader.enableHotModuleReloading(vm),
                .watch => JSC.WatchReloader.enableHotModuleReloading(vm),
                else => {},
            }

            // vm.transpiler.fs.fs.readDirectory(_dir: string, _handle: ?std.fs.Dir)
            runAllTests(reporter, vm, test_files, ctx.allocator);
        }

        const write_snapshots_success = try jest.Jest.runner.?.snapshots.writeInlineSnapshots();
        try jest.Jest.runner.?.snapshots.writeSnapshotFile();
        var coverage_options = ctx.test_options.coverage;
        if (reporter.summary.pass > 20) {
            if (reporter.summary.skip > 0) {
                Output.prettyError("\n<r><d>{d} tests skipped:<r>\n", .{reporter.summary.skip});
                Output.flush();

                var error_writer = Output.errorWriter();
                error_writer.writeAll(reporter.skips_to_repeat_buf.items) catch unreachable;
            }

            if (reporter.summary.todo > 0) {
                if (reporter.summary.skip > 0) {
                    Output.prettyError("\n", .{});
                }

                Output.prettyError("\n<r><d>{d} tests todo:<r>\n", .{reporter.summary.todo});
                Output.flush();

                var error_writer = Output.errorWriter();
                error_writer.writeAll(reporter.todos_to_repeat_buf.items) catch unreachable;
            }

            if (reporter.summary.fail > 0) {
                if (reporter.summary.skip > 0 or reporter.summary.todo > 0) {
                    Output.prettyError("\n", .{});
                }

                Output.prettyError("\n<r><d>{d} tests failed:<r>\n", .{reporter.summary.fail});
                Output.flush();

                var error_writer = Output.errorWriter();
                error_writer.writeAll(reporter.failures_to_repeat_buf.items) catch unreachable;
            }
        }

        Output.flush();

        if (test_files.len == 0) {
            if (ctx.positionals.len == 0) {
                Output.prettyErrorln(
                    \\<yellow>No tests found!<r>
                    \\Tests need ".test", "_test_", ".spec" or "_spec_" in the filename <d>(ex: "MyApp.test.ts")<r>
                    \\
                , .{});
            } else {
                Output.prettyErrorln("<yellow>The following filters did not match any test files:<r>", .{});
                var has_file_like: ?usize = null;
                Output.prettyError(" ", .{});
                for (ctx.positionals[1..], 1..) |filter, i| {
                    Output.prettyError(" {s}", .{filter});

                    if (has_file_like == null and
                        (strings.hasSuffixComptime(filter, ".ts") or
                            strings.hasSuffixComptime(filter, ".tsx") or
                            strings.hasSuffixComptime(filter, ".js") or
                            strings.hasSuffixComptime(filter, ".jsx")))
                    {
                        has_file_like = i;
                    }
                }
                if (search_count > 0) {
                    Output.prettyError("\n{d} files were searched ", .{search_count});
                    Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
                }

                Output.prettyErrorln(
                    \\
                    \\
                    \\<blue>note<r><d>:<r> Tests need ".test", "_test_", ".spec" or "_spec_" in the filename <d>(ex: "MyApp.test.ts")<r>
                , .{});

                // print a helpful note
                if (has_file_like) |i| {
                    Output.prettyErrorln(
                        \\<blue>note<r><d>:<r> To treat the "{s}" filter as a path, run "bun test ./{s}"<r>
                    , .{ ctx.positionals[i], ctx.positionals[i] });
                }
            }
            Output.prettyError(
                \\
                \\Learn more about the test runner: <magenta>https://bun.sh/docs/cli/test<r>
            , .{});
        } else {
            Output.prettyError("\n", .{});

            if (coverage_options.enabled) {
                switch (Output.enable_ansi_colors_stderr) {
                    inline else => |colors| switch (coverage_options.reporters.text) {
                        inline else => |console| switch (coverage_options.reporters.lcov) {
                            inline else => |lcov| {
                                try reporter.generateCodeCoverage(vm, &coverage_options, .{ .text = console, .lcov = lcov }, colors);
                            },
                        },
                    },
                }
            }

            if (reporter.summary.pass > 0) {
                Output.prettyError("<r><green>", .{});
            }

            Output.prettyError(" {d:5>} pass<r>\n", .{reporter.summary.pass});

            if (reporter.summary.skip > 0) {
                Output.prettyError(" <r><yellow>{d:5>} skip<r>\n", .{reporter.summary.skip});
            }

            if (reporter.summary.todo > 0) {
                Output.prettyError(" <r><magenta>{d:5>} todo<r>\n", .{reporter.summary.todo});
            }

            if (reporter.summary.fail > 0) {
                Output.prettyError("<r><red>", .{});
            } else {
                Output.prettyError("<r><d>", .{});
            }

            Output.prettyError(" {d:5>} fail<r>\n", .{reporter.summary.fail});
            if (reporter.jest.unhandled_errors_between_tests > 0) {
                Output.prettyError(" <r><red>{d:5>} error{s}<r>\n", .{ reporter.jest.unhandled_errors_between_tests, if (reporter.jest.unhandled_errors_between_tests > 1) "s" else "" });
            }

            var print_expect_calls = reporter.summary.expectations > 0;
            if (reporter.jest.snapshots.total > 0) {
                const passed = reporter.jest.snapshots.passed;
                const failed = reporter.jest.snapshots.failed;
                const added = reporter.jest.snapshots.added;

                var first = true;
                if (print_expect_calls and added == 0 and failed == 0) {
                    print_expect_calls = false;
                    Output.prettyError(" {d:5>} snapshots, {d:5>} expect() calls", .{ reporter.jest.snapshots.total, reporter.summary.expectations });
                } else {
                    Output.prettyError(" <d>snapshots:<r> ", .{});

                    if (passed > 0) {
                        Output.prettyError("<d>{d} passed<r>", .{passed});
                        first = false;
                    }

                    if (added > 0) {
                        if (first) {
                            first = false;
                            Output.prettyError("<b>+{d} added<r>", .{added});
                        } else {
                            Output.prettyError("<b>, {d} added<r>", .{added});
                        }
                    }

                    if (failed > 0) {
                        if (first) {
                            first = false;
                            Output.prettyError("<red>{d} failed<r>", .{failed});
                        } else {
                            Output.prettyError(", <red>{d} failed<r>", .{failed});
                        }
                    }
                }

                Output.prettyError("\n", .{});
            }

            if (print_expect_calls) {
                Output.prettyError(" {d:5>} expect() calls\n", .{reporter.summary.expectations});
            }

            reporter.printSummary();
        }

        Output.prettyError("\n", .{});
        Output.flush();

        if (reporter.file_reporter) |file_reporter| {
            switch (file_reporter) {
                .junit => |junit| {
                    if (junit.current_file.len > 0) {
                        junit.endTestSuite() catch {};
                    }
                    junit.writeToFile(ctx.test_options.reporter_outfile.?) catch {};
                },
            }
        }

        if (vm.hot_reload == .watch) {
            vm.runWithAPILock(JSC.VirtualMachine, vm, runEventLoopForWatch);
        }

        if (reporter.summary.fail > 0 or (coverage_options.enabled and coverage_options.fractions.failing and coverage_options.fail_on_low_coverage) or !write_snapshots_success) {
            Global.exit(1);
        } else if (reporter.jest.unhandled_errors_between_tests > 0) {
            Global.exit(reporter.jest.unhandled_errors_between_tests);
        }
    }

    fn runEventLoopForWatch(vm: *JSC.VirtualMachine) void {
        vm.eventLoop().tickPossiblyForever();

        while (true) {
            while (vm.isEventLoopAlive()) {
                vm.tick();
                vm.eventLoop().autoTickActive();
            }

            vm.eventLoop().tickPossiblyForever();
        }
    }

    pub fn runAllTests(
        reporter_: *CommandLineReporter,
        vm_: *JSC.VirtualMachine,
        files_: []const PathString,
        allocator_: std.mem.Allocator,
    ) void {
        const Context = struct {
            reporter: *CommandLineReporter,
            vm: *JSC.VirtualMachine,
            files: []const PathString,
            allocator: std.mem.Allocator,
            pub fn begin(this: *@This()) void {
                const reporter = this.reporter;
                const vm = this.vm;
                var files = this.files;
                const allocator = this.allocator;
                bun.assert(files.len > 0);

                if (files.len > 1) {
                    for (files[0 .. files.len - 1]) |file_name| {
                        TestCommand.run(reporter, vm, file_name.slice(), allocator, false) catch |err| handleTopLevelTestErrorBeforeJavaScriptStart(err);
                        reporter.jest.default_timeout_override = std.math.maxInt(u32);
                        Global.mimalloc_cleanup(false);
                    }
                }

                TestCommand.run(reporter, vm, files[files.len - 1].slice(), allocator, true) catch |err| handleTopLevelTestErrorBeforeJavaScriptStart(err);
            }
        };

        var arena = bun.MimallocArena.init() catch @panic("Unexpected error in mimalloc");
        vm_.eventLoop().ensureWaker();
        vm_.arena = &arena;
        vm_.allocator = arena.allocator();
        var ctx = Context{ .reporter = reporter_, .vm = vm_, .files = files_, .allocator = allocator_ };
        vm_.runWithAPILock(Context, &ctx, Context.begin);
    }

    fn timerNoop(_: *uws.Timer) callconv(.C) void {}

    pub fn run(
        reporter: *CommandLineReporter,
        vm: *JSC.VirtualMachine,
        file_name: string,
        _: std.mem.Allocator,
        is_last: bool,
    ) !void {
        defer {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();

            if (vm.log.errors > 0) {
                vm.log.print(Output.errorWriter()) catch {};
                vm.log.msgs.clearRetainingCapacity();
                vm.log.errors = 0;
            }

            Output.flush();
        }

        // Restore test.only state after each module.
        const prev_only = reporter.jest.only;
        defer reporter.jest.only = prev_only;

        const file_start = reporter.jest.files.len;
        const resolution = try vm.transpiler.resolveEntryPoint(file_name);
        vm.clearEntryPoint();

        const file_path = resolution.path_pair.primary.text;
        const file_title = bun.path.relative(FileSystem.instance.top_level_dir, file_path);

        // In Github Actions, append a special prefix that will group
        // subsequent log lines into a collapsable group.
        // https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#grouping-log-lines
        const file_prefix = if (Output.is_github_action) "::group::" else "";

        const repeat_count = reporter.repeat_count;
        var repeat_index: u32 = 0;
        vm.onUnhandledRejectionCtx = null;
        vm.onUnhandledRejection = jest.TestRunnerTask.onUnhandledRejection;

        while (repeat_index < repeat_count) : (repeat_index += 1) {
            if (repeat_count > 1) {
                Output.prettyErrorln("<r>\n{s}{s}: <d>(run #{d})<r>\n", .{ file_prefix, file_title, repeat_index + 1 });
            } else {
                Output.prettyErrorln("<r>\n{s}{s}:\n", .{ file_prefix, file_title });
            }
            Output.flush();

            var promise = try vm.loadEntryPointForTestRunner(file_path);
            reporter.summary.files += 1;

            switch (promise.status(vm.global.vm())) {
                .rejected => {
                    _ = vm.unhandledRejection(vm.global, promise.result(vm.global.vm()), promise.asValue());
                    reporter.summary.fail += 1;

                    if (reporter.jest.bail == reporter.summary.fail) {
                        reporter.printSummary();
                        Output.prettyError("\nBailed out after {d} failure{s}<r>\n", .{ reporter.jest.bail, if (reporter.jest.bail == 1) "" else "s" });

                        Global.exit(1);
                    }

                    return;
                },
                else => {},
            }

            {
                vm.drainMicrotasks();
                var count = vm.unhandled_error_counter;
                vm.global.handleRejectedPromises();
                while (vm.unhandled_error_counter > count) {
                    count = vm.unhandled_error_counter;
                    vm.drainMicrotasks();
                    vm.global.handleRejectedPromises();
                }
            }

            const file_end = reporter.jest.files.len;

            for (file_start..file_end) |module_id| {
                const module: *jest.DescribeScope = reporter.jest.files.items(.module_scope)[module_id];

                vm.onUnhandledRejectionCtx = null;
                vm.onUnhandledRejection = jest.TestRunnerTask.onUnhandledRejection;
                module.runTests(vm.global);
                vm.eventLoop().tick();

                var prev_unhandled_count = vm.unhandled_error_counter;
                while (vm.active_tasks > 0) : (vm.eventLoop().flushImmediateQueue()) {
                    if (!jest.Jest.runner.?.has_pending_tests) {
                        jest.Jest.runner.?.drain();
                    }
                    vm.eventLoop().tick();

                    while (jest.Jest.runner.?.has_pending_tests) {
                        vm.eventLoop().autoTick();
                        if (!jest.Jest.runner.?.has_pending_tests) break;
                        vm.eventLoop().tick();
                    } else {
                        vm.eventLoop().tickImmediateTasks(vm);
                    }

                    while (prev_unhandled_count < vm.unhandled_error_counter) {
                        vm.global.handleRejectedPromises();
                        prev_unhandled_count = vm.unhandled_error_counter;
                    }
                }

                vm.eventLoop().flushImmediateQueue();

                switch (vm.aggressive_garbage_collection) {
                    .none => {},
                    .mild => {
                        _ = vm.global.vm().collectAsync();
                    },
                    .aggressive => {
                        _ = vm.global.vm().runGC(false);
                    },
                }
            }

            vm.global.handleRejectedPromises();
            if (repeat_index > 0) {
                vm.clearEntryPoint();
                var entry = JSC.ZigString.init(file_path);
                vm.global.deleteModuleRegistryEntry(&entry);
            }

            if (Output.is_github_action) {
                Output.prettyErrorln("<r>\n::endgroup::\n", .{});
                Output.flush();
            }

            // Ensure these never linger across files.
            vm.auto_killer.clear();
            vm.auto_killer.disable();
        }

        if (is_last) {
            if (jest.Jest.runner != null) {
                if (jest.DescribeScope.runGlobalCallbacks(vm.global, .afterAll)) |err| {
                    _ = vm.uncaughtException(vm.global, err, true);
                }
            }
        }
    }
};

fn handleTopLevelTestErrorBeforeJavaScriptStart(err: anyerror) noreturn {
    if (comptime Environment.isDebug) {
        if (err != error.ModuleNotFound) {
            Output.debugWarn("Unhandled error: {s}\n", .{@errorName(err)});
        }
    }
    Global.exit(1);
}
