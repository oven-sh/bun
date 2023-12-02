const std = @import("std");
const bun = @import("root").bun;

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

pub const id_start_meta = CachedBitset.fromFile("id_start_bitset.meta.blob");
pub const id_continue_meta = CachedBitset.fromFile("id_continue_bitset.meta.blob");
pub const id_start_masks = @embedFile("id_start_bitset.blob");
pub const id_continue_masks = @embedFile("id_continue_bitset.blob");

pub const IDStartType = bun.bit_set.ArrayBitSet(usize, id_start_meta.len);
pub const IDContinueType = bun.bit_set.ArrayBitSet(usize, id_continue_meta.len);
pub const id_start = IDStartType{
    .masks = @as(std.meta.fieldInfo(IDStartType, .masks).type, @bitCast(@as(*const [id_start_masks.len]u8, @ptrCast(id_start_masks)).*)),
};
pub const id_continue = IDContinueType{
    .masks = @as(std.meta.fieldInfo(IDContinueType, .masks).type, @bitCast(@as(*const [id_continue_masks.len]u8, @ptrCast(id_continue_masks)).*)),
};
