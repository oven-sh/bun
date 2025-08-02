pub const DiffFormatter = struct {
    received_string: ?string = null,
    expected_string: ?string = null,
    received: ?JSValue = null,
    expected: ?JSValue = null,
    globalThis: *JSGlobalObject,
    not: bool = false,

    pub fn format(this: DiffFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var scope = bun.AllocationScope.init(default_allocator);
        // defer scope.deinit(); // TODO: fix leaks
        const allocator = scope.allocator();

        const diff_config: DiffConfig = .default(Output.isAIAgent(), Output.enable_ansi_colors);

        if (this.expected_string != null and this.received_string != null) {
            const received = this.received_string.?;
            const expected = this.expected_string.?;

            try printDiffMain(allocator, this.not, received, expected, writer, diff_config);
            return;
        }

        if (this.received == null or this.expected == null) return;

        const received = this.received.?;
        var received_buf = MutableString.init(allocator, 0) catch unreachable;
        var expected_buf = MutableString.init(allocator, 0) catch unreachable;
        defer {
            received_buf.deinit();
            expected_buf.deinit();
        }

        {
            var buffered_writer_ = MutableString.BufferedWriter{ .context = &received_buf };
            var buffered_writer = &buffered_writer_;

            const buf_writer = buffered_writer.writer();
            const Writer = @TypeOf(buf_writer);

            const fmt_options = JestPrettyFormat.FormatOptions{
                .enable_colors = false,
                .add_newline = false,
                .flush = false,
                .quote_strings = true,
            };
            JestPrettyFormat.format(
                .Debug,
                this.globalThis,
                @as([*]const JSValue, @ptrCast(&received)),
                1,
                Writer,
                Writer,
                buf_writer,
                fmt_options,
            ) catch {}; // TODO:
            buffered_writer.flush() catch unreachable;

            buffered_writer_.context = &expected_buf;

            JestPrettyFormat.format(
                .Debug,
                this.globalThis,
                @as([*]const JSValue, @ptrCast(&this.expected)),
                1,
                Writer,
                Writer,
                buf_writer,
                fmt_options,
            ) catch {}; // TODO:
            buffered_writer.flush() catch unreachable;
        }

        var received_slice = received_buf.slice();
        var expected_slice = expected_buf.slice();
        if (std.mem.startsWith(u8, received_slice, "\n")) received_slice = received_slice[1..];
        if (std.mem.startsWith(u8, expected_slice, "\n")) expected_slice = expected_slice[1..];
        if (std.mem.endsWith(u8, received_slice, "\n")) received_slice = received_slice[0 .. received_slice.len - 1];
        if (std.mem.endsWith(u8, expected_slice, "\n")) expected_slice = expected_slice[0 .. expected_slice.len - 1];

        try printDiffMain(allocator, this.not, received_slice, expected_slice, writer, diff_config);
    }
};

const string = []const u8;

const std = @import("std");
const JestPrettyFormat = @import("./pretty_format.zig").JestPrettyFormat;

const printDiffFile = @import("./diff/printDiff.zig");
const DiffConfig = printDiffFile.DiffConfig;
const printDiffMain = printDiffFile.printDiffMain;

const bun = @import("bun");
const MutableString = bun.MutableString;
const Output = bun.Output;
const default_allocator = bun.default_allocator;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
