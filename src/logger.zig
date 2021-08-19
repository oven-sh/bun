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

    pub inline fn toAPI(kind: Kind) Api.MessageKind {
        return switch (kind) {
            .err => err,
            .warn => warn,
            .note => note,
            .debug => debug,
            .verbose => verbose,
        };
    }
};

pub const Loc = packed struct {
    start: i32 = -1,

    pub inline fn toNullable(loc: *Loc) ?Loc {
        return if (loc.start == -1) null else loc.*;
    }

    // TODO: remove this stupidity
    pub inline fn toUsize(self: *const Loc) usize {
        return @intCast(usize, self.start);
    }

    // TODO: remove this stupidity
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
            return Location{
                .file = source.path.pretty,
                .namespace = source.path.namespace,
                .line = usize2Loc(data.line_count).start,
                .column = usize2Loc(data.column_count).start,
                .length = source.contents.len,
                .line_text = source.contents[data.line_start..data.line_end],
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

    pub fn writeFormat(
        this: *const Data,
        to: anytype,
        kind: Kind,
    ) !void {
        if (this.text.len == 0) return;

        if (this.location) |location| {
            try std.fmt.format(to, "\n\n{s}: {s}\n{s}\n{s}:{}:{} {d}", .{
                kind.string(),
                this.text,
                location.line_text,
                location.file,
                location.line,
                location.column,
                location.offset,
            });
        } else {
            try std.fmt.format(to, "\n\n{s}: {s}\n", .{
                kind.string(),
                this.text,
            });
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

    pub fn toAPI(this: *const Msg, allocator: *std.mem.Allocator) Api.Message {
        var msg = Api.Message{
            .kind = this.kind.toAPI(),
            .data = this.data.toAPI(),
        };

        if (this.notes) |notes| {
            if (notes.len > 0) {
                msg.notes = try allocator.alloc(Api.MessageData, notes.len);
                for (notes) |note, i| {
                    msg.notes[i] = note.toAPI();
                }
            }
        }

        return msg;
    }

    pub fn toAPIFromList(comptime ListType: type, list: ListType, allocator: *std.mem.Allocator) ![]Api.Message {
        var out_list = try allocator.alloc(Api.Msg, list.items.len);
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
    ) !void {
        try msg.data.writeFormat(to, msg.kind);

        if (msg.notes) |notes| {
            for (notes) |note| {
                try note.writeFormat(to, msg.kind);
            }
        }
    }

    pub fn doFormat(msg: *const Msg, to: anytype, formatterFunc: anytype) !void {
        try formatterFunc(to, "\n\n{s}: {s}\n{s}\n{s}:{s}:{s} {d}", .{
            msg.kind.string(),
            msg.data.text,
            msg.data.location.?.line_text,
            msg.data.location.?.file,
            msg.data.location.?.line,
            msg.data.location.?.column,
            msg.data.location.?.offset,
        });
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
        return Api.Log{
            .warnings = this.warnings,
            .errors = this.errors,
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
            var i: usize = 0;
            var j: usize = other.msgs.items.len - self.msgs.items.len;

            while (i < self.msgs.items.len) : ({
                i += 1;
                j += 1;
            }) {
                const msg = self.msgs.items[i];
                if (msg.data.location) |location| {
                    if (location.line_text) |line_text| {
                        other.msgs.items[j].data.location.?.line_text = try other.msgs.allocator.dupe(u8, line_text);
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

    pub fn addResolveError(
        log: *Log,
        source: *const Source,
        r: Range,
        allocator: *std.mem.Allocator,
        comptime fmt: string,
        args: anytype,
        import_kind: ImportKind,
    ) !void {
        const text = try std.fmt.allocPrint(allocator, fmt, args);
        // TODO: fix this. this is stupid, it should be returned in allocPrint.
        const specifier = BabyString.in(text, args.@"0");
        log.errors += 1;
        try log.addMsg(
            Msg{
                .kind = .err,
                .data = rangeData(
                    source,
                    r,
                    text,
                ),
                .metadata = .{ .resolve = Msg.Metadata.Resolve{ .specifier = specifier, .import_kind = import_kind } },
            },
        );
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

    // TODO:
    pub fn addMsg(self: *Log, msg: Msg) !void {
        try self.msgs.append(msg);
    }

    // TODO:
    pub fn addError(self: *Log, _source: ?*const Source, loc: Loc, text: string) !void {
        self.errors += 1;
        try self.addMsg(Msg{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
    }

    // TODO:
    pub fn print(self: *Log, to: anytype) !void {
        for (self.msgs.items) |msg| {
            try msg.writeFormat(to);
        }
    }

    pub fn printForLogLevel(self: *Log, to: anytype) !void {
        var printed = false;
        for (self.msgs.items) |msg| {
            if (msg.kind.shouldPrint(self.level)) {
                try msg.writeFormat(to);
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

    // An identifier that is mixed in to automatically-generated symbol names to
    // improve readability. For example, if the identifier is "util" then the
    // symbol for an "export default" statement will be called "util_default".
    identifier_name: string,

    pub const ErrorPosition = struct {
        line_start: usize,
        line_end: usize,
        column_count: usize,
        line_count: usize,
    };

    pub fn initFile(file: fs.File, allocator: *std.mem.Allocator) !Source {
        var name = file.path.name;
        var identifier_name = name.nonUniqueNameString(allocator) catch unreachable;

        var source = Source{
            .path = file.path,
            .key_path = fs.Path.init(file.path.text),
            .identifier_name = identifier_name,
            .contents = file.contents,
        };
        source.path.namespace = "file";
        return source;
    }

    pub fn initRecycledFile(file: fs.File, allocator: *std.mem.Allocator) !Source {
        var name = file.path.name;
        var identifier_name = name.nonUniqueNameString(allocator) catch unreachable;

        var source = Source{
            .path = file.path,
            .key_path = fs.Path.init(file.path.text),
            .identifier_name = identifier_name,
            .contents = file.contents,
            .contents_is_recycled = true,
        };
        source.path.namespace = "file";

        return source;
    }

    pub fn initPathString(pathString: string, contents: string) Source {
        var path = fs.Path.init(pathString);
        return Source{ .key_path = path, .path = path, .identifier_name = path.name.base, .contents = contents };
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
        var offset: usize = std.math.min(if (_offset.start < 0) 0 else @intCast(usize, _offset.start), self.contents.len - 1);

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

test "print msg" {
    var msgs = ArrayList(Msg).init(std.testing.allocator);
    var log = Log{ .msgs = msgs };
    defer log.msgs.deinit();
    var filename = "test.js".*;
    var syntax = "for (i".*;
    var err = "invalid syntax".*;
    var namespace = "file".*;

    try log.addMsg(Msg{
        .kind = .err,
        .data = Data{
            .location = Location.init_file(&filename, 1, 3, 0, &syntax, ""),
            .text = &err,
        },
    });

    const stdout = std.io.getStdOut().writer();

    // try log.print(stdout);
}

test "ErrorPosition" {
    const source = Source.initPathString("/src/test/fixtures/simple.jsx", @embedFile("./test/fixtures/simple.jsx"));
    const error_position = source.initErrorPosition(Loc{ .start = 979 });

    std.testing.expectEqual(@as(usize, 973), @as(usize, error_position.line_start));
    std.testing.expectEqual(@as(usize, 1016), @as(usize, error_position.line_end));

    var msgs = ArrayList(Msg).init(std.testing.allocator);
    var log = Log{ .msgs = msgs };
    defer log.msgs.deinit();

    try log.addMsg(Msg{
        .kind = .err,
        .data = rangeData(&source, Range{ .loc = Loc{
            .start = 979,
        }, .len = 15 }, "Oh no"),
    });

    const stdout = std.io.getStdOut().writer();
    try log.print(stdout);
}
