pub fn NewReaderWrap(
    comptime Context: type,
    comptime markMessageStartFn_: (fn (ctx: Context) void),
    comptime peekFn_: (fn (ctx: Context) []const u8),
    comptime skipFn_: (fn (ctx: Context, count: isize) void),
    comptime ensureCapacityFn_: (fn (ctx: Context, count: usize) bool),
    comptime readFunction_: (fn (ctx: Context, count: usize) anyerror!Data),
    comptime readZ_: (fn (ctx: Context) anyerror!Data),
    comptime setOffsetFromStart_: (fn (ctx: Context, offset: usize) void),
) type {
    return struct {
        wrapped: Context,
        const readFn = readFunction_;
        const readZFn = readZ_;
        const ensureCapacityFn = ensureCapacityFn_;
        const skipFn = skipFn_;
        const peekFn = peekFn_;
        const markMessageStartFn = markMessageStartFn_;
        const setOffsetFromStartFn = setOffsetFromStart_;
        pub const Ctx = Context;

        pub const is_wrapped = true;

        pub fn markMessageStart(this: @This()) void {
            markMessageStartFn(this.wrapped);
        }

        pub fn setOffsetFromStart(this: @This(), offset: usize) void {
            return setOffsetFromStartFn(this.wrapped, offset);
        }

        pub fn read(this: @This(), count: usize) anyerror!Data {
            return readFn(this.wrapped, count);
        }

        pub fn skip(this: @This(), count: anytype) void {
            skipFn(this.wrapped, @as(isize, @intCast(count)));
        }

        pub fn peek(this: @This()) []const u8 {
            return peekFn(this.wrapped);
        }

        pub fn readZ(this: @This()) anyerror!Data {
            return readZFn(this.wrapped);
        }

        pub fn byte(this: @This()) !u8 {
            const data = try this.read(1);
            return data.slice()[0];
        }

        pub fn ensureCapacity(this: @This(), count: usize) anyerror!void {
            if (!ensureCapacityFn(this.wrapped, count)) {
                return error.ShortRead;
            }
        }

        pub fn int(this: @This(), comptime Int: type) !Int {
            var data = try this.read(@sizeOf(Int));
            defer data.deinit();
            if (comptime Int == u8) {
                return @as(Int, data.slice()[0]);
            }
            const size = @divExact(@typeInfo(Int).int.bits, 8);
            return @as(Int, @bitCast(data.slice()[0..size].*));
        }

        pub fn encodeLenString(this: @This()) !Data {
            if (decodeLengthInt(this.peek())) |result| {
                this.skip(result.bytes_read);
                return try this.read(@intCast(result.value));
            }
            return error.InvalidEncodedLength;
        }

        pub fn rawEncodeLenData(this: @This()) !Data {
            if (decodeLengthInt(this.peek())) |result| {
                return try this.read(@intCast(result.value + result.bytes_read));
            }
            return error.InvalidEncodedLength;
        }

        pub fn encodedLenInt(this: @This()) !u64 {
            if (decodeLengthInt(this.peek())) |result| {
                this.skip(result.bytes_read);
                return result.value;
            }
            return error.InvalidEncodedInteger;
        }

        pub fn encodedLenIntWithSize(this: @This(), size: *usize) !u64 {
            if (decodeLengthInt(this.peek())) |result| {
                this.skip(result.bytes_read);
                size.* += result.bytes_read;
                return result.value;
            }
            return error.InvalidEncodedInteger;
        }
    };
}

pub fn NewReader(comptime Context: type) type {
    if (@hasDecl(Context, "is_wrapped")) {
        return Context;
    }

    return NewReaderWrap(Context, Context.markMessageStart, Context.peek, Context.skip, Context.ensureCapacity, Context.read, Context.readZ, Context.setOffsetFromStart);
}

pub fn decoderWrap(comptime Container: type, comptime decodeFn: anytype) type {
    return struct {
        pub fn decode(this: *Container, context: anytype) anyerror!void {
            const Context = @TypeOf(context);
            if (@hasDecl(Context, "is_wrapped")) {
                try decodeFn(this, Context, context);
            } else {
                try decodeFn(this, Context, .{ .wrapped = context });
            }
        }

        pub fn decodeAllocator(this: *Container, allocator: std.mem.Allocator, context: anytype) anyerror!void {
            const Context = @TypeOf(context);
            if (@hasDecl(Context, "is_wrapped")) {
                try decodeFn(this, allocator, Context, context);
            } else {
                try decodeFn(this, allocator, Context, .{ .wrapped = context });
            }
        }
    };
}

const std = @import("std");
const Data = @import("../../shared/Data.zig").Data;
const decodeLengthInt = @import("./EncodeInt.zig").decodeLengthInt;
