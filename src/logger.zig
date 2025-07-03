const std = @import("std");
const Api = @import("./api/schema.zig").Api;
const js = bun.JSC;
const ImportKind = @import("./import_record.zig").ImportKind;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const JSC = bun.JSC;
const fs = @import("fs.zig");
const assert = bun.assert;
const StringBuilder = bun.StringBuilder;
const Index = @import("./ast/base.zig").Index;
const OOM = bun.OOM;
const JSError = bun.JSError;

pub const Kind = enum(u8) {
    err = 0,
    warn = 1,
    note = 2,
    debug = 3,
    verbose = 4,

    pub inline fn shouldPrint(this: Kind, other: Log.Level) bool {
        return switch (other) {
            .err => switch (this) {
                .err, .note => true,
                else => false,
            },
            .warn => switch (this) {
                .err, .warn, .note => true,
                else => false,
            },
            .info, .debug => this != .verbose,
            .verbose => true,
        };
    }

    pub inline fn string(self: Kind) bun.string {
        return switch (self) {
            .err => "error",
            .warn => "warn",
            .note => "note",
            .debug => "debug",
            .verbose => "verbose",
        };
    }

    pub inline fn toAPI(kind: Kind) Api.MessageLevel {
        return switch (kind) {
            .err => .err,
            .warn => .warn,
            .note => .note,
            else => .debug,
        };
    }
};

// Do not mark these as packed
// https://github.com/ziglang/zig/issues/15715
pub const Loc = struct {
    start: i32 = -1,

    pub inline fn toNullable(loc: *Loc) ?Loc {
        return if (loc.start == -1) null else loc.*;
    }

    pub const toUsize = i;

    pub inline fn i(self: *const Loc) usize {
        return @as(usize, @intCast(@max(self.start, 0)));
    }

    pub const Empty = Loc{ .start = -1 };

    pub inline fn eql(loc: Loc, other: Loc) bool {
        return loc.start == other.start;
    }

    pub inline fn isEmpty(this: Loc) bool {
        return eql(this, Empty);
    }

    pub fn jsonStringify(self: *const Loc, writer: anytype) !void {
        return try writer.write(self.start);
    }
};

pub const Location = struct {
    file: string,
    namespace: string = "file",
    /// 1-based line number.
    /// Line <= 0 means there is no line and column information.
    // TODO: move to `bun.Ordinal`
    line: i32,
    // TODO: figure out how this is interpreted, convert to `bun.Ordinal`
    // original docs: 0-based, in bytes.
    // but there is a place where this is emitted in output, implying one based character offset
    column: i32,
    /// Number of bytes this location should highlight.
    /// 0 to just point at a single character
    length: usize = 0,
    /// Text on the line, avoiding the need to refetch the source code
    line_text: ?string = null,
    // TODO: remove this unused field
    suggestion: ?string = null,
    // TODO: document or remove
    offset: usize = 0,

    pub fn memoryCost(this: *const Location) usize {
        var cost: usize = 0;
        cost += this.file.len;
        cost += this.namespace.len;
        if (this.line_text) |text| cost += text.len;
        if (this.suggestion) |text| cost += text.len;
        return cost;
    }

    pub fn count(this: Location, builder: *StringBuilder) void {
        builder.count(this.file);
        builder.count(this.namespace);
        if (this.line_text) |text| builder.count(text);
        if (this.suggestion) |text| builder.count(text);
    }

    pub fn clone(this: Location, allocator: std.mem.Allocator) !Location {
        return Location{
            .file = try allocator.dupe(u8, this.file),
            .namespace = this.namespace,
            .line = this.line,
            .column = this.column,
            .length = this.length,
            .line_text = if (this.line_text != null) try allocator.dupe(u8, this.line_text.?) else null,
            .suggestion = if (this.suggestion != null) try allocator.dupe(u8, this.suggestion.?) else null,
            .offset = this.offset,
        };
    }

    pub fn cloneWithBuilder(this: Location, string_builder: *StringBuilder) Location {
        return Location{
            .file = string_builder.append(this.file),
            .namespace = this.namespace,
            .line = this.line,
            .column = this.column,
            .length = this.length,
            .line_text = if (this.line_text != null) string_builder.append(this.line_text.?) else null,
            .suggestion = if (this.suggestion != null) string_builder.append(this.suggestion.?) else null,
            .offset = this.offset,
        };
    }

    pub fn toAPI(this: *const Location) Api.Location {
        return Api.Location{
            .file = this.file,
            .namespace = this.namespace,
            .line = this.line,
            .column = this.column,
            .line_text = this.line_text orelse "",
            .suggestion = this.suggestion orelse "",
            .offset = @as(u32, @truncate(this.offset)),
        };
    }

    // don't really know what's safe to deinit here!
    pub fn deinit(_: *Location, _: std.mem.Allocator) void {}

    pub fn init(file: string, namespace: string, line: i32, column: i32, length: u32, line_text: ?string, suggestion: ?string) Location {
        return Location{
            .file = file,
            .namespace = namespace,
            .line = line,
            .column = column,
            .length = length,
            .line_text = line_text,
            .suggestion = suggestion,
            .offset = length,
        };
    }

    pub fn initOrNull(_source: ?*const Source, r: Range) ?Location {
        if (_source) |source| {
            if (r.isEmpty()) {
                return Location{
                    .file = source.path.text,
                    .namespace = source.path.namespace,
                    .line = -1,
                    .column = -1,
                    .length = 0,
                    .line_text = "",
                    .offset = 0,
                };
            }
            const data = source.initErrorPosition(r.loc);
            var full_line = source.contents[data.line_start..data.line_end];
            if (full_line.len > 80 + data.column_count) {
                full_line = full_line[@max(data.column_count, 40) - 40 .. @min(data.column_count + 40, full_line.len - 40) + 40];
            }

            return Location{
                .file = source.path.text,
                .namespace = source.path.namespace,
                .line = usize2Loc(data.line_count).start,
                .column = usize2Loc(data.column_count).start,
                .length = if (r.len > -1) @as(u32, @intCast(r.len)) else 1,
                .line_text = std.mem.trimLeft(u8, full_line, "\n\r"),
                .offset = @as(usize, @intCast(@max(r.loc.start, 0))),
            };
        }
        return null;
    }
};

