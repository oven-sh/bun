pub fn NewWriterWrap(
    comptime Context: type,
    comptime offsetFn_: (fn (ctx: Context) usize),
    comptime writeFunction_: (fn (ctx: Context, bytes: []const u8) AnyMySQLError.Error!void),
    comptime pwriteFunction_: (fn (ctx: Context, bytes: []const u8, offset: usize) AnyMySQLError.Error!void),
) type {
    return struct {
        wrapped: Context,

        const writeFn = writeFunction_;
        const pwriteFn = pwriteFunction_;
        const offsetFn = offsetFn_;
        pub const Ctx = Context;

        pub const is_wrapped = true;

        pub const WrappedWriter = @This();

        pub inline fn writeLengthEncodedInt(this: @This(), data: u64) AnyMySQLError.Error!void {
            try writeFn(this.wrapped, encodeLengthInt(data).slice());
        }

        pub inline fn writeLengthEncodedString(this: @This(), data: []const u8) AnyMySQLError.Error!void {
            try this.writeLengthEncodedInt(data.len);
            try writeFn(this.wrapped, data);
        }

        pub fn write(this: @This(), data: []const u8) AnyMySQLError.Error!void {
            try writeFn(this.wrapped, data);
        }

        const Packet = struct {
            header: PacketHeader,
            offset: usize,
            ctx: WrappedWriter,

            pub fn end(this: *@This()) AnyMySQLError.Error!void {
                const new_offset = offsetFn(this.ctx.wrapped);
                // fix position for packet header
                const length = new_offset - this.offset - PacketHeader.size;
                this.header.length = @intCast(length);
                debug("writing packet header: {d}", .{this.header.length});
                try pwrite(this.ctx, &this.header.encode(), this.offset);
            }
        };

        pub fn start(this: @This(), sequence_id: u8) AnyMySQLError.Error!Packet {
            const o = offsetFn(this.wrapped);
            debug("starting packet: {d}", .{o});
            try this.write(&[_]u8{0} ** PacketHeader.size);
            return .{
                .header = .{ .sequence_id = sequence_id, .length = 0 },
                .offset = o,
                .ctx = this,
            };
        }

        pub fn offset(this: @This()) usize {
            return offsetFn(this.wrapped);
        }

        pub fn pwrite(this: @This(), data: []const u8, i: usize) AnyMySQLError.Error!void {
            try pwriteFn(this.wrapped, data, i);
        }

        pub fn int4(this: @This(), value: MySQLInt32) AnyMySQLError.Error!void {
            try this.write(&std.mem.toBytes(value));
        }

        pub fn int8(this: @This(), value: MySQLInt64) AnyMySQLError.Error!void {
            try this.write(&std.mem.toBytes(value));
        }

        pub fn int1(this: @This(), value: u8) AnyMySQLError.Error!void {
            try this.write(&[_]u8{value});
        }

        pub fn writeZ(this: @This(), value: []const u8) AnyMySQLError.Error!void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn String(this: @This(), value: bun.String) AnyMySQLError.Error!void {
            if (value.isEmpty()) {
                try this.write(&[_]u8{0});
                return;
            }

            var sliced = value.toUTF8(bun.default_allocator);
            defer sliced.deinit();
            const slice = sliced.slice();

            try this.write(slice);
            if (slice.len == 0 or slice[slice.len - 1] != 0)
                try this.write(&[_]u8{0});
        }
    };
}

pub fn NewWriter(comptime Context: type) type {
    if (@hasDecl(Context, "is_wrapped")) {
        return Context;
    }

    return NewWriterWrap(Context, Context.offset, Context.write, Context.pwrite);
}

pub fn writeWrap(comptime Container: type, comptime writeFn: anytype) type {
    return struct {
        pub fn write(this: *Container, context: anytype) AnyMySQLError.Error!void {
            const Context = @TypeOf(context);
            if (@hasDecl(Context, "is_wrapped")) {
                try writeFn(this, Context, context);
            } else {
                try writeFn(this, Context, .{ .wrapped = context });
            }
        }
    };
}

const debug = bun.Output.scoped(.NewWriter, .hidden);

const AnyMySQLError = @import("./AnyMySQLError.zig");
const PacketHeader = @import("./PacketHeader.zig");
const bun = @import("bun");
const std = @import("std");
const encodeLengthInt = @import("./EncodeInt.zig").encodeLengthInt;

const types = @import("../MySQLTypes.zig");
const MySQLInt32 = types.MySQLInt32;
const MySQLInt64 = types.MySQLInt64;
