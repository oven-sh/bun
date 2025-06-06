const std = @import("std");
const bun = @import("bun");

const meta = std.meta;
const atomic = std.atomic;
const builtin = std.builtin;

const assert = bun.assert;

pub const cache_line_length = switch (@import("builtin").target.cpu.arch) {
    .x86_64, .aarch64, .powerpc64 => 128,
    .arm, .mips, .mips64, .riscv64 => 32,
    .s390x => 256,
    else => 64,
};

pub fn UnboundedQueue(comptime T: type, comptime next_field: meta.FieldEnum(T)) type {
    const next_name = meta.fieldInfo(T, next_field).name;
    return struct {
        const Self = @This();

        pub const Batch = struct {
            pub const Iterator = struct {
                batch: Self.Batch,

                pub fn next(self: *Self.Batch.Iterator) ?*T {
                    if (self.batch.count == 0) return null;
                    const front = self.batch.front orelse unreachable;
                    self.batch.front = @field(front, next_name);
                    self.batch.count -= 1;
                    return front;
                }
            };

            front: ?*T = null,
            last: ?*T = null,
            count: usize = 0,

            pub fn iterator(self: Self.Batch) Self.Batch.Iterator {
                return .{ .batch = self };
            }
        };
        const next = next_name;

        pub const queue_padding_length = cache_line_length / 2;

        back: ?*T align(queue_padding_length) = null,
        count: usize = 0,
        front: T align(queue_padding_length) = init: {
            var stub: T = undefined;
            @field(stub, next) = null;
            break :init stub;
        },

        pub fn push(self: *Self, src: *T) void {
            assert(@atomicRmw(usize, &self.count, .Add, 1, .release) >= 0);

            @field(src, next) = null;
            const old_back = @atomicRmw(?*T, &self.back, .Xchg, src, .acq_rel) orelse &self.front;
            @field(old_back, next) = src;
        }

        pub fn pushBatch(self: *Self, first: *T, last: *T, count: usize) void {
            assert(@atomicRmw(usize, &self.count, .Add, count, .release) >= 0);

            @field(last, next) = null;
            const old_back = @atomicRmw(?*T, &self.back, .Xchg, last, .acq_rel) orelse &self.front;
            @field(old_back, next) = first;
        }

        pub fn pop(self: *Self) ?*T {
            const first = @atomicLoad(?*T, &@field(self.front, next), .acquire) orelse return null;
            if (@atomicLoad(?*T, &@field(first, next), .acquire)) |next_item| {
                @atomicStore(?*T, &@field(self.front, next), next_item, .monotonic);
                assert(@atomicRmw(usize, &self.count, .Sub, 1, .monotonic) >= 1);
                return first;
            }
            const last = @atomicLoad(?*T, &self.back, .acquire) orelse &self.front;
            if (first != last) return null;
            @atomicStore(?*T, &@field(self.front, next), null, .monotonic);
            if (@cmpxchgStrong(?*T, &self.back, last, &self.front, .acq_rel, .acquire) == null) {
                assert(@atomicRmw(usize, &self.count, .Sub, 1, .monotonic) >= 1);
                return first;
            }
            var next_item = @atomicLoad(?*T, &@field(first, next), .acquire);
            while (next_item == null) : (atomic.spinLoopHint()) {
                next_item = @atomicLoad(?*T, &@field(first, next), .acquire);
            }
            @atomicStore(?*T, &@field(self.front, next), next_item, .monotonic);
            assert(@atomicRmw(usize, &self.count, .Sub, 1, .monotonic) >= 1);
            return first;
        }

        pub fn popBatch(self: *Self) Self.Batch {
            var batch: Self.Batch = .{};

            var front = @atomicLoad(?*T, &@field(self.front, next), .acquire) orelse return batch;
            batch.front = front;

            var next_item = @atomicLoad(?*T, &@field(front, next), .acquire);
            while (next_item) |next_node| : (next_item = @atomicLoad(?*T, &@field(next_node, next), .acquire)) {
                batch.count += 1;
                batch.last = front;

                front = next_node;
            }

            const last = @atomicLoad(?*T, &self.back, .acquire) orelse &self.front;
            if (front != last) {
                @atomicStore(?*T, &@field(self.front, next), front, .release);
                assert(@atomicRmw(usize, &self.count, .Sub, batch.count, .monotonic) >= batch.count);
                return batch;
            }

            @atomicStore(?*T, &@field(self.front, next), null, .monotonic);
            if (@cmpxchgStrong(?*T, &self.back, last, &self.front, .acq_rel, .acquire) == null) {
                batch.count += 1;
                batch.last = front;
                assert(@atomicRmw(usize, &self.count, .Sub, batch.count, .monotonic) >= batch.count);
                return batch;
            }

            next_item = @atomicLoad(?*T, &@field(front, next), .acquire);
            while (next_item == null) : (atomic.spinLoopHint()) {
                next_item = @atomicLoad(?*T, &@field(front, next), .acquire);
            }

            batch.count += 1;
            @atomicStore(?*T, &@field(self.front, next), next_item, .monotonic);
            batch.last = front;
            assert(@atomicRmw(usize, &self.count, .Sub, batch.count, .monotonic) >= batch.count);
            return batch;
        }

        pub fn peek(self: *Self) usize {
            const count = @atomicLoad(usize, &self.count, .acquire);
            assert(count >= 0);
            return count;
        }

        pub fn isEmpty(self: *Self) bool {
            return self.peek() == 0;
        }
    };
}
