const enable_debug = bun.Environment.isDebug;
const enable_single_threaded_checks = enable_debug;

pub const RefCountOptions = struct {
    /// Defaults to the type basename.
    debug_name: ?[]const u8 = null,
    destructor_ctx: ?type = null,
};

/// Add managed reference counting to a struct type. This implements a `ref()`
/// and `deref()` method to add to the struct itself. This mixin doesn't handle
/// memory management, but is very easy to integrate with bun.new + bun.destroy.
///
/// Avoid reference counting when an object only has one owner.
///
///     const Thing = struct {
///         const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
///         // expose `ref` and `deref` as public methods
///         pub const ref = RefCount.ref;
///         pub const deref = RefCount.deref;
///
///         ref_count: RefCount,
///         other_field: u32,
///
///         pub fn init(field: u32) *T {
///             return bun.new(T, .{ .ref_count = .init(), .other_field = field });
///         }
///
///         // Destructor should be private so it is only called once ref_count is 0
///         // When this is empty, `bun.destroy` can be passed directly to `RefCount`
///         fn deinit(thing: *T) void {
///             std.debug.print("deinit {d}\n", .{thing.other_field});
///             bun.destroy(thing);
///         }
///     };
///
/// When `RefCount` is implemented, it can be used with `RefPtr(T)` to track where
/// a reference leak may be happening.
///
///     const my_ptr = RefPtr(Thing).adoptRef(.init(123));
///     assert(my_ptr.data.other_field == 123);
///
///     const second_pointer = my_ptr.dupeRef();
///     assert(second_pointer.data == my_ptr.data);
///
///     my_ptr.deref(); // pointer stays valid
///
///     // my_ptr.data // INVALID ACCESS
///     assert(second_pointer.data.other_field == 123);
///
///     second_pointer.deref(); // pointer is destroyed
///
/// Code that migrates to using `RefPtr` would put the .adoptRef call in it's
/// initializer. To combine `bun.new` and `adoptRef`, you can use `RefPtr(T).new`.
///
///     pub fn init(field: u32) RefPtr(T) {
///         return .new(.{
///             .ref_count = .init(),
///             .other_field = field,
///         });
///     }
///
/// Code can incrementally migrate to `RefPtr`, using `.initRef` to increment the count
///
///     const ref_ptr = RefPtr(T).initRef(existing_raw_pointer);
///
/// If you want to enforce usage of RefPtr for memory management, you
/// can remove the forwarded `ref` and `deref` methods from `RefCount`.
/// If these methods are not forwarded, keep in mind that it should use the wrapper.
pub fn RefCount(T: type, field_name: []const u8, destructor_untyped: anytype, options: RefCountOptions) type {
    return struct {
        active_counts: u32,
        thread: if (enable_single_threaded_checks) ?bun.DebugThreadLock else void,
        debug: if (enable_debug) DebugData(false) else void,

        const debug_name = options.debug_name orelse bun.meta.typeBaseName(@typeName(T));
        pub const scope = bun.Output.Scoped(debug_name, true);
        const DEBUG_STACK_TRACE = false;

        const Destructor = if (options.destructor_ctx) |ctx| fn (*T, ctx) void else fn (*T) void;
        const destructor: Destructor = destructor_untyped;

        pub fn init() @This() {
            return .initExactRefs(1);
        }

        /// Caller will have to call `unref()` exactly `count` times to destroy.
        pub fn initExactRefs(count: u32) @This() {
            assert(count > 0);
            return .{
                .thread = if (enable_single_threaded_checks) if (@inComptime()) null else .initLocked(),
                .active_counts = count,
                .debug = if (enable_debug) .empty else undefined,
            };
        }

        // trait implementation

        pub fn ref(self: *T) void {
            const counter = getCounter(self);
            if (enable_debug) {
                counter.debug.assertValid();
            }
            if (bun.Environment.enable_logs and scope.isVisible()) {
                scope.log("0x{x}   ref {d} -> {d}:", .{
                    @intFromPtr(self),
                    counter.active_counts,
                    counter.active_counts + 1,
                });
                if (DEBUG_STACK_TRACE) {
                    bun.crash_handler.dumpCurrentStackTrace(@returnAddress(), .{
                        .frame_count = 2,
                        .skip_file_patterns = &.{"ptr/ref_count.zig"},
                    });
                }
            }
            counter.assertNonThreadSafeCountIsSingleThreaded();
            counter.active_counts += 1;
        }

        pub fn deref(self: *T) void {
            derefWithContext(self, {});
        }

        pub fn derefWithContext(self: *T, ctx: (options.destructor_ctx orelse void)) void {
            const counter = getCounter(self);
            if (enable_debug) {
                counter.debug.assertValid(); // Likely double deref.
            }
            if (bun.Environment.enable_logs and scope.isVisible()) {
                scope.log("0x{x} deref {d} -> {d}:", .{
                    @intFromPtr(self),
                    counter.active_counts,
                    counter.active_counts - 1,
                });
                if (DEBUG_STACK_TRACE) {
                    bun.crash_handler.dumpCurrentStackTrace(@returnAddress(), .{
                        .frame_count = 2,
                        .skip_file_patterns = &.{"ptr/ref_count.zig"},
                    });
                }
            }
            counter.assertNonThreadSafeCountIsSingleThreaded();
            counter.active_counts -= 1;
            if (counter.active_counts == 0) {
                if (enable_debug) {
                    counter.debug.deinit(std.mem.asBytes(self), @returnAddress());
                }
                if (comptime options.destructor_ctx != null) {
                    destructor(self, ctx);
                } else {
                    destructor(self);
                }
            }
        }

        pub fn dupeRef(self: anytype) RefPtr(@TypeOf(self)) {
            _ = @as(*const T, self); // ensure ptr child is T
            return .initRef(self);
        }

        // utility functions

        pub fn hasOneRef(count: *@This()) bool {
            count.assertNonThreadSafeCountIsSingleThreaded();
            return count.active_counts == 1;
        }

        pub fn dumpActiveRefs(count: *@This()) void {
            if (enable_debug) {
                const ptr: *T = @fieldParentPtr(field_name, count);
                count.debug.dump(@typeName(T), ptr, count.active_counts);
            }
        }

        /// The active_counts value is 0 after the destructor is called.
        pub fn assertNoRefs(count: *const @This()) void {
            if (enable_debug) {
                bun.assert(count.active_counts == 0);
            }
        }

        fn assertNonThreadSafeCountIsSingleThreaded(count: *@This()) void {
            if (enable_single_threaded_checks) {
                const thread = if (count.thread) |*ptr| ptr else {
                    count.thread = .initLocked();
                    return;
                };
                thread.assertLocked(); // this counter is not thread-safe
            }
        }

        fn getCounter(self: *T) *@This() {
            return &@field(self, field_name);
        }

        /// Private, allows RefPtr to assert that ref_count is a valid RefCount type.
        const is_ref_count = unique_symbol;
        const ref_count_options = options;
    };
}

