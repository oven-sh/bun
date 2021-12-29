const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");

pub fn ColonListType(comptime t: type, value_resolver: anytype) type {
    return struct {
        pub fn init(allocator: std.mem.Allocator, count: usize) !@This() {
            var keys = try allocator.alloc(string, count);
            var values = try allocator.alloc(t, count);

            return @This(){ .keys = keys, .values = values };
        }
        keys: []string,
        values: []t,

        pub fn load(self: *@This(), input: []const string) !void {
            for (input) |str, i| {
                // Support either ":" or "=" as the separator, preferring whichever is first.
                // ":" is less confusing IMO because that syntax is used with flags
                // but "=" is what esbuild uses and I want this to be somewhat familiar for people using esbuild
                const midpoint = std.math.min(strings.indexOfChar(str, ':') orelse std.math.maxInt(usize), strings.indexOfChar(str, '=') orelse std.math.maxInt(usize));
                if (midpoint == std.math.maxInt(usize)) {
                    return error.InvalidSeparator;
                }

                self.keys[i] = str[0..midpoint];
                self.values[i] = try value_resolver(str[midpoint + 1 .. str.len]);
            }
        }

        pub fn resolve(allocator: std.mem.Allocator, input: []const string) !@This() {
            var list = try init(allocator, input.len);
            try list.load(input);
            return list;
        }
    };
}
