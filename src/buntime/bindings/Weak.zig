pub const WeakRefType = enum(u32) {
    None = 0,
    FetchResponse = 1,
    PostgreSQLQueryClient = 2,
};
const WeakImpl = opaque {
    pub fn init(globalThis: *jsc.JSGlobalObject, value: jsc.JSValue, refType: WeakRefType, ctx: ?*anyopaque) *WeakImpl {
        jsc.markBinding(@src());
        return Bun__WeakRef__new(globalThis, value, refType, ctx);
    }

    pub fn get(this: *WeakImpl) jsc.JSValue {
        jsc.markBinding(@src());
        return Bun__WeakRef__get(this);
    }

    pub fn clear(this: *WeakImpl) void {
        jsc.markBinding(@src());
        Bun__WeakRef__clear(this);
    }

    pub fn deinit(
        this: *WeakImpl,
    ) void {
        jsc.markBinding(@src());
        Bun__WeakRef__delete(this);
    }

    extern fn Bun__WeakRef__delete(this: *WeakImpl) void;
    extern fn Bun__WeakRef__new(*jsc.JSGlobalObject, jsc.JSValue, refType: WeakRefType, ctx: ?*anyopaque) *WeakImpl;
    extern fn Bun__WeakRef__get(this: *WeakImpl) jsc.JSValue;
    extern fn Bun__WeakRef__clear(this: *WeakImpl) void;
};

pub fn Weak(comptime T: type) type {
    return struct {
        ref: ?*WeakImpl = null,
        globalThis: ?*jsc.JSGlobalObject = null,
        const WeakType = @This();

        pub fn init() WeakType {
            return .{};
        }

        pub fn call(
            this: *WeakType,
            args: []const jsc.JSValue,
        ) jsc.JSValue {
            const function = this.trySwap() orelse return .zero;
            return function.call(this.globalThis.?, args);
        }

        pub fn create(
            value: jsc.JSValue,
            globalThis: *jsc.JSGlobalObject,
            refType: WeakRefType,
            ctx: *T,
        ) WeakType {
            if (value != .zero) {
                return .{ .ref = WeakImpl.init(globalThis, value, refType, ctx), .globalThis = globalThis };
            }

            return .{ .globalThis = globalThis };
        }

        pub fn get(this: *const WeakType) ?jsc.JSValue {
            var ref = this.ref orelse return null;
            const result = ref.get();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn swap(this: *WeakType) jsc.JSValue {
            var ref = this.ref orelse return .zero;
            const result = ref.get();
            if (result == .zero) {
                return .zero;
            }

            ref.clear();
            return result;
        }

        pub fn has(this: *WeakType) bool {
            var ref = this.ref orelse return false;
            return ref.get() != .zero;
        }

        pub fn trySwap(this: *WeakType) ?jsc.JSValue {
            const result = this.swap();
            if (result == .zero) {
                return null;
            }

            return result;
        }

        pub fn clear(this: *WeakType) void {
            var ref: *WeakImpl = this.ref orelse return;
            ref.clear();
        }

        pub fn deinit(this: *WeakType) void {
            var ref: *WeakImpl = this.ref orelse return;
            this.ref = null;
            ref.deinit();
        }
    };
}

const bun = @import("bun");
const jsc = bun.jsc;
