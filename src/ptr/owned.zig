const owned = @This();

/// Options for `WithOptions`.
pub const Options = struct {
    // Whether to call `deinit` on the data before freeing it, if such a method exists.
    deinit: bool = true,

    // If non-null, the owned pointer will always use the provided allocator. This makes it the
    // same size as a raw pointer, as it no longer has to store the allocator at runtime, but it
    // means it will be a different type from owned pointers that use different allocators.
    allocator: ?Allocator = bun.default_allocator,

    fn asDynamic(self: Options) Options {
        var new = self;
        new.allocator = null;
        return new;
    }
};

/// An owned pointer or slice that was allocated using the default allocator.
///
/// This type is a wrapper around a pointer or slice of type `Pointer` that was allocated using
/// `bun.default_allocator`. Calling `deinit` on this type first calls `deinit` on the underlying
/// data, and then frees the memory.
///
/// `Pointer` can be a single-item pointer, a slice, or an optional version of either of those;
/// e.g., `Owned(*u8)`, `Owned([]u8)`, `Owned(?*u8)`, or `Owned(?[]u8)`.
///
/// Use the `alloc*` functions to create an `Owned(Pointer)` by allocating memory, or use
/// `fromRawOwned` to create one from a raw pointer. Use `get` to access the inner pointer, and
/// call `deinit` to free the memory. If `Pointer` is optional, use `initNull` to create a null
/// `Owned(Pointer)`.
///
/// See `Dynamic` for a version that supports any allocator. You can also specify a different
/// fixed allocator using `WithOptions(Pointer, .{ .allocator = some_other_allocator })`.
pub fn Owned(comptime Pointer: type) type {
    return WithOptions(Pointer, .{});
}

/// An owned pointer or slice allocated using any allocator.
///
/// This type is like `Owned`, but it supports data allocated by any allocator. To do this, it
/// stores the allocator at runtime, which increases the size of the type. An unmanaged version
/// which doesn't store the allocator is available with `Dynamic(Pointer).Unmanaged`.
pub fn Dynamic(comptime Pointer: type) type {
    return WithOptions(Pointer, .{ .allocator = null });
}

