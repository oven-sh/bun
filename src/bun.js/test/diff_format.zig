const std = @import("std");
const bun = @import("root").bun;
const MutableString = bun.MutableString;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const string = bun.string;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ConsoleObject = JSC.ConsoleObject;
const DiffMatchPatch = @import("../../deps/diffz/DiffMatchPatch.zig");

pub const DiffFormatter = struct {
    received_string: ?string = null,
    expected_string: ?string = null,
    received: ?JSValue = null,
    expected: ?JSValue = null,
    globalThis: *JSGlobalObject,
    not: bool = false,

    pub fn format(this: DiffFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (this.expected_string != null and this.received_string != null) {
            const received = this.received_string.?;
            const expected = this.expected_string.?;

            var dmp = DiffMatchPatch.default;
            dmp.diff_timeout = 200;
            var diffs = try dmp.diff(default_allocator, received, expected, false);
            defer diffs.deinit(default_allocator);

            const equal_fmt = "<d>{s}<r>";
            const delete_fmt = "<red>{s}<r>";
            const insert_fmt = "<green>{s}<r>";

            try writer.writeAll("Expected: ");
            for (diffs.items) |df| {
                switch (df.operation) {
                    .delete => continue,
                    .insert => {
                        if (Output.enable_ansi_colors) {
                            try writer.print(Output.prettyFmt(insert_fmt, true), .{df.text});
                        } else {
                            try writer.print(Output.prettyFmt(insert_fmt, false), .{df.text});
                        }
                    },
                    .equal => {
                        if (Output.enable_ansi_colors) {
                            try writer.print(Output.prettyFmt(equal_fmt, true), .{df.text});
                        } else {
                            try writer.print(Output.prettyFmt(equal_fmt, false), .{df.text});
                        }
                    },
                }
            }

            try writer.writeAll("\nReceived: ");
            for (diffs.items) |df| {
                switch (df.operation) {
                    .insert => continue,
                    .delete => {
                        if (Output.enable_ansi_colors) {
                            try writer.print(Output.prettyFmt(delete_fmt, true), .{df.text});
                        } else {
                            try writer.print(Output.prettyFmt(delete_fmt, false), .{df.text});
                        }
                    },
                    .equal => {
                        if (Output.enable_ansi_colors) {
                            try writer.print(Output.prettyFmt(equal_fmt, true), .{df.text});
                        } else {
                            try writer.print(Output.prettyFmt(equal_fmt, false), .{df.text});
                        }
                    },
                }
            }
            return;
        }

        if (this.received == null or this.expected == null) return;

        const received = this.received.?;
        const expected = this.expected.?;
        var received_buf = MutableString.init(default_allocator, 0) catch unreachable;
        var expected_buf = MutableString.init(default_allocator, 0) catch unreachable;
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
            );
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
            );
            buffered_writer.flush() catch unreachable;
        }

        const received_slice = received_buf.toOwnedSliceLeaky();
        const expected_slice = expected_buf.toOwnedSliceLeaky();

        if (this.not) {
            const not_fmt = "Expected: not <green>{s}<r>";
            if (Output.enable_ansi_colors) {
                try writer.print(Output.prettyFmt(not_fmt, true), .{expected_slice});
            } else {
                try writer.print(Output.prettyFmt(not_fmt, false), .{expected_slice});
            }
            return;
        }

        switch (received.determineDiffMethod(expected, this.globalThis)) {
            .none => {
                const fmt = "Expected: <green>{any}<r>\nReceived: <red>{any}<r>";
                var formatter = ConsoleObject.Formatter{ .globalThis = this.globalThis, .quote_strings = true };
                if (Output.enable_ansi_colors) {
                    try writer.print(Output.prettyFmt(fmt, true), .{
                        expected.toFmt(&formatter),
                        received.toFmt(&formatter),
                    });
                    return;
                }

                try writer.print(Output.prettyFmt(fmt, true), .{
                    expected.toFmt(&formatter),
                    received.toFmt(&formatter),
                });
                return;
            },
            .character => {
                var dmp = DiffMatchPatch.default;
                dmp.diff_timeout = 200;
                var diffs = try dmp.diff(default_allocator, received_slice, expected_slice, false);
                defer diffs.deinit(default_allocator);

                const equal_fmt = "<d>{s}<r>";
                const delete_fmt = "<red>{s}<r>";
                const insert_fmt = "<green>{s}<r>";

                try writer.writeAll("Expected: ");
                for (diffs.items) |df| {
                    switch (df.operation) {
                        .delete => continue,
                        .insert => {
                            if (Output.enable_ansi_colors) {
                                try writer.print(Output.prettyFmt(insert_fmt, true), .{df.text});
                            } else {
                                try writer.print(Output.prettyFmt(insert_fmt, false), .{df.text});
                            }
                        },
                        .equal => {
                            if (Output.enable_ansi_colors) {
                                try writer.print(Output.prettyFmt(equal_fmt, true), .{df.text});
                            } else {
                                try writer.print(Output.prettyFmt(equal_fmt, false), .{df.text});
                            }
                        },
                    }
                }

                try writer.writeAll("\nReceived: ");
                for (diffs.items) |df| {
                    switch (df.operation) {
                        .insert => continue,
                        .delete => {
                            if (Output.enable_ansi_colors) {
                                try writer.print(Output.prettyFmt(delete_fmt, true), .{df.text});
                            } else {
                                try writer.print(Output.prettyFmt(delete_fmt, false), .{df.text});
                            }
                        },
                        .equal => {
                            if (Output.enable_ansi_colors) {
                                try writer.print(Output.prettyFmt(equal_fmt, true), .{df.text});
                            } else {
                                try writer.print(Output.prettyFmt(equal_fmt, false), .{df.text});
                            }
                        },
                    }
                }
                return;
            },
            .line => {
                var dmp = DiffMatchPatch.default;
                dmp.diff_timeout = 200;
                var diffs = try dmp.diffLines(default_allocator, received_slice, expected_slice);
                defer diffs.deinit(default_allocator);

                const equal_fmt = "<d>  {s}<r>";
                const delete_fmt = "<red>+ {s}<r>";
                const insert_fmt = "<green>- {s}<r>";

                var insert_count: usize = 0;
                var delete_count: usize = 0;

                for (diffs.items) |df| {
                    var prev: usize = 0;
                    var curr: usize = 0;
                    switch (df.operation) {
                        .equal => {
                            while (curr < df.text.len) {
                                if (curr == df.text.len - 1 or df.text[curr] == '\n' and curr != 0) {
                                    if (Output.enable_ansi_colors) {
                                        try writer.print(Output.prettyFmt(equal_fmt, true), .{df.text[prev .. curr + 1]});
                                    } else {
                                        try writer.print(Output.prettyFmt(equal_fmt, false), .{df.text[prev .. curr + 1]});
                                    }
                                    prev = curr + 1;
                                }
                                curr += 1;
                            }
                        },
                        .insert => {
                            while (curr < df.text.len) {
                                if (curr == df.text.len - 1 or df.text[curr] == '\n' and curr != 0) {
                                    insert_count += 1;
                                    if (Output.enable_ansi_colors) {
                                        try writer.print(Output.prettyFmt(insert_fmt, true), .{df.text[prev .. curr + 1]});
                                    } else {
                                        try writer.print(Output.prettyFmt(insert_fmt, false), .{df.text[prev .. curr + 1]});
                                    }
                                    prev = curr + 1;
                                }
                                curr += 1;
                            }
                        },
                        .delete => {
                            while (curr < df.text.len) {
                                if (curr == df.text.len - 1 or df.text[curr] == '\n' and curr != 0) {
                                    delete_count += 1;
                                    if (Output.enable_ansi_colors) {
                                        try writer.print(Output.prettyFmt(delete_fmt, true), .{df.text[prev .. curr + 1]});
                                    } else {
                                        try writer.print(Output.prettyFmt(delete_fmt, false), .{df.text[prev .. curr + 1]});
                                    }
                                    prev = curr + 1;
                                }
                                curr += 1;
                            }
                        },
                    }
                    if (df.text[df.text.len - 1] != '\n') try writer.writeAll("\n");
                }

                if (Output.enable_ansi_colors) {
                    try writer.print(Output.prettyFmt("\n<green>- Expected  - {d}<r>\n", true), .{insert_count});
                    try writer.print(Output.prettyFmt("<red>+ Received  + {d}<r>", true), .{delete_count});
                    return;
                }
                try writer.print("\n- Expected  - {d}\n", .{insert_count});
                try writer.print("+ Received  + {d}", .{delete_count});
                return;
            },
            .word => {
                // not implemented
                // https://github.com/google/diff-match-patch/wiki/Line-or-Word-Diffs#word-mode
            },
        }
        return;
    }
};
