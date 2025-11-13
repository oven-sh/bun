//! AllocationScope wraps another allocator, providing leak and invalid free assertions.
//! It also allows measuring how much memory a scope has allocated.

const allocation_scope = @This();

/// An allocation scope with a dynamically typed parent allocator. Prefer using a concrete type,
/// like `AllocationScopeIn(bun.DefaultAllocator)`.
pub const AllocationScope = AllocationScopeIn(std.mem.Allocator);

pub const Allocation = struct {
    allocated_at: StoredTrace,
    len: usize,
    extra: Extra,
};

pub const Free = struct {
    allocated_at: StoredTrace,
    freed_at: StoredTrace,
};

pub const Extra = struct {
    ptr: *anyopaque,
    vtable: ?*const VTable,

    pub const none: Extra = .{ .ptr = undefined, .vtable = null };

    pub const VTable = struct {
        onAllocationLeak: *const fn (*anyopaque, data: []u8) void,
    };
};

pub const Stats = struct {
    total_memory_allocated: usize,
    num_allocations: usize,
};

pub const FreeError = error{
    /// Tried to free memory that wasn't allocated by this `AllocationScope`, or was already freed.
    NotAllocated,
};

pub const enabled = bun.Environment.enableAllocScopes;
pub const max_free_tracking = 2048 - 1;

const History = struct {
    const Self = @This();

    total_memory_allocated: usize = 0,
    /// Allocated by `State.parent`.
    allocations: std.AutoHashMapUnmanaged([*]const u8, Allocation) = .empty,
    /// Allocated by `State.parent`.
    frees: std.AutoArrayHashMapUnmanaged([*]const u8, Free) = .empty,
    /// Once `frees` fills up, entries are overwritten from start to end.
    free_overwrite_index: std.math.IntFittingRange(0, max_free_tracking + 1) = 0,

    /// `allocator` should be `State.parent`.
    fn deinit(self: *Self, allocator: std.mem.Allocator) void {
        self.allocations.deinit(allocator);
        self.frees.deinit(allocator);
        self.* = undefined;
    }
};

