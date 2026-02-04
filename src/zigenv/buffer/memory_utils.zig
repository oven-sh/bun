const std = @import("std");
const Allocator = std.mem.Allocator;
const EnvPairList = @import("../data/env_pair_list.zig").EnvPairList;
const EnvPair = @import("../data/env_pair.zig").EnvPair;

/// Clean up all memory for a single EnvPair
pub fn deletePair(allocator: Allocator, pair: *EnvPair) void {
    _ = allocator; // Pair is expected to own its storage or be cleaned up by its own deinit
    pair.deinit();
    // Note: In C++ this might have deleted the pointer itself.
    // In Zig, we usually deinit the struct.
    // If it was heap-allocated, the caller should free the pair pointer.
}

/// Clean up all pairs in the list
pub fn deletePairs(pairs: *EnvPairList) void {
    pairs.deinit();
}

test "deletePairs cleans up everything" {
    const allocator = std.testing.allocator;
    var pairs = EnvPairList.init(allocator);
    // errdefer deletePairs(&pairs); // In case of failure in this test

    // Create some pairs with owned buffers
    var i: usize = 0;
    while (i < 3) : (i += 1) {
        var pair = EnvPair.init(allocator);

        const kbuf = try allocator.alloc(u8, 5);
        @memcpy(kbuf, "key__");
        kbuf[4] = @intCast('0' + i);
        pair.key.setOwnBuffer(kbuf);

        const vbuf = try allocator.alloc(u8, 7);
        @memcpy(vbuf, "value__");
        vbuf[6] = @intCast('0' + i);
        pair.value.setOwnBuffer(vbuf);

        try pairs.append(pair);
    }

    // deletePairs should clean up all buffers and the list itself
    deletePairs(&pairs);

    // std.testing.allocator will detect leaks at the end of the test
}
