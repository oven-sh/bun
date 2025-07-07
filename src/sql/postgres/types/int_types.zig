pub const int4 = u32;
pub const PostgresInt32 = int4;
pub const int8 = i64;
pub const PostgresInt64 = int8;
pub const short = u16;
pub const PostgresShort = u16;

pub fn Int32(value: anytype) [4]u8 {
    return @bitCast(@byteSwap(@as(int4, @intCast(value))));
}
