const std = @import("std");

const debug = std.debug;
const heap = std.heap;
const io = std.io;
const mem = std.mem;
const testing = std.testing;

pub const args = @import("clap/args.zig");

test "clap" {
    testing.refAllDecls(@This());
}

pub const ComptimeClap = @import("clap/comptime.zig").ComptimeClap;
pub const StreamingClap = @import("clap/streaming.zig").StreamingClap;

/// The names a ::Param can have.
pub const Names = struct {
    /// '-' prefix
    short: ?u8 = null,

    /// '--' prefix
    long: ?[]const u8 = null,
};

/// Whether a param takes no value (a flag), one value, or can be specified multiple times.
pub const Values = enum {
    none,
    one,
    many,
    one_optional,
};

/// Represents a parameter for the command line.
/// Parameters come in three kinds:
///   * Short ("-a"): Should be used for the most commonly used parameters in your program.
///     * They can take a value three different ways.
///       * "-a value"
///       * "-a=value"
///       * "-avalue"
///     * They chain if they don't take values: "-abc".
///       * The last given parameter can take a value in the same way that a single parameter can:
///         * "-abc value"
///         * "-abc=value"
///         * "-abcvalue"
///   * Long ("--long-param"): Should be used for less common parameters, or when no single character
///                            can describe the paramter.
///     * They can take a value two different ways.
///       * "--long-param value"
///       * "--long-param=value"
///   * Positional: Should be used as the primary parameter of the program, like a filename or
///                 an expression to parse.
///     * Positional parameters have both names.long and names.short == null.
///     * Positional parameters must take a value.
pub fn Param(comptime Id: type) type {
    return struct {
        id: Id = Id{},
        names: Names = Names{},
        takes_value: Values = .none,
    };
}

/// Takes a string and parses it to a Param(Help).
/// This is the reverse of 'help' but for at single parameter only.
pub fn parseParam(line: []const u8) !Param(Help) {
    @setEvalBranchQuota(999999);

    var found_comma = false;
    var it = mem.tokenize(u8, line, " \t");
    var param_str = it.next() orelse return error.NoParamFound;

    const short_name = if (!mem.startsWith(u8, param_str, "--") and
        mem.startsWith(u8, param_str, "-"))
    blk: {
        found_comma = param_str[param_str.len - 1] == ',';
        if (found_comma)
            param_str = param_str[0 .. param_str.len - 1];

        if (param_str.len != 2)
            return error.InvalidShortParam;

        const short_name = param_str[1];
        if (!found_comma) {
            var res = parseParamRest(it.rest());
            res.names.short = short_name;
            return res;
        }

        param_str = it.next() orelse return error.NoParamFound;
        break :blk short_name;
    } else null;

    _ = if (mem.startsWith(u8, param_str, "--")) {
        if (param_str[param_str.len - 1] == ',')
            return error.TrailingComma;
    } else if (found_comma) {
        return error.TrailingComma;
    } else if (short_name == null) {
        return parseParamRest(mem.trimLeft(u8, line, " \t"));
    } else null;

    var res = parseParamRest(it.rest());
    res.names.long = param_str[2..];
    res.names.short = short_name;
    return res;
}

fn parseParamRest(line: []const u8) Param(Help) {
    if (mem.startsWith(u8, line, "<")) blk: {
        const len = mem.indexOfScalar(u8, line, '>') orelse break :blk;
        const takes_many = mem.startsWith(u8, line[len + 1 ..], "...");
        const takes_one_optional = mem.startsWith(u8, line[len + 1 ..], "?");
        const help_start = len + 1 + @as(usize, 3) * @boolToInt(takes_many) + (@as(usize, 1) * @boolToInt(takes_one_optional));
        return .{
            .takes_value = if (takes_many) Values.many else if (takes_one_optional) Values.one_optional else Values.one,
            .id = .{
                .msg = mem.trim(u8, line[help_start..], " \t"),
                .value = line[1..len],
            },
        };
    }

    return .{ .id = .{ .msg = mem.trim(u8, line, " \t") } };
}

fn expectParam(expect: Param(Help), actual: Param(Help)) void {
    testing.expectEqualStrings(expect.id.msg, actual.id.msg);
    testing.expectEqualStrings(expect.id.value, actual.id.value);
    testing.expectEqual(expect.names.short, actual.names.short);
    testing.expectEqual(expect.takes_value, actual.takes_value);
    if (expect.names.long) |long| {
        testing.expectEqualStrings(long, actual.names.long.?);
    } else {
        testing.expectEqual(@as(?[]const u8, null), actual.names.long);
    }
}