/// Add thread-safe reference counting to a struct type. This implements a `ref()`
/// and `deref()` method to add to the struct itself. This mixin doesn't handle
/// memory management, but is very easy to integrate with bun.new + bun.destroy.
///
/// See `RefCount`'s comment defined above for examples & best practices.
///
/// Avoid reference counting when an object only has one owner.
/// Avoid thread-safe reference counting when only one thread allocates and frees.
pub fn ThreadSafeRefCount(T: type, field_name: []const u8, destructor: fn (*T) void, options: RefCountOptions) type {
    return struct {
        active_counts: std.atomic.Value(u32),
        debug: if (enable_debug) DebugData(true) else void,

        const debug_name = options.debug_name orelse bun.meta.typeBaseName(@typeName(T));
        pub const scope = bun.Output.Scoped(debug_name, true);

        pub fn init() @This() {
            return .initExactRefs(1);
        }

        /// Caller will have to call `unref()` exactly `count` times to destroy.
        pub fn initExactRefs(count: u32) @This() {
            assert(count > 0);
            return .{
                .active_counts = .init(count),
                .debug = if (enable_debug) .empty,
            };
        }

        // trait implementation

        pub fn ref(self: *T) void {
            const counter = getCounter(self);
            if (enable_debug) counter.debug.assertValid();
            const old_count = counter.active_counts.fetchAdd(1, .seq_cst);
            if (comptime bun.Environment.enable_logs) {
                scope.log("0x{x}   ref {d} -> {d}", .{
                    @intFromPtr(self),
                    old_count,
                    old_count + 1,
                });
            }
            bun.debugAssert(old_count > 0);
        }

        pub fn deref(self: *T) void {
            const counter = getCounter(self);
            if (enable_debug) counter.debug.assertValid();
            const old_count = counter.active_counts.fetchSub(1, .seq_cst);
            if (comptime bun.Environment.enable_logs) {
                scope.log("0x{x} deref {d} -> {d}", .{
                    @intFromPtr(self),
                    old_count,
                    old_count - 1,
                });
            }
            bun.debugAssert(old_count > 0);
            if (old_count == 1) {
                if (enable_debug) {
                    counter.debug.deinit(std.mem.asBytes(self), @returnAddress());
                }
                destructor(self);
            }
        }

        pub fn dupeRef(self: anytype) RefPtr(@TypeOf(self)) {
            if (enable_debug) getCounter(self).debug.assertValid();
            _ = @as(*const T, self); // ensure ptr child is T
            return .initRef(self);
        }

        // utility functions

        pub fn hasOneRef(counter: *const @This()) bool {
            if (enable_debug) counter.debug.assertValid();
            return counter.active_counts.load(.seq_cst) == 1;
        }

        pub fn dumpActiveRefs(count: *@This()) void {
            if (enable_debug) {
                const ptr: *T = @alignCast(@fieldParentPtr(field_name, count));
                count.debug.dump(@typeName(T), ptr, count.active_counts.load(.seq_cst));
            }
        }

        /// The active_counts value is 0 after the destructor is called.
        pub fn assertNoRefs(count: *const @This()) void {
            if (enable_debug) {
                bun.assert(count.active_counts.load(.seq_cst) == 0);
            }
        }

        fn getCounter(self: *T) *@This() {
            return &@field(self, field_name);
        }

        /// Private, allows RefPtr to assert that ref_count is a valid RefCount type.
        const is_ref_count = unique_symbol;
        const ref_count_options = options;
    };
}

