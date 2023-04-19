const std = @import("std");
const bun = @import("root").bun;

pub const CachedBitset = extern struct {
    range: [2]i32,
    len: u32,

    pub fn fromFile(comptime filename: anytype) CachedBitset {
        return comptime @bitCast(CachedBitset, bun.asByteSlice(@embedFile(filename)).ptr[0..@sizeOf(CachedBitset)].*);
    }
};

pub fn setMasks(masks: [*:0]const u8, comptime MaskType: type, masky: MaskType) void {
    const FieldInfo: std.builtin.Type.StructField = std.meta.fieldInfo(MaskType, "masks");
    masky.masks = @bitCast(masks, FieldInfo.type);
}

pub const id_start_meta = CachedBitset.fromFile("id_start_bitset.meta.blob");
pub const id_continue_meta = CachedBitset.fromFile("id_continue_bitset.meta.blob");
pub const id_start_masks = @embedFile("id_start_bitset.blob");
pub const id_continue_masks = @embedFile("id_continue_bitset.blob");

pub const IDStartType = bun.bit_set.ArrayBitSet(usize, id_start_meta.len);
pub const IDContinueType = bun.bit_set.ArrayBitSet(usize, id_continue_meta.len);
pub const id_start = IDStartType{
    .masks = @bitCast(std.meta.fieldInfo(IDStartType, .masks).type, @ptrCast(*const [id_start_masks.len]u8, id_start_masks).*),
};
pub const id_continue = IDContinueType{
    .masks = @bitCast(std.meta.fieldInfo(IDContinueType, .masks).type, @ptrCast(*const [id_continue_masks.len]u8, id_continue_masks).*),
};
