const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Debugger = JSC.Debugger;
const Environment = bun.Environment;
const Async = @import("async");
const uv = bun.windows.libuv;
const StatWatcherScheduler = @import("../node/node_fs_stat_watcher.zig").StatWatcherScheduler;
const Timer = @This();
const DNSResolver = @import("./bun/dns_resolver.zig").DNSResolver;

/// TimeoutMap is map of i32 to nullable Timeout structs
/// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
/// When Timeout is null, it means the tasks have been scheduled but not yet executed.
/// Timeouts are enqueued as a task to be run on the next tick of the task queue
/// The task queue runs after the event loop tasks have been run
/// Therefore, there is a race condition where you cancel the task after it has already been enqueued
/// In that case, it shouldn't run. It should be skipped.
pub const TimeoutMap = std.AutoArrayHashMapUnmanaged(
    i32,
    *EventLoopTimer,
);

const TimerHeap = heap.Intrusive(EventLoopTimer, void, EventLoopTimer.less);

pub const All = struct {
    last_id: i32 = 1,
    lock: bun.Mutex = .{},
    thread_id: std.Thread.Id,
    timers: TimerHeap = .{
        .context = {},
    },
    active_timer_count: i32 = 0,
    uv_timer: if (Environment.isWindows) uv.Timer else void = if (Environment.isWindows) std.mem.zeroes(uv.Timer),

    // We split up the map here to avoid storing an extra "repeat" boolean
    maps: struct {
        setTimeout: TimeoutMap = .{},
        setInterval: TimeoutMap = .{},
        setImmediate: TimeoutMap = .{},

        pub inline fn get(this: *@This(), kind: Kind) *TimeoutMap {
            return switch (kind) {
                .setTimeout => &this.setTimeout,
                .setInterval => &this.setInterval,
                .setImmediate => &this.setImmediate,
            };
        }
    } = .{},

    pub fn init() @This() {
        return .{
            .thread_id = std.Thread.getCurrentId(),
        };
    }

    pub fn insert(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.timers.insert(timer);
        timer.state = .ACTIVE;

        if (Environment.isWindows) {
            this.ensureUVTimer(@alignCast(@fieldParentPtr("timer", this)));
        }
    }

    pub fn remove(this: *All, timer: *EventLoopTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.timers.remove(timer);

        timer.state = .CANCELLED;
        timer.heap = .{};
    }

    /// Remove the EventLoopTimer if necessary.
    pub fn update(this: *All, timer: *EventLoopTimer, time: *const timespec) void {
        this.lock.lock();
        defer this.lock.unlock();
        if (timer.state == .ACTIVE) {
            this.timers.remove(timer);
        }

        timer.state = .ACTIVE;
        if (comptime Environment.isDebug) {
            if (&timer.next == time) {
                @panic("timer.next == time. For threadsafety reasons, time and timer.next must always be a different pointer.");
            }
        }
        timer.next = time.*;

        this.timers.insert(timer);
        if (Environment.isWindows) {
            this.ensureUVTimer(@alignCast(@fieldParentPtr("timer", this)));
        }
    }

    fn ensureUVTimer(this: *All, vm: *VirtualMachine) void {
        if (this.uv_timer.data == null) {
            this.uv_timer.init(vm.uvLoop());
            this.uv_timer.data = vm;
            this.uv_timer.unref();
        }

        if (this.timers.peek()) |timer| {
            uv.uv_update_time(vm.uvLoop());
            const now = timespec.now();
            const wait = if (timer.next.greater(&now))
                timer.next.duration(&now)
            else
                timespec{ .nsec = 0, .sec = 0 };

            this.uv_timer.start(wait.msUnsigned(), 0, &onUVTimer);

            if (this.active_timer_count > 0) {
                this.uv_timer.ref();
            } else {
                this.uv_timer.unref();
            }
        }
    }

    pub fn onUVTimer(uv_timer_t: *uv.Timer) callconv(.C) void {
        const all: *All = @fieldParentPtr("uv_timer", uv_timer_t);
        const vm: *VirtualMachine = @alignCast(@fieldParentPtr("timer", all));
        all.drainTimers(vm);
        all.ensureUVTimer(vm);
    }

    pub fn incrementTimerRef(this: *All, delta: i32) void {
        const vm: *JSC.VirtualMachine = @alignCast(@fieldParentPtr("timer", this));

        const old = this.active_timer_count;
        const new = old + delta;

        if (comptime Environment.isDebug) {
            assert(new >= 0);
        }

        this.active_timer_count = new;

        if (old <= 0 and new > 0) {
            if (comptime Environment.isWindows) {
                this.uv_timer.ref();
            } else {
                vm.uwsLoop().ref();
            }
        } else if (old > 0 and new <= 0) {
            if (comptime Environment.isWindows) {
                this.uv_timer.unref();
            } else {
                vm.uwsLoop().unref();
            }
        }
    }

    pub fn getNextID() callconv(.C) i32 {
        VirtualMachine.get().timer.last_id +%= 1;
        return VirtualMachine.get().timer.last_id;
    }

    pub fn getTimeout(this: *All, spec: *timespec, vm: *VirtualMachine) bool {
        if (this.active_timer_count == 0) {
            return false;
        }

        var now: timespec = undefined;
        var has_set_now: bool = false;
        while (this.timers.peek()) |min| {
            if (!has_set_now) {
                now = timespec.now();
                has_set_now = true;
            }

            switch (now.order(&min.next)) {
                .gt, .eq => {
                    // Side-effect: potentially call the StopIfNecessary timer.
                    if (min.tag == .WTFTimer) {
                        _ = this.timers.deleteMin();
                        _ = min.fire(&now, vm);
                        continue;
                    }

                    spec.* = .{ .nsec = 0, .sec = 0 };
                    return true;
                },
                .lt => {
                    spec.* = min.next.duration(&now);
                    return true;
                },
            }

            unreachable;
        }

        return false;
    }

    export fn Bun__internal_drainTimers(vm: *VirtualMachine) callconv(.C) void {
        drainTimers(&vm.timer, vm);
    }

    comptime {
        _ = &Bun__internal_drainTimers;
    }

    // Getting the current time is expensive on certain platforms.
    // We don't want to call it when there are no timers.
    // And when we do call it, we want to be sure we only call it once.
    // and we do NOT want to hold the lock while the timer is running it's code.
    // This function has to be thread-safe.
    fn next(this: *All, has_set_now: *bool, now: *timespec) ?*EventLoopTimer {
        this.lock.lock();
        defer this.lock.unlock();

        if (this.timers.peek()) |timer| {
            if (!has_set_now.*) {
                now.* = timespec.now();
                has_set_now.* = true;
            }
            if (timer.next.greater(now)) {
                return null;
            }

            assert(this.timers.deleteMin().? == timer);

            return timer;
        }
        return null;
    }

    pub fn drainTimers(this: *All, vm: *VirtualMachine) void {
        // Set in next().
        var now: timespec = undefined;
        // Split into a separate variable to avoid increasing the size of the timespec type.
        var has_set_now: bool = false;

        while (this.next(&has_set_now, &now)) |t| {
            switch (t.fire(
                &now,
                vm,
            )) {
                .disarm => {},
                .rearm => {},
            }
        }
    }

    fn set(
        id: i32,
        globalThis: *JSGlobalObject,
        callback: JSValue,
        interval: i32,
        arguments_array_or_zero: JSValue,
        repeat: bool,
    ) !JSC.JSValue {
        JSC.markBinding(@src());
        var vm = globalThis.bunVM();

        const kind: Kind = if (repeat) .setInterval else .setTimeout;

        // setImmediate(foo)
        if (kind == .setTimeout and interval == 0) {
            const timer_object, const timer_js = TimerObject.init(globalThis, vm, id, .setImmediate, 0, callback, arguments_array_or_zero);
            timer_object.ref();
            vm.enqueueImmediateTask(JSC.Task.init(timer_object));
            if (vm.isInspectorEnabled()) {
                Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
            }
            return timer_js;
        }

        const timer_object, const timer_js = TimerObject.init(globalThis, vm, id, kind, interval, callback, arguments_array_or_zero);
        _ = timer_object; // autofix

        if (vm.isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
        }

        return timer_js;
    }

    pub fn setImmediate(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        arguments: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const id = globalThis.bunVM().timer.last_id;
        globalThis.bunVM().timer.last_id +%= 1;

        const interval: i32 = 0;

        const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

        return set(id, globalThis, wrappedCallback, interval, arguments, false) catch
            return JSValue.jsUndefined();
    }

    comptime {
        @export(setImmediate, .{ .name = "Bun__Timer__setImmediate" });
    }

    pub fn setTimeout(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
        arguments: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const id = globalThis.bunVM().timer.last_id;
        globalThis.bunVM().timer.last_id +%= 1;

        const interval: i32 = @max(
            countdown.coerce(i32, globalThis),
            // It must be 1 at minimum or setTimeout(cb, 0) will seemingly hang
            1,
        );

        const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

        return set(id, globalThis, wrappedCallback, interval, arguments, false) catch
            return JSValue.jsUndefined();
    }
    pub fn setInterval(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
        arguments: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const id = globalThis.bunVM().timer.last_id;
        globalThis.bunVM().timer.last_id +%= 1;

        const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        const interval: i32 = @max(
            countdown.coerce(i32, globalThis),
            1,
        );
        return set(id, globalThis, wrappedCallback, interval, arguments, true) catch
            return JSValue.jsUndefined();
    }

    pub fn clearTimer(timer_id_value: JSValue, globalThis: *JSGlobalObject, repeats: bool) void {
        JSC.markBinding(@src());

        const kind: Kind = if (repeats) .setInterval else .setTimeout;
        var vm = globalThis.bunVM();
        var map = vm.timer.maps.get(kind);

        const timer: *TimerObject = brk: {
            if (timer_id_value.isAnyInt()) {
                if (map.fetchSwapRemove(timer_id_value.coerce(i32, globalThis))) |entry| {
                    // Don't forget to check the type tag.
                    // When we start using this list of timers for more things
                    // It would be a weird situation, security-wise, if we were to let
                    // the user cancel a timer that was of a different type.
                    if (entry.value.tag == .TimerObject) {
                        break :brk @as(
                            *TimerObject,
                            @fieldParentPtr("event_loop_timer", entry.value),
                        );
                    }
                }

                break :brk null;
            }

            break :brk TimerObject.fromJS(timer_id_value);
        } orelse return;

        timer.cancel(vm);
    }

    pub fn clearTimeout(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        clearTimer(id, globalThis, false);
        return JSValue.jsUndefined();
    }
    pub fn clearInterval(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        clearTimer(id, globalThis, true);
        return JSValue.jsUndefined();
    }

    const Shimmer = @import("../bindings/shimmer.zig").Shimmer;

    pub const shim = Shimmer("Bun", "Timer", @This());
    pub const name = "Bun__Timer";
    pub const include = "";
    pub const namespace = shim.namespace;

    pub const Export = shim.exportFunctions(.{
        .setTimeout = setTimeout,
        .setInterval = setInterval,
        .clearTimeout = clearTimeout,
        .clearInterval = clearInterval,
        .getNextID = getNextID,
    });

    comptime {
        @export(setTimeout, .{ .name = Export[0].symbol_name });
        @export(setInterval, .{ .name = Export[1].symbol_name });
        @export(clearTimeout, .{ .name = Export[2].symbol_name });
        @export(clearInterval, .{ .name = Export[3].symbol_name });
        @export(getNextID, .{ .name = Export[4].symbol_name });
    }
};

