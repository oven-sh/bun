const std = @import("std");

usingnamespace @import("strings.zig");

const fs = @import("fs.zig");
const unicode = std.unicode;

const expect = std.testing.expect;
const assert = std.debug.assert;
const ArrayList = std.ArrayList;

pub const Kind = enum {
    err,
    warn,
    note,
    debug,

    pub fn string(self: Kind) string {
        return switch (self) {
            .err => "error",
            .warn => "warn",
            .note => "note",
            .debug => "debug",
        };
    }
};

pub const Loc = struct {
    start: i32 = -1,

    pub const Empty = Loc{ .start = -1 };

    pub fn eql(loc: *Loc, other: Loc) bool {
        return loc.start == other.start;
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

    pub fn init(file: []u8, namespace: []u8, line: i32, column: i32, length: u32, line_text: ?[]u8, suggestion: ?[]u8) Location {
        return Location{
            .file = file,
            .namespace = namespace,
            .line = line,
            .column = column,
            .length = length,
            .line_text = line_text,
            .suggestion = suggestion,
        };
    }

    pub fn init_or_nil(_source: ?Source, r: Range) ?Location {
        if (_source) |source| {
            var data = source.initErrorPosition(r.loc);
            return Location{
                .file = source.path.pretty,
                .namespace = source.path.namespace,
                .line = usize2Loc(data.line_count).start,
                .column = usize2Loc(data.column_count).start,
                .length = source.contents.len,
                .line_text = source.contents[data.line_start..data.line_end],
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

pub const Data = struct { text: string, location: ?Location = null };

pub const Msg = struct {
    kind: Kind = Kind.err,
    data: Data,
};

pub const Range = struct {
    loc: Loc = Loc.Empty,
    len: i32 = 0,
    pub const None = Range{ .loc = Loc.Empty, .len = 0 };

    pub fn end(self: *Range) Loc {
        return Loc{ .start = self.start + self.len };
    }
};

pub const Log = struct {
    debug: bool = false,
    warnings: u8 = 0,
    errors: u8 = 0,
    msgs: ArrayList(Msg),

    pub fn addVerbose(log: *Log, source: ?Source, loc: Loc, text: string) !void {
        try log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
        });
    }

    pub fn addVerboseWithNotes(source: ?Source, loc: Loc, text: string, notes: []Data) !void {
        try log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
            .notes = notes,
        });
    }

    pub fn addRangeError(log: *Log, source: ?Source, r: Range, text: string) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = .err,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeWarning(log: *Log, source: ?Source, r: Range, text: string) !void {
        log.warnings += 1;
        try log.addMsg(Msg{
            .kind = .warning,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeDebug(log: *Log, source: ?Source, r: Range, text: string) !void {
        try log.addMsg(Msg{
            .kind = .debug,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeErrorWithNotes(log: *Log, source: ?Source, r: Range, text: string, notes: []Data) !void {
        log.errors += 1;
        try log.addMsg(Msg{
            .kind = Kind.err,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeWarningWithNotes(log: *Log, source: ?Source, r: Range, text: string, notes: []Data) !void {
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
    pub fn addError(self: *Log, _source: ?Source, loc: Loc, text: string) !void {
        self.errors += 1;
        try self.addMsg(Msg{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
    }

    // TODO:
    pub fn print(self: *Log, to: anytype) !void {
        for (self.msgs.items) |msg| {
            try std.fmt.format(to, "\n\n{s}: {s}\n{s}\n{s}:{}:{}", .{ msg.kind.string(), msg.data.text, msg.data.location.?.line_text, msg.data.location.?.file, msg.data.location.?.line, msg.data.location.?.column });
        }
    }
};

pub fn usize2Loc(loc: usize) Loc {
    if (loc > std.math.maxInt(i32)) {
        return Loc.Empty;
    } else {
        return Loc{ .start = @intCast(i32, loc) };
    }
}

pub const Source = struct {
    path: fs.Path,
    index: u32 = 0,
    contents: string,

    // An identifier that is mixed in to automatically-generated symbol names to
    // improve readability. For example, if the identifier is "util" then the
    // symbol for an "export default" statement will be called "util_default".
    identifier_name: string,

    pub const ErrorPosition = struct { line_start: usize, line_end: usize, column_count: usize, line_count: usize };

    pub fn initFile(file: fs.File, allocator: *std.mem.Allocator) Source {
        std.debug.assert(file.contents != null);
        var name = file.path.name;
        var identifier_name = name.nonUniqueNameString(allocator) catch unreachable;
        if (file.contents) |contents| {
            return Source{ .path = file.path, .identifier_name = identifier_name, .contents = contents };
        } else {
            std.debug.panic("Expected file.contents to not be null. {s}", .{file});
        }
    }

    pub fn initPathString(pathString: string, contents: string) Source {
        var path = fs.Path.init(pathString);
        return Source{ .path = path, .identifier_name = path.name.base, .contents = contents };
    }

    pub fn initErrorPosition(self: *const Source, _offset: Loc) ErrorPosition {
        var prev_code_point: u21 = 0;
        var offset: usize = if (_offset.start < 0) 0 else @intCast(usize, _offset.start);

        const contents = self.contents;

        var iter = unicode.Utf8Iterator{
            .bytes = self.contents[0..offset],
            .i = std.math.min(offset, self.contents.len),
        };

        var line_start: usize = 0;
        var line_count: usize = 0;

        while (iter.nextCodepoint()) |code_point| {
            switch (code_point) {
                '\n' => {
                    line_start = iter.i + 1;
                    if (prev_code_point != '\r') {
                        line_count += 1;
                    }
                },

                '\r' => {
                    line_start = iter.i + 1;
                    line_count += 1;
                },

                0x2028, 0x2029 => {
                    line_start = iter.i + 3; // These take three bytes to encode in UTF-8
                    line_count += 1;
                },
                else => {},
            }

            prev_code_point = code_point;
        }

        iter = unicode.Utf8Iterator{
            .bytes = self.contents[offset..],
            .i = std.math.min(offset, self.contents.len),
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
            .line_start = line_start,
            .line_end = line_end,
            .line_count = line_count,
            .column_count = offset - line_start,
        };
    }
};

pub fn rangeData(source: ?Source, r: Range, text: string) Data {
    return Data{ .text = text, .location = Location.init_or_nil(source, r) };
}

test "print msg" {
    var log = Log{ .msgs = ArrayList(Msg).init(std.testing.allocator) };
    defer log.msgs.deinit();
    var filename = "test.js".*;
    var syntax = "for(i = 0;)".*;
    var err = "invalid syntax".*;
    var namespace = "file".*;

    try log.addMsg(Msg{
        .kind = .err,
        .data = Data{ .location = Location.init_file(&filename, 1, 3, 0, &syntax, ""), .text = &err },
    });

    const stdout = std.io.getStdOut().writer();

    try log.print(stdout);
}
