const string = []const u8;

/// Represents a single frame in a stack trace
pub const ZigStackFrame = extern struct {
    function_name: String,
    source_url: String,
    position: ZigStackFramePosition,
    code_type: ZigStackFrameCode,
    is_async: bool,

    /// This informs formatters whether to display as a blob URL or not
    remapped: bool = false,

    pub fn deinit(this: *ZigStackFrame) void {
        this.function_name.deref();
        this.source_url.deref();
    }

    pub fn toAPI(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, allocator: std.mem.Allocator) !api.StackFrame {
        var frame: api.StackFrame = comptime std.mem.zeroes(api.StackFrame);
        if (!this.function_name.isEmpty()) {
            var slicer = this.function_name.toUTF8(allocator);
            frame.function_name = (try slicer.cloneIfNeeded(allocator)).slice();
        }

        if (!this.source_url.isEmpty()) {
            frame.file = try std.fmt.allocPrint(allocator, "{}", .{this.sourceURLFormatter(root_path, origin, true, false)});
        }

        frame.position = this.position;
        frame.scope = @as(api.StackFrameScope, @enumFromInt(@intFromEnum(this.code_type)));

        return frame;
    }

    pub const SourceURLFormatter = struct {
        source_url: bun.String,
        position: ZigStackFramePosition,
        enable_color: bool,
        origin: ?*const ZigURL,
        exclude_line_column: bool = false,
        remapped: bool = false,
        root_path: string = "",

        pub fn format(this: SourceURLFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.enable_color) {
                try writer.writeAll(Output.prettyFmt("<r><cyan>", true));
            }

            var source_slice_ = this.source_url.toUTF8(bun.default_allocator);
            var source_slice = source_slice_.slice();
            defer source_slice_.deinit();

            if (!this.remapped) {
                if (this.origin) |origin| {
                    try writer.writeAll(origin.displayProtocol());
                    try writer.writeAll("://");
                    try writer.writeAll(origin.displayHostname());
                    try writer.writeAll(":");
                    try writer.writeAll(origin.port);
                    try writer.writeAll("/blob:");

                    if (strings.startsWith(source_slice, this.root_path)) {
                        source_slice = source_slice[this.root_path.len..];
                    }
                }
                try writer.writeAll(source_slice);
            } else {
                if (this.enable_color) {
                    const not_root = if (comptime bun.Environment.isWindows) this.root_path.len > "C:\\".len else this.root_path.len > "/".len;
                    if (not_root and strings.startsWith(source_slice, this.root_path)) {
                        const root_path = strings.withoutTrailingSlash(this.root_path);
                        const relative_path = strings.withoutLeadingPathSeparator(source_slice[this.root_path.len..]);
                        try writer.writeAll(comptime Output.prettyFmt("<d>", true));
                        try writer.writeAll(root_path);
                        try writer.writeByte(std.fs.path.sep);
                        try writer.writeAll(comptime Output.prettyFmt("<r><cyan>", true));
                        try writer.writeAll(relative_path);
                    } else {
                        try writer.writeAll(source_slice);
                    }
                } else {
                    try writer.writeAll(source_slice);
                }
            }

            if (source_slice.len > 0 and (this.position.line.isValid() or this.position.column.isValid())) {
                if (this.enable_color) {
                    try writer.writeAll(comptime Output.prettyFmt("<r><d>:<r>", true));
                } else {
                    try writer.writeAll(":");
                }
            } else if (source_slice.len == 0) {
                if (this.enable_color) {
                    try writer.writeAll(comptime Output.prettyFmt("<d>", true));
                }
            }

            if (!this.exclude_line_column) {
                if (this.position.line.isValid() and this.position.column.isValid()) {
                    if (this.enable_color) {
                        try std.fmt.format(
                            writer,
                            comptime Output.prettyFmt("<yellow>{d}<r><d>:<yellow>{d}<r>", true),
                            .{ this.position.line.oneBased(), this.position.column.oneBased() },
                        );
                    } else {
                        try std.fmt.format(writer, "{d}:{d}", .{
                            this.position.line.oneBased(),
                            this.position.column.oneBased(),
                        });
                    }
                } else if (this.position.line.isValid()) {
                    if (this.enable_color) {
                        try std.fmt.format(
                            writer,
                            comptime Output.prettyFmt("<yellow>{d}<r>", true),
                            .{
                                this.position.line.oneBased(),
                            },
                        );
                    } else {
                        try std.fmt.format(writer, "{d}", .{
                            this.position.line.oneBased(),
                        });
                    }
                }
            }
        }
    };

    pub const NameFormatter = struct {
        function_name: String,
        code_type: ZigStackFrameCode,
        enable_color: bool,
        is_async: bool,
        root_path: string,
        source_url: String,

        pub fn format(this: NameFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const name = this.function_name;

            const no_src_url = this.source_url.isEmpty();
            const same_cwd = if (no_src_url) false else if (this.enable_color) brk: {
                var source_slice_ = this.source_url.toUTF8(bun.default_allocator);
                const source_slice = source_slice_.slice();
                defer source_slice_.deinit();

                break :brk strings.startsWith(source_slice, this.root_path);
            } else false;

            switch (this.code_type) {
                .Eval => {
                    if (this.enable_color) {
                        try writer.writeAll(comptime Output.prettyFmt("<r><d>eval<r>", true));
                    } else {
                        try writer.writeAll("eval");
                    }
                    if (!name.isEmpty()) {
                        if (this.enable_color) {
                            try writer.writeAll(comptime Output.prettyFmt(" <r><i>", true));
                            if (!same_cwd) {
                                try writer.writeAll(comptime Output.prettyFmt("<d>", true));
                            }
                            if (!no_src_url) {
                                try writer.writeAll(comptime Output.prettyFmt("<b>", true));
                            }
                            try std.fmt.format(writer, comptime Output.prettyFmt("{}<r>", true), .{name});
                        } else {
                            try std.fmt.format(writer, " {}", .{name});
                        }
                    }
                },
                .Function => {
                    if (!name.isEmpty()) {
                        if (this.enable_color) {
                            try writer.writeAll(comptime Output.prettyFmt("<r><i>", true));
                            if (!same_cwd) {
                                try writer.writeAll(comptime Output.prettyFmt("<d>", true));
                            }
                            if (!no_src_url) {
                                try writer.writeAll(comptime Output.prettyFmt("<b>", true));
                            }
                            if (this.is_async) {
                                try writer.writeAll("async ");
                            }
                            try std.fmt.format(writer, comptime Output.prettyFmt("{}<r>", true), .{name});
                        } else {
                            if (this.is_async) {
                                try std.fmt.format(writer, "async {}", .{name});
                            } else {
                                try std.fmt.format(writer, "{}", .{name});
                            }
                        }
                    } else {
                        if (this.enable_color) {
                            if (this.is_async) {
                                try writer.writeAll(comptime Output.prettyFmt("<r><d>async \\<anonymous\\><r>", true));
                            } else {
                                try writer.writeAll(comptime Output.prettyFmt("<r><d>\\<anonymous\\><r>", true));
                            }
                        } else {
                            if (this.is_async) {
                                try writer.writeAll("async ");
                            }
                            try writer.writeAll("<anonymous>");
                        }
                    }
                },
                .Global => {},
                .Wasm => {
                    if (!name.isEmpty()) {
                        try std.fmt.format(writer, "{}", .{name});
                    } else {
                        try writer.writeAll("WASM");
                    }
                },
                .Constructor => {
                    if (this.enable_color and !same_cwd) {
                        try std.fmt.format(writer, comptime Output.prettyFmt("<d>new {}<r>", true), .{name});
                    } else {
                        try std.fmt.format(writer, "new {}", .{name});
                    }
                },
                else => {
                    if (!name.isEmpty()) {
                        try std.fmt.format(writer, "{}", .{name});
                    }
                },
            }
        }
    };

    pub const Zero: ZigStackFrame = .{
        .function_name = .empty,
        .code_type = .None,
        .source_url = .empty,
        .position = .invalid,
        .is_async = false,
    };

    pub fn nameFormatter(this: *const ZigStackFrame, root_path: string, comptime enable_color: bool) NameFormatter {
        return NameFormatter{
            .function_name = this.function_name,
            .code_type = this.code_type,
            .enable_color = enable_color,
            .is_async = this.is_async,
            .root_path = root_path,
            .source_url = this.source_url,
        };
    }

    pub fn sourceURLFormatter(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, exclude_line_column: bool, comptime enable_color: bool) SourceURLFormatter {
        return SourceURLFormatter{
            .source_url = this.source_url,
            .exclude_line_column = exclude_line_column,
            .origin = origin,
            .root_path = root_path,
            .position = this.position,
            .enable_color = enable_color,
            .remapped = this.remapped,
        };
    }
};

const std = @import("std");
const ZigURL = @import("../../url.zig").URL;

const bun = @import("bun");
const Output = bun.Output;
const String = bun.String;
const strings = bun.strings;
const api = bun.schema.api;

const jsc = bun.jsc;
const ZigStackFrameCode = jsc.ZigStackFrameCode;
const ZigStackFramePosition = jsc.ZigStackFramePosition;
