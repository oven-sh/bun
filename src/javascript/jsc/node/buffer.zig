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

/// These functions are called in JSBuffer.cpp
/// `CALL_WRITE_FN` is the macro which ultimately calls it
pub const Write = struct {
    pub export fn Bun__Buffer__write__BigInt64BE(input: [*]u8, value: i64) void {
        std.mem.writeIntBig(i64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__BigInt64LE(input: [*]u8, value: i64) void {
        std.mem.writeIntLittle(i64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__BigUInt64BE(input: [*]u8, value: u64) void {
        std.mem.writeIntBig(u64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__BigUInt64LE(input: [*]u8, value: u64) void {
        std.mem.writeIntLittle(u64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__DoubleBE(input: [*]u8, value: f64) void {
        std.mem.writeIntBig(u64, input[0..8], @bitCast(u64, value));
    }
    pub export fn Bun__Buffer__write__DoubleLE(input: [*]u8, value: f64) void {
        std.mem.writeIntLittle(u64, input[0..8], @bitCast(u64, value));
    }
    pub export fn Bun__Buffer__write__FloatBE(input: [*]u8, value: f64) void {
        std.mem.writeIntBig(i32, input[0..4], @bitCast(i32, @floatCast(f32, value)));
    }
    pub export fn Bun__Buffer__write__FloatLE(input: [*]u8, value: f64) void {
        std.mem.writeIntLittle(i32, input[0..4], @bitCast(i32, @floatCast(f32, value)));
    }
    pub export fn Bun__Buffer__write__Int16BE(input: [*]u8, value: i32) void {
        std.mem.writeIntBig(i16, input[0..2], @intCast(i16, value));
    }
    pub export fn Bun__Buffer__write__Int16LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(i16, input[0..2], @intCast(i16, value));
    }
    pub export fn Bun__Buffer__write__Int32BE(input: [*]u8, value: i32) void {
        std.mem.writeIntBig(i32, input[0..4], value);
    }
    pub export fn Bun__Buffer__write__Int32LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(i32, input[0..4], value);
    }
    pub export fn Bun__Buffer__write__Int64LE(input: [*]u8, value: i64) void {
        std.mem.writeIntLittle(i64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__Int8(input: [*]u8, value: i32) void {
        std.mem.writeIntNative(i8, input[0..1], @truncate(i8, value));
    }
    pub export fn Bun__Buffer__write__Int8LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(i8, input[0..1], @truncate(i8, value));
    }
    pub export fn Bun__Buffer__write__UInt16BE(input: [*]u8, value: i32) void {
        std.mem.writeIntBig(u16, input[0..2], @truncate(u16, @bitCast(u32, value)));
    }
    pub export fn Bun__Buffer__write__UInt16LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(u16, input[0..2], @truncate(u16, @bitCast(u32, value)));
    }
    pub export fn Bun__Buffer__write__UInt32BE(input: [*]u8, value: i32) void {
        std.mem.writeIntBig(u32, input[0..4], @bitCast(u32, value));
    }
    pub export fn Bun__Buffer__write__UInt32LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(u32, input[0..4], @bitCast(u32, value));
    }
    pub export fn Bun__Buffer__write__UInt64BE(input: [*]u8, value: u64) void {
        std.mem.writeIntBig(u64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__UInt64LE(input: [*]u8, value: u64) void {
        std.mem.writeIntLittle(u64, input[0..8], value);
    }
    pub export fn Bun__Buffer__write__UInt8BE(input: [*]u8, value: i32) void {
        std.mem.writeIntBig(u8, input[0..1], @bitCast(u8, @truncate(i8, value)));
    }
    pub export fn Bun__Buffer__write__UInt8LE(input: [*]u8, value: i32) void {
        std.mem.writeIntLittle(u8, input[0..1], @bitCast(u8, @truncate(i8, value)));
    }
};

comptime {
    if (!JSC.is_bindgen) {
        _ = Write.Bun__Buffer__write__BigInt64BE;
        _ = Write.Bun__Buffer__write__BigInt64LE;
        _ = Write.Bun__Buffer__write__BigUInt64BE;
        _ = Write.Bun__Buffer__write__BigUInt64LE;
        _ = Write.Bun__Buffer__write__DoubleBE;
        _ = Write.Bun__Buffer__write__DoubleLE;
        _ = Write.Bun__Buffer__write__FloatBE;
        _ = Write.Bun__Buffer__write__FloatLE;
        _ = Write.Bun__Buffer__write__Int16BE;
        _ = Write.Bun__Buffer__write__Int16LE;
        _ = Write.Bun__Buffer__write__Int32BE;
        _ = Write.Bun__Buffer__write__Int32LE;
        _ = Write.Bun__Buffer__write__Int64LE;
        _ = Write.Bun__Buffer__write__Int8;
        _ = Write.Bun__Buffer__write__Int8LE;
        _ = Write.Bun__Buffer__write__UInt16BE;
        _ = Write.Bun__Buffer__write__UInt16LE;
        _ = Write.Bun__Buffer__write__UInt32BE;
        _ = Write.Bun__Buffer__write__UInt32LE;
        _ = Write.Bun__Buffer__write__UInt64BE;
        _ = Write.Bun__Buffer__write__UInt64LE;
        _ = Write.Bun__Buffer__write__UInt8BE;
        _ = Write.Bun__Buffer__write__UInt8LE;
    }
}
