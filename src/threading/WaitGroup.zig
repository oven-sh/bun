// This file contains code derived from the following source:
//   https://gist.github.com/kprotty/0d2dc3da4840341d6ff361b27bdac7dc#file-sync-zig
//
// That code contains the following license and copyright notice:
//   SPDX-License-Identifier: MIT
//   Copyright (c) 2015-2020 Zig Contributors
//   This file is part of [zig](https://ziglang.org/), which is MIT licensed.
//   The MIT license requires this copyright notice to be included in all copies
//   and substantial portions of the software.

const Self = @This();

raw_count: std.atomic.Value(usize) = .init(0),
mutex: Mutex = .{},
cond: Condition = .{},

pub fn init() Self {
    return .{};
}

pub fn initWithCount(count: usize) Self {
    return .{ .raw_count = .init(count) };
}

pub fn addUnsynchronized(self: *Self, n: usize) void {
    self.raw_count.raw += n;
}

pub fn add(self: *Self, n: usize) void {
    // Not .acquire because we don't need to synchronize with other tasks (each runs independently).
    // Not .release because there are no side effects that other threads depend on when they see
    // the *start* of a task (only finishing a task has such requirements).
    _ = self.raw_count.fetchAdd(n, .monotonic);
}

pub fn addOne(self: *Self) void {
    self.add(1);
}

pub fn finish(self: *Self) void {
    const old_count = self.raw_count.fetchSub(1, .acq_rel);
    if (old_count > 1) return;

    // This is the last task, so we need to signal the condition. If we were to call `cond.signal`
    // right now, a concurrent call to `wait` which has read a non-zero count (from before we
    // decremented it above) but which has not yet called `cond.wait` will miss the signal and
    // end up blocking forever. A thread in this state (in between reading the count and calling
    // `cond.wait`) is necessarily holding the mutex, so by locking and unlocking the mutex here,
    // we ensure that it reaches the call to `cond.wait` before we call `cond.signal`.
    self.mutex.lock();
    self.mutex.unlock();
    self.cond.signal();
}

pub fn wait(self: *Self) void {
    self.mutex.lock();
    defer self.mutex.unlock();

    while (self.raw_count.load(.acquire) > 0)
        self.cond.wait(&self.mutex);
}

const bun = @import("bun");
const std = @import("std");

const Condition = bun.threading.Condition;
const Mutex = bun.threading.Mutex;