/// Like `Owned`, but takes explicit options.
///
/// `Owned(Pointer)` is simply an alias of `WithOptions(Pointer, .{})`.
pub fn WithOptions(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer, .{});
    const NonOptionalPointer = info.NonOptionalPointer;
    const Child = info.Child;

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,
        unsafe_allocator: if (options.allocator == null) Allocator else void,

        /// An unmanaged version of this owned pointer. This type doesn't store the allocator and
        /// is the same size as a raw pointer.
        ///
        /// This type is provided only if `options.allocator` is null, since if it's non-null,
        /// the owned pointer is already the size of a raw pointer.
        pub const Unmanaged = if (options.allocator == null) owned.Unmanaged(Pointer, options);

        /// Allocates a new owned pointer. The signature of this function depends on whether the
        /// pointer is a single-item pointer or a slice, and whether a fixed allocator was provided
        /// in `options`.
        pub const alloc = (if (options.allocator) |allocator| switch (info.kind()) {
            .single => struct {
                /// Allocates memory for a single value using `options.allocator`, and initializes
                /// it with `value`.
                pub fn alloc(value: Child) Allocator.Error!Self {
                    return .allocSingle(allocator, value);
                }
            },
            .slice => struct {
                /// Allocates memory for `count` elements using `options.allocator`, and initializes
                /// every element with `elem`.
                pub fn alloc(count: usize, elem: Child) Allocator.Error!Self {
                    return .allocSlice(allocator, count, elem);
                }
            },
        } else switch (info.kind()) {
            .single => struct {
                /// Allocates memory for a single value and initialize it with `value`.
                pub fn alloc(allocator: Allocator, value: Child) Allocator.Error!Self {
                    return .allocSingle(allocator, value);
                }
            },
            .slice => struct {
                /// Allocates memory for `count` elements, and initialize every element with `elem`.
                pub fn alloc(allocator: Allocator, count: usize, elem: Child) Allocator.Error!Self {
                    return .allocSlice(allocator, count, elem);
                }
            },
        }).alloc;

        const supports_default_allocator = if (options.allocator) |allocator|
            bun.allocators.isDefault(allocator)
        else
            true;

        /// Allocates an owned pointer using the default allocator. This function calls
        /// `bun.outOfMemory` if memory allocation fails.
        pub const new = if (info.kind() == .single and supports_default_allocator) struct {
            pub fn new(value: Child) Self {
                return bun.handleOom(Self.allocSingle(bun.default_allocator, value));
            }
        }.new;

        /// Creates an owned pointer by allocating memory and performing a shallow copy of
        /// `data`.
        pub const allocDupe = (if (options.allocator) |allocator| struct {
            pub fn allocDupe(data: NonOptionalPointer) Allocator.Error!Self {
                return .allocDupeImpl(data, allocator);
            }
        } else struct {
            pub fn allocDupe(data: NonOptionalPointer, allocator: Allocator) Allocator.Error!Self {
                return .allocDupeImpl(data, allocator);
            }
        }).allocDupe;

        pub const fromRawOwned = (if (options.allocator == null) struct {
            /// Creates an owned pointer from a raw pointer and allocator.
            ///
            /// Requirements:
            ///
            /// * `data` must have been allocated by `allocator`.
            /// * `data` must not be freed for the life of the owned pointer.
            pub fn fromRawOwned(data: NonOptionalPointer, allocator: Allocator) Self {
                return .{
                    .unsafe_raw_pointer = data,
                    .unsafe_allocator = allocator,
                };
            }
        } else struct {
            /// Creates an owned pointer from a raw pointer.
            ///
            /// Requirements:
            ///
            /// * `data` must have been allocated by `options.allocator`.
            /// * `data` must not be freed for the life of the owned pointer.
            pub fn fromRawOwned(data: NonOptionalPointer) Self {
                return .{
                    .unsafe_raw_pointer = data,
                    .unsafe_allocator = {},
                };
            }
        }).fromRawOwned;

        /// Deinitializes the pointer or slice, freeing its memory.
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
                .single => bun.allocators.destroy(self.getAllocator(), data),
                .slice => self.getAllocator().free(data),
            }
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

        /// Converts an owned pointer into a raw pointer. If `options.allocator` is non-null,
        /// this method also returns the allocator.
        ///
        /// This method invalidates `self`.
        pub const intoRawOwned = (if (options.allocator != null) struct {
            pub fn intoRawOwned(self: Self) Pointer {
                return self.unsafe_raw_pointer;
            }
        } else if (info.isOptional()) struct {
            pub fn intoRawOwned(self: Self) ?struct { NonOptionalPointer, Allocator } {
                return .{ self.unsafe_raw_pointer orelse return null, self.unsafe_allocator };
            }
        } else struct {
            pub fn intoRawOwned(self: Self) struct { Pointer, Allocator } {
                return .{ self.unsafe_raw_pointer, self.unsafe_allocator };
            }
        }).intoRawOwned;

        /// Returns a null owned pointer. This function is provided only if `Pointer` is an
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

        const OwnedNonOptional = WithOptions(NonOptionalPointer, options);

        /// Converts an `Owned(?T)` into an `?Owned(T)`.
        ///
        /// This method sets `self` to null. It is therefore permitted, but not required, to call
        /// `deinit` on `self`.
        ///
        /// This method is provided only if `Pointer` is an optional type.
        pub const take = if (info.isOptional()) struct {
            pub fn take(self: *Self) ?OwnedNonOptional {
                defer self.* = .initNull();
                return .{
                    .unsafe_raw_pointer = self.unsafe_raw_pointer orelse return null,
                    .unsafe_allocator = self.unsafe_allocator,
                };
            }
        }.take;

        const OwnedOptional = WithOptions(?Pointer, options);

        /// Converts an `Owned(T)` into a non-null `Owned(?T)`.
        ///
        /// This method invalidates `self`.
        pub const toOptional = if (!info.isOptional()) struct {
            pub fn toOptional(self: Self) OwnedOptional {
                return .{
                    .unsafe_raw_pointer = self.unsafe_raw_pointer,
                    .unsafe_allocator = self.unsafe_allocator,
                };
            }
        }.toOptional;

        /// Converts this owned pointer into an unmanaged variant that doesn't store the allocator.
        ///
        /// This method invalidates `self`.
        ///
        /// This method is provided only if `options.allocator` is null, since if it's non-null,
        /// this type is already the size of a raw pointer.
        pub const toUnmanaged = if (options.allocator == null) struct {
            pub fn toUnmanaged(self: Self) Self.Unmanaged {
                return .{
                    .unsafe_raw_pointer = self.unsafe_raw_pointer,
                };
            }
        }.toUnmanaged;

        const DynamicOwned = WithOptions(Pointer, options.asDynamic());

        /// Converts an owned pointer that uses a fixed allocator into a dynamic one.
        ///
        /// This method invalidates `self`.
        ///
        /// This method is provided only if `options.allocator` is non-null, and returns
        /// a new owned pointer that has `options.allocator` set to null.
        pub const toDynamic = if (options.allocator) |allocator| struct {
            pub fn toDynamic(self: Self) DynamicOwned {
                return .{
                    .unsafe_raw_pointer = self.unsafe_raw_pointer,
                    .unsafe_allocator = allocator,
                };
            }
        }.toDynamic;

        fn rawInit(data: NonOptionalPointer, allocator: Allocator) Self {
            return .{
                .unsafe_raw_pointer = data,
                .unsafe_allocator = if (comptime options.allocator == null) allocator,
            };
        }

        fn allocSingle(allocator: Allocator, value: Child) !Self {
            const data = try bun.allocators.create(Child, allocator, value);
            return .rawInit(data, allocator);
        }

        fn allocSlice(allocator: Allocator, count: usize, elem: Child) !Self {
            const data = try allocator.alloc(Child, count);
            @memset(data, elem);
            return .rawInit(data, allocator);
        }

        fn allocDupeImpl(data: NonOptionalPointer, allocator: Allocator) !Self {
            return switch (comptime info.kind()) {
                .single => .allocSingle(allocator, data.*),
                .slice => .rawInit(try allocator.dupe(Child, data), allocator),
            };
        }

        fn getAllocator(self: Self) Allocator {
            return (comptime options.allocator) orelse self.unsafe_allocator;
        }
    };
}

/// An unmanaged version of `Dynamic(Pointer)` that doesn't store the allocator.
fn Unmanaged(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer, .{});
    bun.assertf(
        options.allocator == null,
        "owned.Unmanaged is useless if options.allocator is provided",
        .{},
    );

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,

        const Managed = WithOptions(Pointer, options);

        /// Converts this unmanaged owned pointer back into a managed version.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        pub fn toManaged(self: Self, allocator: Allocator) Managed {
            const data = if (comptime info.isOptional())
                self.unsafe_raw_pointer orelse return .initNull()
            else
                self.unsafe_raw_pointer;
            return .fromRawOwned(data, allocator);
        }

        /// Deinitializes the pointer or slice. See `Owned.deinit` for more information.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        pub fn deinit(self: Self, allocator: Allocator) void {
            self.toManaged(allocator).deinit();
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
    };
}

pub const maybe = @import("./owned/maybe.zig");
pub const scoped = @import("./owned/scoped.zig");

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;

const meta = @import("./meta.zig");
const AddConst = meta.AddConst;
const PointerInfo = meta.PointerInfo;
