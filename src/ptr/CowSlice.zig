/// "Copy on write" slice. There are many instances when it is desired to re-use
/// a slice, but doing so would make it unknown if that slice should be freed.
/// This structure, in release builds, is the same size as `[]const T`, but
/// stores one bit for if deinitialziation should free the underlying memory.
///
///     const str = CowSlice(u8).initOwned(try alloc.dupe(u8, "hello!"), alloc);
///     const borrow = str.borrow();
///     assert(borrow.slice().ptr == str.slice().ptr)
///     borrow.deinit(alloc); // knows it is borrowed, no free
///     str.deinit(alloc); // calls free
///
/// In a debug build, there are aggressive assertions to ensure unintentional
/// frees do not happen. But in a release build, the developer is expected to
/// keep slice owners alive beyond the lifetimes of the borrowed instances.
///
/// CowSlice does not support slices longer than `2^(@bitSizeOf(usize)-1)`.
pub fn CowSlice(T: type) type {
    return CowSliceZ(T, null);
}

/// "Copy on write" slice. There are many instances when it is desired to re-use
/// a slice, but doing so would make it unknown if that slice should be freed.
/// This structure, in release builds, is the same size as `[]const T`, but
/// stores one bit for if deinitialziation should free the underlying memory.
///
///     const str = CowSlice(u8).initOwned(try alloc.dupe(u8, "hello!"), alloc);
///     const borrow = str.borrow();
///     assert(borrow.slice().ptr == str.slice().ptr)
///     borrow.deinit(alloc); // knows it is borrowed, no free
///     str.deinit(alloc); // calls free
///
/// In a debug build, there are aggressive assertions to ensure unintentional
/// frees do not happen. But in a release build, the developer is expected to
/// keep slice owners alive beyond the lifetimes of the borrowed instances.
///
/// CowSlice does not support slices longer than `2^(@bitSizeOf(usize)-1)`.
pub fn CowSliceZ(T: type, comptime sentinel: ?T) type {
    return struct {
        /// Pointer to the underlying data. Do not access this directly.
        ///
        /// NOTE: `ptr` is const if data is borrowed.
        ptr: [*]T,
        flags: packed struct(usize) {
            len: @Type(.{ .int = .{
                .bits = @bitSizeOf(usize) - 1,
                .signedness = .unsigned,
            } }),
            is_owned: bool,
        },
        debug: if (cow_str_assertions) ?*DebugData else void,

        const Self = @This();
        pub const Slice = if (sentinel) |z| [:z]const T else []const T;
        pub const SliceMut = if (sentinel) |z| [:z]T else []T;

        pub const empty: Self = initStatic("");

        /// Create a new Cow that owns its allocation.
        ///
        /// `data` is transferred into the returned string, and must be freed with
        /// `.deinit()` when the string and its borrows are done being used.
        pub fn initOwned(data: []T, allocator: Allocator) Self {
            if (allocation_scope.isInstance(allocator)) {
                const scope = AllocationScope.Borrowed.downcast(allocator);
                scope.assertOwned(data);
            }

            return .{
                .ptr = data.ptr,
                .flags = .{ .is_owned = true, .len = @intCast(data.len) },
                .debug = if (comptime cow_str_assertions)
                    bun.new(DebugData, .{
                        .allocator = allocator,
                    }),
            };
        }

        /// Create a new Cow that copies `data` into a new allocation.
        pub fn initDupe(data: Slice, allocator: Allocator) !Self {
            const bytes: Slice = if (comptime sentinel) |_|
                try allocator.dupeZ(T, data)
            else
                try allocator.dupe(T, data);

            return initOwned(bytes, allocator);
        }

        /// Create a Cow that wraps a static string.
        ///
        /// Calling `.deinit()` is safe to call, but will will have no effect.
        pub fn initStatic(comptime data: Slice) Self {
            return .{
                // SAFETY: const semantics are enforced by is_owned flag
                .ptr = @constCast(data.ptr),
                .flags = .{
                    .is_owned = false,
                    .len = @intCast(data.len),
                },
                .debug = if (cow_str_assertions) null,
            };
        }

        /// Returns `true` if this string owns its data.
        pub inline fn isOwned(str: Self) bool {
            return str.flags.is_owned;
        }

        /// Borrow this Cow's slice.
        pub fn slice(str: Self) Slice {
            return str.ptr[0..str.flags.len];
        }

        pub inline fn length(str: Self) usize {
            return str.flags.len;
        }

        /// Mutably borrow this `Cow`'s slice.
        ///
        /// Borrowed `Cow`s will be automatically converted to owned, incurring
        /// an allocation.
        pub fn sliceMut(str: *Self, allocator: Allocator) Allocator.Error!SliceMut {
            if (!str.isOwned()) {
                str.intoOwned(allocator);
            }
            return str.ptr[0..str.flags.len];
        }

        /// Mutably borrow this `Cow`'s slice, assuming it already owns its data.
        /// Calling this on a borrowed `Cow` invokes safety-checked Illegal Behavior.
        pub fn sliceMutUnsafe(str: *Self) SliceMut {
            bun.assert(str.isOwned(), "CowSlice.sliceMutUnsafe cannot be called on Cows that borrow their data.", .{});
            return str.ptr[0..str.flags.len];
        }

        /// Take ownership over this string's allocation. `str` is left in a
        /// valid, empty state.
        ///
        /// Caller owns the returned memory and must deinitialize it when done.
        /// `str` may be re-used. An allocation will be incurred if and only if
        /// `str` is not owned.
        pub fn takeSlice(str: *Self, allocator: Allocator) Allocator.Error!SliceMut {
            if (!str.isOwned()) {
                try str.intoOwned(allocator);
            }
            defer str.* = Self.empty;
            defer if (cow_str_assertions and str.isOwned()) if (str.debug) |d| bun.destroy(d);
            return str.ptr[0..str.flags.len];
        }

        /// Returns a new string that borrows this string's data.
        ///
        /// The borrowed string should be deinitialized so that debug assertions
        /// that perform `borrows` checks are performed.
        pub fn borrow(str: Self) Self {
            if (comptime cow_str_assertions) if (str.debug) |debug| {
                debug.mutex.lock();
                defer debug.mutex.unlock();
                debug.borrows += 1;
            };
            return .{
                .ptr = str.ptr,
                .flags = .{ .is_owned = false, .len = str.flags.len },
                .debug = str.debug,
            };
        }

        /// Returns a new string that borrows a subslice of this string.
        ///
        /// This is the Cow-equivalent of
        /// ```zig
        /// var str2 = str[start..end];
        /// ```
        ///
        /// When `end` `null`, the subslice will end at the end of the string.
        /// `end` must be less than or equal to `str.len`, and greater than or
        /// equal to `start`.  The borrowed string should be deinitialized so
        /// that debug assertions get performed.
        pub fn borrowSubslice(str: Self, start: usize, end: ?usize) Self {
            const end_ = end orelse str.flags.len;
            const subrange: Slice = if (comptime sentinel) |s|
                str.ptr[start..end_ :s]
            else
                str.ptr[start..end_];

            var result = str.borrow();
            // SAFETY: const semantics are enforced by is_owned flag
            result.ptr = @constCast(subrange.ptr);
            result.flags.len = @intCast(end_ - start);
            return result;
        }

        /// Make this Cow `owned` by duplicating its borrowed data. Does nothing
        /// if the Cow is already owned.
        pub fn toOwned(self: *Self, allocator: Allocator) Allocator.Error!void {
            if (!self.isOwned()) {
                self.intoOwned(allocator);
            }
        }

        /// Make this Cow `owned` by duplicating its borrowed data. Panics if
        /// the Cow is already owned.
        fn intoOwned(str: *Self, allocator: Allocator) callconv(bun.callconv_inline) Allocator.Error!void {
            bun.assert(!str.isOwned());

            const bytes = try if (comptime sentinel) |_| allocator.dupeZ(T, str.slice()) else allocator.dupe(T, str.slice());
            str.ptr = bytes.ptr;
            str.flags.is_owned = true;

            if (comptime cow_str_assertions) {
                if (str.debug) |debug| {
                    debug.mutex.lock();
                    defer debug.mutex.unlock();
                    bun.assert(debug.borrows > 0);
                    debug.borrows -= 1;
                    str.debug = null;
                }
                str.debug = bun.new(DebugData, .{ .allocator = allocator });
            }
        }

        pub fn format(str: Self, writer: *std.Io.Writer) !void {
            return try writer.writeAll(str.slice());
        }

        /// Free this `Cow`'s allocation if it is owned.
        ///
        /// In debug builds, deinitializing borrowed strings performs debug
        /// checks. In release builds it is a no-op.
        pub fn deinit(str: *const Self, allocator: Allocator) void {
            if (comptime cow_str_assertions) if (str.debug) |debug| {
                debug.mutex.lock();
                bun.assertf(
                    // We cannot compare `ptr` here, because allocator implementations with no
                    // associated data set the context pointer to `undefined`, therefore comparing
                    // `ptr` may be undefined behavior. See https://github.com/ziglang/zig/pull/22691
                    // and https://github.com/ziglang/zig/issues/23068.
                    debug.allocator.vtable == allocator.vtable,
                    "CowSlice.deinit called with a different allocator than the one used to create it",
                    .{},
                );
                if (str.isOwned()) {
                    // active borrows become invalid data
                    bun.assertf(
                        debug.borrows == 0,
                        "Cannot deinit() a CowSlice with active borrows. Current borrow count: {d}",
                        .{debug.borrows},
                    );
                    bun.destroy(debug);
                } else {
                    debug.borrows -= 1; // double deinit of a borrowed string
                    debug.mutex.unlock();
                }
            };
            if (str.flags.is_owned) {
                allocator.free(str.slice());
            }
        }

        /// Does not include debug safety checks.
        pub fn initUnchecked(data: Slice, is_owned: bool) Self {
            return .{
                .ptr = @constCast(data.ptr),
                .flags = .{
                    .is_owned = is_owned,
                    .len = @intCast(data.len),
                },
                .debug = if (cow_str_assertions) null,
            };
        }
    };
}

