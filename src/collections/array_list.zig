/// Managed `ArrayList` using an arbitrary `std.mem.Allocator`.
/// Prefer using a concrete type, like `ArrayListDefault` or `ArrayListIn(MimallocArena)`.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayList(comptime T: type) type {
    return ArrayListIn(T, std.mem.Allocator);
}

/// Managed `ArrayList` using the default allocator. No overhead compared to an unmanaged
/// `ArrayList`.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayListDefault(comptime T: type) type {
    return ArrayListIn(T, bun.DefaultAllocator);
}

/// Managed `ArrayList` using a specific kind of allocator. No overhead if `Allocator` is a
/// zero-sized type.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayListIn(comptime T: type, comptime Allocator: type) type {
    return ArrayListAlignedIn(T, Allocator, null);
}

/// Managed `ArrayListAligned` using an arbitrary `std.mem.Allocator`.
/// Prefer using a concrete type, like `ArrayListAlignedDefault` or
/// `ArrayListAlignedIn(MimallocArena)`.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayListAligned(comptime T: type, comptime alignment: ?u29) type {
    return ArrayListAlignedIn(T, std.mem.Allocator, alignment);
}

/// Managed `ArrayListAligned` using the default allocator. No overhead compared to an unmanaged
/// `ArrayListAligned`.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayListAlignedDefault(comptime T: type, comptime alignment: ?u29) type {
    return ArrayListAlignedIn(T, bun.DefaultAllocator, alignment);
}

