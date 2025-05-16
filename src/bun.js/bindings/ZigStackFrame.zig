const bun = @import("bun");
const std = @import("std");
const JSC = bun.JSC;
const String = bun.String;
const ZigURL = @import("../../url.zig").URL;
const ZigStackFrameCode = JSC.ZigStackFrameCode;
const ZigStackFramePosition = JSC.ZigStackFramePosition;
const Output = bun.Output;
const strings = bun.strings;
const Api = @import("../../api/schema.zig").Api;
const string = []const u8;

/// Represents a single frame in a stack trace
pub const ZigStackFrame = extern struct {
    function_name: String,
    source_url: String,
    position: ZigStackFramePosition,
    code_type: ZigStackFrameCode,

    /// This informs formatters whether to display as a blob URL or not
    remapped: bool = false,

    pub fn deinit(this: *ZigStackFrame) void {
        this.function_name.deref();
        this.source_url.deref();
    }

    pub fn toAPI(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, allocator: std.mem.Allocator) !Api.StackFrame {
        var frame: Api.StackFrame = comptime std.mem.zeroes(Api.StackFrame);
        if (!this.function_name.isEmpty()) {
            var slicer = this.function_name.toUTF8(allocator);
            defer slicer.deinit();
            frame.function_name = (try slicer.clone(allocator)).slice();
        }

        if (!this.source_url.isEmpty()) {
            frame.file = try std.fmt.allocPrint(allocator, "{}", .{this.sourceURLFormatter(root_path, origin, true, false)});
        }

        frame.position = this.position;
        frame.scope = @as(Api.StackFrameScope, @enumFromInt(@intFromEnum(this.code_type)));

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
            }

            try writer.writeAll(source_slice);
            if (source_slice.len > 0 and (this.position.line.isValid() or this.position.column.isValid())) {
                if (this.enable_color) {
                    try writer.writeAll(comptime Output.prettyFmt("<r><d>:", true));
                } else {
                    try writer.writeAll(":");
                }
            }

            if (this.enable_color) {
                if (this.position.line.isValid() or this.position.column.isValid()) {
                    try writer.writeAll(comptime Output.prettyFmt("<r>", true));
                } else {
                    try writer.writeAll(comptime Output.prettyFmt("<r>", true));
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

        pub fn format(this: NameFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const name = this.function_name;

            switch (this.code_type) {
                .Eval => {
                    if (this.enable_color) {
                        try std.fmt.format(writer, comptime Output.prettyFmt("<r><d>", true) ++ "eval" ++ Output.prettyFmt("<r>", true), .{});
                    } else {
                        try writer.writeAll("eval");
                    }
                    if (!name.isEmpty()) {
                        if (this.enable_color) {
                            try std.fmt.format(writer, comptime Output.prettyFmt(" <r><b><i>{}<r>", true), .{name});
                        } else {
                            try std.fmt.format(writer, " {}", .{name});
                        }
                    }
                },
                .Function => {
                    if (!name.isEmpty()) {
                        if (this.enable_color) {
                            try std.fmt.format(writer, comptime Output.prettyFmt("<r><b><i>{}<r>", true), .{name});
                        } else {
                            try std.fmt.format(writer, "{}", .{name});
                        }
                    } else {
                        if (this.enable_color) {
                            try std.fmt.format(writer, comptime Output.prettyFmt("<r><d>", true) ++ "<anonymous>" ++ Output.prettyFmt("<r>", true), .{});
                        } else {
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
                    try std.fmt.format(writer, "new {}", .{name});
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
    };

    pub fn nameFormatter(this: *const ZigStackFrame, comptime enable_color: bool) NameFormatter {
        return NameFormatter{ .function_name = this.function_name, .code_type = this.code_type, .enable_color = enable_color };
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
