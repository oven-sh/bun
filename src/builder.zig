const Allocator = @import("std").mem.Allocator;
const assert = @import("std").debug.assert;
const copy = @import("std").mem.copy;
const io = @import("bun").AsyncIO;
pub fn Builder(comptime Type: type) type {
    return struct {
        const This = @This();

        len: usize = 0,
        cap: usize = 0,
        ptr: ?[*]Type = null,

        pub fn count(this: *This, slice: Type) void {
            this.cap += slice.len;
        }

        pub fn allocate(this: *This, allocator: Allocator) !void {
            var slice = try allocator.alloc(Type, this.cap);
            this.ptr = slice.ptr;
            this.len = 0;
        }

        pub fn append(this: *This, item: Type) *const Type {
            assert(this.len <= this.cap); // didn't count everything
            assert(this.ptr != null); // must call allocate first
            var result = &this.ptr.?[this.len];
            result.* = item;
            this.len += 1;
            assert(this.len <= this.cap);
            return result;
        }
    };
}
