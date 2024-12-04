const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const X509 = bun.BoringSSL.X509;

/// An X509 Certificate wrapping BoringSSL.
///
/// This code is used by both `node:crypto` and other internal APIs, so its API
/// uses zig-native constructs instead of `JSValue`, etc.
///
/// ## References
/// - [RFC 5280 - X509 Certificates](https://datatracker.ietf.org/doc/html/rfc5280)
/// - [RFC 1422 - PEM](https://www.rfc-editor.org/rfc/rfc1422)
/// - [BoringSSL API Docs - `x509.h`](https://commondatastorage.googleapis.com/chromium-boringssl-docs/x509.h.html)
pub const X509Certificate = struct {
    const name = "X509Certificate";
    cert: *X509,

    pub usingnamespace JSC.Codegen.JSX509Certificate;

    /// new X509Certificate(buffer)
    pub fn constructor(global: *JSC.JSGlobalObject, frame: *JSC.CallFrame) bun.JSError!*X509Certificate {
        if (frame.argumentsCount() != 1) return global.throwNotEnoughArguments(name, 1, frame.argumentsCount());
        var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
        const alloc = stack_fallback.get();

        const buffer: JSC.Node.StringOrBuffer = blk: {
            const buffer_arg = frame.argument(0);
            if (buffer_arg.isCell()) return global.throwInvalidArgumentTypeValue("buffer", "string, TypedArray, Buffer, or DataView", buffer_arg);
            break :blk bun.JSC.Node.StringOrBuffer.fromJS(global, alloc, buffer_arg) orelse {
                return global.throwInvalidArgumentTypeValue("buffer", "string, TypedArray, Buffer, or DataView", buffer_arg);
            };
        };
        _ = buffer;
        @panic("todo");

        // if (!buffer.isCell()) return globalObject.throwInvalidArgumentType()
        // buffer.isPrimitive()

    }
    pub fn finalize(self: *X509Certificate) void {
        self.cert.deinit();
    }
};
