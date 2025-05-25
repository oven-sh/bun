const bun = @import("bun");
const JSC = bun.JSC;

pub const WTF = struct {
    extern fn WTF__parseDouble(bytes: [*]const u8, length: usize, counted: *usize) f64;

    pub fn parseDouble(buf: []const u8) !f64 {
        JSC.markBinding(@src());

        if (buf.len == 0)
            return error.InvalidCharacter;

        var count: usize = 0;
        const res = WTF__parseDouble(buf.ptr, buf.len, &count);

        if (count == 0)
            return error.InvalidCharacter;
        return res;
    }
};
