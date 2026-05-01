// Based on the algorithm described here:
// https://here-be-braces.com/fast-lookup-of-unicode-properties/

/// Creates a type that is able to generate a 3-level lookup table
/// from a Unicode codepoint to a mapping of type Elem.
///
/// Context must have two functions:
///   - `get(Context, u21) Elem`: returns the mapping for a given codepoint
///   - `eql(Context, Elem, Elem) bool`: returns true if two mappings are equal
///
pub fn Generator(
    comptime Elem: type,
    comptime Context: type,
) type {
    return struct {
        const Self = @This();

        const block_size = 256;
        const Block = [block_size]u8;

        const BlockMap = std.HashMap(
            Block,
            u16,
            struct {
                pub fn hash(ctx: @This(), k: Block) u64 {
                    _ = ctx;
                    var hasher = std.hash.Wyhash.init(0);
                    std.hash.autoHashStrat(&hasher, k, .DeepRecursive);
                    return hasher.final();
                }

                pub fn eql(ctx: @This(), a: Block, b: Block) bool {
                    _ = ctx;
                    return std.mem.eql(u8, &a, &b);
                }
            },
            std.hash_map.default_max_load_percentage,
        );

        ctx: Context = undefined,

        pub fn generate(self: *const Self, alloc: Allocator) !Tables(Elem) {
            var blocks_map = BlockMap.init(alloc);
            defer blocks_map.deinit();

            var stage1: std.ArrayList(u16) = .empty;
            var stage2: std.ArrayList(u8) = .empty;
            var stage3: std.ArrayList(Elem) = .empty;
            defer {
                stage1.deinit(alloc);
                stage2.deinit(alloc);
                stage3.deinit(alloc);
            }

            var block: Block = undefined;
            var block_len: u16 = 0;
            for (0..std.math.maxInt(u21) + 1) |cp| {
                const elem = try self.ctx.get(@as(u21, @intCast(cp)));
                const block_idx = block_idx: {
                    for (stage3.items, 0..) |item, i| {
                        if (self.ctx.eql(item, elem)) break :block_idx i;
                    }

                    const idx = stage3.items.len;
                    try stage3.append(alloc, elem);
                    break :block_idx idx;
                };

                block[block_len] = std.math.cast(u8, block_idx) orelse return error.BlockTooLarge;
                block_len += 1;

                if (block_len < block_size and cp != std.math.maxInt(u21)) continue;
                if (block_len < block_size) @memset(block[block_len..block_size], 0);

                const gop = try blocks_map.getOrPut(block);
                if (!gop.found_existing) {
                    gop.value_ptr.* = std.math.cast(
                        u16,
                        stage2.items.len,
                    ) orelse return error.Stage2TooLarge;
                    for (block[0..block_len]) |entry| try stage2.append(alloc, entry);
                }

                try stage1.append(alloc, gop.value_ptr.*);
                block_len = 0;
            }

            assert(stage1.items.len <= std.math.maxInt(u16));
            assert(stage2.items.len <= std.math.maxInt(u16));
            assert(stage3.items.len <= std.math.maxInt(u8));

            const stage1_owned = try stage1.toOwnedSlice(alloc);
            errdefer alloc.free(stage1_owned);
            const stage2_owned = try stage2.toOwnedSlice(alloc);
            errdefer alloc.free(stage2_owned);
            const stage3_owned = try stage3.toOwnedSlice(alloc);
            errdefer alloc.free(stage3_owned);

            return .{
                .stage1 = stage1_owned,
                .stage2 = stage2_owned,
                .stage3 = stage3_owned,
            };
        }
    };
}

/// 3-level lookup table for codepoint -> Elem mapping.
pub fn Tables(comptime Elem: type) type {
    return struct {
        const Self = @This();

        stage1: []const u16,
        stage2: []const u8,
        stage3: []const Elem,

        pub inline fn get(self: *const Self, cp: u21) Elem {
            const high = cp >> 8;
            const low: u16 = cp & 0xFF;
            return self.stage3[self.stage2[self.stage1[high] + low]];
        }
    };
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const assert = std.debug.assert;
