const std = @import("std");
const bun = @import("root").bun;
const identifier_data = @import("./identifier_data.zig");

pub const CachedBitset = extern struct {
    range: [2]i32,
    len: u32,

    pub fn fromFile(comptime filename: anytype) CachedBitset {
        return comptime @as(CachedBitset, @bitCast(bun.asByteSlice(@embedFile(filename)).ptr[0..@sizeOf(CachedBitset)].*));
    }
};

pub fn setMasks(masks: [*:0]const u8, comptime MaskType: type, masky: MaskType) void {
    const FieldInfo: std.builtin.Type.StructField = std.meta.fieldInfo(MaskType, "masks");
    masky.masks = @as(masks, @bitCast(FieldInfo.type));
}

pub const id_start_meta = identifier_data.id_start_cached;
pub const id_continue_meta = identifier_data.id_continue_cached;
pub const id_start = identifier_data.id_start;
pub const id_continue = identifier_data.id_continue;
