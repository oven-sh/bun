pub const cache_line_length = switch (@import("builtin").target.cpu.arch) {
    .x86_64, .aarch64, .powerpc64 => 128,
    .arm, .mips, .mips64, .riscv64 => 32,
    .s390x => 256,
    else => 64,
};

pub fn UnboundedQueue(comptime T: type, comptime next_field: meta.FieldEnum(T)) type {
    return UnboundedQueuePacked(T, next_field, .unpacked);
}

pub fn UnboundedQueuePacked(comptime T: type, comptime next_field: meta.FieldEnum(T), comptime packed_or_unpacked: enum { @"packed", unpacked }) type {
    const next_name = meta.fieldInfo(T, next_field).name;
    return struct {
        const Self = @This();

        fn getter(instance: *T) ?*T {
            if (packed_or_unpacked == .@"packed") {
                return @field(instance, next_name).get();
            } else {
                return @field(instance, next_name);
            }
        }

        fn setter(instance: *T, value: ?*T) void {
            if (packed_or_unpacked == .@"packed") {
                const FieldType = @TypeOf(@field(instance, next_name));
                @field(instance, next_name) = FieldType.init(value);
            } else {
                @field(instance, next_name) = value;
            }
        }

        pub const Batch = struct {
            pub const Iterator = struct {
                batch: Self.Batch,

                pub fn next(self: *Self.Batch.Iterator) ?*T {
                    if (self.batch.count == 0) return null;
                    const front = self.batch.front orelse unreachable;
                    self.batch.front = getter(front);
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

        back: std.atomic.Value(?*T) align(queue_padding_length) = .init(null),
        front: std.atomic.Value(?*T) align(queue_padding_length) = .init(null),

        pub fn push(self: *Self, item: *T) void {
            self.pushBatch(item, item);
        }

        pub fn pushBatch(self: *Self, first: *T, last: *T) void {
            setter(last, null);
            if (comptime bun.Environment.allow_assert) {
                var item = first;
                while (getter(item)) |next_item| {
                    item = next_item;
                }
                assertf(item == last, "`last` should be reachable from `first`", .{});
            }
            const prev_next_ptr = if (self.back.swap(last, .acq_rel)) |old_back| blk: {
                if (packed_or_unpacked == .@"packed") {
                    break :blk @as(*u64, @ptrCast(&@field(old_back, next)));
                } else {
                    break :blk &@field(old_back, next);
                }
            } else blk: {
                if (packed_or_unpacked == .@"packed") {
                    break :blk @as(*u64, @ptrCast(&self.front.raw));
                } else {
                    break :blk &self.front.raw;
                }
            };

            if (packed_or_unpacked == .@"packed") {
                const FieldType = @TypeOf(@field(first, next_name));
                const packed_val = FieldType.init(first);
                @atomicStore(u64, @as(*u64, @ptrCast(prev_next_ptr)), @bitCast(packed_val), .release);
            } else {
                @atomicStore(?*T, prev_next_ptr, first, .release);
            }
        }

        pub fn pop(self: *Self) ?*T {
            var first = self.front.load(.acquire) orelse return null;
            const next_item = while (true) {
                const next_item = if (packed_or_unpacked == .@"packed") blk: {
                    const packed_val = @atomicLoad(u64, @as(*u64, @ptrCast(&@field(first, next))), .acquire);
                    const packed_typed = @as(@TypeOf(@field(first, next_name)), @bitCast(packed_val));
                    break :blk packed_typed.get();
                } else @atomicLoad(?*T, &@field(first, next), .acquire);

                const maybe_first = self.front.cmpxchgWeak(
                    first,
                    next_item,
                    .release, // not .acq_rel because we already loaded this value with .acquire
                    .acquire,
                ) orelse break next_item;
                first = maybe_first orelse return null;
            };
            if (next_item != null) return first;
            // `first` was the only item in the queue, so we need to clear `self.back`.

            // Even though this load is .monotonic, it will always be either `first` (in which case
            // the cmpxchg succeeds) or an item pushed *after* `first`, because the .acquire load of
            // `self.front` synchronizes-with the .release store in push/pushBatch.
            if (self.back.cmpxchgStrong(first, null, .monotonic, .monotonic)) |back| {
                assertf(back != null, "`back` should not be null while popping an item", .{});
            } else {
                return first;
            }

            // Another item was added to the queue before we could finish removing this one.
            const new_first = while (true) : (atomic.spinLoopHint()) {
                // Wait for push/pushBatch to set `next`.
                if (packed_or_unpacked == .@"packed") {
                    const packed_val = @atomicLoad(u64, @as(*u64, @ptrCast(&@field(first, next))), .acquire);
                    const packed_typed = @as(@TypeOf(@field(first, next_name)), @bitCast(packed_val));
                    break packed_typed.get() orelse continue;
                } else {
                    break @atomicLoad(?*T, &@field(first, next), .acquire) orelse continue;
                }
            };

            self.front.store(new_first, .release);
            return first;
        }

        pub fn popBatch(self: *Self) Self.Batch {
            var batch: Self.Batch = .{};

            // Not .acq_rel because another thread that sees this `null` doesn't depend on any
            // visible side-effects from this thread.
            const first = self.front.swap(null, .acquire) orelse return batch;
            batch.count += 1;

            // Even though this load is .monotonic, it will always be either `first` or an item
            // pushed *after* `first`, because the .acquire load of `self.front` synchronizes-with
            // the .release store in push/pushBatch. So we know it's reachable from `first`.
            const last = self.back.swap(null, .monotonic).?;
            var next_item = first;
            while (next_item != last) : (batch.count += 1) {
                next_item = while (true) : (atomic.spinLoopHint()) {
                    // Wait for push/pushBatch to set `next`.
                    if (packed_or_unpacked == .@"packed") {
                        const packed_val = @atomicLoad(u64, @as(*u64, @ptrCast(&@field(next_item, next))), .acquire);
                        const packed_typed = @as(@TypeOf(@field(next_item, next_name)), @bitCast(packed_val));
                        break packed_typed.get() orelse continue;
                    } else {
                        break @atomicLoad(?*T, &@field(next_item, next), .acquire) orelse continue;
                    }
                };
            }

            batch.front = first;
            batch.last = last;
            return batch;
        }

        pub fn isEmpty(self: *Self) bool {
            return self.back.load(.acquire) == null;
        }
    };
}

const bun = @import("bun");
const assertf = bun.assertf;

const std = @import("std");
const atomic = std.atomic;
const builtin = std.builtin;
const meta = std.meta;
