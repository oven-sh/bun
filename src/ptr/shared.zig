const shared = @This();

/// Options for `WithOptions`.
pub const Options = struct {
    // If non-null, the shared pointer will always use the provided allocator. This saves a small
    // amount of memory, but it means the shared pointer will be a different type from shared
    // pointers that use different allocators.
    Allocator: type = bun.DefaultAllocator,

    /// Whether to use an atomic type to store the ref count. This makes the shared pointer
    /// thread-safe, assuming the underlying data is also thread-safe.
    atomic: bool = false,

    /// Whether to allow weak pointers to be created. This uses slightly more memory but is often
    /// negligible due to padding.
    ///
    /// There is no point in enabling this if `deinit` is false, or if your data type doesn't have
    /// a `deinit` method, since the sole purpose of weak pointers is to allow `deinit` to be called
    /// before the memory is freed.
    allow_weak: bool = false,

    /// Whether to call `deinit` on the data before freeing it, if such a method exists.
    deinit: bool = true,
};

/// A shared pointer, allocated using the default allocator.
///
/// `Pointer` should be a possibly optional single-item pointer; e.g., `Shared(*Type)` or
/// `Shared(?*Type)`.
///
/// This type is not thread-safe: all pointers to the same piece of data must live on the same
/// thread. See `AtomicShared` for a thread-safe version.
pub fn Shared(comptime Pointer: type) type {
    return SharedIn(Pointer, bun.DefaultAllocator);
}

/// A thread-safe shared pointer, allocated using the default allocator.
///
/// This type uses atomic operations to manage the ref count, but it does not provide any
/// synchronization of the data itself. You must ensure proper concurrency using mutexes or
/// atomics.
pub fn AtomicShared(comptime Pointer: type) type {
    return AtomicSharedIn(Pointer, bun.DefaultAllocator);
}

/// A shared pointer allocated using a specific type of allocator.
///
/// The requirements for `Allocator` are the same as `bun.ptr.OwnedIn`.
/// `Allocator` may be `std.mem.Allocator` to allow any kind of allocator.
pub fn SharedIn(comptime Pointer: type, comptime Allocator: type) type {
    return WithOptions(Pointer, .{ .Allocator = Allocator });
}

/// A thread-safe shared pointer allocated using a specific type of allocator.
pub fn AtomicSharedIn(comptime Pointer: type, comptime Allocator: type) type {
    return WithOptions(Pointer, .{
        .Allocator = Allocator,
        .atomic = true,
    });
}

