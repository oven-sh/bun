const std = @import("std");
const bun = @import("../../../global.zig");
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("io");
const JSC = @import("../../../jsc.zig");
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Syscall = @import("./syscall.zig");
const os = std.os;

const JSGlobalObject = JSC.JSGlobalObject;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;

pub const BufferVectorized = struct {
    extern fn memset_pattern16(b: *anyopaque, pattern16: *const anyopaque, len: usize) void;

    pub fn fill(
        globalObject: *JSGlobalObject,
        this: *JSC.ArrayBuffer,
        str: *JSC.ZigString,
        start: u32,
        end: u32,
        encoding: JSC.Node.Encoding,
    ) callconv(.C) void {
        const allocator = JSC.VirtualMachine.vm.allocator;
        var stack_fallback = std.heap.stackFallback(512, allocator);
        var stack_fallback_allocator = stack_fallback.get();
        var input_string = str.toSlice(stack_fallback_allocator);
        if (input_string.len == 0) return;

        defer input_string.deinit();

        var buf = this.slice()[start..end];

        var slice = input_string.slice();
        switch (encoding) {
            JSC.Node.Encoding.utf8,
            JSC.Node.Encoding.ascii,
            JSC.Node.Encoding.latin1,
            JSC.Node.Encoding.buffer,
            => {
                switch (slice.len) {
                    0 => unreachable,
                    1 => {
                        @memset(buf.ptr, slice[0], 1);
                        return;
                    },
                    2...16 => {
                        if (comptime Environment.isMac) {
                            var pattern: [16]u8 = undefined;
                            var remain: []u8 = pattern[0..];

                            while (remain.len > 0) {
                                for (slice[0..]) |a| {
                                    remain[0] = a;
                                    remain = remain[1..];
                                }
                            }

                            memset_pattern16(buf.ptr, &pattern, buf.len);
                            return;
                        }
                    },
                    else => {},
                }

                var in_there = @minimum(slice.len, buf.len);
                @memcpy(buf.ptr, slice.ptr, in_there);
                if (in_there < slice.len) {
                    return;
                }

                // var ptr = buf.ptr + @as(usize, start) + slice.len;

                // const fill_length = @as(usize, end) - @as(usize, start);

                // // while (in_there < fill_length - in_there) {
                // //     std.mem.copy(ptr)
                // //     ptr += in_there;
                // //     in_there *= 2;
                // // }
            },
            else => {},
        }
    }
};

comptime {
    if (!JSC.is_bindgen) {
        @export(BufferVectorized, .{ .name = "Bun__Buffer__fill" });
    }
}
