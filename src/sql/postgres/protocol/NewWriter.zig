pub fn NewWriterWrap(
    comptime Context: type,
    comptime offsetFn_: (fn (ctx: Context) usize),
    comptime writeFunction_: (fn (ctx: Context, bytes: []const u8) AnyPostgresError!void),
    comptime pwriteFunction_: (fn (ctx: Context, bytes: []const u8, offset: usize) AnyPostgresError!void),
) type {
    return struct {
        wrapped: Context,

        const writeFn = writeFunction_;
        const pwriteFn = pwriteFunction_;
        const offsetFn = offsetFn_;
        pub const Ctx = Context;

        pub const WrappedWriter = @This();

        pub inline fn write(this: @This(), data: []const u8) AnyPostgresError!void {
            try writeFn(this.wrapped, data);
        }

        pub const LengthWriter = struct {
            index: usize,
            context: WrappedWriter,

            pub fn write(this: LengthWriter) AnyPostgresError!void {
                try this.context.pwrite(&Int32(this.context.offset() - this.index), this.index);
            }

            pub fn writeExcludingSelf(this: LengthWriter) AnyPostgresError!void {
                try this.context.pwrite(&Int32(this.context.offset() -| (this.index + 4)), this.index);
            }
        };

        pub inline fn length(this: @This()) AnyPostgresError!LengthWriter {
            const i = this.offset();
            try this.int4(0);
            return LengthWriter{
                .index = i,
                .context = this,
            };
        }

        pub inline fn offset(this: @This()) usize {
            return offsetFn(this.wrapped);
        }

        pub inline fn pwrite(this: @This(), data: []const u8, i: usize) AnyPostgresError!void {
            try pwriteFn(this.wrapped, data, i);
        }

        pub fn int4(this: @This(), value: PostgresInt32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn int8(this: @This(), value: PostgresInt64) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn sint4(this: @This(), value: i32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn @"f64"(this: @This(), value: f64) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u64, @bitCast(value)))));
        }

        pub fn @"f32"(this: @This(), value: f32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u32, @bitCast(value)))));
        }

        pub fn short(this: @This(), value: anytype) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u16, @intCast(value)))));
        }

        pub fn string(this: @This(), value: []const u8) !void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn bytes(this: @This(), value: []const u8) !void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn @"bool"(this: @This(), value: bool) !void {
            try this.write(if (value) "t" else "f");
        }

        pub fn @"null"(this: @This()) !void {
            try this.int4(std.math.maxInt(PostgresInt32));
        }

        pub fn String(this: @This(), value: bun.String) !void {
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
    return NewWriterWrap(Context, Context.offset, Context.write, Context.pwrite);
}

const bun = @import("bun");
const std = @import("std");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;

const int_types = @import("../types/int_types.zig");
const Int32 = int_types.Int32;
const PostgresInt32 = int_types.PostgresInt32;
const PostgresInt64 = int_types.PostgresInt64;