test "parseParam" {
    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "value" },
        .names = .{ .short = 's', .long = "long" },
        .takes_value = .one,
    }, try parseParam("-s, --long <value> Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "value" },
        .names = .{ .short = 's', .long = "long" },
        .takes_value = .many,
    }, try parseParam("-s, --long <value>... Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "value" },
        .names = .{ .long = "long" },
        .takes_value = .one,
    }, try parseParam("--long <value> Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "value" },
        .names = .{ .short = 's' },
        .takes_value = .one,
    }, try parseParam("-s <value> Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text" },
        .names = .{ .short = 's', .long = "long" },
    }, try parseParam("-s, --long Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text" },
        .names = .{ .short = 's' },
    }, try parseParam("-s Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text" },
        .names = .{ .long = "long" },
    }, try parseParam("--long Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "A | B" },
        .names = .{ .long = "long" },
        .takes_value = .one,
    }, try parseParam("--long <A | B> Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "A" },
        .names = .{},
        .takes_value = .one,
    }, try parseParam("<A> Help text"));

    expectParam(Param(Help){
        .id = .{ .msg = "Help text", .value = "A" },
        .names = .{},
        .takes_value = .many,
    }, try parseParam("<A>... Help text"));

    testing.expectError(error.TrailingComma, parseParam("--long, Help"));
    testing.expectError(error.TrailingComma, parseParam("-s, Help"));
    testing.expectError(error.InvalidShortParam, parseParam("-ss Help"));
    testing.expectError(error.InvalidShortParam, parseParam("-ss <value> Help"));
    testing.expectError(error.InvalidShortParam, parseParam("- Help"));
}

/// Optional diagnostics used for reporting useful errors
pub const Diagnostic = struct {
    arg: []const u8 = "",
    name: Names = Names{},

    /// Default diagnostics reporter when all you want is English with no colors.
    /// Use this as a reference for implementing your own if needed.
    pub fn report(diag: Diagnostic, stream: anytype, err: anyerror) !void {
        const Arg = struct {
            prefix: []const u8,
            name: []const u8,
        };
        const a = if (diag.name.short) |*c|
            Arg{ .prefix = "-", .name = @as(*const [1]u8, c)[0..] }
        else if (diag.name.long) |l|
            Arg{ .prefix = "--", .name = l }
        else
            Arg{ .prefix = "", .name = diag.arg };

        switch (err) {
            error.DoesntTakeValue => try stream.print("The argument '{s}{s}' does not take a value\n", .{ a.prefix, a.name }),
            error.MissingValue => try stream.print("The argument '{s}{s}' requires a value but none was supplied\n", .{ a.prefix, a.name }),
            error.InvalidArgument => if (a.prefix.len > 0 and a.name.len > 0)
                try stream.print("Invalid argument '{s}{s}'\n", .{ a.prefix, a.name })
            else
                try stream.print("Failed to parse argument due to unexpected single dash\n", .{}),
            else => try stream.print("Error while parsing arguments: {s}\n", .{@errorName(err)}),
        }
    }
};

fn testDiag(diag: Diagnostic, err: anyerror, expected: []const u8) void {
    var buf: [1024]u8 = undefined;
    var slice_stream = io.fixedBufferStream(&buf);
    diag.report(slice_stream.writer(), err) catch unreachable;
    testing.expectEqualStrings(expected, slice_stream.getWritten());
}

pub fn Args(comptime Id: type, comptime params: []const Param(Id)) type {
    return struct {
        arena: std.heap.ArenaAllocator,
        clap: ComptimeClap(Id, params),
        exe_arg: ?[]const u8,

        pub fn deinit(a: *@This()) void {
            a.arena.deinit();
        }

        pub fn flag(a: @This(), comptime name: []const u8) bool {
            return a.clap.flag(name);
        }

        pub fn option(a: @This(), comptime name: []const u8) ?[]const u8 {
            return a.clap.option(name);
        }

        pub fn options(a: @This(), comptime name: []const u8) []const []const u8 {
            return a.clap.options(name);
        }

        pub fn positionals(a: @This()) []const []const u8 {
            return a.clap.positionals();
        }

        pub fn remaining(a: @This()) []const []const u8 {
            return a.clap.remaining();
        }

        pub fn hasFlag(comptime name: []const u8) bool {
            return ComptimeClap(Id, params).hasFlag(name);
        }
    };
}

