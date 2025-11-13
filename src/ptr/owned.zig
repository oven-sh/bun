const owned = @This();

/// An owned pointer or slice that was allocated using the default allocator.
///
/// This type is a wrapper around a pointer or slice of type `Pointer` that was allocated using
/// `bun.default_allocator`. Calling `deinit` on this type first calls `deinit` on the underlying
/// data, and then frees the memory.
///
/// `Pointer` can be a single-item pointer, a slice, or an optional version of either of those;
/// e.g., `Owned(*u8)`, `Owned([]u8)`, `Owned(?*u8)`, or `Owned(?[]u8)`.
///
/// This type is an alias of `OwnedIn(Pointer, bun.DefaultAllocator)`, and thus has no overhead
/// because `bun.DefaultAllocator` is a zero-sized type.
pub fn Owned(comptime Pointer: type) type {
    return OwnedIn(Pointer, bun.DefaultAllocator);
}

/// An owned pointer or slice allocated using any `std.mem.Allocator`.
///
/// This type is an alias of `OwnedIn(Pointer, std.mem.Allocator)`, and thus stores the
/// `std.mem.Allocator` at runtime.
pub fn Dynamic(comptime Pointer: type) type {
    return OwnedIn(Pointer, std.mem.Allocator);
}

/// An owned pointer or slice, allocated using an instance of `Allocator`.
///
/// `Allocator` must be one of the following:
///
/// * `std.mem.Allocator`
/// * A type with a method named `allocator` that takes no parameters (except `self`) and returns
///   an instance of `std.mem.Allocator`.
///
/// If `Allocator` is a zero-sized type, the owned pointer has no overhead compared to a raw
/// pointer.
pub fn OwnedIn(comptime Pointer: type, comptime Allocator: type) type {
    return struct {
        const Self = @This();
        const info = PointerInfo.parse(Pointer, .{});
        const NonOptionalPointer = info.NonOptionalPointer;
        const Child = info.Child;
        const ConstPointer = AddConst(Pointer);

        #pointer: Pointer,
        #allocator: Allocator,

        /// An unmanaged version of this owned pointer. This type doesn't store the allocator and
        /// is the same size as a raw pointer.
        ///
        /// If `Allocator` is a zero-sized type, there is no advantage to using this type. Just
        /// use a normal owned pointer, which has no overhead in this case.
        pub const Unmanaged = owned.Unmanaged(Pointer, Allocator);

        /// Allocates a new owned pointer with a default-initialized `Allocator`.
        pub const alloc = switch (info.kind()) {
            .single => struct {
                pub fn alloc(value: Child) AllocError!Self {
                    return .allocIn(value, bun.memory.initDefault(Allocator));
                }
            },
            .slice => struct {
                /// Note: this creates *shallow* copies of `elem`.
                pub fn alloc(count: usize, elem: Child) AllocError!Self {
                    return .allocIn(count, elem, bun.memory.initDefault(Allocator));
                }
            },
        }.alloc;

        /// Allocates a new owned pointer with the given allocator.
        pub const allocIn = switch (info.kind()) {
            .single => struct {
                pub fn allocIn(value: Child, allocator_: Allocator) AllocError!Self {
                    const data = try bun.memory.create(
                        Child,
                        bun.allocators.asStd(allocator_),
                        value,
                    );
                    return .{
                        .#pointer = data,
                        .#allocator = allocator_,
                    };
                }
            },
            .slice => struct {
                /// Note: this creates *shallow* copies of `elem`.
                pub fn allocIn(count: usize, elem: Child, allocator_: Allocator) AllocError!Self {
                    const data = try bun.allocators.asStd(allocator_).alloc(Child, count);
                    @memset(data, elem);
                    return .{
                        .#pointer = data,
                        .#allocator = allocator_,
                    };
                }
            },
        }.allocIn;

        /// Allocates an owned pointer for a single item, and calls `bun.outOfMemory` if allocation
        /// fails.
        ///
        /// It must be possible to default-initialize `Allocator`.
        pub const new = if (info.kind() == .single) struct {
            pub fn new(value: Child) Self {
                return bun.handleOom(Self.alloc(value));
            }
        }.new;

        /// Creates an owned pointer by allocating memory and performing a shallow copy of `data`.
        ///
        /// It must be possible to default-initialize `Allocator`.
        pub fn allocDupe(data: ConstPointer) AllocError!Self {
            return .allocDupeIn(data, bun.memory.initDefault(Allocator));
        }

        /// Creates an owned pointer by allocating memory with the given allocator and performing
        /// a shallow copy of `data`.
        pub fn allocDupeIn(data: ConstPointer, allocator_: Allocator) AllocError!Self {
            const unwrapped = if (comptime info.isOptional())
                data orelse return .initNull()
            else
                data;
            return switch (comptime info.kind()) {
                .single => .allocIn(unwrapped.*, allocator_),
                .slice => .{
                    .#pointer = try bun.allocators.asStd(allocator_).dupe(Child, unwrapped),
                    .#allocator = allocator_,
                },
            };
        }

        /// Creates an owned pointer from a raw pointer.
        ///
        /// Requirements:
        ///
        /// * It must be permissible to free `data` with a new instance of `Allocator` created
        ///   with `bun.memory.initDefault(Allocator)`.
        /// * `data` must not be freed for the life of the owned pointer.
        ///
        /// NOTE: If `Allocator` is the default allocator, and `Pointer` is a single-item pointer,
        /// `data` must have been allocated with `bun.new`, `bun.tryNew`, or `bun.memory.create`,
        /// NOT `bun.default_allocator.create`. If `data` came from an owned pointer, this
        /// requirement is satisfied.
        ///
        /// `Allocator` is the default allocator if `Allocator.allocator` returns
        /// `bun.default_allocator` when called on a default-initialized `Allocator` (created with
        /// `bun.memory.initDefault`). Most notably, this is true for `bun.DefaultAllocator`.
        pub fn fromRaw(data: Pointer) Self {
            return .fromRawIn(data, bun.memory.initDefault(Allocator));
        }

        /// Creates an owned pointer from a raw pointer and allocator.
        ///
        /// Requirements:
        ///
        /// * It must be permissible to free `data` with `allocator`.
        /// * `data` must not be freed for the life of the owned pointer.
        ///
        /// NOTE: If `allocator` is the default allocator, and `Pointer` is a single-item pointer,
        /// `data` must have been allocated with `bun.new`, `bun.tryNew`, or `bun.memory.create`,
        /// NOT `bun.default_allocator.create`. If `data` came from `intoRaw` on another owned
        /// pointer, this requirement is satisfied.
        ///
        /// `allocator` is the default allocator if either of the following is true:
        /// * `allocator` is `bun.default_allocator`
        /// * `allocator.allocator()` returns `bun.default_allocator`
        pub fn fromRawIn(data: Pointer, allocator_: Allocator) Self {
            return .{
                .#pointer = data,
                // Code shouldn't rely on null pointers having a specific allocator, since
                // `initNull` necessarily sets this field to undefined.
                .#allocator = if ((comptime info.isOptional()) and data == null)
                    undefined
                else
                    allocator_,
            };
        }

        /// Calls `deinit` on the underlying data (pointer target or slice elements) and then
        /// frees the memory.
        ///
        /// `deinit` is also called on the allocator.
        ///
        /// This method invalidates `self`.
        pub fn deinit(self: *Self) void {
            self.deinitImpl(.deep);
        }

        /// Frees the memory without calling `deinit` on the underlying data. `deinit` is still
        /// called on the allocator.
        ///
        /// This method invalidates `self`.
        pub fn deinitShallow(self: *Self) void {
            self.deinitImpl(.shallow);
        }

        /// Returns the inner pointer or slice.
        pub fn get(self: Self) Pointer {
            return self.#pointer;
        }

        /// Converts an owned pointer into a raw pointer. This releases ownership of the pointer.
        ///
        /// This method calls `deinit` on the allocator. If you need to retain access to the
        /// allocator, use `intoRawWithAllocator`.
        ///
        /// NOTE: If the current allocator is the default allocator, and `Pointer` is a single-item
        /// pointer, the pointer must be freed with `bun.destroy` or `bun.memory.destroy`, NOT
        /// `bun.default_allocator.destroy`. Or it can be turned back into an owned pointer.
        ///
        /// This method invalidates `self`.
        pub fn intoRaw(self: *Self) Pointer {
            defer self.* = undefined;
            if ((comptime !info.isOptional()) or self.#pointer != null) {
                bun.memory.deinit(&self.#allocator);
            }
            return self.#pointer;
        }

        const PointerAndAllocator = if (info.isOptional())
            ?struct { NonOptionalPointer, Allocator }
        else
            struct { Pointer, Allocator };

        /// Converts an owned pointer into a raw pointer and allocator, releasing ownership of the
        /// pointer.
        ///
        /// NOTE: If the current allocator is the default allocator, and `Pointer` is a single-item
        /// pointer, the pointer must be freed with `bun.destroy` or `bun.memory.destroy`, NOT
        /// `bun.default_allocator.destroy`. Or it can be turned back into an owned pointer.
        ///
        /// This method invalidates `self`.
        pub fn intoRawWithAllocator(self: *Self) PointerAndAllocator {
            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.#pointer orelse return null
            else
                self.#pointer;
            return .{ data, self.#allocator };
        }

        /// Returns a null owned pointer. This function is provided only if `Pointer` is an
        /// optional type.
        ///
        /// It is permitted, but not required, to call `deinit` on the returned value.
        pub const initNull = if (info.isOptional()) struct {
            pub fn initNull() Self {
                return .{
                    .#pointer = null,
                    .#allocator = undefined,
                };
            }
        }.initNull;

        /// Converts an `Owned(?T)` into an `?Owned(T)`.
        ///
        /// This method sets `self` to null. It is therefore permitted, but not required, to call
        /// `deinit` on `self`.
        ///
        /// This method is provided only if `Pointer` is an optional type.
        pub const take = if (info.isOptional()) struct {
            const OwnedNonOptional = OwnedIn(NonOptionalPointer, Allocator);

            pub fn take(self: *Self) ?OwnedNonOptional {
                defer self.* = .initNull();
                return .{
                    .#pointer = self.#pointer orelse return null,
                    .#allocator = self.#allocator,
                };
            }
        }.take;

        /// Like `deinit`, but sets `self` to null instead of invalidating it.
        ///
        /// This method is provided only if `Pointer` is an optional type.
        pub const reset = if (info.isOptional()) struct {
            pub fn reset(self: *Self) void {
                defer self.* = .initNull();
                self.deinit();
            }
        }.reset;

        /// Converts an `Owned(T)` into a non-null `Owned(?T)`.
        ///
        /// This method invalidates `self`.
        pub const toOptional = if (!info.isOptional()) struct {
            const OwnedOptional = OwnedIn(?Pointer, Allocator);

            pub fn toOptional(self: *Self) OwnedOptional {
                defer self.* = undefined;
                return .{
                    .#pointer = self.#pointer,
                    .#allocator = self.#allocator,
                };
            }
        }.toOptional;

        /// Converts this owned pointer into an unmanaged variant that doesn't store the allocator.
        ///
        /// There is no reason to use this method if `Allocator` is a zero-sized type, as a normal
        /// owned pointer has no overhead in this case.
        ///
        /// This method invalidates `self`.
        pub fn toUnmanaged(self: *Self) Self.Unmanaged {
            defer self.* = undefined;
            return .{
                .#pointer = self.#pointer,
            };
        }

        /// Converts an owned pointer that uses a fixed type of allocator into a dynamic one
        /// that uses any `std.mem.Allocator`.
        ///
        /// It must be possible to use the `std.mem.Allocator` returned by `Allocator.allocator`
        /// even after deinitializing the `Allocator`. As a safety check, this method will not
        /// compile if `Allocator.Borrowed` exists and is a different type from `Allocator`, as
        /// this likely indicates a scenario where this invariant will not hold.
        ///
        /// There is no reason to use this method if `Allocator` is already `std.mem.Allocator`.
        ///
        /// This method invalidates `self`.
        pub fn toDynamic(self: *Self) owned.Dynamic(Pointer) {
            if (comptime @hasDecl(Allocator, "Borrowed") and Allocator.Borrowed != Allocator) {
                // If this allocator can be borrowed as a different type, it's likely that the
                // `std.mem.Allocator` returned by `Allocator.allocator` won't be valid after the
                // `Allocator` is dropped.
                @compileError("allocator won't live long enough");
            }

            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.#pointer orelse return .initNull()
            else
                self.#pointer;
            defer bun.memory.deinit(&self.#allocator);
            return .fromRawIn(data, self.getStdAllocator());
        }

        const MaybeAllocator = if (info.isOptional())
            ?bun.allocators.Borrowed(Allocator)
        else
            bun.allocators.Borrowed(Allocator);

        /// Returns a borrowed version of the allocator.
        ///
        /// Not all allocators have a separate borrowed type; in this case, the allocator is
        /// returned as-is. For example, if `Allocator` is `std.mem.Allocator`, this method also
        /// returns `std.mem.Allocator`.
        pub fn allocator(self: Self) MaybeAllocator {
            return if ((comptime info.isOptional()) and self.#pointer == null)
                null
            else
                bun.allocators.borrow(self.#allocator);
        }

        fn getStdAllocator(self: Self) std.mem.Allocator {
            return bun.allocators.asStd(self.#allocator);
        }

        fn deinitImpl(self: *Self, comptime mode: enum { deep, shallow }) void {
            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.#pointer orelse return
            else
                self.#pointer;
            if (comptime mode == .deep) {
                bun.memory.deinit(data);
            }
            switch (comptime info.kind()) {
                .single => bun.memory.destroy(self.getStdAllocator(), data),
                .slice => self.getStdAllocator().free(data),
            }
            bun.memory.deinit(&self.#allocator);
        }
    };
}

/// An unmanaged version of `OwnedIn(Pointer, Allocator)` that doesn't store the allocator.
///
/// If `Allocator` is a zero-sized type, there is no benefit to using this type. Just use a
/// normal owned pointer, which has no overhead in this case.
///
/// This type is accessible as `OwnedIn(Pointer, Allocator).Unmanaged`.
fn Unmanaged(comptime Pointer: type, comptime Allocator: type) type {
    return struct {
        const Self = @This();
        const info = PointerInfo.parse(Pointer, .{});

        #pointer: Pointer,

        const Managed = OwnedIn(Pointer, Allocator);

        /// Converts this unmanaged owned pointer back into a managed version.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        ///
        /// This method invalidates `self`.
        pub fn toManaged(self: *Self, allocator: Allocator) Managed {
            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.#pointer orelse return .initNull()
            else
                self.#pointer;
            return .fromRawIn(data, allocator);
        }

        /// Deinitializes the pointer or slice. See `Owned.deinit` for more information.
        ///
        /// `allocator` must be the allocator that was used to allocate the pointer.
        ///
        /// This method invalidates `self`.
        pub fn deinit(self: *Self, allocator: Allocator) void {
            var managed = self.toManaged(allocator);
            managed.deinit();
        }

        /// Returns the inner pointer or slice.
        pub fn get(self: Self) Pointer {
            return self.#pointer;
        }
    };
}

const bun = @import("bun");
const std = @import("std");
const AllocError = std.mem.Allocator.Error;

const meta = @import("./meta.zig");
const AddConst = meta.AddConst;
const PointerInfo = meta.PointerInfo;
