const std = @import("std");
const Api = @import("./api/schema.zig").Api;
const js = @import("root").bun.JSC;
const ImportKind = @import("./import_record.zig").ImportKind;
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
const JSC = @import("root").bun.JSC;
const fs = @import("fs.zig");
const unicode = std.unicode;
const Ref = @import("./ast/base.zig").Ref;
const expect = std.testing.expect;
const assert = std.debug.assert;
const ArrayList = std.ArrayList;
const StringBuilder = @import("./string_builder.zig");
const Index = @import("./ast/base.zig").Index;
pub const Kind = enum(i8) {
    err,
    warn,
    note,
    debug,
    verbose,

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

pub const Loc = packed struct(i32) {
    start: i32 = -1,

    pub inline fn toNullable(loc: *Loc) ?Loc {
        return if (loc.start == -1) null else loc.*;
    }

    pub const toUsize = i;

    pub inline fn i(self: *const Loc) usize {
        return @intCast(usize, @max(self.start, 0));
    }

    pub const Empty = Loc{ .start = -1 };

    pub inline fn eql(loc: Loc, other: Loc) bool {
        return loc.start == other.start;
    }

    pub fn jsonStringify(self: *const Loc, options: anytype, writer: anytype) !void {
        return try std.json.stringify(self.start, options, writer);
    }
};

pub const Location = struct {
    file: string = "",
    namespace: string = "file",
    line: i32 = 1, // 1-based
    column: i32 = 0, // 0-based, in bytes
    length: usize = 0, // in bytes
    line_text: ?string = null,
    suggestion: ?string = null,
    offset: usize = 0,

    pub fn count(this: Location, builder: *StringBuilder) void {
        builder.count(this.file);
        builder.count(this.namespace);
        if (this.line_text) |text| builder.count(text[0..@min(text.len, 690)]);
        if (this.suggestion) |text| builder.count(text);
    }

    pub fn clone(this: Location, allocator: std.mem.Allocator) !Location {
        // mostly to catch undefined memory
        bun.assertDefined(this.namespace);
        bun.assertDefined(this.file);

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
        // mostly to catch undefined memory
        bun.assertDefined(this.namespace);
        bun.assertDefined(this.file);

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
        bun.assertDefined(this.file);
        bun.assertDefined(this.namespace);

        return Api.Location{
            .file = this.file,
            .namespace = this.namespace,
            .line = this.line,
            .column = this.column,
            .line_text = this.line_text orelse "",
            .suggestion = this.suggestion orelse "",
            .offset = @truncate(u32, this.offset),
        };
    }

    // don't really know what's safe to deinit here!
    pub fn deinit(_: *Location, _: std.mem.Allocator) void {}

    pub fn init(file: string, namespace: string, line: i32, column: i32, length: u32, line_text: ?string, suggestion: ?string) Location {
        // mostly to catch undefined memory
        bun.assertDefined(file);
        bun.assertDefined(namespace);

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

    pub fn init_or_nil(_source: ?*const Source, r: Range) ?Location {
        if (_source) |source| {
            var data = source.initErrorPosition(r.loc);
            var full_line = source.contents[data.line_start..data.line_end];
            if (full_line.len > 80 + data.column_count) {
                full_line = full_line[std.math.max(data.column_count, 40) - 40 .. std.math.min(data.column_count + 40, full_line.len - 40) + 40];
            }

            bun.assertDefined(source.path.text);
            bun.assertDefined(source.path.namespace);
            bun.assertDefined(full_line);

            return Location{
                .file = source.path.text,
                .namespace = source.path.namespace,
                .line = usize2Loc(data.line_count).start,
                .column = usize2Loc(data.column_count).start,
                .length = full_line.len,
                .line_text = full_line,
                .offset = @intCast(usize, std.math.max(r.loc.start, 0)),
            };
        } else {
            return null;
        }
    }
};

pub const Data = struct {
    text: string,
    location: ?Location = null,
    pub fn deinit(d: *Data, allocator: std.mem.Allocator) void {
        if (d.location) |*loc| {
            loc.deinit(allocator);
        }

        allocator.free(d.text);
    }

    pub fn cloneLineText(this: Data, should: bool, allocator: std.mem.Allocator) !Data {
        if (!should or this.location == null or this.location.?.line_text == null)
            return this;

        var new_line_text = try allocator.dupe(u8, this.location.?.line_text.?);
        var new_location = this.location.?;
        new_location.line_text = new_line_text;
        return Data{
            .text = this.text,
            .location = new_location,
        };
    }

    pub fn clone(this: Data, allocator: std.mem.Allocator) !Data {
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
        comptime enable_ansi_colors: bool,
        comptime is_note: bool,
    ) !void {
        if (this.text.len == 0) return;

        const message_color = switch (kind) {
            .err => comptime Output.color_map.get("b").?,
            .note => comptime Output.color_map.get("cyan").? ++ Output.color_map.get("d").?,
            else => comptime Output.color_map.get("d").? ++ Output.color_map.get("b").?,
        };

        const color_name: string = switch (kind) {
            .err => comptime Output.color_map.get("red").?,
            .note => comptime Output.color_map.get("cyan").?,
            else => comptime Output.color_map.get("d").?,
        };

        try to.writeAll("\n\n");

        if (comptime enable_ansi_colors) {
            try to.writeAll(color_name);
        }

        try to.writeAll(kind.string());

        try std.fmt.format(to, comptime Output.prettyFmt("<r><d>: <r>", enable_ansi_colors), .{});

        if (comptime enable_ansi_colors) {
            try to.writeAll(message_color);
        }

        try std.fmt.format(to, comptime Output.prettyFmt("{s}<r>\n", enable_ansi_colors), .{this.text});

        if (this.location) |location| {
            if (location.line_text) |line_text_| {
                const line_text = std.mem.trimRight(u8, line_text_, "\r\n\t");

                const location_in_line_text = @intCast(u32, std.math.max(location.column, 1) - 1);
                const has_position = location.column > -1 and line_text.len > 0 and location_in_line_text < line_text.len;

                if (has_position) {
                    if (comptime enable_ansi_colors) {
                        const is_colored = message_color.len > 0;

                        const before_segment = line_text[0..location_in_line_text];

                        try to.writeAll(before_segment);
                        if (is_colored) {
                            try to.writeAll(color_name);
                        }

                        const rest_of_line = line_text[location_in_line_text..];

                        if (rest_of_line.len > 0) {
                            var end_of_segment: usize = 1;
                            var iter = strings.CodepointIterator.initOffset(rest_of_line, 1);
                            // extremely naive: we should really use IsIdentifierContinue || isIdentifierStart here

                            // highlight until we reach the next matching
                            switch (line_text[location_in_line_text]) {
                                '\'' => {
                                    end_of_segment = iter.scanUntilQuotedValueOrEOF('\'');
                                },
                                '"' => {
                                    end_of_segment = iter.scanUntilQuotedValueOrEOF('"');
                                },
                                '<' => {
                                    end_of_segment = iter.scanUntilQuotedValueOrEOF('>');
                                },
                                '`' => {
                                    end_of_segment = iter.scanUntilQuotedValueOrEOF('`');
                                },
                                else => {},
                            }
                            try to.writeAll(rest_of_line[0..end_of_segment]);
                            if (is_colored) {
                                try to.writeAll("\x1b[0m");
                            }

                            try to.writeAll(rest_of_line[end_of_segment..]);
                        } else if (is_colored) {
                            try to.writeAll("\x1b[0m");
                        }
                    } else {
                        try to.writeAll(line_text);
                    }

                    try to.writeAll("\n");

                    try to.writeByteNTimes(' ', location_in_line_text);
                    if (comptime enable_ansi_colors) {
                        const is_colored = message_color.len > 0;
                        if (is_colored) {
                            try to.writeAll(message_color);
                            try to.writeAll(color_name);
                            // always bold the ^
                            try to.writeAll(comptime Output.color_map.get("b").?);
                        }

                        try to.writeByte('^');

                        if (is_colored) {
                            try to.writeAll("\x1b[0m\n");
                        }
                    } else {
                        try to.writeAll("^\n");
                    }
                }
            }

            if (location.file.len > 0) {
                if (comptime enable_ansi_colors) {
                    if (!is_note and kind == .err) {
                        try to.writeAll(comptime Output.color_map.get("b").?);
                    } else {}
                }

                try std.fmt.format(to, comptime Output.prettyFmt("{s}<r>", enable_ansi_colors), .{
                    location.file,
                });

                if (location.line > -1 and location.column > -1) {
                    try std.fmt.format(to, comptime Output.prettyFmt("<d>:<r><yellow>{d}<r><d>:<r><yellow>{d}<r> <d>{d}<r>", enable_ansi_colors), .{
                        location.line,
                        location.column,
                        location.offset,
                    });
                } else if (location.line > -1) {
                    try std.fmt.format(to, comptime Output.prettyFmt("<d>:<r><yellow>{d}<r> <d>{d}<r>", enable_ansi_colors), .{
                        location.line,
                        location.offset,
                    });
                }
            }
        }
    }
};

pub const BabyString = packed struct {
    offset: u16,
    len: u16,

    pub fn in(parent: string, text: string) BabyString {
        return BabyString{
            .offset = @truncate(u16, std.mem.indexOf(u8, parent, text) orelse unreachable),
            .len = @truncate(u16, text.len),
        };
    }

    pub fn slice(this: BabyString, container: string) string {
        return container[this.offset..][0..this.len];
    }
};

pub const Msg = struct {
    kind: Kind = Kind.err,
    data: Data,
    metadata: Metadata = .{ .build = 0 },
    notes: ?[]Data = null,

    pub fn fromJS(allocator: std.mem.Allocator, globalObject: *bun.JSC.JSGlobalObject, file: string, err: bun.JSC.JSValue) !Msg {
        var zig_exception_holder: bun.JSC.ZigException.Holder = bun.JSC.ZigException.Holder.init();
        if (err.toError()) |value| {
            value.toZigException(globalObject, zig_exception_holder.zigException());
        } else {
            zig_exception_holder.zig_exception.message = JSC.ZigString.fromUTF8(err.toSlice(globalObject, allocator).slice());
        }

        return Msg{
            .data = .{
                .text = zig_exception_holder.zigException().message.toSliceClone(allocator).slice(),
                .location = Location{
                    .file = file,
                },
            },
        };
    }

    pub fn count(this: *const Msg, builder: *StringBuilder) void {
        this.data.count(builder);
        if (this.notes) |notes| {
            for (notes) |note| {
                note.count(builder);
            }
        }
    }

    pub fn clone(this: *const Msg, allocator: std.mem.Allocator) !Msg {
        return Msg{
            .kind = this.kind,
            .data = try this.data.clone(allocator),
            .metadata = this.metadata,
            .notes = if (this.notes != null and this.notes.?.len > 0)
                try bun.clone(this.notes.?, allocator)
            else
                null,
        };
    }

    pub fn cloneWithBuilder(this: *const Msg, notes: []Data, builder: *StringBuilder) Msg {
        return Msg{
            .kind = this.kind,
            .data = this.data.cloneWithBuilder(builder),
            .metadata = this.metadata,
            .notes = if (this.notes != null and this.notes.?.len > 0) brk: {
                for (this.notes.?, 0..) |note, i| {
                    notes[i] = note.cloneWithBuilder(builder);
                }
                break :brk notes[0..this.notes.?.len];
            } else null,
        };
    }

    pub const Metadata = union(Tag) {
        build: u0,
        resolve: Resolve,
        pub const Tag = enum(u8) {
            build = 1,
            resolve = 2,
        };

        pub const Resolve = struct {
            specifier: BabyString,
            import_kind: ImportKind,
            err: anyerror = error.ModuleNotFound,
        };
    };

    pub fn toAPI(this: *const Msg, allocator: std.mem.Allocator) !Api.Message {
        const notes_len = if (this.notes != null) this.notes.?.len else 0;
        var _notes = try allocator.alloc(
            Api.MessageData,
            notes_len,
        );
        var msg = Api.Message{
            .level = this.kind.toAPI(),
            .data = this.data.toAPI(),
            .notes = _notes,
            .on = Api.MessageMeta{
                .resolve = if (this.metadata == .resolve) this.metadata.resolve.specifier.slice(this.data.text) else "",
                .build = this.metadata == .build,
            },
        };

        if (this.notes) |notes| {
            if (notes.len > 0) {
                for (notes, 0..) |note, i| {
                    _notes[i] = note.toAPI();
                }
            }
        }

        return msg;
    }

    pub fn toAPIFromList(comptime ListType: type, list: ListType, allocator: std.mem.Allocator) ![]Api.Message {
        var out_list = try allocator.alloc(Api.Message, list.items.len);
        for (list.items, 0..) |item, i| {
            out_list[i] = try item.toAPI(allocator);
        }

        return out_list;
    }

    pub fn deinit(msg: *Msg, allocator: std.mem.Allocator) void {
        msg.data.deinit(allocator);
        if (msg.notes) |notes| {
            for (notes) |*note| {
                note.deinit(allocator);
            }
        }
        msg.notes = null;
    }

    pub fn writeFormat(
        msg: *const Msg,
        to: anytype,
        comptime enable_ansi_colors: bool,
    ) !void {
        try msg.data.writeFormat(to, msg.kind, enable_ansi_colors, false);

        if (msg.notes) |notes| {
            for (notes) |note| {
                try note.writeFormat(to, .note, enable_ansi_colors, true);
            }
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
                location.line_text,
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

    pub fn formatNoWriter(msg: *const Msg, comptime formatterFunc: @TypeOf(Global.panic)) void {
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

pub const Range = packed struct {
    loc: Loc = Loc.Empty,
    len: i32 = 0,
    pub const None = Range{ .loc = Loc.Empty, .len = 0 };

    pub fn in(this: Range, buf: []const u8) []const u8 {
        if (this.loc.start < 0 or this.len <= 0) return "";
        const slice = buf[@intCast(usize, this.loc.start)..];
        return slice[0..@min(@intCast(usize, this.len), buf.len)];
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

    pub fn jsonStringify(self: *const Range, options: anytype, writer: anytype) !void {
        return try std.json.stringify([2]i32{ self.loc.start, self.len + self.loc.start }, options, writer);
    }
};

pub const Log = struct {
    debug: bool = false,
    warnings: usize = 0,
    errors: usize = 0,
    msgs: ArrayList(Msg),
    level: Level = if (Environment.isDebug) Level.info else Level.warn,

    clone_line_text: bool = false,

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
            errors += @intCast(u32, @boolToInt(msg.kind == .err));
            warnings += @intCast(u32, @boolToInt(msg.kind == .warn));
        }

        return Api.Log{
            .warnings = warnings,
            .errors = errors,
            .msgs = try Msg.toAPIFromList(@TypeOf(this.msgs), this.msgs, allocator),
        };
    }

    pub const Level = enum(i8) {
        verbose,
        debug,
        info,
        warn,
        err,

        pub fn atLeast(this: Level, other: Level) bool {
            return @enumToInt(this) <= @enumToInt(other);
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
    };

    pub fn init(allocator: std.mem.Allocator) Log {
        return Log{
            .msgs = ArrayList(Msg).init(allocator),
            .level = default_log_level,
        };
    }

    pub fn initComptime(allocator: std.mem.Allocator) Log {
        return Log{
            .msgs = ArrayList(Msg).init(allocator),
        };
    }

    pub fn addVerbose(log: *Log, source: ?*const Source, loc: Loc, text: string) !void {
        @setCold(true);
        try log.addMsg(.{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
        });
    }

    pub fn toJS(this: Log, global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, fmt: string) JSC.JSValue {
        const msgs: []const Msg = this.msgs.items;
        var errors_stack: [256]*anyopaque = undefined;

        const count = @intCast(u16, @min(msgs.len, errors_stack.len));
        switch (count) {
            0 => return JSC.JSValue.jsUndefined(),
            1 => {
                const msg = msgs[0];
                return JSC.JSValue.fromRef(JSC.BuildError.create(global, allocator, msg));
            },
            else => {
                for (msgs[0..count], 0..) |msg, i| {
                    switch (msg.metadata) {
                        .build => {
                            errors_stack[i] = JSC.BuildError.create(global, allocator, msg).?;
                        },
                        .resolve => {
                            errors_stack[i] = JSC.ResolveError.create(global, allocator, msg, "").?;
                        },
                    }
                }
                const out = JSC.ZigString.init(fmt);
                const agg = global.createAggregateError(errors_stack[0..count].ptr, count, &out);
                return agg;
            },
        }
    }

    pub fn cloneTo(self: *Log, other: *Log) !void {
        var notes_count: usize = 0;

        for (self.msgs.items) |msg_| {
            const msg: Msg = msg_;
            if (msg.notes) |notes| {
                for (notes) |note| {
                    notes_count += @intCast(usize, @boolToInt(note.text.len > 0));
                }
            }
        }

        if (notes_count > 0) {
            var notes = try other.msgs.allocator.alloc(Data, notes_count);
            var note_i: usize = 0;
            for (self.msgs.items) |*msg| {
                if (msg.notes) |current_notes| {
                    var start_note_i: usize = note_i;
                    for (current_notes) |note| {
                        notes[note_i] = note;
                        note_i += 1;
                    }
                    msg.notes = notes[start_note_i..note_i];
                }
            }
        }

        try other.msgs.appendSlice(self.msgs.items);
        other.warnings += self.warnings;
        other.errors += self.errors;
    }

    pub fn appendTo(self: *Log, other: *Log) !void {
        try self.cloneTo(other);
        self.msgs.clearAndFree();
    }

    pub fn cloneToWithRecycled(self: *Log, other: *Log, recycled: bool) !void {
        try other.msgs.appendSlice(self.msgs.items);
        other.warnings += self.warnings;
        other.errors += self.errors;

        if (recycled) {
            var string_builder = StringBuilder{};
            var notes_count: usize = 0;
            {
                var i: usize = 0;
                var j: usize = other.msgs.items.len - self.msgs.items.len;

                while (i < self.msgs.items.len) : ({
                    i += 1;
                    j += 1;
                }) {
                    const msg: Msg = self.msgs.items[i];
                    msg.count(&string_builder);

                    if (msg.notes) |notes| {
                        notes_count += notes.len;
                    }
                }
            }

            try string_builder.allocate(other.msgs.allocator);
            var notes_buf = try other.msgs.allocator.alloc(Data, notes_count);
            var note_i: usize = 0;

            {
                var i: usize = 0;
                var j: usize = other.msgs.items.len - self.msgs.items.len;

                while (i < self.msgs.items.len) : ({
                    i += 1;
                    j += 1;
                }) {
                    const msg: Msg = self.msgs.items[i];
                    other.msgs.items[j] = msg.cloneWithBuilder(notes_buf[note_i..], &string_builder);
                    note_i += (msg.notes orelse &[_]Data{}).len;
                }
            }
        }
    }

    pub fn appendToWithRecycled(self: *Log, other: *Log, recycled: bool) !void {
        try self.cloneToWithRecycled(other, recycled);
        self.msgs.clearAndFree();
    }

    pub fn appendToMaybeRecycled(self: *Log, other: *Log, source: *const Source) !void {
        return self.appendToWithRecycled(other, source.contents_is_recycled);
    }

    pub fn deinit(self: *Log) void {
        self.msgs.clearAndFree();
    }

    pub fn addVerboseWithNotes(log: *Log, source: ?*const Source, loc: Loc, text: string, notes: []Data) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.verbose, log.level)) return;

        try log.addMsg(.{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
            .notes = notes,
        });
    }

    inline fn allocPrint(allocator: std.mem.Allocator, comptime fmt: string, args: anytype) !string {
        return if (Output.enable_ansi_colors)
            try std.fmt.allocPrint(allocator, Output.prettyFmt(fmt, true), args)
        else
            try std.fmt.allocPrint(allocator, Output.prettyFmt(fmt, false), args);
    }

    inline fn _addResolveErrorWithLevel(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        comptime dupe_text: bool,
        comptime is_error: bool,
        err: anyerror,
    ) !void {
        const text = try allocPrint(allocator, fmt, args);
        // TODO: fix this. this is stupid, it should be returned in allocPrint.
        const specifier = BabyString.in(text, args.@"0");
        if (comptime is_error) {
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
                    _data.location.?.line_text = allocator.dupe(u8, line) catch unreachable;
                }
            }
            break :brk _data;
        } else rangeData(
            source,
            r,
            text,
        );

        const msg = Msg{
            .kind = if (comptime is_error) Kind.err else Kind.warn,
            .data = data,
            .metadata = .{ .resolve = Msg.Metadata.Resolve{
                .specifier = specifier,
                .import_kind = import_kind,
                .err = err,
            } },
        };

        try log.addMsg(msg);
    }

    inline fn _addResolveError(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        comptime dupe_text: bool,
        err: anyerror,
    ) !void {
        return _addResolveErrorWithLevel(log, source, r, allocator, fmt, args, import_kind, dupe_text, true, err);
    }

    inline fn _addResolveWarn(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        comptime dupe_text: bool,
        err: anyerror,
    ) !void {
        return _addResolveErrorWithLevel(log, source, r, allocator, fmt, args, import_kind, dupe_text, false, err);
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
    ) !void {
        @setCold(true);
        return try _addResolveError(log, source, r, allocator, fmt, args, import_kind, false, err);
    }

    pub fn addResolveErrorWithTextDupe(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
    ) !void {
        @setCold(true);
        return try _addResolveError(log, source, r, allocator, fmt, args, import_kind, true, error.ModuleNotFound);
    }

    pub fn addResolveErrorWithTextDupeMaybeWarn(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
        warn: bool,
    ) !void {
        @setCold(true);
        if (warn) {
            return try _addResolveError(log, source, r, allocator, fmt, args, import_kind, true, error.ModuleNotFound);
        } else {
            return try _addResolveWarn(log, source, r, allocator, fmt, args, import_kind, true, error.ModuleNotFound);
        }
    }

    pub fn addRangeError(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        @setCold(true);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeErrorFmt(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, comptime text: string, args: anytype) !void {
        @setCold(true);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, r, allocPrint(allocator, text, args) catch unreachable).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addRangeErrorFmtWithNotes(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, notes: []Data, comptime text: string, args: anytype) !void {
        @setCold(true);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, r, allocPrint(allocator, text, args) catch unreachable).cloneLineText(log.clone_line_text, log.msgs.allocator),
            .notes = notes,
        });
    }

    pub fn addErrorFmt(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) !void {
        @setCold(true);
        log.errors += 1;
        try log.addMsg(.{
            .kind = .err,
            .data = try rangeData(source, Range{ .loc = l }, allocPrint(allocator, text, args) catch unreachable).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addRangeWarning(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, r, text).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addWarningFmt(log: *Log, source: ?*const Source, l: Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, Range{ .loc = l }, allocPrint(allocator, text, args) catch unreachable).cloneLineText(log.clone_line_text, log.msgs.allocator),
        });
    }

    pub fn addRangeWarningFmt(log: *Log, source: ?*const Source, r: Range, allocator: std.mem.Allocator, comptime text: string, args: anytype) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = try rangeData(source, r, allocPrint(allocator, text, args) catch unreachable).cloneLineText(log.clone_line_text, log.msgs.allocator),
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
    ) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(source, note_range, allocPrint(allocator, note_fmt, note_args) catch unreachable);

        try log.addMsg(.{
            .kind = .warn,
            .data = rangeData(source, r, allocPrint(allocator, fmt, args) catch unreachable),
            .notes = notes,
        });
    }

    pub fn addWarning(log: *Log, source: ?*const Source, l: Loc, text: string) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warn,
            .data = rangeData(source, Range{ .loc = l }, text),
        });
    }

    pub fn addRangeDebug(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.debug, log.level)) return;
        try log.addMsg(.{
            .kind = .debug,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeDebugWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.debug, log.level)) return;
        // log.de += 1;
        try log.addMsg(.{
            .kind = Kind.debug,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeErrorWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        @setCold(true);
        log.errors += 1;
        try log.addMsg(.{
            .kind = Kind.err,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeWarningWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        @setCold(true);
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(.{
            .kind = .warning,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub inline fn addMsg(self: *Log, msg: Msg) !void {
        if (comptime Environment.allow_assert) {
            if (msg.notes) |notes| {
                bun.assertDefined(notes);
                for (notes) |note| {
                    bun.assertDefined(note.text);
                    if (note.location) |loc| {
                        bun.assertDefined(loc);
                    }
                }
            }
        }
        try self.msgs.append(msg);
    }

    pub fn addError(self: *Log, _source: ?*const Source, loc: Loc, text: string) !void {
        @setCold(true);
        self.errors += 1;
        try self.addMsg(.{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
    }

    pub fn addSymbolAlreadyDeclaredError(self: *Log, allocator: std.mem.Allocator, source: *const Source, name: string, new_loc: Loc, old_loc: Loc) !void {
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

    pub fn printForLogLevel(self: *Log, to: anytype) !void {
        if (Output.enable_ansi_colors) {
            return self.printForLogLevelWithEnableAnsiColors(to, true);
        } else {
            return self.printForLogLevelWithEnableAnsiColors(to, false);
        }
    }

    pub fn printForLogLevelWithEnableAnsiColors(self: *Log, to: anytype, comptime enable_ansi_colors: bool) !void {
        var printed = false;

        if (self.warnings > 0 and self.errors > 0) {
            // Print warnings at the top
            // errors at the bottom
            // This is so if you're reading from a terminal
            // and there are a bunch of warnings
            // You can more easily see where the errors are

            for (self.msgs.items) |msg| {
                if (msg.kind != .err) {
                    if (msg.kind.shouldPrint(self.level)) {
                        try msg.writeFormat(to, enable_ansi_colors);
                        printed = true;
                    }
                }
            }

            for (self.msgs.items) |msg| {
                if (msg.kind == .err) {
                    if (msg.kind.shouldPrint(self.level)) {
                        try msg.writeFormat(to, enable_ansi_colors);
                        printed = true;
                    }
                }
            }
        } else {
            for (self.msgs.items) |msg| {
                if (msg.kind.shouldPrint(self.level)) {
                    try msg.writeFormat(to, enable_ansi_colors);
                    printed = true;
                }
            }
        }

        if (printed) _ = try to.write("\n");
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
    return Loc{ .start = @intCast(i32, loc) };
}

pub const Source = struct {
    path: fs.Path,
    key_path: fs.Path,

    contents: string,
    contents_is_recycled: bool = false,

    /// Lazily-generated human-readable identifier name that is non-unique
    /// Avoid accessing this directly most of the  time
    identifier_name: string = "",

    index: Index = Index.source(0),

    pub fn fmtIdentifier(this: *const Source) strings.FormatValidIdentifier {
        return this.path.name.fmtIdentifier();
    }

    pub fn identifierName(this: *Source, allocator: std.mem.Allocator) !string {
        if (this.identifier_name.len > 0) {
            return this.identifier_name;
        }

        std.debug.assert(this.path.text.len > 0);
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

        const bytes = @bitCast(u32, this.contents[0..4].*);
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
        return Source{ .path = path, .key_path = path, .contents = "" };
    }

    pub fn initFile(file: fs.File, _: std.mem.Allocator) !Source {
        var source = Source{
            .path = file.path,
            .key_path = fs.Path.init(file.path.text),
            .contents = file.contents,
        };
        source.path.namespace = "file";
        return source;
    }

    pub fn initRecycledFile(file: fs.File, _: std.mem.Allocator) !Source {
        var source = Source{
            .path = file.path,
            .key_path = fs.Path.init(file.path.text),
            .contents = file.contents,
            .contents_is_recycled = true,
        };
        source.path.namespace = "file";

        return source;
    }

    pub fn initPathString(pathString: string, contents: string) Source {
        var path = fs.Path.init(pathString);
        return Source{ .key_path = path, .path = path, .contents = contents };
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
            }, .len = @intCast(i32, op.len) };
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
            var c: u8 = undefined;
            while (i < text.len) {
                c = text[i];

                if (c == quote) {
                    return Range{ .loc = loc, .len = @intCast(i32, i + 1) };
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

    pub fn initErrorPosition(self: *const Source, _offset: Loc) ErrorPosition {
        var prev_code_point: i32 = 0;
        var offset: usize = std.math.min(if (_offset.start < 0) 0 else @intCast(usize, _offset.start), @max(self.contents.len, 1) - 1);

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
};

pub fn rangeData(source: ?*const Source, r: Range, text: string) Data {
    return Data{ .text = text, .location = Location.init_or_nil(source, r) };
}
