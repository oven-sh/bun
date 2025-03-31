//! Reference counted pointers.
//!
//! These pointers are a safer, non-invasive alternative to `ptr.NewRefCounted`
//! and `ptr.NewThreadSafeRefCounted`. Prefer using pointers in this module in
//! new code.
//!
//! This module's primary main pointer type is `RefCounted`, which is a
//! reference-counted pointer. `Rc` and its thread-safe counterpart, `Arc`,
//! provide shorthands for creating `RefCounted` pointers with sensible
//! defaults.
//!
//! These docs assume basic familiarity with move semantics.
const bun = @import("root").bun;
const std = @import("std");
const atomic = std.atomic;

const AtomicU32 = atomic.Value(u32);
const AtomicOrder = std.builtin.AtomicOrder;
const Allocator = std.mem.Allocator;

const Output = bun.Output;
const meta = bun.meta;

/// A single-threaded reference-counting pointer. 'Rc' stands for 'Reference
/// Counted'. Inspired by Rust's
/// [`Rc<T>`](https://doc.rust-lang.org/std/rc/index.html) type.
///
/// `Rc(T)` provides shared ownership of a `T` allocated on the heap. Invoking
/// `clone` provides a new pointer to the same allocation. When the last `Rc` to
/// an allocation is `deinit`ed, value stored in that allocation (aka the "inner
/// value") is deallocated.
pub fn Rc(T: type) type {
    return RefCounted(T, AutoContext(T), false);
}

/// A thread-safe reference-counting pointer. 'Arc' stands for 'Atomic
/// Reference Counted'. Inspired by Rust's
/// [`Arc<T>`](https://doc.rust-lang.org/std/sync/struct.Arc.html) type.
///
/// The type `Arc(T)` provides shared ownership of a value of type `T`,
/// allocated in the heap. Invoking `clone` on `Arc` produces a new `Arc`
/// instance, which points to the same allocation on the heap as the source
/// `Arc`, while increasing a reference count. When the last `Arc` pointer to a
/// given allocation is destroyed, the value stored in that allocation (often
/// referred to as "inner value") is also dropped.
///
/// The `deinit` function used by `Arc(T)` is inferred from `T`. Types that do
/// not need to deinitialize their fields do not need a `deinit` function. If they
/// do, `deinit` should either
/// * take only a `*T` or `T` as a parameter
/// * Take a `*T` or `T` and an Allocator as parameters
pub fn Arc(T: type) type {
    return RefCounted(T, AutoContext(T), true);
}

fn AutoContext(T: type) type {
    return struct {
        pub const debug_name: ?[:0]const u8 = null;
        pub const deinit = if (@hasDecl(T, "deinit")) T.deinit else null;
    };
}