/// A pointer to an object implementing `RefCount` or `ThreadSafeRefCount`
/// The benefit of this over `T*` is that instances of `RefPtr` are tracked.
///
/// By using this, you gain the following memory debugging tools:
///
/// - `T.ref_count.dump()` to dump all active references.
/// - AllocationScope integration via `.newTracked()` and `.trackAll()`
///
/// If you want to enforce usage of RefPtr for memory management, you
/// can remove the forwarded `ref` and `deref` methods from `RefCount`.
///
/// See `RefCount`'s comment defined above for examples & best practices.
pub fn RefPtr(T: type) type {
    return struct {
        data: *T,
        debug: DebugId,

        const RefCountMixin = @FieldType(T, "ref_count");
        const options = RefCountMixin.ref_count_options;
        comptime {
            bun.assert(RefCountMixin.is_ref_count == unique_symbol);
        }
        const DebugId = if (enable_debug) TrackedRef.Id else void;

        /// Increment the reference count, and return a structure boxing the pointer.
        pub fn initRef(raw_ptr: *T) @This() {
            RefCountMixin.ref(raw_ptr);
            bun.assert(RefCountMixin.is_ref_count == unique_symbol);
            return uncheckedAndUnsafeInit(raw_ptr, @returnAddress());
        }

        // NOTE: would be nice to use an if for deref.
        //
        // pub const deref = if (options.destructor_ctx == null) derefWithoutContext else derefWithContext;
        //
        // but ZLS doesn't realize it is function so the semantic tokens look bad.

        /// Decrement the reference count, and destroy the object if the count is 0.
        pub fn deref(self: *const @This()) void {
            derefWithContext(self, {});
        }

        ///  Decrement the reference count, and destroy the object if the count is 0.
        pub fn derefWithContext(self: *const @This(), ctx: (options.destructor_ctx orelse void)) void {
            if (enable_debug) {
                self.data.ref_count.debug.release(self.debug, @returnAddress());
            }
            if (comptime options.destructor_ctx != null) {
                RefCountMixin.derefWithContext(self.data, ctx);
            } else {
                RefCountMixin.deref(self.data);
            }
            if (bun.Environment.isDebug) {
                // make UAF fail faster (ideally integrate this with ASAN)
                // this @constCast is "okay" because it makes no sense to store
                // an object with a heap pointer in the read only segment
                @constCast(self).data = undefined;
            }
        }

        pub fn dupeRef(ref: @This()) @This() {
            return .initRef(ref.data);
        }

        // Allocate a new object, returning a RefPtr to it.
        pub fn new(init_data: T) @This() {
            return .adoptRef(bun.new(T, init_data));
        }

        /// Initialize a newly allocated pointer, returning a RefPtr to it.
        /// Care must be taken when using non-default allocators.
        pub fn adoptRef(raw_ptr: *T) @This() {
            if (enable_debug) {
                bun.assert(raw_ptr.ref_count.hasOneRef());
                raw_ptr.ref_count.debug.assertValid();
            }
            return uncheckedAndUnsafeInit(raw_ptr, @returnAddress());
        }

        /// This will assert that ALL references are cleaned up by the time the allocation scope ends.
        pub fn newTracked(scope: *AllocationScope, init_data: T) @This() {
            const ptr: @This() = .new(init_data);
            ptr.trackImpl(scope, @returnAddress());
            return ptr;
        }

        /// This will assert that ALL references are cleaned up by the time the allocation scope ends.
        pub fn trackAll(ref: @This(), scope: *AllocationScope) void {
            ref.trackImpl(scope, @returnAddress());
        }

        fn trackImpl(ref: @This(), scope: *AllocationScope, ret_addr: usize) void {
            const debug = &ref.data.ref_count.debug;
            debug.allocation_scope = &scope;
            scope.trackExternalAllocation(
                std.mem.asBytes(ref.data),
                ret_addr,
                .{ .ref_count = debug },
            );
        }

        pub fn uncheckedAndUnsafeInit(raw_ptr: *T, ret_addr: ?usize) @This() {
            return .{
                .data = raw_ptr,
                .debug = if (enable_debug) raw_ptr.ref_count.debug.acquire(
                    &raw_ptr.ref_count.active_counts,
                    ret_addr orelse @returnAddress(),
                ),
            };
        }
    };
}

