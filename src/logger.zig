const std = @import("std");
const strings = @import("strings.zig");
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

    pub fn string(self: Kind) []const u8 {
        return switch (self) {
            .err => "error",
            .warn => "warn",
            .note => "note",
            .debug => "debug",
        };
    }
};

pub const Loc = i32;

pub const Location = struct {
    file: []const u8,
    namespace: []const u8 = "file",
    line: i32 = 1, // 1-based
    column: i32 = 0, // 0-based, in bytes
    length: usize = 0, // in bytes
    line_text: ?[]const u8 = null,
    suggestion: ?[]const u8 = null,

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
                .file = source.path.pretty_path,
                .namespace = source.path.namespace,
                .line = usize2Loc(data.line_count),
                .column = usize2Loc(data.column_count),
                .length = source.contents.len,
                .line_text = source.contents[data.line_start..data.line_end],
            };
        } else {
            return null;
        }
    }

    pub fn init_file(file: []const u8, line: i32, column: i32, length: u32, line_text: ?[]u8, suggestion: ?[]u8) Location {
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

pub const Data = struct { text: []u8, location: ?Location = null };

pub const Msg = struct {
    kind: Kind = Kind.err,
    data: Data,
};

pub const Range = struct { loc: Loc = 0, len: i32 = 0 };

pub const Log = struct {
    debug: bool = false,
    warnings: u8 = 0,
    errors: u8 = 0,
    msgs: ArrayList(Msg),

    pub fn addVerbose(log: *Log, source: ?Source, loc: Loc, text: []u8) void {
        log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .Loc = loc }, text),
        });
    }

    pub fn addVerboseWithNotes(source: ?Source, loc: Loc, text: []u8, notes: []Data) void {
        log.addMsg(Msg{
            .kind = .verbose,
            .data = rangeData(source, Range{ .loc = loc }, text),
            .notes = notes,
        });
    }

    pub fn addRangeError(log: *Log, source: ?Source, r: Range, text: []u8) void {
        log.addMsg(Msg{
            .kind = .Error,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeWarning(log: *Log, source: ?Source, r: Range, text: []u8) void {
        log.addMsg(Msg{
            .kind = .warning,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeDebug(log: *Log, source: ?Source, r: Range, text: []u8) void {
        log.addMsg(Msg{
            .kind = .debug,
            .data = rangeData(source, r, text),
        });
    }

    pub fn addRangeErrorWithNotes(log: *Log, source: ?Source, r: Range, text: []u8, notes: []Data) void {
        log.addMsg(Msg{
            .kind = Kind.err,
            .data = rangeData(source, r, text),
            .notes = notes,
        });
    }

    pub fn addRangeWarningWithNotes(log: *Log, source: ?Source, r: Range, text: []u8, notes: []Data) void {
        log.addMsg(Msg{
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
    pub fn addError(self: *Log, _source: ?Source, loc: Loc, text: []u8) !void {
        try self.addMsg(Msg{ .kind = .err, .data = rangeData(_source, Range{ .loc = loc }, text) });
        self.errors += 1;
    }

    // TODO:
    pub fn print(self: *Log, to: anytype) !void {
        for (self.msgs.items) |msg| {
            try std.fmt.format(to, "\n\n{s}: {s}\n{s}\n{s}:{}:{}", .{ msg.kind.string(), msg.data.text, msg.data.location.?.line_text, msg.data.location.?.file, msg.data.location.?.line, msg.data.location.?.column });
        }
    }
};

pub fn usize2Loc(loc: usize) Loc {
    if (loc > std.math.maxInt(Loc)) {
        return 9999;
    } else {
        return @intCast(Loc, loc);
    }
}

pub const Source = struct {
    path: fs.Path,
    index: u32 = 0,
    contents: []const u8,

    // An identifier that is mixed in to automatically-generated symbol names to
    // improve readability. For example, if the identifier is "util" then the
    // symbol for an "export default" statement will be called "util_default".
    identifier_name: []u8,

    pub const ErrorPosition = struct { line_start: usize, line_end: usize, column_count: usize, line_count: usize };

    pub fn initPathString(pathString: []const u8, contents: []const u8, allocator: *std.mem.Allocator) Source {
        const path = fs.Path.init(pathString, allocator);
        return Source{ .path = path, .identifier_name = path.name.base, .contents = contents };
    }

    pub fn initErrorPosition(self: *const Source, _offset: Loc) ErrorPosition {
        var prev_code_point: u21 = 0;
        var offset: usize = if (_offset < 0) 0 else @intCast(usize, _offset);

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

pub fn rangeData(source: ?Source, r: Range, text: []u8) Data {
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
