const Self = @This();

// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync-zig
//
// That code contains the following license and copyright notice:
//   SPDX-License-Identifier: MIT
//   Copyright (c) 2015-2020 Zig Contributors
//   This file is part of [zig](https://ziglang.org/), which is MIT licensed.
//   The MIT license requires this copyright notice to be included in all copies
//   and substantial portions of the software.

mutex: Mutex = .{},
cond: Condition = .{},
active: usize = 0,

pub fn init() Self {
    return .{};
}

pub fn initWithCount(count: usize) Self {
    return .{ .active = count };
}

pub fn addUnsynchronized(self: *Self, n: usize) void {
    self.active += n;
}

pub fn add(self: *Self, n: usize) void {
    self.mutex.lock();
    defer self.mutex.unlock();

    self.addUnsynchronized(n);
}

pub fn addOne(self: *Self) void {
    return self.add(1);
}

pub fn finish(self: *Self) void {
    {
        self.mutex.lock();
        defer self.mutex.unlock();

        self.active -= 1;
        if (self.active != 0) return;
    }
    self.cond.signal();
}

pub fn wait(self: *Self) void {
    self.mutex.lock();
    defer self.mutex.unlock();

    while (self.active != 0)
        self.cond.wait(&self.mutex);
}

const bun = @import("bun");

const Condition = bun.threading.Condition;
const Mutex = bun.threading.Mutex;