const uws = bun.uws;

pub const TimerObject = struct {
    id: i32 = -1,
    kind: Kind = .setTimeout,
    interval: i32 = 0,
    // we do not allow the timer to be refreshed after we call clearInterval/clearTimeout
    has_cleared_timer: bool = false,
    is_keeping_event_loop_alive: bool = false,

    // if they never access the timer by integer, don't create a hashmap entry.
    has_accessed_primitive: bool = false,

    strong_this: JSC.Strong = .{},

    has_js_ref: bool = true,
    ref_count: u32 = 1,

    event_loop_timer: EventLoopTimer = .{
        .next = .{},
        .tag = .TimerObject,
    },

    pub usingnamespace JSC.Codegen.JSTimeout;
    pub usingnamespace bun.NewRefCounted(@This(), deinit);

    extern "C" fn Bun__JSTimeout__call(encodedTimeoutValue: JSValue, globalObject: *JSC.JSGlobalObject) void;

    pub fn runImmediateTask(this: *TimerObject, vm: *VirtualMachine) void {
        if (this.has_cleared_timer) {
            this.deref();
            return;
        }

        const this_object = this.strong_this.get() orelse {
            if (Environment.isDebug) {
                @panic("TimerObject.runImmediateTask: this_object is null");
            }
            return;
        };
        const globalThis = this.strong_this.globalThis.?;
        this.strong_this.deinit();
        this.event_loop_timer.state = .FIRED;

        vm.eventLoop().enter();
        {
            this.ref();
            defer this.deref();

            run(this_object, globalThis, this.asyncID(), vm);

            if (this.event_loop_timer.state == .FIRED) {
                this.deref();
            }
        }
        vm.eventLoop().exit();
    }

    pub fn asyncID(this: *const TimerObject) u64 {
        return ID.asyncID(.{ .id = this.id, .kind = this.kind });
    }

    pub fn fire(this: *TimerObject, _: *const timespec, vm: *JSC.VirtualMachine) EventLoopTimer.Arm {
        const id = this.id;
        const kind = this.kind;
        const has_been_cleared = this.event_loop_timer.state == .CANCELLED or this.has_cleared_timer or vm.scriptExecutionStatus() != .running;

        this.event_loop_timer.state = .FIRED;
        this.event_loop_timer.heap = .{};

        if (has_been_cleared) {
            if (vm.isInspectorEnabled()) {
                if (this.strong_this.globalThis) |globalThis| {
                    Debugger.didCancelAsyncCall(globalThis, .DOMTimer, ID.asyncID(.{ .id = id, .kind = kind }));
                }
            }

            this.has_cleared_timer = true;
            this.strong_this.deinit();
            this.deref();

            return .disarm;
        }

        const globalThis = this.strong_this.globalThis.?;
        const this_object = this.strong_this.get().?;
        var time_before_call: timespec = undefined;

        if (kind != .setInterval) {
            this.strong_this.clear();
        } else {
            time_before_call = timespec.msFromNow(this.interval);
        }
        this_object.ensureStillAlive();

        vm.eventLoop().enter();
        {
            // Ensure it stays alive for this scope.
            this.ref();
            defer this.deref();

            run(this_object, globalThis, ID.asyncID(.{ .id = id, .kind = kind }), vm);

            var is_timer_done = false;

            // Node doesn't drain microtasks after each timer callback.
            if (kind == .setInterval) {
                switch (this.event_loop_timer.state) {
                    .FIRED => {
                        // If we didn't clear the setInterval, reschedule it starting from
                        vm.timer.update(&this.event_loop_timer, &time_before_call);

                        if (this.has_js_ref) {
                            this.setEnableKeepingEventLoopAlive(vm, true);
                        }

                        // The ref count doesn't change. It wasn't decremented.
                    },
                    .ACTIVE => {
                        // The developer called timer.refresh() synchronously in the callback.
                        vm.timer.update(&this.event_loop_timer, &time_before_call);

                        // Balance out the ref count.
                        // the transition from "FIRED" -> "ACTIVE" caused it to increment.
                        this.deref();
                    },
                    else => {
                        is_timer_done = true;
                    },
                }
            } else if (this.event_loop_timer.state == .FIRED) {
                is_timer_done = true;
            }

            if (is_timer_done) {
                if (this.is_keeping_event_loop_alive) {
                    this.is_keeping_event_loop_alive = false;

                    switch (this.kind) {
                        .setTimeout, .setInterval => {
                            vm.timer.incrementTimerRef(-1);
                        },
                        else => {},
                    }
                }

                // The timer will not be re-entered into the event loop at this point.
                this.deref();
            }
        }
        vm.eventLoop().exit();

        return .disarm;
    }

    pub fn run(this_object: JSC.JSValue, globalThis: *JSC.JSGlobalObject, async_id: u64, vm: *JSC.VirtualMachine) void {
        if (vm.isInspectorEnabled()) {
            Debugger.willDispatchAsyncCall(globalThis, .DOMTimer, async_id);
        }

        defer {
            if (vm.isInspectorEnabled()) {
                Debugger.didDispatchAsyncCall(globalThis, .DOMTimer, async_id);
            }
        }

        // Bun__JSTimeout__call handles exceptions.
        Bun__JSTimeout__call(this_object, globalThis);
    }

    pub fn init(globalThis: *JSGlobalObject, vm: *VirtualMachine, id: i32, kind: Kind, interval: i32, callback: JSValue, arguments: JSValue) struct { *TimerObject, JSValue } {
        var timer = TimerObject.new(.{
            .id = id,
            .kind = kind,
            .interval = interval,
        });
        var timer_js = timer.toJS(globalThis);
        timer_js.ensureStillAlive();
        if (arguments != .zero)
            TimerObject.argumentsSetCached(timer_js, globalThis, arguments);
        TimerObject.callbackSetCached(timer_js, globalThis, callback);
        timer_js.ensureStillAlive();
        timer.strong_this.set(globalThis, timer_js);
        if (kind != .setImmediate) {
            timer.reschedule(vm);
        }
        return .{ timer, timer_js };
    }

    pub fn doRef(this: *TimerObject, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const this_value = callframe.this();
        this_value.ensureStillAlive();

        const did_have_js_ref = this.has_js_ref;
        this.has_js_ref = true;

        if (!did_have_js_ref) {
            this.setEnableKeepingEventLoopAlive(JSC.VirtualMachine.get(), true);
        }

        return this_value;
    }

    pub fn doRefresh(this: *TimerObject, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const this_value = callframe.this();

        // setImmediate does not support refreshing and we do not support refreshing after cleanup
        if (this.id == -1 or this.kind == .setImmediate or this.has_cleared_timer) {
            return this_value;
        }

        this.strong_this.set(globalObject, this_value);
        this.reschedule(VirtualMachine.get());

        return this_value;
    }

    pub fn doUnref(this: *TimerObject, _: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const this_value = callframe.this();
        this_value.ensureStillAlive();

        const did_have_js_ref = this.has_js_ref;
        this.has_js_ref = false;

        if (did_have_js_ref) {
            this.setEnableKeepingEventLoopAlive(JSC.VirtualMachine.get(), false);
        }

        return this_value;
    }

    pub fn cancel(this: *TimerObject, vm: *VirtualMachine) void {
        this.setEnableKeepingEventLoopAlive(vm, false);
        this.has_cleared_timer = true;

        if (this.kind == .setImmediate) return;

        const was_active = this.event_loop_timer.state == .ACTIVE;

        this.event_loop_timer.state = .CANCELLED;
        this.strong_this.deinit();

        if (was_active) {
            vm.timer.remove(&this.event_loop_timer);
            this.deref();
        }
    }

    pub fn reschedule(this: *TimerObject, vm: *VirtualMachine) void {
        if (this.kind == .setImmediate) return;

        const now = timespec.msFromNow(this.interval);
        const was_active = this.event_loop_timer.state == .ACTIVE;
        if (was_active) {
            vm.timer.remove(&this.event_loop_timer);
        } else {
            this.ref();
        }

        vm.timer.update(&this.event_loop_timer, &now);
        this.has_cleared_timer = false;

        if (this.has_js_ref) {
            this.setEnableKeepingEventLoopAlive(vm, true);
        }
    }

    fn setEnableKeepingEventLoopAlive(this: *TimerObject, vm: *VirtualMachine, enable: bool) void {
        if (this.is_keeping_event_loop_alive == enable) {
            return;
        }
        this.is_keeping_event_loop_alive = enable;

        switch (this.kind) {
            .setTimeout, .setInterval => {
                vm.timer.incrementTimerRef(if (enable) 1 else -1);
            },
            else => {},
        }
    }

    pub fn hasRef(this: *TimerObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        return JSValue.jsBoolean(this.is_keeping_event_loop_alive);
    }
    pub fn toPrimitive(this: *TimerObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
        if (!this.has_accessed_primitive) {
            this.has_accessed_primitive = true;
            const vm = VirtualMachine.get();
            vm.timer.maps.get(this.kind).put(bun.default_allocator, this.id, &this.event_loop_timer) catch bun.outOfMemory();
        }
        return JSValue.jsNumber(this.id);
    }

    pub fn finalize(this: *TimerObject) void {
        this.strong_this.deinit();
        this.deref();
    }

    pub fn deinit(this: *TimerObject) void {
        this.strong_this.deinit();
        const vm = VirtualMachine.get();

        if (this.event_loop_timer.state == .ACTIVE) {
            vm.timer.remove(&this.event_loop_timer);
        }

        if (this.has_accessed_primitive) {
            const map = vm.timer.maps.get(this.kind);
            if (map.orderedRemove(this.id)) {
                // If this array gets large, let's shrink it down
                // Array keys are i32
                // Values are 1 ptr
                // Therefore, 12 bytes per entry
                // So if you created 21,000 timers and accessed them by ID, you'd be using 252KB
                const allocated_bytes = map.capacity() * @sizeOf(TimeoutMap.Data);
                const used_bytes = map.count() * @sizeOf(TimeoutMap.Data);
                if (allocated_bytes - used_bytes > 256 * 1024) {
                    map.shrinkAndFree(bun.default_allocator, map.count() + 8);
                }
            }
        }

        this.setEnableKeepingEventLoopAlive(vm, false);
        this.destroy();
    }
};

