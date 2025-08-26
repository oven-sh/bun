/// Options for `WithOptions`.
pub const Options = struct {
    // Whether to call `deinit` on the data before freeing it, if such a method exists.
    deinit: bool = true,

    fn toOwned(self: Options) owned.Options {
        return .{
            .deinit = self.deinit,
            .allocator = null,
        };
    }
};

/// A possibly owned pointer or slice.
///
/// Memory held by this type is either owned or borrowed. If owned, this type also holds the
/// allocator used to allocate the memory, and calling `deinit` on this type will call `deinit` on
/// the underlying data and then free the memory. If the memory is borrowed, `deinit` is a no-op.
///
/// `Pointer` can be a single-item pointer, a slice, or an optional version of either of those;
/// e.g., `MaybeOwned(*u8)`, `MaybeOwned([]u8)`, `MaybeOwned(?*u8)`, or `MaybeOwned(?[]u8)`.
///
/// Use `fromOwned` or `fromBorrowed` to create a `MaybeOwned(Pointer)`. Use `get` to access the
/// inner pointer, and call `deinit` when done with the data. (It's best practice to always call
/// `deinit`, even if the data is borrowed. It's a no-op in that case but doing so will help prevent
/// leaks.) If `Pointer` is optional, use `initNull` to create a null `MaybeOwned(Pointer)`.
pub fn MaybeOwned(comptime Pointer: type) type {
    return WithOptions(Pointer, .{});
}

/// Like `MaybeOwned`, but takes explicit options.
///
/// `MaybeOwned(Pointer)` is simply an alias of `WithOptions(Pointer, .{})`.
pub fn WithOptions(comptime Pointer: type, comptime options: Options) type {
    const info = PointerInfo.parse(Pointer, .{});
    const NonOptionalPointer = info.NonOptionalPointer;

    return struct {
        const Self = @This();

        unsafe_raw_pointer: Pointer,
        unsafe_allocator: NullableAllocator,

        const Owned = owned.WithOptions(Pointer, options.toOwned());

        /// Creates a `MaybeOwned(Pointer)` from an `Owned(Pointer)`.
        ///
        /// This method invalidates `owned_ptr`.
        pub fn fromOwned(owned_ptr: Owned) Self {
            const data, const allocator = if (comptime info.isOptional())
                owned_ptr.intoRawOwned() orelse return .initNull()
            else
                owned_ptr.intoRawOwned();
            return .{
                .unsafe_raw_pointer = data,
                .unsafe_allocator = .init(allocator),
            };
        }

        /// Creates a `MaybeOwned(Pointer)` from a raw owned pointer or slice.
        ///
        /// Requirements:
        ///
        /// * `data` must have been allocated by `allocator`.
        /// * `data` must not be freed for the life of the `MaybeOwned`.
        pub fn fromRawOwned(data: NonOptionalPointer, allocator: Allocator) Self {
            return .fromOwned(.fromRawOwned(data, allocator));
        }

        /// Creates a `MaybeOwned(Pointer)` from borrowed slice or pointer.
        ///
        /// `data` must not be freed for the life of the `MaybeOwned`.
        pub fn fromBorrowed(data: NonOptionalPointer) Self {
            return .{
                .unsafe_raw_pointer = data,
                .unsafe_allocator = .init(null),
            };
        }

        /// Deinitializes the pointer or slice, freeing its memory if owned.
        ///
        /// By default, if the data is owned, `deinit` will first be called on the data itself.
        /// See `Owned.deinit` for more information.
        pub fn deinit(self: Self) void {
            const data, const maybe_allocator = if (comptime info.isOptional())
                self.intoRaw() orelse return
            else
                self.intoRaw();
            if (maybe_allocator) |allocator| {
                Owned.fromRawOwned(data, allocator).deinit();
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

        /// Converts a `MaybeOwned(Pointer)` into its constituent parts, a raw pointer and an
        /// optional allocator.
        ///
        /// Do not use `self` or call `deinit` after calling this method.
        pub const intoRaw = switch (info.isOptional()) {
            // Regular, non-optional pointer (e.g., `*u8`, `[]u8`).
            false => struct {
                pub fn intoRaw(self: Self) struct { Pointer, ?Allocator } {
                    return .{ self.unsafe_raw_pointer, self.unsafe_allocator.get() };
                }
            },
            // Optional pointer (e.g., `?*u8`, `?[]u8`).
            true => struct {
                pub fn intoRaw(self: Self) ?struct { NonOptionalPointer, ?Allocator } {
                    return .{
                        self.unsafe_raw_pointer orelse return null,
                        self.unsafe_allocator.get(),
                    };
                }
            },
        }.intoRaw;

        /// Returns whether or not the memory is owned.
        pub fn isOwned(self: Self) bool {
            return !self.unsafe_allocator.isNull();
        }

        /// Returns a null `MaybeOwned(Pointer)`. This method is provided only if `Pointer` is an
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
    };
}

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
const NullableAllocator = bun.allocators.NullableAllocator;
const owned = bun.ptr.owned;

const meta = @import("../meta.zig");
const AddConst = meta.AddConst;
const PointerInfo = meta.PointerInfo;
