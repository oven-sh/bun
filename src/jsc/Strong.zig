//! Holds a strong reference to a JS value, protecting it from garbage
//! collection. This type implies there is always a valid value held.
//! For a strong that may be empty (to reuse allocation), use `Strong.Optional`.

const Strong = @This();

impl: *Impl,

/// Hold a strong reference to a JavaScript value. Release with `deinit` or `clear`
pub fn create(value: jsc.JSValue, global: *jsc.JSGlobalObject) Strong {
    if (bun.Environment.allow_assert) bun.assert(value != .zero);
    return .{ .impl = .init(global, value) };
}

/// Release the strong reference.
pub fn deinit(strong: *Strong) void {
    strong.impl.deinit();
    if (bun.Environment.isDebug)
        strong.* = undefined;
}

pub fn get(strong: *const Strong) jsc.JSValue {
    const result = strong.impl.get();
    if (bun.Environment.allow_assert) bun.assert(result != .zero);
    return result;
}

/// Set a new value for the strong reference.
pub fn set(strong: *Strong, global: *jsc.JSGlobalObject, new_value: jsc.JSValue) void {
    if (bun.Environment.allow_assert) bun.assert(new_value != .zero);
    strong.impl.set(global, new_value);
}

/// Swap a new value for the strong reference.
pub fn swap(strong: *Strong, global: *jsc.JSGlobalObject, new_value: jsc.JSValue) jsc.JSValue {
    const result = strong.impl.get();
    strong.set(global, new_value);
    return result;
}

/// Holds a strong reference to a JS value, protecting it from garbage
/// collection. When not holding a value, the strong may still be allocated.
pub const Optional = struct {
    impl: ?*Impl,

    pub const empty: Optional = .{ .impl = null };

    /// Hold a strong reference to a JavaScript value. Release with `deinit` or `clear`
    pub fn create(value: jsc.JSValue, global: *jsc.JSGlobalObject) Optional {
        return if (value != .zero)
            .{ .impl = .init(global, value) }
        else
            .empty;
    }

    /// Frees memory for the underlying Strong reference.
    pub fn deinit(strong: *Optional) void {
        const ref: *Impl = strong.impl orelse return;
        strong.* = .empty;
        ref.deinit();
    }

    /// Clears the value, but does not de-allocate the Strong reference.
    pub fn clearWithoutDeallocation(strong: *Optional) void {
        const ref: *Impl = strong.impl orelse return;
        ref.clear();
    }

    pub fn call(this: *Optional, global: *jsc.JSGlobalObject, args: []const jsc.JSValue) jsc.JSValue {
        const function = this.trySwap() orelse return .zero;
        return function.call(global, args);
    }

    pub fn get(this: *const Optional) ?jsc.JSValue {
        const impl = this.impl orelse return null;
        const result = impl.get();
        if (result == .zero) {
            return null;
        }
        return result;
    }

    pub fn swap(strong: *Optional) jsc.JSValue {
        const impl = strong.impl orelse return .zero;
        const result = impl.get();
        if (result == .zero) {
            return .zero;
        }
        impl.clear();
        return result;
    }

    pub fn has(this: *const Optional) bool {
        var ref = this.impl orelse return false;
        return ref.get() != .zero;
    }

    pub fn trySwap(this: *Optional) ?jsc.JSValue {
        const result = this.swap();
        if (result == .zero) {
            return null;
        }

        return result;
    }

    pub fn set(strong: *Optional, global: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        const ref: *Impl = strong.impl orelse {
            if (value == .zero) return;
            strong.impl = Impl.init(global, value);
            return;
        };
        ref.set(global, value);
    }
};

pub const Impl = opaque {
    pub fn init(global: *jsc.JSGlobalObject, value: jsc.JSValue) *Impl {
        jsc.markBinding(@src());
        return Bun__StrongRef__new(global, value);
    }

    pub fn get(this: *Impl) jsc.JSValue {
        // `this` is actually a pointer to a `JSC::JSValue`; see Strong.cpp.
        const js_value: *jsc.DecodedJSValue = @ptrCast(@alignCast(this));
        return js_value.encode();
    }

    pub fn set(this: *Impl, global: *jsc.JSGlobalObject, value: jsc.JSValue) void {
        jsc.markBinding(@src());
        Bun__StrongRef__set(this, global, value);
    }

    pub fn clear(this: *Impl) void {
        jsc.markBinding(@src());
        Bun__StrongRef__clear(this);
    }

    pub fn deinit(this: *Impl) void {
        jsc.markBinding(@src());
        Bun__StrongRef__delete(this);
    }

    extern fn Bun__StrongRef__delete(this: *Impl) void;
    extern fn Bun__StrongRef__new(*jsc.JSGlobalObject, jsc.JSValue) *Impl;
    extern fn Bun__StrongRef__set(this: *Impl, *jsc.JSGlobalObject, jsc.JSValue) void;
    extern fn Bun__StrongRef__clear(this: *Impl) void;
};

pub const Deprecated = @import("./DeprecatedStrong.zig");

const bun = @import("bun");
const jsc = bun.jsc;
