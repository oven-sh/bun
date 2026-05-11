// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync2-zig

pub fn Channel(
    comptime T: type,
    comptime buffer_type: bun.LinearFifoBufferType,
) type {
    return struct {
        mutex: Mutex,
        putters: Condition,
        getters: Condition,
        buffer: Buffer,
        is_closed: bool,

        const Self = @This();
        const Buffer = bun.LinearFifo(T, buffer_type);

        pub const init = switch (buffer_type) {
            .Static => initStatic,
            .Slice => initSlice,
            .Dynamic => initDynamic,
        };

        pub inline fn initStatic() Self {
            return .withBuffer(Buffer.init());
        }

        pub inline fn initSlice(buf: []T) Self {
            return .withBuffer(Buffer.init(buf));
        }

        pub inline fn initDynamic(allocator: std.mem.Allocator) Self {
            return .withBuffer(Buffer.init(allocator));
        }

        fn withBuffer(buffer: Buffer) Self {
            return Self{
                .mutex = .{},
                .putters = .{},
                .getters = .{},
                .buffer = buffer,
                .is_closed = false,
            };
        }

        pub fn deinit(self: *Self) void {
            self.buffer.deinit();
            self.* = undefined;
        }

        pub fn close(self: *Self) void {
            self.mutex.lock();
            defer self.mutex.unlock();

            if (self.is_closed)
                return;

            self.is_closed = true;
            self.putters.broadcast();
            self.getters.broadcast();
        }

        pub fn tryWriteItem(self: *Self, item: T) !bool {
            const wrote = try self.write(&[1]T{item});
            return wrote == 1;
        }

        pub fn writeItem(self: *Self, item: T) !void {
            return self.writeAll(&[1]T{item});
        }

        pub fn write(self: *Self, items: []const T) !usize {
            return self.writeItems(items, false);
        }

        pub fn tryReadItem(self: *Self) !?T {
            var items: [1]T = undefined;
            if ((try self.read(&items)) != 1)
                return null;
            return items[0];
        }

        pub fn readItem(self: *Self) !T {
            var items: [1]T = undefined;
            try self.readAll(&items);
            return items[0];
        }

        pub fn read(self: *Self, items: []T) !usize {
            return self.readItems(items, false);
        }

        pub fn writeAll(self: *Self, items: []const T) !void {
            bun.assert((try self.writeItems(items, true)) == items.len);
        }

        pub fn readAll(self: *Self, items: []T) !void {
            bun.assert((try self.readItems(items, true)) == items.len);
        }

        fn writeItems(self: *Self, items: []const T, should_block: bool) !usize {
            self.mutex.lock();
            defer self.mutex.unlock();

            var pushed: usize = 0;
            while (pushed < items.len) {
                const did_push = blk: {
                    if (self.is_closed)
                        return error.Closed;

                    self.buffer.write(items) catch |err| {
                        if (buffer_type == .Dynamic)
                            return err;
                        break :blk false;
                    };

                    self.getters.signal();
                    break :blk true;
                };

                if (did_push) {
                    pushed += 1;
                } else if (should_block) {
                    self.putters.wait(&self.mutex);
                } else {
                    break;
                }
            }

            return pushed;
        }

        fn readItems(self: *Self, items: []T, should_block: bool) !usize {
            self.mutex.lock();
            defer self.mutex.unlock();

            var popped: usize = 0;
            while (popped < items.len) {
                const new_item = blk: {
                    // Buffer can contain null items but readItem will return null if the buffer is empty.
                    // we need to check if the buffer is empty before trying to read an item.
                    if (self.buffer.count == 0) {
                        if (self.is_closed)
                            return error.Closed;
                        break :blk null;
                    }

                    const item = self.buffer.readItem();
                    self.putters.signal();
                    break :blk item;
                };

                if (new_item) |item| {
                    items[popped] = item;
                    popped += 1;
                } else if (should_block) {
                    self.getters.wait(&self.mutex);
                } else {
                    break;
                }
            }

            return popped;
        }
    };
}

const bun = @import("bun");
const std = @import("std");

const Condition = bun.threading.Condition;
const Mutex = bun.threading.Mutex;
