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
const std = @import("std");

pub fn ColonListType(comptime t: type, comptime value_resolver: anytype) type {
    return struct {
        pub fn init(allocator: std.mem.Allocator, count: usize) !@This() {
            var keys = try allocator.alloc(string, count);
            var values = try allocator.alloc(t, count);

            return @This(){ .keys = keys, .values = values };
        }
        keys: []string,
        values: []t,

        pub fn load(self: *@This(), input: []const string) !void {
            for (input, 0..) |str, i| {
                // Support either ":" or "=" as the separator, preferring whichever is first.
                // ":" is less confusing IMO because that syntax is used with flags
                // but "=" is what esbuild uses and I want this to be somewhat familiar for people using esbuild
                const midpoint = @min(strings.indexOfChar(str, ':') orelse std.math.maxInt(u32), strings.indexOfChar(str, '=') orelse std.math.maxInt(u32));
                if (midpoint == std.math.maxInt(u32)) {
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