pub const Data = struct {
    text: string,
    location: ?Location = null,

    pub fn memoryCost(this: *const Data) usize {
        var cost: usize = 0;
        cost += this.text.len;
        if (this.location) |*loc| {
            cost += loc.memoryCost();
        }
        return cost;
    }

    pub fn deinit(d: *Data, allocator: std.mem.Allocator) void {
        if (d.location) |*loc| {
            loc.deinit(allocator);
        }

        allocator.free(d.text);
    }

    pub fn cloneLineText(this: Data, should: bool, allocator: std.mem.Allocator) OOM!Data {
        if (!should or this.location == null or this.location.?.line_text == null)
            return this;

        const new_line_text = try allocator.dupe(u8, this.location.?.line_text.?);
        var new_location = this.location.?;
        new_location.line_text = new_line_text;
        return Data{
            .text = this.text,
            .location = new_location,
        };
    }

    pub fn clone(this: Data, allocator: std.mem.Allocator) OOM!Data {
        return Data{
            .text = if (this.text.len > 0) try allocator.dupe(u8, this.text) else "",
            .location = if (this.location != null) try this.location.?.clone(allocator) else null,
        };
    }

    pub fn cloneWithBuilder(this: Data, builder: *StringBuilder) Data {
        return Data{
            .text = if (this.text.len > 0) builder.append(this.text) else "",
            .location = if (this.location != null) this.location.?.cloneWithBuilder(builder) else null,
        };
    }

    pub fn count(this: Data, builder: *StringBuilder) void {
        builder.count(this.text);
        if (this.location) |loc| loc.count(builder);
    }

    pub fn toAPI(this: *const Data) Api.MessageData {
        return Api.MessageData{
            .text = this.text,
            .location = if (this.location != null) this.location.?.toAPI() else null,
        };
    }

    pub fn writeFormat(
        this: *const Data,
        to: anytype,
        kind: Kind,
        redact_sensitive_information: bool,
        comptime enable_ansi_colors: bool,
    ) !void {
        if (this.text.len == 0) return;

        const message_color = switch (kind) {
            .err => comptime Output.color_map.get("b").?,
            .note => comptime Output.color_map.get("blue").?,
            else => comptime Output.color_map.get("d").? ++ Output.color_map.get("b").?,
        };

        const color_name: string = switch (kind) {
            .err => comptime Output.color_map.get("red").?,
            .note => comptime Output.color_map.get("blue").?,
            else => comptime Output.color_map.get("d").?,
        };

        if (this.location) |*location| {
            if (location.line_text) |line_text_| {
                const line_text_right_trimmed = std.mem.trimRight(u8, line_text_, " \r\n\t");
                const line_text = std.mem.trimLeft(u8, line_text_right_trimmed, "\n\r");
                if (location.column > -1 and line_text.len > 0) {
                    var line_offset_for_second_line: usize = @intCast(location.column - 1);

                    if (location.line > -1) {
                        switch (kind == .err or kind == .warn) {
                            inline else => |bold| try to.print(
                                // bold the line number for error but dim for the attached note
                                if (bold)
                                    comptime Output.prettyFmt("<b>{d} | <r>", enable_ansi_colors)
                                else
                                    comptime Output.prettyFmt("<d>{d} | <r>", enable_ansi_colors),
                                .{
                                    location.line,
                                },
                            ),
                        }

                        line_offset_for_second_line += std.fmt.count("{d} | ", .{location.line});
                    }

                    try to.print("{}\n", .{bun.fmt.fmtJavaScript(line_text, .{
                        .enable_colors = enable_ansi_colors,
                        .redact_sensitive_information = redact_sensitive_information,
                    })});

                    try to.writeByteNTimes(' ', line_offset_for_second_line);
                    if ((comptime enable_ansi_colors) and message_color.len > 0) {
                        try to.writeAll(message_color);
                        try to.writeAll(color_name);
                        // always bold the ^
                        try to.writeAll(comptime Output.color_map.get("b").?);

                        try to.writeByte('^');

                        try to.writeAll("\x1b[0m\n");
                    } else {
                        try to.writeAll("^\n");
                    }
                }
            }
        }

        if (comptime enable_ansi_colors) {
            try to.writeAll(color_name);
        }

        try to.writeAll(kind.string());

        try to.print(comptime Output.prettyFmt("<r><d>: <r>", enable_ansi_colors), .{});

        if (comptime enable_ansi_colors) {
            try to.writeAll(message_color);
        }

        try to.print(comptime Output.prettyFmt("{s}<r>", enable_ansi_colors), .{this.text});

        if (this.location) |*location| {
            if (location.file.len > 0) {
                try to.writeAll("\n");
                try to.writeByteNTimes(' ', (kind.string().len + ": ".len) - "at ".len);

                try to.print(comptime Output.prettyFmt("<d>at <r><cyan>{s}<r>", enable_ansi_colors), .{
                    location.file,
                });

                if (location.line > 0 and location.column > -1) {
                    try to.print(comptime Output.prettyFmt("<d>:<r><yellow>{d}<r><d>:<r><yellow>{d}<r>", enable_ansi_colors), .{
                        location.line,
                        location.column,
                    });
                } else if (location.line > -1) {
                    try to.print(comptime Output.prettyFmt("<d>:<r><yellow>{d}<r>", enable_ansi_colors), .{
                        location.line,
                    });
                }

                if (Environment.isDebug) {
                    // comptime magic: do not print byte when using Bun.inspect, but only print
                    // when you the writer is to a file (like standard out)
                    if ((comptime std.mem.indexOf(u8, @typeName(@TypeOf(to)), "fs.file") != null) and Output.enable_ansi_colors_stderr) {
                        try to.print(comptime Output.prettyFmt(" <d>byte={d}<r>", enable_ansi_colors), .{
                            location.offset,
                        });
                    }
                }
            }
        }
    }
};

