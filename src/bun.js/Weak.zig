const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");

/// This value must be kept in sync with Weak.cpp
pub const WeakRefFinalizerTag = *const fn (*anyopaque) callconv(.C) void;

const WeakImpl = opaque {
    pub fn init(ptr: *anyopaque, comptime tag: ?WeakRefFinalizerTag, value: JSC.JSValue) *WeakImpl {
        JSC.markBinding(@src());
        return Bun__WeakRef__new(value, tag, ptr);
    }

    pub fn get(this: *WeakImpl) JSC.JSValue {
        JSC.markBinding(@src());
        return Bun__WeakRef__get(this);
    }

    pub fn set(this: *WeakImpl, ptr: *anyopaque, comptime tag: ?WeakRefFinalizerTag, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        Bun__WeakRef__set(this, value, tag, ptr);
    }

    pub fn clear(this: *WeakImpl) void {
        JSC.markBinding(@src());
        Bun__WeakRef__clear(this);
    }

    pub fn deinit(
        this: *WeakImpl,
    ) void {
        JSC.markBinding(@src());
        Bun__WeakRef__delete(this);
    }

    extern fn Bun__WeakRef__delete(this: *WeakImpl) void;
    extern fn Bun__WeakRef__new(JSC.JSValue, ?WeakRefFinalizerTag, *anyopaque) *WeakImpl;
    extern fn Bun__WeakRef__get(this: *WeakImpl) JSC.JSValue;
    extern fn Bun__WeakRef__set(this: *WeakImpl, JSC.JSValue, ?WeakRefFinalizerTag, *anyopaque) void;
    extern fn Bun__WeakRef__clear(this: *WeakImpl) void;
};

pub fn NewWeakFinalizer(comptime Context: type, comptime FinalizerFn: *const fn (*Context) callconv(.C) void) type {
    return struct {
        ref: ?*WeakImpl = null,

        const finalizer: WeakRefFinalizerTag = @ptrCast(FinalizerFn);

        pub const WeakFinalizer = @This();

        pub fn init() WeakFinalizer {
            return .{};
        }

        pub fn create(
            ptr: *Context,
            value: JSC.JSValue,
        ) WeakFinalizer {
            if (value != .zero) {
                return .{ .ref = WeakImpl.init(
                    ptr,
                    finalizer,
                    value,
                ) };
            }

            return .{};
        }

        pub fn get(this: *WeakFinalizer) ?JSC.JSValue {
            var ref = this.ref orelse return null;
            const result = ref.get();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn swap(this: *WeakFinalizer) JSC.JSValue {
            var ref = this.ref orelse return .zero;
            const result = ref.get();
            if (result == .zero) {
                return .zero;
            }

            ref.clear();
            return result;
        }

        pub fn has(this: *WeakFinalizer) bool {
            var ref = this.ref orelse return false;
            return ref.get() != .zero;
        }

        pub fn trySwap(this: *WeakFinalizer) ?JSC.JSValue {
            const result = this.swap();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn set(this: *WeakFinalizer, ptr: *Context, value: JSC.JSValue) void {
            var ref: *WeakImpl = this.ref orelse {
                if (value == .zero) return;
                this.ref = WeakImpl.init(ptr, finalizer, value);
                return;
            };
            ref.set(ptr, finalizer, value);
        }

        pub fn clear(this: *WeakFinalizer) void {
            var ref: *WeakImpl = this.ref orelse return;
            ref.clear();
        }

        pub fn deinit(this: *WeakFinalizer) void {
            var ref: *WeakImpl = this.ref orelse return;
            this.ref = null;
            ref.deinit();
        }
    };
}

pub const Weak = struct {
    ref: ?*WeakImpl = null,

    pub fn init() Weak {
        return .{};
    }

    pub fn create(
        ptr: *anyopaque,
        value: JSC.JSValue,
    ) Weak {
        if (value != .zero) {
            return .{ .ref = WeakImpl.init(ptr, value, null) };
        }

        return .{};
    }

    pub fn get(this: *Weak) ?JSC.JSValue {
        var ref = this.ref orelse return null;
        const result = ref.get();
        if (result == .zero) {
            return null;
        }

        return result;
    }

    pub fn swap(this: *Weak) JSC.JSValue {
        var ref = this.ref orelse return .zero;
        const result = ref.get();
        if (result == .zero) {
            return .zero;
        }

        ref.clear();
        return result;
    }

    pub fn has(this: *Weak) bool {
        var ref = this.ref orelse return false;
        return ref.get() != .zero;
    }

    pub fn trySwap(this: *Weak) ?JSC.JSValue {
        const result = this.swap();
        if (result == .zero) {
            return null;
        }

        return result;
    }

    pub fn set(this: *Weak, ptr: *anyopaque, value: JSC.JSValue) void {
        var ref: *WeakImpl = this.ref orelse {
            if (value == .zero) return;
            this.ref = WeakImpl.init(ptr, null, value);
            return;
        };
        ref.set(ptr, null, value);
    }

    pub fn clear(this: *Weak) void {
        var ref: *WeakImpl = this.ref orelse return;
        ref.clear();
    }

    pub fn deinit(this: *Weak) void {
        var ref: *WeakImpl = this.ref orelse return;
        this.ref = null;
        ref.deinit();
    }
};
