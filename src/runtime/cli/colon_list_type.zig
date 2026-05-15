pub fn ColonListType(comptime t: type, comptime value_resolver: anytype) type {
    return struct {
        pub fn init(allocator: std.mem.Allocator, count: usize) !@This() {
            const keys = try allocator.alloc(string, count);
            const values = try allocator.alloc(t, count);

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

                if (comptime t == bun.schema.api.Loader) {
                    if (str[0..midpoint].len > 0 and str[0] != '.') {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> <b>file extension must start with a '.'<r> <d>(while mapping loader {f})<r>", .{bun.fmt.quote(str)});
                        Global.exit(1);
                    }
                }

                self.keys[i] = str[0..midpoint];
                self.values[i] = value_resolver(str[midpoint + 1 .. str.len]) catch |err| {
                    if (err == error.InvalidLoader) {
                        Output.prettyErrorln("<r><red>error<r><d>:<r> <b>invalid loader {f}<r>, expected one of:{f}", .{ bun.fmt.quote(str[midpoint + 1 .. str.len]), bun.fmt.enumTagList(bun.options.Loader, .dash) });
                        Global.exit(1);
                    }
                    return err;
                };
            }
        }

        pub fn resolve(allocator: std.mem.Allocator, input: []const string) !@This() {
            var list = try init(allocator, input.len);
            list.load(input) catch |err| {
                if (err == error.InvalidSeparator) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> expected \":\" separator", .{});
                    Global.exit(1);
                }

                return err;
            };
            return list;
        }
    };
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const Output = bun.Output;
const strings = bun.strings;