pub const BabyString = packed struct(u32) {
    offset: u16,
    len: u16,

    pub fn in(parent: string, text: string) BabyString {
        return BabyString{
            .offset = @as(u16, @truncate(std.mem.indexOf(u8, parent, text) orelse unreachable)),
            .len = @as(u16, @truncate(text.len)),
        };
    }

    pub fn slice(this: BabyString, container: string) string {
        return container[this.offset..][0..this.len];
    }
};

pub const Msg = struct {
    kind: Kind = Kind.err,
    data: Data,
    metadata: Metadata = .build,
    notes: []Data = &.{},
    redact_sensitive_information: bool = false,

    pub fn memoryCost(this: *const Msg) usize {
        var cost: usize = 0;
        cost += this.data.memoryCost();
        for (this.notes) |*note| {
            cost += note.memoryCost();
        }
        return cost;
    }

    pub fn fromJS(allocator: std.mem.Allocator, globalObject: *bun.JSC.JSGlobalObject, file: string, err: bun.JSC.JSValue) bun.JSError!Msg {
        var zig_exception_holder: bun.JSC.ZigException.Holder = bun.JSC.ZigException.Holder.init();
        if (err.toError()) |value| {
            value.toZigException(globalObject, zig_exception_holder.zigException());
        } else {
            zig_exception_holder.zigException().message = try err.toBunString(globalObject);
        }

        return Msg{
            .data = .{
                .text = try zig_exception_holder.zigException().message.toOwnedSlice(allocator),
                .location = Location{
                    .file = file,
                    .line = 0,
                    .column = 0,
                },
            },
        };
    }

    pub fn toJS(this: Msg, globalObject: *bun.JSC.JSGlobalObject, allocator: std.mem.Allocator) bun.OOM!JSC.JSValue {
        return switch (this.metadata) {
            .build => bun.api.BuildMessage.create(globalObject, allocator, this),
            .resolve => bun.api.ResolveMessage.create(globalObject, allocator, this, ""),
        };
    }

    pub fn count(this: *const Msg, builder: *StringBuilder) void {
        this.data.count(builder);
        for (this.notes) |note| {
            note.count(builder);
        }
    }

    pub fn clone(this: *const Msg, allocator: std.mem.Allocator) OOM!Msg {
        return Msg{
            .kind = this.kind,
            .data = try this.data.clone(allocator),
            .metadata = this.metadata,
            .notes = try bun.clone(this.notes, allocator),
        };
    }

    pub fn cloneWithBuilder(this: *const Msg, notes: []Data, builder: *StringBuilder) Msg {
        return Msg{
            .kind = this.kind,
            .data = this.data.cloneWithBuilder(builder),
            .metadata = this.metadata,
            .notes = if (this.notes.len > 0) brk: {
                for (this.notes, 0..) |note, i| {
                    notes[i] = note.cloneWithBuilder(builder);
                }
                break :brk notes[0..this.notes.len];
            } else &.{},
        };
    }

    pub const Metadata = union(enum) {
        build,
        resolve: Resolve,

        pub const Resolve = struct {
            specifier: BabyString,
            import_kind: ImportKind,
            err: anyerror = error.ModuleNotFound,
        };
    };

    pub fn toAPI(this: *const Msg, allocator: std.mem.Allocator) OOM!Api.Message {
        var notes = try allocator.alloc(
            Api.MessageData,
            this.notes.len,
        );
        const msg = Api.Message{
            .level = this.kind.toAPI(),
            .data = this.data.toAPI(),
            .notes = notes,
            .on = Api.MessageMeta{
                .resolve = if (this.metadata == .resolve) this.metadata.resolve.specifier.slice(this.data.text) else "",
                .build = this.metadata == .build,
            },
        };

        for (this.notes, 0..) |note, i| {
            notes[i] = note.toAPI();
        }

        return msg;
    }

    pub fn toAPIFromList(comptime ListType: type, list: ListType, allocator: std.mem.Allocator) OOM![]Api.Message {
        var out_list = try allocator.alloc(Api.Message, list.items.len);
        for (list.items, 0..) |item, i| {
            out_list[i] = try item.toAPI(allocator);
        }

        return out_list;
    }

    pub fn deinit(msg: *Msg, allocator: std.mem.Allocator) void {
        msg.data.deinit(allocator);
        for (msg.notes) |*note| {
            note.deinit(allocator);
        }

        allocator.free(msg.notes);

        msg.notes = &.{};
    }

    pub fn writeFormat(
        msg: *const Msg,
        to: anytype,
        comptime enable_ansi_colors: bool,
    ) !void {
        try msg.data.writeFormat(to, msg.kind, msg.redact_sensitive_information, enable_ansi_colors);

        if (msg.notes.len > 0) {
            try to.writeAll("\n");
        }

        for (msg.notes) |note| {
            try to.writeAll("\n");

            try note.writeFormat(to, .note, msg.redact_sensitive_information, enable_ansi_colors);
        }
    }

    pub fn formatWriter(
        msg: *const Msg,
        comptime Writer: type,
        writer: Writer,
        comptime _: bool,
    ) !void {
        if (msg.data.location) |location| {
            try writer.print("{s}: {s}\n{s}\n{s}:{}:{} ({d})", .{
                msg.kind.string(),
                msg.data.text,
                location.line_text orelse "",
                location.file,
                location.line,
                location.column,
                location.offset,
            });
        } else {
            try writer.print("{s}: {s}", .{
                msg.kind.string(),
                msg.data.text,
            });
        }
    }

    pub fn formatNoWriter(msg: *const Msg, comptime formatterFunc: @TypeOf(Output.panic)) void {
        formatterFunc("\n\n{s}: {s}\n{s}\n{s}:{}:{} ({d})", .{
            msg.kind.string(),
            msg.data.text,
            msg.data.location.?.line_text,
            msg.data.location.?.file,
            msg.data.location.?.line,
            msg.data.location.?.column,
            msg.data.location.?.offset,
        });
    }
};