const TrackedRef = struct {
    acquired_at: bun.crash_handler.StoredTrace,

    /// Not an index, just a unique identifier for the debug data
    pub const Id = bun.GenericIndex(u32, TrackedRef);
};

const TrackedDeref = struct {
    acquired_at: bun.crash_handler.StoredTrace,
    released_at: bun.crash_handler.StoredTrace,
};

/// Provides Ref tracking. This is not generic over the pointer T to reduce analysis complexity.
pub fn DebugData(thread_safe: bool) type {
    return struct {
        const Debug = @This();
        const Count = if (thread_safe) std.atomic.Value(u32) else u32;

        magic: enum(u128) { valid = 0x2f84e51d, _ } align(@alignOf(u32)),
        lock: if (thread_safe) std.debug.SafetyLock else bun.Mutex,
        next_id: u32,
        map: std.AutoHashMapUnmanaged(TrackedRef.Id, TrackedRef),
        frees: std.AutoArrayHashMapUnmanaged(TrackedRef.Id, TrackedDeref),
        // Allocation Scope integration
        allocation_scope: ?*AllocationScope,
        count_pointer: ?*Count,

        pub const empty: @This() = .{
            .magic = .valid,
            .lock = .{},
            .next_id = 0,
            .map = .empty,
            .frees = .empty,
            .allocation_scope = null,
            .count_pointer = null,
        };

        fn assertValid(debug: *const @This()) void {
            bun.assert(debug.magic == .valid);
        }

        fn dump(debug: *@This(), type_name: ?[]const u8, ptr: *anyopaque, ref_count: u32) void {
            debug.lock.lock();
            defer debug.lock.unlock();

            genericDump(type_name, ptr, ref_count, &debug.map);
        }

        fn nextId(debug: *@This()) TrackedRef.Id {
            if (thread_safe) {
                return .init(@atomicRmw(u32, &debug.next_id, .Add, 1, .seq_cst));
            } else {
                defer debug.next_id += 1;
                return .init(debug.next_id);
            }
        }

        fn acquire(debug: *@This(), count_pointer: *Count, return_address: usize) TrackedRef.Id {
            debug.lock.lock();
            defer debug.lock.unlock();
            debug.count_pointer = count_pointer;
            const id = nextId(debug);
            debug.map.put(bun.default_allocator, id, .{
                .acquired_at = .capture(return_address),
            }) catch bun.outOfMemory();
            return id;
        }

        fn release(debug: *@This(), id: TrackedRef.Id, return_address: usize) void {
            debug.lock.lock(); // If this triggers ASAN, the RefCounted object is double-freed.
            defer debug.lock.unlock();
            const entry = debug.map.fetchRemove(id) orelse {
                return;
            };
            debug.frees.put(bun.default_allocator, id, .{
                .acquired_at = entry.value.acquired_at,
                .released_at = .capture(return_address),
            }) catch bun.outOfMemory();
        }

        fn deinit(debug: *@This(), data: []const u8, ret_addr: usize) void {
            assertValid(debug);
            debug.magic = undefined;
            debug.lock.lock();
            defer debug.lock.unlock();
            debug.map.clearAndFree(bun.default_allocator);
            debug.frees.clearAndFree(bun.default_allocator);
            if (debug.allocation_scope) |scope| {
                _ = scope.trackExternalFree(data, ret_addr);
            }
        }

        // Trait function for AllocationScope
        pub fn onAllocationLeak(debug: *@This(), data: []u8) void {
            debug.lock.lock();
            defer debug.lock.unlock();
            const count = debug.count_pointer.?;
            debug.dump(null, data.ptr, if (thread_safe) count.load(.seq_cst) else count.*);
        }
    };
}

