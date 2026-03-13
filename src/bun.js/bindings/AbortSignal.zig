pub const AbortSignal = opaque {
    extern fn WebCore__AbortSignal__aborted(arg0: *AbortSignal) bool;
    extern fn WebCore__AbortSignal__abortReason(arg0: *AbortSignal) JSValue;
    extern fn WebCore__AbortSignal__addListener(arg0: *AbortSignal, arg1: ?*anyopaque, ArgFn2: ?*const fn (?*anyopaque, JSValue) callconv(.c) void) *AbortSignal;
    extern fn WebCore__AbortSignal__cleanNativeBindings(arg0: *AbortSignal, arg1: ?*anyopaque) void;
    extern fn WebCore__AbortSignal__create(arg0: *JSGlobalObject) JSValue;
    extern fn WebCore__AbortSignal__fromJS(JSValue0: JSValue) ?*AbortSignal;
    extern fn WebCore__AbortSignal__ref(arg0: *AbortSignal) *AbortSignal;
    extern fn WebCore__AbortSignal__toJS(arg0: *AbortSignal, arg1: *JSGlobalObject) JSValue;
    extern fn WebCore__AbortSignal__unref(arg0: *AbortSignal) void;
    extern fn WebCore__AbortSignal__getTimeout(arg0: *AbortSignal) ?*Timeout;
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
            ) callconv(.c) void {
                const val = bun.cast(*Context, ptr.?);
                call(val, reason);
            }
        };

        return this.addListener(@as(?*anyopaque, @ptrCast(ctx)), Wrapper.callback);
    }

    pub fn addListener(
        this: *AbortSignal,
        ctx: ?*anyopaque,
        callback: *const fn (?*anyopaque, JSValue) callconv(.c) void,
    ) *AbortSignal {
        return WebCore__AbortSignal__addListener(this, ctx, callback);
    }

    pub fn cleanNativeBindings(this: *AbortSignal, ctx: ?*anyopaque) void {
        return WebCore__AbortSignal__cleanNativeBindings(this, ctx);
    }

    extern fn WebCore__AbortSignal__signal(*AbortSignal, *jsc.JSGlobalObject, CommonAbortReason) void;

    pub fn signal(
        this: *AbortSignal,
        globalObject: *jsc.JSGlobalObject,
        reason: CommonAbortReason,
    ) void {
        bun.analytics.Features.abort_signal += 1;
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

    extern fn WebCore__AbortSignal__reasonIfAborted(*AbortSignal, *jsc.JSGlobalObject, *u8) JSValue;

    pub const AbortReason = union(enum) {
        common: CommonAbortReason,
        js: JSValue,

        pub fn toBodyValueError(this: AbortReason, globalObject: *jsc.JSGlobalObject) jsc.WebCore.Body.Value.ValueError {
            return switch (this) {
                .common => |reason| .{ .AbortReason = reason },
                .js => |value| .{ .JSValue = .create(value, globalObject) },
            };
        }

        pub fn toJS(this: AbortReason, global: *jsc.JSGlobalObject) JSValue {
            return switch (this) {
                .common => |reason| reason.toJS(global),
                .js => |value| value,
            };
        }
    };

    pub fn reasonIfAborted(this: *AbortSignal, global: *jsc.JSGlobalObject) ?AbortReason {
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
        jsc.markBinding(@src());
        return WebCore__AbortSignal__new(global);
    }

    /// Returns a borrowed handle to the internal Timeout, or null.
    ///
    /// Lifetime: owned by AbortSignal; may become invalid if the timer fires/cancels.
    ///
    /// Thread-safety: not thread-safe; call only on the owning thread/loop.
    ///
    /// Usage: if you need to operate on the Timeout (run/cancel/deinit), hold a ref
    /// to `this` for the duration (e.g., `this.ref(); defer this.unref();`) and avoid
    /// caching the pointer across turns.
    pub fn getTimeout(this: *AbortSignal) ?*Timeout {
        return WebCore__AbortSignal__getTimeout(this);
    }

    pub const Timeout = struct {
        event_loop_timer: jsc.API.Timer.EventLoopTimer,

        // The `Timeout`'s lifetime is owned by the AbortSignal.
        // But this does have a ref count increment.
        signal: *AbortSignal,

        /// "epoch" is reused.
        flags: jsc.API.Timer.TimerObjectInternals.Flags = .{},

        const new = bun.TrivialNew(Timeout);

        fn init(vm: *jsc.VirtualMachine, signal_: *AbortSignal, milliseconds: u64) *Timeout {
            const this: *Timeout = .new(.{
                .signal = signal_,
                .event_loop_timer = .{
                    .next = bun.timespec.now(.allow_mocked_time).addMs(@intCast(milliseconds)),
                    .tag = .AbortSignalTimeout,
                    .state = .CANCELLED,
                },
            });

            if (comptime bun.Environment.ci_assert) {
                if (signal_.aborted()) {
                    @panic("unreachable: signal is already aborted");
                }
            }

            // We default to not keeping the event loop alive with this timeout.
            vm.timer.insert(&this.event_loop_timer);

            return this;
        }

        fn cancel(this: *Timeout, vm: *jsc.VirtualMachine) void {
            if (this.event_loop_timer.state == .ACTIVE) {
                vm.timer.remove(&this.event_loop_timer);
            }
        }

        pub fn run(this: *Timeout, vm: *jsc.VirtualMachine) void {
            this.event_loop_timer.state = .FIRED;
            this.cancel(vm);

            // Dispatching the signal may cause the Timeout to get freed.
            dispatch(vm, this.signal);
        }

        fn dispatch(vm: *jsc.VirtualMachine, signal_ptr: *AbortSignal) void {
            const loop = vm.eventLoop();
            loop.enter();
            defer loop.exit();
            signal_ptr.signal(vm.global, .Timeout);
            signal_ptr.unref();
        }

        // This may run inside the "signal" call.
        fn deinit(this: *Timeout, vm: *jsc.VirtualMachine) void {
            this.cancel(vm);
            bun.destroy(this);
        }

        /// Caller is expected to have already ref'd the AbortSignal.
        export fn AbortSignal__Timeout__create(vm: *jsc.VirtualMachine, signal_: *AbortSignal, milliseconds: u64) *Timeout {
            return Timeout.init(vm, signal_, milliseconds);
        }

        export fn AbortSignal__Timeout__run(this: *Timeout, vm: *jsc.VirtualMachine) void {
            this.run(vm);
        }

        export fn AbortSignal__Timeout__deinit(this: *Timeout, vm: *jsc.VirtualMachine) void {
            this.deinit(vm);
        }
    };
};

const bun = @import("bun");
const CommonAbortReason = @import("./CommonAbortReason.zig").CommonAbortReason;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
