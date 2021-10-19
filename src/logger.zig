const std = @import("std");
const Api = @import("./api/schema.zig").Api;
const js = @import("./javascript/jsc/bindings/bindings.zig");
const ImportKind = @import("./import_record.zig").ImportKind;
usingnamespace @import("global.zig");

const fs = @import("fs.zig");
const unicode = std.unicode;

const expect = std.testing.expect;
const assert = std.debug.assert;
const ArrayList = std.ArrayList;
const StringBuilder = @import("./string_builder.zig");

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

    pub inline fn string(self: Kind) string {
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

pub const Loc = packed struct {
    start: i32 = -1,

    pub inline fn toNullable(loc: *Loc) ?Loc {
        return if (loc.start == -1) null else loc.*;
    }

    pub inline fn toUsize(self: *const Loc) usize {
        return @intCast(usize, self.start);
    }

    pub inline fn i(self: *const Loc) usize {
        return @intCast(usize, self.start);
    }

    pub const Empty = Loc{ .start = -1 };

    pub inline fn eql(loc: *Loc, other: Loc) bool {
        return loc.start == other.start;
    }

    pub fn jsonStringify(self: *const Loc, options: anytype, writer: anytype) !void {
        return try std.json.stringify(self.start, options, writer);
    }
};

pub const Location = struct {
    file: string,
    namespace: string = "file",
    line: i32 = 1, // 1-based
    column: i32 = 0, // 0-based, in bytes
    length: usize = 0, // in bytes
    line_text: ?string = null,
    suggestion: ?string = null,
    offset: usize = 0,

    pub fn toAPI(this: *const Location) Api.Location {
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
    pub fn deinit(l: *Location, allocator: *std.mem.Allocator) void {}

    pub fn init(file: []u8, namespace: []u8, line: i32, column: i32, length: u32, line_text: ?[]u8, suggestion: ?[]u8) Location {
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

    pub fn init_file(file: string, line: i32, column: i32, length: u32, line_text: ?[]u8, suggestion: ?[]u8) Location {
        var namespace = "file".*;

        return Location{
            .file = file,
            .namespace = &namespace,
            .line = line,
            .column = column,
            .length = length,
            .line_text = line_text,
            .suggestion = suggestion,
        };
    }
};

pub const Data = struct {
    text: string,
    location: ?Location = null,
    pub fn deinit(d: *Data, allocator: *std.mem.Allocator) void {
        if (d.location) |loc| {
            loc.deinit(allocator);
        }

        allocator.free(text);
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
        };
    };

    pub fn toAPI(this: *const Msg, allocator: *std.mem.Allocator) !Api.Message {
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
                for (notes) |note, i| {
                    _notes[i] = note.toAPI();
                }
            }
        }

        return msg;
    }

    pub fn toAPIFromList(comptime ListType: type, list: ListType, allocator: *std.mem.Allocator) ![]Api.Message {
        var out_list = try allocator.alloc(Api.Message, list.items.len);
        for (list.items) |item, i| {
            out_list[i] = try item.toAPI(allocator);
        }

        return out_list;
    }

    pub fn deinit(msg: *Msg, allocator: *std.mem.Allocator) void {
        msg.data.deinit(allocator);
        if (msg.notes) |notes| {
            for (notes) |note| {
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
        comptime allow_colors: bool,
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
    level: Level = if (isDebug) Level.info else Level.warn,

    pub fn toAPI(this: *const Log, allocator: *std.mem.Allocator) !Api.Log {
        var warnings: u32 = 0;
        var errors: u32 = 0;
        for (this.msgs.items) |msg, i| {
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
    };

    pub fn init(allocator: *std.mem.Allocator) Log {
        return Log{
            .msgs = ArrayList(Msg).init(allocator),
        };
    }

    pub fn addVerbose(log: *Log, source: ?*const Source, loc: Loc, text: string) !void {
        try log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
        });
    }

    pub fn appendTo(self: *Log, other: *Log) !void {
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
        self.msgs.deinit();
    }

    pub fn appendToMaybeRecycled(self: *Log, other: *Log, source: *const Source) !void {
        try other.msgs.appendSlice(self.msgs.items);
        other.warnings += self.warnings;
        other.errors += self.errors;

        if (source.contents_is_recycled) {
            var string_builder = StringBuilder{};
            var notes_count: usize = 0;
            {
                var i: usize = 0;
                var j: usize = other.msgs.items.len - self.msgs.items.len;

                while (i < self.msgs.items.len) : ({
                    i += 1;
                    j += 1;
                }) {
                    const msg = self.msgs.items[i];
                    if (msg.data.location) |location| {
                        if (location.line_text) |line_text| {

                            // Naively truncate to 690 characters per line.
                            // This doesn't catch where an error occurred for extremely long, minified lines.
                            string_builder.count(line_text[0..std.math.min(line_text.len, 690)]);
                        }
                    }

                    if (msg.notes) |notes| {
                        notes_count += notes.len;
                        for (notes) |note| {
                            string_builder.count(note.text);
                        }
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
                    const msg = self.msgs.items[i];

                    if (msg.data.location) |location| {
                        if (location.line_text) |line_text| {
                            other.msgs.items[j].data.location.?.line_text = string_builder.append(
                                // Naively truncate to 690 characters per line.
                                // This doesn't catch where an error occurred for extremely long, minified lines.
                                line_text[0..std.math.min(line_text.len, 690)],
                            );
                        }
                    }

                    if (msg.notes) |notes| {
                        var start_notes_i: usize = note_i;
                        for (notes) |note| {
                            notes_buf[note_i] = note;
                            notes_buf[note_i].text = string_builder.append(note.text);
                            note_i += 1;
                        }
                        other.msgs.items[j].notes = notes_buf[start_notes_i..note_i];
                    }
                }
            }
        }

        self.msgs.deinit();
    }

    pub fn deinit(self: *Log) void {
        self.msgs.deinit();
    }

    pub fn addVerboseWithNotes(log: *Log, source: ?*const Source, loc: Loc, text: string, notes: []Data) !void {
        if (!Kind.shouldPrint(.verbose, log.level)) return;

        try log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
            .notes = notes,
        });
    }

    inline fn _addResolveError(log: *Log, source: *const Source, r: Range, allocator: *std.mem.Allocator, comptime fmt: string, args: anytype, import_kind: ImportKind, comptime dupe_text: bool) !void {
        const text = try std.fmt.allocPrint(allocator, fmt, args);
        // TODO: fix this. this is stupid, it should be returned in allocPrint.
        const specifier = BabyString.in(text, args.@"0");
        log.errors += 1;

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
            .kind = .err,
            .data = data,
            .metadata = .{ .resolve = Msg.Metadata.Resolve{ .specifier = specifier, .import_kind = import_kind } },
        };

        try log.addMsg(msg);
    }

    pub fn addResolveError(
        log: *Log,
        source: *const Source,
        r: Range,
        allocator: *std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
    ) !void {
        return try _addResolveError(log, source, r, allocator, fmt, args, import_kind, false);
    }

    pub fn addResolveErrorWithTextDupe(
        log: *Log,
        source: *const Source,
        r: Range,
        allocator: *std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
    ) !void {
        return try _addResolveError(log, source, r, allocator, fmt, args, import_kind, true);
    }

    pub fn addRangeError(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = .err,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeErrorFmt(log: *Log, source: ?*const Source, r: Range, allocator: *std.mem.Allocator, comptime text: string, args: anytype) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = .err,
            .data = rangeData(source, r, std.fmt.allocPrint(allocator, text, args) catch unreachable),
        });
    }

    pub fn addRangeErrorFmtWithNotes(log: *Log, source: ?*const Source, r: Range, allocator: *std.mem.Allocator, notes: []Data, comptime text: string, args: anytype) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = .err,
            .data = rangeData(source, r, std.fmt.allocPrint(allocator, text, args) catch unreachable),
            .notes = notes,
        });
    }

    pub fn addErrorFmt(log: *Log, source: ?*const Source, l: Loc, allocator: *std.mem.Allocator, comptime text: string, args: anytype) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = .err,
            .data = rangeData(source, Range{ .loc = l }, std.fmt.allocPrint(allocator, text, args) catch unreachable),
        });
    }

    pub fn addRangeWarning(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warn,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addWarningFmt(log: *Log, source: ?*const Source, l: Loc, allocator: *std.mem.Allocator, comptime text: string, args: anytype) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warn,
            .data = rangeData(source, Range{ .loc = l }, std.fmt.allocPrint(allocator, text, args) catch unreachable),
        });
    }

    pub fn addRangeWarningFmt(log: *Log, source: ?*const Source, r: Range, allocator: *std.mem.Allocator, comptime text: string, args: anytype) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warn,
            .data = rangeData(source, r, std.fmt.allocPrint(allocator, text, args) catch unreachable),
        });
    }

    pub fn addRangeWarningFmtWithNote(
        log: *Log,
        source: ?*const Source,
        r: Range,
        allocator: *std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        comptime note_fmt: string,
        note_args: anytype,
        note_range: Range,
    ) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;

        var notes = try allocator.alloc(Data, 1);
        notes[0] = rangeData(source, note_range, std.fmt.allocPrint(allocator, note_fmt, note_args) catch unreachable);

        try log.addMsg(Msg{
            .kind = .warn,
            .data = rangeData(source, r, std.fmt.allocPrint(allocator, fmt, args) catch unreachable),
            .notes = notes,
        });
    }

    pub fn addWarning(log: *Log, source: ?*const Source, l: Loc, text: string) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warn,
            .data = rangeData(source, Range{ .loc = l }, text),
        });
    }

    pub fn addRangeDebug(log: *Log, source: ?*const Source, r: Range, text: string) !void {
        if (!Kind.shouldPrint(.debug, log.level)) return;
        try log.addMsg(Msg{
            .kind = .debug,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeDebugWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        if (!Kind.shouldPrint(.debug, log.level)) return;
        // log.de += 1;
        try log.addMsg(Msg{
            .kind = Kind.debug,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeErrorWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = Kind.err,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeWarningWithNotes(log: *Log, source: ?*const Source, r: Range, text: string, notes: []Data) !void {
        if (!Kind.shouldPrint(.warn, log.level)) return;
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warning,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addMsg(self: *Log, msg: Msg) !void {
        try self.msgs.append(msg);
    }

    pub fn addError(self: *Log, _source: ?*const Source, loc: Loc, text: string) !void {
        self.errors += 1;
        try self.addMsg(Msg{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
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
        for (self.msgs.items) |msg| {
            if (msg.kind.shouldPrint(self.level)) {
                try msg.writeFormat(to, enable_ansi_colors);
                printed = true;
            }
        }

        if (printed) _ = try to.write("\n");
    }

    pub fn toZigException(this: *const Log, allocator: *std.mem.Allocator) *js.ZigException.Holder {
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
    index: u32 = 0,
    contents: string,
    contents_is_recycled: bool = false,

    pub const ErrorPosition = struct {
        line_start: usize,
        line_end: usize,
        column_count: usize,
        line_count: usize,
    };

    pub fn initEmptyFile(filepath: string) Source {
        const path = fs.Path.init(filepath);
        return Source{ .path = path, .key_path = path, .index = 0, .contents = "" };
    }

    pub fn initFile(file: fs.File, allocator: *std.mem.Allocator) !Source {
        var name = file.path.name;

        var source = Source{
            .path = file.path,
            .key_path = fs.Path.init(file.path.text),
            .contents = file.contents,
        };
        source.path.namespace = "file";
        return source;
    }

    pub fn initRecycledFile(file: fs.File, allocator: *std.mem.Allocator) !Source {
        var name = file.path.name;

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
        var prev_code_point: u21 = 0;
        var offset: usize = std.math.min(if (_offset.start < 0) 0 else @intCast(usize, _offset.start), @maximum(self.contents.len, 1) - 1);

        const contents = self.contents;

        var iter = unicode.Utf8Iterator{
            .bytes = self.contents[0..offset],
            .i = 0,
        };

        var line_start: usize = 0;
        var line_count: usize = 1;
        var column_number: usize = 1;

        while (iter.nextCodepoint()) |code_point| {
            switch (code_point) {
                '\n' => {
                    column_number = 1;
                    line_start = iter.i + 1;
                    if (prev_code_point != '\r') {
                        line_count += 1;
                    }
                },

                '\r' => {
                    column_number = 0;
                    line_start = iter.i + 1;
                    line_count += 1;
                },

                0x2028, 0x2029 => {
                    line_start = iter.i + 3; // These take three bytes to encode in UTF-8
                    line_count += 1;
                    column_number = 1;
                },
                else => {
                    column_number += 1;
                },
            }

            prev_code_point = code_point;
        }

        iter = unicode.Utf8Iterator{
            .bytes = self.contents[offset..],
            .i = 0,
        };

        // Scan to the end of the line (or end of file if this is the last line)
        var line_end: usize = contents.len;

        loop: while (iter.nextCodepoint()) |code_point| {
            switch (code_point) {
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
