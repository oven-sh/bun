//! JSC bridge for BoringSSL error formatting. Keeps `src/boringssl/` free of JSC types.

pub fn ERR_toJS(globalThis: *jsc.JSGlobalObject, err_code: u32) jsc.JSValue {
    var outbuf: [128 + 1 + "BoringSSL ".len]u8 = undefined;
    @memset(&outbuf, 0);
    outbuf[0.."BoringSSL ".len].* = "BoringSSL ".*;
    const message_buf = outbuf["BoringSSL ".len..];

    _ = boring.ERR_error_string_n(err_code, message_buf, message_buf.len);

    const error_message: []const u8 = bun.sliceTo(outbuf[0..], 0);
    if (error_message.len == "BoringSSL ".len) {
        return globalThis.ERR(.BORINGSSL, "An unknown BoringSSL error occurred: {d}", .{err_code}).toJS();
    }

    return globalThis.ERR(.BORINGSSL, "{s}", .{error_message}).toJS();
}

const bun = @import("bun");
const jsc = bun.jsc;
const boring = bun.BoringSSL.c;
