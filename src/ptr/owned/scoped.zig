/// Options for `WithOptions`.
pub const Options = struct {
    // Whether to call `deinit` on the data before freeing it, if such a method exists.
    deinit: bool = true,

    // The owned pointer will always use this allocator.
    allocator: Allocator = bun.default_allocator,

    fn toDynamic(self: Options) owned.Options {
        return .{
            .deinit = self.deinit,
            .allocator = null,
        };
    }
};

/// An owned pointer that uses `AllocationScope` when enabled.
pub fn ScopedOwned(comptime Pointer: type) type {
    return WithOptions(Pointer, .{});
}

/// Like `ScopedOwned`, but takes explicit options.
///
/// `ScopedOwned(Pointer)` is simply an alias of `WithOptions(Pointer, .{})`.
pub fn WithOptions(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer, .{});
    const NonOptionalPointer = info.NonOptionalPointer;

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,
        unsafe_scope: if (AllocationScope.enabled) AllocationScope else void,

        const DynamicOwned = owned.WithOptions(Pointer, options.toDynamic());

        /// Creates a `ScopedOwned` from a `DynamicOwned`.
        ///
        /// If `AllocationScope` is enabled, `owned_ptr` must have been allocated by an
        /// `AllocationScope`. Otherwise, `owned_ptr` must have been allocated by
        /// `options.allocator`.
        ///
        /// This method invalidates `owned_ptr`.
        pub fn fromDynamic(owned_ptr: DynamicOwned) Self {
            const data, const allocator = if (comptime info.isOptional())
                owned_ptr.intoRawOwned() orelse return .initNull()
            else
                owned_ptr.intoRawOwned();

            const scope = if (comptime AllocationScope.enabled)
                AllocationScope.downcast(allocator) orelse std.debug.panic(
                    "expected `AllocationScope` allocator",
                    .{},
                );

            const parent = if (comptime AllocationScope.enabled) scope.parent() else allocator;
            bun.safety.alloc.assertEq(parent, options.allocator);
            return .{
                .unsafe_raw_pointer = data,
                .unsafe_scope = if (comptime AllocationScope.enabled) scope,
            };
        }

        /// Creates a `ScopedOwned` from a raw pointer and `AllocationScope`.
        ///
        /// If `AllocationScope` is enabled, `scope` must be non-null, and `data` must have
        /// been allocated by `scope`. Otherwise, `data` must have been allocated by
        /// `options.default_allocator`, and `scope` is ignored.
        pub fn fromRawOwned(data: NonOptionalPointer, scope: ?AllocationScope) Self {
            const allocator = if (comptime AllocationScope.enabled)
                (scope orelse std.debug.panic(
                    "AllocationScope should be non-null when enabled",
                    .{},
                )).allocator()
            else
                options.allocator;
            return .fromDynamic(.fromRawOwned(data, allocator));
        }

        /// Deinitializes the pointer or slice, freeing its memory if owned.
        ///
        /// By default, if the data is owned, `deinit` will first be called on the data itself.
        pub fn deinit(self: Self) void {
            self.toDynamic().deinit();
        }

        const SelfOrPtr = if (info.isConst()) Self else *Self;

        /// Returns the inner pointer or slice.
        pub fn get(self: SelfOrPtr) Pointer {
            return self.unsafe_raw_pointer;
        }

        /// Returns a const version of the inner pointer or slice.
        ///
        /// This method is not provided if the pointer is already const; use `get` in that case.
        pub const getConst = if (!info.isConst()) struct {
            pub fn getConst(self: Self) AddConst(Pointer) {
                return self.unsafe_raw_pointer;
            }
        }.getConst;

        /// Converts an owned pointer into a raw pointer.
        ///
        /// This method invalidates `self`.
        pub fn intoRawOwned(self: Self) Pointer {
            return self.unsafe_raw_pointer;
        }

        /// Returns a null `ScopedOwned`. This method is provided only if `Pointer` is an optional
        /// type.
        ///
        /// It is permitted, but not required, to call `deinit` on the returned value.
        pub const initNull = if (info.isOptional()) struct {
            pub fn initNull() Self {
                return .{
                    .unsafe_raw_pointer = null,
                    .unsafe_allocator = undefined,
                };
            }
        }.initNull;

        /// Converts a `ScopedOwned` into a `DynamicOwned`.
        ///
        /// This method invalidates `self`.
        pub fn toDynamic(self: Self) DynamicOwned {
            const data = if (comptime info.isOptional())
                self.unsafe_raw_pointer orelse return .initNull()
            else
                self.unsafe_raw_pointer;
            const allocator = if (comptime AllocationScope.enabled)
                self.unsafe_scope.allocator()
            else
                options.allocator;
            return .fromRawOwned(data, allocator);
        }
    };
}

const bun = @import("bun");
const std = @import("std");
const AllocationScope = bun.allocators.AllocationScope;
const Allocator = std.mem.Allocator;
const owned = bun.ptr.owned;

const meta = @import("../meta.zig");
const AddConst = meta.AddConst;
const PointerInfo = meta.PointerInfo;
