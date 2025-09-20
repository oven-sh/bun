const std = @import("std");
const Allocator = std.mem.Allocator;
const Mutex = std.Thread.Mutex;
const Condition = std.Thread.Condition;

pub fn Channel(comptime T: type) type {
    return struct {
        const Self = @This();

        buffer: []T,
        capacity: usize,
        allocator: Allocator,

        head: usize,
        tail: usize,
        count: usize,

        mutex: Mutex,
        not_empty: Condition,
        not_full: Condition,

        pub fn init(allocator: Allocator, capacity: usize) !Self {
            const buffer = try allocator.alloc(T, capacity);

            return Self{
                .buffer = buffer,
                .capacity = capacity,
                .allocator = allocator,
                .head = 0,
                .tail = 0,
                .count = 0,
                .mutex = .{},
                .not_empty = .{},
                .not_full = .{},
            };
        }

        pub fn deinit(self: *Self) void {
            self.allocator.free(self.buffer);
        }

        pub fn send(self: *Self, item: T) !void {
            self.mutex.lock();
            defer self.mutex.unlock();

            while (self.count >= self.capacity) {
                self.not_full.wait(&self.mutex);
            }

            self.buffer[self.tail] = item;
            self.tail = (self.tail + 1) % self.capacity;
            self.count += 1;

            self.not_empty.signal();
        }

        pub fn trySend(self: *Self, item: T) bool {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.count >= self.capacity) {
                return false;
            }

            self.buffer[self.tail] = item;
            self.tail = (self.tail + 1) % self.capacity;
            self.count += 1;

            self.not_empty.signal();
            return true;
        }

        pub fn receive(self: *Self) ?T {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.count == 0) {
                return null;
            }

            const item = self.buffer[self.head];
            self.head = (self.head + 1) % self.capacity;
            self.count -= 1;

            self.not_full.signal();
            return item;
        }

        pub fn receiveTimeout(self: *Self, timeout_ms: u64) ?T {
            const start = std.time.milliTimestamp();
            const end = start + @as(i64, @intCast(timeout_ms));

            while (std.time.milliTimestamp() < end) {
                if (self.receive()) |item| {
                    return item;
                }

                std.Thread.sleep(1 * std.time.ns_per_ms);
            }

            return null;
        }

        pub fn isEmpty(self: *Self) bool {
            self.mutex.lock();
            defer self.mutex.unlock();
            return self.count == 0;
        }

        pub fn len(self: *Self) usize {
            self.mutex.lock();
            defer self.mutex.unlock();
            return self.count;
        }

        pub fn isFull(self: *Self) bool {
            self.mutex.lock();
            defer self.mutex.unlock();
            return self.count >= self.capacity;
        }

        pub fn clear(self: *Self) void {
            self.mutex.lock();
            defer self.mutex.unlock();

            self.head = 0;
            self.tail = 0;
            self.count = 0;

            self.not_full.broadcast();
        }
    };
}
