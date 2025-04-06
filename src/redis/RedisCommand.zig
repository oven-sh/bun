command: []const u8,
args: Args,
command_type: Type,

pub const Args = union(enum) {
    slices: []const Slice,
    raw: []const []const u8,

    pub fn len(this: *const @This()) usize {
        return switch (this.*) {
            .slices => |args| args.len,
            .raw => |args| args.len,
        };
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .slices => |args| {
                for (args) |*arg| {
                    arg.deinit();
                }
            },
            .raw => {}, // lifetime is not owned by this command.
        }
    }
};

pub fn write(this: *const Command, writer: anytype) !void {
    // Serialize as RESP array format directly
    try writer.print("*{d}\r\n", .{1 + this.args.len()});
    try writer.print("${d}\r\n{s}\r\n", .{ this.command.len, this.command });

    switch (this.args) {
        .slices => |args| {
            for (args) |arg| {
                try writer.print("${d}\r\n{s}\r\n", .{ arg.len, arg.slice() });
            }
        },
        .raw => |args| {
            for (args) |arg| {
                try writer.print("${d}\r\n{s}\r\n", .{ arg.len, arg });
            }
        },
    }
}

pub fn format(this: Command, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
    try this.write(writer);
}

pub fn byteLength(this: *const Command) usize {
    return std.fmt.count("{}", .{this.*});
}

pub fn serialize(this: *const Command, allocator: std.mem.Allocator) ![]u8 {
    var buf = try std.ArrayList(u8).initCapacity(allocator, this.byteLength());
    errdefer buf.deinit();
    try this.write(buf.writer());
    return buf.items;
}

/// Command stored in offline queue when disconnected
pub const Entry = struct {
    serialized_data: []u8, // Pre-serialized RESP protocol bytes
    command_type: Type,
    promise: Promise,

    pub const Queue = std.fifo.LinearFifo(Entry, .Dynamic);

    pub fn deinit(self: *const @This(), allocator: std.mem.Allocator) void {
        allocator.free(self.serialized_data);
    }

    // Create an Offline by serializing the Redis command directly
    pub fn create(
        allocator: std.mem.Allocator,
        command: *const Command,
        promise: Promise,
    ) !Entry {
        return Entry{
            .serialized_data = try command.serialize(allocator),
            .command_type = command.command_type,
            .promise = promise,
        };
    }
};

pub fn deinit(this: *Command) void {
    this.args.deinit();
}

/// Redis command types with special handling
pub const Type = enum {
    Generic, // Default, no special handling
    Exists, // Returns boolean (true if key exists)
};

/// Promise for a Redis command
pub const Promise = struct {
    command_type: Type,
    promise: JSC.JSPromise.Strong,

    pub fn create(globalObject: *JSC.JSGlobalObject, command_type: Type) Promise {
        const promise = JSC.JSPromise.Strong.init(globalObject);
        return Promise{
            .command_type = command_type,
            .promise = promise,
        };
    }

    pub fn resolve(self: *Promise, globalObject: *JSC.JSGlobalObject, value: *protocol.RESPValue) void {
        const js_value = value.toJS(globalObject) catch |err| {
            self.reject(globalObject, globalObject.takeError(err));
            return;
        };
        self.promise.resolve(globalObject, js_value);
    }

    pub fn reject(self: *Promise, globalObject: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) void {
        self.promise.reject(globalObject, jsvalue);
    }

    pub fn deinit(self: *Promise) void {
        self.promise.deinit();
    }
};

// Command+Promise pair for tracking which command corresponds to which promise
pub const PromisePair = struct {
    command_type: Type,
    promise: Promise,

    pub const Queue = std.fifo.LinearFifo(PromisePair, .Dynamic);

    pub fn rejectCommand(self: *PromisePair, globalObject: *JSC.JSGlobalObject, jsvalue: JSC.JSValue) void {
        self.promise.reject(globalObject, jsvalue);
    }
};

const Command = @This();

const bun = @import("root").bun;
const JSC = bun.JSC;
const protocol = @import("redis_protocol.zig");
const std = @import("std");
const Slice = JSC.ZigString.Slice;
