//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. When not holding a value, the strong may still be allocated.
const Strong = @This();

impl: ?*Impl,

pub const empty: Strong = .{ .impl = null };

/// Hold a strong reference to a JavaScript value. Release with `deinit` or `clear`
pub fn create(value: JSC.JSValue, globalThis: *JSC.JSGlobalObject) Strong {
    return if (value != .zero)
        .{ .impl = .init(globalThis, value) }
    else
        .empty;
}

/// Frees memory for the underlying Strong reference.
pub fn deinit(strong: *Strong) void {
    const ref: *Impl = strong.impl orelse return;
    strong.* = .empty;
    ref.deinit();
}

/// Clears the value, but does not de-allocate the Strong reference.
pub fn clearWithoutDeallocation(strong: *Strong) void {
    const ref: *Impl = strong.impl orelse return;
    ref.clear();
}

pub fn call(this: *Strong, global: *JSC.JSGlobalObject, args: []const JSC.JSValue) JSC.JSValue {
    const function = this.trySwap() orelse return .zero;
    return function.call(global, args);
}

pub fn get(this: *const Strong) ?JSC.JSValue {
    const impl = this.impl orelse return null;
    const result = impl.get();
    if (result == .zero) {
        return null;
    }
    return result;
}

pub fn swap(strong: *Strong) JSC.JSValue {
    const impl = strong.impl orelse return .zero;
    const result = impl.get();
    if (result == .zero) {
        return .zero;
    }
    impl.clear();
    return result;
}

pub fn has(this: *const Strong) bool {
    var ref = this.impl orelse return false;
    return ref.get() != .zero;
}

pub fn trySwap(this: *Strong) ?JSC.JSValue {
    const result = this.swap();
    if (result == .zero) {
        return null;
    }

    return result;
}

pub fn set(strong: *Strong, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
    const ref: *Impl = strong.impl orelse {
        if (value == .zero) return;
        strong.impl = Impl.init(globalThis, value);
        return;
    };
    ref.set(globalThis, value);
}

const Impl = opaque {
    pub fn init(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) *Impl {
        JSC.markBinding(@src());
        return Bun__StrongRef__new(globalThis, value);
    }

    pub fn get(this: *Impl) JSC.JSValue {
        JSC.markBinding(@src());
        return Bun__StrongRef__get(this);
    }

    pub fn set(this: *Impl, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        Bun__StrongRef__set(this, globalThis, value);
    }

    pub fn clear(this: *Impl) void {
        JSC.markBinding(@src());
        Bun__StrongRef__clear(this);
    }

    pub fn deinit(this: *Impl) void {
        JSC.markBinding(@src());
        Bun__StrongRef__delete(this);
    }

    extern fn Bun__StrongRef__delete(this: *Impl) void;
    extern fn Bun__StrongRef__new(*JSC.JSGlobalObject, JSC.JSValue) *Impl;
    extern fn Bun__StrongRef__get(this: *Impl) JSC.JSValue;
    extern fn Bun__StrongRef__set(this: *Impl, *JSC.JSGlobalObject, JSC.JSValue) void;
    extern fn Bun__StrongRef__clear(this: *Impl) void;
};

const bun = @import("root").bun;
const JSC = bun.JSC;
