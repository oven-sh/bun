const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const VM = JSC.VM;
const String = bun.String;

pub const JSPromise = opaque {
    pub const Status = enum(u32) {
        pending = 0, // Making this as 0, so that, we can change the status from Pending to others without masking.
        fulfilled = 1,
        rejected = 2,
    };

    extern fn JSC__JSPromise__asValue(arg0: *JSPromise, arg1: *JSGlobalObject) JSValue;
    extern fn JSC__JSPromise__create(arg0: *JSGlobalObject) *JSPromise;
    extern fn JSC__JSPromise__isHandled(arg0: *const JSPromise, arg1: *VM) bool;
    extern fn JSC__JSPromise__reject(arg0: *JSPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSPromise__rejectAsHandled(arg0: *JSPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSPromise__rejectAsHandledException(arg0: *JSPromise, arg1: *JSGlobalObject, arg2: ?*JSC.Exception) void;
    extern fn JSC__JSPromise__rejectedPromise(arg0: *JSGlobalObject, JSValue1: JSValue) *JSPromise;
    extern fn JSC__JSPromise__rejectedPromiseValue(arg0: *JSGlobalObject, JSValue1: JSValue) JSValue;
    extern fn JSC__JSPromise__resolve(arg0: *JSPromise, arg1: *JSGlobalObject, JSValue2: JSValue) void;
    extern fn JSC__JSPromise__resolvedPromise(arg0: *JSGlobalObject, JSValue1: JSValue) *JSPromise;
    extern fn JSC__JSPromise__resolvedPromiseValue(arg0: *JSGlobalObject, JSValue1: JSValue) JSValue;
    extern fn JSC__JSPromise__result(arg0: *JSPromise, arg1: *VM) JSValue;
    extern fn JSC__JSPromise__setHandled(arg0: *JSPromise, arg1: *VM) void;
    extern fn JSC__JSPromise__status(arg0: *const JSPromise, arg1: *VM) JSPromise.Status;

    pub fn Weak(comptime T: type) type {
        return struct {
            weak: JSC.Weak(T) = .{},
            const WeakType = @This();

            pub fn reject(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().reject(globalThis, val);
            }

            /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
            pub fn rejectTask(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                const loop = JSC.VirtualMachine.get().eventLoop();
                loop.enter();
                defer loop.exit();

                this.reject(globalThis, val);
            }

            pub fn resolve(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                this.swap().resolve(globalThis, val);
            }

            /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
            pub fn resolveTask(this: *WeakType, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
                const loop = JSC.VirtualMachine.get().eventLoop();
                loop.enter();
                defer loop.exit();
                this.resolve(globalThis, val);
            }

            pub fn init(
                globalThis: *JSC.JSGlobalObject,
                promise: JSValue,
                ctx: *T,
                comptime finalizer: *const fn (*T, JSC.JSValue) void,
            ) WeakType {
                return WeakType{
                    .weak = JSC.Weak(T).create(
                        promise,
                        globalThis,
                        ctx,
                        finalizer,
                    ),
                };
            }

            pub fn get(this: *const WeakType) *JSC.JSPromise {
                return this.weak.get().?.asPromise().?;
            }

            pub fn getOrNull(this: *const WeakType) ?*JSC.JSPromise {
                const promise_value = this.weak.get() orelse return null;
                return promise_value.asPromise();
            }

            pub fn value(this: *const WeakType) JSValue {
                return this.weak.get().?;
            }

            pub fn valueOrEmpty(this: *const WeakType) JSValue {
                return this.weak.get() orelse .zero;
            }

            pub fn swap(this: *WeakType) *JSC.JSPromise {
                const prom = this.weak.swap().asPromise().?;
                this.weak.deinit();
                return prom;
            }

            pub fn deinit(this: *WeakType) void {
                this.weak.clear();
                this.weak.deinit();
            }
        };
    }

    pub const Strong = struct {
        strong: JSC.Strong = .empty,

        pub const empty: Strong = .{ .strong = .empty };

        pub fn reject(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().reject(globalThis, val);
        }

        /// Like `reject`, except it drains microtasks at the end of the current event loop iteration.
        pub fn rejectTask(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.enter();
            defer loop.exit();

            this.reject(globalThis, val);
        }

        pub const rejectOnNextTick = @compileError("Either use an event loop task, or you're draining microtasks when you shouldn't be.");

        pub fn resolve(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            this.swap().resolve(globalThis, val);
        }

        /// Like `resolve`, except it drains microtasks at the end of the current event loop iteration.
        pub fn resolveTask(this: *Strong, globalThis: *JSC.JSGlobalObject, val: JSC.JSValue) void {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.enter();
            defer loop.exit();
            this.resolve(globalThis, val);
        }

        pub fn init(globalThis: *JSC.JSGlobalObject) Strong {
            return Strong{
                .strong = JSC.Strong.create(
                    JSC.JSPromise.create(globalThis).asValue(globalThis),
                    globalThis,
                ),
            };
        }

        pub fn get(this: *const Strong) *JSC.JSPromise {
            return this.strong.get().?.asPromise().?;
        }

        pub fn value(this: *const Strong) JSValue {
            return this.strong.get().?;
        }

        pub fn valueOrEmpty(this: *const Strong) JSValue {
            return this.strong.get() orelse .zero;
        }

        pub fn hasValue(this: *const Strong) bool {
            return this.strong.has();
        }

        pub fn swap(this: *Strong) *JSC.JSPromise {
            const prom = this.strong.swap().asPromise().?;
            this.strong.deinit();
            return prom;
        }

        pub fn deinit(this: *Strong) void {
            this.strong.deinit();
        }
    };

    extern fn JSC__JSPromise__wrap(*JSC.JSGlobalObject, *anyopaque, *const fn (*anyopaque, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue) JSC.JSValue;

    pub fn wrap(
        globalObject: *JSGlobalObject,
        comptime Function: anytype,
        args: std.meta.ArgsTuple(@TypeOf(Function)),
    ) JSValue {
        const Args = std.meta.ArgsTuple(@TypeOf(Function));
        const Fn = Function;
        const Wrapper = struct {
            args: Args,

            pub fn call(this: *@This(), g: *JSC.JSGlobalObject) callconv(.c) JSC.JSValue {
                return JSC.toJSHostValue(g, @call(.auto, Fn, this.args));
            }
        };

        var ctx = Wrapper{ .args = args };
        return JSC__JSPromise__wrap(globalObject, &ctx, @ptrCast(&Wrapper.call));
    }

    pub fn wrapValue(globalObject: *JSGlobalObject, value: JSValue) JSValue {
        if (value == .zero) {
            return resolvedPromiseValue(globalObject, JSValue.jsUndefined());
        } else if (value.isEmptyOrUndefinedOrNull() or !value.isCell()) {
            return resolvedPromiseValue(globalObject, value);
        }

        if (value.jsType() == .JSPromise) {
            return value;
        }

        if (value.isAnyError()) {
            return rejectedPromiseValue(globalObject, value);
        }

        return resolvedPromiseValue(globalObject, value);
    }

    pub fn status(this: *const JSPromise, vm: *VM) Status {
        return JSC__JSPromise__status(this, vm);
    }

    pub fn result(this: *JSPromise, vm: *VM) JSValue {
        return JSC__JSPromise__result(this, vm);
    }

    pub fn isHandled(this: *const JSPromise, vm: *VM) bool {
        return JSC__JSPromise__isHandled(this, vm);
    }

    pub fn setHandled(this: *JSPromise, vm: *VM) void {
        JSC__JSPromise__setHandled(this, vm);
    }

    pub fn resolvedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return JSC__JSPromise__resolvedPromise(globalThis, value);
    }

    /// Create a new promise with an already fulfilled value
    /// This is the faster function for doing that.
    pub fn resolvedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return JSC__JSPromise__resolvedPromiseValue(globalThis, value);
    }

    pub fn rejectedPromise(globalThis: *JSGlobalObject, value: JSValue) *JSPromise {
        return JSC__JSPromise__rejectedPromise(globalThis, value);
    }

    pub fn rejectedPromiseValue(globalThis: *JSGlobalObject, value: JSValue) JSValue {
        return JSC__JSPromise__rejectedPromiseValue(globalThis, value);
    }

    /// Fulfill an existing promise with the value
    /// The value can be another Promise
    /// If you want to create a new Promise that is already resolved, see JSPromise.resolvedPromiseValue
    pub fn resolve(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name = String.static("resolve");
            }
        }

        JSC__JSPromise__resolve(this, globalThis, value);
    }

    pub fn reject(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        if (comptime bun.Environment.isDebug) {
            const loop = JSC.VirtualMachine.get().eventLoop();
            loop.debug.js_call_count_outside_tick_queue += @as(usize, @intFromBool(!loop.debug.is_inside_tick_queue));
            if (loop.debug.track_last_fn_name and !loop.debug.is_inside_tick_queue) {
                loop.debug.last_fn_name = String.static("reject");
            }
        }

        JSC__JSPromise__reject(this, globalThis, value);
    }

    pub fn rejectAsHandled(this: *JSPromise, globalThis: *JSGlobalObject, value: JSValue) void {
        JSC__JSPromise__rejectAsHandled(this, globalThis, value);
    }

    pub fn create(globalThis: *JSGlobalObject) *JSPromise {
        return JSC__JSPromise__create(globalThis);
    }

    pub fn asValue(this: *JSPromise, globalThis: *JSGlobalObject) JSValue {
        return JSC__JSPromise__asValue(this, globalThis);
    }

    pub const Unwrapped = union(enum) {
        pending,
        fulfilled: JSValue,
        rejected: JSValue,
    };

    pub const UnwrapMode = enum { mark_handled, leave_unhandled };

    pub fn unwrap(promise: *JSPromise, vm: *VM, mode: UnwrapMode) Unwrapped {
        return switch (promise.status(vm)) {
            .pending => .pending,
            .fulfilled => .{ .fulfilled = promise.result(vm) },
            .rejected => {
                if (mode == .mark_handled) promise.setHandled(vm);
                return .{ .rejected = promise.result(vm) };
            },
        };
    }
};
