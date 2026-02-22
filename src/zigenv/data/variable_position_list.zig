const std = @import("std");
const VariablePosition = @import("variable_position.zig").VariablePosition;
const Allocator = std.mem.Allocator;

/// A managed list of VariablePositions.
pub const VariablePositionList = struct {
    items: []VariablePosition,
    capacity: usize,
    allocator: Allocator,

    pub fn init(allocator: Allocator) VariablePositionList {
        return .{
            .items = &[_]VariablePosition{},
            .capacity = 0,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *VariablePositionList) void {
        for (self.items) |*item| {
            item.deinit();
        }
        if (self.capacity > 0) {
            self.allocator.free(self.items.ptr[0..self.capacity]);
        }
        self.items = &[_]VariablePosition{};
        self.capacity = 0;
    }

    pub fn ensureTotalCapacity(self: *VariablePositionList, new_capacity: usize) !void {
        if (self.capacity >= new_capacity) return;

        var old_mem: []VariablePosition = undefined;
        if (self.capacity == 0) {
            old_mem = &[_]VariablePosition{};
        } else {
            old_mem = self.items.ptr[0..self.capacity];
        }

        const new_mem = try self.allocator.realloc(old_mem, new_capacity);

        self.capacity = new_mem.len;
        self.items = new_mem[0..self.items.len];
    }

    pub fn append(self: *VariablePositionList, item: VariablePosition) !void {
        if (self.items.len >= self.capacity) {
            var new_cap = self.capacity;
            if (new_cap == 0) {
                new_cap = 8;
            } else {
                new_cap *= 2;
            }
            if (new_cap < self.items.len + 1) new_cap = self.items.len + 1;

            try self.ensureTotalCapacity(new_cap);
        }

        const full_slice = self.items.ptr[0..self.capacity];
        full_slice[self.items.len] = item;
        self.items = full_slice[0 .. self.items.len + 1];
    }

    pub fn orderedRemove(self: *VariablePositionList, index: usize) VariablePosition {
        const item = self.items[index];
        const new_len = self.items.len - 1;
        if (index != new_len) {
            // Shift items left
            // dest: items.ptr[index..new_len]
            // src:  items.ptr[index+1..items.len]
            const dest_slice = self.items.ptr[index..new_len];
            const src_slice = self.items.ptr[index + 1 .. self.items.len];
            std.mem.copyForwards(VariablePosition, dest_slice, src_slice);
        }
        self.items = self.items.ptr[0..new_len];
        return item;
    }

    pub fn clearRetainingCapacity(self: *VariablePositionList) void {
        for (self.items) |*item| {
            item.deinit();
        }
        self.items.len = 0;
    }
};

test "VariablePositionList basic usage" {
    const testing = std.testing;
    const allocator = testing.allocator;

    var list = VariablePositionList.init(allocator);
    defer list.deinit();

    var pos = VariablePosition.init(0, 1, 2);
    try pos.setVariableStr(allocator, "VAR");
    try list.append(pos);

    try testing.expectEqual(@as(usize, 1), list.items.len);
    try testing.expectEqualStrings("VAR", list.items[0].variable_str);
}
