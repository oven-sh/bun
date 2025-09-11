pub fn NewReaderWrap(
    comptime Context: type,
    comptime markMessageStartFn_: (fn (ctx: Context) void),
    comptime peekFn_: (fn (ctx: Context) []const u8),
    comptime skipFn_: (fn (ctx: Context, count: usize) void),
    comptime ensureCapacityFn_: (fn (ctx: Context, count: usize) bool),
    comptime readFunction_: (fn (ctx: Context, count: usize) AnyPostgresError!Data),
    comptime readZ_: (fn (ctx: Context) AnyPostgresError!Data),
) type {
    return struct {
        wrapped: Context,
        const readFn = readFunction_;
        const readZFn = readZ_;
        const ensureCapacityFn = ensureCapacityFn_;
        const skipFn = skipFn_;
        const peekFn = peekFn_;
        const markMessageStartFn = markMessageStartFn_;

        pub const Ctx = Context;

        pub inline fn markMessageStart(this: @This()) void {
            markMessageStartFn(this.wrapped);
        }

        pub inline fn read(this: @This(), count: usize) AnyPostgresError!Data {
            return try readFn(this.wrapped, count);
        }

        pub inline fn eatMessage(this: @This(), comptime msg_: anytype) AnyPostgresError!void {
            const msg = msg_[1..];
            try this.ensureCapacity(msg.len);

            var input = try readFn(this.wrapped, msg.len);
            defer input.deinit();
            if (bun.strings.eqlComptime(input.slice(), msg)) return;
            return error.InvalidMessage;
        }

        pub fn skip(this: @This(), count: usize) AnyPostgresError!void {
            skipFn(this.wrapped, count);
        }

        pub fn peek(this: @This()) []const u8 {
            return peekFn(this.wrapped);
        }

        pub inline fn readZ(this: @This()) AnyPostgresError!Data {
            return try readZFn(this.wrapped);
        }

        pub inline fn ensureCapacity(this: @This(), count: usize) AnyPostgresError!void {
            if (!ensureCapacityFn(this.wrapped, count)) {
                return error.ShortRead;
            }
        }

        pub fn int(this: @This(), comptime Int: type) !Int {
            var data = try this.read(@sizeOf((Int)));
            defer data.deinit();
            const slice = data.slice();
            if (slice.len < @sizeOf(Int)) {
                return error.ShortRead;
            }
            if (comptime Int == u8) {
                return @as(Int, slice[0]);
            }
            return @byteSwap(@as(Int, @bitCast(slice[0..@sizeOf(Int)].*)));
        }

        pub fn peekInt(this: @This(), comptime Int: type) ?Int {
            const remain = this.peek();
            if (remain.len < @sizeOf(Int)) {
                return null;
            }
            return @byteSwap(@as(Int, @bitCast(remain[0..@sizeOf(Int)].*)));
        }

        pub fn expectInt(this: @This(), comptime Int: type, comptime value: comptime_int) !bool {
            const actual = try this.int(Int);
            return actual == value;
        }

        pub fn int4(this: @This()) !PostgresInt32 {
            return this.int(PostgresInt32);
        }

        pub fn short(this: @This()) !PostgresShort {
            return this.int(PostgresShort);
        }

        pub fn length(this: @This()) !PostgresInt32 {
            const expected = try this.int(PostgresInt32);
            if (expected > -1) {
                try this.ensureCapacity(@intCast(expected -| 4));
            }

            return expected;
        }

        pub const bytes = read;

        pub fn String(this: @This()) !bun.String {
            var result = try this.readZ();
            defer result.deinit();
            return bun.String.borrowUTF8(result.slice());
        }
    };
}

pub fn NewReader(comptime Context: type) type {
    return NewReaderWrap(Context, Context.markMessageStart, Context.peek, Context.skip, Context.ensureLength, Context.read, Context.readZ);
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;

const int_types = @import("../types/int_types.zig");
const PostgresInt32 = int_types.PostgresInt32;
const PostgresShort = int_types.PostgresShort;
