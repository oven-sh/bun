const bun = @import("root").bun;
const JSC = bun.JSC;
const Encoder = JSC.WebCore.Encoder;
const Environment = bun.Environment;

pub const BufferVectorized = struct {
    pub fn fill(
        str: *JSC.ZigString,
        buf_ptr: [*]u8,
        fill_length: usize,
        encoding: JSC.Node.Encoding,
    ) callconv(.C) bool {
        if (str.len == 0) return true;

        var buf = buf_ptr[0..fill_length];

        const written = switch (encoding) {
            .utf8 => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .utf8, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .utf8),
            .ascii => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .ascii, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .ascii),
            .latin1 => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .latin1, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .latin1),
            .buffer => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .buffer, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .buffer),
            .utf16le, .ucs2 => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .utf16le, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .utf16le),
            .base64 => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .base64, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .base64),
            .base64url => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .base64url, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .base64url),
            .hex => if (str.is16Bit())
                Encoder.writeU16(str.utf16SliceAligned().ptr, str.utf16SliceAligned().len, buf.ptr, buf.len, .hex, true)
            else
                Encoder.writeU8(str.slice().ptr, str.slice().len, buf.ptr, buf.len, .hex),
        } catch return false;

        switch (written) {
            0 => return true,
            1 => {
                @memset(buf, buf[0]);
                return true;
            },
            inline 4, 8, 16 => |n| if (comptime Environment.isMac) {
                const pattern = buf[0..n];
                buf = buf[pattern.len..];
                @field(bun.C, bun.fmt.comptimePrint("memset_pattern{d}", .{n}))(buf.ptr, pattern.ptr, buf.len);
                return true;
            },
            else => {},
        }

        var contents = buf[0..written];
        buf = buf[written..];

        while (buf.len >= contents.len) {
            bun.copy(u8, buf, contents);
            buf = buf[contents.len..];
            contents.len *= 2;
        }

        if (buf.len > 0) {
            bun.copy(u8, buf, contents[0..buf.len]);
        }

        return true;
    }
};

comptime {
    @export(BufferVectorized.fill, .{ .name = "Bun__Buffer_fill" });
}