pub const Kind = enum(u32) {
    setTimeout,
    setInterval,
    setImmediate,
};

// this is sized to be the same as one pointer
pub const ID = extern struct {
    id: i32,

    kind: Kind = Kind.setTimeout,

    pub inline fn asyncID(this: ID) u64 {
        return @bitCast(this);
    }

    pub fn repeats(this: ID) bool {
        return this.kind == .setInterval;
    }
};

const assert = bun.assert;
const heap = bun.io.heap;

pub const EventLoopTimer = struct {
    /// The absolute time to fire this timer next.
    next: timespec,

    /// Internal heap fields.
    heap: heap.IntrusiveField(EventLoopTimer) = .{},

    state: State = .PENDING,

    tag: Tag,

    pub const Tag = if (Environment.isWindows) enum {
        TimerCallback,
        TimerObject,
        TestRunner,
        StatWatcherScheduler,
        UpgradedDuplex,
        DNSResolver,
        WindowsNamedPipe,
        WTFTimer,
        PostgresSQLConnectionTimeout,
        PostgresSQLConnectionMaxLifetime,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .TimerCallback => TimerCallback,
                .TimerObject => TimerObject,
                .TestRunner => JSC.Jest.TestRunner,
                .StatWatcherScheduler => StatWatcherScheduler,
                .UpgradedDuplex => uws.UpgradedDuplex,
                .DNSResolver => DNSResolver,
                .WindowsNamedPipe => uws.WindowsNamedPipe,
                .WTFTimer => WTFTimer,
                .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
                .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
            };
        }
    } else enum {
        TimerCallback,
        TimerObject,
        TestRunner,
        StatWatcherScheduler,
        UpgradedDuplex,
        WTFTimer,
        DNSResolver,
        PostgresSQLConnectionTimeout,
        PostgresSQLConnectionMaxLifetime,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .TimerCallback => TimerCallback,
                .TimerObject => TimerObject,
                .TestRunner => JSC.Jest.TestRunner,
                .StatWatcherScheduler => StatWatcherScheduler,
                .UpgradedDuplex => uws.UpgradedDuplex,
                .WTFTimer => WTFTimer,
                .DNSResolver => DNSResolver,
                .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
                .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
            };
        }
    };

    const TimerCallback = struct {
        callback: *const fn (*TimerCallback) Arm,
        ctx: *anyopaque,
        event_loop_timer: EventLoopTimer,
    };

    pub const State = enum {
        /// The timer is waiting to be enabled.
        PENDING,

        /// The timer is active and will fire at the next time.
        ACTIVE,

        /// The timer has been cancelled and will not fire.
        CANCELLED,

        /// The timer has fired and the callback has been called.
        FIRED,
    };

    fn less(_: void, a: *const EventLoopTimer, b: *const EventLoopTimer) bool {
        const order = a.next.order(&b.next);
        if (order == .eq) {
            if (a.tag == .TimerObject and b.tag == .TimerObject) {
                const a_timer: *const TimerObject = @fieldParentPtr("event_loop_timer", a);
                const b_timer: *const TimerObject = @fieldParentPtr("event_loop_timer", b);
                return a_timer.id < b_timer.id;
            }

            if (b.tag == .TimerObject) {
                return false;
            }
        }

        return order == .lt;
    }

    fn ns(self: *const EventLoopTimer) u64 {
        return self.next.ns();
    }

    pub const Arm = union(enum) {
        rearm: timespec,
        disarm,
    };

    pub fn fire(this: *EventLoopTimer, now: *const timespec, vm: *VirtualMachine) Arm {
        switch (this.tag) {
            .PostgresSQLConnectionTimeout => return @as(*JSC.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("timer", this))).onConnectionTimeout(),
            .PostgresSQLConnectionMaxLifetime => return @as(*JSC.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("max_lifetime_timer", this))).onMaxLifetimeTimeout(),
            inline else => |t| {
                var container: *t.Type() = @alignCast(@fieldParentPtr("event_loop_timer", this));
                if (comptime t.Type() == WTFTimer) {
                    return container.fire(now, vm);
                }

                if (comptime t.Type() == TimerObject) {
                    return container.fire(now, vm);
                }

                if (comptime t.Type() == StatWatcherScheduler) {
                    return container.timerCallback();
                }
                if (comptime t.Type() == uws.UpgradedDuplex) {
                    return container.onTimeout();
                }
                if (Environment.isWindows) {
                    if (comptime t.Type() == uws.WindowsNamedPipe) {
                        return container.onTimeout();
                    }
                }

                if (comptime t.Type() == JSC.Jest.TestRunner) {
                    container.onTestTimeout(now, vm);
                    return .disarm;
                }

                if (comptime t.Type() == DNSResolver) {
                    return container.checkTimeouts(now, vm);
                }

                return container.callback(container);
            },
        }
    }

    pub fn deinit(_: *EventLoopTimer) void {}
};

