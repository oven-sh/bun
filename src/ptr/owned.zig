/// Options for `OwnedWithOpts`.
pub const Options = struct {
    // Whether to call `deinit` on the data before freeing it, if such a method exists.
    deinit: bool = true,
};

/// An owned pointer or slice.
///
/// This type is a wrapper around a pointer or slice of type `Pointer`, and the allocator that was
/// used to allocate the memory. Calling `deinit` on this type first calls `deinit` on the
/// underlying data, and then frees the memory.
///
/// `Pointer` can be a single-item pointer, a slice, or an optional version of either of those;
/// e.g., `Owned(*u8)`, `Owned([]u8)`, `Owned(?*u8)`, or `Owned(?[]u8)`.
///
/// Use the `alloc*` functions to create an `Owned(Pointer)` by allocating memory, or use
/// `fromRawOwned` to create one from a raw pointer and allocator. Use `get` to access the inner
/// pointer, and call `deinit` to free the memory. If `Pointer` is optional, use `initNull` to
/// create a null `Owned(Pointer)`.
pub fn Owned(comptime Pointer: type) type {
    return OwnedWithOpts(Pointer, .{});
}

/// Like `Owned`, but takes explicit options.
///
/// `Owned(Pointer)` is simply an alias of `OwnedWithOpts(Pointer, .{})`.
pub fn OwnedWithOpts(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer);
    const NonOptionalPointer = info.NonOptionalPointer;
    const Child = info.Child;

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,
        unsafe_allocator: Allocator,

        pub const Unmanaged = OwnedUnmanaged(Pointer, options);

        pub const alloc = switch (info.kind()) {
            .single => struct {
                /// Allocate memory for a single value and initialize it with `value`.
                pub fn alloc(allocator: Allocator, value: Child) Allocator.Error!Self {
                    const data = try allocator.create(Child);
                    data.* = value;
                    return .{
                        .unsafe_raw_pointer = data,
                        .unsafe_allocator = allocator,
                    };
                }
            },
            .slice => struct {
                /// Allocate memory for `count` elements, and initialize every element with `elem`.
                pub fn alloc(allocator: Allocator, count: usize, elem: Child) Allocator.Error!Self {
                    const data = try allocator.alloc(Child, count);
                    @memset(data, elem);
                    return .{
                        .unsafe_raw_pointer = data,
                        .unsafe_allocator = allocator,
                    };
                }
            },
        }.alloc;

        /// Create an `Owned(Pointer)` by allocating memory and performing a shallow copy of `data`.
        pub fn allocDupe(data: NonOptionalPointer, allocator: Allocator) Allocator.Error!Self {
            return switch (comptime info.kind()) {
                .single => .alloc(allocator, data.*),
                .slice => .fromRawOwned(try allocator.dupe(Child, data), allocator),
            };
        }

        /// Create an `Owned(Pointer)` from a raw pointer and allocator.
        ///
        /// Requirements:
        ///
        /// * `data` must have been allocated by `allocator`.
        /// * `data` must not be freed for the life of the `Owned(Pointer)`.
        pub fn fromRawOwned(data: NonOptionalPointer, allocator: Allocator) Self {
            return .{
                .unsafe_raw_pointer = data,
                .unsafe_allocator = allocator,
            };
        }

        /// Deinitialize the pointer or slice, freeing its memory.
        ///
        /// By default, this will first call `deinit` on the data itself, if such a method exists.
        /// (For slices, this will call `deinit` on every element in this slice.) This behavior can
        /// be disabled in `options`.
        pub fn deinit(self: Self) void {
            const data = if (comptime info.isOptional())
                self.unsafe_raw_pointer orelse return
            else
                self.unsafe_raw_pointer;
            if (comptime options.deinit and std.meta.hasFn(Child, "deinit")) {
                switch (comptime info.kind()) {
                    .single => data.deinit(),
                    .slice => for (data) |*elem| elem.deinit(),
                }
            }
            switch (comptime info.kind()) {
                .single => self.unsafe_allocator.destroy(data),
                .slice => self.unsafe_allocator.free(data),
            }
        }

        /// Returns the inner pointer or slice.
        pub fn get(self: if (info.isConst()) Self else *Self) Pointer {
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

        /// Converts an `Owned(Pointer)` into its constituent parts, a raw pointer and an allocator.
        ///
        /// Do not use `self` or call `deinit` after calling this method.
        pub const intoRawOwned = switch (info.isOptional()) {
            // Regular, non-optional pointer (e.g., `*u8`, `[]u8`).
            false => struct {
                pub fn intoRawOwned(self: Self) struct { Pointer, Allocator } {
                    return .{ self.unsafe_raw_pointer, self.unsafe_allocator };
                }
            },
            // Optional pointer (e.g., `?*u8`, `?[]u8`).
            true => struct {
                pub fn intoRawOwned(self: Self) ?struct { NonOptionalPointer, Allocator } {
                    return .{ self.unsafe_raw_pointer orelse return null, self.unsafe_allocator };
                }
            },
        }.intoRawOwned;

        /// Return a null `Owned(Pointer)`. This method is provided only if `Pointer` is an
        /// optional type.
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

        /// If this pointer is non-null, convert it to an `Owned(NonOptionalPointer)`, and set
        /// this pointer to null. Otherwise, do nothing and return null.
        ///
        /// This method is provided only if `Pointer` is an optional type.
        ///
        /// It is permitted, but not required, to call deinit on `self` after calling this method.
        pub const take = if (info.isOptional()) struct {
            pub fn take(self: *Self) ?Owned(NonOptionalPointer) {
                const data = self.unsafe_raw_pointer orelse return null;
                const allocator = self.unsafe_allocator;
                self.* = .initNull();
                return .fromRawOwned(data, allocator);
            }
        }.take;

        /// Convert this owned pointer into an unmanaged variant that doesn't store the allocator.
        pub fn toUnmanaged(self: Self) Unmanaged {
            return .{
                .unsafe_raw_pointer = self.unsafe_raw_pointer,
            };
        }
    };
}

/// An unmanaged version of `Owned(Pointer)` that doesn't store the allocator.
pub fn OwnedUnmanaged(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer);

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,

        /// Convert this unmanaged owned pointer back into a managed version.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        pub fn toManaged(self: Self, allocator: Allocator) OwnedWithOpts(Pointer, options) {
            const data = if (comptime info.isOptional())
                self.unsafe_raw_pointer orelse return .initNull()
            else
                self.unsafe_raw_pointer;
            return .fromRawOwned(data, allocator);
        }

        /// Deinitialize the pointer or slice. See `Owned.deinit` for more information.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        pub fn deinit(self: Self, allocator: Allocator) void {
            self.toManaged(allocator).deinit();
        }

        /// Returns the inner pointer or slice.
        pub fn get(self: if (info.isConst()) Self else *Self) Pointer {
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
    };
}

pub const MaybeOwned = @import("./owned/maybe.zig").MaybeOwned;
pub const MaybeOwnedWithOpts = @import("./owned/maybe.zig").MaybeOwned;

const std = @import("std");
const Allocator = std.mem.Allocator;

const meta = @import("./owned/meta.zig");
const AddConst = meta.AddConst;
const PointerInfo = meta.PointerInfo;
