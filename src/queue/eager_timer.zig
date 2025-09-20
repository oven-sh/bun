const std = @import("std");
const Allocator = std.mem.Allocator;

pub const EagerTimer = struct {
    max_delay: u64,
    next_time: ?i64 = null,
    timer: ?std.Thread = null,
    stopped: bool = false,

    mutex: std.Thread.Mutex = .{},
    cond: std.Thread.Condition = .{},

    trigger_callback: ?*const fn (*anyopaque) void = null,
    trigger_context: ?*anyopaque = null,

    allocator: Allocator,

    const Self = @This();

    pub fn init(allocator: Allocator, max_delay: u64) !Self {
        if (max_delay <= 0) {
            return error.InvalidMaxDelay;
        }

        return Self{
            .allocator = allocator,
            .max_delay = max_delay,
        };
    }

    pub fn deinit(self: *Self) void {
        self.stop();
    }

    pub fn onTrigger(self: *Self, callback: *const fn (*anyopaque) void, context: *anyopaque) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.trigger_callback = callback;
        self.trigger_context = context;
    }

    pub fn schedule(self: *Self, time: ?i64) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        if (self.stopped) return;

        const now = std.time.milliTimestamp();
        var target_time: i64 = undefined;

        if (time == null or (time != null and time.? < 0)) {
            target_time = now + @as(i64, @intCast(self.max_delay));
        } else if (time.? <= now) {
            self._schedule(now + @as(i64, @intCast(self.max_delay)));
            self._triggerImmediate();
            return;
        } else {
            target_time = @min(time.?, now + @as(i64, @intCast(self.max_delay)));
        }

        if (self.next_time == null or target_time < self.next_time.?) {
            self._schedule(target_time);
        }
    }

    pub fn start(self: *Self) !void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.stopped = false;
    }

    pub fn stop(self: *Self) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        self._stop();
        self.stopped = true;
    }

    fn _stop(self: *Self) void {
        if (self.timer) |thread| {
            self.stopped = true;
            self.cond.signal();
            self.mutex.unlock();
            thread.join();
            self.mutex.lock();
            self.timer = null;
        }
        self.next_time = null;
    }

    fn _schedule(self: *Self, time: i64) void {
        if (self.timer) |thread| {
            self.stopped = true;
            self.cond.signal();
            self.mutex.unlock();
            thread.join();
            self.mutex.lock();
            self.timer = null;
        }

        self.next_time = time;
        self.stopped = false;

        const thread_config = std.Thread.SpawnConfig{};
        self.timer = std.Thread.spawn(thread_config, timerWorker, .{self}) catch null;
    }

    fn _triggerImmediate(self: *Self) void {
        if (self.trigger_callback) |callback| {
            if (self.trigger_context) |context| {
                callback(context);
            }
        }
    }

    fn _trigger(self: *Self) void {
        const now = std.time.milliTimestamp();

        if (self.next_time) |next| {
            const remaining = next - now;

            if (remaining > 0) {
                self._schedule(next);
                return;
            }
        }

        self._schedule(now + @as(i64, @intCast(self.max_delay)));

        self._triggerImmediate();
    }

    fn timerWorker(self: *Self) void {
        self.mutex.lock();
        defer self.mutex.unlock();

        while (!self.stopped and self.next_time != null) {
            const now = std.time.milliTimestamp();

            if (self.next_time) |next| {
                if (next <= now) {
                    self._trigger();
                    break;
                } else {
                    const wait_time = @as(u64, @intCast(next - now));
                    const wait_ns = wait_time * std.time.ns_per_ms;

                    self.cond.timedWait(&self.mutex, wait_ns) catch {};

                    if (self.stopped) break;
                }
            } else {
                break;
            }
        }

        self.timer = null;
    }
};
