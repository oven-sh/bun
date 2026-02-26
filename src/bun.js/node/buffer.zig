pub const BufferVectorized = struct {
    pub fn fill(
        str: *const bun.String,
        buf_ptr: [*]u8,
        fill_length: usize,
        encoding: jsc.Node.Encoding,
    ) callconv(.c) bool {
        if (str.length() == 0) return true;

        var buf = buf_ptr[0..fill_length];

        const is_16bit = str.isUTF16();
        const utf16_slice = if (is_16bit) str.utf16() else &[_]u16{};
        const latin1_slice = if (is_16bit) &[_]u8{} else str.latin1();

        const written = switch (encoding) {
            inline .utf8,
            .ascii,
            .latin1,
            .buffer,
            .utf16le,
            .ucs2,
            .base64,
            .base64url,
            .hex,
            => |enc| if (is_16bit)
                Encoder.writeU16(utf16_slice.ptr, utf16_slice.len, buf.ptr, buf.len, enc, true)
            else
                Encoder.writeU8(latin1_slice.ptr, latin1_slice.len, buf.ptr, buf.len, enc),
        } catch return false;

        if (written == 0 and str.length() > 0) return false;

        switch (written) {
            0 => return true,
            1 => {
                @memset(buf, buf[0]);
                return true;
            },
            inline 4, 8, 16 => |n| if (comptime Environment.isMac) {
                const pattern = buf[0..n];
                buf = buf[pattern.len..];
                @field(bun.c, std.fmt.comptimePrint("memset_pattern{d}", .{n}))(buf.ptr, pattern.ptr, buf.len);
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
    @export(&BufferVectorized.fill, .{ .name = "Bun__Buffer_fill" });
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const Encoder = jsc.WebCore.encoding;