const timespec = bun.timespec;

/// A timer created by WTF code and invoked by Bun's event loop
pub const WTFTimer = struct {
    /// This is WTF::RunLoop::TimerBase from WebKit
    const RunLoopTimer = opaque {};

    vm: *VirtualMachine,
    run_loop_timer: *RunLoopTimer,
    event_loop_timer: EventLoopTimer,
    imminent: *std.atomic.Value(?*WTFTimer),
    repeat: bool,
    lock: bun.Mutex = .{},

    pub usingnamespace bun.New(@This());

    pub fn init(run_loop_timer: *RunLoopTimer, js_vm: *VirtualMachine) *WTFTimer {
        const this = WTFTimer.new(.{
            .vm = js_vm,
            .imminent = &js_vm.eventLoop().imminent_gc_timer,
            .event_loop_timer = .{
                .next = .{
                    .sec = std.math.maxInt(i64),
                    .nsec = 0,
                },
                .tag = .WTFTimer,
                .state = .CANCELLED,
            },
            .run_loop_timer = run_loop_timer,
            .repeat = false,
        });

        return this;
    }

    pub fn run(this: *WTFTimer, vm: *VirtualMachine) void {
        if (this.event_loop_timer.state == .ACTIVE) {
            vm.timer.remove(&this.event_loop_timer);
        }
        this.runWithoutRemoving();
    }

    inline fn runWithoutRemoving(this: *const WTFTimer) void {
        WTFTimer__fire(this.run_loop_timer);
    }

    pub fn update(this: *WTFTimer, seconds: f64, repeat: bool) void {
        // There's only one of these per VM, and each VM has its own imminent_gc_timer
        this.imminent.store(if (seconds == 0) this else null, .seq_cst);

        if (seconds == 0.0) {
            return;
        }

        const modf = std.math.modf(seconds);
        var interval = bun.timespec.now();
        interval.sec += @intFromFloat(modf.ipart);
        interval.nsec += @intFromFloat(modf.fpart * std.time.ns_per_s);
        if (interval.nsec >= std.time.ns_per_s) {
            interval.sec += 1;
            interval.nsec -= std.time.ns_per_s;
        }

        this.vm.timer.update(&this.event_loop_timer, &interval);
        this.repeat = repeat;
    }

    pub fn cancel(this: *WTFTimer) void {
        this.lock.lock();
        defer this.lock.unlock();
        this.imminent.store(null, .monotonic);
        if (this.event_loop_timer.state == .ACTIVE) {
            this.vm.timer.remove(&this.event_loop_timer);
        }
    }

    pub fn fire(this: *WTFTimer, _: *const bun.timespec, _: *VirtualMachine) EventLoopTimer.Arm {
        this.event_loop_timer.state = .FIRED;
        this.imminent.store(null, .monotonic);
        this.runWithoutRemoving();
        return if (this.repeat)
            .{ .rearm = this.event_loop_timer.next }
        else
            .disarm;
    }

    pub fn deinit(this: *WTFTimer) void {
        this.cancel();
        this.destroy();
    }

    export fn WTFTimer__create(run_loop_timer: *RunLoopTimer) ?*anyopaque {
        if (VirtualMachine.is_bundler_thread_for_bytecode_cache) {
            return null;
        }

        return init(run_loop_timer, VirtualMachine.get());
    }

    export fn WTFTimer__update(this: *WTFTimer, seconds: f64, repeat: bool) void {
        this.update(seconds, repeat);
    }

    export fn WTFTimer__deinit(this: *WTFTimer) void {
        this.deinit();
    }

    export fn WTFTimer__isActive(this: *const WTFTimer) bool {
        return this.event_loop_timer.state == .ACTIVE or (this.imminent.load(.monotonic) orelse return false) == this;
    }

    export fn WTFTimer__cancel(this: *WTFTimer) void {
        this.cancel();
    }

    export fn WTFTimer__secondsUntilTimer(this: *WTFTimer) f64 {
        this.lock.lock();
        defer this.lock.unlock();
        if (this.event_loop_timer.state == .ACTIVE) {
            const until = this.event_loop_timer.next.duration(&bun.timespec.now());
            const sec: f64, const nsec: f64 = .{ @floatFromInt(until.sec), @floatFromInt(until.nsec) };
            return sec + nsec / std.time.ns_per_s;
        }
        return std.math.inf(f64);
    }

    extern fn WTFTimer__fire(this: *RunLoopTimer) void;
};
