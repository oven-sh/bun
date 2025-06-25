const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CommonAbortReason = @import("CommonAbortReason.zig").CommonAbortReason;

pub const AbortSignal = opaque {
    extern fn WebCore__AbortSignal__aborted(arg0: *AbortSignal) bool;
    extern fn WebCore__AbortSignal__abortReason(arg0: *AbortSignal) JSValue;
    extern fn WebCore__AbortSignal__addListener(arg0: *AbortSignal, arg1: ?*anyopaque, ArgFn2: ?*const fn (?*anyopaque, JSValue) callconv(.C) void) *AbortSignal;
    extern fn WebCore__AbortSignal__cleanNativeBindings(arg0: *AbortSignal, arg1: ?*anyopaque) void;
    extern fn WebCore__AbortSignal__create(arg0: *JSGlobalObject) JSValue;
    extern fn WebCore__AbortSignal__fromJS(JSValue0: JSValue) ?*AbortSignal;
    extern fn WebCore__AbortSignal__ref(arg0: *AbortSignal) *AbortSignal;
    extern fn WebCore__AbortSignal__toJS(arg0: *AbortSignal, arg1: *JSGlobalObject) JSValue;
    extern fn WebCore__AbortSignal__unref(arg0: *AbortSignal) void;

    pub fn listen(
        this: *AbortSignal,
        comptime Context: type,
        ctx: *Context,
        comptime cb: *const fn (*Context, JSValue) void,
    ) *AbortSignal {
        const Wrapper = struct {
            const call = cb;
            pub fn callback(
                ptr: ?*anyopaque,
                reason: JSValue,
            ) callconv(.C) void {
                const val = bun.cast(*Context, ptr.?);
                call(val, reason);
            }
        };

        return this.addListener(@as(?*anyopaque, @ptrCast(ctx)), Wrapper.callback);
    }

    pub fn addListener(
        this: *AbortSignal,
        ctx: ?*anyopaque,
        callback: *const fn (?*anyopaque, JSValue) callconv(.C) void,
    ) *AbortSignal {
        return WebCore__AbortSignal__addListener(this, ctx, callback);
    }

    pub fn cleanNativeBindings(this: *AbortSignal, ctx: ?*anyopaque) void {
        return WebCore__AbortSignal__cleanNativeBindings(this, ctx);
    }

    extern fn WebCore__AbortSignal__signal(*AbortSignal, *JSC.JSGlobalObject, CommonAbortReason) void;

    pub fn signal(
        this: *AbortSignal,
        globalObject: *JSC.JSGlobalObject,
        reason: CommonAbortReason,
    ) void {
        bun.Analytics.Features.abort_signal += 1;
        return WebCore__AbortSignal__signal(this, globalObject, reason);
    }

    extern fn WebCore__AbortSignal__incrementPendingActivity(*AbortSignal) void;
    extern fn WebCore__AbortSignal__decrementPendingActivity(*AbortSignal) void;

    pub fn pendingActivityRef(this: *AbortSignal) void {
        return WebCore__AbortSignal__incrementPendingActivity(this);
    }

    pub fn pendingActivityUnref(this: *AbortSignal) void {
        return WebCore__AbortSignal__decrementPendingActivity(this);
    }

    /// This function is not threadsafe. aborted is a boolean, not an atomic!
    pub fn aborted(this: *AbortSignal) bool {
        return WebCore__AbortSignal__aborted(this);
    }

    /// This function is not threadsafe. JSValue cannot safely be passed between threads.
    pub fn abortReason(this: *AbortSignal) JSValue {
        return WebCore__AbortSignal__abortReason(this);
    }

    extern fn WebCore__AbortSignal__reasonIfAborted(*AbortSignal, *JSC.JSGlobalObject, *u8) JSValue;

    pub const AbortReason = union(enum) {
        common: CommonAbortReason,
        js: JSValue,

        pub fn toBodyValueError(this: AbortReason, globalObject: *JSC.JSGlobalObject) JSC.WebCore.Body.Value.ValueError {
            return switch (this) {
                .common => |reason| .{ .AbortReason = reason },
                .js => |value| .{ .JSValue = .create(value, globalObject) },
            };
        }

        pub fn toJS(this: AbortReason, global: *JSC.JSGlobalObject) JSValue {
            return switch (this) {
                .common => |reason| reason.toJS(global),
                .js => |value| value,
            };
        }
    };

    pub fn reasonIfAborted(this: *AbortSignal, global: *JSC.JSGlobalObject) ?AbortReason {
        var reason: u8 = 0;
        const js_reason = WebCore__AbortSignal__reasonIfAborted(this, global, &reason);
        if (reason > 0) {
            bun.debugAssert(js_reason.isUndefined());
            return .{ .common = @enumFromInt(reason) };
        }
        if (js_reason == .zero) {
            return null; // not aborted
        }
        return .{ .js = js_reason };
    }

    pub fn ref(this: *AbortSignal) *AbortSignal {
        return WebCore__AbortSignal__ref(this);
    }

    pub fn unref(this: *AbortSignal) void {
        WebCore__AbortSignal__unref(this);
    }

    pub fn detach(this: *AbortSignal, ctx: ?*anyopaque) void {
        this.cleanNativeBindings(ctx);
        this.unref();
    }

    pub fn fromJS(value: JSValue) ?*AbortSignal {
        return WebCore__AbortSignal__fromJS(value);
    }

    pub fn toJS(this: *AbortSignal, global: *JSGlobalObject) JSValue {
        return WebCore__AbortSignal__toJS(this, global);
    }

    pub fn create(global: *JSGlobalObject) JSValue {
        return WebCore__AbortSignal__create(global);
    }

    extern fn WebCore__AbortSignal__new(*JSGlobalObject) *AbortSignal;
    pub fn new(global: *JSGlobalObject) *AbortSignal {
        JSC.markBinding(@src());
        return WebCore__AbortSignal__new(global);
    }
};
