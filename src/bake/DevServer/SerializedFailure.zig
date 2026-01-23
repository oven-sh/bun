/// Errors sent to the HMR client in the browser are serialized. The same format
/// is used for thrown JavaScript exceptions as well as bundler errors.
/// Serialized failures contain a handle on what file or route they came from,
/// which allows the bundler to dismiss or update stale failures via index as
/// opposed to re-sending a new payload. This also means only changed files are
/// rebuilt, instead of all of the failed files.
///
/// The HMR client in the browser is expected to sort the final list of errors
/// for deterministic output; there is code in DevServer that uses `swapRemove`.
pub const SerializedFailure = @This();

/// Serialized data is always owned by dev.allocator()
/// The first 32 bits of this slice contain the owner
data: []u8,

pub fn deinit(f: SerializedFailure, dev: *DevServer) void {
    dev.allocator().free(f.data);
}

/// The metaphorical owner of an incremental file error. The packed variant
/// is given to the HMR runtime as an opaque handle.
pub const Owner = union(enum) {
    none,
    route: RouteBundle.Index,
    client: IncrementalGraph(.client).FileIndex,
    server: IncrementalGraph(.server).FileIndex,

    pub fn encode(owner: Owner) Packed {
        return switch (owner) {
            .none => .{ .kind = .none, .data = 0 },
            .client => |data| .{ .kind = .client, .data = data.get() },
            .server => |data| .{ .kind = .server, .data = data.get() },
            .route => |data| .{ .kind = .route, .data = data.get() },
        };
    }

    pub const Packed = packed struct(u32) {
        data: u30,
        kind: enum(u2) { none, route, client, server },

        pub fn decode(owner: Packed) Owner {
            return switch (owner.kind) {
                .none => .none,
                .client => .{ .client = IncrementalGraph(.client).FileIndex.init(owner.data) },
                .server => .{ .server = IncrementalGraph(.server).FileIndex.init(owner.data) },
                .route => .{ .route = RouteBundle.Index.init(owner.data) },
            };
        }

        comptime {
            assert(@as(u32, @bitCast(Packed{ .kind = .none, .data = 1 })) == 1);
        }
    };
};

pub fn getOwner(failure: SerializedFailure) Owner {
    return std.mem.bytesAsValue(Owner.Packed, failure.data[0..4]).decode();
}

/// This assumes the hash map contains only one SerializedFailure per owner.
/// This is okay since SerializedFailure can contain more than one error.
pub const ArrayHashContextViaOwner = struct {
    pub fn hash(_: ArrayHashContextViaOwner, k: SerializedFailure) u32 {
        return std.hash.int(@as(u32, @bitCast(k.getOwner().encode())));
    }

    pub fn eql(_: ArrayHashContextViaOwner, a: SerializedFailure, b: SerializedFailure, _: usize) bool {
        return @as(u32, @bitCast(a.getOwner().encode())) == @as(u32, @bitCast(b.getOwner().encode()));
    }
};

pub const ArrayHashAdapter = struct {
    pub fn hash(_: ArrayHashAdapter, own: Owner) u32 {
        return std.hash.int(@as(u32, @bitCast(own.encode())));
    }

    pub fn eql(_: ArrayHashAdapter, a: Owner, b: SerializedFailure, _: usize) bool {
        return @as(u32, @bitCast(a.encode())) == @as(u32, @bitCast(b.getOwner().encode()));
    }
};

pub const ErrorKind = enum(u8) {
    // A log message. The `logger.Kind` is encoded here.
    bundler_log_err = 0,
    bundler_log_warn = 1,
    bundler_log_note = 2,
    bundler_log_debug = 3,
    bundler_log_verbose = 4,

    /// new Error(message)
    js_error,
    /// new TypeError(message)
    js_error_type,
    /// new RangeError(message)
    js_error_range,
    /// Other forms of `Error` objects, including when an error has a
    /// `code`, and other fields.
    js_error_extra,
    /// Non-error with a stack trace
    js_primitive_exception,
    /// Non-error JS values
    js_primitive,
    /// new AggregateError(errors, message)
    js_aggregate,
};

pub fn initFromLog(
    dev: *DevServer,
    owner: Owner,
    // for .client and .server, these are meant to be relative file paths
    owner_display_name: []const u8,
    messages: []const bun.logger.Msg,
) !SerializedFailure {
    assert(messages.len > 0);

    // Avoid small re-allocations without requesting so much from the heap
    var sfb = std.heap.stackFallback(65536, dev.allocator());
    var payload = std.array_list.Managed(u8).initCapacity(sfb.get(), 65536) catch
        unreachable; // enough space
    const w = payload.writer();

    try w.writeInt(u32, @bitCast(owner.encode()), .little);

    try writeString32(owner_display_name, w);

    try w.writeInt(u32, @intCast(messages.len), .little);

    for (messages) |*msg| {
        try writeLogMsg(msg, w);
    }

    // Avoid-recloning if it is was moved to the hap
    const data = if (payload.items.ptr == &sfb.buffer)
        try dev.allocator().dupe(u8, payload.items)
    else
        payload.items;

    return .{ .data = data };
}

// All "write" functions get a corresponding "read" function in ./client/error.ts

const Writer = std.array_list.Managed(u8).Writer;

fn writeLogMsg(msg: *const bun.logger.Msg, w: Writer) !void {
    try w.writeByte(switch (msg.kind) {
        inline else => |k| @intFromEnum(@field(ErrorKind, "bundler_log_" ++ @tagName(k))),
    });
    try writeLogData(msg.data, w);
    const notes = msg.notes;
    try w.writeInt(u32, @intCast(notes.len), .little);
    for (notes) |note| {
        try writeLogData(note, w);
    }
}

fn writeLogData(data: bun.logger.Data, w: Writer) !void {
    try writeString32(data.text, w);
    if (data.location) |loc| {
        if (loc.line < 0) {
            try w.writeInt(u32, 0, .little);
            return;
        }
        assert(loc.column >= 0); // zero based and not negative

        try w.writeInt(i32, @intCast(loc.line), .little);
        try w.writeInt(u32, @intCast(loc.column), .little);
        try w.writeInt(u32, @intCast(loc.length), .little);

        // TODO: syntax highlighted line text + give more context lines
        try writeString32(loc.line_text orelse "", w);

        // The file is not specified here. Since the transpiler runs every file
        // in isolation, it would be impossible to reference any other file
        // in this Log. Thus, it is not serialized.
    } else {
        try w.writeInt(u32, 0, .little);
    }
}

fn writeString32(data: []const u8, w: Writer) !void {
    try w.writeInt(u32, @intCast(data.len), .little);
    try w.writeAll(data);
}

// fn writeJsValue(value: JSValue, global: *jsc.JSGlobalObject, w: *Writer) !void {
//     if (value.isAggregateError(global)) {
//         //
//     }
//     if (value.jsType() == .DOMWrapper) {
//         if (value.as(bun.api.BuildMessage)) |build_error| {
//             _ = build_error; // autofix
//             //
//         } else if (value.as(bun.api.ResolveMessage)) |resolve_error| {
//             _ = resolve_error; // autofix
//             @panic("TODO");
//         }
//     }
//     _ = w; // autofix

//     @panic("TODO");
// }

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const bake = bun.bake;
const Log = bun.logger.Log;

const DevServer = bake.DevServer;
const IncrementalGraph = DevServer.IncrementalGraph;
const RouteBundle = DevServer.RouteBundle;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
