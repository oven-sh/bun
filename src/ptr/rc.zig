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
            ""
        else if (@hasDecl(Context, "debug_name") and Context.debug_name != null)
            Context.debug_name
        else
            meta.typeBaseName(@typeName(T));

    const log = Output.scoped(output_name, true);

    const intrusive = @hasField(T, "ref_count");

    const Inner = struct {
        /// This is always > 0 unless value is just about to be deallocated.
        ref_count: if (intrusive) void else if (sync) AtomicU32 else u32 = if (intrusive) {} else if (sync) .init(1) else 1,
        allocator: Allocator,
        value: T,

        const Self = @This();

        fn ref(this: *Self) callconv(bun.callconv_inline) u32 {
            var ref_count_field = @field(if (intrusive) this.value else this, "ref_count");
            if (comptime sync) {
                const prev = ref_count_field.fetchAdd(1, AtomicOrder.acquire);
                bun.assertWithLocation(prev > 0, @src());
                return prev;
            } else {
                const prev = ref_count_field;
                bun.assertWithLocation(prev > 0, @src());
                ref_count_field += 1;
                return prev;
            }
        }

        fn deref(this: *Self) callconv(bun.callconv_inline) u32 {
            var ref_count_field = @field(if (intrusive) this.value else this, "ref_count");
            if (comptime sync) {
                const prev = ref_count_field.fetchSub(1, AtomicOrder.release);
                bun.assertWithLocation(prev > 0, @src());
                return prev;
            } else {
                const prev = ref_count_field;
                bun.assertWithLocation(prev > 0, @src());
                ref_count_field -= 1;
                return prev;
            }
        }

        fn refCount(this: Self) callconv(bun.callconv_inline) u32 {
            const ref_count_field = @field(if (intrusive) this.value else this, "ref_count");
            return if (comptime sync) ref_count_field.load(.acq_rel) else ref_count_field;
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

        /// Increment the reference count without obtaining a new pointer.
        ///
        /// While this does not return a new pointer, it _does_ create an owned
        /// reference. Caller must ensure the new reference's lifecycle is
        /// properly managed (that is, its owner calls `.deinit()`), otherwise a
        /// memory leak will occur.
        pub fn dangerouslyIncrementRef(this: Self) void {
            std.mem.doNotOptimizeAway(this.clone());
        }

        /// Decrement the reference count without deinitializing the pointer.
        /// When the reference count hits 0, the value is deinitialized and the
        /// allocation is freed.
        ///
        /// ## Safety
        /// Decrementing the reference count below 1 while holding a live
        /// reference count is illegal behavior. This pointer's owner must die
        /// at the same time as this pointer, otherwise it may hold a dangling
        /// pointer.
        /// 
        /// Caller should set `ensure_alive` to `true` when it assumes the
        /// allocation will continue to be alive after this call. This enables
        /// runtime safety checks and is useful, for example, when transferring
        /// ownership across threads or Zig/c++ boundaries.
        pub fn dangerouslyDecrementRef(this: Self, comptime ensure_alive: bool) void {
            const prev = this.__ptr.deref();
            log("0x{x} deref {d} - 1 = {d}", .{ @intFromPtr(this.__ptr), prev, prev - 1 });
            if (prev == 1) {
                @branchHint(.unlikely);
                if (comptime ensure_alive) bun.assert(false);
                // SAFETY: caller ensures that
                // 1. owner will die at the same time as this pointer, meaning nobody owns the dangling pointer
                // 2. reference count is not decremented below 1, meaning the pointer is not dangling
                this.destroy();
            }
        }

        /// Deinitialize the pointer.
        ///
        /// `deinit` decrements the stored allocation's reference count. If that
        /// count hits 0, the value gets deinitialized and the allocation is freed.
        pub fn deinit(this: *Self) void {
            const prev = this.__ptr.deref();
            log("0x{x} deref {d} - 1 = {d}", .{ @intFromPtr(this.__ptr), prev, prev - 1 });
            if (prev == 1) {
                @branchHint(.unlikely);
                this.destroy();
            }
            // pointer cannot be used after .deinit(), even if other references
            // to the allocation still exist
            this.* = undefined;
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
