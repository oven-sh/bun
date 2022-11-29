const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("bun").AsyncIO;
const JSC = @import("bun").JSC;
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
        str: *JSC.ZigString,
        buf_ptr: [*]u8,
        fill_length: usize,
        encoding: JSC.Node.Encoding,
    ) callconv(.C) void {
        if (str.len == 0) return;

        var buf = buf_ptr[0..fill_length];

        const written = switch (encoding) {
            JSC.Node.Encoding.utf8 => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.utf8)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.utf8),
            JSC.Node.Encoding.ascii => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.ascii)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.ascii),
            JSC.Node.Encoding.latin1 => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.latin1)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.latin1),
            JSC.Node.Encoding.buffer => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.buffer)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.buffer),
            JSC.Node.Encoding.utf16le,
            JSC.Node.Encoding.ucs2,
            => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.utf16le)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.utf16le),
            JSC.Node.Encoding.base64 => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.base64)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.base64),
            JSC.Node.Encoding.base64url => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.base64url)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.base64url),
            JSC.Node.Encoding.hex => if (str.is16Bit())
                JSC.WebCore.Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, JSC.Node.Encoding.hex)
            else
                JSC.WebCore.Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, JSC.Node.Encoding.hex),
        };

        if (written <= 0) {
            return;
        }

        var contents = buf[0..@intCast(usize, written)];
        buf = buf[@intCast(usize, written)..];

        if (contents.len == 1) {
            @memset(buf.ptr, contents[0], buf.len);
            return;
        }

        const minimum_contents = contents;
        while (buf.len >= contents.len) {
            const min_len = @minimum(contents.len, buf.len);
            std.mem.copy(u8, buf[0..min_len], contents[0..min_len]);
            if (buf.len <= contents.len) {
                break;
            }
            buf = buf[min_len..];
            contents.len *= 2;
        }

        while (buf.len > 0) {
            const to_fill = @minimum(minimum_contents.len, buf.len);
            std.mem.copy(u8, buf[0..to_fill], minimum_contents[0..to_fill]);
            buf = buf[to_fill..];
        }
    }
};

comptime {
    if (!JSC.is_bindgen) {
        @export(BufferVectorized.fill, .{ .name = "Bun__Buffer_fill" });
    }
}
