const StackReader = @This();

buffer: []const u8 = "",
offset: *usize,
message_start: *usize,

pub fn markMessageStart(this: @This()) void {
    this.message_start.* = this.offset.*;
}

pub fn ensureLength(this: @This(), length: usize) bool {
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
pub fn skip(this: StackReader, count: usize) void {
    if (this.offset.* + count > this.buffer.len) {
        this.offset.* = this.buffer.len;
        return;
    }

    this.offset.* += count;
}
pub fn ensureCapacity(this: StackReader, count: usize) bool {
    return this.buffer.len >= (this.offset.* + count);
}
pub fn read(this: StackReader, count: usize) AnyPostgresError!Data {
    const offset = this.offset.*;
    if (!this.ensureCapacity(count)) {
        return error.ShortRead;
    }

    this.skip(count);
    return Data{
        .temporary = this.buffer[offset..this.offset.*],
    };
}
pub fn readZ(this: StackReader) AnyPostgresError!Data {
    const remaining = this.peek();
    if (bun.strings.indexOfChar(remaining, 0)) |zero| {
        this.skip(zero + 1);
        return Data{
            .temporary = remaining[0..zero],
        };
    }

    return error.ShortRead;
}

const bun = @import("bun");
const AnyPostgresError = @import("../AnyPostgresError.zig").AnyPostgresError;
const Data = @import("../../shared/Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
