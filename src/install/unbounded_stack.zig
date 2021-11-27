const std = @import("std");

const os = std.os;
const mem = std.mem;
const meta = std.meta;
const atomic = std.atomic;
const builtin = std.builtin;
const testing = std.testing;

const assert = std.debug.assert;

const mpsc = @This();

pub const cache_line_length = switch (builtin.cpu.arch) {
    .x86_64, .aarch64, .powerpc64 => 128,
    .arm, .mips, .mips64, .riscv64 => 32,
    .s390x => 256,
    else => 64,
};

pub fn UnboundedStack(comptime T: type, comptime next_field: meta.FieldEnum(T)) type {
    const next = meta.fieldInfo(T, next_field).name;

    return struct {
        const Self = @This();

        stack: ?*T align(cache_line_length) = null,
        cache: ?*T = null,

        pub fn push(self: *Self, node: *T) void {
            return self.pushBatch(node, node);
        }

        pub fn pushBatch(self: *Self, head: *T, tail: *T) void {
            var stack = @atomicLoad(?*T, &self.stack, .Monotonic);
            while (true) {
                @field(tail, next) = stack;
                stack = @cmpxchgWeak(
                    ?*T,
                    &self.stack,
                    stack,
                    head,
                    .Release,
                    .Monotonic,
                ) orelse return;
            }
        }

        pub fn pop(self: *Self) ?*T {
            const item = self.cache orelse (self.popBatch() orelse return null);
            self.cache = item.next;
            return item;
        }

        pub fn popBatch(self: *Self) ?*T {
            if (self.isEmpty()) return null;
            return @atomicRmw(?*T, &self.stack, .Xchg, null, .Acquire);
        }

        pub fn isEmpty(self: *Self) bool {
            return @atomicLoad(?*T, &self.stack, .Monotonic) == null;
        }
    };
}