/// Managed `ArrayListAligned` using a specific kind of allocator. No overhead if `Allocator` is a
/// zero-sized type.
///
/// NOTE: Unlike `std.ArrayList`, this type's `deinit` method calls `deinit` on each of the items.
pub fn ArrayListAlignedIn(
    comptime T: type,
    comptime Allocator: type,
    comptime alignment: ?std.mem.Alignment,
) type {
    return struct {
        const Self = @This();

        #unmanaged: Unmanaged = .empty,
        #allocator: Allocator,

        pub fn items(self: *const Self) Slice {
            return self.#unmanaged.items;
        }

        pub fn capacity(self: *const Self) usize {
            return self.#unmanaged.capacity;
        }

        pub const SentinelSlice = Unmanaged.SentinelSlice;
        pub const Slice = Unmanaged.Slice;
        pub const Unmanaged = std.ArrayListAlignedUnmanaged(T, alignment);

        pub fn init() Self {
            return .initIn(bun.memory.initDefault(Allocator));
        }

        pub fn initIn(allocator_: Allocator) Self {
            return .{
                .#unmanaged = .empty,
                .#allocator = allocator_,
            };
        }

        pub fn initCapacity(num: usize) AllocError!Self {
            return .initCapacityIn(num, bun.memory.initDefault(Allocator));
        }

        pub fn initCapacityIn(num: usize, allocator_: Allocator) AllocError!Self {
            return .{
                .#unmanaged = try .initCapacity(bun.allocators.asStd(allocator_), num),
                .#allocator = allocator_,
            };
        }

        /// NOTE: Unlike `std.ArrayList`, this method calls `deinit` on every item in the list,
        /// if such a method exists. If you don't want that behavior, use `deinitShallow`.
        pub fn deinit(self: *Self) void {
            bun.memory.deinit(self.items());
            self.deinitShallow();
        }

        pub fn deinitShallow(self: *Self) void {
            defer self.* = undefined;
            self.#unmanaged.deinit(self.getStdAllocator());
            bun.memory.deinit(&self.#allocator);
        }

        pub fn fromOwnedSlice(allocator_: Allocator, slice: Slice) Self {
            return .{
                .#unmanaged = .fromOwnedSlice(slice),
                .#allocator = allocator_,
            };
        }

        pub fn fromOwnedSliceSentinel(
            allocator_: Allocator,
            comptime sentinel: T,
            slice: [:sentinel]T,
        ) Self {
            return .{
                .#unmanaged = .fromOwnedSliceSentinel(sentinel, slice),
                .#allocator = allocator_,
            };
        }

        pub fn writer(self: *Self) Unmanaged.Writer {
            return self.#unmanaged.writer(self.getStdAllocator());
        }

        /// Returns a borrowed version of the allocator.
        pub fn allocator(self: *const Self) bun.allocators.Borrowed(Allocator) {
            return bun.allocators.borrow(self.#allocator);
        }

        /// This method empties `self`.
        pub fn moveToUnmanaged(self: *Self) Unmanaged {
            defer self.#unmanaged = .empty;
            return self.#unmanaged;
        }

        /// Unlike `moveToUnmanaged`, this method *invalidates* `self`.
        pub fn intoUnmanagedWithAllocator(self: *Self) struct { Unmanaged, Allocator } {
            defer self.* = undefined;
            return .{ self.#unmanaged, self.#allocator };
        }

        /// The contents of `unmanaged` must have been allocated by `allocator`.
        /// This function invalidates `unmanaged`; don't call `deinit` on it.
        pub fn fromUnmanaged(allocator_: Allocator, unmanaged: Unmanaged) Self {
            return .{
                .#unmanaged = unmanaged,
                .#allocator = allocator_,
            };
        }

        pub fn toOwnedSlice(self: *Self) AllocError!Slice {
            return self.#unmanaged.toOwnedSlice(self.getStdAllocator());
        }

        /// Creates a copy of this `ArrayList` with *shallow* copies of its items.
        ///
        /// The returned list uses a default-initialized `Allocator`. If `Allocator` cannot be
        /// default-initialized, use `cloneIn` instead.
        ///
        /// Be careful with this method if `T` has a `deinit` method. You will have to use
        /// `deinitShallow` on one of the `ArrayList`s to prevent `deinit` from being called twice
        /// on each element.
        pub fn clone(self: *const Self) AllocError!Self {
            return self.cloneIn(bun.memory.initDefault(Allocator));
        }

        /// Creates a copy of this `ArrayList` using the provided allocator, with *shallow* copies
        /// of this list's items.
        pub fn cloneIn(
            self: *const Self,
            allocator_: anytype,
        ) AllocError!ArrayListAlignedIn(T, @TypeOf(allocator_), alignment) {
            return .{
                .#unmanaged = try self.#unmanaged.clone(bun.allocators.asStd(allocator_)),
                .#allocator = allocator_,
            };
        }

        pub fn insert(self: *Self, i: usize, item: T) AllocError!void {
            return self.#unmanaged.insert(self.getStdAllocator(), i, item);
        }

        pub fn insertAssumeCapacity(self: *Self, i: usize, item: T) void {
            self.#unmanaged.insertAssumeCapacity(i, item);
        }

        /// Note that this creates *shallow* copies of `value`.
        pub fn addManyAt(self: *Self, index: usize, value: T, count: usize) AllocError![]T {
            const result = try self.#unmanaged.addManyAt(self.getStdAllocator(), index, count);
            @memset(result, value);
            return result;
        }

        /// Note that this creates *shallow* copies of `value`.
        pub fn addManyAtAssumeCapacity(self: *Self, index: usize, value: T, count: usize) []T {
            const result = self.#unmanaged.addManyAt(index, count);
            @memset(result, value);
            return result;
        }

        /// This method takes ownership of all elements in `new_items`.
        pub fn insertSlice(self: *Self, index: usize, new_items: []const T) AllocError!void {
            return self.#unmanaged.insertSlice(self.getStdAllocator(), index, new_items);
        }

        /// This method `deinit`s the removed items.
        /// This method takes ownership of all elements in `new_items`.
        pub fn replaceRange(
            self: *Self,
            start: usize,
            len: usize,
            new_items: []const T,
        ) AllocError!void {
            bun.memory.deinit(self.items()[start .. start + len]);
            return self.replaceRangeShallow(start, len, new_items);
        }

        /// This method does *not* `deinit` the removed items.
        /// This method takes ownership of all elements in `new_items`.
        pub fn replaceRangeShallow(
            self: *Self,
            start: usize,
            len: usize,
            new_items: []const T,
        ) AllocError!void {
            return self.#unmanaged.replaceRange(self.getStdAllocator(), start, len, new_items);
        }

        /// This method `deinit`s the removed items.
        /// This method takes ownership of all elements in `new_items`.
        pub fn replaceRangeAssumeCapacity(
            self: *Self,
            start: usize,
            len: usize,
            new_items: []const T,
        ) void {
            for (self.items()[start .. start + len]) |*item| {
                bun.memory.deinit(item);
            }
            self.replaceRangeAssumeCapacityShallow(start, len, new_items);
        }

        /// This method does *not* `deinit` the removed items.
        /// This method takes ownership of all elements in `new_items`.
        pub fn replaceRangeAssumeCapacityShallow(
            self: *Self,
            start: usize,
            len: usize,
            new_items: []const T,
        ) void {
            self.#unmanaged.replaceRangeAssumeCapacity(start, len, new_items);
        }

        pub fn append(self: *Self, item: T) AllocError!void {
            return self.#unmanaged.append(self.getStdAllocator(), item);
        }

        pub fn appendAssumeCapacity(self: *Self, item: T) void {
            self.#unmanaged.appendAssumeCapacity(item);
        }

        pub fn orderedRemove(self: *Self, i: usize) T {
            return self.#unmanaged.orderedRemove(i);
        }

        pub fn swapRemove(self: *Self, i: usize) T {
            return self.#unmanaged.swapRemove(i);
        }

        /// This method takes ownership of all elements in `new_items`.
        pub fn appendSlice(self: *Self, new_items: []const T) AllocError!void {
            return self.#unmanaged.appendSlice(self.getStdAllocator(), new_items);
        }

        /// This method takes ownership of all elements in `new_items`.
        pub fn appendSliceAssumeCapacity(self: *Self, new_items: []const T) void {
            self.#unmanaged.appendSliceAssumeCapacity(new_items);
        }

        /// This method takes ownership of all elements in `new_items`.
        pub fn appendUnalignedSlice(self: *Self, new_items: []align(1) const T) AllocError!void {
            return self.#unmanaged.appendUnalignedSlice(self.getStdAllocator(), new_items);
        }

        /// This method takes ownership of all elements in `new_items`.
        pub fn appendUnalignedSliceAssumeCapacity(self: *Self, new_items: []align(1) const T) void {
            self.#unmanaged.appendUnalignedSliceAssumeCapacity(new_items);
        }

        /// Note that this creates *shallow* copies of `value`.
        pub inline fn appendNTimes(self: *Self, value: T, n: usize) AllocError!void {
            return self.#unmanaged.appendNTimes(self.getStdAllocator(), value, n);
        }

        /// Note that this creates *shallow* copies of `value`.
        pub inline fn appendNTimesAssumeCapacity(self: *Self, value: T, n: usize) void {
            self.#unmanaged.appendNTimesAssumeCapacity(value, n);
        }

        /// If `new_len` is less than the current length, this method will call `deinit` on the
        /// removed items.
        ///
        /// If `new_len` is greater than the current length, note that this creates *shallow* copies
        /// of `init_value`.
        pub fn resize(self: *Self, init_value: T, new_len: usize) AllocError!void {
            const len = self.items().len;
            try self.resizeWithoutDeinit(init_value, new_len);
            if (new_len < len) {
                bun.memory.deinit(self.items().ptr[new_len..len]);
            }
        }

        /// If `new_len` is less than the current length, this method will *not* call `deinit` on
        /// the removed items.
        ///
        /// If `new_len` is greater than the current length, note that this creates *shallow* copies
        /// of `init_value`.
        pub fn resizeWithoutDeinit(self: *Self, init_value: T, new_len: usize) AllocError!void {
            const len = self.items().len;
            try self.#unmanaged.resize(self.getStdAllocator(), new_len);
            if (new_len > len) {
                @memset(self.items()[len..], init_value);
            }
        }

        /// This method `deinit`s the removed items.
        pub fn shrinkAndFree(self: *Self, new_len: usize) void {
            self.prepareForDeepShrink(new_len);
            self.shrinkAndFreeShallow(new_len);
        }

        /// This method does *not* `deinit` the removed items.
        pub fn shrinkAndFreeShallow(self: *Self, new_len: usize) void {
            self.#unmanaged.shrinkAndFree(self.getStdAllocator(), new_len);
        }

        /// This method `deinit`s the removed items.
        pub fn shrinkRetainingCapacity(self: *Self, new_len: usize) void {
            self.prepareForDeepShrink(new_len);
            self.shrinkRetainingCapacityShallow(new_len);
        }

        /// This method does *not* `deinit` the removed items.
        pub fn shrinkRetainingCapacityShallow(self: *Self, new_len: usize) void {
            self.#unmanaged.shrinkRetainingCapacity(new_len);
        }

        /// This method `deinit`s all items.
        pub fn clearRetainingCapacity(self: *Self) void {
            bun.memory.deinit(self.items());
            self.clearRetainingCapacityShallow();
        }

        /// This method does *not* `deinit` any items.
        pub fn clearRetainingCapacityShallow(self: *Self) void {
            self.#unmanaged.clearRetainingCapacity();
        }

        /// This method `deinit`s all items.
        pub fn clearAndFree(self: *Self) void {
            bun.memory.deinit(self.items());
            self.clearAndFreeShallow();
        }

        /// This method does *not* `deinit` any items.
        pub fn clearAndFreeShallow(self: *Self) void {
            self.#unmanaged.clearAndFree(self.getStdAllocator());
        }

        pub fn ensureTotalCapacity(self: *Self, new_capacity: usize) AllocError!void {
            return self.#unmanaged.ensureTotalCapacity(self.getStdAllocator(), new_capacity);
        }

        pub fn ensureTotalCapacityPrecise(self: *Self, new_capacity: usize) AllocError!void {
            return self.#unmanaged.ensureTotalCapacityPrecise(self.getStdAllocator(), new_capacity);
        }

        pub fn ensureUnusedCapacity(self: *Self, additional_count: usize) AllocError!void {
            return self.#unmanaged.ensureUnusedCapacity(self.getStdAllocator(), additional_count);
        }

        /// Note that this creates *shallow* copies of `init_value`.
        pub fn expandToCapacity(self: *Self, init_value: T) void {
            const len = self.items().len;
            self.#unmanaged.expandToCapacity();
            @memset(self.items()[len..], init_value);
        }

        pub fn pop(self: *Self) ?T {
            return self.#unmanaged.pop();
        }

        pub fn getLast(self: *const Self) *T {
            const items_ = self.items();
            return &items_[items_.len - 1];
        }

        pub fn getLastOrNull(self: *const Self) ?*T {
            return if (self.isEmpty()) null else self.getLast();
        }

        pub fn isEmpty(self: *const Self) bool {
            return self.items().len == 0;
        }

        fn prepareForDeepShrink(self: *Self, new_len: usize) void {
            const items_ = self.items();
            bun.assertf(
                new_len <= items_.len,
                "new_len ({d}) cannot exceed current len ({d})",
                .{ new_len, items_.len },
            );
            bun.memory.deinit(items_[new_len..]);
        }

        fn getStdAllocator(self: *const Self) std.mem.Allocator {
            return bun.allocators.asStd(self.#allocator);
        }
    };
}

const bun = @import("bun");
const std = @import("std");
const AllocError = std.mem.Allocator.Error;