const LockedState = struct {
    const Self = @This();

    /// Should be the same as `State.parent`.
    parent: std.mem.Allocator,
    history: *History,

    fn alloc(self: Self, len: usize, alignment: std.mem.Alignment, ret_addr: usize) bun.OOM![*]u8 {
        const result = self.parent.rawAlloc(len, alignment, ret_addr) orelse
            return error.OutOfMemory;
        errdefer self.parent.rawFree(result[0..len], alignment, ret_addr);
        try self.trackAllocation(result[0..len], ret_addr, .none);
        return result;
    }

    fn free(self: Self, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
        const success = if (self.trackFree(buf, ret_addr))
            true
        else |err| switch (err) {
            error.NotAllocated => false,
        };
        if (success or bun.Environment.enable_asan) {
            self.parent.rawFree(buf, alignment, ret_addr);
        }
        if (!success) {
            // If asan did not catch the free, panic now.
            std.debug.panic("Invalid free: {*}", .{buf});
        }
    }

    fn assertOwned(self: Self, ptr: anytype) void {
        const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
            .c, .one, .many => ptr,
            .slice => if (ptr.len > 0) ptr.ptr else return,
        });
        if (!self.history.allocations.contains(cast_ptr)) {
            @panic("this pointer was not owned by the allocation scope");
        }
    }

    fn assertUnowned(self: Self, ptr: anytype) void {
        const cast_ptr: [*]const u8 = @ptrCast(switch (@typeInfo(@TypeOf(ptr)).pointer.size) {
            .c, .one, .many => ptr,
            .slice => if (ptr.len > 0) ptr.ptr else return,
        });
        if (self.history.allocations.getPtr(cast_ptr)) |owned| {
            Output.warn("Owned pointer allocated here:");
            bun.crash_handler.dumpStackTrace(
                owned.allocated_at.trace(),
                trace_limits,
                trace_limits,
            );
            @panic("this pointer was owned by the allocation scope when it was not supposed to be");
        }
    }

    fn trackAllocation(self: Self, buf: []const u8, ret_addr: usize, extra: Extra) bun.OOM!void {
        const trace = StoredTrace.capture(ret_addr);
        try self.history.allocations.putNoClobber(self.parent, buf.ptr, .{
            .allocated_at = trace,
            .len = buf.len,
            .extra = extra,
        });
        self.history.total_memory_allocated += buf.len;
    }

    fn trackFree(self: Self, buf: []const u8, ret_addr: usize) FreeError!void {
        const entry = self.history.allocations.fetchRemove(buf.ptr) orelse {
            Output.errGeneric("Invalid free, pointer {*}, len {d}", .{ buf.ptr, buf.len });

            if (self.history.frees.getPtr(buf.ptr)) |free_entry| {
                Output.printErrorln("Pointer allocated here:", .{});
                bun.crash_handler.dumpStackTrace(free_entry.allocated_at.trace(), trace_limits);
                Output.printErrorln("Pointer first freed here:", .{});
                bun.crash_handler.dumpStackTrace(free_entry.freed_at.trace(), free_trace_limits);
            }

            // do not panic because address sanitizer will catch this case better.
            // the log message is in case there is a situation where address
            // sanitizer does not catch the invalid free.
            return error.NotAllocated;
        };

        self.history.total_memory_allocated -= entry.value.len;

        // Store a limited amount of free entries
        if (self.history.frees.count() >= max_free_tracking) {
            const i = self.history.free_overwrite_index;
            self.history.free_overwrite_index =
                @mod(self.history.free_overwrite_index + 1, max_free_tracking);
            self.history.frees.swapRemoveAt(i);
        }

        self.history.frees.put(self.parent, buf.ptr, .{
            .allocated_at = entry.value.allocated_at,
            .freed_at = StoredTrace.capture(ret_addr),
        }) catch |err| bun.handleOom(err);
    }
};

const State = struct {
    const Self = @This();

    /// This field should not be modified. Therefore, it doesn't need to be protected by the mutex.
    parent: std.mem.Allocator,
    history: bun.threading.Guarded(History),

    fn init(parent_alloc: std.mem.Allocator) Self {
        return .{
            .parent = parent_alloc,
            .history = .init(.{}),
        };
    }

    fn lock(self: *Self) LockedState {
        return .{
            .parent = self.parent,
            .history = self.history.lock(),
        };
    }

    fn unlock(self: *Self) void {
        self.history.unlock();
    }

    pub fn deinit(self: *Self) void {
        defer self.* = undefined;
        var history = self.history.intoUnprotected();
        defer history.deinit(self.parent);

        const count = history.allocations.count();
        if (count == 0) return;
        Output.errGeneric("Allocation scope leaked {d} allocations ({f})", .{
            count,
            bun.fmt.size(history.total_memory_allocated, .{}),
        });

        var it = history.allocations.iterator();
        var n: usize = 0;
        while (it.next()) |entry| : (n += 1) {
            if (n >= 10) {
                Output.prettyErrorln("(only showing first 10 leaks)", .{});
                break;
            }
            Output.prettyErrorln(
                "- {*}, len {d}, at:",
                .{ entry.key_ptr.*, entry.value_ptr.len },
            );
            bun.crash_handler.dumpStackTrace(
                entry.value_ptr.allocated_at.trace(),
                trace_limits,
            );
            const extra = entry.value_ptr.extra;
            if (extra.vtable) |extra_vtable| {
                extra_vtable.onAllocationLeak(
                    extra.ptr,
                    @constCast(entry.key_ptr.*[0..entry.value_ptr.len]),
                );
            }
        }

        Output.panic(
            "Allocation scope leaked {f}",
            .{bun.fmt.size(history.total_memory_allocated, .{})},
        );
    }

    fn trackExternalAllocation(self: *Self, ptr: []const u8, ret_addr: ?usize, extra: Extra) void {
        const locked = self.lock();
        defer self.unlock();
        locked.trackAllocation(ptr, ret_addr orelse @returnAddress(), extra) catch |err|
            bun.handleOom(err);
    }

    fn trackExternalFree(self: *Self, slice: anytype, ret_addr: ?usize) FreeError!void {
        const invalidType = struct {
            fn invalidType() noreturn {
                @compileError(std.fmt.comptimePrint(
                    "This function only supports []u8 or [:sentinel]u8 types, you passed in: {s}",
                    .{@typeName(@TypeOf(slice))},
                ));
            }
        }.invalidType;

        const ptr: []const u8 = switch (@typeInfo(@TypeOf(slice))) {
            .pointer => |p| switch (p.size) {
                .slice => brk: {
                    if (p.child != u8) invalidType();
                    if (p.sentinel_ptr == null) break :brk slice;
                    // Ensure we include the sentinel value
                    break :brk slice[0 .. slice.len + 1];
                },
                else => invalidType(),
            },
            else => invalidType(),
        };
        // Empty slice usually means invalid pointer
        if (ptr.len == 0) return;
        const locked = self.lock();
        defer self.unlock();
        return locked.trackFree(ptr, ret_addr orelse @returnAddress());
    }

    fn setPointerExtra(self: *Self, ptr: *anyopaque, extra: Extra) void {
        const locked = self.lock();
        defer self.unlock();
        const allocation = locked.history.allocations.getPtr(@ptrCast(ptr)) orelse
            @panic("Pointer not owned by allocation scope");
        allocation.extra = extra;
    }
};