// Do not mark these as packed
// https://github.com/ziglang/zig/issues/15715
pub const Range = struct {
    loc: Loc = Loc.Empty,
    len: i32 = 0,

    /// Deprecated: use .none
    pub const None = none;
    pub const none = Range{ .loc = Loc.Empty, .len = 0 };

    pub fn in(this: Range, buf: []const u8) []const u8 {
        if (this.loc.start < 0 or this.len <= 0) return "";
        const slice = buf[@as(usize, @intCast(this.loc.start))..];
        return slice[0..@min(@as(usize, @intCast(this.len)), buf.len)];
    }

    pub fn contains(this: Range, k: i32) bool {
        return k >= this.loc.start and k < this.loc.start + this.len;
    }

    pub fn isEmpty(r: *const Range) bool {
        return r.len == 0 and r.loc.start == Loc.Empty.start;
    }

    pub fn end(self: *const Range) Loc {
        return Loc{ .start = self.loc.start + self.len };
    }
    pub fn endI(self: *const Range) usize {
        return std.math.lossyCast(usize, self.loc.start + self.len);
    }

    pub fn jsonStringify(self: *const Range, writer: anytype) !void {
        return try writer.write([2]i32{ self.loc.start, self.len + self.loc.start });
    }
};

pub const Log = struct {
    warnings: u32 = 0,
    errors: u32 = 0,
    msgs: std.ArrayList(Msg),
    level: Level = if (Environment.isDebug) Level.info else Level.warn,

    clone_line_text: bool = false,

    pub fn memoryCost(this: *const Log) usize {
        var cost: usize = 0;
        for (this.msgs.items) |msg| {
            cost += msg.memoryCost();
        }
        return cost;
    }

    pub inline fn hasErrors(this: *const Log) bool {
        return this.errors > 0;
    }

    pub fn reset(this: *Log) void {
        this.msgs.clearRetainingCapacity();
        this.warnings = 0;
        this.errors = 0;
    }

    pub var default_log_level = Level.warn;

    pub fn hasAny(this: *const Log) bool {
        return (this.warnings + this.errors) > 0;
    }

    pub fn toAPI(this: *const Log, allocator: std.mem.Allocator) !Api.Log {
        var warnings: u32 = 0;
        var errors: u32 = 0;
        for (this.msgs.items) |msg| {
            errors += @as(u32, @intCast(@intFromBool(msg.kind == .err)));
            warnings += @as(u32, @intCast(@intFromBool(msg.kind == .warn)));
        }

        return Api.Log{
            .warnings = warnings,
            .errors = errors,
            .msgs = try Msg.toAPIFromList(@TypeOf(this.msgs), this.msgs, allocator),
        };
    }

    pub const Level = enum(i8) {
        verbose, // 0
        debug, // 1
        info, // 2
        warn, //  3
        err, // 4

        pub fn atLeast(this: Level, other: Level) bool {
            return @intFromEnum(this) <= @intFromEnum(other);
        }

        pub const label: std.EnumArray(Level, string) = brk: {
            var map = std.EnumArray(Level, string).initFill("");
            map.set(Level.verbose, "verbose");
            map.set(Level.debug, "debug");
            map.set(Level.info, "info");
            map.set(Level.warn, "warn");
            map.set(Level.err, "error");
            break :brk map;
        };
        pub const Map = bun.ComptimeStringMap(Level, .{
            .{ "verbose", Level.verbose },
            .{ "debug", Level.debug },
            .{ "info", Level.info },
            .{ "warn", Level.warn },
            .{ "error", Level.err },
        });

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) JSError!?Level {
            if (value == .zero or value.isUndefined()) {
                return null;
            }

            if (!value.isString()) {
                return globalThis.throwInvalidArguments("Expected logLevel to be a string", .{});
            }

            return Map.fromJS(globalThis, value);
        }
    };

    pub fn init(allocator: std.mem.Allocator) Log {
        return Log{
            .msgs = std.ArrayList(Msg).init(allocator),
            .level = default_log_level,
        };
    }

    pub fn initComptime(allocator: std.mem.Allocator) Log {
        return Log{
            .msgs = std.ArrayList(Msg).init(allocator),
        };
    }

    pub fn addDebugFmt(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        if (Kind.shouldPrint(.debug, log.level)) {
            @branchHint(.cold);
            try log.addMsg(.{
                .kind = .debug,
                .data = try rangeData(source, Range{ .loc = l }, try allocPrint(allocator, text, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
            });
        }
    }

    pub fn addVerbose(log: *Log, source: ?*const Source, loc: Loc, text: string) OOM!void {
        if (Kind.shouldPrint(.verbose, log.level)) {
            @branchHint(.cold);
            try log.addMsg(.{
                .kind = .verbose,
                .data = rangeData(source, Range{ .loc = loc }, text),
            });
        }
    }

    pub fn toJS(this: Log, global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, message: string) bun.OOM!JSC.JSValue {
        const msgs: []const Msg = this.msgs.items;
        var errors_stack: [256]JSC.JSValue = undefined;

        const count = @as(u16, @intCast(@min(msgs.len, errors_stack.len)));
        switch (count) {
            0 => return .js_undefined,
            1 => {
                const msg = msgs[0];
                return switch (msg.metadata) {
                    .build => bun.api.BuildMessage.create(global, allocator, msg),
                    .resolve => bun.api.ResolveMessage.create(global, allocator, msg, ""),
                };
            },
            else => {
                for (msgs[0..count], 0..) |msg, i| {
                    errors_stack[i] = switch (msg.metadata) {
                        .build => try bun.api.BuildMessage.create(global, allocator, msg),
                        .resolve => try bun.api.ResolveMessage.create(global, allocator, msg, ""),
                    };
                }
                const out = JSC.ZigString.init(message);
                const agg = global.createAggregateError(errors_stack[0..count], &out);
                return agg;
            },
        }
    }

    /// unlike toJS, this always produces an AggregateError object
    pub fn toJSAggregateError(this: Log, global: *JSC.JSGlobalObject, message: bun.String) bun.JSError!JSC.JSValue {
        return global.createAggregateErrorWithArray(message, try this.toJSArray(global, bun.default_allocator));
    }

    pub fn toJSArray(this: Log, global: *JSC.JSGlobalObject, allocator: std.mem.Allocator) bun.JSError!JSC.JSValue {
        const msgs: []const Msg = this.msgs.items;

        const arr = try JSC.JSValue.createEmptyArray(global, msgs.len);
        for (msgs, 0..) |msg, i| {
            arr.putIndex(global, @as(u32, @intCast(i)), try msg.toJS(global, allocator));
        }

        return arr;
    }

    pub fn cloneTo(self: *Log, other: *Log) OOM!void {
        var notes_count: usize = 0;

        for (self.msgs.items) |msg_| {
            const msg: Msg = msg_;
            for (msg.notes) |note| {
                notes_count += @as(usize, @intCast(@intFromBool(note.text.len > 0)));
            }
        }

        if (notes_count > 0) {
            var notes = try other.msgs.allocator.alloc(Data, notes_count);
            var note_i: usize = 0;
            for (self.msgs.items) |*msg| {
                const start_note_i: usize = note_i;
                for (msg.notes) |note| {
                    notes[note_i] = note;
                    note_i += 1;
                }
                msg.notes = notes[start_note_i..note_i];
            }
        }

        try other.msgs.appendSlice(self.msgs.items);
        other.warnings += self.warnings;
        other.errors += self.errors;
    }

    pub fn appendTo(self: *Log, other: *Log) OOM!void {
        try self.cloneTo(other);
        self.msgs.clearAndFree();
    }

    pub fn cloneToWithRecycled(self: *Log, other: *Log, recycled: bool) OOM!void {
        try other.msgs.appendSlice(self.msgs.items);
        other.warnings += self.warnings;
        other.errors += self.errors;

        if (recycled) {
            var string_builder = StringBuilder{};
            var notes_count: usize = 0;
            {
                for (self.msgs.items) |msg| {
                    msg.count(&string_builder);

                    notes_count += msg.notes.len;
                }
            }

            try string_builder.allocate(other.msgs.allocator);
            var notes_buf = try other.msgs.allocator.alloc(Data, notes_count);
            var note_i: usize = 0;

            {
                for (self.msgs.items, (other.msgs.items.len - self.msgs.items.len)..) |msg, j| {
                    other.msgs.items[j] = msg.cloneWithBuilder(notes_buf[note_i..], &string_builder);
                    note_i += msg.notes.len;
                }
            }
        }
    }

    pub fn appendToWithRecycled(self: *Log, other: *Log, recycled: bool) OOM!void {
        try self.cloneToWithRecycled(other, recycled);
        self.msgs.clearAndFree();
    }

    pub fn appendToMaybeRecycled(self: *Log, other: *Log, source: *const Source) OOM!void {
        return self.appendToWithRecycled(other, source.contents_is_recycled);
    }

    pub fn deinit(log: *Log) void {
        log.msgs.clearAndFree();
        // log.warnings = 0;
        // log.errors = 0;
    }

    // TODO: remove `deinit` because it does not de-initialize the log; it clears it
    pub const clearAndFree = deinit;

    pub fn addVerboseWithNotes(log: *Log, source: ?*const Source, loc: Loc, text: string, notes: []Data) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.verbose, log.level)) return;

        try log.addMsg(.{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
            .notes = notes,
        });
    }

    pub inline fn allocPrint(allocator: std.mem.Allocator, comptime fmt: string, args: anytype) OOM!string {
        return switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| std.fmt.allocPrint(allocator, Output.prettyFmt(fmt, enable_ansi_colors), args),
        };
    }

    inline fn addResolveErrorWithLevel(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        comptime dupe_text: bool,
        comptime kind: enum { err, warn },
        err: anyerror,
    ) OOM!void {
        const text = try allocPrint(allocator, fmt, args);
        // TODO: fix this. this is stupid, it should be returned in allocPrint.
        const specifier = BabyString.in(text, args.@"0");
        if (comptime kind == .err) {
            log.errors += 1;
        } else {
            log.warnings += 1;
        }

        const data = if (comptime dupe_text) brk: {
            var _data = rangeData(
                source,
                r,
                text,
            );
            if (_data.location != null) {
                if (_data.location.?.line_text) |line| {
                    _data.location.?.line_text = try allocator.dupe(u8, line);
                }
            }
            break :brk _data;
        } else rangeData(
            source,
            r,
            text,
        );

        const msg = Msg{
            // .kind = if (comptime error_type == .err) Kind.err else Kind.warn,
            .kind = @field(Kind, @tagName(kind)),
            .data = data,
            .metadata = .{ .resolve = Msg.Metadata.Resolve{
                .specifier = specifier,
                .import_kind = import_kind,
                .err = err,
            } },
        };

        try log.addMsg(msg);
    }

    pub fn addResolveError(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        err: anyerror,
    ) OOM!void {
        @branchHint(.cold);
        return try addResolveErrorWithLevel(log, source, r, allocator, fmt, args, import_kind, false, .err, err);
    }

    pub fn addResolveErrorWithTextDupe(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
    ) OOM!void {
        @branchHint(.cold);
        return try addResolveErrorWithLevel(log, source, r, allocator, fmt, args, import_kind, true, .err, error.ModuleNotFound);
    }

    pub fn addRangeError(log: *Log, source: ?*const Source, r: Range, text: string) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeErrorFmt(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, r, try allocPrint(allocator, text, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addRangeErrorFmtWithNotes(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, notes: []Data, comptime fmt: string, args: anytype) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, r, try allocPrint(allocator, fmt, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
            .notes = notes,
        });
    }

    pub fn addErrorFmt(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, .{ .loc = l }, try allocPrint(allocator, text, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    // TODO(dylan-conway): rename and replace `addErrorFmt`
    pub fn addErrorFmtOpts(log: *Log, allocator: std.mem.Allocator, comptime fmt: string, args: anytype, opts: AddErrorOptions) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(
                opts.source,
                .{ .loc = opts.loc, .len = opts.len },
                try allocPrint(allocator, fmt, args),
            ).cloneLineText(log.clone_line_text, log.msgs.allocator),
            .redact_sensitive_information = opts.redact_sensitive_information,
        });
    }

    // Use a bun.sys.Error's message in addition to some extra context.
    pub fn addSysError(log: *Log, alloc: std.mem.Allocator, e: bun.sys.Error, comptime fmt: string, args: anytype) OOM!void {
        const tag_name, const sys_errno = e.getErrorCodeTagName() orelse {
            try log.addErrorFmt(null, Loc.Empty, alloc, fmt, args);
            return;
        };
        try log.addErrorFmt(
            null,
            Loc.Empty,
            alloc,
            "{s}: " ++ fmt,
            .{bun.sys.coreutils_error_map.get(sys_errno) orelse tag_name} ++ args,
        );
    }

    pub fn addZigErrorWithNote(log: *Log, allocator: std.mem.Allocator, err: anyerror, comptime noteFmt: string, args: anytype) OOM!void {
        @branchHint(.cold);
        log.errors += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(null, Range.None, try allocPrint(allocator, noteFmt, args));

        try log.addMsg(.{
            .kind = .err,
            .data = rangeData(null, Range.None, @errorName(err)),
            .notes = notes,
        });
    }

    pub fn addRangeWarning(log: *Log, source: ?*const Source, r: Range, text: string) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, r, text).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addWarningFmt(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, Range{ .loc = l }, try allocPrint(allocator, text, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addWarningFmtLineCol(log: *Log, filepath: []const u8, line: u32, col: u32, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        @branchHint(.cold);
        return log.addWarningFmtLineColWithNotes(filepath, line, col, allocator, text, args, &[_]Data{});
    }

    pub fn addWarningFmtLineColWithNotes(log: *Log, filepath: []const u8, line: u32, col: u32, allocator: std.mem.Allocator, comptime text: string, args: anytype, notes: []Data) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;

        // TODO: do this properly

        try log.addMsg(.{
            .kind = .warn,
            .data = try Data.cloneLineText(
                Data{
                    .text = try allocPrint(allocator, text, args),
                    .location = Location{
                        .file = filepath,
                        .line = @intCast(line),
                        .column = @intCast(col),
                    },
                },
                log.clone_line_text,
                allocator,
            ),
            .notes = notes,
        });
    }

    // pub fn addWarningFmtLineColWithNote(log: *Log, filepath: []const u8, line: u32, col: u32, allocator: std.mem.Allocator, comptime text: string, args: anytype, comptime note_fmt: string, note_args: anytype, note_range: Range) OOM!void {
    //     @branchHint(.cold);
    //     if (!Kind.shouldPrint(.warn, log.level)) return;
    //     log.warnings += 1;

    //     var notes = try allocator.alloc(Data, 1);
    //     notes[0] = Data{
    //         .text = try allocPrint(allocator, note_fmt, note_args),
    //         .lcoation = Location{
    //             .file = filepath,
    //             .line = @intCast(line),
    //             .column = @intCast(col),
    //         },
    //     };

    //     try log.addMsg(.{
    //         .kind = .warn,
    //         .data = try Data.cloneLineText(
    //             Data{
    //                 .text = try allocPrint(allocator, text, args),
    //                 .location = Location{
    //                     .file = filepath,
    //                     .line = @intCast(line),
    //                     .column = @intCast(col),
    //                 },
    //             },
    //             log.clone_line_text,
    //             allocator,
    //         ),
    //         .notes = notes,
    //     });
    // }

    pub fn addRangeWarningFmt(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, comptime text: string, args: anytype) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, r, try allocPrint(allocator, text, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addRangeWarningFmtWithNote(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        comptime note_fmt: string,
        note_args: anytype,
        note_range: Range,
    ) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(source, note_range, try allocPrint(allocator, note_fmt, note_args));

        try log.addMsg(.{
            .kind = .warn,
            .data = rangeData(source, r, try allocPrint(allocator, fmt, args)),
            .notes = notes,
        });
    }

    pub fn addRangeWarningFmtWithNotes(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, notes: []Data, comptime fmt: string, args: anytype) OOM!void {
        @branchHint(.cold);
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, r, try allocPrint(allocator, fmt, args)).cloneLineText(log.clone_line_text, log.msgs.allocator),
            .notes = notes,
        });
    }

    pub fn addRangeErrorFmtWithNote(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        comptime note_fmt: string,
        note_args: anytype,
        note_range: Range,
    ) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.err, log.level)) return;
        log.errors += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(source, note_range, try allocPrint(allocator, note_fmt, note_args));

        try log.addMsg(.{
            .kind = .err,
            .data = rangeData(source, r, try allocPrint(allocator, fmt, args)),
            .notes = notes,
        });
    }

    pub fn addWarning(log: *Log, source: ?*const Source, l: Loc, text: string) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = rangeData(source, Range{ .loc = l }, text),
        });
    }

    pub fn addWarningWithNote(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, warn: string, comptime note_fmt: string, note_args: anytype) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(source, Range{ .loc = l }, try allocPrint(allocator, note_fmt, note_args));

        try log.addMsg(.{
            .kind = .warn,
            .data = rangeData(null, Range.None, warn),
            .notes = notes,
        });
    }

    pub fn addRangeDebug(log: *Log, source: ?*const Source, r: Range, text: string) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.debug, log.level)) return;
        try log.addMsg(.{
            .kind = .debug,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeDebugWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.debug, log.level)) return;
        // log.de += 1;
        try log.addMsg(.{
            .kind = Kind.debug,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeErrorWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) OOM!void {
        @branchHint(.cold);
        log.errors += 1;
        try log.addMsg(.{
            .kind = Kind.err,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeWarningWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) OOM!void {
        @branchHint(.cold);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warning,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addMsg(self: *Log, msg: Msg) OOM!void {
        try self.msgs.append(msg);
    }

    pub fn addError(self: *Log, _source: ?*const Source, loc: Loc, text: string) OOM!void {
        @branchHint(.cold);
        self.errors += 1;
        try self.addMsg(.{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
    }

    const AddErrorOptions = struct {
        source: ?*const Source = null,
        loc: Loc = Loc.Empty,
        len: i32 = 0,
        redact_sensitive_information: bool = false,
    };

    // TODO(dylan-conway): rename and replace `addError`
    pub fn addErrorOpts(self: *Log, text: string, opts: AddErrorOptions) OOM!void {
        @branchHint(.cold);
        self.errors += 1;
        try self.addMsg(.{
            .kind = .err,
            .data = rangeData(opts.source, .{ .loc = opts.loc, .len = opts.len }, text),
            .redact_sensitive_information = opts.redact_sensitive_information,
        });
    }

    pub fn addSymbolAlreadyDeclaredError(self: *Log, allocator: std.mem.Allocator, source: *const Source, name: string, new_loc: Loc, old_loc: Loc) OOM!void {
        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(
            source,
            source.rangeOfIdentifier(old_loc),
            try std.fmt.allocPrint(allocator, "\"{s}\" was originally declared here", .{name}),
        );

        try self.addRangeErrorFmtWithNotes(
            source,
            source.rangeOfIdentifier(new_loc),
            allocator,
            notes,
            "\"{s}\" has already been declared",
            .{name},
        );
    }

    pub fn print(self: *const Log, to: anytype) !void {
        return switch (Output.enable_ansi_colors) {
            inline else => |enable_ansi_colors| self.printWithEnableAnsiColors(to, enable_ansi_colors),
        };
    }

    pub fn printWithEnableAnsiColors(self: *const Log, to: anytype, comptime enable_ansi_colors: bool) !void {
        var needs_newline = false;
        if (self.warnings > 0 and self.errors > 0) {
            // Print warnings at the top
            // errors at the bottom
            // This is so if you're reading from a terminal
            // and there are a bunch of warnings
            // You can more easily see where the errors are
            for (self.msgs.items) |*msg| {
                if (msg.kind != .err) {
                    if (msg.kind.shouldPrint(self.level)) {
                        if (needs_newline) try to.writeAll("\n\n");
                        try msg.writeFormat(to, enable_ansi_colors);
                        needs_newline = true;
                    }
                }
            }

            for (self.msgs.items) |*msg| {
                if (msg.kind == .err) {
                    if (msg.kind.shouldPrint(self.level)) {
                        if (needs_newline) try to.writeAll("\n\n");
                        try msg.writeFormat(to, enable_ansi_colors);
                        needs_newline = true;
                    }
                }
            }
        } else {
            for (self.msgs.items) |*msg| {
                if (msg.kind.shouldPrint(self.level)) {
                    if (needs_newline) try to.writeAll("\n\n");
                    try msg.writeFormat(to, enable_ansi_colors);
                    needs_newline = true;
                }
            }
        }

        if (needs_newline) _ = try to.write("\n");
    }

    pub fn toZigException(this: *const Log, allocator: std.mem.Allocator) *js.ZigException.Holder {
        var holder = try allocator.create(js.ZigException.Holder);
        holder.* = js.ZigException.Holder.init();
        var zig_exception: *js.ZigException = holder.zigException();
        zig_exception.exception = this;
        zig_exception.code = js.JSErrorCode.BundlerError;
        return holder;
    }
};

pub inline fn usize2Loc(loc: usize) Loc {
    return Loc{ .start = @as(i32, @intCast(loc)) };
}

pub const Source = struct {
    path: fs.Path,

    contents: string,
    contents_is_recycled: bool = false,

    /// Lazily-generated human-readable identifier name that is non-unique
    /// Avoid accessing this directly most of the  time
    identifier_name: string = "",

    index: Index = Index.source(0),

    pub fn fmtIdentifier(this: *const Source) bun.fmt.FormatValidIdentifier {
        return this.path.name.fmtIdentifier();
    }

    pub fn identifierName(this: *Source, allocator: std.mem.Allocator) !string {
        if (this.identifier_name.len > 0) {
            return this.identifier_name;
        }

        bun.assert(this.path.text.len > 0);
        const name = try this.path.name.nonUniqueNameString(allocator);
        this.identifier_name = name;
        return name;
    }

    pub fn rangeOfIdentifier(this: *const Source, loc: Loc) Range {
        const js_lexer = @import("./js_lexer.zig");
        return js_lexer.rangeOfIdentifier(this, loc);
    }

    pub fn isWebAssembly(this: *const Source) bool {
        if (this.contents.len < 4) return false;

        const bytes = @as(u32, @bitCast(this.contents[0..4].*));
        return bytes == 0x6d736100; // "\0asm"
    }

    pub const ErrorPosition = struct {
        line_start: usize,
        line_end: usize,
        column_count: usize,
        line_count: usize,
    };

    pub fn initEmptyFile(filepath: string) Source {
        const path = fs.Path.init(filepath);
        return Source{ .path = path, .contents = "" };
    }

    pub fn initFile(file: fs.PathContentsPair, _: std.mem.Allocator) !Source {
        var source = Source{
            .path = file.path,
            .contents = file.contents,
        };
        source.path.namespace = "file";
        return source;
    }

    pub fn initRecycledFile(file: fs.PathContentsPair, _: std.mem.Allocator) !Source {
        var source = Source{
            .path = file.path,
            .contents = file.contents,
            .contents_is_recycled = true,
        };
        source.path.namespace = "file";

        return source;
    }

    pub fn initPathString(pathString: string, contents: string) Source {
        const path = fs.Path.init(pathString);
        return Source{ .path = path, .contents = contents };
    }

    pub fn textForRange(self: *const Source, r: Range) string {
        return self.contents[r.loc.i()..r.endI()];
    }

    pub fn rangeOfOperatorBefore(self: *const Source, loc: Loc, op: string) Range {
        const text = self.contents[0..loc.i()];
        const index = strings.index(text, op);
        if (index >= 0) {
            return Range{ .loc = Loc{
                .start = loc.start + index,
            }, .len = @as(i32, @intCast(op.len)) };
        }

        return Range{ .loc = loc };
    }

    pub fn rangeOfString(self: *const Source, loc: Loc) Range {
        if (loc.start < 0) return Range.None;

        const text = self.contents[loc.i()..];

        if (text.len == 0) {
            return Range.None;
        }

        const quote = text[0];

        if (quote == '"' or quote == '\'') {
            var i: usize = 1;
            var c: u8 = 0;
            while (i < text.len) {
                c = text[i];

                if (c == quote) {
                    return Range{ .loc = loc, .len = @as(i32, @intCast(i + 1)) };
                } else if (c == '\\') {
                    i += 1;
                }
                i += 1;
            }
        }

        return Range{ .loc = loc, .len = 0 };
    }

    pub fn rangeOfOperatorAfter(self: *const Source, loc: Loc, op: string) Range {
        const text = self.contents[loc.i()..];
        const index = strings.index(text, op);
        if (index >= 0) {
            return Range{ .loc = Loc{
                .start = loc.start + index,
            }, .len = op.len };
        }

        return Range{ .loc = loc };
    }

    pub fn initErrorPosition(self: *const Source, offset_loc: Loc) ErrorPosition {
        bun.assert(!offset_loc.isEmpty());
        var prev_code_point: i32 = 0;
        const offset: usize = @min(@as(usize, @intCast(offset_loc.start)), @max(self.contents.len, 1) - 1);

        const contents = self.contents;

        var iter_ = strings.CodepointIterator{
            .bytes = self.contents[0..offset],
            .i = 0,
        };
        var iter = strings.CodepointIterator.Cursor{};

        var line_start: usize = 0;
        var line_count: usize = 1;
        var column_number: usize = 1;

        while (iter_.next(&iter)) {
            switch (iter.c) {
                '\n' => {
                    column_number = 1;
                    line_start = iter.width + iter.i;
                    if (prev_code_point != '\r') {
                        line_count += 1;
                    }
                },

                '\r' => {
                    column_number = 0;
                    line_start = iter.width + iter.i;
                    line_count += 1;
                },

                0x2028, 0x2029 => {
                    line_start = iter.width + iter.i; // These take three bytes to encode in UTF-8
                    line_count += 1;
                    column_number = 1;
                },
                else => {
                    column_number += 1;
                },
            }

            prev_code_point = iter.c;
        }

        iter_ = strings.CodepointIterator{
            .bytes = self.contents[offset..],
            .i = 0,
        };

        iter = strings.CodepointIterator.Cursor{};
        // Scan to the end of the line (or end of file if this is the last line)
        var line_end: usize = contents.len;

        loop: while (iter_.next(&iter)) {
            switch (iter.c) {
                '\r', '\n', 0x2028, 0x2029 => {
                    line_end = offset + iter.i;
                    break :loop;
                },
                else => {},
            }
        }

        return ErrorPosition{
            .line_start = if (line_start > 0) line_start - 1 else line_start,
            .line_end = line_end,
            .line_count = line_count,
            .column_count = column_number,
        };
    }
    pub fn lineColToByteOffset(source_contents: []const u8, start_line: usize, start_col: usize, line: usize, col: usize) ?usize {
        var iter_ = strings.CodepointIterator{
            .bytes = source_contents,
            .i = 0,
        };
        var iter = strings.CodepointIterator.Cursor{};

        var line_count: usize = start_line;
        var column_number: usize = start_col;

        _ = iter_.next(&iter);
        while (true) {
            const c = iter.c;
            if (!iter_.next(&iter)) break;
            switch (c) {
                '\n' => {
                    column_number = 1;
                    line_count += 1;
                },

                '\r' => {
                    column_number = 1;
                    line_count += 1;
                    if (iter.c == '\n') {
                        _ = iter_.next(&iter);
                    }
                },

                0x2028, 0x2029 => {
                    line_count += 1;
                    column_number = 1;
                },
                else => {
                    column_number += 1;
                },
            }

            if (line_count == line and column_number == col) return iter.i;
            if (line_count > line) return null;
        }
        return null;
    }
};

pub fn rangeData(source: ?*const Source, r: Range, text: string) Data {
    return Data{ .text = text, .location = Location.initOrNull(source, r) };
}
