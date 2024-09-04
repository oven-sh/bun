const bun = @import("root").bun;
const JSC = bun.JSC;

const StrongImpl = opaque {
    pub fn init(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) *StrongImpl {
        JSC.markBinding(@src());
        return Bun__StrongRef__new(globalThis, value);
    }

    pub fn get(this: *StrongImpl) JSC.JSValue {
        JSC.markBinding(@src());
        return Bun__StrongRef__get(this);
    }

    pub fn set(this: *StrongImpl, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        Bun__StrongRef__set(this, globalThis, value);
    }

    pub fn clear(this: *StrongImpl) void {
        JSC.markBinding(@src());
        Bun__StrongRef__clear(this);
    }

    pub fn deinit(
        this: *StrongImpl,
    ) void {
        JSC.markBinding(@src());
        Bun__StrongRef__delete(this);
    }

    extern fn Bun__StrongRef__delete(this: *StrongImpl) void;
    extern fn Bun__StrongRef__new(*JSC.JSGlobalObject, JSC.JSValue) *StrongImpl;
    extern fn Bun__StrongRef__get(this: *StrongImpl) JSC.JSValue;
    extern fn Bun__StrongRef__set(this: *StrongImpl, *JSC.JSGlobalObject, JSC.JSValue) void;
    extern fn Bun__StrongRef__clear(this: *StrongImpl) void;
};

// TODO: replace Compact with Strong.
// We generally don't use the globalThis object from it.
// so we can remove that pointer.
pub const Strong = struct {
    ref: Compact = .{},
    globalThis: ?*JSC.JSGlobalObject = null,

    pub fn init() Strong {
        return .{};
    }

    pub fn call(
        this: *Strong,
        args: []const JSC.JSValue,
    ) JSC.JSValue {
        const function = this.trySwap() orelse return .zero;
        return function.call(this.globalThis.?, args);
    }

    pub fn create(
        value: JSC.JSValue,
        globalThis: *JSC.JSGlobalObject,
    ) Strong {
        if (value != .zero) {
            return .{ .ref = Compact.create(value, globalThis), .globalThis = globalThis };
        }

        return .{ .globalThis = globalThis };
    }

    pub fn get(this: *const Strong) ?JSC.JSValue {
        return this.ref.get();
    }

    pub fn swap(this: *Strong) JSC.JSValue {
        return this.ref.swap();
    }

    pub fn has(this: *Strong) bool {
        return this.ref.has();
    }

    pub fn trySwap(this: *Strong) ?JSC.JSValue {
        return this.ref.trySwap();
    }

    pub fn set(this: *Strong, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        this.ref.set(globalThis, value);
        this.globalThis = globalThis;
    }

    pub fn clear(this: *Strong) void {
        this.ref.clear();
    }

    pub fn deinit(this: *Strong) void {
        this.ref.deinit();
    }

    pub const Compact = struct {
        ref: ?*StrongImpl = null,

        pub fn init() Compact {
            return .{};
        }

        pub fn create(
            value: JSC.JSValue,
            globalThis: *JSC.JSGlobalObject,
        ) Compact {
            if (value != .zero) {
                return .{ .ref = StrongImpl.init(globalThis, value) };
            }

            return .{};
        }

        pub fn get(this: *const Compact) ?JSC.JSValue {
            var ref = this.ref orelse return null;
            const result = ref.get();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn swap(this: *Compact) JSC.JSValue {
            var ref = this.ref orelse return .zero;
            const result = ref.get();
            if (result == .zero) {
                return .zero;
            }

            ref.clear();
            return result;
        }

        pub fn has(this: *Compact) bool {
            var ref = this.ref orelse return false;
            return ref.get() != .zero;
        }

        pub fn trySwap(this: *Compact) ?JSC.JSValue {
            const result = this.swap();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn set(this: *Compact, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
            var ref: *StrongImpl = this.ref orelse {
                if (value == .zero) return;
                this.ref = StrongImpl.init(globalThis, value);
                return;
            };

            ref.set(globalThis, value);
        }

        pub fn clear(this: *Compact) void {
            var ref: *StrongImpl = this.ref orelse return;
            ref.clear();
        }

        pub fn deinit(this: *Compact) void {
            var ref: *StrongImpl = this.ref orelse return;
            this.ref = null;
            ref.deinit();
        }
    };
};