/// An allocation scope that uses a specific kind of parent allocator.
///
/// This type is a `GenericAllocator`; see `src/allocators.zig`.
pub fn AllocationScopeIn(comptime Allocator: type) type {
    const BorrowedAllocator = bun.allocators.Borrowed(Allocator);

    // Borrowed version of `AllocationScope`. Access this type as `AllocationScope.Borrowed`.
    const BorrowedScope = struct {
        const Self = @This();

        #parent: BorrowedAllocator,
        #state: if (enabled) *State else void,

        pub fn allocator(self: Self) std.mem.Allocator {
            return if (comptime enabled)
                .{ .ptr = self.#state, .vtable = &vtable }
            else
                bun.allocators.asStd(self.#parent);
        }

        pub fn parent(self: Self) BorrowedAllocator {
            return self.#parent;
        }

        /// Deinitializes a borrowed allocation scope. This does not deinitialize the
        /// `AllocationScope` itself; only the owner of the `AllocationScope` should do that.
        ///
        /// This method doesn't need to be called unless `bun.allocators.Borrowed(Allocator)` has
        /// a `deinit` method.
        pub fn deinit(self: *Self) void {
            bun.memory.deinit(&self.#parent);
            self.* = undefined;
        }

        pub fn stats(self: Self) Stats {
            if (comptime !enabled) @compileError("AllocationScope must be enabled");
            const state = self.#state.lock();
            defer self.#state.unlock();
            return .{
                .total_memory_allocated = state.history.total_memory_allocated,
                .num_allocations = state.history.allocations.count(),
            };
        }

        pub fn assertOwned(self: Self, ptr: anytype) void {
            if (comptime !enabled) return;
            const state = self.#state.lock();
            defer self.#state.unlock();
            state.assertOwned(ptr);
        }

        pub fn assertUnowned(self: Self, ptr: anytype) void {
            if (comptime !enabled) return;
            const state = self.#state.lock();
            defer self.#state.unlock();
            state.assertUnowned(ptr);
        }

        pub fn trackExternalAllocation(
            self: Self,
            ptr: []const u8,
            ret_addr: ?usize,
            extra: Extra,
        ) void {
            if (comptime enabled) self.#state.trackExternalAllocation(ptr, ret_addr, extra);
        }

        pub fn trackExternalFree(self: Self, slice: anytype, ret_addr: ?usize) FreeError!void {
            return if (comptime enabled) self.#state.trackExternalFree(slice, ret_addr);
        }

        pub fn setPointerExtra(self: Self, ptr: *anyopaque, extra: Extra) void {
            if (comptime enabled) self.#state.setPointerExtra(ptr, extra);
        }

        fn downcastImpl(
            std_alloc: std.mem.Allocator,
            parent_alloc: if (Allocator == std.mem.Allocator)
                ?BorrowedAllocator
            else
                BorrowedAllocator,
        ) Self {
            const state = if (comptime enabled) blk: {
                bun.assertf(
                    std_alloc.vtable == &vtable,
                    "allocator is not an allocation scope (has vtable {*})",
                    .{std_alloc.vtable},
                );
                const state: *State = @ptrCast(@alignCast(std_alloc.ptr));
                break :blk state;
            };

            const current_std_parent = if (comptime enabled)
                state.parent
            else
                std_alloc;

            const new_parent = if (comptime Allocator == std.mem.Allocator)
                parent_alloc orelse current_std_parent
            else
                parent_alloc;

            const new_std_parent = bun.allocators.asStd(new_parent);
            bun.safety.alloc.assertEqFmt(
                current_std_parent,
                new_std_parent,
                "tried to downcast allocation scope with wrong parent allocator",
                .{},
            );
            return .{ .#parent = new_parent, .#state = state };
        }

        /// Converts an `std.mem.Allocator` into a borrowed allocation scope, with a given parent
        /// allocator.
        ///
        /// Requirements:
        ///
        /// * `std_alloc` must have come from `AllocationScopeIn(Allocator).allocator` (or the
        ///   equivalent method on a `Borrowed` instance).
        ///
        /// * `parent_alloc` must be equivalent to the (borrowed) parent allocator of the original
        ///   allocation scope (that is, the return value of `AllocationScopeIn(Allocator).parent`).
        ///   In particular, `bun.allocators.asStd` must return the same value for each allocator.
        pub fn downcastIn(std_alloc: std.mem.Allocator, parent_alloc: BorrowedAllocator) Self {
            return downcastImpl(std_alloc, parent_alloc);
        }

        /// Converts an `std.mem.Allocator` into a borrowed allocation scope.
        ///
        /// Requirements:
        ///
        /// * `std_alloc` must have come from `AllocationScopeIn(Allocator).allocator` (or the
        ///   equivalent method on a `Borrowed` instance).
        ///
        /// * One of the following must be true:
        ///
        ///   1. `Allocator` is `std.mem.Allocator`.
        ///
        ///   2. The parent allocator of the original allocation scope is equivalent to a
        ///      default-initialized borrowed `Allocator`, as returned by
        ///      `bun.memory.initDefault(bun.allocators.Borrowed(Allocator))`. This is the case
        ///      for `bun.DefaultAllocator`.
        pub fn downcast(std_alloc: std.mem.Allocator) Self {
            return downcastImpl(std_alloc, if (comptime Allocator == std.mem.Allocator)
                null
            else
                bun.memory.initDefault(BorrowedAllocator));
        }
    };

    return struct {
        const Self = @This();

        #parent: Allocator,
        #state: if (Self.enabled) Owned(*State) else void,

        pub const enabled = allocation_scope.enabled;

        /// Borrowed version of `AllocationScope`, returned by `AllocationScope.borrow`.
        /// Using this type makes it clear who actually owns the `AllocationScope`, and prevents
        /// `deinit` from being called twice.
        ///
        /// This type is a `GenericAllocator`; see `src/allocators.zig`.
        pub const Borrowed = BorrowedScope;

        pub fn init(parent_alloc: Allocator) Self {
            return .{
                .#parent = parent_alloc,
                .#state = if (comptime Self.enabled) .new(.init(
                    bun.allocators.asStd(parent_alloc),
                )),
            };
        }

        pub fn initDefault() Self {
            return .init(bun.memory.initDefault(Allocator));
        }

        /// Borrows this `AllocationScope`. Use this method instead of copying `self`, as that makes
        /// it hard to know who owns the `AllocationScope`, and could lead to `deinit` being called
        /// twice.
        pub fn borrow(self: Self) Borrowed {
            return .{
                .#parent = self.parent(),
                .#state = if (comptime Self.enabled) self.#state.get(),
            };
        }

        pub fn allocator(self: Self) std.mem.Allocator {
            return self.borrow().allocator();
        }

        pub fn deinit(self: *Self) void {
            bun.memory.deinit(&self.#parent);
            if (comptime Self.enabled) self.#state.deinit();
            self.* = undefined;
        }

        pub fn parent(self: Self) BorrowedAllocator {
            return bun.allocators.borrow(self.#parent);
        }

        pub fn stats(self: Self) Stats {
            return self.borrow().stats();
        }

        pub fn assertOwned(self: Self, ptr: anytype) void {
            self.borrow().assertOwned(ptr);
        }

        pub fn assertUnowned(self: Self, ptr: anytype) void {
            self.borrow().assertUnowned(ptr);
        }

        /// Track an arbitrary pointer. Extra data can be stored in the allocation, which will be
        /// printed when a leak is detected.
        pub fn trackExternalAllocation(
            self: Self,
            ptr: []const u8,
            ret_addr: ?usize,
            extra: Extra,
        ) void {
            self.borrow().trackExternalAllocation(ptr, ret_addr, extra);
        }

        /// Call when the pointer from `trackExternalAllocation` is freed.
        pub fn trackExternalFree(self: Self, slice: anytype, ret_addr: ?usize) FreeError!void {
            return self.borrow().trackExternalFree(slice, ret_addr);
        }

        pub fn setPointerExtra(self: Self, ptr: *anyopaque, extra: Extra) void {
            return self.borrow().setPointerExtra(ptr, extra);
        }

        pub fn leakSlice(self: Self, memory: anytype) void {
            if (comptime !Self.enabled) return;
            _ = @typeInfo(@TypeOf(memory)).pointer;
            self.trackExternalFree(memory, null) catch @panic("tried to free memory that was not allocated by the allocation scope");
        }
    };
}

const vtable: std.mem.Allocator.VTable = .{
    .alloc = vtable_alloc,
    .resize = std.mem.Allocator.noResize,
    .remap = std.mem.Allocator.noRemap,
    .free = vtable_free,
};

// Smaller traces since AllocationScope prints so many
pub const trace_limits: bun.crash_handler.WriteStackTraceLimits = .{
    .frame_count = 6,
    .stop_at_jsc_llint = true,
    .skip_stdlib = true,
};

pub const free_trace_limits: bun.crash_handler.WriteStackTraceLimits = .{
    .frame_count = 3,
    .stop_at_jsc_llint = true,
    .skip_stdlib = true,
};

fn vtable_alloc(ctx: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
    const raw_state: *State = @ptrCast(@alignCast(ctx));
    const state = raw_state.lock();
    defer raw_state.unlock();
    return state.alloc(len, alignment, ret_addr) catch null;
}

fn vtable_free(ctx: *anyopaque, buf: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
    const raw_state: *State = @ptrCast(@alignCast(ctx));
    const state = raw_state.lock();
    defer raw_state.unlock();
    state.free(buf, alignment, ret_addr);
}

pub inline fn isInstance(allocator: std.mem.Allocator) bool {
    return (comptime enabled) and allocator.vtable == &vtable;
}

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const Owned = bun.ptr.Owned;
const StoredTrace = bun.crash_handler.StoredTrace;
