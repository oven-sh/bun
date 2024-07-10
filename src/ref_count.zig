const std = @import("std");
const bun = @import("root").bun;

pub fn RefCount(comptime TypeName: type, comptime deinit_on_zero: bool) type {
    return struct {
        const AllocatorType = if (deinit_on_zero) std.mem.Allocator else void;

        value: Type,
        count: i32 = 1,
        allocator: AllocatorType = undefined,

        pub inline fn ref(this: *@This()) void {
            this.count += 1;
        }

        /// Create a new reference counted value.
        pub inline fn init(
            value: Type,
            allocator: std.mem.Allocator,
        ) !*@This() {
            var ptr = try allocator.create(@This());
            ptr.create(value, allocator);
            return ptr;
        }

        /// Get the value & increment the reference count.
        pub inline fn get(this: *@This()) *Type {
            bun.assert(this.count >= 0);

            this.count += 1;
            return this.leak();
        }

        /// Get the value without incrementing the reference count.
        pub inline fn leak(this: *@This()) *Type {
            return &this.value;
        }

        pub inline fn getRef(this: *@This()) *@This() {
            this.count += 1;
            return this;
        }

        pub inline fn create(
            this: *@This(),
            value: Type,
            allocator: AllocatorType,
        ) void {
            this.* = .{
                .value = value,
                .allocator = allocator,
                .count = 1,
            };
        }

        pub inline fn deinit(this: *@This()) void {
            if (comptime @hasDecl(Type, "deinit")) {
                this.value.deinit();
            }

            if (comptime deinit_on_zero) {
                var allocator = this.allocator;
                allocator.destroy(this);
            }
        }

        pub inline fn deref(this: *@This()) void {
            this.count -= 1;

            bun.assert(this.count >= 0);

            if (comptime deinit_on_zero) {
                if (this.count <= 0) {
                    this.deinit();
                }
            }
        }

        pub const Type = TypeName;
    };
}
