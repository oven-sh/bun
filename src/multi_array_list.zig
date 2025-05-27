const std = @import("std");
const builtin = @import("builtin");
const bun = @import("bun");
const assert = bun.assert;
const meta = std.meta;
const mem = std.mem;
const Allocator = mem.Allocator;

/// A MultiArrayList stores a list of a struct or tagged union type.
/// Instead of storing a single list of items, MultiArrayList
/// stores separate lists for each field of the struct or
/// lists of tags and bare unions.
/// This allows for memory savings if the struct or union has padding,
/// and also improves cache usage if only some fields or just tags
/// are needed for a computation.  The primary API for accessing fields is
/// the `slice()` function, which computes the start pointers
/// for the array of each field.  From the slice you can call
/// `.items(.<field_name>)` to obtain a slice of field values.
/// For unions you can call `.items(.tags)` or `.items(.data)`.
pub fn MultiArrayList(comptime T: type) type {
    return struct {
        bytes: [*]align(@alignOf(T)) u8 = undefined,
        len: usize = 0,
        capacity: usize = 0,

        pub const empty: Self = .{
            .bytes = undefined,
            .len = 0,
            .capacity = 0,
        };

        const Elem = switch (@typeInfo(T)) {
            .@"struct" => T,
            .@"union" => |u| struct {
                pub const Bare = @Type(.{ .@"union" = .{
                    .layout = u.layout,
                    .tag_type = null,
                    .fields = u.fields,
                    .decls = &.{},
                } });
                pub const Tag =
                    u.tag_type orelse @compileError("MultiArrayList does not support untagged unions");
                tags: Tag,
                data: Bare,

                pub fn fromT(outer: T) @This() {
                    const tag = meta.activeTag(outer);
                    return .{
                        .tags = tag,
                        .data = switch (tag) {
                            inline else => |t| @unionInit(Bare, @tagName(t), @field(outer, @tagName(t))),
                        },
                    };
                }
                pub fn toT(tag: Tag, bare: Bare) T {
                    return switch (tag) {
                        inline else => |t| @unionInit(T, @tagName(t), @field(bare, @tagName(t))),
                    };
                }
            },
            else => @compileError("MultiArrayList only supports structs and tagged unions"),
        };

        pub const Field = meta.FieldEnum(Elem);

        /// A MultiArrayList.Slice contains cached start pointers for each field in the list.
        /// These pointers are not normally stored to reduce the size of the list in memory.
        /// If you are accessing multiple fields, call slice() first to compute the pointers,
        /// and then get the field arrays from the slice.
        pub const Slice = struct {
            /// This array is indexed by the field index which can be obtained
            /// by using @intFromEnum() on the Field enum
            ptrs: [fields.len][*]u8,
            len: usize,
            capacity: usize,

            pub const empty: Slice = .{
                .ptrs = undefined,
                .len = 0,
                .capacity = 0,
            };

            pub fn items(self: Slice, comptime field: Field) []FieldType(field) {
                const F = FieldType(field);
                if (self.capacity == 0) {
                    return &[_]F{};
                }
                const byte_ptr = self.ptrs[@intFromEnum(field)];
                const casted_ptr: [*]F = if (@sizeOf(F) == 0)
                    undefined
                else
                    @ptrCast(@alignCast(byte_ptr));
                return casted_ptr[0..self.len];
            }

            pub fn set(self: *Slice, index: usize, elem: T) void {
                const e = switch (@typeInfo(T)) {
                    .@"struct" => elem,
                    .@"union" => Elem.fromT(elem),
                    else => unreachable,
                };
                inline for (fields, 0..) |field_info, i| {
                    self.items(@as(Field, @enumFromInt(i)))[index] = @field(e, field_info.name);
                }
            }

            pub fn get(self: Slice, index: usize) T {
                var result: Elem = undefined;
                inline for (fields, 0..) |field_info, i| {
                    @field(result, field_info.name) = self.items(@as(Field, @enumFromInt(i)))[index];
                }
                return switch (@typeInfo(T)) {
                    .@"struct" => result,
                    .@"union" => Elem.toT(result.tags, result.data),
                    else => unreachable,
                };
            }

            pub fn toMultiArrayList(self: Slice) Self {
                if (self.ptrs.len == 0 or self.capacity == 0) {
                    return .{};
                }
                const unaligned_ptr = self.ptrs[sizes.fields[0]];
                const aligned_ptr: [*]align(@alignOf(Elem)) u8 = @alignCast(unaligned_ptr);
                return .{
                    .bytes = aligned_ptr,
                    .len = self.len,
                    .capacity = self.capacity,
                };
            }

            pub fn deinit(self: *Slice, gpa: Allocator) void {
                var other = self.toMultiArrayList();
                other.deinit(gpa);
                self.* = undefined;
            }

            /// This function is used in the debugger pretty formatters in tools/ to fetch the
            /// child field order and entry type to facilitate fancy debug printing for this type.
            fn dbHelper(self: *Slice, child: *Elem, field: *Field, entry: *Entry) void {
                _ = self;
                _ = child;
                _ = field;
                _ = entry;
            }
        };

        const Self = @This();

        const fields = meta.fields(Elem);
        /// `sizes.bytes` is an array of @sizeOf each T field. Sorted by alignment, descending.
        /// `sizes.fields` is an array mapping from `sizes.bytes` array index to field index.
        const sizes = blk: {
            const Data = struct {
                size: usize,
                size_index: usize,
                alignment: usize,
            };
            var data: [fields.len]Data = undefined;
            for (fields, 0..) |field_info, i| {
                data[i] = .{
                    .size = @sizeOf(field_info.type),
                    .size_index = i,
                    .alignment = if (@sizeOf(field_info.type) == 0) 1 else field_info.alignment,
                };
            }
            const Sort = struct {
                fn lessThan(context: void, lhs: Data, rhs: Data) bool {
                    _ = context;
                    return lhs.alignment > rhs.alignment;
                }
            };
            mem.sort(Data, &data, {}, Sort.lessThan);
            var sizes_bytes: [fields.len]usize = undefined;
            var field_indexes: [fields.len]usize = undefined;
            for (data, 0..) |elem, i| {
                sizes_bytes[i] = elem.size;
                field_indexes[i] = elem.size_index;
            }
            break :blk .{
                .bytes = sizes_bytes,
                .fields = field_indexes,
            };
        };

        /// Release all allocated memory.
        pub fn deinit(self: *Self, gpa: Allocator) void {
            gpa.free(self.allocatedBytes());
            self.* = undefined;
        }

        /// The caller owns the returned memory. Empties this MultiArrayList.
        pub fn toOwnedSlice(self: *Self) Slice {
            const result = self.slice();
            self.* = .{};
            return result;
        }

        /// Compute pointers to the start of each field of the array.
        /// If you need to access multiple fields, calling this may
        /// be more efficient than calling `items()` multiple times.
        pub fn slice(self: Self) Slice {
            var result: Slice = .{
                .ptrs = undefined,
                .len = self.len,
                .capacity = self.capacity,
            };
            var ptr: [*]u8 = self.bytes;
            for (sizes.bytes, sizes.fields) |field_size, i| {
                result.ptrs[i] = ptr;
                ptr += field_size * self.capacity;
            }
            return result;
        }

        /// Get the slice of values for a specified field.
        /// If you need multiple fields, consider calling slice()
        /// instead.
        pub fn items(self: Self, comptime field: Field) []FieldType(field) {
            return self.slice().items(field);
        }

        /// Overwrite one array element with new data.
        pub fn set(self: *Self, index: usize, elem: T) void {
            var slices = self.slice();
            slices.set(index, elem);
        }

        /// Obtain all the data for one array element.
        pub fn get(self: Self, index: usize) T {
            return self.slice().get(index);
        }

        /// Extend the list by 1 element. Allocates more memory as necessary.
        pub fn append(self: *Self, gpa: Allocator, elem: T) !void {
            try self.ensureUnusedCapacity(gpa, 1);
            self.appendAssumeCapacity(elem);
        }

        /// Extend the list by 1 element, but asserting `self.capacity`
        /// is sufficient to hold an additional item.
        pub fn appendAssumeCapacity(self: *Self, elem: T) void {
            assert(self.len < self.capacity);
            self.len += 1;
            self.set(self.len - 1, elem);
        }

        /// Extend the list by 1 element, returning the newly reserved
        /// index with uninitialized data.
        /// Allocates more memory as necesasry.
        pub fn addOne(self: *Self, allocator: Allocator) Allocator.Error!usize {
            try self.ensureUnusedCapacity(allocator, 1);
            return self.addOneAssumeCapacity();
        }

        /// Extend the list by 1 element, asserting `self.capacity`
        /// is sufficient to hold an additional item.  Returns the
        /// newly reserved index with uninitialized data.
        pub fn addOneAssumeCapacity(self: *Self) usize {
            assert(self.len < self.capacity);
            const index = self.len;
            self.len += 1;
            return index;
        }

        /// Remove and return the last element from the list, or return null if list is empty.
        /// Invalidates pointers to fields of the removed element.
        pub fn pop(self: *Self) ?T {
            if (self.len == 0) return null;
            const val = self.get(self.len - 1);
            self.len -= 1;
            return val;
        }

        /// Inserts an item into an ordered list.  Shifts all elements
        /// after and including the specified index back by one and
        /// sets the given index to the specified element.  May reallocate
        /// and invalidate iterators.
        pub fn insert(self: *Self, gpa: Allocator, index: usize, elem: T) !void {
            try self.ensureUnusedCapacity(gpa, 1);
            self.insertAssumeCapacity(index, elem);
        }

        /// Invalidates all element pointers.
        pub fn clearRetainingCapacity(this: *Self) void {
            this.len = 0;
        }

        /// Inserts an item into an ordered list which has room for it.
        /// Shifts all elements after and including the specified index
        /// back by one and sets the given index to the specified element.
        /// Will not reallocate the array, does not invalidate iterators.
        pub fn insertAssumeCapacity(self: *Self, index: usize, elem: T) void {
            assert(self.len < self.capacity);
            assert(index <= self.len);
            self.len += 1;
            const entry = switch (@typeInfo(T)) {
                .@"struct" => elem,
                .@"union" => Elem.fromT(elem),
                else => unreachable,
            };
            const slices = self.slice();
            inline for (fields, 0..) |field_info, field_index| {
                const field_slice = slices.items(@as(Field, @enumFromInt(field_index)));
                var i: usize = self.len - 1;
                while (i > index) : (i -= 1) {
                    field_slice[i] = field_slice[i - 1];
                }
                field_slice[index] = @field(entry, field_info.name);
            }
        }

        pub fn appendListAssumeCapacity(this: *Self, other: Self) void {
            const offset = this.len;
            this.len += other.len;
            const other_slice = other.slice();
            const this_slice = this.slice();
            inline for (fields, 0..) |field_info, i| {
                if (@sizeOf(field_info.type) != 0) {
                    const field = @as(Field, @enumFromInt(i));
                    @memcpy(this_slice.items(field)[offset..], other_slice.items(field));
                }
            }
        }

        /// Remove the specified item from the list, swapping the last
        /// item in the list into its position.  Fast, but does not
        /// retain list ordering.
        pub fn swapRemove(self: *Self, index: usize) void {
            const slices = self.slice();
            inline for (fields, 0..) |_, i| {
                const field_slice = slices.items(@as(Field, @enumFromInt(i)));
                field_slice[index] = field_slice[self.len - 1];
                field_slice[self.len - 1] = undefined;
            }
            self.len -= 1;
        }

        /// Remove the specified item from the list, shifting items
        /// after it to preserve order.
        pub fn orderedRemove(self: *Self, index: usize) void {
            const slices = self.slice();
            inline for (fields, 0..) |_, field_index| {
                const field_slice = slices.items(@as(Field, @enumFromInt(field_index)));
                var i = index;
                while (i < self.len - 1) : (i += 1) {
                    field_slice[i] = field_slice[i + 1];
                }
                field_slice[i] = undefined;
            }
            self.len -= 1;
        }

        /// Adjust the list's length to `new_len`.
        /// Does not initialize added items, if any.
        pub fn resize(self: *Self, gpa: Allocator, new_len: usize) !void {
            try self.ensureTotalCapacity(gpa, new_len);
            self.len = new_len;
        }

        /// Attempt to reduce allocated capacity to `new_len`.
        /// If `new_len` is greater than zero, this may fail to reduce the capacity,
        /// but the data remains intact and the length is updated to new_len.
        pub fn shrinkAndFree(self: *Self, gpa: Allocator, new_len: usize) void {
            if (new_len == 0) return clearAndFree(self, gpa);

            assert(new_len <= self.capacity);
            assert(new_len <= self.len);

            const other_bytes = gpa.alignedAlloc(
                u8,
                @alignOf(Elem),
                capacityInBytes(new_len),
            ) catch {
                const self_slice = self.slice();
                inline for (fields, 0..) |field_info, i| {
                    if (@sizeOf(field_info.type) != 0) {
                        const field = @as(Field, @enumFromInt(i));
                        const dest_slice = self_slice.items(field)[new_len..];
                        // We use memset here for more efficient codegen in safety-checked,
                        // valgrind-enabled builds. Otherwise the valgrind client request
                        // will be repeated for every element.
                        @memset(dest_slice, undefined);
                    }
                }
                self.len = new_len;
                return;
            };
            var other = Self{
                .bytes = other_bytes.ptr,
                .capacity = new_len,
                .len = new_len,
            };
            self.len = new_len;
            const self_slice = self.slice();
            const other_slice = other.slice();
            inline for (fields, 0..) |field_info, i| {
                if (@sizeOf(field_info.type) != 0) {
                    const field = @as(Field, @enumFromInt(i));
                    @memcpy(other_slice.items(field), self_slice.items(field));
                }
            }
            gpa.free(self.allocatedBytes());
            self.* = other;
        }

        pub fn clearAndFree(self: *Self, gpa: Allocator) void {
            gpa.free(self.allocatedBytes());
            self.* = .{};
        }

        /// Reduce length to `new_len`.
        /// Invalidates pointers to elements `items[new_len..]`.
        /// Keeps capacity the same.
        pub fn shrinkRetainingCapacity(self: *Self, new_len: usize) void {
            self.len = new_len;
        }

        /// Modify the array so that it can hold at least `new_capacity` items.
        /// Implements super-linear growth to achieve amortized O(1) append operations.
        /// Invalidates pointers if additional memory is needed.
        pub fn ensureTotalCapacity(self: *Self, gpa: Allocator, new_capacity: usize) !void {
            var better_capacity = self.capacity;
            if (better_capacity >= new_capacity) return;

            while (true) {
                better_capacity += better_capacity / 2 + 8;
                if (better_capacity >= new_capacity) break;
            }

            return self.setCapacity(gpa, better_capacity);
        }

        /// Modify the array so that it can hold at least `additional_count` **more** items.
        /// Invalidates pointers if additional memory is needed.
        pub fn ensureUnusedCapacity(self: *Self, gpa: Allocator, additional_count: usize) !void {
            return self.ensureTotalCapacity(gpa, self.len + additional_count);
        }

        /// Modify the array so that it can hold exactly `new_capacity` items.
        /// Invalidates pointers if additional memory is needed.
        /// `new_capacity` must be greater or equal to `len`.
        pub fn setCapacity(self: *Self, gpa: Allocator, new_capacity: usize) !void {
            assert(new_capacity >= self.len);
            const new_bytes = try gpa.alignedAlloc(
                u8,
                @alignOf(Elem),
                capacityInBytes(new_capacity),
            );
            if (self.len == 0) {
                gpa.free(self.allocatedBytes());
                self.bytes = new_bytes.ptr;
                self.capacity = new_capacity;
                return;
            }
            var other = Self{
                .bytes = new_bytes.ptr,
                .capacity = new_capacity,
                .len = self.len,
            };
            const self_slice = self.slice();
            const other_slice = other.slice();
            inline for (fields, 0..) |field_info, i| {
                if (@sizeOf(field_info.type) != 0) {
                    const field = @as(Field, @enumFromInt(i));
                    @memcpy(other_slice.items(field), self_slice.items(field));
                }
            }
            gpa.free(self.allocatedBytes());
            self.* = other;
        }

        /// Create a copy of this list with a new backing store,
        /// using the specified allocator.
        pub fn clone(self: Self, gpa: Allocator) !Self {
            var result = Self{};
            errdefer result.deinit(gpa);
            try result.ensureTotalCapacity(gpa, self.len);
            result.len = self.len;
            const self_slice = self.slice();
            const result_slice = result.slice();
            inline for (fields, 0..) |field_info, i| {
                if (@sizeOf(field_info.type) != 0) {
                    const field = @as(Field, @enumFromInt(i));
                    @memcpy(result_slice.items(field), self_slice.items(field));
                }
            }
            return result;
        }

        /// `ctx` has the following method:
        /// `fn lessThan(ctx: @TypeOf(ctx), a_index: usize, b_index: usize) bool`
        fn sortInternal(self: Self, a: usize, b: usize, ctx: anytype, comptime mode: std.sort.Mode) void {
            const sort_context: struct {
                sub_ctx: @TypeOf(ctx),
                slice: Slice,

                pub fn swap(sc: @This(), a_index: usize, b_index: usize) void {
                    inline for (fields, 0..) |field_info, i| {
                        if (@sizeOf(field_info.type) != 0) {
                            const field: Field = @enumFromInt(i);
                            const ptr = sc.slice.items(field);
                            mem.swap(field_info.type, &ptr[a_index], &ptr[b_index]);
                        }
                    }
                }

                pub fn lessThan(sc: @This(), a_index: usize, b_index: usize) bool {
                    return sc.sub_ctx.lessThan(a_index, b_index);
                }
            } = .{
                .sub_ctx = ctx,
                .slice = self.slice(),
            };

            switch (mode) {
                .stable => mem.sortContext(a, b, sort_context),
                .unstable => mem.sortUnstableContext(a, b, sort_context),
            }
        }

        /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
        /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
        /// If this guarantee does not matter, `sortUnstable` might be a faster alternative.
        /// `ctx` has the following method:
        /// `fn lessThan(ctx: @TypeOf(ctx), a_index: usize, b_index: usize) bool`
        pub fn sort(self: Self, ctx: anytype) void {
            self.sortInternal(0, self.len, ctx, .stable);
        }

        /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`)
        /// This function guarantees a stable sort, i.e the relative order of equal elements is preserved during sorting.
        /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
        /// If this guarantee does not matter, `sortSpanUnstable` might be a faster alternative.
        /// `ctx` has the following method:
        /// `fn lessThan(ctx: @TypeOf(ctx), a_index: usize, b_index: usize) bool`
        pub fn sortSpan(self: Self, a: usize, b: usize, ctx: anytype) void {
            self.sortInternal(a, b, ctx, .stable);
        }

        /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
        /// Due to the weaker guarantees of this function, this may be faster than the stable `sort` method.
        /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
        /// `ctx` has the following method:
        /// `fn lessThan(ctx: @TypeOf(ctx), a_index: usize, b_index: usize) bool`
        pub fn sortUnstable(self: Self, ctx: anytype) void {
            self.sortInternal(0, self.len, ctx, .unstable);
        }

        /// Sorts only the subsection of items between indices `a` and `b` (excluding `b`)
        /// This function does NOT guarantee a stable sort, i.e the relative order of equal elements may change during sorting.
        /// Due to the weaker guarantees of this function, this may be faster than the stable `sortSpan` method.
        /// Read more about stable sorting here: https://en.wikipedia.org/wiki/Sorting_algorithm#Stability
        /// `ctx` has the following method:
        /// `fn lessThan(ctx: @TypeOf(ctx), a_index: usize, b_index: usize) bool`
        pub fn sortSpanUnstable(self: Self, a: usize, b: usize, ctx: anytype) void {
            self.sortInternal(a, b, ctx, .unstable);
        }

        fn capacityInBytes(capacity: usize) usize {
            comptime var elem_bytes: usize = 0;
            inline for (sizes.bytes) |size| elem_bytes += size;
            return elem_bytes * capacity;
        }

        fn allocatedBytes(self: Self) []align(@alignOf(Elem)) u8 {
            return self.bytes[0..capacityInBytes(self.capacity)];
        }

        pub fn memoryCost(self: Self) usize {
            return capacityInBytes(self.capacity);
        }

        pub fn zero(self: Self) void {
            @memset(self.allocatedBytes(), 0);
        }

        fn FieldType(comptime field: Field) type {
            return @FieldType(Elem, @tagName(field));
        }

        const Entry = entry: {
            var entry_fields: [fields.len]std.builtin.Type.StructField = undefined;
            for (&entry_fields, sizes.fields) |*entry_field, i| entry_field.* = .{
                .name = fields[i].name ++ "_ptr",
                .type = *fields[i].type,
                .default_value_ptr = null,
                .is_comptime = fields[i].is_comptime,
                .alignment = fields[i].alignment,
            };
            break :entry @Type(.{ .@"struct" = .{
                .layout = .@"extern",
                .fields = &entry_fields,
                .decls = &.{},
                .is_tuple = false,
            } });
        };
        /// This function is used in the debugger pretty formatters in tools/ to fetch the
        /// child field order and entry type to facilitate fancy debug printing for this type.
        fn dbHelper(self: *Self, child: *Elem, field: *Field, entry: *Entry) void {
            _ = self;
            _ = child;
            _ = field;
            _ = entry;
        }

        comptime {
            if (builtin.zig_backend == .stage2_llvm and !builtin.strip_debug_info) {
                _ = &dbHelper;
                _ = &Slice.dbHelper;
            }
        }
    };
}
