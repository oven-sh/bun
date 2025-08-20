extern fn Bun__createTextCodec(encodingName: [*]const u8, encodingNameLen: usize) ?*TextCodec;
extern fn Bun__decodeWithTextCodec(codec: *TextCodec, data: [*]const u8, length: usize, flush: bool, stopOnError: bool, outSawError: *bool) bun.String;
extern fn Bun__deleteTextCodec(codec: *TextCodec) void;
extern fn Bun__stripBOMFromTextCodec(codec: *TextCodec) void;
extern fn Bun__isEncodingSupported(encodingName: [*]const u8, encodingNameLen: usize) bool;
extern fn Bun__getCanonicalEncodingName(encodingName: [*]const u8, encodingNameLen: usize, outLen: *usize) ?[*]const u8;

pub const TextCodec = opaque {
    pub fn create(encoding: []const u8) ?*TextCodec {
        jsc.markBinding(@src());
        return Bun__createTextCodec(encoding.ptr, encoding.len);
    }

    pub fn deinit(self: *TextCodec) void {
        jsc.markBinding(@src());
        Bun__deleteTextCodec(self);
    }

    pub fn decode(self: *TextCodec, data: []const u8, flush: bool, stopOnError: bool) struct { result: bun.String, sawError: bool } {
        jsc.markBinding(@src());
        var sawError: bool = false;
        const result = Bun__decodeWithTextCodec(self, data.ptr, data.len, flush, stopOnError, &sawError);

        return .{ .result = result, .sawError = sawError };
    }

    pub fn stripBOM(self: *TextCodec) void {
        jsc.markBinding(@src());
        Bun__stripBOMFromTextCodec(self);
    }

    pub fn isSupported(encoding: []const u8) bool {
        jsc.markBinding(@src());
        return Bun__isEncodingSupported(encoding.ptr, encoding.len);
    }

    pub fn getCanonicalEncodingName(encoding: []const u8) ?[]const u8 {
        jsc.markBinding(@src());
        var len: usize = 0;
        const name = Bun__getCanonicalEncodingName(encoding.ptr, encoding.len, &len) orelse return null;
        return name[0..len];
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
