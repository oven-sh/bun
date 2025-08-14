pub const WTF = struct {
    extern fn WTF__parseDouble(bytes: [*]const u8, length: usize, counted: *usize) f64;

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
};

pub const TextCodec = struct {
    extern fn Bun__createTextCodec(encodingName: [*]const u8, encodingNameLen: usize) ?*anyopaque;
    extern fn Bun__decodeWithTextCodec(codec: *anyopaque, data: [*]const u8, length: usize, flush: bool, stopOnError: bool, outSawError: *bool) bun.String;
    extern fn Bun__deleteTextCodec(codec: *anyopaque) void;
    extern fn Bun__stripBOMFromTextCodec(codec: *anyopaque) void;
    extern fn Bun__isEncodingSupported(encodingName: [*]const u8, encodingNameLen: usize) bool;
    extern fn Bun__getCanonicalEncodingName(encodingName: [*]const u8, encodingNameLen: usize, outLen: *usize) ?[*]const u8;

    ptr: *anyopaque,

    pub fn create(encoding: []const u8) ?TextCodec {
        jsc.markBinding(@src());
        const ptr = Bun__createTextCodec(encoding.ptr, encoding.len) orelse return null;
        return TextCodec{ .ptr = ptr };
    }

    pub fn deinit(self: TextCodec) void {
        jsc.markBinding(@src());
        Bun__deleteTextCodec(self.ptr);
    }

    pub fn decode(self: TextCodec, data: []const u8, flush: bool, stopOnError: bool) struct { result: bun.String, sawError: bool } {
        jsc.markBinding(@src());
        var sawError: bool = false;
        const result = Bun__decodeWithTextCodec(self.ptr, data.ptr, data.len, flush, stopOnError, &sawError);

        return .{ .result = result, .sawError = sawError };
    }

    pub fn stripBOM(self: TextCodec) void {
        jsc.markBinding(@src());
        Bun__stripBOMFromTextCodec(self.ptr);
    }

    pub fn isSupported(encoding: []const u8) bool {
        jsc.markBinding(@src());
        return Bun__isEncodingSupported(encoding.ptr, encoding.len);
    }

    pub fn getCanonicalName(encoding: []const u8) ?[]const u8 {
        jsc.markBinding(@src());
        var length: usize = 0;
        const ptr = Bun__getCanonicalEncodingName(encoding.ptr, encoding.len, &length) orelse return null;
        return ptr[0..length];
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