/// Options that can be set to customize the behavior of parsing.
pub const ParseOptions = struct {
    /// The allocator used for all memory allocations. Defaults to the `heap.page_allocator`.
    /// Note: You should probably override this allocator if you are calling `parseEx`. Unlike
    ///       `parse`, `parseEx` does not wrap the allocator so the heap allocator can be
    ///       quite expensive. (TODO: Can we pick a better default? For `parse`, this allocator
    ///       is fine, as it wraps it in an arena)
    allocator: mem.Allocator = heap.page_allocator,
    diagnostic: ?*Diagnostic = null,
    stop_after_positional_at: usize = 0,
};

/// Same as `parseEx` but uses the `args.OsIterator` by default.
pub fn parse(
    comptime Id: type,
    comptime params: []const Param(Id),
    opt: ParseOptions,
) !Args(Id, params) {
    var iter = args.OsIterator.init(opt.allocator);
    var res = Args(Id, params){
        .arena = iter.arena,
        .exe_arg = iter.exe_arg,
        .clap = undefined,
    };

    // Let's reuse the arena from the `OSIterator` since we already have
    // it.
    res.clap = try parseEx(Id, params, &iter, .{
        .allocator = res.arena.allocator(),
        .diagnostic = opt.diagnostic,
        .stop_after_positional_at = opt.stop_after_positional_at,
    });
    return res;
}

/// Parses the command line arguments passed into the program based on an
/// array of `Param`s.
pub fn parseEx(
    comptime Id: type,
    comptime params: []const Param(Id),
    iter: anytype,
    opt: ParseOptions,
) !ComptimeClap(Id, params) {
    const Clap = ComptimeClap(Id, params);
    return try Clap.parse(iter, opt);
}

/// Will print a help message in the following format:
///     -s, --long <valueText> helpText
///     -s,                    helpText
///     -s <valueText>         helpText
///         --long             helpText
///         --long <valueText> helpText
pub fn helpFull(
    stream: anytype,
    comptime Id: type,
    params: []const Param(Id),
    comptime Error: type,
    context: anytype,
    helpText: fn (@TypeOf(context), Param(Id)) Error![]const u8,
    valueText: fn (@TypeOf(context), Param(Id)) Error![]const u8,
) !void {
    const max_spacing = blk: {
        var res: usize = 0;
        for (params) |param| {
            var cs = io.countingWriter(io.null_writer);
            try printParam(cs.writer(), Id, param, Error, context, valueText);
            if (res < cs.bytes_written)
                res = @intCast(usize, cs.bytes_written);
        }

        break :blk res;
    };

    for (params) |param| {
        if (param.names.short == null and param.names.long == null)
            continue;

        var cs = io.countingWriter(stream);
        try stream.print("\t", .{});
        try printParam(cs.writer(), Id, param, Error, context, valueText);
        try stream.writeByteNTimes(' ', max_spacing - @intCast(usize, cs.bytes_written));
        try stream.print("\t{s}\n", .{try helpText(context, param)});
    }
}

fn printParam(
    stream: anytype,
    comptime Id: type,
    param: Param(Id),
    comptime Error: type,
    context: anytype,
    valueText: fn (@TypeOf(context), Param(Id)) Error![]const u8,
) !void {
    if (param.names.short) |s| {
        try stream.print("-{c}", .{s});
    } else {
        try stream.print("  ", .{});
    }
    if (param.names.long) |l| {
        if (param.names.short) |_| {
            try stream.print(", ", .{});
        } else {
            try stream.print("  ", .{});
        }

        try stream.print("--{s}", .{l});
    }

    switch (param.takes_value) {
        .none => {},
        .one => try stream.print(" <{s}>", .{valueText(context, param)}),
        .one_optional => try stream.print(" <{s}>?", .{valueText(context, param)}),
        .many => try stream.print(" <{s}>...", .{valueText(context, param)}),
    }
}

