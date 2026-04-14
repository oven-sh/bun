pub const WTF = struct {
    extern fn WTF__parseDouble(bytes: [*]const u8, length: usize, counted: *usize) f64;

    extern fn WTF__numberOfProcessorCores() c_int;

    /// On Linux, this is min(sysconf(_SC_NPROCESSORS_ONLN), sched_getaffinity count, cgroup cpu.max quota).
    /// Result is cached after the first call.
    pub fn numberOfProcessorCores() u32 {
        jsc.markBinding(@src());
        return @intCast(@max(1, WTF__numberOfProcessorCores()));
    }

    extern fn WTF__releaseFastMallocFreeMemoryForThisThread() void;

    pub fn releaseFastMallocFreeMemoryForThisThread() void {
        jsc.markBinding(@src());
        WTF__releaseFastMallocFreeMemoryForThisThread();
    }

    pub fn parseDouble(buf: []const u8) !f64 {
        jsc.markBinding(@src());

        if (buf.len == 0)
            return error.InvalidCharacter;

        var count: usize = 0;
        const res = WTF__parseDouble(buf.ptr, buf.len, &count);

        if (count == 0)
            return error.InvalidCharacter;
        return res;
    }

    extern fn WTF__parseES5Date(bytes: [*]const u8, length: usize) f64;

    // 2000-01-01T00:00:00.000Z -> 946684800000 (ms)
    pub fn parseES5Date(buf: []const u8) !f64 {
        jsc.markBinding(@src());

        if (buf.len == 0)
            return error.InvalidDate;

        const ms = WTF__parseES5Date(buf.ptr, buf.len);
        if (std.math.isFinite(ms))
            return ms;

        return error.InvalidDate;
    }

    /// ECMA-262 §21.4.1.1 Date range bound (±8.64e15 ms). Mirrors WTF::maxECMAScriptTime;
    /// a static_assert in wtf-bindings.cpp keeps them in sync.
    pub const maxECMAScriptTime: f64 = 8.64e15;

    extern fn Bun__writeHTTPDate(buffer: *[32]u8, length: usize, timestampMs: u64) c_int;

    pub fn writeHTTPDate(buffer: *[32]u8, timestampMs: u64) []u8 {
        if (timestampMs == 0) {
            return buffer[0..0];
        }

        const res = Bun__writeHTTPDate(buffer, 32, timestampMs);
        if (res < 1) {
            return buffer[0..0];
        }

        return buffer[0..@intCast(res)];
    }

    pub const StringBuilder = @import("./StringBuilder.zig");
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
