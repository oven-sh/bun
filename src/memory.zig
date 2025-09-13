//! Basic utilities for working with memory and objects.

/// Allocates memory for a value of type `T` using the provided allocator, and initializes the
/// memory with `value`.
///
/// If `allocator` is `bun.default_allocator`, this will internally use `bun.tryNew` to benefit from
/// the added assertions.
pub fn create(comptime T: type, allocator: std.mem.Allocator, value: T) bun.OOM!*T {
    if ((comptime Environment.allow_assert) and isDefault(allocator)) {
        return bun.tryNew(T, value);
    }
    const ptr = try allocator.create(T);
    ptr.* = value;
    return ptr;
}

/// Frees memory previously allocated by `create`.
///
/// The memory must have been allocated by the `create` function in this namespace, not
/// directly by `allocator.create`.
pub fn destroy(allocator: std.mem.Allocator, ptr: anytype) void {
    if ((comptime Environment.allow_assert) and isDefault(allocator)) {
        bun.destroy(ptr);
    } else {
        allocator.destroy(ptr);
    }
}

/// Default-initializes a value of type `T`.
///
/// This method tries the following, in order:
///
/// * `.initDefault()`, if a method with that name exists
/// * `.init()`, if a method with that name exists
/// * `.{}`, otherwise
pub fn initDefault(comptime T: type) T {
    return if (comptime std.meta.hasFn(T, "initDefault"))
        .initDefault()
    else if (comptime std.meta.hasFn(T, "init"))
        .init()
    else
        .{};
}

/// Calls `deinit` on `ptr_or_slice`, or on every element of `ptr_or_slice`, if such a `deinit`
/// method exists.
///
/// This function first does the following:
///
/// * If `ptr_or_slice` is a single-item pointer, calls `ptr_or_slice.deinit()`, if that method
///   exists.
/// * If `ptr_or_slice` is a slice, calls `deinit` on every element of the slice, if the slice
///   elements have a `deinit` method.
///
/// Then, if `ptr_or_slice` is non-const, this function also sets all memory referenced by the
/// pointer to `undefined`.
///
/// This method does not free `ptr_or_slice` itself.
pub fn deinit(ptr_or_slice: anytype) void {
    const ptr_info = @typeInfo(@TypeOf(ptr_or_slice));
    const Child = ptr_info.pointer.child;
    const mutable = !ptr_info.pointer.is_const;
    if (comptime std.meta.hasFn(Child, "deinit")) {
        switch (comptime ptr_info.pointer.size) {
            .one => {
                ptr_or_slice.deinit();
                if (comptime mutable) ptr_or_slice.* = undefined;
            },
            .slice => for (ptr_or_slice) |*elem| {
                elem.deinit();
                if (comptime mutable) elem.* = undefined;
            },
            else => @compileError("unsupported pointer type"),
        }
    }
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const isDefault = bun.allocators.isDefault;
