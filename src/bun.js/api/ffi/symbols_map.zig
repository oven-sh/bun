const std = @import("std");
const bun = @import("bun");
const Function = @import("./function.zig").Function;

pub const SymbolsMap = struct {
    map: bun.StringArrayHashMapUnmanaged(Function) = .{},
    pub fn deinit(this: *SymbolsMap) void {
        for (this.map.keys()) |key| {
            bun.default_allocator.free(@constCast(key));
        }
        this.map.clearAndFree(bun.default_allocator);
    }
};