/// A reference-counted pointer.
///
/// The `RefCounted` type provides shared ownership of a value of type `T`,
/// allocated in the heap. Invoking `clone` on `RefCounted` produces a new
/// `RefCounted` instance, which points to the same allocation on the heap as
/// the source `RefCounted`, while increasing a reference count. When the last
/// `RefCounted` pointer to a given allocation is destroyed, the value stored in
/// that allocation (often referred to as "inner value") is also dropped.
///
/// ## Deinitialization Behavior
///
/// `RefCounted` takes a `Context` type that may define a `deinit` function to
/// deinitialize a `T`.
///
/// ## Invariants
/// The following invariants must be upheld for `RefCounted` to work safely:
/// - Allocations created by the provided `Allocator` must have `'static`
///   lifetimes. This means, e.g., `StackFallback` cannot be used.
pub fn RefCounted(
    /// Type of the value to be reference-counted
    T: type,
    /// Interface pseudo-type:
    /// ```zig
    /// const Context = struct {
    ///   pub const debug_name: ?[:0]const u8;
    ///   pub const deinit: null;
    ///   pub const deinit: fn (value: *T) void;
    ///   pub const deinit: fn (value: *T, allocator: Allocator) void;
    /// };
    /// ```
    /// `deinit`'s `value` parameter may be a `*T` or `T`.
    Context: type,
    /// When `true`, uses atomic operations to modify the reference count.
    comptime sync: bool,
) type {
    const output_name: [:0]const u8 =
        if (!bun.Environment.enable_logs)
            &""
        else if (@hasDecl(Context, "debug_name") and Context.debug_name != null)
            Context.debug_name
        else
            meta.typeBaseName(@typeName(T));

    const log = Output.scoped(output_name, true);

    const OwnCount: ?type = if (!@hasField(T, "ref_count")) void else blk: {
        const Count: type = @FieldType(T, "ref_count");
        const count_info = @typeInfo(Count);
        if (count_info != .int) @compileError(@typeName(T) ++ ".ref_count must be an integer type");
        break :blk Count;
    };
    // const intrusive = OwnCount != null;

    const Inner = struct {
        /// This is always > 0 unless value is just about to be deallocated.
        ref_count: if (OwnCount != null) void else if (sync) AtomicU32 else u32 = if (sync) .init(1) else 1,
        allocator: Allocator,
        value: T,

        const Self = @This();

        fn ref(this: *Self) callconv(bun.callconv_inline) u32 {
            if (OwnCount) |C| {
                const prev = if (comptime sync) @atomicRmw(C, &this.value.ref_count, .Add, 1, .acquire) else this.value.ref_count;
                bun.assertWithLocation(prev > 0, @src());
                if (!sync) this.value.ref_count = prev + 1;
                return prev;
            }

            const prev = if (comptime sync) this.ref_count.fetchAdd(1, AtomicOrder.acquire) else this.ref_count;
            bun.assertWithLocation(prev > 0, @src());
            if (!sync) this.ref_count += 1;
            return prev;
        }

        fn deref(this: *Self) callconv(bun.callconv_inline) u32 {
            if (OwnCount) |C| {
                const prev = if (comptime sync) @atomicRmw(C, &this.value.ref_count, .Sub, 1, .release) else this.value.ref_count;
                bun.assertWithLocation(prev > 0, @src());
                if (!sync) this.value.ref_count = prev - 1;
                return prev;
            }

            const prev = if (comptime sync) this.ref_count.fetchSub(1, AtomicOrder.release) else this.ref_count;
            bun.assertWithLocation(prev > 0, @src());
            if (!sync) this.ref_count -= 1;
            return prev;
        }

        fn refCount(this: Self) callconv(bun.callconv_inline) u32 {
            if (OwnCount) |C|
                return if (comptime sync) @atomicLoad(C, &this.value.ref_count, .acquire) else this.value.ref_count
            else
                return if (comptime sync) this.ref_count.load(AtomicOrder.acq_rel) else this.ref_count;
        }
    };

    return struct {
        /// Do not initialize, read, or otherwise access this directly.
        /// - Use `.get()` or `.getMut()` to dereference the pointer.
        /// - use `.clone()` to obtain a new reference to the value.
        __ptr: *Inner,

        const Self = @This();

        /// Construct a new reference-counted pointer. It takes ownership of
        /// `value`. `value` is assumed to be fully initialized.
        pub fn init(value: T, allocator: Allocator) Allocator.Error!Self {
            const inner = try allocator.create(Inner);
            inner.* = .{ .value = value, .allocator = allocator };
            return Self{ .__ptr = inner };
        }

        /// Dereference the pointer, obtaining a read-only reference to the
        /// stored value.  This is not thread-safe.
        pub inline fn get(this: Self) *const T {
            // should this use @atomicLoad when `sync` for thread safety?
            return &this.__ptr.value;
        }

        /// Dereference the pointer, obtaining a mutable reference to the stored value.
        /// This is not thread-safe.
        pub inline fn getMut(this: Self) *T {
            return &this.__ptr.value;
        }

        /// Create a clone of this ref-counted pointer.
        ///
        /// This makes another pointer to the same allocation, incrementing the
        /// reference count. No allocations occur.
        ///
        /// Caller owns the returned pointer and must call `deinit` when done.
        pub fn clone(this: Self) Self {
            const prev = this.__ptr.ref();
            log("0x{x} ref {d} + 1 = {d}", .{ @intFromPtr(this.__ptr), prev, prev + 1 });
            return this;
        }

        pub fn deinit(this: Self) void {
            const prev = this.__ptr.deref();
            log("0x{x} deref {d} - 1 = {d}", .{ @intFromPtr(this.__ptr), prev, prev - 1 });
            if (prev == 1) {
                @branchHint(.unlikely);
            }
        }

        fn destroy(this: Self) void {
            const allocator = this.__ptr.allocator;

            var value: T = if (comptime sync) @atomicLoad(T, this.__ptr.value, .acquire) else this.__ptr.value;
            if (@hasDecl(Context, "deinit")) {
                switch (@TypeOf(Context.deinit)) {
                    fn (*T) void => Context.deinit(&value),
                    fn (*T, Allocator) void => Context.deinit(&value, allocator),
                    fn (T) void => Context.deinit(&value),
                    fn (T, Allocator) void => Context.deinit(value, allocator),
                    null => {}, // No deinit function, do nothing
                    else => @compileError("Invalid type or fn signature for `Context.deinit`: " ++ @typeName(Context.deinit)),
                }
            }

            allocator.destroy(this.__ptr);
            this.__ptr.* = undefined;
        }

        /// Get the current number of references to the stored value.
        ///
        /// You will almost never need to call this directly. Use `clone` and
        /// `deinit` instead.
        pub fn refCount(this: Self) u32 {
            return this.__ptr.refCount();
        }
    };
}

const expectEqual = std.testing.expectEqual;
test Rc {
    const allocator = std.testing.allocator;

    const rc = try Rc(u32).init(42, allocator);
    defer rc.deinit();
    try expectEqual(42, rc.get().*);
    try expectEqual(1, rc.refCount());

    const rc2 = rc.clone();
    try expectEqual(42, rc2.get().*);
    try expectEqual(2, rc.refCount());

    rc2.deinit();
    try expectEqual(1, rc.refCount());
}

test Arc {
    const allocator = std.testing.allocator;

    const rc = try Arc(u32).init(42, allocator);
    defer rc.deinit();
    try expectEqual(42, rc.get().*);
    try expectEqual(1, rc.refCount());

    // Create a new reference to the same value
    const rc2 = rc.clone();
    try expectEqual(42, rc2.get().*);
    try expectEqual(2, rc.refCount());

    // `deinit`ing an Arc decrements the reference count
    rc2.deinit();
    try expectEqual(1, rc.refCount());
}