fn genericDump(
    type_name: ?[]const u8,
    ptr: *anyopaque,
    total_ref_count: usize,
    map: *std.AutoHashMapUnmanaged(TrackedRef.Id, TrackedRef),
) void {
    const tracked_refs = map.count();
    const untracked_refs = total_ref_count - tracked_refs;
    bun.Output.prettyError("<blue>{s}{s}{x} has ", .{
        type_name orelse "",
        if (type_name != null) "@" else "",
        @intFromPtr(ptr),
    });
    if (tracked_refs > 0) {
        bun.Output.prettyError("{d} tracked{s}", .{ tracked_refs, if (untracked_refs > 0) ", " else "" });
    }
    if (untracked_refs > 0) {
        bun.Output.prettyError("{d} untracked refs<r>\n", .{untracked_refs});
    } else {
        bun.Output.prettyError("refs<r>\n", .{});
    }
    var i: usize = 0;
    var it = map.iterator();
    while (it.next()) |entry| {
        bun.Output.prettyError("<b>RefPtr acquired at:<r>\n", .{});
        bun.crash_handler.dumpStackTrace(entry.value_ptr.acquired_at.trace(), AllocationScope.trace_limits);
        i += 1;
        if (i >= 3) {
            bun.Output.prettyError("  {d} omitted ...\n", .{map.count() - i});
            break;
        }
    }
}

pub fn maybeAssertNoRefs(T: type, ptr: *const T) void {
    if (!@hasField(T, "ref_count")) return;
    const Rc = @FieldType(T, "ref_count");
    switch (@typeInfo(Rc)) {
        .@"struct" => if (@hasDecl(Rc, "assertNoRefs"))
            ptr.ref_count.assertNoRefs(),
        else => {},
    }
}

const unique_symbol = opaque {};

const std = @import("std");
const bun = @import("bun");
const assert = bun.assert;
const AllocationScope = bun.AllocationScope;
