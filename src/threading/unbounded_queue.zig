pub const cache_line_length = switch (@import("builtin").target.cpu.arch) {
    .x86_64, .aarch64, .powerpc64 => 128,
    .arm, .mips, .mips64, .riscv64 => 32,
    .s390x => 256,
    else => 64,
};

pub fn UnboundedQueue(comptime T: type, comptime next_field: meta.FieldEnum(T)) type {
    const field_info = meta.fieldInfo(T, next_field);
    const next_name = field_info.name;
    const FieldType = field_info.type;

    // Check if the field type has custom accessors (for packed pointer types).
    // If so, use the accessor methods instead of direct field access.
    const has_custom_accessors = @typeInfo(FieldType) != .optional and
        @hasDecl(FieldType, "getPtr") and
        @hasDecl(FieldType, "setPtr") and
        @hasDecl(FieldType, "atomicLoadPtr") and
        @hasDecl(FieldType, "atomicStorePtr");

    return struct {
        const Self = @This();

        inline fn getNext(item: *T) ?*T {
            if (comptime has_custom_accessors) {
                return @field(item, next_name).getPtr();
            } else {
                return @field(item, next_name);
            }
        }

        inline fn setNext(item: *T, ptr: ?*T) void {
            if (comptime has_custom_accessors) {
                const field_ptr: *FieldType = &@field(item, next_name);
                field_ptr.setPtr(ptr);
            } else {
                @field(item, next_name) = ptr;
            }
        }

        inline fn atomicLoadNext(item: *T, ordering: std.builtin.AtomicOrder) ?*T {
            if (comptime has_custom_accessors) {
                const field_ptr: *FieldType = &@field(item, next_name);
                return field_ptr.atomicLoadPtr(ordering);
            } else {
                return @atomicLoad(?*T, &@field(item, next_name), ordering);
            }
        }

        inline fn atomicStoreNext(item: *T, ptr: ?*T, ordering: std.builtin.AtomicOrder) void {
            if (comptime has_custom_accessors) {
                const field_ptr: *FieldType = &@field(item, next_name);
                field_ptr.atomicStorePtr(ptr, ordering);
            } else {
                @atomicStore(?*T, &@field(item, next_name), ptr, ordering);
            }
        }

        pub const Batch = struct {
            pub const Iterator = struct {
                batch: Self.Batch,

                pub fn next(self: *Self.Batch.Iterator) ?*T {
                    if (self.batch.count == 0) return null;
                    const front = self.batch.front orelse unreachable;
                    self.batch.front = getNext(front);
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

        pub const queue_padding_length = cache_line_length / 2;

        back: std.atomic.Value(?*T) align(queue_padding_length) = .init(null),
        front: std.atomic.Value(?*T) align(queue_padding_length) = .init(null),

        pub fn push(self: *Self, item: *T) void {
            self.pushBatch(item, item);
        }

        pub fn pushBatch(self: *Self, first: *T, last: *T) void {
            setNext(last, null);
            if (comptime bun.Environment.allow_assert) {
                var item = first;
                while (getNext(item)) |next_item| {
                    item = next_item;
                }
                assertf(item == last, "`last` should be reachable from `first`", .{});
            }
            if (self.back.swap(last, .acq_rel)) |old_back| {
                atomicStoreNext(old_back, first, .release);
            } else {
                self.front.store(first, .release);
            }
        }

        pub fn pop(self: *Self) ?*T {
            var first = self.front.load(.acquire) orelse return null;
            const next_item = while (true) {
                const next_ptr = atomicLoadNext(first, .acquire);
                const maybe_first = self.front.cmpxchgWeak(
                    first,
                    next_ptr,
                    .release, // not .acq_rel because we already loaded this value with .acquire
                    .acquire,
                ) orelse break next_ptr;
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
                break atomicLoadNext(first, .acquire) orelse continue;
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
                    break atomicLoadNext(next_item, .acquire) orelse continue;
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