const DebugData = if (cow_str_assertions) struct {
    mutex: bun.Mutex = .{},
    allocator: Allocator,
    /// number of active borrows
    borrows: usize = 0,
};

comptime {
    const cow_size = @sizeOf(CowSlice(u8)) - if (cow_str_assertions) @sizeOf(?*DebugData) else 0;
    bun.assertf(
        cow_size == @sizeOf([]const u8),
        "CowSlice should be the same size as a native slice, but it was {d} bytes instead of {d}",
        .{ cow_size, @sizeOf([]const u8) },
    );
}

test CowSlice {
    const expect = std.testing.expect;
    const expectEqualStrings = std.testing.expectEqualStrings;
    const allocator = std.testing.allocator;

    var str = CowSlice(u8).initStatic("hello");
    try expect(!str.isOwned());
    try expectEqualStrings(str.slice(), "hello");

    var borrow = str.borrow();
    try expect(!borrow.isOwned());
    try expectEqualStrings(borrow.slice(), "hello");

    str.toOwned(allocator);
    try expect(str.isOwned());
    try expectEqualStrings(str.slice(), "hello");

    str.deinit(allocator);

    // borrow is uneffected by str being deinitialized
    try expectEqualStrings(borrow.slice(), "hello");
}

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;

const Environment = bun.Environment;
const cow_str_assertions = Environment.isDebug;

const allocation_scope = bun.allocators.allocation_scope;
const AllocationScope = allocation_scope.AllocationScope;
