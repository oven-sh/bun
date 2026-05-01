/// This type can be used with `bun.ptr.Owned` to model "maybe owned" pointers:
///
/// ```
/// // Either owned by the default allocator, or borrowed
/// const MaybeOwnedFoo = bun.ptr.OwnedIn(*Foo, bun.allocators.MaybeOwned(bun.DefaultAllocator));
///
/// var owned_foo: MaybeOwnedFoo = .new(makeFoo());
/// var borrowed_foo: MaybeOwnedFoo = .fromRawIn(some_foo_ptr, .initBorrowed());
///
/// owned_foo.deinit(); // calls `Foo.deinit` and frees the memory
/// borrowed_foo.deinit(); // no-op
/// ```
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub fn MaybeOwned(comptime Allocator: type) type {
    return struct {
        const Self = @This();

        _parent: bun.allocators.Nullable(Allocator),

        /// Same as `.initBorrowed()`. This allocator cannot be used to allocate memory; a panic
        /// will occur.
        pub const borrowed = .initBorrowed();

        /// Creates a `MaybeOwned` allocator that owns memory.
        ///
        /// Allocations are forwarded to a default-initialized `Allocator`.
        pub fn init() Self {
            return .initOwned(bun.memory.initDefault(Allocator));
        }

        /// Creates a `MaybeOwned` allocator that owns memory, and forwards to a specific
        /// allocator.
        ///
        /// Allocations are forwarded to `parent_alloc`.
        pub fn initOwned(parent_alloc: Allocator) Self {
            return .initRaw(parent_alloc);
        }

        /// Creates a `MaybeOwned` allocator that does not own any memory. This allocator cannot
        /// be used to allocate new memory (a panic will occur), and its implementation of `free`
        /// is a no-op.
        pub fn initBorrowed() Self {
            return .initRaw(null);
        }

        pub fn deinit(self: *Self) void {
            var maybe_parent = self.intoParent();
            if (maybe_parent) |*parent_alloc| {
                bun.memory.deinit(parent_alloc);
            }
        }

        pub fn isOwned(self: Self) bool {
            return self.rawParent() != null;
        }

        pub fn allocator(self: Self) std.mem.Allocator {
            const maybe_parent = self.rawParent();
            return if (maybe_parent) |parent_alloc|
                bun.allocators.asStd(parent_alloc)
            else
                .{ .ptr = undefined, .vtable = &null_vtable };
        }

        const BorrowedParent = bun.allocators.Borrowed(Allocator);

        pub fn parent(self: Self) ?BorrowedParent {
            const maybe_parent = self.rawParent();
            return if (maybe_parent) |parent_alloc|
                bun.allocators.borrow(parent_alloc)
            else
                null;
        }

        pub fn intoParent(self: *Self) ?Allocator {
            defer self.* = undefined;
            return self.rawParent();
        }

        /// Used by smart pointer types and allocator wrappers. See `bun.allocators.borrow`.
        pub const Borrowed = MaybeOwned(BorrowedParent);

        pub fn borrow(self: Self) Borrowed {
            return .{ ._parent = bun.allocators.initNullable(BorrowedParent, self.parent()) };
        }

        fn initRaw(parent_alloc: ?Allocator) Self {
            return .{ ._parent = bun.allocators.initNullable(Allocator, parent_alloc) };
        }

        fn rawParent(self: Self) ?Allocator {
            return bun.allocators.unpackNullable(Allocator, self._parent);
        }
    };
}

fn nullAlloc(ptr: *anyopaque, len: usize, alignment: Alignment, ret_addr: usize) ?[*]u8 {
    _ = .{ ptr, len, alignment, ret_addr };
    std.debug.panic("cannot allocate with a borrowed `MaybeOwned` allocator", .{});
}

const null_vtable: std.mem.Allocator.VTable = .{
    .alloc = nullAlloc,
    .resize = std.mem.Allocator.noResize,
    .remap = std.mem.Allocator.noRemap,
    .free = std.mem.Allocator.noFree,
};

const bun = @import("bun");
const std = @import("std");
const Alignment = std.mem.Alignment;