/// A wrapper around helpFull for simple helpText and valueText functions that
/// cant return an error or take a context.
pub fn helpEx(
    stream: anytype,
    comptime Id: type,
    params: []const Param(Id),
    helpText: fn (Param(Id)) []const u8,
    valueText: fn (Param(Id)) []const u8,
) !void {
    const Context = struct {
        helpText: fn (Param(Id)) []const u8,
        valueText: fn (Param(Id)) []const u8,

        pub fn help(c: @This(), p: Param(Id)) error{}![]const u8 {
            return c.helpText(p);
        }

        pub fn value(c: @This(), p: Param(Id)) error{}![]const u8 {
            return c.valueText(p);
        }
    };

    return helpFull(
        stream,
        Id,
        params,
        error{},
        Context{
            .helpText = helpText,
            .valueText = valueText,
        },
        Context.help,
        Context.value,
    );
}

pub const Help = struct {
    msg: []const u8 = "",
    value: []const u8 = "",
};

/// A wrapper around helpEx that takes a Param(Help).
pub fn help(stream: anytype, params: []const Param(Help)) !void {
    try helpEx(stream, Help, params, getHelpSimple, getValueSimple);
}

fn getHelpSimple(param: Param(Help)) []const u8 {
    return param.id.msg;
}

fn getValueSimple(param: Param(Help)) []const u8 {
    return param.id.value;
}

/// Will print a usage message in the following format:
/// [-abc] [--longa] [-d <valueText>] [--longb <valueText>] <valueText>
///
/// First all none value taking parameters, which have a short name are
/// printed, then non positional parameters and finally the positinal.
pub fn usageFull(
    stream: anytype,
    comptime Id: type,
    params: []const Param(Id),
    comptime Error: type,
    context: anytype,
    valueText: fn (@TypeOf(context), Param(Id)) Error![]const u8,
) !void {
    var cos = io.countingWriter(stream);
    const cs = cos.writer();
    for (params) |param| {
        const name = param.names.short orelse continue;
        if (param.takes_value != .none)
            continue;

        if (cos.bytes_written == 0)
            try stream.writeAll("[-");
        try cs.writeByte(name);
    }
    if (cos.bytes_written != 0)
        try cs.writeByte(']');

    var positional: ?Param(Id) = null;
    for (params) |param| {
        if (param.takes_value == .none and param.names.short != null)
            continue;

        const prefix = if (param.names.short) |_| "-" else "--";

        // Seems the zig compiler is being a little wierd. I doesn't allow me to write
        // @as(*const [1]u8, s)                  VVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
        const name = if (param.names.short) |*s| @ptrCast([*]const u8, s)[0..1] else param.names.long orelse {
            positional = param;
            continue;
        };
        if (cos.bytes_written != 0)
            try cs.writeByte(' ');

        try cs.print("[{s}{s}", .{ prefix, name });
        switch (param.takes_value) {
            .none => {},
            .one => try cs.print(" <{s}>", .{try valueText(context, param)}),
            .one_optional => try cs.print(" <{s}>?", .{try valueText(context, param)}),
            .many => try cs.print(" <{s}>...", .{try valueText(context, param)}),
        }

        try cs.writeByte(']');
    }

    if (positional) |p| {
        if (cos.bytes_written != 0)
            try cs.writeByte(' ');
        try cs.print("<{s}>", .{try valueText(context, p)});
    }
}

/// A wrapper around usageFull for a simple valueText functions that
/// cant return an error or take a context.
pub fn usageEx(
    stream: anytype,
    comptime Id: type,
    params: []const Param(Id),
    valueText: fn (Param(Id)) []const u8,
) !void {
    const Context = struct {
        valueText: fn (Param(Id)) []const u8,

        pub fn value(c: @This(), p: Param(Id)) error{}![]const u8 {
            return c.valueText(p);
        }
    };

    return usageFull(
        stream,
        Id,
        params,
        error{},
        Context{ .valueText = valueText },
        Context.value,
    );
}

/// A wrapper around usageEx that takes a Param(Help).
pub fn usage(stream: anytype, params: []const Param(Help)) !void {
    try usageEx(stream, Help, params, getValueSimple);
}

fn testUsage(expected: []const u8, params: []const Param(Help)) !void {
    var buf: [1024]u8 = undefined;
    var fbs = io.fixedBufferStream(&buf);
    try usage(fbs.writer(), params);
    testing.expectEqualStrings(expected, fbs.getWritten());
}
