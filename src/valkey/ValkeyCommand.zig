const Command = @This();

command: []const u8,
args: Args,
meta: Meta = .{},

pub const Args = union(enum) {
    slices: []const Slice,
    args: []const node.BlobOrStringOrBuffer,
    raw: []const []const u8,

    pub fn len(this: *const @This()) usize {
        return switch (this.*) {
            inline .slices, .args, .raw => |args| args.len,
        };
    }
};

pub fn write(this: *const Command, writer: anytype) !void {
    // Serialize as RESP array format directly
    try writer.print("*{d}\r\n", .{1 + this.args.len()});
    try writer.print("${d}\r\n{s}\r\n", .{ this.command.len, this.command });

    switch (this.args) {
        inline .slices, .args => |args| {
            for (args) |*arg| {
                try writer.print("${d}\r\n{s}\r\n", .{ arg.byteLength(), arg.slice() });
            }
        },
        .raw => |args| {
            for (args) |arg| {
                try writer.print("${d}\r\n{s}\r\n", .{ arg.len, arg });
            }
        },
    }
}

pub fn format(this: Command, writer: *std.Io.Writer) !void {
    try this.write(writer);
}

pub fn byteLength(this: *const Command) usize {
    return std.fmt.count("{f}", .{this.*});
}

pub fn serialize(this: *const Command, allocator: std.mem.Allocator) ![]u8 {
    var buf = try std.array_list.Managed(u8).initCapacity(allocator, this.byteLength());
    errdefer buf.deinit();
    try this.write(buf.writer());
    return buf.items;
}

/// Command stored in offline queue when disconnected
pub const Entry = struct {
    serialized_data: []u8, // Pre-serialized RESP protocol bytes
    meta: Meta = .{},
    promise: Promise,

    pub const Queue = bun.LinearFifo(Entry, .Dynamic);

    pub fn deinit(self: *@This(), allocator: std.mem.Allocator) void {
        allocator.free(self.serialized_data);
    }

    // Create an Offline by serializing the Valkey command directly
    pub fn create(
        allocator: std.mem.Allocator,
        command: *const Command,
        promise: Promise,
    ) !Entry {
        return Entry{
            .serialized_data = try command.serialize(allocator),
            .meta = command.meta, // TODO(markovejnovic): We should be calling .check against command here but due
            // to a hack introduced to let SUBSCRIBE work, we are not doing that for now.
            .promise = promise,
        };
    }
};

pub fn deinit(_: *Command) void {
    // no-op
}

pub const Meta = packed struct(u8) {
    return_as_bool: bool = false,
    supports_auto_pipelining: bool = true,
    return_as_buffer: bool = false,
    subscription_request: bool = false,
    _padding: u4 = 0,

    const not_allowed_autopipeline_commands = bun.ComptimeStringMap(void, .{
        .{"AUTH"},
        .{"INFO"},
        .{"QUIT"},
        .{"EXEC"},
        .{"MULTI"},
        .{"WATCH"},
        .{"SCRIPT"},
        .{"SELECT"},
        .{"CLUSTER"},
        .{"DISCARD"},
        .{"UNWATCH"},
        .{"PIPELINE"},
        .{"SUBSCRIBE"},
        .{"PSUBSCRIBE"},
        .{"UNSUBSCRIBE"},
        .{"UNPSUBSCRIBE"},
    });

    pub fn check(self: @This(), command: *const Command) @This() {
        var new = self;
        new.supports_auto_pipelining = !not_allowed_autopipeline_commands.has(command.command);
        return new;
    }
};

/// Promise for a Valkey command
pub const Promise = struct {
    meta: Meta,
    promise: jsc.JSPromise.Strong,

    pub fn create(globalObject: *jsc.JSGlobalObject, meta: Meta) Promise {
        const promise = jsc.JSPromise.Strong.init(globalObject);
        return Promise{
            .meta = meta,
            .promise = promise,
        };
    }

    pub fn resolve(self: *Promise, globalObject: *jsc.JSGlobalObject, value: *protocol.RESPValue) bun.JSTerminated!void {
        const options = protocol.RESPValue.ToJSOptions{
            .return_as_buffer = self.meta.return_as_buffer,
        };

        const js_value = value.toJSWithOptions(globalObject, options) catch |err| {
            try self.reject(globalObject, globalObject.takeError(err));
            return;
        };
        try self.promise.resolve(globalObject, js_value);
    }

    pub fn reject(self: *Promise, globalObject: *jsc.JSGlobalObject, jsvalue: JSError!jsc.JSValue) bun.JSTerminated!void {
        try self.promise.reject(globalObject, jsvalue);
    }

    pub fn deinit(self: *Promise) void {
        self.promise.deinit();
    }
};

// Command+Promise pair for tracking which command corresponds to which promise
pub const PromisePair = struct {
    meta: Meta,
    promise: Promise,

    pub const Queue = bun.LinearFifo(PromisePair, .Dynamic);

    pub fn rejectCommand(self: *PromisePair, globalObject: *jsc.JSGlobalObject, jsvalue: jsc.JSValue) bun.JSTerminated!void {
        try self.promise.reject(globalObject, jsvalue);
    }
};

const protocol = @import("./valkey_protocol.zig");
const std = @import("std");

const bun = @import("bun");
const JSError = bun.JSError;
const jsc = bun.jsc;
const node = bun.api.node;
const Slice = jsc.ZigString.Slice;
