const clap = @import("../clap.zig");
const bun = @import("bun");
const std = @import("std");

const debug = std.debug;
const mem = std.mem;

/// Deprecated: Use `parseEx` instead
pub fn ComptimeClap(
    comptime Id: type,
    comptime params: []const clap.Param(Id),
) type {
    var _flags: usize = 0;
    var _single_options: usize = 0;
    var _multi_options: usize = 0;
    var _converted_params: []const clap.Param(usize) = &[_]clap.Param(usize){};
    for (params) |param| {
        var index: usize = 0;
        if (param.names.long != null or param.names.short != null) {
            const ptr = switch (param.takes_value) {
                .none => &_flags,
                .one_optional, .one => &_single_options,
                .many => &_multi_options,
            };
            index = ptr.*;
            ptr.* += 1;
        }

        const converted = clap.Param(usize){
            .id = index,
            .names = param.names,
            .takes_value = param.takes_value,
        };
        _converted_params = _converted_params ++ [_]clap.Param(usize){converted};
    }
    const flags = _flags;
    const single_options = _single_options;
    const multi_options = _multi_options;
    const converted_params = _converted_params;

    return struct {
        single_options: [single_options]?[]const u8,
        multi_options: [multi_options][]const []const u8,
        flags: [flags]bool,
        pos: []const []const u8,
        passthrough_positionals: []const []const u8,
        allocator: mem.Allocator,

        pub fn parse(iter: anytype, opt: clap.ParseOptions) !@This() {
            const allocator = opt.allocator;
            var multis = [_]std.ArrayList([]const u8){undefined} ** multi_options;
            for (&multis) |*multi| {
                multi.* = std.ArrayList([]const u8).init(allocator);
            }

            var pos = std.ArrayList([]const u8).init(allocator);
            var passthrough_positionals = std.ArrayList([]const u8).init(allocator);

            var res = @This(){
                .single_options = [_]?[]const u8{null} ** single_options,
                .multi_options = [_][]const []const u8{undefined} ** multi_options,
                .flags = [_]bool{false} ** flags,
                .pos = undefined,
                .allocator = allocator,
                .passthrough_positionals = undefined,
            };

            var stream = clap.StreamingClap(usize, @typeInfo(@TypeOf(iter)).pointer.child){
                .params = converted_params,
                .iter = iter,
                .diagnostic = opt.diagnostic,
            };

            while (try stream.next()) |arg| {
                const param = arg.param;
                if (param.names.long == null and param.names.short == null) {
                    try pos.append(arg.value.?);
                    if (opt.stop_after_positional_at > 0 and pos.items.len >= opt.stop_after_positional_at) {
                        var remaining_ = stream.iter.remain;
                        const first: []const u8 = if (remaining_.len > 0) bun.span(remaining_[0]) else "";
                        if (first.len > 0 and std.mem.eql(u8, first, "--")) {
                            remaining_ = remaining_[1..];
                        }

                        try passthrough_positionals.ensureTotalCapacityPrecise(remaining_.len);
                        for (remaining_) |arg_| {
                            // use bun.span due to the optimization for long strings
                            passthrough_positionals.appendAssumeCapacity(bun.span(arg_));
                        }
                        break;
                    }
                } else if (param.takes_value == .one or param.takes_value == .one_optional) {
                    debug.assert(res.single_options.len != 0);
                    if (res.single_options.len != 0)
                        res.single_options[param.id] = arg.value orelse "";
                } else if (param.takes_value == .many) {
                    debug.assert(multis.len != 0);
                    if (multis.len != 0)
                        try multis[param.id].append(arg.value.?);
                } else {
                    debug.assert(res.flags.len != 0);
                    if (res.flags.len != 0)
                        res.flags[param.id] = true;
                }
            }

            for (&multis, 0..) |*multi, i|
                res.multi_options[i] = try multi.toOwnedSlice();
            res.pos = try pos.toOwnedSlice();
            res.passthrough_positionals = try passthrough_positionals.toOwnedSlice();
            return res;
        }

        pub fn deinit(parser: @This()) void {
            for (parser.multi_options) |o|
                parser.allocator.free(o);
            parser.allocator.free(parser.pos);
        }

        pub fn flag(parser: @This(), comptime name: []const u8) bool {
            const param = comptime findParam(name);
            if (param.takes_value != .none and param.takes_value != .one_optional)
                @compileError(name ++ " is an option and not a flag.");

            return parser.flags[param.id];
        }

        pub fn option(parser: @This(), comptime name: []const u8) ?[]const u8 {
            const param = comptime findParam(name);
            if (param.takes_value == .none)
                @compileError(name ++ " is a flag and not an option.");
            if (param.takes_value == .many)
                @compileError(name ++ " takes many options, not one.");
            return parser.single_options[param.id];
        }

        pub fn options(parser: @This(), comptime name: []const u8) []const []const u8 {
            const param = comptime findParam(name);
            if (param.takes_value == .none)
                @compileError(name ++ " is a flag and not an option.");
            if (param.takes_value == .one or param.takes_value == .one_optional)
                @compileError(name ++ " takes one option, not multiple.");

            return parser.multi_options[param.id];
        }

        pub fn positionals(parser: @This()) []const []const u8 {
            return parser.pos;
        }

        pub fn remaining(parser: @This()) []const []const u8 {
            return parser.passthrough_positionals;
        }

        pub fn hasFlag(comptime name: []const u8) bool {
            comptime {
                for (converted_params) |param| {
                    if (param.names.short) |s| {
                        if (mem.eql(u8, name, "-" ++ [_]u8{s}))
                            return true;
                    }
                    if (param.names.long) |l| {
                        if (mem.eql(u8, name, "--" ++ l))
                            return true;
                    }
                }

                return false;
            }
        }

        fn findParam(comptime name: []const u8) clap.Param(usize) {
            comptime {
                for (converted_params) |param| {
                    if (param.names.short) |s| {
                        if (mem.eql(u8, name, "-" ++ [_]u8{s}))
                            return param;
                    }
                    if (param.names.long) |l| {
                        if (mem.eql(u8, name, "--" ++ l))
                            return param;
                    }
                }

                @compileError(name ++ " is not a parameter.");
            }
        }
    };
}