/// Like `Shared`, but takes explicit options.
pub fn WithOptions(comptime Pointer: type, comptime options: Options) type {
    if (options.allow_weak) {
        // Weak pointers only make sense if `deinit` will be called, since their only function
        // is to ensure `deinit` can be called before the memory is freed (weak pointers keep
        // the memory alive but not the object itself).
        bun.assertf(
            options.deinit,
            "shared.Options.allow_weak is useless if `deinit` is false",
            .{},
        );
        // Weak pointers are useless if `Child` doesn't have a `deinit` method, but don't error
        // in this case, as that could break generic code. It should be allowed to use
        // `WithOptions(*T, .{ .allow_weak = true }).Weak` if `T` might sometimes have a `deinit`
        // method.
    }

    return struct {
        const Self = @This();
        const Allocator = options.Allocator;
        const info = parsePointer(Pointer);
        const Child = info.Child;
        const NonOptionalPointer = info.NonOptionalPointer;
        const Data = FullData(Child, options);

        #pointer: Pointer,

        /// A weak pointer.
        ///
        /// Weak pointers must be upgraded to strong pointers before the shared data can be
        /// accessed. This upgrading can fail no shared pointers exist anymore, as the shared
        /// data will have been deinitialized in that case.
        pub const Weak = if (options.allow_weak) shared.Weak(Pointer, options);

        /// Allocates a shared value with a default-initialized `Allocator`.
        ///
        /// Call `deinit` when done.
        pub fn alloc(value: Child) AllocError!Self {
            return .allocImpl(bun.memory.initDefault(Allocator), value);
        }

        /// Allocates a shared value using the provided allocator.
        ///
        /// Call `deinit` when done.
        pub fn allocIn(value: Child, allocator: Allocator) AllocError!Self {
            return .allocImpl(allocator, value);
        }

        /// Allocates a shared value, calling `bun.outOfMemory` if allocation fails.
        ///
        /// It must be possible to default-initialize `Allocator`.
        ///
        /// Call `deinit` when done.
        pub fn new(value: Child) Self {
            return bun.handleOom(Self.alloc(value));
        }

        /// Returns a pointer to the shared value.
        ///
        /// This pointer should usually not be stored directly in a struct, as it could become
        /// invalid once all the shared pointers are deinitialized.
        pub fn get(self: Self) Pointer {
            return self.#pointer;
        }

        /// Clones this shared pointer. This clones the pointer, not the data; the new pointer
        /// points to the same data.
        pub fn clone(self: Self) Self {
            const data = if (comptime info.isOptional())
                self.getData() orelse return .initNull()
            else
                self.getData();
            data.incrementStrong();
            return .{ .#pointer = &data.value };
        }

        /// Creates a weak clone of this shared pointer.
        pub const cloneWeak = if (options.allow_weak) struct {
            pub fn cloneWeak(self: Self) Self.Weak {
                const data = if (comptime info.isOptional())
                    self.getData() orelse return .initNull()
                else
                    self.getData();
                data.incrementWeak();
                return .{ .#pointer = &data.value };
            }
        }.cloneWeak;

        /// Deinitializes this shared pointer. This does not deinitialize the data itself until all
        /// other shared pointers have been deinitialized.
        ///
        /// When no more (strong) shared pointers point to a given piece of data, the data is
        /// deinitialized. Once no weak pointers exist either, the memory is freed.
        ///
        /// This method invalidates `self`. The default behavior of calling `deinit` on the data can
        /// be changed in the `options`.
        pub fn deinit(self: *Self) void {
            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.getData() orelse return
            else
                self.getData();
            data.decrementStrong();
        }

        /// Returns a null shared pointer. This function is provided only if `Pointer` is an
        /// optional type.
        ///
        /// It is permitted, but not required, to call `deinit` on the returned value.
        pub const initNull = if (info.isOptional()) struct {
            pub fn initNull() Self {
                return .{ .#pointer = null };
            }
        }.initNull;

        const SharedNonOptional = WithOptions(NonOptionalPointer, options);

        /// Converts a `Shared(?*T)` into a `?Shared(*T)`.
        ///
        /// This method sets `self` to null. It is therefore permitted, but not required, to call
        /// `deinit` on `self`.
        pub const take = if (info.isOptional()) struct {
            pub fn take(self: *Self) ?SharedNonOptional {
                defer self.* = .initNull();
                return .{ .#pointer = self.#pointer orelse return null };
            }
        }.take;

        pub const Optional = WithOptions(?Pointer, options);

        /// Converts a `Shared(*T)` into a non-null `Shared(?*T)`.
        ///
        /// This method invalidates `self`.
        pub const toOptional = if (!info.isOptional()) struct {
            pub fn toOptional(self: *Self) Optional {
                defer self.* = undefined;
                return .{ .#pointer = self.#pointer };
            }
        }.toOptional;

        const Count = if (info.isOptional()) ?usize else usize;

        /// Gets the number of strong pointers that point to the shared data.
        ///
        /// Be careful about using this method with `AtomicShared` pointers. Another thread can
        /// change the reference count at any time. By the time you do something with the return
        /// value, the count may have changed.
        pub fn strongCount(self: Self) Count {
            const data = if (comptime info.isOptional())
                self.getData() orelse return null
            else
                self.getData();
            return data.strongCount(.acquire);
        }

        /// Gets the number of weak pointers that point to the shared data.
        ///
        /// Be careful about using this method with `AtomicShared` pointers. Another thread can
        /// change the reference count at any time. By the time you do something with the return
        /// value, the count may have changed.
        pub fn weakCount(self: Self) Count {
            const data = if (comptime info.isOptional())
                self.getData() orelse return null
            else
                self.getData();
            // `- 1` because this part of the weak count is not actually a weak pointer; it simply
            // indicates that strong pointers exist.
            return data.rawWeakCount(.acquire) - 1;
        }

        fn allocImpl(allocator: Allocator, value: Child) !Self {
            const data = try Data.alloc(allocator, value);
            return .{ .#pointer = &data.value };
        }

        fn getData(self: Self) if (info.isOptional()) ?*Data else *Data {
            return .fromValuePtr(self.#pointer);
        }

        /// Turns a shared pointer into a raw pointer without decrementing the reference count.
        ///
        /// This method invalidates `self`. To avoid leaks, the raw pointer should be turned back
        /// into a shared pointer with `adoptRawUnsafe`.
        pub fn leak(self: *Self) Pointer {
            defer self.* = undefined;
            return self.#pointer;
        }

        /// Creates a shared pointer from a raw pointer returned by `leak`.
        ///
        /// `pointer` must have been previously returned by `leak`. `adoptRawUnsafe` should not be
        /// called again on this pointer.
        pub fn adoptRawUnsafe(pointer: Pointer) Self {
            return .{ .#pointer = pointer };
        }

        /// Clones a shared pointer, given a raw pointer that originally came from a shared pointer.
        ///
        /// `pointer` must have come from a shared pointer, and the shared pointer from which it
        /// came must remain valid (i.e., not be deinitialized) at least until this function
        /// returns.
        pub fn cloneFromRawUnsafe(pointer: Pointer) Self {
            const temp: Self = .{ .#pointer = pointer };
            return temp.clone();
        }
    };
}

fn Weak(comptime Pointer: type, comptime options: Options) type {
    bun.assertf(
        options.allow_weak and options.deinit,
        "options incompatible with shared.Weak",
        .{},
    );

    return struct {
        const Self = @This();
        const info = parsePointer(Pointer);
        const Child = info.Child;
        const NonOptionalPointer = info.NonOptionalPointer;
        const Data = FullData(Child, options);

        #pointer: Pointer,

        const SharedNonOptional = WithOptions(NonOptionalPointer, options);

        /// Clones this weak pointer and upgrades it to a shared pointer. You still need to `deinit` the weak pointer.
        pub fn upgrade(self: Self) ?SharedNonOptional {
            const data = if (comptime info.isOptional())
                self.getData() orelse return null
            else
                self.getData();
            if (!data.tryIncrementStrong()) return null;
            return .{ .#pointer = &data.value };
        }

        /// Clones this weak pointer.
        pub fn clone(self: Self) Self {
            const data = if (comptime info.isOptional())
                self.getData() orelse return .initNull()
            else
                self.getData();
            data.incrementWeak();
            return .{ .#pointer = &data.value };
        }

        /// Deinitializes this weak pointer.
        ///
        /// This method invalidates `self`.
        pub fn deinit(self: *Self) void {
            defer self.* = undefined;
            const data = if (comptime info.isOptional())
                self.getData() orelse return
            else
                self.getData();
            data.decrementWeak();
        }

        /// Returns a null weak pointer. This function is provided only if `Pointer` is an
        /// optional type.
        ///
        /// It is permitted, but not required, to call `deinit` on the returned value.
        pub const initNull = if (info.isOptional()) struct {
            pub fn initNull() Self {
                return .{ .#pointer = null };
            }
        }.initNull;

        /// Checks if this weak pointer is null.
        ///
        /// This method is provided only if `Pointer` is an optional type.
        pub const isNull = if (options.isOptional()) struct {
            pub fn isNull(self: Self) bool {
                return self.#pointer == null;
            }
        }.isNull;

        const Count = if (info.isOptional()) ?usize else usize;

        /// Gets the number of strong pointers that point to the shared data.
        ///
        /// Be careful about using this method with `AtomicShared` pointers. Another thread can
        /// change the reference count at any time. By the time you do something with the return
        /// value, the count may have changed.
        pub fn strongCount(self: Self) Count {
            const data = if (comptime info.isOptional())
                self.getData() orelse return null
            else
                self.getData();
            return data.strongCount(.acquire);
        }

        /// Gets the number of weak pointers that point to the shared data.
        ///
        /// Be careful about using this method with `AtomicShared` pointers. Another thread can
        /// change the reference count at any time. By the time you do something with the return
        /// value, the count may have changed. Additionally, in concurrent code, this value can be
        /// off by one.
        pub fn weakCount(self: Self) Count {
            const data = if (comptime info.isOptional())
                self.getData() orelse return null
            else
                self.getData();
            const raw_weak = data.rawWeakCount(.acquire);
            // .monotonic because we just want to see if the strong count was > 0 when we read the
            // weak count. The .acquire load of the weak count, plus the fact that the strong count
            // never changes once it reaches 0, is sufficient.
            const strong = data.strongCount(.monotonic);
            return if (strong > 0) raw_weak - 1 else raw_weak;
        }

        fn getData(self: Self) if (info.isOptional()) ?*Data else *Data {
            return .fromValuePtr(self.#pointer);
        }
    };
}

fn FullData(comptime Child: type, comptime options: Options) type {
    const Allocator = options.Allocator;

    return struct {
        const Self = @This();

        value: Child,
        strong_count: Count = .init(1),
        /// Weak count is always >= 1 as long as strong references exist.
        /// When the last strong pointer is deinitialized, this value is decremented.
        weak_count: if (options.allow_weak) Count else void = if (options.allow_weak) .init(1),
        allocator: Allocator,
        thread_lock: if (options.atomic) void else bun.safety.ThreadLock,

        const Count = if (options.atomic) AtomicCount else NonAtomicCount;

        pub fn fromValuePtr(ptr: anytype) switch (@typeInfo(@TypeOf(ptr))) {
            .optional => ?*Self,
            else => *Self,
        } {
            const non_opt_ptr = if (comptime @typeInfo(@TypeOf(ptr)) == .optional)
                ptr orelse return null
            else
                ptr;
            return @fieldParentPtr("value", non_opt_ptr);
        }

        pub fn alloc(allocator: Allocator, value: Child) !*Self {
            return bun.memory.create(Self, bun.allocators.asStd(allocator), .{
                .value = value,
                .allocator = allocator,
                .thread_lock = if (comptime !options.atomic) .initLocked(),
            });
        }

        pub fn strongCount(self: Self, comptime order: AtomicOrder) usize {
            return self.strong_count.get(order);
        }

        /// Will be 1 greater than the actual number of weak pointers if any strong pointers exist.
        pub fn rawWeakCount(self: Self, comptime order: AtomicOrder) usize {
            return if (comptime options.allow_weak) self.weak_count.get(order) else 1;
        }

        pub fn incrementStrong(self: *Self) void {
            self.assertThreadSafety();
            self.strong_count.increment();
        }

        pub fn tryIncrementStrong(self: *Self) bool {
            return self.strong_count.tryIncrement();
        }

        pub fn decrementStrong(self: *Self) void {
            self.assertThreadSafety();
            // .acq_rel because we need to make sure other threads are done using the object before
            // we deinit/free it.
            if (self.strong_count.decrement() == 0) {
                self.deinitValue();
                self.decrementWeak();
            }
        }

        pub fn incrementWeak(self: *Self) void {
            self.assertThreadSafety();
            self.weak_count.increment();
        }

        pub fn decrementWeak(self: *Self) void {
            self.assertThreadSafety();
            // If `allow_weak` is false, this method is only called when the last strong pointer
            // is being deinitialized, so unconditionally free the memory in this case.
            //
            // .acq_rel because we need to make sure other threads are done using the object before
            // we free it.
            if ((comptime !options.allow_weak) or self.weak_count.decrement() == 0) {
                if (bun.Environment.ci_assert) bun.assert(self.strong_count.get(.monotonic) == 0);
                self.destroy();
            }
        }

        fn deinitValue(self: *Self) void {
            if (comptime options.deinit) {
                bun.memory.deinit(&self.value);
            }
        }

        fn destroy(self: *Self) void {
            bun.memory.destroy(bun.allocators.asStd(self.allocator), self);
        }

        fn assertThreadSafety(self: Self) void {
            if (comptime !options.atomic) self.thread_lock.assertLocked();
        }
    };
}

const RawCount = u32;

const NonAtomicCount = struct {
    const Self = @This();

    value: RawCount,

    pub fn init(value: RawCount) Self {
        return .{ .value = value };
    }

    pub fn get(self: Self, comptime order: AtomicOrder) RawCount {
        _ = order;
        return self.value;
    }

    pub fn increment(self: *Self) void {
        self.value += 1;
    }

    pub fn tryIncrement(self: *Self) bool {
        if (self.value == 0) return false;
        self.increment();
        return true;
    }

    /// Returns the new number of references.
    pub fn decrement(self: *Self) RawCount {
        self.value -= 1;
        return self.value;
    }
};

const AtomicCount = struct {
    const Self = @This();

    value: std.atomic.Value(RawCount),

    pub fn init(value: RawCount) Self {
        return .{ .value = .init(value) };
    }

    pub fn get(self: Self, comptime order: AtomicOrder) RawCount {
        return self.value.load(order);
    }

    pub fn increment(self: *Self) void {
        // .monotonic is okay for incrementing the ref count because:
        // * We don't care about the previous value, so the load can be .monotonic.
        // * There are no side effects in this thread that other threads depend on, so the
        //   store can be .monotonic.
        const old = self.value.fetchAdd(1, .monotonic);
        bun.assertf(old != std.math.maxInt(RawCount), "overflow of atomic ref count", .{});
    }

    pub fn tryIncrement(self: *Self) bool {
        // .monotonic is okay for the same reason as the `cmpxchgWeak`.
        var current = self.value.load(.monotonic);
        while (true) {
            if (current == 0) {
                // No strong refs remain, so the object was already deinitialized.
                return false;
            }
            // The only property we need to ensure is that once `value` is set to 0, its value
            // never changes. .monotonic is enough to guarantee that.
            current = self.value.cmpxchgWeak(current, current + 1, .monotonic, .monotonic) orelse {
                return true;
            };
        }
    }

    /// Returns the new number of references.
    pub fn decrement(self: *Self) RawCount {
        const old = self.value.fetchSub(1, .acq_rel);
        bun.assertf(old != 0, "underflow of atomic ref count", .{});
        return old - 1;
    }
};

fn parsePointer(comptime Pointer: type) PointerInfo {
    return .parse(Pointer, .{
        .allow_const = false,
        .allow_slices = false,
    });
}

const bun = @import("bun");
const std = @import("std");
const AtomicOrder = std.builtin.AtomicOrder;
const AllocError = std.mem.Allocator.Error;

const meta = @import("./meta.zig");
const PointerInfo = meta.PointerInfo;
