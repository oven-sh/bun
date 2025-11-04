pub const EnvPathOptions = struct {
    //
};

fn trimPathDelimiters(input: string) string {
    var trimmed = input;
    while (trimmed.len > 0 and trimmed[0] == std.fs.path.delimiter) {
        trimmed = trimmed[1..];
    }
    while (trimmed.len > 0 and trimmed[trimmed.len - 1] == std.fs.path.delimiter) {
        trimmed = trimmed[0 .. trimmed.len - 1];
    }
    return trimmed;
}

pub fn EnvPath(comptime opts: EnvPathOptions) type {
    return struct {
        allocator: std.mem.Allocator,
        buf: std.ArrayListUnmanaged(u8) = .empty,

        pub fn init(allocator: std.mem.Allocator) @This() {
            return .{ .allocator = allocator };
        }

        pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) OOM!@This() {
            return .{ .allocator = allocator, .buf = try .initCapacity(allocator, capacity) };
        }

        pub fn deinit(this: *const @This()) void {
            @constCast(this).buf.deinit(this.allocator);
        }

        pub fn slice(this: *const @This()) string {
            return this.buf.items;
        }

        pub fn append(this: *@This(), input: anytype) OOM!void {
            const trimmed: string = switch (@TypeOf(input)) {
                []u8, []const u8 => strings.withoutTrailingSlash(trimPathDelimiters(input)),

                // assume already trimmed
                else => input.slice(),
            };

            if (trimmed.len == 0) {
                return;
            }

            if (this.buf.items.len != 0) {
                try this.buf.ensureUnusedCapacity(this.allocator, trimmed.len + 1);
                this.buf.appendAssumeCapacity(std.fs.path.delimiter);
                this.buf.appendSliceAssumeCapacity(trimmed);
            } else {
                try this.buf.appendSlice(this.allocator, trimmed);
            }
        }

        pub const PathComponentBuilder = struct {
            env_path: *EnvPath(opts),
            path_buf: AbsPath(.{ .sep = .auto }),

            pub fn append(this: *@This(), component: string) void {
                this.path_buf.append(component);
            }

            pub fn appendFmt(this: *@This(), comptime component_fmt: string, component_args: anytype) void {
                this.path_buf.appendFmt(component_fmt, component_args);
            }

            pub fn apply(this: *@This()) OOM!void {
                try this.env_path.append(&this.path_buf);
                this.path_buf.deinit();
            }
        };

        pub fn pathComponentBuilder(this: *@This()) PathComponentBuilder {
            return .{
                .env_path = this,
                .path_buf = .init(),
            };
        }
    };
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const AbsPath = bun.AbsPath;
const OOM = bun.OOM;
const strings = bun.strings;
