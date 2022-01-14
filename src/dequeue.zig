const std = @import("std");
const Environment = @import("./env.zig");

pub fn Dequeue(comptime Type: type, comptime block_size: comptime_int) type {
    return struct {
        const Queue = @This();
        pub const Block = struct {
            data: [block_size]Type = undefined,
            used: Int = 0,
            prev: ?*Block = null,
            next: ?*Block = null,

            pub const Int = std.math.IntFittingRange(0, block_size + 1);

            pub inline fn isFull(this: *Block) bool {
                return this.used + 1 >= block_size;
            }

            pub fn append(this: *Block, value: Type) void {
                this.data[this.used] = value;
                this.used += 1;
            }

            pub fn pop(this: *Block) ?Type {
                if (this.used == 0) return null;
                this.used -= 1;
                const last = this.used;

                return this.data[last];
            }
        };

        allocator: std.mem.Allocator,
        first: Block = Block{},
        head: *Block = undefined,
        tail: *Block = undefined,
        empty: ?*Block = null,

        pub fn count(this: *Queue) usize {
            var total: usize = 0;
            var element = this.head;
            while (element != this.tail) {
                total += @as(usize, element.used);
                element = element.next orelse break;
            }
            return total + @as(usize, this.tail.used);
        }

        pub fn emptyBlockCount(this: *Queue) usize {
            var empty = this.empty;
            var total: usize = 0;
            while (empty) |_empty| {
                total += 1;
                if (_empty.next != null) std.debug.assert(_empty != _empty.next.?);
                empty = _empty.next;
            }
            return total;
        }

        pub fn init(queue: *Queue, allocator: std.mem.Allocator) void {
            queue.* = Queue{ .allocator = allocator };
            queue.head = &queue.first;
            queue.tail = &queue.first;
        }

        pub fn append(this: *Queue, value: Type) void {
            if (this.tail.isFull()) {
                var new_tail: *Block = undefined;
                if (this.empty) |empty| {
                    var _empty = empty;
                    if (_empty.next) |new_empty| {
                        this.empty = new_empty;
                        new_empty.prev = null;
                        _empty.next = null;
                    } else {
                        this.empty = null;
                    }
                    new_tail = _empty;
                } else {
                    new_tail = this.allocator.create(Block) catch unreachable;
                    new_tail.* = Block{};
                }

                if (comptime Environment.allow_assert) std.debug.assert(new_tail.used == 0);

                new_tail.prev = this.tail;
                this.tail.next = new_tail;
                this.tail = new_tail;
            }

            this.tail.append(value);
        }

        pub fn pop(this: *Queue) ?Type {
            while (true) {
                return this.tail.pop() orelse {
                    if (this.head != this.tail) {
                        var prev = this.tail.prev;
                        if (prev != null) {
                            this.tail.next = this.empty;
                            this.tail.prev = null;
                            this.empty = this.tail;

                            this.tail = prev.?;
                        }
                        continue;
                    }

                    return null;
                };
            }
        }
    };
}

test "Dequeue - simple" {
    var queue = try std.heap.c_allocator.create(Dequeue(usize, 10));
    queue.init(std.heap.c_allocator);
    var array_list = std.ArrayList(usize).init(std.heap.c_allocator);
    var i: usize = 0;
    while (i < 100) {
        queue.append(i);
        try array_list.append(i);

        try std.testing.expectEqual(queue.count(), array_list.items.len);
        i += 1;
    }

    i = 100;
    while (i > 0) {
        try std.testing.expectEqual(i - 1, queue.pop() orelse unreachable);
        try std.testing.expectEqual(i - 1, array_list.pop());
        i -= 1;
    }
    try std.testing.expectEqual(queue.emptyBlockCount(), 11);

    i = 0;
    while (i < 100) {
        queue.append(i);
        try array_list.append(i);

        try std.testing.expectEqual(queue.count(), array_list.items.len);
        i += 1;
    }

    try std.testing.expectEqual(queue.emptyBlockCount(), 0);

    i = 100;
    while (i > 0) {
        try std.testing.expectEqual(i - 1, queue.pop() orelse unreachable);
        try std.testing.expectEqual(i - 1, array_list.pop());
        i -= 1;
    }

    try std.testing.expectEqual(queue.emptyBlockCount(), 11);
}

test "Dequeue - mix" {
    var queue: Dequeue(usize, 10) = undefined;
    queue.init(std.heap.c_allocator);

    var array_list = std.ArrayList(usize).init(std.heap.c_allocator);
    var i: usize = 0;
    while (i < 100) {
        queue.append(i);
        try array_list.append(i);
        i += 1;
    }
    i = 0;
    while (i < 20) {
        try std.testing.expectEqual(queue.pop(), array_list.popOrNull());
        i += 1;
    }

    i = 10;
    while (i > 1) {
        try std.testing.expectEqual(queue.pop(), array_list.popOrNull());
        i -= 1;
    }

    queue.append(i);
    try array_list.append(i);
    while (i > 1) {
        try std.testing.expectEqual(queue.pop(), array_list.popOrNull());
        i -= 1;
    }
}
