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

        if (this.expected_string != null and this.received_string != null) {
            const received = this.received_string.?;
            const expected = this.expected_string.?;

            try printDiffMain(allocator, this.not, received, expected, writer, Output.enable_ansi_colors);
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

            const fmt_options = ConsoleObject.FormatOptions{
                .enable_colors = false,
                .add_newline = false,
                .flush = false,
                .ordered_properties = true,
                .quote_strings = true,
                .max_depth = 100,
            };
            ConsoleObject.format2(
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

            ConsoleObject.format2(
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

        const received_slice = received_buf.slice();
        const expected_slice = expected_buf.slice();

        try printDiffMain(allocator, this.not, received_slice, expected_slice, writer, .{
            .enable_ansi_colors = Output.enable_ansi_colors,
        });
    }
};

// @sortImports

const std = @import("std");
const printDiffMain = @import("diff/printDiff.zig").printDiffMain;

const bun = @import("bun");
const MutableString = bun.MutableString;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const string = bun.string;

const JSC = bun.JSC;
const ConsoleObject = JSC.ConsoleObject;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
