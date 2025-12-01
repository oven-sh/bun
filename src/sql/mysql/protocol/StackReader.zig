const StackReader = @This();
buffer: []const u8 = "",
offset: *usize,
message_start: *usize,

pub fn markMessageStart(this: @This()) void {
    this.message_start.* = this.offset.*;
}
pub fn setOffsetFromStart(this: @This(), offset: usize) void {
    this.offset.* = this.message_start.* + offset;
}

pub fn ensureCapacity(this: @This(), length: usize) bool {
    return this.buffer.len >= (this.offset.* + length);
}

pub fn init(buffer: []const u8, offset: *usize, message_start: *usize) NewReader(StackReader) {
    return .{
        .wrapped = .{
            .buffer = buffer,
            .offset = offset,
            .message_start = message_start,
        },
    };
}

pub fn peek(this: StackReader) []const u8 {
    return this.buffer[this.offset.*..];
}

pub fn skip(this: StackReader, count: isize) void {
    if (count < 0) {
        const abs_count = @abs(count);
        if (abs_count > this.offset.*) {
            this.offset.* = 0;
            return;
        }
        this.offset.* -= @intCast(abs_count);
        return;
    }

    const ucount: usize = @intCast(count);
    if (this.offset.* + ucount > this.buffer.len) {
        this.offset.* = this.buffer.len;
        return;
    }

    this.offset.* += ucount;
}

pub fn read(this: StackReader, count: usize) AnyMySQLError.Error!Data {
    const offset = this.offset.*;
    if (!this.ensureCapacity(count)) {
        return AnyMySQLError.Error.ShortRead;
    }

    this.skip(@intCast(count));
    return Data{
        .temporary = this.buffer[offset..this.offset.*],
    };
}

pub fn readZ(this: StackReader) AnyMySQLError.Error!Data {
    const remaining = this.peek();
    if (bun.strings.indexOfChar(remaining, 0)) |zero| {
        this.skip(@intCast(zero + 1));
        return Data{
            .temporary = remaining[0..zero],
        };
    }

    return error.ShortRead;
}

const AnyMySQLError = @import("./AnyMySQLError.zig");
const bun = @import("bun");
const Data = @import("../../shared/Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
