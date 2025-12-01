/// Type which could be borrowed or owned
/// The name is from the Rust std's `Cow` type
/// Can't think of a better name
pub fn Cow(comptime T: type, comptime VTable: type) type {
    const info = @typeInfo(T);
    if (info == .pointer and info.pointer.size == .slice) {
        @compileError("Cow should not be used with slice types. Use CowSlice or CowSliceZ instead.");
    }

    const Handler = struct {
        fn copy(this: *const T, allocator: Allocator) T {
            if (!@hasDecl(VTable, "copy")) @compileError(@typeName(VTable) ++ " needs `copy()` function");
            return VTable.copy(this, allocator);
        }

        fn deinit(this: *T, allocator: Allocator) void {
            if (!@hasDecl(VTable, "deinit")) @compileError(@typeName(VTable) ++ " needs `deinit()` function");
            return VTable.deinit(this, allocator);
        }
    };

    return union(enum) {
        borrowed: *const T,
        owned: T,

        pub fn borrow(val: *const T) @This() {
            return .{
                .borrowed = val,
            };
        }

        pub fn own(val: T) @This() {
            return .{
                .owned = val,
            };
        }

        pub fn replace(this: *@This(), allocator: Allocator, newval: T) void {
            if (this.* == .owned) {
                this.deinit(allocator);
            }
            this.* = .{ .owned = newval };
        }

        /// Get the underlying value.
        pub inline fn inner(this: *const @This()) *const T {
            return switch (this.*) {
                .borrowed => this.borrowed,
                .owned => &this.owned,
            };
        }

        pub inline fn innerMut(this: *@This()) ?*T {
            return switch (this.*) {
                .borrowed => null,
                .owned => &this.owned,
            };
        }

        pub fn toOwned(this: *@This(), allocator: Allocator) *T {
            switch (this.*) {
                .borrowed => {
                    this.* = .{
                        .owned = Handler.copy(this.borrowed, allocator),
                    };
                },
                .owned => {},
            }
            return &this.owned;
        }

        pub fn deinit(this: *@This(), allocator: Allocator) void {
            if (this.* == .owned) {
                Handler.deinit(&this.owned, allocator);
            }
        }
    };
}

const std = @import("std");
const Allocator = std.mem.Allocator;
