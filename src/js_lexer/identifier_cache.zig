const std = @import("std");

pub const CachedBitset = extern struct {
    range: [2]i32,
    len: u32,

    pub fn fromFile(comptime _: anytype) CachedBitset {
        return .{
            .range = .{ 0, 0 },
            .len = 128,
        };
    }
};

pub fn setMasks(masks: [*:0]const u8, comptime MaskType: type, masky: MaskType) void {
    const FieldInfo: std.builtin.Type.StructField = std.meta.fieldInfo(MaskType, "masks");
    masky.masks = @bitCast(masks, FieldInfo.type);
}

pub const id_start_meta = CachedBitset.fromFile("id_start_bitset.meta.blob");
pub const id_continue_meta = CachedBitset.fromFile("id_continue_bitset.meta.blob");
pub const id_start_masks = "id_start_bitset.blob";
pub const id_continue_masks = "id_continue_bitset.blob";

pub const IDStartType = std.bit_set.StaticBitSet(id_start_meta.len);
pub const IDContinueType = std.bit_set.StaticBitSet(id_continue_meta.len);
pub const id_start = IDStartType{
    .masks = std.mem.zeroes(std.meta.fieldInfo(IDStartType, .masks).type),
};
pub const id_continue = IDContinueType{
    .masks = std.mem.zeroes(std.meta.fieldInfo(IDStartType, .masks).type),
};
